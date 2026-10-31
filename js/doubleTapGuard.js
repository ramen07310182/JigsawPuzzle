// 作業エリアの中で、素早い2回目のタップによるSafariのダブルタップズームを打ち消す
// CSS の touch-action だけでは止まらない環境（iPad Safari で確認）向け。ページ全体のズームは禁止しない
// ドラッグは Pointer Events（drag.js）で処理している。Safari は pointerup を touchend より先に送るので、
// ここで touchend を打ち消してもドラッグの処理には影響しない

// 2回目のタップとみなす間隔（ms）
const DOUBLE_TAP_INTERVAL = 350;
// タップとみなす移動量の上限（画面上のpx）。drag.js のドラッグ開始判定（4px）と同じ値にし、
// ドラッグとして扱われた操作はタップに数えない
const TAP_MOVE_LIMIT = 4;

export function preventDoubleTapZoom(element) {
  // 直前のタップが終わった時刻
  let lastTapEnd = -Infinity;
  // 1本指の操作の開始位置（2本以上の指が関わる操作なら null）
  let start = null;

  const reset = () => {
    start = null;
    lastTapEnd = -Infinity;
  };

  element.addEventListener("touchstart", (event) => {
    if (event.touches.length === 1) {
      const touch = event.touches[0];
      start = { id: touch.identifier, x: touch.clientX, y: touch.clientY };
    } else {
      // 2本目の指が置かれた（ピンチなど）：タップに数えない
      reset();
    }
  }, { passive: true });

  element.addEventListener("touchend", (event) => {
    const touch = event.changedTouches[0];
    const isTap = start !== null
      && event.touches.length === 0
      && event.changedTouches.length === 1
      && touch.identifier === start.id
      && Math.hypot(touch.clientX - start.x, touch.clientY - start.y) < TAP_MOVE_LIMIT;
    start = null;
    if (!isTap) {
      // ドラッグや複数本指の操作の後は、次のタップを1回目として扱う
      lastTapEnd = -Infinity;
      return;
    }
    if (event.timeStamp - lastTapEnd < DOUBLE_TAP_INTERVAL) {
      // 2回目のタップ：ダブルタップズームを打ち消す。3回目は新しい1回目として扱う
      event.preventDefault();
      lastTapEnd = -Infinity;
      return;
    }
    lastTapEnd = event.timeStamp;
  }, { passive: false });

  element.addEventListener("touchcancel", reset, { passive: true });
}
