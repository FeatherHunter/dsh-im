# Agent Preset 对抗报告 · Hunter B（Host 侧）

> 独立报告：只覆盖 Host 实现（DSH 本体），不碰 dsh-im 源码、不碰他人报告。
> 只信一手来源：`D:\0Tools\DSH Desktop\resources\app.asar.unpacked` 只读 inspect（绝未修改），
> 另读 dsh-im 侧接缝文件仅为确认 wire 另一端（不做 dsh-im 侧裁决，那是 A/C/D 的领地）。
> 构建指纹：`dsh-plugin-desktop 2.0.5`，内嵌 `@deepseek-ai/* 0.1.2-rc.1`（`dsh-agent-presets`、
> `dsh-api-session-controller`、`dsh-typert-protocol` 等）。lib 为打包但**未混淆**，JSDoc 与源码地图完整，可逐行定位。
> 背景矛盾按任务要求直接取用：dsh-im 存量 `preset=standard` 且目录显示含 `standard`，
> 但 Host 的 createSession 仍拒绝。dsh-im 侧确为 blind passthrough
> （`src/channels/shared/bot-workspace-store.mjs:1346-1352` 取 `agentPresetFor` 原样透传，
> `src/channels/shared/harness-client.mjs:984-993` 原样装入 `session.create` payload），
> 故拒绝必来自 Host——以下即 Host 侧的完整证据。

---

## 1. createSession 收到 agentPreset 后的完整校验链

入口载荷（`dsh-api-session-controller/lib/typert.host.js:1628`）：

```
SessionCreateRequest { workspaceId?: WorkspaceId; cwd?: string; sessionId?: SessionId; agentPreset?: string; }
SessionCreateValue   { sessionId: SessionId; agentPreset?: string; }
```

链路（`dsh-api-session-controller/lib/index.js`，行号为该文件内行号）：

1. `SessionCommands.create(request)`（566-594）：`workspaceId` 与 `cwd` 二选一（违者 `gateway/bad-request`）；
   workspace 存在性检查（`workspace/not-found`）；然后 `agents.ensureSession(sessionId, cwd, checkPersistedIdentity, request.agentPreset)`，
   失败走 `rejectCreation`（843-857），成功后 `workspace.attachSession`（失败为 `session/workspace-attach-failed`，此时会话**已创建**）。
2. `ensureSession`（245-267）：同 `sessionId` 单飞（`creations` Map）；成功后若本次带了 `presetId` 且与现会话投影不一致 →
   `assertPresetUnchanged` 抛 `ApiSessionPresetConflict`（473-476）；cwd 不一致 → `ApiSessionCwdConflict`。
3. `createOrAdopt`（404-451）三岔：(a) live/attached 命中直接返回；(b) 显式 `sessionId` 且持久层有该身份 → 按**存量** preset
   （`presetForObservation` 读 `agentPreset` 投影，469-472）走 adopt，同样先 `assertPresetUnchanged` 再 `composeAgent(storedPreset)`；
   (c) 全新：`mkdir -p cwd` 后 `composeAgent(presetId)` → `ctx.agents.create({ meta: { cwd, agentPreset }, setup })`。
4. `composeAgent`（350-363）**第一阶段**：若 Host 未挂载 `agentPresets` 服务则无 preset（空 setup）；否则只调
   `presets.resolve(presetId)` 取其 `.id`——**注意：此处不用 `resolveMountable`，只判“存在”，不判“可挂载”**。
   真正的挂载发生在 agent 发布前的 `setup` 回调里：`presets.mount(agentCtx, resolvedId)`。
5. `mount`（`dsh-agent-presets/lib/index.js:1499-1506`）**第二阶段**：
   `resolveMountable(id)`（1459-1466：先 `resolve`，再拒 `broken` 行）→ `ensureStanding(preset)`（单飞常驻挂载，1768-1803）→
   scope 父链绑定。`setup` 内抛错会回滚整个 agent 创建——坏 preset 永远不产生半组装会话（mount 注释，1487-1498）。
