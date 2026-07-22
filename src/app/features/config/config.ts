import { HttpClient, httpResource } from '@angular/common/http';
import { Component, ViewEncapsulation, effect, inject, input, output, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { Impresora } from '../../models/impresora';
import { Rol, Usuario } from '../../models/usuario';
import { UsuariosService } from '../usuarios/usuarios.service';
import { ConfigService } from './config.service';

/**
 * Vista de Configuración (solo se llega con permiso): impresoras de red, PIN de
 * supervisor y, para admin, usuarios/roles y alertas de Telegram.
 *
 * `usuarios` llega como input desde App (que también lo comparte con Reportes);
 * al crear/editar/borrar, el componente emite `usuariosChanged` para que App
 * recargue su recurso. Encapsulation.None por las clases compartidas.
 */
@Component({
  selector: 'app-config',
  templateUrl: './config.html',
  styleUrl: './config.scss',
  encapsulation: ViewEncapsulation.None,
})
export class Config {
  private readonly configSvc = inject(ConfigService);
  private readonly usuariosSvc = inject(UsuariosService);
  private readonly http = inject(HttpClient);

  readonly companyId = input.required<number>();
  readonly esAdmin   = input.required<boolean>();
  readonly usuarios  = input<Usuario[]>([]);
  readonly back            = output<void>();
  readonly usuariosChanged = output<void>();

  // ── Mostrar/ocultar claves (👁) — estado de UI propio de esta vista ──────────
  private readonly clavesVisibles = signal<ReadonlySet<string>>(new Set<string>());
  protected verClave(id: string): boolean { return this.clavesVisibles().has(id); }
  protected toggleClave(id: string): void {
    const s = new Set(this.clavesVisibles());
    if (s.has(id)) s.delete(id); else s.add(id);
    this.clavesVisibles.set(s);
  }

  // ── Impresoras ──────────────────────────────────────────────────────────────
  protected readonly impresorasResource = httpResource<Impresora[]>(
    () => this.configSvc.impresorasListUrl(this.companyId()),
    { defaultValue: [] },
  );
  protected readonly impresoras        = this.impresorasResource.value;
  protected readonly impresorasLoading = this.impresorasResource.isLoading;

  protected readonly showImpForm = signal(false);
  protected readonly impEditId   = signal<number | null>(null);
  protected readonly impNombre   = signal('');
  protected readonly impIp       = signal('');
  protected readonly impPuerto   = signal<number | null>(9100);
  protected readonly guardandoImp = signal(false);
  protected readonly impError    = signal('');
  protected readonly probandoImp = signal<number | null>(null);
  protected readonly impTestMsg  = signal<{ id: number; ok: boolean; msg: string } | null>(null);

  protected readonly impPresets: { nombre: string; puerto: number; nota: string }[] = [
    { nombre: 'Epson TM-T20III (Ethernet)', puerto: 9100, nota: 'Estándar de oro · caja' },
    { nombre: 'Epson TM-m30 II (Eth/WiFi)', puerto: 9100, nota: 'Compacta · mostrador' },
    { nombre: 'Star TSP143 IIILAN',          puerto: 9100, nota: 'Confiable · LAN' },
    { nombre: 'Xprinter XP-N160II (Eth)',    puerto: 9100, nota: 'Económica' },
    { nombre: '3nStar RPT008 (Ethernet)',    puerto: 9100, nota: 'Económica LATAM' },
    { nombre: 'Epson TM-U220B (Ethernet)',   puerto: 9100, nota: 'Impacto · cocina (aguanta calor)' },
    { nombre: 'Otra / genérica ESC-POS',     puerto: 9100, nota: '80mm por red' },
  ];
  protected aplicarPreset(e: Event): void {
    const i = parseInt((e.target as HTMLSelectElement).value, 10);
    const p = this.impPresets[i];
    if (!p) return;
    this.impPuerto.set(p.puerto);
    if (!this.impNombre().trim()) this.impNombre.set(p.nombre);
  }
  protected setImpNombre(e: Event): void { this.impNombre.set((e.target as HTMLInputElement).value); }
  protected setImpIp(e: Event): void { this.impIp.set((e.target as HTMLInputElement).value); }
  protected setImpPuerto(e: Event): void {
    const v = parseInt((e.target as HTMLInputElement).value, 10);
    this.impPuerto.set(!isNaN(v) && v > 0 ? v : null);
  }
  protected nuevaImpresora(): void {
    this.impEditId.set(null);
    this.impNombre.set('');
    this.impIp.set('');
    this.impPuerto.set(9100);
    this.impError.set('');
    this.showImpForm.set(true);
  }
  protected editarImpresora(i: Impresora): void {
    this.impEditId.set(i.id);
    this.impNombre.set(i.nombre);
    this.impIp.set(i.ipAddress);
    this.impPuerto.set(i.puerto);
    this.impError.set('');
    this.showImpForm.set(true);
  }
  protected cerrarImpForm(): void { this.showImpForm.set(false); }
  protected async guardarImpresora(): Promise<void> {
    const nombre = this.impNombre().trim();
    const ip = this.impIp().trim();
    if (!nombre) { this.impError.set('El nombre es obligatorio.'); return; }
    if (!ip) { this.impError.set('La dirección IP es obligatoria.'); return; }
    this.guardandoImp.set(true);
    this.impError.set('');
    const id = this.impEditId();
    const body = { id: id ?? 0, idCompany: this.companyId(), nombre, ipAddress: ip, puerto: this.impPuerto() ?? 9100, activo: true };
    const url = this.configSvc.impresorasBaseUrl();
    try {
      if (id === null) await firstValueFrom(this.http.post(url, body));
      else await firstValueFrom(this.http.put(`${url}/${id}`, body));
      this.showImpForm.set(false);
      this.impresorasResource.reload();
    } catch {
      this.impError.set('No se pudo guardar la impresora.');
    } finally {
      this.guardandoImp.set(false);
    }
  }
  protected async eliminarImpresora(i: Impresora): Promise<void> {
    try {
      await firstValueFrom(this.http.delete(this.configSvc.impresoraDeleteUrl(i.id)));
      this.impresorasResource.reload();
    } catch { /* noop */ }
  }
  protected async probarImpresora(i: Impresora): Promise<void> {
    this.probandoImp.set(i.id);
    this.impTestMsg.set(null);
    try {
      await firstValueFrom(this.http.post(
        this.configSvc.impresoraTestUrl(),
        { ip: i.ipAddress, puerto: i.puerto, nombre: i.nombre }));
      this.impTestMsg.set({ id: i.id, ok: true, msg: 'Ticket de prueba enviado ✓' });
    } catch (err: any) {
      this.impTestMsg.set({ id: i.id, ok: false, msg: err?.error?.error ?? 'No se pudo conectar con la impresora.' });
    } finally {
      this.probandoImp.set(null);
    }
  }

  // ── Usuarios (solo admin; la lista llega por input) ─────────────────────────
  protected readonly showUserForm = signal(false);
  protected readonly userEditId  = signal<number | null>(null);
  protected readonly userNombre  = signal('');
  protected readonly userPin     = signal('');
  protected readonly userRol     = signal<Rol>('mesero');
  protected readonly guardandoUser = signal(false);
  protected readonly userError   = signal('');
  protected setUserNombre(e: Event): void { this.userNombre.set((e.target as HTMLInputElement).value); }
  protected setUserPin(e: Event): void { this.userPin.set((e.target as HTMLInputElement).value); }
  protected setUserRol(e: Event): void { this.userRol.set((e.target as HTMLSelectElement).value as Rol); }
  protected nuevoUsuario(): void {
    this.userEditId.set(null); this.userNombre.set(''); this.userPin.set('');
    this.userRol.set('mesero'); this.userError.set(''); this.showUserForm.set(true);
  }
  protected editarUsuario(u: Usuario): void {
    this.userEditId.set(u.id); this.userNombre.set(u.nombre); this.userPin.set('');
    this.userRol.set(u.rol); this.userError.set(''); this.showUserForm.set(true);
  }
  protected cerrarUserForm(): void { this.showUserForm.set(false); }
  protected async guardarUsuario(): Promise<void> {
    const nombre = this.userNombre().trim();
    if (!nombre) { this.userError.set('El nombre es obligatorio.'); return; }
    const id = this.userEditId();
    if (id === null && this.userPin().trim().length < 4) { this.userError.set('El PIN debe tener 4+ dígitos.'); return; }
    this.guardandoUser.set(true);
    this.userError.set('');
    const body = { idCompany: this.companyId(), nombre, pin: this.userPin().trim() || null, rol: this.userRol() };
    const base = this.usuariosSvc.baseUrl();
    try {
      if (id === null) await firstValueFrom(this.http.post(base, body));
      else await firstValueFrom(this.http.put(`${base}/${id}`, body));
      this.showUserForm.set(false);
      this.usuariosChanged.emit();
    } catch (err: any) {
      this.userError.set(err?.error?.error ?? 'No se pudo guardar el usuario.');
    } finally {
      this.guardandoUser.set(false);
    }
  }
  protected async eliminarUsuario(u: Usuario): Promise<void> {
    try {
      await firstValueFrom(this.http.delete(this.usuariosSvc.deleteUrl(u.id, this.companyId())));
      this.usuariosChanged.emit();
    } catch { /* noop */ }
  }

  // ── PIN de supervisor ───────────────────────────────────────────────────────
  protected readonly pinActual = signal('');
  protected readonly pinNuevo  = signal('');
  protected readonly guardandoPin = signal(false);
  protected readonly pinMsg    = signal<{ ok: boolean; msg: string } | null>(null);
  protected setPinActual(e: Event): void { this.pinActual.set((e.target as HTMLInputElement).value); }
  protected setPinNuevo(e: Event): void { this.pinNuevo.set((e.target as HTMLInputElement).value); }
  protected async guardarPin(): Promise<void> {
    this.guardandoPin.set(true);
    this.pinMsg.set(null);
    try {
      await firstValueFrom(this.http.post(
        this.usuariosSvc.pinCambiarUrl(),
        { idCompany: this.companyId(), pinActual: this.pinActual(), pinNuevo: this.pinNuevo() }));
      this.pinMsg.set({ ok: true, msg: 'PIN actualizado correctamente ✓' });
      this.pinActual.set('');
      this.pinNuevo.set('');
    } catch (err: any) {
      this.pinMsg.set({ ok: false, msg: err?.error?.error ?? 'No se pudo cambiar el PIN.' });
    } finally {
      this.guardandoPin.set(false);
    }
  }

  // ── Alertas a Telegram (solo admin) ─────────────────────────────────────────
  protected readonly alertaChats = signal('');
  protected readonly guardandoAlertaChats = signal(false);
  protected readonly alertaChatsMsg = signal('');
  protected setAlertaChats(e: Event): void { this.alertaChats.set((e.target as HTMLInputElement).value); }
  protected readonly alertaChatsResource = httpResource<any>(
    () => this.esAdmin() ? this.configSvc.alertasChatsUrl(this.companyId()) : undefined,
  );

  constructor() {
    // Carga el chat de alertas guardado en el input.
    effect(() => {
      const v = this.alertaChatsResource.value();
      if (v?.chatIds != null) this.alertaChats.set(v.chatIds);
    });
  }

  protected async guardarAlertaChats(): Promise<void> {
    this.guardandoAlertaChats.set(true);
    this.alertaChatsMsg.set('');
    try {
      await firstValueFrom(this.http.post(
        this.configSvc.alertasChatsUrl(this.companyId()),
        { chatIds: this.alertaChats() }));
      this.alertaChatsMsg.set('Guardado ✓');
    } catch { this.alertaChatsMsg.set('No se pudo guardar.'); }
    finally { this.guardandoAlertaChats.set(false); }
  }
}
