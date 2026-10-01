/**
 * Prévia editável da Mesa Site (frente SPV, 30/09/2026): as rotas da função
 * mesa-site. As regras puras moram em modulos/site-previa.ts (o vitest e a tela leem).
 *
 * previa_dados    { site_id } -> cores, fontes, logo e imagens (URL assinada, 1 h) para a prévia rápida
 * previa_editar   { site_id, edicao, confirmar?, instrucao?, teto_usd?, modelo_id? }
 *                 conteúdo: aplica na hora, registra (Desfazer) e leva ao site do motor (o pedido que espera na
 *                 fila ganha o pacote novo; senão, trabalho "conteudo", sem custo);
 *                 código: sem confirmar devolve o custo; com confirmar vira trabalho "ajustar" (teto reservado)
 * previa_desfazer { site_id, edicao_id } -> volta o ponto (conteúdo) ou para/desfaz o trabalho (código)
 * previa_edicoes  { site_id } -> as últimas edições, com o que já foi desfeito
 *
 * Regras: nada é enviado ao cliente nem publicado; custo só com Confirmar;
 * foto real só do acervo desta marca (a outra marca nunca herda); erro vai
 * para o log e para a tela. Sem travessão.
 */

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { registrarFalha } from "../_shared/falha-registrada.ts";
import { fotoDaMarca } from "../_shared/marca.ts";
import { ehAberto, podeDesfazer, type TrabalhoDoMotor } from "../_shared/motor-codigo.ts";
import { lerTrabalho, orcar } from "../_shared/motor-fila.ts";
import { type LinhaDoSite, montarPacoteDoSite } from "../_shared/pacote-do-site.ts";
import { type AlvoDaEdicao, destinoDaEdicao, ErroDaPrevia, type ImagemDaPrevia, imagensDaPrevia, normalizarEdicao, pacoteMaisNovo, pacoteParaOPedido, planejarDesfazer, planejarEdicao, textoLimpo } from "./modulos/site-previa.ts";
import { FONTES_DO_CATALOGO, fonteDoCatalogo } from "../_shared/tipografia-da-marca.ts";
import { coresDoSite } from "../_shared/uiux/apoio-da-paleta.ts";
import { normalizarEstilo } from "../_shared/site-biblioteca.ts";
import type { ChamadorDaEstrutura, ContextoDaEstrutura } from "./estrutura.ts";

export type ContextoDaPrevia = ContextoDaEstrutura & {
  /** Trabalho do motor para este site (o mesmo caminho do diretor de site: pacote, regras e contexto da marca). */
  pedirTrabalho: (ch: ChamadorDaEstrutura, s: LinhaDoSite, pedido: Record<string, unknown>, pacote?: Record<string, unknown>) => Promise<TrabalhoDoMotor>;
  /** O pacote que o worker escreve no projeto (sem criar trabalho). */
  pacoteDoMotor: (s: LinhaDoSite) => Promise<Record<string, unknown>>;
};

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const semTabela = (e: { code?: string; message?: string } | null | undefined) => !!e && (e.code === "42P01" || e.code === "PGRST205" || /site_edicoes.*(does not exist|schema cache)/i.test(String(e.message || "")));
export const AVISO_SEM_HISTORICO = "A edição foi salva, mas o histórico do Desfazer ainda não existe no banco (migration 20260930317000 pendente).";

/** Prazo da URL assinada das imagens na prévia rápida (a tela relê antes de vencer). */
export const PRAZO_DA_URL_S = 3600;

/** Roda a regra pura e troca o ErroDaPrevia pelo erro da função (status e código iguais). */
function tentar<T>(ctx: ContextoDaEstrutura, f: () => T): T {
  try {
    return f();
  } catch (e) {
    if (e instanceof ErroDaPrevia) throw ctx.erro(e.status, e.codigo, e.message);
    throw e;
  }
}

// ------------------------------------------------------------------ dados da prévia rápida

