import { useEffect, useRef, useState } from "react";
import { enviarParaAprovacao, type ParteDaEstimativa, type Qualidade, type ResultadoDoEnvio } from "@/lib/mesa/api";

/**
 * Pequenas utilidades do Estúdio: estado que sobrevive à troca de aba da Mesa
 * (sessionStorage, sempre dentro de try/catch porque o Safari em modo privado
 * recusa gravar), cópia de texto com reserva para navegador antigo, o corpo
 * do "preparar" e o envio de uma arte para aprovação.
 */

/** Quantidades de lâminas que a tela oferece antes da direção (Automático = o diretor decide). */
export const QUANTIDADES_DE_LAMINAS = [3, 4, 5, 6, 7, 8];

/**
 * Formatos do post orgânico (espelho de FORMATOS_DO_POST em
 * supabase/functions/_shared/direcao-arte.ts). 3:4 (1080 x 1440) é o retrato
 * que o Instagram passou a aceitar em 2025, o mesmo recorte da grade do perfil.
 */
export type FormatoDoPost = "feed_4x5" | "retrato_3x4" | "quadrado_1x1" | "stories_9x16";

export const FORMATOS_DO_POST: { valor: FormatoDoPost; rotulo: string; tamanho: string; dica: string; proporcao: number }[] = [
  { valor: "feed_4x5", rotulo: "4:5", tamanho: "1080 x 1350", dica: "Retrato do feed, o padrão", proporcao: 0.8 },
  { valor: "retrato_3x4", rotulo: "3:4", tamanho: "1080 x 1440", dica: "Retrato novo do Instagram: o mais alto do feed e inteiro na grade do perfil", proporcao: 0.75 },
  { valor: "quadrado_1x1", rotulo: "1:1", tamanho: "1080 x 1080", dica: "Quadrado", proporcao: 1 },
  { valor: "stories_9x16", rotulo: "9:16", tamanho: "1080 x 1920", dica: "Stories e capa de Reels", proporcao: 0.5625 },
];

/** O formato do trabalho, lido com cuidado (sem formato: 4:5, como sempre foi). */
export function formatoDoTrabalho(direcao: { formato?: unknown } | null | undefined): FormatoDoPost {
  const f = direcao ? direcao.formato : null;
  return FORMATOS_DO_POST.some((x) => x.valor === f) ? (f as FormatoDoPost) : "feed_4x5";
}

/** Largura dividida pela altura do formato (0,8 no 4:5). */
export function proporcaoDoFormato(f: FormatoDoPost): number {
  const achado = FORMATOS_DO_POST.filter((x) => x.valor === f)[0];
  return achado ? achado.proporcao : 0.8;
}

/** A versão nasceu em outro formato que o do conjunto (a entrega pede gerar de novo). Versão antiga sem a marca é 4:5. */
export function versaoForaDoFormato(versao: { formato_post?: unknown } | null | undefined, formato: FormatoDoPost): boolean {
  if (!versao) return false;
  const nasceu = FORMATOS_DO_POST.some((x) => x.valor === versao.formato_post) ? (versao.formato_post as FormatoDoPost) : "feed_4x5";
  return nasceu !== formato;
}

/** Carrossel contínuo (panorama) só existe no 4:5: nos outros formatos as lâminas saem uma a uma, em série. */
export const AVISO_CONTINUO_FORA_DO_4X5 = "O carrossel contínuo (panorama) só existe no 4:5. Neste formato as lâminas saem uma a uma, seguindo a capa como série.";

/** Reabre um trabalho entregue para corrigir (estudio-arte "reabrir"): mesmas lâminas e versões, nova rodada de entrega. */
export function corpoDoReabrir(trabalhoId: string, motivo?: string): Record<string, unknown> {
  const corpo: Record<string, unknown> = { acao: "reabrir", trabalho_id: trabalhoId };
  const m = (motivo || "").trim();
  if (m) corpo.motivo = m.slice(0, 1000);
  return corpo;
}

