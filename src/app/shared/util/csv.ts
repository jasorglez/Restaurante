/**
 * Descarga un CSV (compatible con Excel, con BOM para acentos).
 * Compartido por Reportes (ventas/auditoría) e Inventario (existencias).
 */
export function descargarCsv(
  nombre: string,
  encabezados: string[],
  filas: (string | number)[][],
  sufijo: string,
): void {
  const esc = (v: string | number) => {
    const s = String(v ?? '');
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const bom = '﻿';   // para que Excel respete acentos
  const cont = bom + [encabezados, ...filas].map(r => r.map(esc).join(',')).join('\r\n');
  const blob = new Blob([cont], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${nombre}_${sufijo}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
