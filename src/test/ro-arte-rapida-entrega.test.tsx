import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement as h } from "react";
import { MemoryRouter } from "react-router-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Frente RO, fase 1b (29/09): a arte rápida da Acerbi foi "para aprovação" e
 * não chegou ao cliente. Causa: o ajuste gravava a versão sem o formato
 * (formato_post); num post 3:4 a entrega lia a versão ajustada como 4:5 e
 * parava com 409 (laminas_em_outro_formato, sem log por ser 4xx); a tela já
 * tinha criado o item na Agenda e mostrava "Na Agenda" pelo task_id. Agora:
 * 1. o formato da versão vem do gravado ou do tamanho (servidor e tela iguais);
 * 2. o ajuste grava o formato da versão editada;
 * 3. a tela só diz "Na Agenda" com a arte entregue; sem ela, o erro fica à
 *    vista com "Entregar de novo" (o mesmo item);
 * 4. as 3 opções da entrega (EN) na arte rápida, na ordem das pautas:
 *    entregar, data confirmada antes da aprovação, e o modo.
 */

const mock = vi.hoisted(() => ({ invoke: vi.fn(), rpc: vi.fn(), from: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: mock.invoke },
    rpc: mock.rpc,
    from: mock.from,
    storage: { from: vi.fn(() => ({ createSignedUrl: vi.fn(async () => ({ data: { signedUrl: "https://x/y.png" }, error: null })) })) },
    auth: { getSession: () => Promise.resolve({ data: { session: null } }) },
  },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn(), message: vi.fn() } }));

import { ConfirmDialogProvider } from "@/components/shared/confirmDialog";
import { MesaProvider, type MesaValor } from "@/components/mesa/MesaContexto";
import { LevarParaAgenda } from "@/components/mesa/EstudioArteRapida";
import { situacaoDaArteRapida } from "@/components/mesa/arteRapidaApi";
import { formatoDaVersaoNaTela, versaoForaDoFormato } from "@/components/mesa/estudioUtil";

const ler = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");
const servidor = ler("supabase/functions/estudio-arte/index.ts");

const CLIENTE = "39ebda82-637c-498b-a23a-b622f645e852";
const TRABALHO = "083475be-4706-40ab-bb9c-fa0ec7e1f17b";
const TASK = "9e0202f4-4878-8ec4-ad14-9b0f74d59098";

/** O caso da Acerbi: 3:4, a v1 gerada com o formato e a v2 do ajuste sem ele. */
const trabalhoDaAcerbi = (extra: Record<string, unknown> = {}): any => ({
  id: TRABALHO,
  client_id: CLIENTE,
  task_id: null,
  status: "pronto",
  file_ids: [],
  legenda: "Legenda pronta",
  direcao: {
    formato: "retrato_3x4",
    cards: [{ ordem: 1, funcao: "capa", texto_exato: "Olá" }],
    arte_rapida: { pedido: "Deixa exatamente nesse estilo", titulo: "Deixa exatamente nesse estilo", peca: "unica", arquivos: [], documentos: [] },
  },
  cards: [
    { ordem: 1, versao: 1, storage_path: `${CLIENTE}/estudio/v1.png`, origem: "gerar", formato_post: "retrato_3x4", tamanho: "1104x1472" },
    { ordem: 1, versao: 2, storage_path: `${CLIENTE}/estudio/v2.png`, origem: "ajuste", tamanho: "1104x1472" },
  ],
  custo_usd: 0.1,
  atualizado_em: "2026-09-29T13:40:00Z",
  ...extra,
});