6. `mountPreset` 审计（905-938）：子树挂到 agent fiber 下并 `await handle`；随后两项硬审计——
   `inactiveRows(tree)` 非空（有行没活起来：抛错的插件、永远等不到的服务）→ 拒；
   `leakedServices` 非空（有行把服务发布进 root realm，第二个同名 preset 必撞）→ 拒。
   失败统一包装为 `agent-preset/invalid`（含 `preset.path` 与逐行原因），并 `dispose` 子树。
   另有 `write()` 空操作抑制（106-108）：loader 的写回永远不会截断共享的 preset 文件。
7. `rejectCreation`（843-857）：`RemoteError` 原样透传；`ApiSessionPresetConflict` → `agent-preset/conflict`；
   `ApiSessionCwdConflict` → `session/conflict`；其余 → `gateway/internal`（`failed to create session "<id>": …`）。

Host preset 错误码全清单（`dsh-agent-presets/lib/index.js` + `lib/types/authoring.js`，**码中是斜杠**，见 §4 分歧注记）：

| 码 | 抛出点 | message 模板 | details 字段 |
|---|---|---|---|
| `agent-preset/not-found` | `resolve` 1436-1448 | `agent-presets: preset "<wanted>" not found (available: <a, b …或none>)` | `{ agentPreset, available }` |
| `agent-preset/invalid` | `resolveMountable` 1459-1466 | `agent-presets: preset "<id>" failed to mount: <broken>` | `{ agentPreset, reason }` |
| `agent-preset/invalid` | `mountPreset` 928-937 | 同上，reason 为 N 行未激活或 root realm 泄漏（含 path） | `{ agentPreset, reason }`，`cause` 仅进程内有效 |
| `agent-preset/invalid` | `ensureStanding` 1782-1788（文件不可读） | `composition file is unreadable: <path>` | `{ agentPreset, reason }` |
| `agent-preset/invalid` | `copyComposition`（id 非法/已占用，authoring.js:117-128） | id 必须匹配小写规则 / 已存在 | `{ agentPreset, reason }` |
| `agent-preset/read-only` | `writableRoot`/`deleteComposition`（authoring.js:27-29, 164-175） | `preset "<id>" cannot be written: <reason>` | `{ agentPreset, reason }` |
| `agent-preset/locked` | `swap` 1742-1747（`select` 仅限空白会话） | `session "<id>" has already started; its agent preset is fixed` | `{ sessionId, agentPreset }` |
| `agent-preset/conflict` | `rejectCreation` 845-849（显式 sessionId 复用但 preset 与存量不一致） | `session "<id>" runs agent preset "<old>", not "<new>"` | `{ sessionId, requestedPreset, existingPreset? }` |
| `gateway/bad-request` | `validatePresetId` 1147-1149（空串 id） | 字段必须为非空字符串 | `{}` |

关键结构事实：**校验分两阶段**——`composeAgent` 只 `resolve`（存在性），`setup` 才 `mount`（可挂载性）。
“列表里有”只对应第一阶段的健康结论，“创建时拒”大量发生在第二阶段（§3）。

---

## 2. agentPresets.list / 目录枚举的实现与缓存语义

实现（`dsh-agent-presets/lib/types/discovery.js` + `lib/index.js:1344-1448`）：

- **零缓存枚举**：`list()` → `discoverPresets(resolvedRoots, harnessBase)`，**每次重读所有根**（`readdir` + `stat` +
  `readFile` + YAML 解析；源码自述 Discovery is unmemoized，index.js:1155-1158；
  已知限制亦承认每次 `list()` 对每个根产生一次 `readdir`，README.zh.md:179）。
- **固定解析一次的是根集合**：`resolvedRoots` 在构造时确定（1300-1310），`list` 与 `copy` 之间不会漂移。
- **根顺序与信任**：`[系统随附根?, …config.roots, 用户根?]`；`discoverPresets` **先赢**（321-331）：
  同 id 只保留先出现的根的行。Desktop 部署的实际根为 `[包内 shipped(system), Desktop 解包 presets(system), ~/.agent-presets(user)]`。
- **id 规则即 containment 边界**（preset.js:10）：`PRESET_ID = /^[a-z0-9][a-z0-9-]*$/`。
  目录名不合规（大写、下划线、点文件）**直接跳过**——不是 broken，不占位、不报错（280-307）。
