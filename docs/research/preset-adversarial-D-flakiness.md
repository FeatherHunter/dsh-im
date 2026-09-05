# 间歇性 preset 失败：H1-H5 对抗验证（D 线）

与 A/B/C 并行、互补不重复。本线只回答“为什么时好时坏”。
只信一手源码。基线 main = upstream/main = 1fa86ed（git rev-parse main 与 upstream/main 均为 1fa86ed913073f69222099cf99917a7811b8594b；现场 HEAD 为 50a9797 private/custom）。
以下引文均以 `git show main:<path>` 为准；凡工作树与 main 一致的已用 `git diff main HEAD -- <path>` 验证为空，不一致处正文声明。
本报告不改源码，不碰他人的报告。

## 0. 现场模型（H1-H5 的共同底座）

现场矛盾（直接取用）：同一聊天、同一 bot、存量 standard、目录含 standard，却前三条成功、下一条新建失败。
成功走复用（不碰 preset），失败走新建（透传被拒）。session-4ba8e999 头 agentPreset=ptc，turn 4-7 成功；失败的卡路里 help 不在该 session 日志里（另有一次同文本在 turn 2 成功）。

分叉点：git show main:src/channels/shared/workspace-session.mjs（git diff main HEAD 为空，工作树一致）：
sessionFor 取映射，有则 sessionExists 验证，任一不通过则 createSession 新建，setSession 持久化，最后 ask。catch 中只有 WORKSPACE_SESSION_STALE 才重试，其他直接 throw。
复用路径不碰 preset：bridge.mjs（main）三处普通消息调用 askInWorkspaceSession 传入的 createOptions/existsOptions 均为 signal，不带 preset（git show main:src/channels/feishu/bridge.mjs 可复现；工作树因 private media 补丁行号后移约 200 行，语义一致）。
新建路径必然透传存量 preset：bot-workspace-store.mjs createSession 代理读 agentPresetFor(botId)，非空即随 session.create 发出，无目录复验。
harness-client.mjs createSession 不对 preset 做目录校验，直接装包：有就发，无就省略（跟随 Host 默认）。
推论：前三条成功与存量 standard 合法不矛盾（复用不声明 preset）；下一条新建失败只证明那一次 session.create 被拒。这就是间歇的形状：复用掩盖，新建暴露。

## H1. Host 目录闪断：列表 fail-soft 与创建严格校验不对称

假设：listAgentPresetCatalog 失败吞错返回空目录，而 session.create 严格校验，造成列表时刻有、创建时刻无。

证据（main）：
1) 列表端 fail-soft 白纸黑字。git show main:src/channels/shared/agent-preset.mjs 末尾函数：try 取 service.list，失败 catch 直接返回 defaultId 空 items 空。调用方无法区分真空与没拿到。normalizeAgentPresetCatalog 对坏数据同样收敛为空目录。工作树 78-90 行与 main 骨架一致，差异仅大小写归一与 legacy 兜底常量（b73901a 等效内容被合并吸入，见 H4）。
2) 写入端严格。bot-workspace-store.mjs 两处 updateAgentPreset（作用域版约 1197-1210 行，控制器版约 1573-1590 行，main 实测）均在提交前 await resolveAgentPresetCatalog 并比对 catalog.items.some(id)，缺失即抛 unavailableAgentPreset（code agent-preset-unavailable，工厂约 1080-1084 行）。
3) 新建端无复验。createSession 代理（约 1337-1352 行，main 实测）读 agentPresetFor 即发 Host，无 catalog 门卫。harness-client createSession（约 984-991 行）直接把 agentPreset 装入 session.create payload。
结论：列表/写入看此刻目录快照，新建看 session.create 那一刻真相，两者无原子性。若 Host 目录视图在两次调用间闪断（重启中、替换、权限抖动、多副本不一致、list 抛错被吞），即出现 presetlist 刚看到 standard、新建即被拒。

验证/证伪：机制证实，单独定案不足。fail-soft 写成期望行为（test/workspace.test.mjs:1692-1711 service 抛错即空 catalog），而空 catalog 下普通消息新建是否报错无端到端用例（姊妹实证线已点名此缺口）。但任务给定失败时刻目录含 standard，若该含为 Host 真相，则 H1 要求毫秒级有-无-有，需 Host 侧闪断实证（Host 日志、list 连续采样），本仓库无 Host 实现，无法单方面定案。定位：间歇放大器，待 Host 实证升主因。前三条若走复用，闪断对它们不可见，恰好解释观感。

## H2. 并发：/preset 写入与普通消息新建的竞态

假设：/preset（或 workspace 切换）与普通消息 session.create 并发时，因锁域不同读到新旧交错组合而被拒。

