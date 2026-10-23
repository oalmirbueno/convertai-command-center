// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { gradeDoMes, normalizarCadencia, type CadenciaDoMes } from "../../supabase/functions/agente-calendario/modulos/cadencia-do-mes";
import { perfilDaMistura } from "../../supabase/functions/agente-calendario/modulos/mistura-do-nicho";
import {
  blocoDaEscolha,
  cadenciaComEscolha,
  caminhoDoNicho,
  caminhosDosVideos,
  formatosNaEscolha,
  mixDaEscolha,
  normalizarEscolha,
  opcaoDoItem,
  opcaoDoTexto,
  pedidoDosStories,
  storiesDoPlano,
  tituloDosStories,
} from "../../supabase/functions/agente-calendario/modulos/escolha-do-mes";
import {
  escopoDaEsteira,
  formatosDasOpcoes,
  passosDaTroca,
  pecaNaoFeita,
  perguntasDaTroca,
  protecaoDaPeca,
  recomendadaDaTroca,
  type PecaDaEsteira,
} from "../../supabase/functions/agente-calendario/modulos/troca-da-peca";
import { normalizarAcoesNaAgenda, pecasComApelido } from "../../supabase/functions/agente-calendario/acoes-agenda";
import { desfazerPassosDoFormato, gravarPassosDoFormato } from "../../supabase/functions/agente-calendario/mudanca-de-formato";
import { pedidoDoCalendario } from "@/components/mesa/pedidoDoPeriodo";
import { corpoDoPedidoLivre } from "@/components/mesa/mesaV4Api";

/**
 * 24/10/2026. Dono: "Só entram Story e vídeos com roteiro ou IA para selecionar quando eu for preparar; e também ter
 * o poder de trocar conteúdos se eu quiser e não gostar da esteira que tem pronta". Prova que: Stories e os dois
 * caminhos do vídeo entram na mistura quando escolhidos (a escolha manda sobre o nicho); trocar uma peça muda só ela
 * e Desfazer volta; refazer a esteira deixa as protegidas de fora.
 */

const ler = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");
const servico = perfilDaMistura("servico_que_explica");
const ambiente = perfilDaMistura("ambiente_e_projeto");
const base = (por_semana: number): CadenciaDoMes => ({ por_semana, mix: null, dias: [], fonte: "tela" });
const soma = (m: { foto: number; carrossel: number; estatico: number; video?: number; arte: number }) => m.foto + m.carrossel + m.estatico + (m.video || 0) + m.arte;

