import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { Interviewer } from '../types';
import { PhotoFace } from '../face/PhotoFace';
import { PHOTO_CHANGED, clearCustomPhoto, hasCustomPhoto, notifyPhotoChanged, saveCustomPhoto } from '../face/photoStore';
import { InterviewerBust } from './Avatar';

const MOOD_LABEL = { warm: '온화', neutral: '중립', stern: '압박' } as const;

interface Props {
  who: Interviewer;
  /** 선택 순서 (0부터). 선택 안 됐으면 -1 */
  order: number;
  onToggle: () => void;
}

/** 설정 화면의 면접관 카드 — 선택 + 사진 넣기 */
export function InterviewerCard({ who, order, onToggle }: Props) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [custom, setCustom] = useState(() => hasCustomPhoto(who.id));
  const [photoOk, setPhotoOk] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onChanged = (e: Event) => {
      if ((e as CustomEvent<string>).detail === who.id) setCustom(hasCustomPhoto(who.id));
    };
    window.addEventListener(PHOTO_CHANGED, onChanged);
    return () => window.removeEventListener(PHOTO_CHANGED, onChanged);
  }, [who.id]);

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onToggle();
    }
  };

  const upload = async (file: File | null) => {
    if (!file) return;
    setError(null);
    try {
      await saveCustomPhoto(who.id, file);
      notifyPhotoChanged(who.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : '사진을 저장하지 못했습니다.');
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      className={`pick${order >= 0 ? ' pick--on' : ''}`}
      onClick={onToggle}
      onKeyDown={onKey}
      aria-pressed={order >= 0}
    >
      {order >= 0 && <span className="pick__order">{order + 1}</span>}

      <div className="pick__portrait">
        <PhotoFace
          who={who}
          state="idle"
          still
          fallback={<InterviewerBust who={who} />}
          onStatus={(s) => setPhotoOk(s === 'ready' ? true : s === 'fallback' ? false : null)}
        />
      </div>

      <div>
        <div className="pick__name">{who.name} 교수</div>
        <span className={`mood mood--${who.mood}`}>{MOOD_LABEL[who.mood]}</span>
      </div>
      <div className="pick__blurb">{who.blurb}</div>

      {/* 사진 컨트롤 — 카드 선택 클릭과 분리 */}
      <div className="pick__photo" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            void upload(e.target.files?.[0] ?? null);
            e.target.value = '';
          }}
        />
        <button type="button" className="btn btn--ghost pick__photoBtn" onClick={() => fileRef.current?.click()}>
          사진 바꾸기
        </button>
        {custom && (
          <button
            type="button"
            className="btn btn--ghost pick__photoBtn"
            onClick={() => {
              clearCustomPhoto(who.id);
              notifyPhotoChanged(who.id);
            }}
          >
            기본으로
          </button>
        )}
        {error && <span className="tiny" style={{ color: 'var(--bad)' }}>{error}</span>}
        {photoOk === false && custom && (
          <span className="tiny" style={{ color: 'var(--warn)' }}>
            얼굴을 찾지 못해 그림으로 표시합니다. 정면 사진을 써 주세요.
          </span>
        )}
      </div>
    </div>
  );
}
