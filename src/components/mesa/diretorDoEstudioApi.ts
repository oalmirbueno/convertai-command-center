import { useSyncExternalStore } from "react";
import { supabase } from "@/integrations/supabase/client";
import { chamarFuncao, padraoPara, TAMANHOS, type ModeloIa, type ParteDaEstimativa } from "@/lib/mesa/api";

/**
 * Conversa com o diretor de arte dentro do Estúdio (pedido do dono em 24/09:
 * "no estúdio ali onde estou produzindo as artes ter um agente que eu possa
 * conversar se caso eu quiser mudar o estilo ou cenários etc., e ele
 * inteligente para me ajudar com base no conteúdo").
 *
 * Servidor: estudio-arte, ações `conversar` { trabalho_id, mensagem, ordem? }
 * e `aplicar_mudancas` { trabalho_id, mudancas, regerar?, mensagem_id? }. A
 * conversa mora em agente_conversas (agente diretor_arte, referencia_tipo
 * 'estudio_trabalho', referencia_id = trabalho) e a tela lê direto (RLS da
 * equipe). Tudo que volta das leituras é JSON puro: a Mesa guarda o cache no
 * navegador. Serve ao Estúdio da Mesa (AbaEstudio) e à arte do criativo da
 * Mesa Ads (ArteDoCriativo).
 */

export const REFERENCIA_DA_CONVERSA_DO_ESTUDIO = "estudio_trabalho";
export const SEM_FOTO = "sem_foto";

export const chavesDoDiretor = {
  conversa: (trabalhoId: string) => ["mesa", "estudio-diretor", trabalhoId] as const,
};

/** Tamanho típico da conversa: o trabalho inteiro em JSON mais a base de conhecimento do diretor. */
export const TAMANHO_DA_CONVERSA = { entrada: 18000, saida: 2500 };

export type CampoDaMudanca =
  | "conceito"
  | "fio_visual"
  | "estilo"
  | "imagem"
  | "ponto_focal"
  | "fundo"
  | "tratamento"
  | "zona_texto"
  | "alinhamento"
  | "cor_fundo"
  | "cor_texto"
  | "cor_destaque"
  | "evitar"
  | "foto_acervo"
  | "texto_exato";

export interface MudancaDoDiretor {
  id: string;
  alvo: "conjunto" | "lamina";
  ordem: number | null;
  titulo: string;
  motivo: string;
  campos: Partial<Record<CampoDaMudanca, string>>;
  /** Lâminas que precisam ser refeitas para a arte mostrar a mudança. */
  regerar: number[];
}

export interface MensagemDoDiretor {
  id: string;
  papel: "usuario" | "agente" | "sistema";
  conteudo: string;
  criado_em: string;
  emFoco: number | null;
  mudancas: MudancaDoDiretor[];
  avisos: string[];
  aplicadas: string[];
}

export interface ConversaDoDiretor {
  conversaId: string | null;
  mensagens: MensagemDoDiretor[];
}

/** Ordem dos campos na tela e o nome de cada um em português. */
export const ROTULOS_DOS_CAMPOS: { campo: CampoDaMudanca; rotulo: string }[] = [
  { campo: "estilo", rotulo: "Estilo do trabalho" },
  { campo: "conceito", rotulo: "Conceito" },
  { campo: "fio_visual", rotulo: "Fio visual" },
  { campo: "imagem", rotulo: "Cenário e cena" },
  { campo: "foto_acervo", rotulo: "Foto real" },
  { campo: "ponto_focal", rotulo: "Ponto focal" },
  { campo: "fundo", rotulo: "Fundo" },
  { campo: "tratamento", rotulo: "Estilo e luz da lâmina" },
  { campo: "zona_texto", rotulo: "Posição do texto" },
  { campo: "alinhamento", rotulo: "Alinhamento" },
  { campo: "cor_fundo", rotulo: "Cor de fundo" },
  { campo: "cor_texto", rotulo: "Cor do texto" },
  { campo: "cor_destaque", rotulo: "Cor de destaque" },
  { campo: "evitar", rotulo: "Evitar" },
  { campo: "texto_exato", rotulo: "Texto da lâmina" },
];

