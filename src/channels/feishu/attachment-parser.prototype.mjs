import fs from 'node:fs/promises';
import path from 'node:path';

const EXPLICIT_RE = /\[\[file:\s*([^\]]+)\]\]/g;
const MD_IMAGE_RE = /!\[[^\]]*\]\(\s*([^\s)]+)\s*\)/g;
const BARE_PATH_RE = /(?<![A-Za-z0-9_\/])\/(?:data\/workspace|workspace)\/[^\s"'`\]\)]+/g;

function isSubPath(root, target) {
  const rel = path.relative(root, target);
  return Boolean(rel) && !rel.startsWith('..') && !path.isAbsolute(rel);
}

export async function extractAttachments(answer, workspaceRoot, { statImpl = fs.stat } = {}) {
  const candidates = [];
  let m;
  while ((m = EXPLICIT_RE.exec(answer)) !== null) candidates.push(m[1].trim());
  while ((m = MD_IMAGE_RE.exec(answer)) !== null) candidates.push(m[1].trim());
  while ((m = BARE_PATH_RE.exec(answer)) !== null) candidates.push(m[0].trim());

  const seen = new Set();
  const attachments = [];
  let totalBytes = 0;
  for (const raw of candidates) {
    if (seen.has(raw)) continue;
    seen.add(raw);
    const abs = path.isAbsolute(raw) ? path.normalize(raw) : path.join(workspaceRoot, raw);
    if (!isSubPath(workspaceRoot, abs)) continue;
    let stat;
    try { stat = await statImpl(abs); } catch { continue; }
    if (!stat?.isFile?.() && !stat?.isFile) continue; // fs.Stat
    const size = stat.size ?? 0;
    if (size > 5 * 1024 * 1024) continue;
    if (totalBytes + size > 20 * 1024 * 1024) continue;
    if (attachments.length >= 20) break;
    totalBytes += size;
    attachments.push({ absPath: abs, name: path.basename(abs), size });
  }

  const cleanedText = answer
    .replace(EXPLICIT_RE, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return { cleanedText: cleanedText || answer, attachments };
}

export function isImageAttachment(att, mime) {
  if (mime && mime.startsWith('image/')) return true;
  return /\.(png|jpe?g|webp|gif)$/i.test(att.name);
}
