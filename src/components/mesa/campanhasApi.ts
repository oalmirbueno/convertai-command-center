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
      return { nome: textoLimpo(x.nome, 120), por_que: textoLimpo(x.por_que, 500) };
    })
    .filter((p) => p.nome)
    .slice(0, 5);
  return {
    produtos,
    oferta: textoLimpo(o.oferta),
    mensagem_central: textoLimpo(o.mensagem_central, 400),
    publico: textoLimpo(o.publico),
    provas: (Array.isArray(o.provas) ? o.provas : []).map((p) => textoLimpo(p, 300)).filter(Boolean).slice(0, 6),
    tom: textoLimpo(o.tom, 300),
    cta: textoLimpo(o.cta, 200),
  };
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
}

export function corpoDoSalvarCampanha(c: CorpoDoSalvar): Record<string, unknown> {
  const corpo: Record<string, unknown> = { acao: "campanha_salvar", campanha_id: c.campanhaId };
  if (c.briefing) corpo.briefing = c.briefing;
  if (c.imagens) corpo.imagens = c.imagens.slice(0, MAX_IMAGENS_CAMPANHA);
  if (typeof c.objetivo === "string") corpo.objetivo = c.objetivo;
  return corpo;
}

export const campanhaSalvar = (c: CorpoDoSalvar) =>
  chamarFuncao<{ campanha: Campanha; recusadas?: string[] }>("agente-calendario", corpoDoSalvarCampanha(c));

export const campanhaPlanoImagens = (campanhaId: string) =>
  chamarFuncao<any>("agente-calendario", { acao: "campanha_plano_imagens", campanha_id: campanhaId });

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
