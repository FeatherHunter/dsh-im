# preset 不可用高频：静态 bug-or-not 裁决（独立静态线)

> 与姊妹线 docs/research/preset-unavailable-repro-and-host-evidence.md（实证线，未改动）互补：本线只做静态语义与 bug-or-not 裁决，不做复现运行，不改源码。只信一手来源（源码 / 文档 / 测试 / git 对象），每个断言标注源文件行号或提交。裁决基线为 main@1fa86ed（已验证与 upstream/main@1fa86ed 文件一致）。

## 0. 基线与环境偏差声明（先读）

- 任务描述称 HEAD 为 private/custom@67ca895 且工作树 agent-preset.mjs 与 main 一致。实测当前 HEAD 为 50a9797 private/custom（git rev-parse HEAD），其父合并为 cd7e167 merge: upstream main@1fa86ed (v4.11.0) into private/custom（git cat-file -p cd7e167 父节点 = 67ca895 + 1fa86ed）。
- git show main:src/channels/shared/agent-preset.mjs 与 git show upstream/main:src/channels/shared/agent-preset.mjs 输出一致：均为 76 行、无大小写归一、无 legacy 兜底（见 3A）。git show 67ca895:src/channels/shared/agent-preset.mjs 与 main 一致——任务描述在 67ca895 时成立。
- 但实测工作树（= HEAD，无未提交修改，git status --porcelain 仅有未跟踪的 issue 草稿与脚本）已含等效修复内容（STANDARD_AGENT_PRESET_ID / LEGACY_AGENT_PRESET_FALLBACKS / toLowerCase，工作树文件 90 行）。git merge-base b73901a HEAD = 1fa86ed（b73901a 仅在分支 fix/preset-standard-fallback 及其远端同名分支，不被 HEAD 包含），而 git diff 67ca895 HEAD -- src/channels/shared/agent-preset.mjs 显示 +16 行——即合并 cd7e167 在解冲突时吸入了与 b73901a 等效的内容，但无 ancestry 关系。
- 结论：以下全部裁决以 main@1fa86ed 语义为准（凡引用行号均为 git show main:<path> 实测行号；凡 main 与工作树一致的文件已用 git diff main -- <path> 验证为空）。工作树 HEAD 的修复内容仅在讨论 b73901a 时作为参照。

## 1. 失败归一链核实（逐段 verdict）

### 1.1 前缀映射：属实 —— src/channels/shared/message-failure.mjs:136

main:136：if (code.startsWith('agent-preset-')) return 'PRESET_UNAVAILABLE';（git show main:src/channels/shared/message-failure.mjs 共 244 行，工作树一致，git diff main 为空）。任何 agent-preset-* 错误码统一归一为 PRESET_UNAVAILABLE。注意它排在 workspace- 分支（135）之后、INPUT_INVALID（137-138）之前，顺序正确：agent-preset-invalid 不会被误吞为输入错误。

### 1.2 文案：属实 —— message-failure.mjs:79-80

main:79-80：PRESET_UNAVAILABLE: '当前 Agent Preset 不存在或暂不可用。请发送 /presetlist 后重新选择。'。用户侧最终文案即此（除非 bridge 传入 userMessage 覆盖，见 1.7）。

### 1.3 参考号：属实 —— message-failure.mjs:166-170

main:166-170 safeReferenceId：合法则沿用（/^[A-Z0-9-]{6,40}$/），否则 MF- 加 randomUUID 前 8 位大写。每次失败可关联日志。

### 1.4 拼装：属实 —— message-failure.mjs:202-204

main:202-204 messageFailureText：message 正文 + 错误码 + 参考号三段式（t('错误码：{code}；参考号：{referenceId}')）。用户看到文案 + 错误码 + 参考号。

### 1.5 普通消息分叉：属实 —— src/channels/shared/workspace-session.mjs:67-71

