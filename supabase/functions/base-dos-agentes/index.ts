/**
 * base-dos-agentes (17/10/2026): o dono ensina cada agente e a internet
 * complementa toda semana.
 *
 * Dono: "todos os que estão por trás tendo uma base de aprendizado, onde eu
 * consigo mandar documentos, atualizar, complementar com mais prompt; surgiu
 * uma técnica nova, eu quero complementar; quanto mais eu carrego, mais
 * inteligente ele fica". Decisões dele: vale para todos os clientes (com ficha
 * opcional só de um cliente), o que chega vira ficha já em uso, e a pesquisa
 * na internet também entra direto.
 *
 * Ações (equipe admin/gestor):
 * - ensinar: texto colado, documento (o texto lido no navegador) ou link. O
 *   leitor transforma em fichas de técnica para ESTE agente e grava em uso.
 * - pesquisar: a pesquisa na internet agora, para um agente.
 * - nova_ficha, editar_ficha, apagar_ficha, apagar_fonte: a mão do dono.
 * Ação do cron (x-cron-secret):
 * - pesquisa_semanal: até 2 agentes por chamada (cada leitura leva até 140 s), cada um no máximo 1 vez por
 *   semana, pago pela carteira da agência.
 *
 * Na geração, quem lê é _shared/base-do-agente.ts (baseDoAgente).
 */

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { chamarTexto, cobrarJev, IaMotorErro, lerSaldo, modeloPadrao, type ModeloIa } from "../_shared/ia-motor.ts";
import { jevPerguntar, type PerguntaJev, probabilidadeNoul } from "../_shared/jev.ts";
import { type Diaria, somarMetricas } from "../mesa-ads/calculos.ts";
import { respostaComFolego } from "../_shared/resposta-com-folego.ts";
import { PREFLIGHT_CACHE } from "../_shared/cors.ts";
import { evolucaoDoCliente } from "./evolucao.ts";
import { type AgenteComBase, agenteComBase, AGENTES_COM_BASE } from "../_shared/agentes-com-base.ts";
import { type DesfechoDaPeca, desfechoDoAds, desfechoDoEstudio, deveSair, resultadosDasFichas, type UsoParaResultado } from "../_shared/resultado-das-fichas.ts";
import { basesDoPerfil, DESTAQUE_A_PARTIR_DE, type MedidaDoMultiplo, multiploDoPost, type PostParaMultiplo } from "../_shared/multiplo-do-post.ts";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  ...PREFLIGHT_CACHE,
};

/** O material de uma fonte vai até aqui para o leitor (o resto é cortado com aviso). */
export const MAX_CHARS_DA_FONTE = 120_000;
/** Fichas por fonte (menos é melhor do que ficha fraca). */
export const MAX_FICHAS_POR_FONTE = 12;
/** Fichas novas por pesquisa. */
export const MAX_FICHAS_DA_PESQUISA = 6;
/** Agentes por chamada do cron. */
const AGENTES_POR_RODADA = 2;
/** Saldo mínimo da carteira da agência para a pesquisa semanal (US$). */
const SALDO_MINIMO_DA_RODADA = 1;

class ErroHttp extends Error {
  status: number;
  codigo: string;
  constructor(status: number, codigo: string, mensagem: string) {
    super(mensagem);
    this.status = status;
    this.codigo = codigo;
  }
}

function json(corpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(corpo), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

let servicoCache: SupabaseClient | null = null;
function servico(): SupabaseClient {
  if (!servicoCache) {
    servicoCache = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return servicoCache;
}

function ehCron(req: Request): boolean {
  const segredo = Deno.env.get("CRON_SECRET")?.trim();
  return !!segredo && req.headers.get("x-cron-secret")?.trim() === segredo;
}

type Chamador = { userId: string };

/** Quem ensina os agentes: admin e gestor (a base vale para a casa inteira). */
async function identificar(req: Request): Promise<Chamador> {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new ErroHttp(401, "sessao_expirada", "Sessão expirada. Entre de novo no painel.");
  const { data: user } = await servico().auth.getUser(token);
  const userId = user?.user?.id;
  if (!userId) throw new ErroHttp(401, "sessao_expirada", "Sessão expirada. Entre de novo no painel.");
  const { data: papeis, error } = await servico().from("user_roles").select("role").eq("user_id", userId);
  if (error) throw new ErroHttp(503, "autorizacao_indisponivel", "Não foi possível conferir a permissão agora.");
  const ok = ((papeis || []) as { role: string }[]).some((p) => p.role === "admin" || p.role === "manager");
  if (!ok) throw new ErroHttp(403, "sem_permissao", "Só o admin e o gestor ensinam os agentes.");
  return { userId };
}

/** A carteira que paga o aprendizado: a da agência (empresa interna com mais saldo). */
async function carteiraDaAgencia(): Promise<string | null> {
  const { data } = await servico().from("profiles").select("id").eq("services_config->>internal_company", "true").limit(5);
  const ids = ((data || []) as { id: string }[]).map((x) => x.id);
  if (!ids.length) return null;
  const { data: carteiras } = await servico().from("ia_carteiras").select("client_id, saldo_usd").in("client_id", ids).order("saldo_usd", { ascending: false }).limit(1);
  const c = ((carteiras || []) as { client_id: string }[])[0];
  return c ? c.client_id : ids[0];
}

async function modeloDoLeitor(): Promise<ModeloIa> {
  const m = (await modeloPadrao("contexto")) ?? (await modeloPadrao("estrategista"));
  if (!m) throw new ErroHttp(409, "sem_modelo", "Nenhum modelo de texto ligado para ler as fontes.");
  return m;
}

/** O travessão vira vírgula (regra do dono: texto sem travessão). */
const TRAVESSAO = new RegExp(" *" + String.fromCharCode(0x2014) + " *", "g");

function texto(v: unknown, max: number): string {
  return typeof v === "string" ? v.replace(TRAVESSAO, ", ").trim().slice(0, max) : "";
}

function exigirAgente(v: unknown): AgenteComBase {
  const a = agenteComBase(String(v ?? ""));
  if (!a) throw new ErroHttp(400, "agente_desconhecido", "Esse agente não tem base.");
  return a;
}

function uuidOuNulo(v: unknown): string | null {
  const s = String(v ?? "").trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s) ? s : null;
}

/** Título comparável, para não gravar a mesma técnica duas vezes. */
export function tituloNormalizado(t: string): string {
  return t.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/[^a-z0-9]+/g, " ").trim();
}

// ------------------------------------------------------------------ o leitor das fontes

const ESQUEMA_DAS_FICHAS = {
  nome: "fichas_da_base",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["fichas", "observacao"],
    properties: {
      observacao: { type: "string" },
      fichas: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["titulo", "tecnica", "quando_usar", "exemplo", "fonte_url"],
          properties: {
            titulo: { type: "string" },
            tecnica: { type: "string" },
            quando_usar: { type: "string" },
            exemplo: { type: "string" },
            fonte_url: { type: "string" },
          },
        },
      },
    },
  },
};

export function sistemaDoLeitor(a: AgenteComBase, existentes: string[], pesquisa: boolean): string {
  return `Você organiza a base de conhecimento de um agente da Aceleriq, agência de marketing.
AGENTE: ${a.nome} (${a.mesa}). ${a.papel}
FOCO DELE: ${a.tema}. Tudo a serviço de arte e conteúdo que trazem venda para o cliente.

${pesquisa
    ? `PESQUISE na internet o que há de mais novo e comprovado (de preferência dos últimos 6 meses) sobre o foco deste agente: técnicas, formatos e práticas que estão dando resultado agora. Traga até ${MAX_FICHAS_DA_PESQUISA} técnicas NOVAS, cada uma com a fonte_url real de onde veio.`
    : `Do MATERIAL que o dono mandou, extraia as técnicas que este agente pode aplicar ao gerar. Até ${MAX_FICHAS_POR_FONTE} fichas.`}

REGRAS DAS FICHAS
- Concretas e acionáveis: o como fazer, com o porquê quando houver. Nada de conselho vago ("seja criativo", "conheça seu público").
- Só o que serve a ESTE agente. Ignore propaganda do autor, opinião sem método e o que já está nas fichas existentes.
- titulo: o nome da técnica, até 80 caracteres. tecnica: 2 a 6 frases. quando_usar: 1 frase. exemplo: curto (pode ficar vazio). fonte_url: o endereço de onde veio (vazio se não houver).
- Menos é melhor do que ficha fraca. Se nada servir, devolva a lista vazia e diga o motivo em observacao.
- Português do Brasil, sem travessão.

FICHAS QUE O AGENTE JÁ TEM (não repita):
${existentes.length ? existentes.map((t) => `- ${t}`).join("\n") : "- nenhuma ainda"}`;
}

