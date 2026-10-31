// 土台のレイアウト計算・描画と、作業エリアの表示範囲の計算

import { getPiecePadding, buildInnerEdgesPath } from "./pieces.js";
import { countSlots } from "./placement.js";

const SVG_NS = "http://www.w3.org/2000/svg";

// 土台の長辺の長さ（論理座標）
const BOARD_LONG_SIDE = 750;
// 表示倍率の下限（ピース数が多く置き場が確保できない場合でも、これ以上は縮小しない）
const MIN_VIEW_SCALE = 0.05;
// 表示倍率を求める二分探索の回数
const SCALE_SEARCH_STEPS = 30;

// 座標は土台の左上を原点とする論理座標で扱い、画面サイズやパネル位置に依存させない
export function computeLayout(imageWidth, imageHeight, cols, rows) {
  const scale = BOARD_LONG_SIDE / Math.max(imageWidth, imageHeight);
  const boardWidth = Math.round(imageWidth * scale);
  const boardHeight = Math.round(imageHeight * scale);
  const cellWidth = boardWidth / cols;
  const cellHeight = boardHeight / rows;

  return {
    board: { x: 0, y: 0, width: boardWidth, height: boardHeight },
    cols,
    rows,
    cellWidth,
    cellHeight,
    piecePadding: getPiecePadding(cellWidth, cellHeight),
  };
}

// 表示領域（px）と倍率から、画面に見えている範囲（論理座標）を作る。土台は中央に置く
function createView(layout, viewportWidth, viewportHeight, scale) {
  const { board } = layout;
  const width = viewportWidth / scale;
  const height = viewportHeight / scale;
  return {
    scale,
    x: board.x + board.width / 2 - width / 2,
    y: board.y + board.height / 2 - height / 2,
    width,
    height,
  };
}

// 総ピース数ぶんの置き場を土台の周囲に確保できる範囲で、土台を最も大きく表示する倍率を求める
export function computeView(layout, viewportWidth, viewportHeight, pieceCount) {
  if (viewportWidth <= 0 || viewportHeight <= 0) return null;

  const fits = (scale) => countSlots(layout, createView(layout, viewportWidth, viewportHeight, scale)) >= pieceCount;
  let high = Math.min(viewportWidth / layout.board.width, viewportHeight / layout.board.height);
  if (fits(high)) return createView(layout, viewportWidth, viewportHeight, high);

  let low = MIN_VIEW_SCALE;
  if (!fits(low)) {
    console.warn("表示倍率の下限でも置き場が不足しています");
    return createView(layout, viewportWidth, viewportHeight, low);
  }
  for (let i = 0; i < SCALE_SEARCH_STEPS; i++) {
    const middle = (low + high) / 2;
    if (fits(middle)) {
      low = middle;
    } else {
      high = middle;
    }
  }
  return createView(layout, viewportWidth, viewportHeight, low);
}

// 論理座標 → 画面座標：(論理座標 - 表示範囲の左上) × 倍率
export function applyView(workArea, view) {
  workArea.style.transform = `scale(${view.scale}) translate(${-view.x}px, ${-view.y}px)`;
}

// 画面座標（clientX / clientY）→ 論理座標。viewportRect は表示領域の getBoundingClientRect()
export function clientToLogical(view, viewportRect, clientX, clientY) {
  return {
    x: view.x + (clientX - viewportRect.left) / view.scale,
    y: view.y + (clientY - viewportRect.top) / view.scale,
  };
}

function createSvgElement(name, attributes) {
  const element = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) {
    element.setAttribute(key, value);
  }
  return element;
}

// 土台は外周の四角い枠と、ピースと同じ凹凸の境界線で描く
// 重ね順：下地 → アシスト用レイヤー（完成画像を薄く重ねる場所。現在は空）→ 境界線 → 外周の枠
export function renderBoard(svg, layout, edges) {
  const { board } = layout;

  svg.replaceChildren();
  svg.setAttribute("viewBox", `0 0 ${board.width} ${board.height}`);
  svg.setAttribute("width", board.width);
  svg.setAttribute("height", board.height);
  svg.style.left = `${board.x}px`;
  svg.style.top = `${board.y}px`;

  svg.append(createSvgElement("rect", {
    class: "board-fill",
    x: 0, y: 0, width: board.width, height: board.height,
  }));

  svg.append(createSvgElement("g", { class: "board-assist" }));

  svg.append(createSvgElement("path", {
    class: "board-grid",
    d: buildInnerEdgesPath(edges),
  }));

  svg.append(createSvgElement("rect", {
    class: "board-frame",
    x: 0, y: 0, width: board.width, height: board.height,
  }));
}
