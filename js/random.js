// 文字列から決定的な疑似乱数を作る（同じ文字列なら毎回同じ系列になる）

// FNV-1a（32bit）で文字列をシード値にする
function hashString(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

// mulberry32。0以上1未満の値を返す関数を作る
export function createSeededRandom(seedText) {
  let seed = hashString(seedText);
  return () => {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
