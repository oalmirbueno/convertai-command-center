import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement as h } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Aba Mês, versão 6 (pedido do dono em 24/09): o agente do mês planeja o mês
 * conversando (planejar_mes), a mudança na proposta só entra depois de a
 * equipe ver a diferença e clicar em Aplicar (aplicar_mudanca), o que ficar
 * combinado vira o plano do mês, e o conteúdo que não serviu sai com a
 * lixeira (tirar_item / arquivar_item_agenda), com confirmação curta e desfazer.
 */

const mock = vi.hoisted(() => ({
  invoke: vi.fn(),
  upload: vi.fn(),
  tabelas: {} as Record<string, unknown>,
  updates: [] as { tabela: string; valor: unknown }[],
}));

vi.mock("@/integrations/supabase/client", () => {
  const consulta = (tabela: string) => {
    const dados = mock.tabelas[tabela] === undefined ? [] : mock.tabelas[tabela];
    const b: any = {};
    for (const m of ["select", "eq", "neq", "not", "in", "is", "or", "gte", "lt", "lte", "gt", "overlaps", "contains", "order", "limit", "range"]) b[m] = () => b;
    b.update = (valor: unknown) => {
      mock.updates.push({ tabela, valor });
      return b;
    };
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
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));

import { toast } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { MesaProvider, type MesaValor } from "@/components/mesa/MesaContexto";
import AgenteDoMes from "@/components/mesa/AgenteDoMes";
import AgendaDoMes from "@/components/mesa/AgendaDoMes";
import { BlocoDaProposta } from "@/components/mesa/ConteudosPropostos";
import { corpoDoPlano, corpoDoPlanejamento, mesDoPlano, mesesAPartirDe, planosPorMes, resumoDoPlano } from "@/components/mesa/planoDoMes";
import type { PropostaV4 } from "@/components/mesa/mesaV4Api";
import type { ModeloIa } from "@/lib/mesa/api";

const raiz = resolve(__dirname, "../..");
const ler = (rel: string) => readFileSync(resolve(raiz, rel), "utf8").replace(/\r\n/g, "\n");

const CLIENTE = "11111111-1111-1111-1111-111111111111";

const catalogo: ModeloIa[] = [
  {
    id: "openai:gpt-texto", provedor: "openai", modelo_api: "gpt-texto", tipo: "texto", rotulo: "Texto",
    preco_entrada_1m: 1, preco_saida_1m: 2, preco_cache_1m: null, preco_imagem: null,
    raciocinio: ["low", "medium"], padrao_para: ["estrategista"], ativo: true,
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

function montar(filho: any, rota = "/mesa?client=c&mes=2026-10-01") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    h(MemoryRouter, { initialEntries: [rota] }, h(QueryClientProvider, { client: qc }, h(TooltipProvider, null, h(MesaProvider, { valor: valorDaMesa() }, filho)))),
  );
}

const chamadasDe = (acao: string) =>
  mock.invoke.mock.calls.filter((c) => c[0] === "agente-calendario" && c[1] && c[1].body && c[1].body.acao === acao).map((c) => c[1].body);

/** A ação "Desfazer" do último aviso de sucesso com esse título. */
function desfazerDo(titulo: string): () => void {
  const chamadas = (toast.success as any).mock.calls.filter((c: any[]) => c[0] === titulo);
  expect(chamadas.length, `aviso "${titulo}"`).toBeGreaterThan(0);
  const opcoes = chamadas[chamadas.length - 1][1];
  expect(opcoes.action.label).toBe("Desfazer");
  return opcoes.action.onClick;
}

const PROPOSTA: PropostaV4 = {
  id: "22222222-2222-2222-2222-222222222222",
  client_id: CLIENTE,
  project_id: "33333333-3333-3333-3333-333333333333",
  periodo_inicio: "2026-10-01",
  periodo_fim: "2026-10-31",
  parametros: { origem: "pedido_livre" },
  status: "pronta",
  diagnostico: null,
  itens: [
    { tema_id: "p1", data: "2026-10-05", formato: "carrossel", tema: "Tema que não serviu", gancho: "Gancho fraco", cards: [{ ordem: 1, texto: "Capa" }] },
    { tema_id: "p2", data: "2026-10-07", formato: "estatico", tema: "Tema que fica", gancho: "Bom gancho", cards: [{ ordem: 1, texto: "Capa" }] },
  ],
  conversa_id: null,
  task_ids: [],
  gravada_em: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mock.tabelas = {};
  mock.updates = [];
  mock.upload.mockResolvedValue({ data: {}, error: null });
  mock.invoke.mockResolvedValue({ data: {}, error: null });
  try {
    window.localStorage.clear();
    window.sessionStorage.clear();
  } catch {
    /* sem armazenamento */
  }
});

