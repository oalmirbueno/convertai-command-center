import { createElement as h } from "react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 18/11/2026: tela /escritorio. A equipe vê o organograma com plataforma e
 * grau, as conversas dos agentes, as salas, as automações e os acessos. Só o
 * dono (admin) escreve, e sempre pelos RPCs do banco ou pelas tabelas que a
 * política deixa.
 * 19/11: a tela abre no "Agora" (cartões de quem está aqui e a caixa), os
 * números do dia em StatCard e a ficha do agente no centro, com as ações do
 * dono (grau, bloquear, desbloquear, ligar credencial, mandar mensagem).
 */

const haMin = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
type Linha = Record<string, any>;

let papel = "admin";
let tabelas: Record<string, Linha[]> = {};
const escritas: Array<{ tabela: string; modo: string; dados: Linha | null; filtros: Record<string, unknown> }> = [];
const leiturasFeitas: string[] = [];
const aoVivo: Array<{ filtro: Linha; avisar: () => void }> = [];
const rpc = vi.fn(async (nome: string, _args?: Linha): Promise<{ data: unknown; error: { message: string } | null }> => {
  if (nome === "escritorio_dono_enviar") return { data: { ok: true, mensagem_id: "nova", conversa_id: "c1" }, error: null };
  if (nome === "escritorio_bloquear_agente") return { data: { ok: true, chaves_desligadas: 1, vinculos_retirados: 1 }, error: null };
  if (nome === "escritorio_desbloquear_agente") return { data: { ok: true, vinculos_devolvidos: 1, chaves_que_nao_voltam: 1 }, error: null };
  return { data: { ok: true }, error: null };
});

/** Banco de mentira: só o que a tela usa (ler com filtro de igualdade e gravar). */
function consulta(tabela: string) {
  const filtros: Record<string, unknown> = {};
  let modo = "select";
  let dados: Linha | null = null;
  const q: any = {
    select: () => q,
    order: () => q,
    limit: () => q,
    // Filtro em recurso embutido ("leituras.leitor_slug") não corta a linha de cima.
    eq: (c: string, v: unknown) => { if (c.indexOf(".") < 0) filtros[c] = v; return q; },
    is: (c: string, v: unknown) => { filtros[c] = v; return q; },
    insert: (linha: Linha) => { modo = "insert"; dados = linha; return q; },
    update: (linha: Linha) => { modo = "update"; dados = linha; return q; },
    delete: () => { modo = "delete"; return q; },
    then: (ok: (r: unknown) => unknown) => {
      if (modo !== "select") {
        escritas.push({ tabela, modo, dados, filtros });
        return Promise.resolve(ok({ data: null, error: null }));
      }
      leiturasFeitas.push(tabela);
      const linhas = (tabelas[tabela] ?? []).filter((l) => Object.keys(filtros).every((c) => (l[c] ?? null) === filtros[c]));
      return Promise.resolve(ok({ data: linhas, error: null }));
    },
  };
  return q;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (tabela: string) => consulta(tabela),
    rpc: (nome: string, args?: Linha) => rpc(nome, args),
    channel: () => {
      const canal: any = {
        on: (_evento: string, filtro: Linha, avisar: () => void) => { aoVivo.push({ filtro, avisar }); return canal; },
        subscribe: () => canal,
      };
      return canal;
    },
    removeChannel: () => undefined,
  },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u-1" }, profile: { id: "u-1", role: papel, full_name: "Almir" } }) }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

import AdminEscritorio from "@/pages/AdminEscritorio";

const CHAVE = "27901254-b463-4f6c-8c39-92bd1884a250";
const agente = (id: string, slug: string, nome: string, extra: Linha = {}) => ({
  id, slug, display_name: nome, role: "Social media", scope: "Cuida do conteúdo", status: "active", area: "Conteúdo", parent_slug: null,
  display_order: 10, origem: "hermes", is_coordinator: false, last_run_at: null, hermes_profile_ref: `hermes:${slug}`, grau: "executor", ...extra,
});

