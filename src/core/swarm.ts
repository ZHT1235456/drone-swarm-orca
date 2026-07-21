import { Vec3 } from './vec3';
import { Drone, DroneStatus, DroneType, DRONE_SPECS } from './drone';
import { SpatialHash } from './spatialHash';
import { solveOrca, OrcaAgentView } from './orca';
import { FormationId, generateFormation, assignTargets, FORMATIONS } from './formations';

export interface SwarmConfig {
  scoutCount: number;
  cargoCount: number;
  relayCount: number;
}

export interface AlertEvent {
  time: number;
  severity: 'info' | 'warn' | 'critical';
  message: string;
}

const NEIGHBOR_RADIUS = 18;
const MAX_NEIGHBORS = 10;
const TIME_HORIZON = 2.4;
const ARRIVE_SLOWDOWN = 8; // 距目标多少米开始减速
const WORLD_BOUND = 220;

/**
 * 集群管理器:持有全部无人机,负责固定步长仿真推进。
 */
export class Swarm {
  readonly drones: Drone[] = [];
  private readonly hash = new SpatialHash(NEIGHBOR_RADIUS);

  /** 当前队形 */
  formation: FormationId = 'launch-grid';
  /** 仿真累计时间(秒) */
  time = 0;
  /** 速度倍率 */
  timeScale = 1;

  /** 本帧最小机间距(遥测用) */
  minSeparation = Infinity;
  /** 近距告警对数 */
  proximityPairs = 0;

  private alertListeners: ((e: AlertEvent) => void)[] = [];
  private lowBatteryWarned = new Set<number>();

  // 复用缓冲
  private candidateBuf: number[] = new Array(512);
  private neighborViews: OrcaAgentView[] = [];
  private neighborDistSq: number[] = [];

  constructor(config: SwarmConfig) {
    for (let i = 0; i < config.scoutCount; i++) this.drones.push(new Drone(DroneType.Scout));
    for (let i = 0; i < config.cargoCount; i++) this.drones.push(new Drone(DroneType.Cargo));
    for (let i = 0; i < config.relayCount; i++) this.drones.push(new Drone(DroneType.Relay));

    // 初始位置:地面阵列
    const targets = generateFormation('launch-grid', this.drones);
    for (let i = 0; i < this.drones.length; i++) {
      this.drones[i].position.copy(targets[i]);
      this.drones[i].target.copy(targets[i]);
      this.drones[i].status = DroneStatus.Idle;
    }
  }

  onAlert(listener: (e: AlertEvent) => void): void {
    this.alertListeners.push(listener);
  }

  private emitAlert(severity: AlertEvent['severity'], message: string): void {
    const e: AlertEvent = { time: this.time, severity, message };
    for (const l of this.alertListeners) l(e);
  }

  setFormation(id: FormationId): void {
    this.formation = id;
    const targets = generateFormation(id, this.drones);
    assignTargets(this.drones, targets);
    for (const d of this.drones) {
      if (d.status !== DroneStatus.Failure) {
        d.status = DroneStatus.Transit;
      }
    }
    const info = FORMATIONS.find((f) => f.id === id);
    this.emitAlert('info', `任务指令:切换队形 → ${info?.nameZh ?? id}`);
  }

  /** 注入单机故障(演练) */
  injectFailure(): Drone | null {
    const healthy = this.drones.filter(
      (d) => d.status !== DroneStatus.Failure && d.position.y > 8,
    );
    if (healthy.length === 0) return null;
    const victim = healthy[Math.floor(Math.random() * healthy.length)];
    victim.status = DroneStatus.Failure;
    victim.failureVy = 0;
    this.emitAlert('critical', `${victim.callsign} 动力系统故障,失去控制!`);
    return victim;
  }

  /** 恢复所有故障机(重置演练) */
  recoverAll(): void {
    let count = 0;
    for (const d of this.drones) {
      if (d.status === DroneStatus.Failure) {
        d.status = DroneStatus.Transit;
        d.battery = Math.max(d.battery, 0.5);
        this.lowBatteryWarned.delete(d.id);
        count++;
      }
    }
    if (count > 0) this.emitAlert('info', `远程复位完成,${count} 架无人机恢复受控`);
  }

