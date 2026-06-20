# UI Overhaul (Warm-Whiteboard / Plan A) — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Reskin the entire frontend into a warm-whiteboard design system (Heptabase + Linear hybrid) with design tokens, light/dark theme (follows system), AppShell, ⌘K command palette, and per-page migration off inline styles — with zero backend/API changes.

**Architecture:** Tailwind v4 (CSS-first, tokens as CSS variables) + shadcn/ui (copy-in components) + a `ThemeProvider` controlling `class="dark"` on `<html>`. A single `NodeCard` primitive is shared between list pages and React Flow custom nodes, so "list item" and "graph node" look identical. Migration is phased: foundation → shell → shared primitives → 9 pages (easy→hard) → polish. App stays runnable; every task ends in a commit.

**Tech Stack:** React 18, TypeScript, Vite 5, `@xyflow/react` v12 (kept), Tailwind CSS v4, shadcn/ui (Radix + cva + clsx + tailwind-merge), lucide-react, cmdk, sonner.

**Design reference:** `docs/plans/2026-06-20-ui-overhaul-design.md` (approved). All token values live there and in `globals.css`.

---

## Verification convention (no test framework — by design)

This is a pure UI reskin. The repo has no frontend test runner and we are **not** adding one (YAGNI). Each task's verification is the **build gate + visual check**:

- **Build gate:** `cd frontend && npm run build` MUST succeed (`tsc` type-check + `vite build`). This is the hard pass/fail signal.
- **Visual check:** `npm run dev`, open the affected page, confirm it renders in **both** light and dark themes; confirm pages not touched this task still render unchanged.
- **Graph specifically:** whenever a task touches the graph, confirm the React Flow canvas still renders nodes/edges.

Do not claim a task done without running the build gate and seeing it pass.

---

## Phase 0 · Foundation (no visual change yet)

### Task 0.1 — Add `@/*` path alias

shadcn requires `@/*` → `src/*`. Add it to TS config and Vite.

**Files:**
- Modify: `frontend/tsconfig.json`
- Modify: `frontend/vite.config.ts`

**Step 1:** In `tsconfig.json`, inside `compilerOptions`, add:
```json
"baseUrl": ".",
"paths": { "@/*": ["./src/*"] }
```

**Step 2:** In `vite.config.ts`, add path resolution. Install `@types/node` first (needed for `path`):
```bash
cd frontend && npm install -D @types/node
```
Then rewrite `vite.config.ts`:
```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  server: {
    port: 5173,
    proxy: { '/api': { target: 'http://localhost:8000', changeOrigin: true } },
  },
});
```

**Step 3 — Verify:** `cd frontend && npm run build` → must pass.

**Step 4 — Commit:**
```bash
git add frontend/tsconfig.json frontend/vite.config.ts frontend/package.json frontend/package-lock.json
git commit -m "build: add @/* path alias for shadcn/ui"
```

---

### Task 0.2 — Install dependencies

**Files:** `frontend/package.json` (via npm).

**Step 1:** Run:
```bash
cd frontend && npm install \
  tailwindcss@^4 @tailwindcss/vite \
  class-variance-authority clsx tailwind-merge \
  lucide-react cmdk sonner \
  @radix-ui/react-dialog @radix-ui/react-tabs @radix-ui/react-tooltip \
  @radix-ui/react-dropdown-menu @radix-ui/react-separator @radix-ui/react-slot \
  @radix-ui/react-progress @radix-ui/react-label
```
(Add more `@radix-ui/*` only when a shadcn component added in Phase 2 needs it.)

**Step 2 — Verify:** `npm run build` passes.

**Step 3 — Commit:**
```bash
git add frontend/package.json frontend/package-lock.json
git commit -m "build: add tailwind v4, shadcn helpers, radix, cmdk, sonner"
```

---

### Task 0.3 — Write `globals.css` with all design tokens

The single source of truth. Light values in `:root`, dark in `.dark`. Maps all **14** node types from `frontend/src/types/graph.ts:162-177` to warm CSS variables.

**Files:**
- Create: `frontend/src/styles/globals.css`

**Step 1:** Create the file with this exact content:

