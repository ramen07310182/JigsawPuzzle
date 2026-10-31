// ピースのドラッグ操作（マウス・タッチ共通。Pointer Events を使う）
// 同時に操作するのは1つのピースまたはグループだけ。画面上で4px以上動いたらドラッグを開始する

import { clientToLogical } from "./board.js";
import { getGroupRect, offsetIntoArea, movePieces } from "./geometry.js";
import { getMovableArea } from "./placement.js";
import { findPieceId } from "./pieceView.js";

// ドラッグ開始とみなす移動量（画面上のpx）
const DRAG_START_DISTANCE = 4;

// viewport：作業エリアの表示領域（イベントを受ける要素）
// getContext()：{ pieces, layout, view } の現在値を返す
// onStart(members)：ドラッグ開始時（最前面化・表示切り替え）
// onMove(members)：位置が変わったとき（表示の更新）
// onEnd(members)：ドラッグ終了時（通常のドロップ・中断とも、1回だけ呼ばれる）
export function createDragController({ viewport, getContext, onStart, onMove, onEnd }) {
  // 操作中の情報。null なら操作していない
  let session = null;

  function toLogical(clientX, clientY) {
    return clientToLogical(getContext().view, viewport.getBoundingClientRect(), clientX, clientY);
  }

  // 最後のポインター位置にグループを動かし、動かせる範囲に収める
  function moveToPointer(current) {
    const { layout, view } = getContext();
    const point = toLogical(current.lastX, current.lastY);
    movePieces(
      current.members,
      point.x - current.grabOffset.x - current.anchor.x,
      point.y - current.grabOffset.y - current.anchor.y,
    );
    const { dx, dy } = offsetIntoArea(getGroupRect(current.members, layout.piecePadding), getMovableArea(view));
    movePieces(current.members, dx, dy);
    onMove(current.members);
  }

  function scheduleMove(current) {
    if (current.frame) return;
    current.frame = requestAnimationFrame(() => {
      current.frame = 0;
      if (session === current) moveToPointer(current);
    });
  }

  function releaseCapture(pointerId) {
    try {
      if (viewport.hasPointerCapture(pointerId)) viewport.releasePointerCapture(pointerId);
    } catch {
      // 捕捉していない場合は何もしない
    }
  }

  // 終了処理。先に session を解除するので、捕捉解除の通知などで再び呼ばれても二重には実行されない
  function finish(applyLastPosition) {
    const ended = session;
    if (!ended) return;
    session = null;
    if (ended.frame) cancelAnimationFrame(ended.frame);
    releaseCapture(ended.pointerId);
    if (!ended.dragging) return;
    if (applyLastPosition) {
      const { layout, view } = getContext();
      if (layout && view) moveToPointer(ended);
    }
    onEnd(ended.members);
  }

  function handlePointerDown(event) {
    if (session) {
      // まだドラッグを始めていない操作が残っている場合（指を離した通知が届かなかった等）は破棄する
      if (session.dragging) return;
      finish(false);
    }
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const { pieces, view } = getContext();
    if (!view) return;
    const pieceId = findPieceId(event.target);
    if (pieceId === null) return;
    const anchor = pieces.find((piece) => piece.id === pieceId);
    if (!anchor || anchor.locked) return;

    event.preventDefault();
    const point = toLogical(event.clientX, event.clientY);
    session = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      anchor,
      grabOffset: { x: point.x - anchor.x, y: point.y - anchor.y },
      members: pieces.filter((piece) => piece.groupId === anchor.groupId),
      dragging: false,
      frame: 0,
    };
    try {
      viewport.setPointerCapture(event.pointerId);
    } catch {
      // 捕捉できない場合（合成イベント等）も操作は続ける
    }
  }

  function handlePointerMove(event) {
    if (!session || event.pointerId !== session.pointerId) return;
    session.lastX = event.clientX;
    session.lastY = event.clientY;
    if (!session.dragging) {
      const distance = Math.hypot(event.clientX - session.startX, event.clientY - session.startY);
      if (distance < DRAG_START_DISTANCE) return;
      session.dragging = true;
      onStart(session.members);
    }
    scheduleMove(session);
  }

  function handlePointerUp(event) {
    if (!session || event.pointerId !== session.pointerId) return;
    session.lastX = event.clientX;
    session.lastY = event.clientY;
    finish(true);
  }

  // 中断（OSのジェスチャー、捕捉の解除など）：最後に分かっている位置で終了する
  function handlePointerCancel(event) {
    if (!session || event.pointerId !== session.pointerId) return;
    finish(true);
  }

  viewport.addEventListener("pointerdown", handlePointerDown);
  viewport.addEventListener("pointermove", handlePointerMove);
  viewport.addEventListener("pointerup", handlePointerUp);
  viewport.addEventListener("pointercancel", handlePointerCancel);
  viewport.addEventListener("lostpointercapture", handlePointerCancel);

  return {
    // ドラッグ中のグループID（ドラッグしていなければ null）
    draggingGroupId() {
      return session && session.dragging ? session.anchor.groupId : null;
    },
    // 表示範囲が変わったとき：ドラッグ中のグループを最後のポインター位置に合わせ直し、範囲に収める
    handleViewChange() {
      if (session && session.dragging) moveToPointer(session);
    },
    // 外部からの中断（拡大表示を開く、パズルを読み込み直す等）
    cancel() {
      finish(true);
    },
  };
}
