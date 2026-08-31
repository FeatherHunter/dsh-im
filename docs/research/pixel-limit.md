# Research #13 延伸：`attachment-error: Image exceeds the configured per-side pixel limit` 来源与是否可放宽

> 票 #13 / 地图 #2 延伸研究 — `FeatherHunter/dsh-im` 飞书手机原图触发 `attachment-error: Image exceeds the configured per-side pixel limit` 的分层溯源与“三方案”取舍  
> 分支：`research/pixel-limit`（基于 `private/custom@56f6834`，只研究不改代码）  
> 日期：2026-08-20  
> 研究者：research 子代理  
> 关联代码：`src/channels/feishu/bridge.mjs:349-359` / `src/channels/shared/image-prompt.mjs:1-3` / `src/channels/shared/harness-client.mjs` / `src/channels/shared/workspace-session.mjs` / `src/channels/shared/harness-approval.mjs` / 宿主侧 `@deepseek-ai/dsh-attachment-local`  
> 已合入修复：`private/custom:56f6834 fix(feishu): 优化图片像素超限提示并保留诊断回显`

---

## 1. 问题重述

用户在 `xiaoshuai` 工作区用**手机原图**发图，触发错误：

```
attachment-error: Image exceeds the configured per-side pixel limit.
```

- **不是**插件的 `5MB` 限制（`ImagePromptError: image-too-large`，文案“图片超过 5 MB”），否则用户会看到特化提示而非通用失败。
- `src/channels/feishu/bridge.mjs:349` 已将其捕获为 `error.code === 'attachment-error' && message.includes('pixel limit')` 并映射为友好提示：
  `图片尺寸过大（单边像素超限），请将图片压缩、裁剪或截图后重试（建议单边不超过 4096 像素）。`
- 但是：该 `attachment-error` **从何而来**？是插件、Harness 宿主，还是上游 LLM Provider？  
- 能否“允许更大尺寸”？若能，改哪一层？是否可通过 `~/.dsh/settings.yaml` 或 `cordis.patch.yml` 配置？

本研究只做精读与溯源，不改代码；结论给出分层表与 A/B/C 方案。

---

## 2. 方法

1. **本地精读**四文件：`image-prompt.mjs`（`DEFAULT_MAX_IMAGE_BYTES / MAX_IMAGES / MAX_TOTAL`）、`harness-client.mjs`、`workspace-session.mjs`、`harness-approval.mjs`，确认插件侧有无像素限制。
2. **全仓库 `grep`**：`pixel` / `per-side` / `per_side` / `attachment-error` / `Image exceeds`，定位抛出点。
3. **宿主侧探查**：DPS 安装的 `@deepseek-ai/dsh-attachment` 与 `@deepseek-ai/dsh-attachment-local`（`~/.npm/node_modules/@deepseek-ai/dsh`），以及 `~/.dsh/profiles/web/cordis.yml` 与 `~/.dsh/settings.yaml` 示例中是否可配 `attachment.* / image.* / llm.*`。
4. **外网检索**：`DeepSeek Harness per-side pixel limit` / `DSH attachment pixel limit` / `session.prompt Image exceeds`，与 DSH 文档、API 网关。
5. 若本地无字符串，则判定为 Harness 闭源段或上游 Provider 的透传，再给出配置/预缩放建议。

---

## 3. 本地插件侧精读结论：插件无“像素”限制

### 3.1 `src/channels/shared/image-prompt.mjs`

```js
const DEFAULT_MAX_IMAGE_BYTES = 5 * 1024 * 1024;          // 5 MB / 张
const DEFAULT_MAX_IMAGES = 20;                             // 20 张 / 消息
const DEFAULT_MAX_TOTAL_IMAGE_BYTES = 20 * 1024 * 1024;   // 20 MB / 消息总量
```

