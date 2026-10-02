import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  apelidoValido,
  blocoDosSinais,
  chaveDoLink,
  CONHECIMENTO_DE_TEMAS,
  ESQUEMA_DAS_IDEIAS,
  fonteConferida,
  hashtagsParaOlhar,
  type IdeiaDeTema,
  ideiasDoAnexo,
  linhasDasFontes,
  MAX_IDEIAS,
  normalizarIdeias,
  notasDoJev,
  notasPelaRegra,
  ordenarIdeias,
  perguntasDaIdeia,
  postsQueFuncionaram,
  preenchimentoDaIdeia,
  proximoNumero,
  type SinaisDoMundo,
  SISTEMA_DAS_IDEIAS,
} from "../../supabase/functions/mesa-roteiros/modulos/ideias-de-tema";
import { buscarHashtag, lerSinaisDoMundo, limparCacheDasHashtags, motivoDoErroDoInstagram, postsDaHashtag } from "../../supabase/functions/mesa-roteiros/modulos/sinais-do-mundo";

/**
 * Ideias com o agente (02/10): leitura das ideias, fonte conferida, ranking
 * (Jev e regra), preenchimento do formulário, fontes do mundo real que caem
 * sem quebrar e o conhecimento anti-genérico com foco no cliente.
 */

const ler = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

const bruta = (x: Record<string, unknown> = {}) => ({
  tema: "Quanto tempo leva o inventário extrajudicial",
  pergunta_do_cliente: "Quanto tempo demora um inventário em cartório",
  gancho: "Inventário em cartório pode sair em 30 dias. Mas só se...",
  angulo: "autoridade",
  objetivo: "autoridade",
  modelo_base_id: "casa-advogado-duvida-juridica",
  tipo: "fala_camera",
  por_que_agora: "A nova regra do CNJ permite inventário com menor em cartório.",
  fonte_url: "https://www.cnj.jus.br/noticia-inventario/?utm_source=x",
  fonte_titulo: "CNJ",
  promessa: "Saber se o seu caso cabe no cartório.",
  esqueleto: ["Gancho", "Quando pode", "Documentos", "Prazo real", "CTA"],
  ligacao_com_roteiros: null,
  ...x,
});

const permitidas = { web: [{ url: "https://cnj.jus.br/noticia-inventario", titulo: "Notícia do CNJ" }], instagram: ["https://www.instagram.com/p/ABC123/"] };

const ideia = (x: Partial<IdeiaDeTema> = {}): IdeiaDeTema => ({ ...normalizarIdeias([bruta()], { permitidas })[0], ...x });

