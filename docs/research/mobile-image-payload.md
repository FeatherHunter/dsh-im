# #3 Research：飞书移动端图片 payload 差异

- **关联地图**：#2 `Wayfinder Map：飞书手机图片入站修复`
- **分支**：`research/feishu-mobile-payload`（基于 `private/custom` @ `b1dbfe1`）
- **研究日期**：2026-08-20
- **作者**：research 子代理
- **范围**：仅图片入站（`im.message.receive_v1`），不含文件/音视频/HTML；渠道仅飞书

## 1. 研究问题回顾

> 飞书手机 APP 发送图片时，下发的事件 `event.message.message_type` / `content` 与桌面端有何差异？是否出现 `message_type=file`、`image_key` 字段缺失/更名、`content` 非 JSON 字符串、`post` 富文本结构不同等导致 `extractInboundMessage` 未能提取到 `images`？

需要产出：**桌面端 vs 移动端 payload 差异表 + 现代码哪一分支走空 + 兼容建议**。

## 2. 方法

1. 读 `CONTEXT.md` + `docs/adr/0001-fork-and-branch-strategy.md` + `docs/agents/*.md` 确认单上下文与分支契约。
2. 静态审计 `src/channels/feishu/message-utils.mjs:21-246`（`parsedMessageContent / postContent / extractInboundMessage / feishuImageSource`）与 `bridge.mjs:394-400` 的空消息判定、`test/channels/feishu/message-utils.test.mjs` 的覆盖边界。
3. 拉取飞书开放平台一手资料（`web_search` + `curl` 抓 `*.md`）：
   - 发送侧内容构造：`open.feishu.cn/document/server-docs/im-v1/message-content-description/create_json.md` — 定义 `msg_type=image` 的 `{"image_key": "img_xxx"}` 与 `post` 的 `{"zh_cn":{"title","content":[[{"tag":"img","image_key"}]]}}` 结构
   - 接收侧内容结构：`open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/im-v1/message/events/message_content.md` — 定义接收时 `msg_type` 枚举与 `content:string(JSON)` 及 `post` 的 `content/content_v2`、`image/file/media`、`md` 标签行为
   - 事件信封：`open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/im-v1/message/events/receive.md` — 定义 `message.message_type/content/mentions` 始终为 `string`（JSON 序列化）
   - 社区对照：`CherryHQ/cherry-studio#14421` patch — 历史上同类 `message_type=image` 被 `messageType !== 'text'` 早期 return 静默丢弃的现场修复
4. 交叉验证：把官方文档的 `image / file / media / post` 接收结构套进当前 `extractInboundMessage` 的三条分支做符号执行。

## 3. 官方定义（Desktop 与 Mobile 共享，但客户端行为分叉）

### 3.1 事件信封（receive_v1）

| 字段 | 类型 | 说明 | 来源 |
|---|---|---|---|
| `event.message.message_type` | `string` | `text \| post \| image \| file \| audio \| media \| sticker \| interactive \| share_chat \| share_user \| system` 等 | [receive.md](https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/im-v1/message/events/receive) |
| `event.message.content` | `string` | **JSON 序列化字符串**，不同 `message_type` 对应不同 schema | 同上 |
| `event.message.mentions` | `mention_event[]` | `@` 序号映射，`key=@_user_X` | 同上 |
| `event.message.chat_type` | `p2p \| group` | 单聊/群聊 | 同上 |

> 官方信封层面 **不区分桌面/移动**；差异藏在 `content` 的 JSON 形状与 `message_type` 的选取上。

### 3.2 各 `message_type` 的 `content` JSON（接收侧）

