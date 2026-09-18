import { describe, it, expect } from 'vitest';
import type { Booth } from '../types';
import { EXITS, HALL_HEIGHT, HALL_WIDTH, PATH_GRID } from '../constants';
import {
  exitBlockingBooth,
  findExitPath,
  isBlockedCell,
  isPassageCell,
} from './pathfinding';
import { exitTargetPoints, receptionPoint } from './geometry';

function booth(p: Partial<Booth> & Pick<Partial<Booth>, never>): Booth {
  return {
    id: p.id ?? 'b',
    x: p.x ?? 0,
    y: p.y ?? 0,
    w: p.w ?? 2,
    h: p.h ?? 2,
    orientation: p.orientation ?? 'south',
    label: p.label ?? 'T',
    color: '#000',
    kind: p.kind ?? 'booth',
  };
}

describe('findExitPath 疏散寻路', () => {
  it('空展厅：任意接待点可达出口，路径起点正确', () => {
    const b = booth({ x: 9, y: 6, w: 2, h: 2, orientation: 'south' });
    const start = receptionPoint(b);
    const r = findExitPath([b], start);
    expect(r.reachable).toBe(true);
    expect(r.path.length).toBeGreaterThan(1);
    expect(r.path[0]).toEqual(start);
  });

  it('路径终点落在某个出口开口内侧', () => {
    const b = booth({ x: 9, y: 6 });
    const r = findExitPath([b], receptionPoint(b));
    const end = r.path[r.path.length - 1];
    const targets = exitTargetPoints(EXITS);
    const close = targets.some(
      (t) => Math.abs(t.x - end.x) <= PATH_GRID && Math.abs(t.y - end.y) <= PATH_GRID,
    );
    expect(close).toBe(true);
  });

  it('路径每一步都在展厅内、4 邻接且不穿越展位', () => {
    const obstacle = booth({ id: 'o', x: 5, y: 4, w: 3, h: 5 });
    const b = booth({ id: 's', x: 1, y: 1, orientation: 'east' });
    const r = findExitPath([obstacle, b], receptionPoint(b));
    expect(r.reachable).toBe(true);

    const cols = Math.round(HALL_WIDTH / PATH_GRID);
    const rows = Math.round(HALL_HEIGHT / PATH_GRID);
    // path[0] 是真实接待点（不必在格心），从第 2 个点开始检验格间 4 邻接
    for (let i = 1; i < r.path.length; i++) {
      const p = r.path[i];
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(HALL_WIDTH);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(HALL_HEIGHT);
      // 单元中心对齐 0.5m 网格
      expect((p.x - PATH_GRID / 2) % PATH_GRID).toBeCloseTo(0, 6);
      expect((p.y - PATH_GRID / 2) % PATH_GRID).toBeCloseTo(0, 6);
      // 不落在障碍单元
      const cx = Math.round((p.x - PATH_GRID / 2) / PATH_GRID);
      const cy = Math.round((p.y - PATH_GRID / 2) / PATH_GRID);
      expect(isBlockedCell(cx, cy, [obstacle], cols, rows)).toBe(false);
      if (i >= 2) {
        // 相邻格心恰好在一个方向移动一格（4 邻接）
        const prev = r.path[i - 1];
        const manhattan =
          Math.abs(p.x - prev.x) / PATH_GRID +
          Math.abs(p.y - prev.y) / PATH_GRID;
        expect(Math.round(manhattan)).toBe(1);
      }
    }
  });

  it('四面围挡封闭：区内接待点不可达任一出口', () => {
    // 封闭区 [3,7.5] × [3,7.5]，墙厚 0.5，与网格对齐
    const walls: Booth[] = [
      booth({ id: 'wn', x: 3, y: 3, w: 4.5, h: 0.5, kind: 'partition' }),
      booth({ id: 'ws', x: 3, y: 7, w: 4.5, h: 0.5, kind: 'partition' }),
      booth({ id: 'ww', x: 3, y: 3, w: 0.5, h: 4.5, kind: 'partition' }),
      booth({ id: 'we', x: 7, y: 3, w: 0.5, h: 4.5, kind: 'partition' }),
    ];
    const inside = booth({ id: 'in', x: 4.5, y: 4.5, w: 2, h: 2, orientation: 'south' });
    const r = findExitPath([...walls, inside], receptionPoint(inside));
    expect(r.reachable).toBe(false);
    expect(r.path).toEqual([]);
  });

  it('围挡打开 1.5m 缺口后立即可达（必须从缺口绕行）', () => {
    // 封闭区 [2.5,8]×[2.5,8]，西墙在 y 6..7.5 留下正好 1.5m 的缺口；
    // 区内展位与四壁之间均保持正好 1.5m 净宽。
    const walls: Booth[] = [
      booth({ id: 'wn', x: 2.5, y: 2.5, w: 5.5, h: 0.5, kind: 'partition' }),
      booth({ id: 'ws', x: 2.5, y: 7.5, w: 5.5, h: 0.5, kind: 'partition' }),
      // 西墙只盖到 y=6，在 y 6..7.5 留缺口
      booth({ id: 'ww', x: 2.5, y: 2.5, w: 0.5, h: 3.5, kind: 'partition' }),
      booth({ id: 'we', x: 7.5, y: 2.5, w: 0.5, h: 5.5, kind: 'partition' }),
    ];
    const inside = booth({ id: 'in', x: 4.5, y: 4.5, w: 1.5, h: 1.5, orientation: 'south' });
    const r = findExitPath([...walls, inside], receptionPoint(inside));
    expect(r.reachable).toBe(true);
    // 路径必须经过 x≈2.75 的缺口列（y 在 6~7.5 之间）
    const throughGap = r.path.some(
      (p) => Math.abs(p.x - 2.75) < PATH_GRID && p.y >= 6 && p.y <= 7.5,
    );
    expect(throughGap).toBe(true);
  });

  it('围挡缺口只有 1m 时，封闭区内接待点不可达', () => {
    // 同上封闭区，但西墙延伸到 y=6.5，缺口 y 6.5..7.5 只剩 1m
    const walls: Booth[] = [
      booth({ id: 'wn', x: 2.5, y: 2.5, w: 5.5, h: 0.5, kind: 'partition' }),
      booth({ id: 'ws', x: 2.5, y: 7.5, w: 5.5, h: 0.5, kind: 'partition' }),
      booth({ id: 'ww', x: 2.5, y: 2.5, w: 0.5, h: 4, kind: 'partition' }),
      booth({ id: 'we', x: 7.5, y: 2.5, w: 0.5, h: 5.5, kind: 'partition' }),
    ];
    const inside = booth({ id: 'in', x: 4.5, y: 4.5, w: 1.5, h: 1.5, orientation: 'south' });
    const r = findExitPath([...walls, inside], receptionPoint(inside));
    expect(r.reachable).toBe(false);
    expect(r.path).toEqual([]);
  });

  it('隔断只在右端留 1m 缺口、且南出口被封时，必须绕缺口去北出口', () => {
    // 横贯展厅的隔断，只在最右端 x19..20 留 1m 通道
    const wall = booth({ id: 'wall', x: 0, y: 6.5, w: 19, h: 1, kind: 'partition' });
    // 南出口同时被封住（盖住开口 x3..5 并覆盖边界目标格）
    const southBlocker = booth({ id: 'sb', x: 2.5, y: 12, w: 3, h: 2 });
    const b = booth({ id: 's', x: 9, y: 9, w: 2, h: 2, orientation: 'south' });
    const r = findExitPath([wall, southBlocker, b], receptionPoint(b));
    expect(r.reachable).toBe(true);
    // 路径不能穿越隔断实体（y∈(6.5,7.5) 且 x<19）；缺口列 x≥19 内通过是合法的
    const crossing = r.path.filter((p) => p.y > 6.5 && p.y < 7.5 && p.x < 19);
    expect(crossing.length).toBe(0);
    // 必须绕到右端缺口（墙止于 x=19，缺口内格心 19.25）
    expect(r.path.some((p) => p.x >= 19)).toBe(true);
    // 终点在北出口
    const end = r.path[r.path.length - 1];
    expect(end.y).toBeLessThan(1);
    expect(end.x).toBeGreaterThanOrEqual(14);
    expect(end.x).toBeLessThanOrEqual(16.5);
  });
});

