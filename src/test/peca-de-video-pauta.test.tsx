import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement as h } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Peça de vídeo do Mês (24/10/2026). Print do dono a 1882 px: no painel "Gravar com roteiro" o "Rascunho" ficava
 * por cima de "Agente de roteiro" e o roteiro virava uma coluna de 1 letra (roteiro e agente lado a lado num
 * painel de ~400 px); o miolo mostrava a direção genérica "Produto elegante". Pedido: A fazer / Pronto, ver o
 * vídeo, o roteiro ou só o texto, subir o gravado direto para o Workspace e "já gerar legenda e já agendar".
 * Banco, funções e Storage simulados.
 */

const mock = vi.hoisted(() => ({
  invoke: vi.fn(),
  rpc: vi.fn(),
  tabelas: {} as Record<string, unknown>,
  subirVideos: vi.fn(),
  chamarMesaVideos: vi.fn(),
  handoff: vi.fn(),
  revisao: vi.fn(),
  carregarPost: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => {
  const consulta = (tabela: string) => {
    const dados = mock.tabelas[tabela] === undefined ? [] : mock.tabelas[tabela];
    const b: any = {};
    for (const m of ["select", "eq", "neq", "not", "in", "is", "or", "contains", "overlaps", "gte", "lt", "lte", "gt", "order", "limit", "range", "update"]) b[m] = () => b;
    const um = () => Promise.resolve({ data: Array.isArray(dados) ? dados[0] || null : dados, error: null });
    b.maybeSingle = um;
    b.single = um;
    b.then = (ok: any, erro: any) => Promise.resolve({ data: dados, error: null }).then(ok, erro);
    return b;
  };
  const storage = { from: () => ({ createSignedUrl: (c: string) => Promise.resolve({ data: { signedUrl: `https://arquivos.test/${c}` }, error: null }) }) };
  return { supabase: { functions: { invoke: mock.invoke }, rpc: mock.rpc, from: (t: string) => consulta(t), storage } };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn(), message: vi.fn() } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { role: "admin" }, user: { id: "u-1" } }) }));
vi.mock("@/components/mesa-videos/videosApi", async (original) => {
  const real = (await original()) as Record<string, unknown>;
  return {
    ...real,
    usePedidos: () => ({ data: { itens: [], disponivel: true } }),
    subirVideos: (...a: unknown[]) => mock.subirVideos(...a),
    chamarMesaVideos: (...a: unknown[]) => mock.chamarMesaVideos(...a),
  };
});
vi.mock("@/lib/workspaceFileHandoff", () => ({ handoffWorkspaceFileToFiles: (...a: unknown[]) => mock.handoff(...a) }));
vi.mock("@/lib/fileApprovalActions", () => ({ requestFileAgencyReview: (...a: unknown[]) => mock.revisao(...a) }));
vi.mock("@/hooks/useEditorialCalendar", () => ({ loadEditorialPostForMutation: (...a: unknown[]) => mock.carregarPost(...a) }));
vi.mock("@/components/mesa/Seletores", async (original) => {
  const real = (await original()) as Record<string, unknown>;
  return {
    ...real,
    SeletorDeModelo: (p: { catalogo: Array<{ id: string; rotulo: string; tipo: string }>; valor: string; onChange: (v: string) => void; rotulo?: string }) =>
      h("select", { "aria-label": p.rotulo, value: p.valor, onChange: (e: any) => p.onChange(e.target.value) }, p.catalogo.filter((m) => m.tipo === "texto").map((m) => h("option", { key: m.id, value: m.id }, m.rotulo))),
  };
});

import { TooltipProvider } from "@/components/ui/tooltip";
import { MesaProvider, type MesaValor } from "@/components/mesa/MesaContexto";
import GravarDaPauta from "@/components/mesa/GravarDaPauta";
import PecaDeVideoDaPauta from "@/components/mesa/PecaDeVideoDaPauta";
import { videoPronto } from "@/components/mesa/EstudioLista";
import { horarioDaPeca, legendaComHashtags, situacaoDoVideo, textoCorrido, textoDoPreparo } from "@/components/mesa/videoDaPauta";

// O player mede a área (PreviaDaPauta); o jsdom não tem ResizeObserver.
class ObservadorFalso {
  observe() {}
  unobserve() {}
  disconnect() {}
}
if (!(globalThis as any).ResizeObserver) (globalThis as any).ResizeObserver = ObservadorFalso;