  /** 固定步长推进 */
  step(dt: number): void {
    this.time += dt;
    const drones = this.drones;
    const n = drones.length;

    // 1. 重建空间哈希
    this.hash.clear();
    for (let i = 0; i < n; i++) {
      this.hash.insert(i, drones[i].position);
    }

    this.minSeparation = Infinity;
    this.proximityPairs = 0;

    // 2. 逐机计算期望速度 + ORCA 求解
    for (let i = 0; i < n; i++) {
      const d = drones[i];

      if (d.status === DroneStatus.Failure) {
        continue; // 故障机不参与求解,做自由落体
      }

      // 期望速度:指向目标,近目标时减速(arrival 行为)
      const toTarget = d.prefVelocity;
      toTarget.copy(d.target).sub(d.position);
      const dist = toTarget.length();
      if (dist < 0.4) {
        toTarget.set(0, 0, 0);
        if (d.status === DroneStatus.Transit) d.status = DroneStatus.Formation;
      } else {
        let speed = d.spec.maxSpeed;
        if (dist < ARRIVE_SLOWDOWN) {
          speed *= dist / ARRIVE_SLOWDOWN;
        }
        toTarget.scale(speed / dist);
      }

      // 近邻查询(粗筛 + 距离精筛,取最近 MAX_NEIGHBORS 个)
      const candCount = this.hash.query(d.position, NEIGHBOR_RADIUS, this.candidateBuf);
      let neighborCount = 0;
      for (let c = 0; c < candCount; c++) {
        const j = this.candidateBuf[c];
        if (j === i) continue;
        const other = drones[j];
        const distSq = d.position.distanceToSq(other.position);
        if (distSq > NEIGHBOR_RADIUS * NEIGHBOR_RADIUS) continue;

        // 遥测统计
        const sep = Math.sqrt(distSq) - d.radius - other.radius;
        if (sep < this.minSeparation) this.minSeparation = sep;
        if (sep < 1.2 && j > i) this.proximityPairs++;

        // 插入排序保持最近的 MAX_NEIGHBORS 个
        if (neighborCount < MAX_NEIGHBORS) {
          this.neighborViews[neighborCount] = other;
          this.neighborDistSq[neighborCount] = distSq;
          neighborCount++;
        } else {
          // 找到当前最远的替换
          let maxIdx = 0;
          for (let k = 1; k < neighborCount; k++) {
            if (this.neighborDistSq[k] > this.neighborDistSq[maxIdx]) maxIdx = k;
          }
          if (distSq < this.neighborDistSq[maxIdx]) {
            this.neighborViews[maxIdx] = other;
            this.neighborDistSq[maxIdx] = distSq;
          }
        }
      }

      solveOrca(d, this.neighborViews, neighborCount, toTarget, d.spec.maxSpeed, TIME_HORIZON, dt, d.newVelocity);
    }

    // 3. 积分:加速度限幅 + 位置更新 + 姿态/电量/信号
    for (let i = 0; i < n; i++) {
      const d = drones[i];

      if (d.status === DroneStatus.Failure) {
        // 自由落体 + 空气阻力,落地后静止
        if (d.position.y > 0.6) {
          d.failureVy -= 9.8 * dt;
          d.velocity.x *= 1 - 0.6 * dt;
          d.velocity.z *= 1 - 0.6 * dt;
          d.velocity.y = d.failureVy;
          d.position.addScaled(d.position, d.velocity, dt);
          if (d.position.y <= 0.6) {
            d.position.y = 0.6;
            d.velocity.set(0, 0, 0);
          }
        }
        continue;
      }

      // 加速度限幅
      const dvx = d.newVelocity.x - d.velocity.x;
      const dvy = d.newVelocity.y - d.velocity.y;
      const dvz = d.newVelocity.z - d.velocity.z;
      const dvLen = Math.sqrt(dvx * dvx + dvy * dvy + dvz * dvz);
      const maxDv = d.spec.maxAccel * dt;
      if (dvLen > maxDv) {
        const s = maxDv / dvLen;
        d.velocity.x += dvx * s;
        d.velocity.y += dvy * s;
        d.velocity.z += dvz * s;
      } else {
        d.velocity.copy(d.newVelocity);
      }

      d.position.addScaled(d.position, d.velocity, dt);

      // 边界与地面保护
      if (d.position.y < d.radius) d.position.y = d.radius;
      const bound = WORLD_BOUND;
      if (Math.abs(d.position.x) > bound) d.position.x = Math.sign(d.position.x) * bound;
      if (Math.abs(d.position.z) > bound) d.position.z = Math.sign(d.position.z) * bound;

      // 姿态:机头朝速度方向,倾角与水平加速度相关
      const hSpeed = Math.hypot(d.velocity.x, d.velocity.z);
      if (hSpeed > 0.5) {
        const targetHeading = Math.atan2(d.velocity.x, d.velocity.z);
        let diff = targetHeading - d.heading;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        d.heading += diff * Math.min(1, 5 * dt);
      }
      const tiltAmount = Math.min(0.42, hSpeed / d.spec.maxSpeed * 0.42);
      const sinH = Math.sin(d.heading);
      const cosH = Math.cos(d.heading);
      const targetTiltX = tiltAmount * (hSpeed > 0.3 ? 1 : 0);
      d.tiltX += (targetTiltX - d.tiltX) * Math.min(1, 4 * dt);
      // 侧倾:根据速度方向与机头方向的偏差
      const lateral = (d.velocity.x * cosH - d.velocity.z * sinH) / Math.max(1, d.spec.maxSpeed);
      d.tiltZ += (lateral * 0.5 - d.tiltZ) * Math.min(1, 4 * dt);

      // 旋翼转速:基础转速 + 与推力需求相关
      const throttle = 0.6 + 0.4 * (d.velocity.length() / d.spec.maxSpeed);
      d.rotorPhase += throttle * 55 * dt;

      // 电量消耗
      const drain = (d.spec.hoverDrain + (d.velocity.length() / d.spec.maxSpeed) * 0.8) / d.spec.endurance;
      d.battery = Math.max(0, d.battery - drain * dt);
      if (d.battery < 0.18 && !this.lowBatteryWarned.has(d.id)) {
        this.lowBatteryWarned.add(d.id);
        this.emitAlert('warn', `${d.callsign} 电量低(${Math.round(d.battery * 100)}%),建议返航`);
      }

      // 信号强度:随距基地距离衰减 + 抖动
      const distFromBase = d.position.length();
      d.signal = Math.max(0.05, Math.min(1, 1.15 - distFromBase / 400 + (Math.random() - 0.5) * 0.04));
    }
  }

  /** 机队统计 */
  getStats() {
    let active = 0, failed = 0, lowBattery = 0;
    let avgBattery = 0;
    const byType = [0, 0, 0];
    for (const d of this.drones) {
      if (d.status === DroneStatus.Failure) failed++;
      else active++;
      if (d.battery < 0.18) lowBattery++;
      avgBattery += d.battery;
      byType[d.type]++;
    }
    return {
      total: this.drones.length,
      active,
      failed,
      lowBattery,
      avgBattery: avgBattery / this.drones.length,
      byType,
      minSeparation: this.minSeparation,
      proximityPairs: this.proximityPairs,
    };
  }
}

export { DRONE_SPECS };
export type { Vec3 };
