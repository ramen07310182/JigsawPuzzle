// 起動処理：設定と画像を読み込み、土台とピースを表示する。ピースのドラッグ操作を組み込む

import { loadPuzzleList } from "./config.js";
import { computeLayout, computeView, applyView, placeBoard, renderBoard } from "./board.js";
import { createPuzzleEdges, createPieces } from "./pieces.js";
import { scatterPieces, keepPiecesInView, relocateHiddenPieces } from "./placement.js";
import { renderPieces, updatePiecePositions, setPiecesDragging } from "./pieceView.js";
import { createDragController } from "./drag.js";
import { applySnapping } from "./snapping.js";
import { isPuzzleComplete, resetPieces } from "./puzzleState.js";
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
  complete: document.getElementById("complete"),
  restartButton: document.getElementById("restart-button"),
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
  // 完成済み（完成演出を1回の完成につき1回だけにするため。「最初から遊ぶ」で false に戻す）
  completed: false,
};

// ピース・グループを最前面にする。グループ内の重なり順は保つ
function bringToFront(members) {
  const ordered = [...members].sort((a, b) => a.z - b.z);
  for (const piece of ordered) {
    piece.z = state.nextZ;
    state.nextZ += 1;
  }
}

// 完成数（土台に固定されたピースの数）を表示する
function updatePlacedCount() {
  elements.placedCount.textContent = String(state.pieces.filter((piece) => piece.locked).length);
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
    // 結合・吸着（固定）の判定。結合したグループは全体を最前面にする
    const snap = applySnapping(members, state.pieces, state.layout, state.view);
    if (snap.joined && snap.locked.length === 0) bringToFront(snap.members);
    // 固定したピースは背面になり他のピースを隠さないので、隠れたピースの移動は固定しなかった場合だけ行う
    if (snap.locked.length === 0) relocateHiddenPieces(members, state.pieces, state.layout, state.view);
    updatePiecePositions(state.pieceElements, state.pieces, state.layout, state.view);
    updatePlacedCount();
    // 完成判定：固定が起きたときだけ調べる。完成済みなら二重に扱わない
    const completed = snap.locked.length > 0 && !state.completed && isPuzzleComplete(state.pieces);
    if (completed) state.completed = true;
    handleGameEvents({ joined: snap.joined, locked: snap.locked, completed });
  },
});

// ドロップ1回の結果（結合した・固定した・完成した）をまとめて扱う
// 手順6の効果音はここに追加する（完成したときは完成音を優先し、結合音・吸着音は重ねない）
function handleGameEvents({ completed }) {
  if (completed) showCompletion();
}

// 完成演出。表示中は背後の画面を inert にして操作できなくする。閉じた後も完成した画像はそのまま表示される
function showCompletion() {
  elements.restartButton.hidden = false;
  elements.complete.hidden = false;
  elements.panel.inert = true;
  elements.viewport.inert = true;
  elements.complete.focus();
}

function closeCompletion() {
  if (elements.complete.hidden) return;
  elements.complete.hidden = true;
  elements.panel.inert = false;
  elements.viewport.inert = false;
  if (!elements.restartButton.hidden) elements.restartButton.focus();
}

// 「最初から遊ぶ」：確認して承認された場合だけ、ピースを最初の状態に戻す（キャンセルなら完成状態のまま）
function confirmRestart() {
  if (!window.confirm("最初から遊びますか？\n今の完成した状態は元に戻せません。")) return;
  restartPuzzle();
}

// ピースの位置・結合状態・固定状態・表示順を初期化し、最初と同じ方法でランダムに置き直す
// 形・画像・正解位置は変えない。完成数を0に戻し、再びドラッグできる状態にする
function restartPuzzle() {
  // 完成した後にだけ呼ばれるので、表示範囲は決まっている
  if (!state.layout || !state.view) return;
  drag.cancel();
  closeCompletion();
  state.nextZ = resetPieces(state.pieces, state.layout, state.view);
  state.completed = false;
  elements.restartButton.hidden = true;
  updatePiecePositions(state.pieceElements, state.pieces, state.layout, state.view);
  updatePlacedCount();
}

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
  state.completed = false;
  closePreview();
  closeCompletion();
  elements.restartButton.hidden = true;
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
  // URL に ?debug=1 があるときだけ、タッチ操作の診断表示を読み込む（通常は読み込まない）
  if (new URLSearchParams(location.search).get("debug") === "1") {
    try {
      const { startTouchDebug } = await import("./touchDebug.js");
      startTouchDebug(elements.viewport);
    } catch (error) {
      console.warn("診断表示を読み込めませんでした", error);
    }
  }

  new ResizeObserver(updateLayout).observe(elements.viewport);
  // iPad Safari のダブルタップズームを、作業エリアの中だけ打ち消す
  preventDoubleTapZoom(elements.viewport);

  elements.thumbnailButton.addEventListener("click", openPreview);
  elements.preview.addEventListener("click", closePreview);
  elements.complete.addEventListener("click", closeCompletion);
  elements.restartButton.addEventListener("click", confirmRestart);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closePreview();
      closeCompletion();
    }
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
