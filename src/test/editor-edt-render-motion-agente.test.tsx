import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement as h } from "react";
import { render, screen } from "@testing-library/react";
import { Thumbnail } from "@remotion/player";
import { afterEach, describe, expect, it, vi } from "vitest";
import { projetoDosTakes, type ProjetoDeEdicao } from "../../supabase/functions/_shared/projeto-de-edicao";
import { CONSULTA_MINIMA_MS, fontesUsadas, janelaDaAmostra, lerPedidoDeRender, proximaConsultaEm, recortarProjeto, situacaoDoWorker, caminhoDaSaida } from "../../supabase/functions/_shared/render-do-editor";
import { FERRAMENTAS_DE_SAIDA, FERRAMENTAS_DO_SERVIDOR, NOMES_DAS_FERRAMENTAS, ANEXOS_ACEITOS } from "../../supabase/functions/editor-video/ferramentas";
import { escolherSugestoes, frasesDoCorpo, perguntasDasFrases } from "../../supabase/functions/editor-video/animacoes";
import { escolherModeloDoElemento, promptDoElemento } from "../../supabase/functions/editor-video/elemento-regras";
import { aplicarOperacao, trilhaPrincipal } from "@/lib/editor/operacoes";
import { executarFerramenta, rodarAgente } from "@/lib/editor/agente";
import { acharNaFala, CATALOGO_DE_MOTION, numeroFoiDito, parametrosDaPeca, PECAS_DE_MOTION, temposDosItens, type IdDaPeca } from "@/lib/editor/motion/catalogo";
import { candidatasDaFrase } from "@/lib/editor/motion/sugestoes";
import { acaoDaSaida, opsDoArquivoNoTrecho } from "@/lib/editor/geracaoDoAgente";
import { _limparVigias, fontesSemOnda, opsDaOnda, pedirRender, useFilaDeRender, type PedidoNaFila } from "@/lib/editor/render";
import { PecaDeMotion } from "@/components/mesa-edicao/editor/motion/Pecas";

/**
 * Frente EDT (30/09): fila de render (regras puras, SQL por contrato, vigia da
 * tela sem laço), peças de motion (um quadro de cada), sugestão de animações
 * (Jev com respostas simuladas) e as ferramentas novas do agente editor.
 */

const AGORA = "2026-09-30T12:00:00.000Z";

function projeto(): ProjetoDeEdicao {
  let p = projetoDosTakes({ titulo: "Reel", fps: 25, takes: [{ id: "a", nome: "fala.mp4", tipo: "bruto", storage_bucket: "mesa", storage_path: "cli/video/brutos/a.mp4", cena_ref: null, melhor: true, duracao_s: 12, largura: 1080, altura: 1920 }], agora: AGORA });
  const palavras = "Hoje vou mostrar 300 clientes atendidos, preço de R$ 97, com garantia de 7 dias. Comenta EU QUERO aqui".split(" ");
  p = aplicarOperacao(p, { op: "transcricao", fonte: "fala", transcricao: { por_palavra: true, origem: "t", versao: 1, em: AGORA, segmentos: palavras.map((t, k) => ({ t, i: 0.5 + k * 0.5, f: 0.9 + k * 0.5 })) } });
  return p;
}