- **broken 行语义**（297-307）：目录名合法但 `agent.cordis.yml` 缺失 / 不可读 / YAML 非法 /
  顶层非插件行列表 / 有行引用了解析不到的模块 → 保留为带 `broken` 原因的行，**绝不隐藏**。
  健康检查只判“形状 + 行模块可解析”（`packageInstalled` 向上走 `node_modules`；相对/file 行 `stat`；
  builtin 恒真；`disabled` 真值行跳过，`!!js` 表达式行跳过），**从不 import 任何插件**（125-200）。
  展示元数据（`preset.yml`）缺失/坏掉永远只降级为空展示，绝不致 broken（metadata.js:30-33）。
- **排序**：有 `order` 的随附集按能力排，其余按 id（308-313）。随附 `standard` 的 `preset.yml` 为
  `name: 标准模式 / order: 1`（`presets/standard/preset.yml`）。
- **线上投影**（`remoteExportList` 1355-1368）：每行仅 `{ id, trust, isDefault, name?, description?, broken? }` +
  `authorable`——**不含 `path`，不含内部错误堆栈**（dsh-im 的“只公开安全字段”与此对应）。
- **compositionInventory**（1386-1425）：有存活 standing mount 的 preset 按其最新代际 Loader 条目作答
  （即使文件事后被改坏也照挂载作答）；从未被组合过的按文件解析作答；读取永不挂载。
- **默认指针热读**：`defaultId` 每次从 settings 命名空间 `agent-presets` 读（1337-1339），
  用户文档热重载即对**下一次**创建生效，运行中会话不动（README.zh.md:69）。
- **standing 常驻挂载即唯一的“缓存”**（1468-1477, 1768-1821）：每 preset id 单飞一个 promise；
  失败结算即删（下次重试）；成功则以 `{ mtimeMs, size }` stamp 为代际键——文件 stamp 不变则复用，
  变化则开新代际，已加入会话永远留在老代际（被替代代际进程内永不回收，README.zh.md:175）。
  **stamp 只看 `agent.cordis.yml` 本身**，旁边 skill/资产的修改要等组装文件变动或重启才对新会话生效（README.zh.md:174）。
- **部署默认值**：`dsh-web-app/cordis.patch.yml:440-444` 以 `insert` 写入
  `{ id: agent-presets, name: (dsh-agent-presets 包), config: { default: standard } }`；
  用户层可在 settings 以 `agent-presets: { default: <id> }` 覆盖（README.zh.md:60-69）。
  Desktop 额外 patch（`lib/profile-DcyLDzp6.js` 源码图：取 `agent-presets` 行 → 保留原 config 并设
  `roots: [{ path: shippedPresetRoot(), trust: (system) }]`，`shippedPresetRoot()` 即解包目录下
  `@deepseek-ai/dsh-agent-presets/presets`）——保留 `default`，只追加一个 system 根。
  本机实测随附集为 `{ cordis, minimal, ptc, standard }` 四个目录。

---

## 3. “列表里有、创建时拒”的全部可能（按与本矛盾的吻合度排序）

> 前提：dsh-im 透传意味着存量值（即使是旧构建写下的大写/legacy `code`）会原样到达 Host；
> Host 侧 `resolve` 为**精确匹配**（`presets.find(p => p.id === wanted)`，1439），无大小写归一。

1. **standard 在 resolve 时健康、mount 时失败（最吻合 Top1）**。健康检查明确不覆盖：包已安装但入口缺失、
   插件 `apply` 抛错、行等待组装从未提供的服务（`inactiveRows`）、行把服务发进 root realm（`leakedServices`）、
   定时器/异步续体事后发布服务（靠 invariant 伴生复查）。README 已知限制原话：健康问的是“装没装”，
   不是“能不能 import”（README.zh.md:177）。结果码 `agent-preset/invalid`（mount 路径），
   而它在几秒前的 `list` 里是无 `broken` 的健康行。
2. **TOCTOU 竞争**：`list`（T0）→ dsh-im 展示/用户选择 → `resolve`（T1）→ `mount`/stamp 检查（T2），三步各读一次盘。
   中间任何对 `agent.cordis.yml` 的编辑/删除、引用包的卸载/重命名、权限变化，都会把“刚才还在”变成
   `not-found`（目录/行消失）或 `invalid`（变坏或 stamp 失配开新代际挂载失败）。
