/**
 * 말씨 감지 — 반말과 비속어.
 * 면접에서는 존댓말이 기본이므로 문장 끝이 반말 형태면 잡고, 비속어는 목록으로 잡는다.
 * 음성 인식 결과라 문장부호가 없을 수 있어 "어절 끝" 만 본다 (뒤에 한글이 이어지면 다른 낱말이다).
 */

import type { MannerHit } from '../types';

export type MannerKind = MannerHit['kind'];
export type { MannerHit };

/**
 * 존댓말(요/니다)이 붙지 않은 반말 종결형. 어절 끝에서만 성립한다 (뒤에 한글이 이어지면 다른 낱말).
 * 어간을 다 열거할 수 없으므로 시제·보조 어간 뒤의 종결 어미 형태로 잡고, 자주 쓰는 낱말은 따로 적는다.
 */
/** 받침이 ㅆ 인 모든 음절 (했·됐·왔·갔·봤·줬·겠 …) — 과거·추측 어간의 끝 */
const SS_BATCHIM = (() => {
  let out = '';
  for (let cho = 0; cho < 19; cho++) for (let jung = 0; jung < 21; jung++) out += String.fromCharCode(0xac00 + (cho * 21 + jung) * 28 + 20);
  return out;
})();

const BANMAL_PATTERNS = [
  // 과거·추측 어간 + 반말 종결: 했어 / 만들었지 / 배웠거든 / 하겠다 / 갔네 / 봤음 / 됐지
  `[가-힣]*[${SS_BATCHIM}](어|지|거든|잖아|네|다|음|더라|는데도)`,
  // 있어 / 없어 / 재미있다 / 관계없지
  '[가-힣]*(있|없)(어|지|다|거든|잖아|네|더라)',
  // 명사·어간 + 거야 / 이야 / 성과야 / 할게 / 볼래 / 할까
  '[가-힣]*(거야|이야|잖아|거든|더라|을게|할게|볼게|줄게|갈게|할래|볼래|할까|볼까|야)',
  // 현재형 해라체: 한다 / 된다 / 간다 / 본다 / 안다 / 모른다
  '[가-힣]*(한다|된다|간다|온다|본다|안다|모른다|않는다|이다|싶다|같다|좋다|아니다|모르겠다|않다)',
  // 자주 쓰는 낱말
  '(몰라|알아|알지|좋아|싫어|좋지|싫지|아니야|아냐|아니지|거지|그래|맞아|맞지|그렇지|그러지|같아|싶어|봐야지|해야지|해야돼|해야\\s?돼|해야\\s?해|해봐|해줘|생각해|좋아해|싫어해|일해|공부해|노력해|준비해|뭐야|뭐냐|뭐지|어때|어땠어)',
];

/** 반말처럼 끝나지만 반말이 아닌 낱말 (명사·연결형) — 통째로 맞으면 넘긴다 */
const BANMAL_IGNORE = new Set(['분야', '시야', '평야', '광야', '야', '이야기', '있는데', '없는데', '했는데', '됐는데']);

const BANMAL_RE = new RegExp(`(?<![가-힣])(${BANMAL_PATTERNS.join('|')})(?![가-힣])`, 'g');

/** 비속어·욕설. 음성 인식이 적는 흔한 변형을 포함한다 */
const PROFANITY = [
  '씨발', '시발', '씨팔', '시팔', '씨빨', 'ㅅㅂ', '씨바', '시바', '씨부', '씨발년', '씨발놈',
  '개새끼', '개새', '새끼', '새키', '색기',
  '병신', '븅신', '빙신',
  '좆', '좃', '존나', '졸라', '존내', '개존', '조낸',
  '지랄', '지럴', '미친놈', '미친년', '미친새끼', '또라이', '돌아이',
  '꺼져', '닥쳐', '닥치', '엿먹', '엿 먹',
  '개소리', '개같', '개 같', '개판', '개빡', '빡치', '빡쳐', '빡침',
  '썅', '쌍놈', '쌍년', '염병', '옘병', '니미', '느금', '애미', '애비',
  '호로', '후레', '개년', '걸레', '창녀', '개돼지', '멍청이', '등신', '찐따', '찌질',
  '싸가지', '개나발', '지껄', '쳐먹', '꼴값', '꼬라지',
];

