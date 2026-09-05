import { ImagePromptError } from '../shared/image-prompt.mjs';
import { t } from '../shared/i18n.mjs';

const FEISHU_MISSING_MESSAGE_SCOPE_CODE = 99991672;
const FEISHU_CARD_MESSAGE_CONTENT_TYPE = 'raw_card_content';
const FEISHU_ERROR_BODY_LIMIT = 64 * 1024;
const FEISHU_ERROR_BODY_TIMEOUT_MS = 1_000;
const FEISHU_CARD_TEXT_MAX_DEPTH = 12;
const FEISHU_CARD_TEXT_MAX_NODES = 1_000;
const FEISHU_CARD_UNAVAILABLE_TEXTS = new Set([
  '请升级至最新版本客户端，以查看内容',
]);
const FEISHU_IMAGE_PERMISSION_MESSAGE =
  '飞书机器人缺少图片读取权限 im:message:readonly（飞书显示为“获取单聊、群组消息”）。请私聊机器人执行 /repair 命令，或者在「IM机器人」设置页点击“补全权限”按钮并扫码。按飞书提示发布新版本、完成必要审批后，再重新发送图片。';

/** Managed-topic group key: one per Feishu topic auto-rooted at a message. */
export function managedGroupKey(chatId, rootMessageId) {
  if (!chatId) throw new Error('Feishu managed-topic key needs a chat_id');
  if (!rootMessageId) throw new Error('Feishu managed-topic key needs a root message id');
  return `group:${chatId}:managed:${rootMessageId}`;
}

/** Whether a key denotes a topic-isolated group conversation (thread or managed). */
export function isTopicGroupKey(key) {
  return typeof key === 'string' && key.startsWith('group:')
    && (key.includes(':thread:') || key.includes(':managed:'));
}

export function conversationKey(event) {
  const chatType = event?.message?.chat_type;
  if (chatType === 'p2p') {
    const senderId = event?.sender?.sender_id?.open_id || event?.sender?.sender_id?.user_id;
    if (!senderId) throw new Error('Feishu p2p event has no sender id');
    return `p2p:${senderId}`;
  }
  const chatId = event?.message?.chat_id;
  if (!chatId) throw new Error('Feishu group event has no chat id');
  // Topic groups: every message belongs to a thread, so key the session per
  // thread to keep each topic's Harness conversation isolated. Regular group
  // chats carry no thread_id and keep the single shared `group:<chat_id>` key.
  const threadId = event?.message?.thread_id;
  if (typeof threadId === 'string' && threadId.trim()) return `group:${chatId}:thread:${threadId}`;
  return `group:${chatId}`;
}

function parsedMessageContent(event) {
  const value = event?.message?.content;
  if (value && typeof value === 'object') return value;
  if (typeof value !== 'string') return null;
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === 'object') return parsed;
    // 双重序列化兜底：字符串内再套 JSON（移动端罕见）
    if (typeof parsed === 'string') {
      try {
        const inner = JSON.parse(parsed);
        return inner && typeof inner === 'object' ? inner : null;
      } catch {
        return null;
      }
    }
    return null;
  } catch {
    return null;
  }
}

function withoutMentions(text, event) {
  let result = typeof text === 'string' ? text : '';
  for (const mention of event?.message?.mentions ?? []) {
    if (typeof mention?.key === 'string' && mention.key) {
      result = result.replaceAll(mention.key, '');
    }
  }
  return result.trim();
}

