/** Biblioteca complementar de fontes reais. Não gera arte, não substitui fotos e não aprova. */
import { urlPublicaSegura } from "../links.ts";
import { arquivoDoCommons, lerInfoDoCommons, urlDaBuscaNoCommons, urlDaInfoDaFotoNoCommons, type LogoDoCommons } from "./mundo-real.ts";

export interface FonteRealDoDiretor {
  caminho: string;
  nome: string;
  fonte_url: string;
  licenca: string;
  autor: string | null;
  tipo: "imagem" | "logo";
}
export interface CardComFontesReais {
  ordem: number;
  texto_exato: string;
  fontes_reais?: FonteRealDoDiretor[];
}
export interface TrabalhoComFontesReais {
  id: string;
  client_id: string;
  status: string;
  tipo?: string | null;
  entrega_status?: string | null;
  direcao: { cards: CardComFontesReais[] };
  cards: Array<{ ordem: number; versao: number }>;
}
interface ResultadoReal {
  arquivo: string;
  nome: string;
  url: string;
  miniatura_url: string;
  fonte_url: string;
  licenca: string;
  autor: string | null;
}
type Erro = (status: number, codigo: string, mensagem: string, detalhes?: Record<string, unknown>) => Error;
export interface DepsDasFontesReais<C, T extends TrabalhoComFontesReais> {
  erro: Erro;
  json: (body: unknown) => Response;
  trabalhoComAcesso: (ch: C, id: string) => Promise<T>;
  mutarTrabalho: (id: string, mudar: (t: T) => Record<string, unknown>) => Promise<T>;
  jsonDoCommons: (url: string) => Promise<unknown>;
  /** Openverse (21/10, Template): a mesma leitura JSON, só da API pública api.openverse.org. Sem ela, só a Wikimedia. */
  jsonDoOpenverse?: (url: string) => Promise<unknown>;
  /** O adaptador valida URL e DNS público em CADA redirecionamento, sem cookies. */
  buscarImagem: (url: URL, limite: number, permitir: (url: URL) => boolean) => Promise<{ url: URL; bytes: Uint8Array } | null>;
  validarImagem: (bytes: Uint8Array, limite: number) => "image/png" | "image/jpeg" | "image/webp" | null;
  /** Caminho exclusivo por chamada, nunca sobrescreve outro arquivo. */
  guardarImagem: (t: T, bytes: Uint8Array, mime: string) => Promise<string>;
  descartarUpload: (caminho: string) => Promise<void>;
  ehPostDeFotos: (t: T) => boolean;
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const MAX_FONTES_REAIS = 8;
export const MAX_BYTES_FONTE_REAL = 6 * 1024 * 1024;
const FECHADOS = new Set(["entregue", "aprovado", "agendado", "arquivado", "aguardando_agencia", "aguardando_cliente"]);
const objeto = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};

