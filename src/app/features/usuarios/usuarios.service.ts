import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { Usuario } from '../../models/usuario';

/**
 * Personal y credenciales: login por PIN, alta/baja de usuarios, checador
 * (entrada/salida) y validación/cambio de PIN de supervisor. Expone endpoints
 * (URLs) + las operaciones (HTTP) de login/checador/validación.
 */
@Injectable({ providedIn: 'root' })
export class UsuariosService {
  private readonly http = inject(HttpClient);
  private readonly pub = `${environment.urlChatBot}/restaurant-publico`;

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
