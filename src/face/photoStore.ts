/**
 * 면접관 사진 관리.
 * 기본은 public/interviewers/{id}.jpg, 사용자가 올린 사진은 localStorage 에 dataURL 로 보관한다.
 */

const base = import.meta.env.BASE_URL.replace(/\/$/, '');
const PREFIX = 'interview-coach:photo:';
const MAX_SIDE = 1024;

export interface PhotoSource {
  src: string;
  /** 리그 캐시 키 (사진이 바뀌면 달라진다) */
  key: string;
  custom: boolean;
}

/** 짧은 해시 — 캐시 키용 */
function hash(s: string): string {
  let h = 5381;
  const step = Math.max(1, Math.floor(s.length / 4096));
  for (let i = 0; i < s.length; i += step) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36) + s.length.toString(36);
}

export function getPhotoSource(id: string): PhotoSource {
  try {
    const custom = localStorage.getItem(PREFIX + id);
    if (custom) return { src: custom, key: `custom-${id}-${hash(custom)}`, custom: true };
  } catch {
    /* localStorage 접근 불가 */
  }
  return { src: `${base}/interviewers/${id}.jpg`, key: `default-${id}`, custom: false };
}

export function hasCustomPhoto(id: string): boolean {
  try {
    return localStorage.getItem(PREFIX + id) !== null;
  } catch {
    return false;
  }
}

export function clearCustomPhoto(id: string) {
  try {
    localStorage.removeItem(PREFIX + id);
  } catch {
    /* noop */
  }
}

/** 파일을 1024px 이하 JPEG 로 줄여 저장하고 dataURL 을 돌려준다 */
export async function saveCustomPhoto(id: string, file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 를 만들 수 없습니다.');
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  const dataUrl = canvas.toDataURL('image/jpeg', 0.88);
  try {
    localStorage.setItem(PREFIX + id, dataUrl);
  } catch {
    throw new Error('저장 공간이 부족합니다. 더 작은 사진을 써 주세요.');
  }
  return dataUrl;
}

/** 사진 변경을 화면에 알리기 위한 간단한 이벤트 */
export const PHOTO_CHANGED = 'interview-coach:photo-changed';
export function notifyPhotoChanged(id: string) {
  window.dispatchEvent(new CustomEvent(PHOTO_CHANGED, { detail: id }));
}
