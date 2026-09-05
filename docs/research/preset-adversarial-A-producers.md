# 对抗审查 A：agent-preset- 错误生产者静态枚举（独立报告）

说明：静态枚举线（与 B/C/D 并行，互补不重复）。只信一手源码。
基线：main 与 upstream/main 均为 1fa86ed（chore: release v4.11.0）。
本报告一切行号结论均以 git show main:<path> 为准（工作树 HEAD 另有未合入改动，见 S0，不作为依据）。
背景矛盾（直接取用，不推翻）：同飞书聊天 /preset 显示存量=standard，/presetlist 显示 4 项（standard/ptc/minimal/cordis，当前选择 standard），但普通消息报 PRESET_UNAVAILABLE（MF-C3FF35A8）；而同聊天前三条普通消息成功——session 日志证明成功的那几条复用了 agentPreset=ptc 的老会话 session-4ba8e999。

## S0. 方法与基线声明

- 穷举手段：grep [agent-preset-] 于 src、plugin-src、test，再加 grep [unavailableAgentPreset|validateAgentPresetId|updateAgentPreset|setAgentPreset] 于 src，每个命中用 git show main:<path> 逐行核对。本报告所有行号均为 main 行号。
- 工作树不等于 main（仅声明，不作结论依据）：git diff main --stat 显示工作树相对 main 有 68 文件改动，与本线相关的有 src/channels/shared/agent-preset.mjs（归一加 toLowerCase 等）、plugin-src/host/channels/shared/agent-preset-rpc.mjs、test/preset-command.test.mjs、test/workspace.test.mjs。以下 S1-S6 全部按 main 判定；工作树行为可能更宽松（大小写），但不改变生产者位置与可达性结论。
- 本报告只写本文件，不碰其他 docs/research 下报告，不改源码。
## S1. 穷举结果：赋值点全表（main）

在 src + plugin-src + test 内穷举后，真正的 error.code 赋值点在 main 上恰好只有 2 处：

- P1：git show main:src/channels/shared/agent-preset.mjs:23，精确 code 值为 agent-preset-invalid。位置在 validateAgentPresetId() 内（main:18-27），归一规则见 main:11-16（仅 value.trim() + 正则 AGENT_PRESET_ID，main:4 无 i 标志，小写敏感）；null 或空串直接返回 null 不抛（main:19）。目录条目过滤 catalogItem() 同走该归一（main:29-44），大写目录项被静默丢弃。
- P2：git show main:src/channels/shared/bot-workspace-store.mjs:1082，精确 code 值为 agent-preset-unavailable。位置在工厂 unavailableAgentPreset() 内（main:1080-1084，message 为 Agent Preset 不存在或不可用。）；抛错点在两处调用，见 S2。

排除项（经核对不是生产者，逐一说明以防误判）：

- plugin-src/host/channels/shared/agent-preset-rpc.mjs:20-21（main）：字符串出现在 publicAgentPresetError() 的允许名单数组中（main:18-24），是错误透传白名单，不赋值、不 new Error。
- plugin-src/host/channels/shared/workspace-rpc.mjs:23-24（main）：同上，是 publicWorkspaceError() 白名单（main:17-30），不是生产者。
- src/channels/shared/preset-command.mjs:211,215（main）：if (code === ...) 是消费者分支 presetErrorMessage()（main:209-229），只读 code 做文案映射，不生产。
- src/channels/shared/message-failure.mjs:136（main）：if (code.startsWith(agent-preset-)) return PRESET_UNAVAILABLE，是普通消息失败归一消费者（failureCode() 内，main:99-138），不生产。
- test/ 内全部 agent-preset-*（如 workspace.test.mjs:1655/1724/1858/1911、preset-command.test.mjs:367，工作树行号，main 相近）：均为断言期望或手工构造的假错误对象，不是产品路径。
- lib/index.js 内命中是构建产物 bundle，源头即上述 src/plugin-src，不单列。
## S2. 逐个判定

### P1 agent-preset-invalid（main:agent-preset.mjs:23）