const CLIENTE = "11111111-1111-4111-8111-111111111111";
const TAREFA = "66666666-6666-4666-8666-666666666666";
const ROTEIRO = "44444444-4444-4444-8444-444444444444";
const MODELO = "openai/gpt-teste";
const DIRETOR = "openai/gpt-6-luna";

const CONTEUDO = {
  titulo: "Se eu precisasse dobrar as vendas",
  subtitulo: "",
  tipo: "fala_camera",
  duracao_alvo_s: 30,
  ganchos: [{ texto: "Se eu precisasse dobrar as vendas de uma loja, eu não faria isso", mecanismo: "erro", promessa: "", motivo: "" }],
  gancho_escolhido: 0,
  blocos: [
    { id: "b1", funcao: "Gancho", fala: "Se eu precisasse dobrar as vendas de uma loja, eu não faria isso.", segundos: 4, visual: "Close no rosto, plano fechado", texto_na_tela: "Não faça isso", broll: "" },
    { id: "b2", funcao: "Virada", fala: "Eu começaria pelo cliente que já comprou.", segundos: 8, visual: "Plano médio na loja", texto_na_tela: "Quem já comprou", broll: "Caixa da loja" },
  ],
  direcao: { enquadramento: "Peito para cima", ambiente: "Loja", figurino: "", objetos: "", luz: "Janela", camera: "Celular na vertical", orientacoes: [] },
  broll: [],
  cta: "Comenta VENDAS",
  legenda: "",
  hashtags: [],
  pendencias: [],
  sugestoes: [],
};

const linha = () => ({
  id: ROTEIRO, client_id: CLIENTE, task_id: TAREFA, proposta_id: null, campanha_id: null, titulo: CONTEUDO.titulo, tipo: "fala_camera", status: "rascunho",
  versao_atual: 1, versao_aprovada: null, versoes: [{ numero: 1, origem: "ia", conteudo: CONTEUDO, nota: "Versão", criado_em: "2026-10-24T10:00:00Z", custo_usd: 0.05 }],
  comentarios: [], custo_usd: 0.05, criado_em: "2026-10-24T10:00:00Z", atualizado_em: "2026-10-24T10:00:00Z",
});

const CATALOGO = [
  { id: MODELO, nome: "Modelo de teste", rotulo: "Modelo de teste", tipo: "texto", provedor: "openai", ativo: true, preco_entrada_1m: 1, preco_saida_1m: 4, padrao_para: ["estrategista"] },
  { id: DIRETOR, nome: "GPT-6 Luna", rotulo: "GPT-6 Luna", tipo: "texto", provedor: "openai", ativo: true, preco_entrada_1m: 2, preco_saida_1m: 10, padrao_para: ["diretor_arte"] },
];

const pauta = (extra: Record<string, unknown> = {}) => ({ id: TAREFA, title: "Se eu precisasse dobrar as vendas", due_date: "2030-11-10", delivery_type: "reels", status: "todo", project_id: "77777777-7777-4777-8777-777777777777", modo_estudio: "video", caminho_video: "gravar", ...extra }) as any;

let respostas: Record<string, unknown> = {};
const chamadas = (funcao: string, acao: string) => mock.invoke.mock.calls.filter((c: any[]) => c[0] === funcao && c[1] && c[1].body && c[1].body.acao === acao).map((c: any[]) => c[1].body);
const rpcs = (nome: string) => mock.rpc.mock.calls.filter((c: any[]) => c[0] === nome).map((c: any[]) => c[1]);

beforeEach(() => {
  vi.clearAllMocks();
  mock.tabelas = {};
  respostas = { estimar: { estimativa_usd: 0.08, modelo_id: MODELO, custo_usd: 0 }, agente_historico: { conversa_id: null, mensagens: [], custo_usd: 0 } };
  try {
    window.localStorage.clear();
  } catch {
    /* sem armazenamento */
  }
  mock.rpc.mockImplementation(async (nome: string) => (nome === "save_editorial_post" ? { data: { post_id: "post-1", version: 3, recovered: false }, error: null } : { data: { ok: true }, error: null }));
  mock.invoke.mockImplementation(async (_nome: string, opcoes: any) => {
    const acao = opcoes && opcoes.body ? opcoes.body.acao : "";
    const r = respostas[acao];
    if (typeof r === "function") return { data: (r as (b: unknown) => unknown)(opcoes.body), error: null };
    if (r !== undefined) return { data: r, error: null };
    return { data: { ok: true, custo_usd: 0 }, error: null };
  });
});

