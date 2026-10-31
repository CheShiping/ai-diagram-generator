/**
 * 智能布局（复刻 huahub「智能布局」的核心思路）：
 *
 *  1. 实体是「中心」：属性椭圆环绕实体，联系菱形夹在两个实体之间的轴线上；
 *  2. 联系方向先占位，属性只填在联系之间的扇形空隙里，避免压线；
 *  3. 用带约束的物理迭代收敛：联系两端拉到合适距离、无联系实体互相排斥、
 *     共享邻居的实体保持角度间隔；
 *  4. 交换实体位置以减少联系之间的交叉；
 *  5. 关联表（多对多）会变成带属性的菱形，属性环绕菱形排布；
 *  6. 最后做一轮全局松弛，把属性 / 菱形推到不重叠的位置，再按连通分量打包。
 *
 * 所有坐标就地写入 RenderNode.x / y。
 */

import type { RenderEdge, RenderNode } from './geometry';

const GAP = 22;
const ATTR_GAP = 6;
const ATTR_ARC = 0.45;
const MIN_AXIS = 120;

interface Point {
  x: number;
  y: number;
}

interface HubStats {
  attrs: RenderNode[];
  dirIds: string[];
  /** 属性环基准半径 */
  arcRadius: number;
  /** 实体/联系自身边界到属性环的最小半径 */
  baseRadius: number;
  /** 碰撞半径（含最大属性） */
  ringRadius: number;
  maxAttrRadius: number;
  halfW: number;
  halfH: number;
  maxAttrHalfW: number;
  maxAttrHalfH: number;
  totalArc: number;
  dirMargin: number;
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
  maxAttrRadius: number;
  dirMargin: number;
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
        ringRadius: stat.orbit + stat.maxAttrRadius,
        maxAttrRadius: stat.maxAttrRadius,
        dirMargin: stat.dirMargin,
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
      maxAttrRadius: 0,
      dirMargin: 0,
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
    const { ux, uy, dist } = unit(pa, pb);
    const clearA = rectDist(a.node.w, a.node.h, ux, uy) + (a.stats.maxAttrRadius || 0) + GAP;
    const clearB = rectDist(b.node.w, b.node.h, -ux, -uy) + (b.stats.maxAttrRadius || 0) + GAP;
    const relRadius = axis.node ? Math.max(axis.node.w, axis.node.h) / 2 : 0;
    return Math.max(MIN_AXIS, clearA + clearB + relRadius * 2, axis.ringRadius * 2 + GAP);
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
        else if (dist > required * 1.5 + 1) shift = required * 1.5 - dist;
        if (shift === null) continue;

        const k = dist < required - 1 ? 0.2 : 0.05;
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
  const relAttractors = new Map<string, Point>();

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
    const point = { x: pa.x + ux * t, y: pa.y + uy * t };
    rel.x = point.x;
    rel.y = point.y;
    relAttractors.set(axis.relId, point);
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
        // 多联系错开后，松弛时的回拉目标也要跟着更新
        relAttractors.set(item.relId, { x: item.node!.x, y: item.node!.y });
      });
  }

  // 属性环绕：联系方向占位，属性填到扇形空隙
  for (const hub of hubs) {
    placeSatellites(hub, positions.get(hub.id)!, positions, hubById);
  }

  // 轴线上带属性的联系（多对多关联表）也要把属性铺开
  for (const axis of axisRels) {
    if (!axis.node || axis.attrs.length === 0) continue;
    const relHub: Hub = {
      id: axis.relId,
      node: axis.node,
      stats: { ...makeOrbitStats(axis.node, axis.attrs, 2), attrs: axis.attrs, dirIds: [axis.aId, axis.bId] },
    };
    placeSatellites(relHub, { x: axis.node.x, y: axis.node.y }, positions, hubById);
  }

  // 全局松弛：属性 / 菱形互不重叠，菱形被拉回轴线
  relaxAll(nodes, edges, relAttractors);

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
/* 属性排布                                                              */
/* ------------------------------------------------------------------ */