- (1) 精确 code 值：agent-preset-invalid，见 S1。
- (2) 普通消息路径能否到达：不能经 dsh-im 侧到达。普通消息新建分支是 bot-workspace-store.mjs:1337-1352（scoped createSession 代理），函数体内没有任何 validateAgentPresetId 或目录检查调用（全文见 S3），只是 agentPresetFor(botId) 取值透传。而 agentPresetFor 返回值只可能来自 normalizeDocument 加载时已归一的值（main:213-218，非法则整份文档返回 null，load 整体 throw）或 setAgentPreset 写入时已归一的值（main:680,690），即内存态残留必然格式合法或为 null，不会触发 P1。P1 在普通消息路径上唯一的理论触发是 Host 侧自己的同名校验，但本仓库无 Host 实现（见 S6）。
- (3) 抛错前做过什么校验、用的哪一次读取的目录：P1 从不读目录，只做纯格式校验（trim + 小写正则）。dsh-im 侧调用 P1 的位置（main）：bot-workspace-store.mjs:216（normalizeDocument 文件加载，catch 后转整份文档 null，code 对外不可见）、:595（ensure 建 bot 时 defaultAgentPreset 格式校验）、:680（setAgentPreset 入口格式校验）、:1201（scoped updateAgentPreset 入口，--default 转 null 否则格式校验）、:1575（controller updateAgentPreset 入口同上）。其中只有 1201 与 1575 在 P1 之后还读过目录（见 P2 说明；顺序都是先格式后目录：1201 先格式、1203-1206 再读目录；1575 先格式、1583-1587 再读目录）。
- (4) 除 createSession/updateAgentPreset 外有无第三条可达路径：无。P1 全部 dsh-im 调用点都在写路径（ensure/set/update + 文件加载），读路径（agentPresetFor main:407-408、presetSettings main:1170-1184、普通消息 S3）均不调 validateAgentPresetId。卡片 action、delivery、repair、controller 详见 S4。

### P2 agent-preset-unavailable（main:bot-workspace-store.mjs:1082 工厂；抛错在两处调用）

- (1) 精确 code 值：agent-preset-unavailable，工厂见 main:1080-1084。
- 调用点 T1（scoped，即命令路径）：main:1206-1207。createBotWorkspaceScope 代理的 updateAgentPreset 分支（main:1197-1228）：先 assertCurrentBotScope（main:1200），再 P1 格式校验（main:1201，--default 转 null），若非空则本次 fresh 读取 presetSettings()（main:1204，即 resolveAgentPresetCatalog，main:1173，源为建 scope 时传入的 agentPresetCatalog 实时闭包，各渠道 production.mjs 均为 () => listAgentPresetCatalog(ctx) 形式，非快照），全等比较 catalog.items.some((item) => item.id === agentPreset)（main:1206），不命中则抛（main:1207），随后才 setAgentPreset 落盘（main:1210）。
- 调用点 T2（controller，即设置页 RPC 路径）：main:1586-1588。controller 工厂的 updateAgentPreset（main:1573-1598）：先 P1 格式校验（main:1575），再 controller.status() 确认 bot 仍存在（main:1577-1582），再本次 fresh 读取 resolveAgentPresetCatalog(agentPresetCatalog)（main:1583-1584，源为 controller 构造时传入的 catalog 实时闭包），全等比较（main:1586-1587），不命中则抛（main:1588），随后 setAgentPreset 落盘（main:1590）。
- (2) 普通消息路径能否到达：dsh-im 侧不能。普通消息会话创建走 scoped createSession 代理（main:1337-1352），该函数不读目录、不调 presetSettings、不比较 catalog.items（全文证据见 S3）：取 agentPresetFor 后直接 target.createSession({ ...options, workspace, ...(agentPreset==null?{}:{agentPreset}) })。T1/T2 的目录检查在该路径上根本不存在。因此普通消息若报 PRESET_UNAVAILABLE，其 error.code 为 agent-preset-* 的源头只能是 Host 侧 target.createSession（或其下游 preset 解析）的拒绝，经 message-failure.mjs:136 归一。本仓库无 Host 实现，一手源码到此为止（见 S6）。
- (3) 抛错前做过什么校验、用的哪一次读取的目录：见 T1/T2 说明。关键：两次读取都是抛错当次的实时目录，不存在读一次多次复用。与之对比，S5 的 15 分钟快照只服务于序号解析，不参与 T1/T2 比较。
- (4) 除 createSession/updateAgentPreset 外有无第三条可达路径：见 S4，结论为无（dsh-im 侧无第三个抛 P2 的代码位置）；卡片 preset 下拉只是换皮调用同一 updateAgentPreset（S4）。
## S3. 普通消息全链（证明 P1/P2 在 dsh-im 侧不可达）

飞书普通消息（非命令）链条（main 行号）：

