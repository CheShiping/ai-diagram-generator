import { describe, expect, it } from 'vitest';
import { parseSqlToTables, sanitizeMySql, splitStatements } from '../server/services/sql-parser';

const CLASS_STUDENT_SQL = `
-- 班级表
CREATE TABLE \`t_class_info\` (
    \`class_id\`    int(11) NOT NULL AUTO_INCREMENT COMMENT '班级ID',
    \`class_name\`  varchar(50) NOT NULL DEFAULT '' COMMENT '班级名称',
    \`create_time\` timestamp NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    PRIMARY KEY (\`class_id\`) USING BTREE
) ENGINE = InnoDB AUTO_INCREMENT = 1 COMMENT = '班级';

-- 学生表存在外键约束
CREATE TABLE \`t_student\` (
    \`student_id\`   int(11) NOT NULL AUTO_INCREMENT COMMENT '学生ID',
    \`student_name\` varchar(50) NOT NULL COMMENT '学生姓名',
    \`class_id\`     int(11) NULL DEFAULT NULL COMMENT '班级ID',
    PRIMARY KEY (\`student_id\`) USING BTREE,
    CONSTRAINT \`fk_student_class\` FOREIGN KEY (\`class_id\`) REFERENCES \`t_class_info\` (\`class_id\`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB AUTO_INCREMENT = 1 COMMENT = '学生';
`;

const MESSY_REAL_WORLD_SQL = `
CREATE TABLE \`sys_user\` (
  \`id\` bigint(20) NOT NULL AUTO_INCREMENT COMMENT '用户ID',
  \`username\` varchar(50) NOT NULL COMMENT '用户名',
  \`dept_id\` bigint(20) DEFAULT NULL COMMENT '部门ID',
  \`created_at\` datetime DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  \`updated_at\` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (\`id\`),
  UNIQUE KEY \`uk_username\` (\`username\`),
  KEY \`idx_dept\` (\`dept_id\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='系统用户';

CREATE TABLE \`sys_dept\` (
  \`id\` bigint(20) NOT NULL COMMENT '部门ID',
  \`name\` varchar(50) NOT NULL COMMENT '部门名称',
  PRIMARY KEY (\`id\`)
) ENGINE=InnoDB COMMENT='部门';

CREATE TABLE \`sys_order\` (
  \`order_no\` varchar(32) NOT NULL COMMENT '订单号',
  \`buyer_id\` bigint(20) NOT NULL COMMENT '买家',
  \`seller_id\` bigint(20) NOT NULL COMMENT '卖家',
  PRIMARY KEY (\`order_no\`, \`buyer_id\`),
  CONSTRAINT \`fk_order_buyer\` FOREIGN KEY (\`buyer_id\`) REFERENCES \`sys_user\` (\`id\`),
  CONSTRAINT \`fk_order_seller\` FOREIGN KEY (\`seller_id\`) REFERENCES \`sys_user\` (\`id\`)
) ENGINE=InnoDB COMMENT='订单';

CREATE TABLE \`sys_dept_rel\` (
  \`dept_id\` bigint(20) NOT NULL,
  \`user_id\` bigint(20) NOT NULL,
  PRIMARY KEY (\`dept_id\`, \`user_id\`),
  CONSTRAINT \`fk_rel_dept\` FOREIGN KEY (\`dept_id\`) REFERENCES \`sys_dept\` (\`id\`) ON DELETE CASCADE,
  CONSTRAINT \`fk_rel_user\` FOREIGN KEY (\`user_id\`) REFERENCES \`sys_user\` (\`id\`) ON DELETE CASCADE
) COMMENT='部门用户关联';
`;

describe('splitStatements', () => {
  it('按分号切分并忽略引号内分号', () => {
    const parts = splitStatements("CREATE TABLE a (x varchar(10) DEFAULT 'a;b'); CREATE TABLE b (y int);");
    expect(parts).toHaveLength(2);
    expect(parts[0]).toContain("'a;b'");
  });
});

describe('sanitizeMySql', () => {
  it('去掉索引定义与字符集噪声', () => {
    const cleaned = sanitizeMySql(MESSY_REAL_WORLD_SQL);
    expect(cleaned).not.toMatch(/UNIQUE KEY/);
    expect(cleaned).not.toMatch(/COLLATE/);
    expect(cleaned).toMatch(/COMMENT='系统用户'/);
  });
});

