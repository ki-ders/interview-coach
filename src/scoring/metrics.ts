import type { AnswerRecord, FaceSample, LiveMetrics, MetricBreakdown, MetricKey, PoseSample } from '../types';
import { bandScore, clamp, higherBetter, lowerBetter, weighted } from '../lib/signal';

export interface Sample {
  t: number;
  face: FaceSample | null;
  pose: PoseSample | null;
  /** 배경 소음 대비 dB */
  snr: number;
  speaking: boolean;
  /** 면접관이 말하는 중이면 음성 지표는 집계하지 않는다 */
  ttsActive: boolean;
  /** 답변 구간인지 (음성 지표는 답변 중에만 의미가 있다) */
  answering: boolean;
}

export interface RawStats {
  ms: number;

  faceMs: number;
  noFaceMs: number;
  onTargetMs: number;
  downMs: number;
  gazeSum: number;
  gazeSqSum: number;
  gazeN: number;
  blinks: number;
  private_lastBlink: boolean;

  poseMs: number;
  tiltSum: number;
  neckSum: number;
  swaySum: number;
  handSum: number;
  poseN: number;
  selfTouchMs: number;
  legShakeSum: number;
  legShakeMs: number;
  legN: number;
  handFidgetSum: number;

  voicedMs: number;
  answerMs: number;
  snrSum: number;
  snrSqSum: number;
  snrN: number;
  weakMs: number;

  /** 발화 조각 추적 (말끝 흐림 계산용) — snr 값과 그 시각 */
  private_utterance: number[];
  private_utteranceT: number[];
  private_utteranceStart: number;
  trailingDropSum: number;
  utteranceCount: number;

  /** 무음 구간 추적 */
  private_silenceStart: number;
  pauseCount: number;
  longPauses: number;
}

export function emptyStats(): RawStats {
  return {
    ms: 0,
    faceMs: 0,
    noFaceMs: 0,
    onTargetMs: 0,
    downMs: 0,
    gazeSum: 0,
    gazeSqSum: 0,
    gazeN: 0,
    blinks: 0,
    private_lastBlink: false,
    poseMs: 0,
    tiltSum: 0,
    neckSum: 0,
    swaySum: 0,
    handSum: 0,
    poseN: 0,
    selfTouchMs: 0,
    legShakeSum: 0,
    legShakeMs: 0,
    legN: 0,
    handFidgetSum: 0,
    voicedMs: 0,
    answerMs: 0,
    snrSum: 0,
    snrSqSum: 0,
    snrN: 0,
    weakMs: 0,
    private_utterance: [],
    private_utteranceT: [],
    private_utteranceStart: 0,
    trailingDropSum: 0,
    utteranceCount: 0,
    private_silenceStart: 0,
    pauseCount: 0,
    longPauses: 0,
  };
}

const mean = (a: number[]) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);

/** 발화 판정은 소리가 잦아든 뒤에도 잠깐(히스테리시스) 유지되므로, 그 꼬리는 말끝 흐림 계산에서 뺀다 */
const UTTERANCE_TAIL_MS = 300;

function closeUtterance(st: RawStats) {
  const ts = st.private_utteranceT;
  const lastT = ts.length ? ts[ts.length - 1] : 0;
  let cut = ts.length;
  while (cut > 0 && lastT - ts[cut - 1] < UTTERANCE_TAIL_MS) cut--;
  const u = st.private_utterance.slice(0, cut);
  if (u.length >= 12) {
    const head = u.slice(0, Math.max(3, Math.floor(u.length * 0.6)));
    const tail = u.slice(Math.floor(u.length * 0.75));
    st.trailingDropSum += mean(head) - mean(tail);
    st.utteranceCount++;
  }
  st.private_utterance = [];
  st.private_utteranceT = [];
  st.private_utteranceStart = 0;
}

