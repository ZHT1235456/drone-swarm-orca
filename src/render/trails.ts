import * as THREE from 'three';
import { Drone, DroneStatus } from '../core/drone';

/**
 * 飞行拖尾:每架无人机一条渐隐折线,共用一个 LineSegments 与预分配缓冲。
 * 采样间隔固定,颜色沿轨迹从机型色渐隐到透明。
 */

const TRAIL_LENGTH = 22; // 每机采样点数
const SAMPLE_INTERVAL = 0.07; // 秒

export class TrailRenderer {
  readonly object: THREE.LineSegments;
  private positions: Float32Array;
  private colors: Float32Array;
  private history: Float32Array; // [drone][point][xyz] 环形缓冲
  private head = 0;
  private filled = 0;
  private accumulator = 0;
  private baseColors: Float32Array; // 每机 rgb

  constructor(private drones: Drone[]) {
    const n = drones.length;
    const segsPerDrone = TRAIL_LENGTH - 1;
    this.positions = new Float32Array(n * segsPerDrone * 2 * 3);
    this.colors = new Float32Array(n * segsPerDrone * 2 * 3);
    this.history = new Float32Array(n * TRAIL_LENGTH * 3);
    this.baseColors = new Float32Array(n * 3);

    const c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      c.setHex(drones[i].spec.lightColor);
      this.baseColors[i * 3] = c.r;
      this.baseColors[i * 3 + 1] = c.g;
      this.baseColors[i * 3 + 2] = c.b;
      // 初始化历史为当前位置,避免开局从原点拉线
      for (let p = 0; p < TRAIL_LENGTH; p++) {
        const o = (i * TRAIL_LENGTH + p) * 3;
        this.history[o] = drones[i].position.x;
        this.history[o + 1] = drones[i].position.y;
        this.history[o + 2] = drones[i].position.z;
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));

    const mat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.75,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.object = new THREE.LineSegments(geo, mat);
    this.object.frustumCulled = false;
  }

  update(dt: number): void {
    this.accumulator += dt;
    if (this.accumulator >= SAMPLE_INTERVAL) {
      this.accumulator %= SAMPLE_INTERVAL;
      this.pushSample();
    }
    this.rebuildBuffers();
  }

  private pushSample(): void {
    const n = this.drones.length;
    this.head = (this.head + 1) % TRAIL_LENGTH;
    this.filled = Math.min(this.filled + 1, TRAIL_LENGTH);
    for (let i = 0; i < n; i++) {
      const o = (i * TRAIL_LENGTH + this.head) * 3;
      this.history[o] = this.drones[i].position.x;
      this.history[o + 1] = this.drones[i].position.y;
      this.history[o + 2] = this.drones[i].position.z;
    }
  }

  private rebuildBuffers(): void {
    const n = this.drones.length;
    const segs = TRAIL_LENGTH - 1;
    const pos = this.positions;
    const col = this.colors;

    for (let i = 0; i < n; i++) {
      const d = this.drones[i];
      const grounded = d.status === DroneStatus.Failure && d.position.y <= 0.7;
      const br = this.baseColors[i * 3];
      const bg = this.baseColors[i * 3 + 1];
      const bb = this.baseColors[i * 3 + 2];

      for (let sIdx = 0; sIdx < segs; sIdx++) {
        // 从最新点向旧点排列:sIdx=0 是最新的一段
        const p0 = (this.head - sIdx + TRAIL_LENGTH * 2) % TRAIL_LENGTH;
        const p1 = (this.head - sIdx - 1 + TRAIL_LENGTH * 2) % TRAIL_LENGTH;
        const src0 = (i * TRAIL_LENGTH + p0) * 3;
        const src1 = (i * TRAIL_LENGTH + p1) * 3;
        const dst = (i * segs + sIdx) * 6;

        pos[dst] = this.history[src0];
        pos[dst + 1] = this.history[src0 + 1];
        pos[dst + 2] = this.history[src0 + 2];
        pos[dst + 3] = this.history[src1];
        pos[dst + 4] = this.history[src1 + 1];
        pos[dst + 5] = this.history[src1 + 2];

        // 渐隐:越旧越暗;地面坠毁机不显示拖尾
        const fade0 = grounded ? 0 : Math.pow(1 - sIdx / segs, 1.6) * 0.85;
        const fade1 = grounded ? 0 : Math.pow(1 - (sIdx + 1) / segs, 1.6) * 0.85;
        col[dst] = br * fade0;
        col[dst + 1] = bg * fade0;
        col[dst + 2] = bb * fade0;
        col[dst + 3] = br * fade1;
        col[dst + 4] = bg * fade1;
        col[dst + 5] = bb * fade1;
      }
    }

    const geo = this.object.geometry;
    (geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (geo.attributes.color as THREE.BufferAttribute).needsUpdate = true;
  }
}
