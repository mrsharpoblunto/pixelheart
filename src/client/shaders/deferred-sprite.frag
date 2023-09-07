#version 300 es

precision mediump float;

in vec2 v_texCoord;

uniform sampler2D u_diffuseTexture;
uniform sampler2D u_normalSpecularTexture;
uniform sampler2D u_emissiveTexture;

//uniform mat3 u_TBN; TODO based on camera & world space normals...
mat3 TBN = mat3(
  vec3(1.0, 0.0, 1.0),
  vec3(-1.0, 1.0, 0.0),
  vec3(0.0, -1.0, 1.0)
);

layout(location = 0) out vec4 o_normal;
layout(location = 1) out vec4 o_albedo;
layout(location = 2) out vec4 o_specular;
layout(location = 3) out vec4 o_lighting;


void main() {
  vec4 albedo = texture(u_diffuseTexture, v_texCoord);
  vec4 normalSpecular = texture(u_normalSpecularTexture, v_texCoord);

  // gbuffers don't support partial transparency, so we clamp to 0/1
  float transparency = albedo.w < 0.99 ? 0.0 : 1.0;

  o_albedo = vec4(albedo.xyz, transparency);
  o_normal = vec4(normalize(TBN * (normalSpecular.xyz * 2.0 - 1.0)) * 0.5 + 0.5, transparency);
  o_specular = vec4(normalSpecular.w, normalSpecular.w, normalSpecular.w, transparency);
  o_lighting = vec4(texture(u_emissiveTexture, v_texCoord).xyz, transparency);
}
