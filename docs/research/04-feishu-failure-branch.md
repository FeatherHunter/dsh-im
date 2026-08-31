# Research #4：现代码失败分支定位

> 票 #4 — Part of #2 Wayfinder Map：飞书手机图片入站修复  
> 分支：`research/feishu-failure-branch`（基于 `private/custom`，只做研究不改主代码）  
> 作者：research 子代理 · 日期：2026-05-11  
> 关联代码：`src/channels/feishu/bridge.mjs`（`#handle` / `#answerWithStream` / `#handleMessageFailure`）、`src/channels/shared/image-prompt.mjs`、`src/channels/feishu/message-utils.mjs`、`test/channels/feishu/bridge.test.mjs`

## 1. 问题重述

手机图片触发的通用提示

```
处理失败，请稍后重试。如果问题持续，请在 DeepSeek Harness 的飞书插件页面检查连接状态。
```

在代码里只有一处产生：`bridge.mjs#handleMessageFailure` 中

```js
await this.#send(
  event.message.chat_id,
  imagePromptUserMessage(error) ?? '处理失败，请稍后重试…',
);
```

即 **`imagePromptUserMessage(error) === null` 时才走通用分支**，否则走 `ImagePromptError.userMessage` 的特化提示。

票面要求区分三条假说：

1. `extractInboundMessage` 返空 `[]` → `#handle` 判 `目前支持文字和图片消息。`（非通用失败）
2. `promptContentForMessage` 抛 `ImagePromptError` 被 `imagePromptUserMessage` 特化（`image-too-large` / `unsupported-image-type` / `image-download-failed` 等）
3. `client.im.v1.messageResource.get` 抛 **非 `99991672`** 错误 → 未被包装为 `ImagePromptError` → `imagePromptUserMessage` 为 `null` → 通用分支

本研究通过静态链路梳理 + 用例对照给出判定。

## 2. 调用链总览

```
accept(event)
 ├─ #enqueueMessage / #handleMessageFailure 的 catch 包装（所有 accept 入口统一）
 └─ #handle(event, key)
     ├─ message = extractInboundMessage(event, client)   // message-utils.mjs
     ├─ if (!text && !hasImages) => send('目前支持文字和图片消息。') // 分支 A
     ├─ 指令分流（/help /new /status /workspace /compact）
     └─ #answerWithStream(event, key, message)
         └─ content = hasInboundImages(message)
                ? await promptContentForMessage(message, {signal}) // image-prompt.mjs
                : undefined
            → askInWorkspaceSession({content}) → Harness
```

任意一步 `throw` 都会冒泡到 `#enqueueMessage` / `accept` 的 `.catch(handleMessageFailure)`，最终落到单一出口 `handleMessageFailure`。

### #handleMessageFailure 完整守卫

```js
async #handleMessageFailure(event, messageId, processingReaction, error) {
  if (error?.code === 'turn-stopped') return;      // ① 协作停止，静默
  if (this.#signal?.aborted) return;                // ② 进程关闭，静默
  logger.error('[dsh-feishu] message handling failed:', error?.message)
  status.lastError = error?.message ?? String(error)
  await #finishReaction(ERROR)
  await #send(imagePromptUserMessage(error) ?? GENERIC) // ③ 分流点
}
```

只有 **非 `turn-stopped` 且非 abort** 的错误会发消息；是否通用取决于 `imagePromptUserMessage`。

### imagePromptUserMessage

```js
export function imagePromptUserMessage(error) {
  return error instanceof ImagePromptError ? error.userMessage : null;
}
```

> 结论：**只有 `ImagePromptError` 能产生特化用户提示**。任何普通 `Error`（含飞书 SDK `ERR_BAD_REQUEST` 等未包装错误）都走通用。

## 3. 全失败分支表

### 3.1 非图片 / 空消息分支（不等同通用失败）

