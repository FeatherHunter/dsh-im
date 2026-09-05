## Destination

完成一份可直接交由实现的可扩展性验证结论与左侧 AI 助理导航方案 Spec：确认 DSH 左侧工作栏能否以插件形式扩展（不改官方代码），并为 10×10 机器人-工作区场景确定拟人化助理的发现与收纳方案，使“在 10 秒内找到指定助理的对话入口”可达成且不造成置顶污染；结论以 Issue Spec + 原型链接形式交付，达到后即可进入实现规划。

## Notes

- 域：DSH（DeepSeek Harness）Web GUI 左侧工作区栏 + dsh-im M 插件的多机器人/多工作区绑定（9 渠道，现聚焦飞书/微信等选择工作区的 Chat Bot），单插件多 Bot×多 Workspace 模型
- 每会话必读：CONTEXT.md + docs/adr/0001-fork-and-branch-strategy.md + docs/adr/0002-dynamic-package-name.md + 本地图；涉及 UI 时读 dsh-plugin-ui-debug 技能与 plugin-src/client 既有插槽（dsh-client-ui-slots）
- 技能：research（DSH 左栏可扩展性与现状盘点）、grilling + domain-modeling（心智模型与组织偏好）、prototype（拟人化导航原型）、task（插槽选型与实现路径）；必要时调用 dsh-plugin-ui-debug 做真实浏览器验证
- 立场：不改官方代码、插件化扩展；左侧置顶不混乱、拟人化可一眼识别（小帅/星火/小孙等角色化助理）、“特殊工作区而非普通工作区”的心智（助理即工作区入口）
- 仓库：FeatherHunter/dsh-im（fork xmanrui/dsh-im），工作区 D:\dsh-plugin\dsh-im，已有截图 image.png 为左侧工作区列表现状（.db / 1111 / dsh-im 等）
- 实证分支：dsh-im-companion 已交付（本地 D:\dsh-plugin\dsh-im-companion，远端 FeatherHunter/dsh-im-companion）：B1 左栏徽标 / B2 筛选 / B3 Header / C1a 抽屉 / C1b 矩阵 / E4 欢迎等；#33 起决议以伴生插件为人类实证

## Decisions so far

- [[Research] DSH 左侧工作栏插件可扩展性验证](https://github.com/FeatherHunter/dsh-im/issues/31)：左侧列表无 slot、不可直扩（sidebar single 已占）；等效 A 设置聚合（首选）+ B 悬浮快捷 + C 上游新 slot（长期） — docs/research/left-bar-extensibility-31.md @ research/left-bar-extensibility
- [[Research] M 插件现状盘点：10×10 机器人-工作区模型与左侧渲染](https://github.com/FeatherHunter/dsh-im/issues/32)：1 Bot→1 绝对路径（每渠道 workspaces.json + per-bot state.json），左侧零侵入（仅 settings.section），10×10 无聚合/无拟人化/无别名；可复用 BotWorkspaceStore 等，瓶颈 B1-B8 已清单化 — docs/research/m-plugin-model-32.md @ research/m-plugin-model-32
- [[Grilling] 助理心智模型与识别维度：小帅/星火/小孙如何被一眼认出？](https://github.com/FeatherHunter/dsh-im/issues/33)：人名+角色展示（Bot 名原样 + preset label），三级头像回落（自定义>渠道头像>首字母），人>角色>渠道，点击进 C1a 抽屉 — 决议见 #33 评论，实证 dsh-im-companion（avatar.ts / fleet-api.ts / C1a/C1b/B3/E4）

## Not yet specified

<!-- 迷雾区：在 scope 内但尚不清晰到可成票，待 frontier 推进后毕业为新票 -->
- 视觉细节：头像/色彩/徽标（渠道标识 vs 角色标识）的具体规范与无障碍要求
- 状态持久化：折叠/分组/收藏的本地存储位置与多端同步策略
- 搜索与性能：跨 100 工作区的模糊搜索、拼音/别名匹配与前端节流
- 移动端与窄栏适配：左侧收起时的助理入口可见性
- 与 dsh-im 已有命令（/workspacelist /ws 等）的联动：是否在左侧提供快捷切换入口
- 度量：10 秒找到的可用性测试脚本与埋点定义

## Out of scope

<!-- 超出 Destination 的有意排除；若已建票则关闭并在此留一行 gist + 链接 -->
- 直接修改 DSH 官方左侧工作栏源码（本 effort 限定插件化方案，官方 PR 另立 effort）
- dsh-im 9 渠道 IM 桥接本身的消息收发/流式/审批逻辑改动（仅关注导航与入口发现）
- 工作区底层存储与会话绑定模型的重构（仅在导航层消费现有 Workspace 模型）
- 上游 xmanrui/dsh-im 的 Roadmap 决策与 DSH Host 本体的发布