function banco(): Record<string, Linha[]> {
  return {
    internal_operators: [
      agente("1", "jori", "Jori", { role: "Coordenação", area: "Coordenação", origem: "grok", grau: "orquestrador", is_coordinator: true, last_run_at: haMin(300) }),
      agente("2", "lia", "Lia", { last_run_at: haMin(120) }),
      agente("3", "nina", "Nina", { role: "  social   MÉDIA ", origem: "paperclip" }),
      agente("4", "fred", "Fred", { role: "Atendimento", area: "Comercial", origem: "openbot", grau: "leitor", status: "paused" }),
    ],
    escritorio_presenca: [
      { operator_slug: "lia", batimento_em: haMin(2), fazendo: "Montando o calendário da Acerbi", plataforma: "hermes" },
      { operator_slug: "jori", batimento_em: haMin(45), fazendo: "Recado velho", plataforma: "grok" },
    ],
    escritorio_grupos: [
      { id: "g1", slug: "conteudo", nome: "Conteúdo", area: "Conteúdo", descricao: "Social media e calendário.", ativo: true },
    ],
    escritorio_grupo_membros: [
      { grupo_id: "g1", operator_slug: "lia", papel: "dono_da_sala" },
      { grupo_id: "g1", operator_slug: "nina", papel: "membro" },
    ],
    escritorio_conversas: [
      { id: "c1", tipo: "direta", grupo_id: null, assunto: "Prioridade do dia", criada_por: "jori", created_at: haMin(60), ultima_em: haMin(30) },
      { id: "c2", tipo: "grupo", grupo_id: "g1", assunto: null, criada_por: "lia", created_at: haMin(20), ultima_em: haMin(4) },
    ],
    escritorio_mensagens: [
      { id: "m1", conversa_id: "c1", de_slug: "jori", de_tipo: "operador", para_slug: "dono", grupo_id: null, corpo: "Posso seguir com a pauta da Acerbi?", responde_a: null, created_at: haMin(30), leituras: [] },
      { id: "m2", conversa_id: "c2", de_slug: "lia", de_tipo: "operador", para_slug: null, grupo_id: "g1", corpo: "Calendário de dezembro pronto.", responde_a: null, created_at: haMin(4), leituras: [{ leitor_slug: "dono" }] },
    ],
    escritorio_automacoes: [],
    escritorio_bloqueios: [{ operator_slug: "fred", motivo: "respondeu cliente sem aprovação", bloqueado_em: haMin(90), desfeito_em: null }],
    operator_key_bindings: [{ principal: `key:${CHAVE}`, operator_slug: "jori", padrao: true, rotulo: "ligada no Escritório" }],
    api_keys: [
      { id: CHAVE, name: "Jori no Grok", key_preview: "ak_1a2b", audience: "mcp", is_active: true, key_hash: "NUNCA-NA-TELA" },
      { id: "k-antiga", name: "Chave antiga", key_preview: "ak_9z9z", audience: "mcp", is_active: false, key_hash: "NUNCA-NA-TELA" },
    ],
  };
}

function montar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(h(QueryClientProvider, { client: qc }, h(MemoryRouter, { initialEntries: ["/escritorio"] }, h(AdminEscritorio))));
}
const abrirAba = async (nome: string) => fireEvent.click(await screen.findByRole("tab", { name: nome }));

beforeEach(() => { papel = "admin"; tabelas = banco(); });
afterEach(() => {
  cleanup();
  rpc.mockClear();
  for (const f of Object.values(toast)) f.mockClear();
  escritas.length = 0;
  leiturasFeitas.length = 0;
  aoVivo.length = 0;
  window.localStorage.clear();
});

