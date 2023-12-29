import { Dictionary } from "./mod.ts";
import { TextLineStream } from "../../deps/std.ts";
import { Item } from "../../deps/ddc.ts";
import { Lock } from "../../deps/async.ts";
import Trie from "../trie.ts";

type Cache = {
  path: string;
  mtime: number;
  active: boolean;
  trie: Trie;
};

export class TrieDictionary implements Dictionary {
  #caches: Map<string, Cache> = new Map();
  #lock = new Lock(this.#caches);

  constructor() {}

  async activate(
    paths: string[],
  ): Promise<void> {
    for (const [, cache] of this.#caches) {
      cache.active = false;
    }
    await Promise.all(paths.map((path) => this.update(path)));
  }

  async update(
    path: string,
    force?: boolean,
  ): Promise<void> {
    const stat = await Deno.stat(path);
    const mtime = stat.mtime?.getTime();
    const cache = await this.#lock.lock((caches) => caches.get(path));
    if (!force && mtime && cache && cache.mtime === mtime) {
      cache.active = true;
      return;
    }

    const trie = new Trie();
    const lineStream = Deno.openSync(path).readable
      .pipeThrough(new TextDecoderStream())
      .pipeThrough(new TextLineStream());
    for await (const line of lineStream) {
      for (const word of line.split(/\s+/)) {
        if (word !== "") {
          trie.insert(word);
        }
      }
    }

    await this.#lock.lock((caches) => {
      caches.set(path, {
        path,
        mtime: mtime ?? -1,
        active: true,
        trie,
      });
    });
  }

  search(
    prefix: string,
    showPath?: boolean,
  ): Item[] {
    const items: Item[] = [];
    for (const [path, cache] of this.#caches) {
      if (!cache.active) {
        continue;
      }
      for (const word of cache.trie.search(prefix)) {
        items.push({ word, info: showPath ? path : "" });
      }
    }
    return items;
  }
}
