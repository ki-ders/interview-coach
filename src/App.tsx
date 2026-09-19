import { useCallback, useEffect, useState, type ComponentType } from 'react';
import type { SessionConfig, SessionReport } from './types';
import { useSession, type SessionState } from './interview/useSession';
import type { SimSetup } from './sim';
import { useTheme } from './hooks/useTheme';
import { SetupScreen } from './components/SetupScreen';
import { InterviewScreen } from './components/InterviewScreen';
import { ReportScreen } from './components/ReportScreen';

const THEME_ICON = { light: '☀', dark: '☾', system: '◐' } as const;
const THEME_LABEL = { light: '라이트', dark: '다크', system: '시스템' } as const;

export default function App({ sim }: { sim?: SimSetup }) {
  const { mode, cycle } = useTheme();
  const { state, videoRef, prepare, runCalibration, start, abort, reset, onGuideMeasured } = useSession(sim?.deps);
  const [config, setConfig] = useState<SessionConfig | null>(null);
  const [showDebug, setShowDebug] = useState(
    () => new URLSearchParams(location.search).get('debug') === '1',
  );
  // 카메라 없이 화면을 확인하기 위한 미리보기 (?preview=report | interview)
  const preview = new URLSearchParams(location.search).get('preview');
  const [sampleReport, setSampleReport] = useState<SessionReport | null>(null);
  const [previewState, setPreviewState] = useState<SessionState | null>(null);
  const [FacePreviewComp, setFacePreviewComp] = useState<ComponentType | null>(null);
  useEffect(() => {
    if (preview === 'report') {
      void import('./dev/sampleReport').then((m) => setSampleReport(m.makeSampleReport()));
    } else if (preview === 'interview') {
      void import('./dev/previewState').then((m) => setPreviewState(m.makePreviewState()));
    } else if (preview === 'face') {
      void import('./dev/FacePreview').then((m) => setFacePreviewComp(() => m.FacePreview));
    }
  }, [preview]);

  // Shift + D 로 진단 정보 토글
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.shiftKey && (e.key === 'D' || e.key === 'd') && !isTyping(e.target)) {
        setShowDebug((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const beginSession = useCallback(
    async (cfg: SessionConfig) => {
      setConfig(cfg);
      const ok = await prepare(cfg);
      if (ok) await runCalibration();
    },
    [prepare, runCalibration],
  );

  const backToSetup = useCallback(() => {
    reset();
    setConfig(null);
  }, [reset]);

  const retry = useCallback(() => {
    if (config) void beginSession(config);
  }, [beginSession, config]);

  const inInterview =
    config !== null &&
    (state.phase === 'loading' ||
      state.phase === 'calibrating' ||
      state.phase === 'ready' ||
      state.phase === 'running');

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar__brand">
          면접 코치<span>AI Interview Coach</span>
        </div>
        <div className="topbar__spacer" />
        {state.phase === 'report' && (
          <button type="button" className="btn btn--ghost" onClick={backToSetup}>
            새 면접 설정
          </button>
        )}
        <button
          type="button"
          className="btn btn--ghost"
          onClick={cycle}
          title={`테마: ${THEME_LABEL[mode]}`}
          aria-label={`테마 변경 (현재 ${THEME_LABEL[mode]})`}
        >
          <span aria-hidden style={{ fontSize: 16 }}>
            {THEME_ICON[mode]}
          </span>
          {THEME_LABEL[mode]}
        </button>
      </header>

      {FacePreviewComp && <FacePreviewComp />}

      {sim && (
        <sim.Driver
          state={state}
          world={sim.world}
          scenario={sim.scenario}
          log={sim.log}
          bus={sim.bus}
          onBegin={beginSession}
          onStart={start}
        />
      )}

      {previewState && (
        <InterviewScreen
          state={previewState}
          videoRef={videoRef}
          interviewerIds={['seo', 'kang']}
          onBeginCalibration={() => undefined}
          onStart={() => undefined}
          onAbort={() => setPreviewState(null)}
          onReset={() => setPreviewState(null)}
          showDebug
        />
      )}

      {sampleReport ? (
        <ReportScreen report={sampleReport} onRestart={() => setSampleReport(null)} />
      ) : (
        state.phase === 'idle' && !previewState && !FacePreviewComp && <SetupScreen onStart={beginSession} />
      )}

      {inInterview && config && (
        <InterviewScreen
          state={state}
          videoRef={videoRef}
          interviewerIds={config.interviewerIds}
          onBeginCalibration={() => void runCalibration()}
          onStart={() => void start()}
          onAbort={abort}
          onReset={backToSetup}
          showDebug={showDebug}
          onGuideMeasured={onGuideMeasured}
          guideMode={config?.gazeGuide ?? 'lens'}
        />
      )}

      {state.phase === 'report' && state.report && (
        <ReportScreen report={state.report} onRestart={backToSetup} summaryPending={state.llmSummaryPending} video={state.video} />
      )}

      {state.phase === 'error' && (
        <div className="page">
          <div className="card card__pad center-col">
            <h2>시작하지 못했습니다</h2>
            <p className="muted" style={{ maxWidth: 460 }}>
              {state.error}
            </p>
            <div className="row">
              <button type="button" className="btn" onClick={backToSetup}>
                설정으로
              </button>
              <button type="button" className="btn btn--primary" onClick={retry} disabled={!config}>
                다시 시도
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function isTyping(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
}
