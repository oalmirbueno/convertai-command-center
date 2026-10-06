import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement as h } from "react";
import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import JSZip from "jszip";

/**
 * Agente do Mês v2 (dono, 26/09): GPT-6 Sol alto só neste agente, contexto de
 * 1M com tetos altos, arquivos e ZIP lidos no navegador, material colado vira
 * conteúdos nas datas certas, reescrever textos sem gerar do zero, área MCP
 * do cliente com itens ativos no contexto, público do prompt julgado pelo Jev,
 * e menos texto nas lâminas (conferência sem laço de correção).
 */

const mock = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: mock.invoke },
    rpc: vi.fn(),
    from: () => {
      const b: any = {};
      for (const m of ["select", "eq", "neq", "not", "in", "is", "or", "gte", "lt", "lte", "order", "limit", "contains", "overlaps"]) b[m] = () => b;
      b.maybeSingle = () => Promise.resolve({ data: null, error: null });
      b.then = (ok: any, erro: any) => Promise.resolve({ data: [], error: null }).then(ok, erro);
      return b;
    },
    storage: { from: () => ({ upload: vi.fn().mockResolvedValue({ data: {}, error: null }), createSignedUrl: () => Promise.resolve({ data: { signedUrl: "https://x.test/a.png" }, error: null }) }) },
  },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn(), message: vi.fn() } }));

import {
  acaoDeAtualizarPublico,
  blocoDaDecisaoDoPublico,
  blocoDosArquivos,
  caberNoOrcamento,
  decidirPublico,
  estadoDoPublico,
  lotesDaCriacao,
  MAX_CHARS_DOS_ARQUIVOS as MAX_CHARS_DOS_ARQUIVOS_SERVIDOR,
  MAX_CHARS_MENSAGEM_DO_MES,
  MAX_CHARS_POR_ARQUIVO as MAX_CHARS_POR_ARQUIVO_SERVIDOR,
  MODELO_DO_AGENTE_DO_MES as MODELO_SERVIDOR,
  modeloDoMesNoCatalogo,
  normalizarArquivos,
  normalizarCriacao,
  PAPEL_DO_AGENTE_DO_MES as PAPEL_SERVIDOR,
  pedidoParaCriar as pedidoParaCriarServidor,
  PERGUNTAS_DO_PUBLICO,
  RACIOCINIO_DO_AGENTE_DO_MES as RACIOCINIO_SERVIDOR,
  raciocinioDoMes,
  TETO_TOKENS_DO_PEDIDO,
  LOTE_DA_CRIACAO as LOTE_SERVIDOR,
} from "../../supabase/functions/agente-calendario/agente-mes-v2";
import {
  camposDeTexto,
  janelaDoPedidoLivre,
  MAX_EDITAR_TEXTOS,
  normalizarAcoesNaAgenda,
  pecasComApelido,
  REGRA_DAS_ACOES_NA_AGENDA,
} from "../../supabase/functions/agente-calendario/acoes-agenda";
import {
  aplicarPreferencias,
  ativoPorPadrao,
  blocoDoMcp,
  contextoMcpAtivo,
  dossieVeioDoMcp,
  itensMcpDoCliente,
  paraATela,
} from "../../supabase/functions/_shared/contexto-mcp";
import { jevPerguntar } from "../../supabase/functions/_shared/jev";
import {
  conferirLaminas,
  contarPalavras,
  cortarNoLimiteDeFrase,
  LIMITE_DA_CAPA,
  LIMITE_DA_LAMINA,
  REGRA_DE_MENOS_TEXTO,
} from "../../supabase/functions/_shared/menos-texto-nas-laminas";
import {
  acaoNaAgendaDaMensagem,
  corpoDoPlanejamento,
  criacaoDaMensagem,
  fraseDoContextoUsado,
  LOTE_DA_CRIACAO,
  MODELO_DO_AGENTE_DO_MES,
  modeloDoAgenteDoMes,
  PAPEL_DO_AGENTE_DO_MES,
  partesDoPlanejamento,
  pedidoParaCriar,
  RACIOCINIO_DO_AGENTE_DO_MES,
} from "@/components/mesa/planoDoMes";
import {
  arquivosParaOEnvio,
  lerArquivosDoAgente,
  MAX_BYTES_DO_ZIP,
  MAX_CHARS_DOS_ARQUIVOS,
  MAX_CHARS_POR_ARQUIVO,
  textoDoDocx,
  tipoDoArquivo,
} from "@/components/mesa/leituraDeArquivos";
import { ListaDeArquivos, useArquivosDoAgente } from "@/components/mesa/ArquivosDoAgente";
import ContextoMcp from "@/components/mesa/ContextoMcp";
import { MesaProvider, type MesaValor } from "@/components/mesa/MesaContexto";
import { TooltipProvider } from "@/components/ui/tooltip";
import { padraoPara, type ModeloIa } from "@/lib/mesa/api";

const raiz = resolve(__dirname, "../..");
const ler = (rel: string) => readFileSync(resolve(raiz, rel), "utf8").replace(/\r\n/g, "\n");
const calendario = ler("supabase/functions/agente-calendario/index.ts");
const corpoDe = (nome: string) => {
  const i = calendario.indexOf(`async function ${nome}(`);
  const j = calendario.indexOf("\nasync function ", i + 10);
  return calendario.slice(i, j > 0 ? j : undefined);
};

const CATALOGO: ModeloIa[] = [
  { id: "openrouter:openai/gpt-6-luna", provedor: "openrouter", modelo_api: "openai/gpt-6-luna", tipo: "texto", rotulo: "Luna", preco_entrada_1m: 0.1, preco_saida_1m: 0.5, preco_cache_1m: null, preco_imagem: null, raciocinio: ["none", "low", "medium", "high", "xhigh", "max"], padrao_para: ["estrategista", "leitura"], ativo: true } as ModeloIa,
  { id: "openrouter:openai/gpt-6-sol", provedor: "openrouter", modelo_api: "openai/gpt-6-sol", tipo: "texto", rotulo: "Sol", preco_entrada_1m: 2, preco_saida_1m: 10, preco_cache_1m: null, preco_imagem: null, raciocinio: ["none", "low", "medium", "high", "xhigh", "max"], padrao_para: [], ativo: true } as ModeloIa,
];

