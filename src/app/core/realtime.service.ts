import { Injectable, signal } from '@angular/core';
import * as signalR from '@microsoft/signalr';
import { environment } from '../../environments/environment';

export interface OrdenListaEvent { idCompany: number; idCuenta: number; }
export interface MesaPorCobrarEvent { idCompany: number; idCuenta: number; valor: boolean; }
export interface MesaCobradaEvent { idCompany: number; idCuenta: number; }

/**
 * Cliente SignalR del StorageHub (microservicio ChatBot/telegram) — avisa en
 * tiempo real cuando cocina marca un platillo listo, el mesero envía/cancela
 * una mesa a cobrar, o caja termina de cobrar. El polling existente (cada
 * 15-20s en cada dominio) sigue siendo el respaldo si el socket no conecta o
 * se cae; esto solo adelanta el refresco a "al instante" cuando sí funciona.
 */
@Injectable({ providedIn: 'root' })
export class RealtimeService {
  private connection: signalR.HubConnection | null = null;
  readonly conectado = signal(false);
  /** true cuando el socket falló al conectar/se cayó — para mostrar un aviso visible sin esperar a que el usuario abra el panel. */
  readonly error = signal(false);

  /** Últimas líneas de diagnóstico (más nueva primero) — panel visible en la app, sin depender de DevTools. */
  readonly log = signal<string[]>([]);

  readonly ultimaOrdenLista = signal<OrdenListaEvent | null>(null);
  readonly ultimaPorCobrar  = signal<MesaPorCobrarEvent | null>(null);
  readonly ultimaCobrada    = signal<MesaCobradaEvent | null>(null);

  /** Conecta una sola vez (llamado por App al conocer la empresa). Idempotente. */
  conectar(): void {
    if (this.connection) return;

    const hubUrl = environment.urlChatBot.replace(/\/api\/?$/, '') + '/storageHub';
    this.connection = new signalR.HubConnectionBuilder()
      .withUrl(hubUrl)
      .withAutomaticReconnect()
      .build();

    this.connection.on('ReceiveOrdenLista',   (json: string) => { this.trace('← ReceiveOrdenLista', json); this.ultimaOrdenLista.set(this.parse(json)); });
    this.connection.on('ReceiveMesaPorCobrar', (json: string) => { this.trace('← ReceiveMesaPorCobrar', json); this.ultimaPorCobrar.set(this.parse(json)); });
    this.connection.on('ReceiveMesaCobrada',   (json: string) => { this.trace('← ReceiveMesaCobrada', json); this.ultimaCobrada.set(this.parse(json)); });

    this.connection.onreconnecting((err) => { this.trace('reconectando…', err); this.conectado.set(false); this.error.set(true); });
    this.connection.onreconnected(() => { this.trace('reconectado'); this.conectado.set(true); this.error.set(false); });
    this.connection.onclose((err) => { this.trace('conexión cerrada', err); this.conectado.set(false); this.error.set(true); });

    this.trace('conectando a', hubUrl);
    this.connection.start()
      .then(() => { this.trace('conectado ✔'); this.conectado.set(true); this.error.set(false); })
      .catch((err) => { this.trace('fallo al conectar ✖', err); this.conectado.set(false); this.error.set(true); });   // sin conexión: el polling de cada dominio sigue funcionando
  }

  private trace(msg: string, extra?: unknown): void {
    const hora = new Date().toLocaleTimeString('es-MX', { hour12: false });
    const linea = extra !== undefined ? `${hora} ${msg} ${typeof extra === 'string' ? extra : JSON.stringify(extra)}` : `${hora} ${msg}`;
    console.log('[realtime]', linea);
    this.log.update(l => [linea, ...l].slice(0, 30));
  }

  private parse<T>(json: string): T | null {
    try { return JSON.parse(json) as T; } catch { return null; }
  }
}