describe("1. Causa: a versão do ajuste sem o formato", () => {
  it("o formato da versão vem do gravado ou da proporção do tamanho (a v2 da Acerbi é 3:4)", () => {
    expect(formatoDaVersaoNaTela({ formato_post: "retrato_3x4" })).toBe("retrato_3x4");
    expect(formatoDaVersaoNaTela({ tamanho: "1104x1472" })).toBe("retrato_3x4");
    expect(formatoDaVersaoNaTela({ tamanho: "1088x1088" })).toBe("quadrado_1x1");
    expect(formatoDaVersaoNaTela({ tamanho: "1088x1920" })).toBe("stories_9x16");
    // 2:3 (reserva do 4:5) e versões antigas sem nada: 4:5, como sempre foi.
    expect(formatoDaVersaoNaTela({ tamanho: "1024x1536" })).toBe("feed_4x5");
    expect(formatoDaVersaoNaTela({})).toBe("feed_4x5");
    expect(versaoForaDoFormato({ tamanho: "1104x1472" }, "retrato_3x4")).toBe(false);
    expect(versaoForaDoFormato({ tamanho: "1088x1360" }, "retrato_3x4")).toBe(true);
  });

  it("servidor: a entrega lê o formato pela mesma regra e o ajuste grava o formato da versão editada", () => {
    const entregar = servidor.slice(servidor.indexOf("async function entregar(ch: Chamador"), servidor.indexOf("async function entregarAnuncio("));
    expect(entregar).toContain("formatoDaVersao(u.versao as VersaoCard & { formato_post?: string | null; tamanho?: string | null }) !== formatoDoConjunto");
    expect(entregar).not.toContain("formatoDoPost((u.versao as VersaoCard & { formato_post?: string | null }).formato_post)");
    expect(servidor).toContain("function formatoDaVersao(v: { formato_post?: unknown; tamanho?: unknown } | null | undefined): FormatoDoPost {");
    expect(servidor).toContain("if (Math.abs(g.largura / g.altura - p) < 0.01) return f;");
    const ajuste = servidor.slice(servidor.indexOf("async function ajustarCard("), servidor.indexOf("async function recorteDasAreas("));
    expect(ajuste).toContain("formato_post: formatoDaVersao(atualVersao as VersaoCard & { formato_post?: string | null; tamanho?: string | null }),");
  });
});

describe("2. Situação da arte rápida: 'na Agenda' só entregue", () => {
  it("item criado sem arte em Arquivos é 'não entregue'", () => {
    const t = trabalhoDaAcerbi({ direcao: { ...trabalhoDaAcerbi().direcao, arte_rapida: { ...trabalhoDaAcerbi().direcao.arte_rapida, task_id: TASK } } });
    expect(situacaoDaArteRapida(t)).toEqual({ rotulo: "não entregue", tom: "alerta" });
    expect(situacaoDaArteRapida({ ...t, status: "entregue", file_ids: ["f1"] })).toEqual({ rotulo: "na Agenda", tom: "ok" });
  });
});

// ------------------------------------------------------------------ tela

const valorDaMesa = (podeRecarregar = true): MesaValor => ({
  clientId: CLIENTE,
  clientName: "Acerbi",
  userId: "u-1",
  isAdmin: true,
  podeRecarregar,
  saldoUsd: 50,
  catalogo: [],
  catalogoCarregando: false,
  atualizarCusto: vi.fn(),
  abrirRecarga: vi.fn(),
  abrirChaves: vi.fn(),
  abrirModelos: vi.fn(),
});

function montar(trabalho: any, podeRecarregar = true) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    h(MemoryRouter, null, h(QueryClientProvider, { client: qc }, h(ConfirmDialogProvider, null, h(MesaProvider, { valor: valorDaMesa(podeRecarregar) }, h(LevarParaAgenda, { trabalho, onAbrirItem: vi.fn() }))))),
  );
}

const acoes = () => mock.invoke.mock.calls.map((c) => (c[1] as any).body.acao as string);

/** O botão pede um segundo clique quando não há estimativa (sem custo de IA). */
async function clicar(nome: RegExp) {
  const b = await screen.findByRole("button", { name: nome });
  fireEvent.click(b);
  await new Promise((r) => setTimeout(r, 0));
  const armado = screen.queryByRole("button", { name: /clique de novo/i });
  if (armado) fireEvent.click(armado);
}

const levada = () => trabalhoDaAcerbi({ task_id: TASK, direcao: { ...trabalhoDaAcerbi().direcao, arte_rapida: { ...trabalhoDaAcerbi().direcao.arte_rapida, task_id: TASK, data: "2026-09-30" } } });

