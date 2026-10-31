/**
 * 智能布局（复刻 huahub「智能布局」的核心思路）：
 *
 *  1. 实体是「中心」：属性椭圆环绕实体，联系菱形夹在两个实体之间的轴线上；
 *  2. 联系方向先占位，属性只填在联系之间的扇形空隙里，避免压线；
 *  3. 用带约束的物理迭代收敛：联系两端拉到合适距离、无联系实体互相排斥、
 *     共享邻居的实体保持角度间隔；
 *  4. 交换实体位置以减少联系之间的交叉；
 *  5. 关联表（多对多）会变成带属性的菱形，属性环绕菱形排布；
 *  6. 属性采用 huahub 恢复属性时的紧凑排布：每个属性在自己的角度槽内
 *     由内向外扫描半径，避让已有节点与连线；槽内放不下时继续向外扩一圈，
 *     而不是把整圈半径撑大。这样十几个、二十几个属性都会贴着矩形分层聚集。
 *
 * 所有坐标就地写入 RenderNode.x / y。
 */

import type { RenderEdge, RenderNode } from './geometry';

const GAP = 22;
const ATTR_GAP = 6;
const ATTR_ARC = 0.45;
const MIN_AXIS = 120;

/** 属性紧凑排布参数（对应 huahub Xo 的 Je / B / 候选步数） */
const ATTR_SEARCH_RADIUS = 220;
const ATTR_ANGLE_PENALTY = 75;
const ATTR_LOCAL_STEPS = 5;
const ATTR_GLOBAL_STEPS = 12;
const ATTR_RADIUS_STEP = 3;

interface Point {
  x: number;
  y: number;
}

interface HubStats {
  attrs: RenderNode[];
  dirIds: string[];
  /** 属性簇的估算半径 */
  ringRadius: number;
}

interface Hub {
  id: string;
  node: RenderNode;
  stats: HubStats;
}

interface AxisRel {
  relId: string;
  node: RenderNode | null;
  aId: string;
  bId: string;
  attrs: RenderNode[];
  /** 菱形属性环的基准半径 */
  arcRadius: number;
  ringRadius: number;
}

const TWO_PI = Math.PI * 2;

/* ------------------------------------------------------------------ */
/* 几何：三种图元的边界距离                                              */
/* ------------------------------------------------------------------ */

function rectDist(w: number, h: number, ux: number, uy: number): number {
  const ax = Math.abs(ux);
  const ay = Math.abs(uy);
  if (ax < 1e-9) return h / 2;
  if (ay < 1e-9) return w / 2;
  return Math.min(w / 2 / ax, h / 2 / ay);
}

function ellipseDist(rx: number, ry: number, ux: number, uy: number): number {
  const z = Math.sqrt(ry * ry * ux * ux + rx * rx * uy * uy);
  return z > 1e-9 ? (rx * ry) / z : 0;
}

function diamondDist(rx: number, ry: number, ux: number, uy: number): number {
  const z = Math.abs(ux) / rx + Math.abs(uy) / ry;
  return z > 1e-9 ? 1 / z : 0;
}

function boundaryDist(node: RenderNode, ux: number, uy: number): number {
  const rx = node.w / 2;
  const ry = node.h / 2;
  if (node.type === 'attribute') return ellipseDist(rx, ry, ux, uy);
  if (node.type === 'relationship') return diamondDist(rx, ry, ux, uy);
  return rectDist(node.w, node.h, ux, uy);
}

function normAngle(angle: number): number {
  let a = angle % TWO_PI;
  if (a < 0) a += TWO_PI;
  return a;
}

function unit(from: Point, to: Point): { ux: number; uy: number; dist: number } {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.hypot(dx, dy) || 1;
  return { ux: dx / dist, uy: dy / dist, dist };
}

/* ------------------------------------------------------------------ */
/* 主入口                                                                */
/* ------------------------------------------------------------------ */