main:67-72（文件共 110 行，工作树一致）：withSessionBindingLock(state, key, …) 内 state.sessionFor(key) → 无 session 或 sessionExists 为假 → createSession(harness, createOptions) → state.setSession(key, sessionId)（72 行；若返回 false 则 return null，外层 continue 重试）。老会话复用 vs 新建的分叉点即此：残留坏 preset 只影响新建分支（创建时透传，见 1.6），已有绑定会话走 ask 不受影响——与 2.2 的需 /new 语义同源。

### 1.6 透传 preset：属实，且附带一个关键发现 —— src/channels/shared/bot-workspace-store.mjs:1346-1352

main:1345-1352（文件共 1743 行，git diff main 为空）：1346 行 const agentPreset = workspaces.agentPresetFor(botId)，1351 行 ...(agentPreset == null ? {} : { agentPreset })。存储的残留值被原样透传给 Host target.createSession，此处无任何目录复验。对比同函数的 model 分支（1353-1367）：model 在创建后有 selectSessionModel + sameModelSelection 确认，而 preset 没有任何对等检查。发现：普通消息新建路径对残留值是 blind passthrough；agent-preset-* 若在此爆发，只能来自 Host 侧 createSession 的拒绝（见 3C1）。

### 1.7 落盘：链条属实，但任务给出的行号已过期 —— 实测 main 行号如下

任务称 src/channels/feishu/bridge.mjs:1150-1193。实测：

- git show main:src/channels/feishu/bridge.mjs 共 4198 行；main:1150-1193 是 #processFastCommand 的命令执行与回帖循环（1150 为 waitForIdle 收尾、1163 为 #processFastCommand 起），不是落盘。
- 真正的落盘在 main:1072-1085 #recordFailure（1079 setLastMessageFailure(this.#status, error, …) + 1080-1083 failed 日志行）、main:1087-1094 #sendFailure（1088 record + 1090-1091 messageFailureText 拼装 + 发送）、main:1096-1125 #handleMessageFailure（1110-1115 record，logLabel='message handling'，1117-1119 拼装，1120-1124 发送）。
- 普通消息三处 askInWorkspaceSession 调用在 main:3564（非流式）、3634（流式 markdown）、3703（流式降级），三者参数结构一致（harness/state/key/text/content/contextEnhanced/createOptions/existsOptions/askOptions）。（工作树因私有附件快照补丁在文件头 +57 行，上述落盘段整体后移约 78 行：工作树 1150-1203 恰为 #recordFailure/#sendFailure/#handleMessageFailure，任务行号疑似按工作树 HEAD 误标。）
- Verdict：归一→拼装→record→发送的完整链存在且正确；普通消息任一分支抛出的 agent-preset-* 都会经 #handleMessageFailure 落为 PRESET_UNAVAILABLE 文案 + 参考号。行号引用按本节修正为准。

## 2. main 语义：残留保留 + 改后需 /new —— 设计如此（文档×实现×测试三方一致），不是归一链 bug

### 2.1 残留坏 ID 被保留并标记已不可用，不自动清除 —— 设计如此

