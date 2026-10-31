SET NAMES utf8mb4;

-- 1. 简历
CREATE TABLE IF NOT EXISTS resumes (
  id BIGINT NOT NULL AUTO_INCREMENT COMMENT 'PK',
  access_count INT COMMENT '访问次数',
  analyze_error VARCHAR(500) COMMENT '分析错误',
  analyze_status VARCHAR(20) COMMENT '分析状态',
  content_type VARCHAR(255) COMMENT '内容类型',
  file_hash VARCHAR(64) NOT NULL COMMENT '文件哈希(UK)',
  file_size BIGINT COMMENT '文件大小',
  last_accessed_at DATETIME(6) COMMENT '最后访问',
  original_filename VARCHAR(255) NOT NULL COMMENT '原文件名',
  resume_text TEXT COMMENT '简历文本',
  storage_key VARCHAR(500) COMMENT '存储键',
  storage_url VARCHAR(1000) COMMENT '存储URL',
  uploaded_at DATETIME(6) NOT NULL COMMENT '上传时间',
  analyze_updated_at DATETIME(6) COMMENT '进展时间',
  analyze_recovery_count INT NOT NULL DEFAULT 0 COMMENT '恢复次数',
  analyze_attempt_id VARCHAR(36) COMMENT '执行代次',
  PRIMARY KEY (id),
  UNIQUE KEY idx_resume_hash (file_hash),
  KEY idx_resume_analyze_status_updated (analyze_status, analyze_updated_at),
  CONSTRAINT resumes_analyze_status_check
    CHECK (analyze_status IN ('PENDING','PROCESSING','COMPLETED','FAILED'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='简历';

-- 2. 简历分析
CREATE TABLE IF NOT EXISTS resume_analyses (
  id BIGINT NOT NULL AUTO_INCREMENT COMMENT 'PK',
  analyzed_at DATETIME(6) NOT NULL COMMENT '分析时间',
  content_score INT COMMENT '内容分',
  expression_score INT COMMENT '表达分',
  overall_score INT COMMENT '综合分',
  project_score INT COMMENT '项目分',
  skill_match_score INT COMMENT '技能分',
  strengths_json TEXT COMMENT '优势JSON',
  structure_score INT COMMENT '结构分',
  suggestions_json TEXT COMMENT '建议JSON',
  summary TEXT COMMENT '总结',
  resume_id BIGINT NOT NULL COMMENT 'FK简历',
  PRIMARY KEY (id),
  CONSTRAINT fkrp4f11h23bp0j118yan185lr5
    FOREIGN KEY (resume_id) REFERENCES resumes(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='简历分析';

-- 3. 文本面试会话
CREATE TABLE IF NOT EXISTS interview_sessions (
  id BIGINT NOT NULL AUTO_INCREMENT COMMENT 'PK',
  completed_at DATETIME(6) COMMENT '完成时间',
  created_at DATETIME(6) NOT NULL COMMENT '创建时间',
  current_question_index INT COMMENT '当前题号',
  difficulty VARCHAR(16) COMMENT '难度',
  evaluate_error VARCHAR(500) COMMENT '评估错误',
  evaluate_status VARCHAR(20) COMMENT '评估状态',
  improvements_json TEXT COMMENT '改进JSON',
  interview_category VARCHAR(64) COMMENT '面试方向',
  knowledge_base_id BIGINT COMMENT '知识库ID(逻辑)',
  llm_provider VARCHAR(50) COMMENT 'LLM提供方',
  overall_feedback TEXT COMMENT '整体反馈',
  overall_score INT COMMENT '整体分',
  questions_json TEXT COMMENT '题目JSON',
  reference_answers_json TEXT COMMENT '答案JSON',
  resume_id BIGINT COMMENT 'FK简历',
  session_id VARCHAR(36) NOT NULL COMMENT '业务会话ID(UK)',
  skill_id VARCHAR(64) COMMENT '技能ID',
  source_type VARCHAR(32) COMMENT '来源类型',
  status VARCHAR(20) COMMENT '会话状态',
  strengths_json TEXT COMMENT '优势JSON',
  total_questions INT COMMENT '总题数',
  request_id VARCHAR(64) COMMENT '幂等键(UK)',
  PRIMARY KEY (id),
  UNIQUE KEY uk42bhenf7mu90ochoc1efpg3xa (session_id),
  UNIQUE KEY uk_interview_sessions_request_id (request_id),
  KEY idx_interview_session_resume_created (resume_id, created_at),
  KEY idx_interview_session_resume_status_created (resume_id, status, created_at),
  KEY idx_interview_session_skill_created (skill_id, created_at),
  CONSTRAINT interview_sessions_evaluate_status_check
    CHECK (evaluate_status IN ('PENDING','PROCESSING','COMPLETED','FAILED')),
  CONSTRAINT interview_sessions_status_check
    CHECK (status IN ('CREATED','IN_PROGRESS','COMPLETED','EVALUATED')),
  CONSTRAINT fkhresfe6p1s53klvmqhxxissa2
    FOREIGN KEY (resume_id) REFERENCES resumes(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='文本面试会话';

-- 4. 文本面试回答
CREATE TABLE IF NOT EXISTS interview_answers (
  id BIGINT NOT NULL AUTO_INCREMENT COMMENT 'PK',
  answered_at DATETIME(6) NOT NULL COMMENT '回答时间',
  category VARCHAR(255) COMMENT '分类',
  feedback TEXT COMMENT '反馈',
  key_points_json TEXT COMMENT '关键点JSON',
  question TEXT COMMENT '题目',
  question_index INT COMMENT '题号',
  reference_answer TEXT COMMENT '参考答案',
  score INT COMMENT '评分',
  user_answer TEXT COMMENT '用户回答',
  session_id BIGINT NOT NULL COMMENT 'FK会话',
  PRIMARY KEY (id),
  UNIQUE KEY uk_interview_answer_session_question (session_id, question_index),
  CONSTRAINT fkjeqvvamvdarrcbswn6kkiuym9
    FOREIGN KEY (session_id) REFERENCES interview_sessions(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='文本面试回答';

-- 5. 知识库
CREATE TABLE IF NOT EXISTS knowledge_bases (
  id BIGINT NOT NULL AUTO_INCREMENT COMMENT 'PK',
  access_count INT COMMENT '访问次数',
  category VARCHAR(100) COMMENT '分类',
  chunk_count INT COMMENT '分块数',
  content_type VARCHAR(255) COMMENT '内容类型',
  file_hash VARCHAR(64) NOT NULL COMMENT '文件哈希(UK)',
  file_size BIGINT COMMENT '文件大小',
  last_accessed_at DATETIME(6) COMMENT '最后访问',
  name VARCHAR(255) NOT NULL COMMENT '名称',
  original_filename VARCHAR(255) NOT NULL COMMENT '原文件名',
  question_count INT COMMENT '题目数',
  storage_key VARCHAR(500) COMMENT '存储键',
  storage_url VARCHAR(1000) COMMENT '存储URL',
  uploaded_at DATETIME(6) NOT NULL COMMENT '上传时间',
  vector_error VARCHAR(500) COMMENT '向量错误',
  vector_status VARCHAR(20) COMMENT '向量状态',
  question_gen_status VARCHAR(20) NOT NULL DEFAULT 'NONE' COMMENT '出题状态',
  question_gen_error VARCHAR(500) COMMENT '出题错误',
  question_gen_task_id VARCHAR(36) COMMENT '出题任务ID',
  question_gen_config TEXT COMMENT '出题配置',
  question_gen_message VARCHAR(500) COMMENT '出题消息',
  question_gen_saved_count INT NOT NULL DEFAULT 0 COMMENT '已存题数',
  question_gen_skipped_count INT NOT NULL DEFAULT 0 COMMENT '跳过题数',
  question_gen_updated_at DATETIME(6) COMMENT '出题更新时间',
  vector_config TEXT COMMENT '分块快照',
  vectorized_at DATETIME(6) COMMENT '向量完成时间',
  vector_updated_at DATETIME(6) COMMENT '向量进展时间',
  vector_recovery_count INT NOT NULL DEFAULT 0 COMMENT '恢复次数',
  vector_attempt_id VARCHAR(36) COMMENT '执行代次',
  PRIMARY KEY (id),
  UNIQUE KEY idx_kb_hash (file_hash),
  KEY idx_kb_category (category),
  KEY idx_kb_question_gen_status_updated (question_gen_status, question_gen_updated_at),
  KEY idx_kb_vector_status_updated (vector_status, vector_updated_at),
  CONSTRAINT knowledge_bases_vector_status_check
    CHECK (vector_status IN ('PENDING','PROCESSING','COMPLETED','FAILED')),
  CONSTRAINT knowledge_bases_question_gen_status_check
    CHECK (question_gen_status IN ('NONE','QUEUED','PROCESSING','COMPLETED','FAILED'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='知识库';

-- 6. 知识库题目
CREATE TABLE IF NOT EXISTS knowledge_base_questions (
  id BIGINT NOT NULL AUTO_INCREMENT COMMENT 'PK',
  category VARCHAR(64) COMMENT '分类',
  created_at DATETIME(6) NOT NULL COMMENT '创建时间',
  difficulty VARCHAR(16) COMMENT '难度',
  follow_ups_json TEXT COMMENT '追问JSON',
  kb_content_hash VARCHAR(64) COMMENT '内容哈希',
  key_points_json TEXT COMMENT '关键点JSON',
  knowledge_base_id BIGINT COMMENT 'FK知识库',
  question TEXT NOT NULL COMMENT '题目',
  reference_answer TEXT COMMENT '参考答案',
  scoring_rubric TEXT COMMENT '评分标准',
  skill_id VARCHAR(64) NOT NULL COMMENT '技能ID',
  source_context TEXT COMMENT '来源上下文',
  status VARCHAR(20) NOT NULL COMMENT '题目状态',
  topic_summary VARCHAR(300) COMMENT '主题摘要',
  type VARCHAR(64) COMMENT '题目类型',
  updated_at DATETIME(6) NOT NULL COMMENT '更新时间',
  PRIMARY KEY (id),
  KEY idx_kb_question_kb_status (knowledge_base_id, status),
  KEY idx_kb_question_skill_difficulty (skill_id, difficulty),
  CONSTRAINT knowledge_base_questions_status_check
    CHECK (status IN ('DRAFT','ACTIVE','ARCHIVED','STALE')),
  CONSTRAINT fkosobqu06r3tbr13ca043slftw
    FOREIGN KEY (knowledge_base_id) REFERENCES knowledge_bases(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='知识库题目';

-- 7. RAG会话
CREATE TABLE IF NOT EXISTS rag_chat_sessions (
  id BIGINT NOT NULL AUTO_INCREMENT COMMENT 'PK',
  created_at DATETIME(6) NOT NULL COMMENT '创建时间',
  is_pinned TINYINT(1) DEFAULT 0 COMMENT '置顶',
  message_count INT COMMENT '消息数',
  status VARCHAR(20) COMMENT '会话状态',
  title VARCHAR(255) NOT NULL COMMENT '标题',
  updated_at DATETIME(6) COMMENT '更新时间',
  PRIMARY KEY (id),
  KEY idx_rag_session_updated (updated_at),
  CONSTRAINT rag_chat_sessions_status_check
    CHECK (status IN ('ACTIVE','ARCHIVED'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='RAG会话';

-- 8. RAG消息
CREATE TABLE IF NOT EXISTS rag_chat_messages (
  id BIGINT NOT NULL AUTO_INCREMENT COMMENT 'PK',
  completed TINYINT(1) COMMENT '完成',
  content TEXT NOT NULL COMMENT '内容',
  created_at DATETIME(6) NOT NULL COMMENT '创建时间',
  message_order INT NOT NULL COMMENT '顺序号',
  `type` VARCHAR(20) NOT NULL COMMENT '消息类型',
  updated_at DATETIME(6) COMMENT '更新时间',
  session_id BIGINT NOT NULL COMMENT 'FK会话',
  PRIMARY KEY (id),
  KEY idx_rag_message_order (session_id, message_order),
  KEY idx_rag_message_session (session_id),
  CONSTRAINT rag_chat_messages_type_check
    CHECK (`type` IN ('USER','ASSISTANT')),
  CONSTRAINT fkfohypaygc0qfqo62vyaxlbntn
    FOREIGN KEY (session_id) REFERENCES rag_chat_sessions(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='RAG消息';

-- 9. RAG会话-知识库
CREATE TABLE IF NOT EXISTS rag_session_knowledge_bases (
  session_id BIGINT NOT NULL COMMENT 'PK,FK会话',
  knowledge_base_id BIGINT NOT NULL COMMENT 'PK,FK知识库',
  PRIMARY KEY (session_id, knowledge_base_id),
  CONSTRAINT fkqfob368wcvb82elsjkx2troqu
    FOREIGN KEY (session_id) REFERENCES rag_chat_sessions(id),
  CONSTRAINT fkjsfwqyt1ntgr0fcvjieq8c0nb
    FOREIGN KEY (knowledge_base_id) REFERENCES knowledge_bases(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='RAG会话知识库';

-- 10. 向量存储
CREATE TABLE IF NOT EXISTS vector_store (
  id CHAR(36) NOT NULL DEFAULT (UUID()) COMMENT 'PK',
  content TEXT COMMENT '内容',
  metadata JSON COMMENT '元数据',
  embedding JSON COMMENT '向量数组',
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='向量存储';

-- 11. 语音面试会话
CREATE TABLE IF NOT EXISTS voice_interview_sessions (
  id BIGINT NOT NULL AUTO_INCREMENT COMMENT 'PK',
  actual_duration INT COMMENT '实际时长',
  created_at DATETIME(6) COMMENT '创建时间',
  current_phase VARCHAR(255) COMMENT '当前阶段',
  custom_jd_text TEXT COMMENT 'JD文本',
  difficulty VARCHAR(16) COMMENT '难度',
  end_time DATETIME(6) COMMENT '结束时间',
  evaluate_error VARCHAR(500) COMMENT '评估错误',
  evaluate_status VARCHAR(255) COMMENT '评估状态',
  hr_enabled TINYINT(1) COMMENT 'HR开关',
  intro_enabled TINYINT(1) COMMENT '介绍开关',
  llm_provider VARCHAR(50) COMMENT 'LLM提供方',
  paused_at DATETIME(6) COMMENT '暂停时间',
  planned_duration INT COMMENT '计划时长',
  project_enabled TINYINT(1) COMMENT '项目开关',
  resume_id BIGINT COMMENT '简历ID(逻辑)',
  resumed_at DATETIME(6) COMMENT '恢复时间',
  role_type VARCHAR(255) NOT NULL COMMENT '角色类型',
  skill_id VARCHAR(64) COMMENT '技能ID',
  start_time DATETIME(6) COMMENT '开始时间',
  status VARCHAR(255) COMMENT '会话状态',
  tech_enabled TINYINT(1) COMMENT '技术开关',
  updated_at DATETIME(6) COMMENT '更新时间',
  user_id VARCHAR(255) COMMENT '用户ID(逻辑)',
  PRIMARY KEY (id),
  CONSTRAINT voice_interview_sessions_current_phase_check
    CHECK (current_phase IN ('INTRO','TECH','PROJECT','HR','COMPLETED')),
  CONSTRAINT voice_interview_sessions_evaluate_status_check
    CHECK (evaluate_status IN ('PENDING','PROCESSING','COMPLETED','FAILED')),
  CONSTRAINT voice_interview_sessions_status_check
    CHECK (status IN ('IN_PROGRESS','PAUSED','COMPLETED','FAILED'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='语音面试会话';

-- 12. 语音面试消息
CREATE TABLE IF NOT EXISTS voice_interview_messages (
  id BIGINT NOT NULL AUTO_INCREMENT COMMENT 'PK',
  ai_generated_text TEXT COMMENT 'AI文本',
  created_at DATETIME(6) COMMENT '创建时间',
  message_type VARCHAR(255) NOT NULL COMMENT '消息类型',
  phase VARCHAR(255) COMMENT '阶段',
  sequence_num INT COMMENT '序号',
  session_id BIGINT COMMENT '会话ID(逻辑)',
  `timestamp` DATETIME(6) COMMENT '时间戳',
  user_recognized_text TEXT COMMENT '识别文本',
  summary_covered_sequence_num INT COMMENT '摘要覆盖序号',
  PRIMARY KEY (id),
  KEY idx_voice_messages_session_seq (session_id, sequence_num),
  CONSTRAINT voice_interview_messages_phase_check
    CHECK (phase IN ('INTRO','TECH','PROJECT','HR','COMPLETED'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='语音面试消息';

-- 13. 语音面试评估
CREATE TABLE IF NOT EXISTS voice_interview_evaluations (
  id BIGINT NOT NULL AUTO_INCREMENT COMMENT 'PK',
  created_at DATETIME(6) COMMENT '创建时间',
  improvements_json TEXT COMMENT '改进JSON',
  interview_date DATETIME(6) COMMENT '面试日期',
  interviewer_role VARCHAR(255) COMMENT '面试官角色',
  overall_feedback TEXT COMMENT '整体反馈',
  overall_score INT COMMENT '整体分',
  question_evaluations_json TEXT COMMENT '题目评估JSON',
  reference_answers_json TEXT COMMENT '答案JSON',
  session_id BIGINT COMMENT '会话ID(UK,逻辑)',
  strengths_json TEXT COMMENT '优势JSON',
  PRIMARY KEY (id),
  UNIQUE KEY ukijx8aelak8vqf9n4to88qqrna (session_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='语音面试评估';