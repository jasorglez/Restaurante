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

    this.connection.on('ReceiveOrdenLista',   (json: string) => this.ultimaOrdenLista.set(this.parse(json)));
    this.connection.on('ReceiveMesaPorCobrar', (json: string) => this.ultimaPorCobrar.set(this.parse(json)));
    this.connection.on('ReceiveMesaCobrada',   (json: string) => this.ultimaCobrada.set(this.parse(json)));

    this.connection.onreconnected(() => this.conectado.set(true));
    this.connection.onclose(() => this.conectado.set(false));

    this.connection.start()
      .then(() => this.conectado.set(true))
      .catch(() => this.conectado.set(false));   // sin conexión: el polling de cada dominio sigue funcionando
  }

  private parse<T>(json: string): T | null {
    try { return JSON.parse(json) as T; } catch { return null; }
  }
}