- 文档：docs/机器人命令.md:17（工作树与 main 一致，git diff main 为空）——已删除或损坏的当前选择会保留并标记为已不可用，不会被自动清除。列表只公开安全的名称和 ID。
- 实现（读侧标记）：src/channels/shared/preset-command.mjs:86-89（与 main 一致）——存储值不在目录中时返回 已不可用 标记；Host 默认不可用对应 70-76 defaultDescription。测试：test/preset-command.test.mjs:121-129（main）removed（已不可用）+ 已有会话不会受此设置影响 + 未调用 updateAgentPreset。
- 实现（写侧只做格式校验）：src/channels/shared/bot-workspace-store.mjs:672-700 setAgentPreset —— 680 行仅 validateAgentPresetId(value)（格式），随后直接持久化，无目录查询。测试：test/workspace.test.mjs:1603-1636（main；该区无 diff）——marketing-jeep 可持久化到文件、手写 standard-claude 重载可读出：workspaces.json 是坏值的 durable 载体。
- 必须区分的第二条写路径（目录复验只发生在这里）：经 bot-scoped harness 的 updateAgentPreset（bot-workspace-store.mjs:1197-1228，1201-1208 无此 id 则 throw unavailableAgentPreset()，错误工厂 1080-1084）与 RPC updateAgentPreset（1573-1598，1583-1589 同码检查）。/preset 命令走此路径（preset-command.mjs:238-243 update → 301-304 withSessionBindingLock 内 update(harness, selected)）。测试：test/workspace.test.mjs:1854-1859（RPC：目录刷新掉 standard 后再设 → agent-preset-unavailable 且存储保持 null）、1910-1913（scope 同码拒绝）。
- 裁决：保留残留是深思熟虑的设计（目录瞬断/改名时不丢用户选择 + 脱敏展示），文档、读侧、写侧、测试四方一致，不是缺陷。真正的体验问题是它与 B2 叠加（见第 4 节）。

### 2.2 改完要 /new 才生效 —— 设计如此

- 实现：preset-command.mjs:134-141 formatUpdated，139 行明示已有会话不变。若当前聊天已有会话，请先发送 /new，再发送普通消息，才会使用新设置创建会话。
- 测试：test/workspace.test.mjs:1723-1734（main）——setAgentPreset 不调 clearSessions（clears === 0）、generation 不变。
- 文档：docs/机器人命令.md:20——不会修改、停止、解绑或重建已有 Session，也不会自动执行 /new；发送 /new 后的下一条普通消息才会按新设置创建。
- 裁决：会话不变性设计，不是缺陷；但它是改完仍报错体感的来源（用户改完直接发普通消息，命中的仍是 1.5 分叉的老会话复用分支或带旧残留的新建）。

## 3. 三类清单

### A. 确认为 bug（main@1fa86ed，静态可定论）

B1. 大小写敏感拒收 —— bug。main:src/channels/shared/agent-preset.mjs:4 AGENT_PRESET_ID = 小写字符集（无 i 标志），main:11-16 normalizeAgentPresetId 仅 value.trim()、无 toLowerCase。后经测试锁定：test/workspace.test.mjs:1718-1720（main）setAgentPreset('bot_one','Standard') → reject agent-preset-invalid 且保持 null；目录条目过滤 catalogItem（main:29-44）同样走该归一，大写目录项被静默丢弃（test/preset-command.test.mjs:103-119 main 把 UPPER 当无效被过滤例）。而命令名正则带 i（preset-command.mjs:10-11），itemFor 用全等比较（66-68）——命令层大小写不敏感的承诺在 ID 层断裂。修复参照：提交 b73901a（fix(preset): case-insensitive ids, legacy code falls back to standard, never code，父节点 1fa86ed，仅分支 fix/preset-standard-fallback）将归一改为 trim().toLowerCase() 并改写上述两处测试（工作树 HEAD 已吸入等效内容，见第 0 节）。用户照 presetlist 显示的大小写输入即被拒，是高频诱因之一。

B2. legacy code 无迁移，残留永久失败 —— bug（频繁之首）。main 全仓无任何 code 特殊处理（grep code 兜底/LEGACY 唯一命中是 b73901a 引入的 STANDARD_AGENT_PRESET_ID='standard' / LEGACY_AGENT_PRESET_FALLBACKS）。DSH 已下架 code（见 b73901a 提交信息与常量注释 superseded by ptc/standard；注释为二手描述，但main 无迁移逻辑是静态事实）。叠加 2.1 的保留语义：历史选过 code 的机器人，其残留值每一次普通消息新建会话都透传（1.6）→ Host 拒绝 → PRESET_UNAVAILABLE。符合频繁的全部特征。修复参照即 b73901a 的 code→standard 兜底（normalizeAgentPresetId 内 hasOwn(LEGACY) 分支）。

