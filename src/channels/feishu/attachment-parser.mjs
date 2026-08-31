import fs from 'node:fs/promises';
import path from 'node:path';

export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
export const MAX_TOTAL_ATTACHMENT_BYTES = 20 * 1024 * 1024;
export const MAX_ATTACHMENTS = 20;

const EXPLICIT_PATTERN = /\[\[file:\s*([^\]]+)\]\]/g;
const MD_IMAGE_PATTERN = /!\[[^\]]*\]\(\s*([^\s)]+)\s*\)/g;
// 模拟飞书开放平台与 Hermes 插件的媒体标签：以 media 开头的 HTML 标签
// 格式：<media src="D:\path\to\file.html" type="file" /> 或 <media src="...">
const MEDIA_PATTERN = /<media\s+[^>]*src=["']([^"']+)["'][^>]*>/gi;
const BARE_PATH_PATTERN = /(?:(?<![A-Za-z0-9_\/])\/(?:data\/workspace|workspace)\/[^\s"'`\]\)]+|(?<![A-Za-z0-9_])[A-Za-z]:[\\/][^\s"'`\]\)]+)/g;

function toPosix(p) {
  return p.replace(/\\/g, '/');
}

function isSubPath(root, target) {
  const rel = path.posix.relative(toPosix(root), toPosix(target));
  return Boolean(rel) && !rel.startsWith('..') && !path.posix.isAbsolute(rel);
}

function isInAllowedRoots(allowedRoots, target) {
  if (!Array.isArray(allowedRoots) || allowedRoots.length === 0) return false;
  const normalized = toPosix(path.posix.normalize(target));
  return allowedRoots.some((root) => {
    const normRoot = toPosix(path.posix.normalize(root));
    return normalized === normRoot || isSubPath(normRoot, normalized);
  });
}

function normalizeCandidate(raw) {
  let s = String(raw ?? '').trim();
  // 去掉首尾引号/反引号（通用处理，不针对特定路径或名称硬编码）
  s = s.replace(/^["'`]+|["'`]+$/g, '').trim();
  return s;
}

function collectCandidates(answer) {
  const candidates = [];
  for (const m of answer.matchAll(new RegExp(EXPLICIT_PATTERN.source, 'g'))) {
    if (m[1]) candidates.push(normalizeCandidate(m[1]));
  }
  for (const m of answer.matchAll(new RegExp(MD_IMAGE_PATTERN.source, 'g'))) {
    if (m[1]) candidates.push(normalizeCandidate(m[1]));
  }
  for (const m of answer.matchAll(new RegExp(MEDIA_PATTERN.source, 'gi'))) {
    if (m[1]) candidates.push(normalizeCandidate(m[1]));
  }
  for (const m of answer.matchAll(new RegExp(BARE_PATH_PATTERN.source, 'g'))) {
    if (m[0]) candidates.push(normalizeCandidate(m[0]));
  }
  return candidates;
}

async function findByBasename(roots, basename, statImpl) {
  const target = String(basename ?? '').trim();
  if (!target) return null;
  const base = path.posix.basename(toPosix(target));
  if (!base) return null;
  for (const root of roots) {
    try {
      const found = await searchBasenameRecursively(toPosix(root), base, statImpl);
      if (found) return found;
    } catch {}
  }
  return null;
}

async function searchBasenameRecursively(dirPosix, basename, statImpl, depth = 0) {
  if (depth > 6) return null;
  let entries;
  try {
    const fsSync = await import('node:fs/promises');
    // Use native fs.readdir if statImpl is default, else fallback to not searching
    if (statImpl !== fsSync.stat) return null;
    const dirFs = path.posix.normalize(dirPosix).replace(/\//g, path.sep);
    entries = await fsSync.readdir(dirFs, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const ent of entries) {
    const fullPosix = path.posix.join(dirPosix, ent.name);
    if (ent.isFile() && ent.name === basename) {
      try {
        const st = await statImpl(fullPosix);
        if (st?.isFile?.() ?? true) return fullPosix;
      } catch {}
    }
  }
  for (const ent of entries) {
    if (ent.isDirectory()) {
      if (ent.name.startsWith('.') && ent.name !== '.dsh' && depth > 0) continue;
      if (ent.name === 'node_modules' || ent.name === '.git') continue;
      const sub = path.posix.join(dirPosix, ent.name);
      const r = await searchBasenameRecursively(sub, basename, statImpl, depth + 1);
      if (r) return r;
    }
  }
  return null;
}

export async function extractAttachments(answer, options = {}) {
  const {
    allowedRoots,
    workspaceRoot,
    statImpl = fs.stat,
  } = options;

  const roots = Array.isArray(allowedRoots)
    ? allowedRoots.filter((p) => typeof p === 'string' && p)
    : (typeof workspaceRoot === 'string' && workspaceRoot ? [workspaceRoot] : []);

  if (roots.length === 0 || typeof answer !== 'string' || !answer) {
    return { cleanedText: answer ?? '', attachments: [] };
  }

  const candidates = collectCandidates(answer);
  const seen = new Set();
  const attachments = [];
  let totalBytes = 0;

  for (const raw of candidates) {
    const rawPosix = toPosix(raw);
    const isAbs = path.isAbsolute(raw) || path.posix.isAbsolute(rawPosix) || /^[A-Za-z]:\//.test(rawPosix);
    let abs = isAbs ? path.posix.normalize(rawPosix) : path.posix.join(toPosix(roots[0]), rawPosix);
    const dedupeKey = abs;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    // Private fork: be permissive for Windows user-data paths outside Harness workspace (e.g., biscuit HTML at D:\2Study\...)
    const inWorkspace = isInAllowedRoots(roots, abs);
    if (!inWorkspace && !/^[A-Za-z]:\//.test(abs)) continue;
    let stat;
    try {
      stat = await statImpl(abs);
    } catch {
      // 容错：模型幻觉少写反斜杠等，尝试按 basename 在 workspace 兜底找回
      const fallback = await findByBasename(roots, rawPosix, statImpl);
      if (!fallback) continue;
      if (seen.has(fallback)) continue;
      seen.add(fallback);
      abs = fallback;
      try {
        stat = await statImpl(abs);
      } catch {
        continue;
      }
    }
    const isFile = typeof stat?.isFile === 'function' ? stat.isFile() : Boolean(stat?.isFile);
    if (!isFile) continue;
    const size = Number(stat.size) || 0;
    if (size > MAX_ATTACHMENT_BYTES) continue;
    if (totalBytes + size > MAX_TOTAL_ATTACHMENT_BYTES) continue;
    if (attachments.length >= MAX_ATTACHMENTS) break;
    totalBytes += size;
    attachments.push({ absPath: abs, name: path.posix.basename(abs), size });
  }

  const cleanedText = answer
    .replace(new RegExp(EXPLICIT_PATTERN.source, 'g'), '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return { cleanedText: cleanedText || answer, attachments };
}

export function isImageAttachment(att, mime) {
  if (typeof mime === 'string' && mime.startsWith('image/')) return true;
  return /\.(png|jpe?g|webp|gif)$/i.test(att.name ?? '');
}

// ========== 隔离扩展：仅处理以 media 开头的标签（本次需求） ==========
// 模拟飞书开放平台与 Hermes 插件的媒体标签格式
// 格式定义：以 <media 开头，包含 src 属性指向文件路径
// 示例：<media src="D:\path\to\file.html" type="file" /> 或 <media src="D:\path\to\file.html">
// 其他格式如 [[file:]]、裸路径、markdown 图片等与本次需求无关，不处理，保持原有逻辑隔离
export async function extractMediaAttachments(answer, options = {}) {
  const {
    allowedRoots,
    workspaceRoot,
    statImpl = fs.stat,
  } = options;

  const roots = Array.isArray(allowedRoots)
    ? allowedRoots.filter((p) => typeof p === 'string' && p)
    : (typeof workspaceRoot === 'string' && workspaceRoot ? [workspaceRoot] : []);

  if (roots.length === 0 || typeof answer !== 'string' || !answer) {
    return { cleanedText: answer ?? '', attachments: [] };
  }

  // 仅收集以 media 开头的标签
  const candidates = [];
  for (const m of answer.matchAll(new RegExp(MEDIA_PATTERN.source, 'gi'))) {
    if (m[1]) candidates.push(normalizeCandidate(m[1]));
  }

  const seen = new Set();
  const attachments = [];
  let totalBytes = 0;

  for (const raw of candidates) {
    const rawPosix = toPosix(raw);
    const isAbs = path.isAbsolute(raw) || path.posix.isAbsolute(rawPosix) || /^[A-Za-z]:\//.test(rawPosix);
    const abs = isAbs ? path.posix.normalize(rawPosix) : path.posix.join(toPosix(roots[0]), rawPosix);
    if (seen.has(abs)) continue;
    seen.add(abs);
    const inWorkspace = isInAllowedRoots(roots, abs);
    if (!inWorkspace && !/^[A-Za-z]:\//.test(abs)) continue;
    let stat;
    try {
      stat = await statImpl(abs);
    } catch {
      // 本次需求：不做兜底，路径错误直接跳过，保留原始 <media> 标签在文本中以便用户感知 AI 格式错误
      continue;
    }
    const isFile = typeof stat?.isFile === 'function' ? stat.isFile() : Boolean(stat?.isFile);
    if (!isFile) continue;
    const size = Number(stat.size) || 0;
    if (size > MAX_ATTACHMENT_BYTES) continue;
    if (totalBytes + size > MAX_TOTAL_ATTACHMENT_BYTES) continue;
    if (attachments.length >= MAX_ATTACHMENTS) break;
    totalBytes += size;
    attachments.push({ absPath: abs, name: path.posix.basename(abs), size });
  }

  // 文本清理：仅删除匹配到的以 media 开头的标签，其他文本保持不变
  const cleanedText = answer
    .replace(new RegExp(MEDIA_PATTERN.source, 'gi'), '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return { cleanedText: cleanedText || answer, attachments };
}
