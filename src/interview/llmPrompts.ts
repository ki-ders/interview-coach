/**
 * 면접관 두뇌(LLM)에 보내는 프롬프트. 어떤 제공자(Gemini / Claude)를 쓰든 같은 지시문을 쓴다.
 */
import type { AnswerRecord, Interviewer, Question } from '../types';

export interface EvalOpts {
  /** 이번 질문을 던진 면접관 */
  asker: Interviewer;
  /** 옆에서 듣던 면접관 — 이어받아 물어볼 수 있다 */
  other: Interviewer;
  question: Question;
  answer: string;
  previous: { question: string; answer: string }[];
  /** 다음에 나올 질문 (있으면 자연스러운 연결 문장을 만들 수 있다) */
  nextQuestion?: string;
  /** 이번 문항에서 이미 꼬리질문을 했는지 */
  alreadyFollowedUp: boolean;
  /** 블라인드 면접이면 성명·학교·가족·수상·수험번호 언급도 잡아 달라고 한다 */
  blindMode?: boolean;
}

/** LLM 이 답변에서 잡아낸 규정·말씨 문제 */
export type LlmFlag = 'name' | 'school' | 'family' | 'award' | 'examNo' | 'banmal' | 'profanity';
export const LLM_FLAGS: LlmFlag[] = ['name', 'school', 'family', 'award', 'examNo', 'banmal', 'profanity'];

export interface LlmVerdict {
  /** 0~100, 질문과 답변이 얼마나 맞물렸는지 */
  relevance: number;
  /** 지원자에게 보여줄 한 줄 평가 */
  note: string;
  /** 꼬리 질문 한 문장. 필요 없으면 빈 문자열 */
  followUp: string;
  /** true 면 옆 면접관이 꼬리 질문을 이어받는다 */
  handoff: boolean;
  /** 다음 질문 앞에 붙일 연결 문장 (방금 답변을 짚어 주는 한 마디). 없으면 빈 문자열 */
  bridge: string;
  /** 오인식을 감안해 면접관이 이해한 답변 요지 (한 문장). 리포트에 "면접관이 이해한 내용" 으로 보여준다 */
  gist: string;
  /** 블라인드 규정 위반·반말·비속어 */
  flags: LlmFlag[];
}

export interface LlmSummary {
  /** 3~4문장 총평 */
  summary: string;
  strengths: string[];
  improvements: string[];
}

export function personaOf(who: Interviewer): string {
  const tone =
    who.mood === 'stern'
      ? '근거를 집요하게 확인하는 압박형 면접관. 말투는 짧고 단정적이다.'
      : who.mood === 'warm'
        ? '지원자의 긴장을 풀어주는 온화한 면접관. 부드럽지만 핵심은 짚는다.'
        : '감정을 드러내지 않고 답변의 구조를 보는 중립적인 면접관.';
  return `${who.name} 교수 (${who.title}): ${tone}`;
}

/** JSON 으로만 답하라는 공통 지시. 스키마를 못 쓰는 경로에서도 형태를 맞추기 위해 글로도 적는다 */
export const VERDICT_SHAPE = `{
  "relevance": 0~100 정수 (질문에 실제로 답했는지, 근거가 있는지),
  "note": "지원자에게 도움이 될 한 줄 평가 (한국어, 40자 이내)",
  "followUp": "이어서 던질 꼬리 질문 한 문장 (한국어 존댓말). 답변이 충분하면 빈 문자열",
  "handoff": true|false (꼬리 질문을 옆 면접관이 이어받는 게 자연스러우면 true),
  "bridge": "다음 질문으로 넘어가기 전에 방금 답변을 짚어 주는 한 마디 (20자 이내, 예: '수요 예측 얘기 흥미롭게 들었습니다.'). 없으면 빈 문자열",
  "gist": "오인식을 감안해 면접관이 이해한 답변의 요지 한 문장 (한국어, 60자 이내)",
  "flags": ["답변에서 발견한 문제만 골라 나열: name(본인 성명 밝힘), school(출신 학교명), family(가족·친인척 언급), award(수상 실적), examNo(수험번호), banmal(반말·해라체로 답함), profanity(비속어·욕설). 없으면 빈 배열"]
}`;

