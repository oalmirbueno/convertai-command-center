import { useSyncExternalStore } from "react";
import type { QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { chamarFuncao, padraoPara, saidaPorRaciocinio, TAMANHOS, type ModeloIa, type ParteDaEstimativa } from "@/lib/mesa/api";
import {
  chaves,
  MAX_ANEXOS,
  type BriefingDaCampanha,
  type Campanha,
  type ImagemDaCampanha,
  type ItemProposto,
  type MensagemDoAgente,
  type PapelDaImagemDaCampanha,
  type PecaDoPlanoDeImagens,
  type PlanoDeImagens,
  type PropostaV4,
} from "./mesaV4Api";
import type { TrabalhoDaPeca } from "./regrasDaCampanha";
import { entregarComModo } from "@/lib/mesa/entregaComOpcoes";
import { novoLote } from "./seloApi";
import { normalizarPadrao, pedidoDoSeloPeloPadrao } from "../../../supabase/functions/_shared/padrao-da-campanha";
import * as storiesApi from "./stories/storiesApi";
import { ESTILO_AUTOMATICO, planoDasOpcoes } from "../../../supabase/functions/_shared/selo-da-campanha";

/**
 * Campanhas, versão 5 (23/09, noite): a conversa com o agente da campanha.
 * Contrato em docs/mesa-do-cliente/CONTRATOS-V5.md (campanha_conversar). A
 * conversa mora em agente_conversas (referencia_tipo 'mesa_campanha',
 * referencia_id = campanha.id) e a tela lê direto (RLS da equipe). Tudo que
 * volta das leituras é JSON puro: a Mesa guarda o cache no navegador.
 */

export const REFERENCIA_DA_CONVERSA = "mesa_campanha";

export const chavesDaCampanha = {
  conversa: (clientId: string, campanhaId: string) => ["mesa", "campanha-conversa", clientId, campanhaId] as const,
  contagem: (clientId: string, ids: string[]) => ["mesa", "campanhas-contagem", clientId, ids.join(",")] as const,
};

// ------------------------------------------------------------------ pedido em curso

/** Pedido ao agente da campanha que ainda não voltou. */
export interface PedidoDaCampanha {
  mensagem: string;
  desde: number;
}

/**
 * Pedido em curso por campanha, fora do componente. Fechar a gaveta, trocar
 * de campanha e voltar, ou mudar a largura da tela remonta a conversa: com o
 * andamento só no componente, o "Trabalhando" sumia, o Enviar voltava a valer
 * e um segundo pedido pago saía na mesma campanha.
 */
const pedidosEmCurso: Record<string, PedidoDaCampanha | undefined> = {};
const ouvintesDosPedidos: (() => void)[] = [];

export function marcarPedidoDaCampanha(campanhaId: string, pedido: PedidoDaCampanha | null) {
  if (pedido) pedidosEmCurso[campanhaId] = pedido;
  else delete pedidosEmCurso[campanhaId];
  ouvintesDosPedidos.slice().forEach((f) => f());
}

export function pedidoDaCampanha(campanhaId: string | null | undefined): PedidoDaCampanha | null {
  return campanhaId ? pedidosEmCurso[campanhaId] || null : null;
}

function ouvirPedidos(f: () => void) {
  ouvintesDosPedidos.push(f);
  return () => {
    const i = ouvintesDosPedidos.indexOf(f);
    if (i >= 0) ouvintesDosPedidos.splice(i, 1);
  };
}

/** O pedido em curso desta campanha (null: nenhum). Sobrevive a remontar a tela. */
export function usePedidoDaCampanha(campanhaId: string | null | undefined): PedidoDaCampanha | null {
  return useSyncExternalStore(ouvirPedidos, () => pedidoDaCampanha(campanhaId));
}

export interface ConversaDaCampanha {
  conversaId: string | null;
  mensagens: MensagemDoAgente[];
}

export async function lerConversaDaCampanha(campanhaId: string): Promise<ConversaDaCampanha> {
  const { data: conversas, error } = await (supabase as any)
    .from("agente_conversas")
    .select("id")
    .eq("referencia_tipo", REFERENCIA_DA_CONVERSA)
    .eq("referencia_id", campanhaId)
    .order("criado_em", { ascending: false })
    .limit(1);
  if (error) throw error;
  const conversaId: string | null = conversas && conversas[0] ? String(conversas[0].id) : null;
  if (!conversaId) return { conversaId: null, mensagens: [] };
  const { data, error: erroMsgs } = await (supabase as any)
    .from("agente_mensagens")
    .select("id, papel, conteudo, anexos, criado_em")
    .eq("conversa_id", conversaId)
    .order("criado_em", { ascending: false })
    .limit(80);
  if (erroMsgs) throw erroMsgs;
  const mensagens = ((data || []) as MensagemDoAgente[])
    .slice()
    .reverse()
    .map((m) => ({
      id: String(m.id),
      papel: m.papel,
      conteudo: String(m.conteudo || ""),
      anexos: Array.isArray(m.anexos) ? m.anexos : [],
      criado_em: String(m.criado_em || ""),
    }));
  return { conversaId, mensagens };
}

/**
 * Quantos conteúdos cada proposta de campanha tem (para a lista). Lê só o id
 * e os itens das propostas das campanhas e devolve { proposta_id: n }.
 */
export async function lerContagemDosConteudos(propostaIds: string[]): Promise<Record<string, number>> {
  if (!propostaIds.length) return {};
  const { data, error } = await (supabase as any).from("calendario_propostas").select("id, itens").in("id", propostaIds);
  if (error) throw error;
  const saida: Record<string, number> = {};
  ((data || []) as { id: string; itens: unknown }[]).forEach((p) => {
    saida[String(p.id)] = Array.isArray(p.itens) ? p.itens.length : 0;
  });
  return saida;
}

export interface CorpoDaConversa {
  campanhaId: string;
  mensagem: string;
  anexos?: string[];
}

export function corpoDaConversaDaCampanha(c: CorpoDaConversa): Record<string, unknown> {
  const corpo: Record<string, unknown> = { acao: "campanha_conversar", campanha_id: c.campanhaId, mensagem: c.mensagem };
  if (c.anexos && c.anexos.length) corpo.anexos = c.anexos.slice(0, MAX_ANEXOS);
  return corpo;
}

export const campanhaConversar = (c: CorpoDaConversa) => chamarFuncao<any>("agente-calendario", corpoDaConversaDaCampanha(c));

/** Uma chamada do estrategista (pode refazer os conteúdos), mais a leitura das imagens. */
export const partesDaConversaDaCampanha = (catalogo: ModeloIa[], anexos: number): ParteDaEstimativa[] => {
  const m = padraoPara(catalogo, "estrategista");
  return [
    {
      modeloId: m ? m.id : null,
      tipo: "texto",
      tokensEntrada: TAMANHOS.conversarMes.entrada + anexos * TAMANHOS.imagemAnexos.entrada,
      tokensSaida: saidaPorRaciocinio("medium"),
    },
  ];
};

/** Troca a campanha na lista em cache (ou põe no topo, se for nova). */
export function trocarCampanhaNoCache(qc: QueryClient, clientId: string, nova: Campanha) {
  qc.setQueryData<Campanha[]>(chaves.campanhas(clientId), (lista) => {
    const atual = lista || [];
    const tem = atual.some((c) => c.id === nova.id);
    return tem ? atual.map((c) => (c.id === nova.id ? nova : c)) : [nova].concat(atual);
  });
}

/**
 * Resposta do agente da campanha (ou de outra ação da campanha): a campanha
 * e a proposta mudam na tela na hora; a lista e a contagem relêem depois.
 */
export function aplicarRespostaDaCampanha(qc: QueryClient, clientId: string, data: any) {
  const campanha = data && data.campanha ? (data.campanha as Campanha) : null;
  const proposta = data && data.proposta && data.proposta.id ? (data.proposta as PropostaV4) : null;
  if (campanha) trocarCampanhaNoCache(qc, clientId, campanha);
  if (proposta) qc.setQueryData(chaves.proposta(proposta.id), proposta);
  void qc.invalidateQueries({ queryKey: chaves.campanhas(clientId) });
  void qc.invalidateQueries({ queryKey: ["mesa", "campanhas-contagem", clientId] });
}

/** Quantos conteúdos a campanha tem, pela proposta em cache ou pela contagem. */
export function conteudosDaCampanha(qc: QueryClient, campanha: Campanha, contagem: Record<string, number> | undefined): number | null {
  if (!campanha.proposta_id) return 0;
  const p = qc.getQueryData<PropostaV4 | null>(chaves.proposta(campanha.proposta_id));
  if (p && Array.isArray(p.itens)) return p.itens.length;
  if (contagem && Object.prototype.hasOwnProperty.call(contagem, campanha.proposta_id)) return contagem[campanha.proposta_id];
  return null;
}

// ------------------------------------------------------------------ campanha completa (25/09)

/**
 * Campanha completa: briefing (produto em foco, oferta, mensagem central,
 * público, provas, tom, CTA), imagens do acervo com papel e nota, e o plano de
 * imagens (qual imagem vai em qual lâmina e por quê, com o Jev decidindo onde
 * há mais de uma candidata). Contrato das ações no agente-calendario:
 *
 *   campanha_salvar { campanha_id, briefing?, imagens?, objetivo? }
 *     -> { campanha, recusadas: [imagem_id], custo_usd: 0 }   (sem IA)
 *   campanha_plano_imagens { campanha_id, modelo_id? }
 *     -> { campanha, plano_imagens, custo_usd, saldo_usd }     (IA com visão + Jev)
 *   campanha_criar ganha briefing? e imagens? no corpo.
 */

export const MAX_IMAGENS_CAMPANHA = 12;

export const PAPEIS_DA_IMAGEM: { valor: PapelDaImagemDaCampanha; rotulo: string; dica: string }[] = [
  { valor: "heroi", rotulo: "Produto herói", dica: "O produto em foco: vai na capa e na oferta." },
  { valor: "apoio", rotulo: "Apoio", dica: "Detalhe, prova, uso do produto." },
  { valor: "ambiente", rotulo: "Ambiente", dica: "Lugar, clima, contexto da campanha." },
];

export const rotuloDoPapelDaImagem = (p?: string | null) => {
  const achado = PAPEIS_DA_IMAGEM.filter((x) => x.valor === p)[0];
  return achado ? achado.rotulo : "Apoio";
};

const textoLimpo = (v: unknown, max = 600) => (typeof v === "string" ? v.trim().slice(0, max) : "");

export function briefingEmBranco(): BriefingDaCampanha {
  return { produtos: [], oferta: "", mensagem_central: "", publico: "", provas: [], tom: "", cta: "" };
}

/** Briefing em forma fixa (o banco pode trazer {} antes da primeira escrita). */
export function normalizarBriefing(v: unknown): BriefingDaCampanha {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const produtos = (Array.isArray(o.produtos) ? o.produtos : [])
    .map((p) => {
      const x = (p && typeof p === "object" ? p : { nome: p }) as Record<string, unknown>;
      // 22/10/2026: foto, preço, promoção, link e destaque do produto seguem (o servidor confere ao gravar).
      return {
        nome: textoLimpo(x.nome, 120),
        por_que: textoLimpo(x.por_que, 500),
        ...(typeof x.imagem_id === "string" && x.imagem_id ? { imagem_id: x.imagem_id } : {}),
        ...(typeof x.caminho === "string" && x.caminho ? { caminho: x.caminho } : {}),
        ...(textoLimpo(x.preco, 40) ? { preco: textoLimpo(x.preco, 40) } : {}),
        ...(textoLimpo(x.preco_promocional, 40) ? { preco_promocional: textoLimpo(x.preco_promocional, 40) } : {}),
        ...(textoLimpo(x.link, 400) ? { link: textoLimpo(x.link, 400) } : {}),
        ...(x.destaque === true ? { destaque: true } : {}),
      };
    })
    .filter((p) => p.nome)
    .slice(0, 8);
  return {
    produtos,
    oferta: textoLimpo(o.oferta),
    mensagem_central: textoLimpo(o.mensagem_central, 400),
    publico: textoLimpo(o.publico),
    provas: (Array.isArray(o.provas) ? o.provas : []).map((p) => textoLimpo(p, 300)).filter(Boolean).slice(0, 6),
    tom: textoLimpo(o.tom, 300),
    cta: textoLimpo(o.cta, 200),
    ...canaisLimpos(o.canais),
    // A mistura de formatos e os stories planejados seguem como vieram (o servidor normaliza ao gravar).
    ...(o.formatos && typeof o.formatos === "object" ? { formatos: o.formatos as BriefingDaCampanha["formatos"] } : {}),
    ...(Array.isArray(o.stories) && o.stories.length ? { stories: o.stories as BriefingDaCampanha["stories"] } : {}),
    ...(o.ads && typeof o.ads === "object" && (o.ads as Record<string, unknown>).campaign_id ? { ads: o.ads as BriefingDaCampanha["ads"] } : {}),
    ...(normalizarPadrao(o.padrao) ? { padrao: normalizarPadrao(o.padrao) } : {}),
    // 22/10/2026: o que o agente editor e a criação guardam no briefing seguem intactos ao salvar à mão.
    ...(textoLimpo(o.conducao, 600) ? { conducao: textoLimpo(o.conducao, 600) } : {}),
    ...(Array.isArray(o.refazer) && o.refazer.length ? { refazer: (o.refazer as unknown[]).map(String) } : {}),
    ...(Array.isArray(o.versoes) && o.versoes.length ? { versoes: o.versoes as BriefingDaCampanha["versoes"] } : {}),
    ...(typeof o.tom_da_campanha === "string" && o.tom_da_campanha ? { tom_da_campanha: o.tom_da_campanha } : {}),
    ...(typeof o.esquema === "string" && o.esquema ? { esquema: o.esquema } : {}),
    ...(o.mercado && typeof o.mercado === "object" ? { mercado: o.mercado as BriefingDaCampanha["mercado"] } : {}),
  };
}

/** Canais em que a campanha roda (21/10/2026). A equipe marca; a lista fixa é a da casa. */
export const CANAIS_DA_CAMPANHA = ["Feed do Instagram", "Stories", "Reels", "Facebook", "WhatsApp", "E-mail", "Google"];

/** Canais sem repetir, até 8; vazio não entra (o briefing antigo segue igual). */
function canaisLimpos(v: unknown): { canais?: string[] } {
  const lista: string[] = [];
  (Array.isArray(v) ? v : []).forEach((c) => {
    const t = textoLimpo(c, 40);
    if (t && lista.indexOf(t) < 0) lista.push(t);
  });
  return lista.length ? { canais: lista.slice(0, 8) } : {};
}

const UUID_DA_IMAGEM = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Imagens da campanha: só UUID, sem repetir, papel conhecido, até 12 (igual à função). */
export function normalizarImagensDaCampanha(v: unknown): ImagemDaCampanha[] {
  const saida: ImagemDaCampanha[] = [];
  const vistas: Record<string, true> = {};
  for (const x of Array.isArray(v) ? v : []) {
    const o = (x && typeof x === "object" ? x : { imagem_id: x }) as Record<string, unknown>;
    const id = String(o.imagem_id || o.id || "").trim().toLowerCase();
    if (!UUID_DA_IMAGEM.test(id) || vistas[id]) continue;
    vistas[id] = true;
    const papel = o.papel === "heroi" || o.papel === "ambiente" ? (o.papel as PapelDaImagemDaCampanha) : "apoio";
    saida.push({ imagem_id: id, papel, nota: textoLimpo(o.nota, 400) });
    if (saida.length >= MAX_IMAGENS_CAMPANHA) break;
  }
  return saida;
}

/** Plano gravado, em forma fixa, ou null. */
export function normalizarPlanoDeImagens(v: unknown): PlanoDeImagens | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const pecas: PecaDoPlanoDeImagens[] = (Array.isArray(o.pecas) ? o.pecas : [])
    .map((p) => {
      const x = (p && typeof p === "object" ? p : {}) as Record<string, unknown>;
      const confianca = typeof x.confianca === "number" && isFinite(x.confianca) ? x.confianca : null;
      return {
        tema_id: textoLimpo(x.tema_id, 40),
        ordem: Number(x.ordem) || 0,
        imagem_id: typeof x.imagem_id === "string" && x.imagem_id ? x.imagem_id : null,
        candidatas: (Array.isArray(x.candidatas) ? x.candidatas : []).map((c) => String(c || "")).filter(Boolean),
        uso: x.uso === "elemento" ? ("elemento" as const) : ("fundo" as const),
        por_que: textoLimpo(x.por_que, 500),
        escolha: x.escolha === "jev" ? ("jev" as const) : ("estrategista" as const),
        confianca,
        aviso: textoLimpo(x.aviso, 300) || null,
      };
    })
    .filter((p) => p.tema_id && p.ordem > 0);
  return {
    gerado_em: textoLimpo(o.gerado_em, 40),
    assinatura: textoLimpo(o.assinatura, 4000),
    fonte: o.fonte === "acervo" ? "acervo" : "campanha",
    resumo: textoLimpo(o.resumo, 1200),
    analise: (Array.isArray(o.analise) ? o.analise : [])
      .map((a) => {
        const x = (a && typeof a === "object" ? a : {}) as Record<string, unknown>;
        return {
          imagem_id: String(x.imagem_id || ""),
          o_que_mostra: textoLimpo(x.o_que_mostra, 400),
          forca: textoLimpo(x.forca, 300),
          serve_para: textoLimpo(x.serve_para, 200),
        };
      })
      .filter((a) => a.imagem_id),
    pecas,
    lacunas: (Array.isArray(o.lacunas) ? o.lacunas : []).map((l) => textoLimpo(l, 300)).filter(Boolean),
    jev_erro: textoLimpo(o.jev_erro, 60) || null,
  };
}

