/**
 * Publicação da Mesa Site na Vercel da agência (20/10/2026): as rotas da
 * função mesa-site. As regras puras moram em modulos/publicacao-nuvem.ts e a
 * API da Vercel em modulos/publicacao-vercel.ts (o vitest e a tela leem).
 *
 * publicacao_estado     { site_id } -> chave (servidor e motor), versão salva a publicar, o que está no ar,
 *                       a comparação (entra, muda, sai do ar), as prévias na nuvem, domínio, DNS e zip
 * previa_nuvem_pedir    { site_id } -> trabalho "revisar" que compila o estado atual (rascunho ou versão
 *                       salva) e sobe a prévia na nuvem (sem custo de modelo); salvar já sobe a prévia sozinho
 * publicar              { site_id, confirmar: true, versao?, mesmo_assim? } -> trabalho "publicar" (o deploy
 *                       roda no worker); só a versão salva que a tela mostrou, com as travas do botão
 * publicacao_tirar_do_ar { site_id, confirmar: true } -> remove os endereços do deploy de produção
 * dominio_ligar         { site_id } -> põe o domínio (e o www) no projeto do site na Vercel e devolve o DNS
 * dominio_verificar     { site_id } -> pergunta à Vercel de novo (liga antes, se ainda não ligou)
 *
 * Onde mora a chave: o worker lê VERCEL_TOKEN do ambiente (supervisor); o
 * servidor lê VERCEL_TOKEN do ambiente da função (segredo do Supabase) ou do
 * cofre do painel. O valor nunca vai para log, evento ou resposta.
 */

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { TrabalhoDoMotor } from "../_shared/motor-codigo.ts";
import type { LinhaDoSite } from "../_shared/pacote-do-site.ts";
import { mapaDoSite } from "../_shared/site-biblioteca.ts";
import { cartaoDeDns, type ConfigDaVercel, ehRegistrador, estadoDoDominio } from "./modulos/dns-do-site.ts";
import { configDoDominio, criarApiDaVercel, dominioNoProjeto, ErroDaVercel, faltasParaPublicar, garantirProjeto, ligarDominio, tirarDoAr, vercelLigada, verificarDominio, wwwDe } from "./modulos/publicacao-vercel.ts";
import { compararComPublicado, conferirVersaoPedida, INSTRUCAO_DA_PREVIA_NA_NUVEM, lerPublicado, nomeNaVercel, paginasDoMapa, previaDoCommit, previaNaNuvemPedida, previasNaNuvem } from "./modulos/publicacao-nuvem.ts";
import { travaDaPublicacao, versoesSalvas } from "./modulos/obra-do-site.ts";

export type ChamadorDaPublicacao = { userId: string };

export type ContextoDaPublicacao = {
  servico: () => SupabaseClient;
  lerSite: (ch: ChamadorDaPublicacao, siteId: unknown) => Promise<LinhaDoSite>;
  atualizarSite: (id: string, campos: Record<string, unknown>) => Promise<LinhaDoSite>;
  erro: (status: number, codigo: string, mensagem: string, extra?: Record<string, unknown>) => Error;
  json: (body: unknown, status?: number) => Response;
  /** VERCEL_TOKEN do servidor (ambiente da função; sem ele, o cofre do painel). */
  token: () => Promise<string>;
  teamId: () => string | null;
  fetch: typeof fetch;
  trabalhos: (s: LinhaDoSite) => Promise<TrabalhoDoMotor[]>;
  executor: () => Promise<{ visto_em: string; capacidades: Record<string, unknown> } | null>;
  temBuild: (s: LinhaDoSite) => Promise<boolean>;
  ultimoZip: (s: LinhaDoSite) => Promise<{ path: string; em: string | null } | null>;
  /** Trabalho do motor sem modelo (revisar ou publicar), com o pacote que o worker lê. */
  criarTrabalho: (ch: ChamadorDaPublicacao, s: LinhaDoSite, pedido: { tipo: "revisar" | "publicar"; instrucao: string }, pacote: Record<string, unknown>) => Promise<TrabalhoDoMotor>;
  /** O pacote do site e os arquivos (o mesmo do construir) para o publicar levar SEO e integrações. */
  pacoteDoSite: (s: LinhaDoSite) => Promise<{ pacote: Record<string, unknown>; arquivos: unknown[] }>;
  auditar: (ch: ChamadorDaPublicacao, ferramenta: string, input: Record<string, unknown>, ref: string | null) => Promise<void>;
};

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** Em palavras da equipe; o nome do segredo fica, para o dono saber onde pôr. */
export const SEM_CHAVE_NO_SERVIDOR = "Falta a chave VERCEL_TOKEN no servidor (segredo do Supabase nas funções, ou Configurações › Chaves e custos). Domínio, DNS e tirar do ar dependem dela.";
export const SEM_CHAVE_NO_MOTOR = "a chave VERCEL_TOKEN no worker desta máquina (o deploy roda nele)";

