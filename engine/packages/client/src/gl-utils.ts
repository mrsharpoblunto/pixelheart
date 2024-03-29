import {
  ReadonlyMat2,
  ReadonlyMat3,
  ReadonlyMat4,
  ReadonlyVec2,
  ReadonlyVec3,
  ReadonlyVec4,
} from "gl-matrix";

import {
  TEXTURE,
  GPUTexture,
} from "./images.js";

import { GameContext } from "./game.js";

type TypeMap = {
  float: number;
  vec2: ReadonlyVec2;
  vec3: ReadonlyVec3;
  vec4: ReadonlyVec4;
  mat2: ReadonlyMat2;
  mat3: ReadonlyMat3;
  mat4: ReadonlyMat4;
};

type UniformTypeMap = TypeMap & {
  int: number;
  sampler2D: WebGLTexture | GPUTexture;
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
  uniforms: { [name: string]: keyof UniformTypeMap };
}

function getShaderState(): {
  cache: Map<string, string>;
  programs: Map<string, Array<() => void>>;
} | null {
  return process.env.NODE_ENV === "development"
    ? // @ts-ignore
    window.__PIXELHEART_SHADER_STATE__ ||
    // @ts-ignore
    (window.__PIXELHEART_SHADER_STATE__ = {
      cache: new Map(),
      programs: new Map(),
    })
    : null;
}

function registerShader<TVert extends ShaderSource, TFrag extends ShaderSource>(
  vertexShaderSource: TVert,
  fragmentShaderSource: TFrag,
  reload: () => void
) {
  const devShaders = getShaderState()?.programs;
  if (devShaders) {
    const vs = devShaders.get(vertexShaderSource.name);
    if (vs) {
      vs.push(reload);
    } else {
      devShaders.set(vertexShaderSource.name, [reload]);
    }
    const fs = devShaders.get(fragmentShaderSource.name);
    if (fs) {
      fs.push(reload);
    } else {
      devShaders.set(fragmentShaderSource.name, [reload]);
    }
  }
}

export function reloadShader(shader: string, src: string) {
  const state = getShaderState();
  if (state) {
    console.log("reloading shader", shader);
    state.cache.set(shader, src);
    const shaderInstances = state.programs.get(shader);
    if (shaderInstances) {
      for (let reload of shaderInstances) {
        reload();
      }
    }
  }
}

export class ShaderProgram<
  TVert extends ShaderSource,
  TFrag extends ShaderSource
