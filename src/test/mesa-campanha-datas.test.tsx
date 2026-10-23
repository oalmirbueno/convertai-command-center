import { createElement as h } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Datas, stories, vídeos e o agente da campanha (22/10/2026):
 * - a linha do tempo em código: fases por tipo e por número de dias, introdução primeiro e encerramento por
 *   último, compressão quando começa tarde e o limite de posts por dia;
 * - "Reorganizar datas e fases": diff com a linha nova, peças aprovadas protegidas, introdução e encerramento
 *   novos, mudar de dia não refaz a arte;
 * - Stories e Vídeos da campanha por fase: abrem o lugar certo, roteiro editável e gerado com custo, releitura
 *   ao voltar;
 * - o agente: não estica a página, propõe passos com Confirmar e responde com a situação da campanha.
 */

const mock = vi.hoisted(() => ({
  invoke: vi.fn(),
  tabelas: {} as Record<string, unknown>,
}));

vi.mock("@/integrations/supabase/client", () => {
  const consulta = (tabela: string) => {
    const dados = mock.tabelas[tabela] === undefined ? [] : mock.tabelas[tabela];
    const b: any = {};
    for (const m of ["select", "eq", "neq", "not", "in", "is", "or", "contains", "order", "limit", "range", "update", "gte", "lte"]) b[m] = () => b;
    const primeiro = () => ({ data: Array.isArray(dados) ? (dados[0] === undefined ? null : dados[0]) : dados, error: null });
    b.maybeSingle = () => Promise.resolve(primeiro());
    b.single = () => Promise.resolve(primeiro());
    b.then = (ok: any, erro: any) => Promise.resolve({ data: dados, error: null, count: Array.isArray(dados) ? dados.length : 0 }).then(ok, erro);
    return b;
  };
  return {
    supabase: {
      functions: { invoke: mock.invoke },
      rpc: vi.fn(() => Promise.resolve({ data: null, error: null })),
      from: (tabela: string) => consulta(tabela),
      storage: { from: () => ({ upload: vi.fn(() => Promise.resolve({ data: {}, error: null })), createSignedUrl: () => Promise.resolve({ data: { signedUrl: "https://arquivo.test/img.png" }, error: null }) }) },
    },
  };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));
// 22/10: os caminhos Gravar e Gerar da peça de vídeo têm testes próprios (campanha-gravar-video e campanha-gerar-video).
vi.mock("@/components/mesa/GravarVideoDaCampanha", () => ({ default: (p: { item: { tema: string } }) => h("div", { "data-testid": "gravar-video" }, `Gravar ${p.item.tema}`) }));
vi.mock("@/components/mesa/GerarVideoDaCampanha", () => ({ default: (p: { item: { tema: string } }) => h("div", { "data-testid": "gerar-video" }, `Gerar ${p.item.tema}`) }));

