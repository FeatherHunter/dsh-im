import { BASE_ID, PACKAGE_NAME } from '../../../shared/package-meta.js';
export const DISCORD_STYLE_ID = `${BASE_ID}-discord-settings`;

const CSS = String.raw`
.ddc-page { --ddt-accent: #5865f2; --ddt-accent-deep: #4752c4; --ddt-accent-wash: #eef0ff; }
.ddc-avatar { color: #fff; background: #5865f2; }
.ddc-avatar svg { display: block; }
`;

export function installDiscordStyles() {
  if (typeof document === 'undefined') return () => {};
  const existing = document.querySelector(`style[data-plugin-css="${DISCORD_STYLE_ID}"]`);
  if (existing) return () => {};
  const style = document.createElement('style');
  style.dataset.plugin = PACKAGE_NAME;
  style.dataset.pluginCss = DISCORD_STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
  return () => style.remove();
}
