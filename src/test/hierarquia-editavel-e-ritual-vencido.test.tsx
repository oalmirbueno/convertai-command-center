import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fireEvent, render, screen } from "@testing-library/react";
import { createElement as h } from "react";
import OrganogramaAgentes, { type NoDoOrganograma } from "@/components/execucao/OrganogramaAgentes";
import { SEM_AREA, colocarNoGrupo, ordemParaGravar, passoNoGrupo } from "@/lib/hierarquiaDosAgentes";
import { descendentesDe } from "@/components/execucao/EditarAgente";
import { reviewExpired, reviewLane, type CentralApproval, type ReviewReport } from "@/lib/centralReview";

// 10/11/2026 (dono): editar, apagar e organizar os agentes; origem e última execução no cartão; filtro de
// aposentados; e o ritual aprovado que venceu sem envio (SKC, 07 a 09/11).
const ler = (c: string) => readFileSync(resolve(process.cwd(), c), "utf8");
const AGENTES = ler("supabase/migrations/20261110233000_agentes_origem_execucao_e_organizacao.sql");
const RITUAL = ler("supabase/migrations/20261110233100_ritual_vencido_e_vigia_do_envio.sql");

const nos: NoDoOrganograma[] = [
  { id: "j", nome: "Jori", papel: "coordena os bots", funcao: "Coordenação", nivel: "coordenador", ativo: true, area: "Coordenação", origem: "grok" },
  { id: "c", nome: "Clio", papel: "lê os grupos", funcao: "Conversas dos Clientes", nivel: "operador", ativo: true, area: "Clientes", origem: "hermes", ultimaVez: new Date(Date.now() - 3 * 3_600_000).toISOString() },
  { id: "e", nome: "Elo", papel: "contexto", funcao: "Contexto dos Clientes", nivel: "operador", ativo: true, area: "Clientes", origem: "grok" },
  { id: "o", nome: "Orion", papel: "conteúdo", funcao: "Conteúdo", nivel: "operador", ativo: true, area: "Conteúdo", origem: "grok" },
  { id: "r", nome: "Revisor", papel: "revisa", funcao: "Revisão", nivel: "operador", ativo: true, area: "Paperclip", origem: "paperclip" },
  { id: "v", nome: "Vértice", papel: "carteira", funcao: "Carteira e Prazos", nivel: "operador", ativo: false, aposentado: true, area: "Operações", origem: "hermes" },
];
const montar = (extra: Record<string, unknown> = {}) => render(h(OrganogramaAgentes, { nos, nomeDoDono: "Almir", aoAbrir: () => undefined, ...extra }));

describe("contas da ordem dos agentes", () => {
  const g = [{ id: "a" }, { id: "b" }, { id: "c" }];
  it("coloca o movido antes do alvo, ou no fim sem alvo", () => {
    expect(colocarNoGrupo(g, { id: "c" }, "a").map((x) => x.id)).toEqual(["c", "a", "b"]);
    expect(colocarNoGrupo(g, { id: "x" }, "b").map((x) => x.id)).toEqual(["a", "x", "b", "c"]);
    expect(colocarNoGrupo(g, { id: "a" }, null).map((x) => x.id)).toEqual(["b", "c", "a"]);
  });
  it("um passo para cima ou para baixo, e nada na ponta", () => {
    expect(passoNoGrupo(g, "b", -1)?.map((x) => x.id)).toEqual(["b", "a", "c"]);
    expect(passoNoGrupo(g, "b", 1)?.map((x) => x.id)).toEqual(["a", "c", "b"]);
    expect(passoNoGrupo(g, "a", -1)).toBeNull();
    expect(passoNoGrupo(g, "c", 1)).toBeNull();
  });
  it("grava 10, 20, 30 e a área só de quem mudou de área", () => {
    expect(ordemParaGravar(g, "b")).toEqual([{ id: "a", display_order: 10 }, { id: "b", display_order: 20 }, { id: "c", display_order: 30 }]);
    expect(ordemParaGravar(g, "b", "Clientes")[1]).toEqual({ id: "b", display_order: 20, area: "Clientes" });
    expect(ordemParaGravar(g, "b", SEM_AREA)[1]).toEqual({ id: "b", display_order: 20, area: null });
  });
  it("o superior não pode ser o próprio agente nem quem responde a ele", () => {
    const todos = [{ slug: "a", parent_slug: null }, { slug: "b", parent_slug: "a" }, { slug: "c", parent_slug: "b" }, { slug: "d", parent_slug: null }];
    expect([...descendentesDe("a", todos)].sort()).toEqual(["a", "b", "c"]);
    expect([...descendentesDe("d", todos)]).toEqual(["d"]);
  });
});

