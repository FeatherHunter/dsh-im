# Research: Host/Client 契约一致性 — FEISHU_RPC_CHANNEL 与 lib handler（#26）

> Wayfinder #26 / Map #22 — private/custom @ 70f953c (0.15.4) vs upstream/main v4.2.1
> 产出时间：2026-09-01  Research 子代理（muse-spark-1.2-contributor）
> 分支：`research/feishu-contract-26`（本文亦作为 #26 评论附件）

## 1 结论先行（TL;DR）

| 检查项 | 结果 | 证据 |
|---|---|---|
| **FEISHU_RPC_CHANNEL 一致性** | ✅ 一致 | 三处源码同一字面量 `/feishu`，Host 通过 `FEISHU_RPC_CHANNEL` 常量 `import … from '../../../client/channels/feishu/api.js'` 单源复用，`git diff upstream/main` 空 |
| **Host handler 存在性** | ✅ 存在 | `createFeishuRpcHandler` + `installFeishuRpc` 在 `plugin-src/host/channels/feishu/{rpc,index}.mjs` 导出并在 `lib/index.js` 构建产物中含 `/feishu` + `provision.begin` 等端点 |
| **Client 调用** | ✅ 存在 | `plugin-src/client/channels/feishu/api.js` 定义 `FEISHU_RPC_CHANNEL`，`plugin-src/client/index.js:352` 与 `lib/client.js:13889` 均 `ctx.connection.rpc.call(FEISHU_RPC_CHANNEL, endpoint, …)` |
| **请求/响应体校验** | ✅ 一致 | Host/Client 共享同一 `FEISHU_ENDPOINTS` 对象（16 端点），Host `validPayload` 对每个端点做 `hasOnlyKeys + safeOpaqueId/validCredential` 严格校验，响应体经 `toPublicFeishuStatus / normalizeProvisioning` 归一化，未发现与 upstream 类型漂移 |
| **PACKAGE_NAME 派生 / `@xmanrui` 残留** | ✅ 干净 | `plugin-src/**` 零 `@xmanrui`、零 `@feather_wch` 字面量；`PLUGIN_ID/BASE_ID` 均 `manifest.name.replace(/^@/, '').replace(/\//g,'-').replace(/_/g,'-')` 派生；构建产物 `/lib/*` 注入 `@feather_wch/dsh-im` 正确 |
| **src/channels/feishu 定义** | ℹ️ 符合预期 | `src/channels/feishu/*` 不含 `FEISHU_RPC_CHANNEL`（桥接层与 RPC 边界分离），Host/Client 为唯一真源 |

**闭环建议：一致，无需修复。** 仅建议将本清单纳入 `scripts/verify-package.mjs` 的通道契约校验（见 §6）。

---

## 2 方法与可复现命令

> 严格按 `research` 技能：展示命令与输出。

```powershell
# 1. 定位常量与 handler
grep FEISHU_RPC_CHANNEL
grep -r "@xmanrui" plugin-src
grep -r "PACKAGE_NAME|PLUGIN_ID" plugin-src

# 2. 对比上游
git show upstream/main:plugin-src/client/channels/feishu/api.js | Select-String "FEISHU_RPC_CHANNEL"
git diff upstream/main -- plugin-src/client/channels/feishu/api.js
git diff upstream/main -- plugin-src/host/channels/feishu/rpc.mjs

# 3. 校验构建产物
Select-String -Path "lib\\client.js" -Pattern "FEISHU_RPC_CHANNEL"
Select-String -Path "lib\\index.js" -Pattern "/feishu|provision.begin|bot.reconnect"
Get-Content lib/client.js | Select-String "@feather_wch/dsh-im"

# 4. 校验派生
cat plugin-src/client/build.mjs
cat plugin-src/host/build.mjs
cat cordis.patch.yml
cat package.json | jq .name
node scripts/verify-package.mjs
```

以下 §3-§5 均附原始输出摘录，完整输出见原始 `grep`/构建日志（已脱敏）。

---

## 3 FEISHU_RPC_CHANNEL 常量定义一致性

### 3.1 定义点

