import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface EmpresaItem { id: number; name: string; picture: string | null; }

/**
 * Selección de empresa (super-usuario): lista pública de empresas del Root
 * (microservicio SMP).
 */
@Injectable({ providedIn: 'root' })
export class EmpresaService {
  private readonly http = inject(HttpClient);

  /** Lista pública de empresas para la pantalla de selección. */
  listaPublica(): Promise<EmpresaItem[]> {
    return firstValueFrom(this.http.get<EmpresaItem[]>(`${environment.urlSmp}/Root/lista-publica`));
  }
}
