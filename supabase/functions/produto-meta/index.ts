/**
 * Webhook da Meta de cada empresa do CRM (14/11/2026, rodada 3). verify_jwt = false: quem chama é a Meta.
 *
 *   GET  /produto-meta/<webhook_chave>   a conferência que a Meta faz ao salvar o webhook (hub.challenge)
 *   POST /produto-meta/<webhook_chave>   avisos de lead do formulário (Lead Ads) e mensagens do WhatsApp
 *   POST /produto-meta/simular           lead de teste pela tela (JWT de quem é gestor da empresa)
 *
 * Cada empresa conecta a Meta DELA (app, token e segredo colados na tela, guardados no Vault). A empresa
 * vem só da chave do endereço (crm_integracao_por_chave, com a chave de serviço); nada do corpo escolhe
 * empresa. O corpo só vale com o X-Hub-Signature-256 do segredo do app daquela empresa.
 *
 * Nasce desligado e em modo teste:
 *   ativo = false    responde 200 e não faz nada;
 *   modo = 'teste'   registra o aviso, mas nunca chama a Graph API (nem a API de Conversões, nem o WhatsApp).
 *
 * Caminho do lead: confere Página e formulário, registra uma vez (crm_meta_lead_registrar; a Meta repete o
 * aviso), busca as respostas na Graph API, normaliza e pontua (_shared/meta-leads-do-crm.ts e
 * _shared/pontuacao-do-crm.ts), cria o negócio (crm_meta_lead_criar: rodízio, fila ou nutrição) e entrega
 * ao módulo do WhatsApp. Falha passageira (Meta fora do ar, banco) responde 503 para a Meta reenviar; o
 * reenvio de um aviso que deu erro é a nova tentativa.
 *
 * Token e segredo nunca vão para registro, erro, resposta nem endereço (o token vai no cabeçalho).
 */
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { PREFLIGHT_CACHE } from "../_shared/cors.ts";
import { semSegredo, VERSAO_DA_GRAPH } from "../_shared/conversoes-da-meta.ts";
import {
  assinaturaConfere,
  CAMPOS_BASICOS_DO_LEAD,
  CAMPOS_DO_LEAD,
  conferirDesafio,
  conferirOrigem,
  dadosDoNegocio,
  decidirRegistro,
  enderecoDoLead,
  leadDeTeste,
  lerErroDaGraph,
  lerFieldData,
  lerWebhook,
  normalizarLead,
  origemDoLead,
  type AvisoDeLead,
} from "../_shared/meta-leads-do-crm.ts";
import { lerRegras, pontuar } from "../_shared/pontuacao-do-crm.ts";
import { lerIntegracao, type Contexto, type Integracao, type LeadCriado } from "./modulos/tipos.ts";
import { aoCriarLead, tratarWhatsapp } from "./modulos/whatsapp.ts";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  ...PREFLIGHT_CACHE,
};

const json = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status, headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" } });

const CHAVE = /^[0-9a-f]{32}$/;
const TETO_DO_CORPO = 512_000;
const PRAZO_DO_LEAD_MS = 8_000;
const PRAZO_DO_FORMULARIO_MS = 4_000;

/** O que a função usa de fora. Em produção vem de `dependenciasReais`; o ensaio troca por banco e rede falsos. */
export interface Dependencias {
  servico: SupabaseClient;
  /** Cliente que fala com o banco como a pessoa do JWT (para conferir que é gestor da empresa). */
  comoPessoa: (jwt: string) => SupabaseClient;
  buscar: typeof fetch;
  agora: () => Date;
  versaoDaGraph: string;
  whats: {
    aoCriarLead: (ctx: Contexto, lead: LeadCriado) => Promise<void>;
    tratarWhatsapp: (ctx: Contexto, entradas: unknown[]) => Promise<void>;
  };
  /** Trabalho que pode terminar depois da resposta à Meta. Devolve uma promessa só quando é preciso esperar. */
  depois: (trabalho: Promise<unknown>) => Promise<void> | void;
}

type Estado = "criado" | "repetido" | "ignorado" | "erro" | "de_novo";

