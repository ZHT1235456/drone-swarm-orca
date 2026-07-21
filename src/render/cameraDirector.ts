import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Drone, DroneStatus } from '../core/drone';

/**
 * 摄影导演:自动模式下周期性切换机位(环绕/跟拍/低空掠过/俯瞰),
 * 手动模式下交给 OrbitControls。
 */

type ShotType = 'orbit' | 'chase' | 'flyby' | 'overview' | 'rise';

interface Shot {
  type: ShotType;
  duration: number;
  /** 跟拍目标(chase/flyby 用) */
  targetDrone: Drone | null;
  seed: number;
}

const tmpTarget = new THREE.Vector3();
const tmpDesired = new THREE.Vector3();

export class CameraDirector {
  autoMode = true;
  private shot: Shot | null = null;
  private shotTime = 0;
  private controls: OrbitControls;
  /** 平滑的注视点 */
  private lookAt = new THREE.Vector3(0, 40, 0);
  /** 集群质心缓存 */
  private centroid = new THREE.Vector3(0, 50, 0);

  constructor(
    private camera: THREE.PerspectiveCamera,
    private drones: Drone[],
    canvas: HTMLCanvasElement,
  ) {
    this.controls = new OrbitControls(camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.06;
    this.controls.maxPolarAngle = Math.PI * 0.495;
    this.controls.minDistance = 8;
    this.controls.maxDistance = 500;
    this.controls.target.set(0, 40, 0);
    this.controls.enabled = false;

    camera.position.set(120, 70, 160);

    // 用户拖动画面时自动退出导演模式
    canvas.addEventListener('pointerdown', () => {
      if (this.autoMode) this.setAutoMode(false);
    });
  }

  setAutoMode(auto: boolean): void {
    this.autoMode = auto;
    this.controls.enabled = !auto;
    if (auto) {
      this.shot = null; // 立即挑选新镜头
    } else {
      this.controls.target.copy(this.lookAt);
      this.controls.update();
    }
  }

  private pickShot(): Shot {
    const types: ShotType[] = ['orbit', 'chase', 'flyby', 'overview', 'rise', 'orbit', 'chase'];
    const type = types[Math.floor(Math.random() * types.length)];
    const flying = this.drones.filter(
      (d) => d.status !== DroneStatus.Failure && d.position.y > 10,
    );
    const targetDrone = flying.length > 0
      ? flying[Math.floor(Math.random() * flying.length)]
      : null;
    return {
      type: targetDrone || (type !== 'chase' && type !== 'flyby') ? type : 'orbit',
      duration: 7 + Math.random() * 5,
      targetDrone,
      seed: Math.random() * Math.PI * 2,
    };
  }

  private updateCentroid(): void {
    let x = 0, y = 0, z = 0, count = 0;
    for (const d of this.drones) {
      if (d.status === DroneStatus.Failure) continue;
      x += d.position.x; y += d.position.y; z += d.position.z;
      count++;
    }
    if (count > 0) {
      this.centroid.set(x / count, y / count, z / count);
    }
  }

  update(dt: number, time: number): void {
    this.updateCentroid();

    if (!this.autoMode) {
      this.controls.update();
      return;
    }

    if (!this.shot || this.shotTime >= this.shot.duration) {
      this.shot = this.pickShot();
      this.shotTime = 0;
    }
    this.shotTime += dt;
    const shot = this.shot;
    const t = this.shotTime;
    const c = this.centroid;

    // 集群包围尺度,决定环绕半径
    let maxDistSq = 0;
    for (const d of this.drones) {
      if (d.status === DroneStatus.Failure) continue;
      const dx = d.position.x - c.x, dy = d.position.y - c.y, dz = d.position.z - c.z;
      const distSq = dx * dx + dy * dy + dz * dz;
      if (distSq > maxDistSq) maxDistSq = distSq;
    }
    const swarmRadius = Math.max(30, Math.sqrt(maxDistSq));

    switch (shot.type) {
      case 'orbit': {
        const radius = swarmRadius * 1.7;
        const angle = shot.seed + t * 0.11;
        const height = c.y + swarmRadius * 0.45 + Math.sin(t * 0.3 + shot.seed) * 8;
        tmpDesired.set(
          c.x + Math.cos(angle) * radius,
          Math.max(6, height),
          c.z + Math.sin(angle) * radius,
        );
        tmpTarget.copy(c);
        break;
      }
      case 'chase': {
        const d = shot.targetDrone!;
        // 机尾后上方跟随
        const back = 9 + d.spec.scale * 4;
        tmpDesired.set(
          d.position.x - Math.sin(d.heading) * back + Math.cos(shot.seed) * 2,
          d.position.y + 3.5 + Math.sin(t * 0.7) * 0.8,
          d.position.z - Math.cos(d.heading) * back + Math.sin(shot.seed) * 2,
        );
        tmpTarget.set(
          d.position.x + d.velocity.x * 0.4,
          d.position.y + d.velocity.y * 0.4,
          d.position.z + d.velocity.z * 0.4,
        );
        break;
      }
      case 'flyby': {
        const d = shot.targetDrone!;
        // 固定机位,让集群从镜头旁掠过
        if (t < dt * 2) {
          // 镜头架在目标前进方向的侧前方
          this.camera.position.set(
            d.position.x + Math.sin(d.heading + 0.9) * 18 + d.velocity.x * 1.6,
            Math.max(4, d.position.y - 4),
            d.position.z + Math.cos(d.heading + 0.9) * 18 + d.velocity.z * 1.6,
          );
        }
        tmpDesired.copy(this.camera.position);
        tmpTarget.set(d.position.x, d.position.y, d.position.z);
        break;
      }
      case 'overview': {
        const angle = shot.seed + t * 0.04;
        const radius = swarmRadius * 2.6;
        tmpDesired.set(
          c.x + Math.cos(angle) * radius,
          c.y + swarmRadius * 1.6,
          c.z + Math.sin(angle) * radius,
        );
        tmpTarget.copy(c);
        break;
      }
      case 'rise': {
        // 从地面缓缓升起的仰拍
        const angle = shot.seed;
        const radius = swarmRadius * 1.2;
        const progress = Math.min(1, t / shot.duration);
        tmpDesired.set(
          c.x + Math.cos(angle) * radius,
          3 + progress * (c.y * 0.7),
          c.z + Math.sin(angle) * radius,
        );
        tmpTarget.set(c.x, c.y + 6, c.z);
        break;
      }
    }

    // 平滑插值(镜头惯性)
    const posLerp = shot.type === 'flyby' ? 1 : Math.min(1, 1.6 * dt);
    const lookLerp = Math.min(1, 2.6 * dt);
    this.camera.position.lerp(tmpDesired, posLerp);
    this.lookAt.lerp(tmpTarget, lookLerp);
    this.camera.lookAt(this.lookAt);

    // 轻微手持抖动
    const shake = 0.05;
    this.camera.position.x += Math.sin(time * 1.9) * shake;
    this.camera.position.y += Math.sin(time * 2.7 + 1) * shake * 0.6;
  }

  /** 当前镜头名称(HUD 显示) */
  getShotLabel(): string {
    if (!this.autoMode) return '手动控制';
    if (!this.shot) return '—';
    const labels: Record<ShotType, string> = {
      orbit: '环绕机位',
      chase: `跟拍 ${this.shot.targetDrone?.callsign ?? ''}`,
      flyby: '掠过机位',
      overview: '全景俯瞰',
      rise: '升起仰拍',
    };
    return labels[this.shot.type];
  }
}
