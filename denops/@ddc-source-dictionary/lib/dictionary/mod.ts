import { Item } from "../../deps/ddc.ts";

export class Dictionary {
  constructor() {}

  activate(_paths: string[]): void | Promise<void> {
    return Promise.resolve();
  }

  update(_path: string, _force?: boolean): void | Promise<void> {
    return Promise.resolve();
  }

  search(_prefix: string, _showPath?: boolean): Item[] | Promise<Item[]> {
    return [];
  }
}
