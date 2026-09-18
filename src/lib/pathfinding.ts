/**
 * 疏散可达性：在展厅 0.5 m 网格上做 BFS，并强制 1.5 m 通道净宽。
 *
 * 可通行性不是“一个点能否落进格子”，而是“以格心为中心、CLEARANCE(1.5 m)
 * 见方的疏散人流方块能否放下”：方块与任一展位实体（或实体墙段）正面积重叠
 * 即不可通行；仅边重合允许 —— 因此净宽正好 1.5 m 放行，小于 1.5 m 的水平、
 * 垂直缺口以及对角拐角窄口都无法通过（方块无法同时擦过两个膨胀后的角点）。
 *
 * 起点（展位正面接待点）特殊处理：接待点距自身立面仅 0.25 m，严格的 1.5 m
 * 方块会被“自己的展位”挡住。为此引入门阶层：在正面边外约 1 m 的带状区域内，
 * 判定时忽略该展位自身（但仍然计入墙与其他展位，且格心不得落在自身实体内部），
 * 使人能从门口踏出、沿自己立面挪到墙角再进入完整走廊；离开正面带后一律使用
 * 完整净空判定，故别人造成的窄缝绝不会因起步豁免而被穿过。
 *
 * 出口同样使用完整净空判定（不豁免任何展位）：展位盖住开口时目标格失效；
 * 开口空着时，净空方块可伸入墙上的开口（墙屏障在开口处断开），目标格可用。
 */
import type { Booth, ExitDef, Point } from '../types';
import {
  CLEARANCE,
  EXITS,
  HALL_HEIGHT,
  HALL_WIDTH,
  PATH_GRID,
} from '../constants';
import { exitTargetPoints, frontEdge, rectOf } from './geometry';
import type { Rect } from './geometry';

export interface PathResult {
  reachable: boolean;
  /** 可走路径（米坐标）；不可达时为空数组 */
  path: Point[];
  /** 调试/测试用：完整净空层被占的网格单元数 */
  blockedCellCount: number;
}

const EPS = 1e-9;
/** 接待点相对正面边的外移距离（与 geometry.receptionPoint 保持一致）。 */
const STANDOFF = 0.25;
/** 门阶带从正面边向外的覆盖深度：半个净空方块 + 接待点外移。 */
const DOOR_BAND = CLEARANCE / 2 + STANDOFF;

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
 * 判断某个网格单元（0.5 m 见方）本身是否被展位实体占据。
 * 这是“实体占据”判定（边相不算阻挡，允许贴边），用于出口封堵识别，
 * 不等同于寻路使用的 1.5 m 净空判定（见 isCorridorCellOpen）。
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

/** 以格心为中心、CLEARANCE 见方的净空方块。 */
function clearanceBox(cx: number, cy: number, g: number): Rect {
  const half = CLEARANCE / 2;
  return {
    x: cx * g + g / 2 - half,
    y: cy * g + g / 2 - half,
    w: CLEARANCE,
    h: CLEARANCE,
  };
}

/**
 * 实体墙屏障带：紧贴展厅外墙、位于厅外的矩形，在出口开口处断开。
 * 内缘与墙齐平，因此不占用任何室内空间（贴墙通道宽度不变），
 * 但能阻止净空方块在非出口处伸出墙外；开口处断开使方块可“进入”出口。
 */
function wallBarrierRects(exits: ExitDef[]): Rect[] {
  const bands: Rect[] = [];
  const margin = CLEARANCE + 1; // 足够厚，任意近墙格的方块都越不过去

  const cutHorizontal = (wall: 'north' | 'south', y0: number, y1: number) => {
    const gaps = exits
      .filter((e) => e.wall === wall)
      .map((e) => [e.start, e.end] as const)
      .sort((a, b) => a[0] - b[0]);
    let cursor = 0;
    for (const [s, e] of gaps) {
      if (s > cursor) bands.push({ x: cursor, y: y0, w: s - cursor, h: y1 - y0 });
      cursor = e;
    }
    if (cursor < HALL_WIDTH)
      bands.push({ x: cursor, y: y0, w: HALL_WIDTH - cursor, h: y1 - y0 });
  };

  cutHorizontal('north', -margin, 0);
  cutHorizontal('south', HALL_HEIGHT, HALL_HEIGHT + margin);
  // 西、东墙按当前出口配置为完整墙（无开口）。
  bands.push({ x: -margin, y: 0, w: margin, h: HALL_HEIGHT });
  bands.push({ x: HALL_WIDTH, y: 0, w: margin, h: HALL_HEIGHT });
  return bands;
}

