/**
 * Pixel e eventos da Mesa Site (25/10/2026): o que a tela de "Pixel e
 * eventos" pede ao servidor. Sem IA e sem custo; o token da Meta fica no
 * servidor (cofre, pela mesma porta estreita da Mesa Ads) e nunca volta na
 * resposta.
 *
 * medicao_estado { site_id } -> { pixel, pixels, sugerido, tem_conta, tem_token, capi, eventos, medicao, passos }:
 *   os pixels das contas de anúncio do cliente (GET /act_{id}/adspixels), o
 *   sugerido (nome da marca, senão o que disparou por último), os eventos do
 *   objetivo e se a Conversions API pode ligar (token que alcança o pixel).
 * medicao_testar_servidor { site_id, codigo_de_teste } -> { ok, recebidos, mensagem }:
 *   manda UM evento de teste pela Conversions API com o código do Testar
 *   eventos (só aparece na aba de teste; não conta na campanha).
 *
 * Só equipe (a função mesa-site já confere). Sem travessão.
 */
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { registrarFalha } from "../_shared/falha-registrada.ts";
import { normalizarIntegracoes } from "../_shared/site-lancamento.ts";
import type { LinhaDoSite } from "../_shared/pacote-do-site.ts";
import type { ChamadorDaEstrutura, ContextoDaEstrutura } from "./estrutura.ts";
import {
  corpoDaCapi,
  enviarParaCapi,
  eventoParaCapi,
  eventosDoObjetivo,
  normalizarCodigoDeTeste,
  normalizarLoja,
  normalizarMedicao,
  type PixelDaConta,
  pixelSugerido,
  pixelsDaResposta,
  semToken,
  passosDoTeste,
  VERSAO_DA_GRAPH,
} from "./modulos/medicao-do-site.ts";

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const jornadaDe = (s: LinhaDoSite) => obj(obj(s.direcao).jornada);

/** Token de anúncios do cliente (conta própria primeiro, depois o da carteira). Só a chave de serviço chama. */
export async function tokenDaMeta(db: SupabaseClient, clientId: string): Promise<string | null> {
  const { data, error } = await db.rpc("ads_token_para_biblioteca", { _client_id: clientId });
  if (error) {
    if (error.code !== "PGRST202" && error.code !== "42883") registrarFalha("mesa-site: token da Meta não lido", error, { client_id: clientId });
    return null;
  }
  return typeof data === "string" && data.trim() ? data.trim() : null;
}

/** As contas de anúncio da Meta ligadas ao cliente (sem o act_). */
async function contasDaMeta(db: SupabaseClient, clientId: string): Promise<string[]> {
  const { data, error } = await db.from("external_accounts").select("external_id").eq("client_id", clientId).eq("platform", "meta_ads");
  if (error) {
    registrarFalha("mesa-site: contas da Meta não lidas", error, { client_id: clientId });
    return [];
  }
  return ((data as Array<{ external_id: string | null }> | null) ?? []).map((c) => String(c.external_id || "").replace(/^act_/, "")).filter((x) => /^\d{5,25}$/.test(x)).slice(0, 3);
}

async function lerGrafo(caminho: string, campos: string, token: string, buscar: typeof fetch = fetch): Promise<{ ok: boolean; corpo: Record<string, unknown> }> {
  const u = new URL(`https://graph.facebook.com/${VERSAO_DA_GRAPH}/${caminho}`);
  u.searchParams.set("fields", campos);
  u.searchParams.set("limit", "50");
  u.searchParams.set("access_token", token);
  try {
    const r = await buscar(u, { signal: AbortSignal.timeout(10_000) });
    const corpo = obj(await r.json().catch(() => ({})));
    return { ok: r.ok && !corpo.error, corpo };
  } catch (e) {
    registrarFalha("mesa-site: leitura na Meta falhou", new Error(semToken(e instanceof Error ? e.message : e)));
    return { ok: false, corpo: {} };
  }
}

const sha256 = async (s: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))).map((b) => b.toString(16).padStart(2, "0")).join("");
export { sha256 as sha256DoServidor };

