#version 300 es

precision mediump float;

uniform sampler2D u_blur;
uniform vec2 u_blurSize;
uniform vec2 u_blurDirection;
uniform float u_blurStrength;

in vec2 v_texCoord;
out vec4 o_color;

#define KERNEL_SIZE 9
const float KERNEL[KERNEL_SIZE] = float[](
  0.0625,0.0625,0.125,0.125,0.25,0.125,0.125,0.0625,0.0625
);
const int offset = KERNEL_SIZE / 2;

void main() {
  vec4 color = vec4(0.0);
  for (int i = 0;i < KERNEL_SIZE;++i) {
    vec2 pos = v_texCoord + ((vec2(i - offset,i - offset) * u_blurDirection * u_blurStrength) / u_blurSize);
    vec4 s = texture(u_blur, pos);
    color += s * KERNEL[i];
  }
  o_color = color;
}