| # | 位置 | 触发条件 | 抛错/返回 | 最终用户可见 | 是否通用“处理失败” |
|---|------|---------|-----------|--------------|-------------------|
| A1 | `extractInboundMessage` | `message_type` 非 `text/image/post`，或 `content` 非 JSON，或 `image_key` 缺失 | `images=[] , content=''` | `#handle` 内 `!text && !hasImages` → `send('目前支持文字和图片消息。')` | **否**（特化） |
| A2 | `extractText` 判空 | `message_type=text` 但 `parsed.text` 为空且无图片 | 同上空消息 | 同上 | **否** |
| A3 | `#processInteractionReply` | 待答交互时收到 `post` 富文本无文字 | `extractText(event)===null` → `send('请用文字回答当前问题。')` | 特化 | **否** |

> 关键：A 类走 `#handle` 的早期 `return`，根本不进 `handleMessageFailure`，因此 **不可能产生“处理失败，请稍后重试”**。手机若因 payload 解析失败走 A1，用户应看到“目前支持文字和图片消息。”而非通用失败——这本身是区分点。

### 3.2 图片链路：特化 ImagePromptError（走 NOT 通用）

| # | 抛点 | code | 触发条件 | userMessage（`imagePromptUserMessage` 非空 → 特化） | 属于票面假说 2 |
|---|------|------|----------|---------------------------------------------------|---------------|
| B1 | `promptContentForMessage` 行 179 | `too-many-images` | `sources.length > 20` | `一次最多只能处理 20 张图片。` | ✅ |
| B2 | `promptContentForMessage` 行 195 / 233 | `image-too-large` | `source.size > 5MB` 或 `loaded.data.length > 5MB` | `图片超过 5 MB，请压缩后重试。` | ✅ |
| B3 | `promptContentForMessage` 行 202 / 240 | `images-too-large` | 总大小 `>20MB` | `一次发送的图片总大小过大，请减少图片数量或压缩后重试。` | ✅ |
| B4 | `promptContentForMessage` 行 218 | `image-download-failed` | `source.load()` 抛非 `ImagePromptError` 且非 abort | `图片下载失败，请重新发送后再试。` | ✅ |
| B5 | `promptContentForMessage` 行 227 | `invalid-image-data` | `loaded.data.length===0` | `未能读取图片内容，请重新发送。` | ✅ |
| B6 | `promptContentForMessage` 行 250 | `unsupported-image-type` | 非 JPEG/PNG/GIF/WebP 魔数 | `暂不支持该图片格式，请发送 JPEG、PNG、WebP 或 GIF 图片。` | ✅ |
| B7 | `fetchImageBuffer` 行 55 | `image-redirect-blocked` | 3xx 重定向 | `图片下载地址发生了重定向，暂时无法读取。` | ✅（宿主下载路径，非飞书当前主路径） |
| B8 | `fetchImageBuffer` 行 63 | `image-http-error` | HTTP 非 2xx | `图片下载失败（HTTP xxx），请重新发送后再试。` | ✅（Slack/Discord 路径） |
| B9 | `message-utils.mjs:feishuImageSource.load` 行 197 | `feishu-image-permission-required` | `feishuProviderCode(error)===99991672`（`im:message:readonly` 缺失，支持流式错误体解析） | `飞书机器人缺少图片读取权限。请在飞书开放平台为该应用添加 im:message:readonly，发布新版本并完成必要的管理员审批后，再重新发送图片。` | ✅ 特化（票面列为“被特化提示”的代表） |
| B10 | `message-utils:readBoundedStream` 行 113 / `feishuImageSource` 行 224 | `image-too-large` | 声明 `content-length > maxBytes` 或流式累计 `>maxBytes` | `图片超过 5 MB，请压缩后重试。` | ✅ |

> 共同特征：`error instanceof ImagePromptError === true` 且 `userMessage` 非空 → `handleMessageFailure` 发送特化文案，**不走通用**。

### 3.3 图片链路：通用失败（走 `??` 兜底）