// ------------------------------------------------------------------ planejar conversando

describe("agente do mês: planejar o mês conversando", () => {
  it("Planejar o mês é o padrão e Enviar chama planejar_mes com o mês em conversa", async () => {
    mock.invoke.mockResolvedValue({ data: { resposta: "Vamos lá.", planos: [], mudanca: null, mensagem_id: "m9", custo_usd: 0.01 }, error: null });
    montar(h(AgenteDoMes, { mesInicial: "2026-10-01" }));
    expect(screen.getByRole("tab", { name: /Planejar o mês/ }).getAttribute("aria-selected")).toBe("true");
    fireEvent.change(screen.getByLabelText("Pedido ao agente do mês"), { target: { value: "Quero focar em pedidos pelo WhatsApp" } });
    const enviar = screen.getByRole("button", { name: /Enviar/ });
    await waitFor(() => expect(enviar).not.toBeDisabled());
    fireEvent.click(enviar);
    await waitFor(() => expect(chamadasDe("planejar_mes").length).toBe(1));
    expect(chamadasDe("planejar_mes")[0]).toEqual({
      acao: "planejar_mes",
      client_id: CLIENTE,
      mensagem: "Quero focar em pedidos pelo WhatsApp",
      mes: "2026-10",
    });
    expect(chamadasDe("pedido_livre").length).toBe(0);
  });

  it("os atalhos mudam com o modo e só preenchem o campo", () => {
    montar(h(AgenteDoMes, { mesInicial: "2026-10-01" }));
    fireEvent.click(screen.getByRole("button", { name: "Frequência e formatos" }));
    expect((screen.getByLabelText("Pedido ao agente do mês") as HTMLTextAreaElement).value).toContain("outubro de 2026");
    fireEvent.click(screen.getByRole("tab", { name: /Criar conteúdos/ }));
    expect(screen.getByRole("button", { name: "Prepare a agenda de hoje" })).toBeTruthy();
    expect(mock.invoke).not.toHaveBeenCalled();
    // O modo escolhido fica guardado para a próxima abertura.
    expect(window.localStorage.getItem("mesa:agente:modo")).toBe("criar");
  });

  it("a mudança sugerida aparece com a diferença e só entra com Aplicar (sem custo)", async () => {
    mock.tabelas.agente_conversas = [{ id: "conv-1" }];
    mock.tabelas.agente_mensagens = [
      {
        id: "m1",
        papel: "agente",
        conteudo: "Sugiro trocar o tema da primeira semana.",
        criado_em: "2026-09-24T12:00:00Z",
        anexos: [
          { tipo: "plano", mes: "2026-10" },
          {
            tipo: "mudanca",
            alvo_proposta_id: PROPOSTA.id,
            base: "2026-09-24T11:00:00Z",
            periodo: { inicio: "2026-10-01", fim: "2026-10-31" },
            resumo: "Troco um tema e mudo uma data.",
            diferenca: {
              entram: [{ tema_id: "t9", tema: "Tema novo de outubro", data: "2026-10-06", formato: "carrossel" }],
              saem: [{ tema_id: "t2", tema: "Tema que sai", data: "2026-10-08", formato: "estatico" }],
              mudam: [{ tema_id: "t3", tema: "Tema com data nova", data: "2026-10-12", formato: "carrossel", data_antes: "2026-10-09", campos: ["data", "gancho"] }],
              temas_entram: [],
              temas_saem: [],
              temas_mudam: [],
            },
            ajustes: [],
          },
        ],
      },
    ];
    mock.invoke.mockResolvedValue({ data: { proposta: { ...PROPOSTA }, anexo: {} }, error: null });
    montar(h(AgenteDoMes, { mesInicial: "2026-10-01" }));
    await waitFor(() => expect(screen.getByText("Tema novo de outubro")).toBeTruthy());
    expect(screen.getByText("Tema que sai")).toBeTruthy();
    expect(screen.getByText("Tema com data nova")).toBeTruthy();
    expect(screen.getByText(/Plano de outubro de 2026 atualizado/)).toBeTruthy();
    // Nada foi gravado só por mostrar a sugestão.
    expect(chamadasDe("aplicar_mudanca").length).toBe(0);

    fireEvent.click(screen.getByRole("button", { name: /Aplicar na proposta/ }));
    await waitFor(() => expect(chamadasDe("aplicar_mudanca").length).toBe(1));
    expect(chamadasDe("aplicar_mudanca")[0]).toEqual({ acao: "aplicar_mudanca", mensagem_id: "m1" });
    await waitFor(() => expect(screen.getByText("Aplicada na proposta")).toBeTruthy());
  });

  it("Descartar a mudança manda descartar: true", async () => {
    mock.tabelas.agente_conversas = [{ id: "conv-1" }];
    mock.tabelas.agente_mensagens = [
      {
        id: "m2",
        papel: "agente",
        conteudo: "Posso tirar um conteúdo.",
        criado_em: "2026-09-24T12:00:00Z",
        anexos: [{ tipo: "mudanca", alvo_proposta_id: PROPOSTA.id, base: null, periodo: null, resumo: "Tiro um.", diferenca: null, ajustes: null }],
      },
    ];
    montar(h(AgenteDoMes, { mesInicial: "2026-10-01" }));
    await waitFor(() => expect(screen.getByRole("button", { name: /Descartar/ })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /Descartar/ }));
    await waitFor(() => expect(chamadasDe("aplicar_mudanca").length).toBe(1));
    expect(chamadasDe("aplicar_mudanca")[0]).toEqual({ acao: "aplicar_mudanca", mensagem_id: "m2", descartar: true });
  });

  it("o plano combinado do mês aparece e dá para esquecer", async () => {
    mock.tabelas.agente_memoria = [
      { id: "mem-1", texto: "Plano do mês 2026-10: Foco em pedidos pelo WhatsApp.\nFrequência: 3 publicações por semana.", criado_em: "2026-09-24T12:00:00Z" },
      { id: "mem-0", texto: "Temas escolhidos pela equipe para setembro: x.", criado_em: "2026-09-20T12:00:00Z" },
    ];
    montar(h(AgenteDoMes, { mesInicial: "2026-10-01" }));
    const chip = await screen.findByRole("button", { name: /Plano combinado/ });
    fireEvent.click(chip);
    expect(screen.getByText(/Foco em pedidos pelo WhatsApp/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Esquecer este plano" }));
    await waitFor(() => expect(mock.updates.some((u) => u.tabela === "agente_memoria" && (u.valor as any).ativa === false)).toBe(true));
  });
});

// ------------------------------------------------------------------ apagar

describe("apagar conteúdo que não serviu", () => {
  it("na proposta: lixeira, confirmação curta, tirar_item e Desfazer chama repor_item", async () => {
    mock.invoke.mockImplementation(async (_f: string, { body }: any) => {
      if (body.acao === "tirar_item") {
        return { data: { proposta: { ...PROPOSTA, itens: [PROPOSTA.itens[1]] }, removido: { item: PROPOSTA.itens[0], indice: 0, tema_escolhido: null }, memoria_id: "mem-9" }, error: null };
      }
      return { data: { proposta: PROPOSTA }, error: null };
    });
    montar(h(BlocoDaProposta, { proposta: PROPOSTA, permitirApagar: true }));
    const lixeiras = screen.getAllByRole("button", { name: "Apagar" });
    expect(lixeiras.length).toBe(2);
    fireEvent.click(lixeiras[0]);
    // Primeiro clique só pergunta.
    expect(mock.invoke).not.toHaveBeenCalled();
    const pergunta = screen.getByRole("group", { name: "Confirmar apagar" });
    expect(pergunta.textContent).toContain("Apagar este conteúdo?");
    fireEvent.click(within(pergunta).getByRole("button", { name: "Apagar" }));
    await waitFor(() => expect(chamadasDe("tirar_item").length).toBe(1));
    expect(chamadasDe("tirar_item")[0]).toEqual({ acao: "tirar_item", proposta_id: PROPOSTA.id, tema_id: "p1", indice: 0 });

    desfazerDo("Conteúdo apagado da proposta")();
    await waitFor(() => expect(chamadasDe("repor_item").length).toBe(1));
    expect(chamadasDe("repor_item")[0]).toEqual({ acao: "repor_item", proposta_id: PROPOSTA.id, item: PROPOSTA.itens[0], indice: 0, memoria_id: "mem-9" });
  });

  it("Cancelar não apaga nada", () => {
    montar(h(BlocoDaProposta, { proposta: PROPOSTA, permitirApagar: true }));
    fireEvent.click(screen.getAllByRole("button", { name: "Apagar" })[0]);
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByRole("group", { name: "Confirmar apagar" })).toBeNull();
    expect(mock.invoke).not.toHaveBeenCalled();
  });

  it("sem permitirApagar (campanhas) o cartão não ganha lixeira", () => {
    montar(h(BlocoDaProposta, { proposta: PROPOSTA }));
    expect(screen.queryByRole("button", { name: "Apagar" })).toBeNull();
  });

  it("gravado: apaga da agenda, pede de novo quando já tem arte e Desfazer restaura", async () => {
    const gravada: PropostaV4 = {
      ...PROPOSTA,
      status: "gravada",
      task_ids: ["44444444-4444-4444-4444-444444444444"],
      itens: [{ ...PROPOSTA.itens[0], task_id: "44444444-4444-4444-4444-444444444444" }],
    };
    let vezes = 0;
    mock.invoke.mockImplementation(async (_f: string, { body }: any) => {
      if (body.acao === "arquivar_item_agenda") {
        vezes++;
        if (!body.confirmar_arte) {
          return { data: { error: "item_com_arte", mensagem: "Este conteúdo já tem arte no Estúdio. Confirme para apagar.", arte: true }, error: null };
        }
        return { data: { task_id: body.task_id, titulo: "Tema que não serviu", arte: true, memoria_id: "mem-7" }, error: null };
      }
      return { data: {}, error: null };
    });
    montar(h(BlocoDaProposta, { proposta: gravada, permitirApagar: true }));
    fireEvent.click(screen.getByRole("button", { name: "Apagar" }));
    fireEvent.click(within(screen.getByRole("group", { name: "Confirmar apagar" })).getByRole("button", { name: "Apagar" }));
    await waitFor(() => expect(screen.getByText(/já tem arte no Estúdio/)).toBeTruthy());
    expect(chamadasDe("arquivar_item_agenda")[0]).toEqual({ acao: "arquivar_item_agenda", client_id: CLIENTE, task_id: "44444444-4444-4444-4444-444444444444" });
    fireEvent.click(screen.getByRole("button", { name: "Apagar mesmo" }));
    await waitFor(() => expect(vezes).toBe(2));
    expect(chamadasDe("arquivar_item_agenda")[1]).toEqual({
      acao: "arquivar_item_agenda",
      client_id: CLIENTE,
      task_id: "44444444-4444-4444-4444-444444444444",
      confirmar_arte: true,
    });
    desfazerDo("Conteúdo apagado da agenda")();
    await waitFor(() => expect(chamadasDe("restaurar_item_agenda").length).toBe(1));
    expect(chamadasDe("restaurar_item_agenda")[0]).toEqual({
      acao: "restaurar_item_agenda",
      client_id: CLIENTE,
      task_id: "44444444-4444-4444-4444-444444444444",
      memoria_id: "mem-7",
    });
  });

  it("na Agenda do mês: o item selecionado tem Apagar da agenda", async () => {
    mock.tabelas.tasks = [
      { id: "t1", title: "Carrossel que não serviu", description: "x", due_date: "2026-10-15", delivery_type: "carousel", status: "todo", project_id: "proj" },
    ];
    mock.invoke.mockResolvedValue({ data: { task_id: "t1", titulo: "Carrossel que não serviu", arte: false, memoria_id: null }, error: null });
    const { container } = montar(h(AgendaDoMes, {}));
    await waitFor(() => expect(container.querySelector('[data-dia="2026-10-15"] [data-cartao="item"]')).toBeTruthy());
    fireEvent.click(container.querySelector('[data-dia="2026-10-15"] [data-cartao="item"]') as HTMLElement);
    fireEvent.click(screen.getByRole("button", { name: "Apagar da agenda" }));
    fireEvent.click(within(screen.getByRole("group", { name: "Confirmar apagar" })).getByRole("button", { name: "Apagar da agenda" }));
    await waitFor(() => expect(chamadasDe("arquivar_item_agenda").length).toBe(1));
    expect(chamadasDe("arquivar_item_agenda")[0]).toEqual({ acao: "arquivar_item_agenda", client_id: CLIENTE, task_id: "t1" });
  });
});

