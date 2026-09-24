import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement as h } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Mesa Ads v2 (docs/mesa-ads/v2/CONTRATO-V2.md): as telas novas contra o
 * contrato da função mesa-ads. Agente de oferta, conta ao vivo, janela da
 * referência, plano com o laço de qualidade, lote do Estúdio e pacote de
 * copy. A função e as tabelas são simuladas; o teste confere os campos que
 * cada ação manda e o que a tela mostra com a resposta.
 */

const mock = vi.hoisted(() => ({
  invoke: vi.fn(),
  upload: vi.fn(),
  rpc: vi.fn(),
  tabelas: {} as Record<string, unknown>,
}));

vi.mock("@/integrations/supabase/client", () => {
  const consulta = (tabela: string) => {
    const dados = mock.tabelas[tabela] === undefined ? [] : mock.tabelas[tabela];
    const b: any = {};
    for (const m of ["select", "eq", "neq", "not", "in", "is", "or", "contains", "order", "limit", "range", "update", "insert"]) b[m] = () => b;
    const primeiro = () => ({ data: Array.isArray(dados) ? (dados[0] === undefined ? null : dados[0]) : dados, error: null });
    b.maybeSingle = () => Promise.resolve(primeiro());
    b.single = () => Promise.resolve(primeiro());
    b.then = (ok: any, erro: any) => Promise.resolve({ data: dados, error: null, count: Array.isArray(dados) ? dados.length : 0 }).then(ok, erro);
    return b;
  };
  return {
    supabase: {
      functions: { invoke: mock.invoke },
      rpc: mock.rpc,
      from: (tabela: string) => consulta(tabela),
      storage: {
        from: () => ({
          upload: mock.upload,
          createSignedUrl: () => Promise.resolve({ data: { signedUrl: "https://arquivo.test/img.png" }, error: null }),
        }),
      },
    },
  };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { role: "admin" }, user: { id: "u-1" } }) }));

import { TooltipProvider } from "@/components/ui/tooltip";
import { MesaProvider, type MesaValor } from "@/components/mesa/MesaContexto";
import { ErroDaMesa, type ModeloIa } from "@/lib/mesa/api";
import AbaOferta from "@/components/mesa-ads/AbaOferta";
import AbaConta, { ordenarAnuncios } from "@/components/mesa-ads/AbaConta";
import AbaReferencias from "@/components/mesa-ads/AbaReferencias";
import AbaPlano from "@/components/mesa-ads/AbaPlano";
import PainelDaCopy from "@/components/mesa-ads/PainelDaCopy";
import { produzirLamina, situacaoDoTrabalho } from "@/components/mesa-ads/loteDoEstudio";
import {
  anguloAprovado,
  briefingVazio,
  chavesAds,
  corpoDoPlano,
  juntarBriefing,
  normalizarConta,
  normalizarDetalhe,
  normalizarOferta,
  normalizarPacote,
  normalizarRespostaDaOferta,
  ordenarReferencias,
  pacoteEmMarkdown,
  tempoDesde,
  type CriativoAds,
  type PlanoAds,
  type ReferenciaAds,
} from "@/components/mesa-ads/adsApi";

const raiz = resolve(__dirname, "../..");
const CLIENTE = "11111111-1111-1111-1111-111111111111";

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
  clientId: CLIENTE,
  clientName: "Clínica Sintética",
  userId: "u-1",
  isAdmin: true,
  podeRecarregar: true,
  saldoUsd: 50,
  catalogo,
  catalogoCarregando: false,
  atualizarCusto: vi.fn(),
  abrirRecarga: vi.fn(),
  abrirChaves: vi.fn(),
  abrirModelos: vi.fn(),
});

function montar(filho: any, qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  return { qc, ...render(h(QueryClientProvider, { client: qc }, h(TooltipProvider, null, h(MesaProvider, { valor: valorDaMesa(), children: filho })))) };
}

const chamadasDe = (acao: string) =>
  mock.invoke.mock.calls.filter((c: any[]) => c[0] === "mesa-ads" && c[1] && c[1].body && c[1].body.acao === acao).map((c: any[]) => c[1].body);
const chamadasDoEstudio = (acao: string) =>
  mock.invoke.mock.calls.filter((c: any[]) => c[0] === "estudio-arte" && c[1] && c[1].body && c[1].body.acao === acao).map((c: any[]) => c[1].body);

/** Resposta da função por ação (o resto devolve ok). */
function responder(mapa: Record<string, unknown>) {
  mock.invoke.mockImplementation(async (_f: string, { body }: any) =>
    Object.prototype.hasOwnProperty.call(mapa, body.acao) ? { data: mapa[body.acao], error: null } : { data: { ok: true, custo_usd: 0.001 }, error: null },
  );
}

