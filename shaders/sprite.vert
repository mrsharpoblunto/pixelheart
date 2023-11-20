#version 300 es

in vec2 a_position;

in mat3 a_uv;
in mat3 a_mvp;
in float a_alpha;

out vec2 v_texCoord;
out float v_alpha;

void main() {
  vec3 uvPosition = a_uv * vec3(a_position, 1.0);
  vec3 clipPosition = a_mvp * vec3(a_position, 1.0);

  v_alpha = a_alpha;
  v_texCoord = uvPosition.xy;
  gl_Position = vec4(clipPosition.xy, 0.0, 1.0);
}
