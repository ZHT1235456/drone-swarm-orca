import * as THREE from 'three';
import { Drone, DroneType, DRONE_SPECS, DroneStatus } from '../core/drone';

/**
 * 异构机型实例化渲染。
 * 每机型 4 个 InstancedMesh:机身、实体桨叶、运动模糊桨盘、航灯。
 * 机身为 PBR 金属材质(依赖 scene.environment 提供反射),
 * 桨叶高速旋转产生频闪感,叠加一层极淡桨盘模拟运动模糊。
 */

interface TypeBatch {
  body: THREE.InstancedMesh;
  /** 深色实体桨叶(高速旋转产生频闪感) */
  blades: THREE.InstancedMesh;
  /** 极淡的桨盘,模拟运动模糊 */
  discs: THREE.InstancedMesh;
  lights: THREE.InstancedMesh;
  /** 该机型的旋翼安装点(局部坐标) */
  rotorMounts: THREE.Vector3[];
  rotorRadius: number;
  indices: number[]; // 全局 drone 索引
}

const tmpMatrix = new THREE.Matrix4();
const tmpPos = new THREE.Vector3();
const tmpQuat = new THREE.Quaternion();
const tmpSpinQuat = new THREE.Quaternion();
const tmpRotorQuat = new THREE.Quaternion();
const tmpEuler = new THREE.Euler();
const tmpScale = new THREE.Vector3();
const tmpColor = new THREE.Color();
const Y_AXIS = new THREE.Vector3(0, 1, 0);

/** 简易几何合并(避免引入 BufferGeometryUtils 依赖路径问题) */
function mergeGeometries(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let totalVerts = 0;
  let totalIndices = 0;
  for (const g of geos) {
    totalVerts += g.attributes.position.count;
    totalIndices += g.index ? g.index.count : g.attributes.position.count;
  }
  const positions = new Float32Array(totalVerts * 3);
  const normals = new Float32Array(totalVerts * 3);
  const indices = new Uint32Array(totalIndices);

  let vOffset = 0;
  let iOffset = 0;
  for (const g of geos) {
    const pos = g.attributes.position;
    const norm = g.attributes.normal;
    positions.set(pos.array as Float32Array, vOffset * 3);
    normals.set(norm.array as Float32Array, vOffset * 3);
    if (g.index) {
      for (let i = 0; i < g.index.count; i++) {
        indices[iOffset + i] = g.index.array[i] + vOffset;
      }
      iOffset += g.index.count;
    } else {
      for (let i = 0; i < pos.count; i++) {
        indices[iOffset + i] = i + vOffset;
      }
      iOffset += pos.count;
    }
    vOffset += pos.count;
    g.dispose();
  }

  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  merged.setIndex(new THREE.BufferAttribute(indices, 1));
  return merged;
}

/** 悬臂 + 末端电机舱,所有机型复用 */
function addArm(
  geos: THREE.BufferGeometry[],
  angle: number,
  reach: number,
  armHeight: number,
): void {
  // 悬臂:细长方杆,略微上扬
  const arm = new THREE.BoxGeometry(reach, 0.07, 0.1);
  arm.rotateZ(0.06);
  arm.rotateY(angle);
  arm.translate(
    Math.sin(angle + Math.PI / 2) * reach * 0.5,
    armHeight,
    Math.cos(angle + Math.PI / 2) * reach * 0.5,
  );
  geos.push(arm);

  // 电机舱:短圆柱
  const motor = new THREE.CylinderGeometry(0.11, 0.13, 0.2, 8);
  motor.translate(
    Math.sin(angle + Math.PI / 2) * reach,
    armHeight + 0.1,
    Math.cos(angle + Math.PI / 2) * reach,
  );
  geos.push(motor);
}

/** 构造四旋翼机身(流线机体 + 云台相机 + 电机舱) */
function buildScoutBody(): THREE.BufferGeometry {
  const geos: THREE.BufferGeometry[] = [];
  // 主机体:前后拉长的扁椭球
  const hull = new THREE.SphereGeometry(0.42, 14, 10);
  hull.scale(0.85, 0.5, 1.3);
  hull.translate(0, 0.05, 0);
  geos.push(hull);
  // 顶盖(略小,形成分模线层次)
  const canopy = new THREE.SphereGeometry(0.3, 10, 8);
  canopy.scale(0.75, 0.42, 1.0);
  canopy.translate(0, 0.22, 0.08);
  geos.push(canopy);
  // 云台相机球
  const gimbal = new THREE.SphereGeometry(0.14, 8, 8);
  gimbal.translate(0, -0.18, 0.42);
  geos.push(gimbal);
  for (let i = 0; i < 4; i++) {
    addArm(geos, Math.PI / 4 + (i * Math.PI) / 2, 1.2, 0.06);
  }
  // 起落撬
  for (const side of [-1, 1]) {
    const skid = new THREE.BoxGeometry(0.05, 0.28, 0.5);
    skid.rotateX(0.15);
    skid.translate(side * 0.3, -0.32, 0);
    geos.push(skid);
  }
  return mergeGeometries(geos);
}

