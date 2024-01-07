#version 300 es

precision mediump float;

uniform vec2 u_border;

in vec2 v_localPosition;
in vec4 v_bounds;
in vec4 v_fillColor;
in vec4 v_borderColor;

out vec4 outColor;

void main() {
  vec2 p = v_localPosition;
  if(p.x < v_bounds.w + u_border.x || p.y < v_bounds.x + u_border.y || 
     p.x > v_bounds.y - u_border.x || p.y > v_bounds.z - u_border.y) {
    outColor = v_borderColor;
  } else {
    outColor = v_fillColor;
  }
}
