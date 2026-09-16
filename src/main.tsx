import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import App from './App.tsx';

async function boot() {
  const simId = new URLSearchParams(location.search).get('sim');
  // 카메라 없이 전체 흐름을 돌리는 시뮬레이션 모드 (?sim=basic). 필요할 때만 내려받는다.
  const sim = simId ? (await import('./sim')).createSim(simId) : undefined;
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App sim={sim} />
    </StrictMode>,
  );
}

void boot();
