# Research #6：dsh-im vs MiniMaxCode 飞书工具实现对照

> 票 #6 / 地图 #2 — `src/channels/feishu/message-utils.mjs` 中 `feishuImageSource.load`、`declaredSize`、`readBoundedStream`、`feishuImageDownloadError`/`feishuProviderCode` 与 SDK `@larksuiteoapi/node-sdk 1.73.0` 对照 MiniMaxCode 侧实现。仅研究，不改主分支代码。

**日期**: 2026-05-11  
**分支**: `research/feishu-vs-minimax`  
**研究者**: wayfinder research 子代理  
**范围**: `message-utils.mjs:204-233`（`feishuImageSource`）、`88-192`（`declaredSize`/`readBoundedStream`/`feishuImageDownloadError`/`feishuProviderCode`/`readFeishuErrorBody`）、`package.json:98`（SDK 版本）、`bridge.mjs:323-340`（失败分支）、`image-prompt.mjs`（上游消费）

---

## 1. 执行摘要 / Findings TL;DR

| 结论 | 判定 |
|---|---|
| **SDK 版本是否落后是根因？** | **否**。`package.json` 声明 `1.73.0`，`npm view @larksuiteoapi/node-sdk dist-tags.latest` 亦为 `1.73.0`（截至 2026-05-11），为当前最新。无需升级。 |
| **`type=file` vs `type=image` 误用是否导致手机图片走通用失败？** | **当前代码已正确使用 `type=image`**（`message-utils.mjs:215`），与飞书开放平台 `im.v1.messageResource.get` 文档一致。`CONTEXT.md:2a` 写的 `type=file` 是历史/笼统描述（或指 2a 未来的文件通道），不是当前图片路径的事实。**该维度不解释“权限已全仍通用失败”**。但移动端若出现 `message_type=file` 携带图片（见 §3），则属于**未覆盖的 payload 分支**，会走 `bridge.mjs:399` 的“目前支持文字和图片”分支，而非下载失败分支——与“通用失败”表象可混淆，需与票 #3/#4 联排。 |
| **`99991672` 误判为通用失败是否可能？** | **在已知错误体形态下已覆盖，但在若干边缘形态下存在漏判风险（见 §4 表）**，漏判则会从 `feishu-image-permission-required` 降级为 `image-download-failed` 再被 `bridge#handleMessageFailure` 统一为“处理失败，请稍后重试…”文案，用户观感即“权限已全仍走通用失败”。但该漏判**不等价于“SDK 差异”**，而是错误体解析的完备性差异。若 MiniMaxCode 做了更宽松的 `Buffer / string / JSON` 解析，则同权限下表现会不同。 |
| **是否建议对齐 MiniMaxCode？** | **建议“防御性对齐”错误体解析（低成本高收益），不建议改 `type` 参数**。同时建议补 `message_type=file` 的移动端兼容探测（待票 #3 真机 payload 确认后再定是否落地）。 |

---

## 2. 方法与证据

1. **本地代码精读**：`src/channels/feishu/message-utils.mjs` 全文件（272 行）、`src/channels/shared/image-prompt.mjs`、`src/channels/feishu/bridge.mjs`、`test/channels/feishu/message-utils.test.mjs` / `bridge.test.mjs`。
2. **SDK 版本核验**：`npm view @larksuiteoapi/node-sdk version` / `versions` / `dist-tags` —— `latest = 1.73.0`，与本地一致（见 `package.json:98` `devDependencies`）。
3. **公开文档检索**：`web_search` 查询 `larksuiteoapi node-sdk messageResource get type image file` 与 `MiniMaxCode Feishu image download`。
   - 文档侧：飞书开放平台 [获取消息中的资源文件](https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/reference/im-v1/message-resource/get) 明确 `resource_type` 为 `image`/`file` 二选一；`nanobot/channels/feishu.py#3` 等第三方实现亦使用 `type=image` 下载图片。
   - MiniMaxCode 侧：**无公开仓库/文档可检索**（`web_search` 未命中）。因此“MiniMaxCode 实现”一列为**基于 dsh-im 代码与通用 SDK 行为的推断**，在表中标注 `inferred / unknown`，不虚构来源。
4. **错误体路径复盘**：`bridge.mjs:323-340` 的 `handleMessageFailure` 中 `imagePromptUserMessage(error) ?? '处理失败，请稍后重试…'` 即“通用失败”文案的唯一出口；上游 `promptContentForMessage` 会将非 `ImagePromptError` 统一包装为 `image-download-failed`，因此任何未被识别为 `99991672` 的下载异常都会落入该通用分支。

---

## 3. `type=image` vs `type=file` 对照

### 3.1 飞书 API 事实

