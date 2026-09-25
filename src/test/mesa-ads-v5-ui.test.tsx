import { createElement as h } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Mesa Ads v5 (pedido do dono em 26/09/2026), tela: resultados claros (abas,
 * objetivo, resumo), o agente sênior de tráfego, o pacote do agente externo
 * (zip no navegador) e a importação do retorno para o Estúdio Ads.
 */

const mock = vi.hoisted(() => ({
  invoke: vi.fn(),
  rpc: vi.fn(),
  tabelas: {} as Record<string, unknown>,
}));

vi.mock("@/integrations/supabase/client", () => {
  const consulta = (tabela: string) => {
    const dados = mock.tabelas[tabela] === undefined ? [] : mock.tabelas[tabela];
    const b: any = {};
    for (const m of ["select", "eq", "neq", "not", "in", "is", "or", "order", "limit", "range", "gte", "update", "insert"]) b[m] = () => b;
    b.single = () => Promise.resolve({ data: null, error: null });
    b.maybeSingle = b.single;
    b.then = (ok: any, erro: any) => Promise.resolve({ data: dados, error: null }).then(ok, erro);
    return b;
  };
  return {
    supabase: {
      functions: { invoke: mock.invoke },
      rpc: mock.rpc,
      from: (tabela: string) => consulta(tabela),
      storage: { from: () => ({ createSignedUrl: () => Promise.resolve({ data: { signedUrl: "https://arquivo.test/x.png" }, error: null }) }) },
    },
  };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { role: "admin" }, user: { id: "u-1" } }) }));

import { TooltipProvider } from "@/components/ui/tooltip";
import { MesaProvider, type MesaValor } from "@/components/mesa/MesaContexto";
import type { ModeloIa } from "@/lib/mesa/api";
import AbaConta from "@/components/mesa-ads/AbaConta";
import AgenteSenior from "@/components/mesa-ads/AgenteSenior";
import { ImportarPacote } from "@/components/mesa-ads/PacoteDeOtimizacao";
import { anunciosDaAba, criativosAgrupados, lerResultadosDaConta, resumoDoTopo } from "@/components/mesa-ads/resultadosApi";
import { extrasDaConta } from "@/components/mesa-ads/contaApi";
import { extrairRetorno, gerarPacoteDeOtimizacao, montarPacote, textoDoArquivoDeRetorno, type DadosDoPacoteOtimizacao } from "@/components/mesa-ads/pacoteOtimizacao";
import { normalizarVinculos } from "@/components/mesa-ads/vinculoApi";

const CLIENTE = "33333333-3333-3333-3333-333333333333";
const TRAVESSAO = new RegExp("[" + String.fromCharCode(0x2013, 0x2014) + "]");

const catalogo: ModeloIa[] = [
  {
    id: "openai:gpt-texto", provedor: "openai", modelo_api: "gpt-texto", tipo: "texto", rotulo: "Texto",
    preco_entrada_1m: 1, preco_saida_1m: 2, preco_cache_1m: null, preco_imagem: null,
    raciocinio: ["low", "medium"], padrao_para: ["estrategista", "diretor_arte", "leitura"], ativo: true,
  },
];

const valorDaMesa = (): MesaValor => ({
  clientId: CLIENTE, clientName: "Cliente Sintético", userId: "u-1", isAdmin: true, podeRecarregar: true, saldoUsd: 50,
  catalogo, catalogoCarregando: false, atualizarCusto: vi.fn(), abrirRecarga: vi.fn(), abrirChaves: vi.fn(), abrirModelos: vi.fn(),
});

function montar(filho: any) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(h(QueryClientProvider, { client: qc }, h(TooltipProvider, null, h(MesaProvider, { valor: valorDaMesa(), children: filho }))));
}

const chamadasDe = (acao: string) =>
  mock.invoke.mock.calls.filter((c: any[]) => c[0] === "mesa-ads" && c[1] && c[1].body && c[1].body.acao === acao).map((c: any[]) => c[1].body);

