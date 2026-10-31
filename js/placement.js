// 未配置ピースの配置：土台の外の見えている範囲に、重ならないように置く

// ピース同士・表示範囲の端との間隔（論理座標）
export const PIECE_GAP = 16;
// 空いている位置を探すときの走査間隔（ピースの短辺をこの数で割った長さ）
const SCAN_DIVISIONS = 4;

function shuffle(items, random) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

// 凹凸込みのピース1つ分＋間隔の区画の大きさ
function getSlotSize(layout) {
  const { cellWidth, cellHeight, piecePadding } = layout;
  return {
    width: cellWidth + piecePadding * 2 + PIECE_GAP,
    height: cellHeight + piecePadding * 2 + PIECE_GAP,
  };
}

function divideArea(x, y, width, height, slotSize) {
  const cols = Math.floor(width / slotSize.width);
  const rows = Math.floor(height / slotSize.height);
  if (cols <= 0 || rows <= 0) return [];
  const cellWidth = width / cols;
  const cellHeight = height / rows;
  const slots = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      slots.push({ x: x + col * cellWidth, y: y + row * cellHeight, width: cellWidth, height: cellHeight });
    }
  }
  return slots;
}

// 見えている範囲のうち土台の外側を区画に分ける
// 「上下の帯を全幅にする」分け方と「左右の帯を全高にする」分け方で、区画が多い方を使う
function createSlots(layout, view) {
  const { board } = layout;
  const slotSize = getSlotSize(layout);
  const left = view.x;
  const top = view.y;
  const right = view.x + view.width;
  const bottom = view.y + view.height;
  const boardRight = board.x + board.width;
  const boardBottom = board.y + board.height;

  const wideBands = [
    ...divideArea(left, top, right - left, board.y - top, slotSize),
    ...divideArea(left, boardBottom, right - left, bottom - boardBottom, slotSize),
    ...divideArea(left, board.y, board.x - left, board.height, slotSize),
    ...divideArea(boardRight, board.y, right - boardRight, board.height, slotSize),
  ];
  const tallBands = [
    ...divideArea(left, top, board.x - left, bottom - top, slotSize),
    ...divideArea(boardRight, top, right - boardRight, bottom - top, slotSize),
    ...divideArea(board.x, top, board.width, board.y - top, slotSize),
    ...divideArea(board.x, boardBottom, board.width, bottom - boardBottom, slotSize),
  ];
  return tallBands.length > wideBands.length ? tallBands : wideBands;
}

export function countSlots(layout, view) {
  return createSlots(layout, view).length;
}

// ピースの実際の形状範囲（論理座標）
function getPieceRect(piece, padding) {
  return {
    x: piece.x - padding + piece.bounds.minX,
    y: piece.y - padding + piece.bounds.minY,
    width: piece.bounds.maxX - piece.bounds.minX,
    height: piece.bounds.maxY - piece.bounds.minY,
  };
}