/**
 * Corpo do "Tirar fundo" pelo método antigo (mesa-foto preparar, modo
 * fundo_transparente), usado só quando o removedor profissional está sem
 * chave: a derivada sem fundo vai para o acervo e a tela põe na lâmina como
 * elemento. `aceitarRedesenhado` (26/09): a equipe aceita o recorte do
 * gerador mesmo sem a garantia de pixels iguais aos da foto (o servidor só
 * recebe o campo quando a equipe escolhe "Usar o recorte do gerador").
 */
export function corpoDoTirarFundo(clientId: string, imagemId: string, opcoes: { aceitarRedesenhado?: boolean } = {}): Record<string, unknown> {
  const corpo: Record<string, unknown> = { acao: "preparar", client_id: clientId, imagem_id: imagemId, modo: "fundo_transparente" };
  if (opcoes.aceitarRedesenhado) corpo.aceitar_recorte_redesenhado = true;
  return corpo;
}

/** Aviso quando o removedor profissional está sem chave e o Estúdio cai no método antigo. */
export const AVISO_DO_METODO_ANTIGO =
  "O removedor profissional ainda não tem chave: usei o método antigo, em que o gerador redesenha o assunto. Confira as bordas e o rosto.";

/**
 * O que a falha do "Tirar fundo" oferece (dono, 26/09: "quando falhar,
 * oferecer na hora usar o recorte do gerador ou tentar de novo, sem esconder
 * o erro"): `caminho` é a versão sem garantia de pixels que o servidor já
 * guardou (imagem_sem_garantia ou recorte_do_gerador nos detalhes do erro);
 * `podeAceitar` diz que o servidor aceita um novo pedido com
 * aceitar_recorte_redesenhado. Sem nenhum dos dois, só "Tentar de novo".
 */
export function ofertaDoRecorteDoGerador(detalhes: Record<string, unknown> | null | undefined): { caminho: string | null; podeAceitar: boolean } {
  const d = detalhes || {};
  const caminhoDe = (v: unknown): string | null => {
    if (typeof v === "string" && v.trim()) return v.trim();
    if (v && typeof v === "object" && typeof (v as { storage_path?: unknown }).storage_path === "string") return String((v as { storage_path: string }).storage_path);
    return null;
  };
  const caminho = caminhoDe(d.imagem_sem_garantia) || caminhoDe(d.recorte_do_gerador);
  const podeAceitar = d.aceita_recorte_redesenhado === true || d.pode_aceitar_redesenhado === true;
  return { caminho, podeAceitar };
}

/** A foto do acervo já é um recorte sem fundo (preparada na Mesa Foto). */
export function jaSemFundo(imagem: { tags?: string[] | null; modo?: string | null } | null | undefined): boolean {
  if (!imagem) return false;
  return (imagem.tags || []).indexOf("preparo:fundo_transparente") >= 0 || imagem.modo === "recorte" || imagem.modo === "sem_fundo";
}

export interface EscolhasDoPreparo {
  /** "roteiro": direção do roteiro do estrategista, sem custo. "diretor": diretor de arte, com custo. */
  modo: "roteiro" | "diretor";
  /** Quantidade de lâminas; null = automático (o diretor decide pelo conteúdo). */
  laminas: number | null;
  /** Carrossel contínuo decidido no começo (a cena atravessa as lâminas). */
  continuo: boolean;
  /** Pedido livre para o diretor (ex.: use fotos reais, capa centralizada). */
  pedido: string;
  /** Formato do post (4:5 quando não vem). */
  formato?: FormatoDoPost;
}

/**
 * Corpo da ação "preparar" do estudio-arte. Post de uma lâmina só não leva
 * quantidade nem contínuo. Quantidade e pedido só valem para o diretor: no
 * roteiro, as lâminas são as do estrategista (e um pedido viraria diretor, com custo).
 */