/**
 * Assinatura do plano: imagens da campanha (id:papel) e conteúdos (tema_id:
 * quantidade de cards). Igual à assinaturaDoPlano da função agente-calendario.
 */
export function assinaturaDoPlano(imagens: { imagem_id: string; papel?: string }[], itens: { tema_id?: string | null; cards?: unknown[] | null }[]): string {
  const a = imagens.map((i) => `${i.imagem_id}:${i.papel || ""}`).sort().join(",");
  const b = itens.map((i) => `${i.tema_id || ""}:${Array.isArray(i.cards) ? i.cards.length : 0}`).sort().join(",");
  return `${a}|${b}`;
}

/** O plano foi feito sobre outras imagens ou outros conteúdos. */
export function planoDesatualizado(plano: PlanoDeImagens | null, imagens: ImagemDaCampanha[], itens: ItemProposto[] | null): boolean {
  if (!plano || !itens) return false;
  return plano.assinatura !== assinaturaDoPlano(imagens, itens);
}

export interface CorpoDoSalvar {
  campanhaId: string;
  briefing?: BriefingDaCampanha;
  imagens?: ImagemDaCampanha[];
  objetivo?: string;
  /** Frente AE: trocar o tipo da campanha (sem IA); "nenhum" tira. */
  tipo?: string;
  /** 21/10/2026: nome e período na etapa Briefing (sem IA). */
  nome?: string;
  periodoInicio?: string;
  periodoFim?: string;
  conceito?: string;
}

