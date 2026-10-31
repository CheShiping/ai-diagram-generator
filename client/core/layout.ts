/**
 * 自动布局：
 *  - smart ：智能布局（复刻 huahub）：实体为 hub、属性填联系之间的扇区、联系菱形落在轴线上
 *  - grid  ：实体网格 + 属性环绕
 *  - force ：d3-force 力导向，属性被引力约束在所属实体周围
 *  - elk   ：elkjs layered（分层、从左到右），适合表多且关系复杂的场景
 *
 * 所有布局就地修改节点的 x / y。
 */

import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
} from 'd3-force';
import type { RenderEdge, RenderNode } from './geometry';
import { layoutSmart } from './smart-layout';

export type LayoutKind = 'smart' | 'grid' | 'force' | 'elk' | 'manual';

export const LAYOUT_OPTIONS: Array<{ value: LayoutKind; label: string }> = [
  { value: 'smart', label: '智能布局' },
  { value: 'grid', label: '环形网格' },
  { value: 'force', label: '力导向' },
  { value: 'elk', label: '分层（ELK）' },
  { value: 'manual', label: '导入原位置' },
];

const ELK_OPTIONS: Record<string, string> = {
  'elk.algorithm': 'layered',
  'elk.direction': 'RIGHT',
  'elk.layered.layering.strategy': 'NETWORK_SIMPLEX',
  'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
  'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
  'elk.edgeRouting': 'POLYLINE',
  'elk.layered.spacing.nodeNodeBetweenLayers': '120',
  'elk.spacing.nodeNode': '90',
  'elk.padding': '[top=60,left=60,bottom=60,right=60]',
  'elk.layered.thoroughness': '7',
};

export async function applyLayout(
  kind: LayoutKind,
  nodes: RenderNode[],
  edges: RenderEdge[],
): Promise<void> {
  if (nodes.length === 0) return;

  switch (kind) {
    case 'manual':
      // 保留导入 draw.io 时带进来的原始坐标
      recenter(nodes);
      return;
    case 'force':
      layoutForce(nodes, edges);
      return;
    case 'elk':
      await layoutElk(nodes, edges);
      return;
    case 'smart':
      layoutSmart(nodes, edges);
      return;
    case 'grid':
    default:
      layoutGrid(nodes, edges);
  }
}

/* ------------------------------------------------------------------ */
/* grid：实体网格 + 属性环绕                                             */
/* ------------------------------------------------------------------ */

function layoutGrid(nodes: RenderNode[], edges: RenderEdge[]): void {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const entities = nodes.filter((n) => n.type === 'entity');
  const attributesByParent = new Map<string, RenderNode[]>();

  for (const node of nodes) {
    if (node.type !== 'attribute' || !node.parent) continue;
    const list = attributesByParent.get(node.parent) ?? [];
    list.push(node);
    attributesByParent.set(node.parent, list);
  }

  interface Cluster {
    entity: RenderNode;
    attrs: RenderNode[];
    ringRadius: number;
    width: number;
    height: number;
  }

  const clusters: Cluster[] = entities.map((entity) => {
    const attrs = attributesByParent.get(entity.id) ?? [];
    if (attrs.length === 0) {
      return { entity, attrs, ringRadius: 0, width: entity.w, height: entity.h };
    }

    const maxAttrW = Math.max(...attrs.map((a) => a.w));
    const maxAttrH = Math.max(...attrs.map((a) => a.h));
    // 环周长要容纳所有属性（含间距），据此推半径
    const circumference = attrs.length * (maxAttrW + 20);
    const ringRadius = Math.max(96, circumference / (2 * Math.PI));

    return {
      entity,
      attrs,
      ringRadius,
      width: Math.max(entity.w, 2 * ringRadius + maxAttrW),
      height: Math.max(entity.h, 2 * ringRadius + maxAttrH),
    };
  });

  const cols = Math.max(1, Math.ceil(Math.sqrt(clusters.length)));
  const gapX = 72;
  const gapY = 64;

  let cursorY = 0;
  const rows = Math.ceil(clusters.length / cols);

  for (let row = 0; row < rows; row++) {
    const rowClusters = clusters.slice(row * cols, row * cols + cols);
    const rowHeight = Math.max(...rowClusters.map((c) => c.height));
    let cursorX = 0;

    for (const cluster of rowClusters) {
      const cx = cursorX + cluster.width / 2;
      const cy = cursorY + rowHeight / 2;

      cluster.entity.x = cx;
      cluster.entity.y = cy;

      const n = cluster.attrs.length;
      for (let i = 0; i < n; i++) {
        const angle = -Math.PI / 2 + (2 * Math.PI * i) / n;
        const attr = cluster.attrs[i];
        attr.x = cx + Math.cos(angle) * cluster.ringRadius;
        attr.y = cy + Math.sin(angle) * cluster.ringRadius;
      }

      cursorX += cluster.width + gapX;
    }

    cursorY += rowHeight + gapY;
  }

  placeRelationshipsAtMidpoints(nodes, edges, byId);
}

