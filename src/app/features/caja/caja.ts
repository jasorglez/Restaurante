import { CurrencyPipe, DatePipe } from '@angular/common';
import { httpResource } from '@angular/common/http';
import { Component, ViewEncapsulation, computed, effect, inject, input, output, signal } from '@angular/core';
import pdfMake from 'pdfmake/build/pdfmake';
import { CajaInfo, EgresoCaja, ResumenCorte, Turno, VentaPorTipo } from '../../models/caja';
import { Mesa } from '../../models/mesa';
import { AuditExtras, AuditoriaService } from '../../core/auditoria.service';
import { logoToDataUrl } from '../../shared/util/logo';
import { sonarCampana } from '../../shared/util/campana';
import { ConfigService } from '../config/config.service';
import { CuentaService } from '../cuenta/cuenta.service';
import { MesasService } from '../mesas/mesas.service';
import { UsuariosService } from '../usuarios/usuarios.service';
import { CajaService } from './caja.service';

/**
 * Vista de Cajas: apertura/cierre de turno, cola de cobro (acceso rápido a
 * cobrar una mesa), egresos, devolución y corte de caja. Se monta solo cuando
 * la vista activa de App es 'cajas'; los avisos en tiempo real que refrescan
 * la lista de mesas por cobrar viven en App (que nunca se desmonta).
 *
 * ViewEncapsulation.None: igual que Reportes, por el @media print de la nota
 * de corte y porque comparte clases globales (turno-input, monto-*, ticket-*)
 * definidas en shared/styles/_layout.scss.
 */
@Component({
  selector: 'app-caja',
  imports: [CurrencyPipe, DatePipe],
  templateUrl: './caja.html',
  styleUrl: './caja.scss',
  encapsulation: ViewEncapsulation.None,
})
export class Caja {
  private readonly cajaSvc      = inject(CajaService);
  private readonly mesasSvc     = inject(MesasService);
  private readonly cuentaSvc    = inject(CuentaService);
  private readonly usuariosSvc  = inject(UsuariosService);
  private readonly configSvc    = inject(ConfigService);
  private readonly auditoriaSvc = inject(AuditoriaService);

  readonly companyId    = input.required<number>();
  readonly companyName  = input.required<string>();
  readonly companyLogo  = input<string | null>(null);
  readonly mesasPorCobrar = input(0);
  readonly back        = output<void>();
  readonly cobrarMesa  = output<Mesa>();

  private auditar(accion: string, extras: AuditExtras = {}): void {
    this.auditoriaSvc.auditar(accion, extras);
  }
  private enviarAlerta(mensaje: string): void {
    this.configSvc.enviarAlerta(this.companyId(), mensaje);
  }

  // ── Cajas / Turno ─────────────────────────────────────────────────────────
  protected readonly cajasResource = httpResource<CajaInfo[]>(
    () => this.cajaSvc.cajasUrl(this.companyId()),
    { defaultValue: [] },
  );
  protected readonly cajas = this.cajasResource.value;
  protected readonly cajasLoading = this.cajasResource.isLoading;

  protected readonly cajaNombre = signal('');
  protected readonly fondoInicial = signal<number | null>(null);
  protected readonly iniciandoTurno = signal(false);
  protected readonly turnoActivo = this.cajaSvc.turnoActivo;   // estado en CajaService
  protected readonly turnoError = signal('');
  protected readonly turnoActivoCargando = computed(() => this.turnoActivoResource.isLoading());

  protected readonly cajaSeleccionada = computed(() => {
    const list = this.cajas();
    return list.length === 1 ? list[0] : null;
  });

  protected readonly cajasSubView = signal<'inicio' | 'egresos' | 'corte' | 'cobrar' | 'devolucion'>('inicio');