```css
@import "tailwindcss";

/* ============================================================
   Theme tokens — single source of truth
   (see docs/plans/2026-06-20-ui-overhaul-design.md §4)
   ============================================================ */

@theme inline {
  --color-bg: var(--bg);
  --color-surface: var(--surface);
  --color-surface-2: var(--surface-2);
  --color-border: var(--border);
  --color-border-strong: var(--border-strong);
  --color-text: var(--text);
  --color-text-muted: var(--text-muted);
  --color-text-subtle: var(--text-subtle);
  --color-accent: var(--accent);
  --color-accent-hover: var(--accent-hover);
  --color-accent-soft: var(--accent-soft);
  --color-accent-fg: var(--accent-fg);
  --color-teal: var(--teal);
  --color-success: var(--success);
  --color-warning: var(--warning);
  --color-danger: var(--danger);
  --color-ring: var(--ring);

  --radius-sm: 6px;
  --radius-md: 10px;
  --radius-lg: 14px;
  --radius-xl: 20px;

  --font-sans: Inter, -apple-system, BlinkMacSystemFont, 'PingFang SC',
    'Microsoft YaHei', 'Segoe UI', Roboto, sans-serif;
  --font-mono: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
}

:root {
  --bg: #faf7f2;
  --surface: #ffffff;
  --surface-2: #f3eee6;
  --border: #e8e1d6;
  --border-strong: #d4cbbe;
  --text: #2a2520;
  --text-muted: #6b6358;
  --text-subtle: #9b9286;
  --accent: #e8943b;
  --accent-hover: #d4824a;
  --accent-soft: #fbedd8;
  --accent-fg: #ffffff;
  --teal: #4fb3a9;
  --success: #5b9f5b;
  --warning: #e8a93b;
  --danger: #d26b5b;
  --ring: var(--accent);

  --shadow-sm: 0 1px 2px rgba(42, 37, 32, 0.04);
  --shadow-md: 0 2px 8px rgba(42, 37, 32, 0.06), 0 1px 2px rgba(42, 37, 32, 0.04);
  --shadow-lg: 0 8px 24px rgba(42, 37, 32, 0.08), 0 2px 6px rgba(42, 37, 32, 0.05);
  --shadow-lift: 0 12px 32px rgba(232, 148, 59, 0.10);

  /* node colors (all 14 types from types/graph.ts) */
  --node-article: #4fb3a9;
  --node-concept: #e8943b;
  --node-claim: #d26b5b;
  --node-topic: #9b7bc4;
  --node-person: #c98b6b;
  --node-organization: #6b8fa8;
  --node-paper: #5b9f8c;
  --node-project: #b8893f;
  --node-framework: #a87bb0;
  --node-tool: #db7b6b;
  --node-method: #8b9a77;
  --node-technology: #3fa38b;
  --node-question: #c4863b;
  --node-chunk: #9b8b7a;
}

.dark {
  --bg: #1a1714;
  --surface: #242019;
  --surface-2: #2e2922;
  --border: #3a332a;
  --border-strong: #4d453a;
  --text: #f0ebe2;
  --text-muted: #b5ac9e;
  --text-subtle: #847b6e;
  --accent: #f0a85c;
  --accent-hover: #f5b874;
  --accent-soft: #3a2a1b;
  --accent-fg: #1a1714;
  --teal: #5fc7bc;
  --success: #7ab87a;
  --warning: #f0bc5c;
  --danger: #e08575;
  --ring: var(--accent);

  --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.4);
  --shadow-md: 0 2px 8px rgba(0, 0, 0, 0.5);
  --shadow-lg: 0 8px 24px rgba(0, 0, 0, 0.6);
  --shadow-lift: 0 12px 32px rgba(240, 168, 92, 0.15);

  --node-article: #5fc7bc;
  --node-concept: #f0a85c;
  --node-claim: #e08575;
  --node-topic: #ac92d6;
  --node-person: #d89b7e;
  --node-organization: #82a3bc;
  --node-paper: #6fb3a0;
  --node-project: #c99a52;
  --node-framework: #bc92c4;
  --node-tool: #e88e7e;
  --node-method: #9dad89;
  --node-technology: #52b59e;
  --node-question: #d69752;
  --node-chunk: #b3a696;
}

* { margin: 0; padding: 0; box-sizing: border-box; }

html, body, #root { height: 100%; }

body {
  font-family: var(--font-sans);
  color: var(--text);
  background: var(--bg);
  -webkit-font-smoothing: antialiased;
}

input, textarea, select, button { font-family: inherit; }

/* React Flow: theme-aware via CSS vars (see Task 3.8) */
.react-flow { background: var(--bg); }

/* page transition (see Task 4.1) */
@keyframes page-in {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: translateY(0); }
}
.page-enter { animation: page-in 150ms ease-out; }
```

**Step 2 — Verify:** file exists; `npm run build` passes (Tailwind scans but nothing uses classes yet — fine).

**Step 3 — Commit:**
```bash
git add frontend/src/styles/globals.css
git commit -m "feat(ui): add globals.css with full design token set (light+dark)"
```

---

### Task 0.4 — Wire Tailwind v4 + repoint entry import

**Files:**
- Modify: `frontend/vite.config.ts` (add `@tailwindcss/vite` plugin)
- Modify: `frontend/src/main.tsx` (import `globals.css` instead of `index.css`)
- Delete: `frontend/src/index.css` (its reset moved into `globals.css`)

**Step 1:** Add the plugin in `vite.config.ts`:
```ts
import tailwindcss from '@tailwindcss/vite';
// ...
plugins: [react(), tailwindcss()],
```

**Step 2:** In `frontend/src/main.tsx:4`, change:
```ts
import './styles/globals.css';
```

**Step 3:** Delete `frontend/src/index.css` (its 17 lines are now superseded by `globals.css`).

**Step 4 — Verify:** `npm run build` passes; `npm run dev` shows the app unchanged visually (old inline styles still drive the look).

**Step 5 — Commit:**
```bash
git add frontend/vite.config.ts frontend/src/main.tsx frontend/src/index.css
git commit -m "build: wire tailwind v4; repoint entry to globals.css"
```

---

### Task 0.5 — `cn()` utility

**Files:** Create `frontend/src/lib/utils.ts`

**Step 1:** Create file:
```ts
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Resolve a node type to its CSS variable color, e.g. var(--node-concept). */
export function nodeColorVar(nodeType: string): string {
  return `var(--node-${nodeType ?? 'chunk'})`;
}
```

**Step 2 — Verify:** `npm run build` passes.

**Step 3 — Commit:**
```bash
git add frontend/src/lib/utils.ts
git commit -m "feat(ui): add cn() and nodeColorVar() helpers"
```

---

### Task 0.6 — Theme provider + `useTheme` hook

**Files:**
- Create: `frontend/src/lib/theme-provider.tsx`
- Create: `frontend/src/lib/use-theme.ts`