export function corpoDoPreparar(
  taskId: string,
  e: EscolhasDoPreparo,
  extra: { postUnico: boolean; modeloImagemId?: string; qualidade?: string; trabalhoId?: string } = { postUnico: false },
): Record<string, unknown> {
  const corpo: Record<string, unknown> = { acao: "preparar", task_id: taskId, modo: e.modo };
  if (extra.modeloImagemId) corpo.modelo_imagem_id = extra.modeloImagemId;
  if (extra.qualidade) corpo.qualidade = extra.qualidade;
  if (extra.trabalhoId) corpo.trabalho_id = extra.trabalhoId;
  if (e.formato && e.formato !== "feed_4x5") corpo.formato = e.formato;
  if (!extra.postUnico) {
    corpo.carrossel_infinito = !!e.continuo;
    const n = Number(e.laminas);
    if (e.modo === "diretor" && e.laminas !== null && Number.isInteger(n) && n >= 1 && n <= 10) corpo.laminas = n;
  }
  const pedido = (e.pedido || "").trim();
  if (e.modo === "diretor" && pedido) corpo.instrucao = pedido.slice(0, 2000);
  return corpo;
}

/**
 * Envia uma arte entregue para aprovação (mesmo caminho da aba Entrega) e
 * confere o resultado dela: a RPC responde 200 mesmo quando a arte não foi.
 */
export async function enviarUmParaAprovacao(trabalhoId: string): Promise<ResultadoDoEnvio> {
  const resultados = await enviarParaAprovacao([trabalhoId]);
  const r = resultados[0];
  if (!r) throw new Error("O envio não voltou resposta. Confira na aba Entrega.");
  if (!r.ok) throw new Error(r.erro || "Não foi possível enviar para aprovação.");
  return r;
}

function lerDaSessao<T>(chave: string, inicial: T): T {
  try {
    const bruto = window.sessionStorage.getItem(chave);
    if (bruto === null) return inicial;
    const valor = JSON.parse(bruto);
    return valor === null || valor === undefined ? inicial : (valor as T);
  } catch {
    return inicial;
  }
}

function gravarNaSessao(chave: string, valor: unknown) {
  try {
    window.sessionStorage.setItem(chave, JSON.stringify(valor));
  } catch {
    /* sem sessionStorage: o estado vale só enquanto a tela estiver aberta */
  }
}

/**
 * useState que também guarda o valor na sessão do navegador, pela chave.
 * Trocar de aba da Mesa desmonta o Estúdio; na volta, o valor é relido.
 */
export function useEstadoGuardado<T>(chave: string, inicial: T): [T, (v: T | ((anterior: T) => T)) => void] {
  const [valor, setValor] = useState<T>(() => lerDaSessao(chave, inicial));
  const chaveAtual = useRef(chave);
  useEffect(() => {
    if (chaveAtual.current !== chave) {
      chaveAtual.current = chave;
      setValor(lerDaSessao(chave, inicial));
    }
    // a chave muda quando muda o item; o inicial é só o padrão
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave]);
  const definir = (v: T | ((anterior: T) => T)) => {
    setValor((anterior) => {
      const novo = typeof v === "function" ? (v as (a: T) => T)(anterior) : v;
      gravarNaSessao(chaveAtual.current, novo);
      return novo;
    });
  };
  return [valor, definir];
}

/** Copia texto: API moderna quando existe, senão textarea escondido e execCommand. */
export async function copiarTexto(texto: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      await navigator.clipboard.writeText(texto);
      return true;
    }
  } catch {
    /* cai na reserva */
  }
  try {
    const area = document.createElement("textarea");
    area.value = texto;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.top = "0";
    area.style.left = "0";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.focus();
    area.select();
    area.setSelectionRange(0, texto.length);
    const ok = document.execCommand("copy");
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}

/** Hashtags limpas, cada uma com um # só. */
export function normalizarHashtags(lista: unknown): string[] {
  if (!Array.isArray(lista)) return [];
  const saida: string[] = [];
  for (const bruto of lista) {
    let t = String(bruto || "").trim();
    while (t.charAt(0) === "#") t = t.slice(1);
    t = t.split(" ").join("");
    if (t && saida.indexOf(`#${t}`) < 0) saida.push(`#${t}`);
  }
  return saida;
}

