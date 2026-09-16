/**
 * 측정 루프 드라이버.
 * 보일 때는 requestAnimationFrame 으로 화면 주사율에 맞춰 돌고, 탭이 가려지면 rAF 가 멈추므로
 * Web Worker 의 타이머(백그라운드에서도 느려지지 않는다)로 같은 콜백을 계속 부른다.
 * 카메라 프레임은 탭이 가려져도 계속 들어오기 때문에 면접 중 잠깐 다른 창을 봐도 측정이 끊기지 않는다.
 */

const WORKER_SRC = 'setInterval(function(){postMessage(0)},33)';

function makeWorker(): Worker | null {
  try {
    const url = URL.createObjectURL(new Blob([WORKER_SRC], { type: 'text/javascript' }));
    const w = new Worker(url);
    URL.revokeObjectURL(url);
    return w;
  } catch {
    return null;
  }
}

export function startTicker(cb: () => void): () => void {
  let stopped = false;
  let raf = 0;
  const worker = makeWorker();

  const loop = () => {
    if (stopped) return;
    raf = requestAnimationFrame(loop);
    if (!document.hidden) cb();
  };
  raf = requestAnimationFrame(loop);

  if (worker) {
    worker.onmessage = () => {
      if (!stopped && document.hidden) cb();
    };
  }

  return () => {
    stopped = true;
    cancelAnimationFrame(raf);
    worker?.terminate();
  };
}
