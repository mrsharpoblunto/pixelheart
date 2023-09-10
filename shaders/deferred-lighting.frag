#version 300 es

precision mediump float;

in vec2 v_texCoord;

uniform sampler2D u_albedoTexture;
uniform sampler2D u_normalTexture;
uniform sampler2D u_specularTexture;

//uniform mat3 u_TBN; TODO based on camera & world space normals...
mat3 TBN = mat3(
  vec3(1.0, 0.0, 1.0),
  vec3(-1.0, 1.0, 0.0),
  vec3(0.0, -1.0, 1.0)
);

layout(location = 0) out vec4 o_lighting;

void main() {
  o_lighting = vec4(1.0,1.0,1.0,1.0);
}