describe("hierarquia: cartão, filtro e organização", () => {
  it("o cartão mostra função, origem e a última execução (ou que ainda não houve)", () => {
    montar();
    expect(screen.getByText("Conversas dos Clientes")).toBeTruthy();
    expect(document.querySelector('[data-agente="c"] [data-origem="hermes"]')?.textContent).toBe("Hermes");
    expect(document.querySelector('[data-agente="e"] [data-origem="grok"]')?.textContent).toBe("Grok");
    expect(document.querySelector('[data-agente="r"] [data-origem="paperclip"]')?.textContent).toBe("Paperclip");
    expect(document.querySelector('[data-agente="c"]')?.textContent).toContain("livre · última vez há 3 h");
    expect(document.querySelector('[data-agente="e"] [data-sem-execucao]')?.textContent).toBe("sem execução ainda");
  });

  it("aposentado fica escondido até pedir para ver", () => {
    montar();
    expect(screen.queryByText("Vértice")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Ver aposentados \(1\)/ }));
    expect(screen.getByText("Vértice")).toBeTruthy();
    expect(document.querySelector('[data-agente="v"]')?.textContent).toContain("aposentado");
    fireEvent.click(screen.getByRole("button", { name: "Esconder aposentados" }));
    expect(screen.queryByText("Vértice")).toBeNull();
  });

  it("sem ser admin não há lápis nem arrastar", () => {
    montar();
    expect(screen.queryByRole("button", { name: "Editar Clio" })).toBeNull();
    expect(document.querySelector('[data-agente="c"]')?.getAttribute("draggable")).toBeNull();
  });

  it("o admin abre a edição pelo lápis, sem abrir o agente", () => {
    const aoEditar = vi.fn();
    const aoAbrir = vi.fn();
    montar({ podeOrganizar: true, aoEditar, aoMover: () => undefined, aoAbrir });
    fireEvent.click(screen.getByRole("button", { name: "Editar Clio" }));
    expect(aoEditar).toHaveBeenCalledWith(expect.objectContaining({ id: "c" }));
    expect(aoAbrir).not.toHaveBeenCalled();
    // O dono e o Hermes não são agentes editáveis.
    expect(screen.queryByRole("button", { name: "Editar Hermes" })).toBeNull();
  });

  const dt = { effectAllowed: "", setData: () => undefined };
  it("arrastar para cima de outro da mesma área só reordena", () => {
    const aoMover = vi.fn();
    montar({ podeOrganizar: true, aoEditar: () => undefined, aoMover });
    fireEvent.dragStart(document.querySelector('[data-agente="e"]')!, { dataTransfer: dt });
    fireEvent.dragOver(document.querySelector('[data-agente="c"]')!, { dataTransfer: dt });
    fireEvent.drop(document.querySelector('[data-agente="c"]')!, { dataTransfer: dt });
    expect(aoMover).toHaveBeenCalledWith([{ id: "e", display_order: 10 }, { id: "c", display_order: 20 }]);
  });

  it("arrastar para cima de um agente de outra área muda a área", () => {
    const aoMover = vi.fn();
    montar({ podeOrganizar: true, aoEditar: () => undefined, aoMover });
    fireEvent.dragStart(document.querySelector('[data-agente="o"]')!, { dataTransfer: dt });
    fireEvent.dragOver(document.querySelector('[data-agente="e"]')!, { dataTransfer: dt });
    fireEvent.drop(document.querySelector('[data-agente="e"]')!, { dataTransfer: dt });
    expect(aoMover).toHaveBeenCalledWith([{ id: "c", display_order: 10 }, { id: "o", display_order: 20, area: "Clientes" }, { id: "e", display_order: 30 }]);
  });

  it("soltar no título de uma área leva para o fim dela; coordenador não vira agente pelo arrastar", () => {
    const aoMover = vi.fn();
    montar({ podeOrganizar: true, aoEditar: () => undefined, aoMover });
    fireEvent.dragStart(document.querySelector('[data-agente="o"]')!, { dataTransfer: dt });
    fireEvent.drop(screen.getByRole("region", { name: "Clientes" }), { dataTransfer: dt });
    expect(aoMover).toHaveBeenCalledWith([{ id: "c", display_order: 10 }, { id: "e", display_order: 20 }, { id: "o", display_order: 30, area: "Clientes" }]);
    aoMover.mockClear();
    fireEvent.dragStart(document.querySelector('[data-agente="j"]')!, { dataTransfer: dt });
    fireEvent.drop(document.querySelector('[data-agente="c"]')!, { dataTransfer: dt });
    expect(aoMover).not.toHaveBeenCalled();
  });
});

