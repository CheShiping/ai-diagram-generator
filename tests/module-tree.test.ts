import { describe, expect, it } from 'vitest';
import {
  MODULE_TREE_MAX_LEVELS,
  MODULE_TREE_MAX_NODES,
  addModuleChild,
  addModuleSibling,
  createModuleSample,
  findModuleNode,
  moduleNodeCount,
  moduleTreeDepth,
  moveModuleNode,
  normalizeModuleTree,
  parseModuleOutline,
  reidModuleTree,
  removeModuleNode,
  renameModuleNode,
  type ModuleNode,
} from '../shared/module-tree';

const WAREHOUSE_OUTLINE = `智能仓储管理系统
  入库管理
    到货预约
    收货质检
    上架分配
  库存管理
    库位查询
    库存盘点
      生成盘点任务
      差异复核
    安全库存预警
  出库管理
    订单拣货
    复核打包
    物流交接
  运营报表
    周转率分析
    异常记录`;

describe('parseModuleOutline', () => {
  it('按缩进解析出四层功能树', () => {
    const { tree } = parseModuleOutline(WAREHOUSE_OUTLINE);
    expect(tree.root.name).toBe('智能仓储管理系统');
    expect(tree.root.children.map((node) => node.name)).toEqual([
      '入库管理',
      '库存管理',
      '出库管理',
      '运营报表',
    ]);
    expect(moduleTreeDepth(tree.root)).toBe(4);

    const inventory = tree.root.children.find((node) => node.name === '库存管理')!;
    const stocktake = inventory.children.find((node) => node.name === '库存盘点')!;
    expect(stocktake.children.map((node) => node.name)).toEqual(['生成盘点任务', '差异复核']);
  });

  it('支持 Markdown 标题层级', () => {
    const { tree } = parseModuleOutline(`# 外卖配送平台
## 顾客端
### 商家搜索
### 菜品浏览
## 商家端
### 菜单管理
#### 菜品上架
#### 库存设置`);

    expect(tree.root.name).toBe('外卖配送平台');
    expect(tree.root.children).toHaveLength(2);

    const merchant = tree.root.children.find((node) => node.name === '商家端')!;
    const menu = merchant.children.find((node) => node.name === '菜单管理')!;
    expect(menu.children.map((node) => node.name)).toEqual(['菜品上架', '库存设置']);
  });

  it('忽略行首列表符号', () => {
    const { tree } = parseModuleOutline(`- 系统
  - 模块
    - 功能`);
    expect(tree.root.name).toBe('系统');
    expect(tree.root.children[0].name).toBe('模块');
    expect(tree.root.children[0].children[0].name).toBe('功能');
  });

  it('多个顶层节点会被归入合成根节点并给出警告', () => {
    const { tree, warnings } = parseModuleOutline(`系统A
系统B
系统C`);
    expect(tree.root.name).toBe('功能结构');
    expect(tree.root.children).toHaveLength(3);
    expect(warnings.some((item) => item.includes('顶层节点'))).toBe(true);
  });

  it('空大纲直接报错', () => {
    expect(() => parseModuleOutline('   \n\n  ')).toThrow('大纲内容为空');
  });
});