function placeSatellites(
  hub: Hub,
  center: Point,
  positions: Map<string, Point>,
  hubById: Map<string, Hub>,
): void {
  const attrs = hub.stats.attrs;
  if (attrs.length === 0) return;

  const dirAngles: number[] = [];
  for (const dirId of hub.stats.dirIds) {
    const target = positions.get(dirId) ?? hubById.get(dirId)?.node;
    if (!target) continue;
    const ux = target.x - center.x;
    const uy = target.y - center.y;
    if (Math.hypot(ux, uy) < 1e-6) continue;
    dirAngles.push(normAngle(Math.atan2(uy, ux)));
  }
  dirAngles.sort((a, b) => a - b);

  const margin = hub.stats.dirMargin;
  let gaps: Array<{ start: number; length: number }> = [];

  if (dirAngles.length === 0) {
    gaps = [{ start: 0, length: TWO_PI }];
  } else {
    for (let i = 0; i < dirAngles.length; i += 1) {
      const current = dirAngles[i];
      const next = dirAngles[(i + 1) % dirAngles.length] + (i === dirAngles.length - 1 ? TWO_PI : 0);
      const start = current + margin;
      const length = next - margin - start;
      if (length > 0.05) gaps.push({ start, length });
    }
    if (gaps.length === 0) gaps = [{ start: 0, length: TWO_PI }];
  }

  // 每个空隙分到的属性数量 ∝ 空隙角度
  const totalGap = gaps.reduce((sum, gap) => sum + gap.length, 0);
  const sorted = attrs.slice().sort((a, b) => a.id.localeCompare(b.id));
  const counts = gaps.map((gap) => Math.max(0, Math.round((sorted.length * gap.length) / totalGap)));
  let assigned = counts.reduce((sum, c) => sum + c, 0);
  while (assigned < sorted.length) {
    let widest = 0;
    gaps.forEach((gap, i) => {
      if (gap.length > gaps[widest].length) widest = i;
    });
    counts[widest] += 1;
    assigned += 1;
  }
  while (assigned > sorted.length) {
    for (let i = counts.length - 1; i >= 0; i -= 1) {
      if (counts[i] > 0) {
        counts[i] -= 1;
        assigned -= 1;
        break;
      }
    }
  }

  let index = 0;
  gaps.forEach((gap, gapIndex) => {
    const count = counts[gapIndex];
    if (count === 0) return;
    const items = sorted.slice(index, index + count);
    index += count;

    const arcNeeded = gap.length > 1e-6 ? items.reduce((sum, item) => sum + attrArc(item), 0) / gap.length : 0;
    items.forEach((item, k) => {
      const angle = gap.start + (gap.length * (k + 0.5)) / count;
      const ux = Math.cos(angle);
      const uy = Math.sin(angle);
      const boundary = boundaryDist(hub.node, ux, uy) + boundaryDist(item, ux, uy) + ATTR_GAP;
      const radius = Math.max(boundary, arcNeeded);
      item.x = center.x + ux * radius;
      item.y = center.y + uy * radius;
    });
  });

  // 兜底：空隙计算异常时按整圈均匀铺开
  if (index < sorted.length) {
    const rest = sorted.slice(index);
    const radius = Math.max(...rest.map((item) => Math.max(item.w, item.h) / 2 + hub.stats.baseRadius + ATTR_GAP));
    rest.forEach((item, k) => {
      const angle = (TWO_PI * k) / rest.length - Math.PI / 2;
      item.x = center.x + Math.cos(angle) * radius;
      item.y = center.y + Math.sin(angle) * radius;
    });
  }
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

  const arcRadius = attrs.length > 0 ? totalArc / freeAngle : 0;
  const baseRadius =
    attrs.length > 0
      ? Math.min(halfW + maxAttrHalfW, halfH + maxAttrHalfH) + ATTR_GAP
      : Math.hypot(node.w, node.h) / 2;

  const orbit = Math.max(baseRadius, arcRadius);

  return {
    arcRadius,
    baseRadius,
    orbit,
    ringRadius: orbit + maxAttrRadius,
    maxAttrRadius,
    halfW,
    halfH,
    maxAttrHalfW,
    maxAttrHalfH,
    totalArc,
    dirMargin,
  };
}

