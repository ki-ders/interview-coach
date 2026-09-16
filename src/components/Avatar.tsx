import type { Interviewer } from '../types';
import type { AvatarState } from '../interview/useSession';

type HairStyle = Interviewer['look']['hairStyle'];

/** 이마 위 앞머리. 아래 가장자리가 헤어라인이 된다 (얼굴 타원으로 클립) */
const FRINGE: Record<HairStyle, string> = {
  bob: 'M54 20 H166 V82 C150 75 132 72 110 72 C88 72 70 75 54 82 Z',
  short: 'M54 20 H166 V80 C152 66 134 60 110 60 C86 60 68 66 54 80 Z',
  sweptBack: 'M54 20 H166 V74 C150 60 132 50 110 52 C88 54 70 62 54 74 Z',
  buzz: 'M54 20 H166 V78 C150 68 132 64 110 64 C88 64 70 68 54 78 Z',
  partedGray: 'M54 20 H166 V78 C150 64 130 56 104 58 C86 60 68 68 54 78 Z',
};

const tieColor = (who: Interviewer) =>
  who.mood === 'stern' ? '#7f1d1d' : who.mood === 'warm' ? '#1d4ed8' : '#334155';

/**
 * 면접관 한 명의 상반신 (책상 위 소품 제외).
 * 로컬 좌표계는 220 x 300 이고, 호출부에서 translate 로 배치한다.
 */
export function InterviewerFigure({ who, state }: { who: Interviewer; state: AvatarState }) {
  const { look } = who;
  const a = look.browAngle;
  const faceClip = `face-${who.id}`;
  const crownClip = `crown-${who.id}`;
  const isBob = look.hairStyle === 'bob';

  return (
    <g className={`fig fig--${state}`}>
      <defs>
        <clipPath id={faceClip}>
          <ellipse cx="110" cy="95" rx="41" ry="49" />
        </clipPath>
        <clipPath id={crownClip}>
          <rect x="46" y="20" width="128" height="80" />
        </clipPath>
      </defs>

      <g className="fig__body">
        {/* 목 */}
        <rect x="96" y="118" width="28" height="48" rx="11" fill={look.skin} />
        <path d="M96 126 Q110 140 124 126 L124 118 L96 118 Z" fill="rgba(0,0,0,0.13)" />
        {/* 상체 */}
        <path d="M28 236 C32 190 60 168 110 160 C160 168 188 190 192 236 Z" fill={look.suit} />
        {/* 셔츠 깃 */}
        <path d="M92 164 L110 198 L128 164 L119 157 L101 157 Z" fill={look.shirt} />
        {/* 넥타이 */}
        <path d="M110 198 L104 178 L110 172 L116 178 Z" fill={tieColor(who)} />
      </g>

      <g className="fig__head">
        {/* 뒷머리 — 얼굴보다 크게 깔아 볼륨을 준다 */}
        {isBob ? (
          <path
            d="M52 100 C52 58 76 38 110 38 C144 38 168 58 168 100 C168 130 162 148 156 158 C150 148 150 126 150 108 C150 80 134 66 110 66 C86 66 70 80 70 108 C70 126 70 148 64 158 C58 148 52 130 52 100 Z"
            fill={look.hair}
          />
        ) : (
          <g clipPath={`url(#${crownClip})`}>
            <ellipse cx="110" cy="96" rx="46" ry="55" fill={look.hair} />
          </g>
        )}

        {/* 귀 */}
        <ellipse cx="68" cy="100" rx="8" ry="11" fill={look.skin} />
        <ellipse cx="152" cy="100" rx="8" ry="11" fill={look.skin} />

        {/* 얼굴 */}
        <ellipse cx="110" cy="95" rx="41" ry="49" fill={look.skin} />

        {/* 수염 (턱선) */}
        {look.beard && (
          <g clipPath={`url(#${faceClip})`}>
            <path
              d="M78 112 C80 136 94 148 110 148 C126 148 140 136 142 112 C138 132 126 138 110 138 C94 138 82 132 78 112 Z"
              fill={look.hair}
              opacity="0.8"
            />
          </g>
        )}

        {/* 앞머리 */}
        <g clipPath={`url(#${faceClip})`}>
          <path d={FRINGE[look.hairStyle]} fill={look.hair} />
          {look.hairStyle === 'partedGray' && (
            <path d="M100 24 C88 40 78 58 72 76 C82 56 94 44 108 38 Z" fill="#ffffff" opacity="0.2" />
          )}
        </g>

        {/* 눈썹 — 양수 각도면 미간 쪽이 내려가 찌푸린 인상 */}
        <g stroke={look.hair} strokeWidth="3.6" strokeLinecap="round" className="fig__brows">
          <line x1="83" y1={85 - a * 0.3} x2="101" y2={85 + a * 0.3} />
          <line x1="119" y1={85 + a * 0.3} x2="137" y2={85 - a * 0.3} />
        </g>

        {/* 눈 */}
        <g className="fig__eyes">
          <ellipse cx="93" cy="99" rx="8.4" ry="5.8" fill="#ffffff" />
          <circle cx="93" cy="99" r="3.4" fill="#1f2937" />
          <circle cx="94.3" cy="97.7" r="1.1" fill="#ffffff" />
          <ellipse cx="127" cy="99" rx="8.4" ry="5.8" fill="#ffffff" />
          <circle cx="127" cy="99" r="3.4" fill="#1f2937" />
          <circle cx="128.3" cy="97.7" r="1.1" fill="#ffffff" />
          {/* 눈꺼풀 (깜빡임용, 평소에는 접혀 있다) */}
          <g className="fig__lids" fill={look.skin}>
            <rect x="84" y="92" width="18" height="8" rx="4" />
            <rect x="118" y="92" width="18" height="8" rx="4" />
          </g>
        </g>

        {/* 안경 */}
        {look.glasses !== 'none' && (
          <g stroke="#4b5563" strokeWidth="2.2" fill="rgba(148,163,184,0.13)">
            {look.glasses === 'round' ? (
              <>
                <circle cx="93" cy="99" r="12" />
                <circle cx="127" cy="99" r="12" />
              </>
            ) : (
              <>
                <rect x="80" y="90" width="26" height="18" rx="4" />
                <rect x="114" y="90" width="26" height="18" rx="4" />
              </>
            )}
            <line x1="106" y1="99" x2="114" y2="99" />
            <line x1="81" y1="97" x2="70" y2="98" />
            <line x1="139" y1="97" x2="150" y2="98" />
          </g>
        )}

        {/* 코 */}
        <path
          d="M108 108 Q106 116 111 117"
          fill="none"
          stroke="rgba(0,0,0,0.2)"
          strokeWidth="2.2"
          strokeLinecap="round"
        />

        {/* 입 */}
        <g className="fig__mouth">
          {who.mood === 'warm' ? (
            <path d="M99 124 Q110 133 121 124" fill="none" stroke="#a1544a" strokeWidth="3" strokeLinecap="round" />
          ) : who.mood === 'stern' ? (
            <path d="M99 127 Q110 122 121 127" fill="none" stroke="#a1544a" strokeWidth="3" strokeLinecap="round" />
          ) : (
            <line x1="100" y1="125" x2="120" y2="125" stroke="#a1544a" strokeWidth="3" strokeLinecap="round" />
          )}
          <ellipse className="fig__mouthOpen" cx="110" cy="127" rx="7" ry="4.5" fill="#7a3b36" />
        </g>
      </g>

    </g>
  );
}

