import { httpResource } from '@angular/common/http';
import { Component, DestroyRef, inject, input, output, signal } from '@angular/core';
import { OrdenCocina } from '../../models/cocina';
import { CocinaService } from './cocina.service';

/**
 * Tablero de cocina (KDS). Se monta solo cuando la vista es 'cocina', por lo que
 * el recurso siempre está activo mientras el componente vive y se auto-refresca
 * cada 15 s. Al salir de la vista, el componente se destruye y limpia el timer.
 */
@Component({
  selector: 'app-cocina',
  templateUrl: './cocina.html',
  styleUrl: './cocina.scss',
})
export class Cocina {
  private readonly cocina = inject(CocinaService);

  /** Empresa activa (la pasa el componente padre). */
  readonly companyId = input.required<number>();
  /** Pide al padre volver al menú. */
  readonly back = output<void>();

  private readonly tick = signal(0);
  protected readonly cocinaResource = httpResource<OrdenCocina[]>(
    () => {
      this.tick();   // dependencia para el auto-refresco
      return this.cocina.kdsUrl(this.companyId());
    },
    { defaultValue: [] },
  );
  protected readonly cocinaLoading = this.cocinaResource.isLoading;
  protected readonly marcandoListo = signal<number | null>(null);

  constructor() {
    // Auto-refresco del tablero cada 15 s mientras la vista esté visible.
    const id = setInterval(() => this.tick.update(t => t + 1), 15000);
    inject(DestroyRef).onDestroy(() => clearInterval(id));
  }

  protected semaforoOrden(min: number): 'ok' | 'warn' | 'late' {
    return min < 7 ? 'ok' : min < 15 ? 'warn' : 'late';
  }

  protected async marcarOrdenLista(o: OrdenCocina): Promise<void> {
    this.marcandoListo.set(o.idCuenta);
    try {
      await this.cocina.marcarListo(o.idCuenta);
      this.cocinaResource.reload();
    } catch { /* reintenta en el siguiente refresco */ }
    finally { this.marcandoListo.set(null); }
  }
}
