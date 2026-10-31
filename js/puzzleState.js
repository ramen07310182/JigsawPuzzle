// パズル全体の状態：完成判定と、「最初から遊ぶ」での初期化

import { scatterPieces } from "./placement.js";

// すべてのピースが土台に固定されていれば完成
export function isPuzzleComplete(pieces) {
  return pieces.length > 0 && pieces.every((piece) => piece.locked);
}

// ピースの位置・結合状態・固定状態・表示順を最初の状態に戻し、最初に開いたときと同じ方法でランダムに置き直す
// 形（path・bounds）、画像、正解位置は変えない。戻り値は次に最前面へ出すときに使う表示順の値
export function resetPieces(pieces, layout, view, random = Math.random) {
  for (const piece of pieces) {
    piece.locked = false;
    piece.groupId = piece.id;
    piece.z = piece.id;
    piece.x = piece.correctX;
    piece.y = piece.correctY;
  }
  scatterPieces(pieces, layout, view, random);
  return Math.max(...pieces.map((piece) => piece.z)) + 1;
}
