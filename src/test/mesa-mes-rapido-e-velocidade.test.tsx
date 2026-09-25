import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement as h } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Frente B, fase 1 (25/09): conteúdo rápido no Mês, velocidade do calendário,
 * tipos de conteúdo e frameworks, prompt reforçado sem perder regra e a
 * campanha completa (gerar, editar, escolher e mandar para a agenda).
 */

const mock = vi.hoisted(() => ({
  invoke: vi.fn(),
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
    b.then = (ok: any, erro: any) => Promise.resolve({ data: dados, error: null }).then(ok, erro);
    return b;
  };
  return {
    supabase: {
      functions: { invoke: mock.invoke },
      rpc: vi.fn(),
      from: (tabela: string) => consulta(tabela),
      storage: { from: () => ({ createSignedUrl: () => Promise.resolve({ data: { signedUrl: "https://x.test/i.png" }, error: null }) }) },
    },
  };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));

import { MesaProvider, type MesaValor } from "@/components/mesa/MesaContexto";
import MesConteudoRapido from "@/components/mesa/MesConteudoRapido";
import CampanhaConteudos from "@/components/mesa/CampanhaConteudos";
import * as tela from "@/components/mesa/MesConhecimento";
import { corpoDoConteudoRapido, novoIdDaProposta, type Campanha, type PropostaV4 } from "@/components/mesa/mesaV4Api";
import { corpoDosConteudosDaCampanha } from "@/components/mesa/campanhasApi";
import * as servidor from "../../supabase/functions/_shared/conhecimento-conteudo";
import type { ModeloIa } from "@/lib/mesa/api";

const ler = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const fonte = ler("supabase/functions/agente-calendario/index.ts");

/** Corpo de uma função de topo, do cabeçalho até a próxima função de topo. */
function corpoDe(nome: string): string {
  const ini = fonte.search(new RegExp(`\\n(?:export )?(?:async )?function ${nome}\\(`));
  expect(ini, `${nome} precisa existir`).toBeGreaterThan(-1);
  const resto = fonte.slice(ini + 1);
  const fim = resto.slice(10).search(/\n(?:export )?(?:async )?function |\n\/\/ -{10}|\nconst ACOES/);
  return fim < 0 ? resto : resto.slice(0, fim + 10);
}

const CLIENTE = "11111111-1111-1111-1111-111111111111";
const catalogo: ModeloIa[] = [
  {
    id: "openai:gpt-texto", provedor: "openai", modelo_api: "gpt-texto", tipo: "texto", rotulo: "Texto",
    preco_entrada_1m: 1, preco_saida_1m: 2, preco_cache_1m: null, preco_imagem: null,
    raciocinio: ["low", "medium", "high", "max"], padrao_para: ["estrategista"], ativo: true,
  },
];
const valorDaMesa = (): MesaValor => ({
  clientId: CLIENTE, clientName: "Cliente", userId: "u-1", isAdmin: true, podeRecarregar: true, saldoUsd: 50, catalogo,
  catalogoCarregando: false, atualizarCusto: vi.fn(), abrirRecarga: vi.fn(), abrirChaves: vi.fn(), abrirModelos: vi.fn(),
});
function montar(filho: any) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(h(QueryClientProvider, { client: qc }, h(MesaProvider, { valor: valorDaMesa() }, filho)));
}
const chamadasDe = (acao: string) =>
  mock.invoke.mock.calls.filter((c) => c[0] === "agente-calendario" && c[1] && c[1].body && c[1].body.acao === acao).map((c) => c[1].body);

beforeEach(() => {
  vi.clearAllMocks();
  mock.tabelas = {};
  mock.invoke.mockResolvedValue({ data: {}, error: null });
});

// ------------------------------------------------------------------ conhecimento

