// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  candidatosAProva,
  conferirTextos,
  escolherProvas,
  eventoDaMarca,
  type EventoReal,
  gerarPdfDoRegistro,
  lerPedidoDeRegistro,
  lerTextosDoAgente,
  montarRegistro,
  nomeDoArquivoDoRegistro,
  normalizarReferencia,
  type NumeroReal,
  numerosDoTexto,
  periodoDaReferencia,
  resumoSemAgente,
} from "../../supabase/functions/_shared/registro-de-entrega";
import { imagemParaPdf, imagensDoPdf, paginasDoPdf, textosDoPdf, type ImagemDoPdf } from "../../supabase/functions/_shared/pdf-base";
import { coletarEventos } from "../../supabase/functions/documentos/eventos";
import { JPEG_RGB } from "./fixtures/imagens-pdf";

/**
 * Registro da entrega (Frente DOC, 29/09/2026): o documento só mostra o que
 * aconteceu no painel. Montagem só com eventos reais (lidos do banco por
 * coletarEventos, aqui com um banco falso), conferência do texto do agente
 * (modelo falso que inventa número, promessa e item) e o PDF no estilo do
 * Roteiro, com as provas embutidas.
 */

const CLIENTE = "11111111-1111-4111-8111-111111111111";
const OUTRO = "22222222-2222-4222-8222-222222222222";
const PROJ_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PROJ_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ler = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

// ------------------------------------------------------------------ banco falso (só leitura, com os filtros que a coleta usa)

type Linha = Record<string, any>;
function bancoFalso(tabelas: Record<string, Linha[]>) {
  const lidas: string[] = [];
  const valor = (l: Linha, col: string) => {
    const m = /^(\w+)->>(\w+)$/.exec(col);
    return m ? (l[m[1]] || {})[m[2]] : l[col];
  };
  const from = (tabela: string) => {
    lidas.push(tabela);
    let linhas = (tabelas[tabela] || []).slice();
    let contar = false;
    const b: any = {
      select: (_c: string, o?: { count?: string; head?: boolean }) => ((contar = !!(o && o.head)), b),
      eq: (c: string, v: unknown) => ((linhas = linhas.filter((l) => valor(l, c) === v)), b),
      neq: (c: string, v: unknown) => ((linhas = linhas.filter((l) => valor(l, c) !== v)), b),
      in: (c: string, vs: unknown[]) => ((linhas = linhas.filter((l) => vs.indexOf(valor(l, c)) >= 0)), b),
      is: (c: string, v: null) => ((linhas = linhas.filter((l) => (l[c] ?? null) === v)), b),
      not: (c: string, _op: string, _v: null) => ((linhas = linhas.filter((l) => l[c] != null)), b),
      gte: (c: string, v: string) => ((linhas = linhas.filter((l) => String(l[c] || "") >= v)), b),
      lt: (c: string, v: string) => ((linhas = linhas.filter((l) => String(l[c] || "") < v)), b),
      or: (expr: string) => {
        const partes = /and\(published_at\.gte\.([^,]+),published_at\.lt\.([^)]+)\),and\(scheduled_at\.gte\.([^,]+),scheduled_at\.lt\.([^)]+)\)/.exec(expr);
        if (partes) linhas = linhas.filter((l) => (l.published_at >= partes[1] && l.published_at < partes[2]) || (l.scheduled_at >= partes[3] && l.scheduled_at < partes[4]));
        return b;
      },
      order: () => b,
      limit: () => b,
      maybeSingle: () => Promise.resolve({ data: linhas[0] || null, error: null }),
      then: (ok: (r: unknown) => unknown, erro?: (e: unknown) => unknown) =>
        Promise.resolve(contar ? { data: null, count: linhas.length, error: null } : { data: linhas, error: null }).then(ok, erro),
    };
    return b;
  };
  return { db: { from } as any, lidas };
}

