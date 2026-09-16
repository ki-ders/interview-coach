import { LANDMARK_COUNT, LM } from './landmarks';

/**
 * 사진 한 장에서 뽑은 얼굴 리그.
 * 정점 좌표는 사진 픽셀 단위. z 는 x 와 같은 스케일(픽셀)로 환산되어 있다.
 */
export interface FaceRig {
  width: number;
  height: number;
  /** 468 x 3, 픽셀 단위 (원본, 변형 전) */
  pts: Float32Array;
  /** 468 x 2, 0~1 텍스처 좌표 */
  uv: Float32Array;
  center: { x: number; y: number; z: number };
  faceW: number;
  faceH: number;
  /** 머리 회전을 얼굴 가장자리에서 0으로 줄이는 가중치 (이음새 방지) */
  ovalWeight: Float32Array;
  /** 턱 벌림 가중치 (아랫입술·턱 1, 윗입술 0, 볼은 거리에 따라) */
  jawWeight: Float32Array;
  /** 눈 깜빡임: [upperIdx, lowerIdx, weight] 묶음 */
  blinkPairs: { upper: number; lower: number; w: number; eye: 'l' | 'r' }[];
}

export interface DeformParams {
  /** 0~1 턱 벌림 */
  jaw: number;
  /** 0~1 눈 감음 (양쪽) */
  blinkL: number;
  blinkR: number;
  /** -1~1 눈썹 (양수 = 올림) */
  brow: number;
  /** -1~1 미간 찌푸림 (양수 = 찌푸림) */
  frown: number;
  /** 0~1 입꼬리 올림 */
  smile: number;
  /** 라디안. yaw: 좌우 회전, pitch: 끄덕임(양수 = 아래), roll: 갸웃 */
  yaw: number;
  pitch: number;
  roll: number;
}

export const NEUTRAL: DeformParams = {
  jaw: 0,
  blinkL: 0,
  blinkR: 0,
  brow: 0,
  frown: 0,
  smile: 0,
  yaw: 0,
  pitch: 0,
  roll: 0,
};

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
};

/**
 * MediaPipe 정규화 랜드마크(x,y,z ∈ 대략 0~1, z 는 x 스케일)를 리그로 만든다.
 * @param normalized 468개 이상의 {x,y,z}
 */
export function buildRig(
  normalized: { x: number; y: number; z: number }[],
  width: number,
  height: number,
): FaceRig {
  const n = LANDMARK_COUNT;
  const pts = new Float32Array(n * 3);
  const uv = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    const p = normalized[i];
    pts[i * 3] = p.x * width;
    pts[i * 3 + 1] = p.y * height;
    pts[i * 3 + 2] = p.z * width;
    uv[i * 2] = p.x;
    uv[i * 2 + 1] = p.y;
  }

  // 얼굴 타원 범위
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  let cz = 0;
  for (const i of LM.faceOval) {
    const x = pts[i * 3], y = pts[i * 3 + 1];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  for (let i = 0; i < n; i++) cz += pts[i * 3 + 2];
  cz /= n;
  const center = { x: (minX + maxX) / 2, y: (minY + maxY) / 2, z: cz };
  const faceW = maxX - minX;
  const faceH = maxY - minY;
  const rx = faceW / 2;
  const ry = faceH / 2;

  // 회전 블렌딩 가중치: 중심 1 → 타원 가장자리 0
  const ovalWeight = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const dx = (pts[i * 3] - center.x) / rx;
    const dy = (pts[i * 3 + 1] - center.y) / ry;
    const r = Math.sqrt(dx * dx + dy * dy);
    ovalWeight[i] = 1 - smoothstep(0.6, 1.0, r);
  }

  // 턱 벌림 가중치
  const seamY = (pts[LM.upperLipCenter * 3 + 1] + pts[LM.lowerLipCenter * 3 + 1]) / 2;
  const mouthCx = (pts[LM.mouthLeft * 3] + pts[LM.mouthRight * 3]) / 2;
  const mouthHalfW = Math.abs(pts[LM.mouthLeft * 3] - pts[LM.mouthRight * 3]) / 2;
  const jawWeight = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = pts[i * 3], y = pts[i * 3 + 1];
    // 입 봉합선 바로 아래부터 1, 위는 0
    const fy = smoothstep(seamY - faceH * 0.004, seamY + faceH * 0.03, y);
    // 입 너비의 1.3배 안쪽은 1, 턱선 끝으로 갈수록 0.25까지
    const fx = 1 - 0.75 * smoothstep(mouthHalfW * 1.3, rx * 1.05, Math.abs(x - mouthCx));
    jawWeight[i] = fy * fx;
  }
  for (const i of LM.upperLipOuter) jawWeight[i] = 0;
  for (const i of LM.upperLipInner) jawWeight[i] = 0;
  for (const i of LM.lowerLipOuter) jawWeight[i] = 1;
  for (const i of LM.lowerLipInner) jawWeight[i] = 1;
  for (const i of LM.mouthCorners) jawWeight[i] = 0.35;

  const blinkPairs: FaceRig['blinkPairs'] = [];
  const addEye = (eye: 'l' | 'r', spec: { upper: readonly number[]; lower: readonly number[]; lidFold: readonly number[] }) => {
    // 양 끝(눈꼬리)은 고정
    for (let k = 1; k < spec.upper.length - 1; k++) {
      blinkPairs.push({ upper: spec.upper[k], lower: spec.lower[k], w: 1, eye });
    }
    for (let k = 0; k < spec.lidFold.length; k++) {
      // 눈꺼풀 주름 줄은 아래 짝(같은 열의 윗눈꺼풀)의 35% 만큼 따라온다
      blinkPairs.push({ upper: spec.lidFold[k], lower: spec.lower[k + 1], w: 0.35, eye });
    }
  };
  addEye('r', LM.rightEye);
  addEye('l', LM.leftEye);

  return { width, height, pts, uv, center, faceW, faceH, ovalWeight, jawWeight, blinkPairs };
}

