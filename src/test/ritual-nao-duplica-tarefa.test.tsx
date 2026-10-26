import { describe, expect, it, vi, beforeEach } from "vitest";
import { acharTarefaParecida, semelhancaDeTitulo, tituloNormalizado } from "@/lib/tarefaParecida";

/**
 * 26/10/2026: o ritual recriava o mesmo próximo passo toda semana (119 abertas,
 * 106 vencidas). Antes de criar, procura tarefa aberta parecida do mesmo cliente
 * e oferece "Já existe: abrir".
 */

const banco = vi.hoisted(() => ({ tarefas: [] as Array<Record<string, unknown>>, inseridas: [] as unknown[] }));

vi.mock("@/integrations/supabase/client", () => {
  const consulta = (tabela: string) => {
    const filtros: Record<string, unknown> = {};
    const q: any = {};
    q.select = () => q;
    q.eq = (c: string, v: unknown) => { filtros[c] = v; return q; };
    q.is = () => q;
    q.in = () => q;
    q.neq = () => q;
    q.order = () => q;
    q.limit = () => q;
    q.maybeSingle = async () => {
      if (tabela === "tasks" && filtros.source) return { data: null, error: null };
      return { data: null, error: null };
    };
    q.insert = async (linha: unknown) => { banco.inseridas.push(linha); return { data: null, error: null }; };
    q.then = (ok: (v: unknown) => unknown, erro: (e: unknown) => unknown) => {
      const data = tabela === "projects" ? [{ id: "p1", status: "active" }] : tabela === "tasks" ? banco.tarefas : [];
      return Promise.resolve({ data, error: null }).then(ok, erro);
    };
    return q;
  };
  return { supabase: { from: consulta, functions: { invoke: vi.fn() } } };
});
vi.mock("@/lib/clientMemory", () => ({ recordMemory: vi.fn(async () => true) }));

import { criarTarefaDoRitual } from "@/components/central/agenteCentralApi";

const sugerida = { titulo: "Subir o novo criativo de remarketing", passo: "Subir o vídeo 2", promessa: "", prazo_dias: 3, frente: "trafego" as const };

beforeEach(() => {
  banco.tarefas = [];
  banco.inseridas = [];
});

describe("ritual não duplica tarefa", () => {
  it("título normalizado ignora acento, caixa, pontuação e palavras vazias", () => {
    expect(tituloNormalizado("Revisão dos Anúncios da semana!")).toBe("revisao anuncio");
    expect(semelhancaDeTitulo("Subir o novo criativo de remarketing", "Subir novo criativo (remarketing)")).toBe(1);
    expect(semelhancaDeTitulo("Subir o novo criativo de remarketing", "Enviar relatório mensal")).toBeLessThan(0.3);
  });

  it("acha a parecida aberta e ignora as diferentes", () => {
    const abertas = [{ id: "t1", title: "Enviar relatório mensal" }, { id: "t2", title: "Subir novo criativo remarketing (vídeo)" }];
    expect(acharTarefaParecida(sugerida.titulo, abertas)?.id).toBe("t2");
    expect(acharTarefaParecida("Gravar depoimento de cliente", abertas)).toBeNull();
  });

  it("criar com tarefa parecida aberta devolve 'parecida' e não insere", async () => {
    banco.tarefas = [{ id: "t2", title: "Subir novo criativo de remarketing", status: "todo" }];
    const r = await criarTarefaDoRitual({ clientId: "c1", reportId: "r1", indice: 0, tarefa: sugerida, userId: "u1" });
    expect(r).toBe("parecida");
    expect(banco.inseridas).toHaveLength(0);
  });

  it("sem parecida, cria; e 'criar mesmo assim' passa por cima", async () => {
    banco.tarefas = [{ id: "t9", title: "Enviar relatório mensal", status: "todo" }];
    expect(await criarTarefaDoRitual({ clientId: "c1", reportId: "r1", indice: 0, tarefa: sugerida, userId: "u1" })).toBe("criada");
    banco.tarefas = [{ id: "t2", title: "Subir novo criativo de remarketing", status: "todo" }];
    expect(await criarTarefaDoRitual({ clientId: "c1", reportId: "r1", indice: 1, tarefa: sugerida, userId: "u1", mesmoAssim: true })).toBe("criada");
    expect(banco.inseridas).toHaveLength(2);
  });

  it("a tela oferece 'Já existe: abrir' no lugar de criar", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const tela = readFileSync(resolve(__dirname, "../..", "src/components/central/AgenteDaCentral.tsx"), "utf8");
    expect(tela).toContain("Já existe: abrir");
    expect(tela).toContain("/kanban?task=");
    expect(tela).toContain("acharTarefaParecida(t.titulo");
  });
});