const tabelasDeSetembro = (): Record<string, Linha[]> => ({
  editorial_publications: [
    { id: "pub1", client_id: CLIENTE, post_id: "post1", project_id: PROJ_A, file_id: "f1", platform: "instagram", status: "published", published_at: "2026-09-10T15:00:00.000Z", scheduled_at: "2026-09-10T15:00:00.000Z", permalink: "https://instagram.com/p/abc" },
    { id: "pub2", client_id: CLIENTE, post_id: "post2", project_id: PROJ_A, file_id: "f2", platform: "instagram", status: "scheduled", published_at: null, scheduled_at: "2026-09-25T14:00:00.000Z", permalink: null },
    // Fora do mês e de outro cliente: não entram.
    { id: "pub3", client_id: CLIENTE, post_id: "post1", project_id: PROJ_A, file_id: "f1", platform: "instagram", status: "published", published_at: "2026-08-10T15:00:00.000Z", scheduled_at: "2026-08-10T15:00:00.000Z", permalink: "x" },
    { id: "pub4", client_id: OUTRO, post_id: "post9", project_id: null, file_id: null, platform: "instagram", status: "published", published_at: "2026-09-11T15:00:00.000Z", scheduled_at: null, permalink: "y" },
    // Projeto de outra marca: não entra na marca principal.
    { id: "pub5", client_id: CLIENTE, post_id: "post5", project_id: PROJ_B, file_id: null, platform: "instagram", status: "published", published_at: "2026-09-12T15:00:00.000Z", scheduled_at: null, permalink: "z" },
  ],
  editorial_posts: [
    { id: "post1", title: "Carrossel da semana" },
    { id: "post2", title: "Post de terça" },
    { id: "post5", title: "Post da outra marca" },
  ],
  estudio_trabalhos: [
    { id: "t1", client_id: CLIENTE, task_id: "task1", status: "entregue", file_ids: ["f3"], enviado_em: "2026-09-05T12:00:00.000Z", entrega_status: "aprovado", tipo: "social" },
    { id: "t2", client_id: CLIENTE, task_id: "task2", status: "pronto", file_ids: ["f4"], enviado_em: null, entrega_status: null, tipo: "social" },
  ],
  tasks: [
    { id: "task1", title: "Arte do Dia do Cliente", project_id: PROJ_A, status: "done", deleted_at: null, updated_at: "2026-09-05T12:00:00.000Z" },
    { id: "task2", title: "Não entregue", project_id: PROJ_A, status: "todo", deleted_at: null, updated_at: "2026-09-06T12:00:00.000Z" },
  ],
  file_approval_events: [
    { id: "ev1", client_id: CLIENTE, file_id: "f3", event_type: "client_approved", created_at: "2026-09-06T12:00:00.000Z" },
    { id: "ev2", client_id: CLIENTE, file_id: "f9", event_type: "client_approved", created_at: "2026-09-07T12:00:00.000Z" },
    { id: "ev3", client_id: CLIENTE, file_id: "fdoc", event_type: "released_client_shared", created_at: "2026-09-08T12:00:00.000Z" },
  ],
  files: [
    { id: "f1", client_id: CLIENTE, project_id: PROJ_A, file_name: "carrossel.jpg", mime_type: "image/jpeg", storage_bucket: "files", storage_path: `${CLIENTE}/f1/v1/carrossel.jpg`, tags: [], archived_at: null },
    { id: "f2", client_id: CLIENTE, project_id: PROJ_A, file_name: "post.png", mime_type: "image/png", storage_bucket: "files", storage_path: `${CLIENTE}/f2/v1/post.png`, tags: [], archived_at: null },
    { id: "f3", client_id: CLIENTE, project_id: PROJ_A, file_name: "arte-dia.jpg", mime_type: "image/jpeg", storage_bucket: "files", storage_path: `${CLIENTE}/f3/v1/arte.jpg`, tags: [], archived_at: null },
    // Arquivo de outro cliente com evento no nome deste: nunca entra.
    { id: "f9", client_id: OUTRO, project_id: null, file_name: "segredo.jpg", mime_type: "image/jpeg", storage_bucket: "files", storage_path: "x", tags: [], archived_at: null },
    // O próprio documento de entrega anterior não vira item.
    { id: "fdoc", client_id: CLIENTE, project_id: null, file_name: "registro-da-entrega-x.pdf", mime_type: "application/pdf", storage_bucket: "files", storage_path: "y", tags: ["documento_entrega"], archived_at: null },
  ],
  reports: [{ id: "r1", client_id: CLIENTE, title: "Relatório de setembro", period_start: "2026-09-01", period_end: "2026-09-30", status: "published", created_at: "2026-09-29T10:00:00.000Z", project_id: null }],
  workspace_nodes: [
    { id: "w1", client_id: CLIENTE, kind: "file", created_at: "2026-09-03T10:00:00.000Z" },
    { id: "w2", client_id: CLIENTE, kind: "file", created_at: "2026-09-04T10:00:00.000Z" },
    { id: "w3", client_id: CLIENTE, kind: "folder", created_at: "2026-09-04T10:00:00.000Z" },
  ],
  mcp_audit_log: [
    { id: "a1", tool_name: "roteiro_pdf_compartilhar", success: true, created_at: "2026-09-15T10:00:00.000Z", sanitized_input: { client_id: CLIENTE } },
    { id: "a2", tool_name: "mesa_apagar_item_da_agenda", success: true, created_at: "2026-09-15T10:00:00.000Z", sanitized_input: { client_id: CLIENTE } },
  ],
  project_external_accounts: [],
  social_post_metrics: [
    { client_id: CLIENTE, external_account_id: "acc1", posted_at: "2026-09-10T15:00:00.000Z", reach: 1200, total_interactions: 80, saved: 5, shares: 3, captured_at: "2026-09-28T10:00:00.000Z", insights_captured_at: "2026-09-28T11:00:00.000Z" },
    { client_id: CLIENTE, external_account_id: "acc1", posted_at: "2026-09-20T15:00:00.000Z", reach: 300, total_interactions: null, saved: null, shares: null, captured_at: "2026-09-28T10:00:00.000Z", insights_captured_at: null },
  ],
});