beforeEach(() => {
  vi.clearAllMocks();
  mock.invoke.mockResolvedValue({ data: {}, error: null });
});

// ------------------------------------------------------------------ modelo

describe("modelo do agente do Mês: GPT-6 Sol alto, só aqui", () => {
  it("tela e servidor apontam o mesmo modelo, papel e raciocínio", () => {
    expect(MODELO_SERVIDOR).toBe("openrouter:openai/gpt-6-sol");
    expect(MODELO_DO_AGENTE_DO_MES).toBe(MODELO_SERVIDOR);
    expect(PAPEL_DO_AGENTE_DO_MES).toBe(PAPEL_SERVIDOR);
    expect(RACIOCINIO_DO_AGENTE_DO_MES).toBe("high");
    expect(RACIOCINIO_SERVIDOR).toBe("high");
  });

  it("raciocínio alto por padrão; pedido explícito vale; modelo sem high sobe para o mais perto", () => {
    expect(raciocinioDoMes(["none", "low", "medium", "high", "xhigh", "max"])).toBe("high");
    expect(raciocinioDoMes(["low", "medium", "high"], "medium")).toBe("medium");
    expect(raciocinioDoMes(["low", "xhigh"])).toBe("xhigh");
    expect(raciocinioDoMes([])).toBeUndefined();
  });

  it("catálogo: o papel agente_mes manda; sem ele, o Sol; o estrategista das outras telas segue o Luna", () => {
    expect(modeloDoMesNoCatalogo(CATALOGO)?.id).toBe("openrouter:openai/gpt-6-sol");
    expect(modeloDoAgenteDoMes(CATALOGO)?.id).toBe("openrouter:openai/gpt-6-sol");
    const comPapel = CATALOGO.concat([{ ...CATALOGO[0], id: "x:outro", padrao_para: ["agente_mes"] } as ModeloIa]);
    expect(modeloDoMesNoCatalogo(comPapel)?.id).toBe("x:outro");
    expect(modeloDoAgenteDoMes(comPapel)?.id).toBe("x:outro");
    expect(padraoPara(CATALOGO, "estrategista")?.id).toBe("openrouter:openai/gpt-6-luna");
    // Sem o Sol no catálogo, a tela cai no estrategista (o servidor faz o mesmo e avisa no log).
    expect(modeloDoAgenteDoMes([CATALOGO[0]])?.id).toBe("openrouter:openai/gpt-6-luna");
  });

  it("o servidor usa resolverModeloDoMes só no planejar_mes; pedido livre e geradores seguem o do estrategista", () => {
    expect(calendario.match(/await resolverModeloDoMes\(/g)?.length || 0).toBe(0);
    expect(calendario.match(/resolverModeloDoMes\(corpo\.modelo_id, corpo\.raciocinio\)/g)?.length).toBe(1);
    expect(corpoDe("planejarMes")).toContain("resolverModeloDoMes(corpo.modelo_id, corpo.raciocinio)");
    expect(corpoDe("pedidoLivre")).toContain('resolverModelo(corpo.modelo_id, corpo.raciocinio ?? "medium")');
    expect(corpoDe("resolverModeloDoMes")).toContain("modeloPadrao(PAPEL_DO_AGENTE_DO_MES)");
    expect(corpoDe("resolverModeloDoMes")).toContain("carregarModelo(MODELO_DO_AGENTE_DO_MES, \"texto\")");
  });

  it("o custo estimado antes usa o Sol, saída do raciocínio alto e os caracteres do pedido", () => {
    const [p] = partesDoPlanejamento(CATALOGO, 1, 32_000);
    expect(p.modeloId).toBe("openrouter:openai/gpt-6-sol");
    expect(p.tokensSaida).toBe(16_000 + 6000);
    expect(p.tokensEntrada).toBeGreaterThan(90_000 + 10_000);
    const [semNada] = partesDoPlanejamento(CATALOGO, 0);
    expect(semNada.tokensEntrada).toBe(90_000);
  });
});

// ------------------------------------------------------------------ tetos

describe("contexto grande sem cortar o pedido do dono", () => {
  it("tetos altos: mensagem de 200 mil, arquivos de 1,2 milhão, pedido de 700 mil tokens", () => {
    expect(MAX_CHARS_MENSAGEM_DO_MES).toBeGreaterThanOrEqual(200_000);
    expect(TETO_TOKENS_DO_PEDIDO).toBeGreaterThanOrEqual(600_000);
    expect(TETO_TOKENS_DO_PEDIDO).toBeLessThan(1_050_000);
    expect(MAX_CHARS_DOS_ARQUIVOS).toBe(MAX_CHARS_DOS_ARQUIVOS_SERVIDOR);
    expect(MAX_CHARS_POR_ARQUIVO).toBe(MAX_CHARS_POR_ARQUIVO_SERVIDOR);
    const planejar = corpoDe("planejarMes");
    expect(planejar).toContain("texto(corpo.mensagem, MAX_CHARS_MENSAGEM_DO_MES)");
    expect(planejar).not.toContain("texto(corpo.mensagem, 4000)");
    expect(planejar).toContain("maxTokensSaida: 48_000");
    expect(corpoDe("pedidoLivre")).toContain("texto(corpo.mensagem, 60_000)");
  });

  it("o orçamento corta primeiro o que menos importa e respeita o mínimo", () => {
    const grande = "x".repeat(320_000); // ~100 mil tokens
    const r = caberNoOrcamento(
      [
        { chave: "arquivos", texto: grande, prioridade: 95, minimo: 60_000 },
        { chave: "anteriores", texto: grande, prioridade: 40 },
        { chave: "agenda", texto: grande, prioridade: 85, minimo: 40_000 },
      ],
      200_000,
      10_000,
    );
    expect(r.tokens).toBeLessThanOrEqual(200_000);
    expect(r.cortes[0].chave).toBe("anteriores");
    expect(r.partes.find((p) => p.chave === "arquivos")!.texto.length).toBe(320_000);
    const nada = caberNoOrcamento([{ chave: "a", texto: "curto", prioridade: 1 }], 1000);
    expect(nada.cortes).toEqual([]);
  });

  it("arquivos do corpo: tetos por arquivo e no total, nada vazio", () => {
    const n = normalizarArquivos({
      lidos: [
        { nome: "a.txt", tipo: "texto", tamanho: 10, texto: "conteúdo" },
        { nome: "vazio.txt", texto: "   " },
        { nome: "grande.txt", texto: "y".repeat(500_000) },
      ],
      nao_lidos: [{ nome: "velho.doc", motivo: "Formato antigo" }],
    });
    expect(n.lidos.map((a) => a.nome)).toEqual(["a.txt", "grande.txt"]);
    expect(n.lidos[1].caracteres).toBe(400_000);
    expect(n.cortados).toEqual(["grande.txt"]);
    expect(n.nao_lidos[0].motivo).toBe("Formato antigo");
    expect(blocoDosArquivos(n.lidos)).toContain("=== a.txt (texto) ===\nconteúdo");
  });

  it("agenda longa: 12 meses, até 600 peças, com público, gancho, lâminas e legenda", () => {
    const planejar = corpoDe("planejarMes");
    expect(planejar).toContain("meses: MESES_DA_AGENDA_LONGA - 1");
    expect(planejar).toContain("max: MAX_PECAS_NA_AGENDA_LONGA");
    expect(planejar).toContain("detalhe: true");
    expect(planejar).toContain("contextoMcpAtivo(servico, clientId, MAX_CHARS_DO_MCP_NO_MES)");
    const muitas = Array.from({ length: 400 }, (_, i) => ({ id: `t${i}`, title: `P${i}`, due_date: "2026-11-02", delivery_type: "carousel", status: null }));
    expect(pecasComApelido(muitas, 600).length).toBe(400);
    expect(pecasComApelido(muitas).length).toBe(150);
  });
});

// ------------------------------------------------------------------ arquivos e ZIP no navegador

async function docxCom(texto: string): Promise<Uint8Array> {
  const z = new JSZip();
  z.file("word/document.xml", `<w:document><w:body><w:p><w:r><w:t>${texto}</w:t></w:r></w:p><w:p><w:r><w:t xml:space="preserve">Segunda &amp; linha</w:t></w:r></w:p></w:body></w:document>`);
  return z.generateAsync({ type: "uint8array" });
}

async function xlsxCom(): Promise<Uint8Array> {
  const z = new JSZip();
  z.file("xl/sharedStrings.xml", "<sst><si><t>Data</t></si><si><t>Formato</t></si><si><t>Tema</t></si><si><t>Reels</t></si><si><t>Dicas de verão</t></si></sst>");
  z.file("xl/workbook.xml", '<workbook><sheets><sheet name="Outubro" sheetId="1"/></sheets></workbook>');
  z.file("xl/worksheets/sheet1.xml", '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>2026-10-05</t></is></c><c r="B2" t="s"><v>3</v></c><c r="C2" t="s"><v>4</v></c></row></sheetData></worksheet>');
  return z.generateAsync({ type: "uint8array" });
}

describe("arquivos e ZIP lidos no navegador", () => {
  it("reconhece o tipo pelo nome", () => {
    expect(tipoDoArquivo("pauta.docx")).toBe("word");
    expect(tipoDoArquivo("cal.xlsx")).toBe("planilha");
    expect(tipoDoArquivo("cal.csv")).toBe("planilha");
    expect(tipoDoArquivo("x.zip")).toBe("zip");
    expect(tipoDoArquivo("velho.doc")).toBe("antigo");
    expect(tipoDoArquivo("a.png")).toBe("imagem");
    expect(tipoDoArquivo("roteiro.md")).toBe("texto");
    expect(tipoDoArquivo("video.mp4")).toBe("desconhecido");
    expect(textoDoDocx('<w:p><w:t>Olá</w:t><w:tab/><w:t>mundo</w:t></w:p><w:p><w:t>fim &lt;3</w:t></w:p>')).toBe("Olá\tmundo\nfim <3");
  });

  it("ZIP sintético: lê texto, CSV, Word e planilha; imagem vira anexo; ZIP dentro e .doc ficam de fora com motivo", async () => {
    const dentro = new JSZip();
    dentro.file("x.txt", "oi");
    const zip = new JSZip();
    zip.file("pautas/outubro.txt", "05/10 carrossel: 5 erros ao contratar");
    zip.file("pautas/cal.csv", "data,formato,tema\n2026-10-07,estatico,Promo");
    zip.file("pautas/briefing.docx", await docxCom("Falar com donos de clínica"));
    zip.file("pautas/cal.xlsx", await xlsxCom());
    zip.file("prints/capa.png", new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]));
    zip.file("antigo/velho.doc", "binário");
    zip.file("aninhado.zip", await dentro.generateAsync({ type: "uint8array" }));
    zip.file("__MACOSX/._lixo", "x");
    const bytes = await zip.generateAsync({ type: "uint8array" });
    const arquivo = new File([bytes], "material.zip", { type: "application/zip" });

    const r = await lerArquivosDoAgente([arquivo]);
    const nomes = r.lidos.map((a) => a.nome).sort();
    expect(nomes).toEqual(["pautas/briefing.docx", "pautas/cal.csv", "pautas/cal.xlsx", "pautas/outubro.txt"]);
    expect(r.lidos.every((a) => a.origem === "material.zip")).toBe(true);
    expect(r.lidos.find((a) => a.nome === "pautas/briefing.docx")!.texto).toBe("Falar com donos de clínica\nSegunda & linha");
    expect(r.lidos.find((a) => a.nome === "pautas/cal.xlsx")!.texto).toContain("Aba Outubro:\nData | Formato | Tema\n2026-10-05 | Reels | Dicas de verão");
    expect(r.lidos.find((a) => a.nome === "pautas/outubro.txt")!.caracteres).toBe("05/10 carrossel: 5 erros ao contratar".length);
    expect(r.imagens.map((f) => f.name)).toEqual(["capa.png"]);
    const motivos = Object.fromEntries(r.naoLidos.map((n) => [n.nome, n.motivo]));
    expect(motivos["aninhado.zip"]).toContain("ZIP dentro de ZIP");
    expect(motivos["antigo/velho.doc"]).toContain("Formato antigo");
    expect(Object.keys(motivos).some((n) => n.indexOf("__MACOSX") >= 0)).toBe(false);

    const envio = arquivosParaOEnvio(r.lidos, r.naoLidos)!;
    expect(envio.lidos.length).toBe(4);
    expect(envio.nao_lidos.length).toBe(2);
    expect(Object.keys(envio.lidos[0]).sort()).toEqual(["nome", "origem", "tamanho", "texto", "tipo"]);
  });

  it("ZIP acima de 50 MB volta como não lido, com mensagem amigável", async () => {
    const f = new File(["x"], "enorme.zip", { type: "application/zip" });
    Object.defineProperty(f, "size", { value: MAX_BYTES_DO_ZIP + 1 });
    const r = await lerArquivosDoAgente([f]);
    expect(r.lidos).toEqual([]);
    expect(r.naoLidos[0].motivo).toBe("ZIP acima de 50,0 MB.");
  });

  it("a tela mostra o que foi lido (com tamanho) e o que não deu para ler", async () => {
    const anexos: any = { lista: [], adicionar: vi.fn(), remover: vi.fn(), limpar: vi.fn(), tirarEnviados: vi.fn(), caminhos: [], subindo: false, cheio: false };
    const { result } = renderHook(() => useArquivosDoAgente(anexos));
    act(() => result.current.adicionar([new File(["texto do calendário"], "calendario.txt", { type: "text/plain" }), new File(["x"], "clip.mp4", { type: "video/mp4" }), new File(["p"], "print.png", { type: "image/png" })]));
    expect(anexos.adicionar).toHaveBeenCalledTimes(1);
    expect((anexos.adicionar.mock.calls[0][0] as File[]).map((f) => f.name)).toEqual(["print.png"]);
    await waitFor(() => expect(result.current.lidos.length).toBe(1));
    expect(result.current.naoLidos[0].nome).toBe("clip.mp4");
    const envio = result.current.paraOEnvio();
    expect(envio.corpo!.lidos[0]).toMatchObject({ nome: "calendario.txt", texto: "texto do calendário" });
    expect(envio.ids.length).toBe(2);

    render(h(ListaDeArquivos, { arquivos: result.current }));
    const resumo = screen.getByRole("button", { name: /1 arquivo lido · 19 caracteres · 1 não lido/ });
    fireEvent.click(resumo);
    expect(screen.getByText("calendario.txt")).toBeTruthy();
    expect(screen.getByText(/Formato que o agente não lê/)).toBeTruthy();
  });

  it("o corpo do planejamento só leva arquivos quando há", () => {
    expect(corpoDoPlanejamento({ clientId: "c", mensagem: "oi", mes: "2026-10-01" })).toEqual({ acao: "planejar_mes", client_id: "c", mensagem: "oi", mes: "2026-10" });
    const arquivos = { lidos: [{ nome: "a.txt", texto: "x" }], nao_lidos: [] };
    expect(corpoDoPlanejamento({ clientId: "c", mensagem: "oi", mes: "2026-10", arquivos }).arquivos).toBe(arquivos);
  });
});