describe('树编辑操作', () => {
  function warehouseTree() {
    return createModuleSample(1);
  }

  it('添加子节点与同级节点', () => {
    const tree = warehouseTree();
    const added = addModuleChild(tree.root, tree.root.children[0].id, '退货入库');
    expect(added?.name).toBe('退货入库');
    expect(tree.root.children[0].children.some((node) => node.id === added!.id)).toBe(true);

    const sibling = addModuleSibling(tree.root, tree.root.children[0].id, '调拨管理');
    expect(sibling?.name).toBe('调拨管理');
    expect(tree.root.children[1].id).toBe(sibling!.id);
  });

  it('根节点不能删除，也不能新增同级', () => {
    const tree = warehouseTree();
    expect(removeModuleNode(tree.root, tree.root.id)).toBe(false);
    expect(addModuleSibling(tree.root, tree.root.id, '根同级')).toBeNull();
  });

  it('重命名与删除节点', () => {
    const tree = warehouseTree();
    const target = tree.root.children[0];
    expect(renameModuleNode(tree.root, target.id, '收货管理')).toBe(true);
    expect(findModuleNode(tree.root, target.id)?.name).toBe('收货管理');

    expect(removeModuleNode(tree.root, target.id)).toBe(true);
    expect(findModuleNode(tree.root, target.id)).toBeNull();
  });

  it('拖拽移动：成为子节点、调整同级顺序', () => {
    const tree = warehouseTree();
    const inventory = tree.root.children.find((node) => node.name === '库存管理')!;
    const stocktake = inventory.children.find((node) => node.name === '库存盘点')!;
    const reports = tree.root.children.find((node) => node.name === '运营报表')!;

    expect(moveModuleNode(tree.root, stocktake.id, reports.id, 'child')).toBe(true);
    expect(reports.children.some((node) => node.id === stocktake.id)).toBe(true);

    const inbound = tree.root.children.find((node) => node.name === '入库管理')!;
    expect(moveModuleNode(tree.root, reports.id, inbound.id, 'before')).toBe(true);
    expect(tree.root.children[0].id).toBe(reports.id);
  });

  it('不能把节点拖进自己的子树', () => {
    const tree = warehouseTree();
    const inventory = tree.root.children.find((node) => node.name === '库存管理')!;
    const stocktake = inventory.children.find((node) => node.name === '库存盘点')!;
    expect(moveModuleNode(tree.root, inventory.id, stocktake.id, 'child')).toBe(false);
    expect(moveModuleNode(tree.root, stocktake.id, stocktake.id, 'child')).toBe(false);
  });
});

describe('normalizeModuleTree', () => {
  it('接受 root / name+children 两种结构', () => {
    const tree = normalizeModuleTree({
      root: {
        name: '系统',
        children: [
          {
            name: '模块',
            children: [{ name: '功能', children: [] }],
          },
        ],
      },
    });
    expect(tree.root.name).toBe('系统');
    expect(tree.root.children[0].name).toBe('模块');
    expect(tree.root.children[0].children[0].name).toBe('功能');
  });

  it('数组根节点会被归入合成根节点', () => {
    const tree = normalizeModuleTree([{ name: '模块A' }, { name: '模块B' }]);
    expect(tree.root.children.map((node) => node.name)).toEqual(['模块A', '模块B']);
  });

  it('兼容 nodes / modules 字段并过滤空名称', () => {
    const tree = normalizeModuleTree({
      name: '系统',
      nodes: [{ name: '模块A', modules: [{ name: '  ' }, { name: '功能A' }] }],
    });
    expect(tree.root.children[0].name).toBe('模块A');
    expect(tree.root.children[0].children.map((node) => node.name)).toEqual(['功能A']);
  });

  it('超过最大层级时截断并警告', () => {
    let node: Record<string, unknown> = { name: '第8层', children: [] };
    for (let level = 7; level >= 1; level -= 1) {
      node = { name: `第${level}层`, children: [node] };
    }
    const warnings: string[] = [];
    const tree = normalizeModuleTree(node, warnings);
    expect(moduleTreeDepth(tree.root)).toBe(MODULE_TREE_MAX_LEVELS);
    expect(warnings.some((item) => item.includes('超过'))).toBe(true);
  });

  it('节点总数超过上限时截断', () => {
    const warnings: string[] = [];
    const children = Array.from({ length: 260 }, (_, index) => ({ name: `功能${index}`, children: [] }));
    const tree = normalizeModuleTree({ name: '系统', children }, warnings);
    expect(moduleNodeCount(tree.root)).toBe(MODULE_TREE_MAX_NODES);
    expect(warnings.some((item) => item.includes('节点数量'))).toBe(true);
  });

  it('没有任何有效节点时报错', () => {
    expect(() => normalizeModuleTree({ name: '  ' })).toThrow();
    expect(() => normalizeModuleTree({ hello: 'world' })).toThrow();
  });

  it('替换整棵树时重新编号，避免与服务端 id 冲突', () => {
    const tree = normalizeModuleTree({
      name: '系统',
      children: [{ name: '模块', children: [{ name: '功能', children: [] }] }],
    });

    const collect = (node: ModuleNode): string[] => [node.id, ...node.children.flatMap(collect)];
    const oldIds = collect(tree.root);
    const reid = reidModuleTree(tree);
    const newIds = collect(reid.root);

    expect(reid.root.name).toBe('系统');
    expect(new Set(newIds).size).toBe(newIds.length);
    expect(newIds.some((id) => oldIds.includes(id))).toBe(false);
  });
});
