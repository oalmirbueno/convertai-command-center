import { assertPublicHttpsUrl } from "../../_shared/public-http.ts";

export type LinkDrive = { id: string; tipo: "arquivo" | "pasta" | "document" | "spreadsheets" | "presentation"; url: string; nome?: string; pasta?: string[] };
const ID = /^[\w-]{10,200}$/;
export function linkDoDrive(raw: string): LinkDrive | null {
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" || u.username || u.password || (u.port && u.port !== "443")) return null;
    if (u.hostname === "drive.google.com") {
      const pasta = u.pathname.match(/\/folders\/([\w-]+)/)?.[1];
      const id = pasta || u.pathname.match(/\/file\/d\/([\w-]+)/)?.[1] || u.searchParams.get("id");
      return id && ID.test(id) ? { id, tipo: pasta ? "pasta" : "arquivo", url: u.href } : null;
    }
    if (u.hostname === "docs.google.com") {
      const m = u.pathname.match(/^\/(document|spreadsheets|presentation)\/d\/([\w-]+)/);
      if (m && ID.test(m[2])) return { id: m[2], tipo: m[1] as LinkDrive["tipo"], url: u.href };
    }
  } catch { /* link inválido */ }
  return null;
}
export function linksDoDrive(texto: string): LinkDrive[] {
  const links = (texto.match(/https:\/\/[^\s<>"']+/g) || []).map(s => linkDoDrive(s.replace(/[).,;]+$/, ""))).filter((l): l is LinkDrive => !!l);
  return [...new Map(links.map(l => [l.id, l])).values()].slice(0, 20);
}
const decodificar = (s: string) => s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
export function itensDaPastaPublica(html: string): LinkDrive[] {
  const itens: LinkDrive[] = [];
  for (const m of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const link = linkDoDrive(decodificar(m[1]));
    if (link) itens.push({ ...link, nome: decodificar(m[2].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim().slice(0, 180) });
  }
  return [...new Map(itens.map(l => [l.id, l])).values()];
}
function hostGoogle(host: string): boolean {
  return ["drive.google.com", "drive.usercontent.google.com", "docs.google.com"].includes(host) || host.endsWith(".googleusercontent.com");
}

/** Somente hosts de download do Google; cada redirect é validado, sem cookies. */
export async function baixarDrive(url: string, maxBytes = 50 * 1024 * 1024, fetcher: typeof fetch = fetch) {
  const controller = new AbortController();
  const prazo = setTimeout(() => controller.abort(), 25_000);
  try {
    for (let n = 0; n < 6; n++) {
      const host = new URL(url).hostname;
      if (!hostGoogle(host)) throw new Error("O link exige login ou saiu dos servidores públicos do Google.");
      const segura = await assertPublicHttpsUrl(url, undefined, new Set([host]));
      const r = await fetcher(segura, { redirect: "manual", signal: controller.signal });
      if ([301, 302, 303, 307, 308].includes(r.status)) {
        const destino = r.headers.get("location");
        await r.body?.cancel();
        if (!destino) throw new Error("Redirecionamento sem arquivo.");
        url = new URL(destino, segura).href;
        continue;
      }
      if (!r.ok) { await r.body?.cancel(); throw new Error(`Drive não liberou o arquivo (HTTP ${r.status}). Confira a permissão do link.`); }
      if (Number(r.headers.get("content-length")) > maxBytes) { await r.body?.cancel(); throw new Error("Arquivo acima de 50 MB; envie uma versão menor ou divida o material."); }
      const reader = r.body?.getReader();
      const partes: Uint8Array[] = [];
      let tamanho = 0;
      if (reader) try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          tamanho += value.length;
          if (tamanho > maxBytes) { await reader.cancel(); throw new Error("Arquivo excedeu o limite da importação."); }
          partes.push(value);
        }
      } finally { reader.releaseLock(); }
      const bytes = new Uint8Array(tamanho);
      let offset = 0;
      for (const p of partes) { bytes.set(p, offset); offset += p.length; }
      return { bytes, headers: r.headers, url: segura.href };
    }
    throw new Error("Muitos redirecionamentos no Drive.");
  } finally { clearTimeout(prazo); }
}

export function urlDeDownload(link: LinkDrive): string {
  if (link.tipo === "pasta") return `https://drive.google.com/embeddedfolderview?id=${link.id}`;
  if (link.tipo === "presentation") return `https://docs.google.com/presentation/d/${link.id}/export/pptx`;
  if (link.tipo !== "arquivo") return `https://docs.google.com/${link.tipo}/d/${link.id}/export?format=${link.tipo === "document" ? "txt" : link.tipo === "spreadsheets" ? "xlsx" : "pptx"}`;
  const u = new URL("https://drive.usercontent.google.com/download");
  u.searchParams.set("id", link.id); u.searchParams.set("export", "download");
  const resource = new URL(link.url).searchParams.get("resourcekey");
  if (resource && /^[\w-]+$/.test(resource)) u.searchParams.set("resourcekey", resource);
  return u.href;
}
