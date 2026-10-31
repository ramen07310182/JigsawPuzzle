// パズル設定（data/puzzles.json）の読み込みと検証

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