export function extractText(event) {
  if (event?.message?.message_type !== 'text') return null;
  const parsed = parsedMessageContent(event);
  return parsed ? withoutMentions(parsed.text, event) : null;
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function objectRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function jsonRecord(value) {
  if (objectRecord(value)) return value;
  if (typeof value !== 'string') return null;
  try {
    return objectRecord(JSON.parse(value));
  } catch {
    return null;
  }
}

function interactiveCardRoot(parsed) {
  const root = objectRecord(parsed);
  if (!root) return null;
  // raw_card_content wraps CardKit entities in json_card. Keep direct Card
  // 1.0/2.0 payloads readable as well for historical messages and fixtures.
  return jsonRecord(root.json_card) ?? jsonRecord(root.card) ?? root;
}

function cardProperty(value) {
  const record = objectRecord(value);
  return objectRecord(record?.property) ?? record;
}

function cardTextContent(property) {
  const i18n = objectRecord(property?.i18nContent);
  const content = nonEmptyString(i18n?.zh_cn)
    ?? nonEmptyString(i18n?.en_us)
    ?? nonEmptyString(i18n?.ja_jp)
    ?? nonEmptyString(property?.content)
    ?? nonEmptyString(property?.text);
  return content && !FEISHU_CARD_UNAVAILABLE_TEXTS.has(content) ? content : null;
}

function cardElementText(
  element,
  { depth = 0, inline = false, budget = { remaining: FEISHU_CARD_TEXT_MAX_NODES } } = {},
) {
  if (depth > FEISHU_CARD_TEXT_MAX_DEPTH || budget.remaining <= 0) return '';
  budget.remaining -= 1;
  if (Array.isArray(element)) {
    return element
      .map((part) => cardElementText(part, {
        depth: depth + 1,
        inline: Array.isArray(part),
        budget,
      }))
      .filter(Boolean)
      .join(inline ? ' ' : '\n');
  }
  const value = objectRecord(element);
  if (!value) return '';
  const property = cardProperty(value);
  if (!property) return '';
  const tag = String(value.tag ?? '').toLowerCase();

  if (
    tag === 'markdown'
    || tag === 'markdown_v1'
    || tag === 'lark_md'
    || tag === 'plain_text'
    || tag === 'text'
  ) {
    const content = cardTextContent(property);
    if (content) return content;
    const nested = cardElementText(property.elements, {
      depth: depth + 1,
      inline: true,
      budget,
    });
    if (nested || tag !== 'markdown_v1') return nested;
    return cardElementText(value.fallback ?? property.fallback, {
      depth: depth + 1,
      inline: true,
      budget,
    });
  }
  if (tag === 'a' || tag === 'link' || tag === 'button') {
    if (typeof property.text === 'string') return nonEmptyString(property.text) ?? '';
    return cardElementText(property.text, { depth: depth + 1, inline: true, budget });
  }
  if (tag === 'div') {
    return [
      cardElementText(property.text, { depth: depth + 1, budget }),
      cardElementText(property.fields, { depth: depth + 1, budget }),
    ].filter(Boolean).join('\n');
  }

  // Traverse visible layout containers only. Deliberately ignore callback
  // values, form state, URLs, ids, template variables and other hidden data.
  return ['elements', 'columns', 'fields', 'children', 'actions']
    .map((key) => cardElementText(property[key], { depth: depth + 1, budget }))
    .filter(Boolean)
    .join('\n');
}

function interactiveCardText(parsed) {
  const card = interactiveCardRoot(parsed);
  if (!card) return '';
  const budget = { remaining: FEISHU_CARD_TEXT_MAX_NODES };
  const header = cardProperty(card.header);
  const title = [
    cardElementText(header?.title, { inline: true, budget }),
    cardElementText(header?.subtitle, { inline: true, budget }),
  ].filter(Boolean).join('\n') || nonEmptyString(card.title) || '';
  const body = cardProperty(card.body);
  const elements = Array.isArray(body?.elements)
    ? body.elements
    : Array.isArray(card.elements)
      ? card.elements
      : null;
  const content = cardElementText(elements, { budget });
  return [title, content].filter(Boolean).join('\n');
}

function postContent(event, parsed = parsedMessageContent(event)) {
  if (event?.message?.message_type !== 'post') return null;
  if (!parsed) return null;

  // 语言包裹解包：兼容 {zh_cn:{title,content}} / {en_us:{...}} 透传
  if (parsed && typeof parsed === 'object') {
    if (parsed.zh_cn && typeof parsed.zh_cn === 'object' && (Array.isArray(parsed.zh_cn.content) || Array.isArray(parsed.zh_cn.content_v2))) {
      parsed = parsed.zh_cn;
    } else if (parsed.en_us && typeof parsed.en_us === 'object' && (Array.isArray(parsed.en_us.content) || Array.isArray(parsed.en_us.content_v2))) {
      parsed = parsed.en_us;
    }
  }

  const lines = [];
  const title = nonEmptyString(withoutMentions(parsed.title, event));
  if (title) lines.push(title);
  const imageKeys = [];
  const contentBlocks = Array.isArray(parsed.content) ? parsed.content : [];
  const contentV2Blocks = Array.isArray(parsed.content_v2) ? parsed.content_v2 : [];

  const pushImageKey = (element) => {
    const rawKey = element?.image_key ?? element?.imageKey;
    const fileKey = element?.file_key ?? element?.fileKey;
    const key = nonEmptyString(rawKey ?? fileKey);
    if (!key) return;
    const type = fileKey && !rawKey ? 'file' : 'image';
    imageKeys.push({ key, type });
  };

  for (const paragraph of contentBlocks) {
    if (!Array.isArray(paragraph)) continue;
    let visibleText = '';
    for (const element of paragraph) {
      const tag = String(element?.tag ?? '').toLowerCase();
      if (tag === 'img') {
        pushImageKey(element);
      } else if (tag === 'media') {
        // 视频封面等，按图片处理
        pushImageKey(element);
      } else if (tag === 'text' || tag === 'a' || tag === 'link') {
        if (typeof element?.text === 'string') visibleText += element.text;
      }
    }
    const line = nonEmptyString(withoutMentions(visibleText, event));
    if (line) lines.push(line);
  }

  // content_v2 仅含 md 时的回退与 md 图片抽取（移动端专属）
  if (imageKeys.length === 0 && contentBlocks.length === 0 && contentV2Blocks.length > 0) {
    // 无 content 时直接以 content_v2 为主
    for (const paragraph of contentV2Blocks) {
      if (!Array.isArray(paragraph)) continue;
      for (const element of paragraph) {
        const tag = String(element?.tag ?? '').toLowerCase();
        if (tag === 'img' || tag === 'media') pushImageKey(element);
      }
    }
  }
  // 扫描 md 文本中的 ![alt](img_xxx) 与裸 img_xxx
  const mdImagePattern = /!\\[.*?\\]\\(\\s*(img_[a-zA-Z0-9_-]+)\\s*\\)/g;
  const bareImgPattern = /(?:^|[^a-zA-Z0-9_-])(img_[a-zA-Z0-9_-]+)(?:[^a-zA-Z0-9_-]|$)/g;
  const hasKey = (key) => imageKeys.some((e) => (typeof e === 'string' ? e : e.key) === key);
  const scanMdText = (text) => {
    if (typeof text !== 'string' || !text) return;
    let m;
    while ((m = mdImagePattern.exec(text)) !== null) {
      const key = nonEmptyString(m[1]);
      if (key && !hasKey(key)) imageKeys.push({ key, type: 'image' });
    }
    // 兼容 md 文本内直接出现裸 key 的罕见情况
    let n;
    while ((n = bareImgPattern.exec(text)) !== null) {
      const key = nonEmptyString(n[1]);
      if (key && !hasKey(key) && !text.includes(`![`)) {
        // 避免与 md 正则重复，仅在无 md 语法时补充
        imageKeys.push({ key, type: 'image' });
      }
    }
  };
  for (const paragraph of [...contentBlocks, ...contentV2Blocks]) {
    if (!Array.isArray(paragraph)) continue;
    for (const element of paragraph) {
      const tag = String(element?.tag ?? '').toLowerCase();
      if (tag === 'md' && typeof element?.text === 'string') {
        scanMdText(element.text);
      }
    }
  }

  return {
    text: lines.join('\n'),
    imageKeys,
  };
}

function headerValue(headers, name) {
  if (typeof headers?.get === 'function') return headers.get(name);
  return headers?.[name] ?? headers?.[name.toLowerCase()] ?? null;
}

function declaredSize(headers) {
  const header = headerValue(headers, 'content-length');
  if (header === null || header === undefined || header === '') return null;
  const value = Number(header);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

async function readBoundedStream(stream, { signal, maxBytes }) {
  if (!stream || typeof stream[Symbol.asyncIterator] !== 'function') {
    throw new Error('Feishu image download returned no readable stream');
  }
  signal?.throwIfAborted();
  const abort = () => stream.destroy?.(
    signal.reason ?? new DOMException('Feishu image download aborted', 'AbortError'),
  );
  signal?.addEventListener('abort', abort, { once: true });
  const chunks = [];
  let size = 0;
  try {
    for await (const chunk of stream) {
      signal?.throwIfAborted();
      const data = Buffer.from(chunk);
      size += data.length;
      if (size > maxBytes) {
        stream.destroy?.();
        throw new ImagePromptError(
          'image-too-large',
          `Feishu image exceeds ${maxBytes} bytes`,
          t('图片超过 5 MB，请压缩后重试。'),
        );
      }
      chunks.push(data);
    }
    signal?.throwIfAborted();
    return Buffer.concat(chunks, size);
  } finally {
    signal?.removeEventListener('abort', abort);
  }
}

async function readStream(stream, { signal }) {
  if (!stream || typeof stream[Symbol.asyncIterator] !== 'function') {
    throw new Error('Feishu file download returned no readable stream');
  }
  signal?.throwIfAborted();
  const abort = () => stream.destroy?.(
    signal.reason ?? new DOMException('Feishu file download aborted', 'AbortError'),
  );
  signal?.addEventListener('abort', abort, { once: true });
  const chunks = [];
  let size = 0;
  try {
    for await (const chunk of stream) {
      signal?.throwIfAborted();
      const data = Buffer.from(chunk);
      size += data.length;
      chunks.push(data);
    }
    signal?.throwIfAborted();
    return Buffer.concat(chunks, size);
  } finally {
    signal?.removeEventListener('abort', abort);
  }
}

function providerCode(value) {
  if (!value || typeof value !== 'object') return null;
  const code = value.code ?? value.error?.code;
  return Number.isSafeInteger(Number(code)) ? Number(code) : null;
}

function tryParseProviderCode(raw) {
  if (Buffer.isBuffer(raw) || raw instanceof Uint8Array) raw = Buffer.from(raw).toString('utf8');
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    try {
      return providerCode(JSON.parse(trimmed));
    } catch {
      return null;
    }
  }
  return null;
}

async function readFeishuErrorBody(stream, signal) {
  if (!stream || typeof stream[Symbol.asyncIterator] !== 'function') return null;
  signal?.throwIfAborted();
  const timeout = AbortSignal.timeout(FEISHU_ERROR_BODY_TIMEOUT_MS);
  const readSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const abort = () => stream.destroy?.(readSignal.reason);
  readSignal.addEventListener('abort', abort, { once: true });
  const chunks = [];
  let size = 0;
  try {
    for await (const chunk of stream) {
      const data = Buffer.from(chunk);
      size += data.length;
      if (size > FEISHU_ERROR_BODY_LIMIT) {
        stream.destroy?.();
        return null;
      }
      chunks.push(data);
    }
    return Buffer.concat(chunks, size).toString('utf8');
  } catch {
    signal?.throwIfAborted();
    return null;
  } finally {
    readSignal.removeEventListener('abort', abort);
  }
}

async function feishuProviderCode(error, signal) {
  const pending = [error];
  const seen = new Set();
  while (pending.length > 0 && seen.size < 8) {
    const value = pending.shift();
    if (!value || (typeof value !== 'object' && typeof value !== 'function') || seen.has(value)) {
      continue;
    }
    seen.add(value);
    const directCode = providerCode(value);
    const data = value.response?.data ?? value.data;
    if (directCode === FEISHU_MISSING_MESSAGE_SCOPE_CODE) {
      data?.destroy?.();
      return directCode;
    }
    if (data && typeof data[Symbol.asyncIterator] === 'function') {
      const body = await readFeishuErrorBody(data, signal);
      if (body) {
        try {
          const parsedCode = providerCode(JSON.parse(body));
          if (parsedCode === FEISHU_MISSING_MESSAGE_SCOPE_CODE) return parsedCode;
        } catch {
          // Non-JSON provider failures keep the generic image download message.
        }
        const fallback = tryParseProviderCode(body);
        if (fallback === FEISHU_MISSING_MESSAGE_SCOPE_CODE) return fallback;
      } else {
        // 超时/超限回退到直接 code 判定，避免漏判
        const directFallback = providerCode(value);
        if (directFallback === FEISHU_MISSING_MESSAGE_SCOPE_CODE) return directFallback;
      }
    } else {
      const dataCode = providerCode(data);
      if (dataCode === FEISHU_MISSING_MESSAGE_SCOPE_CODE) return dataCode;
      const parsed = tryParseProviderCode(data);
      if (parsed === FEISHU_MISSING_MESSAGE_SCOPE_CODE) return parsed;
    }
    pending.push(value.cause);
  }
  return null;
}

async function feishuImageDownloadError(error, signal) {
  if (await feishuProviderCode(error, signal) !== FEISHU_MISSING_MESSAGE_SCOPE_CODE) return error;
  return new ImagePromptError(
    'feishu-image-permission-required',
    'Feishu image download requires the im:message:readonly tenant scope',
    t(FEISHU_IMAGE_PERMISSION_MESSAGE),
    { cause: error },
  );
}

function feishuImageSource(event, client, keyOrObj) {
  const entry = typeof keyOrObj === 'string' ? { key: keyOrObj, type: 'image' } : keyOrObj;
  const key = nonEmptyString(entry?.key);
  const resourceType = entry?.type === 'file' ? 'file' : 'image';
  return {
    async load({ signal, maxBytes }) {
      signal?.throwIfAborted();
      if (!key) throw new Error('Feishu image source has no key');
      let resource;
      try {
        resource = await client?.im?.v1?.messageResource?.get?.({
          path: {
            message_id: event.message.message_id,
            file_key: key,
          },
          params: { type: resourceType },
        });
      } catch (error) {
        throw await feishuImageDownloadError(error, signal);
      }
      signal?.throwIfAborted();
      const size = declaredSize(resource?.headers);
      if (size !== null && size > maxBytes) {
        resource?.getReadableStream?.().destroy?.();
        throw new ImagePromptError(
          'image-too-large',
          `Feishu image declares ${size} bytes; the limit is ${maxBytes}`,
          t('图片超过 5 MB，请压缩后重试。'),
        );
      }
      return readBoundedStream(resource?.getReadableStream?.(), { signal, maxBytes });
    },
  };
}

function feishuFileSource(event, client, file) {
  const key = nonEmptyString(file?.file_key);
  if (!key) return null;
  return {
    name: nonEmptyString(file?.file_name) ?? 'file',
    async load({ signal } = {}) {
      signal?.throwIfAborted();
      const resource = await client?.im?.v1?.messageResource?.get?.({
        path: {
          message_id: event.message.message_id,
          file_key: key,
        },
        params: { type: 'file' },
      });
      signal?.throwIfAborted();
      return readStream(resource?.getReadableStream?.(), { signal });
    },
  };
}

function feishuReplyTargetId(event) {
  const parentId = nonEmptyString(event?.message?.parent_id);
  if (parentId) return parentId;
  const rootId = nonEmptyString(event?.message?.root_id);
  const messageId = nonEmptyString(event?.message?.message_id);
  return rootId && rootId !== messageId ? rootId : null;
}

function feishuReplyAttachments(messageType, parsed, post) {
  if (messageType === 'post') {
    return (post?.imageKeys ?? []).map(() => ({ kind: 'image' }));
  }
  if (messageType === 'image') return [{ kind: 'image' }];
  if (messageType === 'file') {
    return [{
      kind: 'file',
      ...(nonEmptyString(parsed?.file_name) ? { name: nonEmptyString(parsed.file_name) } : {}),
    }];
  }
  if (messageType === 'audio') return [{ kind: 'audio' }];
  if (messageType === 'media') {
    return [{
      kind: 'video',
      ...(nonEmptyString(parsed?.file_name) ? { name: nonEmptyString(parsed.file_name) } : {}),
    }];
  }
  if (messageType === 'sticker') return [{ kind: 'other' }];
  return [];
}

function feishuReplyReference(event, client) {
  const messageId = feishuReplyTargetId(event);
  if (!messageId) return null;
  const chatId = nonEmptyString(event?.message?.chat_id);
  return {
    messageId,
    async load({ signal } = {}) {
      signal?.throwIfAborted();
      let response;
      try {
        response = await client?.im?.v1?.message?.get?.({
          path: { message_id: messageId },
          params: {
            with_sender_name: true,
            card_msg_content_type: FEISHU_CARD_MESSAGE_CONTENT_TYPE,
          },
        });
      } catch (error) {
        signal?.throwIfAborted();
        if (await feishuProviderCode(error, signal) === FEISHU_MISSING_MESSAGE_SCOPE_CODE) {
          return { messageId, unavailableReason: 'permission-denied' };
        }
        throw error;
      }
      signal?.throwIfAborted();
      if (providerCode(response) === FEISHU_MISSING_MESSAGE_SCOPE_CODE) {
        return { messageId, unavailableReason: 'permission-denied' };
      }
      if (providerCode(response) !== null && providerCode(response) !== 0) {
        return { messageId, unavailableReason: 'not-delivered' };
      }
      const item = response?.data?.items?.find?.(
        (candidate) => nonEmptyString(candidate?.message_id) === messageId,
      );
      if (!item) return { messageId, unavailableReason: 'not-found' };
      if (item.deleted) return { messageId, unavailableReason: 'deleted' };
      const itemChatId = nonEmptyString(item.chat_id);
      if (!chatId || !itemChatId || itemChatId !== chatId) {
        return { messageId, unavailableReason: 'not-found' };
      }

      const messageType = nonEmptyString(item.msg_type) ?? '';
      const quotedEvent = {
        message: {
          message_id: messageId,
          message_type: messageType,
          content: item.body?.content,
          mentions: item.mentions ?? [],
        },
      };
      const parsed = parsedMessageContent(quotedEvent);
      const post = postContent(quotedEvent, parsed);
      const quoted = extractInboundMessage(quotedEvent, client);
      const content = messageType === 'interactive'
        ? interactiveCardText(parsed)
        : quoted.content;
      const attachments = feishuReplyAttachments(messageType, parsed, post);
      return {
        messageId,
        ...(nonEmptyString(item.sender?.id) ? { authorId: nonEmptyString(item.sender.id) } : {}),
        ...(nonEmptyString(item.sender?.sender_name)
          ? { authorName: nonEmptyString(item.sender.sender_name) }
          : {}),
        ...(content ? { content } : {}),
        attachments,
        ...(messageType === 'interactive' && !content && attachments.length === 0
          ? { unavailableReason: 'unsupported' }
          : {}),
      };
    },
  };
}

export function extractInboundMessage(event, client) {
  const messageType = event?.message?.message_type;
  const parsed = parsedMessageContent(event);
  const post = postContent(event, parsed);
  let standalone = null;
  if (messageType === 'image' || messageType === 'file' || messageType === 'media') {
    const imageKey = nonEmptyString(parsed?.image_key ?? parsed?.imageKey);
    const fileKey = nonEmptyString(parsed?.file_key ?? parsed?.fileKey);
    if (imageKey) standalone = { key: imageKey, type: 'image' };
    else if (fileKey) standalone = { key: fileKey, type: 'file', fileName: parsed?.file_name ?? parsed?.fileName };
    else if (messageType === 'media' && post?.imageKeys?.length) {
      // media 封面可能在 post 中，退化为 post
      standalone = null;
    }
  }
  const imageKeys = standalone ? [standalone] : post?.imageKeys ?? [];
  // 兼容旧 string[] 与新 {key,type}[] 混合
  const normalizedKeys = imageKeys.map((e) => (typeof e === 'string' ? { key: e, type: 'image' } : e));
  const isImageFileName = (name) => typeof name === 'string' && /\.(jpe?g|png|gif|webp|bmp|heic|heif|tiff?|svg)$/i.test(name.trim());
  let images;
  let files;
  if (messageType === 'file' && standalone?.type === 'file') {
    const fileName = standalone.fileName ?? parsed?.file_name ?? parsed?.fileName;
    if (isImageFileName(fileName)) {
      images = normalizedKeys.filter((e) => nonEmptyString(e.key)).map((entry) => feishuImageSource(event, client, entry));
      files = [];
    } else {
      images = [];
      const f = feishuFileSource(event, client, parsed);
      files = f ? [f] : [];
    }
  } else {
    images = normalizedKeys.filter((e) => nonEmptyString(e.key)).map((entry) => feishuImageSource(event, client, entry));
    const f = messageType === 'file' ? feishuFileSource(event, client, parsed) : null;
    files = f ? [f] : [];
  }
  // Upstream (v4.3+): quote-reply reference rides on the parsed message.
  const replyTo = feishuReplyReference(event, client);
  return {
    content: messageType === 'text' ? extractText(event) ?? '' : post?.text ?? '',
    images,
    files,
    ...(replyTo ? { replyTo } : {}),
  };
}

export function splitText(text, maxChars = 9000) {
  if (text.length <= maxChars) return [text];
  const chunks = [];
  let remaining = text;
  while (remaining.length > maxChars) {
    let splitAt = remaining.lastIndexOf('\n', maxChars);
    if (splitAt < Math.floor(maxChars * 0.6)) splitAt = maxChars;
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).replace(/^\n+/, '');
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

export function isBotSender(event) {
  return event?.sender?.sender_type === 'bot';
}

export function isAllowedSender(event, allowedOpenIds) {
  if (!allowedOpenIds || allowedOpenIds.size === 0) return false;
  if (allowedOpenIds.has('*')) return true;
  const senderOpenId = event?.sender?.sender_id?.open_id;
  return typeof senderOpenId === 'string' && allowedOpenIds.has(senderOpenId);
}
