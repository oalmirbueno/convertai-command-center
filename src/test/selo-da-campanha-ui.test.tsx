import { createElement as h } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Frente SEL (30/09), a tela do selo da campanha: os 2 caminhos (gerar e
 * escolher pronto, que tem a logo da marca, o envio de arquivo, os selos de
 * outras campanhas e o acervo), Melhorar com a versão nova ao lado da antiga,
 * Escolher e Desfazer, o histórico com Usar, as referências e a atualização
 * completa (refazer as não aprovadas com o custo à vista e segundo clique).
 *
 * Frente UXS (30/09): o Gerar primeiro com os ajustes recolhidos numa
 * linha-resumo (lembrados por cliente), um formulário por vez, Desfazer no
 * aviso da troca, "Ficar com a de antes" com Desfazer, esqueleto na leitura e
 * "Tentar de novo" no erro.
 */

const mock = vi.hoisted(() => ({
  invoke: vi.fn(),
  upload: vi.fn(),
  tabelas: {} as Record<string, unknown>,
}));

vi.mock("@/integrations/supabase/client", () => {
  const consulta = (tabela: string) => {
    const dados = mock.tabelas[tabela] === undefined ? [] : mock.tabelas[tabela];
    const b: any = {};
    for (const m of ["select", "eq", "neq", "not", "in", "is", "or", "contains", "order", "limit", "range", "update"]) b[m] = () => b;
    const primeiro = () => ({ data: Array.isArray(dados) ? (dados[0] === undefined ? null : dados[0]) : dados, error: null });
    b.maybeSingle = () => Promise.resolve(primeiro());
    b.single = () => Promise.resolve(primeiro());
    b.then = (ok: any, erro: any) => Promise.resolve({ data: dados, error: null, count: Array.isArray(dados) ? dados.length : 0 }).then(ok, erro);
    return b;
  };
  return {
    supabase: {
      functions: { invoke: mock.invoke },
      rpc: vi.fn(),
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
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn(), message: vi.fn() } }));
// Seletor de modelo e de qualidade como select nativo (o Radix Select não abre no jsdom); o resto dos Seletores é o real.
vi.mock("@/components/mesa/Seletores", async () => {
  const real = await vi.importActual<any>("@/components/mesa/Seletores");
  return {
    ...real,
    SeletorDeModelo: ({ catalogo, tipo, valor, onChange, rotulo }: any) =>
      h(
        "select",
        { "aria-label": rotulo, value: valor, onChange: (e: any) => onChange(e.target.value) },
        catalogo.filter((m: any) => m.tipo === tipo && m.ativo).map((m: any) => h("option", { key: m.id, value: m.id }, m.rotulo)),
      ),
    SeletorDeQualidade: ({ valor, onChange }: any) =>
      h("select", { "aria-label": "Qualidade", value: valor, onChange: (e: any) => onChange(e.target.value) }, ["baixa", "media", "alta"].map((q) => h("option", { key: q, value: q }, q))),
  };
});

