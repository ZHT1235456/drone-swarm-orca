import { Vec3 } from './vec3';

/**
 * 3D ORCA(Optimal Reciprocal Collision Avoidance)求解器。
 * 参照 RVO2-3D 算法:为每个近邻构造互惠速度障碍半空间(平面约束),
 * 再用三维线性规划求解距离期望速度最近的可行速度。
 *
 * 约束形式:dot(v - plane.point, plane.normal) >= 0
 */

const EPSILON = 1e-5;

export interface Plane {
  point: Vec3;
  normal: Vec3;
}

export interface Line {
  point: Vec3;
  direction: Vec3;
}

export interface OrcaAgentView {
  position: Vec3;
  velocity: Vec3;
  radius: number;
  /** 避让责任系数(越大越愿意让路),异构机型的关键参数 */
  yielding: number;
}

/** 平面对象池,避免每帧大量 GC */
class PlanePool {
  private pool: Plane[] = [];
  private used = 0;

  acquire(): Plane {
    if (this.used < this.pool.length) {
      return this.pool[this.used++];
    }
    const p: Plane = { point: new Vec3(), normal: new Vec3() };
    this.pool.push(p);
    this.used++;
    return p;
  }

  reset(): void {
    this.used = 0;
  }
}

const planePool = new PlanePool();

// 复用的临时向量
const tmpRelPos = new Vec3();
const tmpRelVel = new Vec3();
const tmpW = new Vec3();
const tmpCross = new Vec3();
const tmpU = new Vec3();

/**
 * 为 agent 相对 other 构造 ORCA 平面。
 * @param timeHorizon 预测时域(秒)
 * @param dt 仿真步长
 */
function computeOrcaPlane(
  agent: OrcaAgentView,
  other: OrcaAgentView,
  timeHorizon: number,
  dt: number,
): Plane {
  const plane = planePool.acquire();

  tmpRelPos.copy(other.position).sub(agent.position);
  tmpRelVel.copy(agent.velocity).sub(other.velocity);
  const distSq = tmpRelPos.lengthSq();
  const combinedRadius = agent.radius + other.radius;
  const combinedRadiusSq = combinedRadius * combinedRadius;

  if (distSq > combinedRadiusSq) {
    // 未碰撞:构造截断速度障碍锥。w = relVel - relPos / timeHorizon
    const invTimeHorizon = 1 / timeHorizon;
    tmpW.addScaled(tmpRelVel, tmpRelPos, -invTimeHorizon);
    const wLengthSq = tmpW.lengthSq();
    const dotProduct = tmpW.dot(tmpRelPos);

    if (dotProduct < 0 && dotProduct * dotProduct > combinedRadiusSq * wLengthSq) {
      // 投影到截断球面
      const wLength = Math.sqrt(wLengthSq);
      plane.normal.copy(tmpW).scale(1 / wLength);
      tmpU.copy(plane.normal).scale(combinedRadius * invTimeHorizon - wLength);
    } else {
      // 投影到锥面
      const a = distSq;
      const b = tmpRelPos.dot(tmpRelVel);
      tmpCross.cross(tmpRelPos, tmpRelVel);
      const c = tmpRelVel.lengthSq() - tmpCross.lengthSq() / (distSq - combinedRadiusSq);
      const t = (b + Math.sqrt(Math.max(0, b * b - a * c))) / a;
      tmpW.addScaled(tmpRelVel, tmpRelPos, -t);
      const wLength = tmpW.length();
      if (wLength > EPSILON) {
        plane.normal.copy(tmpW).scale(1 / wLength);
      } else {
        plane.normal.set(0, 1, 0);
      }
      tmpU.copy(plane.normal).scale(combinedRadius * t - wLength);
    }
  } else {
    // 已发生穿插:在一个步长内推开。w = relVel - relPos / dt
    const invTimeStep = 1 / dt;
    tmpW.addScaled(tmpRelVel, tmpRelPos, -invTimeStep);
    const wLength = tmpW.length();
    if (wLength > EPSILON) {
      plane.normal.copy(tmpW).scale(1 / wLength);
    } else {
      plane.normal.set(0, 1, 0);
    }
    tmpU.copy(plane.normal).scale(combinedRadius * invTimeStep - wLength);
  }

  // 异构责任分摊:自身承担 share 比例的避让量
  const share = agent.yielding / (agent.yielding + other.yielding);
  plane.point.addScaled(agent.velocity, tmpU, share);

  return plane;
}