| `message_type` | `content` JSON（接收） | 关键字段 | 文档 |
|---|---|---|---|
| `image` | `{"image_key":"img_xxx"}` | `image_key` | [message_content.md#image](https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/im-v1/message/events/message_content) 与 [create_json.md#image](https://open.feishu.cn/document/server-docs/im-v1/message-content-description/create_json.md) |
| `file` | `{"file_key":"…","file_name":"…jpg"}` | `file_key`, `file_name` | 同上 `#file` |
| `media` (视频) | `{"file_key":"…","image_key":"…","file_name":"…","duration":2000}` | 既有 `file_key` 也有可选 `image_key` 封面 | 同上 `#media` |
| `post` | `{"title":"…","content":[[{"tag":"text","text":"…"},{"tag":"img","image_key":"…"}],…],"content_v2":[[{"tag":"md","text":"…"}]]}` | `content` 为段落数组；`content_v2` 含 `md`；`img` 段必须独立段 | 同上 `#post`，`create_json.md#post` 同时注明“`md` 仅在 `content_v2` 保留，`content` 中会被转译为 `text`” |
| `text` | `{"text":"…"}` | `text` 可含 `@_user_X` / `[label](url)` | 同上 `#text` |

### 3.3 为什么移动端会偏离

官方从未承诺移动端与桌面端生成的 `content` 完全一致；已知分叉点：

- **富文本输入法**：移动端键盘/相册/剪切板走 **富文本 `post`** 通道，而桌面端拖拽单图常走 **纯 `image`** 通道。
- **Markdown 便捷输入**：移动端 `md` 标签 `![alt](img_xxx)` 在 **发送侧** 合法，但在 **接收侧** 会被服务端重写 — `content` 展开为 `text`，`content_v2` 保留 `md`。桌面端较少触发 `md`。
- **相册多选/压缩路径**：部分移动端 ROM 的“发送原图/文件”开关会把图片包装成 `file`（`file_key + file_name: *.jpg`），而桌面端几乎不出现。
- **混合图文**：移动端“粘贴图文”或“相册+文字一起发”是 `post`（`text + img` 混段）；桌面端“先发文字再发图”是两条独立事件。
- **语言包**：发送侧 `post` 示例为 `{"zh_cn":{"title","content":[…]}}`，但接收侧扁平为 `{"title","content":[…]}`；若某旧版移动端 SDK 误透传嵌套结构，解析会失配（见 §5-F）。

## 4. 当前代码路径（`src/channels/feishu/message-utils.mjs`）

### 4.1 关键函数定位

| 函数 | 行号 | 职责 |
|---|---|---|
| `parsedMessageContent(event)` | L21-31 | 若 `event.message.content` 已是对象则直返；若是 `string` 则 `JSON.parse`；否则 `null` |
| `postContent(event, parsed)` | L53-81 | 仅当 `message_type===post` 时解析；抽 `title` + 遍历 `parsed.content: paragraph[]`，只认 `tag===img → image_key`，只认 `text/a/link` 的文本；忽略 `file_key/media/md/at` 等 |
| `extractInboundMessage(event, client)` | L235-247 | 计算 `standaloneImageKey = messageType==='image' ? parsed.image_key : null`，`imageKeys = standalone ? [key] : post.imageKeys ?? []`，`content = messageType==='text' ? extractText(event) : post.text ?? ''`，`images = imageKeys.map(feishuImageSource)` |

测试覆盖（`test/channels/feishu/message-utils.test.mjs`）：单 `image`、多 `img` 的 `post`、`image_key` 为空被过滤、非 JSON 时返回 `images:[]` — **未覆盖 `file/media/md/file_key` 与 `content` 为对象** 的移动端分支。

### 4.2 `bridge.mjs` 的下游判定

`bridge.mjs:394-400`
```js
const message = extractInboundMessage(event, client);
const text = message.content; const hasImages = hasInboundImages(message);
if (!text && !hasImages) { await send(chat_id,'目前支持文字和图片消息。'); return; }
```
若 `extractInboundMessage` 返回空，即被误判为“不支持的消息类型”，用户在移动端看到“仅支持文字和图片”而非真实错误。

## 5. 桌面端 vs 移动端差异表（推断 + 文档实证）

> “移动端”列为 **基于官方结构 + 社区复现 + 客户端行为** 的差异假设，需用 §7 的捕获脚手架在真机上固化；“当前代码命中”列标注会哪一分叉走空。

| # | 维度 | 桌面端典型 | 移动端典型 | 官方/社区依据 | 当前代码命中 | 后果 |
|---|---|---|---|---|---|---|
| **A** | `message_type` | 单图 → `image`；图文 → `post`（段分离）；多图连续 → 多条 `image` | 单图仍 `image`，但 **相册“文件方式”发送/原图** → `file`（`file_key + *.jpg`）；**视频/动图** → `media`；**图文混发/粘贴** → `post` 占比更高 | `create_json.md` 与 `message_content.md` 同时定义 `image/file/media`；社区 `Claude-to-IM` 适配 `file/audio/video/media` 分支可佐证 | `extractInboundMessage` 仅 `===image` 与 `===post` 两个正分支，`file/media` **直接走空** (`imageKeys=[]` + `content=''`) | 移动端“文件式发图”被判“不支持” |
| **B** | `content` 类型 | 恒为 `string`（JSON 序列化），如 `"{\"image_key\":\"img_xxx\"}"` | 同为 `string`，但 **部分 SDK/长连接库透传后已被预解析为对象**（`@larksuiteoapi/node-sdk` 的 `JSON.parse` 上游），且 **移动端 `post` 可能同时带 `content_v2`** | `receive.md` 定义 `content:string(JSON)`；`parsedMessageContent` 已兼容 `object` 直返，说明上游有对象透传历史 | `object` 情况已兼容；`string` 异常 JSON（如截断/单引号）→ `null` → 走空，桌面/移动同风险 |
| **C** | `image` 的 key 字段 | `{"image_key":"img_xxx"}` | 极少数移动端/旧版可能返回 `{"file_key":"img_xxx"}` 或 camelCase `imageKey` / `image_key` 大小写差异；以及 `{"image_key":"", "file_key":"img_xxx"}` 双字段并存 | `message_content.md#image` 规范 `image_key`；但 `file` 规范 `file_key`，两者易混；社区 `Claude-to-IM` 显式处理 `file` 是佐证 | `standaloneImageKey = parsed.image_key` 单字段 → `file_key` 场景 **走空** |
| **D** | `post.content` 形状 | `[[{"tag":"text","text":"…"}], [{"tag":"img","image_key":"…"}]]` — `img` 独占段 | 形态相同，但 **(D1)** 移动端 `img` 可能写作 `{"tag":"img","file_key":"img_xxx"}`；**(D2)** 移动端 `post` 内 `at` 的 `user_id` 已是 `@_user_X` 序号而非真实 `open_id`；**(D3)** 连续多图在移动端更常压入同一 `post`（一次发多张） | `message_content.md#post` 规范 `img` 仅 `image_key`，但 `media` 规范显示 `file_key+image_key` 并存，移动端易复用 `file_key` | `postContent` 仅 `tag===img && image_key` → `file_key` 写法 **走空**；`md` 标签被忽略 |
| **E** | `post` 内的 Markdown 图片 | 桌面端几乎不用 `md` | 移动端键盘“Markdown 粘贴”或第三方输入法常产出 `tag:md, text:"… ![alt](img_v3_xxx) …"`，接收侧 **仅 `content_v2` 含 `md`，`content` 无 `md`** | `create_json.md#md` 与 `message_content.md#post` 均强调“`md` 仅在 `content_v2`” | `postContent` 不读 `content_v2` 也不解析 `md` 文本 → **移动端 Markdown 图片全部走空** |
| **F** | `post` 语言包裹 | 接收侧扁平 `{"title","content":[…]}` | 若移动端旧 SDK 透传发送侧结构 `{"zh_cn":{"title","content":[…]}}`，则当前 `parsed.title / parsed.content` 均读不到 | 发送侧文档嵌套 `zh_cn/en_us`，接收侧文档扁平 — 差一层易错位 | `parsed.title/content` 为 `undefined` → `post` 返回 `{text:'', imageKeys:[]}` 走空 |
| **G** | `image` 的下载语义 | `client.im.v1.messageResource.get({ path:{message_id,file_key}, params:{type:'image'}})` — `type=image` | 移动端 `file_key` 图片需 `type=file` 才能取到；`media` 需 `type=file` + 取 `image_key` 封面分开 | 官方 `im.v1.messageResource.get` 的 `type` 枚举含 `image/file`；`file` 图片用 `type=file` 才能下载 | `feishuImageSource` 硬编码 `params:{type:'image'}` → 移动端 `file` 图片 **下载 400** |
| **H** | `content` 非 JSON | 几乎不出现 | 移动端网络抖动/表情 `sticker` 的 `content` 可能为 `""` 或非 JSON（如 `{"sticker":"…"}` 被截断） | 通用健壮性 | `parsedMessageContent` 返回 `null` → 走空，表现同桌面端一致（非移动特有） |

## 6. 现代码哪一分支会走空（精确行号）

### 6.1 走空 1：`file / media` 单图

- **触发**：移动端 `message_type=file` + `content: {"file_key":"…jpg","file_name":"IMG_1234.jpg"}`
- **走空位置**：`message-utils.mjs:239-242`
  ```js
  const standaloneImageKey = messageType === 'image' ? nonEmptyString(parsed?.image_key) : null;
  //  file → standaloneImageKey = null
  const imageKeys = standaloneImageKey ? [standaloneImageKey] : post?.imageKeys ?? [];
  //  post 为 null（非 post） → imageKeys = []
  ```
  `content` 亦为 `post?.text ?? ''` → `''`，`images: []`。
- **下游**：`bridge.mjs:398` 误判为不支持类型。
- **测试盲区**：`message-utils.test.mjs` 无 `file/media` 用例。

### 6.2 走空 2：`post` 内的 `img.file_key` 写法

- **触发**：`message_type=post`, `content.content[1]=[{"tag":"img","file_key":"img_xxx"}]`（无 `image_key`）
- **走空位置**：`message-utils.mjs:66-68`
  ```js
  if (tag === 'img') { const key = nonEmptyString(element?.image_key); if (key) imageKeys.push(key); }
  //  file_key 场景 key=null → 不入队
  ```
  即使其他段有合法 `image_key`，`file_key` 图片全部丢失。

### 6.3 走空 3：`post` 内的 `md` 图片

- **触发**：`message_type=post`, `content.content_v2=[[ {"tag":"md","text":"![alt](img_v3_xxx)"} ]]` 且 `content=[[ {"tag":"text","text":"![alt](img_v3_xxx)"} ]]`（服务端重写后）
- **走空位置**：`postContent` 全程不读 `parsed.content_v2`，且对 `tag:md` 无分支 → `imageKeys=[]`。
- **隐蔽性**：移动端专属；桌面端几乎不产生 `md`，故线上“仅移动端失败”。

### 6.4 走空 4：`image` 的 `file_key` 字段名漂移

- **触发**：`message_type=image`, `content: {"file_key":"img_xxx"}` 或 `{"imageKey":"img_xxx"}` / `{"image_key":""}` 空串
- **走空位置**：同 6.1 的 `parsed?.image_key` 单字段读取 → `null`。

### 6.5 走空 5：`zh_cn` 嵌套

- **触发**：`content: {"zh_cn":{"title":"…","content":[[{"tag":"img","image_key":"…"}]]}}`
- **走空位置**：`postContent:55-61` 读取 `parsed.title / parsed.content`，嵌套下取不到 → `imageKeys=[]` / `text=''`。

### 6.6 潜在走空 6：`type=file` 的下载

- 即使通过 6.1/6.2 兼容提取到 `file_key`，`feishuImageSource:215` 恒 `params:{type:'image'}` 会对 `file_key` 资源 400。

## 7. 建议的兼容字段（不改主分支，仅研究稿）

> 目标：**最小侵入、向前兼容、无损桌面端**；均可在 `research/feishu-mobile-payload` 上以纯新增分支实现，待 #4 定案后合并。

### 7.1 `extractInboundMessage` 的分支扩展

```js
// 1) 单图：image | file | media 互备
const imageKeyCandidates = [
  parsed?.image_key, parsed?.file_key,   // 平坦
  parsed?.imageKey, parsed?.fileKey,     // 驼峰容错
];
const standaloneImageKey = (messageType === 'image' || messageType === 'file' || messageType === 'media')
  ? firstNonEmpty(imageKeyCandidates)
  : null;
const standaloneType = standaloneImageKey
  ? (messageType === 'file' || messageType === 'media' || parsed?.file_key ? 'file' : 'image')
  : null;

// 2) post：读 content_v2 优先，解析 md + img/file_key
const post = postContent(event, parsed) // 内部同时读 content_v2 并正则抽 md 中的 img key
const imageKeys = standaloneImageKey
  ? [{ key: standaloneImageKey, type: standaloneType }]
  : (post?.imageKeys ?? []);
```

### 7.2 `postContent` 的加固

| 加固点 | 策略 |
|---|---|
| 语言包裹 | 若 `parsed.zh_cn?.content` 存在则 `parsed = parsed.zh_cn`（`en_us` 同理），再读 `title/content` |
| `content` 缺失时读 `content_v2` | `const raw = parsed.content ?? parsed.content_v2 ?? []`；优先 `content`，`content_v2` 作回退 |
| `img.file_key` 兼容 | `tag===img` 时取 `image_key ?? file_key ?? imageKey ?? fileKey`，任意非空即入队 |
| `md` 图片 | 扫描 `content_v2` 中 `tag===md` 的 `text`，用 ` /!\[.*?\]\(\s*(img_[a-zA-Z0-9_-]+)\s*\)/g` 抽取所有 `img_xxx`；同时兼容 `image_key` 裸字符串 |
| `media` 段 | `tag===media` 时抽 `image_key`（视频封面）与 `file_key` 分流（`file_key` 归档给后续文件通道，此研究仅记录） |
| 空串过滤 | 全链路 `nonEmptyString` 已有，保留 |

### 7.3 `feishuImageSource` 的 `type` 自适应

```js
// 依据 key 关联的原始 message_type / 字段名决定
params: { type: standaloneType ?? 'image' } // file/media/file_key → 'file'，否则 'image'
```

### 7.4 `parsedMessageContent` 的容错

- 已兼容 `object` 直返，保持不变。
- 新增对 `content` 为 `Buffer`/`number` 的防御（直接 `null`），与当前一致。
- 若 `content` 为 **双重序列化**（`"\"{\\\"image_key\\\":\\\"img_xxx\\\"}\""`）— 检测首尾引号二次 `JSON.parse`，移动端罕见但可低成本兜底。

### 7.5 `bridge.mjs` 不需动

只要 `extractInboundMessage` 能产出 `images.length>0`，`hasInboundImages` 即可进入 `promptContentForMessage` 的图片分支；无需改 `bridge` 的空判定文案。

## 8. 证据与可追溯性

- **主失效锚点**：`CherryHQ/cherry-studio#14421` — `if (messageType !== 'text') return` 曾静默丢弃所有 `image`，本仓库 `L235-246` 已修复该路径，但未扩展 `file/media/md/file_key`。
- **官方结构**：`open.feishu.cn/document/server-docs/im-v1/message-content-description/create_json.md`（发送）与 `open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/im-v1/message/events/message_content.md`（接收）对 `image/post` 的 `image_key`、`content_v2/md` 行为一致性描述，见 §3 引用。
- **事件信封**：`open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/im-v1/message/events/receive.md` 定义 `content` 为 `string(JSON)`，与 `parsedMessageContent` 的双态兼容一致。

## 9. 待固化的真机捕获（交 #5）

在 `research/feishu-mobile-payload` 上，建议 #5 脚手架落地以下 **最小可复现矩阵**（均需 `p2p` 与 `group@` 各一遍）：

| 场景 | 移动端操作 | 预期 `message_type/content` | 验收 |
|---|---|---|---|
| 单图-相册 | iOS/Android 相册选 1 张“原图”发送 | `image {"image_key":"img_xxx"}` 或 `file {"file_key":"…jpg"}` | 抽到 1 张，Harness `content[1].type=image` |
| 多图-相册 | 相册多选 3 张一次发 | `post` 内 3×`img` 或 1×`md` 内 3×`![…](img_xxx)` + `content_v2` | 抽到 3 张 |
| 图文混发 | 输入框粘贴文字+图片 | `post` 内 `text+img` 混段 | `content.text` 含文字，`images=1` |
| Markdown 图片 | 移动端输入 `![a](img_xxx)` | `post content_v2: md` | 同上 |
| 文件式图片 | “发送文件”选 JPG | `file {"file_key","file_name":"*.jpg"}` | 归为图片分支或提示“文件通道另议”但不误判“仅支持文字图片” |

捕获手段：`src/channels/feishu/feishu-channel.mjs` 或 `bridge.mjs#accept` 入口处 `logger.info(JSON.stringify(event.message,null,2))` 落盘到 `research/captures/`（脱敏 `open_id/chat_id`）。

## 10. 风险与 Out-of-scope

- **文件/视频本体重传**：`file/media` 的 `file_key` 若为非图片（PDF/真视频），当前按图片下载会误用 `type=file` 且 `detectedImageMediaType` 判形失败，应由 #2b 另案处理；本研究仅建议 **“文件名 `*.jpg|png|webp|gif` 时才按图片兼容”** 的保守策略。
- **权限**：`im:message:readonly` 缺失时，移动端与桌面端同为 `99991672` 权限错，非移动特有，已在 `message-utils.mjs:6-16` 与 `feishuImageDownloadError` 中映射为中文指引，无需移动端分支主导。
- **sticker/interactive** 等非图片类型保持忽略。

## 11. 结论（一句话）

- **桌面端**：纯 `image {"image_key"}` 与标准 `post [[text],[img image_key]]` 已被 `message-utils.mjs:239-242 + 53-81` 完全覆盖。
- **移动端增量风险**：`file/media`、`img.file_key`、`md` 内的 Markdown 图片、`zh_cn` 嵌套四类结构会使 `extractInboundMessage` 的 `imageKeys` 走空，进而在 `bridge.mjs:398` 被误判为“不支持”。
- **最小兼容**：扩展 `message_type ∈ {image,file,media}`、通吃 `image_key/file_key` 与驼峰、`post` 同时读 `content_v2/md` 并正则抽 `img_xxx`、`zh_cn` 解包、`feishuImageSource` 的 `type` 按来源自适应，即可覆盖已知的全部移动端分叉而零回退桌面端。

---

*本文件为纯研究产出，未修改 `main` / `private/custom` 的运行时代码；实现细节待 #4 定版后在 `feat/feishu-mobile-image`（含测试）落地。*