async function assinar(db: SupabaseClient, itens: Array<{ bucket: string; path: string }>): Promise<Map<string, string>> {
  const saida = new Map<string, string>();
  const porBalde = new Map<string, string[]>();
  itens.forEach((i) => {
    const l = porBalde.get(i.bucket) || [];
    if (l.indexOf(i.path) < 0) l.push(i.path);
    porBalde.set(i.bucket, l);
  });
  for (const [balde, caminhos] of porBalde) {
    const { data, error } = await db.storage.from(balde).createSignedUrls(caminhos, PRAZO_DA_URL_S);
    if (error) {
      registrarFalha("mesa-site: prévia sem URL das imagens", error, { balde, quantas: caminhos.length });
      continue;
    }
    (data || []).forEach((d: { path?: string | null; signedUrl?: string | null; error?: string | null }) => {
      if (d && d.path && d.signedUrl && !d.error) saida.set(`${balde}/${d.path}`, d.signedUrl);
    });
  }
  return saida;
}

async function previaDados(ctx: ContextoDaPrevia, ch: ChamadorDaEstrutura, c: Record<string, unknown>) {
  const s = await ctx.lerSite(ch, c.site_id);
  const marca = await ctx.marcaDoSite(s);
  // O mesmo pacote do motor (regra de herança da marca), então a prévia rápida usa as mesmas cores e fontes.
  const { pacote, arquivos } = await montarPacoteDoSite(ctx.servico(), s, marca);
  const estilo = obj(pacote.estilo);
  const cores = coresDoSite({ paleta: pacote.paleta, dna: pacote.dna, estilo });
  const coresDaMarca = coresDoSite({ paleta: pacote.paleta, dna: pacote.dna, estilo: { ...estilo, ajustes: undefined } });
  const ajustes = normalizarEstilo(s.estilo || {}).ajustes || {};
  const imagens = imagensDaPrevia(s.imagens);
  const logo = arquivos.find((a) => /^public\/marca\/logo\./.test(a.destino)) || null;
  const urls = await assinar(ctx.servico(), imagens.map((i) => ({ bucket: i.bucket, path: i.path })).concat(logo ? [{ bucket: logo.bucket, path: logo.path }] : []));
  const fonte = (re: RegExp) => {
    const f = (pacote.fontes || []).find((x) => re.test(String(x.papel || "")));
    return f ? f.nome : null;
  };
  return ctx.json({
    nome: pacote.cliente || s.nome,
    cores,
    cores_da_marca: coresDaMarca,
    paleta_da_marca: (pacote.paleta || []).map((p) => p.hex),
    ajustes,
    fontes: { titulo: fonte(/tit|display|head/i), texto: fonte(/texto|corpo|body/i) },
    fontes_url: pacote.fontes_url || null,
    fontes_disponiveis: FONTES_DO_CATALOGO.map((f) => ({ familia: f.familia, categoria: f.categoria })),
    logo_url: logo ? urls.get(`${logo.bucket}/${logo.path}`) || null : null,
    imagens: imagens.map((i) => ({ id: i.id, slot: i.slot, secao: i.secao || null, origem: i.origem, alt: i.alt, escolhida: i.escolhida !== false, url: urls.get(`${i.bucket}/${i.path}`) || null })),
    expira_em: new Date(Date.now() + PRAZO_DA_URL_S * 1000).toISOString(),
    custo_usd: 0,
  });
}

// ------------------------------------------------------------------ levar ao site do motor

type NaFila = { id: string; tipo: string; estado: string; commit: string | null; criado_em?: string };
type Troca = "trocou" | "mais_novo" | "pegou";

/**
 * Troca o pacote de um pedido que ainda espera na fila, só por um mais novo
 * (carimbo `pedido.pacote_de`): dois envios em segundo plano fora de ordem
 * nunca deixam o pacote velho por cima do novo. Compara e troca (o carimbo
 * lido entra no filtro); se alguém trocou no meio, relê e tenta de novo.
 */
