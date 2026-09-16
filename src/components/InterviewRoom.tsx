import type { Interviewer } from '../types';
import type { AvatarState } from '../interview/useSession';
import { PhotoFace } from '../face/PhotoFace';
import { VectorTile } from './Avatar';

interface Props {
  pair: [Interviewer, Interviewer];
  states: Record<string, AvatarState>;
  speakingId?: string;
}

const STATE_LABEL: Record<AvatarState, string> = {
  idle: '',
  speaking: '질문 중',
  listening: '듣는 중',
  writing: '메모 중',
  nodding: '듣는 중',
};

/** 두 면접관 — 화상 면접처럼 타일 두 개로 보인다 */
export function InterviewRoom({ pair, states, speakingId }: Props) {
  return (
    <div className="room__tiles">
      {pair.map((who) => (
        <InterviewerTile key={who.id} who={who} state={states[who.id] ?? 'idle'} active={speakingId === who.id} />
      ))}
    </div>
  );
}

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
        {state === 'writing' && (
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
        )}
      </div>
      <div className={`plate${active ? ' plate--active' : ''}`}>
        <span className="plate__name">{who.name} 교수</span>
        <span className="plate__role">{who.title}</span>
        {STATE_LABEL[state] && <span className="plate__tag">{STATE_LABEL[state]}</span>}
      </div>
    </div>
  );
}
