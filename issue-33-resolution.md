## 决议：助理心智模型与识别维度 — 已完成（以已交付伴生插件为人类实证）

> 说明：本票为 HITL Grilling。上轮模态追问被取消，本决议改以你已亲手交付的 dsh-im-companion（本地 D:\dsh-plugin\dsh-im-companion，远端 FeatherHunter/dsh-im-companion）为人类侧实证反推；如与你的直觉不符，直接回一句话即改。

### 结论（5 维）

- **命名**：默认 Bot 名原样（BotSnap.botName，上游真值只读），展示为“人名 + 角色”，角色 = agentPreset label / 人格覆盖（C1a 抽屉预设下拉：跟随默认 + 动态目录）；自定义昵称/头像为二级能力（avatar 标题即“设置头像”，personality 可覆盖），拼音/别名不做强制，留给搜索票。
- **视觉**：三级回落 = 自定义图 > 渠道头像 > 渐变首字母（src/client/ui/avatar.ts，Apple 通讯录风 44px 圆）+ 渠道小徽标（channelGlyph）+ 在线/离线健康态（B1 左栏徽标、fleet healthOf）。渠道视图头像与 dsh-im 一致、不改名（companion 地图 A1 决议）。
- **身份维度与主排序**：人（Agent/Bot）> 角色（preset/人格）> 渠道 > 工作区路径。聚合视图两态：按 Agent / 按渠道（A1），渠道为分区头 + 组内 Agent 列表；排序在线优先 + 手动刷新/15s 轮询。
- **规模与高频**：10×10 为上限/压力目标，常态 3–5 人；高频找的是“人”（Agent 卡片），再下钻到其工作区（C1a 抽屉 / B3 Header 浮层 / E4 欢迎横幅），而非先找工作区路径。
- **进入方式**：点击 Agent 进 Fleet 详情抽屉（C1a：预设/上下文双开关/会话路由摘要/绑定工作区 + 工作区改址/浏览/保存），辅以 C1b 矩阵总览（Agent×渠道）与 E4 Home 欢迎横幅；不直接跳工作区总览。

### 证据（人类已验收）

- dsh-im-companion 已关票：B1 左栏徽标 #6、C1a 抽屉 #9、C1b 矩阵 #10、B3 Header #8、E4 欢迎 #15、F0 契约 #3、R5 并行 #4
- 代码：src/client/ui/avatar.ts（三级回落）、src/client/data/fleet-api.ts（BotSnap.botName/avatarUrl/agentPreset 跟随默认归一）、src/features/c1a/view.ts（预设下拉/上下文/工作区段）、src/features/left-badges/manifest.ts（workspace-rail 槽）
- 上游输入：dsh-im #31（左栏不可直扩，A 设置聚合首选）与 #32（1 Bot→1 路径、B1–B8 瓶颈）

### 术语候选（待写入 CONTEXT.md）

- 助理 = 按 Agent 聚合的拟人化入口（一人多 Bot/多工作区收拢到一张 Agent 卡）
- 拟人化工作区 / 特殊工作区 = 已绑定助理的工作区行（B1 徽标区分），非普通工作区
- 角色标签 = agentPreset label / 人格覆盖的展示态

### 对下游的输入

- #34 可直接消费：分组主维度按“人”，渠道为分区头；折叠默认收起组内工作区；搜索优先级人名 > 角色 > 工作区（拼音/别名进入 #35 原型验证）。
- #35 原型不必再验证“识别维度”，只对比收纳形态（分组/抽屉/搜索/过滤）。

*Claim：#33 已由 @me 认领；本评论即 resolution，关闭后地图 Decisions 追加指针。*