/** As ações que falam com a Vercel começam a responder na hora (a plataforma corta em 150 s). */
export const ACOES_LONGAS_DA_PUBLICACAO = ["dominio_ligar", "dominio_verificar", "publicacao_tirar_do_ar"];

async function apiDoServidor(ctx: ContextoDaPublicacao) {
  const token = (await ctx.token()).trim();
  if (!vercelLigada(token)) throw ctx.erro(409, "vercel_sem_chave_no_servidor", SEM_CHAVE_NO_SERVIDOR);
  return criarApiDaVercel({ token, teamId: ctx.teamId(), fetch: ctx.fetch });
}

/** A Vercel recusou: a mensagem dela (sem o token) com o status certo para a tela. */
function erroDaVercel(ctx: ContextoDaPublicacao, e: unknown, oQue: string): Error {
  if (e instanceof ErroDaVercel) return ctx.erro(e.status === 401 || e.status === 403 ? 409 : 502, "vercel_recusou", `${oQue}: a Vercel respondeu ${e.status} (${e.message})`.slice(0, 300), { vercel: e.codigo });
  return e instanceof Error ? e : new Error(String(e));
}

/** A chave nos dois lados: o servidor (domínio, DNS, tirar do ar) e o motor (prévia e deploy). */
async function chaves(ctx: ContextoDaPublicacao): Promise<{ servidor: boolean; motor: boolean | null }> {
  const servidor = vercelLigada(await ctx.token().catch(() => ""));
  const ex = await ctx.executor().catch(() => null);
  const cap = ex ? obj(ex.capacidades).vercel : undefined;
  return { servidor, motor: cap === true ? true : cap === false ? false : null };
}

function faltasDoSite(c: { servidor: boolean; motor: boolean | null }, temBuild: boolean, dominio: string | null): string[] {
  const f = faltasParaPublicar({ vercelLigada: c.servidor || c.motor === true, temBuild, dominio });
  if ((c.servidor || c.motor === true) && c.motor === false) f.unshift(SEM_CHAVE_NO_MOTOR);
  return f;
}

/** A versão salva que o Publicar leva agora, a prévia dela e a comparação com o que está no ar. */
export function oQueVaiSubir(s: Pick<LinhaDoSite, "mapa" | "tipo" | "direcao" | "publicacao">, trabalhos: TrabalhoDoMotor[]) {
  const salva = versoesSalvas(trabalhos)[0] || null;
  const previa = salva ? previaDoCommit(trabalhos, salva.commit) : null;
  const paginas = previa ? previa.paginas : paginasDoMapa(mapaDoSite({ mapa: s.mapa, tipo: s.tipo, direcao: s.direcao as Record<string, unknown> | null }));
  const publicado = lerPublicado(s.publicacao);
  const comparacao = compararComPublicado({ commit: salva ? salva.commit : null, paginas, arquivos: previa ? previa.arquivos : null }, publicado);
  return {
    versao: salva ? { commit: salva.commit, em: salva.em, trabalho_id: salva.trabalho_id, origem: salva.origem, previa_url: previa ? previa.url : null } : null,
    publicado: publicado ? { deploy_url: publicado.deploy_url, commit: publicado.commit, paginas: publicado.paginas, publicado_em: publicado.publicado_em, no_ar: publicado.no_ar, tirado_em: publicado.tirado_em } : null,
    comparacao,
  };
}

async function publicacaoEstado(ctx: ContextoDaPublicacao, ch: ChamadorDaPublicacao, c: Record<string, unknown>) {
  const s = await ctx.lerSite(ch, c.site_id);
  const p = obj(s.publicacao);
  const dominio = typeof p.dominio === "string" ? p.dominio : null;
  const registrador = ehRegistrador(p.registrador) ? p.registrador : "registro_br";
  const [k, zip, construido, trabalhos] = await Promise.all([chaves(ctx), ctx.ultimoZip(s), ctx.temBuild(s), ctx.trabalhos(s).catch(() => [] as TrabalhoDoMotor[])]);
  const config = p.config && typeof p.config === "object" ? (p.config as ConfigDaVercel) : null;
  const sobe = oQueVaiSubir(s, trabalhos);
  return ctx.json({
    vercel_ligada: k.servidor || k.motor === true,
    vercel_no_servidor: k.servidor,
    vercel_no_motor: k.motor,
    faltas: faltasDoSite(k, construido, dominio),
    dominio,
    registrador,
    dominio_ligado: !!dominio && p.dominio_ligado === dominio,
    cartao: dominio ? cartaoDeDns(registrador, dominio, config) : null,
    estado: estadoDoDominio(config, !!dominio, p.certificado === true),
    deploy_url: typeof p.deploy_url === "string" && p.no_ar !== false ? p.deploy_url : null,
    ...sobe,
    previas: previasNaNuvem(trabalhos).slice(0, 15).map((x) => ({ url: x.url, commit: x.commit, ramo: x.ramo, em: x.em, paginas: x.paginas, trabalho_id: x.trabalho_id, protecao: x.protecao })),
    previa_pedida: !!previaNaNuvemPedida(trabalhos),
    zip,
    custo_usd: 0,
  });
}