/* ------------------------------------------------------------------ */
/* 全局松弛与打包                                                        */
/* ------------------------------------------------------------------ */

function relaxAll(
  nodes: RenderNode[],
  edges: RenderEdge[],
  relAttractors: Map<string, Point>,
): void {
  const radiusOf = (node: RenderNode) => Math.hypot(node.w, node.h) / 2;

  /** 把属性推到父图形的边界之外，返回移动距离 */
  const clampOutside = (attr: RenderNode, parent: RenderNode): number => {
    const dx = attr.x - parent.x;
    const dy = attr.y - parent.y;
    const dist = Math.hypot(dx, dy) || 0.01;
    const ux = dx / dist;
    const uy = dy / dist;
    const required = boundaryDist(parent, ux, uy) + boundaryDist(attr, ux, uy) + ATTR_GAP;
    if (dist >= required) return 0;
    attr.x = parent.x + ux * required;
    attr.y = parent.y + uy * required;
    return required - dist;
  };
  const hubIds = new Set(
    nodes.filter((n) => n.type !== 'attribute').map((n) => n.id),
  );

  // 轴线两端跳过（已由物理迭代约束）
  const axisPairs = new Set<string>();
  for (const edge of edges) {
    if (edge.type !== 'relationship') continue;
    const source = nodes.find((n) => n.id === edge.source);
    const target = nodes.find((n) => n.id === edge.target);
    if (!source || !target) continue;
    if (source.type === 'relationship' && target.type === 'entity') axisPairs.add(pairKey(source.id, target.id));
    if (source.type === 'entity' && target.type === 'relationship') axisPairs.add(pairKey(source.id, target.id));
  }

  for (let iter = 0; iter < 300; iter += 1) {
    let moved = 0;

    for (let i = 0; i < nodes.length; i += 1) {
      for (let j = i + 1; j < nodes.length; j += 1) {
        const a = nodes[i];
        const b = nodes[j];

        // 属性与父节点不做互斥推开，但必须保证属性在父图形之外
        if (a.type === 'attribute' && a.parent === b.id) {
          moved = Math.max(moved, clampOutside(a, b));
          continue;
        }
        if (b.type === 'attribute' && b.parent === a.id) {
          moved = Math.max(moved, clampOutside(b, a));
          continue;
        }

        const bothHubs = hubIds.has(a.id) && hubIds.has(b.id);
        if (bothHubs) continue;

        const dx = b.x - a.x;
        const dy = b.y - a.y;
        let dist = Math.hypot(dx, dy);
        if (dist === 0) dist = 0.01;
        const ux = dx / dist;
        const uy = dy / dist;

        const margin = a.type === 'attribute' && b.type === 'attribute' ? 0 : 8;
        const required = radiusOf(a) + radiusOf(b) + margin;
        if (dist >= required) continue;

        const overlap = required - dist;
        let moveA: number;
        let moveB: number;
        if (hubIds.has(a.id)) {
          moveA = 0;
          moveB = overlap;
        } else if (hubIds.has(b.id)) {
          moveA = overlap;
          moveB = 0;
        } else {
          moveA = overlap / 2;
          moveB = overlap / 2;
        }
        a.x -= ux * moveA;
        a.y -= uy * moveA;
        b.x += ux * moveB;
        b.y += uy * moveB;
        moved = Math.max(moved, Math.max(moveA, moveB));
      }
    }

    // 轴线上的菱形被轻轻拉回原位
    for (const [relId, target] of relAttractors) {
      const node = nodes.find((n) => n.id === relId);
      if (!node) continue;
      node.x = node.x * 0.85 + target.x * 0.15;
      node.y = node.y * 0.85 + target.y * 0.15;
    }

    if (moved < 0.3) break;
  }
}

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

  const PADDING = 90;
  const totalArea = sorted.reduce((sum, list) => {
    const b = boundsOf(list);
    return sum + (b.w + PADDING) * (b.h + PADDING);
  }, 0);
  const maxWidth = Math.max(1200, Math.sqrt(totalArea * 2.4));

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
