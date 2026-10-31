// ユーザーが端末から選んだ画像を、ブラウザ内だけでパズル用の画像にする（外部へは送信しない）
// 元画像を読み込み、縦横比が2:1を超える場合は中央を切り取り、長辺2048px以下に縮小してJPEGにする

// 元画像のファイルサイズの上限（50MB）
export const MAX_FILE_BYTES = 50 * 1024 * 1024;
// 縮小後の長辺の上限（px）
export const MAX_LONG_SIDE = 2048;
// 長辺÷短辺の上限。これを超える画像は中央を切り取る
export const MAX_ASPECT_RATIO = 2;
// 短辺の下限（px）。これより小さい画像はピースが小さすぎるため使わない
export const MIN_SHORT_SIDE = 200;
// ユーザーが選んだ画像の表示名と、画像の設定としての列数・行数
// （実際に遊ぶピース数は、ピース数のリストボックスで選んだ値を使う。main.js の selectedGrid）
export const USER_PUZZLE_NAME = "えらんだ がぞう";
export const USER_PUZZLE_COLS = 3;
export const USER_PUZZLE_ROWS = 3;

const JPEG_QUALITY = 0.9;
// 保存する画像のサムネイル（手順11の一覧用）：長辺240px以下、JPEG品質0.8
export const THUMBNAIL_LONG_SIDE = 240;
const THUMBNAIL_QUALITY = 0.8;

// 画面に出すエラー（6歳児向けにひらがな）
export const USER_IMAGE_MESSAGES = {
  "too-large": "がぞうが おおきすぎて つかえません。\nちがう がぞうを えらんでね。",
  "too-small": "がぞうが ちいさすぎて つかえません。\nちがう がぞうを えらんでね。",
  unsupported: "この がぞうは つかえません。\nちがう がぞうを えらんでね。",
};

export class UserImageError extends Error {
  constructor(code, detail) {
    super(detail ?? code);
    this.name = "UserImageError";
    this.code = code;
  }
}

export function getUserImageMessage(error) {
  return USER_IMAGE_MESSAGES[error?.code] ?? USER_IMAGE_MESSAGES.unsupported;
}

// 元画像の大きさから、切り取る範囲（元画像のpx）と縮小後の大きさを求める
export function computeImageCrop(width, height) {
  let sw = width;
  let sh = height;
  if (sw / sh > MAX_ASPECT_RATIO) sw = Math.round(sh * MAX_ASPECT_RATIO);
  if (sh / sw > MAX_ASPECT_RATIO) sh = Math.round(sw * MAX_ASPECT_RATIO);
  const sx = Math.floor((width - sw) / 2);
  const sy = Math.floor((height - sh) / 2);
  const scale = Math.min(1, MAX_LONG_SIDE / Math.max(sw, sh));
  return {
    sx,
    sy,
    sw,
    sh,
    width: Math.max(1, Math.round(sw * scale)),
    height: Math.max(1, Math.round(sh * scale)),
  };
}

function decodeImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new UserImageError("unsupported", "画像として読み込めませんでした"));
    image.src = url;
  });
}

function canvasToBlob(canvas, quality = JPEG_QUALITY) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new UserImageError("unsupported", "画像を変換できませんでした"));
    }, "image/jpeg", quality);
  });
}

