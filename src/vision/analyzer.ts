import type { FaceLandmarkerResult, PoseLandmarkerResult } from '@mediapipe/tasks-vision';
import type { FaceSample, PoseSample } from '../types';
import { Ema, ResampledRing, clamp, findOscillation } from '../lib/signal';

/* 얼굴 랜드마크 인덱스 (canonical face mesh) */
const NOSE_TIP = 1;
const CHIN = 152;
const BROW_MID = 9; // 미간
const EYE_CORNER_A = 33; // 한쪽 눈 바깥 끝
const EYE_CORNER_B = 263; // 반대쪽 눈 바깥 끝

/* 포즈 랜드마크 인덱스 (BlazePose 33) */
const P = {
  nose: 0,
  shoulderL: 11,
  shoulderR: 12,
  wristL: 15,
  wristR: 16,
  hipL: 23,
  hipR: 24,
  kneeL: 25,
  kneeR: 26,
} as const;

const SAMPLE_HZ = 30;

/**
 * 자기상관 봉우리 높이를 "정말 떨고 있다"는 확신으로 바꾼다.
 * 랜드마크 잡음만 있어도 0.1~0.25 짜리 우연한 봉우리가 생기므로 그 아래는 0 으로 본다.
 */
const periodicityConfidence = (p: number) => clamp((p - 0.25) / 0.55, 0, 1);

export interface GazeCalibration {
  /** 정면 응시 시의 원시 좌우/상하 값 */
  centerX: number;
  centerY: number;
  /** 화면 가장자리를 볼 때의 원시값 차이 (부호 포함) */
  spanX: number;
  /** 아래쪽을 볼 때의 원시값 차이 (부호 포함, 보통 음수) */
  spanY: number;
  calibrated: boolean;
}

export const DEFAULT_CALIBRATION: GazeCalibration = {
  centerX: 0,
  centerY: 0.85,
  spanX: 0.55,
  spanY: -0.45,
  calibrated: false,
};

/** 정면 대비 이 비율 이상 벗어나면 시선 이탈 (1.0 = 화면 가장자리) */
const OFF_TARGET_X = 0.45;
const OFF_TARGET_Y = 0.5;
const LOOK_DOWN_Y = 0.55;

interface RawGaze {
  x: number;
  y: number;
}

function blend(result: FaceLandmarkerResult, name: string): number {
  const cats = result.faceBlendshapes?.[0]?.categories;
  if (!cats) return 0;
  for (const c of cats) if (c.categoryName === name) return c.score;
  return 0;
}

/**
 * 원시 시선 값. 부호 규약: x 양수 = 이미지 오른쪽, y 양수 = 위쪽.
 * 머리 방향(기하)과 안구 방향(블렌드셰이프)을 합산한다.
 */
function rawGaze(result: FaceLandmarkerResult): RawGaze | null {
  const lm = result.faceLandmarks?.[0];
  if (!lm || lm.length < 400) return null;

  const nose = lm[NOSE_TIP];
  const chin = lm[CHIN];
  const brow = lm[BROW_MID];
  const cornerA = lm[EYE_CORNER_A];
  const cornerB = lm[EYE_CORNER_B];
  if (!nose || !chin || !brow || !cornerA || !cornerB) return null;

  // 이미지상 좌우를 x 좌표로 직접 판별해 Left/Right 명명 혼동을 피한다
  const left = cornerA.x <= cornerB.x ? cornerA : cornerB;
  const right = cornerA.x <= cornerB.x ? cornerB : cornerA;
  const eyeSpan = right.x - left.x;
  if (eyeSpan < 1e-4) return null;

  // 코가 어느 쪽 눈꼬리에 치우쳤는지 = 머리 좌우 회전
  const headX = (nose.x - left.x - (right.x - nose.x)) / eyeSpan;

  // 아래를 보면 코-턱 거리가 짧아지고 미간-코 거리가 길어진다
  const upper = Math.max(nose.y - brow.y, 1e-4);
  const lower = Math.max(chin.y - nose.y, 1e-4);
  const headY = lower / upper; // 정면에서 대략 1.4~2.0, 아래를 볼수록 작아짐

  // 안구 방향 (ARKit 명명: Left/Right 는 피험자 기준)
  // 피험자가 자기 왼쪽을 보면 = 이미지 오른쪽
  const eyeX =
    (blend(result, 'eyeLookOutLeft') + blend(result, 'eyeLookInRight')) / 2 -
    (blend(result, 'eyeLookInLeft') + blend(result, 'eyeLookOutRight')) / 2;
  const eyeY =
    (blend(result, 'eyeLookUpLeft') + blend(result, 'eyeLookUpRight')) / 2 -
    (blend(result, 'eyeLookDownLeft') + blend(result, 'eyeLookDownRight')) / 2;

  return {
    x: headX + eyeX * 0.55,
    y: headY * 0.5 + eyeY * 0.55,
  };
}

