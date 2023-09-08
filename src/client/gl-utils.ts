import {
  ReadonlyVec2,
  ReadonlyVec3,
  ReadonlyVec4,
  ReadonlyMat2,
  ReadonlyMat3,
  ReadonlyMat4,
} from "gl-matrix";

type TypeMap = {
  float: number;
  vec2: ReadonlyVec2;
  vec3: ReadonlyVec3;
  vec4: ReadonlyVec4;
  mat2: ReadonlyMat2;
  mat3: ReadonlyMat3;
  mat4: ReadonlyMat4;
};

export type AttributeType<T, K> = {
  [P in keyof T]: T[P] extends K ? P : never;
}[keyof T];

export interface Geometry {
  draw: () => void;
  drawInstanced: (instanceCount: number) => void;
}

export interface ShaderParameters {
  attributes: { [name: string]: keyof TypeMap };
  uniforms: { [name: string]: string };
}

export interface ShaderSource extends ShaderParameters {
  src: string;
  name: string;
}

export interface ShaderProgram<
  TVertParams extends ShaderParameters,
  TFragParams extends ShaderParameters
> {
  program: WebGLProgram;
  attributeTypes: { [name: string]: keyof TypeMap };
  attributes: Record<keyof TVertParams["attributes"], number>;
  uniforms: Record<
    keyof (TVertParams["uniforms"] & TFragParams["uniforms"]),
    WebGLUniformLocation
  >;
}

export function createProgram<
  TVert extends ShaderSource,
  TFrag extends ShaderSource
>(
  gl: WebGL2RenderingContext,
  vertexShaderSource: TVert,
  fragmentShaderSource: TFrag
): ShaderProgram<TVert, TFrag> | null {
  const vertexShader = gl.createShader(gl.VERTEX_SHADER)!;
  gl.shaderSource(vertexShader, vertexShaderSource.src);
  gl.compileShader(vertexShader);

  let output = "";

  if (!gl.getShaderParameter(vertexShader, gl.COMPILE_STATUS)) {
    let error = gl.getShaderInfoLog(vertexShader);
    if (error) {
      if (process.env.NODE_ENV !== "production") {
        output += decorateError(
          `\nVertex Shader: ${vertexShaderSource.name}`,
          vertexShaderSource.src,
          error
        );
      } else {
        output += error + "\n";
      }
    }
  }

  const fragmentShader = gl.createShader(gl.FRAGMENT_SHADER)!;
  gl.shaderSource(fragmentShader, fragmentShaderSource.src);
  gl.compileShader(fragmentShader);
  if (!gl.getShaderParameter(fragmentShader, gl.COMPILE_STATUS)) {
    let error = gl.getShaderInfoLog(fragmentShader);
    if (error) {
      if (process.env.NODE_ENV !== "production") {
        output += decorateError(
          `\nFragment Shader: ${fragmentShaderSource.name}`,
          fragmentShaderSource.src,
          error
        );
      } else {
        output += error + "\n";
      }
    }
  }

  const program = gl.createProgram()!;
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const error = gl.getProgramInfoLog(program);
    if (error) {
      output += `\nLinker: (${vertexShaderSource.name}, ${fragmentShaderSource.name}): ${error}`;
    }
  }

  if (output !== "") {
    throw new Error(
      `Shader compilation of [${vertexShaderSource.name}, ${fragmentShaderSource.name}] failed:\n${output}`
    );
  }

  const compiled: {
    program: WebGLProgram;
    attributeTypes: { [name: string]: keyof TypeMap };
    attributes: { [name: string]: number };
    uniforms: { [name: string]: WebGLUniformLocation };
  } = {
    program,
    attributeTypes: vertexShaderSource.attributes,
    attributes: {},
    uniforms: {},
  };

  const attributeCount = gl.getProgramParameter(program, gl.ACTIVE_ATTRIBUTES);
  for (let i = 0; i < attributeCount; ++i) {
    const info = gl.getActiveAttrib(program, i);
    if (info) {
      compiled.attributes[info.name] = gl.getAttribLocation(program, info.name);
    }
  }
  const uniformCount = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < uniformCount; ++i) {
    const info = gl.getActiveUniform(program, i);
    if (info) {
      compiled.uniforms[info.name] = gl.getUniformLocation(program, info.name)!;
    }
  }

  return compiled as ShaderProgram<TVert, TFrag>;
}

