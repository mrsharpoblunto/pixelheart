export class ResourceLoader<T extends object> {
  #values: { [K in keyof T]: T[K] };
  #promise: Promise<{ [K in keyof T]: T[K] }>;
  ready: boolean;

  constructor(resources: { [K in keyof T]: Promise<T[K]> }) {
    this.#values = {} as { [K in keyof T]: T[K] };
    this.ready = false;

    const keys = Object.keys(resources) as Array<keyof T>;
    this.#promise = Promise.all(keys.map((key) => resources[key])).then((values) => {
      keys.reduce((obj, key, index) => {
        obj[key] = values[index];
        return obj;
      }, this.#values);
      this.ready = true;
      return this.#values;
    });
  }

  ifReady(callback: (obj: { [K in keyof T]: T[K] }) => void): boolean {
    if (this.ready) {
      callback(this.#values);
    }
    return this.ready;
  }

  whenReady(): Promise<{ [K in keyof T]: T[K] }> {
    return this.#promise;
  }
}