B3. 单个坏 preset 毒化整份 store 文件 —— 健壮性 bug（严重度低于 B1/B2）。bot-workspace-store.mjs:213-222（main）：agentPresets 任一条目非法（validateAgentPresetId 抛错或返回 null）→ normalizeDocument 直接 return null；354-366 load()：null 则 throw，只有 ENOENT 走空态，其余上抛。对比同函数内 contextEnhancement（242-249）是按 bot 隔离损坏的——preset 未享受同等待遇，粒度过粗。一次手误改文件/一次大小写残留可导致整机器人配置加载失败。测试只覆盖 ensure 期拒绝（workspace.test.mjs:1652-1657 main），无 load 期整档作废用例（见 G2）。

### B. 设计如此但体验差（不判 bug，但应修体验）

D1. 残留保留 + 标记（2.1）—— 设计如此；差在与 B2 叠加时变成永久失败，且 preset-command.mjs:215-217 的更新失败文案是固定句式（见 D3），用户不知道卡住的是历史残留。

D2. 改后需 /new（2.2）—— 设计如此（会话不变性）；差在用户心智是改完即生效，改完直接发普通消息仍撞旧会话/旧残留，体感为改了没用。

D3. 报错不带坏 ID（脱敏）—— 设计如此（安全），体验差。preset-command.mjs:215-217（main）：agent-preset-unavailable → 固定文案不存在或当前不可用，请重新执行 /presetlist。，不回显 ID；意图由测试锁定：test/preset-command.test.mjs:344-355（main）path 与 token 均被 doesNotMatch 挡掉。但读侧 /preset（86-89）是显示坏 ID 的——查看时给 ID、报错时不给让用户无法把报错与残留对应起来，只能反复试。折中建议（未实施）：回显归一化后的 ID（dsh-im 自有数据，非 Host 内部字段），安全与可调试兼得。

D4. 空目录 fail-soft —— 设计如此。agent-preset.mjs:64-75（main）listAgentPresetCatalog try/catch → 空 catalog；preset-command.mjs:113-114 空列表文案当前没有可用 Agent Preset。；--default 在目录不可读时仍可恢复（workspace.test.mjs:1921-1928 main：catalogFailure 下 updateAgentPreset('--default') 成功并返回空 catalog）。差在空 catalog 与非空残留组合行为未定义给用户：此时 /presetlist 显示空、新建消息带残留调 Host，结果取决于 Host（见 C3）。

### C. 需 Host 侧证据才能定论（静态到此为止，列出缺的证据）

C1. 普通消息期 agent-preset-* 的精确生产者与码形。dsh-im 侧能抛 agent-preset-unavailable 的只有两处，且都在设置路径（bot-workspace-store.mjs:1207、1588），普通消息新建路径（1346-1352）无校验。因此用户在普通消息中看到的 PRESET_UNAVAILABLE，其 error.code 必须由 Host createSession（或其下游 preset 解析）返回。本仓库无 Host 实现（一手来源缺失），以下均需 Host 日志/抓包确认：码是否确为 agent-preset- 前缀（决定 136 分支是否命中，否则落 INTERNAL_UNKNOWN）、是否经 details.providerCode 走 95-100 的 PROVIDER_FAILURES 分支、message 中是否携带可定位残留值的字段。静态只能确认消费端映射正确。

C2. Host 下架/重命名 preset 的真实频率与空窗特征。B2/D1 是否为频繁主因，取决于 Host 侧 preset 目录变更（下架 code、改名、损坏标记 broken）的实际发生频率。需 Host 侧目录变更记录。注意目录项 broken 语义 dsh-im 侧是过滤（catalogItem main:35 + 测试 workspace.test.mjs:1664-1690 main），损坏与删除在用户侧文案无区别（都是已不可用/当前不可用），故障定位需 Host 侧 broken 原因。