async function integracaoPorChave(db: SupabaseClient, chave: string): Promise<Integracao | null> {
  const { data, error } = await db.rpc("crm_integracao_por_chave", { _chave: chave });
  if (error) throw new Error("leitura da integracao");
  return lerIntegracao(data);
}

/** Marca o registro como erro ou ignorado, com frase curta e sem token. Nunca lança. */
async function falhou(db: SupabaseClient, registro: string, erro: string, situacao: "erro" | "ignorado", token: string | null = null): Promise<void> {
  const { error } = await db.rpc("crm_meta_lead_falhou", { _registro: registro, _erro: semSegredo(erro, token || ""), _situacao: situacao });
  if (error) console.error("[produto-meta] falha nao anotada", registro);
}

/** O último erro que o gestor vê na tela. Só mexe no que este caminho escreveu ("Lead da Meta: ..."). */
async function anotarErroDaConexao(db: SupabaseClient, contaId: string, erro: string | null): Promise<void> {
  try {
    if (erro) await db.from("crm_integracoes").update({ ultimo_erro: `Lead da Meta: ${erro}`.slice(0, 300) }).eq("conta_id", contaId);
    else await db.from("crm_integracoes").update({ ultimo_erro: null }).eq("conta_id", contaId).like("ultimo_erro", "Lead da Meta:%");
  } catch {
    /* o aviso na tela é um extra: o lead não depende dele */
  }
}

type LeituraDoLead = { ok: true; lead: Record<string, unknown> } | { ok: false; definitivo: boolean; erro: string };

/** Uma leitura na Graph API, com prazo. Nunca lança: rede caída e prazo estourado viram "tentar de novo". */
async function chamarAGraph(d: Dependencias, endereco: string, token: string, prazoMs: number): Promise<{ status: number; corpo: unknown } | null> {
  const controle = new AbortController();
  const prazo = setTimeout(() => controle.abort(), prazoMs);
  try {
    const resposta = await d.buscar(endereco, { method: "GET", headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }, signal: controle.signal });
    let corpo: unknown = null;
    try {
      corpo = await resposta.json();
    } catch {
      /* resposta sem JSON: o status decide */
    }
    return { status: resposta.status, corpo };
  } catch {
    return null;
  } finally {
    clearTimeout(prazo);
  }
}

async function buscarLead(d: Dependencias, leadgenId: string, token: string): Promise<LeituraDoLead> {
  for (const campos of [CAMPOS_DO_LEAD, CAMPOS_BASICOS_DO_LEAD]) {
    const r = await chamarAGraph(d, enderecoDoLead(leadgenId, d.versaoDaGraph, campos), token, PRAZO_DO_LEAD_MS);
    if (!r) return { ok: false, definitivo: false, erro: "A Meta não respondeu agora." };
    const corpo = r.corpo && typeof r.corpo === "object" ? (r.corpo as Record<string, unknown>) : {};
    if (r.status >= 200 && r.status < 300 && !corpo.error) return { ok: true, lead: corpo };
    const erro = lerErroDaGraph(r.status, r.corpo, token);
    // A Meta recusou um campo do pedido completo: vale repetir só com os básicos.
    if (erro.campoRecusado && campos !== CAMPOS_BASICOS_DO_LEAD) continue;
    return { ok: false, definitivo: erro.definitivo, erro: erro.erro };
  }
  return { ok: false, definitivo: true, erro: "A Meta recusou a leitura do lead." };
}

/** O nome do formulário, para o vendedor ler de onde veio. Extra: sem ele o lead entra do mesmo jeito. */
const nomesDosFormularios = new Map<string, string>();
async function nomeDoFormulario(d: Dependencias, formId: string | null | undefined, token: string): Promise<string> {
  if (!formId || !/^[0-9]{5,25}$/.test(formId)) return "";
  const guardado = nomesDosFormularios.get(formId);
  if (guardado !== undefined) return guardado;
  const r = await chamarAGraph(d, `https://graph.facebook.com/${d.versaoDaGraph}/${formId}?fields=name`, token, PRAZO_DO_FORMULARIO_MS);
  if (!r) return "";
  const corpo = r.corpo && typeof r.corpo === "object" ? (r.corpo as Record<string, unknown>) : {};
  const nome = r.status >= 200 && r.status < 300 && typeof corpo.name === "string" ? corpo.name.trim().slice(0, 150) : "";
  if (nomesDosFormularios.size > 500) nomesDosFormularios.clear();
  nomesDosFormularios.set(formId, nome);
  return nome;
}

