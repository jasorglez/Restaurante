import { Injectable, computed, inject, signal } from '@angular/core';
import { RestaurantModule, View } from '../models/navigation';
import { Mesa } from '../models/mesa';
import { CajaService } from '../features/caja/caja.service';
import { CuentaService } from '../features/cuenta/cuenta.service';
import { UsuariosService } from '../features/usuarios/usuarios.service';

/**
 * Router "a mano" del panel: qué vista de App se muestra (`view`) y el
 * puente entre Cajas y Mesas para el cobro rápido de una mesa. App solo
 * sincroniza `companyId`/`enVista` hacia los stores de dominio (Caja, Mesas)
 * y despacha el `@if (navSvc.view() === …)` de su plantilla.
 */
@Injectable({ providedIn: 'root' })
export class NavigationService {
  private readonly cajaSvc = inject(CajaService);
  private readonly cuentaSvc = inject(CuentaService);
  private readonly usuariosSvc = inject(UsuariosService);

  readonly view = signal<View>('menu');
  // Módulo activo (para resaltar los accesos rápidos de arriba).
  readonly moduloActivo = computed<RestaurantModule | 'MENU'>(() => {
    switch (this.view()) {
      case 'mesas': return 'MESAS';
      case 'cajas': return 'CAJAS';
      case 'cocina': return 'COCINA';
      case 'reportes': return 'REPORTES';
      case 'inventario': return 'INVENTARIO';
      case 'config': return 'CONFIG';
      default: return 'MENU';
    }
  });

  // Cajas → cobrar mesa rápido: monta <app-mesas> directo en la cuenta de esa mesa.
  readonly origenCajaMesas = signal(false);

  selectModule(module: RestaurantModule): void {
    if (!this.usuariosSvc.puedeVer(module)) return;   // sin permiso, no entra
    this.abrirModulo(module);
  }

  private abrirModulo(module: RestaurantModule): void {
    if (module === 'MESAS') { this.origenCajaMesas.set(false); this.view.set('mesas'); }
    if (module === 'CAJAS') {
      this.cajaSvc.turnoActivo.set(null);
      this.view.set('cajas');
    }
    if (module === 'REPORTES') {
      this.view.set('reportes');   // el componente <app-reportes> maneja subvista y fecha
    }
    if (module === 'INVENTARIO') {
      this.view.set('inventario');   // el componente <app-inventario> maneja la subvista
    }
    if (module === 'COCINA') {
      this.view.set('cocina');   // el componente <app-cocina> carga y se refresca solo
    }
    if (module === 'CONFIG') {
      this.view.set('config');   // el componente <app-config> maneja su estado
    }
  }

  cobrarMesaRapido(m: Mesa): void {
    this.origenCajaMesas.set(true);
    this.cuentaSvc.selectedMesa.set(m);
    this.view.set('mesas');
  }

  /** (back) de <app-mesas>: si se entró desde Cajas, regresa a la lista de cobro; si no, al menú. */
  volverDeMesas(): void {
    if (this.origenCajaMesas()) {
      this.origenCajaMesas.set(false);
      this.cuentaSvc.selectedMesa.set(null);
      this.cajaSvc.abrirEnCobro.set(true);
      this.view.set('cajas');
      return;
    }
    this.backToMenu();
  }

  /** Botón "🍽️ Mesas" de la barra superior: fuerza al componente <app-mesas> a
   * volver al salón poniendo la mesa en null (su effect resetea la sub-vista),
   * incluso si ya estaba montado en familias/productos/cuenta. */
  backToMesas(): void {
    this.origenCajaMesas.set(false);
    this.cuentaSvc.selectedMesa.set(null);
    this.view.set('mesas');
  }

  backToMenu(): void {
    this.view.set('menu');
    this.cuentaSvc.selectedMesa.set(null);
    this.cajaSvc.turnoActivo.set(null);
  }
}
