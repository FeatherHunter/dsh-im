# 飞书桥鉴识 C：会话键 / 流式撤回链 / 多 bot 作用域 / 第二抛错点

> 基线：`main` = `upstream/main` = `1fa86ed`。下文全部行号以 `git show main:<path>` 为准。
> 现场证据（直接取用，不复核）：同一聊天两条引用回复成功（hello、你是谁；你是谁带 1 条回复线程标记），随后卡路里 help 失败（无线程标记；接着小孙撤回一条消息 + `PRESET_UNAVAILABLE MF-C3FF35A8`）；同聊天 `/preset=standard`、`/presetlist` 含 standard 且标当前选择；session-4ba8e999（头 `agentPreset=ptc`）turn 4–7 正是那四个成功，turn 2 还有一次同文本卡路里 help 的成功。
> 方法：只信一手源码。本报告不读运行时日志、不看截图原图；凡需日志对账的点在 §6 列给 A/B/D。

## 0. 结论速览

1. **会话键是 chat 级与 thread 级的混合，引用回复永不换 key**：`thread_id` 有无/异同是唯一的分组开关；`parent_id`/`root_id`（引用）不参与 key 计算。因此“成功有线程标记 vs 失败无线程标记”**在代码层面确实对应不同 key → 不同绑定 → 新建分支**。
2. **流式占位卡失败 recall 链与截图现象完全吻合**：占位卡先建、ask 后跑；`agent-preset-*` 在 ask 内抛出时答案为空，走“recall 全部占位卡 → 原样抛错 → 回复式错误文本”这条路，不走静默 fallback。撤回一条 + 错误文本正是该路径的必然输出对。
3. **同聊天同 bot 内 `/preset` 与普通消息的 botId 必然一致**；preset 是 bot 级存储，会话绑定是 key 级存储。A 聊设 preset、B 聊失败要成立，代码层面要求 A、B 由**不同 bot（不同 runtime）**服务；同 bot 不同 key 只会会话隔离、不会 preset 分叉。`/presetlist` 的“当前选择”是读接口快照，不能证明失败瞬间 host 侧仍接受该 preset（TOCTOU）。
4. **普通消息处理中不存在第二个可抛 `agent-preset-*` 的调用**：唯一向量是 `askInWorkspaceSession` →（仅新建分支时）scoped `createSession` 携带当前 bot preset → host 拒绝。turn 2 同文本成功与本次失败并存，恰好符合“老绑定复用免检、新建分支才校验”。

---

## 1. 会话键 key 怎么算

### 1.1 chat 级还是 thread 级？——都是，按 `thread_id` 分流

`src/channels/feishu/message-utils.mjs:29-44`（`conversationKey`）：

- `p2p` → `p2p:<senderId>`（31-34）；
- 群聊无 `thread_id` → 整个 chat 共享单个 `group:<chat_id>`（注释 38-40，返回 43）；
- 群聊有 `thread_id` → 按话题隔离 `group:<chat_id>:thread:<thread_id>`（41-42）。

`src/channels/feishu/bridge.mjs:613-629`（`#resolveKey`，`accept` 在 729 调用、735 登记）：群外直接委托 `conversationKey`（616）；群内有 `thread_id` 时优先映射到已登记的 managed 话题（619-623），否则 thread key（623）；仅当 `groupTopicReply` 开启**且**主 feed 被 @ 的消息，才以自身 `message_id` 开一个新的 `managedGroupKey(chatId, messageId)`（625-626）；其余回落 `group:<chat_id>`（628）。`managedGroupKey` / `isTopicGroupKey` 定义见 `message-utils.mjs:17-27`。

### 1.2 回复引用是否换 key？——不换

全仓对引用字段只有两处读取，均不参与 key 计算：