async function previaNuvemPedir(ctx: ContextoDaPublicacao, ch: ChamadorDaPublicacao, c: Record<string, unknown>) {
  const s = await ctx.lerSite(ch, c.site_id);
  const k = await chaves(ctx);
  if (k.motor === false) throw ctx.erro(409, "vercel_sem_chave_no_motor", `A prévia na nuvem precisa de ${SEM_CHAVE_NO_MOTOR}. A prévia pelo túnel continua valendo.`);
  if (!(await ctx.temBuild(s))) throw ctx.erro(409, "sem_build", "Construa o site antes de pedir a prévia na nuvem.");
  const trabalhos = await ctx.trabalhos(s);
  const aberta = previaNaNuvemPedida(trabalhos);
  if (aberta) return ctx.json({ trabalho: aberta, ja_na_fila: true, custo_usd: 0 });
  const trabalho = await ctx.criarTrabalho(ch, s, { tipo: "revisar", instrucao: INSTRUCAO_DA_PREVIA_NA_NUVEM }, { previa_nuvem: true });
  return ctx.json({ trabalho, custo_usd: 0 });
}

/**
 * O publicar de verdade (botão da etapa e cartão do diretor). Gravyx (19/10):
 * nada gerando (publicar junto subiria a versão anterior), nenhum rascunho sem
 * salvar e a conferência no navegador sem problema grave, a não ser com
 * "publicar mesmo assim" marcado na tela (o diretor nunca marca por ninguém).
 * 20/10: só a versão salva que a tela mostrou (outra salva no meio: recusa).
 */
export async function publicarSite(ctx: ContextoDaPublicacao, ch: ChamadorDaPublicacao, s: LinhaDoSite, op: { mesmoAssim: boolean; versao?: unknown }) {
  const p = obj(s.publicacao);
  const dominio = typeof p.dominio === "string" ? p.dominio : null;
  const faltas = faltasDoSite(await chaves(ctx), await ctx.temBuild(s), dominio);
  if (faltas.length) throw ctx.erro(409, "publicacao_desligada", `Ainda falta: ${faltas.join("; ")}. Enquanto isso, baixe o site em zip.`, { faltas });
  const trabalhos = await ctx.trabalhos(s);
  const trava = travaDaPublicacao(trabalhos, { mesmoAssim: op.mesmoAssim });
  if (!trava.ok) throw ctx.erro(409, trava.codigo || "publicacao_travada", trava.motivo || "Publicar está travado agora.", { graves: trava.graves });
  if (trabalhos.some((t) => t.tipo === "publicar" && (t.estado === "na_fila" || t.estado === "executando" || t.estado === "parando"))) throw ctx.erro(409, "publicacao_na_fila", "Já há uma publicação deste site na fila do motor.");
  const salva = versoesSalvas(trabalhos)[0] || null;
  const v = conferirVersaoPedida(op.versao, salva ? salva.commit : null);
  if (!v.ok) throw ctx.erro(409, v.codigo || "versao_mudou", v.motivo || "A versão mudou.");
  const versao = typeof op.versao === "string" && op.versao ? op.versao : salva ? salva.commit : null;
  const { pacote, arquivos } = await ctx.pacoteDoSite(s);
  const trabalho = await ctx.criarTrabalho(ch, s, { tipo: "publicar", instrucao: `Publicar em ${dominio}` }, { ...pacote, arquivos, dominio, registrador: p.registrador || null, versao });
  await ctx.auditar(ch, "site_publicar", { client_id: s.client_id, site_id: s.id, dominio, versao, mesmo_assim: op.mesmoAssim, graves: trava.graves }, trabalho.id);
  return trabalho;
}

async function publicar(ctx: ContextoDaPublicacao, ch: ChamadorDaPublicacao, c: Record<string, unknown>) {
  const s = await ctx.lerSite(ch, c.site_id);
  if (c.confirmar !== true) throw ctx.erro(400, "confirmar_publicacao", "Publicar pede Confirmar na tela.");
  const trabalho = await publicarSite(ctx, ch, s, { mesmoAssim: c.mesmo_assim === true, versao: c.versao });
  return ctx.json({ trabalho, custo_usd: 0 });
}

