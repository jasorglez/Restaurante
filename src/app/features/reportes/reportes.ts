import { CurrencyPipe, DatePipe } from '@angular/common';
import { httpResource } from '@angular/common/http';
import { Component, ViewEncapsulation, computed, inject, input, output, signal } from '@angular/core';
import pdfMake from 'pdfmake/build/pdfmake';
import { CajaReporte, Turno } from '../../models/caja';
import { GrupoMesa, ReporteMesa, ResumenDia } from '../../models/reporte';
import { Usuario } from '../../models/usuario';
import { descargarCsv } from '../../shared/util/csv';
import { logoToDataUrl } from '../../shared/util/logo';
import { ReportesService } from './reportes.service';

/**
 * Vista de Reportes (resumen del día, mesas, caja, auditoría) + export CSV e
 * impresión PDF. Se monta solo cuando la vista activa es 'reportes'.
 *
 * Encapsulation.None: el CSS de impresión (@media print que alterna la
 * visibilidad de toda la página) y las clases compartidas necesitan alcance
 * global; los estilos propios están namespaced bajo .reporte-view.
 */
@Component({
  selector: 'app-reportes',
  imports: [CurrencyPipe, DatePipe],
  templateUrl: './reportes.html',
  styleUrl: './reportes.scss',
  encapsulation: ViewEncapsulation.None,
})
export class Reportes {
  private readonly reportes = inject(ReportesService);

  readonly companyId   = input.required<number>();
  readonly esAdmin     = input.required<boolean>();
  readonly companyName = input.required<string>();
  readonly companyLogo = input<string | null>(null);
  readonly usuarios    = input<Usuario[]>([]);
  readonly back        = output<void>();

  protected readonly reporteSubView = signal<'mesas' | 'caja' | 'resumen' | 'auditoria'>('mesas');
  protected readonly reporteFecha   = signal<string>(new Date().toISOString().split('T')[0]);
  protected setReporteFecha(e: Event): void {
    this.reporteFecha.set((e.target as HTMLInputElement).value);
  }

  // ── Auditoría (bitácora por usuario) — solo admin ──
  protected readonly auditFiltroUsuario = signal<number | null>(null);
  protected readonly auditFiltroAccion  = signal<string>('');
  protected setAuditUsuario(e: Event): void {
    const v = (e.target as HTMLSelectElement).value;
    this.auditFiltroUsuario.set(v === '' ? null : +v);
  }
  protected setAuditAccion(e: Event): void { this.auditFiltroAccion.set((e.target as HTMLSelectElement).value); }
  protected readonly accionesAudit = [
    'LOGIN', 'LOGOUT', 'ABRIR_MESA', 'COBRO', 'COBRO_COMENSAL', 'CANCELAR_ITEM',
    'CORTESIA', 'DESCUENTO', 'DEVOLUCION', 'EGRESO', 'INGRESO_INV', 'AJUSTE_INV',
    'ABRIR_TURNO', 'CERRAR_TURNO',
  ];
  protected etiquetaAccion(a: string): string {
    const m: Record<string, string> = {
      LOGIN: '🔑 Entró', LOGOUT: '🚪 Salió', ABRIR_MESA: '🍽️ Abrió mesa',
      COBRO: '💵 Cobró', COBRO_COMENSAL: '💵 Cobró (persona)', CANCELAR_ITEM: '❌ Canceló',
      CORTESIA: '🎁 Cortesía', DESCUENTO: '％ Descuento', DEVOLUCION: '↩️ Devolución',
      EGRESO: '💸 Egreso', INGRESO_INV: '📦 Ingreso inv.', AJUSTE_INV: '✎ Ajuste inv.',
      ABRIR_TURNO: '▶️ Abrió turno', CERRAR_TURNO: '⏹️ Cerró turno',
    };
    return m[a] ?? a;
  }
  protected readonly auditoriaResource = httpResource<any[]>(
    () => {
      if (this.reporteSubView() !== 'auditoria' || !this.esAdmin()) return undefined;
      const f = this.reporteFecha();
      return this.reportes.auditoriaUrl(this.companyId(), f, f, this.auditFiltroUsuario(), this.auditFiltroAccion());
    },
    { defaultValue: [] },
  );
  protected readonly auditoria = this.auditoriaResource.value;

  // ── Resumen del día (dashboard) ──
  protected readonly resumenDiaResource = httpResource<ResumenDia>(
    () => this.reporteSubView() === 'resumen'
      ? this.reportes.resumenDiaUrl(this.companyId(), this.reporteFecha())
      : undefined,
  );
  protected readonly resumenDia        = this.resumenDiaResource.value;
  protected readonly resumenDiaLoading = this.resumenDiaResource.isLoading;

  // ── Analítica (horas pico, ventas por mesero, comparativo) ──
  protected readonly analiticaResource = httpResource<any>(
    () => this.reporteSubView() === 'resumen'
      ? this.reportes.analiticaUrl(this.companyId(), this.reporteFecha())
      : undefined,
  );
  protected readonly analitica = this.analiticaResource.value;
  protected readonly maxHora = computed(() => {
    const h = this.analitica()?.porHora ?? [];
    return h.reduce((m: number, x: any) => Math.max(m, x.total), 0) || 1;
  });

