import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Interviewer } from '../types';
import type { AvatarState } from '../interview/useSession';
import { PhotoFace } from '../face/PhotoFace';
import { VectorTile } from './Avatar';
import { BACKDROP_CHANGED, getBackdrop } from '../face/photoStore';

interface Props {
  pair: [Interviewer, Interviewer];
  states: Record<string, AvatarState>;
  speakingId?: string;
  /** 사용자가 지금 카메라를 보고 있는지 (null = 얼굴 없음) */
  gazeOnTarget: boolean | null;
  running: boolean;
  /** 지금 바라볼 곳(면접관 id). 렌즈 모드면 null */
  guideTarget?: 'lens' | string | null;
  /** 시선 기준: 면접관 눈(interviewer) / 카메라 렌즈(lens) */
  guideMode?: 'interviewer' | 'lens';
  /** 안내 점의 화면상 위치(0~1)를 알려준다 */
  onGuideMeasured?: (fx: number, fy: number) => void;
}

const STATE_LABEL: Record<AvatarState, string> = {
  idle: '',
  speaking: '질문 중',
  listening: '듣는 중',
  writing: '메모 중',
  nodding: '듣는 중',
};

/**
 * 면접실 한 공간. CSS 3D 로 벽·바닥·긴 책상을 깔고, 그 뒤에 두 면접관(2.5D 사진)을
 * 사용자 쪽으로 살짝 돌려 앉힌다. 위쪽 가운데에는 "여기를 보세요" 렌즈 표시가 항상 떠 있다.
 */
export function InterviewRoom({ pair, states, speakingId, gazeOnTarget, running, guideTarget, guideMode = 'lens', onGuideMeasured }: Props) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const backdrop = useBackdrop();
  return (
    <div className={`office${backdrop ? ' office--photo' : ''}`} ref={rootRef}>
      <div className="office__scene" aria-hidden>
        {backdrop && <img className="office__backdrop" src={backdrop} alt="" />}
        <div className="office__wall">
          <div className="office__ceiling">
            <span />
            <span />
            <span />
          </div>
          <div className="office__window" />
          <div className="office__shelf" />
          <div className="office__frame" />
          <div className="office__door" />
          <div className="office__baseboard" />
        </div>
        <div className="office__floor" />
        <div className="office__deskTop">
          <span className="office__paper office__paper--l" />
          <span className="office__cup office__cup--l" />
          <span className="office__paper office__paper--r" />
          <span className="office__cup office__cup--r" />
        </div>
        <div className="office__deskFront" />
        <div className="office__light" />
      </div>

      <div className="office__seats">
        {pair.map((who, i) => (
          <Seat
            key={who.id}
            who={who}
            side={i === 0 ? 'left' : 'right'}
            state={states[who.id] ?? 'idle'}
            active={speakingId === who.id}
          />
        ))}
      </div>

      <LensMark onTarget={gazeOnTarget} running={running} mode={guideMode} />
      {guideTarget && <GuideDot rootRef={rootRef} target={guideTarget} onMeasured={onGuideMeasured} />}
    </div>
  );
}

/** 사용자가 올린 면접장 배경 사진 (없으면 null) */
function useBackdrop(): string | null {
  const [src, setSrc] = useState<string | null>(getBackdrop);
  useEffect(() => {
    const onChange = () => setSrc(getBackdrop());
    window.addEventListener(BACKDROP_CHANGED, onChange);
    return () => window.removeEventListener(BACKDROP_CHANGED, onChange);
  }, []);
  return src;
}

/**
 * 시선 안내 점. 렌즈 표시와 면접관 얼굴 사이를 부드럽게 오간다.
 * 위치는 실제 DOM 을 재서 정하므로 화면 크기가 달라도 얼굴 위에 놓인다.
 */
