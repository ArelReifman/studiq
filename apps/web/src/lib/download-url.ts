/**
 * Appends Supabase Storage's `?download=<name>` param to a public file URL so
 * the browser saves the file under its original uploaded name instead of the
 * UUID storage key. Returns the URL unchanged when no name is stored.
 */
export function withDownloadName(url: string, name?: string | null): string {
  if (!name) return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}download=${encodeURIComponent(name)}`;
}
