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

export type AttributeType<T extends ShaderSource, K> = {
  [P in keyof T["inAttributes"]]: T["inAttributes"][P]["type"] extends K
    ? P
    : never;
}[keyof T["inAttributes"]];

export interface Geometry {
  draw: () => void;
}

export interface ShaderSource {
  src: string;
  name: string;
  inAttributes: { [name: string]: { type: keyof TypeMap; layout?: number } };
  outAttributes: { [name: string]: { type: keyof TypeMap; layout?: number } };
  uniforms: { [name: string]: string };
}

export class ShaderProgram<
  TVert extends ShaderSource,
  TFrag extends ShaderSource
> {
  #gl: WebGL2RenderingContext;
  #program: WebGLProgram;
  inAttributes: Record<
    keyof TVert["inAttributes"],
    { location: number; type: keyof TypeMap }
  >;
  outAttributes: Record<
    keyof TFrag["outAttributes"],
    { location: number; type: keyof TypeMap }
  >;
  uniforms: Record<
    keyof (TVert["uniforms"] & TFrag["uniforms"]),
    WebGLUniformLocation
  >;

  constructor(
    gl: WebGL2RenderingContext,
    vertexShaderSource: TVert,
    fragmentShaderSource: TFrag
  ) {
    this.#gl = gl;
    this.#program = gl.createProgram()!;
    this.inAttributes = {} as Record<
      keyof TVert["inAttributes"],
      { location: number; type: keyof TypeMap; layout?: number }
    >;
    this.outAttributes = {} as Record<
      keyof TVert["outAttributes"],
      { location: number; type: keyof TypeMap; layout?: number }
    >;
    this.uniforms = {} as Record<keyof TVert["uniforms"], WebGLUniformLocation>;

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

    gl.attachShader(this.#program, vertexShader);
    gl.attachShader(this.#program, fragmentShader);
    gl.linkProgram(this.#program);
    if (!gl.getProgramParameter(this.#program, gl.LINK_STATUS)) {
      const error = gl.getProgramInfoLog(this.#program);
      if (error) {
        output += `\nLinker: (${vertexShaderSource.name}, ${fragmentShaderSource.name}): ${error}`;
      }
    }

    if (output !== "") {
      throw new Error(
        `Shader compilation of [${vertexShaderSource.name}, ${fragmentShaderSource.name}] failed:\n${output}`
      );
    }

    const attributeCount = gl.getProgramParameter(
      this.#program,
      gl.ACTIVE_ATTRIBUTES
    );
    for (let i = 0; i < attributeCount; ++i) {
      const info = gl.getActiveAttrib(this.#program, i);
      if (info) {
        const key = info.name;
        if (key in vertexShaderSource.inAttributes) {
          this.inAttributes[key as unknown as keyof TVert["inAttributes"]] = {
            location: gl.getAttribLocation(this.#program, info.name),
            type: vertexShaderSource.inAttributes[key].type,
          };
        }
      }
    }

    Object.keys(fragmentShaderSource.outAttributes).forEach((key) => {
      const location = gl.getFragDataLocation(this.#program, key);
      this.outAttributes[key as unknown as keyof TFrag["outAttributes"]] = {
        location,
        type: fragmentShaderSource.outAttributes[key].type,
      };
    });

    const uniformCount = gl.getProgramParameter(
      this.#program,
      gl.ACTIVE_UNIFORMS
    );
    for (let i = 0; i < uniformCount; ++i) {
      const info = gl.getActiveUniform(this.#program, i);
      if (info) {
        const key = info.name;
        if (
          key in vertexShaderSource.uniforms ||
          key in fragmentShaderSource.uniforms
        ) {
          this.uniforms[
            info.name as unknown as
              | keyof TVert["uniforms"]
              | keyof TFrag["uniforms"]
          ] = gl.getUniformLocation(this.#program, info.name)!;
        }
      }
    }
  }

  use(scope: (program: ShaderProgram<TVert, TFrag>) => void): void {
    this.#gl.useProgram(this.#program);
    scope(this);
    this.#gl.useProgram(null);
  }
}

export class InstanceBuffer<TVertParams extends ShaderSource, T> {
  #buffer: WebGLBuffer | null;
  #gl: WebGL2RenderingContext;
  #instanceSize: number;
  #instanceCount: number;
  #attributeLayouts: Array<{
    col: number;
    row: number;
    size: number;
    name: keyof TVertParams["inAttributes"];
    load: (buffer: Float32Array, offset: number, instance: T) => void;
  }> = [];

  constructor(
    gl: WebGL2RenderingContext,
    program: ShaderProgram<TVertParams, any>,
    attributes: Partial<{
      [K in keyof TVertParams["inAttributes"]]: (
        instance: T
      ) => TypeMap[TVertParams["inAttributes"][K]["type"]];
    }>
  ) {
    this.#gl = gl;
    this.#buffer = this.#gl.createBuffer()!;
    this.#instanceCount = 0;
    this.#instanceSize = 0;
    this.#attributeLayouts = [];

    for (let [attr, loader] of Object.entries(attributes)) {
      const attributeType = program.inAttributes[attr].type;
      if (attributeType === "float") {
        this.#attributeLayouts.push({
          col: 1,
          row: 1,
          size: 1,
          name: attr,
          load: (b, o, i) => {
            b[o] = loader(i) as number;
          },
        });
      } else {
        const partialLayout: {
          name: keyof TVertParams["inAttributes"];
          load: (buffer: Float32Array, offset: number, instance: T) => void;
        } = {
          name: attr,
          load: (b, o, i) => b.set(loader(i) as Float32Array, o),
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
    this.#gl.bindBuffer(this.#gl.ARRAY_BUFFER, this.#buffer);
    this.#gl.bufferData(this.#gl.ARRAY_BUFFER, b, this.#gl.STREAM_DRAW);
    this.#gl.bindBuffer(this.#gl.ARRAY_BUFFER, null);
    return this;
  }

  getInstanceCount(): number {
    return this.#instanceCount;
  }

  getAttributesHash(program: ShaderProgram<TVertParams, any>): string {
    return this.#attributeLayouts
      .map((a) => program.inAttributes[a.name].location)
      .join("-");
  }

  bind(
    program: ShaderProgram<TVertParams, any>
  ): InstanceBuffer<TVertParams, T> {
    this.#gl.bindBuffer(this.#gl.ARRAY_BUFFER, this.#buffer);

    let offset = 0;
    for (let i = 0; i < this.#attributeLayouts.length; ++i) {
      const attrPtr =
        program.inAttributes[this.#attributeLayouts[i].name].location;
      for (let col = 0; col < this.#attributeLayouts[i].col; ++col) {
        this.#gl.enableVertexAttribArray(attrPtr + col);
        this.#gl.vertexAttribPointer(
          attrPtr + col,
          this.#attributeLayouts[i].row,
          this.#gl.FLOAT,
          false,
          this.#instanceSize * 4,
          offset
        );
        this.#gl.vertexAttribDivisor(attrPtr + col, 1);
        offset += this.#attributeLayouts[i].row * 4;
      }
    }
    return this;
  }
}

export class FrameBuffer<TFrag extends ShaderSource> {
  #gl: WebGL2RenderingContext;
  #frameBuffer: WebGLFramebuffer;

  constructor(
    gl: WebGL2RenderingContext,
    program: ShaderProgram<any, TFrag>,
    attachments: { [K in keyof TFrag["outAttributes"]]: WebGLTexture }
  ) {
    this.#gl = gl;
    this.#frameBuffer = this.#gl.createFramebuffer()!;
    this.#gl.bindFramebuffer(this.#gl.FRAMEBUFFER, this.#frameBuffer);

    const attachmentList: Array<number> = [];
    Object.entries(attachments).forEach(([key, value]) => {
      const location =
        program.outAttributes[key as keyof TFrag["outAttributes"]].location;
      this.#gl.framebufferTexture2D(
        this.#gl.FRAMEBUFFER,
        // @ts-ignore
        this.#gl[`COLOR_ATTACHMENT${location}`] as any,
        this.#gl.TEXTURE_2D,
        value,
        0
      );
      // @ts-ignore
      attachmentList.push(this.#gl[`COLOR_ATTACHMENT${location}`]);
    });
    this.#gl.drawBuffers(attachmentList);
    this.#gl.bindFramebuffer(this.#gl.FRAMEBUFFER, null);
  }

  bind(scope: () => void): void {
    this.#gl.bindFramebuffer(this.#gl.FRAMEBUFFER, this.#frameBuffer);
    scope();
    this.#gl.bindFramebuffer(this.#gl.FRAMEBUFFER, null);
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
