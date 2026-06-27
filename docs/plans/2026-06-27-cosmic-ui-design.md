# 宇宙化知识图谱 UI 设计稿

> **For Claude:** 本文档是 brainstorming 产出，供 writing-plans skill 据此拆实施计划。

**目标**：把 `GlobalGraphPage` 改造成沉浸式宇宙视图。个人节点是黑洞（重做真实版），分区是星系，点击星系进入螺旋星云内部，每颗星是一篇文章。

**架构**：r3f (react-three-fiber) + three.js + d3-force-3d 物理仿真 + framer-motion 过渡。新增 `/cosmos` 和 `/galaxy/:id` 两个路由替换 `/graph`。`RadialKnowledgeGraph` 保留作为降级 fallback。

**技术栈**：three、@react-three/fiber、@react-three/drei、@react-three/postprocessing、d3-force-3d、@tanstack/react-query、stats.js（dev）、framer-motion。

---

## §1 — 整体架构

```
App.tsx (现有 React Router)
  /cosmos           ← 替换 /graph
  /galaxy/:id       ← 新增
  其他 11 个路由不动
```

### `/cosmos`

```
<CosmosPage>
  <CosmosCanvas>                ← r3f + three.js + d3-force-3d
    <StarfieldBg/>              ← 背景星点层（持久化）
    <BlackHole/>                ← 中心黑洞 ShaderMaterial
    <GalaxyNode/>×N             ← 分区=星系（力学仿真分布）
    <CosmosEffects/>            ← Bloom + Vignette 后处理
  </CosmosCanvas>
  <CosmosOverlay>               ← HTML 层
    <SearchInput/>
    <Legend/>
    <EmptyState/>
  </CosmosOverlay>
</CosmosPage>
```

### `/galaxy/:id`

```
<GalaxyPage>
  <GalaxyCanvas>                ← 独立 3D 场景
    <NebulaBg/>                 ← 星云背景（按 partition 配色）
    <PartitionCore/>            ← 分区中心核
    <TopicCluster/>×M           ← topic 星团（含子 article 星）
    <SpiralArms/>               ← 螺旋臂粒子流
    <CosmosEffects/>
  </GalaxyCanvas>
  <GalaxyOverlay>
    <Breadcrumb/>               ← 宇宙 › 当前星系
    <TopicInspector/>           ← 点击 topic 星弹出
    <ArticleSheet/>             ← 点击 article 星弹出（复用现有）
  </GalaxyOverlay>
</GalaxyPage>
```

### 关键决策

1. **新增 2 个路由，删除 1 个**：`/graph` → `/cosmos`，新增 `/galaxy/:id`。`RadialKnowledgeGraph.tsx` 保留作为降级 fallback。
2. **场景隔离**：两个 3D 场景不共享 instance，路由切换时 unmount 旧场景、mount 新场景。
3. **过渡动画**：路由切换时 framer-motion AnimatePresence 做 fade + scale 1.2s 过渡，期间 `StarfieldBg` 持久化（提升到 AppShell 之外的全局层）。
4. **HTML/3D 分层**：3D canvas 全屏铺满，HTML overlay 用 `position: absolute` 浮在上层。
5. **数据契约不变**：后端 `/graph/global?filter_type=partition` 和 `/graph/article/:id` 完全复用，不动 API。

---

## §2 — 视觉系统

### 2.1 颜色调色板（globals.css 新增）

```css
:root {
  /* 宇宙专用 token */
  --space-deep:    #050208;   /* 最深背景 */
  --space-mid:     #0d0617;   /* 星云中段 */
  --nebula-purple: #4c1d95;   /* 星云紫（复用 black-hole halo） */
  --nebula-amber:  #f59e0b;   /* 吸积盘琥珀 */
  --star-white:    #fef3c7;   /* 恒星白 */
  --star-blue:     #93c5fd;   /* 蓝矮星 */
  --star-red:      #fca5a5;   /* 红巨星 */

  /* 复用现有 --node-person/partition/topic/article */
}
```

### 2.2 节点配色映射