function unionRect(rects) {
  const left = Math.min(...rects.map((rect) => rect.x));
  const top = Math.min(...rects.map((rect) => rect.y));
  const right = Math.max(...rects.map((rect) => rect.x + rect.width));
  const bottom = Math.max(...rects.map((rect) => rect.y + rect.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function overlapArea(a, b) {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return width > 0 && height > 0 ? width * height : 0;
}

function insetRect(rect, amount) {
  return { x: rect.x + amount, y: rect.y + amount, width: rect.width - amount * 2, height: rect.height - amount * 2 };
}

function movePieces(pieces, dx, dy) {
  for (const piece of pieces) {
    piece.x += dx;
    piece.y += dy;
  }
}

// 区画内のランダムな位置に、形状範囲 rect を収める移動量
function offsetIntoSlot(rect, slot, random) {
  const inner = insetRect(slot, PIECE_GAP / 2);
  const freeX = Math.max(inner.width - rect.width, 0);
  const freeY = Math.max(inner.height - rect.height, 0);
  return {
    dx: inner.x + random() * freeX - rect.x,
    dy: inner.y + random() * freeY - rect.y,
  };
}

// 重なりが最も少ない位置（見えている範囲内）への移動量。土台との重なりは重く数える
// 範囲を細かく走査し、重なりのない位置があればその中からランダムに選ぶ
function offsetWithLeastOverlap(rect, layout, view, obstacles, random) {
  const area = insetRect(view, PIECE_GAP / 2);
  const maxLeft = Math.max(area.width - rect.width, 0);
  const maxTop = Math.max(area.height - rect.height, 0);
  const step = Math.max(Math.min(rect.width, rect.height) / SCAN_DIVISIONS, 1);
  // 他のピースとの間隔を空けるため、間隔の分だけ広げた範囲で重なりを判定する
  const expanded = (x, y) => ({ x: x - PIECE_GAP / 2, y: y - PIECE_GAP / 2, width: rect.width + PIECE_GAP, height: rect.height + PIECE_GAP });

  const free = [];
  let best = null;
  for (let top = 0; top <= maxTop; top += step) {
    for (let left = 0; left <= maxLeft; left += step) {
      const x = area.x + left;
      const y = area.y + top;
      const candidate = expanded(x, y);
      let score = overlapArea(candidate, layout.board) * 4;
      for (const obstacle of obstacles) score += overlapArea(candidate, obstacle);
      if (score === 0) free.push({ x, y });
      if (!best || score < best.score) best = { score, x, y };
    }
  }
  const target = free.length > 0 ? free[Math.floor(random() * free.length)] : best;
  return { dx: target.x - rect.x, dy: target.y - rect.y };
}

// 初期配置：土台の外の区画にランダムに1つずつ置く
export function scatterPieces(pieces, layout, view, random = Math.random) {
  const { piecePadding } = layout;
  const slots = shuffle(createSlots(layout, view), random);
  const order = shuffle(pieces, random);

  const placedRects = [];
  const overflow = [];
  order.forEach((piece, index) => {
    const slot = slots[index];
    if (!slot) {
      overflow.push(piece);
      return;
    }
    const { dx, dy } = offsetIntoSlot(getPieceRect(piece, piecePadding), slot, random);
    movePieces([piece], dx, dy);
    placedRects.push(getPieceRect(piece, piecePadding));
  });

  if (overflow.length > 0) {
    console.warn(`置き場が ${overflow.length} 個分不足しているため、重なりを最小にして配置します`);
    for (const piece of overflow) {
      const { dx, dy } = offsetWithLeastOverlap(getPieceRect(piece, piecePadding), layout, view, placedRects, random);
      movePieces([piece], dx, dy);
      placedRects.push(getPieceRect(piece, piecePadding));
    }
  }
}

// 画面サイズ変更・端末回転の後に、未固定のピース・グループを見えている範囲に収める
// 範囲内に残っているものは動かさない。押し戻した結果、他のピースや土台と重なった場合は、
// 空いている区画（なければ重なりが最も少ない位置）へ移す
export function keepPiecesInView(pieces, layout, view, random = Math.random) {
  const { piecePadding } = layout;
  const area = insetRect(view, PIECE_GAP / 2);
  const groups = new Map();
  for (const piece of pieces) {
    if (piece.locked) continue;
    if (!groups.has(piece.groupId)) groups.set(piece.groupId, []);
    groups.get(piece.groupId).push(piece);
  }
  const entries = [...groups.values()].map((members) => ({
    members,
    rect: unionRect(members.map((piece) => getPieceRect(piece, piecePadding))),
  }));

  const slots = createSlots(layout, view);
  for (const entry of entries) {
    const { rect } = entry;

    // 範囲からはみ出した分だけ戻す（範囲より大きいグループは左上を合わせる）
    let dx = 0;
    let dy = 0;
    if (rect.x + rect.width > area.x + area.width) dx = area.x + area.width - (rect.x + rect.width);
    if (rect.x + dx < area.x) dx = area.x - rect.x;
    if (rect.y + rect.height > area.y + area.height) dy = area.y + area.height - (rect.y + rect.height);
    if (rect.y + dy < area.y) dy = area.y - rect.y;
    if (dx === 0 && dy === 0) continue;
    movePieces(entry.members, dx, dy);
    entry.rect = { ...rect, x: rect.x + dx, y: rect.y + dy };

    const others = entries.filter((other) => other !== entry).map((other) => other.rect);
    const hitsPiece = others.some((other) => overlapArea(entry.rect, other) > 0);
    const hitsBoard = overlapArea(entry.rect, layout.board) > 0;
    if (!hitsPiece && !hitsBoard) continue;

    const freeSlot = slots.find((slot) => {
      const inner = insetRect(slot, PIECE_GAP / 2);
      return inner.width >= entry.rect.width && inner.height >= entry.rect.height
        && !others.some((other) => overlapArea(slot, other) > 0);
    });
    const offset = freeSlot
      ? offsetIntoSlot(entry.rect, freeSlot, random)
      : offsetWithLeastOverlap(entry.rect, layout, view, others, random);
    movePieces(entry.members, offset.dx, offset.dy);
    entry.rect = { ...entry.rect, x: entry.rect.x + offset.dx, y: entry.rect.y + offset.dy };
  }
}
