import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement as h, useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Frente AG2 (29/09/2026): o agente da Mesa Publicidade.
 * Nunca usado de verdade (0 conversas mesa_publicidade e 0 campanhas no banco
 * em 29/09): a leitura foi de "primeiro uso".
 * - a conversa grava sem perder a mensagem (gravarTroca); a ação feita na hora não perde a prova;
 * - o cartão de quem gasta IA leva o custo estimado (antes: só "gasta IA");
 * - revisão pela conversa: avaliar (direto), aprovar a foto conferida e refazer (Confirmar);
 * - briefing inteiro pela conversa (objetivo, formatos, o que não pode mudar);
 * - "essa direção", "a segunda tomada", "todas" pela lista da tela;
 * - aprendizado: reprovar com motivo e pedir territórios com pedido ensinam; as regras EVITAR vão ao pedido da Mesa Foto.
 * Função, banco e Jev falsos: nada sai para o Supabase real nem para API paga.
 */

const mock = vi.hoisted(() => ({ invoke: vi.fn(), rpc: vi.fn() }));

vi.mock("@/integrations/supabase/client", () => {
  const consulta = () => {
    const b: any = {};
    for (const m of ["select", "eq", "neq", "not", "in", "is", "or", "contains", "order", "limit", "range", "gte", "lt"]) b[m] = () => b;
    b.maybeSingle = () => Promise.resolve({ data: null, error: null });
    b.single = () => Promise.resolve({ data: null, error: null });
    b.then = (ok: any, erro: any) => Promise.resolve({ data: [], error: null, count: 0 }).then(ok, erro);
    return b;
  };
  return { supabase: { functions: { invoke: mock.invoke }, rpc: mock.rpc, from: () => consulta() } };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn(), message: vi.fn() } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { role: "admin" }, user: { id: "u-1" } }) }));

import { toast } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { MesaProvider, type MesaValor } from "@/components/mesa/MesaContexto";
import type { ModeloIa } from "@/lib/mesa/api";
import { MesaPublicidadeProvider, type MesaPublicidadeValor } from "@/components/mesa-publicidade/Comuns";
import AgenteDaPublicidade, { observacaoDaPublicidade } from "@/components/mesa-publicidade/AgenteDaPublicidade";
import { decidirRevisao } from "@/components/mesa-publicidade/publicidadeApi";
import {
  avaliarRevisao,
  campanhaVazia,
  normalizarBriefing,
  normalizarTerritorios,
  pedidoParaMesaFoto,
  planoDeTomadas,
  type CampanhaDePublicidade,
  type ConferenciaLida,
  type RevisaoDePublicidade,
  type Territorio,
} from "../../supabase/functions/mesa-publicidade/regras";
import {
  alvosDaPublicidade,
  caminhoDaPublicidade,
  itensDaReferenciaDaPublicidade,
  lerEdicaoDoBriefing,
  normalizarAcoesDaPublicidade,
  pedeAcaoNaPublicidade,
  REGRAS_DA_PUBLICIDADE,
  respostaPromete,
} from "../../supabase/functions/mesa-publicidade/acoes-da-publicidade";
import { receitaDaCategoria } from "../../supabase/functions/_shared/receitas-de-publicidade";
import { podeExecutarDireto } from "../../supabase/functions/_shared/acoes-do-agente";

const ler = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");
const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const CLIENTE = U(1);