// ---------- 三维线性规划(RVO2-3D 移植) ----------

const lp1Tmp = new Vec3();

function linearProgram1(
  planes: Plane[], planeNo: number, line: Line, radius: number,
  optVelocity: Vec3, directionOpt: boolean, result: Vec3,
): boolean {
  const dotProduct = line.point.dot(line.direction);
  const discriminant = dotProduct * dotProduct + radius * radius - line.point.lengthSq();
  if (discriminant < 0) return false;

  const sqrtDiscriminant = Math.sqrt(discriminant);
  let tLeft = -dotProduct - sqrtDiscriminant;
  let tRight = -dotProduct + sqrtDiscriminant;

  for (let i = 0; i < planeNo; i++) {
    const numerator = lp1Tmp.copy(planes[i].point).sub(line.point).dot(planes[i].normal);
    const denominator = line.direction.dot(planes[i].normal);

    if (denominator * denominator <= EPSILON) {
      if (numerator > 0) return false;
      continue;
    }

    const t = numerator / denominator;
    if (denominator >= 0) {
      tLeft = Math.max(tLeft, t);
    } else {
      tRight = Math.min(tRight, t);
    }
    if (tLeft > tRight) return false;
  }

  let t: number;
  if (directionOpt) {
    t = optVelocity.dot(line.direction) > 0 ? tRight : tLeft;
  } else {
    t = line.direction.dot(lp1Tmp.copy(optVelocity).sub(line.point));
    t = Math.min(Math.max(t, tLeft), tRight);
  }

  result.addScaled(line.point, line.direction, t);
  return true;
}

const lp2Tmp = new Vec3();
const lp2PlaneCenter = new Vec3();
const lp2Line: Line = { point: new Vec3(), direction: new Vec3() };
const lp2LineNormal = new Vec3();

function linearProgram2(
  planes: Plane[], planeNo: number, radius: number,
  optVelocity: Vec3, directionOpt: boolean, result: Vec3,
): boolean {
  const plane = planes[planeNo];
  const planeDist = plane.point.dot(plane.normal);
  const planeDistSq = planeDist * planeDist;
  const radiusSq = radius * radius;
  if (planeDistSq > radiusSq) return false;

  const planeRadiusSq = radiusSq - planeDistSq;
  lp2PlaneCenter.copy(plane.normal).scale(planeDist);

  if (directionOpt) {
    // optVelocity 是单位方向,在平面内沿其投影方向取最远点
    const dot = optVelocity.dot(plane.normal);
    lp2Tmp.copy(optVelocity);
    lp2Tmp.x -= dot * plane.normal.x;
    lp2Tmp.y -= dot * plane.normal.y;
    lp2Tmp.z -= dot * plane.normal.z;
    const lenSq = lp2Tmp.lengthSq();
    if (lenSq <= EPSILON) {
      result.copy(lp2PlaneCenter);
    } else {
      const s = Math.sqrt(planeRadiusSq / lenSq);
      result.copy(lp2PlaneCenter);
      result.x += lp2Tmp.x * s;
      result.y += lp2Tmp.y * s;
      result.z += lp2Tmp.z * s;
    }
  } else {
    // 把 optVelocity 投影到平面上
    const d = lp2Tmp.copy(plane.point).sub(optVelocity).dot(plane.normal);
    result.copy(optVelocity);
    result.x += d * plane.normal.x;
    result.y += d * plane.normal.y;
    result.z += d * plane.normal.z;
    // 若超出球体,则投影回平面圆盘
    if (result.lengthSq() > radiusSq) {
      lp2Tmp.copy(result).sub(lp2PlaneCenter);
      const lenSq = lp2Tmp.lengthSq();
      const s = Math.sqrt(planeRadiusSq / lenSq);
      result.copy(lp2PlaneCenter);
      result.x += lp2Tmp.x * s;
      result.y += lp2Tmp.y * s;
      result.z += lp2Tmp.z * s;
    }
  }

  for (let i = 0; i < planeNo; i++) {
    if (lp2Tmp.copy(planes[i].point).sub(result).dot(planes[i].normal) > 0) {
      // 当前解违反平面 i,求平面 i 与平面 planeNo 的交线
      tmpCross.cross(planes[i].normal, plane.normal);
      if (tmpCross.lengthSq() <= EPSILON) return false;

      lp2Line.direction.copy(tmpCross).normalize();
      lp2LineNormal.cross(lp2Line.direction, plane.normal);
      const numer = lp2Tmp.copy(planes[i].point).sub(plane.point).dot(planes[i].normal);
      const denom = lp2LineNormal.dot(planes[i].normal);
      const s = numer / denom;
      lp2Line.point.copy(plane.point);
      lp2Line.point.x += lp2LineNormal.x * s;
      lp2Line.point.y += lp2LineNormal.y * s;
      lp2Line.point.z += lp2LineNormal.z * s;

      if (!linearProgram1(planes, i, lp2Line, radius, optVelocity, directionOpt, result)) {
        return false;
      }
    }
  }
  return true;
}