/** 联系菱形放在两端实体连线的中点（同一对实体的多条联系做垂直错开） */
function placeRelationshipsAtMidpoints(
  nodes: RenderNode[],
  edges: RenderEdge[],
  byId: Map<string, RenderNode>,
): void {
  const relNodes = nodes.filter((n) => n.type === 'relationship');
  if (relNodes.length === 0) return;

  const pairOf = (relId: string): [string, string] | null => {
    const ends = edges
      .filter((e) => e.type === 'relationship' && (e.source === relId || e.target === relId))
      .map((e) => (e.source === relId ? e.target : e.source))
      .filter((id) => byId.get(id)?.type === 'entity');
    return ends.length === 2 ? [ends[0], ends[1]] : null;
  };

  const pairKey = (pair: [string, string]) => [...pair].sort().join('||');
  const totals = new Map<string, number>();
  const seen = new Map<string, number>();

  for (const rel of relNodes) {
    const pair = pairOf(rel.id);
    if (!pair) continue;
    const key = pairKey(pair);
    totals.set(key, (totals.get(key) ?? 0) + 1);
  }

  for (const rel of relNodes) {
    const pair = pairOf(rel.id);
    if (!pair) continue;
    const [aId, bId] = pair;
    const a = byId.get(aId);
    const b = byId.get(bId);
    if (!a || !b) continue;

    const key = pairKey(pair);
    const index = seen.get(key) ?? 0;
    seen.set(key, index + 1);
    const total = totals.get(key) ?? 1;

    let mx = (a.x + b.x) / 2;
    let my = (a.y + b.y) / 2;

    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;

    if (aId === bId) {
      // 自引用联系：放在实体正上方
      rel.x = a.x;
      rel.y = a.y - a.h / 2 - rel.h / 2 - 40 - index * 20;
      continue;
    }

    if (total > 1) {
      const offset = (index - (total - 1) / 2) * 58;
      mx += (-dy / len) * offset;
      my += (dx / len) * offset;
    }

    rel.x = mx;
    rel.y = my;
  }
}

/* ------------------------------------------------------------------ */
/* force：d3 力导向                                                     */
/* ------------------------------------------------------------------ */

interface SimNode extends RenderNode {
  vx?: number;
  vy?: number;
}

function layoutForce(nodes: RenderNode[], edges: RenderEdge[]): void {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const simNodes = nodes as SimNode[];

  const links = edges.map((e) => ({ source: e.source, target: e.target, kind: e.type }));

  const chargeStrength = -Math.min(2400, 420 + nodes.length * 70);

  const simulation = forceSimulation(simNodes)
    .force(
      'link',
      forceLink<SimNode, (typeof links)[number]>(links)
        .id((d) => d.id)
        .distance((l) => (l.kind === 'attribute' ? 92 : 140))
        .strength((l) => (l.kind === 'attribute' ? 0.85 : 0.25)),
    )
    .force('charge', forceManyBody().strength(chargeStrength))
    .force('collide', forceCollide<SimNode>((d) => Math.max(d.w, d.h) / 2 + 12).iterations(2))
    .force('center', forceCenter(0, 0))
    .stop();

  // 自定义力：把属性拉回所属实体附近（d3 没有原生父子约束）
  const parentForce = (alpha: number) => {
    const k = 0.09 * alpha;
    for (const node of simNodes) {
      if (node.type !== 'attribute' || !node.parent) continue;
      const parent = byId.get(node.parent);
      if (!parent) continue;
      node.vx = (node.vx ?? 0) + (parent.x - node.x) * k;
      node.vy = (node.vy ?? 0) + (parent.y - node.y) * k;
    }
  };
  simulation.force('parent', parentForce as unknown as never);

  const ticks = 380;
  for (let i = 0; i < ticks; i++) simulation.tick();

  // 力导向结果居中
  recenter(nodes);
}

/* ------------------------------------------------------------------ */
/* elk：分层布局                                                        */
/* ------------------------------------------------------------------ */

async function layoutElk(nodes: RenderNode[], edges: RenderEdge[]): Promise<void> {
  // ELK 体积较大且非默认布局，按需加载
  const { default: ELK } = await import('elkjs/lib/elk.bundled.js');
  const elk = new ELK();

  const graph = {
    id: 'root',
    layoutOptions: ELK_OPTIONS,
    children: nodes.map((n) => ({
      id: n.id,
      width: Math.max(n.w, 1),
      height: Math.max(n.h, 1),
    })),
    edges: edges.map((e) => ({
      id: e.id,
      sources: [e.source],
      targets: [e.target],
    })),
  };

  const result = await elk.layout(graph as any);
  const byId = new Map(nodes.map((n) => [n.id, n]));

  for (const child of (result.children ?? []) as Array<{
    id: string;
    x?: number;
    y?: number;
    width?: number;
    height?: number;
  }>) {
    const node = byId.get(child.id);
    if (!node) continue;
    node.x = (child.x ?? 0) + (child.width ?? node.w) / 2;
    node.y = (child.y ?? 0) + (child.height ?? node.h) / 2;
  }

  recenter(nodes);
}

/* ------------------------------------------------------------------ */
/* 工具                                                                */
/* ------------------------------------------------------------------ */

/** 把整张图平移到以 (0,0) 为中心的坐标系，便于 fit view */
function recenter(nodes: RenderNode[]): void {
  if (nodes.length === 0) return;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const n of nodes) {
    minX = Math.min(minX, n.x - n.w / 2);
    maxX = Math.max(maxX, n.x + n.w / 2);
    minY = Math.min(minY, n.y - n.h / 2);
    maxY = Math.max(maxY, n.y + n.h / 2);
  }

  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  for (const n of nodes) {
    n.x -= cx;
    n.y -= cy;
  }
}
