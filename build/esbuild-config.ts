import { glsl } from "esbuild-plugin-glsl";
import path from "path";
import * as esbuild from "esbuild";

export default function (production: boolean): esbuild.BuildOptions {
  return {
    minifyIdentifiers: production,
    minifySyntax: production,
    minifyWhitespace: production,
    bundle: true,
    outdir: path.join(__dirname, "../www/js"),
    define: {
      ["process.env.NODE_ENV"]: `"${
        production ? "production" : "development"
      }"`,
    },
    entryPoints: [path.join(__dirname, "../src/client/index.ts")],
    plugins: [
      glsl({
        minify: production,
      }),
    ],
    platform: "browser",
    sourcemap: true,
  };
}
