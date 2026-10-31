/**
 * 陈式（Chen）ER 图数据模型与转换逻辑。
 *
 * 约定（与原站逆向结论一致）：
 *  - 实体 entity       → 矩形
 *  - 属性 attribute    → 椭圆，通过 parent 指向所属实体/联系
 *  - 联系 relationship → 菱形，两端连边，边上标基数 1 / N / M
 *  - 主键               → 属性名下加下划线
 */

export type NodeType = 'entity' | 'attribute' | 'relationship';

export type RelationKind = 'oneToOne' | 'oneToMany' | 'manyToMany';

export interface ErNode {
  id: string;
  name: string;
  type: NodeType;
  /** 属性节点所属的实体或联系 id */
  parent?: string;
  isPrimaryKey?: boolean;
  /** 初始中心坐标（导入 draw.io 时用于保留原始排版） */
  x?: number;
  y?: number;
}

export interface ErLink {
  source: string;
  target: string;
  type: 'attribute' | 'relationship';
  /** 联系边上的基数标注：'1' | 'N' | 'M' */
  text?: string;
}

export interface ErDiagram {
  nodes: ErNode[];
  links: ErLink[];
}

/* ------------------------------------------------------------------ */
/* 后端 SQL 解析产出的表结构                                             */
/* ------------------------------------------------------------------ */

export interface ParsedColumn {
  name: string;
  /** 列中文注释，无注释时为空串 */
  comment: string;
  primaryKey: boolean;
  /** 数据类型文本，如 int / varchar(50) */
  type: string;
}

export interface ParsedForeignKey {
  /** 约束名，MySQL 未命名外键时为空串 */
  name: string;
  /** 本表参与外键的列 */
  columns: string[];
  refTable: string;
  refColumns: string[];
}

export interface ParsedTable {
  tableName: string;
  /** 表中文注释，无注释时为空串 */
  tableComment: string;
  columns: ParsedColumn[];
  foreignKeys: ParsedForeignKey[];
}

/* ------------------------------------------------------------------ */
/* AI 结构化产出的实体与关系                                             */
/* ------------------------------------------------------------------ */

export interface AiAttribute {
  name: string;
  primaryKey?: boolean;
}

export interface AiEntity {
  name: string;
  attributes: AiAttribute[];
}

export interface AiRelationship {
  source: string;
  target: string;
  type: RelationKind;
  /** 联系名，缺省「关联」 */
  text?: string;
  /** 联系自身的属性，如「选修」联系上的「成绩」 */
  attributes?: AiAttribute[];
}

export interface AiResult {
  entities: AiEntity[];
  relationships: AiRelationship[];
}

/* ------------------------------------------------------------------ */
/* 转换：SQL 表结构 → 陈式图                                            */
/* ------------------------------------------------------------------ */

export interface DiagramConvertResult {
  diagram: ErDiagram;
  warnings: string[];
}

export interface SqlConvertOptions {
  /** true：实体/属性显示中文注释；false：显示英文表名/列名 */
  showComment: boolean;
}

const DEFAULT_RELATION_NAME = '关联';

function displayName(comment: string, fallback: string, showComment: boolean): string {
  if (showComment && comment.trim()) return comment.trim();
  return fallback;
}

/**
 * 表结构 → 陈式 ER 图。
 *
 * 映射规则（与 huahub 一致）：
 *  表    → 实体矩形（id = 表名）
 *  列    → 属性椭圆（id = 表名#列名，parent = 表名）；外键列不再单独画属性
 *  外键  → 一个联系菱形（id = 本表~目标表~序号）
 *          边：本表 --N--> 菱形 --1--> 目标表
 *  关联表（恰好两个外键、指向两张不同的表、且没有被别的表引用）
 *        → 多对多联系菱形（id = assoc~表名），其余列挂成该联系的属性
 */