describe("escolha de formatos na preparação: Stories e os dois caminhos do vídeo", () => {
  it("lê a escolha da tela e do texto, sem repetir e na ordem dos chips", () => {
    expect(normalizarEscolha(["stories", "video_ia", "lixo", "stories", "carrossel"])).toEqual(["carrossel", "video_ia", "stories"]);
    expect(opcaoDoTexto("Stories")).toBe("stories");
    expect(opcaoDoTexto("vídeo para gravar")).toBe("video_gravar");
    expect(opcaoDoTexto("reels com IA")).toBe("video_ia");
    expect(opcaoDoTexto("vídeo")).toBeNull();
    expect(opcaoDoTexto("carrossel")).toBe("carrossel");
  });

  it("vídeo e Stories entram na mistura quando escolhidos; só os formatos escolhidos ficam", () => {
    const c = cadenciaComEscolha(base(4), ambiente, ["carrossel", "video_gravar", "video_ia", "stories"], null);
    expect(c.mix).not.toBeNull();
    expect(soma(c.mix!)).toBe(4);
    expect(c.mix!.video).toBeGreaterThan(0);
    expect(c.mix!.carrossel).toBeGreaterThan(0);
    // A escolha manda sobre o nicho: foto pesa 3 no paisagismo, mas não foi escolhida.
    expect(c.mix!.foto).toBe(0);
    expect(c.mix!.estatico).toBe(0);
    expect(c.stories).toBeGreaterThan(0);
    expect(c.videos).toBeDefined();
    expect(c.videos!.gravar + c.videos!.ia).toBe(c.mix!.video);
    expect(c.videos!.gravar).toBeGreaterThan(0);
    expect(c.videos!.ia).toBeGreaterThan(0);
    expect(c.escolha).toEqual(["carrossel", "video_gravar", "video_ia", "stories"]);
    // A grade do mês só tem vagas nos formatos escolhidos.
    const formatos = new Set(gradeDoMes(c, "2026-11-02", "2026-11-27").map((v) => v.formato));
    expect([...formatos].sort()).toEqual(["carrossel", "video"]);
  });

  it("só o caminho escolhido leva os vídeos; sem os dois, o nicho decide", () => {
    const so = cadenciaComEscolha(base(3), ambiente, ["video_gravar", "foto"], null);
    expect(so.videos).toEqual({ gravar: so.mix!.video, ia: 0 });
    expect(caminhoDoNicho(servico)).toBe("gravar");
    expect(caminhoDoNicho(ambiente)).toBe("ia");
    expect(caminhosDosVideos(3, null, ambiente)).toEqual(["ia", "ia", "ia"]);
    expect(caminhosDosVideos(4, { gravar: 1, ia: 1 }, ambiente)).toEqual(["gravar", "ia", "gravar", "ia"]);
    expect(caminhosDosVideos(3, { gravar: 0, ia: 2 }, servico)).toEqual(["ia", "ia", "ia"]);
  });

  it("cada formato escolhido aparece na semana quando cabe e nenhum passa da metade", () => {
    const mix = mixDaEscolha(servico, 4, ["carrossel", "estatico", "foto", "video_ia"], null);
    expect(mix.carrossel).toBeGreaterThan(0);
    expect(mix.estatico).toBeGreaterThan(0);
    expect(mix.foto).toBeGreaterThan(0);
    expect(mix.video).toBeGreaterThan(0);
    const cinco = mixDaEscolha(servico, 5, ["carrossel", "video_gravar"], null);
    expect(soma(cinco)).toBe(5);
    expect(Math.max(cinco.carrossel, cinco.video || 0)).toBeLessThanOrEqual(3);
  });

  it("sem escolha a cadência fica como estava (o nicho segue valendo)", () => {
    const c = base(3);
    expect(cadenciaComEscolha(c, servico, [], null)).toBe(c);
  });

  it("a cadência guardada mantém Stories, caminhos e a escolha (o detalhar e o gravar leem)", () => {
    const c = cadenciaComEscolha(base(3), servico, ["carrossel", "video_gravar", "stories"], null);
    const relida = normalizarCadencia(JSON.parse(JSON.stringify(c)));
    expect(relida!.stories).toBe(c.stories);
    expect(relida!.videos).toEqual(c.videos);
    expect(relida!.escolha).toEqual(["carrossel", "video_gravar", "stories"]);
    expect(relida!.mix).toEqual(c.mix);
  });

  it("os itens fora da escolha vão para um formato escolhido, na parte de cada um", () => {
    const mix = mixDaEscolha(ambiente, 3, ["carrossel", "video_ia"], null);
    const saida = formatosNaEscolha(["carrossel", "foto", "estatico", "carrossel", "video", "foto"], mix);
    expect(saida.every((f) => f === "carrossel" || f === "video")).toBe(true);
    expect(saida.filter((f) => f === "video").length).toBeGreaterThan(0);
    expect(saida[0]).toBe("carrossel");
    expect(saida[4]).toBe("video");
  });

  it("Stories do mês: até N por semana, no dia do post que puxa, com o tema dele", () => {
    const itens = [
      { data: "2026-11-02", tema: "Poda de outono", tema_id: "p1" },
      { data: "2026-11-04", tema: "Peça de foto: Jardim vertical", tema_id: "p2" },
      { data: "2026-11-06", tema: "Rega certa", tema_id: "p3" },
      { data: "2026-11-10", tema: "Gramado", tema_id: "p4" },
    ];
    const s = storiesDoPlano(itens, 2);
    expect(s.map((x) => x.data)).toEqual(["2026-11-02", "2026-11-06", "2026-11-10"]);
    expect(s[0]).toEqual({ tema_id: "s1", data: "2026-11-02", tema: "Poda de outono", base: "p1" });
    expect(storiesDoPlano(itens, 0)).toEqual([]);
    expect(tituloDosStories("Peça de foto: Jardim vertical")).toBe("Stories: Jardim vertical");
    expect(pedidoDosStories("Stories: Rega certa")).toContain("Rega certa");
  });

  it("o bloco do prompt diz os formatos escolhidos e que os Stories são do painel", () => {
    const b = blocoDaEscolha(["foto", "video_gravar", "stories"]);
    expect(b).toContain("FORMATOS ESCOLHIDOS PELA EQUIPE");
    expect(b).toContain("Vídeo para gravar");
    expect(b).toContain("não crie item de story");
    expect(b).not.toMatch(/—/);
  });

  it("o Novo calendário leva a escolha ao pedido livre e recusa só Stories", () => {
    const pedido = pedidoDoCalendario({ clientId: "c1", mes: "2026-11-01", inicio: "2026-11-02", dias: 14, tema: "", tipos: ["educativo"], formatos: ["video_ia", "stories"] });
    expect(pedido.formatos).toEqual(["video_ia", "stories"]);
    expect(pedido.mensagem).toContain("Formatos escolhidos: Vídeo com IA, Stories");
    expect(corpoDoPedidoLivre(pedido).formatos).toEqual(["video_ia", "stories"]);
    expect(() => pedidoDoCalendario({ clientId: "c1", mes: "2026-11-01", inicio: "2026-11-02", dias: 14, tema: "", tipos: ["educativo"], formatos: ["stories"] })).toThrow(/formato de post/);
    expect(corpoDoPedidoLivre(pedidoDoCalendario({ clientId: "c1", mes: "2026-11-01", inicio: "2026-11-02", dias: 14, tema: "", tipos: ["educativo"] })).formatos).toBeUndefined();
  });

  it("o servidor lê a escolha nos três caminhos da preparação e marca o caminho do vídeo", () => {
    const fonte = ler("supabase/functions/agente-calendario/index.ts");
    // proporTemas (gerador de meses), pedidoLivre (Novo calendário) e o detalhar.
    expect(fonte).toContain("const formatosEscolhidos = normalizarEscolha(corpo.formatos);");
    expect(fonte).toContain("normalizarEscolha(corpo.formatos)");
    expect(fonte).toContain("item.caminho_video = caminhoDoTema.get(t.id)");
    // O gravar marca o caminho e põe os Stories na agenda junto com os posts.
    expect(fonte).toContain("marcarCaminhosDosVideos(p.itens, p.parametros);");
    expect(fonte).toContain("await gravarStoriesDoPlano(servico, chamador, p, projectId, itensComTarefa, dataScope)");
    expect(fonte).toContain('format: "story" as const');
  });
});