3. **显式 sessionId 复用冲突被误读为“拒 preset”**：`/new` 之前老会话仍在时，带不同 preset 的 `create` 命中
   `assertPresetUnchanged` → `agent-preset/conflict`（含 `requestedPreset/existingPreset`）。
   同理 cwd 不一致是 `session/conflict`。这两者都与 preset 内容健康无关。
4. **默认指针 vs 显式值错位**：`/preset --default` 跟随的是热重载的 `defaultId`；若 settings 用户层把
   `agent-presets.default` 指向了一个已被删/写坏的 id（删 preset 时 Host 会尝试清除该用户默认值，1638-1642，
   但只清“恰好指向被删项”的情形），则**不带 preset 的新建**全部 `not-found`，而 `list` 本身完全正常。
5. **大小写/空白**：Host 精确匹配且 `PRESET_ID` 拒大写——`Standard`/`STANDARD` 在 Host 侧**不存在**
   （且若以目录形式存在也会被跳过而非标 broken）。当前 dsh-im 工作树已做大小写归一
   （`agent-preset.mjs:27`），但旧构建写下的存量值或绕过归一的调用仍会以原样到达 Host → `not-found`
   （`available` 列表里赫然有小写 `standard`，最像“列表里有”）。
6. **legacy `code` 残留**：随附集已无 `code`（仅 `cordis/minimal/ptc/standard`；README 称 `cordis` 与 `code` 都是
   `standard` 的复制改写，README.zh.md:178）。存量 `code` → `not-found`，`available` 不含它。
7. **部署根配置**：`includeShippedRoot: false`、profile patch 改写 `roots`、或用户根下自建坏 `standard` 抢占
   （仅当 shipped 根被关掉时才可能，因为 shipped 先赢）→ `not-found`/`invalid`。Desktop 默认 patch 保留 shipped，
   常规安装不命中本条，但自定义 profile 需排查。
8. **双 system 根的代际撕裂（升级残留）**：有效根含“包内 shipped”与“Desktop 解包 shipped”两份同 id。
   平时包内第一赢；升级替换文件期间/之后 mtime+size 变化 → 新会话开新代际，若新组装引用了被重命名/卸载的包
   则新会话全拒而老会话继续跑（老代际永不回收）。用户对随附集的**副本**（copy 后 drift，README.zh.md:178：
   “升级部署不会更新随附 preset 的副本”）同理。
9. **复用 vs 新建分叉掩盖真相**：有可用绑定会话时 dsh-im 直接复用老会话（根本不调 create，preset 不参与），
   只有无会话/会话失效到 createSession 才透传 preset。“有时行、有时拒”首先应按该分叉对齐时间线，而非直接归因目录。
10. **非 preset 码混入**：`session/workspace-attach-failed`（建完挂不上 workspace）、`session/agent-busy`
    （subagent 拥有的会话）、`gateway/internal`（setup 内非 RemoteError 的未知抛错）——都发生在带 preset 的创建窗口内，
    易被记成“preset 拒绝”，但码与 details 完全不同，须按码区分。

本机 live 侧记（仅目录元信息，未读内容）：`~/.dsh/.agent-presets` **不存在**（用户根为空）；
profiles 有 `default/desktop/web`。即本机“列表里有 standard”只能来自两份 system 随附根。

---

## 4. Host 日志里该拒绝长什么样、带什么字段

**核心结论（已验证，无编造）**：`session.create` 的 preset 拒绝路径在该构建里**没有专用日志行**。
失败以 `RemoteError` 经 Typert 网关**原样编码上 wire**（`remote-error.js:4-7`：网关原样编码，判别只看 `code`），
dsh-im 侧以 `HarnessRpcError(method, { code, message, details })` 重建（`harness-client.mjs:627-635`，`rpc:850`）。
dsh-im 侧对应行即任务所述 `[dsh-feishu] message handling failed [MF-XXXXXXXX]`（`src/channels/feishu/bridge.mjs:1159`，
普通消息 label 默认为 `message handling`），其后跟 error 对象（含 `code/message/details/method`）与 `failure`。

Host 侧能 grep 到的对应物（`@deepseek-ai/*` 全包已 grep，preset 拒绝路径仅以下）：

