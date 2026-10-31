// ピースの凹凸形状とピースデータの生成

import { createSeededRandom } from "./random.js";

// 凸部の高さ（ピースの短辺に対する比率）
const TAB_HEIGHT_RATIO = 0.2;
// 凹凸の中心位置のずれ幅（辺の長さに対する比率）
const TAB_OFFSET_RANGE = 0.06;
// 凹凸の大きさの最小倍率（1.0との間でばらつかせる）
const TAB_MIN_SCALE = 0.9;
// 輪郭線の太さ分の余裕（論理座標）
const OUTLINE_ALLOWANCE = 2;

// 凹凸1つ分の形。辺の長さを100とした3次ベジェ曲線で、yが負の方向に凸部が出る
// 各要素は [制御点1x, 制御点1y, 制御点2x, 制御点2y, 終点x, 終点y]
const TAB_TEMPLATE = [
  [0, 0, 35, 15, 37, 5],
  [37, 5, 40, 0, 38, -5],
  [38, -5, 20, -20, 50, -20],
  [50, -20, 80, -20, 62, -5],
  [62, -5, 60, 0, 63, 5],
  [63, 5, 65, 15, 100, 0],
];

// ピース要素の外周に確保する余白（凸部が収まる幅）
export function getPiecePadding(cellWidth, cellHeight) {
  return Math.ceil(Math.min(cellWidth, cellHeight) * TAB_HEIGHT_RATIO) + OUTLINE_ALLOWANCE;
}

// 辺は { start: [x, y], segments: [[c1x, c1y, c2x, c2y, x, y], ...] } で表す（土台内の座標）
function createStraightEdge(x1, y1, x2, y2) {
  return { start: [x1, y1], segments: [[x1, y1, x2, y2, x2, y2]] };
}

// axis が "x" なら右向き、"y" なら下向きの辺。tab.direction が 1 なら凸部は下（右）に出る
function createTabEdge(x, y, axis, length, tab, shortSide) {
  const unit = (shortSide * tab.scale) / 100;
  const center = length * (0.5 + tab.offset);
  const toPoint = (templateU, templateV) => {
    let u = center + (templateU - 50) * unit;
    if (templateU <= 0) u = 0;
    if (templateU >= 100) u = length;
    const v = -templateV * unit * tab.direction;
    return axis === "x" ? [x + u, y + v] : [x + v, y + u];
  };

  return {
    start: [x, y],
    segments: TAB_TEMPLATE.map(([c1u, c1v, c2u, c2v, u, v]) => [
      ...toPoint(c1u, c1v),
      ...toPoint(c2u, c2v),
      ...toPoint(u, v),
    ]),
  };
}

function reverseEdge(edge) {
  const points = [edge.start, ...edge.segments.map((segment) => [segment[4], segment[5]])];
  const segments = [];
  for (let i = edge.segments.length - 1; i >= 0; i--) {
    const [c1x, c1y, c2x, c2y] = edge.segments[i];
    const [x, y] = points[i];
    segments.push([c2x, c2y, c1x, c1y, x, y]);
  }
  return { start: points[points.length - 1], segments };
}

// 隣接するピースは同じ辺データを共有するため、凹凸は必ずかみ合う
function createEdges(cols, rows, cellWidth, cellHeight, random) {
  const shortSide = Math.min(cellWidth, cellHeight);
  const nextTab = () => ({
    direction: random() < 0.5 ? 1 : -1,
    offset: (random() * 2 - 1) * TAB_OFFSET_RANGE,
    scale: TAB_MIN_SCALE + random() * (1 - TAB_MIN_SCALE),
  });

  // horizontal[row][col]：row番目の横線のうちcol列目の辺（row = 0..rows）
  const horizontal = [];
  for (let row = 0; row <= rows; row++) {
    const line = [];
    for (let col = 0; col < cols; col++) {
      const x = col * cellWidth;
      const y = row * cellHeight;
      const isBorder = row === 0 || row === rows;
      line.push(isBorder
        ? createStraightEdge(x, y, x + cellWidth, y)
        : createTabEdge(x, y, "x", cellWidth, nextTab(), shortSide));
    }
    horizontal.push(line);
  }

  // vertical[col][row]：col番目の縦線のうちrow行目の辺（col = 0..cols）
  const vertical = [];
  for (let col = 0; col <= cols; col++) {
    const line = [];
    for (let row = 0; row < rows; row++) {
      const x = col * cellWidth;
      const y = row * cellHeight;
      const isBorder = col === 0 || col === cols;
      line.push(isBorder
        ? createStraightEdge(x, y, x, y + cellHeight)
        : createTabEdge(x, y, "y", cellHeight, nextTab(), shortSide));
    }
    vertical.push(line);
  }

  return { horizontal, vertical };
}

