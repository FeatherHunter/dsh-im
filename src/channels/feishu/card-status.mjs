import { t } from "../shared/i18n.mjs";

const FOLDER = "📂";
const CHAT = "💬";
const BOT = "🤖";
const BRAIN = "🧠";

// 主菜单“当前状态”行：wrapping markdown 显示完整取值。
// 模板本身不含中文，缺翻译时原样回退也不会污染英文模式。
export function menuStatusLine({ workspace, sessionTitle, presetLabel, modelId }) {
  return t(FOLDER + " `{ws}` | " + CHAT + " {sess} | " + BOT + " {preset} | " + BRAIN + " {model}", {
    ws: workspace ?? t("未设置"),
    sess: sessionTitle || t("暂无标题"),
    preset: presetLabel,
    model: modelId ?? t("未设置"),
  });
}
