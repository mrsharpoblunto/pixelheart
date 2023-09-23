#version 300 es

precision mediump float;

in vec2 v_texCoord;
in vec3 v_ambient;
in vec3 v_diffuse;
in vec3 v_direction;
in float v_radius;

uniform sampler2D u_albedoTexture;
uniform sampler2D u_normalTexture;
uniform sampler2D u_specularTexture;

const int LIGHTING_MODE_DIRECTIONAL = 0;
const int LIGHTING_MODE_POINT = 1;
const float LIGHT_ATTENUATION_EXP = 2.0;
const float SPECULAR_POWER = 32.0;

//uniform mat3 u_TBN; TODO based on camera & world space normals...
const mat3 TBN = mat3(
  vec3(1.0, 0.0, 1.0),
  vec3(-1.0, 1.0, 0.0),
  vec3(0.0, -1.0, 1.0)
);
const vec3 T_VIEW_DIRECTION = normalize(vec3(0.0, -1.0, 0.0)) * TBN;


uniform int u_lightingMode;

layout(location = 0) out vec4 o_lighting;

void main() {
  vec3 tNormal = normalize(texture(u_normalTexture, v_texCoord).rgb * 2.0 - 1.0);
  vec3 albedo = texture(u_albedoTexture, v_texCoord).rgb;
  vec3 specular = texture(u_specularTexture, v_texCoord).rgb;

  vec3 ambient = v_ambient * albedo;

  vec3 lightDirection = u_lightingMode == LIGHTING_MODE_DIRECTIONAL 
    ? v_direction 
    // in point light mode v_direction is actually a position
    : v_direction - vec3(gl_FragCoord.x, 0.0, gl_FragCoord.y);
  float intensity = u_lightingMode == LIGHTING_MODE_DIRECTIONAL 
    ? 1.0 
    : pow(1.0 - length(lightDirection) / v_radius, LIGHT_ATTENUATION_EXP);
  vec3 tLightDirection = normalize(lightDirection) * TBN;

  // make sure the light direction is in the same tangent space as the normal
  float diffuse = max(dot(tNormal, tLightDirection), 0.0);
  vec3 diffuseColor = albedo * v_diffuse * diffuse * intensity;

  vec3 tHalfDirection = normalize(tLightDirection + T_VIEW_DIRECTION);
  float specularAngle = max(dot(tNormal, tHalfDirection), 0.0);
  float specularIntensity = pow(specularAngle, SPECULAR_POWER);
  vec3 specularColor = v_diffuse * specularIntensity * specular * intensity;

  o_lighting = vec4(ambient + diffuseColor + specularColor, 1.0);
}
