#version 300 es

precision mediump float;

in vec2 v_texCoord;

uniform sampler2D u_diffuseTexture;
uniform sampler2D u_normalTexture;
uniform sampler2D u_specularTexture;
uniform sampler2D u_emissiveTexture;

layout(location = 0) out vec4 o_normal;
layout(location = 1) out vec4 o_albedo;
layout(location = 2) out vec4 o_specular;
layout(location = 3) out vec4 o_lighting;
layout(location = 4) out vec4 o_mask;


void main() {
  vec4 albedo = texture(u_diffuseTexture, v_texCoord);
  vec3 normal = texture(u_normalTexture, v_texCoord).xyz;
  float specular = texture(u_specularTexture, v_texCoord).x;
  vec3 emissive = texture(u_emissiveTexture, v_texCoord).xyz;

  // gbuffers don't support partial transparency, so we clamp to 0/1
  float transparency = albedo.w < 0.99 ? 0.0 : 1.0;

  o_albedo = vec4(albedo.xyz * transparency, transparency);
  o_mask = o_albedo;
  o_normal = vec4(normal, transparency);
  o_specular = vec4(specular, specular, specular, transparency);
  o_lighting = vec4(emissive, transparency);
}