// ------------------------------------------------------------------ colagem estruturada vira ações

const PECAS = pecasComApelido([
  { id: "11111111-0000-4000-8000-000000000001", title: "Como a agência escala", due_date: "2026-10-05", delivery_type: "carousel", status: null, detalhe: "público: agências" },
  { id: "11111111-0000-4000-8000-000000000002", title: "Tráfego para agências", due_date: "2026-11-03", delivery_type: "static", status: null },
  { id: "11111111-0000-4000-8000-000000000003", title: "Dezembro forte", due_date: "2026-12-01", delivery_type: "carousel", status: null },
]);

describe("material colado vira ações com apelidos", () => {
  it("criar_conteudos: datas e formatos do material, reels continua vídeo, data passada fica de fora", () => {
    const c = normalizarCriacao({
      resumo: "",
      orientacao: "Falar com o cliente final",
      itens: [
        { data: "2026-10-09", formato: "Reels", tema: "Bastidores", referencia: "Gancho: você sabia..." },
        { data: "2026-10-07", formato: "estático", tema: "Promoção de outubro", referencia: "" },
        { data: "2026-09-01", formato: "carrossel", tema: "Passado", referencia: "" },
        { data: "sem data", formato: "carrossel", tema: "Sem data", referencia: "" },
      ],
    }, "2026-09-26")!;
    expect(c.itens.map((i) => [i.data, i.formato, i.formato_pedido])).toEqual([
      ["2026-10-07", "estatico", null],
      ["2026-10-09", "video", null],
    ]);
    expect(c.ignorados).toBe(2);
    expect(c.resumo).toContain("2 conteúdos");
    expect(normalizarCriacao({ itens: [] }, "2026-09-26")).toBeNull();
  });

  it("lotes de 12 e o texto do lote leva as datas (a janela do pedido livre estica até elas)", () => {
    const itens = Array.from({ length: 30 }, (_, i) => ({ data: `2026-12-${String(i + 1).padStart(2, "0")}`, formato: "carrossel" as const, tema: `T${i}`, referencia: "ref" }));
    expect(lotesDaCriacao(itens).map((l) => l.length)).toEqual([12, 12, 6]);
    expect(LOTE_DA_CRIACAO).toBe(LOTE_SERVIDOR);
    const t = pedidoParaCriarServidor(itens.slice(0, 2), "Falar com o cliente final");
    expect(t).toContain("- 2026-12-01 · carrossel · T0\n  Referência do material: ref");
    expect(t).toContain("Orientação da equipe para todos: Falar com o cliente final");
    expect(pedidoParaCriar(itens.slice(0, 2), "Falar com o cliente final")).toBe(t);
    expect(janelaDoPedidoLivre("2026-09-26", t).fim).toBe("2026-12-02");
  });

  it("pedido amplo vira ações sobre todas as peças que casam; apelido inventado e repetido ficam de fora", () => {
    const a = normalizarAcoesNaAgenda({
      resumo: "",
      apagar: [],
      refazer: ["a3"],
      mudar_data: [],
      mudar_formato: [],
      editar_campanhas: [],
      editar_textos: [
        { ref: "a1", titulo: "", tema: "Como o dono da clínica lota a agenda", gancho: "", copy: "", cta: "", publico: "Donos de clínica", cards: [{ ordem: 1, texto: "Sua agenda vazia tem conserto" }] },
        { ref: "a2", titulo: "", tema: "", gancho: "", copy: "", cta: "", publico: "Donos de clínica", cards: [] },
        { ref: "a3", titulo: "x", tema: "", gancho: "", copy: "", cta: "", publico: "", cards: [] },
        { ref: "a9", titulo: "x", tema: "", gancho: "", copy: "", cta: "", publico: "", cards: [] },
        { ref: "a1", titulo: "de novo", tema: "", gancho: "", copy: "", cta: "", publico: "", cards: [] },
      ],
    }, PECAS)!;
    expect(a.editar_textos.map((e) => e.task_id)).toEqual([PECAS[0].id, PECAS[1].id]);
    expect(a.editar_textos[0].campos).toEqual({ tema: "Como o dono da clínica lota a agenda", publico: "Donos de clínica", cards: [{ ordem: 1, texto: "Sua agenda vazia tem conserto" }] });
    expect(a.refazer.map((r) => r.task_id)).toEqual([PECAS[2].id]);
    expect(a.ignorados).toEqual(["a3", "a9", "a1"]);
    expect(a.resumo).toBe("Vou refazer 1 peça e reescrever os textos de 2 peças.");
    // A tela lê o anexo com os textos.
    expect(acaoNaAgendaDaMensagem([{ ...a, tipo: "acao_agenda" }])!.editar_textos.length).toBe(2);
  });

  it("editar_textos normalizado: campo vazio não muda, lâmina fora de 1..20 e repetida saem, teto alto", () => {
    expect(camposDeTexto({ titulo: "  ", copy: "" })).toBeNull();
    expect(camposDeTexto({ cta: "Chame no WhatsApp", cards: [{ ordem: 0, texto: "x" }, { ordem: 2, texto: "b" }, { ordem: 2, texto: "c" }, { ordem: 1, texto: "a" }] })).toEqual({
      cta: "Chame no WhatsApp",
      cards: [{ ordem: 1, texto: "a" }, { ordem: 2, texto: "b" }],
    });
    expect(MAX_EDITAR_TEXTOS).toBeGreaterThanOrEqual(300);
    expect(REGRA_DAS_ACOES_NA_AGENDA).toContain("editar_textos");
    expect(REGRA_DAS_ACOES_NA_AGENDA).toContain("TODAS as peças que casam");
  });

  it("o servidor executa e desfaz editar_textos, guardando o antes, e o esquema pede os campos", () => {
    expect(calendario).toContain("const textos = await reescreverTextos(servico, m.client_id,");
    expect(calendario).toContain("voltaram += await desfazerTextos(servico, m.client_id,");
    expect(calendario).toContain("editar_textos: {");
    expect(calendario).toContain("criar_conteudos: {");
    expect(calendario).toContain("atualizar_publico: {");
    expect(corpoDe("reescreverTextos")).toContain("travaDaPeca(servico, clientId, t.id)");
    expect(calendario).toContain('const ACOES_LONGAS = new Set(["criar_lote_agenda", "executar_acao_agenda",');
    // Uma proposta é regravada uma vez (várias peças dela não se atropelam).
    expect(corpoDe("reescreverTextos")).toContain("for (const id of tocadas)");
  });

  it("a tela mostra a frase do que o agente leu", () => {
    expect(fraseDoContextoUsado({ modelo: "m", raciocinio: "high", tokens: 1, pecas: 312, mcp: 4, arquivos: 3, cortes: [] })).toBe("Li 312 peças da agenda, 4 itens do MCP e 3 arquivos.");
    expect(fraseDoContextoUsado({ modelo: "m", raciocinio: "high", tokens: 1, pecas: 1, mcp: 0, arquivos: 0, cortes: ["agenda"] })).toBe("Li 1 peça da agenda. Parte do contexto foi resumida para caber.");
    expect(criacaoDaMensagem([{ tipo: "criar_conteudos", resumo: "r", itens: [{ data: "2026-10-05", formato: "carrossel", tema: "t", referencia: "" }] }])!.itens.length).toBe(1);
  });
});

