// パズル設定（data/puzzles.json）の読み込みと検証

// 選べるピース数と、その列数・行数（どの画像でも共通）。最初は先頭（9ピース）
export const PIECE_COUNT_OPTIONS = Object.freeze([
  Object.freeze({ count: 9, cols: 3, rows: 3 }),
  Object.freeze({ count: 16, cols: 4, rows: 4 }),
  Object.freeze({ count: 30, cols: 6, rows: 5 }),
  Object.freeze({ count: 50, cols: 10, rows: 5 }),
  Object.freeze({ count: 70, cols: 10, rows: 7 }),
  Object.freeze({ count: 100, cols: 10, rows: 10 }),
]);

export function findPieceCountOption(count) {
  return PIECE_COUNT_OPTIONS.find((option) => option.count === Number(count)) ?? null;
}

function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

function validateEntry(entry) {
  if (!entry || typeof entry !== "object") return "設定が不正です";
  if (typeof entry.id !== "string" || entry.id === "") return "id がありません";
  if (typeof entry.name !== "string" || entry.name === "") return "name がありません";
  if (typeof entry.image !== "string" || entry.image === "") return "image がありません";
  if (!isPositiveInteger(entry.cols) || !isPositiveInteger(entry.rows)) {
    return "cols / rows は1以上の整数で指定してください";
  }
  return null;
}

// 不正な項目や重複IDは除外し、他の画像は使えるようにする
export async function loadPuzzleList(url) {
  const response = await fetch(url, { cache: "no-cache" });
  if (!response.ok) {
    throw new Error(`${url} を取得できませんでした（HTTP ${response.status}）`);
  }

  const data = await response.json();
  if (!data || !Array.isArray(data.puzzles)) {
    throw new Error(`${url} に puzzles 配列がありません`);
  }

  const puzzles = [];
  const seenIds = new Set();
  data.puzzles.forEach((entry, index) => {
    const error = validateEntry(entry);
    if (error) {
      console.warn(`puzzles[${index}] を除外しました: ${error}`);
      return;
    }
    if (seenIds.has(entry.id)) {
      console.warn(`puzzles[${index}] を除外しました: id "${entry.id}" が重複しています`);
      return;
    }
    seenIds.add(entry.id);
    // cols・rows は設定として読み込むが、実際に遊ぶピース数はピース数のリストボックスで選ぶ（PIECE_COUNT_OPTIONS）
    puzzles.push({
      // 画像の種類（開発者が用意した画像）。ユーザーが選んだ画像は "user"（userImage.js）
      source: "developer",
      id: entry.id,
      name: entry.name,
      image: entry.image,
      cols: entry.cols,
      rows: entry.rows,
    });
  });

  if (puzzles.length === 0) {
    throw new Error("有効なパズル設定がありません");
  }
  return puzzles;
}
