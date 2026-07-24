import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { AuditoriaService } from '../../core/auditoria.service';
import { EmpresaItem, EmpresaService } from '../empresa/empresa.service';
import { UsuariosService } from '../usuarios/usuarios.service';

const LS_EMPRESA = 'pv_empresa_id';

/**
 * Puerta de entrada de la app: selección de empresa (super-usuario), la clave
 * para poder cambiar de empresa una vez dentro, y el login por PIN. Vive
 * montado siempre en App (fuera del <main> del dashboard) porque "cambiar
 * empresa" puede dispararse desde el menú incluso ya logueado.
 *
 * La sesión (`usuario`) vive en UsuariosService, no aquí, porque el resto de
 * App (permisos, topbar, checador) también la necesita.
 */
@Component({
  selector: 'app-auth',
  templateUrl: './auth.html',
  styleUrl: './auth.scss',
})
export class Auth {
  private readonly empresaSvc = inject(EmpresaService);
  private readonly auditoriaSvc = inject(AuditoriaService);
  protected readonly usuariosSvc = inject(UsuariosService);

  readonly companyId   = input<number | null>(null);
  readonly companyName = input('');
  readonly companyLogo = input<string | null>(null);

  // ── Selección de empresa ──────────────────────────────────────────────────
  // Se muestra si aún no hay empresa guardada, o si el usuario pidió cambiarla.
  private readonly abrirSelEmpresa = signal(false);
  protected readonly mostrarSelEmpresa = computed(() => !this.companyId() || this.abrirSelEmpresa());
  protected readonly empresas    = signal<EmpresaItem[]>([]);
  protected readonly cargandoEmpresas = signal(false);

  constructor() {
    effect(() => { if (this.mostrarSelEmpresa()) void this.cargarEmpresas(); });
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
    // recargar para que todos los resources reactivos de App se actualicen
    window.location.replace(window.location.pathname + `?empresa=${e.id}`);
  }

  // Clave requerida para poder cambiar de empresa (evita que un usuario
  // normal salga de su propia empresa).
  private static readonly CLAVE_CAMBIO_EMPRESA = 'QAdmin9317';
  protected readonly pedirClave = signal(false);
  protected readonly claveInput = signal('');
  protected readonly claveError = signal('');

  /** Llamado desde App (vía referencia de plantilla) al pulsar "Cambiar empresa". */
  cambiarEmpresa(): void {
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
    if (this.claveInput() !== Auth.CLAVE_CAMBIO_EMPRESA) {
      this.claveError.set('Contraseña incorrecta.');
      return;                                        // se queda en su empresa
    }
    this.pedirClave.set(false);
    this.claveInput.set('');
    this.claveError.set('');
    this.abrirSelEmpresa.set(true);
  }

  // ── Login por PIN ────────────────────────────────────────────────────────
  protected readonly loginPin        = signal('');
  protected readonly loginError      = signal('');
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
      this.usuariosSvc.setUsuario(u);
      this.loginPin.set('');
      this.auditoriaSvc.auditar('LOGIN', { descripcion: `Entró ${u.nombre} (${u.rol})` });
    } catch {
      this.loginError.set('PIN incorrecto.');
    } finally {
      this.loginProcesando.set(false);
    }
  }

  // ── Mostrar/ocultar claves (botón 👁) ────────────────────────────────────
  private readonly clavesVisibles = signal<ReadonlySet<string>>(new Set<string>());
  protected verClave(id: string): boolean { return this.clavesVisibles().has(id); }
  protected toggleClave(id: string): void {
    const s = new Set(this.clavesVisibles());
    if (s.has(id)) s.delete(id); else s.add(id);
    this.clavesVisibles.set(s);
  }
}
