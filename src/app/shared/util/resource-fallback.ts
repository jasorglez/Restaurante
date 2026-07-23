import { Resource, Signal, computed, effect, signal } from '@angular/core';

/**
 * `resource().value()` LANZA una excepción cuando el recurso está en estado de
 * error (confirmado en @angular/core: solo el estado 'loading' usa el
 * `defaultValue`, 'error' no). Estas funciones evitan que un corte de red tumbe
 * cualquier computed/template que dependa de un httpResource: mientras haya
 * error se sigue mostrando el último valor bueno en vez de reventar.
 */

const PREFIJO_CACHE = 'pv_cache:';

function leerCache<T>(url: string): T | null {
  try {
    const raw = localStorage.getItem(PREFIJO_CACHE + url);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch { return null; }
}

function guardarCache(url: string, data: unknown): void {
  try { localStorage.setItem(PREFIJO_CACHE + url, JSON.stringify(data)); }
  catch { /* localStorage lleno o no disponible: se sigue sin cache */ }
}

/** Último valor bueno en memoria (no sobrevive un refresh). Para recursos cuya
 * pantalla de todos modos no es alcanzable tras recargar la página offline
 * (ej. itemsResource: depende de una mesa seleccionada que tampoco persiste). */
export function ultimoValorValido<T>(resource: Resource<T>, valorInicial: T): Signal<T> {
  const ultimo = signal(valorInicial);
  effect(() => { if (!resource.error()) ultimo.set(resource.value()); });
  return computed(() => (resource.error() ? ultimo() : resource.value()));
}

/** Igual que `ultimoValorValido`, pero además persiste el último valor bueno en
 * `localStorage` (llave = la URL del propio recurso) para sobrevivir un refresh
 * de la tablet en medio de un corte de red. */
export function ultimoValorConCache<T>(
  resource: Resource<T>,
  url: Signal<string | undefined>,
  valorInicial: T,
): Signal<T> {
  const semilla = leerCache<T>(url() ?? '') ?? valorInicial;
  const ultimo = signal(semilla);
  effect(() => {
    if (resource.error()) return;
    const val = resource.value();
    ultimo.set(val);
    const u = url();
    if (u) guardarCache(u, val);
  });
  return computed(() => (resource.error() ? ultimo() : resource.value()));
}