| 层 | 节点类型 | 颜色 | 视觉 |
|----|---------|------|------|
| L0 | 黑洞 | 黑 + 琥珀环 | 120px ShaderMaterial（详见 §2.6） |
| L1 | 星系 | `--node-partition` 紫 | 60px 旋臂粒子团 + 中心亮核 |
| L2 | 主题星团 | `--node-topic` 蓝 | 25px 发光圆 + 周围 3-8 颗文章星 |
| L3 | 文章星 | `--node-article` 青 | 6px 发光点 + hover 时光晕扩散 |

### 2.3 星云背景（持久化全局层）

三层视差：
- 远景：2000 颗灰白星点，视差 0.1×
- 中景：800 颗蓝白星点 + 5 团紫色 nebula 云，视差 0.3×
- 近景：200 颗琥珀星点，视差 0.6×

鼠标移动 → 整层反向偏移 8-15px。

### 2.4 后处理

- **Bloom**：`@react-three/postprocessing`，阈值 0.6，强度 0.8。
- **Vignette**：边缘暗角 0.4。
- **不**用 SSAO/HDR/色彩分级（开销过大且与暖色 token 冲突）。

### 2.5 与现有设计系统兼容

- HTML 层（搜索框、Sheet、图例、EmptyState）继续用 shadcn + 现有 token。
- AppShell 不动。
- 主题切换（light/dark/system）保留。light 模式下星点变淡、星云变白。

---

## §2.6 — 黑洞重做（替换现有 CSS 版）

现有 CSS 版"假"：渐变像 PPT、没有引力透镜、旋转像 2D 转盘、没有真实吸积盘的温度梯度。

### 实现路径：r3f ShaderMaterial（屏幕空间）

每个片元发射一条光线，经过黑洞引力场弯曲后命中吸积盘或背景星空。经典 Schwarzschild 黑洞 2D 投影。

### 着色器 5 大真实感要素

| 要素 | 物理原理 | 视觉效果 |
|------|---------|---------|
| 事件视界 | 光线被捕获 | 中心绝对黑（30px 半径） |
| 光子环 | 光绕视界绕一圈 | 视界外侧 1.5px 极亮细环（白热） |
| 引力透镜 | 背景光线弯曲 | 背后星空在视界附近"被吸"成圆弧 |
| 多普勒增益 | 朝向我们一侧蓝移变亮 | 吸积盘左半 #fef3c7、右半 #b91c1c |
| 温度梯度 | 内侧引力强温度高 | 内缘白热→中段琥珀→外缘暗红 |

### 关键 GLSL 参数

```glsl
#define EVENT_HORIZON_R   0.30   // 视界半径（归一化）
#define PHOTON_SPHERE_R   0.33   // 光子环
#define DISK_INNER_R      0.35   // 吸积盘内缘
#define DISK_OUTER_R      1.00   // 吸积盘外缘
#define DOPPLER_STRENGTH  0.6    // 多普勒增益强度
#define DISK_INNER_SPEED  4.0    // 内侧旋转秒/圈
#define DISK_OUTER_SPEED  30.0   // 外侧旋转秒/圈（开普勒）

// 温度梯度色板
inner:  #fef3c7   // 白热
mid:    #f59e0b   // 琥珀
outer:  #7c2d12   // 暗红
```

### 动画

- 吸积盘旋转：内侧 4s/圈、外侧 30s/圈（开普勒近似）
- 整体自转：30s/圈（Lense-Thirring 参考系拖曳）
- 鼠标移动影响相机角度 ±2°，引力透镜效果轻微变化
- `prefers-reduced-motion`：吸积盘旋转停，仅保留静态外观

### 性能预算

- ShaderMaterial 单次 draw call，全屏 1 quad
- 着色器复杂度：~80 ALU ops/fragment
- 1080p 预估：0.3ms/frame（M1 Mac），1.2ms/frame（老 Intel 集显）
- 不需要后处理 Bloom（着色器自带亮度堆积）

### 与场景其他元素交互

- Hover 黑洞 → 相机俯角 +5°、放大 1.05×
- Click 黑洞 → 重置相机
- 鼠标在黑洞附近 → 附近星系产生"被吸引"偏移（d3-force radialForce 临时项）

---

## §3 — 交互流程

### 3.1 `/cosmos` 视图交互

