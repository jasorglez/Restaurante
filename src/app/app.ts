import { CurrencyPipe } from '@angular/common';
import { HttpClient, httpResource } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { environment } from '../environments/environment';
import { CuentaAbierta, Familia } from './models/familia';
import { Mesa } from './models/mesa';

type RestaurantModule = 'MESAS' | 'CAJAS' | 'REPORTES';
type View = 'menu' | 'mesas' | 'familias';

interface CompanyInfo {
  name: string;
}

@Component({
  selector: 'app-root',
  imports: [CurrencyPipe],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  private readonly http = inject(HttpClient);

  protected readonly view = signal<View>('menu');
  protected readonly selectedMesa = signal<Mesa | null>(null);
  protected readonly openingMesa = signal(false);
  protected readonly mesaActionError = signal('');

  protected readonly companyResource = httpResource<CompanyInfo>(
    () => `${environment.urlSmp}/Root/${environment.companyId}/pdf-info`,
  );
  protected readonly companyName = computed(
    () => this.companyResource.value()?.name?.trim() || 'Cargando empresa…',
  );

  protected readonly mesasResource = httpResource<Mesa[]>(
    () =>
      this.view() === 'mesas'
        ? `${environment.urlAdministration}/Restaurant/mesas/${environment.companyId}`
        : undefined,
    { defaultValue: [] },
  );

  protected readonly mesas = this.mesasResource.value;
  protected readonly loading = this.mesasResource.isLoading;
  protected readonly error = computed(() =>
    this.mesasResource.error()
      ? 'No fue posible cargar las mesas. Verifica que el servicio de Administración esté activo.'
      : '',
  );
  protected readonly mesasOcupadas = computed(
    () => this.mesas().filter((mesa) => mesa.tieneCuentaAbierta).length,
  );

  protected readonly familiasResource = httpResource<Familia[]>(
    () =>
      this.view() === 'familias'
        ? `${environment.urlChatBot}/restaurant-publico/familias/${environment.companyId}`
        : undefined,
    { defaultValue: [] },
  );
  protected readonly familias = this.familiasResource.value;
  protected readonly familiasLoading = this.familiasResource.isLoading;
  protected readonly familiasError = computed(() =>
    this.familiasResource.error() ? 'No fue posible cargar las familias del menú.' : '',
  );

  protected selectModule(module: RestaurantModule): void {
    if (module === 'MESAS') {
      this.view.set('mesas');
    }
  }

  protected loadMesas(): void {
    this.mesasResource.reload();
  }

  protected selectMesa(mesa: Mesa): void {
    this.selectedMesa.set(mesa);
    this.mesaActionError.set('');

    if (!mesa.tieneCuentaAbierta) {
      void this.openFreeMesa(mesa);
    }
  }

  private async openFreeMesa(mesa: Mesa): Promise<void> {
    this.openingMesa.set(true);

    try {
      const cuenta = await firstValueFrom(
        this.http.post<CuentaAbierta>(
          `${environment.urlChatBot}/restaurant-publico/cuentas/abrir`,
          { idCompany: environment.companyId, idMesa: mesa.id },
        ),
      );

      this.selectedMesa.set({
        ...mesa,
        tieneCuentaAbierta: true,
        idCuentaActual: cuenta.id,
        totalActual: cuenta.total,
      });
      this.view.set('familias');
    } catch {
      this.mesaActionError.set('No fue posible abrir la cuenta de esta mesa.');
    } finally {
      this.openingMesa.set(false);
    }
  }

  protected backToMesas(): void {
    this.view.set('mesas');
    this.selectedMesa.set(null);
    this.mesasResource.reload();
  }

  protected backToMenu(): void {
    this.view.set('menu');
    this.selectedMesa.set(null);
  }
}