const CAMPOS_VALIDOS = ROTULOS_DOS_CAMPOS.map((r) => r.campo);
/** Campos que mudam a cena desenhada (no contínuo, o fundo panorâmico nasce de novo). */
const CAMPOS_DE_CENA: CampoDaMudanca[] = ["conceito", "fio_visual", "estilo", "imagem", "ponto_focal", "fundo", "tratamento", "cor_fundo", "foto_acervo"];

export const ehHex = (v: string) => /^#[0-9a-fA-F]{6}$/.test(v);

/** Texto mostrado para o valor de um campo. */
export function valorParaMostrar(campo: CampoDaMudanca, valor: string): string {
  if (campo === "foto_acervo") return valor === SEM_FOTO ? "Tirar a foto real e desenhar a cena" : "Usar uma foto do acervo do cliente";
  if (campo === "zona_texto") return valor.replace(/-/g, " ");
  return valor;
}

/** Os campos da mudança na ordem da tela, com rótulo e valor legível. */
export function camposParaMostrar(m: MudancaDoDiretor): { campo: CampoDaMudanca; rotulo: string; valor: string; hex: string | null }[] {
  const saida: { campo: CampoDaMudanca; rotulo: string; valor: string; hex: string | null }[] = [];
  ROTULOS_DOS_CAMPOS.forEach((r) => {
    const v = m.campos[r.campo];
    if (typeof v === "string" && v.trim()) {
      saida.push({ campo: r.campo, rotulo: r.rotulo, valor: valorParaMostrar(r.campo, v.trim()), hex: ehHex(v.trim()) ? v.trim().toUpperCase() : null });
    }
  });
  return saida;
}

/** Lê uma mudança vinda do servidor (resposta ou anexo gravado) sem confiar no formato. */
export function lerMudanca(x: unknown): MudancaDoDiretor | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>;
  const id = typeof o.id === "string" ? o.id : "";
  if (!id) return null;
  const alvo = o.alvo === "lamina" ? "lamina" : "conjunto";
  const ordem = alvo === "lamina" && typeof o.ordem === "number" && isFinite(o.ordem) ? o.ordem : null;
  const brutos = o.campos && typeof o.campos === "object" ? (o.campos as Record<string, unknown>) : {};
  const campos: Partial<Record<CampoDaMudanca, string>> = {};
  CAMPOS_VALIDOS.forEach((c) => {
    const v = brutos[c];
    if (typeof v === "string" && v.trim()) campos[c] = v;
  });
  if (!Object.keys(campos).length) return null;
  const regerar = (Array.isArray(o.regerar) ? o.regerar : [])
    .map((n) => Number(n))
    .filter((n) => isFinite(n) && n > 0 && Math.floor(n) === n);
  return {
    id,
    alvo,
    ordem,
    titulo: typeof o.titulo === "string" && o.titulo.trim() ? o.titulo : alvo === "conjunto" ? "Mudança no conjunto" : `Mudança na lâmina ${ordem}`,
    motivo: typeof o.motivo === "string" ? o.motivo : "",
    campos,
    regerar: regerar.length ? regerar : ordem !== null ? [ordem] : [],
  };
}

