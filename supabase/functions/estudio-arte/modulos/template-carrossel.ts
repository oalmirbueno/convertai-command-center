/**
 * Carrossel estilo post do X no Template do Estúdio (22/10/2026, dono: "gerador completo com imagens,
 * buscando os vídeos e os conteúdos, sempre com uma copy boa"). Ações, todas com o custo ANTES quando
 * há IA (409 `confirmar_custo` sem `confirmado: true`):
 *
 * - template_carrossel: a copy de TODAS as lâminas pelo redator do Estúdio (motor de copy da casa:
 *   gancho forte, número concreto só do contexto, frase curta, CTA na última), com o que buscar de
 *   mídia em cada uma e, quando o assunto traz números reais, os dados do gráfico. Depois o Jev
 *   (Choice, um pedido para todas as lâminas) escolhe o tipo de mídia de cada lâmina entre foto
 *   real, vídeo real, gráfico, manchete, imagem por IA e só texto. Grava o texto e a sugestão em
 *   cada lâmina; a busca da mídia real e a imagem por IA (só quando não há real boa) vêm depois,
 *   pela tela, lâmina por lâmina.
 * - template_videos_buscar: vídeos reais com licença de uso comercial (Pexels Videos, com a chave
 *   PEXELS_API_KEY do cofre; Wikimedia Commons, só licenças livres). Sem custo.
 * - template_video_aplicar: relê o item NA FONTE (licença, autor e arquivo nunca vêm da tela),
 *   baixa e guarda na pasta do cliente, com o crédito. Sem custo.
 * - template_video_pedir / template_video_estado: a lâmina de vídeo em MP4 pela fila de render
 *   (tipo lamina_video, contrato em lamina-em-video.ts); pronta, o MP4 entra na versão da lâmina.
 *
 * Não importa Deno/Supabase: os testes usam as mesmas travas.
 */
import type { TrabalhoDaGeracao, RespostaDoRedator } from "./template-geracao.ts";
import { normalizarEntradaDaLaminaEmVideo, TIPO_DA_LAMINA_EM_VIDEO } from "./lamina-em-video.ts";

type Erro = (status: number, codigo: string, mensagem: string, detalhes?: Record<string, unknown>) => Error;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FECHADOS = new Set(["entregue", "aprovado", "agendado", "arquivado"]);
const EM_APROVACAO = new Set(["aguardando_agencia", "aguardando_cliente", "aprovado", "agendado"]);
const arred = (v: number) => Math.round(v * 1_000_000) / 1_000_000;
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const objeto = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
const limpo = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\r/g, "").trim().slice(0, max) : "");
const usd = (v: number) => `US$ ${v.toFixed(2).replace(".", ",")}`;

/** Os tipos de mídia que o Jev escolhe por lâmina (a tela traduz para o bloco). */
export const MIDIAS_DO_CARROSSEL = ["foto_real", "video_real", "grafico", "manchete", "imagem_ia", "so_texto"] as const;
export type MidiaDoCarrossel = (typeof MIDIAS_DO_CARROSSEL)[number];
export const DESCRICAO_DA_MIDIA: Record<MidiaDoCarrossel, string> = {
  foto_real: "Uma FOTO REAL do assunto concreto da lâmina (pessoa, produto, lugar, marca ou objeto que existe e dá para achar em banco de imagens livre). Serve quando a lâmina fala de algo visível.",
  video_real: "Um VÍDEO REAL curto do assunto (ação, movimento, cena do dia a dia, produto em uso). Serve quando o movimento conta a história melhor que a foto, como no gancho.",
  grafico: "Um GRÁFICO desenhado com os números REAIS que a lâmina traz (comparação, evolução, fatia, tabela de preços). Só quando há pelo menos dois números do contexto.",
  manchete: "O CARD DA MANCHETE da notícia real que deu origem ao conteúdo (veículo, título e data). Serve para provar que o assunto é real e atual, em geral no começo.",
  imagem_ia: "Uma IMAGEM GERADA por IA, conceitual (metáfora visual, cena ilustrativa). Só quando o assunto é abstrato e não existe foto real que mostre a ideia.",
  so_texto: "SÓ TEXTO, sem mídia: frase forte em letra grande. Serve para virada, opinião, pergunta, lista curta ou o CTA final.",
};