export function feed(st: RawStats, s: Sample, dtMs: number) {
  const dt = clamp(dtMs, 0, 250);
  st.ms += dt;

  /* 시선 */
  if (s.face) {
    st.faceMs += dt;
    if (s.face.onTarget) st.onTargetMs += dt;
    if (s.face.lookingDown) st.downMs += dt;
    st.gazeSum += s.face.yawDev;
    st.gazeSqSum += s.face.yawDev * s.face.yawDev;
    st.gazeN++;
    if (s.face.blink && !st.private_lastBlink) st.blinks++;
    st.private_lastBlink = s.face.blink;
  } else {
    st.noFaceMs += dt;
    st.private_lastBlink = false;
  }

  /* 자세 / 떨림 */
  if (s.pose) {
    st.poseMs += dt;
    st.tiltSum += s.pose.shoulderTilt;
    st.neckSum += s.pose.neckRatio;
    st.swaySum += s.pose.swaySpeed;
    st.handSum += s.pose.handSpeed;
    st.poseN++;
    if (s.pose.selfTouch) st.selfTouchMs += dt;
    st.legShakeSum += s.pose.legShake;
    st.handFidgetSum += s.pose.handFidget;
    st.legN++;
    if (s.pose.legShake > 0.35) st.legShakeMs += dt;
  }

  /* 음성 — 면접관이 말하는 중에는 집계 제외 */
  if (s.answering && !s.ttsActive) {
    st.answerMs += dt;
    if (s.speaking) {
      st.voicedMs += dt;
      st.snrSum += s.snr;
      st.snrSqSum += s.snr * s.snr;
      st.snrN++;
      if (s.snr < 12) st.weakMs += dt;

      if (!st.private_utteranceStart) st.private_utteranceStart = s.t;
      st.private_utterance.push(s.snr);
      st.private_utteranceT.push(s.t);

      // 무음 구간이 끝났다
      if (st.private_silenceStart) {
        const gap = s.t - st.private_silenceStart;
        if (gap > 1500) st.longPauses++;
        else if (gap > 800) st.pauseCount++;
        st.private_silenceStart = 0;
      }
    } else {
      if (st.private_utteranceStart) closeUtterance(st);
      // 답변 중 발화가 한 번이라도 있었을 때만 무음을 "끊김"으로 본다
      if (!st.private_silenceStart && st.voicedMs > 300) st.private_silenceStart = s.t;
    }
  } else {
    // 답변 구간 밖(면접관 발화·메모 시간)에서는 추적을 끊는다.
    // 안 끊으면 다음 답변의 첫 마디가 "수십 초짜리 긴 침묵" 뒤에 온 것으로 잡힌다.
    if (st.private_utteranceStart) closeUtterance(st);
    st.private_silenceStart = 0;
  }
}

/** 집계를 마무리한다 (열려 있는 발화 조각 정리) */
export function sealStats(st: RawStats) {
  if (st.private_utteranceStart) closeUtterance(st);
  st.private_silenceStart = 0;
}

export interface DerivedStats {
  /** 얼굴/포즈/음성 데이터가 실제로 수집됐는지 */
  faceAvailable: boolean;
  poseAvailable: boolean;
  voiceAvailable: boolean;

  onTargetRatio: number;
  downRatio: number;
  gazeStd: number;
  blinkPerMin: number;
  faceCoverage: number;

  tiltAvg: number;
  neckAvg: number;
  swayAvg: number;
  handAvg: number;
  selfTouchRatio: number;

  legShakeAvg: number;
  legShakeRatio: number;
  handFidgetAvg: number;

  /** 집계된 답변 구간 길이(초). 짧으면 발화 비율 같은 비율 지표를 믿을 수 없다 */
  answerSec: number;
  voiceRatio: number;
  snrAvg: number;
  snrStd: number;
  weakRatio: number;
  trailingDrop: number;
  pausePerMin: number;
  longPausePerMin: number;
}

export function derive(st: RawStats): DerivedStats {
  const face = Math.max(st.faceMs, 1);
  const pose = Math.max(st.poseN, 1);
  const answer = Math.max(st.answerMs, 1);
  const gazeMean = st.gazeN ? st.gazeSum / st.gazeN : 0;
  const gazeVar = st.gazeN > 1 ? st.gazeSqSum / st.gazeN - gazeMean * gazeMean : 0;
  const snrMean = st.snrN ? st.snrSum / st.snrN : 0;
  const snrVar = st.snrN > 1 ? st.snrSqSum / st.snrN - snrMean * snrMean : 0;
  const minutes = Math.max(st.ms / 60000, 1 / 60);
  const answerMin = Math.max(st.answerMs / 60000, 1 / 60);

  return {
    faceAvailable: st.gazeN > 30,
    poseAvailable: st.poseN > 30,
    voiceAvailable: st.snrN > 30,

    onTargetRatio: st.onTargetMs / face,
    downRatio: st.downMs / face,
    gazeStd: Math.sqrt(Math.max(gazeVar, 0)),
    blinkPerMin: st.blinks / minutes,
    faceCoverage: st.ms > 0 ? st.faceMs / st.ms : 0,

    tiltAvg: st.tiltSum / pose,
    neckAvg: st.neckSum / pose,
    swayAvg: st.swaySum / pose,
    handAvg: st.handSum / pose,
    selfTouchRatio: st.poseMs > 0 ? st.selfTouchMs / st.poseMs : 0,

    legShakeAvg: st.legN ? st.legShakeSum / st.legN : 0,
    legShakeRatio: st.poseMs > 0 ? st.legShakeMs / st.poseMs : 0,
    handFidgetAvg: st.legN ? st.handFidgetSum / st.legN : 0,

    answerSec: st.answerMs / 1000,
    voiceRatio: st.voicedMs / answer,
    snrAvg: snrMean,
    snrStd: Math.sqrt(Math.max(snrVar, 0)),
    weakRatio: st.voicedMs > 0 ? st.weakMs / st.voicedMs : 0,
    trailingDrop: st.utteranceCount ? st.trailingDropSum / st.utteranceCount : 0,
    pausePerMin: st.pauseCount / answerMin,
    longPausePerMin: st.longPauses / answerMin,
  };
}

