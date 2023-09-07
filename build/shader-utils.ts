import path from "path";
import fs from "fs/promises";
import chalk from "chalk";

export function isShader(file: string) {
  return path.extname(file) === ".vert" || path.extname(file) === ".frag";
}

const paramRegex = /^(in|uniform)\s+(.*?)\s+(.*?);/;

export async function processShaderTypeDefinition(
  shaderPath: string,
  log: (message: string) => void,
  onError: (error: string) => void
): Promise<void> {
  log(
    `Building type definitions for ${chalk.green(path.basename(shaderPath))}...`
  );

  try {
    const src = await fs.readFile(shaderPath, "utf-8");
    const isVertexShader = path.extname(shaderPath) === ".vert";
    const lines = src.split("\n");

    const inAttributes = new Map<string, string>();
    const inUniforms = new Map<string, string>();

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
            inUniforms.set(match[3], match[2]);
            break;
        }
      }
    }

    const output = `import { vec2, vec3, vec4, mat2, mat3, mat4 } from "gl-matrix";
const value: string;
export default value;
export interface ProgramParameters {
  attributes: {
    ${[...inAttributes].map(([name, _]) => `   ${name}: number`).join(";\n")}
  };
  uniforms: {
      ${[...inUniforms]
        .map(([name, _]) => `   ${name}: WebGLUniformLocation`)
        .join(";\n")}
  };
};
export interface Attributes {
  ${[...inAttributes].map(([name, type]) => `   ${name}: ${type}`).join(";\n")}
};`;

    await fs.writeFile(`${shaderPath}.d.ts`, output, "utf-8");
  } catch (error: any) {
    onError(error.toString());
  }
}