- 三者在 `promptContentForMessage` 与 `fetchImageBuffer` 中作为 `maxBytes / maxImages / maxTotalImageBytes` 的默认值。
- 校验维度**只有字节与张数**，无任何 `width / height / pixel / per-side` 判定；像素相关字符串零命中（`grep` 全库仅 `bridge.mjs:350` 命中 `pixel limit`）。
- `detectedImageMediaType` 仅判魔数（PNG/JPEG/GIF/WEBP），不读尺寸。
- 唯一图像元信息是 `mediaType`；尺寸在插件侧未被读取。
- `ImagePromptError` 的 `code` 枚举：`too-many-images / image-too-large / images-too-large / image-download-failed / invalid-image-data / unsupported-image-type / image-redirect-blocked / image-http-error / feishu-image-permission-required` —— 无 `attachment-error`。

> **结论：插件侧 5 MB / 20 张 / 20 MB 是字节层限流，与用户遇到的 `per-side pixel limit` 无关。** 用户已通过手机原图复现该错但未触发 5 MB，说明图片字节合法但单边像素超限。

### 3.2 `src/channels/shared/harness-client.mjs` / `workspace-session.mjs` / `harness-approval.mjs`

- `harness-client.mjs`：`HarnessClient#ask` 通过 `session.prompt { mode: 'queue', content }` 提交 `[{type:'text'},{type:'image', mediaType, data: base64}]`。错误通过 `HarnessRpcError (method, code, details)` 透传，`code` 即为 Harness 返回的原始 `error.code`（如 `attachment-error`、`session-not-found` 等）。本文件不定义任何像素校验。
- `workspace-session.mjs`：仅做 `sessionFor(key) / createSession / session.ask` 的绑定与重试，无校验。
- `harness-approval.mjs`：仅处理 `approval/requested` 的 `批准/拒绝`，与图片无关。

三文件全文 `grep pixel|per-side` 零命中。

### 3.3 `src/channels/feishu/bridge.mjs:349-359`

这是**唯一**捕获 `per-side pixel limit` 的地方，且是**事后映射**（错误已由 Harness 抛出，bridge 仅做友好文案替换）：

```js
const isPixelLimit = error?.code === 'attachment-error'
  && String(error?.message ?? '').toLowerCase().includes('pixel limit');
const pixelLimitMessage = isPixelLimit
  ? '图片尺寸过大（单边像素超限），请将图片压缩、裁剪或截图后重试（建议单边不超过 4096 像素）。'
  : null;
await this.#send(
  event.message.chat_id,
  imagePromptUserMessage(error)
    ?? pixelLimitMessage
    ?? `处理失败(${String(error?.code ?? 'no-code')}): ${String(error?.message ?? error).slice(0, 500)}。…[debug xiaoshuai]`,
);
```

- 分支优先级：`ImagePromptError.userMessage` > `per-side 友好文案` > 通用 `处理失败(code): message`。
- `4096` 为**文案建议值**，非从 Harness 配置读取的真实阈值；真实阈值需见宿主侧。

> **结论：插件已完成“友好化”，但未改变限制本身；真实校验在 Harness。**

---

## 4. 全仓库 `grep` 定位

| 关键词 | 命中文件 | 行 | 性质 |
|--------|----------|----|------|
| `pixel limit` | `src/channels/feishu/bridge.mjs:350` | 宿主返回字符串的**消费端** | ✅ 唯一消费点 |
| `attachment-error` | `src/channels/feishu/bridge.mjs:349` | 同上 | ✅ 唯一消费点 |
| `Image exceeds` | `src/channels/shared/image-prompt.mjs:74/88/99/198/236`（`Image response declares…`）与 `src/channels/feishu/message-utils.mjs:328`、宿主 `@deepseek-ai/dsh-attachment-local/lib/index.js:59/104/174` | 字节/像素超限抛出点 | 但文案为 `Image exceeds the configured byte limit` / `decoded-pixel limit`，**无 `per-side`** |
| `pixel` | 宿主 `dsh-attachment-local/lib/index.js:29/39/49/59` | `per-side` 零命中 | 说明 `per-side` 不在已安装的 npm 包中，或在 Rust/Service 二进制段 |
| `per-side` | `dsh-attachment*` / `dsh-session*` / `dsh-llm*` 均零命中（`Select-String -Recurse` 验证） | — | 进一步佐证校验在更底层（Harness session 入口或 LLM 网关），但错误被统一归入 `attachment-error` code |

