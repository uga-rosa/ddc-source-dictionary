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
import {
  capitalize,
  decapitalize,
  printError,
  same,
  splitLines,
} from "./lib/util.ts";
import { Dictionary } from "./lib/dictionary/mod.ts";
import { KvDictionary } from "./lib/dictionary/kv.ts";
import { TrieDictionary } from "./lib/dictionary/trie.ts";

type Params = {
  paths: string[];
  exactLength: number;
  firstCaseInsensitive: boolean;
  showPath: boolean;
  documentCommand: string[];
  databasePath: string;
};

export class Source extends BaseSource<Params> {
  #dictionary = new Dictionary();
  #prevPaths: string[] = [];

  async onInit({
    denops,
    sourceParams: params,
  }: OnInitArguments<Params>): Promise<void> {
    if (params.databasePath) {
      try {
        this.#dictionary = await KvDictionary.create(params.databasePath);
      } catch (e) {
        await printError(denops, [
          `Failed to open databasePath: ${params.databasePath}`,
          String(e),
        ]);
      }
    } else {
      this.#dictionary = new TrieDictionary();
    }
  }

  events = ["Initialize", "InsertEnter"];
  async onEvent({ sourceParams }: OnEventArguments<Params>): Promise<void> {
    if (!same(sourceParams.paths, this.#prevPaths)) {
      await this.update(sourceParams.paths);
    }
  }

  #onGoing = false;
  async update(paths: string[]): Promise<void> {
    if (this.#onGoing) {
      return;
    }
    this.#onGoing = true;
    this.#prevPaths = paths;
    await this.#dictionary.activate(paths);
    this.#onGoing = false;
  }

  async search(prefix: string, showPath: boolean): Promise<Item[]> {
    return await this.#dictionary.search(prefix, showPath);
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