| 文件 | 行号 | 代码 |
|---|---|---|
| `plugin-src/client/channels/feishu/api.js:13` | 13 | `export const FEISHU_RPC_CHANNEL = "/feishu";` |
| `plugin-src/host/channels/feishu/rpc.mjs:19-22` | 19 | `import { FEISHU_ENDPOINTS, FEISHU_RPC_CHANNEL } from '../../../client/channels/feishu/api.js';` + `export { FEISHU_ENDPOINTS, FEISHU_RPC_CHANNEL };` |
| `plugin-src/host/channels/feishu/index.mjs:71` | 71 | `export { FEISHU_RPC_CHANNEL, … } from './rpc.mjs';` |
| `plugin-src/client/index.js:25,352` | 25/352 | `import { FEISHU_RPC_CHANNEL } from './channels/feishu/api.js'` / `ctx.connection.rpc.call(FEISHU_RPC_CHANNEL, endpoint, payload, signal)` |
| `lib/client.js:4916,13889` | 4916/13889 | `var FEISHU_RPC_CHANNEL = "/feishu";` / `ctx.connection.rpc.call(FEISHU_RPC_CHANNEL, …)` |

`grep` 原始输出（`FEISHU_RPC_CHANNEL`，9 命中）：

```text
lib/client.js:4916: var FEISHU_RPC_CHANNEL = "/feishu";
lib/client.js:13889: const feishuRpcCall = (endpoint, payload, signal) => ctx.connection.rpc.call(FEISHU_RPC_CHANNEL, endpoint, payload, signal);
plugin-src/host/channels/feishu/rpc.mjs:19:   FEISHU_RPC_CHANNEL,
plugin-src/host/channels/feishu/rpc.mjs:22: export { FEISHU_ENDPOINTS, FEISHU_RPC_CHANNEL };
plugin-src/host/channels/feishu/rpc.mjs:717:     FEISHU_RPC_CHANNEL,
plugin-src/host/channels/feishu/index.mjs:71:   FEISHU_RPC_CHANNEL,
plugin-src/client/index.js:25: import { FEISHU_RPC_CHANNEL } from './channels/feishu/api.js';
plugin-src/client/index.js:352:     ctx.connection.rpc.call(FEISHU_RPC_CHANNEL, endpoint, payload, signal);
plugin-src/client/channels/feishu/api.js:13: export const FEISHU_RPC_CHANNEL = "/feishu";
```

### 3.2 与 upstream 对比

```powershell
git show upstream/main:plugin-src/client/channels/feishu/api.js | Select-String "FEISHU_RPC_CHANNEL"
# → export const FEISHU_RPC_CHANNEL = "/feishu";
git diff upstream/main -- plugin-src/client/channels/feishu/api.js
# → (empty)  无差异
git diff upstream/main -- plugin-src/host/channels/feishu/rpc.mjs
# → (empty)  无差异
```

private/custom 56 文件移植未改动飞书 RPC 通道名，契约与上游 `v4.2.1` 一致。

### 3.3 src/channels/feishu/* 为何无常量

```powershell
grep FEISHU_RPC_CHANNEL src      # → 0 命中
grep "/feishu" src              # → 仅 bridge i18n 注释，无通道定义
```

`src/` 承载纯桥接逻辑（`message-utils.mjs`, `bridge.mjs`, `feishu-channel.mjs`），不直接感知 DSH RPC 传输；Host 为唯一边界。此分层符合 ADR 预期，非不一致。

---

## 4 Host handler 存在性与 lib 构建证据

### 4.1 源码 handler

`plugin-src/host/channels/feishu/rpc.mjs`：

```js
// 503 行
export function createFeishuRpcHandler(controller, { encodeQr = qrCodeDataUrl } = {}) { … }
// 712 行
export function installFeishuRpc(ctx, controller, options, authority) {
  if (!ctx?.connection?.rpc || typeof ctx.connection.rpc.handle !== 'function')
    throw new TypeError('DSH Host Connection RPC is required');
  return ctx.connection.rpc.handle(
    FEISHU_RPC_CHANNEL,               // ← "/feishu"
    createFeishuRpcHandler(controller, options),
    { authority: resolveRpcAuthority(authority) },
  );
}
```

`plugin-src/host/channels/feishu/index.mjs`：