describe("tipos de conteúdo e frameworks", () => {
  it("a tela e o servidor usam os mesmos ids", () => {
    expect(tela.TIPOS_DE_CONTEUDO.map((t) => t.id)).toEqual(servidor.IDS_DOS_TIPOS);
    expect(tela.FRAMEWORKS.map((f) => f.id)).toEqual(servidor.IDS_DOS_FRAMEWORKS);
    expect(tela.AGENTE_ESCOLHE).toBe(servidor.AGENTE_ESCOLHE);
  });

  it("tem os tipos e frameworks pedidos pelo dono, cada um com quando usar e estrutura", () => {
    for (const id of ["storytelling", "educativo", "conscientizacao", "venda", "engajamento", "serie", "aviso", "tutorial", "prova_social"]) {
      const t = servidor.tipoPorId(id);
      expect(t, id).toBeTruthy();
      expect(t!.quando.length).toBeGreaterThan(20);
    }
    for (const id of ["aida", "pas", "bab", "4ps", "fab", "hook_story_offer", "lista", "antes_depois", "mito_verdade", "passo_a_passo"]) {
      const f = servidor.frameworkPorId(id);
      expect(f, id).toBeTruthy();
      expect(f!.passos.length).toBeGreaterThanOrEqual(3);
      expect(f!.estatico.length).toBeGreaterThan(10);
    }
  });

  it("carrossel distribui o framework nas lâminas; estático é uma mensagem com CTA único", () => {
    expect(servidor.estruturaDoConteudo("venda", "aida", "carrossel")).toContain("lâmina a lâmina");
    expect(servidor.estruturaDoConteudo("venda", "aida", "estatico")).toContain("comprimido no estático");
    expect(servidor.REGRA_DO_ESTATICO).toContain("UMA mensagem só");
    expect(servidor.REGRA_DO_ESTATICO).toContain("UM CTA claro");
    expect(servidor.REGRA_DO_CARROSSEL).toContain("mesclar");
  });

  it("sem escolha o agente escolhe e mescla; com escolha, só o que foi marcado", () => {
    expect(servidor.blocoDaEscolhaEditorial({ tipos: [], frameworks: [] })).toContain("o agente escolhe e mescla");
    const so = servidor.blocoDaEscolhaEditorial({ tipos: ["venda"], frameworks: ["pas"] });
    expect(so).toContain("ESCOLHIDOS PELA EQUIPE");
    expect(so).toContain("venda: Venda");
    expect(so).not.toContain("tutorial: Tutorial");
    expect(servidor.lerEscolhaEditorial({ tipos: ["venda", "xyz", "Venda"], frameworks: "aida" })).toEqual({ tipos: ["venda"], frameworks: ["aida"] });
  });

  it("o arco da campanha tem a quantidade pedida, abre no aquecimento e fecha no último chamado", () => {
    const cinco = servidor.arcoDaCampanha(5);
    expect(cinco).toHaveLength(5);
    expect(cinco[0].etapa).toBe("aquecimento");
    expect(cinco[cinco.length - 1].etapa).toBe("último chamado");
    expect(servidor.arcoDaCampanha(1)[0].etapa).toBe("lançamento");
    expect(servidor.arcoDaCampanha(12)).toHaveLength(12);
  });

  it("o conhecimento não usa travessão nem recurso fora do Safari 11", () => {
    const f = ler("supabase/functions/_shared/conhecimento-conteudo.ts") + ler("src/components/mesa/MesConhecimento.ts");
    expect(f).not.toMatch(/[–—]/);
    expect(f).not.toMatch(/\(\?<[=!]|\\p\{|\.at\(|Object\.hasOwn/);
  });
});

// ------------------------------------------------------------------ prompt reforçado

describe("prompt do calendário reforçado sem tirar regra", () => {
  it("as regras antigas de saída continuam todas", () => {
    for (const regra of [
      "Use somente os dados reais recebidos e o que a pesquisa na web trouxer.",
      "Formatos permitidos: somente carrossel ou post estático. Nunca reels, vídeo, stories ou live.",
      "Publicações só de segunda a sexta, dentro do período.",
      "Evite repetir temas que já estão na agenda do período ou nos títulos recentes.",
      "Siga a memória do estrategista",
      "Português do Brasil, sem travessões.",
      "Responda somente com o JSON pedido.",
    ]) {
      expect(fonte).toContain(regra);
    }
  });

  it("as regras antigas do roteiro no detalhar e nos itens continuam", () => {
    const detalhar = corpoDe("detalhar");
    for (const regra of [
      "Estático tem exatamente 1 card.",
      "a capa abre uma tensão com um gancho forte",
      "As ilustracoes formam UMA série",
      "Nunca escreva o nome da marca no texto dos cards.",
      "Não repita tema, gancho nem imagem de posts recentes.",
      "data: use exatamente a data indicada para o tema.",
      "status: planejado.",
    ]) {
      expect(detalhar, regra).toContain(regra);
    }
    const itens = fonte.slice(fonte.indexOf("const REGRAS_DOS_ITENS"), fonte.indexOf("const ESQUEMA_PEDIDO"));
    expect(itens).toContain("Nunca escreva o nome da marca no texto dos cards.");
    expect(itens).toContain("REGRA_DO_ESTATICO");
  });

  it("a base de técnica soma ao prompt global e ao complemento do cliente (nenhum sai)", () => {
    const ctx = corpoDe("montarContexto");
    expect(ctx).toContain("COMPLEMENTO DESTE CLIENTE");
    expect(ctx).toContain("${BASE_DO_ESTRATEGISTA}");
    for (const parte of ["Ganchos variados", "Ângulos", "Provas: só o que existe", "CTA: um por post", "AIDA", "PAS"]) {
      expect(servidor.BASE_DO_ESTRATEGISTA).toContain(parte);
    }
  });

  it("temas e itens declaram tipo e framework no esquema", () => {
    const tema = fonte.slice(fonte.indexOf("const ESQUEMA_TEMA ="), fonte.indexOf("const ESQUEMA_CARD"));
    const item = fonte.slice(fonte.indexOf("const ESQUEMA_ITEM"), fonte.indexOf("export const ESQUEMA_TEMAS"));
    for (const trecho of [tema, item]) {
      expect(trecho).toContain("tipo_editorial: S(\"string\", { enum: [...IDS_DOS_TIPOS] })");
      expect(trecho).toContain("framework: S(\"string\", { enum: [...IDS_DOS_FRAMEWORKS] })");
    }
  });
});

// ------------------------------------------------------------------ velocidade

describe("velocidade do calendário", () => {
  it("raciocínio padrão medium, com o tempo e o fôlego de sempre", () => {
    expect(fonte).toContain('const RACIOCINIO_PADRAO = "medium";');
    expect(fonte).toContain("const TIMEOUT_CALENDARIO_MS = 300_000;");
    expect(fonte).toContain('import { respostaComFolego } from "../_shared/resposta-com-folego.ts";');
    const longas = fonte.slice(fonte.indexOf("const ACOES_LONGAS"), fonte.indexOf("Deno.serve("));
    for (const a of ["propor_temas", "detalhar", "gravar", "conteudo_rapido", "campanha_conteudos"]) expect(longas).toContain(`"${a}"`);
    expect(longas).not.toContain('"editar_item"');
    for (const f of ["proporTemas", "detalhar", "conteudoRapido", "campanhaConteudos"]) {
      expect(corpoDe(f), f).toContain("timeoutMs: TIMEOUT_CALENDARIO_MS");
    }
  });

  it("temas em três frentes paralelas e detalhar em lotes menores, mais ao mesmo tempo", () => {
    expect(fonte).toContain("const TEMAS_POR_LOTE = 2;");
    expect(fonte).toContain("const LOTES_EM_PARALELO = 8;");
    const propor = corpoDe("proporTemas");
    expect(propor).toContain("Promise.allSettled(frentes.map(");
    expect(propor).toContain("pesquisaWeb: true");
    expect(propor).toContain("await mostrarParcial();");
  });

  it("detalhar grava cada lote ao terminar e não começa lote novo depois do orçamento", () => {
    const d = corpoDe("detalhar");
    expect(d).toContain("if (novos.length) await gravarParcial();");
    expect(d).toContain("tempo.decorrido() > ORCAMENTO_DA_ACAO_MS");
    expect(d).toContain("contextoEmTexto(ctx, { inicio: p.periodo_inicio, fim: p.periodo_fim, parametros: p.parametros }, { enxuto: true })");
    expect(d).toContain("tempos_ms: tempos");
  });

  it("o contexto vai em JSON compacto (sem recuo)", () => {
    const c = corpoDe("contextoEmTexto");
    expect(c).toContain("${JSON.stringify(dados)}");
    expect(c).not.toContain("JSON.stringify(dados, null, 1)");
  });

  it("gravar escreve em paralelo, só os escolhidos, sem refazer o que já está na agenda", () => {
    expect(corpoDe("gravar")).toContain("corpo.tema_ids");
    const g = corpoDe("gravarItens");
    expect(g).toContain("emParalelo(indices.length, GRAVACOES_EM_PARALELO");
    expect(g).toContain('if (item.task_id) {');
    expect(g).toContain("...(completa ? { status: \"gravada\"");
    // Gravado por seleção ganha espelho gravado (o Estúdio acha o roteiro em proposta gravada).
    expect(g).toContain("espelho_de: p.id");
  });

  it("a tela do Mês usa medium por padrão e o automático roda meses em paralelo e pede o que faltou", () => {
    expect(tela.raciocinioPadraoDaTela(["low", "medium", "high", "max"])).toBe("medium");
    expect(tela.raciocinioPadraoDaTela(["low", "high"])).toBe("high");
    const auto = ler("src/components/mesa/PlanejamentoAutomatico.tsx");
    expect(auto).toContain("export const MESES_EM_PARALELO = 3;");
    expect(auto).toContain("if (!faltam.length) break;");
    expect(auto).toContain("mudarMes(f.clientId, mes, { detalhou: true });");
    expect(auto).not.toContain("niveis[niveis.length - 1]");
    const mes = ler("src/components/mesa/AbaMes.tsx");
    expect(mes).not.toContain("niveis[niveis.length - 1]");
    expect(mes).toContain("proposta_id: id,");
  });

  it("o id da proposta nasce na tela sem crypto.randomUUID (Safari 11)", () => {
    const id = novoIdDaProposta();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(novoIdDaProposta()).not.toBe(id);
  });
});

// ------------------------------------------------------------------ conteúdo rápido

describe("conteúdo rápido", () => {
  it("servidor: modelo rápido, raciocínio baixo, contexto enxuto e grava no dia pelo mesmo caminho", () => {
    const r = corpoDe("conteudoRapido");
    expect(r).toContain("await exigirAcessoAoCliente(chamador, clientId);");
    expect(r).toContain("resolverModeloRapido(corpo.modelo_id)");
    expect(r).toContain("{ enxuto: true }");
    expect(r).toContain("await gravarItens(servico, chamador, p, projectId, null)");
    expect(r).toContain("task_id: gravado[0]?.task_id ?? null");
    expect(corpoDe("resolverModeloRapido")).toContain('modeloPadrao("estrategista_rapido")');
    expect(fonte).toContain('const RACIOCINIO_RAPIDO = "low";');
    expect(fonte).toContain("  conteudo_rapido: conteudoRapido,");
  });

  it("corpo do pedido só leva o que foi escolhido", () => {
    expect(corpoDoConteudoRapido({ clientId: CLIENTE, pedido: "arte da promo" })).toEqual({ acao: "conteudo_rapido", client_id: CLIENTE, pedido: "arte da promo" });
    expect(corpoDoConteudoRapido({ clientId: CLIENTE, pedido: "x", data: "livre", formato: "estatico", tipo: "venda", framework: "aida", campanhaId: "c" }))
      .toEqual({ acao: "conteudo_rapido", client_id: CLIENTE, pedido: "x", data: "livre", formato: "estatico", tipo: "venda", framework: "aida", campanha_id: "c" });
  });

  it("tela: o pedido vira conteúdo no dia e Abrir no Estúdio leva direto", async () => {
    const item = { tema_id: "r1", data: "2026-09-28", formato: "estatico", tema: "Promo de sexta", gancho: "20% só hoje", cards: [{ ordem: 1, texto: "20% no kit" }], task_id: "t-9" };
    mock.invoke.mockImplementation(async (_f: string, { body }: any) => {
      if (body.acao === "conteudo_rapido") {
        return { data: { proposta: { id: "p-r", status: "gravada", itens: [item], task_ids: ["t-9"] }, item, task_id: "t-9", data: "2026-09-28", mes: "2026-09-01", sem_projeto: false, resposta: "Pronto.", custo_usd: 0.01 }, error: null };
      }
      return { data: {}, error: null };
    });
    const abrir = vi.fn();
    montar(h(MesConteudoRapido, { aberto: true, onAbertoChange: vi.fn(), onAbrirNoEstudio: abrir }));
    fireEvent.change(screen.getByLabelText("Pedido do conteúdo rápido"), { target: { value: "Arte da promoção de sexta" } });
    fireEvent.click(screen.getByRole("radio", { name: "Estático" }));
    const botao = screen.getByRole("button", { name: /Preparar e pôr no dia/ });
    await waitFor(() => expect(botao).not.toBeDisabled());
    fireEvent.click(botao);
    // Sem estimativa (ou cara) o botão pede o segundo clique.
    await waitFor(() => {
      const denovo = screen.queryByRole("button", { name: /clique de novo/i });
      if (!chamadasDe("conteudo_rapido").length && denovo) fireEvent.click(denovo);
      expect(chamadasDe("conteudo_rapido").length).toBe(1);
    });
    expect(chamadasDe("conteudo_rapido")[0]).toEqual({ acao: "conteudo_rapido", client_id: CLIENTE, pedido: "Arte da promoção de sexta", data: "hoje", formato: "estatico" });
    fireEvent.click(await screen.findByRole("button", { name: /Abrir no Estúdio/ }));
    expect(abrir).toHaveBeenCalledWith("t-9", "2026-09-01");
  });

  it("o botão fica no topo do Mês e ao lado do agente", () => {
    const mes = ler("src/components/mesa/AbaMes.tsx");
    expect(mes).toContain("<MesConteudoRapido");
    expect(mes).toContain("Conteúdo rápido");
    expect(mes).toContain('aria-label="Conteúdo rápido"');
  });
});

// ------------------------------------------------------------------ campanha completa

const proposta: PropostaV4 = {
  id: "22222222-2222-2222-2222-222222222222",
  project_id: "33333333-3333-3333-3333-333333333333",
  periodo_inicio: "2026-10-01",
  periodo_fim: "2026-10-20",
  parametros: { origem: "campanha" },
  status: "pronta",
  itens: [
    { tema_id: "c1", data: "2026-10-02", formato: "carrossel", tema: "Aquece o amor", etapa: "aquecimento", tipo_editorial: "conscientizacao", framework: "pas", cards: [{ ordem: 1, texto: "Capa" }] },
    { tema_id: "c2", data: "2026-10-06", formato: "estatico", tema: "Lançamento do kit", etapa: "lançamento", tipo_editorial: "venda", framework: "aida", cards: [{ ordem: 1, texto: "Kit" }] },
    { tema_id: "c3", data: "2026-10-01", formato: "estatico", tema: "Já na agenda", task_id: "t-1", cards: [{ ordem: 1, texto: "x" }] },
  ],
  conversa_id: null,
  task_ids: ["t-1"],
  gravada_em: null,
};
const campanha: Campanha = {
  id: "44444444-4444-4444-4444-444444444444", client_id: CLIENTE, nome: "Amor", pedido: "amor", objetivo: "Vender kits",
  periodo_inicio: "2026-10-01", periodo_fim: "2026-10-20", conceito: null, identidade: null, referencias_ids: [], selo_path: null,
  proposta_id: proposta.id, status: "planejada", custo_usd: 0, criado_em: "2026-09-25T12:00:00Z",
};

describe("campanha completa", () => {
  it("servidor: conteúdos na hora pelo arco, em lotes paralelos, e edição sem IA que não mexe no que já está na agenda", () => {
    const c = corpoDe("campanhaConteudos");
    expect(c).toContain("await exigirAcessoAoCliente(chamador, c.client_id);");
    expect(c).toContain("arcoDaCampanha(quantidade)");
    expect(c).toContain("emParalelo(lotes.length, LOTES_EM_PARALELO");
    expect(c).toContain("await gravarParcial();");
    const e = corpoDe("editarItem");
    expect(e).toContain('"item_na_agenda"');
    expect(e).not.toContain("chamarTexto");
    expect(corpoDe("editarUmItem")).toContain("normalizarDataUtil(campos.data, uteis)");
    // A instrução de arte chega na direção do Estúdio.
    expect(corpoDe("criarDirecoesDoRoteiro")).toContain("Instrução de arte da equipe:");
    expect(corpoDe("descricaoDoItem")).toContain("Instrução de arte da equipe:");
  });

  it("corpo da geração leva só o escolhido", () => {
    expect(corpoDosConteudosDaCampanha({ campanhaId: "c", quantidade: 20 })).toEqual({ acao: "campanha_conteudos", campanha_id: "c", quantidade: 8 });
    expect(corpoDosConteudosDaCampanha({ campanhaId: "c", escolha: { tipos: ["venda"], frameworks: [] }, formato: "estatico" }))
      .toEqual({ acao: "campanha_conteudos", campanha_id: "c", formato: "estatico", tipos: ["venda"] });
  });

  it("tela: mostra etapa, tipo e framework; manda para a agenda só os escolhidos", async () => {
    mock.invoke.mockImplementation(async (_f: string, { body }: any) => {
      if (body.acao === "gravar") return { data: { proposta, itens: [{ task_id: "t-2" }] }, error: null };
      return { data: {}, error: null };
    });
    montar(h(CampanhaConteudos, { campanha, proposta, carregando: false, erro: null }));
    expect(screen.getByText("Aquece o amor")).toBeTruthy();
    expect(screen.getByText("Conscientização · PAS")).toBeTruthy();
    // Os dois que faltam vêm marcados; o que já está na agenda não tem caixa.
    expect(screen.getByRole("button", { name: /Mandar para a agenda \(2\)/ })).toBeTruthy();
    expect(screen.queryByLabelText("Selecionar Já na agenda")).toBeNull();
    fireEvent.click(screen.getByLabelText("Selecionar Aquece o amor"));
    fireEvent.click(screen.getByRole("button", { name: /Mandar para a agenda \(1\)/ }));
    await waitFor(() => expect(chamadasDe("gravar").length).toBe(1));
    expect(chamadasDe("gravar")[0]).toEqual({ acao: "gravar", proposta_id: proposta.id, tema_ids: ["c2"], project_id: proposta.project_id });
  });

  it("tela: editar salva texto e instrução de arte com editar_item", async () => {
    mock.invoke.mockImplementation(async (_f: string, { body }: any) => {
      if (body.acao === "editar_item") return { data: { proposta, item: proposta.itens[1], avisos: [] }, error: null };
      return { data: {}, error: null };
    });
    montar(h(CampanhaConteudos, { campanha, proposta, carregando: false, erro: null }));
    fireEvent.click(screen.getAllByRole("button", { name: /Editar/ })[1]);
    fireEvent.change(screen.getByPlaceholderText(/troque o céu/), { target: { value: "Troque o céu por pôr do sol" } });
    fireEvent.click(screen.getByRole("button", { name: /Salvar/ }));
    await waitFor(() => expect(chamadasDe("editar_item").length).toBe(1));
    const corpo = chamadasDe("editar_item")[0];
    expect(corpo.tema_id).toBe("c2");
    expect(corpo.campos.instrucao_arte).toBe("Troque o céu por pôr do sol");
  });
});
