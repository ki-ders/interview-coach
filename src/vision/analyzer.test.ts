import { describe, expect, it } from 'vitest';
import { CalibrationCollector, DEFAULT_CALIBRATION, VisionAnalyzer } from './analyzer';
import { NO_FACE, SEATED, makeRng, synthFace, synthPose, type PoseParams } from '../sim/synth';

/** 앱의 보정 절차와 같은 순서로 보정값을 만든다: 정면 → 화면 왼쪽 끝 → 아래 */
function calibrate(v: VisionAnalyzer, opts: { sideYaw?: number; downPitch?: number; noise?: number } = {}) {
  const rng = makeRng(11);
  const collect = (params: Parameters<typeof synthFace>[0]) => {
    const c = new CalibrationCollector();
    for (let i = 0; i < 40; i++) c.add(synthFace({ ...params, noise: opts.noise ?? 0 }, rng));
    return c.median()!;
  };
  const center = collect({});
  // 사용자가 자기 왼쪽(화면 왼쪽 끝)을 보면 카메라 영상에서 코는 오른쪽(+x)으로 간다
  const side = collect({ yaw: opts.sideYaw ?? 0.35 });
  const down = collect({ pitch: opts.downPitch ?? 0.4 });
  v.calibration = {
    centerX: center.x,
    centerY: center.y,
    spanX: side.x - center.x,
    spanY: down.y - center.y,
    calibrated: true,
  };
  return v.calibration;
}

describe('시선: 보정과 판정의 부호가 맞는다', () => {
  it('보정값: 왼쪽 끝은 +x, 아래는 -y 로 잡힌다', () => {
    const v = new VisionAnalyzer();
    const cal = calibrate(v);
    expect(cal.spanX).toBeGreaterThan(0.15);
    expect(cal.spanY).toBeLessThan(-0.1);
  });

  it('정면은 on-target, 보정한 만큼 돌리면 가장자리(±1)', () => {
    const v = new VisionAnalyzer();
    calibrate(v);
    const front = v.face(synthFace({}))!;
    expect(front.onTarget).toBe(true);
    expect(Math.abs(front.yawDev)).toBeLessThan(0.1);
    expect(front.lookingDown).toBe(false);

    const left = v.face(synthFace({ yaw: 0.35 }))!;
    expect(left.yawDev).toBeCloseTo(1, 1);
    expect(left.onTarget).toBe(false);

    // 반대쪽(오른쪽 끝)도 대칭으로 -1
    const right = v.face(synthFace({ yaw: -0.35 }))!;
    expect(right.yawDev).toBeCloseTo(-1, 1);
    expect(right.onTarget).toBe(false);
  });

  it('살짝 움직이는 정도(보정 폭의 1/3)는 정면으로 본다', () => {
    const v = new VisionAnalyzer();
    calibrate(v);
    expect(v.face(synthFace({ yaw: 0.1 }))!.onTarget).toBe(true);
    expect(v.face(synthFace({ pitch: 0.1 }))!.onTarget).toBe(true);
  });

  it('아래를 보면 lookingDown', () => {
    const v = new VisionAnalyzer();
    calibrate(v);
    const down = v.face(synthFace({ pitch: 0.4 }))!;
    expect(down.lookingDown).toBe(true);
    expect(down.onTarget).toBe(false);
    // 위를 보는 것은 lookingDown 이 아니다
    const up = v.face(synthFace({ pitch: -0.3 }))!;
    expect(up.lookingDown).toBe(false);
  });

  it('머리는 정면인데 눈만 옆으로 돌려도 이탈로 잡는다', () => {
    const v = new VisionAnalyzer();
    calibrate(v);
    const eyes = v.face(synthFace({ eyeX: 1 }))!;
    expect(Math.abs(eyes.yawDev)).toBeGreaterThan(0.45);
    expect(eyes.onTarget).toBe(false);
    const eyesDown = v.face(synthFace({ eyeY: -1 }))!;
    expect(eyesDown.lookingDown).toBe(true);
  });

  it('눈 방향과 머리 방향이 같은 쪽이면 더 큰 이탈로 합산된다', () => {
    const v = new VisionAnalyzer();
    calibrate(v);
    const headOnly = v.face(synthFace({ yaw: 0.2 }))!.yawDev;
    const both = v.face(synthFace({ yaw: 0.2, eyeX: 0.6 }))!.yawDev;
    expect(both).toBeGreaterThan(headOnly);
  });

  it('보정 없이(기본값) 정면 얼굴은 on-target', () => {
    const v = new VisionAnalyzer();
    expect(v.calibration).toEqual(DEFAULT_CALIBRATION);
    const s = v.face(synthFace({}))!;
    expect(s.onTarget).toBe(true);
    expect(s.lookingDown).toBe(false);
  });

  it('랜드마크 잡음이 있어도 정면 판정이 흔들리지 않는다', () => {
    const v = new VisionAnalyzer();
    calibrate(v, { noise: 0.002 });
    const rng = makeRng(99);
    let on = 0;
    for (let i = 0; i < 60; i++) if (v.face(synthFace({ noise: 0.002 }, rng))!.onTarget) on++;
    expect(on).toBeGreaterThan(54);
  });

  it('깜빡임은 블렌드셰이프로', () => {
    const v = new VisionAnalyzer();
    expect(v.face(synthFace({ blink: 0.7 }))!.blink).toBe(true);
    expect(v.face(synthFace({ blink: 0.1 }))!.blink).toBe(false);
  });

  it('얼굴이 없으면 null', () => {
    const v = new VisionAnalyzer();
    expect(v.face(NO_FACE)).toBeNull();
    expect(v.face(null)).toBeNull();
  });

  it('보정 수집기는 5개 미만이면 중앙값을 내지 않는다', () => {
    const c = new CalibrationCollector();
    c.add(synthFace({}));
    expect(c.median()).toBeNull();
    for (let i = 0; i < 5; i++) c.add(synthFace({}));
    expect(c.median()).not.toBeNull();
  });
});

