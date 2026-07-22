import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';

/**
 * Endpoints de configuración: impresoras (microservicio Administration) y
 * alertas de Telegram (microservicio ChatBot).
 */
@Injectable({ providedIn: 'root' })
export class ConfigService {
  private readonly http = inject(HttpClient);
  private readonly pub   = `${environment.urlChatBot}/restaurant-publico`;
  private readonly admin = `${environment.urlAdministration}/Restaurant`;

  /** Envía una alerta a Telegram (no bloquea si falla). */
  enviarAlerta(companyId: number, mensaje: string): void {
    firstValueFrom(this.http.post(this.alertasBaseUrl(), { idCompany: companyId, mensaje }))
      .catch((_: HttpErrorResponse) => { /* opcional */ });
  }

  /** Impresoras registradas de una empresa. */
  impresorasListUrl(companyId: number): string { return `${this.admin}/impresoras/${companyId}`; }

  /** Colección de impresoras (POST = alta). */
  impresorasBaseUrl(): string { return `${this.admin}/impresoras`; }

  /** Baja de una impresora. */
  impresoraDeleteUrl(id: number): string { return `${this.admin}/impresoras/${id}`; }

  /** Prueba de impresión. */
  impresoraTestUrl(): string { return `${this.pub}/impresoras/test`; }

  /** Chats de Telegram configurados para alertas de una empresa (GET/PUT). */
  alertasChatsUrl(companyId: number): string { return `${this.pub}/alertas/${companyId}/chats`; }

  /** Colección de alertas (POST = enviar alerta de prueba). */
  alertasBaseUrl(): string { return `${this.pub}/alertas`; }
}
