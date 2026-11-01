import { describe, expect, it } from 'vitest';
import { createModuleSample } from '../shared/module-tree';
import { layoutModuleTree } from '../client/core/module-layout';
import { buildModuleDrawioXml } from '../client/core/export/module-drawio';

describe('buildModuleDrawioXml', () => {
  const layout = layoutModuleTree(createModuleSample(0));

  it('输出矩形节点、竖排换行与折线路径点', () => {
    const xml = buildModuleDrawioXml(layout.nodes, layout.edges, { title: '功能结构图' });

    expect(xml).toContain('<mxfile');
    expect(xml).toContain('name="功能结构图"');
    expect(xml).toContain('shape=rectangle');
    expect(xml).toContain('rounded=0');
    expect(xml).toContain('strokeColor=#000000');
    expect(xml).toContain('fontSize=16');

    // 第 2 层起竖排：每个字之间用 <br>，再作为 XML 属性被转义
    expect(xml).toContain('商&lt;br&gt;家&lt;br&gt;搜&lt;br&gt;索');
    // 横排节点不应被拆字
    expect(xml).toContain('value="外卖配送平台"');

    expect(xml).toContain('edgeStyle=orthogonalEdgeStyle');
    expect(xml).toContain('endArrow=none');
    expect(xml).toContain('exitX=0.5');
    expect(xml).toContain('exitY=1');
    expect(xml).toContain('entryX=0.5');
    expect(xml).toContain('entryY=0');
    expect(xml).toContain('<Array as="points">');
    expect(xml).toContain('<mxPoint');

    // 节点与连线数量完整
    expect(xml.match(/<mxCell id="node-\d+"/g)).toHaveLength(layout.nodes.length);
    expect(xml.match(/<mxCell id="edge-\d+"/g)).toHaveLength(layout.edges.length);
  });

  it('XML 特殊字符会被转义', () => {
    const tree = createModuleSample(0);
    tree.root.name = 'A&B<系统>';
    tree.root.children[0].name = '"模块"';
    const layoutWithSpecial = layoutModuleTree(tree);
    const xml = buildModuleDrawioXml(layoutWithSpecial.nodes, layoutWithSpecial.edges);

    expect(xml).toContain('A&amp;B&lt;系统&gt;');
    expect(xml).toContain('&quot;模块&quot;');
  });
});