async function trocarPacote(db: SupabaseClient, id: string, pacote: Record<string, unknown>, carimbo: string | null): Promise<Troca> {
  for (let tentativa = 0; tentativa < 3; tentativa++) {
    const { data, error } = await db.from("motor_trabalhos").select("id, tipo, estado, pedido").eq("id", id).maybeSingle();
    if (error) throw new Error(`fila do motor: ${error.message}`);
    const linha = data as { tipo: string; estado: string; pedido: unknown } | null;
    if (!linha || linha.estado !== "na_fila") return "pegou";
    const pedido = obj(linha.pedido);
    if (!pacoteMaisNovo(pedido.pacote_de, carimbo)) return "mais_novo";
    const lido = typeof pedido.pacote_de === "string" ? pedido.pacote_de : null;
    const novoPedido = { ...pedido, pacote: pacoteParaOPedido(obj(pedido.pacote), pacote, linha.tipo), pacote_de: carimbo || lido };
    let q = db.from("motor_trabalhos").update({ pedido: novoPedido }).eq("id", id).eq("estado", "na_fila");
    q = lido ? q.eq("pedido->>pacote_de", lido) : q.is("pedido->>pacote_de", null);
    const { data: trocada, error: e2 } = await q.select("id").maybeSingle();
    if (e2) throw new Error(`fila do motor: ${e2.message}`);
    if (trocada) return "trocou";
  }
  return "pegou";
}

/**
 * Leva a edição de conteúdo ao projeto do worker (o Vite da prévia recarrega).
 * O caminho sai de `destinoDaEdicao`: o pedido que ainda espera na fila
 * (inclusive o construir de antes do primeiro commit) ganha o pacote novo;
 * senão, com projeto ou trabalho rodando com o pacote velho, um "conteudo"
 * entra no fim da fila. Dois "conteudo" esperando juntos viram um só (fica o
 * último da fila, com o pacote mais novo).
 */
export async function levarAoMotor(ctx: ContextoDaPrevia, ch: ChamadorDaEstrutura, siteId: string): Promise<{ trabalho_id: string | null; juntou: boolean }> {
  const db = ctx.servico();
  const s = await ctx.lerSite(ch, siteId);
  const carimbo = s.pacote_mudou_em || null;
  const { data, error } = await db.from("motor_trabalhos").select("id, tipo, estado, commit, criado_em").eq("client_id", s.client_id).eq("referencia_id", s.id).order("criado_em", { ascending: false }).limit(40);
  if (error) throw new Error(`fila do motor: ${error.message}`);
  const lista = (data as NaFila[]) || [];
  const destino = destinoDaEdicao(lista);
  if (!destino.atualizar.length && !destino.criar) return { trabalho_id: null, juntou: false };
  const pacote = await ctx.pacoteDoMotor(s);
  let ficou: string | null = null;
  for (const id of destino.atualizar) {
    const r = await trocarPacote(db, id, pacote, carimbo);
    if (r !== "pegou" && !ficou) ficou = id;
  }
  if (ficou && !destino.publicarAberto) return { trabalho_id: ficou, juntou: true };
  const t = await ctx.pedirTrabalho(ch, s, { tipo: "conteudo", instrucao: "Edição pela prévia" }, pacote);
  return await juntarConteudos(db, ch, s.client_id, s.id, t.id, pacote, carimbo);
}

/** Dois envios ao mesmo tempo criaram dois "conteudo": fica o último da fila (com o pacote mais novo) e os outros são cancelados. */
async function juntarConteudos(db: SupabaseClient, ch: ChamadorDaEstrutura, clientId: string, siteId: string, meu: string, pacote: Record<string, unknown>, carimbo: string | null): Promise<{ trabalho_id: string; juntou: boolean }> {
  const { data, error } = await db.from("motor_trabalhos").select("id, tipo, estado, commit, criado_em").eq("client_id", clientId).eq("referencia_id", siteId).eq("tipo", "conteudo").eq("estado", "na_fila").order("criado_em", { ascending: false }).limit(10);
  if (error) return { trabalho_id: meu, juntou: false };
  const pendentes = (data as NaFila[]) || [];
  if (pendentes.length < 2) return { trabalho_id: meu, juntou: false };
  const fica = pendentes[0].id;
  const agora = new Date().toISOString();
  for (const p of pendentes.slice(1)) {
    const { error: e2 } = await db.from("motor_trabalhos").update({ estado: "cancelado", terminado_em: agora, parar_pedido_em: agora, parar_pedido_por: ch.userId }).eq("id", p.id).eq("estado", "na_fila");
    if (e2) registrarFalha("mesa-site: conteudo repetido não cancelado", e2, { trabalho_id: p.id });
  }
  if (fica !== meu) await trocarPacote(db, fica, pacote, carimbo);
  return { trabalho_id: fica, juntou: fica !== meu };
}