const MARCA_PRINCIPAL = { id: "m1", nome: "Acerbi", principal: true, project_id: PROJ_A };

describe("coletarEventos: só o que aconteceu de verdade", () => {
  it("mês de pautas: publicações, agenda, artes, aprovações, relatório, Workspace e ações; nada de fora", async () => {
    const { db } = bancoFalso(tabelasDeSetembro());
    const erro = vi.spyOn(console, "error").mockImplementation(() => {});
    const c = await coletarEventos(db, { clientId: CLIENTE, tipo: "mes_de_pautas", referencia: "2026-09", marca: MARCA_PRINCIPAL, projetosDeOutrasMarcas: [PROJ_B] });
    erro.mockRestore();
    const ids = c.eventos.map((e) => e.id).sort();
    expect(ids).toEqual([
      "editorial_publications:pub1",
      "editorial_publications:pub2",
      "estudio_trabalhos:t1",
      "file_approval_events:ev1",
      "mcp_audit_log:a1",
      "reports:r1",
      "workspace_nodes:2026-09",
    ]);
    expect(c.avisos).toEqual([]);
    const pub = c.eventos.find((e) => e.id === "editorial_publications:pub1")!;
    expect(pub).toMatchObject({ fonte: "publicacao", titulo: "Carrossel da semana", link: "https://instagram.com/p/abc", forte: true });
    expect(pub.imagem).toMatchObject({ bucket: "files", file_id: "f1" });
    expect(c.eventos.find((e) => e.id === "editorial_publications:pub2")!.fonte).toBe("agendamento");
    expect(c.eventos.find((e) => e.id === "estudio_trabalhos:t1")).toMatchObject({ titulo: "Arte do Dia do Cliente", detalhe: "Aprovada por você", forte: true });
    expect(c.eventos.find((e) => e.id === "workspace_nodes:2026-09")!.titulo).toBe("2 arquivos organizados no Workspace");
    // Números: contagens dos eventos e Instagram com a data da leitura.
    const rotulos = c.numeros.map((n) => `${n.rotulo}=${n.valor}`);
    expect(rotulos).toEqual(["Publicações feitas=1", "Artes entregues=1", "Posts no Instagram no período=2", "Alcance somado dos posts=1500", "Interações somadas=80", "Salvamentos=5", "Compartilhamentos=3"]);
    expect(c.numeros[2].fonte).toBe("Instagram, leitura de 28 de setembro de 2026");
    expect(c.periodo).toEqual({ de: "2026-09-01T00:00:00.000Z", ate: "2026-10-01T00:00:00.000Z" });
  });

  it("marca que não é a principal não herda: só o projeto dela, sem Workspace nem registro sem projeto", async () => {
    const { db } = bancoFalso(tabelasDeSetembro());
    const c = await coletarEventos(db, { clientId: CLIENTE, tipo: "mes_de_pautas", referencia: "2026-09", marca: { id: "m2", nome: "CME", principal: false, project_id: PROJ_B }, projetosDeOutrasMarcas: [PROJ_A] });
    expect(c.eventos.map((e) => e.id)).toEqual(["editorial_publications:pub5"]);
    // Sem conta de Instagram ligada ao projeto dela: nenhum número do Instagram.
    expect(c.numeros.map((n) => n.rotulo)).toEqual(["Publicações feitas"]);
  });

  it("leitura que falha vira aviso e vai para o log (nada engolido)", async () => {
    const t = tabelasDeSetembro();
    const { db } = bancoFalso(t);
    const original = db.from;
    db.from = (tabela: string) => {
      if (tabela !== "reports") return original(tabela);
      const b: any = { select: () => b, eq: () => b, neq: () => b, gte: () => b, lt: () => b, limit: () => b, then: (ok: any) => Promise.resolve({ data: null, error: { message: "falhou", code: "500" } }).then(ok) };
      return b;
    };
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const c = await coletarEventos(db, { clientId: CLIENTE, tipo: "mes_de_pautas", referencia: "2026-09", marca: null, projetosDeOutrasMarcas: [] });
    expect(c.avisos.join(" ")).toContain("os relatórios");
    expect(log).toHaveBeenCalled();
    log.mockRestore();
    expect(c.eventos.some((e) => e.fonte === "relatorio")).toBe(false);
  });

  it("projeto: etapas concluídas do projeto e nada de outro cliente", async () => {
    const t = tabelasDeSetembro();
    t.projects = [{ id: PROJ_A, client_id: CLIENTE, name: "Site novo", status: "done", start_date: "2026-08-01", created_at: "2026-08-01T00:00:00.000Z", deleted_at: null }];
    const { db } = bancoFalso(t);
    const c = await coletarEventos(db, { clientId: CLIENTE, tipo: "projeto", referencia: PROJ_A, marca: null, projetosDeOutrasMarcas: [], agora: new Date("2026-09-30T12:00:00.000Z") });
    expect(c.titulo).toBe("Conclusão: Site novo");
    expect(c.eventos.some((e) => e.id === "tasks:task1")).toBe(true);
    expect(c.eventos.some((e) => e.id === "tasks:task2")).toBe(false);
    expect(c.eventos.some((e) => e.id === "editorial_publications:pub5")).toBe(false);
    await expect(coletarEventos(db, { clientId: OUTRO, tipo: "projeto", referencia: PROJ_A, marca: null, projetosDeOutrasMarcas: [] })).rejects.toThrow("projeto_inexistente");
  });
});

