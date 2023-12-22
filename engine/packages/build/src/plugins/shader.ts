import chalk from "chalk";
import { existsSync } from "fs";
import fs from "fs/promises";
import path from "path";
import { GlslMinify } from "webpack-glsl-minify/build/minify.js";

import { ensurePath } from "../file-utils.js";
import { BuildContext, BuildPlugin, BuildWatchEvent } from "../plugin.js";

export function isShader(file: string) {
  return path.extname(file) === ".vert" || path.extname(file) === ".frag";
}

const INOUT_PARAM_REGEX =
  /^\s*(layout\(\s*location\s*=\s*([0-9]*)\)\s*)?(out|in|uniform)\s+(.*?)\s+(.*?);/;
const DEFINE_REGEX = /^#\s*define\s+(\w+)\s+([0-9]+)/;
const CONST_REGEX = /^const\s+\w+\s+(\w+)\s*=\s*([0-9]+);/;
const NO_MANGLE = ["texture"];

export default class ShaderPlugin implements BuildPlugin {
  depends = [];

  async init(ctx: BuildContext): Promise<boolean> {
    if (existsSync(path.join(ctx.assetRoot, "shaders"))) {
      await ensurePath(path.join(ctx.srcRoot, "shaders"));
      return true;
    } else {
      return false;
    }
  }

  async clean(ctx: BuildContext) {
    try {
      await fs.rm(path.join(ctx.srcRoot, "shaders"), {
        recursive: true,
        force: true,
      });
    } catch (e) { }
  }

  async build(ctx: BuildContext, incremental: boolean) {
    const shaderAssetsPath = path.join(ctx.assetRoot, "shaders");
    const shaderSrcPath = path.join(ctx.srcRoot, "shaders");

    const sourceShaders = await fs.readdir(shaderAssetsPath);
    const destShaders = incremental ? await fs.readdir(shaderSrcPath) : [];
    const shadersToType = [];
    for (const src of sourceShaders) {
      const srcStat = await fs.stat(path.join(shaderAssetsPath, src));
      if (!isShader(src)) {
        continue;
      }

      const dest = `${src}.ts`;
      if (
        // doesn't exist
        destShaders.indexOf(dest) < 0 ||
        // or is older than the source
        srcStat.mtimeMs >
        (await fs.stat(path.join(shaderSrcPath, dest))).mtimeMs
      ) {
        shadersToType.push(src);
      }
    }
    await Promise.all(shadersToType.map((s) => this.#processShader(ctx, s)));
  }

  async watch(
    ctx: BuildContext,
    subscribe: (
      path: string,
      cb: (err: Error | null, events: Array<BuildWatchEvent>) => any
    ) => Promise<void>
  ) {
    await subscribe(
      path.join(ctx.assetRoot, "shaders"),
      async (_err, events) => {
        await this.#processShaderEvents(ctx, events);
      }
    );
  }

  async #processShaderEvents(
    ctx: BuildContext,
    events: Array<BuildWatchEvent>
  ) {
    for (let e of events) {
      if (!isShader(e.path)) {
        continue;
      }

      switch (e.type) {
        case "create":
        case "update":
          {
            const shader = path.basename(e.path);
            const src = await this.#processShader(ctx, shader);
            if (src) {
              ctx.event({ type: "RELOAD_SHADER", shader, src });
            }
          }
          break;

        case "delete":
          {
            await fs.rm(e.path);
            await fs.rm(`${e.path}.d.ts`);
          }
          break;
      }
    }
  }

  async #processShader(ctx: BuildContext, shader: string): Promise<string> {
    const shaderAssetsPath = path.join(ctx.assetRoot, "shaders");
    const shaderSrcPath = path.join(ctx.srcRoot, "shaders");

    ctx.log(
      `Building ${ctx.production ? "minified " : ""}shader ${chalk.green(
        shader
      )}...`
    );

    try {
      const shaderFile = path.join(shaderAssetsPath, shader);
      let src = await fs.readFile(shaderFile, "utf-8");
      const isVertexShader = path.extname(shader) === ".vert";
      const lines = src.split("\n");

      const inAttributes = new Map<
        string,
        { type: string; location?: number }
      >();
      const outAttributes = new Map<
        string,
        { type: string; location?: number }
      >();
      const uniforms = new Map<string, string>();
      const constants = new Map<string, number>();

      for (const line of lines) {
        let match = INOUT_PARAM_REGEX.exec(line);
        if (match) {
          const location = !match[2] ? undefined : parseInt(match[2]);
          switch (match[3]) {
            case "in":
              // in attributes on fragment shaders are not accessible
              // to JS code, so we ignore them
              if (isVertexShader) {
                inAttributes.set(match[5], { type: match[4], location });
              }
              break;
            case "out":
              // out attributes on vertex shaders are not accessible
              // to JS code, so we ignore them
              if (!isVertexShader) {
                outAttributes.set(match[5], { type: match[4], location });
              }
              break;

            case "uniform":
              uniforms.set(match[5], match[4]);
              break;
          }
        }
        match = DEFINE_REGEX.exec(line) || CONST_REGEX.exec(line);
        if (match) {
          constants.set(match[1], Number(match[2]));
        }
      }

      if (ctx.production) {
        const minifier = new GlslMinify({
          preserveUniforms: true,
          output: "object",
          nomangle: NO_MANGLE.concat([...outAttributes.keys()]),
        });
        src = (await minifier.execute(src)).sourceCode;
      }

      const output = `
type InAttributeTypes = {
${[...inAttributes]
          .map(
            ([name, { type, location }]) =>
              `   ${name}: {type: "${type}"${location !== undefined ? `,location:${location}` : ""
              }}`
          )
          .join(";\n")}
}

type OutAttributeTypes = {
${[...outAttributes]
          .map(
            ([name, { type, location }]) =>
              `   ${name}: {type: "${type}"${location !== undefined ? `,location:${location}` : ""
              }}`
          )
          .join(";\n")}
}

type UniformTypes = {
${[...uniforms].map(([name, type]) => `   ${name}: "${type}"`).join(";\n")}
}

export const enum Constants {
${[...constants].map(([name, value]) => `   ${name} = ${value}`).join(",\n")}
}

type ShaderSource = {
  src: string;
  name: string;
  inAttributes: InAttributeTypes;
  outAttributes: OutAttributeTypes;
  uniforms: UniformTypes;
};

const value: ShaderSource = {
  src: \`${src}\`,
  name: "${shader}",
  inAttributes: {
${[...inAttributes]
          .map(
            ([name, { type, location }]) =>
              `   ${name}: {type: "${type}"${location !== undefined ? `,location:${location}` : ""
              }}`
          )
          .join(",\n")}
  },
  outAttributes: {
${[...outAttributes]
          .map(
            ([name, { type, location }]) =>
              `   ${name}: {type: "${type}"${location !== undefined ? `,location:${location}` : ""
              }}`
          )
          .join(",\n")}
  },
  uniforms: {
${[...uniforms].map(([name, type]) => `   ${name}: "${type}"`).join(",\n")}
  },
};
export default value;
`;

      await fs.writeFile(
        `${path.join(shaderSrcPath, shader)}.ts`,
        output,
        "utf-8"
      );
      return src;
    } catch (error: any) {
      ctx.onError(error.toString());
      return "";
    }
  }
}