/** 텍스트 기반 지표 (없으면 음성 지표만으로 채점) */
export interface TextStats {
  syllablesPerSec: number;
  fillerRatio: number;
  stutterPer100: number;
  sentenceEndRatio: number;
  /** 질문이 끝나고 첫 마디까지 걸린 평균 시간(초). 침묵한 답변은 답변 시간 전체로 본다 */
  startDelaySec: number;
  /** 또박또박함 — 음성 인식기의 평균 신뢰도(0~1). 브라우저가 주지 않으면 null */
  clarity: number | null;
  available: boolean;
}

export const emptyText = (): TextStats => ({
  syllablesPerSec: 0,
  fillerRatio: 0,
  stutterPer100: 0,
  sentenceEndRatio: 0,
  startDelaySec: 0,
  clarity: null,
  available: false,
});

/** 답변 기록들을 합쳐 텍스트 지표를 만든다. 받아쓰기가 4어절 미만인 답변은 말투 통계에서 뺀다 */
export function textStatsOf(
  items: Pick<AnswerRecord, 'speech' | 'voicedSec' | 'latencySec' | 'clarity'>[],
): TextStats {
  const usable = items.filter((i) => i.speech.wordCount >= 4);
  if (!usable.length) return emptyText();
  let syll = 0;
  let voiced = 0;
  let fillers = 0;
  let words = 0;
  let stutters = 0;
  let endSum = 0;
  for (const i of usable) {
    syll += i.speech.syllables;
    voiced += Math.max(i.voicedSec, 0.5);
    fillers += i.speech.fillerCount;
    words += i.speech.wordCount;
    stutters += i.speech.stutterCount;
    endSum += i.speech.sentenceEndRatio;
  }
  // 시작 지연은 침묵한 답변까지 포함해야 "말을 안 한 것"이 반영된다
  const delay = items.reduce((s, i) => s + i.latencySec, 0) / items.length;
  const withClarity = usable.filter((i) => i.clarity !== null && i.clarity !== undefined);
  const clarity = withClarity.length
    ? withClarity.reduce((s, i) => s + (i.clarity as number), 0) / withClarity.length
    : null;
  return {
    syllablesPerSec: syll / Math.max(voiced, 1),
    fillerRatio: words ? fillers / words : 0,
    stutterPer100: words ? (stutters / words) * 100 : 0,
    sentenceEndRatio: endSum / usable.length,
    startDelaySec: delay,
    clarity,
    available: true,
  };
}

export function scoreGaze(d: DerivedStats): number {
  if (!d.faceAvailable) return 50;
  if (d.faceCoverage < 0.15) return 0;
  return weighted([
    [bandScore(d.onTargetRatio, { ideal: [0.6, 0.93], zero: [0.3, 1.5] }), 0.45],
    [lowerBetter(d.downRatio, 0.08, 0.45), 0.2],
    [lowerBetter(d.gazeStd, 0.2, 0.85), 0.2],
    [bandScore(d.blinkPerMin, { ideal: [8, 26], zero: [1, 60] }), 0.15],
  ]);
}

export function scoreGesture(d: DerivedStats): number {
  if (!d.poseAvailable) return 50;
  return weighted([
    [lowerBetter(d.tiltAvg, 3, 14), 0.21],
    [bandScore(d.neckAvg, { ideal: [0.75, 1.35], zero: [0.3, 2.0] }), 0.27],
    [bandScore(d.swayAvg, { ideal: [0.02, 0.22], zero: [-0.02, 1.1] }), 0.17],
    [bandScore(d.handAvg, { ideal: [0.05, 0.7], zero: [-0.06, 2.6] }), 0.17],
    [lowerBetter(d.selfTouchRatio, 0.03, 0.3), 0.18],
  ]);
}

