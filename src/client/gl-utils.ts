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

export interface WebGLShaderParameters {
  attributes: { [name: string]: keyof TypeMap };
  uniforms: { [name: string]: string };
}

export interface WebGLShaderSource extends WebGLShaderParameters {
  src: string;
  name: string;
  path: string;
}

export interface CompiledWebGLProgram<
  TVertParams extends WebGLShaderParameters,
  TFragParams extends WebGLShaderParameters
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
  TVert extends WebGLShaderSource,
  TFrag extends WebGLShaderSource
>(
  gl: WebGL2RenderingContext,
  vertexShaderSource: TVert,
  fragmentShaderSource: TFrag
): CompiledWebGLProgram<TVert, TFrag> | null {
  const vertexShader = gl.createShader(gl.VERTEX_SHADER)!;
  gl.shaderSource(vertexShader, vertexShaderSource.src);
  gl.compileShader(vertexShader);

  let output = "";

  if (!gl.getShaderParameter(vertexShader, gl.COMPILE_STATUS)) {
    let error = gl.getShaderInfoLog(vertexShader);
    if (error) {
      if (process.env.NODE_ENV !== "production") {
        output += decorateError(
          `\nVertex Shader: ${vertexShaderSource.path}`,
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
          `\nFragment Shader: ${fragmentShaderSource.path}`,
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

  return compiled as CompiledWebGLProgram<TVert, TFrag>;
}

type ValidLoaders<TVertParams extends WebGLShaderParameters, TInstance> = {
  [K in keyof TVertParams["attributes"]]: [
    K,
    (instance: TInstance) => TypeMap[TVertParams["attributes"][K]]
  ];
}[keyof TVertParams["attributes"]];

export function bindInstanceBuffer<
  TVertParams extends WebGLShaderParameters,
  TFragParams extends WebGLShaderParameters,
  T
>(
  gl: WebGL2RenderingContext,
  program: CompiledWebGLProgram<TVertParams, TFragParams>,
  instances: Array<T>,
  attributes: Array<ValidLoaders<TVertParams, T>>
) {
  const instanceBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuffer);

  // get the instance size and its layout from the
  // first instance in the array
  let instanceSize = 0;
  let fieldLayouts: Array<{
    col: number;
    row: number;
    size: number;
    name: keyof TVertParams["attributes"];
    load: (buffer: Float32Array, offset: number, instance: T) => void;
  }> = [];
  for (let attr of attributes) {
    const field = program.attributeTypes[attr[0] as string];
    if (field === "float") {
      fieldLayouts.push({
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
      switch (field) {
        case "vec2":
          fieldLayouts.push({
            col: 1,
            row: 2,
            size: 2,
            ...partialLayout,
          });
          break;
        case "vec3":
          fieldLayouts.push({
            col: 1,
            row: 3,
            size: 3,
            ...partialLayout,
          });
          break;
        case "vec4":
          fieldLayouts.push({
            col: 1,
            row: 4,
            size: 4,
            ...partialLayout,
          });
          break;
        case "mat2":
          fieldLayouts.push({ col: 2, row: 2, size: 4, ...partialLayout });
          break;
        case "mat3":
          fieldLayouts.push({ col: 3, row: 3, size: 9, ...partialLayout });
          break;
        case "mat4":
          fieldLayouts.push({ col: 4, row: 4, size: 16, ...partialLayout });
          break;
        default:
          throw new Error("Unknown instance buffer field type");
      }
    }
    instanceSize += fieldLayouts[fieldLayouts.length - 1].size;
  }

  // then create the instance buffer and load in the data from each instance
  const b = new Float32Array(instances.length * instanceSize);
  let offset = 0;
  for (let i = 0; i < instances.length; ++i) {
    for (let j = 0; j < fieldLayouts.length; ++j) {
      fieldLayouts[j].load(b, offset, instances[i]);
      offset += fieldLayouts[j].size;
    }
  }
  gl.bufferData(gl.ARRAY_BUFFER, b, gl.STATIC_DRAW);

  // then set up the shader to read from the instance buffer
  offset = 0;
  for (let i = 0; i < fieldLayouts.length; ++i) {
    for (let col = 0; col < fieldLayouts[i].col; ++col) {
      const attrPtr = program.attributes[fieldLayouts[i].name] + col;
      gl.enableVertexAttribArray(attrPtr);
      gl.vertexAttribPointer(
        attrPtr,
        fieldLayouts[i].row,
        gl.FLOAT,
        false,
        instanceSize * 4,
        offset
      );
      gl.vertexAttribDivisor(attrPtr, 1);
      offset += fieldLayouts[i].row * 4;
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