function mesa(): MesaValor {
  return {
    clientId: CLIENTE, clientName: "Cliente Teste", userId: "u-1", isAdmin: true, podeRecarregar: true, saldoUsd: 50,
    catalogo: CATALOGO, catalogoCarregando: false, atualizarCusto: vi.fn(), abrirRecarga: vi.fn(), abrirChaves: vi.fn(), abrirModelos: vi.fn(),
  } as unknown as MesaValor;
}

const montar = (filho: unknown) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(h(QueryClientProvider, { client: qc }, h(MemoryRouter, null, h(TooltipProvider, null, h(MesaProvider, { valor: mesa(), children: filho as any })))));
  return qc;
};

const confirmarCusto = async (botao: HTMLElement, funcao: string, acao: string) => {
  fireEvent.click(botao);
  await new Promise((r) => setTimeout(r, 400));
  if (!chamadas(funcao, acao).length) fireEvent.click(botao);
};

// ------------------------------------------------------------------ puro

describe("vídeo da pauta: A fazer / Pronto e o texto (puro)", () => {
  it("pronto com o vídeo guardado, com o vídeo do post da Agenda ou com a geração da IA; sem nada, A fazer", () => {
    expect(situacaoDoVideo({ video_pronto: null }, null, []).estado).toBe("a_fazer");
    const guardado = situacaoDoVideo({ video_pronto: { bucket: "workspace", caminho: `${CLIENTE}/v.mp4`, nome: "v.mp4", em: "" } }, null, []);
    expect(guardado).toEqual({ estado: "pronto", video: expect.objectContaining({ bucket: "workspace", fonte: "peca" }) });
    const agenda = situacaoDoVideo({ video_pronto: null }, { post_id: "p", titulo: "t", legenda: null, status: "draft", do_estudio: false, capa: { id: "f", nome: "v.mp4", bucket: "workspace", caminho: "c/v.mp4", url: null, tipo_midia: "video" } }, []);
    expect(agenda.video && agenda.video.fonte).toBe("agenda");
    const ia = situacaoDoVideo({ video_pronto: null }, null, [{ id: "a1", client_id: CLIENTE, nome: "ger.mp4", nome_original: "ger.mp4", storage_bucket: "mesa", storage_path: `${CLIENTE}/video/g.mp4`, estado: "ativo" } as any]);
    expect(ia).toEqual({ estado: "pronto", video: expect.objectContaining({ fonte: "ia", arquivo_id: "a1" }) });
    // Imagem na Agenda não é vídeo pronto.
    expect(situacaoDoVideo({ video_pronto: null }, { post_id: "p", titulo: null, legenda: null, status: null, do_estudio: false, capa: { id: "f", nome: "a.png", bucket: "files", caminho: "a.png", url: null, tipo_midia: "image" } }, []).estado).toBe("a_fazer");
    expect(videoPronto(pauta({ video_pronto: { bucket: "workspace", caminho: "x.mp4", nome: "x", em: "" } }), null)).toBe(true);
    expect(videoPronto(pauta(), null)).toBe(false);
  });

  it("só o texto junta as falas; a legenda leva as hashtags no fim; o horário é o do dia da peça, dia passado fica sem data", () => {
    expect(textoCorrido(CONTEUDO as any)).toBe("Se eu precisasse dobrar as vendas de uma loja, eu não faria isso.\n\nEu começaria pelo cliente que já comprou.");
    expect(legendaComHashtags({ legenda: "A gente começou pelo cliente.", hashtags: ["#varejo", "#vendas"] })).toBe("A gente começou pelo cliente.\n\n#varejo #vendas");
    expect(horarioDaPeca("2030-11-10", "19:00", "2026-10-24")).toBe("2030-11-10T22:00:00.000Z");
    expect(horarioDaPeca("2026-10-01", "19:00", "2026-10-24")).toBeNull();
    expect(textoDoPreparo({ agendado_para: "2030-11-10T22:00:00.000Z", sem_conta: false })).toMatch(/^Agendado para 10\/11.*19:00, aguardando aprovação\.$/);
    expect(textoDoPreparo({ agendado_para: null, sem_conta: true })).toMatch(/sem conta do Instagram/);
  });
});