export function scoreSpeech(d: DerivedStats, t: TextStats): number {
  // "절지는 않았는지"가 핵심이므로 막힘(긴 침묵)에 가장 큰 비중을 둔다
  const parts: [number, number][] = [
    [lowerBetter(d.longPausePerMin, 1.2, 8), 0.5],
    [lowerBetter(d.pausePerMin, 6, 22), 0.2],
    [bandScore(d.voiceRatio, { ideal: [0.55, 0.92], zero: [0.15, 1.05] }), 0.2],
  ];
  if (t.available) {
    parts.push([lowerBetter(t.startDelaySec, 3, 12), 0.22]);
    parts.push([bandScore(t.syllablesPerSec, { ideal: [3.8, 6.2], zero: [1.3, 9.8] }), 0.3]);
    parts.push([lowerBetter(t.fillerRatio, 0.03, 0.18), 0.2]);
    parts.push([lowerBetter(t.stutterPer100, 1, 9), 0.22]);
    parts.push([higherBetter(t.sentenceEndRatio, 0.3, 0.85), 0.12]);
    // 또박또박함: 인식기가 자신 있게 받아 적었는지
    if (t.clarity !== null) parts.push([higherBetter(t.clarity, 0.55, 0.92), 0.25]);
  }
  // 답변 시간 대부분을 침묵으로 보냈다면 끊김이 없어도 "매끄러웠다"고 할 수 없다.
  // 단, 답변을 막 시작한 실시간 창(몇 초)에서는 비율이 의미 없으므로 적용하지 않는다.
  const ceiling = d.answerSec >= 8 ? 25 + higherBetter(d.voiceRatio, 0.1, 0.5) * 0.75 : 100;
  return Math.min(weighted(parts), ceiling);
}

export function scoreVoice(d: DerivedStats): number {
  if (!d.voiceAvailable) return 50;
  const base = weighted([
    [higherBetter(d.snrAvg, 9, 24), 0.45],
    [lowerBetter(d.weakRatio, 0.12, 0.6), 0.2],
    [lowerBetter(d.snrStd, 6, 16), 0.15],
    [lowerBetter(d.trailingDrop, 2.5, 10), 0.2],
  ]);
  // 아무리 일정하게 말해도 전반적으로 들리지 않으면 높은 점수를 줄 수 없다
  const ceiling = 12 + higherBetter(d.snrAvg, 6, 20) * 0.88;
  return Math.min(base, ceiling);
}

export function scoreCalm(d: DerivedStats): number {
  if (!d.poseAvailable && !d.faceAvailable) return 50;
  const base = weighted([
    [lowerBetter(d.legShakeRatio, 0.04, 0.4), 0.35],
    [lowerBetter(d.legShakeAvg, 0.1, 0.5), 0.2],
    [lowerBetter(d.handFidgetAvg, 0.12, 0.5), 0.2],
    [lowerBetter(d.gazeStd, 0.25, 0.9), 0.1],
    [bandScore(d.blinkPerMin, { ideal: [8, 28], zero: [1, 65] }), 0.15],
  ]);
  // 다리를 계속 떨고 있으면 다른 지표가 좋아도 침착해 보이지 않는다
  const ceiling = 100 - clamp(d.legShakeRatio, 0, 1) * 85;
  return Math.min(base, ceiling);
}

export function computeMetrics(d: DerivedStats, t: TextStats): LiveMetrics {
  return {
    gaze: clamp(Math.round(scoreGaze(d)), 0, 100),
    gesture: clamp(Math.round(scoreGesture(d)), 0, 100),
    speech: clamp(Math.round(scoreSpeech(d, t)), 0, 100),
    voice: clamp(Math.round(scoreVoice(d)), 0, 100),
    calm: clamp(Math.round(scoreCalm(d)), 0, 100),
  };
}

export const METRIC_LABELS: Record<MetricKey, string> = {
  gaze: '시선 처리',
  gesture: '몸짓의 자연스러움',
  speech: '말투와 전달',
  voice: '발성 크기',
  calm: '안정감',
};

export const METRIC_ICONS: Record<MetricKey, string> = {
  gaze: '눈',
  gesture: '몸',
  speech: '말',
  voice: '성',
  calm: '안',
};

type Verdict = 'good' | 'warn' | 'bad';
const v = (score: number): Verdict => (score >= 75 ? 'good' : score >= 50 ? 'warn' : 'bad');
const pct = (x: number) => `${Math.round(x * 100)}%`;