describe("leitura das ideias", () => {
  it("limpa, põe ? na pergunta, numera a partir do início e confere modelo, tipo e objetivo", () => {
    const l = normalizarIdeias(
      [
        bruta(),
        bruta({ tema: "Erro que trava o inventário — e custa caro", pergunta_do_cliente: "Por que meu inventário está parado?", angulo: "conversao", objetivo: "vender", modelo_base_id: "rv-nao-existe", tipo: "podcast", fonte_url: null }),
        bruta({ tema: "" }),
        bruta({ tema: "quanto tempo leva o inventário extrajudicial" }),
        "lixo",
      ],
      { permitidas, inicio: 7 },
    );
    expect(l.map((i) => i.apelido)).toEqual(["i7", "i8"]);
    expect(l[0].pergunta_do_cliente).toBe("Quanto tempo demora um inventário em cartório?");
    expect(l[0].modelo_base_id).toBe("casa-advogado-duvida-juridica");
    expect(l[0].modelo_base_nome).toContain("Advogado");
    expect(l[1].tema).not.toMatch(/[—–]/);
    expect(l[1].modelo_base_id).toBeNull();
    expect(l[1].tipo).toBe("fala_camera");
    expect(l[1].objetivo).toBe("venda");
    expect(l[0].notas.como).toBe("regra");
  });

  it("no máximo 8 ideias e nada repetido das rodadas anteriores", () => {
    const muitas = Array.from({ length: 12 }, (_, k) => bruta({ tema: `Tema número ${k}` }));
    expect(normalizarIdeias(muitas, { permitidas })).toHaveLength(MAX_IDEIAS);
    const anteriores = normalizarIdeias([bruta()], { permitidas });
    expect(normalizarIdeias([bruta()], { permitidas, anteriores })).toHaveLength(0);
  });

  it("fonte só vale quando veio da busca ou de um post lido agora (link inventado cai)", () => {
    const [comFonte] = normalizarIdeias([bruta()], { permitidas });
    expect(comFonte.fonte).toEqual({ url: "https://cnj.jus.br/noticia-inventario", titulo: "CNJ", tipo: "web" });
    const [inventada] = normalizarIdeias([bruta({ fonte_url: "https://site-que-nao-veio.com/x" })], { permitidas });
    expect(inventada.fonte).toBeNull();
    expect(fonteConferida("https://instagram.com/p/ABC123?igsh=zz", null, permitidas)).toMatchObject({ tipo: "instagram", url: "https://www.instagram.com/p/ABC123/" });
    expect(fonteConferida("javascript:alert(1)", "x", permitidas)).toBeNull();
    expect(chaveDoLink("https://www.Exemplo.com/a/?utm_medium=x#y")).toBe("exemplo.com/a");
  });

  it("ideias do anexo, número seguinte e apelido escolhido", () => {
    const l = normalizarIdeias([bruta(), bruta({ tema: "Outro tema" })], { permitidas, inicio: 3 });
    expect(ideiasDoAnexo([{ tipo: "outro" }, { tipo: "ideias_de_tema", ideias: l }]).map((i) => i.apelido)).toEqual(["i3", "i4"]);
    expect(proximoNumero(l)).toBe(5);
    expect(apelidoValido("i4", l)).toBe("i4");
    expect(apelidoValido("usa a 3", l)).toBe("i3");
    expect(apelidoValido("i9", l)).toBeNull();
    expect(apelidoValido(null, l)).toBeNull();
  });
});

describe("ranking", () => {
  it("perguntas do Jev: três Score por ideia, níveis em lista de 2 a 10, estado com a marca e a ideia", () => {
    const q = perguntasDaIdeia(ideia(), { nome: "Thainá", negocio: "advocacia de família", publico: "herdeiros", oferta: "inventário" });
    expect(Object.keys(q.questions)).toEqual(["responde", "gancho", "especifico"]);
    Object.values(q.questions).forEach((p) => {
      expect(p.type).toBe("score");
      expect(Array.isArray(p.criteria)).toBe(true);
      expect(p.criteria.length).toBeGreaterThanOrEqual(2);
      expect(p.criteria.length).toBeLessThanOrEqual(10);
    });
    expect(q.state.ideia_de_video.pergunta_do_cliente).toContain("?");
    expect(q.state.marca.publico).toBe("herdeiros");
  });

  it("notas do Jev viram 0 a 1 pelos pesos e ordenam; sem nota, null", () => {
    expect(notasDoJev({ responde: null, gancho: null, especifico: null })).toBeNull();
    const alta = notasDoJev({ responde: 3, gancho: 3, especifico: 3 })!;
    const baixa = notasDoJev({ responde: 0.5, gancho: 1, especifico: 0 })!;
    expect(alta.total).toBe(1);
    expect(alta.como).toBe("jev");
    expect(baixa.total).toBeLessThan(0.3);
    const a = ideia({ apelido: "i1", notas: baixa });
    const b = ideia({ apelido: "i2", tema: "B", notas: alta });
    expect(ordenarIdeias([a, b]).map((i) => i.apelido)).toEqual(["i2", "i1"]);
  });

  it("a regra (sem Jev) pune o genérico e premia pergunta de cliente e gancho concreto", () => {
    const generica = notasPelaRegra({ tema: "5 dicas para ter sucesso", pergunta_do_cliente: "Dicas?", gancho: "Olá, hoje vou falar de dicas", fonte: null, esqueleto: [] });
    const especifica = notasPelaRegra({ tema: "Inventário em 30 dias no cartório", pergunta_do_cliente: "Quanto tempo demora um inventário em cartório?", gancho: "Inventário em 30 dias? Só se você fizer isso", fonte: { url: "https://x.com", titulo: "x", tipo: "web" }, esqueleto: ["a", "b", "c"] });
    expect(especifica.total).toBeGreaterThan(generica.total + 0.25);
  });
});

