const vertexShaderSource = `
  attribute vec2 a_position;
  attribute vec2 a_texCoord;

  varying vec2 v_texCoord;

  void main() {
    v_texCoord = a_texCoord;
    v_texCoord.y = 1.0 - v_texCoord.y;
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

const vertices = new Float32Array([
  -1.0, -1.0, 0.0, 0.0, // bottom left corner
  1.0, -1.0, 1.0, 0.0, // bottom right corner
  -1.0, 1.0, 0.0, 1.0, // top left corner
  1.0, 1.0, 1.0, 1.0, // top right corner
]);

export default class SpriteEffect {
  _gl: WebGLRenderingContext;
  _program: WebGLProgram;
  _vertexBuffer: WebGLBuffer;
  _a_position: number;
  _a_texcoord: number;
  _u_texture: WebGLUniformLocation;

  constructor(gl: WebGLRenderingContext) {
    this._gl = gl;

    this._vertexBuffer = gl.createBuffer()!;
    this._gl.bindBuffer(this._gl.ARRAY_BUFFER, this._vertexBuffer);
    this._gl.bufferData(this._gl.ARRAY_BUFFER, vertices, this._gl.STATIC_DRAW);

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

    this._a_position = this._gl.getAttribLocation(this._program, "a_position");
    this._a_texcoord = this._gl.getAttribLocation(this._program, "a_texCoord");
    this._u_texture = gl.getUniformLocation(this._program, "u_texture")!;
  }

  bind(): SpriteEffect {
    this._gl.useProgram(this._program);
    this._gl.bindBuffer(this._gl.ARRAY_BUFFER, this._vertexBuffer);
    this._gl.enableVertexAttribArray(this._a_position);
    this._gl.vertexAttribPointer(this._a_position, 2, this._gl.FLOAT, false, 16, 0);
    this._gl.enableVertexAttribArray(this._a_texcoord);
    this._gl.vertexAttribPointer(this._a_texcoord, 2, this._gl.FLOAT, false, 16, 8);
    return this;
  }

  setTexture(texture: WebGLTexture): SpriteEffect {
    // Bind the texture to texture unit 0
    this._gl.activeTexture(this._gl.TEXTURE0);
    this._gl.bindTexture(this._gl.TEXTURE_2D, texture);
    this._gl.uniform1i(this._u_texture, 0);
    return this;
  }

  draw() {
    this._gl.drawArrays(this._gl.TRIANGLE_STRIP, 0, 4);
  }
}




