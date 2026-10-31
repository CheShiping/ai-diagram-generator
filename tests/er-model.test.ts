import { describe, expect, it } from 'vitest';
import {
  aiToDiagram,
  cardinalityOf,
  diagramToAiEntities,
  tablesToDiagram,
  type ParsedTable,
} from '../shared/er-model';

const TABLES: ParsedTable[] = [
  {
    tableName: 't_class_info',
    tableComment: '班级',
    columns: [
      { name: 'class_id', comment: '班级ID', primaryKey: true, type: 'INT' },
      { name: 'class_name', comment: '班级名称', primaryKey: false, type: 'VARCHAR(50)' },
    ],
    foreignKeys: [],
  },
  {
    tableName: 't_student',
    tableComment: '学生',
    columns: [
      { name: 'student_id', comment: '学生ID', primaryKey: true, type: 'INT' },
      { name: 'class_id', comment: '班级ID', primaryKey: false, type: 'INT' },
    ],
    foreignKeys: [
      { name: 'fk_student_class', columns: ['class_id'], refTable: 't_class_info', refColumns: ['class_id'] },
    ],
  },
];

describe('tablesToDiagram', () => {
  it('表→实体、列→属性、外键→菱形联系', () => {
    const { diagram, warnings } = tablesToDiagram(TABLES, { showComment: true });
    expect(warnings).toHaveLength(0);

    const entities = diagram.nodes.filter((n) => n.type === 'entity');
    const attributes = diagram.nodes.filter((n) => n.type === 'attribute');
    const relationships = diagram.nodes.filter((n) => n.type === 'relationship');

    expect(entities.map((e) => e.name)).toEqual(['班级', '学生']);
    expect(attributes).toHaveLength(3);
    expect(relationships).toHaveLength(1);
    expect(relationships[0].name).toBe('fk_student_class');
  });

  it('外键列不再重复画成属性（主键列除外）', () => {
    const { diagram } = tablesToDiagram(TABLES, { showComment: true });
    expect(diagram.nodes.some((n) => n.id === 't_student#class_id')).toBe(false);
    // 主键仍然保留为属性
    expect(diagram.nodes.some((n) => n.id === 't_student#student_id')).toBe(true);
  });

  it('关联表（两个外键且未被引用）变成带属性的多对多联系', () => {
    const junction: ParsedTable[] = [
      {
        tableName: 'student',
        tableComment: '学生',
        columns: [{ name: 'id', comment: '', primaryKey: true, type: 'INT' }],
        foreignKeys: [],
      },
      {
        tableName: 'course',
        tableComment: '课程',
        columns: [{ name: 'id', comment: '', primaryKey: true, type: 'INT' }],
        foreignKeys: [],
      },
      {
        tableName: 'enrollment',
        tableComment: '选课',
        columns: [
          { name: 'id', comment: '', primaryKey: true, type: 'INT' },
          { name: 'student_id', comment: '', primaryKey: false, type: 'INT' },
          { name: 'course_id', comment: '', primaryKey: false, type: 'INT' },
          { name: 'score', comment: '成绩', primaryKey: false, type: 'DECIMAL' },
        ],
        foreignKeys: [
          { name: 'fk_stu', columns: ['student_id'], refTable: 'student', refColumns: ['id'] },
          { name: 'fk_course', columns: ['course_id'], refTable: 'course', refColumns: ['id'] },
        ],
      },
    ];

    const { diagram, warnings } = tablesToDiagram(junction, { showComment: true });
    expect(warnings).toHaveLength(0);

    const entities = diagram.nodes.filter((n) => n.type === 'entity');
    expect(entities.map((n) => n.name)).toEqual(['学生', '课程']);

    const rel = diagram.nodes.find((n) => n.type === 'relationship')!;
    expect(rel.id).toBe('assoc~enrollment');
    expect(rel.name).toBe('选课');

    const relAttrs = diagram.nodes.filter((n) => n.type === 'attribute' && n.parent === rel.id);
    expect(relAttrs.map((n) => n.name)).toEqual(['成绩']);

    const relLinks = diagram.links.filter((l) => l.type === 'relationship');
    expect(relLinks).toHaveLength(2);
    expect(relLinks.every((l) => l.text === 'N')).toBe(true);
  });

  it('外键两端基数为 N → 1', () => {
    const { diagram } = tablesToDiagram(TABLES, { showComment: true });
    const rel = diagram.nodes.find((n) => n.type === 'relationship')!;
    const edges = diagram.links.filter((l) => l.type === 'relationship' && (l.target === rel.id || l.source === rel.id));

    const fromStudent = edges.find((l) => l.source === 't_student');
    const toClass = edges.find((l) => l.target === 't_class_info');
    expect(fromStudent?.text).toBe('N');
    expect(toClass?.text).toBe('1');
  });

  it('主键属性带 isPrimaryKey 标记', () => {
    const { diagram } = tablesToDiagram(TABLES, { showComment: true });
    const pk = diagram.nodes.filter((n) => n.type === 'attribute' && n.isPrimaryKey);
    expect(pk.map((n) => n.name)).toEqual(['班级ID', '学生ID']);
  });

  it('显示英文名时不使用注释', () => {
    const { diagram } = tablesToDiagram(TABLES, { showComment: false });
    expect(diagram.nodes.filter((n) => n.type === 'entity').map((n) => n.name)).toEqual([
      't_class_info',
      't_student',
    ]);
  });

  it('外键指向未定义表时跳过并告警', () => {
    const broken: ParsedTable[] = [
      {
        tableName: 't_child',
        tableComment: '子',
        columns: [{ name: 'id', comment: '', primaryKey: true, type: 'INT' }],
        foreignKeys: [{ name: 'fk', columns: ['x'], refTable: 'ghost', refColumns: ['id'] }],
      },
    ];
    const { diagram, warnings } = tablesToDiagram(broken, { showComment: true });
    expect(diagram.nodes.filter((n) => n.type === 'relationship')).toHaveLength(0);
    expect(warnings[0]).toContain('ghost');
  });
});

