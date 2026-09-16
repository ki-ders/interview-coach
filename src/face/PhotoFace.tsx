import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Interviewer } from '../types';
import type { AvatarState } from '../interview/useSession';
import { FaceAnimator } from './animator';
import { DEFAULT_FRAMING, FaceGl, type Framing } from './faceGl';
import { lipSync } from './lipsync';
import { LANDMARK_COUNT } from './landmarks';
import { getPhotoRig, loadImage } from './photoRig';
import { PHOTO_CHANGED, getPhotoSource } from './photoStore';
import { deform, type FaceRig } from './rig';

type Status = 'loading' | 'ready' | 'fallback';

interface Props {
  who: Interviewer;
  state: AvatarState;
  /** 사진이 없거나 얼굴을 못 찾았을 때 대신 그릴 것 */
  fallback: ReactNode;
  framing?: Framing;
  /** 애니메이션 없이 정지 상태로 (설정 화면 미리보기용) */
  still?: boolean;
  className?: string;
  onStatus?: (status: Status) => void;
}

/**
 * 사진 한 장으로 만든 움직이는 면접관 얼굴.
 * 사진 → MediaPipe 랜드마크 → 메시 변형 → WebGL. 실패하면 fallback 을 그린다.
 */
export function PhotoFace({ who, state, fallback, framing = DEFAULT_FRAMING, still, className, onStatus }: Props) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [status, setStatus] = useState<Status>('loading');
  const [photoVersion, setPhotoVersion] = useState(0);

  // 루프 안에서 최신 props 를 읽기 위한 ref (렌더 중에는 건드리지 않는다)
  const stateRef = useRef(state);
  const framingRef = useRef(framing);
  useEffect(() => {
    stateRef.current = state;
    framingRef.current = framing;
  }, [state, framing]);

  useEffect(() => {
    const onChanged = (e: Event) => {
      if ((e as CustomEvent<string>).detail === who.id) setPhotoVersion((v) => v + 1);
    };
    window.addEventListener(PHOTO_CHANGED, onChanged);
    return () => window.removeEventListener(PHOTO_CHANGED, onChanged);
  }, [who.id]);

  useEffect(() => {
    onStatus?.(status);
  }, [status, onStatus]);

  useEffect(() => {
    let cancelled = false;
    let gl: FaceGl | null = null;
    let raf = 0;
    let observer: ResizeObserver | null = null;

    (async () => {
      const source = getPhotoSource(who.id);
      const img = await loadImage(source.src);
      if (cancelled) return;
      setStatus('loading');
      if (!img) {
        setStatus('fallback');
        return;
      }
      const rig: FaceRig | null = await getPhotoRig(img, source.key);
      if (cancelled) return;
      const canvas = canvasRef.current;
      const wrap = wrapRef.current;
      if (!rig || !canvas || !wrap) {
        setStatus('fallback');
        return;
      }

      try {
        gl = new FaceGl(canvas);
        gl.setImage(img, rig);
      } catch (err) {
        console.warn('[PhotoFace] WebGL 초기화 실패', err);
        setStatus('fallback');
        return;
      }

      const fit = () => {
        const rect = wrap.getBoundingClientRect();
        gl?.resize(rect.width, rect.height, Math.min(window.devicePixelRatio || 1, 2), framingRef.current);
      };
      fit();
      observer = new ResizeObserver(fit);
      observer.observe(wrap);

      const animator = new FaceAnimator(hashSeed(who.id));
      const out = new Float32Array(LANDMARK_COUNT * 2);
      setStatus('ready');

      const drawOnce = (now: number, forcedState?: AvatarState, forcedLip?: number) => {
        if (cancelled || !gl) return;
        const st = forcedState ?? (still ? 'idle' : stateRef.current);
        const lip = forcedLip ?? (st === 'speaking' ? lipSync.value(now) : 0);
        const pose = animator.update(now, st, who.mood, lip);
        deform(rig, pose, out);
        gl.render(out, pose.jaw);
        canvas.style.transform = still
          ? ''
          : `perspective(900px) rotateX(${pose.cardTilt.toFixed(2)}deg) translateY(${pose.cardDy.toFixed(2)}px) rotate(${pose.cardRot.toFixed(2)}deg)`;
      };
      const frame = () => {
        if (cancelled) return;
        drawOnce(performance.now());
        if (!still) raf = requestAnimationFrame(frame);
      };
      frame();
      if (still) {
        // 정지 화면도 깜빡임 정도는 보이도록 느리게 갱신
        raf = window.setInterval(frame, 120) as unknown as number;
      }

      // 개발 모드: 숨겨진 탭에서는 rAF 가 돌지 않아 검증용으로 수동 렌더 훅을 노출한다
      if (import.meta.env.DEV) {
        const registry = ((window as unknown as { __photoFaces?: Record<string, unknown> }).__photoFaces ??= {});
        registry[who.id] = {
          fit,
          draw: (state?: AvatarState, lip?: number, advanceMs = 0) => drawOnce(performance.now() + advanceMs, state, lip),
        };
      }
    })();

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      if (still) window.clearInterval(raf);
      observer?.disconnect();
      gl?.dispose();
    };
  }, [who.id, who.mood, still, photoVersion]);

  return (
    <div ref={wrapRef} className={`photoface${className ? ` ${className}` : ''}`} data-status={status}>
      <canvas ref={canvasRef} className="photoface__canvas" hidden={status !== 'ready'} />
      {status !== 'ready' && <div className="photoface__fallback">{fallback}</div>}
    </div>
  );
}

function hashSeed(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 1000;
  return h / 1000;
}
