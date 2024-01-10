import { Denops } from "../deps/denops.ts";
import { is } from "../deps/unknownutil.ts";

export function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

export function decapitalize(str: string): string {
  return str.charAt(0).toLowerCase() + str.slice(1);
}

export function same(x: unknown, y: unknown): boolean {
  return JSON.stringify(x) === JSON.stringify(y);
}

const decoder = new TextDecoder();
export function splitLines(u: Uint8Array): string[] {
  return decoder.decode(u).trim().replaceAll(/\r\n?/g, "\n").split("\n");
}

export async function asyncFlatMap<T, U>(
  list: T[],
  callback: (x: T) => Promise<U[]>,
): Promise<U[]> {
  const nested = await Promise.all(list.map(callback));
  return nested.flat(1);
}

export async function printError(
  denops: Denops,
  msg: string | string[],
): Promise<void> {
  for (const m of is.Array(msg) ? msg : [msg]) {
    await denops.call("ddc#util#print_error", m, "ddc-source-dictionary");
  }
}
