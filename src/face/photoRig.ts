import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import { LANDMARK_COUNT } from './landmarks';
import { buildRig, type FaceRig } from './rig';

const base = import.meta.env.BASE_URL.replace(/\/$/, '');
const CACHE_PREFIX = 'interview-coach:rig:';

/** 정지 사진용 랜드마커. 세션의 VIDEO 모드 인스턴스와 별개로 필요할 때만 띄우고 곧 닫는다. */
let imageLandmarker: Promise<FaceLandmarker> | null = null;
let idleTimer = 0;

async function getImageLandmarker(): Promise<FaceLandmarker> {
  window.clearTimeout(idleTimer);
  if (!imageLandmarker) {
    imageLandmarker = (async () => {
      const fileset = await FilesetResolver.forVisionTasks(`${base}/mediapipe/wasm`);
      return FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: `${base}/mediapipe/models/face_landmarker.task`, delegate: 'GPU' },
        runningMode: 'IMAGE',
        numFaces: 1,
        outputFaceBlendshapes: false,
        outputFacialTransformationMatrixes: false,
      });
    })().catch((err) => {
      imageLandmarker = null;
      throw err;
    });
  }
  return imageLandmarker;
}

function releaseSoon() {
  window.clearTimeout(idleTimer);
  idleTimer = window.setTimeout(() => {
    const p = imageLandmarker;
    imageLandmarker = null;
    void p?.then((lm) => lm.close()).catch(() => undefined);
  }, 8000);
}

interface CachedRig {
  w: number;
  h: number;
  /** 468 x 3, 정규화 좌표를 1e-4 단위 정수로 */
  lm: number[];
}

function readCache(key: string): CachedRig | null {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedRig;
    return parsed.lm?.length === LANDMARK_COUNT * 3 ? parsed : null;
  } catch {
    return null;
  }
}

function writeCache(key: string, value: CachedRig) {
  try {
    localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(value));
  } catch {
    /* 용량 초과 등은 무시 — 다음에 다시 계산하면 된다 */
  }
}

const inflight = new Map<string, Promise<FaceRig | null>>();

/**
 * 사진에서 얼굴 리그를 만든다. 얼굴을 못 찾으면 null.
 * 같은 사진은 localStorage 에 랜드마크를 저장해 두 번째부터는 모델을 띄우지 않는다.
 */
export function getPhotoRig(image: HTMLImageElement, cacheKey: string): Promise<FaceRig | null> {
  const w = image.naturalWidth;
  const h = image.naturalHeight;
  const key = `${cacheKey}:${w}x${h}`;

  const cached = readCache(key);
  if (cached) {
    const pts = [];
    for (let i = 0; i < LANDMARK_COUNT; i++) {
      pts.push({ x: cached.lm[i * 3] / 1e4, y: cached.lm[i * 3 + 1] / 1e4, z: cached.lm[i * 3 + 2] / 1e4 });
    }
    return Promise.resolve(buildRig(pts, w, h));
  }

  const existing = inflight.get(key);
  if (existing) return existing;

  const task = (async () => {
    try {
      const lm = await getImageLandmarker();
      const result = lm.detect(image);
      const face = result.faceLandmarks?.[0];
      if (!face || face.length < LANDMARK_COUNT) return null;
      const compact: number[] = [];
      for (let i = 0; i < LANDMARK_COUNT; i++) {
        compact.push(Math.round(face[i].x * 1e4), Math.round(face[i].y * 1e4), Math.round(face[i].z * 1e4));
      }
      writeCache(key, { w, h, lm: compact });
      return buildRig(face, w, h);
    } catch (err) {
      console.warn('[photoRig] 얼굴 인식 실패', err);
      return null;
    } finally {
      releaseSoon();
      inflight.delete(key);
    }
  })();
  inflight.set(key, task);
  return task;
}

/** 이미지를 로드한다. 실패하면 null. */
export function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}