const PROFANITY_RE = new RegExp(`(${PROFANITY.map((w) => w.replace(/ /g, '\\s?')).sort((a, b) => b.length - a.length).join('|')})`, 'g');

/** '미친' 은 "미친 듯이 노력" 처럼 강조로도 쓰여 단독으로는 잡지 않는다 */

function excerptAround(text: string, index: number, len: number): string {
  const s = Math.max(0, index - 10);
  const e = Math.min(text.length, index + len + 10);
  return `${s > 0 ? '…' : ''}${text.slice(s, e).trim()}${e < text.length ? '…' : ''}`;
}

/** 한 답변에서 반말·비속어를 찾는다. 반말은 한 문장에서 여러 번 나와도 어절마다 센다 */
export function detectManner(text: string, questionIndex = 0): MannerHit[] {
  const out: MannerHit[] = [];
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return out;

  for (const m of clean.matchAll(PROFANITY_RE)) {
    const idx = m.index ?? 0;
    const after = clean.slice(idx + m[0].length);
    // 새끼손가락, 시바견, 후레쉬 처럼 욕이 아닌 낱말의 일부
    if (m[0] === '새끼' && after.startsWith('손')) continue;
    if ((m[0] === '시바' || m[0] === '씨바') && /^(견|이누)/.test(after)) continue;
    if (m[0] === '후레' && /^(쉬|시)/.test(after)) continue;
    out.push({ kind: 'profanity', word: m[0], excerpt: excerptAround(clean, idx, m[0].length), questionIndex });
  }
  for (const m of clean.matchAll(BANMAL_RE)) {
    const idx = m.index ?? 0;
    if (BANMAL_IGNORE.has(m[0])) continue;
    // '해야 합니다', '거쳐야 한다' 의 -아야/-어야 는 연결형이지 반말 종결이 아니다
    if (/[아어여해쳐져워봐줘와돼야]야$/.test(m[0]) && m[0].length > 1) continue;
    const after = clean.slice(idx + m[0].length).trimStart();
    // "했어요" 는 뒤 lookahead 에서 이미 걸러졌다. 다음 어절이 보조 용언이면
    // 반말 종결이 아니라 연결형이다 ("있어 보입니다", "알아 가면서")
    if (/^(보|봐|봤|주|줘|줬|드리|드립|지|있|계|가|오|버리|두|놓|줍|하|되|봅|보이|보여|주세|주십|싶)/.test(after)) continue;
    out.push({ kind: 'banmal', word: m[0], excerpt: excerptAround(clean, idx, m[0].length), questionIndex });
  }
  return out;
}

/** 반말이 "말투" 로 굳었는지 — 짧은 답에서 한 번 튀어나온 건 넘어가고, 여러 번이면 지적한다 */
export function summarizeManner(hits: MannerHit[]): { banmal: number; profanity: number } {
  return {
    banmal: hits.filter((h) => h.kind === 'banmal').length,
    profanity: hits.filter((h) => h.kind === 'profanity').length,
  };
}

/** 면접관이 즉석에서 한마디 (비속어일 때만 말로 지적한다) */
export function mannerRemarkLine(mood: 'warm' | 'neutral' | 'stern'): string {
  if (mood === 'stern') return '면접 자리입니다. 말씀을 가려서 하세요.';
  if (mood === 'warm') return '아, 지금은 면접 자리니까 표현은 조금 가려 주시면 좋겠습니다.';
  return '면접 자리에 맞는 표현으로 답변해 주시기 바랍니다.';
}
