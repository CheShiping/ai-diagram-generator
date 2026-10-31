/**
 * 解析 .drawio / mxGraph XML，还原成陈式 ER 图模型。
 *
 * 识别规则（与导出模块对称）：
 *  - style 含 shape=ellipse  → 属性
 *  - style 含 shape=rhombus  → 联系
 *  - 其余                    → 实体
 *  - value 里出现 <u>…</u>    → 主键（陈式下划线）
 *
 * 属性节点的归属（parent）由连线关系反推：如果某个椭圆只连着一个实体或联系，
 * 就把那个节点当作它的父节点。
 */

import type { ErDiagram, ErLink, ErNode, NodeType } from '@shared/er-model';

export interface DrawioImportResult extends ErDiagram {
  warnings: string[];
}

export class DrawioImportError extends Error {}

/**
 * 解析 draw.io 文件。
 * 同时支持未压缩的 mxGraphModel XML 和 draw.io 默认的压缩存储
 * （diagram 内是一段 base64 的 raw-deflate 数据）。
 */
export async function parseDrawioXml(xml: string): Promise<DrawioImportResult> {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');

  if (doc.querySelector('parsererror')) {
    throw new DrawioImportError('文件不是合法的 XML');
  }

  const model = await findGraphModel(doc);
  if (!model) {
    throw new DrawioImportError('文件里没有找到 mxGraphModel，请确认这是 draw.io 导出的文件');
  }

  const cells = Array.from(model.querySelectorAll('mxCell'));
  const warnings: string[] = [];

  interface RawVertex {
    id: string;
    type: NodeType;
    name: string;
    primaryKey: boolean;
    x: number;
    y: number;
    width: number;
    height: number;
  }

  const vertices: RawVertex[] = [];
  const vertexIds = new Set<string>();

  for (const cell of cells) {
    if (cell.getAttribute('vertex') !== '1') continue;
    const id = cell.getAttribute('id');
    if (!id || id === '0' || id === '1') continue;

    const geometry = cell.querySelector('mxGeometry');
    if (!geometry) continue;
    if (geometry.getAttribute('relative') === '1') continue;

    const x = Number.parseFloat(geometry.getAttribute('x') ?? '0') || 0;
    const y = Number.parseFloat(geometry.getAttribute('y') ?? '0') || 0;
    const width = Number.parseFloat(geometry.getAttribute('width') ?? '0') || 0;
    const height = Number.parseFloat(geometry.getAttribute('height') ?? '0') || 0;

    if (width <= 0 || height <= 0) continue;

    const style = cell.getAttribute('style') ?? '';
    const { name, primaryKey } = parseValue(cell.getAttribute('value') ?? '');

    vertices.push({
      id,
      type: detectType(style),
      name: name || '未命名',
      primaryKey,
      // draw.io 存的是左上角坐标，统一换成中心坐标
      x: x + width / 2,
      y: y + height / 2,
      width,
      height,
    });
    vertexIds.add(id);
  }

  if (vertices.length === 0) {
    throw new DrawioImportError('文件里没有可导入的图形节点');
  }

  // 边
  interface RawEdge {
    source: string;
    target: string;
    text: string;
  }

  const rawEdges: RawEdge[] = [];
  for (const cell of cells) {
    if (cell.getAttribute('edge') !== '1') continue;
    const source = cell.getAttribute('source') ?? '';
    const target = cell.getAttribute('target') ?? '';
    if (!source || !target) continue;
    if (!vertexIds.has(source) || !vertexIds.has(target)) continue;

    const { name } = parseValue(cell.getAttribute('value') ?? '');
    rawEdges.push({ source, target, text: name });
  }

  const typeById = new Map(vertices.map((v) => [v.id, v.type]));

  // 由连线反推属性的归属
  const parentById = new Map<string, string>();
  for (const edge of rawEdges) {
    const sType = typeById.get(edge.source);
    const tType = typeById.get(edge.target);

    if (sType === 'attribute' && (tType === 'entity' || tType === 'relationship')) {
      if (!parentById.has(edge.source)) parentById.set(edge.source, edge.target);
    } else if (tType === 'attribute' && (sType === 'entity' || sType === 'relationship')) {
      if (!parentById.has(edge.target)) parentById.set(edge.target, edge.source);
    }
  }

  const nodes: ErNode[] = vertices.map((v) => ({
    id: v.id,
    name: v.name,
    type: v.type,
    x: v.x,
    y: v.y,
    ...(v.type === 'attribute'
      ? { isPrimaryKey: v.primaryKey, parent: parentById.get(v.id) }
      : {}),
  }));

  const links: ErLink[] = rawEdges.map((edge) => {
    const sType = typeById.get(edge.source);
    const tType = typeById.get(edge.target);
    return {
      source: edge.source,
      target: edge.target,
      type: sType === 'attribute' || tType === 'attribute' ? 'attribute' : 'relationship',
      text: edge.text || undefined,
    };
  });

  // 校验外键式结构完整性
  const orphans = nodes.filter((n) => n.type === 'attribute' && !n.parent);
  if (orphans.length > 0) {
    warnings.push(`${orphans.length} 个属性没有连到任何实体或联系，已保留但不参与归属`);
  }

  const entityCount = nodes.filter((n) => n.type === 'entity').length;
  const relCount = nodes.filter((n) => n.type === 'relationship').length;
  if (relCount > 0) {
    warnings.push(`识别出 ${relCount} 个联系菱形；导入后按「联系」处理，基数取自连线上的文字`);
  }
  warnings.push(`共导入 ${entityCount} 个实体、${nodes.length - entityCount - relCount} 个属性`);

  return { nodes, links, warnings };
}