- **文档**：`GET /open-apis/im/v1/messages/:message_id/resources/:file_key?type=image|file`（见 [open.feishu.cn — 获取消息中的资源文件](https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/reference/im-v1/message-resource/get)）。`image` 用于 `image_key`，`file` 用于 `file_key`。
- **dsh-im 现状**：`message-utils.mjs:210-216`

  ```js
  resource = await client?.im?.v1?.messageResource?.get?.({
    path: { message_id: event.message.message_id, file_key: key },
    params: { type: 'image' },
  });
  ```

  对 `message_type=image`（`extractInboundMessage:239-242` 取 `parsed.image_key`）与 `post` 内 `img.image_key` 均使用 `type=image`，**符合文档**。

- **CONTEXT.md:2a 的 `type=file` 记法**：该行描述的是 Fork 的长期目标“文件/图片/HTML 均走 `messageResource.get`”，属概括性写法，非当前图片路径的实现。已在 `lib/index.js` 编译产物中可验证仅 `type=image` 被使用。

### 3.2 是否会导致移动端失败？

| 场景 | dsh-im 行为 | 预期飞书行为 | 结论 |
|---|---|---|---|
| 桌面端/移动端 `message_type=image` + `image_key`，`type=image` | 成功下载 | 成功 | ✅ 正常 |
| 若误用 `type=file` 下载 `image_key` | 飞书返回错误（通常非 99991672，可能是参数错误或鉴权错误） | 失败 | ❌ 若曾误用会直接失败，但当前未误用 |
| **移动端特殊：`message_type=file` + `file_key` 实际为图片**（部分手机客户端/粘贴路径可能） | `extractInboundMessage` 仅识别 `image` 与 `post`，`file` 类型会使 `imageKeys=[]`，进而 `bridge#handle` 判 `!text && !hasImages` 走 `目前支持文字和图片消息。`（`bridge.mjs:399`），**不是**通用下载失败分支 | 需 `type=file` 才能下载 | ⚠️ 该分支未覆盖，票 #3 需真机确认是否存在；若存在，则“手机图片正常 vs 失败”的差异**并非 `type` 误用**，而是 **payload 分支未覆盖** |
| `post` 内 `image_key` vs `file_key` 混用 | 仅收 `image_key`（`message-utils.mjs:67`） | 移动端富文本是否会用 `file_key` 待验证 | 同上，待票 #3 |

**对“权限已全仍走通用失败”的解释力**：**低**。`type` 维度要么成功要么走“不支持的消息类型”分支，不会伪装成 `99991672` 通用失败。若用户反馈的“通用失败”确为 `handleMessageFailure` 的 `image-download-failed` 文案，则根因不在 `type`，而在下载/解析阶段。

---

## 4. `getReadableStream` 与 `99991672` 错误体解析对照

### 4.1 dsh-im 的下载与错误解析链路

```
feishuImageSource.load
  ├─ client.im.v1.messageResource.get({ params:{type:'image'} })  ← throw 则进 feishuImageDownloadError
  ├─ declaredSize(resource.headers) 预检 content-length > maxBytes → ImagePromptError(image-too-large)
  └─ readBoundedStream(resource.getReadableStream(), {signal, maxBytes})
       └─ 逐 chunk 累加，>maxBytes 则 destroy + image-too-large

feishuImageDownloadError(error, signal)
  └─ feishuProviderCode(error, signal) === 99991672 ? → ImagePromptError(feishu-image-permission-required) : 原 error

feishuProviderCode(error, signal)  // BFS 遍历 error/cause 链，seen<8
  ├─ providerCode(value)                         // value.code ?? value.error?.code
  ├─ data = value.response?.data ?? value.data
  │   ├─ directCode === 99991672 → destroy data + return
  │   ├─ data 是 AsyncIterable → readFeishuErrorBody(data, signal) → JSON.parse → providerCode
  │   └─ 否则 providerCode(data)
  └─ pending.push(value.cause)  // 递归 cause 链

readFeishuErrorBody(stream, signal)
  ├─ 64KB 上限 (FEISHU_ERROR_BODY_LIMIT)
  ├─ 1s 超时 (AbortSignal.timeout)
  └─ 非 JSON / 超限 / 异常 → return null（不抛，保留通用失败语义）
```

**测试覆盖**（`message-utils.test.mjs:135-180` / `bridge.test.mjs:370-413`）：已覆盖 `Readable` 流式错误体（含分片 chunk）与 `code:99991672` 命中/未命中两分支；未覆盖 Buffer/string 直出、嵌套 `error.error.code` 等变体。

### 4.2 与 MiniMaxCode 的推断对照表

> MiniMaxCode 侧无公开实现，以下为**基于 dsh-im 行为与 SDK 通用形态的推断**，用于决策“是否需对齐”。

