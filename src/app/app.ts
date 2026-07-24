import { httpResource } from '@angular/common/http';
import { Component, computed, effect, inject, signal } from '@angular/core';
import pdfMake from 'pdfmake/build/pdfmake';
import pdfFonts from 'pdfmake/build/vfs_fonts';

if (pdfFonts && (pdfFonts as any).pdfMake) {
  (pdfMake as any).vfs = (pdfFonts as any).pdfMake.vfs;
}

import { environment } from '../environments/environment';
import { Cocina } from './features/cocina/cocina';
import { InventarioService } from './features/inventario/inventario.service';
import { UsuariosService } from './features/usuarios/usuarios.service';
import { MesasService } from './features/mesas/mesas.service';
import { ProductosService } from './features/productos/productos.service';
import { CuentaService } from './features/cuenta/cuenta.service';
import { AuditoriaService, AuditExtras } from './core/auditoria.service';
import { ConnectivityService } from './core/connectivity.service';
import { RealtimeService } from './core/realtime.service';
import { NavigationService } from './core/navigation.service';
import { Reportes } from './features/reportes/reportes';
import { Inventario } from './features/inventario/inventario';
import { Config } from './features/config/config';
import { Mesas } from './features/mesas/mesas';
import { Caja } from './features/caja/caja';
import { Auth } from './features/auth/auth';
import { PwaInstall } from './features/pwa-install/pwa-install';
import { RealtimeDebug } from './features/realtime-debug/realtime-debug';
import { Usuario } from './models/usuario';

interface CompanyInfo { name: string; picture: string | null; picture2: string | null; }

const LS_EMPRESA = 'pv_empresa_id';

@Component({
  selector: 'app-root',
  imports: [Cocina, Reportes, Inventario, Config, Mesas, Caja, Auth, PwaInstall, RealtimeDebug],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  private readonly inventarioSvc = inject(InventarioService);
  protected readonly usuariosSvc = inject(UsuariosService);
  protected readonly mesasSvc = inject(MesasService);
  private readonly productosSvc = inject(ProductosService);
  private readonly cuentaSvc = inject(CuentaService);
  private readonly auditoriaSvc = inject(AuditoriaService);
  protected readonly connectivitySvc = inject(ConnectivityService);
  private readonly realtimeSvc = inject(RealtimeService);
  protected readonly navSvc = inject(NavigationService);

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

  constructor() {
    // Mantiene sincronizada la empresa activa en el servicio de inventario
    // (que comparte estado con el modal de producto y las alertas de stock).
    effect(() => this.inventarioSvc.companyId.set(this.companyId()));

    // Sincroniza el usuario logueado y la empresa hacia el logger de auditoría
    // (así cualquier dominio puede registrar en la bitácora sin depender de App).
    effect(() => this.auditoriaSvc.usuario.set(this.usuario()));
    effect(() => this.auditoriaSvc.companyId.set(this.companyId()));
    effect(() => this.mesasSvc.companyId.set(this.companyId()));
    // El store de mesas se carga en el salón y en Caja (para la cola de cobro).
    effect(() => this.mesasSvc.enVista.set(this.navSvc.view() === 'mesas' || this.navSvc.view() === 'cajas'));
    // Conecta el socket de avisos en tiempo real en cuanto se conoce la empresa
    // (una sola vez; conectar() es idempotente). El polling sigue de respaldo.
    effect(() => { if (this.companyId()) this.realtimeSvc.conectar(); });
    // Refresca la lista de "Cobrar mesa" de Cajas al instante — <app-mesas> tiene
    // sus propios efectos para esto, pero esa pantalla vive aquí en App y no se
    // monta mientras el cajero está en Cajas, así que sin esto el aviso llegaba
    // (se veía en el log) pero nadie recargaba mesasResource.
    effect(() => {
      const e = this.realtimeSvc.ultimaPorCobrar();
      if (e && e.idCompany === this.companyId()) this.mesasSvc.mesasResource.reload();
    });
    effect(() => {
      const e = this.realtimeSvc.ultimaCobrada();
      if (e && e.idCompany === this.companyId()) this.mesasSvc.mesasResource.reload();
    });

    // Auto-refresco de mesas (estados + cronómetro + cola de cobro) cada 20 s.
    setInterval(() => {
      const v = this.navSvc.view();
      if (v === 'mesas' || v === 'cajas') this.mesasSvc.refrescar();
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
  // buena guardada (ver shared/util/resource-fallback.ts) en vez de datos frescas.
  protected readonly usandoCache = computed(() =>
    !!this.mesasSvc.mesasResource.error() ||
    !!this.productosSvc.familiasResource.error() ||
    !!this.productosSvc.subfamiliasResource.error() ||
    !!this.productosSvc.productosResource.error() ||
    !!this.cuentaSvc.itemsResource.error(),
  );
  protected readonly pendientesSync = this.cuentaSvc.pendientesCount;

  // ── Usuarios / sesión / roles → viven en UsuariosService (usuario/esAdmin/puedeVer) ──
  protected readonly usuario = this.usuariosSvc.usuario;
  protected readonly esAdmin = this.usuariosSvc.esAdmin;

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
    this.navSvc.backToMenu();
  }

  // Registra un movimiento en la bitácora con el usuario actual (no bloquea si falla).
  protected auditar(accion: string, extras: AuditExtras = {}): void {
    this.auditoriaSvc.auditar(accion, extras);   // logger en AuditoriaService
  }

  // ── Configuración · Usuarios (solo admin) ───────────────────────────────────
  protected readonly usuariosResource = httpResource<Usuario[]>(
    () => {
      const v = this.navSvc.view();
      const enConfig = v === 'config';
      const enAudit  = v === 'reportes';   // carga usuarios para el filtro de auditoría
      return (enConfig || enAudit) && this.esAdmin()
        ? this.usuariosSvc.listUrl(this.companyId()!)
        : undefined;
    },
    { defaultValue: [] },
  );
  protected readonly usuarios = this.usuariosResource.value;
}
