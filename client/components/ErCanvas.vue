<script setup lang="ts">
import { drag, pointer, select, zoom, zoomIdentity, type ZoomBehavior } from 'd3';
import { ElMessageBox } from 'element-plus';
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { ErDiagram } from '@shared/er-model';
import {
  computeBounds,
  edgeGeometry,
  estimateTextWidth,
  nodeSizeFor,
  prepareEdges,
  prepareNodes,
  type EdgeGeometry,
  type RenderEdge,
  type RenderNode,
} from '@/core/geometry';
import { applyLayout, type LayoutKind } from '@/core/layout';
import { THEME } from '@/core/theme';
import { useDiagramStore } from '@/stores/diagram';

const props = defineProps<{
  diagram: ErDiagram;
  layoutKind: LayoutKind;
  showAttributes: boolean;
}>();

const emit = defineEmits<{ (e: 'rendered'): void }>();

const store = useDiagramStore();

const containerRef = ref<HTMLDivElement | null>(null);
const svgRef = ref<SVGSVGElement | null>(null);
const viewportRef = ref<SVGGElement | null>(null);
const selectionRectRef = ref<SVGRectElement | null>(null);

let renderNodes: RenderNode[] = [];
let renderEdges: Array<RenderEdge & { geo?: EdgeGeometry }> = [];
let renderToken = 0;
let zoomBehavior: ZoomBehavior<SVGSVGElement, unknown> | null = null;
let structureSignature = '';

const SVG_NS = 'http://www.w3.org/2000/svg';

/* ---------------- 选择与撤销 ---------------- */

interface NodeSnapshotEntry {
  id: string;
  x: number;
  y: number;
  name: string;
}

interface NodeSnapshot {
  nodes: NodeSnapshotEntry[];
  selection: string[];
}

const HISTORY_LIMIT = 60;

let selectedIds = new Set<string>();
let historyStack: NodeSnapshot[] = [];
let dragSnapshot: NodeSnapshot | null = null;
let dragTravel = 0;
let suppressClick = false;
let draggingSet: RenderNode[] = [];

let boxSelecting = false;
let boxMoved = false;
let boxStartScreen = { x: 0, y: 0 };
let boxStartGraph = { x: 0, y: 0 };
let boxEndGraph = { x: 0, y: 0 };
let boxInitialSelection: string[] = [];

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
  structureSignature = structureSignatureOf(props.diagram);
  historyStack = [];
  selectedIds = new Set();
  draggingSet = [];

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

/** 只比较结构，改名不会触发重新布局 */
function structureSignatureOf(diagram: ErDiagram): string {
  const nodes = diagram.nodes
    .map((n) => `${n.id}|${n.type}|${n.parent ?? ''}|${n.isPrimaryKey ? 1 : 0}`)
    .join(';');
  const links = diagram.links.map((l) => `${l.source}>${l.target}|${l.type}|${l.text ?? ''}`).join(';');
  return `${nodes}#${links}`;
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
  applySelectionStyles();
}

