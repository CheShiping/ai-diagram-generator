/**
 * SQL 解析服务：基于 @guanmingchiu/sqlparser-ts（datafusion-sqlparser-rs 的 WASM 绑定）
 * 把 MySQL 建表语句解析成结构化的表 / 列 / 主键 / 外键。
 *
 * 解析策略（鲁棒性优先）：
 *  1. 先整体解析；
 *  2. 失败则按 `;` 拆句逐条解析，跳过无法解析的语句并记录；
 *  3. 单句仍失败时做一次温和清洗（去掉 INDEX/KEY 定义、ON UPDATE、COLLATE 等
 *     MySQL 方言细节）再试。
 */

import { init, parse } from '@guanmingchiu/sqlparser-ts';
import type { ParsedColumn, ParsedForeignKey, ParsedTable } from '../../shared/er-model';

let initPromise: Promise<void> | null = null;

async function ensureInit(): Promise<void> {
  if (!initPromise) {
    initPromise = init();
  }
  return initPromise;
}

export interface SqlParseOutcome {
  tables: ParsedTable[];
  warnings: string[];
}

/** 解析任意 MySQL DDL 文本，产出表结构。 */
export async function parseSqlToTables(sql: string): Promise<SqlParseOutcome> {
  await ensureInit();

  const warnings: string[] = [];
  const statements = splitStatements(stripComments(sql));

  if (statements.length === 0) {
    throw new SqlParseError('没有检测到任何 SQL 语句');
  }

  const tables: ParsedTable[] = [];
  const seenTables = new Set<string>();
  const pendingForeignKeys: Array<{ tableName: string; fk: ParsedForeignKey }> = [];

  for (const [index, raw] of statements.entries()) {
    const stmt = raw.trim();
    if (!stmt) continue;
    if (!/alter\s+table|create\s+table/i.test(stmt)) continue;

    const ast = tryParseStatement(stmt, index + 1, warnings);
    if (!ast) continue;

    for (const item of ast as any[]) {
      const created = item?.CreateTable;
      if (created) {
        const table = extractTable(created, warnings);
        if (!table) continue;
        if (seenTables.has(table.tableName)) {
          warnings.push(`表 ${table.tableName} 重复定义，已保留第一次出现的定义`);
          continue;
        }
        seenTables.add(table.tableName);
        tables.push(table);
        continue;
      }

      // mysqldump / 手工 SQL 常见写法：ALTER TABLE ... ADD CONSTRAINT ... FOREIGN KEY
      const altered = item?.AlterTable;
      if (altered) {
        const tableName = lastIdentifier(altered.name);
        if (!tableName) continue;
        for (const op of altered.operations ?? []) {
          const added = op?.AddConstraint?.constraint;
          if (added?.ForeignKey) {
            const fk = extractForeignKey(added.ForeignKey);
            if (fk) pendingForeignKeys.push({ tableName, fk });
          }
        }
      }
    }
  }

  // 把 ALTER 追加的外键合并进对应表
  for (const { tableName, fk } of pendingForeignKeys) {
    const table = tables.find((t) => t.tableName === tableName);
    if (!table) {
      warnings.push(`ALTER TABLE ${tableName} 添加的外键 ${fk.name || fk.columns.join(',')} 找不到目标表，已跳过`);
      continue;
    }
    const duplicated = table.foreignKeys.some(
      (existing) =>
        existing.refTable === fk.refTable && existing.columns.join(',') === fk.columns.join(','),
    );
    if (!duplicated) table.foreignKeys.push(fk);
  }

  if (tables.length === 0) {
    throw new SqlParseError('没有解析出任何 CREATE TABLE 语句，请确认输入的是 MySQL 建表 SQL');
  }

  return { tables, warnings };
}

export class SqlParseError extends Error {}

/* ------------------------------------------------------------------ */
/* 注释剥离与语句切分                                                    */
/* ------------------------------------------------------------------ */

/** 去掉 -- / # 行注释与块注释，保留字符串字面量内容。 */
export function stripComments(sql: string): string {
  let out = '';
  let quote: string | null = null;

  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];

    if (quote) {
      out += ch;
      if (ch === '\\' && i + 1 < sql.length) {
        out += sql[i + 1];
        i++;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }

    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
      out += ch;
      continue;
    }

    if (ch === '-' && sql[i + 1] === '-') {
      while (i < sql.length && sql[i] !== '\n') i++;
      out += '\n';
      continue;
    }

    if (ch === '#') {
      while (i < sql.length && sql[i] !== '\n') i++;
      out += '\n';
      continue;
    }

    if (ch === '/' && sql[i + 1] === '*') {
      i += 2;
      while (i < sql.length && !(sql[i] === '*' && sql[i + 1] === '/')) i++;
      i += 1;
      out += ' ';
      continue;
    }

    out += ch;
  }

  return out;
}

