# Personal Knowledge Base v1.0

一个支持人工校正的增量式个人知识图谱系统。

## 解决什么问题

传统笔记软件只解决"存储"和"编辑"。普通 RAG 系统只解决"问答"。本系统解决的是**知识进入后的自动组织**。

## 核心流程

```
导入文章 → 自动图化和向量化 → 用户可视化检查和拖拽修改
  → 确认入库 → 系统检索全局知识库 → 找到合适位置
  → 插入文章节点 → 更新相关局部知识图谱
```

## 为什么不是普通 RAG

系统不是把文章切 chunk 丢进向量库，而是把每篇文章转成两类结构：
- **语义向量结构**：用于检索、相似度匹配
- **显式图谱结构**：用于表达概念、实体、论点、关系和证据

## 为什么不是普通笔记软件

系统不是按文件夹分类，而是通过语义检索和图谱匹配找到新知识在全局知识网络中的位置。每篇文章自动生成局部图谱，用户可视化校正后以 graph patch 方式更新全局图谱。

## 技术栈

- **后端**: Python + FastAPI + SQLAlchemy + pgvector
- **前端**: React + TypeScript + React Flow
- **数据库**: PostgreSQL
- **LLM**: OpenAI-compatible API

## 本地启动

### 前置条件

- Python 3.10+
- Node.js 18+
- PostgreSQL 15+ (with pgvector extension)
- LLM API key (OpenAI-compatible)

### 后端

```bash
cd backend
cp .env.example .env
# 编辑 .env 填入数据库连接和 API key
pip install -r requirements.txt
uvicorn app.main:app --reload
```

### 前端

```bash
cd frontend
npm install
npm run dev
```

## 完整使用流程

1. 打开 http://localhost:5173
2. 在导入页面粘贴一篇文章，点击 **导入并生成图谱**
3. 系统自动生成文章局部知识图谱
4. 在图谱编辑器中拖拽、修改节点和关系
5. 点击 **确认图谱**
6. 查看系统生成的插入建议
7. 点击 **确认应用**
8. 进入全局图谱页面查看结果

## 项目结构

```
personal-kb-v1/
  backend/          # FastAPI 后端
    app/
      api/          # API 路由
      core/         # 核心模块 (LLM, embedding, chunker, etc.)
      models/       # 数据模型
      services/     # 业务逻辑
  frontend/         # React 前端
    src/
      api/          # API 客户端
      components/   # 图编辑器等组件
      pages/        # 页面
      types/        # TypeScript 类型
```