interface Criacao {
  estado: Estado;
  resultado?: { lead_id: string; nome: string; nota: number; faixa: "quente" | "morno" | "frio"; repetido: boolean; na_fila: boolean; nutricao: boolean; vendedor: LeadCriado["vendedor"] };
}

/** Do lead lido (ou simulado) ao negócio criado: normaliza, pontua, cria e entrega ao módulo do WhatsApp. */
async function criarNegocio(d: Dependencias, ctx: Contexto, registro: string, lead: Record<string, unknown>, aviso: AvisoDeLead, formulario: string): Promise<Criacao> {
  const { servico: db, integracao } = ctx;
  if (!lerFieldData(lead.field_data).length) {
    await falhou(db, registro, "A Meta devolveu o lead sem respostas.", "erro", integracao.token);
    return { estado: "erro" };
  }
  const normal = normalizarLead(lead.field_data, { nicho: integracao.nicho });
  const nota = pontuar(normal.respostas, lerRegras(integracao.pontuacao, integracao.nicho));
  const origem = origemDoLead(lead, aviso, formulario);

  const { data, error } = await db.rpc("crm_meta_lead_criar", { _registro: registro, _dados: dadosDoNegocio(normal, nota, origem) });
  if (error || !data || typeof (data as { lead_id?: unknown }).lead_id !== "string") {
    console.error("[produto-meta] negocio nao criado", registro, error ? String(error.message || "").slice(0, 120) : "");
    await falhou(db, registro, "Não foi possível criar o negócio agora.", "erro", integracao.token);
    return { estado: "de_novo" };
  }
  const r = data as { lead_id: string; repetido?: boolean; faixa?: string; nota?: number; na_fila?: boolean; nutricao?: boolean; vendedor?: { user_id?: string; nome?: string; whatsapp?: string | null } | null };
  const faixa = r.faixa === "quente" || r.faixa === "morno" || r.faixa === "frio" ? r.faixa : nota.faixa;
  const vendedor = r.vendedor && typeof r.vendedor.user_id === "string" ? { user_id: r.vendedor.user_id, nome: String(r.vendedor.nome || ""), whatsapp: r.vendedor.whatsapp || null } : null;
  const criado: LeadCriado = {
    lead_id: r.lead_id,
    nome: normal.nome || "Lead da Meta",
    whatsapp: normal.whatsapp,
    faixa,
    nota: typeof r.nota === "number" ? r.nota : nota.nota,
    motivos: nota.motivos,
    respostas: normal.respostas,
    repetido: !!r.repetido,
    na_fila: !!r.na_fila,
    nutricao: !!r.nutricao,
    vendedor,
    origem: { ...(origem.campaign_name ? { campanha: origem.campaign_name } : {}), ...(origem.form_name ? { formulario: origem.form_name } : {}) },
  };
  // As mensagens (boas-vindas ao lead, aviso ao vendedor) não seguram a resposta à Meta e não desfazem o negócio.
  await d.depois(
    d.whats.aoCriarLead(ctx, criado).catch((e) => {
      console.error("[produto-meta] whatsapp do lead", criado.lead_id, semSegredo(e instanceof Error ? e.message : "", integracao.wa_token || "").slice(0, 120));
    }),
  );
  return { estado: criado.repetido ? "repetido" : "criado", resultado: { lead_id: criado.lead_id, nome: criado.nome, nota: criado.nota, faixa, repetido: criado.repetido, na_fila: criado.na_fila, nutricao: criado.nutricao, vendedor } };
}