/** 按分号切分语句，忽略引号与括号内的分号。 */
export function splitStatements(sql: string): string[] {
  const out: string[] = [];
  let buf = '';
  let quote: string | null = null;
  let depth = 0;

  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];

    if (quote) {
      buf += ch;
      if (ch === '\\' && i + 1 < sql.length) {
        buf += sql[i + 1];
        i++;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }

    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
      buf += ch;
      continue;
    }

    if (ch === '(') {
      depth++;
      buf += ch;
      continue;
    }
    if (ch === ')') {
      depth = Math.max(0, depth - 1);
      buf += ch;
      continue;
    }

    if (ch === ';' && depth === 0) {
      if (buf.trim()) out.push(buf.trim());
      buf = '';
      continue;
    }

    buf += ch;
  }

  if (buf.trim()) out.push(buf.trim());
  return out;
}

/* ------------------------------------------------------------------ */
/* 单条语句解析（带降级）                                               */
/* ------------------------------------------------------------------ */

function tryParseStatement(stmt: string, ordinal: number, warnings: string[]): unknown[] | null {
  const attempts: Array<{ label: string; sql: string }> = [
    { label: '原样', sql: stmt },
    { label: '清洗后', sql: sanitizeMySql(stmt) },
  ];

  for (const attempt of attempts) {
    try {
      const ast = parse(attempt.sql, 'mysql') as unknown[];
      if (Array.isArray(ast)) return ast;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      warnings.push(`第 ${ordinal} 条语句（${attempt.label}）解析失败：${message.split('\n')[0]}`);
    }
  }

  return null;
}

/**
 * 去掉 sqlparser-rs MySQL 方言下容易报错的枝节语法，但保留所有对 ER 图有用的信息
 * （表名、列名、列注释、主键、外键）。
 */
export function sanitizeMySql(sql: string): string {
  let out = sql;

  // 去掉索引/键定义行（不影响实体-属性-联系结构）
  out = out.replace(
    /^[ \t]*(?:UNIQUE\s+|FULLTEXT\s+|SPATIAL\s+)?(?:INDEX|KEY)\s+[`"][^`"]+[`"]\s*\([^)]*\)[^,\n]*,\s*$/gim,
    '',
  );
  // 去掉表级 USING BTREE / USING HASH
  out = out.replace(/\)\s*USING\s+(?:BTREE|HASH)\s*\)?/gi, ')');
  // 去掉 ON UPDATE CURRENT_TIMESTAMP 之类
  out = out.replace(/\s+ON\s+UPDATE\s+[^,\n)]+/gi, '');
  // 去掉列/表级字符集与排序规则
  out = out.replace(/\s+(?:CHARACTER\s+SET|CHARSET)\s*[= ]\s*[\w-]+/gi, '');
  out = out.replace(/\s+COLLATE\s*[= ]\s*[\w-]+/gi, '');
  // 去掉表选项里的 ROW_FORMAT / STATS_* 等
  out = out.replace(/\s+(?:ROW_FORMAT|STATS_PERSISTENT|STATS_AUTO_RECALC|STATS_SAMPLE_PAGES)\s*=\s*[^,\s]+/gi, '');
  // 清理多余的连续逗号
  out = out.replace(/,\s*\)/g, ')');
  out = out.replace(/,\s*,/g, ',');

  return out;
}

/* ------------------------------------------------------------------ */
/* AST → 表结构                                                        */
/* ------------------------------------------------------------------ */

function extractTable(created: any, warnings: string[]): ParsedTable | null {
  const tableName = lastIdentifier(created.name);
  if (!tableName) {
    warnings.push('存在一个无法识别表名的 CREATE TABLE 语句，已跳过');
    return null;
  }

  const tableComment = extractTableComment(created.table_options);

  // 1) 列
  const columns: ParsedColumn[] = [];
  const rawColumns: any[] = Array.isArray(created.columns) ? created.columns : [];

  // 2) 主键集合（先扫描表级约束）
  const pkSet = new Set<string>();
  const foreignKeys: ParsedForeignKey[] = [];

  for (const constraint of created.constraints ?? []) {
    if (constraint?.PrimaryKey) {
      for (const col of constraint.PrimaryKey.columns ?? []) {
        const name = identifierValue(col?.column?.expr);
        if (name) pkSet.add(name);
      }
    }
    if (constraint?.ForeignKey) {
      const fk = extractForeignKey(constraint.ForeignKey);
      if (fk) foreignKeys.push(fk);
    }
  }

  for (const col of rawColumns) {
    const name = col?.name?.value;
    if (!name) continue;
    const opts = extractColumnOptions(col.options);
    if (opts.primary) pkSet.add(name);
    columns.push({
      name,
      comment: opts.comment,
      primaryKey: pkSet.has(name),
      type: formatDataType(col.data_type),
    });
  }

  // 主键集合可能在列扫描后才补齐，回填
  for (const col of columns) {
    if (pkSet.has(col.name)) col.primaryKey = true;
  }

  return {
    tableName,
    tableComment,
    columns,
    foreignKeys,
  };
}