async function medicaoEstado(ctx: ContextoDaEstrutura, ch: ChamadorDaEstrutura, c: Record<string, unknown>) {
  const s = await ctx.lerSite(ch, c.site_id);
  const db = ctx.servico();
  const j = jornadaDe(s);
  const objetivo = typeof j.objetivo === "string" ? j.objetivo : null;
  const loja = objetivo === "loja_virtual" ? normalizarLoja(j.loja) : null;
  const medicao = normalizarMedicao(j.medicao);
  const pixel = normalizarIntegracoes(s.integracoes || {}).pixel_meta.id;
  const eventos = eventosDoObjetivo(objetivo, loja);
  const [contas, token] = await Promise.all([contasDaMeta(db, s.client_id), tokenDaMeta(db, s.client_id)]);
  const pixels: PixelDaConta[] = [];
  let motivo: string | null = null;
  if (!contas.length) motivo = "O cliente não tem conta de anúncios da Meta ligada no painel.";
  else if (!token) motivo = "Não há token da Meta no cofre que alcance a conta do cliente.";
  else {
    for (const conta of contas) {
      const r = await lerGrafo(`act_${conta}/adspixels`, "id,name,last_fired_time,is_unavailable", token);
      if (r.ok) pixels.push(...pixelsDaResposta(r.corpo, conta));
      else motivo = motivo || `A Meta não liberou os pixels da conta ${conta}: ${semToken(obj(r.corpo.error).message || "sem resposta")}`;
    }
  }
  // A Conversions API liga só com token que alcança o pixel escolhido (lido na conta ou pelo próprio id).
  let capi = { possivel: false, motivo: "" };
  if (!pixel) capi.motivo = "Escolha o pixel primeiro.";
  else if (!token) capi.motivo = "Sem token da Meta no cofre: o pixel funciona só no navegador.";
  else if (pixels.some((p) => p.id === pixel)) capi = { possivel: true, motivo: "" };
  else {
    const r = await lerGrafo(pixel, "id,name", token);
    capi = r.ok ? { possivel: true, motivo: "" } : { possivel: false, motivo: "O token da agência não alcança este pixel: compartilhe o pixel com a BM da Aceleriq para ligar o servidor." };
  }
  const marca = pixels.length > 1 ? await ctx.marcaDoSite(s).catch(() => null) : null;
  const sugerido = pixelSugerido(pixels, marca ? marca.nome : s.nome || "");
  const publicacao = obj(s.publicacao);
  const url = typeof publicacao.dominio === "string" && publicacao.dominio ? `https://${publicacao.dominio}` : typeof publicacao.deploy_url === "string" ? publicacao.deploy_url : null;
  return ctx.json({
    pixel,
    pixels,
    sugerido: sugerido ? sugerido.id : null,
    tem_conta: contas.length > 0,
    tem_token: !!token,
    motivo,
    capi,
    eventos,
    medicao: { ...medicao, capi: medicao.capi && capi.possivel },
    passos: pixel ? passosDoTeste({ pixel, url, eventos, capi: medicao.capi && capi.possivel }) : [],
    url,
    custo_usd: 0,
  });
}

async function medicaoTestarServidor(ctx: ContextoDaEstrutura, ch: ChamadorDaEstrutura, c: Record<string, unknown>) {
  const s = await ctx.lerSite(ch, c.site_id);
  const codigo = normalizarCodigoDeTeste(c.codigo_de_teste);
  if (!codigo) throw ctx.erro(400, "codigo_invalido", "Cole o código da aba Testar eventos (ex.: TEST12345).");
  const pixel = normalizarIntegracoes(s.integracoes || {}).pixel_meta.id;
  if (!pixel) throw ctx.erro(409, "sem_pixel", "Escolha o pixel antes de testar.");
  const token = await tokenDaMeta(ctx.servico(), s.client_id);
  if (!token) throw ctx.erro(409, "sem_token", "Sem token da Meta no cofre para este cliente: o teste do servidor não tem como sair.");
  const publicacao = obj(s.publicacao);
  const url = typeof publicacao.dominio === "string" && publicacao.dominio ? `https://${publicacao.dominio}/` : "https://aceleriq.com/teste-de-eventos";
  const agora = Date.now();
  // Evento só de teste: sem dado de pessoa (fbp sintético), com o código do Testar eventos.
  const ev = await eventoParaCapi({ evento: "PageView", event_id: `teste-${agora.toString(36)}`, url, ip: null, user_agent: "Aceleriq Mesa Site (teste de eventos)", fbp: `fb.1.${agora}.${Math.floor(Math.random() * 1e9)}` }, sha256);
  const r = await enviarParaCapi(pixel, token, corpoDaCapi(ev ? [ev] : [], codigo), (u, i) => fetch(u, { ...i, signal: AbortSignal.timeout(8_000) }));
  // Guarda o código (a tela mostra de novo; não é segredo).
  await ctx.atualizarSite(s.id, { direcao: { ...obj(s.direcao), jornada: { ...jornadaDe(s), medicao: { ...normalizarMedicao(jornadaDe(s).medicao), codigo_de_teste: codigo } } } }).catch((e) => registrarFalha("mesa-site: código de teste não guardado", e, { site_id: s.id }));
  if (!r.ok) return ctx.json({ ok: false, recebidos: 0, mensagem: `A Meta recusou: ${r.mensagem || "sem resposta"}`, custo_usd: 0 });
  return ctx.json({ ok: true, recebidos: r.recebidos, mensagem: `A Meta recebeu ${r.recebidos} evento de teste. Confira na aba Testar eventos (aparece como Servidor).`, custo_usd: 0 });
}

export function rotasDaMedicao(ctx: ContextoDaEstrutura): Record<string, (ch: ChamadorDaEstrutura, c: Record<string, unknown>) => Promise<Response>> {
  return {
    medicao_estado: (ch, c) => medicaoEstado(ctx, ch, c),
    medicao_testar_servidor: (ch, c) => medicaoTestarServidor(ctx, ch, c),
  };
}

export const ACOES_LONGAS_DA_MEDICAO = ["medicao_estado", "medicao_testar_servidor"];