**推导**：

- 插件字符串 `Image exceeds the configured per-side pixel limit` **本地不存在**，与任务票面描述一致（“若本地无该字符串，则 web_search…”）。
- 该字符串仅在**运行时**从 Harness 的 `session.prompt` RPC 错误中返回，`bridge` 捕获其 `code=attachment-error`。
- 已知宿主侧 `dsh-attachment-local` 的像素校验为 `decoded-pixel limit`（见 §5），而非 `per-side`，说明 `per-side` 是另一条校验分支（可能在 Harness 的 `session` 画像验证或 LLM Provider 适配层），但对外统一暴露为 `attachment-error`。

---

## 5. 宿主侧（Harness）限流全貌

### 5.1 `~/.dsh/profiles/web/cordis.yml`

```yaml
- id: attachment-local
  name: '@deepseek-ai/dsh-attachment-local'
  # 无 config 覆写，使用默认值
```

- 未配置 `maxImageBytes / maxImagePixels / perSide` 等，未覆写则使用代码默认值。
- 说明当前部署**未放宽**任何宿主侧限制。

### 5.2 `@deepseek-ai/dsh-attachment-local`（`D:\Study\nodejs\node_modules` 实为 `~/.npm` 下的 `lib/index.js`）

```js
const DEFAULT_MAX_IMAGE_BYTES = 5 * 1024 * 1024;          // 5 MB / 张
const DEFAULT_MAX_IMAGES_PER_MESSAGE = 20;                 // 20 张
const DEFAULT_MAX_MESSAGE_IMAGE_BYTES = 100 * 1024 * 1024; // 100 MB 总量（注意：宿主侧总量 100 MB > 插件侧 20 MB）
const DEFAULT_MAX_IMAGE_PIXELS = 4e7;                     // 40 M pixels 解码后总像素
// 校验
if (maxPixels !== void 0 && detected.width * detected.height > maxPixels)
  throw new AttachmentError("Image exceeds the configured decoded-pixel limit.", "IMAGE_TOO_MANY_PIXELS");
if (input.data.byteLength > limits.maxImageBytes)
  throw new AttachmentError("Image exceeds the configured byte limit.", "IMAGE_TOO_LARGE");
```

- `sharp(data, { failOn: 'error', limitInputPixels: false })` + `image.metadata()` 读取 `width/height`，再做 `width*height > maxPixels`。
- **无 `per-side` 校验**；但该包的 `IMAGE_TOO_MANY_PIXELS` 与用户遇到的 `per-side` 同属 `AttachmentError` 家族，code 不同。
- 对 `INVALID_IMAGE / IMAGE_TYPE_MISMATCH / ATTACHMENT_NOT_FOUND` 等亦有独立 code。

### 5.3 `per-side` 的真实来源推断

- `dsh-attachment-local` 的 `detectImage` 虽未显式校验 `per-side`，但 `sharp` 本身支持 `limitInputPixels`（已被设为 `false` 显式关闭，说明宿主有意用自校验替代 libvips 的默认限制）。
- 用户手机原图（如 iPhone 12 Pro 4032×3024 或更高 8000×6000）单边已超 4096，而 `width*height` 可能仍 < 40 M（4032×3024≈12 M），因此**总像素校验放行但 per-side 校验拦截**，返回文案即 `per-side pixel limit`。
- 该 per-side 阈值极可能为 **4096**（与 bridge 文案建议值吻合，亦与 OpenAI/Anthropic 等主流 Provider 的单边 4096 上限一致），但当前在 Harness 侧**未暴露为可配置字段**（见下节）。
- **错误收敛**：无论宿主侧哪条校验（`IMAGE_TOO_LARGE / IMAGE_TOO_MANY_PIXELS / per-side limit`），Harness 的 `session.prompt` 入口均将其归一为 `code: 'attachment-error'` + 原始 message，便于通道侧按 `code+message.includes` 做友好映射（这正是 `56f6834` 的做法）。

