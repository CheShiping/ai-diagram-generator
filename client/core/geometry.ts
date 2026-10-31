/**
 * 几何工具：文本宽度估算、节点尺寸计算、连线端点裁剪。
 * 不依赖 DOM，导出（含服务端渲染）时可复用。
 */

import type { ErNode, NodeType } from '../../shared/er-model';
import { THEME } from './theme';

export interface RenderNode extends ErNode {
  w: number;
  h: number;
  x: number;
  y: number;
}

export interface RenderEdge {
  id: string;
  source: string;
  target: string;
  type: 'attribute' | 'relationship';
  text?: string;
}

/** 估算文本像素宽度：中文按 1em，其他按 0.58em */
export function estimateTextWidth(text: string, fontSize: number = THEME.fontSize): number {
  let width = 0;
  for (const ch of text) {
    if (/[\u3000-\u9fff\uff00-\uffef]/.test(ch)) width += fontSize;
    else if (ch === ' ') width += fontSize * 0.3;
    else width += fontSize * 0.58;
  }
  return width;
}

export function nodeSizeFor(node: Pick<ErNode, 'name' | 'type'>): { w: number; h: number } {
  const textWidth = estimateTextWidth(node.name);

  switch (node.type as NodeType) {
    case 'entity':
      return {
        w: Math.max(THEME.entityMinWidth, textWidth + THEME.padding),
        h: THEME.entityHeight,
      };
    case 'attribute':
      // 椭圆内接矩形需要更宽的水平空间
      return {
        w: Math.max(THEME.attributeMinWidth, textWidth + THEME.padding * 1.4),
        h: THEME.attributeHeight,
      };
    case 'relationship':
    default:
      return {
        w: Math.max(THEME.relationshipMinWidth, textWidth + THEME.padding * 2.2),
        h: THEME.relationshipHeight,
      };
  }
}

/** 把图模型节点补上尺寸与初始坐标 */
export function prepareNodes(nodes: ErNode[]): RenderNode[] {
  return nodes.map((n) => {
    const size = nodeSizeFor(n);
    return { ...n, w: size.w, h: size.h, x: n.x ?? 0, y: n.y ?? 0 };
  });
}

export function prepareEdges(
  links: { source: string; target: string; type: 'attribute' | 'relationship'; text?: string }[],
): RenderEdge[] {
  return links.map((l, i) => ({
    id: `edge-${i}`,
    source: l.source,
    target: l.target,
    type: l.type,
    text: l.text,
  }));
}

/**
 * 求从节点中心沿 (dx, dy) 方向到图形边界的距离。
 * 支持矩形（实体）、椭圆（属性）、菱形（联系）。
 */
export function boundaryOffset(node: RenderNode, dx: number, dy: number): number {
  const halfW = node.w / 2;
  const halfH = node.h / 2;
  const adx = Math.abs(dx);
  const ady = Math.abs(dy);

  if (adx < 1e-6 && ady < 1e-6) return 0;

  switch (node.type) {
    case 'attribute': {
      // 椭圆： (t·dx/rx)² + (t·dy/ry)² = 1
      const rx = Math.max(halfW, 1);
      const ry = Math.max(halfH, 1);
      const denom = Math.sqrt((dx / rx) ** 2 + (dy / ry) ** 2);
      return denom < 1e-6 ? 0 : 1 / denom;
    }
    case 'relationship': {
      // 菱形： |t·dx|/halfW + |t·dy|/halfH = 1
      const denom = adx / Math.max(halfW, 1) + ady / Math.max(halfH, 1);
      return denom < 1e-6 ? 0 : 1 / denom;
    }
    case 'entity':
    default: {
      // 矩形
      const tx = adx < 1e-6 ? Infinity : halfW / adx;
      const ty = ady < 1e-6 ? Infinity : halfH / ady;
      return Math.min(tx, ty);
    }
  }
}

export interface EdgeGeometry {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  midX: number;
  midY: number;
  /** 基数标签位置：实体与联系菱形连线的中点 */
  labelX: number;
  labelY: number;
}

/**
 * 计算一条边的可视端点（裁掉被节点图形遮住的部分）。
 * 基数标签放在「实体—菱形」连线的中间位置。
 */
export function edgeGeometry(from: RenderNode, to: RenderNode, gap = 3): EdgeGeometry {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy) || 1;
  const ux = dx / length;
  const uy = dy / length;

  // boundaryOffset 期望单位方向，返回的数值即为沿该方向到图形边界的像素距离
  const tFrom = boundaryOffset(from, ux, uy);
  const tTo = boundaryOffset(to, -ux, -uy);

  const startX = from.x + ux * (tFrom + gap);
  const startY = from.y + uy * (tFrom + gap);
  const endX = to.x - ux * (tTo + gap);
  const endY = to.y - uy * (tTo + gap);

  const midX = (startX + endX) / 2;
  const midY = (startY + endY) / 2;

  return { x1: startX, y1: startY, x2: endX, y2: endY, midX, midY, labelX: midX, labelY: midY };
}

/** 计算整张图的包围盒，用于 fit view 与导出 */
export function computeBounds(nodes: RenderNode[]): { minX: number; minY: number; maxX: number; maxY: number } {
  if (nodes.length === 0) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
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
  return { minX, minY, maxX, maxY };
}
