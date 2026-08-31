import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  agruparPorArea, estadoQueManda, ordenarEscritorio,
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

  it("some quando não há NEM trabalho NEM proposta", () => {
    // A guarda mudou de propósito: antes bastava não haver vínculo para a
    // seção sumir, e isso escondia a sugestão de responsável numa tarefa
    // que nenhum agente pegou.
    expect(ctx).toContain("if ((!data || !temTrabalho) && propostas.length === 0) return null;");
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

describe("definir responsável humano pela Execução", () => {
  const comp = ler("src/components/execucao/DefinirResponsavel.tsx");
  const pagina = ler("src/pages/AdminExecucao.tsx");

  it("só oferece gente da casa", () => {
    // Oferecer um cliente como responsável interno é erro fácil de cometer
    // e caro de desfazer.
    expect(comp).toContain('.neq("role", "client")');
  });

  it("desativado não recebe tarefa nova", () => {
    expect(comp).toContain('.is("deleted_at", null)');
  });

  it("escreve em assigned_to, e só a partir de um clique humano", () => {
    expect(comp).toContain('.from("tasks").update({ assigned_to: novoId })');
    // O agente nunca passa por aqui: quando ele acha que a tarefa é de
    // alguém, ele PROPÕE.
    expect(comp).not.toContain("operator_");
  });

  it("dá para deixar sem responsável", () => {
    expect(comp).toContain("Deixar sem responsável");
    expect(comp).toContain("definir.mutate(null)");
  });

  it("falha de leitura não vira lista vazia", () => {
    expect(comp).toContain("está ilegível");
  });

  it("está no menu do cartão da Execução", () => {
    expect(pagina).toContain("Definir responsável humano");
    expect(pagina).toContain("<DefinirResponsavel");
  });
});

describe("o registro no histórico do cliente fica visível", () => {
  const ctx = ler("src/components/execucao/ContextoDoAgente.tsx");

  it("lê a memória de projeto daquela tarefa", () => {
    // A entrega já era gravada e ninguém via: registro invisível é
    // indistinguível de registro inexistente.
    expect(ctx).toContain('.from("project_memory")');
    expect(ctx).toContain('.contains("metadata", { kanban_task_id: taskId })');
  });

  it("mostra a seção quando há registro", () => {
    expect(ctx).toContain("Registrado no histórico do cliente");
  });
});

describe("as áreas no Escritório", () => {
  it("a área que trava o dia vem primeiro, não a alfabética", () => {
    // Agrupar sem ordenar por urgência traria de volta o problema que o
    // Escritório resolve: a área travada no meio da lista.
    const agentes = [
      { id: "1", display_name: "A", role: "r", area: "Zulu", status: "active" },
      { id: "2", display_name: "B", role: "r", area: "Alfa", status: "active" },
    ];
    const porAgente = new Map<string, TrabalhoDoAgente[]>([
      ["1", [trabalho("1", "blocked")]],
      ["2", [trabalho("2", "in_progress")]],
    ]);
    expect(agruparPorArea(agentes, porAgente).map((g) => g.area)).toEqual(["Zulu", "Alfa"]);
  });

  it("área vazia vira 'Sem área', e não some", () => {
    // Inventar um rótulo bonito esconderia que o organograma está incompleto.
    const grupos = agruparPorArea(
      [{ id: "1", display_name: "A", role: "r", area: "  ", status: "active" }],
      new Map(),
    );
    expect(grupos[0].area).toBe("Sem área");
  });

  it("empate de urgência resolve alfabeticamente", () => {
    const agentes = [
      { id: "1", display_name: "A", role: "r", area: "Zulu", status: "active" },
      { id: "2", display_name: "B", role: "r", area: "Alfa", status: "active" },
    ];
    const porAgente = new Map<string, TrabalhoDoAgente[]>([
      ["1", [trabalho("1", "review")]],
      ["2", [trabalho("2", "review")]],
    ]);
    expect(agruparPorArea(agentes, porAgente).map((g) => g.area)).toEqual(["Alfa", "Zulu"]);
  });

  it("cada agente aparece uma vez só", () => {
    const agentes = [
      { id: "1", display_name: "A", role: "r", area: "X", status: "active" },
      { id: "2", display_name: "B", role: "r", area: "X", status: "active" },
      { id: "3", display_name: "C", role: "r", area: "Y", status: "active" },
    ];
    const grupos = agruparPorArea(agentes, new Map());
    expect(grupos.flatMap((g) => g.agentes.map((a) => a.id)).sort()).toEqual(["1", "2", "3"]);
  });
});

describe("a proposta de responsável é respondida no card", () => {
  const ctx = ler("src/components/execucao/ContextoDoAgente.tsx");

  it("decide pelo RPC, com aprovar e recusar", () => {
    expect(ctx).toContain('rpc("assignment_proposal_decidir"');
    expect(ctx).toContain('decisao: "aprovada"');
    expect(ctx).toContain('decisao: "rejeitada"');
  });

  it("sobrevive quando não há vínculo de agente", () => {
    // O agente pode sugerir um dono para uma tarefa que ele nem pegou;
    // sumir com a proposta esconderia a pergunta que espera resposta.
    expect(ctx).toContain("if ((!data || !temTrabalho) && propostas.length === 0) return null;");
  });
});

describe("as abas de cima da Execução", () => {
  const pagina = ler("src/pages/AdminExecucao.tsx");

  it("nenhuma visão fica órfã de aba", () => {
    // Uma visão fora de toda aba viraria conteúdo inalcançável: a faixa de
    // baixo só mostra o que pertence à aba atual.
    const blocoAbas = pagina.slice(pagina.indexOf("const ABAS = ["), pagina.indexOf("const VISOES = ["));
    const blocoVisoes = pagina.slice(pagina.indexOf("const VISOES = ["));
    const idsVisoes = [...blocoVisoes.slice(0, blocoVisoes.indexOf("] as const;"))
      .matchAll(/\{ id: "([a-z_]+)"/g)].map((m) => m[1]);
    const cobertas = new Set([...blocoAbas.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]));
    expect(idsVisoes.length).toBeGreaterThan(0);
    for (const v of idsVisoes) expect(cobertas.has(v), `visão "${v}" sem aba`).toBe(true);
  });

  it("a aba segue a visão, para deep-link não mentir", () => {
    // Notificação abre ?aprovacao=... e muda a visão direto; sem isto a aba
    // diria uma coisa e a tela outra.
    expect(pagina).toContain("const dona = ABAS.find((a) => (a.visoes as readonly string[]).includes(visao));");
  });

  it("a faixa de baixo lista só as visões da aba", () => {
    expect(pagina).toContain("{visoesDaAba.map((x) => {");
  });
});

describe("todo pop-up é central", () => {
  it("a tarefa abre dentro da Execução, sem recarregar o app", () => {
    const pagina = ler("src/pages/AdminExecucao.tsx");
    // window.open abria aba nova e recarregava tudo: a sensação era de
    // reiniciar, não de navegar.
    expect(pagina).not.toContain("window.open(");
    expect(pagina).toContain("setTarefaAberta(tarefas.get(String(id))");
    expect(pagina).toContain("<TaskDetailDrawer");
  });

  it("o card da tarefa é centralizado, e não uma gaveta lateral", () => {
    const drawer = ler("src/components/admin/TaskDetailDrawer.tsx");
    // Só o CONTÊINER importa: há um justify-end legítimo no overlay das
    // miniaturas de anexo, e reprovar por ele seria testar a coisa errada.
    const container = drawer.slice(drawer.indexOf('<div className="fixed inset-0 z-50'));
    const abertura = container.slice(0, container.indexOf("{/* Header */}"));
    expect(abertura).toContain("flex items-center justify-center");
    expect(abertura).not.toContain("slide-in-from-right");
    expect(abertura).not.toContain("justify-end");
  });

  it("projetos deixou de ser gaveta lateral", () => {
    const proj = ler("src/components/admin/ProjectDrawer.tsx");
    expect(proj).not.toContain("SheetContent");
    expect(proj).not.toContain('side="right"');
    expect(proj).toContain("<DialogContent");
  });
});