export function corpoDoSalvarCampanha(c: CorpoDoSalvar): Record<string, unknown> {
  const corpo: Record<string, unknown> = { acao: "campanha_salvar", campanha_id: c.campanhaId };
  if (typeof c.tipo === "string") corpo.tipo = c.tipo;
  if (c.briefing) corpo.briefing = c.briefing;
  if (c.imagens) corpo.imagens = c.imagens.slice(0, MAX_IMAGENS_CAMPANHA);
  if (typeof c.objetivo === "string") corpo.objetivo = c.objetivo;
  if (c.nome && c.nome.trim()) corpo.nome = c.nome.trim();
  if (typeof c.conceito === "string") corpo.conceito = c.conceito;
  if (c.periodoInicio) corpo.periodo_inicio = c.periodoInicio;
  if (c.periodoFim) corpo.periodo_fim = c.periodoFim;
  return corpo;
}

export const campanhaSalvar = (c: CorpoDoSalvar) =>
  chamarFuncao<{ campanha: Campanha; recusadas?: string[] }>("agente-calendario", corpoDoSalvarCampanha(c));

export const campanhaPlanoImagens = (campanhaId: string) =>
  chamarFuncao<any>("agente-calendario", { acao: "campanha_plano_imagens", campanha_id: campanhaId });

