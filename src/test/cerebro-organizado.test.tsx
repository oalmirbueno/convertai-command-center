import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { estadoDoRegistro, filtrarConhecimento, secoesDoDossie, type RegistroDeConhecimento } from "@/lib/mesa/conhecimentoDoCliente";
import { avisoDoDossie, filtrarPrioridades } from "@/lib/mesa/prioridadesConhecimento";
import type { GrupoDaFila, AcaoDaFila } from "@/lib/mesa/fila";
import CerebroDoCliente from "@/components/mesa/CerebroDoCliente";

const db = vi.hoisted(() => ({ from: vi.fn(), writes: [] as any[], writeResult: { data: null, error: null } as any, duplicate: false }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: db.from } }));
vi.mock("sonner", () => ({ toast }));
const agora = new Date("2026-10-07T12:00:00Z");
const registro = (extra: Partial<RegistroDeConhecimento> = {}): RegistroDeConhecimento => ({ id: "r1", client_id: "cliente-a", texto: "Fotografias com luz natural", agente: "diretor_arte", tipo: "preferencia", ativa: true, criado_em: "2026-10-01", ...extra });

describe("conhecimento por cliente", () => {
  it("isola cliente, busca sem acento e categoria de legado", () => {
    const registros = [registro({ texto: "Óculos sem reflexos" }), registro({ id: "r2", client_id: "cliente-b", texto: "Óculos" })];
    expect(filtrarConhecimento(registros, "cliente-a", "uso", "oculos", "arte", agora).map(r => r.id)).toEqual(["r1"]);
  });
  it("distingue histórico de revisão; plano antigo não aparece como orientação vigente", () => {
    expect(estadoDoRegistro(registro({ ativa: false }), agora)).toBe("historico");
    expect(estadoDoRegistro(registro({ substituida_por: "outro" }), agora)).toBe("historico");
    expect(estadoDoRegistro(registro({ valido_ate: "2026-10-06" }), agora)).toBe("revisar");
    expect(estadoDoRegistro(registro({ texto: "Plano do mês 2026-09: serviços" }), agora)).toBe("revisar");
    expect(estadoDoRegistro(registro({ texto: "Plano do mês 2026-11: serviços" }), agora)).toBe("uso");
  });
  it("organiza títulos existentes sem inventar conteúdo ou confirmação", () => {
    expect(secoesDoDossie("Introdução\n## Decisões\nConfirmar preço\n### Pendências\nAguardando documento")).toEqual([{ titulo: "Visão do cliente", texto: "Introdução" }, { titulo: "Decisões", texto: "Confirmar preço" }, { titulo: "Pendências", texto: "Aguardando documento" }]);
    expect(secoesDoDossie("")).toEqual([]);
  });
  it("sinaliza revisão por idade sem considerar um dossiê recente como pendência", () => {
    expect(avisoDoDossie(undefined, +agora)).toBe("Sem dossiê geral registrado");
    expect(avisoDoDossie({ updated_at: "2026-01-01" }, +agora)).toContain("90 dias");
    expect(avisoDoDossie({ updated_at: "2026-10-01" }, +agora)).toBeNull();
  });
  it("reordena prioridade após filtrar ações, preservando as ações originais", () => {
    const acao = (tipo: string, pontos: number) => ({ tipo, pontos } as AcaoDaFila);
    const grupos = [{ client_id: "a", nome: "Ótica A", acoes: [acao("resolver",90),acao("entregar",40)] },{ client_id: "b", nome: "Ótica B", acoes: [acao("entregar",62)] }] as GrupoDaFila[];
    expect(filtrarPrioridades(grupos,"otica",["entregar"]).map(g => g.client_id)).toEqual(["b","a"]);
    expect(grupos[0].acoes).toHaveLength(2);
    expect(filtrarPrioridades(grupos,"inexistente")).toEqual([]);
  });
  it("em igual urgência, o prazo de hoje vem antes de um prazo futuro", () => {
    const grupos = [{ client_id: "a", nome: "A", acoes: [{ pontos: 85, prazo: "2026-10-09" }] },{ client_id: "b", nome: "B", acoes: [{ pontos: 85, prazo: "2026-10-07" }] }] as GrupoDaFila[];
    expect(filtrarPrioridades(grupos, "").map(g => g.client_id)).toEqual(["b", "a"]);
  });
});

beforeEach(() => {
  vi.clearAllMocks(); db.writes.length = 0; db.writeResult = { data: null, error: null }; db.duplicate = false;
  db.from.mockImplementation((table: string) => {
    const q: any = {}; const filters: any[] = []; let operation = "read"; let payload: any;
    for (const method of ["select", "order", "limit"]) q[method] = () => q;
    for (const method of ["eq", "is"]) q[method] = (...args: any[]) => { filters.push([method,...args]); return q; };
    for (const method of ["update", "insert"]) q[method] = (p: any) => { operation = method; payload = p; return q; };
    const result = () => {
      if (operation !== "read") { db.writes.push({ table, operation, payload, filters }); return db.writeResult; }
      if (table === "agente_memoria") return { data: filters.some(f => f[1] === "chave") ? (db.duplicate ? [{ id: "r1" }] : []) : [registro()], error: null };
      return { data: [], error: null };
    };
    q.maybeSingle = () => Promise.resolve(operation === "read" ? { data: null, error: null } : result());
    q.single = () => Promise.resolve(result());
    q.then = (resolve: any, reject: any) => Promise.resolve(result()).then(resolve, reject);
    return q;
  });
});
const montar = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><CerebroDoCliente clientId="cliente-a" somenteMemoria /></QueryClientProvider>);
describe("gravação da memória", () => {
  it("não anuncia sucesso quando o banco altera zero linhas; escopa a gravação ao cliente", async () => {
    montar(); fireEvent.click(await screen.findByRole("button", { name: "Arquivar" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(toast.success).not.toHaveBeenCalled();
    expect(db.writes[0].filters).toContainEqual(["eq", "client_id", "cliente-a"]);
    expect(db.writes[0].filters).toContainEqual(["eq", "ativa", true]);
  });
  it("preserva registro duplicado sem inserir outra cópia", async () => {
    db.duplicate = true; montar();
    fireEvent.click(await screen.findByRole("button", { name: "Registrar" }));
    fireEvent.change(screen.getByLabelText("Conhecimento do cliente", { selector: "textarea" }), { target: { value: "Luz natural" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar conhecimento" }));
    await waitFor(() => expect(toast.info).toHaveBeenCalled());
    expect(db.writes).toHaveLength(0);
  });
  it("grava preferência com área, origem, validade e identificação do cliente", async () => {
    db.writeResult = { data: { id: "novo" }, error: null }; montar();
    fireEvent.click(await screen.findByRole("button", { name: "Registrar" }));
    fireEvent.change(screen.getByLabelText("Conhecimento do cliente", { selector: "textarea" }), { target: { value: "Usar fotografias reais" } });
    fireEvent.change(screen.getByLabelText("Área do conhecimento"), { target: { value: "foto" } });
    fireEvent.change(screen.getByLabelText("Tipo de conhecimento"), { target: { value: "preferencia" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar conhecimento" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(db.writes[0].payload).toMatchObject({ client_id: "cliente-a", agente: "diretor_arte", area: "foto", categoria: "preferencia", ativa: true, fonte: "painel" });
    expect(db.writes[0].payload.valido_ate).toBeTruthy();
  });
});