function conferencia(pontos: Array<[string, boolean | null]>): ConferenciaLida {
  return { pontos: pontos.map(([criterio, ok]) => ({ criterio, ok, nota: "" })), alertas: [], resumo: "", aviso_jev: false, conferida_em: "2026-09-29T00:00:00Z" };
}
const bruto = (nome: string) => ({
  nome, conceito: `Conceito ${nome}.`, tensao_humana: "t", promessa: "p", razao_para_acreditar: "r",
  direcao_de_arte: { paleta: ["#112233"], luz: "luz", tratamento: "editorial", enquadramentos: "médio" },
  casting: { perfil: "adulta", idade_aprox: 30, estilo: "urbano", figurino: "camisa" }, ambiente: "rua", referencias: [], riscos: [], por_que_combina: "x",
});
function territorio(n: number, status: Territorio["status"]): Territorio {
  return { ...normalizarTerritorios([bruto(`Território ${n}`)]).territorios[0], id: U(50 + n), status };
}
function revisao(n: number, extra: Partial<RevisaoDePublicidade> = {}): RevisaoDePublicidade {
  return {
    id: U(100 + n), tomada_id: null, foto_tomada_id: `t${n}`, versao: 1, imagem_id: U(200 + n), storage_path: `x/v${n}.png`,
    avaliacao: avaliarRevisao(conferencia([["Produto e variante iguais às fontes", true]])), aviso_jev: null, decisao: null, motivo: "", decidido_em: null, ...extra,
  };
}
function campanha(extra: Partial<CampanhaDePublicidade> = {}): CampanhaDePublicidade {
  const t = territorio(1, "aprovado");
  const briefing = normalizarBriefing({ publico: "adultos", destino: "WhatsApp", restricoes: { logo: "logo na haste" } });
  const tomadas = planoDeTomadas(t, receitaDaCategoria("oculos"), briefing).map((x, i) => ({ ...x, id: U(300 + i), foto_tomada_id: `t${i + 1}` }));
  return {
    ...campanhaVazia(CLIENTE), id: U(10), nome: "Óculos Aurora", categoria: "oculos", kit_id: U(20), kit_nome: "Óculos Aurora", produto_fontes: [U(21)],
    briefing, briefing_versao: 1, territorios: [t, territorio(2, "proposto")], territorio_id: t.id, tomadas, ensaio_id: U(30), persistida: true, ...extra,
  };
}

// ------------------------------------------------------------------ 1. ações novas e custo no cartão

