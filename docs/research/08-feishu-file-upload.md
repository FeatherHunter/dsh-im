# Research #8：飞书文件/图片回传的 SDK 路径与权限映射

> **Wayfinder 任务 #8 / 地图 2b** — 验证 `@larksuiteoapi/node-sdk@1.73.0` 中 `im.v1.image.create` / `im.v1.file.create` 的真实参数、所需权限、错误码，并检查 `package-lock.json` 中 `file-type` 是否存在。仅研究，不改主分支代码。

**日期**: 2026-08-20  
**分支**: `research/feishu-file-upload`（基于 `private/custom`）  
**研究者**: wayfinder research 子代理  
**范围**: `node_modules/@larksuiteoapi/node-sdk@1.73.0`（`lib/index.js` + `types/index.d.ts` + 官方文档）、`package.json` / `package-lock.json` 中 `file-type`  
**关联**: `CONTEXT.md:5` 2b DSH -> 飞书

---

## 1. TL;DR

| 维度 | 结论 | 证据 |
|---|---|---|
| SDK 路径 | `client.im.v1.image.create` / `client.im.v1.file.create` 真实可用（lib:67383/67691），旧路径 `client.im.image/file.create` 同端点，建议统一 `im.v1.*` | lib + types |
| 图片参数 | `image_type: "message"\|"avatar"`, `image: Buffer\|fs.ReadStream`，`POST /open-apis/im/v1/images` multipart | types + docs |
| 文件参数 | `file_type: "opus"\|"mp4"\|"pdf"\|"doc"\|"xls"\|"ppt"\|"stream"`, `file_name`, `file`, `duration?` ms，`POST /open-apis/im/v1/files` | types:266453 |
| 权限 | `im:resource` 或 `im:resource:upload` 二选一，需机器人能力 | 官方权限表 |
| 错误码 | 共享 232096/234001/234002/234006/234007/234010/234041/234042，image 独有 234011/234039 | docs 表 |
| file-type | `package-lock.json` 存在 `file-type@21.3.4` 但 `dev:true` via `music-metadata@11.14.0`，`package.json` 未直引，`--omit=dev` 会丢失 | lock |

---

## 2. 方法

1. `npm install` 后精读 `lib/index.js` 与 `types/index.d.ts`，定位 `/open-apis/im/v1/images|files` 与 `file_type.*opus`
2. 抓取官方 Markdown：`.../im-v1/image/create.md` 与 `.../file/create.md`
3. 版本核验 `package.json 1.73.0` 与 `node_modules` 一致
4. 解析 `package-lock.json` 的 `file-type` 反向链
5. 全仓 grep `file-type` 零命中

---

## 3. 真实参数

### 3.1 REST 端点

- 图片：`POST https://open.feishu.cn/open-apis/im/v1/images` `multipart/form-data`
- 文件：`POST https://open.feishu.cn/open-apis/im/v1/files` `multipart/form-data`

宿主封装（lib 104293-104345）：

```js
const r = await this.client.im.v1.image.create({ data: { image_type: "message", image: buffer } });
const key = r?.image_key ?? r?.data?.image_key;

const data = { file_type: fileType, file_name: fileName, file: buffer };
if (durationMs != null) data.duration = durationMs;
const r2 = await this.client.im.v1.file.create({ data });
const key2 = r2?.file_key ?? r2?.data?.file_key;
```

类型：

```ts
image.create: (payload?: { data: { image_type: "message"|"avatar"; image: Buffer|fs.ReadStream } }) => Promise<{image_key?:string}|null>
file.create: (payload?: { data: { file_type: "opus"|"mp4"|"pdf"|"doc"|"xls"|"ppt"|"stream"; file_name: string; file: Buffer|fs.ReadStream; duration?: number } }) => Promise<{file_key?:string}|null>
```

### 3.2 官方文档

| 接口 | MD | HTTP | 鉴权 | 限流 |
|---|---|---|---|---|
| 上传图片 | [image/create.md](https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/reference/im-v1/image/create.md) | POST /open-apis/im/v1/images | tenant_access_token | 1000/min 50/s |
| 上传文件 | [file/create.md](https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/reference/im-v1/file/create.md) | POST /open-apis/im/v1/files | 同上 | 同上 |

**图片请求体**：`image_type` message|avatar 必填；`image` file 必填 ≤10MB >0，GIF≤2000×2000 其他≤12000×12000，支持 JPG/JPEG/PNG/WEBP/GIF/BMP/ICO/TIFF/HEIC

**文件请求体**：`file_type` 必填 7 选 1；`file_name` 必填含后缀；`duration` 选填 ms；`file` 必填 ≤30MB >0

**响应**：`{code:0, data:{image_key}}` / `{file_key}`；SDK `return res?.data ?? null` 故顶层即 key，保留 `r?.data?.image_key` 兜底

---

## 4. 权限映射

- **前提**：应用开启机器人能力，否则 234007
- **权限（任一即可）**：
  - `im:resource` — 获取与上传图片或文件资源
  - `im:resource:upload` — 上传文件V2
- **发送消息**还需 `im:message` / `im:message:send_as_bot`（非本任务上传两接口范畴，bridge#sendFile 时补充）

**Check List**：
1. 开放平台 → 权限管理 → 添加 `im:resource`（或 `im:resource:upload`）
2. 创建版本并发布
3. 企业管理员审批
4. 回 dsh-im 飞书插件页验证

来源：`image/create.md:权限要求` 与 `file/create.md:权限要求`

---

## 5. 错误码

