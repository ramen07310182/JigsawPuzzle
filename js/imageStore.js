// ユーザーが選んだ画像を、ブラウザ内の IndexedDB に保存する（外部へは送信しない）
// images：画像（加工後のJPEG・サムネイル）。saves：手順12の手動セーブ用（手順10では空のまま作るだけ）
// 開けない・使えない場合は null を返し、呼び出し側は保存しない一時プレイにする

const DB_NAME = "jigsawPuzzle";
const DB_VERSION = 1;
const IMAGES = "images";
const SAVES = "saves";
// ほかのタブに妨げられて開けない（blocked）ときに待つ上限。いつまでも待たないため
const BLOCKED_TIMEOUT_MS = 5000;

// 保存できるユーザー画像の枚数（サンプル画像は含めない）
export const MAX_SAVED_IMAGES = 10;
export const IMAGE_FORMAT_VERSION = 1;

// 画面に出す文言（6歳児向けにひらがな）
export const STORAGE_MESSAGES = {
  limit: "がぞうは 10まいまで ほぞんできるよ。いらない がぞうを けしてね。",
  failed: "がぞうを ほぞん できませんでした。",
  unavailable: "いまは ほぞん できません（よみこみなおすと きえるよ）",
};

export class ImageStoreError extends Error {
  constructor(cause) {
    super(cause?.message ?? String(cause));
    this.name = "ImageStoreError";
    // QuotaExceededError（容量不足）・InvalidStateError（閉じられた）など、元のエラーの種類
    this.cause = cause;
    this.reason = cause?.name ?? "UnknownError";
  }
}

// 手順12の手動セーブのキー（画像の種類＋画像ID＋スロット番号）。画像ごとの検索に imageKey の索引を使う
export function makeImageKey(source, imageId) {
  return `${source}:${imageId}`;
}

function upgrade(db) {
  if (!db.objectStoreNames.contains(IMAGES)) {
    const images = db.createObjectStore(IMAGES, { keyPath: "id" });
    // 同じ画像（加工後JPEGのSHA-256）は1件だけ
    images.createIndex("hash", "hash", { unique: true });
    // 手順11の一覧の並び順に使う
    images.createIndex("createdAt", "createdAt");
    images.createIndex("lastUsedAt", "lastUsedAt");
  }
  if (!db.objectStoreNames.contains(SAVES)) {
    // id は "<種類>:<画像ID>:<スロット番号>"。画像を削除するとき imageKey で関連するセーブを探す
    const saves = db.createObjectStore(SAVES, { keyPath: "id" });
    saves.createIndex("imageKey", "imageKey");
  }
}

// データベースを開く。開けない場合は null（例外は出さない）
// onUnavailable：開いた後に使えなくなった（ほかのタブが版を上げた・ブラウザが閉じた）ときに呼ぶ
export function openImageStore({ indexedDB = globalThis.indexedDB, onUnavailable = () => {}, blockedTimeoutMs = BLOCKED_TIMEOUT_MS } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    let timer = null;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };

    // 同じ画像の判定に使うハッシュ（SHA-256）を計算できない場合も、保存は使わない
    if (!indexedDB || !globalThis.crypto?.subtle?.digest) {
      finish(null);
      return;
    }
    let request;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (error) {
      console.warn("画像の保存先を開けませんでした", error);
      finish(null);
      return;
    }
    request.onupgradeneeded = () => upgrade(request.result);
    request.onerror = () => {
      console.warn("画像の保存先を開けませんでした", request.error);
      finish(null);
    };
    request.onblocked = () => {
      console.warn("画像の保存先を開くのを、ほかのタブが妨げています");
      // 妨げが続く場合は、保存しない一時プレイにする（開けた後に届いた接続は閉じる）
      timer = setTimeout(() => finish(null), blockedTimeoutMs);
    };
    request.onsuccess = () => {
      const db = request.result;
      if (settled) {
        db.close();
        return;
      }
      const store = { db, available: true };
      const lose = () => {
        if (!store.available) return;
        store.available = false;
        try {
          db.close();
        } catch {
          // すでに閉じている
        }
        onUnavailable();
      };
      db.onversionchange = lose;
      db.onclose = lose;
      finish(store);
    };
  });
}

// 保存データをできるだけ消さないようブラウザに求める。結果に関係なくゲームは続ける（永久保存の保証ではない）
export async function requestPersistentStorage(storage = globalThis.navigator?.storage) {
  try {
    if (!storage?.persist) return false;
    return await storage.persist();
  } catch {
    return false;
  }
}