/** 세부 지표 한 줄 + 그것이 나쁠 때 총평에 쓸 문장 */
interface DetailSpec {
  label: string;
  value: string;
  score: number;
  /** 이 지표가 'bad' 일 때 총평 문장 (없으면 총평 후보에서 제외) */
  issue?: string;
}

/**
 * 총평은 점수만 보고 고르지 않는다. 세부 지표 중 '나쁨'이 하나라도 있으면 그중 가장 낮은 것을
 * 먼저 말한다 — 점수가 82점인데 "얼굴 만지기 36% (나쁨)" 이 붙어 있으면 "자세가 안정적" 이라고
 * 쓸 수 없기 때문이다.
 */
function summarize(specs: DetailSpec[], score: number, good: string, fallback: string): string {
  const worst = specs.filter((s) => s.issue && v(s.score) === 'bad').sort((a, b) => a.score - b.score)[0];
  if (worst?.issue) return worst.issue;
  if (score >= 85) return good;
  // 점수가 아주 높지는 않은데 '주의' 지표가 있으면 그것을 말해 준다
  const warn = specs.filter((s) => s.issue && v(s.score) === 'warn').sort((a, b) => a.score - b.score)[0];
  if (warn?.issue) return warn.issue;
  return score >= 78 ? good : fallback;
}

const toDetails = (specs: DetailSpec[]): MetricBreakdown['details'] =>
  specs.map((s) => ({ label: s.label, value: s.value, verdict: v(s.score) }));

