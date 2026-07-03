import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';

// Captura el evento de instalación lo antes posible (puede dispararse antes de
// que Angular termine de arrancar) y lo guarda para el botón "Instalar app".
(window as any).__deferredInstallPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  (window as any).__deferredInstallPrompt = e;
  window.dispatchEvent(new Event('pwa-installable'));
});
window.addEventListener('appinstalled', () => {
  (window as any).__deferredInstallPrompt = null;
  window.dispatchEvent(new Event('pwa-installed'));
});

bootstrapApplication(App, appConfig)
  .catch((err) => console.error(err));

// Registro del service worker (PWA instalable). Solo en producción/https.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => { /* ignora si no aplica */ });
  });
}
