import { Dictionary } from "./mod.ts";
import { asyncFlatMap, splitLines } from "../util.ts";
import { Item } from "../../deps/ddc.ts";

export class ExternalDictionary implements Dictionary {
  #command: string[];
  #paths: string[] = [];

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
      const cmd = this.#command[0];
      const args = this.#command.slice(1).map((arg) =>
        arg.replaceAll("${prefix}", prefix)
          .replaceAll("${path}", path)
      );
      const command = new Deno.Command(cmd, { args });
      const { stdout } = await command.output();
      const words = splitLines(stdout);
      const info = showPath ? path : "";
      return words.map((word) => ({ word, info }));
    });
  }
}