// ------------------------------------------------------------------ montagem e conferência

const eventos: EventoReal[] = [
  { id: "editorial_publications:p1", fonte: "publicacao", quando: "2026-09-10T15:00:00.000Z", titulo: "Carrossel da semana", detalhe: "Publicado no Instagram em 10 de setembro de 2026", link: "https://instagram.com/p/abc", imagem: { bucket: "files", caminho: "c/f1.jpg", file_id: "f1" }, forte: true },
  { id: "editorial_publications:p2", fonte: "publicacao", quando: "2026-09-12T15:00:00.000Z", titulo: "Post de quinta", detalhe: "Publicado no Instagram em 12 de setembro de 2026", link: "https://instagram.com/p/def", imagem: { bucket: "files", caminho: "c/f2.jpg", file_id: "f2" }, forte: true },
  { id: "editorial_publications:p3", fonte: "publicacao", quando: "2026-09-14T15:00:00.000Z", titulo: "Reels do produto", detalhe: "Publicado no Instagram em 14 de setembro de 2026", link: "https://instagram.com/p/ghi", imagem: null, forte: true },
  { id: "estudio_trabalhos:t1", fonte: "arte_entregue", quando: "2026-09-05T12:00:00.000Z", titulo: "Arte do Dia do Cliente", detalhe: "Aprovada por você", imagem: { bucket: "files", caminho: "c/f1.jpg", file_id: "f1" }, forte: true },
  { id: "file_approval_events:e1", fonte: "aprovacao", quando: "2026-09-06T12:00:00.000Z", titulo: "arte-dia.jpg", detalhe: "Aprovado por você no painel", forte: true },
];
const numeros: NumeroReal[] = [
  { rotulo: "Publicações feitas", valor: 3, fonte: "Agenda do painel" },
  { rotulo: "Alcance somado dos posts", valor: 1500, fonte: "Instagram, leitura de 28 de setembro de 2026" },
];
const entrada = { numero: 7, versao: 1, tipo: "mes_de_pautas" as const, referencia: "2026-09", cliente: "Acerbi Pernil", marca: null, data: "2026-09-30T12:00:00.000Z", periodo: periodoDaReferencia("mes_de_pautas", "2026-09") };

