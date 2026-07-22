import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';

/**
 * Único punto de acceso al microservicio de cocina (ChatBot / restaurant-publico).
 * Centraliza URLs y acciones para que ningún componente arme rutas a mano.
 */
@Injectable({ providedIn: 'root' })
export class CocinaService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.urlChatBot}/restaurant-publico/cocina`;

  /** Órdenes pendientes del tablero (KDS) de una empresa. */
  kdsUrl(companyId: number): string { return `${this.base}/${companyId}`; }

  /** Platillos ya listos por entregar (aviso al mesero) de una empresa. */
  listosUrl(companyId: number): string { return `${this.base}/${companyId}/listos`; }

  /** Cocina marca una orden como lista. */
  marcarListo(idCuenta: number): Promise<unknown> {
    return firstValueFrom(this.http.post(`${this.base}/${idCuenta}/listo`, {}));
  }

  /** El mesero marca la orden como entregada al comensal. */
  marcarEntregado(idCuenta: number): Promise<unknown> {
    return firstValueFrom(this.http.post(`${this.base}/${idCuenta}/entregado`, {}));
  }
}