describe("render pela fila: regras puras", () => {
  it("amostra de 8 a 15 s dentro do vídeo; consulta nunca antes de 15 s", () => {
    expect(janelaDaAmostra(2, 5, 60)).toEqual({ inicio_s: 2, fim_s: 10 });
    expect(janelaDaAmostra(2, 40, 60)).toEqual({ inicio_s: 2, fim_s: 17 });
    expect(janelaDaAmostra(55, 70, 60)).toEqual({ inicio_s: 52, fim_s: 60 });
    expect(janelaDaAmostra(undefined, undefined, 30)).toEqual({ inicio_s: 0, fim_s: 12 });
    expect(proximaConsultaEm(1000, 2000)).toBe(1000 + CONSULTA_MINIMA_MS);
    expect(proximaConsultaEm(null, 2000)).toBe(2000);
    expect(situacaoDoWorker(new Date(Date.now() - 30_000).toISOString(), Date.now())).toBe("ligado");
    expect(situacaoDoWorker(new Date(Date.now() - 600_000).toISOString(), Date.now())).toBe("desligado");
    expect(caminhoDaSaida("cli", "p1", "amostra")).toBe("cli/video/render/amostras/p1.mp4");
  });

  it("pedido: uid do clique obrigatório, tipo conhecido", () => {
    expect(() => lerPedidoDeRender({ tipo: "render_final" }, 10)).toThrow(/uid/);
    expect(() => lerPedidoDeRender({ tipo: "gif", uid: "abcdefgh1" }, 10)).toThrow(/Tipo/);
    expect(lerPedidoDeRender({ tipo: "amostra", uid: "abcdefgh1", inicio_s: 1, fim_s: 30 }, 60)).toMatchObject({ inicio_s: 1, fim_s: 16 });
  });

  it("recorte da amostra: clipes aparados, entrada anda junto, legenda e peça guardam quanto já andaram", () => {
    let p = projeto();
    p = aplicarOperacao(p, { op: "trilha_nova", tipo: "texto" });
    p = aplicarOperacao(p, { op: "inserir", trilha: "texto-1", clipe: { inicio_s: 2, entrada_s: 0, saida_s: 4, texto: "a b", estilo: { palavras: [{ t: "a", i: 0, f: 1 }, { t: "b", i: 2, f: 3 }] } } });
    const r = recortarProjeto(p, 3, 11);
    const v = trilhaPrincipal(r)!.clipes[0];
    expect(v).toMatchObject({ inicio_s: 0, entrada_s: 3, saida_s: 11 });
    const t = r.trilhas.find((x) => x.tipo === "texto")!.clipes.find((c) => c.texto === "a b")!;
    expect(t).toMatchObject({ inicio_s: 0, entrada_s: 1, saida_s: 4 });
    expect((t.estilo as Record<string, unknown>)._desde_s).toBe(1);
    expect(((t.estilo as { palavras: { i: number }[] }).palavras)[1].i).toBe(1);
    expect(r.duracao_s).toBe(8);
    expect(fontesUsadas(r)).toEqual(["fala"]);
  });

  it("SQL: idempotente, um ativo por versão, SKIP LOCKED, só service_role escreve, RLS por cliente", () => {
    const sql = readFileSync(path.resolve(__dirname, "../../supabase/migrations/20260930080000_render_pedidos.sql"), "utf8");
    expect(sql).toMatch(/UNIQUE \(client_id, uid\)/);
    expect(sql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS render_pedidos_ativo_unico\s+ON public\.render_pedidos \(versao_id, tipo\) WHERE estado IN \('fila', 'rodando'\)/);
    expect(sql).toMatch(/FOR UPDATE SKIP LOCKED/);
    expect(sql).toMatch(/public\.can_access_client\(client_id\)/);
    expect(sql).toMatch(/REVOKE INSERT, UPDATE, DELETE ON public\.render_pedidos FROM authenticated/);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.render_pedidos_pegar\(uuid, text, integer, text\) TO service_role;/);
    expect(sql).not.toMatch(/GRANT EXECUTE ON FUNCTION public\.render_pedidos_\w+\([^)]*\) TO authenticated/);
    expect(sql).toMatch(/trava_token = _token AND estado = 'rodando'/);
  });
});