- `message-utils.mjs:424-428`（`feishuReplyTargetId`，`parent_id` 优先、次取 `root_id`）：唯一用途是 `feishuReplyReference` 拉取被引用消息正文并入 prompt；调用点 `bridge.mjs:3548` 只决定 `content` 是否需要富化，`803` 只决定命令快速路豁免，`1209` 同理。`hasReplyReference` 本体在 `src/channels/shared/semantic/reply-reference.mjs:136`。
- `bridge.mjs:4079-4084`（`#isResolvedQuestionReply`）：用 `parent_id`/`root_id` 查已解决提问表，且要求 `resolution.key === key`——它是拿**已算好的 key**做等值比较，不产生 key。

key 推导消费的入站字段恰为 `chat_type/chat_id/thread_id/message_id`（`#resolveKey` 614-618）加 p2p 的 sender（`conversationKey` 32）。**引用结构（蓝色气泡的引用样式）不改变其中任何一个。**

### 1.3 对现场的判定

- 两个成功（引用、有线程标记）与一个失败（无线程标记）若如描述所示 `thread_id` 有无不同，则按 1.1 必然落到不同 key：成功侧 `group:<chat>:thread:<id>`（或 managed 映射），失败侧 `group:<chat>`。
- 不同 key → `state.sessionFor(key)`（`workspace-session.mjs:68`）查到不同绑定 → 无绑定时走 `createSession`（同文件 71）新建分支。这是代码层面的**必然**分叉，不是推测。
- turn 2 同文本成功与本次失败的并存同样被代码允许：`askInWorkspaceSession`（`workspace-session.mjs:44-107`，`while(true)` 65）只在“无绑定或绑定会话已不存在”时才 `createSession`（68-71）；老 key 有存活绑定则直接复用、**不经过 preset 校验**。preset 只在创建时注入（见 §4 引用的 `bot-workspace-store.mjs:1346-1352`）。
- `/preset=standard` 与 session 头 `agentPreset=ptc` 并存亦自洽：`/preset` 只改“新会话用什么”（`preset-command.mjs:97` 明确“已有会话不会受此设置影响”，`formatUpdated` 134-139 重申“已有会话不变……才会使用新设置创建会话”）。turn 4-7 的归属以 A/B/D 日志为准；C 仅确认代码允许老会话沿用创建时 preset。

---

## 2. 流式占位卡失败 recall 链

### 2.1 时序：卡先建，ask 后跑

- `bridge.mjs:3609-3646`（`#answerWithStream` 流式分支）：`this.#channel.stream(chatId, { markdown: async (controller) => {...} }, { replyTo: messageId, ... })`；`promptStarted = true` 置于 markdown 回调入口（3616），`askInWorkspaceSession` 在回调内部（3634），答完才 `controller.setContent`（3646 附近）。
- `feishu-channel.mjs:202-211`（`stream`）：进 `try` 先 `await this.#createStreamCard(chatId, options)`（211）并 `cards.push`，之后才 `await input.markdown(controller)`。**占位卡一定先于 ask 存在。**

### 2.2 失败路径：recall → 原样上抛 → 回复式错误文本

- ask 内抛 `agent-preset-unavailable`（建会话被 host 拒绝，见 §4）时 `completedAnswer` 仍为空串：`stream` 的 `catch`（`feishu-channel.mjs:267-272`）按注释“bridge 会重发完整答案，故先删卡免重复”对 `cards` 逐个 `await this.#recall(card.messageId)`（270）再 `throw`（271）。
- `#recall` 本体（`feishu-channel.mjs:510-518`）即 `im.v1.message.delete({ path: { message_id } })`（512-514）+ `assertApiSuccess`（515）；自身失败只 `console.warn` 吞掉（516-518）。**“小孙撤回一条消息”就是这一次 delete。**
- 回到 bridge：`completedAnswer` 为空跳过“生成后失败转文本重发”分支；`promptStarted` 已为 true 故 `3700`（`if (promptStarted) throw error`）直接上抛，**不走** 3703 的“建卡失败”文本 fallback 二次 ask（3702-3703 起）。
- 外层 `#handleMessageFailure`（`bridge.mjs:1096` 起，经 1079 `#recordFailure`/`setLastMessageFailure`）→ `classifyMessageFailure` 把 `agent-preset-*` 判为 `PRESET_UNAVAILABLE`（`message-failure.mjs:136`），文本为“当前 Agent Preset 不存在或暂不可用。请发送 /presetlist 后重新选择。”（同文件 79-80 行 `PRESET_UNAVAILABLE` 条目），`messageFailureText` 拼“错误码：…；参考号：…”（202-204），参考号缺省生成 `MF-` + 8 位大写（169）。随后 `#send(chat_id, failureText, { replyTo: message_id })` 发出（`#handleMessageFailure` 尾部；`#sendFailure` 1087-1094 同理）。