| 对象 | Hover | Click | Drag | 双击 |
|------|-------|-------|------|------|
| 黑洞 | 相机俯角 +5°、放大 1.05× | 重置相机 | 拖拽相机 orbit | — |
| 星系 (L1) | 节点放大 1.2× + tooltip | **跳转 `/galaxy/:id`** | 拖拽节点 | 锁定/解锁位置 |
| 背景星点 | 视差偏移 | — | 拖拽相机 | — |
| 空白处 | — | 框选（Shift） | 拖拽相机 | fitView |
| 主题星团 (L2) | 高亮 + tooltip | 跳转 `/galaxy/:pid` 并聚焦 | — | — |
| 文章星 (L3) | tooltip | 跳转 `/galaxy/:pid` 并打开 ArticleSheet | — | — |

**默认 `/cosmos` 只显示 L0+L1**。L2/L3 默认不可见，搜索时从所属星系射出光柱指示位置。

### 3.2 `/galaxy/:id` 视图交互

默认进入：相机从星系外缘推进到俯角 25°（1.2s easeInOutCubic）。

| 对象 | Hover | Click | Drag |
|------|-------|-------|------|
| Partition 核 | tooltip（名 + article 数） | 全屏震撼镜头（相机绕 360°） | — |
| 主题星团 (L2) | 星团亮起 + tooltip | 展开/收起 article 子星 | 拖拽重分布 |
| 文章星 (L3) | 标题 tooltip + 摘要前 50 字 | **打开 ArticleSheet** | — |
| 螺旋臂粒子 | — | — | — |
| 空白处 | — | 取消高亮 | 拖拽相机 orbit |

### 3.3 搜索行为（两视图通用）

```
输入 → 200ms 防抖 → 后端 /nodes/search
                     ↓
           非匹配节点 opacity → 0.2
           匹配节点叠加脉冲发光环
           相机自动平滑移到匹配节点中心
           多匹配：相机拉远框住全部
```

`/cosmos` 搜到 article/topic：所属星系射出光柱。

### 3.4 力学仿真交互

- **拖拽节点**：`fx/fy/fz` 固定，松开 200ms 缓动回弹
- **Hover 星系**：朝向相机的弱力
- **Hover 黑洞**：附近 200px 星系受额外径向吸引
- **空闲 30s**：低速模式（×0.3 力）
- **窗口失焦**：暂停（visibilitychange）

### 3.5 过渡动画细节

**`/cosmos` → `/galaxy/:id`**：
```
t=0ms       click
t=0-50ms    星系放大 1.5× + cinematic bars
t=50-200ms  相机 dolly-in
t=200-1000ms fade cosmos → galaxy canvas
t=1000-1200ms galaxy 相机推进到俯角 25°
t=1200ms    移除 cinematic bars
```

反向同上。`prefers-reduced-motion`：所有过渡降到 200ms fade only。

### 3.6 键盘快捷键

| 键 | 行为 |
|----|------|
| `/` | 聚焦搜索框 |
| `Esc` | 清除搜索 / 关闭 Sheet / 取消高亮 |
| `G` 然后 `B` | 回到 `/cosmos` |
| `F` | fitView |
| `+`/`-` | 相机缩放 |
| `R` | 重置力学仿真 |
| `?` | 显示快捷键面板 |

### 3.7 移动端适配

- 不做专门移动端宇宙 UI
- `pointer: coarse` 或屏宽 <768 → 自动降级 RadialKnowledgeGraph

---

## §4 — 状态机与数据流

### 4.1 视图状态机（useReducer）

```
idle → loading → ready
              ↘ error (重试 N 次后) → degraded (RadialKnowledgeGraph)
ready → focused / interacting / searching / disposed
```

各状态 UI 反馈：

| 状态 | 3D canvas | HTML overlay |
|------|-----------|--------------|
| idle | 黑色 + 星点 | (空) |
| loading | 黑洞预渲染 + 星点 | LoadingSkeleton |
| ready | 完整场景 | 搜索框、图例、面包屑 |
| error | 黑洞 + 星点（无星系） | Alert + 重试 |
| degraded | 不挂载 canvas | RadialKnowledgeGraph 全屏 |

### 4.2 力学仿真状态机

```
cold → running → boost (hover)
              → paused (visibilitychange)
              → lowspeed (30s 空闲, ×0.3 力, 30fps)
```