describe("preenchimento do formulário", () => {
  it("tema, objetivo, modelo, tipo, duração do modelo e o pedido com pergunta, gancho, esqueleto e fonte", () => {
    const v = preenchimentoDaIdeia(ideia());
    expect(v.tema).toBe("Quanto tempo leva o inventário extrajudicial");
    expect(v.objetivo).toBe("autoridade");
    expect(v.modeloBase).toBe("casa-advogado-duvida-juridica");
    expect(v.tipo).toBe("fala_camera");
    expect(v.duracao_s).toBeGreaterThanOrEqual(10);
    expect(v.pedido).toContain("Pergunta do cliente que o vídeo responde: Quanto tempo demora um inventário em cartório?");
    expect(v.pedido).toContain("Gancho combinado (usar como gancho 1): Inventário em cartório");
    expect(v.pedido).toContain("1) Gancho");
    expect(v.pedido).toContain("fonte: https://cnj.jus.br/noticia-inventario");
    expect(v.pedido.length).toBeLessThanOrEqual(2000);
  });

  it("modelo que não serve ao objetivo volta para o automático; sem modelo, duração do modo", () => {
    const v = preenchimentoDaIdeia(ideia({ objetivo: "engajamento", modelo_base_id: "casa-produto-na-mao" }));
    expect(v.modeloBase).toBe("auto");
    const semModelo = preenchimentoDaIdeia(ideia({ modelo_base_id: null, tipo: "tutorial" }));
    expect(semModelo.modeloBase).toBe("auto");
    expect(semModelo.duracao_s).toBe(45);
  });
});