### 2.3 吻合度判定：完全吻合，且是必然对

占位卡 delete（可见为撤回）+ 错误文本新消息（含 `PRESET_UNAVAILABLE` + `MF-` 参考号）——正是本路径的**固定输出对**。补充两点边界（均属代码可证）：

- `PRESET_UNAVAILABLE` 类错误不可能触发“静默文本 fallback”（fallback 要求 `completedAnswer` 非空或 `promptStarted` 为 false，3700 行反之即抛）；所以失败现场**必有**错误文本，不存在只撤回不报错的变体。
- 代码只能证明“被删的是本次 `cards[]`（占位卡）”；截图里被撤那条是否为该占位卡，需对 `message_id` 日志（`status.lastMessageError.referenceId` 与 delete 目标），列入 §6 请 A/B 核对。

---

## 3. 多 bot 作用域：`/preset` 与普通消息的 botId 能否不一致

### 3.1 每个 bot 是独立 runtime + 独立 state + 独立作用域 harness

`plugin-src/host/channels/feishu/production.mjs`：

- `stateFor` 按 `botConfig.id ?? '__legacy__'` 分 state 文件（151-163，`stateForBotId` 160-163）；
- `createRuntime` 内 `workspaces.ensure(id, ...)` 后 `createBotWorkspaceScope(harness, { botId: id, workspaces, state, agentPresetCatalog })`（202-209），`new Runtime({ botId: id, harness: workspaceScope.harness, state: workspaceScope.state, ... })`（211-224）。

preset 存储是 bot 级：`agentPresets[botId]`（`bot-workspace-store.mjs:213` 归一化写入；`407-408` `agentPresetFor(botId)` 读取；`672-699` `setAgentPreset`）。会话绑定是 key 级但限定当前 scope：`scopedState` 代理 `sessionFor`/`setSession`（`bot-workspace-store.mjs:1494-1518`，`1497`/`1507` 两处 `isCurrentScope` 门卫）。

### 3.2 同一聊天同一 bot：必然一致

- `/preset` 系（文本命令经 `isPresetCommand` 分流 `bridge.mjs:847-855`；卡片经 `#handlePresetDefault/#handlePresetSelect`）：最终都调 `runPresetCommand(text, this.#harness, this.#state, key, ...)`（2881-2882，2904-2905），读则 `this.#harness.agentPresetSettings`（2588-2589，2689-2692，2735-2743，2768-2772）。
- 普通消息三处 ask（3564 无 stream 降级、3634 流内、3703 建卡失败 fallback）用的**同一个** `this.#harness` / `this.#state` / 同一个 `key`（`#answerWithStream(event, key, ...)` 签名 3538，`#interactionAskOptions(event, key, ...)` 3448 起亦只透传 key，无 preset 字段）。
- Bridge 构造时 `#botId` 只是记录性字段（569-574），真正的隔离由上游按 bot 建好的 scoped harness/state 承担。因此**同一聊天、同一 bot 服务时，“A 聊设 preset、B 聊失败”不存在 botId 分叉的可能**——两边是同一个 `agentPresetFor(botId)`。

### 3.3 代码层面分叉存在，但条件不在本现场