/** Mudanças, avisos, aplicadas e lâmina em foco guardados nos anexos da mensagem. */
export function lerAnexosDaMensagem(anexos: unknown): Pick<MensagemDoDiretor, "emFoco" | "mudancas" | "avisos" | "aplicadas"> {
  const lista = Array.isArray(anexos) ? anexos : [];
  let emFoco: number | null = null;
  let mudancas: MudancaDoDiretor[] = [];
  let avisos: string[] = [];
  let aplicadas: string[] = [];
  lista.forEach((a) => {
    if (!a || typeof a !== "object") return;
    const o = a as Record<string, unknown>;
    if (typeof o.em_foco === "number") emFoco = o.em_foco;
    if (o.tipo === "mudancas") {
      mudancas = (Array.isArray(o.mudancas) ? o.mudancas : []).map(lerMudanca).filter(Boolean) as MudancaDoDiretor[];
      avisos = (Array.isArray(o.avisos) ? o.avisos : []).filter((x) => typeof x === "string") as string[];
      aplicadas = (Array.isArray(o.aplicadas) ? o.aplicadas : []).filter((x) => typeof x === "string") as string[];
    }
  });
  return { emFoco, mudancas, avisos, aplicadas };
}

export async function lerConversaDoDiretor(trabalhoId: string): Promise<ConversaDoDiretor> {
  const { data: conversas, error } = await (supabase as any)
    .from("agente_conversas")
    .select("id")
    .eq("agente", "diretor_arte")
    .eq("referencia_tipo", REFERENCIA_DA_CONVERSA_DO_ESTUDIO)
    .eq("referencia_id", trabalhoId)
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
  const mensagens: MensagemDoDiretor[] = ((data || []) as any[])
    .slice()
    .reverse()
    .map((m) => {
      const papel: MensagemDoDiretor["papel"] = m.papel === "usuario" || m.papel === "agente" ? m.papel : "sistema";
      return { id: String(m.id), papel, conteudo: String(m.conteudo || ""), criado_em: String(m.criado_em || ""), ...lerAnexosDaMensagem(m.anexos) };
    });
  return { conversaId, mensagens };
}

// ------------------------------------------------------------------ chamadas

export interface CorpoDaConversaDoDiretor {
  trabalhoId: string;
  mensagem: string;
  ordem?: number | null;
}

export function corpoDaConversaDoDiretor(c: CorpoDaConversaDoDiretor): Record<string, unknown> {
  const corpo: Record<string, unknown> = { acao: "conversar", trabalho_id: c.trabalhoId, mensagem: c.mensagem.trim() };
  if (typeof c.ordem === "number" && c.ordem > 0) corpo.ordem = c.ordem;
  return corpo;
}

export interface CorpoDeAplicar {
  trabalhoId: string;
  mudancas: MudancaDoDiretor[];
  /** Ordens a refazer depois de aplicar (a tela refaz pelo fluxo normal). */
  regerar?: number[];
  mensagemId?: string | null;
}

export function corpoDeAplicarMudancas(c: CorpoDeAplicar): Record<string, unknown> {
  const corpo: Record<string, unknown> = {
    acao: "aplicar_mudancas",
    trabalho_id: c.trabalhoId,
    mudancas: c.mudancas.map((m) => ({ id: m.id, alvo: m.alvo, ordem: m.ordem === null ? 0 : m.ordem, titulo: m.titulo, motivo: m.motivo, campos: m.campos })),
  };
  if (c.regerar && c.regerar.length) corpo.regerar = c.regerar.slice();
  if (c.mensagemId) corpo.mensagem_id = c.mensagemId;
  return corpo;
}

export const conversarComODiretor = (c: CorpoDaConversaDoDiretor) => chamarFuncao<any>("estudio-arte", corpoDaConversaDoDiretor(c));
export const aplicarMudancasDoDiretor = (c: CorpoDeAplicar) => chamarFuncao<any>("estudio-arte", corpoDeAplicarMudancas(c));

// ------------------------------------------------------------------ estimativa e regras da tela

