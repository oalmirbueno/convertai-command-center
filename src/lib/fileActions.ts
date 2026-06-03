// Robust open/download helpers for files stored in Supabase storage.
// - openFile: opens in a new tab; falls back to top-level navigation when
//   the host is sandboxed (e.g. Lovable preview iframe) and window.open is blocked.
// - downloadFile: fetches as blob and triggers a real download. The HTML
//   `download` attribute is ignored on cross-origin links, so we must do
//   this manually to actually save the file.

export function openFile(url: string) {
  if (!url || url === "#") return;
  try {
    const win = window.open(url, "_blank", "noopener,noreferrer");
    if (win) return;
  } catch {
    /* fall through */
  }
  // Fallback when popups/new-tabs are blocked (sandboxed iframes)
  try {
    window.top?.location?.assign?.(url);
  } catch {
    window.location.href = url;
  }
}

export async function downloadFile(url: string, fileName?: string) {
  if (!url || url === "#") return;
  try {
    const res = await fetch(url, { mode: "cors" });
    if (!res.ok) throw new Error("download failed");
    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = fileName || url.split("/").pop() || "arquivo";
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
  } catch {
    // Network/CORS failure → just open it
    openFile(url);
  }
}
