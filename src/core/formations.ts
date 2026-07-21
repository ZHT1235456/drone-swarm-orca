import { Vec3 } from './vec3';
import { Drone, DroneType } from './drone';

/** 队形标识 */
export type FormationId =
  | 'launch-grid'
  | 'sphere'
  | 'helix'
  | 'rings'
  | 'phalanx'
  | 'starburst'
  | 'text';

export interface FormationInfo {
  id: FormationId;
  nameZh: string;
}

export const FORMATIONS: FormationInfo[] = [
  { id: 'launch-grid', nameZh: '地面待命阵列' },
  { id: 'sphere', nameZh: '球面警戒' },
  { id: 'helix', nameZh: '双螺旋升空' },
  { id: 'rings', nameZh: '分层环形' },
  { id: 'phalanx', nameZh: '楔形突击' },
  { id: 'starburst', nameZh: '星爆散开' },
  { id: 'text', nameZh: '灯光文字' },
];

const CENTER_Y = 60;

/**
 * 生成 count 个队形目标点。
 * 部分队形按机型分层:运输机在内/低层,侦察机在外/高层,中继机居中。
 */
export function generateFormation(
  id: FormationId,
  drones: Drone[],
): Vec3[] {
  const n = drones.length;
  switch (id) {
    case 'launch-grid': return launchGrid(n);
    case 'sphere': return sphere(n);
    case 'helix': return helix(n);
    case 'rings': return rings(drones);
    case 'phalanx': return phalanx(drones);
    case 'starburst': return starburst(n);
    case 'text': return textFormation(n);
  }
}

function launchGrid(n: number): Vec3[] {
  const points: Vec3[] = [];
  const cols = Math.ceil(Math.sqrt(n * 1.4));
  const spacing = 7;
  const rows = Math.ceil(n / cols);
  for (let i = 0; i < n; i++) {
    const r = Math.floor(i / cols);
    const c = i % cols;
    points.push(new Vec3(
      (c - (cols - 1) / 2) * spacing,
      2.5,
      (r - (rows - 1) / 2) * spacing,
    ));
  }
  return points;
}

/** 斐波那契球面均匀分布 */
function sphere(n: number): Vec3[] {
  const points: Vec3[] = [];
  const radius = Math.max(38, Math.sqrt(n) * 4.6);
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / Math.max(1, n - 1)) * 2;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = golden * i;
    points.push(new Vec3(
      Math.cos(theta) * r * radius,
      CENTER_Y + y * radius * 0.85,
      Math.sin(theta) * r * radius,
    ));
  }
  return points;
}

function helix(n: number): Vec3[] {
  const points: Vec3[] = [];
  const turns = 3.2;
  const height = 95;
  const radius = 34;
  const half = Math.ceil(n / 2);
  for (let i = 0; i < n; i++) {
    const strand = i < half ? 0 : 1;
    const j = strand === 0 ? i : i - half;
    const strandCount = strand === 0 ? half : n - half;
    const t = j / Math.max(1, strandCount - 1);
    const angle = t * turns * Math.PI * 2 + strand * Math.PI;
    points.push(new Vec3(
      Math.cos(angle) * radius,
      14 + t * height,
      Math.sin(angle) * radius,
    ));
  }
  return points;
}

/** 分层环:运输机内环低层,中继机中环,侦察机外环高层 */
function rings(drones: Drone[]): Vec3[] {
  const groups: number[][] = [[], [], []];
  drones.forEach((d, i) => groups[d.type].push(i));

  const points: Vec3[] = new Array(drones.length);
  const layerCfg = [
    { indices: groups[DroneType.Cargo], radius: 22, y: CENTER_Y - 20 },
    { indices: groups[DroneType.Relay], radius: 40, y: CENTER_Y },
    { indices: groups[DroneType.Scout], radius: 58, y: CENTER_Y + 20 },
  ];

  for (const layer of layerCfg) {
    const m = layer.indices.length;
    // 每层可能拆成同心双环避免过密
    const maxPerRing = Math.floor((2 * Math.PI * layer.radius) / 9);
    const ringCount = Math.max(1, Math.ceil(m / maxPerRing));
    for (let k = 0; k < m; k++) {
      const ring = k % ringCount;
      const idxInRing = Math.floor(k / ringCount);
      const perRing = Math.ceil(m / ringCount);
      const angle = (idxInRing / perRing) * Math.PI * 2 + ring * 0.35;
      const r = layer.radius + ring * 10;
      points[layer.indices[k]] = new Vec3(
        Math.cos(angle) * r,
        layer.y + ring * 5,
        Math.sin(angle) * r,
      );
    }
  }
  return points;
}