function servidorFalso(opcoes: { entregar?: "ok" | "formato"; precisaData?: boolean } = {}) {
  mock.invoke.mockImplementation(async (_f: string, { body }: { body: Record<string, unknown> }) => {
    if (body.acao === "rapida_para_agenda") return { data: { trabalho: levada(), task: { id: TASK, title: "t", due_date: body.data }, item_criado: true }, error: null };
    if (body.acao === "entregar") {
      if (opcoes.entregar === "formato") return { data: { error: "laminas_em_outro_formato", mensagem: "O formato do post é Retrato 3:4, mas a lâmina 1 foi gerada em outro formato. Gere de novo antes de entregar." }, error: null };
      return { data: { trabalho_id: TRABALHO, file_ids: ["f1"], root_file_id: "f1", agenda: { ok: true, post_id: "p1" } }, error: null };
    }
    if (body.acao === "publicacao_confirmar") return { data: { trabalho_id: TRABALHO, publicacao: { post_id: "p1", publicacao_id: "pb1", quando: body.publicar_em, status: "planned" } }, error: null };
    if (body.acao === "entrega_concluir") {
      return { data: body.modo === "pronto" && opcoes.precisaData ? { trabalho_id: TRABALHO, modo: "pronto", precisa_data: true, motivo: "Escolha o perfil para agendar." } : { trabalho_id: TRABALHO, modo: body.modo, precisa_data: false, agendado: { quando: "2026-09-30T12:00:00Z", status: "scheduled" } }, error: null };
    }
    return { data: {}, error: null };
  });
  mock.rpc.mockImplementation(async (nome: string) => {
    if (nome === "mesa_enviar_para_aprovacao") return { data: { resultados: [{ trabalho_id: TRABALHO, ok: true, estado: "aguardando_cliente" }] }, error: null };
    if (nome === "mesa_melhores_horarios") return { data: { por_tipo: { static: "12:00" }, fonte: "padrao", amostra: 0 }, error: null };
    return { data: null, error: null };
  });
  mock.from.mockImplementation(() => {
    const b: any = {};
    for (const m of ["select", "eq", "in", "is", "order", "limit", "neq", "not"]) b[m] = () => b;
    b.maybeSingle = () => Promise.resolve({ data: null, error: null });
    b.then = (ok: any) => Promise.resolve({ data: [], error: null }).then(ok);
    return b;
  });
}

