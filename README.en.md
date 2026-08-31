<p align="center">
  <img src="assets/logo-dsh-im-connecting-readme-3x2.png" alt="DSH-IM — Connecting DeepSeek Harness" width="420" height="280" align="middle">&nbsp;&nbsp;
  <img src="assets/logo-plugin-phone.png" alt="DSH-IM phone logo" width="280" height="280" align="middle">
</p>

---

<div align="center">
  <p><strong>Private Fork of DSH-IM — Connecting DeepSeek Harness</strong></p>

  <p>
    <a href="LICENSE"><img src="https://img.shields.io/github/license/FeatherHunter/dsh-im" alt="MIT license"></a>
    <a href="https://www.npmjs.com/package/@feather_wch/dsh-im"><img src="https://img.shields.io/npm/v/@feather_wch/dsh-im?label=%40feather_wch%2Fdsh-im" alt="npm version"></a>
    <img src="https://img.shields.io/badge/agent-DeepSeek%20Harness-5865f2" alt="DeepSeek Harness">
    <a href="https://github.com/FeatherHunter/dsh-im/issues"><img src="https://img.shields.io/github/issues/FeatherHunter/dsh-im" alt="issues"></a>
  </p>

  <p><a href="README.md">简体中文</a> · <strong>English</strong></p>
</div>

---

> This is a private Fork of [`xmanrui/dsh-im`](https://github.com/xmanrui/dsh-im) (MIT), maintained at [`FeatherHunter/dsh-im`](https://github.com/FeatherHunter/dsh-im) on branch `private/custom` and published as [`@feather_wch/dsh-im`](https://www.npmjs.com/package/@feather_wch/dsh-im). For the full upstream documentation — nine IM channels, AI Office, commands — see 👉 **[Upstream README](https://github.com/xmanrui/dsh-im/blob/main/README.en.md)**.

## What's Enhanced in This Fork

`main` always mirrors upstream (`git fetch upstream && git merge --ff-only upstream/main`); all private changes live on `private/custom`. Key deltas vs upstream:

### 1. DSH → Feishu File / Image / HTML Attachment

Model-generated local files can be sent back to Feishu as native attachments for preview/download inside the chat.

- Recognized patterns: absolute paths inside `workspace`, Markdown images `![alt](path)`, and `[[file:path]]`;
- Pipeline: `src/channels/feishu/attachment-parser.mjs` + `feishu-channel.mjs: sendImage / sendFile` via `im.v1.image.create / file.create` then `msg_type: image / file`;
- Guardrails: workspace-root confinement, 5 MB per file / 20 MB total / 20 attachments per message, with user-friendly limits.

### 2. Feishu → DSH Media Hardening

Compatibility and stability fixes for mobile Feishu image/file inbound; the other 8 channels stay untouched.

- `message-utils.mjs` handles 6 mobile payload variants (`file/media`, `img.file_key`, `content.image_key`, rich-text mixed image+text) and enqueues them correctly;
- Image pre-scale: `sharp` is loaded dynamically; oversized screenshots are downscaled to 2000px on the channel side before reaching the model, avoiding per-side pixel limits;
- Same guardrails as above (5 MB / 20 MB / 20 items) plus `file-type / mime-types` sniffing.

### 3. Context-Aware Image Prompt

`src/channels/shared/image-prompt.mjs: defaultImagePrompt(N)` replaces the hardcoded “Please analyze this image.” — it adapts to batch vs single vs out-of-order image delivery for better model understanding.

### 4. Private Publish Rename

Published as `@feather_wch/dsh-im` (`cordis.patch.yml: id: feather-wch-dsh-im`) using DSH's official `dsh.bundle.patch` / `dsh.profile.bundles` mechanism: `dsh plugin add` auto-registers, `dsh plugin remove` auto-removes, no `postinstall` (pnpm v10 safe). Can coexist with upstream `@xmanrui/dsh-im` (uninstall the old one first to avoid route conflicts).

### 5. Engineering & Stability

- Removed `debug-attachments.log` instrumentation;
- Rebuilt `lib/`, added `test/channels/feishu/attachment-parser.test.mjs` and `mobile-repro.test.mjs`;
- Added `docs/adr/0001-fork-and-branch-strategy.md`, `CONTEXT.md`, and Wayfinder Map #14 to codify the `main` mirrors upstream + `private/custom` private workflow.

## Installation

### Recommended: stable npm release (DSH official bundle)

```sh
dsh plugin --profile web add -w @feather_wch/dsh-im
```

> Same mechanism as `dsh-opencode-palette`: the package ships `cordis.patch.yml` (`dsh.bundle.patch`), auto-registered into `dsh.profile.bundles` on install and removed on uninstall. No manual file edits, no postinstall. Restart `dsh web` (or refresh the page) to take effect.

Restart `dsh web`, then open **Settings → Plugins → IM Bot** and follow the in-app guide to scan a QR code or enter credentials.

### Alternative: try the latest unpublished code

```sh
# GitHub source (fetches and builds the Git dependency)
npx -y github:FeatherHunter/dsh-im install
```

> pnpm 10+ may require allowing the Git dependency to run its build script in `~/.dsh/profiles/web/pnpm-workspace.yaml`. Prefer the npm release for most users.

### Local Development

```sh
npm install
npm run check   # unit tests + Host/Client build + package verification
dsh plugin --profile web add -w ./dsh-im   # or node bin/dsh-im.mjs install --source .
```

`npm run check` must stay green; `main` stays fast-forwardable to upstream — resolve conflicts only on `private/custom`.

## Feedback & Contact

Issues and PRs are welcome via [GitHub Issues](https://github.com/FeatherHunter/dsh-im/issues). You can also scan the Feishu QR code below to reach the maintainer directly. Please include `dsh --version` / `node --version` and reproduction steps, and never paste `App Secret` / `bot_token`.

<table>
  <tr>
    <th align="center">Feishu</th>
  </tr>
  <tr>
    <td align="center" valign="top">
      <a href="docs/images/feishu-qr.png"><img src="docs/images/feishu-qr.png" alt="Feishu QR code" width="240"></a><br>
      <sub>Scan to add on Feishu</sub>
    </td>
  </tr>
</table>

> If you find this fork useful, please Star ⭐ and share your use case in an Issue.