const abrirFicha = async (slug: string, nome: string) => {
  const linha = (await screen.findByRole("list", { name: "Acessos dos agentes" })).querySelector(`[data-acesso="${slug}"]`) as HTMLElement;
  fireEvent.click(within(linha).getByTitle(`Abrir a ficha de ${nome}`));
  return screen.findByRole("dialog");
};
const abrirMenuDaFicha = async (ficha: HTMLElement, nome: string) => {
  fireEvent.keyDown(within(ficha).getByRole("button", { name: `Mais ações de ${nome}` }), { key: "Enter" });
  return screen.findByRole("menu");
};

describe("Escritório (tela)", () => {
  it("agora: números do dia, cartões de quem está aqui (com o que faz) e a caixa com prévia; clicar abre a ficha e a conversa", async () => {
    montar();
    const numeros = await screen.findByRole("group", { name: /O escritório hoje/ });
    const cartoes = Array.from(numeros.querySelectorAll("[data-stat-card]")).map((c) => c.textContent);
    expect(cartoes[0]).toContain("Aqui agora");
    expect(cartoes[0]).toContain("1");
    expect(cartoes[0]).toContain("de 3 agentes ativos");
    expect(cartoes[1]).toContain("Não lidas");
    expect(cartoes[3]).toContain("Agentes ativos");
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Agora", "Conversas", "Organograma", "Salas", "Automações", "Acessos", "Regras"]);

    const agentes = screen.getByRole("list", { name: "Agentes do escritório" });
    const ordem = Array.from(agentes.querySelectorAll("[data-cartao-do-agente]")).map((c) => c.getAttribute("data-cartao-do-agente"));
    expect(ordem[0]).toBe("lia");
    expect(ordem).not.toContain("fred");
    expect(agentes.querySelector('[data-cartao-do-agente="lia"] [data-fazendo]')?.textContent).toBe("Montando o calendário da Acerbi");
    expect(document.body.textContent).not.toContain("Recado velho");

    const caixa = screen.getByRole("list", { name: "Conversas da caixa" });
    expect(within(caixa).getAllByRole("button")[0].getAttribute("title")).toBe("Abrir a conversa com Jori");

    fireEvent.click(within(agentes).getByTitle("Abrir a ficha de Lia"));
    const ficha = await screen.findByRole("dialog");
    expect(ficha.textContent).toContain("Aqui agora");
    expect(ficha.textContent).toContain("Montando o calendário da Acerbi");
    expect(within(ficha).getByRole("region", { name: "Salas" }).textContent).toContain("Conteúdo");
    fireEvent.click(within(ficha).getByRole("button", { name: "Mandar mensagem" }));
    const nova = await screen.findByRole("dialog");
    expect((within(nova).getByLabelText(/Para/) as HTMLSelectElement).value).toBe("agente:lia");
    fireEvent.click(within(nova).getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    fireEvent.click(within(caixa).getByTitle("Abrir a conversa com Jori"));
    expect((await screen.findByRole("list", { name: "Recados da conversa" })).textContent).toContain("Posso seguir com a pauta da Acerbi?");
    expect(screen.getByRole("tab", { name: "Conversas" }).getAttribute("aria-selected")).toBe("true");
  });

  it("organograma: todas as plataformas, o grau no cartão, o que o agente faz agora e a função repetida em cima", async () => {
    montar();
    await abrirAba("Organograma");
    const aviso = await screen.findByRole("region", { name: "Função repetida" });
    expect(aviso.textContent).toContain("Conteúdo · Social media: Lia, Nina");
    expect(aviso.textContent).not.toContain("Jori");
    expect(document.querySelector('[data-agente="1"] [data-grau="orquestrador"]')?.textContent).toBe("Orquestrador");
    expect(document.querySelector('[data-agente="1"] [data-origem="grok"]')?.textContent).toBe("Grok");
    expect(document.querySelector('[data-agente="3"] [data-origem="paperclip"]')?.textContent).toBe("Paperclip");
    expect(document.querySelector('[data-agente="4"] [data-origem="openbot"]')?.textContent).toBe("OpenBot");
    expect(document.querySelector('[data-agente="4"] [data-grau="leitor"]')?.textContent).toBe("Leitor");
    // Batimento de 2 min: está aqui e diz o que faz. Batimento de 45 min: o recado velho não aparece.
    expect(document.querySelector('[data-agente="2"] [data-agora]')?.textContent).toContain("Montando o calendário da Acerbi");
    expect(document.body.textContent).not.toContain("Recado velho");
  });

  it("conversas: a mais recente primeiro, ponto na não lida, abrir marca como lida e o dono escreve pelo RPC", async () => {
    montar();
    await abrirAba("Conversas");
    const lista = await screen.findByRole("list", { name: "Conversas" });
    const linhas = within(lista).getAllByRole("button");
    expect(linhas.map((l) => l.getAttribute("title"))).toEqual(["Abrir a conversa com Conteúdo", "Abrir a conversa com Jori"]);
    expect(linhas[0].textContent).toContain("Lia: Calendário de dezembro pronto.");
    expect(linhas[0].querySelector("[data-nao-lidas]")).toBeNull();
    expect(linhas[1].textContent).toContain("Prioridade do dia");
    expect(linhas[1].querySelector("[data-nao-lidas]")?.getAttribute("aria-label")).toBe("1 recado não lido");

    fireEvent.click(linhas[1]);
    const recados = await screen.findByRole("list", { name: "Recados da conversa" });
    expect(recados.textContent).toContain("Posso seguir com a pauta da Acerbi?");
    expect(recados.textContent).not.toContain("Calendário de dezembro pronto.");
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("escritorio_dono_marcar_lidas", { _conversa_id: "c1" }));

    const campo = screen.getByRole("textbox", { name: "Mensagem do dono" });
    fireEvent.change(campo, { target: { value: "  Pode seguir.  " } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("escritorio_dono_enviar", {
      _corpo: "Pode seguir.", _para: null, _grupo: null, _conversa_id: "c1", _assunto: null, _client_id: null, _task_id: null,
    }));
    await waitFor(() => expect((campo as HTMLTextAreaElement).value).toBe(""));
  });

  it("conversa nova: o dono escolhe um agente ou uma sala; mensagem que chega ao vivo faz a lista reler", async () => {
    montar();
    await abrirAba("Conversas");
    fireEvent.click(await screen.findByRole("button", { name: "Nova conversa" }));
    const janela = await screen.findByRole("dialog");
    const para = within(janela).getByLabelText(/Para/);
    expect(within(para).getAllByRole("option").map((o) => o.textContent)).toEqual(["Escolha um agente ou uma sala", "Jori", "Lia", "Nina", "Conteúdo"]);
    fireEvent.change(para, { target: { value: "sala:conteudo" } });
    fireEvent.change(within(janela).getByLabelText(/Assunto/), { target: { value: "Natal" } });
    fireEvent.change(within(janela).getByLabelText(/Mensagem/), { target: { value: "Quem pega a campanha de Natal?" } });
    fireEvent.click(within(janela).getByRole("button", { name: "Enviar" }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("escritorio_dono_enviar", {
      _corpo: "Quem pega a campanha de Natal?", _para: null, _grupo: "conteudo", _conversa_id: null, _assunto: "Natal", _client_id: null, _task_id: null,
    }));

    const insercao = aoVivo.find((a) => a.filtro.table === "escritorio_mensagens");
    expect(insercao?.filtro).toMatchObject({ event: "INSERT", schema: "public" });
    expect(aoVivo.some((a) => a.filtro.table === "escritorio_presenca")).toBe(true);
    const antes = leiturasFeitas.filter((t) => t === "escritorio_mensagens").length;
    insercao?.avisar();
    await waitFor(() => expect(leiturasFeitas.filter((t) => t === "escritorio_mensagens").length).toBeGreaterThan(antes));
  });

  it("salas: quem está em cada uma, com plataforma e grau; o dono troca o papel, tira e põe membro", async () => {
    montar();
    await abrirAba("Salas");
    const membros = await screen.findByRole("list", { name: "Membros de Conteúdo" });
    expect(within(membros).getAllByRole("listitem").map((li) => li.querySelector("[data-agente-do-escritorio]")?.getAttribute("data-agente-do-escritorio"))).toEqual(["lia", "nina"]);
    expect(membros.querySelector('[data-agente-do-escritorio="nina"] [data-origem="paperclip"]')?.textContent).toBe("Paperclip");
    expect(membros.querySelector('[data-agente-do-escritorio="nina"] [data-grau="executor"]')?.textContent).toBe("Executor");
    expect(membros.querySelector('[data-agente-do-escritorio="lia"] [data-presenca="agora"]')).toBeTruthy();
    expect(membros.querySelector('[data-agente-do-escritorio="lia"] [data-fazendo]')?.textContent).toBe("Montando o calendário da Acerbi");

    fireEvent.change(screen.getByLabelText("Papel de Nina em Conteúdo"), { target: { value: "observador" } });
    await waitFor(() => expect(escritas).toContainEqual({ tabela: "escritorio_grupo_membros", modo: "update", dados: { papel: "observador" }, filtros: { grupo_id: "g1", operator_slug: "nina" } }));
    await waitFor(() => expect((screen.getByLabelText("Agente para entrar em Conteúdo") as HTMLSelectElement).disabled).toBe(false));
    fireEvent.change(screen.getByLabelText("Agente para entrar em Conteúdo"), { target: { value: "jori" } });
    fireEvent.click(screen.getByRole("button", { name: "Adicionar" }));
    await waitFor(() => expect(escritas).toContainEqual({ tabela: "escritorio_grupo_membros", modo: "insert", dados: { grupo_id: "g1", operator_slug: "jori", papel: "membro" }, filtros: {} }));
    await waitFor(() => expect((screen.getByRole("button", { name: "Tirar Lia de Conteúdo" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Tirar Lia de Conteúdo" }));
    await waitFor(() => expect(escritas).toContainEqual({ tabela: "escritorio_grupo_membros", modo: "delete", dados: null, filtros: { grupo_id: "g1", operator_slug: "lia" } }));
  });

  it("automações: vazio com o texto combinado; com dados, lista, filtros e troca de dono, sem botão de ligar e desligar", async () => {
    montar();
    await abrirAba("Automações");
    expect(await screen.findByText("Nenhuma automação registrada ainda.")).toBeTruthy();
    expect(screen.getByText("Elas aparecem aqui quando o n8n começar a avisar o Escritório.")).toBeTruthy();
    cleanup();

    tabelas.escritorio_automacoes = [
      { id: "a1", plataforma: "n8n", ref: "wf-1", nome: "Aviso de post no ar", o_que_faz: "Avisa o grupo quando o post sai.", dono_slug: "lia", ativo: true, ultima_execucao_em: haMin(12), ultimo_status: "ok", ultimo_erro: null, ultimo_erro_em: null, execucoes: 40, erros: 0, atualizado_em: haMin(12) },
      { id: "a2", plataforma: "n8n", ref: "wf-2", nome: "Leitura dos grupos", o_que_faz: null, dono_slug: null, ativo: false, ultima_execucao_em: haMin(180), ultimo_status: "erro", ultimo_erro: "Evolution não respondeu.", ultimo_erro_em: haMin(180), execucoes: 9, erros: 3, atualizado_em: haMin(180) },
      { id: "a3", plataforma: "n8n", ref: "wf-3", nome: "Vigia de vencimentos", o_que_faz: "Avisa 7 dias antes.", dono_slug: null, ativo: true, ultima_execucao_em: null, ultimo_status: null, ultimo_erro: null, ultimo_erro_em: null, execucoes: 0, erros: 0, atualizado_em: haMin(999) },
    ];
    montar();
    await abrirAba("Automações");
    const tabela = await screen.findByRole("list", { name: "Automações" });
    const linha = (ref: string) => tabela.querySelector(`[data-automacao="${ref}"]`) as HTMLElement;
    expect(linha("wf-1").textContent).toContain("Ligada");
    expect(linha("wf-1").textContent).toContain("há 12 min");
    expect(linha("wf-1").textContent).toContain("Deu certo");
    expect(linha("wf-2").textContent).toContain("Desligada");
    expect(linha("wf-2").textContent).toContain("Evolution não respondeu.");
    expect(linha("wf-3").textContent).toContain("nunca rodou");
    expect(within(tabela).queryByRole("switch")).toBeNull();
    expect(within(tabela).queryByRole("button")).toBeNull();

    const filtro = screen.getByRole("tablist", { name: "Filtrar automações" });
    const lidas = () => Array.from(screen.getByRole("list", { name: "Automações" }).querySelectorAll("[data-automacao]")).map((l) => l.getAttribute("data-automacao"));
    fireEvent.click(within(filtro).getByRole("tab", { name: /^Com erro/ }));
    expect(lidas()).toEqual(["wf-2"]);
    fireEvent.click(within(filtro).getByRole("tab", { name: /^Nunca rodou/ }));
    expect(lidas()).toEqual(["wf-3"]);
    fireEvent.click(within(filtro).getByRole("tab", { name: /^Todas/ }));
    expect(lidas().length).toBe(3);

    fireEvent.change(screen.getByLabelText("Dono de Leitura dos grupos"), { target: { value: "jori" } });
    await waitFor(() => expect(escritas).toContainEqual({ tabela: "escritorio_automacoes", modo: "update", dados: { dono_slug: "jori" }, filtros: { id: "a2" } }));
  });

  it("acessos: credencial só com nome e prévia, última atividade, grau, bloquear com confirmação, desbloquear e ligar credencial", async () => {
    montar();
    await abrirAba("Acessos");
    const lista = await screen.findByRole("list", { name: "Acessos dos agentes" });
    const linha = (slug: string) => lista.querySelector(`[data-acesso="${slug}"]`) as HTMLElement;
    // Última atividade = o mais recente entre a última execução (120 min) e o batimento (2 min).
    await waitFor(() => expect(linha("lia").textContent).toContain("há 2 min"));
    expect(linha("jori").textContent).toContain("há 45 min");
    expect(linha("nina").textContent).toContain("sem atividade");
    expect(linha("fred").textContent).toContain("Bloqueado");

    // Na ficha: credencial só com nome e prévia, nunca o segredo.
    let ficha = await abrirFicha("jori", "Jori");
    const credenciais = within(ficha).getByRole("region", { name: "Credenciais de Jori" });
    expect(credenciais.textContent).toContain("Jori no Grok");
    expect(credenciais.textContent).toContain("ak_1a2b");
    expect(credenciais.textContent).toContain("padrão");
    expect(document.body.textContent).not.toContain("NUNCA-NA-TELA");
    fireEvent.keyDown(ficha, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    ficha = await abrirFicha("nina", "Nina");
    fireEvent.change(within(ficha).getByLabelText("Grau de Nina"), { target: { value: "coordenador" } });
    await waitFor(() => expect(escritas).toContainEqual({ tabela: "internal_operators", modo: "update", dados: { grau: "coordenador" }, filtros: { id: "3" } }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Nina agora é coordenador."));
    fireEvent.keyDown(ficha, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    ficha = await abrirFicha("lia", "Lia");
    fireEvent.click(within(await abrirMenuDaFicha(ficha, "Lia")).getByRole("menuitem", { name: "Bloquear" }));
    const confirmar = await screen.findByRole("dialog");
    expect(confirmar.textContent).toContain("Bloquear pausa o agente e tira as credenciais dele na hora.");
    expect(rpc).not.toHaveBeenCalledWith("escritorio_bloquear_agente", expect.anything());
    fireEvent.change(within(confirmar).getByLabelText(/Motivo/), { target: { value: "Teste de segurança" } });
    fireEvent.click(within(confirmar).getByRole("button", { name: "Sim, bloquear" }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("escritorio_bloquear_agente", { _slug: "lia", _motivo: "Teste de segurança" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    ficha = await abrirFicha("fred", "Fred");
    expect(ficha.querySelector("[data-bloqueado]")?.getAttribute("title")).toBe("Motivo: respondeu cliente sem aprovação");
    const menuDoFred = await abrirMenuDaFicha(ficha, "Fred");
    expect(within(menuDoFred).queryByRole("menuitem", { name: "Bloquear" })).toBeNull();
    fireEvent.click(within(menuDoFred).getByRole("menuitem", { name: "Desbloquear" }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("escritorio_desbloquear_agente", { _slug: "fred" }));
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    ficha = await abrirFicha("nina", "Nina");
    fireEvent.click(within(await abrirMenuDaFicha(ficha, "Nina")).getByRole("menuitem", { name: "Ligar credencial" }));
    const ligar = await screen.findByRole("dialog", { name: /Ligar credencial a Nina/ });
    const escolha = within(ligar).getByLabelText(/Credencial/);
    // Só chave do MCP ativa entra na escolha.
    expect(within(escolha).getAllByRole("option").map((o) => o.textContent)).toEqual(["Escolha uma chave", "Jori no Grok (ak_1a2b)"]);
    fireEvent.change(escolha, { target: { value: CHAVE } });
    fireEvent.click(within(ligar).getByRole("button", { name: "Ligar" }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("escritorio_ligar_credencial", { _key_id: CHAVE, _slug: "nina", _padrao: true }));
  });

  it("quem é da equipe e não é admin vê tudo e não escreve nada", async () => {
    papel = "manager";
    montar();
    await abrirAba("Conversas");
    const lista = await screen.findByRole("list", { name: "Conversas" });
    expect(screen.queryByRole("button", { name: "Nova conversa" })).toBeNull();
    fireEvent.click(within(lista).getByTitle("Abrir a conversa com Jori"));
    expect((await screen.findByRole("list", { name: "Recados da conversa" })).textContent).toContain("Posso seguir com a pauta da Acerbi?");
    expect(screen.queryByRole("textbox", { name: "Mensagem do dono" })).toBeNull();
    expect(screen.getByText("Só o dono escreve aqui. A equipe acompanha.")).toBeTruthy();

    await abrirAba("Salas");
    const membros = await screen.findByRole("list", { name: "Membros de Conteúdo" });
    expect(membros.textContent).toContain("Dono da sala");
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.queryByRole("button", { name: "Adicionar" })).toBeNull();

    await abrirAba("Acessos");
    const deAcessos = await screen.findByRole("list", { name: "Acessos dos agentes" });
    expect(within(deAcessos).queryByRole("combobox")).toBeNull();
    expect(deAcessos.querySelector('[data-acesso="jori"] [data-grau="orquestrador"]')?.textContent).toBe("Orquestrador");
    const ficha = await abrirFicha("jori", "Jori");
    expect(within(ficha).queryByRole("combobox")).toBeNull();
    expect(within(ficha).queryByRole("button", { name: "Mais ações de Jori" })).toBeNull();
    expect(within(ficha).queryByRole("button", { name: "Mandar mensagem" })).toBeNull();
    expect(ficha.querySelector('[data-grau="orquestrador"]')?.textContent).toBe("Orquestrador");
    expect(rpc).not.toHaveBeenCalled();
    expect(escritas).toEqual([]);
  });
});
