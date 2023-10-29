#version 300 es

precision mediump float;

uniform sampler2D u_blur;
uniform vec2 u_blurSize;
uniform vec2 u_blurDirection;
uniform float u_blurStrength;

in vec2 v_texCoord;
out vec4 o_color;

const int offset = 16;

void main() {
  float c = texture(u_blur, v_texCoord).a;
  vec3 col = vec3(0.0);
  for (int i = 0; i < offset; ++i) {
    vec2 p1 = v_texCoord + ((vec2(-i,-i) * u_blurDirection) / u_blurSize);
    vec4 s1 = texture(u_blur, p1);
    float s1a = s1.a * pow(float(offset - i)/float(offset),u_blurStrength);
    c = max(c, s1a);
    col = length(col) < length(s1.rgb) ? s1.rgb : col;

    vec2 p2 = v_texCoord + ((vec2(i,i) * u_blurDirection) / u_blurSize);
    vec4 s2 = texture(u_blur, p2);
    float s2a = s2.a * pow(float(offset - i)/float(offset),u_blurStrength);
    c = max(c, s2a);
    col = length(col) < length(s2.rgb) ? s2.rgb : col;
  }
  o_color = vec4(col, c);
}
