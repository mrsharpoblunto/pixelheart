export interface BuildContext {
  production: boolean;
  port: number;
  clean: boolean;
  build: boolean;
  watch: boolean;
  gameRoot: string;
  assetRoot: string;
  srcRoot: string;
  outputRoot: string;
  log: (message: string) => void;
  onError: (error: string) => void;
  event: (event: any) => void;
}

export interface BuildWatchEvent {
  type: "create" | "update" | "delete";
  path: string;
}

export interface BuildPlugin {
  depends: Array<string>;
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
