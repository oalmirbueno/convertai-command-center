import { describe, expect, it, vi } from "vitest";
import {
  caminhoNoWorkspace,
  decidirCopia,
  finalParaOWorkspace,
  legendaParaOWorkspace,
  nomeDoFinal,
  pastasDoFinal,
  portaDoSupabase,
  TETO_DA_TRANSFERENCIA_BYTES,
  tituloDoVideo,
  type ArquivoDoFinal,
  type NoCriado,
  type PortaDoWorkspace,
} from "../../supabase/functions/_shared/final-no-workspace";
import { levarAoWorkspace, type Ambiente } from "../../workers/render/trabalho";

/**
 * Mesa Edição (02/10): o vídeo pronto vai sozinho para o Workspace em
 * "Vídeos / <título> / Finais" (pastas uma vez, cópia pelo servidor,
 * idempotente pela origem do arquivo) e a legenda vai junto. Banco e Storage
 * simulados em memória.
 */

const CLIENTE = "11111111-1111-4111-8111-111111111111";
const ARQ = "aaaaaaaa-0000-4000-8000-000000000009";

type No = { id: string; parent_id: string | null; name: string; kind: string; storage_path?: string | null; size_bytes?: number | null; client_id: string };

function portaFalsa(o: { arquivo?: Partial<ArquivoDoFinal>; nos?: No[]; copiaFalha?: boolean; versao?: { titulo: string; numero: number } } = {}) {
  let seq = 0;
  const arquivo: ArquivoDoFinal = {
    id: ARQ,
    client_id: CLIENTE,
    nome: "Depoimento v2 (render 9:16)",
    tipo: "render",
    storage_bucket: "mesa",
    storage_path: `${CLIENTE}/video/render/p1.mp4`,
    mime: "video/mp4",
    bytes: 300 * 1024 * 1024,
    duracao_s: 30,
    origem: { render_pedido_id: "p1", versao_id: "v2", formato: "9:16", revisao: 4 },
    ...o.arquivo,
  };
  const nos: No[] = o.nos ? o.nos.slice() : [];
  const objetos = new Set<string>();
  const chamadas = { copiar: 0, transferir: 0, criarPasta: 0, criarNo: 0, subirTexto: 0 };
  const porta: PortaDoWorkspace = {
    lerArquivo: async (id) => (id === arquivo.id ? { ...arquivo, origem: arquivo.origem ? JSON.parse(JSON.stringify(arquivo.origem)) : null } : null),
    tituloDaVersao: async () => o.versao || { titulo: "Depoimento", numero: 2 },
    pastasFilhas: async (_c, pai) => nos.filter((n) => n.kind === "folder" && n.parent_id === pai),
    criarPasta: async (c, pai, nome) => {
      chamadas.criarPasta++;
      const id = `pasta-${++seq}`;
      nos.push({ id, parent_id: pai, name: nome, kind: "folder", client_id: c });
      return id;
    },
    noPeloCaminho: async (_c, caminho) => nos.find((n) => n.storage_path === caminho) || null,
    criarNo: async (l: NoCriado) => {
      chamadas.criarNo++;
      const id = `no-${++seq}`;
      nos.push({ id, parent_id: l.parent_id, name: l.name, kind: l.kind, storage_path: l.storage_path, size_bytes: l.size_bytes, client_id: l.client_id });
      return id;
    },
    atualizarNo: async (id, campos) => {
      const n = nos.find((x) => x.id === id);
      if (n && campos.size_bytes !== undefined) n.size_bytes = campos.size_bytes;
    },
    objetoExiste: async (b, c) => objetos.has(`${b}:${c}`),
    copiar: async (_db, _d, pb, p) => {
      chamadas.copiar++;
      if (o.copiaFalha) return { erro: "destinationBucket não suportado" };
      objetos.add(`${pb}:${p}`);
      return { erro: null };
    },
    transferir: async (_db, _d, pb, p) => {
      chamadas.transferir++;
      objetos.add(`${pb}:${p}`);
    },
    subirTexto: async (b, c) => {
      chamadas.subirTexto++;
      objetos.add(`${b}:${c}`);
    },
    anotar: async (_id, origem, soSeLivre) => {
      if (soSeLivre && arquivo.origem && arquivo.origem.workspace) return false;
      arquivo.origem = origem;
      return true;
    },
  };
  return { porta, nos, objetos, chamadas, arquivo };
}