export const ESQUEMA_DO_CARROSSEL_X = {
  nome: "carrossel_estilo_x",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["laminas", "legenda"],
    properties: {
      laminas: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["ordem", "texto", "busca", "dados", "tipo_de_grafico", "unidade", "fonte_dos_dados"],
          properties: {
            ordem: { type: "integer" },
            texto: { type: "string" },
            busca: { type: "string" },
            dados: { type: "array", items: { type: "object", additionalProperties: false, required: ["rotulo", "valor"], properties: { rotulo: { type: "string" }, valor: { type: "number" } } } },
            tipo_de_grafico: { type: "string", enum: ["", "barras", "linha", "pizza"] },
            unidade: { type: "string" },
            fonte_dos_dados: { type: "string" },
          },
        },
      },
      legenda: { type: "string" },
    },
  },
};

export interface NoticiaDaBase { titulo: string; fonte: string; link: string; data?: string }

/** Regras do redator para o carrossel estilo X (o motor de copy da casa vem junto no sistema). */
export function instrucoesDoCarrossel(quantas: number, comNoticia: boolean): string {
  return [
    "CARROSSEL ESTILO POST DO X (lâmina inteira com o perfil, o texto e um bloco de mídia)",
    "Você é o redator sênior da agência. Escreva, em português do Brasil e na voz da marca do contexto, o texto de cada lâmina de um carrossel do Instagram no formato de post do X.",
    `São ${quantas} lâminas, na ordem pedida. A 1 é o GANCHO que para a rolagem (tensão, número concreto ou contradição). As do meio entregam UMA ideia cada, com prova. A última fecha com um CTA claro (comentar, salvar, chamar no direct ou clicar no link da bio).`,
    "Frases curtas. No máximo 3 parágrafos curtos por lâmina e 260 caracteres. Use **negrito** (dois asteriscos) em 1 ou 2 trechos que carregam a ideia (o número, o nome, a virada). Termine as lâminas do meio com \" →\" quando puxam a próxima.",
    "Números, nomes, datas e resultados SÓ os que estão no assunto, na notícia ou no contexto. Nunca invente estatística, preço, prazo ou depoimento.",
    "\"busca\": 2 a 5 palavras do que mostrar na mídia daquela lâmina, concretas e pesquisáveis num banco de imagens (ex.: \"carro elétrico carregando\"). Vazio se a lâmina é só texto.",
    "\"dados\": só se a lâmina traz dois ou mais números REAIS comparáveis do contexto; com \"tipo_de_grafico\" (barras para comparar, linha para evolução, pizza para fatias), \"unidade\" (%, R$, mil...) e \"fonte_dos_dados\". Sem números reais: dados vazio e os outros campos vazios.",
    comNoticia ? "A notícia real está no pedido: use o título e o veículo dela como prova (sem copiar o texto da matéria) e cite o veículo por nome quando fizer sentido." : "",
    "\"legenda\": a legenda do post no Instagram (gancho nos primeiros 125 caracteres, corpo curto, CTA e 3 a 5 hashtags no fim).",
    "Responda só o JSON pedido.",
  ].filter(Boolean).join("\n");
}

export interface LaminaGerada {
  ordem: number;
  texto: string;
  busca: string;
  grafico: { tipo: "barras" | "linha" | "pizza"; dados: Array<{ rotulo: string; valor: number }>; unidade?: string; fonte?: string } | null;
}

/** Lê a resposta do redator: só as ordens pedidas; dados do gráfico só com 2+ números válidos. */
export function lerCarrosselGerado(bruto: unknown, ordens: number[]): { laminas: LaminaGerada[]; legenda: string; avisos: string[] } {
  const o = objeto(bruto);
  const lista = (Array.isArray(o.laminas) ? o.laminas : []).map(objeto);
  const avisos: string[] = [];
  const laminas: LaminaGerada[] = [];
  for (const ordem of ordens) {
    const l = lista.find((x) => x.ordem === ordem);
    const texto = limpo(l?.texto, 900);
    if (!l || !texto) { avisos.push(`O redator não escreveu a lâmina ${ordem}: ela ficou com o texto anterior.`); continue; }
    const dados = (Array.isArray(l.dados) ? l.dados : []).map(objeto)
      .filter((d) => typeof d.valor === "number" && Number.isFinite(d.valor) && limpo(d.rotulo, 40))
      .slice(0, 12).map((d) => ({ rotulo: limpo(d.rotulo, 40), valor: d.valor as number }));
    const tipo = l.tipo_de_grafico === "barras" || l.tipo_de_grafico === "linha" || l.tipo_de_grafico === "pizza" ? l.tipo_de_grafico as "barras" | "linha" | "pizza" : null;
    const grafico = tipo && dados.length >= 2 && !(tipo === "pizza" && dados.some((d) => d.valor < 0))
      ? { tipo, dados, ...(limpo(l.unidade, 12) ? { unidade: limpo(l.unidade, 12) } : {}), ...(limpo(l.fonte_dos_dados, 160) ? { fonte: limpo(l.fonte_dos_dados, 160) } : {}) }
      : null;
    if (Array.from(texto.replace(/\*\*/g, "")).length > 320) avisos.push(`A lâmina ${ordem} ficou longa para o formato. Encurte antes de guardar.`);
    laminas.push({ ordem, texto, busca: limpo(l.busca, 80), grafico });
  }
  return { laminas, legenda: limpo(o.legenda, 2600), avisos };
}

