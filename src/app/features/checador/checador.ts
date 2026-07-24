import { Component, inject, signal } from '@angular/core';
import { EmpresaService } from '../empresa/empresa.service';
import { UsuariosService } from '../usuarios/usuarios.service';

/**
 * Botón "🕐" del topbar para registrar entrada/salida + el toast de
 * confirmación. Autocontenido: toma la empresa/usuario activos de sus
 * propios servicios, no necesita inputs.
 */
@Component({
  selector: 'app-checador',
  templateUrl: './checador.html',
  styleUrl: './checador.scss',
})
export class Checador {
  private readonly empresaSvc = inject(EmpresaService);
  private readonly usuariosSvc = inject(UsuariosService);

  protected readonly checando = signal(false);
  protected readonly checarMsg = signal('');

  protected async checar(): Promise<void> {
    const u = this.usuariosSvc.usuario();
    const companyId = this.empresaSvc.companyId();
    if (!u || !companyId) return;
    this.checando.set(true);
    try {
      const r: any = await this.usuariosSvc.checar(companyId, u.id || null, u.nombre);
      this.checarMsg.set(r?.tipo === 'SALIDA' ? '👋 Salida registrada' : '✅ Entrada registrada');
      setTimeout(() => this.checarMsg.set(''), 4000);
    } catch { this.checarMsg.set('No se pudo checar.'); }
    finally { this.checando.set(false); }
  }
}
