import type { RefObject } from 'react';
import type { MetricKey } from '../types';
import { getInterviewer } from '../data/interviewers';
import { METRIC_LABELS } from '../scoring/metrics';
import type { SessionState } from '../interview/useSession';
import { InterviewRoom } from './InterviewRoom';

interface Props {
  state: SessionState;
  videoRef: RefObject<HTMLVideoElement | null>;
  interviewerIds: [string, string];
  onBeginCalibration: () => void;
  onStart: () => void;
  onAbort: () => void;
  onReset: () => void;
  showDebug: boolean;
}

const ORDER: MetricKey[] = ['gaze', 'gesture', 'speech', 'voice', 'calm'];

const CALIB_COPY: Record<string, { title: string; body: string }> = {
  noise: {
    title: '주변 소음을 측정합니다',
    body: '3초 동안 아무 말도 하지 말고 조용히 계세요. 이 값을 기준으로 목소리 크기를 판단합니다.',
  },
  center: {
    title: '카메라 렌즈를 바라보세요',
    body: '화면이 아니라 카메라 렌즈를 3초간 응시해 주세요. 정면 기준을 잡습니다.',
  },
  side: {
    title: '화면 왼쪽 끝을 보세요',
    body: '고개를 크게 돌리지 말고 시선만 왼쪽 끝 표시로 옮겨 주세요.',
  },
  down: {
    title: '책상(화면 아래쪽)을 보세요',
    body: '아래쪽 표시를 2초간 봐 주세요. 시선이 내려갔는지 판단하는 기준이 됩니다.',
  },
};

function color(score: number) {
  if (score >= 75) return 'var(--good)';
  if (score >= 50) return 'var(--warn)';
  return 'var(--bad)';
}

