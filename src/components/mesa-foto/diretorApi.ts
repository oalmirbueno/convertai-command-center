import { useEffect, useState } from "react";
import { useQuery, type QueryClient } from "@tanstack/react-query";
import { chamarFuncao } from "@/lib/mesa/api";
import { acaoDoAnexo, type AcaoDoAgente, type ResultadoDoItem } from "@/lib/agentes/acoesDoAgente";
import { lerEstadoDaTela } from "@/components/sistema/useEstadoDaTela";

/**
 * Diretor de fotografia agêntico (pedido do dono, 26/09: "o diretor não é
 * agente"; regras em supabase/functions/mesa-foto/diretor-agentico.ts).
 *
 * - Foco da tela: a etapa aberta, o que está aberto nela (clone, book,
 *   modelo, canvas, produto) e o que está marcado. Vai em todo pedido ao
 *   diretor; ele trabalha nisso sem o dono explicar nem reenviar.
 * - Contexto do cliente: o servidor monta o pacote sem IA (diretor_contexto)
 *   ao abrir e ao trocar de cliente ou de etapa; a tela guarda 1 minuto e a
 *   página já carrega com a lateral recolhida.
 * - Geração: uma foto por chamada (diretor_executar_item), só depois do
 *   Confirmar com o custo à vista; a lista da etapa atualiza a cada foto.
 */

export interface FocoDoDiretor {
  etapa: string;
  kit_id: string | null;
  ensaio_id: string | null;
  clone_id: string | null;
  persona_id: string | null;
  book_id: string | null;
  canvas_id: string | null;
  imagem_ids: string[];
  prompt_ids: string[];
}

/** O que cada etapa guarda como "aberto" (as mesmas chaves do useEstadoDaTela das etapas). */
export const CHAVES_DO_ABERTO = {
  clone: (clientId: string) => `mesa-foto:clones:aberto:${clientId}`,
  book: (clientId: string) => `mesa-foto:book:aberto:${clientId}`,
  persona: (clientId: string) => `mesa-foto:modelos:aberta:${clientId}`,
  canvas: (clientId: string) => `mesa-foto:canvas:aberto:${clientId}`,
};

const ehUuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const abertoNaEtapa = (chave: string) => {
  const v = lerEstadoDaTela<string | null>(chave, null, (x) => x === null || typeof x === "string");
  return ehUuid(v) ? v : null;
};

// ------------------------------------------------------------------ seleção publicada pelas etapas

/** Seleção de dentro de uma etapa (ex.: variações marcadas no clone), por cliente. */
let selecoes: Record<string, string[]> = {};
const ouvintesDaSelecao: Array<() => void> = [];

export function publicarSelecao(clientId: string, etapa: string, ids: string[]) {
  const chave = `${clientId}|${etapa}`;
  const limpos = ids.filter(ehUuid).slice(0, 24);
  const antes = selecoes[chave] || [];
  if (antes.join(",") === limpos.join(",")) return;
  const copia: Record<string, string[]> = { ...selecoes };
  if (limpos.length) copia[chave] = limpos;
  else delete copia[chave];
  selecoes = copia;
  ouvintesDaSelecao.slice().forEach((f) => f());
}

export function selecaoPublicada(clientId: string, etapa: string): string[] {
  return selecoes[`${clientId}|${etapa}`] || [];
}

function ouvirSelecoes(f: () => void) {
  ouvintesDaSelecao.push(f);
  return () => {
    const i = ouvintesDaSelecao.indexOf(f);
    if (i >= 0) ouvintesDaSelecao.splice(i, 1);
  };
}

