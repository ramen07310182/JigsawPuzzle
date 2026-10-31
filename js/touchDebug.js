// タッチ操作の診断表示（URL に ?debug=1 を付けたときだけ main.js から読み込む）
// iPad Safari のダブルタップズームの原因を調べるため、タッチ・ポインター・dblclick イベントを記録して画面の隅に表示する
// 記録はテキストでコピーできる（「診断ログをコピー」、失敗したときは手動コピー用の表示から選択してコピー）
// 診断用のイベント処理はすべて passive で登録し、イベントを打ち消さない（既存の動作を変えない）
//
// 既存のダブルタップガード（doubleTapGuard.js、作業エリアで登録）の前後で defaultPrevented を記録する：
//   前：window のキャプチャー段階（ガードより先に実行される）
//   後：document のバブリング段階（ガードより後に実行される）
// ガードの内部判定（タップとして記録したか等）は観測できないので表示しない

// 画面のパネルに表示する件数
const VISIBLE_ENTRIES = 20;
// コピー用に保持する件数
const STORED_ENTRIES = 500;

function formatTime(ms) {
  const date = new Date(performance.timeOrigin + ms);
  const pad = (value, length = 2) => String(value).padStart(length, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
}

function yesNo(value) {
  return value ? "Y" : "N";
}

function describeTarget(target) {
  if (!(target instanceof Element)) return "-";
  if (target.id) return `#${target.id}`;
  const className = target.getAttribute("class");
  return className ? `.${className.split(" ")[0]}` : target.tagName.toLowerCase();
}

const BOX_STYLE = {
  position: "fixed",
  zIndex: "2147483647",
  margin: "0",
  background: "rgba(0, 0, 0, 0.78)",
  color: "#fff",
  font: "11px/1.35 ui-monospace, Menlo, Consolas, monospace",
  borderRadius: "4px",
  webkitTextSizeAdjust: "none",
};

function createButton(label) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  Object.assign(button.style, {
    font: "12px/1.2 system-ui, sans-serif",
    padding: "6px 10px",
    margin: "0",
    border: "1px solid #888",
    borderRadius: "4px",
    background: "#333",
    color: "#fff",
  });
  return button;
}

// ログの表示（タッチやクリックを受け取らない。下の操作を妨げない）
function createLogPanel() {
  const panel = document.createElement("pre");
  panel.setAttribute("aria-hidden", "true");
  Object.assign(panel.style, BOX_STYLE, {
    left: "4px",
    bottom: "4px",
    padding: "6px 8px",
    maxWidth: "min(96vw, 760px)",
    maxHeight: "50vh",
    overflow: "hidden",
    whiteSpace: "pre-wrap",
    wordBreak: "break-all",
    pointerEvents: "none",
    userSelect: "none",
    webkitUserSelect: "none",
  });
  document.body.append(panel);
  return panel;
}

// 操作ボタン。作業エリアを覆わないよう、操作パネル（#panel）の中に置く（なければ画面の左上に固定）
function createControls() {
  const box = document.createElement("div");
  const panel = document.getElementById("panel");
  Object.assign(box.style, {
    background: "rgba(0, 0, 0, 0.78)",
    color: "#fff",
    borderRadius: "4px",
    padding: "6px",
    display: "flex",
    flexWrap: "wrap",
    gap: "6px",
    alignItems: "center",
    pointerEvents: "auto",
  });
  if (panel) {
    panel.append(box);
  } else {
    Object.assign(box.style, { position: "fixed", left: "4px", top: "4px", zIndex: "2147483647" });
    document.body.append(box);
  }
  const copyButton = createButton("診断ログをコピー");
  const showButton = createButton("ログを表示（手動コピー用）");
  const status = document.createElement("span");
  Object.assign(status.style, { font: "12px/1.2 system-ui, sans-serif" });
  box.append(copyButton, showButton, status);
  return { box, copyButton, showButton, status };
}

