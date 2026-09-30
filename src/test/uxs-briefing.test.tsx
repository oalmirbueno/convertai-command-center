import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { createElement as h, type ReactNode } from "react";

/**
 * Frente UXS (30/09/2026): briefings mais simples sem perder função.
 * - Lista: uma barra só (busca + filtro com o número de cada estado), alerta
 *   à vista, comparar no "...", arquivados com Desarquivar, o "3 de 12" igual
 *   ao da leitura e o filtro lembrado.
 * - Leitura: um primário por estado; WhatsApp nunca com link vencido ou
 *   arquivado; PDF com "Abrir"; Arquivar com Desfazer; colunas da BRF2 numa
 *   consulta só com volta sem elas; a ordem das seções segue o estado.
 * - Modelos: barra de salvar só com mudança, somente leitura para quem não é
 *   admin, "Usar como base" na linha, sem o lápis.
 */

const invoke = vi.hoisted(() => vi.fn());
const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }));
type Resposta = { data: unknown; error: unknown };
const tabelas = vi.hoisted(() => ({ resolver: (() => ({ data: null, error: null })) as (t: string, sel: string, filtros: Array<[string, unknown[]]>) => Resposta }));

function consulta(t: string) {
  let sel = "";
  const filtros: Array<[string, unknown[]]> = [];
  const q: Record<string, unknown> = {};
  ["select", "eq", "is", "not", "in", "order", "limit"].forEach((m) => {
    q[m] = (...a: unknown[]) => {
      if (m === "select") sel = String(a[0]);
      else filtros.push([m, a]);
      return q;
    };
  });
  q.maybeSingle = () => Promise.resolve(tabelas.resolver(t, sel, filtros));
  q.then = (ok: (r: Resposta) => unknown, erro: (e: unknown) => unknown) => Promise.resolve(tabelas.resolver(t, sel, filtros)).then(ok, erro);
  return q;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke }, rpc: vi.fn(), from: (t: string) => consulta(t), storage: { from: vi.fn() } },
}));
vi.mock("sonner", () => ({ toast: toastMock }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" }, profile: { role: "admin" } }) }));
vi.mock("@/hooks/useSupabaseData", () => ({ useClients: () => ({ data: [{ id: "c1", company_name: "Padaria Aurora" }] }), useProjects: () => ({ data: [] }) }));
vi.mock("@/components/mesa/MesaContexto", () => ({ useCatalogo: () => ({ data: [] }) }));
vi.mock("@/components/mesa/Seletores", () => ({ SeletorDeModelo: () => null }));

import LeituraDoBriefing from "@/components/briefing/LeituraDoBriefing";
import AdminBriefings from "@/pages/AdminBriefings";
import EditorDeModelos from "@/components/briefing/EditorDeModelos";
import EditorDeCampos from "@/components/briefing/EditorDeCampos";
import PreencherBriefingComIA from "@/components/briefing/PreencherBriefingComIA";
import { MODELOS_DE_FABRICA, modeloDoLink, progressoDoBriefing, pastaDosAnexos } from "../../supabase/functions/_shared/briefing-modelos";
import { modeloComExtras, normalizarExtras } from "../../supabase/functions/briefing-agente/modulos/briefing-editor";

const DIA = 86_400_000;
const em = (dias: number) => new Date(Date.now() + dias * DIA).toISOString();

const linha = (extra: Record<string, unknown> = {}) => ({
  id: "b1",
  token: "tok-1",
  client_id: "c1",
  project_id: null,
  marca_id: null,
  modelo: "site",
  modelo_conteudo: null,
  prefill: null,
  titulo: null,
  responses: { historia: "Padaria de bairro" },
  submitted: false,
  expira_em: em(20),
  enviado_em: null,
  envios: 0,
  reabertura_pedida_em: null,
  reabertura_motivo: null,
  arquivado_em: null,
  arquivo_pdf_id: null,
  created_at: em(-1),
  client: { full_name: "Ana", company_name: "Padaria Aurora", phone: "41999990000" },
  rascunho_salvo_em: null,
  lembretes: 0,
  ultimo_lembrete_em: null,
  preenchido_ia: null,
  ...extra,
});

function Local() {
  const l = useLocation();
  return h("span", { "data-testid": "local" }, `${l.pathname}${l.search}`);
}

function montar(filho: ReactNode, rota = "/briefings") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    h(MemoryRouter, { initialEntries: [rota] }, h(QueryClientProvider, { client: qc }, h(Routes, null, h(Route, { path: "*", element: h("div", null, filho, h(Local)) })))),
  );
}

