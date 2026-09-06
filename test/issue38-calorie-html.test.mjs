import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { extractAttachments } from '../src/channels/feishu/attachment-parser.mjs';
import { __issue38SnapshotHelpers } from '../src/channels/feishu/bridge.mjs';
import {
  OUTBOUND_ARTIFACT_TOOL,
  OutboundArtifactRegistry,
  installOutboundArtifactTool,
} from '../src/channels/shared/semantic/artifact.mjs';

// Issue #38: xiaosun runs calorie HELP, generates HTML, Feishu gets nothing.
// The model neither calls the file-return tool nor mentions a path, so the
// artifact pipeline input is zero and only a workspace snapshot fallback can
// return the skill product.

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

test('issue38: pathless skill answer yields zero explicit attachments', async () => {
  const answer = '卡路里报告已生成，请查看。';
  const statOk = async () => ({ isFile: () => true, size: 1024 });
  const { attachments } = await extractAttachments(answer, {
    allowedRoots: ['/workspace'],
    statImpl: statOk,
  });
  assert.equal(attachments.length, 0);
});

test('issue38: snapshot fallback finds HTML generated during the turn', async (t) => {
  const workspace = await mkdtemp(join(tmpdir(), 'issue38-workspace-'));
  t.after(async () => {
    await rm(workspace, { recursive: true, force: true });
  });
  const { snapshotFiles, diffSnapshot } = __issue38SnapshotHelpers;
  const before = await snapshotFiles([workspace]);
  await writeFile(join(workspace, 'calorie-report.html'), '<html>calorie</html>');
  const found = await diffSnapshot(before, [workspace]);
  assert.equal(found.length, 1);
  assert.equal(found[0].name, 'calorie-report.html');
});

test('issue38: snapshot fallback ignores non-deliverable extensions', async (t) => {
  const workspace = await mkdtemp(join(tmpdir(), 'issue38-workspace-'));
  t.after(async () => {
    await rm(workspace, { recursive: true, force: true });
  });
  const { snapshotFiles, diffSnapshot } = __issue38SnapshotHelpers;
  const before = await snapshotFiles([workspace]);
  await writeFile(join(workspace, 'notes.exe'), 'binary');
  const found = await diffSnapshot(before, [workspace]);
  assert.equal(found.length, 0);
});

test('issue38: unchanged workspace produces no implicit attachments', async (t) => {
  const workspace = await mkdtemp(join(tmpdir(), 'issue38-workspace-'));
  t.after(async () => {
    await rm(workspace, { recursive: true, force: true });
  });
  const { snapshotFiles, diffSnapshot } = __issue38SnapshotHelpers;
  await writeFile(join(workspace, 'old.html'), '<html>old</html>');
  const before = await snapshotFiles([workspace]);
  const found = await diffSnapshot(before, [workspace]);
  assert.equal(found.length, 0);
});
