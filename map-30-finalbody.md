## Destination

完成一份可直接交由实现的可扩展性验证结论与左侧 AI 助理导航方案 Spec：确认 DSH 左侧工作栏能否以插件形式扩展（不改官方代码），并为 10×10 机器人-工作区场景确定拟人化助理的发现与收纳方案，使“在 10 秒内找到指定助理的对话入口”可达成且不造成置顶污染；结论以 Issue Spec + 原型链接形式交付，达到后即可进入实现规划。

## Notes

- 域：DSH（DeepSeek Harness）Web GUI 左侧工作区栏 + dsh-im M 插件的多机器人/多工作区绑定（9 渠道，现聚焦飞书/微信等选择工作区的 Chat Bot），单插件多 Bot×多 Workspace 模型
- 每会话必读：CONTEXT.md + docs/adr/0001-fork-and-branch-strategy.md + docs/adr/0002-dynamic-package-name.md + 本地图；涉及 UI 时读 dsh-plugin-ui-debug 技能与 plugin-src/client 既有插槽（dsh-client-ui-slots）
- 技能：research（DSH 左栏可扩展性与现状盘点）、grilling + domain-modeling（心智模型与组织偏好）、prototype（拟人化导航原型）、task（插槽选型与实现路径）；必要时调用 dsh-plugin-ui-debug 做真实浏览器验证
- 立场：不改官方代码、插件化扩展；左侧置顶不混乱、拟人化可一眼识别（小帅/星火/小孙等角色化助理）、“特殊工作区而非普通工作区”的心智（助理即工作区入口）
- 仓库：FeatherHunter/dsh-im（fork xmanrui/dsh-im），工作区 D:\dsh-plugin\dsh-im，已有截图 image.png 为左侧工作区列表现状（.db / 1111 / dsh-im 等）
- 实证分支：dsh-im-companion 已交付（本地 D:\dsh-plugin\dsh-im-companion，远端 FeatherHunter/dsh-im-companion）：B1 左栏徽标 / B2 筛选 / B3 Header / C1a 抽屉 / C1b 矩阵 / E4 欢迎等；#33 起决议以伴生插件为人类实证
- 关闭状态（2026-09-04）：#31/#32/#33 已决议；#34/#35/#36 被伴生插件替代关闭；本 map 关闭，后续归伴生插件管

## Decisions so far

- [[Research] DSH 左侧工作栏插件可扩展性验证](https://github.com/FeatherHunter/dsh-im/issues/31)：左侧列表无 slot、不可直扩（sidebar single 已占）；等效 A 设置聚合（首选）+ B 悬浮快捷 + C 上游新 slot（长期） — docs/research/left-bar-extensibility-31.md @ research/left-bar-extensibility
- [[Research] M 插件现状盘点：10×10 机器人-工作区模型与左侧渲染](https://github.com/FeatherHunter/dsh-im/issues/32)：1 Bot→1 绝对路径（每渠道 workspaces.json + per-bot state.json），左侧零侵入（仅 settings.section），10×10 无聚合/无拟人化/无别名；可复用 BotWorkspaceStore 等，瓶颈 B1-B8 已清单化 — docs/research/m-plugin-model-32.md @ research/m-plugin-model-32
- [[Grilling] 助理心智模型与识别维度：小帅/星火/小孙如何被一眼认出？](https://github.com/FeatherHunter/dsh-im/issues/33)：人名+角色展示（Bot 名原样 + preset label），三级头像回落（自定义>渠道头像>首字母），人>角色>渠道，点击进 C1a 抽屉 — 决议见 #33 评论，实证 dsh-im-companion（avatar.ts / fleet-api.ts / C1a/C1b/B3/E4）

## Not yet specified

- （已移交：随 #34/#35/#36 关闭，剩余迷雾移交伴生插件，不在本 map 毕业）

## Out of scope

- 直接修改 DSH 官方左侧工作栏源码（本 effort 限定插件化方案，官方 PR 另立 effort）
- dsh-im 9 渠道 IM 桥接本身的消息收发/流式/审批逻辑改动（仅关注导航与入口发现）
- 工作区底层存储与会话绑定模型的重构（仅在导航层消费现有 Workspace 模型）
- 上游 xmanrui/dsh-im 的 Roadmap 决策与 DSH Host 本体的发布
- [[Grilling] 组织与收纳偏好：置顶、分组、折叠与搜索的取舍](https://github.com/FeatherHunter/dsh-im/issues/34)：被伴生插件替代（按 Agent/按渠道两态 + C1a/C1b/B1/B2），后续归伴生插件管
- [[Prototype] 拟人化导航交互原型：3-4 种方案对比](https://github.com/FeatherHunter/dsh-im/issues/35)：被伴生插件真实实现替代（B1/B2/B3/C1a/C1b/E4 已交付），后续迭代归伴生插件管
- [[Task] 插件插槽选型与最小侵入实现路径](https://github.com/FeatherHunter/dsh-im/issues/36)：已在伴生插件定案（workspace-rail/settings.section/overlay + features-contract.md），后续演进归伴生插件管
- 本 map 全部需求已由伴生插件实现：https://github.com/FeatherHunter/dsh-im-companion（本地 D:\dsh-plugin\dsh-im-companion）