describe("nomes e caminho", () => {
  it("título sem o (render) e sem a versão; nome do final com formato e versão; caminho fixo por arquivo", () => {
    expect(tituloDoVideo("Depoimento v2 (render 9:16)")).toBe("Depoimento");
    expect(tituloDoVideo("Qualquer", "Reel / Café")).toBe("Reel - Café");
    expect(nomeDoFinal("Depoimento", { formato: "9:16", versao: 2 })).toBe("Depoimento v2 (final 9:16).mp4");
    expect(nomeDoFinal("Depoimento", { formato: "9:16", versao: 1 })).toBe("Depoimento (final 9:16).mp4");
    expect(nomeDoFinal("Depoimento", { formato: "lixo", extensao: "srt" })).toBe("Depoimento (final).srt");
    expect(pastasDoFinal("Depoimento")).toEqual(["Vídeos", "Depoimento", "Finais"]);
    expect(caminhoNoWorkspace(CLIENTE, ARQ)).toBe(`client/${CLIENTE}/mesa-edicao/${ARQ}.mp4`);
  });

  it("cópia do Storage primeiro; sem ela, transfere só até o teto", () => {
    expect(decidirCopia(false, 900 * 1024 * 1024)).toBe("copiar");
    expect(decidirCopia(true, 50 * 1024 * 1024)).toBe("transferir");
    expect(decidirCopia(true, TETO_DA_TRANSFERENCIA_BYTES + 1)).toBe("grande_demais");
    expect(decidirCopia(true, null)).toBe("grande_demais");
  });
});

describe("vídeo pronto no Workspace", () => {
  it("cria Vídeos / título / Finais, copia pelo servidor e anota a origem", async () => {
    const f = portaFalsa();
    const r = await finalParaOWorkspace(f.porta, { arquivoId: ARQ, automatico: true, agoraMs: Date.parse("2026-10-02T12:00:00Z") });
    expect(r.estado).toBe("pronto");
    expect(r.via).toBe("copiar");
    expect(r.caminho).toEqual(["Vídeos", "Depoimento", "Finais"]);
    expect(r.nome).toBe("Depoimento v2 (final 9:16).mp4");
    const no = f.nos.find((n) => n.id === r.node_id)!;
    expect(no).toMatchObject({ storage_path: `client/${CLIENTE}/mesa-edicao/${ARQ}.mp4`, parent_id: r.pasta_id, size_bytes: 300 * 1024 * 1024 });
    expect(f.nos.find((n) => n.id === r.pasta_id)!.name).toBe("Finais");
    expect((f.arquivo.origem as any).workspace).toMatchObject({ estado: "pronto", node_id: r.node_id, render_pedido_id: "p1", versao_id: "v2", revisao: 4 });
    expect((f.arquivo.origem as any).render_pedido_id).toBe("p1");
  });

  it("idempotente: rodar de novo não copia nem cria nada; pastas que já existem são reaproveitadas", async () => {
    const f = portaFalsa({ nos: [{ id: "raiz", parent_id: null, name: "Videos", kind: "folder", client_id: CLIENTE }, { id: "t", parent_id: "raiz", name: "depoimento", kind: "folder", client_id: CLIENTE }] });
    const a = await finalParaOWorkspace(f.porta, { arquivoId: ARQ });
    const b = await finalParaOWorkspace(f.porta, { arquivoId: ARQ });
    expect(b.estado).toBe("ja_estava");
    expect(b.node_id).toBe(a.node_id);
    expect(f.chamadas).toMatchObject({ copiar: 1, criarNo: 1, criarPasta: 1 });
    expect(f.nos.filter((n) => n.kind === "folder").map((n) => n.name)).toEqual(["Videos", "depoimento", "Finais"]);
  });

  it("outro já está copiando: não duplica", async () => {
    const f = portaFalsa({ arquivo: { origem: { render_pedido_id: "p1", workspace: { estado: "copiando", em: "2026-10-02T11:59:00Z" } } } });
    const r = await finalParaOWorkspace(f.porta, { arquivoId: ARQ, agoraMs: Date.parse("2026-10-02T12:00:00Z") });
    expect(r.estado).toBe("em_andamento");
    expect(f.chamadas.copiar).toBe(0);
  });

  it("cópia indisponível: vídeo pequeno transfere; grande demais vira erro anotado (sem derrubar nada)", async () => {
    const pequeno = portaFalsa({ copiaFalha: true, arquivo: { bytes: 40 * 1024 * 1024 } });
    expect((await finalParaOWorkspace(pequeno.porta, { arquivoId: ARQ })).via).toBe("transferir");
    expect(pequeno.chamadas.transferir).toBe(1);
    const grande = portaFalsa({ copiaFalha: true });
    const r = await finalParaOWorkspace(grande.porta, { arquivoId: ARQ });
    expect(r.estado).toBe("erro");
    expect(grande.chamadas.transferir).toBe(0);
    expect(grande.chamadas.criarNo).toBe(0);
    expect((grande.arquivo.origem as any).workspace).toMatchObject({ estado: "erro", tentativas: 1 });
  });

  it("automático para depois de 3 erros e não refaz o que foi tirado do Workspace; o clique refaz", async () => {
    const esgotado = portaFalsa({ arquivo: { origem: { workspace: { estado: "erro", tentativas: 3 } } } });
    expect((await finalParaOWorkspace(esgotado.porta, { arquivoId: ARQ, automatico: true })).motivo).toBe("tentativas_esgotadas");
    const tirado = portaFalsa({ arquivo: { origem: { workspace: { estado: "pronto", node_id: "sumiu" } } } });
    expect((await finalParaOWorkspace(tirado.porta, { arquivoId: ARQ, automatico: true })).motivo).toBe("tirado_do_workspace");
    expect((await finalParaOWorkspace(tirado.porta, { arquivoId: ARQ })).estado).toBe("pronto");
  });

  it("amostra, outro bucket ou outra pasta não vão", async () => {
    expect((await finalParaOWorkspace(portaFalsa({ arquivo: { tipo: "amostra" } }).porta, { arquivoId: ARQ })).motivo).toBe("amostra");
    expect((await finalParaOWorkspace(portaFalsa({ arquivo: { storage_bucket: "files" } }).porta, { arquivoId: ARQ })).motivo).toBe("fora_do_bucket");
    expect((await finalParaOWorkspace(portaFalsa({ arquivo: { storage_path: "outro/x.mp4" } }).porta, { arquivoId: ARQ })).motivo).toBe("fora_da_pasta_do_cliente");
  });

  it("legenda: .srt e .vtt na mesma Finais com o nome do vídeo; gerar de novo atualiza sem duplicar", async () => {
    const f = portaFalsa();
    const r = await legendaParaOWorkspace(f.porta, { arquivoId: ARQ, srt: "1\n00:00:00,000 --> 00:00:01,000\nOi\n", vtt: "WEBVTT\n" });
    expect(r.estado).toBe("pronto");
    const srt = f.nos.find((n) => n.id === r.nos.srt)!;
    expect(srt).toMatchObject({ name: "Depoimento v2 (final 9:16).srt", parent_id: r.pasta_id, storage_path: `client/${CLIENTE}/mesa-edicao/${ARQ}.srt` });
    expect(f.nos.find((n) => n.id === r.nos.vtt)!.name).toBe("Depoimento v2 (final 9:16).vtt");
    expect(f.chamadas.copiar).toBe(1);
    const de = await legendaParaOWorkspace(f.porta, { arquivoId: ARQ, srt: "1\n", vtt: "WEBVTT\n\n" });
    expect(de.nos).toEqual(r.nos);
    expect(f.chamadas.criarNo).toBe(3);
  });
});