/** Um aviso de lead do webhook. Nunca lança. */
async function tratarAviso(d: Dependencias, ctx: Contexto, aviso: AvisoDeLead): Promise<Estado> {
  const { servico: db, integracao } = ctx;
  try {
    const { data, error } = await db.rpc("crm_meta_lead_registrar", {
      _conta: integracao.conta_id,
      _leadgen_id: aviso.leadgen_id,
      _meta: { page_id: aviso.page_id, form_id: aviso.form_id, ad_id: aviso.ad_id, adgroup_id: aviso.adgroup_id },
      _de_teste: false,
    });
    const registro = (data || {}) as { novo?: boolean; id?: string };
    if (error || typeof registro.id !== "string") return "de_novo";

    let anterior: { situacao?: string | null; lead_id?: string | null; criado_em?: string | null } = {};
    if (!registro.novo) {
      const lido = await db.from("crm_meta_leads").select("situacao, lead_id, criado_em").eq("id", registro.id).maybeSingle();
      anterior = (lido.data || {}) as typeof anterior;
    }
    if (decidirRegistro({ novo: !!registro.novo, ...anterior }, ctx.agora.getTime()) === "repetido") return "repetido";

    const origem = conferirOrigem(aviso, integracao);
    if (origem !== "ok") {
      await falhou(db, registro.id, origem === "outra_pagina" ? "O lead veio de outra Página, não da que está conectada." : "O lead veio de um formulário que não está na lista da empresa.", "ignorado");
      return "ignorado";
    }
    if (integracao.modo !== "real") {
      await falhou(db, registro.id, "Modo teste: o aviso chegou, mas o lead não foi buscado na Meta. Ligue o modo real para criar o negócio.", "ignorado");
      return "ignorado";
    }
    if (!integracao.token) {
      await falhou(db, registro.id, "Falta o token da Página para buscar o lead na Meta.", "erro");
      await anotarErroDaConexao(db, integracao.conta_id, "falta o token da Página.");
      return "erro";
    }

    const leitura = await buscarLead(d, aviso.leadgen_id, integracao.token);
    if (!leitura.ok) {
      await falhou(db, registro.id, leitura.erro, "erro", integracao.token);
      await anotarErroDaConexao(db, integracao.conta_id, semSegredo(leitura.erro, integracao.token));
      return leitura.definitivo ? "erro" : "de_novo";
    }
    const formId = typeof leitura.lead.form_id === "string" ? leitura.lead.form_id : aviso.form_id;
    const criacao = await criarNegocio(d, ctx, registro.id, leitura.lead, aviso, await nomeDoFormulario(d, formId, integracao.token));
    if (criacao.estado === "criado" || criacao.estado === "repetido") await anotarErroDaConexao(db, integracao.conta_id, null);
    return criacao.estado;
  } catch (e) {
    console.error("[produto-meta] aviso", aviso.leadgen_id, semSegredo(e instanceof Error ? e.message : "", integracao.token || "").slice(0, 120));
    return "de_novo";
  }
}

