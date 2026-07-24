import { Component, signal } from '@angular/core';

/**
 * Botón + modal de ayuda para instalar la PWA. Totalmente autocontenido (no
 * depende de companyId/usuario/view de App) — escucha el evento nativo
 * `beforeinstallprompt` (capturado en index.html/main.ts como
 * `window.__deferredInstallPrompt`) y los eventos custom `pwa-installable` /
 * `pwa-installed` que dispara ese mismo bootstrap.
 */
@Component({
  selector: 'app-pwa-install',
  templateUrl: './pwa-install.html',
  styleUrl: './pwa-install.scss',
})
export class PwaInstall {
  protected readonly appStandalone = signal(false);
  protected readonly puedeInstalar = signal(false);
  protected readonly mostrarAyudaInstalar = signal(false);

  constructor() {
    const yaInstalada = window.matchMedia?.('(display-mode: standalone)').matches
      || (navigator as any).standalone === true;
    this.appStandalone.set(!!yaInstalada);
    if (!yaInstalada) {
      if ((window as any).__deferredInstallPrompt) this.puedeInstalar.set(true);
      window.addEventListener('pwa-installable', () => this.puedeInstalar.set(true));
      window.addEventListener('pwa-installed',   () => { this.puedeInstalar.set(false); this.appStandalone.set(true); });
    }
  }

  protected async instalarApp(): Promise<void> {
    const p = (window as any).__deferredInstallPrompt;
    if (!p) {
      // El navegador no ofreció el evento (ej. Samsung Internet o ya instalada):
      // guiar al usuario al menú del navegador.
      this.mostrarAyudaInstalar.set(true);
      return;
    }
    p.prompt();
    try { await p.userChoice; } catch { /* cancelado */ }
    (window as any).__deferredInstallPrompt = null;
    this.puedeInstalar.set(false);
  }
}
