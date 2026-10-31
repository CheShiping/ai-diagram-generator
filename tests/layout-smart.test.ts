import { describe, expect, it } from 'vitest';
import { tablesToDiagram, type ParsedTable } from '../shared/er-model';
import { prepareEdges, prepareNodes } from '../client/core/geometry';
import { layoutSmart } from '../client/core/smart-layout';

const TABLES: ParsedTable[] = [
  {
    tableName: 'users',
    tableComment: '用户',
    columns: [
      { name: 'id', comment: '', primaryKey: true, type: 'BIGINT' },
      { name: 'username', comment: '', primaryKey: false, type: 'VARCHAR' },
      { name: 'status', comment: '1正常 0禁用', primaryKey: false, type: 'TINYINT' },
    ],
    foreignKeys: [],
  },
  {
    tableName: 'products',
    tableComment: '商品',
    columns: [
      { name: 'id', comment: '', primaryKey: true, type: 'BIGINT' },
      { name: 'name', comment: '', primaryKey: false, type: 'VARCHAR' },
      { name: 'price', comment: '', primaryKey: false, type: 'DECIMAL' },
    ],
    foreignKeys: [],
  },
  {
    tableName: 'orders',
    tableComment: '订单',
    columns: [
      { name: 'id', comment: '', primaryKey: true, type: 'BIGINT' },
      { name: 'user_id', comment: '', primaryKey: false, type: 'BIGINT' },
      { name: 'total_amount', comment: '', primaryKey: false, type: 'DECIMAL' },
    ],
    foreignKeys: [{ name: 'fk_orders_user', columns: ['user_id'], refTable: 'users', refColumns: ['id'] }],
  },
  {
    tableName: 'order_items',
    tableComment: '订单明细',
    columns: [
      { name: 'id', comment: '', primaryKey: true, type: 'BIGINT' },
      { name: 'order_id', comment: '', primaryKey: false, type: 'BIGINT' },
      { name: 'product_id', comment: '', primaryKey: false, type: 'BIGINT' },
      { name: 'quantity', comment: '', primaryKey: false, type: 'INT' },
    ],
    foreignKeys: [
      { name: 'fk_items_order', columns: ['order_id'], refTable: 'orders', refColumns: ['id'] },
      { name: 'fk_items_product', columns: ['product_id'], refTable: 'products', refColumns: ['id'] },
    ],
  },
];

const BIG_COLUMNS = [
  { name: 'id', comment: '编号', primaryKey: true, type: 'BIGINT' },
  ...Array.from({ length: 24 }, (_, i) => ({
    name: `col_${i}`,
    comment: `属性${i}`,
    primaryKey: false,
    type: 'VARCHAR',
  })),
  { name: 'left_id', comment: '', primaryKey: false, type: 'BIGINT' },
  { name: 'right_id', comment: '', primaryKey: false, type: 'BIGINT' },
];

const BIG_TABLES: ParsedTable[] = [
  {
    tableName: 'big_center',
    tableComment: '大表',
    columns: BIG_COLUMNS,
    foreignKeys: [
      { name: 'fk_left', columns: ['left_id'], refTable: 'big_left', refColumns: ['id'] },
      { name: 'fk_right', columns: ['right_id'], refTable: 'big_right', refColumns: ['id'] },
    ],
  },
  {
    tableName: 'big_left',
    tableComment: '左表',
    columns: [{ name: 'id', comment: '编号', primaryKey: true, type: 'BIGINT' }],
    foreignKeys: [],
  },
  {
    tableName: 'big_right',
    tableComment: '右表',
    columns: [{ name: 'id', comment: '编号', primaryKey: true, type: 'BIGINT' }],
    foreignKeys: [],
  },
];

function buildScene(tables: ParsedTable[] = TABLES) {
  const { diagram } = tablesToDiagram(tables, { showComment: false });
  const nodes = prepareNodes(diagram.nodes);
  const edges = prepareEdges(diagram.links);
  return { nodes, edges };
}

function largestHub(nodes: ReturnType<typeof prepareNodes>) {
  let hub = nodes[0];
  let attrs = nodes.filter((n) => n.type === 'attribute' && n.parent === hub.id);
  for (const node of nodes) {
    if (node.type === 'attribute') continue;
    const list = nodes.filter((n) => n.type === 'attribute' && n.parent === node.id);
    if (list.length > attrs.length) {
      hub = node;
      attrs = list;
    }
  }
  return { hub, attrs };
}