1. 分流：bridge.mjs:847-855。commandRunner = isPresetCommand(commandText) ? runPresetCommand : null；普通文本 commandRunner 为 null，不进 runPresetCommand，而是 #enqueueMessage（main:980）进 #handle（main:1195 起）。卡片命令旁路（main:834-846）只处理 CARD_COMMAND，不含 preset。
2. 会话复用优先：workspace-session.mjs:67-71。state.sessionFor(key) 有绑定且 sessionExists 通过则直接复用，不调 createSession。这解释背景矛盾前半段：前三条普通消息复用 agentPreset=ptc 的老会话 session-4ba8e999 时，根本不经过任何 preset 校验（成功与当前目录无关）。
3. 仅无绑定或会话失效才新建：同上 70-71 行 sessionId = await createSession(harness, createOptions)，其中 createOptions 只有 signal（bridge 调用点 main:3564-3574 与备用分支 main:3703-3713，两处 askInWorkspaceSession 均只传 signal/exists/ask，不传 preset）。
4. scoped 代理盲透传：bot-workspace-store.mjs:1337-1352 全体。whenBotIdle 后 scope 检查（失败抛 workspace-bot-not-found，非 preset 码，main:1340-1344），取 agentPresetFor（main:1346）与 modelFor（main:1347），直接 target.createSession({ ...options, workspace, ...(agentPreset==null?{}:{agentPreset}) })。无 validate、无 catalog、无比较；且 model 分支（main:1353-1367）有 selectSessionModel + sameModelSelection 确认，preset 分支没有任何对等检查。
5. 传输层盲透传：harness-client.mjs:984-992。createSession 把 requestedPreset ?? this.#agentPreset 原样放入 session.create payload（main:985-990），无校验。
6. 失败归一：任一步抛出的 error.code 以 agent-preset- 开头即 message-failure.mjs:136 归一为 PRESET_UNAVAILABLE（文案 main:79-80：当前 Agent Preset 不存在或暂不可用。请发送 /presetlist 后重新选择。），经 bridge.mjs:1072-1085 #recordFailure（setLastMessageFailure + 日志 [dsh-feishu] ... failed [ref]）与 #handleMessageFailure（main:1096-1125）回用户。

因此：普通消息在 dsh-im 侧读目录的动作是零；能让它报 PRESET_UNAVAILABLE 的 agent-preset-* 只能来自第 4 步的 target（Host）拒绝。
## S4. 第三条可达路径核查：卡片 action、delivery、repair、controller

