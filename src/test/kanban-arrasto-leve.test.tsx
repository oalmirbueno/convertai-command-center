import { createElement as h } from "react";
import { act, cleanup, createEvent, fireEvent, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * EX-09 (30/09): arrastar no Kanban só redesenha os cartões afetados.
 * Antes, cada troca da posição sob o mouse mudava o estado da página e
 * redesenhava todos os cartões (1.290 tarefas ativas no banco). A contagem
 * usa o prazo do cartão (toLocaleDateString roda uma vez por cartão
 * desenhado com prazo).
 */

const TAREFAS = Array.from({ length: 240 }).map((_, i) => ({
  id: `t-${String(i).padStart(3, "0")}`,
  title: `Tarefa ${i}`,
  status: ["backlog", "doing", "review", "done"][i % 4],
  task_order: (Math.floor(i / 4) + 1) * 10,
  priority: "medium",
  due_date: "2026-10-10",
  project_id: "p-1",
  project: { name: "Projeto" },
  assigned_to: null,
  assignee: { full_name: "Ana Lima" },
  source: null,
  delivery_type: null,
  workstream: "general",
}));

vi.mock("@/hooks/useSupabaseData", () => ({
  useTasks: () => ({ data: TAREFAS, isLoading: false }),
  useTeamMembers: () => ({ data: [] }),
  useProjects: () => ({ data: [{ id: "p-1", name: "Projeto", client_id: "c-1", client: { company_name: "Cliente" } }] }),
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { role: "admin", full_name: "Admin" }, user: { id: "u-1" } }) }));
vi.mock("@/hooks/useCelular", () => ({ useCelular: () => false }));
vi.mock("@/components/admin/CreateTaskModal", () => ({ default: () => null }));
vi.mock("@/components/admin/TaskDetailDrawer", () => ({ default: () => null }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }));
const gravados = vi.hoisted(() => ({ chamadas: [] as Array<[string, unknown[]]> }));
vi.mock("@/integrations/supabase/client", () => {
  const canal: any = { on: () => canal, subscribe: () => canal };
  const consulta: any = {};
  ["select", "eq", "in", "order", "update", "maybeSingle"].forEach(
    (m) =>
      (consulta[m] = (...args: unknown[]) => {
        gravados.chamadas.push([m, args]);
        return consulta;
      }),
  );
  consulta.then = (ok: any, erro: any) => Promise.resolve({ data: [], error: null }).then(ok, erro);
  return { supabase: { channel: () => canal, removeChannel: vi.fn(), from: () => consulta, auth: { getUser: () => Promise.resolve({ data: { user: null } }) } } };
});
vi.mock("@/lib/opsTaskSync", () => ({ notifyOpsTaskUpdated: vi.fn() }));

import Kanban from "@/pages/Kanban";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** jsdom não passa clientY para o evento de arrasto: põe na mão. */
function passarPorCima(el: HTMLElement, clientY: number) {
  const ev = createEvent.dragOver(el);
  Object.defineProperty(ev, "clientY", { value: clientY });
  fireEvent(el, ev);
}

function montar(endereco = "/kanban") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(h(QueryClientProvider, { client: qc }, h(MemoryRouter, { initialEntries: [endereco] }, h(Kanban))));
}

