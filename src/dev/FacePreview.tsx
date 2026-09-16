import { useState } from 'react';
import { INTERVIEWERS, getInterviewer } from '../data/interviewers';
import type { AvatarState } from '../interview/useSession';
import { InterviewerTile } from '../components/InterviewRoom';
import { lipSync } from '../face/lipsync';
import { clearCustomPhoto, notifyPhotoChanged, saveCustomPhoto } from '../face/photoStore';

const STATES: AvatarState[] = ['idle', 'speaking', 'listening', 'nodding', 'writing'];

/**
 * 개발용: 사진 얼굴 파이프라인을 카메라 없이 확인하는 화면 (?preview=face).
 * 사진 업로드 → 상태 전환 → 립싱크 테스트.
 */
export function FacePreview() {
  const params = new URLSearchParams(location.search);
  const [id, setId] = useState(params.get('who') ?? 'seo');
  const [state, setState] = useState<AvatarState>((params.get('state') as AvatarState) ?? 'idle');
  const [msg, setMsg] = useState('');
  const who = getInterviewer(id);

  const upload = async (file: File | null) => {
    if (!file) return;
    try {
      await saveCustomPhoto(id, file);
      notifyPhotoChanged(id);
      setMsg(`${who.name} 사진 저장됨 (${Math.round(file.size / 1024)}KB)`);
    } catch (err) {
      setMsg(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="page stack">
      <div className="card card__pad">
        <div className="row" style={{ gap: 8, marginBottom: 12 }}>
          {INTERVIEWERS.map((w) => (
            <button
              key={w.id}
              type="button"
              className={`pack${w.id === id ? ' pack--on' : ''}`}
              onClick={() => setId(w.id)}
            >
              {w.name}
            </button>
          ))}
        </div>
        <div className="row" style={{ gap: 8, marginBottom: 12 }}>
          {STATES.map((s) => (
            <button
              key={s}
              type="button"
              className={`pack${s === state ? ' pack--on' : ''}`}
              onClick={() => {
                setState(s);
                if (s === 'speaking') {
                  lipSync.begin('안녕하세요. 오늘 면접을 맡은 서지우입니다. 편하게 앉으시고, 준비되면 시작하겠습니다.');
                } else {
                  lipSync.end();
                }
              }}
            >
              {s}
            </button>
          ))}
        </div>
        <div className="row" style={{ gap: 8 }}>
          <input
            id="face-preview-file"
            type="file"
            accept="image/*"
            onChange={(e) => void upload(e.target.files?.[0] ?? null)}
          />
          <button
            type="button"
            className="btn"
            onClick={() => {
              clearCustomPhoto(id);
              notifyPhotoChanged(id);
              setMsg('기본 사진으로');
            }}
          >
            사진 초기화
          </button>
          <span className="tiny muted">{msg}</span>
        </div>
      </div>

      <div style={{ maxWidth: 520, margin: '0 auto', width: '100%' }} id="face-preview-tile">
        <InterviewerTile who={who} state={state} active={state === 'speaking'} />
      </div>
    </div>
  );
}
