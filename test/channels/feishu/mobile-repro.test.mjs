import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { FeishuHarnessBridge } from '../../../src/channels/feishu/bridge.mjs';
import { extractInboundMessage } from '../../../src/channels/feishu/message-utils.mjs';

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

function stateFixture(initialSessions = []) {
  const sessions = new Map(initialSessions);
  const seen = new Set();
  return {
    sessions,
    seen,
    state: {
      hasSeen: (id) => seen.has(id),
      markSeen: async (id) => seen.add(id),
      sessionFor: (key) => sessions.get(key) ?? null,
      setSession: async (key, sessionId) => sessions.set(key, sessionId),
      clearSession: async (key) => sessions.delete(key),
    },
  };
}

function bridgeStatus() {
  return {
    messagesReceived: 0,
    messagesReplied: 0,
    messagesRejected: 0,
    lastMessageAt: null,
    lastReplyAt: null,
    lastRejectedAt: null,
    lastError: null,
  };
}

function event(messageId, text, overrides = {}) {
  // 兼容 2 参（event(id, overrides)）与 3 参（event(id, text, overrides)）
  if (typeof text === 'object' && text !== null && overrides && typeof overrides === 'object' && Object.keys(overrides).length === 0) {
    // 2 参形式
    overrides = text;
    text = 'hi';
  }
  if (text && typeof text === 'object' && !overrides) {
    overrides = text;
    text = 'hi';
  }
  if (typeof text !== 'string') text = 'hi';
  const { senderOpenId = 'ou_user', ...messageOverrides } = overrides || {};
  return {
    sender: { sender_type: 'user', sender_id: { open_id: senderOpenId } },
    message: {
      message_id: messageId,
      message_type: 'text',
      chat_type: 'p2p',
      chat_id: 'oc_chat',
      content: JSON.stringify({ text }),
      ...messageOverrides,
    },
  };
}

function textClient(sendText) {
  let sequence = 0;
  return {
    im: { v1: { message: { create: async (request) => {
      const outgoing = {
        chatId: request.data.receive_id,
        text: JSON.parse(request.data.content).text,
      };
      await sendText(outgoing);
      sequence += 1;
      return { code: 0, data: { message_id: `om_test_${sequence}` } };
    } } } },
  };
}

// 捕获诊断日志的 logger
function captureLogger(captured) {
  return {
    debug: (...args) => captured.push(['debug', ...args]),
    info: (...args) => captured.push(['info', ...args]),
    warn: (...args) => captured.push(['warn', ...args]),
    error: (...args) => captured.push(['error', ...args]),
  };
}

// 1. 移动端 message_type=file 携带 file_key（相册原图/文件式发图）— 已修复
test('mobile repro: file_key 单图当前走空（待修复）', async () => {
  const direct = extractInboundMessage({
    message: {
      message_id: 'om_file',
      message_type: 'file',
      content: JSON.stringify({ file_key: 'file_mobile_img', file_name: 'IMG_1234.jpg' }),
    },
  }, {});
  // 修复后应识别为 1 张图（type=file）
  assert.equal(direct.images.length, 1, 'fixed: file type yields 1 image');
  assert.equal(direct.content, '', 'file type yields empty text content');
});

// 2. content 为对象而非字符串（SDK 预解析透传）
test('mobile repro: content 为对象时可解析', () => {
  const direct = extractInboundMessage({
    message: {
      message_id: 'om_obj',
      message_type: 'image',
      content: { image_key: 'img_obj' },
    },
  }, {});
  assert.equal(direct.images.length, 1, 'object content should yield 1 image (already compatible)');
});

// 3. post 内多图含空 image_key
test('mobile repro: post 多图含空 key 过滤', () => {
  const direct = extractInboundMessage({
    message: {
      message_id: 'om_post_empty',
      message_type: 'post',
      content: JSON.stringify({
        title: '',
        content: [
          [{ tag: 'img', image_key: 'img_first' }],
          [{ tag: 'img', image_key: '  ' }],
          [{ tag: 'img', image_key: 'img_third' }],
        ],
      }),
    },
  }, {});
  assert.equal(direct.images.length, 2, 'empty image_key should be filtered');
});

// 4. post 内 img 用 file_key（移动端变体）— 已修复
test('mobile repro: post img.file_key 当前走空（待修复）', () => {
  const direct = extractInboundMessage({
    message: {
      message_id: 'om_post_filekey',
      message_type: 'post',
      content: JSON.stringify({
        title: 'file_key variant',
        content: [[{ tag: 'img', file_key: 'file_in_post' }]],
      }),
    },
  }, {});
  assert.equal(direct.images.length, 1, 'fixed: img.file_key yields 1 image');
});

// 5. Bridge 诊断日志打点
test('mobile repro: bridge accept 打印 inbound/extracted 诊断日志', async () => {
  const fixture = stateFixture([['p2p:ou_user', 'sess_debug']]);
  const captured = [];
  const sent = [];
  const bridge = new FeishuHarnessBridge({
    client: textClient(async ({ text }) => sent.push(text)),
    channel: {},
    harness: { sessionExists: async () => true, ask: async () => 'ok' },
    state: fixture.state,
    status: bridgeStatus(),
    allowedSenderOpenIds: new Set(['ou_user']),
    logger: captureLogger(captured),
  });

  await bridge.accept(event('om_debug', 'hello', {
    message_type: 'text',
    content: JSON.stringify({ text: 'hello' }),
  }));
  await bridge.waitForIdle();

  const hasInboundLog = captured.some(([level, msg]) => level === 'debug' && String(msg).includes('inbound'));
  const hasExtractedLog = captured.some(([level, msg]) => level === 'debug' && String(msg).includes('extracted'));
  assert.equal(hasInboundLog, true, 'should log inbound');
  assert.equal(hasExtractedLog, true, 'should log extracted');
});

// 6. Bridge 对 file 类型已修复（应走图片分支）
test('mobile repro: bridge 对 file 图片当前判不支持（待修复）', async () => {
  const fixture = stateFixture([['p2p:ou_user', 'sess_file']]);
  const sent = [];
  const asked = [];
  const client = {
    im: { v1: {
      messageResource: { get: async () => ({
        headers: { 'content-length': String(PNG_1X1.length) },
        getReadableStream: () => Readable.from([PNG_1X1]),
      }) },
      message: { create: async (req) => {
        sent.push(JSON.parse(req.data.content).text);
        return { code: 0, data: { message_id: 'om_reply' } };
      } },
    } },
  };
  const bridge = new FeishuHarnessBridge({
    client,
    channel: {},
    harness: {
      sessionExists: async () => true,
      ask: async (sessionId, content) => {
        asked.push({ sessionId, content });
        return '收到文件图';
      },
    },
    state: fixture.state,
    status: bridgeStatus(),
    allowedSenderOpenIds: new Set(['ou_user']),
    logger: { debug() {}, info() {}, warn() {}, error() {} },
  });

  await bridge.accept(event('om_file_bridge', '', {
    message_type: 'file',
    content: JSON.stringify({ file_key: 'file_for_bridge', file_name: 'a.jpg' }),
    chat_type: 'p2p',
    chat_id: 'oc_chat',
  }));
  await bridge.waitForIdle();

  assert.equal(asked.length, 1, 'fixed: file type should trigger harness ask');
  assert.deepEqual(sent, ['收到文件图'], 'fixed: file type yields image reply');
});
