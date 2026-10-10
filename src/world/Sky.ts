import * as THREE from 'three';
import { BLIZZARD, WORLD, blizzardAt, cxMain, terrainHeight } from './Heightfield';
import { Rng, clamp, lerp } from '../util/math';
import { BIOMES, type BiomeSpec } from './Biomes';

export const SUN_DIR = new THREE.Vector3(-0.45, 0.62, -0.64).normalize();

/**
 * Atmosphere: replaces three's exponential fog with height-attenuated fog (dense in the valleys, thinning with altitude),
 * forward sun scattering (fog brightens and warms towards the sun) and ordered dithering so distant ridges do not band.
 * Installed once, before any material compiles; every fogged material picks it up.
 */
function installAtmosphere() {
  const C = THREE.ShaderChunk as unknown as Record<string, string>;
  if (C.fog_fragment.includes('vFogWorld')) return;
  const s = SUN_DIR;
  C.fog_pars_vertex = '#ifdef USE_FOG\n varying float vFogDepth;\n varying vec3 vFogWorld;\n#endif';
  C.fog_vertex = '#ifdef USE_FOG\n vFogDepth = - mvPosition.z;\n vFogWorld = transpose(mat3(viewMatrix)) * (mvPosition.xyz - viewMatrix[3].xyz);\n#endif';
  C.fog_pars_fragment = C.fog_pars_fragment.replace('varying float vFogDepth;', 'varying float vFogDepth;\n varying vec3 vFogWorld;');
  C.fog_fragment = `#ifdef USE_FOG
    vec3 fogRay = vFogWorld - cameraPosition;
    float fogDist = length(fogRay);
    #ifdef FOG_EXP2
      const float FALL = 0.00038; float y0 = max(cameraPosition.y - 350.0, 0.0); float dy = fogRay.y;
      float hInt = abs(dy) > 2.0 ? (exp(-FALL * y0) - exp(-FALL * (y0 + dy))) / (FALL * dy) : exp(-FALL * y0);
      float od = fogDensity * fogDist; float fogFactor = 1.0 - exp(- od * od * clamp(hInt, 0.04, 1.6));
    #else
      float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
    #endif
    float sunAmt = pow(max(dot(fogRay / max(fogDist, 1.0), vec3(${s.x.toFixed(4)}, ${s.y.toFixed(4)}, ${s.z.toFixed(4)})), 0.0), 8.0);
    vec3 fogTint = fogColor + vec3(0.30, 0.20, 0.08) * sunAmt * dot(fogColor, vec3(0.33));
    fogFactor = clamp(fogFactor + (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 160.0, 0.0, 1.0);
    gl_FragColor.rgb = mix( gl_FragColor.rgb, fogTint, fogFactor );
  #endif`;
}
installAtmosphere();