describe('exitBlockingBooth 出口封堵识别', () => {
  it('展位压住南出口开口时识别为封堵展位', () => {
    const blocker = booth({ id: 'blk', x: 2.5, y: 12, w: 3, h: 2 });
    const south = EXITS.find((e) => e.wall === 'south')!;
    const north = EXITS.find((e) => e.wall === 'north')!;
    expect(exitBlockingBooth([blocker], south)?.id).toBe('blk');
    expect(exitBlockingBooth([blocker], north)).toBeNull();
  });

  it('展位只贴墙但不盖开口不算封堵', () => {
    const beside = booth({ x: 6, y: 12.5, w: 2, h: 1.5 }); // 在南出口 x3..5 旁边
    const south = EXITS.find((e) => e.wall === 'south')!;
    expect(exitBlockingBooth([beside], south)).toBeNull();
  });

  it('南出口被封时，展位仍可通过北出口疏散', () => {
    const blocker = booth({ id: 'blk', x: 2.5, y: 12, w: 3, h: 2 });
    const b = booth({ id: 's', x: 1, y: 1, w: 2, h: 2, orientation: 'south' });
    const r = findExitPath([blocker, b], receptionPoint(b));
    expect(r.reachable).toBe(true);
    // 终点应在北墙附近而不是南墙
    const end = r.path[r.path.length - 1];
    expect(end.y).toBeLessThan(1);
  });
});

