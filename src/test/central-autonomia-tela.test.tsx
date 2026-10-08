import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Central de Autonomia na tela: o Gestor mostra só o que vem conferido, com a
 * fonte clicável; encaminhar ao Hermes leva o cliente e as próximas ações; a
 * equipe sem admin vê indicadores e histórico, mas não o chat.
 */

const m = vi.hoisted(() => ({ chamar: vi.fn(), invoke: vi.fn(), papel: "admin" as string }));

vi.mock("@/lib/mesa/api", async (orig) => ({ ...(await orig<typeof import("@/lib/mesa/api")>()), chamarFuncao: m.chamar }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { role: m.papel }, user: { id: "u1" } }) }));
vi.mock("@/integrations/supabase/client", () => {
  // Qualquer cadeia do PostgREST resolve vazia (indicadores e histórico sem dados).
  const cadeia: any = new Proxy(function () {}, {
    get: (_t, k) => (k === "then" ? (ok: (v: unknown) => void) => ok({ data: [], count: 0, error: null }) : cadeia),
    apply: () => cadeia,
  });
  return { supabase: { from: () => cadeia, rpc: () => cadeia, functions: { invoke: m.invoke } } };
});
// A duração do áudio vem do elemento <audio> (o jsdom não carrega mídia).
vi.mock("@/lib/gestorAnexos", async (orig) => ({ ...(await orig<typeof import("@/lib/gestorAnexos")>()), duracaoDoAudio: async () => 42 }));

import CentralDeAutonomia from "@/components/execucao/CentralDeAutonomia";

const resposta = {
  tipo: "resposta",
  origem: "ia_conferida",
  cabecalho: "Acerbi · esta semana (05/10 a 08/10)",
  abertura: "Dei uma olhada em Acerbi (esta semana). Achei 9 registros no OS; vou te contar o que importa.",
  fechamento: "Tem 1 decisão esperando você. Quer ver agora?",
  sugestoes: ["O que espera a minha decisão?", "E Acerbi nos últimos 30 dias?"],
  contagem: { feito: 1, em_revisao: 1, em_andamento: 1, bloqueado: 0, decisao: 1, concluido_sem_prova: 0, lacuna: 0, proximo: 0 },
  cliente: { id: "39ebda82", nome: "Acerbi", projeto_id: null },
  itens: [
    { secao: "feito", texto: "Atlas concluiu a conciliação: cinco publicações associadas e duas lacunas documentadas.", fontes: ["F1"], conferido: "jev" },
    { secao: "lacuna", texto: "Os vídeos do evento seguem em edição, sem publicação.", fontes: ["F2"], conferido: "jev" },
    { secao: "proximo", texto: "Revisar o escopo do registro de desempenho.", fontes: ["F3"], conferido: "jev" },
  ],
  fontes: [
    { apelido: "F1", tipo: "tarefa", estado: "feito_com_prova", titulo: "Conciliar publicações confirmadas", quando: "2026-10-08T01:35:54Z", texto: "Prova: Diário entrada 8dea0967", cliente: "Acerbi", agente: "Atlas", ids: { tarefa: "250c19a0", vinculo: "4d586b2e" } },
    { apelido: "F2", tipo: "tarefa", estado: "em_andamento", titulo: "Edição dos vídeos", quando: null, texto: "vídeos ainda em edição", cliente: "Acerbi", agente: null, ids: { tarefa: "802f13b4" } },
    { apelido: "F3", tipo: "tarefa", estado: "em_revisao", titulo: "Registrar desempenho", quando: null, texto: "Próximo passo: Almir revisar escopo", cliente: "Acerbi", agente: "Augusto", ids: { tarefa: "045c27a1", vinculo: "b275f92f" } },
  ],
  avisos: [],
  total_de_fontes: 9,
  texto: "Acerbi · esta semana",
};

function montar(aoEncaminhar = vi.fn(), aoAbrirDiario = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <CentralDeAutonomia nomesDeAgentes={new Map()} titulosDeTarefas={new Map()} aoAbrirDiario={aoAbrirDiario} aoEncaminhar={aoEncaminhar} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { aoEncaminhar, aoAbrirDiario };
}