function isBlinking(result: FaceLandmarkerResult): boolean {
  return (blend(result, 'eyeBlinkLeft') + blend(result, 'eyeBlinkRight')) / 2 > 0.45;
}

/** 보정 단계에서 원시 시선 값을 모아 중앙값을 낸다 */
export class CalibrationCollector {
  private xs: number[] = [];
  private ys: number[] = [];

  add(result: FaceLandmarkerResult | null) {
    if (!result) return;
    const g = rawGaze(result);
    if (!g) return;
    this.xs.push(g.x);
    this.ys.push(g.y);
  }

  get count() {
    return this.xs.length;
  }

  median(): RawGaze | null {
    if (this.xs.length < 5) return null;
    const med = (a: number[]) => [...a].sort((p, q) => p - q)[Math.floor(a.length / 2)];
    return { x: med(this.xs), y: med(this.ys) };
  }

  reset() {
    this.xs = [];
    this.ys = [];
  }
}

export interface VisionDebug {
  gazeX: number;
  gazeDown: number;
  shoulderTilt: number;
  neckRatio: number;
  legFreq: number;
  legStrength: number;
  legSource: 'knee' | 'hip' | 'none';
  fps: number;
}

export class VisionAnalyzer {
  calibration: GazeCalibration = { ...DEFAULT_CALIBRATION };

  private prevShoulderMid: { x: number; y: number } | null = null;
  private prevWrists: { lx: number; ly: number; rx: number; ry: number } | null = null;
  private prevPoseT = 0;
  /**
   * 프레임 간 위치 차이는 랜드마크 잡음이 그대로 속도로 둔갑한다.
   * 위치를 먼저 부드럽게 한 뒤 차이를 내야 "몸 흔들림"이 실제 움직임만 반영한다.
   */
  private midX = new Ema(0.3);
  private midY = new Ema(0.3);
  private wristLx = new Ema(0.3);
  private wristLy = new Ema(0.3);
  private wristRx = new Ema(0.3);
  private wristRy = new Ema(0.3);

  private legRing = new ResampledRing(SAMPLE_HZ, 3.5);
  private handRing = new ResampledRing(SAMPLE_HZ, 3);
  private legSource: 'knee' | 'hip' | 'none' = 'none';

  private swayEma = new Ema(0.15);
  private handEma = new Ema(0.15);
  /** 어깨 폭은 카메라 거리에 따라서만 천천히 변한다. 순간값으로 나누면 어깨 잡음이 다리 신호에 섞여 들어온다 */
  private scaleEma = new Ema(0.05);
  private fpsEma = new Ema(0.1);
  private lastFrameT = 0;

  debug: VisionDebug = {
    gazeX: 0,
    gazeDown: 0,
    shoulderTilt: 0,
    neckRatio: 0,
    legFreq: 0,
    legStrength: 0,
    legSource: 'none',
    fps: 0,
  };

  reset() {
    this.prevShoulderMid = null;
    this.prevWrists = null;
    this.prevPoseT = 0;
    this.legRing.clear();
    this.handRing.clear();
    this.swayEma.reset();
    this.handEma.reset();
    this.scaleEma.reset();
    for (const e of [this.midX, this.midY, this.wristLx, this.wristLy, this.wristRx, this.wristRy]) e.reset();
    this.lastFrameT = 0;
  }

  tickFps(t: number) {
    if (this.lastFrameT) {
      const dt = t - this.lastFrameT;
      if (dt > 0 && dt < 1000) this.fpsEma.push(1000 / dt);
    }
    this.lastFrameT = t;
    this.debug.fps = this.fpsEma.get();
  }

  face(result: FaceLandmarkerResult | null): FaceSample | null {
    if (!result?.faceLandmarks?.length) return null;
    const raw = rawGaze(result);
    if (!raw) return null;

    const { centerX, centerY, spanX, spanY } = this.calibration;
    const sx = Math.abs(spanX) < 0.08 ? Math.abs(DEFAULT_CALIBRATION.spanX) : Math.abs(spanX);
    const sy = Math.abs(spanY) < 0.08 ? Math.abs(DEFAULT_CALIBRATION.spanY) : Math.abs(spanY);

    // 정면 = 0, 화면 가장자리 = ±1
    const gx = clamp((raw.x - centerX) / sx, -3, 3);
    // 보정 3단계에서 "아래"를 보게 하므로 spanY 방향이 곧 아래쪽이다
    const downSign = spanY <= 0 ? -1 : 1;
    const gDown = clamp(((raw.y - centerY) / sy) * downSign, -3, 3);

    this.debug.gazeX = gx;
    this.debug.gazeDown = gDown;

    return {
      yawDev: gx,
      pitchDev: -gDown,
      onTarget: Math.abs(gx) < OFF_TARGET_X && Math.abs(gDown) < OFF_TARGET_Y,
      lookingDown: gDown > LOOK_DOWN_Y,
      blink: isBlinking(result),
    };
  }

