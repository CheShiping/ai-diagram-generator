/**
 * 功能结构图布局（复刻 huahub 的模块图实现）。
 *
 * 规则：
 *  - 第 0 / 1 层文字横排，第 2 层起文字竖排（逐字堆叠）
 *  - 同层节点宽高对齐到本层最大值（sameLevelAlign）
 *  - 叶子节点从左到右等距排布，父节点居中于首尾子节点之间
 *  - 同层相邻节点做最多 8 轮重叠修正，避免宽框压住邻居
 *  - 连线从父框底边中点下折，到子框顶边中点，无箭头
 */

import type { ModuleNode, ModuleTree } from '../../shared/module-tree';

export type ModuleLevelKey = 'system' | 'module' | 'func';
export type ModuleTextDirection = 'h' | 'v';

export interface ModuleLayoutConfig {
  background: string;
  fill: string;
  stroke: string;
  textColor: string;
  fontSize: number;
  fontFamily: string;
  strokeWidth: number;
  /** 纵向层级间距 */
  levelGap: number;
  /** 横向节点间距 */
  nodeGap: number;
  /** 第一个层级的顶部留白 */
  rootTop: number;
  /** 各层级最小宽高 */
  minSize: Record<ModuleLevelKey, { w: number; h: number }>;
  /** 各层级文字方向 */
  textDir: Record<ModuleLevelKey, ModuleTextDirection>;
}

/** 与逆向得到的默认配置一致 */
export const MODULE_LAYOUT: ModuleLayoutConfig = {
  background: '#ffffff',
  fill: '#ffffff',
  stroke: '#000000',
  textColor: '#000000',
  fontSize: 16,
  fontFamily: "'Times New Roman', 'SimSun', serif",
  strokeWidth: 1.5,
  levelGap: 60,
  nodeGap: 30,
  rootTop: 50,
  minSize: {
    system: { w: 120, h: 40 },
    module: { w: 100, h: 36 },
    func: { w: 32, h: 32 },
  },
  textDir: {
    system: 'h',
    module: 'h',
    func: 'v',
  },
};

export interface ModuleRenderNode {
  id: string;
  name: string;
  level: number;
  levelKey: ModuleLevelKey;
  dir: ModuleTextDirection;
  /** 中心坐标 */
  x: number;
  y: number;
  w: number;
  h: number;
  parentId: string | null;
}

export interface ModuleRenderEdge {
  id: string;
  source: string;
  target: string;
}

export interface ModuleLayoutResult {
  nodes: ModuleRenderNode[];
  edges: ModuleRenderEdge[];
  width: number;
  height: number;
}

export interface ModuleEdgeGeometry {
  /** 父框底边中点 */
  startX: number;
  startY: number;
  /** 子框顶边中点 */
  endX: number;
  endY: number;
  /** 水平折线所在 y */
  railY: number;
}

/** 层级 → 配置键：0 系统、1 模块、2+ 功能 */
export function moduleLevelKey(level: number): ModuleLevelKey {
  if (level === 0) return 'system';
  if (level === 1) return 'module';
  return 'func';
}

/** 文字宽度估算：中文按 1em，其他字符按 0.6em（与参考站一致） */
export function estimateModuleTextWidth(text: string, fontSize = MODULE_LAYOUT.fontSize): number {
  let width = 0;
  for (const ch of text) {
    width += /[\u4e00-\u9fa5]/.test(ch) ? fontSize : fontSize * 0.6;
  }
  return width;
}

/** 单个节点的自适应尺寸（不小于对应层级最小尺寸） */
export function moduleNodeSize(
  name: string,
  level: number,
  config: ModuleLayoutConfig = MODULE_LAYOUT,
): { w: number; h: number } {
  const key = moduleLevelKey(level);
  const min = config.minSize[key];
  const fontSize = config.fontSize;
  const dir = config.textDir[key];

  if (dir === 'v') {
    const chars = [...name];
    return {
      w: Math.max(min.w, fontSize + 12),
      h: Math.max(min.h, chars.length * (fontSize + 4) + 16),
    };
  }

  return {
    w: Math.max(min.w, estimateModuleTextWidth(name, fontSize) + fontSize * 1.6 + 8),
    h: Math.max(min.h, fontSize + 22),
  };
}

/**
 * 整棵树 → 渲染节点与边。
 * 返回的坐标已经平移到以 (0,0) 为中心，方便画布 fitView 与导出。
 */
