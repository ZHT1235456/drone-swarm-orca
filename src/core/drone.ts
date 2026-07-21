import { Vec3 } from './vec3';

/** 机型枚举 */
export enum DroneType {
  /** 侦察四旋翼:小、快、灵活 */
  Scout = 0,
  /** 运输六旋翼:大、慢、高优先级(少让路) */
  Cargo = 1,
  /** 通信中继机:中等,姿态稳定 */
  Relay = 2,
}

export const DRONE_TYPE_COUNT = 3;

/** 机型静态参数表 */
export interface DroneSpec {
  name: string;
  nameZh: string;
  /** 避障半径(米) */
  radius: number;
  /** 最大速度(米/秒) */
  maxSpeed: number;
  /** 最大加速度(米/秒²) */
  maxAccel: number;
  /** ORCA 避让责任系数,越小越"强势" */
  yielding: number;
  /** 航灯颜色(十六进制) */
  lightColor: number;
  /** 机身缩放 */
  scale: number;
  /** 电池满电续航(秒,仿真尺度) */
  endurance: number;
  /** 悬停功耗系数(影响电量消耗速度) */
  hoverDrain: number;
}

export const DRONE_SPECS: Record<DroneType, DroneSpec> = {
  [DroneType.Scout]: {
    name: 'SCT-4X',
    nameZh: '侦察四旋翼',
    radius: 1.1,
    maxSpeed: 14,
    maxAccel: 22,
    yielding: 1.4,
    lightColor: 0x2ce8f5,
    scale: 1.0,
    endurance: 1500,
    hoverDrain: 1.0,
  },
  [DroneType.Cargo]: {
    name: 'CGO-6H',
    nameZh: '运输六旋翼',
    radius: 2.2,
    maxSpeed: 8,
    maxAccel: 9,
    yielding: 0.55,
    lightColor: 0xffb02e,
    scale: 1.9,
    endurance: 2600,
    hoverDrain: 1.6,
  },
  [DroneType.Relay]: {
    name: 'RLY-4S',
    nameZh: '通信中继机',
    radius: 1.5,
    maxSpeed: 10,
    maxAccel: 14,
    yielding: 1.0,
    lightColor: 0xb44df0,
    scale: 1.35,
    endurance: 2000,
    hoverDrain: 1.2,
  },
};

/** 无人机运行状态 */
export enum DroneStatus {
  Idle = 'IDLE',
  Transit = 'TRANSIT',
  Formation = 'FORMATION',
  Returning = 'RTB',
  Failure = 'FAILURE',
}

export const STATUS_LABEL_ZH: Record<DroneStatus, string> = {
  [DroneStatus.Idle]: '待命',
  [DroneStatus.Transit]: '巡航',
  [DroneStatus.Formation]: '编队保持',
  [DroneStatus.Returning]: '返航',
  [DroneStatus.Failure]: '故障',
};

let nextId = 0;

/** 单架无人机实体 */
export class Drone {
  readonly id: number;
  readonly callsign: string;
  readonly type: DroneType;
  readonly spec: DroneSpec;

  position = new Vec3();
  velocity = new Vec3();
  /** ORCA 求解出的目标速度(用于加速度限幅) */
  newVelocity = new Vec3();
  /** 编队目标点 */
  target = new Vec3();
  /** 期望速度(指向目标) */
  prefVelocity = new Vec3();

  /** 机头朝向角(渲染用,弧度) */
  heading = 0;
  /** 姿态倾斜(渲染用) */
  tiltX = 0;
  tiltZ = 0;
  /** 旋翼相位 */
  rotorPhase = Math.random() * Math.PI * 2;

  status = DroneStatus.Idle;
  /** 电量 0~1 */
  battery = 1;
  /** 信号强度 0~1(距基地越远越弱,加噪声) */
  signal = 1;
  /** 故障后的坠落速度 */
  failureVy = 0;

  constructor(type: DroneType) {
    this.id = nextId++;
    this.type = type;
    this.spec = DRONE_SPECS[type];
    const prefix = ['SCT', 'CGO', 'RLY'][type];
    this.callsign = `${prefix}-${String(this.id + 1).padStart(3, '0')}`;
    this.battery = 0.75 + Math.random() * 0.25;
  }

  get radius(): number {
    return this.spec.radius;
  }

  get yielding(): number {
    return this.spec.yielding;
  }

  /** ORCA 视图属性(接口兼容) */
  get maxSpeed(): number {
    return this.spec.maxSpeed;
  }
}
