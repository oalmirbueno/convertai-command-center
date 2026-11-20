/**
 * MCP 2.38.0 (20/11/2026), 2.38.1 (nomes com extensão): regras puras do carrossel de Arquivos (sem Deno,
 * sem banco, sem import): o MCP (Deno) e o teste do painel (vitest) leem o
 * mesmo arquivo.
 *
 * Caso real (agente Orion): o upload do MCP cria cada card como arquivo
 * solto (parent_file_id nulo) e o cliente recebe 5 aprovações em vez de
 * "Carrossel · 5". Aqui moram as regras para agrupar sem mover nada no
 * storage e para enviar pela raiz.
 *
 * Modelo do painel (o mesmo do Estúdio, estudio-arte entregar, e de
 * src/lib/reviewToApproval.ts):
 * - raiz: parent_file_id nulo, file_type 'carrossel', folder 'materiais',
 *   caption com a legenda, nome sem sufixo;
 * - filhos: parent_file_id = raiz, mesmo client_id/project_id, nome
 *   "<nome> (i/N)", caption nula;
 * - não há coluna de ordem: a ordem sai de src/lib/editorialMedia.ts
 *   (orderEditorialCarouselFiles): número no início do último segmento do
 *   storage_path, senão "(i/N)" (ou card/slide N, ou número inicial) no
 *   nome, senão created_at e id. A raiz é sempre o primeiro card.
 * As funções de ordem abaixo são CÓPIA fiel dessas (o teste
 * src/test/mcp-carrossel-de-arquivos.test.ts compara as duas).
 */

// ------------------------------------------------------------------ ordem (cópia de src/lib/editorialMedia.ts)

export interface ArquivoParaOrdem {
  id: string;
  file_name: string;
  storage_path?: string | null;
  created_at?: string | null;
}

function ordemPeloCaminho(valor?: string | null): number | null {
  if (!valor) return null;
  const partes = valor.split(/[\\/]/).filter(Boolean);
  const ultimo = partes[partes.length - 1] || valor;
  const inicial = ultimo.match(/^(\d+)(?=[\s._-])/);
  if (inicial) return Number(inicial[1]);
  return null;
}

function ordemPeloNome(valor?: string | null): number | null {
  if (!valor) return null;
  const fracao = valor.match(/\((\d+)\s*\/\s*\d+\)/);
  if (fracao) return Number(fracao[1]);
  const rotulo = valor.match(/(?:card|slide|p[aá]gina|page)[\s._-]*(\d+)/i);
  if (rotulo) return Number(rotulo[1]);
  const inicial = valor.match(/^(\d+)(?=[\s._-])/);
  return inicial ? Number(inicial[1]) : null;
}

/** Igual a editorialMediaOrderIndex do painel. */
export function indiceDaOrdem(f: Pick<ArquivoParaOrdem, 'file_name' | 'storage_path'>): number | null {
  return ordemPeloCaminho(f.storage_path) ?? ordemPeloNome(f.file_name);
}

/** O número vem do storage_path (não muda sem mover o blob)? */
export function indicePeloCaminho(f: Pick<ArquivoParaOrdem, 'storage_path'>): number | null {
  return ordemPeloCaminho(f.storage_path);
}

function compararReserva(a: ArquivoParaOrdem, b: ArquivoParaOrdem): number {
  const ta = a.created_at ? Date.parse(a.created_at) : Number.NaN;
  const tb = b.created_at ? Date.parse(b.created_at) : Number.NaN;
  const sa = Number.isNaN(ta) ? Number.MAX_SAFE_INTEGER : ta;
  const sb = Number.isNaN(tb) ? Number.MAX_SAFE_INTEGER : tb;
  return sa - sb || a.id.localeCompare(b.id);
}

/** Igual a orderEditorialCarouselFiles do painel: a raiz primeiro, os filhos pela regra. */
export function ordenarComoOPainel<T extends ArquivoParaOrdem>(raiz: T, filhos: readonly T[]): T[] {
  const ordenados = [...filhos].sort((a, b) => {
    const ia = indiceDaOrdem(a);
    const ib = indiceDaOrdem(b);
    if (ia != null && ib != null && ia !== ib) return ia - ib;
    if (ia != null && ib == null) return -1;
    if (ia == null && ib != null) return 1;
    return compararReserva(a, b);
  });
  return [raiz, ...ordenados];
}