/**
 * campanha_conteudos { campanha_id, quantidade?, tipos?, frameworks?, formato? }
 *   -> { campanha, proposta, novos, faltam, custo_usd, saldo_usd, tempos_ms }
 * Os conteúdos da campanha na hora, pelo arco da campanha, em lotes paralelos.
 */
export interface CorpoDosConteudos {
  campanhaId: string;
  quantidade?: number;
  formato?: "estatico" | "carrossel" | "video" | null;
  escolha?: { tipos: string[]; frameworks: string[] } | null;
}

export function corpoDosConteudosDaCampanha(c: CorpoDosConteudos): Record<string, unknown> {
  const corpo: Record<string, unknown> = { acao: "campanha_conteudos", campanha_id: c.campanhaId };
  if (c.quantidade) corpo.quantidade = Math.max(1, Math.min(8, Math.round(c.quantidade)));
  if (c.formato) corpo.formato = c.formato;
  if (c.escolha && c.escolha.tipos.length) corpo.tipos = c.escolha.tipos.slice(0, 9);
  if (c.escolha && c.escolha.frameworks.length) corpo.frameworks = c.escolha.frameworks.slice(0, 10);
  return corpo;
}

export const campanhaConteudos = (c: CorpoDosConteudos) => chamarFuncao<any>("agente-calendario", corpoDosConteudosDaCampanha(c));

