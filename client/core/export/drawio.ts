/**
 * 导出为 draw.io（diagrams.net）可编辑 XML。
 * 实体→矩形、属性→椭圆、联系→菱形；主键用 HTML 下划线保留陈式语义。
 */

import type { RenderEdge, RenderNode } from '../geometry';
import { THEME } from '../theme';

const SHAPES: Record<string, string> = {
  entity: 'shape=rectangle;rounded=0',
  attribute: 'shape=ellipse',
  relationship: 'shape=rhombus',
};

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function nodeStyle(node: RenderNode): string {
  const fill =
    node.type === 'entity'
      ? THEME.entityFill
      : node.type === 'attribute'
        ? THEME.attributeFill
        : THEME.relationshipFill;
  const stroke =
    node.type === 'entity'
      ? THEME.entityStroke
      : node.type === 'attribute'
        ? THEME.attributeStroke
        : THEME.relationshipStroke;

  return [
    SHAPES[node.type] ?? SHAPES.entity,
    'whiteSpace=wrap',
    'html=1',
    'align=center',
    'verticalAlign=middle',
    `fillColor=${fill}`,
    `strokeColor=${stroke}`,
    `strokeWidth=${node.type === 'entity' ? THEME.entityStrokeWidth : THEME.strokeWidth}`,
    `fontSize=${THEME.fontSize}`,
    `fontFamily=${encodeURIComponent(THEME.fontFamily.replace(/"/g, ''))}`,
    `fontColor=${THEME.textColor}`,
  ].join(';');
}

/**
 * 返回「未转义」的节点文字片段，由外层 escapeXml 统一处理一次。
 * 主键额外包一层 <u>，draw.io 的 html=1 会渲染成下划线。
 */
function nodeValue(node: RenderNode): string {
  if (node.type === 'attribute' && node.isPrimaryKey) return `<u>${node.name}</u>`;
  return node.name;
}

export interface DrawioOptions {
  /** 图名，默认「ER 图」 */
  title?: string;
}

export function buildDrawioXml(
  nodes: RenderNode[],
  edges: RenderEdge[],
  options: DrawioOptions = {},
): string {
  const title = escapeXml(options.title ?? 'ER 图');

  const cells: string[] = ['<mxCell id="0" />', '<mxCell id="1" parent="0" />'];

  for (const [index, node] of nodes.entries()) {
    cells.push(
      `<mxCell id="node-${index}" value="${escapeXml(nodeValue(node))}" style="${nodeStyle(node)}" vertex="1" parent="1">` +
        `<mxGeometry x="${(node.x - node.w / 2).toFixed(1)}" y="${(node.y - node.h / 2).toFixed(1)}" width="${node.w.toFixed(1)}" height="${node.h.toFixed(1)}" as="geometry" />` +
        `</mxCell>`,
    );
  }

  const nodeIdByKey = new Map(nodes.map((n, i) => [n.id, `node-${i}`]));

  for (const [index, edge] of edges.entries()) {
    const source = nodeIdByKey.get(edge.source);
    const target = nodeIdByKey.get(edge.target);
    if (!source || !target) continue;

    const isRelation = edge.type === 'relationship';
    const style = [
      'endArrow=none',
      'html=1',
      'rounded=0',
      'startArrow=none',
      `strokeColor=${isRelation ? THEME.linkColor : THEME.attributeStroke}`,
      `strokeWidth=${isRelation ? 1.4 : 1}`,
      isRelation ? 'fontSize=12' : 'fontSize=11',
      'labelBackgroundColor=#ffffff',
    ].join(';');

    cells.push(
      `<mxCell id="edge-${index}" value="${escapeXml(edge.text ?? '')}" style="${style}" edge="1" parent="1" source="${source}" target="${target}">` +
        `<mxGeometry relative="1" as="geometry" />` +
        `</mxCell>`,
    );
  }

  return (
    `<mxfile host="sql2er" agent="sql2er" version="24.0.0">` +
    `<diagram id="er-diagram" name="${title}">` +
    `<mxGraphModel dx="1400" dy="900" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" math="0" shadow="0">` +
    `<root>${cells.join('')}</root>` +
    `</mxGraphModel></diagram></mxfile>`
  );
}