function responder(mapa: Record<string, unknown>) {
  mock.invoke.mockImplementation(async (_f: string, { body }: any) =>
    Object.prototype.hasOwnProperty.call(mapa, body.acao) ? { data: mapa[body.acao], error: null } : { data: { ok: true }, error: null },
  );
}

const anuncio = (o: Record<string, unknown>) => ({
  campaign_id: "c1", campanha: "Campanha", imagem_url: null, titulo: "", corpo: "", descricao: "", cta: "", destino: "",
  diagnostico: null, tendencia: {}, referencia_id: null, ...o,
});

const CONTA = {
  conectada: true,
  atualizado_em: new Date().toISOString(),
  periodo: { inicio: "2026-08-27", fim: "2026-09-25", dias: 30 },
  totais: { gasto: 1000, resultados: 90, custo_por_resultado: 11.11, resultado_rotulo: "Engajamentos" },
  comparacao: { gasto_pct: 5, resultados_pct: -10, custo_por_resultado_pct: 15 },
  serie: [],
  contas: [],
  campanhas: [
    { campaign_id: "c1", nome: "Engajamento geral", status: "ACTIVE", objetivo: "OUTCOME_ENGAGEMENT", grupo: "engajamento", metricas: { gasto: 700, resultados: 6000, resultado_rotulo: "Engajamentos" } },
    { campaign_id: "c2", nome: "Mensagens WhatsApp", status: "ACTIVE", objetivo: "OUTCOME_ENGAGEMENT", grupo: "mensagem", metricas: { gasto: 300, resultados: 60, resultado_rotulo: "Conversas iniciadas" } },
  ],
  mix_objetivos: {
    por_grupo: [
      { grupo: "engajamento", rotulo: "Engajamento", gasto: 700, pct: 70, resultados: 6000, custo_por_resultado: 0.12, resultado_rotulo: "Engajamentos" },
      { grupo: "mensagem", rotulo: "Mensagem", gasto: 300, pct: 30, resultados: 60, custo_por_resultado: 5, resultado_rotulo: "Conversas iniciadas" },
    ],
    perto_da_venda_pct: 30,
    alertas: ["70% do investimento está em engajamento ou alcance, que não otimizam para conversa nem venda."],
  },
  anuncios: [
    anuncio({ ad_id: "1", nome: "Post A", status: "ACTIVE", grupo: "engajamento", peca: "hash:a", sinal: "manter", metricas: { gasto: 400, impressoes: 50000, resultados: 4000, custo_por_resultado: 0.1, resultado_tipo: "engajamento", resultado_rotulo: "Engajamentos" } }),
    anuncio({ ad_id: "2", nome: "Post A (cópia)", status: "ACTIVE", grupo: "engajamento", peca: "hash:a", sinal: "manter", metricas: { gasto: 300, impressoes: 30000, resultados: 2000, custo_por_resultado: 0.15, resultado_tipo: "engajamento", resultado_rotulo: "Engajamentos" } }),
    anuncio({ ad_id: "3", nome: "Chama no WhatsApp", status: "ACTIVE", campaign_id: "c2", grupo: "mensagem", peca: "hash:m", sinal: "escalar", criativo: { id: "cr-1", nome: "Espera | V1", origem: "ligado" }, metricas: { gasto: 200, impressoes: 12000, resultados: 50, custo_por_resultado: 4, resultado_tipo: "mensagens", resultado_rotulo: "Conversas iniciadas" } }),
    anuncio({ ad_id: "4", nome: "WhatsApp antigo", status: "PAUSED", campaign_id: "c2", grupo: "mensagem", peca: "hash:n", sinal: "pausar", metricas: { gasto: 100, impressoes: 9000, resultados: 10, custo_por_resultado: 10, resultado_tipo: "mensagens", resultado_rotulo: "Conversas iniciadas" } }),
  ],
};

beforeAll(() => {
  if (typeof (globalThis as any).ResizeObserver === "undefined") {
    (globalThis as any).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  }
});

beforeEach(() => {
  vi.clearAllMocks();
  mock.tabelas = {};
  mock.rpc.mockResolvedValue({ data: { saldo_usd: 10 }, error: null });
  responder({});
});