  // ── Devolución de ticket (sale dinero de caja, con PIN de supervisor) ───────
  protected readonly devRef    = signal('');
  protected readonly devMonto  = signal<number | null>(null);
  protected readonly devMotivo = signal('');
  protected readonly devPor     = signal('');
  protected readonly devPin     = signal('');
  protected readonly devProcesando = signal(false);
  protected readonly devError   = signal('');
  protected readonly devOk      = signal('');
  protected setDevRef(e: Event): void { this.devRef.set((e.target as HTMLInputElement).value); }
  protected setDevMotivo(e: Event): void { this.devMotivo.set((e.target as HTMLInputElement).value); }
  protected setDevPor(e: Event): void { this.devPor.set((e.target as HTMLInputElement).value); }
  protected setDevPin(e: Event): void { this.devPin.set((e.target as HTMLInputElement).value); }
  protected setDevMonto(e: Event): void {
    const v = parseFloat((e.target as HTMLInputElement).value);
    this.devMonto.set(!isNaN(v) && v > 0 ? v : null);
  }
  // Cobros del día (para elegir cuál devolver/cancelar).
  protected readonly devCuentaSel = signal<number | null>(null);
  protected readonly cobrosDiaResource = httpResource<any[]>(
    () => this.cajasSubView() === 'devolucion'
      ? this.cuentaSvc.cobrosDiaUrl(this.companyId(), new Date().toISOString().split('T')[0])
      : undefined,
    { defaultValue: [] },
  );
  protected setDevCuenta(e: Event): void {
    const v = (e.target as HTMLSelectElement).value;
    if (!v) { this.devCuentaSel.set(null); return; }
    const c = this.cobrosDiaResource.value().find((x: any) => x.idCuenta === +v);
    if (c) {
      this.devCuentaSel.set(c.idCuenta);
      this.devRef.set(`#${c.idCuenta} · ${c.mesa}`);
      this.devMonto.set(c.monto);
    }
  }

  protected abrirDevolucion(): void {
    this.devRef.set(''); this.devMonto.set(null); this.devMotivo.set('');
    this.devPor.set(''); this.devPin.set(''); this.devError.set(''); this.devOk.set('');
    this.devCuentaSel.set(null);
    this.cajasSubView.set('devolucion');
  }

  protected async registrarDevolucion(): Promise<void> {
    const turno = this.turnoActivo();
    const monto = this.devMonto();
    if (!turno) return;
    if (monto === null) { this.devError.set('Indica el monto a devolver.'); return; }
    if (!this.devPor().trim()) { this.devError.set('Indica quién autoriza.'); return; }

    this.devProcesando.set(true);
    this.devError.set(''); this.devOk.set('');
    try {
      // 1) Validar PIN de supervisor
      const r: any = await this.usuariosSvc.validarPin(this.companyId(), this.devPin());
      if (!r?.ok) { this.devError.set('PIN de supervisor incorrecto.'); return; }

      const ref = this.devRef().trim();
      const motivo = this.devMotivo().trim();
      const desc = `Devolución${ref ? ' ticket ' + ref : ''}${motivo ? ': ' + motivo : ''}`;

      // 2) Registrar la salida de caja (egreso) → el corte lo resta
      await this.cajaSvc.registrarEgreso(turno.id, desc, monto);

      // 3) Bitácora de autorización (auditoría)
      try {
        await this.cuentaSvc.registrarAutorizacion(
          { idCompany: this.companyId(), tipo: 'DEVOLUCION', descripcion: ref || null,
            monto, motivo: motivo || null, autorizadoPor: this.devPor().trim() });
      } catch { /* la salida ya quedó registrada */ }

      // Si se eligió un cobro del día, marca la venta como cancelada en el reporte.
      const cta = this.devCuentaSel();
      if (cta != null) {
        try {
          await this.cuentaSvc.cancelarVenta(cta, this.companyId());
        } catch { /* la devolución ya quedó registrada como egreso */ }
      }
      this.auditar('DEVOLUCION', { entidad: 'CAJA', idEntidad: cta, monto, descripcion: desc });
      this.devOk.set(`Devolución registrada: se sacaron ${monto} de la caja${cta != null ? ' y la venta quedó cancelada' : ''}.`);
      this.devRef.set(''); this.devMonto.set(null); this.devMotivo.set('');
      this.devPin.set('');
      this.resumenCorteResource.reload();
    } catch (err: any) {
      this.devError.set(err?.error?.error ?? 'No se pudo registrar la devolución.');
    } finally {
      this.devProcesando.set(false);
    }
  }
  protected readonly totalEgresosLista = computed(() =>
    this.egresosLista().reduce((s, e) => s + e.monto, 0),
  );

