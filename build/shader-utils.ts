import chalk from "chalk";
import fs from "fs/promises";
import path from "path";
import { GlslMinify } from "webpack-glsl-minify/build/minify";

export const shadersPaths = [
  {
    assets: path.join(__dirname, "../game/assets/shaders"),
    src: path.join(__dirname, "../game/client/generated/shaders"),
  },
  {
    assets: path.join(__dirname, "../src/shader-assets"),
    src: path.join(__dirname, "../src/shaders"),
  },
];

export function isShader(file: string) {
  return path.extname(file) === ".vert" || path.extname(file) === ".frag";
}

const INOUT_PARAM_REGEX =
  /^\s*(layout\(\s*location\s*=\s*([0-9]*)\)\s*)?(out|in|uniform)\s+(.*?)\s+(.*?);/;
const DEFINE_REGEX = /^#\s*define\s+(\w+)\s+([0-9]+)/;
const CONST_REGEX = /^const\s+\w+\s+(\w+)\s*=\s*([0-9]+);/;
const NO_MANGLE = ["texture"];

export async function processShader(
  shaderPath: { assets: string; src: string },
  shader: string,
  production: boolean,
  log: (message: string) => void,
  onError: (error: string) => void
): Promise<string> {
  log(
    `Building ${production ? "minified " : ""}shader ${chalk.green(shader)}...`
  );

  try {
    const shaderFile = path.join(shaderPath.assets, shader);
    let src = await fs.readFile(shaderFile, "utf-8");
    const isVertexShader = path.extname(shader) === ".vert";
    const lines = src.split("\n");

    const inAttributes = new Map<string, { type: string; location?: number }>();
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

    if (production) {
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
      `   ${name}: {type: "${type}"${
        location !== undefined ? `,location:${location}` : ""
      }}`
  )
  .join(";\n")}
}

type OutAttributeTypes = {
${[...outAttributes]
  .map(
    ([name, { type, location }]) =>
      `   ${name}: {type: "${type}"${
        location !== undefined ? `,location:${location}` : ""
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
      `   ${name}: {type: "${type}"${
        location !== undefined ? `,location:${location}` : ""
      }}`
  )
  .join(",\n")}
  },
  outAttributes: {
${[...outAttributes]
  .map(
    ([name, { type, location }]) =>
      `   ${name}: {type: "${type}"${
        location !== undefined ? `,location:${location}` : ""
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
      `${path.join(shaderPath.src, shader)}.ts`,
      output,
      "utf-8"
    );
    return src;
  } catch (error: any) {
    onError(error.toString());
    return "";
  }
}