export function layoutModuleTree(
  tree: ModuleTree,
  config: ModuleLayoutConfig = MODULE_LAYOUT,
): ModuleLayoutResult {
  const nodes: ModuleRenderNode[] = [];
  const edges: ModuleRenderEdge[] = [];

  const walk = (node: ModuleNode, level: number, parentId: string | null): void => {
    const key = moduleLevelKey(level);
    const dir = config.textDir[key];
    const size = moduleNodeSize(node.name, level, config);
    nodes.push({
      id: node.id,
      name: node.name,
      level,
      levelKey: key,
      dir,
      x: 0,
      y: 0,
      w: size.w,
      h: size.h,
      parentId,
    });
    for (const child of node.children) {
      edges.push({ id: `edge-${parentId ?? 'root'}-${child.id}`, source: node.id, target: child.id });
      walk(child, level + 1, node.id);
    }
  };

  walk(tree.root, 0, null);
  if (nodes.length === 0) return { nodes, edges, width: 0, height: 0 };

  const byId = new Map(nodes.map((node) => [node.id, node]));

  /* 1) 同层宽高对齐 */
  const levelNodes = new Map<number, ModuleRenderNode[]>();
  for (const node of nodes) {
    const list = levelNodes.get(node.level) ?? [];
    list.push(node);
    levelNodes.set(node.level, list);
  }
  const maxByLevel = new Map<number, { w: number; h: number }>();
  for (const [level, list] of levelNodes) {
    maxByLevel.set(level, {
      w: Math.max(...list.map((node) => node.w)),
      h: Math.max(...list.map((node) => node.h)),
    });
  }
  for (const node of nodes) {
    const max = maxByLevel.get(node.level)!;
    node.w = max.w;
    node.h = max.h;
  }

  /* 2) 每个层级的 y 轴中心 */
  const maxLevel = Math.max(...nodes.map((node) => node.level));
  const levelHeight = new Map<number, number>();
  for (const [level, list] of levelNodes) {
    levelHeight.set(level, Math.max(...list.map((node) => node.h)));
  }

  let cursorY = config.rootTop;
  for (let level = 0; level <= maxLevel; level += 1) {
    const height = levelHeight.get(level) ?? config.minSize.func.h;
    const centerY = cursorY + height / 2;
    for (const node of levelNodes.get(level) ?? []) node.y = centerY;
    cursorY += height + config.levelGap;
  }

  /* 3) 叶子从左到右排布，父节点居中于首尾子节点 */
  let cursorX = 0;
  const place = (node: ModuleNode): number => {
    const render = byId.get(node.id)!;
    if (node.children.length === 0) {
      const x = cursorX + render.w / 2;
      cursorX += render.w + config.nodeGap;
      render.x = x;
      return x;
    }
    const childXs = node.children.map(place);
    const first = childXs[0];
    const last = childXs[childXs.length - 1];
    render.x = (first + last) / 2;
    return render.x;
  };
  place(tree.root);

  /* 4) 同层防重叠：按 x 排序，保证间距后再把父节点重新居中 */
  const childNodesByParent = new Map<string, ModuleRenderNode[]>();
  for (const node of nodes) {
    if (!node.parentId) continue;
    const list = childNodesByParent.get(node.parentId) ?? [];
    list.push(node);
    childNodesByParent.set(node.parentId, list);
  }

  const shiftSubtree = (nodeId: string, delta: number): void => {
    const render = byId.get(nodeId);
    if (!render) return;
    render.x += delta;
    for (const child of childNodesByParent.get(nodeId) ?? []) shiftSubtree(child.id, delta);
  };

  const recenterParents = (node: ModuleNode): void => {
    const render = byId.get(node.id)!;
    for (const child of node.children) recenterParents(child);
    if (node.children.length === 0) return;
    const childXs = node.children.map((child) => byId.get(child.id)!.x);
    render.x = (childXs[0] + childXs[childXs.length - 1]) / 2;
  };

  const sortedLevels = [...levelNodes.keys()].sort((a, b) => a - b);
  for (let pass = 0; pass < 8; pass += 1) {
    let moved = false;
    for (const level of sortedLevels) {
      const list = (levelNodes.get(level) ?? []).slice().sort((a, b) => a.x - b.x);
      for (let i = 1; i < list.length; i += 1) {
        const prev = list[i - 1];
        const current = list[i];
        const minGap = prev.x + prev.w / 2 + config.nodeGap + current.w / 2;
        if (current.x < minGap - 0.5) {
          shiftSubtree(current.id, minGap - current.x);
          moved = true;
        }
      }
    }
    recenterParents(tree.root);
    if (!moved) break;
  }

  /* 5) 平移到以 (0,0) 为中心 */
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const node of nodes) {
    minX = Math.min(minX, node.x - node.w / 2);
    maxX = Math.max(maxX, node.x + node.w / 2);
    minY = Math.min(minY, node.y - node.h / 2);
    maxY = Math.max(maxY, node.y + node.h / 2);
  }
  const offsetX = (minX + maxX) / 2;
  const offsetY = (minY + maxY) / 2;
  for (const node of nodes) {
    node.x -= offsetX;
    node.y -= offsetY;
  }

  return { nodes, edges, width: maxX - minX, height: maxY - minY };
}

/** 父框底边中点 → 水平折线 → 子框顶边中点 */
export function moduleEdgeGeometry(
  parent: Pick<ModuleRenderNode, 'x' | 'y' | 'h'>,
  child: Pick<ModuleRenderNode, 'x' | 'y' | 'h'>,
): ModuleEdgeGeometry {
  const startX = parent.x;
  const startY = parent.y + parent.h / 2;
  const endX = child.x;
  const endY = child.y - child.h / 2;
  return { startX, startY, endX, endY, railY: (startY + endY) / 2 };
}

/** SVG path 的 d 属性（直角折线，无箭头） */
export function moduleEdgePath(geo: ModuleEdgeGeometry): string {
  return `M${geo.startX},${geo.startY} L${geo.startX},${geo.railY} L${geo.endX},${geo.railY} L${geo.endX},${geo.endY}`;
}

export interface ModuleBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function moduleBounds(
  nodes: Array<Pick<ModuleRenderNode, 'x' | 'y' | 'w' | 'h'>>,
): ModuleBounds {
  if (nodes.length === 0) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
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
  return { minX, minY, maxX, maxY };
}
