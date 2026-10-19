/**
 * Regras puras dos pedidos de acesso (MCP 2.13.0, 17/10/2026). Sem banco: dá para testar tudo aqui.
 *
 * - Meta e Google (Facebook, Instagram, Gmail, YouTube) nunca por senha ou código: o agente pede
 *   "conectar" com o link oficial (Composio/OAuth) e o dono clica uma vez.
 * - O mesmo site se reconhece pelo endereço (host sem "www.") ou pelo nome escrito igual.
 * - O print da tela vai ao bucket privado; até 3 MB, PNG, JPEG ou WEBP.
 */

export const TIPOS_DE_PEDIDO = ['senha', 'codigo', 'conectar', 'outro'] as const;
export type TipoDePedido = typeof TIPOS_DE_PEDIDO[number];

export const MIMES_DO_PRINT = ['image/png', 'image/jpeg', 'image/webp'] as const;
export type MimeDoPrint = typeof MIMES_DO_PRINT[number];
export const PRINT_MAXIMO_BYTES = 3 * 1024 * 1024;

export const RECUSA_META_GOOGLE =
  "Facebook, Instagram, Meta e Google (Gmail, YouTube) nunca entram por senha ou código. "
  + "Use tipo 'conectar' com o link oficial (Composio) em link_para_conectar: o dono clica uma vez e a conexão fica.";

export const REGRAS_DA_SENHA =
  'Use só neste login, agora. Não escreva a senha nem o código em diário, comentário, tarefa, relatório, '
  + 'mensagem ou arquivo. Depois de usar, não guarde: na próxima vez, chame aceleriq_acesso_usar de novo.';

/**
 * 19/10/2026 (dono: "fique persistente e cuide para não cair"): depois de entrar, a sessão fica. Cada
 * login novo é senha e código de novo para o dono; o perfil persistente do navegador guarda a entrada.
 */
export const MANTER_A_SESSAO =
  'Depois de entrar, mantenha a sessão: use sempre o perfil persistente do navegador deste cliente (nunca um navegador '
  + 'descartável), não saia da conta e não limpe os cookies. Assim o site não pede senha nem código de novo; '
  + 'só abra outro pedido se ele realmente pedir.';

/** Como o agente deve agir num login. Vai nas descrições das ferramentas e nas instruções do servidor. */
export const COMO_PEDIR_ACESSO =
  'Ao chegar num login: 1) chame aceleriq_acesso_usar (client_id e site, ou vault_item_id); se o dono já liberou, '
  + 'a senha vem na hora. 2) Se não vier, chame aceleriq_acesso_pedir com tipo senha, o print da tela (print_base64) '
  + 'e uma mensagem curta. 3) Consulte aceleriq_acesso_estado a cada 30 a 60 s até mudar de aberto. '
  + "Código de verificação: aceleriq_acesso_pedir com tipo 'codigo' e espere; o código chega uma vez só e vale 10 min. "
  + "Facebook, Instagram, Meta e Google: nunca senha; use tipo 'conectar' com o link oficial da Composio. "
  + 'NUNCA escreva senha ou código em diário, comentário, tarefa, relatório ou mensagem; depois de usar, não guarde. '
  + MANTER_A_SESSAO;

const DOMINIOS_META_GOOGLE = [
  'facebook.com', 'fb.com', 'messenger.com', 'instagram.com', 'meta.com', 'threads.net',
  'google.com', 'gmail.com', 'youtube.com', 'youtu.be', 'googleusercontent.com',
];
const PALAVRAS_META_GOOGLE = ['facebook', 'instagram', 'meta', 'google', 'gmail', 'youtube'];

/** Texto comparável: minúsculo, sem acento, espaços simples. */
export function normalizar(texto?: string | null): string {
  return String(texto ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** "https://www.Site.com.br/login?x=1" -> "site.com.br" (o mesmo que app_private.acesso_host no banco). */
export function hostDe(endereco?: string | null): string {
  return String(endereco ?? '')
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
    .replace(/[/:?#].*$/, '')
    .replace(/^www\./, '');
}

function hostEhMetaOuGoogle(host: string): boolean {
  if (!host) return false;
  if (DOMINIOS_META_GOOGLE.some((d) => host === d || host.endsWith('.' + d))) return true;
  // google.com.br, google.pt e afins
  return /(^|\.)google\.[a-z]{2,3}(\.[a-z]{2})?$/.test(host);
}

/** Algum dos textos (site, endereço, título) aponta para Facebook, Instagram, Meta ou Google? */
export function ehMetaOuGoogle(...textos: Array<string | null | undefined>): boolean {
  for (const t of textos) {
    if (!t) continue;
    if (hostEhMetaOuGoogle(hostDe(t))) return true;
    const palavras = normalizar(t).split(/[^a-z0-9]+/).filter(Boolean);
    if (palavras.some((p) => PALAVRAS_META_GOOGLE.includes(p))) return true;
  }
  return false;
}

export interface ItemComparavel {
  title?: string | null;
  url?: string | null;
  username?: string | null;
}

/** O item do cofre é do mesmo site (e da mesma conta, quando o agente diz qual)? */
export function itemCombina(item: ItemComparavel, alvo: { site?: string | null; url?: string | null; conta?: string | null }): boolean {
  const conta = normalizar(alvo.conta);
  if (conta && item.username && normalizar(item.username) !== conta) return false;

  const hostDoItem = hostDe(item.url) || (normalizar(item.title).includes('.') ? hostDe(item.title) : '');
  const hostsDoAlvo = [hostDe(alvo.url), normalizar(alvo.site).includes('.') ? hostDe(alvo.site) : ''].filter(Boolean);
  if (hostDoItem && hostsDoAlvo.includes(hostDoItem)) return true;

  const titulo = normalizar(item.title);
  const site = normalizar(alvo.site);
  return Boolean(titulo && site && titulo === site);
}

const EXTENSAO: Record<MimeDoPrint, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

function mimePelosBytes(b: Uint8Array): MimeDoPrint | null {
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length > 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46
    && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
  return null;
}

/** Decodifica o print (base64 puro ou data URL). Recusa o que não for imagem ou passar de 3 MB. */
export function lerPrint(base64: string): { bytes: Uint8Array; mime: MimeDoPrint; ext: string } {
  let corpo = String(base64 || '').trim();
  const dataUrl = /^data:[a-z0-9.+/-]+;base64,/i.exec(corpo);
  if (dataUrl) corpo = corpo.slice(dataUrl[0].length);
  corpo = corpo.replace(/\s+/g, '');
  if (!corpo) throw new Error('print_base64 veio vazio.');
  if (Math.floor((corpo.length * 3) / 4) > PRINT_MAXIMO_BYTES + 3) {
    throw new Error('O print passa de 3 MB. Mande a tela em JPEG ou reduza o tamanho.');
  }
  let binario: string;
  try {
    binario = atob(corpo);
  } catch {
    throw new Error('print_base64 não é base64 válido.');
  }
  if (binario.length > PRINT_MAXIMO_BYTES) throw new Error('O print passa de 3 MB. Mande a tela em JPEG ou reduza o tamanho.');
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i += 1) bytes[i] = binario.charCodeAt(i);

  // Vale o que os bytes dizem, não o mime informado.
  const real = mimePelosBytes(bytes);
  if (!real) throw new Error('O print precisa ser PNG, JPEG ou WEBP.');
  return { bytes, mime: real, ext: EXTENSAO[real] };
}