describe('isPassageCell 通道净宽边界', () => {
  const cols = Math.round(HALL_WIDTH / PATH_GRID);
  const rows = Math.round(HALL_HEIGHT / PATH_GRID);

  it('正好 1.5m 的缝隙保留中线，1m 的缝隙完全封死', () => {
    const left = booth({ id: 'l', x: 0, y: 0, w: 7, h: 2, kind: 'partition' });
    // 缝隙 x 7..8.5 = 1.5m：中线 x=7.75 所在列可通行
    const right15 = booth({ id: 'r', x: 8.5, y: 0, w: 2, h: 2, kind: 'partition' });
    expect(isPassageCell(15, 2, [left, right15], cols, rows)).toBe(true); // 格心 (7.75, 1.25)
    // 缝隙 x 7..8 = 1.0m：缝隙内所有格子都不可通行
    const right10 = booth({ id: 'r', x: 8, y: 0, w: 2, h: 2, kind: 'partition' });
    expect(isPassageCell(14, 2, [left, right10], cols, rows)).toBe(false); // (7.25, 1.25)
    expect(isPassageCell(15, 2, [left, right10], cols, rows)).toBe(false); // (7.75, 1.25)
  });

  it('距障碍正好 0.75m（膨胀边界）的格子可通行，更近则不行', () => {
    const b = booth({ id: 'b', x: 5, y: 5, w: 2, h: 2 });
    // 格心 (7.75, 6.25)：距展位右边缘 x=7 正好 0.75m
    expect(isPassageCell(15, 12, [b], cols, rows)).toBe(true);
    // 格心 (7.25, 6.25)：距右边缘只有 0.25m
    expect(isPassageCell(14, 12, [b], cols, rows)).toBe(false);
  });
});