describe("conhecimento e regras do agente de ideias", () => {
  it("anti-genérico, pergunta real do cliente, conversão e autoridade, trend-jacking com critério", () => {
    expect(CONHECIMENTO_DE_TEMAS).toContain("PERGUNTA REAL do cliente final");
    expect(CONHECIMENTO_DE_TEMAS).toMatch(/Anti-genérico \(regra dura\)/);
    expect(CONHECIMENTO_DE_TEMAS).toContain("5 dicas para");
    expect(CONHECIMENTO_DE_TEMAS).toContain("Conversão:");
    expect(CONHECIMENTO_DE_TEMAS).toContain("Autoridade:");
    expect(CONHECIMENTO_DE_TEMAS).toContain("Trend-jacking com critério");
    expect(CONHECIMENTO_DE_TEMAS).toMatch(/dúvida.*objeção.*comparação.*erro comum.*mito.*bastidor.*prova/s);
    expect(CONHECIMENTO_DE_TEMAS).toContain("mistura 2 e 4");
    expect(SISTEMA_DAS_IDEIAS).toContain("nunca invente link");
    for (const t of [CONHECIMENTO_DE_TEMAS, SISTEMA_DAS_IDEIAS]) expect(t).not.toMatch(/[—–]/);
    for (const p of [
      "supabase/functions/mesa-roteiros/modulos/ideias-de-tema.ts",
      "supabase/functions/mesa-roteiros/modulos/sinais-do-mundo.ts",
      "src/components/mesa-roteiros/IdeiasDeTema.tsx",
    ]) expect(ler(p), p).not.toMatch(/[—–]/);
  });

  it("esquema estrito: todo campo obrigatório e o ângulo fechado", () => {
    const item = (ESQUEMA_DAS_IDEIAS.schema.properties.ideias as any).items;
    expect(item.required.slice().sort()).toEqual(Object.keys(item.properties).sort());
    expect(item.properties.angulo.enum).toEqual(["conversao", "autoridade", "hype"]);
    expect(ESQUEMA_DAS_IDEIAS.schema.required).toEqual(["resposta", "ideias", "preencher"]);
  });

  it("a função liga a ação, a busca na web, o método e o fôlego", () => {
    const f = ler("supabase/functions/mesa-roteiros/index.ts");
    expect(f).toContain("ideias_conversar: ideiasConversar,");
    expect(f).toContain("ideias_historico: ideiasHistorico,");
    expect(f).toMatch(/const ACOES_LONGAS = new Set\(\[[^\]]*"ideias_conversar"/);
    expect(f).toContain("pesquisaWeb: s.web.ligada,");
    expect(f).toContain("metodo: sp,");
    expect(f).toContain("jevPerguntar(perguntasDaIdeia(i, marca)");
    // Os módulos novos moram em modulos/ (limite do Lovable), não em _shared.
    expect(f).toContain('from "./modulos/ideias-de-tema.ts"');
    expect(f).toContain('from "./modulos/sinais-do-mundo.ts"');
  });
});

// ------------------------------------------------------------------ fontes do mundo real

type Resp = { data: unknown; error: unknown };
function bancoFalso(tabelas: Record<string, Resp>, rpc: Resp) {
  const consulta = (t: string) => {
    const r = tabelas[t] || { data: [], error: null };
    const b: any = {};
    for (const m of ["select", "eq", "in", "is", "gte", "order", "limit"]) b[m] = () => b;
    b.then = (ok: any, erro: any) => Promise.resolve(r).then(ok, erro);
    return b;
  };
  return { from: vi.fn(consulta), rpc: vi.fn(() => Promise.resolve(rpc)) };
}

const WEB_OFF = { ligada: false, motivo: "desligada nesta rodada." };

describe("fontes do mundo real caem sem quebrar", () => {
  beforeEach(() => limparCacheDasHashtags());

  it("sem token, sem tabela e sem nada: cada fonte diz o motivo em uma linha", async () => {
    const db = bancoFalso(
      { roteiros: { data: null, error: { code: "42P01" } }, social_post_metrics: { data: null, error: { code: "42P01" } }, cliente_perfis_instagram: { data: [], error: null } },
      { data: [], error: null },
    );
    const s = await lerSinaisDoMundo(db, { clientId: "c", marca: null, contas: null, mensagem: "ideias #inventario", hashtags: [], web: WEB_OFF });
    expect(s.instagram.hashtags).toEqual([]);
    expect(s.instagram.motivo).toMatch(/conecte o Instagram/);
    expect(s.roteiros.motivo).toMatch(/não foram lidos/);
    expect(s.publicados.motivo).toMatch(/não foram lidos/);
    expect(s.referencias.motivo).toMatch(/cadastre perfis/);
    const linhas = linhasDasFontes(s, null);
    expect(linhas.map((l) => l.fonte)).toEqual(["web", "instagram", "referencias", "publicados", "roteiros"]);
    expect(linhas.every((l) => !l.ok)).toBe(true);
    expect(linhas[0].texto).toBe("Web: desligada nesta rodada.");
    const bloco = blocoDosSinais(s);
    expect(bloco).toContain("Busca na web DESLIGADA");
    expect(bloco).toContain("Ficou de fora:");
  });

  it("sem hashtag nenhuma, pede uma #hashtag e nem procura o token", async () => {
    const db = bancoFalso({}, { data: [{ ig_user_id: "1", access_token: "segredo", origem: "agencia" }], error: null });
    const s = await lerSinaisDoMundo(db, { clientId: "c", marca: null, contas: null, mensagem: "ideias", hashtags: [], web: WEB_OFF });
    expect(s.instagram.motivo).toMatch(/#hashtag/);
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("com token: busca a hashtag, Reels primeiro, e o token nunca sai no resultado", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes("ig_hashtag_search")) return new Response(JSON.stringify({ data: [{ id: "h1" }] }), { status: 200 });
      return new Response(
        JSON.stringify({
          data: [
            { id: "1", caption: "foto #inventario", media_type: "IMAGE", like_count: 900, comments_count: 1, permalink: "https://www.instagram.com/p/F1/" },
            { id: "2", caption: "reels #inventario", media_type: "VIDEO", like_count: 10, comments_count: 2, permalink: "https://www.instagram.com/reel/R1/", timestamp: "2026-10-01T10:00:00+0000" },
          ],
        }),
        { status: 200 },
      );
    });
    const db = bancoFalso(
      {
        social_post_metrics: { data: [{ caption: "post #herança", saved: 50, shares: 3, like_count: 10, permalink: "https://www.instagram.com/p/M1/" }], error: null },
        roteiros: { data: [{ titulo: "Salário-maternidade", status: "aprovado", versao_atual: 1, versoes: [{ numero: 1, conteudo: { subtitulo: "Grávida e sem emprego?", base: { nome: "Direto ao ponto" } } }] }], error: null },
      },
      { data: [{ ig_user_id: "178", access_token: "TOKEN-SECRETO", origem: "agencia" }], error: null },
    );
    const s = await lerSinaisDoMundo(db, { clientId: "c", marca: null, contas: null, mensagem: "olha #inventario", hashtags: ["partilha"], web: { ligada: true, motivo: null }, fetchImpl: fetchImpl as any });
    expect(s.instagram.hashtags[0].tag).toBe("inventario");
    expect(s.instagram.hashtags[0].posts[0].tipo).toBe("reels");
    expect(s.publicados.posts[0].destaque).toContain("salvos 50");
    expect(s.roteiros.lista[0]).toMatchObject({ titulo: "Salário-maternidade", subtitulo: "Grávida e sem emprego?", base: "Direto ao ponto" });
    expect(JSON.stringify(s)).not.toContain("TOKEN-SECRETO");
    expect(blocoDosSinais(s)).not.toContain("TOKEN-SECRETO");
    const linhas = linhasDasFontes(s, { fontes: 3 });
    expect(linhas[0]).toEqual({ fonte: "web", ok: true, texto: "Web: 3 fontes da busca de agora" });
    expect(linhas[1].ok).toBe(true);
  });

  it("sem permissão de hashtag: para na primeira e diz o motivo", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ error: { code: 10, message: "x" } }), { status: 400 }));
    const db = bancoFalso({}, { data: [{ ig_user_id: "178", access_token: "t", origem: "agencia" }], error: null });
    const s = await lerSinaisDoMundo(db, { clientId: "c", marca: null, contas: null, mensagem: "#um #dois #tres", hashtags: [], web: WEB_OFF, fetchImpl: fetchImpl as any });
    expect(s.instagram.hashtags).toEqual([]);
    expect(s.instagram.motivo).toMatch(/permissão de busca por hashtag/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(motivoDoErroDoInstagram({ code: 190 }).tipo).toBe("token");
    expect(motivoDoErroDoInstagram({ code: 4 }).tipo).toBe("limite");
  });

  it("cache de 6 horas por conta e hashtag", async () => {
    const fetchImpl = vi.fn(async (url: string) =>
      new Response(JSON.stringify(url.includes("ig_hashtag_search") ? { data: [{ id: "h" }] } : { data: [{ caption: "a", media_type: "VIDEO", permalink: "https://www.instagram.com/reel/A/" }] }), { status: 200 }),
    );
    const conta = { igUserId: "1", token: "t", origem: "agencia" as const };
    await buscarHashtag(conta, "tag", { fetchImpl: fetchImpl as any, agora: 1_000 });
    await buscarHashtag(conta, "tag", { fetchImpl: fetchImpl as any, agora: 2_000 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("marca que não tem Instagram ligado não lê os posts do cliente", async () => {
    const db = bancoFalso({}, { data: [], error: null });
    const s = await lerSinaisDoMundo(db, { clientId: "c", marca: { id: "m2", principal: false }, contas: [], mensagem: "", hashtags: [], web: WEB_OFF });
    expect(s.publicados.motivo).toMatch(/não tem Instagram ligado/);
  });

  it("hashtags do pedido, da tela e as mais usadas pelo cliente; posts que funcionaram pelos salvos", () => {
    expect(hashtagsParaOlhar("ideias sobre #Herança", ["#inventário"], ["#direito #direito #familia"])).toEqual(["heranca", "inventario", "direito"]);
    const [melhor] = postsQueFuncionaram([{ like_count: 100 }, { saved: 40, shares: 5 }]);
    expect(melhor).toEqual({ saved: 40, shares: 5 });
    expect(postsDaHashtag([{ caption: "x", media_type: "IMAGE", permalink: "https://evil.com/p" }])[0].link).toBeNull();
  });
});

describe("bloco dos sinais", () => {
  it("com a web ligada pede a busca do agora no nicho e só links devolvidos", () => {
    const s: SinaisDoMundo = {
      web: { ligada: true, motivo: null },
      instagram: { hashtags: [], motivo: null },
      referencias: { perfis: [], motivo: null },
      publicados: { posts: [], motivo: null },
      roteiros: { lista: [], motivo: null },
    };
    expect(blocoDosSinais(s)).toContain("Busca na web LIGADA");
    expect(blocoDosSinais(s)).toContain("cite só links que a busca devolveu");
  });
});