/** Em segundo plano (a resposta não espera o pacote): falha vai para o log. */
function levarDepois(ctx: ContextoDaPrevia, ch: ChamadorDaEstrutura, siteId: string) {
  const p = levarAoMotor(ctx, ch, siteId).catch((e: unknown) => {
    registrarFalha("mesa-site: edição da prévia não foi ao motor", e, { site_id: siteId });
  });
  const er = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
  if (er && typeof er.waitUntil === "function") er.waitUntil(p);
  return p;
}

// ------------------------------------------------------------------ registro

type LinhaDaEdicao = {
  id: string;
  site_id: string;
  client_id: string;
  tipo: string;
  modo: "direto" | "ajuste";
  resumo: string;
  secao: string | null;
  alvos: AlvoDaEdicao[];
  trabalho_id: string | null;
  desfeita_em: string | null;
  criado_por: string | null;
  criado_em: string;
};
const CAMPOS_DA_EDICAO = "id, site_id, client_id, tipo, modo, resumo, secao, alvos, trabalho_id, desfeita_em, criado_por, criado_em";

async function registrar(ctx: ContextoDaPrevia, ch: ChamadorDaEstrutura, s: LinhaDoSite, r: { tipo: string; modo: "direto" | "ajuste"; resumo: string; secao: string | null; alvos: AlvoDaEdicao[]; edicao: unknown; trabalhoId?: string | null }): Promise<{ edicao: LinhaDaEdicao | null; aviso: string | null }> {
  const { data, error } = await ctx
    .servico()
    .from("site_edicoes")
    .insert({ site_id: s.id, client_id: s.client_id, marca_id: s.marca_id, tipo: r.tipo, modo: r.modo, resumo: r.resumo.slice(0, 300) || "Edição", secao: r.secao, alvos: r.alvos, edicao: r.edicao, trabalho_id: r.trabalhoId || null, criado_por: ch.userId })
    .select(CAMPOS_DA_EDICAO)
    .single();
  if (error) {
    if (!semTabela(error)) registrarFalha("mesa-site: edição da prévia sem registro", error, { site_id: s.id });
    return { edicao: null, aviso: semTabela(error) ? AVISO_SEM_HISTORICO : "A edição foi salva, mas não entrou no histórico do Desfazer agora." };
  }
  return { edicao: data as LinhaDaEdicao, aviso: null };
}

// ------------------------------------------------------------------ editar

async function fotoDoAcervo(ctx: ContextoDaPrevia, s: LinhaDoSite, id: string): Promise<ImagemDaPrevia | null> {
  const { data, error } = await ctx.servico().from("cliente_imagens").select("id, client_id, storage_bucket, storage_path, nome, descricao, tags, ativa").eq("id", id).maybeSingle();
  if (error) throw ctx.erro(503, "acervo_indisponivel", "Não foi possível ler o acervo agora.");
  const f = data as { client_id: string; storage_bucket: string; storage_path: string; nome: string; descricao: string | null; tags: string[] | null; ativa: boolean } | null;
  if (!f || f.client_id !== s.client_id || f.ativa === false) return null;
  // A outra marca nunca herda: foto marcada para outra marca não entra neste site.
  const marca = await ctx.marcaDoSite(s);
  if (!fotoDaMarca(f.tags, marca)) return null;
  return { id: crypto.randomUUID(), slot: "secao", origem: "real", bucket: f.storage_bucket, path: f.storage_path, alt: String(f.descricao || f.nome || "").slice(0, 200), escolhida: true };
}

