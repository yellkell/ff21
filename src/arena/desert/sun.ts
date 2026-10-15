/**
 * THE DYING SUN.
 *
 * It used to be two flat paper discs, one inside the other, and from any
 * distance it read as a fried egg. Now it is ONE clean disc — warm gold at
 * the heart easing to ember at the rim, a shade deeper toward its foot where
 * the air is thick — with a soft corona bleeding off its edge. Nothing else:
 * no bars, no ripples. (A first pass had cloud bars across it and a boiling
 * lower limb; it was too busy for this world, and the bars read as brown
 * scratches.)
 *
 * One quad, one fragment shader, drawn just inside the sky dome. The wide
 * glow AROUND it is not here: that belongs to the sky, which knows where the
 * sun is (makeSkyDome in index.ts), so the light falls off into the band
 * instead of stopping at the edge of a sprite. No textures, nothing per frame.
 */

import { Color, Mesh, PlaneGeometry, ShaderMaterial, type Vector3 } from 'three';
import { CONFIG } from './config.js';

/** How far out the quad reaches, in sun radii — room for the corona. */
const REACH = 4.2;

export interface Sun {
  mesh: Mesh;
}

export function makeSun(sunDir: Vector3, radius = 42, distance = 600): Sun {
  const mat = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    fog: false,
    uniforms: {
      heart: { value: new Color('#ffe9a8') }, // the white-hot middle
      body: { value: new Color(CONFIG.palette.sun).lerp(new Color('#ffb02e'), 0.6) },
      limb: { value: new Color('#ff3a10') }, // the ember rim
      air: { value: new Color(CONFIG.sky.horizon) }, // what the corona fades into
    },
    vertexShader: /* glsl */ `
      varying vec2 vP;
      void main() {
        vP = position.xy / ${radius.toFixed(1)}; // in sun radii: the limb is at length 1
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 heart, body, limb, air;
      varying vec2 vP;
      void main() {
        // Squashed a touch flat, the way refraction flattens a sun on the horizon.
        vec2 p = vec2(vP.x, vP.y * 1.05);
        float r = length(p);
        // Gold at the heart easing to ember at the rim…
        float mu = sqrt(max(0.0, 1.0 - r * r));
        vec3 c = mix(limb, body, smoothstep(0.0, 0.5, mu));
        c = mix(c, heart, pow(mu, 2.0) * 0.75);
        // …and a shade deeper toward the foot, where the air is thick.
        c = mix(c, limb, smoothstep(0.4, -1.0, p.y) * 0.35);
        // The palette is written in display colour and this shader (like the dome's) writes straight
        // to the screen; three hands the uniforms over in LINEAR, so bring the disc back up.
        c = pow(c, vec3(1.0 / 1.7));
        float disc = 1.0 - smoothstep(0.985, 1.012, r);

        // THE CORONA — tight and hot against the limb, long and faint beyond it, wider than tall.
        float d = max(0.0, length(vec2(vP.x * 0.86, vP.y * 1.18)) - 1.0);
        float glow = 0.62 * exp(-d * 5.5) + 0.26 * exp(-d * 1.35);
        glow *= 1.0 - smoothstep(${(REACH - 1.4).toFixed(1)}, ${(REACH - 1.0).toFixed(1)}, d + 1.0); // gone before the quad's edge
        vec3 halo = mix(air * 1.25, pow(body, vec3(1.0 / 2.2)), exp(-d * 4.0));

        vec3 outC = mix(halo, c, disc);
        float a = max(disc, glow);
        gl_FragColor = vec4(outC, a);
      }
    `,
  });
  const mesh = new Mesh(new PlaneGeometry(radius * 2 * REACH, radius * 2 * REACH), mat);
  mesh.name = 'desert-sun';
  mesh.position.copy(sunDir).multiplyScalar(distance);
  mesh.lookAt(0, mesh.position.y, 0);
  mesh.renderOrder = -0.5; // after the dome, before the world: mesas and cloud stand in front of it
  mesh.frustumCulled = false;
  return { mesh };
}
