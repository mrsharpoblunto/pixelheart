export default class UndoStack<T> {
  #stack: Array<{
    toPrevious: T,
    toNext: T,
  }>;
  #head: number;

  constructor() {
    this.#stack = [];
    this.#head = -1;
  }

  get canUndo(): boolean {
    return this.#head >= 0;
  }

  get canRedo(): boolean {
    return this.#stack.length > this.#head + 1;
  }

  undo(): T | null {
    if (this.canUndo) {
      return this.#stack[this.#head--].toPrevious;
    }
    return null;
  }

  redo(): T | null {
    if (this.canRedo) {
      return this.#stack[++this.#head].toNext;
    }
    return null;
  }

  push(previous: T, next: T) {
    const stackEntry = {
      toNext: next,
      toPrevious: previous
    };

    ++this.#head;
    if (this.#head < this.#stack.length) {
      this.#stack.length = Math.max(this.#head, 0);
    }
    this.#stack.push(stackEntry);
  }
}