async function conferir(req: Request, chave: string, d: Dependencias): Promise<Response> {
  const integracao = CHAVE.test(chave) ? await integracaoPorChave(d.servico, chave) : null;
  if (!integracao) return json({ error: "inexistente" }, 404);
  const r = conferirDesafio(new URL(req.url).searchParams, integracao.verify_token);
  if (!r.ok) return json({ error: "verificacao" }, 403);
  return new Response(r.desafio, { status: 200, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
}

async function receber(req: Request, chave: string, d: Dependencias): Promise<Response> {
  if (!CHAVE.test(chave)) return json({ error: "inexistente" }, 404);
  if (Number(req.headers.get("content-length") || 0) > TETO_DO_CORPO) return json({ error: "corpo_grande" }, 413);
  // O corpo cru, byte a byte: é sobre ele que a Meta assina.
  const cru = new Uint8Array(await req.arrayBuffer());
  if (cru.length > TETO_DO_CORPO) return json({ error: "corpo_grande" }, 413);

  const integracao = await integracaoPorChave(d.servico, chave);
  if (!integracao) return json({ error: "inexistente" }, 404);
  // Desligado (ou empresa sem acesso): 200 para a Meta não insistir, e nada acontece.
  if (!integracao.ativo || !integracao.liberada) return json({ ok: true, desligado: true });
  if (!(await assinaturaConfere(cru, req.headers.get("x-hub-signature-256"), integracao.app_secret))) return json({ error: "assinatura" }, 401);

  let corpo: unknown;
  try {
    corpo = JSON.parse(new TextDecoder().decode(cru));
  } catch {
    return json({ error: "json_invalido" }, 400);
  }
  const lido = lerWebhook(corpo);
  const ctx: Contexto = { servico: d.servico, integracao, agora: d.agora() };

  const estados = await Promise.all(lido.leads.map((aviso) => tratarAviso(d, ctx, aviso)));
  if (lido.whatsapp.length) {
    await d.depois(
      d.whats.tratarWhatsapp(ctx, lido.whatsapp).catch((e) => {
        console.error("[produto-meta] whatsapp", semSegredo(e instanceof Error ? e.message : "", integracao.wa_token || "").slice(0, 120));
      }),
    );
  }
  const contar = (e: Estado) => estados.filter((x) => x === e).length;
  const resumo = { leads: estados.length, criados: contar("criado"), repetidos: contar("repetido"), ignorados: contar("ignorado"), erros: contar("erro"), whatsapp: lido.whatsapp.length };
  // Falha passageira: 503 para a Meta reenviar. O que já virou negócio não repete (um registro por leadgen_id).
  return contar("de_novo") > 0 ? json({ ok: false, ...resumo, de_novo: contar("de_novo") }, 503) : json({ ok: true, ...resumo });
}

/** 10 simulações por minuto por empresa, contadas na memória desta instância. */
const simulacoes = new Map<string, { inicio: number; quantas: number }>();
function podeSimular(contaId: string, agora: number): boolean {
  const j = simulacoes.get(contaId);
  if (!j || agora - j.inicio >= 60_000) {
    if (simulacoes.size > 2000) simulacoes.clear();
    simulacoes.set(contaId, { inicio: agora, quantas: 1 });
    return true;
  }
  j.quantas += 1;
  return j.quantas <= 10;
}

/** O botão "Simular lead": o caminho inteiro com um lead falso, sem Graph API e sem nada sair para fora. */
async function simular(req: Request, d: Dependencias): Promise<Response> {
  if (req.method !== "POST") return json({ error: "metodo", mensagem: "Use POST." }, 405);
  const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!jwt) return json({ error: "sem_sessao", mensagem: "Sua sessão expirou. Entre de novo para simular." }, 401);

  // Quem pode: só gestor da empresa. A conferência é a do banco, chamada como a própria pessoa.
  const { data: lida, error } = await d.comoPessoa(jwt).rpc("crm_integracao_ler");
  if (error) {
    const codigo = String((error as { code?: string }).code || "");
    if (codigo === "42501") return json({ error: "sem_permissao", mensagem: "Só o gerente ou quem administra a empresa simula um lead." }, 403);
    if (codigo.indexOf("PGRST3") === 0) return json({ error: "sem_sessao", mensagem: "Sua sessão expirou. Entre de novo para simular." }, 401);
    return json({ error: "indisponivel", mensagem: "Não foi possível simular agora. Tente de novo em instantes." }, 503);
  }
  const tela = (lida || {}) as { existe?: boolean; webhook_chave?: string | null };
  if (!tela.existe || !tela.webhook_chave || !CHAVE.test(tela.webhook_chave)) {
    return json({ error: "sem_conexao", mensagem: "Salve a conexão uma vez antes de simular um lead." }, 409);
  }
  const integracao = await integracaoPorChave(d.servico, tela.webhook_chave);
  if (!integracao) return json({ error: "sem_conexao", mensagem: "Salve a conexão uma vez antes de simular um lead." }, 409);
  if (!integracao.liberada) return json({ error: "conta_bloqueada", mensagem: "O acesso da empresa ao CRM não está liberado. Veja a assinatura." }, 402);
  const agora = d.agora();
  if (!podeSimular(integracao.conta_id, agora.getTime())) return json({ error: "muitas_chamadas", mensagem: "Muitas simulações em pouco tempo. Espere um minuto." }, 429);

  let pedido: Record<string, unknown> = {};
  try {
    const bruto = await req.text();
    if (bruto.length > 2000) return json({ error: "corpo_grande", mensagem: "O pedido é grande demais." }, 413);
    const v = bruto.trim() ? JSON.parse(bruto) : {};
    if (v && typeof v === "object" && !Array.isArray(v)) pedido = v as Record<string, unknown>;
  } catch {
    return json({ error: "json_invalido", mensagem: "O pedido precisa ser um objeto JSON." }, 400);
  }
  const faixa = pedido.faixa === "quente" || pedido.faixa === "morno" || pedido.faixa === "frio" ? pedido.faixa : null;
  const teste = leadDeTeste({ faixa, bem: typeof pedido.bem === "string" ? pedido.bem.slice(0, 30) : null, nicho: integracao.nicho, agora: agora.getTime() });

  const { data: reg, error: falha } = await d.servico.rpc("crm_meta_lead_registrar", { _conta: integracao.conta_id, _leadgen_id: teste.aviso.leadgen_id, _meta: {}, _de_teste: true });
  const registro = (reg || {}) as { novo?: boolean; id?: string };
  if (falha || typeof registro.id !== "string") return json({ error: "indisponivel", mensagem: "Não foi possível simular agora. Tente de novo em instantes." }, 503);

  // Lead simulado nunca sai para fora: o módulo do WhatsApp recebe a conexão em modo teste, qualquer que seja o modo salvo.
  const ctx: Contexto = { servico: d.servico, integracao: { ...integracao, modo: "teste" }, agora };
  const criacao = await criarNegocio(d, ctx, registro.id, teste.lead as unknown as Record<string, unknown>, teste.aviso, teste.nomeDoFormulario);
  if (!criacao.resultado) return json({ error: "indisponivel", mensagem: "Não foi possível criar o lead de teste agora. Tente de novo em instantes." }, 503);
  return json({ ok: true, de_teste: true, resultado: criacao.resultado }, 201);
}

/** Atende um pedido. Exportada para o ensaio (produto-meta/ensaio_test.ts) rodar o caminho inteiro sem rede. */
export async function atender(req: Request, d: Dependencias): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  // O caminho chega como /produto-meta/... (ou /functions/v1/produto-meta/...).
  const partes = (new URL(req.url).pathname.split("/produto-meta")[1] || "").split("/").filter(Boolean);
  try {
    if (partes[0] === "simular" && partes.length === 1) return await simular(req, d);
    if (partes.length === 1 && req.method === "GET") return await conferir(req, partes[0], d);
    if (partes.length === 1 && req.method === "POST") return await receber(req, partes[0], d);
    if (partes.length === 1) return json({ error: "metodo" }, 405);
    return json({ error: "inexistente" }, 404);
  } catch (e) {
    // Falha nossa (banco fora do ar): 503 para a Meta reenviar.
    console.error("[produto-meta] erro inesperado", e instanceof Error ? e.message.slice(0, 120) : "");
    return json({ error: "indisponivel" }, 503);
  }
}

