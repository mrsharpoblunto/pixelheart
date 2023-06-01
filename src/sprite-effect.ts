const vertexShaderSource = `
  attribute vec2 a_position;
  attribute vec2 a_texCoord;

  varying vec2 v_texCoord;

  void main() {
    v_texCoord = a_texCoord;
    gl_Position = vec4(a_position, 0.0, 1.0);
  }
`;

const fragmentShaderSource = `
  precision mediump float;

  varying vec2 v_texCoord;

  uniform sampler2D u_texture;

  void main() {
    gl_FragColor = texture2D(u_texture, v_texCoord);
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
  _a_texcoord: number;
  _u_texture: WebGLUniformLocation;
  _textureHeight: number;
  _textureWidth: number;

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
    this._a_texcoord = this._gl.getAttribLocation(this._program, "a_texCoord");
    this._u_texture = gl.getUniformLocation(this._program, "u_texture")!;

    this._textureWidth = 0;
    this._textureHeight = 0;
  }

  bind(): SpriteEffect {
    this._gl.useProgram(this._program);
    this._gl.enableVertexAttribArray(this._a_position);
    this._gl.enableVertexAttribArray(this._a_texcoord);
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
    const vertices = new Float32Array([
      position.left * 2 - 1.0,
      (1.0 - position.top) * 2 - 1.0,
      (uv.left) / this._textureWidth,
      (uv.top) / this._textureHeight, // bottom left corner
      position.right * 2 - 1.0,
      (1.0 - position.top) * 2 - 1.0,
      (uv.right) / this._textureWidth,
      (uv.top) / this._textureHeight, // bottom right corner
      position.left * 2 - 1.0,
      (1.0 - position.bottom) * 2 - 1.0,
      (uv.left) / this._textureWidth,
      (uv.bottom) / this._textureHeight, // top left corner
      position.right * 2 - 1.0,
      (1.0 - position.bottom) * 2 - 1.0,
      (uv.right) / this._textureWidth,
      (uv.bottom) / this._textureHeight, // top right corner
    ]);

    const vertexBuffer = this._gl.createBuffer()!;
    this._gl.bindBuffer(this._gl.ARRAY_BUFFER, vertexBuffer);
    this._gl.bufferData(this._gl.ARRAY_BUFFER, vertices, this._gl.STATIC_DRAW);

    this._gl.vertexAttribPointer(
      this._a_position,
      2,
      this._gl.FLOAT,
      false,
      16,
      0
    );
    this._gl.vertexAttribPointer(
      this._a_texcoord,
      2,
      this._gl.FLOAT,
      false,
      16,
      8
    );
    this._gl.drawArrays(this._gl.TRIANGLE_STRIP, 0, 4);
    return this;
  }
}
