import { CurrencyPipe, DatePipe } from '@angular/common';
import { httpResource } from '@angular/common/http';
import { Component, computed, effect, inject, signal } from '@angular/core';
import pdfMake from 'pdfmake/build/pdfmake';
import pdfFonts from 'pdfmake/build/vfs_fonts';

if (pdfFonts && (pdfFonts as any).pdfMake) {
  (pdfMake as any).vfs = (pdfFonts as any).pdfMake.vfs;
}

import { environment } from '../environments/environment';
import { CajaInfo, EgresoCaja, ResumenCorte, Turno, VentaPorTipo } from './models/caja';
import { Cocina } from './features/cocina/cocina';
import { CocinaService } from './features/cocina/cocina.service';
import { InventarioService } from './features/inventario/inventario.service';
import { CajaService } from './features/caja/caja.service';
import { UsuariosService } from './features/usuarios/usuarios.service';
import { ConfigService } from './features/config/config.service';
import { MesasService } from './features/mesas/mesas.service';
import { ProductosService } from './features/productos/productos.service';
import { CuentaService } from './features/cuenta/cuenta.service';
import { EmpresaService } from './features/empresa/empresa.service';
import { AuditoriaService, AuditExtras } from './core/auditoria.service';
import { ConnectivityService } from './core/connectivity.service';
import { RealtimeService } from './core/realtime.service';
import { Reportes } from './features/reportes/reportes';
import { Inventario } from './features/inventario/inventario';
import { Config } from './features/config/config';
import { Mesas } from './features/mesas/mesas';
import { Rol, Usuario } from './models/usuario';
import { Mesa } from './models/mesa';
import { sonarCampana } from './shared/util/campana';

type RestaurantModule = 'MESAS' | 'CAJAS' | 'REPORTES' | 'INVENTARIO' | 'COCINA' | 'CONFIG';
type View = 'menu' | 'mesas' | 'cajas' | 'reportes' | 'inventario' | 'cocina' | 'config';
type InventarioSubView = 'existencias' | 'alta' | 'movimientos' | 'detalle' | 'equivalencias';

interface CompanyInfo { name: string; picture: string | null; picture2: string | null; }
interface EmpresaItem  { id: number; name: string; picture: string | null; }

const LS_EMPRESA = 'pv_empresa_id';