import { toast } from "sonner";
import { MesaProvider, type MesaValor } from "@/components/mesa/MesaContexto";
import { gravarEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
import CampanhaSelo from "@/components/mesa/CampanhaSelo";
import { arquivoDeSeloAceito, corposDaGeracao, partesDaGeracao, partesDoRefazer } from "@/components/mesa/seloApi";
import type { Campanha } from "@/components/mesa/mesaV4Api";
import { estimarLocal, type ModeloIa } from "@/lib/mesa/api";

const CLIENTE = "11111111-1111-1111-1111-111111111111";
const CAMP = "44444444-4444-4444-4444-444444444444";

const catalogo: ModeloIa[] = [
  {
    id: "openai:gpt-texto", provedor: "openai", modelo_api: "gpt-texto", tipo: "texto", rotulo: "Texto",
    preco_entrada_1m: 1, preco_saida_1m: 2, preco_cache_1m: null, preco_imagem: null,
    raciocinio: ["low", "medium"], padrao_para: ["estrategista", "leitura"], ativo: true,
  },
  {
    id: "openai:gpt-image-2", provedor: "openai", modelo_api: "gpt-image-2", tipo: "imagem", rotulo: "Imagem",
    preco_entrada_1m: null, preco_saida_1m: null, preco_cache_1m: null, preco_imagem: { baixa: 0.01, media: 0.04, alta: 0.17 },
    raciocinio: [], padrao_para: ["imagem"], ativo: true,
  },
  {
    id: "openrouter:outro-imagem", provedor: "openrouter", modelo_api: "outro-imagem", tipo: "imagem", rotulo: "Outro",
    preco_entrada_1m: null, preco_saida_1m: null, preco_cache_1m: null, preco_imagem: { baixa: 0.02, media: 0.08, alta: 0.2 },
    raciocinio: [], padrao_para: [], ativo: true,
  },
];

const valorDaMesa = (): MesaValor => ({
  clientId: CLIENTE,
  clientName: "Cliente sintético",
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

const campanha: Campanha = {
  id: CAMP,
  client_id: CLIENTE,
  nome: "Promoção do Amor",
  pedido: "promoção do amor",
  objetivo: "Fomentar o comércio local",
  periodo_inicio: "2026-10-02",
  periodo_fim: "2026-10-30",
  conceito: "Quem compra aqui apoia a causa",
  identidade: { tipo: "promocao", selo: { texto: "Promoção do Amor" } },
  referencias_ids: [],
  selo_path: `${CLIENTE}/campanhas/${CAMP}/selo-v1.png`,
  selo_id: "v1",
  proposta_id: null,
  status: "gravada",
  custo_usd: 0,
  criado_em: "2026-09-29T12:00:00Z",
};

const versao = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  campanha_id: CAMP,
  caminho: `${CLIENTE}/campanhas/${CAMP}/selo-${id}.png`,
  origem: "gerado",
  estilo: "carimbo",
  texto: "Promoção do Amor",
  conferencia: { ok: true, esperado: "Promoção do Amor", lido: "Promoção do Amor", faltando: [], sobrando: [], aviso: null },
  pedido: null,
  anterior_id: null,
  lote_id: null,
  fonte: null,
  modelo_id: "openai:gpt-image-2",
  custo_usd: 0.04,
  escolhido_em: null,
  criado_em: "2026-09-29T12:00:00Z",
  ...extra,
});

const impacto = {
  aprovadas: { trabalhos: 1, laminas: 2 },
  refazer: [{ trabalho_id: "t-1", titulo: "Teaser", ordens: [1, 4], modelo_imagem_id: "openai:gpt-image-2", qualidade: "media", enviada: true }],
  com_o_atual: 0,
  erro: null,
};

const estado = () => ({
  campanha: { id: CAMP, selo_id: "v1", selo_path: campanha.selo_path },
  versoes: [versao("v1"), versao("v0", { origem: "logo", estilo: null })],
  antigos: [{ id: "a1", campanha_id: "outra", caminho: `${CLIENTE}/campanhas/outra/selo-a1.png`, origem: "gerado", texto: "Dia do Cliente" }],
  referencias: [{ caminho: `${CLIENTE}/campanhas/${CAMP}/referencia-1.png`, papel: "estilo", confianca: 0.8, nota: null, descricao: null }],
  texto: "Promoção do Amor",
  avisos_do_texto: [],
  impacto,
});

const chamadas = (acao: string, funcao = "agente-calendario") =>
  mock.invoke.mock.calls.filter((c) => c[0] === funcao && c[1] && c[1].body && c[1].body.acao === acao).map((c) => c[1].body);

function montar(c: Campanha = campanha) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(h(QueryClientProvider, { client: qc }, h(MesaProvider, { valor: valorDaMesa() }, h(CampanhaSelo, { campanha: c }))));
}

/** O aviso de sucesso com esse texto (toast.success do mock). */
const avisoDeSucesso = (textoDoAviso: string) => (toast.success as any).mock.calls.find((c: any[]) => c[0] === textoDoAviso);

const originais: Record<string, unknown> = {};
beforeAll(() => {
  // Envio: o navegador converte para PNG num canvas (jsdom não tem canvas nem carrega imagem).
  originais.Image = (globalThis as any).Image;
  originais.getContext = HTMLCanvasElement.prototype.getContext;
  originais.toBlob = HTMLCanvasElement.prototype.toBlob;
  originais.createObjectURL = (URL as any).createObjectURL;
  originais.revokeObjectURL = (URL as any).revokeObjectURL;
  (globalThis as any).Image = class {
    onload: null | (() => void) = null;
    onerror: null | (() => void) = null;
    naturalWidth = 400;
    naturalHeight = 200;
    width = 400;
    height = 200;
    set src(_v: string) {
      setTimeout(() => this.onload && this.onload(), 0);
    }
  };
  (HTMLCanvasElement.prototype as any).getContext = () => ({ drawImage: () => undefined });
  (HTMLCanvasElement.prototype as any).toBlob = (cb: (b: Blob) => void) => cb(new Blob(["png"], { type: "image/png" }));
  (URL as any).createObjectURL = () => "blob:teste";
  (URL as any).revokeObjectURL = () => undefined;
});
afterAll(() => {
  (globalThis as any).Image = originais.Image;
  (HTMLCanvasElement.prototype as any).getContext = originais.getContext;
  (HTMLCanvasElement.prototype as any).toBlob = originais.toBlob;
  (URL as any).createObjectURL = originais.createObjectURL;
  (URL as any).revokeObjectURL = originais.revokeObjectURL;
});