// ------------------------------------------------------------------ área MCP

type Linhas = Record<string, unknown[]>;
function bancoFalso(linhas: Linhas) {
  const gravados: any[] = [];
  const from = (tabela: string) => {
    const b: any = {};
    for (const m of ["select", "eq", "neq", "not", "in", "is", "or", "gte", "lte", "order", "limit", "contains", "overlaps"]) b[m] = () => b;
    b.upsert = (v: unknown) => {
      gravados.push({ tabela, v });
      return Promise.resolve({ error: null });
    };
    b.then = (ok: any, erro: any) =>
      Promise.resolve(linhas[tabela] === undefined ? { data: null, error: { code: "42P01", message: "relation does not exist" } } : { data: linhas[tabela], error: null }).then(ok, erro);
    return b;
  };
  return { db: { from }, gravados };
}

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const LINHAS_DO_MCP: Linhas = {
  project_memory: [
    { id: U(1), title: "Novo público", content: "A partir de novembro, falar com donos de clínica.", kind: "decisao", source: "ChatGPT Work", tags: ["orientacao_da_mesa"], metadata: { origin: "oauth:x", tipo: "orientacao_do_cliente", publico: "Donos de clínica" }, created_at: "2026-09-26T10:00:00Z" },
    { id: U(2), title: "Reunião", content: "Cliente quer mais vídeos.", kind: "nota", source: "Codex", tags: [], metadata: { origin: "oauth:y" }, created_at: "2026-09-25T10:00:00Z" },
    { id: U(3), title: "Do painel", content: "não veio do MCP", kind: "nota", source: "painel", tags: [], metadata: {}, created_at: "2026-09-25T10:00:00Z" },
  ],
  client_dossiers: [
    { id: U(4), dossier_type: "contexto", project_id: null, version: 3, summary: "Clínica odontológica", content: "Dossiê do ChatGPT", actor: "oauth:abc", source: "chatgpt-work", effective_at: "2026-09-20T10:00:00Z" },
    { id: U(5), dossier_type: "contexto", project_id: null, version: 9, summary: "", content: "Do ciclo", actor: "ciclo", source: "painel", effective_at: "2026-09-21T10:00:00Z" },
  ],
  files: [{ id: U(6), file_name: "pautas.pdf", mime_type: "application/pdf", size_bytes: 2048, created_at: "2026-09-24T10:00:00Z", description: null }],
  projects: [],
  file_content_chunks: [{ file_id: U(6), chunk_index: 0, text: "Pauta 1: bastidores" }],
  mesa_mcp_itens: [{ fonte: "arquivo", item_id: U(6), ativo: true }, { fonte: "dossie", item_id: U(4), ativo: false }],
};

