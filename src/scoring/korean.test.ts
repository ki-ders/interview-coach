import { describe, expect, it } from 'vitest';
import { analyzeRelevance, analyzeSpeech, countSyllables, tokenize } from './korean';
import { extractKeywords, makeQuestion } from '../data/questions';
import type { Question } from '../types';

const timing = (over: Partial<Parameters<typeof analyzeSpeech>[1]> = {}) => ({
  totalSec: 30,
  voicedSec: 20,
  pauseCount: 0,
  longPauses: 0,
  ...over,
});

describe('countSyllables', () => {
  it('한글 음절을 센다', () => {
    expect(countSyllables('안녕하세요')).toBe(5);
  });

  it('영어 단어는 2음절로 환산한다', () => {
    expect(countSyllables('React 개발')).toBe(4);
  });

  it('문장부호와 공백은 세지 않는다', () => {
    expect(countSyllables('네, 그렇습니다.')).toBe(6);
  });
});

describe('analyzeSpeech', () => {
  it('발화 속도를 실제 발화 시간 기준으로 계산한다', () => {
    const text = '안녕하세요 저는 지원자입니다'; // 13음절
    const s = analyzeSpeech(text, timing({ voicedSec: 2.6 }));
    expect(s.syllables).toBe(13);
    expect(s.syllablesPerSec).toBeCloseTo(5, 1);
  });

  it('간투사를 센다', () => {
    const s = analyzeSpeech('어 그 저는 음 그러니까 팀에서 일했습니다', timing());
    expect(s.fillerCount).toBeGreaterThanOrEqual(3);
    expect(s.fillerRatio).toBeGreaterThan(0.3);
  });

  it('같은 단어를 이어서 반복하면 더듬은 것으로 본다', () => {
    const s = analyzeSpeech('저는 저는 그때 그때 상황을 정리했습니다', timing());
    expect(s.stutterCount).toBeGreaterThanOrEqual(2);
  });

  it('한 글자 뒤에 같은 글자로 시작하는 단어가 오면 더듬음', () => {
    const s = analyzeSpeech('제 제가 담당했습니다', timing());
    expect(s.stutterCount).toBeGreaterThanOrEqual(1);
  });

  it('깨끗한 문장은 더듬음이 0', () => {
    const s = analyzeSpeech('저는 데이터 분석 업무를 담당했습니다.', timing());
    expect(s.stutterCount).toBe(0);
    expect(s.fillerCount).toBe(0);
  });

  it('문장 종결 비율을 잰다', () => {
    const s = analyzeSpeech('저는 개발자입니다. 팀에서 협업했습니다. 결과도 좋았습니다.', timing());
    expect(s.sentenceEndRatio).toBeCloseTo(1, 1);
  });

  it('긴 침묵 횟수는 타이밍에서 그대로 가져온다', () => {
    expect(analyzeSpeech('네', timing({ longPauses: 4 })).longPauses).toBe(4);
  });
});

describe('tokenize', () => {
  it('구두점과 공백으로 나눈다', () => {
    expect(tokenize('저는, 팀에서 일했습니다.')).toEqual(['저는', '팀에서', '일했습니다']);
  });
});

describe('extractKeywords', () => {
  it('조사를 떼고 명사 후보를 뽑는다', () => {
    const k = extractKeywords('가장 힘들었던 프로젝트 경험을 말씀해 주세요.');
    expect(k).toContain('프로젝트');
    expect(k).toContain('경험');
  });

  it('의문사나 상투어는 제외한다', () => {
    const k = extractKeywords('지원 동기가 무엇인가요?');
    expect(k).not.toContain('무엇');
    expect(k).toContain('지원');
  });
});

describe('analyzeRelevance', () => {
  const q: Question = {
    id: 'q',
    text: '팀에서 갈등이 생겼을 때 어떻게 해결했는지 말씀해 주세요.',
    category: '인성',
    keywords: ['갈등', '팀', '소통', '조율', '해결', '역할'],
  };

  it('질문 키워드를 담고 사례가 있으면 높은 점수', () => {
    const answer =
      '네, 작년 캡스톤 프로젝트 당시 팀에서 일정 문제로 갈등이 있었습니다. ' +
      '저는 먼저 각자의 입장을 듣고 소통 창구를 하나로 모았습니다. ' +
      '그다음 역할을 다시 나누고 주 2회 점검 회의를 도입해 조율했습니다. ' +
      '결과적으로 2주 앞당겨 마감했고 갈등도 해결했습니다.';
    const r = analyzeRelevance(q, answer);
    expect(r.score).toBeGreaterThan(78);
    expect(r.hasConcreteExample).toBe(true);
    expect(r.matchedKeywords.length).toBeGreaterThanOrEqual(4);
  });

  it('완전히 다른 이야기는 낮은 점수', () => {
    const r = analyzeRelevance(
      q,
      '제 취미는 등산입니다. 주말마다 근처 산을 오르면서 체력을 기르고 있습니다.',
    );
    expect(r.score).toBeLessThan(40);
    expect(r.note).toContain('키워드');
  });

  it('내용은 맞지만 추상적이면 중간 점수', () => {
    const r = analyzeRelevance(q, '팀 갈등은 소통으로 해결해야 한다고 생각합니다.');
    expect(r.score).toBeGreaterThan(20);
    expect(r.score).toBeLessThan(70);
    expect(r.hasConcreteExample).toBe(false);
  });

  it('인식된 답변이 없으면 0점', () => {
    expect(analyzeRelevance(q, '').score).toBe(0);
    expect(analyzeRelevance(q, '네').score).toBe(0);
  });

  it('조사가 붙어도 키워드를 찾는다', () => {
    const r = analyzeRelevance(q, '팀에서의 갈등을 조율하는 역할을 맡았습니다');
    expect(r.matchedKeywords).toContain('갈등');
    expect(r.matchedKeywords).toContain('역할');
  });

  it('사용자가 직접 넣은 질문도 채점된다', () => {
    const custom = makeQuestion('본인이 사용한 기술 스택과 그 선택 이유를 설명해 주세요.');
    expect(custom.keywords.length).toBeGreaterThan(1);
    const good = analyzeRelevance(
      custom,
      '저는 기술 스택으로 타입스크립트와 React 를 선택했습니다. 이유는 팀 전체가 익숙했고 타입 안정성 덕분에 버그를 30% 줄였기 때문입니다. 실제 프로젝트에서 적용해 성과를 확인했습니다.',
    );
    expect(good.score).toBeGreaterThan(50);
  });
});

describe('간투사 오탐 방지', () => {
  const timing = { totalSec: 20, voicedSec: 15, pauseCount: 0, longPauses: 0 };

  it('"그 결과", "그 과정에서" 의 지시어 그 는 간투사가 아니다', () => {
    const s = analyzeSpeech('그 과정에서 오차를 줄였습니다. 그 결과 기한보다 이틀 먼저 제출했습니다.', timing);
    expect(s.fillerCount).toBe(0);
  });

  it('다른 간투사 옆의 그 / 반복되는 그 는 간투사', () => {
    expect(analyzeSpeech('어 그 저는 팀에서 일했습니다', timing).fillerCount).toBe(2);
    expect(analyzeSpeech('그 그 저는 팀에서 일했습니다', timing).fillerCount).toBe(2);
  });

  it('음, 그러니까 같은 확실한 간투사는 그대로 센다', () => {
    expect(analyzeSpeech('음 그러니까 저는 팀에서 일했습니다', timing).fillerCount).toBe(2);
  });
});