declare const EdgeRuntime: { waitUntil?: (p: Promise<unknown>) => void } | undefined;

let servicoCache: SupabaseClient | null = null;
function dependenciasReais(): Dependencias {
  if (!servicoCache) {
    servicoCache = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });
  }
  const versao = Deno.env.get("META_GRAPH_VERSION")?.trim() || "";
  return {
    servico: servicoCache,
    comoPessoa: (jwt) =>
      createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
        global: { headers: { Authorization: `Bearer ${jwt}` } },
        auth: { persistSession: false, autoRefreshToken: false },
      }),
    buscar: fetch,
    agora: () => new Date(),
    versaoDaGraph: /^v[0-9]{1,3}\.[0-9]$/.test(versao) ? versao : VERSAO_DA_GRAPH,
    whats: { aoCriarLead, tratarWhatsapp },
    // Na borda, o trabalho segue depois da resposta. Fora dela (ensaio local), a resposta espera por ele.
    depois: (trabalho) => {
      if (typeof EdgeRuntime !== "undefined" && EdgeRuntime && typeof EdgeRuntime.waitUntil === "function") {
        EdgeRuntime.waitUntil(trabalho);
        return;
      }
      return trabalho.then(() => undefined);
    },
  };
}

if (import.meta.main) {
  Deno.serve((req) => atender(req, dependenciasReais()));
}
