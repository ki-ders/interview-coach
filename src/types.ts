/** 공용 타입 정의 */

export type PersonaMood = 'warm' | 'neutral' | 'stern';

export interface Interviewer {
  id: string;
  name: string;
  title: string;
  /** 카드에 보여줄 한 줄 소개 */
  blurb: string;
  mood: PersonaMood;
  /** 아바타 렌더링 파라미터 */
  look: {
    skin: string;
    hair: string;
    hairStyle: 'bob' | 'short' | 'sweptBack' | 'buzz' | 'partedGray';
    suit: string;
    shirt: string;
    glasses: 'none' | 'round' | 'rect';
    /** 눈썹 각도(도). 음수=올라간 바깥쪽(온화), 양수=찌푸림 */
    browAngle: number;
    beard: boolean;
  };
  /** TTS 음성 파라미터 */
  voice: { pitch: number; rate: number; preferFemale: boolean };
  /** 말투 템플릿 */
  lines: {
    greeting: string[];
    ack: string[];
    pressForDetail: string[];
    pressForExample: string[];
    offTopic: string[];
    tooShort: string[];
    silence: string[];
    closing: string[];
  };
  /** 채점 엄격도 (1.0 = 표준) */
  strictness: number;
}

export interface Question {
  id: string;
  text: string;
  /** 답변에 등장하길 기대하는 키워드 (연관성 채점용) */
  keywords: string[];
  category: string;
  /** 자기소개처럼 정답 키워드가 정해지지 않은 개방형 질문 */
  open?: boolean;
}

export type MetricKey = 'gaze' | 'gesture' | 'speech' | 'voice' | 'calm';

export interface FrameSample {
  t: number;
  face: FaceSample | null;
  pose: PoseSample | null;
  audioDb: number;
  speaking: boolean;
}

export interface FaceSample {
  /** 보정 기준 대비 좌우 편차(도 단위 근사) */
  yawDev: number;
  /** 보정 기준 대비 상하 편차 */
  pitchDev: number;
  onTarget: boolean;
  lookingDown: boolean;
  blink: boolean;
}

export interface PoseSample {
  shoulderTilt: number;
  neckRatio: number;
  swaySpeed: number;
  handSpeed: number;
  selfTouch: boolean;
  legShake: number;
  handFidget: number;
}

/** HUD에 보여줄 실시간 0~100 지표 */
export type LiveMetrics = Record<MetricKey, number>;

export interface LiveAlert {
  id: number;
  /** 지표 키, 또는 블라인드 면접 규정 위반 */
  key: MetricKey | 'blind';
  text: string;
  t: number;
}

export interface AnswerRecord {
  questionId: string;
  questionText: string;
  transcript: string;
  /** 답변 길이(초) */
  durationSec: number;
  /** 실제로 소리를 낸 시간(초) */
  voicedSec: number;
  /** 질문이 끝나고 첫 마디까지 걸린 시간(초). 한마디도 없었으면 답변 시간 전체 */
  latencySec: number;
  startedAt: number;
  endedAt: number;
  speech: SpeechAnalysis;
  relevance: RelevanceAnalysis;
  /** 답변 구간 동안의 평균 지표 */
  metrics: LiveMetrics;
  followUpAsked: string | null;
  followUpReason: string | null;
  /** 음성 인식기가 준 평균 신뢰도(0~1). 브라우저가 주지 않으면 null */
  clarity: number | null;
  /** 잘 못 알아들어 다시 말해 달라고 했는지 */
  reasked: boolean;
}

export interface SpeechAnalysis {
  syllables: number;
  syllablesPerSec: number;
  fillerCount: number;
  fillerRatio: number;
  stutterCount: number;
  longPauses: number;
  sentenceEndRatio: number;
  wordCount: number;
}

export interface RelevanceAnalysis {
  score: number;
  matchedKeywords: string[];
  hasConcreteExample: boolean;
  hasStructure: boolean;
  note: string;
}

export interface MetricBreakdown {
  key: MetricKey;
  label: string;
  score: number;
  summary: string;
  details: { label: string; value: string; verdict: 'good' | 'warn' | 'bad' }[];
  tips: string[];
}

export interface SessionReport {
  total: number;
  grade: string;
  breakdown: MetricBreakdown[];
  content: {
    score: number;
    summary: string;
    perAnswer: { question: string; relevance: number; note: string }[];
    /** LLM 면접관이 쓴 총평 (제공자를 설정한 경우, 리포트가 뜬 뒤 도착한다) */
    llm?: { summary: string; strengths: string[]; improvements: string[] };
  };
  answers: AnswerRecord[];
  timeline: { t: number; metrics: LiveMetrics }[];
  durationSec: number;
  alerts: LiveAlert[];
  /** 블라인드 면접 모드였다면 규정 위반 내역. 하나라도 있으면 부적격 */
  blind?: { violations: BlindViolation[]; disqualified: boolean };
}

export type BlindCategory = 'name' | 'school' | 'family' | 'award' | 'examNo';

export interface BlindViolation {
  category: BlindCategory;
  label: string;
  /** 위반이 잡힌 대목 */
  excerpt: string;
  /** 몇 번째 문항에서 (0부터) */
  questionIndex: number;
}

export interface SessionConfig {
  interviewerIds: [string, string];
  questions: Question[];
  allowFollowUps: boolean;
  maxAnswerSec: number;
  silenceEndSec: number;
  /** 면접관 두뇌: 'none' | 'gemini' | 'claude' */
  llmProvider: 'none' | 'gemini' | 'claude';
  apiKey: string;
  /** 시선 안내: 렌즈 한 점만 표시(fixed) / 면접관과 렌즈 사이를 오가는 점을 따라가기(guided) */
  gazeGuide: 'fixed' | 'guided';
  /** 블라인드 면접: 성명·출신 학교·가족·수상·수험번호를 말하면 부적격 */
  blindMode: boolean;
  /** 면접 영상을 녹화해 끝나고 파일로 준다 (기기 밖으로 나가지 않는다) */
  recordVideo: boolean;
}