/** 六旋翼机身(重载机架 + 吊挂货舱 + 支腿) */
function buildCargoBody(): THREE.BufferGeometry {
  const geos: THREE.BufferGeometry[] = [];
  // 主机体:八角厚盘
  const hub = new THREE.CylinderGeometry(0.58, 0.66, 0.34, 8);
  geos.push(hub);
  // 顶部散热罩
  const cap = new THREE.CylinderGeometry(0.34, 0.5, 0.18, 8);
  cap.translate(0, 0.26, 0);
  geos.push(cap);
  // 吊挂货舱:带棱线的箱体
  const cargoBox = new THREE.BoxGeometry(0.62, 0.46, 0.62);
  cargoBox.translate(0, -0.5, 0);
  geos.push(cargoBox);
  // 吊索(四根细柱)
  for (const [sx, sz] of [[-1, -1], [-1, 1], [1, -1], [1, 1]] as const) {
    const strap = new THREE.CylinderGeometry(0.025, 0.025, 0.3, 4);
    strap.translate(sx * 0.24, -0.28, sz * 0.24);
    geos.push(strap);
  }
  for (let i = 0; i < 6; i++) {
    addArm(geos, (i * Math.PI) / 3, 1.4, 0.12);
  }
  // 四条着陆支腿
  for (let i = 0; i < 4; i++) {
    const angle = Math.PI / 4 + (i * Math.PI) / 2;
    const leg = new THREE.CylinderGeometry(0.035, 0.045, 0.62, 5);
    leg.rotateX(0.35);
    leg.rotateY(angle);
    leg.translate(Math.sin(angle) * 0.5, -0.55, Math.cos(angle) * 0.5);
    geos.push(leg);
  }
  return mergeGeometries(geos);
}

/** 中继机(扁平机体 + 天线桅杆 + 相控阵板) */
function buildRelayBody(): THREE.BufferGeometry {
  const geos: THREE.BufferGeometry[] = [];
  const hull = new THREE.SphereGeometry(0.45, 12, 9);
  hull.scale(1.1, 0.42, 1.1);
  geos.push(hull);
  // 相控阵天线板(倾斜的薄板)
  const panel = new THREE.BoxGeometry(0.5, 0.04, 0.36);
  panel.rotateZ(0.25);
  panel.translate(0, 0.2, -0.1);
  geos.push(panel);
  for (let i = 0; i < 4; i++) {
    addArm(geos, Math.PI / 4 + (i * Math.PI) / 2, 1.1, 0.04);
  }
  // 天线桅杆 + 顶端球
  const mast = new THREE.CylinderGeometry(0.025, 0.045, 0.85, 6);
  mast.translate(0, 0.62, 0.12);
  geos.push(mast);
  const dish = new THREE.SphereGeometry(0.13, 8, 6);
  dish.translate(0, 1.05, 0.12);
  geos.push(dish);
  // 下垂鞭状天线两根
  for (const side of [-1, 1]) {
    const whip = new THREE.CylinderGeometry(0.015, 0.015, 0.5, 4);
    whip.translate(side * 0.28, -0.4, -0.15);
    geos.push(whip);
  }
  return mergeGeometries(geos);
}

/** 两叶实体桨:中心桨毂 + 两片带扭转的窄叶 */
function buildBladeGeometry(radius: number): THREE.BufferGeometry {
  const geos: THREE.BufferGeometry[] = [];
  const hubGeo = new THREE.CylinderGeometry(0.045, 0.055, 0.09, 6);
  geos.push(hubGeo);
  for (const side of [0, Math.PI]) {
    const blade = new THREE.BoxGeometry(radius, 0.012, 0.075);
    blade.translate(radius * 0.5 + 0.03, 0, 0);
    // 桨叶迎角
    blade.rotateX(0.18);
    blade.rotateY(side);
    geos.push(blade);
  }
  return mergeGeometries(geos);
}