describe("Kanban: arrastar não redesenha a tela inteira", () => {
  it("cada troca de posição sob o mouse redesenha só os cartões que mudam", async () => {
    const { container } = montar();
    await act(async () => {
      await Promise.resolve();
    });
    const cartao = (id: string) => container.querySelector(`[data-cartao-da-tarefa="${id}"] > [role="button"]`) as HTMLElement;
    expect(cartao("t-000")).toBeTruthy();
    const prazos = vi.spyOn(Date.prototype, "toLocaleDateString");
    fireEvent.dragStart(cartao("t-000"));
    const aoIniciar = prazos.mock.calls.length;
    // Passa por cima de 10 cartões da mesma coluna, alternando em cima e embaixo.
    const alvos = ["t-004", "t-008", "t-012", "t-016", "t-020", "t-024", "t-028", "t-032", "t-036", "t-040"];
    alvos.forEach((id, k) => {
      const el = cartao(id);
      el.getBoundingClientRect = () => ({ top: 0, bottom: 100, height: 100, left: 0, right: 100, width: 100, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
      passarPorCima(el, k % 2 ? 80 : 20);
    });
    const duranteArrasto = prazos.mock.calls.length - aoIniciar;
    // eslint-disable-next-line no-console
    console.log(`[EX-09] cartões na tela=${TAREFAS.length} desenhos de cartão ao iniciar=${aoIniciar} em 10 passagens=${duranteArrasto}`);
    // A linha de destino aparece no cartão certo.
    expect(container.querySelector(`[data-cartao-da-tarefa="t-040"] > .mt-1.h-0\\.5`)).toBeTruthy();
    expect(container.querySelectorAll(".h-0\\.5.rounded-full.bg-primary").length).toBe(1);
    // Antes: 240 cartões por passagem (2.400). Agora: no máximo os dois que mudam por passagem.
    expect(duranteArrasto).toBeLessThanOrEqual(2 * alvos.length);
    fireEvent.dragEnd(cartao("t-000"));
  });

  it("soltar na metade de cima de um cartão põe a tarefa antes dele (mesma conta de antes)", async () => {
    const { container } = montar();
    await act(async () => {
      await Promise.resolve();
    });
    const cartao = (id: string) => container.querySelector(`[data-cartao-da-tarefa="${id}"] > [role="button"]`) as HTMLElement;
    fireEvent.dragStart(cartao("t-000"));
    const alvo = cartao("t-008");
    alvo.getBoundingClientRect = () => ({ top: 0, bottom: 100, height: 100, left: 0, right: 100, width: 100, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    passarPorCima(alvo, 10);
    gravados.chamadas.length = 0;
    await act(async () => {
      fireEvent.drop(cartao("t-008"));
      await Promise.resolve();
    });
    const ids = gravados.chamadas.filter(([m, a]) => m === "eq" && a[0] === "id").map(([, a]) => a[1]);
    expect(ids.slice(0, 4)).toEqual(["t-004", "t-000", "t-008", "t-012"]);
    const ordens = gravados.chamadas.filter(([m]) => m === "update").map(([, a]) => (a[0] as { task_order: number }).task_order);
    expect(ordens.slice(0, 4)).toEqual([10, 20, 30, 40]);
  });
});

/**
 * 16/10/2026 (dono): "não consigo clicar no card e arrastar; tenho que ir no
 * pontinho". O link "Abrir Kanban central" da Agenda chega com ?area= e os
 * filtros ficam lembrados: o arrasto ficava desligado sem aviso e só o menu
 * de três pontos movia. Agora o cartão inteiro arrasta também com filtro
 * (troca de coluna, entrando no fim da coluna inteira); só a ordem dentro da
 * coluna pede os filtros limpos.
 */
describe("Kanban: o cartão inteiro arrasta também com filtro", () => {
  it("com filtro de área, arrastar para outra coluna muda a coluna e põe no fim dela", async () => {
    const { container } = montar("/kanban?area=general");
    await act(async () => {
      await Promise.resolve();
    });
    const cartao = container.querySelector('[data-cartao-da-tarefa="t-000"] > [role="button"]') as HTMLElement;
    expect(cartao.getAttribute("draggable")).toBe("true");
    const setData = vi.fn();
    fireEvent.dragStart(cartao, { dataTransfer: { setData, effectAllowed: "" } });
    expect(setData).toHaveBeenCalledWith("text/plain", "t-000");
    gravados.chamadas.length = 0;
    const coluna = container.querySelector('section[aria-label="Em Andamento"]') as HTMLElement;
    await act(async () => {
      fireEvent.drop(coluna);
      await Promise.resolve();
    });
    const updates = gravados.chamadas.filter(([m]) => m === "update").map(([, a]) => a[0]);
    // A maior ordem da coluna "Em Andamento" é 600: a tarefa entra com 610, sem renumerar as outras.
    expect(updates[0]).toEqual({ status: "doing", task_order: 610 });
    expect(updates.length).toBe(1);
    const status = gravados.chamadas.filter(([m, a]) => m === "eq" && a[0] === "status").map(([, a]) => a[1]);
    expect(status[0]).toBe("backlog");
  });

  it("com filtro, soltar na mesma coluna não reordena (avisa para limpar os filtros)", async () => {
    const { toast } = await import("sonner");
    const { container } = montar("/kanban?area=general");
    await act(async () => {
      await Promise.resolve();
    });
    const cartao = (id: string) => container.querySelector(`[data-cartao-da-tarefa="${id}"] > [role="button"]`) as HTMLElement;
    fireEvent.dragStart(cartao("t-000"));
    gravados.chamadas.length = 0;
    await act(async () => {
      fireEvent.drop(cartao("t-008"));
      await Promise.resolve();
    });
    expect(gravados.chamadas.filter(([m]) => m === "update").length).toBe(0);
    expect(toast.info).toHaveBeenCalled();
  });
});
