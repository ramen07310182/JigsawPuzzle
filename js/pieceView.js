// ピースの描画：元画像の対応部分をピースの形で切り抜いて表示する

const SVG_NS = "http://www.w3.org/2000/svg";

function createSvgElement(name, attributes) {
  const element = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) {
    element.setAttribute(key, value);
  }
  return element;
}

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

export function updatePieceElement(element, piece, layout) {
  element.style.left = `${piece.x - layout.piecePadding}px`;
  element.style.top = `${piece.y - layout.piecePadding}px`;
}

export function updatePiecePositions(container, pieces, layout) {
  for (const piece of pieces) {
    const element = container.querySelector(`[data-piece-id="${piece.id}"]`);
    if (element) updatePieceElement(element, piece, layout);
  }
}

export function renderPieces(container, pieces, imageSrc, layout) {
  container.replaceChildren();
  for (const piece of pieces) {
    const element = createPieceElement(piece, imageSrc, layout);
    updatePieceElement(element, piece, layout);
    container.append(element);
  }
}
