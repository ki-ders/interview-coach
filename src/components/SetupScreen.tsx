import { useMemo, useState } from 'react';
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

export function SetupScreen({ onStart }: Props) {
  const [picked, setPicked] = useState<string[]>(['seo', 'kang']);
  const [packId, setPackId] = useState(QUESTION_PACKS[0].id);
  const [questions, setQuestions] = useState<Question[]>(QUESTION_PACKS[0].questions);
  const [draft, setDraft] = useState('');
  const [allowFollowUps, setAllowFollowUps] = useState(true);
  const [maxAnswerSec, setMaxAnswerSec] = useState(120);
  const [silenceEndSec, setSilenceEndSec] = useState(2.5);
  const [llmPrefs, setLlmPrefs] = useState<LlmPrefs>(loadLlmPrefs);
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
  const keyLooksOk = provider === 'none' || looksLikeKey(provider, apiKey);

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
            {!keyLooksOk && apiKey.length > 0 && (
              <span className="tiny" style={{ color: 'var(--bad)' }}>
                키 형식이 올바르지 않습니다. {keyHint(provider)}
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
      </section>

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
