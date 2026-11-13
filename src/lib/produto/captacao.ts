import { supabase } from "@/integrations/supabase/client";
import {
  UTM_DA_META,
  lerCampos,
  lerFormularioPublico,
  lerPerguntas,
  montarLink,
  type CamposDoFormulario,
  type FormularioPublico,
  type PerguntaDoFormulario,
} from "../../../supabase/functions/_shared/captacao-do-crm";

/**
 * Captação do CRM da empresa: formulários com link público, o relatório de
 * origem dos negócios e a conexão com a Meta (Pixel e API de Conversões).
 * Contrato do banco: supabase/migrations/20261113210000_crm_captacao_e_rastreamento.sql.
 * As regras puras (ler UTM do link, montar o link, validar o envio, normalizar
 * e fazer hash) moram em supabase/functions/_shared, onde o servidor usa as mesmas.
 */
export {
  CAMPO_ISCA,
  CAMPOS_OPCIONAIS,
  LIMITES,
  UTM_DA_META,
  chaveDaPergunta,
  ehRobo,
  lerCampos,
  lerFormularioPublico,
  lerOrigemDaCaptacao,
  lerPerguntas,
  montarLink,
  origemDaUrl,
  validarEnvio,
} from "../../../supabase/functions/_shared/captacao-do-crm";
export type { CampoOpcional, CamposDoFormulario, EnvioValido, FormularioPublico, OrigemDaCaptacao, PedidoDoCampo, PerguntaDoFormulario, ResultadoDoEnvio } from "../../../supabase/functions/_shared/captacao-do-crm";
export { lerRespostaDaMeta, montarEventoDaMeta, montarFbc, normalizarEmail, normalizarNome, normalizarTelefone, sha256Hex } from "../../../supabase/functions/_shared/conversoes-da-meta";

// As tabelas do produto ainda não estão nos tipos gerados do banco.
/* eslint-disable @typescript-eslint/no-explicit-any */
const db = supabase as unknown as { from: (t: string) => any; rpc: (f: string, a?: unknown) => any };

const numero = (v: unknown) => {
  const n = Number(v);
  return isFinite(n) ? n : 0;
};
const lista = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

// ------------------------------------------------------------------ formulários

export const ETAPAS_DE_ENTRADA = ["novo", "contato", "diagnostico", "proposta", "negociacao"] as const;
export type EtapaDeEntrada = (typeof ETAPAS_DE_ENTRADA)[number];
export const LIMITE_DE_FORMULARIOS = 20;

export interface Formulario {
  id: string;
  nome: string;
  token: string;
  titulo: string;
  descricao: string;
  texto_botao: string;
  agradecimento: string;
  campos: CamposDoFormulario;
  perguntas: PerguntaDoFormulario[];
  etapa_entrada: EtapaDeEntrada;
  responsavel_id: string | null;
  ativo: boolean;
  envios: number;
  ultimo_envio_em: string | null;
  criado_em: string;
}

/** O que a tela edita num formulário (o token, a empresa e o contador são do banco). */
export type RascunhoDoFormulario = Pick<Formulario, "nome" | "titulo" | "descricao" | "texto_botao" | "agradecimento" | "campos" | "perguntas" | "etapa_entrada" | "responsavel_id">;

export const FORMULARIO_NOVO: RascunhoDoFormulario = {
  nome: "",
  titulo: "",
  descricao: "",
  texto_botao: "Quero ser atendido",
  agradecimento: "Recebemos o seu contato. Em breve falamos com você.",
  campos: { whatsapp: "obrigatorio", email: "opcional", empresa: "nao", mensagem: "nao" },
  perguntas: [],
  etapa_entrada: "novo",
  responsavel_id: null,
};

const COLUNAS = "id, nome, token, titulo, descricao, texto_botao, agradecimento, campos, perguntas, etapa_entrada, responsavel_id, ativo, envios, ultimo_envio_em, criado_em";

function lerFormulario(l: any): Formulario {
  return {
    id: String(l.id),
    nome: String(l.nome || ""),
    token: String(l.token || ""),
    titulo: String(l.titulo || ""),
    descricao: String(l.descricao || ""),
    texto_botao: String(l.texto_botao || "Enviar"),
    agradecimento: String(l.agradecimento || ""),
    campos: lerCampos(l.campos),
    perguntas: lerPerguntas(l.perguntas),
    etapa_entrada: (ETAPAS_DE_ENTRADA as readonly string[]).indexOf(l.etapa_entrada) >= 0 ? l.etapa_entrada : "novo",
    responsavel_id: l.responsavel_id || null,
    ativo: l.ativo !== false,
    envios: numero(l.envios),
    ultimo_envio_em: l.ultimo_envio_em || null,
    criado_em: String(l.criado_em || ""),
  };
}