type FichaLida = { titulo: string; tecnica: string; quando_usar: string; exemplo: string; fonte_url: string };

export function limparFichas(bruto: unknown, max: number, jaTem: Set<string>): FichaLida[] {
  const lista = (bruto && typeof bruto === "object" && Array.isArray((bruto as { fichas?: unknown }).fichas))
    ? (bruto as { fichas: unknown[] }).fichas
    : [];
  const vistas = new Set(jaTem);
  const out: FichaLida[] = [];
  for (const item of lista) {
    const o = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    const titulo = texto(o.titulo, 160);
    const tecnica = texto(o.tecnica, 2400);
    if (titulo.length < 3 || tecnica.length < 10) continue;
    const chave = tituloNormalizado(titulo);
    if (vistas.has(chave)) continue;
    vistas.add(chave);
    const url = texto(o.fonte_url, 600);
    out.push({
      titulo,
      tecnica,
      quando_usar: texto(o.quando_usar, 400),
      exemplo: texto(o.exemplo, 600),
      fonte_url: /^https?:\/\//i.test(url) ? url : "",
    });
    if (out.length >= max) break;
  }
  return out;
}

async function titulosExistentes(agente: string): Promise<string[]> {
  const { data } = await servico().from("agente_base_fichas").select("titulo").eq("agente", agente).order("criado_em", { ascending: false }).limit(200);
  return ((data || []) as { titulo: string }[]).map((f) => f.titulo);
}