describe("área MCP do cliente", () => {
  it("padrões: orientação e dossiê valem; memória, arquivo e rascunho esperam a equipe", () => {
    expect(ativoPorPadrao("orientacao")).toBe(true);
    expect(ativoPorPadrao("dossie")).toBe(true);
    expect(ativoPorPadrao("memoria")).toBe(false);
    expect(ativoPorPadrao("arquivo")).toBe(false);
    const [a, b] = aplicarPreferencias([{ fonte: "memoria", id: "m" }, { fonte: "orientacao", id: "o" }], [{ fonte: "memoria", item_id: "m", ativo: true }]);
    expect(a).toMatchObject({ ativo: true, padrao: false });
    expect(b).toMatchObject({ ativo: true, padrao: true });
    expect(dossieVeioDoMcp("oauth:06848537")).toBe(true);
    expect(dossieVeioDoMcp("27901254-0000-4000-8000-000000000000")).toBe(true);
    expect(dossieVeioDoMcp("painel:abc")).toBe(false);
    expect(dossieVeioDoMcp("ciclo")).toBe(false);
  });

  it("lista só o que veio do MCP, com a escolha da equipe por cima do padrão", async () => {
    const { db } = bancoFalso(LINHAS_DO_MCP);
    const { itens, tabela } = await itensMcpDoCliente(db, "c");
    expect(tabela).toBe(true);
    const tela = paraATela(itens);
    expect(tela.map((i) => `${i.fonte}:${i.titulo}:${i.ativo}`)).toEqual([
      "orientacao:Novo público:true",
      "memoria:Reunião:false",
      "dossie:Dossiê contexto · versão 3:false",
      "arquivo:pautas.pdf:true",
    ]);
    expect(tela[0].publico).toBe("Donos de clínica");
    expect((tela[0] as any).conteudo).toBeUndefined();
  });

  it("os itens ativos entram no contexto dos geradores; os desligados não", async () => {
    const { db } = bancoFalso(LINHAS_DO_MCP);
    const r = await contextoMcpAtivo(db, "c", 50_000);
    expect(r.ativos).toBe(2);
    expect(r.texto).toContain("CONTEXTO VINDO DO MCP");
    expect(r.texto).toContain("A partir de novembro, falar com donos de clínica.");
    expect(r.texto).toContain("Público declarado: Donos de clínica");
    expect(r.texto).toContain("Pauta 1: bastidores");
    expect(r.texto).not.toContain("Cliente quer mais vídeos.");
    expect(r.texto).not.toContain("Dossiê do ChatGPT");
    // A orientação vem antes do arquivo.
    expect(r.texto.indexOf("Orientação")).toBeLessThan(r.texto.indexOf("Arquivo"));
    // Todos os geradores leem: montarContexto junta o MCP e contextoEmTexto põe no pedido.
    expect(calendario).toContain("contextoMcpAtivo(servico, clientId, limiteMcp)");
    expect(calendario).toContain("${ctx.mcp ? `\\n${ctx.mcp}` : \"\"}");
  });

  it("sem a tabela de escolhas (SQL M-01), valem os padrões", async () => {
    const semTabela = { ...LINHAS_DO_MCP };
    delete (semTabela as any).mesa_mcp_itens;
    const { db } = bancoFalso(semTabela);
    const { itens, tabela } = await itensMcpDoCliente(db, "c");
    expect(tabela).toBe(false);
    expect(itens.filter((i) => i.ativo).map((i) => i.fonte).sort()).toEqual(["dossie", "orientacao"]);
    expect(blocoDoMcp([], 1000)).toBe("");
  });

  it("a tela lista e troca pelo agente-calendario, com o acesso no servidor", async () => {
    mock.invoke.mockImplementation(async (_f: string, { body }: any) => {
      if (body.acao === "itens_mcp") {
        return { data: { tabela: true, itens: [{ fonte: "memoria", id: U(2), titulo: "Reunião", resumo: "Cliente quer mais vídeos.", origem: "Codex", quando: "2026-09-25T10:00:00Z", tamanho: 25, ativo: false, padrao: true }] }, error: null };
      }
      return { data: { item: {} }, error: null };
    });
    const valor = { clientId: "11111111-1111-1111-1111-111111111111", clientName: "C", userId: "u", isAdmin: true, podeRecarregar: true, saldoUsd: 1, catalogo: CATALOGO, catalogoCarregando: false, atualizarCusto: vi.fn(), abrirRecarga: vi.fn(), abrirChaves: vi.fn(), abrirModelos: vi.fn() } as unknown as MesaValor;
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(h(QueryClientProvider, { client: qc }, h(TooltipProvider, null, h(MesaProvider, { valor }, h(ContextoMcp)))));
    await waitFor(() => expect(screen.getByText("Reunião")).toBeTruthy());
    expect(screen.getByText("1 item · 0 valem para o planejamento")).toBeTruthy();
    fireEvent.click(screen.getByRole("switch", { name: "Reunião: vale para o planejamento" }));
    await waitFor(() => expect(mock.invoke.mock.calls.some((c) => c[1].body.acao === "ativar_item_mcp")).toBe(true));
    const corpo = mock.invoke.mock.calls.find((c) => c[1].body.acao === "ativar_item_mcp")![1].body;
    expect(corpo).toMatchObject({ acao: "ativar_item_mcp", client_id: "11111111-1111-1111-1111-111111111111", fonte: "memoria", item_id: U(2), ativo: true });
    expect(ler("src/components/mesa/AbaContexto.tsx")).toContain('titulo="MCP"');
  });

  it("MCP 2.4: aceleriq_client_instruction grava orientação com o público, na fronteira do cliente", () => {
    const tools = ler("supabase/functions/_shared/mcp-tools.ts");
    expect(tools).toContain("name: 'aceleriq_client_instruction'");
    expect(tools).toContain("aceleriq_client_instruction: 'clients:write'");
    expect(tools).toContain("  clientInstructionTool,");
    expect(ler("supabase/functions/_shared/mcp-release.ts")).toContain("'2.4.0'");
    const servico = ler("supabase/functions/_shared/mcp-orientacao-services.ts");
    expect(servico).toContain("assertClientAccess(ctx, input.client_id)");
    expect(servico).toContain("exigirClienteExistente(db()");
    expect(servico).toContain("findIdempotentResult('aceleriq_client_instruction'");
    expect(servico).toContain("tags: [ETIQUETA_DA_ORIENTACAO]");
  });
});

