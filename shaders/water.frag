#version 300 es

precision mediump float;

layout(location = 0) out vec4 o_normal;
layout(location = 1) out vec4 o_albedo;
layout(location = 2) out vec4 o_specular;
layout(location = 3) out vec4 o_lighting;
layout(location = 4) out vec4 o_mask;

in vec2 v_texCoord;

uniform sampler2D u_mask;
uniform sampler2D u_depth;

void main() {
  vec4 mask = texture(u_mask, v_texCoord);
  float depth = texture(u_depth, v_texCoord).r * 0.5;
  float transparency = 1.0 - mask.r;

  o_albedo = vec4(30.0/255.0 + depth,104.0/255.0 + depth * 2.0,204.0/255.0 + depth, transparency);
  o_normal = vec4(vec3(0.5,0.5,1), transparency);
  o_specular = vec4(1.0, 1.0, 1.0, transparency);
  o_lighting = vec4(0.0,0.0,0.0,0.0);
  o_mask = vec4(0.0,0.0,0.0,0.0);
}