/** Lê a fonte (ou pesquisa) e grava as fichas. Devolve a fonte e as fichas gravadas. */
async function lerEGravar(e: {
  agente: AgenteComBase;
  clientId: string | null;
  tipo: "texto" | "documento" | "link" | "pesquisa";
  nome: string;
  url: string | null;
  material: string;
  pagador: string;
  criadoPor: string | null;
}) {
  const existentes = await titulosExistentes(e.agente.chave);
  const pesquisa = e.tipo === "pesquisa";
  const { data: fonte, error: erroFonte } = await servico().from("agente_base_fontes").insert({
    agente: e.agente.chave,
    client_id: e.clientId,
    tipo: e.tipo,
    nome: e.nome.slice(0, 300),
    url: e.url,
    status: "lendo",
    criado_por: e.criadoPor,
  }).select("id").single();
  if (erroFonte || !fonte) throw new ErroHttp(503, "banco_indisponivel", "Não foi possível guardar a fonte agora.");
  const fonteId = (fonte as { id: string }).id;
  try {
    const modelo = await modeloDoLeitor();
    const cortado = e.material.length > MAX_CHARS_DA_FONTE;
    const mensagem = pesquisa
      ? `Pesquise agora e traga as técnicas novas para este agente.`
      : e.tipo === "link"
        ? `Abra e leia este link (página, artigo ou vídeo; se for vídeo, use a descrição e a transcrição que encontrar) e extraia as técnicas: ${e.url}${e.material ? `\n\nO que o dono disse sobre ele: ${e.material}` : ""}`
        : `MATERIAL (${e.nome}${cortado ? ", cortado no limite" : ""}):\n${e.material.slice(0, MAX_CHARS_DA_FONTE)}`;
    const s = await chamarTexto({
      clientId: e.pagador,
      tarefa: "leitura_referencia",
      agente: "leitor",
      modeloId: modelo.id,
      sistema: sistemaDoLeitor(e.agente, existentes, pesquisa),
      mensagens: [{ papel: "usuario", conteudo: mensagem }],
      pesquisaWeb: pesquisa || e.tipo === "link",
      esquemaJson: ESQUEMA_DAS_FICHAS,
      referencia: { tipo: "agente_base_fonte", id: fonteId },
      criadoPor: e.criadoPor,
      timeoutMs: 140_000,
    });
    const jaTem = new Set(existentes.map(tituloNormalizado));
    const fichas = limparFichas(s.json, pesquisa ? MAX_FICHAS_DA_PESQUISA : MAX_FICHAS_POR_FONTE, jaTem);
    // A pesquisa sem fonte_url própria herda a primeira página que a busca citou.
    const primeiraFonte = (s.fontes || []).map((f) => f.url || "").find((u) => /^https?:\/\//i.test(u)) || null;
    if (fichas.length) {
      const { error } = await servico().from("agente_base_fichas").insert(fichas.map((f) => ({
        fonte_id: fonteId,
        agente: e.agente.chave,
        client_id: e.clientId,
        titulo: f.titulo,
        tecnica: f.tecnica,
        quando_usar: f.quando_usar,
        exemplo: f.exemplo,
        fonte_url: f.fonte_url || (pesquisa ? primeiraFonte : e.url) || null,
        criado_por: e.criadoPor,
      })));
      if (error) throw new ErroHttp(503, "banco_indisponivel", "As fichas não foram gravadas. Tente de novo.");
    }
    const observacao = texto((s.json as { observacao?: unknown } | undefined)?.observacao, 400);
    await servico().from("agente_base_fontes").update({
      status: "pronta",
      fichas: fichas.length,
      custo_usd: Number(s.custoUsd.toFixed(4)),
      erro: fichas.length ? null : (observacao || "Nada aproveitável para este agente."),
    }).eq("id", fonteId);
    return { fonte_id: fonteId, fichas: fichas.length, titulos: fichas.map((f) => f.titulo), observacao, custo_usd: s.custoUsd };
  } catch (err) {
    const mensagem = err instanceof Error ? err.message.slice(0, 300) : "falha na leitura";
    await servico().from("agente_base_fontes").update({ status: "erro", erro: mensagem }).eq("id", fonteId);
    throw err;
  }
}

// ------------------------------------------------------------------ ações

async function ensinar(ch: Chamador, corpo: Record<string, unknown>) {
  const agente = exigirAgente(corpo.agente);
  const tipo = String(corpo.tipo ?? "");
  if (tipo !== "texto" && tipo !== "documento" && tipo !== "link") throw new ErroHttp(400, "tipo_invalido", "Mande texto, documento ou link.");
  const clientId = uuidOuNulo(corpo.client_id);
  const url = tipo === "link" ? texto(corpo.url, 600) : "";
  if (tipo === "link" && !/^https?:\/\//i.test(url)) throw new ErroHttp(400, "link_invalido", "Cole um link que comece com http.");
  const material = typeof corpo.texto === "string" ? corpo.texto.trim() : "";
  if (tipo !== "link" && material.length < 20) throw new ErroHttp(400, "pouco_material", "Mande pelo menos uma frase completa para o agente aprender.");
  const nome = texto(corpo.nome, 300) || (tipo === "link" ? url : material.slice(0, 60));
  const pagador = clientId ?? (await carteiraDaAgencia());
  if (!pagador) throw new ErroHttp(409, "sem_carteira", "A carteira da agência não foi encontrada.");
  const r = await lerEGravar({ agente, clientId, tipo, nome, url: url || null, material, pagador, criadoPor: ch.userId });
  return json({ ok: true, ...r });
}

async function pesquisar(ch: Chamador, corpo: Record<string, unknown>) {
  const agente = exigirAgente(corpo.agente);
  const pagador = await carteiraDaAgencia();
  if (!pagador) throw new ErroHttp(409, "sem_carteira", "A carteira da agência não foi encontrada.");
  const r = await lerEGravar({ agente, clientId: null, tipo: "pesquisa", nome: `Pesquisa de ${hojeBr()}`, url: null, material: "", pagador, criadoPor: ch.userId });
  return json({ ok: true, ...r });
}

function hojeBr(): string {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit" }).format(new Date());
}

async function novaFicha(ch: Chamador, corpo: Record<string, unknown>) {
  const agente = exigirAgente(corpo.agente);
  const titulo = texto(corpo.titulo, 160);
  const tecnica = texto(corpo.tecnica, 2400);
  if (titulo.length < 3 || tecnica.length < 10) throw new ErroHttp(400, "ficha_incompleta", "Dê um título e explique a técnica em pelo menos uma frase.");
  const { data, error } = await servico().from("agente_base_fichas").insert({
    agente: agente.chave,
    client_id: uuidOuNulo(corpo.client_id),
    titulo,
    tecnica,
    quando_usar: texto(corpo.quando_usar, 400),
    exemplo: texto(corpo.exemplo, 600),
    criado_por: ch.userId,
  }).select("id").single();
  if (error) throw new ErroHttp(503, "banco_indisponivel", "A ficha não foi gravada.");
  return json({ ok: true, id: (data as { id: string }).id });
}

async function editarFicha(_ch: Chamador, corpo: Record<string, unknown>) {
  const id = uuidOuNulo(corpo.id);
  if (!id) throw new ErroHttp(400, "ficha_invalida", "Ficha não encontrada.");
  const mudar: Record<string, unknown> = { atualizado_em: new Date().toISOString() };
  if (typeof corpo.ativa === "boolean") mudar.ativa = corpo.ativa;
  if (corpo.titulo !== undefined) {
    const t = texto(corpo.titulo, 160);
    if (t.length < 3) throw new ErroHttp(400, "ficha_incompleta", "O título precisa de pelo menos 3 letras.");
    mudar.titulo = t;
  }
  if (corpo.tecnica !== undefined) {
    const t = texto(corpo.tecnica, 2400);
    if (t.length < 10) throw new ErroHttp(400, "ficha_incompleta", "Explique a técnica em pelo menos uma frase.");
    mudar.tecnica = t;
  }
  if (corpo.quando_usar !== undefined) mudar.quando_usar = texto(corpo.quando_usar, 400);
  if (corpo.exemplo !== undefined) mudar.exemplo = texto(corpo.exemplo, 600);
  if (corpo.client_id !== undefined) mudar.client_id = uuidOuNulo(corpo.client_id);
  const { error } = await servico().from("agente_base_fichas").update(mudar).eq("id", id);
  if (error) throw new ErroHttp(503, "banco_indisponivel", "A ficha não foi salva.");
  return json({ ok: true });
}

async function apagarFicha(_ch: Chamador, corpo: Record<string, unknown>) {
  const id = uuidOuNulo(corpo.id);
  if (!id) throw new ErroHttp(400, "ficha_invalida", "Ficha não encontrada.");
  const { error } = await servico().from("agente_base_fichas").delete().eq("id", id);
  if (error) throw new ErroHttp(503, "banco_indisponivel", "A ficha não foi apagada.");
  return json({ ok: true });
}

async function apagarFonte(_ch: Chamador, corpo: Record<string, unknown>) {
  const id = uuidOuNulo(corpo.id);
  if (!id) throw new ErroHttp(400, "fonte_invalida", "Fonte não encontrada.");
  // As fichas da fonte saem junto (on delete cascade).
  const { error } = await servico().from("agente_base_fontes").delete().eq("id", id);
  if (error) throw new ErroHttp(503, "banco_indisponivel", "A fonte não foi apagada.");
  return json({ ok: true });
}

/** O cron: até 2 agentes sem pesquisa há 6 dias ou mais, na carteira da agência. */
async function pesquisaSemanal() {
  // O resultado das fichas e os vencedores: uma vez por dia de rodada (sem custo de IA).
  const { data: recente } = await servico().from("agente_base_fichas").select("id").gte("resultado_em", diasAtras(0.5)).limit(1);
  const resultados = (recente || []).length ? null : await aprenderComResultados().catch((err) => {
    console.error("[base-dos-agentes] resultados falharam", err instanceof Error ? err.message : err);
    return null;
  });
  // A faxina: na primeira terça do mês (dia 1 a 7), na primeira chamada do dia.
  if (!(recente || []).length && new Date().getUTCDate() <= 7) {
    await faxinaDaBase(await carteiraDaAgencia()).catch((err) => console.error("[base-dos-agentes] faxina falhou", err instanceof Error ? err.message : err));
  }
  // O aviso da semana sai uma vez, na primeira chamada do dia (a mesma trava dos resultados).
  if (!(recente || []).length) {
    await avisarResumoDaSemana().catch((err) => console.error("[base-dos-agentes] resumo da semana falhou", err instanceof Error ? err.message : err));
  }
  const pagador = await carteiraDaAgencia();
  if (!pagador) return json({ ok: false, motivo: "sem_carteira" });
  const saldo = await lerSaldo(pagador).catch(() => 0);
  if (saldo < SALDO_MINIMO_DA_RODADA) return json({ ok: false, motivo: "saldo_baixo", saldo });
  const desde = new Date(Date.now() - 6 * 86_400_000).toISOString();
  const { data } = await servico().from("agente_base_fontes").select("agente").eq("tipo", "pesquisa").gte("criado_em", desde);
  const feitos = new Set(((data || []) as { agente: string }[]).map((f) => f.agente));
  const daVez = AGENTES_COM_BASE.filter((a) => !feitos.has(a.chave)).slice(0, AGENTES_POR_RODADA);
  const resultado: Array<{ agente: string; fichas?: number; erro?: string }> = [];
  for (const agente of daVez) {
    try {
      const r = await lerEGravar({ agente, clientId: null, tipo: "pesquisa", nome: `Pesquisa semanal de ${hojeBr()}`, url: null, material: "", pagador, criadoPor: null });
      resultado.push({ agente: agente.chave, fichas: r.fichas });
    } catch (err) {
      resultado.push({ agente: agente.chave, erro: err instanceof Error ? err.message.slice(0, 160) : "falha" });
    }
  }
  return json({ ok: true, agentes: resultado, resultados });
}

// ------------------------------------------------------------------ aprender com os resultados

/** Janela dos usos e dos posts que contam no resultado. */
const DIAS_DO_RESULTADO = 180;
/** Janela das peças que podem virar ficha de vencedor. */
const DIAS_DOS_VENCEDORES = 60;
/** Fichas de vencedor por cliente a cada rodada. */
const VENCEDORES_POR_CLIENTE = 3;

const emPedacos = <T>(lista: T[], n = 100): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < lista.length; i += n) out.push(lista.slice(i, i + n));
  return out;
};
const diasAtras = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();

type TrabalhoParaResultado = { id: string; client_id: string; entrega_status: string | null; entrega_rodada: number | null; post_id: string | null; task_id: string | null; direcao: Record<string, unknown> | null };
type MedidaDoTrabalho = { multiplo: number; medida: MedidaDoMultiplo | null; permalink: string | null };

const semBarraNoFim = (u: string | null | undefined) => String(u || "").replace(/\/+$/, "");

/** O múltiplo do post publicado de cada trabalho (publicação do post da entrega, depois a métrica pela mídia ou pelo link). */
async function multiplosDosTrabalhos(trabalhos: TrabalhoParaResultado[]): Promise<Map<string, MedidaDoTrabalho>> {
  const saida = new Map<string, MedidaDoTrabalho>();
  const comPost = trabalhos.filter((t) => t.post_id);
  if (!comPost.length) return saida;
  const pubs: Array<{ post_id: string; status: string; external_post_id: string | null; permalink: string | null }> = [];
  for (const ids of emPedacos([...new Set(comPost.map((t) => t.post_id as string))])) {
    const { data } = await servico().from("editorial_publications").select("post_id, status, external_post_id, permalink").in("post_id", ids).eq("status", "published");
    pubs.push(...((data || []) as typeof pubs));
  }
  for (const cliente of [...new Set(comPost.map((t) => t.client_id))]) {
    const { data } = await servico().from("social_post_metrics")
      .select("media_id, permalink, posted_at, views, reach, total_interactions, like_count, comments_count, saved, shares")
      .eq("client_id", cliente).gte("posted_at", diasAtras(DIAS_DO_RESULTADO)).order("posted_at", { ascending: false }).limit(300);
    const posts = (data || []) as Array<PostParaMultiplo & { media_id: string; permalink: string | null }>;
    if (!posts.length) continue;
    const bases = basesDoPerfil(posts, DIAS_DO_RESULTADO);
    const porMidia = new Map(posts.map((p) => [String(p.media_id), p]));
    const porLink = new Map(posts.filter((p) => p.permalink).map((p) => [semBarraNoFim(p.permalink), p]));
    for (const t of comPost.filter((x) => x.client_id === cliente)) {
      for (const pub of pubs.filter((p) => p.post_id === t.post_id)) {
        const m = (pub.external_post_id && porMidia.get(String(pub.external_post_id))) || (pub.permalink && porLink.get(semBarraNoFim(pub.permalink))) || null;
        if (!m) continue;
        const r = multiploDoPost(m, bases);
        if (r.multiplo !== null) saida.set(t.id, { multiplo: r.multiplo, medida: r.medida, permalink: m.permalink || pub.permalink || null });
        break;
      }
    }
  }
  return saida;
}

