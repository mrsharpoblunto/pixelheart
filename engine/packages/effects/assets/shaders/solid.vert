#version 300 es

uniform mat3 u_vp;

in vec2 a_position;
in vec4 a_fillColor;
in vec4 a_borderColor;
in mat3 a_m;
in vec4 a_bounds;

out vec2 v_localPosition;
out vec4 v_bounds;
out vec4 v_fillColor;
out vec4 v_borderColor;

void main() {
  vec3 localPosition = a_m * vec3(a_position, 1.0);
  vec3 clipPosition = u_vp * localPosition;

  v_localPosition = localPosition.xy;
  v_bounds = a_bounds;
  v_fillColor = a_fillColor;
  v_borderColor = a_borderColor;
  gl_Position = vec4(clipPosition.xy, 0.0, 1.0);
}