describe("revisão pela conversa e custo no cartão", () => {
  const mudou = avaliarRevisao(conferencia([["Rótulo e texto iguais, legíveis e sem espelhamento", false]]));
  const semSaber = avaliarRevisao(conferencia([["Produto e variante iguais às fontes", null]]));
  const c = campanha({
    revisoes: [
      revisao(1),
      revisao(2, { avaliacao: mudou }),
      revisao(3, { avaliacao: semSaber }),
      revisao(4, { decisao: "aprovada" }),
      revisao(5, { foto_tomada_id: "t1", versao: 2 }),
    ],
  });

  it("aprovar só a foto conferida, sem decisão e a versão mais nova; refazer não mexe na aprovada", () => {
    const refs = alvosDaPublicidade(c).filter((a) => a.dados.tipo === "foto").map((a) => a.ref);
    expect(refs).toEqual(["f1", "f2", "f3", "f4", "f5"]);
    const a = normalizarAcoesDaPublicidade({ resumo: "", itens: ["f1", "f2", "f3", "f4", "f5"].map((ref) => ({ operacao: "aprovar_foto", ref, para: "" })) }, c)!;
    expect(a.itens.map((i) => i.ref)).toEqual(["f5"]);
    expect(a.recusados.map((r) => `${r.ref}: ${r.motivo}`)).toEqual([
      "f1: Há uma versão mais nova desta tomada.",
      "f2: A conferência mostra o produto mudado: não dá para aprovar.",
      "f3: O produto não foi conferido com as fontes: confira ao lado delas na Revisão e aprove lá.",
      "f4: Já aprovada.",
    ]);
    expect(a.sem_desfazer).toBe(true);
    const r = normalizarAcoesDaPublicidade({ resumo: "", itens: [{ operacao: "refazer_foto", ref: "f2", para: "rótulo de frente" }, { operacao: "refazer_foto", ref: "f4", para: "" }] }, c, undefined, { refazer_foto: 0.04 })!;
    expect(r.itens.map((i) => [i.ref, i.para])).toEqual([["f2", "rótulo de frente"]]);
    expect(r.recusados[0].motivo).toMatch(/Já aprovada/);
    expect(r.custo_estimado_usd).toBe(0.04);
    expect(podeExecutarDireto(r, REGRAS_DA_PUBLICIDADE, { pedidoClaro: true }).direto).toBe(false);
    expect(caminhoDaPublicidade(c, r)!.destino).toContain("etapa=revisao");
  });

  it("avaliar a revisão vai direto (sem Jev, sem custo); sem ensaio fica travado", () => {
    const a = normalizarAcoesDaPublicidade({ resumo: "", itens: [{ operacao: "avaliar_revisao", ref: "k1", para: "" }] }, c)!;
    expect(a.custo_estimado_usd).toBe(0);
    expect(podeExecutarDireto(a, REGRAS_DA_PUBLICIDADE, { pedidoClaro: true }).direto).toBe(true);
    const sem = normalizarAcoesDaPublicidade({ resumo: "", itens: [{ operacao: "avaliar_revisao", ref: "k1", para: "" }] }, campanha({ ensaio_id: null }))!;
    expect(sem.recusados[0].motivo).toBe("Peça as tomadas à Mesa Foto antes de revisar.");
  });

  it("propor territórios e pedir tomadas levam o custo estimado; sem estimativa, o cartão diz que o custo sai na Mesa Foto", () => {
    const antes = campanha({ ensaio_id: null });
    const a = normalizarAcoesDaPublicidade({ resumo: "", itens: [{ operacao: "pedir_tomadas", ref: "t1", para: "" }] }, antes, undefined, { pedir_tomadas: 0.012 })!;
    expect(a.custo_estimado_usd).toBe(0.012);
    expect(observacaoDaPublicidade(a)).toMatch(/^Custo estimado: .* Não tem Desfazer\.$/);
    const semEstimativa = normalizarAcoesDaPublicidade({ resumo: "", itens: [{ operacao: "refazer_foto", ref: "f2", para: "" }] }, c)!;
    expect(semEstimativa.custo_estimado_usd).toBeNull();
    expect(observacaoDaPublicidade(semEstimativa)).toContain("o custo exato sai na Mesa Foto");
    const briefing = normalizarAcoesDaPublicidade({ resumo: "", itens: [{ operacao: "editar_briefing", ref: "k1", para: "tom: leve" }] }, c)!;
    expect(observacaoDaPublicidade(briefing)).toBe("Sem custo. Dá para desfazer.");
  });

  it("briefing inteiro pela conversa: objetivo, formatos e o que não pode mudar no produto", () => {
    expect(lerEdicaoDoBriefing("objetivo: quero mais mensagens no WhatsApp")).toEqual({ campo: "objetivo", valor: "consultas" });
    expect(lerEdicaoDoBriefing("formatos: 9:16 e 1:1")).toEqual({ campo: "formatos", valor: "9:16, 1:1" });
    expect(lerEdicaoDoBriefing("formatos: quadrado")).toBeNull();
    expect(lerEdicaoDoBriefing("cor_da_variante: tartaruga mel")).toEqual({ campo: "cor_da_variante", valor: "tartaruga mel" });
    expect(lerEdicaoDoBriefing("detalhes: ponte de metal; haste fina")).toEqual({ campo: "detalhes", valor: "ponte de metal; haste fina" });
    expect(lerEdicaoDoBriefing("preco: 99")).toBeNull();
  });

  it("o pedido de ação é reconhecido também por \"essa direção\", \"refaça\", \"avalie\"; a promessa sem lista também", () => {
    for (const p of ["aprove essa direção", "refaça a segunda tomada com o rótulo de frente", "avalie as fotos", "mude o formato para 9:16"]) expect(pedeAcaoNaPublicidade(p), p).toBe(true);
    expect(respostaPromete("Vou propor três territórios agora.")).toBe(true);
    expect(respostaPromete("A lista está pronta.")).toBe(false);
  });
});

// ------------------------------------------------------------------ 2. "essa direção", "a segunda tomada", "todas"