export function buildBreakdown(d: DerivedStats, t: TextStats, m: LiveMetrics): MetricBreakdown[] {
  const out: MetricBreakdown[] = [];

  /* ── 시선 ── */
  const gaze: DetailSpec[] = [
    {
      label: '정면 응시 비율',
      value: pct(d.onTargetRatio),
      score: bandScore(d.onTargetRatio, { ideal: [0.6, 0.93], zero: [0.3, 1.5] }),
      issue:
        d.onTargetRatio > 0.93
          ? '한 곳만 계속 응시해 다소 경직돼 보였습니다.'
          : '카메라를 바라본 시간이 부족했습니다.',
    },
    {
      label: '아래를 본 비율',
      value: pct(d.downRatio),
      score: lowerBetter(d.downRatio, 0.08, 0.45),
      issue: '시선이 아래로 내려가 있는 시간이 길었습니다.',
    },
    {
      label: '시선 흔들림',
      value: d.gazeStd.toFixed(2),
      score: lowerBetter(d.gazeStd, 0.2, 0.85),
      issue: '시선이 좌우로 흔들렸습니다.',
    },
    {
      label: '분당 눈 깜빡임',
      value: `${Math.round(d.blinkPerMin)}회`,
      score: bandScore(d.blinkPerMin, { ideal: [8, 26], zero: [1, 60] }),
      issue: d.blinkPerMin > 26 ? '눈을 자주 깜빡여 긴장한 인상을 줬습니다.' : '눈을 거의 깜빡이지 않아 경직돼 보였습니다.',
    },
  ];
  out.push({
    key: 'gaze',
    label: METRIC_LABELS.gaze,
    score: m.gaze,
    summary:
      d.faceCoverage < 0.5
        ? '얼굴이 화면에서 자주 벗어났습니다. 카메라 위치를 조정해 주세요.'
        : summarize(gaze, m.gaze, '카메라를 안정적으로 바라봤습니다.', '시선 처리가 조금 불안정했습니다.'),
    details: toDetails(gaze),
    tips: gazeTips(d),
  });

  /* ── 몸짓 ── */
  const gesture: DetailSpec[] = [
    {
      label: '어깨 기울기',
      value: `${d.tiltAvg.toFixed(1)}°`,
      score: lowerBetter(d.tiltAvg, 3, 14),
      issue: '어깨가 한쪽으로 기울어 있었습니다.',
    },
    {
      label: '상체 자세',
      value: d.neckAvg < 0.75 ? '움츠림' : d.neckAvg > 1.35 ? '목 내밈' : '양호',
      score: bandScore(d.neckAvg, { ideal: [0.75, 1.35], zero: [0.3, 2.0] }),
      issue: d.neckAvg < 0.75 ? '어깨가 올라가고 목이 움츠러들어 있었습니다.' : '목을 앞으로 내민 자세가 오래 이어졌습니다.',
    },
    {
      label: '몸 흔들림',
      value: d.swayAvg < 0.02 ? '거의 없음' : d.swayAvg > 0.22 ? '과함' : '적당',
      score: bandScore(d.swayAvg, { ideal: [0.02, 0.22], zero: [-0.02, 1.1] }),
      issue: d.swayAvg > 0.22 ? '상체가 계속 움직여 산만해 보였습니다.' : '상체가 거의 움직이지 않아 경직돼 보였습니다.',
    },
    {
      label: '손동작',
      value: d.handAvg < 0.05 ? '거의 없음' : d.handAvg > 0.7 ? '산만함' : '적당',
      score: bandScore(d.handAvg, { ideal: [0.05, 0.7], zero: [-0.06, 2.6] }),
      issue: d.handAvg > 0.7 ? '손동작이 많아 산만해 보였습니다.' : '손이 거의 움직이지 않아 경직돼 보였습니다.',
    },
    {
      label: '얼굴·머리 만지기',
      value: pct(d.selfTouchRatio),
      score: lowerBetter(d.selfTouchRatio, 0.03, 0.3),
      issue: '얼굴이나 머리를 만지는 습관이 자주 보였습니다.',
    },
  ];
  out.push({
    key: 'gesture',
    label: METRIC_LABELS.gesture,
    score: m.gesture,
    summary: !d.poseAvailable
      ? '상체가 충분히 보이지 않아 정확도가 낮습니다.'
      : summarize(gesture, m.gesture, '자세가 안정적이고 움직임이 자연스러웠습니다.', '자세나 손동작에서 어색함이 감지됐습니다.'),
    details: toDetails(gesture),
    tips: gestureTips(d),
  });

  /* ── 말투 ── */
  const speech: DetailSpec[] = [
    {
      label: '긴 침묵 (분당)',
      value: `${d.longPausePerMin.toFixed(1)}회`,
      score: lowerBetter(d.longPausePerMin, 1.2, 8),
      issue: '말이 자주 막혔습니다. 문장을 짧게 끊어 말해보세요.',
    },
    {
      label: '짧은 멈춤 (분당)',
      value: `${d.pausePerMin.toFixed(1)}회`,
      score: lowerBetter(d.pausePerMin, 6, 22),
      issue: '말의 흐름이 자주 끊겼습니다.',
    },
    {
      label: '실제 발화 비율',
      value: pct(d.voiceRatio),
      score: bandScore(d.voiceRatio, { ideal: [0.55, 0.92], zero: [0.15, 1.05] }),
      issue:
        d.voiceRatio < 0.55
          ? '답변 시간의 상당 부분이 침묵이었습니다. 짧게라도 말을 이어가는 것이 낫습니다.'
          : '쉼 없이 말이 이어져 듣는 사람이 따라가기 어려웠을 수 있습니다.',
    },
  ];
  if (t.available) {
    speech.push(
      {
        label: '답변 시작까지',
        value: `${t.startDelaySec.toFixed(1)}초`,
        score: lowerBetter(t.startDelaySec, 3, 12),
        issue: '질문을 받고 답변을 시작하기까지 오래 걸렸습니다. 첫 문장을 먼저 정해 두세요.',
      },
      {
        label: '말 속도',
        value: `${t.syllablesPerSec.toFixed(1)} 음절/초`,
        score: bandScore(t.syllablesPerSec, { ideal: [3.8, 6.2], zero: [1.3, 9.8] }),
        issue: t.syllablesPerSec > 6.2 ? '말이 다소 빨랐습니다.' : '말이 다소 느렸습니다.',
      },
      {
        label: '간투사 비율',
        value: pct(t.fillerRatio),
        score: lowerBetter(t.fillerRatio, 0.03, 0.18),
        issue: '"어, 음, 그" 같은 간투사가 많았습니다.',
      },
      {
        label: '더듬은 횟수 (100어절당)',
        value: `${t.stutterPer100.toFixed(1)}회`,
        score: lowerBetter(t.stutterPer100, 1, 9),
        issue: '같은 말을 반복하거나 더듬는 경우가 잦았습니다.',
      },
      {
        label: '문장 마무리',
        value: pct(t.sentenceEndRatio),
        score: higherBetter(t.sentenceEndRatio, 0.3, 0.85),
        issue: '문장을 끝맺지 않고 흐리는 경우가 많았습니다.',
      },
    );
    if (t.clarity !== null) {
      speech.push({
        label: '또박또박함 (인식 신뢰도)',
        value: pct(t.clarity),
        score: higherBetter(t.clarity, 0.55, 0.92),
        issue: '발음이 뭉개져 인식기가 자신 없게 받아 적었습니다. 입을 크게 벌리고 문장 끝까지 힘을 유지하세요.',
      });
    }
  }
  out.push({
    key: 'speech',
    label: METRIC_LABELS.speech,
    score: m.speech,
    summary: summarize(speech, m.speech, '전달이 대체로 매끄러웠습니다.', '말의 흐름이 조금 불안정했습니다.'),
    details: toDetails(speech),
    tips: speechTips(d, t),
  });

  /* ── 발성 ── */
  const voice: DetailSpec[] = [
    {
      label: '평균 성량 (소음 대비)',
      value: `+${d.snrAvg.toFixed(1)} dB`,
      score: higherBetter(d.snrAvg, 9, 24),
      issue: d.snrAvg < 12 ? '목소리가 배경 소음에 묻힐 정도로 작았습니다.' : '성량이 조금 부족했습니다.',
    },
    {
      label: '작게 말한 비율',
      value: pct(d.weakRatio),
      score: lowerBetter(d.weakRatio, 0.12, 0.6),
      issue: '작게 말한 구간이 많았습니다.',
    },
    {
      label: '성량 기복',
      value: `${d.snrStd.toFixed(1)} dB`,
      score: lowerBetter(d.snrStd, 6, 16),
      issue: '성량이 들쭉날쭉했습니다.',
    },
    {
      label: '말끝 흐림',
      value: `${d.trailingDrop.toFixed(1)} dB`,
      score: lowerBetter(d.trailingDrop, 2.5, 10),
      issue: '문장 끝에서 목소리가 눈에 띄게 작아졌습니다.',
    },
  ];
  out.push({
    key: 'voice',
    label: METRIC_LABELS.voice,
    score: m.voice,
    summary: !d.voiceAvailable
      ? '답변 중 음성이 충분히 잡히지 않았습니다.'
      : summarize(voice, m.voice, '발성 크기가 안정적이었습니다.', '성량이 조금 부족하거나 들쭉날쭉했습니다.'),
    details: toDetails(voice),
    tips: voiceTips(d),
  });

  /* ── 안정감 ── */
  const calm: DetailSpec[] = [
    {
      label: '다리 떨림 시간',
      value: pct(d.legShakeRatio),
      score: lowerBetter(d.legShakeRatio, 0.04, 0.4),
      issue: '다리 떨림이 반복적으로 감지됐습니다.',
    },
    {
      label: '다리 떨림 강도',
      value: d.legShakeAvg.toFixed(2),
      score: lowerBetter(d.legShakeAvg, 0.1, 0.5),
      issue: '다리 떨림이 감지됐습니다.',
    },
    {
      label: '손 만지작거림',
      value: d.handFidgetAvg.toFixed(2),
      score: lowerBetter(d.handFidgetAvg, 0.12, 0.5),
      issue: '손을 반복적으로 움직이는 모습이 있었습니다.',
    },
    {
      label: '분당 눈 깜빡임',
      value: `${Math.round(d.blinkPerMin)}회`,
      score: bandScore(d.blinkPerMin, { ideal: [8, 28], zero: [1, 65] }),
      issue: d.blinkPerMin > 28 ? '눈을 자주 깜빡여 긴장한 인상을 줬습니다.' : undefined,
    },
  ];
  out.push({
    key: 'calm',
    label: METRIC_LABELS.calm,
    score: m.calm,
    summary: summarize(calm, m.calm, '전반적으로 침착해 보였습니다.', '긴장한 신호가 간간이 보였습니다.'),
    details: toDetails(calm),
    tips: calmTips(d),
  });

  return out;
}