/** As opções de mídia que fazem sentido para a lâmina (gráfico só com dados, manchete só com notícia). */
export function opcoesDaLamina(l: LaminaGerada, comNoticia: boolean): MidiaDoCarrossel[] {
  return MIDIAS_DO_CARROSSEL.filter((m) => (m !== "grafico" || !!l.grafico) && (m !== "manchete" || comNoticia));
}

export type PerguntaDeEscolha = { type: "choice"; instructions: unknown; criteria: Record<string, unknown> };
/** Uma pergunta Choice por lâmina, todas sobre o mesmo estado (vão juntas, num pedido só). */
export function perguntasDaMidia(laminas: LaminaGerada[], comNoticia: boolean): Record<string, PerguntaDeEscolha> {
  const q: Record<string, PerguntaDeEscolha> = {};
  laminas.forEach((l, i) => {
    const opcoes = opcoesDaLamina(l, comNoticia);
    q[`midia_${l.ordem}`] = {
      type: "choice",
      instructions: {
        tarefa: `Escolha a mídia do bloco da lâmina \`laminas[${i}]\` deste carrossel estilo post do X.`,
        considere: [
          "o que a lâmina diz e o que mostrar prende mais a atenção sem repetir a lâmina anterior",
          "a primeira lâmina é o gancho; a última costuma ser só texto com o CTA",
          "variar o tipo de mídia ao longo do carrossel",
          "preferir mídia REAL (foto, vídeo, manchete, gráfico com números reais) a imagem gerada",
        ],
      },
      criteria: Object.fromEntries(opcoes.map((m) => [m, DESCRICAO_DA_MIDIA[m]])),
    };
  });
  return q;
}

/** Sem o Jev: regra simples e explícita (manchete na capa se houver notícia, gráfico com dados, CTA só texto). */
export function midiaPorRegra(l: LaminaGerada, i: number, total: number, comNoticia: boolean): MidiaDoCarrossel {
  if (i === total - 1 && total > 1) return "so_texto";
  if (i === 0 && comNoticia) return "manchete";
  if (l.grafico) return "grafico";
  if (!l.busca) return "so_texto";
  return i === 0 ? "video_real" : "foto_real";
}

export interface SugestaoDoCarrossel {
  midia: MidiaDoCarrossel;
  busca: string;
  confianca: number | null;
  grafico?: LaminaGerada["grafico"];
  manchete?: { veiculo: string; titulo: string; url: string; data?: string };
  por: "jev" | "regra";
}

// ------------------------------------------------------------------ vídeos reais

export interface VideoReal {
  banco: "pexels" | "wikimedia";
  id: string;
  nome: string;
  url: string;
  poster_url: string | null;
  pagina_url: string;
  autor: string | null;
  licenca: string;
  duracao_s: number | null;
  largura: number | null;
  altura: number | null;
}

export const API_DO_PEXELS_VIDEOS = "https://api.pexels.com/videos/";
const https = (v: unknown): string | null => {
  if (typeof v !== "string" || v.length > 2000) return null;
  try { const u = new URL(v); return u.protocol === "https:" && !u.username && !u.password ? u.href : null; } catch { return null; }
};

/** Um vídeo do Pexels: o arquivo MP4 de até 1920 px (o mais próximo de 1080), o autor e a página. */
export function videoDoPexels(bruto: unknown): VideoReal | null {
  const o = objeto(bruto);
  if (typeof o.id !== "number" || !Number.isInteger(o.id)) return null;
  const arquivos = (Array.isArray(o.video_files) ? o.video_files : []).map(objeto)
    .filter((f) => f.file_type === "video/mp4" && https(f.link) && typeof f.width === "number" && typeof f.height === "number" && Math.max(f.width as number, f.height as number) <= 1920)
    .sort((a, b) => Math.abs(Math.max(a.width as number, a.height as number) - 1280) - Math.abs(Math.max(b.width as number, b.height as number) - 1280));
  const f = arquivos[0];
  const pagina = https(o.url);
  if (!f || !pagina) return null;
  const user = objeto(o.user);
  return {
    banco: "pexels", id: String(o.id), nome: `Vídeo do Pexels ${o.id}`, url: https(f.link)!, poster_url: https(o.image), pagina_url: pagina,
    autor: limpo(user.name, 120) || null, licenca: "Licença Pexels (uso comercial livre)",
    duracao_s: typeof o.duration === "number" ? o.duration : null, largura: f.width as number, altura: f.height as number,
  };
}