/** 30fps 로 seconds 동안 포즈를 흘려 넣고 마지막 샘플을 돌려준다 */
function runPose(
  v: VisionAnalyzer,
  seconds: number,
  at: (tSec: number) => Partial<PoseParams>,
  seed = 5,
) {
  const rng = makeRng(seed);
  let last = null;
  const frames = Math.round(seconds * 30);
  for (let i = 0; i <= frames; i++) {
    const t = i / 30;
    last = v.pose(synthPose(at(t), rng), t * 1000);
  }
  return last!;
}

describe('자세: 기본 지표', () => {
  it('어깨 기울기·목 비율이 그대로 읽힌다', () => {
    const v = new VisionAnalyzer();
    const s = runPose(v, 0.5, () => ({ tiltDeg: 8, neckRatio: 0.6 }));
    expect(s.shoulderTilt).toBeCloseTo(8, 0);
    expect(s.neckRatio).toBeCloseTo(0.6, 1);
  });

  it('손이 얼굴 근처면 selfTouch', () => {
    const v = new VisionAnalyzer();
    const touching = runPose(v, 0.2, () => ({ wristL: { x: 0.1, y: -0.9 } }));
    expect(touching.selfTouch).toBe(true);
    const lap = runPose(v, 0.2, () => ({}));
    expect(lap.selfTouch).toBe(false);
  });

  it('가만히 앉아 있으면 흔들림·손동작 속도가 0', () => {
    const v = new VisionAnalyzer();
    const s = runPose(v, 2, () => ({}));
    expect(s.swaySpeed).toBeLessThan(1e-6);
    expect(s.handSpeed).toBeLessThan(1e-6);
  });

  it('몸을 계속 움직이면 swaySpeed 가 커진다', () => {
    const v = new VisionAnalyzer();
    const s = runPose(v, 2, (t) => ({ cx: 0.5 + 0.05 * Math.sin(t * 4) }));
    expect(s.swaySpeed).toBeGreaterThan(0.2);
  });

  it('어깨가 너무 작으면(멀리 있으면) null', () => {
    const v = new VisionAnalyzer();
    expect(v.pose(synthPose({ shoulderW: 0.02 }), 0)).toBeNull();
    expect(v.pose(null, 0)).toBeNull();
  });
});