  // Consulta turno activo en cuanto se conoce la caja.
  protected readonly turnoActivoResource = httpResource<Turno | null>(
    () => {
      const caja = this.cajaSeleccionada();
      if (!caja) return undefined;
      return this.cajaSvc.turnoActivoUrl(caja.idCaja);
    },
  );

  constructor() {
    // Si App pidió abrir directo en "cobrar" (viene de un cobro rápido de mesa).
    if (this.cajaSvc.abrirEnCobro()) {
      this.cajaSvc.abrirEnCobro.set(false);
      this.cajasSubView.set('cobrar');
    }

    // Cuando el recurso resuelve un turno abierto, lo activa automáticamente
    effect(() => {
      const t = this.turnoActivoResource.value();
      if (t && !this.turnoActivo()) {
        this.turnoActivo.set(t);
      }
    });

    // Suena la campana cuando el mesero envía una mesa a cobrar (aviso
    // mesero→caja). Solo mientras se está viendo Cajas (este componente vivo).
    effect(() => {
      const ids = this.mesasSvc.colaCobro().map(m => m.id);
      const hayNueva = ids.some(id => !this.porCobrarAvisadas.has(id));
      this.porCobrarAvisadas = new Set(ids);
      if (hayNueva) sonarCampana();
    });
  }

  // ── Mesas → estado en MesasService (store) ──────────────────────────────────
  protected readonly mesasResource = this.mesasSvc.mesasResource;
  protected readonly mesas         = this.mesasSvc.mesas;
  protected readonly loading       = this.mesasResource.isLoading;

  // Cuentas ya avisadas a caja (para sonar la campana solo cuando aparece una NUEVA).
  private porCobrarAvisadas = new Set<number>();

  // Colas de cobro → MesasService (store).
  protected readonly mesasParaCobrar = this.mesasSvc.mesasParaCobrar;
  protected readonly colaCobro       = this.mesasSvc.colaCobro;
  protected minutosEsperando(m: Mesa): number {
    if (!m.porCobrarAt) return 0;
    return Math.max(0, Math.floor((Date.now() - Date.parse(m.porCobrarAt)) / 60000));
  }
  protected estadoMesa(m: Mesa): string {
    return this.mesasSvc.estadoMesa(m);
  }

  protected readonly cobrarBusqueda = signal('');
  protected setCobrarBusqueda(e: Event): void { this.cobrarBusqueda.set((e.target as HTMLInputElement).value); }
  protected readonly mesasParaCobrarFiltradas = computed(() => {
    const t = this.cobrarBusqueda().trim().toLowerCase();
    const lista = this.mesasParaCobrar();
    return t ? lista.filter(m => m.nombre.toLowerCase().includes(t)) : lista;
  });

  protected abrirCobrarMesa(): void {
    this.cobrarBusqueda.set('');
    this.cajasSubView.set('cobrar');
    this.mesasResource.reload();
  }
  protected cobrarMesaRapido(m: Mesa): void {
    this.cobrarMesa.emit(m);
  }

  // ── Egresos ──────────────────────────────────────────────────────────────
  protected readonly egresoDesc = signal('');
  protected readonly egresoMonto = signal<number | null>(null);
  protected readonly registrandoEgreso = signal(false);
  protected readonly egresoError = signal('');
  protected readonly egresosLista = signal<EgresoCaja[]>([]);

  protected abrirEgresos(): void {
    this.egresoDesc.set('');
    this.egresoMonto.set(null);
    this.egresoError.set('');
    this.cajasSubView.set('egresos');
  }

  protected setEgresoDesc(e: Event): void {
    this.egresoDesc.set((e.target as HTMLInputElement).value);
  }

  protected setEgresoMonto(e: Event): void {
    const val = +(e.target as HTMLInputElement).value;
    this.egresoMonto.set(val > 0 ? val : null);
  }

