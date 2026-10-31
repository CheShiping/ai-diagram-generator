// @vitest-environment happy-dom
import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { DrawioImportError, parseDrawioXml, parseValue } from '../client/core/import/drawio';
import { buildDrawioXml } from '../client/core/export/drawio';
import type { RenderEdge, RenderNode } from '../client/core/geometry';

function cell(
  id: string,
  value: string,
  style: string,
  x: number,
  y: number,
  width: number,
  height: number,
): string {
  return (
    `<mxCell id="${id}" value="${value}" style="${style}" vertex="1" parent="1">` +
    `<mxGeometry x="${x}" y="${y}" width="${width}" height="${height}" as="geometry" />` +
    `</mxCell>`
  );
}

function edge(id: string, source: string, target: string, value = ''): string {
  return (
    `<mxCell id="${id}" value="${value}" style="endArrow=none" edge="1" parent="1" source="${source}" target="${target}">` +
    `<mxGeometry relative="1" as="geometry" />` +
    `</mxCell>`
  );
}

function wrap(cells: string): string {
  return (
    `<mxfile><diagram id="d" name="测试"><mxGraphModel>` +
    `<root><mxCell id="0" /><mxCell id="1" parent="0" />${cells}</root>` +
    `</mxGraphModel></diagram></mxfile>`
  );
}

const SAMPLE = wrap(
  [
    cell('t_teacher', '教师', 'shape=rectangle;rounded=0', 0, 0, 120, 50),
    cell('t_teacher#id', '&lt;u&gt;教师编号&lt;/u&gt;', 'shape=ellipse', 0, -80, 100, 36),
    cell('t_teacher#name', '姓名', 'shape=ellipse', 140, -80, 100, 36),
    cell('rel-0', '拥有', 'shape=rhombus', 200, 0, 80, 50),
    edge('e0', 't_teacher', 't_teacher#id'),
    edge('e1', 't_teacher', 't_teacher#name'),
    edge('e2', 't_teacher', 'rel-0', '1'),
  ].join(''),
);

const sampleResult = await parseDrawioXml(SAMPLE);

describe('parseDrawioXml', () => {
  const result = sampleResult;

  it('识别矩形/椭圆/菱形三种图元', () => {
    const types = Object.fromEntries(result.nodes.map((n) => [n.id, n.type]));
    expect(types.t_teacher).toBe('entity');
    expect(types['t_teacher#id']).toBe('attribute');
    expect(types['t_teacher#name']).toBe('attribute');
    expect(types['rel-0']).toBe('relationship');
  });

  it('把左上角坐标换算为中心坐标', () => {
    const teacher = result.nodes.find((n) => n.id === 't_teacher');
    expect(teacher?.x).toBe(60);
    expect(teacher?.y).toBe(25);
  });

  it('<u> 标记还原为主键并去掉标签', () => {
    const pk = result.nodes.find((n) => n.id === 't_teacher#id');
    expect(pk?.name).toBe('教师编号');
    expect(pk?.isPrimaryKey).toBe(true);
    expect(result.nodes.find((n) => n.id === 't_teacher#name')?.isPrimaryKey).toBe(false);
  });

  it('由连线反推属性的归属实体', () => {
    expect(result.nodes.find((n) => n.id === 't_teacher#id')?.parent).toBe('t_teacher');
    expect(result.nodes.find((n) => n.id === 't_teacher#name')?.parent).toBe('t_teacher');
  });

  it('保留连线上的基数文字', () => {
    const rel = result.links.find((l) => l.source === 't_teacher' && l.target === 'rel-0');
    expect(rel?.text).toBe('1');
    expect(rel?.type).toBe('relationship');
  });

  it('属性连线标记为 attribute 类型', () => {
    expect(result.links.filter((l) => l.type === 'attribute')).toHaveLength(2);
  });

  it('给出导入统计警告', () => {
    expect(result.warnings.join('')).toContain('共导入 1 个实体');
  });

  it('非法 XML 抛出 DrawioImportError', async () => {
    await expect(parseDrawioXml('<mxfile>')).rejects.toThrow(DrawioImportError);
  });

  it('没有 mxGraphModel 抛出 DrawioImportError', async () => {
    await expect(parseDrawioXml('<foo><bar /></foo>')).rejects.toThrow(/mxGraphModel/);
  });

  it('没有顶点时抛出 DrawioImportError', async () => {
    await expect(parseDrawioXml(wrap(''))).rejects.toThrow(/可导入的图形节点/);
  });
});

describe('parseValue', () => {
  it('兼容双重转义的下划线主键', () => {
    expect(parseValue('&lt;u&gt;id&lt;/u&gt;')).toEqual({ name: 'id', primaryKey: true });
  });

  it('去掉 HTML 标签只留纯文本', () => {
    expect(parseValue('<b>订单</b><br>号')).toEqual({ name: '订单 号', primaryKey: false });
  });

  it('纯文本原样返回', () => {
    expect(parseValue('学生')).toEqual({ name: '学生', primaryKey: false });
  });
});

describe('压缩存储的 .drawio', () => {
  const inner =
    '<mxGraphModel><root><mxCell id="0" /><mxCell id="1" parent="0" />' +
    cell('t_order', '订单', 'shape=rectangle;rounded=0', 0, 0, 120, 50) +
    cell('t_order#id', '&lt;u&gt;订单号&lt;/u&gt;', 'shape=ellipse', 0, -80, 100, 36) +
    edge('e0', 't_order', 't_order#id') +
    '</root></mxGraphModel>';

  // draw.io 的压缩格式：base64(raw-deflate(encodeURIComponent(xml)))
  const payload = Buffer.from(
    deflateRawSync(Buffer.from(encodeURIComponent(inner), 'utf8')),
  ).toString('base64');

  const file = `<mxfile><diagram id="d" name="压缩页">${payload}</diagram></mxfile>`;

  it('解压后能还原实体、属性与主键', async () => {
    const parsed = await parseDrawioXml(file);
    expect(parsed.nodes).toHaveLength(2);
    expect(parsed.nodes.find((n) => n.name === '订单')?.type).toBe('entity');
    expect(parsed.nodes.find((n) => n.name === '订单号')?.isPrimaryKey).toBe(true);
  });
});

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

const ROUNDTRIP_XML = buildDrawioXml(NODES, EDGES, { title: '往返测试' });
const roundtrip = await parseDrawioXml(ROUNDTRIP_XML);

describe('导出 → 导入 round-trip', () => {
  const back = roundtrip;

  it('节点数量与类型保持一致', () => {
    expect(back.nodes).toHaveLength(NODES.length);
    const types = Object.fromEntries(back.nodes.map((n) => [n.name, n.type]));
    expect(types['班级']).toBe('entity');
    expect(types['班级ID']).toBe('attribute');
    expect(types.fk_student_class).toBe('relationship');
  });

  it('主键语义与归属关系保持一致', () => {
    const pk = back.nodes.find((n) => n.name === '班级ID');
    expect(pk?.isPrimaryKey).toBe(true);
    const entity = back.nodes.find((n) => n.name === '班级');
    expect(pk?.parent).toBe(entity?.id);
  });

  it('中心坐标与连线标签保持一致', () => {
    expect(back.nodes.find((n) => n.name === '班级')?.x).toBe(0);
    expect(back.links.some((l) => l.text === '1')).toBe(true);
  });
});