export async function listarFormularios(): Promise<Formulario[]> {
  const { data, error } = await db.from("crm_formularios").select(COLUNAS).order("criado_em", { ascending: false });
  if (error) throw error;
  return lista<any>(data).map(lerFormulario);
}

/** Cria (sem id) ou altera um formulário. O banco confere tamanhos, perguntas e o limite por empresa. */
export async function salvarFormulario(rascunho: RascunhoDoFormulario, id?: string): Promise<Formulario> {
  const linha = {
    nome: rascunho.nome.trim(),
    titulo: rascunho.titulo.trim(),
    descricao: rascunho.descricao.trim(),
    texto_botao: rascunho.texto_botao.trim() || "Enviar",
    agradecimento: rascunho.agradecimento.trim(),
    campos: rascunho.campos,
    perguntas: rascunho.perguntas,
    etapa_entrada: rascunho.etapa_entrada,
    responsavel_id: rascunho.responsavel_id || null,
  };
  const pedido = id ? db.from("crm_formularios").update(linha).eq("id", id) : db.from("crm_formularios").insert(linha);
  const { data, error } = await pedido.select(COLUNAS).single();
  if (error) throw error;
  return lerFormulario(data);
}

export async function ligarFormulario(id: string, ativo: boolean): Promise<void> {
  const { error } = await db.from("crm_formularios").update({ ativo }).eq("id", id);
  if (error) throw error;
}

export async function apagarFormulario(id: string): Promise<void> {
  const { error } = await db.from("crm_formularios").delete().eq("id", id);
  if (error) throw error;
}

/** Os três links prontos de um formulário: o simples, o do anúncio da Meta e o da bio. */
export function linksDoFormulario(base: string, token: string): Array<{ rotulo: string; onde: string; valor: string }> {
  return [
    { rotulo: "Link do formulário", onde: "Para o site ou para mandar direto.", valor: montarLink(base, token) },
    { rotulo: "Link para anúncio da Meta", onde: "Cole no destino do anúncio. A Meta troca os códigos pelo anúncio e pela campanha.", valor: montarLink(base, token, UTM_DA_META) },
    { rotulo: "Link para a bio do Instagram", onde: "Assim o relatório separa quem veio da bio.", valor: montarLink(base, token, { utm_source: "instagram", utm_medium: "bio" }) },
  ];
}

/** O endereço do produto onde o formulário público abre (o mesmo site em que a pessoa está). */
export const baseDoLink = (): string => (typeof window !== "undefined" && window.location ? window.location.origin : "");

// ------------------------------------------------------------------ de onde vêm os negócios

export interface LinhaDeOrigem {
  origem: string;
  campanha: string;
  rastreado: boolean;
  negocios: number;
  abertos: number;
  ganhos: number;
  perdidos: number;
  valor_ganho: number;
}

export interface OrigemAgrupada extends Omit<LinhaDeOrigem, "campanha"> {
  campanhas: LinhaDeOrigem[];
}

export async function lerOrigens(de: string, ate: string): Promise<LinhaDeOrigem[]> {
  const { data, error } = await db.rpc("crm_origens", { _de: de, _ate: ate });
  if (error) throw error;
  return lista<any>(data).map((l) => ({
    origem: String(l.origem || "manual"),
    campanha: String(l.campanha || ""),
    rastreado: !!l.rastreado,
    negocios: numero(l.negocios),
    abertos: numero(l.abertos),
    ganhos: numero(l.ganhos),
    perdidos: numero(l.perdidos),
    valor_ganho: numero(l.valor_ganho),
  }));
}

/** Junta as linhas por origem (as campanhas ficam dentro), da que mais trouxe negócio para a que menos trouxe. */
export function agruparOrigens(linhas: LinhaDeOrigem[]): OrigemAgrupada[] {
  const mapa: Record<string, OrigemAgrupada> = {};
  for (const l of linhas) {
    const g = mapa[l.origem] || (mapa[l.origem] = { origem: l.origem, rastreado: false, negocios: 0, abertos: 0, ganhos: 0, perdidos: 0, valor_ganho: 0, campanhas: [] });
    g.rastreado = g.rastreado || l.rastreado;
    g.negocios += l.negocios;
    g.abertos += l.abertos;
    g.ganhos += l.ganhos;
    g.perdidos += l.perdidos;
    g.valor_ganho = Math.round((g.valor_ganho + l.valor_ganho) * 100) / 100;
    if (l.campanha) g.campanhas.push(l);
  }
  return Object.keys(mapa)
    .map((k) => mapa[k])
    .sort((a, b) => b.negocios - a.negocios || b.valor_ganho - a.valor_ganho || a.origem.localeCompare(b.origem));
}