// ------------------------------------------------------------------ funções puras

describe("plano do mês: funções", () => {
  it("lê o mês do texto, separa o corpo e fica com o mais novo de cada mês", () => {
    expect(mesDoPlano("Plano do mês 2026-10: foco")).toBe("2026-10");
    expect(mesDoPlano("Temas escolhidos pela equipe")).toBeNull();
    expect(corpoDoPlano("Plano do mês 2026-10: Foco em pedidos.\nFrequência: 3")).toBe("Foco em pedidos.\nFrequência: 3");
    expect(resumoDoPlano("Plano do mês 2026-10: Foco em pedidos.\nFrequência: 3")).toBe("Foco em pedidos.");
    const planos = planosPorMes([
      { id: "b", texto: "Plano do mês 2026-11: novo", criado_em: "2026-09-24" },
      { id: "a", texto: "Plano do mês 2026-10: novo", criado_em: "2026-09-23" },
      { id: "c", texto: "Plano do mês 2026-10: velho", criado_em: "2026-09-01" },
      { id: "d", texto: "outra memória", criado_em: "2026-09-01" },
    ]);
    expect(planos.map((p) => `${p.mes}:${p.id}`)).toEqual(["2026-10:a", "2026-11:b"]);
    expect(JSON.parse(JSON.stringify(planos))).toEqual(planos);
  });

  it("o corpo do planejamento leva o mês AAAA-MM e no máximo 6 anexos", () => {
    const corpo = corpoDoPlanejamento({ clientId: CLIENTE, mensagem: "oi", mes: "2026-12-01", anexos: ["1", "2", "3", "4", "5", "6", "7"] });
    expect(corpo.mes).toBe("2026-12");
    expect((corpo.anexos as string[]).length).toBe(6);
    expect(mesesAPartirDe("2026-11-01", 3)).toEqual(["2026-11-01", "2026-12-01", "2027-01-01"]);
  });
});