> {
  #gl: WebGL2RenderingContext;
  #program: WebGLProgram;
  #vSource: TVert;
  #fSource: TFrag;

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
    { location: WebGLUniformLocation; type: keyof UniformTypeMap }
  >;

  constructor(
    ctx: WebGL2RenderingContext,
    vertexShaderSource: TVert,
    fragmentShaderSource: TFrag
  ) {
    this.#gl = ctx;
    this.#vSource = vertexShaderSource;
    this.#fSource = fragmentShaderSource;

    this.inAttributes = {} as Record<
      keyof TVert["inAttributes"],
      { location: number; type: keyof TypeMap; layout?: number }
    >;
    this.outAttributes = {} as Record<
      keyof TVert["outAttributes"],
      { location: number; type: keyof TypeMap; layout?: number }
    >;
    this.uniforms = {} as Record<
      keyof TVert["uniforms"],
      { location: WebGLUniformLocation; type: keyof UniformTypeMap }
    >;

    this.#program = this.#createProgram(this.#vSource, this.#fSource);
    this.setAttributesAndUniforms(this.#vSource, this.#fSource);
    registerShader(vertexShaderSource, fragmentShaderSource, () => {
      try {
        this.#program = this.#createProgram(this.#vSource, this.#fSource);
      } catch (e) {
        console.error(e);
        return;
      }
      this.setAttributesAndUniforms(this.#vSource, this.#fSource);
    });
  }

  setAttributesAndUniforms(
    vertexShaderSource: TVert,
    fragmentShaderSource: TFrag
  ) {
    const attributeCount = this.#gl.getProgramParameter(
      this.#program,
      this.#gl.ACTIVE_ATTRIBUTES
    );
    for (let i = 0; i < attributeCount; ++i) {
      const info = this.#gl.getActiveAttrib(this.#program, i);
      if (info) {
        const key = info.name;
        if (key in vertexShaderSource.inAttributes) {
          this.inAttributes[key as unknown as keyof TVert["inAttributes"]] = {
            location: this.#gl.getAttribLocation(this.#program, info.name),
            type: vertexShaderSource.inAttributes[key].type,
          };
        }
      }
    }

    Object.keys(fragmentShaderSource.outAttributes).forEach((key) => {
      const location = this.#gl.getFragDataLocation(this.#program, key);
      this.outAttributes[key as unknown as keyof TFrag["outAttributes"]] = {
        location,
        type: fragmentShaderSource.outAttributes[key].type,
      };
    });

    const uniformCount = this.#gl.getProgramParameter(
      this.#program,
      this.#gl.ACTIVE_UNIFORMS
    );
    for (let i = 0; i < uniformCount; ++i) {
      const info = this.#gl.getActiveUniform(this.#program, i);
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
          ] = {
            location: this.#gl.getUniformLocation(this.#program, info.name)!,
            type: (vertexShaderSource.uniforms[key] ||
              fragmentShaderSource.uniforms[key]) as keyof UniformTypeMap,
          };
        }
      }
    }

    if (process.env.NODE_ENV !== "production") {
      for (let key in vertexShaderSource.uniforms) {
        if (!this.uniforms[key]) {
          console.warn(
            `Unused uniform ${key} in vertex shader ${vertexShaderSource.name}`
          );
        }
      }
      for (let key in fragmentShaderSource.uniforms) {
        if (!this.uniforms[key]) {
          console.warn(
            `Unused uniform ${key} in vertex shader ${vertexShaderSource.name}`
          );
        }
      }
    }
  }

  #createProgram(vertexShaderSource: TVert, fragmentShaderSource: TFrag) {
    const program = this.#gl.createProgram()!;

    const vertexShader = this.#gl.createShader(this.#gl.VERTEX_SHADER)!;
    const vertexShaderSourceContent =
      getShaderState()?.cache?.get(vertexShaderSource.name) ||
      vertexShaderSource.src;
    this.#gl.shaderSource(vertexShader, vertexShaderSourceContent);
    this.#gl.compileShader(vertexShader);

    let output = "";

    if (!this.#gl.getShaderParameter(vertexShader, this.#gl.COMPILE_STATUS)) {
      let error = this.#gl.getShaderInfoLog(vertexShader);
      if (error) {
        if (process.env.NODE_ENV !== "production") {
          output += decorateError(
            `\nVertex Shader: ${vertexShaderSource.name}`,
            vertexShaderSourceContent,
            error
          );
        } else {
          output += error + "\n";
        }
      }
    }

    const fragmentShader = this.#gl.createShader(this.#gl.FRAGMENT_SHADER)!;
    const fragmentShaderSourceContent =
      getShaderState()?.cache?.get(fragmentShaderSource.name) ||
      fragmentShaderSource.src;
    this.#gl.shaderSource(fragmentShader, fragmentShaderSourceContent);
    this.#gl.compileShader(fragmentShader);
    if (!this.#gl.getShaderParameter(fragmentShader, this.#gl.COMPILE_STATUS)) {
      let error = this.#gl.getShaderInfoLog(fragmentShader);
      if (error) {
        if (process.env.NODE_ENV !== "production") {
          output += decorateError(
            `\nFragment Shader: ${fragmentShaderSource.name}`,
            fragmentShaderSourceContent,
            error
          );
        } else {
          output += error + "\n";
        }
      }
    }

    this.#gl.attachShader(program, vertexShader);
    this.#gl.attachShader(program, fragmentShader);
    if (output === "") {
      this.#gl.linkProgram(program);
      if (!this.#gl.getProgramParameter(program, this.#gl.LINK_STATUS)) {
        const error = this.#gl.getProgramInfoLog(program);
        if (error) {
          output += `\nLinker: (${vertexShaderSource.name}, ${fragmentShaderSource.name}): ${error}`;
        }
      }
    }

    if (output !== "") {
      throw new Error(
        `Shader compilation of [${vertexShaderSource.name}, ${fragmentShaderSource.name}] failed:\n${output}`
      );
    }

    return program;
  }

  use(scope: (program: ShaderProgram<TVert, TFrag>) => void): void {
    this.#gl.useProgram(this.#program);
    scope(this);
    this.#gl.useProgram(null);
  }

  setUniforms(
    uniforms: Partial<{
      [K in keyof (TVert["uniforms"] &
        TFrag["uniforms"])]: UniformTypeMap[(TVert["uniforms"] &
          TFrag["uniforms"])[K]];
    }>
  ): ShaderProgram<TVert, TFrag> {
    let index = 0;
    for (let u in uniforms) {
      const value = uniforms[u] as any;
      const metadata = this.uniforms[u as keyof typeof uniforms];
      if (!metadata) {
        // if a uniform isn't being used in the shader, it'll get
        // optimized out, so there won't be any runtime metadata
        // for it. we can safely ignore it.
        continue;
      } else if (metadata.type === "sampler2D") {
        // @ts-ignore
        this.#gl.activeTexture(this.#gl[`TEXTURE${index}`]);
        this.#gl.bindTexture(
          this.#gl.TEXTURE_2D,
          ((value && TEXTURE in value) ? value[TEXTURE] : value) as WebGLTexture
        );
        this.#gl.uniform1i(metadata.location, index++);
      } else if (metadata.type === "float") {
        this.#gl.uniform1f(metadata.location, value);
      } else if (metadata.type === "vec2") {
        this.#gl.uniform2fv(metadata.location, value);
      } else if (metadata.type === "vec3") {
        this.#gl.uniform3fv(metadata.location, value);
      } else if (metadata.type === "vec4") {
        this.#gl.uniform4fv(metadata.location, value);
      } else if (metadata.type === "mat2") {
        this.#gl.uniformMatrix2fv(metadata.location, false, value);
      } else if (metadata.type === "mat3") {
        this.#gl.uniformMatrix3fv(metadata.location, false, value);
      } else if (metadata.type === "mat4") {
        this.#gl.uniformMatrix4fv(metadata.location, false, value);
      } else if (metadata.type === "int") {
        this.#gl.uniform1i(metadata.location, value);
      }
    }
    return this;
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

