import { useEffect, useState } from 'react';
import { getInterviewer } from '../data/interviewers';
import { getVoiceOverrides, koreanVoices, loadVoices, pickVoice, setVoiceOverride } from '../audio/tts';

/**
 * 면접관 목소리 고르기. 기기에 깔린 한국어 음성 중에서 면접관마다 하나씩 배정한다.
 * 음성이 하나뿐인 기기(아이패드 기본)에서는 더 내려받는 법을 안내한다.
 */
export function VoicePicker({ picked }: { picked: string[] }) {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>(koreanVoices);
  const [overrides, setOverrides] = useState<Record<string, string>>(getVoiceOverrides);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    void loadVoices().then(() => {
      if (alive) setVoices(koreanVoices());
    });
    return () => {
      alive = false;
    };
  }, []);

  const isIOS = /iPad|iPhone|Macintosh/.test(navigator.userAgent) && 'ontouchend' in document;
  const isAndroid = /Android/.test(navigator.userAgent);

  const preview = (id: string) => {
    if (typeof speechSynthesis === 'undefined') return;
    const who = getInterviewer(id);
    const u = new SpeechSynthesisUtterance(`안녕하세요. ${who.name}입니다. 준비되셨으면 시작하겠습니다.`);
    u.lang = 'ko-KR';
    u.pitch = who.voice.pitch;
    u.rate = who.voice.rate;
    const chosen = overrides[id];
    const forced = chosen ? voices.find((v) => v.voiceURI === chosen) : undefined;
    const pick = forced ? { voice: forced, genderMatched: true } : pickVoice(voices, who.voice.preferFemale);
    if (pick.voice) u.voice = pick.voice;
    if (!pick.genderMatched) u.pitch = who.voice.preferFemale ? who.voice.pitch + 0.05 : Math.max(0.55, who.voice.pitch - 0.18);
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  };

  const choose = (id: string, uri: string) => {
    setVoiceOverride(id, uri || null);
    setOverrides(getVoiceOverrides());
  };

  const few = voices.length <= 1;

  return (
    <div className="voicepick">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div className="switch-row__title">면접관 목소리</div>
          <div className="muted tiny">
            이 기기에 한국어 음성이 <b>{voices.length}개</b> 있습니다.{' '}
            {few
              ? '하나뿐이라 두 면접관이 같은 목소리로 들립니다 (음높이·속도만 다르게 냅니다). 아래 안내대로 음성을 더 내려받으면 성별·목소리가 달라집니다.'
              : '면접관마다 다른 음성을 자동으로 배정하며, 직접 고를 수도 있습니다.'}
          </div>
        </div>
        <button type="button" className="btn btn--ghost" onClick={() => setOpen((v) => !v)}>
          {open ? '▾ 접기' : '▸ 목소리 고르기'}
        </button>
      </div>

      {open && (
        <div className="stack" style={{ gap: 10, marginTop: 10 }}>
          {picked.map((id) => {
            const who = getInterviewer(id);
            const auto = pickVoice(voices, who.voice.preferFemale);
            return (
              <div className="row" key={id} style={{ gap: 8, flexWrap: 'wrap' }}>
                <span style={{ minWidth: 92, fontSize: 13.5 }}>
                  <b>{who.name}</b> <span className="faint tiny">{who.voice.preferFemale ? '여성' : '남성'}</span>
                </span>
                <select
                  className="input"
                  style={{ flex: 1, minWidth: 180 }}
                  value={overrides[id] ?? ''}
                  onChange={(e) => choose(id, e.target.value)}
                >
                  <option value="">자동 ({auto.voice ? auto.voice.name : '한국어 음성 없음'})</option>
                  {voices.map((v) => (
                    <option key={v.voiceURI} value={v.voiceURI}>
                      {v.name}
                      {v.localService ? '' : ' (온라인)'}
                    </option>
                  ))}
                </select>
                <button type="button" className="btn btn--ghost" onClick={() => preview(id)}>
                  미리 듣기
                </button>
              </div>
            );
          })}

          <div className="muted tiny" style={{ lineHeight: 1.7 }}>
            <b>음성 더 내려받기</b>
            <br />
            {isIOS && (
              <>
                아이패드·아이폰: 설정 → 손쉬운 사용 → 콘텐츠 말하기 → 음성 → 한국어 에서 <b>Suhyun, Jian, Minsu(남성), Yuna(향상됨)</b> 등을
                내려받은 뒤 이 페이지를 새로고침하세요.
                <br />
              </>
            )}
            {isAndroid && (
              <>
                안드로이드: 설정 → 일반 → 텍스트 음성 변환(TTS) → Google 음성 서비스 → 한국어 음성 데이터를 설치한 뒤 새로고침하세요.
                <br />
              </>
            )}
            {!isIOS && !isAndroid && (
              <>
                Windows: 설정 → 시간 및 언어 → 음성 → 음성 추가 에서 한국어를 설치하면 Heami(여)·InJoon(남) 이 생깁니다. Edge 에서는 온라인 음성
                (SunHi·InJoon·Hyunsu 등)도 바로 쓸 수 있습니다.
                <br />
              </>
            )}
            음성은 기기가 내는 것이라 앱이 만들어 넣을 수는 없습니다.
          </div>
        </div>
      )}
    </div>
  );
}