| 维度 | dsh-im（`message-utils.mjs`） | MiniMaxCode（推断，inferred/unknown） | 差异是否解释“权限已全仍通用失败” | 建议 |
|---|---|---|---|---|
| **SDK 版本** | `1.73.0`（`devDependencies`），`npm latest` 同为 `1.73.0`，无滞后 | unknown（用户称“同权限下正常”，未提供版本） | 否 | 无需升级；持续跟随 `latest` 即可 |
| **`type` 参数** | `type=image`（正确） | 推断同为 `type=image`（第三方 `nanobot` 亦如此）；若 MiniMaxCode 额外做 `type=file` 回退，则对 `file` 类图片更宽容 | 否（dsh-im 未误用） | **不改 `type`**；若票 #3 确认移动端存在 `file` 类图片，再评估“先 `image` 失败则回退 `file`”的兼容策略（需防误判） |
| **`declaredSize` 预检** | 读 `content-length`（支持 `Headers.get` 与大小写兼容），超限直接抛 `image-too-large` 并 `destroy` 流 | 推断可能不做预检，仅依赖流式累加（更抗“头部谎报”） | 间接可能：若飞书对移动端图片错误地返回超大 `content-length` 或错误体带 `content-length`，预检会提前失败 | 保留预检（节省内存），但确保错误体的 `content-length` 不触发误判（当前仅对 `resource.headers` 做预检，不对错误体，安全） |
| **`getReadableStream` 消费** | `readBoundedStream` 严格 `AsyncIterable` 校验 + `signal` 绑定 `destroy` + `maxBytes` 累加 | 推断类似，但可能额外兼容 `Buffer`/`ArrayBuffer` 直出（某些 SDK 版本/代理层） | 若 SDK 在错误路径返回非流的 Buffer 而 dsh-im 抛“no readable stream”则会被包装为 `image-download-failed` 通用失败 | 建议补 `Buffer/Uint8Array` 直出兼容（见 §5） |
| **`99991672` 命中路径（Stream）** | `response.data` 为 `Readable`（AsyncIterable）时，`readFeishuErrorBody` 拼接 ≤64KB / 1s 超时后 `JSON.parse` 再 `providerCode` | 推断 MiniMaxCode 可能无 64KB/1s 限制，或限制更宽，导致大错误体/慢流仍能命中 | 边缘场景下是 | 保留 64KB/1s 限制（防 DoS），但建议在超时/超限时退化到 `providerCode(error)` 直判，避免漏判 |
| **`99991672` 命中路径（Object）** | `data` 为对象时 `providerCode(data)`（`code`/`error.code`） | 同上 | 否 | 已覆盖 |
| **`99991672` 未覆盖形态（推断漏判）** | **未覆盖**：`data` 为 `Buffer`/`string` 含 JSON、`error.code` 为字符串 `"99991672"` 的顶层直出、`error.error.code` 深层嵌套、`response.data` 为 `string`、`cause` 链超过 8 层等，见下表 | 推断 MiniMaxCode 可能做了 `Buffer→string→JSON` 回退与字符串 code 归一化，对这些形态更宽容 | **是（边缘）** | **建议对齐**：补 `Buffer/string` 解析分支（低风险，见 §5 patch 草案） |
| **错误体非 JSON 时** | `catch` 静默返回 `null`，保留通用失败 | 推断同为静默 | 否 | 保持 |
| **权限已全仍通用失败的另一种解释** | `bridge.mjs:323-340` 的 `imagePromptUserMessage(error) ?? '处理失败…'` 会将任何非 `99991672` 的下载异常（含网络超时、`maxBytes` 超限、`unsupported-image-type`）统一为通用失败；若错误体因上述漏判未被识别为 99991672，则用户观感即“权限已全仍通用失败” | 同上 | **是** | 通过补齐错误体解析降低漏判率，同时保留 `image-too-large` 等的精确文案（已精确） |

### 4.3 漏判风险细表（dsh-im 当前 `feishuProviderCode` 的盲点）

| 输入形态 | dsh-im 当前 | 是否漏判 99991672 | 证据 |
|---|---|---|---|
| `error.response.data = Readable.from(Buffer(JSON.stringify({code:99991672})))` | ✅ 命中（流分支） | 否 | `message-utils.test.mjs:135` |
| `error.response.data = { code: 99991672 }` | ✅ 命中（对象分支） | 否 | `message-utils.mjs:186` |
| `error.response.data = Buffer.from(JSON.stringify({code:99991672}))` | ❌ `providerCode(Buffer)` 为 null，不解析 Buffer | **是** | `message-utils.mjs:128-132` 仅处理 object |
| `error.response.data = '{"code":99991672}'`（string） | ❌ 同上 | **是** | 同上 |
| `error.data = Buffer/string` 同上 | ❌ 同上 | **是** | 同上（`value.data` 分支） |
| `error = { code: "99991672" }`（字符串 code） | ✅ `Number("99991672")` 归一化后命中 | 否 | `providerCode:131` |
| `error = { error: { code: 99991672 } }` | ✅ `providerCode` 取 `error.code` | 否 | 同上 |
| `error.response.data = { error: { code: 99991672 } }` | ✅ 同上 | 否 | 同上 |
| `error.response.data` 超 64KB / 读取超 1s | `readFeishuErrorBody` 返回 null → 降级为通用失败 | **边缘是** | `message-utils.mjs:147-155` |
| `cause` 链深 >8 或环 | `seen.size<8` 截断 | 边缘 | `message-utils.mjs:165` |