// ------------------------------------------------------------------ nomes

// 2.38.1: o sufixo só está no fim depois de tirar a extensão ("Post (1/3).png").
// Tira a extensão PRIMEIRO, depois todos os " (i/N)" do fim (tolera repetido).
const SUFIXOS_DE_CARD = /(?:\s*\(\s*\d+\s*\/\s*\d+\s*\))+\s*$/;
const EXTENSAO_DE_IMAGEM = /\.(png|jpe?g|webp)\s*$/i;

/** Nome sem extensão de imagem e sem o(s) sufixo(s) "(i/N)" do fim. */
export function nomeSemSufixo(nome: string): string {
  return String(nome || '').trim().replace(EXTENSAO_DE_IMAGEM, '').replace(SUFIXOS_DE_CARD, '').trim();
}

/** Base dos nomes dos cards: o nome da raiz sem extensão e sem sufixo (ou "Carrossel" se não sobrar nada). */
export function baseDoCarrossel(nomeDaRaiz: string): string {
  return nomeSemSufixo(nomeDaRaiz) || 'Carrossel';
}

/** Nome do card no padrão do painel, sem extensão: a raiz "<base>", o filho "<base> (i/N)". */
export function nomeDoCard(nomeDaRaiz: string, ordem: number, total: number): string {
  const base = baseDoCarrossel(nomeDaRaiz);
  return ordem === 1 ? base : `${base} (${ordem}/${total})`;
}

/** Título do post a partir do nome da raiz (o painel usa file_name.trim(); aqui sem sufixo e sem extensão). */
export function tituloDoArquivo(nomeDaRaiz: string): string {
  return baseDoCarrossel(nomeDaRaiz).slice(0, 200);
}

/**
 * A ordem dos filhos sai só do número (storage, depois a PRIMEIRA "(a/b)" do
 * nome), sem cair no desempate por created_at/id? Vale se os números vêm
 * estritamente crescentes na ordem pedida; um filho sem número só não depende
 * do desempate se for o único sem número e o último.
 */
export function ordemSemDesempate(filhos: ReadonlyArray<Pick<ArquivoParaOrdem, 'file_name' | 'storage_path'>>): boolean {
  const indices = filhos.map((f) => indiceDaOrdem(f));
  const semNumero = indices.filter((n) => n == null).length;
  if (semNumero > 1) return false;
  if (semNumero === 1 && indices[indices.length - 1] != null) return false;
  const numeros = indices.filter((n): n is number => n != null);
  return numeros.every((n, i) => i === 0 || n > numeros[i - 1]);
}

// ------------------------------------------------------------------ tipo de mídia

const MIMES_DE_IMAGEM = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp']);

