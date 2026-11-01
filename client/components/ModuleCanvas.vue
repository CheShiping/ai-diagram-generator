<script setup lang="ts">
import { drag, pointer, select, zoom, zoomIdentity, type ZoomBehavior } from 'd3';
import { ElMessageBox } from 'element-plus';
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { ModuleTree } from '@shared/module-tree';
import {
  MODULE_LAYOUT,
  layoutModuleTree,
  moduleBounds,
  moduleEdgeGeometry,
  moduleEdgePath,
  type ModuleRenderEdge,
  type ModuleRenderNode,
} from '@/core/module-layout';
import { useModuleStore, type ModuleOffsets } from '@/stores/module';

const props = defineProps<{
  tree: ModuleTree | null;
  offsets: ModuleOffsets;
}>();

const emit = defineEmits<{ (e: 'rendered'): void }>();

const store = useModuleStore();

const containerRef = ref<HTMLDivElement | null>(null);
const svgRef = ref<SVGSVGElement | null>(null);
const viewportRef = ref<SVGGElement | null>(null);
const guidesRef = ref<SVGGElement | null>(null);
/** 模板里不能直接读非响应式的 renderNodes */
const hasNodes = ref(false);

const SNAP_THRESHOLD = 7;

/** 布局基准坐标（不含手动拖拽偏移） */
let baseNodes: ModuleRenderNode[] = [];
let renderNodes: ModuleRenderNode[] = [];
let renderEdges: ModuleRenderEdge[] = [];
let zoomBehavior: ZoomBehavior<SVGSVGElement, unknown> | null = null;
let renderToken = 0;
let dragTravel = 0;

/* ---------------- 布局与偏移 ---------------- */

async function rebuild(): Promise<void> {
  const token = ++renderToken;
  if (!props.tree) {
    baseNodes = [];
    renderNodes = [];
    renderEdges = [];
    hasNodes.value = false;
    renderAll();
    return;
  }

  const layout = layoutModuleTree(props.tree);
  if (token !== renderToken) return;

  baseNodes = layout.nodes;
  renderEdges = layout.edges;
  renderNodes = layout.nodes.map((node) => ({ ...node }));
  hasNodes.value = renderNodes.length > 0;
  applyOffsets();
  renderAll();
  fitView();
  emit('rendered');
}

/** 把手动拖拽偏移叠加到布局坐标上 */
function applyOffsets(): void {
  const baseById = new Map(baseNodes.map((node) => [node.id, node]));
  for (const node of renderNodes) {
    const base = baseById.get(node.id);
    if (!base) continue;
    const offset = props.offsets[node.id];
    node.x = base.x + (offset?.dx ?? 0);
    node.y = base.y + (offset?.dy ?? 0);
  }
  updateNodeTransforms();
  updateEdges();
}

/* ---------------- 渲染 ---------------- */

function nodeGroup(): SVGGElement | null {
  return viewportRef.value?.querySelector('g.fm-nodes') ?? null;
}
function edgeGroup(): SVGGElement | null {
  return viewportRef.value?.querySelector('g.fm-edges') ?? null;
}

function renderAll(): void {
  const nodesG = nodeGroup();
  const edgesG = edgeGroup();
  if (!nodesG || !edgesG) return;

  select(nodesG).selectAll('*').remove();
  select(edgesG).selectAll('*').remove();
  clearGuides();

  // 1) 折线：父框底边中点 → 水平段 → 子框顶边中点
  select(edgesG)
    .selectAll<SVGPathElement, ModuleRenderEdge>('path')
    .data(renderEdges, (edge) => edge.id)
    .join('path')
    .attr('fill', 'none')
    .attr('stroke', MODULE_LAYOUT.stroke)
    .attr('stroke-width', MODULE_LAYOUT.strokeWidth)
    .attr('stroke-linejoin', 'round');

  // 2) 节点：直角黑框 + 水平/垂直居中文字
  const groups = select(nodesG)
    .selectAll<SVGGElement, ModuleRenderNode>('g')
    .data(renderNodes, (node) => node.id)
    .join('g')
    .attr('class', 'fm-node')
    .attr('cursor', 'grab');

  groups.each(function (node) {
    const g = select(this);

    g.append('rect')
      .attr('x', -node.w / 2)
      .attr('y', -node.h / 2)
      .attr('width', node.w)
      .attr('height', node.h)
      .attr('rx', 0)
      .attr('ry', 0)
      .attr('fill', MODULE_LAYOUT.fill)
      .attr('stroke', MODULE_LAYOUT.stroke)
      .attr('stroke-width', MODULE_LAYOUT.strokeWidth);

    if (node.dir === 'v') {
      // 竖排：逐字堆叠，整体在框内垂直居中
      const chars = [...node.name];
      const lineHeight = MODULE_LAYOUT.fontSize + 4;
      const totalHeight = chars.length * lineHeight;
      chars.forEach((char, index) => {
        g.append('text')
          .attr('x', 0)
          .attr('y', -totalHeight / 2 + lineHeight / 2 + index * lineHeight)
          .attr('font-family', MODULE_LAYOUT.fontFamily)
          .attr('font-size', MODULE_LAYOUT.fontSize)
          .attr('fill', MODULE_LAYOUT.textColor)
          .attr('text-anchor', 'middle')
          .attr('dominant-baseline', 'central')
          .attr('pointer-events', 'none')
          .text(char);
      });
    } else {
      g.append('text')
        .attr('x', 0)
        .attr('y', 0)
        .attr('font-family', MODULE_LAYOUT.fontFamily)
        .attr('font-size', MODULE_LAYOUT.fontSize)
        .attr('fill', MODULE_LAYOUT.textColor)
        .attr('text-anchor', 'middle')
        .attr('dominant-baseline', 'central')
        .attr('pointer-events', 'none')
        .text(node.name);
    }
  });

  updateNodeTransforms();
  updateEdges();
  attachDrag(groups);
}