| HTTP | Code | 描述 | 排查 |
|---|---|---|---|
| 400 | 232096 | Meta writing has stopped | 稍后重试 |
| 400 | 234001 | Invalid request param | 检查参数 |
| 401 | 234002 | Unauthorized | token/权限/机器人 |
| 400 | 234006 | 文件大小超限 | 图片>10M/文件>30M |
| 400 | 234007 | App does not enable bot feature | 启用机器人 |
| 400 | 234010 | File size 0 | 禁空 |
| 400 | 234011 | 无法识别图片格式 | 仅9种 | **image** |
| 400 | 234039 | 分辨率超限 | GIF>2000 其他>12000 | **image** |
| 400 | 234041 | Tenant master key deleted | 联系管理员 |
| 400 | 234042 | Hybrid storage error | 存储满 |

更多见 [通用错误码](https://open.feishu.cn/document/ukTMukTMukTM/ugjM14COyUjL4ITN)。SDK 包为 `LarkChannelError(upload_failed)`，可用 `cause.response.data.code` 细分。

---

## 6. file-type 核验

- `package.json` 未直引
- `package-lock.json`：
  ```json
  "node_modules/file-type": { "version":"21.3.4", "resolved":"https://registry.npmjs.org/file-type/-/file-type-21.3.4.tgz", "dev": true }
  ```
  反向链 `music-metadata@11.14.0 -> file-type ^21.3.4`，`music-metadata` 亦 dev:true
- 本地可用，`type:module`, `exports . -> ./index.js`

**结论**：`npm install` 可用，`--omit=dev` 会丢失。若 2b 需 MIME 嗅探应显式加 `dependencies: file-type ^21.3.4`（需 Node≥20，与本仓≥22.19 兼容），否则仅 `stream` 兜底无需。

---

## 7. 可复用代码片段

### 7.1 最小上传

```js
import * as lark from "@larksuiteoapi/node-sdk";
const client = new lark.Client({ appId, appSecret });

const imgRes = await client.im.v1.image.create({ data: { image_type: "message", image: buffer } });
const imageKey = imgRes?.image_key ?? imgRes?.data?.image_key;

const fileRes = await client.im.v1.file.create({ data: { file_type: "stream", file_name: "report.pdf", file: buffer } });
const fileKey = fileRes?.file_key ?? fileRes?.data?.file_key;
```

### 7.2 宿主封装

```js
export async function uploadImage(client, buffer) {
  try {
    const r = await client.im.v1.image.create({ data: { image_type: "message", image: buffer } });
    const key = r?.image_key ?? r?.data?.image_key;
    if (!key) throw new Error("image_key missing");
    return { kind: "image", fileKey: key };
  } catch (e) {
    throw new LarkChannelError("upload_failed", "image upload failed", { cause: e });
  }
}

export async function uploadFile(client, buffer, { fileType="stream", fileName, durationMs }={}) {
  if (!fileName) throw new TypeError("fileName required");
  try {
    const data = { file_type: fileType, file_name: fileName, file: buffer };
    if (durationMs != null) data.duration = durationMs;
    const r = await client.im.v1.file.create({ data });
    const key = r?.file_key ?? r?.data?.file_key;
    if (!key) throw new Error("file_key missing");
    const kind = fileType==="opus"?"audio":fileType==="mp4"?"video":"file";
    return { kind, fileKey: key, durationMs };
  } catch (e) {
    if (e instanceof LarkChannelError) throw e;
    throw new LarkChannelError("upload_failed", "file upload failed", { cause: e });
  }
}
```

### 7.3 file-type 自动分流

```js
import { fileTypeFromBuffer } from "file-type";
const MIME_TO_FILE_TYPE = {
  "application/pdf":"pdf",
  "application/msword":"doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":"doc",
  "application/vnd.ms-excel":"xls",
  "video/mp4":"mp4",
  "audio/opus":"opus",
};
export async function uploadBufferAuto(client, buffer, fallbackName="file.bin") {
  const sniff = await fileTypeFromBuffer(buffer);
  const mime = sniff?.mime ?? "";
  if (mime.startsWith("image/")) return uploadImage(client, buffer);
  const fileType = MIME_TO_FILE_TYPE[mime] ?? "stream";
  const ext = sniff?.ext ? `.${sniff.ext}` : "";
  const fileName = fallbackName.includes(".") ? fallbackName : `file${ext||".bin"}`;
  return uploadFile(client, buffer, { fileType, fileName });
}
```

### 7.4 发送消息收尾

```js
await client.im.v1.message.create({
  params: { receive_id_type: "chat_id" },
  data: { receive_id: chatId, msg_type: "image", content: JSON.stringify({ image_key: imageKey }) },
});
await client.im.v1.message.create({
  params: { receive_id_type: "chat_id" },
  data: { receive_id: chatId, msg_type: "file", content: JSON.stringify({ file_key: fileKey }) },
});
```

---

## 8. 与 2b 衔接

- 沿用现有 `tenant_access_token`，无新增鉴权
- `file-type` 仅 `stream` 兜底可暂不加
- 高分辨率命中 234006/234039 时降级 `file.create(stream)` 以 `msg_type:file` 发送

## 9. 来源

- `lib/index.js:67383-67455,67623-67707,104293-104345`; `types/index.d.ts:266421-266463`
- [image/create.md](https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/reference/im-v1/image/create.md), [file/create.md](https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/reference/im-v1/file/create.md)
- `package.json`, `package-lock.json: file-type 21.3.4`, `CONTEXT.md:5`
