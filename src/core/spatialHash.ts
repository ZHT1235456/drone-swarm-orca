import { Vec3 } from './vec3';

/**
 * 均匀网格空间哈希,用于 O(n) 近邻查询。
 * 每帧 rebuild 一次,查询时扫描目标点周围 3x3x3 单元。
 */
export class SpatialHash {
  private cells = new Map<number, number[]>();
  private readonly invCellSize: number;

  constructor(cellSize: number) {
    this.invCellSize = 1 / cellSize;
  }

  private key(cx: number, cy: number, cz: number): number {
    // 大质数散列,支持负坐标
    return ((cx * 73856093) ^ (cy * 19349663) ^ (cz * 83492791)) | 0;
  }

  clear(): void {
    this.cells.clear();
  }

  insert(index: number, pos: Vec3): void {
    const cx = Math.floor(pos.x * this.invCellSize);
    const cy = Math.floor(pos.y * this.invCellSize);
    const cz = Math.floor(pos.z * this.invCellSize);
    const k = this.key(cx, cy, cz);
    let cell = this.cells.get(k);
    if (!cell) {
      cell = [];
      this.cells.set(k, cell);
    }
    cell.push(index);
  }

  /**
   * 查询 pos 周围 radius 范围内的候选索引(写入 out,返回数量)。
   * 结果为粗筛(单元级),调用方需再做精确距离过滤。
   */
  query(pos: Vec3, radius: number, out: number[]): number {
    let count = 0;
    const minX = Math.floor((pos.x - radius) * this.invCellSize);
    const maxX = Math.floor((pos.x + radius) * this.invCellSize);
    const minY = Math.floor((pos.y - radius) * this.invCellSize);
    const maxY = Math.floor((pos.y + radius) * this.invCellSize);
    const minZ = Math.floor((pos.z - radius) * this.invCellSize);
    const maxZ = Math.floor((pos.z + radius) * this.invCellSize);

    for (let cx = minX; cx <= maxX; cx++) {
      for (let cy = minY; cy <= maxY; cy++) {
        for (let cz = minZ; cz <= maxZ; cz++) {
          const cell = this.cells.get(this.key(cx, cy, cz));
          if (!cell) continue;
          for (let i = 0; i < cell.length; i++) {
            out[count++] = cell[i];
          }
        }
      }
    }
    return count;
  }
}
