import * as THREE from 'three';
import { BLIZZARD, WORLD, blizzardAt, cxMain, terrainHeight } from './Heightfield';
import { Rng, clamp, lerp } from '../util/math';

export const SUN_DIR = new THREE.Vector3(-0.45, 0.62, -0.64).normalize();

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
      uniforms: { uCam: { value: new THREE.Vector3() }, uTime: { value: 0 }, uAmt: { value: 0 }, uMap: { value: softTexture('flake') }, uVel: { value: new THREE.Vector3() } },
      vertexShader: `uniform vec3 uCam; uniform float uTime; uniform float uAmt; uniform vec3 uVel; varying float vA;
        void main(){ vec3 box = vec3(160.0, 100.0, 160.0); vec3 p = position*box;
          p += vec3(-uTime*12.0 - uVel.x*0.0, -uTime*9.0, uTime*5.0) * (0.6 + position.x);
          vec3 w = mod(p - uCam + box*0.5, box) - box*0.5; vec4 mv = viewMatrix*vec4(uCam + w, 1.0);
          float d = length(w); vA = uAmt * smoothstep(box.x*0.5, 10.0, d) * step(position.y, uAmt);
          gl_PointSize = 220.0/(1.0+d*0.8); gl_Position = projectionMatrix*mv; }`,
      fragmentShader: 'uniform sampler2D uMap; varying float vA; void main(){ vec4 t = texture2D(uMap, gl_PointCoord); gl_FragColor = vec4(1.0,1.0,1.0,t.a*vA*0.8); }',
    });
    this.snow = new THREE.Points(sg, this.snowMat);
    this.snow.frustumCulled = false;
    this.group.add(this.snow);
  }

  update(dt: number, cam: THREE.Camera, aircraftPos: THREE.Vector3) {
    this.t += dt;
    this.localIntensity = blizzardAt(aircraftPos.x, aircraftPos.z, this.front);
    const outside = lerp(30000, 9000, this.front);
    this.visibility = lerp(outside, 260, this.localIntensity);
    const targetDens = Math.sqrt(3) / this.visibility;
    this.fog.density += (targetDens - this.fog.density) * clamp(dt * 1.5, 0, 1);
    this.fog.color.copy(this.fogCalm).lerp(this.fogStorm, clamp(this.front * 0.5 + this.localIntensity, 0, 1));
    this.skyMat.uniforms.uStorm.value = clamp(this.front * 0.45 + this.localIntensity * 0.55, 0, 1);
    (this.skyMat.uniforms.uHor.value as THREE.Color).copy(this.fog.color);
    this.snowMat.uniforms.uCam.value.copy(cam.position);
    this.snowMat.uniforms.uTime.value = this.t;
    this.snowMat.uniforms.uAmt.value = clamp(this.localIntensity * 1.3 + (this.front > 0 ? 0.06 : 0), 0, 1);
    this.hemi.intensity = lerp(0.9, 0.55, this.localIntensity);
    this.sun.intensity = lerp(3.0, 0.8, clamp(this.front * 0.5 + this.localIntensity, 0, 1));
    this.group.position.set(0, 0, 0);
    // keep the sky dome centred on the camera
    (this.group.children[0] as THREE.Mesh).position.copy(cam.position);
    // shadows follow the player aircraft
    this.sun.target.position.copy(aircraftPos);
    this.sun.position.copy(aircraftPos).addScaledVector(SUN_DIR, 1500);
    this.sun.target.updateMatrixWorld();
  }
  dispose() { this.group.traverse(o => { const m = o as THREE.Mesh; m.geometry?.dispose?.(); }); }
}

export const BLIZZARD_CENTER = BLIZZARD;
