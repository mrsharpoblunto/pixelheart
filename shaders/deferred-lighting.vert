#version 300 es

in vec2 a_position;

in mat3 a_mvp;
in vec3 a_ambient;
in vec3 a_diffuse;
in vec3 a_direction;
in float a_radius;

out vec3 v_ambient;
out vec3 v_diffuse;
out vec3 v_direction;
out float v_radius;
out vec2 v_texCoord;

void main() {
  v_texCoord = a_position;
  v_ambient = a_ambient;
  v_diffuse = a_diffuse;
  v_direction = a_direction;
  v_radius = a_radius;


  vec3 clipPosition = a_mvp * vec3(a_position, 1.0);
  gl_Position = vec4(clipPosition.xy, 0.0, 1.0);
}
