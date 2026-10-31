import { describe, expect, it } from 'vitest';
import type { AiEntity } from '../shared/er-model';
import { normalizeCompletion } from '../server/services/ai';

const ENTITIES: AiEntity[] = [
  {
    name: '商品',
    attributes: [
      { name: '商品编号', primaryKey: true },
      { name: '名称' },
      { name: '库存数量' },
    ],
  },
  {
    name: '订单',
    attributes: [{ name: '订单编号', primaryKey: true }],
  },
];

describe('normalizeCompletion', () => {
  it('过滤未知实体与已有属性，只保留缺失属性', () => {
    const warnings: string[] = [];
    const result = normalizeCompletion(
      {
        relationships: [
          { source: '订单', target: '商品', type: 'oneToMany', text: '包含' },
          { source: '订单', target: '不存在', type: 'oneToMany', text: '关联' },
        ],
        attributes: [
          {
            entity: '商品',
            attributes: [{ name: '库存数量' }, { name: '上架状态' }, { name: '上架状态' }],
          },
          { entity: '不存在', attributes: [{ name: '字段' }] },
        ],
      },
      ENTITIES,
      warnings,
    );

    expect(result.relationships).toHaveLength(1);
    expect(result.attributes).toEqual([
      { entity: '商品', attributes: [{ name: '上架状态', primaryKey: false }] },
    ]);
    expect(warnings.some((w) => w.includes('库存数量'))).toBe(true);
    expect(warnings.some((w) => w.includes('不存在'))).toBe(true);
  });

  it('兼容 attributeSuggestions 别名与空结果', () => {
    const result = normalizeCompletion(
      {
        relationships: [],
        attributeSuggestions: [{ entity: '订单', attributes: [{ name: '下单时间' }] }],
      },
      ENTITIES,
    );

    expect(result.attributes).toEqual([
      { entity: '订单', attributes: [{ name: '下单时间', primaryKey: false }] },
    ]);
  });

  it('兼容平铺的属性输出并去重', () => {
    const result = normalizeCompletion(
      {
        relationships: [],
        attributes: [
          { entity: '订单', name: '下单时间' },
          { entity: '订单', name: '下单时间' },
        ],
      },
      ENTITIES,
    );

    expect(result.attributes).toEqual([
      { entity: '订单', attributes: [{ name: '下单时间', primaryKey: false }] },
    ]);
  });

  it('没有可用补丁时返回空数组', () => {
    const result = normalizeCompletion({ relationships: [] }, ENTITIES);
    expect(result).toEqual({ relationships: [], attributes: [] });
  });

  it('兼容模型只返回联系数组的旧格式', () => {
    const result = normalizeCompletion(
      [{ source: '订单', target: '商品', type: 'oneToMany', text: '包含' }],
      ENTITIES,
    );
    expect(result.relationships).toHaveLength(1);
    expect(result.attributes).toEqual([]);
  });

  it('兼容模型用 entities 字段返回属性补丁', () => {
    const result = normalizeCompletion(
      {
        relationships: [],
        entities: [{ name: '订单', attributes: [{ name: '下单时间' }] }],
      },
      ENTITIES,
    );

    expect(result.attributes).toEqual([
      { entity: '订单', attributes: [{ name: '下单时间', primaryKey: false }] },
    ]);
  });

  it('只补联系的旧接口模式不会产生属性警告', () => {
    const warnings: string[] = [];
    const result = normalizeCompletion(
      {
        relationships: [],
        attributes: [{ entity: '不存在', attributes: [{ name: '字段' }] }],
      },
      ENTITIES,
      warnings,
      false,
    );

    expect(result.attributes).toEqual([]);
    expect(warnings).toHaveLength(0);
  });
});