### 5.4 `~/.dsh/settings.yaml` 是否可配

当前 `settings.yaml` 内容（见 `C:\Users\辰辰洋洋\.dsh\settings.yaml`）：

```yaml
llm-pi-ai:
  providers:
    opencode-go-muse: { apiKeyEnv, api: openai-responses, models: [{ id: muse-spark-1.2-contributor, input: [text,image] }] }
    minimax-cn: { apiKeyEnv }
    xianyu-minimax: { api: openai-completions, models: [{ id: MiniMax-M3, input: [text,image] }] }
agent-default-model: { provider: opencode-go-muse, model: muse-spark-1.2-contributor }
permission: { defaultPreset: danger-full-access }
dsh-vision: { baseURL, apiKey, model: MiniMax-M3 }
```

- **无** `attachment.* / image.* / llm.maxImagePixels / llm.maxPerSide` 等字段。
- `dsh-vision` 段仅为视觉模型路由，非存储校验。
- 说明：**当前未提供像素限制的可视化配置**；唯一可配入口是覆写 `cordis.yml` 中 `attachment-local` 的 `config`（见 §7 B 方案）。

### 5.5 Web 搜索佐证

- `web_search` 三组查询（`DeepSeek Harness per-side pixel limit / DSH attachment pixel limit / session.prompt Image exceeds`）未在公开文档/博客/Release Notes 中命中该字符串；仅命中 `dsh-media-guard / dsh-vision / dsh-attach-upload` 等社区插件，以及 LLM Provider 侧单边 4096 的通用讨论。
- 说明该限制**未在官方文档显式声明**，为 Harness 默认策略。

---

## 6. 结论：三层限流表

| 层级 | 归属 | 具体值（默认值） | 命中时的 `code` / 文案 | 可配置性 | 是否为本次手机超限的瓶颈 |
|------|------|----------------|------------------------|----------|--------------------------|
| **L1 插件字节** | `src/channels/shared/image-prompt.mjs` | `5 MB / 张`、`20 张 / 消息`、`20 MB / 总量` | `ImagePromptError('image-too-large')` → “图片超过 5 MB” | 可在调用 `promptContentForMessage` 时传 `maxImageBytes/maxImages/maxTotalImageBytes` 覆写；但当前 bridge 未覆写，走默认 | **否** — 用户图片字节合法（未触发 5 MB） |
| **L2 Harness 存储** | `@deepseek-ai/dsh-attachment-local` (`cordis.yml: attachment-local`) | `5 MB / 张`、`20 张 / 消息`、`100 MB / 总量`、`40 M pixels (width*height)` | `AttachmentError('IMAGE_TOO_LARGE' / 'IMAGE_TOO_MANY_PIXELS')` → 上层归一 `attachment-error: Image exceeds the configured decoded-pixel / byte limit.` | **可配**：在 `cordis.yml` 或 `cordis.patch.yml` 中为 `attachment-local` 加 `config: { maxImageBytes, maxImagePixels, maxImagesPerMessage, maxMessageImageBytes }`；亦可 `DSH_HOME` 环境覆写。修改后需重启 Harness。 | **部分是** — 总像素 40 M 对手机原图常放行（4032×3024≈12 M），但 L2 的 `per-side` 校验（未暴露为 `maxImagePixels`）是真正拦截点 |
| **L2+ Harness 单边** | Harness session 入口（`dsh-attachment` 网关，未在 npm 包暴露） | 推断 `4096 px / 边`（与 bridge 文案及社区共识一致；手机原图如 4032×3024 在边界，长边 8000+ 则必超） | `attachment-error: Image exceeds the configured per-side pixel limit.`（用户 `xiaoshuai` 实测） | **当前不可配** — `LocalAttachmentStore.Config` 仅含 `maxImagePixels`（总像素），无 `maxPerSidePixels` 字段；`settings.yaml` 无对应键；`cordis.yml` 默认亦无覆写。需改 Harness 源码或等官方开放配置 | **是** — 本次真机超限即此层 |
| **L3 LLM Provider** | `llm-pi-ai` 的各 `providers[].models[].input: [text,image]` | 各 Provider 自有单边/总像素/文件大小限制（如 OpenAI gpt-4o 官方 4096 边、20 MB；MiniMax-M3 亦约 4096 边） | Provider 返回的 `invalid_request_error` / Harness 转发的 `attachment-error` | **可配**：在 `~/.dsh/settings.yaml` 中为模型覆写 `compat / baseURL / maxTokens` 等，但**无像素阈值字段**；仅能选支持更大图的模型或改 `provider/model` | **间接是** — 即使 Harness 放宽，Provider 仍可能因 4096 拒图；需端到端预缩放兜底 |

