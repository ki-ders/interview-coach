import { describe, expect, it } from 'vitest';
import {
  buildBreakdown,
  computeMetrics,
  derive,
  emptyStats,
  emptyText,
  feed,
  sealStats,
  textStatsOf,
  type RawStats,
  type Sample,
  type TextStats,
} from './metrics';
import type { FaceSample, PoseSample } from '../types';

const STEP = 33; // 약 30fps

const goodFace = (): FaceSample => ({
  yawDev: 0.05,
  pitchDev: 0.02,
  onTarget: true,
  lookingDown: false,
  blink: false,
});

/** 분당 15회 정도 자연스럽게 깜빡이는 얼굴 */
const blinkingFace = (i: number): FaceSample => ({ ...goodFace(), blink: i % 120 < 3 });

const goodPose = (): PoseSample => ({
  shoulderTilt: 1.6,
  neckRatio: 1.0,
  swaySpeed: 0.08,
  handSpeed: 0.2,
  selfTouch: false,
  legShake: 0.02,
  handFidget: 0.03,
});

interface RunOpts {
  seconds: number;
  face?: (i: number, t: number) => FaceSample | null;
  pose?: (i: number, t: number) => PoseSample | null;
  snr?: (i: number, t: number) => number;
  speaking?: (i: number, t: number) => boolean;
  answering?: boolean;
}

function run(opts: RunOpts): RawStats {
  const st = emptyStats();
  const frames = Math.round((opts.seconds * 1000) / STEP);
  for (let i = 0; i < frames; i++) {
    const t = i * STEP;
    const speaking = opts.speaking ? opts.speaking(i, t) : true;
    const sample: Sample = {
      t,
      face: opts.face ? opts.face(i, t) : goodFace(),
      pose: opts.pose ? opts.pose(i, t) : goodPose(),
      snr: opts.snr ? opts.snr(i, t) : 20,
      speaking,
      ttsActive: false,
      answering: opts.answering ?? true,
    };
    feed(st, sample, STEP);
  }
  sealStats(st);
  return st;
}

describe('좋은 수행', () => {
  const st = run({ seconds: 60, face: blinkingFace });
  const d = derive(st);
  const m = computeMetrics(d, {
    syllablesPerSec: 5,
    fillerRatio: 0.02,
    stutterPer100: 0.4,
    sentenceEndRatio: 0.8,
    startDelaySec: 1.5,
    available: true,
  });

  it('모든 항목이 높게 나온다', () => {
    expect(m.gaze).toBeGreaterThanOrEqual(85);
    expect(m.gesture).toBeGreaterThanOrEqual(85);
    expect(m.voice).toBeGreaterThanOrEqual(80);
    expect(m.calm).toBeGreaterThanOrEqual(85);
    expect(m.speech).toBeGreaterThanOrEqual(80);
  });

  it('데이터 수집 플래그가 켜진다', () => {
    expect(d.faceAvailable).toBe(true);
    expect(d.poseAvailable).toBe(true);
    expect(d.voiceAvailable).toBe(true);
  });

  it('리포트 항목이 5개 생성된다', () => {
    const b = buildBreakdown(d, emptyText(), m);
    expect(b).toHaveLength(5);
    expect(b.map((x) => x.key)).toEqual(['gaze', 'gesture', 'speech', 'voice', 'calm']);
    for (const item of b) {
      expect(item.details.length).toBeGreaterThan(2);
      expect(item.tips.length).toBeGreaterThan(0);
    }
  });
});