### 4.3 相机状态机

```ts
type CameraState =
  | { kind: 'default'; fov: 50 }
  | { kind: 'focused'; targetId: string; fov: 35 }
  | { kind: 'transition'; from, to, t: 0..1 }
  | { kind: 'cinematic'; centerId: string; orbiting: true }
  | { kind: 'user-orbit' }
```

### 4.4 数据流

```
1. /cosmos 进入 → getGlobalGraph('partition') (已有 API)
2. 数据变换 (lib/cosmos-mappers.ts 新建)
   GraphData → CosmosScene
   ├─ blackHole: { id, name }
   ├─ galaxies: partitions.map(...)
   └─ edges: 仅保留 root 边
3. d3-force-3d 仿真初始化
   .force('charge', -200).force('radial', 0, 0.05).force('center')
   黑洞节点固定 { fx:0, fy:0, fz:0 }
   预热 300 tick
4. /galaxy/:id 进入 → getPartitionChildren(id) (已有 API)
5. 数据变换 → GalaxyScene
   ├─ partitionCore
   ├─ topicClusters (对数螺线布局)
   └─ articleStars (展开时显示)
```

### 4.5 数据缓存（@tanstack/react-query）

| 数据 | 策略 | 失效 |
|------|------|------|
| `/cosmos` 全图 | SWR 5min | 路由焦点重回时 refetch |
| `/galaxy/:id` | SWR 10min | partition 重命名/article 加删 |
| 文章子图 | 内存 cache by article_id | Sheet 关闭即释放 |
| 搜索结果 | 不缓存 | — |

### 4.6 实时更新

| 用户动作 | 后端变化 | 前端响应 |
|---------|---------|---------|
| 导入新文章 | Node/Edge 新增 | react-query 自动 refetch |
| `/merge` 合并 | source status=merged | 同上 |
| partition 重命名 | Node.name 更新 | useMutation + optimistic update |

### 4.7 错误处理

| 错误 | 表现 | 恢复 |
|------|------|------|
| WebGL 不可用 | degraded → RadialKnowledgeGraph | 自动 |
| API 5xx | error + Alert | 用户重试 |
| 着色器编译失败 | 退化 CSS 黑洞 | 自动 |
| 仿真数值爆炸 | 节点 NaN | 重新初始化仿真 |

---

## §5 — 降级与性能

### 5.1 三级降级路径

```
WebGL2 可用？
├── 高端 GPU → Tier 1: 完整 r3f + 物理仿真 + Bloom + 引力透镜着色器
├── 中端 GPU → Tier 2: r3f + 物理仿真 ×0.6 + 无 Bloom + 简化黑洞
└── 低端 GPU → Tier 3: r3f 静态布局（无仿真）+ 简化黑洞
WebGL2 不可用？
├── Canvas 2D → Tier 4: Canvas 2D 静态星空 + DOM 节点
└── 都不可用 → Tier 5: 现有 RadialKnowledgeGraph
```

### 5.2 GPU 等级检测（`lib/gpu-tier.ts` 新建）

```ts
function detectGpuTier(): 1 | 2 | 3 | 4 | 5 {
  const gl = canvas.getContext('webgl2');
  if (!gl) return checkCanvas2D() ? 4 : 5;

  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  const renderer = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL);

  if (/Apple M[1-9]/.test(renderer)) return 1;
  if (/RTX|Radeon RX|Arc A/.test(renderer)) return 1;
  if (/Intel Iris|Apple GPU/.test(renderer)) return 2;
  if (/Intel HD|Intel UHD|Mali|Adreno 6/.test(renderer)) return 3;

  const fps = benchmarkShader(gl);
  if (fps >= 55) return 1;
  if (fps >= 40) return 2;
  if (fps >= 25) return 3;
  return 4;
}
```

### 5.3 各 Tier 视觉差异