/** Plano de imagens: uma chamada do estrategista com as imagens à vista (o Jev custa centavos). */
export const partesDoPlanoDeImagens = (catalogo: ModeloIa[], imagens: number, conteudos: number): ParteDaEstimativa[] => {
  const m = padraoPara(catalogo, "estrategista");
  return [
    {
      modeloId: m ? m.id : null,
      tipo: "texto",
      tokensEntrada: 6000 + Math.max(imagens, 1) * TAMANHOS.imagemAnexos.entrada + conteudos * 600,
      tokensSaida: saidaPorRaciocinio("medium") + conteudos * 300,
    },
  ];
};

// ------------------------------------------------------------------ campanha completa (21/10/2026)

/**
 * As peças da campanha são artes rápidas do Estúdio (estudio_trabalhos com direcao.arte_rapida.campanha_id):
 * lidas direto (RLS da equipe), mais novas por último. O andamento do gerador vem da fila do servidor.
 */
export const chavesDaCampanhaCompleta = {
  pecas: (clientId: string, campanhaId: string) => ["mesa", "campanha-pecas", clientId, campanhaId] as const,
  fila: (campanhaId: string, ids: string[]) => ["mesa", "campanha-pecas-fila", campanhaId, ids.join(",")] as const,
  conferencia: (campanhaId: string) => ["mesa", "campanha-conferencia", campanhaId] as const,
};

export async function lerTrabalhosDaCampanha(clientId: string, campanhaId: string): Promise<TrabalhoDaPeca[]> {
  const { data, error } = await (supabase as any)
    .from("estudio_trabalhos")
    .select("id, status, direcao, cards, legenda, task_id, aprovado_em, atualizado_em")
    .eq("client_id", clientId)
    .eq("origem", "mesa")
    .eq("direcao->arte_rapida->>campanha_id", campanhaId)
    .order("atualizado_em", { ascending: true })
    .limit(60);
  if (error) throw error;
  return ((data || []) as Record<string, unknown>[]).map((t) => ({
    ...(t as unknown as TrabalhoDaPeca),
    cards: Array.isArray(t.cards) ? (t.cards as TrabalhoDaPeca["cards"]) : [],
    direcao: t.direcao && typeof t.direcao === "object" ? (t.direcao as TrabalhoDaPeca["direcao"]) : {},
  }));
}

export async function lerFilaDosTrabalhos(ids: string[]): Promise<{ trabalho_id: string; status: string; ordem: number }[]> {
  if (!ids.length) return [];
  const { data, error } = await (supabase as any)
    .from("estudio_fila")
    .select("trabalho_id, status, ordem, criado_em")
    .in("trabalho_id", ids.slice(0, 60))
    .in("status", ["fila", "rodando", "erro"])
    .order("criado_em", { ascending: false })
    .limit(300);
  // Sem a tabela da fila (banco antigo): o andamento sai só das lâminas gravadas.
  if (error) return [];
  return ((data || []) as { trabalho_id: string; status: string; ordem: number }[]).map((f) => ({ trabalho_id: String(f.trabalho_id), status: String(f.status), ordem: Number(f.ordem) || 0 }));
}

