# preset 不可用：复现矩阵与 Host/目录实证（独立实证线）

与第一路（静态链路与 bug-or-not 裁决）并行、互补不重复。本报告只信一手来源：本仓库源码、测试、git 历史、CHANGELOG、本地真实配置文件（只读）与一次真实 Node 复现运行。每个断言后行内引用源路径 + 行号 / 提交 / 命令输出。

检查时刻工作区状态（与任务描述不符，先声明）：当前 HEAD 为 67ca895（分支 private/custom），不是任务所写的 fix/preset-standard-fallback (b73901a)；但 main 与 upstream/main 均为 1fa86ed（git rev-parse 两者输出一致），该点与任务描述一致。b73901a 仅存在于分支 fix/preset-standard-fallback（含远端同名分支），不是当前 HEAD 的祖先（git merge-base --is-ancestor b73901a HEAD 退出码 1）。除非另注，“当前工作树”指 private/custom @ 67ca895，其 src/channels/shared/agent-preset.mjs 与 main 一致（无大小写归一、无 legacy 兜底）。

---

## 1. 测试覆盖核实（一一核对四个文件）

### 1.1 test/preset-command.test.mjs（当前工作树 21 个用例，node --test 全过）

- “/preset 显示已不可用但不清除”：有覆盖 —— test/preset-command.test.mjs:121-129（agentPreset 设为 removed → 断言文案 removed（已不可用）+ 已有会话不会受此设置影响 + updateAgentPreset 未被调用）。复现运行 node --test test/preset-command.test.mjs：21 pass / 0 fail（命令输出见第 5 节）。
- “Host 默认不可用安全展示”：有覆盖 —— test/preset-command.test.mjs:131-144（defaultId 为 removed-default → /preset 显示 跟随 Host 默认（Host 默认当前不可用），/presetlist 显示 Host 默认：removed-default（当前不可用））。对应源码 src/channels/shared/preset-command.mjs:70-90。
- “/preset 坏 ID（格式合法但目录无此项）→ agent-preset-unavailable 安全文案且不泄漏内部字段”：有覆盖 —— test/preset-command.test.mjs:344-355（updateError.code 为 agent-preset-unavailable 且 message 含 path=/private 与 token=secret → 回复 不存在或当前不可用 且 doesNotMatch(/private|secret/)）。对应源码 src/channels/shared/preset-command.mjs:215-217。
- “/preset 格式非法 ID → agent-preset-invalid + 用法”：有覆盖 —— test/preset-command.test.mjs:328-333（/preset id:abc → 用法|格式无效）与 src/channels/shared/preset-command.mjs:294-296（normalizeAgentPresetId 返回 null → Agent Preset ID 格式无效）。
- “大小写”：当前工作树仅覆盖命令名大小写，不覆盖 ID 大小写 —— test/preset-command.test.mjs:49-61 断言 /PrEsEt coding、/PRESETLIST 可识别（源码正则带 i 标志，src/channels/shared/preset-command.mjs:10-11），但 test/preset-command.test.mjs:103-119 在当前工作树仍把 id 为 UPPER 的条目当作“无效条目被过滤”的例子（doesNotMatch 去掉 Invalid 字样）。即：当前工作树测试认定大写 ID 非法并过滤；大小写归一（PTC→ptc）只存在于 b73901a（见第 2 节），工作树无此行为。源码依据：src/channels/shared/agent-preset.mjs:4（AGENT_PRESET_ID 为小写字符集，无 i 标志）+ src/channels/shared/agent-preset.mjs:11-16（仅 value.trim()，无 toLowerCase）。
- “legacy code”：当前工作树无覆盖（grep legacy 在 test/preset-command.test.mjs 无命中；code 字样仅出现在普通 fixture id coding 中）。code→standard 兜底只存在于 b73901a 新增用例（见第 2 节）。
- “空目录”：/presetlist 空列表分支在源码有处理（src/channels/shared/preset-command.mjs:113-114，文案 当前没有可用 Agent Preset。），但本文件内没有空 catalog 的 /presetlist 用例；空目录的直接覆盖在 test/workspace.test.mjs:1692-1711（见 1.2）与 feishu bridge 的空 catalog 冒烟（见 1.3）。

