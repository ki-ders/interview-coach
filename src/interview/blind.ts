/**
 * 블라인드 면접 규정 위반 감지.
 * 받아쓰기 텍스트에서 성명·출신 학교·가족/친인척·수상 실적·수험번호 언급을 찾는다.
 * 음성 인식 결과라 띄어쓰기가 흔들리므로 어절 경계에 크게 기대지 않는다.
 */
import type { BlindCategory, BlindViolation } from '../types';

export const BLIND_LABEL: Record<BlindCategory, string> = {
  name: '성명',
  school: '출신 학교',
  family: '가족·친인척',
  award: '수상 실적',
  examNo: '수험번호',
};

/** 자주 쓰는 성씨 — "저는 김민수입니다" 처럼 이름을 밝히는 문장을 잡는 데 쓴다 */
const SURNAMES =
  '김이박최정강조윤장임한오서신권황안송류전홍고문양손배백허유남심노하곽성차주우구민나진지엄채원천방공현함변염여추도소석선설마길연위표명기반왕금옥육인맹제모탁국은편용';

/** 성씨로 시작하지만 이름이 아닌 흔한 세 글자 낱말 */
const NOT_NAMES = new Set([
  '지원자', '신입생', '졸업생', '대학생', '고등학생', '학생', '사람', '지원생', '전공자', '경력자',
  '한국인', '한국어', '한국사', '이공계', '문과생', '이과생', '장학생', '연구원', '주니어', '시니어',
  '개발자', '기획자', '디자이너', '조직원', '구성원', '성실한', '한마디', '한사람', '고민이', '문제가',
  '조금은', '유일한', '전문가', '고객이', '장기적', '안정적', '주도적', '적극적', '성장형', '노력파',
  '공무원', '은행원', '편입생', '유학생', '마케터', '변호사', '남학생', '여학생', '인문계', '정직원', '정규직',
  '임시직', '인턴십', '신중한', '차분한', '진취적', '진솔한', '정확한', '명확한', '원활한', '소극적', '도전적',
  '오래된', '조교수', '서울시', '채용팀', '지원팀', '개발팀', '기획팀', '신입인', '경력직', '경력자',
]);

const SCHOOL_NAMES =
  /카이스트|포스텍|서울대|연세대|고려대|연고대|성균관대|한양대|중앙대|경희대|서강대|이화여대|숙명여대|건국대|동국대|홍익대|국민대|숭실대|세종대|인하대|아주대|부산대|경북대|전남대|충남대|충북대|전북대|강원대|제주대|울산대|영남대|계명대|단국대|가천대|광운대|명지대|상명대|한국외대|외대|서울시립대|시립대|과기원|유니스트|디지스트|지스트|민사고|대원외고|하나고|상산고|외대부고/;

interface Rule {
  category: BlindCategory;
  test: (text: string) => string | null;
}

function firstMatch(text: string, re: RegExp): string | null {
  const m = text.match(re);
  return m ? m[0] : null;
}

/** 매치 앞뒤로 조금 잘라 어느 대목인지 보여준다 */
function excerptAround(text: string, hit: string): string {
  const i = text.indexOf(hit);
  if (i < 0) return hit;
  const s = Math.max(0, i - 10);
  const e = Math.min(text.length, i + hit.length + 10);
  return `${s > 0 ? '…' : ''}${text.slice(s, e).trim()}${e < text.length ? '…' : ''}`;
}

/** 성씨 + 두 글자 이름 (음성 인식이 "김 민수" 처럼 띄어 적는 경우도 잡는다) */
const NAME = `[${SURNAMES}]\\s?[가-힣]{2}`;

function nameMention(text: string): string | null {
  // "제 이름은 ○○○", "이름은 ○○○"
  const explicit = firstMatch(text, /(제|저의|내|저희)?\s*이름(은|이|을)\s*[가-힣]{2,4}/);
  if (explicit) return explicit;
  const candidates: RegExp[] = [
    // "김민수라고 합니다", "김민수라고 해요"
    new RegExp(`(?<![가-힣])(${NAME})\\s*(이라고|라고)\\s*(합니다|해요|부릅니다|불러|해)`),
    // "저는 김민수입니다", "저는 김민수 입니다", "저는 김민수이고", "전 김민수예요"
    new RegExp(`(저는|전|나는|난)\\s*(${NAME})\\s*(입니다|이고|이며|이라고|입니다만|예요|이에요|야|이야|다)(?![가-힣])`),
    // 답변 첫머리 "김민수입니다" / "안녕하세요 김민수입니다"
    new RegExp(`(^|안녕하세요[,.]?\\s*|반갑습니다[,.]?\\s*)(${NAME})\\s*(입니다|이라고|예요|이에요)`),
    // "지원자 김민수입니다", "○○ 지원자 김민수"
    new RegExp(`지원자\\s*(${NAME})(?=\\s*(입니다|이라고|예요|이에요|이고|이며|$|\\s))`),
  ];
  for (const re of candidates) {
    const m = text.match(re);
    if (!m) continue;
    // 캡처 그룹 중 이름 후보(성씨로 시작하는 것)를 찾는다
    const name = m.slice(1).find((g) => g && new RegExp(`^${NAME}$`).test(g))?.replace(/\s/g, '');
    if (name && !NOT_NAMES.has(name) && name.length >= 2) return m[0].trim();
  }
  return null;
}