证据（main）：两套锁，锁的不是同一东西。
1) 消息临界区按会话 key。session-binding-lock.mjs 全文 40 行（git diff main HEAD 为空）：按 state 对象分桶再按 key 串行，注释要求长任务 ask 放锁外。workspace-session.mjs 把 sessionFor-sessionExists-createSession-setSession 包进该锁，ask 放锁外。横向（同 key 串行），非纵向（消息 vs 配置互斥）。
2) 配置临界区按 bot。bot-workspace-store.mjs withBotTransition 按 botId 排队，updateAgentPreset/updateWorkspace/updateModel 均经此串行，incarnation 入队前捕获。
3) 消息创建只等不占。createSession 代理首行为 await workspaces.whenBotIdle(botId)。whenBotIdle（约 570-578 行）忙等 bot 队列排空即返回，不持有锁。返回后读 agentPresetFor 再调 target.createSession，窗口无互斥。
4) generation/incarnation 事后围栏非事前互斥（约 1372-1522 行实测）：sessionGenerations 在 create 成功后 set，在 sessionExists/ask/executeCommand 比对 generationFor，不等则 false 或 WORKSPACE_SESSION_STALE；scopedState.sessionFor 在非 isCurrentScope 返回 null，setSession 失配返回 false（workspace-session 收到 false 即 return null 再 continue 重试本条）。能发现切换并重试，不能阻止读旧发新或写时有发时无。
5) 目录复验只在写入不在新建（见 H1）。可达交错：/preset 校验通过排队，消息 whenBotIdle 返回读旧 preset，/preset 提交（setAgentPreset 不碰 generation，test/workspace.test.mjs:1723-1734 断言），消息用旧 preset 调 create，Host 按创建时刻真相校验；或反向读到新值而 Host 尚未就绪。均为 nondeterministic 拒绝。

验证/证伪：机制证实，本案触发无证据，保留次因。同 key 普通消息被 withSessionBindingLock 串行不会互斥新建；不同 key 本来各建各。H2 若成立，日志应有失败窗内 updateAgentPreset/setWorkspace 或 STALE 重试簇，任务未提供。判别实验 E2 可一票确认或排除。解释力：说明为什么偏偏是下一条（恰与提交交错即现）。

## H3. sessionExists 闪断：本该复用的消息误入新建

假设：Harness 重启、会话过期被删、workspace 切换清映射、state 丢失使 sessionExists 变 false，本可复用被迫新建撞上校验。

证据（main）：
1) Harness 层 sessionExists 仅 session-not-found 返回 false，其他上抛。harness-client.mjs 约 1032-1040 行：try 调 session.history，不存在返回 false，超时断连等全部 throw（调用方整条失败而非新建）。
2) 作用域层加本地 false。bot-workspace-store.mjs 约 1411-1462 行：workspaceSession 句柄版 sessionExists 在非 isCurrentSession 直接 false，问完 Host 再验一次；scoped harness 版在非 isCurrentScope 或 generation 失配直接 false。generation 失配即删记录返 false，不问 Host。
3) sessionFor 空路径。同文件约 1497-1505 行：非 isCurrentScope（has 且 incarnation 相等才算当前）直接返回 null，不问磁盘。
4) 清映射调用点：switchWorkspace 传 clearSessions（state.clearSessions），控制器 updateWorkspace 同，bindWorkspaceSession 传 clearSessions+setSession 并双检 expectedGeneration，deleteWithWorkspace 经 beginRemoval/finishRemoval 清会话。
5) 磁盘层：feishu/state-store.mjs（main 实测）：sessionFor 即 sessions[key]，setSession/clearSession/clearSessions 改内存加 persist（mkdir-write tmp-rename，无跨进程锁）。load 仅 ENOENT 走空态，其他抛错：文件损坏不会静默变空而是启动失败，特此澄清，state 丢失指 clearSessions 或文件被换/删后重建空态。
6) Host 侧消失：workspaceId 不存在会自动 workspace.create；Harness 重启/GC/过期/归档后旧 sessionId 的 session.history 回 session-not-found 即 false，下条新建。重启后首条必新建即此来源。
7) 同一聊天可对应不同 key：bridge.mjs #resolveKey（main 约 613 行起，Select-Object -Skip 605 实测）：p2p 用 conversationKey，group 按 thread_id/managed-topic/group:chatId 分流；groupTopicReply 开时主 feed 被 @ 提问开全新 managedGroupKey 新会话，天然新建。同一群聊不等于同一会话 key。

