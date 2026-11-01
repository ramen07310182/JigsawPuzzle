// 仕様変更（2026-11-01）にともなう移行処理：以前の版（手順10）が IndexedDB に保存した画像を削除する
// 削除するのは "jigsawPuzzle" データベースだけ。localStorage の設定（効果音・おてほん）は消さない
// 削除が終わったら localStorage に印を付け、次からは何もしない（失敗・未完了なら印を付けず、次の起動でもう一度試す）
// どの場合も例外は出さず、ゲームの起動を止めない

export const LEGACY_DB_NAME = "jigsawPuzzle";
const DONE_KEY = "jigsawPuzzle.legacyImageDbRemoved";
// ほかのタブが古いデータベースを開いたまま（blocked）のときに待つ上限
const BLOCKED_TIMEOUT_MS = 5000;

function getStorage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function isDone(storage) {
  try {
    return storage?.getItem(DONE_KEY) === "1";
  } catch {
    return false;
  }
}

function markDone(storage) {
  try {
    storage?.setItem(DONE_KEY, "1");
  } catch {
    // 印を付けられなくても、次の起動でもう一度試すだけ
  }
}

// データベースがあるか（調べられない場合は null）
async function exists(indexedDB) {
  try {
    if (typeof indexedDB.databases !== "function") return null;
    const list = await indexedDB.databases();
    return list.some((entry) => entry.name === LEGACY_DB_NAME);
  } catch {
    return null;
  }
}

function deleteDatabase(indexedDB, blockedTimeoutMs) {
  return new Promise((resolve) => {
    let timer = null;
    const finish = (status) => {
      clearTimeout(timer);
      resolve(status);
    };
    let request;
    try {
      request = indexedDB.deleteDatabase(LEGACY_DB_NAME);
    } catch {
      finish("failed");
      return;
    }
    request.onsuccess = () => finish("deleted");
    request.onerror = () => finish("failed");
    // ほかのタブが開いたままのときは待つ。待ちきれなければ「未完了」（後で削除される場合もあるが、成功とは扱わない）
    request.onblocked = () => {
      timer = setTimeout(() => finish("blocked"), blockedTimeoutMs);
    };
  });
}

// 戻り値："skipped"（前に完了済み）・"absent"（もともとない）・"deleted"（削除した）・"blocked"（未完了）・"failed"（失敗）・"unsupported"（IndexedDBがない）
export async function removeLegacyImageDatabase({
  indexedDB = globalThis.indexedDB,
  storage = getStorage(),
  blockedTimeoutMs = BLOCKED_TIMEOUT_MS,
} = {}) {
  try {
    if (isDone(storage)) return "skipped";
    if (!indexedDB) return "unsupported";
    const found = await exists(indexedDB);
    if (found === false) {
      markDone(storage);
      return "absent";
    }
    const status = await deleteDatabase(indexedDB, blockedTimeoutMs);
    if (status === "deleted") markDone(storage);
    else console.warn(`以前に保存した画像のデータを削除できませんでした（${status}）。次の起動でもう一度試します`);
    return status;
  } catch {
    return "failed";
  }
}