| # | 抛点 | 错误形态 | 为何 `imagePromptUserMessage===null` | 最终用户可见 |
|---|------|----------|--------------------------------------|--------------|
| C1 | `message-utils:feishuImageSource.load` `catch` 行 217 | `client.im.v1.messageResource.get` 抛错且 `feishuProviderCode !== 99991672`（如 `99991400` 权限不足的另一种码、`1064002` 限流、`400` 无可解析错误体、网络超时、SDK 抛 `TypeError` 等） | `feishuImageDownloadError` 原样 `return error`（非 `ImagePromptError`），外层 `promptContentForMessage` 的 `catch` 仅包装“非 abort 且非 ImagePromptError”→ 但此处错误已在 `load()` 内先被 `await feishuProviderCode` 判断，非 99991672 则直接 throw 原 Error → 外层会包装为 `image-download-failed`？**注意细节**：实际链路是 `promptContentForMessage` 行 212-223 `try { result = await source.load() } catch(e){ if(ImagePromptError) throw; throw new ImagePromptError('image-download-failed',…)}`。因此大多数 `C1` 最终会被二次包装为 `B4` 的特化 `image-download-failed`。**例外**：`feishuProviderCode` 在解析错误体流时若 `body` 非 JSON 或超时，`readFeishuErrorBody` 返 `null` → 判定 `null !== 99991672` → 返回原 error → 二次包装为 `image-download-failed`，仍特化。**真正走通用的只有“未经过 `source.load` 二次包装就直接在 #answerWithStream 外抛”的路径**，或 `ImagePromptError` 构造时 `userMessage` 为空（现代码不存在） |
| C2 | `message-utils:feishuImageDownloadError` 未命中 + `promptContentForMessage` 行 216 判定 `signal.aborted` 后 **rethrow 原 Error**（`AbortError/TimeoutError`） | `error.name === 'AbortError'` 且 `signal.aborted===false` 时？ | 实际代码：`if(signal?.aborted || error.name==='AbortError'||error.name==='TimeoutError') throw error`（不包装）。此时 `error` 非 `ImagePromptError` → 通用 | 但上层 `handleMessageFailure` 会先判 `signal.aborted` 静默，若未 abort 仍走通用。实测罕见 |
| C3 | `#answerWithStream` 内 `client` 为空 / `harness.ask` 抛普通 `Error` / `#channel.stream` 在 `promptStarted===false` 时抛普通 `Error` / `askInWorkspaceSession` 创建会话失败 | 普通 `Error` / `TypeError` | 非 `ImagePromptError` → `null` → 通用 | `处理失败，请稍后重试…` |
| C4 | `src/channels/shared/image-prompt.mjs:fetchImageBuffer` 抛非 `ImagePromptError`（如 `Image download URL must use HTTPS` / `not hosted by messaging platform`） | 普通 `Error` | 当前飞书图片链路不用 `fetchImageBuffer`，但若被误用且抛普通 Error → 通用 | 通用 |
| C5 | `readBoundedStream` 行 97 抛 `Feishu image download returned no readable stream`（普通 Error，无流） | 普通 `Error` | 因 `!stream[Symbol.asyncIterator]` 抛普通 Error → 外层包装为 `image-download-failed`（若走 promptContentForMessage）→ 特化；若发生在 `feishuImageSource.load` 内未被捕获的同步段，可能直接冒泡为普通 Error → 通用 |

> **修正 C1 的精确表述**：现代码下，**几乎所有飞书下载失败最终都会被 `promptContentForMessage` 二次包装为特化 `image-download-failed`**，所以“非 99991672 走通用”的原票面假说在现代码是**不完全成立**的——只有同时满足“错误在 `promptContentForMessage` 的 `catch` 之前就未被包装且未进入该 `catch`”才会通用。当前实为：`feishuImageSource.load` 抛普通 Error → `promptContentForMessage` catch → 包装 → 特化。因此若手机图片仍看到通用提示，更可能是 **C3 类（Harness/会话/流式卡片前置失败）** 而非下载本身，或下载抛的是 `AbortError` 类被静默后又被外层当普通 Error 处理。

更精确的判定树：

