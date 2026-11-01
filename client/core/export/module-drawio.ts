/**
 * 功能结构图导出为 draw.io 可编辑 XML。
 *
 * 与 ER 导出的差异：
 *  - 全是直角矩形，黑白线稿
 *  - 竖排节点把每个字用 <br> 连接，保持居中换行
 *  - 连线使用父框底边 → 水平折线 → 子框顶边的路径点，无箭头
 */

import {
  MODULE_LAYOUT,
  moduleEdgeGeometry,
  type ModuleRenderEdge,
  type ModuleRenderNode,
} from '../module-layout';

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function nodeLabel(node: ModuleRenderNode): string {
  if (node.dir === 'v') return [...node.name].join('<br>');
  return node.name;
}

function nodeStyle(): string {
  return [
    'shape=rectangle',
    'rounded=0',
    'whiteSpace=wrap',
    'html=1',
    'align=center',
    'verticalAlign=middle',
    `fillColor=${MODULE_LAYOUT.fill}`,
    `strokeColor=${MODULE_LAYOUT.stroke}`,
    `strokeWidth=${MODULE_LAYOUT.strokeWidth}`,
    `fontSize=${MODULE_LAYOUT.fontSize}`,
    `fontFamily=${encodeURIComponent(MODULE_LAYOUT.fontFamily)}`,
    `fontColor=${MODULE_LAYOUT.textColor}`,
  ].join(';');
}

export interface ModuleDrawioOptions {
  title?: string;
}

export function buildModuleDrawioXml(
  nodes: ModuleRenderNode[],
  edges: ModuleRenderEdge[],
  options: ModuleDrawioOptions = {},
): string {
  const title = escapeXml(options.title ?? '功能结构图');
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const cells: string[] = ['<mxCell id="0" />', '<mxCell id="1" parent="0" />'];
  const cellIdByNode = new Map(nodes.map((node, index) => [node.id, `node-${index}`]));

  for (const [index, node] of nodes.entries()) {
    cells.push(
      `<mxCell id="node-${index}" value="${escapeXml(nodeLabel(node))}" style="${nodeStyle()}" vertex="1" parent="1">` +
        `<mxGeometry x="${(node.x - node.w / 2).toFixed(1)}" y="${(node.y - node.h / 2).toFixed(1)}" width="${node.w.toFixed(1)}" height="${node.h.toFixed(1)}" as="geometry" />` +
        `</mxCell>`,
    );
  }

  for (const [index, edge] of edges.entries()) {
    const source = cellIdByNode.get(edge.source);
    const target = cellIdByNode.get(edge.target);
    if (!source || !target) continue;

    const parent = byId.get(edge.source);
    const child = byId.get(edge.target);
    if (!parent || !child) continue;

    const geo = moduleEdgeGeometry(parent, child);
    const style = [
      'edgeStyle=orthogonalEdgeStyle',
      'rounded=0',
      'html=1',
      'endArrow=none',
      'startArrow=none',
      `strokeColor=${MODULE_LAYOUT.stroke}`,
      `strokeWidth=${MODULE_LAYOUT.strokeWidth}`,
      'exitX=0.5',
      'exitY=1',
      'exitDx=0',
      'exitDy=0',
      'entryX=0.5',
      'entryY=0',
      'entryDx=0',
      'entryDy=0',
    ].join(';');

    cells.push(
      `<mxCell id="edge-${index}" value="" style="${style}" edge="1" parent="1" source="${source}" target="${target}">` +
        `<mxGeometry relative="1" as="geometry">` +
        `<Array as="points">` +
        `<mxPoint x="${geo.startX.toFixed(1)}" y="${geo.railY.toFixed(1)}" />` +
        `<mxPoint x="${geo.endX.toFixed(1)}" y="${geo.railY.toFixed(1)}" />` +
        `</Array></mxGeometry>` +
        `</mxCell>`,
    );
  }

  return (
    `<mxfile host="sql2er" agent="sql2er" version="24.0.0">` +
    `<diagram id="module-diagram" name="${title}">` +
    `<mxGraphModel dx="1400" dy="900" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" math="0" shadow="0">` +
    `<root>${cells.join('')}</root>` +
    `</mxGraphModel></diagram></mxfile>`
  );
}