function gazeTips(d: DerivedStats): string[] {
  const tips: string[] = [];
  if (d.faceCoverage < 0.6) tips.push('얼굴 전체가 화면 안에 들어오도록 카메라를 눈높이에 맞춰 주세요.');
  if (d.onTargetRatio < 0.5)
    tips.push('답변할 때 카메라 렌즈를 보세요. 화면 속 자기 얼굴을 보면 시선이 아래로 내려갑니다.');
  if (d.onTargetRatio > 0.96)
    tips.push('한 곳만 계속 응시하면 경직돼 보입니다. 문장이 바뀔 때 아주 살짝 시선을 옮겨 보세요.');
  if (d.downRatio > 0.2) tips.push('아래를 보는 시간이 깁니다. 메모를 볼 때도 3초 이상 넘기지 마세요.');
  if (d.gazeStd > 0.5) tips.push('시선이 좌우로 흔들립니다. 답변 전 한 박자 쉬고 시선을 고정한 뒤 말하세요.');
  if (!tips.length) tips.push('시선 처리는 좋습니다. 지금 습관을 유지하세요.');
  return tips;
}

function gestureTips(d: DerivedStats): string[] {
  const tips: string[] = [];
  if (d.tiltAvg > 6) tips.push('어깨가 한쪽으로 기울어 있습니다. 양쪽 어깨 높이를 맞추고 앉아 보세요.');
  if (d.neckAvg < 0.75) tips.push('어깨가 올라가고 목이 움츠러들었습니다. 숨을 내쉬며 어깨를 내려 보세요.');
  if (d.neckAvg > 1.35) tips.push('목을 앞으로 내밀고 있습니다. 귀와 어깨가 일직선이 되게 해보세요.');
  if (d.handAvg < 0.05) tips.push('손이 거의 움직이지 않아 경직돼 보입니다. 핵심 단어에서 가볍게 손짓을 더해 보세요.');
  if (d.handAvg > 0.7) tips.push('손동작이 많아 산만해 보입니다. 손은 책상이나 무릎 위에 기본 위치를 두세요.');
  if (d.selfTouchRatio > 0.08) tips.push('얼굴이나 머리를 만지는 습관이 보입니다. 긴장 신호로 읽힙니다.');
  if (d.swayAvg > 0.22) tips.push('상체가 계속 움직입니다. 등을 의자 등받이에 가볍게 붙여 고정해 보세요.');
  if (!tips.length) tips.push('자세와 몸짓이 안정적입니다.');
  return tips;
}