function formatNumber(value) {
  return String(Math.round(value * 100) / 100);
}

function formatPoint(x, y) {
  return `${formatNumber(x)} ${formatNumber(y)}`;
}

// 辺の曲線をSVGパスのコマンドにする。toLocal で座標系を変換する
function appendEdgeCommands(parts, edge, toLocal) {
  for (const [c1x, c1y, c2x, c2y, x, y] of edge.segments) {
    parts.push(`C ${toLocal(c1x, c1y)} ${toLocal(c2x, c2y)} ${toLocal(x, y)}`);
  }
}

// 時計回りの4辺をつないだ輪郭のSVGパスと、形状の範囲（ピース要素内の座標）を作る
function buildOutline(edges, originX, originY) {
  const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  const toLocal = (x, y) => {
    const localX = x - originX;
    const localY = y - originY;
    bounds.minX = Math.min(bounds.minX, localX);
    bounds.minY = Math.min(bounds.minY, localY);
    bounds.maxX = Math.max(bounds.maxX, localX);
    bounds.maxY = Math.max(bounds.maxY, localY);
    return formatPoint(localX, localY);
  };

  const parts = [`M ${toLocal(...edges[0].start)}`];
  for (const edge of edges) appendEdgeCommands(parts, edge, toLocal);
  parts.push("Z");

  // 制御点を含めた範囲なので、実際の曲線より少し広い（重なり判定では安全側になる）
  return { path: parts.join(" "), bounds };
}

// 凹凸形状（全ピースの辺データ）は画像IDと列数・行数から決まり、再読み込みしても変わらない
// ピースと土台の境界線は、ここで作った同じ辺データから描く
export function createPuzzleEdges(puzzle, layout) {
  const { cols, rows, cellWidth, cellHeight } = layout;
  const random = createSeededRandom(`${puzzle.id}:${cols}x${rows}`);
  return createEdges(cols, rows, cellWidth, cellHeight, random);
}

// 土台の内部の境界線（外周を除く）を1本のSVGパスにする。各辺は1回だけ描く（土台内の座標）
export function buildInnerEdgesPath(edges) {
  const parts = [];
  const addEdge = (edge) => {
    parts.push(`M ${formatPoint(...edge.start)}`);
    appendEdgeCommands(parts, edge, formatPoint);
  };
  edges.horizontal.slice(1, -1).forEach((line) => line.forEach(addEdge));
  edges.vertical.slice(1, -1).forEach((line) => line.forEach(addEdge));
  return parts.join(" ");
}

export function createPieces(layout, edges) {
  const { cols, rows, cellWidth, cellHeight, board, piecePadding } = layout;

  const pieces = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const cellX = col * cellWidth;
      const cellY = row * cellHeight;
      const outline = buildOutline([
        edges.horizontal[row][col],
        edges.vertical[col + 1][row],
        reverseEdge(edges.horizontal[row + 1][col]),
        reverseEdge(edges.vertical[col][row]),
      ], cellX - piecePadding, cellY - piecePadding);

      // x, y はピース本体（凹凸を除いたマス）の左上。作業エリアの論理座標
      const correctX = board.x + cellX;
      const correctY = board.y + cellY;
      pieces.push({
        id: row * cols + col,
        col,
        row,
        path: outline.path,
        bounds: outline.bounds,
        correctX,
        correctY,
        x: correctX,
        y: correctY,
        groupId: row * cols + col,
        locked: false,
      });
    }
  }
  return pieces;
}