describe('通道净宽 1.5m 规则', () => {
  it('垂直窄缝：1m 不可通过，加宽到 1.5m 后沿中线通过', () => {
    // 横贯展厅的隔断，中间留垂直缝隙；南出口被封，南侧展位只能穿缝去北出口
    const southBlocker = booth({ id: 'sb', x: 2.5, y: 12, w: 3, h: 2 });
    const mkWalls = (gapStart: number): Booth[] => [
      booth({ id: 'w1', x: 0, y: 6, w: 7, h: 1, kind: 'partition' }),
      booth({ id: 'w2', x: gapStart, y: 6, w: 20 - gapStart, h: 1, kind: 'partition' }),
    ];
    const b = booth({ id: 's', x: 10, y: 9, w: 2, h: 2, orientation: 'south' });

    // 缝隙 x 7..8 = 1m：不可通过，南北都不通 → 不可达
    const narrow = findExitPath(
      [...mkWalls(8), southBlocker, b],
      receptionPoint(b),
    );
    expect(narrow.reachable).toBe(false);

    // 缝隙 x 7..8.5 = 1.5m：沿中线 x=7.75 通过，终点在北出口
    const wide = findExitPath(
      [...mkWalls(8.5), southBlocker, b],
      receptionPoint(b),
    );
    expect(wide.reachable).toBe(true);
    const end = wide.path[wide.path.length - 1];
    expect(end.y).toBeLessThan(1);
    expect(
      wide.path.some((p) => Math.abs(p.x - 7.75) < 1e-9 && p.y > 6 && p.y < 7),
    ).toBe(true);
  });

  it('水平窄缝：1m 不可通过，加宽到 1.5m 后沿中线通过', () => {
    // 纵贯展厅的隔断，中间留水平缝隙；南出口被封，西侧展位必须穿缝去北出口
    const southBlocker = booth({ id: 'sb', x: 2.5, y: 12, w: 3, h: 2 });
    const mkWalls = (gapEnd: number): Booth[] => [
      booth({ id: 'w1', x: 6, y: 0, w: 1, h: 5, kind: 'partition' }),
      booth({ id: 'w2', x: 6, y: gapEnd, w: 1, h: 14 - gapEnd, kind: 'partition' }),
    ];
    const b = booth({ id: 's', x: 2, y: 8, w: 2, h: 2, orientation: 'south' });

    // 缝隙 y 5..6 = 1m：不可通过
    const narrow = findExitPath(
      [...mkWalls(6), southBlocker, b],
      receptionPoint(b),
    );
    expect(narrow.reachable).toBe(false);

    // 缝隙 y 5..6.5 = 1.5m：沿中线 y=5.75 通过，终点在北出口
    const wide = findExitPath(
      [...mkWalls(6.5), southBlocker, b],
      receptionPoint(b),
    );
    expect(wide.reachable).toBe(true);
    const end = wide.path[wide.path.length - 1];
    expect(end.y).toBeLessThan(1);
    expect(
      wide.path.some((p) => p.x > 7 && Math.abs(p.y - 5.75) < 1e-9),
    ).toBe(true);
  });

  it('拐角窄口：对角不足 1.5m 不可通过，加宽后可通过', () => {
    // 与“出口被堵”示例同形：横围挡接西墙、竖围挡接北墙，拐角处留缝
    const horiz = booth({ id: 'ph', x: 0, y: 5, w: 7, h: 1, kind: 'partition' });
    const mkVert = (x: number) =>
      booth({ id: 'pv', x, y: 0, w: 1, h: 6, kind: 'partition' });
    const inside = booth({ id: 'in', x: 1.5, y: 1.5, w: 2.5, h: 1.5, orientation: 'south' });

    // 竖围挡在 x=8：拐角对角距离 √2 ≈ 1.41m < 1.5m，封死
    const narrow = findExitPath([horiz, mkVert(8), inside], receptionPoint(inside));
    expect(narrow.reachable).toBe(false);

    // 竖围挡在 x=8.5：拐角处净宽达到 1.5m，沿中线 x=7.75 通过
    const wide = findExitPath([horiz, mkVert(8.5), inside], receptionPoint(inside));
    expect(wide.reachable).toBe(true);
    expect(
      wide.path.some((p) => Math.abs(p.x - 7.75) < 1e-9 && p.y > 5 && p.y < 6),
    ).toBe(true);
  });

  it('接待点从本展位正面出发：四个朝向都能在空旷展厅疏散', () => {
    for (const orientation of ['north', 'east', 'south', 'west'] as const) {
      const b = booth({ id: 'b', x: 9, y: 6, w: 2, h: 2, orientation });
      const start = receptionPoint(b);
      const r = findExitPath([b], start);
      expect(r.reachable).toBe(true);
      expect(r.path[0]).toEqual(start);
    }
  });

  it('正面距横贯隔断正好 1.5m 时可出发；只有 1m 时正面被封死', () => {
    const b = booth({ id: 'b', x: 9, y: 8, w: 2, h: 2, orientation: 'south' });
    // 隔断横贯展厅，顶边 y=11.5，距展位正面（y=10）正好 1.5m
    const wall15 = booth({ id: 'w', x: 0, y: 11.5, w: 20, h: 1, kind: 'partition' });
    const ok = findExitPath([wall15, b], receptionPoint(b));
    expect(ok.reachable).toBe(true);
    // 南出口被隔断截断，只能去北出口
    expect(ok.path[ok.path.length - 1].y).toBeLessThan(1);

    // 隔断顶边 y=11，距正面只有 1m：正面被净宽规则封死
    const wall10 = booth({ id: 'w', x: 0, y: 11, w: 20, h: 1, kind: 'partition' });
    const sealed = findExitPath([wall10, b], receptionPoint(b));
    expect(sealed.reachable).toBe(false);
  });

  it('出口旁 1m 处的展位不封死出口，路径仍可进入开口', () => {
    // 展位在南出口开口（x3..5）东侧 1m 处，不盖开口
    const beside = booth({ id: 'nb', x: 6, y: 12, w: 2, h: 2 });
    const south = EXITS.find((e) => e.wall === 'south')!;
    expect(exitBlockingBooth([beside], south)).toBeNull();

    const b = booth({ id: 's', x: 10, y: 9, w: 2, h: 2, orientation: 'south' });
    const r = findExitPath([beside, b], receptionPoint(b));
    expect(r.reachable).toBe(true);
    const end = r.path[r.path.length - 1];
    // 终点在南出口开口内侧
    expect(end.y).toBeGreaterThan(13);
    expect(end.x).toBeGreaterThanOrEqual(3);
    expect(end.x).toBeLessThanOrEqual(5.5);
  });

  it('路径每一步（起点之后）都满足净宽规则', () => {
    const obstacle = booth({ id: 'o', x: 5, y: 4, w: 3, h: 5 });
    const b = booth({ id: 's', x: 1, y: 1, w: 2, h: 2, orientation: 'east' });
    const booths = [obstacle, b];
    const r = findExitPath(booths, receptionPoint(b));
    expect(r.reachable).toBe(true);
    const cols = Math.round(HALL_WIDTH / PATH_GRID);
    const rows = Math.round(HALL_HEIGHT / PATH_GRID);
    // path[0] 是真实接待点、path[1] 是起点格（允许落在本展位膨胀区内），
    // 之后的每个格子都必须满足 1.5m 净宽
    for (const p of r.path.slice(2)) {
      const cx = Math.round((p.x - PATH_GRID / 2) / PATH_GRID);
      const cy = Math.round((p.y - PATH_GRID / 2) / PATH_GRID);
      expect(isPassageCell(cx, cy, booths, cols, rows)).toBe(true);
    }
  });
});
