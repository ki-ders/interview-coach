import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

/**
 * 개발 서버 전용: 페이지가 캔버스 스냅샷을 POST 로 보내면 .preview/ 에 PNG 로 저장한다.
 * 브라우저 스크린샷을 찍을 수 없는 환경에서 렌더링 결과를 눈으로 확인하기 위한 것.
 *   fetch('/__snapshot', { method: 'POST', body: JSON.stringify({ name, dataUrl }) })
 */
function devSnapshot(): Plugin {
  return {
    name: 'dev-snapshot',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__snapshot', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end();
          return;
        }
        let body = '';
        req.on('data', (chunk: Buffer) => {
          body += chunk.toString();
        });
        req.on('end', () => {
          try {
            const { name, dataUrl } = JSON.parse(body) as { name: string; dataUrl: string };
            const b64 = dataUrl.split(',')[1] ?? '';
            const safe = String(name).replace(/[^a-z0-9_-]/gi, '_') || 'snapshot';
            mkdirSync('.preview', { recursive: true });
            writeFileSync(join('.preview', `${safe}.png`), Buffer.from(b64, 'base64'));
            res.end(`ok ${safe}.png`);
          } catch (err) {
            res.statusCode = 400;
            res.end(String(err));
          }
        });
      });
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  // GitHub Pages 는 https://<user>.github.io/<repo>/ 아래에 놓이므로 배포 워크플로가 BASE_PATH 를 넘긴다
  base: process.env.BASE_PATH ?? '/',
  plugins: [react(), devSnapshot()],
});