```
feishuImageSource.load() throw?
 ├─ code === 99991672 ──→ ImagePromptError(feishu-image-permission-required) ──→ 特化（权限文案）
 ├─ code !== 99991672 ──→ 原 Error
 │     └─ promptContentForMessage catch ─→ ImagePromptError(image-download-failed) ─→ 特化（“图片下载失败，请重新发送”）
 ├─ AbortError/TimeoutError且signal未abort ──→ 原 Error rethrow ──→ 通用（若未被signal静默）
 └─ 其他普通Error ──→ 同上包装 ─→ 特化
```

因此**现代码下唯一稳定复现通用的图片相关路径是**：

- 让 `promptContentForMessage` 之前的 `extractInboundMessage` 返回空（A1）→ 特化非通用；
- 让 `promptContentForMessage` 抛 `ImagePromptError` → 均特化；
- 要得到通用，必须让错误 **绕过 `ImagePromptError` 包装**：最可靠的是在 `#answerWithStream` 的 `hasInboundImages` 判断后、`promptContentForMessage` 之前或之后抛普通 `Error`，例如 `harness.ask` 抛 `Error('Harness error')`，或 `client.im.v1.messageResource.get` 抛一个在 `promptContentForMessage` catch 中被判定为 `signal.aborted` 的 `AbortError`。

但回顾 `message-utils.test.mjs:162` 的对照用例：当 `providerError.response.data` 含 `code:99991400` 时，测试断言 `error === providerError`（原样透传），且 `bridge.test.mjs` 中未覆盖 C3 的通用分支——说明测试作者有意区分“可包装的权限错误”与“其他错误原样透传”，只是最终在 `bridge` 层会被二次包装。文档需如实记录这一包装差异。

## 4. 特化 vs 通用对照（ImagePromptError 内部分流）

| code | 是否特化提示 | 用户文案 | 是否走通用“处理失败” |
|------|--------------|----------|----------------------|
| `feishu-image-permission-required` | ✅ 特化 | 飞书机器人缺少图片读取权限…`im:message:readonly` | 否 |
| `image-too-large` | ✅ 特化 | 图片超过 5 MB，请压缩后重试。 | 否 |
| `too-many-images` | ✅ 特化 | 一次最多只能处理 20 张图片。 | 否 |
| `images-too-large` | ✅ 特化 | 一次发送的图片总大小过大… | 否 |
| `unsupported-image-type` | ✅ 特化 | 暂不支持该图片格式，请发送 JPEG、PNG、WebP 或 GIF 图片。 | 否 |
| `image-download-failed` | ✅ 特化 | 图片下载失败，请重新发送后再试。 | 否 |
| `invalid-image-data` | ✅ 特化 | 未能读取图片内容，请重新发送。 | 否 |
| `image-redirect-blocked` | ✅ 特化 | 图片下载地址发生了重定向… | 否 |
| `image-http-error` | ✅ 特化 | 图片下载失败（HTTP xxx）… | 否 |

> 现代码所有 `ImagePromptError` 构造均带 `userMessage`，因此 **不存在 ImagePromptError 走通用的情况**。通用只发生在非 `ImagePromptError`。

## 5. 日志与可观测路径

- `handleMessageFailure` 内 `logger.error('[dsh-feishu] message handling failed:', error?.message)` + `status.lastError = error?.message`：无论特化/通用都会打日志；`bridge.test.mjs` 未断言日志，但 `status.lastError` 在成功后会清 `null`（见 `#handle` finally 后的 `lastError=null`）。
- `message-utils:readFeishuErrorBody` 解析错误体时限 `1s`，超限返回 `null` → 视为非 99991672 → 走包装特化路径，原始 `code` 不会泄露给用户（符合 `bridge.test.mjs:412` 的 `assert.doesNotMatch(... /99991672/)`）。
- `#finishReaction(ERROR)` 与 `#removeProcessingReaction` 的 reaction 错误仅 `warn`，不影响主失败文案。

## 6. 最小复现用例设计（基于 `bridge.test.mjs` 现有 fixture）

> 目标：用最小 mock 区分 A / B / C 三类，并验证哪条走通用。

