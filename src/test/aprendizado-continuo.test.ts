// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  blocoDoQueFuncionou,
  caminhoDoIndiceDasEntregas,
  comEntrega,
  indiceVazio,
  linhaDaVariedadeDasEntregas,
  medirPosts,
  type MemoriaDaEntrega,
  memoriaDaEntrega,
  padraoDaEntrega,
  rankingDosPadroes,
  sugestoesParaOEstilo,
  TETO_DO_BLOCO_DAS_ENTREGAS,
  TITULO_DO_QUE_FUNCIONOU,
} from "../../supabase/functions/_shared/aprendizado-continuo";
import {
  aprenderComOsNumeros,
  blocosDasEntregas,
  REFORCO_DO_TOPO,
  registrarMemoriaDaEntrega,
} from "../../supabase/functions/_shared/aprendizado-das-entregas";
import {
  blocoDaMemoriaEditorial,
  candidatosParecidos,
  decidirEvolucao,
  linhasDeEvolucao,
  montarMemoriaEditorial,
  nosDasPropostas,
  perguntasDeRepeticao,
  seloDaEvolucao,
} from "../../supabase/functions/_shared/memoria-editorial";
import {
  categoriaDaLinhaDeMemoria,
  chaveDoAprendizado,
  type FatoDoCerebro,
  registrarAprendizado,
  resumoParaPrompt,
} from "../../supabase/functions/_shared/cerebro-do-cliente";
import { aprendizadosDoPainel, fonteDoAprendizado, resumoDosAprendizados } from "../components/mesa/aprendizadosDoPainel";

/**
 * Frente AP (27/09): aprendizado contínuo. Memória da entrega (uma vez),
 * reforço por desempenho real, bloco do que funcionou com teto, repetição
 * detectada com o Jev simulado, ângulo novo com a relação marcada, sequência
 * por pilar e nada muda para o cliente sem histórico.
 */

const ler = (p: string) => readFileSync(resolve(process.cwd(), p), "utf-8");
const CLIENTE = "11111111-2222-4333-8444-555555555555";
const TRABALHO = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const OUTRO_TRABALHO = "aaaaaaaa-bbbb-4ccc-8ddd-ffffffffffff";
const POST = "99999999-8888-4777-8666-555555555555";
const ARQUIVO = "12345678-1234-4234-8234-123456789012";
const AGORA = new Date("2026-09-27T12:00:00.000Z");

// ─── Banco de mentira: tabelas (select/update/insert) e o bucket ───
type Linha = Record<string, unknown>;
function bancoFalso(tabelas: Record<string, Linha[]> = {}, opcoes: { aoInserir?: (tabela: string, dados: Linha) => { data: unknown; error: { code?: string; message: string } | null } | null } = {}) {
  const arquivos = new Map<string, string>();
  const gravados: Array<{ tabela: string; op: string; dados: Linha; filtros: Array<[string, unknown]> }> = [];
  const from = (tabela: string) => {
    let op = "select";
    let dados: Linha = {};
    const filtros: Array<[string, unknown]> = [];
    const listas: Array<[string, unknown[]]> = [];
    const resolver = () => {
      if (op === "insert") {
        const r = opcoes.aoInserir ? opcoes.aoInserir(tabela, dados) : null;
        if (r) {
          if (!r.error) gravados.push({ tabela, op, dados, filtros: [...filtros] });
          return r;
        }
        gravados.push({ tabela, op, dados, filtros: [...filtros] });
        return { data: { id: `novo-${gravados.length}` }, error: null };
      }
      if (op === "update") {
        gravados.push({ tabela, op, dados, filtros: [...filtros] });
        return { data: null, error: null };
      }
      const linhas = (tabelas[tabela] ?? [])
        .filter((l) => filtros.every(([k, v]) => !(k in l) || l[k] === v))
        .filter((l) => listas.every(([k, vs]) => !(k in l) || vs.indexOf(l[k]) >= 0));
      return { data: linhas, error: null };
    };
    const q: Record<string, unknown> = {
      select: () => q, order: () => q, limit: () => q, gte: () => q, is: () => q, not: () => q, neq: () => q,
      in: (k: string, vs: unknown[]) => { listas.push([k, vs]); return q; },
      eq: (k: string, v: unknown) => { filtros.push([k, v]); return q; },
      insert: (d: Linha) => { op = "insert"; dados = d; return q; },
      update: (d: Linha) => { op = "update"; dados = d; return q; },
      single: () => Promise.resolve(resolver()),
      maybeSingle: () => Promise.resolve(resolver()),
      then: (ok: (r: unknown) => unknown, erro?: (e: unknown) => unknown) => Promise.resolve(resolver()).then(ok, erro),
    };
    return q;
  };
  const storage = {
    from: (bucket: string) => ({
      download: async (caminho: string) => {
        const t = arquivos.get(`${bucket}/${caminho}`);
        return t === undefined ? { data: null, error: { message: "not found" } } : { data: { text: async () => t }, error: null };
      },
      upload: async (caminho: string, blob: Blob) => {
        arquivos.set(`${bucket}/${caminho}`, await blob.text());
        return { error: null };
      },
    }),
  };
  return { db: { from, storage }, arquivos, gravados };
}