async function lerTrabalhos(ids: string[]): Promise<TrabalhoParaResultado[]> {
  const out: TrabalhoParaResultado[] = [];
  for (const pedaco of emPedacos(ids)) {
    const { data } = await servico().from("estudio_trabalhos").select("id, client_id, entrega_status, entrega_rodada, post_id, task_id, direcao").in("id", pedaco);
    out.push(...((data || []) as TrabalhoParaResultado[]));
  }
  return out;
}

const NOME_DA_MEDIDA: Record<MedidaDoMultiplo, string> = { views: "visualizações", alcance: "alcance", interacoes: "interações" };
const numeroBr = (n: number) => String(Math.round(n * 10) / 10).replace(".", ",");

/** O texto da capa que a pessoa leu: o título (headline) e, junto, o resto da capa em uma linha. */
export function textoDaCapa(card: { texto_exato?: string; blocos?: Array<{ papel?: string; texto?: string }> } | undefined): string {
  if (!card) return "";
  const blocos = (card.blocos || []).filter((b) => b && b.texto);
  const titulo = blocos.find((b) => b.papel === "headline");
  const resto = blocos.filter((b) => b !== titulo).map((b) => String(b.texto));
  const linha = titulo ? [String(titulo.texto), ...resto].join(" · ") : String(card.texto_exato || "").split("\n").filter(Boolean).join(" · ");
  return texto(linha.replace(/\s+/g, " "), 140);
}

/** As fichas de um post vencedor: uma para o diretor de arte e uma para o agente do Mês, só deste cliente. */
export function fichasDoVencedor(e: { multiplo: number; medida: MedidaDoMultiplo | null; capa: string; conceito: string; gancho: string; formato: string; tituloDaPauta: string }) {
  const vezes = numeroBr(e.multiplo);
  const medida = e.medida ? NOME_DA_MEDIDA[e.medida] : "desempenho";
  return [
    {
      agente: "estudio.diretor",
      titulo: `Rendeu ${vezes}x: ${e.capa || e.conceito || "peça do cliente"}`.slice(0, 160),
      tecnica: `Este ${e.formato} do cliente rendeu ${vezes}x o normal do perfil em ${medida}.${e.capa ? ` Capa: "${e.capa}".` : ""}${e.conceito ? ` Conceito: ${e.conceito}.` : ""}${e.gancho ? ` Gancho do momento: ${e.gancho}.` : ""} Repita a estrutura que funcionou (o tipo de capa, o ângulo e o formato) em assuntos novos, sem copiar o texto.`.slice(0, 2400),
      quando_usar: "Peças deste cliente com o mesmo objetivo ou pilar.",
      exemplo: e.capa,
    },
    {
      agente: "mes.estrategista",
      titulo: `Pauta que rendeu ${vezes}x: ${e.tituloDaPauta || e.capa || "pauta do cliente"}`.slice(0, 160),
      tecnica: `A pauta "${e.tituloDaPauta || e.capa}" (${e.formato}) rendeu ${vezes}x o normal do perfil em ${medida}.${e.gancho ? ` Ela nasceu do gancho do momento: ${e.gancho}.` : ""}${e.conceito ? ` Conceito: ${e.conceito}.` : ""} Planeje pautas novas com o mesmo ângulo e formato, variando o assunto.`.slice(0, 2400),
      quando_usar: "Planejar o mês deste cliente.",
      exemplo: "",
    },
  ];
}

/** Os posts que renderam 1,5x ou mais viram fichas DESTE cliente para o diretor de arte e o agente do Mês. */
async function fichasDosVencedores(): Promise<number> {
  const { data } = await servico().from("estudio_trabalhos").select("id, client_id, entrega_status, entrega_rodada, post_id, task_id, direcao")
    .not("post_id", "is", null).gte("criado_em", diasAtras(DIAS_DOS_VENCEDORES)).limit(600);
  const trabalhos = (data || []) as TrabalhoParaResultado[];
  if (!trabalhos.length) return 0;
  const medidas = await multiplosDosTrabalhos(trabalhos);
  const vencedores = trabalhos
    .map((t) => ({ t, m: medidas.get(t.id) }))
    .filter((x): x is { t: TrabalhoParaResultado; m: MedidaDoTrabalho } => !!x.m && x.m.multiplo >= DESTAQUE_A_PARTIR_DE)
    .sort((a, b) => b.m.multiplo - a.m.multiplo);
  if (!vencedores.length) return 0;
  const tarefas = new Map<string, { title: string; description: string | null }>();
  for (const ids of emPedacos([...new Set(vencedores.map((v) => v.t.task_id).filter(Boolean) as string[])])) {
    const { data: ts } = await servico().from("tasks").select("id, title, description").in("id", ids);
    for (const t of (ts || []) as Array<{ id: string; title: string; description: string | null }>) tarefas.set(t.id, t);
  }
  let criadas = 0;
  const porCliente = new Map<string, number>();
  const fontes = new Map<string, string>();
  for (const { t, m } of vencedores) {
    if ((porCliente.get(t.client_id) || 0) >= VENCEDORES_POR_CLIENTE) continue;
    if (m.permalink) {
      const { data: ja } = await servico().from("agente_base_fichas").select("id").eq("client_id", t.client_id).eq("fonte_url", m.permalink).limit(1);
      if ((ja || []).length) continue;
    }
    const cards = Array.isArray((t.direcao || {}).cards) ? (t.direcao as { cards: Array<{ texto_exato?: string; blocos?: Array<{ papel?: string; texto?: string }> }> }).cards : [];
    const tarefa = t.task_id ? tarefas.get(t.task_id) : undefined;
    const linhas = fichasDoVencedor({
      multiplo: m.multiplo,
      medida: m.medida,
      capa: textoDaCapa(cards[0]),
      conceito: texto((t.direcao || {}).conceito, 300),
      gancho: tarefa ? texto((/Gancho do momento:\s*([^\n]+)/.exec(String(tarefa.description || "")) || [])[1], 200) : "",
      formato: cards.length > 1 ? "carrossel" : "post",
      tituloDaPauta: texto(tarefa?.title, 120),
    });
    for (const l of linhas) {
      const chaveFonte = `${t.client_id}|${l.agente}`;
      let fonteId = fontes.get(chaveFonte);
      if (!fonteId) {
        const { data: f } = await servico().from("agente_base_fontes").insert({
          agente: l.agente, client_id: t.client_id, tipo: "texto", nome: `Números do Instagram de ${hojeBr()}`, status: "pronta", fichas: 0,
        }).select("id").single();
        if (!f) continue;
        fonteId = (f as { id: string }).id;
        fontes.set(chaveFonte, fonteId);
      }
      const { error } = await servico().from("agente_base_fichas").insert({ fonte_id: fonteId, agente: l.agente, client_id: t.client_id, titulo: l.titulo, tecnica: l.tecnica, quando_usar: l.quando_usar, exemplo: l.exemplo, fonte_url: m.permalink });
      if (error) continue;
      criadas += 1;
      const { count } = await servico().from("agente_base_fichas").select("id", { count: "exact", head: true }).eq("fonte_id", fonteId);
      await servico().from("agente_base_fontes").update({ fichas: count ?? 0 }).eq("id", fonteId);
    }
    porCliente.set(t.client_id, (porCliente.get(t.client_id) || 0) + 1);
  }
  return criadas;
}