describe('다리 떨림', () => {
  const knees = { kneeY: 1.05, kneeVisibility: 0.9 };

  it('무릎이 보이고 5Hz 로 떨면 강하게 잡힌다', () => {
    const v = new VisionAnalyzer();
    const s = runPose(v, 5, (t) => ({ ...knees, kneeY: 1.05 + 0.004 * Math.sin(2 * Math.PI * 5 * t) }));
    expect(v.debug.legSource).toBe('knee');
    expect(s.legShake).toBeGreaterThan(0.7);
    expect(v.debug.legFreq).toBeGreaterThan(4);
    expect(v.debug.legFreq).toBeLessThan(6.5);
  });

  it('가만히 있으면(잡음만) 거의 0', () => {
    const v = new VisionAnalyzer();
    const s = runPose(v, 5, () => ({ ...knees, noise: 0.003 }));
    expect(s.legShake).toBeLessThan(0.25);
  });

  it('천천히 자세를 바꾸거나 몸을 흔드는 것은 떨림이 아니다', () => {
    const v = new VisionAnalyzer();
    const sway = runPose(v, 5, (t) => ({ ...knees, kneeY: 1.05 + 0.02 * Math.sin(2 * Math.PI * 0.4 * t) }));
    expect(sway.legShake).toBeLessThan(0.1);
    const v2 = new VisionAnalyzer();
    const shift = runPose(v2, 5, (t) => ({ ...knees, kneeY: t < 2.5 ? 1.05 : 1.09 }));
    expect(shift.legShake).toBeLessThan(0.1);
  });

  it('떨림 위에 느린 흔들림과 잡음이 섞여도 잡는다', () => {
    const v = new VisionAnalyzer();
    const s = runPose(v, 5, (t) => ({
      ...knees,
      noise: 0.002,
      kneeY: 1.05 + 0.005 * Math.sin(2 * Math.PI * 4.5 * t) + 0.015 * Math.sin(2 * Math.PI * 0.3 * t),
    }));
    expect(s.legShake).toBeGreaterThan(0.5);
  });

  it('무릎이 안 보이면 골반의 미세 진동으로 추정한다', () => {
    const v = new VisionAnalyzer();
    const s = runPose(v, 5, (t) => ({ hipY: 0.98 + 0.0015 * Math.sin(2 * Math.PI * 4 * t) }));
    expect(v.debug.legSource).toBe('hip');
    expect(s.legShake).toBeGreaterThan(0.4);
  });

  it('무릎도 골반도 안 보이면 판단하지 않는다', () => {
    const v = new VisionAnalyzer();
    const s = runPose(v, 5, (t) => ({ hipVisibility: 0.2, hipY: 0.98 + 0.01 * Math.sin(2 * Math.PI * 5 * t) }));
    expect(v.debug.legSource).toBe('none');
    expect(s.legShake).toBe(0);
  });

  it('떨다가 멈추면 3.5초 창이 지나며 내려간다', () => {
    const v = new VisionAnalyzer();
    const s = runPose(v, 10, (t) => ({
      ...knees,
      kneeY: 1.05 + (t < 4 ? 0.004 * Math.sin(2 * Math.PI * 5 * t) : 0),
    }));
    expect(s.legShake).toBeLessThan(0.05);
  });
});

describe('손 만지작거림', () => {
  it('손목을 3Hz 로 까딱이면 잡힌다', () => {
    const v = new VisionAnalyzer();
    const s = runPose(v, 4, (t) => ({ wristL: { x: 0.45, y: 1.1 + 0.03 * Math.sin(2 * Math.PI * 3 * t) } }));
    expect(s.handFidget).toBeGreaterThan(0.5);
  });

  it('천천히 손짓하는 것은 만지작거림이 아니다', () => {
    const v = new VisionAnalyzer();
    const s = runPose(v, 4, (t) => ({ wristL: { x: 0.45 + 0.2 * Math.sin(t * 2), y: 0.9 + 0.2 * Math.sin(t * 2) } }));
    expect(s.handFidget).toBeLessThan(0.15);
  });

  it('손목이 안 보이면 계산하지 않는다', () => {
    const v = new VisionAnalyzer();
    const s = runPose(v, 4, (t) => ({
      wristVisibility: 0.1,
      wristL: { x: 0.45, y: 1.1 + 0.03 * Math.sin(2 * Math.PI * 3 * t) },
    }));
    expect(s.handFidget).toBe(0);
    expect(s.selfTouch).toBe(false);
  });
});

describe('fps 추정', () => {
  it('33ms 간격이면 약 30fps', () => {
    const v = new VisionAnalyzer();
    for (let i = 0; i < 60; i++) v.tickFps(i * 33.3);
    expect(v.debug.fps).toBeGreaterThan(27);
    expect(v.debug.fps).toBeLessThan(33);
  });
});

// SEATED 기본값이 테스트 전제(무릎 안 보임, 골반 보임)를 유지하는지
it('기본 자세 프리셋: 무릎은 화면 밖, 골반은 보임', () => {
  expect(SEATED.kneeVisibility).toBeLessThan(0.55);
  expect(SEATED.hipVisibility).toBeGreaterThan(0.55);
});

describe('랜드마크 잡음에 대한 강건성', () => {
  it('가만히 앉아 있는데 잡음만 있으면 몸 흔들림·손동작 속도가 이상 구간 아래', () => {
    const v = new VisionAnalyzer();
    const s = runPose(v, 4, () => ({ noise: 0.002 }), 21);
    expect(s.swaySpeed).toBeLessThan(0.1);
    expect(s.handSpeed).toBeLessThan(0.1);
  });

  it('진짜로 몸을 흔들면 잡음이 있어도 속도가 잡힌다', () => {
    const v = new VisionAnalyzer();
    const s = runPose(v, 4, (t) => ({ noise: 0.002, cx: 0.5 + 0.04 * Math.sin(t * 3) }), 22);
    expect(s.swaySpeed).toBeGreaterThan(0.12);
  });
});