function fmt(sec: number) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function InterviewScreen({
  state,
  videoRef,
  interviewerIds,
  onBeginCalibration,
  onStart,
  onAbort,
  onReset,
  showDebug,
}: Props) {
  const [a, b] = interviewerIds.map(getInterviewer);
  const running = state.phase === 'running';
  const speakerId = state.subtitle?.speakerId;

  const selfView = (
    <div className="selfview">
      <video ref={videoRef} playsInline muted autoPlay />
      <div className="selfview__badge">
        <i className="dot" /> 분석 중
      </div>
      {!state.faceVisible && state.phase !== 'loading' && (
        <div className="selfview__warn">얼굴이 화면에서 벗어났습니다</div>
      )}
    </div>
  );

  return (
    <div className="page page--wide stack">
      {state.notice && <div className="banner banner--warn">{state.notice}</div>}

      <div className="stage">
        <div className="stack" style={{ gap: 14 }}>
          <div className="room">
            <div className="room__panel" />
            <div className="room__progress">
              <span className="chip">
                {running ? `질문 ${state.questionIndex + 1} / ${state.totalQuestions}` : '대기 중'}
              </span>
            </div>
            <div className="room__timer">{fmt(state.elapsedSec)}</div>

            <InterviewRoom pair={[a, b]} states={state.avatars} speakingId={speakerId} />

            {state.subtitle ? (
              <div
                className={`subtitle${state.subtitle.isQuestion ? ' subtitle--question' : ''}`}
              >
                <span className="subtitle__who">
                  {getInterviewer(state.subtitle.speakerId).name} 교수
                </span>
                <span className="subtitle__text">{state.subtitle.text}</span>
              </div>
            ) : (
              <div className="subtitle subtitle--listening">
                <span className="subtitle__text">
                  {running ? '답변해 주세요 — 말을 멈추면 다음으로 넘어갑니다' : '준비되면 시작하세요'}
                </span>
              </div>
            )}
          </div>

          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span className="tiny faint">
              {running
                ? '면접관이 듣고 있습니다. 카메라 렌즈를 보며 말해 보세요.'
                : '카메라는 이 기기 밖으로 나가지 않습니다.'}
            </span>
            {running ? (
              <button type="button" className="btn btn--danger" onClick={onAbort}>
                면접 중단하고 결과 보기
              </button>
            ) : (
              <button type="button" className="btn btn--ghost" onClick={onReset}>
                설정으로 돌아가기
              </button>
            )}
          </div>
        </div>

        <aside className="stack" style={{ gap: 14 }}>
          {selfView}

          <div className="card card__pad">
            <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
              <strong style={{ fontSize: 14 }}>실시간 분석</strong>
              <span className="tiny faint">최근 12초</span>
            </div>
            <div className="hud">
              {ORDER.map((k) => (
                <Gauge key={k} label={METRIC_LABELS[k]} value={state.live[k]} />
              ))}
            </div>
            <div style={{ marginTop: 14 }}>
              <div className="tiny faint" style={{ marginBottom: 5 }}>
                마이크 입력
              </div>
              <div className="mic-meter">
                <div className="mic-meter__fill" style={{ width: `${state.micLevel * 100}%` }} />
              </div>
            </div>
          </div>

          {state.alerts.length > 0 && (
            <div className="alerts">
              {state.alerts.slice(-2).map((al) => (
                <div className="alert" key={al.id}>
                  <span aria-hidden>⚠</span>
                  <span>{al.text}</span>
                </div>
              ))}
            </div>
          )}

          {(state.transcript || state.interim) && (
            <div className="card card__pad">
              <div className="tiny faint" style={{ marginBottom: 6 }}>
                받아쓰기
              </div>
              <div className="transcript">
                {state.transcript}
                {state.interim && <span className="transcript__interim"> {state.interim}</span>}
              </div>
            </div>
          )}

          {showDebug && state.debug && (
            <div className="card card__pad debug">
              fps {state.debug.fps.toFixed(0)} · 시선 x {state.debug.gazeX.toFixed(2)} / 아래{' '}
              {state.debug.gazeDown.toFixed(2)}
              <br />
              어깨 기울기 {state.debug.shoulderTilt.toFixed(1)}° · 목 비율{' '}
              {state.debug.neckRatio.toFixed(2)}
              <br />
              다리 {state.debug.legSource} {state.debug.legFreq.toFixed(1)}Hz 강도{' '}
              {state.debug.legStrength.toFixed(2)}
            </div>
          )}
        </aside>
      </div>

      {state.phase === 'loading' && (
        <Overlay>
          <div className="spinner" />
          <h2>{state.loadingMessage || '준비 중…'}</h2>
          <p className="muted tiny" style={{ maxWidth: 400 }}>
            처음 실행할 때는 분석 모델(약 20MB)을 불러오느라 몇 초 걸릴 수 있습니다.
          </p>
        </Overlay>
      )}

      {state.phase === 'calibrating' && (
        <Overlay>
          <CalibTarget step={state.calibStep} />
          <div className="calib__steps">
            {['noise', 'center', 'side', 'down'].map((s, i) => (
              <span
                key={s}
                className={`calib__step${
                  ['noise', 'center', 'side', 'down'].indexOf(state.calibStep) >= i
                    ? ' calib__step--on'
                    : ''
                }`}
              />
            ))}
          </div>
          <div className="calib__ring">{state.calibCountdown}</div>
          <h2>{CALIB_COPY[state.calibStep]?.title ?? '보정 중'}</h2>
          <p className="muted" style={{ maxWidth: 420 }}>
            {CALIB_COPY[state.calibStep]?.body ?? ''}
          </p>
        </Overlay>
      )}

      {state.phase === 'ready' && (
        <Overlay>
          <h2>준비가 끝났습니다</h2>
          <ul
            className="muted"
            style={{ textAlign: 'left', maxWidth: 440, lineHeight: 1.9, paddingLeft: 20 }}
          >
            <li>상체가 화면에 다 들어오게 앉으세요 (다리까지 보이면 떨림 감지가 더 정확합니다).</li>
            <li>면접관이 질문을 마치면 바로 답변하세요.</li>
            <li>말을 멈추면 {'약 2~3초'} 뒤 다음 질문으로 넘어갑니다.</li>
            <li>스피커 대신 이어폰을 쓰면 음성 인식 정확도가 올라갑니다.</li>
          </ul>
          <div className="row">
            <button type="button" className="btn btn--ghost" onClick={onBeginCalibration}>
              보정 다시 하기
            </button>
            <button type="button" className="btn btn--primary btn--lg" onClick={onStart}>
              면접 시작
            </button>
          </div>
        </Overlay>
      )}
    </div>
  );
}

function Gauge({ label, value }: { label: string; value: number }) {
  return (
    <div className="gauge">
      <span className="gauge__label">{label}</span>
      <div className="gauge__track">
        <div
          className="gauge__fill"
          style={{ width: `${Math.max(value, 3)}%`, background: color(value) }}
        />
      </div>
      <span className="gauge__val">{value}</span>
    </div>
  );
}

function Overlay({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 40,
        background: 'color-mix(in srgb, var(--bg) 92%, transparent)',
        backdropFilter: 'blur(6px)',
        display: 'grid',
        placeItems: 'center',
        padding: 24,
      }}
    >
      <div className="calib">{children}</div>
    </div>
  );
}

/** 보정 단계마다 응시할 지점을 화면에 표시한다 */
function CalibTarget({ step }: { step: string }) {
  if (step === 'noise' || step === 'done') return null;
  const pos =
    step === 'center'
      ? { top: 8, left: '50%', transform: 'translateX(-50%)' }
      : step === 'side'
        ? { top: '50%', left: 10, transform: 'translateY(-50%)' }
        : { bottom: 10, left: '50%', transform: 'translateX(-50%)' };
  return <div className="calib__target" style={{ position: 'fixed', ...pos }} />;
}