describe('layoutSmart', () => {
  it('所有节点都得到有限坐标', () => {
    const { nodes, edges } = buildScene();
    layoutSmart(nodes, edges);
    for (const node of nodes) {
      expect(Number.isFinite(node.x)).toBe(true);
      expect(Number.isFinite(node.y)).toBe(true);
    }
  });

  it('联系菱形落在两端实体的轴线上', () => {
    const { nodes, edges } = buildScene();
    layoutSmart(nodes, edges);

    const byId = new Map(nodes.map((n) => [n.id, n]));
    const rels = nodes.filter((n) => n.type === 'relationship');

    for (const rel of rels) {
      const ends = edges
        .filter((e) => e.type === 'relationship' && (e.source === rel.id || e.target === rel.id))
        .map((e) => byId.get(e.source === rel.id ? e.target : e.source))
        .filter((n) => n?.type === 'entity');
      if (ends.length !== 2) continue;

      const [a, b] = ends as [typeof rel, typeof rel];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      const cross = Math.abs((b.x - a.x) * (rel.y - a.y) - (b.y - a.y) * (rel.x - a.x));
      expect(cross / len).toBeLessThan(60);
    }
  });

  it('属性不会压在父节点的图形内部', () => {
    const { nodes, edges } = buildScene();
    layoutSmart(nodes, edges);

    const byId = new Map(nodes.map((n) => [n.id, n]));
    for (const attr of nodes.filter((n) => n.type === 'attribute')) {
      const parent = attr.parent ? byId.get(attr.parent) : undefined;
      if (!parent) continue;
      const distance = Math.hypot(attr.x - parent.x, attr.y - parent.y);
      const minHalf = Math.min(parent.w, parent.h) / 2;
      expect(distance).toBeGreaterThan(minHalf);
    }
  });

  it('布局是确定性的', () => {
    const first = buildScene();
    layoutSmart(first.nodes, first.edges);
    const second = buildScene();
    layoutSmart(second.nodes, second.edges);

    const a = first.nodes.map((n) => `${n.id}:${n.x.toFixed(3)},${n.y.toFixed(3)}`).sort();
    const b = second.nodes.map((n) => `${n.id}:${n.x.toFixed(3)},${n.y.toFixed(3)}`).sort();
    expect(a).toEqual(b);
  });

  it('没有实体时不会崩溃', () => {
    const { nodes, edges } = buildScene();
    const onlyAttrs = nodes.filter((n) => n.type === 'attribute');
    layoutSmart(onlyAttrs, []);
    for (const node of onlyAttrs) {
      expect(Number.isFinite(node.x)).toBe(true);
    }
  });

  it('二十多个属性仍贴着 hub 分层聚集', () => {
    const { nodes, edges } = buildScene(BIG_TABLES);
    layoutSmart(nodes, edges);

    const { hub, attrs } = largestHub(nodes);
    expect(attrs.length).toBeGreaterThanOrEqual(24);

    let radius = 0;
    for (const attr of attrs) {
      radius = Math.max(
        radius,
        Math.hypot(attr.x - hub.x, attr.y - hub.y) + Math.max(attr.w, attr.h) / 2,
      );
    }
    // 旧实现会把所有属性摊在一个大圆上（半径 500+），紧凑排布应在 280 内
    expect(radius).toBeLessThan(280);
  });

  it('属性之间不会明显重叠', () => {
    const { nodes, edges } = buildScene(BIG_TABLES);
    layoutSmart(nodes, edges);

    const attrs = nodes.filter((n) => n.type === 'attribute');
    for (let i = 0; i < attrs.length; i += 1) {
      for (let j = i + 1; j < attrs.length; j += 1) {
        const a = attrs[i];
        const b = attrs[j];
        const overlapX = a.w / 2 + b.w / 2 - Math.abs(a.x - b.x);
        const overlapY = a.h / 2 + b.h / 2 - Math.abs(a.y - b.y);
        // 允许椭圆外接矩形最多 4px 的保守重叠
        expect(overlapX > 4.5 && overlapY > 4.5).toBe(false);
      }
    }
  });

  it('大表布局仍然确定性', () => {
    const first = buildScene(BIG_TABLES);
    layoutSmart(first.nodes, first.edges);
    const second = buildScene(BIG_TABLES);
    layoutSmart(second.nodes, second.edges);

    const a = first.nodes.map((n) => `${n.id}:${n.x.toFixed(3)},${n.y.toFixed(3)}`).sort();
    const b = second.nodes.map((n) => `${n.id}:${n.x.toFixed(3)},${n.y.toFixed(3)}`).sort();
    expect(a).toEqual(b);
  });
});
