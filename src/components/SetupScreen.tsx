import { useEffect, useMemo, useState } from 'react';
import { INTERVIEWERS } from '../data/interviewers';
import { QUESTION_PACKS, makeQuestion } from '../data/questions';
import type { Question, SessionConfig } from '../types';
import { InterviewerCard } from './InterviewerCard';
import {
  PROVIDER_LABEL,
  createInterviewerLlm,
  keyHint,
  looksLikeKey,
  type LlmProvider,
  type LlmTestResult,
} from '../interview/llm';
import { PhotoGuide } from './PhotoGuide';
import { BackdropPicker } from './BackdropPicker';
import { VoicePicker } from './VoicePicker';

interface Props {
  onStart: (config: SessionConfig) => void;
}

/** 제공자 선택과 제공자별 키를 이 브라우저에만 저장한다 */
const LLM_STORE = 'interview-coach:llm';
interface LlmPrefs {
  provider: LlmProvider;
  keys: Partial<Record<LlmProvider, string>>;
}
function loadLlmPrefs(): LlmPrefs {
  try {
    const raw = localStorage.getItem(LLM_STORE);
    if (raw) {
      const p = JSON.parse(raw) as Partial<LlmPrefs>;
      if (p.provider && p.keys) return { provider: p.provider, keys: p.keys };
    }
    // 예전 버전의 Anthropic 키 저장소
    const legacy = localStorage.getItem('interview-coach:apiKey');
    if (legacy) return { provider: 'none', keys: { claude: legacy } };
  } catch {
    /* 손상된 값은 무시 */
  }
  return { provider: 'none', keys: {} };
}
const PROVIDERS: LlmProvider[] = ['none', 'gemini', 'claude'];