// ------------------------------------------------------------------ troca

const peca = (id: string, data: string, extra: Partial<PecaDaEsteira> = {}): PecaDaEsteira => ({ id, title: `Peça ${id}`, due_date: data, delivery_type: "carousel", ...extra });

describe("trocar o que não gostou", () => {
  it("proteção: arte pronta, post vinculado, publicação, aprovação e pedido do cliente não trocam", () => {
    expect(protecaoDaPeca({})).toBeNull();
    expect(protecaoDaPeca({ artePronta: true })).toMatch(/arte pronta/);
    expect(protecaoDaPeca({ temPost: true })).toMatch(/post vinculado/);
    expect(protecaoDaPeca({ publicacao: "published", temPost: true })).toMatch(/publicada/);
    expect(protecaoDaPeca({ publicacao: "scheduled" })).toMatch(/agendada/);
    expect(protecaoDaPeca({ entrega: "aprovado" })).toMatch(/aprovada/);
    expect(protecaoDaPeca({ dePedido: true })).toMatch(/pedido do cliente/);
    expect(protecaoDaPeca({ status: "done" })).toMatch(/concluída/);
    expect(pecaNaoFeita({ emProducao: true })).toBe(false);
    expect(pecaNaoFeita({})).toBe(true);
  });

  it("refazer a esteira preserva as protegidas e mostra o motivo; só as não feitas deixa as em produção", () => {
    const pecas = [
      peca("a", "2026-11-03"),
      peca("b", "2026-11-04", { artePronta: true }),
      peca("c", "2026-11-05", { temPost: true }),
      peca("d", "2026-11-06", { emProducao: true }),
      peca("e", "2026-11-12"),
      peca("f", "2026-10-30"),
      peca("g", "2026-11-02"),
    ];
    const mes = escopoDaEsteira(pecas, { mes: "2026-11", soNaoFeitas: false, hoje: "2026-11-03" });
    expect(mes.refazer.map((p) => p.id)).toEqual(["a", "d", "e"]);
    expect(mes.protegidas.map((p) => [p.task_id, p.motivo])).toEqual([
      ["b", "Tem arte pronta no Estúdio."],
      ["c", "Tem post vinculado na Agenda."],
    ]);
    const naoFeitas = escopoDaEsteira(pecas, { mes: "2026-11", soNaoFeitas: true, hoje: "2026-11-03" });
    expect(naoFeitas.refazer.map((p) => p.id)).toEqual(["a", "e"]);
    expect(naoFeitas.protegidas.find((p) => p.task_id === "d")!.motivo).toMatch(/produção/);
    const semana = escopoDaEsteira(pecas, { mes: "2026-11", semana: "2026-11-04", soNaoFeitas: false, hoje: "2026-11-03" });
    expect(semana.refazer.map((p) => p.id)).toEqual(["a", "d"]);
  });

  it("as opções: formato pedido nas 3; livre, a de agora com tema novo e mais duas em outros formatos", () => {
    expect(formatosDasOpcoes("carrossel", "video_ia")).toEqual(["video_ia", "video_ia", "video_ia"]);
    const livre = formatosDasOpcoes("carrossel", null, ["video_gravar", "foto"]);
    expect(livre).toEqual(["carrossel", "video_gravar", "foto"]);
    expect(new Set(livre).size).toBe(3);
  });

  it("o Jev dá uma nota por opção numa pergunta só e a recomendada é a de maior nota", () => {
    const q = perguntasDaTroca(3);
    expect(Object.keys(q)).toEqual(["o0", "o1", "o2"]);
    expect(q.o1.type).toBe("score");
    expect(q.o1.instructions).toContain("`opcoes[1]`");
    expect(recomendadaDaTroca({ o0: { score: 1.2 }, o1: { score: 2.7 }, o2: { score: 2.1 } }, 3)).toEqual({ indice: 1, notas: [1.2, 2.7, 2.1], fonte: "jev" });
    expect(recomendadaDaTroca(null, 3)).toEqual({ indice: 0, notas: [null, null, null], fonte: "ordem" });
  });

  it("o agente: 'troca o do dia 12 por um vídeo' vira trocar na peça, sem mexer em nada", () => {
    const pecas = pecasComApelido([
      { id: "t1", title: "Poda", due_date: "2026-11-12", delivery_type: "carousel", status: "todo" },
      { id: "t2", title: "Rega", due_date: "2026-11-13", delivery_type: "static", status: "todo" },
    ]);
    const acao = normalizarAcoesNaAgenda({ resumo: "", trocar: [{ ref: "a1", formato: "video_ia", pedido: "um vídeo" }, { ref: "zz", formato: "", pedido: "" }] }, pecas);
    expect(acao).not.toBeNull();
    expect(acao!.trocar).toEqual([{ task_id: "t1", titulo: "Poda", data: "2026-11-12", formato: "carrossel", opcao: "video_ia", pedido: "um vídeo" }]);
    expect(acao!.apagar).toEqual([]);
    expect(acao!.refazer).toEqual([]);
    expect(acao!.mudar_formato).toEqual([]);
    expect(acao!.ignorados).toEqual(["zz"]);
    expect(acao!.resumo).toContain("trocar 1 peça");
  });

  it("a peça de agora vira a opção certa (vídeo pelo caminho, Stories pela marca)", () => {
    expect(opcaoDoItem({ formato: "video", caminho_video: "gravar" })).toBe("video_gravar");
    expect(opcaoDoItem({ formato: "video" }, perfilDaMistura("ambiente_e_projeto"))).toBe("video_ia");
    expect(opcaoDoItem({ formato: "estatico", stories: true })).toBe("stories");
    expect(opcaoDoItem({ formato: "foto" })).toBe("foto");
  });
});