describe("Central de Autonomia na tela", () => {
  beforeEach(() => {
    m.papel = "admin";
    m.chamar.mockReset();
    m.chamar.mockImplementation(async (_f: string, corpo: { acao: string }) => (corpo.acao === "conversa" ? { mensagens: [] } : resposta));
  });

  it("pergunta ao Gestor: conversa em balões curtos, cartão com os números e fonte que abre o diário", async () => {
    const { aoAbrirDiario } = montar();
    fireEvent.click(await screen.findByRole("button", { name: "O que aconteceu com a Acerbi nesta semana?" }));
    await screen.findByText("Conferido nas fontes");
    expect(m.chamar).toHaveBeenCalledWith("gestor-aceleriq", expect.objectContaining({ acao: "perguntar", pergunta: "O que aconteceu com a Acerbi nesta semana?", periodo: null }));
    expect(screen.getByText(/Dei uma olhada em Acerbi/)).toBeTruthy();
    expect(screen.getByText("Tem 1 decisão esperando você. Quer ver agora?")).toBeTruthy();
    // Cada item é um balão próprio, com o rótulo do assunto (sem textão).
    expect(screen.getByText(/Atlas concluiu a conciliação/)).toBeTruthy();
    expect(screen.getByText(/Os vídeos do evento seguem em edição/)).toBeTruthy();
    expect(screen.getAllByText("Feito com prova").length).toBeGreaterThan(0);
    expect(screen.getByText("Pendências e lacunas")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "F1" }));
    fireEvent.click(await screen.findByRole("button", { name: "Abrir diário da execução" }));
    expect(aoAbrirDiario).toHaveBeenCalledWith("4d586b2e", "Conciliar publicações confirmadas");
  });

  it("a sugestão de próxima pergunta já vai com o cliente da resposta", async () => {
    montar();
    fireEvent.click(await screen.findByRole("button", { name: "O que aconteceu com a Acerbi nesta semana?" }));
    fireEvent.click(await screen.findByRole("button", { name: "E Acerbi nos últimos 30 dias?" }));
    await waitFor(() => expect(m.chamar).toHaveBeenCalledWith("gestor-aceleriq", expect.objectContaining({ pergunta: "E Acerbi nos últimos 30 dias?", cliente_id: "39ebda82" })));
  });

  it("encaminhar ao Hermes leva o cliente e as próximas ações (o envio é do dono, pelo diário)", async () => {
    const { aoEncaminhar } = montar();
    fireEvent.click(await screen.findByRole("button", { name: "O que aconteceu com a Acerbi nesta semana?" }));
    fireEvent.click(await screen.findByRole("button", { name: /Encaminhar ao Hermes/ }));
    expect(aoEncaminhar).toHaveBeenCalledTimes(1);
    const pedido = aoEncaminhar.mock.calls[0][0];
    expect(pedido.cliente).toEqual({ id: "39ebda82", nome: "Acerbi" });
    expect(pedido.texto).toContain("Revisar o escopo do registro de desempenho.");
  });

  it("sem admin: não chama o Gestor e explica; indicadores e decisões continuam", async () => {
    m.papel = "design";
    montar();
    expect(await screen.findByText("O Gestor Aceleriq é do admin.")).toBeTruthy();
    expect(screen.getByRole("complementary", { name: "Painel ao lado do chat" })).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: /Decisões/ }));
    expect(await screen.findByText(/Pedidos de aprovação dos agentes/)).toBeTruthy();
    await waitFor(() => expect(m.chamar).not.toHaveBeenCalled());
  });
});