### 1.2 test/workspace.test.mjs（preset 相关约 15 个用例）

- “残留坏值可持久化”：有覆盖 —— test/workspace.test.mjs:1603-1636（setAgentPreset 存 marketing-jeep → 文件含 agentPresets 映射；手写 agentPresets 含 standard-claude 重载后仍读出）。即 workspaces.json 是“坏值”的 durable 载体，源码 src/channels/shared/bot-workspace-store.mjs:672-699（setAgentPreset 只做格式校验，不查目录）。
- “agent-preset-invalid（格式非法）”：有覆盖 —— test/workspace.test.mjs:1652-1657（ensure 时 defaultAgentPreset 为 Not Valid → reject agent-preset-invalid 且 bot 未创建）与 test/workspace.test.mjs:1713-1721（当前工作树：setAgentPreset(bot_one, Standard) → reject agent-preset-invalid，agentPresetFor 保持 null）。注意该用例在 b73901a 中被改写（见第 2 节：Standard 归一为 standard 通过，CODE 落到 standard）。
- “agent-preset-unavailable（格式合法但目录无此项，set 时查目录）”：有覆盖两处 —— test/workspace.test.mjs:1849-1854（RPC：catalog 刷新掉 standard 后再设 standard → agent-preset-unavailable 且 agentPresetFor 保持 null）与 test/workspace.test.mjs:1905-1908（scope：updateAgentPreset(standard) → reject 同码）。源码 src/channels/shared/bot-workspace-store.mjs:1201-1208（updateAgentPreset：目录无此 id → unavailableAgentPreset()）与 src/channels/shared/bot-workspace-store.mjs:1080-1084（错误工厂）。
- “坏目录/空目录/缺文件”：目录路径三态有覆盖 —— test/workspace.test.mjs:309-311（相对路径→workspace-not-absolute；缺失→workspace-not-found；文件非目录→workspace-not-directory）；store 文件缺失 ENOENT → 空态启动有覆盖 —— test/workspace.test.mjs:989（删除后读文件报 ENOENT）+ src/channels/shared/bot-workspace-store.mjs:365-374（仅 ENOENT 走空态，其余 throw）。缺口：整份 workspaces.json 因“某一个 bot 的 agentPresets 值非法”而整体加载失败 —— 源码 src/channels/shared/bot-workspace-store.mjs:213-222（任一 preset 非法 → normalizeDocument 返回 null）+ src/channels/shared/bot-workspace-store.mjs:354-366（null → throw，只有 ENOENT 被吞，其余上抛），但测试只断言了 ensure 期 agent-preset-invalid（test/workspace.test.mjs:1652-1657），没有“手改 workspaces.json 写入大写/非法 preset 后 load 行为”的用例（见 1.5 缺口 G2）。
- “空目录（Host preset 目录为空 → catalog 空）fail-soft”：有覆盖 —— test/workspace.test.mjs:1692-1711（service 抛错 / defaultId getter 抛错 → listAgentPresetCatalog 返回 defaultId 为空 items 为空）；源码 src/channels/shared/agent-preset.mjs:64-76（try/catch → 空 catalog）。缺口：空 catalog 下普通消息新建会话是否报错、报什么码，无端到端用例（见 1.5 缺口 G2 配套）。
- “大小写 / legacy code”：当前工作树无归一、无兜底（见 1.1 源码引用）；b73901a 改写了 test/workspace.test.mjs:1713-1721（见第 2 节）。
- “改 preset 后老会话不受影响（不断会话）”：有覆盖 —— test/workspace.test.mjs:1723-1734（setAgentPreset 不调 clearSessions、generation 不变）+ test/preset-command.test.mjs:284-300（/preset 明确提示先发送 /new）。
- “新建会话把所选 preset 透传给 Host”：有覆盖 —— test/workspace.test.mjs:1736-1757（bot_one 设 marketing-jeep → createSession 收到含 workspace 与 agentPreset 的参数；未设置者无 agentPreset 键）。源码 src/channels/shared/bot-workspace-store.mjs:1337-1352。这是复现矩阵“老会话复用 vs 新建”分叉的直接依据。

