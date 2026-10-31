<script setup lang="ts">
import { drag, select, zoom, zoomIdentity, type ZoomBehavior } from 'd3';
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { ErDiagram } from '@shared/er-model';
import {
  computeBounds,
  edgeGeometry,
  estimateTextWidth,
  prepareEdges,
  prepareNodes,
  type EdgeGeometry,
  type RenderEdge,
  type RenderNode,
} from '@/core/geometry';
import { applyLayout, type LayoutKind } from '@/core/layout';
import { THEME } from '@/core/theme';

const props = defineProps<{
  diagram: ErDiagram;
  layoutKind: LayoutKind;
  showAttributes: boolean;
}>();

const emit = defineEmits<{ (e: 'rendered'): void }>();

const containerRef = ref<HTMLDivElement | null>(null);
const svgRef = ref<SVGSVGElement | null>(null);
const viewportRef = ref<SVGGElement | null>(null);

let renderNodes: RenderNode[] = [];
let renderEdges: Array<RenderEdge & { geo?: EdgeGeometry }> = [];
let renderToken = 0;
let zoomBehavior: ZoomBehavior<SVGSVGElement, unknown> | null = null;

const SVG_NS = 'http://www.w3.org/2000/svg';

/* ---------------- 场景构建与布局 ---------------- */

function visibleScene() {
  const allNodes = prepareNodes(props.diagram.nodes);
  const nodes = props.showAttributes ? allNodes : allNodes.filter((n) => n.type !== 'attribute');
  const ids = new Set(nodes.map((n) => n.id));
  const edges = prepareEdges(props.diagram.links).filter((e) => ids.has(e.source) && ids.has(e.target));
  return { nodes, edges };
}

async function rebuild(): Promise<void> {
  const token = ++renderToken;
  const { nodes, edges } = visibleScene();

  if (nodes.length === 0) {
    renderNodes = [];
    renderEdges = [];
    renderAll();
    return;
  }

  await applyLayout(props.layoutKind, nodes, edges);
  if (token !== renderToken) return;

  renderNodes = nodes;
  renderEdges = edges.map((e) => ({ ...e }));
  renderAll();
  fitView();
  emit('rendered');
}

/* ---------------- 渲染 ---------------- */

function nodeGroup(): SVGGElement | null {
  return viewportRef.value?.querySelector('g.nodes') ?? null;
}
function edgeGroup(): SVGGElement | null {
  return viewportRef.value?.querySelector('g.edges') ?? null;
}
function labelGroup(): SVGGElement | null {
  return viewportRef.value?.querySelector('g.edge-labels') ?? null;
}

function nodeColor(type: RenderNode['type']): { fill: string; stroke: string } {
  switch (type) {
    case 'entity':
      return { fill: THEME.entityFill, stroke: THEME.entityStroke };
    case 'attribute':
      return { fill: THEME.attributeFill, stroke: THEME.attributeStroke };
    default:
      return { fill: THEME.relationshipFill, stroke: THEME.relationshipStroke };
  }
}

