/**
 * 疏散可达性：在展厅 0.5 m 网格上做 BFS。
 *
 * 通道净宽规则（与净空检查一致）：可行走格子的中心必须位于所有展位/围挡
 * 向外膨胀 CLEARANCE/2（0.75 m）后的区域之外；恰好落在膨胀边界上
 * （距离障碍正好 0.75 m）仍然允许通行。这样两条障碍之间不足 1.5 m 的
 * 水平、垂直或拐角窄口都不可通过，正好 1.5 m 的通道恰好容下一条中线。
 * 展厅外墙不膨胀（出口开在墙上，路径必须能贴墙进入出口）。
 *
 * 接待点从展位正面出发：接待点距本展位只有 0.25 m，必然落在“自身膨胀区”
 * 内，因此起点格允许被膨胀区覆盖（否则每个展位都被自己的安全距离封死）；
 * 但第一步之后必须落在真正满足净宽的格子上。
 */
import type { Booth, ExitDef, Point } from '../types';
import {
  CLEARANCE,
  EXITS,
  HALL_HEIGHT,
  HALL_WIDTH,
  PATH_GRID,
} from '../constants';
import { exitTargetPoints, rectOf } from './geometry';
import type { Rect } from './geometry';

export interface PathResult {
  reachable: boolean;
  /** 可走路径（米坐标）；不可达时为空数组 */
  path: Point[];
  /** 调试/测试用：本次搜索的障碍信息 */
  blockedCellCount: number;
}

const EPS = 1e-9;

/** 障碍向四周膨胀的距离：净宽要求的一半。 */
const INFLATE = CLEARANCE / 2;

/** 出口开口内侧网格是否全部可通行；任一目标格被展位占据即视为出口被堵。 */
export function exitBlockingBooth(
  booths: Booth[],
  exitDef: ExitDef,
  g: number = PATH_GRID,
): Booth | null {
  const cols = Math.round(HALL_WIDTH / g);
  const rows = Math.round(HALL_HEIGHT / g);
  for (const t of exitTargetPoints([exitDef])) {
    const c = nearestCell(t, g);
    if (isBlockedCell(c.cx, c.cy, booths, cols, rows, g)) {
      const cell = cellRect(c.cx, c.cy, g);
      const hit = booths.find((b) => rectsTouchIntersect(cell, rectOf(b)));
      if (hit) return hit;
    }
  }
  return null;
}

function cellRect(cx: number, cy: number, g: number): Rect {
  return { x: cx * g, y: cy * g, w: g, h: g };
}

function rectsTouchIntersect(a: Rect, b: Rect): boolean {
  // 与 geometry.intersects 同规则：仅边重合（可贴边）不算相交。
  return (
    a.x < b.x + b.w - EPS &&
    a.x + a.w > b.x + EPS &&
    a.y < b.y + b.h - EPS &&
    a.y + a.h > b.y + EPS
  );
}

/**
 * 判断某个网格单元是否被展位实体占据（不考虑净宽膨胀）。
 * 用于出口封堵判定与测试；寻路通行性请用 isPassageCell。
 */
export function isBlockedCell(
  cx: number,
  cy: number,
  booths: Booth[],
  cols: number,
  rows: number,
  g: number = PATH_GRID,
): boolean {
  if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) return true;
  const cell = cellRect(cx, cy, g);
  for (const b of booths) {
    if (rectsTouchIntersect(cell, rectOf(b))) return true;
  }
  return false;
}

/**
 * 判断某个网格单元是否满足 1.5 m 通道净宽、可以行走。
 * 格心落在任一展位/围挡膨胀 CLEARANCE/2 后的区域内部即不可通行；
 * 恰好落在膨胀边界上（距障碍正好 0.75 m）允许通行——
 * 两条障碍之间正好 1.5 m 的通道因此保留一条中线。
 */