describe("resultados claros (código)", () => {
  it("abas, melhores pela mediana do mesmo objetivo, peça somada e resumo do objetivo", () => {
    const r = lerResultadosDaConta(CONTA);
    expect(anunciosDaAba(r.anuncios, "ativos").map((a) => a.ad_id)).toEqual(["1", "2", "3"]);
    expect(anunciosDaAba(r.anuncios, "descartar").map((a) => a.ad_id)).toEqual(["4"]);
    // Melhor = custo abaixo ou igual à mediana do MESMO tipo (engajamento com engajamento, conversa com conversa).
    expect(anunciosDaAba(r.anuncios, "melhores_anuncios").map((a) => a.ad_id)).toEqual(["3", "1"]);
    const pecas = criativosAgrupados(r.anuncios);
    const a = pecas.filter((p) => p.peca === "hash:a")[0];
    expect(a.anuncios.map((x) => x.ad_id)).toEqual(["1", "2"]);
    expect(a.metricas).toMatchObject({ gasto: 700, resultados: 6000 });
    expect(pecas.filter((p) => p.peca === "hash:m")[0].nome).toBe("Espera | V1");
    const topo = resumoDoTopo(r, "mensagem");
    expect(topo).toMatchObject({ investimento: 300, resultados: 60, rotulo: "Conversas iniciadas", custo_por_resultado: 5, ativos: 1, anuncios: 2, tendencia: null });
    const conta = resumoDoTopo(r, "");
    expect(conta.misturado).toBe(true);
    expect(conta.tendencia).toMatchObject({ resultados_pct: -10 });
    // Resposta velha, sem grupo: vem do tipo de resultado.
    const velha = lerResultadosDaConta({ anuncios: [{ ad_id: "9", metricas: { resultado_tipo: "compras" } }] });
    expect(velha.anuncios[0].grupo).toBe("vendas");
    expect(velha.mix).toBeNull();
  });

  it("vínculos normalizados com tolerância", () => {
    const v = normalizarVinculos({ itens: [{ peca: "p", origem: "inventada", anuncio: { ad_id: "1" }, candidatos: [{ criativo_id: "c", confianca: "0.7" }] }, { anuncio: {} }], resumo: { confirmar: 1 } });
    expect(v.itens).toHaveLength(1);
    expect(v.itens[0].origem).toBe("sem_par");
    expect(v.itens[0].candidatos[0].confianca).toBe(0.7);
    expect(v.resumo.confirmar).toBe(1);
  });
});

describe("aba Conta v5", () => {
  it("resumo no topo com o alerta de engajamento, agente sênior, pacote e importação à vista; objetivo filtra as abas", async () => {
    responder({ conta_ao_vivo: CONTA, conta_conversa_ler: { conversa_id: null, mensagens: [] } });
    montar(h(AbaConta, {}));
    expect(await screen.findByText(/70% do investimento está em engajamento/)).toBeTruthy();
    expect(screen.getByRole("region", { name: "Agente sênior de tráfego" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Baixar pacote de otimização \(\.zip\)/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Importar pacote no Estúdio Ads/ })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Ativos agora (3)" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Mensagem (2)" }));
    expect(screen.getByRole("tab", { name: "Ativos agora (1)" })).toBeTruthy();
    expect(screen.getByRole("article", { name: "Anúncio Chama no WhatsApp" })).toBeTruthy();
    expect(screen.queryByRole("article", { name: "Anúncio Post A" })).toBeNull();
  });
});