function renderAll(): void {
  const nodesG = nodeGroup();
  const edgesG = edgeGroup();
  const labelsG = labelGroup();
  if (!nodesG || !edgesG || !labelsG) return;

  // 清空重绘（节点量级在几十个，全量重绘足够快且逻辑最简单）
  select(nodesG).selectAll('*').remove();
  select(edgesG).selectAll('*').remove();
  select(labelsG).selectAll('*').remove();

  const byId = new Map(renderNodes.map((n) => [n.id, n]));

  // 1) 连线
  select(edgesG)
    .selectAll('line')
    .data(renderEdges)
    .join('line')
    .attr('stroke', THEME.linkColor)
    .attr('stroke-width', THEME.strokeWidth)
    .attr('stroke-linecap', 'round');

  // 2) 基数标签（放在实体—菱形连线中点，白描边遮住底下的连线）
  select(labelsG)
    .selectAll('text')
    .data(renderEdges.filter((e) => e.type === 'relationship' && e.text))
    .join('text')
    .attr('font-family', THEME.fontFamily)
    .attr('font-size', THEME.linkLabelFontSize)
    .attr('font-weight', 600)
    .attr('fill', THEME.textColor)
    .attr('stroke', THEME.background)
    .attr('stroke-width', 3)
    .attr('stroke-linecap', 'round')
    .attr('paint-order', 'stroke')
    .attr('text-anchor', 'middle')
    .attr('pointer-events', 'none')
    .text((d) => d.text ?? '');

  // 3) 节点
  const groups = select(nodesG)
    .selectAll<SVGGElement, RenderNode>('g')
    .data(renderNodes, (d) => d.id)
    .join('g')
    .attr('class', 'er-node')
    .attr('cursor', 'grab');

  groups.each(function (d) {
    const g = select(this);
    const colors = nodeColor(d.type);

    if (d.type === 'entity') {
      g.append('rect')
        .attr('x', -d.w / 2)
        .attr('y', -d.h / 2)
        .attr('width', d.w)
        .attr('height', d.h)
        .attr('rx', THEME.cornerRadius)
        .attr('ry', THEME.cornerRadius)
        .attr('fill', colors.fill)
        .attr('stroke', colors.stroke)
        .attr('stroke-width', THEME.entityStrokeWidth);
    } else if (d.type === 'attribute') {
      g.append('ellipse')
        .attr('rx', d.w / 2)
        .attr('ry', d.h / 2)
        .attr('fill', colors.fill)
        .attr('stroke', colors.stroke)
        .attr('stroke-width', THEME.strokeWidth);
    } else {
      // 菱形：联系
      g.append('path')
        .attr('d', `M0,${-d.h / 2} L${d.w / 2},0 L0,${d.h / 2} L${-d.w / 2},0 Z`)
        .attr('fill', colors.fill)
        .attr('stroke', colors.stroke)
        .attr('stroke-width', THEME.strokeWidth);
    }

    g.append('text')
      .attr('font-family', THEME.fontFamily)
      .attr('font-size', THEME.fontSize)
      .attr('font-weight', d.type === 'entity' ? 700 : 400)
      .attr('fill', THEME.textColor)
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'central')
      .attr('pointer-events', 'none')
      .text(d.name);

    // 主键：属性名下加下划线（陈式规范）
    if (d.type === 'attribute' && d.isPrimaryKey) {
      const textWidth = Math.min(estimateTextWidth(d.name), d.w - 10);
      g.append('line')
        .attr('class', 'pk-underline')
        .attr('x1', -textWidth / 2)
        .attr('y1', THEME.fontSize / 2 + 3)
        .attr('x2', textWidth / 2)
        .attr('y2', THEME.fontSize / 2 + 3)
        .attr('stroke', THEME.textColor)
        .attr('stroke-width', 1.1)
        .attr('pointer-events', 'none');
    }
  });

  updateNodeTransforms();
  updateEdgeGeometry();
  attachDrag(groups);
}

function updateNodeTransforms(): void {
  const nodesG = nodeGroup();
  if (!nodesG) return;
  select(nodesG)
    .selectAll<SVGGElement, RenderNode>('g')
    .attr('transform', (d) => `translate(${d.x},${d.y})`);
}

function updateEdgeGeometry(): void {
  const byId = new Map(renderNodes.map((n) => [n.id, n]));

  const visibleEdges: typeof renderEdges = [];
  for (const edge of renderEdges) {
    const from = byId.get(edge.source);
    const to = byId.get(edge.target);
    if (!from || !to) continue;
    edge.geo = edgeGeometry(from, to);
    visibleEdges.push(edge);
  }

  select(edgeGroup())
    .selectAll<SVGLineElement, (typeof renderEdges)[number]>('line')
    .attr('x1', (d) => d.geo?.x1 ?? 0)
    .attr('y1', (d) => d.geo?.y1 ?? 0)
    .attr('x2', (d) => d.geo?.x2 ?? 0)
    .attr('y2', (d) => d.geo?.y2 ?? 0);

  select(labelGroup())
    .selectAll<SVGTextElement, (typeof renderEdges)[number]>('text')
    .attr('x', (d) => d.geo?.labelX ?? 0)
    .attr('y', (d) => d.geo?.labelY ?? 0)
    .attr('dy', '-0.15em');
}

/* ---------------- 拖拽 ---------------- */

let draggingSet: RenderNode[] = [];