/** Cria a direção da peça (rapida_preparar) e pede todas as lâminas ao gerador. */
export async function prepararPecaDaCampanha(corpo: Record<string, unknown>, marcaId: string | null): Promise<{ trabalhoId: string; ordens: number[]; avisos: string[] }> {
  const r = await prepararPecaSemGerar(corpo);
  if (r.ordens.length) await gerarLaminasDaPeca(r.trabalhoId, r.ordens, marcaId);
  return r;
}

/**
 * 22/10/2026 (dono: "clico em abrir no Estúdio e ele já puxa a sequência e eu já gero por lá"): só a direção
 * da peça (rapida_preparar com o conteúdo, a identidade, a campanha e peca_da_campanha), SEM pedir as lâminas
 * ao gerador. O Estúdio abre com tudo pronto e a equipe clica em Gerar lá.
 */
export async function prepararPecaSemGerar(corpo: Record<string, unknown>): Promise<{ trabalhoId: string; ordens: number[]; avisos: string[] }> {
  const r = await chamarFuncao<any>("estudio-arte", corpo);
  const t = r && r.trabalho ? (r.trabalho as { id: string; direcao?: { cards?: { ordem: number }[] } }) : null;
  if (!t || !t.id) throw new Error("O Estúdio não devolveu a peça.");
  const ordens = ((t.direcao && t.direcao.cards) || []).map((c) => c.ordem);
  return { trabalhoId: t.id, ordens, avisos: r && Array.isArray(r.avisos) ? r.avisos : [] };
}

/** Pede as lâminas à fila do gerador do servidor (a geração segue mesmo com a tela fechada). */
export async function gerarLaminasDaPeca(trabalhoId: string, ordens: number[], marcaId: string | null): Promise<void> {
  if (!ordens.length) return;
  await chamarFuncao<any>("estudio-arte", { acao: "enfileirar", trabalho_id: trabalhoId, ordens, ...(marcaId ? { marca_id: marcaId } : {}) });
}

/** Tira da fila as lâminas que ainda não começaram (cancelar a campanha completa). */
export async function cancelarFilaDasPecas(trabalhoIds: string[]): Promise<void> {
  for (const id of trabalhoIds) {
    await chamarFuncao<any>("estudio-arte", { acao: "cancelar_fila", trabalho_id: id }).catch(() => null);
  }
}

/** Selo da campanha pelo gerador: uma opção no estilo automático, já escolhida. */
/**
 * 22/10/2026 (dono: "o selo gerado pelo GPT Image 2.5"): o modelo do selo, na ordem, o primeiro ativo no catálogo
 * (ia_modelos). Configurável aqui; sem nenhum deles, o padrão de imagem da casa.
 */
export const MODELOS_DO_SELO = ["openai:gpt-image-2.5-sunburst", "openai:gpt-image-2.5-flare", "openrouter:openai/gpt-image-2.5-sunburst"];

export function modeloDoSelo(catalogo: { id: string; tipo?: string; ativo?: boolean; padrao_para?: string[] }[]): string | null {
  for (const id of MODELOS_DO_SELO) {
    const m = catalogo.filter((x) => x.id === id && x.ativo !== false)[0];
    if (m) return m.id;
  }
  const padrao = catalogo.filter((x) => x.tipo === "imagem" && x.ativo !== false && (x.padrao_para || []).indexOf("imagem") >= 0)[0];
  return padrao ? padrao.id : null;
}

export async function gerarSeloDaCampanha(campanha: Campanha, modeloId: string | null): Promise<void> {
  const tipo = campanha.identidade && campanha.identidade.tipo ? String(campanha.identidade.tipo) : null;
  // Estilo automático pelo tipo da campanha (o mesmo plano da tela do selo), uma opção só.
  const opcao = planoDasOpcoes(ESTILO_AUTOMATICO, tipo, 1)[0];
  const r = await chamarFuncao<any>("agente-calendario", {
    acao: "selo_gerar",
    campanha_id: campanha.id,
    lote_id: novoLote(),
    estilo: opcao.estilo,
    variacao: opcao.variacao,
    ...(modeloId ? { modelo_id: modeloId } : {}),
    qualidade: "media",
    // O selo segue o padrão visual da campanha (o servidor também anexa as referências dele).
    ...(pedidoDoSeloPeloPadrao(normalizarPadrao(normalizarBriefing(campanha.briefing).padrao)) ? { pedido: pedidoDoSeloPeloPadrao(normalizarPadrao(normalizarBriefing(campanha.briefing).padrao)) } : {}),
  });
  const id = r && r.versao && r.versao.id ? String(r.versao.id) : "";
  if (!id) throw new Error("O selo não saiu do gerador.");
  await chamarFuncao<any>("agente-calendario", { acao: "selo_escolher", campanha_id: campanha.id, selo_id: id });
}

/** Conferência do Jev: cada peça bate com o briefing? E qual gancho abre melhor a campanha. Sem gravar. */
export interface ConferenciaDaCampanha {
  pecas: { tema_id: string; nota: number | null; nivel: "forte" | "ok" | "fraca" | null; confianca: number | null; comercial?: number | null; aviso_comercial?: string | null }[];
  melhor_gancho: string | null;
  confianca_do_gancho: number | null;
  jev_erro: string | null;
  custo_usd: number;
}