function updateNodeTransforms(): void {
  const nodesG = nodeGroup();
  if (!nodesG) return;
  select(nodesG)
    .selectAll<SVGGElement, ModuleRenderNode>('g.fm-node')
    .attr('transform', (node) => `translate(${node.x},${node.y})`);
}

function updateEdges(): void {
  const byId = new Map(renderNodes.map((node) => [node.id, node]));
  select(edgeGroup())
    .selectAll<SVGPathElement, ModuleRenderEdge>('path')
    .attr('d', (edge) => {
      const parent = byId.get(edge.source);
      const child = byId.get(edge.target);
      if (!parent || !child) return '';
      return moduleEdgePath(moduleEdgeGeometry(parent, child));
    });
}

/* ---------------- 吸附参考线 ---------------- */

interface GuideLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

function clearGuides(): void {
  if (guidesRef.value) select(guidesRef.value).selectAll('*').remove();
}

function showGuides(lines: GuideLine[]): void {
  if (!guidesRef.value) return;
  select(guidesRef.value)
    .selectAll<SVGLineElement, GuideLine>('line')
    .data(lines)
    .join('line')
    .attr('x1', (line) => line.x1)
    .attr('y1', (line) => line.y1)
    .attr('x2', (line) => line.x2)
    .attr('y2', (line) => line.y2)
    .attr('stroke', '#999999')
    .attr('stroke-width', 1)
    .attr('stroke-dasharray', '4 3');
}

/**
 * 拖拽时对齐吸附：中心 / 左 / 右（水平方向）与 中心 / 上 / 下（垂直方向）。
 * 命中 7px 内取最近的一条，同时返回参考线位置。
 */
function applySnapping(node: ModuleRenderNode): GuideLine[] {
  const others = renderNodes.filter((other) => other.id !== node.id);
  if (others.length === 0) return [];

  const guides: GuideLine[] = [];

  let bestX: { delta: number; line: GuideLine } | null = null;
  for (const other of others) {
    const mine = [node.x - node.w / 2, node.x, node.x + node.w / 2];
    const theirs = [other.x - other.w / 2, other.x, other.x + other.w / 2];
    for (const m of mine) {
      for (const t of theirs) {
        const delta = t - m;
        if (Math.abs(delta) > SNAP_THRESHOLD) continue;
        if (bestX && Math.abs(delta) >= Math.abs(bestX.delta)) continue;
        const top = Math.min(node.y - node.h / 2, other.y - other.h / 2);
        const bottom = Math.max(node.y + node.h / 2, other.y + other.h / 2);
        bestX = { delta, line: { x1: t, y1: top, x2: t, y2: bottom } };
      }
    }
  }
  if (bestX) {
    node.x += bestX.delta;
    guides.push(bestX.line);
  }

  let bestY: { delta: number; line: GuideLine } | null = null;
  for (const other of others) {
    const mine = [node.y - node.h / 2, node.y, node.y + node.h / 2];
    const theirs = [other.y - other.h / 2, other.y, other.y + other.h / 2];
    for (const m of mine) {
      for (const t of theirs) {
        const delta = t - m;
        if (Math.abs(delta) > SNAP_THRESHOLD) continue;
        if (bestY && Math.abs(delta) >= Math.abs(bestY.delta)) continue;
        const left = Math.min(node.x - node.w / 2, other.x - other.w / 2);
        const right = Math.max(node.x + node.w / 2, other.x + other.w / 2);
        bestY = { delta, line: { x1: left, y1: t, x2: right, y2: t } };
      }
    }
  }
  if (bestY) {
    node.y += bestY.delta;
    guides.push(bestY.line);
  }

  return guides;
}

/* ---------------- 拖拽 / 改名 ---------------- */

