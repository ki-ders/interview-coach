import { useState } from 'react';
import type { Question } from '../types';
import { createInterviewerLlm, PROVIDER_LABEL, type LlmProvider } from '../interview/llm';

interface Props {
  provider: LlmProvider;
  apiKey: string;
  onGenerated: (questions: Question[]) => void;
}

const DRAFT_KEY = 'interview-coach:job-context';

/**
 * 채용 공고·직무 설명을 붙여 넣으면 면접관 두뇌가 예상 질문을 만든다.
 * 두뇌가 꺼져 있으면 켜는 방법만 안내한다.
 */
export function JobQuestions({ provider, apiKey, onGenerated }: Props) {
  const [open, setOpen] = useState(false);
  const [context, setContext] = useState(() => {
    try {
      return localStorage.getItem(DRAFT_KEY) ?? '';
    } catch {
      return '';
    }
  });
  const [count, setCount] = useState(6);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const saveDraft = (v: string) => {
    setContext(v);
    try {
      localStorage.setItem(DRAFT_KEY, v);
    } catch {
      /* noop */
    }
  };

  const run = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const llm = await createInterviewerLlm(provider, apiKey);
      if (!llm?.generateQuestions) {
        setMessage({ ok: false, text: '면접관 두뇌의 API 키를 먼저 넣어 주세요.' });
        return;
      }
      const list = await llm.generateQuestions(context, count);
      if (!list?.length) {
        setMessage({ ok: false, text: llm.lastError ?? '질문을 만들지 못했습니다. 공고 내용을 조금 더 붙여 넣고 다시 시도해 주세요.' });
        return;
      }
      const stamp = Date.now().toString(36);
      onGenerated(
        list.map((g, i) => ({ id: `g${stamp}${i}`, text: g.text, keywords: g.keywords, category: g.category, open: i === 0 })),
      );
      setMessage({ ok: true, text: `${list.length}개 질문을 만들어 위 목록을 바꿨습니다. 마음에 안 드는 질문은 × 로 지우세요.` });
    } finally {
      setBusy(false);
    }
  };

  if (provider === 'none') {
    return (
      <p className="tiny faint" style={{ margin: '12px 0 0' }}>
        아래 "면접관 두뇌" 에서 Gemini(무료)를 켜면 채용 공고를 붙여 넣어 맞춤 예상 질문을 만들 수 있습니다.
      </p>
    );
  }

  return (
    <div className="jobq">
      <button type="button" className="btn btn--ghost" onClick={() => setOpen((v) => !v)}>
        {open ? '▾' : '▸'} 채용 공고로 예상 질문 만들기 ({PROVIDER_LABEL[provider]})
      </button>
      {open && (
        <div className="stack" style={{ gap: 8, marginTop: 8 }}>
          <textarea
            className="input"
            rows={6}
            placeholder={'지원하는 회사·직무, 또는 채용 공고의 "주요 업무 / 자격 요건 / 우대 사항" 을 그대로 붙여 넣으세요.\n예) ○○공사 전산직 신입 — 주요 업무: 정보시스템 운영, 보안 관리 …'}
            value={context}
            onChange={(e) => saveDraft(e.target.value)}
          />
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            {[5, 6, 8].map((n) => (
              <button key={n} type="button" className={`pack${count === n ? ' pack--on' : ''}`} onClick={() => setCount(n)}>
                {n}문항
              </button>
            ))}
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => void run()}
              disabled={busy || context.trim().length < 10 || !apiKey.trim()}
            >
              {busy ? '만드는 중…' : '질문 만들기'}
            </button>
          </div>
          {!apiKey.trim() && <span className="tiny" style={{ color: 'var(--warn)' }}>아래 면접관 두뇌에 API 키를 먼저 넣어 주세요.</span>}
          {message && (
            <span className="tiny" style={{ color: message.ok ? 'var(--good)' : 'var(--bad)' }}>
              {message.text}
            </span>
          )}
          <span className="tiny faint">붙여 넣은 공고는 이 브라우저에만 저장되고, 질문을 만들 때만 {PROVIDER_LABEL[provider]} 로 보냅니다.</span>
        </div>
      )}
    </div>
  );
}