type TextureFormat = {
  internalFormat: number,
  format: number,
  type: number,
  opts?: {
    filter?: number;
    wrap?: number;
    mipmap?: boolean;
  }
};

export class GBuffer<TTextures extends string> {
  #formats: Record<TTextures, TextureFormat>;
  textures: Record<TTextures, GPUTexture> | null;
  width: number;
  height: number;
  #gl: WebGL2RenderingContext;

  constructor(gl: WebGL2RenderingContext, textures: Record<TTextures, TextureFormat>) {
    this.#gl = gl;
    this.#formats = textures;
    this.textures = null;
    this.width = 0;
    this.height = 0;
  }

  use(opts: {
    width: number,
    height: number,
  },
    resizeScope: (textures: Record<TTextures, GPUTexture>) => void,
  ): Record<TTextures, GPUTexture> {
    if (!this.textures ||
      opts.width !== this.width ||
      opts.height !== this.height
    ) {
      this.textures = Object.keys(this.#formats).reduce((t, key) => {
        const format = this.#formats[key as TTextures];
        t[key as TTextures] = {
          [TEXTURE]: createTexture(
            this.#gl,
            format.internalFormat,
            format.format,
            format.type,
            opts.width,
            opts.height,
            format.opts
          ),
          width: opts.width,
          height: opts.height,
        };
        return t;
      }, {} as Record<TTextures, GPUTexture>);
      this.height = opts.height;
      this.width = opts.width;
      resizeScope(this.textures);
    }
    return this.textures;
  }
}


export class FrameBuffer<TFrag extends {
  outAttributes: Record<string, { location?: number; type: keyof TypeMap }>
}> {
  #gl: WebGL2RenderingContext;
  #frameBuffer: WebGLFramebuffer;
  static #activeStack: Array<WebGLFramebuffer> = [];

  constructor(
    gl: WebGL2RenderingContext,
    program: {
      outAttributes: Record<
        keyof TFrag["outAttributes"],
        { location: number; type: keyof TypeMap }
      >;
    },
    attachments: { [K in keyof TFrag["outAttributes"]]: WebGLTexture | GPUTexture | null }
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
        (value && TEXTURE in value) ? value[TEXTURE] : value,
        0
      );
      // @ts-ignore
      attachmentList.push(this.#gl[`COLOR_ATTACHMENT${location}`]);
    });
    this.#gl.drawBuffers(attachmentList.sort((a, b) => a - b));
    this.#gl.bindFramebuffer(this.#gl.FRAMEBUFFER, null);
  }

  bind(scope: () => void): void {
    FrameBuffer.#activeStack.push(this.#frameBuffer);
    this.#gl.bindFramebuffer(this.#gl.FRAMEBUFFER, this.#frameBuffer);
    scope();
    FrameBuffer.#activeStack.pop();
    if (FrameBuffer.#activeStack.length) {
      this.#gl.bindFramebuffer(
        this.#gl.FRAMEBUFFER,
        FrameBuffer.#activeStack[FrameBuffer.#activeStack.length - 1]
      );
    } else {
      this.#gl.bindFramebuffer(this.#gl.FRAMEBUFFER, null);
    }
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
