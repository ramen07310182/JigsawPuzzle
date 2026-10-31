// 起動処理：設定と画像を読み込み、土台とピースを表示する。ピースのドラッグ操作を組み込む

import { loadPuzzleList } from "./config.js";
import { computeLayout, computeView, applyView, placeBoard, renderBoard } from "./board.js";
import { createPuzzleEdges, createPieces } from "./pieces.js";
import { scatterPieces, keepPiecesInView, relocateHiddenPieces } from "./placement.js";
import { renderPieces, updatePiecePositions, setPiecesDragging } from "./pieceView.js";
import { createDragController } from "./drag.js";
import { preventDoubleTapZoom } from "./doubleTapGuard.js";

const PUZZLE_LIST_URL = "data/puzzles.json";

const elements = {
  panel: document.getElementById("panel"),
  thumbnailButton: document.getElementById("thumbnail-button"),
  thumbnail: document.getElementById("thumbnail"),
  preview: document.getElementById("preview"),
  previewImage: document.getElementById("preview-image"),
  puzzleName: document.getElementById("puzzle-name"),
  placedCount: document.getElementById("placed-count"),
  totalCount: document.getElementById("total-count"),
  viewport: document.getElementById("viewport"),
  workArea: document.getElementById("work-area"),
  board: document.getElementById("board"),
  pieces: document.getElementById("pieces"),
  message: document.getElementById("message"),
};

const state = {
  puzzle: null,
  layout: null,
  pieces: [],
  // ピースID → 表示要素
  pieceElements: new Map(),
  // 次に最前面へ出すときに使う表示順の値
  nextZ: 0,
  // 画面に見えている範囲（論理座標）と表示倍率
  view: null,
  // 初期配置がまだ済んでいない（表示領域の大きさが決まる前に読み込んだ場合）
  needsScatter: false,
};

// ピース・グループを最前面にする。グループ内の重なり順は保つ
function bringToFront(members) {
  const ordered = [...members].sort((a, b) => a.z - b.z);
  for (const piece of ordered) {
    piece.z = state.nextZ;
    state.nextZ += 1;
  }
}

const drag = createDragController({
  viewport: elements.viewport,
  getContext: () => ({ pieces: state.pieces, layout: state.layout, view: state.view }),
  onStart(members) {
    bringToFront(members);
    setPiecesDragging(state.pieceElements, members, true);
    updatePiecePositions(state.pieceElements, members, state.layout, state.view);
    elements.viewport.classList.add("is-dragging");
  },
  onMove(members) {
    updatePiecePositions(state.pieceElements, members, state.layout, state.view);
  },
  onEnd(members) {
    setPiecesDragging(state.pieceElements, members, false);
    elements.viewport.classList.remove("is-dragging");
    const moved = relocateHiddenPieces(members, state.pieces, state.layout, state.view);
    updatePiecePositions(state.pieceElements, [...members, ...moved], state.layout, state.view);
  },
});

function showError(text) {
  elements.message.textContent = text;
  elements.message.hidden = false;
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`画像「${src}」を読み込めませんでした`));
    image.src = src;
  });
}

// 完成図の拡大表示。表示中は背後の画面を inert にして操作できなくする
function openPreview() {
  if (elements.thumbnailButton.hidden) return;
  // ドラッグ中に開くと作業エリアが操作できなくなり、ドラッグが終わらないため先に終了させる
  drag.cancel();
  elements.previewImage.src = elements.thumbnail.src;
  elements.preview.hidden = false;
  elements.panel.inert = true;
  elements.viewport.inert = true;
  elements.preview.focus();
}

function closePreview() {
  if (elements.preview.hidden) return;
  elements.preview.hidden = true;
  elements.panel.inert = false;
  elements.viewport.inert = false;
  elements.thumbnailButton.focus();
}

// 表示領域の大きさから表示範囲・倍率を計算し直し、ピースを見えている範囲に収める
function updateLayout() {
  if (!state.layout) return;
  const view = computeView(
    state.layout,
    elements.viewport.clientWidth,
    elements.viewport.clientHeight,
    state.pieces.length,
  );
  if (!view) return;

  state.view = view;
  applyView(elements.workArea, view);
  placeBoard(elements.board, state.layout, view);
  elements.workArea.hidden = false;
  if (state.needsScatter) {
    scatterPieces(state.pieces, state.layout, view);
    state.needsScatter = false;
  } else {
    // ドラッグ中のグループは押し戻さず、ドラッグ処理側で新しい表示範囲に合わせる
    keepPiecesInView(state.pieces, state.layout, view, { excludeGroupId: drag.draggingGroupId() });
  }
  updatePiecePositions(state.pieceElements, state.pieces, state.layout, view);
  drag.handleViewChange();
}

async function showPuzzle(puzzle) {
  drag.cancel();
  state.puzzle = puzzle;
  state.layout = null;
  state.pieces = [];
  state.pieceElements = new Map();
  state.view = null;
  closePreview();
  elements.pieces.replaceChildren();
  elements.workArea.hidden = true;
  elements.thumbnailButton.hidden = true;
  elements.message.hidden = true;
  elements.puzzleName.textContent = puzzle.name;
  elements.placedCount.textContent = "0";
  elements.totalCount.textContent = String(puzzle.cols * puzzle.rows);

  let image;
  try {
    image = await loadImage(puzzle.image);
  } catch (error) {
    showError(error.message);
    return;
  }

  elements.thumbnail.src = image.src;
  elements.thumbnailButton.hidden = false;

  state.layout = computeLayout(image.naturalWidth, image.naturalHeight, puzzle.cols, puzzle.rows);
  const edges = createPuzzleEdges(puzzle, state.layout);
  renderBoard(elements.board, state.layout, edges);

  state.pieces = createPieces(state.layout, edges);
  state.nextZ = Math.max(...state.pieces.map((piece) => piece.z)) + 1;
  state.pieceElements = renderPieces(elements.pieces, state.pieces, image.src, state.layout);

  state.needsScatter = true;
  updateLayout();
}

async function init() {
  new ResizeObserver(updateLayout).observe(elements.viewport);
  // iPad Safari のダブルタップズームを、作業エリアの中だけ打ち消す
  preventDoubleTapZoom(elements.viewport);

  elements.thumbnailButton.addEventListener("click", openPreview);
  elements.preview.addEventListener("click", closePreview);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closePreview();
  });
  // ウィンドウからフォーカスが外れた（指を離した通知が届かない可能性がある）場合はドラッグを終了する
  window.addEventListener("blur", () => drag.cancel());

  let puzzles;
  try {
    puzzles = await loadPuzzleList(PUZZLE_LIST_URL);
  } catch (error) {
    elements.puzzleName.textContent = "読み込みエラー";
    showError(`パズル設定を読み込めませんでした：${error.message}`);
    return;
  }

  await showPuzzle(puzzles[0]);
}

init();