### 1.3 test/channels/feishu/bridge.test.mjs（约 7600 行，preset/MF 相关 27 处命中）

- “/presetlist//preset 不建会话、不问模型”：有覆盖 —— test/channels/feishu/bridge.test.mjs:305-390（70 项大目录分页、/preset 2 更新、/preset --default 清除，全程 asks 为 0、creates 为 0、sessions 长度为 0）。
- “MF 参考号格式与回执关联”：有覆盖 —— test/channels/feishu/bridge.test.mjs:645-648（文案 错误码：MODEL_RATE_LIMIT；参考号：MF-8位十六进制 且与 status.lastMessageError.referenceId 一致）、test/channels/feishu/bridge.test.mjs:4614-4616、test/channels/feishu/bridge.test.mjs:5198-5199。源码 src/channels/shared/message-failure.mjs:166-170（safeReferenceId）+ src/channels/shared/message-failure.mjs:202-204（messageFailureText 拼 错误码与参考号）+ src/channels/feishu/bridge.mjs:1150-1163（failed [referenceId] 日志行，logLabel 默认为 operation，普通消息为 message handling 见 src/channels/feishu/bridge.mjs:1188-1193）。
- 缺口：bridge 层没有任何 PRESET_UNAVAILABLE / agent-preset 前缀码的端到端用例 —— 全文件 grep PRESET_UNAVAILABLE 与 agent-preset 命中为 0（27 处命中全是 agentPresetSettings 冒烟桩与 MF 格式断言）。即“普通消息因残留坏 preset 而失败→用户看到什么→日志哪一行”在飞书通道层零覆盖（见 1.5 缺口 G1 配套）。

### 1.4 test/message-failure.test.mjs（5 用例，全过）

- “agent-preset- 前缀 → PRESET_UNAVAILABLE”：间接覆盖 —— src/channels/shared/message-failure.mjs:136（code 以 agent-preset- 开头 → PRESET_UNAVAILABLE）+ src/channels/shared/message-failure.mjs:79-80（文案 当前 Agent Preset 不存在或暂不可用。请发送 /presetlist 后重新选择。），但 test/message-failure.test.mjs:1-107 的 5 个用例没有一个输入是 agent-preset-invalid/unavailable（用例覆盖 harness/model/channel/artifact 四类）。复现运行 node --test test/message-failure.test.mjs：5 pass / 0 fail。一行单测即可补，属高性价比缺口。

### 1.5 测试缺口 Top（按频繁线上问题排序）

- G1（最缺）：普通消息在残留坏 preset 下的老会话复用 vs /new 新建分叉，bridge 层零覆盖。源码分叉点明确（src/channels/shared/workspace-session.mjs:68-71：有可用绑定会话则复用并直接 ask，只有无会话/会话失效才 createSession；preset 只在 createSession 时透传，src/channels/shared/bot-workspace-store.mjs:1346-1352），测试却从未把两者连起来断言。本报告第 4 节用真实 BotWorkspaceStore + askInWorkspaceSession 把该分叉跑通了（复现成功），建议固化为用例。
- G2（次缺）：手改 workspaces.json 残留“格式非法”（大写/空格/恰好非法的已删 ID）导致整份文档加载失败。源码 src/channels/shared/bot-workspace-store.mjs:213-222 + 354-366 表明单个坏值可让 load() 整体 throw（非 ENOENT 不吞），但 test/workspace.test.mjs 只有内存态 agent-preset-invalid 用例（test/workspace.test.mjs:1652-1657 / 1713-1721），无“坏文件 → load 抛错 → bot 行为”用例。线上手改文件恰是高频操作，该缺口应优先补。
- G3（顺带）：test/message-failure.test.mjs 缺一行 agent-preset-unavailable → PRESET_UNAVAILABLE 断言（源码行 src/channels/shared/message-failure.mjs:136 有逻辑无用例）。

---

