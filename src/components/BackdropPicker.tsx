import { useEffect, useRef, useState } from 'react';
import { BACKDROP_CHANGED, clearBackdrop, getBackdrop, hasCustomBackdrop, saveBackdrop } from '../face/photoStore';

/**
 * 면접장 배경 사진. 앱에 기본 면접장(세미나실)이 들어 있고, 원하면 다른 사진으로 바꿀 수 있다.
 * 긴 책상과 면접관은 사진 위에 그대로 올라간다.
 */
export function BackdropPicker() {
  const [src, setSrc] = useState<string>(getBackdrop);
  const [custom, setCustom] = useState<boolean>(hasCustomBackdrop);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const onChange = () => {
      setSrc(getBackdrop());
      setCustom(hasCustomBackdrop());
    };
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

  return (
    <div className="backdrop">
      <div className="backdrop__row">
        <div className="backdrop__preview">
          <img src={src} alt="면접장 배경" />
        </div>
        <div className="stack" style={{ gap: 8, flex: 1, minWidth: 200 }}>
          <div className="switch-row__title">면접장 배경</div>
          <div className="muted tiny">
            {custom
              ? '내가 올린 사진을 쓰고 있습니다. 긴 책상과 면접관은 그 위에 그대로 앉습니다.'
              : '기본 면접장(세미나실)입니다. 실제 면접장 사진이 있으면 바꿀 수 있습니다. 사진은 이 브라우저에만 저장됩니다.'}
          </div>
          <div className="row" style={{ gap: 8 }}>
            <button type="button" className="btn btn--ghost" onClick={() => fileRef.current?.click()}>
              배경 바꾸기
            </button>
            {custom && (
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
    </div>
  );
}
