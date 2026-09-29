/**
 * Frente AG3 (29/09): agente da Central mais agêntico e sem estado perdido.
 * - Ritual pronto: Reescrever (com instrução), Publicar no portal, Enviei no
 *   grupo e Abrir a ficha, sem sair do agente.
 * - Aplicar de novo não reaplica as respostas no dossiê: sem ritual, só
 *   escreve o ritual; com rascunho salvo, só publica.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({ listar: vi.fn(), preparar: vi.fn(), aplicar: vi.fn(), publicar: vi.fn(), reescrever: vi.fn() }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" }, profile: { role: "admin" } }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: vi.fn(), functions: { invoke: vi.fn() } } }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }));
vi.mock("@/components/central/agenteCentralApi", () => ({
  listarClientesDoAgente: mock.listar,
  prepararCliente: mock.preparar,
  aplicarRespostas: mock.aplicar,
  salvarEPublicarRitual: mock.publicar,
  reescreverRitual: mock.reescrever,
  criarTarefaDoRitual: vi.fn(),
}));

import AgenteDaCentral from "@/components/central/AgenteDaCentral";
import { CHAVE_LOCAL, type ItemDaRodada, type Rodada } from "@/components/central/rodadaDoAgente";

const ritual = (body: string) => ({ tipo: "meio_semana", title: "Meio da semana", body, next_steps: "", alertas: [], tarefas_sugeridas: [], model: null, repeticao: null, fase: null });
const preparo = {
  client_id: "a", nome: "Verzelo", contato: "", fase: "executar", motivo_da_fase: "",
  leitura: { onde_estamos: "Semana boa.", fase: { nome: "Executar", motivo: "", proximo_degrau: "" }, o_que_andou: [], pendencias: [], proximos: [], lacunas: [] },
  perguntas: [{ pergunta: "A verba foi reposta?", por_que: "" }], dossie_versao: 3, dossie_aviso: null,
};
const aplicado = (r: ReturnType<typeof ritual> | null) => ({ client_id: "a", nome: "Verzelo", dossie_versao: 4, dossie_aviso: null, confirmacoes: [], aprovacao: { por: "u1", em: "", via: "" }, ritual: r });
const item = (mudar: Partial<ItemDaRodada>): ItemDaRodada => ({
  cliente: { id: "a", nome: "Verzelo", contato: "", dossie_versao: 3, dossie_em: null }, incluir: true, situacao: "pronto", preparo,
  respostas: ["Sim."], contexto: "", aplicado: aplicado(ritual("Oi, Verzelo.")), reportId: "rep-1", publicado: false, tarefasCriadas: [], erro: null, ...mudar,
});
const rodada = (itens: ItemDaRodada[]): Rodada => ({ ritual: "meio_semana", publicar: true, contextoGeral: "", itens, iniciadaEm: "2026-09-29T10:00:00Z" });

function montar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<MemoryRouter><QueryClientProvider client={qc}><AgenteDaCentral /></QueryClientProvider></MemoryRouter>);
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
});

describe("ritual pronto: ações sem sair do agente", () => {
  it("rascunho mostra Reescrever, Publicar no portal, Enviei no grupo e Abrir a ficha; Enviei no grupo registra pelo rascunho", async () => {
    window.localStorage.setItem(CHAVE_LOCAL, JSON.stringify(rodada([item({})])));
    mock.publicar.mockResolvedValue({ reportId: "rep-1", publicado: true, avisos: [] });
    montar();
    fireEvent.click(screen.getByRole("button", { name: /Atualizar todos/ }));
    await screen.findByRole("dialog");
    expect(screen.getByText("Oi, Verzelo.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Abrir a ficha/ })).toHaveAttribute("href", "/clientes?client=a");
    expect(screen.getByRole("button", { name: /Publicar no portal/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Enviei no grupo/ }));
    await waitFor(() => expect(mock.publicar).toHaveBeenCalledTimes(1));
    expect(mock.publicar.mock.calls[0][0]).toMatchObject({ clientId: "a", reportId: "rep-1", canal: "grupo", publicar: true });
    await screen.findByText("Enviado no grupo");
    expect(screen.queryByRole("button", { name: /Enviei no grupo/ })).not.toBeInTheDocument();
  });

  it("Reescrever com instrução pede outra versão (com a anterior) e ela nasce rascunho", async () => {
    window.localStorage.setItem(CHAVE_LOCAL, JSON.stringify(rodada([item({ publicado: true, canal: "portal" })])));
    mock.reescrever.mockResolvedValue({ ritual: ritual("Versão nova, curta."), ritual_erro: null, aprendizado: [] });
    mock.publicar.mockResolvedValue({ reportId: "rep-2", publicado: false, avisos: [] });
    montar();
    fireEvent.click(screen.getByRole("button", { name: /Atualizar todos/ }));
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: /Reescrever/ }));
    fireEvent.change(screen.getByRole("textbox", { name: "Como reescrever o ritual de Verzelo" }), { target: { value: "Mais curto." } });
    fireEvent.click(screen.getByRole("button", { name: /Escrever de novo/ }));
    await waitFor(() => expect(mock.reescrever).toHaveBeenCalledWith({ clientId: "a", ritual: "meio_semana", instrucao: "Mais curto.", anterior: "Oi, Verzelo." }));
    await screen.findByText("Versão nova, curta.");
    await waitFor(() => expect(mock.publicar).toHaveBeenCalledWith(expect.objectContaining({ clientId: "a", publicar: false })));
    expect(screen.getByText("Rascunho na fila da Central")).toBeInTheDocument();
  });
});

describe("aplicar de novo sem duplicar o dossiê", () => {
  it("já aplicado e sem ritual: Aplicar só escreve o ritual (não chama aplicar de novo) e publica", async () => {
    window.localStorage.setItem(CHAVE_LOCAL, JSON.stringify(rodada([item({ situacao: "erro", aplicado: aplicado(null), reportId: null, erro: "sem ritual" })])));
    mock.reescrever.mockResolvedValue({ ritual: ritual("Agora saiu."), ritual_erro: null });
    mock.publicar.mockResolvedValue({ reportId: "rep-3", publicado: true, avisos: [] });
    montar();
    fireEvent.click(screen.getByRole("button", { name: /Atualizar todos/ }));
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: /Aplicar e publicar/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Aplicar respostas e publicar" }));
    await waitFor(() => expect(mock.publicar).toHaveBeenCalledTimes(1));
    expect(mock.aplicar).not.toHaveBeenCalled();
    expect(mock.reescrever).toHaveBeenCalledWith({ clientId: "a", ritual: "meio_semana" });
    expect(mock.publicar.mock.calls[0][0]).toMatchObject({ ritual: expect.objectContaining({ body: "Agora saiu." }), reportId: null });
  });

  it("ritual sem texto vira erro com o motivo (antes ficava Pronto, sem jeito de tentar de novo)", async () => {
    window.localStorage.setItem(CHAVE_LOCAL, JSON.stringify(rodada([item({ situacao: "perguntas", aplicado: null, reportId: null })])));
    mock.aplicar.mockResolvedValue({ ...aplicado(null), ritual_erro: "nenhum modelo respondeu" });
    montar();
    fireEvent.click(screen.getByRole("button", { name: /Atualizar todos/ }));
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: /Aplicar e publicar/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Aplicar respostas e publicar" }));
    await screen.findByText(/Motivo: nenhum modelo respondeu/);
    expect(screen.getAllByText("Não deu certo").length).toBeGreaterThan(0);
    expect(mock.publicar).not.toHaveBeenCalled();
  });
});
