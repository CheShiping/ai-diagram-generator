import { describe, expect, it } from 'vitest';
import { buildDrawioXml } from '../client/core/export/drawio';
import type { RenderEdge, RenderNode } from '../client/core/geometry';

const NODES: RenderNode[] = [
  { id: 't_class', name: '班级', type: 'entity', w: 118, h: 44, x: 0, y: 0 },
  {
    id: 't_class#id',
    name: '班级ID',
    type: 'attribute',
    parent: 't_class',
    isPrimaryKey: true,
    w: 92,
    h: 34,
    x: 0,
    y: -110,
  },
  { id: 'rel-0', name: 'fk_student_class', type: 'relationship', w: 120, h: 50, x: 150, y: 0 },
];

const EDGES: RenderEdge[] = [
  { id: 'e0', source: 't_class', target: 't_class#id', type: 'attribute' },
  { id: 'e1', source: 't_class', target: 'rel-0', type: 'relationship', text: '1' },
];

describe('buildDrawioXml', () => {
  const xml = buildDrawioXml(NODES, EDGES, { title: '测试图' });

  it('生成合法 mxfile 结构', () => {
    expect(xml).toContain('<mxfile');
    expect(xml).toContain('<diagram');
    expect(xml).toContain('<mxGraphModel');
    expect(xml).toContain('</mxfile>');
    expect(xml).toContain('name="测试图"');
  });

  it('三种图元映射到正确的 draw.io 形状', () => {
    expect(xml).toContain('shape=rectangle');
    expect(xml).toContain('shape=ellipse');
    expect(xml).toContain('shape=rhombus');
  });

  it('主键属性用 HTML 下划线表达', () => {
    expect(xml).toContain('&lt;u&gt;班级ID&lt;/u&gt;');
  });

  it('边带基数标签并正确引用端点', () => {
    expect(xml).toContain('value="1"');
    expect(xml).toContain('source="node-0"');
    expect(xml).toContain('target="node-2"');
  });

  it('节点坐标为左上角（中心坐标减去半宽高）', () => {
    // 中心 (0,0)、宽 118 → 左上 x = -59，y = -22
    expect(xml).toContain('x="-59.0" y="-22.0"');
  });

  it('特殊字符被转义', () => {
    const escaped = buildDrawioXml(
      [{ id: 'a', name: 'A&B<C>', type: 'entity', w: 100, h: 40, x: 0, y: 0 }],
      [],
    );
    expect(escaped).toContain('A&amp;B&lt;C&gt;');
  });
});
