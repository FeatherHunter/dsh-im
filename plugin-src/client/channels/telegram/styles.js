import { BASE_ID, PACKAGE_NAME } from '../../../shared/package-meta.js';
export const TELEGRAM_STYLE_ID = `${BASE_ID}-telegram-settings`;

const CSS = String.raw`
.dtg-page { --ddt-accent: #229ed9; --ddt-accent-deep: #1687bd; --ddt-accent-wash: #eaf7fd; }
.dtg-avatar { color: #fff; background: #229ed9; }
.dtg-avatar svg { display: block; }
`;

export function installTelegramStyles() {
  if (typeof document === 'undefined') return () => {};
  const existing = document.querySelector(`style[data-plugin-css="${TELEGRAM_STYLE_ID}"]`);
  if (existing) return () => {};
  const style = document.createElement('style');
  style.dataset.plugin = PACKAGE_NAME;
  style.dataset.pluginCss = TELEGRAM_STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
  return () => style.remove();
}
