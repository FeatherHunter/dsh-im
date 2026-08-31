# ADR 0001: Fork 与分支策略

日期：2026-08-20
状态：Accepted
上下文：`CONTEXT.md:3`

## 决策
- `FeatherHunter/dsh-im` 为 `xmanrui/dsh-im` 的 Fork（MIT）。
- `main` 永远是官方镜像，只做 `git fetch upstream && git merge upstream/main`，不直接提交私货。
- 私有定制在 `private/custom`（长活）及 `feat/*`（短活）上，基于最新 `main`。
- `origin = FeatherHunter/dsh-im`（可写），`upstream = xmanrui/dsh-im`（只读）。

## 后果
- 同步官方可 `fast-forward`，无 Merge 噪音。
- PR 回上游时可从干净 `main` 切分支，仅含目标改动。
- 私货同步后在 `private/custom` 上 `rebase main` 解冲突，范围可控。

## 替代
- 私货直接堆在 `main`：每次同步都会产生 `merge commit`，PR 难以摘干净，已否决。

## 验证
- `git remote -v` 含 `upstream`，`git log --oneline main` 与 `upstream/main` 一致，`private/custom` 超前且可 `rebase`。
- **可执行地图**：[#14 Map: Private Fork 私有化发布与上游同步](https://github.com/FeatherHunter/dsh-im/issues/14)（`wayfinder:map`），子票 #15-#18 已连 `blocked_by`，新会话 AI 按 `frontier` 自驱动。
