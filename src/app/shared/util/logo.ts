/**
 * Convierte la URL del logo de la empresa en un data: URL para embeberlo en los
 * PDF de pdfMake. Compartido por los distintos reportes/tickets imprimibles.
 */
export async function logoToDataUrl(url: string | null): Promise<string | null> {
  if (!url) return null;
  if (url.startsWith('data:')) return url;
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch { return null; }
}
