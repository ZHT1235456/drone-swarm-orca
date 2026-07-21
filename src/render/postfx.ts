import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

/** 暗角 + 轻微色调分离,增强电影感 */
const VignetteShader = {
  uniforms: {
    tDiffuse: { value: null },
    strength: { value: 0.42 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float strength;
    varying vec2 vUv;
    void main() {
      vec4 color = texture2D(tDiffuse, vUv);
      vec2 center = vUv - 0.5;
      float vignette = 1.0 - dot(center, center) * strength * 2.2;
      // 轻微的冷色调偏移(阴影偏蓝)
      color.rgb = mix(color.rgb, color.rgb * vec3(0.92, 0.98, 1.08), 0.35);
      gl_FragColor = vec4(color.rgb * vignette, color.a);
    }
  `,
};

export function createComposer(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
): EffectComposer {
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));

  const bloom = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    0.85, // strength
    0.55, // radius
    0.12, // threshold(夜景下航灯远超阈值)
  );
  composer.addPass(bloom);

  composer.addPass(new ShaderPass(VignetteShader));
  composer.addPass(new OutputPass());
  return composer;
}