// ------------------------------------------------------------------ aplicar e desfazer (banco de mentira)

type Linha = Record<string, unknown>;
function bancoFalso(tabelas: Record<string, Linha[]>) {
  let relogio = 1;
  const consulta = (tabela: string, valores?: Linha) => {
    const filtros: Array<(l: Linha) => boolean> = [];
    const linhas = () => (tabelas[tabela] || []).filter((l) => filtros.every((f) => f(l)));
    const q: Record<string, unknown> = {};
    q.eq = (c: string, v: unknown) => (filtros.push((l) => l[c] === v), q);
    q.is = (c: string, v: unknown) => (filtros.push((l) => (l[c] ?? null) === v), q);
    q.maybeSingle = async () => ({ data: linhas()[0] ? JSON.parse(JSON.stringify(linhas()[0])) : null, error: null });
    // update(...).eq(...).select(): grava e devolve as linhas gravadas (o atualizarConfirmado exige uma).
    q.select = async () => {
      const achadas = linhas();
      for (const l of achadas) Object.assign(l, JSON.parse(JSON.stringify(valores || {})), tabela === "tasks" ? { updated_at: `t${++relogio}` } : { atualizado_em: `t${++relogio}` });
      return { data: achadas.map((l) => ({ id: l.id })), error: null, status: 200 };
    };
    return q;
  };
  return { from: (t: string) => ({ select: () => consulta(t), update: (v: Linha) => consulta(t, v) }) };
}