function extractForeignKey(fk: any): ParsedForeignKey | null {
  const columns: string[] = (fk.columns ?? [])
    .map((c: any) => (typeof c === 'string' ? c : c?.value))
    .filter((v: unknown): v is string => typeof v === 'string' && v.length > 0);

  const refTable = lastIdentifier(fk.foreign_table);
  const refColumns: string[] = (fk.referred_columns ?? [])
    .map((c: any) => (typeof c === 'string' ? c : c?.value))
    .filter((v: unknown): v is string => typeof v === 'string' && v.length > 0);

  if (!refTable) return null;

  return {
    name: typeof fk.name === 'string' ? fk.name : (fk.name?.value ?? ''),
    columns,
    refTable,
    refColumns,
  };
}

function extractColumnOptions(options: any[]): { comment: string; primary: boolean } {
  let comment = '';
  let primary = false;

  for (const entry of options ?? []) {
    const opt = entry?.option;
    if (!opt) continue;

    if (typeof opt === 'string') {
      if (opt === 'PrimaryKey') primary = true;
      continue;
    }

    if (typeof opt === 'object') {
      if (opt.Comment !== undefined) {
        comment = typeof opt.Comment === 'string' ? opt.Comment : '';
      }
      if (opt.Unique?.is_primary) primary = true;
      if (Array.isArray(opt.DialectSpecific)) {
        const text = opt.DialectSpecific.map((x: any) => x?.Word?.value ?? x?.value ?? '').join(' ');
        if (/PRIMARY\s+KEY/i.test(text)) primary = true;
      }
    }
  }

  return { comment, primary };
}

function extractTableComment(tableOptions: any): string {
  const plain: any[] = tableOptions?.Plain ?? [];
  for (const opt of plain) {
    if (opt?.Comment !== undefined) {
      const c = opt.Comment;
      if (typeof c === 'string') return c;
      if (typeof c === 'object') {
        if (typeof c.WithEq === 'string') return c.WithEq;
        if (typeof c.WithoutEq === 'string') return c.WithoutEq;
      }
    }
  }
  return '';
}

/** 取对象名（可能带 schema 前缀）的最后一段 */
function lastIdentifier(nameNode: any): string {
  if (!Array.isArray(nameNode) || nameNode.length === 0) return '';
  const parts = nameNode
    .map((part: any) => {
      if (part?.Identifier) return part.Identifier.value;
      if (part?.ObjectName) return lastIdentifier(part.ObjectName);
      return '';
    })
    .filter((v: unknown): v is string => typeof v === 'string');
  return parts[parts.length - 1] ?? '';
}

function identifierValue(exprNode: any): string {
  if (!exprNode) return '';
  if (exprNode.Identifier) return exprNode.Identifier.value ?? '';
  if (exprNode.CompoundIdentifier) {
    const parts = exprNode.CompoundIdentifier.map((p: any) => p?.value ?? '');
    return parts[parts.length - 1] ?? '';
  }
  return '';
}

/** 把 sqlparser 的 data_type AST 尽力渲染成人类可读的类型文本 */
export function formatDataType(dt: any): string {
  if (!dt) return '';
  if (typeof dt === 'string') return dt.toUpperCase();
  if (Array.isArray(dt)) {
    return dt
      .map(formatDataType)
      .filter(Boolean)
      .join(' ');
  }
  if (typeof dt === 'object') {
    const key = Object.keys(dt)[0];
    if (!key) return '';
    const upper = key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase();

    const lengths: number[] = [];
    const walk = (x: any): void => {
      if (typeof x === 'number') lengths.push(x);
      else if (Array.isArray(x)) x.forEach(walk);
      else if (x && typeof x === 'object') Object.values(x).forEach(walk);
    };
    walk(dt[key]);

    return lengths.length ? `${upper}(${lengths.join(',')})` : upper;
  }
  return '';
}
