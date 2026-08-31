import manifest from '../../../../package.json' with { type: 'json' };
const PACKAGE_NAME = manifest.name;
const BASE_ID = PACKAGE_NAME.replace(/^@/, '').replace(/\//g, '-').replace(/_/g, '-');
export const WECOM_STYLE_ID = `${BASE_ID}-wecom-settings`;

const CSS = String.raw`
.dwecom-page { --ddt-accent: #3370ff; --ddt-accent-deep: #245bdb; --ddt-accent-wash: #eef4ff; }
.dwecom-avatar, .dwecom-brand { color: #3370ff; background: #fff; border: 1px solid var(--dsw-alias-border-l2, #e5e6eb); }
.dwecom-avatar svg, .dwecom-brand svg { display: block; }
`;

export function installWecomStyles() {
  if (typeof document === 'undefined') return () => {};
  const existing = document.querySelector(`style[data-plugin-css="${WECOM_STYLE_ID}"]`);
  if (existing) return () => {};
  const style = document.createElement('style');
  style.dataset.plugin = PACKAGE_NAME;
  style.dataset.pluginCss = WECOM_STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
  return () => style.remove();
}
