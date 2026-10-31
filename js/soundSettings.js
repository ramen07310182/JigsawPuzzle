// 効果音の設定（音量・ミュート）を localStorage に保存し、次回アクセス時に読み込む
// 読み込み・保存に失敗しても例外を外に出さない（初期値やその場の設定のまま使う）

const STORAGE_KEY = "jigsawPuzzle.soundSettings";

export const DEFAULT_SOUND_SETTINGS = Object.freeze({ volume: 50, muted: false });

function getStorage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

// 音量は0〜100の整数、ミュートは真偽値。範囲外・壊れた値は初期値にする
export function loadSoundSettings(storage = getStorage()) {
  const settings = { ...DEFAULT_SOUND_SETTINGS };
  try {
    const text = storage ? storage.getItem(STORAGE_KEY) : null;
    if (!text) return settings;
    const saved = JSON.parse(text);
    if (Number.isInteger(saved?.volume) && saved.volume >= 0 && saved.volume <= 100) settings.volume = saved.volume;
    if (typeof saved?.muted === "boolean") settings.muted = saved.muted;
  } catch {
    // 読み込めない場合は初期値のまま
  }
  return settings;
}

export function saveSoundSettings(settings, storage = getStorage()) {
  try {
    if (storage) storage.setItem(STORAGE_KEY, JSON.stringify({ volume: settings.volume, muted: settings.muted }));
  } catch {
    // 保存できなくても、その場の設定のまま続ける
  }
}