describe('시선', () => {
  it('계속 아래만 보면 점수가 낮다', () => {
    const st = run({
      seconds: 60,
      face: () => ({ yawDev: 0.1, pitchDev: -0.9, onTarget: false, lookingDown: true, blink: false }),
    });
    const m = computeMetrics(derive(st), emptyText());
    expect(m.gaze).toBeLessThan(30);
  });

  it('시선이 좌우로 흔들리면 깎인다', () => {
    const steady = run({ seconds: 60 });
    const shaky = run({
      seconds: 60,
      face: (i) => {
        const yaw = Math.sin(i / 4) * 0.9;
        return {
          yawDev: yaw,
          pitchDev: 0,
          onTarget: Math.abs(yaw) < 0.45,
          lookingDown: false,
          blink: false,
        };
      },
    });
    const a = computeMetrics(derive(steady), emptyText()).gaze;
    const b = computeMetrics(derive(shaky), emptyText()).gaze;
    expect(b).toBeLessThan(a - 20);
  });

  it('100% 응시는 만점은 아니지만 크게 깎이지도 않는다', () => {
    const st = run({ seconds: 60, face: () => ({ ...goodFace(), blink: false }) });
    const score = computeMetrics(derive(st), emptyText()).gaze;
    expect(score).toBeGreaterThan(55);
  });

  it('얼굴이 안 잡히면 기본값을 준다', () => {
    const st = run({ seconds: 30, face: () => null });
    expect(derive(st).faceAvailable).toBe(false);
    expect(computeMetrics(derive(st), emptyText()).gaze).toBe(50);
  });
});

describe('안정감 (다리 떨림)', () => {
  it('다리를 계속 떨면 점수가 크게 깎인다', () => {
    const calm = run({ seconds: 60, face: blinkingFace });
    const shaky = run({
      seconds: 60,
      face: blinkingFace,
      pose: () => ({ ...goodPose(), legShake: 0.85 }),
    });
    const a = computeMetrics(derive(calm), emptyText()).calm;
    const b = computeMetrics(derive(shaky), emptyText()).calm;
    expect(a).toBeGreaterThan(85);
    expect(b).toBeLessThan(25);
  });

  it('가끔 떠는 정도는 중간 점수', () => {
    const st = run({
      seconds: 60,
      face: blinkingFace,
      pose: (i) => ({ ...goodPose(), legShake: i % 300 < 45 ? 0.6 : 0.02 }),
    });
    const score = computeMetrics(derive(st), emptyText()).calm;
    expect(score).toBeGreaterThan(35);
    expect(score).toBeLessThan(90);
  });
});

describe('몸짓', () => {
  it('완전히 굳어 있으면 만점은 못 받는다', () => {
    const st = run({
      seconds: 60,
      pose: () => ({ ...goodPose(), swaySpeed: 0, handSpeed: 0 }),
    });
    expect(computeMetrics(derive(st), emptyText()).gesture).toBeLessThan(92);
  });

  it('어깨가 기울고 움츠리면 깎인다', () => {
    const st = run({
      seconds: 60,
      pose: () => ({ ...goodPose(), shoulderTilt: 16, neckRatio: 0.4, selfTouch: true }),
    });
    expect(computeMetrics(derive(st), emptyText()).gesture).toBeLessThan(45);
  });
});

describe('발성', () => {
  it('목소리가 작으면 점수가 낮다', () => {
    const st = run({ seconds: 60, snr: () => 6 });
    expect(computeMetrics(derive(st), emptyText()).voice).toBeLessThan(25);
  });

  it('말끝이 흐려지면 감점된다', () => {
    // 3초짜리 발화를 반복하되 뒤쪽 25% 구간의 성량을 떨어뜨린다
    const st = run({
      seconds: 60,
      speaking: (_, t) => t % 4000 < 3000,
      snr: (_, t) => {
        const inUtterance = t % 4000;
        return inUtterance > 2200 ? 8 : 22;
      },
    });
    const d = derive(st);
    expect(st.utteranceCount).toBeGreaterThan(5);
    expect(d.trailingDrop).toBeGreaterThan(5);
    expect(computeMetrics(d, emptyText()).voice).toBeLessThan(80);
  });

  it('음성이 없으면 중립값', () => {
    const st = run({ seconds: 30, speaking: () => false });
    expect(derive(st).voiceAvailable).toBe(false);
    expect(computeMetrics(derive(st), emptyText()).voice).toBe(50);
  });
});

