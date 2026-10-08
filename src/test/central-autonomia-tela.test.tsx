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

const m = vi.hoisted(() => ({ chamar: vi.fn(), papel: "admin" as string }));

vi.mock("@/lib/mesa/api", async (orig) => ({ ...(await orig<typeof import("@/lib/mesa/api")>()), chamarFuncao: m.chamar }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { role: m.papel }, user: { id: "u1" } }) }));
vi.mock("@/integrations/supabase/client", () => {
  // Qualquer cadeia do PostgREST resolve vazia (indicadores e histórico sem dados).
  const cadeia: any = new Proxy(function () {}, {
    get: (_t, k) => (k === "then" ? (ok: (v: unknown) => void) => ok({ data: [], count: 0, error: null }) : cadeia),
    apply: () => cadeia,
  });
  return { supabase: { from: () => cadeia, rpc: () => cadeia, functions: { invoke: vi.fn() } } };
});

import CentralDeAutonomia from "@/components/execucao/CentralDeAutonomia";

const resposta = {
  tipo: "resposta",
  origem: "ia_conferida",
  cabecalho: "Acerbi · esta semana (05/10 a 08/10)",
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

  it("pergunta ao Gestor, mostra seções conferidas e abre a fonte com o diário", async () => {
    const { aoAbrirDiario } = montar();
    fireEvent.click(await screen.findByRole("button", { name: "O que aconteceu com a Acerbi nesta semana?" }));
    await screen.findByText("Conferido nas fontes");
    expect(m.chamar).toHaveBeenCalledWith("gestor-aceleriq", expect.objectContaining({ acao: "perguntar", pergunta: "O que aconteceu com a Acerbi nesta semana?", periodo: null }));
    expect(screen.getByText("Feito com prova")).toBeTruthy();
    expect(screen.getByText("Pendências e lacunas")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "F1" }));
    fireEvent.click(await screen.findByRole("button", { name: "Abrir diário da execução" }));
    expect(aoAbrirDiario).toHaveBeenCalledWith("4d586b2e", "Conciliar publicações confirmadas");
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
    expect(screen.getByRole("region", { name: "Decisões do CEO" })).toBeTruthy();
    await waitFor(() => expect(m.chamar).not.toHaveBeenCalled());
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
  it("a correção do operator_report fica fora das migrations (proposta, sem aprovação)", () => {
    expect(ler("docs/execucao/proposta-operator-report-card-parado.sql")).toContain("NÃO APLICADA");
    const migr = ler("supabase/migrations/20261008010000_gestor_aceleriq_conversa.sql");
    expect(migr).not.toMatch(/operator_status_do_card|operator_report_event|operator_expire_stale_runs/);
  });
});