import { TooltipProvider } from "@/components/ui/tooltip";
import { MesaProvider, type MesaValor } from "@/components/mesa/MesaContexto";
import CampanhaNova from "@/components/mesa/CampanhaNova";
import CampanhaLinhaDoTempo, { EditorDaLinha, linhaPrevista } from "@/components/mesa/CampanhaLinhaDoTempo";
import CampanhaStories from "@/components/mesa/CampanhaStories";
import CampanhaVideos from "@/components/mesa/CampanhaVideos";
import CampanhaMudanca from "@/components/mesa/CampanhaMudanca";
import CampanhaAgente, { atalhosDoEstado } from "@/components/mesa/CampanhaAgente";
import { porFase } from "@/components/mesa/areasDaCampanha";
import { lerEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
import { chaves, hojeIso, type Campanha, type ItemProposto } from "@/components/mesa/mesaV4Api";
import type { ModeloIa } from "@/lib/mesa/api";
import type { AcaoDoAgente } from "@/lib/agentes/acoesDoAgente";
import { calcularLinhaDoTempo, faseNaData, vagasDasPecas } from "../../supabase/functions/agente-calendario/modulos/linha-do-tempo";
import { itensDaReorganizacao, reorganizarPecas } from "../../supabase/functions/agente-calendario/modulos/reorganizar-campanha";
import { aplicarMudanca, itensDaMudanca, pecasComApelido } from "../../supabase/functions/agente-calendario/modulos/mudanca-da-campanha";
import { direcaoDoRoteiro, normalizarRoteiroDeVideo } from "../../supabase/functions/agente-calendario/modulos/roteiro-de-video";

const CLIENTE = "11111111-1111-1111-1111-111111111111";
const CAMPANHA_ID = "d7140376-0000-4000-8000-000000000001";
const PROPOSTA_ID = "22222222-2222-4222-8222-222222222222";

const catalogo: ModeloIa[] = [
  {
    id: "openai:gpt-texto", provedor: "openai", modelo_api: "gpt-texto", tipo: "texto", rotulo: "Texto",
    preco_entrada_1m: 1, preco_saida_1m: 2, preco_cache_1m: null, preco_imagem: null,
    raciocinio: ["low", "medium"], padrao_para: ["estrategista", "diretor_arte", "leitura"], ativo: true,
  },
  {
    id: "openai:gpt-image-2", provedor: "openai", modelo_api: "gpt-image-2", tipo: "imagem", rotulo: "Imagem",
    preco_entrada_1m: null, preco_saida_1m: null, preco_cache_1m: null, preco_imagem: { baixa: 0.01, media: 0.04, alta: 0.17 },
    raciocinio: [], padrao_para: ["imagem"], ativo: true,
  },
];

const valorDaMesa = (): MesaValor => ({
  clientId: CLIENTE, clientName: "Cliente sintético", userId: "u-1", isAdmin: true, podeRecarregar: true, saldoUsd: 50,
  catalogo, catalogoCarregando: false, atualizarCusto: vi.fn(), abrirRecarga: vi.fn(), abrirChaves: vi.fn(), abrirModelos: vi.fn(),
});

function Onde() {
  const l = useLocation();
  return h("span", { "data-testid": "onde" }, `${l.pathname}${l.search}`);
}

function montar(filho: any, qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  return {
    qc,
    ...render(
      h(MemoryRouter, { initialEntries: ["/mesa"] },
        h(QueryClientProvider, { client: qc }, h(TooltipProvider, null, h(MesaProvider, { valor: valorDaMesa(), children: h(Routes, null, h(Route, { path: "*", element: h("div", null, filho, h(Onde)) })) })))),
    ),
  };
}

const chamadas = (acao: string) => mock.invoke.mock.calls.filter((c) => c[1] && c[1].body && c[1].body.acao === acao).map((c) => c[1].body);
/** Custo antes: o primeiro clique mostra o custo (ou roda direto, se for centavos); o segundo confirma. */
const confirmarCusto = async (botao: HTMLElement, acao: string) => {
  fireEvent.click(botao);
  await new Promise((r) => setTimeout(r, 450));
  if (!chamadas(acao).length) fireEvent.click(botao);
};

// A campanha sintética do Halloween (qualquer cliente: nada de dado fixo além do teste).
const linhaHalloween = calcularLinhaDoTempo({ esquema: "halloween", evento: "2026-10-31", diasAntes: 10, hoje: "2026-10-22" });
const itens: ItemProposto[] = [
  { tema_id: "c1", data: "2026-10-23", formato: "estatico", etapa: "lançamento", tema: "Exorcismo de vírus", gancho: "R$ 89", cards: [{ ordem: 1, texto: "R$ 89" }], task_id: "t-aprovada" },
  { tema_id: "c2", data: "2026-10-26", formato: "carrossel", etapa: "lançamento", tema: "Poção anti-lentidão", gancho: "PC lento?", cards: [{ ordem: 1, texto: "Capa" }] },
  { tema_id: "c3", data: "2026-10-27", formato: "video", etapa: "sustentação", tema: "Reels do PC assombrado", gancho: "Ele travou de novo", cards: [], video: { estilo: "produto", prompt: "PC na bancada", referencias: [], narracao: "", formato: "9:16" } as any },
];
const campanha: Campanha = {
  id: CAMPANHA_ID, client_id: CLIENTE, nome: "Halloween do PC", pedido: "Halloween com exorcismo de vírus", objetivo: "Vender", periodo_inicio: "2026-10-22", periodo_fim: "2026-10-31",
  conceito: "", identidade: {}, referencias_ids: [], selo_path: null, proposta_id: PROPOSTA_ID, status: "planejada", custo_usd: 0, criado_em: "2026-10-20T12:00:00Z",
  briefing: { produtos: [], oferta: "R$ 89", mensagem_central: "", publico: "", provas: [], tom: "", cta: "Chame no WhatsApp", esquema: "halloween", linha_do_tempo: linhaHalloween, trilha: { arquivo: "x/trilha.mp3", titulo: "Suspense leve", duracao: 30 } } as any,
  imagens: [],
};
const proposta = { id: PROPOSTA_ID, client_id: CLIENTE, project_id: "p", periodo_inicio: "2026-10-22", periodo_fim: "2026-10-31", itens, status: "pronta", task_ids: [] };

beforeEach(() => {
  vi.clearAllMocks();
  mock.tabelas = { calendario_propostas: [proposta], mesa_campanhas: [campanha] };
  mock.invoke.mockImplementation(async (_f: string, { body }: any) => {
    if (body.acao === "sequencias_da_campanha") {
      return {
        data: {
          sequencias: [{ id: "seq-1", client_id: CLIENTE, data: "2026-10-22", objetivo: "vender", titulo: "O monstro aparece", gancho_de_amanha: null, criado_em: "x", campanha: { campanha_id: CAMPANHA_ID, tema_id: "s1", fase: "aquecimento", nome: "Halloween do PC" } }],
          stories: [
            { id: "st-1", sequencia_id: "seq-1", client_id: CLIENTE, ordem: 1, molde: "", titulo: "", texto_na_tela: "Seu PC está assombrado?", adesivo: { tipo: "nenhum" }, fundo: { tipo: "cor" }, horario: "09:00", caminho: "automatico", situacao: "rascunho", criado_em: "x", atualizado_em: "x" },
            { id: "st-2", sequencia_id: "seq-1", client_id: CLIENTE, ordem: 2, molde: "", titulo: "", texto_na_tela: "Vem aí a poção", adesivo: { tipo: "nenhum" }, fundo: { tipo: "cor" }, horario: "12:00", caminho: "automatico", situacao: "agendado", criado_em: "x", atualizado_em: "x" },
          ],
        },
        error: null,
      };
    }
    if (body.acao === "editar_item") {
      // Como o servidor: devolve a série com o item editado.
      const item = { ...itens[2], ...body.campos };
      return { data: { proposta: { ...proposta, itens: [itens[0], itens[1], item] }, item, avisos: [], custo_usd: 0 }, error: null };
    }
    // 23/10 (frente B): as cenas com os ganchos do nicho vêm da mesa-roteiros e a tela salva na peça pelo editar_item.
    if (body.acao === "peca_cenas_gerar") {
      return { data: { roteiro_video: { gancho: "Ele travou", cenas: [{ ordem: 1, descricao: "PC fumaçando", fala: "Seu PC está assombrado?", texto_na_tela: "Exorcismo R$ 89", segundos: 5 }], duracao: 5, trilha: "Suspense leve", cta: "Chame no WhatsApp" }, escolha: { indice: 0, como: "jev", porque: "Versão 1.", notas: [], formulas: [] }, custo_usd: 0.01 }, error: null };
    }
    if (body.acao === "campanha_roteiro_video") {
      const item = { ...itens[2], roteiro_video: { gancho: "Ele travou", cenas: [{ ordem: 1, descricao: "PC fumaçando", fala: "Seu PC está assombrado?", texto_na_tela: "Exorcismo R$ 89", segundos: 5 }], duracao: 5, trilha: "Suspense leve", cta: "Chame no WhatsApp" } };
      return { data: { proposta: { ...proposta, itens: [itens[0], itens[1], item] }, item, custo_usd: 0.01 }, error: null };
    }
    return { data: { campanha, proposta, custo_usd: 0 }, error: null };
  });
});

// ------------------------------------------------------------------ linha do tempo (código)

describe("linha do tempo calculada em código", () => {
  const fases = (l: ReturnType<typeof calcularLinhaDoTempo>) => l.fases.map((f) => `${f.fase} ${f.inicio.slice(8)}-${f.fim.slice(8)}`);

  it("Halloween em 31/10 começando 10 dias antes: a conta pelos dias, com as fases de fim de semana no dia útil vizinho", () => {
    const l = calcularLinhaDoTempo({ esquema: "halloween", evento: "2026-10-31", diasAntes: 10, hoje: "2026-10-01" });
    // A conta pelos dias: 21-23, 24, 25-28, 29-30, 31. Lançamento (sábado 24) e encerramento (sábado 31) só
    // tinham fim de semana: o lançamento vai até a segunda 26 e o encerramento começa na sexta 30.
    expect(fases(l)).toEqual(["aquecimento 21-23", "lancamento 24-26", "sustentacao 27-28", "urgencia 29-29", "encerramento 30-31"]);
    expect(l.avisos.join(" ")).toContain("fim de semana");
    expect(l.comprimida).toBe(false);
  });

  it("Black Friday: o dia do evento é o lançamento e a campanha segue até o Cyber Monday e a última chamada", () => {
    const l = calcularLinhaDoTempo({ esquema: "black_friday", evento: "2026-11-27", hoje: "2026-10-01" });
    expect(l.inicio).toBe("2026-11-13");
    const lanc = l.fases.filter((f) => f.fase === "lancamento")[0];
    expect(lanc.inicio).toBe("2026-11-27");
    expect(l.fases.filter((f) => f.fase === "urgencia")[0].inicio).toBe("2026-11-30");
    expect(l.fases[l.fases.length - 1].fase).toBe("encerramento");
    expect(l.fases[0].nome).toContain("Pré-Black");
  });

  it("o número de dias muda as janelas (mais dias antes, aquecimento maior) e o padrão vem do tipo", () => {
    const curto = calcularLinhaDoTempo({ esquema: "promocional", evento: "2026-12-10", diasAntes: 5, hoje: "2026-10-01" });
    const longo = calcularLinhaDoTempo({ esquema: "promocional", evento: "2026-12-10", diasAntes: 20, hoje: "2026-10-01" });
    expect(longo.fases[0].dias).toBeGreaterThan(curto.fases[0].dias);
    expect(calcularLinhaDoTempo({ esquema: "natal", evento: "2026-12-25", hoje: "2026-10-01" }).inicio).toBe("2026-12-04");
  });

  it("começou tarde: começa hoje, avisa e comprime sem pular a introdução", () => {
    expect(linhaHalloween.inicio).toBe("2026-10-22");
    expect(linhaHalloween.comprimida).toBe(true);
    expect(linhaHalloween.avisos[0]).toContain("introdução comprimida");
    expect(linhaHalloween.fases[0].fase).toBe("aquecimento");
    const naVespera = calcularLinhaDoTempo({ esquema: "halloween", evento: "2026-10-31", diasAntes: 10, hoje: "2026-10-30" });
    expect(naVespera.fases[0]).toMatchObject({ fase: "aquecimento", inicio: "2026-10-30" });
    expect(naVespera.fases[naVespera.fases.length - 1].fase).toBe("encerramento");
  });

  it("as vagas: a primeira é introdução, a última é encerramento e o fim de semana vai para o dia útil", () => {
    const { vagas, avisos } = vagasDasPecas(linhaHalloween, 6, { porDia: 1 });
    expect(vagas[0].fase).toBe("aquecimento");
    expect(vagas[vagas.length - 1].fase).toBe("encerramento");
    expect(vagas.map((v) => v.data)).toEqual(vagas.map((v) => v.data).slice().sort());
    vagas.forEach((v) => expect([0, 6]).not.toContain(new Date(`${v.data}T12:00:00Z`).getUTCDay()));
    expect(linhaHalloween.avisos.concat(avisos).join(" ")).toContain("fim de semana");
  });

  it("respeita os posts por dia do cliente e o calendário que já existe", () => {
    const cheio = { "2026-10-27": 1, "2026-10-28": 1 };
    const um = vagasDasPecas(linhaHalloween, 5, { porDia: 1, ocupacao: cheio });
    expect(um.vagas.map((v) => v.data)).not.toContain("2026-10-27");
    expect(um.vagas.map((v) => v.data)).not.toContain("2026-10-28");
    // A introdução não sai da fase dela: com os dias dela cheios, fica acima do limite, com aviso.
    const semIntro = vagasDasPecas(linhaHalloween, 3, { porDia: 1, ocupacao: { "2026-10-22": 1, "2026-10-23": 1 } });
    expect(semIntro.vagas[0].fase).toBe("aquecimento");
    expect(semIntro.avisos.join(" ")).toContain("acima do limite");
    const contagem: Record<string, number> = {};
    um.vagas.forEach((v) => { contagem[v.data] = (contagem[v.data] || 0) + 1; });
    Object.values(contagem).forEach((n) => expect(n).toBeLessThanOrEqual(1));
    const dois = vagasDasPecas(linhaHalloween, 9, { porDia: 2 });
    const porDia: Record<string, number> = {};
    dois.vagas.forEach((v) => { porDia[v.data] = (porDia[v.data] || 0) + 1; });
    Object.values(porDia).forEach((n) => expect(n).toBeLessThanOrEqual(2));
  });
});

// ------------------------------------------------------------------ reorganizar

describe("reorganizar datas e fases", () => {
  const pecas = pecasComApelido(itens as any, new Set(["c1"]), new Set(["c1", "c2"]));
  const r = reorganizarPecas({ linha: linhaHalloween, pecas, porDia: 1, ocupacao: {} });
  const lista = itensDaReorganizacao(null, linhaHalloween, r, r.novas.map((v) => ({ tema: v.fase === "aquecimento" ? "O monstro aparece" : "Última chamada", gancho: "g", laminas: ["l"], cta: "Chame", legenda: "" })));

  it("a aprovada fica onde está; as outras vão para as vagas; falta introdução e encerramento: entram novas", () => {
    expect(r.movimentos.map((m) => m.peca.tema_id)).toEqual(["c2", "c3"]);
    expect(r.novas.map((v) => v.fase)).toEqual(["aquecimento", "encerramento"]);
    expect(r.novas[0].data <= r.movimentos[0].data).toBe(true);
  });

  it("o diff traz a linha nova, as peças que mudam de dia (a arte continua valendo) e as que entram", () => {
    expect(lista[0].operacao).toBe("linha_do_tempo");
    expect(lista.filter((i) => i.operacao === "alterar_peca").every((i) => String(i.detalhe).indexOf("a arte continua valendo") >= 0)).toBe(true);
    expect(lista.filter((i) => i.operacao === "nova_peca").map((i) => i.titulo)).toEqual(["O monstro aparece", "Última chamada"]);
    expect(lista.some((i) => i.alvo_id === "c1")).toBe(false);
  });

  it("aplicar grava a linha no briefing e mudar de dia não pede arte nova", () => {
    const a = aplicarMudanca({ briefing: {}, itens: itens as any }, lista);
    expect((a.briefing.linha_do_tempo as any).evento).toBe("2026-10-31");
    expect(a.mudouConteudo).toEqual([]);
    expect(a.novas.length).toBe(2);
    expect(a.itens.filter((i) => i.tema_id === "c1")[0].data).toBe("2026-10-23");
  });

  it("no servidor: a criação usa as vagas (data e etapa do código) e a reorganização interna é segura", () => {
    const fonte = readFileSync(resolve(__dirname, "../../supabase/functions/agente-calendario/index.ts"), "utf8");
    expect(fonte).toContain("item.data = vaga.data;");
    expect(fonte).toContain("item.etapa = vaga.etapa;");
    const reorg = fonte.slice(fonte.indexOf("async function campanhaReorganizar("), fonte.indexOf("async function campanhaReorganizarInterno("));
    expect(reorg).not.toContain("aprovado_em");
    expect(reorg).not.toContain("rapida_preparar");
    expect(fonte).toContain('acao === "campanha_reorganizar_interno") return await campanhaReorganizarInterno(servico, corpo);');
  });
});

// ------------------------------------------------------------------ telas: criação e linha da campanha

describe("criação com data do evento", () => {
  it("manda data do evento, dias antes e o período da linha; arrastar o início pelo teclado muda a prévia", async () => {
    montar(h(CampanhaNova, { onCriada: vi.fn() }));
    fireEvent.change(screen.getByLabelText("Pedido da campanha"), { target: { value: "Halloween com exorcismo de vírus" } });
    const hoje = hojeIso();
    const evento = new Date(Date.parse(`${hoje}T12:00:00Z`) + 20 * 86400000).toISOString().slice(0, 10);
    fireEvent.change(screen.getByLabelText("Data do evento"), { target: { value: evento } });
    fireEvent.change(screen.getByLabelText("Dias antes do evento"), { target: { value: "10" } });
    expect(screen.getByRole("list", { name: "Fases da linha do tempo" }).querySelectorAll("li").length).toBe(5);
    const inicioAntes = (document.querySelector("[data-inicio]") as HTMLElement).getAttribute("data-inicio");
    fireEvent.keyDown(screen.getByRole("slider", { name: "Arrastar o início" }), { key: "ArrowLeft" });
    const inicioDepois = (document.querySelector("[data-inicio]") as HTMLElement).getAttribute("data-inicio") as string;
    expect(inicioDepois < (inicioAntes as string)).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /Criar campanha/ }));
    await waitFor(() => expect(chamadas("campanha_criar").length).toBe(1));
    expect(chamadas("campanha_criar")[0]).toMatchObject({ data_evento: evento, dias_antes: 11, periodo_inicio: inicioDepois });
  });

  it("na campanha: Reorganizar datas e fases com o evento mudado chama campanha_reorganizar (custo antes)", async () => {
    montar(h(CampanhaLinhaDoTempo, { campanha }));
    expect(screen.getByRole("list", { name: "Fases da linha do tempo" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Mudar o evento ou o início/ }));
    fireEvent.change(screen.getByLabelText("Dias antes do evento"), { target: { value: "9" } });
    await confirmarCusto(screen.getByRole("button", { name: /Reorganizar datas e fases/ }), "campanha_reorganizar");
    await waitFor(() => expect(chamadas("campanha_reorganizar").length).toBe(1));
    expect(chamadas("campanha_reorganizar")[0]).toMatchObject({ campanha_id: CAMPANHA_ID, data_evento: "2026-10-31", dias_antes: 9 });
  });

  it("a prévia da tela é a mesma conta do servidor", () => {
    const tela = linhaPrevista({ evento: "2026-10-31", diasAntes: 10, fim: null }, "halloween", "2026-10-01");
    expect(tela).toEqual(calcularLinhaDoTempo({ esquema: "halloween", evento: "2026-10-31", diasAntes: 10, fim: null, hoje: "2026-10-01" }));
  });
});

