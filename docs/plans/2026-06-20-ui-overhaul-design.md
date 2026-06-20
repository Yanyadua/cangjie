# UI 全面重塑设计:白板工作台风(方案 A)

> 日期:2026-06-20
> 范围:纯前端视觉与交互重塑,后端 API 与类型契约零改动
> 设计方向:Heptabase 暖基调 + Linear 工具感,亮色优先、主题跟随系统、桌面优先

## 1. 背景与现状

当前前端功能完整,但**没有设计系统**:9 个页面、5 个组件里的样式全部是内联 `style={{...}}`,颜色(`#3b82f6`、`#e2e8f0` 等)散落各处、硬编码;`index.css` 只有基础 reset;仅亮色主题;无组件库、无设计 token、无统一空/加载/错误状态。

技术栈:React 18 + TypeScript + Vite + `@xyflow/react`(React Flow)+ react-router-dom + axios。

## 2. 设计目标

- 建立单一来源的设计 token(颜色/字号/圆角/阴影),亮暗双主题
- 让「导入表单、历史列表、图谱画布、问答」四种异构界面**视觉同源**
- 主题跟随系统并可手动切换(系统 / 亮 / 暗)
- 干掉全部内联 style,迁移到 Tailwind class
- 应用全程可运行,分阶段安全迁移

## 3. 技术架构与工程落地

### 3.1 样式链路

```
src/styles/globals.css   ← 唯一真源:CSS 变量 token(亮/暗两套)
        ↓
tailwind @theme          ← 映射成 tailwind class(bg-bg / text-muted …)
        ↓
src/components/ui/*      ← shadcn 组件(Button/Card/Dialog/Command…)
src/pages, src/components ← 业务页面用 tailwind class,不再写内联 style
```

### 3.2 新增目录结构(在现有基础上增量)

```
frontend/src/
  styles/globals.css          ← 新增:token + tailwind 入口
  lib/
    utils.ts                  ← 新增:cn() class 合并
    theme-provider.tsx        ← 新增:主题 Provider
    use-theme.ts              ← 新增:useTheme() hook
  components/
    ui/                       ← 新增:shadcn 组件源码
    layout/                   ← 新增:AppShell / TopBar / Sidebar / CommandPalette
    (GraphEditor / NodeInspector … 保留,只换样式)
  pages/                      ← 原有 9 页逐页迁移
```

### 3.3 主题机制

三态:`system`(默认,跟随 `prefers-color-scheme`) / `light` / `dark`,选择存 `localStorage`。
- Provider 在 `<html>` 上切换 `class="dark"`
- 顶栏放三态切换器(☀️ / 🌙 / 🖥️)
- React Flow 用 `colorMode="system"` 自动跟随,无需手动同步
- `index.html` 加挂载前内联脚本,读 localStorage 先设好 class,防 FOUC

### 3.4 依赖增量

```
tailwindcss@^4  @tailwindcss/vite
class-variance-authority  clsx  tailwind-merge   (shadcn 三件套)
lucide-react  cmdk  @radix-ui/*(按需)
sonner  (toast)
```

`react / react-router-dom / @xyflow/react / axios` 全保留。`api/client.ts`、`types/*` **完全不改**。

## 4. 设计 Token(唯一真源)

### 4.1 背景与表面

| token | 亮色 | 暗色 | 用途 |
|---|---|---|---|
| `--bg` | `#FAF7F2` | `#1A1714` | app 底色 |
| `--surface` | `#FFFFFF` | `#242019` | 卡片/面板/输入框 |
| `--surface-2` | `#F3EEE6` | `#2E2922` | hover、次级区块 |
| `--border` | `#E8E1D6` | `#3A332A` | 默认描边 |
| `--border-strong` | `#D4CBBE` | `#4D453A` | 聚焦/强分隔 |

### 4.2 文字

| token | 亮色 | 暗色 | 用途 |
|---|---|---|---|
| `--text` | `#2A2520` | `#F0EBE2` | 正文 |
| `--text-muted` | `#6B6358` | `#B5AC9E` | 次要说明 |
| `--text-subtle` | `#9B9286` | `#847B6E` | 占位符/元信息 |

### 4.3 强调色

| token | 亮色 | 暗色 | 用途 |
|---|---|---|---|
| `--accent` | `#E8943B` | `#F0A85C` | 主按钮/链接/选中 |
| `--accent-hover` | `#D4824A` | `#F5B874` | hover |
| `--accent-soft` | `#FBEDD8` | `#3A2A1B` | 选中底色/tag 底 |
| `--accent-fg` | `#FFFFFF` | `#1A1714` | 强调色上的字 |
| `--teal` | `#4FB3A9` | `#5FC7BC` | 辅助 |

### 4.4 语义色(暖调)