| 视觉要素 | Tier 1 | Tier 2 | Tier 3 | Tier 4 | Tier 5 |
|---------|--------|--------|--------|--------|--------|
| 黑洞 | 引力透镜着色器 | 简化着色器 | CSS 三层 | Canvas 2D | 现有 CSS |
| 力学仿真 | 实时 | ×0.6 / 30fps | 启动后冻结 | 静态布局 | React Flow |
| 星点背景 | 3000 三层 | 1500 两层 | 800 单层 | 500 | — |
| Bloom | ✓ | ✗ | ✗ | ✗ | ✗ |
| 节点数上限 | 200 | 100 | 50 | 不限 | 不限 |
| 过渡动画 | 1.2s 相机运动 | 600ms fade | 200ms fade | 即时 | 即时 |
| 目标帧率 | 60fps | 60fps | 30fps | 60fps | 60fps |

### 5.4 力学仿真性能调优

**问题**：d3-force-3d 默认 O(n²)，200 节点每 tick = 40000 ops。

**优化**：
1. **降维计算**：z 当 ±10 扰动，force 算 2D。`-40%`。
2. **alpha decay 加速**：默认 0.0228 → 0.05，5 秒收敛停止。`-90% 长期`。
3. **节点数上限**：60 星系（按 articleCount 排序，其余合并为"其他"虚拟星系）。
4. **预热 + 冻结**：300 tick（~200ms）取最终位置，渲染静止。`-95% 常驻`。
5. **Web Worker**：仿真放主线程外。

**预算**：
- 进入页面：200ms 预热（Worker）
- 稳定状态：0 ops/frame
- Hover：~10k ops 总

### 5.5 着色器性能调优

| 优化项 | 效果 |
|-------|------|
| 屏幕空间 2D 投影（非 ray march 全场景） | 着色器只算 1 quad |
| ray march 步长 0.05，最多 20 步 | ≤ 100 ops/fragment |
| 阈值早退（命中视界立即 return） | 50% 片元提前退出 |
| 内置温度色板 LUT | 查表替代计算 |
| 重编译缓存 | 第二次进入 0ms |
| shader 注入 raw 字符串，不走 r3f reconciler | 启动 -50ms |

M1 Mac 1080p 目标：黑洞 0.3ms/frame，整个 `/cosmos` ≤ 3ms/frame。

### 5.6 内存管理

r3f unmount 必须 dispose：

```ts
useEffect(() => () => {
  scene.traverse(obj => {
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) {
      if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
      else obj.material.dispose();
    }
  });
  renderer.dispose();
}, []);
```

`StarfieldBg` 持久层不跟随路由 dispose，跟随 AppShell 生命周期。

### 5.7 节点数量防御

| 场景 | 上限 | 超出处理 |
|------|------|---------|
| `/cosmos` 星系 | 60 | 按 articleCount 排序，剩余合并"其他" |
| `/galaxy` topic | 30 | 排序，剩余隐藏可搜索 |
| `/galaxy` article | 200 | 警告 + 折叠低优先级 topic |
| 单 topic article | 50 | 自动分页 |

### 5.8 帧率监控（dev）

`stats.js` 仅 dev 模式挂载，生产构建剥离。

### 5.9 性能验收

| 指标 | Tier 1 (M1) | Tier 2 (Iris) | Tier 3 (Intel HD) |
|------|-------------|----------------|--------------------|
| `/cosmos` 首屏 TTI | < 1.5s | < 2.5s | < 4s |
| 稳定帧率 | 60fps | 60fps | 30fps |
| 交互延迟 | < 16ms | < 16ms | < 33ms |
| 路由切换 | 1.2s | 800ms | 300ms |
| 内存峰值 | < 150MB | < 100MB | < 80MB |

---

## §6 — 实施切片与工作量

### Milestone 0 — 基建（1 天）

| 任务 | 文件 |
|------|------|
| 安装依赖 | `package.json` 加 three、@react-three/fiber、@react-three/drei、@react-three/postprocessing、d3-force-3d、@tanstack/react-query、stats.js |
| GPU tier 检测 | `lib/gpu-tier.ts` |
| WebGL2 不可用降级 | `CosmosPage` 入口分流 |
| 路由占位 | `pages/CosmosPage.tsx`、`pages/GalaxyPage.tsx` |
| `/graph` 重定向 | `App.tsx` `<Navigate to="/cosmos"/>` |
| 全局 StarfieldBg 持久层 | `AppShell` 外包一层 |
| 移除旧 RadialKnowledgeGraph 入口（保留组件） | `GlobalGraphPage` 删除 |