// ------------------------------------------------------------------ stories e vídeos da campanha

describe("stories da campanha", () => {
  it("lista por fase com as telas, o estado, o horário e o texto; abre a tela certa; fase vazia cria com custo", async () => {
    const abrir = vi.fn();
    montar(h(CampanhaStories, { campanha, onAbrirStories: abrir }));
    const aquec = await screen.findByRole("region", { name: /Stories: O monstro aparece/ });
    expect((await within(aquec).findAllByText("Seu PC está assombrado?")).length).toBeGreaterThan(0);
    expect(within(aquec).getByText("Agendado")).toBeTruthy();
    expect(within(aquec).getByText("12:00")).toBeTruthy();
    fireEvent.click(within(aquec).getByRole("button", { name: "Abrir a tela 2 nos Stories" }));
    expect(abrir).toHaveBeenCalledWith("seq-1", "st-2");
    const urg = screen.getByRole("region", { name: /Stories: Antes da meia-noite/ });
    expect(within(urg).getByText("Sem sequência nesta fase ainda.")).toBeTruthy();
    expect(within(urg).getByRole("button", { name: /Criar a sequência desta fase/ })).toBeTruthy();
  });

  it("ao voltar (montar de novo), relê as sequências", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const a = montar(h(CampanhaStories, { campanha }), qc);
    await screen.findAllByText("Seu PC está assombrado?");
    a.unmount();
    montar(h(CampanhaStories, { campanha }), qc);
    await waitFor(() => expect(chamadas("sequencias_da_campanha").length).toBe(2));
  });

  it("agrupa pela data dentro da janela e pela fase escrita fora dela", () => {
    const g = porFase(linhaHalloween.fases, [{ data: "2026-10-29" }, { data: "2026-12-01", etapa: "aquecimento" }]);
    expect(g.filter((x) => x.fase.fase === "urgencia")[0].itens.length).toBe(1);
    expect(g[0].itens.length).toBe(1);
  });
});