describe("referência do pedido na ordem da tela", () => {
  const c = campanha({ revisoes: [revisao(2, { decisao: "aprovada" }), revisao(1), revisao(3)] });

  it("direção: os territórios (t..) na ordem da campanha", () => {
    const r = itensDaReferenciaDaPublicidade("aprove essa direção", c);
    expect(r.lista).toBe("territorios");
    expect(r.itens.map((i) => i.ref)).toEqual(["t1", "t2"]);
  });

  it("\"a segunda tomada\": as fotos pela ordem do plano; \"essa foto\": a ordem da Revisão (sem decisão primeiro)", () => {
    const porTomada = itensDaReferenciaDaPublicidade("refaça a segunda tomada", c);
    expect(porTomada.lista).toBe("fotos");
    expect(porTomada.itens.map((i) => i.detalhe && i.detalhe.split(";")[0])).toEqual(["tomada 1", "tomada 2", "tomada 3"]);
    expect(porTomada.itens[1].ref).toBe("f1"); // a revisão da tomada 2 foi a primeira da lista de apelidos
    const naRevisao = itensDaReferenciaDaPublicidade("aprove essa foto", c);
    expect(naRevisao.itens.map((i) => i.ref)).toEqual(["f2", "f3", "f1"]);
    // Sem pista e sem fotos: os territórios (a etapa em que a campanha está).
    expect(itensDaReferenciaDaPublicidade("aprove essa", campanha({ revisoes: [] })).lista).toBe("territorios");
  });
});

// ------------------------------------------------------------------ 3. a função (ligação no código)

