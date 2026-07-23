/**
 * Suena una campana (ding-ding) para avisos entre cocina/mesero/caja. Usa la
 * Web Audio API; si no está disponible (o el navegador la bloquea) no hace nada.
 * Antes era un método privado de App; se extrajo para compartirlo entre el
 * componente de Mesas (avisos cocina→mesero y caja→mesero) y App (mesero→caja).
 */
export function sonarCampana(): void {
  try {
    const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const beep = (inicio: number, freq: number) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.connect(g); g.connect(ctx.destination);
      o.type = 'sine'; o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, ctx.currentTime + inicio);
      g.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + inicio + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + inicio + 0.35);
      o.start(ctx.currentTime + inicio);
      o.stop(ctx.currentTime + inicio + 0.37);
    };
    beep(0, 988); beep(0.22, 1319);   // ding-ding
    setTimeout(() => { try { ctx.close(); } catch { /* noop */ } }, 800);
  } catch { /* audio no disponible */ }
}