/** Legenda pronta para colar: legenda, uma linha em branco e as hashtags. */
export function legendaParaCopiar(legenda: string, hashtags: string[]): string {
  const corpo = (legenda || "").trim();
  const tags = hashtags.join(" ").trim();
  if (!tags) return corpo;
  if (!corpo) return tags;
  return `${corpo}\n\n${tags}`;
}

export interface Area {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const limitar = (v: number) => Math.max(0, Math.min(1, v));
const tres = (v: number) => Math.round(v * 1000) / 1000;

/** Retângulo normalizado (x0 < x1, y0 < y1), dentro de 0 a 1, com 3 casas. */
export function normalizarArea(a: Area): Area {
  return {
    x0: tres(limitar(Math.min(a.x0, a.x1))),
    y0: tres(limitar(Math.min(a.y0, a.y1))),
    x1: tres(limitar(Math.max(a.x0, a.x1))),
    y1: tres(limitar(Math.max(a.y0, a.y1))),
  };
}

// ---------------------------------------------- fundo do carrossel contínuo

/** Lâminas por trecho do panorama (espelho de LAMINAS_POR_TRECHO em supabase/functions/_shared/direcao-arte.ts). */
export const LAMINAS_POR_TRECHO = 3;
/** Tamanho de uma lâmina no panorama (espelho de imagem-local.ts): o trecho tem LARGURA 1088*k x 1360. */
export const LARGURA_DA_LAMINA_NO_PANORAMA = 1088;
export const ALTURA_DA_LAMINA_NO_PANORAMA = 1360;
/** Área da imagem que o preço por imagem do catálogo cobre (1024 x 1536). */
const AREA_DA_IMAGEM_DO_PRECO = 1024 * 1536;

/** Frase do preço quando a estimativa soma o panorama que falta. */
export const NOTA_DO_FUNDO_CONTINUO = "Inclui o fundo contínuo";

/**
 * Trecho do panorama que contém a lâmina (espelho do servidor): 1 a 3,
 * depois 3 a 5, 5 a 7... (a primeira de cada trecho liga ao anterior).
 */
export function trechoDaLamina(ordem: number, total: number): { inicio: number; fim: number } {
  if (total <= LAMINAS_POR_TRECHO || ordem <= LAMINAS_POR_TRECHO) return { inicio: 1, fim: Math.min(LAMINAS_POR_TRECHO, total) };
  const j = Math.ceil((ordem - LAMINAS_POR_TRECHO) / (LAMINAS_POR_TRECHO - 1));
  const inicio = j * (LAMINAS_POR_TRECHO - 1) + 1;
  return { inicio, fim: Math.min(inicio + LAMINAS_POR_TRECHO - 1, total) };
}

/**
 * Quantas imagens de preço um trecho de k lâminas vale: a área dele
 * (k*1088 x 1360) sobre a da imagem do preço (1024 x 1536), arredondada
 * para cima em 1 casa (k=1: 1,0; k=2: 1,9; k=3: 2,9).
 */
export function fatorDoTrecho(k: number): number {
  const razao = (k * LARGURA_DA_LAMINA_NO_PANORAMA * ALTURA_DA_LAMINA_NO_PANORAMA) / AREA_DA_IMAGEM_DO_PRECO;
  return Math.ceil(razao * 10 - 1e-9) / 10;
}

export interface TrechoQueFalta {
  inicio: number;
  fim: number;
  k: number;
  fator: number;
}

/**
 * O modelo de imagem faz o panorama do contínuo (espelho de modeloFazPanorama
 * em supabase/functions/_shared/carrossel-continuo.ts): GPT Image direto na
 * OpenAI ou pelo OpenRouter. Os outros geradores fazem as lâminas uma a uma.
 */
export function modeloFazContinuo(m: { provedor?: string | null; modelo_api?: string | null } | null | undefined): boolean {
  if (!m) return false;
  const api = String(m.modelo_api || "");
  if (m.provedor === "openai") return /^gpt-image/.test(api);
  if (m.provedor === "openrouter") return /^openai\/gpt-image/.test(api);
  return false;
}

/** Aviso da tela quando o contínuo está ligado e o modelo não faz o panorama. */
export const AVISO_CONTINUO_SEM_MODELO =
  "O modelo de imagem escolhido não faz o carrossel contínuo: as lâminas saem uma a uma, sem o fundo panorâmico. Para o contínuo, escolha um GPT Image.";

/**
 * A versão foi feita sobre um fundo panorâmico que não é mais o da lâmina
 * (espelho de versaoForaDoFundo do servidor): ela não emenda com as vizinhas.
 */
export function versaoForaDoFundo(
  versao: { ordem: number; modo?: unknown; fundo?: unknown } | null | undefined,
  panorama: { fundos?: Record<string, string> | null } | null | undefined,
): boolean {
  if (!versao || versao.modo !== "panorama" || typeof versao.fundo !== "string" || !versao.fundo) return false;
  const atual = panorama && panorama.fundos ? panorama.fundos[String(versao.ordem)] : undefined;
  return atual !== versao.fundo;
}

/** Quantas vezes a tela chama preparar_fundo antes de gerar: um trecho por chamada (mais folga). */
export function limiteDePreparos(total: number): number {
  return Math.min(10, Math.max(2, Math.ceil(total / (LAMINAS_POR_TRECHO - 1)) + 2));
}

/** A lâmina usa o fundo panorâmico: tem layout e não tem foto própria (acervo ou foto real composta). */
export function usaFundoContinuo(card: { layout?: unknown; imagens_ids?: string[] | null; fotos_livres?: unknown[] | null }): boolean {
  return !!card.layout && !(card.imagens_ids && card.imagens_ids.length) && !(card.fotos_livres && card.fotos_livres.length);
}

/**
 * Qualidade em que a lâmina é gerada de fato (27/09): com referência escolhida
 * pela equipe (da lâmina ou do conjunto) e fora do fundo contínuo, o servidor
 * gera no modo replicar referência sempre em qualidade alta (o molde tem
 * tipografia grande e detalhe que a média borrava). O preço à vista segue isso.
 */
export function qualidadeNaGeracao(
  card: { referencias_ids?: string[] | null } | null | undefined,
  refsDoConjunto: string[] | null | undefined,
  noFundoContinuo: boolean,
  escolhida: "baixa" | "media" | "alta",
): "baixa" | "media" | "alta" {
  const refs = card && card.referencias_ids && card.referencias_ids.length ? card.referencias_ids : refsDoConjunto || [];
  return refs.length > 0 && !noFundoContinuo ? "alta" : escolhida;
}

/**
 * Trechos do panorama que ainda vão ser gerados para as lâminas pedidas:
 * só os das lâminas cujo fundo ainda não existe em panorama.fundos, cada
 * trecho uma vez. Como no servidor, um trecho depois do primeiro precisa do
 * fundo da lâmina de ligação (a primeira dele): se ela ainda não tem fundo,
 * o trecho anterior também entra.
 */
export function trechosQueFaltam(
  ordens: number[],
  total: number,
  fundos: Record<string, string> | null | undefined,
): TrechoQueFalta[] {
  const tem: Record<number, boolean> = {};
  if (fundos) for (const k of Object.keys(fundos)) if (fundos[k]) tem[Number(k)] = true;
  const saida: TrechoQueFalta[] = [];
  const garantir = (ordem: number, profundidade: number) => {
    if (tem[ordem] || profundidade > 50) return;
    const { inicio, fim } = trechoDaLamina(ordem, total);
    if (inicio > 1 && !tem[inicio]) garantir(inicio, profundidade + 1);
    if (tem[ordem]) return;
    const k = fim - inicio + 1;
    saida.push({ inicio, fim, k, fator: fatorDoTrecho(k) });
    for (let o = inicio; o <= fim; o++) tem[o] = true;
  };
  const pedidas = ordens
    .filter((o, i) => Number.isInteger(o) && o >= 1 && o <= total && ordens.indexOf(o) === i)
    .sort((a, b) => a - b);
  if (total < 2) return saida;
  for (const o of pedidas) garantir(o, 0);
  return saida;
}

/**
 * Custo do panorama que falta para gerar as lâminas pedidas: por trecho, o
 * preço de UMA imagem na qualidade escolhida vezes o fator de área do trecho.
 */
export function custoDoPanorama(
  ordens: number[],
  total: number,
  fundos: Record<string, string> | null | undefined,
  precoDeUmaImagem: number,
): number {
  const fator = trechosQueFaltam(ordens, total, fundos).reduce((s, t) => s + t.fator, 0);
  return Math.round(fator * precoDeUmaImagem * 1000000) / 1000000;
}

/**
 * O mesmo custo como partes da estimativa (uma imagem na qualidade, repetida
 * pelo fator de cada trecho): o BotaoComCusto soma com as da lâmina.
 */
export function partesDoPanorama(
  ordens: number[],
  total: number,
  fundos: Record<string, string> | null | undefined,
  modeloImagemId: string | null | undefined,
  qualidade: Qualidade,
): ParteDaEstimativa[] {
  if (!modeloImagemId) return [];
  return trechosQueFaltam(ordens, total, fundos).map((t) => ({ modeloId: modeloImagemId, tipo: "imagem" as const, imagens: 1, qualidade, vezes: t.fator }));
}

// ------------------------------------------------ trabalho gravado no cache

/** O mínimo do trabalho que o configurar devolve (a linha inteira de estudio_trabalhos). */
export interface TrabalhoGravado {
  id: string;
  task_id: string | null;
  [campo: string]: unknown;
}

interface ClienteDoCache {
  setQueriesData: (filtro: { queryKey: readonly unknown[] }, atualizar: (antes: any) => any) => unknown;
}

/**
 * Troca o trabalho no JSON de uma consulta da lista (DadosDosItens) quando o
 * id bate. Função pura: devolve o mesmo objeto se nada mudou.
 */
export function comTrabalhoTrocado<T extends { trabalhos?: Record<string, { id?: string }> }>(dados: T | undefined, trabalho: TrabalhoGravado): T | undefined {
  if (!dados || !dados.trabalhos || !trabalho || !trabalho.task_id) return dados;
  const atual = dados.trabalhos[trabalho.task_id];
  if (!atual || atual.id !== trabalho.id) return dados;
  const trabalhos = { ...dados.trabalhos, [trabalho.task_id]: { ...atual, ...trabalho } };
  return { ...dados, trabalhos };
}

/**
 * "Salvar na lâmina não atualiza" (dono, 25/09): o configurar gravava e a
 * tela esperava a lista inteira do mês ser relida (projetos, tarefas,
 * trabalhos, artes e publicações) para mostrar a mudança. Agora o trabalho
 * que a função devolve entra no cache na hora, na lista do mês e no item
 * avulso; a releitura continua depois, só para confirmar.
 */
export function gravarTrabalhoNoCache(queryClient: ClienteDoCache, clientId: string, trabalho: TrabalhoGravado | null | undefined) {
  if (!trabalho || !trabalho.id) return;
  queryClient.setQueriesData({ queryKey: ["mesa", "itens-do-mes", clientId] }, (antes) => comTrabalhoTrocado(antes, trabalho));
  queryClient.setQueriesData({ queryKey: ["mesa", "item-avulso", clientId] }, (antes) => comTrabalhoTrocado(antes, trabalho));
}

// ------------------------------------------------------------ referência na hora

/** Máximo de referências por lâmina ou conjunto (espelho de MAX_NO_ESTUDIO em ReferenciasDoEstudio). */
const MAX_REFERENCIAS_NA_HORA = 2;

/** O texto colado é um link só (https ou http), sem espaço: vira referência pelo servidor. */
export function ehLinkColado(texto: string | null | undefined): boolean {
  const t = String(texto || "").trim();
  if (!t || t.length > 2048 || /\s/.test(t)) return false;
  return /^https?:\/\/[^/\s]+\.[^/\s]+/i.test(t);
}

/**
 * A referência que acabou de chegar (arrastada, escolhida, colada ou por link)
 * entra na hora na lista escolhida, por último; passou de 2, sai a mais antiga.
 */
export function juntarReferenciaNaHora(escolhidas: string[], id: string, max = MAX_REFERENCIAS_NA_HORA): { ids: string[]; saiu: string | null } {
  const sem = escolhidas.filter((x) => x !== id);
  const ids = sem.concat([id]);
  if (ids.length <= max) return { ids, saiu: null };
  return { ids: ids.slice(ids.length - max), saiu: ids[0] };
}

/** Corpo do importar link (Pinterest, Behance, endereço de imagem ou página com imagem de capa). */
export function corpoDoImportarLink(clientId: string, url: string, marca: Record<string, unknown> = {}): Record<string, unknown> {
  return { acao: "referencias", subacao: "importar_link", client_id: clientId, url: url.trim(), ...marca };
}

// ------------------------------------------------------------ logo da lâmina

/** Qual logo do kit a lâmina usa (espelho de EscolhaDaLogo em supabase/functions/_shared/direcao-arte.ts). */
export type EscolhaDaLogo = "auto" | "principal" | "alternativa";

export const ROTULO_DA_LOGO: Record<EscolhaDaLogo, string> = { auto: "Automática", principal: "Principal", alternativa: "Alternativa" };

/** A lâmina leva logo: a capa e a última (espelho de levaLogo do servidor). */
export const laminaLevaLogo = (ordem: number, total: number) => ordem === 1 || ordem === total;

/** Corpo do configurar da logo: na lâmina (null volta para a do conjunto) ou no conjunto. */
export function corpoDaLogo(alvo: "lamina" | "conjunto", escolha: EscolhaDaLogo | null, ordem?: number): Record<string, unknown> {
  if (alvo === "lamina") return { card: { ordem, logo: escolha } };
  return { conjunto: { logo_escolhida: escolha || "auto" } };
}

// ------------------------------------------------------------ refinar texto

/** Objetivos do "Refinar texto" (espelho de OBJETIVOS_DO_REFINO em supabase/functions/estudio-arte/refinar-texto.ts). */
export const OBJETIVOS_DO_REFINO: { id: string; rotulo: string }[] = [
  { id: "mais_curto", rotulo: "Mais curto" },
  { id: "mais_forte", rotulo: "Mais forte" },
  { id: "mais_claro", rotulo: "Mais claro" },
  { id: "gancho", rotulo: "Gancho melhor" },
  { id: "cta", rotulo: "CTA melhor" },
  { id: "tom_da_marca", rotulo: "Tom da marca" },
];

/** Corpo do refinar_texto: só o que a equipe escolheu; texto vazio usa o gravado. */
export function corpoDoRefinar(
  trabalhoId: string,
  e: { alvo: "lamina" | "legenda"; ordem?: number; texto?: string; objetivos: string[]; framework?: string; pedido?: string },
): Record<string, unknown> {
  const corpo: Record<string, unknown> = { acao: "refinar_texto", trabalho_id: trabalhoId, alvo: e.alvo, objetivos: e.objetivos.slice(0, 4) };
  if (e.alvo === "lamina" && typeof e.ordem === "number") corpo.ordem = e.ordem;
  const t = (e.texto || "").trim();
  if (t) corpo.texto = t;
  if (e.framework) corpo.framework = e.framework;
  const p = (e.pedido || "").trim();
  if (p) corpo.pedido = p.slice(0, 600);
  return corpo;
}
