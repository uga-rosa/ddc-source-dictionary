import { Dictionary } from "./mod.ts";
import { Lock } from "../../deps/async.ts";
import { TextLineStream } from "../../deps/std.ts";
import { Item } from "../../deps/ddc.ts";
import { Kv } from "../kv.ts";

export class KvDictionary implements Dictionary {
  #kv: Kv;
  #activePath: Map<string, boolean>;
  #lock = new Lock(0);

  constructor(
    database: Deno.Kv,
  ) {
    this.#kv = new Kv(database);
    this.#activePath = new Map();
  }

  static async create(
    databasePath: string,
  ): Promise<KvDictionary> {
    const database = await Deno.openKv(databasePath);
    return new KvDictionary(database);
  }

  async activate(
    paths: string[],
  ): Promise<void> {
    this.#activePath = new Map();
    await Promise.all(paths.map(async (path) => {
      await this.update(path);
      this.#activePath.set(path, true);
    }));
  }

  async update(
    path: string,
    force?: boolean,
  ): Promise<void> {
    const stat = await Deno.stat(path);
    const mtime = stat.mtime?.getTime();
    if (!force && mtime && await this.#kv.get([path, "mtime"]) === mtime) {
      return;
    }

    const lineStream = Deno.openSync(path).readable
      .pipeThrough(new TextDecoderStream())
      .pipeThrough(new TextLineStream());
    for await (const line of lineStream) {
      for (const word of line.split(/\s+/)) {
        if (word !== "") {
          await this.#lock.lock(() =>
            this.#kv.atomSet([path, "word", ...word], word)
          );
        }
      }
    }
    await this.#kv.atomCommit();
    await this.#kv.set([path, "mtime"], mtime);
  }

  async search(
    prefix: string,
    showPath?: boolean,
  ): Promise<Item[]> {
    const items: Item[] = [];
    for (const [path, active] of this.#activePath) {
      if (!active) {
        continue;
      }
      for await (
        const entry of this.#kv.list<string>({
          prefix: [path, "word", ...prefix],
          start: [path, "word", ...prefix],
        })
      ) {
        items.push({ word: entry.value, info: showPath ? path : "" });
      }
    }
    return items;
  }
}