/** Modelo falso: mistura o que é verdade com número inventado, promessa e item que não existe. */
const MODELO_FALSO = {
  resumo: "Em setembro publicamos 3 posts e o alcance somado chegou a 1.500 pessoas. Vendemos 40% a mais por causa dos posts. Garantimos que outubro vai bombar. As artes seguiram a identidade da marca.",
  itens: [
    { id: "editorial_publications:p1", frase: "O carrossel que explica o pernil de Natal." },
    { id: "editorial_publications:p2", frase: "Este post trouxe 250 novos seguidores." },
    { id: "editorial_publications:inventado", frase: "Um vídeo extra que ninguém pediu." },
  ],
  proximos: ["Aprovar as 2 artes de outubro.", "Conferir as datas agendadas na Agenda do painel."],
};

describe("montarRegistro: nada inventado", () => {
  it("o texto do agente perde o que não tem base; o resto fica, com aviso para a equipe", () => {
    const provas = escolherProvas(candidatosAProva(eventos), {});
    const r = montarRegistro(entrada, eventos, numeros, lerTextosDoAgente(MODELO_FALSO), provas);
    expect(r.resumo).toContain("publicamos 3 posts");
    expect(r.resumo).toContain("1.500");
    expect(r.resumo).toContain("As artes seguiram a identidade da marca.");
    expect(r.resumo).not.toMatch(/40%|Vendemos|Garantimos|bombar/);
    const frases = r.feitos.reduce<string[]>((acc, g) => acc.concat(g.itens.map((i) => i.frase || "")), []);
    expect(frases).toContain("O carrossel que explica o pernil de Natal.");
    expect(frases.join(" ")).not.toMatch(/250|seguidores|vídeo extra/);
    expect(r.proximos).toEqual(["Conferir as datas agendadas na Agenda do painel."]);
    expect(r.avisos.join("\n")).toMatch(/número sem fonte \(40\)/);
    expect(r.avisos.join("\n")).toMatch(/promessa de resultado/);
    expect(r.avisos.join("\n")).toMatch(/não existe nos eventos/);
    expect(r.avisos.join("\n")).toMatch(/250/);
  });

  it("todo item, prova e aprovação vem de um evento; sem evento não há documento", () => {
    const provas = escolherProvas(candidatosAProva(eventos), {});
    const r = montarRegistro(entrada, eventos, numeros, null, provas);
    const idsDosItens = r.feitos.reduce<string[]>((acc, g) => acc.concat(g.itens.map((i) => i.evento_id)), []).concat(r.aprovacoes.map((a) => a.evento_id)).sort();
    expect(idsDosItens).toEqual(eventos.map((e) => e.id).sort());
    expect(r.feitos.map((g) => g.grupo)).toEqual(["Publicado", "Artes entregues"]);
    expect(r.aprovacoes.map((a) => a.evento_id)).toEqual(["file_approval_events:e1"]);
    // A mesma imagem (f1) não entra duas vezes nas provas; o Reels sem imagem não vira prova.
    expect(r.provas.map((p) => p.evento_id)).toEqual(["editorial_publications:p2", "editorial_publications:p1"]);
    // Sem agente: resumo por código, só com contagens reais.
    expect(r.resumo).toBe(resumoSemAgente(eventos));
    expect(r.resumo).toContain("3 publicações feitas");
    expect(r.fontes).toEqual(expect.arrayContaining([{ origem: "Agenda do painel (publicações)", quantidade: 3 }]));
    expect(() => montarRegistro(entrada, [], numeros, MODELO_FALSO, [])).toThrow();
    // Prova de evento que não existe some.
    const falsa = { ...provas[0], evento_id: "files:inventado" };
    expect(montarRegistro(entrada, eventos, numeros, null, [falsa]).provas).toEqual([]);
  });

  it("o Jev (Score) ordena as provas; nota baixa sai; sem Jev fica a ordem padrão", () => {
    const cands = candidatosAProva(eventos);
    const notas = { [cands[0].id]: 1, [cands[1].id]: 4 };
    expect(escolherProvas(cands, notas).map((p) => [p.evento_id, p.nota])).toEqual([[cands[1].id, 4]]);
    expect(escolherProvas(cands, { [cands[0].id]: 3 }).map((p) => p.evento_id)).toEqual([cands[0].id, cands[1].id]);
  });

  it("números do texto: milhar, decimal e datas", () => {
    expect(numerosDoTexto("1.500 pessoas, 12,5% e 3 posts em 10/09/2026")).toEqual([1500, 12.5, 3, 10, 9, 2026]);
    const { textos } = conferirTextos({ resumo: "Publicamos em 10 de setembro de 2026.", itens: [], proximos: [] }, eventos, []);
    expect(textos.resumo).toBe("Publicamos em 10 de setembro de 2026.");
  });
});