describe("troca de uma peça: muda só ela e Desfazer volta", () => {
  it("grava o item, a direção sem arte e a tarefa; os outros itens e a arte pronta ficam; Desfazer devolve tudo", async () => {
    const itemA = { tema_id: "p1", task_id: "t1", tema: "Poda", formato: "carrossel", cards: [{ ordem: 1, texto: "x" }] };
    const itemB = { tema_id: "p2", task_id: "t2", tema: "Rega", formato: "estatico", cards: [{ ordem: 1, texto: "y" }] };
    const tabelas: Record<string, Linha[]> = {
      calendario_propostas: [{ id: "pr", client_id: "c1", atualizado_em: "t0", itens: [itemA, itemB] }],
      estudio_trabalhos: [
        { id: "w1", client_id: "c1", atualizado_em: "t0", task_id: "t1", direcao: { conceito: "Poda" }, status: "dirigido", cards: [], entrega_status: null },
      ],
      tasks: [
        { id: "t1", updated_at: "t0", deleted_at: null, delivery_type: "carousel", title: "Poda", description: "antes" },
        { id: "t2", updated_at: "t0", deleted_at: null, delivery_type: "static", title: "Rega", description: "outra" },
      ],
    };
    const antesDeTudo = JSON.parse(JSON.stringify(tabelas));
    const novo = { tema_id: "p1", task_id: "t1", tema: "Antes e depois do jardim", formato: "video", caminho_video: "ia", cards: [] };
    const passos = passosDaTroca({
      taskId: "t1",
      tarefa: { delivery_type: "carousel", title: "Poda", description: "antes" },
      depois: { delivery_type: "reel", title: "Antes e depois do jardim", description: "depois" },
      proposta: { id: "pr", itens: [itemA, itemB] },
      novoItem: novo,
      trabalhos: [{ id: "w1", direcao: { conceito: "Poda" }, status: "dirigido", cards: [], entrega_status: null }],
      direcao: { mesa: "video", cards: [] },
    });
    expect(passos.map((p) => p.tabela)).toEqual(["calendario_propostas", "estudio_trabalhos", "tasks"]);
    const db = bancoFalso(tabelas);
    await gravarPassosDoFormato(db, passos as never, "c1");
    expect((tabelas.calendario_propostas[0].itens as Linha[])[0]).toEqual(novo);
    expect((tabelas.calendario_propostas[0].itens as Linha[])[1]).toEqual(itemB);
    expect(tabelas.tasks[0]).toMatchObject({ delivery_type: "reel", title: "Antes e depois do jardim", description: "depois" });
    expect(tabelas.tasks[1]).toEqual(antesDeTudo.tasks[1]);
    expect(tabelas.estudio_trabalhos[0]).toMatchObject({ status: "rascunho", direcao: { mesa: "video", cards: [] } });
    await desfazerPassosDoFormato(db, passos as never, "c1");
    const sem = (ls: Linha[]) => ls.map((l) => { const c = { ...l }; delete c.updated_at; delete c.atualizado_em; return c; });
    for (const t of Object.keys(antesDeTudo)) expect(sem(tabelas[t])).toEqual(sem(antesDeTudo[t]));
  });

  it("arte pronta no Estúdio não entra nos passos (a troca não apaga produção)", () => {
    const passos = passosDaTroca({
      taskId: "t1",
      tarefa: { delivery_type: "carousel", title: "Poda", description: null },
      depois: { delivery_type: "static", title: "Novo", description: "d" },
      proposta: null,
      novoItem: {},
      trabalhos: [
        { id: "w1", direcao: {}, status: "pronto", cards: [{}], entrega_status: null },
        { id: "w2", direcao: {}, status: "rascunho", cards: [], entrega_status: "enviado" },
      ],
      direcao: { conceito: "Novo" },
    });
    expect(passos.map((p) => p.tabela)).toEqual(["tasks"]);
  });

  it("peça que mudou desde a leitura não troca (CAS) e nada fica pela metade", async () => {
    const tabelas: Record<string, Linha[]> = {
      calendario_propostas: [{ id: "pr", client_id: "c1", atualizado_em: "t0", itens: [{ task_id: "t1", tema: "Outro" }] }],
      tasks: [{ id: "t1", updated_at: "t0", deleted_at: null, delivery_type: "carousel", title: "Poda", description: "antes" }],
    };
    const passos = passosDaTroca({
      taskId: "t1",
      tarefa: { delivery_type: "carousel", title: "Poda", description: "antes" },
      depois: { delivery_type: "reel", title: "Novo", description: "d" },
      proposta: { id: "pr", itens: [{ task_id: "t1", tema: "Poda" }] },
      novoItem: { task_id: "t1", tema: "Novo" },
      trabalhos: [],
      direcao: null,
    });
    await expect(gravarPassosDoFormato(bancoFalso(tabelas), passos as never, "c1")).rejects.toThrow(/mudou desde a leitura/);
    expect(tabelas.tasks[0]).toMatchObject({ title: "Poda", delivery_type: "carousel" });
  });
});

describe("contratos do servidor da troca", () => {
  const fonte = ler("supabase/functions/agente-calendario/index.ts");
  it("as ações existem, são longas e a troca só aplica com a escolha guardada", () => {
    for (const a of ["trocar_peca_opcoes: trocarPecaOpcoes", "trocar_peca_aplicar: trocarPecaAplicar", "trocar_peca_desfazer: trocarPecaDesfazer", "propor_refazer_esteira: proporRefazerEsteira"]) expect(fonte).toContain(a);
    expect(fonte).toMatch(/ACOES_LONGAS = new Set\(\[[^\]]*"trocar_peca_opcoes"/);
    // A proteção vale de novo no aplicar e no refazer confirmado.
    expect(fonte).toContain('throw new ErroHttp(409, "peca_protegida"');
    expect(fonte).toContain("await separarProtegidasDoRefazer(servico, m.client_id, refazerPedido)");
    // O Jev é cobrado logo depois da pergunta das opções.
    const i = fonte.indexOf("questions: perguntasDaTroca(opcoes.length)");
    expect(i).toBeGreaterThan(0);
    expect(fonte.slice(i, i + 400)).toContain("await cobrarJev(");
  });
});