export function buildEvalPrompt(o: EvalOpts): { system: string; user: string } {
  const system = [
    '당신은 한국어 모의 면접의 면접관 두 명을 동시에 연기합니다.',
    `질문한 면접관: ${personaOf(o.asker)}`,
    `옆 면접관: ${personaOf(o.other)}`,
    '',
    '규칙:',
    '- 지원자의 답변이 질문에 실제로 답했는지, 구체적 근거·사례가 있는지 판단한다.',
    '- 꼬리 질문은 반드시 한 문장, 존댓말, 방금 답변의 구체적인 내용을 짚어서 만든다. 일반론적인 질문은 만들지 않는다.',
    o.alreadyFollowedUp
      ? '- 이번 문항에서 이미 꼬리 질문을 했으므로 followUp 은 빈 문자열로 둔다.'
      : '- 답변이 충분하고 근거가 있으면 followUp 을 빈 문자열로 둔다. 짧거나 초점이 빗나갔거나 근거가 없으면 꼬리 질문을 한다.',
    '- handoff 는 옆 면접관의 성향이 그 질문에 더 어울릴 때만 true (예: 압박형이 근거를 캐묻기, 온화형이 긴장을 풀어주며 되묻기).',
    o.asker.mood === 'stern' || o.other.mood === 'stern'
      ? '- 압박형 면접관이 있다. 답변이 무난해 보여도 수치·역할·검증 방법처럼 확인 가능한 근거를 한 단계 더 캐묻는 꼬리 질문을 만든다 (필요하면 handoff 로 압박형이 던진다). 실제 면접의 긴장감을 준다.'
      : '',
    '- 지원자의 답변은 음성 인식 결과라 오탈자·띄어쓰기·동음이의어 오류가 20% 안팎 섞여 있다. 그 자체는 지적하지 말고, 앞뒤 문맥으로 지원자가 하려던 말을 최대한 복원해서(예: "수료 예측" → "수요 예측") 평가하고 꼬리 질문도 그 복원한 내용을 바탕으로 만든다. 못 알아들었다고 되묻지 않는다.',
    '- 칭찬은 근거가 있을 때만 한다. 실제 면접관처럼 답변의 허점(근거 없음, 두루뭉술함, 질문 회피, 과장)을 반드시 하나는 짚는다. 전부 좋다고 하지 않는다.',
    '- note 는 지원자가 다음에 무엇을 고쳐야 할지 알 수 있게 구체적으로 쓴다 ("좋았습니다" 같은 빈말 금지).',
    o.blindMode
      ? '- 블라인드 면접이다. 답변에 본인 성명, 출신 학교명(대학·고교), 가족·친인척, 수상 실적, 수험번호가 나오면 flags 에 해당 항목을 넣는다. 오인식으로 이름처럼 들리는 낱말은 넣지 않는다.'
      : '- flags 의 name/school/family/award/examNo 는 이번 면접에서는 쓰지 않는다 (빈 배열 또는 banmal/profanity 만).',
    '- 답변이 존댓말이 아니라 반말·해라체("했어", "그거야", "한다")로 되어 있으면 flags 에 banmal, 비속어·욕설이 있으면 profanity 를 넣는다.',
    '- 반드시 아래 형태의 JSON 만 출력한다.',
    VERDICT_SHAPE,
  ].join('\n');

  const history = o.previous
    .slice(-3)
    .map((p, i) => `[이전 ${i + 1}] 질문: ${p.question}\n답변: ${p.answer}`)
    .join('\n');
  const user = [
    history ? `${history}\n` : '',
    `[이번 질문] ${o.question.text}`,
    `[지원자 답변] ${o.answer}`,
    o.nextQuestion ? `[다음 질문 예정] ${o.nextQuestion}` : '',
  ]
    .filter(Boolean)
    .join('\n');
  return { system, user };
}

export const SUMMARY_SHAPE = `{
  "summary": "면접 전체에 대한 총평 3~4문장 (한국어, 지원자에게 직접 말하듯 존댓말)",
  "strengths": ["잘한 점 2~3개, 각각 한 문장"],
  "improvements": ["다음 면접까지 고칠 점 2~3개, 각각 구체적인 행동으로 한 문장"]
}`;

export function buildSummaryPrompt(answers: AnswerRecord[], interviewers: Interviewer[]): { system: string; user: string } {
  const system = [
    '당신은 한국어 모의 면접의 면접관입니다. 면접이 끝났고, 지원자에게 답변 내용에 대한 총평을 씁니다.',
    `면접관: ${interviewers.map(personaOf).join(' / ')}`,
    '시선·자세·목소리 같은 비언어 요소는 다른 시스템이 채점하므로 언급하지 말고, 답변의 내용·구조·근거·질문과의 부합만 평가합니다.',
    '답변은 음성 인식 결과라 오탈자가 있을 수 있습니다. 오탈자는 지적하지 않고 문맥으로 뜻을 복원해 평가합니다.',
    '실제 면접관처럼 솔직하게 씁니다. 근거 없는 칭찬은 하지 않고, 실전이었다면 어떤 대목에서 감점됐을지 구체적으로 짚습니다.',
    '반드시 아래 형태의 JSON 만 출력합니다.',
    SUMMARY_SHAPE,
  ].join('\n');
  const user = answers
    .map((a, i) => {
      const body = a.transcript.trim() ? a.transcript : '(답변 없음)';
      const fu = a.followUpAsked ? `\n  꼬리 질문: ${a.followUpAsked}` : '';
      return `${i + 1}. 질문: ${a.questionText}${fu}\n   답변: ${body}`;
    })
    .join('\n');
  return { system, user };
}

/** 모델이 JSON 앞뒤에 말을 붙여도 본문만 건진다 */
export function extractJson<T>(text: string): T | null {
  const trimmed = text.trim();
  const candidates = [trimmed];
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) candidates.unshift(fence[1]);
  const brace = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (brace >= 0 && last > brace) candidates.push(trimmed.slice(brace, last + 1));
  for (const c of candidates) {
    try {
      return JSON.parse(c) as T;
    } catch {
      /* 다음 후보 */
    }
  }
  return null;
}

export function normalizeVerdict(raw: unknown): LlmVerdict | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const num = Number(r.relevance);
  return {
    relevance: Number.isFinite(num) ? Math.max(0, Math.min(100, Math.round(num))) : 50,
    note: String(r.note ?? '').trim().slice(0, 120),
    followUp: String(r.followUp ?? '').trim().slice(0, 200),
    handoff: r.handoff === true || r.handoff === 'true',
    bridge: String(r.bridge ?? '').trim().slice(0, 60),
    gist: String(r.gist ?? '').trim().slice(0, 120),
    flags: Array.isArray(r.flags)
      ? (r.flags.map((f) => String(f).trim()).filter((f): f is LlmFlag => (LLM_FLAGS as string[]).includes(f)))
      : [],
  };
}

export function normalizeSummary(raw: unknown): LlmSummary | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const list = (v: unknown) => (Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean).slice(0, 4) : []);
  const summary = String(r.summary ?? '').trim();
  if (!summary) return null;
  return { summary: summary.slice(0, 600), strengths: list(r.strengths), improvements: list(r.improvements) };
}