### 用例 0：基座 fixture（复用现有）

```js
import { FeishuHarnessBridge } from '../../../src/channels/feishu/bridge.mjs';
function bridgeFor({ client, harness, state, status }) { … } // 同 bridge.test.mjs 的 stateFixture/bridgeStatus/textClient
```

### 用例 1：A1 空消息（应特化“目前支持文字和图片消息。”，非通用）

```js
test('repro A1: mobile unknown message_type yields supported-type hint', async () => {
  const fixture = stateFixture();
  const sent = [];
  const bridge = new FeishuHarnessBridge({
    client: textClient(async ({text})=> sent.push(text)),
    channel: {}, harness: { sessionExists: async()=>true, ask: async()=> 'ok' },
    state: fixture.state, status: bridgeStatus(), allowedSenderOpenIds: new Set(['ou_user']),
  });
  await bridge.accept({
    sender:{sender_type:'user', sender_id:{open_id:'ou_user'}},
    message:{ message_id:'om_a1', message_type:'file', chat_type:'p2p', chat_id:'oc_chat',
      content: JSON.stringify({ file_key:'file_mobile' }) } // 移动端可能误发 file 类型
  });
  await bridge.waitForIdle();
  assert.deepEqual(sent, ['目前支持文字和图片消息。']);
});
```

### 用例 2：B2 超大图（应特化“图片超过 5 MB”）

```js
test('repro B2: declared size over limit is specialized', async () => {
  const fixture = stateFixture([['p2p:ou_user','sess']]);
  const sent=[];
  const client={ im:{v1:{ messageResource:{get: async()=> ({
    headers:{'content-length': String(6*1024*1024)}, getReadableStream: ()=> Readable.from([Buffer.alloc(6*1024*1024)])
  })}, message:{create: async(req)=>{sent.push(JSON.parse(req.data.content).text); return {code:0}} }}}};
  const bridge = new FeishuHarnessBridge({ client, channel:{}, harness:{ sessionExists: async()=>true, ask: async()=> assert.fail()}, state: fixture.state, status: bridgeStatus(), allowedSenderOpenIds: new Set(['ou_user'])});
  await bridge.accept({ sender:{sender_type:'user', sender_id:{open_id:'ou_user'}}, message:{ message_id:'om_b2', message_type:'image', chat_type:'p2p', chat_id:'oc_chat', content: JSON.stringify({image_key:'img_big'})}});
  await bridge.waitForIdle();
  assert.match(sent[0], /5 MB/);
});
```

### 用例 3：B9 权限缺失（应特化 `im:message:readonly`）

已由现用例覆盖：`bridge.test.mjs: 'bridge tells users to grant im:message:readonly when Feishu rejects image access'`。复现时构造 `providerError.response.data = Readable.from(JSON.stringify({code:99991672}))`。

### 用例 4：C3 通用失败（唯一稳定触发通用的图片相关路径 — harness 侧普通 Error）

```js
test('repro C3: non-ImagePromptError reaches generic failure', async () => {
  const fixture = stateFixture([['p2p:ou_user','sess']]);
  const sent=[];
  const client={ im:{v1:{ messageResource:{get: async()=> ({ headers:{}, getReadableStream:()=> Readable.from([PNG_1X1])})}, message:{create: async(req)=>{sent.push(JSON.parse(req.data.content).text); return {code:0}} }}}};
  const bridge = new FeishuHarnessBridge({
    client, channel:{},
    harness:{ sessionExists: async()=>true, ask: async()=> { throw new Error('Harness error'); } },
    state: fixture.state, status: bridgeStatus(), allowedSenderOpenIds: new Set(['ou_user']),
  });
  await bridge.accept({ sender:{sender_type:'user', sender_id:{open_id:'ou_user'}}, message:{ message_id:'om_c3', message_type:'image', chat_type:'p2p', chat_id:'oc_chat', content: JSON.stringify({image_key:'img_ok'})}});
  await bridge.waitForIdle();
  assert.match(sent[0], /处理失败，请稍后重试/);
  assert.equal(sent[0].includes('99991672'), false);
});
```

