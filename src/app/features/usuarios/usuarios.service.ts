import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { RestaurantModule } from '../../models/navigation';
import { Rol, Usuario } from '../../models/usuario';

const LS_USUARIO = 'pv_usuario';

/**
 * Personal y credenciales: login por PIN, alta/baja de usuarios, checador
 * (entrada/salida) y validación/cambio de PIN de supervisor. Expone endpoints
 * (URLs) + las operaciones (HTTP) de login/checador/validación, y la sesión
 * activa (`usuario`), persistida en localStorage.
 */
@Injectable({ providedIn: 'root' })
export class UsuariosService {
  private readonly http = inject(HttpClient);
  private readonly pub = `${environment.urlChatBot}/restaurant-publico`;

  /** Usuario logueado actualmente (o null). Estado central de la sesión. */
  readonly usuario = signal<Usuario | null>(this.restoreUsuario());

  private restoreUsuario(): Usuario | null {
    try { const s = localStorage.getItem(LS_USUARIO); return s ? JSON.parse(s) : null; } catch { return null; }
  }

  /** Guarda la sesión (usuario logueado) y la persiste. */
  setUsuario(u: Usuario): void {
    this.usuario.set(u);
    localStorage.setItem(LS_USUARIO, JSON.stringify(u));
  }

  /** Cierra la sesión activa. */
  logout(): void {
    this.usuario.set(null);
    localStorage.removeItem(LS_USUARIO);
  }

  readonly esAdmin = computed(() => this.usuario()?.rol === 'admin');

  /** Permisos por rol. mesero: mesas/cocina · cajero: + cajas/reportes/inventario · admin: todo. */
  puedeVer(module: RestaurantModule): boolean {
    const rol: Rol = this.usuario()?.rol ?? 'mesero';
    if (module === 'MESAS' || module === 'COCINA') return true;
    if (module === 'CONFIG') return rol === 'admin';
    // CAJAS, REPORTES, INVENTARIO
    return rol === 'cajero' || rol === 'admin';
  }

  /** Login por PIN → devuelve el usuario. */
  login(companyId: number, pin: string): Promise<Usuario> {
    return firstValueFrom(this.http.post<Usuario>(this.loginUrl(), { idCompany: companyId, pin }));
  }
  /** Registra entrada/salida del checador. */
  checar(companyId: number, idUsuario: number | null, usuario: string): Promise<any> {
    return firstValueFrom(this.http.post(this.checadorUrl(), { idCompany: companyId, idUsuario, usuario }));
  }
  /** Valida el PIN de supervisor (devuelve `{ ok }`). */
  validarPin(companyId: number, pin: string): Promise<any> {
    return firstValueFrom(this.http.post(this.pinValidarUrl(), { idCompany: companyId, pin }));
  }

  /** Login por PIN. */
  loginUrl(): string { return `${this.pub}/usuarios/login`; }

  /** Checador de entrada/salida. */
  checadorUrl(): string { return `${this.pub}/checador`; }

  /** Usuarios de una empresa. */
  listUrl(companyId: number): string { return `${this.pub}/usuarios/${companyId}`; }

  /** Colección de usuarios (POST/PUT = alta/edición). */
  baseUrl(): string { return `${this.pub}/usuarios`; }

  /** Baja de un usuario. */
  deleteUrl(id: number, companyId: number): string { return `${this.pub}/usuarios/${id}?idCompany=${companyId}`; }

  /** Validar PIN de supervisor. */
  pinValidarUrl(): string { return `${this.pub}/pin/validar`; }

  /** Cambiar PIN de supervisor. */
  pinCambiarUrl(): string { return `${this.pub}/pin/cambiar`; }
}
