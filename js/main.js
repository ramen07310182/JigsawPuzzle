// 起動処理：設定と画像を読み込み、土台とピースを表示する。ピースのドラッグ操作を組み込む

import { loadPuzzleList, PIECE_COUNT_OPTIONS, findPieceCountOption } from "./config.js";
import { computeLayout, computeView, applyView, placeBoard, renderBoard } from "./board.js";
import { createPuzzleEdges, createPieces } from "./pieces.js";
import { scatterPieces, keepPiecesInView, relocateHiddenPieces } from "./placement.js";
import { renderPieces, updatePiecePositions, setPiecesDragging } from "./pieceView.js";
import { createDragController } from "./drag.js";
import { applySnapping } from "./snapping.js";
import { isPuzzleComplete, resetPieces } from "./puzzleState.js";
import { preventDoubleTapZoom } from "./doubleTapGuard.js";
import { chooseSound, createSoundPlayer } from "./sound.js";
import { loadSoundSettings, saveSoundSettings } from "./soundSettings.js";
import { prepareUserImage, createUserPuzzle, createUserImageId, getUserImageMessage } from "./userImage.js";
import {
  openImageStore, requestPersistentStorage, saveUserImage, touchUserImage, STORAGE_MESSAGES,
} from "./imageStore.js";
import { loadAssistSettings, saveAssistSettings } from "./assistSettings.js";

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
  soundToggle: document.getElementById("sound-toggle"),
  soundVolume: document.getElementById("sound-volume"),
  imageSelect: document.getElementById("image-select"),
  pieceCountSelect: document.getElementById("piece-count-select"),
  assistToggle: document.getElementById("assist-toggle"),
  imageFile: document.getElementById("image-file"),
  storageNotice: document.getElementById("storage-notice"),
};

// リストボックスで、ユーザーが選んだ画像を表す値
const USER_OPTION_VALUE = "user";

// 効果音の設定（音量0〜100・ミュート）。前回の設定を読み込み、変更するたびに保存する
const soundSettings = loadSoundSettings();
// 効果音の読み込みは待たずにゲームを始める（読み込めなかった音は鳴らないだけ）
const sound = createSoundPlayer({ volume: soundSettings.volume, muted: soundSettings.muted });
// アシスト表示（おてほん）のON/OFF。前回の設定を読み込み（なければOFF）、変更するたびに保存する
const assistSettings = loadAssistSettings();

// 画像の保存先（IndexedDB）。開くのを待たずにゲームを始める。開けない・使えなくなった場合は null（一時プレイ）
let imageStore = null;
const imageStoreReady = openImageStore({ onUnavailable: () => setImageStore(null) }).then((store) => {
  setImageStore(store);
  if (store) requestPersistentStorage();
  return store;
});

function setImageStore(store) {
  imageStore = store;
  // 保存できない状態（一時プレイ）では、パネルに知らせる
  elements.storageNotice.hidden = Boolean(store);
}

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
  // 開発者が用意した画像の一覧（data/puzzles.json）
  developerPuzzles: [],
  // さいごに選んだユーザーの画像（リストボックスに出すのは1枚だけ。手順11で一覧に変える）
  userPuzzle: null,
  // 画像の読み込みの番号。短時間に何度も選んだ場合、さいごの読み込みだけを反映する
  loadToken: 0,
  // 今のパズルのピース数（列数・行数）。どの画像でも共通（画像の設定の cols・rows より優先する）
  grid: PIECE_COUNT_OPTIONS[0],
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
// 効果音は1回のドロップにつき1つだけ（完成 → 完成音、固定 → 吸着音、結合だけ → 結合音）
function handleGameEvents({ joined, locked, completed }) {
  const soundName = chooseSound({ joined, locked, completed });
  // 完成したときは、鳴っている効果音を止めてから完成音だけを鳴らす
  if (soundName === "complete") sound.stopAll();
  if (soundName) sound.play(soundName);
  if (completed) showCompletion();
}

// 効果音のON／OFFボタンと音量スライダーに、今の設定を表示する
function renderSoundSettings() {
  elements.soundToggle.textContent = soundSettings.muted ? "おと OFF" : "おと ON";
  elements.soundToggle.setAttribute("aria-pressed", String(!soundSettings.muted));
  elements.soundVolume.value = String(soundSettings.volume);
}