验证/证伪：分叉解释证实，病因解释证伪。任一 null/false 迫使下条 create，而复用成功对 preset 失明，故前三成功一下新建的形状必须经 H3（或天然新 key）解释；但 sessionExists 真假与 preset 合法正交，H3 不回答为何被拒，属范畴错误若当病因。
session-4ba8e999 解读：头 ptc 且 turn4-7 成功只证明那个 key 的复用正常；卡路里 help 不在该 session 日志且同文本另有 turn2 成功，即不同 key/会话症状（不同 thread、managed 新 key、映射已清），非同一 session 内突变。若同 session 失败应有同 sessionId 下 create 拒绝或 ask 失败。不在日志本身即走了另一 key 新建的旁证。
结论：H3 必要前件（放大器）。任何拒因（H1/H4/Host 真相）须经 H3 或首条天然新建才被观测。

## H4. 双消费者：两个 dsh-im 进程或新旧版本同时消费飞书事件

假设：两进程（或新旧版本）同凭证消费飞书事件，一个成功复用，一个新建失败，交替即间歇。

证据（main）：
1) 去重进程内有效跨进程无效。bridge.mjs（main）：#acceptedMessageIds 为实例内存 Map（约 456 行），入口约 723 行检查 hasSeen 或 acceptedMessageIds 有即丢；处理中 set 完成后 delete。state.hasSeen/markSeen 持久化经 state-store #persist（in-process writeQueue 加 tmp-rename，无 flock）。两进程同 app 凭证各建长连接，服务端各推一份，跨进程同时检查可同过 hasSeen=false，同 message_id 各处理一次；state 文件若同路径则后写覆盖先写（sessions/watches/seen 整体快照覆盖），若异路径则彻底分叉（各有 sessions 映射与 seen 窗）。结构上双消费可达。
2) 版本漂移真实存在。git log main..HEAD 显示 private/custom 在 upstream v4.11.0 上叠 media-isolation 等补丁（bridge 约多 390 行，agent-preset 多 16 行等）；b73901a（fix preset 大小写归一、code 回落 standard）仅在分支 fix/preset-standard-fallback 及其远端同名分支，git branch --contains b73901a 只列该分支，git merge-base --is-ancestor b73901a main 退出码 1（非祖先），merge-base main b73901a 为 1fa86ed。main 与工作树 agent-preset 差异即此 16 行：main 仅 trim，工作树加 toLowerCase 与 LEGACY_AGENT_PRESET_FALLBACKS。Host 与插件若跨版本混部，对大小写/legacy 的合法性判定即不一致。

验证/证伪：主因证伪，运维待排除。双消费预测症状为同 message_id 被处理两次（重复回复、seen 竞写、两进程日志各一条），而非同聊天 sequential 不同文本交替复用/新建且 session 不同。现场前三成功后一失败为不同文本 sequential 消息，无重复投递证据；session-4ba8e999 的 ptc 复用与卡路里新建分属不同会话，与双消费的同 id 双处理不匹配。故 H4 不能解释本案形状，转为必须排除的运维项：不断掉第二消费者之前，H1-H3 的采样都可能被污染。

## H5. 粘性循环：新建失败则不存会话、下条必重试新建

假设：失败不存映射导致下条必走新建，把单次偶发变成持续不可用观感（高频体感）。

证据（main）：workspace-session.mjs 绑定块：sessionId 等于 await createSession 结果后，才调 state.setSession；create 若 throw 则 setSession 永不执行，异常经 catch（仅 STALE 重试）直接上抛，本条无映射写入。下条同 key 再次 sessionFor 得旧值或空，sessionExists 再验，再次 create 同一存量 preset。若 preset 在 Host 侧持续不可见，则 deterministic 全败，直到 preset 被改、映射被手工重绑、或某 key 切回可用 session（复用才绕开）。scopedState.setSession 返回 false（generation 失配）确有本条内 continue 重试，但 preset 拒绝非此路径，不触发该重试。
另：setAgentPreset 不清会话不 bump generation（test/workspace.test.mjs:1723-1734），故改 preset 后老会话仍复用旧 session；/new 同样调 create 同一 preset，同样失败。用户体感高频，但根因仍是首错 nhựa persist。

验证：证实为放大器，证伪为首因。它解释持续性，不解释首错；首错须 H1/H2/Host 真相给出，H3 给出分叉，H5 把一次变成一片。

## 6. 最小判别实验（用户可执行，只读优先）

原则：先只读区分 H1-H4，再做一次写确认。每步记录 message_id、conversation key、sessionId、时间戳、Host 与插件版本。