// サムネイルの大きさ（長辺240px以下。小さい画像は拡大しない）
export function computeThumbnailSize(width, height) {
  const scale = Math.min(1, THUMBNAIL_LONG_SIDE / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

// 加工後のJPEGデータの SHA-256（16進数）。同じ画像の判定に使う（ファイル名は使わない）
// 計算できない環境では null（その場合は保存を使わない）
export async function computeImageHash(blob) {
  try {
    if (!globalThis.crypto?.subtle?.digest) return null;
    const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  } catch (error) {
    console.warn("画像のハッシュを計算できませんでした", error);
    return null;
  }
}

// 選んだファイルから、パズル用の画像（加工後のJPEG Blob）とサムネイル・ハッシュを作る。失敗したら UserImageError を投げる
// 戻り値：{ blob, thumbnail, width, height, hash }。表示用の Object URL は呼び出し側で作り、不要になったら解放する
export async function prepareUserImage(file) {
  if (!file) throw new UserImageError("unsupported", "ファイルがありません");
  if (file.size > MAX_FILE_BYTES) throw new UserImageError("too-large", `${file.size} バイト`);
  // 種類が分かっていて画像でないものは読み込まない（種類が空の場合は、実際に読み込めるかで判断する）
  if (file.type && !file.type.startsWith("image/")) throw new UserImageError("unsupported", file.type);

  const sourceUrl = URL.createObjectURL(file);
  try {
    // 写真の向き（EXIF）は、ブラウザが読み込み時に反映する
    const image = await decodeImage(sourceUrl);
    const { naturalWidth: width, naturalHeight: height } = image;
    if (!width || !height) throw new UserImageError("unsupported", "大きさが分かりません");
    if (Math.min(width, height) < MIN_SHORT_SIDE) throw new UserImageError("too-small", `${width}x${height}`);

    const crop = computeImageCrop(width, height);
    const canvas = document.createElement("canvas");
    canvas.width = crop.width;
    canvas.height = crop.height;
    const context = canvas.getContext("2d");
    if (!context) throw new UserImageError("unsupported", "キャンバスを使えません");
    // 透明部分は白にする（JPEGには透明がないため）
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, crop.width, crop.height);
    context.drawImage(image, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, crop.width, crop.height);
    const blob = await canvasToBlob(canvas);
    // サムネイルは加工後の画像から作る（長辺240px以下、JPEG品質0.8）
    const thumbSize = computeThumbnailSize(crop.width, crop.height);
    const thumbCanvas = document.createElement("canvas");
    thumbCanvas.width = thumbSize.width;
    thumbCanvas.height = thumbSize.height;
    const thumbContext = thumbCanvas.getContext("2d");
    if (!thumbContext) throw new UserImageError("unsupported", "キャンバスを使えません");
    thumbContext.imageSmoothingQuality = "high";
    thumbContext.drawImage(canvas, 0, 0, thumbSize.width, thumbSize.height);
    const thumbnail = await canvasToBlob(thumbCanvas, THUMBNAIL_QUALITY);
    // iPad のメモリを早めに空ける
    canvas.width = 0;
    canvas.height = 0;
    thumbCanvas.width = 0;
    thumbCanvas.height = 0;
    const hash = await computeImageHash(blob);
    return { blob, thumbnail, width: crop.width, height: crop.height, hash };
  } catch (error) {
    if (error instanceof UserImageError) throw error;
    throw new UserImageError("unsupported", String(error));
  } finally {
    URL.revokeObjectURL(sourceUrl);
  }
}

// ブラウザ内で画像IDを作る。開発者の画像のIDと重ならないよう "user-" を付ける
export function createUserImageId() {
  try {
    if (crypto?.randomUUID) return `user-${crypto.randomUUID()}`;
  } catch {
    // 使えない場合は下の方法で作る
  }
  return `user-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// 選んだ画像のパズル設定（開発者の画像の設定と同じ形）
// id：保存した画像はその画像ID（変えない）。保存しない一時プレイでは新しく作る
// hash：加工後JPEGのハッシュ（今遊んでいる画像と同じ画像かの判定に使う）。stored：IndexedDB に保存済みか
export function createUserPuzzle(url, { id = createUserImageId(), hash = null, stored = false } = {}) {
  return {
    source: "user",
    id,
    name: USER_PUZZLE_NAME,
    image: url,
    cols: USER_PUZZLE_COLS,
    rows: USER_PUZZLE_ROWS,
    hash,
    stored,
  };
}