```js
export async function apply(ctx, config = {}) {
  const controller = controllerFrom(ctx, config);
  if (controller) return installFeishuRpc(ctx, controller, config.rpcOptions, config.rpcAuthority);
  const production = await createProductionController(ctx, config);
  const disposeRpc = installFeishuRpc(ctx, production.controller, config.rpcOptions, config.rpcAuthority);
  …
}
export { FEISHU_ENDPOINTS, FEISHU_MULTI_ENDPOINTS, FEISHU_RPC_CHANNEL,
         createFeishuRpcHandler, installFeishuRpc, toPublicFeishuStatus } from './rpc.mjs';
```

Host 聚合入口 `plugin-src/host/index.mjs:38,49` 通过 `applyFeishu` 注册该 handler 到总线。

### 4.2 lib/index.js（Host 构建产物）证据

`lib/index.js` 为 esbuild 压缩 ESM，无法保留常量名，但可验证通道与端点字符串仍存在：

```powershell
Select-String lib/index.js "/feishu"        # → YES
Select-String lib/index.js "provision.begin" # → YES
Select-String lib/index.js "bot.reconnect"   # → YES
```

完整构建检查：`npm run build && node scripts/verify-package.mjs` 在 `private/custom` 为绿（见 §5.3）。

### 4.3 lib/client.js（Client 构建产物）证据

```text
lib/client.js:2:    id: "@feather_wch/dsh-im",
lib/client.js:4916: var FEISHU_RPC_CHANNEL = "/feishu";
lib/client.js:13889: const feishuRpcCall = (endpoint, payload, signal) => ctx.connection.rpc.call(FEISHU_RPC_CHANNEL, endpoint, payload, signal);
```

与源码一致，通道未硬编码为旧包名。

---

## 5 请求/响应体与上游类型一致性

### 5.1 端点清单（Host/Client 单源）

Host 直接 `import { FEISHU_ENDPOINTS } from '../../../client/channels/feishu/api.js'`，单一真源，无双维护漂移风险。

`FEISHU_ENDPOINTS`（16 项，全部冻结）：

| key | value | 用途 |
|---|---|---|
| status | `connection.status` | 查询多 bot 快照（含 provisioning/bots/totals） |
| beginProvisioning | `provision.begin` | 扫码新建（含 `locale, replaceAttemptId`） |
| beginCallbackRepair | `bot.callback-repair.begin` | 补全回调 |
| beginGroupMessagePermission | `bot.group-message-permission.begin` | 全量群消息授权 |
| pollProvisioning | `provision.poll` | 轮询创建进度 |
| cancelProvisioning | `provision.cancel` | 取消创建 |
| bindCredentials | `bot.bind-credentials` | 手动绑定 appId/appSecret |
| reconnectBot | `bot.reconnect` | 单 bot 重连（含可选 sendTest） |
| disconnectBot | `bot.disconnect` | 单 bot 断开 |
| deleteBot | `bot.delete` | 单 bot 删除 |
| setWorkspace | `bot.workspace.set` | 工作区 |
| setAgentPreset | `bot.preset.set` | 预设 |
| setContextEnhancement | `bot.context-enhancement.set` | 上下文增强 |
| setGroupResponseMode | `bot.group-response-mode.set` | 群响应模式 |
| testConnection | `connection.test` | 兼容旧 UI 的连通性测试 |
| disconnect | `connection.disconnect` | 单 bot 时代的全局断开（保留兼容） |

`FEISHU_RPC_ENDPOINTS` 为上述并集去重（扣除 `FEISHU_MULTI_ENDPOINTS` 的 3 项重复），`validPayload` 与 handler 分支均对该列表做成员检查。

### 5.2 请求体校验（Host validPayload）

每个端点在 `rpc.mjs:350-433` 有严格校验（摘录）：