beforeEach(() => {
  vi.clearAllMocks();
  // A aba, os ajustes do Gerar e o abrir/recolher ficam no navegador: cada teste começa do zero.
  window.localStorage.clear();
  mock.tabelas = {};
  mock.upload.mockResolvedValue({ data: {}, error: null });
  mock.invoke.mockImplementation(async (funcao: string, { body }: any) => {
    if (funcao === "estudio-arte" && body.acao === "enfileirar") return { data: { lote_id: "l1", itens: [], ja_na_fila: [] }, error: null };
    switch (body.acao) {
      case "selo_estado":
        return { data: estado(), error: null };
      case "selo_gerar":
        return { data: { versao: versao(`g-${body.estilo}`, { estilo: body.estilo, lote_id: body.lote_id }), conferencia: { ok: body.estilo !== "adesivo", esperado: "Promoção do Amor", lido: body.estilo === "adesivo" ? "Por Promoção do Amor" : "Promoção do Amor", faltando: [], sobrando: [], aviso: null }, avisos: [], custo_usd: 0.041 }, error: null };
      case "selo_escolher":
        return { data: { campanha: { ...campanha, selo_id: body.selo_id }, anterior: { selo_id: "v1", selo_path: campanha.selo_path }, impacto, custo_usd: 0 }, error: null };
      case "selo_usar":
        return { data: { campanha: { ...campanha, selo_id: "novo" }, versao: versao("novo", { origem: body.origem }), anterior: { selo_id: "v1", selo_path: campanha.selo_path }, avisos: [], impacto, custo_usd: 0 }, error: null };
      case "selo_melhorar":
        return { data: { versao: versao("melhor", { origem: "melhorado", anterior_id: "v1" }), anterior: versao("v1"), conferencia: { ok: true }, avisos: ["Texto conferido."], custo_usd: 0.05 }, error: null };
      case "selo_arquivar":
        return { data: { arquivado: true, custo_usd: 0 }, error: null };
      case "selo_referencias":
        return { data: { referencias: [], avisos: [], custo_usd: 0.002 }, error: null };
      default:
        return { data: {}, error: null };
    }
  });
});

const abrirCaminhos = async () => {
  await screen.findByText(/Gerado · Carimbo/);
  fireEvent.click(screen.getByRole("button", { name: /Trocar o selo/ }));
};

