import type { MetricKey, SessionReport } from '../types';
import { METRIC_LABELS } from '../scoring/metrics';

interface Props {
  report: SessionReport;
  onRestart: () => void;
}

const LINE_COLOR: Record<MetricKey, string> = {
  gaze: '#3b82f6',
  gesture: '#8b5cf6',
  speech: '#10b981',
  voice: '#f59e0b',
  calm: '#ec4899',
};

function fmtDuration(sec: number) {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return m > 0 ? `${m}분 ${s}초` : `${s}초`;
}

function verdictOf(score: number) {
  if (score >= 85) return '아주 좋습니다';
  if (score >= 70) return '무난합니다';
  if (score >= 55) return '보완이 필요합니다';
  return '집중 연습이 필요합니다';
}

export function ReportScreen({ report, onRestart }: Props) {
  const weakest = [...report.breakdown].sort((a, b) => a.score - b.score)[0];
  const strongest = [...report.breakdown].sort((a, b) => b.score - a.score)[0];
  const noData = report.answers.length === 0;

  return (
    <div className="page stack">
      <section className="card card__pad">
        <div className="score-hero">
          <div className="score-ring" style={{ ['--pct' as string]: report.total }}>
            <div className="score-ring__inner">
              <div className="score-ring__num">{report.total}</div>
              <div className="score-ring__grade">{report.grade}</div>
            </div>
          </div>
          <div style={{ flex: 1, minWidth: 260 }}>
            <h1 style={{ fontSize: 22, marginBottom: 6 }}>모의 면접 결과</h1>
            <p className="muted" style={{ margin: '0 0 12px' }}>
              {fmtDuration(report.durationSec)} 동안 {report.answers.length}개 문항에 답했습니다.
            </p>
            {!noData && (
              <div className="row">
                <span className="chip">
                  가장 좋았던 항목: <b>{strongest.label}</b> {strongest.score}점
                </span>
                <span className="chip">
                  보완할 항목: <b>{weakest.label}</b> {weakest.score}점
                </span>
              </div>
            )}
          </div>
        </div>

        {noData && (
          <div className="banner banner--warn" style={{ marginTop: 16 }}>
            답변이 기록되지 않아 점수 신뢰도가 낮습니다. 마이크 권한과 입력 장치를 확인한 뒤 다시
            시도해 주세요.
          </div>
        )}
      </section>

      <section className="stack" style={{ gap: 14 }}>
        <div className="section-title">
          <h2>항목별 평가</h2>
        </div>
        <div className="metric-grid">
          {report.breakdown.map((m) => (
            <div className="card metric" key={m.key}>
              <div className="metric__head">
                <div>
                  <div style={{ fontWeight: 700 }}>{m.label}</div>
                  <div className="tiny faint">{verdictOf(m.score)}</div>
                </div>
                <div className="metric__score" style={{ color: LINE_COLOR[m.key] }}>
                  {m.score}
                </div>
              </div>
              <p className="muted tiny" style={{ margin: 0 }}>
                {m.summary}
              </p>
              <div className="metric__rows">
                {m.details.map((d) => (
                  <div className="metric__row" key={d.label}>
                    <span className="muted">{d.label}</span>
                    <span className={`verdict verdict--${d.verdict}`}>{d.value}</span>
                  </div>
                ))}
              </div>
              <ul className="tips">
                {m.tips.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <section className="card card__pad">
        <div className="section-title">
          <h2>답변 내용 평가</h2>
          <span className="chip">{report.content.score}점</span>
        </div>
        <p className="muted" style={{ marginTop: 0 }}>
          {report.content.summary}
        </p>
        {report.content.perAnswer.length > 0 && (
          <div className="metric__rows" style={{ marginTop: 10 }}>
            {report.content.perAnswer.map((p, i) => (
              <div className="metric__row" key={i}>
                <span className="muted" style={{ flex: 1 }}>
                  {i + 1}. {p.question}
                </span>
                <span
                  className={`verdict verdict--${
                    p.relevance >= 70 ? 'good' : p.relevance >= 45 ? 'warn' : 'bad'
                  }`}
                >
                  {p.relevance}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {report.timeline.length > 3 && (
        <section className="card card__pad">
          <div className="section-title">
            <h2>시간에 따른 변화</h2>
          </div>
          <Timeline report={report} />
          <div className="legend" style={{ marginTop: 10 }}>
            {report.breakdown.map((m) => (
              <span key={m.key}>
                <i style={{ background: LINE_COLOR[m.key] }} />
                {METRIC_LABELS[m.key]}
              </span>
            ))}
          </div>
        </section>
      )}

      {report.answers.length > 0 && (
        <section className="stack" style={{ gap: 10 }}>
          <div className="section-title">
            <h2>질문별 기록</h2>
          </div>
          {report.answers.map((a, i) => (
            <div className="qa" key={`${a.questionId}-${i}`}>
              <div className="qa__q">
                Q{i + 1}. {a.questionText}
              </div>
              {a.followUpAsked && (
                <div className="tiny" style={{ color: 'var(--accent)' }}>
                  ↳ 꼬리 질문: {a.followUpAsked}
                </div>
              )}
              <div className="qa__a">{a.transcript || '(인식된 답변 없음)'}</div>
              <div className="qa__meta">
                <span className="chip">길이 {Math.round(a.durationSec)}초</span>
                {a.latencySec >= 4 && <span className="chip">시작까지 {Math.round(a.latencySec)}초</span>}
                <span className="chip">{a.speech.wordCount}어절</span>
                <span className="chip">연관성 {a.relevance.score}점</span>
                {a.speech.longPauses > 0 && (
                  <span className="chip">긴 침묵 {a.speech.longPauses}회</span>
                )}
                {a.relevance.hasConcreteExample && <span className="chip">사례 포함</span>}
              </div>
              <div className="tiny muted">{a.relevance.note}</div>
            </div>
          ))}
        </section>
      )}

      {report.alerts.length > 0 && (
        <section className="card card__pad">
          <div className="section-title">
            <h2>면접 중 받은 실시간 알림</h2>
            <span className="chip">{report.alerts.length}회</span>
          </div>
          <div className="metric__rows">
            {report.alerts.map((al) => (
              <div className="metric__row" key={al.id}>
                <span className="muted">{al.text}</span>
                <span className="verdict verdict--warn">{fmtClock(al.t)}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="row" style={{ justifyContent: 'center', gap: 12 }}>
        <button type="button" className="btn btn--lg" onClick={() => downloadReport(report)}>
          결과 저장 (.txt)
        </button>
        <button type="button" className="btn btn--primary btn--lg" onClick={onRestart}>
          다시 연습하기
        </button>
      </div>
    </div>
  );
}

function fmtClock(ms: number) {
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** 결과를 텍스트 파일로 내려받는다 (복기용) */
function downloadReport(report: SessionReport) {
  const lines: string[] = [
    `AI 모의 면접 결과`,
    `총점 ${report.total}점 (${report.grade}) · ${fmtDuration(report.durationSec)} · ${report.answers.length}문항`,
    '',
    '── 항목별 평가 ──',
  ];
  for (const m of report.breakdown) {
    lines.push(`\n[${m.label}] ${m.score}점 — ${m.summary}`);
    for (const d of m.details) lines.push(`  · ${d.label}: ${d.value}`);
    for (const t of m.tips) lines.push(`  → ${t}`);
  }
  lines.push('', '── 답변 내용 평가 ──', `${report.content.score}점 — ${report.content.summary}`);
  lines.push('', '── 질문별 기록 ──');
  report.answers.forEach((a, i) => {
    lines.push(`\nQ${i + 1}. ${a.questionText}`);
    if (a.followUpAsked) lines.push(`  ↳ 꼬리 질문: ${a.followUpAsked}`);
    lines.push(`  답변: ${a.transcript || '(인식된 답변 없음)'}`);
    lines.push(
      `  ${Math.round(a.durationSec)}초 · ${a.speech.wordCount}어절 · 연관성 ${a.relevance.score}점`,
    );
    lines.push(`  ${a.relevance.note}`);
  });

  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `모의면접-${stamp}.txt`;
  a.click();
  URL.revokeObjectURL(url);
}

function Timeline({ report }: { report: SessionReport }) {
  const W = 620;
  const H = 150;
  const pad = { l: 26, r: 8, t: 10, b: 20 };
  const points = report.timeline;
  const maxT = Math.max(points[points.length - 1]?.t ?? 1, 1);
  const keys = report.breakdown.map((b) => b.key);

  const x = (t: number) => pad.l + (t / maxT) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - v / 100) * (H - pad.t - pad.b);

  return (
    <svg className="timeline" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img">
      {[0, 50, 100].map((v) => (
        <g key={v}>
          <line
            x1={pad.l}
            y1={y(v)}
            x2={W - pad.r}
            y2={y(v)}
            stroke="var(--border)"
            strokeWidth="1"
            strokeDasharray={v === 50 ? '3 4' : undefined}
          />
          <text x={2} y={y(v) + 4} fontSize="10" fill="var(--text-faint)">
            {v}
          </text>
        </g>
      ))}
      {keys.map((k) => (
        <polyline
          key={k}
          fill="none"
          stroke={LINE_COLOR[k]}
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
          opacity="0.9"
          points={points.map((p) => `${x(p.t)},${y(p.metrics[k])}`).join(' ')}
        />
      ))}
      <text x={pad.l} y={H - 4} fontSize="10" fill="var(--text-faint)">
        시작
      </text>
      <text x={W - pad.r} y={H - 4} fontSize="10" fill="var(--text-faint)" textAnchor="end">
        {Math.round(maxT / 1000)}초
      </text>
    </svg>
  );
}