function speechTips(d: DerivedStats, t: TextStats): string[] {
  const tips: string[] = [];
  if (d.longPausePerMin > 3)
    tips.push('말이 자주 막혔습니다. 답변 첫 문장을 "결론부터" 말하는 연습을 해보세요.');
  if (d.voiceRatio < 0.5) tips.push('말하는 시간보다 멈춰 있는 시간이 깁니다. 문장을 미리 짧게 준비하세요.');
  if (t.available && t.startDelaySec > 5)
    tips.push('답변을 시작하기까지 오래 걸립니다. 질문을 한 문장으로 되짚으며 시작하면 시간을 벌 수 있습니다.');
  if (t.available && t.syllablesPerSec > 6.2) tips.push('말이 빠릅니다. 문장 사이에 0.5초씩 쉬어 보세요.');
  if (t.available && t.syllablesPerSec < 3.8 && t.syllablesPerSec > 0)
    tips.push('말이 느립니다. 조금 더 또렷하고 빠르게 이어가면 자신감 있어 보입니다.');
  if (t.available && t.fillerRatio > 0.08)
    tips.push('"어, 음, 그" 같은 간투사가 많습니다. 그 자리를 짧은 침묵으로 바꿔 보세요.');
  if (t.available && t.stutterPer100 > 3) tips.push('같은 단어를 반복하는 습관이 있습니다. 한 박자 쉬고 문장을 새로 시작해 보세요.');
  if (t.available && t.sentenceEndRatio < 0.4)
    tips.push('문장을 끝맺지 않고 흐리는 경우가 많습니다. "~입니다"로 확실히 닫아 주세요.');
  if (!tips.length) tips.push('말의 흐름이 자연스럽습니다.');
  return tips;
}

function voiceTips(d: DerivedStats): string[] {
  const tips: string[] = [];
  if (d.snrAvg < 12) tips.push('목소리가 작습니다. 배에 힘을 주고 평소보다 한 단계 크게 말해 보세요.');
  if (d.weakRatio > 0.25) tips.push('전체 발화의 상당 부분이 작았습니다. 첫 문장부터 성량을 올려 시작하세요.');
  if (d.trailingDrop > 3.5) tips.push('문장 끝에서 목소리가 줄어듭니다. 마지막 어미까지 힘을 유지하세요.');
  if (d.snrStd > 9) tips.push('성량이 들쭉날쭉합니다. 일정한 호흡으로 문장을 끌고 가 보세요.');
  if (!tips.length) tips.push('발성 크기가 적절합니다.');
  return tips;
}

function calmTips(d: DerivedStats): string[] {
  const tips: string[] = [];
  if (d.legShakeRatio > 0.08)
    tips.push('다리 떨림이 감지됐습니다. 두 발을 바닥에 완전히 붙이면 떨림이 크게 줄어듭니다.');
  if (d.handFidgetAvg > 0.25) tips.push('손을 반복해서 움직입니다. 손을 가볍게 포개어 두세요.');
  if (d.blinkPerMin > 30) tips.push('눈 깜빡임이 많습니다. 긴장 신호로 보일 수 있으니 호흡을 천천히 해보세요.');
  if (!tips.length) tips.push('침착한 인상을 주었습니다.');
  return tips;
}