describe("selo da campanha: 2 caminhos na mesma tela (gerar e escolher pronto)", () => {
  it("Gerar: 3 opções em paralelo, no mesmo lote, estilos diferentes e o modelo escolhido; o texto errado avisa; Escolher e Desfazer", async () => {
    montar();
    await abrirCaminhos();
    const gerar = screen.getByRole("button", { name: /Gerar 3 opções/ });
    expect(gerar.textContent).toContain("~US$");
    fireEvent.click(gerar);
    await waitFor(() => expect(chamadas("selo_gerar").length).toBe(3));
    const corpos = chamadas("selo_gerar");
    expect(new Set(corpos.map((c) => c.lote_id)).size).toBe(1);
    expect(corpos.map((c) => c.estilo)).toEqual(["etiqueta", "adesivo", "tipografico"]);
    expect(corpos.every((c) => c.modelo_id === "openai:gpt-image-2" && c.campanha_id === CAMP && c.qualidade === "media")).toBe(true);
    const lista = await screen.findByRole("list", { name: "Opções de selo" });
    await waitFor(() => expect(within(lista).getAllByRole("button", { name: "Escolher" }).length).toBe(3));
    expect(within(lista).getByText(/Texto errado: "Por Promoção do Amor"/)).toBeTruthy();
    fireEvent.click(within(lista).getAllByRole("button", { name: "Escolher" })[0]);
    await waitFor(() => expect(chamadas("selo_escolher").length).toBe(1));
    expect(chamadas("selo_escolher")[0]).toEqual({ acao: "selo_escolher", campanha_id: CAMP, selo_id: "g-etiqueta" });
    fireEvent.click(await screen.findByRole("button", { name: /Desfazer/ }));
    await waitFor(() => expect(chamadas("selo_escolher").length).toBe(2));
    expect(chamadas("selo_escolher")[1]).toEqual({ acao: "selo_escolher", campanha_id: CAMP, selo_id: "v1" });
  });

  it("Escolher pronto: selo de outra campanha (sem custo, sem gerador) e tirar o fundo liso", async () => {
    montar();
    await abrirCaminhos();
    fireEvent.click(screen.getByRole("tab", { name: "Escolher pronto" }));
    const antigos = await screen.findByRole("list", { name: "Selos de outras campanhas" });
    fireEvent.click(within(antigos).getByRole("button", { name: /Usar o selo Dia do Cliente/ }));
    await waitFor(() => expect(chamadas("selo_usar").length).toBe(1));
    expect(chamadas("selo_usar")[0]).toEqual({ acao: "selo_usar", campanha_id: CAMP, origem: "arquivo", selo_id: "a1", remover_fundo: true });
    expect(chamadas("selo_gerar").length).toBe(0);
    expect(await screen.findByRole("button", { name: /Desfazer/ })).toBeTruthy();
  });

  it("Enviar (no Escolher pronto): SVG vira PNG no navegador, sobe na pasta da campanha e vira o selo", async () => {
    montar();
    await abrirCaminhos();
    fireEvent.click(screen.getByRole("tab", { name: "Escolher pronto" }));
    expect(screen.getByRole("button", { name: /Enviar um arquivo como selo/ })).toBeTruthy();
    const entrada = screen.getByTestId("selo-enviado") as HTMLInputElement;
    fireEvent.change(entrada, { target: { files: [new File(["<svg/>"], "selo.svg", { type: "image/svg+xml" })] } });
    await waitFor(() => expect(chamadas("selo_usar").length).toBe(1));
    const caminho = mock.upload.mock.calls[0][0] as string;
    expect(caminho.indexOf(`${CLIENTE}/campanhas/${CAMP}/envio-`)).toBe(0);
    expect(caminho.slice(-4)).toBe(".png");
    expect(mock.upload.mock.calls[0][2]).toMatchObject({ contentType: "image/png" });
    expect(chamadas("selo_usar")[0]).toMatchObject({ origem: "enviado", caminho, nome: "selo.svg", remover_fundo: true });
    expect(arquivoDeSeloAceito({ type: "application/pdf", name: "a.pdf" })).toBe(false);
    expect(arquivoDeSeloAceito({ type: "", name: "logo.WEBP" })).toBe(true);
  });

  it("Logo da marca (no Escolher pronto): um clique, sem custo; o Trocar fecha e o Desfazer do topo continua", async () => {
    montar();
    await abrirCaminhos();
    fireEvent.click(screen.getByRole("tab", { name: "Escolher pronto" }));
    fireEvent.click(screen.getByRole("button", { name: /Usar a logo da marca como selo/ }));
    await waitFor(() => expect(chamadas("selo_usar").length).toBe(1));
    expect(chamadas("selo_usar")[0]).toEqual({ acao: "selo_usar", campanha_id: CAMP, origem: "logo", remover_fundo: true });
    await waitFor(() => expect(document.querySelector('[data-selo="caminhos"]')).toBeNull());
    fireEvent.click(await screen.findByRole("button", { name: /Desfazer/ }));
    await waitFor(() => expect(chamadas("selo_escolher").length).toBe(1));
    expect(chamadas("selo_escolher")[0].selo_id).toBe("v1");
  });
});