**Step 1:** Create `theme-provider.tsx`:
```tsx
import { createContext, useEffect, useState, type ReactNode } from 'react';

export type Theme = 'system' | 'light' | 'dark';

type Ctx = { theme: Theme; setTheme: (t: Theme) => void; resolved: 'light' | 'dark' };
const ThemeContext = createContext<Ctx | null>(null);
const STORAGE_KEY = 'kb-theme';

function systemPrefersDark() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function applyDark(on: boolean) {
  document.documentElement.classList.toggle('dark', on);
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(
    () => (localStorage.getItem(STORAGE_KEY) as Theme) || 'system',
  );

  const resolved: 'light' | 'dark' =
    theme === 'system' ? (systemPrefersDark() ? 'dark' : 'light') : theme;

  useEffect(() => {
    applyDark(resolved === 'dark');
  }, [resolved]);

  useEffect(() => {
    if (theme !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => applyDark(mq.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [theme]);

  const setTheme = (t: Theme) => {
    localStorage.setItem(STORAGE_KEY, t);
    setThemeState(t);
  };

  return (
    <ThemeContext.Provider value={{ theme, setTheme, resolved }}>
      {children}
    </ThemeContext.Provider>
  );
}
```

**Step 2:** Create `use-theme.ts`:
```ts
import { useContext } from 'react';
import { ThemeContext, type Theme } from './theme-provider';

export function useTheme(): { theme: Theme; setTheme: (t: Theme) => void; resolved: 'light' | 'dark' } {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
```

**Step 3 — Verify:** `npm run build` passes.

**Step 4 — Commit:**
```bash
git add frontend/src/lib/theme-provider.tsx frontend/src/lib/use-theme.ts
git commit -m "feat(ui): add ThemeProvider with system/light/dark"
```

---

### Task 0.7 — Anti-FOUC script + wrap App in ThemeProvider

Sets the `dark` class before React mounts (no flash).

**Files:**
- Modify: `frontend/index.html`
- Modify: `frontend/src/main.tsx`

**Step 1:** In `frontend/index.html`, replace the `<body>` block with:
```html
<body>
  <script>
    (function () {
      try {
        var t = localStorage.getItem('kb-theme');
        var dark =
          t === 'dark' ||
          (!t && window.matchMedia('(prefers-color-scheme: dark)').matches);
        if (dark) document.documentElement.classList.add('dark');
      } catch (e) {}
    })();
  </script>
  <div id="root"></div>
  <script type="module" src="/src/main.tsx"></script>
</body>
```

**Step 2:** In `frontend/src/main.tsx`, wrap `<App />` in `<ThemeProvider>`:
```tsx
import { ThemeProvider } from './lib/theme-provider';
// ...
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </React.StrictMode>,
);
```

**Step 3 — Verify:** `npm run build` passes; `npm run dev`, open DevTools → `<html>` has `class="dark"` only if your OS is in dark mode (or set `localStorage['kb-theme']='dark'` and reload — class appears with no flash).

**Step 4 — Commit:**
```bash
git add frontend/index.html frontend/src/main.tsx
git commit -m "feat(ui): add anti-FOUC script and mount ThemeProvider"
```

---

## Phase 1 · AppShell (new chrome; old pages sit inside untouched)

> Old pages still use inline styles during this phase — that's fine, they render inside the shell.

### Task 1.1 — `ThemeToggle`

**Files:** Create `frontend/src/components/layout/ThemeToggle.tsx`

**Step 1:** Create file:
```tsx
import { Sun, Moon, Monitor } from 'lucide-react';
import { useTheme } from '@/lib/use-theme';
import { cn } from '@/lib/utils';
import type { Theme } from '@/lib/theme-provider';

const ORDER: Theme[] = ['system', 'light', 'dark'];
const ICON = { system: Monitor, light: Sun, dark: Moon } as const;

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const Icon = ICON[theme];
  const next = ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length];
  return (
    <button
      type="button"
      aria-label={`主题：${theme}，点击切换到 ${next}`}
      onClick={() => setTheme(next)}
      className="inline-flex h-9 w-9 items-center justify-center rounded-md text-text-muted hover:bg-surface-2 hover:text-text transition-colors"
    >
      <Icon className="h-[18px] w-[18px]" />
    </button>
  );
}
```

> **Note:** `text-text-muted` / `bg-surface-2` rely on the `@theme inline` mapping from Task 0.3 (`--color-text-muted` etc.). If a class doesn't resolve, confirm the `@theme inline` block lists it.

**Step 2 — Verify:** `npm run build` passes.

**Step 3 — Commit:**
```bash
git add frontend/src/components/layout/ThemeToggle.tsx
git commit -m "feat(ui): add ThemeToggle (system/light/dark cycle)"
```

---

### Task 1.2 — `TopBar`

**Files:** Create `frontend/src/components/layout/TopBar.tsx`

**Step 1:** Create file:
```tsx
import { Search, Settings } from 'lucide-react';
import { ThemeToggle } from './ThemeToggle';

export function TopBar({ onOpenCommand }: { onOpenCommand: () => void }) {
  return (
    <header className="flex h-14 items-center gap-4 border-b border-border bg-surface px-5">
      <div className="mr-4 flex items-center gap-2 font-bold text-text">
        <span className="text-accent">◉</span> Personal KB
      </div>
      <button
        type="button"
        onClick={onOpenCommand}
        className="flex flex-1 items-center gap-2 rounded-md border border-border bg-surface-2 px-3 py-1.5 text-sm text-text-subtle hover:border-border-strong transition-colors"
      >
        <Search className="h-4 w-4" />
        <span>搜索一切…</span>
        <kbd className="ml-auto rounded border border-border bg-surface px-1.5 text-[11px] text-text-muted">⌘K</kbd>
      </button>
      <ThemeToggle />
      <button className="inline-flex h-9 w-9 items-center justify-center rounded-md text-text-muted hover:bg-surface-2">
        <Settings className="h-[18px] w-[18px]" />
      </button>
    </header>
  );
}
```

**Step 2 — Verify:** `npm run build` passes.

**Step 3 — Commit:**
```bash
git add frontend/src/components/layout/TopBar.tsx
git commit -m "feat(ui): add TopBar with command trigger + theme toggle"
```

---

### Task 1.3 — `Sidebar` (with recent list)

**Files:** Create `frontend/src/components/layout/Sidebar.tsx`