const versao = (ordem: number, v: number, extra: Linha = {}): Linha => ({
  ordem,
  versao: v,
  origem: "gerar",
  storage_path: `${CLIENTE}/estudio/${ordem}-${v}.png`,
  criado_em: "2026-09-20T10:00:00.000Z",
  ...extra,
});

function trabalho(over: Linha = {}) {
  const capa = { modo: "replicar_referencia", fidelidade_referencia: "proxima", referencias: ["r1"], tipografia: { chave: "k", titulo: "Montserrat", texto: "Inter", peso_titulo: "bold", caixa_titulo: "alta", amostras: 1, ancora: null }, variedade: { destaque: "verde" } };
  return {
    id: TRABALHO,
    client_id: CLIENTE,
    task_id: "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff",
    post_id: null as string | null,
    tipo: "social",
    direcao: { conceito: "Protetor solar sem mito", formato: "4:5", fidelidade_referencia: "proxima", usar_estilo_do_cliente: true, cards: [1, 2, 3, 4, 5].map((o) => ({ ordem: o })) },
    cards: [
      versao(1, 1, capa),
      versao(1, 2, { ...capa, origem: "ajuste", instrucao: "aumentar a logo" }),
      versao(2, 1, { modo: "normal", miolo_desenhado: { tipo: "lista", componente: "checklist" } }),
      versao(3, 1, { modo: "normal", miolo_desenhado: { tipo: "passos", componente: "linha_do_tempo" } }),
      // Autocorreção sozinha não é ajuste da equipe.
      versao(4, 1, { modo: "normal", origem: "ajuste", instrucao: "corrigir acento", autocorrecao: { rodada: 1, motivos: ["ortografia"] } }),
      versao(5, 1, { modo: "normal" }),
    ],
    file_ids: [ARQUIVO],
    entrega_rodada: 1,
    ...over,
  };
}

const descricao = { capa: "título grande no topo, foto do produto à direita", miolo: "checklist em cartão com ícones", cor: "fundo claro, destaque verde", tipografia: "título pesado em caixa alta" };
const gravarOk = () => vi.fn(async () => ({ gravada: true, situacao: "criado", id: "77777777-6666-4555-8444-333333333333", reforcos: 1, erro: null }));

// ────────────────────────────────────────────────────────────── entrega