describe("selo da campanha: melhorar, versões e referências", () => {
  it("Melhorar: pedido e link de referência; a nova aparece ao lado da antiga; Ficar com a de antes arquiva a nova, com Desfazer no aviso", async () => {
    montar();
    await screen.findByText(/Gerado · Carimbo/);
    fireEvent.click(screen.getByRole("button", { name: /Melhorar este selo/ }));
    fireEvent.change(screen.getByLabelText("O que melhorar no selo"), { target: { value: "nada de selo genérico dourado" } });
    fireEvent.change(screen.getByLabelText("Link da referência do Melhorar"), { target: { value: "https://exemplo.com/ref.png" } });
    fireEvent.click(screen.getByRole("button", { name: /^Melhorar(?! este)/ }));
    await waitFor(() => expect(chamadas("selo_melhorar").length).toBe(1));
    expect(chamadas("selo_melhorar")[0]).toEqual({ acao: "selo_melhorar", campanha_id: CAMP, selo_id: "v1", pedido: "nada de selo genérico dourado", link: "https://exemplo.com/ref.png", modelo_id: "openai:gpt-image-2", qualidade: "media" });
    expect(await screen.findByAltText("Selo de antes")).toBeTruthy();
    expect(screen.getByAltText("Selo novo")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Ficar com a de antes/ }));
    await waitFor(() => expect(chamadas("selo_arquivar").length).toBe(1));
    expect(chamadas("selo_arquivar")[0]).toEqual({ acao: "selo_arquivar", campanha_id: CAMP, selo_id: "melhor" });
    expect(chamadas("selo_escolher").length).toBe(0);
    await waitFor(() => expect(screen.queryByAltText("Selo novo")).toBeNull());
    const aviso = avisoDeSucesso("Versão nova arquivada.");
    expect(aviso[1].action.label).toBe("Desfazer");
    aviso[1].action.onClick();
    await waitFor(() => expect(chamadas("selo_arquivar").length).toBe(2));
    expect(chamadas("selo_arquivar")[1]).toEqual({ acao: "selo_arquivar", campanha_id: CAMP, selo_id: "melhor", desfazer: true });
  });

  it("Ficar com a de antes que não arquiva: o erro aparece e o Comparar continua", async () => {
    montar();
    await screen.findByText(/Gerado · Carimbo/);
    fireEvent.click(screen.getByRole("button", { name: /Melhorar este selo/ }));
    fireEvent.change(screen.getByLabelText("O que melhorar no selo"), { target: { value: "letra da marca" } });
    fireEvent.click(screen.getByRole("button", { name: /^Melhorar(?! este)/ }));
    await screen.findByAltText("Selo novo");
    const padrao = mock.invoke.getMockImplementation() as any;
    mock.invoke.mockImplementation(async (funcao: string, opcoes: any) =>
      opcoes.body.acao === "selo_arquivar" ? { data: { error: "falhou" }, error: null } : padrao(funcao, opcoes),
    );
    fireEvent.click(screen.getByRole("button", { name: /Ficar com a de antes/ }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("A versão nova não foi arquivada", expect.anything()));
    expect(screen.getByAltText("Selo novo")).toBeTruthy();
    expect(avisoDeSucesso("Versão nova arquivada.")).toBeUndefined();
  });

  it("Melhorar: o chip mostra o modelo e a qualidade e a troca chega no pedido", async () => {
    montar();
    await screen.findByText(/Gerado · Carimbo/);
    fireEvent.click(screen.getByRole("button", { name: /Melhorar este selo/ }));
    const chip = screen.getByRole("button", { name: "Modelo e qualidade do Melhorar" });
    expect(chip.textContent).toContain("Imagem · Padrão");
    fireEvent.click(chip);
    fireEvent.change(await screen.findByLabelText("Modelo de imagem"), { target: { value: "openrouter:outro-imagem" } });
    fireEvent.change(screen.getByLabelText("Qualidade"), { target: { value: "baixa" } });
    expect(screen.getByRole("button", { name: "Modelo e qualidade do Melhorar" }).textContent).toContain("Outro · Rascunho");
    fireEvent.change(screen.getByLabelText("O que melhorar no selo"), { target: { value: "letra da marca" } });
    fireEvent.click(screen.getByRole("button", { name: /^Melhorar(?! este)/ }));
    await waitFor(() => expect(chamadas("selo_melhorar").length).toBe(1));
    expect(chamadas("selo_melhorar")[0]).toMatchObject({ modelo_id: "openrouter:outro-imagem", qualidade: "baixa" });
  });

  it("Melhorar e Escolher a nova troca o selo", async () => {
    montar();
    await screen.findByText(/Gerado · Carimbo/);
    fireEvent.click(screen.getByRole("button", { name: /Melhorar este selo/ }));
    fireEvent.change(screen.getByLabelText("O que melhorar no selo"), { target: { value: "letra da marca" } });
    fireEvent.click(screen.getByRole("button", { name: /^Melhorar(?! este)/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Escolher a nova/ }));
    await waitFor(() => expect(chamadas("selo_escolher").length).toBe(1));
    expect(chamadas("selo_escolher")[0].selo_id).toBe("melhor");
  });

  it("histórico: toda versão fica guardada e Usar escolhe a antiga", async () => {
    montar();
    const versoes = await screen.findByRole("list", { name: "Versões do selo" });
    expect(within(versoes).getByText("Em uso")).toBeTruthy();
    fireEvent.click(within(versoes).getByRole("button", { name: "Usar" }));
    await waitFor(() => expect(chamadas("selo_escolher").length).toBe(1));
    expect(chamadas("selo_escolher")[0]).toEqual({ acao: "selo_escolher", campanha_id: CAMP, selo_id: "v0" });
  });

  it("referências: o link entra (o servidor descreve e o Jev dá o papel) e dá para tirar", async () => {
    montar();
    await abrirCaminhos();
    fireEvent.change(screen.getByLabelText("Link da referência do selo"), { target: { value: "https://exemplo.com/estilo.png" } });
    fireEvent.click(screen.getByRole("button", { name: "Adicionar" }));
    await waitFor(() => expect(chamadas("selo_referencias").length).toBe(1));
    expect(chamadas("selo_referencias")[0]).toEqual({ acao: "selo_referencias", campanha_id: CAMP, adicionar: [{ link: "https://exemplo.com/estilo.png" }] });
    fireEvent.click(screen.getByRole("button", { name: "Tirar" }));
    await waitFor(() => expect(chamadas("selo_referencias").length).toBe(2));
    expect(chamadas("selo_referencias")[1]).toEqual({ acao: "selo_referencias", campanha_id: CAMP, tirar: [`${CLIENTE}/campanhas/${CAMP}/referencia-1.png`] });
  });
});