describe("agentes no banco", () => {
  it("o gatilho do registro do MCP nunca derruba a auditoria e ignora leitura e alvo", () => {
    expect(AGENTES).toContain("AFTER INSERT ON public.mcp_audit_log");
    expect(AGENTES).toContain("EXCEPTION WHEN OTHERS THEN");
    expect(AGENTES).toContain("app_private.mcp_ferramenta_e_leitura(NEW.tool_name)");
    expect(AGENTES).toContain("'aceleriq_operator_assign'");
    expect(AGENTES).toContain("interval '5 minutes'");
  });
  it("o registro explícito não é aberto a quem está logado nem ao anônimo", () => {
    expect(AGENTES).toContain("REVOKE ALL ON FUNCTION public.operador_registrar_execucao(text, timestamptz) FROM PUBLIC, anon, authenticated;");
    expect(AGENTES).toContain("TO acq_n8n_worker");
  });
  it("organizar e apagar conferem o admin; apagar recusa quem tem histórico ou chave", () => {
    expect(AGENTES.match(/has_role\(\(SELECT auth\.uid\(\)\), 'admin'::public\.app_role\)/g)?.length).toBeGreaterThanOrEqual(3);
    expect(AGENTES).toContain("OPERADOR_COM_HISTORICO");
    expect(AGENTES).toContain("OPERADOR_COM_CHAVE");
    expect(AGENTES).not.toMatch(/DELETE FROM public\.operator_audit_log/);
  });
  it("cadastra os bots do Grok sem sobrescrever quem já existe", () => {
    for (const bot of ["orion", "trafe", "infra", "garim", "soci", "drop", "nomi", "money"]) expect(AGENTES).toContain(`('${bot}',`);
    expect(AGENTES).toContain("ON CONFLICT (slug) DO NOTHING");
  });
});

describe("ritual aprovado que vence sem envio", () => {
  const report: ReviewReport = { id: "r", client_id: "c", title: "t", created_at: "2026-11-02T00:00:00Z", review_version: 2, summary: "m", next_steps: "p", metrics: { central_review_source: {} } };
  const base = { id: "a", report_id: "r", client_id: "c", payload_version: 2, payload_hash: "h", status: "aprovado", created_at: "2026-11-02T00:00:00Z", valid_until: "2026-11-09T11:26:00Z", payload: { report, destination: { channel: "whatsapp", recipient: "g" } } } as CentralApproval;

  it("aprovado ou pendente vencido vai para a faixa Venceram, não para Precisa decisão", () => {
    expect(reviewExpired(base)).toBe(true);
    expect(reviewLane(report, base)).toBe("vencido");
    expect(reviewLane(report, { ...base, status: "pendente" })).toBe("vencido");
    expect(reviewLane(report, { ...base, valid_until: new Date(Date.now() + 3_600_000).toISOString() })).toBe("aguardando");
  });
  it("o que foi enviado nunca vence", () => {
    const enviado = { ...base, executed_at: "2026-11-08T10:00:00Z" };
    expect(reviewExpired(enviado)).toBe(false);
    expect(reviewLane(report, enviado)).toBe("enviado");
  });
  it("a fila não oferece enviar o aprovado vencido", () => {
    const fila = ler("src/components/central/CentralReviewQueue.tsx");
    expect(fila).toContain('approval.status === "aprovado" && !approval.executed_at && !expired');
    expect(fila).toContain('{ value: "vencido", label: "Venceram" }');
    expect(fila).toContain("Não envie este texto");
  });
  it("o agente deixa de receber o aprovado vencido para enviar e é avisado de não enviar", () => {
    expect(RITUAL).toMatch(/a\.status = 'aprovado' AND a\.executed_at IS NULL AND a\.invalidated_at IS NULL\s+AND \(a\.valid_until IS NULL OR a\.valid_until > now\(\)\)/);
    expect(RITUAL).toContain("'vencidos_sem_envio', _vencidos");
    expect(RITUAL).toContain("vencidos_sem_envio: NAO envie");
  });
  it("o vigia avisa o dono uma vez por dia e não fala com cliente", () => {
    for (const tipo of ["ritual_aprovado_sem_envio", "ritual_vence_sem_decisao", "ritual_sem_lote"]) expect(RITUAL).toContain(`'${tipo}'`);
    expect(RITUAL).toContain("cron.schedule('ritual-vigiar-envio'");
    expect(RITUAL).toContain("ur.role = 'admin'");
    expect(RITUAL).not.toMatch(/whatsapp_send|evolution|net\.http_post/i);
  });
});

