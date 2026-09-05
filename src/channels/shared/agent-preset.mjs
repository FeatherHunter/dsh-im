import { t } from './i18n.mjs';

/** Matches DeepSeek Harness agent-preset directory ids. */
export const AGENT_PRESET_ID = /^[a-z0-9][a-z0-9-]*$/;

/** Safe default when a stored/selected preset is abnormal: never fall back to `code`. */
export const STANDARD_AGENT_PRESET_ID = 'standard';

/**
 * Legacy preset ids that no longer ship with DSH (e.g. the removed `code`
 * preset, now superseded by `ptc`/`standard`). They resolve to the safe
 * default instead of persisting as broken ids.
 */
export const LEGACY_AGENT_PRESET_FALLBACKS = Object.freeze({ code: STANDARD_AGENT_PRESET_ID });

export const EMPTY_AGENT_PRESET_CATALOG = Object.freeze({
  defaultId: '',
  items: Object.freeze([]),
});

export function normalizeAgentPresetId(value) {
  if (value == null) return null;
  if (typeof value !== 'string') return null;
  // Case-insensitive: DSH preset ids are lowercase, so `PTC` means `ptc`.
  // Without this, an uppercase selection silently becomes null (follow Host
  // default) and the session can look like it ran an unexpected preset.
  const id = value.trim().toLowerCase();
  if (Object.hasOwn(LEGACY_AGENT_PRESET_FALLBACKS, id)) return LEGACY_AGENT_PRESET_FALLBACKS[id];
  return AGENT_PRESET_ID.test(id) ? id : null;
}

export function validateAgentPresetId(value) {
  if (value == null || value === '') return null;
  const id = normalizeAgentPresetId(value);
  if (!id) {
    const error = new Error(t('Agent Preset 无效。'));
    error.code = 'agent-preset-invalid';
    throw error;
  }
  return id;
}

function catalogItem(value) {
  if (typeof value === 'string') {
    const id = normalizeAgentPresetId(value);
    return id ? { id, label: id } : null;
  }
  if (!value || typeof value !== 'object') return null;
  if (value.broken !== undefined) return null;
  const id = normalizeAgentPresetId(value.id);
  if (!id) return null;
  const label = typeof value.name === 'string' && value.name.trim()
    ? value.name.trim().slice(0, 128)
    : typeof value.label === 'string' && value.label.trim()
      ? value.label.trim().slice(0, 128)
      : id;
  return { id, label };
}

export function normalizeAgentPresetCatalog(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { defaultId: '', items: [] };
  }
  const items = [];
  const seen = new Set();
  for (const entry of Array.isArray(value.items) ? value.items : []) {
    const item = catalogItem(entry);
    if (!item || seen.has(item.id)) continue;
    seen.add(item.id);
    items.push(item);
  }
  return {
    defaultId: normalizeAgentPresetId(value.defaultId) ?? '',
    items,
  };
}

export async function listAgentPresetCatalog(ctx) {
  try {
    const service = typeof ctx?.get === 'function' ? ctx.get('agentPresets') : ctx?.agentPresets;
    if (!service || typeof service.list !== 'function') return { defaultId: '', items: [] };
    const listed = await service.list();
    return normalizeAgentPresetCatalog({
      defaultId: typeof service.defaultId === 'string' ? service.defaultId : '',
      items: Array.isArray(listed) ? listed : [],
    });
  } catch {
    return { defaultId: '', items: [] };
  }
}
