/**
 * Lead do formulário da Meta (Lead Ads) no CRM da empresa (14/11/2026, rodada 3).
 *
 * O que mora aqui: a conferência da assinatura do webhook, a leitura do corpo que a Meta manda,
 * a decisão de tratar ou não cada aviso, a normalização das respostas do formulário para o formato
 * que a pontuação entende (_shared/pontuacao-do-crm.ts) e o lead de teste do botão "Simular lead".
 *
 * Conferido na documentação da Meta em 13/11/2026:
 *   Webhooks de leadgen: { object: "page", entry: [{ id, time, changes: [{ field: "leadgen",
 *     value: { leadgen_id, page_id, form_id, adgroup_id, ad_id, created_time } }] }] }
 *   Leitura do lead: GET https://graph.facebook.com/{versão}/{leadgen_id}?fields=...
 *     field_data = [{ name, values: [..] }]
 *   Assinatura: cabeçalho X-Hub-Signature-256 = "sha256=" + HMAC SHA-256 do corpo cru com o segredo do app.
 *
 * Puro: sem Deno, sem npm, sem rede e sem banco. Só usa crypto.subtle e TextEncoder, que existem no
 * navegador, no Deno e no Node. Nada aqui registra ou devolve token ou segredo.
 */
import { normalizarEmail, normalizarTelefone, semSegredo } from "./conversoes-da-meta.ts";
import type { Faixa, ResultadoDaPontuacao } from "./pontuacao-do-crm.ts";

// ---------------------------------------------------------------------------
// 1. Assinatura do webhook
// ---------------------------------------------------------------------------

const hex = (bytes: ArrayBuffer): string => Array.from(new Uint8Array(bytes)).map((b) => b.toString(16).padStart(2, "0")).join("");

const emBytes = (corpo: string | ArrayBuffer | Uint8Array): Uint8Array =>
  typeof corpo === "string" ? new TextEncoder().encode(corpo) : corpo instanceof Uint8Array ? corpo : new Uint8Array(corpo);

