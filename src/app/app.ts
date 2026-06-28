import { CurrencyPipe } from '@angular/common';
import { HttpClient, httpResource } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { environment } from '../environments/environment';
import { CuentaAbierta, Familia, ItemCuenta, Producto } from './models/familia';
import { Mesa } from './models/mesa';

type RestaurantModule = 'MESAS' | 'CAJAS' | 'REPORTES';
type View = 'menu' | 'mesas' | 'familias' | 'productos';

interface CompanyInfo { name: string; }

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

  protected readonly selectedFamilia = signal<Familia | null>(null);
  protected readonly selectedSubfamilia = signal<Familia | null>(null);
  protected readonly selectedProducto = signal<Producto | null>(null);
  protected readonly agregandoItem = signal(false);
  protected readonly addError = signal('');

  // ── Empresa ───────────────────────────────────────────────────────────────
  protected readonly companyResource = httpResource<CompanyInfo>(
    () => `${environment.urlSmp}/Root/${environment.companyId}/pdf-info`,
  );
  protected readonly companyName = computed(
    () => this.companyResource.value()?.name?.trim() || 'Cargando empresa…',
  );

  // ── Mesas ─────────────────────────────────────────────────────────────────
  protected readonly mesasResource = httpResource<Mesa[]>(
    () => this.view() === 'mesas'
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
    () => this.mesas().filter(m => m.tieneCuentaAbierta).length,
  );

  // ── Familias ──────────────────────────────────────────────────────────────
  protected readonly familiasResource = httpResource<Familia[]>(
    () => this.view() === 'familias'
      ? `${environment.urlChatBot}/restaurant-publico/familias/${environment.companyId}`
      : undefined,
    { defaultValue: [] },
  );
  protected readonly familias = this.familiasResource.value;
  protected readonly familiasLoading = this.familiasResource.isLoading;
  protected readonly familiasError = computed(() =>
    this.familiasResource.error() ? 'No fue posible cargar las familias del menú.' : '',
  );

  // ── Subfamilias (se cargan al entrar a view='productos') ──────────────────
  protected readonly subfamiliasResource = httpResource<Familia[]>(
    () => {
      const fam = this.selectedFamilia();
      if (!fam || this.view() !== 'productos') return undefined;
      return `${environment.urlChatBot}/restaurant-publico/subfamilias/${environment.companyId}/${fam.id}`;
    },
    { defaultValue: [] },
  );

  protected readonly mostrarSubfamilias = computed(() => {
    if (this.selectedSubfamilia()) return false;
    return !this.subfamiliasResource.isLoading() && this.subfamiliasResource.value().length > 1;
  });

  // ── Productos (espera a que subfamilias termine de cargar) ────────────────
  protected readonly productosResource = httpResource<Producto[]>(
    () => {
      if (this.view() !== 'productos') return undefined;
      const fam = this.selectedFamilia();
      if (!fam || this.subfamiliasResource.isLoading()) return undefined;

      const sub = this.selectedSubfamilia();
      if (sub) {
        return `${environment.urlChatBot}/restaurant-publico/productos/${environment.companyId}/subfamilia/${sub.id}`;
      }
      if (!this.mostrarSubfamilias()) {
        return `${environment.urlChatBot}/restaurant-publico/productos/${environment.companyId}/familia/${fam.id}`;
      }
      return undefined;
    },
    { defaultValue: [] },
  );
  protected readonly productosLoading = computed(
    () => this.subfamiliasResource.isLoading() || this.productosResource.isLoading(),
  );
  protected readonly productosError = computed(() =>
    this.productosResource.error() ? 'No fue posible cargar los productos.' : '',
  );

  // ── Items de la cuenta (para mostrar total corriente) ────────────────────
  protected readonly itemsResource = httpResource<ItemCuenta[]>(
    () => {
      const mesa = this.selectedMesa();
      const v = this.view();
      if (!mesa?.idCuentaActual || (v !== 'familias' && v !== 'productos')) return undefined;
      return `${environment.urlChatBot}/restaurant-publico/cuentas/${mesa.idCuentaActual}/items`;
    },
    { defaultValue: [] },
  );
  protected readonly items = this.itemsResource.value;
  protected readonly totalCuenta = computed(() =>
    this.items().reduce((sum, i) => sum + i.subtotal, 0),
  );

  // ── Navegación ────────────────────────────────────────────────────────────
  protected selectModule(module: RestaurantModule): void {
    if (module === 'MESAS') this.view.set('mesas');
  }

  protected loadMesas(): void { this.mesasResource.reload(); }

  protected selectMesa(mesa: Mesa): void {
    this.selectedMesa.set(mesa);
    this.mesaActionError.set('');
    if (mesa.tieneCuentaAbierta) {
      this.view.set('familias');
    } else {
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

  protected selectFamilia(familia: Familia): void {
    this.selectedSubfamilia.set(null);
    this.selectedProducto.set(null);
    this.addError.set('');
    this.selectedFamilia.set(familia);
    this.view.set('productos');
  }

  protected selectSubfamilia(sub: Familia): void {
    this.selectedSubfamilia.set(sub);
    this.selectedProducto.set(null);
    this.addError.set('');
  }

  protected selectProducto(producto: Producto): void {
    this.selectedProducto.set(producto);
    this.addError.set('');
  }

  protected cancelarProducto(): void {
    this.selectedProducto.set(null);
    this.addError.set('');
  }

  protected async agregarProducto(cantidad: number): Promise<void> {
    const producto = this.selectedProducto();
    const mesa = this.selectedMesa();
    if (!producto || !mesa?.idCuentaActual) return;

    this.agregandoItem.set(true);
    this.addError.set('');
    try {
      await firstValueFrom(
        this.http.post(
          `${environment.urlChatBot}/restaurant-publico/cuentas/${mesa.idCuentaActual}/items`,
          {
            idMaterial: producto.id,
            descripcion: producto.description,
            cantidad,
            precio: producto.price,
          },
        ),
      );
      this.selectedProducto.set(null);
      this.itemsResource.reload();
    } catch {
      this.addError.set('No se pudo agregar el producto. Intenta de nuevo.');
    } finally {
      this.agregandoItem.set(false);
    }
  }

  protected backToFamilias(): void {
    this.view.set('familias');
    this.selectedFamilia.set(null);
    this.selectedSubfamilia.set(null);
    this.selectedProducto.set(null);
    this.addError.set('');
  }

  protected backToMesas(): void {
    this.view.set('mesas');
    this.selectedMesa.set(null);
    this.selectedFamilia.set(null);
    this.selectedSubfamilia.set(null);
    this.selectedProducto.set(null);
    this.mesasResource.reload();
  }

  protected backToMenu(): void {
    this.view.set('menu');
    this.selectedMesa.set(null);
    this.selectedFamilia.set(null);
    this.selectedSubfamilia.set(null);
    this.selectedProducto.set(null);
  }
}
