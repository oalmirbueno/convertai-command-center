import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement as h } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Mesa Roteiros (Frente R2): a tela contra o contrato da função mesa-roteiros.
 * Banco e função simulados. Confere a casca (etapas, seletor da mesa
 * "roteiros", troca de mesas, tela cheia), a agenda com as peças de vídeo, a
 * geração com o custo antes, o editor que salva versão com a revisão de base,
 * a revisão (aprovar), o PDF (Baixar e Compartilhar só com aprovado) e o
 * agente com o cartão de ação.
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
    for (const m of ["select", "eq", "neq", "not", "in", "is", "or", "contains", "overlaps", "gte", "lt", "lte", "gt", "order", "limit", "range", "update", "insert"]) b[m] = () => b;
    const primeiro = () => ({ data: Array.isArray(dados) ? (dados[0] === undefined ? null : dados[0]) : dados, error: null });
    b.maybeSingle = () => Promise.resolve(primeiro());
    b.single = () => Promise.resolve(primeiro());
    b.then = (ok: any, erro: any) => Promise.resolve({ data: dados, error: null }).then(ok, erro);
    return b;
  };
  return {
    supabase: {
      functions: { invoke: mock.invoke },
      rpc: mock.rpc,
      from: (tabela: string) => consulta(tabela),
      storage: { from: () => ({ createSignedUrl: () => Promise.resolve({ data: { signedUrl: "https://x.test/a.png" }, error: null }) }) },
    },
  };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn(), message: vi.fn() } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { role: "admin" }, user: { id: "u-1" } }) }));

const CLIENTE = "11111111-1111-1111-1111-111111111111";
const TAREFA = "22222222-2222-4222-8222-222222222222";
const TAREFA_2 = "33333333-3333-4333-8333-333333333333";
const ROTEIRO = "44444444-4444-4444-8444-444444444444";

vi.mock("@/hooks/useSupabaseData", () => ({
  useClients: () => ({
    data: [{ id: "11111111-1111-1111-1111-111111111111", company_name: "Thainá Lima Rosa Advogada", plan_status: "active" }],
    isLoading: false,
    isSuccess: true,
    isFetching: false,
    dataUpdatedAt: 1,
    refetch: vi.fn(),
  }),
}));

import { TooltipProvider } from "@/components/ui/tooltip";
import MesaRoteiros, { ETAPAS_DA_MESA_ROTEIROS } from "@/pages/MesaRoteiros";
import { MESAS, enderecoDaMesa } from "@/components/mesa-foto/TrocaDeMesas";
import { NOME_DA_MESA } from "@/components/mesa/clientesDaMesa";
import { cargasDaMesa, MESAS_DO_PAINEL } from "@/lib/mesa/preCarga";

const ler = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

const CONTEUDO = {
  titulo: "Salário-maternidade",
  subtitulo: "Estou desempregada e agora?",
  tipo: "fala_camera",
  ganchos: [
    { texto: "Estou grávida e sem emprego. Tenho direito?", mecanismo: "pergunta concreta", promessa: "responder", motivo: "" },
    { texto: "Perdeu o emprego grávida? Ainda pode haver proteção.", mecanismo: "contraste", promessa: "", motivo: "" },
    { texto: "A data em que você saiu muda tudo.", mecanismo: "resultado primeiro", promessa: "", motivo: "" },
  ],
  gancho_escolhido: 0,
  blocos: [
    { id: "b1", funcao: "Abertura", fala: "Estou grávida e sem emprego. Tenho direito?", segundos: 5, visual: "Sentada" },
    { id: "b2", funcao: "Resposta", fala: "Não necessariamente. Você pode continuar protegida.", segundos: 8, visual: "Aproximar" },
  ],
  direcao: { enquadramento: "Peito para cima", ambiente: "Sentada à mesa", orientacoes: ["Olhar na lente"] },
  cta: "Salve para consultar depois.",
  legenda: "Grávida e sem emprego?",
};

const linhaDoRoteiro = (status = "rascunho") => ({
  id: ROTEIRO,
  client_id: CLIENTE,
  task_id: TAREFA,
  titulo: "Salário-maternidade",
  tipo: "fala_camera",
  status,
  versao_atual: 2,
  versao_aprovada: status === "rascunho" ? null : 2,
  versoes: [
    { numero: 1, origem: "ia", conteudo: CONTEUDO, criado_em: "2026-09-25T10:00:00Z", custo_usd: 0.03 },
    { numero: 2, origem: "edicao", conteudo: { ...CONTEUDO, cta: "Comente sua dúvida." }, criado_em: "2026-09-26T10:00:00Z", aviso: { retencao: 2, clareza: 4, promessa_cumprida: 0.8, frases: ["Retenção: a abertura ou o meio podem perder quem assiste."] } },
  ],
  comentarios: [{ id: "c1", texto: "Encurtar a resposta", autor_nome: "Ana", versao: 1, bloco_id: "b2" }],
  custo_usd: 0.03,
  criado_em: "2026-09-25T10:00:00Z",
  atualizado_em: "2026-09-26T10:00:00Z",
});

