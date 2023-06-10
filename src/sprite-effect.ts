import { mat3 } from 'gl-matrix';

const vertexShaderSource = `#version 300 es

  in vec2 a_position;

  in mat3 a_uv;
  in mat3 a_mvp;

  out vec2 v_texCoord;

  void main() {
    vec3 uvPosition = a_uv * vec3(a_position, 1.0);
    vec3 clipPosition = a_mvp * vec3(a_position, 1.0);

    v_texCoord = uvPosition.xy;
    gl_Position = vec4(clipPosition.xy, 0.0, 1.0);
  }
`;

const fragmentShaderSource = `#version 300 es

  precision mediump float;

  in vec2 v_texCoord;

  uniform sampler2D u_texture;

  out vec4 outColor;

  void main() {
    outColor = texture(u_texture, v_texCoord);
  }
`;

export interface Rect {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

export default class SpriteEffect {
  _gl: WebGL2RenderingContext;
  _program: WebGLProgram;
  _a_position: number;
  _u_texture: WebGLUniformLocation;
  _a_uv: number;
  _a_mvp: number;
  _textureHeight: number;
  _textureWidth: number;
  _vertexBuffer: WebGLBuffer;
  _vp: mat3;
  _pending: Array<{ mvp: mat3, uv: mat3 }>;

  constructor(gl: WebGL2RenderingContext) {
    this._gl = gl;

    const vertexShader = this._gl.createShader(this._gl.VERTEX_SHADER)!;
    this._gl.shaderSource(vertexShader, vertexShaderSource);
    this._gl.compileShader(vertexShader);

    const fragmentShader = this._gl.createShader(this._gl.FRAGMENT_SHADER)!;
    this._gl.shaderSource(fragmentShader, fragmentShaderSource);
    this._gl.compileShader(fragmentShader);

    this._program = this._gl.createProgram()!;
    this._gl.attachShader(this._program, vertexShader);
    this._gl.attachShader(this._program, fragmentShader);
    this._gl.linkProgram(this._program);
    if (!this._gl.getProgramParameter(this._program, this._gl.LINK_STATUS)) {
      console.log(this._gl.getShaderInfoLog(vertexShader));
      console.log(this._gl.getShaderInfoLog(fragmentShader));
    }

    this._a_position = this._gl.getAttribLocation(this._program, "a_position");
    this._u_texture = gl.getUniformLocation(this._program, "u_texture")!;
    this._a_uv = gl.getAttribLocation(this._program, "a_uv")!;
    this._a_mvp = gl.getAttribLocation(this._program, "a_mvp")!;

    this._textureWidth = 0;
    this._textureHeight = 0;

    const vertices = new Float32Array([
      0, 0,
      1, 0,
      0, 1,
      1, 1,
    ]);
    this._vertexBuffer = this._gl.createBuffer()!;
    this._gl.bindBuffer(this._gl.ARRAY_BUFFER, this._vertexBuffer);
    this._gl.bufferData(this._gl.ARRAY_BUFFER, vertices, this._gl.STATIC_DRAW);

    this._vp = mat3.create();
    mat3.scale(this._vp, this._vp, [1.0,-1.0]);
    mat3.translate(this._vp, this._vp, [-1.0,-1.0]);
    mat3.scale(this._vp,this._vp, [2.0, 2.0]);

    this._pending = [];
  }

  bind(): SpriteEffect {
    this._gl.useProgram(this._program);
    this._gl.texParameteri(this._gl.TEXTURE_2D, this._gl.TEXTURE_MAG_FILTER, this._gl.NEAREST);
    this._gl.texParameteri(this._gl.TEXTURE_2D, this._gl.TEXTURE_MIN_FILTER, this._gl.NEAREST);
    this._gl.texParameteri(this._gl.TEXTURE_2D, this._gl.TEXTURE_BASE_LEVEL, 0);
    this._gl.texParameteri(this._gl.TEXTURE_2D, this._gl.TEXTURE_MAX_LEVEL, 2);
    return this;
  }

