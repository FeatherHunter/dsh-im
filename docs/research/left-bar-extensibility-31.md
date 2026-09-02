# [Research] DSH 左侧工作栏插件可扩展性验证 — ticket #31

> Wayfinder Map #30 · Research 票 #31
> 分支：`research/left-bar-extensibility` · 文档：`docs/research/left-bar-extensibility-31.md`
> 日期：2026-09-02 · 研究者：主会话补位（接管子代理 5cd419fe）
> 基线：`private/custom@67ca895` + 桌面端解包 `app.asar.unpacked/lib/client.js` + `plugin-src/client/index.js`
> 仓库：`FeatherHunter/dsh-im`（fork xmanrui/dsh-im）

---

## 0. 结论先行

| 问题 | 结论 | 插件化代价 |
|------|------|------------|
| **能否不改官方代码、以插件形式直接扩展左侧工作区列表（在 .db / 1111 / dsh-im 列表内插入分组/拟人化行）** | **不可** — 左侧工作区列表未暴露为可注入 slot | 若强行改官方源码则属 Out of scope，需另立 effort 向 DSH 提 PR |
| **能否以插件形式在左侧“旁边”提供等效入口** | **可** — 有 3 条等效路径，侵入度由低到高见 §4 | 均为官方支持的 slot，无需改 Host |
| **最稳的落地** | **设置页聚合视图 (`settings.section` 顶部插入 AssistantGallery) + 辅以 `shell.overlay` 快捷浮层 / 命令** | 复用 dsh-im 已有注入，无需新 slot |

> 一句话：**左侧列表本身是 Host 原生私有渲染，无 slot；但左侧“侧边栏容器”与“设置区、悬浮层”可插件化，做“旁边收纳”而非“列表内插入”。**

---

## 1. 方法与证据

1. **插件侧注入盘点**：精读 `plugin-src/client/index.js`（401 行）、`package.json:dsh.client.inject`、`cordis.patch.yml`
2. **Host 侧槽位盘点**：解包 `D:\0Tools\DSH Desktop\resources\app.asar.unpacked\lib\client.js`（约 47k 行，含 Desktop 扩展壳），`grep -n "renderSlot|register.*sidebar|settings.section" `
3. **槽位定义提取**：在 `client.js` 中定位 `DesktopOwnedFrame` 与 `applyExtendedOwnedShell` 对 `slots.register` 的声明，区分 `kind: single vs list` 与 `scope`
4. **全仓验证**：`grep -r "slots" plugin-src`, `grep -r "workspace-list|sidebar" lib`，确认无左列表 slot

---

## 2. DSH 左侧的实现位置

### 2.1 左侧在桌面端的渲染

`app.asar.unpacked/lib/client.js:156-257` 定义 `DesktopOwnedFrame`：

```js
// client.js:195-238（精简）
const sidebarOwnerWidth = collapsed ? 56 : columns.sidebar;
<div data-sidebar-collapsed={collapsed} style={{gridTemplateColumns: `${columns.sidebar}px minmax(0,1fr) ${columns.details}px`}}>
  <div className="dshDesktopSidebarSurface">
    <div className="dshDesktopUpstreamSidebar">
      {renderSlot("sidebar", { width: sidebarOwnerWidth })}
    </div>
  </div>
  <div>{renderSlot("conversation", {})}</div>
  <div>{renderSlot("details", {})}</div>
  {renderSlot("shell.overlay", {})}
</div>
```

- **左侧容器**：`dshDesktopSidebarSurface` + `dshDesktopUpstreamSidebar`，宽度由 `DesktopLayoutState`（sidebar 264-420px，收起 56px）驱动
- **槽位**：`renderSlot("sidebar")` 即左侧的唯一注入点；其内容目前由 DSH 上游提供（工作区列表 + 会话列表的组合），非插件

### 2.2 槽位定义（决定能否多插件共存）

`client.js: applyExtendedOwnedShell` 中（约 47262 行附近）：

```js
ctx.slots.register({
  name: "root",
  children: {
    "sidebar":      { kind: "single", scope: "root" },
    "conversation": { kind: "single", scope: "session-maybe" },
    "details":      { kind: "single", scope: "session" },
    "shell.overlay":{ kind: "list",   scope: "root" }
  },
  inject: () => ({ layout: desktopLayout, platform })
}, ExtendedFrame)
```

```js
// 另两处官方扩展
ctx.slots.inject("settings.section", () => ctx.slots.register({...}))
ctx.slots.inject("settings.action",  () => ctx.slots.register({...}))
ctx.slots.inject("shell.overlay",    () => ctx.slots.register({...}))
```