/** Janela dos posts fora da curva de concorrentes e referências que viram ficha. */
const DIAS_DOS_CONCORRENTES = 45;

/** As fichas de um post fora da curva de um perfil de referência ou concorrente: por formato, para quem faz aquilo. */
export function fichasDoConcorrente(e: { handle: string; papel: string; vezes: number; formato: string; legenda: string; leitura: string }) {
  const quem = e.papel === "concorrente" ? "concorrente" : "referência";
  const linha = texto(String(e.legenda || "").split("\n").filter(Boolean)[0], 140);
  const video = /reel|video|vídeo/i.test(e.formato);
  const vezes = numeroBr(e.vezes);
  const tecnica = `Um ${video ? "Reel" : e.formato || "post"} de @${e.handle}, ${quem} deste cliente, teve ${vezes}x a mediana de engajamento do perfil dele.${e.leitura ? ` O que ele mostra: ${texto(e.leitura, 500)}.` : ""}${linha ? ` Primeira linha da legenda: "${linha}".` : ""} Aproveite o mecanismo (o tipo de gancho, o formato e o ângulo) com a voz e a oferta deste cliente; nunca copie o texto, a imagem ou a ideia ao pé da letra.`.slice(0, 2400);
  const titulo = `@${e.handle} rendeu ${vezes}x: ${linha || e.formato || "post"}`.slice(0, 160);
  const agentes = ["mes.estrategista", ...(video ? ["videos.diretor", "roteiros.roteirista"] : ["estudio.diretor"])];
  return agentes.map((agente) => ({ agente, titulo, tecnica, quando_usar: `Pautas deste cliente em ${video ? "Reel" : "carrossel ou post"}.`, exemplo: linha }));
}

/** 17/10 (rodada 3): os posts fora da curva dos perfis de referência e concorrentes viram fichas do cliente. */
async function fichasDosConcorrentes(): Promise<number> {
  const { data } = await servico().from("cliente_perfis_posts")
    .select("perfil_id, client_id, formato, legenda, leitura, permalink, vezes_a_mediana, publicado_em")
    .eq("fora_da_curva", true).is("arquivado_em", null).gte("publicado_em", diasAtras(DIAS_DOS_CONCORRENTES))
    .order("vezes_a_mediana", { ascending: false }).limit(300);
  const posts = (data || []) as Array<{ perfil_id: string; client_id: string; formato: string | null; legenda: string | null; leitura: string | null; permalink: string | null; vezes_a_mediana: number | string | null }>;
  if (!posts.length) return 0;
  const perfis = new Map<string, { handle: string; papel: string }>();
  for (const ids of emPedacos([...new Set(posts.map((p) => p.perfil_id))])) {
    const { data: ps } = await servico().from("cliente_perfis_instagram").select("id, handle, papel").in("id", ids).is("arquivado_em", null);
    for (const p of (ps || []) as Array<{ id: string; handle: string; papel: string }>) perfis.set(p.id, p);
  }
  let criadas = 0;
  const porCliente = new Map<string, number>();
  const fontes = new Map<string, string>();
  for (const post of posts) {
    const perfil = perfis.get(post.perfil_id);
    const vezes = Number(post.vezes_a_mediana);
    if (!perfil || !post.permalink || !Number.isFinite(vezes) || (porCliente.get(post.client_id) || 0) >= VENCEDORES_POR_CLIENTE) continue;
    const { data: ja } = await servico().from("agente_base_fichas").select("id").eq("client_id", post.client_id).eq("fonte_url", post.permalink).limit(1);
    if ((ja || []).length) continue;
    for (const l of fichasDoConcorrente({ handle: perfil.handle, papel: perfil.papel, vezes, formato: post.formato || "", legenda: post.legenda || "", leitura: post.leitura || "" })) {
      const chaveFonte = `${post.client_id}|${l.agente}`;
      let fonteId = fontes.get(chaveFonte);
      if (!fonteId) {
        const { data: f } = await servico().from("agente_base_fontes").insert({
          agente: l.agente, client_id: post.client_id, tipo: "texto", nome: `Concorrentes e referências de ${hojeBr()}`, status: "pronta", fichas: 0,
        }).select("id").single();
        if (!f) continue;
        fonteId = (f as { id: string }).id;
        fontes.set(chaveFonte, fonteId);
      }
      const { error } = await servico().from("agente_base_fichas").insert({ fonte_id: fonteId, agente: l.agente, client_id: post.client_id, titulo: l.titulo, tecnica: l.tecnica, quando_usar: l.quando_usar, exemplo: l.exemplo, fonte_url: post.permalink });
      if (error) continue;
      criadas += 1;
      const { count } = await servico().from("agente_base_fichas").select("id", { count: "exact", head: true }).eq("fonte_id", fonteId);
      await servico().from("agente_base_fontes").update({ fichas: count ?? 0 }).eq("id", fonteId);
    }
    porCliente.set(post.client_id, (porCliente.get(post.client_id) || 0) + 1);
  }
  return criadas;
}

// ------------------------------------------------------------------ rodada 4: Ads, comentários e faxina

/** Janela do desempenho dos anúncios. */
const DIAS_DOS_ANUNCIOS = 60;

/** A eficiência de um anúncio: o custo por resultado normal da conta dividido pelo dele (teto 5). Sem gasto suficiente, null. */
export function eficienciaDoAnuncio(m: { gasto: number; resultados: number; custo_por_resultado: number | null }, medianaDaConta: number): number | null {
  if (!(medianaDaConta > 0) || m.gasto < medianaDaConta) return null;
  if (m.resultados > 0 && m.custo_por_resultado) return Math.min(5, Math.round((medianaDaConta / m.custo_por_resultado) * 100) / 100);
  // Gastou o dobro do normal sem nenhum resultado: queimou verba.
  return m.gasto >= 2 * medianaDaConta ? Math.round((medianaDaConta / m.gasto) * 100) / 100 : null;
}

/** 17/10 (dono: "Ads aprendendo com o resultado real"): a eficiência de cada criativo (e média por plano) usado pela base. */
async function eficienciasDosAnuncios(idsCriativos: string[], idsPlanos: string[]): Promise<Map<string, number>> {
  const saida = new Map<string, number>();
  type Criativo = { id: string; client_id: string; ad_id: string | null; plano_id: string | null };
  const criativos: Criativo[] = [];
  for (const ids of emPedacos(idsCriativos)) {
    const { data } = await servico().from("ads_criativos").select("id, client_id, ad_id, plano_id").in("id", ids);
    criativos.push(...((data || []) as Criativo[]));
  }
  for (const ids of emPedacos(idsPlanos)) {
    const { data } = await servico().from("ads_criativos").select("id, client_id, ad_id, plano_id").in("plano_id", ids);
    for (const c of (data || []) as Criativo[]) if (!criativos.some((x) => x.id === c.id)) criativos.push(c);
  }
  const comAnuncio = criativos.filter((c) => c.ad_id);
  for (const cliente of [...new Set(comAnuncio.map((c) => c.client_id))]) {
    const { data } = await servico().from("ads_creative_daily")
      .select("ad_id, day, spend, impressions, reach, clicks, link_clicks, frequency, actions")
      .eq("client_id", cliente).gte("day", diasAtras(DIAS_DOS_ANUNCIOS).slice(0, 10)).limit(10000);
    const porAnuncio = new Map<string, Diaria[]>();
    for (const l of (data || []) as Diaria[]) porAnuncio.set(l.ad_id, [...(porAnuncio.get(l.ad_id) || []), l]);
    const metricas = new Map([...porAnuncio].map(([ad, linhas]) => [ad, somarMetricas(linhas)]));
    // O normal da conta: a mediana do custo por resultado dos anúncios com resultado (pelo menos 3).
    const custos = [...metricas.values()].map((m) => m.custo_por_resultado).filter((x): x is number => typeof x === "number" && x > 0).sort((a, b) => a - b);
    if (custos.length < 3) continue;
    const meio = Math.floor(custos.length / 2);
    const mediana = custos.length % 2 ? custos[meio] : (custos[meio - 1] + custos[meio]) / 2;
    for (const c of comAnuncio.filter((x) => x.client_id === cliente)) {
      const m = metricas.get(String(c.ad_id));
      const ef = m ? eficienciaDoAnuncio(m, mediana) : null;
      if (ef !== null) saida.set(`ads_criativo:${c.id}`, ef);
    }
  }
  // O plano vale a média dos criativos dele (a ficha do gestor entra pelo plano).
  for (const plano of idsPlanos) {
    const efs = criativos.filter((c) => c.plano_id === plano).map((c) => saida.get(`ads_criativo:${c.id}`)).filter((x): x is number => typeof x === "number");
    if (efs.length) saida.set(`ads_plano:${plano}`, Math.round((efs.reduce((a, b) => a + b, 0) / efs.length) * 100) / 100);
  }
  return saida;
}