/** 净空方块是否避开所有展位实体与墙屏障；ignoreId 指定的展位忽略（门阶起步用）。 */
function boxClearsSolids(
  box: Rect,
  booths: Booth[],
  walls: Rect[],
  ignoreId?: string,
): boolean {
  for (const b of booths) {
    if (b.id === ignoreId) continue;
    if (rectsTouchIntersect(box, rectOf(b))) return false;
  }
  for (const wall of walls) {
    if (rectsTouchIntersect(box, wall)) return false;
  }
  return true;
}

/**
 * 完整走廊层：1.5 m 净空方块避开全部展位（含自己）与实体墙。
 * 这是路径绝大部分格子使用的严格判定，也是窄缝/拐角封死的关键。
 */
function isCorridorCellOpen(
  cx: number,
  cy: number,
  cols: number,
  rows: number,
  g: number,
  booths: Booth[],
  walls: Rect[],
): boolean {
  if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) return false;
  return boxClearsSolids(clearanceBox(cx, cy, g), booths, walls);
}

function cellCenter(cx: number, cy: number, g: number): Point {
  return { x: cx * g + g / 2, y: cy * g + g / 2 };
}

/** 格心是否落在展位实体内部（正面积；边相不算）。门阶格不允许穿进自己展位。 */
function centerInsideBooth(cx: number, cy: number, g: number, b: Booth): boolean {
  const p = cellCenter(cx, cy, g);
  const r = rectOf(b);
  return (
    p.x > r.x + EPS &&
    p.x < r.x + r.w - EPS &&
    p.y > r.y + EPS &&
    p.y < r.y + r.h - EPS
  );
}

function distanceToSegment(p: Point, a: Point, c: Point): number {
  const dx = c.x - a.x;
  const dy = c.y - a.y;
  const len2 = dx * dx + dy * dy || 1;
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** 格心是否在某展位正面边外的门阶带内。 */
function withinDoorBand(
  cx: number,
  cy: number,
  g: number,
  self: Booth,
): boolean {
  const [p1, p2] = frontEdge(self);
  return distanceToSegment(cellCenter(cx, cy, g), p1, p2) <= DOOR_BAND + EPS;
}

/**
 * 门阶层：正面带内、不在自身实体内部、忽略自身后满足 1.5 m 净空
 * （墙与其他展位照常阻挡）。仅用于起步的若干格子。
 */
function isDoorstepCellOpen(
  cx: number,
  cy: number,
  cols: number,
  rows: number,
  g: number,
  booths: Booth[],
  walls: Rect[],
  self: Booth,
): boolean {
  if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) return false;
  if (centerInsideBooth(cx, cy, g, self)) return false;
  if (!withinDoorBand(cx, cy, g, self)) return false;
  return boxClearsSolids(clearanceBox(cx, cy, g), booths, walls, self.id);
}

function nearestCell(p: Point, g: number): { cx: number; cy: number } {
  return {
    cx: Math.round((p.x - g / 2) / g),
    cy: Math.round((p.y - g / 2) / g),
  };
}

/** 出口开口内侧网格是否被展位实体占据；任一目标格被占即视为出口被堵。 */
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