/** 各机型旋翼安装点与桨叶尺寸 */
function rotorConfigFor(type: DroneType): { mounts: THREE.Vector3[]; radius: number } {
  const mounts: THREE.Vector3[] = [];
  if (type === DroneType.Cargo) {
    for (let i = 0; i < 6; i++) {
      const angle = (i * Math.PI) / 3 + Math.PI / 2;
      mounts.push(new THREE.Vector3(Math.sin(angle) * 1.4, 0.26, Math.cos(angle) * 1.4));
    }
    return { mounts, radius: 0.62 };
  }
  const reach = type === DroneType.Scout ? 1.2 : 1.1;
  const height = type === DroneType.Scout ? 0.2 : 0.18;
  for (let i = 0; i < 4; i++) {
    const angle = Math.PI / 4 + (i * Math.PI) / 2 + Math.PI / 2;
    mounts.push(new THREE.Vector3(Math.sin(angle) * reach, height, Math.cos(angle) * reach));
  }
  return { mounts, radius: type === DroneType.Scout ? 0.5 : 0.46 };
}

export class DroneRenderer {
  private batches: TypeBatch[] = [];
  readonly group = new THREE.Group();
  /** 选中高亮圈 */
  private selectionRing: THREE.Mesh;
  selectedDroneId: number | null = null;

