import manifest from '../../../../package.json' with { type: 'json' };
const PACKAGE_NAME = manifest.name;
const BASE_ID = PACKAGE_NAME.replace(/^@/, '').replace(/\//g, '-').replace(/_/g, '-');
export const QQ_STYLE_ID = `${BASE_ID}-qq-settings`;

const CSS = String.raw`
.dqq-page { --ddt-accent: #1677ff; --ddt-accent-deep: #0958d9; --ddt-accent-wash: #eaf3ff; }
.dqq-avatar, .dqq-brand { color: #fff; background: #1677ff; }
.dqq-avatar svg, .dqq-brand svg { display: block; }
`;

export function installQqStyles() {
  if (typeof document === 'undefined') return () => {};
  const existing = document.querySelector(`style[data-plugin-css="${QQ_STYLE_ID}"]`);
  if (existing) return () => {};
  const style = document.createElement('style');
  style.dataset.plugin = PACKAGE_NAME;
  style.dataset.pluginCss = QQ_STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
  return () => style.remove();
}