describe("agente sênior de tráfego (tela)", () => {
  it("mostra a estratégia estruturada da conversa e envia a mensagem com pesquisa e plano", async () => {
    responder({
      conta_conversa_ler: {
        conversa_id: "conv-1",
        mensagens: [
          { id: "m1", papel: "usuario", conteudo: "Como virar mensagem?", criado_em: "2026-09-26T10:00:00Z", estrategia: null },
          {
            id: "m2", papel: "agente", conteudo: "## Diagnóstico", criado_em: "2026-09-26T10:01:00Z",
            estrategia: {
              resposta: "A conta gasta 70% em engajamento.",
              diagnostico: [{ titulo: "Tudo em engajamento", detalhe: "sem objetivo de venda", gravidade: "alta" }],
              escalar: [{ ad_id: "3", porque: "R$ 4 por conversa", como: "20% a cada 3 dias" }],
              manter: [], cortar: [{ ad_id: "4", porque: "R$ 10 por conversa" }],
              reestruturacao: { objetivo: "mensagens", porque: "vende no WhatsApp", evento_otimizacao: "conversa iniciada", campanhas: [{ nome: "Mensagens", objetivo: "mensagens", orcamento_diario_brl: 40, conjuntos: [{ nome: "Raio 5 km", publico: "aberto", orcamento_diario_brl: 40, anuncios: ["3"] }] }], verba_total_diaria_brl: 40, passos: ["Criar a campanha de mensagens"] },
              proximos_criativos: [{ titulo: "Relógio", angulo: "espera", gancho_verbal: "Cansou de esperar?", gancho_visual: "relógio", formato: "feed_4x5", estilo_visual: "", objetivo: "mensagens", cta_meta: "Enviar mensagem", base_ad_id: "3", porque: "venceu" }],
              pesquisa: [{ achado: "Concorrentes usam hora marcada", fonte: "https://www.facebook.com/ads/library/?id=1" }],
              perguntas: ["Qual o ticket médio?"],
            },
          },
        ],
      },
      conta_conversar: { conversa_id: "conv-1", resposta: "ok", estrategia: {}, pesquisa: { web: true, biblioteca: { consultada: false, motivo: "Não há token de anúncios no cofre para este cliente.", anuncios: [] } }, custo_usd: 0.08 },
    });
    const onCriarPlano = vi.fn();
    montar(h(AgenteSenior, { nomeDe: (id: string) => (id === "3" ? "Chama no WhatsApp" : `Anúncio ${id}`), planoId: "p-1", dias: 30, onCriarPlano }));
    expect(await screen.findByText("Reestruturação recomendada")).toBeTruthy();
    expect(screen.getByText("Escalar (1)")).toBeTruthy();
    expect(screen.getAllByText("Chama no WhatsApp").length).toBeGreaterThan(0);
    expect(screen.getByText("Tudo em engajamento")).toBeTruthy();
    expect(screen.getByRole("link", { name: /facebook\.com\/ads\/library/ }).getAttribute("rel")).toContain("noreferrer");
    fireEvent.change(screen.getByLabelText("Mensagem ao agente sênior"), { target: { value: "Monte a campanha de vendas" } });
    fireEvent.click(screen.getByRole("button", { name: /^Enviar/ }));
    await waitFor(() => expect(chamadasDe("conta_conversar")).toHaveLength(1));
    expect(chamadasDe("conta_conversar")[0]).toEqual({ acao: "conta_conversar", client_id: CLIENTE, mensagem: "Monte a campanha de vendas", conversa_id: "conv-1", plano_id: "p-1", dias: 30, pesquisar: true });
    expect(await screen.findByText(/Biblioteca de Anúncios: Não há token/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Levar ao Plano de teste/ }));
    await waitFor(() => expect(onCriarPlano).toHaveBeenCalledTimes(1));
    expect(onCriarPlano.mock.calls[0][0]).toMatchObject({ objetivo: "mensagens", rotulo: "Próximos criativos do agente sênior" });
    expect(onCriarPlano.mock.calls[0][0].pedido).toContain("Relógio");
  });
});