/** Nomes dos itens do "..." do cabeçalho da leitura. */
async function itensDoMenu(): Promise<string[]> {
  fireEvent.keyDown(screen.getByRole("button", { name: "Mais ações" }), { key: "Enter" });
  const itens = await screen.findAllByRole("menuitem");
  return itens.map((i) => (i.textContent || "").trim());
}

beforeEach(() => {
  invoke.mockReset();
  Object.values(toastMock).forEach((f) => f.mockReset());
  localStorage.clear();
  tabelas.resolver = () => ({ data: null, error: null });
});

describe("leitura: as ações seguem o estado do link", () => {
  const abrirLeitura = async (b: Record<string, unknown>, props: Record<string, unknown> = {}) => {
    tabelas.resolver = (t) => (t === "briefings" ? { data: b, error: null } : t === "briefing_anexos" ? { data: [], error: null } : { data: null, error: null });
    montar(h(LeituraDoBriefing, { briefingId: "b1", ...props }));
    await screen.findByRole("heading", { name: /Briefing do site/ });
  };

  it("aberto: Copiar link é o primário, WhatsApp à vista; o resto no \"...\" (Lembrar também, sem precisar hoje)", async () => {
    await abrirLeitura(linha());
    expect(screen.getByRole("button", { name: "Copiar link" }).className).toContain("bg-primary");
    expect(screen.getByRole("link", { name: "Enviar pelo WhatsApp" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Lembrar o cliente" })).toBeNull();
    expect(await itensDoMenu()).toEqual(["Preencher junto", "Mais 30 dias de validade", "Lembrar o cliente", "PDF em Arquivos", "Arquivar"]);
  });

  it("aberto e parado há dias: Lembrar vem para a barra", async () => {
    await abrirLeitura(linha({ created_at: em(-5) }));
    expect(screen.getByRole("button", { name: "Lembrar o cliente" })).toBeInTheDocument();
    expect(await itensDoMenu()).not.toContain("Lembrar o cliente");
  });

  it("sem as colunas da BRF2 (migração não aplicada): lê de novo sem elas e o Lembrar fica no \"...\"", async () => {
    const selects: string[] = [];
    tabelas.resolver = (t, sel) => {
      if (t !== "briefings") return { data: t === "briefing_anexos" ? [] : null, error: null };
      selects.push(sel);
      if (sel.indexOf("lembretes") >= 0) return { data: null, error: { code: "42703", message: "column briefings.lembretes does not exist" } };
      return { data: linha({ created_at: em(-5), lembretes: undefined, rascunho_salvo_em: undefined }), error: null };
    };
    montar(h(LeituraDoBriefing, { briefingId: "b1" }));
    await screen.findByRole("heading", { name: /Briefing do site/ });
    expect(selects).toHaveLength(2);
    expect(selects[1]).not.toContain("lembretes");
    expect(screen.queryByRole("button", { name: "Lembrar o cliente" })).toBeNull();
    expect(await itensDoMenu()).toContain("Lembrar o cliente");
  });

  it("expirado: Mais 30 dias é o primário e o WhatsApp não aparece (nada de link vencido)", async () => {
    await abrirLeitura(linha({ expira_em: em(-2) }));
    expect(screen.getByRole("button", { name: "Mais 30 dias de validade" }).className).toContain("bg-primary");
    expect(screen.queryByRole("link", { name: /WhatsApp/ })).toBeNull();
    expect(await itensDoMenu()).toEqual(["Copiar link", "PDF em Arquivos", "Arquivar"]);
  });

  it("recebido sem pedido: Gerar projeto é o primário, Reabrir e PDF à vista; Copiar e Arquivar no \"...\"", async () => {
    await abrirLeitura(linha({ submitted: true, enviado_em: em(-1) }), { onGerarProjeto: vi.fn() });
    expect(screen.getByRole("button", { name: "Gerar projeto" }).className).toContain("bg-primary");
    expect(screen.getByRole("button", { name: "Reabrir" }).className).not.toContain("bg-primary");
    expect(screen.getByRole("button", { name: "PDF em Arquivos" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /WhatsApp/ })).toBeNull();
    expect(await itensDoMenu()).toEqual(["Copiar link", "Arquivar"]);
  });

  it("recebido com pedido de reabertura: Reabrir é o primário", async () => {
    await abrirLeitura(linha({ submitted: true, enviado_em: em(-1), reabertura_pedida_em: em(0) }), { onGerarProjeto: vi.fn() });
    expect(screen.getByRole("button", { name: "Reabrir" }).className).toContain("bg-primary");
    expect(screen.getByRole("button", { name: "Gerar projeto" }).className).not.toContain("bg-primary");
  });

  it("arquivado: Desarquivar é o primário; sem WhatsApp, Lembrar, Reabrir ou validade", async () => {
    await abrirLeitura(linha({ arquivado_em: em(0), created_at: em(-5) }));
    expect(screen.getByRole("button", { name: "Desarquivar" }).className).toContain("bg-primary");
    expect(screen.queryByRole("link", { name: /WhatsApp/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Lembrar o cliente" })).toBeNull();
    expect(screen.getByText(/arquivado/)).toBeInTheDocument();
    expect(await itensDoMenu()).toEqual(["Copiar link", "PDF em Arquivos"]);
  });

  it("sem cliente: o PDF fica desativado no \"...\" com o motivo no rótulo", async () => {
    await abrirLeitura(linha({ client_id: null, client: null }));
    await itensDoMenu();
    const pdf = screen.getByRole("menuitem", { name: /PDF em Arquivos \(precisa de cliente\)/ });
    expect(pdf).toHaveAttribute("data-disabled");
  });

  it("Arquivar é na hora e o aviso traz Desfazer (arquivar: false)", async () => {
    invoke.mockResolvedValue({ data: { briefing: { id: "b1" } }, error: null });
    await abrirLeitura(linha());
    await itensDoMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Arquivar" }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("briefing-agente", { body: { acao: "arquivar", briefing_id: "b1", arquivar: true } }));
    await waitFor(() => expect(toastMock.success).toHaveBeenCalled());
    const [texto, opcoes] = toastMock.success.mock.calls[0];
    expect(texto).toBe("Briefing arquivado. O link deixa de abrir.");
    expect(opcoes.action.label).toBe("Desfazer");
    act(() => opcoes.action.onClick());
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("briefing-agente", { body: { acao: "arquivar", briefing_id: "b1", arquivar: false } }));
  });

  it("PDF em Arquivos: o aviso tem Abrir, que leva à pasta dos documentos operacionais do cliente", async () => {
    invoke.mockResolvedValue({ data: { file_id: "f1", ja_existia: true }, error: null });
    await abrirLeitura(linha({ submitted: true, enviado_em: em(-1) }));
    fireEvent.click(screen.getByRole("button", { name: "PDF em Arquivos" }));
    await waitFor(() => expect(toastMock.success).toHaveBeenCalled());
    const [, opcoes] = toastMock.success.mock.calls[0];
    expect(opcoes.action.label).toBe("Abrir");
    act(() => opcoes.action.onClick());
    expect(screen.getByTestId("local").textContent).toBe("/arquivos?client=c1&folder=operacionais");
  });

  it("ordem pelo estado: aberto prepara primeiro; recebido traz pontos e contexto antes das respostas", async () => {
    await abrirLeitura(linha());
    const antes = (a: HTMLElement, b: HTMLElement) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(antes(screen.getByRole("heading", { name: "Preencher com IA" }), screen.getByRole("heading", { name: "Respostas" }))).toBe(true);
    expect(antes(screen.getByRole("heading", { name: "Respostas" }), screen.getByRole("heading", { name: "Levar para o contexto" }))).toBe(true);
  });

  it("recebido: Pontos do briefing e Levar para o contexto antes das Respostas, com \"Ler de novo\" no lugar de decupar", async () => {
    tabelas.resolver = (t) =>
      t === "briefings"
        ? { data: linha({ submitted: true, enviado_em: em(-1) }), error: null }
        : t === "briefing_decupagens"
          ? { data: { id: "d1", briefing_id: "b1", client_id: "c1", envio: 1, status: "pronta", itens: [{ id: "i1", categoria: "dores", texto: "Fila no balcão", fonte: "jev", confianca: 0.9 }], tom_de_voz: null, sugestoes: [{ id: "s1", campo: "publico", rotulo: "Público", modo: "juntar", valor: "Famílias do bairro", padrao: true }], destino: { tipo: "cliente" }, aplicadas: [], custo_usd: 0, erro: null, criado_em: em(0), concluido_em: em(0), aplicada_em: null, desfeita_em: null }, error: null }
          : { data: [], error: null };
    montar(h(LeituraDoBriefing, { briefingId: "b1" }));
    await screen.findByRole("heading", { name: "Pontos sugeridos" });
    const antes = (a: HTMLElement, b: HTMLElement) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(antes(screen.getByRole("heading", { name: "Pontos do briefing" }), screen.getByRole("heading", { name: "Levar para o contexto" }))).toBe(true);
    expect(antes(screen.getByRole("heading", { name: "Levar para o contexto" }), screen.getByRole("heading", { name: "Respostas" }))).toBe(true);
    expect(screen.getByRole("heading", { name: "Respostas e cérebro" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Ler de novo/ })).toBeInTheDocument();
    expect(screen.queryByText(/Decupar/)).toBeNull();
    expect(screen.getByText("Acrescenta")).toBeInTheDocument();
  });

  it("Abrir em Arquivos é link do app (sem recarregar), na pasta dos anexos", async () => {
    tabelas.resolver = (t) =>
      t === "briefings"
        ? { data: linha({ submitted: true, enviado_em: em(-1) }), error: null }
        : t === "briefing_anexos"
          ? { data: [{ id: "a1", campo: "anexoLogo", categoria: "logo", nome: "logo.pdf", tamanho: 1000, mime: "application/pdf", file_id: "f1", criado_em: em(0) }], error: null }
          : { data: null, error: null };
    montar(h(LeituraDoBriefing, { briefingId: "b1" }));
    const link = await screen.findByRole("link", { name: "Abrir em Arquivos" });
    expect(link.getAttribute("href")).toBe("/arquivos?client=c1&folder=identidade");
    expect(pastaDosAnexos([{ categoria: "logo" }, { categoria: "fotos" }])).toBe("base");
  });
});

describe("lista de briefings: uma barra, filtro lembrado, comparar no \"...\" e arquivados", () => {
  const extras = normalizarExtras([{ key: "extra_Delivery", tipo: "text", pergunta: "Faz delivery" }]);
  const comExtras = modeloComExtras(MODELOS_DE_FABRICA.site, extras);
  const lista = () => [
    linha({ id: "b1", client: { full_name: null, company_name: "Padaria Aurora" }, modelo_conteudo: undefined }),
    linha({ id: "b2", client: { full_name: null, company_name: "Oficina Tork" }, expira_em: em(2) }),
    linha({ id: "b3", client: { full_name: null, company_name: "Clínica Sol" }, submitted: true, enviado_em: em(-3) }),
  ];
  const resolverDaLista = (arquivados: unknown[] = []) => (t: string, sel: string, filtros: Array<[string, unknown[]]>) => {
    if (t === "briefing_anexos") return { data: [], error: null };
    if (sel === "id, modelo_conteudo") return { data: [{ id: "b1", modelo_conteudo: comExtras }], error: null };
    if (filtros.some(([m]) => m === "not")) return { data: arquivados, error: null };
    return { data: lista(), error: null };
  };

  it("sem a faixa de números; o alerta Vencendo fica à vista e filtra; a busca acha o cliente; filtro vazio oferece Limpar", async () => {
    tabelas.resolver = resolverDaLista();
    montar(h(AdminBriefings));
    await screen.findByText("Padaria Aurora");
    expect(screen.queryByText("Painel dos briefings")).toBeNull();
    // O "3 de 12" da linha é o mesmo da leitura: modelo do link, com as perguntas extras.
    const p = progressoDoBriefing(modeloDoLink("site", comExtras), { historia: "Padaria de bairro" });
    expect(screen.getByText(new RegExp(`${p.respondidos} de ${p.total}`))).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Vencendo/ }));
    expect(screen.queryByText("Padaria Aurora")).toBeNull();
    expect(screen.getByText("Oficina Tork")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Vencendo/ }));
    fireEvent.change(screen.getByLabelText("Buscar briefings"), { target: { value: "clinica" } });
    expect(await screen.findByText("Clínica Sol")).toBeInTheDocument();
    expect(screen.queryByText("Oficina Tork")).toBeNull();
    fireEvent.change(screen.getByLabelText("Buscar briefings"), { target: { value: "ninguem" } });
    fireEvent.click(await screen.findByRole("button", { name: "Limpar filtros" }));
    expect(await screen.findByText("Oficina Tork")).toBeInTheDocument();
  });

  it("o filtro fica lembrado ao voltar para a tela", async () => {
    tabelas.resolver = resolverDaLista();
    const { unmount } = montar(h(AdminBriefings));
    await screen.findByText("Padaria Aurora");
    fireEvent.click(screen.getByRole("button", { name: /^Vencendo/ }));
    unmount();
    montar(h(AdminBriefings));
    await screen.findByText("Oficina Tork");
    expect(screen.queryByText("Padaria Aurora")).toBeNull();
  });

  it("comparar: a caixinha só aparece depois de Comparar no \"...\"; Cancelar sai e limpa", async () => {
    tabelas.resolver = resolverDaLista();
    montar(h(AdminBriefings));
    await screen.findByText("Padaria Aurora");
    expect(screen.queryByRole("checkbox")).toBeNull();
    fireEvent.keyDown(screen.getByRole("button", { name: "Mais ações" }), { key: "Enter" });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Comparar" }));
    fireEvent.click(screen.getByLabelText("Marcar Padaria Aurora para comparar"));
    fireEvent.click(screen.getByLabelText("Marcar Oficina Tork para comparar"));
    expect(screen.getByRole("button", { name: "Comparar" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.queryByRole("button", { name: "Comparar" })).toBeNull();
  });

  it("Arquivados: só consulta quando escolhido, e Desarquivar devolve à lista", async () => {
    const lidos: string[] = [];
    const base = resolverDaLista([linha({ id: "b9", client: { full_name: null, company_name: "Loja Antiga" }, arquivado_em: em(-1) })]);
    tabelas.resolver = (t, sel, filtros) => {
      if (t === "briefings" && filtros.some(([m]) => m === "not")) lidos.push("arquivados");
      return base(t, sel, filtros);
    };
    invoke.mockResolvedValue({ data: { briefing: { id: "b9" } }, error: null });
    montar(h(AdminBriefings));
    await screen.findByText("Padaria Aurora");
    expect(lidos).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: /^Filtro:/ }));
    fireEvent.click(await screen.findByRole("option", { name: /Arquivados/ }));
    expect(await screen.findByText("Loja Antiga")).toBeInTheDocument();
    expect(lidos.length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Desarquivar Loja Antiga" }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("briefing-agente", { body: { acao: "arquivar", briefing_id: "b9", arquivar: false } }));
  });
});