describe("selo da campanha: atualizar de forma completa", () => {
  it("mostra numa linha o que fica e o que refaz; o Refazer mostra o custo antes e sempre pede o segundo clique (duplo clique não confirma)", async () => {
    montar();
    expect(await screen.findByText("2 aprovadas ficam como estão · 2 lâminas a refazer (1 arte com o cliente)")).toBeTruthy();
    const refazer = screen.getByRole("button", { name: /Refazer 2 lâminas/ });
    expect(refazer.textContent).toContain("~US$");
    fireEvent.click(refazer);
    expect(chamadas("enfileirar", "estudio-arte").length).toBe(0);
    const confirmar = screen.getByRole("button", { name: /Clique de novo para confirmar/ });
    expect(confirmar.textContent).toContain("~US$");
    // Um segundo clique colado ao primeiro (duplo clique) não confirma sozinho.
    fireEvent.click(confirmar);
    expect(chamadas("enfileirar", "estudio-arte").length).toBe(0);
    await new Promise((r) => setTimeout(r, 450));
    fireEvent.click(screen.getByRole("button", { name: /Clique de novo para confirmar/ }));
    await waitFor(() => expect(chamadas("enfileirar", "estudio-arte").length).toBe(1));
    expect(chamadas("enfileirar", "estudio-arte")[0]).toEqual({ acao: "enfileirar", trabalho_id: "t-1", ordens: [1, 4], corrigir_sozinho: false });
    // 2 lâminas x US$ 0,04.
    expect(estimarLocal(partesDoRefazer(catalogo, impacto as any), catalogo)).toBeCloseTo(0.08, 5);
  });

  it("estimativa do Gerar: N imagens do modelo escolhido e N leituras; os corpos seguem o plano das opções", () => {
    const partes = partesDaGeracao(catalogo, "openrouter:outro-imagem", "alta", 4);
    expect(partes[0]).toMatchObject({ modeloId: "openrouter:outro-imagem", tipo: "imagem", qualidade: "alta", vezes: 4 });
    expect(partes[1]).toMatchObject({ tipo: "texto", vezes: 4 });
    const corpos = corposDaGeracao({ campanhaId: CAMP, estilo: "carimbo", quantidade: 2, tipo: null, modeloId: "m", qualidade: "media", texto: " Amor ", pedido: "" }, "lote");
    expect(corpos).toEqual([
      { acao: "selo_gerar", campanha_id: CAMP, lote_id: "lote", estilo: "carimbo", variacao: 0, modelo_id: "m", qualidade: "media", texto: "Amor" },
      { acao: "selo_gerar", campanha_id: CAMP, lote_id: "lote", estilo: "carimbo", variacao: 1, modelo_id: "m", qualidade: "media", texto: "Amor" },
    ]);
  });
});