export function layoutSmart(nodes: RenderNode[], edges: RenderEdge[]): void {
  if (nodes.length === 0) return;

  const byId = new Map(nodes.map((n) => [n.id, n]));

  // 联系节点 ↔ 两端实体
  const relEnds = new Map<string, string[]>();
  // 实体 ↔ 实体：直接连线（draw.io 导入可能没有菱形节点）
  const directPairs: Array<{ relId: string; aId: string; bId: string }> = [];

  for (const edge of edges) {
    if (edge.type !== 'relationship') continue;
    const source = byId.get(edge.source);
    const target = byId.get(edge.target);
    if (!source || !target) continue;

    if (source.type === 'entity' && target.type === 'relationship') {
      const list = relEnds.get(target.id) ?? [];
      if (!list.includes(source.id)) list.push(source.id);
      relEnds.set(target.id, list);
    } else if (source.type === 'relationship' && target.type === 'entity') {
      const list = relEnds.get(source.id) ?? [];
      if (!list.includes(target.id)) list.push(target.id);
      relEnds.set(source.id, list);
    } else if (source.type === 'entity' && target.type === 'entity') {
      directPairs.push({ relId: edge.id, aId: source.id, bId: target.id });
    }
  }

  const attrsByParent = new Map<string, RenderNode[]>();
  for (const node of nodes) {
    if (node.type !== 'attribute') continue;
    const parent = node.parent;
    if (!parent) continue;
    const list = attrsByParent.get(parent) ?? [];
    list.push(node);
    attrsByParent.set(parent, list);
  }

  const relationshipNodes = nodes.filter((n) => n.type === 'relationship');
  const axisRels: AxisRel[] = [];
  const hubRels: RenderNode[] = [];

  for (const rel of relationshipNodes) {
    const ends = relEnds.get(rel.id) ?? [];
    const attrs = attrsByParent.get(rel.id) ?? [];
    if (ends.length === 2 && ends[0] !== ends[1]) {
      const stat = makeOrbitStats(rel, attrs, 2);
      axisRels.push({
        relId: rel.id,
        node: rel,
        aId: ends[0],
        bId: ends[1],
        attrs,
        arcRadius: stat.arcRadius,
        ringRadius: stat.ringRadius,
      });
    } else if (ends.length >= 1) {
      hubRels.push(rel);
    }
  }

  for (const pair of directPairs) {
    axisRels.push({
      relId: pair.relId,
      node: null,
      aId: pair.aId,
      bId: pair.bId,
      attrs: [],
      arcRadius: 0,
      ringRadius: 0,
    });
  }

  // 实体：属性 + 联系方向
  const entityHubs: Hub[] = nodes
    .filter((n) => n.type === 'entity')
    .map((node) => makeHub(node, attrsByParent.get(node.id) ?? [], []));

  const relationHubs: Hub[] = hubRels.map((node) => {
    const dirs = relEnds.get(node.id) ?? [];
    return makeHub(node, attrsByParent.get(node.id) ?? [], dirs);
  });

  const hubs = [...entityHubs, ...relationHubs];
  if (hubs.length === 0) {
    // 只有零散属性时按网格摊开
    layoutPlainGrid(nodes);
    return;
  }

  // 实体方向：联系另一端实体 / 联系菱形节点
  const entityById = new Map(entityHubs.map((h) => [h.id, h]));
  const hubById = new Map(hubs.map((h) => [h.id, h]));

  const entityDirs = new Map<string, string[]>();
  const axisNeighbors = new Map<string, Set<string>>();
  const axisBetween = new Map<string, AxisRel>();

  const addDir = (entityId: string, dirId: string) => {
    if (dirId === entityId) return;
    const list = entityDirs.get(entityId) ?? [];
    if (!list.includes(dirId)) list.push(dirId);
    entityDirs.set(entityId, list);
  };

  for (const axis of axisRels) {
    addDir(axis.aId, axis.bId);
    addDir(axis.bId, axis.aId);
    const na = axisNeighbors.get(axis.aId) ?? new Set<string>();
    const nb = axisNeighbors.get(axis.bId) ?? new Set<string>();
    na.add(axis.bId);
    nb.add(axis.aId);
    axisNeighbors.set(axis.aId, na);
    axisNeighbors.set(axis.bId, nb);
    axisBetween.set(pairKey(axis.aId, axis.bId), axis);
  }

  for (const hub of relationHubs) {
    for (const entityId of hub.stats.dirIds) addDir(entityId, hub.id);
  }

  for (const hub of entityHubs) {
    hub.stats.dirIds = entityDirs.get(hub.id) ?? [];
    hub.stats = {
      ...makeOrbitStats(hub.node, hub.stats.attrs, hub.stats.dirIds.length),
      attrs: hub.stats.attrs,
      dirIds: hub.stats.dirIds,
    };
  }

  // 初始化位置
  initHubPositions(hubs);

  const positions = new Map<string, Point>();
  for (const hub of hubs) positions.set(hub.id, { x: hub.node.x, y: hub.node.y });

  const computePairTarget = (axis: AxisRel): number => {
    const a = hubById.get(axis.aId);
    const b = hubById.get(axis.bId);
    if (!a || !b) return MIN_AXIS;
    const pa = positions.get(a.id)!;
    const pb = positions.get(b.id)!;
    const { ux, uy } = unit(pa, pb);
    // 实体只按自身尺寸留出轴距；属性最后统一避让，允许相邻簇互相嵌合
    const clearA = rectDist(a.node.w, a.node.h, ux, uy) + GAP;
    const clearB = rectDist(b.node.w, b.node.h, -ux, -uy) + GAP;
    const relRadius = axis.node ? Math.max(axis.node.w, axis.node.h) / 2 : 0;
    const relAttrClear = axis.attrs.length > 0 ? axis.ringRadius * 2 + GAP : 0;
    return Math.max(MIN_AXIS, clearA + clearB + relRadius * 2, relAttrClear);
  };

  // 物理迭代：拉开/压紧联系轴线、排斥无关实体、保证共享邻居的夹角
  const runPhysics = (iterations: number) => {
    for (let iter = 0; iter < iterations; iter += 1) {
      let moved = 0;

      for (const axis of axisRels) {
        const a = positions.get(axis.aId);
        const b = positions.get(axis.bId);
        if (!a || !b) continue;
        const required = computePairTarget(axis);

        const { ux, uy, dist } = unit(a, b);
        let shift: number | null = null;
        if (dist < required - 1) shift = required - dist;
        else if (dist > required * 1.05 + 1) shift = required * 1.05 - dist;
        if (shift === null) continue;

        const k = dist < required - 1 ? 0.2 : 0.08;
        a.x -= ux * shift * k * 0.5;
        a.y -= uy * shift * k * 0.5;
        b.x += ux * shift * k * 0.5;
        b.y += uy * shift * k * 0.5;
        moved = Math.max(moved, Math.abs(shift * k));
      }

      // 无直接联系的实体互相排斥
      for (let i = 0; i < entityHubs.length; i += 1) {
        for (let j = i + 1; j < entityHubs.length; j += 1) {
          const ha = entityHubs[i];
          const hb = entityHubs[j];
          if (axisBetween.has(pairKey(ha.id, hb.id))) continue;
          const pa = positions.get(ha.id)!;
          const pb = positions.get(hb.id)!;
          const { ux, uy, dist } = unit(pa, pb);
          const required = ha.stats.ringRadius + hb.stats.ringRadius + GAP;
          if (dist >= required) continue;
          const push = (required - dist) * 0.25;
          pa.x -= ux * push;
          pa.y -= uy * push;
          pb.x += ux * push;
          pb.y += uy * push;
          moved = Math.max(moved, push);
        }
      }

      // 共享邻居的实体之间保持最小夹角（避免联系挤在一起）
      for (const hub of entityHubs) {
        const neighbors = axisNeighbors.get(hub.id);
        if (!neighbors || neighbors.size < 2) continue;
        const center = positions.get(hub.id)!;
        const ids = Array.from(neighbors);
        const minSeparation = (TWO_PI / ids.length) * 0.5;

        for (let i = 0; i < ids.length; i += 1) {
          for (let j = i + 1; j < ids.length; j += 1) {
            if (axisBetween.has(pairKey(ids[i], ids[j]))) continue;
            const pa = positions.get(ids[i])!;
            const pb = positions.get(ids[j])!;
            let delta =
              Math.atan2(pb.y - center.y, pb.x - center.x) - Math.atan2(pa.y - center.y, pa.x - center.x);
            while (delta > Math.PI) delta -= TWO_PI;
            while (delta <= -Math.PI) delta += TWO_PI;
            const deficit = minSeparation - Math.abs(delta);
            if (deficit <= 0) continue;

            const da = Math.hypot(pa.x - center.x, pa.y - center.y) || 1;
            const db = Math.hypot(pb.x - center.x, pb.y - center.y) || 1;
            let twist = deficit * Math.min(da, db) * 0.02;
            twist = Math.min(twist, 2.5);
            const sign = delta >= 0 ? 1 : -1;

            const rotate = (p: Point, angle: number) => {
              const dx = p.x - center.x;
              const dy = p.y - center.y;
              p.x = center.x + dx * Math.cos(angle) - dy * Math.sin(angle);
              p.y = center.y + dx * Math.sin(angle) + dy * Math.cos(angle);
            };
            rotate(pa, -(twist / da) * sign);
            rotate(pb, (twist / db) * sign);
            moved = Math.max(moved, twist);
          }
        }
      }

      if (moved < 0.5) break;
    }
  };

  runPhysics(300);

  // 交叉最小化：交换实体位置，让联系轴线更少交叉
  const axisSegments = () =>
    axisRels
      .map((axis) => ({ a: positions.get(axis.aId)!, b: positions.get(axis.bId)!, axis }))
      .filter((seg) => seg.a && seg.b);

  const countCrossings = (): number => {
    const segments = axisSegments();
    let count = 0;
    for (let i = 0; i < segments.length; i += 1) {
      for (let j = i + 1; j < segments.length; j += 1) {
        const s1 = segments[i];
        const s2 = segments[j];
        if (
          s1.axis.aId === s2.axis.aId ||
          s1.axis.aId === s2.axis.bId ||
          s1.axis.bId === s2.axis.aId ||
          s1.axis.bId === s2.axis.bId
        ) {
          continue;
        }
        if (segmentsIntersect(s1.a, s1.b, s2.a, s2.b)) count += 1;
      }
    }
    return count;
  };

  const swapPositions = (a: Point, b: Point) => {
    const tx = a.x;
    const ty = a.y;
    a.x = b.x;
    a.y = b.y;
    b.x = tx;
    b.y = ty;
  };

  if (axisRels.length >= 2 && entityHubs.length >= 2) {
    let crossings = countCrossings();
    for (let round = 0; round < 8 && crossings > 0; round += 1) {
      let improved = false;
      for (let i = 0; i < entityHubs.length && crossings > 0; i += 1) {
        for (let j = i + 1; j < entityHubs.length; j += 1) {
          const pa = positions.get(entityHubs[i].id)!;
          const pb = positions.get(entityHubs[j].id)!;
          swapPositions(pa, pb);
          const next = countCrossings();
          if (next < crossings) {
            crossings = next;
            improved = true;
            if (crossings === 0) break;
          } else {
            swapPositions(pa, pb);
          }
        }
      }
      if (!improved) break;
    }
  }

  // 交换会破坏间距，再跑一轮物理把距离和排斥关系恢复
  runPhysics(150);

  // 物理只改了 positions，这里写回节点坐标，后续属性排布与渲染都以它为准
  for (const hub of hubs) {
    const point = positions.get(hub.id)!;
    hub.node.x = point.x;
    hub.node.y = point.y;
  }

  // 联系菱形放在两实体之间的轴线上
  for (const axis of axisRels) {
    if (!axis.node) continue;
    const a = hubById.get(axis.aId);
    const b = hubById.get(axis.bId);
    if (!a || !b) continue;
    const pa = positions.get(a.id)!;
    const pb = positions.get(b.id)!;
    const { ux, uy, dist } = unit(pa, pb);
    const rel = axis.node;

    const start =
      rectDist(a.node.w, a.node.h, ux, uy) +
      diamondDist(rel.w / 2, rel.h / 2, ux, uy) +
      GAP +
      (axis.ringRadius > 0 ? axis.arcRadius : 0);
    const end =
      dist -
      rectDist(b.node.w, b.node.h, -ux, -uy) -
      diamondDist(rel.w / 2, rel.h / 2, -ux, -uy) -
      GAP -
      (axis.ringRadius > 0 ? axis.arcRadius : 0);

    const center = start + Math.max(GAP, (end - start) / 2);
    const t = Math.min(Math.max(center, start), Math.max(start, end));
    rel.x = pa.x + ux * t;
    rel.y = pa.y + uy * t;
  }

  // 同一对实体的多条联系，沿垂直方向错开
  const byPair = new Map<string, AxisRel[]>();
  for (const axis of axisRels) {
    if (!axis.node) continue;
    const key = pairKey(axis.aId, axis.bId);
    const list = byPair.get(key) ?? [];
    list.push(axis);
    byPair.set(key, list);
  }

  for (const list of byPair.values()) {
    if (list.length <= 1) continue;
    const first = list[0].node!;
    const a = positions.get(list[0].aId)!;
    const b = positions.get(list[0].bId)!;
    const { ux, uy } = unit(a, b);
    const normal = { x: -uy, y: ux };
    const base = { x: first.x, y: first.y };
    const spacing = Math.max(...list.map((r) => Math.max(r.node!.w, r.node!.h) / 2)) * 2 + 16;
    const middle = (list.length - 1) / 2;
    list
      .slice()
      .sort((r1, r2) => r1.relId.localeCompare(r2.relId))
      .forEach((item, index) => {
        const offset = (index - middle) * spacing;
        item.node!.x = base.x + normal.x * offset;
        item.node!.y = base.y + normal.y * offset;
      });
  }

  // 属性紧凑环绕：按联系方向分槽，由内向外扫描半径并避让节点 / 连线
  placeAttributesCompact(nodes, edges);

  packComponents(nodes, edges);
}