describe("vigia da fila na tela (sem laço)", () => {
  afterEach(() => {
    _limparVigias();
    vi.useRealTimers();
  });

  function Vigia({ chamar, aoTerminar }: { chamar: (c: Record<string, unknown>) => Promise<any>; aoTerminar?: (p: PedidoNaFila) => void }) {
    const f = useFilaDeRender("cli", "ver", chamar, aoTerminar, true);
    return h("p", null, `pedidos ${f.pedidos.length} ${f.pedidos[0] ? f.pedidos[0].estado : "-"}`);
  }

  it("lê uma vez ao abrir; com pedido ativo, de novo só depois de 15 s; pronto avisa e para", async () => {
    vi.useFakeTimers();
    const pedido = (estado: string): PedidoNaFila => ({ id: "p1", tipo: "amostra", estado: estado as PedidoNaFila["estado"], etapa: null, progresso: 0, entrada: {}, resultado: null, erro_mensagem: null, criado_em: new Date().toISOString(), concluido_em: null, arquivo_id: null, url: null });
    const respostas = [{ pedidos: [pedido("rodando")] }, { pedidos: [pedido("pronto")] }];
    const chamar = vi.fn(async () => respostas.shift() || { pedidos: [pedido("pronto")] });
    const terminou = vi.fn();
    render(h(Vigia, { chamar, aoTerminar: terminou }));
    await vi.advanceTimersByTimeAsync(10);
    expect(chamar).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(14_000);
    expect(chamar).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_100);
    expect(chamar).toHaveBeenCalledTimes(2);
    expect(terminou).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(chamar).toHaveBeenCalledTimes(2);
  });

  it("pedir põe na fila com o uid do clique e a onda volta como operações do projeto", async () => {
    const chamar = vi.fn(async (c: Record<string, unknown>) => (c.acao === "render_pedir" ? { pedido: { id: "p9", tipo: "onda", estado: "fila" }, ja_existia: false } : { pedidos: [] }));
    const r = await pedirRender(chamar, { clientId: "cli", versaoId: "v2", tipo: "onda", uid: "clique-123", fontes: ["fala"] });
    expect(chamar).toHaveBeenCalledWith(expect.objectContaining({ acao: "render_pedir", tipo: "onda", uid: "clique-123", fontes: ["fala"] }));
    expect(r.pedido.id).toBe("p9");
    const p = projeto();
    expect(fontesSemOnda(p)).toEqual(["fala"]);
    const ops = opsDaOnda(p, { ...r.pedido, estado: "pronto", resultado: { ondas: { fala: { janela_s: 0.01, limiar_db: -40, chao_db: -60, duracao_s: 12, pausas: [{ de_s: 0.3, ate_s: 0.7 }], lufs: -17, em: AGORA } } } } as PedidoNaFila, AGORA);
    expect(ops.map((o) => o.op)).toEqual(["onda", "transcricao"]);
    const depois = ops.reduce((x, o) => aplicarOperacao(x, o), p);
    expect(depois.transcricoes.fala.segmentos[0].i).toBe(0.7);
    expect(fontesSemOnda(depois)).toEqual([]);
  });
});

describe("motion: catálogo, tempo da palavra e um quadro de cada peça", () => {
  it("13 peças com parâmetros tipados, mais a logo", () => {
    expect(PECAS_DE_MOTION.length).toBe(14);
    expect(CATALOGO_DE_MOTION.map((p) => p.id)).toEqual(PECAS_DE_MOTION.slice());
    expect(() => parametrosDaPeca("contador", {})).toThrow(/falta número dito/);
    expect(parametrosDaPeca("barra", { valor: "140" }).valor).toBe(100);
    expect(parametrosDaPeca("lista", { itens: "a; b; c" }).itens).toEqual(["a", "b", "c"]);
    expect(parametrosDaPeca("rotulo", { texto: "x", cor: "verde" }).cor).toBeNull();
  });

  it("o tempo sai da palavra medida; número só se foi dito", () => {
    const fala = [{ t: "Hoje", i: 0.5, f: 0.9 }, { t: "300", i: 1, f: 1.4 }, { t: "clientes,", i: 1.5, f: 2 }, { t: "e", i: 2.1, f: 2.2 }, { t: "mais", i: 2.3, f: 2.6 }];
    expect(acharNaFala(fala, "clientes")).toEqual({ i: 1.5, f: 2 });
    expect(acharNaFala(fala, "300 clientes")).toEqual({ i: 1, f: 2 });
    expect(acharNaFala(fala, "vendas")).toBeNull();
    expect(temposDosItens(["clientes", "mais"], fala, 1, 3)).toEqual([0.5, 1.3]);
    expect(numeroFoiDito(300, "atendi 300 clientes")).toBe(true);
    expect(numeroFoiDito(1500, "foram 1.500 pedidos")).toBe(true);
    expect(numeroFoiDito(400, "atendi 300 clientes")).toBe(false);
  });

  it.each(PECAS_DE_MOTION.filter((x) => x !== "logo" && x !== "polaroide").map((x) => [x]))("peça %s desenha um quadro", (id) => {
    const exemplos: Record<string, Record<string, unknown>> = {
      rotulo: { texto: "Rótulo X" },
      carimbo: { texto: "MITO" },
      lista: { itens: ["um", "dois"] },
      passos: { itens: ["abrir", "fechar"] },
      contador: { ate: 300, sufixo: " clientes" },
      notificacao: { titulo: "Nova venda" },
      cartao_final: { titulo: "Fale com a gente", botao: "Chamar" },
      lettering: { palavras: ["GRANDE", "IDEIA"] },
      barra: { valor: 80, rotulo: "Concluído" },
      preco: { por: "R$ 97" },
      comentario: { texto: "EU QUERO" },
      selo: { texto: "7 dias" },
    };
    const peca = id as IdDaPeca;
    const params = parametrosDaPeca(peca, exemplos[peca]);
    const { container } = render(
      h(Thumbnail, {
        component: () => h(PecaDeMotion, { peca, params, duracaoQuadros: 75, tempos: [0, 0.2] }),
        compositionWidth: 540,
        compositionHeight: 960,
        frameToDisplay: 40,
        durationInFrames: 75,
        fps: 25,
        acknowledgeRemotionLicense: true,
      } as any),
    );
    const texto = container.textContent || "";
    const esperado: Record<string, string> = { rotulo: "Rótulo X", carimbo: "MITO", lista: "dois", passos: "fechar", contador: "clientes", notificacao: "Nova venda", cartao_final: "Chamar", lettering: "IDEIA", barra: "Concluído", preco: "R$ 97", comentario: "EU QUERO", selo: "7 dias" };
    expect(texto).toContain(esperado[peca]);
  });
});