const lp3Tmp = new Vec3();
const lp3TempResult = new Vec3();

function linearProgram3(
  planes: Plane[], radius: number, optVelocity: Vec3,
  directionOpt: boolean, result: Vec3,
): number {
  if (directionOpt) {
    result.copy(optVelocity).scale(radius);
  } else if (optVelocity.lengthSq() > radius * radius) {
    result.copy(optVelocity).normalize().scale(radius);
  } else {
    result.copy(optVelocity);
  }

  for (let i = 0; i < planes.length; i++) {
    if (lp3Tmp.copy(planes[i].point).sub(result).dot(planes[i].normal) > 0) {
      lp3TempResult.copy(result);
      if (!linearProgram2(planes, i, radius, optVelocity, directionOpt, result)) {
        result.copy(lp3TempResult);
        return i;
      }
    }
  }
  return planes.length;
}

const lp4Tmp = new Vec3();
const lp4TempResult = new Vec3();

function linearProgram4(
  planes: Plane[], beginPlane: number, radius: number, result: Vec3,
): void {
  let distance = 0;

  for (let i = beginPlane; i < planes.length; i++) {
    if (lp4Tmp.copy(planes[i].point).sub(result).dot(planes[i].normal) > distance) {
      // 构造投影平面集(注意:此处需要独立分配,数量少,可接受)
      const projPlanes: Plane[] = [];
      for (let j = 0; j < i; j++) {
        const projPoint = new Vec3();
        const cross = new Vec3().cross(planes[j].normal, planes[i].normal);

        if (cross.lengthSq() <= EPSILON) {
          // 平面 i 与 j 平行
          if (planes[i].normal.dot(planes[j].normal) > 0) continue;
          projPoint.copy(planes[i].point).add(planes[j].point).scale(0.5);
        } else {
          const lineNormal = new Vec3().cross(cross, planes[i].normal);
          const numer = lp4Tmp.copy(planes[j].point).sub(planes[i].point).dot(planes[j].normal);
          const denom = lineNormal.dot(planes[j].normal);
          const s = numer / denom;
          projPoint.copy(planes[i].point);
          projPoint.x += lineNormal.x * s;
          projPoint.y += lineNormal.y * s;
          projPoint.z += lineNormal.z * s;
        }

        const projNormal = new Vec3().copy(planes[j].normal).sub(planes[i].normal).normalize();
        projPlanes.push({ point: projPoint, normal: projNormal });
      }

      lp4TempResult.copy(result);
      if (linearProgram3(projPlanes, radius, planes[i].normal, true, result) < projPlanes.length) {
        result.copy(lp4TempResult);
      }
      distance = lp4Tmp.copy(planes[i].point).sub(result).dot(planes[i].normal);
    }
  }
}

/**
 * 求解单架无人机的新速度。
 * @param agent 当前机
 * @param neighbors 近邻列表(已按距离筛选)
 * @param prefVelocity 期望速度
 * @param maxSpeed 最大速度
 * @param timeHorizon 预测时域
 * @param dt 仿真步长
 * @param result 输出:新速度
 */
export function solveOrca(
  agent: OrcaAgentView,
  neighbors: OrcaAgentView[],
  neighborCount: number,
  prefVelocity: Vec3,
  maxSpeed: number,
  timeHorizon: number,
  dt: number,
  result: Vec3,
): void {
  planePool.reset();
  const planes: Plane[] = [];

  for (let i = 0; i < neighborCount; i++) {
    planes.push(computeOrcaPlane(agent, neighbors[i], timeHorizon, dt));
  }

  const planeFail = linearProgram3(planes, maxSpeed, prefVelocity, false, result);
  if (planeFail < planes.length) {
    linearProgram4(planes, planeFail, maxSpeed, result);
  }
}