/** 진행 방식 선택 — 다음에 열어도 그대로 */
const PREF_STORE = 'interview-coach:prefs';
interface Prefs {
  gazeGuide: 'interviewer' | 'lens';
  blindMode: boolean;
  recordVideo: boolean;
  naturalVoice: boolean;
}
const DEFAULT_PREFS: Prefs = { gazeGuide: 'interviewer', blindMode: false, recordVideo: true, naturalVoice: true };
function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(PREF_STORE);
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw) as Omit<Partial<Prefs>, 'gazeGuide'> & { gazeGuide?: string };
    return {
      // 예전 값(fixed/guided)은 렌즈/면접관으로 옮긴다
      gazeGuide: parsed.gazeGuide === 'lens' || parsed.gazeGuide === 'fixed' ? 'lens' : 'interviewer',
      blindMode: parsed.blindMode === true,
      recordVideo: parsed.recordVideo !== false,
      naturalVoice: parsed.naturalVoice !== false,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function SetupScreen({ onStart }: Props) {
  const [picked, setPicked] = useState<string[]>(['seo', 'kang']);
  const [packId, setPackId] = useState(QUESTION_PACKS[0].id);
  const [questions, setQuestions] = useState<Question[]>(QUESTION_PACKS[0].questions);
  const [draft, setDraft] = useState('');
  const [allowFollowUps, setAllowFollowUps] = useState(true);
  const [maxAnswerSec, setMaxAnswerSec] = useState(120);
  const [silenceEndSec, setSilenceEndSec] = useState(2.5);
  const [prefs, setPrefs] = useState(loadPrefs);
  useEffect(() => {
    try {
      localStorage.setItem(PREF_STORE, JSON.stringify(prefs));
    } catch {
      /* 저장 공간 없음 등은 무시 */
    }
  }, [prefs]);
  const setPref = <K extends keyof Prefs>(k: K, v: Prefs[K]) => setPrefs((p) => ({ ...p, [k]: v }));
  const [llmPrefs, setLlmPrefs] = useState<LlmPrefs>(loadLlmPrefs);
  // 키와 선택은 입력하는 즉시 저장한다 — "면접 시작" 을 누르기 전에 새로고침해도 남아 있게
  useEffect(() => {
    try {
      localStorage.setItem(LLM_STORE, JSON.stringify(llmPrefs));
    } catch {
      /* 저장 공간 없음 등은 무시 */
    }
  }, [llmPrefs]);
  const [testResult, setTestResult] = useState<LlmTestResult | null>(null);
  const [testing, setTesting] = useState(false);
  const provider = llmPrefs.provider;
  const apiKey = llmPrefs.keys[provider] ?? '';
  const setProvider = (next: LlmProvider) => {
    setTestResult(null);
    setLlmPrefs((p) => ({ ...p, provider: next }));
  };
  const setApiKey = (key: string) => {
    setTestResult(null);
    setLlmPrefs((p) => ({ ...p, keys: { ...p.keys, [p.provider]: key } }));
  };

  const ready = picked.length === 2 && questions.length > 0;
  const keyLooksOk = provider === 'none' || apiKey.trim().length > 0;
  const keyLooksOdd = provider !== 'none' && apiKey.trim().length > 0 && !looksLikeKey(provider, apiKey);

  const testKey = async () => {
    setTesting(true);
    try {
      const llm = await createInterviewerLlm(provider, apiKey);
      setTestResult(llm ? await llm.test() : { ok: false, message: '키를 입력하세요.' });
    } finally {
      setTesting(false);
    }
  };

  const toggle = (id: string) => {
    setPicked((cur) => {
      if (cur.includes(id)) return cur.filter((x) => x !== id);
      if (cur.length >= 2) return [cur[1], id];
      return [...cur, id];
    });
  };

  const choosePack = (id: string) => {
    setPackId(id);
    const pack = QUESTION_PACKS.find((p) => p.id === id);
    if (pack) setQuestions(pack.questions);
  };

  const addQuestion = () => {
    const text = draft.trim();
    if (!text) return;
    setQuestions((q) => [...q, makeQuestion(text)]);
    setDraft('');
    setPackId('custom');
  };

  const estimate = useMemo(() => {
    const perQuestion = 20 + Math.min(maxAnswerSec, 90) * 0.55;
    return Math.round((questions.length * perQuestion) / 60);
  }, [questions.length, maxAnswerSec]);

  const submit = () => {
    if (!ready || !keyLooksOk) return;
    localStorage.setItem(LLM_STORE, JSON.stringify(llmPrefs));
    onStart({
      interviewerIds: [picked[0], picked[1]],
      questions,
      allowFollowUps,
      maxAnswerSec,
      silenceEndSec,
      llmProvider: provider,
      apiKey: provider === 'none' ? '' : apiKey.trim(),
      gazeGuide: prefs.gazeGuide,
      blindMode: prefs.blindMode,
      recordVideo: prefs.recordVideo,
      naturalVoice: prefs.naturalVoice,
    });
  };

  return (
    <div className="page stack">
      <div className="hero">
        <h1>AI 모의 면접</h1>
        <p>
          카메라로 시선·자세·떨림을, 마이크로 발성과 말투를 실시간으로 분석합니다. 가상 면접관 두 명이
          질문하고, 끝나면 항목별 점수와 개선점을 정리해 드립니다.
        </p>
      </div>

      {/* 1. 면접관 */}
      <section className="card card__pad">
        <div className="section-title">
          <span className="section-title__num">1</span>
          <h2>면접관 두 명 고르기</h2>
          <span className="muted tiny">
            {picked.length}/2 선택됨 · 먼저 고른 쪽이 첫 질문을 합니다
          </span>
        </div>
        <div className="pick-grid">
          {INTERVIEWERS.map((who) => (
            <InterviewerCard key={who.id} who={who} order={picked.indexOf(who.id)} onToggle={() => toggle(who.id)} />
          ))}
        </div>
        <PhotoGuide />
        <p className="tiny faint" style={{ marginTop: 12, marginBottom: 0 }}>
          등장 인물은 모두 가상이며 실존 인물과 관계가 없습니다. 사진을 넣을 때도 실존 인물 사진은 쓰지 마세요.
        </p>
        <hr className="hr" />
        <VoicePicker picked={picked} />
        <hr className="hr" />
        <BackdropPicker />
      </section>

      {/* 2. 질문 */}
      <section className="card card__pad">
        <div className="section-title">
          <span className="section-title__num">2</span>
          <h2>질문 준비</h2>
          <span className="muted tiny">{questions.length}문항 · 예상 {estimate}분</span>
        </div>

        <div className="pack-row">
          {QUESTION_PACKS.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`pack${packId === p.id ? ' pack--on' : ''}`}
              onClick={() => choosePack(p.id)}
            >
              {p.name}
            </button>
          ))}
          {packId === 'custom' && <span className="pack pack--on">직접 편집됨</span>}
        </div>

        <div className="qlist">
          {questions.map((q, i) => (
            <div className="qitem" key={q.id}>
              <span className="qitem__idx">{i + 1}</span>
              <span className="qitem__text">{q.text}</span>
              <button
                type="button"
                className="icon-btn"
                aria-label="질문 삭제"
                onClick={() => {
                  setQuestions((cur) => cur.filter((x) => x.id !== q.id));
                  setPackId('custom');
                }}
              >
                ×
              </button>
            </div>
          ))}
          {!questions.length && <p className="muted tiny">질문을 최소 한 개 이상 추가해 주세요.</p>}
        </div>

        <div className="row" style={{ marginTop: 14, flexWrap: 'nowrap' }}>
          <input
            className="input"
            placeholder="직접 질문 추가 — 예: 본인이 가장 몰입했던 경험은 무엇인가요?"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') addQuestion();
            }}
          />
          <button type="button" className="btn" onClick={addQuestion} disabled={!draft.trim()}>
            추가
          </button>
        </div>
      </section>

      {/* 3. 설정 */}
      <section className="card card__pad">
        <div className="section-title">
          <span className="section-title__num">3</span>
          <h2>진행 방식</h2>
        </div>

        <div className="switch-row">
          <div className="switch-row__body">
            <div className="switch-row__title">꼬리 질문 허용</div>
            <div className="muted tiny">
              답변이 짧거나 질문에서 벗어나면 면접관이 한 번 더 되묻습니다.
            </div>
          </div>
          <button
            type="button"
            className={`switch${allowFollowUps ? ' switch--on' : ''}`}
            onClick={() => setAllowFollowUps((v) => !v)}
            aria-pressed={allowFollowUps}
            aria-label="꼬리 질문 허용"
          />
        </div>

        <div className="switch-row">
          <div className="switch-row__body">
            <div className="switch-row__title">답변 최대 시간 · {maxAnswerSec}초</div>
            <input
              className="slider"
              type="range"
              min={30}
              max={300}
              step={10}
              value={maxAnswerSec}
              onChange={(e) => setMaxAnswerSec(Number(e.target.value))}
            />
          </div>
        </div>

        <div className="switch-row">
          <div className="switch-row__body">
            <div className="switch-row__title">
              답변 종료 판정 · {silenceEndSec.toFixed(1)}초 침묵
            </div>
            <div className="muted tiny">
              생각할 시간이 더 필요하면 길게, 빠른 진행을 원하면 짧게 설정하세요.
            </div>
            <input
              className="slider"
              type="range"
              min={1.5}
              max={6}
              step={0.5}
              value={silenceEndSec}
              onChange={(e) => setSilenceEndSec(Number(e.target.value))}
            />
          </div>
        </div>

        <div className="switch-row">
          <div className="switch-row__body">
            <div className="switch-row__title">시선 기준</div>
            <div className="muted tiny">
              {prefs.gazeGuide === 'interviewer'
                ? '질문한 면접관의 눈을 보는 것이 좋은 시선입니다. 점이 그 면접관 눈 위에 있고, 가끔 옆 면접관으로 옮겨 가니 자연스럽게 따라가세요. 실제 대면 면접 연습에 맞습니다.'
                : '카메라 렌즈를 보는 것이 좋은 시선입니다. 화상 면접(줌·웹캠) 연습에 맞습니다.'}
            </div>
            <div className="row" style={{ marginTop: 8, gap: 6 }}>
              <button
                type="button"
                className={`pack${prefs.gazeGuide === 'interviewer' ? ' pack--on' : ''}`}
                onClick={() => setPref('gazeGuide', 'interviewer')}
              >
                면접관 눈 (대면 면접)
              </button>
              <button
                type="button"
                className={`pack${prefs.gazeGuide === 'lens' ? ' pack--on' : ''}`}
                onClick={() => setPref('gazeGuide', 'lens')}
              >
                카메라 렌즈 (화상 면접)
              </button>
            </div>
          </div>
        </div>

        <div className="switch-row">
          <div className="switch-row__body">
            <div className="switch-row__title">블라인드 면접</div>
            <div className="muted tiny">
              성명·출신 학교·가족/친인척·수상 실적·수험번호를 말하면 면접관이 즉시 지적하고, 결과는{' '}
              <strong>부적격</strong>으로 처리됩니다. 시작할 때 규정을 안내합니다.
            </div>
          </div>
          <button
            type="button"
            className={`switch${prefs.blindMode ? ' switch--on' : ''}`}
            onClick={() => setPref('blindMode', !prefs.blindMode)}
            aria-pressed={prefs.blindMode}
            aria-label="블라인드 면접"
          />
        </div>

        <div className="switch-row">
          <div className="switch-row__body">
            <div className="switch-row__title">면접 영상 녹화</div>
            <div className="muted tiny">
              카메라 영상과 내 목소리를 녹화해 끝나면 파일로 저장·공유할 수 있습니다. 영상은 이 기기 밖으로 나가지
              않습니다.
            </div>
          </div>
          <button
            type="button"
            className={`switch${prefs.recordVideo ? ' switch--on' : ''}`}
            onClick={() => setPref('recordVideo', !prefs.recordVideo)}
            aria-pressed={prefs.recordVideo}
            aria-label="면접 영상 녹화"
          />
        </div>

        <div className="field" style={{ marginTop: 6 }}>
          <div className="switch-row__title">면접관 두뇌 (선택)</div>
          <div className="muted tiny" style={{ marginBottom: 8 }}>
            AI 를 붙이면 면접관이 답변 내용을 실제로 읽고, 방금 한 말을 짚어 되묻고, 옆 면접관이 끼어들고, 끝나면
            내용 총평을 씁니다. 없어도 채점과 면접은 그대로 진행됩니다. 키는 이 브라우저에만 저장되고 요청은 기기에서
            직접 나갑니다.
          </div>
          <div className="pack-row">
            {PROVIDERS.map((id) => (
              <button
                key={id}
                type="button"
                className={`pack${provider === id ? ' pack--on' : ''}`}
                onClick={() => setProvider(id)}
                aria-pressed={provider === id}
              >
                {PROVIDER_LABEL[id]}
              </button>
            ))}
          </div>
          {provider === 'gemini' && (
            <div className="muted tiny" style={{ marginTop: 6 }}>
              <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">
                aistudio.google.com/apikey
              </a>{' '}
              에서 Google 계정으로 무료 키를 만들 수 있습니다 (카드 등록 없음). 답변 텍스트가 Google 로 전송됩니다.
            </div>
          )}
          {provider === 'claude' && (
            <div className="muted tiny" style={{ marginTop: 6 }}>
              유료입니다 (8문항 면접 한 번에 대략 몇백 원). console.anthropic.com 에서 키를 만듭니다.
            </div>
          )}
        </div>

        {provider !== 'none' && (
          <div className="field" style={{ marginTop: 4 }}>
            <label htmlFor="apikey">{PROVIDER_LABEL[provider]} API 키</label>
            <div className="row" style={{ gap: 8 }}>
              <input
                id="apikey"
                className="input"
                type="password"
                autoComplete="off"
                placeholder={keyHint(provider)}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                style={{ flex: 1 }}
              />
              <button
                type="button"
                className="btn btn--ghost"
                disabled={!keyLooksOk || !apiKey || testing}
                onClick={() => void testKey()}
              >
                {testing ? '확인 중…' : '연결 테스트'}
              </button>
            </div>
            {keyLooksOdd && (
              <span className="tiny" style={{ color: 'var(--warn)' }}>
                보통 {keyHint(provider).split(' ')[0]} 로 시작합니다. 다른 곳의 키를 넣은 건 아닌지 확인하고, 연결 테스트로 확인해 보세요.
              </span>
            )}
            {testResult && (
              <span className="tiny" style={{ color: testResult.ok ? 'var(--good)' : 'var(--bad)' }}>
                {testResult.message}
              </span>
            )}
            <span className="tiny faint">키가 없거나 호출이 실패하면 규칙 기반으로 자동 전환됩니다.</span>
          </div>
        )}

        {provider === 'gemini' && (
          <div className="switch-row" style={{ marginTop: 10 }}>
            <div className="switch-row__body">
              <div className="switch-row__title">자연스러운 목소리 (Gemini 음성)</div>
              <div className="muted tiny">
                면접관이 기기 내장 음성 대신 Gemini 음성으로 말합니다. 남녀·성향별로 목소리가 다르고 훨씬 사람 같습니다.
                무료 한도에 걸리거나 늦어지면 그 문장만 기기 음성으로 대신하고, 화면 위에 알려 드립니다.
              </div>
            </div>
            <button
              type="button"
              className={`switch${prefs.naturalVoice ? ' switch--on' : ''}`}
              onClick={() => setPref('naturalVoice', !prefs.naturalVoice)}
              aria-pressed={prefs.naturalVoice}
              aria-label="자연스러운 목소리"
            />
          </div>
        )}
      </section>

      <div className="banner banner--info">
        <strong>이어폰을 꼭 써 주세요.</strong> 스피커로 들으면 면접관 목소리가 마이크로 되돌아와 받아쓰기에 섞이고,
        답변이 끝났는지 판단이 흔들립니다. 이어폰(유선·무선 모두)이면 인식 정확도가 눈에 띄게 올라갑니다.
      </div>

      <div className="row" style={{ justifyContent: 'center' }}>
        <button
          type="button"
          className="btn btn--primary btn--lg"
          disabled={!ready || !keyLooksOk}
          onClick={submit}
        >
          면접 시작하기
        </button>
      </div>

      <p className="tiny faint" style={{ textAlign: 'center', margin: 0 }}>
        영상과 음성은 이 기기 안에서만 처리되며 어디에도 저장·전송되지 않습니다.
        <br />
        (음성 인식은 브라우저 내장 기능을 사용하므로, Chrome 에서는 음성이 Google 인식 서버를 거칩니다.)
      </p>
    </div>
  );
}