type InstanceAttributeMap<TVertParams extends ShaderParameters, TInstance> = {
  [K in keyof TVertParams["attributes"]]: [
    K,
    (instance: TInstance) => TypeMap[TVertParams["attributes"][K]]
  ];
}[keyof TVertParams["attributes"]];

export class InstanceBuffer<TVertParams extends ShaderParameters, T> {
  #buffer: WebGLBuffer | null;
  #gl: WebGL2RenderingContext;
  #instanceSize: number;
  #instanceCount: number;
  #attributeLayouts: Array<{
    col: number;
    row: number;
    size: number;
    name: keyof TVertParams["attributes"];
    load: (buffer: Float32Array, offset: number, instance: T) => void;
  }> = [];

  constructor(
    gl: WebGL2RenderingContext,
    program: ShaderProgram<TVertParams, any>,
    attributes: Array<InstanceAttributeMap<TVertParams, T>>
  ) {
    this.#gl = gl;
    this.#buffer = null;
    this.#instanceCount = 0;
    this.#instanceSize = 0;
    this.#attributeLayouts = [];

    for (let attr of attributes) {
      const attributeType = program.attributeTypes[attr[0] as string];
      if (attributeType === "float") {
        this.#attributeLayouts.push({
          col: 1,
          row: 1,
          size: 1,
          name: attr[0],
          load: (b, o, i) => {
            b[o] = attr[1](i) as number;
          },
        });
      } else {
        const partialLayout: {
          name: keyof TVertParams["attributes"];
          load: (buffer: Float32Array, offset: number, instance: T) => void;
        } = {
          name: attr[0],
          load: (b, o, i) => b.set(attr[1](i) as Float32Array, o),
        };
        switch (attributeType) {
          case "vec2":
            this.#attributeLayouts.push({
              col: 1,
              row: 2,
              size: 2,
              ...partialLayout,
            });
            break;
          case "vec3":
            this.#attributeLayouts.push({
              col: 1,
              row: 3,
              size: 3,
              ...partialLayout,
            });
            break;
          case "vec4":
            this.#attributeLayouts.push({
              col: 1,
              row: 4,
              size: 4,
              ...partialLayout,
            });
            break;
          case "mat2":
            this.#attributeLayouts.push({
              col: 2,
              row: 2,
              size: 4,
              ...partialLayout,
            });
            break;
          case "mat3":
            this.#attributeLayouts.push({
              col: 3,
              row: 3,
              size: 9,
              ...partialLayout,
            });
            break;
          case "mat4":
            this.#attributeLayouts.push({
              col: 4,
              row: 4,
              size: 16,
              ...partialLayout,
            });
            break;
          default:
            throw new Error("Unknown instance buffer attribute type");
        }
      }
      this.#instanceSize +=
        this.#attributeLayouts[this.#attributeLayouts.length - 1].size;
    }
  }

  load(instances: Array<T>): InstanceBuffer<TVertParams, T> {
    this.#instanceCount = instances.length;
    const b = new Float32Array(instances.length * this.#instanceSize);
    let offset = 0;
    for (let i = 0; i < instances.length; ++i) {
      for (let j = 0; j < this.#attributeLayouts.length; ++j) {
        this.#attributeLayouts[j].load(b, offset, instances[i]);
        offset += this.#attributeLayouts[j].size;
      }
    }
    this.#buffer = this.#gl.createBuffer()!;
    this.#gl.bindBuffer(this.#gl.ARRAY_BUFFER, this.#buffer);
    this.#gl.bufferData(this.#gl.ARRAY_BUFFER, b, this.#gl.STATIC_DRAW);
    this.#gl.bindBuffer(this.#gl.ARRAY_BUFFER, null);
    return this;
  }

  bind(
    program: ShaderProgram<TVertParams, any>,
    scope: (instanceCount: number) => void
  ): InstanceBuffer<TVertParams, T> {
    if (!this.#buffer) {
      return this;
    }
    this.#gl.bindBuffer(this.#gl.ARRAY_BUFFER, this.#buffer);
    let offset = 0;
    for (let i = 0; i < this.#attributeLayouts.length; ++i) {
      for (let col = 0; col < this.#attributeLayouts[i].col; ++col) {
        const attrPtr =
          program.attributes[this.#attributeLayouts[i].name] + col;
        this.#gl.enableVertexAttribArray(attrPtr);
        this.#gl.vertexAttribPointer(
          attrPtr,
          this.#attributeLayouts[i].row,
          this.#gl.FLOAT,
          false,
          this.#instanceSize * 4,
          offset
        );
        this.#gl.vertexAttribDivisor(attrPtr, 1);
        offset += this.#attributeLayouts[i].row * 4;
      }
    }
    scope(this.#instanceCount);
    return this;
  }
}

export function createTexture(
  gl: WebGL2RenderingContext,
  internalFormat: number,
  format: number,
  type: number,
  width: number,
  height: number,
  opts?: {
    filter?: number;
    wrap?: number;
  }
): WebGLTexture {
  const texture = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(
    gl.TEXTURE_2D,
    gl.TEXTURE_WRAP_S,
    opts?.wrap || gl.CLAMP_TO_EDGE
  );
  gl.texParameteri(
    gl.TEXTURE_2D,
    gl.TEXTURE_WRAP_T,
    opts?.wrap || gl.CLAMP_TO_EDGE
  );
  gl.texParameteri(
    gl.TEXTURE_2D,
    gl.TEXTURE_MIN_FILTER,
    opts?.filter || gl.LINEAR
  );
  gl.texParameteri(
    gl.TEXTURE_2D,
    gl.TEXTURE_MAG_FILTER,
    opts?.filter || gl.LINEAR
  );
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    internalFormat,
    width,
    height,
    0,
    format,
    type,
    null
  );
  gl.bindTexture(gl.TEXTURE_2D, null);
  return texture!;
}