function GuideDot({
  rootRef,
  target,
  onMeasured,
}: {
  rootRef: React.RefObject<HTMLDivElement | null>;
  target: 'lens' | string;
  onMeasured?: (fx: number, fy: number) => void;
}) {
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const onResize = () => setTick((t) => t + 1);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const rootRect = root.getBoundingClientRect();
    let x: number;
    let y: number;
    if (target === 'lens') {
      const lens = root.querySelector<HTMLElement>('.lens__ring');
      const r = lens?.getBoundingClientRect();
      x = r ? r.left + r.width / 2 : rootRect.left + rootRect.width / 2;
      y = r ? r.top + r.height / 2 : rootRect.top + 20;
    } else {
      const seat = root.querySelector<HTMLElement>(`[data-seat="${target}"] .seat__card`);
      const r = seat?.getBoundingClientRect();
      // 눈높이: 사진은 얼굴 중심(44%)보다 조금 위(37%), 벡터 얼굴은 30% 근처
      const isPhoto = !!seat?.querySelector('.photoface[data-status="ready"]');
      x = r ? r.left + r.width / 2 : rootRect.left + rootRect.width / 2;
      y = r ? r.top + r.height * (isPhoto ? 0.37 : 0.3) : rootRect.top + rootRect.height * 0.34;
    }
    setPos({ left: x - rootRect.left, top: y - rootRect.top });
    // 렌즈는 카메라 그 자체이므로 (0,0) 기준을 쓰고, 면접관은 화면상 위치로 환산한다
    if (target !== 'lens') onMeasured?.(x / window.innerWidth, y / window.innerHeight);
  }, [rootRef, target, onMeasured, tick]);

  if (!pos) return null;
  return (
    <div className={`gazeguide${target === 'lens' ? ' gazeguide--lens' : ''}`} style={{ left: pos.left, top: pos.top }} aria-hidden>
      <span className="gazeguide__dot" />
      {target !== 'lens' && <span className="gazeguide__hint">여기</span>}
    </div>
  );
}

function Seat({
  who,
  side,
  state,
  active,
}: {
  who: Interviewer;
  side: 'left' | 'right';
  state: AvatarState;
  active: boolean;
}) {
  return (
    <div className={`seat seat--${side}${active ? ' seat--active' : ''} seat--${state}`} data-seat={who.id}>
      <div className="seat__card">
        <PhotoFace who={who} state={state} fallback={<VectorTile who={who} state={state} />} />
        {state === 'writing' && <NoteBadge />}
      </div>
      <div className="seat__shadow" />
      <div className={`plate plate--desk${active ? ' plate--active' : ''}`}>
        <span className="plate__name">{who.name} 교수</span>
        <span className="plate__role">{who.title}</span>
        {STATE_LABEL[state] && <span className="plate__tag">{STATE_LABEL[state]}</span>}
      </div>
    </div>
  );
}

/** 위쪽 가운데 시선 상태 표시. 렌즈 모드에서는 이 자리가 곧 바라볼 지점(카메라)이다 */
function LensMark({ onTarget, running, mode }: { onTarget: boolean | null; running: boolean; mode: 'interviewer' | 'lens' }) {
  const tone = onTarget === null ? 'off' : onTarget ? 'on' : 'away';
  const label =
    mode === 'interviewer'
      ? onTarget === null
        ? '면접관의 눈을 보세요'
        : onTarget
          ? '시선 좋습니다'
          : '면접관의 눈을 보세요'
      : onTarget === null
        ? '카메라 렌즈를 보세요'
        : onTarget
          ? '시선 좋습니다'
          : '여기, 렌즈를 보세요';
  return (
    <div className={`lens lens--${tone}${running ? ' lens--running' : ''} lens--${mode}`} role="status" aria-live="polite">
      <span className="lens__ring">
        <span className="lens__dot" />
      </span>
      <span className="lens__label">{label}</span>
    </div>
  );
}

function NoteBadge() {
  return (
    <div className="tile__note" aria-label="메모 중">
      <svg viewBox="0 0 40 40" width="34" height="34" aria-hidden>
        <rect x="6" y="5" width="26" height="32" rx="3" className="tile__notePaper" />
        <g className="tile__noteLines">
          <line x1="11" y1="13" x2="27" y2="13" />
          <line x1="11" y1="19" x2="25" y2="19" />
          <line x1="11" y1="25" x2="27" y2="25" />
          <line x1="11" y1="31" x2="20" y2="31" />
        </g>
        <path d="M31 8 L35 12 L24 23 L20 24 L21 20 Z" className="tile__notePen" />
      </svg>
    </div>
  );
}

/** 설정 화면 미리보기 등에서 쓰는 단독 타일 (화상 면접 형태) */
export function InterviewerTile({
  who,
  state,
  active,
}: {
  who: Interviewer;
  state: AvatarState;
  active: boolean;
}) {
  return (
    <div className={`tile${active ? ' tile--active' : ''} tile--${state}`}>
      <div className="tile__media">
        <PhotoFace who={who} state={state} fallback={<VectorTile who={who} state={state} />} />
        {state === 'writing' && <NoteBadge />}
      </div>
      <div className={`plate${active ? ' plate--active' : ''}`}>
        <span className="plate__name">{who.name} 교수</span>
        <span className="plate__role">{who.title}</span>
        {STATE_LABEL[state] && <span className="plate__tag">{STATE_LABEL[state]}</span>}
      </div>
    </div>
  );
}
