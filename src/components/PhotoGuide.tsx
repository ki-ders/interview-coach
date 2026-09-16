import { useState } from 'react';
import { INTERVIEWERS } from '../data/interviewers';

/**
 * 면접관별 사진 생성 프롬프트. 어떤 이미지 생성 도구에 붙여 넣어도 되게 영어로 쓰고,
 * 얼굴 메시 추출과 애니메이션이 잘 되는 조건(정면·무표정·입 다물기·단색 배경)을 공통으로 넣는다.
 */
const COMMON =
  'Photorealistic head-and-shoulders portrait photo of a fictional Korean university professor, ' +
  'looking straight at the camera, neutral expression, mouth closed, eyes open, even soft studio lighting, ' +
  'plain light gray background, sharp focus, 85mm lens, no text, no watermark, square 1024x1024.';

const PER_PERSON: Record<string, string> = {
  seo: 'Woman in her early 40s, shoulder-length dark bob haircut, calm and composed, dark gray blazer over a white blouse.',
  han: 'Man in his late 40s, short neat dark hair, warm gentle face, round glasses, dark green cardigan over a white shirt.',
  moon: 'Man in his late 50s, gray side-parted hair, short well-trimmed gray beard that does not cover the lips, rectangular glasses, purple-gray jacket.',
  kang: 'Man in his early 50s, dark hair swept back, sharp angular features, thin rectangular glasses, stern serious expression, charcoal suit with a dark red tie.',
  oh: 'Man in his mid 40s, very short buzz-cut dark hair, no glasses, cool detached expression, slate-blue suit with a light blue shirt.',
};

export function PhotoGuide() {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

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
    <div className="guide">
      <button type="button" className="btn btn--ghost" onClick={() => setOpen((v) => !v)}>
        {open ? '▾' : '▸'} 실제 사람처럼 보이게 하기 — 사진 만드는 법
      </button>
      {open && (
        <div className="guide__body">
          <p className="tiny muted" style={{ margin: '0 0 10px' }}>
            아래 문장을 이미지 생성 도구(ChatGPT, Midjourney, Gemini 등)에 붙여 넣어 사진을 만들고, 각 카드의
            <b> 사진 넣기</b>로 올리세요. 정면·무표정·입을 다문 사진이 가장 자연스럽게 움직입니다. 만들어진 사진은
            이 브라우저에만 저장됩니다.
          </p>
          <div className="guide__list">
            {INTERVIEWERS.map((who) => {
              const text = `${COMMON} ${PER_PERSON[who.id] ?? ''}`;
              return (
                <div className="guide__item" key={who.id}>
                  <div className="row" style={{ justifyContent: 'space-between' }}>
                    <strong style={{ fontSize: 13 }}>{who.name} 교수</strong>
                    <button type="button" className="btn btn--ghost pick__photoBtn" onClick={() => void copy(who.id, text)}>
                      {copied === who.id ? '복사됨' : '프롬프트 복사'}
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