| token | 亮色 | 暗色 |
|---|---|---|
| `--success` | `#5B9F5B` | `#7AB87A` |
| `--warning` | `#E8A93B` | `#F0BC5C` |
| `--danger` | `#D26B5B` | `#E08575` |
| `--ring` | = accent | = accent |

### 4.5 图谱节点色(暖系,映射到现有 `NODE_COLORS`)

| 节点类型 | 亮色 | 暗色 |
|---|---|---|
| concept 概念 | `#E8943B` | `#F0A85C` |
| entity 实体 | `#4FB3A9` | `#5FC7BC` |
| argument 论点 | `#9B7BC4` | `#AC92D6` |
| evidence 证据 | `#9B8B7A` | `#B3A696` |
| topic/cluster | `#D26B5B` | `#E08575` |

> 实施时读 `src/types/graph.ts` 确认全部节点类型,对齐到本表。

### 4.6 字体与字号

```
--font-sans: Inter, -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif
--font-mono: 'JetBrains Mono', ui-monospace, SFMono-Regular, monospace

Display 24/700/32  ·  H2 18/600/28  ·  H3 15/600/22
Body 14/400/22  ·  Small 13/400/20  ·  Caption 12/500/16  ·  Code 13 mono
```

### 4.7 圆角(白板风偏大)

```
sm 6px  ·  md 10px  ·  lg 14px  ·  xl 20px(白板大卡片/节点/modal)  ·  pill 999px
```

### 4.8 阴影(暖色 tint,hover 琥珀微光)

```
亮色: sm 0 1px 2px rgba(42,37,32,.04)
      md 0 2px 8px rgba(42,37,32,.06), 0 1px 2px rgba(42,37,32,.04)
      lg 0 8px 24px rgba(42,37,32,.08), 0 2px 6px rgba(42,37,32,.05)
      lift 0 12px 32px rgba(232,148,59,.10)
暗色: sm/md/lg 用 rgba(0,0,0,.4/.5/.6);lift 0 12px 32px rgba(240,168,92,.15)
```

### 4.9 层级 z-index

```
base 0 · sticky 10 · dropdown 30 · drawer 40 · modal 50 · command 60 · toast 70
```

## 5. 全局布局与导航(AppShell)

### 5.1 结构

```
┌─────────────────────────────────────────────────────────────┐
│  ◉ Personal KB      [  ⌘K  搜索一切…  ]       🌙  ⚙         │ ← TopBar 56px
├──────────┬──────────────────────────────────────────────────┤
│  📥 导入 │                                                  │
│  🕘 历史 │            主内容区                              │
│  🌐 图谱 │            (表单型 880px 居中 / 画布型全屏)       │
│  🔍 搜索 │                                                  │
│  💬 问答 │                                                  │
│  ─────── │                                                  │
│  最近…   │                                                  │
│   « 收起 │                                                  │
└──────────┴──────────────────────────────────────────────────┘
   Sidebar 240px(展开) / 56px(收起,仅图标)
```

### 5.2 TopBar

左侧品牌(回首页)· 中间命令面板触发器(点击或 `⌘K`)· 右侧主题三态切换器 + 设置。

### 5.3 Sidebar

主导航(导入/历史/图谱/搜索/问答,当前页 3px 琥珀左条 + soft 底)+ 分隔 + 「最近」列表(来自历史 API,点击跳草稿/详情)+ 折叠按钮。收起态仅图标 + tooltip。**画布类页面进入时自动收起**。

### 5.4 ⌘K 命令面板

`cmdk` 实现,键盘全流程。分组:跳转页面 / 操作 / 搜索节点(接现有搜索 API)/ 最近历史。方向键导航,`↵` 执行,`Esc` 关闭。**无新后端**。

### 5.5 主内容区宽度策略

| 类型 | 宽度 | 页面 |
|---|---|---|
| 表单/阅读型 | `max-width: 880px` 居中 | 导入、搜索、问答 |
| 画布/全屏型 | 撑满,侧栏自动收起 | 全局图谱、草稿图谱、抽取向导、插入/聚类提案、历史 |

### 5.6 页面切换动效

路由切换:新页 `opacity 0→1` + `translateY(4px→0)`,150ms ease-out。CSS 过渡,不引 framer-motion。

### 5.7 键盘快捷键

`⌘K` 命令面板 · `⌘\` 收起/展开侧栏 · `⌘1~5` 跳主导航 · `⌘,` 设置 · `Esc` 关闭面板。

## 6. 组件清单

### 6.1 shadcn 组件(按需)

Button · Card(核心)· Input/Textarea/Label/Select · Tabs · Dialog/Sheet · Command(cmdk)· DropdownMenu · Tooltip · Badge · Separator/ScrollArea · Skeleton · Progress · Alert · Sonner(toast)

### 6.2 共享原语:卡片 = 节点

```
╭───────────────────────────╮
│▎◉ 概念                     │  ← 3px 左色条(类型色)+ 类型 Badge
│   机器学习                  │  ← 标题 14/600
│   让计算机从数据中学习…      │  ← 描述 12 muted,2 行截断
│   ──────────────────       │
│   ● 12 关联   ✦ 85% 置信   │  ← meta 行
╰───────────────────────────╯
 radius-xl · surface 底 · shadow-sm · hover→shadow-lift+translateY(-2px)
