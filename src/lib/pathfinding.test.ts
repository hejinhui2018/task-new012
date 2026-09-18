import { describe, it, expect } from 'vitest';
import type { Booth } from '../types';
import { CLEARANCE, EXITS, HALL_HEIGHT, HALL_WIDTH, PATH_GRID } from '../constants';
import {
  exitBlockingBooth,
  findExitPath,
  isBlockedCell,
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

/** 以某展位自身为起点（门阶起步）寻路到任一出口。 */
function pathFrom(self: Booth, obstacles: Booth[] = []) {
  return findExitPath(
    [...obstacles, self],
    receptionPoint(self),
    EXITS,
    undefined,
    self,
  );
}

/** 封住南出口（开口 x3..5 被 3m 宽展位整体盖住），迫使路径绕北出口。 */
function southExitBlocker(): Booth {
  return booth({ id: 'sb', x: 2.5, y: 12, w: 3, h: 2, orientation: 'north' });
}

describe('findExitPath 疏散寻路', () => {
  it('空展厅：任意接待点可达出口，路径起点正确', () => {
    const b = booth({ x: 9, y: 6, w: 2, h: 2, orientation: 'south' });
    const start = receptionPoint(b);
    const r = pathFrom(b);
    expect(r.reachable).toBe(true);
    expect(r.path.length).toBeGreaterThan(1);
    expect(r.path[0]).toEqual(start);
  });

  it('路径终点落在某个出口开口内侧', () => {
    const b = booth({ x: 9, y: 6 });
    const r = pathFrom(b);
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
    const r = pathFrom(b, [obstacle]);
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
    const r = pathFrom(inside, walls);
    expect(r.reachable).toBe(false);
    expect(r.path).toEqual([]);
  });

  it('围挡缺口只有 1m 时不可穿行（不足 1.5m 净宽）', () => {
    const walls: Booth[] = [
      booth({ id: 'wn', x: 3, y: 3, w: 4.5, h: 0.5, kind: 'partition' }),
      booth({ id: 'ws', x: 3, y: 7, w: 4.5, h: 0.5, kind: 'partition' }),
      // 西墙盖到 y=6，缺口 y6..7 只有 1m
      booth({ id: 'ww', x: 3, y: 3, w: 0.5, h: 3, kind: 'partition' }),
      booth({ id: 'we', x: 7, y: 3, w: 0.5, h: 4.5, kind: 'partition' }),
    ];
    const inside = booth({ id: 'in', x: 4.5, y: 4.5, w: 2, h: 2, orientation: 'south' });
    expect(pathFrom(inside, walls).reachable).toBe(false);
  });

  it('围挡缺口正好 1.5m 时可通行，路径从缺口绕行', () => {
    const walls: Booth[] = [
      booth({ id: 'wn', x: 3, y: 3, w: 4.5, h: 0.5, kind: 'partition' }),
      booth({ id: 'ws', x: 3, y: 7, w: 4.5, h: 0.5, kind: 'partition' }),
      // 西墙盖到 y=5.5，缺口 y5.5..7 正好 1.5m
      booth({ id: 'ww', x: 3, y: 3, w: 0.5, h: 2.5, kind: 'partition' }),
      booth({ id: 'we', x: 7, y: 3, w: 0.5, h: 4.5, kind: 'partition' }),
    ];
    const inside = booth({ id: 'in', x: 4.5, y: 4.5, w: 2, h: 2, orientation: 'south' });
    const r = pathFrom(inside, walls);
    expect(r.reachable).toBe(true);
    // 路径必须经过 x≈3.25 的缺口列（y 在 5.5~7 之间）
    const throughGap = r.path.some(
      (p) => Math.abs(p.x - 3.25) < PATH_GRID && p.y >= 5.5 && p.y <= 7,
    );
    expect(throughGap).toBe(true);
  });

  it('横断展厅的隔断只在右端留 1.5m 缺口、且南出口被封时，绕缺口去北出口', () => {
    // 横贯展厅的隔断，墙止于 x=18.5，右端缺口 x18.5..20 正好 1.5m
    const wall = booth({ id: 'wall', x: 0, y: 6.5, w: 18.5, h: 1, kind: 'partition' });
    const b = booth({ id: 's', x: 9, y: 9, w: 2, h: 2, orientation: 'south' });
    const r = pathFrom(b, [wall, southExitBlocker()]);
    expect(r.reachable).toBe(true);
    // 路径不能穿越隔断实体（y∈(6.5,7.5) 且 x<18.5）；缺口列 x≥18.5 通过合法
    const crossing = r.path.filter((p) => p.y > 6.5 && p.y < 7.5 && p.x < 18.5);
    expect(crossing.length).toBe(0);
    // 必须绕到右端缺口（格心 ≥18.5）
    expect(r.path.some((p) => p.x >= 18.5)).toBe(true);
    // 终点在北出口
    const end = r.path[r.path.length - 1];
    expect(end.y).toBeLessThan(1);
    expect(end.x).toBeGreaterThanOrEqual(14);
    expect(end.x).toBeLessThanOrEqual(16.5);
  });

  it('横断展厅的隔断右端只有 1m 缺口时无法穿越（改判不可达）', () => {
    // 墙止于 x=19，右端缺口 x19..20 只有 1m；南出口也被封，北出口过不去
    const wall = booth({ id: 'wall', x: 0, y: 6.5, w: 19, h: 1, kind: 'partition' });
    const b = booth({ id: 's', x: 9, y: 9, w: 2, h: 2, orientation: 'south' });
    const r = pathFrom(b, [wall, southExitBlocker()]);
    expect(r.reachable).toBe(false);
    expect(r.path).toEqual([]);
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
    const r = pathFrom(b, [blocker]);
    expect(r.reachable).toBe(true);
    // 终点应在北墙附近而不是南墙
    const end = r.path[r.path.length - 1];
    expect(end.y).toBeLessThan(1);
  });
});

/**
 * 1.5 m 净宽规则：以下构造都封住南出口，迫使路径绕过墙障去北出口，
 * 因此“能否到达”只取决于被测缺口是否容得下 1.5 m 净宽的人流。
 */
describe('1.5m 净宽：水平/垂直窄缝阈值', () => {
  /** 横墙 y5..6 分两段，中间在 x=9..(9+gap) 留缺口；除此之外无法到北侧。 */
  function horizontalWallWithGap(gap: number): Booth[] {
    const left = 9;
    return [
      booth({ id: 'wl', x: 0, y: 5, w: left, h: 1, kind: 'partition' }),
      booth({
        id: 'wr',
        x: left + gap,
        y: 5,
        w: HALL_WIDTH - (left + gap),
        h: 1,
        kind: 'partition',
      }),
      southExitBlocker(),
    ];
  }

  /** 竖墙 x8..9 分两段，中间在 y=5..(5+gap) 留缺口，隔开西/东两侧。 */
  function verticalWallWithGap(gap: number): Booth[] {
    const top = 5;
    return [
      booth({ id: 'wu', x: 8, y: 0, w: 1, h: top, kind: 'partition' }),
      booth({
        id: 'wd',
        x: 8,
        y: top + gap,
        w: 1,
        h: HALL_HEIGHT - (top + gap),
        kind: 'partition',
      }),
      southExitBlocker(),
    ];
  }

  const southPerson = () =>
    booth({ id: 's', x: 2, y: 9, w: 2, h: 2, orientation: 'south' });
  const westPerson = () =>
    booth({ id: 's', x: 2, y: 9, w: 2, h: 2, orientation: 'south' });

  it('水平缺口 1.0m 与 1.49m 都不可通行', () => {
    expect(pathFrom(southPerson(), horizontalWallWithGap(1)).reachable).toBe(false);
    expect(
      pathFrom(southPerson(), horizontalWallWithGap(CLEARANCE - 0.01)).reachable,
    ).toBe(false);
  });

  it('水平缺口正好 1.5m 放行，2m 也放行', () => {
    expect(pathFrom(southPerson(), horizontalWallWithGap(CLEARANCE)).reachable).toBe(true);
    expect(pathFrom(southPerson(), horizontalWallWithGap(2)).reachable).toBe(true);
  });

  it('垂直缺口 1.0m 与 1.49m 都不可通行', () => {
    expect(pathFrom(westPerson(), verticalWallWithGap(1)).reachable).toBe(false);
    expect(
      pathFrom(westPerson(), verticalWallWithGap(CLEARANCE - 0.01)).reachable,
    ).toBe(false);
  });

  it('垂直缺口正好 1.5m 放行，2m 也放行', () => {
    expect(pathFrom(westPerson(), verticalWallWithGap(CLEARANCE)).reachable).toBe(true);
    expect(pathFrom(westPerson(), verticalWallWithGap(2)).reachable).toBe(true);
  });
});

describe('1.5m 净宽：拐角窄口', () => {
  // A 占东北（x8..13,y0..7），B 占西南（x0..bEast,y7..14），在 (8,7) 形成内拐角。
  function cornerObstacles(bEast: number): Booth[] {
    const obs = [
      booth({ id: 'A', x: 8, y: 0, w: 5, h: 7, kind: 'partition' }),
      southExitBlocker(),
    ];
    if (Number.isFinite(bEast)) {
      obs.push(
        booth({ id: 'B', x: 0, y: 7, w: bEast, h: HALL_HEIGHT - 7, kind: 'partition' }),
      );
    }
    return obs;
  }
  const nwPerson = () =>
    booth({ id: 's', x: 2, y: 2, w: 2, h: 2, orientation: 'south' });

  it('只有单个内侧拐角（对角开放）时可绕过，不被误封', () => {
    expect(pathFrom(nwPerson(), cornerObstacles(NaN)).reachable).toBe(true);
  });

  it('两个对角障碍在角点针孔相接时，拐角转不过去（不可达）', () => {
    expect(pathFrom(nwPerson(), cornerObstacles(8)).reachable).toBe(false);
  });

  it('拐角处只留 1.0m 竖缝时仍转不过去', () => {
    expect(pathFrom(nwPerson(), cornerObstacles(7)).reachable).toBe(false);
  });

  it('拐角处留足 1.5m 竖缝后可以通过', () => {
    expect(pathFrom(nwPerson(), cornerObstacles(8 - CLEARANCE)).reachable).toBe(true);
  });
});

describe('1.5m 净宽：贴墙边界宽度', () => {
  it('横贯隔断只在东墙端留 1.0m 缺口时无法通过', () => {
    const wall = booth({ id: 'wall', x: 0, y: 6.5, w: HALL_WIDTH - 1, h: 1, kind: 'partition' });
    const self = booth({ id: 's', x: 2, y: 9, w: 2, h: 2 });
    expect(pathFrom(self, [wall, southExitBlocker()]).reachable).toBe(false);
  });

  it('横贯隔断在东墙端正好留 1.5m 缺口时可以通过', () => {
    const wall = booth({
      id: 'wall',
      x: 0,
      y: 6.5,
      w: HALL_WIDTH - CLEARANCE,
      h: 1,
      kind: 'partition',
    });
    const self = booth({ id: 's', x: 2, y: 9, w: 2, h: 2 });
    const r = pathFrom(self, [wall, southExitBlocker()]);
    expect(r.reachable).toBe(true);
    expect(r.path.some((p) => p.x >= HALL_WIDTH - CLEARANCE)).toBe(true);
  });

  it('接待点/正面紧贴实体墙时，门阶起步能沿自家立面挪出，不被自己+墙封死', () => {
    expect(
      pathFrom(booth({ id: 'n', x: 9, y: 0, w: 2, h: 2, orientation: 'north' })).reachable,
    ).toBe(true);
    expect(
      pathFrom(booth({ id: 'w', x: 0, y: 6, w: 2, h: 2, orientation: 'west' })).reachable,
    ).toBe(true);
    // 南墙无开口段（开口只在 x3..5），正面朝南贴墙也能沿立面挪到走廊
    expect(
      pathFrom(booth({ id: 's2', x: 9, y: 12, w: 2, h: 2, orientation: 'south' })).reachable,
    ).toBe(true);
  });
});

describe('接待点起步：从自己展位正面出发', () => {
  it('开阔大厅中路径首点就是接待点', () => {
    const self = booth({ id: 'a', x: 9, y: 6, w: 2, h: 2, orientation: 'south' });
    const r = pathFrom(self);
    expect(r.path[0]).toEqual(receptionPoint(self));
  });

  it('正面 1.0m 处有展位但两侧开阔时，绕行可达（不穿过前方展位）', () => {
    const self = booth({ id: 'a', x: 8, y: 3, w: 2, h: 2, orientation: 'south' });
    // 正面外 1.0m：a 南缘 y5，front 占 y6..8
    const front = booth({ id: 'f', x: 8, y: 6, w: 2, h: 2, kind: 'partition' });
    const r = pathFrom(self, [front]);
    expect(r.reachable).toBe(true);
    // 路径格心不得落进前方展位实体 x[8,10]、y[6,8]（只能从两侧绕）
    for (let i = 1; i < r.path.length; i++) {
      const p = r.path[i];
      const insideFront = p.x > 8 && p.x < 10 && p.y > 6 && p.y < 8;
      expect(insideFront).toBe(false);
    }
  });

  it('展位被四边仅 1.0m 净距的围挡合围时不可达（起步豁免不能穿墙/穿窄缝）', () => {
    const self = booth({ id: 'a', x: 3, y: 3, w: 2, h: 2, orientation: 'south' });
    // 合围盒内缘 x2..6、y2..6，距展位各边恰好 1.0m（< 1.5m），无开口
    const fences = [
      booth({ id: 'wn', x: 2, y: 1.5, w: 4, h: 0.5, kind: 'partition' }),
      booth({ id: 'ws', x: 2, y: 6, w: 4, h: 0.5, kind: 'partition' }),
      booth({ id: 'ww', x: 1.5, y: 1.5, w: 0.5, h: 5, kind: 'partition' }),
      booth({ id: 'we', x: 6, y: 1.5, w: 0.5, h: 5, kind: 'partition' }),
    ];
    expect(pathFrom(self, fences).reachable).toBe(false);
  });
});

describe('墙上出口目标格的净空', () => {
  it('开口空着时，净空方块可伸入开口，展位能直达南出口', () => {
    const self = booth({ id: 's', x: 1, y: 9, w: 2, h: 2, orientation: 'south' });
    const r = pathFrom(self);
    expect(r.reachable).toBe(true);
    expect(r.path[r.path.length - 1].y).toBeGreaterThan(HALL_HEIGHT - 1);
  });

  it('展位贴在开口旁边（不盖住开口）不影响别人进入出口', () => {
    const beside = booth({ id: 'side', x: 6, y: 12.5, w: 2, h: 1.5 });
    const self = booth({ id: 's', x: 1, y: 9, w: 2, h: 2, orientation: 'south' });
    const r = pathFrom(self, [beside]);
    expect(r.reachable).toBe(true);
    expect(r.path[r.path.length - 1].y).toBeGreaterThan(HALL_HEIGHT - 1);
  });

  it('展位整体盖住开口后该出口无可达目标格（结合封南出口绕行已在别处覆盖）', () => {
    const blocker = booth({ id: 'blk', x: 2.5, y: 12, w: 3, h: 2 });
    const self = booth({ id: 's', x: 3.5, y: 8, w: 1, h: 1, orientation: 'south' });
    const r = pathFrom(self, [blocker]);
    // 南出口被盖，终点只能在北出口
    expect(r.reachable).toBe(true);
    expect(r.path[r.path.length - 1].y).toBeLessThan(1);
  });
});
