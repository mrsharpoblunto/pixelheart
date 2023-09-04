#version 300 es

in vec2 a_position;

in vec4 a_color;
in mat3 a_mvp;

out vec4 v_color;

void main() {
  v_color = a_color;
  vec3 clipPosition = a_mvp * vec3(a_position, 1.0);
  gl_Position = vec4(clipPosition.xy, 0.0, 1.0);
}