// Segunda rodada (10/11, dono): os dois Mercúrios, Rafael do n8n, Claude Code, Codex e Dot; criar e
// excluir pelo painel; o Hermes não aparece repetido.
describe("elenco completo, criar e excluir", () => {
  const ELENCO = ler("supabase/migrations/20261110234000_agentes_origens_novas_e_elenco.sql");
  const EDITAR = ler("src/components/execucao/EditarAgente.tsx");

  it("o identificador nasce do nome, sem acento e sem repetir", async () => {
    const { slugDoNome } = await import("@/lib/hierarquiaDosAgentes");
    expect(slugDoNome("Mercúrio (Grok)", [])).toBe("mercurio-grok");
    expect(slugDoNome("Rafael", ["rafael", "rafael-2"])).toBe("rafael-3");
    expect(slugDoNome("  ", [])).toBe("agente");
  });

  it("o Hermes do banco ocupa a caixa do Hermes e não aparece de novo entre os coordenadores", () => {
    const comHermes: NoDoOrganograma[] = [...nos, { id: "h", nome: "Hermes Core", papel: "orquestra", funcao: "Orquestração central", nivel: "coordenador", ativo: true, area: "Core", origem: "hermes", porta: true }];
    const aoAbrir = vi.fn();
    render(h(OrganogramaAgentes, { nos: comHermes, nomeDoDono: "Almir", aoAbrir }));
    expect(screen.queryByText("Hermes Core")).toBeNull();
    expect(document.querySelector('[data-coordenadores] [data-agente="h"]')).toBeNull();
    fireEvent.click(screen.getByTitle("Porta de entrada · recebe, organiza e responde no grupo"));
    expect(aoAbrir).toHaveBeenCalledWith(expect.objectContaining({ id: "h" }));
  });

  it("um toque na origem mostra só aquela; outro toque volta a todas", () => {
    montar();
    const grupo = screen.getByRole("group", { name: "Filtrar por origem" });
    const grok = [...grupo.querySelectorAll("button")].find((b) => /^Grok/.test(b.textContent || ""))!;
    expect(grok.textContent).toBe("Grok3");
    fireEvent.click(grok);
    expect(screen.queryByText("Clio")).toBeNull();
    expect(screen.getByText("Elo")).toBeTruthy();
    fireEvent.click(grok);
    expect(screen.getByText("Clio")).toBeTruthy();
  });

  it("só o admin vê Novo agente, e ele abre o cadastro", () => {
    const aoCriar = vi.fn();
    montar({ podeOrganizar: true, aoEditar: () => undefined, aoMover: () => undefined, aoCriar });
    fireEvent.click(screen.getByRole("button", { name: "Novo agente" }));
    expect(aoCriar).toHaveBeenCalled();
  });
  it("sem ser admin não há Novo agente", () => {
    montar({ aoCriar: () => undefined });
    expect(screen.queryByRole("button", { name: "Novo agente" })).toBeNull();
  });

  it("excluído aparece com o nome certo quando se pede para ver", () => {
    const comExcluido: NoDoOrganograma[] = [...nos, { id: "x", nome: "Antigo", papel: "x", nivel: "operador", ativo: false, aposentado: true, excluido: true, area: "Operações", origem: "hermes" }];
    render(h(OrganogramaAgentes, { nos: comExcluido, nomeDoDono: "Almir", aoAbrir: () => undefined }));
    fireEvent.click(screen.getByRole("button", { name: /Ver aposentados \(2\)/ }));
    expect(document.querySelector('[data-agente="x"]')?.textContent).toContain("excluído");
  });

  it("excluir vale para todos: sem rastro apaga, com rastro tira da hierarquia e guarda o histórico", () => {
    expect(EDITAR).toContain('rpc("operador_apagar_de_vez"');
    expect(EDITAR).toContain('update({ status: "inactive" })');
    expect(EDITAR).toContain("Sim, excluir");
    expect(EDITAR).not.toMatch(/operator_audit_log/);
  });
  it("criar não pede campo técnico: slug e referência saem do nome e da origem", () => {
    expect(EDITAR).toContain("slugDoNome(f.display_name");
    expect(EDITAR).toContain("hermes_profile_ref: `${origem}:${slug}`");
    expect(EDITAR).toContain("Criar agente");
  });

  it("o banco aceita as origens novas e cadastra o elenco sem sobrescrever", () => {
    for (const o of ["n8n", "claude_code", "codex", "chatgpt"]) expect(ELENCO).toContain(`'${o}'`);
    for (const a of ["mercurio-grok", "rafael", "claude-code", "codex", "dot"]) expect(ELENCO).toContain(`('${a}',`);
    expect(ELENCO).toContain("UPDATE public.internal_operators SET origem = 'hermes' WHERE slug = 'mercurio';");
    expect(ELENCO).toContain("ON CONFLICT (slug) DO NOTHING");
    expect(ELENCO).toContain("operador_marcar_execucao('rafael'");
    expect(ELENCO).not.toMatch(/operator_key_bindings|GRANT /);
  });
});