// ------------------------------------------------------------------ público do prompt (Jev simulado)

// jsdom não tem AbortSignal.timeout (o Deno e os navegadores têm).
if (typeof (AbortSignal as any).timeout !== "function") (AbortSignal as any).timeout = () => new AbortController().signal;

const pedidosAoJev: any[] = [];
function jevSimulado(traz: number, coerente: number) {
  return vi.fn(async (_url: string, init: any) => {
    pedidosAoJev.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ model: "jev-1.13.0", answers: { traz_publico: { type: "noul", noul: traz }, publico_coerente: { type: "noul", noul: coerente } }, usage: { input_tokens: 900 } }), { status: 200 });
  });
}

const ESTADO = estadoDoPublico({
  negocio: "Clínica odontológica em Curitiba",
  oferta: "Implantes e lentes",
  publico: "Adultos de 30 a 60 anos",
  prompt: "Faça os conteúdos de novembro falando com donos de clínica.",
  evidencias: ["Dossiê: clientes são pacientes", "", "Aprovados: Implante sem dor"],
});

describe("público do prompt: o Jev decide se é real antes de adaptar", () => {
  it("estado nomeado e duas perguntas Noul", () => {
    expect(Object.keys(ESTADO)).toEqual(["negocio", "oferta", "publico_registrado", "publico_do_prompt", "evidencias"]);
    expect(ESTADO.evidencias).toEqual(["Dossiê: clientes são pacientes", "Aprovados: Implante sem dor"]);
    expect(PERGUNTAS_DO_PUBLICO.traz_publico.type).toBe("noul");
    expect(PERGUNTAS_DO_PUBLICO.publico_coerente.type).toBe("noul");
    expect(String(PERGUNTAS_DO_PUBLICO.publico_coerente.instructions)).toContain("`negocio`");
  });

  it("alto: adapta e propõe atualizar o público do contexto (com confirmação)", async () => {
    const r = await jevPerguntar({ state: ESTADO, questions: PERGUNTAS_DO_PUBLICO }, { chave: "teste", fetchImpl: jevSimulado(0.92, 0.85) as any });
    const pedido = pedidosAoJev[pedidosAoJev.length - 1];
    expect(Object.keys(pedido.questions).sort()).toEqual(["publico_coerente", "traz_publico"]);
    expect(pedido.state.publico_do_prompt).toContain("donos de clínica");
    expect(pedido.model).toBe("jev-latest");
    const d = decidirPublico(r.answers);
    expect(d.decisao).toBe("adaptar");
    expect(blocoDaDecisaoDoPublico(d)).toContain("Adapte os conteúdos a esse público");
    const acao = acaoDeAtualizarPublico({ publico: "Donos de clínica odontológica", motivo: "O dono pediu." }, "Adultos de 30 a 60 anos", d, "c-1", 1)!;
    expect(acao.tipo).toBe("acao_agente");
    expect(acao.agente).toBe("mes");
    expect(acao.itens[0]).toMatchObject({ ref: "p1", alvo_id: "c-1", operacao: "atualizar_publico", para: "Donos de clínica odontológica" });
  });

  it("baixo: mantém o público registrado e avisa em uma frase, sem proposta", async () => {
    const r = await jevPerguntar({ state: ESTADO, questions: PERGUNTAS_DO_PUBLICO }, { chave: "teste", fetchImpl: jevSimulado(0.9, 0.12) as any });
    const d = decidirPublico(r.answers);
    expect(d.decisao).toBe("manter");
    expect(d.frase).toBe("O público do pedido não combina com o negócio: mantive o público registrado.");
    expect(blocoDaDecisaoDoPublico(d)).toContain("Mantenha o público registrado");
    expect(acaoDeAtualizarPublico({ publico: "Donos de clínica", motivo: "" }, "Adultos", d, "c-1")).toBeNull();
  });

  it("meio: pergunta antes de adaptar", async () => {
    const r = await jevPerguntar({ state: ESTADO, questions: PERGUNTAS_DO_PUBLICO }, { chave: "teste", fetchImpl: jevSimulado(0.8, 0.5) as any });
    const d = decidirPublico(r.answers);
    expect(d.decisao).toBe("perguntar");
    expect(blocoDaDecisaoDoPublico(d)).toContain("pergunte em uma frase");
    expect(acaoDeAtualizarPublico({ publico: "Donos de clínica", motivo: "" }, "Adultos", d, "c-1")).toBeNull();
  });

  it("sem público novo ou sem Jev: nada muda e nada é pedido ao modelo", () => {
    expect(decidirPublico({ traz_publico: { noul: 0.1 }, publico_coerente: { noul: 0.9 } }).decisao).toBe("sem_publico_novo");
    expect(decidirPublico(null).decisao).toBe("indisponivel");
    expect(blocoDaDecisaoDoPublico(decidirPublico(null))).toBe("");
  });

  it("o servidor registra a decisão na conversa, cobra o Jev e executa a troca pelo contrato comum", () => {
    const planejar = corpoDe("planejarMes");
    expect(planejar).toContain('anexosDaResposta.push({ tipo: "decisao_publico", ...decisaoDoPublico })');
    expect(corpoDe("julgarPublico")).toContain("await cobrarJev(r,");
    expect(corpoDe("julgarPublico")).toContain("jevPerguntar({ state: estadoDoPublico(entrada), questions: PERGUNTAS_DO_PUBLICO })");
    expect(calendario).toContain("executar_acao_agente: executarAcaoDoMes");
    expect(calendario).toContain("desfazer_acao_agente: desfazerAcaoDoMes");
    expect(corpoDe("executarAcaoDoMes")).toContain('item.operacao !== "atualizar_publico"');
  });
});