- 跨 bot 才会 preset 分叉：多 bot 同在一群、各 bot 有自己的 runtime/state/preset。管理面 `createWorkspaceAwareController` 的 `updateAgentPreset(botId, ...)`（`bot-workspace-store.mjs:1573-1590`，目录校验 1586-1588 抛 `unavailableAgentPreset()`）botId 来自管理调用显参，与消息面 runtime 隐式 botId 是两条来源——但本现场是“同一聊天”，无证据指向跨 bot。
- 同 bot 不同 key（thread vs 主 feed）共享同一 preset、会话隔离：`/presetlist` 的“当前选择”读的是 bot 级值（`presetSettings` 1170-1183），**读到 standard 不能证明失败分支 create 瞬间 host 仍接受 standard**。设置时校验目录（scoped `updateAgentPreset` 1201-1207：`catalog.items` 无此 id 即抛 `unavailableAgentPreset()`）与创建时 host 校验是两次独立检查，中间目录/远端变更即 TOCTOU。

---

## 4. 普通消息处理中是否还有第二处可抛 `agent-preset-*` 的调用

穷举（`git grep -n 'validateAgentPresetId\|unavailableAgentPreset' main`）：

- 抛出点共四处：`agent-preset.mjs:18-27`（`validateAgentPresetId`，格式非法→`agent-preset-invalid`，23 行）；`bot-workspace-store.mjs:1207`（scoped `updateAgentPreset`，目录无此 id→`unavailableAgentPreset()`，定义 1080-1084）；`bot-workspace-store.mjs:1588`（controller `updateAgentPreset` 同理）。
- 调用 `validateAgentPresetId` 的共五处：文档加载（216）、建 bot 默认（595）、`setAgentPreset`（680）、scoped 更新（1201）、controller 更新（1575）——**全部在配置/preset 命令面**，没有一处在普通消息问答路径。
- `bridge.mjs` 内与 preset 相关的调用只有读接口 `agentPresetSettings`（2588-2589 菜单快照、2689-2692 preset 卡、2735-2743 状态文本、2768-2772 状态卡）和命令面 `runPresetCommand`（49-51 引入、852-855 分流）。普通消息 ask 三处（3564/3634/3703）的 `askOptions`（`#interactionAskOptions` 3448-3463：`timeoutMs/signal/control/onInteraction/.../files`）**无 preset 字段**，`promptContentForInboundMessage`/`enhanceContextContent`（3548-3562）亦无 preset 引用。
- 唯一向量：`askInWorkspaceSession`（`workspace-session.mjs:44`）内部，新建分支时 scoped `createSession` 自动注入当前 bot preset（`bot-workspace-store.mjs:1346-1352`：`agentPresetFor(botId)` 非空即随 `target.createSession({...options, workspace, agentPreset })` 提交；既有会话走 `ask` 不带 preset）。host 拒绝（无论在 create 还是在首问校验，冒泡的 `code` 都是 `agent-preset-*`）→ 同一调用点向外抛 → §2 路径。**结论：不存在第二处。**

---

## 5. 综合重建（按代码允许度排序）

1. **最可能**：失败消息无 `thread_id` → key 为 `group:<chat>`；成功消息有 `thread_id` → key 为 `group:<chat>:thread:<id>`（§1）。失败 key 无存活绑定 → `createSession` 携带当前 bot preset（`standard`）→ host 侧此时已不接受 `standard`（被删/broken/远端不可用，`catalogItem` 遇 `broken` 直接丢弃，`agent-preset.mjs` 目录归一化逻辑）→ `agent-preset-unavailable` → 占位卡 recall + `PRESET_UNAVAILABLE MF-C3FF35A8`（§2）。`/presetlist` 仍显示 standard 是因为读的是缓存/目录快照或判异标准不同（TOCTOU，§3.3）。
2. **次可能**：`groupTopicReply` 开启时失败消息是被 @ 的主 feed 消息 → 以自身 `message_id` 开 `managed` 新分支（625-626），同样触发新建校验；成功侧复用老 thread 绑定故成功。是否开启以配置为准（`feishu-runtime.mjs` 构造透传 `groupTopicReply`，`multi-bot-controller` 按 bot 存该开关——C 未深究该开关面，留给 D）。
3. **可排除**：引用样式导致换 key（§1.2 两处读取均不产出 key）；`/preset` 与普通消息 botId 不一致（§3.2 同 runtime 同 scope）；普通消息第二抛错点（§4 穷举为零）；撤回与报错来自两条独立机制（§2 证明是同一 `catch` 的两步）。