## 2. 历史：preset 相关提交、code 移除、大小写归一、legacy 兜底何时引入

- main（= upstream/main = 1fa86ed，git rev-parse 两者输出一致，均为 1fa86ed913073f69222099cf99917a7811b8594b）的 preset 主干（git log --oneline main -- src/channels/shared/agent-preset.mjs src/channels/shared/preset-command.mjs src/channels/shared/bot-workspace-store.mjs 输出）：6969186 feat: add private session two-way sync → 610fed4 feat: add per-bot model settings → … → eea29fe feat: add agent preset chat commands → 01576f6 fix: complete per-bot agent preset lifecycle → 3161816 feat: 按机器人选择 Agent Preset。
- 全分支 --grep=preset -i（git log --oneline --all --grep=preset -i）可见：b73901a fix(preset): case-insensitive ids, legacy code falls back to standard, never code、98c1e48 feat: add session and preset list aliases、eea29fe feat: add agent preset chat commands、01576f6 fix: complete per-bot agent preset lifecycle、8ab4b9e Merge PR #31 feat/per-bot-agent-preset、3161816 feat: 按机器人选择 Agent Preset、7e96c9c 与 8a64f2b honor Harness default agent preset。
- code 移除 / ptc-standard 取代：本仓库 git 历史与 CHANGELOG 中均无“移除 code preset”“ptc 取代 code”的提交或条目 —— git log -S ptc --all -- src plugin-src 输出为空；CHANGELOG 中 grep preset 13 处命中（行 244-245 别名、457-458 飞书菜单、568-569 tooltip、594-595 /presetlist 与 /preset 命令、610-611 per-bot 选择、706-707 Harness 默认创建）无一提及 code/ptc/大小写/legacy。code 字样只出现在 b73901a 提交信息与新增代码注释里（the removed code preset, now superseded by ptc/standard），其真实移除点在 DeepSeek Harness 上游（Host 侧目录），不在本仓库可考范围 —— 本报告如实记为“仓库内无一手证据”，不推测上游版本号。
- 大小写归一 + legacy 兜底 = b73901a 首次引入，且 main/工作树都没有：
  - git show b73901a --stat：7 文件，src/channels/shared/agent-preset.mjs 改 16 行、test/preset-command.test.mjs 改 23 行、test/workspace.test.mjs 改 9 行等。
  - git show b73901a -- src/channels/shared/agent-preset.mjs 的 diff：新增 STANDARD_AGENT_PRESET_ID（standard，注释 never fall back to code）、LEGACY_AGENT_PRESET_FALLBACKS（code 映射 standard），并把 normalizeAgentPresetId 从 value.trim() 改为 value.trim().toLowerCase() + legacy 查表。
  - git show main:src/channels/shared/agent-preset.mjs 与当前工作树逐行一致（仍为 trim 后直接正则校验，src/channels/shared/agent-preset.mjs:14），无 STANDARD_AGENT_PRESET_ID、无 LEGACY_AGENT_PRESET_FALLBACKS、无 toLowerCase。
  - 同提交同步改 plugin-src/client/agent-preset.js（normalizeAgentPresetId 加 toLowerCase + 同一张 legacy 表）与 plugin-src/host/channels/shared/agent-preset-rpc.mjs（validAgentPresetPayload 从正则直测改为调 normalizeAgentPresetId，注释写明 PTC→ptc、code→standard）。
  - 测试侧：git show b73901a -- test/preset-command.test.mjs test/workspace.test.mjs 把 id 为 UPPER 的过滤用例改为 id 为 has space（注释明示 Uppercase ids normalize to lowercase），新增用例“/presetlist normalizes uppercase ids and legacy code falls back to standard”（/preset PTC → 设置成功、/preset CODE → Standard（standard）），并改写工作树 test/workspace.test.mjs:1718（setAgentPreset(Standard) 从 reject 改为通过且读出 standard；新增 setAgentPreset(CODE) 读出 standard）。

---

## 3. 现网残留（本机真实配置，只读不写，脱敏记形状）

查找命令（PowerShell，均为只读；工作目录 D:/dsh-plugin/dsh-im）：