describe("memória da entrega", () => {
  it("lê o que foi usado e aprovado, com o padrão canônico", () => {
    const m = memoriaDaEntrega(trabalho(), { agora: AGORA })!;
    expect(m.id).toBe(`${TRABALHO}:r1`);
    expect(m.laminas).toBe(5);
    expect(m.formato).toBe("4:5");
    expect(m.modo).toBe("replicar_referencia");
    expect(m.fidelidade).toBe("proxima");
    expect(m.estilo_ligado).toBe(true);
    expect(m.componentes).toEqual(["checklist", "linha_do_tempo"]);
    expect(m.ajustes).toEqual({ quantos: 1, pedidos: ["aumentar a logo"] });
    expect(m.aprovado_sem_ajuste).toBe(false);
    expect(m.cor_de_destaque).toBe("verde");
    // Capa: a versão atual (2); miolo: a lâmina do meio (3 de 5).
    expect(m.capa).toEqual({ bucket: "mesa", caminho: `${CLIENTE}/estudio/1-2.png` });
    expect(m.miolo).toEqual({ bucket: "mesa", caminho: `${CLIENTE}/estudio/3-1.png` });
    expect(m.padrao).toContain("Padrão entregue: carrossel 4:5 de 4 a 6 lâminas");
    expect(m.padrao).toContain("próxima da referência");
    expect(m.padrao).toContain("miolo em checklist, linha do tempo");
    expect(m.padrao).not.toContain("—");
  });

  it("a mesma receita com outra quantidade na faixa dá o mesmo padrão (vira reforço)", () => {
    const a = memoriaDaEntrega(trabalho())!;
    const t2 = trabalho({ id: OUTRO_TRABALHO });
    (t2.cards as Linha[]).push(versao(6, 1, { modo: "normal" }));
    const b = memoriaDaEntrega(t2)!;
    expect(b.laminas).toBe(6);
    expect(b.padrao).toBe(a.padrao);
    expect(b.chave_do_padrao).toBe(a.chave_do_padrao);
  });

  it("é registrada UMA vez por entrega: leitura por visão e cérebro só na primeira", async () => {
    const { db, arquivos } = bancoFalso();
    const lerVisao = vi.fn(async () => descricao);
    const gravar = gravarOk();
    const r1 = await registrarMemoriaDaEntrega(db, trabalho(), { gravarNoCerebro: gravar, lerVisao, agora: AGORA });
    expect(r1.situacao).toBe("registrada");
    expect(r1.leu_visao).toBe(true);
    expect(lerVisao).toHaveBeenCalledTimes(1);
    expect(lerVisao).toHaveBeenCalledWith({ bucket: "mesa", caminho: `${CLIENTE}/estudio/1-2.png` }, { bucket: "mesa", caminho: `${CLIENTE}/estudio/3-1.png` });
    expect(gravar).toHaveBeenCalledTimes(1);
    expect(gravar.mock.calls[0][0]).toMatchObject({ client_id: CLIENTE, area: "arte", categoria: "entrega", fonte: "entrega", agente: "geral", texto: r1.memoria!.padrao, referencia_id: TRABALHO });
    expect(String((gravar.mock.calls[0][0] as { motivo: string }).motivo)).toContain("aumentar a logo");
    expect(arquivos.has(`mesa/${caminhoDoIndiceDasEntregas(CLIENTE)}`)).toBe(true);

    const r2 = await registrarMemoriaDaEntrega(db, trabalho(), { gravarNoCerebro: gravar, lerVisao, agora: AGORA });
    expect(r2.situacao).toBe("ja_registrada");
    expect(lerVisao).toHaveBeenCalledTimes(1);
    expect(gravar).toHaveBeenCalledTimes(1);

    // Reprovada e entregue de novo: é outra entrega (rodada 2) e a anterior fica substituída.
    const r3 = await registrarMemoriaDaEntrega(db, trabalho({ entrega_rodada: 2 }), { gravarNoCerebro: gravar, lerVisao, agora: AGORA });
    expect(r3.situacao).toBe("registrada");
    const indice = JSON.parse(arquivos.get(`mesa/${caminhoDoIndiceDasEntregas(CLIENTE)}`)!);
    expect(indice.entregas.map((e: MemoriaDaEntrega) => [e.id, e.substituida])).toEqual([[`${TRABALHO}:r2`, false], [`${TRABALHO}:r1`, true]]);
  });

  it("sem versão, nada é registrado; falha da leitura por visão não derruba", async () => {
    const { db } = bancoFalso();
    const gravar = gravarOk();
    expect((await registrarMemoriaDaEntrega(db, trabalho({ cards: [] }), { gravarNoCerebro: gravar })).situacao).toBe("sem_versoes");
    const r = await registrarMemoriaDaEntrega(db, trabalho(), { gravarNoCerebro: gravar, lerVisao: async () => { throw new Error("modelo fora"); } });
    expect(r.situacao).toBe("registrada");
    expect(r.leu_visao).toBe(false);
  });
});

describe("cérebro: categoria entrega", () => {
  it("padrão repetido vira reforço (mesma chave, agente geral), sem linha nova", async () => {
    const padrao = memoriaDaEntrega(trabalho())!.padrao;
    const { db, gravados } = bancoFalso({
      agente_memoria: [{ id: "m1", client_id: CLIENTE, agente: "geral", ativa: true, texto: padrao, chave: chaveDoAprendizado(padrao), reforcos: 1, area: "arte", categoria: "entrega", fonte: "entrega" }],
    });
    const r = await registrarAprendizado(db, { client_id: CLIENTE, area: "arte", categoria: "entrega", texto: padrao, fonte: "entrega", agente: "geral" });
    expect(r.situacao).toBe("reforcado");
    expect(r.agente).toBe("geral");
    expect(r.reforcos).toBe(2);
    expect(gravados.filter((g) => g.op === "insert")).toHaveLength(0);
  });

  it("sem o SQL AP-01 grava como aprendizado com fonte entrega, e a leitura devolve entrega", async () => {
    const { db, gravados } = bancoFalso({}, {
      aoInserir: (_t, d) => (d.categoria === "entrega" ? { data: null, error: { code: "23514", message: "violates check constraint agente_memoria_categoria_check" } } : null),
    });
    const r = await registrarAprendizado(db, { client_id: CLIENTE, area: "arte", categoria: "entrega", texto: "Padrão entregue: post único 4:5, composição do diretor.", fonte: "entrega", agente: "geral" });
    expect(r.situacao).toBe("criado");
    expect(r.avisos.join(" ")).toContain("AP-01");
    const inserido = gravados.find((g) => g.op === "insert")!;
    expect(inserido.dados).toMatchObject({ categoria: "aprendizado", fonte: "entrega", agente: "geral", area: "arte" });
    expect(categoriaDaLinhaDeMemoria({ categoria: "aprendizado", fonte: "entrega", tipo: "aprendizado" })).toBe("entrega");
  });

  it("a entrega não entra no resumo geral nem conta como fora por espaço", () => {
    const f = (id: string, categoria: FatoDoCerebro["categoria"], texto: string): FatoDoCerebro => ({ id, area: "arte", categoria, texto, motivo: null, evidencia: null, fonte: "memoria", criado_em: "2026-09-20", valido_ate: null, reforcos: 1, chave: chaveDoAprendizado(texto) });
    const r = resumoParaPrompt([f("1", "preferencia", "Fundo claro nas capas."), f("2", "entrega", "Padrão entregue: carrossel 4:5.")], { areas: ["arte"] });
    expect(r.texto).toContain("Fundo claro");
    expect(r.texto).not.toContain("Padrão entregue");
    expect(r.fora).toBe(0);
  });
});

