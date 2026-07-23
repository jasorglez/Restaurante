import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, signal } from '@angular/core';

/**
 * Detecta si un error de HttpClient nunca llegó a tocar el servidor (red caída,
 * DNS, CORS) vs. un error real del backend (4xx/5xx). Con `provideHttpClient(withFetch())`
 * un fetch que no completa se traduce en `HttpErrorResponse` con `status: 0`.
 */
export function esErrorDeRed(err: unknown): boolean {
  return err instanceof HttpErrorResponse && err.status === 0;
}

/**
 * Estado de conectividad (transversal): lo consumen los dominios que necesitan
 * reintentar cuando vuelve la red (ej. CuentaService para su cola de pendientes).
 */
@Injectable({ providedIn: 'root' })
export class ConnectivityService {
  readonly online = signal(navigator.onLine);

  constructor() {
    window.addEventListener('online', () => this.online.set(true));
    window.addEventListener('offline', () => this.online.set(false));
  }
}