  constructor(private drones: Drone[]) {
    const bodyGeos: Record<DroneType, THREE.BufferGeometry> = {
      [DroneType.Scout]: buildScoutBody(),
      [DroneType.Cargo]: buildCargoBody(),
      [DroneType.Relay]: buildRelayBody(),
    };

    // 机型涂装:碳纤维暗色 + 各自的差异色调(低饱和,避免反光后泛出塑料感)
    const bodyTints: Record<DroneType, number> = {
      [DroneType.Scout]: 0x262b32,
      [DroneType.Cargo]: 0x2e2c26,
      [DroneType.Relay]: 0x2a2730,
    };

    for (let type = 0 as DroneType; type < 3; type++) {
      const indices = drones
        .map((d, i) => ({ d, i }))
        .filter(({ d }) => d.type === type)
        .map(({ i }) => i);
      const count = indices.length;
      if (count === 0) continue;

      const spec = DRONE_SPECS[type];

      // 机身:哑光碳纤维基底 + 清漆层,反射来自 scene.environment(main 中设置)
      const bodyMat = new THREE.MeshPhysicalMaterial({
        color: bodyTints[type],
        roughness: 0.62,
        metalness: 0.55,
        envMapIntensity: 0.8,
        clearcoat: 0.55,
        clearcoatRoughness: 0.3,
        emissive: new THREE.Color(spec.lightColor),
        emissiveIntensity: 0.03,
      });
      const body = new THREE.InstancedMesh(bodyGeos[type], bodyMat, count);
      body.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

      const { mounts, radius } = rotorConfigFor(type);

      // 实体桨叶:近黑碳纤维,微弱高光
      const bladeMat = new THREE.MeshStandardMaterial({
        color: 0x14171c,
        roughness: 0.5,
        metalness: 0.6,
        envMapIntensity: 0.8,
      });
      const blades = new THREE.InstancedMesh(
        buildBladeGeometry(radius), bladeMat, count * mounts.length,
      );
      blades.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

      // 运动模糊桨盘:极淡的环,叠在桨叶上方
      const discGeo = new THREE.RingGeometry(radius * 0.35, radius * 1.02, 20);
      discGeo.rotateX(-Math.PI / 2);
      const discMat = new THREE.MeshBasicMaterial({
        color: 0x2e3d4a,
        transparent: true,
        opacity: 0.30,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const discs = new THREE.InstancedMesh(discGeo, discMat, count * mounts.length);
      discs.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

      // 航灯:小球,Bloom 后期下会发光
      const lightGeo = new THREE.SphereGeometry(0.16, 6, 6);
      const lightMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
      const lights = new THREE.InstancedMesh(lightGeo, lightMat, count);
      lights.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      for (let k = 0; k < count; k++) {
        lights.setColorAt(k, tmpColor.setHex(spec.lightColor));
      }
      if (lights.instanceColor) lights.instanceColor.setUsage(THREE.DynamicDrawUsage);

      this.group.add(body, blades, discs, lights);
      this.batches.push({
        body, blades, discs, lights,
        rotorMounts: mounts, rotorRadius: radius, indices,
      });
    }

    // 选中高亮圈
    this.selectionRing = new THREE.Mesh(
      new THREE.RingGeometry(2.4, 2.75, 40),
      new THREE.MeshBasicMaterial({
        color: 0x2ce8f5, transparent: true, opacity: 0.9, side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    this.selectionRing.visible = false;
    this.group.add(this.selectionRing);
  }

  /** 每帧同步无人机状态到实例矩阵 */
  update(time: number): void {
    const drones = this.drones;

    for (const batch of this.batches) {
      const { body, blades, discs, lights, rotorMounts, indices } = batch;

      for (let k = 0; k < indices.length; k++) {
        const d = drones[indices[k]];
        const s = d.spec.scale;

        tmpPos.set(d.position.x, d.position.y, d.position.z);
        tmpEuler.set(d.tiltX, d.heading, d.tiltZ, 'YXZ');
        tmpQuat.setFromEuler(tmpEuler);
        tmpScale.set(s, s, s);
        tmpMatrix.compose(tmpPos, tmpQuat, tmpScale);
        body.setMatrixAt(k, tmpMatrix);

        // 旋翼:跟随机身姿态 + 绕自身轴高速自转
        const grounded = d.status === DroneStatus.Failure && d.position.y <= 0.7;
        for (let m = 0; m < rotorMounts.length; m++) {
          const mount = rotorMounts[m];
          tmpPos.copy(mount).multiplyScalar(s).applyQuaternion(tmpQuat);
          tmpPos.x += d.position.x;
          tmpPos.y += d.position.y;
          tmpPos.z += d.position.z;
          const spin = d.rotorPhase * (m % 2 === 0 ? 1 : -1) + m * 1.7;
          tmpSpinQuat.setFromAxisAngle(Y_AXIS, spin);
          tmpRotorQuat.copy(tmpQuat).multiply(tmpSpinQuat);
          tmpScale.set(s, s, s);
          tmpMatrix.compose(tmpPos, tmpRotorQuat, tmpScale);
          blades.setMatrixAt(k * rotorMounts.length + m, tmpMatrix);

          // 桨盘:仅在旋翼转动时可见(坠地机缩为零)
          const discScale = grounded ? 0 : s;
          tmpScale.set(discScale, discScale, discScale);
          tmpMatrix.compose(tmpPos, tmpQuat, tmpScale);
          discs.setMatrixAt(k * rotorMounts.length + m, tmpMatrix);
        }

        // 航灯:置于机身下方,故障机变红闪烁,低电量橙色慢闪
        tmpPos.set(d.position.x, d.position.y - 0.28 * s, d.position.z);
        const lightScale = s * (1 + 0.18 * Math.sin(time * 5 + d.id));
        tmpScale.set(lightScale, lightScale, lightScale);
        tmpMatrix.compose(tmpPos, tmpQuat, tmpScale);
        lights.setMatrixAt(k, tmpMatrix);

        if (d.status === DroneStatus.Failure) {
          const blink = Math.sin(time * 14 + d.id) > 0 ? 1 : 0.08;
          tmpColor.setRGB(blink, blink * 0.08, blink * 0.05);
        } else if (d.battery < 0.18) {
          const blink = Math.sin(time * 3 + d.id) > -0.2 ? 1 : 0.3;
          tmpColor.setHex(0xff7722).multiplyScalar(blink);
        } else {
          tmpColor.setHex(d.spec.lightColor);
        }
        lights.setColorAt(k, tmpColor);
      }

      body.instanceMatrix.needsUpdate = true;
      blades.instanceMatrix.needsUpdate = true;
      discs.instanceMatrix.needsUpdate = true;
      lights.instanceMatrix.needsUpdate = true;
      if (lights.instanceColor) lights.instanceColor.needsUpdate = true;
    }

    // 选中高亮圈
    if (this.selectedDroneId !== null) {
      const d = drones.find((x) => x.id === this.selectedDroneId);
      if (d) {
        this.selectionRing.visible = true;
        this.selectionRing.position.set(d.position.x, d.position.y, d.position.z);
        this.selectionRing.rotation.set(Math.PI / 2, 0, time * 0.8);
        const pulse = 1 + 0.1 * Math.sin(time * 4);
        this.selectionRing.scale.setScalar(d.spec.scale * pulse);
      }
    } else {
      this.selectionRing.visible = false;
    }
  }

  /** 射线拾取:返回被点中的无人机,没有则 null */
  pick(raycaster: THREE.Raycaster): Drone | null {
    let best: Drone | null = null;
    let bestDist = Infinity;
    // 用包围球近似拾取(实例化网格 raycast 开销大且桨盘干扰)
    const ray = raycaster.ray;
    for (const d of this.drones) {
      tmpPos.set(d.position.x, d.position.y, d.position.z);
      const distToRay = ray.distanceToPoint(tmpPos);
      const pickRadius = Math.max(2.2, d.spec.radius * 1.6);
      if (distToRay < pickRadius) {
        const distAlong = tmpPos.sub(ray.origin).dot(ray.direction);
        if (distAlong > 0 && distAlong < bestDist) {
          bestDist = distAlong;
          best = d;
        }
      }
    }
    return best;
  }
}