/** A etapa diz ao diretor o que está marcado nela (some ao sair da etapa). */
export function useSelecaoParaODiretor(clientId: string, etapa: string, ids: string[]) {
  const chave = ids.join(",");
  useEffect(() => {
    if (!clientId) return undefined;
    publicarSelecao(clientId, etapa, ids);
    return () => publicarSelecao(clientId, etapa, []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, etapa, chave]);
}

// ------------------------------------------------------------------ foco da tela

/**
 * O foco que vai com o pedido: a etapa, o aberto dela (só o da etapa em que o
 * dono está) e as fotos marcadas (as da etapa primeiro, depois as do passo 1).
 */
export function focoDaTela(p: { clientId: string; etapa: string; selecionadas: string[]; kitId: string | null; ensaioId: string | null }): FocoDoDiretor {
  const e = p.etapa || "acervo";
  const daEtapa = selecaoPublicada(p.clientId, e);
  const imagens: string[] = [];
  daEtapa.concat(p.selecionadas || []).forEach((id) => {
    if (ehUuid(id) && imagens.indexOf(id) < 0) imagens.push(id);
  });
  return {
    etapa: e,
    kit_id: ehUuid(p.kitId) ? p.kitId : null,
    ensaio_id: ehUuid(p.ensaioId) ? p.ensaioId : null,
    clone_id: e === "clones" ? abertoNaEtapa(CHAVES_DO_ABERTO.clone(p.clientId)) : null,
    persona_id: e === "modelos" ? abertoNaEtapa(CHAVES_DO_ABERTO.persona(p.clientId)) : null,
    book_id: e === "book" ? abertoNaEtapa(CHAVES_DO_ABERTO.book(p.clientId)) : null,
    canvas_id: e === "canvas" ? abertoNaEtapa(CHAVES_DO_ABERTO.canvas(p.clientId)) : null,
    imagem_ids: imagens.slice(0, 24),
    prompt_ids: e === "biblioteca" ? selecaoPublicada(p.clientId, "biblioteca-prompts") : [],
  };
}

export const chaveDoFoco = (f: FocoDoDiretor) =>
  [f.etapa, f.kit_id, f.ensaio_id, f.clone_id, f.persona_id, f.book_id, f.canvas_id, f.imagem_ids.join(","), f.prompt_ids.join(",")].join("|");

/**
 * O foco atual, relido quando a etapa publica seleção e a cada 1,5 s (o
 * clone ou o book aberto mudam dentro da etapa, sem avisar a página).
 * Mesmo foco não troca o objeto (nada recarrega à toa).
 */
export function useFocoDoDiretor(clientId: string, etapa: string, selecionadas: string[], kitId: string | null, ensaioId: string | null): FocoDoDiretor {
  const calcular = () => focoDaTela({ clientId, etapa, selecionadas, kitId, ensaioId });
  const [foco, setFoco] = useState<FocoDoDiretor>(calcular);
  const chaveDaSelecao = selecionadas.join(",");
  useEffect(() => {
    const atualizar = () => setFoco((f) => {
      const n = calcular();
      return chaveDoFoco(n) === chaveDoFoco(f) ? f : n;
    });
    atualizar();
    const id = window.setInterval(atualizar, 1500);
    const sair = ouvirSelecoes(atualizar);
    return () => {
      window.clearInterval(id);
      sair();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, etapa, chaveDaSelecao, kitId, ensaioId]);
  return foco;
}

// ------------------------------------------------------------------ contexto do cliente

export interface ContextoDoDiretor {
  etapa: string;
  resumo: string;
  foco_rotulo: string;
  contagens: { fotos: number; clones: number; prompts: number; books: number; kits: number; modelos: number; lidas: number };
  /** Fotos que a próxima mensagem vai ler por visão (custo pequeno, uma vez por imagem). */
  sem_leitura: number;
  contexto: { marca: string | null; cerebro: boolean; dossie: boolean; campanha: string | null };
}

const numero = (v: unknown) => (typeof v === "number" && isFinite(v) ? v : Number(v) || 0);
const texto = (v: unknown) => (typeof v === "string" ? v : "");

export function normalizarContextoDoDiretor(data: any): ContextoDoDiretor {
  const d = data && typeof data === "object" ? data : {};
  const c = d.contagens && typeof d.contagens === "object" ? d.contagens : {};
  const x = d.contexto && typeof d.contexto === "object" ? d.contexto : {};
  return {
    etapa: texto(d.etapa),
    resumo: texto(d.resumo),
    foco_rotulo: texto(d.foco_rotulo),
    contagens: {
      fotos: numero(c.fotos),
      clones: numero(c.clones),
      prompts: numero(c.prompts),
      books: numero(c.books),
      kits: numero(c.kits),
      modelos: numero(c.modelos),
      lidas: numero(c.lidas),
    },
    sem_leitura: numero(d.sem_leitura),
    contexto: { marca: texto(x.marca) || null, cerebro: !!x.cerebro, dossie: !!x.dossie, campanha: texto(x.campanha) || null },
  };
}

export const chaveDoContextoDoDiretor = (clientId: string, foco: FocoDoDiretor) => ["mesa-foto", "diretor-contexto", clientId, chaveDoFoco(foco)];

export async function lerContextoDoDiretor(clientId: string, foco: FocoDoDiretor): Promise<ContextoDoDiretor> {
  const data = await chamarFuncao<any>("mesa-foto", { acao: "diretor_contexto", client_id: clientId, foco });
  return normalizarContextoDoDiretor(data);
}

/**
 * O pacote do cliente para o cabeçalho do diretor. Troca de cliente troca a
 * chave (nada do cliente anterior aparece); troca de etapa mantém o resumo
 * anterior à vista até o novo chegar (sem piscar).
 */
export function useContextoDoDiretor(clientId: string, foco: FocoDoDiretor) {
  return useQuery({
    queryKey: chaveDoContextoDoDiretor(clientId, foco),
    enabled: !!clientId,
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    retry: 1,
    placeholderData: (anterior: ContextoDoDiretor | undefined, consulta: { queryKey: readonly unknown[] } | undefined) =>
      consulta && consulta.queryKey[2] === clientId ? anterior : undefined,
    queryFn: () => lerContextoDoDiretor(clientId, foco),
  });
}

// ------------------------------------------------------------------ geração item a item

export interface RespostaDoItem {
  anexo: AcaoDoAgente | null;
  resultado: ResultadoDoItem | null;
  custo_usd: number;
  repetido: boolean;
}

export async function executarItemDoDiretor(mensagemId: string, acaoId: string, ref: string): Promise<RespostaDoItem> {
  const data = await chamarFuncao<any>("mesa-foto", { acao: "diretor_executar_item", mensagem_id: mensagemId, acao_id: acaoId, ref });
  const d = data && typeof data === "object" ? data : {};
  return {
    anexo: acaoDoAnexo(d.anexo),
    resultado: d.resultado && typeof d.resultado === "object" ? (d.resultado as ResultadoDoItem) : null,
    custo_usd: numero(d.custo_usd),
    repetido: d.repetido === true,
  };
}

/**
 * Confirmar a geração: uma foto por vez, na ordem da lista. Item já feito
 * volta do servidor sem gerar de novo (pode confirmar outra vez depois de uma
 * queda). Erro de rede para o laço; o que já saiu fica.
 */
export async function confirmarGeracaoItemAItem(p: {
  mensagemId: string;
  acao: AcaoDoAgente;
  aoAvancar?: (feitos: number, total: number, anexo: AcaoDoAgente | null, resposta: RespostaDoItem) => void;
  aoComecarItem?: (indice: number, total: number) => void;
  executar?: (mensagemId: string, acaoId: string, ref: string) => Promise<RespostaDoItem>;
}): Promise<{ anexo: AcaoDoAgente | null; custo_usd: number }> {
  const executar = p.executar || executarItemDoDiretor;
  const feitosAntes = (p.acao.resultados || []).map((r) => r.ref);
  const pendentes = p.acao.itens.filter((i) => feitosAntes.indexOf(i.ref) < 0);
  const total = p.acao.itens.length;
  let anexo: AcaoDoAgente | null = null;
  let custo = 0;
  let feitos = feitosAntes.length;
  for (let k = 0; k < pendentes.length; k++) {
    if (p.aoComecarItem) p.aoComecarItem(feitos, total);
    const r = await executar(p.mensagemId, p.acao.id, pendentes[k].ref);
    if (r.anexo) anexo = r.anexo;
    custo += r.custo_usd;
    feitos += 1;
    if (p.aoAvancar) p.aoAvancar(feitos, total, anexo, r);
  }
  return { anexo, custo_usd: Math.round(custo * 1e6) / 1e6 };
}

// ------------------------------------------------------------------ a tela atualiza sozinha

/** Chaves das listas da Mesa Foto (as mesmas de fotoApi, clonesApi, bookApi e canvasApi). */
export const CHAVES_DAS_LISTAS = {
  fotos: (clientId: string) => ["mesa-foto", "acervo", clientId],
  clones: (clientId: string) => ["mesa-foto", "clones", clientId],
  clone: (id: string) => ["mesa-foto", "clone", id],
  books: (clientId: string) => ["mesa-foto", "books", clientId],
  book: (id: string) => ["mesa-foto", "book", id],
  canvases: (clientId: string) => ["mesa-foto", "canvases", clientId],
  contexto: (clientId: string) => ["mesa-foto", "diretor-contexto", clientId],
};

/**
 * Depois de uma ação ou de cada foto gerada: relê as listas que ela mexeu
 * (a etapa mostra o novo sem piscar; as listas já guardam o anterior durante
 * a releitura e as fotos usam o endereço estável).
 */
export function atualizarTelasDepoisDoDiretor(queryClient: QueryClient, clientId: string, acao: AcaoDoAgente | null) {
  const inv = (queryKey: unknown[]) => void queryClient.invalidateQueries({ queryKey });
  inv(CHAVES_DAS_LISTAS.fotos(clientId));
  inv(["mesa", "acervo-mesa-foto", clientId]);
  inv(CHAVES_DAS_LISTAS.contexto(clientId));
  if (!acao) return;
  const clones: string[] = [];
  const books: string[] = [];
  let canvas = false;
  const pedidos = (acao.contexto && (acao.contexto as Record<string, any>).pedidos) || {};
  acao.itens.forEach((i) => {
    const pd = pedidos[i.ref];
    if (pd && pd.clone_id && clones.indexOf(pd.clone_id) < 0) clones.push(pd.clone_id);
    if (i.operacao === "fotos_do_clone" && clones.indexOf(i.alvo_id) < 0) clones.push(i.alvo_id);
    if (i.operacao === "gerar_no_book" && books.indexOf(i.alvo_id) < 0) books.push(i.alvo_id);
    if (i.operacao === "levar_ao_canvas") canvas = true;
  });
  (acao.resultados || []).forEach((r) => {
    const x = (r.desfazer || {}) as Record<string, unknown>;
    if (typeof x.book_id === "string" && x.book_id && books.indexOf(x.book_id) < 0) books.push(x.book_id);
    if (typeof x.clone_id === "string" && x.clone_id && clones.indexOf(x.clone_id) < 0) clones.push(x.clone_id);
  });
  if (clones.length || acao.itens.some((i) => i.operacao === "montar_book")) inv(CHAVES_DAS_LISTAS.clones(clientId));
  clones.forEach((id) => inv(CHAVES_DAS_LISTAS.clone(id)));
  if (books.length || acao.itens.some((i) => i.operacao === "montar_book" || i.operacao === "gerar_do_prompt")) inv(CHAVES_DAS_LISTAS.books(clientId));
  books.forEach((id) => inv(CHAVES_DAS_LISTAS.book(id)));
  if (canvas) inv(CHAVES_DAS_LISTAS.canvases(clientId));
}

/** Custo estimado da proposta para o botão ("~US$ 0,42"; incompleto ganha "+"). */
export function custoDaProposta(acao: AcaoDoAgente): { valor: number | null; incompleto: boolean } {
  const incompleto = !!(acao.contexto && (acao.contexto as Record<string, unknown>).custo_incompleto);
  const v = acao.custo_estimado_usd;
  return { valor: typeof v === "number" && isFinite(v) ? v : null, incompleto };
}
