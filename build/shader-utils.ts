import path from "path";
import fs from "fs/promises";
import chalk from "chalk";

export const shadersPath = path.join(__dirname, "../shaders");
export const shadersSrcPath = path.join(__dirname, "../src/client/shaders");

export function isShader(file: string) {
  return path.extname(file) === ".vert" || path.extname(file) === ".frag";
}

const paramRegex = /^(in|uniform)\s+(.*?)\s+(.*?);/;

export async function processShader(
  shader: string,
  log: (message: string) => void,
  onError: (error: string) => void
): Promise<void> {
  log(`Building shader ${chalk.green(shader)}...`);

  try {
    const shaderFile = path.join(shadersPath, shader);
    const src = await fs.readFile(shaderFile, "utf-8");
    const isVertexShader = path.extname(shader) === ".vert";
    const lines = src.split("\n");

    const inAttributes = new Map<string, string>();
    const uniforms = new Map<string, string>();

    for (const line of lines) {
      const match = paramRegex.exec(line);
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

    const output = `import { vec2, vec3, vec4, mat2, mat3, mat4 } from "gl-matrix";

type AttributeTypes = {
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
  path: string;
  attributes: AttributeTypes;
  uniforms: UniformTypes;
}

const value: ShaderSource = {
  src: \`${src}\`,
  name: "${shader}",
  path: "${shaderFile}",
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