  protected readonly reporteMesasResource = httpResource<ReporteMesa[]>(
    () => this.reporteSubView() === 'mesas'
      ? this.reportes.mesasUrl(this.companyId(), this.reporteFecha())
      : undefined,
    { defaultValue: [] },
  );

  protected readonly reporteTurnosResource = httpResource<any[]>(
    () => this.reporteSubView() === 'caja'
      ? this.reportes.turnosUrl(this.companyId(), this.reporteFecha())
      : undefined,
    { defaultValue: [] },
  );

  protected readonly reporteCajasAgrupadas = computed<CajaReporte[]>(
    () => this.reportes.agruparCajas(this.reporteTurnosResource.value()),
  );

  protected readonly mesasPorGrupo = computed<GrupoMesa[]>(() => {
    const recencia = (c: ReporteMesa): number => Date.parse(c.cerradaAt ?? c.abiertaAt) || c.idCuenta;
    const mapa = new Map<string, ReporteMesa[]>();
    for (const c of this.reporteMesasResource.value()) {
      const arr = mapa.get(c.nombreMesa) ?? [];
      arr.push(c);
      mapa.set(c.nombreMesa, arr);
    }
    return Array.from(mapa.entries())
      .map(([nombreMesa, cuentas]) => ({
        nombreMesa,
        cuentas: [...cuentas].sort((a, b) => recencia(b) - recencia(a)),
        subtotal: cuentas.reduce((s, c) => s + c.total, 0),
      }))
      .sort((a, b) => recencia(b.cuentas[0]) - recencia(a.cuentas[0]));
  });

  protected readonly totalReporteMesas = computed(() =>
    this.reporteMesasResource.value().reduce((s, c) => s + c.total, 0),
  );
  protected readonly totalReporteCaja = computed(() =>
    this.reporteCajasAgrupadas().reduce((s, c) => s + (c.ventasTotal || 0), 0),
  );

  // ── Export CSV ──
  protected exportarAuditoria(): void {
    const rows = this.auditoria().map((a: any) => [
      new Date(a.fecha).toLocaleString('es-MX'), a.usuario || 'Admin', a.accion,
      a.nombreMesa || '', a.descripcion || '', a.monto ?? '',
    ]);
    descargarCsv('auditoria', ['Fecha', 'Usuario', 'Acción', 'Mesa', 'Detalle', 'Monto'], rows, this.reporteFecha());
  }

  protected exportarReporteMesas(): void {
    const rows: (string | number)[][] = [];
    for (const g of this.mesasPorGrupo()) {
      for (const c of g.cuentas) {
        for (const it of c.items) {
          rows.push([g.nombreMesa, it.descripcion ?? 'Item', it.cantidad, it.precioUnitario, it.subtotal]);
        }
      }
    }
    descargarCsv('ventas_mesas', ['Mesa', 'Producto', 'Cantidad', 'Unitario', 'Subtotal'], rows, this.reporteFecha());
  }

