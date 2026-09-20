import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  AnswerRecord,
  BlindViolation,
  MannerHit,
  Interviewer,
  LiveAlert,
  LiveMetrics,
  MetricKey,
  SessionConfig,
  SessionReport,
} from '../types';
import { getInterviewer } from '../data/interviewers';
import { loadLandmarkers, type Landmarkers } from '../vision/landmarkers';
import { CalibrationCollector, DEFAULT_CALIBRATION, VisionAnalyzer, type VisionDebug } from '../vision/analyzer';
import { MicAnalyzer } from '../audio/micAnalyzer';
import { createStt } from '../audio/createStt';
import type { SttEngine } from '../audio/stt';
import { Tts } from '../audio/tts';
import {
  buildBreakdown,
  computeMetrics,
  derive,
  emptyStats,
  emptyText,
  feed,
  sealStats,
  textStatsOf,
  type RawStats,
  type Sample,
} from '../scoring/metrics';
import { analyzeRelevance, analyzeSpeech } from '../scoring/korean';
import { ackOf, closingOf, decideFollowUp, greetingOf, silenceNudgeOf, summarizeContent } from './brain';
import { decideTurnPolicy } from './turn';
import { BLIND_LABEL, BLIND_RULE_LINE, blindWarningLine, detectBlindViolations, detectWatchlist } from './blind';
import { detectManner, mannerRemarkLine } from './manner';
import { judgeIntelligibility, reaskLineOf } from './clarity';
import { SessionRecorder, type Recording } from '../lib/recorder';
import { AnswerRecorder, type AnswerAudio } from '../audio/answerRecorder';
import { createInterviewerLlm, type InterviewerLlm } from './llm';
import { clamp, gradeOf, weighted } from '../lib/signal';
import { startTicker } from '../lib/ticker';

export type Phase = 'idle' | 'loading' | 'calibrating' | 'ready' | 'running' | 'report' | 'error';

export type AvatarState = 'idle' | 'speaking' | 'listening' | 'writing' | 'nodding';

export type CalibStep = 'noise' | 'left' | 'right' | 'lens' | 'down' | 'done';

export interface Subtitle {
  speakerId: string;
  text: string;
  isQuestion: boolean;
}

const WINDOW_MS = 12000;
const ALERT_COOLDOWN_MS = 14000;

const ALERT_TEXT: Record<MetricKey, string> = {
  gaze: '시선이 자꾸 다른 곳을 향합니다. 카메라를 보세요.',
  gesture: '자세가 흐트러졌습니다. 어깨를 펴고 앉아 보세요.',
  speech: '말이 자주 끊깁니다. 천천히 문장을 이어가 보세요.',
  voice: '목소리가 작습니다. 조금 더 크게 말해 주세요.',
  calm: '다리 떨림이 감지됐습니다. 두 발을 바닥에 붙여 보세요.',
};

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** 값이 생길 때까지 짧게 기다린다 (렌더 타이밍 경합 방지) */
async function waitFor<T>(get: () => T | null, timeoutMs: number): Promise<T | null> {
  const until = performance.now() + timeoutMs;
  for (;;) {
    const v = get();
    if (v) return v;
    if (performance.now() > until) return null;
    await sleep(30);
  }
}

export interface SessionState {
  phase: Phase;
  loadingMessage: string;
  error: string | null;
  calibStep: CalibStep;
  calibCountdown: number;
  live: LiveMetrics;
  micLevel: number;
  alerts: LiveAlert[];
  subtitle: Subtitle | null;
  avatars: Record<string, AvatarState>;
  transcript: string;
  interim: string;
  questionIndex: number;
  totalQuestions: number;
  elapsedSec: number;
  report: SessionReport | null;
  debug: VisionDebug | null;
  sttSupported: boolean;
  notice: string | null;
  faceVisible: boolean;
  /** 최근 0.6초 동안 카메라(정면)를 보고 있었는지. 얼굴이 없으면 null */
  gazeOnTarget: boolean | null;
  /** 답변 종료 판단 상태 ("말이 이어질 것 같아 기다리는 중" 등). 듣는 중이 아니면 null */
  turnHint: string | null;
  /** 리포트가 뜬 뒤 LLM 총평을 기다리는 중 */
  llmSummaryPending: boolean;
  /** 시선 안내 모드에서 지금 바라볼 곳: 렌즈 또는 면접관 id. 고정 모드면 null (렌즈 표시만) */
  gazeGuideTarget: 'lens' | string | null;
  /** 블라인드 면접 규정 위반 (면접 중 누적) */
  blindViolations: BlindViolation[];
  /** 반말·비속어 (면접 중 누적) */
  mannerHits: MannerHit[];
  /** 녹화된 면접 영상 (리포트 단계) */
  video: { url: string; mimeType: string; sizeBytes: number; durationMs: number } | null;
}

const INITIAL_LIVE: LiveMetrics = { gaze: 70, gesture: 70, speech: 70, voice: 70, calm: 70 };

/**
 * 세션이 바깥 세상과 닿는 지점. 기본값은 실제 카메라·마이크·MediaPipe·Web Speech 이고,
 * 시뮬레이션 모드(?sim=1)는 합성 영상·음성·인식기를 꽂아 카메라 없이 전체 흐름을 돌린다.
 */
export interface SessionDeps {
  getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream>;
  loadLandmarkers(onProgress?: (msg: string) => void): Promise<Landmarkers>;
  createStt(): SttEngine;
  createTts(): Tts;
  createLlm(config: SessionConfig): Promise<InterviewerLlm | null>;
}

export const defaultDeps: SessionDeps = {
  getUserMedia: (c) => navigator.mediaDevices.getUserMedia(c),
  loadLandmarkers,
  createStt,
  createTts: () => new Tts(),
  createLlm: (cfg) => createInterviewerLlm(cfg.llmProvider, cfg.apiKey),
};

const initialState = (): SessionState => ({
  phase: 'idle',
  loadingMessage: '',
  error: null,
  calibStep: 'noise',
  calibCountdown: 0,
  live: INITIAL_LIVE,
  micLevel: 0,
  alerts: [],
  subtitle: null,
  avatars: {},
  transcript: '',
  interim: '',
  questionIndex: 0,
  totalQuestions: 0,
  elapsedSec: 0,
  report: null,
  debug: null,
  sttSupported: true,
  notice: null,
  faceVisible: true,
  gazeOnTarget: null,
  turnHint: null,
  llmSummaryPending: false,
  gazeGuideTarget: null,
  blindViolations: [],
  mannerHits: [],
  video: null,
});