/* ------------------------------------------------------------------ */

/** 找到第一页可用的 mxGraphModel（未压缩直接取，压缩页先解压） */
async function findGraphModel(doc: Document): Promise<Element | null> {
  const models = Array.from(doc.querySelectorAll('mxGraphModel'));
  const direct = models.find((m) => m.querySelector('mxCell[vertex="1"]')) ?? models[0];
  if (direct) return direct;

  for (const diagram of Array.from(doc.querySelectorAll('diagram'))) {
    const payload = diagram.textContent?.trim();
    if (!payload) continue;
    const inner = await inflateGraphModel(payload);
    if (inner) return inner;
  }
  return null;
}

/**
 * draw.io 的压缩存储：base64(raw-deflate(encodeURIComponent(图 XML)))。
 * 浏览器与 Node 18+ 都提供 DecompressionStream。
 */
async function inflateGraphModel(payload: string): Promise<Element | null> {
  if (typeof DecompressionStream === 'undefined') {
    throw new DrawioImportError('该文件是 draw.io 压缩格式，当前浏览器不支持解压');
  }

  try {
    const bytes = Uint8Array.from(atob(payload.replace(/\s+/g, '')), (c) => c.charCodeAt(0));

    const decompressor = new DecompressionStream('deflate-raw');

    // 必须与写入并发读取，否则写端会因背压卡住
    const collected = (async () => {
      const reader = decompressor.readable.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        total += value.length;
      }
      const merged = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        merged.set(chunk, offset);
        offset += chunk.length;
      }
      return merged;
    })();

    const writer = decompressor.writable.getWriter();
    await writer.write(bytes);
    await writer.close();

    const xml = decodeURIComponent(new TextDecoder().decode(await collected));
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    const models = Array.from(doc.querySelectorAll('mxGraphModel'));
    return models.find((m) => m.querySelector('mxCell[vertex="1"]')) ?? models[0] ?? null;
  } catch (err) {
    if (err instanceof DrawioImportError) throw err;
    return null;
  }
}

function detectType(style: string): NodeType {
  const normalized = style.toLowerCase();
  if (/shape\s*=\s*rhombus/.test(normalized) || /shape\s*=\s*diamond/.test(normalized)) {
    return 'relationship';
  }
  if (/shape\s*=\s*ellipse/.test(normalized) || /shape\s*=\s*doubleellipse/.test(normalized)) {
    return 'attribute';
  }
  if (normalized.split(';').map((p) => p.trim()).includes('ellipse')) return 'attribute';
  return 'entity';
}

/** 解析 draw.io 的 value：可能是纯文本，也可能带 HTML（下划线表示主键） */
export function parseValue(raw: string): { name: string; primaryKey: boolean } {
  let value = raw ?? '';

  // DOM 已解一次实体，兼容历史双重转义的文件再解一次
  value = value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');

  const primaryKey = /<u[ >][\s\S]*?<\/u>/i.test(value) || /<u>[\s\S]*?<\/u>/i.test(value);

  const name = value
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  return { name, primaryKey };
}