```

**该卡片同时用作 React Flow 自定义节点**——列表页和图谱页的节点视觉一致。这是方案 A 的灵魂。

### 6.3 九页改造

| 页面 | 新设计要点 |
|---|---|
| 导入 | 居中 Card(880px),分区表单,错误用 Alert,字段用 Input/Textarea,Button 带 spinner;导入后直跳向导 |
| 抽取向导 | 顶部 Progress + Tabs,每 stage 一张 Card,「上一步/下一步」 |
| 历史 | 卡片网格(2~3 列),Tabs(全部/待确认/已入库)+ 过滤,右键 DropdownMenu |
| 草稿图谱 | 画布全屏 + 右侧 Sheet 抽屉 inspector,节点用卡片样式 |
| 插入提案 | 每条 Card,diff 式 Badge 标色,接受/拒绝 Button 组 |
| 聚类提案 | 同插入提案,聚类用圆角容器框住成员 |
| 全局图谱 | **门面页**:自定义卡片节点 + 暖色画布,Tabs(力导向/聚类),左下图例,点击节点弹 Sheet |
| 搜索 | 居中 Input + 卡片结果列表,匹配片段高亮 + 来源 Badge |
| 问答 | 对话式:消息气泡(用户 accent-soft 右 / AI surface 左),引用节点做可点 Badge |

### 6.4 原有组件去留

`GraphEditor` 保留改样式(主题变量 + 卡片节点 + `colorMode="system"`)· `NodeInspector/EdgeInspector` 保留,改成 Sheet 抽屉 · `ProposalPanel` 改成 Card 列表 · `SearchResults` 改成卡片列表。

### 6.5 状态规范(补齐)

| 状态 | 规范 |
|---|---|
| 加载 | Skeleton 骨架屏 + 按钮 spinner |
| 空 | 插画位 + 一句话 + 主 CTA |
| 错误 | Alert(区块级)+ Sonner toast(操作反馈) |
| 确认 | Dialog 弹窗(替代 `window.confirm`) |

## 7. 迁移策略(分阶段、应用始终可运行)

### Phase 0 · 基建搭建(视觉零变化)
装依赖、写 `globals.css` + `theme-provider` + `cn()`、`index.html` 防闪脚本。验证:`build` 过、老页不变。✅ commit

### Phase 1 · AppShell 外壳(内容页暂不动)
建 AppShell/TopBar/Sidebar/CommandPalette/主题切换,路由包进壳。验证:导航/切换生效。✅ commit

### Phase 2 · 共享原语(不动业务)
shadcn CLI 拉基础组件 + 建节点卡片。✅ commit

### Phase 3 · 逐页迁移(每页一 commit,先易后难)
① 导入 → ② 搜索+结果 → ③ 问答 → ④ 历史 → ⑤ 插入/聚类提案 → ⑥ 抽取向导 → ⑦ 草稿图谱 → ⑧ 全局图谱(最后)。
每页动作:删内联 style→Tailwind class、换 shadcn 组件、补 loading/empty/error 三态。

### Phase 4 · 收尾
路由动效、快捷键、空状态/骨架屏、双主题视觉 QA。✅ 最终 commit

## 8. 验证标准(每步的「完成」定义)

- `npm run build`(tsc + vite 构建)绿——硬门
- `npm run dev` 起得来,无控制台报错
- 涉及页面在亮 + 暗两主题下各目检,图谱能渲染
- 当前阶段不改的页面行为不变

仓库无前端单测,本次不加(YAGNI)。验证靠构建门 + 人工双主题目检。后端契约零改动,功能回归风险低。

## 9. 风险与对策

| 风险 | 对策 |
|---|---|
| Tailwind v4 与内联 style 共存 | 安全:Tailwind 只作用于带 class 的元素 |
| React Flow 换肤搞坏画布 | 排最后迁移,token 已被简单页验证;`colorMode="system"` + 节点色变量 |
| shadcn 对 Tailwind v4 配置 | 用 shadcn CLI 拉组件,自动生成正确配置 |
| 主题 FOUC | `index.html` 挂载前内联脚本 |
| 范围蔓延 | 严格只做 UI |

## 10. 明确不做(YAGNI)

- ❌ 移动端/平板适配
- ❌ 国际化框架(保持中文)
- ❌ 后端 / API / 类型改动
- ❌ 新功能(纯视觉与交互重塑)
- ❌ 单元测试框架
- ❌ framer-motion(CSS 过渡足够)