### 用例 5：C1-like 非 99991672 的下载失败（现代码实为特化，需验证包装）

```js
test('repro C1 wrapped: non-99991672 is wrapped to image-download-failed (specialized)', async () => {
  const fixture = stateFixture([['p2p:ou_user','sess']]);
  const sent=[];
  const providerError = new Error('bad request'); providerError.response={ status:400, data: Readable.from([Buffer.from(JSON.stringify({code:99991400}))]) };
  const client={ im:{v1:{ messageResource:{get: async()=>{ throw providerError; }}, message:{create: async(req)=>{sent.push(JSON.parse(req.data.content).text); return {code:0}} }}}};
  const bridge = new FeishuHarnessBridge({ client, channel:{}, harness:{ sessionExists: async()=>true, ask: async()=> assert.fail()}, state: fixture.state, status: bridgeStatus(), allowedSenderOpenIds: new Set(['ou_user'])});
  await bridge.accept({ sender:{sender_type:'user', sender_id:{open_id:'ou_user'}}, message:{ message_id:'om_c1', message_type:'image', chat_type:'p2p', chat_id:'oc_chat', content: JSON.stringify({image_key:'img_x'})}});
  await bridge.waitForIdle();
  // 现代码：走特化 image-download-failed，而非通用
  assert.match(sent[0], /图片下载失败，请重新发送/);
  assert.doesNotMatch(sent[0], /处理失败，请稍后重试/);
});
```

> 若该用例在真机仍观察到通用，则说明错误未经过 `promptContentForMessage` 的包装层（例如 `extractInboundMessage` 阶段 `client` 为空导致同步抛 `TypeError`，或 `#answerWithStream` 内 `channel.stream` 在 `promptStarted===false` 时抛普通 Error）。

### 用例 6：A1 的移动端变体（image_key 更名为 file_key）

```js
test('repro A1 variant: mobile sends file_key not image_key', async () => {
  const fixture = stateFixture();
  const sent=[];
  const bridge = new FeishuHarnessBridge({ client: textClient(async ({text})=>sent.push(text)), channel:{}, harness:{ sessionExists: async()=>true, ask: async()=> 'ok' }, state: fixture.state, status: bridgeStatus(), allowedSenderOpenIds: new Set(['ou_user'])});
  await bridge.accept({ sender:{sender_type:'user', sender_id:{open_id:'ou_user'}}, message:{ message_id:'om_a1b', message_type:'image', chat_type:'p2p', chat_id:'oc_chat', content: JSON.stringify({file_key:'mobile_file_key'})}});
  await bridge.waitForIdle();
  // 因 extractInboundMessage 只认 image_key，images=[] → 触发 A1
  assert.deepEqual(sent, ['目前支持文字和图片消息。']);
});
```

## 7. 对票面三假说的判定

| 假说 | 是否产生通用“处理失败” | 判定依据 |
|------|------------------------|----------|
| 假说 1：`extractInboundMessage` 返空 → `目前支持文字和图片消息。` | **否** | `#handle` 行 398-401 早期 return，不进 `handleMessageFailure`。它是唯一会发“目前支持文字和图片消息。”的分支，与通用文案互斥。若手机因字段名差异（如 `file_key` 而非 `image_key`）导致空 `images`，用户应看到该特化提示而非通用失败——这可作为现场日志区分点。 |
| 假说 2：`promptContentForMessage` 抛 `ImagePromptError`（`image-too-large / unsupported-image-type / image-download-failed` 等）| **否** | 所有 `ImagePromptError` 均带 `userMessage`，`imagePromptUserMessage` 非空 → 发特化文案。票面举例的三个 code 均在 B 组，均不走通用。唯有 `signal`  abort 类会 rethrow 普通 Error 绕过包装，但会被 `handleMessageFailure` 的 `signal.aborted` 静默或走通用（罕见）。 |
| 假说 3：`client.im.v1.messageResource.get` 抛非 `99991672` 错误走通用 | **现代码下不完全成立** | `message-utils.mjs: feishuProviderCode` 仅对 `99991672` 特判，其余原样返回，但 `promptContentForMessage` 行 215-223 会将该普通 Error 二次包装为 `image-download-failed` 特化错误 → 最终仍发“图片下载失败，请重新发送”。因此 **纯下载失败几乎不会走通用**，除非错误发生在包装层之外（如 harness/会话/流式卡片 creation 失败，或 `client` 为空的同步 `TypeError`）。`message-utils.test.mjs: 'leaves unrelated provider failures on the generic path'` 验证的是 `load()` 层的原样透传，而 `bridge` 层的二次包装使其最终特化，两层测试共同说明了该差异。 |