describe("PDF do registro: estilo do Roteiro, com as provas", () => {
  it("capa, resumo, números com fonte, o que foi feito, provas com imagem, próximos passos e aprovação", async () => {
    const provas = escolherProvas(candidatosAProva(eventos), {});
    const r = montarRegistro(entrada, eventos, numeros, lerTextosDoAgente(MODELO_FALSO), provas);
    const img = imagemParaPdf(JPEG_RGB) as ImagemDoPdf;
    const bytes = gerarPdfDoRegistro(r, { [provas[0].evento_id]: img });
    const textos = textosDoPdf(bytes);
    // Parágrafos quebram em linhas: juntar com espaço remonta a frase.
    const tudo = textos.join(" ");
    for (const t of ["REGISTRO DA ENTREGA", "Entrega de setembro de 2026", "COMO LER ESTE DOCUMENTO", "O que entregamos", "NÚMEROS DO PERÍODO", "Fonte: Instagram, leitura de 28 de setembro de 2026", "Cada entrega, com a data", "Imagens reais das entregas", "Imagem no painel (Arquivos)", "O que vem agora", "ACEITE DESTE DOCUMENTO", "FONTES DESTE DOCUMENTO", `Código do registro: ${r.codigo}`, "Nº 0007"]) {
      expect(tudo, t).toContain(t);
    }
    expect(tudo).toContain("Link: https://instagram.com/p/abc");
    expect(tudo).not.toMatch(/40%|Garantimos|250 novos/);
    const total = String(paginasDoPdf(bytes)).padStart(2, "0");
    expect(textos).toContain(`02 / ${total}`);
    expect(textos).toContain("ACERBI PERNIL  /  RESUMO");
    // Uma prova com imagem embutida (a outra mostra o aviso para ver no painel).
    expect(imagensDoPdf(bytes)).toEqual([{ largura: 24, altura: 16, filtro: "DCTDecode" }]);
    expect(nomeDoArquivoDoRegistro(r)).toBe("registro-da-entrega-acerbi-pernil-entrega-de-setembro-de-2026-0007-v1.pdf");
    // Abre num leitor de verdade.
    const pdfjs: any = await import(pathToFileURL(resolve(process.cwd(), "node_modules/pdfjs-dist/legacy/build/pdf.mjs")).href);
    const tarefa = pdfjs.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, verbosity: 0 });
    const doc = await tarefa.promise;
    expect(doc.numPages).toBe(paginasDoPdf(bytes));
    await tarefa.destroy();
  }, 60_000);
});

