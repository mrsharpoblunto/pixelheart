import { EventEmitter } from "events";

export interface BuildContext {
  production: boolean;
  clean: boolean;
  gameRoot: string;
  assetRoot: string;
  srcRoot: string;
  outputRoot: string;
  log: (message: string) => void;
  onError: (error: string) => void;
}

export interface BuildWatchEvent {
  type: "create" | "update" | "delete";
  path: string;
}

export interface BuildPlugin extends EventEmitter {
  getName(): string;
  init(ctx: BuildContext): Promise<boolean>;
  clean(ctx: BuildContext): Promise<void>;
  build(ctx: BuildContext, incremental: boolean): Promise<void>;
  watch(
    ctx: BuildContext,
    subscribe: (
      path: string,
      callback: (err: Error | null, events: Array<BuildWatchEvent>) => void
    ) => Promise<any>
  ): Promise<void>;
}
