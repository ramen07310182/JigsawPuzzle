// ピースの描画：元画像の対応部分をピースの形で切り抜いて表示する

const SVG_NS = "http://www.w3.org/2000/svg";
// 未固定ピースの表示順に加える値。固定済みピースを z に関係なく常に未固定ピースより背面にする
const UNLOCKED_LAYER = 1000000;

function createSvgElement(name, attributes) {
  const element = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) {
    element.setAttribute(key, value);
  }
  return element;
}

// 当たり判定は輪郭パス（piece-outline）の内側だけ。SVG要素と画像は判定に使わない（CSSで設定）
function createPieceElement(piece, imageSrc, layout) {
  const { board, cellWidth, cellHeight, piecePadding } = layout;
  const width = cellWidth + piecePadding * 2;
  const height = cellHeight + piecePadding * 2;
  const clipId = `piece-clip-${piece.id}`;

  const svg = createSvgElement("svg", {
    class: "piece",
    width,
    height,
    viewBox: `0 0 ${width} ${height}`,
    "data-piece-id": piece.id,
  });

  const clipPath = createSvgElement("clipPath", { id: clipId });
  clipPath.append(createSvgElement("path", { d: piece.path }));
  const defs = createSvgElement("defs", {});
  defs.append(clipPath);

  // 土台と同じ大きさの画像を、このピースのマスがピース要素の本体位置に来るようずらして置く
  const image = createSvgElement("image", {
    href: imageSrc,
    x: -(piece.col * cellWidth - piecePadding),
    y: -(piece.row * cellHeight - piecePadding),
    width: board.width,
    height: board.height,
    preserveAspectRatio: "none",
    "clip-path": `url(#${clipId})`,
  });

  const outline = createSvgElement("path", { class: "piece-outline", d: piece.path });

  svg.append(defs, image, outline);
  return svg;
}

// 位置は left/top ではなく transform で指定する（移動のたびにレイアウトをやり直さないようにする）
// 表示位置は作業エリアの要素内の位置（論理座標 - 表示範囲の左上）。view がまだなければ原点基準
export function updatePieceElement(element, piece, layout, view) {
  const originX = view ? view.x : 0;
  const originY = view ? view.y : 0;
  element.style.transform = `translate(${piece.x - layout.piecePadding - originX}px, ${piece.y - layout.piecePadding - originY}px)`;
  element.style.zIndex = String(piece.locked ? piece.z : UNLOCKED_LAYER + piece.z);
  element.classList.toggle("is-locked", piece.locked);
}

// elementsById：renderPieces が返すピースID → 要素の対応表
export function updatePiecePositions(elementsById, pieces, layout, view) {
  for (const piece of pieces) {
    const element = elementsById.get(piece.id);
    if (element) updatePieceElement(element, piece, layout, view);
  }
}

export function setPiecesDragging(elementsById, pieces, dragging) {
  for (const piece of pieces) {
    elementsById.get(piece.id)?.classList.toggle("is-dragging", dragging);
  }
}

// 押された要素からピースIDを取り出す。ピースの形の内側でなければ null
export function findPieceId(target) {
  if (!(target instanceof Element) || !target.classList.contains("piece-outline")) return null;
  const element = target.closest("[data-piece-id]");
  return element ? Number(element.dataset.pieceId) : null;
}

export function renderPieces(container, pieces, imageSrc, layout, view) {
  container.replaceChildren();
  const elementsById = new Map();
  for (const piece of pieces) {
    const element = createPieceElement(piece, imageSrc, layout);
    updatePieceElement(element, piece, layout, view);
    container.append(element);
    elementsById.set(piece.id, element);
  }
  return elementsById;
}