describe("gatilho do worker: só render_final que concluiu", () => {
  it("chama no render_final com arquivo; nunca na amostra; erro só vai para o log", async () => {
    const finalNoWorkspace = vi.fn(async () => ({ estado: "pronto" }));
    const log = vi.fn();
    const amb = { finalNoWorkspace, log } as unknown as Ambiente;
    await levarAoWorkspace(amb, { id: "p", tipo: "amostra" }, "a1");
    await levarAoWorkspace(amb, { id: "p", tipo: "render_final" }, null);
    expect(finalNoWorkspace).not.toHaveBeenCalled();
    await levarAoWorkspace(amb, { id: "p", tipo: "render_final" }, "a1");
    expect(finalNoWorkspace).toHaveBeenCalledWith("a1");
    finalNoWorkspace.mockRejectedValueOnce(new Error("rede"));
    await expect(levarAoWorkspace(amb, { id: "p", tipo: "render_final" }, "a1")).resolves.toBeUndefined();
    expect(log).toHaveBeenLastCalledWith("workspace falhou: rede");
  });
});

describe("porta do Supabase", () => {
  it("copia entre buckets com destinationBucket e a reserva só pega origem sem workspace", async () => {
    const copy = vi.fn(async () => ({ error: null }));
    const filtros: string[] = [];
    const q: any = {
      update: () => q,
      eq: () => q,
      is: (c: string) => (filtros.push(c), q),
      select: () => Promise.resolve({ data: [], error: null }),
    };
    const db = { from: () => q, storage: { from: () => ({ copy }) } };
    const porta = portaDoSupabase(db);
    expect(await porta.copiar("mesa", "a.mp4", "workspace", "b.mp4")).toEqual({ erro: null });
    expect(copy).toHaveBeenCalledWith("a.mp4", "b.mp4", { destinationBucket: "workspace" });
    expect(await porta.anotar(ARQ, {}, true)).toBe(false);
    expect(filtros).toEqual(["origem->workspace"]);
  });
});