const NOME_DA_ORIGEM: Record<string, string> = {
  meta: "Meta (Facebook e Instagram)",
  facebook: "Facebook",
  fb: "Facebook",
  instagram: "Instagram",
  ig: "Instagram",
  google: "Google",
  youtube: "YouTube",
  tiktok: "TikTok",
  linkedin: "LinkedIn",
  whatsapp: "WhatsApp",
  email: "E-mail",
  site: "Site (sem link de campanha)",
  manual: "Cadastro manual",
  indicacao: "Indicação",
  prospeccao: "Prospecção",
  evento: "Evento",
  quiz: "Quiz",
  checkout: "Checkout",
  maquina_de_leads: "Máquina de leads",
};

/** O nome que a tela mostra para uma origem; a que não está na lista aparece como veio no link. */
export const nomeDaOrigem = (origem: string): string => NOME_DA_ORIGEM[origem] || origem;

/** Quantos por cento dos negócios viraram venda (0 a 100, inteiro). */
export const taxaDeGanho = (l: Pick<LinhaDeOrigem, "negocios" | "ganhos">): number => (l.negocios > 0 ? Math.round((l.ganhos / l.negocios) * 100) : 0);

export const PERIODOS = [
  { valor: "7", rotulo: "7 dias" },
  { valor: "30", rotulo: "30 dias" },
  { valor: "90", rotulo: "90 dias" },
  { valor: "365", rotulo: "12 meses" },
] as const;

/** As datas (AAAA-MM-DD, fuso de São Paulo) de um período de N dias que termina hoje. */
export function datasDoPeriodo(dias: number, agora = Date.now()): { de: string; ate: string } {
  const dia = (t: number) => new Date(t - 3 * 3600000).toISOString().slice(0, 10);
  const n = Math.max(1, Math.min(731, Math.floor(dias) || 30));
  return { de: dia(agora - (n - 1) * 86400000), ate: dia(agora) };
}

// ------------------------------------------------------------------ Meta: pixel, token e fila

export type EventoDaMeta = "Lead" | "Purchase";

export interface Rastreamento {
  meta_pixel_id: string | null;
  tem_token: boolean;
  /** Os 4 últimos caracteres do token, para reconhecer. O token inteiro nunca volta do banco. */
  token_final: string | null;
  eventos: EventoDaMeta[];
  codigo_de_teste: string | null;
  ultimo_envio_em: string | null;
  ultimo_erro: string | null;
  fila: { pendentes: number; enviados: number; erros: number };
}

function lerRastreamentoDoBanco(d: any): Rastreamento {
  const fila = (d && d.fila) || {};
  return {
    meta_pixel_id: d && d.meta_pixel_id ? String(d.meta_pixel_id) : null,
    tem_token: !!(d && d.tem_token),
    token_final: d && d.token_final ? String(d.token_final) : null,
    eventos: lista<string>(d && d.eventos).filter((e) => e === "Lead" || e === "Purchase") as EventoDaMeta[],
    codigo_de_teste: d && d.codigo_de_teste ? String(d.codigo_de_teste) : null,
    ultimo_envio_em: (d && d.ultimo_envio_em) || null,
    ultimo_erro: (d && d.ultimo_erro) || null,
    fila: { pendentes: numero(fila.pendentes), enviados: numero(fila.enviados), erros: numero(fila.erros) },
  };
}

export async function lerRastreamento(): Promise<Rastreamento> {
  const { data, error } = await db.rpc("crm_rastreamento_ler");
  if (error) throw error;
  return lerRastreamentoDoBanco(data);
}

/** Salva só o que veio. `meta_token` vai para o cofre do banco e não volta mais para a tela. */
export async function salvarRastreamento(dados: Partial<{ meta_pixel_id: string; meta_token: string; remover_token: boolean; eventos: EventoDaMeta[]; codigo_de_teste: string }>): Promise<Rastreamento> {
  const { data, error } = await db.rpc("crm_rastreamento_salvar", { _dados: dados });
  if (error) throw error;
  return lerRastreamentoDoBanco(data);
}

/** Em que pé está a conexão com a Meta, numa palavra e numa linha. */
export function estadoDaConexao(r: Rastreamento | null | undefined): { estado: "desligada" | "so_pixel" | "sem_envio" | "com_erro" | "ligada"; rotulo: string; linha: string } {
  if (!r || !r.meta_pixel_id) return { estado: "desligada", rotulo: "Não conectada", linha: "Cole o ID do Pixel para começar." };
  if (!r.tem_token) return { estado: "so_pixel", rotulo: "Só o Pixel", linha: "A página do formulário já avisa a Meta. Falta o token para a venda voltar." };
  if (r.ultimo_erro && r.fila.erros > 0) return { estado: "com_erro", rotulo: "Com erro", linha: r.ultimo_erro };
  if (!r.ultimo_envio_em) return { estado: "sem_envio", rotulo: "Conectada", linha: "Aguardando o primeiro evento." };
  return { estado: "ligada", rotulo: "Conectada", linha: "Eventos chegando à Meta." };
}