function hojeMais(dias: number) {
  const d = new Date(Date.now() + dias * 86400000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function montar(endereco: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(h(QueryClientProvider, { client: qc }, h(MemoryRouter, { initialEntries: [endereco] }, h(TooltipProvider, null, h(MesaRoteiros)))));
}

const chamadasDe = (acao: string) => mock.invoke.mock.calls.filter((c) => c[1] && c[1].body && c[1].body.acao === acao);

beforeAll(() => {
  const u = URL as any;
  if (!u.createObjectURL) u.createObjectURL = vi.fn(() => "blob:pdf-teste");
  if (!u.revokeObjectURL) u.revokeObjectURL = vi.fn();
});

beforeEach(() => {
  mock.invoke.mockReset();
  mock.rpc.mockReset();
  mock.rpc.mockResolvedValue({ data: {}, error: null });
  window.localStorage.clear();
  mock.tabelas = {
    ia_modelos: [{ id: "openai:gpt-6-sol", provedor: "openai", modelo_api: "gpt-6-sol", tipo: "texto", rotulo: "GPT 6 Sol", preco_entrada_1m: 1, preco_saida_1m: 4, ativo: true, padrao_para: ["estrategista"] }],
    tasks: [
      { id: TAREFA, title: "Reels salário-maternidade", description: null, due_date: hojeMais(2), delivery_type: "reel", status: "todo" },
      { id: TAREFA_2, title: "Story BPC", description: null, due_date: hojeMais(4), delivery_type: "story", status: "todo" },
    ],
    calendario_propostas: [{ task_ids: [TAREFA_2] }],
    roteiros: [linhaDoRoteiro()],
    roteiro_modelos: [],
    mesa_cliente_escolhas: [],
  };
  mock.invoke.mockImplementation((_fn: string, { body }: any) => {
    if (body.acao === "versao_salvar") return Promise.resolve({ data: { roteiro: { ...linhaDoRoteiro(), versao_atual: 3 }, versao: { numero: 3 }, custo_usd: 0 }, error: null });
    if (body.acao === "gerar") return Promise.resolve({ data: { roteiro: linhaDoRoteiro(), versao: { numero: 1 }, custo_usd: 0.02 }, error: null });
    if (body.acao === "status_mudar") return Promise.resolve({ data: { roteiro: linhaDoRoteiro("aprovado"), modelo: { id: "m1", nome: "Salário-maternidade" }, custo_usd: 0 }, error: null });
    if (body.acao === "agente_historico") return Promise.resolve({ data: { conversa_id: null, mensagens: [] }, error: null });
    if (body.acao === "agente_conversar") {
      return Promise.resolve({
        data: {
          conversa_id: "55555555-5555-4555-8555-555555555555",
          mensagem_id: "66666666-6666-4666-8666-666666666666",
          resposta: "A lista está pronta para confirmar.",
          anexos: [
            {
              tipo: "acao_agente",
              agente: "roteiros",
              id: "roteiros-1",
              resumo: "Vou gerar o roteiro de 2 peças.",
              itens: [
                { ref: "p1", alvo_id: TAREFA, titulo: "Reels salário-maternidade", detalhe: null, operacao: "gerar_roteiro", rotulo: "gerar o roteiro de", para: "fala_camera", para_rotulo: "Fala para câmera" },
                { ref: "p2", alvo_id: TAREFA_2, titulo: "Story BPC", detalhe: null, operacao: "gerar_roteiro", rotulo: "gerar o roteiro de", para: "fala_camera", para_rotulo: "Fala para câmera" },
              ],
              ignorados: [],
              recusados: [],
              custo_estimado_usd: 0.1,
            },
          ],
          custo_usd: 0.01,
        },
        error: null,
      });
    }
    return Promise.resolve({ data: {}, error: null });
  });
});

describe("casca da Mesa Roteiros", () => {
  it("rota, pré-carga, troca de mesas, seletor e tela cheia no mesmo esqueleto", () => {
    const app = ler("src/App.tsx");
    expect(app).toContain('import { PaginaMesaRoteiros } from "@/lib/mesa/preCarga";');
    expect(app).toContain('<Route path="/mesa-roteiros" element={<>{["admin", "manager", "design"].includes(profile?.role || "") ? <Suspense fallback={<EsqueletoDaMesa />}><MesaRoteiros /></Suspense> : <Navigate to="/dashboard" replace />}</>} />');
    expect(Object.keys(MESAS_DO_PAINEL["/mesa-roteiros"].etapas)).toEqual(ETAPAS_DA_MESA_ROTEIROS.map((e) => e.valor));
    expect(cargasDaMesa("/mesa-roteiros", `?client=${CLIENTE}&etapa=pdf`).map(([k]) => k)).toEqual(["pagina/mesa-roteiros", "mesa-roteiros/pdf", "mesa-roteiros/agente"]);
    expect(MESAS.some((m) => m.valor === "roteiros" && m.caminho === "/mesa-roteiros")).toBe(true);
    expect(enderecoDaMesa("roteiros", CLIENTE)).toBe(`/mesa-roteiros?client=${CLIENTE}`);
    expect(NOME_DA_MESA.roteiros).toBe("Mesa Roteiros");
    const pagina = ler("src/pages/MesaRoteiros.tsx");
    expect(pagina).toContain('<SeletorDeClientesDaMesa mesa="roteiros"');
    expect(pagina).toContain('<TrocaDeMesas atual="roteiros" clientId={clientId} />');
  });

  it("sem cliente, pede para escolher o cliente", async () => {
    montar("/mesa-roteiros");
    expect(screen.getByText("Escolha um cliente para abrir a Mesa Roteiros dele.")).toBeTruthy();
  });
});

describe("agenda", () => {
  it("lista as peças de vídeo com o estado do roteiro e o roteiro do calendário como base", async () => {
    const onde = montar(`/mesa-roteiros?client=${CLIENTE}&etapa=agenda`);
    const nav = await screen.findByRole("navigation", { name: "Etapas da Mesa Roteiros" });
    expect(within(nav).getAllByRole("button").map((b) => b.textContent)).toEqual(["1Agenda", "2Roteiro", "3Revisão", "4PDF", "5Modelos"]);
    const pecas = await waitFor(() => {
      const l = onde.container.querySelector("[data-pecas-de-video]");
      if (!l) throw new Error("sem lista");
      return l as HTMLElement;
    });
    await waitFor(() => expect(within(pecas).getByText("Reels salário-maternidade")).toBeTruthy());
    expect(within(pecas).getByText("Rascunho")).toBeTruthy();
    expect(within(pecas).getByText(/roteiro do calendário entra como base/)).toBeTruthy();
    expect(within(pecas).getByRole("button", { name: /Escrever roteiro/ })).toBeTruthy();
    expect(within(pecas).getByRole("button", { name: /Abrir/ })).toBeTruthy();
  });
});

describe("roteiro", () => {
  it("gera o roteiro da peça com o preço ao lado do botão e manda o pedido certo", async () => {
    mock.tabelas.roteiros = [];
    montar(`/mesa-roteiros?client=${CLIENTE}&etapa=roteiro&tarefa=${TAREFA_2}`);
    await screen.findByRole("radiogroup", { name: "Tipo de roteiro" });
    fireEvent.click(screen.getByRole("radio", { name: /Tutorial/ }));
    const gerar = await screen.findByRole("button", { name: /Gerar roteiro/ });
    await waitFor(() => expect(gerar.textContent).toMatch(/~US\$|~\$|~/));
    fireEvent.click(gerar);
    await waitFor(() => expect(chamadasDe("gerar")).toHaveLength(1));
    const corpo = chamadasDe("gerar")[0][1].body;
    expect(corpo).toMatchObject({ client_id: CLIENTE, task_id: TAREFA_2, tipo: "tutorial", duracao_s: 45, modelo_id: "openai:gpt-6-sol" });
  });

  it("editor: três ganchos, falas por bloco, aviso do Jev e salvar versão com a revisão de base", async () => {
    montar(`/mesa-roteiros?client=${CLIENTE}&etapa=roteiro&roteiro=${ROTEIRO}`);
    const ganchos = await screen.findByRole("radiogroup", { name: "Ganchos" });
    expect(within(ganchos).getAllByRole("radio")).toHaveLength(3);
    expect(screen.getByText(/Conferência editorial/)).toBeTruthy();
    const salvar = screen.getByRole("button", { name: /Salvar versão/ }) as HTMLButtonElement;
    expect(salvar.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Fala do bloco 2"), { target: { value: "Não necessariamente. Confira as datas." } });
    expect(salvar.disabled).toBe(false);
    fireEvent.click(salvar);
    await waitFor(() => expect(chamadasDe("versao_salvar")).toHaveLength(1));
    const corpo = chamadasDe("versao_salvar")[0][1].body;
    expect(corpo.roteiro_id).toBe(ROTEIRO);
    expect(corpo.versao_base).toBe(2);
    expect(corpo.conteudo.blocos[1].fala).toBe("Não necessariamente. Confira as datas.");
  });

  it("gravado fica só leitura", async () => {
    mock.tabelas.roteiros = [linhaDoRoteiro("gravado")];
    montar(`/mesa-roteiros?client=${CLIENTE}&etapa=roteiro&roteiro=${ROTEIRO}`);
    await screen.findByText(/Roteiro já gravado/);
    expect((screen.getByLabelText("Fala do bloco 1") as HTMLTextAreaElement).disabled).toBe(true);
  });
});

describe("revisão e PDF", () => {
  it("aprovar manda status_mudar e mostra versões e comentários", async () => {
    montar(`/mesa-roteiros?client=${CLIENTE}&etapa=revisao&roteiro=${ROTEIRO}`);
    const aprovar = await screen.findByRole("button", { name: /^Aprovar$/ });
    expect(screen.getByText("Encurtar a resposta")).toBeTruthy();
    expect(screen.getAllByText(/Versão 2/).length).toBeGreaterThan(0);
    fireEvent.click(aprovar);
    await waitFor(() => expect(chamadasDe("status_mudar")).toHaveLength(1));
    expect(chamadasDe("status_mudar")[0][1].body).toEqual({ acao: "status_mudar", roteiro_id: ROTEIRO, status: "aprovado" });
  });

  it("PDF: prévia e Baixar na hora; Compartilhar só com roteiro aprovado", async () => {
    montar(`/mesa-roteiros?client=${CLIENTE}&etapa=pdf&roteiro=${ROTEIRO}`);
    const baixar = await screen.findByRole("button", { name: /Baixar/ });
    await waitFor(() => expect((baixar as HTMLButtonElement).disabled).toBe(false));
    expect(screen.getByTitle("Prévia do PDF do roteiro")).toBeTruthy();
    expect((screen.getByRole("button", { name: /Compartilhar com o cliente/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Só roteiro aprovado vai para o cliente/)).toBeTruthy();
  });

  it("PDF com aprovado: Compartilhar chama a função com os roteiros escolhidos", async () => {
    mock.tabelas.roteiros = [linhaDoRoteiro("aprovado")];
    mock.invoke.mockImplementation((_fn: string, { body }: any) =>
      Promise.resolve({ data: body.acao === "pdf_compartilhar" ? { file_id: "f1", revisao_solicitada: true, aviso: null, ja_existia: false } : {}, error: null }),
    );
    montar(`/mesa-roteiros?client=${CLIENTE}&etapa=pdf&roteiro=${ROTEIRO}`);
    const compartilhar = await screen.findByRole("button", { name: /Compartilhar com o cliente/ });
    await waitFor(() => expect((compartilhar as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(compartilhar);
    await waitFor(() => expect(chamadasDe("pdf_compartilhar")).toHaveLength(1));
    expect(chamadasDe("pdf_compartilhar")[0][1].body).toEqual({ acao: "pdf_compartilhar", client_id: CLIENTE, roteiro_ids: [ROTEIRO] });
  });
});

describe("agente da mesa", () => {
  it("conversa e mostra o cartão de ação com o custo antes de confirmar", async () => {
    montar(`/mesa-roteiros?client=${CLIENTE}&etapa=agenda`);
    fireEvent.click(await screen.findByRole("button", { name: "Abrir o agente da Mesa Roteiros" }));
    await waitFor(() => expect(chamadasDe("agente_historico")).toHaveLength(1));
    fireEvent.click(screen.getByRole("button", { name: "Roteiros da semana" }));
    fireEvent.click(screen.getByRole("button", { name: "Enviar ao agente" }));
    await waitFor(() => expect(chamadasDe("agente_conversar")).toHaveLength(1));
    expect(chamadasDe("agente_conversar")[0][1].body).toMatchObject({ client_id: CLIENTE, mensagem: "Gere os roteiros das peças de vídeo da semana." });
    await screen.findByText("Vou gerar o roteiro de 2 peças.");
    expect(screen.getByText(/Custo estimado/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Confirmar/ })).toBeTruthy();
  });
});