function extensaoDe(...valores: Array<string | null | undefined>): string {
  for (const v of valores) {
    const s = String(v || '').toLowerCase().split(/[?#]/)[0];
    const m = s.match(/\.([a-z0-9]{2,5})$/);
    if (m) return m[1];
  }
  return '';
}

export interface ArquivoComMidia {
  file_name: string;
  mime_type?: string | null;
  extension?: string | null;
  storage_path?: string | null;
  file_url?: string | null;
}

/** Imagem que o carrossel aceita: png, jpg ou webp (pelo mime; sem mime, pela extensão do storage ou do nome). */
export function ehImagemDoCarrossel(f: ArquivoComMidia): boolean {
  const mime = String(f.mime_type || '').toLowerCase().trim();
  if (mime) return MIMES_DE_IMAGEM.has(mime);
  const ext = String(f.extension || '').toLowerCase().replace(/^\./, '') || extensaoDe(f.storage_path, f.file_url, f.file_name);
  return ['png', 'jpg', 'jpeg', 'webp'].includes(ext);
}

/** Tipo de mídia como mediaKindFromFile do painel (só o que importa aqui). */
export function tipoDaMidia(f: ArquivoComMidia & { file_type?: string | null }): 'image' | 'video' | 'other' {
  const m = String(f.mime_type || f.file_type || '').toLowerCase();
  const ext = extensaoDe(f.file_name, f.file_url) || String(f.extension || '').toLowerCase().replace(/^\./, '');
  if (m.startsWith('image/') || ['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'svg', 'bmp'].includes(ext)) return 'image';
  if (m.startsWith('video/') || ['mp4', 'webm', 'mov', 'm4v', 'mkv', 'avi'].includes(ext)) return 'video';
  if (m === 'image' || m === 'imagem' || m === 'photo' || m === 'foto') return 'image';
  if (m === 'video' || m === 'vídeo') return 'video';
  return 'other';
}

/**
 * content_type do post como inferEditorialMediaContentType do painel: raiz
 * vídeo = video; raiz imagem com algum filho imagem = carousel; senão static.
 */
export function tipoDoPostDoArquivo(
  raiz: ArquivoComMidia & { file_type?: string | null },
  filhos: ReadonlyArray<ArquivoComMidia & { file_type?: string | null }>,
): 'static' | 'carousel' | 'video' | null {
  const k = tipoDaMidia(raiz);
  if (k === 'video') return 'video';
  if (k !== 'image') return null;
  return filhos.some((f) => tipoDaMidia(f) === 'image') ? 'carousel' : 'static';
}

// ------------------------------------------------------------------ estado

export interface ArquivoDoCarrossel extends ArquivoParaOrdem, ArquivoComMidia {
  client_id: string;
  project_id: string | null;
  parent_file_id: string | null;
  revision_of_file_id?: string | null;
  file_type: string | null;
  folder: string | null;
  caption?: string | null;
  status: string | null;
  archived_at: string | null;
  visibility: string | null;
  agency_approval_status: string | null;
  approval_status: string | null;
  locked_at: string | null;
}

/** Interno e fora da aprovação (a mesma regra de file_is_editable / arquivoEditavel). */
export function internoSemAprovacao(f: Pick<ArquivoDoCarrossel, 'visibility' | 'agency_approval_status' | 'approval_status' | 'locked_at'>): boolean {
  return !f.locked_at && f.visibility === 'internal' &&
    (f.agency_approval_status || 'not_requested') === 'not_requested' &&
    (f.approval_status || 'none') === 'none';
}

/** Frase do estado de aprovação atual (para recusar com o motivo). */
export function estadoDaAprovacao(f: Pick<ArquivoDoCarrossel, 'visibility' | 'agency_approval_status' | 'approval_status' | 'locked_at'>): string {
  if (f.approval_status === 'approved') return 'aprovado pelo cliente';
  if (f.approval_status === 'rejected') return 'reprovado pelo cliente';
  if (f.visibility && f.visibility !== 'internal') {
    return f.approval_status === 'pending' ? 'aguardando o cliente' : `visível ao cliente (${f.visibility})`;
  }
  if (f.agency_approval_status === 'pending') return 'aguardando a revisão da agência';
  if (f.agency_approval_status === 'approved') return 'aprovado pela agência, ainda não liberado';
  if (f.agency_approval_status === 'rejected') return 'reprovado na revisão da agência';
  if (f.locked_at) return 'travado (versão final)';
  return 'interno, sem aprovação';
}

export const RETIRAR_ANTES =
  'Retire antes com aceleriq_workspace_retirar_aprovacao (volta raiz e filhos para interno, sem apagar nada) e repita.';

// ------------------------------------------------------------------ plano do agrupamento

export const MIN_CARDS = 2;
export const MAX_CARDS = 20;
/** O Instagram publica até 10 mídias por carrossel (MAX_MIDIAS_DO_CARROSSEL do Estúdio). */
export const MAX_CARDS_DO_INSTAGRAM = 10;
export const TIPO_DO_CARROSSEL = 'carrossel';
export const PASTA_DO_CARROSSEL = 'materiais';

export interface CardDoPlano {
  ordem: number;
  file_id: string;
  papel: 'raiz' | 'filho';
  nome_antes: string;
  nome_depois: string;
  file_type_antes: string | null;
  folder_antes: string | null;
  muda_nome: boolean;
  muda_file_type: boolean;
  muda_folder: boolean;
}

export interface PlanoDoAgrupamento {
  root_file_id: string | null;
  client_id: string | null;
  project_id: string | null;
  total: number;
  cards: CardDoPlano[];
  /** A ordem que o painel vai mostrar depois de agrupar (ids). */
  ordem_resultante: string[];
  ordem_confere: boolean;
  problemas: string[];
  avisos: string[];
}

/**
 * Plano de agrupar: confere tudo antes de escrever e devolve o que muda.
 * `pedidos`: os ids na ordem dos cards (o primeiro é a raiz).
 * `lidos`: as linhas de files (as que existem). `comFilhos`: ids que já têm filhos.
 * `noEscopo`: o cliente pode ser lido por esta credencial.
 */
export function planoDoAgrupamento(
  pedidos: readonly string[],
  lidos: readonly ArquivoDoCarrossel[],
  comFilhos: ReadonlySet<string>,
  noEscopo: (clientId: string) => boolean,
): PlanoDoAgrupamento {
  const problemas: string[] = [];
  const avisos: string[] = [];
  const vazio = (): PlanoDoAgrupamento => ({
    root_file_id: pedidos[0] ?? null, client_id: null, project_id: null, total: pedidos.length,
    cards: [], ordem_resultante: [], ordem_confere: false, problemas, avisos,
  });

  if (pedidos.length < MIN_CARDS || pedidos.length > MAX_CARDS) {
    problemas.push(`Um carrossel tem de ${MIN_CARDS} a ${MAX_CARDS} cards; vieram ${pedidos.length}.`);
  }
  const repetidos = pedidos.filter((id, i) => pedidos.indexOf(id) !== i);
  if (repetidos.length) problemas.push(`Arquivo repetido na lista: ${[...new Set(repetidos)].join(', ')}.`);
  const porId = new Map(lidos.map((f) => [f.id, f]));
  const faltando = pedidos.filter((id) => !porId.has(id));
  if (faltando.length) problemas.push(`Arquivo não encontrado: ${[...new Set(faltando)].join(', ')}.`);
  if (problemas.length) return vazio();

  const arquivos = pedidos.map((id) => porId.get(id)!);
  // Fronteira do cliente primeiro: arquivo de outro cliente responde como fora do escopo, sem detalhes dele.
  if (arquivos.some((f) => !noEscopo(f.client_id))) {
    return { ...vazio(), problemas: ['fora_do_escopo'] };
  }
  const raiz = arquivos[0];
  if (arquivos.some((f) => f.client_id !== raiz.client_id)) problemas.push('Todos os cards precisam ser do mesmo cliente.');
  if (arquivos.some((f) => (f.project_id ?? null) !== (raiz.project_id ?? null))) {
    problemas.push('Todos os cards precisam estar no mesmo projeto (ou todos sem projeto). Ajuste com aceleriq_update_file_metadata antes.');
  }
  for (const [i, f] of arquivos.entries()) {
    const rotulo = `Card ${i + 1} (${f.file_name})`;
    if (!ehImagemDoCarrossel(f)) problemas.push(`${rotulo}: não é imagem png, jpg ou webp.`);
    if ((f.status || 'ready') !== 'ready') problemas.push(`${rotulo}: ainda não está pronto (status ${f.status}). Finalize o upload antes.`);
    if (f.archived_at) problemas.push(`${rotulo}: está arquivado. Restaure com aceleriq_restore_file antes.`);
    if (!f.storage_path) problemas.push(`${rotulo}: o upload não concluiu (sem storage).`);
    if (!internoSemAprovacao(f)) problemas.push(`${rotulo}: está ${estadoDaAprovacao(f)}. Não se agrupa arquivo que já entrou na aprovação. ${RETIRAR_ANTES}`);
    if (f.parent_file_id) problemas.push(`${rotulo}: já é card de outro carrossel (raiz ${f.parent_file_id}).`);
    if (comFilhos.has(f.id)) problemas.push(`${rotulo}: já é raiz de um carrossel com cards próprios.`);
    if (i > 0 && f.revision_of_file_id) problemas.push(`${rotulo}: é revisão de outro arquivo e revisão não vira card (regra do banco).`);
  }

  const total = arquivos.length;
  const cards: CardDoPlano[] = arquivos.map((f, i) => {
    const ordem = i + 1;
    const nomeDepois = nomeDoCard(raiz.file_name, ordem, total);
    return {
      ordem,
      file_id: f.id,
      papel: i === 0 ? 'raiz' : 'filho',
      nome_antes: f.file_name,
      nome_depois: nomeDepois,
      file_type_antes: f.file_type ?? null,
      folder_antes: f.folder ?? null,
      muda_nome: nomeDepois !== f.file_name,
      muda_file_type: (f.file_type ?? null) !== TIPO_DO_CARROSSEL,
      muda_folder: (f.folder ?? null) !== PASTA_DO_CARROSSEL,
    };
  });

  // Ordem que o painel vai mostrar: os filhos com o nome novo, pela mesma regra.
  const depois = arquivos.map((f, i) => ({ ...f, file_name: cards[i].nome_depois }));
  const resultante = ordenarComoOPainel(depois[0], depois.slice(1)).map((f) => f.id);
  const bate = resultante.every((id, i) => id === pedidos[i]);
  const semDesempate = ordemSemDesempate(depois.slice(1));
  // 2.38.1: só confere se a ordem sai dos números, não do desempate por created_at.
  const confere = bate && semDesempate;
  const fracaoNaBase = /\(\d+\s*\/\s*\d+\)/.test(baseDoCarrossel(raiz.file_name));
  const dicaDaBase = fracaoNaBase
    ? ` O nome base "${baseDoCarrossel(raiz.file_name)}" tem "(a/b)" no meio e o painel lê a PRIMEIRA ocorrência: renomeie a raiz sem esse trecho antes.`
    : '';
  if (bate && !semDesempate) {
    avisos.push(
      'A ordem pedida só aparece no painel por desempate (created_at/id): os números lidos (storage, depois a primeira "(a/b)" do nome) não bastam para fixá-la. ' +
        'Confira os nomes e o storage dos cards; se algum card for mexido ou subido de novo, a ordem pode mudar.' + dicaDaBase,
    );
  }
  if (!bate) {
    const doCaminho = arquivos.slice(1)
      .map((f) => ({ f, n: indicePeloCaminho(f) }))
      .filter((x) => x.n != null)
      .map((x) => `${x.f.file_name} (número ${x.n} no storage)`);
    problemas.push(
      'A ordem pedida não bate com a ordem que o painel vai mostrar, e só o nome não corrige: o número no início do nome do arquivo no storage vale antes do nome' +
        (doCaminho.length ? ` (${doCaminho.join('; ')})` : '') +
        `. O painel mostraria: ${resultante.join(', ')}. Mande os file_ids na ordem desses números ou suba os cards de novo com nomes na ordem (nada é movido no storage).` + dicaDaBase,
    );
  }
  if (total > MAX_CARDS_DO_INSTAGRAM) {
    avisos.push(`O Instagram publica até ${MAX_CARDS_DO_INSTAGRAM} cards por carrossel; este tem ${total}. Agrupa, mas a Agenda não agenda acima de ${MAX_CARDS_DO_INSTAGRAM}.`);
  }

  return {
    root_file_id: raiz.id,
    client_id: raiz.client_id,
    project_id: raiz.project_id ?? null,
    total,
    cards,
    ordem_resultante: resultante,
    ordem_confere: confere,
    problemas,
    avisos,
  };
}

/** Os ids já formam este carrossel (raiz = primeiro, filhos = o resto e só eles)? */
export function jaAgrupado(
  pedidos: readonly string[],
  lidos: readonly Pick<ArquivoDoCarrossel, 'id' | 'parent_file_id'>[],
  filhosAtuaisDaRaiz: readonly string[],
): boolean {
  if (pedidos.length < MIN_CARDS) return false;
  const [raizId, ...resto] = pedidos;
  const raiz = lidos.find((f) => f.id === raizId);
  if (!raiz || raiz.parent_file_id) return false;
  const esperados = new Set(resto);
  if (filhosAtuaisDaRaiz.length !== esperados.size) return false;
  if (!filhosAtuaisDaRaiz.every((id) => esperados.has(id))) return false;
  return resto.every((id) => lidos.find((f) => f.id === id)?.parent_file_id === raizId);
}

/** Texto do envio: "Carrossel · N" ou "Arquivo único". */
export function rotuloDoEnvio(cards: number): string {
  return cards >= 2 ? `Carrossel · ${cards}` : 'Arquivo único';
}