function toggleMute() {
  soundSettings.muted = !soundSettings.muted;
  sound.setMuted(soundSettings.muted);
  renderSoundSettings();
  saveSoundSettings(soundSettings);
}

// スライダーを動かしている間もすぐに反映する。ミュート中はミュートのまま（解除したときにこの音量で鳴る）
function changeVolume() {
  const volume = Math.round(Number(elements.soundVolume.value));
  if (!Number.isFinite(volume)) return;
  soundSettings.volume = Math.min(100, Math.max(0, volume));
  sound.setVolume(soundSettings.volume);
}

// アシスト表示（おてほん）：ボタンに今の状態を表示し、土台の完成画像の表示を切り替える
// 画像の切り替え・ピース数の変更・リセットでは変えない
function renderAssist() {
  elements.assistToggle.textContent = assistSettings.enabled ? "おてほん ON" : "おてほん OFF";
  elements.assistToggle.setAttribute("aria-pressed", String(assistSettings.enabled));
  elements.board.classList.toggle("is-assist-on", assistSettings.enabled);
}

function toggleAssist() {
  assistSettings.enabled = !assistSettings.enabled;
  renderAssist();
  saveAssistSettings(assistSettings);
}

// ブラウザの自動再生制限のため、最初のユーザー操作で音声を使える状態にする
// 操作の既定動作は止めない。使える状態になったら監視をやめる
const UNLOCK_EVENTS = ["pointerdown", "pointerup", "touchend", "keydown"];
function unlockSound() {
  sound.unlock();
  if (!sound.isUnlocked()) return;
  for (const type of UNLOCK_EVENTS) window.removeEventListener(type, unlockSound, true);
}
function watchSoundUnlock() {
  if (sound.isUnlocked()) return;
  for (const type of UNLOCK_EVENTS) window.addEventListener(type, unlockSound, { capture: true, passive: true });
}

// 完成演出。表示中は背後の画面を inert にして操作できなくする。閉じた後も完成した画像はそのまま表示される
function showCompletion() {
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
  elements.restartButton.focus();
}

// 「最初から遊ぶ」：開始直後・プレイ中・完成後のいつでも使える
// 確認して承認された場合だけ、ピースを最初の状態に戻す（キャンセルなら何も変えない）
function confirmRestart() {
  // パズルの読み込み中など、まだピースが置かれていないときは何もしない
  if (!state.layout || !state.view) return;
  if (!window.confirm("さいしょから やりなおす？")) return;
  restartPuzzle();
}

