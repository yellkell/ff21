/**
 * THE FAR VOID — what a headset can't draw live, rendered once in Cycles
 * (blendercyber scripts/v2/raid_sky.py → public/rave/void_sky.ktx2 / .jpg):
 * colossal light monoliths and halo rings receding to the horizon, beams
 * standing up out of a low haze, aurora ribbons overhead, all doubled in a
 * black mirror plain. One sphere, one draw, inside the 160 m far plane.
 *
 * The backdrop is rendered in NEUTRAL light so the game owns its colour:
 * the glow takes the bar's hue (the cool end of the LASER_HUES wheel the
 * rest of the void marches — environment.ts) while the hottest cores stay
 * white, and the whole sky
 * swells on the kick. `energy` arrives pre-ducked, so a telegraph dims the
 * far world with everything else.
 */
import {
  BackSide,
  Color,
  LinearFilter,
  Mesh,
  ShaderMaterial,
  SphereGeometry,
  SRGBColorSpace,
  TextureLoader,
  type Texture,
  type WebGLRenderer,
} from 'three';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';

const RADIUS = 140;

export interface VoidSky {
  mesh: Mesh;
  /** Hue the glow takes (linear colour) and the overall gain. */
  set(hue: Color, gain: number): void;
}

export function buildVoidSky(renderer: WebGLRenderer | null = null): VoidSky {
  const mat = new ShaderMaterial({
    uniforms: {
      uMap: { value: null as Texture | null },
      uHue: { value: new Color(1, 1, 1) },
      uGain: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap;
      uniform vec3 uHue;
      uniform float uGain;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        // Blender's equirect: the image centre looks down three -Z, its left half is -X.
        vec2 uv = vec2(atan(d.x, -d.z) * 0.15915494 + 0.5, asin(clamp(d.y, -1.0, 1.0)) * 0.31830989 + 0.5);
        vec3 c = texture2D(uMap, uv).rgb;
        float l = max(c.r, max(c.g, c.b));
        // Glow takes the hue; the hottest cores burn through to white.
        vec3 tint = mix(uHue * 1.5, vec3(1.0), smoothstep(0.55, 1.0, l));
        // The live floor owns reflections near you: keep only the far sliver
        // of the render's mirror just under the horizon, black below that.
        float below = smoothstep(-0.14, -0.015, d.y);
        gl_FragColor = vec4(c * tint * uGain * below, 1.0);
        #include <colorspace_fragment>
      }`,
    side: BackSide,
    depthWrite: false,
    fog: false,
  });
  const mesh = new Mesh(new SphereGeometry(RADIUS, 64, 32), mat);
  mesh.name = 'void-sky';
  mesh.renderOrder = -1;
  mesh.frustumCulled = false;
  mesh.visible = false; // until the backdrop lands

  const take = (tex: Texture): void => {
    tex.colorSpace = SRGBColorSpace;
    // 4096 px round 360° is ~11 px a degree, always magnified in a headset —
    // so no mips (which would also seam where atan wraps, behind you).
    tex.generateMipmaps = false;
    tex.minFilter = LinearFilter;
    tex.needsUpdate = true;
    mat.uniforms.uMap.value = tex;
    mesh.visible = true;
  };
  const jpg = (): void => {
    new TextureLoader().load('rave/void_sky.jpg', take, undefined, () => {
      /* no backdrop — the void stands as it was */
    });
  };
  if (renderer) {
    new KTX2Loader().setTranscoderPath('basis/').detectSupport(renderer).load('rave/void_sky.ktx2', take, undefined, jpg);
  } else jpg();

  return {
    mesh,
    set(hue, gain) {
      (mat.uniforms.uHue.value as Color).copy(hue);
      mat.uniforms.uGain.value = gain;
    },
  };
}