/* ------------------------------------------------------------------ */
/* 初始化：按连通分量铺网格                                              */
/* ------------------------------------------------------------------ */

function initHubPositions(hubs: Hub[]): void {
  if (hubs.length === 0) return;

  const hubById = new Map(hubs.map((h) => [h.id, h]));
  const adjacency = new Map<string, Set<string>>();
  for (const hub of hubs) adjacency.set(hub.id, new Set());

  for (const hub of hubs) {
    for (const dirId of hub.stats.dirIds) {
      if (!hubById.has(dirId)) continue;
      adjacency.get(hub.id)!.add(dirId);
      adjacency.get(dirId)!.add(hub.id);
    }
  }

  const components: Hub[][] = [];
  const seen = new Set<string>();
  const ordered = hubs.slice().sort((a, b) => a.id.localeCompare(b.id));

  for (const hub of ordered) {
    if (seen.has(hub.id)) continue;
    const stack = [hub.id];
    const component: Hub[] = [];
    seen.add(hub.id);
    while (stack.length) {
      const id = stack.pop()!;
      const current = hubById.get(id);
      if (current) component.push(current);
      for (const next of adjacency.get(id) ?? []) {
        if (seen.has(next)) continue;
        seen.add(next);
        stack.push(next);
      }
    }
    components.push(component);
  }

  const maxRing = Math.max(...hubs.map((h) => h.stats.ringRadius), 60);
  const spacing = maxRing * 2 + 120;
  const cols = Math.max(1, Math.ceil(Math.sqrt(components.length)));

  components.forEach((component, index) => {
    const baseX = (index % cols) * spacing * 3;
    const baseY = Math.floor(index / cols) * spacing * 3;
    const innerCols = Math.max(1, Math.ceil(Math.sqrt(component.length)));

    component.forEach((hub, k) => {
      hub.node.x = baseX + (k % innerCols) * spacing * 0.8;
      hub.node.y = baseY + Math.floor(k / innerCols) * spacing * 0.7;
    });
  });
}

