/**
 * "말이 끝난 건지, 숨을 고르는 건지" — 침묵 길이만 보지 않고 받아쓰기 텍스트의 문법 상태를 함께 본다.
 * 실제 음성 AI 들이 쓰는 semantic turn detection 의 규칙 기반 축소판.
 *
 *  - 종결어미로 끝났다 ("…했습니다", "…인데요") → 평소보다 조금 빨리 넘어가도 된다
 *  - 연결어미·접속사·간투사로 끝났다 ("…했고", "그래서", "어…") → 아직 말이 남았으니 훨씬 오래 기다린다
 *  - 인식기가 아직 interim 을 내고 있다 → 말하는 중이니 기다린다
 */

export type Completeness = 'complete' | 'incomplete' | 'unknown';

/** 문장을 닫는 어미 (음성 인식 결과는 대체로 문어체로 정규화돼 나온다) */
const FINAL_ENDINGS =
  /(습니다|ㅂ니다|입니다|됩니다|합니다|십니다|어요|아요|해요|예요|이에요|에요|죠|지요|네요|거든요|는데요|ㄴ데요|던데요|습니까|ㅂ니까|나요|가요|까요|ㄹ까요|을까요|답니다|랍니다|군요|는군요|구나|겠어요|겠습니다|입니다만|였습니다|었습니다|았습니다|했어요|했죠|고요|고 있습니다|다고 생각합니다|것 같습니다|것 같아요)$/;

/** 문장을 잇는 어미·접속사 — 뒤에 말이 더 온다 */
const CONNECTIVE_ENDINGS =
  /(하고|이고|고|서|어서|아서|해서|라서|이라서|면|하면|이면|다면|지만|하지만|이지만|는데|한데|인데|니까|하니까|이니까|다가|면서|하면서|든지|거나|려고|하려고|기 때문에|때문에|위해서|위해|통해|통해서|대해서|대해|그리고|그래서|그런데|그러니까|그러면|또|또한|근데|그럼|하지만|그렇지만|그래도|일단|우선|먼저|첫째|둘째|그다음|다음으로|즉|예를 들면|예를 들어|특히|사실|만약|만일)$/;

/** 조사로 끝남 — 명사 뒤에 서술어가 아직 안 나왔다 */
const PARTICLE_ENDINGS = /(은|는|이|가|을|를|의|에|에서|으로|로|와|과|도|만|까지|부터|보다|처럼|한테|에게|께서|이나|나)$/;

/** 간투사로 끝남 — 생각 중 */
const FILLER_ENDINGS = /(^|\s)(어|음|아|에|그|저|뭐|이제|약간|좀|막|그니까|그러니까|뭔가|그냥)$/;

function tail(text: string): string {
  return text
    .trim()
    .replace(/[.?!…]+$/, '')
    .trim();
}

/** 마지막 어절 하나 */
function lastWord(text: string): string {
  const m = text.match(/(\S+)$/);
  return m ? m[1] : '';
}

export function judgeCompleteness(text: string): Completeness {
  const raw = text.trim();
  if (!raw) return 'unknown';
  const t = tail(raw);
  if (!t) return 'unknown';

  // 간투사·접속사·연결어미가 마지막이면 말이 남았다 (종결어미보다 먼저 본다: "그리고요" 같은 건 드물다)
  if (FILLER_ENDINGS.test(t)) return 'incomplete';
  if (CONNECTIVE_ENDINGS.test(t)) {
    // "…하고요" 처럼 '요' 로 닫힌 것은 종결로 본다 (위 정규식은 요 없는 형태만 잡는다)
    return 'incomplete';
  }
  if (FINAL_ENDINGS.test(t)) return 'complete';
  // 마침표·물음표로 끝났으면 인식기가 문장 끝으로 본 것
  if (/[.?!]$/.test(raw)) return 'complete';
  const w = lastWord(t);
  if (w.length >= 2 && PARTICLE_ENDINGS.test(w)) return 'incomplete';
  return 'unknown';
}

export interface TurnPolicyInput {
  /** 지금까지 인식된 전체 텍스트 (final + interim) */
  text: string;
  /** 인식기가 마지막으로 텍스트를 바꾼 뒤 지난 시간 (ms). 인식 결과가 없으면 Infinity */
  sinceSttUpdateMs: number;
  /** 설정된 기본 침묵 종료 시간 (초) */
  baseSilenceSec: number;
  /** 받아쓰기가 안 되는 환경이면 텍스트를 볼 수 없다 */
  sttAvailable: boolean;
}

export interface TurnPolicy {
  /** 이만큼 조용하면 답변이 끝난 것으로 본다 (초) */
  silenceSec: number;
  completeness: Completeness;
  /** 사람이 읽을 이유 */
  reason: string;
}

/** 지금 상태에서 몇 초의 침묵이면 턴을 끝낼지 정한다 */
export function decideTurnPolicy(input: TurnPolicyInput): TurnPolicy {
  const base = input.baseSilenceSec;
  if (!input.sttAvailable) {
    return { silenceSec: base, completeness: 'unknown', reason: '받아쓰기 없음 — 침묵 길이만 사용' };
  }
  // 인식기가 아직 결과를 만들고 있으면 사람이 말하는 중일 가능성이 크다
  if (input.sinceSttUpdateMs < 700) {
    return { silenceSec: Math.max(base, 3), completeness: 'unknown', reason: '인식 결과가 아직 갱신되는 중' };
  }
  const completeness = judgeCompleteness(input.text);
  switch (completeness) {
    case 'complete':
      return { silenceSec: Math.max(1.6, base * 0.8), completeness, reason: '문장이 끝맺어짐' };
    case 'incomplete':
      return { silenceSec: Math.min(Math.max(base * 2.4, 5), 7.5), completeness, reason: '말이 이어질 형태로 끝남' };
    default:
      return { silenceSec: base, completeness, reason: '판단 보류 — 기본값' };
  }
}