  protected async registrarEgreso(): Promise<void> {
    const turno = this.turnoActivo();
    const monto = this.egresoMonto();
    if (!turno || !monto) return;

    this.registrandoEgreso.set(true);
    this.egresoError.set('');
    try {
      const egreso = await this.cajaSvc.registrarEgreso(turno.id, this.egresoDesc().trim() || null, monto);
      this.egresosLista.update(list => [egreso, ...list]);
      this.auditar('EGRESO', { entidad: 'CAJA', monto, descripcion: this.egresoDesc().trim() || 'Egreso' });
      this.egresoDesc.set('');
      this.egresoMonto.set(null);
      this.resumenCorteResource.reload();   // actualiza el disponible
    } catch (err: any) {
      this.egresoError.set(err?.error?.error ?? 'No se pudo registrar el egreso.');
    } finally {
      this.registrandoEgreso.set(false);
    }
  }

  // ── Corte ─────────────────────────────────────────────────────────────────
  protected readonly resumenCorteResource = httpResource<ResumenCorte>(
    () => {
      const t = this.turnoActivo();
      const sv = this.cajasSubView();
      if (!t || (sv !== 'corte' && sv !== 'egresos' && sv !== 'devolucion')) return undefined;
      return this.cajaSvc.resumenUrl(t.id);
    },
  );
  // Efectivo disponible en caja (fondo + ventas efectivo − egresos).
  protected readonly efectivoDisponible = computed(
    () => this.resumenCorteResource.value()?.totales.efectivoEsperado ?? null,
  );
  protected readonly egresoExcede = computed(() => {
    const disp = this.efectivoDisponible();
    const monto = this.egresoMonto();
    return disp != null && monto != null && monto > disp;
  });
  protected readonly efectivoContado = signal<number | null>(null);
  private efectivoContadoEl: HTMLInputElement | null = null;

  // Arqueo por denominación (MXN). Suma → efectivo contado.
  protected readonly denominaciones = [1000, 500, 200, 100, 50, 20, 10, 5, 2, 1, 0.5];
  protected readonly arqueo = signal<Record<number, number | null>>({});
  protected setArqueo(denom: number, e: Event): void {
    const v = parseInt((e.target as HTMLInputElement).value, 10);
    const qty = !isNaN(v) && v >= 0 ? v : null;
    this.arqueo.update(a => ({ ...a, [denom]: qty }));
    const mapa = this.arqueo();
    const hayAlguno = this.denominaciones.some(d => mapa[d] != null);
    const total = this.denominaciones.reduce((s, d) => s + d * (mapa[d] ?? 0), 0);
    this.efectivoContado.set(hayAlguno ? Math.round(total * 100) / 100 : null);
  }
  protected readonly cerrandoTurno = signal(false);
  protected readonly cerrarError = signal('');
  protected readonly corteResultado = signal<Turno | null>(null);
  protected readonly corteResumenSnapshot = signal<ResumenCorte | null>(null);

  protected readonly diferencia = computed(() => {
    const esperado = this.resumenCorteResource.value()?.totales.efectivoEsperado ?? 0;
    const contado  = this.efectivoContado() ?? 0;
    return contado - esperado;
  });

  protected setFondoInicial(e: Event): void {
    const val = +(e.target as HTMLInputElement).value;
    this.fondoInicial.set(val >= 0 ? val : null);
  }

  protected setCajaNombre(e: Event): void {
    this.cajaNombre.set((e.target as HTMLInputElement).value);
  }

  protected async iniciarTurno(): Promise<void> {
    const caja = this.cajaSeleccionada();
    if (!caja) return;

    this.iniciandoTurno.set(true);
    this.turnoError.set('');
    try {
      const turno = await this.cajaSvc.abrirTurno(caja, this.cajaNombre().trim() || null, this.fondoInicial() ?? 0);
      this.auditar('ABRIR_TURNO', { entidad: 'TURNO', idEntidad: turno.id, monto: this.fondoInicial() ?? 0, descripcion: `Fondo ${this.fondoInicial() ?? 0}` });
    } catch {
      this.turnoError.set('No se pudo iniciar el turno. Intenta de nuevo.');
    } finally {
      this.iniciandoTurno.set(false);
    }
  }

