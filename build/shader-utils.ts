import path from "path";
import fs from "fs/promises";
import chalk from "chalk";
import { GlslMinify } from "webpack-glsl-minify/build/minify";

export const shadersPath = path.join(__dirname, "../shaders");
export const shadersSrcPath = path.join(__dirname, "../src/client/shaders");

export function isShader(file: string) {
  return path.extname(file) === ".vert" || path.extname(file) === ".frag";
}

const PARAM_REGEX = /^(in|uniform)\s+(.*?)\s+(.*?);/;
const NO_MANGLE = ["texture"];

export async function processShader(
  shader: string,
  production: boolean,
  log: (message: string) => void,
  onError: (error: string) => void
): Promise<void> {
  log(
    `Building ${production ? "minified " : ""}shader ${chalk.green(shader)}...`
  );

  try {
    const shaderFile = path.join(shadersPath, shader);
    let src = await fs.readFile(shaderFile, "utf-8");
    const isVertexShader = path.extname(shader) === ".vert";
    const lines = src.split("\n");

    const inAttributes = new Map<string, string>();
    const uniforms = new Map<string, string>();

    for (const line of lines) {
      const match = PARAM_REGEX.exec(line);
      if (match) {
        switch (match[1]) {
          case "in":
            // in attributes on fragment shaders are not accessible
            // to JS code, so we ignore them
            if (isVertexShader) {
              inAttributes.set(match[3], match[2]);
            }
            break;

          case "uniform":
            uniforms.set(match[3], match[2]);
            break;
        }
      }
    }

    if (production) {
      const minifier = new GlslMinify({
        preserveUniforms: true,
        output: "object",
        nomangle: NO_MANGLE,
      });
      src = (await minifier.execute(src)).sourceCode;
    }

    const output = `type AttributeTypes = {
  ${[...inAttributes]
    .map(([name, type]) => `   ${name}: "${type}"`)
    .join(";\n")}
}

type UniformTypes = {
  ${[...uniforms].map(([name, type]) => `   ${name}: "${type}"`).join(";\n")}
}

type ShaderSource = {
  src: string;
  name: string;
  attributes: AttributeTypes;
  uniforms: UniformTypes;
}

const value: ShaderSource = {
  src: \`${src}\`,
  name: "${shader}",
  attributes: {
  ${[...inAttributes]
    .map(([name, type]) => `   ${name}: "${type}"`)
    .join(",\n")}
  },
  uniforms: {
  ${[...uniforms].map(([name, type]) => `   ${name}: "${type}"`).join(",\n")}
  },
};
export default value;
`;

    await fs.writeFile(
      `${path.join(shadersSrcPath, shader)}.ts`,
      output,
      "utf-8"
    );
  } catch (error: any) {
    onError(error.toString());
  }
}