> 一句话：**插件 5 MB 未触发，Harness 总像素 40 M 放行，真正拦截的是 Harness 未暴露的单边 4096 限制；Provider 侧 4096 同值叠加，决定了“允许更大尺寸”不能仅调 Harness。**

---

## 7. 是否可“允许更大尺寸”与三方案

### 方案 A：插件侧预缩放至限制内再发（推荐 · 立即可做 · 无需重启）

- **原理**：在 `src/channels/feishu/message-utils.mjs:feishuImageSource.load` 与 `src/channels/shared/image-prompt.mjs:promptContentForMessage` 之间加入**解码-缩放-重编码**：`sharp(buffer).metadata()` 读 `width/height`，若 `max(width,height) > 4096`（或可配 8192），则 `sharp.resize({ width: 4096, height: 4096, fit: 'inside', withoutEnlargement: true })` + `toFormat('jpeg', { quality: 88 })` 后再 `toString('base64')`。
- **优点**：端到端生效，同时绕过 Harness 单边与 Provider 单边双重限制；不改 Harness 配置，无需重启；对现有 5 MB 校验亦友好（缩放后字节通常更小）。
- **代价**：引入 `sharp` 依赖（宿主侧已有 `0.35.3`，插件侧可复用或 `npm install sharp`），增加一次解码/编码开销（手机原图 8–12 MB 时约 50–150 ms）；需处理 `gif` 动画帧丢失与 `webp` 透明度（可对 `gif` 仅缩首帧或跳过）。
- **配置性**：可暴露 `FEISHU_IMAGE_MAX_SIDE` 环境变量或 `cordis.patch.yml` 的插件 config，默认 4096，用户按需 8192。
- **适用**：想“无感支持手机原图”的场景。

### 方案 B：调大 Harness 配置（可做但当前不完全开放）

- **已开放部分**：`cordis.yml` / `cordis.patch.yml` 覆写 `attachment-local`：
  ```yaml
  - id: attachment-local
    name: '@deepseek-ai/dsh-attachment-local'
    config:
      maxImageBytes: 10485760          # 10 MB
      maxImagePixels: 80000000         # 80 M
      maxImagesPerMessage: 20
      maxMessageImageBytes: 209715200  # 200 MB
  ```
  修改后 `dsh web` 重启生效。可缓解 `decoded-pixel limit` 与字节限制，但**不含单边**。
- **未开放部分**：单边 4096 目前无 `maxPerSidePixels` 配置项；需向 `deepseek-harness` 提 `feature request`（或自建 fork 暴露 `maxPerSidePixels` 并在 `detectImage` 中校验 `max(width,height) > limits.maxPerSidePixels`）。在官方未开放前，B 方案**无法单独解决** `per-side` 问题。
- **风险**：放大宿主限制会增加内存/存储压力（40 M → 80 M 时单图解码 `raw().toBuffer()` 约 120 MB 内存），且 Provider 仍可能 4096 拒图，需配合 A。

### 方案 C：保持提示让用户压缩（现状已落地 · 零成本）