/** Janela dos comentários de cliente lidos a cada rodada. */
const DIAS_DOS_COMENTARIOS = 14;
/** Agentes que recebem a preferência do cliente (o dono: "vale também para o Mês, o Ads e o vídeo"). */
const AGENTES_DO_COMENTARIO = ["estudio.diretor", "mes.estrategista", "ads.estatico", "videos.diretor"];

/** As fichas de uma preferência duradoura do cliente, em cada agente que faz peça para ele. */
export function fichasDoComentario(comentario: string) {
  const c = texto(comentario.replace(/\s+/g, " "), 400);
  return AGENTES_DO_COMENTARIO.map((agente) => ({
    agente,
    titulo: `Pedido do cliente: ${c}`.slice(0, 160),
    tecnica: `O cliente pediu numa peça: "${c}". Trate como preferência dele em todas as próximas peças, sem precisar que ele peça de novo.`,
    quando_usar: "Toda peça deste cliente.",
    exemplo: "",
  }));
}

/**
 * 17/10 (dono: "o comentário do cliente vira técnica"): os pedidos de ajuste do cliente (estudio_trabalhos.ajustes_do_cliente)
 * e as reprovações com texto (agente_memoria, origem aprovacao) das últimas 2 semanas; o Jev separa o que é gosto duradouro
 * do ajuste só daquela peça, e o duradouro vira ficha do cliente para o diretor, o Mês, o Ads e o vídeo.
 */
async function fichasDosComentarios(pagador: string | null): Promise<number> {
  type Comentario = { chave: string; client_id: string; texto: string };
  const comentarios: Comentario[] = [];
  const { data: trabalhos } = await servico().from("estudio_trabalhos").select("id, client_id, ajustes_do_cliente")
    .not("ajustes_do_cliente", "is", null).gte("atualizado_em", diasAtras(DIAS_DOS_COMENTARIOS)).limit(300);
  for (const t of (trabalhos || []) as Array<{ id: string; client_id: string; ajustes_do_cliente: unknown }>) {
    for (const a of Array.isArray(t.ajustes_do_cliente) ? t.ajustes_do_cliente : []) {
      const o = (a && typeof a === "object" ? a : {}) as Record<string, unknown>;
      const txt = texto(o.texto, 500);
      if (txt.length < 8 || o.decisao === "aprovado") continue;
      comentarios.push({ chave: `comentario:${String(o.evento_id || `${t.id}:${o.pedido_em || txt.slice(0, 20)}`)}`, client_id: t.client_id, texto: txt });
    }
  }
  // Só a reprovação com texto (o gatilho grava tipo "evitar"); a memória de entrega tem a mesma origem e não é pedido.
  const { data: memorias } = await servico().from("agente_memoria").select("id, client_id, texto")
    .eq("origem", "aprovacao").eq("tipo", "evitar").gte("criado_em", diasAtras(DIAS_DOS_COMENTARIOS)).limit(300);
  for (const m of (memorias || []) as Array<{ id: string; client_id: string; texto: string }>) {
    const txt = texto(m.texto, 500);
    if (txt.length >= 8 && !comentarios.some((c) => c.client_id === m.client_id && c.texto === txt)) comentarios.push({ chave: `comentario:mem:${m.id}`, client_id: m.client_id, texto: txt });
  }
  // Só os que ainda não viraram ficha (a chave do comentário fica em fonte_url).
  const novos: Comentario[] = [];
  for (const c of comentarios.slice(0, 120)) {
    const { data: ja } = await servico().from("agente_base_fichas").select("id").eq("fonte_url", c.chave).limit(1);
    if (!(ja || []).length) novos.push(c);
  }
  if (!novos.length) return 0;
  let criadas = 0;
  for (const lote of emPedacos(novos, 30)) {
    const questions: Record<string, PerguntaJev> = {};
    lote.forEach((_, i) => {
      questions[`c${i}`] = {
        type: "noul",
        instructions: `O comentário do cliente em \`comentarios[${i}]\` é uma preferência duradoura dele (gosto, regra da marca, algo que vale para as próximas peças), e não um ajuste só daquela peça (corrigir um erro, trocar um dado, mudar uma foto específica)?`,
      };
    });
    let respostas: Record<string, { noul?: number }> = {};
    try {
      const r = await jevPerguntar({ state: { comentarios: lote.map((c) => c.texto) }, questions });
      if (pagador) await cobrarJev(r, { clientId: pagador, tarefa: "leitura_referencia", criadoPor: null }).catch(() => null);
      respostas = r.answers as typeof respostas;
    } catch (err) {
      console.error("[base-dos-agentes] Jev dos comentários falhou", err instanceof Error ? err.message : err);
      continue;
    }
    const fontes = new Map<string, string>();
    for (let i = 0; i < lote.length; i += 1) {
      const c = lote[i];
      if ((probabilidadeNoul(respostas[`c${i}`]) ?? 0) < 0.6) continue;
      for (const l of fichasDoComentario(c.texto)) {
        const chaveFonte = `${c.client_id}|${l.agente}`;
        let fonteId = fontes.get(chaveFonte);
        if (!fonteId) {
          const { data: f } = await servico().from("agente_base_fontes").insert({ agente: l.agente, client_id: c.client_id, tipo: "texto", nome: `Pedidos do cliente de ${hojeBr()}`, status: "pronta", fichas: 0 }).select("id").single();
          if (!f) continue;
          fonteId = (f as { id: string }).id;
          fontes.set(chaveFonte, fonteId);
        }
        const { error } = await servico().from("agente_base_fichas").insert({ fonte_id: fonteId, agente: l.agente, client_id: c.client_id, titulo: l.titulo, tecnica: l.tecnica, quando_usar: l.quando_usar, exemplo: l.exemplo, fonte_url: c.chave });
        if (error) continue;
        criadas += 1;
        const { count } = await servico().from("agente_base_fichas").select("id", { count: "exact", head: true }).eq("fonte_id", fonteId);
        await servico().from("agente_base_fontes").update({ fichas: count ?? 0 }).eq("id", fonteId);
      }
    }
  }
  return criadas;
}

/** Dias sem nenhum uso para a ficha ser arquivada na faxina. */
const DIAS_SEM_USO = 60;
/** Pares de fichas parecidas que o Jev julga por rodada. */
const PARES_POR_FAXINA = 40;

