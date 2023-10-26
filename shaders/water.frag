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
uniform float u_time;
uniform vec2 u_offset;

const float pi = acos(-1.);
const vec2 c = vec2(1.,0.);
const int nwaves = 12;
const float MAX_TIME = 1000.0;// TODO define this somewhere else

float rand(vec2 a0)
{
    return fract(sin(dot(a0.xy ,vec2(12.9898,78.233)))*43758.5453);
}

void wave(in int i, out float st, out float am, out vec2 di, out float fr, out float sp)
{
    //setup wave params
	st = abs(0.05*rand(vec2(i,i)));//qi
	am = .02+.01*rand(vec2(float(i+5)));//ai
  di = (vec2(1.e0*rand(vec2(i,i+1)), 1.e0*rand(vec2(i-2,i+2))));//di
  fr = 30.+82.*rand(vec2(float(i+5)));//wi
  sp = (25.e-1+42.e-1*rand(vec2(float(i+4)))) * 0.00045;//phi
}

float maxRound(float v) {
  return round(v * MAX_TIME) / MAX_TIME;
}

void gerst(in vec2 xy, in float depth, in float t, out vec3 val, out vec3 deriv)
{
    val = vec3(xy, 0.);
    deriv = c.yyy;
    
   	float st,fr,sp,am;
    vec2 di;
    
    for(int i=0; i<nwaves; ++i)
    {
   		wave(i, st, am, di, fr, sp);
      st += depth * 2.0;
      am += depth * 4.0;
        
      //gen values
      float d = dot(di, xy);
      // make sure the value is periodic
      // http://the-witness.net/news/2022/02/a-shader-trick/
      val += vec3(
        st*am*di*cos(fr*d+maxRound(sp)*t*pi*2.0), 
        am*sin(fr*d+maxRound(sp)*t*pi*2.0)
      );
    }

    for(int i=0; i<nwaves; ++i)
    {
      wave(i, st, am, di, fr, sp);
      
      //gen derivatives
      deriv += vec3(
          -di*fr*am*cos(fr*dot(di,val.xy)+maxRound(sp)*t*pi*2.0),
          1.-st*fr*am*sin(fr*dot(di,val.xy)+maxRound(sp)*t*pi*2.0)
      );
    }
    
    deriv = normalize(deriv);
}

void main() {
  vec4 mask = texture(u_mask, v_texCoord);
  float depth = smoothstep(0.0,1.0,texture(u_depth, v_texCoord).r * 0.5);
  float transparency = 1.0 - mask.r;

  //raytrace and colorize
	vec3 o = c.yyx, r = 1.*c.xyy, u = 1.*c.yxy+c.yyx, d = normalize(cross(u,r)),
  ro = o+(v_texCoord.x + u_offset.x) *r+(v_texCoord.y - u_offset.y)*u;
    
  vec3 l = (c.yyx-3.*c.yxy),
      p = mat3(c.yxy, c.yyx, 1./d.z, -d.x/d.z, -d.y/d.z)*ro,
      n, val;
        
  gerst(p.xy, depth, u_time, val, n);
    
  vec3 re = normalize(reflect(-l, n)), 
      v = normalize(p-ro);
    
  o_albedo = vec4(50.0/255.0 + depth* 2.0,124.0/255.0 + depth * 2.0,val.z/255.0 + 224.0/255.0 + depth * 2.0, transparency);
  o_normal = vec4(n, transparency);
  o_specular = vec4(1.0, 1.0, 1.0, transparency);
  o_lighting = vec4(0.0,0.0,0.0,0.0);
  o_mask = vec4(0.0,0.0,0.0,0.0);
}