// 手動コピー用の表示（読み取り専用のテキスト欄。長押しで選択してコピーできる）
function createManualView() {
  const overlay = document.createElement("div");
  Object.assign(overlay.style, BOX_STYLE, {
    inset: "8px",
    padding: "8px",
    display: "none",
    flexDirection: "column",
    gap: "6px",
    background: "rgba(0, 0, 0, 0.9)",
    pointerEvents: "auto",
  });
  const message = document.createElement("div");
  Object.assign(message.style, { font: "13px/1.4 system-ui, sans-serif" });
  const buttons = document.createElement("div");
  const selectAllButton = createButton("全選択");
  const closeButton = createButton("閉じる");
  buttons.append(selectAllButton, closeButton);
  const textarea = document.createElement("textarea");
  textarea.readOnly = true;
  textarea.setAttribute("aria-label", "診断ログ");
  Object.assign(textarea.style, {
    flex: "1",
    width: "100%",
    minHeight: "0",
    font: "11px/1.35 ui-monospace, Menlo, Consolas, monospace",
    color: "#000",
    background: "#fff",
    userSelect: "text",
    webkitUserSelect: "text",
  });
  overlay.append(message, buttons, textarea);
  document.body.append(overlay);
  return { overlay, message, selectAllButton, closeButton, textarea };
}

function selectAll(textarea) {
  textarea.focus();
  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);
}

