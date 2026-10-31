// ピース・グループの範囲計算（すべて論理座標）

// ピースの実際の形状範囲（凹凸を含む外接範囲）
export function getPieceRect(piece, padding) {
  return {
    x: piece.x - padding + piece.bounds.minX,
    y: piece.y - padding + piece.bounds.minY,
    width: piece.bounds.maxX - piece.bounds.minX,
    height: piece.bounds.maxY - piece.bounds.minY,
  };
}

// ピースの本体（凹凸を除いたマス）の範囲
export function getPieceBodyRect(piece, layout) {
  return { x: piece.x, y: piece.y, width: layout.cellWidth, height: layout.cellHeight };
}

export function unionRect(rects) {
  const left = Math.min(...rects.map((rect) => rect.x));
  const top = Math.min(...rects.map((rect) => rect.y));
  const right = Math.max(...rects.map((rect) => rect.x + rect.width));
  const bottom = Math.max(...rects.map((rect) => rect.y + rect.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

// グループ全体（凹凸を含む）の外接範囲
export function getGroupRect(members, padding) {
  return unionRect(members.map((piece) => getPieceRect(piece, padding)));
}

export function overlapArea(a, b) {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return width > 0 && height > 0 ? width * height : 0;
}

// 範囲の比較で、計算誤差による差を同じ位置とみなす許容値
const EDGE_TOLERANCE = 1e-6;

// outer が inner を完全に含むか（端がちょうど重なる場合も含む）
export function containsRect(outer, inner) {
  return inner.x >= outer.x - EDGE_TOLERANCE
    && inner.y >= outer.y - EDGE_TOLERANCE
    && inner.x + inner.width <= outer.x + outer.width + EDGE_TOLERANCE
    && inner.y + inner.height <= outer.y + outer.height + EDGE_TOLERANCE;
}

export function insetRect(rect, amount) {
  return { x: rect.x + amount, y: rect.y + amount, width: rect.width - amount * 2, height: rect.height - amount * 2 };
}

// rect を area に収める移動量。area より大きい場合は左上を合わせる
export function offsetIntoArea(rect, area) {
  let dx = 0;
  let dy = 0;
  if (rect.x + rect.width > area.x + area.width) dx = area.x + area.width - (rect.x + rect.width);
  if (rect.x + dx < area.x) dx = area.x - rect.x;
  if (rect.y + rect.height > area.y + area.height) dy = area.y + area.height - (rect.y + rect.height);
  if (rect.y + dy < area.y) dy = area.y - rect.y;
  return { dx, dy };
}

export function movePieces(pieces, dx, dy) {
  for (const piece of pieces) {
    piece.x += dx;
    piece.y += dy;
  }
}