/** 未提供起步展位时的兜底：在起点附近 1~2 格找完整走廊空闲格。 */
function nearestFreeCorridorCell(
  cx: number,
  cy: number,
  cols: number,
  rows: number,
  g: number,
  booths: Booth[],
  walls: Rect[],
): { cx: number; cy: number } | null {
  for (let r = 1; r <= 2; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (isCorridorCellOpen(nx, ny, cols, rows, g, booths, walls)) {
          return { cx: nx, cy: ny };
        }
      }
    }
  }
  return null;
}

const NEIGHBORS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

/**
 * 从 start 寻路到任一出口。
 * @param booths 当前全部展位（障碍）
 * @param start 起点（通常是展位接待点）
 * @param self  起点所属展位：给出后启用正面“门阶”起步，忽略自身、不封起点；
 *              路径其余部分仍按完整 1.5 m 净空判定。
 */
export function findExitPath(
  booths: Booth[],
  start: Point,
  exits: ExitDef[] = EXITS,
  g: number = PATH_GRID,
  self?: Booth,
): PathResult {
  const cols = Math.round(HALL_WIDTH / g);
  const rows = Math.round(HALL_HEIGHT / g);
  const walls = wallBarrierRects(exits);

  // 完整走廊层障碍位图（调试计数 + 快速查表）。
  const corridorBlocked = new Uint8Array(cols * rows);
  let blockedCellCount = 0;
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      if (!isCorridorCellOpen(cx, cy, cols, rows, g, booths, walls)) {
        corridorBlocked[cy * cols + cx] = 1;
        blockedCellCount++;
      }
    }
  }

  // 出口目标：必须满足完整净空（任何展位盖住开口都会使其失效）。
  const targets = new Set<number>();
  for (const t of exitTargetPoints(exits)) {
    const c = nearestCell(t, g);
    if (
      c.cx >= 0 &&
      c.cx < cols &&
      c.cy >= 0 &&
      c.cy < rows &&
      isCorridorCellOpen(c.cx, c.cy, cols, rows, g, booths, walls)
    ) {
      targets.add(c.cy * cols + c.cx);
    }
  }

  // 播种可行走起点。
  const starts: { cx: number; cy: number }[] = [];
  if (self) {
    // 门阶层：正面带内所有忽略自身后可行的格子。
    for (let cy = 0; cy < rows; cy++) {
      for (let cx = 0; cx < cols; cx++) {
        if (isDoorstepCellOpen(cx, cy, cols, rows, g, booths, walls, self)) {
          starts.push({ cx, cy });
        }
      }
    }
  } else {
    const s = nearestCell(start, g);
    if (isCorridorCellOpen(s.cx, s.cy, cols, rows, g, booths, walls)) {
      starts.push(s);
    } else {
      const alt = nearestFreeCorridorCell(s.cx, s.cy, cols, rows, g, booths, walls);
      if (alt) starts.push(alt);
    }
  }
  if (!starts.length || !targets.size) {
    return { reachable: false, path: [], blockedCellCount };
  }

  // 格子是否可行走：完整走廊层 ∪ 自身门阶层。
  const cellOpen = (cx: number, cy: number): boolean => {
    if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) return false;
    if (!corridorBlocked[cy * cols + cx]) return true;
    return self
      ? isDoorstepCellOpen(cx, cy, cols, rows, g, booths, walls, self)
      : false;
  };

  // 多源 BFS。
  const prev = new Int32Array(cols * rows).fill(-1);
  const seen = new Uint8Array(cols * rows);
  const queue: number[] = [];
  for (const s of starts) {
    const idx = s.cy * cols + s.cx;
    if (!seen[idx]) {
      seen[idx] = 1;
      queue.push(idx);
    }
  }

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
      const nIdx = ny * cols + nx;
      if (seen[nIdx] || !cellOpen(nx, ny)) continue;
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
    cur = prev[cur];
  }
  cells.reverse();
  const path: Point[] = cells.map((idx) =>
    cellCenter(idx % cols, Math.floor(idx / cols), g),
  );
  // 首点用真实接待点，路径从展位正面出发而不是格子中心。
  path[0] = start;

  return { reachable: true, path, blockedCellCount };
}