**Step 1:** Create file. Recent list uses existing `getDocuments` API (`frontend/src/api/client.ts:24`).
```tsx
import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import {
  PanelLeftClose, PanelLeftOpen, Upload, Clock, Network, Search, MessageSquare,
} from 'lucide-react';
import { getDocuments, type DocumentResponse } from '@/api/client';
import { cn } from '@/lib/utils';

const NAV = [
  { to: '/import', label: '导入', icon: Upload },
  { to: '/history', label: '历史', icon: Clock },
  { to: '/graph', label: '全局图谱', icon: Network },
  { to: '/search', label: '搜索', icon: Search },
  { to: '/ask', label: '问答', icon: MessageSquare },
];

export function Sidebar({
  collapsed, onToggleCollapsed, autoHide,
}: { collapsed: boolean; onToggleCollapsed: (v: boolean) => void; autoHide: boolean }) {
  const [recent, setRecent] = useState<DocumentResponse[]>([]);
  useEffect(() => {
    getDocuments(0, 8).then((d: DocumentResponse[]) => setRecent(d)).catch(() => {});
  }, []);
  const collapsedNow = collapsed || autoHide;

  return (
    <aside
      className={cn(
        'flex flex-col border-r border-border bg-surface transition-[width] duration-150',
        collapsedNow ? 'w-14' : 'w-60',
      )}
    >
      <nav className="flex flex-col gap-1 p-2">
        {NAV.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium border-l-2 border-transparent',
                collapsedNow && 'justify-center px-0',
                isActive
                  ? 'bg-accent-soft text-accent border-l-accent'
                  : 'text-text-muted hover:bg-surface-2 hover:text-text',
              )
            }
          >
            <Icon className="h-[18px] w-[18px] shrink-0" />
            {!collapsedNow && <span>{label}</span>}
          </NavLink>
        ))}
      </nav>

      {!collapsedNow && (
        <div className="mt-2 flex-1 overflow-y-auto px-3">
          <div className="px-2 pb-1 text-xs font-medium text-text-subtle">最近</div>
          {recent.map((d) => (
            <NavLink
              key={d.id}
              to="/history"
              className="block truncate rounded-md px-2 py-1.5 text-sm text-text-muted hover:bg-surface-2 hover:text-text"
              title={d.title}
            >
              {d.title}
            </NavLink>
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={() => onToggleCollapsed(!collapsed)}
        className="m-2 inline-flex items-center justify-center rounded-md py-2 text-text-muted hover:bg-surface-2"
      >
        {collapsedNow ? <PanelLeftOpen className="h-[18px] w-[18px]" /> : <PanelLeftClose className="h-[18px] w-[18px]" />}
      </button>
    </aside>
  );
}
```

> `getDocuments` return type: confirm `DocumentResponse` is exported from `@/types/graph` (it is — `types/graph.ts:61`). If TS complains about the `getDocuments` return being `any`, cast at the call site; do not change `api/client.ts`.

**Step 2 — Verify:** `npm run build` passes.

**Step 3 — Commit:**
```bash
git add frontend/src/components/layout/Sidebar.tsx
git commit -m "feat(ui): add Sidebar with nav + recent documents"
```

---

### Task 1.4 — `CommandPalette` (⌘K, `cmdk`)

**Files:** Create `frontend/src/components/layout/CommandPalette.tsx`

**Step 1:** Create file. Reuses `semanticSearch` (`api/client.ts:155`) and `getDocuments` (`:24`).
```tsx
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Command } from 'cmdk';
import { semanticSearch } from '@/api/client';

type Item = { id: string; label: string; hint?: string; run: () => void };

export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Item[]>([]);
  const close = () => onOpenChange(false);

  useEffect(() => {
    if (!q.trim()) { setHits([]); return; }
    let active = true;
    const t = setTimeout(async () => {
      try {
        const r = await semanticSearch(q, 6);
        if (!active) return;
        setHits(
          (r.nodes || []).map((n) => ({
            id: n.id, label: n.name, hint: n.node_type,
            run: () => { navigate('/graph'); close(); },
          })),
        );
      } catch { /* ignore */ }
    }, 200);
    return () => { active = false; clearTimeout(t); };
  }, [q]);

  if (!open) return null;

  const pages: Item[] = [
    { id: 'p-import', label: '导入新文章', run: () => { navigate('/import'); close(); } },
    { id: 'p-graph', label: '打开全局图谱', run: () => { navigate('/graph'); close(); } },
    { id: 'p-search', label: '搜索知识库', run: () => { navigate('/search'); close(); } },
    { id: 'p-ask', label: '向知识库提问', run: () => { navigate('/ask'); close(); } },
    { id: 'p-history', label: '查看历史', run: () => { navigate('/history'); close(); } },
  ];

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center bg-black/30 pt-[12vh]" onClick={close}>
      <Command
        loop
        className="w-[560px] max-w-[92vw] overflow-hidden rounded-xl border border-border bg-surface shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <Command.Input value={q} onValueChange={setQ} autoFocus placeholder="输入命令或搜索…" className="w-full border-b border-border bg-transparent px-4 py-3 text-sm outline-none placeholder:text-text-subtle" />
        <Command.List className="max-h-[50vh] overflow-y-auto p-2">
          <Command.Empty className="px-3 py-6 text-center text-sm text-text-subtle">无结果</Command.Empty>
          <Command.Group heading="跳转页面" className="px-1 pb-2 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:text-text-subtle">
            {pages.map((it) => (
              <Command.Item key={it.id} onSelect={it.run} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm text-text aria-selected:bg-accent-soft aria-selected:text-accent">
                {it.label}
              </Command.Item>
            ))}
          </Command.Group>
          {hits.length > 0 && (
            <Command.Group heading="搜索节点" className="px-1 pb-2 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:text-text-subtle">
              {hits.map((it) => (
                <Command.Item key={it.id} onSelect={it.run} className="flex cursor-pointer items-center justify-between rounded-md px-2 py-2 text-sm text-text aria-selected:bg-accent-soft aria-selected:text-accent">
                  <span>{it.label}</span>
                  {it.hint && <span className="text-xs text-text-subtle">{it.hint}</span>}
                </Command.Item>
              ))}
            </Command.Group>
          )}
        </Command.List>
      </Command>
    </div>
  );
}
```