describe("Central de Autonomia: espaço, tela cheia e anexos", () => {
  beforeEach(() => {
    m.papel = "admin";
    m.chamar.mockReset();
    m.invoke.mockReset();
    m.chamar.mockImplementation(async (_f: string, corpo: { acao: string }) => (corpo.acao === "conversa" ? { mensagens: [] } : resposta));
  });

  it("tela cheia ocupa a janela e sai com Esc; ampliar o chat esconde a coluna ao lado", async () => {
    montar();
    await screen.findByText("O que você quer saber da operação?");
    fireEvent.click(screen.getByRole("button", { name: "Tela cheia" }));
    expect(screen.getByRole("dialog", { name: "Central de Autonomia em tela cheia" })).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Central de Autonomia em tela cheia" })).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Ampliar o chat" }));
    expect(screen.queryByRole("complementary", { name: "Painel ao lado do chat" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Mostrar o painel ao lado" }));
    expect(screen.getByRole("complementary", { name: "Painel ao lado do chat" })).toBeTruthy();
  });

  it("arquivo anexado é lido na tela e vai como texto junto da pergunta", async () => {
    montar();
    await screen.findByText("O que você quer saber da operação?");
    const entrada = document.querySelector('input[type="file"]') as HTMLInputElement;
    const arquivo = new File(["Ata da reunião: a Acerbi pediu 2 vídeos para sexta."], "ata.txt", { type: "text/plain" });
    fireEvent.change(entrada, { target: { files: [arquivo] } });
    expect(await screen.findByText("ata.txt")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Pergunta ao Gestor Aceleriq"), { target: { value: "O que essa ata pede?" } });
    fireEvent.click(screen.getByRole("button", { name: "Perguntar" }));
    await waitFor(() => expect(m.chamar).toHaveBeenCalledWith("gestor-aceleriq", expect.objectContaining({ acao: "perguntar", pergunta: "O que essa ata pede?" })));
    const corpo = m.chamar.mock.calls.find((c) => c[1].acao === "perguntar")![1];
    expect(corpo.arquivos.lidos[0]).toMatchObject({ nome: "ata.txt", texto: expect.stringContaining("2 vídeos para sexta") });
  });

  it("áudio anexado é transcrito e sai como a mensagem, com a marca do áudio", async () => {
    m.invoke.mockResolvedValue({ data: { texto: "Como está a Acerbi nesta semana?", segundos: 42 }, error: null });
    montar();
    await screen.findByText("O que você quer saber da operação?");
    const entrada = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(entrada, { target: { files: [new File([new Uint8Array(2048)], "recado.m4a", { type: "audio/x-m4a" })] } });
    await waitFor(() => expect(m.invoke).toHaveBeenCalledWith("gestor-aceleriq", expect.objectContaining({ headers: expect.objectContaining({ "x-gestor-acao": "transcrever", "Content-Type": "audio/x-m4a" }) })));
    await waitFor(() => expect(m.chamar).toHaveBeenCalledWith("gestor-aceleriq", expect.objectContaining({ pergunta: "Como está a Acerbi nesta semana?", audio: { segundos: 42 } })));
    expect(await screen.findByText(/Áudio 0:42/)).toBeTruthy();
  });
});

describe("Central de Autonomia: conversas, ações, Hermes e Mesas", () => {
  // Cada conversa tem dois botões com o título (abrir e arquivar): abre pelo que não é "Arquivar".
  const abrirConversa = async (titulo: string) => {
    const botoes = await screen.findAllByRole("button", { name: new RegExp(titulo) });
    return botoes.find((b) => !/^Arquivar/.test(b.getAttribute("aria-label") || ""))!;
  };
  const conversas = [
    { id: "c-acerbi", client_id: "39ebda82", project_id: null, titulo: "Campanha de outubro", resumo: null, cliente_nome: "Acerbi", arquivada_em: null, atualizado_em: "2026-10-08T12:00:00Z" },
    { id: "c-geral", client_id: null, project_id: null, titulo: "Semana da agência", resumo: null, cliente_nome: null, arquivada_em: null, atualizado_em: "2026-10-07T12:00:00Z" },
  ];
  const acao = {
    tipo: "acao_agente", agente: "gestor", id: "gestor-1", resumo: "Vou criar 1 tarefa.",
    itens: [{ ref: "p1", alvo_id: "proj-1", titulo: "Institucional", detalhe: null, operacao: "criar_tarefa", rotulo: "criar tarefa", para: JSON.stringify({ titulo: "Roteiro do vídeo da palestra" }) }],
    ignorados: [], recusados: [],
  };
  const entregue = {
    ...acao, executada_em: "2026-10-08T12:01:00Z", resultados: [{ ref: "p1", alvo_id: "proj-1", titulo: "Institucional", operacao: "criar_tarefa", ok: true, desfazer: { task_id: "t-nova" } }],
    entregas: [{ ref: "p1", nome: "Roteiro do vídeo da palestra", tipo: "tarefa", cliente: "Acerbi", projeto: "Institucional", estado: "todo", id: "t-nova-0000-0000", link: "/kanban?task=t-nova", proxima: "Peça aqui para mandar a um agente, ou abra no Kanban." }],
  };
  beforeEach(() => {
    m.papel = "admin";
    m.chamar.mockReset();
    m.chamar.mockImplementation(async (_f: string, corpo: { acao: string; conversa_id?: string }) => {
      if (corpo.acao === "conversas") return { conversas };
      if (corpo.acao === "opcoes_de_contexto") return { clientes: [{ id: "39ebda82", nome: "Acerbi" }], projetos: [] };
      if (corpo.acao === "abrir_conversa") return { conversa: conversas[0], mensagens: corpo.conversa_id === "c-acerbi" ? [{ id: "m1", papel: "usuario", conteudo: "Crie a tarefa do roteiro", criado_em: "2026-10-08T12:00:00Z" }, { id: "m2", papel: "gestor", conteudo: "ok", criado_em: "2026-10-08T12:00:01Z", dados: { ...resposta, acoes: [acao], bloqueadas: [{ pedido: "Publicar o post amanhã", motivo: "Publicar é sensível.", onde: "calendario", link: "/calendario?client=39ebda82" }] } }] : [] };
      if (corpo.acao === "executar_acao") return { anexo: entregue, feitos: 1, falhas: 0 };
      if (corpo.acao === "hermes_estado") return { configurada: false };
      return resposta;
    });
  });

  it("lista as conversas por cliente, abre a escolhida com o histórico e mostra o recorte no topo do chat", async () => {
    montar();
    fireEvent.click(await abrirConversa("Campanha de outubro"));
    await waitFor(() => expect(m.chamar).toHaveBeenCalledWith("gestor-aceleriq", { acao: "abrir_conversa", conversa_id: "c-acerbi" }));
    expect(await screen.findByText("Crie a tarefa do roteiro")).toBeTruthy();
    expect(screen.getAllByText(/Acerbi · tudo com prova no OS/).length).toBeGreaterThan(0);
  });

  it("ação proposta: Confirmar executa pela função e o cartão de entrega mostra estado real, id e atalho", async () => {
    montar();
    fireEvent.click(await abrirConversa("Campanha de outubro"));
    fireEvent.click(await screen.findByRole("button", { name: /Confirmar/ }));
    await waitFor(() => expect(m.chamar).toHaveBeenCalledWith("gestor-aceleriq", expect.objectContaining({ acao: "executar_acao", mensagem_id: "m2", acao_id: "gestor-1" })));
    expect(await screen.findByText("Roteiro do vídeo da palestra")).toBeTruthy();
    expect(screen.getByText(/Estado:/).textContent).toContain("todo");
    expect(screen.getAllByRole("link", { name: /Aba nova/ }).map((l) => l.getAttribute("href"))).toContain("/kanban?task=t-nova");
    // Pedido sensível vira decisão, nunca execução.
    expect(screen.getByText("Publicar o post amanhã")).toBeTruthy();
  });

  it("Hermes sem a ponte ligada: o painel diz isso e usa o diário da coordenação (nada simulado)", async () => {
    montar();
    fireEvent.click(await screen.findByRole("tab", { name: "Hermes" }));
    expect(await screen.findByText(/abrem aqui quando a ponte do painel for ligada/)).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Sessões do Hermes" }).hasAttribute("disabled")).toBe(true);
  });

  it("Mesas abrem dentro do painel com o cliente da conversa e sem o menu do app", async () => {
    montar();
    fireEvent.click(await abrirConversa("Campanha de outubro"));
    fireEvent.click(await screen.findByRole("tab", { name: "Mesas" }));
    fireEvent.click(await screen.findByRole("button", { name: /Mesa Ads/ }));
    const quadro = await screen.findByTitle("Mesa Ads");
    expect(quadro.getAttribute("src")).toBe("/mesa-ads?client=39ebda82&embutido=1");
  });
});

describe("Central de Autonomia: contratos de fonte", () => {
  const ler = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");
  it("a Execução ganha a aba Central e o diário recebe o pedido do Gestor como instrução", () => {
    const pagina = ler("src/pages/AdminExecucao.tsx");
    expect(pagina).toContain('{ id: "central", rotulo: "Central", visoes: ["central"] }');
    expect(pagina).toContain("substituirRascunho={Boolean(diarioAberto?.contextoInicial || diarioAberto?.textoInicial)}");
    expect(ler("src/components/execucao/DiarioDaExecucao.tsx")).toContain('setTipo("instrucao")');
  });
  it("o Gestor é só admin e confere o papel antes de ler dados", () => {
    const fn = ler("supabase/functions/gestor-aceleriq/index.ts");
    const papel = fn.indexOf('rpc("has_role", { _user_id: userId, _role: "admin" })');
    expect(papel).toBeGreaterThan(0);
    expect(fn.indexOf("const chamador = await identificar(req);")).toBeLessThan(fn.indexOf("const fn = ACOES[acao];"));
  });
  it("a conversa grava as duas linhas com as MESMAS colunas (coluna faltando vira NULL no insert múltiplo)", () => {
    const fn = ler("supabase/functions/gestor-aceleriq/index.ts");
    const linhas = [...fn.matchAll(/\{ dono_id: userId, conversa_id: conversa\.id, papel: "(usuario|gestor)",([^}]*)\}/g)];
    expect(linhas).toHaveLength(2);
    const chaves = linhas.map((l) => [...l[2].matchAll(/([a-z_]+):/g)].map((x) => x[1]).filter((k) => k !== "slice").sort().join(","));
    expect(chaves[0]).toBe(chaves[1]);
  });

  it("a correção do operator_report fica fora das migrations (proposta, sem aprovação)", () => {
    expect(ler("docs/execucao/proposta-operator-report-card-parado.sql")).toContain("NÃO APLICADA");
    const migr = ler("supabase/migrations/20261008010000_gestor_aceleriq_conversa.sql");
    expect(migr).not.toMatch(/operator_status_do_card|operator_report_event|operator_expire_stale_runs/);
  });
});