describe("editor de modelos: salvar no pé só com mudança, somente leitura e sem o lápis", () => {
  const versoes = { vigente: MODELOS_DE_FABRICA.site, versoes: [{ id: "v2", versao: 2, titulo: null, nota: "Mais curto", ativo: true, criado_em: em(-3), conteudo: MODELOS_DE_FABRICA.site }], fabrica: MODELOS_DE_FABRICA.site };

  it("admin: sem mudança não há barra; mudou, aparece \"não salvo\" e a página é avisada", async () => {
    invoke.mockResolvedValue({ data: versoes, error: null });
    const mudou = vi.fn();
    montar(h(EditorDeModelos, { podeSalvar: true, onMudou: mudou }));
    const titulo = await screen.findByLabelText("Título do modelo");
    expect(screen.queryByRole("button", { name: /Salvar como versão nova/ })).toBeNull();
    fireEvent.change(titulo, { target: { value: "Briefing do site novo" } });
    expect(screen.getByRole("button", { name: /Salvar como versão nova/ })).toBeInTheDocument();
    expect(screen.getByText("não salvo")).toBeInTheDocument();
    expect(mudou).toHaveBeenLastCalledWith(true);
    fireEvent.click(screen.getByRole("button", { name: /Descartar/ }));
    expect(screen.queryByRole("button", { name: /Salvar como versão nova/ })).toBeNull();
    expect(mudou).toHaveBeenLastCalledWith(false);
  });

  it("quem não é admin vê tudo só para ler, com Ver na linha da versão", async () => {
    invoke.mockResolvedValue({ data: versoes, error: null });
    montar(h(EditorDeModelos, { podeSalvar: false }));
    const titulo = await screen.findByLabelText("Título do modelo");
    expect(titulo).toHaveAttribute("readonly");
    expect(screen.getByText("Só admin salva versão nova")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Nova pergunta/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Novo bloco/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Versões/ }));
    expect(screen.getByRole("button", { name: "Ver a versão 2" })).toBeInTheDocument();
  });

  it("EditorDeCampos: a linha abre a pergunta (aria-expanded), sem o lápis; somente leitura trava tudo", () => {
    const campos = [{ key: "a", tipo: "single-chip" as const, pergunta: "Primeira", opcoes: ["Sim", "Não"] }];
    const { rerender } = render(h(EditorDeCampos, { campos, onMudar: vi.fn(), todasAsChaves: ["a"], rotulo: "Perguntas" }));
    expect(screen.queryByRole("button", { name: /Editar Primeira/ })).toBeNull();
    const linhaDaPergunta = screen.getByRole("button", { name: /Primeira/, expanded: false });
    fireEvent.click(linhaDaPergunta);
    expect(linhaDaPergunta).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByLabelText("Texto da pergunta")).not.toHaveAttribute("readonly");
    rerender(h(EditorDeCampos, { campos, onMudar: vi.fn(), todasAsChaves: ["a"], rotulo: "Perguntas", somenteLeitura: true }));
    expect(screen.getByLabelText("Texto da pergunta")).toHaveAttribute("readonly");
    expect(screen.getByLabelText("Tipo da pergunta")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Descer Primeira" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Nova pergunta/ })).toBeNull();
  });
});