describe("vídeos e Reels da campanha", () => {
  // 23/10 (agente unificado): o roteiro da peça fica à vista com UM agente ao lado; o roteiro antigo do item
  // aparece (migração na leitura) e as cenas de IA do item vão para a Mesa Vídeos.
  it("mostra a peça por fase com o roteiro do item e um só agente ao lado; abrir fora da agenda vai à Mesa Vídeos com as cenas", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const cenas = { gancho: "Ele travou", cenas: [{ ordem: 1, descricao: "PC fumaçando", fala: "Seu PC tá assombrado? Exorcismo por R$ 89", texto_na_tela: "Exorcismo R$ 89", segundos: 5 }], duracao: 5, trilha: "Suspense leve", cta: "Chame no WhatsApp" };
    const comCenas = { ...proposta, itens: [itens[0], itens[1], { ...itens[2], roteiro_video: cenas }] };
    qc.setQueryData(chaves.proposta(PROPOSTA_ID), comCenas);
    mock.tabelas.calendario_propostas = [comCenas];
    montar(h(CampanhaVideos, { campanha }), qc);
    const regiao = await screen.findByRole("region", { name: /Vídeos: Prova e produtos/ });
    expect(within(regiao).getByText("Reels do PC assombrado")).toBeTruthy();
    expect(await within(regiao).findByText("Seu PC tá assombrado? Exorcismo por R$ 89")).toBeTruthy();
    expect(within(regiao).getAllByRole("region", { name: /Agente de roteiro/ })).toHaveLength(1);
    // Nada de agente antigo nem de editor solto de cenas fora do Gerar.
    expect(chamadas("campanha_roteiro_agente")).toHaveLength(0);
    expect(within(regiao).queryByRole("button", { name: "Salvar o roteiro" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Abrir Reels do PC assombrado no estúdio de vídeo/ }));
    expect(screen.getByTestId("onde").textContent).toBe(`/mesa-videos?client=${CLIENTE}&etapa=gerar&modo=livre`);
    // O rascunho vai para a rota da Mesa Vídeos (o estado da tela é por rota).
    const rascunho = lerEstadoDaTela<any>(`mesa-videos:livre:${CLIENTE}`, null, undefined, "/mesa-videos");
    expect(rascunho.prompt).toContain("Gancho");
    expect(rascunho.narracao).toContain("Exorcismo por R$ 89");
  });

  it("na agenda, abre no Estúdio da pauta", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const naAgenda = { ...proposta, itens: [itens[0], itens[1], { ...itens[2], task_id: "t-video" }] };
    qc.setQueryData(chaves.proposta(PROPOSTA_ID), naAgenda);
    mock.tabelas.calendario_propostas = [naAgenda];
    const estudio = vi.fn();
    montar(h(CampanhaVideos, { campanha, onAbrirNoEstudio: estudio }), qc);
    fireEvent.click(await screen.findByRole("button", { name: /Abrir Reels do PC assombrado no estúdio de vídeo/ }));
    expect(estudio).toHaveBeenCalledWith("t-video", "2026-10");
  });

  it("a direção do vídeo sai do roteiro", () => {
    const r = normalizarRoteiroDeVideo({ gancho: "Travou?", cenas: [{ descricao: "PC", fala: "Oi", texto_na_tela: "R$ 89", segundos: 4 }], trilha: "Suspense", cta: "Chame" });
    expect(r!.duracao).toBe(5);
    const d = direcaoDoRoteiro(r!);
    expect(d.prompt).toContain('Texto na tela: "R$ 89"');
    expect(d.narracao).toBe("Oi");
  });
});

