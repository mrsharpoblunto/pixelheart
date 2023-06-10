import { mat3 } from 'gl-matrix';

const vertexShaderSource = `#version 300 es

  in vec2 a_position;

  uniform mat3 u_spriteTransform;
  uniform mat3 u_mvp;

  out vec2 v_texCoord;

  void main() {
    vec3 uvPosition = u_spriteTransform * vec3(a_position, 1.0);
    vec3 clipPosition = u_mvp * vec3(a_position, 1.0);

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
  _u_spriteTransform: WebGLUniformLocation;
  _u_mvp: WebGLUniformLocation;
  _textureHeight: number;
  _textureWidth: number;
  _vertexBuffer: WebGLBuffer;
  _vp: mat3;

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
    this._u_spriteTransform = gl.getUniformLocation(this._program, "u_spriteTransform")!;
    this._u_mvp = gl.getUniformLocation(this._program, "u_mvp")!;

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
  }

  bind(): SpriteEffect {
    this._gl.useProgram(this._program);
    this._gl.enableVertexAttribArray(this._a_position);
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

  draw(position: Rect, uv: Rect): SpriteEffect {
    const mvp = mat3.create();
    mat3.translate(mvp, mvp, [position.left, position.top]);
    mat3.scale(mvp,mvp, [position.right - position.left, position.bottom - position.top]);
    mat3.multiply(mvp, this._vp, mvp);

    const spriteTransform = mat3.create();
    mat3.translate(spriteTransform, spriteTransform, [uv.left / this._textureWidth, uv.top / this._textureHeight]);
    mat3.scale(spriteTransform, spriteTransform, [(uv.right - uv.left) / this._textureWidth, (uv.bottom - uv.top) / this._textureHeight]);

    this._gl.uniformMatrix3fv(this._u_mvp, false, mvp);
    this._gl.uniformMatrix3fv(this._u_spriteTransform, false, spriteTransform);

    this._gl.bindBuffer(this._gl.ARRAY_BUFFER, this._vertexBuffer);

    this._gl.vertexAttribPointer(
      this._a_position,
      2,
      this._gl.FLOAT,
      false,
      0,
      0
    );
    this._gl.drawArrays(this._gl.TRIANGLE_STRIP, 0, 4);
    return this;
  }
}
