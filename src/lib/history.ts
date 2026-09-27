/**
 * 지난 연습 기록. 리포트의 요약만 이 브라우저(localStorage)에 남겨 두고,
 * 다음 연습에서 "지난번보다 몇 점" 과 설정 화면의 추이를 보여준다.
 */
import type { MetricKey, SessionReport } from '../types';

const KEY = 'interview-coach:history';
const MAX = 30;

export interface HistoryEntry {
  /** ISO 시각 */
  at: string;
  total: number;
  grade: string;
  questions: number;
  audioOnly: boolean;
  disqualified: boolean;
  metrics: Partial<Record<MetricKey, number>>;
  content: number;
}

export function loadHistory(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as HistoryEntry[]) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function toEntry(report: SessionReport, at = new Date()): HistoryEntry {
  const metrics: Partial<Record<MetricKey, number>> = {};
  for (const b of report.breakdown) metrics[b.key] = b.score;
  return {
    at: at.toISOString(),
    total: report.total,
    grade: report.grade,
    questions: report.answers.length,
    audioOnly: report.audioOnly === true,
    disqualified: report.blind?.disqualified === true,
    metrics,
    content: report.content.score,
  };
}

/** 기록을 더하고, 더하기 전의 목록(= 이번 것과 비교할 지난 기록)을 돌려준다 */
export function addHistory(entry: HistoryEntry): HistoryEntry[] {
  const before = loadHistory();
  // 답변이 하나도 없는 면접(바로 중단)은 기록하지 않는다
  if (entry.questions === 0) return before;
  try {
    localStorage.setItem(KEY, JSON.stringify([...before, entry].slice(-MAX)));
  } catch {
    /* 저장 공간 없음 등은 무시 */
  }
  return before;
}

export function clearHistory() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* noop */
  }
}

/**
 * 이번 결과를 지난번과 비교한 문장. 같은 방식(음성 전용 여부)끼리만 비교한다 —
 * 영상 항목이 빠진 총점과 비교하면 의미가 없다.
 */
export function compareWithLast(current: HistoryEntry, before: HistoryEntry[]): { delta: number; text: string } | null {
  const last = [...before].reverse().find((e) => e.audioOnly === current.audioOnly);
  if (!last) return null;
  const delta = current.total - last.total;
  const text =
    delta > 0 ? `지난번보다 ${delta}점 올랐습니다` : delta < 0 ? `지난번보다 ${-delta}점 내려갔습니다` : '지난번과 같은 점수입니다';
  return { delta, text };
}