function schoolMention(text: string): string | null {
  const named = firstMatch(text, SCHOOL_NAMES);
  if (named) return named;
  // "○○대학교", "○○고등학교" — 앞에 붙은 고유명사가 있을 때만 (그냥 "대학교에서" 는 제외)
  const suffixed = text.match(/(?<![가-힣])([가-힣]{2,6})(대학교|고등학교|여자고등학교|중학교|여고|공고|외고|과학고|국제고|특성화고|전문대|사이버대)(?![가-힣])/);
  if (suffixed && !/^(저희|우리|이|그|저|어느|다른|같은|모든|일반|지방|수도권|서울|지역|명문|국립|사립)$/.test(suffixed[1])) return suffixed[0];
  return null;
}

const FAMILY_RE =
  /아버지|어머니|아버님|어머님|부모님|(?<![가-힣])아빠|(?<![가-힣])엄마|할머니|할아버지|외할|친할|(?<![가-힣])삼촌|외삼촌|(?<![가-힣])이모(?![티저])|(?<![가-힣])고모(?!라)|(?<![가-힣])사촌|친척|친인척|(?<![가-힣])조카|매형|매부|형부|처남|처형|(?<![가-힣])남편|(?<![가-힣])아내|와이프|장인어른|장모님|시어머니|시아버지|(?<![가-힣])누나(?=[가-힣\s]|$)|(?<![가-힣])언니(?=[가-힣\s]|$)|(?<![가-힣])오빠(?=[가-힣\s]|$)|(?<![가-힣])동생(?=[가-힣\s]|$)|(?<![가-힣])형(?=[이은을과랑도님한]|\s|$)/;

const AWARD_RE =
  /수상|입상|표창|(최우수|우수|장려|특별|공로|금|은|동|대)상(을|를|도)?\s*(받|타|수여|드|주)|(1등|일등|1위|우승|준우승|메달|장학금)(을|를|으로|로|도)?\s*(했|받|따|차지|탔|수상)/;

const EXAM_RE = /수험\s*번호|응시\s*번호|접수\s*번호|(?<![\d])\d{3,}\s*번\s*(입니다|이고|이에요|예요|지원자)/;

const RULES: Rule[] = [
  { category: 'name', test: nameMention },
  { category: 'school', test: schoolMention },
  { category: 'family', test: (t) => firstMatch(t, FAMILY_RE) },
  { category: 'award', test: (t) => firstMatch(t, AWARD_RE) },
  { category: 'examNo', test: (t) => firstMatch(t, EXAM_RE) },
];

/** 한 답변에서 위반한 항목들. 같은 항목은 한 번만 */
export function detectBlindViolations(text: string, questionIndex = 0): BlindViolation[] {
  const out: BlindViolation[] = [];
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return out;
  for (const rule of RULES) {
    const hit = rule.test(clean);
    if (hit) out.push({ category: rule.category, label: BLIND_LABEL[rule.category], excerpt: excerptAround(clean, hit), questionIndex });
  }
  return out;
}

/** 면접관이 즉석에서 지적하는 말 */
export function blindWarningLine(v: BlindViolation): string {
  return `잠깐만요. 블라인드 면접 규정상 ${v.label}${particle(v.label)} 말씀하시면 안 됩니다. 이 부분은 부적격 사유로 기록됩니다. 이어서 답변해 주세요.`;
}

/** 받침 유무에 따라 은/는 */
function particle(word: string): '은' | '는' {
  const last = word.charCodeAt(word.length - 1);
  if (last < 0xac00 || last > 0xd7a3) return '는';
  return (last - 0xac00) % 28 === 0 ? '는' : '은';
}

export const BLIND_RULE_LINE =
  '이 면접은 블라인드 면접입니다. 성명, 출신 학교, 가족이나 친인척, 수상 실적, 수험번호는 말씀하지 마세요. 언급하면 부적격 처리됩니다.';