1. Get-ChildItem env:USERPROFILE 下 .dsh/integrations/dsh-feishu → 含 bots 目录、config.json（4916 B）、workspaces.json（6996 B）。
2. workspaces.json 顶层键 → version / workspaces / agentPresets / contextEnhancement / accessPolicies，version 为 2。
3. agentPresets 的 botId 键（只取键名，不读值）→ 仅 1 个 bot 有 preset 覆盖（bot_521180 开头）；workspaces 有 10 个 bot 键；bots 目录 10 个子目录，一一对应。
4. 值分类（不记原文，只记形状；判定正则即源码 src/channels/shared/agent-preset.mjs:4 的小写字符集）：该值长度为 3、字符类为 lower-valid、转小写后等于 code 为 False。结论：现网 workspaces.json 无残留坏值 —— 无大写、无 code、无已删 ID 的直接证据（但该合法小写 ID 是否仍在 Host 目录中存在，本地无法验证，需对照 Host 侧 agentPresets.list()；若 Host 侧该目录已被删，则下一次 /new 即复现第 4 节矩阵 C 行）。
5. bots 下 state.json（共 10 个）：抽查 bot_521180 开头者，顶层键为 version / sessions / seenMessageIds / watches / includeArchivedSessions；sessions 含 1 条 p2p:ou_ 开头键（sessionId 值长度 44）。结论：存在可复用的老会话绑定 —— 这正是第 4 节“老会话复用不报错”成立的现网前提；若该会话长期有效，用户在残留坏 preset 下发普通消息将静默沿用老会话的 preset，老问题被掩盖。
6. config.json：ConvertFrom-Json 报 Invalid object（偏移 4664 附近），未能按对象取键；为避免扩大读取面未继续深挖，仅记录“config.json 存在但本次未取证到 preset 相关键”，不做无残留断言。

---

## 4. 最小复现矩阵（4 种 × 老会话复用 vs /new 新建）+ MF 号关联

前置机制（一手源码）：普通消息先由 state.sessionFor 取绑定会话，有则复用问模型，只有无会话/会话失效才 createSession（src/channels/shared/workspace-session.mjs:67-71）；preset 只在 createSession 时透传（src/channels/shared/bot-workspace-store.mjs:1346-1352，agentPreset 为 null 时不传键）；/new 文本路径清绑定（src/channels/feishu/bridge.mjs:1309-1320，忙时拒绝见 1310-1317）；失败归一化 agent-preset- 前缀 → PRESET_UNAVAILABLE（src/channels/shared/message-failure.mjs:136，文案 79-80）；日志形如 [dsh-feishu] message handling failed [MF-…]（src/channels/feishu/bridge.mjs:1158-1162，经 #handleMessageFailure 1188-1193）。

实证运行（本机真实执行，非推演）：BotWorkspaceStore 存 removed-preset（可存，输出 stored: removed-preset）→ harness 桩按目录 standard 一项校验 → askInWorkspaceSession。输出：复用返回 sessionId 为 sess-old、answer 为 old-answer；新建抛 agent-preset-unavailable → classifyMessageFailure 得 PRESET_UNAVAILABLE，文案 当前 Agent Preset 不存在或暂不可用。请发送 /presetlist 后重新选择。，错误码行 错误码：PRESET_UNAVAILABLE；参考号：MF-REPRO01。复现成功。

