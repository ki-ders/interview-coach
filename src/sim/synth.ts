/**
 * 카메라 없이 분석 파이프라인을 돌리기 위한 합성 랜드마크 생성기.
 * MediaPipe 결과 객체와 같은 모양을 만들어 VisionAnalyzer 에 그대로 먹인다.
 * 테스트(vitest)와 시뮬레이션 모드(?sim=1)가 함께 쓴다.
 */
import type { FaceLandmarkerResult, NormalizedLandmark, PoseLandmarkerResult } from '@mediapipe/tasks-vision';
import { CANONICAL_LANDMARKS } from '../face/__fixtures__/canonical';

export interface FaceParams {
  /** 머리 좌우 회전(rad). 양수 = 코가 이미지 오른쪽으로 (피험자가 자기 왼쪽을 봄) */
  yaw: number;
  /** 머리 상하 회전(rad). 양수 = 아래를 봄 */
  pitch: number;
  roll: number;
  /** 안구 방향 -1~1. 양수 = 이미지 오른쪽 */
  eyeX: number;
  /** 안구 방향 -1~1. 양수 = 위 */
  eyeY: number;
  /** 0~1 */
  blink: number;
  /** 얼굴 중심 (이미지 정규화 좌표) */
  cx: number;
  cy: number;
  /** 얼굴 크기 배율. 1 이면 얼굴 폭이 화면 폭의 약 46% (canonical 그대로) */
  scale: number;
  /** 랜드마크 잡음 표준편차 (정규화 좌표) */
  noise: number;
}

export const FRONTAL: FaceParams = {
  yaw: 0,
  pitch: 0,
  roll: 0,
  eyeX: 0,
  eyeY: 0,
  blink: 0,
  cx: 0.5,
  cy: 0.45,
  scale: 0.55,
  noise: 0,
};

/** 결정적 의사난수 (테스트 재현성) */
export function makeRng(seed = 1) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** 대략적인 정규분포 (Box–Muller 없이 12개 합) */
export function gauss(rng: () => number): number {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += rng();
  return sum - 6;
}

function category(name: string, score: number, index: number) {
  return { categoryName: name, displayName: name, score, index };
}

/** 정면 canonical 얼굴을 회전·이동시켜 랜드마크와 블렌드셰이프를 만든다 */
export function synthFace(partial: Partial<FaceParams>, rng: () => number = makeRng(3)): FaceLandmarkerResult {
  const p = { ...FRONTAL, ...partial };
  const cy = Math.cos(p.yaw);
  const sy = Math.sin(p.yaw);
  const cp = Math.cos(p.pitch);
  const sp = Math.sin(p.pitch);
  const cr = Math.cos(p.roll);
  const sr = Math.sin(p.roll);

  const lm: NormalizedLandmark[] = CANONICAL_LANDMARKS.map(([x0, y0, z0]) => {
    // 머리 중심(0.5, 0.5, 0)을 기준으로 회전
    let x = x0 - 0.5;
    let y = y0 - 0.5;
    let z = z0;
    // yaw: y축 회전. z<0 이 카메라 쪽이므로 양의 yaw 에 코가 +x 로 간다
    const x1 = x * cy - z * sy;
    const z1 = x * sy + z * cy;
    x = x1;
    z = z1;
    // pitch: x축 회전. 양의 pitch 에 코가 +y(아래)로 간다
    const y2 = y * cp - z * sp;
    const z2 = y * sp + z * cp;
    y = y2;
    z = z2;
    // roll: 이미지 평면 회전
    const x3 = x * cr - y * sr;
    const y3 = x * sr + y * cr;
    x = x3;
    y = y3;
    const n = p.noise;
    return {
      x: p.cx + x * p.scale + (n ? gauss(rng) * n : 0),
      y: p.cy + y * p.scale + (n ? gauss(rng) * n : 0),
      z: z * p.scale + (n ? gauss(rng) * n : 0),
      visibility: 1,
    };
  });

  const ex = p.eyeX;
  const ey = p.eyeY;
  // ARKit 명명: Left/Right 는 피험자 기준. 피험자의 왼쪽 눈이 바깥(Out)을 보면 이미지 오른쪽.
  const cats = [
    category('eyeBlinkLeft', p.blink, 9),
    category('eyeBlinkRight', p.blink, 10),
    category('eyeLookDownLeft', Math.max(0, -ey), 11),
    category('eyeLookDownRight', Math.max(0, -ey), 12),
    category('eyeLookInLeft', Math.max(0, -ex), 13),
    category('eyeLookInRight', Math.max(0, ex), 14),
    category('eyeLookOutLeft', Math.max(0, ex), 15),
    category('eyeLookOutRight', Math.max(0, -ex), 16),
    category('eyeLookUpLeft', Math.max(0, ey), 17),
    category('eyeLookUpRight', Math.max(0, ey), 18),
  ];

  return {
    faceLandmarks: [lm],
    faceBlendshapes: [{ categories: cats, headIndex: 0, headName: 'blendshapes' }],
    facialTransformationMatrixes: [],
  };
}