/* ------------------------------------------------------------------ */
/* 属性排布：紧凑分槽 + 半径扫描                                          */
/* ------------------------------------------------------------------ */

interface CollisionBox {
  id: string;
  x: number;
  y: number;
  halfW: number;
  halfH: number;
  nodeType: RenderNode['type'];
}

interface CollisionSegment {
  source: string;
  target: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

interface CheckFlags {
  rectNode: boolean;
  edgeNode: boolean;
  edgeCross: boolean;
  rectPierce: boolean;
}

interface AttrCandidate {
  angle: number;
  radius: number;
  dx: number;
  dy: number;
}

interface ProjectedBox {
  box: CollisionBox;
  along: number;
  perp: number;
  projX: number;
  projY: number;
}

interface ProjectedSegment {
  segment: CollisionSegment;
  minAlong: number;
  maxAlong: number;
  minPerp: number;
  maxPerp: number;
}

interface SpatialGrid<T> {
  cellSize: number;
  cells: Map<string, T[]>;
}

const STRICT_CHECKS: CheckFlags = {
  rectNode: true,
  edgeNode: true,
  edgeCross: true,
  rectPierce: true,
};

const GRID_CELL = 160;

function createGrid<T>(cellSize: number): SpatialGrid<T> {
  return { cellSize, cells: new Map() };
}

function insertGridItem<T>(
  grid: SpatialGrid<T>,
  item: T,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): void {
  const ix0 = Math.floor(minX / grid.cellSize);
  const ix1 = Math.floor(maxX / grid.cellSize);
  const iy0 = Math.floor(minY / grid.cellSize);
  const iy1 = Math.floor(maxY / grid.cellSize);
  for (let ix = ix0; ix <= ix1; ix += 1) {
    for (let iy = iy0; iy <= iy1; iy += 1) {
      const key = `${ix},${iy}`;
      const bucket = grid.cells.get(key) ?? [];
      bucket.push(item);
      grid.cells.set(key, bucket);
    }
  }
}

function queryGridItems<T>(
  grid: SpatialGrid<T>,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): T[] {
  const ix0 = Math.floor(minX / grid.cellSize);
  const ix1 = Math.floor(maxX / grid.cellSize);
  const iy0 = Math.floor(minY / grid.cellSize);
  const iy1 = Math.floor(maxY / grid.cellSize);
  const seen = new Set<T>();
  const out: T[] = [];
  for (let ix = ix0; ix <= ix1; ix += 1) {
    for (let iy = iy0; iy <= iy1; iy += 1) {
      const bucket = grid.cells.get(`${ix},${iy}`);
      if (!bucket) continue;
      for (const item of bucket) {
        if (seen.has(item)) continue;
        seen.add(item);
        out.push(item);
      }
    }
  }
  return out;
}

/**
 * 属性紧凑排布（对应 huahub 显示/恢复属性时的 Xo）：
 *  - 先按联系方向给属性分角度槽；
 *  - 每个属性在槽内由内向外扫描半径，避让已有节点、连线；
 *  - 槽内被占满时继续向外扩一圈，而不是把整圈半径撑大；
 *  - 逐级放宽碰撞约束，保证极端情况下也能落位。
 */
function placeAttributesCompact(nodes: RenderNode[], edges: RenderEdge[]): void {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const attrsByParent = new Map<string, RenderNode[]>();

  for (const node of nodes) {
    if (node.type !== 'attribute' || !node.parent) continue;
    const list = attrsByParent.get(node.parent) ?? [];
    list.push(node);
    attrsByParent.set(node.parent, list);
  }

  const hubs = nodes.filter(
    (n) => n.type !== 'attribute' && (attrsByParent.get(n.id)?.length ?? 0) > 0,
  );
  if (hubs.length === 0) return;

  const boxGrid = createGrid<CollisionBox>(GRID_CELL);
  const segmentGrid = createGrid<CollisionSegment>(GRID_CELL);

  for (const node of nodes) {
    if (node.type === 'attribute') continue;
    const box: CollisionBox = {
      id: node.id,
      x: node.x,
      y: node.y,
      halfW: node.w / 2,
      halfH: node.h / 2,
      nodeType: node.type,
    };
    insertGridItem(
      boxGrid,
      box,
      box.x - box.halfW - 8,
      box.y - box.halfH - 8,
      box.x + box.halfW + 8,
      box.y + box.halfH + 8,
    );
  }

  for (const edge of edges) {
    if (edge.type !== 'relationship') continue;
    const from = byId.get(edge.source);
    const to = byId.get(edge.target);
    if (!from || !to) continue;
    const { ux, uy } = unit(from, to);
    const startGap = boundaryDist(from, ux, uy) + 3;
    const endGap = boundaryDist(to, -ux, -uy) + 3;
    const segment: CollisionSegment = {
      source: edge.source,
      target: edge.target,
      x1: from.x + ux * startGap,
      y1: from.y + uy * startGap,
      x2: to.x - ux * endGap,
      y2: to.y - uy * endGap,
    };
    insertGridItem(
      segmentGrid,
      segment,
      Math.min(segment.x1, segment.x2) - 4,
      Math.min(segment.y1, segment.y2) - 4,
      Math.max(segment.x1, segment.x2) + 4,
      Math.max(segment.y1, segment.y2) + 4,
    );
  }

  // 属性最多的 hub 先排，保证大簇优先占据靠近矩形的内圈
  const ordered = hubs
    .slice()
    .sort(
      (a, b) =>
        (attrsByParent.get(b.id)?.length ?? 0) - (attrsByParent.get(a.id)?.length ?? 0) ||
        a.id.localeCompare(b.id),
    );

  for (const hub of ordered) {
    const attrs = (attrsByParent.get(hub.id) ?? [])
      .slice()
      .sort((a, b) => a.id.localeCompare(b.id));
    if (attrs.length === 0) continue;

    const dirAngles: number[] = [];
    for (const edge of edges) {
      if (edge.type !== 'relationship') continue;
      const otherId =
        edge.source === hub.id ? edge.target : edge.target === hub.id ? edge.source : null;
      if (!otherId) continue;
      const other = byId.get(otherId);
      if (!other) continue;
      const dx = other.x - hub.x;
      const dy = other.y - hub.y;
      if (Math.hypot(dx, dy) < 1e-6) continue;
      dirAngles.push(normAngle(Math.atan2(dy, dx)));
    }
    dirAngles.sort((a, b) => a - b);

    const slots = computeAttrSlots(attrs.length, dirAngles);
    attrs.forEach((attr, index) => {
      placeOneAttribute(
        hub,
        attr,
        slots.angles[index] ?? 0,
        slots.halfWindows[index] ?? 0,
        boxGrid,
        segmentGrid,
      );
    });
  }
}

/**
 * 角度分槽（对应 huahub Yo）：
 *  - 无联系方向时整圈均分；
 *  - 有联系方向时，槽宽 = 2π / (属性数 + 联系方向数)，
 *    每个联系之间的空隙按能容纳的槽数分配属性。
 */
function computeAttrSlots(
  count: number,
  dirAngles: number[],
): { angles: number[]; halfWindows: number[] } {
  if (count <= 0) return { angles: [], halfWindows: [] };

  const total = dirAngles.length;
  if (total === 0) {
    const step = TWO_PI / count;
    return {
      angles: Array.from({ length: count }, (_, i) => i * step),
      halfWindows: Array.from({ length: count }, () => step * 0.48),
    };
  }

  const sorted = dirAngles.map(normAngle).sort((a, b) => a - b);
  const slotWidth = TWO_PI / (count + total);

  const gaps = sorted.map((start, i) => {
    const next = sorted[(i + 1) % total] + (i === total - 1 ? TWO_PI : 0);
    let width = next - start;
    if (width <= 1e-9) width += TWO_PI;
    const raw = Math.max(0, width / slotWidth - 1);
    return { start, width, raw, count: Math.max(0, Math.round(raw)) };
  });

  let allocated = gaps.reduce((sum, gap) => sum + gap.count, 0);
  while (allocated < count) {
    let best = 0;
    for (let i = 1; i < gaps.length; i += 1) {
      if (gaps[i].raw - gaps[i].count > gaps[best].raw - gaps[best].count) best = i;
    }
    gaps[best].count += 1;
    allocated += 1;
  }
  while (allocated > count) {
    let best = -1;
    for (let i = 0; i < gaps.length; i += 1) {
      if (gaps[i].count <= 0) continue;
      if (
        best < 0 ||
        gaps[i].raw - gaps[i].count < gaps[best].raw - gaps[best].count
      ) {
        best = i;
      }
    }
    if (best < 0) break;
    gaps[best].count -= 1;
    allocated -= 1;
  }

  const angles: number[] = [];
  const halfWindows: number[] = [];
  for (const gap of gaps) {
    if (gap.count <= 0) continue;
    const step = gap.width / (gap.count + 1);
    for (let k = 0; k < gap.count; k += 1) {
      angles.push((gap.start + step * (k + 1)) % TWO_PI);
      halfWindows.push(step * 0.48);
    }
  }

  while (angles.length < count) {
    angles.push((angles.length / count) * TWO_PI);
    halfWindows.push((TWO_PI / count) * 0.48);
  }

  return { angles: angles.slice(0, count), halfWindows: halfWindows.slice(0, count) };
}

function placeOneAttribute(
  hub: RenderNode,
  attr: RenderNode,
  preferredAngle: number,
  halfWindow: number,
  boxGrid: SpatialGrid<CollisionBox>,
  segmentGrid: SpatialGrid<CollisionSegment>,
): void {
  const localOffsets = [0];
  for (let i = 1; i <= ATTR_LOCAL_STEPS; i += 1) {
    const delta = (i / ATTR_LOCAL_STEPS) * halfWindow;
    localOffsets.push(delta, -delta);
  }

  const globalOffsets: number[] = [];
  for (let i = 1; i < ATTR_GLOBAL_STEPS; i += 1) {
    globalOffsets.push((i / ATTR_GLOBAL_STEPS) * TWO_PI);
  }

  const pickBest = (offsets: number[], flags: CheckFlags): AttrCandidate | null => {
    let best: AttrCandidate | null = null;
    let bestScore = Infinity;
    for (const offset of offsets) {
      const angle = normAngle(preferredAngle + offset);
      const candidate = scanAttributeRadius(hub, attr, angle, flags, boxGrid, segmentGrid);
      if (!candidate) continue;
      const deviation = Math.min(Math.abs(offset), TWO_PI - Math.abs(offset));
      const score = candidate.radius + deviation * ATTR_ANGLE_PENALTY;
      if (score < bestScore) {
        bestScore = score;
        best = candidate;
      }
    }
    return best;
  };

  const relaxEdgeCross: CheckFlags = { ...STRICT_CHECKS, edgeCross: false };
  const relaxPierce: CheckFlags = { ...relaxEdgeCross, rectPierce: false };
  const onlyNode: CheckFlags = {
    rectNode: true,
    edgeNode: false,
    edgeCross: false,
    rectPierce: false,
  };

  let best =
    pickBest(localOffsets, STRICT_CHECKS) ??
    pickBest(localOffsets, relaxEdgeCross) ??
    pickBest(localOffsets, relaxPierce) ??
    pickBest(localOffsets, onlyNode) ??
    pickBest(globalOffsets, STRICT_CHECKS) ??
    pickBest(globalOffsets, relaxEdgeCross) ??
    pickBest(globalOffsets, relaxPierce) ??
    pickBest(globalOffsets, onlyNode);

  if (!best) {
    // 极端拥挤时放宽到 hub 尺寸 + 380 的范围，只保留节点避让
    const maxRadius = Math.max(hub.w, hub.h) / 2 + ATTR_SEARCH_RADIUS + 160;
    best = scanAttributeRadius(
      hub,
      attr,
      normAngle(preferredAngle),
      onlyNode,
      boxGrid,
      segmentGrid,
      maxRadius,
    );
  }

  if (!best) {
    best = fallbackCandidate(hub, attr, preferredAngle);
  }

  const x = hub.x + best.dx * best.radius;
  const y = hub.y + best.dy * best.radius;
  attr.x = x;
  attr.y = y;

  const hubBoundary = boundaryDist(hub, best.dx, best.dy);
  const attrBoundary = boundaryDist(attr, best.dx, best.dy);
  const box: CollisionBox = {
    id: attr.id,
    x,
    y,
    halfW: attr.w / 2,
    halfH: attr.h / 2,
    nodeType: 'attribute',
  };
  insertGridItem(
    boxGrid,
    box,
    box.x - box.halfW - 8,
    box.y - box.halfH - 8,
    box.x + box.halfW + 8,
    box.y + box.halfH + 8,
  );

  const segment: CollisionSegment = {
    source: hub.id,
    target: attr.id,
    x1: hub.x + best.dx * hubBoundary,
    y1: hub.y + best.dy * hubBoundary,
    x2: x - best.dx * attrBoundary,
    y2: y - best.dy * attrBoundary,
  };
  insertGridItem(
    segmentGrid,
    segment,
    Math.min(segment.x1, segment.x2) - 4,
    Math.min(segment.y1, segment.y2) - 4,
    Math.max(segment.x1, segment.x2) + 4,
    Math.max(segment.y1, segment.y2) + 4,
  );
}

function fallbackCandidate(hub: RenderNode, attr: RenderNode, angle: number): AttrCandidate {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const radius = boundaryDist(hub, dx, dy) + boundaryDist(attr, dx, dy) + ATTR_GAP;
  return { angle, radius, dx, dy };
}

function scanAttributeRadius(
  hub: RenderNode,
  attr: RenderNode,
  angle: number,
  flags: CheckFlags,
  boxGrid: SpatialGrid<CollisionBox>,
  segmentGrid: SpatialGrid<CollisionSegment>,
  maxRadius?: number,
): AttrCandidate | null {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const hubBoundary = boundaryDist(hub, dx, dy);
  const attrBoundary = boundaryDist(attr, dx, dy);
  const minRadius = hubBoundary + attrBoundary + ATTR_GAP;
  const limit = maxRadius ?? hubBoundary + ATTR_SEARCH_RADIUS;
  if (limit < minRadius) return null;

  const halfW = attr.w / 2;
  const halfH = attr.h / 2;
  const startX = hub.x + dx * hubBoundary;
  const startY = hub.y + dy * hubBoundary;

  // 整条射线的包围盒只查一次空间索引，避免每个半径步都分配查询结果
  const rayMinX = Math.min(hub.x, hub.x + dx * limit) - halfW - 8;
  const rayMaxX = Math.max(hub.x, hub.x + dx * limit) + halfW + 8;
  const rayMinY = Math.min(hub.y, hub.y + dy * limit) - halfH - 8;
  const rayMaxY = Math.max(hub.y, hub.y + dy * limit) + halfH + 8;

  const nearbyBoxes =
    flags.rectNode || flags.edgeNode
      ? queryGridItems(boxGrid, rayMinX, rayMinY, rayMaxX, rayMaxY)
      : [];
  const nearbySegments =
    flags.edgeCross || flags.rectPierce
      ? queryGridItems(segmentGrid, rayMinX, rayMinY, rayMaxX, rayMaxY)
      : [];

  // 把候选节点 / 线段投影到射线坐标系，用 along / perp 先做廉价剪枝
  const project = (px: number, py: number) => {
    const rx = px - hub.x;
    const ry = py - hub.y;
    return { along: rx * dx + ry * dy, perp: -rx * dy + ry * dx };
  };

  const projectedBoxes = nearbyBoxes.map((box) => {
    const { along, perp } = project(box.x, box.y);
    return {
      box,
      along,
      perp,
      projX: Math.abs(dx) * box.halfW + Math.abs(dy) * box.halfH,
      projY: Math.abs(dy) * box.halfW + Math.abs(dx) * box.halfH,
    };
  });

  const projectedSegments = nearbySegments.map((segment) => {
    const a = project(segment.x1, segment.y1);
    const b = project(segment.x2, segment.y2);
    return {
      segment,
      minAlong: Math.min(a.along, b.along),
      maxAlong: Math.max(a.along, b.along),
      minPerp: Math.min(a.perp, b.perp),
      maxPerp: Math.max(a.perp, b.perp),
    };
  });

  const attrProjX = Math.abs(dx) * halfW + Math.abs(dy) * halfH;
  const attrProjY = Math.abs(dy) * halfW + Math.abs(dx) * halfH;

  for (let radius = minRadius; radius <= limit; radius += ATTR_RADIUS_STEP) {
    const x = hub.x + dx * radius;
    const y = hub.y + dy * radius;
    let blocked = false;

    if (flags.rectNode) {
      for (const projected of projectedBoxes) {
        if (projected.box.id === hub.id) continue;
        const bias = projected.box.nodeType === 'attribute' ? -4 : 2;
        if (Math.abs(projected.along - radius) >= attrProjX + projected.projX + bias) continue;
        if (Math.abs(projected.perp) >= attrProjY + projected.projY + bias) continue;
        if (
          Math.abs(x - projected.box.x) < halfW + projected.box.halfW + bias &&
          Math.abs(y - projected.box.y) < halfH + projected.box.halfH + bias
        ) {
          blocked = true;
          break;
        }
      }
    }

    if (!blocked && flags.edgeNode) {
      const endX = x - dx * attrBoundary;
      const endY = y - dy * attrBoundary;
      for (const projected of projectedBoxes) {
        if (projected.box.id === hub.id) continue;
        if (
          projected.along < hubBoundary - projected.projX - 3 ||
          projected.along > radius + projected.projX + 3
        ) {
          continue;
        }
        if (Math.abs(projected.perp) > projected.projY + 3) continue;
        if (
          segmentIntersectsBox(
            startX,
            startY,
            endX,
            endY,
            projected.box.x,
            projected.box.y,
            projected.box.halfW + 3,
            projected.box.halfH + 3,
          )
        ) {
          blocked = true;
          break;
        }
      }
    }

    if (!blocked && flags.edgeCross) {
      const endX = x - dx * attrBoundary;
      const endY = y - dy * attrBoundary;
      for (const projected of projectedSegments) {
        const segment = projected.segment;
        if (segment.source === hub.id || segment.target === hub.id) continue;
        if (projected.maxAlong < hubBoundary - 3 || projected.minAlong > radius + 3) continue;
        if (projected.minPerp > 3 || projected.maxPerp < -3) continue;
        if (
          segmentsIntersect(
            { x: startX, y: startY },
            { x: endX, y: endY },
            { x: segment.x1, y: segment.y1 },
            { x: segment.x2, y: segment.y2 },
          )
        ) {
          blocked = true;
          break;
        }
      }
    }

    if (!blocked && flags.rectPierce) {
      for (const projected of projectedSegments) {
        const segment = projected.segment;
        if (
          projected.maxAlong < radius - attrProjX - 1 ||
          projected.minAlong > radius + attrProjX + 1
        ) {
          continue;
        }
        if (projected.maxPerp < -attrProjY - 1 || projected.minPerp > attrProjY + 1) continue;
        if (
          segmentIntersectsBox(
            segment.x1,
            segment.y1,
            segment.x2,
            segment.y2,
            x,
            y,
            halfW,
            halfH,
          )
        ) {
          blocked = true;
          break;
        }
      }
    }

    if (!blocked) return { angle, radius, dx, dy };
  }

  return null;
}

function segmentIntersectsBox(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  cx: number,
  cy: number,
  halfW: number,
  halfH: number,
): boolean {
  const minX = cx - halfW;
  const maxX = cx + halfW;
  const minY = cy - halfH;
  const maxY = cy + halfH;
  const inside = (x: number, y: number) => x >= minX && x <= maxX && y >= minY && y <= maxY;
  if (inside(x1, y1) || inside(x2, y2)) return true;

  return (
    segmentsIntersect({ x: x1, y: y1 }, { x: x2, y: y2 }, { x: minX, y: minY }, { x: maxX, y: minY }) ||
    segmentsIntersect({ x: x1, y: y1 }, { x: x2, y: y2 }, { x: maxX, y: minY }, { x: maxX, y: maxY }) ||
    segmentsIntersect({ x: x1, y: y1 }, { x: x2, y: y2 }, { x: maxX, y: maxY }, { x: minX, y: maxY }) ||
    segmentsIntersect({ x: x1, y: y1 }, { x: x2, y: y2 }, { x: minX, y: maxY }, { x: minX, y: minY })
  );
}

function attrArc(item: RenderNode): number {
  return Math.max(item.w, item.h) * ATTR_ARC + 12;
}

function makeHub(node: RenderNode, attrs: RenderNode[], dirIds: string[]): Hub {
  const stats = makeOrbitStats(node, attrs, dirIds.length);
  return { id: node.id, node, stats: { ...stats, attrs, dirIds } };
}

function makeOrbitStats(node: RenderNode, attrs: RenderNode[], dirCount: number) {
  const halfW = node.w / 2;
  const halfH = node.h / 2;

  let maxAttrHalfW = 0;
  let maxAttrHalfH = 0;
  let maxAttrRadius = 0;
  let totalArc = 0;

  for (const attr of attrs) {
    maxAttrHalfW = Math.max(maxAttrHalfW, attr.w / 2);
    maxAttrHalfH = Math.max(maxAttrHalfH, attr.h / 2);
    maxAttrRadius = Math.max(maxAttrRadius, Math.hypot(attr.w, attr.h) / 2);
    totalArc += attrArc(attr);
  }

  const dirMargin = dirCount > 0 ? Math.min(1.3, Math.PI / dirCount) / 2 : 0;
  const freeAngle =
    dirCount > 0 ? Math.max(TWO_PI - dirCount * dirMargin * 2, Math.PI / 2) : TWO_PI;

  const baseRadius =
    attrs.length > 0
      ? Math.min(halfW + maxAttrHalfW, halfH + maxAttrHalfH) + ATTR_GAP
      : Math.hypot(node.w, node.h) / 2;

  let orbit = baseRadius;
  if (attrs.length > 0) {
    // 按「内圈放满再向外扩一圈」估算簇半径，而不是把全部属性摊在同一大圆上
    const avgArc = totalArc / attrs.length;
    const ringStep = Math.max(maxAttrHalfH * 2 + ATTR_GAP, 18);
    let remaining = attrs.length;
    for (let ring = 0; ring < 16 && remaining > 0; ring += 1) {
      const capacity = Math.max(1, Math.floor((freeAngle * orbit) / Math.max(avgArc, 1)));
      remaining -= capacity;
      if (remaining > 0) orbit += ringStep;
    }
  }

  return {
    arcRadius: orbit,
    ringRadius: orbit + maxAttrRadius,
  };
}

/* ------------------------------------------------------------------ */
/* 连通分量打包                                                          */
/* ------------------------------------------------------------------ */

function packComponents(nodes: RenderNode[], edges: RenderEdge[]): void {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const parent = new Map<string, string>(nodes.map((n) => [n.id, n.id]));

  const find = (id: string): string => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root)!;
    let current = id;
    while (parent.get(current) !== root) {
      const next = parent.get(current)!;
      parent.set(current, root);
      current = next;
    }
    return root;
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };

  for (const edge of edges) {
    if (!byId.has(edge.source) || !byId.has(edge.target)) continue;
    union(edge.source, edge.target);
  }

  const groups = new Map<string, RenderNode[]>();
  for (const node of nodes) {
    const root = find(node.id);
    const list = groups.get(root) ?? [];
    list.push(node);
    groups.set(root, list);
  }

  if (groups.size <= 1) {
    centerAll(nodes);
    return;
  }

  const boundsOf = (list: RenderNode[]) => {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const node of list) {
      minX = Math.min(minX, node.x - node.w / 2);
      maxX = Math.max(maxX, node.x + node.w / 2);
      minY = Math.min(minY, node.y - node.h / 2);
      maxY = Math.max(maxY, node.y + node.h / 2);
    }
    return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
  };

  const sorted = Array.from(groups.values()).sort((a, b) => {
    const ba = boundsOf(a);
    const bb = boundsOf(b);
    return bb.w * bb.h - ba.w * ba.h;
  });

  const PADDING = 64;
  const totalArea = sorted.reduce((sum, list) => {
    const b = boundsOf(list);
    return sum + (b.w + PADDING) * (b.h + PADDING);
  }, 0);
  const maxWidth = Math.max(1500, Math.sqrt(totalArea * 3));

  let cursorX = 0;
  let cursorY = 0;
  let rowHeight = 0;

  for (const list of sorted) {
    const b = boundsOf(list);
    if (cursorX + b.w > maxWidth && cursorX > 0) {
      cursorX = 0;
      cursorY += rowHeight + PADDING;
      rowHeight = 0;
    }
    const dx = cursorX - b.minX;
    const dy = cursorY - b.minY;
    for (const node of list) {
      node.x += dx;
      node.y += dy;
    }
    cursorX += b.w + PADDING;
    rowHeight = Math.max(rowHeight, b.h);
  }

  centerAll(nodes);
}

function centerAll(nodes: RenderNode[]): void {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const node of nodes) {
    minX = Math.min(minX, node.x - node.w / 2);
    maxX = Math.max(maxX, node.x + node.w / 2);
    minY = Math.min(minY, node.y - node.h / 2);
    maxY = Math.max(maxY, node.y + node.h / 2);
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  for (const node of nodes) {
    node.x -= cx;
    node.y -= cy;
  }
}

function layoutPlainGrid(nodes: RenderNode[]): void {
  const cols = Math.max(1, Math.ceil(Math.sqrt(nodes.length)));
  const spacingX = 220;
  const spacingY = 120;
  nodes.forEach((node, index) => {
    node.x = (index % cols) * spacingX;
    node.y = Math.floor(index / cols) * spacingY;
  });
  centerAll(nodes);
}

/* ------------------------------------------------------------------ */
/* 工具                                                                  */
/* ------------------------------------------------------------------ */

function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function segmentsIntersect(a: Point, b: Point, c: Point, d: Point): boolean {
  const cross = (p: Point, q: Point, r: Point) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}