  protected backToCajas(): void {
    this.turnoActivo.set(null);
    this.cajaNombre.set('');
    this.fondoInicial.set(null);
    this.turnoError.set('');
    this.cajasSubView.set('inicio');
    this.egresosLista.set([]);
    this.corteResultado.set(null);
    this.corteResumenSnapshot.set(null);
  }

  protected abrirCorte(): void {
    this.efectivoContado.set(null);
    this.efectivoContadoEl = null;
    this.arqueo.set({});
    this.cerrarError.set('');
    this.corteResultado.set(null);
    this.cajasSubView.set('corte');
  }

  protected setEfectivoContado(e: Event): void {
    const input = e.target as HTMLInputElement;
    this.efectivoContadoEl = input;
    const str = input.value.trim();
    if (str.endsWith('.')) return; // punto sin decimales aún — no actualizar
    const val = parseFloat(str);
    this.efectivoContado.set(!isNaN(val) && val >= 0 ? val : null);
  }

  protected async cerrarTurno(): Promise<void> {
    const turno = this.turnoActivo();
    if (!turno) return;

    // Snapshot del resumen antes de cerrar (para la nota impresa)
    const snapshotResumen = this.resumenCorteResource.value();

    this.cerrandoTurno.set(true);
    this.cerrarError.set('');
    try {
      const result = await this.cajaSvc.cerrarTurno(turno.id, this.efectivoContado() ?? 0);
      this.corteResultado.set(result);
      this.auditar('CERRAR_TURNO', { entidad: 'TURNO', idEntidad: turno.id, monto: this.efectivoContado() ?? 0, descripcion: `Contado ${this.efectivoContado() ?? 0}` });
      const esp = snapshotResumen?.totales.efectivoEsperado ?? 0;
      const cont = this.efectivoContado() ?? 0;
      const dif = cont - esp;
      this.enviarAlerta(`📊 ${this.companyName()} · Corte de caja\nEsperado: $${esp.toFixed(2)}\nContado: $${cont.toFixed(2)}\nDiferencia: $${dif.toFixed(2)}`);
      if (snapshotResumen) {
        this.corteResumenSnapshot.set({
          ...snapshotResumen,
          totales: {
            ...snapshotResumen.totales,
            efectivoEsperado: snapshotResumen.totales.efectivoEsperado,
          },
        });
      }
      // turnoActivo lo limpia CajaService.cerrarTurno
    } catch {
      this.cerrarError.set('No se pudo cerrar el turno. Intenta de nuevo.');
    } finally {
      this.cerrandoTurno.set(false);
    }
  }

  // ── Mostrar/ocultar el PIN de supervisor en devolución ──────────────────────
  private readonly clavesVisibles = signal<ReadonlySet<string>>(new Set<string>());
  protected verClave(id: string): boolean { return this.clavesVisibles().has(id); }
  protected toggleClave(id: string): void {
    const s = new Set(this.clavesVisibles());
    if (s.has(id)) s.delete(id); else s.add(id);
    this.clavesVisibles.set(s);
  }

