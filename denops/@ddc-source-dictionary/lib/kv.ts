const Encoder = new TextEncoder();
function calcKeySize(keys: string[]): number {
  let size = 0;
  for (const key of keys) {
    const encoded = Encoder.encode(key);
    size += encoded.reduce((acc, cur) => acc + (cur === 0x00 ? 2 : 1), 2);
  }
  return size;
}

export class Kv {
  #database: Deno.Kv;
  #atomic: Deno.AtomicOperation;
  #mutateCount = 0;
  #totalKeySize = 0;

  constructor(
    database: Deno.Kv,
  ) {
    this.#database = database;
    this.#atomic = database.atomic();
  }

  async set(key: Deno.KvKey, value: unknown): Promise<void> {
    await this.#database.set(key, value);
  }

  async get<T>(key: Deno.KvKey): Promise<T | null> {
    return (await this.#database.get<T>(key)).value;
  }

  list<T>(selector: Deno.KvListSelector, options?: Deno.KvListOptions) {
    return this.#database.list<T>(selector, options);
  }

  async atomSet(key: string[], value: unknown): Promise<void> {
    const keySize = calcKeySize(key);
    if (this.#mutateCount >= 1000 || this.#totalKeySize + keySize > 81920) {
      await this.atomCommit();
    }
    this.#atomic = this.#atomic.set(key, value);
    this.#mutateCount++;
    this.#totalKeySize += keySize;
  }

  async atomCommit(): Promise<void> {
    await this.#atomic.commit();
    this.#atomic = this.#database.atomic();
    this.#mutateCount = 0;
    this.#totalKeySize = 0;
  }
}