export function useSession(deps: SessionDeps = defaultDeps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [state, setState] = useState<SessionState>(initialState);
  // 첫 렌더에 한 번만 만든다
  const [stt] = useState(() => deps.createStt());
  const [tts] = useState(() => deps.createTts());

  const mountedRef = useRef(true);
  const patch = useCallback((p: Partial<SessionState>) => {
    if (!mountedRef.current) return;
    setState((s) => ({ ...s, ...p }));
  }, []);

  /* ── 장기 보존 참조 ────────────────────────────────────────── */
  const streamRef = useRef<MediaStream | null>(null);
  const marksRef = useRef<Landmarkers | null>(null);
  const visionRef = useRef(new VisionAnalyzer());
  const micRef = useRef(new MicAnalyzer());
  const sttRef = useRef(stt);
  const ttsRef = useRef(tts);
  const stopTickerRef = useRef<(() => void) | null>(null);
  const abortRef = useRef(false);
  const configRef = useRef<SessionConfig | null>(null);
  const llmRef = useRef<InterviewerLlm | null>(null);

  const startedAtRef = useRef(0);
  const lastFrameRef = useRef(0);
  const lastVideoTimeRef = useRef(-1);
  const sessionStatsRef = useRef<RawStats>(emptyStats());
  const answerStatsRef = useRef<RawStats | null>(null);
  const windowRef = useRef<Sample[]>([]);
  const timelineRef = useRef<{ t: number; metrics: LiveMetrics }[]>([]);
  const alertsRef = useRef<LiveAlert[]>([]);
  const lastAlertAtRef = useRef<Record<MetricKey, number>>({
    gaze: 0,
    gesture: 0,
    speech: 0,
    voice: 0,
    calm: 0,
  });
  const alertSeq = useRef(0);
  const lastTickRef = useRef(0);

  const answeringRef = useRef(false);
  /** 지금 답변 턴이 시작된 시각 — 답변 초반의 실시간 창은 직전 턴의 침묵이 섞여 있어 경고에 쓰지 않는다 */
  const answerStartedAtRef = useRef(0);
  const lastUserVoiceRef = useRef(0);
  /** 인식기가 마지막으로 텍스트를 바꾼 시각 */
  const lastSttUpdateRef = useRef(0);
  const heardSpeechRef = useRef(false);
  const heardAtRef = useRef(0);
  const speechRunStartRef = useRef(0);
  const ttsEndedAtRef = useRef(0);

  const calibRef = useRef({ collector: new CalibrationCollector(), active: false });
  const answersRef = useRef<AnswerRecord[]>([]);
  const speakHandleRef = useRef<{ cancel(): void } | null>(null);
  const blindRef = useRef<BlindViolation[]>([]);
  const mannerRef = useRef<MannerHit[]>([]);
  /** 스피커 소리가 마이크로 되돌아온 횟수 — 이어폰 권유 판단 */
  const echoNoticedRef = useRef(false);
  const recorderRef = useRef(new SessionRecorder());
  const answerRecRef = useRef(new AnswerRecorder());
  const videoUrlRef = useRef<string | null>(null);

  const releaseMedia = useCallback(() => {
    stopTickerRef.current?.();
    stopTickerRef.current = null;
    micRef.current.detach();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const teardown = useCallback(() => {
    abortRef.current = true;
    speakHandleRef.current?.cancel();
    ttsRef.current.stop();
    sttRef.current.dispose();
    releaseMedia();
    marksRef.current = null;
  }, [releaseMedia]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      teardown();
    };
  }, [teardown]);

  /* ── 측정 루프 ─────────────────────────────────────────────── */
  const updateLive = useCallback((win: Sample[], t: number, micLevel: number) => {
    const windowStats = emptyStats();
    let prev = win.length ? win[0].t : 0;
    for (const s of win) {
      feed(windowStats, s, s.t - prev);
      prev = s.t;
    }
    sealStats(windowStats);
    const d = derive(windowStats);
    const metrics = computeMetrics(d, emptyText());

    const now = performance.now();
    let newAlert: LiveAlert | null = null;
    if (t > 14000) {
      const keys: MetricKey[] = ['voice', 'calm', 'gaze', 'gesture', 'speech'];
      for (const k of keys) {
        if (k === 'voice' && !d.voiceAvailable) continue;
        // 말투·발성 경고는 답변 중, 한마디라도 한 뒤, 그리고 답변이 8초는 이어진 뒤에만.
        // (답변 초반의 12초 창에는 직전 턴의 침묵과 면접관 차례가 섞여 있어 "끊김"으로 오판한다)
        const answeredMs = answeringRef.current ? now - answerStartedAtRef.current : 0;
        if ((k === 'speech' || k === 'voice') && (!answeringRef.current || !heardSpeechRef.current || answeredMs < 8000)) continue;
        if ((k === 'gesture' || k === 'calm') && !d.poseAvailable) continue;
        if (metrics[k] < 45 && now - lastAlertAtRef.current[k] > ALERT_COOLDOWN_MS) {
          lastAlertAtRef.current[k] = now;
          // 끊김이 아니라 침묵이 긴 경우는 다른 말을 해야 한다
          const text =
            k === 'speech' && d.voiceRatio < 0.3
              ? '침묵이 길어지고 있습니다. 결론부터 짧게 말해 보세요.'
              : k === 'gaze' && configRef.current?.gazeGuide === 'interviewer'
                ? '시선이 자꾸 다른 곳을 향합니다. 질문한 면접관의 눈을 보세요.'
                : ALERT_TEXT[k];
          newAlert = { id: ++alertSeq.current, key: k, text, t };
          break;
        }
      }
    }
    if (newAlert) alertsRef.current = [...alertsRef.current, newAlert].slice(-6);

    const timeline = timelineRef.current;
    if (!timeline.length || t - timeline[timeline.length - 1].t > 2000) {
      timeline.push({ t, metrics });
    }

    // 시선 표시등: 최근 0.6초의 얼굴 샘플 중 절반 이상이 정면이면 켠다
    let onTargetN = 0;
    let faceN = 0;
    for (let i = win.length - 1; i >= 0 && t - win[i].t < 600; i--) {
      const f = win[i].face;
      if (!f) continue;
      faceN++;
      if (f.onTarget) onTargetN++;
    }
    const gazeOnTarget = faceN ? onTargetN * 2 >= faceN : null;

    if (!mountedRef.current) return;
    setState((s) => ({
      ...s,
      gazeOnTarget,
      // 답변 중이 아니면 음성 지표는 직전 값을 유지한다 (면접관이 말하는 동안 요동치지 않도록)
      live: d.voiceAvailable ? metrics : { ...metrics, voice: s.live.voice, speech: s.live.speech },
      micLevel,
      elapsedSec: Math.floor(t / 1000),
      debug: { ...visionRef.current.debug },
      faceVisible: d.faceCoverage > 0.35,
      alerts: newAlert ? alertsRef.current.slice(-3) : s.alerts,
    }));
  }, []);

  const startLoop = useCallback(() => {
    const vision = visionRef.current;
    const mic = micRef.current;
    const tts = ttsRef.current;

    const tick = () => {
      const video = videoRef.current;
      const marks = marksRef.current;
      if (!video || !marks || video.readyState < 2) return;

      // rAF(보통 60Hz)가 카메라(보통 30fps)보다 빠르다. 새 프레임이 없는 틱을 집계하면
      // 그 틱이 "얼굴 없음"으로 잡혀 감지율이 반토막 나므로 새 프레임일 때만 처리한다.
      if (video.currentTime === lastVideoTimeRef.current) return;
      lastVideoTimeRef.current = video.currentTime;

      const now = performance.now();
      const t = now - startedAtRef.current;
      const dt = lastFrameRef.current ? now - lastFrameRef.current : 33;
      lastFrameRef.current = now;

      let faceSample = null;
      let poseSample = null;
      vision.tickFps(now);
      try {
        const faceResult = marks.face.detectForVideo(video, now);
        if (calibRef.current.active) calibRef.current.collector.add(faceResult);
        faceSample = vision.face(faceResult);
        poseSample = vision.pose(marks.pose.detectForVideo(video, now), now);
      } catch {
        /* 간헐적 추론 실패는 건너뛴다 */
      }

      const micFrame = mic.read(now);
      const ttsActive = tts.speaking;
      if (ttsActive) ttsEndedAtRef.current = now;
      // TTS 직후 700ms 는 스피커 잔향과 발화 판정 히스테리시스 꼬리가 남아 있어 무시한다
      const echoGuard = now - ttsEndedAtRef.current < 700;
      const userSpeaking = micFrame.speaking && !ttsActive && !echoGuard;
      if (userSpeaking) {
        lastUserVoiceRef.current = now;
        if (!speechRunStartRef.current) speechRunStartRef.current = now;
        // 순간적인 잡음·잔향이 아니라 0.35초 넘게 이어질 때만 "답변을 시작했다"로 본다.
        // 안 그러면 생각하는 몇 초 사이에 침묵 종료가 걸려 다음 질문으로 넘어가 버린다.
        if (now - speechRunStartRef.current > 350 && !heardSpeechRef.current) {
          heardSpeechRef.current = true;
          heardAtRef.current = speechRunStartRef.current;
        }
      } else {
        speechRunStartRef.current = 0;
      }

      const sample: Sample = {
        t,
        face: faceSample,
        pose: poseSample,
        snr: micFrame.snr,
        speaking: userSpeaking,
        ttsActive,
        answering: answeringRef.current,
      };

      feed(sessionStatsRef.current, sample, dt);
      if (answerStatsRef.current) feed(answerStatsRef.current, sample, dt);

      const win = windowRef.current;
      win.push(sample);
      while (win.length && t - win[0].t > WINDOW_MS) win.shift();

      if (now - lastTickRef.current > 250) {
        lastTickRef.current = now;
        updateLive(win, t, micFrame.level);
      }
    };

    stopTickerRef.current?.();
    stopTickerRef.current = startTicker(tick);
  }, [updateLive]);

  /* ── 준비: 권한 + 모델 로딩 ────────────────────────────────── */
  const prepare = useCallback(
    async (config: SessionConfig): Promise<boolean> => {
      configRef.current = config;
      abortRef.current = false;
      // 버튼 탭의 사용자 제스처가 살아 있을 때 오디오 컨텍스트를 만들어 둔다 (iOS Safari)
      micRef.current.prime();
      ttsRef.current.prime();
      patch({ phase: 'loading', error: null, loadingMessage: '카메라와 마이크 권한을 확인합니다…' });

      try {
        const stream = await deps.getUserMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
          audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: false },
        });
        streamRef.current = stream;
        // 화면 전환 직후라 <video> 가 아직 붙지 않았을 수 있다
        const video = await waitFor(() => videoRef.current, 3000);
        if (!video) throw new Error('영상 요소를 준비하지 못했습니다.');
        video.srcObject = stream;
        await video.play().catch(() => undefined);

        await micRef.current.attach(stream);
        await ttsRef.current.init();
        marksRef.current = await deps.loadLandmarkers((msg) => patch({ loadingMessage: msg }));
        llmRef.current = await deps.createLlm(config).catch(() => null);
        // Gemini 키가 있고 자연 음성을 켜 두었으면 면접관이 Gemini 음성으로 말한다
        ttsRef.current.useGemini(config.llmProvider === 'gemini' && config.naturalVoice ? config.apiKey : null);
        ttsRef.current.onNotice = (msg) => patch({ notice: msg });

        const stt = sttRef.current;
        stt.onUpdate = (snap) => {
          lastSttUpdateRef.current = performance.now();
          patch({ transcript: snap.final, interim: snap.interim });
        };
        stt.onFatal = (reason) => patch({ notice: reason });

        startedAtRef.current = performance.now();
        lastFrameRef.current = 0;
        lastVideoTimeRef.current = -1;
        windowRef.current = [];
        visionRef.current.reset();
        startLoop();

        patch({
          sttSupported: stt.supported,
          notice: stt.supported
            ? ttsRef.current.hasKoreanVoice
              ? null
              : '이 기기에 한국어 음성이 없어 면접관 목소리 대신 자막으로 진행합니다.'
            : '이 브라우저는 음성 인식을 지원하지 않습니다. Chrome 또는 Edge 에서 열면 말투·내용 평가까지 받을 수 있습니다.',
        });
        return true;
      } catch (err) {
        const msg =
          err instanceof DOMException && (err.name === 'NotAllowedError' || err.name === 'SecurityError')
            ? '카메라/마이크 권한이 거부되었습니다. 주소창의 권한 아이콘에서 허용한 뒤 다시 시도해 주세요.'
            : err instanceof DOMException && err.name === 'NotFoundError'
              ? '카메라 또는 마이크를 찾을 수 없습니다. 장치 연결을 확인해 주세요.'
              : `준비 중 오류가 발생했습니다: ${err instanceof Error ? err.message : String(err)}`;
        patch({ phase: 'error', error: msg });
        return false;
      }
    },
    [deps, patch, startLoop],
  );

  /* ── 시선 보정 ─────────────────────────────────────────────── */
  const runCalibration = useCallback(async () => {
    const vision = visionRef.current;
    const mic = micRef.current;
    vision.calibration = { ...DEFAULT_CALIBRATION };

    const collect = async (step: CalibStep, seconds: number) => {
      calibRef.current.collector.reset();
      calibRef.current.active = true;
      for (let i = seconds; i > 0; i--) {
        patch({ calibStep: step, calibCountdown: i });
        await sleep(1000);
        if (abortRef.current) return null;
      }
      calibRef.current.active = false;
      return calibRef.current.collector.median();
    };

    const ids = configRef.current?.interviewerIds ?? ['', ''];
    patch({ phase: 'calibrating', gazeGuideTarget: null });

    mic.startNoiseCalibration();
    for (let i = 3; i > 0; i--) {
      patch({ calibStep: 'noise', calibCountdown: i });
      await sleep(1000);
      if (abortRef.current) return false;
    }
    mic.finishNoiseCalibration();

    // 실제로 바라볼 지점(왼쪽 면접관 눈 → 오른쪽 면접관 눈 → 렌즈 → 책상)을 차례로 보게 해서 원시값을 잰다
    patch({ gazeGuideTarget: ids[0] });
    const left = await collect('left', 3);
    if (abortRef.current) return false;
    patch({ gazeGuideTarget: ids[1] });
    const right = await collect('right', 3);
    if (abortRef.current) return false;
    patch({ gazeGuideTarget: 'lens' });
    const lens = await collect('lens', 2);
    if (abortRef.current) return false;
    patch({ gazeGuideTarget: null });
    const down = await collect('down', 2);
    if (abortRef.current) return false;

    const d = DEFAULT_CALIBRATION.points;
    if (lens || (left && right)) {
      // 못 잰 지점은 잰 지점에서 기본 간격만큼 떨어진 곳으로 채운다
      const lensPt = lens ?? { x: ((left?.x ?? d.left.x) + (right?.x ?? d.right.x)) / 2, y: ((left?.y ?? d.left.y) + (right?.y ?? d.right.y)) / 2 + (d.lens.y - d.left.y) };
      vision.calibration = {
        points: {
          lens: lensPt,
          left: left ?? { x: lensPt.x + (d.left.x - d.lens.x), y: lensPt.y + (d.left.y - d.lens.y) },
          right: right ?? { x: lensPt.x + (d.right.x - d.lens.x), y: lensPt.y + (d.right.y - d.lens.y) },
          down: down ?? { x: lensPt.x, y: lensPt.y + (d.down.y - d.lens.y) },
        },
        calibrated: true,
      };
    } else {
      patch({
        notice: '얼굴을 인식하지 못해 기본값으로 진행합니다. 조명을 밝게 하고 카메라 정면에 앉아 주세요.',
      });
    }

    patch({ calibStep: 'done', phase: 'ready' });
    return true;
  }, [patch]);

  /* ── 발화 / 청취 ───────────────────────────────────────────── */
  const setAvatars = useCallback(
    (activeId: string, activeState: AvatarState, otherState: AvatarState = 'listening') => {
      const cfg = configRef.current;
      if (!cfg) return;
      const out: Record<string, AvatarState> = {};
      for (const id of cfg.interviewerIds) out[id] = id === activeId ? activeState : otherState;
      patch({ avatars: out });
    },
    [patch],
  );

  /**
   * 바라볼 곳을 옮긴다. 기본(interviewer) 모드에서는 말하는·질문한 면접관의 눈이 기준이고,
   * 렌즈 모드에서는 늘 카메라라서 아무것도 하지 않는다.
   */
  const guide = useCallback(
    (target: 'lens' | string) => {
      const cfg = configRef.current;
      if (!cfg || cfg.gazeGuide !== 'interviewer') return;
      const side = target === cfg.interviewerIds[0] ? 'left' : target === cfg.interviewerIds[1] ? 'right' : 'lens';
      visionRef.current.setTarget(side);
      patch({ gazeGuideTarget: target });
    },
    [patch],
  );

  const speak = useCallback(
    async (text: string, who: Interviewer, isQuestion = false) => {
      if (abortRef.current) return;
      const stt = sttRef.current;
      stt.gated = true;
      setAvatars(who.id, 'speaking');
      // 말하는 사람을 보는 게 자연스럽다
      guide(who.id);
      // 인식기가 면접관 목소리를 받아 적으면 그 문장과 비슷한 결과를 버리도록 알려둔다
      stt.ignoreText = text;
      const handle = ttsRef.current.speak(text, who);
      speakHandleRef.current = handle;
      // 자막은 소리가 실제로 나기 시작할 때 띄운다 (블루투스 이어폰 지연으로 글이 먼저 보이지 않게)
      void handle.started.then(() => {
        if (speakHandleRef.current === handle) patch({ subtitle: { speakerId: who.id, text, isQuestion } });
      });
      await handle.done;
      speakHandleRef.current = null;
      ttsEndedAtRef.current = performance.now();
      // 게이트는 여기서 풀지 않는다 — 인식 결과가 늦게 도착하므로 listenForAnswer 가 잠시 뒤에 연다
    },
    [guide, patch, setAvatars],
  );

  const micGateSeq = useRef(0);
  /** TTS 잔향과 늦게 도착하는 인식 결과를 흘려보낸 뒤 마이크(STT)를 연다 */
  const openMicSoon = useCallback((delayMs = 700) => {
    const seq = ++micGateSeq.current;
    window.setTimeout(() => {
      if (seq !== micGateSeq.current) return; // 그 사이 다시 말하기 시작했다
      if (ttsRef.current.speaking || abortRef.current) return;
      sttRef.current.gated = false;
    }, delayMs);
  }, []);

  const listenForAnswer = useCallback(
    async (
      asker: Interviewer,
    ): Promise<{
      text: string;
      stats: RawStats;
      durationSec: number;
      latencySec: number;
      clarity: number | null;
      cutOff: boolean;
      audio: AnswerAudio | null;
    }> => {
      const cfg = configRef.current!;
      const stt = sttRef.current;
      const stats = emptyStats();
      answerStatsRef.current = stats;

      patch({ subtitle: null });
      setAvatars(asker.id, 'listening', 'writing');

      stt.beginTurn();
      stt.start();
      openMicSoon();
      // 두뇌가 음성을 직접 들을 수 있으면 이 턴의 목소리를 따로 녹음해 둔다
      if (cfg.accurateStt && llmRef.current?.transcribe && streamRef.current) answerRecRef.current.start(streamRef.current);
      heardSpeechRef.current = false;
      lastUserVoiceRef.current = performance.now();
      answeringRef.current = true;

      const start = performance.now();
      answerStartedAtRef.current = start;
      let nudges = 0;
      let lastNudge = start;
      let lastShuffle = start;
      let lastHint: string | null = null;
      // 답변 중 시선: 질문한 면접관의 눈을 기본으로, 가끔 옆 면접관을 2~3초 봤다가 돌아온다
      guide(asker.id);
      const otherId = cfg.interviewerIds.find((id) => id !== asker.id) ?? asker.id;
      let guideShiftAt = start + 8000 + Math.random() * 5000;
      let guideBackAt = 0;
      /** 최대 답변 시간에 걸려 면접관이 끊었는지 */
      let cutOff = false;

      while (!abortRef.current) {
        await sleep(200);
        const now = performance.now();
        const elapsed = (now - start) / 1000;
        const sinceVoice = (now - lastUserVoiceRef.current) / 1000;

        if (elapsed > cfg.maxAnswerSec) {
          cutOff = heardSpeechRef.current;
          break;
        }

        if (cfg.gazeGuide === 'interviewer' && otherId !== asker.id) {
          if (guideBackAt && now > guideBackAt) {
            guideBackAt = 0;
            guideShiftAt = now + 9000 + Math.random() * 5000;
            guide(asker.id);
          } else if (!guideBackAt && now > guideShiftAt) {
            guideBackAt = now + 2500 + Math.random() * 1000;
            guide(otherId);
          }
        }

        // 면접관들이 듣는 동안 자연스럽게 메모하거나 끄덕인다
        if (now - lastShuffle > 3500 + Math.random() * 3000) {
          lastShuffle = now;
          const roll = Math.random();
          const askerState: AvatarState = roll < 0.45 ? 'writing' : roll < 0.7 ? 'nodding' : 'listening';
          const otherState: AvatarState = Math.random() < 0.55 ? 'writing' : 'listening';
          setAvatars(asker.id, askerState, otherState);
        }

        if (!heardSpeechRef.current) {
          if (now - lastNudge > 14000 && nudges < 2) {
            nudges++;
            lastNudge = now;
            answeringRef.current = false;
            await speak(silenceNudgeOf(asker), asker);
            answeringRef.current = true;
            lastUserVoiceRef.current = performance.now();
            openMicSoon();
            patch({ subtitle: null });
            setAvatars(asker.id, 'listening', 'writing');
          } else if (nudges >= 2 && now - lastNudge > 12000) {
            break;
          }
          continue;
        }

        // 침묵 길이만 보지 않고, 지금까지 들린 말이 끝맺어진 형태인지도 본다
        const policy = decideTurnPolicy({
          text: stt.snapshot().full,
          sinceSttUpdateMs: lastSttUpdateRef.current ? now - lastSttUpdateRef.current : Infinity,
          baseSilenceSec: cfg.silenceEndSec,
          sttAvailable: stt.supported,
        });
        if (sinceVoice > policy.silenceSec) break;
        const hint =
          sinceVoice > 0.9 && policy.completeness === 'incomplete'
            ? '말씀이 이어질 것 같아 기다리고 있습니다'
            : sinceVoice > 0.9 && policy.completeness === 'complete'
              ? '더 하실 말씀이 없으면 넘어갑니다'
              : null;
        if (hint !== lastHint) {
          lastHint = hint;
          patch({ turnHint: hint });
        }
      }
      if (lastHint) patch({ turnHint: null });

      answeringRef.current = false;
      answerStatsRef.current = null;
      stt.stop();
      sealStats(stats);
      const durationSec = (performance.now() - start) / 1000;
      // 첫 마디까지 걸린 시간. 한마디도 없었으면 답변 시간 전체를 "기다린 시간"으로 본다
      const latencySec = heardSpeechRef.current ? Math.max(0, (heardAtRef.current - start) / 1000) : durationSec;
      const text = stt.endTurn();
      const audio = await answerRecRef.current.stop().catch(() => null);
      guide(asker.id);
      if (cutOff) {
        // 실제 면접처럼 시간이 다 되면 말을 끊는다
        await speak(asker.mood === 'stern' ? '시간 관계상 여기까지 듣겠습니다.' : '네, 시간 관계상 여기까지 듣겠습니다. 감사합니다.', asker);
      }
      return { text, stats, durationSec, latencySec, clarity: stt.lastTurnConfidence, cutOff, audio };
    },
    [guide, openMicSoon, patch, setAvatars, speak],
  );

  /* ── 결과 산출 ─────────────────────────────────────────────── */
  const finish = useCallback(async () => {
    const cfg = configRef.current;
    answeringRef.current = false;
    sttRef.current.stop();
    ttsRef.current.stop();
    patch({ gazeGuideTarget: null });
    visionRef.current.resetTarget();
    const recording: Recording | null = await recorderRef.current.stop().catch(() => null);

    const stats = sessionStatsRef.current;
    sealStats(stats);
    const d = derive(stats);
    const answers = answersRef.current;
    const text = textStatsOf(answers);
    const metrics = computeMetrics(d, text);
    const breakdown = buildBreakdown(d, text, metrics);
    const content = summarizeContent(answers);

    const strictness = cfg
      ? (getInterviewer(cfg.interviewerIds[0]).strictness + getInterviewer(cfg.interviewerIds[1]).strictness) / 2
      : 1;

    // 음성 인식이 안 되는 브라우저에서는 내용 점수를 총점에 넣지 않는다 (NaN 은 가중 평균에서 빠진다)
    const contentScore = sttRef.current.supported ? content.score : NaN;
    const rawTotal = weighted([
      [metrics.gaze, 0.2],
      [metrics.gesture, 0.18],
      [metrics.speech, 0.22],
      [metrics.voice, 0.15],
      [metrics.calm, 0.15],
      [contentScore, 0.1],
    ]);
    // 엄격한 면접관일수록 같은 수행에 더 낮은 점수를 준다
    const adjusted = clamp(Math.round(50 + (rawTotal - 50) * (2 - strictness)), 0, 100);
    // 반말·비속어는 실제 면접에서 바로 감점이다: 반말 어절당 3점, 비속어당 10점, 최대 25점
    const mannerHits = mannerRef.current;
    const banmalN = mannerHits.filter((h) => h.kind === 'banmal').length;
    const profanityN = mannerHits.filter((h) => h.kind === 'profanity').length;
    const penalty = Math.min(25, banmalN * 3 + profanityN * 10);
    const total = clamp(adjusted - penalty, 0, 100);

    const blind = cfg?.blindMode ? { violations: blindRef.current, disqualified: blindRef.current.length > 0 } : undefined;
    const report: SessionReport = {
      total,
      grade: blind?.disqualified ? '부적격' : gradeOf(total),
      breakdown,
      blind,
      manner: { banmal: banmalN, profanity: profanityN, penalty, hits: mannerHits },
      content: {
        score: content.score,
        summary: content.summary,
        perAnswer: answers.map((a) => ({
          question: a.questionText,
          relevance: a.relevance.score,
          note: a.relevance.note,
        })),
      },
      answers,
      timeline: timelineRef.current,
      durationSec: stats.ms / 1000,
      alerts: alertsRef.current,
    };

    releaseMedia();
    if (!mountedRef.current) return;
    const brain = llmRef.current;
    const wantSummary = !!brain && answers.some((a) => a.transcript.trim().length > 4);
    let video: SessionState['video'] = null;
    if (recording) {
      if (videoUrlRef.current) URL.revokeObjectURL(videoUrlRef.current);
      videoUrlRef.current = URL.createObjectURL(recording.blob);
      video = { url: videoUrlRef.current, mimeType: recording.mimeType, sizeBytes: recording.blob.size, durationMs: recording.durationMs };
    }
    setState((s) => ({ ...s, phase: 'report', report, subtitle: null, avatars: {}, llmSummaryPending: wantSummary, video }));

    if (brain && wantSummary && cfg) {
      const pair = [getInterviewer(cfg.interviewerIds[0]), getInterviewer(cfg.interviewerIds[1])];
      void brain.summarize(answers, pair).then((llm) => {
        if (!mountedRef.current) return;
        setState((s) => {
          if (s.phase !== 'report' || !s.report) return { ...s, llmSummaryPending: false };
          return {
            ...s,
            llmSummaryPending: false,
            report: llm ? { ...s.report, content: { ...s.report.content, llm } } : s.report,
            notice: !llm && brain.lastError ? brain.lastError : s.notice,
          };
        });
      });
    }
  }, [patch, releaseMedia]);

  /* ── 면접 진행 ─────────────────────────────────────────────── */
  const start = useCallback(async () => {
    const cfg = configRef.current;
    if (!cfg) return;
    abortRef.current = false;
    answersRef.current = [];
    sessionStatsRef.current = emptyStats();
    timelineRef.current = [];
    alertsRef.current = [];
    windowRef.current = [];
    startedAtRef.current = performance.now();
    lastFrameRef.current = 0;

    const a = getInterviewer(cfg.interviewerIds[0]);
    const b = getInterviewer(cfg.interviewerIds[1]);
    const pair = [a, b];
    blindRef.current = [];
    mannerRef.current = [];
    echoNoticedRef.current = false;

    // 첫 인사와 첫 질문은 미리 합성해 둔다
    const greeting = greetingOf(a);
    ttsRef.current.prefetch(greeting, a);
    if (cfg.questions[0]) ttsRef.current.prefetch(cfg.questions[0].text, a);

    patch({
      phase: 'running',
      questionIndex: 0,
      totalQuestions: cfg.questions.length,
      blindViolations: [],
      mannerHits: [],
      gazeGuideTarget: cfg.gazeGuide === 'interviewer' ? a.id : null,
      video: null,
    });
    if (cfg.recordVideo && streamRef.current) {
      if (!recorderRef.current.start(streamRef.current)) {
        patch({ notice: '이 브라우저는 영상 녹화를 지원하지 않아 녹화 없이 진행합니다.' });
      }
    }

    /**
     * 두뇌가 음성을 직접 들을 수 있으면 브라우저 받아쓰기를 정확한 전사로 바꾼다.
     * 면접관이 메모하는 동안(최대 12초) 기다리고, 안 되면 원래 받아쓰기를 그대로 쓴다.
     */
    const refineTranscript = async <T extends { text: string; audio: AnswerAudio | null; stats: RawStats; clarity: number | null }>(turn: T): Promise<T> => {
      const brain = llmRef.current;
      if (!cfg.accurateStt || !brain?.transcribe || !turn.audio) return turn;
      // 한마디도 없었으면(소리 1초 미만) 보낼 필요가 없다
      if (turn.stats.voicedMs < 1000 && !turn.text.trim()) return turn;
      const timeout = new Promise<null>((r) => setTimeout(() => r(null), 12000));
      const refined = await Promise.race([brain.transcribe(turn.audio.blob, turn.audio.mimeType, turn.text), timeout]).catch(() => null);
      if (!refined) return turn;
      patch({ transcript: refined, interim: '' });
      // 정확한 전사가 됐으니 브라우저 신뢰도로 되묻지 않는다
      return { ...turn, text: refined, clarity: null };
    };

    /** 블라인드 규정 위반을 기록하고 면접관이 즉석에서 지적한다. extra 는 두뇌(LLM)가 잡은 항목 */
    const checkBlind = async (text: string, questionIndex: number, who: Interviewer, extra: BlindViolation['category'][] = []) => {
      if (!cfg.blindMode) return;
      const found = detectBlindViolations(text, questionIndex);
      for (const w of detectWatchlist(text, cfg.blindWatch, questionIndex)) {
        if (!found.some((v) => v.category === w.category)) found.push(w);
      }
      for (const cat of extra) {
        if (found.some((v) => v.category === cat)) continue;
        if (blindRef.current.some((v) => v.category === cat && v.questionIndex === questionIndex)) continue;
        found.push({ category: cat, label: BLIND_LABEL[cat], excerpt: '면접관 AI 가 답변에서 감지', questionIndex });
      }
      if (!found.length) return;
      blindRef.current = [...blindRef.current, ...found];
      const t = performance.now() - startedAtRef.current;
      for (const v of found) {
        alertsRef.current = [...alertsRef.current, { id: ++alertSeq.current, key: 'blind' as const, text: `블라인드 규정 위반: ${v.label} 언급 — 부적격 사유`, t }].slice(-6);
      }
      patch({ blindViolations: blindRef.current, alerts: alertsRef.current.slice(-3) });
      await speak(blindWarningLine(found[0]), who);
    };

    /** 반말·비속어를 기록하고 창에 경고를 띄운다. 비속어는 면접관이 한마디 한다 */
    const checkManner = async (text: string, questionIndex: number, who: Interviewer, llmFlags: string[] = []) => {
      const found = detectManner(text, questionIndex);
      // 두뇌가 반말이라고 봤는데 규칙이 못 잡았으면 한 건으로 기록한다
      if (llmFlags.includes('banmal') && !found.some((h) => h.kind === 'banmal')) {
        found.push({ kind: 'banmal', word: '(면접관 AI 감지)', excerpt: text.slice(0, 40), questionIndex });
      }
      if (llmFlags.includes('profanity') && !found.some((h) => h.kind === 'profanity')) {
        found.push({ kind: 'profanity', word: '(면접관 AI 감지)', excerpt: text.slice(0, 40), questionIndex });
      }
      if (!found.length) return;
      mannerRef.current = [...mannerRef.current, ...found];
      const t = performance.now() - startedAtRef.current;
      const banmal = found.filter((h) => h.kind === 'banmal');
      const profanity = found.filter((h) => h.kind === 'profanity');
      if (profanity.length) {
        alertsRef.current = [...alertsRef.current, { id: ++alertSeq.current, key: 'manner' as const, text: `비속어가 감지됐습니다 ("${profanity[0].word}"). 면접에서는 즉시 감점입니다.`, t }].slice(-6);
      }
      if (banmal.length) {
        alertsRef.current = [...alertsRef.current, { id: ++alertSeq.current, key: 'manner' as const, text: `반말이 감지됐습니다 ("${banmal[0].word}"). 존댓말로 답변하세요.`, t }].slice(-6);
      }
      patch({ mannerHits: mannerRef.current, alerts: alertsRef.current.slice(-3) });
      if (profanity.length && !abortRef.current) await speak(mannerRemarkLine(who.mood), who);
    };

    /** 면접관 목소리가 마이크로 되돌아오면 이어폰을 권한다 (한 번만) */
    const checkEcho = () => {
      if (echoNoticedRef.current) return;
      if ((sttRef.current.echoCount ?? 0) < 2) return;
      echoNoticedRef.current = true;
      patch({ notice: '스피커 소리가 마이크로 되돌아와 받아쓰기에 섞이고 있습니다. 이어폰을 쓰면 인식이 훨씬 정확해집니다.' });
    };

    try {
      await speak(greeting, a);
      if (!abortRef.current && b.id !== a.id) {
        await sleep(300);
        await speak(`저는 ${b.name}입니다. 함께 듣겠습니다.`, b);
      }
      if (!abortRef.current && cfg.blindMode) {
        await sleep(300);
        await speak(BLIND_RULE_LINE, a);
      }

      // LLM 이 방금 답변을 짚어 준 한 마디. 다음 질문 앞에 붙는다
      let bridge = '';
      for (let i = 0; i < cfg.questions.length; i++) {
        if (abortRef.current) break;
        const q = cfg.questions[i];
        const asker = pair[i % 2];
        const other = pair[(i + 1) % 2];
        patch({ questionIndex: i });

        // 다음 질문은 지금 미리 합성해 두면 차례가 왔을 때 기다리지 않는다
        if (cfg.questions[i + 1]) ttsRef.current.prefetch(cfg.questions[i + 1].text, pair[(i + 1) % 2]);
        await speak(bridge ? `${bridge} ${q.text}` : q.text, asker, true);
        bridge = '';
        if (abortRef.current) break;

        const askedAt = performance.now();
        let first = await listenForAnswer(asker);
        if (abortRef.current) break;
        let reasked = false;
        // 정확한 전사가 되면 브라우저 받아쓰기를 그것으로 바꾼다 (되묻기·블라인드·평가 전부 이 텍스트로)
        setAvatars(asker.id, 'writing', 'writing');
        first = await refineTranscript(first);
        if (abortRef.current) break;

        // 받아쓰기가 못 믿을 정도면 (신뢰도 낮음·인식된 글자가 너무 적음) 한 번 다시 말해 달라고 한다
        const clarity = judgeIntelligibility({ text: first.text, confidence: first.clarity, voicedSec: first.stats.voicedMs / 1000 });
        if (clarity.unclear && first.text.trim()) {
          reasked = true;
          await speak(reaskLineOf(asker), asker);
          const again = await refineTranscript(await listenForAnswer(asker));
          if (abortRef.current) break;
          // 다시 말한 게 있으면 그걸 답변으로 삼는다 (처음 것은 오인식으로 보고 버린다)
          if (again.text.trim()) first = { ...again, latencySec: first.latencySec };
        }
        await checkBlind(first.text, i, asker);
        if (abortRef.current) break;
        checkEcho();

        setAvatars(asker.id, 'writing', 'writing');

        const speech = analyzeSpeech(first.text, {
          totalSec: first.durationSec,
          voicedSec: first.stats.voicedMs / 1000,
          pauseCount: first.stats.pauseCount,
          longPauses: first.stats.longPauses,
        });
        let relevance = analyzeRelevance(q, first.text);
        let followUpText: string | null = null;
        let followUpReason: string | null = null;
        /** 꼬리 질문을 누가 던지는지 (LLM 이 옆 면접관에게 넘길 수 있다) */
        let followUpAsker = asker;

        const brain = llmRef.current;
        const llmPromise =
          brain && first.text.length > 5
            ? brain.evaluate({
                asker,
                other,
                question: q,
                answer: first.text,
                previous: answersRef.current.map((r) => ({ question: r.questionText, answer: r.transcript })),
                nextQuestion: cfg.questions[i + 1]?.text,
                alreadyFollowedUp: false,
                blindMode: cfg.blindMode,
              })
            : Promise.resolve(null);

        // 메모하는 시간 동안 평가가 끝나도록 기다린다
        const [llm] = await Promise.all([llmPromise, sleep(1600 + Math.random() * 1400)]);
        if (abortRef.current) break;

        let gist = '';
        if (llm) {
          relevance = {
            ...relevance,
            score: Math.round((relevance.score + llm.relevance) / 2),
            note: llm.note || relevance.note,
          };
          gist = llm.gist;
          // 두뇌가 잡은 규정 위반·말씨 — 규칙이 놓친 것만 추가된다
          const blindFlags = llm.flags.filter((f): f is BlindViolation['category'] => f !== 'banmal' && f !== 'profanity');
          if (blindFlags.length) await checkBlind(first.text, i, asker, blindFlags);
          await checkManner(first.text, i, asker, llm.flags);
          if (abortRef.current) break;
          if (llm.followUp) {
            followUpText = llm.followUp;
            followUpAsker = llm.handoff && other.id !== asker.id ? other : asker;
            followUpReason = followUpAsker === asker ? '면접관이 답변을 듣고 되물음' : `${other.name} 교수가 이어받아 되물음`;
          }
          bridge = llm.bridge;
        } else {
          if (brain?.lastError) patch({ notice: brain.lastError });
          await checkManner(first.text, i, asker);
          if (abortRef.current) break;
        }

        // 한마디도 없었으면 되물어도 소용없다 — 그냥 다음 질문으로
        if (!followUpText && cfg.allowFollowUps && first.text.trim().length > 0) {
          const decision = decideFollowUp(asker, q, relevance, speech, false);
          followUpText = decision.text;
          followUpReason = decision.reason || null;
        }

        let mergedText = first.text;
        let mergedDuration = first.durationSec;
        const mergedStats = first.stats;

        if (followUpText && cfg.allowFollowUps && !abortRef.current) {
          if (followUpAsker !== asker) {
            // 옆 면접관이 끼어든다
            setAvatars(followUpAsker.id, 'speaking', 'listening');
            await speak(`제가 하나 여쭙겠습니다. ${followUpText}`, followUpAsker);
          } else {
            await speak(followUpText, asker);
          }
          const second = await refineTranscript(await listenForAnswer(followUpAsker));
          if (!abortRef.current) {
            await checkBlind(second.text, i, followUpAsker);
            await checkManner(second.text, i, followUpAsker);
            mergedText = `${first.text} ${second.text}`.trim();
            mergedDuration += second.durationSec;
            mergeStats(mergedStats, second.stats);
            // 합친 답변으로 다시 채점하되, LLM 이 준 점수는 계속 절반 반영한다
            const merged = analyzeRelevance(q, mergedText);
            relevance = llm ? { ...merged, score: Math.round((merged.score + llm.relevance) / 2), note: llm.note || merged.note } : merged;
          }
          setAvatars(asker.id, 'writing', 'writing');
        }

        const voicedSec = mergedStats.voicedMs / 1000;
        const finalSpeech = analyzeSpeech(mergedText, {
          totalSec: mergedDuration,
          voicedSec,
          pauseCount: mergedStats.pauseCount,
          longPauses: mergedStats.longPauses,
        });

        const answerDerived = derive(mergedStats);
        answersRef.current.push({
          questionId: q.id,
          questionText: q.text,
          transcript: mergedText,
          durationSec: mergedDuration,
          voicedSec,
          latencySec: first.latencySec,
          startedAt: askedAt - startedAtRef.current,
          endedAt: performance.now() - startedAtRef.current,
          speech: finalSpeech,
          relevance,
          metrics: computeMetrics(
            answerDerived,
            textStatsOf([{ speech: finalSpeech, voicedSec, latencySec: first.latencySec, clarity: first.clarity }]),
          ),
          followUpAsked: followUpText,
          followUpReason,
          clarity: first.clarity,
          reasked,
          gist: gist || undefined,
        });

        if (!abortRef.current) {
          setAvatars(asker.id, 'nodding');
          // 한마디도 없었는데 "잘 들었습니다" 라고 하면 이상하다
          await speak(mergedText.trim() ? ackOf(asker) : '네, 그럼 다음 질문으로 넘어가겠습니다.', asker);
        }
      }

      if (!abortRef.current) await speak(closingOf(pair[0]), pair[0]);
    } finally {
      void finish();
    }
  }, [finish, listenForAnswer, patch, setAvatars, speak]);

  const abort = useCallback(() => {
    abortRef.current = true;
    speakHandleRef.current?.cancel();
    ttsRef.current.stop();
  }, []);

  const reset = useCallback(() => {
    teardown();
    void recorderRef.current.stop();
    if (videoUrlRef.current) {
      URL.revokeObjectURL(videoUrlRef.current);
      videoUrlRef.current = null;
    }
    visionRef.current.reset();
    abortRef.current = false;
    if (mountedRef.current) setState(initialState());
  }, [teardown]);

  return { state, videoRef, prepare, runCalibration, start, abort, reset };
}

/* ── 헬퍼 ─────────────────────────────────────────────────────── */

/** 꼬리 질문까지 포함해 한 문항의 통계를 합친다 */
function mergeStats(target: RawStats, extra: RawStats) {
  const keys = [
    'ms', 'faceMs', 'noFaceMs', 'onTargetMs', 'downMs', 'gazeSum', 'gazeSqSum', 'gazeN', 'blinks',
    'poseMs', 'tiltSum', 'neckSum', 'swaySum', 'handSum', 'poseN', 'selfTouchMs', 'legShakeSum',
    'legShakeMs', 'legN', 'handFidgetSum', 'voicedMs', 'answerMs', 'snrSum', 'snrSqSum', 'snrN',
    'weakMs', 'trailingDropSum', 'utteranceCount', 'pauseCount', 'longPauses',
  ] as const;
  for (const k of keys) target[k] += extra[k];
}