**交付**：`/cosmos` 显示全黑背景 + 星点 + "建设中"占位。WebGL 不可用自动跳到 RadialKnowledgeGraph。

### Milestone 1 — 黑洞着色器 + `/cosmos` 静态版（2 天）

| 任务 | 风险 |
|------|------|
| 黑洞 ShaderMaterial（视界+光子环+吸积盘+多普勒） | 🔴 高 |
| 简化版黑洞 shader（Tier 3 用） | 🟡 中 |
| 星系节点（Drei Billboard + 粒子团） | 🟢 低 |
| 星系静态布局（圆形分布） | 🟢 低 |
| Hover/Click 交互 | 🟢 低 |
| HTML overlay（搜索、图例、空态、错误态） | 🟢 低 |
| 视觉 token：宇宙色板 | 🟢 低 |

**交付**：`/cosmos` 完整可用，可点击星系跳转。

### Milestone 2 — `/galaxy/:id` 视图（2 天）

| 任务 | 风险 |
|------|------|
| 螺旋臂布局（对数螺线 `r=a·e^(b·θ)`） | 🟡 中 |
| Partition 核 + Topic 星团 + Article 星组件 | 🟢 低 |
| 默认折叠 article，点击 topic 展开 | 🟢 低 |
| 星云背景（按 partition 配色） | 🟢 低 |
| 面包屑导航 | 🟢 低 |
| ArticleSheet 复用 | 🟢 低 |
| 进入/退出过渡（1.2s） | 🟡 中 |
| 相机自动聚焦 | 🟡 中 |

**交付**：完整"宇宙 → 星系"两视图切换体验。

### Milestone 3 — 力学仿真（2 天）

| 任务 | 风险 |
|------|------|
| d3-force-3d 集成 | 🟡 中 |
| Web Worker 包装 | 🔴 高 |
| 预热 300 tick + 冻结策略 | 🟡 中 |
| 拖拽节点（fx/fy/fz 固定 + 缓动回弹） | 🟡 中 |
| Hover 黑洞 → 附近星系径向吸引 | 🟢 低 |
| 空闲 30s → 低速模式 | 🟢 低 |
| 仿真数值爆炸保护 | 🟡 中 |

**交付**：节点自然分布，鼠标交互有引力感，主线程永不卡顿。

### Milestone 4 — 视觉打磨 + 后处理（1.5 天）

| 任务 | 风险 |
|------|------|
| Bloom 后处理 | 🟢 低 |
| Vignette | 🟢 低 |
| 多普勒/光子环细节微调 | 🟡 中 |
| `prefers-reduced-motion` | 🟢 低 |
| 鼠标视差（StarfieldBg） | 🟢 低 |
| Tier 3 简化 shader 路径打通 | 🟡 中 |

**交付**：最终视觉，与设计稿一致。

### Milestone 5 — 降级完善 + 验收（1.5 天）

| 任务 | 风险 |
|------|------|
| Tier 4：Canvas 2D fallback | 🟡 中 |
| 节点数上限防御 | 🟢 低 |
| 移动端检测 + 自动降级 | 🟢 低 |
| Stats.js dev 模式 | 🟢 低 |
| 性能基准测试（M1/Iris/Intel HD） | 🟡 中 |
| 全量手测 | 🟢 低 |
| 内存泄漏检测 | 🟡 中 |

**交付**：可上线。

### 总工作量

| Milestone | 工作量 | 累计 |
|-----------|--------|------|
| M0 基建 | 1 天 | 1 天 |
| M1 黑洞 + /cosmos | 2 天 | 3 天 |
| M2 /galaxy | 2 天 | 5 天 |
| M3 力学仿真 | 2 天 | 7 天 |
| M4 视觉打磨 | 1.5 天 | 8.5 天 |
| M5 降级 + 验收 | 1.5 天 | 10 天 |

### 关键风险

1. **黑洞着色器（M1）**：GLSL 经验要求高，调试难。
2. **Web Worker 仿真（M3）**：数据序列化 + 帧同步容易出 bug。

### 依赖关系

- M0 必须先完成
- M1-M2 可串行
- M3 依赖 M1 完成
- M4-M5 必须最后