export function startTouchDebug(viewport) {
  const panel = createLogPanel();
  const controls = createControls();
  const manual = createManualView();
  const header = [];
  const entries = [];
  // タッチの開始位置（識別子ごと）
  const touchStarts = new Map();
  // 直前の1本指の touchend の時刻（参考値。ガードの内部状態ではない）
  let lastSingleTouchEnd = null;
  // ガード処理前の defaultPrevented（イベントごと）
  const beforeState = new WeakMap();

  const scale = () => (window.visualViewport ? window.visualViewport.scale.toFixed(2) : "?");
  const fullLog = () => [...header, ...entries].join("\n");
  const render = () => {
    panel.textContent = [...header, ...entries.slice(-VISIBLE_ENTRIES)].join("\n");
    if (manual.overlay.style.display !== "none") manual.textarea.value = fullLog();
  };
  const add = (line) => {
    entries.push(line);
    if (entries.length > STORED_ENTRIES) entries.shift();
    render();
  };

  const isMacUserAgent = /Macintosh/.test(navigator.userAgent);
  header.push(
    "[touchDebug] 初期化しました",
    `URL: ${location.href}`,
    `UA: ${navigator.userAgent}`,
    `UAにMacintoshを含む=${yesNo(isMacUserAgent)} maxTouchPoints=${navigator.maxTouchPoints} 拡大率=${scale()}`,
    "前/後=ガード処理前後のdefaultPrevented  c=cancelable  t=touches  ct=changedTouches",
    "※ガードの内部判定（タップとして記録したか）は未観測。defaultPreventedはズームが止まったことの保証ではない",
    "----",
  );
  render();

  // 手動コピー用の表示
  const openManual = (text) => {
    manual.message.textContent = text;
    manual.textarea.value = fullLog();
    manual.overlay.style.display = "flex";
    selectAll(manual.textarea);
  };
  controls.showButton.addEventListener("click", () => openManual("下のテキストを長押しして選択し、コピーしてください。"));
  manual.selectAllButton.addEventListener("click", () => selectAll(manual.textarea));
  manual.closeButton.addEventListener("click", () => {
    manual.overlay.style.display = "none";
  });

  // 「診断ログをコピー」：クリップボードAPI → テキスト欄を選択して copy コマンド → 手動コピー用の表示
  const copyWithCommand = (text) => {
    const temp = document.createElement("textarea");
    temp.value = text;
    temp.readOnly = true;
    Object.assign(temp.style, { position: "fixed", left: "0", top: "0", opacity: "0", pointerEvents: "none" });
    document.body.append(temp);
    selectAll(temp);
    let copied = false;
    try {
      copied = document.execCommand("copy");
    } catch {
      copied = false;
    }
    temp.remove();
    return copied;
  };
  controls.copyButton.addEventListener("click", async () => {
    const text = fullLog();
    const lineCount = text.split("\n").length;
    try {
      if (!navigator.clipboard || !navigator.clipboard.writeText) throw new Error("クリップボードAPIが使えません");
      await navigator.clipboard.writeText(text);
      controls.status.textContent = `コピーしました（${lineCount}行）`;
      return;
    } catch {
      // 次の方法を試す
    }
    if (copyWithCommand(text)) {
      controls.status.textContent = `コピーしました（${lineCount}行・代替方法）`;
      return;
    }
    controls.status.textContent = "コピーできませんでした";
    openManual("自動でコピーできませんでした。下のテキストを長押しして選択し、コピーしてください。");
  });

  const inViewport = (event) => event.target instanceof Node && viewport.contains(event.target);

  // ガードより前（window のキャプチャー段階）
  for (const type of ["touchstart", "touchend", "touchcancel"]) {
    window.addEventListener(type, (event) => {
      beforeState.set(event, event.defaultPrevented);
      if (type === "touchstart") {
        for (const touch of event.changedTouches) {
          touchStarts.set(touch.identifier, { x: touch.clientX, y: touch.clientY });
        }
      }
    }, { capture: true, passive: true });
  }

  // ガードより後（document のバブリング段階）
  for (const type of ["touchstart", "touchend", "touchcancel"]) {
    document.addEventListener(type, (event) => {
      const parts = [
        formatTime(event.timeStamp),
        type.padEnd(11),
        `c=${yesNo(event.cancelable)}`,
        `前=${yesNo(beforeState.get(event))}`,
        `後=${yesNo(event.defaultPrevented)}`,
        `t=${event.touches.length}`,
        `ct=${event.changedTouches.length}`,
      ];
      if (type !== "touchstart") {
        const touch = event.changedTouches[0];
        const start = touch ? touchStarts.get(touch.identifier) : null;
        parts.push(start ? `移動=${Math.hypot(touch.clientX - start.x, touch.clientY - start.y).toFixed(1)}px` : "移動=?");
        for (const changed of event.changedTouches) touchStarts.delete(changed.identifier);
      }
      if (type === "touchend" && event.touches.length === 0 && event.changedTouches.length === 1) {
        parts.push(`前回からの間隔=${lastSingleTouchEnd === null ? "-" : `${Math.round(event.timeStamp - lastSingleTouchEnd)}ms`}`);
        lastSingleTouchEnd = event.timeStamp;
      }
      if (type === "touchend" && !event.cancelable) {
        parts.push("打ち消し不可（ガードが呼んだかは判別不可）");
      }
      parts.push(`作業エリア内=${yesNo(inViewport(event))}`, `対象=${describeTarget(event.target)}`, `拡大率=${scale()}`);
      add(parts.join(" "));
    }, { passive: true });
  }

  // ポインターと dblclick（記録のみ）
  for (const type of ["pointerdown", "pointerup", "pointercancel", "dblclick"]) {
    window.addEventListener(type, (event) => {
      const parts = [formatTime(event.timeStamp), type.padEnd(11)];
      if (type !== "dblclick") parts.push(`種類=${event.pointerType}`, `id=${event.pointerId}`);
      parts.push(`作業エリア内=${yesNo(inViewport(event))}`, `対象=${describeTarget(event.target)}`, `拡大率=${scale()}`);
      add(parts.join(" "));
    }, { capture: true, passive: true });
  }

  // 拡大率の変化（ズームが起きたか）
  if (window.visualViewport) {
    let lastScale = scale();
    window.visualViewport.addEventListener("resize", () => {
      const current = scale();
      if (current !== lastScale) {
        add(`${formatTime(performance.now())} 拡大率が変化 ${lastScale} → ${current}`);
        lastScale = current;
      }
    }, { passive: true });
  }
}
