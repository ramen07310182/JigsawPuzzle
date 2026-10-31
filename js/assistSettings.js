// アシスト表示（おてほん）のON/OFFを localStorage に保存し、次回アクセス時に読み込む
// 読み込み・保存に失敗しても例外を外に出さない（OFFや、その場の設定のまま使う）

const STORAGE_KEY = "jigsawPuzzle.assistSettings";

export const DEFAULT_ASSIST_SETTINGS = Object.freeze({ enabled: false });

function getStorage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

// 保存値がない・壊れている場合はOFF
export function loadAssistSettings(storage = getStorage()) {
  const settings = { ...DEFAULT_ASSIST_SETTINGS };
  try {
    const text = storage ? storage.getItem(STORAGE_KEY) : null;
    if (!text) return settings;
    const saved = JSON.parse(text);
    if (typeof saved?.enabled === "boolean") settings.enabled = saved.enabled;
  } catch {
    // 読み込めない場合はOFFのまま
  }
  return settings;
}

export function saveAssistSettings(settings, storage = getStorage()) {
  try {
    if (storage) storage.setItem(STORAGE_KEY, JSON.stringify({ enabled: settings.enabled }));
  } catch {
    // 保存できなくても、その場の設定のまま続ける
  }
}