/** 只同步节点名称与尺寸，保留当前坐标（改名 / 切换注释都不重新布局） */
function syncLabelsFromDiagram(): void {
  const byId = new Map(props.diagram.nodes.map((n) => [n.id, n]));
  let changed = false;

  for (const node of renderNodes) {
    const source = byId.get(node.id);
    if (!source || node.name === source.name) continue;
    node.name = source.name;
    const size = nodeSizeFor(source);
    node.w = size.w;
    node.h = size.h;
    changed = true;
  }

  if (changed) renderAll();
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

/* ---------------- 选择 / 撤销 / 拖拽 ---------------- */

function renderNodeMap(): Map<string, RenderNode> {
  return new Map(renderNodes.map((n) => [n.id, n]));
}

function snapshotScene(): NodeSnapshot {
  return {
    nodes: renderNodes.map((n) => ({ id: n.id, x: n.x, y: n.y, name: n.name })),
    selection: Array.from(selectedIds),
  };
}

function pushHistory(snapshot: NodeSnapshot): void {
  historyStack.push(snapshot);
  if (historyStack.length > HISTORY_LIMIT) historyStack.shift();
}

function applySelectionStyles(): void {
  const nodesG = nodeGroup();
  if (!nodesG) return;
  select(nodesG)
    .selectAll<SVGGElement, RenderNode>('g.er-node')
    .classed('selected', (d) => selectedIds.has(d.id));
}

function setSelection(ids: Set<string>): void {
  selectedIds = ids;
  applySelectionStyles();
}

function selectOnly(id: string): void {
  setSelection(new Set([id]));
}

function toggleSelection(id: string): void {
  const next = new Set(selectedIds);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  setSelection(next);
}

function clearSelection(): void {
  setSelection(new Set());
}

/** 拖动集合：选中的节点 + 实体/联系下面挂着的属性 */
function collectMovingNodes(dragged: RenderNode): RenderNode[] {
  const byId = renderNodeMap();
  const base = selectedIds.has(dragged.id) ? selectedIds : new Set([dragged.id]);
  const moving = new Set<string>();

  for (const id of base) {
    if (byId.has(id)) moving.add(id);
  }
  for (const id of base) {
    const node = byId.get(id);
    if (!node || node.type === 'attribute') continue;
    for (const child of renderNodes) {
      if (child.type === 'attribute' && child.parent === node.id) moving.add(child.id);
    }
  }

  return renderNodes.filter((n) => moving.has(n.id));
}

function renameNode(node: RenderNode): void {
  ElMessageBox.prompt('输入新的名称', '重命名', {
    inputValue: node.name,
    confirmButtonText: '确定',
    cancelButtonText: '取消',
    inputValidator: (value) => (value.trim() ? true : '名称不能为空'),
  })
    .then(({ value }) => {
      const name = value.trim();
      if (!name || name === node.name) return;

      pushHistory(snapshotScene());
      node.name = name;
      const size = nodeSizeFor(node);
      node.w = size.w;
      node.h = size.h;
      store.renameNodes({ [node.id]: name });
      renderAll();
    })
    .catch(() => {
      /* 用户取消 */
    });
}

function undo(): void {
  const snapshot = historyStack.pop();
  if (!snapshot) return;

  const byId = renderNodeMap();
  const names: Record<string, string> = {};
  let labelsChanged = false;

  for (const entry of snapshot.nodes) {
    const node = byId.get(entry.id);
    if (!node) continue;
    node.x = entry.x;
    node.y = entry.y;
    if (node.name !== entry.name) {
      node.name = entry.name;
      const size = nodeSizeFor(node);
      node.w = size.w;
      node.h = size.h;
      names[entry.id] = entry.name;
      labelsChanged = true;
    }
  }

  if (labelsChanged) store.renameNodes(names);
  selectedIds = new Set(snapshot.selection.filter((id) => byId.has(id)));
  renderAll();
}

function attachDrag(groups: ReturnType<typeof select> | any): void {
  const dragBehavior = drag<SVGGElement, RenderNode>()
    .container(function () {
      return this.parentNode as SVGGElement;
    })
    .on('start', function (_event, d: RenderNode) {
      dragSnapshot = snapshotScene();
      dragTravel = 0;
      suppressClick = false;
      if (!selectedIds.has(d.id)) selectOnly(d.id);
      draggingSet = collectMovingNodes(d);
      select(this).attr('cursor', 'grabbing');
    })
    .on('drag', function (event: any) {
      const deltaX = event.dx ?? 0;
      const deltaY = event.dy ?? 0;
      dragTravel += Math.abs(deltaX) + Math.abs(deltaY);
      for (const node of draggingSet) {
        node.x += deltaX;
        node.y += deltaY;
      }
      updateNodeTransforms();
      updateEdgeGeometry();
    })
    .on('end', function () {
      if (dragTravel > 3 && dragSnapshot) pushHistory(dragSnapshot);
      suppressClick = dragTravel > 3;
      if (suppressClick) {
        setTimeout(() => {
          suppressClick = false;
        }, 0);
      }
      dragSnapshot = null;
      draggingSet = [];
      select(this).attr('cursor', 'grab');
    });

  groups
    .call(dragBehavior)
    .on('click.select', function (event: MouseEvent, d: RenderNode) {
      if (suppressClick) {
        suppressClick = false;
        return;
      }
      event.stopPropagation();
      if (event.shiftKey) toggleSelection(d.id);
      else selectOnly(d.id);
    })
    .on('dblclick.rename', function (event: MouseEvent, d: RenderNode) {
      event.stopPropagation();
      renameNode(d);
    });
}

/* ---------------- 缩放 / 平移 / 框选 ---------------- */

function setupZoom(): void {
  if (!svgRef.value) return;

  zoomBehavior = zoom<SVGSVGElement, unknown>()
    .scaleExtent([0.15, 3])
    .filter((event: any) => {
      if (event.type === 'wheel') return true;
      if (event.type === 'mousedown') return event.button === 2;
      if (event.type === 'dblclick') return false;
      return true;
    })
    .on('zoom', (event) => {
      if (viewportRef.value) {
        select(viewportRef.value).attr('transform', event.transform.toString());
      }
    });

  select(svgRef.value).call(zoomBehavior).on('dblclick.zoom', null);
  select(svgRef.value).on('contextmenu', (event: Event) => event.preventDefault());
}

function hideSelectionBox(): void {
  const rect = selectionRectRef.value;
  if (rect) rect.style.display = 'none';
}

function showSelectionBox(a: { x: number; y: number }, b: { x: number; y: number }): void {
  const rect = selectionRectRef.value;
  if (!rect) return;
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  rect.setAttribute('x', String(x));
  rect.setAttribute('y', String(y));
  rect.setAttribute('width', String(Math.abs(b.x - a.x)));
  rect.setAttribute('height', String(Math.abs(b.y - a.y)));
  rect.style.display = 'block';
}

function setupBoxSelection(): void {
  if (!svgRef.value) return;

  select(svgRef.value).on('mousedown.boxselect', (event: MouseEvent) => {
    if (event.button !== 0) return;
    const target = event.target as Element | null;
    if (target && target.closest('.er-node')) return;

    boxSelecting = true;
    boxMoved = false;
    const screen = pointer(event, svgRef.value);
    boxStartScreen = { x: screen[0], y: screen[1] };
    const graph = pointer(event, viewportRef.value);
    boxStartGraph = { x: graph[0], y: graph[1] };
    boxEndGraph = { ...boxStartGraph };
    boxInitialSelection = event.shiftKey ? Array.from(selectedIds) : [];
    if (!event.shiftKey) clearSelection();
    hideSelectionBox();
    event.preventDefault();
  });
}

function handleBoxMove(event: MouseEvent): void {
  if (!boxSelecting || !svgRef.value || !viewportRef.value) return;

  const screen = pointer(event, svgRef.value);
  const graph = pointer(event, viewportRef.value);
  boxEndGraph = { x: graph[0], y: graph[1] };

  if (!boxMoved) {
    const dx = screen[0] - boxStartScreen.x;
    const dy = screen[1] - boxStartScreen.y;
    if (Math.hypot(dx, dy) > 3) boxMoved = true;
  }

  if (boxMoved) {
    showSelectionBox(boxStartScreen, { x: screen[0], y: screen[1] });
  }
}

function handleBoxUp(): void {
  if (!boxSelecting) return;
  boxSelecting = false;
  hideSelectionBox();
  if (!boxMoved) return;

  const minX = Math.min(boxStartGraph.x, boxEndGraph.x);
  const maxX = Math.max(boxStartGraph.x, boxEndGraph.x);
  const minY = Math.min(boxStartGraph.y, boxEndGraph.y);
  const maxY = Math.max(boxStartGraph.y, boxEndGraph.y);
  const ids = new Set(boxInitialSelection);

  for (const node of renderNodes) {
    if (node.x >= minX && node.x <= maxX && node.y >= minY && node.y <= maxY) {
      ids.add(node.id);
    }
  }

  setSelection(ids);
}

function handleUndoKeydown(event: KeyboardEvent): void {
  if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
  if (event.key.toLowerCase() !== 'z') return;

  const target = event.target as HTMLElement | null;
  if (
    target &&
    (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
  ) {
    return;
  }

  if (historyStack.length === 0) return;
  event.preventDefault();
  undo();
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
  setupBoxSelection();
  window.addEventListener('mousemove', handleBoxMove);
  window.addEventListener('mouseup', handleBoxUp);
  window.addEventListener('keydown', handleUndoKeydown);
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
  window.removeEventListener('mousemove', handleBoxMove);
  window.removeEventListener('mouseup', handleBoxUp);
  window.removeEventListener('keydown', handleUndoKeydown);
});

watch(
  () => props.diagram,
  () => {
    const nextSignature = structureSignatureOf(props.diagram);
    if (nextSignature !== structureSignature) {
      structureSignature = nextSignature;
      rebuild();
    } else {
      // 仅名称变化（改名 / 中英文切换）时保留手动排版
      syncLabelsFromDiagram();
    }
  },
  { deep: true },
);

watch(() => props.layoutKind, () => rebuild());
watch(() => props.showAttributes, () => rebuild());

defineExpose({
  getSvg: () => svgRef.value,
  getNodes: () => renderNodes,
  getEdges: () => renderEdges,
  fitView,
});
</script>

<template>
  <div ref="containerRef" class="er-canvas" @contextmenu.prevent>
    <svg ref="svgRef" class="er-svg" xmlns="http://www.w3.org/2000/svg">
      <g ref="viewportRef" class="viewport">
        <g class="edges"></g>
        <g class="edge-labels"></g>
        <g class="nodes"></g>
      </g>
      <rect ref="selectionRectRef" class="selection-rect" x="0" y="0" width="0" height="0" />
    </svg>

    <div v-if="diagram.nodes.length > 0" class="canvas-hint">
      滚轮缩放 · 右键拖拽平移 · 左键拖拽节点 / 框选 · Shift 多选 · 双击改名 · Ctrl+Z 撤销
    </div>

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
  user-select: none;
}

.selection-rect {
  display: none;
  fill: rgba(61, 126, 255, 0.08);
  stroke: #3d7eff;
  stroke-width: 1;
  stroke-dasharray: 4 3;
  pointer-events: none;
}

.er-canvas :deep(.er-node.selected rect),
.er-canvas :deep(.er-node.selected ellipse),
.er-canvas :deep(.er-node.selected path) {
  stroke: #3d7eff;
  stroke-width: 3;
}

.er-canvas :deep(.er-node.selected text),
.er-canvas :deep(.er-node.selected .pk-underline) {
  fill: #1d4ed8;
  stroke: #1d4ed8;
}

.canvas-hint {
  position: absolute;
  left: 12px;
  bottom: 10px;
  padding: 4px 9px;
  border: 1px solid #e3ebf6;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.9);
  color: #8b9bb0;
  font-size: 11px;
  line-height: 1.5;
  pointer-events: none;
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