beforeAll(() => {
  if (typeof (globalThis as any).ResizeObserver === "undefined") {
    (globalThis as any).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
});

beforeEach(() => {
  vi.clearAllMocks();
  mock.tabelas = {};
  try {
    window.localStorage.clear();
  } catch {
    /* sem armazenamento */
  }
  mock.rpc.mockResolvedValue({ data: { saldo_usd: 12.5 }, error: null });
  responder({});
});

// ------------------------------------------------------------------ oferta

const OFERTA_DA_RESPOSTA = {
  id: "of-1",
  nome: "Clareamento em 2 sessões",
  para_quem: "quem tem casamento no mês",
  promessa: "Sorriso mais claro antes do grande dia, com avaliação grátis",
  mecanismo: "Protocolo em consultório com moldeira sob medida",
  entregaveis: ["Avaliação", "2 sessões"],
  bonus: ["Kit de manutenção"],
  garantia: "Retoque sem custo em 30 dias",
  urgencia_real: "8 horários por semana",
  ancoragem: null,
  cta: "Agende a avaliação",
  provas_necessarias: ["Fotos autorizadas"],
  riscos: [],
  status: "rascunho",
  jev: { clareza: 8, forca: 7, risco_politica: 9, alerta_politica: null },
};

describe("oferta: agente conversacional e ofertas", () => {
  it("a conversa chama oferta_conversar; as ofertas voltam com as notas do Jev e as ações mandam oferta_salvar", async () => {
    responder({
      oferta_conversar: {
        conversa_id: "c0ffee00-0000-4000-8000-000000000001",
        resposta: "Montei uma oferta de entrada.",
        ofertas: [OFERTA_DA_RESPOSTA],
        briefing_sugerido: { oferta: { produto: "Clareamento dental" } },
        ideias: [{ titulo: "Contagem regressiva", gancho_verbal: "Faltam 30 dias?", gancho_visual: "Calendário", estilo_visual: "tipografico", formato: "feed_4x5" }],
        custo_usd: 0.02,
      },
      oferta_salvar: { oferta: { ...OFERTA_DA_RESPOSTA, status: "escolhida" } },
    });
    const onCriar = vi.fn();
    montar(h(AbaOferta, { onCriarCriativos: onCriar }));
    const campo = await screen.findByLabelText("Mensagem ao agente de oferta");
    fireEvent.change(campo, { target: { value: "Clínica vende clareamento a R$ 890, público de noivas" } });
    fireEvent.click(within(screen.getByLabelText("Agente de oferta")).getByRole("button", { name: /Enviar/ }));
    await waitFor(() => expect(chamadasDe("oferta_conversar")).toHaveLength(1));
    expect(chamadasDe("oferta_conversar")[0]).toEqual({ acao: "oferta_conversar", client_id: CLIENTE, mensagem: "Clínica vende clareamento a R$ 890, público de noivas" });

    const cartao = await screen.findByRole("article", { name: "Oferta Clareamento em 2 sessões" });
    expect(within(cartao).getByText("Nova")).toBeTruthy();
    expect(within(cartao).getByRole("meter", { name: "Força" }).getAttribute("aria-valuenow")).toBe("7");
    expect(within(cartao).getByRole("meter", { name: "Política" }).getAttribute("aria-valuenow")).toBe("9");
    expect(screen.getByText("Montei uma oferta de entrada.")).toBeTruthy();
    expect(screen.getByText("Contagem regressiva")).toBeTruthy();
    // A conversa em andamento fica guardada para a próxima mensagem.
    expect(window.localStorage.getItem(`mesa-ads:oferta-conversa:${CLIENTE}`)).toBe("c0ffee00-0000-4000-8000-000000000001");

    fireEvent.click(within(cartao).getByRole("button", { name: /Escolher/ }));
    await waitFor(() => expect(chamadasDe("oferta_salvar")).toHaveLength(1));
    expect(chamadasDe("oferta_salvar")[0]).toEqual({ acao: "oferta_salvar", client_id: CLIENTE, oferta_id: "of-1", status: "escolhida" });

    // Aplicar no briefing preenche o formulário sem gravar.
    fireEvent.click(within(cartao).getByRole("button", { name: /Aplicar no briefing/ }));
    expect((screen.getByLabelText("Produto ou serviço") as HTMLInputElement).value).toBe("Clareamento em 2 sessões");
    expect((screen.getByLabelText("Garantia") as HTMLInputElement).value).toBe("Retoque sem custo em 30 dias");
    expect(chamadasDe("briefing_salvar")).toHaveLength(0);

    // Criar criativos leva ao plano com a oferta e o objetivo.
    fireEvent.change(screen.getByLabelText("Objetivo dos criativos"), { target: { value: "seguidores" } });
    fireEvent.click(within(screen.getByRole("article", { name: "Oferta Clareamento em 2 sessões" })).getByRole("button", { name: /Criar criativos desta oferta/ }));
    await waitFor(() => expect(onCriar).toHaveBeenCalledTimes(1));
    expect(onCriar.mock.calls[0][0]).toMatchObject({ oferta_id: "of-1", objetivo: "seguidores" });
    expect(chamadasDe("plano_gerar")).toHaveLength(0);
  });

  it("ofertas salvas vêm de ads_ofertas (campos dentro de oferta); editar e arquivar mandam oferta_salvar", async () => {
    mock.tabelas.ads_ofertas = [
      { id: "of-9", client_id: CLIENTE, nome: "Avaliação grátis", oferta: { promessa: "Descubra o tom ideal", cta: "Chame no WhatsApp", entregaveis: ["Avaliação"] }, jev: { clareza: 0.9, forca: 0.6, risco_politica: 0.8 }, status: "rascunho", conversa_id: null, criado_em: "2026-09-20" },
    ];
    montar(h(AbaOferta, { onCriarCriativos: vi.fn() }));
    const cartao = await screen.findByRole("article", { name: "Oferta Avaliação grátis" });
    expect(within(cartao).getByText("Descubra o tom ideal")).toBeTruthy();
    expect(within(cartao).getByRole("meter", { name: "Clareza" }).getAttribute("aria-valuenow")).toBe("9");

    fireEvent.click(within(cartao).getByRole("button", { name: /Editar/ }));
    const edicao = screen.getByRole("article", { name: "Editar a oferta Avaliação grátis" });
    fireEvent.change(within(edicao).getByLabelText("Bônus"), { target: { value: "Escova\nFio dental" } });
    fireEvent.click(within(edicao).getByRole("button", { name: /Salvar oferta/ }));
    await waitFor(() => expect(chamadasDe("oferta_salvar")).toHaveLength(1));
    const corpo = chamadasDe("oferta_salvar")[0];
    expect(corpo.oferta_id).toBe("of-9");
    expect(corpo.campos.bonus).toEqual(["Escova", "Fio dental"]);
    expect(corpo.campos.promessa).toBe("Descubra o tom ideal");

    fireEvent.click(within(await screen.findByRole("article", { name: "Oferta Avaliação grátis" })).getByRole("button", { name: /Arquivar/ }));
    await waitFor(() => expect(chamadasDe("oferta_salvar")).toHaveLength(2));
    expect(chamadasDe("oferta_salvar")[1]).toEqual({ acao: "oferta_salvar", client_id: CLIENTE, oferta_id: "of-9", status: "arquivada" });
  });

  it("normalização da oferta e do briefing sugerido: tolera campo faltando e não apaga o que a equipe escreveu", () => {
    const o = normalizarOferta({ id: "x", oferta: { nome: "Dentro", bonus: "A\nB" }, jev: { clareza: 85, forca: 40 } });
    expect(o.nome).toBe("Dentro");
    expect(o.bonus).toEqual(["A", "B"]);
    expect(o.jev && o.jev.clareza).toBe(8.5);
    expect(o.status).toBe("rascunho");
    expect(o.garantia).toBeNull();
    const r = normalizarRespostaDaOferta({ resposta: "oi", briefing_sugerido: {} });
    expect(r.briefing_sugerido).toBeNull();
    expect(r.ofertas).toEqual([]);
    const atual = briefingVazio();
    atual.oferta.preco_confirmado = "R$ 890";
    atual.restricoes = "Sem antes e depois";
    const junto = juntarBriefing(atual, { oferta: { produto: "Clareamento", preco_confirmado: "" }, objetivo: { acao: "seguidores" } });
    expect(junto.oferta.produto).toBe("Clareamento");
    expect(junto.oferta.preco_confirmado).toBe("R$ 890");
    expect(junto.restricoes).toBe("Sem antes e depois");
    expect(junto.objetivo.acao).toBe("seguidores");
  });
});

// ------------------------------------------------------------------ conta ao vivo

const CONTA = {
  conectada: true,
  atualizado_em: new Date(Date.now() - 12 * 60000).toISOString(),
  periodo: { inicio: "2026-09-10", fim: "2026-09-23" },
  totais: { gasto: 1540.5, impressoes: 98000, cliques: 1200, ctr: 1.22, resultados: 88, custo_por_resultado: 17.5, frequencia: 1.9 },
  campanhas: [{ campaign_id: "cp1", nome: "Mensagens | Clareamento", status: "ACTIVE", objetivo: "OUTCOME_ENGAGEMENT", orcamento_diario: 60, metricas: { gasto: 900, resultados: 60, custo_por_resultado: 15 } }],
  anuncios: [
    {
      ad_id: "a-manter", nome: "Carrossel antigo", status: "ACTIVE", campaign_id: "cp1", campanha: "Mensagens | Clareamento", imagem_url: "https://meta.test/a.jpg",
      titulo: "Avaliação grátis", corpo: "Agende pelo WhatsApp", descricao: "", cta: "SEND_WHATSAPP_MESSAGE", destino: "https://wa.me/1",
      metricas: { gasto: 200, resultados: 10, custo_por_resultado: 20, ctr_saida_pct: 0.9, frequencia_media: 2.1 },
      diagnostico: null, tendencia: { ctr_var_pct: -5, custo_resultado_var_pct: 3, frequencia: 2.1 }, sinal: "manter", referencia_id: null,
    },
    {
      ad_id: "a-escalar", nome: "Relógio da recepção", status: "ACTIVE", campaign_id: "cp1", campanha: "Mensagens | Clareamento", imagem_url: "https://meta.test/b.jpg",
      titulo: "Sem espera", corpo: "Hora marcada de verdade", descricao: "", cta: "SEND_WHATSAPP_MESSAGE", destino: "https://wa.me/1",
      metricas: { gasto: 700, resultados: 50, custo_por_resultado: 14, ctr_saida_pct: 1.8, frequencia_media: 1.6 },
      diagnostico: { situacao: "com_sinais", sinais: [{ sinal: "Custo abaixo do tolerável", hipotese: "O gancho segura.", verificar: "Subir 20% da verba." }] },
      tendencia: { ctr_var_pct: 12, custo_resultado_var_pct: -8, frequencia: 1.6 }, sinal: "escalar", referencia_id: "ref-escalar",
    },
  ],
};

describe("conta ao vivo", () => {
  it("conta_ao_vivo com o período; sinal, métricas e tendência por anúncio; sincronizar e analisar chamam as ações; variações vão ao plano", async () => {
    responder({
      conta_ao_vivo: CONTA,
      conta_sincronizar: { ok: true },
      conta_analisar: {
        analise: {
          resumo: "A conta está saudável; um anúncio puxa o resultado.",
          escalar: [{ ad_id: "a-escalar", porque: "Custo 20% abaixo do tolerável" }],
          pausar: [],
          renovar: [{ ad_id: "a-manter", porque: "Frequência subindo", sugestao: "Novo gancho visual" }],
          copy: [{ achado: "Textos curtos convertem mais", recomendacao: "Primeira linha com a dor" }],
          proximos_testes: [{ titulo: "Prova social em vídeo curto", hipotese: "Depoimento autorizado reduz o custo", estilo_visual: "depoimento", objetivo: "mensagens" }],
        },
        analise_id: "an-1",
        custo_usd: 0.03,
      },
    });
    const onCriarPlano = vi.fn();
    montar(h(AbaConta, { onCriarPlano }));
    const escalar = await screen.findByRole("article", { name: "Anúncio Relógio da recepção" });
    expect(chamadasDe("conta_ao_vivo")[0]).toEqual({ acao: "conta_ao_vivo", client_id: CLIENTE, dias: 14 });
    expect(screen.getByText(/Atualizado há 12 min/)).toBeTruthy();
    // Escalar vem antes de manter.
    const artigos = screen.getAllByRole("article").map((a) => a.getAttribute("data-ad"));
    expect(artigos).toEqual(["a-escalar", "a-manter"]);
    expect(within(escalar).getByText("Escalar").getAttribute("data-sinal")).toBe("escalar");
    expect(within(escalar).getByText("1,8%")).toBeTruthy();
    expect(within(escalar).getByText("CTR +12%")).toBeTruthy();
    expect(within(escalar).getByText("Custo abaixo do tolerável")).toBeTruthy();
    expect(screen.getByText("R$ 1.540,50")).toBeTruthy();
    expect(screen.getByText("Mensagens | Clareamento", { selector: "span" })).toBeTruthy();

    fireEvent.click(screen.getByRole("radio", { name: "30 dias" }));
    await waitFor(() => expect(chamadasDe("conta_ao_vivo").some((c) => c.dias === 30)).toBe(true));
    fireEvent.click(screen.getByRole("radio", { name: "14 dias" }));

    fireEvent.click(screen.getByRole("button", { name: /Sincronizar agora/ }));
    await waitFor(() => expect(chamadasDe("conta_sincronizar")).toEqual([{ acao: "conta_sincronizar", client_id: CLIENTE }]));

    fireEvent.click(screen.getByRole("button", { name: /Analisar com o estrategista/ }));
    await waitFor(() => expect(chamadasDe("conta_analisar")).toEqual([{ acao: "conta_analisar", client_id: CLIENTE, dias: 14 }]));
    const analise = await screen.findByRole("region", { name: "Análise do estrategista" });
    expect(within(analise).getByText("A conta está saudável; um anúncio puxa o resultado.")).toBeTruthy();
    expect(within(analise).getByText("Custo 20% abaixo do tolerável")).toBeTruthy();
    expect(within(analise).getByText("Sugestão: Novo gancho visual")).toBeTruthy();

    fireEvent.click(within(await screen.findByRole("article", { name: "Anúncio Relógio da recepção" })).getByRole("button", { name: /Criar variações deste/ }));
    await waitFor(() => expect(onCriarPlano).toHaveBeenCalledTimes(1));
    expect(onCriarPlano.mock.calls[0][0]).toMatchObject({ modo: "variar_vencedor", referencia_ids: ["ref-escalar"] });

    fireEvent.click(within(analise).getByRole("button", { name: /Criar plano deste teste/ }));
    await waitFor(() => expect(onCriarPlano).toHaveBeenCalledTimes(2));
    expect(onCriarPlano.mock.calls[1][0]).toMatchObject({ objetivo: "mensagens", rotulo: "Prova social em vídeo curto" });
  });

  it("releitura a cada 10 minutos, chave fora do cache do navegador, conta não conectada e normalização tolerante", async () => {
    const fonte = readFileSync(resolve(raiz, "src/components/mesa-ads/AbaConta.tsx"), "utf8");
    expect(fonte).toContain("refetchInterval: RELEITURA_DA_CONTA_MS");
    expect(fonte).toContain("export const RELEITURA_DA_CONTA_MS = 10 * 60_000;");
    // Links de imagem que vencem: a chave mora em "urls" (fora do cache persistido).
    expect(chavesAds.conta(CLIENTE, 7)[1]).toBe("urls");
    expect(chavesAds.referenciaAberta(CLIENTE, "r")[1]).toBe("urls");
    const c = normalizarConta({ anuncios: [{ ad_id: "1", sinal: "inventado" }, { nome: "sem id" }] });
    expect(c.anuncios).toHaveLength(1);
    expect(c.anuncios[0].sinal).toBe("sem_dados");
    expect(c.conectada).toBe(true);
    expect(tempoDesde(null)).toBe("sem coleta ainda");
    expect(ordenarAnuncios(normalizarConta(CONTA).anuncios).map((a) => a.ad_id)).toEqual(["a-escalar", "a-manter"]);

    responder({ conta_ao_vivo: { conectada: false } });
    montar(h(AbaConta, {}));
    expect(await screen.findByText("A conta de anúncios deste cliente não está conectada")).toBeTruthy();
  });
});

// ------------------------------------------------------------------ referências: janela de detalhe

const REFS = [
  { id: "ref-proprio", client_id: CLIENTE, titulo: "Anúncio próprio de agosto", origem: "anuncio_proprio", storage_path: null, ad_id: "555", evidencia: "E3", metricas: { gasto: 320, resultados: 41 }, ficha: {}, mecanismo: null, tags: [], destaque: false, criado_em: "2026-09-01" },
  { id: "ref-padrao", client_id: null, titulo: "Padrão: pergunta direta", origem: "padrao", storage_path: null, evidencia: "E0", metricas: {}, ficha: { gancho_verbal: "Você ainda paga caro por isso?", nicho: "odontologia", estilo_visual: "tipografico" }, mecanismo: "Pergunta que expõe a dor", tags: [], destaque: false, criado_em: "2026-09-03" },
  { id: "ref-destaque", client_id: CLIENTE, titulo: "Print destacado", origem: "upload", storage_path: `${CLIENTE}/ads/referencias/x.png`, evidencia: "E1", metricas: {}, ficha: { gancho_verbal: "Oi" }, mecanismo: null, tags: [], destaque: true, criado_em: "2026-08-01" },
];

describe("referências: janela de detalhe dentro do painel", () => {
  it("cartões com destaque e E3 primeiro; padrão sem imagem vira cartão tipográfico; filtro por nicho e estilo", async () => {
    mock.tabelas.ads_referencias = REFS;
    montar(h(AbaReferencias));
    const cartoes = await screen.findAllByRole("button", { name: /^Abrir / });
    expect(cartoes.map((c) => c.getAttribute("aria-label"))).toEqual(["Abrir Print destacado", "Abrir Anúncio próprio de agosto", "Abrir Padrão: pergunta direta"]);
    const padrao = cartoes[2];
    expect(padrao.querySelector("[data-tipografico]")).toBeTruthy();
    expect(padrao.textContent).toContain("Você ainda paga caro por isso?");
    fireEvent.change(screen.getByLabelText("Filtrar por nicho"), { target: { value: "odontologia" } });
    expect(screen.getAllByRole("button", { name: /^Abrir / })).toHaveLength(1);
    fireEvent.change(screen.getByLabelText("Filtrar por nicho"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Filtrar por origem"), { target: { value: "padrao" } });
    expect(screen.getAllByRole("button", { name: /^Abrir / })).toHaveLength(1);
    expect(ordenarReferencias(REFS as unknown as ReferenciaAds[]).map((r) => r.id)).toEqual(["ref-destaque", "ref-proprio", "ref-padrao"]);
  });

  it("abrir chama referencia_abrir e mostra galeria, copy, métricas com série e original; anúncio próprio sem ficha é lido sozinho uma vez", async () => {
    mock.tabelas.ads_referencias = REFS;
    responder({
      referencia_abrir: {
        referencia: REFS[0],
        galeria: [
          { url: "https://arquivo.test/g1.png", legenda: "Capa" },
          { url: "https://arquivo.test/g2.png", legenda: "Segunda" },
        ],
        pagina: null,
        anuncio: {
          ad_id: "555", status: "ACTIVE", campanha: "Mensagens", titulo: "Agenda cumprida", corpo: "Sem esperar na recepção", descricao: "Clínica", cta: "SEND_WHATSAPP_MESSAGE", destino: "https://wa.me/55",
          metricas: { gasto: 320, impressoes: 20000, resultados: 41, custo_por_resultado: 7.8 },
          serie: [{ dia: "2026-09-20", gasto: 100, impressoes: 6000, cliques: 80, ctr: 1.3, resultados: 12 }, { dia: "2026-09-21", gasto: 220, impressoes: 14000, cliques: 190, ctr: 1.4, resultados: 29 }],
          diagnostico: { sinal: "Sem alerta", leitura: "Nenhum sinal de alerta.", acao: "" },
        },
        aviso: null,
      },
      referencia_ler: { ficha: { gancho_verbal: "Sem esperar na recepção", situacao: "Espera longa" }, custo_usd: 0.004 },
    });
    montar(h(AbaReferencias));
    fireEvent.click(await screen.findByRole("button", { name: "Abrir Anúncio próprio de agosto" }));
    const janela = await screen.findByRole("dialog", { name: "Anúncio próprio de agosto" });
    await waitFor(() => expect(chamadasDe("referencia_abrir")).toEqual([{ acao: "referencia_abrir", client_id: CLIENTE, referencia_id: "ref-proprio" }]));
    // Sem ficha lida: completa sozinho, uma vez.
    await waitFor(() => expect(chamadasDe("referencia_ler")).toEqual([{ acao: "referencia_ler", client_id: CLIENTE, referencia_id: "ref-proprio" }]));

    expect(await within(janela).findByText("1 de 2")).toBeTruthy();
    fireEvent.click(within(janela).getByRole("button", { name: "Próxima imagem" }));
    expect(within(janela).getByText("2 de 2")).toBeTruthy();
    expect(within(janela).getByText("Segunda")).toBeTruthy();

    fireEvent.click(within(janela).getByRole("tab", { name: "Copy e destino" }));
    expect(within(janela).getByText("Agenda cumprida")).toBeTruthy();
    expect(within(janela).getByText("Enviar mensagem pelo WhatsApp")).toBeTruthy();
    expect(within(janela).getByRole("link", { name: /wa\.me\/55/ })).toBeTruthy();

    fireEvent.click(within(janela).getByRole("tab", { name: "Métricas" }));
    expect(within(janela).getByLabelText("Série diária")).toBeTruthy();
    expect(within(janela).getByText("R$ 320,00")).toBeTruthy();
    expect(within(janela).getByText("Nenhum sinal de alerta.")).toBeTruthy();

    fireEvent.click(within(janela).getByRole("tab", { name: "Original" }));
    expect(within(janela).getByText("Esta referência não tem link externo.")).toBeTruthy();

    fireEvent.click(within(janela).getByRole("tab", { name: "Ficha" }));
    expect((within(janela).getByLabelText("Primeira fala ou headline") as HTMLTextAreaElement).value).toBe("Sem esperar na recepção");
    expect(chamadasDe("referencia_ler")).toHaveLength(1);
  });

  it("referência de catálogo sem ficha lida oferece Completar ficha com IA (com custo) e não lê sozinha; adicionar por link usa referencia_importar_url e abre", async () => {
    mock.tabelas.ads_referencias = [
      { id: "ref-link", client_id: null, titulo: "Behance: campanha", origem: "catalogo", url: "https://behance.net/x", evidencia: "E0", metricas: {}, ficha: {}, mecanismo: null, tags: [], destaque: false, criado_em: "2026-09-01" },
    ];
    responder({
      referencia_abrir: { referencia: null, galeria: [], pagina: { titulo: "Campanha X", descricao: "Projeto de marca", site: "Behance", tipo: "projeto", extra: { apreciacoes: 120 } }, anuncio: null, aviso: "A página não liberou as imagens." },
      referencia_importar_url: {
        referencia: { id: "ref-nova", client_id: CLIENTE, titulo: "Pin de café", origem: "url", evidencia: "E0", metricas: {}, ficha: {}, tags: [], criado_em: "2026-09-24" },
        galeria: [{ url: "https://arquivo.test/pin.png", legenda: "" }],
        pagina: null,
        anuncio: null,
        aviso: null,
      },
    });
    montar(h(AbaReferencias));
    fireEvent.click(await screen.findByRole("button", { name: "Abrir Behance: campanha" }));
    const janela = await screen.findByRole("dialog", { name: "Behance: campanha" });
    expect(await within(janela).findByText("A página não liberou as imagens.")).toBeTruthy();
    const completar = within(janela).getByRole("button", { name: /Completar ficha com IA/ });
    expect(completar.textContent).toMatch(/~US\$/);
    expect(chamadasDe("referencia_ler")).toHaveLength(0);
    fireEvent.click(within(janela).getByRole("tab", { name: "Original" }));
    expect(within(janela).getByText("Campanha X")).toBeTruthy();
    expect(within(janela).getByRole("link", { name: /Abrir o original/ }).getAttribute("href")).toBe("https://behance.net/x");
    fireEvent.click(within(janela).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    fireEvent.click(screen.getByRole("button", { name: /Adicionar por link/ }));
    fireEvent.change(screen.getByLabelText("Link da referência"), { target: { value: "https://br.pinterest.com/pin/123" } });
    fireEvent.click(screen.getByRole("button", { name: /Guardar e abrir/ }));
    await waitFor(() => expect(chamadasDe("referencia_importar_url")).toEqual([{ acao: "referencia_importar_url", client_id: CLIENTE, url: "https://br.pinterest.com/pin/123" }]));
    expect(await screen.findByRole("dialog", { name: "Pin de café" })).toBeTruthy();
  });

  it("padrões do nicho chamam biblioteca_do_nicho com a quantidade e mostram só os padrões; detalhe vazio não quebra", async () => {
    responder({ biblioteca_do_nicho: { criadas: 10, custo_usd: 0.01 } });
    montar(h(AbaReferencias));
    fireEvent.click(await screen.findByRole("button", { name: /Padrões do nicho/ }));
    await waitFor(() => expect(chamadasDe("biblioteca_do_nicho")).toEqual([{ acao: "biblioteca_do_nicho", client_id: CLIENTE, quantidade: 10 }]));
    await waitFor(() => expect((screen.getByLabelText("Filtrar por origem") as HTMLSelectElement).value).toBe("padrao"));
    expect(detalheVazio()).toBe(true);
  });
});

function detalheVazio() {
  const d = normalizarDetalhe({});
  return d.referencia === null && d.galeria.length === 0 && d.pagina === null && d.anuncio === null && d.aviso === null;
}

// ------------------------------------------------------------------ plano v2

const PLANO_V2: PlanoAds = {
  id: "33333333-3333-3333-3333-333333333333",
  client_id: CLIENTE,
  briefing_id: null,
  nome: "Plano da oferta de clareamento",
  status: "rascunho",
  angulos: [
    {
      id: "a1", nome: "Contagem para o casamento", gancho_verbal: "Faltam 30 dias?", estilo_visual: "tipografico", objetivo: "mensagens",
      pontuacao: 8.6, rodadas: 1, aprovado: true, motivos: [],
      jev: { clareza: 9, relevancia: 8, prova: 6, risco_politica: 9, parada: 8, diferenciacao: 7 },
    },
    {
      id: "a2", nome: "Prova fraca", pontuacao: 5.1, aprovado: false, reprovado: true, motivos: ["Prova sem autorização"],
      jev: { clareza: 6, relevancia: 6, prova: 3, risco_politica: 8, parada: 5, diferenciacao: 4 },
    },
  ],
  estrutura: {
    objetivo: "mensagens",
    oferta_id: "of-1",
    qualidade: { rodadas: 2, aprovados: 1, reprovados: 2 },
    descartados: [{ id: "d1", nome: "Antes e depois", motivos: ["Antes e depois é proibido pela política da Meta"], pontuacao: 3 }],
  },
  pedido: null,
  conversa_id: null,
  custo_usd: 0.05,
  criado_em: "2026-09-24T10:00:00Z",
  atualizado_em: "2026-09-24T10:00:00Z",
};

describe("plano: laço de qualidade", () => {
  it("mostra pontuação, aprovação, estilo, objetivo, as seis notas, as rodadas e os descartados recolhidos com os motivos", async () => {
    mock.tabelas.ads_planos = [PLANO_V2];
    montar(h(AbaPlano, { planoId: PLANO_V2.id, onPlano: vi.fn(), onProduzido: vi.fn() }));
    const a1 = await screen.findByRole("article", { name: "Ângulo 1: Contagem para o casamento" });
    expect(within(a1).getByLabelText("Pontuação 8,6 de 10")).toBeTruthy();
    expect(within(a1).getByText("Aprovado na conferência")).toBeTruthy();
    expect(within(a1).getByText("Tipografico")).toBeTruthy();
    expect(within(a1).getByText("Mensagens")).toBeTruthy();
    expect(within(a1).getByText(/reescrito 1 vez/)).toBeTruthy();
    expect(within(a1).getByRole("meter", { name: "Parada" }).getAttribute("aria-valuenow")).toBe("8");
    expect(within(a1).getByRole("meter", { name: "Diferenciação" }).getAttribute("aria-valuenow")).toBe("7");
    expect(within(a1).getByRole("meter", { name: "Política" }).getAttribute("aria-valuenow")).toBe("9");
    const a2 = screen.getByRole("article", { name: "Ângulo 2: Prova fraca" });
    expect(within(a2).getByText("Abaixo da régua")).toBeTruthy();
    expect(within(a2).getByText("Prova sem autorização")).toBeTruthy();
    // Só os aprovados vêm marcados para produzir.
    expect((screen.getByRole("checkbox", { name: "Produzir o ângulo Contagem para o casamento" }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole("checkbox", { name: "Produzir o ângulo Prova fraca" }) as HTMLInputElement).checked).toBe(false);
    const qualidade = screen.getByLabelText("Qualidade do plano");
    expect(qualidade.textContent).toContain("2 rodadas de qualidade");
    expect(qualidade.textContent).toContain("1 aprovados");
    const descartados = screen.getByRole("button", { name: /Descartados pela conferência \(1\)/ });
    expect(screen.queryByText("Antes e depois é proibido pela política da Meta")).toBeNull();
    fireEvent.click(descartados);
    expect(screen.getByText("Antes e depois é proibido pela política da Meta")).toBeTruthy();
  });

  it("pedido vindo da Oferta ou da Conta gera o plano sozinho, uma vez, com oferta, objetivo, modo e exemplos", async () => {
    responder({ plano_gerar: { plano: PLANO_V2, custo_usd: 0.05 } });
    const consumido = vi.fn();
    const onPlano = vi.fn();
    const pedido = { rotulo: "Variações de Relógio", modo: "variar_vencedor" as const, referencia_ids: ["ref-escalar"], objetivo: "mensagens", oferta_id: "of-1", pedido: "Mantenha o gancho" };
    const { rerender, qc } = montar(h(AbaPlano, { planoId: null, onPlano, onProduzido: vi.fn(), pedidoPendente: pedido, onPedidoConsumido: consumido }));
    await waitFor(() => expect(chamadasDe("plano_gerar")).toHaveLength(1));
    expect(chamadasDe("plano_gerar")[0]).toEqual({
      acao: "plano_gerar",
      client_id: CLIENTE,
      quantidade_angulos: 4,
      oferta_id: "of-1",
      objetivo: "mensagens",
      modo: "variar_vencedor",
      referencia_ids: ["ref-escalar"],
      pedido: "Mantenha o gancho",
    });
    expect(consumido).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(onPlano).toHaveBeenCalledWith(PLANO_V2.id));
    rerender(h(QueryClientProvider, { client: qc }, h(TooltipProvider, null, h(MesaProvider, { valor: valorDaMesa(), children: h(AbaPlano, { planoId: null, onPlano, onProduzido: vi.fn(), pedidoPendente: null }) }))));
    expect(chamadasDe("plano_gerar")).toHaveLength(1);
  });

  it("regra de aprovação e corpo do plano: política alta é segura; campos vazios não vão", () => {
    expect(anguloAprovado({ id: "x", nome: "x", jev: { clareza: 8, relevancia: 8, risco_politica: 9, parada: 7, diferenciacao: 7 } })).toBe(true);
    expect(anguloAprovado({ id: "x", nome: "x", jev: { clareza: 8, relevancia: 8, risco_politica: 5, parada: 7, diferenciacao: 7 } })).toBe(false);
    expect(anguloAprovado({ id: "x", nome: "x", jev: { clareza: 8, relevancia: 8, risco_politica: 9, alerta_politica: "Atributo pessoal" } })).toBe(false);
    expect(anguloAprovado({ id: "x", nome: "x", aprovado: false })).toBe(false);
    expect(corpoDoPlano({ client_id: CLIENTE, quantidade_angulos: 3, pedido: "  ", oferta_id: "", modo: "novo", referencia_ids: [] })).toEqual({ client_id: CLIENTE, quantidade_angulos: 3 });
  });
});

// ------------------------------------------------------------------ estúdio: lote

describe("estúdio: gerar, conferir e corrigir antes de mostrar", () => {
  it("produzirLamina corrige quando a conferência pede e para no limite de 2 correções", async () => {
    const etapas: string[] = [];
    let conferencias = 0;
    const chamar = vi.fn(async (corpo: Record<string, unknown>) => {
      if (corpo.acao === "conferir_card") {
        conferencias += 1;
        return { custo_usd: 0.001, autocorrecao: conferencias < 2 ? { precisa: true, motivos: ["Palavra faltando"], instrucao: "x" } : { precisa: false, motivos: [] } };
      }
      return { custo_usd: 0.04 };
    });
    const r = await produzirLamina(chamar, "t-1", 1, (e) => etapas.push(e));
    expect(chamar.mock.calls.map((c) => c[0].acao)).toEqual(["gerar_card", "conferir_card", "corrigir_card", "conferir_card"]);
    expect(etapas).toEqual(["gerando", "conferindo", "corrigindo", "conferindo"]);
    expect(r.correcoes).toBe(1);
    expect(r.pendencias).toBeNull();
    expect(Math.round(r.custo_usd * 1000)).toBe(82);

    const sempreErrado = vi.fn(async (corpo: Record<string, unknown>) =>
      corpo.acao === "conferir_card" ? { autocorrecao: { precisa: true, motivos: ["Logo ausente"] } } : { custo_usd: 0 },
    );
    const r2 = await produzirLamina(sempreErrado, "t-2", 1, () => undefined);
    expect(sempreErrado.mock.calls.filter((c) => c[0].acao === "corrigir_card")).toHaveLength(2);
    expect(r2.pendencias).toEqual(["Logo ausente"]);

    const semCorrecao = vi.fn(async (corpo: Record<string, unknown>) => {
      if (corpo.acao === "corrigir_card") throw new ErroDaMesa("limite_de_autocorrecao", "Chegou ao limite", {});
      return corpo.acao === "conferir_card" ? { autocorrecao: { precisa: true, motivos: ["Texto"] } } : {};
    });
    const r3 = await produzirLamina(semCorrecao, "t-3", 1, () => undefined);
    expect(r3.pendencias).toEqual(["Texto"]);
  });

  it("situação do criativo: sem arte, gerando, pronto e entregue", () => {
    const base: any = { id: "t", status: "dirigido", direcao: { cards: [{ ordem: 1 }, { ordem: 2 }] }, cards: [{ ordem: 1, versao: 1, storage_path: "a" }] };
    expect(situacaoDoTrabalho(null)).toBe("sem_arte");
    expect(situacaoDoTrabalho(base)).toBe("sem_arte");
    expect(situacaoDoTrabalho(base, "corrigindo")).toBe("corrigindo");
    expect(situacaoDoTrabalho({ ...base, cards: base.cards.concat([{ ordem: 2, versao: 1, storage_path: "b" }]) })).toBe("pronto");
    expect(situacaoDoTrabalho({ ...base, status: "entregue" })).toBe("entregue");
    expect(situacaoDoTrabalho({ ...base, direcao: { ...base.direcao, entrega_ads: { file_ids: ["f"] } } })).toBe("entregue");
    expect(situacaoDoTrabalho({ ...base, status: "gerando" })).toBe("gerando");
  });

  it("entregar ao cliente chama estudio-arte entregar e avisa onde o cliente vê", () => {
    const fonte = readFileSync(resolve(raiz, "src/components/mesa-ads/AbaEstudioAds.tsx"), "utf8");
    expect(fonte).toContain('chamarFuncao("estudio-arte", { acao: "entregar", trabalho_id: c.trabalho_id');
    expect(fonte).toContain('"O cliente vê em Documentos > Criativos de anúncio."');
    // ArteDoCriativo continua com as mesmas props.
    expect(fonte).toContain("<ArteDoCriativo key={aberto.id} criativo={aberto} trabalho={trabalho} onAtualizar={atualizarTrabalhos} />");
    expect(chamadasDoEstudio("entregar")).toHaveLength(0);
  });
});

// ------------------------------------------------------------------ copy: pacote

const PACOTE = {
  textos_principais: [
    { estilo: "curto", texto: "Sorriso pronto para o grande dia." },
    { estilo: "pas", texto: "Cansou de esconder o sorriso nas fotos? Em 2 sessões você chega lá." },
  ],
  titulos: ["Clareamento em 2 sessões", "Um título comprido demais que passa dos quarenta"],
  descricoes: ["Avaliação sem custo", "Descrição que passa do limite de trinta"],
  ctas: [{ cta: "SEND_WHATSAPP_MESSAGE", porque: "O público decide conversando" }],
  ganchos: ["Faltam 30 dias para o casamento?"],
  gestor: { objetivo_meta: "Engajamento > Mensagens", evento_otimizacao: "Conversas", publico_sugerido: ["Mulheres 25 a 40", "Raio de 8 km"], conjuntos: "2 conjuntos", utm: "utm_source=meta", regras_de_corte: "Cortar com 2x o custo tolerável", regras_de_escala: "Subir 20% a cada 3 dias", verba: null },
};

describe("copy: pacote completo", () => {
  const criativo = (copy: CriativoAds["copy"]): CriativoAds => ({
    id: "c-1", client_id: CLIENTE, plano_id: "p-1", angulo_id: "a1", trabalho_id: null, nome: "Contagem · 4:5",
    formato: "feed_4x5", copy, status: "rascunho", ad_id: null, evidencia: "E0", criado_em: "", atualizado_em: "",
  });

  it("copy_pacote traz estilos, títulos com contador de 40, descrições de 30, CTAs, ganchos e o gestor; usar, e enviar ao gestor com tarefa", async () => {
    // Formato da função: pacotes por criativo e a linha atualizada.
    responder({
      copy_pacote: { pacotes: [{ criativo_id: "c-1", pacote: PACOTE, avisos: [] }], criativo: null, pendentes: [], falhas: [], custo_usd: 0.02 },
      pacote_enviar: { file_id: "f-1", tarefa_id: "t-1", markdown: "#", aviso: null },
    });
    montar(h(PainelDaCopy, { criativo: criativo({ texto_principal: "Base" }), caminhoDaArte: null, nome: "Contagem · 4:5" }));
    fireEvent.click(screen.getByRole("button", { name: /Gerar pacote completo/ }));
    await waitFor(() => expect(chamadasDe("copy_pacote")).toEqual([{ acao: "copy_pacote", criativo_id: "c-1" }]));
    const pacote = await screen.findByRole("region", { name: "Pacote de copy" });
    expect(within(pacote).getByText("Problema, agitação e solução")).toBeTruthy();
    expect(within(pacote).getByLabelText("24 de 40 caracteres")).toBeTruthy();
    expect(within(pacote).getByLabelText("48 de 40 caracteres").className).toContain("text-warning");
    expect(within(pacote).getByLabelText("39 de 30 caracteres").className).toContain("text-warning");
    expect(within(pacote).getByText("O público decide conversando")).toBeTruthy();
    expect(within(pacote).getByText("Faltam 30 dias para o casamento?")).toBeTruthy();
    expect(within(pacote).getByText("Mulheres 25 a 40 Raio de 8 km")).toBeTruthy();

    // "Usar" leva o título ao formulário do anúncio.
    const titulo = within(pacote).getByText("Clareamento em 2 sessões").closest("li") as HTMLElement;
    fireEvent.click(within(titulo).getByRole("button", { name: "Usar" }));
    expect((screen.getByLabelText("Título") as HTMLInputElement).value).toBe("Clareamento em 2 sessões");

    fireEvent.click(within(pacote).getByRole("button", { name: /Enviar ao gestor de tráfego/ }));
    await waitFor(() => expect(chamadasDe("pacote_enviar")).toEqual([{ acao: "pacote_enviar", client_id: CLIENTE, criativo_ids: ["c-1"], criar_tarefa: true }]));
  });

  it("salvar a copy não apaga o pacote gravado junto; markdown do pacote e normalização tolerante", async () => {
    montar(h(PainelDaCopy, { criativo: criativo({ texto_principal: "Base", pacote: PACOTE }), caminhoDaArte: null }));
    expect(screen.getByRole("region", { name: "Pacote de copy" })).toBeTruthy();
    const fonte = readFileSync(resolve(raiz, "src/components/mesa-ads/PainelDaCopy.tsx"), "utf8");
    expect(fonte).toContain("const nova: CopyDoAnuncio = { ...criativo.copy, ...limpa(copy) };");
    expect(screen.getByLabelText("Descrição: 0 de 30")).toBeTruthy();

    const md = pacoteEmMarkdown("Contagem", normalizarPacote(PACOTE)!);
    expect(md).toContain("# Pacote de copy: Contagem");
    expect(md).toContain("- Clareamento em 2 sessões (24)");
    expect(md).toContain("- Enviar mensagem pelo WhatsApp: O público decide conversando");
    expect(md).toContain("**Quando escalar:** Subir 20% a cada 3 dias");
    expect(normalizarPacote({})).toBeNull();
    expect(normalizarPacote({ titulos: [{ texto: "A" }, "", "B"] })!.titulos).toEqual(["A", "B"]);
  });
});

// ------------------------------------------------------------------ compatibilidade e texto

describe("compatibilidade Safari 11 / Chrome 64 e texto de tela", () => {
  it("nenhum arquivo da Mesa Ads usa travessão, lookbehind, \\p{}, grupo nomeado, .at(), Object.hasOwn, aspect-ratio, :has ou min()/max()/clamp() em classe", () => {
    const pasta = resolve(raiz, "src/components/mesa-ads");
    const arquivos = readdirSync(pasta)
      .filter((n) => /\.(ts|tsx)$/.test(n) && n !== "ArteDoCriativo.tsx")
      .map((n) => resolve(pasta, n))
      .concat([resolve(raiz, "src/pages/MesaAds.tsx")]);
    const proibidos: [string, RegExp][] = [
      ["travessão", /[—–]/],
      ["lookbehind", /\(\?<[=!]/],
      ["grupo nomeado", /\(\?<[a-zA-Z]/],
      ["\\p{}", /\\p\{/],
      [".at(", /\.at\(/],
      ["Object.hasOwn", /Object\.hasOwn\b/],
      ["aspect-ratio", /aspect-(square|video|\[)|aspect-ratio/],
      [":has", /:has\(|has-\[/],
      ["min/max/clamp em classe", /-\[(min|max|clamp)\(/],
      ["flatMap", /\.flatMap\(/],
    ];
    const achados: string[] = [];
    arquivos.forEach((a) => {
      const texto = readFileSync(a, "utf8");
      proibidos.forEach(([nome, re]) => {
        if (re.test(texto)) achados.push(`${a.split(/[\\/]/).pop()}: ${nome}`);
      });
    });
    expect(achados).toEqual([]);
  });
});