// ────────────────────────────────────────────────────────────── números reais

const post = (id: string, alcance: number, salvos: number, compart: number, extra: Linha = {}): Linha => ({
  media_id: id,
  client_id: CLIENTE,
  media_type: "CAROUSEL_ALBUM",
  caption: `Legenda do ${id}`,
  permalink: `https://www.instagram.com/p/${id}/`,
  posted_at: "2026-09-10T15:00:00.000Z",
  reach: alcance,
  saved: salvos,
  shares: compart,
  comments_count: 2,
  like_count: 30,
  ...extra,
});

function bancoComNumeros(taxaDoPostDaEntrega: "topo" | "fundo") {
  const m = memoriaDaEntrega(trabalho(), { agora: new Date("2026-09-09T12:00:00.000Z") })!;
  const posts = [post("m2", 1000, 10, 5), post("m3", 1000, 12, 6), post("m4", 1000, 9, 4), post("m5", 1000, 14, 5), post("m6", 1000, 11, 7)];
  posts.push(taxaDoPostDaEntrega === "topo" ? post("m-entrega", 1000, 50, 30) : post("m-entrega", 1000, 1, 0));
  const b = bancoFalso({
    estudio_trabalhos: [{ id: TRABALHO, client_id: CLIENTE, post_id: POST, entrega_status: "aprovado", entrega_rodada: 1 }],
    editorial_publications: [{ client_id: CLIENTE, post_id: POST, file_id: ARQUIVO, external_post_id: "m-entrega", permalink: "https://www.instagram.com/p/m-entrega/", published_at: "2026-09-10T15:00:00.000Z", status: "published" }],
    social_post_metrics: posts,
  });
  b.arquivos.set(`mesa/${caminhoDoIndiceDasEntregas(CLIENTE)}`, JSON.stringify(comEntrega(indiceVazio(), m)));
  return b;
}