describe("PDF do registro com a logo da agência", () => {
  it("a logo dos dados da agência entra no lugar da padrão, uma vez só no arquivo, e o nome fecha o documento", () => {
    const r = montarRegistro(entrada, eventos, numeros, null, []);
    const logo = imagemParaPdf(JPEG_RGB) as ImagemDoPdf;
    const bytes = gerarPdfDoRegistro(r, {}, { logo, agencia: "Aceleriq Marketing" });
    expect(imagensDoPdf(bytes)).toEqual([{ largura: 24, altura: 16, filtro: "DCTDecode" }]);
    expect(textosDoPdf(bytes).join(" ")).toContain("Documento preparado por Aceleriq Marketing.");
    const semLogo = gerarPdfDoRegistro(r, {});
    expect(imagensDoPdf(semLogo)).toEqual([]);
  });
});

describe("referência, marca e pedido do gancho", () => {
  it("referência e período", () => {
    expect(normalizarReferencia("mes_de_pautas", "2026-09-01")).toBe("2026-09");
    expect(normalizarReferencia("mes_de_pautas", "2026-13")).toBeNull();
    expect(normalizarReferencia("projeto", PROJ_A.toUpperCase())).toBe(PROJ_A);
    expect(normalizarReferencia("periodo", "2026-09-10..2026-09-01")).toBeNull();
    expect(periodoDaReferencia("mes_de_pautas", "2026-12")).toEqual({ de: "2026-12-01T00:00:00.000Z", ate: "2027-01-01T00:00:00.000Z" });
    expect(periodoDaReferencia("periodo", "2026-09-01..2026-09-30")).toEqual({ de: "2026-09-01T00:00:00.000Z", ate: "2026-10-01T00:00:00.000Z" });
  });

  it("marca: a que não é principal nunca herda; a principal fica com o que não é de outra", () => {
    expect(eventoDaMarca(null, null, [])).toBe(true);
    expect(eventoDaMarca(null, { principal: false, project_id: PROJ_B }, [PROJ_A])).toBe(false);
    expect(eventoDaMarca(PROJ_A, { principal: false, project_id: PROJ_B }, [PROJ_A])).toBe(false);
    expect(eventoDaMarca(PROJ_B, { principal: false, project_id: PROJ_B }, [PROJ_A])).toBe(true);
    expect(eventoDaMarca(null, { principal: true, project_id: PROJ_A }, [PROJ_B])).toBe(true);
    expect(eventoDaMarca(PROJ_B, { principal: true, project_id: PROJ_A }, [PROJ_B])).toBe(false);
  });

  it("pedido do gancho validado", () => {
    expect(lerPedidoDeRegistro({ client_id: CLIENTE, tipo: "mes_de_pautas", referencia: "2026-09-01", provas: ["x", PROJ_A] })).toEqual({
      client_id: CLIENTE, marca_id: null, tipo: "mes_de_pautas", referencia: "2026-09", titulo: null, resumo: null, provas: [PROJ_A],
    });
    expect(lerPedidoDeRegistro({ client_id: "x", tipo: "mes_de_pautas", referencia: "2026-09" })).toHaveProperty("erro");
    expect(lerPedidoDeRegistro({ client_id: CLIENTE, tipo: "outro", referencia: "2026-09" })).toHaveProperty("erro");
    expect(lerPedidoDeRegistro({ client_id: CLIENTE, tipo: "projeto", referencia: "2026-09" })).toHaveProperty("erro");
  });

  it("módulo puro, sem travessão e sem sintaxe que o Safari 11 não entende", () => {
    const fonte = ler("supabase/functions/_shared/registro-de-entrega.ts");
    expect(fonte).not.toMatch(/from "npm:|from "https:|Deno\./);
    expect(fonte).not.toMatch(/\(\?<[=!a-z]|\\p\{|\.at\(|flatMap/i);
    expect(fonte).not.toMatch(/[–—]/);
  });
});
