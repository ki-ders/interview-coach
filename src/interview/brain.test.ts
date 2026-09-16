import { afterEach, describe, expect, it, vi } from 'vitest';
import { assignAsker, decideFollowUp, summarizeContent } from './brain';
import { getInterviewer } from '../data/interviewers';
import type { AnswerRecord, Question, RelevanceAnalysis, SpeechAnalysis } from '../types';

const warm = getInterviewer('han');
const stern = getInterviewer('kang');

const q: Question = {
  id: 'q1',
  text: '가장 성과가 좋았던 프로젝트를 설명해 주세요.',
  category: '직무',
  keywords: ['프로젝트', '역할', '성과'],
};

const speech = (wordCount: number): SpeechAnalysis => ({
  syllables: wordCount * 3,
  syllablesPerSec: 5,
  fillerCount: 0,
  fillerRatio: 0,
  stutterCount: 0,
  longPauses: 0,
  sentenceEndRatio: 0.8,
  wordCount,
});

const rel = (over: Partial<RelevanceAnalysis> = {}): RelevanceAnalysis => ({
  score: 75,
  matchedKeywords: ['프로젝트', '성과'],
  hasConcreteExample: true,
  hasStructure: true,
  note: '',
  ...over,
});

/** 확률 분기를 고정한다 (0 = 항상 꼬리 질문, 0.99 = 최대한 넘어감) */
function fixRandom(value: number) {
  vi.spyOn(Math, 'random').mockReturnValue(value);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('decideFollowUp', () => {
  it('거의 답을 못 하면 성향과 무관하게 되묻는다', () => {
    fixRandom(0.99);
    for (const who of [warm, stern]) {
      const d = decideFollowUp(who, q, rel(), speech(4), false);
      expect(d.text).not.toBeNull();
      expect(d.reason).toContain('짧');
    }
  });

  it('질문과 동떨어지면 질문을 다시 읽어준다', () => {
    fixRandom(0.99);
    const d = decideFollowUp(stern, q, rel({ score: 20 }), speech(60), false);
    expect(d.text).toContain(q.text);
    expect(d.reason).toContain('초점');
  });

  it('이미 한 번 되물었으면 더 묻지 않는다', () => {
    fixRandom(0);
    const d = decideFollowUp(stern, q, rel({ score: 10 }), speech(3), true);
    expect(d.text).toBeNull();
  });

  it('사례가 없으면 사례를 요구한다', () => {
    fixRandom(0);
    const d = decideFollowUp(stern, q, rel({ hasConcreteExample: false }), speech(60), false);
    expect(d.reason).toContain('사례');
    expect(stern.lines.pressForExample).toContain(d.text);
  });

  it('충분한 답변에는 압박형도 그냥 넘어갈 수 있다', () => {
    fixRandom(0.99);
    const d = decideFollowUp(stern, q, rel({ score: 90 }), speech(120), false);
    expect(d.text).toBeNull();
  });

  it('온화형이 압박형보다 덜 파고든다', () => {
    // 0.5 는 온화형(0.4)의 문턱은 넘지만 압박형(0.85)은 넘지 못한다
    fixRandom(0.5);
    const warmDecision = decideFollowUp(warm, q, rel({ hasConcreteExample: false }), speech(60), false);
    const sternDecision = decideFollowUp(stern, q, rel({ hasConcreteExample: false }), speech(60), false);
    expect(warmDecision.text).toBeNull();
    expect(sternDecision.text).not.toBeNull();
  });

  it('꼬리 질문은 항상 그 면접관의 대사 목록에서 나온다', () => {
    fixRandom(0);
    const all = [
      ...stern.lines.pressForDetail,
      ...stern.lines.pressForExample,
      ...stern.lines.tooShort,
    ];
    const d = decideFollowUp(stern, q, rel({ score: 50, hasConcreteExample: false }), speech(30), false);
    expect(all).toContain(d.text);
  });
});

describe('assignAsker', () => {
  it('두 면접관이 번갈아 질문한다', () => {
    const ids: [string, string] = ['seo', 'kang'];
    expect([0, 1, 2, 3].map((i) => assignAsker(i, ids))).toEqual(['seo', 'kang', 'seo', 'kang']);
  });
});

describe('summarizeContent', () => {
  const answer = (over: Partial<AnswerRecord>): AnswerRecord =>
    ({
      questionId: 'q',
      questionText: q.text,
      transcript: '충분히 긴 답변입니다',
      durationSec: 40,
      voicedSec: 30,
      startedAt: 0,
      endedAt: 0,
      speech: speech(60),
      relevance: rel(),
      metrics: { gaze: 80, gesture: 80, speech: 80, voice: 80, calm: 80 },
      followUpAsked: null,
      followUpReason: null,
      ...over,
    }) as AnswerRecord;

  it('답변이 없으면 평가 불가를 알린다', () => {
    const r = summarizeContent([]);
    expect(r.score).toBe(0);
    expect(r.summary).toContain('인식');
  });

  it('연관성이 높으면 좋은 총평', () => {
    const r = summarizeContent([answer({ relevance: rel({ score: 88 }) }), answer({ relevance: rel({ score: 84 }) })]);
    expect(r.score).toBeGreaterThan(80);
    expect(r.summary).toContain('정확히');
  });

  it('여러 답변이 빗나가면 그 사실을 짚는다', () => {
    const r = summarizeContent([
      answer({ relevance: rel({ score: 20 }) }),
      answer({ relevance: rel({ score: 25 }) }),
      answer({ relevance: rel({ score: 80 }) }),
    ]);
    expect(r.summary).toContain('벗어');
  });

  it('사례가 부족하면 구조 개선을 제안한다', () => {
    const r = summarizeContent([
      answer({ relevance: rel({ score: 62, hasConcreteExample: false }) }),
      answer({ relevance: rel({ score: 60, hasConcreteExample: false }) }),
    ]);
    expect(r.summary).toContain('사례');
  });

  it('인식되지 않은(침묵한) 답변은 0점으로 평균에 들어간다', () => {
    // 두 문제 중 하나만 답했으면 잘한 답 하나의 점수를 그대로 줄 수 없다
    const r = summarizeContent([
      answer({ relevance: rel({ score: 90 }) }),
      answer({ speech: speech(1), relevance: rel({ score: 0 }) }),
    ]);
    expect(r.score).toBe(45);
  });

  it('절반 이상 침묵했으면 총평에서 그 사실을 말한다', () => {
    const r = summarizeContent([
      answer({ relevance: rel({ score: 70 }) }),
      answer({ speech: speech(0), relevance: rel({ score: 0 }) }),
      answer({ speech: speech(2), relevance: rel({ score: 0 }) }),
    ]);
    expect(r.score).toBe(23);
    expect(r.summary).toContain('2개 문항에 답하지 못했습니다');
  });
});
