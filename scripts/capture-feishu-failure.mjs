// 一键抓捕飞书 INTERNAL_UNKNOWN 失败现场（诊断用，不碰业务代码）。
// 用法：
//   node scripts/capture-feishu-failure.mjs            按需抓取：扫今天与昨天日志，落盘一份抓捕包并打印摘要
//   node scripts/capture-feishu-failure.mjs --watch   常驻巡检模式：只追加上次之后的新命中，退出码恒为 0
// 抓捕包与巡检状态放在 .scratch/feishu-failure-capture/（已进 .gitignore，不污染仓库）。
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { homedir, platform } from 'node:os';
import { join, resolve, basename } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const outDir = join(root, '.scratch', 'feishu-failure-capture');
const stateFile = join(outDir, 'last-seen.json');

const desktopLogDir = platform() === 'win32' && process.env.APPDATA
  ? join(process.env.APPDATA, 'DSH Desktop', 'logs')
  : join(homedir(), '.dsh', 'logs');

const maskBot = (s) => String(s).replace(/((?:bot_|wx_)[A-Za-z0-9]{4})[A-Za-z0-9]+([A-Za-z0-9]{4})/g, '$1..$2');

function dayStamp(d) {
  d = d || new Date();
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

function stamp(d) {
  d = d || new Date();
  const p = (n) => String(n).padStart(2, '0');
  return dayStamp(d) + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
}

async function listLogFiles() {
  const out = [];
  try {
    const names = await readdir(desktopLogDir);
    for (const name of names) {
      if (/^dsh-\d{4}-\d{2}-\d{2}\.log$/.test(name)) out.push(join(desktopLogDir, name));
    }
  } catch (e) { /* 日志目录不可读则返回空 */ }
  return out.sort().slice(-2);
}

function pickHits(lines, file) {
  const hits = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.indexOf('dsh-feishu') < 0) continue;
    if (!/failed to process|MF-[A-Z0-9]{4,}/.test(line)) continue;
    hits.push({ file: file, line: i + 1, text: line.slice(0, 600),
      context: lines.slice(Math.max(0, i - 2), Math.min(lines.length, i + 3)).join('\n').slice(0, 1500) });
  }
  return hits;
}

async function readHits(files) {
  const all = [];
  for (const file of files) {
    try {
      const content = await readFile(file, 'utf8');
      const parts = all.concat(pickHits(content.split(/\r?\n/), file));
      all.length = 0;
      for (const h of parts) all.push(h);
    } catch (e) { /* 单个文件失败不中断 */ }
  }
  return all;
}

function branchOf() {
  return new Promise((done) => {
    execFile('git', ['branch', '--show-current'], { cwd: root }, (err, stdout) => {
      done(err ? 'unknown' : String(stdout).trim() || 'unknown');
    });
  });
}

async function envSnapshot() {
  const snap = { at: new Date().toISOString(), node: process.version, logDir: desktopLogDir };
  try {
    const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
    snap.plugin = pkg.name + '@' + pkg.version;
  } catch (e) { snap.plugin = 'unknown'; }
  snap.branch = await branchOf();
  return snap;
}

async function loadState() {
  try { return JSON.parse(await readFile(stateFile, 'utf8')); }
  catch (e) { return { seen: [] }; }
}

async function main() {
  const watch = process.argv.indexOf('--watch') >= 0;
  const { mkdirSync } = await import('node:fs');
  mkdirSync(outDir, { recursive: true });
  const files = await listLogFiles();
  const hits = await readHits(files);
  const env = await envSnapshot();
  if (!watch) {
    const name = 'capture-' + stamp() + '.md';
    const head = ['# 飞书失败现场抓捕包 ' + env.at, '', '- 插件：' + env.plugin + '（分支 ' + env.branch + '）',
      '- 日志目录：' + env.logDir, '- 命中行数：' + hits.length, ''];
    for (const h of hits) {
      head.push('## ' + basename(h.file) + ':' + h.line, '', h.text, '', '~~~', h.context, '~~~', '');
    }
    await writeFile(join(outDir, name), head.join('\n'), 'utf8');
    console.log(JSON.stringify({ mode: 'capture', bundle: name, hits: hits.length, plugin: env.plugin, branch: env.branch }));
    for (const h of hits.slice(-10)) console.log(maskBot(basename(h.file) + ':' + h.line + ' ' + h.text.slice(0, 200)));
    if (hits.length === 0) console.log('no fresh feishu failure lines in scanned logs');
    return;
  }
  const state = await loadState();
  const seen = new Set(state.seen || []);
  const fresh = [];
  for (const h of hits) {
    const key = h.file + ':' + h.line + ':' + h.text.slice(0, 80);
    if (!seen.has(key)) { seen.add(key); fresh.push(h); }
  }
  if (fresh.length > 0) {
    const lines = fresh.map((h) => '[' + env.at + '] ' + basename(h.file) + ':' + h.line + ' ' + h.text).join('\n') + '\n';
    await writeFile(join(outDir, 'captures.log'), lines, { flag: 'a' });
  }
  const arr = Array.from(seen);
  await writeFile(stateFile, JSON.stringify({ seen: arr.slice(-500), updatedAt: env.at }), 'utf8');
  console.log(JSON.stringify({ mode: 'watch', fresh: fresh.length }));
}

await main();
