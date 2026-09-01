import manifest from '../../package.json' with { type: 'json' };

export const PACKAGE_NAME = manifest.name;
export const SCOPE = PACKAGE_NAME.includes('/') ? PACKAGE_NAME.slice(0, PACKAGE_NAME.indexOf('/')) : '';
export const UNSCOPED = PACKAGE_NAME.includes('/') ? PACKAGE_NAME.slice(PACKAGE_NAME.indexOf('/') + 1) : PACKAGE_NAME;
export const PLUGIN_ID = PACKAGE_NAME.replace(/^@/, '').replace(/\//g, '-').replace(/_/g, '-');
export const BASE_ID = PLUGIN_ID;

export function getStyleId(suffix) {
  return `${BASE_ID}-${suffix}`;
}

export function getChannelStyleId(channel) {
  return getStyleId(`${channel}-settings`);
}