describe("compatibilidade e texto dos arquivos novos da aba Mês", () => {
  it("sem lookbehind, \\p{}, grupo nomeado, aspect-ratio, :has, .at(), Object.hasOwn, min/max/clamp em classe nem travessão", () => {
    for (const rel of [
      "src/components/mesa/AbaMes.tsx",
      "src/components/mesa/AgenteDoMes.tsx",
      "src/components/mesa/ApagarConteudo.tsx",
      "src/components/mesa/planoDoMes.ts",
      "src/components/mesa/ConteudosPropostos.tsx",
      "src/components/mesa/PlanejamentoAutomatico.tsx",
      "src/components/mesa/AgendaDoMes.tsx",
    ]) {
      const texto = ler(rel);
      expect(texto, rel).not.toContain("(?<");
      expect(texto, rel).not.toMatch(/\\p\{/);
      expect(texto, rel).not.toContain("aspect-[");
      expect(texto, rel).not.toContain("aspect-square");
      expect(texto, rel).not.toContain("has-[");
      expect(texto, rel).not.toContain(".at(");
      expect(texto, rel).not.toContain("Object.hasOwn(");
      expect(texto, rel).not.toMatch(/-\[(?:min|max|clamp)\(/);
      expect(texto, rel).not.toContain("—");
      expect(texto, rel).not.toContain("–");
    }
  });
});