describe('말투 / 끊김', () => {
  it('답변 중 긴 침묵을 센다', () => {
    // 2초 발화 → 2.5초 침묵 을 반복
    const st = run({
      seconds: 45,
      speaking: (_, t) => t % 4500 < 2000,
    });
    expect(st.longPauses).toBeGreaterThanOrEqual(8);
    expect(computeMetrics(derive(st), emptyText()).speech).toBeLessThan(45);
  });

  it('짧은 숨 고르기는 긴 침묵으로 세지 않는다', () => {
    // 3초 발화 → 0.9초 침묵
    const st = run({
      seconds: 45,
      speaking: (_, t) => t % 3900 < 3000,
    });
    expect(st.longPauses).toBe(0);
    expect(st.pauseCount).toBeGreaterThan(5);
  });

  it('면접관이 말하는 동안은 음성 지표를 집계하지 않는다', () => {
    const st = emptyStats();
    for (let i = 0; i < 300; i++) {
      feed(
        st,
        {
          t: i * STEP,
          face: goodFace(),
          pose: goodPose(),
          snr: 25,
          speaking: true,
          ttsActive: true,
          answering: true,
        },
        STEP,
      );
    }
    sealStats(st);
    expect(st.voicedMs).toBe(0);
    expect(st.answerMs).toBe(0);
  });

  it('말이 너무 빠르거나 느리면 깎인다', () => {
    const st = run({ seconds: 60 });
    const d = derive(st);
    const fast = computeMetrics(d, {
      syllablesPerSec: 9,
      fillerRatio: 0.02,
      stutterPer100: 0,
      sentenceEndRatio: 0.8,
      startDelaySec: 1.5,
      available: true,
    }).speech;
    const ok = computeMetrics(d, {
      syllablesPerSec: 5,
      fillerRatio: 0.02,
      stutterPer100: 0,
      sentenceEndRatio: 0.8,
      startDelaySec: 1.5,
      available: true,
    }).speech;
    expect(fast).toBeLessThan(ok);
  });
});

describe('답변 구간 경계', () => {
  /** 답변 → 답변 아님(면접관 차례) → 답변 을 이어 붙인다 */
  function twoAnswers(gapSec: number) {
    const st = emptyStats();
    let t = 0;
    const push = (seconds: number, answering: boolean, speaking: boolean) => {
      const frames = Math.round((seconds * 1000) / STEP);
      for (let i = 0; i < frames; i++) {
        feed(st, { t, face: goodFace(), pose: goodPose(), snr: speaking ? 22 : 2, speaking, ttsActive: false, answering }, STEP);
        t += STEP;
      }
    };
    push(8, true, true); // 첫 답변
    push(2.5, true, false); // 말을 멈춰 답변이 끝남
    push(gapSec, false, false); // 면접관이 말하고 메모하는 시간
    push(8, true, true); // 다음 답변
    sealStats(st);
    return st;
  }

  it('답변 사이의 면접관 차례는 긴 침묵으로 세지 않는다', () => {
    const st = twoAnswers(30);
    expect(st.longPauses).toBe(0);
    expect(st.pauseCount).toBe(0);
    expect(derive(st).longPausePerMin).toBe(0);
  });

  it('답변 안의 진짜 긴 침묵은 여전히 센다', () => {
    const st = emptyStats();
    let t = 0;
    const push = (seconds: number, speaking: boolean) => {
      const frames = Math.round((seconds * 1000) / STEP);
      for (let i = 0; i < frames; i++) {
        feed(st, { t, face: goodFace(), pose: goodPose(), snr: speaking ? 22 : 2, speaking, ttsActive: false, answering: true }, STEP);
        t += STEP;
      }
    };
    push(5, true);
    push(2, false);
    push(5, true);
    sealStats(st);
    expect(st.longPauses).toBe(1);
  });
});