- `agent "<id>" was published without joining an agent preset; its tools, prompt sections, and skill catalog resolve against the empty global layer ...`——
  `ctx.logger.warn`（index.js:1323）。注意这是**无 roster 部署**的症状行，不是拒绝行。
- `agent-presets: tools/change listener failed after recomposing an Agent: <error>`——warn（1707），切换路径监听器失败，非创建拒绝。
- `session-controller: background activation for "<sessionId>" failed: <errorChain>`——
  `ctx.logger.error`（`dsh-api-session-controller/lib/index.js:2654`），**后台激活**路径失败才有；
  前台 `create` 的 preset 拒绝走 RPC 返回，不经过此行。
- `dsh-host-webserver/lib/index.js:248-300` 的 `ctx.logger.warn/error` 仅覆盖 HTTP/upgrade 传输层异常，不记录业务 RemoteError。
- `RemoteError` 自身字段：`{ name:(RemoteError), code:(<domain>/<reason>), message, details, isDSHRemoteError:true }`。
  `cause` 仅进程内有效，不上 wire（构造器注释）。dsh-im 侧 `HarnessRpcError` 保留 `{ method, code, details }`。

**排障 grep 清单**（Host 日志 `~/.dsh/logs`、Desktop `logs` 目录；dsh-im 日志同查）：
`agent-preset/not-found`、`agent-preset/invalid`、`agent-preset/conflict`、`preset "standard"`、
`available:`、`failed to mount`、`did not activate`、`process-global service`、`MF-`（对齐 dsh-im 参考号）。

### 分歧注记（必须如实记录，未调和）

任务称“以 `agent-preset-` 开头 code 拒绝”。实测：Host 包内 `agent-preset-`（连字符）**零命中**
（`@deepseek-ai/*` 全包 grep），Host wire 码一律 `agent-preset/<reason>`（斜杠，现货 5 个：
`not-found/invalid/read-only/locked/conflict`，另 `agent-preset/selected` 为事件名非错误码）。
连字符 `agent-preset-` 只存在于 dsh-im 自有码（`agent-preset-invalid`：`agent-preset.mjs:37`；
`agent-preset-unavailable`：`bot-workspace-store.mjs:1082`）及其分类器
（`message-failure.mjs:136`：连字符前缀 → PRESET_UNAVAILABLE；dsh-im src 内斜杠 `agent-preset/` 零命中）。
其直接后果：**Host 的斜杠码落不到 dsh-im 的连字符分支**，会掉进 INTERNAL_UNKNOWN
（待 A/C 线用 wire 抓包确认；若网关层确有归一化，本注记即作废，以抓包为准）。

---

## 附：方法与边界（诚实记录）

- 方法：grep（`agent-preset|agentPreset|createSession|composeFrom|resolveMountable|standingKeyFor`）覆盖
  `app.asar.unpacked/node_modules/@deepseek-ai/*` 全包 + `lib/*.js`；逐读 `dsh-agent-presets/lib/index.js`（1823 行，
  含全部 JSDoc）、`lib/types/` 各模块、`dsh-api-session-controller/lib/index.js`（create/ensureSession/composeAgent/createOrAdopt/rejectCreation 全段）、
  `dsh-typert-protocol`（RemoteError/remoteErrorOf）、`dsh-host-webserver`（日志面）、
  `dsh-web-app/cordis.patch.yml:440-444`（部署默认）、桌面 `profile-*.js(.map)`（roots patch 与 shipped 根解析）。
- 定位到的文件都给出包内相对路径 + 行号，可复验。未改动 Host 任何字节（全程 read/grep + 只读列目录）。
- 边界：1) 未抓 wire 包，斜杠/连字符分歧以静态证据为准，已标待确认；2) 未读 Host 实时日志内容（只列了目录），
  “无专用日志行”是代码级结论（拒绝路径上无 logger 调用），不是弱结论；
  3) 打包的 `app.asar`（约 5MB）未解包——但 roster 默认/根/校验链全部在 unpacked 侧闭环，不依赖它；
  4) 本机 live 配置（settings 用户层、profile patch 用户层）未读内容，不排除个案根因在其余层。

*报告人 Hunter B；工作区 `D:\dsh-plugin\dsh-im`；报告路径 `docs/research/preset-adversarial-B-host.md`。*