function attachDrag(groups: ReturnType<typeof select> | any): void {
  const dragBehavior = drag<SVGGElement, RenderNode>()
    .container(function () {
      return this.parentNode as SVGGElement;
    })
    .on('start', function (_event, d: RenderNode) {
      // 拖动实体/联系时，挂在它下面的属性椭圆一起走
      draggingSet = renderNodes.filter((n) => n.type === 'attribute' && n.parent === d.id);
      draggingSet.unshift(d);
      select(this).attr('cursor', 'grabbing');
    })
    .on('drag', function (event: any) {
      const deltaX = event.dx ?? 0;
      const deltaY = event.dy ?? 0;
      for (const node of draggingSet) {
        node.x += deltaX;
        node.y += deltaY;
      }
      updateNodeTransforms();
      updateEdgeGeometry();
    })
    .on('end', function () {
      draggingSet = [];
      select(this).attr('cursor', 'grab');
    });

  groups.call(dragBehavior);
}

/* ---------------- 缩放与适配 ---------------- */

function setupZoom(): void {
  if (!svgRef.value) return;

  zoomBehavior = zoom<SVGSVGElement, unknown>()
    .scaleExtent([0.15, 3])
    .on('zoom', (event) => {
      if (viewportRef.value) {
        select(viewportRef.value).attr('transform', event.transform.toString());
      }
    });

  select(svgRef.value).call(zoomBehavior).on('dblclick.zoom', null);
}

function fitView(): void {
  if (!svgRef.value || !zoomBehavior || !containerRef.value) return;
  if (renderNodes.length === 0) {
    select(svgRef.value).call(zoomBehavior.transform, zoomIdentity);
    return;
  }

  const bounds = computeBounds(renderNodes);
  const cw = containerRef.value.clientWidth;
  const ch = containerRef.value.clientHeight;
  const padding = 56;

  const graphW = Math.max(bounds.maxX - bounds.minX, 1);
  const graphH = Math.max(bounds.maxY - bounds.minY, 1);

  const scale = Math.min(cw / (graphW + padding * 2), ch / (graphH + padding * 2), 1.5);
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;

  const transform = zoomIdentity
    .translate(cw / 2 - cx * scale, ch / 2 - cy * scale)
    .scale(Math.max(scale, 0.15));

  select(svgRef.value).call(zoomBehavior.transform, transform);
}

/* ---------------- 生命周期 ---------------- */

let observer: ResizeObserver | null = null;

onMounted(async () => {
  setupZoom();
  await nextTick();

  if (typeof ResizeObserver !== 'undefined' && containerRef.value) {
    observer = new ResizeObserver(() => {
      // 尺寸变化时只重绘适配，不重跑布局
      if (renderNodes.length > 0) fitView();
    });
    observer.observe(containerRef.value);
  }

  await rebuild();
});

onBeforeUnmount(() => {
  observer?.disconnect();
  observer = null;
});

watch(() => [props.diagram, props.layoutKind, props.showAttributes], () => rebuild(), { deep: true });

defineExpose({
  getSvg: () => svgRef.value,
  getNodes: () => renderNodes,
  getEdges: () => renderEdges,
  fitView,
});
</script>

<template>
  <div ref="containerRef" class="er-canvas">
    <svg ref="svgRef" class="er-svg" xmlns="http://www.w3.org/2000/svg">
      <g ref="viewportRef" class="viewport">
        <g class="edges"></g>
        <g class="edge-labels"></g>
        <g class="nodes"></g>
      </g>
    </svg>

    <div v-if="diagram.nodes.length === 0" class="empty-hint">
      <p>左侧输入 SQL 或业务描述，生成陈式 ER 图</p>
      <p class="sub">实体＝矩形 · 属性＝椭圆 · 联系＝菱形</p>
    </div>
  </div>
</template>

<style scoped>
.er-canvas {
  position: relative;
  width: 100%;
  height: 100%;
  background: #ffffff;
  overflow: hidden;
}

.er-svg {
  width: 100%;
  height: 100%;
  display: block;
}

.empty-hint {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: #8b9bb0;
  font-size: 14px;
  gap: 6px;
  pointer-events: none;
}

.empty-hint .sub {
  font-size: 12px;
  color: #aab7c8;
}
</style>