C3. 空 catalog 与残留组合在真实 Host 上的行为。fail-open（Host 忽略未知 preset 建会话 → 用户静默跑错 preset）还是 fail-closed（抛 agent-preset-* → 高频报错）？dsh-im 侧两种测试各有一半（1921-1928 --default 可过；1854-1859 设坏值被拒），但普通消息新建分支无用例（G1），需一次带残留的真实 createSession 观察才能定论。

### G. 测试缺口（静态可判定，补在 B/C 之外，便于排期）

G1. bridge preset 失败分支零覆盖（修正笼统的bridge 零覆盖：test/channels/feishu/bridge.test.mjs 存在且庞大，lastMessageError 相关 14 处：645-648、3689-3732、3867-3868、4611、5198-5239；但 grep agent-preset- 与 PRESET_UNAVAILABLE 在该文件零命中）。即归一/落盘通用路径有覆盖，preset 专属的普通消息失败文案（请发送 /presetlist 后重新选择 + 错误码 + 参考号）无 bridge 端到端用例。其他渠道 bridge 同理只有 agentPresetSettings/updateAgentPreset 的 fixture 透传（qq 812-838、weixin 982-1010、wecom 445-467），无失败分支。

G2. 坏文件 load 抛错无用例（对应 B3）：213-222 + 354-366 的单坏值→整档 null→throw 无 load 测试；workspace.test.mjs 坏文件相关仅 989 行 ENOENT 断言，1652-1657 覆盖的是 ensure 期而非 load 期。建议用例：手写含大写/非法 preset 的 workspaces.json 后 load() 行为（抛错 vs 隔离 vs 归一）。

G3. 残留 × 空/变目录 × 普通消息新建三元组合无覆盖：空 catalog（1692-1711）与 update 期 unavailable（1854-1859、1910-1913）各自有覆盖，但三元组合（已持久化残留 + 目录变空/变脸 + 普通消息触发新建）无用例——正是线上频繁形态，即 G1 的 preset 特例。

## 4. 摘要：bug-or-not + 频繁 Top3

- 总判：归一链（136/79-80/166-170/202-204/67-71/1346-1352/落盘）实现正确，不是 bug；残留保留与需 /new 是设计如此。真正的 bug 是 B1（大小写）与 B2（legacy code 无迁移），B3（整档毒化）为健壮性 bug；D1-D4 为体验差；C1-C3 必须等 Host 证据。
- 频繁 Top3：1）legacy code 残留永久失败（B2＋D1 叠加，一中招则每条新会话必现）；2）大小写拒收（B1，照显示输入即被拒）；3）fail-late 放大体感（透传 1.6 平时静默、普通消息时爆发，叠加 D3 无 ID 导致重复试错）。
- 与 b73901a 的关系：b73901a（分支 fix/preset-standard-fallback，父 1fa86ed）恰好修复 B1+B2（toLowerCase + code→standard + RPC validAgentPresetPayload 改用 normalizeAgentPresetId + 两处测试改写）。HEAD（50a9797，经合并 cd7e167）已含等效内容但 main 未合入——本裁决的对象 main 仍为有 bug 状态。

## 附：复核命令（均一手可复现）

    git rev-parse HEAD; git branch --show-current
    git show main:src/channels/shared/agent-preset.mjs        # 76 行，无 toLowerCase/LEGACY
    git show upstream/main:src/channels/shared/agent-preset.mjs
    git show 67ca895:src/channels/shared/agent-preset.mjs     # 与 main 一致
    git merge-base b73901a HEAD                               # = 1fa86ed（b73901a 非祖先）
    git branch -a --contains b73901a                          # 仅 fix/preset-standard-fallback
    git diff main -- src/channels/shared/message-failure.mjs src/channels/shared/workspace-session.mjs src/channels/shared/bot-workspace-store.mjs src/channels/shared/preset-command.mjs docs/机器人命令.md  # 均空
    git show b73901a --stat                                   # B1+B2 修复范围