describe("sugerir animações (candidatas pelo código, escolha pelo Jev)", () => {
  it("o código monta só com o que foi dito", () => {
    const c = candidatasDaFrase("Atendi 300 clientes com garantia de 7 dias por R$ 97");
    expect(c.map((x) => x.peca)).toEqual(expect.arrayContaining(["preco", "selo"]));
    expect(c.find((x) => x.peca === "preco")!.params).toEqual({ por: "R$ 97" });
    expect(candidatasDaFrase("são 80% dos casos").find((x) => x.peca === "barra")!.params.valor).toBe(80);
    expect(candidatasDaFrase("uma bolsa, um sapato, um cinto e um relógio").find((x) => x.peca === "lista")!.params.itens).toEqual(["uma bolsa", "um sapato", "um cinto", "um relógio"]);
    expect(candidatasDaFrase("comenta EU QUERO aqui embaixo").find((x) => x.peca === "comentario")!.params.texto).toBe("EU QUERO aqui embaixo");
  });

  it("perguntas em paralelo (Noul + Choice por frase) e a escolha pelo limiar e pela densidade", () => {
    const frases = frasesDoCorpo([
      { k: "f1", inicio_s: 1, fim_s: 3, texto: "300 clientes", candidatas: ["contador", "rotulo", "inventada"] },
      { k: "f2", inicio_s: 4, fim_s: 6, texto: "R$ 97", candidatas: ["preco"] },
      { k: "f3", inicio_s: 20, fim_s: 22, texto: "passagem", candidatas: ["rotulo"] },
    ]);
    expect(frases[0].candidatas).toEqual(["contador", "rotulo"]);
    const q = perguntasDasFrases(frases);
    expect(Object.keys(q.questions)).toEqual(["pede_0", "peca_0", "pede_1", "peca_1", "pede_2", "peca_2"]);
    expect(q.questions.peca_0.type).toBe("choice");
    expect(Object.keys((q.questions.peca_0 as { criteria: Record<string, unknown> }).criteria)).toEqual(["contador", "rotulo", "nenhuma"]);
    const respostas = { pede_0: { noul: 0.9 }, peca_0: { choice: "contador" }, pede_1: { noul: 0.95 }, peca_1: { choice: "preco" }, pede_2: { noul: 0.3 }, peca_2: { choice: "rotulo" } };
    expect(escolherSugestoes(frases, respostas, "medias")).toEqual([{ k: "f2", peca: "preco", probabilidade: 0.95 }]);
    expect(escolherSugestoes(frases, { ...respostas, pede_1: { noul: 0.5 } }, "medias")).toEqual([{ k: "f1", peca: "contador", probabilidade: 0.9 }]);
    expect(escolherSugestoes(frases, { ...respostas, peca_0: { choice: "nenhuma" }, pede_1: { noul: 0.1 } }, "medias")).toEqual([]);
  });
});

