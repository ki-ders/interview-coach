import { beforeEach, describe, expect, it } from 'vitest';
import { addHistory, compareWithLast, loadHistory, type HistoryEntry } from './history';

const entry = (total: number, audioOnly = false, questions = 3): HistoryEntry => ({
  at: new Date().toISOString(),
  total,
  grade: 'B',
  questions,
  audioOnly,
  disqualified: false,
  metrics: { speech: total },
  content: 70,
});

describe('연습 기록', () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    globalThis.localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
      key: () => null,
      length: 0,
    } as Storage;
  });

  it('더하기 전의 목록을 돌려주고 저장한다', () => {
    expect(addHistory(entry(70))).toEqual([]);
    expect(addHistory(entry(78)).map((e) => e.total)).toEqual([70]);
    expect(loadHistory().map((e) => e.total)).toEqual([70, 78]);
  });

  it('답변이 없는 면접은 기록하지 않는다', () => {
    addHistory(entry(50, false, 0));
    expect(loadHistory()).toEqual([]);
  });

  it('같은 방식(음성 전용 여부)끼리만 비교한다', () => {
    const before = [entry(60), entry(90, true)];
    expect(compareWithLast(entry(72), before)).toMatchObject({ delta: 12 });
    expect(compareWithLast(entry(80, true), before)).toMatchObject({ delta: -10 });
    expect(compareWithLast(entry(80), [])).toBeNull();
  });
});