/** 책상 위 종이와 펜을 쥔 팔. 책상보다 위에 그려야 한다. */
export function InterviewerDeskware({ who, state }: { who: Interviewer; state: AvatarState }) {
  return (
    <g className={`fig fig--${state}`}>
      {/* 종이 */}
      <g className="fig__paper">
        <rect x="118" y="238" width="86" height="56" rx="3" fill="#f8fafc" stroke="#cbd5e1" strokeWidth="1.5" />
        <g stroke="#64748b" strokeWidth="2" strokeLinecap="round" className="fig__notes">
          <line x1="126" y1="250" x2="194" y2="250" />
          <line x1="126" y1="262" x2="186" y2="262" />
          <line x1="126" y1="274" x2="196" y2="274" />
          <line x1="126" y1="286" x2="170" y2="286" />
        </g>
      </g>
      {/* 펜을 쥔 팔 */}
      <g className="fig__arm">
        <path
          d="M172 212 C190 224 186 240 168 258"
          fill="none"
          stroke={who.look.suit}
          strokeWidth="21"
          strokeLinecap="round"
        />
        <g className="fig__hand">
          <ellipse cx="164" cy="262" rx="12" ry="9" fill={who.look.skin} />
          <line x1="170" y1="256" x2="184" y2="238" stroke="#1e293b" strokeWidth="3.4" strokeLinecap="round" />
        </g>
      </g>
    </g>
  );
}


/** 설정 화면 카드용 — 머리와 어깨만 보이는 작은 초상 */
export function InterviewerBust({ who }: { who: Interviewer }) {
  return (
    <svg
      viewBox="48 28 144 148"
      className="bust"
      role="img"
      aria-label={`${who.name} 교수 초상`}
    >
      <InterviewerFigure who={who} state="idle" />
    </svg>
  );
}

/** 사진이 없을 때 타일 안에 넣는 벡터 인물 (책상·종이·펜 포함) */
export function VectorTile({ who, state }: { who: Interviewer; state: AvatarState }) {
  return (
    <svg viewBox="0 0 220 300" className="tile__vector" role="img" aria-label={`${who.name} 면접관`}>
      <rect x="0" y="0" width="220" height="300" className="room__wall" />
      <InterviewerFigure who={who} state={state} />
      <rect x="0" y="232" width="220" height="68" className="room__desk" />
      <rect x="0" y="228" width="220" height="6" className="room__deskEdge" />
      <InterviewerDeskware who={who} state={state} />
    </svg>
  );
}
