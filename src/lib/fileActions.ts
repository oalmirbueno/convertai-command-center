// Robust open/download helpers.
// - Streams the download so we can show real progress on desktop and mobile.
// - On mobile, when possible, uses the Web Share API so the OS sheet lets the
//   user save the image/video to Photos or the file to Files/Drive.
// - Emits window CustomEvents consumed by <DownloadProgressOverlay/>:
//     "file-download:start"    { id, name, total }
//     "file-download:progress" { id, loaded, total }
//     "file-download:done"     { id }
//     "file-download:error"    { id, message }

export function openFile(url: string) {
  if (!url || url === "#") return;
  try {
    const win = window.open(url, "_blank", "noopener,noreferrer");
    if (win) return;
  } catch {
    /* fall through */
  }
  try {
    window.top?.location?.assign?.(url);
  } catch {
    window.location.href = url;
  }
}

function safeFileName(value?: string) {
  return (value || "arquivo").replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").slice(0, 180) || "arquivo";
}

function isIOSLike() {
  if (typeof navigator === "undefined") return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && (navigator as any).maxTouchPoints > 1);
}

function isMobile() {
  if (typeof navigator === "undefined") return false;
  return isIOSLike() || /Android|Mobile/i.test(navigator.userAgent);
}

function emit(event: string, detail: any) {
  try { window.dispatchEvent(new CustomEvent(event, { detail })); } catch { /* noop */ }
}

function guessMime(fileName: string, fallback?: string) {
  const ext = (fileName.split(".").pop() || "").toLowerCase();
  const map: Record<string, string> = {
    jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp",
    gif: "image/gif", heic: "image/heic", svg: "image/svg+xml",
    mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm",
    pdf: "application/pdf", zip: "application/zip",
  };
  return map[ext] || fallback || "application/octet-stream";
}

async function shareOrSave(blob: Blob, fileName: string) {
  // Try Web Share sheet (mobile) so user can pick "Save to Photos" / "Files".
  try {
    const nav: any = navigator;
    if (isMobile() && typeof File !== "undefined" && nav?.canShare) {
      const file = new File([blob], fileName, { type: blob.type || guessMime(fileName) });
      if (nav.canShare({ files: [file] })) {
        await nav.share({ files: [file], title: fileName });
        return true;
      }
    }
  } catch {
    /* user cancelled or share failed → fall through to blob download */
  }
  return false;
}

export async function downloadFile(url: string, fileName?: string) {
  if (!url || url === "#") return;
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const name = safeFileName(fileName || url.split("/").pop()?.split("?")[0]);

  emit("file-download:start", { id, name, total: 0 });

  try {
    const res = await fetch(url, { mode: "cors" });
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

    const total = Number(res.headers.get("content-length") || 0);
    emit("file-download:start", { id, name, total });

    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let loaded = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        loaded += value.byteLength;
        emit("file-download:progress", { id, loaded, total });
      }
    }

    const type = res.headers.get("content-type") || guessMime(name);
    const blob = new Blob(chunks, { type });

    // Prefer OS share sheet on mobile so user can save to Photos/Files
    const shared = await shareOrSave(blob, name);

    if (!shared) {
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = name;
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      if (isIOSLike()) {
        // iOS Safari without Web Share fallback → open blob so user can save
        setTimeout(() => openFile(blobUrl), 50);
        setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
      } else {
        setTimeout(() => URL.revokeObjectURL(blobUrl), 10_000);
      }
    }

    emit("file-download:done", { id });
  } catch (e: any) {
    emit("file-download:error", { id, message: e?.message || "Falha no download" });
    // Last-resort fallback: navigate to URL
    try { openFile(url); } catch { /* noop */ }
  }
}
