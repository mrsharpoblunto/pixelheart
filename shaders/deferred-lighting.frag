#version 300 es

precision mediump float;

in vec2 v_texCoord;
in vec3 v_ambient;
in vec3 v_diffuse;
in vec3 v_direction;
in float v_radius;

uniform vec3 u_viewDirection;
uniform int u_lightingMode;
uniform sampler2D u_albedoTexture;
uniform sampler2D u_normalTexture;
uniform sampler2D u_specularTexture;
uniform mat3 u_toTangentSpace;

const int LIGHTING_MODE_DIRECTIONAL = 0;
const int LIGHTING_MODE_POINT = 1;
const float LIGHT_ATTENUATION_EXP = 2.0;
const float SPECULAR_POWER = 32.0;

layout(location = 0) out vec4 o_lighting;

void main() {
  vec3 tNormal = normalize(texture(u_normalTexture, v_texCoord).rgb * 2.0 - 1.0);
  vec3 albedo = texture(u_albedoTexture, v_texCoord).rgb;
  vec3 specular = texture(u_specularTexture, v_texCoord).rgb;

  vec3 ambient = v_ambient * albedo;

  vec3 lightDirection = u_lightingMode == LIGHTING_MODE_DIRECTIONAL 
    ? v_direction 
    // in point light mode v_direction is actually a position
    : v_direction - vec3(v_texCoord, 0.0);
  float intensity = u_lightingMode == LIGHTING_MODE_DIRECTIONAL 
    ? 1.0 
    : pow(1.0 - length(lightDirection) / v_radius, LIGHT_ATTENUATION_EXP);
  vec3 tLightDirection = normalize(lightDirection * -1.0) * u_toTangentSpace;

  // make sure the light direction is in the same tangent space as the normal
  float diffuse = max(dot(tNormal, tLightDirection), 0.0);
  vec3 diffuseColor = albedo * v_diffuse * diffuse * intensity;

  vec3 tHalfDirection = normalize(tLightDirection + (u_viewDirection * u_toTangentSpace));
  float specularAngle = max(dot(tNormal, tHalfDirection), 0.0);
  float specularIntensity = pow(specularAngle, SPECULAR_POWER);
  vec3 specularColor = v_diffuse * specularIntensity * specular * intensity;

  o_lighting = vec4(ambient + diffuseColor + specularColor, 1.0);
}