- A /presetlist 显示当前选择“已不可用”：老会话复用不报错（/presetlist 只是展示，src/channels/shared/preset-command.mjs:259-268；当前值原样显示已不可用，preset-command.mjs:86-89；不调 updateAgentPreset，测试锁死见 test/preset-command.test.mjs:121-129；随后普通消息复用老会话同样不报错，本报告实证 reuse-ok）。/new 后新建：命令本身不报错，但下一条普通消息必走新建并报错（机理同 C 行新建列）。
- B /preset 设坏 ID（格式合法、目录无此项，如 removed-x）：命令即时报错 Agent Preset 不存在或当前不可用，请重新执行 /presetlist。（src/channels/shared/preset-command.mjs:215-217），存储不被污染（test/workspace.test.mjs:1849-1854 断言 agentPresetFor 保持 null）；老会话复用与 /new 后新建均同（命令期即拦下，与会话新老无关）。
- C 手改 workspaces.json 残留坏值（格式合法但目录已无，如 removed-preset）：老会话复用不报错（load 只做格式校验，src/channels/shared/bot-workspace-store.mjs:213-222；命中老绑定则直接复用，实证 reuse-ok；用户无感知，问题被掩盖）。/new 后新建报错：新建时透传坏 preset，Host 侧 createSession 抛 agent-preset-unavailable；bridge 回用户 当前 Agent Preset 不存在或暂不可用…… + 错误码：PRESET_UNAVAILABLE；参考号：MF-…（src/channels/shared/message-failure.mjs:79-80,202-204），日志一行 [dsh-feishu] message handling failed [MF-…]（src/channels/feishu/bridge.mjs:1158-1162）。实证输出 new-fails: agent-preset-unavailable + 分类 PRESET_UNAVAILABLE。
- D Host 目录为空（catalog 为空）：老会话复用不报错（复用不查目录，src/channels/shared/workspace-session.mjs:68-71）；/presetlist 显示 可用 Agent Preset（0）+ 当前没有可用 Agent Preset。（src/channels/shared/preset-command.mjs:111-114）。/new 后新建行为取决于残留值：若 agentPreset 为 null（跟随默认）则透传空（bot-workspace-store.mjs:1351 解构为空对象）→ 不走 preset 报错路径；若残留非空坏值则同 C 行报错。空目录本身 fail-soft（src/channels/shared/agent-preset.mjs:64-76 + test/workspace.test.mjs:1692-1711），但“空目录 + 非空残留”组合无测试覆盖（G2）。

MF 号关联操作（dsh web 日志）：

1. 用户报“错误码：PRESET_UNAVAILABLE；参考号：MF-XXXXXXXX”（8 位大写十六进制，格式断言见 test/channels/feishu/bridge.test.mjs:645-648）。
2. 在 dsh web 日志搜 failed [MF-XXXXXXXX]：普通消息对应行形如 [dsh-feishu] message handling failed [MF-XXXXXXXX]（src/channels/feishu/bridge.mjs:1159 经 #handleMessageFailure，1188-1193）；卡片/preset 相关操作 logLabel 不同（如 preset card 见 2767-2774、preset reset 见 2966），可用 label 区分是聊天失败还是卡片刷新失败。
3. 同一 referenceId 经 setLastMessageFailure 写入 status.lastMessageError（src/channels/shared/message-failure.mjs:206-210），bridge 测试以 status.lastMessageError.referenceId 回查用户文案尾（test/channels/feishu/bridge.test.mjs:648,4616,5199）—— 运维可同法核对。

---

## 5. 附：本报告用到的命令与输出摘要

- git rev-parse HEAD → 67ca8959a3f…；git rev-parse main / upstream/main → 1fa86ed9130…（一致）；git branch --show-current → private/custom。
- git merge-base --is-ancestor b73901a HEAD → 退出码 1（b73901a 非 HEAD 祖先）；git branch --contains b73901a --all → fix/preset-standard-fallback + remotes/origin 对应分支。
- git log --oneline --all --grep=preset -i 关键行：b73901a fix(preset): case-insensitive ids…、98c1e48 feat: add session and preset list aliases、eea29fe feat: add agent preset chat commands、01576f6 fix: complete per-bot agent preset lifecycle。
- node --test test/preset-command.test.mjs → 21 pass / 0 fail；node --test test/message-failure.test.mjs → 5 pass / 0 fail（工作树 private/custom 上执行）。
- 第 4 节实证 node -e（BotWorkspaceStore 真实落盘 tmp + askInWorkspaceSession）→ stored: removed-preset / reuse-ok / new-fails: agent-preset-unavailable / classified: PRESET_UNAVAILABLE。复现成功。
- 只写报告，未改源码（git status 工作树原有改动未触碰；本报告为唯一新增文件）。