/**
 * 파라미터에 맞게 정점을 움직인다. 결과는 468 x 2 픽셀 좌표.
 */
export function deform(rig: FaceRig, p: DeformParams, out: Float32Array): Float32Array {
  const n = LANDMARK_COUNT;
  const { pts, center, faceH, faceW, ovalWeight, jawWeight } = rig;

  const cy = Math.cos(p.yaw), sy = Math.sin(p.yaw);
  const cp = Math.cos(p.pitch), sp = Math.sin(p.pitch);
  const cr = Math.cos(p.roll), sr = Math.sin(p.roll);

  // 사진에서 나온 z 는 얕아서 회전이 잘 안 보인다. 깊이를 키우고, 회전 방향으로
  // 얼굴 안쪽 특징이 미끄러지는 시차를 더해 2.5D 느낌을 강조한다.
  const slideX = Math.sin(p.yaw) * faceW * 0.16;
  const slideY = Math.sin(p.pitch) * faceH * 0.2;

  // 1) 머리 회전 (얼굴 가장자리로 갈수록 약하게)
  for (let i = 0; i < n; i++) {
    const x0 = pts[i * 3] - center.x;
    const y0 = pts[i * 3 + 1] - center.y;
    const z0 = (pts[i * 3 + 2] - center.z) * 2.2;

    // yaw (세로축)
    let x = x0 * cy + z0 * sy;
    let z = -x0 * sy + z0 * cy;
    // pitch (가로축): 양수면 얼굴이 아래로
    let y = y0 * cp - z * sp;
    z = y0 * sp + z * cp;
    // roll (화면 축)
    const xr = x * cr - y * sr;
    const yr = x * sr + y * cr;
    x = xr;
    y = yr;

    const w = ovalWeight[i];
    out[i * 2] = pts[i * 3] + (x - x0 + slideX) * w;
    out[i * 2 + 1] = pts[i * 3 + 1] + (y - y0 + slideY) * w;
  }

  // 2) 턱 벌림
  if (p.jaw > 0) {
    const drop = p.jaw * faceH * 0.06;
    for (let i = 0; i < n; i++) {
      const w = jawWeight[i];
      if (w > 0) out[i * 2 + 1] += drop * w;
    }
    // 입꼬리는 살짝 안쪽으로
    const pull = p.jaw * faceW * 0.012;
    out[LM.mouthRight * 2] += pull;
    out[LM.mouthLeft * 2] -= pull;
  }

  // 3) 미소: 입꼬리를 올리고 바깥으로
  if (p.smile > 0) {
    const up = p.smile * faceH * 0.02;
    const outward = p.smile * faceW * 0.015;
    for (const i of [LM.mouthRight, 78]) {
      out[i * 2 + 1] -= up;
      out[i * 2] -= outward;
    }
    for (const i of [LM.mouthLeft, 308]) {
      out[i * 2 + 1] -= up;
      out[i * 2] += outward;
    }
    for (const i of [185, 40, 409, 270, 146, 91, 375, 321]) out[i * 2 + 1] -= up * 0.5;
  }

  // 4) 눈썹
  if (p.brow !== 0) {
    const dy = -p.brow * faceH * 0.02;
    for (const i of LM.rightBrow) out[i * 2 + 1] += dy;
    for (const i of LM.leftBrow) out[i * 2 + 1] += dy;
  }
  if (p.frown > 0) {
    const dy = p.frown * faceH * 0.018;
    const dx = p.frown * faceW * 0.008;
    for (const i of LM.browInner) {
      out[i * 2 + 1] += dy;
      // 미간 쪽으로 모은다
      out[i * 2] += out[i * 2] < center.x ? dx : -dx;
    }
  }

  // 5) 깜빡임: 윗눈꺼풀을 아랫눈꺼풀 쪽으로
  for (const { upper, lower, w, eye } of rig.blinkPairs) {
    const b = (eye === 'l' ? p.blinkL : p.blinkR) * w;
    if (b <= 0) continue;
    const uy = out[upper * 2 + 1];
    const ly = out[lower * 2 + 1];
    out[upper * 2 + 1] = uy + (ly - uy) * b * 0.92;
    if (w === 1) out[lower * 2 + 1] = ly - (ly - uy) * b * 0.12;
  }

  return out;
}
