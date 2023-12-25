import {
  BaseSource,
  DdcGatherItems,
  GatherArguments,
  GetPreviewerArguments,
  Item,
  OnEventArguments,
  Previewer,
} from "./deps/ddc.ts";
import { TextLineStream } from "./deps/std.ts";
import { Lock } from "./deps/async.ts";
import Trie from "./lib/trie.ts";

function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function decapitalize(str: string): string {
  return str.charAt(0).toLowerCase() + str.slice(1);
}

function same(x: unknown, y: unknown): boolean {
  return JSON.stringify(x) === JSON.stringify(y);
}

type Cache =
  & {
    path: string;
    mtime: number;
    active: boolean;
  }
  & ({
    trie: Trie;
    db?: undefined;
  } | {
    trie?: undefined;
    db: Deno.Kv;
  });

type Params = {
  paths: string[];
  exactLength: number;
  firstCaseInsensitive: boolean;
  showPath: boolean;
  documentCommand: string[];
  databasePath: string;
};

export class Source extends BaseSource<Params> {
  #dictCache: Record<string, Cache> = {};
  #prevPaths: string[] = [];

  #db?: Deno.Kv;
  async maybeDB(path: string): Promise<Deno.Kv | undefined> {
    try {
      if (this.#db == null && path) {
        this.#db = await Deno.openKv(path);
      }
      return this.#db;
    } catch {
      // failed to open database
    }
  }

  events = ["Initialize", "InsertEnter"];
  async onEvent({ sourceParams }: OnEventArguments<Params>): Promise<void> {
    if (!same(sourceParams.paths, this.#prevPaths)) {
      await this.update(
        sourceParams.paths,
        await this.maybeDB(sourceParams.databasePath),
      );
    }
  }

  #lock = new Lock(this.#dictCache);
  #onGoing = false;
  async update(paths: string[], db?: Deno.Kv): Promise<void> {
    if (this.#onGoing) {
      return;
    }
    this.#onGoing = true;
    this.#prevPaths = paths;

    // Deactivate old caches.
    for (const cache of Object.values(this.#dictCache)) {
      if (!paths.includes(cache.path)) {
        cache.active = false;
      }
    }

    await Promise.all(paths.map(async (path) => {
      const stat = await Deno.stat(path);
      const mtime = stat.mtime?.getTime();
      // If there is no update, the previous cache is used as is.
      if (mtime != null && this.#dictCache[path]?.mtime === mtime) {
        await this.#lock.lock((dictCache) => {
          dictCache[path].active = true;
        });
        return;
      }

      if (
        db != null && mtime != null &&
        (await db.get([path, "mtime"])).value === mtime
      ) {
        await this.#lock.lock((dictCache) => {
          dictCache[path] = {
            path,
            mtime: mtime ?? -1,
            active: true,
            db,
          };
        });
        return;
      }

      const file = await Deno.open(path);
      const lineStream = file.readable
        .pipeThrough(new TextDecoderStream())
        .pipeThrough(new TextLineStream());
      if (db != null) {
        let atm = db.atomic();
        let count = 0;
        for await (const line of lineStream) {
          for (const word of line.split(/\s+/)) {
            if (word !== "") {
              atm = atm.set([...word], word);
              if (++count >= 1000) {
                await atm.commit();
                atm = db.atomic();
                count = 0;
              }
            }
          }
        }
        await atm.commit();
        await db.set([path, "mtime"], mtime);
        await this.#lock.lock((dictCache) => {
          dictCache[path] = {
            path,
            mtime: mtime ?? -1,
            active: true,
            db,
          };
        });
      } else {
        const trie = new Trie();
        for await (const line of lineStream) {
          for (const word of line.split(/\s+/)) {
            if (word !== "") {
              trie.insert(word);
            }
          }
        }
        await this.#lock.lock((dictCache) => {
          dictCache[path] = {
            path,
            mtime: mtime ?? -1,
            active: true,
            trie,
          };
        });
      }
    }));

    this.#onGoing = false;
  }

  async search(prefix: string, showPath: boolean): Promise<Item[]> {
    const items: Item[] = [];
    for (const cache of Object.values(this.#dictCache)) {
      if (!cache.active) {
        continue;
      }
      const info = showPath ? cache.path : "";
      if (cache.trie) {
        cache.trie.search(prefix).forEach((word) => items.push({ word, info }));
      } else {
        for await (
          const entry of cache.db.list<string>({ prefix: [...prefix] })
        ) {
          items.push({ word: entry.value, info });
        }
      }
    }
    return items;
  }

  async gather({
    sourceParams: params,
    completeStr,
  }: GatherArguments<Params>): Promise<DdcGatherItems> {
    const prefix = completeStr.slice(0, params.exactLength);
    let items: Item[] = [];
    if (params.firstCaseInsensitive) {
      const isCapital = prefix.charAt(0) === prefix.charAt(0).toUpperCase();
      if (isCapital) {
        items = [
          ...await this.search(prefix, params.showPath),
          ...(await this.search(decapitalize(prefix), params.showPath))
            .map((item) => ({ ...item, word: capitalize(item.word) })),
        ];
      } else {
        items = [
          ...await this.search(prefix, params.showPath),
          ...(await this.search(capitalize(prefix), params.showPath))
            .map((item) => ({ ...item, word: decapitalize(item.word) })),
        ];
      }
    } else {
      items = await this.search(prefix, params.showPath);
    }
    const isIncomplete = completeStr.length < params.exactLength;
    return { items, isIncomplete };
  }

  #decoder = new TextDecoder();
  decode(u: Uint8Array): string {
    return this.#decoder.decode(u);
  }

  getPreviewer({
    item,
    sourceParams: params,
  }: GetPreviewerArguments<Params>): Previewer {
    const contents = item.info ? [item.info] : [];
    if (params.documentCommand.length > 0) {
      const command = params.documentCommand
        .map((c) => c === "{{word}}" ? item.word : c);
      const { stdout, stderr } = new Deno.Command(command[0], {
        args: command.slice(1),
      }).outputSync();
      if (stdout.length > 0) {
        return {
          kind: "text",
          contents: [
            ...contents,
            ...this.decode(stdout).trim().split("\n"),
          ],
        };
      } else if (stderr.length > 0) {
        return {
          kind: "text",
          contents: [
            "Error:",
            ...this.decode(stderr).trim().split("\n"),
          ],
        };
      }
    } else if (contents.length > 0) {
      return { kind: "text", contents };
    }
    return { kind: "empty" };
  }

  params(): Params {
    return {
      paths: [],
      exactLength: 2,
      firstCaseInsensitive: false,
      showPath: false,
      documentCommand: [],
      databasePath: "",
    };
  }
}