describe('aiToDiagram', () => {
  it('三种关系基数映射正确', () => {
    const { diagram } = aiToDiagram({
      entities: [
        { name: '学生', attributes: [{ name: '学号', primaryKey: true }] },
        { name: '课程', attributes: [{ name: '课程号', primaryKey: true }] },
        { name: '班级', attributes: [{ name: '班级号', primaryKey: true }] },
        { name: '身份证', attributes: [{ name: '号码', primaryKey: true }] },
      ],
      relationships: [
        { source: '学生', target: '课程', type: 'manyToMany', text: '选修' },
        { source: '班级', target: '学生', type: 'oneToMany', text: '包含' },
        { source: '学生', target: '身份证', type: 'oneToOne', text: '持有' },
      ],
    });

    const relNodes = diagram.nodes.filter((n) => n.type === 'relationship');
    expect(relNodes.map((r) => r.name)).toEqual(['选修', '包含', '持有']);

    const cards = diagram.links.filter((l) => l.type === 'relationship').map((l) => l.text);
    expect(cards).toEqual(['N', 'M', '1', 'N', '1', '1']);
  });

  it('联系自带属性时挂到菱形上', () => {
    const { diagram } = aiToDiagram({
      entities: [
        { name: '学生', attributes: [] },
        { name: '课程', attributes: [] },
      ],
      relationships: [
        { source: '学生', target: '课程', type: 'manyToMany', text: '选修', attributes: [{ name: '成绩' }] },
      ],
    });
    const rel = diagram.nodes.find((n) => n.type === 'relationship')!;
    const attr = diagram.nodes.find((n) => n.type === 'attribute')!;
    expect(attr.parent).toBe(rel.id);
    expect(attr.name).toBe('成绩');
  });

  it('未知实体的联系被跳过并告警', () => {
    const { diagram, warnings } = aiToDiagram({
      entities: [{ name: '学生', attributes: [] }],
      relationships: [{ source: '学生', target: '不存在', type: 'oneToMany', text: '关联' }],
    });
    expect(diagram.nodes.filter((n) => n.type === 'relationship')).toHaveLength(0);
    expect(warnings.length).toBeGreaterThan(0);
  });
});

describe('cardinalityOf', () => {
  it('返回左右两端的基数', () => {
    expect(cardinalityOf('oneToOne')).toEqual({ left: '1', right: '1' });
    expect(cardinalityOf('oneToMany')).toEqual({ left: '1', right: 'N' });
    expect(cardinalityOf('manyToMany')).toEqual({ left: 'N', right: 'M' });
  });
});

describe('diagramToAiEntities', () => {
  it('从图中还原实体与属性，供 AI 补关系使用', () => {
    const { diagram } = tablesToDiagram(TABLES, { showComment: true });
    const entities = diagramToAiEntities(diagram);
    expect(entities).toHaveLength(2);
    expect(entities[0].name).toBe('班级');
    expect(entities[0].attributes.map((a) => a.name)).toEqual(['班级ID', '班级名称']);
  });
});