// ------------------------------------------------------------------ agente

describe("agente da campanha mais agêntico", () => {
  it("o painel não cresce com a conversa: altura da coluna, só a conversa rola", () => {
    mock.tabelas.agente_conversas = [{ id: "conv-1" }];
    const { container } = montar(h(CampanhaAgente, { campanha }));
    const raiz = container.querySelector("[data-agente-da-campanha]") as HTMLElement;
    expect(raiz.className).toContain("overflow-hidden");
    const conversa = screen.getByLabelText("Conversa com o agente da campanha");
    expect(conversa.className).toContain("overflow-y-auto");
    expect(conversa.className).toContain("relative");
    const aba = readFileSync(resolve(__dirname, "../components/mesa/AbaCampanhas.tsx"), "utf8");
    expect(aba).toContain('<section className="relative min-h-0 min-w-0 lg:overflow-y-auto');
  });

  it("as sugestões mudam com o estado da campanha", () => {
    const s = atalhosDoEstado({ briefing: { stories: [{ tema_id: "s1", sequencia_id: null }], ads: { campaign_id: "1" } } }, [{ formato: "video" }]).map((a) => a.rotulo);
    expect(s.slice(0, 4)).toEqual(["O que falta?", "Reorganizar datas e fases", "Criar os stories que faltam", "Roteiros dos vídeos"]);
    expect(s).toContain("Como está o anúncio?");
    const pronta = atalhosDoEstado(campanha, [{ formato: "video", roteiro_video: {} }]).map((a) => a.rotulo);
    expect(pronta).not.toContain("Reorganizar datas e fases");
    expect(pronta).not.toContain("Escolher a trilha");
  });

  it("o plano em etapas: passos com apelido viram tema_id e só valem passos da casa", () => {
    const pecas = pecasComApelido(itens as any, new Set(), new Set());
    const { itens: lista, ignorados } = itensDaMudanca({ resposta: "", passos: [{ acao: "gerar_roteiro_de_video", alvo: "a3", motivo: "falta roteiro" }, { acao: "criar_stories_da_fase", alvo: "aquecimento", motivo: "" }, { acao: "apagar_tudo", alvo: "", motivo: "" }] }, pecas, { briefing: {}, conducao: "", periodo: { inicio: "2026-10-22", fim: "2026-10-31" } });
    expect(lista.map((i) => i.operacao)).toEqual(["passo_gerar_roteiro_de_video", "passo_criar_stories_da_fase"]);
    expect(JSON.parse(String(lista[0].para))).toEqual({ acao: "gerar_roteiro_de_video", alvo: "c3" });
    expect(ignorados).toEqual([]);
  });

  it("propõe e só faz depois do Confirmar, mostrando o que está fazendo agora", async () => {
    const acao: AcaoDoAgente = {
      tipo: "acao_agente", agente: "campanha.mudanca", id: "acao-9", resumo: "Roteiros", ignorados: [], recusados: [],
      itens: [{ ref: "m1", alvo_id: "c3", titulo: "Gerar o roteiro do vídeo: a3 · Reels", detalhe: "falta roteiro", operacao: "passo_gerar_roteiro_de_video", rotulo: "Passo", para: JSON.stringify({ acao: "gerar_roteiro_de_video", alvo: "c3" }) } as any],
    };
    montar(h(CampanhaMudanca, { campanha, mensagemId: "msg-9", acao }));
    expect(screen.getByRole("list", { name: "Plano do agente" })).toBeTruthy();
    expect(chamadas("campanha_roteiro_video").length).toBe(0);
    fireEvent.click(screen.getByRole("button", { name: "Confirmar 1 item(ns)" }));
    await waitFor(() => expect(chamadas("campanha_mudanca_confirmar").length).toBe(1));
    await waitFor(() => expect(chamadas("campanha_roteiro_video")[0]).toMatchObject({ tema_id: "c3" }));
  });

  it("no servidor: o agente lê a situação da campanha (peças, stories, trilha e anúncio) e a linha do tempo", () => {
    const fonte = readFileSync(resolve(__dirname, "../../supabase/functions/agente-calendario/index.ts"), "utf8");
    const planejar = fonte.slice(fonte.indexOf("async function campanhaMudancaPlanejar("), fonte.indexOf("/** Acha a mensagem da ação planejada"));
    expect(planejar).toContain("situacaoDaCampanhaParaOAgente(servico, c, pecas)");
    expect(planejar).toContain("blocoDaLinhaDoTempo(");
    const situacao = fonte.slice(fonte.indexOf("async function situacaoDaCampanhaParaOAgente("), fonte.indexOf("/** Acha a mensagem da ação planejada"));
    expect(situacao).toContain('from("ads_campaign_daily")');
    expect(situacao).toContain("Trilha escolhida");
  });
});

