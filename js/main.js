// 起動処理：設定と画像を読み込み、土台とピースを表示する

import { loadPuzzleList } from "./config.js";
import { computeLayout, computeView, applyView, renderBoard } from "./board.js";
import { createPuzzleEdges, createPieces } from "./pieces.js";
import { scatterPieces, keepPiecesInView } from "./placement.js";
import { renderPieces, updatePiecePositions } from "./pieceView.js";

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
  // 画面に見えている範囲（論理座標）と表示倍率
  view: null,
  // 初期配置がまだ済んでいない（表示領域の大きさが決まる前に読み込んだ場合）
  needsScatter: false,
};

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
  elements.workArea.hidden = false;
  if (state.needsScatter) {
    scatterPieces(state.pieces, state.layout, view);
    state.needsScatter = false;
  } else {
    keepPiecesInView(state.pieces, state.layout, view);
  }
  updatePiecePositions(elements.pieces, state.pieces, state.layout);
}

async function showPuzzle(puzzle) {
  state.puzzle = puzzle;
  state.layout = null;
  state.pieces = [];
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
  renderPieces(elements.pieces, state.pieces, image.src, state.layout);

  state.needsScatter = true;
  updateLayout();
}

async function init() {
  new ResizeObserver(updateLayout).observe(elements.viewport);

  elements.thumbnailButton.addEventListener("click", openPreview);
  elements.preview.addEventListener("click", closePreview);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closePreview();
  });

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