export function isPassageCell(
  cx: number,
  cy: number,
  booths: Booth[],
  cols: number,
  rows: number,
  g: number = PATH_GRID,
): boolean {
  if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) return false;
  const px = cx * g + g / 2;
  const py = cy * g + g / 2;
  for (const b of booths) {
    const r = rectOf(b);
    if (
      px > r.x - INFLATE + EPS &&
      px < r.x + r.w + INFLATE - EPS &&
      py > r.y - INFLATE + EPS &&
      py < r.y + r.h + INFLATE - EPS
    ) {
      return false;
    }
  }
  return true;
}

function nearestCell(p: Point, g: number): { cx: number; cy: number } {
  return {
    cx: Math.round((p.x - g / 2) / g),
    cy: Math.round((p.y - g / 2) / g),
  };
}

/**
 * 从 start 寻路到任一出口。
 * @param booths 当前全部展位（障碍）
 * @param start 起点（通常是展位接待点）
 */
export function findExitPath(
  booths: Booth[],
  start: Point,
  exits = EXITS,
  g: number = PATH_GRID,
): PathResult {
  const cols = Math.round(HALL_WIDTH / g);
  const rows = Math.round(HALL_HEIGHT / g);

  // 预计算通行位图（展位越界部分自然落在网格外，不影响室内单元）。
  const blocked = new Uint8Array(cols * rows);
  let blockedCellCount = 0;
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      if (!isPassageCell(cx, cy, booths, cols, rows, g)) {
        blocked[cy * cols + cx] = 1;
        blockedCellCount++;
      }
    }
  }

  const s = nearestCell(start, g);
  let startCell = s;
  if (s.cx < 0 || s.cy < 0 || s.cx >= cols || s.cy >= rows) {
    // 接待点落在展厅外（正面贴墙）：退回最近的可行走单元。
    const alt = nearestFreeNeighbor(s.cx, s.cy, blocked, cols, rows);
    if (!alt) {
      return { reachable: false, path: [], blockedCellCount };
    }
    startCell = alt;
  }
  // 起点格在展厅内时即使被膨胀区覆盖也直接作为起点：
  // 接待点紧贴本展位正面，本就在安全距离之内；但后续每步都必须可通行。
  const startIdx = startCell.cy * cols + startCell.cx;

  const targets = new Set<number>();
  for (const t of exitTargetPoints(exits)) {
    const c = nearestCell(t, g);
    if (c.cx >= 0 && c.cx < cols && c.cy >= 0 && c.cy < rows) {
      targets.add(c.cy * cols + c.cx);
    }
  }

  // BFS
  const prev = new Int32Array(cols * rows).fill(-1);
  const seen = new Uint8Array(cols * rows);
  const queue: number[] = [];
  seen[startIdx] = 1;
  queue.push(startIdx);

  const NEIGHBORS = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];

  let goalIdx = -1;
  while (queue.length) {
    const idx = queue.shift()!;
    if (targets.has(idx)) {
      goalIdx = idx;
      break;
    }
    const cx = idx % cols;
    const cy = Math.floor(idx / cols);
    for (const [dx, dy] of NEIGHBORS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
      const nIdx = ny * cols + nx;
      if (seen[nIdx] || blocked[nIdx]) continue;
      seen[nIdx] = 1;
      prev[nIdx] = idx;
      queue.push(nIdx);
    }
  }

  if (goalIdx === -1) {
    return { reachable: false, path: [], blockedCellCount };
  }

  // 回溯路径并转为米坐标（单元中心）。
  const cells: number[] = [];
  let cur = goalIdx;
  while (cur !== -1) {
    cells.push(cur);
    if (cur === startIdx) break;
    cur = prev[cur];
  }
  cells.reverse();
  const path: Point[] = cells.map((idx) => ({
    x: (idx % cols) * g + g / 2,
    y: Math.floor(idx / cols) * g + g / 2,
  }));
  // 首点用真实接待点，路径从展位正面出发而不是格子中心。
  path[0] = start;

  return { reachable: true, path, blockedCellCount };
}

function nearestFreeNeighbor(
  cx: number,
  cy: number,
  blocked: Uint8Array,
  cols: number,
  rows: number,
): { cx: number; cy: number } | null {
  for (let r = 1; r <= 2; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        if (!blocked[ny * cols + nx]) return { cx: nx, cy: ny };
      }
    }
  }
  return null;
}