describe('parseSqlToTables - 原站示例', () => {
    it('解析表名、中文注释、主键与外键', async () => {
    const { tables, warnings } = await parseSqlToTables(CLASS_STUDENT_SQL);

    expect(warnings).toHaveLength(0);
    expect(tables.map((t) => t.tableName)).toEqual(['t_class_info', 't_student']);

    const classTable = tables[0];
    expect(classTable.tableComment).toBe('班级');
    expect(classTable.columns.map((c) => c.name)).toEqual(['class_id', 'class_name', 'create_time']);
    expect(classTable.columns[0]).toMatchObject({ comment: '班级ID', primaryKey: true });

    const studentTable = tables[1];
    expect(studentTable.tableComment).toBe('学生');
    expect(studentTable.foreignKeys).toHaveLength(1);
    expect(studentTable.foreignKeys[0]).toMatchObject({
      name: 'fk_student_class',
      refTable: 't_class_info',
      columns: ['class_id'],
      refColumns: ['class_id'],
    });
  });
});

describe('parseSqlToTables - 真实脏语法', () => {
  it('能在索引/字符集/ON UPDATE 干扰下解析', async () => {
    const { tables } = await parseSqlToTables(MESSY_REAL_WORLD_SQL);
    expect(tables.map((t) => t.tableName)).toEqual(['sys_user', 'sys_dept', 'sys_order', 'sys_dept_rel']);

    const user = tables.find((t) => t.tableName === 'sys_user')!;
    expect(user.tableComment).toBe('系统用户');
    expect(user.columns.find((c) => c.name === 'id')?.primaryKey).toBe(true);
    expect(user.columns.find((c) => c.name === 'updated_at')?.comment).toBe('更新时间');

    const order = tables.find((t) => t.tableName === 'sys_order')!;
    expect(order.foreignKeys).toHaveLength(2);
    expect(order.columns.filter((c) => c.primaryKey).map((c) => c.name)).toEqual(['order_no', 'buyer_id']);
  });

  it('复合外键与 ON DELETE 级联不影响解析', async () => {
    const { tables } = await parseSqlToTables(MESSY_REAL_WORLD_SQL);
    const rel = tables.find((t) => t.tableName === 'sys_dept_rel')!;
    expect(rel.foreignKeys.map((fk) => fk.refTable)).toEqual(['sys_dept', 'sys_user']);
  });

  it('引用不存在表时给出告警而不是崩溃', async () => {
    const { tables } = await parseSqlToTables(`
      CREATE TABLE \`child\` (
        \`id\` int NOT NULL,
        \`parent_id\` int COMMENT '父级',
        PRIMARY KEY (\`id\`),
        CONSTRAINT \`fk_child_parent\` FOREIGN KEY (\`parent_id\`) REFERENCES \`ghost\` (\`id\`)
      ) COMMENT='子表';
    `);
    expect(tables).toHaveLength(1);
    expect(tables[0].foreignKeys[0].refTable).toBe('ghost');
  });

  it('完全没有 CREATE TABLE 时报明确错误', async () => {
    await expect(parseSqlToTables('SELECT 1;')).rejects.toThrow(/CREATE TABLE/);
  });
});

describe('ALTER TABLE 追加外键', () => {
  it('能把 ALTER 定义的外键合并进目标表', async () => {
    const { tables } = await parseSqlToTables(`
      CREATE TABLE \`parent\` (
        \`id\` int NOT NULL COMMENT '主键',
        PRIMARY KEY (\`id\`)
      ) COMMENT='父表';

      CREATE TABLE \`child\` (
        \`id\` int NOT NULL,
        \`parent_id\` int COMMENT '父ID',
        PRIMARY KEY (\`id\`)
      ) COMMENT='子表';

      ALTER TABLE \`child\` ADD CONSTRAINT \`fk_child_parent\` FOREIGN KEY (\`parent_id\`) REFERENCES \`parent\` (\`id\`);
    `);

    const child = tables.find((t) => t.tableName === 'child')!;
    expect(child.foreignKeys).toHaveLength(1);
    expect(child.foreignKeys[0]).toMatchObject({
      name: 'fk_child_parent',
      refTable: 'parent',
      refColumns: ['id'],
    });
  });

  it('ALTER 指向不存在的表时只告警', async () => {
    const { tables } = await parseSqlToTables(`
      CREATE TABLE \`only\` (\`id\` int NOT NULL, PRIMARY KEY (\`id\`)) COMMENT='唯一表';
      ALTER TABLE \`missing\` ADD CONSTRAINT \`fk_x\` FOREIGN KEY (\`a\`) REFERENCES \`only\` (\`id\`);
    `);
    expect(tables.map((t) => t.tableName)).toEqual(['only']);
  });
});
