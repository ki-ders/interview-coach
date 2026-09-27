import { useState } from 'react';
import { clearHistory, loadHistory, type HistoryEntry } from '../lib/history';
import { METRIC_LABELS } from '../scoring/metrics';
import type { MetricKey } from '../types';

/**
 * 설정 화면 위쪽의 "지난 연습" — 다시 온 사용자가 나아지고 있는지 한눈에 보게 한다.
 * 기록이 없으면 아무것도 그리지 않는다.
 */
export function HistoryCard() {
  const [list, setList] = useState<HistoryEntry[]>(loadHistory);
  if (!list.length) return null;

  const recent = list.slice(-8);
  const last = list[list.length - 1];
  const best = Math.max(...list.map((e) => e.total));

  // 최근 3회 평균이 가장 낮은 항목 = 꾸준히 약한 곳
  const keys: MetricKey[] = ['gaze', 'gesture', 'speech', 'voice', 'calm'];
  const tail = list.slice(-3);
  let weakest: { key: MetricKey; avg: number } | null = null;
  for (const k of keys) {
    const vals = tail.map((e) => e.metrics[k]).filter((v): v is number => typeof v === 'number');
    if (!vals.length) continue;
    const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
    if (!weakest || avg < weakest.avg) weakest = { key: k, avg };
  }

  const W = 220;
  const H = 44;
  const x = (i: number) => (recent.length === 1 ? W / 2 : (i / (recent.length - 1)) * (W - 10) + 5);
  // 데이터 범위로 그려야 몇 점 차이도 보인다
  const lo = Math.min(...recent.map((e) => e.total)) - 6;
  const hi = Math.max(...recent.map((e) => e.total)) + 6;
  const y = (v: number) => H - 5 - ((v - lo) / Math.max(1, hi - lo)) * (H - 10);

  return (
    <section className="card card__pad history">
      <div className="history__row">
        <div style={{ flex: 1, minWidth: 200 }}>
          <div className="switch-row__title">지난 연습 {list.length}회</div>
          <div className="muted tiny" style={{ marginTop: 2 }}>
            마지막 {fmtDate(last.at)} · {last.total}점({last.grade}) · 최고 {best}점
            {weakest && weakest.avg < 75 && (
              <>
                {' '}
                · 최근 계속 약한 항목: <b>{METRIC_LABELS[weakest.key]}</b> 평균 {Math.round(weakest.avg)}점
              </>
            )}
          </div>
        </div>
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`최근 총점 ${recent.map((e) => e.total).join(', ')}`}>
          {80 > lo && 80 < hi && <line x1="0" x2={W} y1={y(80)} y2={y(80)} stroke="var(--border)" strokeDasharray="3 3" />}
          {recent.length > 1 && (
            <path
              d={recent.map((e, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(e.total).toFixed(1)}`).join(' ')}
              fill="none"
              stroke="var(--accent)"
              strokeWidth="2"
              strokeLinejoin="round"
            />
          )}
          {recent.map((e, i) => (
            <circle key={e.at} cx={x(i)} cy={y(e.total)} r={i === recent.length - 1 ? 4 : 2.5} fill="var(--accent)">
              <title>
                {fmtDate(e.at)} {e.total}점
              </title>
            </circle>
          ))}
        </svg>
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          onClick={() => {
            if (!window.confirm('지난 연습 기록을 모두 지울까요?')) return;
            clearHistory();
            setList([]);
          }}
        >
          기록 지우기
        </button>
      </div>
    </section>
  );
}

function fmtDate(iso: string) {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
