import { Injectable } from '@angular/core';
import { environment } from '../../../environments/environment';
import { CajaReporte, Turno } from '../../models/caja';

/**
 * Endpoints del dominio Reportes. Único lugar donde se arman las rutas de reportes
 * (auditoría, resumen del día, analítica, reporte de mesas y de caja).
 */
@Injectable({ providedIn: 'root' })
export class ReportesService {
  private readonly pub   = `${environment.urlChatBot}/restaurant-publico`;
  private readonly admin = `${environment.urlAdministration}/Restaurant/reportes`;

  auditoriaUrl(companyId: number, desde: string, hasta: string, idUsuario: number | null, accion: string): string {
    let url = `${this.pub}/auditoria/${companyId}?desde=${desde}&hasta=${hasta}`;
    if (idUsuario !== null) url += `&idUsuario=${idUsuario}`;
    if (accion) url += `&accion=${accion}`;
    return url;
  }

  resumenDiaUrl(companyId: number, fecha: string): string {
    return `${this.pub}/resumen-dia/${companyId}?fecha=${fecha}`;
  }

  analiticaUrl(companyId: number, fecha: string): string {
    return `${this.pub}/analitica/${companyId}?fecha=${fecha}`;
  }

  mesasUrl(companyId: number, fecha: string): string {
    return `${this.admin}/${companyId}/mesas?fecha=${fecha}`;
  }

  turnosUrl(companyId: number, fecha: string): string {
    return `${this.admin}/${companyId}/turnos?fecha=${fecha}`;
  }

  /**
   * Normaliza la respuesta del reporte de caja: acepta el formato nuevo
   * (CajaReporte[] con propiedad 'turnos') o el viejo (Turno[]) y agrupa por caja.
   */
  agruparCajas(raw: (CajaReporte | Turno)[]): CajaReporte[] {
    if (!raw.length) return [];
    if ('turnos' in raw[0]) return raw as CajaReporte[];
    const mapa = new Map<number, { cajaId: number; turnos: Turno[] }>();
    for (const t of raw as Turno[]) {
      if (!mapa.has(t.idCashRegister)) mapa.set(t.idCashRegister, { cajaId: t.idCashRegister, turnos: [] });
      mapa.get(t.idCashRegister)!.turnos.push(t);
    }
    return Array.from(mapa.values()).map(({ cajaId, turnos }) => ({
      idCashRegister: cajaId,
      ventasEfectivo: turnos[0].ventasEfectivo || 0,
      ventasTarjeta:  turnos[0].ventasTarjeta  || 0,
      ventasCheque:   turnos[0].ventasCheque   || 0,
      ventasVales:    turnos[0].ventasVales     || 0,
      ventasMixto:    turnos[0].ventasMixto     || 0,
      ventasTotal:    turnos[0].ventasTotal     || 0,
      turnos,
    }));
  }
}
