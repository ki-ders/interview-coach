import { useEffect, useRef, useState } from 'react';
import { BACKDROP_CHANGED, clearBackdrop, getBackdrop, saveBackdrop } from '../face/photoStore';

/**
 * 면접장 배경 사진. 실제 면접장을 참고한 생성 프롬프트를 주고, 만든 사진을 올리면
 * 면접 화면의 벽·바닥이 그 사진으로 바뀐다 (긴 책상과 면접관은 그 위에 그대로 올라간다).
 */

/** 어떤 생성 도구에 붙여도 되게 영어로. 구도(지원자 자리에서 본 시점, 가운데 위는 비워 두기)를 공통으로 못 박는다 */
const COMMON =
  'Photorealistic wide-angle photo of an EMPTY interview room in South Korea, taken from the candidate\'s chair at seated eye level, ' +
  'looking straight at the interviewers\' side of the room. No people, no chairs in the foreground. ' +
  'A long table across the lower third of the frame; the wall behind it fills the upper two thirds. ' +
  'Keep the upper-center area of the wall plain and uncluttered. Even indoor lighting, realistic, slightly muted colors, ' +
  'no text, no logos, no watermark, 16:9 landscape, 1792x1024.';

const PRESETS: { id: string; name: string; hint: string; text: string }[] = [
  {
    id: 'public',
    name: '공공기관 · 공기업 면접장',
    hint: '흰 천을 덮은 긴 테이블, 명패, 물컵, 베이지색 벽, 형광등 — 가장 흔한 국내 면접장',
    text:
      'Korean public-sector interview hall: a long table covered with a white tablecloth, small name plates and paper cups of water on it, ' +
      'beige painted wall with a simple wooden wainscot, fluorescent ceiling lights, a small Korean flag on a stand in one corner, ' +
      'a wall clock high on one side, gray carpet floor, formal and slightly austere atmosphere.',
  },
  {
    id: 'corporate',
    name: '대기업 면접실 (회의실)',
    hint: '유리 파티션, 화이트보드나 TV, 회색 카펫, 짙은 목재 테이블',
    text:
      'Modern Korean corporate meeting room used for interviews: dark walnut conference table with two glasses of water, ' +
      'light gray wall with a wall-mounted TV screen turned off to one side, frosted glass partition on the other side, ' +
      'recessed LED ceiling lights, gray carpet, a small potted plant in the corner, clean and professional.',
  },
  {
    id: 'university',
    name: '대학 · 대학원 면접실 (세미나실)',
    hint: '책장, 화이트보드, 창문 블라인드, 나무 책상 — 교수 면접 분위기',
    text:
      'University seminar room in Korea used for graduate admission interviews: plain wooden table with a few paper files, ' +
      'white wall with a whiteboard on one side and a tall bookshelf filled with books on the other, ' +
      'a window with half-closed venetian blinds letting in soft daylight, light wood floor, calm academic atmosphere.',
  },
  {
    id: 'startup',
    name: '스타트업 · IT 회사 면접실',
    hint: '벽돌 또는 밝은 벽, 큰 창, 초록 식물, 캐주얼한 회의 테이블',
    text:
      'Bright startup office meeting room in Seoul: light oak table, white wall with a few framed posters, a large window with a city view ' +
      'and soft daylight, a green plant, a whiteboard with faint erased marks, warm and casual but tidy.',
  },
];

export function BackdropPicker() {
  const [src, setSrc] = useState<string | null>(getBackdrop);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const onChange = () => setSrc(getBackdrop());
    window.addEventListener(BACKDROP_CHANGED, onChange);
    return () => window.removeEventListener(BACKDROP_CHANGED, onChange);
  }, []);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    try {
      await saveBackdrop(file);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const copy = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(id);
      window.setTimeout(() => setCopied(null), 1600);
    } catch {
      /* 클립보드 권한이 없으면 사용자가 직접 선택해 복사 */
    }
  };

  return (
    <div className="backdrop">
      <div className="backdrop__row">
        <div className={`backdrop__preview${src ? '' : ' backdrop__preview--empty'}`}>
          {src ? <img src={src} alt="면접장 배경" /> : <span className="tiny faint">기본 면접실 (그림)</span>}
        </div>
        <div className="stack" style={{ gap: 8, flex: 1, minWidth: 200 }}>
          <div className="switch-row__title">면접장 배경</div>
          <div className="muted tiny">
            실제 면접장 사진이나 아래 프롬프트로 만든 사진을 올리면 면접 화면의 방이 그 사진으로 바뀝니다. 긴 책상과
            면접관은 그 위에 그대로 앉습니다. 사진은 이 브라우저에만 저장됩니다.
          </div>
          <div className="row" style={{ gap: 8 }}>
            <button type="button" className="btn btn--ghost" onClick={() => fileRef.current?.click()}>
              {src ? '배경 바꾸기' : '배경 사진 넣기'}
            </button>
            {src && (
              <button type="button" className="btn btn--ghost" onClick={() => clearBackdrop()}>
                기본으로
              </button>
            )}
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                void onFile(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </div>
          {error && (
            <div className="tiny" style={{ color: 'var(--bad)' }}>
              {error}
            </div>
          )}
        </div>
      </div>

      <button type="button" className="btn btn--ghost" style={{ marginTop: 10 }} onClick={() => setOpen((v) => !v)}>
        {open ? '▾' : '▸'} 실제 면접장처럼 만들기 — 배경 사진 프롬프트
      </button>
      {open && (
        <div className="guide__body">
          <p className="tiny muted" style={{ margin: '0 0 10px' }}>
            실제 국내 면접장 유형을 참고한 프롬프트입니다. 이미지 생성 도구(ChatGPT, Midjourney, Gemini 등)에 붙여 넣어
            만든 뒤 <b>배경 사진 넣기</b>로 올리세요. 사람이 없고, 지원자 자리에서 정면을 본 구도여야 면접관이 자연스럽게
            앉습니다.
          </p>
          <div className="guide__list">
            {PRESETS.map((p) => {
              const text = `${COMMON} ${p.text}`;
              return (
                <div className="guide__item" key={p.id}>
                  <div className="row" style={{ justifyContent: 'space-between' }}>
                    <div>
                      <strong style={{ fontSize: 13 }}>{p.name}</strong>
                      <div className="tiny faint">{p.hint}</div>
                    </div>
                    <button type="button" className="btn btn--ghost pick__photoBtn" onClick={() => void copy(p.id, text)}>
                      {copied === p.id ? '복사됨' : '프롬프트 복사'}
                    </button>
                  </div>
                  <code className="guide__prompt">{text}</code>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