- 卡片 action（preset 下拉）：有 preset 相关入口，但不是新生产者。bridge.mjs:2234-2247（main：preset_default 进 #handlePresetDefault，preset:select:* 进 #handlePresetSelect）内部只是拼出 /preset --default 或 /preset <id> 文本再调同一 runPresetCommand（main:2881-2883 / 2904-2905，函数体 main:2879-2919），最终仍走到 T1（scoped updateAgentPreset）。失败走 #sendFailure（main:2888/2911），归一逻辑与普通消息同源。presets 卡片展示（main:2214-2216 进 #showPresetCard）与菜单数字回退（main:2309-2326）只读 agentPresetSettings 做展示（bridge 展示读取点 main:2588/2689/2735/2768 均为纯展示），不生产。
- delivery（投递目标增删改）：bot-workspace-store.mjs 的 delivery 系列错误码全部为 invalid-target / unknown-bot / target-conflict / unknown-target；在这些函数上 Select-String [agent-preset-] 零命中。bridge 投递失败码为 channel-delivery-*（channelDeliveryFailure），走 INPUT/CHANNEL 分支，不经过 agent-preset- 前缀分支。
- repair（/repair）：bridge repair 卡片动作直接提示请直接发送 /repair 开始（main:2188-2191）；repair 处理路径错误码为 card_action_probe_* 与连接类，与 preset 无关；grep preset 在 repair 处理零命中。
- controller（除 updateAgentPreset 外）：同文件 controller 工厂其余方法（status main:1570、updateModel main:1599 起、展示用目录读取 main:1635/1664）中，preset 目录读取仅用于展示装饰 decorateResult，失败不抛 agent-preset-*；抛 unavailableAgentPreset() 的仅 main:1588 一处。
- 设置页 RPC（bot.preset.set）：各渠道 plugin-src/host/channels/*/rpc.mjs（feishu main:724-726、qq 208-210、weixin 244-246、slack 187-188、dingtalk 309-311、wecom 209-211、whatsapp 192-194、shared 183-184）均只是参数门卫（validAgentPresetPayload 格式检查）加转调 controller.updateAgentPreset（即 T2），不自产 code。
- 结论：除 createSession（Host 侧，不在本仓库）与 updateAgentPreset（T1/T2）外，dsh-im 内无第三条可达的 agent-preset-* 生产路径。

## S5. 序号快照（15 分钟 TTL）能否污染普通消息：不能（代码证据）

快照机制（main）：preset-command.mjs:22-24 定义 LIST_SNAPSHOTS（WeakMap）、PRESET_LIST_SNAPSHOT_TTL_MS = 15 * 60_000、MAX_ENTRIES = 256。容器结构见 main:143-151（stateSnapshots：按 state 对象 key、再按会话 key 分条的内存 Map）。

- 写：仅 saveSnapshot(state, key, items)（main:159-174：expiresAt = now + TTL，main:165-168），且仅在 /presetlist 成功分支调用（main:259-264：settings() 成功后 saveSnapshot(catalog.items)）。
- 读：仅 loadSnapshot(state, key)（main:176-187：过期 expiresAt <= Date.now() 则删除并返回 null，main:180-183；命中则 LRU 续位 main:184-186），且仅被 presetFromSnapshot() 调用（main:195）。
- 用：presetFromSnapshot()（main:189-203）仅被 /preset 纯数字序号分支调用（main:289-292）；id: 显式形（main:285-287）、--default（main:282-283）、ID 直写（main:294-296）均不读快照。
- 普通消息不碰快照：S3 链条中无任何 saveSnapshot/loadSnapshot/presetFromSnapshot/LIST_SNAPSHOTS 调用（快照三函数在 workspace-session.mjs、bot-workspace-store.mjs、bridge.mjs 普通消息分支零命中）；快照存的是 ids: string[] 序号到 id 映射（main:167），与 agentPresetFor 落盘值、与 createSession 透传值无数据流交汇。
- 污染不成立的双重理由：(a) 控制流隔离：普通消息 code 路径上没有读快照的语句；(b) 值域隔离：T1/T2 比较用的是当次 fresh catalog（S2(3)），快照过期只会导致 /preset 2 报请先执行 /presetlist（main:196-198），绝不会把旧序号翻译成错 id 再塞进 createSession。
- 唯一与快照相关的表象是序号与 ID 的所见非所得（/presetlist 打印 index+1，main:122；15 分钟内目录若变化则序号指向漂移），但那只影响用户按序号选错项这一写路径，不影响已落盘值在普通消息中的透传。
## S6. 背景矛盾的静态解释（不推翻事实，仅给代码级可能位形）

- /preset 显示 standard 走读路径 agentPresetSettings，返回 { agentPreset: agentPresetFor(), catalog: freshCatalog }（main:1188-1195/1170-1184）：只展示落盘值加当次目录，不做落盘值属于目录的校验（currentDescription 对缺失仅标注已不可用，main:86-89）。因此显示 standard 与 standard 实际不可用可并存。
- /presetlist 显示 4 项加当前选择 standard 同走读路径（main:259-264）；formatList 的当前选择标记是 item.id === agentPreset（main:119），只要落盘值恰好等于目录中某一项 id 即打标，不证明该值能通过 Host 建会话。
- 前三条普通消息成功：复用 session-4ba8e999（绑定命中则 workspace-session.mjs:68-70 直接复用问模型），不触发 createSession，preset 值从未被 Host 检验。成功的是老会话加 ptc 上下文，与当前落盘 standard 无关。
- 第四条报 PRESET_UNAVAILABLE：静态上唯一自洽的位形是此次因会话失效、切工作区、/new、重启等走到了新建分支（S3 步骤 3-4），把落盘值透传给 Host，而 Host 侧 target.createSession 以 agent-preset-* 拒绝（例如 Host 目录与 dsh-im 所见目录不一致、Host 对 standard 可用性判定更严、残留值为 Host 已删 ID 等）。Host 行为超出本仓库一手源码范围，须 Host 日志与抓包确认，本线不做推断。
- 证伪方向（留给联调线，不属本静态线）：抓 session.create 出参 error.code 明文（确认确为 agent-preset- 前缀而非 workspace-* 或 INTERNAL）、对比 Host 目录快照与 listAgentPresetCatalog 所见、确认新建那次透传的 agentPreset 字段值。

## S7. 边界与非结论

- 本仓库无 Host session.create 实现，P1/P2 在 Host 侧的对应生产者不在枚举范围内（穷举域为本仓库 src、plugin-src、test）。
- 行号引用防腐烂：若 main 前进，以本报告基线 commit 1fa86ed 重新 git show 为准。
- 与 B/C/D 分工：本线仅覆盖生产者位置与可达性加序号快照隔离；时序与日志因果、Host 目录真相、UI 显示语义归其他线。