// ------------------------------------------------------------------ painel estreito

describe("Gravar com roteiro no painel estreito (print de 1882 px)", () => {
  it("roteiro e agente empilhados: o roteiro com a largura do painel, o agente embaixo e recolhível, sem rolagem dentro da rolagem", async () => {
    mock.tabelas.roteiros = [linha()];
    montar(h(GravarDaPauta, { item: pauta() }));
    expect((await screen.findAllByText(/Se eu precisasse dobrar as vendas de uma loja/)).length).toBeGreaterThan(0);
    const raiz = document.querySelector("[data-roteiro-da-peca]") as HTMLElement;
    expect(raiz.getAttribute("data-disposicao")).toBe("empilhado");
    // A coluna de 1 letra vinha do grid de 2 colunas (1fr + 380 px) dentro do painel de ~400 px.
    expect(raiz.className).not.toMatch(/grid-cols/);
    expect(raiz.className).toMatch(/flex-col/);
    const bloco = raiz.querySelector("[data-bloco-do-roteiro]") as HTMLElement;
    expect(bloco.className).toMatch(/w-full/);
    expect(bloco.className).toMatch(/min-w-0/);
    // O título e o status quebram linha em vez de um ficar por cima do outro.
    const cabecalho = bloco.firstElementChild as HTMLElement;
    expect(cabecalho.className).toMatch(/flex-wrap/);
    expect(within(cabecalho).getByText("rascunho", { exact: false })).toBeTruthy();
    // O agente fica embaixo, com o título que recolhe.
    const lugar = raiz.querySelector("[data-lugar-do-agente]") as HTMLElement;
    expect(lugar.getAttribute("data-lugar-do-agente")).toBe("abaixo");
    expect(lugar.className).not.toMatch(/lg:border-l/);
    expect(bloco.compareDocumentPosition(lugar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await waitFor(() => expect(chamadas("mesa-roteiros", "agente_historico").length).toBe(1));
    const conversa = await screen.findByLabelText("Conversa com o agente de roteiro");
    expect(conversa.className).not.toMatch(/overflow-y-auto/);
    const recolher = screen.getByRole("button", { name: /Agente de roteiro/ });
    expect(recolher.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(recolher);
    expect(screen.getByRole("button", { name: /Agente de roteiro/ }).getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByLabelText("Conversa com o agente de roteiro")).toBeNull();
    // O painel estreito mostra as falas; o roteiro completo (visual, direção) fica no miolo da peça.
    expect(within(bloco).queryByText(/Close no rosto/)).toBeNull();
  });
});

// ------------------------------------------------------------------ o miolo da peça

describe("miolo da peça de vídeo: A fazer / Pronto, Vídeo, Roteiro e Só o texto", () => {
  it("sem vídeo: A fazer, sem a direção genérica; o seletor troca entre o roteiro completo e só o texto", async () => {
    mock.tabelas.roteiros = [linha()];
    const aoGerar = vi.fn();
    montar(h(PecaDeVideoDaPauta, { item: pauta(), geracoes: [], aoGerar, aoAbrirRoteiro: vi.fn() }));
    expect(screen.getByText("A fazer").closest("[data-estado-do-video]")!.getAttribute("data-estado-do-video")).toBe("a_fazer");
    expect(screen.queryByText("Produto elegante")).toBeNull();
    const grupo = screen.getByRole("group", { name: "Ver a peça" });
    for (const nome of ["Vídeo", "Roteiro", "Só o texto"]) expect(within(grupo).getByRole("button", { name: nome }).getAttribute("title")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Vídeo" }));
    expect(screen.getByText("Gravou? Suba o vídeo aqui")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Gerar com IA/ }));
    expect(aoGerar).toHaveBeenCalled();
    fireEvent.click(within(grupo).getByRole("button", { name: "Roteiro" }));
    expect(await screen.findByText(/Close no rosto, plano fechado/)).toBeTruthy();
    expect(screen.getByText("Direção de gravação")).toBeTruthy();
    expect(screen.getByText(/Celular na vertical/)).toBeTruthy();
    fireEvent.click(within(grupo).getByRole("button", { name: "Só o texto" }));
    const corrido = document.querySelector("[data-texto-corrido]") as HTMLElement;
    expect(corrido.textContent).toBe("Se eu precisasse dobrar as vendas de uma loja, eu não faria isso.\n\nEu começaria pelo cliente que já comprou.");
    expect(screen.getByRole("button", { name: "Copiar o texto" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Preparar para publicar/ })).toBeNull();
  });

  it("subir o vídeo gravado: vai para o Workspace do cliente, liga na peça e fica Pronto com o player", async () => {
    mock.subirVideos.mockResolvedValue({ registrados: [{ id: "arq-1", storage_path: `${CLIENTE}/video/brutos/abc.mp4`, duracao_s: 31 }], duplicados: [], recusados: [], sem_registro: 0, aviso: null });
    mock.chamarMesaVideos.mockResolvedValue({ client_id: CLIENTE, workspace: { node_id: "no-1" } });
    mock.tabelas.workspace_nodes = [{ id: "no-1", client_id: CLIENTE, kind: "file", name: "gravacao.mp4", mime: "video/mp4", size_bytes: 10, storage_path: `${CLIENTE}/videos/gravacao.mp4`, sent_for_approval_file_id: null }];
    respostas.pauta_video_pronto = (b: any) => ({ task_id: b.task_id, video_pronto: b.video, custo_usd: 0 });
    montar(h(PecaDeVideoDaPauta, { item: pauta(), geracoes: [], aoGerar: vi.fn(), aoAbrirRoteiro: vi.fn() }));
    const arquivo = new File(["x"], "gravacao.mp4", { type: "video/mp4" });
    fireEvent.change(screen.getByLabelText("Vídeo gravado da peça: arquivo de vídeo"), { target: { files: [arquivo] } });
    await waitFor(() => expect(chamadas("agente-calendario", "pauta_video_pronto")).toHaveLength(1));
    expect(mock.chamarMesaVideos).toHaveBeenCalledWith({ acao: "final_para_workspace", arquivo_id: "arq-1" });
    expect(chamadas("agente-calendario", "pauta_video_pronto")[0]).toEqual(expect.objectContaining({
      client_id: CLIENTE,
      task_id: TAREFA,
      video: { bucket: "workspace", caminho: `${CLIENTE}/videos/gravacao.mp4`, nome: "gravacao.mp4", duracao_s: 31 },
    }));
    expect((await screen.findByText("Pronto")).closest("[data-estado-do-video]")!.getAttribute("data-estado-do-video")).toBe("pronto");
    const player = await screen.findByLabelText("gravacao.mp4");
    expect(player.tagName).toBe("VIDEO");
    expect(screen.getByRole("button", { name: "Ver grande" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Preparar para publicar/ })).toBeTruthy();
  });

  it("preparar para publicar: legenda da casa pelo roteiro, post de Reels na Agenda na data da peça, aguardando aprovação; nunca publica; Desfazer arquiva", async () => {
    mock.tabelas.roteiros = [linha()];
    mock.tabelas.workspace_nodes = [{ id: "no-1", client_id: CLIENTE, kind: "file", name: "gravacao.mp4", mime: "video/mp4", size_bytes: 10, storage_path: `${CLIENTE}/videos/gravacao.mp4`, sent_for_approval_file_id: null }];
    mock.tabelas.editorial_post_internal = [];
    mock.tabelas.mesa_cliente_config = [{ hora_publicacao: "19:00:00" }];
    mock.tabelas.project_external_accounts = [{ external_account_id: "conta-ig" }];
    mock.tabelas.external_accounts = [{ id: "conta-ig", platform: "instagram", status: "active" }];
    mock.handoff.mockResolvedValue({ fileId: "file-1", created: true });
    mock.revisao.mockResolvedValue({ ok: true });
    respostas.legenda_do_video = { task_id: TAREFA, com_roteiro: true, legenda: "Se fosse a gente, começava pelo cliente que já comprou.", hashtags: ["#varejo", "#vendas"], custo_usd: 0.03 };
    const item = pauta({ video_pronto: { bucket: "workspace", caminho: `${CLIENTE}/videos/gravacao.mp4`, nome: "gravacao.mp4", em: "2026-10-24T10:00:00Z" } });
    montar(h(PecaDeVideoDaPauta, { item, geracoes: [], aoGerar: vi.fn(), aoAbrirRoteiro: vi.fn() }));
    expect(screen.getByText("Pronto")).toBeTruthy();
    const preparar = screen.getByRole("button", { name: /Preparar para publicar/ });
    await waitFor(() => expect(preparar).not.toBeDisabled());
    // Custo antes: o botão mostra a estimativa (diretor + Jev) e pede o segundo clique.
    expect(preparar.textContent).toMatch(/~US\$/);
    await confirmarCusto(preparar, "estudio-arte", "legenda_do_video");
    await waitFor(() => expect(rpcs("save_editorial_post")).toHaveLength(1));
    expect(chamadas("estudio-arte", "legenda_do_video")[0]).toEqual(expect.objectContaining({ acao: "legenda_do_video", client_id: CLIENTE, task_id: TAREFA }));
    expect(mock.handoff).toHaveBeenCalledWith(expect.objectContaining({ clientId: CLIENTE, fileName: item.title, folder: "materiais", projectId: item.project_id, node: expect.objectContaining({ id: "no-1" }) }));
    const payload = rpcs("save_editorial_post")[0].p_payload;
    expect(payload).toEqual(expect.objectContaining({
      id: null,
      client_id: CLIENTE,
      task_id: TAREFA,
      primary_file_id: "file-1",
      content_type: "reel",
      production_status: "draft",
      default_caption: "Se fosse a gente, começava pelo cliente que já comprou.\n\n#varejo #vendas",
    }));
    expect(payload.publications).toEqual([expect.objectContaining({ external_account_id: "conta-ig", delivery_mode: "manual", scheduled_at: "2030-11-10T22:00:00.000Z", caption: payload.default_caption, asset_file_ids: [] })]);
    // Nada publica: nenhuma transição de publicação, só o pedido de revisão da agência.
    expect(rpcs("transition_editorial_publication")).toHaveLength(0);
    expect(mock.revisao).toHaveBeenCalledWith("file-1");
    expect(await screen.findByText(/Agendado para 10\/11.*aguardando aprovação/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Desfazer/ }));
    await waitFor(() => expect(rpcs("archive_editorial_post")).toEqual([{ p_post_id: "post-1", p_expected_version: 3 }]));
    expect(await screen.findByRole("button", { name: /Preparar para publicar/ })).toBeTruthy();
  });
});

// ------------------------------------------------------------------ contrato do servidor

describe("contrato do servidor", () => {
  const ler = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
  const trecho = (fonte: string, inicio: string) => {
    const i = fonte.indexOf(inicio);
    const j = fonte.indexOf("\n}\n", i);
    return fonte.slice(i, j);
  };

  it("estudio-arte: legenda_do_video usa o MESMO motor da legenda (escreverLegendaDoPost), com o roteiro da tarefa e cobrança na tarefa, sem gravar", () => {
    const estudio = ler("supabase/functions/estudio-arte/index.ts");
    expect(estudio).toContain("legenda_do_video: legendaDoVideo,");
    const legenda = trecho(estudio, "async function legenda(ch: Chamador");
    const doVideo = trecho(estudio, "async function legendaDoVideo(");
    expect(legenda).toContain("escreverLegendaDoPost(ch,");
    expect(doVideo).toContain("escreverLegendaDoPost(");
    expect(doVideo).toContain('.from("roteiros")');
    expect(doVideo).toContain('referencia: { tipo: "tarefa", id: taskId }');
    expect(doVideo).toContain("garantirAcesso(ch, clientId)");
    expect(doVideo).not.toContain("mutarTrabalho");
    expect(doVideo).not.toContain("chamarTexto(");
    const motor = trecho(estudio, "async function escreverLegendaDoPost(");
    expect(motor.split("chamarTexto(").length - 1).toBe(1);
    expect(motor).toContain("sistema: `${CONHECIMENTO_DA_LEGENDA}");
  });

  it("agente-calendario: pauta_video_pronto guarda o vídeo no item do plano, sem IA e sem Jev", () => {
    const cal = ler("supabase/functions/agente-calendario/index.ts");
    expect(cal).toContain("pauta_video_pronto: pautaVideoPronto,");
    const acao = trecho(cal, "async function pautaVideoPronto(");
    expect(acao).toContain("exigirAcessoAoCliente(chamador, clientId)");
    expect(acao).toContain("normalizarVideoPronto(");
    expect(acao).toContain("novo.video_pronto = video");
    for (const proibido of ["chamarTexto(", "jevPerguntar(", "cobrarJev("]) expect(acao).not.toContain(proibido);
  });
});
