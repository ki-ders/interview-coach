import type { Interviewer } from '../types';

/**
 * 전원 가상 인물입니다. 실존 인물과 관련이 없습니다.
 */
export const INTERVIEWERS: Interviewer[] = [
  {
    id: 'seo',
    name: '서지우',
    title: '교수 · 중립형',
    blurb: '차분하고 공정합니다. 감정을 드러내지 않고 답변의 구조를 봅니다.',
    mood: 'neutral',
    look: {
      skin: '#f0cdb4',
      hair: '#2f2a2a',
      hairStyle: 'bob',
      suit: '#4b5563',
      shirt: '#f8fafc',
      glasses: 'none',
      browAngle: 0,
      beard: false,
    },
    voice: { pitch: 1.12, rate: 1.0, preferFemale: true },
    strictness: 1.0,
    lines: {
      greeting: [
        '안녕하세요. 오늘 면접을 맡은 서지우입니다. 편하게 앉으시고, 준비되면 시작하겠습니다.',
        '반갑습니다. 서지우입니다. 긴장하지 마시고 평소처럼 답변해 주세요.',
      ],
      ack: ['네, 잘 들었습니다.', '알겠습니다. 기록해 두겠습니다.', '네, 확인했습니다.'],
      pressForDetail: [
        '조금 더 구체적으로 설명해 주시겠어요?',
        '방금 말씀하신 부분을 한 단계만 더 풀어서 말씀해 주세요.',
      ],
      pressForExample: [
        '실제 경험한 사례를 하나만 들어주시겠어요?',
        '구체적인 상황과 본인의 역할을 함께 말씀해 주세요.',
      ],
      offTopic: [
        '질문의 초점은 조금 다릅니다. 그 부분을 중심으로 다시 말씀해 주시겠어요?',
        '제가 여쭌 내용과 조금 떨어져 있는 것 같습니다. 다시 정리해 주세요.',
      ],
      tooShort: ['답변이 짧습니다. 조금 더 말씀해 주세요.', '그게 전부인가요? 보충해 주세요.'],
      silence: ['천천히 생각하셔도 됩니다. 준비되면 말씀해 주세요.', '편하게 시작하셔도 좋습니다.'],
      closing: ['오늘 면접은 여기까지입니다. 수고하셨습니다.', '질문은 여기서 마치겠습니다. 고생하셨습니다.'],
    },
  },
  {
    id: 'han',
    name: '한도윤',
    title: '교수 · 온화형',
    blurb: '잘 웃고 자주 끄덕입니다. 긴장을 풀어주는 스타일입니다.',
    mood: 'warm',
    look: {
      skin: '#f3d3b5',
      hair: '#3b2f2a',
      hairStyle: 'short',
      suit: '#3f6f5f',
      shirt: '#ffffff',
      glasses: 'round',
      browAngle: -9,
      beard: false,
    },
    voice: { pitch: 0.92, rate: 0.92, preferFemale: false },
    strictness: 0.85,
    lines: {
      greeting: [
        '어서 오세요, 반갑습니다. 한도윤입니다. 너무 긴장하지 마시고 편하게 해주세요.',
        '안녕하세요. 한도윤입니다. 오늘 좋은 이야기 많이 들려주세요.',
      ],
      ack: ['네, 좋습니다.', '아, 그렇군요. 잘 들었습니다.', '고맙습니다. 잘 이해했습니다.'],
      pressForDetail: [
        '조금만 더 자세히 들려주실 수 있을까요?',
        '흥미롭네요. 그 부분을 조금 더 말씀해 주시겠어요?',
      ],
      pressForExample: [
        '괜찮으시면 실제 있었던 일로 예를 하나 들어주시겠어요?',
        '경험하신 사례가 있다면 편하게 말씀해 주세요.',
      ],
      offTopic: [
        '아, 제 질문이 조금 모호했을 수도 있겠네요. 이 부분에 초점을 맞춰 다시 말씀해 주시겠어요?',
        '조금 다른 이야기로 간 것 같아요. 질문으로 돌아와 볼까요?',
      ],
      tooShort: ['조금 더 들려주셔도 좋습니다.', '시간 충분하니 더 말씀하셔도 됩니다.'],
      silence: ['괜찮습니다, 천천히 하세요.', '편하게 생각 정리하시고 말씀해 주세요.'],
      closing: ['오늘 이야기 잘 들었습니다. 정말 수고 많으셨어요.', '여기까지 하겠습니다. 고생하셨습니다.'],
    },
  },
  {
    id: 'moon',
    name: '문재호',
    title: '교수 · 온화형',
    blurb: '푸근한 인상의 선배 같은 면접관. 부드럽게 물고 늘어집니다.',
    mood: 'warm',
    look: {
      skin: '#e8c19a',
      hair: '#5a5350',
      hairStyle: 'partedGray',
      suit: '#5b4a6f',
      shirt: '#f1f5f9',
      glasses: 'rect',
      browAngle: -6,
      beard: true,
    },
    voice: { pitch: 0.78, rate: 0.88, preferFemale: false },
    strictness: 0.9,
    lines: {
      greeting: [
        '반갑습니다. 문재호라고 합니다. 부담 갖지 말고 편하게 이야기해 봅시다.',
        '안녕하세요. 문재호입니다. 오늘 차분히 한번 들어보겠습니다.',
      ],
      ack: ['음, 좋습니다.', '네, 그런 관점도 있겠네요.', '잘 들었습니다.'],
      pressForDetail: ['조금만 더 파고들어 볼까요?', '그 부분이 궁금한데, 더 설명해 주시겠어요?'],
      pressForExample: [
        '실제로 그렇게 해본 적이 있나요? 그때 이야기를 들려주세요.',
        '경험담으로 한번 풀어주시면 좋겠습니다.',
      ],
      offTopic: [
        '음, 제가 물은 건 그게 아니었는데요. 다시 한번 정리해 주시겠어요?',
        '질문으로 돌아가 봅시다. 그 부분을 어떻게 보시나요?',
      ],
      tooShort: ['그것만으로는 부족합니다. 조금 더 말씀해 주세요.', '더 하실 말씀 없으신가요?'],
      silence: ['괜찮습니다. 생각 정리되면 말씀해 주세요.', '서두르지 않아도 됩니다.'],
      closing: ['오늘 수고 많으셨습니다.', '여기까지 하죠. 고생하셨어요.'],
    },
  },
  {
    id: 'kang',
    name: '강태식',
    title: '교수 · 압박형',
    blurb: '표정 변화가 거의 없습니다. 근거가 약하면 바로 파고듭니다.',
    mood: 'stern',
    look: {
      skin: '#e3bd98',
      hair: '#1f2937',
      hairStyle: 'sweptBack',
      suit: '#1f2937',
      shirt: '#e2e8f0',
      glasses: 'rect',
      browAngle: 13,
      beard: false,
    },
    voice: { pitch: 0.72, rate: 1.08, preferFemale: false },
    strictness: 1.25,
    lines: {
      greeting: [
        '강태식입니다. 바로 시작하겠습니다.',
        '앉으세요. 강태식입니다. 시간 많지 않으니 요점만 말씀해 주세요.',
      ],
      ack: ['음.', '그렇군요.', '적어두겠습니다.'],
      pressForDetail: [
        '근거가 뭡니까? 구체적으로 말씀해 주세요.',
        '지금 말씀은 추상적입니다. 다시 설명해 보세요.',
      ],
      pressForExample: [
        '실제로 해본 겁니까? 사례를 대보세요.',
        '말씀만으로는 확인이 안 됩니다. 구체적 사례를 주세요.',
      ],
      offTopic: [
        '제 질문에 답하지 않으셨습니다. 다시 답변하세요.',
        '질문을 다시 읽어드릴까요? 초점이 완전히 다릅니다.',
      ],
      tooShort: ['그게 답의 전부입니까?', '너무 짧습니다. 다시 답변해 보세요.'],
      silence: ['시작하셔도 됩니다.', '답변 부탁드립니다.'],
      closing: ['여기까지 하겠습니다.', '끝내겠습니다. 나가보셔도 됩니다.'],
    },
  },
  {
    id: 'oh',
    name: '오현중',
    title: '교수 · 냉정형',
    blurb: '메모를 많이 합니다. 논리적 허점을 조용히 짚습니다.',
    mood: 'stern',
    look: {
      skin: '#efcaa8',
      hair: '#111827',
      hairStyle: 'buzz',
      suit: '#334155',
      shirt: '#cbd5f5',
      glasses: 'none',
      browAngle: 10,
      beard: false,
    },
    voice: { pitch: 0.84, rate: 0.97, preferFemale: false },
    strictness: 1.15,
    lines: {
      greeting: ['오현중입니다. 질문 드리겠습니다.', '오현중입니다. 준비되셨으면 시작하죠.'],
      ack: ['확인했습니다.', '기록하겠습니다.', '네.'],
      pressForDetail: [
        '논리가 연결되지 않습니다. 다시 설명해 주시겠습니까?',
        '그 결론이 나온 과정을 설명해 주세요.',
      ],
      pressForExample: ['수치나 사례로 뒷받침해 주세요.', '검증 가능한 예시를 들어주세요.'],
      offTopic: ['질문과 답이 어긋납니다.', '방금 답변은 제 질문과 무관합니다. 다시 해주세요.'],
      tooShort: ['내용이 부족합니다.', '더 말씀하실 게 없습니까?'],
      silence: ['답변 기다리고 있습니다.', '시작하세요.'],
      closing: ['면접을 마치겠습니다.', '이상입니다. 수고하셨습니다.'],
    },
  },
];

export const getInterviewer = (id: string): Interviewer =>
  INTERVIEWERS.find((i) => i.id === id) ?? INTERVIEWERS[0];