// ------------------------------------------------------------------ menos texto nas lâminas

describe("menos texto nas lâminas (sem laço de correção)", () => {
  it("lâmina dentro do limite volta igual; acima, corta no fim de frase e avisa", () => {
    const curta = [{ ordem: 1, funcao: "capa", texto: "Sua agenda vazia tem conserto" }, { ordem: 2, funcao: "cta", texto: "Chame no WhatsApp" }];
    expect(conferirLaminas(curta)).toEqual({ cards: curta, avisos: [] });

    const longa = "Primeira frase curta sobre o assunto. " + "Segunda frase ".repeat(20) + "fim.";
    const r = conferirLaminas([
      { ordem: 1, funcao: "capa", texto: "Gancho" },
      { ordem: 2, funcao: "conteudo", texto: longa },
      { ordem: 3, funcao: "cta", texto: "Chame" },
    ]);
    expect(r.avisos).toEqual([{ ordem: 2, papel: "interna", palavras: contarPalavras(longa), limite: LIMITE_DA_LAMINA }]);
    expect(r.cards[1].texto).toBe("Primeira frase curta sobre o assunto.");
    expect(r.cards[0].texto).toBe("Gancho");
  });

  it("sem fim de frase que caiba, corta na palavra com reticências; título na 1ª linha fica", () => {
    const capa = Array.from({ length: 30 }, (_, i) => `p${i}`).join(" ");
    expect(cortarNoLimiteDeFrase(capa, LIMITE_DA_CAPA)).toBe(`${Array.from({ length: LIMITE_DA_CAPA }, (_, i) => `p${i}`).join(" ")}…`);
    const comTitulo = `Título curto da lâmina\n${"apoio ".repeat(40).trim()}.`;
    expect(cortarNoLimiteDeFrase(comTitulo, 20)).toBe("Título curto da lâmina");
  });

  it("todos os geradores recebem a regra e o esquema descreve a lâmina; o corte roda em normalizarItem", () => {
    expect(REGRA_DE_MENOS_TEXTO).toContain("UMA ideia");
    expect(REGRA_DE_MENOS_TEXTO).toContain("legenda (copy)");
    expect(REGRA_DE_MENOS_TEXTO).toContain("na mesma resposta");
    expect(calendario).toContain("${REGRA_DE_MENOS_TEXTO}");
    expect(calendario).toContain("texto: S(\"string\", { description: DESCRICAO_DO_TEXTO_DA_LAMINA })");
    expect(calendario).toContain("const conferido = conferirLaminas(");
    expect(calendario).toContain("avisos_de_texto: avisosDeTexto");
    // Sem laço: nenhuma chamada de modelo dentro da conferência.
    expect(ler("supabase/functions/_shared/menos-texto-nas-laminas.ts")).not.toContain("chamarTexto");
  });
});