export const campanhaConferir = (campanhaId: string) => chamarFuncao<ConferenciaDaCampanha>("agente-calendario", { acao: "campanha_conferir", campanha_id: campanhaId });

/**
 * Aprovar a peça e levar pelo fluxo de sempre da arte rápida: item na Agenda na data do conteúdo, legenda
 * (se faltar), entrega em Arquivos e envio para a aprovação do cliente (aba Entrega).
 */
export async function levarPecaParaAgenda(trabalho: { id: string; legenda?: string | null }, data: string): Promise<{ taskId: string; ok: boolean; erro?: string; custo_usd: number }> {
  const r = await chamarFuncao<any>("estudio-arte", { acao: "rapida_para_agenda", trabalho_id: trabalho.id, data, pedido_id: `${trabalho.id}:${data}` });
  const taskId = r && r.task ? String(r.task.id) : "";
  let custo = 0;
  if (!String(trabalho.legenda || "").trim()) {
    const l = await chamarFuncao<any>("estudio-arte", { acao: "legenda", trabalho_id: trabalho.id });
    custo += Number(l && l.custo_usd) || 0;
  }
  const entrega = await entregarComModo(trabalho.id, "aprovacao");
  return { taskId, ok: entrega.ok, erro: entrega.erro, custo_usd: custo };
}

// ------------------------------------------------------------------ stories da campanha (contrato com a aba Stories)

/**
 * Contrato (21/10/2026): a aba Stories expõe gerarStoriesDaCampanha({ clientId, campanhaId, temaId, briefing,
 * identidade, fase, quantidadeDeTelas }) em ./stories/storiesApi. Enquanto ela não existir, a peça de story
 * fica "a criar" e a tela avisa (nada é gasto). Depois de gerar, a sequência fica marcada no briefing da
 * campanha (stories[i].sequencia_id) para reabrir sem gerar de novo.
 */
export function geradorDeStoriesDisponivel(): boolean {
  return typeof (storiesApi as unknown as Record<string, unknown>).gerarStoriesDaCampanha === "function";
}

export interface PedidoDeStoriesDaCampanha {
  clientId: string;
  campanhaId: string;
  temaId: string;
  briefing: BriefingDaCampanha;
  identidade: Campanha["identidade"];
  fase: string;
  quantidadeDeTelas: number;
  /** O custo total já foi mostrado e confirmado na campanha: a aba Stories não pede de novo. */
  confirmado?: boolean;
  data?: string | null;
  pedido?: string | null;
  marcaId?: string | null;
}

export async function gerarStoryDaCampanha(campanha: Campanha, pedido: PedidoDeStoriesDaCampanha): Promise<string> {
  const gerar = (storiesApi as unknown as Record<string, unknown>).gerarStoriesDaCampanha as ((p: PedidoDeStoriesDaCampanha) => Promise<any>) | undefined;
  if (typeof gerar !== "function") throw new Error("Os stories da campanha ainda não estão ligados à aba Stories.");
  const r = await gerar({ confirmado: true, ...pedido });
  if (r && r.situacao === "confirmar_custo") throw new Error(r.mensagem || "Os stories pediram para confirmar o custo.");
  const id = String((r && (r.sequencia_id || (r.sequencia && r.sequencia.id) || r.id)) || "feita");
  const b = normalizarBriefing(campanha.briefing);
  const stories = (b.stories || []).map((s) => (s.tema_id === pedido.temaId ? { ...s, sequencia_id: id } : s));
  await campanhaSalvar({ campanhaId: campanha.id, briefing: { ...b, stories } });
  return id;
}

/** Os trabalhos de todas as campanhas do cliente (progresso na lista): só o que conta. */
export async function lerTrabalhosDasCampanhas(clientId: string): Promise<TrabalhoDaPeca[]> {
  const { data, error } = await (supabase as any)
    .from("estudio_trabalhos")
    .select("id, status, direcao, cards, task_id")
    .eq("client_id", clientId)
    .eq("origem", "mesa")
    .not("direcao->arte_rapida->>campanha_id", "is", null)
    .order("atualizado_em", { ascending: false })
    .limit(300);
  if (error) throw error;
  return ((data || []) as Record<string, unknown>[]).map((t) => ({
    ...(t as unknown as TrabalhoDaPeca),
    cards: Array.isArray(t.cards) ? (t.cards as TrabalhoDaPeca["cards"]) : [],
    direcao: t.direcao && typeof t.direcao === "object" ? (t.direcao as TrabalhoDaPeca["direcao"]) : {},
  }));
}

// ------------------------------------------------------------------ referência da campanha (22/10/2026)

/** O padrão visual gravado na campanha, ou null. */
export const padraoDaCampanha = (c: Pick<Campanha, "briefing">) => normalizarPadrao(normalizarBriefing(c.briefing).padrao);

/** Lê as referências (1 a 3) e grava o padrão visual na campanha; lista vazia tira o padrão (sem custo). */
export const definirPadraoDaCampanha = (campanhaId: string, referenciasIds: string[]) =>
  chamarFuncao<{ campanha: Campanha; padrao: unknown; custo_usd: number }>("estudio-arte", { acao: "campanha_padrao", campanha_id: campanhaId, referencias_ids: referenciasIds.slice(0, 3) });