/** Não persistir chaves de acesso nem tentar obter telas de conta em uma sessão pública. */
export function urlDaFonteReal(bruto: unknown): URL | null {
  const u = urlPublicaSegura(bruto);
  if (!u) return null;
  // Somente unicast global em literal IPv6; multicast/reservados não são fontes públicas.
  if (u.hostname.startsWith("[") && (!/^\[[23][0-9a-f]{0,3}:/i.test(u.hostname) || /^\[2001:db8:/i.test(u.hostname))) return null;
  let caminho: string;
  try { caminho = decodeURIComponent(u.pathname); } catch { return null; }
  if (/(^|\/)(login|signin|sign-in|auth|oauth|dashboard|account|conta|painel)(\/|$)/i.test(caminho)) return null;
  for (const k of u.searchParams.keys()) {
    if (/(token|secret|password|passwd|api.?key|auth|signature|credential|session|cookie|x-amz|x-goog)/i.test(k)) return null;
  }
  u.hash = "";
  return u;
}

function tipoDoPedido(v: unknown, erro: Erro): "imagem" | "logo" {
  if (v === undefined || v === "imagem") return "imagem";
  if (v === "logo") return "logo";
  throw erro(400, "tipo_fonte_real_invalido", "Escolha imagem do assunto ou logo.");
}

/** Consulta sempre visível e editável na tela; nenhum campo privado é enviado implicitamente. */
export function consultaDaFonteReal(v: unknown, erro: Erro): string {
  if (typeof v !== "string" || v.length > 200 || Array.from(v).some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)) throw erro(400, "consulta_fonte_real_invalida", "Informe um assunto público de até 200 caracteres para pesquisar.");
  const consulta = v.replace(/\s+/g, " ").trim();
  if (consulta.length < 2 || /https?:\/\/|[\w.+-]+@[\w.-]+\.[a-z]{2,}/i.test(consulta)) throw erro(400, "consulta_fonte_real_invalida", "Use o assunto ou a marca, sem links ou dados de contato.");
  return consulta;
}

function cardEditavel<T extends TrabalhoComFontesReais>(t: T, ordem: number, d: Pick<DepsDasFontesReais<unknown, T>, "erro" | "ehPostDeFotos">): CardComFontesReais {
  if (FECHADOS.has(t.status) || FECHADOS.has(t.entrega_status || "")) throw d.erro(409, "trabalho_entregue", "Este trabalho está entregue ou em aprovação. Reabra para corrigir antes de adicionar uma fonte.");
  if (t.tipo === "ads" || d.ehPostDeFotos(t)) throw d.erro(409, "fonte_real_indisponivel", "As fontes do Diretor estão disponíveis para artes e carrosséis do Estúdio.");
  const card = t.direcao.cards.find((c) => c.ordem === ordem);
  if (!card) throw d.erro(404, "card_inexistente", "Esta lâmina não existe na direção do trabalho.");
  return card;
}

function conferirBase<T extends TrabalhoComFontesReais>(t: T, ordem: number, esperado: number, textoBase: string, d: Pick<DepsDasFontesReais<unknown, T>, "erro" | "ehPostDeFotos">): CardComFontesReais {
  const card = cardEditavel(t, ordem, d);
  if (Math.max(0, ...t.cards.filter((c) => c.ordem === ordem).map((c) => c.versao)) !== esperado) throw d.erro(409, "fonte_real_concorrente", "A lâmina mudou. Atualize o trabalho antes de adicionar a imagem.");
  if ((card.texto_exato || "") !== textoBase) throw d.erro(409, "texto_fonte_real_alterado", "O assunto da lâmina mudou. Confira o texto novo antes de adicionar a imagem.");
  return card;
}

const paginaDoCommons = (arquivo: string) => `https://commons.wikimedia.org/wiki/${encodeURIComponent(arquivo.replace(/ /g, "_"))}`;
const nomeDoArquivo = (arquivo: string) => arquivo.replace(/^File:/i, "").replace(/\.(svg|png|jpe?g|webp)$/i, "").slice(0, 160);
const resultadoDoCommons = (info: LogoDoCommons): ResultadoReal => ({
  arquivo: info.arquivo, nome: nomeDoArquivo(info.arquivo), url: info.url, miniatura_url: info.url,
  fonte_url: paginaDoCommons(info.arquivo), licenca: info.licenca, autor: info.autor,
});

/** Openverse (21/10, Template do Estúdio): busca pública sem chave, só licenças de uso comercial. */
export const API_DO_OPENVERSE = "https://api.openverse.org/v1/images/";
const PREFIXO_OPENVERSE = "openverse:";
const ID_OPENVERSE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function urlDaBuscaNoOpenverse(consulta: string, tipo: "imagem" | "logo"): string {
  const qs = new URLSearchParams({ q: tipo === "logo" ? `${consulta} logo` : consulta, page_size: "8", license_type: "commercial", mature: "false" });
  return `${API_DO_OPENVERSE}?${qs.toString()}`;
}
/** Licença legível: cc0, pdm e as CC com a versão. */
export function rotuloDaLicencaDoOpenverse(codigo: unknown, versao: unknown): string {
  const c = typeof codigo === "string" ? codigo.toLowerCase().trim() : "";
  if (!c) return "licença não informada; confira a autorização de uso";
  if (c === "cc0") return "CC0 1.0";
  if (c === "pdm") return "Domínio público";
  const v = typeof versao === "string" && /^[0-9.]{1,5}$/.test(versao) ? ` ${versao}` : "";
  return `CC ${c.toUpperCase()}${v}`;
}
/** Um item da API do Openverse como resultado da busca; sem URL pública segura, fica de fora. */
export function resultadoDoOpenverse(bruto: unknown): ResultadoReal | null {
  const o = objeto(bruto);
  if (typeof o.id !== "string" || !ID_OPENVERSE.test(o.id)) return null;
  const imagem = urlDaFonteReal(o.url);
  if (!imagem) return null;
  const pagina = urlDaFonteReal(o.foreign_landing_url);
  const miniatura = urlDaFonteReal(o.thumbnail);
  const semHtml = (v: unknown) => (typeof v === "string" ? v.replace(/<[^>]*>/g, "").replace(/[<>\u0000-\u001f]/g, "").replace(/\s+/g, " ").trim().slice(0, 160) : "");
  const titulo = semHtml(o.title);
  const autor = semHtml(o.creator);
  return {
    arquivo: `${PREFIXO_OPENVERSE}${o.id.toLowerCase()}`,
    nome: titulo || "Imagem do Openverse",
    url: imagem.href,
    miniatura_url: (miniatura || imagem).href,
    fonte_url: (pagina || new URL(`https://openverse.org/image/${o.id.toLowerCase()}`)).href,
    licenca: rotuloDaLicencaDoOpenverse(o.license, o.license_version),
    autor: autor || null,
  };
}

/** Uma recusa no callback CAS prova que esta chamada não anexou seu upload. */
class RecusaDaFonte extends Error { constructor(readonly motivo: unknown) { super("fonte_recusada_antes_da_gravacao"); } }
class FonteJaGuardada<T> extends Error { constructor(readonly trabalho: T, readonly fonte: FonteRealDoDiretor) { super("fonte_ja_guardada"); } }

export function acoesDasFontesReais<C, T extends TrabalhoComFontesReais>(d: DepsDasFontesReais<C, T>) {
  function identificadores(corpo: Record<string, unknown>) {
    if (typeof corpo.trabalho_id !== "string" || !UUID.test(corpo.trabalho_id) || typeof corpo.ordem !== "number" || !Number.isInteger(corpo.ordem) || corpo.ordem < 1) throw d.erro(400, "pedido_fonte_real_invalido", "Informe o trabalho e a lâmina da imagem.");
    return { id: corpo.trabalho_id, ordem: corpo.ordem };
  }
  const precisaPrint = () => d.erro(422, "imagem_real_precisa_print", "Esse link não fornece uma imagem pública direta. Envie uma captura atual em Fotos para usar a tela exata no Template.", { precisa_print: true });

  async function buscar(ch: C, corpo: Record<string, unknown>): Promise<Response> {
    const { id, ordem } = identificadores(corpo);
    const t = await d.trabalhoComAcesso(ch, id);
    cardEditavel(t, ordem, d);
    const consulta = consultaDaFonteReal(corpo.consulta, d.erro);
    const tipo = tipoDoPedido(corpo.tipo, d.erro);
    if (corpo.banco === "openverse") {
      if (!d.jsonDoOpenverse) throw d.erro(501, "openverse_indisponivel", "A busca no Openverse não está disponível. Use a Wikimedia.");
      let lista: unknown;
      try { lista = await d.jsonDoOpenverse(urlDaBuscaNoOpenverse(consulta, tipo)); } catch { throw d.erro(502, "busca_imagem_real_indisponivel", "O Openverse não respondeu (ele aceita poucas buscas por minuto). Tente em instantes ou use a Wikimedia."); }
      const itens = objeto(lista).results;
      const resultados = (Array.isArray(itens) ? itens : []).map(resultadoDoOpenverse).filter((r): r is ResultadoReal => !!r).slice(0, 6);
      return d.json({ consulta, banco: "openverse", resultados, avisos: ["Só licenças de uso comercial. Confira a fonte, a autoria e a licença antes de usar; algumas pedem o crédito do autor."], custo_usd: 0 });
    }
    const url = new URL(urlDaBuscaNoCommons(consulta));
    url.searchParams.set("srlimit", "8");
    url.searchParams.set("srsearch", tipo === "logo" ? `${consulta} logo` : consulta);
    let busca: unknown;
    try { busca = await d.jsonDoCommons(url.href); } catch { throw d.erro(502, "busca_imagem_real_indisponivel", "A Wikimedia não respondeu. Tente novamente ou envie uma imagem em Fotos."); }
    const encontrados = objeto(objeto(busca).query).search;
    const arquivos = [...new Set((Array.isArray(encontrados) ? encontrados : []).map((v) => arquivoDoCommons(objeto(v).title)).filter((a): a is string => !!a))].slice(0, 8);
    const infos = await Promise.allSettled(arquivos.map(async (arquivo) => lerInfoDoCommons(await d.jsonDoCommons(urlDaInfoDaFotoNoCommons(arquivo)), arquivo)));
    const resultados = infos.flatMap((v) => v.status === "fulfilled" && v.value ? [resultadoDoCommons(v.value)] : []).slice(0, 6);
    return d.json({ consulta, resultados, avisos: ["Confira a fonte e a licença antes de usar. Fotografias e marcas podem exigir autorização adicional.", ...(infos.some((v) => v.status === "rejected") ? ["Algumas fontes não responderam; os resultados disponíveis estão abaixo."] : [])], custo_usd: 0 });
  }

  async function aplicar(ch: C, corpo: Record<string, unknown>): Promise<Response> {
    const { id, ordem } = identificadores(corpo);
    if (typeof corpo.versao_esperada !== "number" || !Number.isInteger(corpo.versao_esperada) || corpo.versao_esperada < 0 || typeof corpo.texto_base !== "string" || corpo.texto_base.length > 20_000) throw d.erro(400, "base_fonte_real_invalida", "Informe a versão e o texto da lâmina que está editando.");
    const esperado = corpo.versao_esperada, textoBase = corpo.texto_base;
    const t = await d.trabalhoComAcesso(ch, id);
    const card = conferirBase(t, ordem, esperado, textoBase, d);
    const tipo = tipoDoPedido(corpo.tipo, d.erro);
    const temArquivo = typeof corpo.arquivo === "string" && !!corpo.arquivo.trim();
    const temUrl = typeof corpo.url === "string" && !!corpo.url.trim();
    if (temArquivo === temUrl) throw d.erro(400, "fonte_real_invalida", "Escolha um resultado da busca ou um link direto de imagem.");
    let url: URL, fonte: Omit<FonteRealDoDiretor, "caminho">;
    const doOpenverse = temArquivo && (corpo.arquivo as string).trim().toLowerCase().indexOf(PREFIXO_OPENVERSE) === 0;
    if (doOpenverse) {
      // O item é relido na API: licença, autor e arquivo nunca vêm da tela.
      const idOpenverse = (corpo.arquivo as string).trim().slice(PREFIXO_OPENVERSE.length).toLowerCase();
      if (!ID_OPENVERSE.test(idOpenverse) || !d.jsonDoOpenverse) throw d.erro(400, "arquivo_fonte_real_invalido", "Escolha uma imagem válida do Openverse.");
      let item: ResultadoReal | null;
      try { item = resultadoDoOpenverse(await d.jsonDoOpenverse(`${API_DO_OPENVERSE}${idOpenverse}/`)); } catch { throw d.erro(502, "fonte_real_indisponivel", "Não foi possível conferir a origem desta imagem. Tente novamente."); }
      if (!item) throw d.erro(422, "arquivo_fonte_real_indisponivel", "O Openverse não disponibiliza um arquivo público para esta imagem.");
      url = new URL(item.url);
      fonte = { nome: item.nome, fonte_url: item.fonte_url, licenca: item.licenca, autor: item.autor, tipo };
    } else if (temArquivo) {
      const arquivo = arquivoDoCommons(corpo.arquivo);
      if (!arquivo) throw d.erro(400, "arquivo_fonte_real_invalido", "Escolha um arquivo de imagem válido da Wikimedia.");
      let info: LogoDoCommons | null;
      try { info = lerInfoDoCommons(await d.jsonDoCommons(urlDaInfoDaFotoNoCommons(arquivo)), arquivo); } catch { throw d.erro(502, "fonte_real_indisponivel", "Não foi possível conferir a origem desta imagem. Tente novamente."); }
      if (!info) throw d.erro(422, "arquivo_fonte_real_indisponivel", "A fonte não disponibiliza PNG, JPEG ou WebP para esta imagem.");
      const resultado = resultadoDoCommons(info);
      url = new URL(resultado.url);
      fonte = { nome: resultado.nome, fonte_url: resultado.fonte_url, licenca: resultado.licenca, autor: resultado.autor, tipo };
    } else {
      const publica = urlDaFonteReal(corpo.url);
      if (!publica) throw precisaPrint();
      url = publica;
      let nome = "Imagem pública";
      try { nome = Array.from(decodeURIComponent(url.pathname.split("/").pop() || "")).filter((c) => c !== "<" && c !== ">" && c.charCodeAt(0) >= 32 && c.charCodeAt(0) !== 127).join("").replace(/\.(png|jpe?g|webp)$/i, "").trim().slice(0, 160) || nome; } catch { /* nome genérico sem URL inválida */ }
      fonte = { nome, fonte_url: url.href, licenca: "licença não informada; confira a autorização de uso", autor: null, tipo };
    }
    const resposta = (trabalho: T, f: FonteRealDoDiretor, repetido = false) => d.json({ trabalho, fonte: f, custo_usd: 0, ...(repetido ? { ja_guardada: true } : {}) });
    const anterior = card.fontes_reais?.find((f) => f.fonte_url === fonte.fonte_url);
    if (anterior) return resposta(t, anterior, true);
    if ((card.fontes_reais?.length || 0) >= MAX_FONTES_REAIS) throw d.erro(409, "limite_fontes_reais", "Esta lâmina já tem oito fontes reais. Use uma das imagens disponíveis no Template.");
    const baixada = await d.buscarImagem(url, MAX_BYTES_FONTE_REAL, (u) => !!urlDaFonteReal(u.href));
    if (!baixada || !urlDaFonteReal(baixada.url.href)) throw precisaPrint();
    const mime = d.validarImagem(baixada.bytes, MAX_BYTES_FONTE_REAL);
    if (!mime) throw precisaPrint();
    // A origem de imagem direta acompanha o destino final; Commons sempre conserva a página da licença.
    if (!temArquivo) fonte.fonte_url = urlDaFonteReal(baixada.url.href)!.href;
    const caminho = await d.guardarImagem(t, baixada.bytes, mime);
    const nova: FonteRealDoDiretor = { caminho, ...fonte };
    try {
      const gravado = await d.mutarTrabalho(t.id, (atual) => {
        try {
          if (atual.client_id !== t.client_id) throw d.erro(409, "cliente_fonte_real_alterado", "O cliente do trabalho mudou. Abra o trabalho novamente.");
          const atualCard = conferirBase(atual, ordem, esperado, textoBase, d);
          const repetido = atualCard.fontes_reais?.find((f) => f.fonte_url === nova.fonte_url);
          if (repetido) throw new FonteJaGuardada(atual, repetido);
          if ((atualCard.fontes_reais?.length || 0) >= MAX_FONTES_REAIS) throw d.erro(409, "limite_fontes_reais", "Esta lâmina já tem oito fontes reais.");
          return { direcao: { ...atual.direcao, cards: atual.direcao.cards.map((c) => c.ordem === ordem ? { ...c, fontes_reais: [...(c.fontes_reais || []), nova] } : c) } };
        } catch (e) { if (e instanceof FonteJaGuardada) throw e; throw new RecusaDaFonte(e); }
      });
      return resposta(gravado, nova);
    } catch (e) {
      if (e instanceof FonteJaGuardada || e instanceof RecusaDaFonte) await d.descartarUpload(caminho).catch(() => undefined);
      if (e instanceof FonteJaGuardada) return resposta((e as FonteJaGuardada<T>).trabalho, e.fonte, true);
      if (e instanceof RecusaDaFonte) throw e.motivo;
      // Resultado de rede/UPDATE ambíguo: conservar, pois o commit pode ter ocorrido.
      throw e;
    }
  }
  return { imagens_reais_buscar: buscar, imagem_real_aplicar: aplicar };
}