describe("ferramentas novas do agente editor", () => {
  it("estão no esquema; as pagas viram cartão e as do servidor rodam no laço", () => {
    ["medir_onda", "ler_onda", "cortar_pela_onda", "ficar_com_melhor_tomada", "conferir_corte", "legendar", "animar", "sugerir_animacoes", "sons", "musica", "logo", "cartao_final", "amostra", "gerar_broll", "gerar_elemento", "renderizar"].forEach((n) => expect(NOMES_DAS_FERRAMENTAS).toContain(n));
    expect(FERRAMENTAS_DE_SAIDA).toEqual(expect.arrayContaining(["gerar_broll", "gerar_elemento", "renderizar"]));
    // Rodada 2: zoom nos momentos fortes e capítulos também vão ao servidor (Jev) dentro do laço.
    expect(FERRAMENTAS_DO_SERVIDOR).toEqual(["sugerir_animacoes", "medir_onda", "amostra", "zoom_momentos", "capitulos"]);
    ["formato", "cor", "zoom_momentos", "efeito", "capitulos"].forEach((n) => expect(NOMES_DAS_FERRAMENTAS).toContain(n));
    expect(ANEXOS_ACEITOS).toContain("padrao_do_editor");
  });

  it("legendar com N palavras, animar na palavra dita, sons no pico, logo só com a do kit", () => {
    const p = projeto();
    const l = executarFerramenta(p, { ferramenta: "legendar", argumentos: { palavras_por_vez: 2 } }, AGORA);
    expect(l.ok).toBe(true);
    expect(l.projeto.trilhas.find((t) => t.tipo === "legenda")!.clipes[0].texto).toBe("Hoje vou");
    const a = executarFerramenta(p, { ferramenta: "animar", argumentos: { peca: "contador", palavra_ref: "300", params: { ate: 300, sufixo: " clientes" } } }, AGORA);
    expect(a.ok).toBe(true);
    const peca = a.projeto.trilhas.find((t) => t.nome === "Motion")!.clipes[0];
    expect(peca.inicio_s).toBe(2);
    const inventou = executarFerramenta(p, { ferramenta: "animar", argumentos: { peca: "contador", palavra_ref: "300", params: { ate: 5000 } } }, AGORA);
    expect(inventou.ok).toBe(false);
    expect(inventou.texto).toMatch(/não foi dito/);
    const s = executarFerramenta(a.projeto, { ferramenta: "sons", argumentos: {} }, AGORA);
    const efeito = s.projeto.trilhas.find((t) => t.nome === "Efeitos")!.clipes[0];
    expect((efeito.estilo as Record<string, unknown>).som).toBe("count");
    expect(s.projeto.fontes["som-count"].storage_bucket).toBe("publico");
    expect(executarFerramenta(p, { ferramenta: "logo", argumentos: { onde: "canto" } }, AGORA).ok).toBe(false);
    const comLogo = executarFerramenta(p, { ferramenta: "logo", argumentos: { onde: "canto" } }, AGORA, { logo_path: "cli/marca/logo.png", cor: "#FF0066", nome: "Loja" });
    expect(comLogo.ok).toBe(true);
    expect(comLogo.projeto.fontes["logo-do-cliente"].storage_path).toBe("cli/marca/logo.png");
    const cf = executarFerramenta(p, { ferramenta: "cartao_final", argumentos: { titulo: "Chama no direct" } }, AGORA, { logo_path: "cli/marca/logo.png", cor: "#FF0066", nome: "Loja" });
    expect(cf.texto).toMatch(/com a logo/);
    const onda = executarFerramenta(p, { ferramenta: "cortar_pela_onda", argumentos: {} }, AGORA);
    expect(onda.ok).toBe(false);
    expect(onda.texto).toMatch(/medir a onda/i);
    expect(executarFerramenta(p, { ferramenta: "conferir_corte", argumentos: {} }, AGORA).texto).toMatch(/^Conferência:/);
  });

  it("no laço: ferramenta do servidor e geração paga (só estima; vira cartão com o custo)", async () => {
    const p = projeto();
    const chamar = vi
      .fn()
      .mockResolvedValueOnce({ passo: { plano: "b-roll", chamadas: [{ ferramenta: "gerar_broll", argumentos: { de_s: 1, ate_s: 4, prompt: "loja por dentro" } }, { ferramenta: "medir_onda", argumentos: {} }], resposta: "", terminou: false, recusadas: [] }, gasto_usd: 0.01 })
      .mockResolvedValueOnce({ passo: { plano: "", chamadas: [], resposta: "Preparei o B-roll para você confirmar.", terminou: true, recusadas: [] }, gasto_usd: 0.02 });
    const servidor = vi.fn(async (ch: { ferramenta: string }) =>
      ch.ferramenta === "gerar_broll"
        ? { projeto: p, operacoes: [], texto: "cartão", ok: true, saida: { tipo: "gerar_broll" as const, argumentos: { de_s: 1, ate_s: 4, prompt: "loja por dentro", motor: "kling", duracao_s: 3, formato: "9:16" }, custo_usd: 0.35, detalhe: null } }
        : { projeto: p, operacoes: [], texto: "pedi", ok: true, naFila: { tipo: "onda" as const, pedido_id: "p1" } },
    );
    const r = await rodarAgente({ chamar, clientId: "cli", sessao: "s1", pedido: "cobre de 1 a 4 com b-roll", projeto: p, modeloId: "m", tetoUsd: 1, agora: AGORA, servidor });
    expect(servidor).toHaveBeenCalledTimes(2);
    expect(r.saidas[0].custo_usd).toBe(0.35);
    expect(r.naFila).toEqual([{ tipo: "onda", pedido_id: "p1" }]);
    expect(r.operacoes).toEqual([]);
    const cartao = acaoDaSaida(r.saidas[0], "g1");
    expect(cartao).toMatchObject({ sem_desfazer: true, custo_estimado_usd: 0.35 });
    expect(cartao.itens[0].operacao).toBe("gerar_broll");
  });

  it("o arquivo gerado entra no trecho: B-roll mudo por cima, elemento na sobreposição", () => {
    const p = projeto();
    const ops = opsDoArquivoNoTrecho(p, { id: "arq-123456", nome: "B-roll loja", storage_bucket: "mesa", storage_path: "cli/video/gerados/x.mp4", duracao_s: 5 }, { tipo: "broll", inicio_s: 1, duracao_s: 3 });
    const d = ops.reduce((x, o) => aplicarOperacao(x, o), p);
    const broll = d.trilhas.find((t) => t.nome === "B-roll")!;
    expect(broll.muda).toBe(true);
    expect(broll.clipes[0]).toMatchObject({ inicio_s: 1, saida_s: 3 });
    const el = opsDoArquivoNoTrecho(p, { id: "arq-999999", nome: "Ícone: carrinho", storage_bucket: "mesa", storage_path: "cli/video/editor/elementos/e.png" }, { tipo: "elemento", inicio_s: 2, duracao_s: 2.5 }).reduce((x, o) => aplicarOperacao(x, o), p);
    expect(el.trilhas.find((t) => t.nome === "Elementos")!.clipes[0].estilo).toMatchObject({ escala: 0.34 });
  });

  it("elemento: prompt sem texto nem marca; modelo que faz fundo transparente", () => {
    expect(promptDoElemento("icone", "carrinho de compras")).toMatch(/Fundo transparente\. Sem texto, sem letras, sem logotipo/);
    const m = (id: string, api: string, padrao: string[] = []) => ({ id, provedor: "openai", modelo_api: api, tipo: "imagem", ativo: true, padrao_para: padrao, preco_imagem: { media: 0.04 } }) as any;
    const transparente = (x: { modelo_api: string }) => /^gpt-image/.test(x.modelo_api);
    expect(escolherModeloDoElemento([m("a", "dall-e-3", ["imagem"]), m("b", "gpt-image-1")], transparente)!.id).toBe("b");
    expect(escolherModeloDoElemento([m("a", "dall-e-3")], transparente)).toBeNull();
  });
});