  setTexture(texture: WebGLTexture, width: number, height: number): SpriteEffect {
    this._textureWidth = width;
    this._textureHeight = height;
    // Bind the texture to texture unit 0
    this._gl.activeTexture(this._gl.TEXTURE0);
    this._gl.bindTexture(this._gl.TEXTURE_2D, texture);
    this._gl.uniform1i(this._u_texture, 0);
    return this;
  }

  draw(position: Rect, textureCoords: Rect): SpriteEffect {
    const mvp = mat3.create();
    mat3.translate(mvp, mvp, [position.left, position.top]);
    mat3.scale(mvp,mvp, [position.right - position.left, position.bottom - position.top]);
    mat3.multiply(mvp, this._vp, mvp);

    const uv = mat3.create();
    mat3.translate(uv, uv, [textureCoords.left / this._textureWidth, textureCoords.top / this._textureHeight]);
    mat3.scale(uv, uv, [(textureCoords.right - textureCoords.left) / this._textureWidth, (textureCoords.bottom - textureCoords.top) / this._textureHeight]);

    this._pending.push({mvp, uv});
    return this;
  }

  end() {
    const mvpBuffer = new Float32Array(this._pending.length * 9);
    for (let i = 0;i < this._pending.length;++i) {
      mvpBuffer.set(this._pending[i].mvp, i * 9);
    }
    const positionInstanceBuffer = this._gl.createBuffer();
    this._gl.bindBuffer(this._gl.ARRAY_BUFFER, positionInstanceBuffer);
    this._gl.bufferData(this._gl.ARRAY_BUFFER, mvpBuffer, this._gl.STATIC_DRAW);

    this._gl.enableVertexAttribArray(this._a_mvp);
    this._gl.vertexAttribPointer(this._a_mvp, 3, this._gl.FLOAT, false, 9 * 4, 0 * 3 * 4);
    this._gl.vertexAttribDivisor(this._a_mvp, 1);
    this._gl.enableVertexAttribArray(this._a_mvp + 1);
    this._gl.vertexAttribPointer(this._a_mvp + 1, 3, this._gl.FLOAT, false, 9 * 4, 1 * 3 * 4);
    this._gl.vertexAttribDivisor(this._a_mvp + 1, 1);
    this._gl.enableVertexAttribArray(this._a_mvp + 2);
    this._gl.vertexAttribPointer(this._a_mvp + 2, 3, this._gl.FLOAT, false, 9 * 4, 2 * 3 * 4);
    this._gl.vertexAttribDivisor(this._a_mvp + 2, 1);

    const uvBuffer = new Float32Array(this._pending.length * 9);
    for (let i = 0;i < this._pending.length;++i) {
      uvBuffer.set(this._pending[i].uv, i * 9);
    }
    const uvInstanceBuffer = this._gl.createBuffer();
    this._gl.bindBuffer(this._gl.ARRAY_BUFFER, uvInstanceBuffer);
    this._gl.bufferData(this._gl.ARRAY_BUFFER, uvBuffer, this._gl.STATIC_DRAW);

    this._gl.enableVertexAttribArray(this._a_uv);
    this._gl.vertexAttribPointer(this._a_uv, 3, this._gl.FLOAT, false, 9 * 4, 0 * 3 * 4);
    this._gl.vertexAttribDivisor(this._a_uv, 1);
    this._gl.enableVertexAttribArray(this._a_uv + 1);
    this._gl.vertexAttribPointer(this._a_uv + 1, 3, this._gl.FLOAT, false, 9 * 4, 1 * 3 * 4);
    this._gl.vertexAttribDivisor(this._a_uv + 1, 1);
    this._gl.enableVertexAttribArray(this._a_uv + 2);
    this._gl.vertexAttribPointer(this._a_uv + 2, 3, this._gl.FLOAT, false, 9 * 4, 2 * 3 * 4);
    this._gl.vertexAttribDivisor(this._a_uv + 2, 1);


    this._gl.bindBuffer(this._gl.ARRAY_BUFFER, this._vertexBuffer);
    this._gl.enableVertexAttribArray(this._a_position);
    this._gl.vertexAttribPointer(
      this._a_position,
      2,
      this._gl.FLOAT,
      false,
      0,
      0
    );

    this._gl.drawArraysInstanced(this._gl.TRIANGLE_STRIP, 0, 4, this._pending.length);
    this._pending = [];
  }
}
