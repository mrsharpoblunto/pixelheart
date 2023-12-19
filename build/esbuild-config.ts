import * as esbuild from "esbuild";
import path from "path";

export default function (production: boolean): esbuild.BuildOptions {
  return {
    minifyIdentifiers: production,
    minifySyntax: production,
    minifyWhitespace: production,
    bundle: true,
    target: "esnext",
    outdir: path.join(__dirname, "../www/js"),
    define: {
      ["process.env.NODE_ENV"]: `"${
        production ? "production" : "development"
      }"`,
    },
    format: "esm",
    entryNames: "[name]",
    entryPoints: [
      path.join(__dirname, "../game/game-plugin.ts"),
      path.join(__dirname, "../src/index.ts"),
    ],
    platform: "browser",
    sourcemap: true,
  };
}