describe("3. Tela: enviar para aprovação como as pautas", () => {
  beforeEach(() => {
    mock.invoke.mockReset();
    mock.rpc.mockReset();
    mock.from.mockReset();
  });

  it("aprovação: item, entregar, data confirmada ANTES do envio ao cliente, e o envio pela RPC da Mesa", async () => {
    servidorFalso();
    montar(trabalhoDaAcerbi());
    expect(screen.getByRole("radio", { name: "Enviar para aprovação" }).getAttribute("aria-checked")).toBe("true");
    await clicar(/Confirmar e levar/);
    await waitFor(() => expect(mock.rpc.mock.calls.some((c) => c[0] === "mesa_enviar_para_aprovacao")).toBe(true));
    expect(acoes().filter((a) => a !== "legenda")).toEqual(["rapida_para_agenda", "entregar", "publicacao_confirmar"]);
    const entregar = mock.invoke.mock.calls.find((c) => (c[1] as any).body.acao === "entregar")![1] as any;
    expect(entregar.body.sem_agenda).toBeUndefined();
    expect((mock.rpc.mock.calls.find((c) => c[0] === "mesa_enviar_para_aprovacao") as any)[1]).toEqual({ _trabalho_ids: [TRABALHO] });
    expect(await screen.findByText(/Na Agenda/)).toBeTruthy();
  });

  it("a entrega recusada fica à vista: nada de 'Na Agenda', o motivo e Entregar de novo no mesmo item", async () => {
    servidorFalso({ entregar: "formato" });
    const { container } = montar(trabalhoDaAcerbi());
    await clicar(/Confirmar e levar/);
    await waitFor(() => expect(container.querySelector(`[data-nao-entregue='${TRABALHO}']`)).toBeTruthy());
    expect(container.textContent).toContain("mas a arte não chegou ao cliente");
    expect(container.textContent).toContain("gerada em outro formato");
    expect(screen.queryByText(/^Na Agenda/)).toBeNull();
    expect(mock.rpc.mock.calls.some((c) => c[0] === "mesa_enviar_para_aprovacao")).toBe(false);
    // Entregar de novo: o mesmo item (rapida_para_agenda é idempotente) e a entrega outra vez.
    servidorFalso();
    await clicar(/Entregar de novo/);
    await waitFor(() => expect(mock.rpc.mock.calls.some((c) => c[0] === "mesa_enviar_para_aprovacao")).toBe(true));
  });

  it("o trabalho da Acerbi de hoje (item sem arte em Arquivos) abre direto com Entregar de novo", () => {
    const { container } = montar(levada());
    expect(container.querySelector(`[data-nao-entregue='${TRABALHO}']`)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Entregar de novo/ })).toBeTruthy();
  });

  it("pronto para agendar: entrega, data e aprova pelo cliente (entrega_concluir pronto), sem o envio de aprovação", async () => {
    servidorFalso();
    montar(trabalhoDaAcerbi());
    fireEvent.click(screen.getByRole("radio", { name: "Pronto para agendar" }));
    await clicar(/Confirmar e levar/);
    await waitFor(() => expect(acoes()).toContain("entrega_concluir"));
    const concluir = mock.invoke.mock.calls.find((c) => (c[1] as any).body.acao === "entrega_concluir")![1] as any;
    expect(concluir.body.modo).toBe("pronto");
    const ordem = acoes().filter((a) => a !== "legenda");
    expect(ordem.indexOf("publicacao_confirmar")).toBeLessThan(ordem.indexOf("entrega_concluir"));
    expect(mock.rpc.mock.calls.some((c) => c[0] === "mesa_enviar_para_aprovacao")).toBe(false);
  });

  it("pronto sem perfil ou data: a janela do Agendar pergunta na própria tela", async () => {
    servidorFalso({ precisaData: true });
    montar(trabalhoDaAcerbi());
    fireEvent.click(screen.getByRole("radio", { name: "Pronto para agendar" }));
    await clicar(/Confirmar e levar/);
    await waitFor(() => expect(document.querySelector(`[data-aprovada='${TRABALHO}']`)).toBeTruthy());
    expect(acoes()).toContain("entrega_concluir");
  });

  it("só Arquivos: entrega sem Agenda (sem_agenda) e conclui em arquivos, sem data e sem aprovação", async () => {
    servidorFalso();
    montar(trabalhoDaAcerbi());
    fireEvent.click(screen.getByRole("radio", { name: "Só Arquivos" }));
    await clicar(/Confirmar e levar/);
    await waitFor(() => expect(acoes()).toContain("entrega_concluir"));
    const entregar = mock.invoke.mock.calls.find((c) => (c[1] as any).body.acao === "entregar")![1] as any;
    expect(entregar.body.sem_agenda).toBe(true);
    expect(acoes()).not.toContain("publicacao_confirmar");
    expect(mock.rpc.mock.calls.some((c) => c[0] === "mesa_enviar_para_aprovacao")).toBe(false);
  });

  it("design (sem liberar) não vê o pronto para agendar", () => {
    servidorFalso();
    montar(trabalhoDaAcerbi(), false);
    expect(screen.queryByRole("radio", { name: "Pronto para agendar" })).toBeNull();
    expect(screen.getByRole("radio", { name: "Enviar para aprovação" })).toBeTruthy();
  });
});

describe("4. Depois do envio: o caminho das pautas", () => {
  it("o cliente vê pela RPC da Mesa; aprovado, o banco agenda na data confirmada (gatilho e cron de sempre)", () => {
    const api = ler("src/lib/mesa/api.ts");
    expect(api).toContain('rpc("mesa_enviar_para_aprovacao", { _trabalho_ids: trabalhoIds })');
    // A entrega cria os arquivos no projeto do item (o da marca, gravado pelo rapida_para_agenda) e leva à Agenda.
    const entregar = servidor.slice(servidor.indexOf("async function entregar(ch: Chamador"), servidor.indexOf("async function entregarAnuncio("));
    expect(entregar).toContain("const projetoId = item.projeto.id;");
    expect(entregar).toContain("project_id: projetoId,");
    expect(entregar).toContain("const agenda = semAgenda ? null : await levarParaAgenda(ch, gravado);");
    const rapida = servidor.slice(servidor.indexOf("async function rapidaParaAgenda("), servidor.indexOf("async function rapidaArquivar("));
    expect(rapida).toContain("projetoId: marca ? marca.project_id : null,");
  });
});