function attachDrag(groups: any): void {
  const dragBehavior = drag<SVGGElement, ModuleRenderNode>()
    .container(function () {
      return this.parentNode as SVGGElement;
    })
    .on('start', function () {
      dragTravel = 0;
      select(this).attr('cursor', 'grabbing');
    })
    .on('drag', function (event: any, node) {
      const deltaX = event.dx ?? 0;
      const deltaY = event.dy ?? 0;
      dragTravel += Math.abs(deltaX) + Math.abs(deltaY);
      node.x += deltaX;
      node.y += deltaY;
      const guides = applySnapping(node);
      updateNodeTransforms();
      updateEdges();
      showGuides(guides);
    })
    .on('end', function (_event, node) {
      select(this).attr('cursor', 'grab');
      clearGuides();

      if (dragTravel > 3) {
        const base = baseNodes.find((item) => item.id === node.id);
        if (base) {
          // 历史记录必须先于偏移写入，否则撤销会回到拖拽后的位置
          store.pushHistory();
          store.setOffset(node.id, node.x - base.x, node.y - base.y);
        }
      }
    });

  groups
    .call(dragBehavior)
    .on('dblclick.rename', function (event: MouseEvent, node: ModuleRenderNode) {
      event.stopPropagation();
      renameNode(node);
    });
}

function renameNode(node: ModuleRenderNode): void {
  ElMessageBox.prompt('输入新的名称', '重命名', {
    inputValue: node.name,
    confirmButtonText: '确定',
    cancelButtonText: '取消',
    inputValidator: (value) => (value.trim() ? true : '名称不能为空'),
  })
    .then(({ value }) => {
      store.renameNode(node.id, value);
    })
    .catch(() => {
      /* 用户取消 */
    });
}

/* ---------------- 缩放 / 平移 ---------------- */

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

function fitView(): void {
  if (!svgRef.value || !zoomBehavior || !containerRef.value) return;
  if (renderNodes.length === 0) {
    select(svgRef.value).call(zoomBehavior.transform, zoomIdentity);
    return;
  }

  const bounds = moduleBounds(renderNodes);
  const width = containerRef.value.clientWidth;
  const height = containerRef.value.clientHeight;
  const padding = 56;

  const graphW = Math.max(bounds.maxX - bounds.minX, 1);
  const graphH = Math.max(bounds.maxY - bounds.minY, 1);
  const scale = Math.min(width / (graphW + padding * 2), height / (graphH + padding * 2), 2);
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;

  const transform = zoomIdentity
    .translate(width / 2 - cx * scale, height / 2 - cy * scale)
    .scale(Math.max(scale, 0.15));

  select(svgRef.value).call(zoomBehavior.transform, transform);
}

/* ---------------- 撤销 ---------------- */

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

  if (!store.canUndo()) return;
  event.preventDefault();
  store.undo();
}

/* ---------------- 生命周期 ---------------- */

let observer: ResizeObserver | null = null;

onMounted(async () => {
  setupZoom();
  window.addEventListener('keydown', handleUndoKeydown);
  await nextTick();

  if (typeof ResizeObserver !== 'undefined' && containerRef.value) {
    observer = new ResizeObserver(() => {
      if (renderNodes.length > 0) fitView();
    });
    observer.observe(containerRef.value);
  }

  await rebuild();
});

onBeforeUnmount(() => {
  observer?.disconnect();
  observer = null;
  window.removeEventListener('keydown', handleUndoKeydown);
});

watch(
  () => props.tree,
  () => rebuild(),
  { deep: true },
);

watch(
  () => props.offsets,
  () => {
    if (renderNodes.length === 0) return;
    applyOffsets();
  },
  { deep: true },
);

defineExpose({
  getSvg: () => svgRef.value,
  getNodes: () => renderNodes,
  getEdges: () => renderEdges,
  fitView,
});
</script>

<template>
  <div ref="containerRef" class="fm-canvas" @contextmenu.prevent>
    <svg ref="svgRef" class="fm-svg" xmlns="http://www.w3.org/2000/svg">
      <g ref="viewportRef" class="viewport">
        <g class="fm-edges"></g>
        <g class="fm-nodes"></g>
        <g ref="guidesRef" class="fm-guides" pointer-events="none"></g>
      </g>
    </svg>

    <div v-if="hasNodes" class="canvas-hint">
      滚轮缩放 · 右键拖拽平移 · 拖拽矩形吸附对齐 · 双击改名 · Ctrl+Z 撤销
    </div>

    <div v-if="!hasNodes" class="empty-hint">
      <p>左侧粘贴大纲、AI 生成，或载入示例功能结构</p>
      <p class="sub">第 1–2 层横排 · 第 3 层起竖排 · 同层统一尺寸 · 黑白线稿</p>
    </div>
  </div>
</template>

<style scoped>
.fm-canvas {
  position: relative;
  width: 100%;
  height: 100%;
  background: #ffffff;
  overflow: hidden;
  font-family: 'Times New Roman', 'SimSun', serif;
}

.fm-svg {
  width: 100%;
  height: 100%;
  display: block;
  user-select: none;
}

.fm-canvas :deep(.fm-node:hover rect) {
  stroke-width: 2.2;
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
  font-family: 'PingFang SC', 'Microsoft YaHei', 'Segoe UI', system-ui, sans-serif;
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
  font-family: 'PingFang SC', 'Microsoft YaHei', 'Segoe UI', system-ui, sans-serif;
}

.empty-hint .sub {
  font-size: 12px;
  color: #aab7c8;
}
</style>