/** Uma leitura por visão das referências (o modelo de leitura do catálogo). */
export const partesDoPadrao = (catalogo: ModeloIa[], referencias: number): ParteDaEstimativa[] => {
  const m = padraoPara(catalogo, "leitura") || padraoPara(catalogo, "estrategista");
  return [{ modeloId: m ? m.id : null, tipo: "texto", tokensEntrada: 3000 + Math.max(1, referencias) * TAMANHOS.imagemAnexos.entrada, tokensSaida: 1600 }];
};

// ------------------------------------------------------------------ campanha em andamento (22/10/2026)

/**
 * O agente da campanha como editor da campanha rodando: ele PLANEJA a mudança (diff por item, apelidos a1..aN,
 * anexo acao_agente do agente "campanha.mudanca") e nada muda até a equipe confirmar tudo ou só partes.
 * Confirmar guarda a versão de antes; Desfazer e o histórico voltam a ela.
 */
export const AGENTE_DA_MUDANCA = "campanha.mudanca";

export const planejarMudanca = (campanhaId: string, mensagem: string, anexos: string[] = []) =>
  chamarFuncao<any>("agente-calendario", { acao: "campanha_mudanca_planejar", campanha_id: campanhaId, mensagem, ...(anexos.length ? { anexos: anexos.slice(0, MAX_ANEXOS) } : {}) });

export const confirmarMudanca = (mensagemId: string, acaoId: string, refs: string[]) =>
  chamarFuncao<any>("agente-calendario", { acao: "campanha_mudanca_confirmar", mensagem_id: mensagemId, acao_id: acaoId, refs });

export const descartarMudanca = (mensagemId: string, acaoId: string) =>
  chamarFuncao<any>("agente-calendario", { acao: "campanha_mudanca_confirmar", mensagem_id: mensagemId, acao_id: acaoId, descartar: true });

export const desfazerMudanca = (mensagemId: string, acaoId: string) =>
  chamarFuncao<any>("agente-calendario", { acao: "campanha_mudanca_desfazer", mensagem_id: mensagemId, acao_id: acaoId });

export const voltarAVersao = (campanhaId: string, versaoId: string) =>
  chamarFuncao<any>("agente-calendario", { acao: "campanha_versao_voltar", campanha_id: campanhaId, versao_id: versaoId });

export const pesquisarMercadoDaCampanha = (campanhaId: string) =>
  chamarFuncao<any>("agente-calendario", { acao: "campanha_mercado", campanha_id: campanhaId });

/** "Reescrever no tom comercial": a mudança planejada com o pedido fixo (o diff vem para confirmar). */
export const reescreverNoTomComercial = (campanhaId: string) =>
  chamarFuncao<any>("agente-calendario", { acao: "campanha_reescrever_comercial", campanha_id: campanhaId });

export const ordenarSugestoes = (campanhaId: string, sugestoes: { id: string; texto: string; fonte: string }[]) =>
  chamarFuncao<{ ordem: { id: string; nota: number | null }[]; custo_usd: number }>("agente-calendario", { acao: "campanha_sugestoes_ordenar", campanha_id: campanhaId, sugestoes });

/** Planejar a mudança: uma chamada do estrategista com a campanha e a série à vista. */
export const partesDaMudanca = (catalogo: ModeloIa[], pecas: number): ParteDaEstimativa[] => {
  const m = padraoPara(catalogo, "estrategista");
  return [{ modeloId: m ? m.id : null, tipo: "texto", tokensEntrada: TAMANHOS.conversarMes.entrada + pecas * 500, tokensSaida: saidaPorRaciocinio("medium") + pecas * 250 }];
};

/** A pesquisa de mercado: uma chamada com busca na web. */
export const partesDoMercado = (catalogo: ModeloIa[]): ParteDaEstimativa[] => {
  const m = padraoPara(catalogo, "estrategista");
  return [{ modeloId: m ? m.id : null, tipo: "texto", tokensEntrada: TAMANHOS.proporTemas.entrada, tokensSaida: saidaPorRaciocinio("low"), buscasWeb: 4 }];
};

/** Sobe a foto de um produto para a pasta da campanha (bucket mesa) e devolve o caminho. */
export async function subirFotoDoProduto(clientId: string, campanhaId: string, arquivo: File): Promise<string> {
  const ext = /png$/i.test(arquivo.type) ? "png" : /webp$/i.test(arquivo.type) ? "webp" : "jpg";
  if (String(arquivo.type || "").indexOf("image/") !== 0) throw new Error("Envie uma imagem (JPG, PNG ou WEBP).");
  if (arquivo.size > 12 * 1024 * 1024) throw new Error("Imagem acima de 12 MB.");
  const caminho = `${clientId}/campanhas/${campanhaId}/produto-${Date.now()}-${Math.floor(Math.random() * 1e6)}.${ext}`;
  const { error } = await supabase.storage.from("mesa").upload(caminho, arquivo, { contentType: arquivo.type || "image/jpeg", upsert: false });
  if (error) throw error;
  return caminho;
}
