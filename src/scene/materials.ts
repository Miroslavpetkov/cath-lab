import * as THREE from 'three';

/** Multiplicative X-ray blending: framebuffer × transmittance. No depth test, order independent. */
const xrayBlend = {
  transparent: true,
  depthTest: false,
  depthWrite: false,
  blending: THREE.CustomBlending,
  blendEquation: THREE.AddEquation,
  blendSrc: THREE.ZeroFactor,
  blendDst: THREE.SrcColorFactor,
} as const;

const thicknessVS = /* glsl */ `
varying float vNz;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vec3 n = normalize(normalMatrix * normal);
  vec3 v = normalize(-mv.xyz);
  vNz = abs(dot(n, v));
  gl_Position = projectionMatrix * mv;
}`;

/** Attenuation that grows with path length through the object (approximated by |n·v|). */
export function xrayMaterial(k: number, base = 0, exponent = 0.7): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    ...xrayBlend,
    uniforms: { uK: { value: k }, uBase: { value: base }, uExp: { value: exponent } },
    vertexShader: thicknessVS,
    fragmentShader: /* glsl */ `
      uniform float uK; uniform float uBase; uniform float uExp;
      varying float vNz;
      void main() {
        float a = clamp(uBase + uK * pow(vNz, uExp), 0.0, 0.95);
        gl_FragColor = vec4(vec3(1.0 - a), 1.0);
      }`,
  });
}

/**
 * Contrast-filled vessel: dye appears between the arrival front and the washout tail;
 * its darkness depends on local lumen diameter, so a stenosis looks thin and faint.
 */
export function contrastMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    ...xrayBlend,
    uniforms: {
      uTime: { value: 0 },
      uActive: { value: 0 },
      uWash: { value: 2 },
      uDensity: { value: 1 },
    },
    vertexShader: /* glsl */ `
      attribute float aArrive; attribute float aDiam; attribute float aFlow;
      varying float vNz; varying float vArrive; varying float vDiam; varying float vFlow;
      void main() {
        vArrive = aArrive; vDiam = aDiam; vFlow = aFlow;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vec3 n = normalize(normalMatrix * normal);
        vNz = abs(dot(n, normalize(-mv.xyz)));
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime; uniform float uActive; uniform float uWash; uniform float uDensity;
      varying float vNz; varying float vArrive; varying float vDiam; varying float vFlow;
      void main() {
        float dye = 0.0;
        if (uActive > 0.5 && vArrive < 1000.0) {
          float wash = uWash / max(vFlow, 0.3);
          float front = smoothstep(vArrive - 0.04, vArrive + 0.1, uTime);
          float tail = 1.0 - smoothstep(vArrive + wash, vArrive + wash + 0.9, uTime);
          dye = front * tail * uDensity;
        }
        float thick = pow(vNz, 0.6);
        float a = dye * (0.12 + 0.72 * clamp(vDiam / 3.6, 0.0, 1.0)) * thick + 0.015 * thick;
        gl_FragColor = vec4(vec3(1.0 - clamp(a, 0.0, 0.9)), 1.0);
      }`,
  });
}

/** Full-screen fluoroscopy post-process: pulsed frames, quantum noise, blur, collimation, vignette. */
export function fluoroPostMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    depthTest: false,
    depthWrite: false,
    uniforms: {
      tImage: { value: null },
      uHas: { value: 0 },
      uSeed: { value: 0 },
      uNoise: { value: 0.07 },
      uBlur: { value: 1 },
      uAspect: { value: 1 },
      uCollim: { value: 0.9 },
      uVignette: { value: 0.55 },
      uTexel: { value: 1 / 512 },
    },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D tImage; uniform float uHas; uniform float uSeed; uniform float uNoise;
      uniform float uBlur; uniform float uAspect; uniform float uCollim; uniform float uVignette; uniform float uTexel;
      varying vec2 vUv;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233)) + uSeed) * 43758.5453); }
      void main(){
        // Square image centred in the viewport.
        vec2 p = vUv * 2.0 - 1.0;
        if (uAspect > 1.0) p.x *= uAspect; else p.y /= uAspect;
        p /= 0.96;
        vec2 uv = p * 0.5 + 0.5;
        if (abs(p.x) > 1.0 || abs(p.y) > 1.0) { gl_FragColor = vec4(0.02, 0.02, 0.025, 1.0); return; }
        if (uHas < 0.5) { gl_FragColor = vec4(vec3(0.05), 1.0); return; }
        float d = uTexel * uBlur;
        vec3 c = texture2D(tImage, uv).rgb * 0.4
          + texture2D(tImage, uv + vec2(d, 0.0)).rgb * 0.15 + texture2D(tImage, uv - vec2(d, 0.0)).rgb * 0.15
          + texture2D(tImage, uv + vec2(0.0, d)).rgb * 0.15 + texture2D(tImage, uv - vec2(0.0, d)).rgb * 0.15;
        float g = dot(c, vec3(0.333));
        g = pow(g, 1.25);
        g += (hash(floor(uv * 512.0)) - 0.5) * uNoise;
        float r = length(p);
        g *= 1.0 - uVignette * smoothstep(0.55, 1.45, r);
        // Square collimation shutters.
        float sh = step(uCollim, max(abs(p.x), abs(p.y)));
        g = mix(g, g * 0.18, sh);
        gl_FragColor = vec4(vec3(g * 0.98, g, g * 1.02), 1.0);
      }`,
  });
}