- `sidebar` 为 `single`：同一时刻只能有一个提供者（Desktop 扩展壳已占），**不允许**多个插件同时向左侧列表追加行
- `settings.section` / `shell.overlay` 为 `list`：允许多插件并存，正是 `dsh-im` 已使用的

### 2.3 工作区列表本身

- 工作区列表（截图中的 .db / 1111 / dsh-im / xiaoshuai 分组、搜索、置顶、时间戳）**不在 slot 定义中**，是 `sidebar` 槽位默认内容的一部分，由 Host 的 `workspaceController` 直连渲染
- 全仓 `grep "workspace.*list|WorkspaceList" lib/client.js` 无独立 slot，仅 `dshDesktopUpstreamSidebar` 内隐式渲染
- **结论**：没有 `workspace-list` / `sidebar.item` / `sidebar.decorator` 这类细粒度 slot

---

## 3. dsh-im 当前的注入

`plugin-src/client/index.js:61,379-400`：

```js
export const inject = ['slots', 'connection', 'locale', 'workspaces'];
// ...
ctx.slots.inject('settings.section', () => ctx.slots.register({
  name: 'settings.section',
  id: PLUGIN_ID,        // feather-wch-dsh-im
  order: 21,
  label: () => t('IM机器人'),
  locale: IM_LOCALE_NAMESPACE,
  inject: () => ({ dingtalkRpcCall, feishuRpcCall, ... workspaceDirectoryPicker }),
}, IMSettingsTab));
```

`package.json: dsh.client.inject`：

```json
["@deepseek-ai/dsh-client-connection",
 "@deepseek-ai/dsh-client-runtime",
 "@deepseek-ai/dsh-client-ui-settings",
 "@deepseek-ai/dsh-client-ui-slots",
 "@deepseek-ai/dsh-client-locale"]
```

- **唯一注入**：`settings.section`（右侧设置页的“IM机器人”标签），**未注册** `sidebar` 或 `conversation` 或 `details`
- `grep -n "slots" plugin-src/client/index.js` 仅 2 命中（inject 声明 + settings.section），无 sidebar
- 即使尝试 `ctx.slots.inject("sidebar", ...)`，会因 `single` 冲突被 Desktop 壳拒绝（claimDesktopLayout 抢占）

> **铁证**：#32 研究已验证“左侧零侵入”，本票在解包层复核：Host 侧 sidebar 为 single，上游已占，插件无缝可插。

---

## 4. 若不可直接扩展，哪些等效路径可用

按侵入度与“10 秒找到”达成度排序：

### 方案 A：设置页聚合（首选，零左侧侵入，最稳）

- **Slot**：`settings.section`（已有，list，order 21），在 IMSettingsTab 顶部插入 `AssistantGallery`
- **形态**：大卡片聚合 9 个渠道的 `workspaces.json`（Client 侧聚合，复用 `useWorkspaceSnapshotFence + WorkspaceEditor`），每卡：头像/昵称/角色标签/工作区路径/最近会话时间，带搜索与按人/角色分组折叠
- **证据**：`plugin-src/client/index.js:379` 已占 settings.section，前端无需新 slot；样式可用 `installImStyles` 隔离
- **达成度**：设置页常驻入口，1 次点击 + 搜索即可触达；不污染左侧；实现量最小（仅 client）
- **侵入度**：★☆☆☆☆

### 方案 B：悬浮层快捷（辅选，1 次点击直达）

- **Slot**：`shell.overlay`（list，root scope），`ctx.slots.inject("shell.overlay", () => ctx.slots.register({id: "assistant-quick", order: -900, ...}))`
- **形态**：右下角或标题栏附近悬浮按钮（复用 `DesktopFrameTitlebar` 的 `dshDesktopFrameActions` 思路），点击展开助理抽屉或 Command Palette（⌘K 风格），输入“小孙 健身”直达
- **证据**：`client.js:257 renderSlot("shell.overlay")` + `client.js:47311 ctx.slots.inject("shell.overlay", ... DesktopFrameTitlebar)` 表明该 slot 专为悬浮/标题栏设计
- **达成度**：全局可达，不依赖左侧；适合 10×10 高频切换
- **侵入度**：★★☆☆☆（需新增一个 overlay 组件，注意 z-index 与主题）

### 方案 C：推动上游新增细粒度 slot（长期，需官方协作）

