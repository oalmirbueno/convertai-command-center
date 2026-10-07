import { describe, it, expect, vi, beforeEach } from "vitest";
import { linkDoDrive, linksDoDrive, itensDaPastaPublica, baixarDrive, urlDeDownload } from "../../supabase/functions/agente-contexto/modulos/links-do-drive";
import { importarDrive, nomeDoDownload } from "../../supabase/functions/agente-contexto/modulos/importar-drive";

vi.mock("../../supabase/functions/_shared/public-http.ts", () => ({ assertPublicHttpsUrl: async (url: string) => new URL(url) }));
const ARQUIVO = "abcdefghij12345";
const PASTA = "folder123456789";
const url = `https://drive.google.com/file/d/${ARQUIVO}/view`;

function banco() {
  const nos: Record<string, any>[] = [];
  const upload = vi.fn(async () => ({ error: null }));
  return { nos, upload, db: {
    storage: { from: () => ({ upload }) },
    from: () => {
      const filtros: Array<(r: any) => boolean> = [];
      let novo: any;
      const q: any = {
        select: () => q, eq: (k: string, v: any) => { filtros.push(r => r[k] === v); return q; },
        is: (k: string, v: any) => { filtros.push(r => r[k] === v); return q; },
        limit: async () => ({ data: nos.filter(r => filtros.every(f => f(r))), error: null }),
        insert: (r: any) => { novo = r; return q; },
        single: async () => { const r = { ...novo, id: `no-${nos.length}` }; nos.push(r); return { data: r, error: null }; },
      }; return q;
    },
  } };
}
beforeEach(() => { vi.unstubAllGlobals(); });

describe("Drive no contexto", () => {
  it("reconhece arquivos, pastas e documentos e rejeita hosts disfarçados", () => {
    expect(linkDoDrive(url)?.tipo).toBe("arquivo");
    expect(linkDoDrive(`https://drive.google.com/drive/folders/${PASTA}`)?.tipo).toBe("pasta");
    expect(urlDeDownload(linkDoDrive(`https://docs.google.com/document/d/${ARQUIVO}/edit`)!)).toContain("export?format=txt");
    for (const u of [url.replace("https:", "http:"), url.replace("google.com", "google.com.evil.com"), url.replace("drive.google.com", "me@drive.google.com"), "https://127.0.0.1/file/d/abcdefghijk"]) expect(linkDoDrive(u)).toBeNull();
    expect(linksDoDrive(`Confira ${url}. E ${url}`)).toHaveLength(1);
  });
  it("lista pasta pública e mantém nomes de arquivos", () => {
    const r = itensDaPastaPublica(`<a href="${url}"><span>Briefing &amp; escopo.pdf</span></a><a href="https://accounts.google.com/">Entrar</a>`);
    expect(r).toHaveLength(1); expect(r[0].nome).toBe("Briefing & escopo.pdf");
    expect(nomeDoDownload({ ...r[0], tipo: "document" }, new Headers())).toBe("Briefing & escopo.pdf.txt");
  });
  it("bloqueia redirecionamento para login e arquivo acima do teto", async () => {
    const login = vi.fn(async () => new Response(null, { status: 302, headers: { location: "https://accounts.google.com/login" } }));
    await expect(baixarDrive(url, 1024, login)).rejects.toThrow("login");
    expect(login).toHaveBeenCalledTimes(1);
    await expect(baixarDrive(url, 3, async () => new Response(new Uint8Array(4)))).rejects.toThrow("limite");
  });
  it("guarda original na pasta do cliente, reaproveita importação e isola outro cliente", async () => {
    const b = banco();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("conteúdo", { headers: { "content-type": "text/plain", "content-disposition": 'attachment; filename="Briefing.txt"' } })));
    const a = await importarDrive(b.db as any, "cliente-a", "equipe", url);
    const repetido = await importarDrive(b.db as any, "cliente-a", "equipe", url);
    expect(a.arquivos[0].id).toBe(repetido.arquivos[0].id);
    expect(b.upload).toHaveBeenCalledTimes(1);
    expect(a.arquivos[0].caminho).toMatch(/^client\/cliente-a\/contexto\/drive\//);
    expect(b.nos.filter(n => n.kind === "folder").map(n => n.name)).toEqual(["Contexto do cliente", "Drive", "Documentos"]);
    await importarDrive(b.db as any, "cliente-b", "equipe", url);
    expect(b.upload).toHaveBeenCalledTimes(2);
    expect(b.nos.filter(n => n.kind === "file")).toHaveLength(2);
  });
  it("não salva a tela de acesso como documento nem afirma importação", async () => {
    const b = banco();
    vi.stubGlobal("fetch", async () => new Response("<html>Entrar</html>", { headers: { "content-type": "text/html" } }));
    const r = await importarDrive(b.db as any, "cliente", "equipe", url);
    expect(r.arquivos).toEqual([]); expect(r.avisos[0]).toContain("tela de acesso"); expect(b.upload).not.toHaveBeenCalled();
  });
  it("percorre a pasta sem repetir link e separa vídeo de documento", async () => {
    const b = banco();
    vi.stubGlobal("fetch", async (u: URL) => u.toString().includes("embeddedfolderview")
      ? new Response(`<a href="${url}">Vídeo.mp4</a><a href="${url}">repetido</a>`)
      : new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "video/mp4" } }));
    const r = await importarDrive(b.db as any, "cliente", "equipe", `https://drive.google.com/drive/folders/${PASTA}`);
    expect(r.arquivos).toHaveLength(1); expect(b.nos.some(n => n.name === "Vídeos")).toBe(true);
  });
});