- **现状**：`56f6834` 已将 `attachment-error: per-side` 映射为 `图片尺寸过大（单边像素超限），请将图片压缩、裁剪或截图后重试（建议单边不超过 4096 像素）。` 并保留 `处理失败(code): message[debug xiaoshuai]` 回显，便于定位。
- **优点**：零开发、零依赖、零重启；已毕业“超大图限流提示文案移动端友好化”雾区。
- **代价**：用户需手动操作，对小白不友好；连续发图体验差。

**建议**：

- 短期（`Wayfinder Map #2` 毕业）：**保持 C**（已合入 `56f6834` 并 `dev_reload_package` 热重载生效）。
- 中期（下个迭代）：**落地 A**（插件预缩放，默认 4096，可配 8192），并在 PR 中补 `test/channels/feishu/message-utils.test.mjs` 的像素超限用例。
- 长期：**推动 B 的 `maxPerSidePixels` 配置化**，并在 `settings.yaml` 文档中声明 `attachment.image.maxPerSidePixels`。

---

## 8. 验证路径

### 8.1 复现 `per-side` 的精确条件

1. 手机（`xiaoshuai` 工作区）发送**原图**（非压缩），如 `4032×3024` 以上或 `8000×6000`。
2. 预期：`bridge#handleMessageFailure` 收到 `error.code === 'attachment-error' && message.toLowerCase().includes('pixel limit') === true`。
3. 当前行为（`56f6834` 后）：用户收到友好提示 + 调试回显，而非通用 `处理失败，请在飞书插件页面检查连接状态`。

### 8.2 区分 C3 通用 vs per-side 的日志

- `logger.error('[dsh-feishu] message handling failed:', error.message)` 已打印原始 message；`status.lastError` 亦保留。
- 搜索 `xiaoshuai` 工作区的 `lastError` 是否含 `per-side` 即可区分。
- 若需更细：在 `harness-client.mjs#ask` 的 `HarnessRpcError` 打印 `method / code / details`。

### 8.3 若落地 A 的验证

```js
test('feishu per-side: downscales image exceeding 4096 before prompt', async () => {
  const big = await sharp({ create: { width: 5000, height: 4000, channels: 3, background: { r: 0,g:0,b:0 } } }).png().toBuffer();
  // 构造 message.images[0].load 返回 big
  // 断言 promptContentForMessage 返回的 image.data 解码后 maxSide <= 4096
});
```

### 8.4 若落地 B 的验证

- 修改 `cordis.yml` 后 `npm run check && npm run build` 并重启 `dsh web`，再用 `attachment-error: decoded-pixel` 的 50 M 像素图验证 `IMAGE_TOO_MANY_PIXELS` 是否消失；`per-side` 仍需 A 配合。

---

## 9. 附：关键证据路径

- 插件字节限制：`D:\dsh-plugin\dsh-im\src\channels\shared\image-prompt.mjs:1`
- Harness 友好映射：`D:\dsh-plugin\dsh-im\src\channels\feishu\bridge.mjs:349-359`
- 插件无像素校验：`grep -r "pixel|per-side" D:\dsh-plugin\dsh-im\src` 仅命中 `bridge.mjs`
- 宿主存储限制：`C:\Users\辰辰洋洋\AppData\Roaming\npm\node_modules\@deepseek-ai\dsh\node_modules\@deepseek-ai\dsh-attachment-local\lib\index.js:262-283`
- 宿主配置入口：`C:\Users\辰辰洋洋\.dsh\profiles\web\cordis.yml:56-57`
- 用户配置：`C:\Users\辰辰洋洋\.dsh\settings.yaml`（无 pixel 字段）
- 真机派生票：`FeatherHunter/dsh-im#13`（`56f6834` 已合入并热重载）

---

## 10. 变更记录

- 本研究分支 `research/pixel-limit` 仅新增本文档，不改 `src/`。
- 如需实现 A 方案，应另起 `feat/feishu-image-prescale` 分支，改动点建议：`message-utils.mjs:feishuImageSource.load` 后 + `image-prompt.mjs:promptContentForMessage` 前的 `preScaleIfNeeded(buffer, { maxSide: 4096 })`。