// ピースの位置・結合状態・固定状態・表示順を初期化し、最初と同じ方法でランダムに置き直す
// 形・画像・正解位置は変えない。完成数を0に戻し、再びドラッグできる状態にする
function restartPuzzle() {
  if (!state.layout || !state.view) return;
  drag.cancel();
  sound.stopAll();
  closeCompletion();
  state.nextZ = resetPieces(state.pieces, state.layout, state.view);
  state.completed = false;
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

// ピース数のリストボックスで、いま選ばれているピース数（列数・行数）
// 変更の途中（読み込み中）でも、さいごに選んだ値を使う。キャンセル・失敗したときは今のパズルの値に戻す
function selectedGrid() {
  return findPieceCountOption(elements.pieceCountSelect.value) ?? state.grid;
}

// 画像を読み込んでから、今のパズルと入れ替える。grid はピース数（列数・行数）
// 読み込みに失敗した場合や、その間に別の画像・ピース数が選ばれた場合は今のパズルを残す。入れ替えたら true を返す
async function showPuzzle(puzzle, grid = selectedGrid()) {
  const token = ++state.loadToken;
  let image;
  try {
    image = await loadImage(puzzle.image);
  } catch (error) {
    if (token !== state.loadToken) return false;
    if (state.puzzle) {
      console.warn(error.message);
      window.alert(getUserImageMessage(null));
    } else {
      // 最初の画像を読み込めなかった場合（遊べるパズルがまだない）
      elements.puzzleName.textContent = puzzle.name;
      elements.totalCount.textContent = String(grid.count);
      showError(error.message);
    }
    renderPieceCountSelect();
    return false;
  }
  if (token !== state.loadToken) return false;
  applyPuzzle(puzzle, image, grid);
  return true;
}

// 読み込んだ画像でパズルを作り直す。ピース・結合・固定・完成状態・表示順・鳴っている効果音を初期化する
// 音量・ミュートの設定はそのまま
function applyPuzzle(puzzle, image, grid) {
  drag.cancel();
  sound.stopAll();
  closePreview();
  closeCompletion();
  state.puzzle = puzzle;
  state.grid = grid;
  state.view = null;
  state.completed = false;
  elements.message.hidden = true;
  elements.puzzleName.textContent = puzzle.name;
  elements.placedCount.textContent = "0";
  elements.totalCount.textContent = String(grid.count);
  elements.thumbnail.src = image.src;
  elements.thumbnailButton.hidden = false;

  // 凹凸の形は画像IDと列数・行数から決まる（createPuzzleEdges）
  state.layout = computeLayout(image.naturalWidth, image.naturalHeight, grid.cols, grid.rows);
  const edges = createPuzzleEdges(puzzle, state.layout);
  // アシスト用の完成画像も、新しい画像で描き直す（ON/OFFの状態は土台のクラスで保つ）
  renderBoard(elements.board, state.layout, edges, image.src);

  state.pieces = createPieces(state.layout, edges);
  state.nextZ = Math.max(...state.pieces.map((piece) => piece.z)) + 1;
  state.pieceElements = renderPieces(elements.pieces, state.pieces, image.src, state.layout);

  state.needsScatter = true;
  updateLayout();
  renderImageSelect();
  renderPieceCountSelect();
}

// ピース数のリストボックスを、今のパズルのピース数にする
function renderPieceCountSelect() {
  elements.pieceCountSelect.value = String(state.grid.count);
}

// ピース数を変える：今の画像で、新しいピース数のパズルを作り直す
async function changePieceCount() {
  const grid = findPieceCountOption(elements.pieceCountSelect.value);
  if (!grid) {
    renderPieceCountSelect();
    return;
  }
  // まだパズルがない（最初の画像を読み込めなかった）場合は、次に読み込む画像で使う
  if (!state.puzzle) {
    state.grid = grid;
    return;
  }
  if (grid === state.grid) {
    // 今のピース数に戻した場合は、読み込み中の別のピース数も反映しない（さいごの操作だけを反映する）
    state.loadToken += 1;
    renderPieceCountSelect();
    return;
  }
  if (state.pieces.some((piece) => piece.locked) && !window.confirm("いまの パズルを やめて、ピースの かずを かえる？")) {
    renderPieceCountSelect();
    return;
  }
  await showPuzzle(state.puzzle, grid);
}

// 固定済みのピースがあるときだけ、画像を変える前に確認する
function confirmImageChange() {
  if (!state.pieces.some((piece) => piece.locked)) return true;
  return window.confirm("いまの パズルを やめて、ちがう がぞうで あそぶ？");
}

// リストボックスに、開発者の画像と、さいごに選んだユーザーの画像を並べ、今の画像を選択状態にする
function renderImageSelect() {
  const options = state.developerPuzzles.map((puzzle) => new Option(puzzle.name, puzzle.id));
  if (state.userPuzzle) options.push(new Option(state.userPuzzle.name, USER_OPTION_VALUE));
  elements.imageSelect.replaceChildren(...options);
  if (state.puzzle) {
    elements.imageSelect.value = state.puzzle.source === "user" ? USER_OPTION_VALUE : state.puzzle.id;
  }
}

// リストボックスで画像を切り替える
async function changeImageFromList() {
  const value = elements.imageSelect.value;
  const puzzle = value === USER_OPTION_VALUE
    ? state.userPuzzle
    : state.developerPuzzles.find((entry) => entry.id === value);
  if (!puzzle || puzzle === state.puzzle) {
    // 今の画像を選び直した場合は、読み込み中の別の画像も反映しない（さいごの操作だけを反映する）
    state.loadToken += 1;
    renderImageSelect();
    return;
  }
  if (!confirmImageChange()) {
    renderImageSelect();
    return;
  }
  await showPuzzle(puzzle);
  renderImageSelect();
}

// 端末から選んだ画像でパズルを作る。画像は端末内だけで処理し、外部へは送信しない
// 順番：加工 → （今と同じ画像なら何もしない）→ 確認 → 保存（IndexedDB。完了を待つ）→ 画像の読み込み → 切り替え
// 各段階の前後で、さいごの選択か（loadToken）を確かめ、古い選択は今のパズルを上書きしない
async function selectUserImage(file) {
  const token = ++state.loadToken;
  const isCurrent = () => token === state.loadToken;
  let prepared;
  try {
    prepared = await prepareUserImage(file);
  } catch (error) {
    if (!isCurrent()) return;
    console.warn("選んだ画像を使えませんでした", error);
    window.alert(getUserImageMessage(error));
    return;
  }
  if (!isCurrent()) return;

  // 今遊んでいる画像と同じ画像なら、作り直さず今の進行（位置・結合・固定）をそのまま残す
  if (prepared.hash && state.puzzle?.hash === prepared.hash) {
    renderImageSelect();
    return;
  }
  // 確認は保存の前に行う。キャンセルなら保存もしない
  if (!confirmImageChange()) return;

  const store = await imageStoreReady.then(() => imageStore);
  if (!isCurrent()) return;

  let imageId;
  let jpeg = prepared.blob;
  let stored = false;
  if (store && prepared.hash) {
    let result;
    try {
      result = await saveUserImage(store, {
        hash: prepared.hash,
        jpeg: prepared.blob,
        thumbnail: prepared.thumbnail,
        width: prepared.width,
        height: prepared.height,
      }, { createId: createUserImageId });
    } catch (error) {
      // 書き込みに失敗した（容量不足など）：成功として扱わず、切り替えない（一時プレイにもしない）
      console.warn("画像を保存できませんでした", error);
      if (isCurrent()) window.alert(STORAGE_MESSAGES.failed);
      return;
    }
    if (result.status === "limit") {
      // 10枚保存済み：保存も切り替えもしない。既存の画像は消さない
      if (isCurrent()) window.alert(STORAGE_MESSAGES.limit);
      return;
    }
    if (!isCurrent()) {
      // 保存中に別の画像が選ばれた：この画像は保存されたが、表示はしない（手順11の一覧から選べる）
      if (result.status === "saved") console.info("前に選んだ画像は保存しましたが、表示はしていません", result.record.id);
      return;
    }
    if (result.status === "existing") touchUserImage(store, result.record.id);
    imageId = result.record.id;
    jpeg = result.record.jpeg;
    stored = true;
  }

  // 前に選んだ画像（今はサンプルを表示中など）と同じ保存画像なら、その URL をそのまま使う（読み込み直さない）
  if (imageId && state.userPuzzle?.id === imageId) {
    await showPuzzle(state.userPuzzle);
    renderImageSelect();
    return;
  }

  const url = URL.createObjectURL(jpeg);
  const puzzle = createUserPuzzle(url, { id: imageId, hash: prepared.hash, stored });
  // 表示（画像の読み込み）に失敗した、または別の操作で中断された場合は、作った URL を解放して今のパズルを残す
  if (!(await showPuzzle(puzzle))) {
    URL.revokeObjectURL(url);
    if (stored) console.warn("画像は保存済みですが、表示できませんでした", imageId);
    return;
  }
  // 入れ替えが済んでから、前に選んだ画像の URL を解放する（今の画像の URL は解放しない）
  const previous = state.userPuzzle;
  state.userPuzzle = puzzle;
  if (previous && previous.image !== puzzle.image) URL.revokeObjectURL(previous.image);
  renderImageSelect();
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
  renderAssist();
  elements.assistToggle.addEventListener("click", toggleAssist);
  renderSoundSettings();
  elements.soundToggle.addEventListener("click", toggleMute);
  elements.soundVolume.addEventListener("input", changeVolume);
  elements.soundVolume.addEventListener("change", () => {
    changeVolume();
    saveSoundSettings(soundSettings);
  });
  watchSoundUnlock();
  elements.imageSelect.addEventListener("change", changeImageFromList);
  elements.pieceCountSelect.addEventListener("change", changePieceCount);
  renderPieceCountSelect();
  elements.imageFile.addEventListener("change", () => {
    const file = elements.imageFile.files?.[0];
    // 同じファイルをもう一度選んだときも change が起きるように空にする（キャンセル時は何もしない）
    elements.imageFile.value = "";
    if (file) selectUserImage(file);
  });
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

  state.developerPuzzles = puzzles;
  renderImageSelect();
  await showPuzzle(puzzles[0]);
}

init();