async function previaEditar(ctx: ContextoDaPrevia, ch: ChamadorDaEstrutura, c: Record<string, unknown>) {
  const s = await ctx.lerSite(ch, c.site_id);
  const edicao = tentar(ctx, () => normalizarEdicao(c.edicao));
  if (edicao.tipo === "fonte" && edicao.nome && !fonteDoCatalogo(edicao.nome)) throw ctx.erro(400, "fonte_fora_do_catalogo", "Essa fonte não está no catálogo da casa (o site só pede fonte que o Google tem).");
  const fotoReal = edicao.tipo === "imagem" && !edicao.imagem_id && edicao.cliente_imagem_id ? await fotoDoAcervo(ctx, s, edicao.cliente_imagem_id) : null;
  const plano = tentar(ctx, () => planejarEdicao(s, edicao, { fotoReal }));
  if (plano.modo === "nada") return ctx.json({ modo: "nada", resumo: plano.resumo, site: s, custo_usd: 0 });

  if (plano.modo === "direto") {
    const site = await ctx.atualizarSite(s.id, { ...plano.campos, pacote_mudou_em: new Date().toISOString() });
    const r = await registrar(ctx, ch, s, { tipo: edicao.tipo, modo: "direto", resumo: plano.resumo, secao: plano.secao, alvos: plano.alvos, edicao });
    levarDepois(ctx, ch, s.id);
    return ctx.json({ modo: "direto", site, edicao: r.edicao, resumo: plano.resumo, avisos: r.aviso ? [r.aviso] : [], custo_usd: 0 });
  }

  // Código: o custo antes; o trabalho só entra com Confirmar.
  const instrucao = typeof c.instrucao === "string" && textoLimpo(c.instrucao, 1500).length >= 3 ? textoLimpo(c.instrucao, 1500) : plano.instrucao;
  const modeloId = typeof c.modelo_id === "string" && UUID.test(c.modelo_id) ? c.modelo_id : null;
  if (c.confirmar !== true) {
    const o = await orcar(ctx.servico(), s.client_id, { tipo: "ajustar", secao: plano.secao, instrucao }, modeloId || s.modelo);
    return ctx.json({
      modo: "ajuste",
      precisa_confirmar: true,
      secao: plano.secao,
      instrucao,
      resumo: plano.resumo,
      estimativa_usd: o.estimativa_usd,
      teto_sugerido_usd: o.teto_sugerido_usd,
      livre_usd: o.livre_usd,
      modelo: o.modelo ? { id: o.modelo.id, modelo_api: o.modelo.modelo_api } : null,
      custo_usd: 0,
    });
  }
  const pedido: Record<string, unknown> = { tipo: "ajustar", secao: plano.secao, instrucao };
  if (typeof c.teto_usd === "number" && c.teto_usd > 0) pedido.teto_usd = c.teto_usd;
  if (modeloId) pedido.modelo_id = modeloId;
  const trabalho = await ctx.pedirTrabalho(ch, s, pedido);
  const r = await registrar(ctx, ch, s, { tipo: edicao.tipo, modo: "ajuste", resumo: plano.resumo, secao: plano.secao, alvos: [], edicao: { ...edicao, instrucao }, trabalhoId: trabalho.id });
  return ctx.json({ modo: "ajuste", trabalho, edicao: r.edicao, resumo: plano.resumo, avisos: r.aviso ? [r.aviso] : [], custo_usd: 0 });
}

// ------------------------------------------------------------------ desfazer e histórico

async function lerEdicao(ctx: ContextoDaPrevia, s: LinhaDoSite, id: unknown): Promise<LinhaDaEdicao> {
  if (typeof id !== "string" || !UUID.test(id)) throw ctx.erro(400, "edicao_id_invalido", "edicao_id precisa ser um UUID.");
  const { data, error } = await ctx.servico().from("site_edicoes").select(CAMPOS_DA_EDICAO).eq("id", id).eq("site_id", s.id).maybeSingle();
  if (error) throw ctx.erro(503, semTabela(error) ? "banco_sem_historico" : "historico_indisponivel", semTabela(error) ? "O histórico da prévia ainda não existe no banco (migration 20260930317000 pendente)." : "Não foi possível ler a edição agora.");
  if (!data) throw ctx.erro(404, "edicao_inexistente", "Edição não encontrada neste site.");
  return data as LinhaDaEdicao;
}

async function marcarDesfeita(ctx: ContextoDaPrevia, ch: ChamadorDaEstrutura, e: LinhaDaEdicao): Promise<LinhaDaEdicao> {
  const { data, error } = await ctx.servico().from("site_edicoes").update({ desfeita_em: new Date().toISOString(), desfeita_por: ch.userId }).eq("id", e.id).is("desfeita_em", null).select(CAMPOS_DA_EDICAO).maybeSingle();
  if (error) {
    registrarFalha("mesa-site: edição desfeita sem marca", error, { edicao_id: e.id });
    return { ...e, desfeita_em: new Date().toISOString() };
  }
  if (!data) throw ctx.erro(409, "ja_desfeita", "Esta edição já foi desfeita.");
  return data as LinhaDaEdicao;
}