export interface ConversaoNaFila {
  id: string;
  lead_id: string;
  negocio: string;
  evento: EventoDaMeta;
  valor: number;
  situacao: "pendente" | "enviado" | "erro";
  tentativas: number;
  erro: string | null;
  criado_em: string;
  enviado_em: string | null;
}

/** Os últimos eventos da fila, com o nome do negócio quando a pessoa pode ver o negócio. */
export async function listarConversoes(limite = 30): Promise<ConversaoNaFila[]> {
  const { data, error } = await db.from("crm_conversoes").select("id, lead_id, evento, valor, situacao, tentativas, erro, criado_em, enviado_em").order("criado_em", { ascending: false }).limit(limite);
  if (error) throw error;
  const linhas = lista<any>(data);
  const ids = linhas.map((l) => String(l.lead_id)).filter((v, i, a) => a.indexOf(v) === i);
  const nomes: Record<string, string> = {};
  if (ids.length) {
    const { data: leads } = await db.from("crm_leads").select("id, name, company").in("id", ids);
    for (const l of lista<any>(leads)) nomes[String(l.id)] = String(l.company || l.name || "");
  }
  return linhas.map((l) => ({
    id: String(l.id),
    lead_id: String(l.lead_id),
    negocio: nomes[String(l.lead_id)] || "Negócio",
    evento: l.evento === "Purchase" ? "Purchase" : "Lead",
    valor: numero(l.valor),
    situacao: l.situacao === "enviado" || l.situacao === "erro" ? l.situacao : "pendente",
    tentativas: numero(l.tentativas),
    erro: l.erro || null,
    criado_em: String(l.criado_em || ""),
    enviado_em: l.enviado_em || null,
  }));
}

export async function reenviarConversoes(): Promise<number> {
  const { data, error } = await db.rpc("crm_conversoes_reenviar");
  if (error) throw error;
  return numero(data);
}

export const NOME_DO_EVENTO: Record<EventoDaMeta, string> = { Lead: "Lead (formulário preenchido)", Purchase: "Compra (negócio ganho)" };

// ------------------------------------------------------------------ página pública (sem login)

const enderecoDaCaptacao = (token: string): string => `${String(import.meta.env.VITE_SUPABASE_URL || "").replace(/\/+$/, "")}/functions/v1/produto-api/captar/${encodeURIComponent(token)}`;

export class ErroDoFormulario extends Error {
  codigo: string;
  campo: string;
  constructor(codigo: string, mensagem: string, campo = "") {
    super(mensagem);
    this.name = "ErroDoFormulario";
    this.codigo = codigo;
    this.campo = campo;
  }
}

async function chamar(token: string, init?: RequestInit): Promise<any> {
  let resposta: Response;
  try {
    resposta = await fetch(enderecoDaCaptacao(token), init);
  } catch {
    throw new ErroDoFormulario("rede", "Sem conexão. Confira a internet e tente de novo.");
  }
  let corpo: any = null;
  try {
    corpo = await resposta.json();
  } catch {
    /* resposta sem JSON: o status decide */
  }
  if (!resposta.ok) {
    throw new ErroDoFormulario(String((corpo && corpo.error) || "erro"), String((corpo && corpo.mensagem) || "Não foi possível concluir. Tente de novo."), String((corpo && corpo.campo) || ""));
  }
  return corpo;
}

export async function abrirFormularioPublico(token: string): Promise<FormularioPublico> {
  const corpo = await chamar(token);
  const f = lerFormularioPublico({ ok: true, formulario: corpo, empresa: corpo && corpo.empresa, pixel: corpo && corpo.pixel });
  if (!f) throw new ErroDoFormulario("formulario_inexistente", "Este formulário não existe.");
  return f;
}

export async function enviarFormularioPublico(token: string, envio: Record<string, unknown>): Promise<{ repetido: boolean; evento_id: string | null }> {
  const corpo = await chamar(token, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(envio) });
  return { repetido: !!(corpo && corpo.repetido), evento_id: corpo && corpo.evento_id ? String(corpo.evento_id) : null };
}

/** Lê um cookie do próprio site (o Pixel grava o _fbp aqui). Vazio quando não há. */
export function lerCookie(nome: string): string {
  if (typeof document === "undefined") return "";
  const partes = String(document.cookie || "").split(";");
  for (const p of partes) {
    const i = p.indexOf("=");
    if (i > 0 && p.slice(0, i).trim() === nome) return p.slice(i + 1).trim();
  }
  return "";
}
