// Som discreto de mensagem nova: dois toques curtos gerados na hora (sem arquivo de áudio).
let ctx: AudioContext | null = null;
let lastAt = 0;

/** o navegador só libera áudio depois de um gesto: prepara o contexto no primeiro clique/tecla */
export function unlockAudioOnFirstGesture(): () => void {
  const unlock = () => {
    try {
      ctx ??= new AudioContext();
      if (ctx.state === 'suspended') void ctx.resume();
    } catch {
      // sem Web Audio: segue sem som
    }
  };
  document.addEventListener('pointerdown', unlock, { once: true });
  document.addEventListener('keydown', unlock, { once: true });
  return () => {
    document.removeEventListener('pointerdown', unlock);
    document.removeEventListener('keydown', unlock);
  };
}

export function playChime(): void {
  const now = Date.now();
  // rajada de mensagens = um toque só
  if (now - lastAt < 1500) return;
  lastAt = now;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    const t0 = ctx.currentTime;
    [660, 880].forEach((freq, i) => {
      const osc = ctx!.createOscillator();
      const gain = ctx!.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const start = t0 + i * 0.12;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.05, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.18);
      osc.connect(gain).connect(ctx!.destination);
      osc.start(start);
      osc.stop(start + 0.2);
    });
  } catch {
    // navegador sem áudio liberado ainda: fica só o título da aba
  }
}