- **Slot（需上游新增）**：`sidebar.item.decorator` 或 `workspaces:assistant-bar`（list，scope root），允许插件在工作区列表项旁注入头像/角色徽标或在列表顶部注入折叠分组
- **形态**：左侧列表内可折叠“我的助理”分组（每人可折叠，内为其工作区），与普通工作区同处一滚动容器
- **证据**：当前无此 slot，`client.js` 的 sidebar single 已占，需 DSH 官方将“工作区列表”拆为可装饰的 list slot（类似 settings.section 的 list）
- **达成度**：最贴用户“在左侧直接找到”的诉求，但依赖发版周期
- **侵入度**：★★★★☆（需提 PR 到 DSH，改 Host 渲染，周期长）

> **取舍建议（供 Grilling 决议）**：**A 为必做底座**（无论选 B 还是 C 都需的聚合数据层）；**A+B 组合**可在不改官方的前提下 1-2 周内验证“10 秒找到”；**C 作为二期**，待 A+B 验证达标率后再决定是否推动。

---

## 5. 约束与不变量（供 Grilling 原样引用）

1. **不改官方左侧源码**（Map Out of scope），本票结论为“插件不可直接改左侧列表”，任何左侧内插入需走官方 PR
2. **sidebar single 已占**：`DesktopLayoutState` + `applyExtendedOwnedShell` 已 claim，插件不可再注册 sidebar
3. **可用 list slots**：`settings.section`、`shell.overlay`（以及 `settings.action` 用于设置页操作区），均为官方支持的多插件共存
4. **工作区列表私有**：无 workspace-list slot，搜索/分组/置顶均为 Host 前端私有状态（localStorage），插件侧不可读写其 pin
5. **样式隔离**：`dshDesktopSidebarSurface` 在 extended 模式下为透明，需注意主题变量 `--dsw-alias-bg-*`，overlay 需 `transform: translateZ(0)` 防逃逸（见 `installExtendedStyles`）

---

## 6. 对 Prototype 的输入

- **必须消费 #32 的 BotWorkspaceStore 聚合**：无论 A/B/C，都需 Client 侧聚合 9 个 `workspaces.json` + `workspace.list` 去重（`workspacePathSnapshot`），建 `{botId, displayName, roleTag, workspacePath, pinyin, initials}` 倒排索引
- **拟人化存储**：建议在 `BotWorkspaceStore` 新增 `botProfiles: { [botId]: { displayName, avatarUrl, roleTag, color } }`，version 3，缺失回退到 `botName/appIdMasked`（#32 §8 已提）
- **Prototype 形态**：
  - A：`plugin-src/client/AssistantGallery.tsx`（或 .js）置于 IMSettingsTab 顶部，复用 `WorkspaceEditor + DirectoryPicker`
  - B：`AssistantQuickOverlay` 注册到 `shell.overlay`，提供 ⌘K 搜索（前端内存 <100 项，无需后端）
  - C：留作二期，仅在 Grilling 明确“必须在左侧”时启动

---

## 7. 附录：关键文件索引

| 文件 | 位置 | 证据 |
|------|------|------|
| `plugin-src/client/index.js` | 61, 379-400 | 唯一注入 settings.section，inject 声明 |
| `package.json` | dsh.client.inject | 声明 slots/connection/locale/workspaces 5 项 |
| `cordis.patch.yml` | 1-3 | id feather-wch-dsh-im，无 slot 声明 |
| `app.asar.unpacked/lib/client.js` | 156-257 DesktopOwnedFrame | renderSlot("sidebar") 单一容器 |
| `app.asar.unpacked/lib/client.js` | ~47262 applyExtendedOwnedShell | children sidebar single 定义 |
| `app.asar.unpacked/lib/client.js` | 36745 settings.section, 47311 shell.overlay | list slots，可多插件共存 |
| `src/channels/shared/bot-workspace-store.mjs` | 204-330 | Bot→Workspace 存储（#32 已详） |
| `docs/research/m-plugin-model-32.md` | 全文 | 10×10 模型与零侵入互证 |

---

## 8. 未决与需真实浏览器验证项

- [ ] `shell.overlay` 在不同 Desktop 模式（compatibility/extended/advanced）下的 z-index 与拖拽区避让（需 `dsh-plugin-ui-debug` 真实浏览器截图）
- [ ] `settings.section` 插入 AssistantGallery 后的滚动与折叠本地存储 key 设计
- [ ] 若用户在 Grilling 坚持“必须在左侧列表内”，需启动上游 DSH 的 `workspaces:assistant-bar` slot 提案（本票暂不展开，仅留分支）

---

*本研究不改主分支代码，仅在 `research/left-bar-extensibility` 分支留档；后续 Grilling（#33/#34）与 Prototype（#35）可直接消费 §4-§6。*
