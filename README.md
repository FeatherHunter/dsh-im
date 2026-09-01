<p align="center">
  <img src="assets/logo-dsh-im-connecting-readme-3x2.png" alt="DSH-IM — Connecting DeepSeek Harness" width="420" height="280" align="middle">&nbsp;&nbsp;
  <img src="assets/logo-plugin-phone.png" alt="DSH-IM phone logo" width="280" height="280" align="middle">
</p>

---

<div align="center">
  <p><strong>FeatherHunter 私有增强版 · 让 DeepSeek Harness 触手可及</strong></p>
  <p><strong>Private Fork of DSH-IM — Connecting DeepSeek Harness</strong></p>

  <p>
    <a href="LICENSE"><img src="https://img.shields.io/github/license/FeatherHunter/dsh-im" alt="MIT 许可证"></a>
    <a href="https://www.npmjs.com/package/@feather_wch/dsh-im"><img src="https://img.shields.io/npm/v/@feather_wch/dsh-im?label=%40feather_wch%2Fdsh-im" alt="npm version"></a>
    <img src="https://img.shields.io/badge/agent-DeepSeek%20Harness-5865f2" alt="DeepSeek Harness">
    <a href="https://github.com/FeatherHunter/dsh-im/issues"><img src="https://img.shields.io/github/issues/FeatherHunter/dsh-im" alt="issues"></a>
  </p>

  <p><strong>简体中文</strong> · <a href="README.en.md">English</a></p>
</div>

---

> 本仓库是 [`xmanrui/dsh-im`](https://github.com/xmanrui/dsh-im) 的 Fork（MIT），由 [`FeatherHunter/dsh-im`](https://github.com/FeatherHunter/dsh-im) 在 `private/custom` 分支持续维护，发布为 [`@feather_wch/dsh-im`](https://www.npmjs.com/package/@feather_wch/dsh-im)。上游的完整功能文档、九通道接入、AI Office 与命令说明请见 👉 **[原作者 README](https://github.com/xmanrui/dsh-im/blob/main/README.md)**。

> **版本说明**：`0.15.x` 为私版独立演进，与上游 `4.x` 不可比 `semver`（包名 `@feather_wch/dsh-im` 与 ID `feather-wch-dsh-im` 已分叉），同步节奏见 [ADR-0001](docs/adr/0001-fork-and-branch-strategy.md)。

## 本 Fork 做了什么

`main` 分支永远镜像上游（`git fetch upstream && git merge --ff-only upstream/main`），私有定制全部沉淀在 `private/custom`。相较上游，当前私版核心增量如下：

### 1. DSH → 飞书附件回传（模型可发文件）

模型在回复中产生的本地文件可自动作为附件回传到飞书聊天框内预览/下载，无需用户手动搬运。

- 解析规则：`workspace` 内绝对路径、`![alt](path)` Markdown 图片、`[[file:path]]` 三类均识别为附件；
- 通道：`src/channels/feishu/attachment-parser.mjs` + `feishu-channel.mjs: sendImage / sendFile`，经 `im.v1.image.create / file.create` 再以 `msg_type: image / file` 发送；
- 安全与限额：仅 `workspace` 根内文件、单张 5 MB / 总量 20 MB / 单消息 20 个附件，超出给出友好提示。

### 2. 飞书 → DSH 媒体通道增强

解决手机端图片/文件入站的兼容与稳定性问题，保持其余 8 渠道不动。

- `message-utils.mjs` 兼容移动端 6 类 payload（`file/media`、`img.file_key`、`content.image_key` 等）与富文本图文混排，按 `Harness` 入库时拆条入队；
- 图片预缩放：`sharp` 动态加载，通道侧将超大截屏预缩至 2000px 再入库，避免触发模型侧像素超限；
- 限额与校验复用：与附件回传一致的 5 MB/20 MB/20 个 + 根校验 + `file-type / mime-types` 嗅探。

### 3. 图片提示词优化

`src/channels/shared/image-prompt.mjs: defaultImagePrompt(N)` 替代硬编码“请分析这张图片。”：按消息内图片数量自动区分强关联批图、孤图、乱序拆条等场景，提升模型对多图的理解。

### 4. 私有发布更名

发布为 `@feather_wch/dsh-im`（`cordis.patch.yml: id: feather-wch-dsh-im`），采用 DSH 官方 `dsh.bundle.patch` / `dsh.profile.bundles` 机制：`dsh plugin add` 自动注册、`dsh plugin remove` 自动移除，无 `postinstall`（pnpm v10 安全），可与上游 `@xmanrui/dsh-im` 并存（需先卸载旧包避免路由冲突）。

### 5. 工程化与稳定性

- 移除 `debug-attachments.log` 调试落盘；
- 重建 `lib/` 产物，补 `test/channels/feishu/attachment-parser.test.mjs` 与 `mobile-repro.test.mjs`；
- 沉淀 `docs/adr/0001-fork-and-branch-strategy.md`、`CONTEXT.md` 与 Wayfinder Map #14，明确 `main` 镜像 + `private/custom` 私改的协作契约。

## 安装

### 推荐：从 npm 安装稳定版（DSH 官方 bundle）

```sh
dsh plugin --profile web add -w @feather_wch/dsh-im
```

> 与 `dsh-opencode-palette` 一致，本包自带 `cordis.patch.yml`（声明 `dsh.bundle.patch`），安装后自动加入 `dsh.profile.bundles`，DSH 启动时直接装配；卸载时自动移除。全程无需手动编辑文件，不依赖 pnpm 构建脚本。重启 `dsh web`（或刷新浏览器页面）即生效。

重启 `dsh web` 后打开「设置 → 插件 → IM机器人」按引导完成扫码或凭据绑定即可。

### 备用：试用未发布到 npm 的最新代码

```sh
# GitHub 源安装（会拉取并构建 Git 依赖）
npx -y github:FeatherHunter/dsh-im install
```

> pnpm 10+ 可能需在 `~/.dsh/profiles/web/pnpm-workspace.yaml` 中放行该 Git 依赖的构建脚本。普通用户优先使用 npm 稳定版。

### 本地开发

```sh
npm install
npm run check   # 单测 + 构建 Host/Client + 发布包校验
dsh plugin --profile web add -w ./dsh-im   # 或 node bin/dsh-im.mjs install --source .
```

`npm run check` 必须全绿；`main` 保持可一键同步上游，冲突仅在 `private/custom` 解决。

## 反馈与联系

欢迎提交 [Issue](https://github.com/FeatherHunter/dsh-im/issues) 反馈问题或需求，也可扫码添加飞书直接联系作者。提交 Issue 时请附 `dsh --version` / `node --version` / 复现步骤，勿贴 `App Secret` / `bot_token` 等敏感信息。

<table>
  <tr>
    <th align="center">飞书</th>
  </tr>
  <tr>
    <td align="center" valign="top">
      <a href="docs/images/feishu-qr.png"><img src="docs/images/feishu-qr.png" alt="飞书二维码" width="240"></a><br>
      <sub>扫码添加飞书</sub>
    </td>
  </tr>
</table>

> 喜欢本 Fork？欢迎 Star ⭐ 并在 Issue 中分享你的使用场景。