function decorateError(section: string, src: string, error: string): string {
  const lines = error.split("\n");
  let output = "";
  for (let line of lines) {
    const match = line.match(/ERROR: (\d+):(\d+): (.*)/);
    if (!match) {
      line = line.trim();
      if (line.length && line.codePointAt(0) !== 0) {
        output += `${section} ${line}\n`;
      }
    } else {
      const location = {
        start: { line: parseInt(match[2], 10), column: parseInt(match[1], 10) },
      };
      output += codeFrameColumns(section, src, location, match[3]);
    }
  }
  return output;
}

function codeFrameColumns(
  section: string,
  src: string,
  location: { start: { line: number; column: number } },
  message: string
): string {
  let output = `${section}\n`;
  const lines = src.split("\n");
  const start = Math.max(location.start.line - 2, 0);
  const end = Math.min(start + 6, lines.length);
  const digits = String(end).length;

  for (let i = start; i < end; ++i) {
    const isCurrentLine = i === location.start.line - 1;
    output += `${isCurrentLine ? ">" : " "} ${(i + 1)
      .toString()
      .padEnd(digits, " ")} | ${lines[i]}\n`;

    if (i === location.start.line - 1) {
      let s = "";
      for (let j = 0; j < location.start.column; ++j) {
        s += " ";
      }
      output += `  ${"".padEnd(digits, " ")} | ${s}^ ${message}\n`;
    }
  }
  return output;
}
