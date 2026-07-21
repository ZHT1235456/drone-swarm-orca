import * as THREE from 'three';
import { Swarm } from './core/swarm';
import { createScene, createEnvironmentScene, updateSceneEffects } from './render/scene';
import { DroneRenderer } from './render/droneMesh';
import { TrailRenderer } from './render/trails';
import { createComposer } from './render/postfx';
import { CameraDirector } from './render/cameraDirector';
import { Hud } from './ui/hud';
import { TelemetryPanel } from './ui/telemetry';
import { MissionPanel } from './ui/missionPanel';
import { AlertsPanel } from './ui/alerts';

// ---------- 仿真 ----------
const swarm = new Swarm({
  scoutCount: 120,
  cargoCount: 45,
  relayCount: 35,
});

// ---------- 渲染 ----------
const canvas = document.getElementById('scene') as HTMLCanvasElement;
const viewport = document.getElementById('viewport')!;

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: 'high-performance',
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;

const scene = createScene();

const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(createEnvironmentScene(), 0.05).texture;
scene.environmentIntensity = 0.6;
pmrem.dispose();

const camera = new THREE.PerspectiveCamera(55, 1, 0.5, 2200);

const droneRenderer = new DroneRenderer(swarm.drones);
scene.add(droneRenderer.group);

const trails = new TrailRenderer(swarm.drones);
scene.add(trails.object);

const composer = createComposer(renderer, scene, camera);
const director = new CameraDirector(camera, swarm.drones, canvas);

function resizeToViewport(): void {
  const w = viewport.clientWidth;
  const h = viewport.clientHeight;
  if (w <= 0 || h <= 0) return;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h, false);
  composer.setSize(w, h);
}

resizeToViewport();

// ---------- UI:侧栏布局 ----------
const hud = new Hud(document.getElementById('topbar-slot')!);
const missionPanel = new MissionPanel(document.getElementById('sidebar-left')!, swarm, {
  onAutoCamera: (auto) => director.setAutoMode(auto),
});
const telemetry = new TelemetryPanel(document.getElementById('sidebar-right')!, swarm);
const alertsPanel = new AlertsPanel(document.getElementById('sidebar-right')!);
swarm.onAlert((e) => alertsPanel.push(e));

const shotLabel = document.querySelector<HTMLElement>('#camera-info .shot')!;

// ---------- 拾取(相对视口坐标) ----------
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let pointerDownPos: { x: number; y: number } | null = null;

canvas.addEventListener('pointerdown', (e) => {
  pointerDownPos = { x: e.clientX, y: e.clientY };
});
canvas.addEventListener('pointerup', (e) => {
  if (!pointerDownPos) return;
  const dx = e.clientX - pointerDownPos.x;
  const dy = e.clientY - pointerDownPos.y;
  pointerDownPos = null;
  if (dx * dx + dy * dy > 25) return;

  const rect = canvas.getBoundingClientRect();
  pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const picked = droneRenderer.pick(raycaster);
  telemetry.select(picked);
  droneRenderer.selectedDroneId = picked ? picked.id : null;
});

canvas.addEventListener('pointerdown', () => {
  if (!director.autoMode) return;
  requestAnimationFrame(() => {
    if (!director.autoMode) missionPanel.setAutoCamState(false);
  });
});

window.addEventListener('resize', resizeToViewport);
new ResizeObserver(resizeToViewport).observe(viewport);

setTimeout(() => swarm.setFormation('sphere'), 2500);

if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__debug = { swarm, camera, director };
}

// ---------- 主循环 ----------
const FIXED_DT = 1 / 60;
const MAX_STEPS_PER_FRAME = 4;
let lastTime = performance.now();
let simAccumulator = 0;
let fpsSmoothed = 60;
let uiUpdateAccumulator = 0;

function loop(): void {
  requestAnimationFrame(loop);
  const now = performance.now();
  let frameDt = (now - lastTime) / 1000;
  lastTime = now;
  if (frameDt > 0.25) frameDt = 0.25;

  fpsSmoothed += (1 / Math.max(frameDt, 1e-4) - fpsSmoothed) * 0.05;

  simAccumulator += frameDt * swarm.timeScale;
  let steps = 0;
  while (simAccumulator >= FIXED_DT && steps < MAX_STEPS_PER_FRAME) {
    swarm.step(FIXED_DT);
    simAccumulator -= FIXED_DT;
    steps++;
  }
  if (steps === MAX_STEPS_PER_FRAME) simAccumulator = 0;

  const renderTime = now / 1000;
  droneRenderer.update(renderTime);
  trails.update(frameDt * swarm.timeScale);
  updateSceneEffects(scene, renderTime);
  director.update(frameDt, renderTime);

  uiUpdateAccumulator += frameDt;
  if (uiUpdateAccumulator > 0.12) {
    uiUpdateAccumulator = 0;
    hud.update(swarm, fpsSmoothed);
    telemetry.update();
    shotLabel.textContent = director.getShotLabel();
  }

  composer.render();
}

loop();
