import { Dictionary } from "./mod.ts";
import { splitLines } from "../util.ts";
import { Item } from "../../deps/ddc.ts";

export class GrepDictionary implements Dictionary {
  #paths: string[] = [];
  #command: string[];

  constructor(command: string[]) {
    this.#command = command;
  }

  activate(paths: string[]) {
    this.#paths = paths;
  }

  update() {}

  async search(
    prefix: string,
    showPath?: boolean,
  ): Promise<Item[]> {
    return await asyncFlatMap(this.#paths, async (path) => {
      const command = this.#command[0];
      const args = this.#command.slice(1).map((arg) =>
        arg.replaceAll("${prefix}", prefix)
          .replaceAll("${path}", path)
      );
      const { stdout } = await (new Deno.Command(command, { args })).output();
      const words = splitLines(stdout);
      return words.map((word) => ({ word, info: showPath ? path : "" }));
    });
  }
}

async function asyncFlatMap<T, U>(
  list: T[],
  callback: (x: T) => Promise<U[]>,
): Promise<U[]> {
  const nested = await Promise.all(list.map(callback));
  return nested.flat(1);
}