/** O valor do cabeçalho X-Hub-Signature-256 para um corpo e um segredo ("sha256=<hex>"). */
export async function assinarCorpo(corpoCru: string | ArrayBuffer | Uint8Array, segredo: string): Promise<string> {
  const chave = await crypto.subtle.importKey("raw", new TextEncoder().encode(segredo) as BufferSource, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return "sha256=" + hex(await crypto.subtle.sign("HMAC", chave, emBytes(corpoCru) as BufferSource));
}

/** Compara dois textos sem parar no primeiro caractere diferente. */
export function iguaisEmTempoConstante(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diferenca = 0;
  for (let i = 0; i < a.length; i += 1) diferenca |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diferenca === 0;
}

/**
 * Confere o X-Hub-Signature-256 contra o corpo CRU (os bytes que chegaram, antes de qualquer JSON.parse).
 * Sem segredo, sem cabeçalho ou com cabeçalho malformado: falso.
 */
export async function assinaturaConfere(corpoCru: string | ArrayBuffer | Uint8Array, cabecalho: string | null | undefined, segredo: string | null | undefined): Promise<boolean> {
  const recebida = typeof cabecalho === "string" ? cabecalho.trim().toLowerCase() : "";
  if (!segredo || !/^sha256=[0-9a-f]{64}$/.test(recebida)) return false;
  return iguaisEmTempoConstante(await assinarCorpo(corpoCru, segredo), recebida);
}

// ---------------------------------------------------------------------------
// 2. O corpo do webhook
// ---------------------------------------------------------------------------

export interface AvisoDeLead {
  leadgen_id: string;
  form_id: string | null;
  page_id: string | null;
  ad_id: string | null;
  adgroup_id: string | null;
  /** Segundos desde 1970, como a Meta manda. */
  created_time: number | null;
}

export interface CorpoDoWebhook {
  objeto: string;
  leads: AvisoDeLead[];
  /** As entradas de object = whatsapp_business_account, como chegaram (quem interpreta é o módulo do WhatsApp). */
  whatsapp: unknown[];
}

/** No máximo de avisos tratados por chamada (a Meta manda um ou poucos; o resto ela reenvia). */
export const TETO_DE_AVISOS = 50;

const objeto = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** Identificador da Meta: só dígitos. Número só vale quando cabe inteiro sem perder dígito. */
export function idDaMeta(v: unknown): string | null {
  if (typeof v === "number") return Number.isSafeInteger(v) && v > 0 ? String(v) : null;
  const t = typeof v === "string" ? v.trim() : "";
  return /^[0-9]{3,25}$/.test(t) ? t : null;
}

/** Lê o corpo do webhook sem confiar no formato. Aviso sem leadgen_id válido ou repetido no mesmo corpo fica de fora. */
export function lerWebhook(corpo: unknown): CorpoDoWebhook {
  const o = objeto(corpo);
  const tipo = typeof o.object === "string" ? o.object : "";
  const entradas = Array.isArray(o.entry) ? (o.entry as unknown[]) : [];
  const saida: CorpoDoWebhook = { objeto: tipo, leads: [], whatsapp: [] };
  if (tipo === "whatsapp_business_account") {
    saida.whatsapp = entradas.slice(0, 100);
    return saida;
  }
  if (tipo !== "page") return saida;
  const vistos: Record<string, boolean> = {};
  entradas.forEach((entrada) => {
    const e = objeto(entrada);
    const mudancas = Array.isArray(e.changes) ? (e.changes as unknown[]) : [];
    mudancas.forEach((mudanca) => {
      const m = objeto(mudanca);
      if (m.field !== "leadgen") return;
      const v = objeto(m.value);
      const id = idDaMeta(v.leadgen_id);
      if (!id || id.length < 5 || vistos[id] || saida.leads.length >= TETO_DE_AVISOS) return;
      vistos[id] = true;
      const criado = Math.floor(Number(v.created_time));
      saida.leads.push({
        leadgen_id: id,
        form_id: idDaMeta(v.form_id),
        page_id: idDaMeta(v.page_id) || idDaMeta(e.id),
        ad_id: idDaMeta(v.ad_id),
        adgroup_id: idDaMeta(v.adgroup_id),
        created_time: isFinite(criado) && criado > 0 ? criado : null,
      });
    });
  });
  return saida;
}

/** A conferência do endereço que a Meta faz ao salvar o webhook (GET com hub.mode, hub.verify_token, hub.challenge). */
export function conferirDesafio(busca: { get(nome: string): string | null }, verifyToken: string | null | undefined): { ok: boolean; desafio: string } {
  const modo = busca.get("hub.mode") || "";
  const recebido = busca.get("hub.verify_token") || "";
  const desafio = (busca.get("hub.challenge") || "").slice(0, 200);
  const ok = modo === "subscribe" && !!verifyToken && iguaisEmTempoConstante(recebido, verifyToken) && desafio.length > 0;
  return { ok, desafio: ok ? desafio : "" };
}

// ---------------------------------------------------------------------------
// 3. Tratar ou não cada aviso
// ---------------------------------------------------------------------------

export type OrigemDoAviso = "ok" | "outra_pagina" | "outro_formulario";

/** O aviso é da Página e de um formulário da empresa? Sem Página salva vale qualquer uma; lista vazia de formulários = todos. */
export function conferirOrigem(aviso: Pick<AvisoDeLead, "page_id" | "form_id">, conexao: { pagina_id?: string | null; formularios?: string[] | null }): OrigemDoAviso {
  const pagina = conexao.pagina_id ? String(conexao.pagina_id).trim() : "";
  if (pagina && aviso.page_id !== pagina) return "outra_pagina";
  const lista = Array.isArray(conexao.formularios) ? conexao.formularios.filter((f) => typeof f === "string" && f.trim() !== "") : [];
  if (lista.length && (!aviso.form_id || lista.indexOf(aviso.form_id) < 0)) return "outro_formulario";
  return "ok";
}

export interface RegistroDoAviso {
  /** O que crm_meta_lead_registrar devolveu: é a primeira vez que este leadgen_id chega nesta empresa? */
  novo: boolean;
  situacao?: string | null;
  lead_id?: string | null;
  criado_em?: string | null;
}

/** Depois de quanto tempo um aviso que ficou em "recebido" (a função caiu no meio) pode ser tratado de novo. */
export const ESPERA_DO_RECEBIDO_MS = 60_000;

/**
 * A Meta repete o mesmo aviso. Decide se este segue ou para:
 *   novo                                   segue;
 *   já virou negócio, foi ignorado ou repetido   para;
 *   deu erro antes e não virou negócio       segue (a nova entrega é a nova tentativa);
 *   ficou em "recebido" há mais de um minuto  segue (a função caiu no meio da primeira vez).
 */
export function decidirRegistro(r: RegistroDoAviso, agoraMs: number = Date.now()): "processar" | "repetido" {
  if (r.novo) return "processar";
  if (r.lead_id) return "repetido";
  if (r.situacao === "erro") return "processar";
  if (r.situacao === "recebido") {
    const criado = r.criado_em ? new Date(r.criado_em).getTime() : NaN;
    return isFinite(criado) && agoraMs - criado > ESPERA_DO_RECEBIDO_MS ? "processar" : "repetido";
  }
  return "repetido";
}

// ---------------------------------------------------------------------------
// 4. A leitura do lead na Graph API (só o formato: a chamada fica na função)
// ---------------------------------------------------------------------------

/** Os campos pedidos em GET /{leadgen_id}. Se a Meta recusar algum, a função repete só com os básicos. */
export const CAMPOS_DO_LEAD = ["id", "created_time", "ad_id", "ad_name", "adset_id", "adset_name", "campaign_id", "campaign_name", "form_id", "platform", "is_organic", "field_data"];
export const CAMPOS_BASICOS_DO_LEAD = ["id", "created_time", "ad_id", "form_id", "field_data"];

/** O endereço da leitura do lead. O token NÃO vai no endereço: vai no cabeçalho Authorization. */
export function enderecoDoLead(leadgenId: string, versao: string, campos: string[] = CAMPOS_DO_LEAD): string {
  if (!/^[0-9]{5,25}$/.test(leadgenId)) throw new Error("leadgen invalido");
  if (!/^v[0-9]{1,3}\.[0-9]$/.test(versao)) throw new Error("versao invalida");
  return `https://graph.facebook.com/${versao}/${leadgenId}?fields=${campos.join(",")}`;
}

export interface ErroDaGraph {
  /** Não adianta a Meta reenviar: precisa de gente (token, permissão) ou o lead não existe. */
  definitivo: boolean;
  /** A Meta recusou um dos campos pedidos: vale repetir só com os básicos. */
  campoRecusado: boolean;
  erro: string;
}

/** Lê uma resposta de erro da Graph API e devolve uma frase curta, sem token. */
export function lerErroDaGraph(status: number, corpo: unknown, token = ""): ErroDaGraph {
  const erro = objeto(objeto(corpo).error);
  const codigo = Number(erro.code);
  const mensagem = semSegredo(String(erro.message || ""), token);
  if (codigo === 190 || codigo === 102 || status === 401) {
    return { definitivo: true, campoRecusado: false, erro: "A Meta recusou o token da Página. Gere um novo e salve de novo." };
  }
  if (codigo === 10 || codigo === 200 || codigo === 3 || status === 403) {
    return { definitivo: true, campoRecusado: false, erro: "O token não tem permissão para ler os leads (leads_retrieval) desta Página." };
  }
  if (status === 429 || status >= 500 || [1, 2, 4, 17, 32, 341, 613, 80004, 80005].indexOf(codigo) >= 0 || erro.is_transient === true) {
    return { definitivo: false, campoRecusado: false, erro: mensagem || "A Meta não respondeu agora." };
  }
  if (codigo === 100 && /nonexisting field|field/i.test(mensagem) && !/does not exist|missing permissions/i.test(mensagem)) {
    return { definitivo: true, campoRecusado: true, erro: mensagem || "A Meta recusou um dos campos pedidos." };
  }
  if (codigo === 100 || status === 404) {
    return { definitivo: true, campoRecusado: false, erro: "A Meta não achou esse lead com o token salvo. Confira se o token enxerga a Página." };
  }
  return { definitivo: true, campoRecusado: false, erro: mensagem || `A Meta recusou a leitura do lead (${status}).` };
}

export interface OrigemDoLead {
  form_id?: string;
  form_name?: string;
  ad_id?: string;
  ad_name?: string;
  adset_id?: string;
  campaign_id?: string;
  campaign_name?: string;
  plataforma?: string;
}

const texto = (v: unknown, max: number): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

/** De onde o lead veio, juntando o aviso do webhook e a resposta da Graph API. Só entra o que existe. */
export function origemDoLead(lead: unknown, aviso?: Partial<AvisoDeLead> | null, nomeDoFormulario?: string | null): OrigemDoLead {
  const l = objeto(lead);
  const a = aviso || {};
  const plataforma = texto(l.platform, 20).toLowerCase();
  const o: OrigemDoLead = {};
  const por = (chave: keyof OrigemDoLead, valor: string | null | undefined) => {
    if (valor) o[chave] = valor;
  };
  por("form_id", idDaMeta(l.form_id) || a.form_id);
  por("form_name", texto(nomeDoFormulario, 150));
  por("ad_id", idDaMeta(l.ad_id) || a.ad_id);
  por("ad_name", texto(l.ad_name, 150));
  por("adset_id", idDaMeta(l.adset_id) || a.adgroup_id);
  por("campaign_id", idDaMeta(l.campaign_id));
  por("campaign_name", texto(l.campaign_name, 150));
  por("plataforma", plataforma === "fb" ? "facebook" : plataforma === "ig" ? "instagram" : plataforma.replace(/[^a-z0-9_]/g, ""));
  return o;
}

// ---------------------------------------------------------------------------
// 5. As respostas do formulário viram nome, contato e respostas pontuáveis
// ---------------------------------------------------------------------------

export interface CampoDoFormulario {
  name: string;
  values: string[];
}

export interface LeadNormalizado {
  nome: string;
  /** Só números, com o 55 quando faltar. Nulo quando o formulário não trouxe telefone válido. */
  whatsapp: string | null;
  email: string | null;
  /** O que a pontuação lê: bem, valor_carta, parcela, prazo, lance, renda e as perguntas próprias pela chave. */
  respostas: Record<string, string | number>;
  /** Os campos do ramo no negócio (src/lib/produto/nichos.ts): tipo_de_bem, prazo_meses, lance. */
  campos: Record<string, string | number>;
  /** O que não tem campo próprio, uma linha por pergunta: "Pergunta: resposta". */
  notas: string;
}

/** Minúsculas e sem acento (pela faixa de combinantes, sem classe Unicode, que o Safari antigo não tem). */
export function semAcento(v: unknown): string {
  return String(v === null || v === undefined ? "" : v).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Só letras, números e espaço simples: é assim que as palavras-chave são procuradas. */
const emPalavras = (v: unknown): string => semAcento(v).replace(/[^a-z0-9]+/g, " ").trim();

/** A chave de uma pergunta própria: "Qual é a sua cidade?" vira "qual_e_a_sua_cidade". */
export function chaveDaResposta(pergunta: unknown): string {
  return emPalavras(pergunta).replace(/ /g, "_").replace(/^[0-9_]+/, "").slice(0, 40).replace(/_+$/, "");
}

/** Lê o field_data sem confiar no formato: até 40 perguntas, resposta com até 300 caracteres. */
export function lerFieldData(bruto: unknown): CampoDoFormulario[] {
  const lista = Array.isArray(bruto) ? (bruto as unknown[]) : [];
  const saida: CampoDoFormulario[] = [];
  lista.slice(0, 40).forEach((item) => {
    const o = objeto(item);
    const nome = texto(o.name, 150);
    const valores = (Array.isArray(o.values) ? (o.values as unknown[]) : o.values === undefined || o.values === null ? [] : [o.values])
      .map((v) => (typeof v === "string" || typeof v === "number" ? String(v).replace(/\s+/g, " ").trim().slice(0, 300) : ""))
      .filter((v) => v !== "");
    if (nome && valores.length) saida.push({ name: nome, values: valores.slice(0, 10) });
  });
  return saida;
}

function numeroBr(bruto: string): number {
  let x = bruto.replace(/[.,]+$/, "");
  if (x.indexOf(",") >= 0 && x.indexOf(".") >= 0) x = x.lastIndexOf(",") > x.lastIndexOf(".") ? x.replace(/\./g, "").replace(",", ".") : x.replace(/,/g, "");
  else if (x.indexOf(",") >= 0) x = /^\d{1,3}(,\d{3})+$/.test(x) ? x.replace(/,/g, "") : x.replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(x)) x = x.replace(/\./g, "");
  return Number(x);
}

/**
 * Um valor em reais escrito de qualquer jeito: "R$ 150.000,00", "150 mil", "80k", "1,5 milhão".
 * Faixa escrita vira o ponto médio: "R$ 100 a 200 mil" e "de_100_mil_a_200_mil" dão 150000.
 * Número seguido de "x" ou "vezes" é quantidade de parcelas e não entra. Nulo quando não há número.
 */
export function lerValor(bruto: unknown): number | null {
  if (typeof bruto === "number") return isFinite(bruto) && bruto >= 0 ? bruto : null;
  const t = semAcento(bruto).replace(/_/g, " ").replace(/r\$/g, " ");
  const achados: Array<{ n: number; vezes: number }> = [];
  const re = /(\d[\d.,]*)\s*(milhoes|milhao|mil|mi|k|x|vezes)?(?![a-z0-9])/g;
  let m = re.exec(t);
  while (m && achados.length < 4) {
    const unidade = m[2] || "";
    const n = numeroBr(m[1]);
    if (isFinite(n) && unidade !== "x" && unidade !== "vezes") {
      achados.push({ n, vezes: unidade === "mil" || unidade === "k" ? 1000 : unidade ? 1000000 : 1 });
    }
    m = re.exec(t);
  }
  if (!achados.length) return null;
  // "100 a 200 mil": o primeiro número pega a unidade do segundo.
  if (achados.length >= 2 && achados[0].vezes === 1 && achados[1].vezes > 1 && achados[0].n < 1000) achados[0].vezes = achados[1].vezes;
  const primeiro = achados[0].n * achados[0].vezes;
  const valor = achados.length >= 2 ? (primeiro + achados[1].n * achados[1].vezes) / 2 : primeiro;
  return Math.min(Math.round(valor * 100) / 100, 9999999999);
}

export type BemDoConsorcio = "imovel" | "carro" | "moto" | "pesados" | "servicos" | "outros";

/** O bem pela palavra: casa e apartamento são imóvel, caminhão é pesados, viagem e reforma são serviços. */
export function lerBem(bruto: unknown): BemDoConsorcio | null {
  const t = emPalavras(bruto);
  if (!t) return null;
  if (/\b(caminhao|caminhoes|pesado|pesados|trator|tratores|maquina|maquinas|onibus|carreta|implemento|implementos)\b/.test(t)) return "pesados";
  if (/\b(moto|motos|motocicleta|motocicletas)\b/.test(t)) return "moto";
  if (/\b(carro|carros|automovel|automoveis|auto|veiculo|veiculos|suv|picape|caminhonete)\b/.test(t)) return "carro";
  if (/\b(imovel|imoveis|casa|casas|apartamento|apto|terreno|lote|construcao|construir|sitio|chacara)\b/.test(t)) return "imovel";
  if (/\b(servico|servicos|viagem|viagens|cirurgia|festa|casamento|reforma|estudo|estudos|curso|intercambio)\b/.test(t)) return "servicos";
  return "outros";
}

export type PrazoDoConsorcio = "menos_de_3_meses" | "de_3_a_12_meses" | "mais_de_12_meses";

/**
 * Em quanto tempo a pessoa pretende usar: "Menos de 3 meses", "de_3_a_12_meses", "1 a 2 anos", "agora".
 * Devolve a chave da regra e, quando a resposta tem número, os meses (ponto médio da faixa).
 */
export function lerPrazo(bruto: unknown): { chave: PrazoDoConsorcio; meses: number | null } | null {
  const t = emPalavras(bruto);
  if (!t) return null;
  const achados: Array<{ n: number; vezes: number | null }> = [];
  const re = /(\d+(?:[.,]\d+)?)\s*(anos|ano|meses|mes|semanas|semana|dias|dia)?(?![a-z0-9])/g;
  const corrido = semAcento(bruto).replace(/_/g, " ");
  let m = re.exec(corrido);
  while (m && achados.length < 3) {
    const u = m[2] || "";
    const n = Number(m[1].replace(",", "."));
    if (isFinite(n)) achados.push({ n, vezes: !u ? null : u.indexOf("ano") === 0 ? 12 : u.indexOf("mes") === 0 ? 1 : u.indexOf("semana") === 0 ? 7 / 30 : 1 / 30 });
    m = re.exec(corrido);
  }
  if (achados.length) {
    // Número sem unidade pega a do vizinho ("3 a 12 meses"); sem nenhuma, são meses.
    const comUnidade = achados.filter((a) => a.vezes !== null)[0];
    const emMeses = achados.slice(0, 2).map((a) => a.n * (a.vezes !== null ? a.vezes : comUnidade && comUnidade.vezes !== null ? comUnidade.vezes : 1));
    let meses = emMeses.length >= 2 ? (emMeses[0] + emMeses[1]) / 2 : emMeses[0];
    if (emMeses.length === 1) {
      if (/\b(menos de|ate|dentro de|antes de|no maximo)\b/.test(t)) meses -= 0.01;
      else if (/\b(mais de|acima de|a partir de|depois de|no minimo)\b/.test(t)) meses += 0.01;
    }
    return { chave: meses < 3 ? "menos_de_3_meses" : meses <= 12 ? "de_3_a_12_meses" : "mais_de_12_meses", meses: Math.max(0, Math.round(meses)) };
  }
  if (/\b(imediato|imediatamente|agora|urgente|ja|hoje|o quanto antes|este mes|esse mes|esta semana|essa semana|curto prazo)\b/.test(t)) return { chave: "menos_de_3_meses", meses: null };
  if (/\b(medio prazo|este ano|esse ano|ainda este ano|ainda esse ano)\b/.test(t)) return { chave: "de_3_a_12_meses", meses: null };
  if (/\b(sem pressa|longo prazo|futuro|planejando|planejamento|sem previsao|ano que vem|proximo ano|mais para frente|mais pra frente)\b/.test(t)) return { chave: "mais_de_12_meses", meses: null };
  return null;
}

/** Tem lance ou entrada: "Sim", "Não tenho", "Tenho R$ 20 mil", "FGTS". O valor, quando vem, vai junto. */
export function lerLance(bruto: unknown): { chave: "sim" | "nao"; valor: number | null } | null {
  const t = emPalavras(bruto);
  if (!t) return null;
  if (/\b(nao|sem|nenhum|nenhuma|nada)\b/.test(t)) return { chave: "nao", valor: null };
  const valor = /\d/.test(t) ? lerValor(bruto) : null;
  if (valor !== null) return valor > 0 ? { chave: "sim", valor } : { chave: "nao", valor: null };
  if (/\b(sim|s|tenho|possuo|claro|com|fgts|yes|consigo)\b/.test(t)) return { chave: "sim", valor: null };
  return null;
}

type CampoConhecido = "nome" | "primeiro_nome" | "sobrenome" | "telefone" | "email" | "renda" | "parcela" | "lance" | "prazo" | "valor_carta" | "bem";

/** Quem a pessoa é: vale para todo ramo. */
function campoDeContato(pergunta: string): CampoConhecido | null {
  if (/^(full name|nome|nome completo|seu nome|seu nome completo|qual e o seu nome|qual o seu nome|qual seu nome|name)$/.test(pergunta)) return "nome";
  if (pergunta === "first name" || pergunta === "primeiro nome") return "primeiro_nome";
  if (pergunta === "last name" || pergunta === "sobrenome") return "sobrenome";
  if (/\b(phone|telefone|whatsapp|whats|celular|fone)\b/.test(pergunta)) return "telefone";
  if (/\b(email|e mail)\b/.test(pergunta)) return "email";
  return null;
}

/** As perguntas do consórcio, pela palavra-chave. A ordem importa: "Tem valor para lance?" é lance, não valor. */
function campoDoConsorcio(pergunta: string): CampoConhecido | null {
  if (/\b(renda|salario|ganha|faturamento)\b/.test(pergunta)) return "renda";
  if (/\b(parcela|parcelas|mensalidade|prestacao|por mes|mensal|cabe no bolso)\b/.test(pergunta)) return "parcela";
  if (/\b(lance|entrada|fgts)\b/.test(pergunta)) return "lance";
  if (/\b(prazo|quando|quanto tempo|urgencia|pretende usar)\b/.test(pergunta)) return "prazo";
  if (/\btipo\b/.test(pergunta) && /\b(carta|consorcio|bem|credito)\b/.test(pergunta)) return "bem";
  if (/\b(carta|credito|valor|quanto)\b/.test(pergunta)) return "valor_carta";
  if (/\b(bem|consorcio|interesse|objetivo|comprar|adquirir|conquistar|sonho)\b/.test(pergunta)) return "bem";
  return null;
}

/** "qual_bem_você_quer?" vira "Qual bem você quer" para a linha das notas. */
function perguntaLegivel(nome: string): string {
  const t = nome.replace(/_/g, " ").replace(/\s+/g, " ").replace(/[?:\s]+$/, "").trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : "Pergunta";
}

const TETO_DAS_NOTAS = 1800;
const TETO_DE_RESPOSTAS = 30;

/**
 * Transforma as respostas do formulário da Meta no que o CRM guarda e pontua.
 * Consórcio: reconhece bem, valor da carta, parcela, prazo, lance e renda por palavra-chave.
 * Outros ramos: só nome, telefone e e-mail; o resto vai para as notas e para `respostas` pela chave da pergunta.
 */
export function normalizarLead(fieldData: unknown, opcoes: { nicho?: string | null } = {}): LeadNormalizado {
  const consorcio = opcoes.nicho === "consorcio";
  const saida: LeadNormalizado = { nome: "", whatsapp: null, email: null, respostas: {}, campos: {}, notas: "" };
  const notas: string[] = [];
  let primeiro = "";
  let sobrenome = "";

  const anotar = (pergunta: string, resposta: string) => {
    notas.push(`${perguntaLegivel(pergunta)}: ${resposta}`);
  };
  const responder = (chave: string, valor: string | number) => {
    if (!chave || chave in saida.respostas || Object.keys(saida.respostas).length >= TETO_DE_RESPOSTAS) return;
    saida.respostas[chave] = valor;
  };
  /** Pergunta própria: fica legível nas notas e entra em `respostas` pela chave, para regra que a empresa criar. */
  const propria = (c: CampoDoFormulario, resposta: string) => {
    anotar(c.name, resposta);
    const numero = /^\s*(r\$)?\s*\d/.test(semAcento(resposta)) ? lerValor(resposta) : null;
    const curta = chaveDaResposta(resposta);
    responder(chaveDaResposta(c.name), numero !== null ? numero : resposta.length <= 40 && curta ? curta : resposta.slice(0, 200));
  };

  lerFieldData(fieldData).forEach((c) => {
    const pergunta = emPalavras(c.name);
    const resposta = c.values.join(", ");
    const campo = campoDeContato(pergunta) || (consorcio ? campoDoConsorcio(pergunta) : null);

    if (campo === "nome" && !saida.nome) saida.nome = resposta.slice(0, 120);
    else if (campo === "primeiro_nome" && !primeiro) primeiro = resposta;
    else if (campo === "sobrenome" && !sobrenome) sobrenome = resposta;
    else if (campo === "telefone" && !saida.whatsapp && normalizarTelefone(resposta)) saida.whatsapp = normalizarTelefone(resposta);
    else if (campo === "email" && !saida.email && normalizarEmail(resposta)) saida.email = normalizarEmail(resposta);
    else if (campo === "bem" && !("bem" in saida.respostas) && lerBem(resposta)) {
      const bem = lerBem(resposta) as BemDoConsorcio;
      saida.respostas.bem = bem;
      saida.campos.tipo_de_bem = bem;
      if (bem === "outros") anotar(c.name, resposta);
    } else if ((campo === "valor_carta" || campo === "parcela" || campo === "renda") && !(campo in saida.respostas) && lerValor(resposta) !== null) {
      saida.respostas[campo] = lerValor(resposta) as number;
      // A renda não tem campo no negócio: fica também nas notas, para o vendedor ler.
      if (campo === "renda") anotar(c.name, resposta);
    } else if (campo === "prazo" && !("prazo" in saida.respostas) && lerPrazo(resposta)) {
      const prazo = lerPrazo(resposta) as { chave: PrazoDoConsorcio; meses: number | null };
      saida.respostas.prazo = prazo.chave;
      if (prazo.meses !== null) saida.campos.prazo_meses = prazo.meses;
      anotar(c.name, resposta);
    } else if (campo === "lance" && !("lance" in saida.respostas) && lerLance(resposta)) {
      const lance = lerLance(resposta) as { chave: "sim" | "nao"; valor: number | null };
      saida.respostas.lance = lance.chave;
      if (lance.valor !== null) saida.campos.lance = lance.valor;
      else anotar(c.name, resposta);
    } else if (campo) {
      // Pergunta conhecida com resposta que não deu para ler (ou repetida): só nas notas, para o robô poder perguntar de novo.
      anotar(c.name, resposta);
    } else propria(c, resposta);
  });

  if (!saida.nome) saida.nome = `${primeiro} ${sobrenome}`.replace(/\s+/g, " ").trim().slice(0, 120);
  saida.nome = saida.nome.replace(/\s+/g, " ").trim();
  let usado = 0;
  saida.notas = notas
    .filter((linha) => {
      usado += linha.length + 1;
      return usado <= TETO_DAS_NOTAS;
    })
    .join("\n");
  return saida;
}

// ---------------------------------------------------------------------------
// 6. O que vai para crm_meta_lead_criar
// ---------------------------------------------------------------------------

const dinheiro = (v: unknown, teto: number): number => {
  const n = typeof v === "number" ? v : NaN;
  return isFinite(n) && n > 0 ? Math.min(Math.round(n * 100) / 100, teto) : 0;
};

/**
 * O `_dados` de crm_meta_lead_criar: contato, bem (para o rodízio), valores do negócio, campos do ramo,
 * respostas, nota, faixa, motivos e a origem. No consórcio a carta é o valor avulso e a parcela é o mensal.
 */
export function dadosDoNegocio(lead: LeadNormalizado, nota: Pick<ResultadoDaPontuacao, "nota" | "faixa" | "motivos">, origem: OrigemDoLead = {}): Record<string, unknown> {
  const bem = typeof lead.respostas.bem === "string" ? lead.respostas.bem : null;
  return {
    nome: lead.nome,
    whatsapp: lead.whatsapp,
    email: lead.email,
    bem,
    valor_mensal: dinheiro(lead.respostas.parcela, 99999999),
    valor_avulso: dinheiro(lead.respostas.valor_carta !== undefined ? lead.respostas.valor_carta : lead.respostas.valor, 9999999999),
    campos: lead.campos,
    respostas: lead.respostas,
    nota: nota.nota,
    faixa: nota.faixa,
    motivos: nota.motivos.slice(0, 12).map((m) => String(m).slice(0, 120)),
    notas: lead.notas,
    origem,
  };
}

// ---------------------------------------------------------------------------
// 7. Lead de teste (botão "Simular lead")
// ---------------------------------------------------------------------------

export interface LeadDeTeste {
  aviso: AvisoDeLead;
  /** Com o formato da resposta de GET /{leadgen_id} da Graph API. */
  lead: { id: string; created_time: string; ad_name: string; campaign_name: string; form_id: string; platform: string; field_data: CampoDoFormulario[] };
  nomeDoFormulario: string;
}

const NOMES_DE_TESTE = ["Marina Alves", "Paulo Henrique Souza", "Carla Menezes", "Rafael Dias", "Juliana Prado", "Eduardo Lima"];
const BENS_DE_TESTE: Record<BemDoConsorcio, string> = { imovel: "Imóvel", carro: "Carro", moto: "Moto", pesados: "Caminhão ou pesados", servicos: "Serviços", outros: "Outro bem" };

/** O começo do leadgen_id de todo lead simulado. Evento de conversão com esse começo nunca vai para a Meta. */
export const PREFIXO_DE_TESTE = "teste_";
export const ehLeadDeTeste = (leadgenId: unknown): boolean => typeof leadgenId === "string" && leadgenId.indexOf(PREFIXO_DE_TESTE) === 0;

/**
 * Um lead falso e coerente, no formato que a Meta manda. As respostas saem para cair na faixa pedida com as
 * regras padrão do ramo (regra que a empresa mudou pode dar outra faixa: a nota é sempre a de verdade).
 * Telefone e e-mail mudam a cada chamada, para o teste novo não cair como repetido do anterior.
 */
export function leadDeTeste(p: { faixa?: Faixa | null; bem?: string | null; nicho?: string | null; agora?: number } = {}): LeadDeTeste {
  const agora = typeof p.agora === "number" && isFinite(p.agora) ? Math.floor(p.agora) : Date.now();
  const faixa: Faixa = p.faixa === "morno" || p.faixa === "frio" ? p.faixa : "quente";
  const final = String(agora % 10000).padStart(4, "0");
  const nome = "Teste " + NOMES_DE_TESTE[agora % NOMES_DE_TESTE.length];
  const contato: CampoDoFormulario[] = [
    { name: "full_name", values: [nome] },
    { name: "phone_number", values: ["+55479" + String(Math.floor(agora / 10000) % 10000).padStart(4, "0") + final] },
    { name: "email", values: [`teste.${agora.toString(36)}@exemplo.com`] },
  ];
  let perguntas: CampoDoFormulario[];
  if (p.nicho === "consorcio") {
    const bem = lerBem(p.bem) && lerBem(p.bem) !== "outros" ? (lerBem(p.bem) as BemDoConsorcio) : p.bem === "outros" ? "outros" : "imovel";
    const porFaixa = {
      quente: { carta: "R$ 200 a 300 mil", parcela: "R$ 1.800", prazo: "De 3 a 12 meses", lance: "Sim" },
      morno: { carta: "R$ 35.000", parcela: "R$ 600", prazo: "De 3 a 12 meses", lance: "Não" },
      frio: { carta: "R$ 30 mil", parcela: "R$ 250", prazo: "Menos de 3 meses", lance: "Não" },
    }[faixa];
    perguntas = [
      { name: "qual_bem_você_quer?", values: [BENS_DE_TESTE[bem]] },
      { name: "valor_da_carta", values: [porFaixa.carta] },
      { name: "parcela_que_cabe_no_bolso", values: [porFaixa.parcela] },
      { name: "em_quanto_tempo_pretende_usar?", values: [porFaixa.prazo] },
      { name: "tem_valor_para_lance_ou_entrada?", values: [porFaixa.lance] },
    ];
  } else {
    const porFaixa = {
      quente: { valor: "R$ 8.000", prazo: "Agora", decisor: "Sim" },
      morno: { valor: "R$ 3.000", prazo: "Este mês", decisor: "Não" },
      frio: { valor: "R$ 300", prazo: "Sem pressa", decisor: "Não" },
    }[faixa];
    perguntas = [
      { name: "valor", values: [porFaixa.valor] },
      { name: "prazo", values: [porFaixa.prazo] },
      { name: "decisor", values: [porFaixa.decisor] },
    ];
  }
  const id = PREFIXO_DE_TESTE + agora.toString(36) + final;
  return {
    aviso: { leadgen_id: id, form_id: null, page_id: null, ad_id: null, adgroup_id: null, created_time: Math.floor(agora / 1000) },
    lead: { id, created_time: new Date(agora).toISOString(), ad_name: "Anúncio de teste", campaign_name: "Campanha de teste", form_id: "", platform: "fb", field_data: contato.concat(perguntas) },
    nomeDoFormulario: "Formulário de teste",
  };
}