describe("pacote do agente externo", () => {
  const conta = () => ({ ...lerResultadosDaConta(CONTA), extras: extrasDaConta(CONTA) });
  const dados = (): DadosDoPacoteOtimizacao => ({
    cliente: "Cliente Sintético",
    geradoEm: "2026-09-26T10:00",
    dias: 30,
    conta: conta(),
    servidor: {
      cliente: "Cliente Sintético",
      contexto: { briefing: { oferta: { produto: "Clareamento" }, destino: { tipo: "whatsapp" } }, oferta_escolhida: { nome: "Avaliação", promessa: "Sem fila" } },
      estrategia: { diagnostico: [{ titulo: "Tudo em engajamento", detalhe: "70%" }], reestruturacao: { objetivo: "mensagens", campanhas: [] }, proximos_criativos: [{ titulo: "Relógio", angulo: "espera" }] },
      estrategia_markdown: "A conta gasta 70% em engajamento.",
      estrategia_em: "2026-09-26T09:00:00Z",
      regras: { politicas_meta: "POLÍTICAS DE ANÚNCIO DA META", ctas_meta: ["Enviar mensagem"], estilos_visuais: [{ id: "tipografico", nome: "Tipográfico" }], objetivos: [] },
    },
    criativos: [{ id: "cr-1", client_id: CLIENTE, plano_id: null, angulo_id: null, trabalho_id: "t-1", nome: "Espera | V1", formato: "feed_4x5", copy: { texto_principal: "Chega de fila", headline_arte: "Sem espera" }, status: "pronto", ad_id: "3", evidencia: "E0", criado_em: "", atualizado_em: "" }],
    planos: [],
    trabalhos: [{ id: "t-1", status: "pronto", cards: [{ ordem: 1, versao: 2, storage_path: `${CLIENTE}/estudio/t-1/1-v2.png` }] as any, direcao: { cards: [{ ordem: 1 }] } as any }],
  });

  it("monta LEIA-ME, prompt completo com o contrato, CSV para o Excel, contexto e imagens com nome casado", () => {
    const { arquivos, imagens } = montarPacote(dados());
    const nomes = arquivos.map((a) => a.caminho);
    expect(nomes).toEqual(["LEIA-ME.md", "PROMPT-COMPLETO.md", "estrategia.md", "dados/campanhas.csv", "dados/anuncios.csv", "dados/pecas.csv", "dados/criativos-mesa.csv", "dados/serie-diaria.csv", "dados/contexto.json", "MODELO-DE-RETORNO.json"]);
    const prompt = arquivos[1].conteudo;
    expect(prompt).toContain("## O que eu quero de volta");
    expect(prompt).toContain("mesa-ads-retorno");
    expect(prompt).toContain("ATENÇÃO: 70% do investimento");
    expect(prompt).toContain("Tudo em engajamento");
    expect(prompt).toContain("Produto ou serviço: Clareamento");
    const csvAnuncios = arquivos[4].conteudo;
    expect(csvAnuncios.charCodeAt(0)).toBe(0xfeff);
    expect(csvAnuncios.split("\r\n")[0]).toContain('"ad_id";"anuncio"');
    expect(csvAnuncios).toContain('"Chama no WhatsApp"');
    arquivos.forEach((a) => expect(a.conteudo).not.toMatch(TRAVESSAO));
    expect(JSON.parse(arquivos[9].conteudo).formato).toBe("mesa-ads-retorno");
    expect(imagens).toEqual([{ arquivo: "criativos-mesa/01-espera-v1.png", bucket: "mesa", caminho: `${CLIENTE}/estudio/t-1/1-v2.png` }]);
  });

  it("gera o zip no navegador; imagem que não desce vira aviso no LEIA-ME", async () => {
    const d = dados();
    d.conta.anuncios[0].imagem_url = "https://scontent.test/a.jpg";
    const r = await gerarPacoteDeOtimizacao(d, {
      baixarUrl: async () => {
        throw new Error("CORS");
      },
      baixarStorage: async () => new Uint8Array([137, 80, 78, 71]).buffer,
    });
    expect(r.nome).toBe("pacote-otimizacao-cliente-sintetico-2026-09-26.zip");
    expect(r.faltando).toEqual(["miniaturas/1.jpg"]);
    expect(r.imagens).toBe(1);
    const mod: any = await import("jszip");
    const JSZip = mod.default || mod;
    const zip = await JSZip.loadAsync(r.blob);
    expect(Object.keys(zip.files)).toContain("criativos-mesa/01-espera-v1.png");
    expect(await zip.file("LEIA-ME.md").async("string")).toContain("miniaturas/1.jpg");
  });

  it("acha o JSON do retorno no texto, no bloco json ou no zip; recusa sem JSON", async () => {
    expect(extrairRetorno('{"criativos":[]}')).toEqual({ ok: true, valor: { criativos: [] } });
    expect(extrairRetorno('Segue:\n```json\n{"formato":"mesa-ads-retorno","criativos":[{"titulo":"A"}]}\n```\nAbraço')).toMatchObject({ ok: true, valor: { formato: "mesa-ads-retorno" } });
    expect(extrairRetorno("Resposta sem nada").ok).toBe(false);
    const mod: any = await import("jszip");
    const JSZip = mod.default || mod;
    const zip = new JSZip();
    zip.file("LEIA-ME.md", "nada");
    zip.file("saida/retorno.json", '{"formato":"mesa-ads-retorno","criativos":[]}');
    const buf = await zip.generateAsync({ type: "arraybuffer" });
    const texto = await textoDoArquivoDeRetorno({ name: "volta.zip", arrayBuffer: async () => buf } as any);
    expect(JSON.parse(texto).formato).toBe("mesa-ads-retorno");
  });

  it("importar: lê grátis, mostra o que entendeu e só cria ao confirmar", async () => {
    responder({
      pacote_importar: {
        entendido: {
          plano: { nome: "Plano externo", objetivo: "mensagens", resumo: "" },
          aceitos: [{ titulo: "Relógio", angulo: "espera", formato: "feed_4x5", objetivo: "mensagens", headline_arte: "Hora marcada", texto_principal: "Agende", titulo_anuncio: "Sem fila", cta_meta: "Enviar mensagem", avisos: [] }],
          recusados: [{ indice: 2, titulo: "Sem nada", motivos: ["sem ângulo"] }],
          avisos: [],
        },
        plano: { id: "plano-novo" },
        criativos: [{ id: "c1" }],
        custo_usd: 0.0003,
      },
    });
    const onImportado = vi.fn();
    montar(h(ImportarPacote, { onImportado }));
    fireEvent.click(screen.getByRole("button", { name: /Importar pacote no Estúdio Ads/ }));
    const dialogo = await screen.findByRole("dialog");
    fireEvent.change(within(dialogo).getByLabelText("Resposta do agente externo"), { target: { value: 'Pronto:\n```json\n{"formato":"mesa-ads-retorno","criativos":[{"titulo":"Relógio"}]}\n```' } });
    fireEvent.click(within(dialogo).getByRole("button", { name: /Ler o retorno/ }));
    await waitFor(() => expect(chamadasDe("pacote_importar")).toHaveLength(1));
    expect(chamadasDe("pacote_importar")[0]).toEqual({ acao: "pacote_importar", client_id: CLIENTE, pacote: { formato: "mesa-ads-retorno", criativos: [{ titulo: "Relógio" }] }, confirmar: false });
    expect(await within(dialogo).findByText(/Entendi 1 criativo e recusei 1/)).toBeTruthy();
    expect(within(dialogo).getByText(/sem ângulo/)).toBeTruthy();
    fireEvent.click(within(dialogo).getByRole("button", { name: /Criar 1 criativo no Estúdio Ads/ }));
    await waitFor(() => expect(chamadasDe("pacote_importar")).toHaveLength(2));
    expect(chamadasDe("pacote_importar")[1].confirmar).toBe(true);
    await waitFor(() => expect(onImportado).toHaveBeenCalledWith("plano-novo"));
  });

  it("texto sem JSON não chama a função", async () => {
    montar(h(ImportarPacote, {}));
    fireEvent.click(screen.getByRole("button", { name: /Importar pacote no Estúdio Ads/ }));
    const dialogo = await screen.findByRole("dialog");
    fireEvent.change(within(dialogo).getByLabelText("Resposta do agente externo"), { target: { value: "Não tenho JSON" } });
    fireEvent.click(within(dialogo).getByRole("button", { name: /Ler o retorno/ }));
    expect(await within(dialogo).findByText(/Não achei o JSON do retorno/)).toBeTruthy();
    expect(chamadasDe("pacote_importar")).toHaveLength(0);
  });
});