export const API_DO_COMMONS = "https://commons.wikimedia.org/w/api.php";
export function urlDaBuscaDeVideosNoCommons(consulta: string): string {
  const qs = new URLSearchParams({
    action: "query", format: "json", origin: "*", generator: "search", gsrnamespace: "6", gsrlimit: "8",
    gsrsearch: `${consulta} filetype:video`, prop: "videoinfo", viprop: "url|size|mime|extmetadata|derivatives", viurlwidth: "640",
  });
  return `${API_DO_COMMONS}?${qs.toString()}`;
}
export function urlDoVideoNoCommons(titulo: string): string {
  const qs = new URLSearchParams({ action: "query", format: "json", origin: "*", titles: titulo, prop: "videoinfo", viprop: "url|size|mime|extmetadata|derivatives", viurlwidth: "640" });
  return `${API_DO_COMMONS}?${qs.toString()}`;
}
const semHtml = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim().slice(0, max) : "");

/** Um vídeo do Commons: só licença livre (o Commons não aceita licença sem uso comercial), derivado WebM até 720p. */
export function videoDoCommons(pagina: unknown): VideoReal | null {
  const p = objeto(pagina);
  const titulo = typeof p.title === "string" && /^File:/i.test(p.title) ? p.title : null;
  const info = objeto((Array.isArray(p.videoinfo) ? p.videoinfo : [])[0]);
  if (!titulo || !/^video\//.test(String(info.mime || ""))) return null;
  const meta = objeto(info.extmetadata);
  const licenca = semHtml(objeto(meta.LicenseShortName).value, 80);
  if (!licenca || /\bnc\b|non.?commercial/i.test(licenca)) return null;
  const derivados = (Array.isArray(info.derivatives) ? info.derivatives : []).map(objeto)
    .filter((d) => https(d.src) && /webm|mp4/i.test(String(d.type || "")) && typeof d.height === "number" && (d.height as number) <= 720)
    .sort((a, b) => (b.height as number) - (a.height as number));
  const url = https(derivados[0]?.src) || https(info.url);
  const pagina_url = https(info.descriptionurl) || `https://commons.wikimedia.org/wiki/${encodeURIComponent(titulo.replace(/ /g, "_"))}`;
  if (!url) return null;
  return {
    banco: "wikimedia", id: titulo, nome: titulo.replace(/^File:/i, "").replace(/\.[a-z0-9]{2,5}$/i, "").slice(0, 160), url,
    poster_url: https(info.thumburl), pagina_url, autor: semHtml(objeto(meta.Artist).value, 120) || null, licenca,
    duracao_s: typeof info.duration === "number" ? info.duration : null,
    largura: typeof info.width === "number" ? info.width : null, altura: typeof info.height === "number" ? info.height : null,
  };
}

export interface VideoGuardado { caminho: string; nome: string; banco: VideoReal["banco"]; pagina_url: string; autor: string | null; licenca: string; duracao_s: number | null; largura: number | null; altura: number | null }
export const MAX_VIDEOS_REAIS = 6;
export const MAX_BYTES_VIDEO_REAL = 60 * 1024 * 1024;

// ------------------------------------------------------------------ dependências e ações

export interface PedidoDeRender { id: string; estado: string; etapa: string | null; progresso: number; saida_path: string | null; erro_mensagem: string | null; entrada: Record<string, unknown>; criado_em: string }

export interface DepsDoCarrossel<C extends { userId: string }, T extends TrabalhoDaGeracao> {
  erro: Erro;
  json: (body: unknown, status?: number) => Response;
  trabalhoComAcesso: (ch: C, id: string) => Promise<T>;
  mutarTrabalho: (id: string, mudar: (t: T) => Record<string, unknown>) => Promise<T>;
  ehPostDeFotos: (t: T) => boolean;
  atualizarTexto: (t: T, ordem: number, texto: string) => T["direcao"];
  estimarTexto: (t: T) => Promise<number>;
  escreverTexto: (ch: C, t: T, e: { sistema: string; pedido: Record<string, unknown>; esquema: Record<string, unknown>; rede: "twitter" }) => Promise<RespostaDoRedator>;
  perguntarJev: (t: T, state: unknown, questions: Record<string, PerguntaDeEscolha>) => Promise<{ answers: Record<string, { choice?: string; confidence?: number }>; custoUsd: number }>;
  /** Leitura JSON das APIs públicas (Commons) e do Pexels com a chave; null quando não há chave do Pexels. */
  jsonDoCommons: (url: string) => Promise<unknown>;
  jsonDoPexels: ((url: string) => Promise<unknown>) | null;
  baixarVideo: (url: string, limite: number) => Promise<{ bytes: Uint8Array; mime: string } | null>;
  guardarVideo: (t: T, bytes: Uint8Array, mime: string) => Promise<string>;
  descartarUpload?: (caminho: string) => Promise<void>;
  /** Fila de render: insere o pedido (ou devolve o ativo igual) e lê os pedidos da lâmina. */
  pedirRender: (t: T, linha: { uid: string; entrada: Record<string, unknown>; criadoPor: string }) => Promise<{ pedido: PedidoDeRender; ja_existia: boolean }>;
  pedidosDaLamina: (t: T, ordem: number) => Promise<PedidoDeRender[]>;
  linkAssinado: (caminho: string) => Promise<string | null>;
}

function abrir<T extends TrabalhoDaGeracao>(t: T, ordem: number, d: { erro: Erro; ehPostDeFotos: (t: T) => boolean }) {
  if (FECHADOS.has(t.status) || EM_APROVACAO.has(t.entrega_status || "")) throw d.erro(409, "trabalho_entregue", "Este trabalho está entregue ou em aprovação. Reabra para mexer no carrossel.");
  if (t.tipo === "ads" || d.ehPostDeFotos(t)) throw d.erro(409, "template_indisponivel", "O Template está disponível para artes e carrosséis do Estúdio.");
  const card = t.direcao.cards.find((c) => c.ordem === ordem);
  if (!card) throw d.erro(404, "card_inexistente", "Esta lâmina não existe na direção do trabalho.");
  return card;
}

function ids(corpo: Record<string, unknown>, erro: Erro) {
  if (typeof corpo.trabalho_id !== "string" || !UUID.test(corpo.trabalho_id)) throw erro(400, "pedido_template_invalido", "Informe o trabalho do template.");
  if (typeof corpo.ordem !== "number" || !Number.isInteger(corpo.ordem) || corpo.ordem < 1) throw erro(400, "ordem_template_invalida", "Informe a lâmina do template.");
  return { id: corpo.trabalho_id, ordem: corpo.ordem };
}

function lerNoticia(v: unknown, erro: Erro): NoticiaDaBase | null {
  if (v === undefined || v === null) return null;
  const n = objeto(v);
  const titulo = limpo(n.titulo, 300), fonte = limpo(n.fonte, 80), link = https(n.link);
  if (!titulo || !fonte || !link) throw erro(400, "noticia_invalida", "A notícia precisa de título, veículo e o link https da matéria.");
  const data = limpo(n.data, 40);
  return { titulo, fonte, link, ...(data ? { data } : {}) };
}

export function acoesDoCarrossel<C extends { userId: string }, T extends TrabalhoDaGeracao>(d: DepsDoCarrossel<C, T>) {
  async function gerar(ch: C, corpo: Record<string, unknown>): Promise<Response> {
    const { id, ordem } = ids(corpo, d.erro);
    if (corpo.assunto !== undefined && (typeof corpo.assunto !== "string" || corpo.assunto.length > 1200)) throw d.erro(400, "assunto_invalido", "Escreva o assunto com até 1.200 caracteres.");
    const assunto = limpo(corpo.assunto, 1200);
    const noticia = lerNoticia(corpo.noticia, d.erro);
    const t = await d.trabalhoComAcesso(ch, id);
    abrir(t, ordem, d);
    const ordens = t.direcao.cards.map((c) => c.ordem).sort((a, b) => a - b);
    const conceito = limpo((t.direcao as { conceito?: unknown }).conceito, 800);
    if (!assunto && !noticia && !conceito) throw d.erro(400, "assunto_vazio", "Escreva o assunto do carrossel ou escolha uma notícia.");
    if (corpo.confirmado !== true) {
      const custo = await d.estimarTexto(t) + 0.002;
      throw d.erro(409, "confirmar_custo", `Gerar o carrossel custa cerca de ${usd(custo)} (texto e escolha das mídias). As imagens por IA, quando precisar, aparecem antes.`, { precisa_confirmar: true, custo_estimado_usd: arred(custo) });
    }
    const pedido = {
      assunto: assunto || null,
      noticia,
      pauta: { conceito: conceito || null, laminas: t.direcao.cards.map((c) => ({ ordem: c.ordem, texto_atual: limpo(c.texto_exato, 600) })) },
      ordens_pedidas: ordens,
      quantidade: ordens.length,
    };
    const r = await d.escreverTexto(ch, t, { sistema: instrucoesDoCarrossel(ordens.length, !!noticia), pedido, esquema: ESQUEMA_DO_CARROSSEL_X, rede: "twitter" });
    let custo = arred(num(r.custoUsd));
    const lido = lerCarrosselGerado(r.json, ordens);
    if (!lido.laminas.length) {
      await d.mutarTrabalho(t.id, (x) => ({ custo_usd: arred(num(x.custo_usd) + custo) }));
      throw d.erro(502, "carrossel_vazio", "O redator não devolveu um carrossel utilizável. Tente de novo ou mude o assunto.", { custo_usd: custo });
    }
    // O Jev escolhe a mídia de cada lâmina (um pedido para todas); sem o Jev, uma regra explícita.
    const sugestoes: Record<number, SugestaoDoCarrossel> = {};
    const avisos = [...lido.avisos];
    let respostas: Record<string, { choice?: string; confidence?: number }> | null = null;
    try {
      const estado = {
        assunto: assunto || conceito || null,
        noticia: noticia ? { titulo: noticia.titulo, veiculo: noticia.fonte } : null,
        laminas: lido.laminas.map((l, i) => ({ posicao: `${i + 1} de ${lido.laminas.length}`, texto: l.texto.replace(/\*\*/g, ""), o_que_mostrar: l.busca || null, numeros_reais: l.grafico ? l.grafico.dados : [] })),
      };
      const res = await d.perguntarJev(t, estado, perguntasDaMidia(lido.laminas, !!noticia));
      respostas = res.answers;
      custo = arred(custo + num(res.custoUsd));
    } catch {
      avisos.push("O Jev não respondeu: a mídia de cada lâmina saiu por uma regra simples. Troque à vontade no bloco.");
    }
    lido.laminas.forEach((l, i) => {
      const r2 = respostas ? respostas[`midia_${l.ordem}`] : undefined;
      const validas = opcoesDaLamina(l, !!noticia);
      const escolha = r2 && typeof r2.choice === "string" && (validas as string[]).indexOf(r2.choice) >= 0 ? r2.choice as MidiaDoCarrossel : null;
      const midia = escolha || midiaPorRegra(l, i, lido.laminas.length, !!noticia);
      sugestoes[l.ordem] = {
        midia, busca: l.busca, confianca: escolha && typeof r2?.confidence === "number" ? Math.round(r2.confidence * 100) / 100 : null, por: escolha ? "jev" : "regra",
        ...(l.grafico ? { grafico: l.grafico } : {}),
        ...(noticia && midia === "manchete" ? { manchete: { veiculo: noticia.fonte, titulo: noticia.titulo, url: noticia.link, ...(noticia.data ? { data: noticia.data } : {}) } } : {}),
      };
    });
    const gravarLegenda = corpo.gravar_legenda === true && !!lido.legenda;
    let recusa: unknown = null;
    const gravado = await d.mutarTrabalho(t.id, (atual) => {
      recusa = null;
      try { abrir(atual, ordem, d); } catch (e) { recusa = e; return { custo_usd: arred(num(atual.custo_usd) + custo) }; }
      let direcao = atual.direcao;
      for (const l of lido.laminas) {
        if (!direcao.cards.some((c) => c.ordem === l.ordem)) continue;
        direcao = d.atualizarTexto({ ...atual, direcao } as T, l.ordem, l.texto);
      }
      direcao = { ...direcao, cards: direcao.cards.map((c) => sugestoes[c.ordem] ? { ...c, carrossel: sugestoes[c.ordem] } : c) };
      return { direcao, ...(gravarLegenda ? { legenda: lido.legenda } : {}), custo_usd: arred(num(atual.custo_usd) + custo) };
    });
    if (recusa) throw recusa;
    return d.json({ trabalho: gravado, laminas: lido.laminas.map((l) => ({ ...l, sugestao: sugestoes[l.ordem] })), legenda: lido.legenda || null, legenda_gravada: gravarLegenda, avisos, custo_usd: custo, saldo_usd: r.saldoUsd ?? null });
  }

  async function buscarVideos(ch: C, corpo: Record<string, unknown>): Promise<Response> {
    const { id, ordem } = ids(corpo, d.erro);
    const consulta = limpo(corpo.consulta, 120);
    if (consulta.length < 2 || /https?:\/\//i.test(consulta)) throw d.erro(400, "consulta_video_invalida", "Escreva o assunto do vídeo (sem links).");
    const t = await d.trabalhoComAcesso(ch, id);
    abrir(t, ordem, d);
    const avisos: string[] = [];
    const resultados: VideoReal[] = [];
    if (d.jsonDoPexels) {
      try {
        const qs = new URLSearchParams({ query: consulta, per_page: "8", size: "medium" });
        const r = objeto(await d.jsonDoPexels(`${API_DO_PEXELS_VIDEOS}search?${qs.toString()}`));
        (Array.isArray(r.videos) ? r.videos : []).map(videoDoPexels).forEach((v) => { if (v) resultados.push(v); });
      } catch { avisos.push("O Pexels não respondeu agora; seguem os da Wikimedia."); }
    } else avisos.push("Sem a chave do Pexels no cofre (PEXELS_API_KEY): só vídeos da Wikimedia. Cadastre em Configurações › Chaves e custos.");
    try {
      const r = objeto(objeto(await d.jsonDoCommons(urlDaBuscaDeVideosNoCommons(consulta))).query);
      const paginas = Object.values(objeto(r.pages));
      paginas.map(videoDoCommons).forEach((v) => { if (v) resultados.push(v); });
    } catch { avisos.push("A Wikimedia não respondeu agora."); }
    avisos.push("Só licenças de uso comercial. O crédito (autor, fonte e licença) fica guardado com o vídeo.");
    return d.json({ consulta, resultados: resultados.slice(0, 12), avisos, custo_usd: 0 });
  }

  async function aplicarVideo(ch: C, corpo: Record<string, unknown>): Promise<Response> {
    const { id, ordem } = ids(corpo, d.erro);
    const banco = corpo.banco === "pexels" || corpo.banco === "wikimedia" ? corpo.banco : null;
    const idDaFonte = limpo(corpo.id, 300);
    if (!banco || !idDaFonte) throw d.erro(400, "video_real_invalido", "Escolha um vídeo da busca.");
    const t = await d.trabalhoComAcesso(ch, id);
    const card = abrir(t, ordem, d) as { videos_reais?: VideoGuardado[] };
    // O item é relido NA FONTE: arquivo, autor e licença nunca vêm da tela.
    let item: VideoReal | null = null;
    try {
      if (banco === "pexels") {
        if (!d.jsonDoPexels || !/^\d{1,12}$/.test(idDaFonte)) throw new Error("sem pexels");
        item = videoDoPexels(await d.jsonDoPexels(`${API_DO_PEXELS_VIDEOS}videos/${idDaFonte}`));
      } else {
        if (!/^File:[^\n<>[\]{}|#]{1,240}$/i.test(idDaFonte)) throw new Error("título inválido");
        const paginas = Object.values(objeto(objeto(objeto(await d.jsonDoCommons(urlDoVideoNoCommons(idDaFonte))).query).pages));
        item = videoDoCommons(paginas[0]);
      }
    } catch { throw d.erro(502, "video_real_indisponivel", "Não foi possível conferir a origem deste vídeo. Tente outro."); }
    if (!item) throw d.erro(422, "video_real_sem_licenca", "Este vídeo não tem arquivo público com licença de uso comercial.");
    const repetido = (card.videos_reais || []).find((v) => v.pagina_url === item!.pagina_url);
    if (repetido) return d.json({ trabalho: t, video: repetido, custo_usd: 0, ja_guardado: true });
    if ((card.videos_reais || []).length >= MAX_VIDEOS_REAIS) throw d.erro(409, "limite_videos_reais", `Esta lâmina já tem ${MAX_VIDEOS_REAIS} vídeos reais. Use um deles.`);
    const baixado = await d.baixarVideo(item.url, MAX_BYTES_VIDEO_REAL);
    if (!baixado) throw d.erro(422, "video_real_grande", "O vídeo não pôde ser baixado (acima de 60 MB ou formato não aceito). Escolha outro.");
    const caminho = await d.guardarVideo(t, baixado.bytes, baixado.mime);
    const novo: VideoGuardado = { caminho, nome: item.nome, banco: item.banco, pagina_url: item.pagina_url, autor: item.autor, licenca: item.licenca, duracao_s: item.duracao_s, largura: item.largura, altura: item.altura };
    let anexou = false;
    const gravado = await d.mutarTrabalho(t.id, (atual) => {
      anexou = false;
      if (atual.client_id !== t.client_id) throw d.erro(409, "cliente_template_alterado", "O cliente do trabalho mudou. Abra o trabalho novamente.");
      const aberto = !FECHADOS.has(atual.status) && !EM_APROVACAO.has(atual.entrega_status || "");
      if (!aberto || !atual.direcao.cards.some((c) => c.ordem === ordem)) return {};
      anexou = true;
      return { direcao: { ...atual.direcao, cards: atual.direcao.cards.map((c) => c.ordem === ordem ? { ...c, videos_reais: [...((c as { videos_reais?: VideoGuardado[] }).videos_reais || []), novo].slice(-MAX_VIDEOS_REAIS) } : c) } };
    });
    if (!anexou) {
      if (d.descartarUpload) await d.descartarUpload(caminho).catch(() => undefined);
      throw d.erro(409, "lamina_template_alterada", "A lâmina mudou ou o trabalho foi fechado. O vídeo não foi guardado.");
    }
    return d.json({ trabalho: gravado, video: novo, custo_usd: 0 });
  }

  /** Pede o MP4 da lâmina de vídeo já guardada em PNG (a versão mais nova da lâmina). */
  async function pedirVideo(ch: C, corpo: Record<string, unknown>): Promise<Response> {
    const { id, ordem } = ids(corpo, d.erro);
    if (typeof corpo.uid !== "string" || !/^[a-zA-Z0-9-]{8,80}$/.test(corpo.uid)) throw d.erro(400, "uid_invalido", "Identificador do pedido inválido.");
    const t = await d.trabalhoComAcesso(ch, id);
    abrir(t, ordem, d);
    const versao = t.cards.filter((v) => v.ordem === ordem).sort((a, b) => b.versao - a.versao)[0];
    const tp = versao?.template_profile;
    if (!versao || !tp || tp.estilo !== "carrossel" || tp.bloco?.tipo !== "video" || !tp.bloco.midia) throw d.erro(409, "lamina_sem_video", "Guarde a lâmina com um vídeo no bloco antes de gerar o MP4.");
    if (typeof corpo.versao === "number" && corpo.versao !== versao.versao) throw d.erro(409, "versao_template_mudou", "A lâmina ganhou outra versão. Guarde de novo antes de gerar o MP4.");
    const tam = /^(\d{1,4})x(\d{1,4})$/.exec(versao.tamanho || "");
    let entrada;
    try {
      entrada = normalizarEntradaDaLaminaEmVideo({
        trabalho_id: t.id, ordem, versao: versao.versao,
        largura: tam ? Number(tam[1]) : 1080, altura: tam ? Number(tam[2]) : 1350,
        fundo: { bucket: "mesa", caminho: versao.storage_path },
        video: { bucket: tp.bloco.midia.bucket, caminho: tp.bloco.midia.caminho },
        retangulo: corpo.retangulo,
        enquadramento: tp.bloco.enquadramento, foco_x: tp.bloco.foco_x, foco_y: tp.bloco.foco_y,
        cor_do_bloco: corpo.cor_do_bloco, som: corpo.som !== false,
        saida: `${t.client_id}/estudio/template/videos/${t.id}-${ordem}-v${versao.versao}-${corpo.uid}.mp4`,
      }, t.client_id);
    } catch (e) {
      throw d.erro(400, "lamina_video_invalida", e instanceof Error ? e.message : "Pedido da lâmina de vídeo inválido.");
    }
    const r = await d.pedirRender(t, { uid: corpo.uid, entrada: entrada as unknown as Record<string, unknown>, criadoPor: ch.userId });
    return d.json({ ...r, custo_usd: 0 });
  }

  /** Andamento do MP4; pronto, ele entra na versão da lâmina (video_path) uma vez só. */
  async function estadoDoVideo(ch: C, corpo: Record<string, unknown>): Promise<Response> {
    const { id, ordem } = ids(corpo, d.erro);
    const t = await d.trabalhoComAcesso(ch, id);
    const pedidos = await d.pedidosDaLamina(t, ordem);
    const ultimo = pedidos[0] || null;
    let trabalho: T = t;
    if (ultimo && ultimo.estado === "pronto" && ultimo.saida_path && ultimo.saida_path.startsWith(`${t.client_id}/estudio/template/videos/`)) {
      const versao = Number(ultimo.entrada.versao);
      const alvo = t.cards.find((v) => v.ordem === ordem && v.versao === versao) as { video_path?: string } | undefined;
      if (alvo && alvo.video_path !== ultimo.saida_path) {
        trabalho = await d.mutarTrabalho(t.id, (atual) => ({
          cards: atual.cards.map((v) => v.ordem === ordem && v.versao === versao ? { ...v, video_path: ultimo.saida_path, video_pedido_id: ultimo.id } : v),
        }));
      }
    }
    const url = ultimo && ultimo.estado === "pronto" && ultimo.saida_path ? await d.linkAssinado(ultimo.saida_path) : null;
    return d.json({ trabalho, pedido: ultimo, url, custo_usd: 0 });
  }

  return {
    template_carrossel: gerar,
    template_videos_buscar: buscarVideos,
    template_video_aplicar: aplicarVideo,
    template_video_pedir: pedirVideo,
    template_video_estado: estadoDoVideo,
  };
}

export { TIPO_DA_LAMINA_EM_VIDEO };