describe("a função mesa-publicidade", () => {
  const f = ler("supabase/functions/mesa-publicidade/index.ts");
  const conversa = f.slice(f.indexOf("async function agenteConversar("), f.indexOf("async function custosDaConversa("));

  it("a conversa grava pelo gravarTroca e devolve o aviso; antes o insert em lote ignorava o erro e a ação feita na hora perdia a prova", () => {
    expect(conversa).toContain("await gravarTroca(servico(), {");
    expect(conversa).toContain("mensagem_id: troca.agenteId");
    expect(conversa).toContain("aviso_registro: `${AVISO_SEM_REGISTRO}${feitaNaHora}`");
    expect(conversa).not.toMatch(/from\("agente_mensagens"\)\.insert\(\[/);
    expect(conversa).toContain("anexos: anexosDaResposta,");
    expect(f).toContain('registrarFalha("mesa-publicidade: resultado da ação não gravado na conversa"');
    expect(f).not.toContain(".then(() => undefined, () => undefined)");
  });

  it("estado real: pendências, apelidos no resumo, referência do Jev e regras no sistema", () => {
    expect(f).toContain("pendente: pendenciasDaCampanha(c),");
    expect(conversa).toContain("itensDaReferenciaDaPublicidade(mensagem, campanha)");
    expect(conversa).toContain("sistema: sistemaDoAgente(c, comAcoes) + (contextoDoCliente ? `\\n\\n${blocoDoContextoDoCliente(contextoDoCliente)}` : \"\") + extras,");
    expect(conversa).toContain('regrasDaMesa(servico(), { clientId, mesa: "publicidade", marcaId: campanha ? campanha.marca_id : null })');
    expect(conversa).toContain("await custosDaConversa(ch, campanha, r.acoes)");
  });

  it("executores: refazer reprova com o motivo e gera pela Mesa Foto; um por passo; avaliar sem Jev; custo somado", () => {
    expect(f).toContain('chamarMesaFoto(ch, { acao: "tomada_gerar", ensaio_id: e.c.ensaio_id, tomada_id: revisao.foto_tomada_id })');
    expect(f).toContain('const porVez = guardada.acao.itens.some((i) => i.operacao === "refazer_foto") ? 1 : 3;');
    expect(f).toContain("const r = await avaliarRevisoes(ch, e, false);");
    expect(f).toContain("custo_usd: Math.round(custo * 1e6) / 1e6, aprendido: aprendidos[0] || null, campanha: await lerCampanha(ch, campanhaId)");
    expect(f).toContain("const aprendendo = motivo ? aprenderDoAjuste(e.c, ch.userId, motivo) : Promise.resolve(null);");
    expect(f).toContain("if (x.desfazer && x.desfazer.nada === true) return;");
    expect(f).toContain("return json({ anexo: r.anexo, voltaram: r.voltaram, falharam: r.falharam, campanha: nova });");
  });

  it("aprendizado: conversa, reprovar com motivo e propor com pedido ensinam; regras na direção e no pedido à Mesa Foto; rotas", () => {
    expect(conversa).toContain('aprenderDoPedido(servico(), { clientId, mesa: "publicidade", pedido: mensagem, regraSugerida: r.regra_aprendida');
    expect(f).toContain('const aprendendo = decisao === "reprovar" && motivo ? aprenderDoAjuste(e.c, ch.userId, motivo) : Promise.resolve(null);');
    expect(f).toContain("const aprendendo = pedido ? aprenderDoAjuste(e.c, ch.userId, pedido) : Promise.resolve(null);");
    expect(f).toContain('sistema: SISTEMA_DO_DIRETOR + (regras.bloco ? `\\n\\n${regras.bloco}` : ""),');
    expect(f).toContain('regras.regras.filter((x) => x.tipo === "evitar").map((x) => x.texto)');
    expect(f).toContain("schema: obj({ resposta: S(\"string\"), acoes: ESQUEMA_DAS_ACOES_DA_PUBLICIDADE, ...CAMPOS_DO_APRENDIZADO }),");
    expect(f).toContain('...rotasDoAprendizado({ mesa: "publicidade", servico, garantirAcesso: (ch, clientId) => garantirAcesso(ch as Chamador, clientId), json }),');
  });

  it("o pedido à Mesa Foto leva o que a equipe ensinou a evitar, sem passar do limite", () => {
    const c = campanha();
    const t = c.territorios[0];
    const p = pedidoParaMesaFoto(c.briefing, t, c.tomadas, "[Mesa Publicidade x]", ["Não usar fundo escuro", "Sem modelo sorrindo de boca aberta"]);
    expect(p).toContain("A equipe pediu para evitar: Não usar fundo escuro; Sem modelo sorrindo de boca aberta.");
    expect(p.length).toBeLessThanOrEqual(2000);
    expect(pedidoParaMesaFoto(c.briefing, t, c.tomadas, "")).not.toContain("A equipe pediu para evitar");
  });
});

// ------------------------------------------------------------------ 4. tela

const catalogo: ModeloIa[] = [
  {
    id: "openai:gpt-texto", provedor: "openai", modelo_api: "gpt-texto", tipo: "texto", rotulo: "Texto",
    preco_entrada_1m: 1, preco_saida_1m: 2, preco_cache_1m: null, preco_imagem: null,
    raciocinio: ["low", "medium"], padrao_para: ["estrategista", "diretor_arte", "leitura"], ativo: true,
  } as ModeloIa,
];

let respostas: Record<string, any> = {};

beforeAll(() => {
  if (!(globalThis as any).ResizeObserver) {
    (globalThis as any).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
  if (!(Element.prototype as any).scrollIntoView) (Element.prototype as any).scrollIntoView = () => {};
});

beforeEach(() => {
  vi.clearAllMocks();
  respostas = {};
  mock.rpc.mockResolvedValue({ data: { saldo_usd: 12.5, total_usd: 0, por_modelo: [], por_tarefa: [] }, error: null });
  mock.invoke.mockImplementation(async (_nome: string, opcoes: any) => {
    const acao = opcoes && opcoes.body ? opcoes.body.acao : "";
    if (respostas[acao] !== undefined) return { data: typeof respostas[acao] === "function" ? respostas[acao](opcoes.body) : respostas[acao], error: null };
    return { data: { ok: true, custo_usd: 0 }, error: null };
  });
});

const chamadasDe = (acao: string) => mock.invoke.mock.calls.filter((c: any[]) => c[0] === "mesa-publicidade" && c[1] && c[1].body && c[1].body.acao === acao).map((c: any[]) => c[1].body);

function Casca() {
  const [rascunho, setRascunho] = useState("");
  return h(AgenteDaPublicidade, { rascunho, onRascunho: setRascunho });
}

function montar(c: CampanhaDePublicidade) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const mesa = {
    clientId: CLIENTE, clientName: "AcelerIQ", userId: "u-1", isAdmin: true, podeRecarregar: true, saldoUsd: 50, catalogo, catalogoCarregando: false,
    atualizarCusto: vi.fn(), abrirRecarga: vi.fn(), abrirChaves: vi.fn(), abrirModelos: vi.fn(),
  } as unknown as MesaValor;
  const pub: MesaPublicidadeValor = { campanha: c, carregando: false, banco: true, abrirCampanha: vi.fn(), aplicar: vi.fn(), irPara: vi.fn(), pedirAoAgente: vi.fn() };
  return render(
    h(QueryClientProvider, { client: qc },
      h(MemoryRouter, { initialEntries: [`/mesa-publicidade?client=${CLIENTE}`] },
        h(TooltipProvider, null, h(MesaProvider, { valor: mesa, children: h(MesaPublicidadeProvider, { valor: pub, children: h(Casca) }) })))),
  );
}

const bolhasCom = (texto: string) => screen.queryAllByText(texto).filter((el) => el.tagName !== "TEXTAREA");

describe("tela do agente da campanha", () => {
  it("envio que falha: a bolha sai e o texto volta; o aviso de registro e o \"Aprendi\" aparecem na resposta", async () => {
    respostas.agente_historico = { conversa_id: null, mensagens: [] };
    respostas.agente_conversar = { error: "conversa_indisponivel", mensagem: "Não foi possível falar com o agente agora." };
    montar(campanha());
    await waitFor(() => expect(chamadasDe("agente_historico")).toHaveLength(1));
    const campo = screen.getByRole("textbox", { name: "Mensagem ao agente" }) as HTMLTextAreaElement;
    fireEvent.change(campo, { target: { value: "Nunca use fundo escuro" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar ao agente" }));
    await waitFor(() => expect(campo.value).toBe("Nunca use fundo escuro"));
    expect(bolhasCom("Nunca use fundo escuro")).toHaveLength(0);
    respostas.agente_conversar = {
      conversa_id: U(77), mensagem_id: null, resposta: "Anotado.", custo_usd: 0.001,
      anexos: [{ tipo: "aprendizado_do_agente", id: null, texto: "Não usar fundo escuro", categoria: "evitar", decisao: "incerto", situacao: null, reforcos: null, mesa: "publicidade" }],
      aviso_registro: "A resposta chegou, mas não ficou guardada na conversa.",
    };
    fireEvent.click(screen.getByRole("button", { name: "Enviar ao agente" }));
    await screen.findByText("Anotado.");
    expect(bolhasCom("Nunca use fundo escuro")).toHaveLength(1);
    expect(document.querySelector("[data-aviso-registro]")!.textContent).toContain("não ficou guardada");
    fireEvent.click(screen.getByRole("button", { name: /Guardar/ }));
    await waitFor(() => expect(chamadasDe("aprendizado_guardar")).toHaveLength(1));
    expect(chamadasDe("aprendizado_guardar")[0]).toMatchObject({ client_id: CLIENTE, texto: "Não usar fundo escuro", tipo: "evitar" });
  });

  it("reprovar com motivo pela Revisão: o \"Aprendi\" aparece com Esquecer", async () => {
    respostas.revisao_decidir = { campanha: campanha(), aprendido: { tipo: "aprendizado_do_agente", id: U(600), texto: "Não mostrar o produto de costas", categoria: "evitar" } };
    await decidirRevisao(campanha(), { foto_tomada_id: "t1", versao: 1, decisao: "reprovar", motivo: "nunca mostre de costas" });
    expect(toast.success).toHaveBeenCalledWith("Aprendi", expect.objectContaining({ description: "Não mostrar o produto de costas", action: expect.objectContaining({ label: "Esquecer" }) }));
  });
});
