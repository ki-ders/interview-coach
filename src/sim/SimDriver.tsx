import { useEffect, useRef, useState } from 'react';
import type { SessionConfig } from '../types';
import type { SessionState } from '../interview/useSession';
import type { Scenario } from './scenarios';
import { SCENARIOS } from './scenarios';
import type { SimWorld } from './world';

interface Props {
  state: SessionState;
  world: SimWorld;
  scenario: Scenario;
  log: string[];
  /** log 에 줄이 추가될 때 'log' 이벤트를 낸다 */
  bus: EventTarget;
  onBegin: (config: SessionConfig) => void;
  onStart: () => void;
}

/**
 * 시뮬레이션 조종석. 세션 상태를 보고 가상 지원자의 행동을 바꾸고,
 * 보정이 끝나면 자동으로 면접을 시작한다. 화면 왼쪽 아래에 떠 있다.
 */
export function SimDriver({ state, world, scenario, log, bus, onBegin, onStart }: Props) {
  const [auto, setAuto] = useState(true);
  const [open, setOpen] = useState(true);
  const [, setTick] = useState(0);
  const startedRef = useRef(false);

  // 로그가 늘거나 시간이 흐르면 다시 그린다 (world 는 React 바깥의 객체)
  useEffect(() => {
    const bump = () => setTick((t) => t + 1);
    bus.addEventListener('log', bump);
    const timer = window.setInterval(bump, 500);
    return () => {
      bus.removeEventListener('log', bump);
      window.clearInterval(timer);
    };
  }, [bus]);

  // 보정 단계: 시키는 곳을 본다. 면접 중: 질문별 행동.
  useEffect(() => {
    world.follow(state.phase, state.calibStep, state.questionIndex, scenario.behaviors);
  }, [state.phase, state.calibStep, state.questionIndex, world, scenario]);

  // 콜백은 매 렌더마다 새 함수일 수 있으므로 ref 로 최신 것을 들고 있는다
  const onStartRef = useRef(onStart);
  useEffect(() => {
    onStartRef.current = onStart;
  }, [onStart]);

  useEffect(() => {
    if (state.phase === 'ready' && auto && !startedRef.current) {
      startedRef.current = true;
      // 오버레이가 그려진 뒤 시작
      const t = window.setTimeout(() => onStartRef.current(), 400);
      return () => window.clearTimeout(t);
    }
    if (state.phase === 'idle') startedRef.current = false;
    return undefined;
  }, [state.phase, auto]);

  // 결과는 검사 스크립트가 읽을 수 있게 노출한다
  useEffect(() => {
    (window as unknown as { __simReport?: unknown }).__simReport = state.report;
    (window as unknown as { __simState?: unknown }).__simState = state;
  }, [state]);

  const switchScenario = (id: string) => {
    const url = new URL(location.href);
    url.searchParams.set('sim', id);
    location.href = url.toString();
  };

  return (
    <div className={`sim${open ? '' : ' sim--min'}`}>
      <div className="sim__head">
        <strong>SIM</strong>
        <span className="sim__phase">{state.phase}</span>
        <button type="button" className="sim__btn" onClick={() => setOpen((v) => !v)}>
          {open ? '−' : '+'}
        </button>
      </div>
      {open && (
        <div className="sim__body">
          <div className="sim__row">
            <select className="sim__select" value={scenario.id} onChange={(e) => switchScenario(e.target.value)}>
              {SCENARIOS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <div className="sim__desc">{scenario.description}</div>
          <div className="sim__row">
            <button
              type="button"
              className="sim__btn sim__btn--primary"
              disabled={state.phase !== 'idle'}
              onClick={() => onBegin(scenario.config)}
            >
              시나리오 시작
            </button>
            <label className="sim__check">
              <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> 보정 후 자동 시작
            </label>
          </div>
          <div className="sim__now">
            지원자: <b>{world.describe()}</b>
            {world.speaking ? ' · 말하는 중' : ''}
          </div>
          <div className="sim__log">
            {log.slice(-6).map((line, i) => (
              <div key={i}>{line}</div>
            ))}
          </div>
          <details className="sim__expect">
            <summary>확인할 것 {scenario.expectations.length}개</summary>
            <ul>
              {scenario.expectations.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          </details>
        </div>
      )}
    </div>
  );
}