export function tablesToDiagram(
  tables: ParsedTable[],
  options: SqlConvertOptions = { showComment: true },
): DiagramConvertResult {
  const nodes: ErNode[] = [];
  const links: ErLink[] = [];
  const warnings: string[] = [];
  const tableNames = new Set(tables.map((t) => t.tableName));
  const associations = detectAssociationTables(tables, tableNames);

  for (const table of tables) {
    if (associations.has(table.tableName)) continue;

    nodes.push({
      id: table.tableName,
      name: displayName(table.tableComment, table.tableName, options.showComment),
      type: 'entity',
    });

    // 外键列已经用联系菱形表达，不再重复画成属性（主键列除外）
    const fkColumns = hiddenForeignKeyColumns(table);

    for (const col of table.columns) {
      if (fkColumns.has(col.name)) continue;
      const attrId = `${table.tableName}#${col.name}`;
      nodes.push({
        id: attrId,
        name: displayName(col.comment, col.name, options.showComment),
        type: 'attribute',
        parent: table.tableName,
        isPrimaryKey: col.primaryKey,
      });
      links.push({ source: table.tableName, target: attrId, type: 'attribute' });
    }
  }

  // 关联表 → 多对多联系（带自己的属性，如订单明细的数量、小计）
  for (const table of tables) {
    if (!associations.has(table.tableName)) continue;

    const relId = `assoc~${table.tableName}`;
    nodes.push({
      id: relId,
      name: displayName(table.tableComment, table.tableName, options.showComment),
      type: 'relationship',
    });

    for (const fk of table.foreignKeys) {
      links.push({ source: fk.refTable, target: relId, type: 'relationship', text: 'N' });
    }

    for (const col of table.columns) {
      if (col.primaryKey) continue;
      if (table.foreignKeys.some((fk) => fk.columns.includes(col.name))) continue;
      const attrId = `${relId}#${col.name}`;
      nodes.push({
        id: attrId,
        name: displayName(col.comment, col.name, options.showComment),
        type: 'attribute',
        parent: relId,
      });
      links.push({ source: relId, target: attrId, type: 'attribute' });
    }
  }

  let relSeq = 0;
  for (const table of tables) {
    if (associations.has(table.tableName)) continue;
    for (const fk of table.foreignKeys) {
      if (!tableNames.has(fk.refTable)) {
        warnings.push(`表 ${table.tableName} 的外键引用了未在本批次中定义的表 ${fk.refTable}，已跳过该联系`);
        continue;
      }
      const relId = `${table.tableName}~${fk.refTable}~${relSeq++}`;
      nodes.push({
        id: relId,
        name: fk.name.trim() || DEFAULT_RELATION_NAME,
        type: 'relationship',
      });
      // 持有外键的表是「多」的一端
      links.push({ source: table.tableName, target: relId, type: 'relationship', text: 'N' });
      links.push({ source: relId, target: fk.refTable, type: 'relationship', text: '1' });
    }
  }

  return { diagram: { nodes, links }, warnings };
}

/** 被其他表外键引用过的表名 */
function referencedTables(tables: ParsedTable[]): Set<string> {
  const referenced = new Set<string>();
  for (const table of tables) {
    for (const fk of table.foreignKeys) {
      if (fk.refTable !== table.tableName) referenced.add(fk.refTable);
    }
  }
  return referenced;
}

/**
 * 关联表识别：两个外键、指向两张不同的且已定义的表、自身没有被别的表外键引用。
 * 这类表在陈式图里应画成多对多联系，而不是实体。
 */
function detectAssociationTables(tables: ParsedTable[], tableNames: Set<string>): Set<string> {
  const referenced = referencedTables(tables);
  const result = new Set<string>();

  for (const table of tables) {
    if (table.foreignKeys.length !== 2) continue;
    const [a, b] = table.foreignKeys;
    if (a.refTable === b.refTable) continue;
    if (!tableNames.has(a.refTable) || !tableNames.has(b.refTable)) continue;
    if (referenced.has(table.tableName)) continue;
    result.add(table.tableName);
  }
  return result;
}

/** 该表中外键引用、且不是主键的列名（这些列不再画成属性） */
function hiddenForeignKeyColumns(table: ParsedTable): Set<string> {
  const hidden = new Set<string>();
  for (const fk of table.foreignKeys) {
    for (const columnName of fk.columns) {
      const column = table.columns.find((c) => c.name === columnName);
      if (column && !column.primaryKey) hidden.add(columnName);
    }
  }
  return hidden;
}

/* ------------------------------------------------------------------ */
/* 转换：AI 结果 → 陈式图                                               */
/* ------------------------------------------------------------------ */