---

## 6. 请 A/B/D 对账的日志点（C 的代码结论到此为止）

- `status.lastMessageError.referenceId` 是否为 `MF-C3FF35A8`，其 `reason/code` 是否确为 `PRESET_UNAVAILABLE`（`setLastMessageFailure`，`message-failure.mjs:206-210`）。
- 被 delete 的 `message_id` 是否等于本次 `stream.cards[0].messageId`（占位卡），以及 `#createStreamCard` 的 `replyTo` 是否为失败用户消息（`stream` 调用点 `bridge.mjs` 3613-3644 传 `{ replyTo: messageId }`）。
- 失败 key 到底是 `group:<chat>` 还是 `managed:<msgId>`（查 `accept` 729 行 key 值与 `groupTopicReply` 开关）。
- 成功 thread 的绑定会话是否即 session-4ba8e999（头 `agentPreset=ptc` 即创建时 preset 的化石），失败分支是否触发了 `createSession` 且携带 `agentPreset: standard`。
- host 侧失败瞬间的 preset 目录：`standard` 是否在 `catalog.items` 中、是否被标 `broken`（`agent-preset.mjs` `catalogItem` 丢弃规则）。

## 7. 一手源码清单（本报告唯一依据）

- `src/channels/feishu/message-utils.mjs`：`managedGroupKey` 17、`isTopicGroupKey` 24、`conversationKey` 29-44、`feishuReplyTargetId` 424-428、`extractInboundMessage` 526。
- `src/channels/feishu/bridge.mjs`：`#resolveKey` 613-629、`accept` 取 key 729（登记 735）、命令分流 847-855、`#sendFailure` 1087-1094、`#handleMessageFailure` 1096 起、`#answerWithStream` 3538 起（ask 三处 3564/3634/3703，重抛 3700）、`#isResolvedQuestionReply` 4079-4084、preset 读/写 2588-2589/2689-2692/2735-2743/2768-2772/2881-2882/2904-2905。
- `src/channels/feishu/feishu-channel.mjs`：`stream` 202（含建卡 211、回调 220-258、catch-recall 267-272、回执 263-266）、`#recall` 510-518（`message.delete` 512-514）。
- `src/channels/shared/workspace-session.mjs`：`askInWorkspaceSession` 44（循环 65、复用/新建 68-71、仅透传非 STALE 107）。
- `src/channels/shared/bot-workspace-store.mjs`：`agentPresets[botId]` 213、`agentPresetFor` 407-408、`setAgentPreset` 672-699、`unavailableAgentPreset` 1080-1084、`presetSettings` 1170-1183、scoped `updateAgentPreset` 1197-1225（校验抛 1206-1207）、create 注入 preset 1337-1352（注入 1346-1352）、`scopedState` 1494-1518（`sessionFor` 1497、`setSession` 1507）、controller `updateAgentPreset` 1573-1590（校验抛 1586-1588）。
- `src/channels/shared/preset-command.mjs`：已有会话不受影响 97、`formatUpdated` 134-139、快照 `saveSnapshot(state, key, ...)` 159-263（`presetlist` 写入 263，按 key 存序号快照——**这也是 key 相关**：不同 key 的序号快照互不可见）、`runPresetCommand` 251 起、错误文案 205-222。
- `src/channels/shared/agent-preset.mjs`：`validateAgentPresetId` 18-27（抛 `agent-preset-invalid` 23 行附近）、`catalogItem` 丢 `broken` 规则。
- `src/channels/shared/message-failure.mjs`：`PRESET_UNAVAILABLE` 文案 79-80、`agent-preset-` 映射 136、`MF-` 生成 169、`classifyMessageFailure` 177、`messageFailureText` 202、`setLastMessageFailure` 206。
- `plugin-src/host/channels/feishu/production.mjs`：`stateFor` 151-163、`createRuntime` + `createBotWorkspaceScope` 202-209、scope 入 Runtime 211-224。
- `src/channels/shared/semantic/reply-reference.mjs`：`hasReplyReference` 136。