describe("selo da campanha: mais simples de usar (frente UXS)", () => {
  const gerarPronto = () => waitFor(() => expect((screen.getByRole("button", { name: /Gerar 3 opções/ }) as HTMLButtonElement).disabled).toBe(false));

  it("Gerar primeiro: os ajustes ficam recolhidos numa linha-resumo que mostra a troca de modelo e qualidade, e a escolha fica lembrada", async () => {
    const primeira = montar();
    await abrirCaminhos();
    const resumo = screen.getByRole("button", { name: /Automático · 3 opções · Imagem · Padrão/ });
    expect(resumo.getAttribute("aria-expanded")).toBe("false");
    expect(resumo.textContent).toContain('"Promoção do Amor"');
    expect(screen.queryByLabelText("Estilo do selo")).toBeNull();
    // As referências continuam à vista com os ajustes recolhidos.
    expect(screen.getByLabelText("Link da referência do selo")).toBeTruthy();
    fireEvent.click(resumo);
    fireEvent.change(screen.getByLabelText("Modelo de imagem"), { target: { value: "openrouter:outro-imagem" } });
    fireEvent.change(screen.getByLabelText("Qualidade"), { target: { value: "alta" } });
    fireEvent.change(screen.getByLabelText("Pedido extra para o selo"), { target: { value: "coração no o" } });
    const depois = screen.getByRole("button", { name: /Automático · 3 opções · Outro · Final \(alta\)/ });
    expect(depois.getAttribute("aria-expanded")).toBe("true");
    expect(depois.textContent).toContain("com pedido");
    fireEvent.click(screen.getByRole("button", { name: /Gerar 3 opções/ }));
    await waitFor(() => expect(chamadas("selo_gerar").length).toBe(3));
    expect(chamadas("selo_gerar").every((c) => c.modelo_id === "openrouter:outro-imagem" && c.qualidade === "alta" && c.pedido === "coração no o")).toBe(true);
    await gerarPronto();
    primeira.unmount();
    // Sair e voltar: modelo, qualidade e o abrir ficam (o pedido extra é de cada vez).
    montar();
    await abrirCaminhos();
    const lembrado = screen.getByRole("button", { name: /Automático · 3 opções · Outro · Final \(alta\)/ });
    expect(lembrado.getAttribute("aria-expanded")).toBe("true");
    expect(lembrado.textContent).not.toContain("com pedido");
  });

  it("ajuste guardado que não vale mais cai no padrão, campo a campo (modelo desligado, quantidade estranha)", async () => {
    gravarEstadoDaTela(`selo:ajustes:${CLIENTE}`, { estilo: "nao-existe", quantidade: 9, modelo: "openai:desligado", qualidade: "alta" });
    montar();
    await abrirCaminhos();
    expect(screen.getByRole("button", { name: /Automático · 3 opções · Imagem · Final \(alta\)/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Gerar 3 opções/ }));
    await waitFor(() => expect(chamadas("selo_gerar").length).toBe(3));
    expect(chamadas("selo_gerar").every((c) => c.modelo_id === "openai:gpt-image-2" && c.qualidade === "alta")).toBe(true);
  });

  it("texto do selo: o campo mostra o do servidor e o pedido vai sem texto até a pessoa editar", async () => {
    montar();
    await abrirCaminhos();
    fireEvent.click(screen.getByRole("button", { name: /Gerar 3 opções/ }));
    await waitFor(() => expect(chamadas("selo_gerar").length).toBe(3));
    expect(chamadas("selo_gerar").every((c) => !("texto" in c))).toBe(true);
    await gerarPronto();
    fireEvent.click(screen.getByRole("button", { name: /Automático · 3 opções/ }));
    const campo = screen.getByLabelText("Texto do selo") as HTMLInputElement;
    expect(campo.value).toBe("Promoção do Amor");
    fireEvent.change(campo, { target: { value: "Amor em dobro" } });
    expect(screen.getByRole("button", { name: /"Amor em dobro"/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Gerar 3 opções/ }));
    await waitFor(() => expect(chamadas("selo_gerar").length).toBe(6));
    expect(chamadas("selo_gerar").slice(3).every((c) => c.texto === "Amor em dobro")).toBe(true);
  });

  it("campanha sem selo: Escolher o selo já abre com os ajustes à vista", async () => {
    const semSelo: Campanha = { ...campanha, selo_id: null, selo_path: null };
    const padrao = mock.invoke.getMockImplementation() as any;
    mock.invoke.mockImplementation(async (funcao: string, opcoes: any) =>
      opcoes.body.acao === "selo_estado" ? { data: { ...estado(), campanha: { id: CAMP, selo_id: null, selo_path: null }, versoes: [], impacto: null }, error: null } : padrao(funcao, opcoes),
    );
    montar(semSelo);
    await screen.findByText("A campanha ainda não tem selo.");
    fireEvent.click(screen.getByRole("button", { name: /Escolher o selo/ }));
    expect(screen.getByRole("button", { name: /Automático · 3 opções/ }).getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByLabelText("Estilo do selo")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Melhorar este selo/ })).toBeNull();
  });

  it("Escolher numa opção: o aviso traz o Desfazer (com o selo de antes da resposta) e o Trocar fecha, com as opções à vista", async () => {
    montar();
    await abrirCaminhos();
    fireEvent.click(screen.getByRole("button", { name: /Gerar 3 opções/ }));
    const lista = await screen.findByRole("list", { name: "Opções de selo" });
    await waitFor(() => expect(within(lista).getAllByRole("button", { name: "Escolher" }).length).toBe(3));
    await gerarPronto();
    fireEvent.click(within(lista).getAllByRole("button", { name: "Escolher" })[1]);
    await waitFor(() => expect(chamadas("selo_escolher").length).toBe(1));
    await waitFor(() => expect(document.querySelector('[data-selo="caminhos"]')).toBeNull());
    expect(screen.getByRole("list", { name: "Opções de selo" })).toBeTruthy();
    const aviso = avisoDeSucesso("Selo escolhido.");
    expect(aviso[1].action.label).toBe("Desfazer");
    aviso[1].action.onClick();
    await waitFor(() => expect(chamadas("selo_escolher").length).toBe(2));
    expect(chamadas("selo_escolher")[1]).toEqual({ acao: "selo_escolher", campanha_id: CAMP, selo_id: "v1" });
    // A troca feita pelo Desfazer não traz outro Desfazer.
    await waitFor(() => expect(avisoDeSucesso("O selo de antes voltou.")).toBeTruthy());
    expect(avisoDeSucesso("O selo de antes voltou.").length).toBe(1);
  });

  it("um formulário por vez: abrir o Melhorar com o Trocar aberto fecha o Trocar", async () => {
    montar();
    await abrirCaminhos();
    expect(document.querySelector('[data-selo="caminhos"]')).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Melhorar este selo/ }));
    expect(document.querySelector('[data-selo="caminhos"]')).toBeNull();
    expect(document.querySelector('[data-selo="melhorar"]')).not.toBeNull();
    expect(screen.getByRole("button", { name: /Trocar o selo/ }).getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: /Trocar o selo/ }));
    expect(document.querySelector('[data-selo="melhorar"]')).toBeNull();
  });

  it("Escolher pronto: a aba fica lembrada e o Tirar o fundo liso aparece uma vez só, e só no pronto", async () => {
    const primeira = montar();
    await abrirCaminhos();
    expect(screen.queryByLabelText("Tirar o fundo liso")).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "Escolher pronto" }));
    expect(screen.getAllByLabelText("Tirar o fundo liso").length).toBe(1);
    primeira.unmount();
    montar();
    await abrirCaminhos();
    expect(document.querySelector('[data-selo="pronto"]')).not.toBeNull();
  });

  it("lendo o selo: esqueleto no lugar do estado e dos botões, sem piscar o texto do selo antigo", async () => {
    let soltar: (v: unknown) => void = () => undefined;
    const padrao = mock.invoke.getMockImplementation() as any;
    mock.invoke.mockImplementation((funcao: string, opcoes: any) =>
      opcoes.body.acao === "selo_estado"
        ? new Promise((r) => {
            soltar = r;
          })
        : padrao(funcao, opcoes),
    );
    montar();
    expect(await screen.findByLabelText("Lendo o selo")).toBeTruthy();
    expect(screen.queryByText("Selo de antes das versões")).toBeNull();
    expect(screen.queryByRole("button", { name: /Trocar o selo/ })).toBeNull();
    soltar({ data: estado(), error: null });
    expect(await screen.findByText(/Gerado · Carimbo/)).toBeTruthy();
    expect(screen.queryByLabelText("Lendo o selo")).toBeNull();
  });

  it("erro ao ler o selo: o aviso fica e o Tentar de novo lê de novo", async () => {
    const padrao = mock.invoke.getMockImplementation() as any;
    mock.invoke.mockImplementation(async (funcao: string, opcoes: any) =>
      opcoes.body.acao === "selo_estado" ? { data: { error: "falhou" }, error: null } : padrao(funcao, opcoes),
    );
    montar();
    const tentar = await screen.findByRole("button", { name: /Tentar de novo/ });
    const antes = chamadas("selo_estado").length;
    fireEvent.click(tentar);
    await waitFor(() => expect(chamadas("selo_estado").length).toBe(antes + 1));
  });
});
