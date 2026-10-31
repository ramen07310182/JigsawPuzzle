// ピース同士の結合と、土台への吸着・固定（仕様4.1）
// 判定はピースIDと正解位置の関係で行い、すべて論理座標で計算する（画面の拡大率に左右されない）

import { getGroupRect, offsetIntoArea, movePieces } from "./geometry.js";
import { getMovableArea } from "./placement.js";

// 判定距離（ピースの短辺に対する比率）
const SNAP_DISTANCE_RATIO = 0.25;
// 正しく隣り合う位置（上下左右）
const NEIGHBOR_STEPS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

export function getSnapDistance(layout) {
  return Math.min(layout.cellWidth, layout.cellHeight) * SNAP_DISTANCE_RATIO;
}

const cellKey = (col, row) => `${col},${row}`;

// anchor を基準に、members を正しい位置関係に並べ直す（anchor は動かない）
// 移動量を足すのではなく正解位置の差から置き直すので、グループ内の位置関係に誤差がたまらない
function alignTo(members, anchor) {
  for (const piece of members) {
    piece.x = anchor.x + (piece.correctX - anchor.correctX);
    piece.y = anchor.y + (piece.correctY - anchor.correctY);
  }
}

// 正解位置から判定距離以内にあるピースがあれば、グループを固定できる
// （固定済みピースは正解位置にあるので、その隣に正しく置いた場合も、この判定に含まれる）
function canLock(members, distance) {
  return members.some((piece) => Math.hypot(piece.x - piece.correctX, piece.y - piece.correctY) <= distance);
}

// group と正しく隣り合う、別の未固定グループとの組み合わせのうち、位置関係のずれが判定距離以内のもの
// 相手グループごとに、ずれが最小の組み合わせを1つ返す（ずれの小さい順）
function findJoinCandidates(group, groupId, piecesByCell, distance) {
  const best = new Map();
  for (const own of group) {
    for (const [dc, dr] of NEIGHBOR_STEPS) {
      const partner = piecesByCell.get(cellKey(own.col + dc, own.row + dr));
      if (!partner || partner.locked || partner.groupId === groupId) continue;
      const errorX = (partner.x - own.x) - (partner.correctX - own.correctX);
      const errorY = (partner.y - own.y) - (partner.correctY - own.correctY);
      const error = Math.hypot(errorX, errorY);
      if (error > distance) continue;
      const current = best.get(partner.groupId);
      if (!current || error < current.error) best.set(partner.groupId, { own, partner, error });
    }
  }
  return [...best.values()].sort((a, b) => a.error - b.error);
}

// ドロップしたグループ（droppedMembers）について、結合と吸着・固定を判定して適用する
//   1. 正解位置から判定距離以内なら、グループ全員を正解位置に置いて固定する（最優先）
//   2. 正しく隣り合う未固定のグループと、位置関係のずれが判定距離以内なら結合する
//      最初の結合ではドロップしたグループを最もずれの小さい相手に合わせ、以降に結合する相手は、
//      相手グループ全体を結合済みのグループに合わせて動かす。合わせた後のずれで判定し直すので、判定距離を超える結合はしない
//   3. 結合で大きくなったグループについて、新たな固定・結合がなくなるまで1・2をくり返す
//   4. 固定しなかった場合は、グループ全体を作業エリアの範囲内に収める
// 固定済みのピースは結合の相手にせず、動かさない
// 戻り値：{ members: 最終的なグループ, joined: 結合したか, locked: 固定したピース }
export function applySnapping(droppedMembers, pieces, layout, view) {
  const distance = getSnapDistance(layout);
  const piecesByCell = new Map(pieces.map((piece) => [cellKey(piece.col, piece.row), piece]));
  const groupId = droppedMembers[0].groupId;
  let group = [...droppedMembers];
  let joined = false;
  let droppedAligned = false;

  for (let step = 0; step < pieces.length; step++) {
    if (canLock(group, distance)) {
      for (const piece of group) {
        piece.x = piece.correctX;
        piece.y = piece.correctY;
        piece.locked = true;
      }
      return { members: group, joined, locked: [...group] };
    }

    const [candidate] = findJoinCandidates(group, groupId, piecesByCell, distance);
    if (!candidate) break;
    const partnerMembers = pieces.filter((piece) => piece.groupId === candidate.partner.groupId);
    if (!droppedAligned) {
      // ドロップしたグループを相手に合わせる（相手は動かさない）
      alignTo(group, candidate.partner);
      droppedAligned = true;
    } else {
      // 相手グループ全体を、結合済みのグループに合わせて動かす
      alignTo(partnerMembers, candidate.own);
    }
    for (const piece of partnerMembers) piece.groupId = groupId;
    group = [...group, ...partnerMembers];
    joined = true;
  }

  const { dx, dy } = offsetIntoArea(getGroupRect(group, layout.piecePadding), getMovableArea(view));
  movePieces(group, dx, dy);
  return { members: group, joined, locked: [] };
}