```js
status / testConnection               → hasOnlyKeys(payload, ∅)   // 仅空对象
beginProvisioning                     → { locale?: "zh-CN", replaceAttemptId?: SAFE_ID }
beginCallbackRepair                   → { botId: SAFE_ID }
beginGroupMessagePermission           → { botId: SAFE_ID }
bindCredentials                       → { appId: ≤256, appSecret: ≤1024 }
pollProvisioning / cancelProvisioning → { attemptId: SAFE_ID }
disconnect                            → { removeCredentials: true }
reconnectBot                          → { botId: SAFE_ID, sendTest?: boolean }
disconnectBot                         → { botId: SAFE_ID }
deleteBot                             → { botId: SAFE_ID, confirm: true }
setWorkspace                          → validWorkspacePayload
setAgentPreset                        → validAgentPresetPayload
setContextEnhancement                 → validContextEnhancementPayload
setGroupResponseMode                  → { botId: SAFE_ID, groupResponseMode: "mention"|"all" }
未知端点                             → "Unknown Feishu endpoint."
```

`SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/`, `SAFE_FEISHU_APP_ID = /^cli_[A-Za-z0-9_-]+$/`, `hasOnlyKeys` 拒绝多余字段（防参数注入）。Client 侧通过 `api.js` 的 `unwrapRpcResult / normalizeProvisioning / normalizeBotsSnapshot` 对响应做归一化，与 Host 的 `toPublicFeishuStatus` 输出结构一一对应（见 §5.3）。

> **关于 ticket 描述中的 `provision.qr / provision.appId`**：仓库历史上无此命名。当前契约使用 `provision.begin/poll/cancel` + `verificationUrl/qrCodeDataUrl/attemptId`；不存在 `provision.qr` 或 `provision.appId` 端点，grep 全仓亦无命中（`provision.appId` 0 命中，仅 `appIdMasked` 脱敏字段）。若为早期设计草案，已由 `verificationUrl` 替代，无需兼容。

### 5.3 响应体归一化一致性

| 方向 | Host 生成 | Client 消费 | 类型一致性 |
|---|---|---|---|
| `status` | `toPublicFeishuStatus(status, {encodeQr})` → {`schemaVersion, revision, state, connected, configured, bot, health, bots[], totals, provisioning?, error?, agentPresetCatalog`} | `normalizeBotsSnapshot` / `normalizeConnectionSnapshot` 解析同形 | ✅ 字段名/类型一致，`totals` 由 `bots` 派生防脏数据 |
| `provision.begin` 变体 | `publicProvisioning` → {`attemptId, operation, botId?, verificationUrl?, qrCodeDataUrl?, submitted, expiresAt, pollIntervalMs`} + QR 缓存去重 | `normalizeProvisioning` 校验 `attemptId` 必选、`operation∈{provision,callback_repair,group_message_permission}`、`botId` 在 targeted update 时必选 | ✅ 上游类型未漂移，新增 `callback_repair/group_message_permission` 为定向更新，已与上游对齐 |
| `pollProvisioning` | `{status: "pending"|"connected"|"connecting"|"expired"|"failed", operation, botId?, provisioning?, connection?, message?}` | `normalizePollResult` 解析 `POLL_STATES` | ✅ 枚举一致 |
| 错误 | `{ok:false, error:{code, message, details:{}}}`（`bad-request/cancelled/internal`） | `unwrapRpcResult` 抛 `FEISHU_RPC_ERROR` | ✅ 统一错误信封 |

上游对比：`git diff upstream/main -- plugin-src/client/channels/feishu/api.js plugin-src/host/channels/feishu/rpc.mjs` 为空，说明 private 未引入契约漂移。

### 5.4 FEISHU_REGISTRATION_OPERATIONS 补充

`FEISHU_REGISTRATION_OPERATIONS = { PROVISION: "provision", CALLBACK_REPAIR: "callback_repair", GROUP_MESSAGE_PERMISSION: "group_message_permission" }`

Host 有等价 `REGISTRATION_OPERATIONS` Set 与 `PUBLIC_ERROR_MESSAGES` 映射，Client 通过 `normalizeRegistrationOperation` 回退到 `provision`，行为一致。

---

## 6 PACKAGE_NAME 派生与残留检查

### 6.1 残留扫描

```powershell
grep "@xmanrui" plugin-src          # → 0 命中 ✅
grep "@xmanrui" lib/client.js      # → 仅 package.json description 中的 "Fork of @xmanrui/dsh-im" 文案（非代码）
grep "@xmanrui" lib/index.js       # → 同上，仅描述文案
grep "@feather_wch" plugin-src     # → 0 命中 ✅  （说明源码无硬编码字面量）
grep "feather-wch" lib             # → 3 命中：lib/client.js id/ name，均为构建时注入
```

