import { httpResource } from '@angular/common/http';
import { Component, computed, effect, inject, signal } from '@angular/core';
import pdfMake from 'pdfmake/build/pdfmake';
import pdfFonts from 'pdfmake/build/vfs_fonts';

if (pdfFonts && (pdfFonts as any).pdfMake) {
  (pdfMake as any).vfs = (pdfFonts as any).pdfMake.vfs;
}

import { environment } from '../environments/environment';
import { Cocina } from './features/cocina/cocina';
import { CocinaService } from './features/cocina/cocina.service';
import { InventarioService } from './features/inventario/inventario.service';
import { CajaService } from './features/caja/caja.service';
import { UsuariosService } from './features/usuarios/usuarios.service';
import { MesasService } from './features/mesas/mesas.service';
import { ProductosService } from './features/productos/productos.service';
import { CuentaService } from './features/cuenta/cuenta.service';
import { AuditoriaService, AuditExtras } from './core/auditoria.service';
import { ConnectivityService } from './core/connectivity.service';
import { RealtimeService } from './core/realtime.service';
import { Reportes } from './features/reportes/reportes';
import { Inventario } from './features/inventario/inventario';
import { Config } from './features/config/config';
import { Mesas } from './features/mesas/mesas';
import { Caja } from './features/caja/caja';
import { Auth } from './features/auth/auth';
import { PwaInstall } from './features/pwa-install/pwa-install';
import { Rol, Usuario } from './models/usuario';
import { Mesa } from './models/mesa';

type RestaurantModule = 'MESAS' | 'CAJAS' | 'REPORTES' | 'INVENTARIO' | 'COCINA' | 'CONFIG';
type View = 'menu' | 'mesas' | 'cajas' | 'reportes' | 'inventario' | 'cocina' | 'config';
type InventarioSubView = 'existencias' | 'alta' | 'movimientos' | 'detalle' | 'equivalencias';

interface CompanyInfo { name: string; picture: string | null; picture2: string | null; }

const LS_EMPRESA = 'pv_empresa_id';

@Component({
  selector: 'app-root',
  imports: [Cocina, Reportes, Inventario, Config, Mesas, Caja, Auth, PwaInstall],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  private readonly cocina = inject(CocinaService);
  private readonly inventarioSvc = inject(InventarioService);
  private readonly cajaSvc = inject(CajaService);
  private readonly usuariosSvc = inject(UsuariosService);
  private readonly mesasSvc = inject(MesasService);
  private readonly productosSvc = inject(ProductosService);
  private readonly cuentaSvc = inject(CuentaService);
  private readonly auditoriaSvc = inject(AuditoriaService);
  protected readonly connectivitySvc = inject(ConnectivityService);
  protected readonly realtimeSvc = inject(RealtimeService);
  protected readonly mostrarDebugRealtime = signal(false);

  // ── Selección de empresa (pantalla → <app-auth>) ──────────────────────────
  protected readonly companyId = signal<number | null>(this.resolveCompanyId());

  private resolveCompanyId(): number | null {
    const param = new URLSearchParams(window.location.search).get('empresa');
    if (param) {
      const n = parseInt(param, 10);
      if (!isNaN(n)) { localStorage.setItem(LS_EMPRESA, String(n)); return n; }
    }
    const stored = localStorage.getItem(LS_EMPRESA);
    return stored ? parseInt(stored, 10) : null;
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
    // Refresca la lista de "Cobrar mesa" de Cajas al instante — <app-mesas> tiene
    // sus propios efectos para esto, pero esa pantalla vive aquí en App y no se
    // monta mientras el cajero está en Cajas, así que sin esto el aviso llegaba
    // (se veía en el log) pero nadie recargaba mesasResource.
    effect(() => {
      const e = this.realtimeSvc.ultimaPorCobrar();
      if (e && e.idCompany === this.companyId()) this.mesasResource.reload();
    });
    effect(() => {
      const e = this.realtimeSvc.ultimaCobrada();
      if (e && e.idCompany === this.companyId()) this.mesasResource.reload();
    });

    // Auto-refresco de mesas (estados + cronómetro + cola de cobro) cada 20 s.
    setInterval(() => {
      if (this.view() === 'mesas' || this.view() === 'cajas') this.mesasTick.update(t => t + 1);
    }, 20000);
  }

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

  protected readonly mesasPorCobrar = computed(
    () => this.mesas().filter(m => this.estadoMesa(m) === 'por_cobrar').length,
  );

  // Cajas → cobrar mesa rápido: monta <app-mesas> directo en la cuenta de esa mesa.
  protected readonly origenCajaMesas = signal(false);
  protected cobrarMesaRapido(m: Mesa): void {
    this.origenCajaMesas.set(true);
    this.cuentaSvc.selectedMesa.set(m);
    this.view.set('mesas');
  }
  /** (back) de <app-mesas>: si se entró desde Cajas, regresa a la lista de cobro; si no, al menú. */
  protected volverDeMesas(): void {
    if (this.origenCajaMesas()) {
      this.origenCajaMesas.set(false);
      this.cuentaSvc.selectedMesa.set(null);
      this.cajaSvc.abrirEnCobro.set(true);
      this.view.set('cajas');
      return;
    }
    this.backToMenu();
  }

  // Estado efectivo (con fallback si el backend aún no lo envía).
  protected estadoMesa(m: Mesa): string {
    return this.mesasSvc.estadoMesa(m);   // store
  }


  // ── Navegación ────────────────────────────────────────────────────────────
  // ── Usuarios / sesión / roles ─────────────────────────────────────────────
  // La sesión (login por PIN) vive en UsuariosService — pantalla en <app-auth>.
  protected readonly usuario = this.usuariosSvc.usuario;

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
    this.usuariosSvc.logout();
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
    if (module === 'MESAS') { this.origenCajaMesas.set(false); this.view.set('mesas'); }
    if (module === 'CAJAS') {
      this.cajaSvc.turnoActivo.set(null);
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

  // ── Cocina (KDS) → extraído a features/cocina (componente <app-cocina>) ──────

  // exportarExistencias → movido al componente <app-inventario>


  // ── Navegación atrás ──────────────────────────────────────────────────────
  // Botón "🍽️ Mesas" de la barra superior: fuerza al componente <app-mesas> a
  // volver al salón poniendo la mesa en null (su effect resetea la sub-vista),
  // incluso si ya estaba montado en familias/productos/cuenta.
  protected backToMesas(): void {
    this.origenCajaMesas.set(false);
    this.cuentaSvc.selectedMesa.set(null);
    this.view.set('mesas');
  }

  protected backToMenu(): void {
    this.view.set('menu');
    this.cuentaSvc.selectedMesa.set(null);
    this.cajaSvc.turnoActivo.set(null);
  }
}