async function tirarDoArRota(ctx: ContextoDaPublicacao, ch: ChamadorDaPublicacao, c: Record<string, unknown>) {
  const s = await ctx.lerSite(ch, c.site_id);
  if (c.confirmar !== true) throw ctx.erro(400, "confirmar_tirar_do_ar", "Tirar do ar pede Confirmar na tela.");
  const p = obj(s.publicacao);
  const publicado = lerPublicado(p);
  if (!publicado || !publicado.no_ar) throw ctx.erro(409, "nada_no_ar", "Este site não está no ar.");
  if (!publicado.deploy_id) throw ctx.erro(409, "sem_deploy", "A publicação antiga não guardou o deploy: publique de novo e depois tire do ar.");
  const trabalhos = await ctx.trabalhos(s);
  if (trabalhos.some((t) => t.tipo === "publicar" && (t.estado === "na_fila" || t.estado === "executando" || t.estado === "parando"))) throw ctx.erro(409, "publicacao_na_fila", "Há uma publicação na fila: espere terminar (ou pare) antes de tirar do ar.");
  const api = await apiDoServidor(ctx);
  let removidos: string[];
  try {
    removidos = await tirarDoAr(api, publicado.deploy_id);
  } catch (e) {
    throw erroDaVercel(ctx, e, "O site não saiu do ar");
  }
  const agora = new Date().toISOString();
  const site = await ctx.atualizarSite(s.id, { publicacao: { ...p, no_ar: false, tirado_em: agora, tirados: removidos } });
  await ctx.auditar(ch, "site_tirar_do_ar", { client_id: s.client_id, site_id: s.id, deploy_id: publicado.deploy_id, enderecos: removidos }, s.id);
  return ctx.json({ site, removidos, custo_usd: 0 });
}

/** Liga (se preciso) e lê o estado do domínio na Vercel: verificado, TXT pedido e DNS do cliente. */
async function dominioNaVercel(ctx: ContextoDaPublicacao, ch: ChamadorDaPublicacao, c: Record<string, unknown>, verificar: boolean) {
  const s = await ctx.lerSite(ch, c.site_id);
  const p = obj(s.publicacao);
  const dominio = typeof p.dominio === "string" ? p.dominio : null;
  if (!dominio) throw ctx.erro(409, "sem_dominio", "Escreva o domínio do cliente antes.");
  const api = await apiDoServidor(ctx);
  try {
    let projetoId = typeof p.projeto_vercel === "string" && p.projeto_vercel ? p.projeto_vercel : null;
    if (!projetoId) projetoId = (await garantirProjeto(api, nomeNaVercel(s.projeto), { semProtecao: true })).id;
    let d: { verificado: boolean; verification: ConfigDaVercel["verification"] } | null = null;
    if (p.dominio_ligado !== dominio) d = await ligarDominio(api, projetoId, dominio, wwwDe(dominio));
    if (verificar || !d) {
      try {
        d = await verificarDominio(api, projetoId, dominio);
      } catch (e) {
        // A Vercel responde erro quando o TXT ainda não está lá: lê como está.
        if (!(e instanceof ErroDaVercel) || e.status >= 500) throw e;
        d = (await dominioNoProjeto(api, projetoId, dominio)) || d;
      }
    }
    const config: ConfigDaVercel = { ...(await configDoDominio(api, dominio, projetoId)), verification: d ? d.verification : null, verified: !!d && d.verificado };
    const verificado = !!d && d.verificado && config.misconfigured === false;
    const agora = new Date().toISOString();
    const site = await ctx.atualizarSite(s.id, { publicacao: { ...p, projeto_vercel: projetoId, dominio_ligado: dominio, config, verificado_em: verificado ? agora : p.verificado_em || null } });
    const registrador = ehRegistrador(p.registrador) ? p.registrador : "registro_br";
    return ctx.json({ site, verificado, estado: estadoDoDominio(config, true, false), cartao: cartaoDeDns(registrador, dominio, config), custo_usd: 0 });
  } catch (e) {
    throw erroDaVercel(ctx, e, verificar ? "A verificação falhou" : "O domínio não foi ligado");
  }
}

export function rotasDaPublicacao(ctx: ContextoDaPublicacao): Record<string, (ch: ChamadorDaPublicacao, c: Record<string, unknown>) => Promise<Response>> {
  return {
    publicacao_estado: (ch, c) => publicacaoEstado(ctx, ch, c),
    previa_nuvem_pedir: (ch, c) => previaNuvemPedir(ctx, ch, c),
    publicar: (ch, c) => publicar(ctx, ch, c),
    publicacao_tirar_do_ar: (ch, c) => tirarDoArRota(ctx, ch, c),
    dominio_ligar: (ch, c) => dominioNaVercel(ctx, ch, c, false),
    dominio_verificar: (ch, c) => dominioNaVercel(ctx, ch, c, true),
  };
}