/** Palavras de 4 letras ou mais, sem acento (para achar fichas parecidas). */
function palavrasDaFicha(t: string): Set<string> {
  return new Set(t.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").split(/[^a-z0-9]+/).filter((p) => p.length >= 4));
}
export function parecidas(a: string, b: string): number {
  const x = palavrasDaFicha(a);
  const y = palavrasDaFicha(b);
  if (!x.size || !y.size) return 0;
  let comum = 0;
  x.forEach((p) => { if (y.has(p)) comum += 1; });
  return comum / (x.size + y.size - comum);
}

/**
 * 17/10 (dono: "faxina mensal da base"): arquiva (desliga, com o porquê) as fichas sem nenhum uso em 60 dias e, entre
 * pares parecidos do mesmo agente e do mesmo cliente, a repetida que o Jev confirmar (fica a mais usada, ou a mais velha).
 */
export async function faxinaDaBase(pagador: string | null): Promise<{ semUso: number; repetidas: number }> {
  const { data: velhas } = await servico().from("agente_base_fichas").update({ ativa: false, arquivada_por: "sem_uso", atualizado_em: new Date().toISOString() })
    .eq("ativa", true).eq("usos", 0).lt("criado_em", diasAtras(DIAS_SEM_USO)).select("id");
  const { data } = await servico().from("agente_base_fichas").select("id, agente, client_id, titulo, tecnica, usos, criado_em").eq("ativa", true).limit(5000);
  const fichas = (data || []) as Array<{ id: string; agente: string; client_id: string | null; titulo: string; tecnica: string; usos: number; criado_em: string }>;
  const pares: Array<[typeof fichas[number], typeof fichas[number], number]> = [];
  const porGrupo = new Map<string, typeof fichas>();
  for (const f of fichas) porGrupo.set(`${f.agente}|${f.client_id || ""}`, [...(porGrupo.get(`${f.agente}|${f.client_id || ""}`) || []), f]);
  porGrupo.forEach((lista) => {
    for (let i = 0; i < lista.length; i += 1) {
      for (let j = i + 1; j < lista.length; j += 1) {
        const s = parecidas(`${lista[i].titulo} ${lista[i].tecnica}`, `${lista[j].titulo} ${lista[j].tecnica}`);
        if (s >= 0.4) pares.push([lista[i], lista[j], s]);
      }
    }
  });
  pares.sort((a, b) => b[2] - a[2]);
  const avaliar = pares.slice(0, PARES_POR_FAXINA);
  let repetidas = 0;
  if (avaliar.length) {
    const questions: Record<string, PerguntaJev> = {};
    avaliar.forEach((_, i) => {
      questions[`p${i}`] = { type: "noul", instructions: `As duas fichas em \`pares[${i}]\` ensinam a mesma técnica (uma deixa a outra sem nada a acrescentar)?` };
    });
    try {
      const r = await jevPerguntar({ state: { pares: avaliar.map(([a, b]) => ({ a: `${a.titulo}: ${a.tecnica.slice(0, 500)}`, b: `${b.titulo}: ${b.tecnica.slice(0, 500)}` })) }, questions });
      if (pagador) await cobrarJev(r, { clientId: pagador, tarefa: "leitura_referencia", criadoPor: null }).catch(() => null);
      const fora = new Set<string>();
      avaliar.forEach(([a, b], i) => {
        if (fora.has(a.id) || fora.has(b.id) || (probabilidadeNoul((r.answers as Record<string, { noul?: number }>)[`p${i}`]) ?? 0) < 0.7) return;
        // Fica a mais usada; empate, a mais velha.
        const sai = a.usos !== b.usos ? (a.usos < b.usos ? a : b) : (a.criado_em > b.criado_em ? a : b);
        fora.add(sai.id);
      });
      for (const ids of emPedacos([...fora])) {
        const { data: arquivadas } = await servico().from("agente_base_fichas").update({ ativa: false, arquivada_por: "repetida", atualizado_em: new Date().toISOString() }).in("id", ids).select("id");
        repetidas += (arquivadas || []).length;
      }
    } catch (err) {
      console.error("[base-dos-agentes] Jev da faxina falhou", err instanceof Error ? err.message : err);
    }
  }
  return { semUso: (velhas || []).length, repetidas };
}

/**
 * 17/10 (dono: "a base aprender com o que eu aprovo e reprovo; os números do Instagram voltando para a técnica"):
 * o resultado de cada ficha (desfecho das peças e múltiplo dos posts) gravado nela, e os vencedores viram fichas.
 */
export async function aprenderComResultados(): Promise<{ fichas: number; vencedoras: number; concorrentes: number; comentarios: number }> {
  const usos: UsoParaResultado[] = [];
  for (let pagina = 0; pagina < 10; pagina += 1) {
    const { data } = await servico().from("agente_base_usos").select("ficha_id, referencia_tipo, referencia_id")
      .gte("criado_em", diasAtras(DIAS_DO_RESULTADO)).order("criado_em", { ascending: false }).range(pagina * 1000, pagina * 1000 + 999);
    const lote = (data || []) as UsoParaResultado[];
    usos.push(...lote);
    if (lote.length < 1000) break;
  }
  const desfechos = new Map<string, DesfechoDaPeca>();
  const multiplos = new Map<string, number>();
  const idsEstudio = [...new Set(usos.filter((u) => u.referencia_tipo === "estudio_trabalho" && u.referencia_id).map((u) => u.referencia_id as string))];
  const trabalhos = await lerTrabalhos(idsEstudio);
  for (const t of trabalhos) desfechos.set(`estudio_trabalho:${t.id}`, desfechoDoEstudio(t));
  (await multiplosDosTrabalhos(trabalhos)).forEach((m, id) => multiplos.set(`estudio_trabalho:${id}`, m.multiplo));
  const idsAds = [...new Set(usos.filter((u) => u.referencia_tipo === "ads_criativo" && u.referencia_id).map((u) => u.referencia_id as string))];
  const idsPlanos = [...new Set(usos.filter((u) => u.referencia_tipo === "ads_plano" && u.referencia_id).map((u) => u.referencia_id as string))];
  for (const pedaco of emPedacos(idsAds)) {
    const { data } = await servico().from("ads_criativos").select("id, status").in("id", pedaco);
    for (const c of (data || []) as Array<{ id: string; status: string | null }>) desfechos.set(`ads_criativo:${c.id}`, desfechoDoAds(c.status));
  }
  const agora = new Date().toISOString();
  let fichas = 0;
  // 17/10 (rodada 4): o resultado real dos anúncios (custo por resultado contra o normal da conta).
  const eficiencias = await eficienciasDosAnuncios(idsAds, idsPlanos).catch((err) => {
    console.error("[base-dos-agentes] eficiência dos anúncios falhou", err instanceof Error ? err.message : err);
    return new Map<string, number>();
  });
  for (const [id, r] of resultadosDasFichas(usos, desfechos, multiplos, eficiencias)) {
    const { error } = await servico().from("agente_base_fichas").update({ ...r, resultado_em: agora }).eq("id", id);
    if (!error) fichas += 1;
  }
  const vencedoras = await fichasDosVencedores().catch((err) => {
    console.error("[base-dos-agentes] vencedores falharam", err instanceof Error ? err.message : err);
    return 0;
  });
  const concorrentes = await fichasDosConcorrentes().catch((err) => {
    console.error("[base-dos-agentes] concorrentes falharam", err instanceof Error ? err.message : err);
    return 0;
  });
  const comentarios = await fichasDosComentarios(await carteiraDaAgencia()).catch((err) => {
    console.error("[base-dos-agentes] comentários falharam", err instanceof Error ? err.message : err);
    return 0;
  });
  return { fichas, vencedoras, concorrentes, comentarios };
}

// ------------------------------------------------------------------ resumo da semana e carteiras baixas

/** Carteira abaixo disso não paga a pesquisa (US$ 1) nem a leitura automática (US$ 0,30): o aviso começa aqui. */
export const CARTEIRA_BAIXA = 1;

export type ResumoDaSemana = {
  novas: { pesquisa: number; materiais: number; numeros: number; concorrentes: number };
  sairam: number;
  referenciasLidas: number;
  carteirasBaixas: Array<{ cliente: string; saldo: number }>;
};

/** O texto do aviso (o mesmo que a tela mostra em partes). */
export function textoDoResumo(r: ResumoDaSemana): string {
  const total = r.novas.pesquisa + r.novas.materiais + r.novas.numeros + r.novas.concorrentes;
  const origem = [
    r.novas.pesquisa ? `${r.novas.pesquisa} da pesquisa` : "",
    r.novas.materiais ? `${r.novas.materiais} do que você mandou` : "",
    r.novas.numeros ? `${r.novas.numeros} dos posts que renderam` : "",
    r.novas.concorrentes ? `${r.novas.concorrentes} dos concorrentes e referências` : "",
  ].filter(Boolean).join(", ");
  const partes = [
    `Base dos agentes na semana: ${total} ${total === 1 ? "técnica nova" : "técnicas novas"}${origem ? ` (${origem})` : ""}`,
    r.sairam ? `${r.sairam} ${r.sairam === 1 ? "ficha saiu" : "fichas saíram"} por atrapalhar` : "",
    r.referenciasLidas ? `${r.referenciasLidas} ${r.referenciasLidas === 1 ? "referência de design lida" : "referências de design lidas"}` : "",
  ].filter(Boolean);
  const carteiras = r.carteirasBaixas.length
    ? ` Carteira baixa (pesquisa e leitura param): ${r.carteirasBaixas.slice(0, 6).map((c) => `${c.cliente} US$ ${c.saldo.toFixed(2).replace(".", ",")}`).join(", ")}${r.carteirasBaixas.length > 6 ? ` e mais ${r.carteirasBaixas.length - 6}` : ""}.`
    : "";
  return `${partes.join("; ")}.${carteiras}`;
}

async function resumoDaSemana(): Promise<ResumoDaSemana> {
  const desde = diasAtras(7);
  const { data: fichas } = await servico().from("agente_base_fichas").select("fonte_id, criado_em").gte("criado_em", desde).limit(3000);
  const fonteIds = [...new Set(((fichas || []) as Array<{ fonte_id: string | null }>).map((f) => f.fonte_id).filter(Boolean) as string[])];
  const fontes = new Map<string, { tipo: string; nome: string }>();
  for (const ids of emPedacos(fonteIds)) {
    const { data } = await servico().from("agente_base_fontes").select("id, tipo, nome").in("id", ids);
    for (const f of (data || []) as Array<{ id: string; tipo: string; nome: string }>) fontes.set(f.id, f);
  }
  const novas = { pesquisa: 0, materiais: 0, numeros: 0, concorrentes: 0 };
  for (const f of (fichas || []) as Array<{ fonte_id: string | null }>) {
    const fonte = f.fonte_id ? fontes.get(f.fonte_id) : undefined;
    if (fonte?.tipo === "pesquisa") novas.pesquisa += 1;
    else if (fonte?.nome.indexOf("Números do Instagram") === 0) novas.numeros += 1;
    else if (fonte?.nome.indexOf("Concorrentes e referências") === 0) novas.concorrentes += 1;
    else novas.materiais += 1;
  }
  const { data: comResultado } = await servico().from("agente_base_fichas").select("aprovadas, ajustadas, reprovadas, posts, multiplo").eq("ativa", true).not("resultado_em", "is", null).limit(3000);
  const sairam = ((comResultado || []) as Array<{ aprovadas: number; ajustadas: number; reprovadas: number; posts: number; multiplo: number | string | null }>)
    .filter((f) => deveSair({ aprovadas: f.aprovadas, ajustadas: f.ajustadas, reprovadas: f.reprovadas, posts: f.posts, multiplo: f.multiplo === null ? null : Number(f.multiplo) })).length;
  const { count: lidas } = await servico().from("ia_usos").select("id", { count: "exact", head: true }).eq("tarefa", "leitura_referencia").eq("referencia_tipo", "cliente_referencia").gte("criado_em", desde);
  // Carteira baixa só de quem usou IA nos últimos 30 dias (cliente parado não precisa de aviso).
  const { data: usos } = await servico().from("ia_usos").select("client_id").gte("criado_em", diasAtras(30)).limit(5000);
  const ativos = [...new Set(((usos || []) as Array<{ client_id: string }>).map((u) => u.client_id))];
  const carteirasBaixas: ResumoDaSemana["carteirasBaixas"] = [];
  for (const ids of emPedacos(ativos)) {
    const { data: cs } = await servico().from("ia_carteiras").select("client_id, saldo_usd").in("client_id", ids).lt("saldo_usd", CARTEIRA_BAIXA);
    const lista = (cs || []) as Array<{ client_id: string; saldo_usd: number | string }>;
    if (!lista.length) continue;
    const { data: nomes } = await servico().from("profiles").select("id, company_name, full_name").in("id", lista.map((c) => c.client_id));
    const nome = new Map(((nomes || []) as Array<{ id: string; company_name: string | null; full_name: string | null }>).map((p) => [p.id, p.company_name || p.full_name || "Cliente"]));
    for (const c of lista) carteirasBaixas.push({ cliente: nome.get(c.client_id) || "Cliente", saldo: Number(c.saldo_usd) || 0 });
  }
  carteirasBaixas.sort((a, b) => a.saldo - b.saldo);
  return { novas, sairam, referenciasLidas: lidas ?? 0, carteirasBaixas };
}

/** O aviso da semana para o admin e o gestor (no sininho do painel, com link para a Base dos agentes). */
async function avisarResumoDaSemana(): Promise<void> {
  const r = await resumoDaSemana();
  const { data } = await servico().from("user_roles").select("user_id").in("role", ["admin", "manager"]);
  const alvos = [...new Set(((data || []) as Array<{ user_id: string }>).map((x) => x.user_id))];
  if (!alvos.length) return;
  const { error } = await servico().from("notifications").insert(alvos.map((u) => ({ user_id: u, message: textoDoResumo(r), notification_type: "base_dos_agentes", link: "/base-dos-agentes" })));
  if (error) console.error("[base-dos-agentes] aviso da semana não gravado", { code: error.code });
}

async function resumoParaATela(_ch: Chamador) {
  const r = await resumoDaSemana();
  return json({ ok: true, ...r, texto: textoDoResumo(r) });
}

async function aprenderAgora(_ch: Chamador) {
  return json({ ok: true, ...(await aprenderComResultados()) });
}

// ------------------------------------------------------------------ servidor

const ACOES: Record<string, (ch: Chamador, corpo: Record<string, unknown>) => Promise<Response>> = {
  ensinar,
  pesquisar,
  nova_ficha: novaFicha,
  editar_ficha: editarFicha,
  apagar_ficha: apagarFicha,
  apagar_fonte: apagarFonte,
  aprender_com_resultados: aprenderAgora,
  resumo_da_semana: resumoParaATela,
  faxina: async () => json({ ok: true, ...(await faxinaDaBase(await carteiraDaAgencia())) }),
  // 17/10 (rodada 4): o painel de evolução do cliente (aprovação de primeira, rodadas, posts e Ads por mês).
  evolucao: async (_ch, corpo) => {
    const clientId = uuidOuNulo(corpo.client_id);
    if (!clientId) throw new ErroHttp(400, "cliente_invalido", "Escolha um cliente.");
    try {
      return json({ ok: true, meses: await evolucaoDoCliente(servico(), clientId, new Date()) });
    } catch (err) {
      console.error("[base-dos-agentes] evolução falhou", err instanceof Error ? err.message : err);
      throw new ErroHttp(503, "evolucao_indisponivel", "Não foi possível montar a evolução agora.");
    }
  },
};
const ACOES_LONGAS = new Set(["ensinar", "pesquisar", "aprender_com_resultados", "faxina"]);

function respostaDeErro(err: unknown): Response {
  if (err instanceof ErroHttp) return json({ error: err.codigo, mensagem: err.message }, err.status);
  if (err instanceof IaMotorErro) return json(err.paraJson(), err.status >= 400 ? err.status : 500);
  console.error("[base-dos-agentes] erro inesperado", err instanceof Error ? err.message.slice(0, 200) : "");
  return json({ error: "erro_interno", mensagem: "Falha inesperada na base dos agentes." }, 500);
}

if (import.meta.main) {
  Deno.serve(async (req) => {
    if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
    if (req.method !== "POST") return json({ error: "metodo_nao_permitido", mensagem: "Use POST." }, 405);
    try {
      let corpo: Record<string, unknown> = {};
      try {
        corpo = await req.json();
      } catch { /* corpo vazio */ }
      const acao = String(corpo.acao ?? "");
      if (acao === "pesquisa_semanal") {
        if (!ehCron(req)) return json({ error: "somente_cron", mensagem: "A pesquisa semanal é só do agendamento." }, 403);
        return respostaComFolego(async () => {
          try {
            return await pesquisaSemanal();
          } catch (err) {
            return respostaDeErro(err);
          }
        }, corsHeaders);
      }
      const ch = await identificar(req);
      const fn = ACOES[acao];
      if (!fn) return json({ error: "acao_desconhecida", mensagem: "Ação desconhecida.", aceitas: Object.keys(ACOES) }, 400);
      const rodar = async () => {
        try {
          return await fn(ch, corpo);
        } catch (err) {
          return respostaDeErro(err);
        }
      };
      return ACOES_LONGAS.has(acao) ? respostaComFolego(rodar, corsHeaders) : await rodar();
    } catch (err) {
      return respostaDeErro(err);
    }
  });
}