---

## 5. 是否需对齐 / 决策建议

### 5.1 建议对齐（P1，低风险）

**补 `Buffer`/`string` 错误体的 JSON 解析回退**，使非流式错误体也能命中 `99991672`，减少“权限已全仍通用失败”的误判。草案（仅研究，不落地）：

```js
// 在 feishuProviderCode 的 else 分支前增加：
function tryParseCode(raw) {
  if (Buffer.isBuffer(raw) || raw instanceof Uint8Array) raw = Buffer.from(raw).toString('utf8');
  if (typeof raw === 'string') {
    try { return providerCode(JSON.parse(raw)); } catch {}
    // 部分网关返回 "code=99991672" 碎片，可选正则兜底
  }
  return null;
}
// 对 data 为 Buffer/string 时先 tryParseCode，再走 providerCode(data)
```

同时在 `readFeishuErrorBody` 超时/超限后，退化尝试 `providerCode(error)` 直判，避免流式错误体因截断而漏判。

**不建议改动**：`type=image` 参数、`64KB/1s` 限制本身、`declaredSize` 预检、`readBoundedStream` 的 `AsyncIterable` 严格校验。

### 5.2 待票 #3 确认后再定（P2）

- 若真机抓包证实移动端存在 `message_type=file` 或 `post` 内 `file_key` 图片，则评估：
  1. `extractInboundMessage` 兼容 `file` 分支（仅当 `image` 分支为空时尝试 `file_key`，并用 `type=file` 下载），或
  2. 保持现状（维持“仅图片”语义），由 `bridge#handle` 的“目前支持文字和图片消息”明确提示（当前已明确）。

  该决策需与票 #3 的 payload 差异表联动，不在本票预先改代码。

### 5.3 不建议

- 升级 SDK：已是 `latest`。
- 将 `type` 改为 `file` 或双写：会破坏现有 `image_key` 路径，且与文档相悖。
- 放宽 `maxBytes` / `maxTotalImageBytes`：与本次权限误判无关。

---

## 6. 附录

### 6.1 关键文件定位

- `src/channels/feishu/message-utils.mjs:1-7` 常量与 `FEISHU_MISSING_MESSAGE_SCOPE_CODE=99991672`
- `88-93` `declaredSize`、`95-126` `readBoundedStream`、`128-192` `providerCode`/`readFeishuErrorBody`/`feishuProviderCode`/`feishuImageDownloadError`、`204-233` `feishuImageSource`
- `package.json:98` `@larksuiteoapi/node-sdk@1.73.0`
- `src/channels/feishu/bridge.mjs:323-340` `handleMessageFailure`（通用失败文案出口）、`394-401` 空消息分支
- `test/channels/feishu/message-utils.test.mjs:135-180` 权限错误单测

### 6.2 检索记录

- `web_search` queries: `larksuiteoapi node-sdk messageResource get type image file` / `MiniMaxCode Feishu image download` / `feishu open api messageResource get type image` / `larksuiteoapi node-sdk 1.73 npm latest version`
- 命中：`open.feishu.cn/document/.../message-resource/get`（`type=image|file` 定义）、`security.snyk.io/package/npm/@larksuiteoapi%2Fnode-sdk`（版本）、`HKUDS/nanobot/channels/feishu.py#3`（`type=image` 用法）。MiniMaxCode 无公开命中。

### 6.3 与地图 #2 的衔接

- 本票为 `wayfinder:research`，不改 `main` / `private/custom` 代码。
- 产出分支 `research/feishu-vs-minimax`，文档 `docs/research/feishu-vs-minimax.md`（本文件）。
- 后续票：
  - #3（payload 差异）确认移动端是否出现 `file` 类图片 → 决定是否补 `file` 兼容分支
  - #4（失败分支定位）可复用本票的 §4 漏判表做最小复现用例
  - #5（诊断脚手架）建议在 `FeishuHarnessBridge.accept` 增加 `logger.debug` 打点 `message_type`/`content` 形态与 `feishuProviderCode` 命中路径，便于真机回放

---

*— End of Research #6 —*
