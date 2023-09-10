#version 300 es

in vec2 a_position;

in mat3 a_uv;
in mat3 a_mvp;
// TODO lighting instance attributes...

out vec2 v_texCoord;

void main() {
  vec3 uvPosition = a_uv * vec3(a_position, 1.0);
  vec3 clipPosition = a_mvp * vec3(a_position, 1.0);

  v_texCoord = uvPosition.xy;
  gl_Position = vec4(clipPosition.xy, 0.0, 1.0);
}
