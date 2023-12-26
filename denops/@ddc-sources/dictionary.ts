import {
  BaseSource,
  DdcGatherItems,
  GatherArguments,
  GetPreviewerArguments,
  Item,
  OnEventArguments,
  OnInitArguments,
  Previewer,
} from "./deps/ddc.ts";
import { Denops } from "./deps/denops.ts";
import { is } from "./deps/unknownutil.ts";
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

const decoder = new TextDecoder();
function splitLines(u: Uint8Array): string[] {
  return decoder.decode(u).trim().replaceAll(/\r\n?/g, "\n").split("\n");
}

type Cache = {
  path: string;
  mtime: number;
  active: boolean;
  trie?: Trie;
};

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
  async onInit({
    denops,
    sourceParams: params,
  }: OnInitArguments<Params>): Promise<void> {
    if (params.databasePath) {
      try {
        this.#db = await Deno.openKv(params.databasePath);
      } catch (e) {
        await this.printError(denops, [
          `Failed to open databasePath: ${params.databasePath}`,
          String(e),
        ]);
      }
    }
  }

  async printError(
    denops: Denops,
    msg: string | string[],
  ): Promise<void> {
    for (const m of is.Array(msg) ? msg : [msg]) {
      await denops.call("ddc#util#print_error", m, "ddc-source-dictionary");
    }
  }

  events = ["Initialize", "InsertEnter"];
  async onEvent({ sourceParams }: OnEventArguments<Params>): Promise<void> {
    if (!same(sourceParams.paths, this.#prevPaths)) {
      await this.update(sourceParams.paths);
    }
  }

  #lock = new Lock(this.#dictCache);
  #onGoing = false;
  async update(paths: string[]): Promise<void> {
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
      if (mtime && this.#dictCache[path]?.mtime === mtime) {
        await this.#lock.lock((dictCache) => {
          dictCache[path].active = true;
        });
        return;
      }

      // If the file has already been registered in the database, there is no need to read the file.
      if (mtime && (await this.#db?.get([path, "mtime"]))?.value === mtime) {
        await this.#lock.lock((dictCache) => {
          dictCache[path] = {
            path,
            mtime: mtime ?? -1,
            active: true,
          };
        });
        return;
      }

      let trie: Trie | undefined;
      const file = await Deno.open(path);
      const lineStream = file.readable
        .pipeThrough(new TextDecoderStream())
        .pipeThrough(new TextLineStream());
      if (this.#db) {
        let [atm, count] = [this.#db.atomic(), 0];
        for await (const line of lineStream) {
          for (const word of line.split(/\s+/)) {
            if (word !== "") {
              atm = atm.set([path, "word", ...word], word);
              if (++count >= 500) {
                await atm.commit();
                [atm, count] = [this.#db.atomic(), 0];
              }
            }
          }
        }
        await atm.commit();
        await this.#db.set([path, "mtime"], mtime);
      } else {
        trie = new Trie();
        for await (const line of lineStream) {
          for (const word of line.split(/\s+/)) {
            if (word !== "") {
              trie.insert(word);
            }
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
      } else if (this.#db) {
        for await (
          const entry of this.#db.list<string>({
            prefix: [cache.path, "word", ...prefix],
          })
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

  getPreviewer({
    item,
    sourceParams: params,
  }: GetPreviewerArguments<Params>): Previewer {
    const contents = item.info ? [item.info] : [];
    if (params.documentCommand.length > 0) {
      const command = params.documentCommand.map((c) =>
        c.replaceAll(
          /\${item\.(\w+)}/g,
          (_, p1) => String(item[p1 as keyof typeof item] ?? ""),
        )
      );
      const { stdout, stderr } = new Deno.Command(command[0], {
        args: command.slice(1),
      }).outputSync();
      if (stdout.length > 0) {
        contents.push(...splitLines(stdout));
      } else if (stderr.length > 0) {
        contents.push("Error:", ...splitLines(stderr));
      }
    }
    return { kind: "text", contents };
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
