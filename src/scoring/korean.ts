import type { Question, RelevanceAnalysis, SpeechAnalysis } from '../types';

const HANGUL = /[가-힣]/;

export function countSyllables(text: string): number {
  let n = 0;
  for (const ch of text) {
    if (HANGUL.test(ch)) n++;
    else if (/[0-9]/.test(ch)) n++;
  }
  // 영어 단어는 대략 2음절로 환산
  const latin = text.match(/[A-Za-z]{2,}/g);
  if (latin) n += latin.length * 2;
  return n;
}

export function tokenize(text: string): string[] {
  return text
    .split(/[\s,./?!"'`()[\]{}<>~·:;\-–—]+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

/** 간투사 목록. STT 가 걸러내는 경우가 많아 보조 지표로만 쓴다. */
const FILLERS = [
  '어',
  '음',
  '아',
  '에',
  '그',
  '저',
  '뭐',
  '이제',
  '약간',
  '좀',
  '막',
  '인제',
  '그니까',
  '그러니까',
  '그래서뭐',
  '뭔가',
  '일단',
  '사실',
  '그냥',
];
const FILLER_SET = new Set(FILLERS);
/**
 * 지시어·감탄사와 겹치는 한 글자짜리들. "그 결과", "저 사람" 처럼 멀쩡한 말에도 나오므로
 * 다른 간투사 옆에 붙어 있거나 반복될 때만 간투사로 친다.
 */
const WEAK_FILLERS = new Set(['그', '저', '이', '아', '에']);
const bareOf = (t: string) => t.replace(/[^가-힣A-Za-z0-9]/g, '');

/** 종결 어미 (문장을 끝맺었는지) */
const ENDINGS = /(니다|니까|세요|해요|어요|아요|네요|죠|다\.|요\.|까\?)$/;

export interface SpeechTiming {
  /** 답변 전체 길이(초) */
  totalSec: number;
  /** 실제로 소리를 낸 시간(초) */
  voicedSec: number;
  /** 0.8초 이상 끊긴 횟수 */
  pauseCount: number;
  /** 1.5초 이상 끊긴 횟수 */
  longPauses: number;
}

export function analyzeSpeech(text: string, timing: SpeechTiming): SpeechAnalysis {
  const tokens = tokenize(text);
  const syllables = countSyllables(text);
  const base = Math.max(timing.voicedSec, 0.5);
  const syllablesPerSec = syllables / base;

  let fillerCount = 0;
  for (let i = 0; i < tokens.length; i++) {
    const bare = bareOf(tokens[i]);
    if (!FILLER_SET.has(bare)) continue;
    if (WEAK_FILLERS.has(bare)) {
      const prev = i > 0 ? bareOf(tokens[i - 1]) : '';
      const next = i + 1 < tokens.length ? bareOf(tokens[i + 1]) : '';
      const nearFiller = FILLER_SET.has(prev) || FILLER_SET.has(next) || prev === bare || next === bare;
      if (!nearFiller) continue;
    }
    fillerCount++;
  }

  // 더듬음: 같은 토큰 연속 반복, 또는 한 글자 뒤에 그 글자로 시작하는 단어
  let stutterCount = 0;
  for (let i = 1; i < tokens.length; i++) {
    const prev = tokens[i - 1];
    const cur = tokens[i];
    if (prev === cur && prev.length <= 4) stutterCount++;
    else if (prev.length === 1 && HANGUL.test(prev) && cur.startsWith(prev)) stutterCount++;
  }
  // 한 단어 안에서의 반복 (그그그, 저저저)
  const inWord = text.match(/([가-힣])\1{2,}/g);
  if (inWord) stutterCount += inWord.length;

  const sentences = text.split(/(?<=[.!?])\s+/).filter((s) => s.trim().length > 1);
  const ended = sentences.filter((s) => ENDINGS.test(s.trim())).length;
  const sentenceEndRatio = sentences.length ? ended / sentences.length : 0;

  return {
    syllables,
    syllablesPerSec,
    fillerCount,
    fillerRatio: tokens.length ? fillerCount / tokens.length : 0,
    stutterCount,
    longPauses: timing.longPauses,
    sentenceEndRatio,
    wordCount: tokens.length,
  };
}

/* 구체성/구조 판정용 사전 */
// '했습니다' 같은 일반 어미는 넣지 않는다 — 거의 모든 답변이 걸려버린다
const EXAMPLE_MARKERS = [
  '예를', '사례', '당시', '그때', '경험', '프로젝트', '진행했', '담당', '맡았', '이끌',
  '만들었', '개발했', '참여했', '수행했', '해결했', '분석했', '기획했', '운영했',
];
const NUMBER_MARKERS = /\d+\s*(%|퍼센트|명|개|번|년|개월|주|일|시간|배|위|점|억|만|천)/;
const STRUCTURE_MARKERS = ['첫째', '둘째', '셋째', '먼저', '우선', '그다음', '다음으로', '마지막으로', '결과적으로', '따라서', '그래서'];

/** 질문 키워드가 답변에 등장하는지 (조사 때문에 부분 일치로 본다) */
function keywordHits(answer: string, keywords: string[]): string[] {
  const hits: string[] = [];
  for (const k of keywords) {
    if (k.length < 2) continue;
    if (answer.includes(k)) {
      hits.push(k);
      continue;
    }
    // 어간 일치 (예: "지원" ↔ "지원하게")
    const stem = k.slice(0, Math.max(2, k.length - 1));
    if (stem.length >= 2 && answer.includes(stem)) hits.push(k);
  }
  return hits;
}

export function analyzeRelevance(question: Question, answer: string): RelevanceAnalysis {
  const text = answer.trim();
  const words = tokenize(text).length;

  if (words < 4) {
    return {
      score: 0,
      matchedKeywords: [],
      hasConcreteExample: false,
      hasStructure: false,
      note: '답변이 거의 인식되지 않았습니다.',
    };
  }

  const matched = keywordHits(text, question.keywords);
  const coverage = question.keywords.length
    ? matched.length / Math.min(question.keywords.length, 5)
    : 0.5;

  const hasConcreteExample = EXAMPLE_MARKERS.some((m) => text.includes(m)) || NUMBER_MARKERS.test(text);
  const hasStructure = STRUCTURE_MARKERS.filter((m) => text.includes(m)).length >= 2;

  // 분량 점수: 40~200 어절이 적당
  const lengthScore =
    words < 15 ? words / 15 : words <= 200 ? 1 : Math.max(0.6, 1 - (words - 200) / 400);

  // 자기소개처럼 정답 키워드가 없는 질문은 키워드 비중을 낮추고 내용의 밀도로 본다
  const w = question.open
    ? { coverage: 20, example: 25, structure: 12, length: 43 }
    : { coverage: 55, example: 20, structure: 10, length: 15 };

  const score = Math.round(
    Math.min(
      100,
      coverage * w.coverage +
        (hasConcreteExample ? w.example : 0) +
        (hasStructure ? w.structure : 0) +
        lengthScore * w.length,
    ),
  );

  let note: string;
  if (!question.open && coverage < 0.25) note = '질문의 핵심 키워드가 답변에 거의 없습니다.';
  else if (words < 18) note = '방향은 맞으나 분량이 짧습니다.';
  else if (!hasConcreteExample) note = '내용은 맞지만 구체적인 사례나 수치가 부족합니다.';
  else if (score >= 80) note = '질문 의도에 맞고 근거도 충분합니다.';
  else note = '질문 의도에는 부합합니다. 구조를 조금 더 다듬으면 좋겠습니다.';

  return { score, matchedKeywords: matched, hasConcreteExample, hasStructure, note };
}
