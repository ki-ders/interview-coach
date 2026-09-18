import { useState } from 'react';
import type { MetricKey, SessionReport } from '../types';
import { METRIC_LABELS } from '../scoring/metrics';
import { recordingExtension } from '../lib/recorder';

export interface ReportVideo {
  url: string;
  mimeType: string;
  sizeBytes: number;
  durationMs: number;
}

interface Props {
  report: SessionReport;
  onRestart: () => void;
  /** LLM 총평이 아직 오는 중 */
  summaryPending?: boolean;
  /** 녹화된 면접 영상 */
  video?: ReportVideo | null;
}

const GRADES = ['S', 'A', 'B', 'C', 'D', 'F'];

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

export function ReportScreen({ report, onRestart, summaryPending, video }: Props) {
  const ai = report.content.llm;
  const disqualified = report.blind?.disqualified === true;
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
              <div className={`score-ring__grade${disqualified ? ' score-ring__grade--dq' : ''}`}>{report.grade}</div>
            </div>
          </div>
          <div style={{ flex: 1, minWidth: 260 }}>
            <h1 style={{ fontSize: 22, marginBottom: 6 }}>모의 면접 결과</h1>
            <p className="muted" style={{ margin: '0 0 12px' }}>
              {fmtDuration(report.durationSec)} 동안 {report.answers.length}개 문항에 답했습니다.
              {disqualified && ' 블라인드 규정 위반으로 부적격 처리되었습니다.'}
            </p>
            <div className="grade-scale" aria-label="등급 척도">
              {GRADES.map((g) => (
                <span key={g} className={!disqualified && report.grade === g ? 'on' : ''}>
                  {g}
                </span>
              ))}
            </div>
            <div className="tiny faint" style={{ marginTop: 4 }}>
              S 90점 이상 · A 80 · B 70 · C 60 · D 50 · F 그 미만
            </div>
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

      {report.blind && (
        <section className={report.blind.disqualified ? 'blind-box' : 'card card__pad'}>
          <h3 style={{ fontSize: 15, marginBottom: 8 }}>
            {report.blind.disqualified ? '블라인드 면접 규정 위반 — 부적격' : '블라인드 면접 규정 준수'}
          </h3>
          {report.blind.disqualified ? (
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {report.blind.violations.map((v, i) => (
                <li key={i}>
                  <span className="blind-box__cat">{v.label}</span>
                  <span className="blind-box__quote">Q{v.questionIndex + 1} "{v.excerpt}"</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted tiny" style={{ margin: 0 }}>
              성명·출신 학교·가족·수상 실적·수험번호를 한 번도 말하지 않았습니다.
            </p>
          )}
        </section>
      )}

      {video && <VideoBox video={video} />}

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
        {(ai || summaryPending) && (
          <div className="ai-summary">
            <div className="tiny faint" style={{ marginBottom: 6 }}>
              면접관 AI 총평
            </div>
            {ai ? (
              <>
                <p style={{ margin: '0 0 8px', lineHeight: 1.6 }}>{ai.summary}</p>
                {ai.strengths.length > 0 && (
                  <div className="ai-summary__list">
                    <strong>잘한 점</strong>
                    <ul>
                      {ai.strengths.map((s) => (
                        <li key={s}>{s}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {ai.improvements.length > 0 && (
                  <div className="ai-summary__list">
                    <strong>다음까지 고칠 점</strong>
                    <ul>
                      {ai.improvements.map((s) => (
                        <li key={s}>{s}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            ) : (
              <span className="muted tiny">총평을 쓰는 중…</span>
            )}
          </div>
        )}
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

/** 녹화 영상: 다시 보기 · 저장 · (지원하면) 공유 */
function VideoBox({ video }: { video: ReportVideo }) {
  const [shared, setShared] = useState<string | null>(null);
  const ext = recordingExtension(video.mimeType);
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  const filename = `모의면접-${stamp}.${ext}`;
  const mb = (video.sizeBytes / 1024 / 1024).toFixed(1);
  const canShare = typeof navigator !== 'undefined' && typeof navigator.canShare === 'function';

  const share = async () => {
    try {
      const blob = await fetch(video.url).then((r) => r.blob());
      const file = new File([blob], filename, { type: video.mimeType });
      if (!navigator.canShare?.({ files: [file] })) {
        setShared('이 브라우저는 파일 공유를 지원하지 않습니다. 저장 버튼을 쓰세요.');
        return;
      }
      await navigator.share({ files: [file], title: '모의 면접 영상' });
      setShared(null);
    } catch (err) {
      if ((err as Error)?.name !== 'AbortError') setShared('공유하지 못했습니다. 저장 버튼을 쓰세요.');
    }
  };

  return (
    <section className="card card__pad video-box">
      <div className="section-title">
        <h2>면접 영상</h2>
        <span className="chip">
          {fmtClock(video.durationMs)} · {mb}MB
        </span>
      </div>
      <video src={video.url} controls playsInline preload="metadata" />
      <div className="row" style={{ marginTop: 12, justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <span className="tiny faint">영상은 이 기기에만 있습니다. 화면을 떠나면 사라지니 필요하면 지금 저장하세요.</span>
        <div className="row" style={{ gap: 8 }}>
          {canShare && (
            <button type="button" className="btn btn--ghost" onClick={() => void share()}>
              공유 / 사진에 저장
            </button>
          )}
          <a className="btn btn--primary" href={video.url} download={filename}>
            영상 저장 (.{ext})
          </a>
        </div>
      </div>
      {shared && (
        <div className="tiny" style={{ marginTop: 8, color: 'var(--warn)' }}>
          {shared}
        </div>
      )}
    </section>
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
  if (report.blind?.disqualified) {
    lines.splice(2, 0, '', '── 블라인드 규정 위반 (부적격) ──');
    report.blind.violations.forEach((v) => lines.splice(3, 0, `  · ${v.label}: Q${v.questionIndex + 1} "${v.excerpt}"`));
  }
  for (const m of report.breakdown) {
    lines.push(`\n[${m.label}] ${m.score}점 — ${m.summary}`);
    for (const d of m.details) lines.push(`  · ${d.label}: ${d.value}`);
    for (const t of m.tips) lines.push(`  → ${t}`);
  }
  lines.push('', '── 답변 내용 평가 ──', `${report.content.score}점 — ${report.content.summary}`);
  if (report.content.llm) {
    lines.push('', '[면접관 AI 총평]', report.content.llm.summary);
    for (const s of report.content.llm.strengths) lines.push(`  + ${s}`);
    for (const s of report.content.llm.improvements) lines.push(`  - ${s}`);
  }
  lines.push('', '── 질문별 기록 ──');
  report.answers.forEach((a, i) => {
    lines.push(`\nQ${i + 1}. ${a.questionText}`);
    if (a.reasked) lines.push('  ↳ 잘 못 알아들어 다시 물었음');
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
