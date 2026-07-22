import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';
import { Usuario } from '../models/usuario';

export interface AuditExtras {
  entidad?: string;
  idEntidad?: number | null;
  descripcion?: string;
  monto?: number | null;
  idMesa?: number | null;
  nombreMesa?: string | null;
}

/**
 * Bitácora de auditoría (transversal): la usan todos los dominios para registrar
 * acciones del usuario (login, cobro, cancelación, egreso, turno, etc.).
 *
 * Es un servicio con estado: App sincroniza el `usuario` logueado y la `companyId`
 * activa; así cualquier dominio (Caja, Mesas, Cuenta…) puede llamar `auditar()`
 * sin depender del componente App. La lectura del log vive en ReportesService.
 */
@Injectable({ providedIn: 'root' })
export class AuditoriaService {
  private readonly http = inject(HttpClient);

  /** Usuario logueado y empresa activa; los fija App. */
  readonly usuario   = signal<Usuario | null>(null);
  readonly companyId = signal<number | null>(null);

  /** Endpoint de escritura de la bitácora (POST). */
  registrarUrl(): string {
    return `${environment.urlChatBot}/restaurant-publico/auditoria`;
  }

  /** Registra una acción en la bitácora. Nunca rompe la operación si falla. */
  auditar(accion: string, extras: AuditExtras = {}): void {
    const u = this.usuario();
    const cid = this.companyId();
    if (!cid) return;
    firstValueFrom(this.http.post(
      this.registrarUrl(),
      {
        idCompany: cid,
        idUsuario: u?.id ?? null,
        usuario: u?.nombre ?? null,
        rol: u?.rol ?? null,
        accion,
        entidad: extras.entidad ?? null,
        idEntidad: extras.idEntidad ?? null,
        descripcion: extras.descripcion ?? null,
        monto: extras.monto ?? null,
        idMesa: extras.idMesa ?? null,
        nombreMesa: extras.nombreMesa ?? null,
      },
    )).catch(() => { /* la auditoría nunca rompe la operación */ });
  }
}