// ------------------------------------------------------------------ Stop, 23/10/2026: as duas correções

describe("reorganizar: a fase é a da data e a 1ª peça é sempre introdução (caso Stop)", () => {
  // A Stop rodada em 22/10: evento 31/10, 9 dias antes; a 1ª peça existente era oferta escrita como aquecimento.
  const linha = calcularLinhaDoTempo({ esquema: "halloween", evento: "2026-10-31", diasAntes: 9, hoje: "2026-10-22" });
  const serie: any[] = [
    { tema_id: "c1", data: "2026-10-23", formato: "estatico", etapa: "aquecimento", tema: "Poção anti-lentidão: oferta de formatação com backup", gancho: "Formatação com backup por R$ 89", cta: "Chame no WhatsApp", cards: [{ ordem: 1, texto: "R$ 89" }] },
    { tema_id: "c2", data: "2026-10-23", formato: "estatico", etapa: "aquecimento", tema: "Seu PC está assombrado?", gancho: "Ele trava sozinho?", cta: "Fique de olho", cards: [{ ordem: 1, texto: "Vem aí" }] },
    { tema_id: "c3", data: "2026-10-26", formato: "carrossel", etapa: "lançamento", tema: "Exorcismo de vírus", gancho: "R$ 69", cta: "Garanta", cards: [{ ordem: 1, texto: "R$ 69" }] },
    { tema_id: "c4", data: "2026-10-26", formato: "estatico", etapa: "lançamento", tema: "Kit Ressurreição", gancho: "Backup e limpeza", cta: "Garanta", cards: [{ ordem: 1, texto: "Kit" }] },
    { tema_id: "c5", data: "2026-10-27", formato: "estatico", etapa: "sustentação", tema: "Quem já fez", gancho: "4,9 estrelas", cta: "Chame", cards: [{ ordem: 1, texto: "4,9" }] },
    { tema_id: "c6", data: "2026-10-27", formato: "estatico", etapa: "sustentação", tema: "Antes e depois", gancho: "De 3 min para 20 s", cta: "Chame", cards: [{ ordem: 1, texto: "20 s" }] },
    { tema_id: "c7", data: "2026-10-27", formato: "estatico", etapa: "lançamento", tema: "Poção do Desconto: mouse promocional", gancho: "Mouse por R$ 39", cta: "Garanta", cards: [{ ordem: 1, texto: "R$ 39" }] },
    { tema_id: "c8", data: "2026-10-29", formato: "estatico", etapa: "urgência", tema: "Faltam 2 dias", gancho: "Acaba dia 31", cta: "Garanta", cards: [{ ordem: 1, texto: "2 dias" }] },
    { tema_id: "c9", data: "2026-10-30", formato: "estatico", etapa: "encerramento", tema: "Reta final", gancho: "Última chamada: acaba amanhã", cta: "Garanta hoje", cards: [{ ordem: 1, texto: "Última chamada" }] },
  ];
  // O calendário de fora já tem post em 27 e 28 (limite de 1 por dia): força peças a sair da fase delas.
  const ocupacao = { "2026-10-27": 1, "2026-10-28": 1 };
  const conteudo = (v: { fase: string }) => (v.fase === "aquecimento"
    ? { tema: "O monstro aparece", gancho: "Algo estranho no seu PC", laminas: ["Vem aí"], cta: "Ative o lembrete", legenda: "" }
    : { tema: "Última chamada", gancho: "Acaba hoje", laminas: ["Última chamada"], cta: "Garanta hoje", legenda: "" });
  const rodar = (itensDaSerie: any[], antes: any) => {
    const pecas = pecasComApelido(itensDaSerie, new Set(), new Set());
    const r = reorganizarPecas({ linha, pecas, porDia: 1, ocupacao });
    return { r, lista: itensDaReorganizacao(antes, linha, r, r.novas.map(conteudo)) };
  };
  const { r, lista } = rodar(serie, null);
  const datas = r.movimentos.map((m) => m.data).concat(r.novas.map((v) => v.data));

  it("toda peça fica com a fase da janela em que a data cai (a de lançamento empurrada não vira aquecimento)", () => {
    r.movimentos.forEach((m) => expect(m.fase).toBe((faseNaData(linha, m.data) as any).fase));
    r.novas.forEach((v) => expect(v.fase).toBe((faseNaData(linha, v.data) as any).fase));
    const c7 = r.movimentos.filter((m) => m.peca.tema_id === "c7")[0];
    expect(c7.fase).not.toBe("aquecimento");
    expect(c7.etapa).toBe((faseNaData(linha, c7.data) as any).etapa);
  });

  it("a 1ª peça existente sendo oferta: a introdução de verdade vai para a ponta e a oferta sai do aquecimento", () => {
    const primeira = datas.slice().sort()[0];
    const c1 = r.movimentos.filter((m) => m.peca.tema_id === "c1")[0];
    expect(c1.fase).not.toBe("aquecimento");
    const c2 = r.movimentos.filter((m) => m.peca.tema_id === "c2")[0];
    expect(c2.data).toBe(primeira);
    expect(c2.fase).toBe("aquecimento");
    expect(["2026-10-22", "2026-10-23"]).toContain(primeira);
  });

  it("sem nenhuma introdução de verdade, cria a introdução no começo (22 ou 23)", () => {
    const soOferta = serie.filter((x) => x.tema_id !== "c2");
    const { r: r2 } = rodar(soOferta, null);
    expect(r2.novas[0].fase).toBe("aquecimento");
    expect(["2026-10-22", "2026-10-23"]).toContain(r2.novas[0].data);
    expect(r2.novas[0].data <= r2.movimentos.map((m) => m.data).sort()[0]).toBe(true);
    expect(r2.movimentos.filter((m) => m.peca.tema_id === "c1")[0].fase).not.toBe("aquecimento");
  });

  it("a última peça é de encerramento (o sábado 31 vai para a sexta 30, dentro da janela do encerramento)", () => {
    const ultima = r.movimentos.slice().sort((a, b) => a.data.localeCompare(b.data)).pop() as any;
    expect(ultima.peca.tema_id).toBe("c9");
    expect(ultima.fase).toBe("encerramento");
    expect(ultima.data).toBe("2026-10-30");
  });

  it("idempotente: rodar de novo sobre o resultado não muda nada", () => {
    const aplicado = aplicarMudanca({ briefing: {}, itens: serie }, lista);
    const { r: r2, lista: lista2 } = rodar(aplicado.itens as any[], aplicado.briefing.linha_do_tempo);
    expect(r2.novas).toEqual([]);
    expect(lista2).toEqual([]);
  });

  it("no servidor: o Jev julga introdução ou oferta nas peças de aquecimento antes de reorganizar", () => {
    const fonte = readFileSync(resolve(__dirname, "../../supabase/functions/agente-calendario/index.ts"), "utf8");
    const reorg = fonte.slice(fonte.indexOf("async function campanhaReorganizar("), fonte.indexOf("async function campanhaReorganizarInterno("));
    expect(reorg).toContain("introducoesPeloJev(c, pecas, chamador.userId)");
    expect(reorg).toContain("introducoes: introducoes.lista");
  });
});