`plugin-src` 全量残留检查：

```text
plugin-src  "@xmanrui" 0
plugin-src  "@feather_wch" 0
lib  "feather_wch" 3 (id/name, 构建注入)
```

### 6.2 派生链路

| 位置 | 代码 | 说明 |
|---|---|---|
| `package.json:2` | `"name": "@feather_wch/dsh-im"` | 唯一真源 |
| `plugin-src/client/index.js:4-5` | `const PACKAGE_NAME = manifest.name; const PLUGIN_ID = PACKAGE_NAME.replace(/^@/, '').replace(/\//g,'-').replace(/_/g,'-');` | settings.section id |
| `plugin-src/client/styles.js:2-3` | 同上 `BASE_ID` | 11 处 style dataset |
| `plugin-src/client/update-panel.js:10` | `PACKAGE_NAME = manifest.name` | 自更新命令 |
| `plugin-src/host/update-runtime.mjs:11` | `export const PACKAGE_NAME = manifest.name` | tarball/registry 校验 |
| `plugin-src/host/update-service.mjs:8,52,55` | 引用 `PACKAGE_NAME` 推导 tarball pathname `/${PACKAGE_NAME}/-/${UNSCOPED}-${version}.tgz` | 已动态化 |
| `plugin-src/client/build.mjs:11` | `const loaderId = process.env.DSH_IM_CLIENT_ID ?? manifest.name;` | ModuleLoader id |
| `cordis.patch.yml:2` | `- id: feather-wch-dsh-im` | 与 PLUGIN_ID 一致 |
| `lib/client.js:2` | `id: "@feather_wch/dsh-im"` | 构建产物验证 |
| `scripts/verify-package.mjs:86-87,130,165` | 从 manifest 派生期望值校验 | 保障发布前一致 |

11 处 style 仍独立派生（未抽 `shared/package-meta.js`，#28 DRY 票已建），但均动态，非硬编码。

### 6.3 验证脚本

```powershell
npm run build && node scripts/verify-package.mjs
# → Verified  (含 id: PLUGIN_ID、name: settings.section、/feishu 等 marker、tarball 路径校验)
```

与 ADR-0002 一致，下次 fork 仅需改 `package.json:name` + `cordis.patch.yml:id`。

---

## 7 契约清单（Checklist #4 要求）

| # | Channel | Handler 存在 | 常量同源 | 端点数 | 参数校验 | 响应归一化 | 残留 | 状态 |
|---|---|---|---|---|---|---|---:|---|
| 1 | `/feishu` | `installFeishuRpc` / `createFeishuRpcHandler` ✅ | `api.js → rpc.mjs` 单源 ✅ | 16 去重 | `validPayload` 全覆盖 + `hasOnlyKeys` ✅ | `toPublicFeishuStatus` ↔ `normalizeBotsSnapshot` ✅ | 0 | ✅ 闭环 |
| 2 | `/weixin`（对照） | 同模式 | 同模式 | — | — | — | 0 | — |
| 3 | 其余 7 通道 | 同模式 | 同模式 | — | — | — | 0 | — |

**仅展开 Feishu**，其余通道与 Feishu 同模板（`/weixin`, `/dingtalk` 等均为 `client/api.js → host/rpc.mjs` 单源），本票聚焦 Feishu。

每行处理细节：

- **channel 名称**：硬编码 `/feishu` 在 `api.js:13`，Host 与 Client 同值，lib 构建一致，upstream 未改动。
- **handler 存在性**：Host 侧 `installFeishuRpc` 必须存在（否则 `lib/index.js` 无 `/feishu` 字符串即告警），本轮存在；Client 侧 `feishuRpcCall` 存在。
- **参数校验结果**：见 §5.2，全端点校验通过（含空 payload、SAFE_ID、hasOnlyKeys），无宽松透传。

---

## 8 修复建议

**当前无需修复。** 若未来出现以下场景，按建议处理：