describe("Preencher com IA: o custo só é calculado com a seção aberta", () => {
  it("recolhida não chama a estimativa; o texto colado sobrevive a recolher e abrir", async () => {
    invoke.mockResolvedValue({ data: { custo_usd: 0.01, campos: 10 }, error: null });
    montar(h(PreencherBriefingComIA, { briefingId: "b1", temDesfazer: false, onMudou: vi.fn() }));
    expect(invoke).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Preencher com IA/ }));
    fireEvent.change(screen.getByLabelText("Reunião com o cliente"), { target: { value: "A padaria fica no Batel." } });
    fireEvent.click(screen.getByRole("button", { name: /Preencher com IA/ }));
    expect(screen.queryByLabelText("Reunião com o cliente")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Preencher com IA/ }));
    expect((screen.getByLabelText("Reunião com o cliente") as HTMLTextAreaElement).value).toBe("A padaria fica no Batel.");
  });
});

describe("ComparacaoDeBriefings no celular", () => {
  it("A e B à vista numa coluna (sem hidden)", async () => {
    tabelas.resolver = (t, _sel, filtros) => {
      if (t === "briefing_anexos") return { data: [], error: null };
      const id = (filtros.find(([m]) => m === "eq") || ["", ["", ""]])[1][1];
      return { data: linha({ id, submitted: true, enviado_em: em(-1), client: { full_name: null, company_name: id === "b1" ? "Padaria Aurora" : "Oficina Tork" } }), error: null };
    };
    const { default: ComparacaoDeBriefings } = await import("@/components/briefing/ComparacaoDeBriefings");
    montar(h(ComparacaoDeBriefings, { ids: ["b1", "b2"], onVoltar: vi.fn() }));
    const lados = await waitFor(() => {
      const el = document.querySelector("[data-lados-da-comparacao]");
      if (!el) throw new Error("sem os lados");
      return el as HTMLElement;
    });
    expect(lados.className).not.toContain("hidden");
    expect(within(lados).getByText(/A: Padaria Aurora/)).toBeInTheDocument();
    expect(within(lados).getByText(/B: Oficina Tork/)).toBeInTheDocument();
  });
});