// 1つの読み書きトランザクションを実行し、complete になってから結果を返す（中断・失敗は ImageStoreError）
// body(transaction, setResult, guard)：要求の完了時の処理は guard で包む。処理中の例外（保存できないデータなど）は
// トランザクションを中断し、その例外を失敗の理由として返す（ページの未処理エラーにしない）
function runTransaction(store, storeNames, mode, body) {
  return new Promise((resolve, reject) => {
    if (!store?.available) {
      reject(new ImageStoreError(new DOMException("保存先が使えません", "InvalidStateError")));
      return;
    }
    let transaction;
    let result;
    let failure = null;
    const abortWith = (error) => {
      failure ??= error;
      try {
        transaction?.abort();
      } catch {
        // すでに終わっている
      }
    };
    const guard = (fn) => (...args) => {
      try {
        fn(...args);
      } catch (error) {
        abortWith(error);
      }
    };
    try {
      transaction = store.db.transaction(storeNames, mode);
      transaction.oncomplete = () => resolve(result);
      transaction.onabort = () => reject(new ImageStoreError(failure ?? transaction.error ?? new DOMException("中断されました", "AbortError")));
      transaction.onerror = () => {
        // onabort で失敗として扱う
      };
      body(transaction, (value) => { result = value; }, guard);
    } catch (error) {
      if (!transaction) {
        reject(new ImageStoreError(error));
        return;
      }
      abortWith(error);
    }
  });
}

// 画像を保存する（すでに同じ画像があれば保存しない）。同じ画像の検索・枚数の確認・追加は1つのトランザクションで行うので、
// 複数のタブや連続した操作でも上限を超えない。結果は complete（書き込み完了）になってから返す
//   { status: "existing", record }：同じ画像が保存済み（新しく保存しない。10枚保存済みでも使える）
//   { status: "saved", record }：新しく保存した
//   { status: "limit" }：10枚保存済みなので保存しなかった
// 失敗（容量不足など）は ImageStoreError を投げる
export async function saveUserImage(store, image, { createId, now = Date.now() } = {}) {
  const attempt = () => runTransaction(store, [IMAGES], "readwrite", (transaction, setResult, guard) => {
    const images = transaction.objectStore(IMAGES);
    const found = images.index("hash").get(image.hash);
    found.onsuccess = guard(() => {
      if (found.result) {
        setResult({ status: "existing", record: found.result });
        return;
      }
      const counted = images.count();
      counted.onsuccess = guard(() => {
        if (counted.result >= MAX_SAVED_IMAGES) {
          setResult({ status: "limit" });
          return;
        }
        const record = {
          id: createId(),
          hash: image.hash,
          jpeg: image.jpeg,
          thumbnail: image.thumbnail,
          width: image.width,
          height: image.height,
          createdAt: now,
          lastUsedAt: now,
          formatVersion: IMAGE_FORMAT_VERSION,
        };
        images.add(record);
        setResult({ status: "saved", record });
      });
    });
  });
  try {
    return await attempt();
  } catch (error) {
    // 同じ画像・同じIDが同時に追加された（一意の制約）場合は、もう一度調べ直す（保存済みの画像を使う）
    if (error instanceof ImageStoreError && error.reason === "ConstraintError") return attempt();
    throw error;
  }
}

// 最後に使った日時を更新する（手順11の並び順用）。失敗しても画像の利用には影響させない
export async function touchUserImage(store, id, now = Date.now()) {
  try {
    await runTransaction(store, [IMAGES], "readwrite", (transaction, setResult, guard) => {
      const images = transaction.objectStore(IMAGES);
      const found = images.get(id);
      found.onsuccess = guard(() => {
        if (found.result) images.put({ ...found.result, lastUsedAt: now });
      });
    });
    return true;
  } catch (error) {
    console.warn("画像の使用日時を更新できませんでした", error);
    return false;
  }
}

export function getUserImage(store, id) {
  return runTransaction(store, [IMAGES], "readonly", (transaction, setResult) => {
    const found = transaction.objectStore(IMAGES).get(id);
    found.onsuccess = () => setResult(found.result ?? null);
  });
}

export function countUserImages(store) {
  return runTransaction(store, [IMAGES], "readonly", (transaction, setResult) => {
    const counted = transaction.objectStore(IMAGES).count();
    counted.onsuccess = () => setResult(counted.result);
  });
}

// 保存した画像の一覧（新しく保存した順）。手順11の一覧表示で使う
export function listUserImages(store) {
  return runTransaction(store, [IMAGES], "readonly", (transaction, setResult) => {
    const all = transaction.objectStore(IMAGES).index("createdAt").getAll();
    all.onsuccess = () => setResult(all.result.reverse());
  });
}
