import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { extractAttachments, isImageAttachment, MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS } from '../../../src/channels/feishu/attachment-parser.mjs';

const WORKSPACE = '/workspace';
const OTHER_ROOT = '/other';

function statOk(size = 1024) {
  return async () => ({ isFile: () => true, size });
}
function statMissing() {
  return async () => { throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); };
}
function makeStat(map) {
  return async (p) => {
    const v = map.get(path.posix.normalize(p));
    if (v === undefined) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    if (v === null) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    return { isFile: () => true, size: v };
  };
}

test('extractAttachments: explicit [[file:]] syntax', async () => {
  const answer = '结果见 [[file:/workspace/report.html]] 和 [[file:/workspace/notes.txt]]';
  const m = new Map([
    [path.posix.normalize('/workspace/report.html'), 100],
    [path.posix.normalize('/workspace/notes.txt'), 200],
  ]);
  const { attachments, cleanedText } = await extractAttachments(answer, { allowedRoots: [WORKSPACE], statImpl: makeStat(m) });
  assert.equal(attachments.length, 2);
  assert.equal(attachments[0].absPath, path.posix.normalize('/workspace/report.html'));
  assert.equal(attachments[1].name, 'notes.txt');
  assert(!cleanedText.includes('[[file:'));
});

test('extractAttachments: markdown image syntax', async () => {
  const answer = '看图 ![a](/workspace/img.png) 文本';
  const m = new Map([[path.posix.normalize('/workspace/img.png'), 500]]);
  const { attachments } = await extractAttachments(answer, { allowedRoots: [WORKSPACE], statImpl: makeStat(m) });
  assert.equal(attachments.length, 1);
  assert.equal(attachments[0].name, 'img.png');
});

test('extractAttachments: bare workspace path', async () => {
  const answer = '文件在 /workspace/data/report.pdf 请查收';
  const m = new Map([[path.posix.normalize('/workspace/data/report.pdf'), 1000]]);
  const { attachments } = await extractAttachments(answer, { allowedRoots: [WORKSPACE], statImpl: makeStat(m) });
  assert.equal(attachments.length, 1);
  assert.equal(attachments[0].absPath, path.posix.normalize('/workspace/data/report.pdf'));
});

test('extractAttachments: rejects path outside allowedRoots', async () => {
  const answer = '恶意 [[file:/etc/passwd]] 和 /other/secret.txt';
  const { attachments } = await extractAttachments(answer, { allowedRoots: [WORKSPACE], statImpl: statOk() });
  assert.equal(attachments.length, 0);
});

test('extractAttachments: rejects ../ traversal', async () => {
  const answer = '[[file:/workspace/../etc/passwd]]';
  const { attachments } = await extractAttachments(answer, { allowedRoots: [WORKSPACE], statImpl: statOk() });
  assert.equal(attachments.length, 0);
});

test('extractAttachments: deduplicates same path', async () => {
  const answer = '[[file:/workspace/a.txt]] 和 /workspace/a.txt';
  const m = new Map([[path.posix.normalize('/workspace/a.txt'), 100]]);
  const { attachments } = await extractAttachments(answer, { allowedRoots: [WORKSPACE], statImpl: makeStat(m) });
  assert.equal(attachments.length, 1);
});

test('extractAttachments: respects 5MB single-file limit', async () => {
  const answer = '[[file:/workspace/big.bin]]';
  const m = new Map([[path.posix.normalize('/workspace/big.bin'), MAX_ATTACHMENT_BYTES + 1]]);
  const { attachments } = await extractAttachments(answer, { allowedRoots: [WORKSPACE], statImpl: makeStat(m) });
  assert.equal(attachments.length, 0);
});

test('extractAttachments: respects 20MB total and 20 files limit', async () => {
  const parts = [];
  const m = new Map();
  for (let i = 0; i < 25; i++) {
    const p = `/workspace/file${i}.txt`;
    parts.push(`[[file:${p}]]`);
    m.set(path.posix.normalize(p), 1024 * 1024); // 1MB each
  }
  const answer = parts.join(' ');
  const { attachments } = await extractAttachments(answer, { allowedRoots: [WORKSPACE], statImpl: makeStat(m) });
  assert.equal(attachments.length, MAX_ATTACHMENTS);
  const total = attachments.reduce((s, a) => s + a.size, 0);
  assert(total <= 20 * 1024 * 1024);
});

test('extractAttachments: ignores missing files', async () => {
  const answer = '[[file:/workspace/missing.txt]]';
  const { attachments } = await extractAttachments(answer, { allowedRoots: [WORKSPACE], statImpl: statMissing() });
  assert.equal(attachments.length, 0);
});

test('extractAttachments: handles data/workspace prefix', async () => {
  const answer = '[[file:/data/workspace/report.html]]';
  const root = '/data/workspace';
  const m = new Map([[path.posix.normalize('/data/workspace/report.html'), 100]]);
  const { attachments } = await extractAttachments(answer, { allowedRoots: [root], statImpl: makeStat(m) });
  assert.equal(attachments.length, 1);
});

test('isImageAttachment: detects by extension', () => {
  assert.equal(isImageAttachment({ name: 'a.png' }), true);
  assert.equal(isImageAttachment({ name: 'b.JPG' }), true);
  assert.equal(isImageAttachment({ name: 'c.html' }), false);
  assert.equal(isImageAttachment({ name: 'd.pdf' }, 'image/png'), true);
  assert.equal(isImageAttachment({ name: 'e.txt' }, 'text/plain'), false);
});

test('extractAttachments: respects multiple allowedRoots', async () => {
  const answer = '[[file:/workspace/a.txt]] [[file:/other/b.txt]]';
  const m = new Map([
    [path.posix.normalize('/workspace/a.txt'), 100],
    [path.posix.normalize('/other/b.txt'), 100],
  ]);
  const { attachments } = await extractAttachments(answer, { allowedRoots: [WORKSPACE, OTHER_ROOT], statImpl: makeStat(m) });
  assert.equal(attachments.length, 2);
});
