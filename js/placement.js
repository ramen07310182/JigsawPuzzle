// 未配置ピースの配置：土台の外の見えている範囲に、重ならないように置く

import {
  getPieceRect,
  getPieceBodyRect,
  getGroupRect,
  overlapArea,
  containsRect,
  insetRect,
  offsetIntoArea,
  movePieces,
} from "./geometry.js";

// ピース同士・表示範囲の端との間隔（論理座標）
export const PIECE_GAP = 16;
// 空いている位置を探すときの走査間隔（ピースの短辺をこの数で割った長さ）
const SCAN_DIVISIONS = 4;
// 重なりとみなさない面積（計算誤差の許容値）
const OVERLAP_TOLERANCE = 1e-6;

function shuffle(items, random) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

// ピース・グループを動かせる範囲（見えている範囲の内側）
export function getMovableArea(view) {
  return insetRect(view, PIECE_GAP / 2);
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

// 候補にする座標：一定間隔の格子に加えて、範囲の端と、他のピース・土台に間隔を空けてぴったり接する位置
// （ちょうど1つ分しか空いていない場所にも入れるようにする）
function candidateCoordinates(min, max, step, touching) {
  const values = [];
  for (let value = min; value <= max; value += step) values.push(value);
  values.push(max);
  for (const value of touching) {
    if (value >= min && value <= max) values.push(value);
  }
  return values;
}

// 動かせる範囲の候補位置ごとに、重なりの大きさ（score）を求める。土台との重なりは重く数える
// 他のピースとの間隔を空けるため、間隔の分だけ広げた範囲で重なりを判定する
function scanPositions(rect, layout, view, obstacles) {
  const area = getMovableArea(view);
  const maxLeft = Math.max(area.width - rect.width, 0);
  const maxTop = Math.max(area.height - rect.height, 0);
  const step = Math.max(Math.min(rect.width, rect.height) / SCAN_DIVISIONS, 1);
  const halfGap = PIECE_GAP / 2;
  const blockers = [layout.board, ...obstacles];
  const xs = candidateCoordinates(area.x, area.x + maxLeft, step,
    blockers.flatMap((blocker) => [blocker.x + blocker.width + halfGap, blocker.x - halfGap - rect.width]));
  const ys = candidateCoordinates(area.y, area.y + maxTop, step,
    blockers.flatMap((blocker) => [blocker.y + blocker.height + halfGap, blocker.y - halfGap - rect.height]));

  const positions = [];
  for (const y of ys) {
    for (const x of xs) {
      const candidate = { x: x - halfGap, y: y - halfGap, width: rect.width + PIECE_GAP, height: rect.height + PIECE_GAP };
      let score = overlapArea(candidate, layout.board) * 4;
      for (const obstacle of obstacles) score += overlapArea(candidate, obstacle);
      // 接しているだけの位置が計算誤差で「重なり」にならないようにする
      positions.push({ x, y, score: score < OVERLAP_TOLERANCE ? 0 : score });
    }
  }
  return positions;
}

// 重なりのない位置があればその中からランダムに、なければ重なりが最も少ない位置への移動量
function offsetWithLeastOverlap(rect, layout, view, obstacles, random) {
  const positions = scanPositions(rect, layout, view, obstacles);
  const free = positions.filter((position) => position.score === 0);
  const target = free.length > 0
    ? free[Math.floor(random() * free.length)]
    : positions.reduce((best, position) => (position.score < best.score ? position : best));
  return { dx: target.x - rect.x, dy: target.y - rect.y };
}

// 他のピース・土台と重ならない位置のうち、今の位置から最も近い位置への移動量。なければ null
function offsetToNearestFree(rect, layout, view, obstacles) {
  let nearest = null;
  for (const position of scanPositions(rect, layout, view, obstacles)) {
    if (position.score !== 0) continue;
    const distance = Math.hypot(position.x - rect.x, position.y - rect.y);
    if (!nearest || distance < nearest.distance) nearest = { ...position, distance };
  }
  return nearest ? { dx: nearest.x - rect.x, dy: nearest.y - rect.y } : null;
}

function groupUnlocked(pieces, excludeGroupId) {
  const groups = new Map();
  for (const piece of pieces) {
    if (piece.locked || piece.groupId === excludeGroupId) continue;
    if (!groups.has(piece.groupId)) groups.set(piece.groupId, []);
    groups.get(piece.groupId).push(piece);
  }
  return groups;
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
// excludeGroupId のグループ（ドラッグ中）は動かさない
export function keepPiecesInView(pieces, layout, view, { excludeGroupId = null, random = Math.random } = {}) {
  const { piecePadding } = layout;
  const area = getMovableArea(view);
  const entries = [...groupUnlocked(pieces, excludeGroupId).values()].map((members) => ({
    members,
    rect: getGroupRect(members, piecePadding),
  }));
  const excluded = pieces.filter((piece) => piece.groupId === excludeGroupId);
  const excludedRects = excluded.length > 0 ? [getGroupRect(excluded, piecePadding)] : [];

  const slots = createSlots(layout, view);
  for (const entry of entries) {
    const { dx, dy } = offsetIntoArea(entry.rect, area);
    if (dx === 0 && dy === 0) continue;
    movePieces(entry.members, dx, dy);
    entry.rect = { ...entry.rect, x: entry.rect.x + dx, y: entry.rect.y + dy };

    const others = [...entries.filter((other) => other !== entry).map((other) => other.rect), ...excludedRects];
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

// ドロップしたグループ（droppedMembers）によって完全に隠された未固定ピースを、近くの空き場所へ移す
// 判定はピース1個ずつ：下のピースの本体が、ドロップしたグループの1個のピースの外接範囲に完全に入っていれば隠れている
// 隠れたピースがグループに属している場合はグループ全体を移す。空き場所がなければ移動しない
// 移動先は他のピース・土台と（間隔を空けて）一切重ならない位置なので、移動によって別のピースを隠すことはない
// 移動したピースの配列を返す
export function relocateHiddenPieces(droppedMembers, pieces, layout, view) {
  const { piecePadding } = layout;
  const droppedGroupId = droppedMembers[0].groupId;
  const coverRects = droppedMembers.map((piece) => getPieceRect(piece, piecePadding));
  const isHidden = (piece) => {
    const body = getPieceBodyRect(piece, layout);
    return coverRects.some((cover) => containsRect(cover, body));
  };

  const moved = [];
  for (const members of groupUnlocked(pieces, droppedGroupId).values()) {
    if (!members.some(isHidden)) continue;
    const groupId = members[0].groupId;
    const obstacles = pieces
      .filter((piece) => piece.groupId !== groupId)
      .map((piece) => getPieceRect(piece, piecePadding));
    const offset = offsetToNearestFree(getGroupRect(members, piecePadding), layout, view, obstacles);
    if (!offset) continue;
    movePieces(members, offset.dx, offset.dy);
    moved.push(...members);
  }
  return moved;
}