@Component({
  selector: 'app-root',
  imports: [CurrencyPipe, DatePipe, Cocina, Reportes, Inventario, Config, Mesas],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  private readonly cocina = inject(CocinaService);
  private readonly inventarioSvc = inject(InventarioService);
  private readonly cajaSvc = inject(CajaService);
  private readonly usuariosSvc = inject(UsuariosService);
  private readonly configSvc = inject(ConfigService);
  private readonly mesasSvc = inject(MesasService);
  private readonly productosSvc = inject(ProductosService);
  private readonly cuentaSvc = inject(CuentaService);
  private readonly empresaSvc = inject(EmpresaService);
  private readonly auditoriaSvc = inject(AuditoriaService);
  protected readonly connectivitySvc = inject(ConnectivityService);
  protected readonly realtimeSvc = inject(RealtimeService);
  protected readonly mostrarDebugRealtime = signal(false);

  // ── Selección de empresa ──────────────────────────────────────────────────
  protected readonly companyId   = signal<number | null>(this.resolveCompanyId());
  protected readonly selEmpresa  = signal(false);   // mostrar pantalla de selección
  protected readonly empresas    = signal<EmpresaItem[]>([]);
  protected readonly cargandoEmpresas = signal(false);

  private resolveCompanyId(): number | null {
    const param = new URLSearchParams(window.location.search).get('empresa');
    if (param) {
      const n = parseInt(param, 10);
      if (!isNaN(n)) { localStorage.setItem(LS_EMPRESA, String(n)); return n; }
    }
    const stored = localStorage.getItem(LS_EMPRESA);
    return stored ? parseInt(stored, 10) : null;
  }

  protected async cargarEmpresas(): Promise<void> {
    this.cargandoEmpresas.set(true);
    try {
      const lista = await this.empresaSvc.listaPublica();
      this.empresas.set(lista ?? []);
    } finally {
      this.cargandoEmpresas.set(false);
    }
  }

  protected seleccionarEmpresa(e: EmpresaItem): void {
    localStorage.setItem(LS_EMPRESA, String(e.id));
    this.companyId.set(e.id);
    this.selEmpresa.set(false);
    // recargar para que todos los resources reactivos se actualicen
    window.location.replace(window.location.pathname + `?empresa=${e.id}`);
  }

  // Clave requerida para poder cambiar de empresa (evita que un usuario
  // normal salga de su propia empresa).
  private static readonly CLAVE_CAMBIO_EMPRESA = 'QAdmin9317';
  // El PIN de supervisor ahora se valida en el backend (por empresa); default 'Super2026'.
  protected readonly pedirClave  = signal(false);
  protected readonly claveInput  = signal('');
  protected readonly claveError  = signal('');

  protected cambiarEmpresa(): void {
    this.claveInput.set('');
    this.claveError.set('');
    this.pedirClave.set(true);
  }

  protected cancelarClave(): void {
    this.pedirClave.set(false);
    this.claveInput.set('');
    this.claveError.set('');
  }

  protected confirmarClave(): void {
    if (this.claveInput() !== App.CLAVE_CAMBIO_EMPRESA) {
      this.claveError.set('Contraseña incorrecta.');
      return;                                        // se queda en su empresa
    }
    this.pedirClave.set(false);
    this.claveInput.set('');
    this.claveError.set('');
    this.cargarEmpresas();
    this.selEmpresa.set(true);
  }

  // ── Vista principal ────────────────────────────────────────────────────────
  protected readonly view = signal<View>('menu');
  // Módulo activo (para resaltar los accesos rápidos de arriba).
  protected readonly moduloActivo = computed<RestaurantModule | 'MENU'>(() => {
    switch (this.view()) {
      case 'mesas': return 'MESAS';
      case 'cajas': return 'CAJAS';
      case 'cocina': return 'COCINA';
      case 'reportes': return 'REPORTES';
      case 'inventario': return 'INVENTARIO';
      case 'config': return 'CONFIG';
      default: return 'MENU';
    }
  });
  // ── Cajas / Turno ─────────────────────────────────────────────────────────
  protected readonly cajasResource = httpResource<CajaInfo[]>(
    () => this.view() === 'cajas'
      ? this.cajaSvc.cajasUrl(this.companyId()!)
      : undefined,
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
    () => this.view() === 'cajas' && this.cajasSubView() === 'devolucion'
      ? this.cuentaSvc.cobrosDiaUrl(this.companyId()!, new Date().toISOString().split('T')[0])
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
      const r: any = await this.usuariosSvc.validarPin(this.companyId()!, this.devPin());
      if (!r?.ok) { this.devError.set('PIN de supervisor incorrecto.'); return; }

      const ref = this.devRef().trim();
      const motivo = this.devMotivo().trim();
      const desc = `Devolución${ref ? ' ticket ' + ref : ''}${motivo ? ': ' + motivo : ''}`;

      // 2) Registrar la salida de caja (egreso) → el corte lo resta
      await this.cajaSvc.registrarEgreso(turno.id, desc, monto);

      // 3) Bitácora de autorización (auditoría)
      try {
        await this.cuentaSvc.registrarAutorizacion(
          { idCompany: this.companyId()!, tipo: 'DEVOLUCION', descripcion: ref || null,
            monto, motivo: motivo || null, autorizadoPor: this.devPor().trim() });
      } catch { /* la salida ya quedó registrada */ }

      // Si se eligió un cobro del día, marca la venta como cancelada en el reporte.
      const cta = this.devCuentaSel();
      if (cta != null) {
        try {
          await this.cuentaSvc.cancelarVenta(cta, this.companyId()!);
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

  // Consulta turno activo en cuanto se conoce la caja y se está en la vista
  protected readonly turnoActivoResource = httpResource<Turno | null>(
    () => {
      const caja = this.cajaSeleccionada();
      if (!caja || this.view() !== 'cajas') return undefined;
      return this.cajaSvc.turnoActivoUrl(caja.idCaja);
    },
  );

  constructor() {
    // Mantiene sincronizada la empresa activa en el servicio de inventario
    // (que comparte estado con el modal de producto y las alertas de stock).
    effect(() => this.inventarioSvc.companyId.set(this.companyId()));

    // Sincroniza el usuario logueado y la empresa hacia el logger de auditoría
    // (así cualquier dominio puede registrar en la bitácora sin depender de App).
    effect(() => this.auditoriaSvc.usuario.set(this.usuario()));
    effect(() => this.auditoriaSvc.companyId.set(this.companyId()));
    effect(() => this.cajaSvc.companyId.set(this.companyId()));
    effect(() => this.mesasSvc.companyId.set(this.companyId()));
    // El store de mesas se carga en el salón y en Caja (para la cola de cobro).
    effect(() => this.mesasSvc.enVista.set(this.view() === 'mesas' || this.view() === 'cajas'));
    // Conecta el socket de avisos en tiempo real en cuanto se conoce la empresa
    // (una sola vez; conectar() es idempotente). El polling sigue de respaldo.
    effect(() => { if (this.companyId()) this.realtimeSvc.conectar(); });

    // Si no hay empresa guardada, carga lista y muestra selección
    if (!this.companyId()) {
      void this.cargarEmpresas();
      this.selEmpresa.set(true);
    }
    // Cuando el recurso resuelve un turno abierto, lo activa automáticamente
    effect(() => {
      const t = this.turnoActivoResource.value();
      if (t && !this.turnoActivo()) {
        this.turnoActivo.set(t);
      }
    });


    // Suena la campana en caja cuando el mesero envía una mesa a cobrar (aviso
    // mesero→caja). Solo mientras se está viendo el módulo de Cajas. (Los avisos
    // cocina→mesero y caja→mesero viven ahora en el componente <app-mesas>.)
    effect(() => {
      if (this.view() !== 'cajas') return;
      const ids = this.mesasSvc.colaCobro().map(m => m.id);
      const hayNueva = ids.some(id => !this.porCobrarAvisadas.has(id));
      this.porCobrarAvisadas = new Set(ids);
      if (hayNueva) sonarCampana();
    });

    // Auto-refresco de mesas (estados + cronómetro + cola de cobro) cada 20 s.
    setInterval(() => {
      if (this.view() === 'mesas' || this.view() === 'cajas') this.mesasTick.update(t => t + 1);
    }, 20000);

    const yaInstalada = window.matchMedia?.('(display-mode: standalone)').matches
      || (navigator as any).standalone === true;
    this.appStandalone.set(!!yaInstalada);
    if (!yaInstalada) {
      if ((window as any).__deferredInstallPrompt) this.puedeInstalar.set(true);
      window.addEventListener('pwa-installable', () => this.puedeInstalar.set(true));
      window.addEventListener('pwa-installed',   () => { this.puedeInstalar.set(false); this.appStandalone.set(true); });
    }
  }

  protected readonly appStandalone = signal(false);

  // ── Instalación PWA ─────────────────────────────────────────────────────────
  protected readonly puedeInstalar = signal(false);
  protected async instalarApp(): Promise<void> {
    const p = (window as any).__deferredInstallPrompt;
    if (!p) {
      // El navegador no ofreció el evento (ej. Samsung Internet o ya instalada):
      // guiar al usuario al menú del navegador.
      this.mostrarAyudaInstalar.set(true);
      return;
    }
    p.prompt();
    try { await p.userChoice; } catch { /* cancelado */ }
    (window as any).__deferredInstallPrompt = null;
    this.puedeInstalar.set(false);
  }
  protected readonly mostrarAyudaInstalar = signal(false);

  // ── Egresos ──────────────────────────────────────────────────────────────
  protected readonly egresoDesc = signal('');
  protected readonly egresoMonto = signal<number | null>(null);
  protected readonly registrandoEgreso = signal(false);
  protected readonly egresoError = signal('');
  protected readonly egresosLista = signal<EgresoCaja[]>([]);

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

  // ── Reportes → extraído a features/reportes (componente <app-reportes>) ──────

  // ── Inventario → vista extraída a features/inventario (<app-inventario>) ─────
  // El estado compartido con el modal de producto vive en InventarioService;
  // aquí quedan solo alias para el modal de editar producto y la receta.
  protected readonly equivalencias = this.inventarioSvc.equivalencias;
  protected readonly cfgControla   = this.inventarioSvc.cfgControla;
  protected readonly cfgVendeCopa  = this.inventarioSvc.cfgVendeCopa;
  protected readonly cfgIdEquiv    = this.inventarioSvc.cfgIdEquiv;
  protected readonly cfgPrecioCopa = this.inventarioSvc.cfgPrecioCopa;
  protected readonly cfgStockMin   = this.inventarioSvc.cfgStockMin;
  protected setCfgControla(e: Event): void { this.inventarioSvc.setCfgControla(e); }
  protected setCfgVendeCopa(e: Event): void { this.inventarioSvc.setCfgVendeCopa(e); }
  protected setCfgIdEquiv(e: Event): void { this.inventarioSvc.setCfgIdEquiv(e); }
  protected setCfgPrecioCopa(e: Event): void { this.inventarioSvc.setCfgPrecioCopa(e); }
  protected setCfgStockMin(e: Event): void { this.inventarioSvc.setCfgStockMin(e); }

  // ── Empresa ───────────────────────────────────────────────────────────────
  protected readonly companyResource = httpResource<CompanyInfo>(
    () => this.companyId()
      ? `${environment.urlSmp}/Root/${this.companyId()}/pdf-info`
      : undefined,
  );
  protected readonly companyName = computed(
    () => this.companyResource.value()?.name?.trim() || 'Cargando empresa…',
  );
  protected readonly companyLogo = computed(
    () => this.companyResource.value()?.picture ?? null,
  );
  protected readonly appVersion = environment.version;

  // ── Conectividad (offline Nivel 1/2) ────────────────────────────────────────
  // Si alguno de estos recursos está fallando, se está mostrando la última copia
  // buena guardada (ver shared/util/resource-fallback.ts) en vez de datos frescos.
  protected readonly usandoCache = computed(() =>
    !!this.mesasSvc.mesasResource.error() ||
    !!this.productosSvc.familiasResource.error() ||
    !!this.productosSvc.subfamiliasResource.error() ||
    !!this.productosSvc.productosResource.error() ||
    !!this.cuentaSvc.itemsResource.error(),
  );
  protected readonly pendientesSync = this.cuentaSvc.pendientesCount;

  // ── Mesas → estado en MesasService (store); alias para plantilla/métodos ─────
  protected readonly mesasTick     = this.mesasSvc.tick;
  protected readonly mesasResource = this.mesasSvc.mesasResource;
  protected readonly mesas         = this.mesasSvc.mesas;

  // Cuentas ya avisadas a caja (para sonar la campana solo cuando aparece una NUEVA).
  private porCobrarAvisadas = new Set<number>();

  protected readonly loading = this.mesasResource.isLoading;
  protected readonly mesasPorCobrar = computed(
    () => this.mesas().filter(m => this.estadoMesa(m) === 'por_cobrar').length,
  );

  // Colas de cobro → MesasService (store).
  protected readonly mesasParaCobrar = this.mesasSvc.mesasParaCobrar;
  protected readonly colaCobro       = this.mesasSvc.colaCobro;
  protected minutosEsperando(m: Mesa): number {
    if (!m.porCobrarAt) return 0;
    return Math.max(0, Math.floor((Date.now() - Date.parse(m.porCobrarAt)) / 60000));
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
  // Cajas → cobrar mesa rápido: monta <app-mesas> directo en la cuenta de esa mesa.
  protected cobrarMesaRapido(m: Mesa): void {
    this.cuentaSvc.selectedMesa.set(m);
    this.view.set('mesas');
  }

  // Estado efectivo (con fallback si el backend aún no lo envía).
  protected estadoMesa(m: Mesa): string {
    return this.mesasSvc.estadoMesa(m);   // store
  }


  // ── Navegación ────────────────────────────────────────────────────────────
  // ── Usuarios / login por PIN / roles ────────────────────────────────────────
  private static readonly LS_USUARIO = 'pv_usuario';
  protected readonly usuario = signal<Usuario | null>(this.restoreUsuario());
  private restoreUsuario(): Usuario | null {
    try { const s = localStorage.getItem(App.LS_USUARIO); return s ? JSON.parse(s) : null; } catch { return null; }
  }
  protected readonly loginPin      = signal('');
  protected readonly loginError    = signal('');
  protected readonly loginProcesando = signal(false);
  protected pushPin(d: string): void { if (this.loginPin().length < 20) this.loginPin.update(p => p + d); this.loginError.set(''); }
  protected borrarPin(): void { this.loginPin.update(p => p.slice(0, -1)); }
  protected limpiarPin(): void { this.loginPin.set(''); }
  // Modo texto para escribir un PIN con letras (llave maestra de admin).
  protected readonly loginModoTexto = signal(false);
  protected toggleLoginTexto(): void { this.loginModoTexto.update(v => !v); this.loginPin.set(''); this.loginError.set(''); }
  protected setLoginPin(e: Event): void { this.loginPin.set((e.target as HTMLInputElement).value); this.loginError.set(''); }

  protected async login(): Promise<void> {
    const pin = this.loginPin();
    if (pin.length < 4) { this.loginError.set('Ingresa tu PIN (4+ dígitos).'); return; }
    this.loginProcesando.set(true);
    this.loginError.set('');
    try {
      const u = await this.usuariosSvc.login(this.companyId()!, pin);
      this.usuario.set(u);
      localStorage.setItem(App.LS_USUARIO, JSON.stringify(u));
      this.loginPin.set('');
      this.view.set('menu');
      this.auditar('LOGIN', { descripcion: `Entró ${u.nombre} (${u.rol})` });
    } catch {
      this.loginError.set('PIN incorrecto.');
    } finally {
      this.loginProcesando.set(false);
    }
  }

  // ── Checador (entrada / salida) ─────────────────────────────────────────────
  protected readonly checando = signal(false);
  protected readonly checarMsg = signal('');
  protected async checar(): Promise<void> {
    const u = this.usuario();
    if (!u) return;
    this.checando.set(true);
    try {
      const r: any = await this.usuariosSvc.checar(this.companyId()!, u.id || null, u.nombre);
      this.checarMsg.set(r?.tipo === 'SALIDA' ? '👋 Salida registrada' : '✅ Entrada registrada');
      setTimeout(() => this.checarMsg.set(''), 4000);
    } catch { this.checarMsg.set('No se pudo checar.'); }
    finally { this.checando.set(false); }
  }

  protected cerrarSesion(): void {
    this.auditar('LOGOUT', {});
    this.usuario.set(null);
    localStorage.removeItem(App.LS_USUARIO);
    this.loginPin.set('');
    this.view.set('menu');
  }

  // Registra un movimiento en la bitácora con el usuario actual (no bloquea si falla).
  protected auditar(accion: string, extras: AuditExtras = {}): void {
    this.auditoriaSvc.auditar(accion, extras);   // logger en AuditoriaService
  }

  // Permisos por rol. mesero: mesas/cocina · cajero: + cajas/reportes/inventario · admin: todo
  protected puedeVer(module: RestaurantModule): boolean {
    const rol: Rol = this.usuario()?.rol ?? 'mesero';
    if (module === 'MESAS' || module === 'COCINA') return true;
    if (module === 'CONFIG') return rol === 'admin';
    // CAJAS, REPORTES, INVENTARIO
    return rol === 'cajero' || rol === 'admin';
  }
  protected readonly esAdmin = computed(() => this.usuario()?.rol === 'admin');

  protected selectModule(module: RestaurantModule): void {
    if (!this.puedeVer(module)) return;   // sin permiso, no entra
    this.abrirModulo(module);
  }

  private abrirModulo(module: RestaurantModule): void {
    if (module === 'MESAS') this.view.set('mesas');
    if (module === 'CAJAS') {
      this.cajaNombre.set('');
      this.fondoInicial.set(null);
      this.turnoActivo.set(null);
      this.turnoError.set('');
      this.view.set('cajas');
    }
    if (module === 'REPORTES') {
      this.view.set('reportes');   // el componente <app-reportes> maneja subvista y fecha
    }
    if (module === 'INVENTARIO') {
      this.view.set('inventario');   // el componente <app-inventario> maneja la subvista
    }
    if (module === 'COCINA') {
      this.view.set('cocina');   // el componente <app-cocina> carga y se refresca solo
    }
    if (module === 'CONFIG') {
      this.view.set('config');   // el componente <app-config> maneja su estado
    }
  }

  // Envía una alerta a Telegram (no bloquea si falla).
  private enviarAlerta(mensaje: string): void {
    this.configSvc.enviarAlerta(this.companyId()!, mensaje);
  }

  // ── Configuración · Usuarios (solo admin) ───────────────────────────────────
  protected readonly usuariosResource = httpResource<Usuario[]>(
    () => {
      const enConfig = this.view() === 'config';
      const enAudit  = this.view() === 'reportes';   // carga usuarios para el filtro de auditoría
      return (enConfig || enAudit) && this.esAdmin()
        ? this.usuariosSvc.listUrl(this.companyId()!)
        : undefined;
    },
    { defaultValue: [] },
  );
  protected readonly usuarios = this.usuariosResource.value;

  // ── Mostrar/ocultar claves (botón 👁 junto a cada campo de PIN/contraseña) ──
  private readonly clavesVisibles = signal<ReadonlySet<string>>(new Set<string>());
  protected verClave(id: string): boolean { return this.clavesVisibles().has(id); }
  protected toggleClave(id: string): void {
    const s = new Set(this.clavesVisibles());
    if (s.has(id)) s.delete(id); else s.add(id);
    this.clavesVisibles.set(s);
  }

  // ── Cocina (KDS) → extraído a features/cocina (componente <app-cocina>) ──────

  protected setCajaNombre(e: Event): void {
    this.cajaNombre.set((e.target as HTMLInputElement).value);
  }

  protected setFondoInicial(e: Event): void {
    const val = +(e.target as HTMLInputElement).value;
    this.fondoInicial.set(val >= 0 ? val : null);
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

  // ── Egresos ──────────────────────────────────────────────────────────────
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

  private async logoToDataUrl(): Promise<string | null> {
    const url = this.companyLogo();
    if (!url) return null;
    if (url.startsWith('data:')) return url;
    try {
      const res = await fetch(url);
      const blob = await res.blob();
      return await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    } catch { return null; }
  }

  protected async imprimirCorte(): Promise<void> {
    const corte = this.corteResumenSnapshot();
    if (!corte) return;

    const t = corte.turno;
    const logo = await this.logoToDataUrl();
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

  // exportarExistencias → movido al componente <app-inventario>


  // ── Navegación atrás ──────────────────────────────────────────────────────
  // Botón "🍽️ Mesas" de la barra superior: fuerza al componente <app-mesas> a
  // volver al salón poniendo la mesa en null (su effect resetea la sub-vista),
  // incluso si ya estaba montado en familias/productos/cuenta.
  protected backToMesas(): void {
    this.cuentaSvc.selectedMesa.set(null);
    this.view.set('mesas');
  }

  protected backToMenu(): void {
    this.view.set('menu');
    this.cuentaSvc.selectedMesa.set(null);
    this.turnoActivo.set(null);
    this.turnoError.set('');
  }
}
