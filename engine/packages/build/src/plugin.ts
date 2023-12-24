export interface BuildLogger {
  log(scope: string, message?: string): void;
  warn(scope: string, message: string): void;
  error(scope: string, message: string): void;
  errorCount: number;
}

export interface BuildContext extends BuildLogger {
  production: boolean;
  clean: boolean;
  build: boolean;
  watch: boolean | { port: number };

  gamePath: string;
  gameAssetPath: string;
  gameClientPath: string;
  gameBuildPath: string;
  gameEditorClientPath: string;
  gameEditorServerPath: string;
  gameOutputPath: string;
  emit(event: any): void;
}

export interface BuildWatchEvent {
  type: "create" | "update" | "delete";
  path: string;
}

export interface BuildPlugin {
  depends: Array<string>;
  init(ctx: BuildContext): Promise<boolean>;
  clean(ctx: BuildContext): Promise<void>;
  build(ctx: BuildContext): Promise<void>;
  watch(
    ctx: BuildContext,
    subscribe: (
      path: string,
      callback: (err: Error | null, events: Array<BuildWatchEvent>) => void
    ) => Promise<any>
  ): Promise<void>;
}
