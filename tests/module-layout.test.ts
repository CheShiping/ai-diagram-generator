import { describe, expect, it } from 'vitest';
import { createModuleSample } from '../shared/module-tree';
import {
  MODULE_LAYOUT,
  layoutModuleTree,
  moduleEdgeGeometry,
  moduleEdgePath,
  moduleNodeSize,
} from '../client/core/module-layout';

describe('layoutModuleTree', () => {
  it('第 0/1 层横排，第 2 层起竖排', () => {
    const { nodes } = layoutModuleTree(createModuleSample(1));
    for (const node of nodes) {
      if (node.level <= 1) expect(node.dir).toBe('h');
      else expect(node.dir).toBe('v');
    }
  });

  it('同层节点宽高完全一致', () => {
    const { nodes } = layoutModuleTree(createModuleSample(1));
    const byLevel = new Map<number, typeof nodes>();
    for (const node of nodes) {
      const list = byLevel.get(node.level) ?? [];
      list.push(node);
      byLevel.set(node.level, list);
    }
    for (const list of byLevel.values()) {
      const width = list[0].w;
      const height = list[0].h;
      for (const node of list) {
        expect(node.w).toBe(width);
        expect(node.h).toBe(height);
      }
    }
  });

  it('父节点居中于首尾子节点之间', () => {
    const { nodes, edges } = layoutModuleTree(createModuleSample(1));
    const byId = new Map(nodes.map((node) => [node.id, node]));
    for (const node of nodes) {
      const children = edges
        .filter((edge) => edge.source === node.id)
        .map((edge) => byId.get(edge.target)!)
        .sort((a, b) => a.x - b.x);
      if (children.length === 0) continue;
      const expected = (children[0].x + children[children.length - 1].x) / 2;
      expect(Math.abs(node.x - expected)).toBeLessThan(0.51);
    }
  });

  it('同层相邻节点不重叠且保持横向间距', () => {
    const { nodes } = layoutModuleTree(createModuleSample(1));
    const byLevel = new Map<number, typeof nodes>();
    for (const node of nodes) {
      const list = byLevel.get(node.level) ?? [];
      list.push(node);
      byLevel.set(node.level, list);
    }
    for (const list of byLevel.values()) {
      const sorted = [...list].sort((a, b) => a.x - b.x);
      for (let i = 1; i < sorted.length; i += 1) {
        const prev = sorted[i - 1];
        const current = sorted[i];
        const distance = current.x - prev.x;
        expect(distance).toBeGreaterThanOrEqual(prev.w / 2 + current.w / 2 + MODULE_LAYOUT.nodeGap - 0.51);
      }
    }
  });

  it('层级之间保持纵向间距', () => {
    const { nodes } = layoutModuleTree(createModuleSample(1));
    const heights = new Map<number, number>();
    const centers: number[] = [];
    for (const node of nodes) {
      heights.set(node.level, node.h);
      centers[node.level] = node.y;
    }
    for (let level = 1; level < centers.length; level += 1) {
      const gap = centers[level] - centers[level - 1];
      expect(gap).toBeGreaterThanOrEqual(
        (heights.get(level - 1)! + heights.get(level)!) / 2 + MODULE_LAYOUT.levelGap - 0.51,
      );
    }
  });

  it('竖排文字随字数增加高度，横排文字随字数增加宽度', () => {
    const shortVertical = moduleNodeSize('购物车', 2);
    const longVertical = moduleNodeSize('生成盘点任务', 2);
    expect(longVertical.h).toBeGreaterThan(shortVertical.h);
    expect(longVertical.w).toBe(shortVertical.w);

    const shortHorizontal = moduleNodeSize('顾客端', 1);
    const longHorizontal = moduleNodeSize('外卖配送平台', 1);
    expect(longHorizontal.w).toBeGreaterThan(shortHorizontal.w);
    expect(longHorizontal.h).toBe(shortHorizontal.h);
  });

  it('布局是确定性的', () => {
    const first = layoutModuleTree(createModuleSample(2));
    const second = layoutModuleTree(createModuleSample(2));
    const a = first.nodes.map((node) => `${node.name}:${node.x.toFixed(3)},${node.y.toFixed(3)}`);
    const b = second.nodes.map((node) => `${node.name}:${node.x.toFixed(3)},${node.y.toFixed(3)}`);
    expect(a).toEqual(b);
  });

  it('只有根节点时也能布局', () => {
    const tree = createModuleSample(0);
    tree.root.children = [];
    const { nodes, width, height } = layoutModuleTree(tree);
    expect(nodes).toHaveLength(1);
    expect(nodes[0].dir).toBe('h');
    expect(width).toBeGreaterThan(0);
    expect(height).toBeGreaterThan(0);
  });
});

describe('moduleEdgeGeometry', () => {
  it('折线从父框底边中点下折到子框顶边中点', () => {
    const parent = { x: 10, y: 20, h: 40, w: 120 };
    const child = { x: 240, y: 140, h: 36, w: 100 };
    const geo = moduleEdgeGeometry(parent, child);

    expect(geo.startX).toBe(10);
    expect(geo.startY).toBe(40);
    expect(geo.endX).toBe(240);
    expect(geo.endY).toBe(122);
    expect(geo.railY).toBe(81);

    const path = moduleEdgePath(geo);
    expect(path).toBe('M10,40 L10,81 L240,81 L240,122');
  });
});
