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

type Cache = {
  path: string;
  mtime: number;
  trie: Trie;
  active: boolean;
};

type Params = {
  paths: string[];
  exactLength: number;
  firstCaseInsensitive: boolean;
  showPath: boolean;
  documentCommand: string[];
};

export class Source extends BaseSource<Params> {
  #dictCache: Record<string, Cache> = {};
  #prePaths = "";

  events = ["Initialize", "InsertEnter"];
  async onEvent({ sourceParams }: OnEventArguments<Params>): Promise<void> {
    if (JSON.stringify(sourceParams.paths) !== this.#prePaths) {
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

    this.#prePaths = JSON.stringify(paths);

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
        this.#dictCache[path].active = true;
        return;
      }

      const trie = new Trie();
      const file = await Deno.open(path);
      const lineStream = file.readable
        .pipeThrough(new TextDecoderStream())
        .pipeThrough(new TextLineStream());
      for await (const line of lineStream) {
        line.split(/\s+/).forEach((word) => {
          if (word !== "") {
            trie.insert(word);
          }
        });
      }

      await this.#lock.lock((dictCache) => {
        dictCache[path] = {
          path,
          mtime: mtime ?? -1,
          trie,
          active: true,
        };
      });
    }));

    this.#onGoing = false;
  }

  search(prefix: string, showPath: boolean): Item[] {
    return Object.values(this.#dictCache)
      .filter((cache) => cache.active)
      .flatMap((cache) => {
        const info = showPath ? cache.path : "";
        return cache.trie.search(prefix).map((word) => ({ word, info }));
      });
  }

  gather({
    sourceParams: params,
    completeStr,
  }: GatherArguments<Params>): Promise<DdcGatherItems> {
    const prefix = completeStr.slice(0, params.exactLength);
    let items: Item[] = [];
    if (params.firstCaseInsensitive) {
      const isCapital = prefix.charAt(0) === prefix.charAt(0).toUpperCase();
      if (isCapital) {
        items = [
          ...this.search(prefix, params.showPath),
          ...this.search(decapitalize(prefix), params.showPath)
            .map((item) => ({ ...item, word: capitalize(item.word) })),
        ];
      } else {
        items = [
          ...this.search(prefix, params.showPath),
          ...this.search(capitalize(prefix), params.showPath)
            .map((item) => ({ ...item, word: decapitalize(item.word) })),
        ];
      }
    } else {
      items = this.search(prefix, params.showPath);
    }
    const isIncomplete = completeStr.length < params.exactLength;
    return Promise.resolve({ items, isIncomplete });
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
    };
  }
}