async function previaDesfazer(ctx: ContextoDaPrevia, ch: ChamadorDaEstrutura, c: Record<string, unknown>) {
  const s = await ctx.lerSite(ch, c.site_id);
  const e = await lerEdicao(ctx, s, c.edicao_id);
  if (e.desfeita_em) throw ctx.erro(409, "ja_desfeita", "Esta edição já foi desfeita.");
  if (e.modo === "direto") {
    const r = planejarDesfazer(s, Array.isArray(e.alvos) ? e.alvos : []);
    if ("conflito" in r) throw ctx.erro(409, "mudou_depois", r.conflito);
    const site = await ctx.atualizarSite(s.id, { ...r.campos, pacote_mudou_em: new Date().toISOString() });
    const edicao = await marcarDesfeita(ctx, ch, e);
    levarDepois(ctx, ch, s.id);
    return ctx.json({ site, edicao, resumo: `Desfeito: ${e.resumo}`, custo_usd: 0 });
  }
  // Ajuste do motor: na fila ou rodando, para; pronto com commit, volta o commit (máquina, sem custo).
  if (!e.trabalho_id) throw ctx.erro(409, "sem_trabalho", "Esta edição não tem trabalho do motor para desfazer.");
  const t = await lerTrabalho(ctx.servico(), e.trabalho_id);
  if (t.client_id !== s.client_id || t.referencia_id !== s.id) throw ctx.erro(404, "trabalho_inexistente", "Trabalho de outro site.");
  let trabalho: TrabalhoDoMotor | null = null;
  let resumo: string;
  if (ehAberto(t.estado)) {
    await ctx.pararTrabalhoDoSite(ch, s, t.id);
    resumo = t.estado === "na_fila" ? "Ajuste cancelado antes de começar" : "O motor para o ajuste no próximo passo";
  } else if (podeDesfazer(t)) {
    trabalho = await ctx.pedirTrabalho(ch, s, { tipo: "desfazer", alvo_trabalho_id: t.id, instrucao: `Desfazer: ${e.resumo}`.slice(0, 200) });
    resumo = "O motor volta o código deste ajuste";
  } else resumo = "O ajuste não mudou o código: nada a voltar";
  const edicao = await marcarDesfeita(ctx, ch, e);
  return ctx.json({ site: s, edicao, trabalho, resumo, custo_usd: 0 });
}

async function previaEdicoes(ctx: ContextoDaPrevia, ch: ChamadorDaEstrutura, c: Record<string, unknown>) {
  const s = await ctx.lerSite(ch, c.site_id, true);
  const limite = Math.max(1, Math.min(60, Math.floor(Number(c.limite) || 40)));
  const { data, error } = await ctx.servico().from("site_edicoes").select(CAMPOS_DA_EDICAO).eq("site_id", s.id).order("criado_em", { ascending: false }).limit(limite);
  if (error) {
    if (semTabela(error)) return ctx.json({ edicoes: [], indisponivel: true, aviso: "O histórico da prévia ainda não existe no banco (migration 20260930317000 pendente).", custo_usd: 0 });
    registrarFalha("mesa-site: histórico da prévia não lido", error, { site_id: s.id });
    throw ctx.erro(503, "historico_indisponivel", "Não foi possível ler o histórico agora.");
  }
  // A lista vai sem os alvos (o antes e o depois ficam no servidor).
  const edicoes = ((data as LinhaDaEdicao[]) || []).map(({ alvos: _alvos, ...resto }) => resto);
  return ctx.json({ edicoes, custo_usd: 0 });
}

export function rotasDaPrevia(ctx: ContextoDaPrevia): Record<string, (ch: ChamadorDaEstrutura, c: Record<string, unknown>) => Promise<Response>> {
  // O ErroDoMotor (saldo, teto, sem modelo) sobe como está: a função mesa-site já o devolve com os números.
  return {
    previa_dados: (ch, c) => previaDados(ctx, ch, c),
    previa_editar: (ch, c) => previaEditar(ctx, ch, c),
    previa_desfazer: (ch, c) => previaDesfazer(ctx, ch, c),
    previa_edicoes: (ch, c) => previaEdicoes(ctx, ch, c),
  };
}