/** 楔形(V 字)编队:运输机居中受护航,侦察机在两翼 */
function phalanx(drones: Drone[]): Vec3[] {
  const groups: number[][] = [[], [], []];
  drones.forEach((d, i) => groups[d.type].push(i));

  const points: Vec3[] = new Array(drones.length);
  const wedgeAngle = Math.PI / 5;
  const spacing = 6.5;

  // 运输机:中轴纵队
  groups[DroneType.Cargo].forEach((di, k) => {
    points[di] = new Vec3(0, CENTER_Y - 6 + (k % 2) * 5, 14 + k * spacing);
  });
  // 中继机:紧贴两侧
  groups[DroneType.Relay].forEach((di, k) => {
    const side = k % 2 === 0 ? 1 : -1;
    const row = Math.floor(k / 2);
    points[di] = new Vec3(side * 12, CENTER_Y + 4, 18 + row * spacing);
  });
  // 侦察机:V 字两翼向前展开
  groups[DroneType.Scout].forEach((di, k) => {
    const side = k % 2 === 0 ? 1 : -1;
    const row = Math.floor(k / 2) + 1;
    points[di] = new Vec3(
      side * Math.sin(wedgeAngle) * row * spacing,
      CENTER_Y + 10 + (row % 3) * 4,
      -row * Math.cos(wedgeAngle) * spacing,
    );
  });
  return points;
}

/** 星爆:多条从中心辐射的射线 */
function starburst(n: number): Vec3[] {
  const points: Vec3[] = [];
  const arms = 8;
  const perArm = Math.ceil(n / arms);
  for (let i = 0; i < n; i++) {
    const arm = i % arms;
    const k = Math.floor(i / arms);
    const t = (k + 1) / perArm;
    const armAngle = (arm / arms) * Math.PI * 2;
    const pitch = ((arm % 4) - 1.5) * 0.36;
    const dist = 14 + t * 72;
    points.push(new Vec3(
      Math.cos(armAngle) * Math.cos(pitch) * dist,
      CENTER_Y + Math.sin(pitch) * dist,
      Math.sin(armAngle) * Math.cos(pitch) * dist,
    ));
  }
  return points;
}

/** 灯光文字:点阵 "UAV" */
const TEXT_GLYPHS: Record<string, string[]> = {
  U: ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  V: ['#...#', '#...#', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
};

function textFormation(n: number): Vec3[] {
  // 收集 "UAV" 的点阵坐标
  const cells: { x: number; y: number }[] = [];
  const text = 'UAV';
  let offsetX = 0;
  for (const ch of text) {
    const glyph = TEXT_GLYPHS[ch];
    for (let row = 0; row < glyph.length; row++) {
      for (let col = 0; col < glyph[row].length; col++) {
        if (glyph[row][col] === '#') {
          cells.push({ x: offsetX + col, y: glyph.length - 1 - row });
        }
      }
    }
    offsetX += glyph[0].length + 2;
  }

  const cellSize = 9;
  const width = offsetX - 2;
  const points: Vec3[] = [];
  for (let i = 0; i < n; i++) {
    const cell = cells[i % cells.length];
    // 多余的机在同一点阵位置沿 Z 轴排开
    const layer = Math.floor(i / cells.length);
    points.push(new Vec3(
      (cell.x - width / 2) * cellSize,
      36 + cell.y * cellSize,
      layer * 12 - 6,
    ));
  }
  return points;
}

/**
 * 贪心目标分配:每次取"最远者优先"分配最近目标,
 * 比匈牙利算法快得多,300 架规模下效果足够好。
 * 仅在同机型内部互换目标,保证机型分层队形的语义。
 */
export function assignTargets(drones: Drone[], targets: Vec3[]): void {
  // rings/phalanx 等按索引生成的队形已经与机型对应,直接赋值;
  // 之后做同型近邻交换优化,减少交叉飞行。
  for (let i = 0; i < drones.length; i++) {
    drones[i].target.copy(targets[i]);
  }

  // 2-opt 交换:同机型之间,若交换目标能降低总距离则交换
  const byType: number[][] = [[], [], []];
  drones.forEach((d, i) => byType[d.type].push(i));

  for (const group of byType) {
    let improved = true;
    let iterations = 0;
    while (improved && iterations < 4) {
      improved = false;
      iterations++;
      for (let a = 0; a < group.length; a++) {
        for (let b = a + 1; b < group.length; b++) {
          const da = drones[group[a]];
          const db = drones[group[b]];
          const cur = da.position.distanceToSq(da.target) + db.position.distanceToSq(db.target);
          const swapped = da.position.distanceToSq(db.target) + db.position.distanceToSq(da.target);
          if (swapped < cur - 1e-3) {
            const tmp = da.target.clone();
            da.target.copy(db.target);
            db.target.copy(tmp);
            improved = true;
          }
        }
      }
    }
  }
}
