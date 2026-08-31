import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  estadoQueManda, ordenarEscritorio,
  type AgenteNoEscritorio, type TrabalhoDoAgente,
} from "@/components/execucao/Escritorio";

/**
 * "Vejo eles trabalhando mas não sei direito o que é pra quem."
 *
 * O quadro por colunas é bom para auditar e ruim para entender. O
 * Escritório responde de um relance: quem está ocupado, com o quê, para
 * qual cliente — e o que está parado esperando uma decisão.
 */

const raiz = resolve(__dirname, "../..");
const ler = (rel: string) => readFileSync(resolve(raiz, rel), "utf8");

const agente = (id: string, nome: string, status = "active"): AgenteNoEscritorio =>
  ({ id, display_name: nome, role: "papel", status });

const trabalho = (op: string, status: string, updated = "2026-09-01T10:00:00Z"): TrabalhoDoAgente =>
  ({ operator_id: op, status, updated_at: updated });

describe("o estado que manda no cartão", () => {
  it("o mais urgente vence, não o mais recente", () => {
    // Um agente com uma entrega feita e outra travada está TRAVADO. Mostrar
    // "entregou" ali esconderia justamente o que precisa de ação.
    expect(estadoQueManda([trabalho("a", "done"), trabalho("a", "blocked")])).toBe("blocked");
    expect(estadoQueManda([trabalho("a", "in_progress"), trabalho("a", "review")])).toBe("review");
    expect(estadoQueManda([trabalho("a", "queued"), trabalho("a", "in_progress")])).toBe("in_progress");
  });

  it("sem trabalho devolve null, e não um estado inventado", () => {
    expect(estadoQueManda([])).toBeNull();
  });

  it("estado desconhecido não derruba nem vira o mais urgente", () => {
    expect(estadoQueManda([trabalho("a", "coisa_nova"), trabalho("a", "review")])).toBe("review");
    expect(estadoQueManda([trabalho("a", "coisa_nova")])).toBeNull();
  });
});

describe("a ordem do escritório", () => {
  it("quem precisa de você vem primeiro", () => {
    const agentes = [agente("1", "Ocupado"), agente("2", "Travado"), agente("3", "Ocioso")];
    const porAgente = new Map<string, TrabalhoDoAgente[]>([
      ["1", [trabalho("1", "in_progress")]],
      ["2", [trabalho("2", "blocked")]],
    ]);
    expect(ordenarEscritorio(agentes, porAgente).map((a) => a.display_name))
      .toEqual(["Travado", "Ocupado", "Ocioso"]);
  });

  it("ocioso vai para o fim: não disputa atenção", () => {
    const agentes = [agente("1", "Ocioso"), agente("2", "Entregou")];
    const porAgente = new Map<string, TrabalhoDoAgente[]>([["2", [trabalho("2", "done")]]]);
    expect(ordenarEscritorio(agentes, porAgente)[0].display_name).toBe("Entregou");
  });

  it("empate resolve pelo trabalho mais recente", () => {
    // Entre dois travados, o que mexeu agora ainda está quente.
    const agentes = [agente("1", "Antigo"), agente("2", "Recente")];
    const porAgente = new Map<string, TrabalhoDoAgente[]>([
      ["1", [trabalho("1", "blocked", "2026-08-01T10:00:00Z")]],
      ["2", [trabalho("2", "blocked", "2026-09-01T10:00:00Z")]],
    ]);
    expect(ordenarEscritorio(agentes, porAgente)[0].display_name).toBe("Recente");
  });

  it("não muta a lista recebida", () => {
    const agentes = [agente("1", "A"), agente("2", "B")];
    const copia = [...agentes];
    ordenarEscritorio(agentes, new Map([["2", [trabalho("2", "blocked")]]]));
    expect(agentes).toEqual(copia);
  });
});

describe("o contexto do agente no card do Kanban", () => {
  const ctx = ler("src/components/execucao/ContextoDoAgente.tsx");

  it("busca pelos dois campos de id da tarefa", () => {
    expect(ctx).toContain("kanban_task_id.eq.");
    expect(ctx).toContain("painel_task_id.eq.");
  });

  it("erro de leitura não vira 'nenhum agente trabalhou'", () => {
    // São afirmações opostas, e a segunda é forte demais para sair de uma
    // consulta que falhou.
    expect(ctx).toContain("não</strong> quer dizer que nenhum agente trabalhou");
    expect(ctx).toContain("if (erroVinculos) throw new Error(erroVinculos.message)");
  });

  it("a evidência é clicável e a imagem aparece", () => {
    // Uma URL em texto obriga a copiar e colar para conferir a entrega.
    expect(ctx).toContain("ehImagem");
    expect(ctx).toContain('alt="Comprovação da entrega"');
    expect(ctx).toContain('target="_blank" rel="noopener noreferrer"');
  });

  it("mostra o porquê e o próximo passo, não só o estado", () => {
    expect(ctx).toContain("last_action");
    expect(ctx).toContain("próximo passo:");
  });

  it("some sozinho quando nenhum agente pegou a tarefa", () => {
    expect(ctx).toContain("if (!data || !temTrabalho) return null;");
  });

  it("está montado no card do Kanban", () => {
    const drawer = ler("src/components/admin/TaskDetailDrawer.tsx");
    expect(drawer).toContain("<ContextoDoAgente taskId={task.id} />");
  });
});

describe("o Escritório é a porta de entrada", () => {
  const pagina = ler("src/pages/AdminExecucao.tsx");

  it("abre nele, e não no quadro por colunas", () => {
    expect(pagina).toContain('useState<(typeof VISOES)[number]["id"]>("escritorio")');
    expect(pagina).toMatch(/VISOES = \[\s*\{ id: "escritorio"/);
  });

  it("respeita o mesmo recorte dos filtros", () => {
    // Se o Escritório ignorasse o filtro, o número da aba discordaria do
    // que ela mostra.
    expect(pagina).toContain("trabalhos={vinculosVisiveis as any}");
  });
});