describe("números reais: reforço por desempenho", () => {
  it("post no topo do perfil vira padrão que funcionou, com reforço forte, julgado uma vez", async () => {
    const { db, arquivos, gravados } = bancoComNumeros("topo");
    const gravar = gravarOk();
    const r = await aprenderComOsNumeros(db, CLIENTE, { gravarNoCerebro: gravar, agora: AGORA });
    expect(r).toMatchObject({ situacao: "lido", julgadas: 1, topo: 1, fundo: 0 });
    expect(gravar).toHaveBeenCalledTimes(1);
    const novo = gravar.mock.calls[0][0] as { categoria: string; texto: string; motivo: string; fonte: string };
    expect(novo.categoria).toBe("performou");
    expect(novo.fonte).toBe("desempenho");
    expect(novo.texto).toMatch(/^Padrão que funcionou \(número real\):/);
    expect(novo.motivo).toContain("8%");
    expect(novo.motivo).toContain("20% melhores");
    const reforco = gravados.find((g) => g.tabela === "agente_memoria" && g.op === "update");
    expect(reforco && reforco.dados.reforcos).toBe(1 + REFORCO_DO_TOPO);
    const indice = JSON.parse(arquivos.get(`mesa/${caminhoDoIndiceDasEntregas(CLIENTE)}`)!);
    expect(indice.entregas[0].post_id).toBe(POST);
    expect(indice.entregas[0].aprovado).toBe(true);
    expect(indice.entregas[0].desempenho.posicao).toBe("topo");

    // Rodada seguinte da semana: lido há pouco, pula. Forçando: nada é julgado de novo.
    expect((await aprenderComOsNumeros(db, CLIENTE, { gravarNoCerebro: gravar, agora: AGORA })).situacao).toBe("recente");
    const deNovo = await aprenderComOsNumeros(db, CLIENTE, { gravarNoCerebro: gravar, agora: AGORA, forcar: true });
    expect(deNovo.julgadas).toBe(0);
    expect(gravar).toHaveBeenCalledTimes(1);
  });

  it("post no fundo vira sinal fraco (rendeu abaixo), sem reforço forte e sem apagar nada", async () => {
    const { db, gravados } = bancoComNumeros("fundo");
    const gravar = gravarOk();
    const r = await aprenderComOsNumeros(db, CLIENTE, { gravarNoCerebro: gravar, agora: AGORA });
    expect(r).toMatchObject({ situacao: "lido", topo: 0, fundo: 1 });
    const novo = gravar.mock.calls[0][0] as { categoria: string; texto: string };
    expect(novo.categoria).toBe("aprendizado");
    expect(novo.texto).toMatch(/^Rendeu abaixo \(sinal fraco, não é regra\):/);
    expect(gravados.some((g) => g.tabela === "agente_memoria" && g.op === "update")).toBe(false);
    expect(gravados.some((g) => g.dados && (g.dados as Linha).ativa === false)).toBe(false);
  });

  it("com menos de 5 posts medidos não há topo nem fundo", () => {
    const medidos = medirPosts([post("a", 1000, 50, 30), post("b", 1000, 1, 0)] as never, AGORA);
    expect(medidos.every((p) => p.posicao === "meio")).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────── o que funcionou

function entrega(id: string, over: Partial<MemoriaDaEntrega> = {}): MemoriaDaEntrega {
  const base = memoriaDaEntrega(trabalho({ id }), { agora: new Date("2026-09-20T12:00:00.000Z") })!;
  const m = { ...base, ...over };
  return { ...m, chave_do_padrao: over.padrao ? over.padrao.toLowerCase() : m.chave_do_padrao };
}
const desempenho = (posicao: "topo" | "meio" | "fundo", taxa: number) => ({ media_id: "x", permalink: null, publicado_em: "2026-09-10", alcance: 1000, salvos: 10, compartilhamentos: 5, comentarios: 1, taxa, posicao, julgado_em: "2026-09-27" });

describe("o que funcionou nas entregas (bloco na geração)", () => {
  it("3 padrões mais fortes (desempenho real > aprovação sem ajuste > recência), 1 linha do que evitar e o teto", () => {
    const longo = (n: number) => `Padrão entregue: carrossel 4:5 de 4 a 6 lâminas, template "Modelo número ${n} com um nome bem comprido para testar o teto", miolo em checklist, linha do tempo, cartões empilhados.`;
    const lista = [
      entrega("a1", { padrao: longo(1), aprovado_sem_ajuste: true, entregue_em: "2026-09-25T10:00:00Z" }),
      entrega("a2", { padrao: longo(2), desempenho: desempenho("topo", 6.2), entregue_em: "2026-09-01T10:00:00Z" }),
      entrega("a3", { padrao: longo(3), entregue_em: "2026-09-26T10:00:00Z" }),
      entrega("a4", { padrao: longo(4), desempenho: desempenho("fundo", 0.3), entregue_em: "2026-09-24T10:00:00Z" }),
      entrega("a5", { padrao: longo(5), substituida: true, desempenho: desempenho("topo", 9) }),
    ];
    const ranking = rankingDosPadroes(lista).map((g) => g.padrao);
    expect(ranking[0]).toBe(longo(2));
    expect(ranking[1]).toBe(longo(1));
    expect(ranking).not.toContain(longo(5));
    const bloco = blocoDoQueFuncionou(lista);
    expect(bloco.length).toBeLessThanOrEqual(TETO_DO_BLOCO_DAS_ENTREGAS);
    expect(bloco.startsWith(TITULO_DO_QUE_FUNCIONOU)).toBe(true);
    expect(bloco.split("\n").filter((l) => l.startsWith("- ") && !l.startsWith("- Evitar")).length).toBeLessThanOrEqual(3);
    expect(bloco.indexOf("Modelo número 2")).toBeLessThan(bloco.indexOf("Modelo número 1"));
    expect(bloco).toContain("topo do perfil: 6,2%");
    const curto = blocoDoQueFuncionou([entrega("b1", { padrao: "Padrão entregue: post único 4:5.", aprovado_sem_ajuste: true }), entrega("b2", { padrao: "Padrão entregue: carrossel 1:1.", desempenho: desempenho("fundo", 0.2) })]);
    expect(curto).toContain("- Evitar repetir: carrossel 1:1 (rendeu abaixo: 0,2%)");
  });

  it("capa: não repete a composição exata das últimas capas entregues", () => {
    const linha = linhaDaVariedadeDasEntregas([entrega("c1", { descricao_visual: descricao })]);
    expect(linha).toContain("CAPA NOVA: não repita a composição exata");
    expect(linha).toContain("título grande no topo");
    expect(linha.length).toBeLessThanOrEqual(260);
  });

  it("as melhores artes entregues viram sugestão para o estilo (sem a que já está nele)", () => {
    const lista = [entrega("d1", { desempenho: desempenho("topo", 5) }), entrega("d2", { aprovado_sem_ajuste: true }), entrega("d3")];
    const s = sugestoesParaOEstilo(lista, ["d2"]);
    expect(s.map((x) => x.trabalho_id)).toEqual(["d1"]);
    expect(s[0].motivo).toContain("Rendeu no topo");
  });
});

// ────────────────────────────────────────────────────────────── memória editorial

const memoria = () =>
  montarMemoriaEditorial({
    propostas: [
      { id: "p1", status: "gravada", itens: [{ tema_id: "t1", task_id: "task-1", data: "2026-09-12", formato: "carrossel", pilar: "Educação", tema: "Como escolher o protetor solar certo para pele oleosa", gancho: "Seu protetor está entupindo seus poros?", angulo: "passo a passo" }] },
      { id: "p0", status: "descartada", itens: [{ tema_id: "t9", data: "2026-09-01", tema: "Tema descartado que não conta" }] },
    ],
    tarefas: [{ id: "task-1", title: "Como escolher protetor solar", due_date: "2026-09-12", delivery_type: "carousel" }, { id: "task-2", title: "Bastidores da clínica", due_date: "2026-08-20", delivery_type: "static" }],
    publicacoes: [{ task_id: "task-1", external_post_id: "m1", permalink: "https://www.instagram.com/p/m1/", published_at: "2026-09-12T15:00:00Z" }],
    posts: [post("m1", 2300, 90, 40), post("m2", 1000, 10, 5, { caption: "Tour pela recepção nova. #clinica" }), post("m3", 1000, 12, 6), post("m4", 1000, 9, 4, { media_type: "IMAGE" }), post("m5", 1000, 3, 1, { media_type: "IMAGE" }), post("m6", 1000, 11, 7)] as never,
    agora: AGORA,
  });

describe("memória editorial do mês", () => {
  it("todos os temas (planejados, gravados, publicados) com os números e os melhores posts", () => {
    const m = memoria();
    const protetor = m.temas.find((t) => t.task_id === "task-1")!;
    expect(protetor.origem).toBe("publicado");
    expect(protetor.numeros && protetor.numeros.posicao).toBe("topo");
    expect(m.temas.some((t) => t.tema.indexOf("descartado") >= 0)).toBe(false);
    expect(m.temas.some((t) => t.tema === "Bastidores da clínica")).toBe(true);
    expect(m.temas.some((t) => t.chave === "post:m2" && t.tema.indexOf("Tour pela recepção nova") === 0)).toBe(true);
    expect(m.melhores[0].task_id).toBe("task-1");
    const bloco = blocoDaMemoriaEditorial(m);
    expect(bloco).toContain("MEMÓRIA EDITORIAL DO CLIENTE");
    expect(bloco).toContain("NUNCA repita");
    expect(bloco).toContain("continua_de");
    expect(bloco).toContain("MELHORES POSTS REAIS");
    expect(bloco).toContain("FORMATOS QUE RENDEM ABAIXO: estático");
    expect(bloco).not.toContain("—");
    expect(blocoDaMemoriaEditorial(m, { enxuto: true }).length).toBeLessThanOrEqual(5_000);
  });

  it("repetição detectada: parecido em código e o Choice do Jev (simulado) marca a pauta com aviso", () => {
    const m = memoria();
    const pauta = { tema: "Protetor solar para pele oleosa: como escolher", gancho: "O protetor certo não entope os poros", pilar: "Educação", chaves: ["prop:p9:x1"] };
    const parecidos = candidatosParecidos(pauta, m);
    expect(parecidos[0].tema.task_id).toBe("task-1");
    const q = perguntasDeRepeticao([{ pauta, parecidos }]);
    expect(Object.keys(q.questions)).toEqual(["relacao_0", "base_0"]);
    expect(q.questions.relacao_0.criteria).toHaveProperty("repeticao");
    expect(q.questions.relacao_0.criteria).toHaveProperty("angulo_novo");
    expect(q.questions.relacao_0.criteria).toHaveProperty("tema_diferente");
    expect(q.questions.base_0.criteria).toHaveProperty("c1");
    expect(q.questions.base_0.criteria).toHaveProperty("nenhum");
    expect(String(q.questions.relacao_0.instructions)).toContain("`pautas[0].nova`");
    const jev = {
      relacao: { choice: "repeticao", probabilities: { repeticao: 0.82, angulo_novo: 0.12, tema_diferente: 0.06 } },
      base: { choice: "c1", probabilities: { c1: 0.9, nenhum: 0.1 } },
    };
    const ev = decidirEvolucao(pauta, parecidos, jev, q.mapas[0]);
    expect(ev.tipo).toBe("repeticao");
    expect(ev.de && ev.de.chave).toBe("task:task-1");
    expect(ev.aviso).toContain("12/09");
    expect(ev.jev).toEqual({ checado: true, probabilidade: 0.82 });
    expect(seloDaEvolucao(ev)).toMatchObject({ rotulo: "repete 12/09", tom: "aviso" });
  });

  it("ângulo novo com a relação marcada (continua o post de 12/09)", () => {
    const m = memoria();
    const apelido = m.temas.find((t) => t.task_id === "task-1")!.apelido;
    const pauta = { tema: "O erro que mais estraga o protetor solar na pele oleosa", gancho: "Você reaplica errado", angulo: "erro comum", continua_de: apelido, pilar: "Educação", chaves: [] };
    const parecidos = candidatosParecidos(pauta, m);
    expect(parecidos[0].declarado).toBe(true);
    const q = perguntasDeRepeticao([{ pauta, parecidos }]);
    const ev = decidirEvolucao(pauta, parecidos, { relacao: { choice: "angulo_novo", probabilities: { repeticao: 0.1, angulo_novo: 0.75, tema_diferente: 0.15 } }, base: { choice: "c1", probabilities: { c1: 0.8, nenhum: 0.2 } } }, q.mapas[0]);
    expect(ev.tipo).toBe("novo_angulo");
    expect(ev.frase).toBe('continua o post de 12/09 sobre "Como escolher o protetor solar certo para pele oleosa": agora erro comum');
    expect(seloDaEvolucao(ev)).toMatchObject({ rotulo: "novo ângulo de 12/09", tom: "neutro" });
    // Jev fora do ar: vale o que o modelo marcou (sem ter conferido).
    const semJev = decidirEvolucao(pauta, parecidos, null);
    expect(semJev.tipo).toBe("novo_angulo");
    expect(semJev.jev.checado).toBe(false);
  });

  it("peça apagada (ou tirada pelo refazer) não conta como tema já feito", () => {
    const m = montarMemoriaEditorial({
      propostas: [{ id: "p1", status: "gravada", itens: [{ tema_id: "t1", task_id: "task-1", data: "2026-09-12", tema: "Como escolher o protetor solar certo" }, { tema_id: "t2", task_id: "task-2", data: "2026-09-15", tema: "Bastidores da clínica" }] }],
      tarefasArquivadas: ["task-1"],
      agora: AGORA,
    });
    expect(m.temas.map((t) => t.task_id)).toEqual(["task-2"]);
  });

  it("peça apagada (ou tirada pelo refazer) não conta como tema já feito", () => {
    const m = montarMemoriaEditorial({
      propostas: [{ id: "p1", status: "gravada", itens: [{ tema_id: "t1", task_id: "task-apagada", data: "2026-09-12", tema: "Como escolher protetor solar" }] }],
      tarefasArquivadas: ["task-apagada"],
    });
    expect(m.temas).toHaveLength(0);
  });

  it("tema diferente não pergunta nada ao Jev", () => {
    const pauta = { tema: "Horário de atendimento no feriado", gancho: "Abrimos no sábado", pilar: "Avisos" };
    const parecidos = candidatosParecidos(pauta, memoria());
    expect(parecidos).toHaveLength(0);
    expect(perguntasDeRepeticao([{ pauta, parecidos }]).indices).toHaveLength(0);
    expect(decidirEvolucao(pauta, parecidos, null)).toMatchObject({ tipo: "tema_novo", frase: "tema novo" });
  });

  it("sequência de evolução por pilar (do básico ao avançado)", () => {
    const nos = nosDasPropostas([
      { id: "p1", status: "gravada", itens: [{ tema_id: "t1", task_id: "task-1", data: "2026-09-12", pilar: "Educação", tema: "Como escolher protetor solar" }] },
      {
        id: "p2",
        status: "pronta",
        itens: [
          { tema_id: "t2", data: "2026-09-26", pilar: "Educação", tema: "O erro comum com protetor", angulo: "erro comum", evolucao: { tipo: "novo_angulo", angulo: "erro comum", de: { chave: "task:task-1", data: "2026-09-12", tema: "Como escolher protetor solar", origem: "publicado" }, frase: "x", aviso: null, jev: { checado: true, probabilidade: 0.7 } } },
          { tema_id: "t3", data: "2026-10-10", pilar: "Educação", tema: "Caso real: a pele da Ana", angulo: "caso real", evolucao: { tipo: "novo_angulo", angulo: "caso real", de: { chave: "prop:p2:t2", data: "2026-09-26", tema: "O erro comum com protetor", origem: "planejado" }, frase: "x", aviso: null, jev: { checado: true, probabilidade: 0.7 } } },
          { tema_id: "t4", data: "2026-10-12", pilar: "Avisos", tema: "Feriado" },
        ],
      },
    ]);
    const linhas = linhasDeEvolucao(nos);
    expect(linhas).toHaveLength(1);
    expect(linhas[0].pilar).toBe("Educação");
    expect(linhas[0].passos.map((p) => [p.data, p.angulo])).toEqual([["2026-09-12", null], ["2026-09-26", "erro comum"], ["2026-10-10", "caso real"]]);
  });
});

// ────────────────────────────────────────────────────────────── sem histórico

describe("cliente sem histórico: nada muda", () => {
  it("blocos vazios e o prompt da lâmina igual byte a byte", async () => {
    expect(blocoDoQueFuncionou([])).toBe("");
    expect(linhaDaVariedadeDasEntregas([])).toBe("");
    expect(blocoDaMemoriaEditorial(montarMemoriaEditorial({}))).toBe("");
    expect(seloDaEvolucao(null)).toBeNull();
    const { db } = bancoFalso();
    const r = await blocosDasEntregas(db, CLIENTE, { capa: true });
    expect(r).toEqual({ bloco: "", variedade: "", entregas: 0 });
    // Mesma montagem do Estúdio (filter(Boolean) + join): os blocos vazios somem.
    const antes = ["BASE", "", "PREFERENCIAS", "SERIE"].filter(Boolean).join("\n\n");
    const depois = ["BASE", "", "PREFERENCIAS", r.bloco, r.variedade, "SERIE"].filter(Boolean).join("\n\n");
    expect(depois).toBe(antes);
  });

  it("no código: os blocos entram só quando existem (Estúdio, diretor e agente do Mês)", () => {
    const estudio = ler("supabase/functions/estudio-arte/index.ts");
    expect(estudio).toContain("    preferencias,\n    // Frente AP: o que funcionou nas entregas deste cliente e, na capa, não repetir a composição das últimas capas entregues.\n    dasEntregas.bloco,\n    dasEntregas.variedade,");
    expect(estudio).toContain('dasEntregas.bloco ? `Os padrões abaixo, das entregas deste cliente, valem desde que não mudem o layout da referência.\\n${dasEntregas.bloco}` : "",');
    expect(estudio).toContain("aprenderComAEntrega(gravado, ch.userId, nomeBase);");
    expect(estudio).toContain("aprenderComAEntrega({ ...gravado, file_ids: fileIds }, ch.userId, nomeBase);");
    const cal = ler("supabase/functions/agente-calendario/index.ts");
    expect(cal).toContain("if (!alvos.length || !memoria || !memoria.temas.length) {");
    expect(cal).toContain('${memoria ? `\\n\\n${memoria}` : ""}');
    expect(cal).toContain("trocar_angulo: trocarAngulo,");
    const robo = ler("supabase/functions/perfis-instagram/index.ts");
    expect(robo).toContain("aprenderComOsNumerosDaSemana(servico() as unknown as BancoDoAprendizado, {");
  });
});

// ────────────────────────────────────────────────────────────── tela

describe("O que o painel aprendeu", () => {
  it("origem legível, fora o plano do mês, mais forte primeiro", () => {
    const linhas = [
      { id: "1", texto: "Padrão entregue: carrossel 4:5.", categoria: "entrega", fonte: "entrega", reforcos: 3, criado_em: "2026-09-20" },
      { id: "2", texto: "Plano do mês 2026-10: foco em prova social.", tipo: "preferencia", origem: "manual" },
      { id: "3", texto: "Aumentar a logo.", categoria: "ajuste", origem: "ajuste", criado_em: "2026-09-25" },
      { id: "4", texto: "O cliente reprovou: fundo escuro.", categoria: "reprovado", origem: "aprovacao", tipo: "evitar" },
      { id: "5", texto: "Padrão que funcionou (número real): post único.", categoria: "performou", fonte: "desempenho", reforcos: 3, criado_em: "2026-09-26" },
      { id: "6", texto: "Inativo.", ativa: false },
    ];
    const lista = aprendizadosDoPainel(linhas);
    expect(lista.map((a) => a.id)).toEqual(["5", "1", "3", "4"]);
    expect(lista.map((a) => a.fonte)).toEqual(["desempenho", "entrega", "ajuste", "reprovacao"]);
    expect(aprendizadosDoPainel(linhas, "entrega").map((a) => a.id)).toEqual(["1"]);
    expect(fonteDoAprendizado({ id: "x", texto: "y", tipo: "preferencia", origem: "manual" })).toBe("equipe");
    expect(resumoDosAprendizados(lista)).toBe("1 de entregas · 1 de ajustes · 1 de reprovações · 1 de números reais");
  });
});