  pose(result: PoseLandmarkerResult | null, t: number): PoseSample | null {
    const lm = result?.landmarks?.[0];
    if (!lm || lm.length < 27) return null;

    const sL = lm[P.shoulderL];
    const sR = lm[P.shoulderR];
    const shoulderWidth = Math.hypot(sL.x - sR.x, sL.y - sR.y);
    if (shoulderWidth < 0.04) return null; // 너무 멀거나 인식 불량

    const midX = this.midX.push((sL.x + sR.x) / 2);
    const midY = this.midY.push((sL.y + sR.y) / 2);
    const nose = lm[P.nose];
    const scale = this.scaleEma.push(shoulderWidth);

    const rawTilt = Math.abs((Math.atan2(sR.y - sL.y, sR.x - sL.x) * 180) / Math.PI);
    const tilt = rawTilt > 90 ? 180 - rawTilt : rawTilt;
    const neckRatio = (midY - nose.y) / shoulderWidth;

    const dt = this.prevPoseT ? (t - this.prevPoseT) / 1000 : 0;
    let swaySpeed = this.swayEma.get();
    let handSpeed = this.handEma.get();

    if (this.prevShoulderMid && dt > 0.008 && dt < 0.5) {
      const d = Math.hypot(midX - this.prevShoulderMid.x, midY - this.prevShoulderMid.y);
      swaySpeed = this.swayEma.push(d / shoulderWidth / dt);
    }

    const wL = lm[P.wristL];
    const wR = lm[P.wristR];
    const wristsVisible = (wL?.visibility ?? 0) > 0.4 || (wR?.visibility ?? 0) > 0.4;
    const sw = wristsVisible
      ? { lx: this.wristLx.push(wL.x), ly: this.wristLy.push(wL.y), rx: this.wristRx.push(wR.x), ry: this.wristRy.push(wR.y) }
      : null;

    if (this.prevWrists && sw && dt > 0.008 && dt < 0.5) {
      const dl = Math.hypot(sw.lx - this.prevWrists.lx, sw.ly - this.prevWrists.ly);
      const dr = Math.hypot(sw.rx - this.prevWrists.rx, sw.ry - this.prevWrists.ry);
      handSpeed = this.handEma.push((dl + dr) / 2 / shoulderWidth / dt);
    }

    const selfTouch =
      wristsVisible &&
      (Math.hypot(wL.x - nose.x, wL.y - nose.y) < shoulderWidth * 0.55 ||
        Math.hypot(wR.x - nose.x, wR.y - nose.y) < shoulderWidth * 0.55);

    /* 다리 떨림: 무릎이 보이면 무릎, 아니면 골반의 미세 진동 */
    const kneeL = lm[P.kneeL];
    const kneeR = lm[P.kneeR];
    const kneeVisL = kneeL?.visibility ?? 0;
    const kneeVisR = kneeR?.visibility ?? 0;
    const hipVis = Math.max(lm[P.hipL]?.visibility ?? 0, lm[P.hipR]?.visibility ?? 0);

    let legSignal: number | null = null;
    if (Math.max(kneeVisL, kneeVisR) > 0.55) {
      this.legSource = 'knee';
      const wSum = Math.max(kneeVisL + kneeVisR, 1e-3);
      legSignal = (kneeL.y * kneeVisL + kneeR.y * kneeVisR) / wSum / scale;
    } else if (hipVis > 0.55) {
      this.legSource = 'hip';
      legSignal = (lm[P.hipL].y + lm[P.hipR].y) / 2 / scale;
    } else {
      this.legSource = 'none';
    }
    if (legSignal !== null) this.legRing.push(t, legSignal);

    if (wristsVisible) this.handRing.push(t, (wL.y + wR.y) / 2 / scale);

    let legShake = 0;
    if (this.legSource !== 'none' && this.legRing.full) {
      const osc = findOscillation(this.legRing.values(), SAMPLE_HZ, 2.5, 9);
      // 골반 신호는 무릎보다 진폭이 훨씬 작아 민감도를 올린다
      const ampGain = this.legSource === 'hip' ? 260 : 90;
      const amp = clamp(osc.amplitude * ampGain, 0, 1);
      legShake = clamp(periodicityConfidence(osc.periodicity) * amp * 1.4, 0, 1);
      this.debug.legFreq = osc.freq;
    }
    this.debug.legStrength = legShake;
    this.debug.legSource = this.legSource;

    let handFidget = 0;
    if (this.handRing.full) {
      const osc = findOscillation(this.handRing.values(), SAMPLE_HZ, 1.5, 8);
      handFidget = clamp(periodicityConfidence(osc.periodicity) * clamp(osc.amplitude * 70, 0, 1) * 1.3, 0, 1);
    }

    this.prevShoulderMid = { x: midX, y: midY };
    this.prevWrists = sw;
    this.prevPoseT = t;

    this.debug.shoulderTilt = tilt;
    this.debug.neckRatio = neckRatio;

    return { shoulderTilt: tilt, neckRatio, swaySpeed, handSpeed, selfTouch, legShake, handFidget };
  }
}