**综合结论**：手机图片若真实表现为通用“处理失败，请稍后重试…”，**最可能根因不是下载本身，而是下载成功后的链路（Harness 会话绑定 / `askInWorkspaceSession` / 流式卡片 `channel.stream` 在 `promptStarted===false` 时的异常），或移动端 payload 结构导致 `extractInboundMessage` 未提取到图片后又因其他异常进入通用分支**。单纯的“下载抛非 99991672”在现代码下已被包装为特化提示，不应表现为通用。

## 8. 与现有测试的覆盖对照

| 测试 | 覆盖分支 | 未覆盖的通用分支 |
|------|----------|------------------|
| `bridge.test.mjs: bridge downloads an inbound Feishu image once and submits structured Harness content` | B 成功链路（正常图） | — |
| `bridge.test.mjs: bridge tells users to grant im:message:readonly when Feishu rejects image access` | B9 特化权限 | — |
| `bridge.test.mjs: bridge sends Feishu post text and all embedded images` | post 多图成功 | — |
| `message-utils.test.mjs: maps the missing message scope to an actionable error` | B9 底层 | — |
| `message-utils.test.mjs: leaves unrelated provider failures on the generic path` | C1 的 `load()` 层透传（但未验证 `bridge` 层的二次包装后特化） | 需补充 bridge 层对非 99991672 的端到端断言（用例 5） |
| `image-prompt.test.mjs: declares oversized images are rejected` 等 | B2/B3/B6 等 | 未覆盖 C3 通用（harness 抛普通 Error）的 bridge 端到端 |
| 缺口 | — | C3（harness/stream 普通 Error → 通用）、A1 移动端变体（`file_key` 误命名 → “目前支持文字和图片消息。”）建议补齐 |

## 9. 下一步建议（给票 #5 脚手架与票 #6 对照用）

1. **补日志**：在 `handleMessageFailure` 的 `logger.error` 中同时打印 `error.code` / `error instanceof ImagePromptError` / `providerCode`，并在 `feishuImageSource.load` 的 `catch` 中打印 `feishuProviderCode` 结果，便于真机区分 C1 与 C3。
2. **票 #5 脚手架**：按第 6 节 6 个用例落地为 `test/channels/feishu/mobile-repro.test.mjs`，并在 `bridge` 中注入可观测的 `onFailureBranch` 回调（仅测试用）用于断言实际走的分支 ID（A1/B9/C3 等）。
3. **票 #1 payload 差异**：重点验证移动端是否出现 `message_type=file` 或 `image_key` 更名，若存在则 A1 会被触发，应扩展 `extractInboundMessage` 兼容 `file_key` 而非直接归为通用失败。
4. **票 #6 对照**：核对 MiniMaxCode 侧 `messageResource.get` 的 `type` 参数（`image` vs `file`）与错误体解析是否一致；若 MiniMaxCode 未做二次包装，则同样错误在 dsh-im 侧特化、在 MiniMaxCode 侧通用，或反之，这能解释“同权限下表现不同”。

## 10. 变更记录

- 本分支仅新增本文档，不改 `src/`。如需修复，应另起 `feat/feishu-mobile-image` 分支，并在 `extractInboundMessage` 与 `promptContentForMessage` 的错误包装边界做最小改动。