  protected async imprimirCorte(): Promise<void> {
    const corte = this.corteResumenSnapshot();
    if (!corte) return;

    const t = corte.turno;
    const logo = await logoToDataUrl(this.companyLogo());
    const docDef: any = {
      pageSize: 'A4',
      pageMargins: [20, 20, 20, 20],
      content: [
        ...(logo ? [{ image: logo, width: 60, height: 60, alignment: 'center', margin: [0, 0, 0, 8] }] : []),
        { text: this.companyName(), alignment: 'center', fontSize: 16, bold: true, margin: [0, 0, 0, 4] },
        { text: 'Corte de Caja', alignment: 'center', fontSize: 14, bold: true, margin: [0, 0, 0, 12] },
        {
          table: {
            widths: ['*', '*'],
            body: [
              [{ text: 'Caja:', fontSize: 10, bold: true }, { text: t.idCashRegister, fontSize: 10 }],
              [{ text: 'Cajero:', fontSize: 10, bold: true }, { text: t.cajero || 'N/A', fontSize: 10 }],
              [{ text: 'Fecha Inicio:', fontSize: 10, bold: true }, { text: new Date(t.fechaInicio).toLocaleString('es-MX'), fontSize: 10 }],
              [{ text: 'Fecha Cierre:', fontSize: 10, bold: true }, { text: t.fechaCierre ? new Date(t.fechaCierre).toLocaleString('es-MX') : 'Abierto', fontSize: 10 }]
            ]
          },
          margin: [0, 0, 0, 16]
        },
        { text: 'Resumen de Ventas', fontSize: 12, bold: true, margin: [0, 0, 0, 8] },
        {
          table: {
            widths: ['*', 80, 80],
            body: [
              [{ text: 'Tipo Pago', bold: true, fontSize: 10 }, { text: 'Cantidad', bold: true, fontSize: 10, alignment: 'center' }, { text: 'Total', bold: true, fontSize: 10, alignment: 'right' }],
              ...corte.ventas.map((v: VentaPorTipo) => [
                { text: v.paymentType, fontSize: 10 },
                { text: String(v.numVentas), fontSize: 10, alignment: 'center' },
                { text: `$${v.total.toFixed(2)}`, fontSize: 10, alignment: 'right' }
              ]),
              [{ text: 'TOTAL VENTAS', bold: true, fontSize: 10 }, { text: '', fontSize: 10 }, { text: `$${corte.totales.totalVentas.toFixed(2)}`, bold: true, fontSize: 10, alignment: 'right' }]
            ]
          },
          margin: [0, 0, 0, 16]
        },
        ...(corte.egresos.length > 0 ? [
          { text: 'Egresos', fontSize: 12, bold: true, margin: [0, 0, 0, 8] },
          {
            table: {
              widths: ['*', '*', 80],
              body: [
                [{ text: 'Tipo', bold: true, fontSize: 10 }, { text: 'Descripción', bold: true, fontSize: 10 }, { text: 'Monto', bold: true, fontSize: 10, alignment: 'right' }],
                ...corte.egresos.map((e: EgresoCaja) => [
                  { text: e.tipo, fontSize: 9 },
                  { text: e.descripcion || '—', fontSize: 9 },
                  { text: `$${e.monto.toFixed(2)}`, fontSize: 9, alignment: 'right' }
                ]),
                [{ text: 'TOTAL EGRESOS', bold: true, fontSize: 10 }, { text: '', fontSize: 10 }, { text: `$${corte.totales.totalEgresos.toFixed(2)}`, bold: true, fontSize: 10, alignment: 'right' }]
              ]
            },
            margin: [0, 0, 0, 16]
          }
        ] : []),
        { text: '═'.repeat(60), margin: [0, 0, 0, 8] },
        {
          table: {
            widths: ['*', 120],
            body: [
              [{ text: 'Fondo Inicial:', fontSize: 11, bold: true }, { text: `$${t.fondoInicial.toFixed(2)}`, fontSize: 11, alignment: 'right' }],
              [{ text: 'Total Ventas:', fontSize: 11, bold: true }, { text: `$${corte.totales.totalVentas.toFixed(2)}`, fontSize: 11, alignment: 'right' }],
              [{ text: 'Total Egresos:', fontSize: 11, bold: true }, { text: `$${corte.totales.totalEgresos.toFixed(2)}`, fontSize: 11, alignment: 'right' }],
              [{ text: 'ESPERADO:', fontSize: 11, bold: true }, { text: `$${corte.totales.efectivoEsperado.toFixed(2)}`, fontSize: 11, alignment: 'right', color: '#147a4b', bold: true }],
              [{ text: 'CONTADO:', fontSize: 11, bold: true }, { text: `$${(t.efectivoContado ?? 0).toFixed(2)}`, fontSize: 11, alignment: 'right', color: t.diferencia === 0 ? '#147a4b' : '#c0392b', bold: true }],
              [{ text: 'DIFERENCIA:', fontSize: 11, bold: true }, { text: `$${(t.diferencia ?? 0).toFixed(2)}`, fontSize: 11, alignment: 'right', color: t.diferencia === 0 ? '#147a4b' : '#c0392b', bold: true }]
            ]
          }
        }
      ]
    };

    pdfMake.createPdf(docDef).open();
  }
}