export const NO_FACE: FaceLandmarkerResult = {
  faceLandmarks: [],
  faceBlendshapes: [],
  facialTransformationMatrixes: [],
};

export interface PoseParams {
  /** 어깨 중심 */
  cx: number;
  shoulderY: number;
  /** 어깨 폭 (정규화) */
  shoulderW: number;
  /** 어깨 기울기 (도) */
  tiltDeg: number;
  /** (어깨 중심 - 코) / 어깨 폭. 1.0 이 보통, 작을수록 움츠림 */
  neckRatio: number;
  /** 무릎 y. 화면 밖이면 visibility 를 낮춘다 */
  kneeY: number;
  kneeVisibility: number;
  hipY: number;
  hipVisibility: number;
  /** 손목 위치 (어깨 중심 기준 상대 좌표, 어깨 폭 단위) */
  wristL: { x: number; y: number };
  wristR: { x: number; y: number };
  wristVisibility: number;
  noise: number;
}

export const SEATED: PoseParams = {
  cx: 0.5,
  shoulderY: 0.62,
  shoulderW: 0.28,
  tiltDeg: 0,
  neckRatio: 1.0,
  kneeY: 1.25,
  kneeVisibility: 0.1,
  hipY: 0.98,
  hipVisibility: 0.7,
  wristL: { x: 0.45, y: 1.1 },
  wristR: { x: -0.45, y: 1.1 },
  wristVisibility: 0.8,
  noise: 0,
};

/** BlazePose 33 점 중 분석기가 쓰는 점만 의미 있게 채운다 */
export function synthPose(partial: Partial<PoseParams>, rng: () => number = makeRng(5)): PoseLandmarkerResult {
  const p = { ...SEATED, ...partial };
  const n = p.noise;
  const j = () => (n ? gauss(rng) * n : 0);
  const pt = (x: number, y: number, visibility: number, z = 0): NormalizedLandmark => ({
    x: x + j(),
    y: y + j(),
    z,
    visibility,
  });

  const half = p.shoulderW / 2;
  const tilt = (p.tiltDeg * Math.PI) / 180;
  const dy = Math.tan(tilt) * half;
  // 이미지 왼쪽에 보이는 어깨가 피험자의 오른쪽 어깨(12)다
  const shoulderR = pt(p.cx - half, p.shoulderY + dy, 0.99);
  const shoulderL = pt(p.cx + half, p.shoulderY - dy, 0.99);
  const nose = pt(p.cx, p.shoulderY - p.neckRatio * p.shoulderW, 0.99);
  const hipR = pt(p.cx - half * 0.8, p.hipY, p.hipVisibility);
  const hipL = pt(p.cx + half * 0.8, p.hipY, p.hipVisibility);
  const kneeR = pt(p.cx - half * 0.7, p.kneeY, p.kneeVisibility);
  const kneeL = pt(p.cx + half * 0.7, p.kneeY, p.kneeVisibility);
  const wristL = pt(p.cx + p.wristL.x * p.shoulderW, p.shoulderY + p.wristL.y * p.shoulderW, p.wristVisibility);
  const wristR = pt(p.cx + p.wristR.x * p.shoulderW, p.shoulderY + p.wristR.y * p.shoulderW, p.wristVisibility);

  const lm: NormalizedLandmark[] = Array.from({ length: 33 }, () => pt(p.cx, p.shoulderY, 0));
  lm[0] = nose;
  lm[11] = shoulderL;
  lm[12] = shoulderR;
  lm[13] = pt(p.cx + half * 1.1, p.shoulderY + p.shoulderW * 0.7, 0.8); // 팔꿈치
  lm[14] = pt(p.cx - half * 1.1, p.shoulderY + p.shoulderW * 0.7, 0.8);
  lm[15] = wristL;
  lm[16] = wristR;
  lm[23] = hipL;
  lm[24] = hipR;
  lm[25] = kneeL;
  lm[26] = kneeR;

  return { landmarks: [lm], worldLandmarks: [lm], segmentationMasks: undefined } as unknown as PoseLandmarkerResult;
}

export const NO_POSE: PoseLandmarkerResult = {
  landmarks: [],
  worldLandmarks: [],
  segmentationMasks: undefined,
} as unknown as PoseLandmarkerResult;
