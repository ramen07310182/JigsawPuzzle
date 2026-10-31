// 効果音（結合・吸着・完成の3種類）。Web Audio API で再生する
// iPad Safari では <audio> の volume を変更できないため、GainNode で音量を調整する
// 読み込み・デコード・再生・初期化に失敗しても例外を外に出さず、その音を鳴らさないだけにする（ゲームは止めない）

export const SOUND_FILES = {
  join: "assets/audio/piece_join.mp3",
  snap: "assets/audio/piece_snap.mp3",
  complete: "assets/audio/puzzle_complete.mp3",
};

// ピースを1回離したときに鳴らす音を1つだけ選ぶ
// 完成 → 完成音だけ。固定（結合したうえでの固定を含む）→ 吸着音だけ。結合だけ → 結合音。どれもなし → 鳴らさない
export function chooseSound({ joined, locked, completed }) {
  if (completed) return "complete";
  if (locked && locked.length > 0) return "snap";
  if (joined) return "join";
  return null;
}

function ignoreRejection(result) {
  if (result && typeof result.catch === "function") result.catch(() => {});
}

// files：音の名前 → ファイルの場所。volume：0〜100。muted：ミュート中か
export function createSoundPlayer({ files = SOUND_FILES, volume = 50, muted = false } = {}) {
  let context = null;
  let gain = null;
  let currentVolume = volume;
  let currentMuted = muted;
  const buffers = new Map();
  const playing = new Set();

  const applyGain = () => {
    if (gain) gain.gain.value = currentMuted ? 0 : currentVolume / 100;
  };

  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) {
      context = new AudioContextClass();
      gain = context.createGain();
      gain.connect(context.destination);
      applyGain();
    }
  } catch (error) {
    console.warn("効果音を使えません（AudioContextを作れませんでした）", error);
    context = null;
    gain = null;
  }

  // 古いSafariの decodeAudioData はコールバック形式なので、両方の形に対応する
  const decode = (data) => new Promise((resolve, reject) => {
    const result = context.decodeAudioData(data, resolve, reject);
    if (result && typeof result.then === "function") result.then(resolve, reject);
  });

  // 読み込みは待たずに進める（読み込み中に操作しても、その音が鳴らないだけ）
  const load = async (name, url) => {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      buffers.set(name, await decode(await response.arrayBuffer()));
    } catch (error) {
      console.warn(`効果音「${url}」を読み込めませんでした`, error);
    }
  };
  if (context) {
    for (const [name, url] of Object.entries(files)) load(name, url);
  }

  const stopAll = () => {
    for (const source of playing) {
      try {
        source.stop();
      } catch {
        // すでに止まっている場合は何もしない
      }
    }
    playing.clear();
  };

  return {
    // ブラウザの自動再生制限のため、ユーザーの操作の中で呼んで音声を使える状態にする
    unlock() {
      if (!context || context.state === "running" || context.state === "closed") return;
      try {
        ignoreRejection(context.resume());
      } catch {
        // 有効にできなくても、ゲームは止めない
      }
    },
    isUnlocked() {
      return !context || context.state === "running";
    },
    play(name) {
      if (!context || currentMuted) return;
      const buffer = buffers.get(name);
      if (!buffer) return;
      try {
        // iPad で別アプリの音などにより中断された（"interrupted"）場合も、操作の中で再開を試みる
        if (context.state !== "running") ignoreRejection(context.resume());
        const source = context.createBufferSource();
        source.buffer = buffer;
        source.connect(gain);
        source.onended = () => playing.delete(source);
        playing.add(source);
        source.start(0);
      } catch (error) {
        console.warn(`効果音「${name}」を再生できませんでした`, error);
      }
    },
    stopAll,
    // 0〜100。ミュート中に変更しても鳴らない（ミュートを解除したときにこの音量で鳴る）
    setVolume(value) {
      currentVolume = value;
      applyGain();
    },
    setMuted(value) {
      currentMuted = value;
      applyGain();
    },
  };
}