function softTexture(kind: 'cloud' | 'flake'): THREE.Texture {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d')!;
  if (kind === 'cloud') {
    const rng = new Rng(9);
    for (let i = 0; i < 14; i++) {
      const x = 64 + rng.signed() * 26, y = 64 + rng.signed() * 18, r = 22 + rng.next() * 26;
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, 'rgba(255,255,255,0.30)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    }
  } else {
    const gr = g.createRadialGradient(64, 64, 0, 64, 64, 60);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export class SkyEnvironment {
  readonly group = new THREE.Group();
  readonly sun = new THREE.DirectionalLight(0xfff1dc, 3.0);
  readonly hemi = new THREE.HemisphereLight(0xaec6e6, 0x4a4a42, 0.9);
  readonly fog = new THREE.FogExp2(0xaabdd0, 0.00006);
  private skyMat: THREE.ShaderMaterial;
  private clouds: THREE.Points;
  private snow: THREE.Points;
  private snowMat: THREE.ShaderMaterial;
  private fogCalm = new THREE.Color(0xa9bdd2);
  private fogStorm = new THREE.Color(0xd5dce2);
  private biome: BiomeSpec = BIOMES.arctic;
  private stars: THREE.Points;
  /** mission-controlled 0..1 */
  front = 0;
  /** 0..1 intensity at camera right now */
  localIntensity = 0;
  visibility = 30000;
  private t = 0;

  constructor() {
    const sky = new THREE.Mesh(new THREE.SphereGeometry(55000, 32, 16), this.skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { uTop: { value: new THREE.Color(0x2f62a8) }, uHor: { value: new THREE.Color(0xb9cde0) }, uSun: { value: SUN_DIR.clone() }, uStorm: { value: 0 }, uStormCol: { value: new THREE.Color(0xc6cdd3) } },
      vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); gl_Position.z = gl_Position.w*0.99999; }',
      fragmentShader: `varying vec3 vD; uniform vec3 uTop; uniform vec3 uHor; uniform vec3 uSun; uniform float uStorm; uniform vec3 uStormCol;
        void main(){ float h = clamp(vD.y,-0.2,1.0); float k = pow(max(h,0.0),0.55);
          vec3 c = mix(uHor, uTop, k); float s = max(dot(normalize(vD), normalize(uSun)),0.0);
          c += vec3(1.0,0.85,0.6)*pow(s,300.0)*2.0 + vec3(1.0,0.8,0.55)*pow(s,8.0)*0.18;
          c = mix(c, uStormCol, uStorm*0.85); if (vD.y < 0.0) c = mix(c, uHor*0.8, clamp(-vD.y*4.0,0.0,1.0)); gl_FragColor = vec4(c,1.0);} `,
    }));
    sky.renderOrder = -10;
    this.group.add(sky);

    this.sun.position.copy(SUN_DIR).multiplyScalar(2000);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera; sc.left = -140; sc.right = 140; sc.top = 140; sc.bottom = -140; sc.near = 100; sc.far = 4000;
    this.sun.shadow.bias = -0.0004;
    this.group.add(this.sun, this.sun.target, this.hemi);

    // low-ceiling cloud layer (soft billboards)
    const rng = new Rng(77);
    const N = 650, cp = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const z = rng.range(WORLD.minZ + 2000, 3000);
      const x = cxMain(z) + rng.signed() * 9000;
      const ground = Math.max(terrainHeight(x, z), 400);
      cp[i * 3] = x; cp[i * 3 + 1] = Math.max(2900, ground + 700) + rng.range(0, 260); cp[i * 3 + 2] = z;
    }
    const cg = new THREE.BufferGeometry(); cg.setAttribute('position', new THREE.BufferAttribute(cp, 3));
    this.clouds = new THREE.Points(cg, new THREE.PointsMaterial({ map: softTexture('cloud'), size: 2600, sizeAttenuation: true, transparent: true, depthWrite: false, opacity: 0.85, color: 0xf2f5f8, fog: false }));
    this.clouds.frustumCulled = false;
    this.group.add(this.clouds);

    // snow (GPU-wrapped around the camera)
    const SN = 5000, sp = new Float32Array(SN * 3), r2 = new Rng(5);
    for (let i = 0; i < SN; i++) { sp[i * 3] = r2.next(); sp[i * 3 + 1] = r2.next(); sp[i * 3 + 2] = r2.next(); }
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    this.snowMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, fog: false,
      uniforms: { uCam: { value: new THREE.Vector3() }, uTime: { value: 0 }, uAmt: { value: 0 }, uMap: { value: softTexture('flake') }, uVel: { value: new THREE.Vector3() }, uTint: { value: new THREE.Color(0xffffff) } },
      vertexShader: `uniform vec3 uCam; uniform float uTime; uniform float uAmt; uniform vec3 uVel; varying float vA;
        void main(){ vec3 box = vec3(160.0, 100.0, 160.0); vec3 p = position*box;
          p += vec3(-uTime*12.0 - uVel.x*0.0, -uTime*9.0, uTime*5.0) * (0.6 + position.x);
          vec3 w = mod(p - uCam + box*0.5, box) - box*0.5; vec4 mv = viewMatrix*vec4(uCam + w, 1.0);
          float d = length(w); vA = uAmt * smoothstep(box.x*0.5, 10.0, d) * step(position.y, uAmt);
          gl_PointSize = 220.0/(1.0+d*0.8); gl_Position = projectionMatrix*mv; }`,
      fragmentShader: 'uniform sampler2D uMap; uniform vec3 uTint; varying float vA; void main(){ vec4 t = texture2D(uMap, gl_PointCoord); gl_FragColor = vec4(uTint,t.a*vA*0.8); }',
    });
    this.snow = new THREE.Points(sg, this.snowMat);
    this.snow.frustumCulled = false;
    this.group.add(this.snow);
    // stars for night theatres (on a dome around the camera)
    const NS = 1400, stp = new Float32Array(NS * 3), r3 = new Rng(31);
    for (let i = 0; i < NS; i++) { const u = r3.next() * 2 - 1, a = r3.next() * Math.PI * 2, y = Math.abs(u) * 0.95 + 0.05, rr = Math.sqrt(1 - y * y); stp[i * 3] = Math.cos(a) * rr * 40000; stp[i * 3 + 1] = y * 40000; stp[i * 3 + 2] = Math.sin(a) * rr * 40000; }
    const stg = new THREE.BufferGeometry(); stg.setAttribute('position', new THREE.BufferAttribute(stp, 3));
    this.stars = new THREE.Points(stg, new THREE.PointsMaterial({ color: 0xdfe6ff, size: 2, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.85, depthWrite: false }));
    this.stars.frustumCulled = false; this.stars.visible = false; this.stars.renderOrder = -9;
    this.group.add(this.stars);
  }

  /** Switches sky colours, light, fog haze, clouds and weather particles to a theatre preset. */
  applyBiome(b: BiomeSpec) {
    this.biome = b; const s = b.sky;
    (this.skyMat.uniforms.uTop.value as THREE.Color).set(s.top);
    (this.skyMat.uniforms.uHor.value as THREE.Color).set(s.horizon);
    (this.skyMat.uniforms.uStormCol.value as THREE.Color).set(s.fogStorm);
    this.fogCalm.set(s.fogCalm); this.fogStorm.set(s.fogStorm); this.fog.color.set(s.fogCalm);
    this.sun.color.set(s.sunColor); this.hemi.color.set(s.hemiSky); this.hemi.groundColor.set(s.hemiGround);
    (this.snowMat.uniforms.uTint.value as THREE.Color).set(b.particles);
    this.stars.visible = s.stars;
    (this.clouds.material as THREE.PointsMaterial).color.set(s.stars ? 0x2a2440 : b.id === 'desert' ? 0xf6eadc : 0xf2f5f8);
  }

  update(dt: number, cam: THREE.Camera, aircraftPos: THREE.Vector3) {
    this.t += dt;
    this.localIntensity = blizzardAt(aircraftPos.x, aircraftPos.z, this.front);
    const outside = lerp(30000, 9000, this.front);
    this.visibility = lerp(outside, 260, this.localIntensity);
    const targetDens = Math.sqrt(3) / this.visibility * this.biome.sky.fogScale;
    this.fog.density += (targetDens - this.fog.density) * clamp(dt * 1.5, 0, 1);
    this.fog.color.copy(this.fogCalm).lerp(this.fogStorm, clamp(this.front * 0.5 + this.localIntensity, 0, 1));
    this.skyMat.uniforms.uStorm.value = clamp(this.front * 0.45 + this.localIntensity * 0.55, 0, 1);
    (this.skyMat.uniforms.uHor.value as THREE.Color).copy(this.fog.color);
    this.snowMat.uniforms.uCam.value.copy(cam.position);
    this.snowMat.uniforms.uTime.value = this.t;
    this.snowMat.uniforms.uAmt.value = clamp(this.localIntensity * 1.3 + (this.front > 0 ? 0.06 : 0), 0, 1);
    const sk = this.biome.sky;
    this.hemi.intensity = lerp(sk.hemiIntensity, sk.hemiIntensity * 0.6, this.localIntensity);
    this.sun.intensity = lerp(sk.sunIntensity, sk.sunIntensity * 0.27, clamp(this.front * 0.5 + this.localIntensity, 0, 1));
    this.group.position.set(0, 0, 0);
    // keep the sky dome centred on the camera
    (this.group.children[0] as THREE.Mesh).position.copy(cam.position);
    this.stars.position.copy(cam.position);
    // shadows follow the player aircraft
    this.sun.target.position.copy(aircraftPos);
    this.sun.position.copy(aircraftPos).addScaledVector(SUN_DIR, 1500);
    this.sun.target.updateMatrixWorld();
  }
  dispose() { this.group.traverse(o => { const m = o as THREE.Mesh; m.geometry?.dispose?.(); }); }
}

export const BLIZZARD_CENTER = BLIZZARD;