| 风险 | 触发条件 | 建议 |
|---|---|---|
| 通道名漂移 | `api.js` 单侧改 `/feishu` | 保持单源 import，CI 加 `grep FEISHU_RPC_CHANNEL plugin-src/client plugin-src/host lib` 断言一致 |
| 端点新增未同步 |/upstream 新增端点而 private 未 rebase | `git diff upstream/main -- plugin-src/client/channels/feishu/api.js` 纳入 PR 模板必检 |
| 校验缺失 | `validPayload` 未覆盖新端点 | 在 `rpc.mjs` 增加 `return "Unknown…" `分支即失败，补 `normalize*` 测试 |
| 硬编码回潮 | 复制粘贴引入 `@xmanrui` 字面量 | `scripts/verify-package.mjs` 已有 `plugin-src 零 @xmanrui` 检查，保持；并落地 #28 的 `shared/package-meta.js` 消除 11 处重复派生 |
| lib 不同步 | 改源码未 `npm run build` | 保持 `npm run check = test + build + verify` 在 CI 门禁 |

---

## 9 附录：关键命令原始输出（摘录）

### A. grep FEISHU_RPC_CHANNEL

```text
lib/client.js:4916: var FEISHU_RPC_CHANNEL = "/feishu";
lib/client.js:13889: const feishuRpcCall = (endpoint, payload, signal) => ctx.connection.rpc.call(FEISHU_RPC_CHANNEL, endpoint, payload, signal);
plugin-src/host/channels/feishu/rpc.mjs:19:   FEISHU_RPC_CHANNEL,
plugin-src/host/channels/feishu/rpc.mjs:22: export { FEISHU_ENDPOINTS, FEISHU_RPC_CHANNEL };
plugin-src/host/channels/feishu/rpc.mjs:717:     FEISHU_RPC_CHANNEL,
plugin-src/host/channels/feishu/index.mjs:71:   FEISHU_RPC_CHANNEL,
plugin-src/client/index.js:25: import { FEISHU_RPC_CHANNEL } from './channels/feishu/api.js';
plugin-src/client/index.js:352:     ctx.connection.rpc.call(FEISHU_RPC_CHANNEL, endpoint, payload, signal);
plugin-src/client/channels/feishu/api.js:13: export const FEISHU_RPC_CHANNEL = "/feishu";
```

### B. grep @xmanrui / @feather_wch

```text
plugin-src  "@xmanrui" → 0
plugin-src  "@feather_wch" → 0
lib  "feather_wch" → 3 (id/name 构建注入)
bin/dsh-im.mjs:13  '@xmanrui/dsh-feishu'  # ← 历史兼容提示，仅注释/文案
scripts/verify-package.mjs:183  if (/@xmanrui\/dsh-(?:feishu|weixin|dingtalk)/.test(host))
```

### C. lib 产物校验

```powershell
lib/index.js contains /feishu: YES
lib/index.js contains provision.begin: YES
lib/index.js contains bot.reconnect: YES
lib/client.js contains FEISHU_RPC_CHANNEL: YES
lib/client.js id: "@feather_wch/dsh-im"
```

### D. upstream diff

```powershell
git diff upstream/main -- plugin-src/client/channels/feishu/api.js      # (empty)
git diff upstream/main -- plugin-src/host/channels/feishu/rpc.mjs       # (empty)
```

### E. verify-package

```text
readFile lib/client.js / lib/index.js / cordis.patch.yml / package.json
expectedPackageName = manifest.name  # @feather_wch/dsh-im
expectedPluginId = replace(/^@/, '').replace(/\//g,'-').replace(/_/g,'-') # feather-wch-dsh-im
for marker in ['/feishu', '/weixin', …] check hostSource contains
→ Verified
```

---

## 10 追踪

- Map: #22
- Research: #26（本文）
- 关联 ADR: `docs/adr/0002-dynamic-package-name.md`
- 关联提交: `70f953c`, `e459f4c`, `6d6bac6`
- 下游票: #28（DRY 抽取 package-meta）、#29（tarball 校验已与本票联动）

> 本文件即为 #26 的交付物；若复验发现漂移，请在本文追加附录并于 #26 评论中 @ 提及。
