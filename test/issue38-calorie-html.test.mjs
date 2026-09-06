import assert from 'node:assert/strict';
import test from 'node:test';

import {
  extractAttachments,
  extractMediaAttachments,
} from '../src/channels/feishu/attachment-parser.mjs';
import {
  OUTBOUND_ARTIFACT_TOOL,
  OutboundArtifactRegistry,
  installOutboundArtifactTool,
} from '../src/channels/shared/semantic/artifact.mjs';

// Issue #38, R1: the old convention rules. Only files the model explicitly
// declares (tool call, [[file:]], markdown image, <media>, bare path) are
// delivered. Files mentioned nowhere are never auto-sent.

test('issue38: return-file prompt covers skill products and the current channel', () => {
  let section;
  const installed = installOutboundArtifactTool({
    tools: { register() {} },
    on() {},
    systemPrompt: { section(value) { section = value; } },
  }, { registry: new OutboundArtifactRegistry() });
  assert.equal(installed, true);
  assert.match(section.text, /skill just generated/);
  assert.match(section.text, /dsh_im_source/);
  assert.match(section.text, /Existing files can be sent directly/);
  assert.match(section.text, new RegExp(OUTBOUND_ARTIFACT_TOOL));
});

test('issue38: shared prompt stays channel-agnostic (no feishu-only tags)', () => {
  let section;
  installOutboundArtifactTool({
    tools: { register() {} },
    on() {},
    systemPrompt: { section(value) { section = value; } },
  }, { registry: new OutboundArtifactRegistry() });
  assert.doesNotMatch(section.text, /<media/);
  assert.doesNotMatch(section.text, /feishu/i);
});

test('issue38: pathless skill answer yields zero attachments (old rule)', async () => {
  const answer = '卡路里报告已生成，请查看。';
  const statOk = async () => ({ isFile: () => true, size: 1024 });
  const { attachments } = await extractAttachments(answer, {
    allowedRoots: ['/workspace'],
    statImpl: statOk,
  });
  assert.equal(attachments.length, 0);
});

test('issue38: media tag declares the file and is stripped from text', async () => {
  const answer = '报告在此 <media src="/workspace/report.html" type="file" /> 请查收';
  const statOk = async () => ({ isFile: () => true, size: 2048 });
  const { attachments, cleanedText } = await extractMediaAttachments(answer, {
    allowedRoots: ['/workspace'],
    statImpl: statOk,
  });
  assert.equal(attachments.length, 1);
  assert.equal(attachments[0].name, 'report.html');
  assert.doesNotMatch(cleanedText, /<media/);
  assert.match(cleanedText, /请查收/);
});

test('issue38: media tag with missing file sends nothing', async () => {
  const answer = '报告在此 <media src="/workspace/missing.html" />';
  const statMissing = async () => { throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); };
  const { attachments } = await extractMediaAttachments(answer, {
    allowedRoots: ['/workspace'],
    statImpl: statMissing,
  });
  assert.equal(attachments.length, 0);
});