/** Uma chamada do diretor com o trabalho inteiro; mais a imagem da lâmina em foco, quando ela já tem arte. */
export function partesDaConversaDoDiretor(catalogo: ModeloIa[], comImagem: boolean): ParteDaEstimativa[] {
  const m = padraoPara(catalogo, "diretor_arte");
  return [
    {
      modeloId: m ? m.id : null,
      tipo: "texto",
      tokensEntrada: TAMANHO_DA_CONVERSA.entrada + (comImagem ? TAMANHOS.imagemAnexos.entrada : 0),
      tokensSaida: TAMANHO_DA_CONVERSA.saida,
    },
  ];
}

/** Lâminas a refazer depois de aplicar estas mudanças (sem repetir, em ordem). */
export function ordensParaRefazer(mudancas: MudancaDoDiretor[]): number[] {
  const vistas: Record<number, true> = {};
  const saida: number[] = [];
  mudancas.forEach((m) =>
    m.regerar.forEach((o) => {
      if (!vistas[o]) {
        vistas[o] = true;
        saida.push(o);
      }
    }),
  );
  return saida.sort((a, b) => a - b);
}

/** No carrossel contínuo, mudar a cena apaga o fundo panorâmico: o preço de refazer inclui o fundo novo. */
export function refazFundoContinuo(mudancas: MudancaDoDiretor[], continuo: boolean): boolean {
  if (!continuo) return false;
  return mudancas.some((m) => (Object.keys(m.campos) as CampoDaMudanca[]).some((c) => CAMPOS_DE_CENA.indexOf(c) >= 0));
}

export const mudancaMexeNoTexto = (m: MudancaDoDiretor) => !!(m.campos.texto_exato && m.campos.texto_exato.trim());

/** Rótulo do botão de refazer: "Aplicar e refazer a lâmina 2" ou "Aplicar e refazer 4 lâminas". */
export function rotuloDeRefazer(ordens: number[], prefixo = "Aplicar e refazer"): string {
  if (!ordens.length) return prefixo;
  return ordens.length === 1 ? `${prefixo} a lâmina ${ordens[0]}` : `${prefixo} ${ordens.length} lâminas`;
}

/** Pontos de partida para a conversa (preenchem o campo, não enviam). */
export const ATALHOS_DO_DIRETOR = [
  { rotulo: "Mudar o cenário", texto: "Quero outro cenário para as lâminas: " },
  { rotulo: "Outro estilo", texto: "Mude o estilo do conjunto para " },
  { rotulo: "Luz e clima", texto: "Deixe a luz e o clima mais " },
  { rotulo: "O que melhorar?", texto: "Olhando o conteúdo e a arte atual, o que você mudaria para ficar mais forte?" },
];

// ------------------------------------------------------------------ pedido em curso

export interface PedidoAoDiretor {
  mensagem: string;
  desde: number;
}

/**
 * Pedido em curso por trabalho, fora do componente: fechar o painel, trocar de
 * ferramenta e voltar remonta a conversa; com o andamento só no componente, o
 * "Pensando" sumia e um segundo pedido pago saía no mesmo trabalho.
 */
const pedidosEmCurso: Record<string, PedidoAoDiretor | undefined> = {};
const ouvintes: (() => void)[] = [];

export function marcarPedidoAoDiretor(trabalhoId: string, pedido: PedidoAoDiretor | null) {
  if (pedido) pedidosEmCurso[trabalhoId] = pedido;
  else delete pedidosEmCurso[trabalhoId];
  ouvintes.slice().forEach((f) => f());
}

export function pedidoAoDiretor(trabalhoId: string | null | undefined): PedidoAoDiretor | null {
  return trabalhoId ? pedidosEmCurso[trabalhoId] || null : null;
}

function ouvir(f: () => void) {
  ouvintes.push(f);
  return () => {
    const i = ouvintes.indexOf(f);
    if (i >= 0) ouvintes.splice(i, 1);
  };
}

export function usePedidoAoDiretor(trabalhoId: string | null | undefined): PedidoAoDiretor | null {
  return useSyncExternalStore(ouvir, () => pedidoAoDiretor(trabalhoId));
}