E1 区分 H1（目录闪断）与 H3（误入新建）——只读：
- 失败前后各执行一次 /presetlist，记录 standard 是否间歇消失；若闪断即 H1 嫌疑上升。
- 读 workspaces.json 该 bot 的 agentPresets（只读 cat），确认存量确为 standard；读 state 文件 sessions[失败 key]，确认失败 key 映射前后值。
- 查 Harness 侧 session.list（或日志 session.history 结果）：若旧 session 仍存在而插件仍新建，即本地 generation/incarnation 或 key 分叉（H3 本地型）；若旧 session 已无（session-not-found），即 Host 侧过期/重启/删除（H3 Host 型）。
- 查失败那条 session.create 的 Host 入参 payload.agentPreset 与 Host 返回码：若入参 standard 而 Host 报 unavailable，而同时刻 agentPresets.list 含 standard，即 H1 的快照-真相 skew 实锤方向。

E2 排除/确认 H2（并发）——只读为主：
- 以失败时间戳为中心前后 30 秒 grep 日志 updateAgentPreset、setAgentPreset、setWorkspace、switchWorkspace、bindWorkspaceSession、WORKSPACE_SESSION_STALE、whenBotIdle。若空窗干净，H2 触发证据为零，降级。
- 若有并发提交，对比提交前后 catalog 快照与失败入参 preset 是否分属新旧代。若命中交错窗口，串行复测一次（先等空闲再发）看是否消失。

E3 确认 H3（key 分叉 vs 映射丢失）——只读：
- 记录失败消息的 chat_type、chat_id、thread_id、是否为 managed topic（key 形如 group:chat:managed:xxx 或 group:chat:thread:xxx）；对比 turn4-7 的 key。若 key 不同，即天然新建，H3 定案为分叉原因，与 preset 无关。
- 若 key 相同，对比失败前后 state.sessions[key] 与 generation/incarnation（status 快照）：映射被清或代际变化即切换型 H3；映射未变而 session-not-found 即 Host 失效型 H3。

E4 一票否决 H4（双消费/混版本）——只读：
- 列出同飞书 app 凭证的 dsh-im 进程（ps、容器副本数）与各自 state 文件路径、seenMessageIds 尾部、messagesReceived/Replied 计数；双活即先停其一再复测。
- 核对各端版本：dsh Host 版本、插件版本、normalizeAgentPresetId 是否含 toLowerCase（有即 b73901a 等效，无即 main 行为）；混部即先对齐再复测。同 message_id 在两端日志各出现一次即双消费实锤；无则 H4 出局。

确认性写实验（仅当前面只读仍不明时做其一）：单消费者、空闲态、固定 standard 后连发三条同 key 文本（复用应全过），再构造一次必然新建（换新 thread 或清该 key 映射后发同文本）。若复用全过而新建必败，即复用掩盖/新建暴露闭环，与 H5 粘性一致，根因锁定新建入参与 Host 真相之差。

## 7. 总 verdict

- H1 机制证实、单独不足：fail-soft 对严格校验不对称成立，需 Host 闪断实证升主因。
- H2 机制证实、本案无触发证据：锁域分离真实存在，保留次因，E2 可决。
- H3 分叉证实、病因证伪：误入新建是必要前件，session-4ba8e999 与卡路里分属不同会话支持此判读。
- H4 主因证伪、待排除：结构可达但症状不匹配（缺同 id 双处理），E4 一票否决；混版本（b73901a 仅别分支）是采样污染源，先对齐版本。
- H5 放大器证实、首因证伪：失败不存映射致下条必重试，解释高频体感，不解释首错。

一句话：复用掩盖（H3 分叉）加新建暴露（H1/Host 真相）是间歇的形状，粘性（H5）是高频的成因，并发（H2）与双消费（H4）是必须先排除的污染源。

## 附：核验命令（本报告实际执行）

git rev-parse HEAD/main/upstream/main；git show main:src/channels/shared/agent-preset.mjs；git show main:src/channels/shared/workspace-session.mjs；git show main:src/channels/shared/session-binding-lock.mjs；git show main:src/channels/shared/harness-client.mjs；git show main:src/channels/shared/bot-workspace-store.mjs（Select-Object 分段）；git show main:src/channels/feishu/bridge.mjs；git show main:src/channels/feishu/state-store.mjs；git diff main HEAD --stat 与 -- workspace-session/session-binding-lock；git branch --contains b73901a；git merge-base --is-ancestor b73901a main。工作树读：src/channels/shared/agent-preset.mjs、session-binding-lock.mjs、harness-session-binding.mjs、harness-client.mjs 700-1200 行、bot-workspace-store.mjs 390-590/1060-1743 行、workspace-session.mjs 全文、feishu/state-store.mjs 全文、feishu-runtime.mjs 70-96 行、preset-command.mjs 190-250 行、bridge.mjs 770-970/3730-3920 行。未改源码，未碰他人报告。