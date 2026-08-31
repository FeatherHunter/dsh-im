# Prototype #9：路径即附件的解析与多附件消息时序

> Wayfinder #9 / Map #1 — 在 `private/custom` 上验证，不改主分支业务代码。
> 依赖：`#8 docs/research/08-feishu-file-upload.md` 的 SDK 路径与权限清单。

## 1. 解析契约

### 触发语法（按优先级）

1. `[[file:/abs/path]]` 显式语法 — 最明确，整段提取 `group1`。
2. `![alt](/abs/path)` markdown 图片 — 提取 `href`。
3. 裸 `workspace` 绝对路径 — 满足 `/workspace/` 或 `/data/workspace/` 前缀且以常见文件后缀结尾，或无后缀但文件存在。

### 正则（草稿）

```js
const EXPLICIT_RE = /\[\[file:\s*([^\]]+)\]\]/g;
const MD_IMAGE_RE = /!\[[^\]]*\]\(\s*([^\s)]+)\s*\)/g;
const BARE_PATH_RE = /(?<![A-Za-z0-9_\/])\/(?:data\/workspace|workspace)\/[^\s"'`\]\)]+/g;
```

- `BARE_PATH_RE` 需二次校验：`path.isAbsolute && fileExists && isSubPath(workspaceRoot, absPath)`，拒绝 `../` 越界。
- 后缀白名单初版：`png|jpg|jpeg|webp|gif|pdf|html|txt|md|json|csv|xls|xlsx|doc|docx|ppt|pptx|zip`，不在白名单仍可发（`file_type: stream`），仅 `image/*` 走 `image.create`。

### 校验流水

```js
function isSubPath(root, target) {
  const rel = path.relative(root, target);
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}
for (const raw of candidates) {
  const abs = path.resolve(raw); // 已是绝对路径则不变
  if (!isSubPath(workspaceRoot, abs)) continue; // 越界
  const stat = await fs.stat(abs).catch(()=>null);
  if (!stat?.isFile()) continue;
  if (stat.size > 5*1024*1024) continue; // 单文件
  // 累计 20MB / 20个 在外层计数
  attachments.push({ absPath: abs, name: path.basename(abs), size: stat.size });
  if (attachments.length >= 20 || totalBytes > 20*1024*1024) break;
}
```

## 2. 与文本的分工

- `cleanedText`：原文移除显式 `[[file:...]]` 标记（保留其余文本），供 `splitText(9000)` 分片发送。
- `attachments`：按在原文中出现顺序排序，**不在 `cleanedText` 中重复描述路径**，避免用户看到两遍。

## 3. 消息时序

### 非流式（`bridge#send` 回退）

```
for (chunk of splitText(cleanedText)) await client.im.v1.message.create({msg_type:'text', ...});
for (att of attachments) {
  const key = isImage(att) 
    ? (await client.im.v1.image.create({data:{image: fs.createReadStream(att.absPath), image_type:'message'}})).data.image_key
    : (await client.im.v1.file.create({data:{file: fs.createReadStream(att.absPath), file_name: att.name, file_type:'stream'}})).data.file_key;
  const msgType = isImage(att) ? 'image' : 'file';
  const content = isImage(att) ? {image_key: key} : {file_key: key};
  await client.im.v1.message.create({params:{receive_id_type:'chat_id'}, data:{receive_id:chatId, msg_type:msgType, content:JSON.stringify(content)}});
}
```

### 流式（`VerifiedFeishuChannel#stream`）

```
await channel.stream(chatId, {markdown: async (controller)=>{...}}, {replyTo});
 // stream 结束（card.settings streaming_mode:false）后
for (att of attachments) await uploadAndSend(...) // 同上，紧跟文本后
```

- 若 `upload` 失败：记录 `status.lastError`，不回滚已发文本，单条附件可重试。
- 若 `replyTo` 存在：首条文本用 `message.reply`，后续附件仍用 `message.create`（飞书 `reply` 仅首条需要）。

## 4. 边界用例（8 个）

1. `../` 越界：`/workspace/../../etc/passwd` → 拒绝
2. 超限：`6MB.png` → 拒绝，`cleanedText` 保留提示“文件过大已忽略”
3. 不存在：`/workspace/missing.html` → 忽略
4. `http://...` 误命中：不匹配 `BARE_PATH_RE`（必须 `/workspace` 前缀）
5. ` ```html ``` ` 代码块内路径：正则仍会命中，但二次 `stat` 不存在则忽略（符合“仅路径”约束）
6. 多附件：3 图 +1 html 按出现顺序 4 条消息
7. markdown 图片 `![a](/workspace/x.png)` 同时被 `MD_IMAGE_RE` 与 `BARE_PATH_RE` 命中 → 去重
8. `[[file:/workspace/a.pdf]]` 显式语法优先级最高，`cleanedText` 中移除标记

## 5. 下一步（供 #10 实现复用）

- 抽 `src/channels/feishu/attachment-parser.mjs`（`extractAttachments`）与 `channel.sendImage/sendFile` 封装，`bridge` 仅编排。
- `file-type` 探测：`await fileTypeFromFile(absPath)` 决定 `isImage`，未显式依赖则 fallback 后缀。