describe("peça de vídeo da campanha: gravar ou gerar (22/10)", () => {
  // 23/10 (agente unificado): o roteiro fica sempre à vista e o seletor só escolhe o caminho; Gravar por padrão.
  it("Gravar por padrão; Gerar abre o caminho na própria peça; o seletor não tem mais a aba Roteiro", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(chaves.proposta(PROPOSTA_ID), proposta);
    montar(h(CampanhaVideos, { campanha }), qc);
    const regiao = await screen.findByRole("region", { name: /Vídeos: Prova e produtos/ });
    expect(within(regiao).getAllByRole("tab").map((t) => t.textContent)).toEqual(["Gravar", "Gerar"]);
    expect(within(regiao).getByRole("tab", { name: /Gravar/ }).getAttribute("aria-selected")).toBe("true");
    expect((await within(regiao).findByTestId("gravar-video")).textContent).toBe("Gravar Reels do PC assombrado");
    expect(within(regiao).getByRole("region", { name: /Agente de roteiro de Reels do PC assombrado/ })).toBeTruthy();
    fireEvent.click(within(regiao).getByRole("tab", { name: /Gerar/ }));
    expect((await within(regiao).findByTestId("gerar-video")).textContent).toBe("Gerar Reels do PC assombrado");
    expect(within(regiao).queryByTestId("gravar-video")).toBeNull();
  });
});