describe('말끝 흐림 — 발화 판정 꼬리 제외', () => {
  it('소리가 잦아든 뒤 0.26초쯤 더 유지되는 판정 꼬리는 흐림으로 보지 않는다', () => {
    // 3초 발화(일정한 22dB) 뒤 0.3초 동안 레벨이 22→4 로 떨어지지만 speaking 은 유지되는 상황
    const st = run({
      seconds: 60,
      speaking: (_, t) => t % 4000 < 3300,
      snr: (_, t) => {
        const u = t % 4000;
        if (u < 3000) return 22;
        return 22 - ((u - 3000) / 300) * 18;
      },
    });
    const d = derive(st);
    expect(st.utteranceCount).toBeGreaterThan(5);
    expect(d.trailingDrop).toBeLessThan(1.5);
    expect(computeMetrics(d, emptyText()).voice).toBeGreaterThan(85);
  });
});

describe('말투 — 침묵과 시작 지연', () => {
  const text = (over: Partial<TextStats> = {}): TextStats => ({
    syllablesPerSec: 5,
    fillerRatio: 0.02,
    stutterPer100: 0.4,
    sentenceEndRatio: 0.8,
    startDelaySec: 1.5,
    available: true,
    ...over,
  });

  it('답변 시간 대부분이 침묵이면 끊김이 없어도 점수가 낮다', () => {
    // 60초 중 6초만 말함 (한 번에 이어서) → 끊김 0회
    const st = run({ seconds: 60, speaking: (_, t) => t < 6000 });
    const d = derive(st);
    expect(d.voiceRatio).toBeLessThan(0.15);
    expect(computeMetrics(d, emptyText()).speech).toBeLessThanOrEqual(30);
  });

  it('답변을 시작하기까지 오래 걸리면 깎인다', () => {
    const st = run({ seconds: 60 });
    const d = derive(st);
    const quick = computeMetrics(d, text({ startDelaySec: 1.5 })).speech;
    const slow = computeMetrics(d, text({ startDelaySec: 14 })).speech;
    expect(slow).toBeLessThan(quick - 9);
  });

  it('textStatsOf: 시작 지연은 침묵한 답변까지 포함해 평균낸다', () => {
    const speech = (wordCount: number) => ({
      syllables: wordCount * 3,
      syllablesPerSec: 5,
      fillerCount: 0,
      fillerRatio: 0,
      stutterCount: 0,
      longPauses: 0,
      sentenceEndRatio: 1,
      wordCount,
    });
    const t = textStatsOf([
      { speech: speech(40), voicedSec: 20, latencySec: 2 },
      { speech: speech(0), voicedSec: 0, latencySec: 40 }, // 침묵 — 말투 통계엔 안 들어가지만 지연에는 들어간다
    ]);
    expect(t.available).toBe(true);
    expect(t.startDelaySec).toBe(21);
    expect(t.syllablesPerSec).toBeCloseTo(6, 0);
  });
});

describe('리포트 총평은 나쁜 세부 지표를 먼저 말한다', () => {
  it('점수가 높아도 얼굴 만지기가 나쁨이면 그걸 말한다', () => {
    const st = run({
      seconds: 60,
      pose: (i) => ({ ...goodPose(), selfTouch: i % 10 < 4 }), // 40%
    });
    const d = derive(st);
    const m = computeMetrics(d, emptyText());
    const gesture = buildBreakdown(d, emptyText(), m).find((b) => b.key === 'gesture')!;
    expect(gesture.score).toBeGreaterThan(75);
    expect(gesture.summary).toContain('얼굴');
    expect(gesture.summary).not.toContain('안정적');
  });

  it('나쁜 지표가 없고 점수가 높으면 칭찬한다', () => {
    const st = run({ seconds: 60, face: blinkingFace });
    const d = derive(st);
    const m = computeMetrics(d, emptyText());
    const gesture = buildBreakdown(d, emptyText(), m).find((b) => b.key === 'gesture')!;
    expect(gesture.summary).toContain('안정적');
  });
});

describe('실시간 창의 말투 점수', () => {
  it('답변을 막 시작한 짧은 창에서는 침묵 상한을 적용하지 않는다', () => {
    // 3초짜리 창: 답변 시작 직후라 아직 말이 없다
    const st = run({ seconds: 3, speaking: () => false });
    const d = derive(st);
    expect(d.answerSec).toBeLessThan(8);
    expect(computeMetrics(d, emptyText()).speech).toBeGreaterThan(60);
  });
});
