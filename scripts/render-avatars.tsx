/**
 * 개발용 확인 스크립트.
 * 면접장 장면과 설정 화면 초상을 정적 PNG 로 뽑아 눈으로 검수한다.
 *   npx vite-node scripts/render-avatars.tsx
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { Resvg } from '@resvg/resvg-js';
import { InterviewerBust } from '../src/components/Avatar';
import { InterviewRoom } from '../src/components/InterviewRoom';
import { INTERVIEWERS, getInterviewer } from '../src/data/interviewers';
import type { AvatarState } from '../src/interview/useSession';
import type { Interviewer } from '../src/types';

const TOKENS = {
  light: {
    bg: '#f6f7f9',
    surface: '#ffffff',
    surface2: '#f1f3f6',
    surface3: '#e7eaf0',
    border: '#dfe3ea',
    borderStrong: '#c7ccd6',
    text: '#16191f',
    faint: '#8b93a1',
    desk: '#cbbda9',
    deskEdge: '#a08a6e',
  },
  dark: {
    bg: '#0e1116',
    surface: '#171b22',
    surface2: '#1e232c',
    surface3: '#272d38',
    border: '#2a303b',
    borderStrong: '#3a4250',
    text: '#e8ebf0',
    faint: '#737d8f',
    desk: '#3f3527',
    deskEdge: '#5b4a35',
  },
};

type Theme = keyof typeof TOKENS;

function headPose(state: AvatarState): string {
  if (state === 'writing') return 'translate(0,5) rotate(7, 110, 144)';
  if (state === 'nodding') return 'translate(0,5) rotate(3.2, 110, 144)';
  if (state === 'listening') return 'rotate(-2.8, 110, 144)';
  return '';
}

/**
 * CSS 변수/클래스로 결정되는 값을 정적 SVG 속성으로 치환한다.
 * 각 <g class="fig fig--상태"> 청크 안의 head/hand/mouth 는 그 그룹의 것이므로
 * 청크 단위로 대표 프레임(애니메이션의 한 순간)을 심는다.
 */
function inlineCss(svg: string, theme: Theme): string {
  const c = TOKENS[theme];
  const base = svg
    .replace(/class="room__wall"/g, `fill="${c.surface2}"`)
    .replace(/class="room__desk"/g, `fill="${c.desk}"`)
    .replace(/class="room__deskEdge"/g, `fill="${c.deskEdge}"`)
    .replace(/<g class="room__clock">/g, `<g stroke="${c.borderStrong}" stroke-width="2.4" fill="${c.surface}">`)
    .replace(/class="room__clockPin"/g, `fill="${c.faint}" stroke="none"`)
    .replace(/var\(--surface-2\)/g, c.surface2)
    .replace(/var\(--surface-3\)/g, c.surface3)
    .replace(/var\(--surface\)/g, c.surface)
    .replace(/var\(--border\)/g, c.border);

  const chunks = base.split(/(?=<g class="fig fig--\w+">)/);
  return chunks
    .map((chunk) => {
      const m = chunk.match(/^<g class="fig fig--(\w+)">/);
      if (!m) return chunk;
      const state = m[1] as AvatarState;
      const head = headPose(state);
      return chunk
        .replace(/^<g class="fig fig--\w+">/, '<g>')
        .replace(/class="fig__head"/, head ? `transform="${head}"` : '')
        .replace(
          /class="fig__hand"/,
          state === 'writing' ? 'transform="translate(10,-1) rotate(3, 164, 262)"' : '',
        )
        .replace(/class="fig__mouthOpen"/, state === 'speaking' ? '' : 'opacity="0"')
        .replace(/class="fig__notes"/, `opacity="${state === 'writing' ? 0.55 : 0.25}"`)
        .replace(/<g class="fig__lids"[\s\S]*?<\/g>/, '');
    })
    .join('')
    .replace(/class="[^"]*"/g, '');
}

/** 방(타일 두 개)의 벡터 폴백 svg 를 뽑아 하나의 svg 로 나열한다 */
function scene(pair: [Interviewer, Interviewer], states: Record<string, AvatarState>, theme: Theme) {
  const speakingId = Object.entries(states).find(([, s]) => s === 'speaking')?.[0];
  const markup = renderToStaticMarkup(InterviewRoom({ pair, states, speakingId }));
  const svgs = markup.match(/<svg[^>]*class="tile__vector"[\s\S]*?<\/svg>/g) ?? [];
  const inner = svgs
    .map((svg, i) => {
      const body = inlineCss(svg, theme)
        .replace(/^<svg[^>]*>/, '')
        .replace(/<\/svg>$/, '');
      return `<g transform="translate(${i * 270}, 0)"><g transform="scale(1.1)">${body}</g></g>`;
    })
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 520 330">${inner}</svg>`;
}

const outDir = new URL('../.preview/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
mkdirSync(outDir, { recursive: true });

for (const theme of ['light', 'dark'] as Theme[]) {
  const c = TOKENS[theme];
  const rows: { label: string; states: Record<string, AvatarState> }[] = [
    { label: '강태식 질문 중 / 서지우 메모', states: { kang: 'speaking', seo: 'writing' } },
    { label: '둘 다 듣는 중', states: { kang: 'listening', seo: 'listening' } },
    { label: '끄덕임 + 메모', states: { kang: 'nodding', seo: 'writing' } },
  ];
  const W = 560;
  const H = 360;
  let body = '';
  rows.forEach((row, i) => {
    const pair: [Interviewer, Interviewer] = [getInterviewer('kang'), getInterviewer('seo')];
    const inner = scene(pair, row.states, theme)
      .replace(/^<svg[^>]*>/, '')
      .replace(/<\/svg>$/, '');
    body += `<g transform="translate(0, ${i * H})">
      <rect x="8" y="8" width="${W - 16}" height="${H - 16}" rx="12" fill="${c.surface}" stroke="${c.border}"/>
      <g transform="translate(20, 22) scale(${(W - 40) / 520})">${inner}</g>
      <text x="${W / 2}" y="${H - 14}" text-anchor="middle" font-size="14" font-family="sans-serif" fill="${c.text}">${row.label}</text>
    </g>`;
  });

  const busts = INTERVIEWERS.map((who, i) => {
    const markup = renderToStaticMarkup(InterviewerBust({ who }));
    const inner = inlineCss(markup, theme)
      .replace(/^<svg[^>]*>/, '')
      .replace(/<\/svg>$/, '');
    return `<g transform="translate(${i * 112 + 6}, ${rows.length * H + 16})">
      <rect x="0" y="0" width="104" height="124" rx="10" fill="${c.surface}" stroke="${c.border}"/>
      <svg x="6" y="6" width="92" height="94" viewBox="48 28 144 148">${inner}</svg>
      <text x="52" y="116" text-anchor="middle" font-size="12" font-family="sans-serif" fill="${c.text}">${who.name}</text>
    </g>`;
  }).join('');

  const totalH = rows.length * H + 152;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${totalH}" viewBox="0 0 ${W} ${totalH}"><rect width="${W}" height="${totalH}" fill="${c.bg}"/>${body}${busts}</svg>`;
  writeFileSync(`${outDir}room-${theme}.svg`, svg);
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: 720 } }).render().asPng();
  writeFileSync(`${outDir}room-${theme}.png`, png);
  console.log(`wrote room-${theme}.png (${(png.length / 1024).toFixed(0)}KB)`);
}
