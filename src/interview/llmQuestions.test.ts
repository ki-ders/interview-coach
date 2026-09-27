import { describe, expect, it } from 'vitest';
import { buildQuestionsPrompt, normalizeQuestions } from './llmPrompts';

describe('채용 공고 질문 생성', () => {
  it('프롬프트에 개수와 블라인드 원칙이 들어간다', () => {
    const { system, user } = buildQuestionsPrompt('전산직 신입 — 정보시스템 운영', 6);
    expect(system).toContain('정확히 6개');
    expect(system).toContain('출신 학교');
    expect(user).toContain('정보시스템 운영');
  });

  it('중복·너무 짧은 질문을 거르고 개수를 지킨다', () => {
    const raw = {
      questions: [
        { text: '자기소개 부탁드립니다.', keywords: ['경험'], category: '공통' },
        { text: '자기소개 부탁드립니다.', keywords: [], category: '공통' },
        { text: '네?', keywords: [], category: '공통' },
        { text: '장애를 처리한 경험을 말씀해 주세요.', keywords: ['장애', '복구', '아주아주아주아주긴키워드입니다'], category: '직무' },
        { text: '입사 후 목표는 무엇인가요?', keywords: ['목표'], category: '공통' },
      ],
    };
    const out = normalizeQuestions(raw, 2)!;
    expect(out.map((q) => q.text)).toEqual(['자기소개 부탁드립니다.', '장애를 처리한 경험을 말씀해 주세요.']);
    expect(out[1].keywords).toEqual(['장애', '복구']);
  });

  it('모양이 틀리면 null', () => {
    expect(normalizeQuestions(null, 5)).toBeNull();
    expect(normalizeQuestions({ questions: 'x' }, 5)).toBeNull();
    expect(normalizeQuestions({ questions: [] }, 5)).toBeNull();
  });
});
