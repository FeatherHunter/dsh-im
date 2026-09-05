import { normalizeAgentPresetId } from '../../../../src/channels/shared/agent-preset.mjs';

export const SET_AGENT_PRESET_ENDPOINT = 'bot.preset.set';

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function validAgentPresetPayload(payload) {
  return isRecord(payload)
    && Object.keys(payload).every((key) => ['botId', 'agentPreset'].includes(key))
    && typeof payload.botId === 'string'
    && /^[A-Za-z0-9_-]{1,128}$/.test(payload.botId)
    && (payload.agentPreset === null
      // Case-insensitive + legacy fallback (`PTC` -> `ptc`, `code` -> `standard`)
      // so uppercase/legacy selections normalize instead of being rejected.
      || (typeof payload.agentPreset === 'string' && normalizeAgentPresetId(payload.agentPreset) !== null));
}

export function publicAgentPresetError(error) {
  if (![
    'agent-preset-invalid',
    'agent-preset-unavailable',
    'workspace-bot-not-found',
  ].includes(error?.code)) return null;
  return { code: error.code, message: error.message };
}