  // ── Impresión PDF ──
  protected async imprimirReporte(): Promise<void> {
    const fecha = this.reporteFecha();
    const subView = this.reporteSubView();
    const logo = await logoToDataUrl(this.companyLogo());

    if (subView === 'mesas') {
      const grupos = this.mesasPorGrupo();
      const docDef: any = {
        pageSize: 'A4',
        pageMargins: [20, 20, 20, 20],
        content: [
          ...(logo ? [{ image: logo, width: 60, height: 60, alignment: 'center', margin: [0, 0, 0, 12] }] : []),
          { text: this.companyName(), alignment: 'center', fontSize: 16, bold: true, margin: [0, 0, 0, 4] },
          { text: 'Reporte de Mesas', alignment: 'center', fontSize: 14, bold: true, margin: [0, 0, 0, 2] },
          { text: `Fecha: ${new Date(fecha).toLocaleDateString('es-MX')}`, alignment: 'center', fontSize: 10, color: '#666', margin: [0, 0, 0, 16] },
          ...grupos.flatMap(g => [
            { text: `Mesa: ${g.nombreMesa}`, fontSize: 12, bold: true, margin: [0, 12, 0, 8], color: '#147a4b' },
            {
              table: {
                widths: ['*', 60, 60, 80],
                body: [
                  [{ text: 'Descripción', bold: true, fontSize: 9 }, { text: 'Qty', bold: true, fontSize: 9, alignment: 'center' }, { text: 'Unitario', bold: true, fontSize: 9, alignment: 'right' }, { text: 'Subtotal', bold: true, fontSize: 9, alignment: 'right' }],
                  ...g.cuentas.flatMap(c => c.items.map(item => [
                    { text: item.descripcion ?? 'Item', fontSize: 9 },
                    { text: String(item.cantidad), fontSize: 9, alignment: 'center' },
                    { text: `$${item.precioUnitario.toFixed(2)}`, fontSize: 9, alignment: 'right' },
                    { text: `$${item.subtotal.toFixed(2)}`, fontSize: 9, alignment: 'right' }
                  ])),
                  [{ text: `Subtotal mesa: $${g.subtotal.toFixed(2)}`, colSpan: 4, bold: true, fontSize: 10, alignment: 'right' }]
                ]
              },
              margin: [0, 0, 0, 8]
            }
          ]),
          { text: '─'.repeat(80), margin: [0, 12, 0, 8] },
          {
            table: {
              widths: ['*', 120],
              body: [
                [{ text: 'TOTAL GENERAL:', bold: true, fontSize: 12 }, { text: `$${this.totalReporteMesas().toFixed(2)}`, bold: true, fontSize: 12, alignment: 'right', color: '#147a4b' }]
              ]
            }
          }
        ]
      };
      pdfMake.createPdf(docDef).open();
    } else {
      const cajas = this.reporteCajasAgrupadas();
      const fmt   = (n: number) => `$${n.toFixed(2)}`;
      const hora  = (d: string) => new Date(d).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
      const docDef: any = {
        pageSize: 'A4',
        pageMargins: [20, 20, 20, 20],
        content: [
          ...(logo ? [{ image: logo, width: 60, height: 60, alignment: 'center', margin: [0, 0, 0, 12] }] : []),
          { text: this.companyName(), alignment: 'center', fontSize: 16, bold: true, margin: [0, 0, 0, 4] },
          { text: 'Reporte de Caja', alignment: 'center', fontSize: 14, bold: true, margin: [0, 0, 0, 2] },
          { text: `Fecha: ${new Date(fecha).toLocaleDateString('es-MX')}`, alignment: 'center', fontSize: 10, color: '#666', margin: [0, 0, 0, 16] },
          ...cajas.flatMap((caja: CajaReporte) => [
            { text: `Caja ${caja.idCashRegister}`, fontSize: 11, bold: true, color: '#147a4b', margin: [0, 8, 0, 4] },
            {
              table: {
                widths: ['*', 100],
                body: [
                  [{ text: 'Tipo de Venta', bold: true, fontSize: 9 }, { text: 'Monto', bold: true, fontSize: 9, alignment: 'right' }],
                  ...(caja.ventasEfectivo > 0 ? [[{ text: 'Efectivo', fontSize: 9 }, { text: fmt(caja.ventasEfectivo), fontSize: 9, alignment: 'right' }]] : []),
                  ...(caja.ventasTarjeta > 0  ? [[{ text: 'Tarjeta',  fontSize: 9 }, { text: fmt(caja.ventasTarjeta),  fontSize: 9, alignment: 'right' }]] : []),
                  ...(caja.ventasCheque > 0   ? [[{ text: 'Cheque',   fontSize: 9 }, { text: fmt(caja.ventasCheque),   fontSize: 9, alignment: 'right' }]] : []),
                  ...(caja.ventasVales > 0    ? [[{ text: 'Vales',    fontSize: 9 }, { text: fmt(caja.ventasVales),    fontSize: 9, alignment: 'right' }]] : []),
                  ...(caja.ventasMixto > 0    ? [[{ text: 'Mixto',    fontSize: 9 }, { text: fmt(caja.ventasMixto),    fontSize: 9, alignment: 'right' }]] : []),
                  [{ text: 'TOTAL CAJA:', bold: true, fontSize: 10 }, { text: fmt(caja.ventasTotal), bold: true, fontSize: 10, alignment: 'right', color: '#147a4b' }]
                ]
              },
              margin: [0, 0, 0, 6]
            },
            { text: 'Turnos del día:', fontSize: 9, bold: true, margin: [0, 4, 0, 2] },
            {
              table: {
                widths: [30, '*', 45, 45, 70],
                body: [
                  [
                    { text: '#',       bold: true, fontSize: 8 },
                    { text: 'Cajero',  bold: true, fontSize: 8 },
                    { text: 'Apertura',bold: true, fontSize: 8, alignment: 'center' },
                    { text: 'Cierre',  bold: true, fontSize: 8, alignment: 'center' },
                    { text: 'Fondo',   bold: true, fontSize: 8, alignment: 'right' }
                  ],
                  ...caja.turnos.map((t: Turno) => [
                    { text: String(t.id), fontSize: 8 },
                    { text: t.cajero || '—', fontSize: 8 },
                    { text: hora(t.fechaInicio), fontSize: 8, alignment: 'center' },
                    { text: t.fechaCierre ? hora(t.fechaCierre) : 'Abierto', fontSize: 8, alignment: 'center' },
                    { text: fmt(t.fondoInicial), fontSize: 8, alignment: 'right' }
                  ])
                ]
              },
              margin: [0, 0, 0, 16]
            }
          ]),
          { text: '═'.repeat(60), margin: [0, 4, 0, 8] },
          {
            table: {
              widths: ['*', 120],
              body: [
                [{ text: 'TOTAL GENERAL DEL DÍA:', bold: true, fontSize: 11 }, { text: fmt(this.totalReporteCaja()), bold: true, fontSize: 11, alignment: 'right', color: '#147a4b' }]
              ]
            }
          }
        ]
      };
      pdfMake.createPdf(docDef).open();
    }
  }
}