**Step 2 — Verify:** `npm run build` passes.

**Step 3 — Commit:**
```bash
git add frontend/src/components/layout/CommandPalette.tsx
git commit -m "feat(ui): add ⌘K command palette (cmdk) with node search"
```

---

### Task 1.5 — `AppShell` + global keyboard shortcuts

**Files:**
- Create: `frontend/src/components/layout/AppShell.tsx`
- Create: `frontend/src/components/layout/useKeyboard.ts` (small hook)

**Step 1:** Create `useKeyboard.ts` — registers `⌘K`, `⌘\`, `⌘1..5`:
```ts
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

export function useAppKeyboard(opts: {
  onCommand: () => void;
  onToggleSidebar: () => void;
}) {
  const navigate = useNavigate();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      if (e.key === 'k') { e.preventDefault(); opts.onCommand(); return; }
      if (e.key === '\\') { e.preventDefault(); opts.onToggleSidebar(); return; }
      const map: Record<string, string> = { '1': '/import', '2': '/history', '3': '/graph', '4': '/search', '5': '/ask' };
      if (map[e.key]) { e.preventDefault(); navigate(map[e.key]); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate, opts]);
}
```

**Step 2:** Create `AppShell.tsx`. It auto-hides the sidebar on canvas routes per design §5.3:
```tsx
import { useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { TopBar } from './TopBar';
import { Sidebar } from './Sidebar';
import { CommandPalette } from './CommandPalette';
import { useAppKeyboard } from './useKeyboard';

const CANVAS_ROUTES = ['/graph', '/draft', '/extract', '/proposal', '/clustering'];

export function AppShell({ children }: { children: ReactNode }) {
  const [cmdOpen, setCmdOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const { pathname } = useLocation();
  const autoHide = CANVAS_ROUTES.some((r) => pathname.startsWith(r));

  useAppKeyboard({
    onCommand: () => setCmdOpen(true),
    onToggleSidebar: () => setCollapsed((v) => !v),
  });

  return (
    <div className="flex h-screen flex-col bg-bg text-text">
      <TopBar onOpenCommand={() => setCmdOpen(true)} />
      <div className="flex min-h-0 flex-1">
        <Sidebar collapsed={collapsed} onToggleCollapsed={setCollapsed} autoHide={autoHide} />
        <main className="min-w-0 flex-1 overflow-hidden">{children}</main>
      </div>
      <CommandPalette open={cmdOpen} onOpenChange={setCmdOpen} />
    </div>
  );
}
```

**Step 3 — Verify:** `npm run build` passes.

**Step 4 — Commit:**
```bash
git add frontend/src/components/layout/AppShell.tsx frontend/src/components/layout/useKeyboard.ts
git commit -m "feat(ui): add AppShell with sidebar auto-hide on canvas routes + shortcuts"
```

---

### Task 1.6 — Wire `AppShell` into `App.tsx`

**Files:** Modify `frontend/src/App.tsx`

**Step 1:** Replace the outer wrapper so `<Routes>` sits inside `<AppShell>`. Remove the old inline-styled `<nav>` (App.tsx:26-55) and the outer flex div. Keep all `<Route>` lines exactly as-is. Result:
```tsx
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AppShell } from './components/layout/AppShell';
import ImportPage from './pages/ImportPage';
// … keep all existing page imports …

export default function App() {
  return (
    <BrowserRouter>
      <AppShell>
        <Routes>
          {/* all existing <Route> lines unchanged */}
        </Routes>
      </AppShell>
    </BrowserRouter>
  );
}
```

**Step 2 — Verify:** `npm run build` passes. `npm run dev`: every page now sits inside the new TopBar+Sidebar shell. Old pages still look old (inline styles) but are framed correctly. Theme toggle works. `⌘K` opens the palette. Navigating to `/graph` auto-collapses the sidebar.

**Step 3 — Commit:**
```bash
git add frontend/src/App.tsx
git commit -m "feat(ui): wrap app in AppShell; remove old inline nav"
```

---

## Phase 2 · Shared primitives

### Task 2.1 — Add shadcn base components

shadcn components are copy-in source files (not an npm dep). For Tailwind v4, use the CLI or paste the canonical v4 source for each.

**Files:** Create under `frontend/src/components/ui/`:
`button.tsx`, `card.tsx`, `input.tsx`, `textarea.tsx`, `label.tsx`, `badge.tsx`, `separator.tsx`, `scroll-area.tsx`, `dialog.tsx`, `sheet.tsx`, `tabs.tsx`, `tooltip.tsx`, `dropdown-menu.tsx`, `alert.tsx`, `skeleton.tsx`, `progress.tsx`.

**Step 1:** Run the shadcn CLI (Tailwind v4 aware) for each:
```bash
cd frontend && npx shadcn@latest init -d   # creates components.json with @/* alias
npx shadcn@latest add button card input textarea label badge separator scroll-area dialog sheet tabs tooltip dropdown-menu alert skeleton progress
```
If offline / CLI fails, fetch each component's source from https://ui.shadcn.com/docs/components and adapt the `cn` import to `@/lib/utils`.

**Step 2:** If `components.json` is created, verify it points `aliases.components` to `@/components` and `utils` to `@/lib/utils`.

**Step 3 — Verify:** `npm run build` passes. Quickly render a `<Button>` and `<Card>` in a throwaway spot to confirm classes resolve, then remove.

**Step 4 — Commit:**
```bash
git add frontend/src/components/ui frontend/components.json
git commit -m "feat(ui): add shadcn base components"
```

---

### Task 2.2 — `NodeCard` shared primitive (the soul of Plan A)

Used by **both** list pages and the React Flow custom node. Reads color from CSS var via `nodeColorVar`.

**Files:** Create `frontend/src/components/NodeCard.tsx`

**Step 1:** Create file:
```tsx
import { cn, nodeColorVar } from '@/lib/utils';
import type { NodeType } from '@/types/graph';

export function NodeCard({
  nodeType, name, description, meta, onClick, selected,
}: {
  nodeType: NodeType | string;
  name: string;
  description?: string;
  meta?: React.ReactNode;
  onClick?: () => void;
  selected?: boolean;
}) {
  const color = nodeColorVar(nodeType);
  return (
    <div
      onClick={onClick}
      style={{ borderColor: selected ? color : undefined }}
      className={cn(
        'group rounded-xl border border-border bg-surface p-3 shadow-sm transition-all',
        onClick && 'cursor-pointer hover:-translate-y-0.5 hover:shadow-lift',
        selected && 'ring-2',
      )}
    >
      <div className="mb-1 flex items-center gap-2">
        <span className="h-3 w-1 rounded-full" style={{ background: color }} />
        <span className="rounded-full bg-surface-2 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-text-muted">
          {nodeType}
        </span>
      </div>
      <div className="text-sm font-semibold text-text">{name}</div>
      {description && (
        <div className="mt-1 line-clamp-2 text-xs text-text-muted">{description}</div>
      )}
      {meta && <div className="mt-2 flex items-center gap-3 text-[11px] text-text-subtle">{meta}</div>}
    </div>
  );
}
```

**Step 2 — Verify:** `npm run build` passes.

**Step 3 — Commit:**
```bash
git add frontend/src/components/NodeCard.tsx
git commit -m "feat(ui): add NodeCard shared primitive (list + graph node)"
```

---

### Task 2.3 — `EmptyState` + `LoadingSkeleton`

Standardize the missing states (design §6.5).

**Files:** Create `frontend/src/components/EmptyState.tsx`, `frontend/src/components/LoadingSkeleton.tsx`

**Step 1:** `EmptyState.tsx`:
```tsx
import type { ReactNode } from 'react';

export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
      <div className="text-4xl opacity-40">🗂️</div>
      <div className="text-base font-semibold text-text">{title}</div>
      {hint && <div className="max-w-sm text-sm text-text-muted">{hint}</div>}
      {action}
    </div>
  );
}
```

**Step 2:** `LoadingSkeleton.tsx`:
```tsx
export function LoadingSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="flex flex-col gap-3">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="h-20 animate-pulse rounded-xl bg-surface-2" />
      ))}
    </div>
  );
}
```

**Step 3 — Verify:** `npm run build` passes.

**Step 4 — Commit:**
```bash
git add frontend/src/components/EmptyState.tsx frontend/src/components/LoadingSkeleton.tsx
git commit -m "feat(ui): add EmptyState and LoadingSkeleton"
```

---

## Phase 3 · Per-page migration

> **Standard transform for every page** (apply in each task below):
> 1. Read the page file. Replace every inline `style={{...}}` with Tailwind classes using tokens (`bg-surface`, `text-text-muted`, `border-border`, `text-accent`, `rounded-xl`, etc.).
> 2. Replace native `<input>/<textarea>/<button>` with shadcn `Input/Textarea/Button`.
> 3. Replace error `<div>` blocks with `<Alert variant="destructive">`; replace string "loading…" with `<LoadingSkeleton>` and add empty state with `<EmptyState>`.
> 4. Replace `window.confirm` with `<Dialog>` (defer if a page has none).
> 5. Replace node/edge/item lists with `<NodeCard>` where applicable.
> 6. Form pages get `max-w-[880px] mx-auto p-6`; canvas pages stay full-bleed.
> 7. **Do not touch** `api/client.ts`, `types/*`, or any backend call — only presentation.
> 8. Verify: `npm run build` green; dev renders both themes.

### Task 3.1 — `ImportPage`

**Files:** Modify `frontend/src/pages/ImportPage.tsx`

**Spec:**
- Outer: `<div className="mx-auto max-w-[880px] p-6">`.
- Title `<h2>` → `text-2xl font-bold mb-5`.
- Error block (ImportPage.tsx:199-203) → `<Alert variant="destructive">`.
- Inputs (lines 207-263) → shadcn `<Input>` / `<Textarea>` with `<Label>`.
- Submit button (lines 265-281) → `<Button disabled={loading}>` with a spinner when loading.
- The post-import `preview` branch (lines 77-193): keep behavior (navigate to wizard happens first), but if it renders, restyle the left list items with `<NodeCard>` and keep `<GraphEditor editable={false}>` (GraphEditor still uses inline styles until Task 3.8 — that's acceptable; it renders).

**Verify + commit:**
```bash
cd frontend && npm run build
git add frontend/src/pages/ImportPage.tsx
git commit -m "feat(ui): migrate ImportPage to design system"
```

---

### Task 3.2 — `SearchPage` + `SearchResults`

**Files:**
- Modify: `frontend/src/pages/SearchPage.tsx`
- Modify: `frontend/src/components/SearchResults.tsx`

**Spec:**
- SearchPage: centered `<Input>` + `<Button>`, results area below.
- SearchResults: render node hits as `<NodeCard>` grid (`grid grid-cols-1 md:grid-cols-2 gap-3`); chunk hits as cards with highlighted snippet (wrap matched query in `<mark className="bg-accent-soft text-accent rounded px-0.5">`).
- Loading → `<LoadingSkeleton>`; empty → `<EmptyState title="暂无结果" hint="换个关键词试试" />`.

**Verify + commit:**
```bash
cd frontend && npm run build
git add frontend/src/pages/SearchPage.tsx frontend/src/components/SearchResults.tsx
git commit -m "feat(ui): migrate SearchPage + SearchResults"
```

---

### Task 3.3 — `AskPage`

**Files:** Modify `frontend/src/pages/AskPage.tsx`

**Spec (conversation style, design §6.3):**
- Read the current AskPage first to see its data shape (uses `askQuestion` from `api/client.ts:167`).
- Render messages: user → `bg-accent-soft self-end rounded-xl px-3 py-2`; AI → `bg-surface self-start rounded-xl px-3 py-2`. Citation node refs in the answer → shadcn `<Badge>` buttons that `navigate('/graph')`.
- Bottom input bar: `<Textarea>` (auto-grow optional) + `<Button>` send; `↵` sends, `Shift+↵` newline.
- Loading answer → a skeleton bubble.

**Verify + commit:**
```bash
cd frontend && npm run build
git add frontend/src/pages/AskPage.tsx
git commit -m "feat(ui): migrate AskPage to conversation layout"
```

---

### Task 3.4 — `HistoryPage`

**Files:** Modify `frontend/src/pages/HistoryPage.tsx`

**Spec:**
- Top: shadcn `<Tabs>` (全部 / 待确认 / 已入库) + filter `<Input>`.
- Body: `grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3`; each doc as a `<NodeCard>`-style card (use `nodeType="article"` color), meta shows status badge + date.
- Right-click / "⋮" → shadcn `<DropdownMenu>` with 打开 / 删除 (delete confirmation via `<Dialog>`).
- Empty → `<EmptyState title="还没有导入" action={<Button>去导入</Button>} />`.

**Verify + commit:**
```bash
cd frontend && npm run build
git add frontend/src/pages/HistoryPage.tsx
git commit -m "feat(ui): migrate HistoryPage to card grid"
```

---

### Task 3.5 — `InsertionProposalPage` + `ProposalPanel`

**Files:**
- Modify: `frontend/src/pages/InsertionProposalPage.tsx`
- Modify: `frontend/src/components/ProposalPanel.tsx`

**Spec:**
- Each item (candidate position / suggested merge / suggested edge) → a `<Card>` with diff-style badges: new = `<Badge>` teal, merge = `<Badge>` warning, conflict = `<Badge>` danger.
- Footer per item: `<Button variant="ghost">拒绝</Button> <Button>接受</Button>`.
- Top summary card with counts + `<Progress>`.
- `window.confirm` → `<Dialog>`.

**Verify + commit:**
```bash
cd frontend && npm run build
git add frontend/src/pages/InsertionProposalPage.tsx frontend/src/components/ProposalPanel.tsx
git commit -m "feat(ui): migrate InsertionProposalPage + ProposalPanel"
```

---

### Task 3.6 — `ClusteringProposalPage`

**Files:** Modify `frontend/src/pages/ClusteringProposalPage.tsx`

**Spec:** Same card style as 3.5. Each `tag_action` → `<Card>`; MERGE/NEW via `<Badge>`; member nodes wrapped in a rounded `border border-dashed border-border rounded-lg p-2` container to visualize the cluster. Topic-edge proposals → list of `<Badge>` pairs.

**Verify + commit:**
```bash
cd frontend && npm run build
git add frontend/src/pages/ClusteringProposalPage.tsx
git commit -m "feat(ui): migrate ClusteringProposalPage"
```

---

### Task 3.7 — `ExtractionWizardPage`

**Files:** Modify `frontend/src/pages/ExtractionWizardPage.tsx`

**Spec:**
- Header: `<Progress value={(stage/total)*100} />` + shadcn `<Tabs>` listing stages; current stage tab active.
- Each stage body: a `<Card>` containing the stage's node/relation review list using `<NodeCard>` rows + inline edit `<Input>`s.
- Footer: `<Button variant="ghost">上一步</Button> <Button>下一步</Button>`; final stage → `<Button>完成抽取</Button>` (confirmation `<Dialog>`).
- Stage loading → `<LoadingSkeleton>`; errors → `<Alert>` + Sonner toast.

**Verify + commit:**
```bash
cd frontend && npm run build
git add frontend/src/pages/ExtractionWizardPage.tsx
git commit -m "feat(ui): migrate ExtractionWizardPage"
```

---

### Task 3.8 — `DraftGraphPage` + restyle `GraphEditor` + custom card node + Sheet inspectors

This is the first graph migration. Do it carefully — the canvas must keep rendering.

**Files:**
- Modify: `frontend/src/components/GraphEditor.tsx` (CustomNode lines 130-152; ReactFlow props line 255-271; edge color line 177)
- Modify: `frontend/src/pages/DraftGraphPage.tsx`
- Modify: `frontend/src/components/NodeInspector.tsx`
- Modify: `frontend/src/components/EdgeInspector.tsx`

**Step 1 — Update `NODE_COLORS` to use CSS vars (keeps API for any other importers):**
In `frontend/src/types/graph.ts:162`, change the values to reference the vars. Since the file exports hex strings, the cleanest minimal change is to leave `NODE_COLORS` as a fallback hex map but have `GraphEditor` use `nodeColorVar()` instead. **Do this:** in `GraphEditor.tsx`, replace `const color = NODE_COLORS[data.nodeType] || '#94a3b8';` with `import { nodeColorVar } from '@/lib/utils'; const color = nodeColorVar(data.nodeType);`. Leave `NODE_COLORS` intact for any other consumers.

**Step 2 — Restyle `CustomNode` (GraphEditor.tsx:130-152)** to mirror `NodeCard`:
```tsx
function CustomNode({ data, selected }: NodeProps<Node<CustomNodeData>>) {
  const color = nodeColorVar(data.nodeType);
  return (
    <div
      onClick={data.onSelect}
      className="min-w-[120px] max-w-[200px] rounded-xl border bg-surface p-2 shadow-sm"
      style={{ borderColor: selected ? color : 'var(--border)' }}
    >
      <Handle type="target" position={Position.Top} style={{ background: color }} />
      <div className="flex items-center gap-1.5">
        <span className="h-3 w-1 rounded-full" style={{ background: color }} />
        <span className="text-[10px] uppercase tracking-wide text-text-muted">{data.nodeType}</span>
      </div>
      <div className="text-[13px] font-semibold text-text">{data.label}</div>
      <Handle type="source" position={Position.Bottom} style={{ background: color }} />
    </div>
  );
}
```
Update `CustomNodeData` if you add `selected` usage (NodeProps already provides `selected`).

**Step 3 — ReactFlow wrapper (GraphEditor.tsx:253-273):**
- Remove `style={{ background: '#f8fafc' }}` (now handled by `.react-flow { background: var(--bg) }` in globals.css).
- Add `colorMode="system"` prop (v12 supports it; it reads our `class="dark"`).
- Edge default stroke (line 177): change `style: { stroke: '#94a3b8' }` → `style: { stroke: 'var(--text-subtle)' }`.

**Step 4 — DraftGraphPage:** full-bleed canvas (`h-full w-full`), inspector moves into a shadcn `<Sheet side="right">` opened when `onNodeClick`/`onEdgeClick` fires; NodeInspector/EdgeInspector become the Sheet body (restyle their inline styles → Tailwind).

**Step 5 — NodeInspector / EdgeInspector:** standard transform (inline styles → Tailwind, inputs → shadcn).

**Step 6 — Verify:** `npm run build` green. `npm run dev` → open a draft graph: nodes render as warm cards, edges are subtle, canvas bg follows theme, clicking a node opens the Sheet. Toggle dark mode — everything follows.

**Step 7 — Commit:**
```bash
git add frontend/src/components/GraphEditor.tsx frontend/src/pages/DraftGraphPage.tsx frontend/src/components/NodeInspector.tsx frontend/src/components/EdgeInspector.tsx
git commit -m "feat(ui): restyle GraphEditor (card nodes, theme-aware) + Sheet inspectors"
```

---

### Task 3.9 — `GlobalGraphPage` (showpiece)

**Files:** Modify `frontend/src/pages/GlobalGraphPage.tsx`

**Spec:**
- Full-bleed canvas; sidebar auto-hides (already handled by AppShell for `/graph`).
- Top-right: shadcn `<Tabs>` (力导向 / 聚类) controlling the existing filter/layout (GlobalGraphPage already has filter via `getGlobalGraph(filterType)` — `api/client.ts:94`).
- Bottom-left legend: small `<Card>` listing node-type → color swatch (read from `nodeColorVar`).
- Click node → `<Sheet>` with NodeInspector content.
- Loading → `<LoadingSkeleton>`; empty graph → `<EmptyState title="知识库还是空的" action={<Button>去导入</Button>} />`.

**Verify + commit:**
```bash
cd frontend && npm run build
git add frontend/src/pages/GlobalGraphPage.tsx
git commit -m "feat(ui): migrate GlobalGraphPage (showpiece)"
```

---

## Phase 4 · Polish

### Task 4.1 — Page transition animation

**Files:** Modify `frontend/src/App.tsx`

**Step 1:** Wrap `<Routes>` output so each route change triggers the CSS animation defined in globals.css. Minimal approach using `useLocation` as key:
```tsx
import { useLocation } from 'react-router-dom';
// inside App:
const location = useLocation();
// ...
<main className="min-w-0 flex-1 overflow-hidden">
  <div key={location.pathname} className="page-enter h-full">
    {children}
  </div>
</main>
```
(Move this wrapper into `AppShell` if cleaner — keep `App.tsx` thin.)

**Step 2 — Verify:** build green; navigate between pages → subtle fade/up (150ms).

**Step 3 — Commit:**
```bash
git add frontend/src/App.tsx frontend/src/components/layout/AppShell.tsx
git commit -m "feat(ui): add 150ms page transition"
```

---

### Task 4.2 — Final visual QA (both themes) + fixups

**Files:** As found.

**Step 1:** With `npm run dev`, walk every route in **light AND dark**:
- `/`, `/import`, `/history`, `/graph`, `/search`, `/ask`
- `/extract/:id`, `/draft/:id`, `/proposal/:id`, `/clustering/:id` (use real IDs from your DB)

Checklist per page: token colors apply, no leftover hardcoded hex (`#3b82f6`, `#e2e8f0`, `#f8fafc`, `#1e293b`, `#64748b`, `#94a3b8` should be **gone** from `src/` except inside `NODE_COLORS` fallback map), no overflow, focus rings visible.

**Step 2:** Grep for stray hardcoded colors and inline styles:
```bash
cd frontend && grep -rn "#[0-9a-fA-F]\{6\}" src --include=*.tsx | grep -v NODE_COLORS
```
Fix any findings by swapping to tokens.

**Step 3 — Verify:** `npm run build` green; grep returns only `NODE_COLORS`.

**Step 4 — Commit:**
```bash
git add -A frontend/src
git commit -m "polish(ui): visual QA pass, remove remaining hardcoded colors"
```

---

## Done criteria (whole plan)

- `npm run build` green from repo root clean state.
- All 9 pages + 4 migrated components use design tokens; `grep` for hardcoded hex returns only `NODE_COLORS` fallback.
- Light + dark themes both correct on every page; React Flow canvas themed and renders.
- AppShell (TopBar/Sidebar/CommandPalette) functional; `⌘K`/`⌘\`/`⌘1-5` work.
- No changes to `api/client.ts`, `types/*`, or backend.
