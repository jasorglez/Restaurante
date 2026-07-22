import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { CajaInfo, EgresoCaja, Turno } from '../../models/caja';

/**
 * Dominio Caja/Turno (microservicio Administration): endpoints, estado del turno
 * activo y las operaciones del ciclo de turno (abrir, egreso, cerrar). El HTTP y
 * el estado del turno viven aquí; App orquesta la UI (loading/errores), la
 * bitácora (auditar) y el PDF/alerta del corte.
 */
@Injectable({ providedIn: 'root' })
export class CajaService {
  private readonly http = inject(HttpClient);
  private readonly admin = `${environment.urlAdministration}/Restaurant`;

  /** Empresa activa (la fija App). */
  readonly companyId = signal<number | null>(null);

  /** Turno abierto actualmente (o null). Estado central del dominio caja. */
  readonly turnoActivo = signal<Turno | null>(null);

  /** Abre un turno en la caja indicada y lo deja como turno activo. */
  async abrirTurno(caja: CajaInfo, cajero: string | null, fondoInicial: number): Promise<Turno> {
    const turno = await firstValueFrom(this.http.post<Turno>(this.turnosUrl(), {
      idCompany:      this.companyId()!,
      idCashRegister: caja.idCaja,
      idBranch:       caja.idBranch,
      cajero,
      fondoInicial,
    }));
    this.turnoActivo.set(turno);
    return turno;
  }

  /** Registra un egreso (salida de efectivo) del turno. */
  registrarEgreso(idTurno: number, descripcion: string | null, monto: number): Promise<EgresoCaja> {
    return firstValueFrom(this.http.post<EgresoCaja>(this.egresosUrl(idTurno), { descripcion, monto }));
  }

  /** Cierra el turno (corte) y limpia el turno activo. */
  async cerrarTurno(idTurno: number, efectivoContado: number): Promise<Turno> {
    const result = await firstValueFrom(this.http.put<Turno>(this.cerrarUrl(idTurno),
      { efectivoContado, notas: null }));
    this.turnoActivo.set(null);
    return result;
  }

  /** Cajas registradas de una empresa. */
  cajasUrl(companyId: number): string { return `${this.admin}/cajas/${companyId}`; }

  /** Turno abierto de una caja (o vacío si no hay). */
  turnoActivoUrl(idCaja: number): string { return `${this.admin}/cajas/${idCaja}/turno-activo`; }

  /** Colección de turnos (POST = abrir turno). */
  turnosUrl(): string { return `${this.admin}/turnos`; }

  /** Egresos de un turno (POST = registrar salida de efectivo). */
  egresosUrl(idTurno: number): string { return `${this.admin}/turnos/${idTurno}/egresos`; }

  /** Resumen del turno (ventas por tipo, egresos, totales) para el corte. */
  resumenUrl(idTurno: number): string { return `${this.admin}/turnos/${idTurno}/resumen`; }

  /** Cierre del turno (POST = cerrar caja / corte). */
  cerrarUrl(idTurno: number): string { return `${this.admin}/turnos/${idTurno}/cerrar`; }
}
