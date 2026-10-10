import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { Terrain } from '../world/Terrain';
import { Airfield } from '../world/Airfield';
import { SkyEnvironment } from '../world/Sky';
import type { SettingsData } from '../ui/Settings';

export type SceneId = 'flight' | 'hangar';

/** Owns the WebGL renderer and the two top-level scenes; handles resize, quality and scene transitions. */
export class SceneManager {
  readonly renderer: THREE.WebGLRenderer;
  readonly flightScene = new THREE.Scene();
  hangarScene: THREE.Scene | null = null;
  readonly sky = new SkyEnvironment();
  readonly terrain = new Terrain();
  readonly airfield = new Airfield();
  active: SceneId = 'flight';
  worldReady = false;
  private quality: SettingsData['quality'] = 'medium';
  private envFlight: THREE.Texture | null = null;
  private envHangar: THREE.Texture | null = null;
  webglOk = true;

  constructor(readonly container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', logarithmicDepthBuffer: true });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.95;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.domElement.id = 'gl';
    container.appendChild(this.renderer.domElement);
    this.flightScene.background = new THREE.Color(0x9fb4ca);
    this.flightScene.fog = this.sky.fog;
    this.flightScene.add(this.sky.group, this.terrain.group, this.airfield.group);
    const pm = new THREE.PMREMGenerator(this.renderer);
    // sky-like environment for metals/glass reflections
    const envScene = new THREE.Scene();
    const sphere = new THREE.Mesh(new THREE.SphereGeometry(50, 24, 12), new THREE.ShaderMaterial({
      side: THREE.BackSide,
      vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0);} ',
      fragmentShader: 'varying vec3 vP; void main(){ float h = normalize(vP).y; vec3 top = vec3(0.35,0.55,0.95); vec3 hor = vec3(0.95,0.93,0.88); vec3 bot = vec3(0.25,0.25,0.22); vec3 c = h>0.0 ? mix(hor, top, pow(h,0.5)) : mix(hor, bot, clamp(-h*3.0,0.0,1.0)); float sun = pow(max(dot(normalize(vP), normalize(vec3(-0.45,0.62,-0.64))),0.0), 60.0); gl_FragColor = vec4(c + vec3(8.0,7.0,5.0)*sun, 1.0);} ',
    }));
    envScene.add(sphere);
    this.envFlight = pm.fromScene(envScene, 0.02).texture;
    this.envHangar = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    pm.dispose();
    this.flightScene.environment = this.envFlight;
    this.resize();
    window.addEventListener('resize', this.onResize);
  }

  private onResize = () => this.resize();
  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.applyQuality(this.quality);
  }
  applyQuality(q: SettingsData['quality']) {
    this.quality = q;
    const dpr = window.devicePixelRatio || 1;
    this.renderer.setPixelRatio(q === 'low' ? Math.min(0.8, dpr) : q === 'medium' ? Math.min(1, dpr) : Math.min(1.6, dpr));
    this.renderer.shadowMap.enabled = q !== 'low';
    this.sky.sun.castShadow = q !== 'low';
    this.sky.sun.shadow.mapSize.set(q === 'high' ? 4096 : 2048, q === 'high' ? 4096 : 2048);
    this.sky.sun.shadow.map?.dispose(); (this.sky.sun.shadow as { map: unknown }).map = null;
  }

  async loadWorld(progress: (f: number) => void) {
    if (this.worldReady) return;
    await this.terrain.build(progress);
    this.worldReady = true;
  }

  setHangar(scene: THREE.Scene) { this.hangarScene = scene; scene.environment = this.envHangar; }
  setActive(id: SceneId) { this.active = id; }

  render(camera: THREE.Camera) {
    const scene = this.active === 'flight' ? this.flightScene : this.hangarScene;
    if (!scene) return;
    this.renderer.render(scene, camera);
  }

  /** Counts of live GPU resources – used by the cleanup/leak check. */
  get stats() { const i = this.renderer.info; return { geometries: i.memory.geometries, textures: i.memory.textures, calls: i.render.calls, triangles: i.render.triangles }; }
  dispose() {
    window.removeEventListener('resize', this.onResize);
    this.terrain.dispose(); this.airfield.dispose(); this.sky.dispose(); this.renderer.dispose();
  }
}
