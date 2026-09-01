# CONTEXT — dsh-im 私有 Fork

> 让 AI 一眼看懂这个工作区在做什么、怎么做、上次聊到哪。

## 1. 项目是什么
- **本仓库**：`FeatherHunter/dsh-im`，`fork` 自 `xmanrui/dsh-im@0.13.0`（MIT），单插件统一接入 9 个 IM 渠道到 **DeepSeek Harness**：飞书 / 微信 / 钉钉 / 企业微信 / QQ / Slack / Telegram / Discord / WhatsApp。单插件、单设置入口、多机器人、多工作区/会话绑定。
- **形态**：`Node >=22.19`，`ESM`，`Host + Client` 双构建（`plugin-src/host` + `plugin-src/client`），DSH Cordis 插件（`cordis.patch.yml -> feather-wch-dsh-im`，`id`/`loader`/`PACKAGE_NAME` 均从 `package.json:name` 动态派生，见 ADR-0002），发布物 `lib/` + `plugin-src/`。
- **当前分支策略**：见 ADR-0001。`main` 永远是官方镜像（只做 `upstream` 同步），私货在 `private/custom`（本分支）及 `feat/*` 上。

## 2. 为什么 Fork
- 同步官方更新 + 叠加私有需求（飞书双向文件/图片/HTML）。
- MIT 允许任意修改、私有发布；小而通用的改动可 PR 回上游，大而业务的留在私有分支。

## 3. 分支与 Git 规则
- `origin = FeatherHunter/dsh-im`（可写），`upstream = xmanrui/dsh-im`（只读，需 `git remote add upstream ...`）。
- **日常**：`git checkout main && git fetch upstream && git merge upstream/main && git push origin main`
- **开发**：`git checkout -b feat/xxx main` -> 改 -> `push -u origin feat/xxx` -> PR 回 `upstream:main` 或合到 `private/custom`。
- **同步后**：`git checkout private/custom && git rebase main`（或 `merge`），有冲突仅在 `private` 分支解，`main` 保持干净。

## 4. 关键目录
- `src/channels/feishu/`：飞书长连接、消息抽取（`message-utils.mjs`）、Harness 桥（`bridge.mjs`）、流式卡片（`feishu-channel.mjs`）
- `src/channels/shared/image-prompt.mjs` / `text-harness-bridge.mjs` / `harness-client.mjs`：图片处理与 Harness 会话
- `plugin-src/host` + `plugin-src/client`：DSH 插件宿主与前端设置页
- `test/`：`node --test` 全量，`npm run check = test + build + verify-package`

## 5. 私有需求（本 Fork 目标）
- **2a 飞书 -> DSH**：支持用户发送 `文件/图片/HTML` 给 DSH（下载 `im.v1.messageResource.get type=file`，落盘到 workspace，回显路径给模型）
- **2b DSH -> 飞书**：模型产出 `图片/文件/HTML` 能作为附件回传（`im.v1.image.create / file.create` + `msg_type: file/image`）
- 范围外的 8 个渠道保持上游行为，不主动改。

## 6. 工作方式（AI 约定）
- **Issue 追踪**：GitHub Issues（`docs/agents/issue-tracker.md`）。`gh issue create/view/list/comment/edit`。
- **标签**：Triage 五角色 `needs-triage/needs-info/ready-for-agent/ready-for-human/wontfix` + Wayfinder `wayfinder:map/research/prototype/grilling/task`（`docs/agents/triage-labels.md`），不另建标签。
- **Wayfinder**：`wayfinder:map` 单一地图 issue，子任务为 `sub-issue` 或任务清单，依赖用 GitHub 原生 `blocked_by`。
  - **当前地图**：[#14 Map: Private Fork 私有化发布与上游同步](https://github.com/FeatherHunter/dsh-im/issues/14) — 新会话 AI 必先读此地图的 `Destination/Decisions/ frontier`
- **构建校验**：`npm install && npm run check` 必须绿；产物不含凭据。

## 7. 术语
- **渠道（Channel）**：飞书等 9 个 IM 平台。
- **机器人（Bot）**：单渠道下的一个 App 实例，独立凭据/工作区/会话映射。
- **会话绑定（Session Binding）**：聊天 -> Harness `sessionId` 的映射，存于 `conversation-state-store`。
- **流式卡片**：飞书 `cardkit` 流式消息，用于思考/工具进度。
- **版本断崖（Version cliff）**：`0.15.x` 为私版独立演进，与上游 `4.x` 不可比 `semver`（`@feather_wch/dsh-im` / `feather-wch-dsh-im` 已分叉），同步节奏见 ADR-0001。

## 8. 下一步（给 AI）
> **版本说明**：`0.15.x` 为私版独立演进，与上游 `4.x` 不可比 `semver`，同步节奏见 ADR-0001。不要向用户以 `semver` 对比上游版本。

- **先读地图**：`gh issue view 14 --json body --jq .body`，挑 `frontier` 首个未认领 `wayfinder:task`（`gh issue edit <n> --add-assignee @me` 认领）
- 在 `private/custom` 上完成 2a/2b 的 `message-utils` + `file-prompt` + `bridge#sendFile` 落地，补 `test/channels/feishu/*.test.mjs`。
- 保持 `main` 可一键同步官方：`git fetch upstream && git checkout main && git merge --ff-only upstream/main && git push origin main && git checkout private/custom && git rebase main`。
