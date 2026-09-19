import type { AnswerRecord, LiveMetrics, SessionReport } from '../types';
import {
  buildBreakdown,
  computeMetrics,
  derive,
  emptyStats,
  emptyText,
  feed,
  sealStats,
  textStatsOf,
  type Sample,
} from '../scoring/metrics';
import { analyzeRelevance, analyzeSpeech } from '../scoring/korean';
import { summarizeContent } from '../interview/brain';
import { QUESTION_PACKS } from '../data/questions';
import { clamp, gradeOf, weighted } from '../lib/signal';

/**
 * 실제 채점 파이프라인에 합성 데이터를 흘려 만든 예시 리포트.
 * 카메라 없이 결과 화면을 확인하고 싶을 때 쓴다 (?preview=report).
 */
const SAMPLE_ANSWERS = [
  '네, 저는 데이터 분석을 전공한 지원자입니다. 학부 때 3년간 통계 프로젝트를 진행했고, 마지막 학기에는 팀 다섯 명을 이끌며 수요 예측 모델을 만들었습니다. 예측 오차를 18퍼센트 줄인 것이 가장 큰 성과였습니다.',
  '제 강점은 데이터를 끝까지 파고드는 집요함입니다. 약점은 완벽을 추구하다 일정이 밀린 적이 있다는 점인데, 지금은 먼저 초안을 빠르게 만들고 다듬는 방식으로 보완하고 있습니다.',
  '어 그 저는 그러니까 이 회사가 데이터 쪽으로 유명해서 지원했습니다 음 그리고 성장할 수 있을 것 같아서요',
  '작년 캡스톤 프로젝트 당시 팀에서 일정 문제로 갈등이 있었습니다. 저는 먼저 각자의 입장을 듣고 소통 창구를 하나로 모았습니다. 그다음 역할을 다시 나누고 주 2회 점검 회의를 도입해 조율했습니다. 결과적으로 2주 앞당겨 마감했고 갈등도 해결했습니다.',
  '제 취미는 등산입니다. 주말마다 근처 산을 오릅니다.',
];

export function makeSampleReport(): SessionReport {
  const questions = QUESTION_PACKS[0].questions.slice(0, SAMPLE_ANSWERS.length);
  const session = emptyStats();
  const timeline: { t: number; metrics: LiveMetrics }[] = [];
  const answers: AnswerRecord[] = [];

  const STEP = 33;
  let t = 0;

  /** 답변 한 구간을 시뮬레이션한다. quality 0(불안) ~ 1(안정) */
  const simulate = (seconds: number, quality: number) => {
    const stats = emptyStats();
    const frames = Math.round((seconds * 1000) / STEP);
    for (let i = 0; i < frames; i++) {
      const wobble = Math.sin(i / 9) * (1 - quality);
      const sample: Sample = {
        t,
        face: {
          yawDev: wobble * 0.9,
          pitchDev: -(1 - quality) * 0.5,
          onTarget: Math.abs(wobble) < 0.4 && quality > 0.35,
          lookingDown: quality < 0.4 && i % 90 < 40,
          blink: i % Math.round(70 + quality * 90) < 3,
        },
        pose: {
          shoulderTilt: 2 + (1 - quality) * 9,
          neckRatio: 1.05 - (1 - quality) * 0.35,
          swaySpeed: 0.06 + (1 - quality) * 0.22,
          handSpeed: 0.18 + (1 - quality) * 0.35,
          selfTouch: quality < 0.45 && i % 140 < 30,
          legShake: quality > 0.6 ? 0.04 : 0.55 + (1 - quality) * 0.3,
          handFidget: quality > 0.6 ? 0.05 : 0.34,
        },
        snr: 9 + quality * 14,
        // 안정적일수록 길게 이어 말하고, 불안하면 자주 끊긴다
        speaking: quality > 0.55 ? i % 130 < 108 : i % 120 < 52,
        ttsActive: false,
        answering: true,
      };
      feed(stats, sample, STEP);
      feed(session, sample, STEP);
      t += STEP;
      if (t - (timeline[timeline.length - 1]?.t ?? -9999) > 2000) {
        const snapshot = derive(stats);
        timeline.push({ t, metrics: computeMetrics(snapshot, emptyTextStats) });
      }
    }
    sealStats(stats);
    return stats;
  };

  const emptyTextStats = emptyText();

  const qualities = [0.85, 0.75, 0.3, 0.8, 0.35];

  questions.forEach((q, i) => {
    const transcript = SAMPLE_ANSWERS[i];
    const stats = simulate(22 + i * 3, qualities[i]);
    const voicedSec = stats.voicedMs / 1000;
    const speech = analyzeSpeech(transcript, {
      totalSec: stats.ms / 1000,
      voicedSec,
      pauseCount: stats.pauseCount,
      longPauses: stats.longPauses,
    });
    const relevance = analyzeRelevance(q, transcript);
    answers.push({
      questionId: q.id,
      questionText: q.text,
      transcript,
      durationSec: stats.ms / 1000,
      voicedSec,
      latencySec: 1.2 + (1 - qualities[i]) * 6,
      startedAt: 0,
      endedAt: 0,
      speech,
      relevance,
      metrics: computeMetrics(derive(stats), emptyTextStats),
      followUpAsked: i === 2 ? '근거가 뭡니까? 구체적으로 말씀해 주세요.' : null,
      followUpReason: i === 2 ? '설명의 깊이 부족' : null,
      clarity: 0.88,
      reasked: false,
    });
    // 면접관이 말하는 구간 (음성 지표 제외)
    t += 4000;
  });

  sealStats(session);
  const d = derive(session);

  const text = textStatsOf(answers);

  const metrics = computeMetrics(d, text);
  const content = summarizeContent(answers);
  const total = clamp(
    Math.round(
      weighted([
        [metrics.gaze, 0.2],
        [metrics.gesture, 0.18],
        [metrics.speech, 0.22],
        [metrics.voice, 0.15],
        [metrics.calm, 0.15],
        [content.score, 0.1],
      ]),
    ),
    0,
    100,
  );

  return {
    manner: { banmal: 0, profanity: 0, penalty: 0, hits: [] },
    total,
    grade: gradeOf(total),
    breakdown: buildBreakdown(d, text, metrics),
    content: {
      score: content.score,
      summary: content.summary,
      perAnswer: answers.map((a) => ({
        question: a.questionText,
        relevance: a.relevance.score,
        note: a.relevance.note,
      })),
    },
    answers,
    timeline,
    durationSec: t / 1000,
    alerts: [
      { id: 1, key: 'voice', text: '목소리가 작습니다. 조금 더 크게 말해 주세요.', t: 62000 },
      { id: 2, key: 'calm', text: '다리 떨림이 감지됐습니다. 두 발을 바닥에 붙여 보세요.', t: 78000 },
    ],
  };
}