export function cardinalityOf(kind: RelationKind): { left: string; right: string } {
  switch (kind) {
    case 'oneToOne':
      return { left: '1', right: '1' };
    case 'manyToMany':
      return { left: 'N', right: 'M' };
    case 'oneToMany':
    default:
      return { left: '1', right: 'N' };
  }
}

export function aiToDiagram(result: AiResult): DiagramConvertResult {
  const nodes: ErNode[] = [];
  const links: ErLink[] = [];
  const warnings: string[] = [];

  const entityIdByName = new Map<string, string>();

  (result.entities ?? []).forEach((entity, i) => {
    const name = (entity.name ?? '').trim();
    if (!name) {
      warnings.push(`第 ${i + 1} 个实体名为空，已跳过`);
      return;
    }
    const id = `e${i}`;
    entityIdByName.set(name, id);
    nodes.push({ id, name, type: 'entity' });

    for (const [j, attr] of (entity.attributes ?? []).entries()) {
      const attrName = (attr.name ?? '').trim();
      if (!attrName) continue;
      const attrId = `${id}#${j}`;
      nodes.push({
        id: attrId,
        name: attrName,
        type: 'attribute',
        parent: id,
        isPrimaryKey: Boolean(attr.primaryKey),
      });
      links.push({ source: id, target: attrId, type: 'attribute' });
    }
  });

  (result.relationships ?? []).forEach((rel, k) => {
    const sourceName = (rel.source ?? '').trim();
    const targetName = (rel.target ?? '').trim();
    const sourceId = entityIdByName.get(sourceName);
    const targetId = entityIdByName.get(targetName);

    if (!sourceId || !targetId) {
      warnings.push(
        `联系「${rel.text || DEFAULT_RELATION_NAME}」引用了未知实体 ${sourceName || '?'} → ${targetName || '?'}，已跳过`,
      );
      return;
    }

    const relId = `r${k}`;
    nodes.push({ id: relId, name: (rel.text ?? '').trim() || DEFAULT_RELATION_NAME, type: 'relationship' });

    const card = cardinalityOf(rel.type ?? 'oneToMany');
    links.push({ source: sourceId, target: relId, type: 'relationship', text: card.left });
    links.push({ source: relId, target: targetId, type: 'relationship', text: card.right });

    for (const [m, attr] of (rel.attributes ?? []).entries()) {
      const attrName = (attr.name ?? '').trim();
      if (!attrName) continue;
      const attrId = `${relId}#${m}`;
      nodes.push({
        id: attrId,
        name: attrName,
        type: 'attribute',
        parent: relId,
        isPrimaryKey: Boolean(attr.primaryKey),
      });
      links.push({ source: relId, target: attrId, type: 'attribute' });
    }
  });

  return { diagram: { nodes, links }, warnings };
}

/* ------------------------------------------------------------------ */
/* 反向：图模型 → AI 补关系所需的实体列表                                */
/* ------------------------------------------------------------------ */

export function diagramToAiEntities(diagram: ErDiagram): AiEntity[] {
  return diagram.nodes
    .filter((n) => n.type === 'entity')
    .map((n) => ({
      name: n.name,
      attributes: diagram.nodes
        .filter((a) => a.type === 'attribute' && a.parent === n.id)
        .map((a) => ({ name: a.name, primaryKey: Boolean(a.isPrimaryKey) })),
    }));
}

/** 已存在的实体对，用于去重 AI 补关系结果 */
export function existingEntityPairs(diagram: ErDiagram): Set<string> {
  const idToName = new Map(diagram.nodes.filter((n) => n.type === 'entity').map((n) => [n.id, n.name]));
  const pairs = new Set<string>();
  const relNodes = diagram.nodes.filter((n) => n.type === 'relationship');
  for (const rel of relNodes) {
    const endpoints = diagram.links
      .filter((l) => l.type === 'relationship' && (l.target === rel.id || l.source === rel.id))
      .map((l) => (l.target === rel.id ? idToName.get(l.source) : idToName.get(l.target)))
      .filter((v): v is string => Boolean(v));
    if (endpoints.length === 2) {
      const [a, b] = endpoints.sort();
      pairs.add(`${a}::${b}`);
    }
  }
  return pairs;
}
