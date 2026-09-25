/**
 * estudio-arte: diretor de arte e gerador da Mesa do cliente
 * (docs/mesa-do-cliente/SPEC.md, secao 5).
 *
 * Regra do dono, sem excecao: o gerador de imagem desenha a lamina INTEIRA,
 * texto incluido. Esta funcao nunca desenha texto por cima da imagem nem monta
 * a lamina em camadas. Ajuste e edicao dentro do gerador, sobre a versao atual.
 *
 * Acoes (POST { acao, ... }), so equipe com acesso ao cliente:
 * - preparar { task_id, modelo_imagem_id?, qualidade? }: le o item da agenda,
 *   kit, fontes, referencias, artes anteriores, prompt e memoria do diretor;
 *   escreve a direcao de cada card e cria estudio_trabalhos (status dirigido).
 * - gerar_card { trabalho_id, ordem }: UMA lamina por chamada. Jev escolhe ate 4
 *   referencias; anexa logo (capa e final), amostras das fontes e o card
 *   anterior; gera; salva no bucket mesa; grava a versao com a conferencia
 *   pendente ({ pendente: true }).
 * - conferir_card { trabalho_id, ordem, versao? }: confere uma versao (a atual
 *   quando versao nao vem): ortografia pela leitura do texto no recorte 4:5 e
 *   identidade pelo Jev (Score). A tela chama logo depois de gerar ou ajustar;
 *   separado para cada chamada caber no tempo da funcao. Devolve tambem
 *   `autocorrecao` ({ precisa, motivos, instrucao }, de autocorrecao.ts), que
 *   fica gravada na verificacao da versao.
 * - ajustar_card { trabalho_id, ordem, instrucao }: o diretor transforma o
 *   pedido em instrucao de edicao; o gerador edita a versao atual; nova versao
 *   com conferencia pendente; o pedido vai para a memoria do agente.
 * - corrigir_card { trabalho_id, ordem, pedido_da_equipe? }: autocorrecao antes
 *   de mostrar (docs/mesa-ads/v2/CONTRATO-V2.md). Le a verificacao da versao
 *   atual e decide (decidirAutocorrecao); sem nada a corrigir devolve
 *   { corrigido: false, autocorrecao }; com erro, edita pelo MESMO caminho do
 *   ajuste com a instrucao da decisao (texto exato fixo, sem memoria) e a
 *   versao nova leva autocorrecao { rodada, motivos }. No maximo 2 rodadas
 *   automaticas seguidas por lamina: a terceira volta 409
 *   limite_de_autocorrecao. pedido_da_equipe (botao "Corrigir de novo") nao
 *   conta no limite e recomeca a sequencia.
 * - legenda { trabalho_id }: legenda final a partir do item e da direcao.
 * - entregar { trabalho_id }: cria os arquivos em Arquivos pelo mesmo caminho
 *   da tela de Arquivos (bucket files + RPC create_file_record com o JWT de
 *   quem chamou), pasta materiais, carrossel com pai e filhos "(n/N)", legenda
 *   no pai, ligado ao projeto do item. Nao pede aprovacao (isso e da Entrega).
 * - referencias { subacao: importar_pinterest | sincronizar_workspace | ler }.
 * - conversar { trabalho_id, mensagem, ordem? }: conversa com o diretor de
 *   arte dentro do Estúdio (pedido do dono em 24/09). O diretor lê o conteúdo
 *   inteiro do trabalho, a marca, as referências e o acervo, olha a lâmina em
 *   foco e responde com `resposta` e até 6 `mudancas` estruturadas
 *   ({ id, alvo: conjunto | lamina, ordem, titulo, motivo, campos, regerar }).
 *   A conversa fica em agente_conversas (referencia_tipo 'estudio_trabalho').
 *   Nada muda no trabalho; o texto exato só entra com pedido explícito.
 * - aplicar_mudancas { trabalho_id, mudancas, regerar?, mensagem_id? }: grava
 *   as mudanças aprovadas na direção (layout da lâmina, conceito, fio visual,
 *   estilo pedido), sem custo, pelas regras da casa (conversa-do-diretor.ts).
 *   Quem refaz as lâminas é a tela, pelo fluxo normal de gerar e conferir.
 * - logos { trabalho_id } (26/09): as logos do kit da marca do trabalho, para
 *   a tela escolher (configurar conjunto.logo_escolhida ou card.logo). A logo
 *   é SEMPRE desenhada pelo gerador junto com a arte, em todos os modos
 *   (normal, replicar, foto real, foto composta, recorte, contínuo e
 *   anúncio); o código não cola logo. Tamanho mínimo pela forma da logo e
 *   pelo quadro (tamanhoDaLogo), lugar pela composição.
 * - refinar_texto { trabalho_id, alvo: lamina | legenda, ordem?, texto?,
 *   objetivos[], framework?, pedido? } (26/09): 3 opções do texto refinado,
 *   com a técnica usada; nada é gravado (a tela aplica pelo configurar ou na
 *   legenda). Uma chamada de texto, sem laço.
 * - reabrir { trabalho_id, motivo? } (25/09): trabalho entregue ou agendado
 *   volta para edição com as mesmas lâminas e versões; a entrega anterior vai
 *   para direcao.reaberturas e a próxima entrega sobe a rodada (arquivo novo).
 *
 * Pedidos do dono de 25/09 (frente A): formato do post (direcao.formato: 4:5,
 * 3:4, 1:1 ou 9:16, pelo configurar ou pelo preparar), logo sem caixa, série guiada pela capa sem
 * precisar do contínuo (blocoDaSerie), pessoa ou produto sem fundo como
 * elemento integrado (modo recorte) e as regras aprendidas com o cliente no
 * prompt (preferenciasDaArte, pelo cérebro do cliente).
 *
 * Estúdio Ads (docs/mesa-ads/SPEC.md): trabalho com tipo 'ads' é um conjunto
 * de criativos de anúncio, não um carrossel. Cada card tem `formato`
 * (feed_4x5 1088 x 1360, quadrado_1x1 1088 x 1088, stories_9x16 1088 x 1920;
 * sem formato, feed 4:5) e o tamanho vale em todos os modos (normal, foto
 * real, foto composta, ajuste por área e de fundo) e na conferência. O prompt
 * leva as regras do criativo e a zona segura do formato; a peça única leva
 * logo e o carrossel de anúncio (cards feed 4:5) segue como série, mas nunca
 * contínuo (sem panorama nem tela dupla). A conferência
 * acrescenta o risco de política e a clareza da oferta pelo Jev. `preparar`
 * não chama o diretor: a direção já vem pronta da mesa-ads. `entregar` grava
 * cada criativo em Arquivos, pasta criativos, fora da agenda e da aprovação
 * de post (veja entregarAnuncio). Trabalho social (padrão) segue igual.
 *
 * Custos: toda chamada de IA passa pelo motor (_shared/ia-motor.ts), que
 * confere saldo e cota e debita a carteira do cliente.
 */

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  chamarImagem,
  chamarTexto,
  carregarModelo,
  cobrarJev,
  IaMotorErro,
  modeloPadrao,
  TAMANHO_2X3,
  TAMANHO_4X5,
  type ImagemEntrada,
  type ModeloIa,
  type Qualidade,
} from "../_shared/ia-motor.ts";
import { JevErro, jevPerguntar, notaScore, type PerguntaJev, probabilidadeNoul } from "../_shared/jev.ts";
import { CONHECIMENTO_DIRETOR, PADRAO_NA_IMAGEM } from "../_shared/conhecimento-design.ts";
import {
  blocoDaSerie,
  blocoDasPreferencias,
  blocosDoTexto,
  blocoReplicarReferencia,
  formatoDoPost,
  FORMATOS_DO_POST,
  type FormatoDoPost,
  lugarDoRecorte,
  QUADRO_DO_POST,
  FORMATOS_CRIATIVO,
  type FormatoCriativo,
  QUADRO_FINAL,
  layoutPadrao,
  caixaDaLogo,
  caixaDaZona,
  direcaoDoRoteiro,
  formatoPara2x3,
  normalizarLayout,
  promptDaLamina,
  resumoDaComposicao,
  type BlocoTexto,
  type ZonaTexto,
  type CardDirecao,
  type FotoLivre,
  trechoDaLamina,
  type MarcaParaDirecao,
  anexosDaLamina,
  type EscolhaDaLogo,
  escolhaDaLogo,
  LEGENDA_DA_LOGO,
  logoDaLamina,
  type LogoMedida,
  type TipoDoAnexo,
  valorDaCor,
} from "../_shared/direcao-arte.ts";
import { caminhoDoArquivo, lerContextoConsolidado, sincronizarAcervo, sincronizarReferencias } from "../_shared/contexto-cliente.ts";
import {
  type AlvoDaMarca,
  colunasComMarca,
  contextoComMarca,
  filtrarReferenciasDaMarca,
  fontesDaMarca,
  kitComMarca,
  type MarcaDoCliente,
  marcaParaGravar,
  resolverMarca,
} from "../_shared/marca.ts";
import { NIVEIS_CLAREZA, NIVEIS_RISCO_POLITICA, POLITICAS_META, TAMANHO_DO_FORMATO } from "../_shared/conhecimento-ads.ts";
import { ANATOMIA_DO_ESTATICO, REGRAS_DE_HONESTIDADE } from "../_shared/conhecimento-ads.ts";
import { respostaComFolego } from "../_shared/resposta-com-folego.ts";
import { AREAS_DO_AGENTE, contextoParaAgente, lerCerebro, resumoParaPrompt } from "../_shared/cerebro-do-cliente.ts";
import { gravarNoCerebro, resumoDoCerebro } from "../_shared/cerebro-nas-mesas.ts";
import { conhecimentoEstudioPara } from "../_shared/conhecimento-dos-agentes.ts";
import { decidirAutocorrecao, type DecisaoDeAutocorrecao, LIMITE_DE_AUTOCORRECAO, rodadasSeguidas } from "./autocorrecao.ts";
import {
  aplicarNaDirecao,
  blocoDoEstiloPedido,
  ESQUEMA_CONVERSA,
  INSTRUCOES_CONVERSA,
  limparTexto,
  type MudancaProposta,
  normalizarMudancas,
  pedidoMexeNoTexto,
  regraProibeCaixa,
  SEM_FOTO,
} from "./conversa-do-diretor.ts";
import {
  acabamentoDaLamina,
  ampliar,
  recorteNaCaixa,
  valorMedioNaArea,
  telaDoRecorte,
  type Area,
  devolverOriginalAlinhado,
  devolverOriginalForaDasAreas,
  analisarLogo,
  cobrir,
  decodificar,
  fotoNaLamina,
  logoLimpa,
  mascara,
  normalizarAreas,
  ALTURA_LAMINA,
  colarMudancasNaBase,
  corrigirEmenda,
  fatiarTrecho,
  LARGURA_LAMINA,
  tamanhoDoTrecho,
  telaDoTrecho,
} from "../_shared/imagem-local.ts";
import {
  geracaoDoPanorama,
  modeloFazPanorama,
  panoramaApagado,
  type PanoramaGravado,
  semATrava,
  travaDoTrecho,
} from "../_shared/carrossel-continuo.ts";
import { aplicarFotosDoPlano, fotoNaoPublicavel, pecasDoPlanoGravado } from "../_shared/fotos-do-plano.ts";
import { TONS, tomValido } from "../_shared/conhecimento-ads.ts";
import { hostResolvePublico, imagensDoBehance, lerMetaTags, tipoDoLink, urlPublicaSegura } from "./links.ts";
import { ANTI_GENERICO, CTA_PRINCIPIOS, FORMULAS_DE_TITULO, REVISAO_DE_MARCA, VOZ_DE_MARCA } from "../_shared/conhecimento-marketing.ts";
import { FRAMEWORKS, frameworkPorId } from "../_shared/conhecimento-conteudo.ts";
import { ESQUEMA_REFINO, INSTRUCOES_REFINO, limparOpcoesDoRefino, OBJETIVOS_DO_REFINO, objetivosDoRefino } from "./refinar-texto.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

/** Toda resposta de erro sai por aqui: nunca 200, sempre com mensagem em portugues. */
const erro = (status: number, codigo: string, mensagem: string, detalhes: Record<string, unknown> = {}) =>
  json({ error: codigo, mensagem, ...detalhes }, status);

class ErroEstudio extends Error {
  status: number;
  codigo: string;
  detalhes: Record<string, unknown>;
  constructor(status: number, codigo: string, mensagem: string, detalhes: Record<string, unknown> = {}) {
    super(mensagem);
    this.status = status;
    this.codigo = codigo;
    this.detalhes = detalhes;
  }
}

// Erros do motor que a tela precisa tratar, com o status que a SPEC fixou.
const STATUS_MOTOR: Record<string, number> = {
  saldo_insuficiente: 402,
  cota_da_chave_esgotada: 402,
  cliente_sem_chave: 403,
  provedor_sem_chave: 503,
};
const MENSAGEM_MOTOR: Record<string, string> = {
  saldo_insuficiente: "Saldo insuficiente na carteira de IA do cliente. Recarregue antes de gerar.",
  cota_da_chave_esgotada: "A cota do mês da chave de IA do cliente acabou.",
  cliente_sem_chave: "O cliente não tem chave de IA própria e não está autorizado a usar a da agência.",
  provedor_sem_chave: "O provedor de IA escolhido ainda não tem chave configurada.",
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const QUALIDADES: Qualidade[] = ["baixa", "media", "alta"];
// Média: US$ 0,01 por lâmina contra US$ 0,04 da alta, com texto nítido no
// recorte final. A alta fica para quando a equipe pedir (seletor na tela).
const QUALIDADE_PADRAO: Qualidade = "media";
// Formato de geração: 4:5 direto (2:3 de reserva no motor). Direções antigas, sem layout, seguem em 2:3.
const TAMANHO_GERADOR = TAMANHO_4X5;
const LARGURA_FINAL = 1080;
const ALTURA_FINAL = 1350;
const MAX_CARDS = 20;
// Uma referência de identidade (arte da própria marca) e uma de técnica: cada
// imagem anexada custa tokens de entrada no gerador.
const MAX_REFERENCIAS = 2;
const MAX_CANDIDATAS_JEV = 16;
const MAX_AMOSTRAS_FONTE = 2;
const MAX_BYTES_IMAGEM = 20 * 1024 * 1024;
const TIMEOUT_PINTEREST_MS = 20_000;
const FORMATOS_FORA_DO_ESTUDIO = new Set(["reel", "video", "short", "story", "article"]);
const FORMATOS_POST_UNICO = new Set(["static", "design", "google_post"]);

// ------------------------------------------------------------------ banco

let servicoCache: SupabaseClient | null = null;
function servico(): SupabaseClient {
  if (!servicoCache) {
    servicoCache = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return servicoCache;
}

/** Cliente do banco com o JWT de quem chamou: RLS e regras das RPCs valem. */
function clienteDoChamador(token: string): SupabaseClient {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

type Chamador = { userId: string; token: string; doChamador: SupabaseClient };

async function identificar(req: Request): Promise<Chamador | null> {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  const { data: user } = await servico().auth.getUser(token);
  const userId = user?.user?.id;
  if (!userId) return null;
  const { data: staff } = await servico().rpc("is_staff", { _user_id: userId });
  if (staff !== true) return null;
  return { userId, token, doChamador: clienteDoChamador(token) };
}

/** can_access_client le auth.uid(): precisa rodar com o JWT de quem chamou. */
async function garantirAcesso(ch: Chamador, clientId: string) {
  if (!UUID.test(clientId)) throw new ErroEstudio(400, "cliente_invalido", "Cliente inválido.");
  const { data, error } = await ch.doChamador.rpc("can_access_client", { _client_id: clientId });
  if (error) throw new ErroEstudio(503, "acesso_indisponivel", "Não foi possível conferir o acesso ao cliente.");
  if (data !== true) throw new ErroEstudio(403, "sem_acesso_ao_cliente", "Você não tem acesso a este cliente.");
}

// ------------------------------------------------------------- utilidades

const texto = (v: unknown, max = 4000) => (v == null ? "" : String(v)).slice(0, max).trim();
const arred = (v: number) => Math.round(v * 1_000_000) / 1_000_000;
const num = (v: unknown) => {
  const n = typeof v === "string" ? Number(v) : (v as number);
  return typeof n === "number" && Number.isFinite(n) ? n : 0;
};

function mimeDe(b: Uint8Array): string | null {
  if (b.length < 12) return null;
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) {
    return "image/webp";
  }
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return "image/gif";
  return null;
}

/** Largura e altura de um PNG pelo cabecalho IHDR, sem decodificar a imagem. */
function dimensoesPng(b: Uint8Array): { largura: number; altura: number } | null {
  if (mimeDe(b) !== "image/png" || b.length < 24) return null;
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  return { largura: v.getUint32(16), altura: v.getUint32(20) };
}

const extensaoDe = (mime: string) => ({ "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" } as Record<string, string>)[mime] ?? "bin";

function nomeSeguro(nome: string): string {
  return nome
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "arte";
}

/**
 * Normaliza para comparar ortografia: mantem letras (com acento) e numeros,
 * ignora caixa, pontuacao e espacos. Acento errado continua sendo erro.
 */
function palavras(s: string): string[] {
  return s
    .normalize("NFC")
    .toLocaleLowerCase("pt-BR")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
}

/** Compara como multiconjunto de palavras: a ordem de leitura de um layout varia. */
function compararTexto(esperado: string, lido: string) {
  const faltando: string[] = [];
  const restantes = palavras(lido);
  for (const p of palavras(esperado)) {
    const i = restantes.indexOf(p);
    if (i >= 0) restantes.splice(i, 1);
    else faltando.push(p);
  }
  return { ortografia_ok: faltando.length === 0 && restantes.length === 0, faltando, sobrando: restantes };
}

async function baixar(bucket: string, caminho: string): Promise<Uint8Array> {
  const { data, error } = await servico().storage.from(bucket).download(caminho);
  if (error || !data) throw new ErroEstudio(502, "arquivo_indisponivel", `Não foi possível ler o arquivo ${caminho}.`);
  const bytes = new Uint8Array(await data.arrayBuffer());
  if (bytes.byteLength > MAX_BYTES_IMAGEM) throw new ErroEstudio(413, "arquivo_grande_demais", "Imagem grande demais para enviar ao gerador.");
  return bytes;
}

async function baixarImagem(bucket: string, caminho: string, nome: string): Promise<ImagemEntrada> {
  const bytes = await baixar(bucket, caminho);
  const mime = mimeDe(bytes);
  if (!mime) throw new ErroEstudio(415, "imagem_invalida", `O arquivo ${nome} não é uma imagem reconhecida.`);
  return { bytes, mime, nome: `${nomeSeguro(nome)}.${extensaoDe(mime)}` };
}

/** Uma entrada de erro do motor vira resposta com o status certo. */
function respostaDoMotor(e: IaMotorErro): Response {
  const status = STATUS_MOTOR[e.codigo] ?? e.status;
  const corpo = e.paraJson() as Record<string, unknown>;
  return json({ ...corpo, mensagem: MENSAGEM_MOTOR[e.codigo] ?? e.message }, status);
}

function codigoMotor(e: unknown): string {
  if (e instanceof IaMotorErro) return e.codigo;
  if (e instanceof JevErro) return e.codigo;
  if (e instanceof ErroEstudio) return e.codigo;
  return "erro_desconhecido";
}

// ------------------------------------------------------- tipos do trabalho

type Direcao = {
  conceito: string;
  carrossel_infinito: boolean;
  cards: CardDirecao[];
  origem?: "diretor" | "roteiro";
  /** Referências escolhidas na tela para o conjunto (ids de cliente_referencias; prefixo g: = banco global). */
  referencias_ids?: string[];
  /** Último pedido feito ao diretor sobre o conjunto (conversa com o diretor). */
  pedido?: string | null;
  /** Protagonista, cenário, luz e tratamento que se repetem em todas as lâminas (a série). */
  fio_visual?: string | null;
  /** Estilo pedido pela equipe na conversa com o diretor (vale em todas as lâminas; entra no prompt). */
  estilo_pedido?: string | null;
  /** Campanha (mesa_campanhas) do conteúdo: identidade do tema e selo entram em cada lâmina. */
  campanha_id?: string | null;
  /**
   * Carrossel contínuo: fundo panorâmico fatiado por lâmina (ordem -> caminho
   * no bucket mesa), a geração do fundo e as travas dos trechos em andamento
   * (_shared/carrossel-continuo.ts).
   */
  panorama?: PanoramaGravado | null;
  /** Tom do criativo de anúncio (sobrio, direto, agressivo), enviado pela Mesa Ads. */
  tom?: string | null;
  /** Entrega do criativo de anúncio (tipo 'ads'): fora de file_ids, que guiam a aprovação e a agenda do post. */
  entrega_ads?: EntregaAnuncio | null;
  /**
   * Formato do post orgânico (pedido do dono em 25/09): 4:5 (padrão), 3:4,
   * 1:1 ou 9:16, o mesmo para todas as lâminas. Só no trabalho social; o
   * anúncio segue o formato de cada card.
   */
  formato?: FormatoDoPost | null;
  /** Histórico de "Reabrir para corrigir": cada reabertura guarda o que tinha sido entregue. */
  reaberturas?: Reabertura[] | null;
  /** Logo do kit escolhida para o conjunto (26/09); a da lâmina (card.logo) vale no lugar dela. Sem ela: a que contrasta. */
  logo_escolhida?: EscolhaDaLogo | null;
};

type Reabertura = {
  em: string;
  por: string;
  motivo: string | null;
  rodada_anterior: number;
  file_ids: string[];
  entrega_status: string | null;
  versoes: { ordem: number; versao: number }[];
};

type EntregaAnuncio = {
  file_ids: string[];
  arquivos: { ordem: number; versao: number; file_id: string; storage_path: string | null; formato: string; largura: number | null; altura: number | null }[];
  project_id: string | null;
  entregue_em: string;
};

type CampanhaDaLamina = {
  id: string;
  nome: string;
  conceito: string | null;
  identidade: { tema_visual?: string; paleta_apoio?: { nome?: string; hex?: string }[]; tipografia?: string; elementos?: string; tom?: string; selo?: { texto?: string; descricao?: string } } | null;
  referencias_ids: string[] | null;
  selo_path: string | null;
  /**
   * Colunas de 25/09 (docs/mesa/migrations/20260925120000_mesa_campanhas_completas.sql):
   * ausentes antes do SQL, por isso o select("*") e tudo opcional.
   */
  briefing?: Record<string, unknown> | null;
  imagens?: unknown;
  plano_imagens?: Record<string, unknown> | null;
};

async function lerCampanha(clientId: string, id: unknown): Promise<CampanhaDaLamina | null> {
  const cid = typeof id === "string" ? id : "";
  if (!UUID.test(cid)) return null;
  // select("*"): traz briefing, imagens e plano_imagens quando o SQL de 25/09 já rodou, sem quebrar antes dele.
  const { data } = await servico()
    .from("mesa_campanhas")
    .select("*")
    .eq("id", cid)
    .eq("client_id", clientId)
    .maybeSingle();
  return (data as CampanhaDaLamina | null) ?? null;
}

/** Briefing da campanha lido com cuidado (JSON do banco): produto em foco, oferta e mensagem central. */
function briefingDaCampanha(c: Pick<CampanhaDaLamina, "briefing">): { produtos: { nome: string; por_que: string }[]; oferta: string; mensagem_central: string } {
  const b = (c.briefing && typeof c.briefing === "object" ? c.briefing : {}) as Record<string, unknown>;
  const produtos = (Array.isArray(b.produtos) ? b.produtos : [])
    .map((p) => {
      const x = (p && typeof p === "object" ? p : { nome: p }) as Record<string, unknown>;
      return { nome: texto(x.nome, 120), por_que: texto(x.por_que, 300) };
    })
    .filter((p) => p.nome)
    .slice(0, 5);
  return { produtos, oferta: texto(b.oferta, 600), mensagem_central: texto(b.mensagem_central, 400) };
}

/** Imagens escolhidas para a campanha (id do acervo, papel e nota da equipe), até 12. */
function imagensDaCampanha(c: Pick<CampanhaDaLamina, "imagens">): { imagem_id: string; papel: string; nota: string }[] {
  const saida: { imagem_id: string; papel: string; nota: string }[] = [];
  for (const x of Array.isArray(c.imagens) ? c.imagens : []) {
    const o = (x && typeof x === "object" ? x : { imagem_id: x }) as Record<string, unknown>;
    const id = String(o.imagem_id ?? o.id ?? "").trim().toLowerCase();
    if (!UUID.test(id) || saida.some((s) => s.imagem_id === id)) continue;
    const papel = o.papel === "heroi" || o.papel === "ambiente" ? String(o.papel) : "apoio";
    saida.push({ imagem_id: id, papel, nota: texto(o.nota, 400) });
    if (saida.length >= 12) break;
  }
  return saida;
}

const ROTULO_DO_PAPEL_NA_CAMPANHA: Record<string, string> = { heroi: "produto herói", apoio: "apoio", ambiente: "ambiente" };

/** Bloco do prompt da lâmina com a identidade do tema da campanha (dentro da marca) e o que ela vende. */
function blocoDaCampanha(c: CampanhaDaLamina): string {
  const i = c.identidade ?? {};
  const apoio = (i.paleta_apoio ?? []).filter((p) => p.hex).map((p) => `${p.nome || "apoio"} ${p.hex}`).join(", ");
  const b = briefingDaCampanha(c);
  return [
    `CAMPANHA "${c.nome}" (identidade do tema, sempre dentro da marca)`,
    i.tema_visual ? `- Tema visual: ${i.tema_visual}` : "",
    apoio ? `- Cores de apoio da campanha (só como acento, a paleta da marca continua dominante): ${apoio}` : "",
    i.tipografia ? `- Título da campanha: ${i.tipografia}` : "",
    i.elementos ? `- Elementos gráficos: ${i.elementos}` : "",
    b.produtos.length
      ? `- Produto em foco (o que a imagem mostra quando a lâmina fala dele): ${b.produtos.map((p) => (p.por_que ? `${p.nome} (${p.por_que})` : p.nome)).join("; ")}`
      : "",
    b.oferta ? `- Oferta da campanha (contexto; na arte vai só o texto exato da lâmina): ${b.oferta}` : "",
    b.mensagem_central ? `- Mensagem central (o clima e a imagem reforçam esta ideia): ${b.mensagem_central}` : "",
  ].filter(Boolean).join("\n");
}

/**
 * Peças do plano de imagens da campanha para ESTE conteúdo (tema_id do item
 * da proposta) e as fotos delas no acervo do cliente (ativas e publicáveis).
 */
async function planoDaCampanhaNoItem(clientId: string, c: CampanhaDaLamina | null, temaId: unknown) {
  const tema = typeof temaId === "string" ? temaId.trim() : "";
  const pecas = c && tema ? pecasDoPlanoGravado(c.plano_imagens).filter((p) => p.tema_id === tema) : [];
  const ids = [...new Set([...pecas.map((p) => p.imagem_id), ...(c ? imagensDaCampanha(c).map((i) => i.imagem_id) : [])])].slice(0, 30);
  const { data } = ids.length
    ? await servico().from("cliente_imagens").select(`${CAMPOS_ACERVO}, ativa`).eq("client_id", clientId).eq("ativa", true).in("id", ids)
    : { data: [] };
  const fotos = new Map(((data as ImagemAcervo[] | null) ?? []).filter((f) => !fotoNaoPublicavel(f)).map((f) => [f.id, f]));
  return { tema, pecas: pecas.filter((p) => fotos.has(p.imagem_id)), fotos };
}

/** Conferencia ainda nao feita: gerar_card e ajustar_card gravam so isto. */
type VerificacaoPendente = { pendente: true };

type Verificacao = {
  pendente?: false;
  texto_lido: string | null;
  ortografia_ok: boolean | null;
  faltando?: string[];
  sobrando?: string[];
  descricao_visual?: string | null;
  logo_presente?: boolean | null;
  logo_ok?: boolean | null;
  /** Se a leitura foi feita sobre o recorte 4:5 central (senao, sobre a tela inteira ignorando as faixas). */
  leitura_no_recorte?: boolean;
  identidade: NotaJev | null;
  /** Só no criativo de anúncio: risco de política da Meta (0 viola, 4 sem risco aparente). */
  politica?: NotaJev | null;
  /** Só no criativo de anúncio: clareza da oferta (0 confusa, 4 imediata). */
  clareza?: NotaJev | null;
  /**
   * Só no criativo de anúncio, como AVISO (a autocorreção não lê; sem laço):
   * a IMAGEM é genérica (Noul do Jev, probabilidade de sim) e quanto ela
   * cumpre o tom pedido pela Mesa Ads (direcao.tom: sobrio, direto, agressivo).
   */
  generico?: { probabilidade: number | null; generico: boolean | null } | { erro: string } | null;
  tom?: (NotaJev & { tom: string }) | { erro: string; tom: string } | null;
  erro?: string;
  conferido_em?: string;
  uso_ids?: string[];
  custo_usd?: number;
  /** Decisão da autocorreção sobre esta conferência (autocorrecao.ts). */
  autocorrecao?: DecisaoDeAutocorrecao;
};

/** Marca da versão que nasceu da autocorreção (corrigir_card). */
type MarcaDeAutocorrecao = { rodada: number; motivos: string[]; pedido_da_equipe?: boolean; areas?: Area[] };

type NotaJev = { nota: number | null; escala_max: number; nivel: string | null; confianca: number | null } | { erro: string };

type VersaoCard = {
  ordem: number;
  versao: number;
  storage_path: string;
  origem: "gerar" | "ajuste";
  instrucao?: string | null;
  referencias?: string[];
  verificacao: Verificacao | VerificacaoPendente;
  /** Só nas versões feitas por corrigir_card. */
  autocorrecao?: MarcaDeAutocorrecao | null;
  custo_usd: number;
  uso_ids: string[];
  criado_em: string;
  criado_por: string;
};

type Trabalho = {
  id: string;
  client_id: string;
  task_id: string | null;
  /** 'social' (padrão: post e carrossel da agenda) ou 'ads' (criativos da Mesa Ads). */
  tipo?: string | null;
  status: string;
  direcao: Direcao;
  modelo_imagem_id: string | null;
  qualidade: string | null;
  cards: VersaoCard[];
  legenda: string | null;
  hashtags?: string[] | null;
  file_ids: string[];
  custo_usd: number;
  /** Sobe a cada reprovação do cliente: a nova entrega vira arquivo novo. */
  entrega_rodada?: number | null;
  /** Estado da aprovação (docs/mesa-do-cliente/SPEC.md): agendado também trava a edição até reabrir. */
  entrega_status?: string | null;
  entrega_aviso?: string | null;
  atualizado_em: string;
};

async function lerTrabalho(id: string): Promise<Trabalho> {
  if (!UUID.test(id)) throw new ErroEstudio(400, "trabalho_invalido", "Trabalho inválido.");
  const { data, error } = await servico().from("estudio_trabalhos").select("*").eq("id", id).maybeSingle();
  if (error) throw new ErroEstudio(503, "trabalho_indisponivel", "Não foi possível ler o trabalho do estúdio.");
  if (!data) throw new ErroEstudio(404, "trabalho_inexistente", "Trabalho do estúdio não encontrado.");
  const t = data as Trabalho;
  t.cards = Array.isArray(t.cards) ? t.cards : [];
  t.direcao = (t.direcao && Array.isArray((t.direcao as Direcao).cards)) ? t.direcao : { conceito: "", carrossel_infinito: false, cards: [] };
  return t;
}

async function trabalhoComAcesso(ch: Chamador, id: string): Promise<Trabalho> {
  const t = await lerTrabalho(id);
  await garantirAcesso(ch, t.client_id);
  return t;
}

/**
 * Grava no trabalho com trava otimista por atualizado_em (o gatilho do banco
 * renova a coluna em todo update). Duas laminas geradas ao mesmo tempo nao
 * apagam a versao uma da outra: quem perde a corrida rele e tenta de novo.
 */
async function mutarTrabalho(id: string, mudar: (t: Trabalho) => Record<string, unknown>): Promise<Trabalho> {
  for (let tentativa = 0; tentativa < 6; tentativa++) {
    const atual = await lerTrabalho(id);
    const patch = mudar(atual);
    const { data, error } = await servico()
      .from("estudio_trabalhos")
      .update(patch)
      .eq("id", id)
      .eq("atualizado_em", atual.atualizado_em)
      .select("*")
      .maybeSingle();
    if (error) throw new ErroEstudio(503, "gravacao_falhou", "Não foi possível gravar o trabalho do estúdio.");
    if (data) return data as Trabalho;
  }
  throw new ErroEstudio(409, "conflito_de_gravacao", "O trabalho mudou várias vezes ao mesmo tempo. Tente de novo.");
}

function versaoAtual(t: Trabalho, ordem: number): VersaoCard | null {
  const versoes = t.cards.filter((c) => c.ordem === ordem);
  if (!versoes.length) return null;
  return versoes.reduce((a, b) => (b.versao > a.versao ? b : a));
}

function cardDaDirecao(t: Trabalho, ordem: number): CardDirecao {
  const card = t.direcao.cards.find((c) => c.ordem === ordem);
  if (!card) throw new ErroEstudio(404, "card_inexistente", `A direção não tem o card ${ordem}.`);
  return comLayout(card, t.direcao.cards.length);
}

/**
 * Direção antiga (de antes do layout por lâmina) não tinha layout: o gerador
 * usava o prompt_imagem gravado na época, sem paleta, regras nem estilo da
 * marca, e cada "refazer" mandava o mesmo pedido (dono, 23/09: "as 4 versões
 * só mudam a fonte e não têm nada a ver com a identidade"). Agora a lâmina sem
 * layout ganha na hora o layout padrão da função dela, com a cena do roteiro,
 * e passa pelo prompt da marca como as outras.
 */
function comLayout(card: CardDirecao, total: number): CardDirecao {
  if (card.layout) return card;
  const padrao = layoutPadrao(card.funcao, card.ordem, total);
  const cena = texto(card.ilustracao || card.composicao, 500);
  return {
    ...card,
    layout: { ...padrao, imagem: cena || padrao.imagem },
    blocos: card.blocos?.length ? card.blocos : blocosDoTexto(card.texto_exato, card.funcao),
  };
}

const totalCards = (t: Trabalho) => t.direcao.cards.length;

/**
 * Refazer não pode devolver a mesma arte (dono, 24/09): o pedido era idêntico
 * a cada vez. Da segunda versão em diante, o prompt pede outra composição e
 * gira uma direção concreta por versão. Com foto real ou fundo contínuo a
 * cena fica; muda a composição do texto.
 */
// Pedido do dono em 25/09 ("mais técnica, variar os prompts, sem perder a
// essência"): as técnicas da base de conhecimento entram na roda de variações.
const VARIACOES_DE_CENA = [
  "enquadramento mais aberto, mostrando mais do ambiente, com o assunto menor e deslocado para um lado",
  "plano mais fechado e próximo do assunto, com detalhe e textura em primeiro plano",
  "câmera em outro ângulo (mais baixa ou mais alta) e o assunto do lado oposto ao da versão anterior",
  "outra pose e outro gesto da pessoa (ou outra posição do objeto), com o olhar ou a ação apontando para o texto",
  "outra hora do dia e outra luz no mesmo cenário, mantendo a paleta da marca",
  "escala dramática: o assunto grande, sangrando pela borda, e muito espaço calmo do outro lado para o texto",
  "cor seletiva: a cena mais neutra e só o elemento principal (ou um bloco atrás dele) na cor de destaque da marca",
  "painel sólido na cor da marca cobrindo um terço da lâmina, alinhado ao grid, com o texto dentro e o assunto fora dele",
  "silhueta do assunto sobre cor chapada da paleta, com sombra de contato suave, sem caixa em volta",
];
const VARIACOES_DE_TEXTO = [
  "texto em outra posição da lâmina (se estava embaixo, vai para cima ou para a lateral)",
  "hierarquia diferente: a palavra-chave bem maior e o resto menor, em outra disposição de linhas",
  "outro arranjo do bloco de texto (alinhamento, largura e quebra de linhas diferentes)",
  "tipografia como imagem: a headline em escala máxima ocupando a largura útil, o apoio pequeno e colado",
];
/**
 * `ordem` gira o ponto de partida por lâmina: duas lâminas refeitas ao mesmo
 * tempo não caem na mesma variação. `serie`: da lâmina 2 em diante a variação
 * fica dentro do sistema visual da capa.
 */
export function blocoDeVariacao(versoesAntes: number, cenaFixa: boolean, replicar = false, ordem = 1, serie = false): string {
  if (versoesAntes < 1) return "";
  const i = versoesAntes - 1 + Math.max(0, ordem - 1);
  // Replicando a referência escolhida, refazer não pode fugir dela: a estrutura fica e muda só o acabamento.
  if (replicar) {
    return [
      `NOVA VERSÃO (${versoesAntes + 1}ª) DESTA LÂMINA: continue seguindo a referência escolhida de perto, com a mesma estrutura de layout.`,
      "Mude só detalhes de execução: o recorte e a posição do assunto dentro do mesmo espaço da referência, a textura e a luz.",
      "Continuam iguais: o texto exato, a mensagem, a marca (cores, fontes, logo) e a pessoa ou o produto da foto do cliente.",
    ].join(" ");
  }
  return [
    `NOVA VERSÃO (${versoesAntes + 1}ª) DESTA LÂMINA: a equipe pediu para refazer, então NÃO repita a composição da versão anterior.`,
    cenaFixa
      ? `A cena de fundo fica; mude a composição gráfica: ${VARIACOES_DE_TEXTO[i % VARIACOES_DE_TEXTO.length]}.`
      : `Mude de verdade a composição: ${VARIACOES_DE_CENA[i % VARIACOES_DE_CENA.length]}; e ${VARIACOES_DE_TEXTO[i % VARIACOES_DE_TEXTO.length]}.`,
    serie ? "A mudança fica dentro do sistema visual da capa (mesmo grid, linhas, formas, tipografia e paleta): muda a composição, não o estilo." : "",
    "Continuam iguais: o texto exato, a mensagem, a marca (cores, fontes, logo) e a qualidade.",
  ].filter(Boolean).join(" ");
}
/**
 * Trabalho da Mesa Ads: criativo de anúncio. Um card é a peça única (1:1, 4:5
 * ou 9:16); vários cards são um carrossel de anúncio (feed 4:5).
 */
const ehAds = (t: Pick<Trabalho, "tipo">) => t.tipo === "ads";
// Logo na capa e no final (a peça única do anúncio é as duas coisas).
const levaLogo = (t: Trabalho, ordem: number) => ordem === 1 || ordem === totalCards(t);

type QuadroDoCard = {
  /** Formato do criativo (só no trabalho de anúncio). */
  formato: FormatoCriativo | null;
  /** Formato do post orgânico (só no trabalho social; 4:5 quando o trabalho não escolheu). */
  post: FormatoDoPost | null;
  largura: number;
  altura: number;
  /** Tamanho pedido ao gerador, "LxA". */
  tamanho: string;
  /** Quadro final publicado. */
  final: { largura: number; altura: number };
  proporcao: string;
  /** Tamanho diferente de 4:5: sem a reserva em 2:3 do motor (o recorte cortaria texto). */
  fixo: boolean;
};

const PROPORCAO_DO_FORMATO: Record<FormatoCriativo, string> = { feed_4x5: "4:5", quadrado_1x1: "1:1", stories_9x16: "9:16" };

/**
 * Tamanho da lâmina: o post (social) é sempre 4:5 (1088 x 1360, final
 * 1080 x 1350), como sempre foi; o criativo de anúncio segue o formato do card
 * (feed 4:5 quando o card não traz formato).
 */
function quadroDoCard(t: Pick<Trabalho, "tipo"> & { direcao?: Pick<Direcao, "formato"> | null }, card: Pick<CardDirecao, "formato">): QuadroDoCard {
  if (!ehAds(t)) {
    // Post orgânico: o formato do conjunto (pedido do dono em 25/09); sem ele, 4:5 como sempre.
    const post = formatoDoPost(t.direcao?.formato);
    if (post !== "feed_4x5") {
      const q = QUADRO_DO_POST[post];
      return {
        formato: null,
        post,
        largura: q.gerador.largura,
        altura: q.gerador.altura,
        tamanho: `${q.gerador.largura}x${q.gerador.altura}`,
        final: q.final,
        proporcao: q.proporcao,
        fixo: true,
      };
    }
    return {
      formato: null,
      post,
      largura: LARGURA_LAMINA,
      altura: ALTURA_LAMINA,
      tamanho: TAMANHO_GERADOR,
      final: { largura: LARGURA_FINAL, altura: ALTURA_FINAL },
      proporcao: "4:5",
      fixo: false,
    };
  }
  const formato: FormatoCriativo = FORMATOS_CRIATIVO.includes(card.formato as FormatoCriativo) ? card.formato as FormatoCriativo : "feed_4x5";
  const g = TAMANHO_DO_FORMATO[formato];
  const tamanho = `${g.largura}x${g.altura}`;
  return {
    formato,
    post: null,
    largura: g.largura,
    altura: g.altura,
    tamanho,
    final: QUADRO_FINAL[formato],
    proporcao: PROPORCAO_DO_FORMATO[formato],
    fixo: tamanho !== TAMANHO_GERADOR,
  };
}

function statusDepoisDeGerar(t: Trabalho, novas: VersaoCard[]): string {
  const todas = [...t.cards, ...novas];
  const completo = t.direcao.cards.every((c) => todas.some((v) => v.ordem === c.ordem));
  return completo ? "pronto" : "gerando";
}

// ------------------------------------------------------ contexto do cliente

type Kit = {
  paleta: unknown;
  logo_file_id: string | null;
  /** Logo escolhida de qualquer pasta (copiada para o bucket mesa); tem prioridade sobre logo_file_id. */
  logo_path?: string | null;
  logo_alt_path?: string | null;
  /** Versão alternativa da logo (clara ou escura) em Arquivos; o código usa a que contrasta. */
  logo_alt_file_id?: string | null;
  estilo: string | null;
  regras: string | null;
} | null;

/**
 * Marca do trabalho (_shared/marca.ts): pelo projeto do item, pela
 * direcao.marca_id (Estúdio Ads) ou pelo marca_id da tela. Sem alvo, ou
 * cliente sem marca cadastrada: null, e tudo segue como antes.
 */
function marcaDe(clientId: string, alvo?: AlvoDaMarca): Promise<MarcaDoCliente | null> {
  return alvo === undefined ? Promise.resolve(null) : resolverMarca(servico(), clientId, alvo);
}

async function lerKit(clientId: string, alvo?: AlvoDaMarca): Promise<Kit> {
  const [{ data }, marca] = await Promise.all([
    servico()
      .from("cliente_kit_marca")
      .select("paleta, logo_file_id, logo_path, logo_alt_path, logo_alt_file_id, estilo, regras")
      .eq("client_id", clientId)
      .maybeSingle(),
    marcaDe(clientId, alvo),
  ]);
  return kitComMarca((data as Kit) ?? null, marca);
}

type Fonte = { id: string; nome: string; papel: string; amostra_path: string | null };

async function lerFontes(clientId: string, alvo?: AlvoDaMarca): Promise<Fonte[]> {
  const marca = await marcaDe(clientId, alvo);
  const { data } = await servico()
    .from("cliente_fontes")
    .select(colunasComMarca("id, nome, papel, amostra_path", marca))
    .eq("client_id", clientId)
    .order("criado_em", { ascending: true });
  return fontesDaMarca(((data as unknown) as (Fonte & { marca_id?: string | null })[] | null) ?? [], marca);
}

/** Amostras PNG das fontes (geradas no navegador), no maximo tres. */
async function amostrasDasFontes(fontes: Fonte[]): Promise<{ imagem: ImagemEntrada; fonte: Fonte }[]> {
  const saida: { imagem: ImagemEntrada; fonte: Fonte }[] = [];
  const ordemPapel: Record<string, number> = { titulo: 0, destaque: 1, texto: 2 };
  const comAmostra = fontes.filter((f) => f.amostra_path).sort((a, b) => (ordemPapel[a.papel] ?? 9) - (ordemPapel[b.papel] ?? 9));
  for (const f of comAmostra.slice(0, MAX_AMOSTRAS_FONTE)) {
    try {
      saida.push({ imagem: await baixarImagem("mesa", f.amostra_path!, `fonte-${f.papel}-${f.nome}`), fonte: f });
    } catch {
      // Amostra sumida nao impede a lamina; a direcao ja descreve a fonte.
    }
  }
  return saida;
}

/**
 * Logo oficial: a escolhida de qualquer pasta (kit.logo_path, no bucket mesa,
 * sempre sob a pasta do cliente) e, sem ela, o arquivo do kit.
 */
async function baixarLogo(clientId: string, kit: Kit, alternativa = false): Promise<ImagemEntrada | null> {
  const bruta = await baixarLogoBruta(clientId, kit, alternativa);
  if (!bruta) return null;
  // Sem o fundo falso (xadrez de transparência, branco ou creme): o gerador copiava como uma caixa.
  // Aparada (26/09): sem a margem vazia em volta, a logo anexada é a logo inteira e o gerador não a faz minúscula.
  try {
    const limpa = await logoLimpa(bruta.bytes, { aparar: true });
    return limpa === bruta.bytes ? bruta : { bytes: limpa, mime: "image/png", nome: alternativa ? "logo-alternativa.png" : "logo-oficial.png" };
  } catch {
    return bruta;
  }
}

/**
 * Logo reduzida pelo Storage (até 1024 px, sem cortar): arquivo de logo de
 * 7.800 px levava mais de 1 s de CPU só para abrir. Sem a transformação, o original.
 */
async function baixarLogoReduzida(bucket: string, caminho: string, nome: string): Promise<ImagemEntrada> {
  try {
    const { data, error } = await servico().storage.from(bucket).download(caminho, {
      transform: { width: 1024, height: 1024, resize: "contain", format: "origin" },
    });
    if (!error && data) {
      const bytes = new Uint8Array(await data.arrayBuffer());
      const mime = mimeDe(bytes);
      if (mime) return { bytes, mime, nome: `${nomeSeguro(nome)}.${extensaoDe(mime)}` };
    }
  } catch {
    // sem a transformação: o original abaixo
  }
  return await baixarImagem(bucket, caminho, nome);
}

/** Onde mora o arquivo da logo do kit (bucket e caminho): a escolhida de qualquer pasta (bucket mesa) ou o arquivo do kit. */
async function ondeEstaALogo(clientId: string, kit: Kit, alternativa = false): Promise<{ bucket: string; caminho: string } | null> {
  const caminhoNoMesa = alternativa ? kit?.logo_alt_path : kit?.logo_path;
  const arquivo = alternativa ? kit?.logo_alt_file_id : kit?.logo_file_id;
  if (caminhoNoMesa && caminhoNoMesa.startsWith(`${clientId}/`) && caminhoNoMesa.indexOf("..") < 0) return { bucket: "mesa", caminho: caminhoNoMesa };
  if (!arquivo) return null;
  const { data } = await servico()
    .from("files")
    .select("id, client_id, file_name, file_url, storage_bucket, storage_path")
    .eq("id", arquivo)
    .maybeSingle();
  const f = data as { client_id: string; file_name: string; file_url: string; storage_bucket: string | null; storage_path: string | null } | null;
  if (!f || f.client_id !== clientId) return null;
  let bucket = f.storage_bucket;
  let caminho = f.storage_path;
  if (!caminho && f.file_url?.startsWith("files://")) {
    bucket = "files";
    caminho = f.file_url.slice("files://".length);
  }
  return bucket && caminho ? { bucket, caminho } : null;
}

async function baixarLogoBruta(clientId: string, kit: Kit, alternativa = false): Promise<ImagemEntrada | null> {
  const nome = alternativa ? "logo-alternativa" : "logo-oficial";
  const onde = await ondeEstaALogo(clientId, kit, alternativa);
  if (!onde) return null;
  try {
    return await baixarLogoReduzida(onde.bucket, onde.caminho, nome);
  } catch {
    // Logo escolhida no bucket mesa sumiu: tenta o arquivo do kit.
    if (onde.bucket === "mesa" && (alternativa ? kit?.logo_alt_file_id : kit?.logo_file_id)) {
      const semMesa = { ...(kit as NonNullable<Kit>), [alternativa ? "logo_alt_path" : "logo_path"]: null } as Kit;
      const outro = await ondeEstaALogo(clientId, semMesa, alternativa);
      if (outro) return await baixarLogoReduzida(outro.bucket, outro.caminho, nome).catch(() => null);
    }
    return null;
  }
}

/**
 * logos { trabalho_id }: as logos do kit da marca do trabalho, para a tela
 * escolher qual a lâmina usa (dono, 26/09). Sem custo, sem abrir a imagem:
 * só o endereço assinado de cada uma e a escolha gravada. Na marca por
 * projeto (Acerbi e CME) o kit é o da marca aberta.
 */
async function logosDoTrabalho(ch: Chamador, corpo: Record<string, unknown>) {
  const t = await trabalhoComAcesso(ch, texto(corpo.trabalho_id, 64));
  const kit = await lerKit(t.client_id, t);
  const saida: { id: "principal" | "alternativa"; rotulo: string; url: string | null }[] = [];
  for (const [id, alternativa] of [["principal", false], ["alternativa", true]] as const) {
    const onde = await ondeEstaALogo(t.client_id, kit, alternativa);
    if (!onde) continue;
    const { data } = await servico().storage.from(onde.bucket).createSignedUrl(onde.caminho, 3600);
    saida.push({ id, rotulo: alternativa ? "Alternativa" : "Principal", url: data?.signedUrl ?? null });
  }
  return json({
    trabalho_id: t.id,
    logos: saida,
    escolha_do_conjunto: escolhaDaLogo(t.direcao.logo_escolhida) ?? "auto",
    escolhas_das_laminas: Object.fromEntries(t.direcao.cards.filter((c) => escolhaDaLogo(c.logo)).map((c) => [String(c.ordem), c.logo])),
    custo_usd: 0,
  });
}

/** Uma logo do kit, limpa (sem fundo falso) e medida: o anexo que o gerador copia. */
type LogoDoKit = { id: "principal" | "alternativa"; imagem: ImagemEntrada; medida: LogoMedida | null };

/**
 * Logos do kit da marca do trabalho (dono, 26/09: "escolher no kit de marca
 * qual logo eu quero"; a logo é gerada junto com a arte, nunca colada pelo
 * código): a principal e, quando existe, a alternativa, cada uma limpa e
 * medida (tom, claridade e proporção). Na marca por projeto o kit já é o da
 * marca aberta (lerKit com o trabalho).
 */
async function logosDoKit(clientId: string, kit: Kit, pedida: EscolhaDaLogo = "auto"): Promise<LogoDoKit[]> {
  // Escolha explícita: só a pedida é baixada e medida (limite de CPU). "auto" baixa as duas para achar a que contrasta.
  const temAlternativa = !!(kit?.logo_alt_path || kit?.logo_alt_file_id);
  const querPrincipal = pedida !== "alternativa" || !temAlternativa;
  const querAlternativa = temAlternativa && pedida !== "principal";
  const [principal, alternativa] = await Promise.all([
    querPrincipal ? baixarLogo(clientId, kit).catch(() => null) : Promise.resolve(null),
    querAlternativa ? baixarLogo(clientId, kit, true).catch(() => null) : Promise.resolve(null),
  ]);
  const saida: LogoDoKit[] = [];
  for (const [id, imagem] of [["principal", principal], ["alternativa", alternativa]] as const) {
    if (!imagem) continue;
    const medida = await analisarLogo(imagem.bytes).catch(() => null);
    saida.push({ id, imagem, medida });
  }
  // A pedida não abriu: fica a principal (melhor uma logo certa que nenhuma).
  if (!saida.length && pedida === "alternativa") return await logosDoKit(clientId, kit, "principal");
  return saida;
}

/** A escolha que vale para a lâmina: a dela, senão a do conjunto, senão automática. */
const escolhaDaLamina = (t: Pick<Trabalho, "direcao">, card: Pick<CardDirecao, "logo">, daVersao: EscolhaDaLogo | null = null): EscolhaDaLogo =>
  escolhaDaLogo(card.logo) || daVersao || escolhaDaLogo(t.direcao.logo_escolhida) || "auto";

/**
 * A logo desta lâmina: a escolhida (lâmina, senão conjunto) ou a que
 * contrasta com o fundo (logoDaLamina). `valorDoFundo`: claridade de 0 a 255
 * do fundo onde a logo vai (null quando não se sabe: fica a principal).
 */
function escolherLogoDoKit(logos: LogoDoKit[], t: Pick<Trabalho, "direcao">, card: Pick<CardDirecao, "logo">, valorDoFundo: number | null): LogoDoKit | null {
  const id = logoDaLamina(
    logos.map((l) => ({ id: l.id, clara: l.medida ? l.medida.clara : null })),
    { lamina: card.logo, conjunto: t.direcao.logo_escolhida },
    valorDoFundo,
  );
  return id ? logos.find((l) => l.id === id) || null : null;
}

type Referencia = {
  id: string;
  client_id: string;
  origem: string;
  workspace_node_id: string | null;
  url_origem: string | null;
  storage_path: string | null;
  leitura: string | null;
  tags: string[] | null;
  file_id?: string | null;
  /** identidade: arte da própria marca; tecnica: peça que ensina composição; global: banco da agência. */
  papel?: string | null;
};

/** Bytes da referencia: copia no bucket mesa ou o proprio arquivo do workspace. */
async function imagemDaReferencia(ref: Referencia): Promise<ImagemEntrada> {
  if (ref.storage_path) return await baixarImagem("mesa", ref.storage_path, `referencia-${ref.id.slice(0, 8)}`);
  if (ref.workspace_node_id) {
    const { data } = await servico()
      .from("workspace_nodes")
      .select("id, client_id, name, storage_path, mime")
      .eq("id", ref.workspace_node_id)
      .maybeSingle();
    const no = data as { client_id: string | null; name: string; storage_path: string | null } | null;
    if (!no || no.client_id !== ref.client_id || !no.storage_path) {
      throw new ErroEstudio(404, "referencia_sem_arquivo", "A imagem desta referência não está mais no workspace.");
    }
    return await baixarImagem("workspace", no.storage_path, `referencia-${ref.id.slice(0, 8)}`);
  }
  if (ref.file_id) {
    const { data } = await servico()
      .from("files")
      .select("client_id, storage_bucket, storage_path, file_url")
      .eq("id", ref.file_id)
      .maybeSingle();
    const f = data as { client_id: string; storage_bucket: string | null; storage_path: string | null; file_url: string | null } | null;
    const c = f && f.client_id === ref.client_id ? caminhoDoArquivo(f) : null;
    if (!c) throw new ErroEstudio(404, "referencia_sem_arquivo", "A arte desta referência não está mais em Arquivos.");
    return await baixarImagem(c.bucket, c.caminho, `arte-da-marca-${ref.id.slice(0, 8)}`);
  }
  throw new ErroEstudio(404, "referencia_sem_arquivo", "Esta referência não tem imagem guardada.");
}

/** Prompt efetivo do diretor: global ativo + complemento ativo do cliente. */
async function promptDoDiretor(clientId: string): Promise<string> {
  const { data, error } = await servico()
    .from("agente_prompts")
    .select("client_id, conteudo, versao")
    .eq("agente", "diretor_arte")
    .eq("ativo", true)
    .or(`client_id.is.null,client_id.eq.${clientId}`);
  if (error) throw new ErroEstudio(503, "prompt_indisponivel", "Não foi possível ler o prompt do diretor de arte.");
  const linhas = (data as { client_id: string | null; conteudo: string }[] | null) ?? [];
  const global = linhas.find((l) => l.client_id === null)?.conteudo?.trim();
  if (!global) throw new ErroEstudio(409, "prompt_global_ausente", "O prompt global do diretor de arte não está ativo.");
  const complemento = linhas.find((l) => l.client_id === clientId)?.conteudo?.trim();
  return complemento ? `${global}\n\nCOMPLEMENTO DESTE CLIENTE\n\n${complemento}` : global;
}

async function memoriaDoDiretor(clientId: string): Promise<{ tipo: string; texto: string; origem: string }[]> {
  const { data } = await servico()
    .from("agente_memoria")
    .select("tipo, texto, origem")
    .eq("client_id", clientId)
    .eq("agente", "diretor_arte")
    .eq("ativa", true)
    .order("criado_em", { ascending: false })
    .limit(30);
  return ((data as { tipo: string; texto: string; origem: string }[] | null) ?? []).map((m) => ({ ...m, texto: texto(m.texto, 400) }));
}

/**
 * Regras da marca aprendidas com este cliente, em texto para o prompt (pedido
 * do dono em 25/09: "aprender com os ajustes que eu peço, memória por
 * cliente"). Vem do cérebro do cliente (_shared/cerebro-do-cliente.ts: junta
 * a memória do diretor, as reprovações com o comentário e o resto, sem
 * repetir, com teto de tamanho), nas áreas do diretor de arte. Se o cérebro
 * não responder, a memória do diretor (agente_memoria) direto, mais recente
 * primeiro. Vazio quando o cliente ainda não ensinou nada.
 */
async function preferenciasDaArte(clientId: string, memoria?: { tipo: string; texto: string; origem: string }[]): Promise<string> {
  try {
    const leitura = await lerCerebro(servico(), clientId);
    const r = resumoParaPrompt(leitura.fatos, {
      areas: AREAS_DO_AGENTE.diretor_arte,
      limite: 1600,
      titulo: "REGRAS DA MARCA APRENDIDAS COM ESTE CLIENTE (pedidos de ajuste da equipe e reprovações do cliente; valem como regra da marca, acima do padrão de design e abaixo do texto exato, da paleta e da logo)",
    });
    if (r.texto) return r.texto;
  } catch {
    // cérebro fora do ar: a memória do diretor abaixo
  }
  return blocoDasPreferencias(memoria ?? await memoriaDoDiretor(clientId));
}

/** Mesmo cabeçalho das regras aprendidas (preferenciasDaArte), para o bloco do diretor. */
const TITULO_DAS_REGRAS_APRENDIDAS = "REGRAS DA MARCA APRENDIDAS COM ESTE CLIENTE (pedidos de ajuste da equipe e reprovações do cliente; valem como regra da marca, acima do padrão de design e abaixo do texto exato, da paleta e da logo)";

/**
 * Frente H (25/09): o diretor de arte lê o cérebro E o dossiê atual do
 * cliente (docs/cerebro/AGENTES.md, ponto 3.1), numa leitura só
 * (contextoParaAgente, área arte com foto). Sem cérebro, as regras vêm da
 * memória do diretor como antes; sem dossiê, só as regras. `usouCerebro` diz
 * se o resumo do cérebro entrou (aí a lista crua da memória pode sair do JSON).
 */
async function cerebroEDossieDoDiretor(
  clientId: string,
  memoria?: { tipo: string; texto: string; origem: string }[],
): Promise<{ texto: string; usouCerebro: boolean }> {
  try {
    const r = await contextoParaAgente(servico(), clientId, "arte", {
      areas: AREAS_DO_AGENTE.diretor_arte,
      limiteCerebro: 1600,
      limiteDossie: 3000,
      tituloCerebro: TITULO_DAS_REGRAS_APRENDIDAS,
    });
    if (r.cerebro) return { texto: r.texto, usouCerebro: true };
    const regras = blocoDasPreferencias(memoria ?? await memoriaDoDiretor(clientId));
    const dossie = r.dossie ? `DOSSIÊ ATUAL DO CLIENTE (fatos do painel; vazio não quer dizer que não existe)\n${r.dossie}` : "";
    return { texto: [regras, dossie].filter(Boolean).join("\n\n"), usouCerebro: false };
  } catch {
    return { texto: await preferenciasDaArte(clientId, memoria).catch(() => ""), usouCerebro: false };
  }
}

/** Base de marketing do diretor (anti-genérico, voz, revisão de marca, CTA), com teto; vai logo depois de CONHECIMENTO_DIRETOR. */
const CONHECIMENTO_DA_DIRECAO = conhecimentoEstudioPara("direcao").texto;
/** Títulos, CTA e anti-genérico para a legenda final, com teto. */
const CONHECIMENTO_DA_LEGENDA = conhecimentoEstudioPara("legenda").texto;

/** Marca pronta para o compositor: kit, fontes, contexto consolidado e nome. */
async function marcaDoCliente(clientId: string, kit?: Kit, fontes?: Fonte[], alvo?: AlvoDaMarca): Promise<MarcaParaDirecao> {
  const [k, f, contextoDoCliente, perfil, daMarca] = await Promise.all([
    kit === undefined ? lerKit(clientId, alvo) : Promise.resolve(kit),
    fontes === undefined ? lerFontes(clientId, alvo) : Promise.resolve(fontes),
    lerContextoConsolidado(servico(), clientId),
    servico().from("profiles").select("company_name, full_name").eq("id", clientId).maybeSingle(),
    marcaDe(clientId, alvo),
  ]);
  // Marca por projeto (Acerbi e CME): tom e contexto da marca por cima; o nome é o da marca que não é a principal.
  const contexto = contextoComMarca(contextoDoCliente, daMarca);
  const p = perfil.data as { company_name: string | null; full_name: string | null } | null;
  return {
    nomeCliente: daMarca && !daMarca.principal ? texto(daMarca.nome, 120) : texto(p?.company_name || p?.full_name || "cliente", 120),
    paleta: Array.isArray(k?.paleta) ? k!.paleta as MarcaParaDirecao["paleta"] : [],
    estilo: k?.estilo ?? null,
    regras: k?.regras ?? null,
    fontes: f.map((x) => ({ nome: x.nome, papel: x.papel })),
    tipografiaCitada: contexto.tipografia ?? null,
    tomDeVoz: contexto.tom_de_voz ?? null,
    temLogo: !!(k?.logo_path || k?.logo_file_id),
  };
}

// ------------------------------------------------ acervo de imagens reais

type ImagemAcervo = {
  id: string;
  client_id: string;
  storage_bucket: string;
  storage_path: string;
  nome: string;
  pasta: string | null;
  categoria: string | null;
  tags: string[] | null;
  descricao: string | null;
};

const CAMPOS_ACERVO = "id, client_id, storage_bucket, storage_path, nome, pasta, categoria, tags, descricao";

/** Acervo ativo do cliente para o diretor escolher a foto de cada lâmina (sem custo). */
async function lerAcervo(clientId: string, limite = 60): Promise<ImagemAcervo[]> {
  const { data } = await servico()
    .from("cliente_imagens")
    .select(CAMPOS_ACERVO)
    .eq("client_id", clientId)
    .eq("ativa", true)
    // neq sozinho descartava as fotos ainda sem categoria (NULL); arte pronta e logo não servem de base.
    .or("categoria.is.null,categoria.not.in.(logo,arte)")
    .order("atualizado_em", { ascending: false })
    .limit(limite);
  return (data as ImagemAcervo[] | null) ?? [];
}

async function imagensDoAcervo(clientId: string, ids: string[]): Promise<ImagemAcervo[]> {
  const validos = ids.filter((i) => UUID.test(i)).slice(0, 8);
  if (!validos.length) return [];
  const { data } = await servico().from("cliente_imagens").select(CAMPOS_ACERVO).eq("client_id", clientId).in("id", validos);
  const achadas = (data as ImagemAcervo[] | null) ?? [];
  return validos.map((i) => achadas.find((a) => a.id === i)).filter(Boolean) as ImagemAcervo[];
}

const resumoDaFoto = (a: ImagemAcervo) =>
  texto([a.descricao, a.categoria ? `categoria ${a.categoria}` : "", a.pasta ? `pasta ${a.pasta}` : ""].filter(Boolean).join("; ") || a.nome, 400);

/**
 * Foto real já no formato da lâmina (1088 x 1360 por padrão; o criativo de
 * anúncio passa o tamanho do formato), recortada pelo foco da foto. O Storage
 * só reduz a foto inteira (contain, sem cortar: o "cover" dele cortava pelo
 * centro e decapitava quem estava no alto de uma foto de Reels) e o recorte
 * com foco é feito aqui.
 */
async function fotoRealNaLamina(a: ImagemAcervo, largura = LARGURA_LAMINA, altura = ALTURA_LAMINA): Promise<Uint8Array> {
  return await fotoDoBucketNaLamina(a.storage_bucket, a.storage_path, largura, altura);
}

/**
 * Bytes da foto já reduzidos pelo Storage (contain em 2000 x 2500, sem
 * cortar), ou null. As fotos da Mesa Foto chegam a 4K: decodificar o original
 * aqui estourava o limite de CPU da função.
 */
async function baixarReduzida(bucket: string, caminho: string): Promise<Uint8Array | null> {
  try {
    const { data, error } = await servico().storage.from(bucket).download(caminho, {
      transform: { width: 2000, height: 2500, resize: "contain", format: "origin" },
    });
    if (!error && data) {
      const bytes = new Uint8Array(await data.arrayBuffer());
      if (mimeDe(bytes)) return bytes;
    }
  } catch {
    // sem a transformação: o original
  }
  return null;
}

/** Foto (do acervo ou trazida pela equipe) no formato da lâmina, recortada pelo foco. */
async function fotoDoBucketNaLamina(bucket: string, caminho: string, largura = LARGURA_LAMINA, altura = ALTURA_LAMINA): Promise<Uint8Array> {
  const reduzida = await baixarReduzida(bucket, caminho);
  return await fotoNaLamina(reduzida ?? await baixar(bucket, caminho), largura, altura);
}

/** Foto de pessoa ou objeto anexada ao gerador como é (reduzida quando dá, sem decodificar aqui). */
async function imagemReduzida(bucket: string, caminho: string, nome: string): Promise<ImagemEntrada> {
  const reduzida = await baixarReduzida(bucket, caminho);
  if (reduzida) {
    const mime = mimeDe(reduzida)!;
    return { bytes: reduzida, mime, nome: `${nomeSeguro(nome)}.${extensaoDe(mime)}` };
  }
  return await baixarImagem(bucket, caminho, nome);
}

async function modeloDoPapel(papel: "diretor_arte" | "leitura" | "imagem"): Promise<ModeloIa> {
  const m = await modeloPadrao(papel);
  if (!m) throw new ErroEstudio(503, "modelo_padrao_ausente", `O catálogo não tem modelo padrão ativo para ${papel}.`);
  return m;
}

/** Primeiro nivel de raciocinio aceito pelo modelo, na ordem de preferencia. */
function raciocinioPara(m: ModeloIa, preferidos: string[]): string | undefined {
  const aceitos = m.raciocinio ?? [];
  return preferidos.find((r) => aceitos.includes(r));
}

// ------------------------------------------------------- item da agenda

type Tarefa = {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  delivery_type: string;
  due_date: string | null;
  deleted_at: string | null;
};

type ItemDaAgenda = {
  tarefa: Tarefa;
  clientId: string;
  projeto: { id: string; name: string };
  post: { id: string; title: string; objective: string | null; default_caption: string | null; content_type: string } | null;
  itemProposta: Record<string, unknown> | null;
};

async function lerItemDaAgenda(taskId: string): Promise<ItemDaAgenda> {
  if (!UUID.test(taskId)) throw new ErroEstudio(400, "item_invalido", "Item da agenda inválido.");
  const db = servico();
  const { data: t } = await db
    .from("tasks")
    .select("id, project_id, title, description, delivery_type, due_date, deleted_at")
    .eq("id", taskId)
    .maybeSingle();
  const tarefa = t as Tarefa | null;
  if (!tarefa || tarefa.deleted_at) throw new ErroEstudio(404, "item_inexistente", "Item da agenda não encontrado.");
  const { data: p } = await db.from("projects").select("id, name, client_id, deleted_at").eq("id", tarefa.project_id).maybeSingle();
  const projeto = p as { id: string; name: string; client_id: string; deleted_at: string | null } | null;
  if (!projeto || projeto.deleted_at) throw new ErroEstudio(404, "projeto_inexistente", "O projeto deste item não foi encontrado.");

  // Post editorial atual do item, pela mesma regra de
  // editorial_current_post_id_for_task (a funcao nao e exposta a RPC):
  // ligado pela tarefa, nao arquivado, em producao e sem revisao mais nova.
  let post: ItemDaAgenda["post"] = null;
  const { data: ligacoes } = await db
    .from("editorial_post_internal")
    .select("post_id, revision_of_post_id")
    .eq("task_id", taskId);
  const links = (ligacoes as { post_id: string; revision_of_post_id: string | null }[] | null) ?? [];
  if (links.length) {
    const revisados = new Set(links.map((l) => l.revision_of_post_id).filter(Boolean));
    const { data: posts } = await db
      .from("editorial_posts")
      .select("id, title, objective, default_caption, content_type, created_at")
      .in("id", links.map((l) => l.post_id))
      .is("archived_at", null)
      .in("production_status", ["draft", "production", "ready"])
      .order("created_at", { ascending: false });
    const candidato = ((posts as ItemDaAgenda["post"][] | null) ?? []).find((x) => x && !revisados.has(x.id));
    post = candidato ?? null;
  }

  // Item detalhado pelo estrategista (roteiro de cada card), quando o item
  // nasceu de uma proposta gravada. O agente do calendario grava o task_id em
  // cada item ao gravar na agenda; a busca e so por ele, nunca por posicao.
  let itemProposta: Record<string, unknown> | null = null;
  const { data: propostas } = await db
    .from("calendario_propostas")
    .select("itens")
    .eq("client_id", projeto.client_id)
    .contains("task_ids", [taskId])
    .eq("status", "gravada")
    .order("criado_em", { ascending: false })
    .limit(1);
  const proposta = ((propostas as { itens: unknown }[] | null) ?? [])[0];
  if (proposta && Array.isArray(proposta.itens)) {
    const itens = proposta.itens as Record<string, unknown>[];
    itemProposta = itens.find((i) => i && typeof i === "object" && i.task_id === taskId) ?? null;
  }

  return { tarefa, clientId: projeto.client_id, projeto: { id: projeto.id, name: projeto.name }, post, itemProposta };
}

// ------------------------------------------------------------- preparar

const ZONAS_TEXTO = ["topo-esquerda", "topo-centro", "centro-esquerda", "centro", "base-esquerda", "base-centro", "base-direita", "coluna-esquerda", "coluna-direita"];

const ESQUEMA_DIRECAO = {
  nome: "direcao_de_arte",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["conceito", "fio_visual", "carrossel_infinito", "cards"],
    properties: {
      conceito: { type: "string" },
      fio_visual: { type: "string" },
      carrossel_infinito: { type: "boolean" },
      cards: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["ordem", "funcao", "blocos", "layout", "evitar", "imagem_acervo"],
          properties: {
            ordem: { type: "integer" },
            imagem_acervo: { type: "string" },
            funcao: { type: "string", enum: ["capa", "conteudo", "cta"] },
            blocos: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["papel", "texto"],
                properties: {
                  papel: { type: "string", enum: ["headline", "subtitulo", "apoio", "numero", "cta", "selo"] },
                  texto: { type: "string" },
                },
              },
            },
            layout: {
              type: "object",
              additionalProperties: false,
              required: ["zona_texto", "alinhamento", "imagem", "ponto_focal", "fundo", "tratamento", "cor_fundo", "cor_texto", "cor_destaque"],
              properties: {
                zona_texto: { type: "string", enum: ZONAS_TEXTO },
                alinhamento: { type: "string", enum: ["esquerda", "centro", "direita"] },
                imagem: { type: "string" },
                ponto_focal: { type: "string" },
                fundo: { type: "string" },
                tratamento: { type: "string" },
                cor_fundo: { type: "string" },
                cor_texto: { type: "string" },
                cor_destaque: { type: "string" },
              },
            },
            evitar: { type: "string" },
          },
        },
      },
    },
  },
};

const INSTRUCOES_DIRECAO = `COMO ENTREGAR A DIREÇÃO (regras técnicas do estúdio)

Um gerador de imagem desenha cada lâmina INTEIRA numa imagem só, texto incluído. O estúdio monta o prompt final em código a partir do que você devolver, já com a área útil, as margens do grid, os tamanhos de letra, a paleta e as fontes da marca. Por isso você decide só o essencial, com precisão:

- conceito: a ideia visual do conjunto em até 3 frases.
- fio_visual: o que se repete em TODAS as lâminas para o carrossel ser uma série só, em 2 a 5 frases concretas: a protagonista (quem é, idade aproximada, cabelo, roupa) ou o objeto protagonista, o cenário (lugar, cores, objetos fixos), a luz (hora, direção, temperatura), o tratamento de foto e o SISTEMA GRÁFICO da capa que as outras lâminas repetem (linhas e fios, formas, cantos, textura, caixa e peso da headline, onde fica o destaque). Se as artes já publicadas da marca têm uma protagonista e um cenário, siga os mesmos.
- carrossel_infinito: siga \`item.carrossel_infinito_pedido\` quando vier (a equipe decidiu no começo). Verdadeiro: o conjunto é UMA cena panorâmica que atravessa as lâminas (o fundo de uma continua na outra); escreva cada layout.imagem como o trecho seguinte da mesma cena, da esquerda para a direita.
- cards: uma entrada por lâmina, na ordem do roteiro. Post único tem um card só. Quantidade pelo conteúdo: o mínimo que conta a história inteira, em geral 4 a 6 lâminas; 7 ou mais só quando o conteúdo pede (lista longa, passo a passo). Menos lâminas custa menos. Se \`item.quantidade_de_laminas_pedida\` vier, use exatamente essa quantidade.
  - funcao: capa, conteudo ou cta (o último card de carrossel é cta).
  - blocos: o texto da lâmina dividido por papel, na ordem de leitura: headline (a frase dominante, curta, quebrada por sentido com \\n), subtitulo, apoio, numero (quando um número é o protagonista), cta, selo. No máximo 3 níveis de hierarquia. Texto exatamente como vai aparecer, com acentos, sem travessão.
  - layout.zona_texto: onde fica o bloco de texto (topo-esquerda, topo-centro, centro-esquerda, centro, base-esquerda, base-centro, base-direita, coluna-esquerda, coluna-direita). Varie entre as lâminas do miolo; mantenha o mesmo eixo de alinhamento no carrossel.
  - layout.alinhamento: esquerda na maioria dos casos; centro só em peça curta e simétrica de propósito.
  - layout.imagem: a imagem concreta (foto real do nicho, objeto, cenário, recorte), com enquadramento e luz.
  - layout.ponto_focal: o que domina a lâmina e onde fica.
  - layout.fundo: o que ocupa o fundo e como o texto ganha área calma.
  - layout.tratamento: técnica de composição da base de conhecimento aplicada nesta lâmina (planos, recorte, escala, espaço negativo).
  - layout.cor_fundo, cor_texto, cor_destaque: hex da paleta da marca (string vazia se não houver paleta).
  - evitar: o que não pode acontecer nesta lâmina (repetição de lâmina anterior, elemento genérico, cor fora da paleta).
  - imagem_acervo: o id de uma foto REAL do cliente em \`acervo\` que serve de base para esta lâmina (ambiente, antes e depois, equipe, produto), ou string vazia. A foto é usada como está, sem ser refeita: escolha só quando ela combina com o texto e tem área calma para o texto na zona escolhida. Nunca a mesma foto em duas lâminas. Prefira foto real a imagem inventada sempre que houver uma boa.

NARRATIVA E CONTINUIDADE (obrigatório)
- Carrossel é uma história só, nunca frases picotadas: a capa abre uma tensão, cada lâmina avança um passo e prepara a seguinte (conectivos, continuidade de sentido), o final resolve e chama para a ação.
- Série contínua com variação: a mesma protagonista, o mesmo cenário, a mesma luz e a mesma paleta do começo ao fim (o fio_visual), como fotos de um mesmo ensaio. Em cada lâmina varie só a pose, o gesto, o plano e o enquadramento (de costas, de frente, pensativa, sorrindo, detalhe das mãos); nunca a mesma pose em duas lâminas seguidas e nunca trocar de pessoa, de cenário ou de clima no meio.
- A capa (de carrossel ou de post estático) existe para PARAR A ROLAGEM: gancho de até 7 palavras que gera curiosidade ou identificação, a maior headline do conjunto em peso black com a palavra-chave na cor de destaque, e um elemento visual forte e inesperado (escala, recorte ousado, rosto ou olhar, gesto em ação), sempre na mesma luz, cenário e paleta da série. Nunca escureça a imagem para criar destaque, e nunca ponha fundo da mesma cor da logo. Zona da capa pela foto: esquerda quando o sujeito está à direita; topo-centro ou centro quando o sujeito está no centro ou embaixo.
- Nunca escreva o nome da marca no texto das lâminas; a marca aparece pela logo oficial, que o gerador DESENHA junto com a arte na capa e no fechamento (vale sobre qualquer regra anterior de logo aplicada por código): pense o lugar dela na composição (junto do bloco de texto, no mesmo eixo, ou onde o ponto focal pedir), num tamanho que se lê de longe, e nunca peça caixa, cartão ou fundo branco para ela.
- Formato: \`item.formato_da_arte\` diz o quadro (4:5, 3:4, 1:1 ou 9:16); pense a composição nele (no 9:16 o texto fica longe dos 14% de cima e dos 20% de baixo; no 1:1 a capa perde as laterais na grade do perfil).
- As regras da marca aprendidas com este cliente (no fim do sistema, quando houver) valem acima da sua preferência: aplique sem que peçam de novo.
- Se \`pedido_da_equipe\` vier preenchido, refaça a direção atendendo o pedido e mantenha o que ele não manda mudar da \`direcao_atual\`.
- Se \`item.campanha\` vier, o conteúdo é de uma campanha: siga o tema visual, as cores de apoio, os elementos e o tom da campanha, sempre dentro da marca; o fio_visual inclui o tema da campanha. O briefing (produto em foco, oferta, mensagem central) guia a escolha das imagens; as fotos em \`item.campanha.imagens_da_campanha\` também estão no \`acervo\`.
- Se o plano indicar foto para a lâmina (\`item.campanha.pecas_do_plano\`, pela ordem da lâmina), use imagem_acervo = esse id nessa lâmina (com uso "elemento", descreva em layout.imagem o produto da foto na cena). No carrossel contínuo deixe imagem_acervo vazio: a cena é o panorama.

Seja específico e curto: cada campo em uma ou duas frases.`;

type ModoDirecao = "diretor" | "roteiro";

function cardsDoDiretor(
  bruto: unknown,
  postUnico: boolean,
  marca: MarcaParaDirecao,
  conceito: string,
  infinito: boolean,
  levaLogoFn: (ordem: number, total: number) => boolean,
  acervoValido: Set<string> = new Set(),
  fioVisual: string | null = null,
): CardDirecao[] {
  const lista = (Array.isArray(bruto) ? bruto : []) as Record<string, any>[];
  const base = lista
    .filter((c) => c && Array.isArray(c.blocos) && c.blocos.some((b: any) => texto(b?.texto)))
    .sort((a, b) => num(a.ordem) - num(b.ordem))
    .slice(0, postUnico ? 1 : MAX_CARDS);
  const total = base.length;
  const fotosUsadas = new Set<string>();
  const cards = base.map((c, i) => {
    const ordem = i + 1;
    const funcao = ordem === 1 ? "capa" : ordem === total && total > 1 ? "cta" : (c.funcao === "cta" ? "cta" : "conteudo");
    const blocos = (c.blocos as any[])
      .map((b) => ({ papel: b?.papel, texto: texto(b?.texto, 600) }))
      .filter((b) => b.texto) as BlocoTexto[];
    const layout = normalizarLayout(c.layout, funcao, ordem, total);
    const card: CardDirecao = {
      ordem,
      funcao,
      texto_exato: blocos.map((b) => b.texto).join("\n"),
      blocos,
      layout,
      evitar: texto(c.evitar, 600),
      composicao: resumoDaComposicao(layout),
      ilustracao: layout.imagem,
      prompt_imagem: "",
    };
    // Foto real do acervo: só id conhecido e nunca a mesma foto em duas lâminas.
    const foto = texto(c.imagem_acervo, 64);
    if (foto && acervoValido.has(foto) && !fotosUsadas.has(foto)) {
      fotosUsadas.add(foto);
      card.imagens_ids = [foto];
    }
    return card;
  });
  for (const card of cards) {
    card.prompt_imagem = promptDaLamina(card, marca, {
      total,
      carrosselInfinito: infinito && total > 1,
      levaLogo: levaLogoFn(card.ordem, total),
      conceito,
      anteriores: imagensAnteriores(cards, card.ordem),
      fioVisual,
    });
  }
  return cards;
}

/** O que as lâminas anteriores já mostram, para a lâmina atual não repetir. */
function imagensAnteriores(cards: CardDirecao[], ordem: number): string[] {
  return cards
    .filter((c) => c.ordem < ordem)
    .map((c) => texto(c.layout?.imagem || c.ilustracao, 160))
    .filter(Boolean)
    .slice(-4);
}

/**
 * Criativo de anúncio: a direção já vem pronta da mesa-ads (diretor com o
 * conhecimento de ads), então preparar não chama o diretor nem lê a agenda
 * (o trabalho 'ads' em geral não tem task_id). Devolve o trabalho como está.
 */
async function prepararAnuncio(ch: Chamador, t: Trabalho, corpo: Record<string, unknown>) {
  await garantirAcesso(ch, t.client_id);
  if (!t.direcao.cards.length) {
    throw new ErroEstudio(409, "anuncio_sem_direcao", "Este criativo ainda não tem direção. Produza os criativos pela Mesa Ads.");
  }
  return json({
    trabalho: t,
    custo_usd: 0,
    saldo_usd: null,
    reserva_usada: null,
    modo: "existente",
    aviso: texto(corpo.instrucao, 2000)
      ? "A direção do criativo de anúncio vem da Mesa Ads e não foi refeita. Para mudar a peça, use o ajuste do card."
      : null,
  });
}

async function preparar(ch: Chamador, corpo: Record<string, unknown>) {
  // Trabalho de anúncio: usa a direção existente (não quebra o fluxo do post abaixo).
  if (corpo.trabalho_id) {
    const alvo = await lerTrabalho(texto(corpo.trabalho_id, 64));
    if (ehAds(alvo)) return await prepararAnuncio(ch, alvo, corpo);
  }
  const item = await lerItemDaAgenda(texto(corpo.task_id, 64));
  await garantirAcesso(ch, item.clientId);
  const clientId = item.clientId;
  if (FORMATOS_FORA_DO_ESTUDIO.has(item.tarefa.delivery_type)) {
    throw new ErroEstudio(400, "formato_fora_do_estudio", "O estúdio faz carrossel e post estático. Este item é de outro formato.", {
      formato: item.tarefa.delivery_type,
    });
  }

  const qualidade = QUALIDADES.includes(corpo.qualidade as Qualidade) ? corpo.qualidade as Qualidade : QUALIDADE_PADRAO;
  const modeloImagem = corpo.modelo_imagem_id
    ? await carregarModelo(texto(corpo.modelo_imagem_id, 120), "imagem")
    : await modeloDoPapel("imagem");

  const db = servico();
  // Conversa com o diretor: com instrução e trabalho, a direção do mesmo
  // trabalho é refeita a partir do pedido (as versões geradas ficam).
  const instrucao = texto(corpo.instrucao, 2000);
  let existente: Trabalho | null = null;
  if (corpo.trabalho_id) {
    existente = await lerTrabalho(texto(corpo.trabalho_id, 64));
    if (existente.client_id !== clientId || existente.task_id !== item.tarefa.id) {
      throw new ErroEstudio(409, "trabalho_de_outro_item", "Este trabalho não é deste item da agenda.");
    }
    if (estaEntregue(existente)) {
      throw erroTrabalhoEntregue();
    }
  }

  // O que o cliente já tem entra sozinho (pastas de referência, artes aprovadas
  // e fotos reais para o acervo), em paralelo com a leitura do kit.
  // Marca do item (ex.: Acerbi ou CME) pelo projeto da tarefa; cliente sem marca segue igual.
  const alvoDaMarca: AlvoDaMarca = { task_id: item.tarefa.id, marca_id: corpo.marca_id };
  const [, , kit, fontes, marcaDoItem] = await Promise.all([
    sincronizarReferencias(db, clientId).catch(() => null),
    sincronizarAcervo(db, clientId).catch(() => null),
    lerKit(clientId, alvoDaMarca),
    lerFontes(clientId, alvoDaMarca),
    marcaDe(clientId, alvoDaMarca),
  ]);
  const marca = await marcaDoCliente(clientId, kit, fontes, alvoDaMarca);

  const postUnico = FORMATOS_POST_UNICO.has(item.tarefa.delivery_type);
  // Contínuo decidido no começo: o pedido da tela vale; senão o que o trabalho já tinha; senão o do estrategista.
  const pedidoInfinito = typeof corpo.carrossel_infinito === "boolean"
    ? corpo.carrossel_infinito
    : existente
      ? existente.direcao.carrossel_infinito === true
      : item.itemProposta && typeof item.itemProposta.carrossel_infinito === "boolean"
        ? item.itemProposta.carrossel_infinito as boolean
        : null;
  const levaLogoFn = (ordem: number, total: number) => ordem === 1 || ordem === total;
  const campanha = await lerCampanha(clientId, item.itemProposta?.campanha_id);
  // Plano de imagens da campanha para este conteúdo (pelo tema_id do item) e as fotos dela no acervo.
  const plano = await planoDaCampanhaNoItem(clientId, campanha, item.itemProposta?.tema_id);
  // Formato do post (4:5, 3:4, 1:1 ou 9:16): o pedido da tela; senão o que o trabalho já tinha; senão 4:5.
  const formatoPedido = FORMATOS_DO_POST.indexOf(corpo.formato as FormatoDoPost) >= 0 ? corpo.formato as FormatoDoPost : null;
  const formato: FormatoDoPost = formatoPedido ?? formatoDoPost(existente?.direcao.formato);
  const laminasPedidas = Number.isInteger(Number(corpo.laminas)) && Number(corpo.laminas) >= 1 && Number(corpo.laminas) <= 10
    ? Number(corpo.laminas)
    : null;
  // Modo roteiro: o roteiro do calendário vira direção sem IA (custo zero).
  const roteiro = Array.isArray(item.itemProposta?.cards) ? item.itemProposta!.cards as Record<string, unknown>[] : [];
  const modoPedido: ModoDirecao = corpo.modo === "roteiro" && !instrucao ? "roteiro" : "diretor";
  // Montar do roteiro é grátis: sem roteiro, avisa em vez de chamar o diretor (pago) calado.
  if (modoPedido === "roteiro" && !roteiro.length) {
    throw new ErroEstudio(409, "sem_roteiro", "Este item não tem roteiro do estrategista. Use o diretor de arte para montar a direção.");
  }
  const trabalhoId = existente?.id ?? crypto.randomUUID();
  let direcao: Direcao;
  let custo = 0;
  let usoId: string | null = null;
  let saldo: number | null = null;
  let reserva: string | null = null;

  if (modoPedido === "roteiro" && roteiro.length) {
    direcao = direcaoDoRoteiro(roteiro as any, marca, {
      postUnico,
      carrosselInfinito: pedidoInfinito ?? false,
      conceito: texto(item.itemProposta?.resumo ?? item.itemProposta?.tema, 600) || null,
      levaLogo: levaLogoFn,
    });
    // Mesma regra do gravar (agente-calendario): a foto do plano de imagens vai para a lâmina.
    if (campanha && plano.pecas.length) aplicarFotosDoPlano(direcao, plano.tema, plano.pecas, plano.fotos);
  } else {
    const modeloDiretor = await modeloDoPapel("diretor_arte");
    const [prompt, memoria, acervo, refsRes, artesRes, preferencias] = await Promise.all([
      promptDoDiretor(clientId),
      memoriaDoDiretor(clientId),
      lerAcervo(clientId, 40).then((lista) => {
        // As fotos da campanha entram no acervo que o diretor vê: senão a
        // checagem de fotos conhecidas recusava o id que o plano indicou.
        const junto = lista.slice();
        for (const f of plano.fotos.values()) if (!junto.some((a) => a.id === f.id)) junto.push(f);
        return junto;
      }),
      filtrarReferenciasDaMarca(
        db.from("cliente_referencias")
          .select("id, origem, papel, leitura, tags")
          .eq("client_id", clientId)
          .eq("ativa", true)
          .not("leitura", "is", null),
        marcaDoItem,
      )
        .order("criado_em", { ascending: false })
        .limit(12),
      db.from("files")
        .select("file_name, file_type, description, caption, created_at")
        .eq("client_id", clientId)
        .eq("folder", "materiais")
        .is("parent_file_id", null)
        .is("archived_at", null)
        .order("created_at", { ascending: false })
        .limit(15),
      // Frente H: regras aprendidas (cérebro) e dossiê atual do cliente, numa leitura só.
      cerebroEDossieDoDiretor(clientId).catch(() => ({ texto: "", usouCerebro: false })),
    ]);
    const contexto = {
      item: {
        titulo: item.tarefa.title,
        formato: item.tarefa.delivery_type,
        post_unico: postUnico,
        data: item.tarefa.due_date,
        roteiro_e_contexto: texto(item.tarefa.description, 4000),
        objetivo_do_post: item.post?.objective ?? null,
        legenda_prevista: texto(item.post?.default_caption, 1500) || null,
        detalhe_do_estrategista: item.itemProposta ?? null,
        carrossel_infinito_pedido: pedidoInfinito,
        formato_da_arte: QUADRO_DO_POST[formato].rotulo,
        // Escolhida na tela antes da direção; nula = o diretor decide pelo conteúdo.
        quantidade_de_laminas_pedida: laminasPedidas,
        campanha: campanha
          ? {
            nome: campanha.nome,
            conceito: campanha.conceito,
            identidade: campanha.identidade,
            briefing: campanha.briefing && Object.keys(campanha.briefing).length ? campanha.briefing : null,
            imagens_da_campanha: imagensDaCampanha(campanha)
              .filter((i) => plano.fotos.has(i.imagem_id))
              .map((i) => ({ id: i.imagem_id, nome: texto(plano.fotos.get(i.imagem_id)!.nome, 120), papel: ROTULO_DO_PAPEL_NA_CAMPANHA[i.papel] ?? i.papel, nota: i.nota || null })),
            // Fotos que o plano de imagens da campanha indicou para as lâminas deste conteúdo.
            pecas_do_plano: plano.pecas.map((p) => ({ ordem: p.ordem, imagem_acervo: p.imagem_id, uso: p.uso, por_que: p.por_que || null })),
          }
          : null,
      },
      marca: {
        nome: marca.nomeCliente,
        paleta: marca.paleta,
        estilo: marca.estilo,
        regras: marca.regras,
        fontes: marca.fontes,
        tipografia_citada: marca.tipografiaCitada,
        tom_de_voz: marca.tomDeVoz,
        tem_logo_oficial: marca.temLogo,
      },
      referencias: ((refsRes.data as { papel: string; leitura: string; tags: string[] }[] | null) ?? [])
        .map((r) => ({ papel: r.papel === "identidade" ? "arte publicada da marca" : "técnica", tecnica: texto(r.leitura, 600), tags: r.tags })),
      artes_anteriores: ((artesRes.data as Record<string, unknown>[] | null) ?? []).map((a) => ({
        nome: texto(a.file_name, 120),
        descricao: texto(a.description, 200) || null,
      })),
      // Com o cérebro no sistema, a lista crua da memória não se repete aqui.
      memoria_do_diretor: preferencias.usouCerebro ? undefined : memoria,
      // Fotos reais do cliente: o diretor escolhe por id (imagem_acervo) e a foto entra como está.
      acervo: acervo.map((a) => ({ id: a.id, nome: texto(a.nome, 80), pasta: a.pasta, categoria: a.categoria, descricao: texto(a.descricao, 240) || null })),
      pedido_da_equipe: instrucao || null,
      direcao_atual: existente
        ? {
          conceito: existente.direcao.conceito,
          cards: existente.direcao.cards.map((c) => ({ ordem: c.ordem, funcao: c.funcao, texto_exato: c.texto_exato, imagem: c.layout?.imagem ?? c.ilustracao })),
        }
        : null,
    };
    const r = await chamarTexto({
      clientId,
      tarefa: "estudio",
      agente: "diretor_arte",
      modeloId: modeloDiretor.id,
      raciocinio: raciocinioPara(modeloDiretor, ["low", "medium"]),
      // Base de conhecimento primeiro: prefixo fixo, reaproveitado pelo cache do provedor.
      // As regras aprendidas com o cliente vêm por último: o prefixo fixo continua no cache do provedor.
      // Frente H: base de marketing do diretor (com teto) logo depois da base de design; cérebro e dossiê no fim.
      sistema: [CONHECIMENTO_DIRETOR, CONHECIMENTO_DA_DIRECAO, prompt, INSTRUCOES_DIRECAO, preferencias.texto].filter(Boolean).join("\n\n"),
      mensagens: [{ papel: "usuario", conteudo: `Escreva a direção de arte deste item. Contexto em JSON:\n${JSON.stringify(contexto)}` }],
      esquemaJson: ESQUEMA_DIRECAO,
      maxTokensSaida: 12_000,
      // Chamada longa (diretor com a base de conhecimento inteira): 5 min antes de desistir.
      timeoutMs: 300_000,
      referencia: { tipo: "estudio_trabalho", id: trabalhoId },
      criadoPor: ch.userId,
    });
    const bruto = (r.json ?? {}) as Record<string, any>;
    const conceito = texto(bruto.conceito, 1200);
    const fioVisual = texto(bruto.fio_visual, 800) || null;
    const infinito = pedidoInfinito ?? !!bruto.carrossel_infinito;
    const cards = cardsDoDiretor(bruto.cards, postUnico, marca, conceito, infinito, levaLogoFn, new Set(acervo.map((a) => a.id)), fioVisual);
    if (!cards.length) {
      throw new ErroEstudio(502, "direcao_vazia", "O diretor de arte não devolveu nenhum card utilizável. Tente de novo.", { uso_id: r.usoId });
    }
    direcao = { conceito, fio_visual: fioVisual, carrossel_infinito: cards.length > 1 && infinito, cards, origem: "diretor" };
    custo = r.custoUsd;
    usoId = r.usoId;
    saldo = r.saldoUsd;
    reserva = r.reservaUsada ?? null;
  }

  // Formato escolhido na tela (o 4:5 fica sem o campo, como sempre foi).
  if (formato !== "feed_4x5") direcao.formato = formato;
  if (campanha) {
    direcao.campanha_id = campanha.id;
    if (!direcao.referencias_ids?.length && campanha.referencias_ids?.length) direcao.referencias_ids = campanha.referencias_ids.slice(0, 4);
  }

  if (existente) {
    // Mantém o que a equipe escolheu na tela (referências do conjunto e de cada
    // lâmina, fotos do acervo) quando a direção nova não troca.
    const anterior = existente.direcao;
    const cardsMesclados = direcao.cards.map((c) => {
      const velho = anterior.cards.find((v) => v.ordem === c.ordem);
      return {
        ...c,
        imagens_ids: c.imagens_ids?.length ? c.imagens_ids : velho?.imagens_ids,
        referencias_ids: velho?.referencias_ids,
        fotos_livres: velho?.fotos_livres,
      };
    });
    const atualizado = await mutarTrabalho(existente.id, (x) => ({
      direcao: {
        ...direcao,
        cards: cardsMesclados,
        referencias_ids: anterior.referencias_ids,
        pedido: instrucao || null,
        // Direção nova, cena nova: o fundo contínuo nasce de novo (e um trecho atrasado não volta).
        panorama: panoramaApagado(anterior.panorama),
      },
      custo_usd: arred(num(x.custo_usd) + custo),
    }));
    return json({ trabalho: atualizado, custo_usd: custo, saldo_usd: saldo, reserva_usada: reserva, modo: direcao.origem ?? modoPedido });
  }

  const { data: criado, error } = await db
    .from("estudio_trabalhos")
    .insert({
      id: trabalhoId,
      client_id: clientId,
      task_id: item.tarefa.id,
      status: "dirigido",
      direcao,
      modelo_imagem_id: modeloImagem.id,
      qualidade,
      cards: [],
      custo_usd: arred(custo),
      criado_por: ch.userId,
    })
    .select("*")
    .single();
  if (error) throw new ErroEstudio(503, "gravacao_falhou", "A direção foi escrita, mas o trabalho não foi gravado.", { uso_id: usoId });

  return json({ trabalho: criado, custo_usd: custo, saldo_usd: saldo, reserva_usada: reserva, modo: direcao.origem ?? modoPedido });
}

// ------------------------------------------------------ referencias (Jev)

const NIVEIS_REFERENCIA = [
  "Não serve: a técnica da referência (composição, hierarquia, clima) é de outro tipo de peça e não ajuda esta lâmina.",
  "Serve pouco: só um detalhe isolado da referência (uma cor, uma textura, um estilo de letra) ajuda esta lâmina.",
  "Serve em parte: a composição ou a hierarquia da referência ajuda a resolver esta lâmina, com adaptação.",
  "Serve muito: composição, hierarquia e tratamento visual da referência resolvem diretamente o que esta lâmina pede.",
];
const NOTA_MINIMA_REFERENCIA = 1.5;

/**
 * Ate 4 referencias mais proximas da lamina. Um Score por referencia, todas na
 * mesma chamada ao Jev (rodam em paralelo); o codigo ordena e corta.
 */
type LinhaGlobal = { id: string; storage_path: string; url_origem: string | null; leitura: string; tags: string[] };
const CAMPOS_REF_CLIENTE = "id, client_id, origem, papel, workspace_node_id, url_origem, storage_path, file_id, leitura, tags";
const CAMPOS_REF_GLOBAL = "id, origem, storage_path, url_origem, leitura, tags";

const globalComoReferencia = (g: LinhaGlobal, clientId: string): Referencia => ({
  id: `g:${g.id}`,
  client_id: clientId,
  origem: "global",
  papel: "global",
  workspace_node_id: null,
  url_origem: g.url_origem,
  storage_path: g.storage_path,
  file_id: null,
  leitura: g.leitura,
  tags: g.tags,
});

/** Referências escolhidas na tela: ids do cliente e do banco global (prefixo g:). */
async function referenciasPorId(clientId: string, ids: string[]): Promise<Referencia[]> {
  const doCliente = ids.filter((i) => UUID.test(i));
  const globais = ids.filter((i) => i.startsWith("g:")).map((i) => i.slice(2)).filter((i) => UUID.test(i));
  const [c, g] = await Promise.all([
    doCliente.length
      ? servico().from("cliente_referencias").select(CAMPOS_REF_CLIENTE).eq("client_id", clientId).in("id", doCliente)
      : Promise.resolve({ data: [] }),
    globais.length ? servico().from("referencias_globais").select(CAMPOS_REF_GLOBAL).in("id", globais) : Promise.resolve({ data: [] }),
  ]);
  const todas = [
    ...((c.data as Referencia[] | null) ?? []),
    ...((g.data as LinhaGlobal[] | null) ?? []).map((x) => globalComoReferencia(x, clientId)),
  ];
  // Na ordem em que a equipe escolheu.
  return ids.map((i) => todas.find((r) => r.id === i || r.id === `g:${i}`)).filter(Boolean) as Referencia[];
}

const PALAVRAS_VAZIAS = new Set(["para", "como", "sobre", "entre", "mesma", "mesmo", "cada", "texto", "lamina", "lâmina", "imagem", "fundo", "com", "sem", "uma", "que", "dos", "das", "nos", "nas", "pela", "pelo"]);

/**
 * Pré-filtro do banco global (mais de 1.300 leituras) pela busca de texto do
 * Postgres: palavras da composição da lâmina, ligadas por "or". Sem acerto,
 * as mais recentes.
 */
async function globaisParaALamina(card: CardDirecao, limite = 20): Promise<LinhaGlobal[]> {
  const fonte = [card.layout?.tratamento, card.layout?.fundo, card.composicao, card.funcao === "capa" ? "capa tipografia-grande contraste" : ""].join(" ");
  const termos = [...new Set(
    fonte.toLowerCase().normalize("NFC").split(/[^a-zà-ÿ0-9-]+/).filter((p) => p.length >= 5 && !PALAVRAS_VAZIAS.has(p)),
  )].slice(0, 12);
  const base = () =>
    servico().from("referencias_globais").select(CAMPOS_REF_GLOBAL).eq("ativa", true).not("leitura", "is", null).not("storage_path", "is", null);
  if (termos.length) {
    const { data } = await base().textSearch("leitura", termos.join(" or "), { type: "websearch", config: "portuguese" }).limit(limite);
    const achadas = (data as LinhaGlobal[] | null) ?? [];
    if (achadas.length >= 4) return achadas;
  }
  const { data } = await base().order("criado_em", { ascending: false }).limit(limite);
  return (data as LinhaGlobal[] | null) ?? [];
}

/**
 * Referências escolhidas pela equipe na tela (as da lâmina valem no lugar das
 * do conjunto), na ordem da escolha, no máximo 2: a 1ª dá a estrutura e a 2ª
 * o tratamento (modo replicar referência). Vazio quando ninguém escolheu.
 */
async function referenciasDaEquipe(t: Trabalho, card: CardDirecao): Promise<Referencia[]> {
  const ids = (card.referencias_ids?.length ? card.referencias_ids : t.direcao.referencias_ids) ?? [];
  if (!ids.length) return [];
  return (await referenciasPorId(t.client_id, ids)).slice(0, MAX_REFERENCIAS);
}

async function escolherReferencias(
  t: Trabalho,
  card: CardDirecao,
  kit: Kit,
  criadoPor: string,
): Promise<{ refs: Referencia[]; jev: string }> {
  // Escolha da equipe na tela (da lâmina ou do conjunto) vale sem passar pelo Jev.
  const daEquipe = await referenciasDaEquipe(t, card);
  if (daEquipe.length) return { refs: daEquipe, jev: "escolha_da_equipe" };
  // Só as referências da marca do item (Acerbi ou CME); cliente sem marca vê todas.
  const marcaDoTrabalho = await marcaDe(t.client_id, t);
  // Em destaque (marcadas pela equipe): entram sempre, antes das outras.
  const { data: emDestaque } = await filtrarReferenciasDaMarca(
    servico()
      .from("cliente_referencias")
      .select(CAMPOS_REF_CLIENTE)
      .eq("client_id", t.client_id)
      .eq("ativa", true)
      .eq("destaque", true),
    marcaDoTrabalho,
  )
    .order("criado_em", { ascending: false })
    .limit(MAX_REFERENCIAS);
  const destaques = (emDestaque as Referencia[] | null) ?? [];
  if (destaques.length >= MAX_REFERENCIAS) return { refs: destaques.slice(0, MAX_REFERENCIAS), jev: "destaque" };
  const comDestaque = (r: { refs: Referencia[]; jev: string }) => {
    if (!destaques.length) return r;
    const resto = r.refs.filter((x) => !destaques.some((d) => d.id === x.id));
    return { refs: [...destaques, ...resto].slice(0, MAX_REFERENCIAS), jev: r.jev === "ok" ? "destaque_e_jev" : r.jev };
  };
  const [doCliente, globais] = await Promise.all([
    filtrarReferenciasDaMarca(
      servico()
        .from("cliente_referencias")
        .select(CAMPOS_REF_CLIENTE)
        .eq("client_id", t.client_id)
        .eq("ativa", true)
        .not("leitura", "is", null),
      marcaDoTrabalho,
    )
      .order("criado_em", { ascending: false })
      .limit(MAX_CANDIDATAS_JEV),
    globaisParaALamina(card),
  ]);
  const candidatas: Referencia[] = [
    ...((doCliente.data as Referencia[] | null) ?? []),
    ...globais.map((g) => globalComoReferencia(g, t.client_id)),
  ];
  if (!candidatas.length) {
    const identidade = await artePublicadaMaisRecente(t.client_id, marcaDoTrabalho);
    return comDestaque({ refs: identidade ? [identidade] : [], jev: "sem_referencias_lidas" });
  }

  const referencias: Record<string, { tipo: string; tecnica: string; tags: string[] }> = {};
  const questions: Record<string, PerguntaJev> = {};
  candidatas.forEach((r, i) => {
    referencias[`r${i}`] = {
      tipo: r.papel === "identidade" ? "arte já publicada pela própria marca" : "referência de técnica",
      tecnica: texto(r.leitura, 700),
      tags: r.tags ?? [],
    };
    questions[`r${i}`] = {
      type: "score",
      instructions: r.papel === "identidade"
        ? `Quão bem a arte descrita em \`referencias.r${i}\` mostra a identidade visual que a lâmina em \`lamina\` precisa seguir (paleta, tipografia, tratamento de foto e clima da marca em \`marca\`)?`
        : `Quão útil é a técnica descrita em \`referencias.r${i}.tecnica\` como referência de composição para executar a lâmina descrita em \`lamina\`? Julgue composição, hierarquia, tipografia e integração entre imagem e texto, não o assunto da foto.`,
      criteria: NIVEIS_REFERENCIA,
    };
  });
  const state = {
    marca: { estilo: kit?.estilo ?? null, regras: kit?.regras ?? null },
    conceito: t.direcao.conceito,
    lamina: { funcao: card.funcao, composicao: card.composicao, ilustracao: card.ilustracao, texto_exato: card.texto_exato },
    referencias,
  };
  try {
    const res = await jevPerguntar({ state, questions });
    await cobrarJev(res, {
      clientId: t.client_id,
      tarefa: "estudio",
      referencia: { tipo: "estudio_trabalho", id: t.id },
      criadoPor,
    });
    const notas = candidatas
      .map((r, i) => ({ r, nota: notaScore(res.answers[`r${i}`]) }))
      .filter((x) => x.nota != null && x.nota >= NOTA_MINIMA_REFERENCIA)
      .sort((a, b) => (b.nota as number) - (a.nota as number));
    // Uma da identidade da marca e uma de técnica (do cliente ou do banco da agência).
    const identidade = notas.find((x) => x.r.papel === "identidade")?.r ?? await artePublicadaMaisRecente(t.client_id, marcaDoTrabalho);
    const tecnica = notas.find((x) => x.r.papel !== "identidade")?.r;
    const escolhidas = [identidade, tecnica].filter(Boolean).slice(0, MAX_REFERENCIAS) as Referencia[];
    return comDestaque({ refs: escolhidas, jev: "ok" });
  } catch (e) {
    // Sem Jev, ao menos a arte publicada mais recente da marca vai junto.
    const identidade = await artePublicadaMaisRecente(t.client_id, marcaDoTrabalho);
    return comDestaque({ refs: identidade ? [identidade] : [], jev: codigoMotor(e) });
  }
}

/**
 * Arte já publicada mais recente da marca (referência de identidade), mesmo
 * ainda sem leitura: a série nova precisa continuar o estilo do que foi ao ar.
 */
async function artePublicadaMaisRecente(clientId: string, marca: MarcaDoCliente | null = null): Promise<Referencia | null> {
  const { data } = await filtrarReferenciasDaMarca(
    servico()
      .from("cliente_referencias")
      .select(CAMPOS_REF_CLIENTE)
      .eq("client_id", clientId)
      .eq("ativa", true)
      .eq("papel", "identidade"),
    marca,
  )
    .order("criado_em", { ascending: false })
    .limit(1);
  return ((data as Referencia[] | null) ?? [])[0] ?? null;
}

// ---------------------------------------------------------- conferencia

const ESQUEMA_LEITURA = {
  nome: "leitura_da_arte",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["texto_lido", "descricao_visual", "logo_presente"],
    properties: {
      texto_lido: { type: "string" },
      descricao_visual: { type: "string" },
      logo_presente: { type: "boolean" },
    },
  },
};

const SISTEMA_LEITURA = `Você é o leitor de artes do estúdio. Olhe a imagem e devolva:
- texto_lido: TODO o texto visível, exatamente como está desenhado, na ordem de leitura, com a grafia, os acentos e a pontuação que aparecem, inclusive erros e letras deformadas. Não corrija nada. Não transcreva o texto que faz parte da logo da marca.
- descricao_visual: em até 6 frases, a paleta observada (cores com hex aproximado), a tipografia (estilo, peso, caixa), a composição, o estilo da imagem e qualquer defeito (letra quebrada, objeto deformado, texto cortado).
- logo_presente: se aparece uma logo de marca na imagem.
Escreva sem travessão.`;

const NIVEIS_IDENTIDADE = [
  "Fora da marca: paleta, tipografia e clima não têm relação com o kit da marca.",
  "Pouco da marca: algum elemento lembra o kit, mas o conjunto parece de outra marca.",
  "Parcial: paleta ou tipografia seguem o kit, mas há desvio visível (cor fora da paleta, estilo diferente ou regra da marca quebrada).",
  "Da marca: paleta, tipografia e estilo seguem o kit, com desvio pequeno.",
  "Totalmente da marca: paleta, tipografia, estilo e regras do kit respeitados, e a lâmina cumpre a direção.",
];

/**
 * Conferencia de uma versao: o leitor transcreve o texto da imagem (modelo de
 * visao do catalogo, papel leitura) e o codigo compara com o texto_exato; o
 * Jev da a nota de identidade a partir da descricao visual. A leitura e feita
 * sobre o recorte 4:5 central (o que vai ao ar); sem a transformacao do
 * Storage, sobre a tela inteira, pedindo ao leitor que ignore as faixas.
 */
async function verificar(ch: Chamador, t: Trabalho, card: CardDirecao, caminho: string, kit: Kit, fontes: Fonte[]) {
  const usos: { usoId: string; custoUsd: number }[] = [];
  const v: Verificacao = { pendente: false, texto_lido: null, ortografia_ok: null, identidade: null };
  const quadro = quadroDoCard(t, card);
  const ads = ehAds(t);
  // Tom do criativo enviado pela Mesa Ads (sobrio, direto, agressivo); inválido ou ausente: sem a pergunta do tom.
  const tomPedido = ads ? tomValido(t.direcao.tom) : null;
  try {
    const recorte = await laminaFinal(caminho, quadro.final);
    v.leitura_no_recorte = recorte.redimensionada;
    const jaNoFormato = !!recorte.largura && !!recorte.altura &&
      Math.abs(recorte.largura / recorte.altura - quadro.final.largura / quadro.final.altura) < 0.01;
    const pedido = recorte.redimensionada
      ? `Leia esta arte (já no recorte final ${quadro.proporcao}).`
      : jaNoFormato
        ? `Leia esta arte (já no formato final ${quadro.proporcao}).`
        : quadro.proporcao === "4:5"
          ? `Leia esta arte. A tela tem ${recorte.largura ?? 1024} x ${recorte.altura ?? 1536} px e será cortada em 4:5 pelo centro: ignore tudo o que estiver nas faixas de 128 px do topo e da base, e leia só a área central.`
          : `Leia esta arte. A tela tem ${recorte.largura ?? "?"} x ${recorte.altura ?? "?"} px e será cortada em ${quadro.proporcao} pelo centro: leia só o que fica dentro desse recorte central.`;
    const leitor = await modeloDoPapel("leitura");
    const lido = await chamarTexto({
      clientId: t.client_id,
      tarefa: "verificacao",
      agente: "leitor",
      modeloId: leitor.id,
      sistema: SISTEMA_LEITURA,
      mensagens: [{ papel: "usuario", conteudo: pedido, imagens: [{ bytes: recorte.bytes, mime: "image/png", nome: `card-${card.ordem}.png` }] }],
      esquemaJson: ESQUEMA_LEITURA,
      maxTokensSaida: 6_000,
      referencia: { tipo: "estudio_trabalho", id: t.id },
      criadoPor: ch.userId,
    });
    usos.push({ usoId: lido.usoId, custoUsd: lido.custoUsd });
    const l = (lido.json ?? {}) as { texto_lido?: string; descricao_visual?: string; logo_presente?: boolean };
    v.texto_lido = texto(l.texto_lido, 2000);
    v.descricao_visual = texto(l.descricao_visual, 2000) || null;
    v.logo_presente = typeof l.logo_presente === "boolean" ? l.logo_presente : null;
    // Logo só é esperada quando a lâmina leva logo E o cliente tem o arquivo:
    // sem logo cadastrada, "logo faltando" era alarme falso (Mirante Luz, 23/09).
    const esperaLogo = levaLogo(t, card.ordem) && !!(await baixarLogoBruta(t.client_id, kit).catch(() => null));
    v.logo_ok = v.logo_presente == null ? null : !esperaLogo && !v.logo_presente ? null : v.logo_presente === esperaLogo;
    const cmp = compararTexto(card.texto_exato, v.texto_lido);
    v.ortografia_ok = cmp.ortografia_ok;
    v.faltando = cmp.faltando;
    v.sobrando = cmp.sobrando;
  } catch (e) {
    // Saldo, cota e chave voltam como erro da chamada (402/403/503); o resto fica na verificacao.
    if (e instanceof IaMotorErro && STATUS_MOTOR[e.codigo]) throw e;
    v.erro = `leitura: ${codigoMotor(e)}`;
    return { verificacao: v, usos };
  }

  try {
    const questions: Record<string, PerguntaJev> = {
      identidade: {
        type: "score",
        instructions: "Quanto a arte descrita em `arte_gerada` segue a identidade da marca em `kit` e a direção da lâmina em `lamina`?",
        criteria: NIVEIS_IDENTIDADE,
      },
    };
    // Criativo de anúncio: o Jev também julga o risco de política da Meta e a
    // clareza da oferta, com a descrição lida da arte e o texto exato da peça.
    if (ads) {
      questions.politica = {
        type: "score",
        instructions: "Qual o risco de o anúncio descrito em `anuncio` (imagem em `anuncio.descricao_visual`, texto exato em `anuncio.texto_exato` e texto lido na arte em `anuncio.texto_lido`) ser reprovado pelas políticas de anúncio da Meta resumidas em `politicas_meta`? Julgue atributo pessoal, promessa de resultado, antes e depois, elemento que imita a interface, sensacionalismo e discriminação.",
        criteria: NIVEIS_RISCO_POLITICA,
      };
      questions.clareza = {
        type: "score",
        instructions: "Quão clara é a oferta do anúncio descrito em `anuncio` para quem vê a peça por 1 segundo no celular: o que é oferecido, para quem e qual o próximo passo?",
        criteria: NIVEIS_CLAREZA,
      };
      // Pedido da Mesa Ads (25/09, "os criativos estão muito genéricos"): a IMAGEM genérica, como aviso.
      questions.generico = {
        type: "noul",
        instructions: "A IMAGEM do anúncio descrita em `anuncio.descricao_visual` é genérica, do tipo que serviria para qualquer concorrente da categoria em `anuncio.categoria`?",
        criteria: {
          true: "Imagem genérica: cena de banco de imagem ou clichê da categoria (pessoa sorrindo sem contexto, aperto de mão, fachada comum, objeto solto sem uso), sem o produto, o serviço em ação, o lugar, a pessoa ou um detalhe real deste cliente, e sem nada que chame atenção no feed.",
          false: "Imagem específica: mostra o produto, o serviço em ação, o lugar, a pessoa ou um detalhe real deste cliente, ou uma composição que foge do padrão visual da categoria.",
        },
      };
      if (tomPedido) {
        questions.tom = {
          type: "score",
          instructions: "Quanto a peça descrita em `anuncio` (imagem em `anuncio.descricao_visual` e texto lido em `anuncio.texto_lido`) cumpre o tom pedido em `tom_pedido`, pelas regras da arte em `tom_pedido.arte` (contraste, escala da headline, cor de destaque, energia da composição, CTA)?",
          criteria: TONS[tomPedido].niveis_jev,
        };
      }
    }
    const res = await jevPerguntar({
      state: {
        kit: {
          paleta: kit?.paleta ?? [],
          estilo: kit?.estilo ?? null,
          regras: kit?.regras ?? null,
          fontes: fontes.map((f) => ({ nome: f.nome, papel: f.papel })),
        },
        conceito: t.direcao.conceito,
        lamina: { funcao: card.funcao, composicao: card.composicao, texto_exato: card.texto_exato },
        arte_gerada: { descricao_visual: v.descricao_visual, texto_lido: v.texto_lido, logo_presente: v.logo_presente },
        ...(ads
          ? {
            anuncio: {
              formato: quadro.formato,
              descricao_visual: v.descricao_visual,
              texto_exato: card.texto_exato,
              texto_lido: v.texto_lido,
              categoria: texto(t.direcao.conceito, 400) || null,
            },
            politicas_meta: POLITICAS_META,
            ...(tomPedido ? { tom_pedido: { nome: TONS[tomPedido].nome, resumo: TONS[tomPedido].resumo, arte: TONS[tomPedido].arte } } : {}),
          }
          : {}),
      },
      questions,
    });
    const cobrado = await cobrarJev(res, {
      clientId: t.client_id,
      tarefa: "verificacao",
      referencia: { tipo: "estudio_trabalho", id: t.id },
      criadoPor: ch.userId,
    });
    if (cobrado) usos.push(cobrado);
    v.identidade = notaDoJev(res.answers.identidade, NIVEIS_IDENTIDADE);
    if (ads) {
      v.politica = notaDoJev(res.answers.politica, NIVEIS_RISCO_POLITICA);
      v.clareza = notaDoJev(res.answers.clareza, NIVEIS_CLAREZA);
      const p = probabilidadeNoul(res.answers.generico);
      v.generico = { probabilidade: p == null ? null : Math.round(p * 100) / 100, generico: p == null ? null : p >= 0.5 };
      if (tomPedido) v.tom = { ...notaDoJev(res.answers.tom, TONS[tomPedido].niveis_jev), tom: tomPedido } as Verificacao["tom"];
    }
  } catch (e) {
    v.identidade = { erro: codigoMotor(e) };
    if (ads) {
      v.politica = { erro: codigoMotor(e) };
      v.clareza = { erro: codigoMotor(e) };
      v.generico = { erro: codigoMotor(e) };
      if (tomPedido) v.tom = { erro: codigoMotor(e), tom: tomPedido };
    }
  }
  return { verificacao: v, usos };
}

/** Nota do Score do Jev com o nível correspondente da escala. */
function notaDoJev(resposta: Parameters<typeof notaScore>[0], niveis: string[]): NotaJev {
  const nota = notaScore(resposta);
  return {
    nota,
    escala_max: niveis.length - 1,
    nivel: nota == null ? null : niveis[Math.max(0, Math.min(niveis.length - 1, Math.round(nota)))],
    confianca: typeof resposta?.confidence === "number" ? resposta.confidence : null,
  };
}

/**
 * conferir_card { trabalho_id, ordem, versao? }: acao propria, chamada pela
 * tela logo depois de gerar ou ajustar, para cada chamada caber no tempo da
 * funcao. Sem versao, confere a atual. Grava a verificacao naquela versao.
 */
async function conferirCard(ch: Chamador, corpo: Record<string, unknown>) {
  const t = await trabalhoComAcesso(ch, texto(corpo.trabalho_id, 64));
  const ordem = lerOrdem(corpo);
  const card = cardDaDirecao(t, ordem);
  let alvo: VersaoCard | null;
  if (corpo.versao == null || corpo.versao === "") {
    alvo = versaoAtual(t, ordem);
  } else {
    const versao = Number(corpo.versao);
    if (!Number.isInteger(versao) || versao < 1) throw new ErroEstudio(400, "versao_invalida", "Versão do card inválida.");
    alvo = t.cards.find((c) => c.ordem === ordem && c.versao === versao) ?? null;
  }
  if (!alvo) throw new ErroEstudio(404, "versao_inexistente", "Esta versão do card não existe. Gere o card antes de conferir.");
  const [kit, fontes] = await Promise.all([lerKit(t.client_id, t), lerFontes(t.client_id, t)]);
  const conf = await verificar(ch, t, card, alvo.storage_path, kit, fontes);
  const custo = arred(conf.usos.reduce((s, u) => s + u.custoUsd, 0));
  const verificacao: Verificacao = {
    ...conf.verificacao,
    conferido_em: new Date().toISOString(),
    uso_ids: conf.usos.map((u) => u.usoId),
    custo_usd: custo,
  };
  // A conferência já diz o que corrigir antes de mostrar (corrigir_card usa a mesma decisão).
  const autocorrecao = decidirAutocorrecao(verificacao, { ads: ehAds(t), textoExato: card.texto_exato });
  verificacao.autocorrecao = autocorrecao;
  const caminhoAlvo = alvo.storage_path;
  await mutarTrabalho(t.id, (atual) => ({
    cards: atual.cards.map((c) =>
      c.ordem === ordem && c.storage_path === caminhoAlvo
        ? { ...c, verificacao, custo_usd: arred(num(c.custo_usd) + custo), uso_ids: [...(c.uso_ids ?? []), ...(verificacao.uso_ids ?? [])] }
        : c
    ),
    custo_usd: arred(num(atual.custo_usd) + custo),
  }));
  return json({ trabalho_id: t.id, ordem, versao: alvo.versao, verificacao, autocorrecao, custo_usd: custo });
}

// ------------------------------------------------------------- gerar card

const REGRA_TEXTO_NA_ARTE =
  "Arte final completa numa imagem só. Todo o texto é desenhado pela própria arte, integrado à composição, nunca uma caixa de texto solta por cima da imagem.";

/**
 * Regras fixas do render. `comLogo`: "fixa" quando a logo já está na imagem
 * editada e fica como está (ajuste de lâmina contínua). `cenaPronta`: a base é
 * a fatia do panorama; a regra "continue na lâmina vizinha" sai (contradizia
 * a cena fixa).
 */
function regrasDeRender(
  t: Trabalho,
  card: CardDirecao,
  anexos: string[],
  logo: "gerar" | "manter" | false,
  replicar = false,
  cenaPronta = false,
): string {
  // Direção com layout é composta para 4:5; a antiga, sem layout, segue o recorte de 2:3.
  const formatoAntigo = !card.layout;
  // Na geração com layout, o prompt da lâmina já traz as proibições (anatomia, moldura, travessão);
  // aqui elas entram só na direção antiga e na edição (ajuste e correção), que não levam aquele prompt.
  const completo = formatoAntigo || logo === "manter";
  return [
    "REGRAS FINAIS (valem sobre tudo acima)",
    `- ${REGRA_TEXTO_NA_ARTE}`,
    `- Escreva exatamente este texto, com a mesma grafia e acentuação, e nenhum outro texto: "${card.texto_exato}"`,
    formatoAntigo ? "- Tela 1024 x 1536. A peça final é vertical 4:5 (1080 x 1350), cortada pelo centro." : "",
    formatoAntigo
      ? "- ÁREA ÚTIL: todo o texto, a logo e os elementos importantes ficam DENTRO da área central de 1024 x 1280 (de y = 128 a y = 1408), com margem de respiro de pelo menos 48 px até o limite dela. Nenhuma letra pode encostar ou entrar nas faixas de 128 px do topo e da base."
      : "",
    formatoAntigo ? "- As faixas de 128 px no topo e na base recebem só continuação do fundo: serão cortadas." : "",
    logo === "manter"
      ? "- Logo: a que já está na imagem 1 fica exatamente como está, no mesmo lugar e no mesmo tamanho. Só se o pedido mexer nela, ou se ela estiver faltando, desenhe a logo oficial anexada, idêntica ao anexo e grande o bastante para ser lida de longe."
      : logo === "gerar"
      ? "- Logo: a oficial anexada, idêntica ao anexo, no tamanho do bloco LOGO (nunca pequenininha), sem caixa atrás. Uma logo só."
      : "- Sem logo nesta lâmina: não desenhe logo, símbolo nem marca.",
    t.direcao.carrossel_infinito && !ehAds(t) && !cenaPronta
      ? "- Carrossel infinito: o que chega à borda continua na lâmina vizinha com a mesma posição, escala, perspectiva e luz."
      : "",
    anexos.length
      ? `- Imagens anexadas, na ordem (use cada uma só para o que a legenda dela diz; nada delas entra na arte além disso): ${anexos.join("; ")}.`
      : "",
    completo
      ? "- Nenhum texto, pessoa, objeto, logo ou marca além do pedido. Pessoas com anatomia correta e natural: cabeça alinhada ao corpo e virada para o mesmo lado do tronco, pescoço natural, mãos com cinco dedos e segurando os objetos de um jeito possível, braços e pernas inteiros e na proporção certa."
      : "",
    completo
      ? replicar
        ? "- Sem moldura, borda, contorno ou cantos arredondados em volta da arte; o fundo vai até a borda da tela. Faixas e formas gráficas como as da referência, nas cores da marca."
        : "- Sem moldura, borda, contorno ou cantos arredondados em volta da arte; o fundo vai até a borda da tela. Faixas e formas gráficas só as do layout da marca."
      : "",
    completo ? "- Sem travessão no texto." : "",
  ].filter(Boolean).join("\n");
}

/**
 * Guarda a versao sem sobrescrever nada: se outra chamada ja usou o numero,
 * sobe para o proximo. O numero do caminho e o numero gravado no card.
 */
async function salvarNaMesa(t: Trabalho, ordem: number, versaoInicial: number, png: Uint8Array, mime: string) {
  for (let versao = versaoInicial; versao < versaoInicial + 5; versao++) {
    const caminho = `${t.client_id}/estudio/${t.id}/card-${ordem}-v${versao}.png`;
    const { error } = await servico().storage.from("mesa").upload(caminho, new Blob([new Uint8Array(png)], { type: mime }), {
      contentType: mime,
      upsert: false,
    });
    if (!error) return { caminho, versao };
    const status = String((error as { statusCode?: string | number }).statusCode ?? "");
    if (status !== "409" && !/exist|duplicate/i.test(error.message)) break;
  }
  throw new ErroEstudio(503, "armazenamento_falhou", "A lâmina foi gerada, mas não foi possível guardá-la.");
}

async function urlAssinada(caminho: string): Promise<string | null> {
  const { data } = await servico().storage.from("mesa").createSignedUrl(caminho, 3600);
  return data?.signedUrl ?? null;
}

function lerOrdem(corpo: Record<string, unknown>): number {
  // Uma lamina por chamada: lista de ordens e recusada.
  if (Array.isArray(corpo.ordem)) throw new ErroEstudio(400, "uma_lamina_por_chamada", "Gere uma lâmina por chamada.");
  const ordem = Number(corpo.ordem);
  if (!Number.isInteger(ordem) || ordem < 1) throw new ErroEstudio(400, "ordem_invalida", "Ordem do card inválida.");
  return ordem;
}

/**
 * Trabalho entregue não muda (as artes já estão em Arquivos). Antes a
 * mensagem mandava "preparar um novo" e a tela engolia o erro: fotos e
 * pastas não abriam e as referências não salvavam, sem dizer por quê (dono,
 * 25/09). Agora o erro diz o caminho: Reabrir para corrigir (ação reabrir).
 */
function erroTrabalhoEntregue(): ErroEstudio {
  return new ErroEstudio(
    409,
    "trabalho_entregue",
    "Este trabalho já foi entregue. Use \"Reabrir para corrigir\": as lâminas voltam para edição, a entrega anterior fica no histórico e a próxima entrega vira arquivo novo.",
    { pode_reabrir: true },
  );
}

/** Entregue (em Arquivos) ou já agendado na Agenda: só muda depois de reabrir. */
const estaEntregue = (t: Pick<Trabalho, "status"> & { entrega_status?: string | null }) =>
  t.status === "entregue" || t.entrega_status === "agendado";

function garantirEditavel(t: Trabalho) {
  if (estaEntregue(t)) {
    throw erroTrabalhoEntregue();
  }
  if (!t.modelo_imagem_id) throw new ErroEstudio(409, "trabalho_sem_modelo", "O trabalho não tem modelo de imagem definido.");
}

/**
 * Área do texto e da logo da lâmina, em fração do quadro (máscara da foto
 * real). No criativo de anúncio, as caixas seguem o formato e a zona segura
 * dele (a mesma conta do prompt).
 */
function areasDeDesenho(card: CardDirecao, total: number, comLogo: boolean, quadro?: Pick<QuadroDoCard, "formato"> & { post?: FormatoDoPost | null }, aspecto: number | null = null): Area[] {
  const formato = quadro?.formato ?? null;
  const post = quadro?.post ?? null;
  const capa = card.funcao === "capa" || card.ordem === 1;
  const zona = card.layout?.zona_texto ?? "base-esquerda";
  const pct = (c: { x0: number; x1: number; y0: number; y1: number }): Area => ({ x0: c.x0 / 100, y0: c.y0 / 100, x1: c.x1 / 100, y1: c.y1 / 100 });
  const areas = [ampliar(pct(caixaDaZona(zona, capa, total > 1, formato, post)), 0.04)];
  if (comLogo) areas.push(ampliar(pct(caixaDaLogo(zona, capa, formato, post, aspecto)), 0.02));
  return areas;
}

/**
 * Área reservada para a logo (fração do quadro) quando a máscara limita o que
 * o gerador desenha (foto real fixa e contínuo): a logo é desenhada pelo
 * gerador dentro dela, no tamanho da logo escolhida (tamanhoDaLogo).
 */
function caixaDaLogoNoQuadro(zona: ZonaTexto, capa: boolean, quadro: Pick<QuadroDoCard, "formato" | "post">, aspecto: number | null = null): Area {
  const c = caixaDaLogo(zona, capa, quadro.formato, quadro.post, aspecto);
  return { x0: c.x0 / 100, y0: c.y0 / 100, x1: c.x1 / 100, y1: c.y1 / 100 };
}

/** Cor dominante do fundo pelo kit (papel fundo ou primária; senão a primeira da paleta), para escolher a logo que contrasta. */
function corDoFundoDoKit(kit: Kit): string | null {
  const p = (kit as { paleta?: unknown } | null)?.paleta;
  const lista = Array.isArray(p) ? (p as { hex?: string; papel?: string }[]) : [];
  const papel = (x: { papel?: string }) => String(x?.papel || "").toLowerCase();
  const achada = lista.find((x) => /fundo|prim[aá]ria|principal/.test(papel(x)) && /^#[0-9a-f]{6}$/i.test(String(x?.hex || "").trim()));
  if (achada) return String(achada.hex).trim();
  const primeira = hexDaPaleta(kit)[0];
  return primeira || null;
}

/** No contínuo, tudo menos 7% de cada lateral (cerca de 76 px): as bordas ficam iguais ao panorama. */
const INTERIOR_DA_LAMINA: Area = { x0: 0.07, y0: 0, x1: 0.93, y1: 1 };

/** Texto sobre foto real ou sobre o panorama: integrado à cena, nunca numa caixa. */
const SEM_CAIXA_ATRAS_DO_TEXTO =
  "Escreva o texto e a logo DIRETAMENTE sobre a imagem, integrados à cena: sem caixa, cartão, painel, faixa, retângulo, moldura, véu, desfoque ou área de cor atrás das letras. Ignore qualquer indicação de fundo liso ou de área de cor para o texto: aqui o fundo é a própria foto. O contraste vem da cor e do peso das letras (escolha na paleta a cor que mais contrasta com aquela parte da foto) e, se preciso, de uma sombra suave nas próprias letras. Não escureça a foto.";

/** O gerador aproximava e deslocava a foto; o código alinha, mas o certo é não mexer. */
const NAO_REENQUADRAR =
  "Não reenquadre a imagem 1: mesmo corte, mesmo zoom, mesma posição e tamanho de cada pessoa e objeto, nada aproximado, afastado, girado ou espelhado. A saída tem exatamente o mesmo enquadramento da imagem 1.";

const descreverArea = (a: Area) =>
  `de ${Math.round(a.x0 * 100)}% a ${Math.round(a.x1 * 100)}% da largura e de ${Math.round(a.y0 * 100)}% a ${Math.round(a.y1 * 100)}% da altura`;

// ---------------------------------------------- fundo do carrossel contínuo

/**
 * A lâmina usa o fundo panorâmico: contínuo ligado, mais de uma lâmina,
 * modelo que faz o panorama (GPT Image direto ou pelo OpenRouter: até 24/09
 * a regra exigia provedor openai e o padrão pelo OpenRouter desligava o
 * contínuo sem aviso) e layout definido. Nunca no criativo de anúncio.
 */
function usaPanorama(t: Trabalho, card: CardDirecao, modelo: Pick<ModeloIa, "provedor" | "modelo_api">): boolean {
  if (ehAds(t)) return false;
  // O panorama é fatiado em lâminas 4:5 (1088 x 1360): nos outros formatos as lâminas saem uma a uma, em série.
  if (formatoDoPost(t.direcao.formato) !== "feed_4x5") return false;
  return !!t.direcao.carrossel_infinito && totalCards(t) > 1 && modeloFazPanorama(modelo) && !!card.layout;
}

/** Sinal interno: outra chamada terminou o trecho enquanto esta ia travar. */
class TrechoJaPronto extends Error {}

/** Solta a trava do trecho (só a desta chamada) e soma o que já foi cobrado. */
async function soltarTrava(id: string, inicio: number, token: string, custo: number) {
  try {
    await mutarTrabalho(id, (x) => {
      const p = x.direcao.panorama;
      return {
        ...(p ? { direcao: { ...x.direcao, panorama: { ...p, em_andamento: semATrava(p.em_andamento, inicio, token) } } } : {}),
        custo_usd: arred(num(x.custo_usd) + custo),
      };
    });
  } catch {
    // A trava vence sozinha em ESPERA_DO_FUNDO_MS.
  }
}

/**
 * Garante o fundo contínuo da lâmina: gera o trecho do panorama que falta (só
 * a cena, sem texto) e guarda as fatias em direcao.panorama.fundos. Um trecho
 * por chamada: faltando o trecho anterior (a lâmina de ligação), ele é feito
 * primeiro e a resposta sai pendente (a tela chama de novo). Regras de 25/09:
 * - trava por trecho (em_andamento, 6 min): outro pedido do mesmo trecho
 *   recebe 409 fundo_em_andamento em vez de pagar de novo;
 * - a geração do fundo é lida no começo: se o fundo foi apagado ou refeito
 *   enquanto o trecho era gerado, o trecho é descartado (não ressuscita);
 * - só o mesmo modelo atende (mesmoModelo) e a proporção do que voltou é
 *   conferida antes de fatiar: nada de corte com zoom;
 * - com lâmina de ligação, o trecho novo é alinhado a ela antes de fatiar e
 *   recusado quando a cena mudou.
 */
async function garantirFundoContinuo(
  ch: Chamador,
  t: Trabalho,
  ordem: number,
  kit: Kit,
): Promise<{ t: Trabalho; caminho: string; custo: number; pendente?: boolean }> {
  const pronto = t.direcao.panorama?.fundos?.[String(ordem)];
  if (pronto) return { t, caminho: pronto, custo: 0 };
  const total = totalCards(t);
  const { inicio, fim } = trechoDaLamina(ordem, total);
  // O trecho seguinte precisa do fundo da lâmina de ligação (do trecho anterior).
  // Um panorama por chamada (cada um leva até ~2 min): o anterior sai primeiro e
  // a tela chama de novo (preparar_fundo devolve pendente).
  if (inicio > 1 && !t.direcao.panorama?.fundos?.[String(inicio)]) {
    const antes = await garantirFundoContinuo(ch, t, inicio, kit);
    return { ...antes, caminho: "", pendente: true };
  }

  // Trava do trecho, na geração atual do fundo.
  const geracao = geracaoDoPanorama(t.direcao.panorama);
  const token = crypto.randomUUID();
  let atual: Trabalho;
  try {
    atual = await mutarTrabalho(t.id, (x) => {
      const p = x.direcao.panorama ?? null;
      if (!x.direcao.carrossel_infinito || geracaoDoPanorama(p) !== geracao) {
        throw new ErroEstudio(409, "fundo_mudou", "O fundo contínuo foi refeito ou desligado agora há pouco. Gere de novo.");
      }
      if (p?.fundos?.[String(ordem)]) throw new TrechoJaPronto();
      const trava = travaDoTrecho(p, inicio);
      if (trava) {
        throw new ErroEstudio(409, "fundo_em_andamento", "O fundo contínuo deste trecho já está sendo feito por outra geração. Espere terminar: ele não é cobrado duas vezes.", {
          desde: trava.desde,
        });
      }
      return {
        direcao: {
          ...x.direcao,
          panorama: {
            fundos: p?.fundos ?? {},
            geracao,
            em_andamento: { ...(p?.em_andamento ?? {}), [String(inicio)]: { token, desde: new Date().toISOString() } },
          },
        },
      };
    });
  } catch (e) {
    if (!(e instanceof TrechoJaPronto)) throw e;
    const relido = await lerTrabalho(t.id);
    return { t: relido, caminho: relido.direcao.panorama?.fundos?.[String(ordem)] ?? "", custo: 0 };
  }

  let custo = 0;
  try {
    const ligacao = inicio > 1 ? atual.direcao.panorama?.fundos?.[String(inicio)] ?? null : null;
    const k = fim - inicio + 1;
    const cards = atual.direcao.cards.filter((c) => c.ordem >= inicio && c.ordem <= fim).sort((a, b) => a.ordem - b.ordem);
    const cores = (kit as { paleta?: unknown } | null)?.paleta;
    const paleta = (Array.isArray(cores) ? (cores as { nome?: string; hex?: string }[]) : [])
      .filter((p) => p && p.hex).map((p) => `${p.nome || "cor"} ${p.hex}`).join(", ");
    const quadros = cards.map((c, i) => {
      const zona = c.layout?.zona_texto ?? "base-esquerda";
      const cena = texto(c.layout?.imagem || c.ilustracao || c.composicao, 500);
      return `- trecho ${i + 1} de ${k} (da esquerda para a direita): o que aparece nesta parte da MESMA cena: ${cena}. Deixe calma e uniforme a zona "${zona}" desta parte (ali entra o texto depois).`;
    }).join("\n");
    const divisas: number[] = [];
    for (let i = 1; i < k; i++) divisas.push(LARGURA_LAMINA * i);
    const prompt = [
      `UMA ÚNICA FOTOGRAFIA PANORÂMICA de ${LARGURA_LAMINA * k} x ${ALTURA_LAMINA} px: um só lugar, visto por uma só câmera, na mesma altura e no mesmo ângulo, com o mesmo chão, a mesma parede, o mesmo horizonte e a mesma luz de ponta a ponta. NÃO é um tríptico nem uma colagem: nada de quadros separados, cenas diferentes, mudança de ângulo (por exemplo, de frente para vista de cima), bordas ou divisões. Depois ela será cortada em ${k} partes verticais 4:5 de ${LARGURA_LAMINA} px (cortes em x = ${divisas.join(" e ")} px) para um carrossel do Instagram, então a cena atravessa esses cortes sem emenda: móveis, objetos e o chão continuam de uma parte para a outra; nenhum rosto fica cortado num corte. É só o fundo: nenhum texto, letra, número ou logo.`,
      ligacao
        ? `A imagem 1 já traz o PRIMEIRO quadro pronto (os ${LARGURA_LAMINA} px da esquerda): repita esse quadro exatamente como está, no mesmo lugar, mesma escala e mesmo enquadramento, e continue a cena a partir da borda direita dele.`
        : "",
      atual.direcao.fio_visual ? `Fio visual da série (igual em todos os quadros): ${texto(atual.direcao.fio_visual, 800)}` : "",
      atual.direcao.estilo_pedido ? `Estilo pedido pela equipe: ${texto(atual.direcao.estilo_pedido, 600)}. Sem escurecer a cena.` : "",
      `Conceito: ${texto(atual.direcao.conceito, 600)}`,
      `O que aparece ao longo da cena, da esquerda para a direita (tudo no mesmo ambiente; adapte o que for de outro ambiente para caber neste mesmo lugar):\n${quadros}`,
      paleta ? `Paleta da marca para luz, objetos e ambiente: ${paleta}.` : "",
      "Fotografia realista de campanha, luz natural coerente, alta qualidade.",
    ].filter(Boolean).join("\n\n");

    const qualidade = (QUALIDADES.includes(atual.qualidade as Qualidade) ? atual.qualidade : QUALIDADE_PADRAO) as Qualidade;
    const bytesDaLigacao = ligacao ? await baixar("mesa", ligacao) : null;
    const tela = bytesDaLigacao ? await telaDoTrecho(k, bytesDaLigacao) : null;
    const img = await chamarImagem({
      clientId: atual.client_id,
      modeloId: atual.modelo_imagem_id!,
      prompt,
      referencias: [],
      qualidade,
      tamanho: tamanhoDoTrecho(k),
      tamanhoFixo: true,
      // Reserva de rota só no mesmo modelo: outro gerador devolveria outra proporção.
      mesmoModelo: true,
      ...(tela ? { editar: { bytes: tela.tela, mascara: tela.mascara } } : {}),
      referencia: { tipo: "estudio_trabalho", id: atual.id },
      criadoPor: ch.userId,
      tarefa: "estudio",
      agente: "gerador_imagem",
    });
    custo = img.custoUsd;
    // Dimensões reais do que voltou (não o tamanho pedido) e alinhamento à ligação.
    const trecho = await fatiarTrecho(img.png, k, bytesDaLigacao);
    if (!trecho.proporcaoOk) {
      throw new ErroEstudio(502, "panorama_fora_do_formato", `O gerador devolveu o fundo contínuo em ${trecho.largura} x ${trecho.altura}, fora da proporção de ${k} lâminas lado a lado. Nada foi cortado com zoom: gere de novo.`, {
        custo_usd: custo,
      });
    }
    if (trecho.cenaMudada) {
      throw new ErroEstudio(409, "emenda_recusada", `O trecho novo do fundo contínuo não continuou a cena da lâmina ${inicio} e foi recusado para não quebrar a emenda. Gere de novo ou refaça o fundo no Conjunto.`, {
        custo_usd: custo,
        erro_da_emenda: trecho.erro == null ? null : Math.round(trecho.erro * 10) / 10,
      });
    }
    const fatias = trecho.fatias;
    // A lâmina de ligação fica com o fundo que já tinha; a seguinte ganha a correção de tom na emenda.
    if (ligacao && bytesDaLigacao && fatias.length > 1) fatias[1] = await corrigirEmenda(bytesDaLigacao, fatias[1]);
    const novos: Record<string, string> = {};
    const carimbo = Date.now();
    for (let i = 0; i < k; i++) {
      const o = inicio + i;
      if (ligacao && i === 0) continue;
      const caminho = `${atual.client_id}/estudio/${atual.id}/fundo-${o}-${carimbo}.png`;
      const { error } = await servico().storage.from("mesa").upload(caminho, new Blob([new Uint8Array(fatias[i])], { type: "image/png" }), { contentType: "image/png", upsert: false });
      if (error) throw new ErroEstudio(503, "armazenamento_falhou", "O fundo contínuo foi gerado, mas não foi possível guardá-lo.", { custo_usd: custo });
      novos[String(o)] = caminho;
    }
    let descartado = false;
    const gravado = await mutarTrabalho(atual.id, (x) => {
      const p = x.direcao.panorama ?? null;
      // Fundo apagado ou refeito enquanto este trecho era gerado: só o custo entra.
      descartado = !x.direcao.carrossel_infinito || geracaoDoPanorama(p) !== geracao;
      if (descartado) return { custo_usd: arred(num(x.custo_usd) + img.custoUsd) };
      return {
        // Fatia já gravada vence: outra lâmina pode já estar usando.
        direcao: {
          ...x.direcao,
          panorama: { fundos: { ...novos, ...(x.direcao.panorama?.fundos ?? {}) }, geracao, em_andamento: semATrava(p?.em_andamento, inicio, token) },
        },
        custo_usd: arred(num(x.custo_usd) + img.custoUsd),
      };
    });
    custo = 0;
    if (descartado) {
      await servico().storage.from("mesa").remove(Object.values(novos)).catch(() => null);
      throw new ErroEstudio(409, "fundo_descartado", "O fundo contínuo foi refeito ou desligado enquanto este trecho era gerado. O trecho foi descartado para não voltar o fundo antigo.", {
        custo_usd: img.custoUsd,
      });
    }
    const caminho = gravado.direcao.panorama?.fundos?.[String(ordem)];
    if (!caminho) throw new ErroEstudio(500, "fundo_ausente", "O fundo contínuo desta lâmina não foi gerado. Tente de novo.", { custo_usd: img.custoUsd });
    return { t: gravado, caminho, custo: img.custoUsd };
  } catch (e) {
    // Falhou depois de travar: solta a trava (e soma o que já foi cobrado, se foi).
    await soltarTrava(t.id, inicio, token, custo);
    throw e;
  }
}

/**
 * preparar_fundo { trabalho_id, ordem }: gera o trecho do panorama da lâmina
 * antes do gerar_card (que nunca gera panorama: trecho e lâmina na mesma
 * chamada passavam de 400 s). Devolve pendente quando fez o trecho anterior
 * primeiro; a tela repete até não haver pendência. Modelo que não faz o
 * panorama: fundo null e `continuo_indisponivel` (a lâmina sai no modo normal).
 */
async function prepararFundo(ch: Chamador, corpo: Record<string, unknown>) {
  const t = await trabalhoComAcesso(ch, texto(corpo.trabalho_id, 64));
  const ordem = lerOrdem(corpo);
  garantirEditavel(t);
  const card = cardDaDirecao(t, ordem);
  const modelo = await carregarModelo(t.modelo_imagem_id!, "imagem");
  const temFotoPropria = !!card.imagens_ids?.length || !!(card.fotos_livres ?? []).length;
  const continuoPedido = !ehAds(t) && !!t.direcao.carrossel_infinito && totalCards(t) > 1;
  if (!usaPanorama(t, card, modelo) || temFotoPropria) {
    return json({ trabalho: t, custo_usd: 0, fundo: null, pendente: false, continuo_indisponivel: continuoPedido && !modeloFazPanorama(modelo) });
  }
  const r = await garantirFundoContinuo(ch, t, ordem, await lerKit(t.client_id, t));
  return json({ trabalho: r.t, custo_usd: r.custo, fundo: r.pendente ? null : r.caminho, pendente: !!r.pendente });
}

/**
 * gerar_card { trabalho_id, ordem }: uma lâmina por chamada, em um destes modos:
 * - replicar referência (pedido do dono em 25/09: "escolhi a referência e a
 *   imagem e gerou nada a ver"): a equipe escolheu 1 ou 2 referências (da
 *   lâmina ou do conjunto). O gerador recompõe a lâmina seguindo de perto o
 *   layout da referência (a 1ª dá a estrutura, a 2ª o tratamento), com as
 *   cores e fontes da marca, o texto exato e a foto do cliente (se houver)
 *   como o assunto, idêntico. A foto é recomposta, não devolvida: a versão
 *   grava modo replicar_referencia e foto_recomposta para a tela avisar
 *   "confira o rosto". Não vale no carrossel contínuo (panorama);
 * - foto real: a lâmina tem imagens_ids; a foto do acervo é a base, o gerador
 *   só desenha a área do texto e a da logo, e o código devolve a foto original
 *   em todo o resto (a foto não é refeita);
 * - carrossel contínuo (panorama): a base é a fatia do fundo panorâmico já
 *   pronta (preparar_fundo; gerar_card nunca gera o trecho e devolve 409
 *   fundo_pendente sem ele). O gerador escreve o texto e desenha a logo; o
 *   código cola só o que mudou nas áreas do texto e da logo sobre a fatia
 *   intacta (sem reenquadrar: a emenda fica). A versão grava o fundo usado (fundo, fundo_geracao) para a tela
 *   mostrar "fora do fundo" quando o panorama muda depois. Só no 4:5;
 * - recorte (pedido do dono em 25/09: "tirou o fundo, escolhe a foto, ele já
 *   entra na lâmina real"): a lâmina tem uma pessoa ou um produto sem fundo
 *   (fotos_livres elemento com recortada). O código põe o recorte do lado
 *   oposto ao texto numa tela da cor da marca; o gerador edita a tela e faz o
 *   entorno (cenário, sombra de contato, texto e logo) com o miolo do recorte
 *   protegido; o código cola o recorte original de novo por cima: pessoa e
 *   produto idênticos, sem caixa e sem nada por cima deles;
 * - normal: prompt composto pela direção, com a capa como guia da série.
 *
 * Logo (dono, 26/09: "tem que puxar a logo colocada na arte, não vir fixa em
 * todo canto"; "a logo do cliente não pode ficar pequenininha, mesmo com
 * referência"): em TODOS os modos a logo é desenhada pelo gerador junto com a
 * arte, a partir da logo do kit escolhida (lâmina, conjunto ou a que contrasta
 * com o fundo), limpa do fundo falso e aparada. O tamanho mínimo vem de
 * tamanhoDaLogo (forma da logo e quadro); o lugar vem da composição (layout ou
 * referência). Onde a máscara limita o desenho (foto real fixa e contínuo), a
 * área da logo abre junto com a do texto e nunca é coberta pela devolução da
 * foto nem pela colagem na fatia. O código não cola logo em nenhum modo.
 *
 * Anexos (26/09, "muitas alucinações nas demais lâminas"): candidatos com
 * prioridade e teto por tipo (anexosDaLamina, no máximo 6 imagens com a
 * editada): fotos do cliente, referências da equipe, logo, capa, uma fonte,
 * uma arte da marca (só na capa) e o selo. A lâmina anterior saiu (a capa
 * guia a série) e a referência de técnica automática também.
 *
 * Série (dono, 25/09: "os cards têm que reconhecer como está indo e combinar,
 * sem precisar ativar o infinito"): da lâmina 2 em diante a versão atual da
 * capa vai anexada como guia do sistema visual (grid, linhas, formas,
 * tipografia, paleta, tratamento) e o prompt leva blocoDaSerie; o final fecha
 * voltando à capa. Não vale no modo replicar (lá o layout é da referência).
 * As regras aprendidas com o cliente (cérebro do cliente) entram em todos.
 */
async function gerarCard(ch: Chamador, corpo: Record<string, unknown>) {
  const t = await trabalhoComAcesso(ch, texto(corpo.trabalho_id, 64));
  const ordem = lerOrdem(corpo);
  garantirEditavel(t);
  const card = cardDaDirecao(t, ordem);
  const total = totalCards(t);
  // Tamanho da lâmina: o formato do post (4:5 por padrão); no criativo de anúncio, o do formato do card.
  const quadro = quadroDoCard(t, card);
  const ads = ehAds(t);
  // Carrossel contínuo não existe no anúncio.
  const infinito = !ads && !!t.direcao.carrossel_infinito;
  const [kit, fontes, modeloImagem, preferencias] = await Promise.all([
    lerKit(t.client_id, t),
    lerFontes(t.client_id, t),
    carregarModelo(t.modelo_imagem_id!, "imagem"),
    preferenciasDaArte(t.client_id).catch(() => ""),
  ]);
  const qualidade = (QUALIDADES.includes(t.qualidade as Qualidade) ? t.qualidade : QUALIDADE_PADRAO) as Qualidade;

  // Foto real escolhida para a lâmina (pelo diretor ou pela equipe), do acervo
  // ou trazida pela equipe (colada ou solta) como fundo.
  const [foto] = card.imagens_ids?.length ? await imagensDoAcervo(t.client_id, card.imagens_ids) : [];
  const livres = card.fotos_livres ?? [];
  const fundoLivre = foto ? undefined : livres.find((f) => f.papel === "fundo");
  const elementos = livres.filter((f) => f.papel === "elemento").slice(0, 2);
  // Referências escolhidas pela equipe: com elas a lâmina replica o layout da referência (fora do contínuo).
  const refsDaEquipe = await referenciasDaEquipe(t, card);
  let baseFoto: Uint8Array | null = foto ? await fotoRealNaLamina(foto, quadro.largura, quadro.altura) : null;
  if (!baseFoto && fundoLivre) {
    try {
      // Reduzida pelo Storage antes do recorte: foto da Mesa Foto pode ser 4K (limite de CPU).
      baseFoto = await fotoDoBucketNaLamina("mesa", fundoLivre.caminho, quadro.largura, quadro.altura);
    } catch {
      throw new ErroEstudio(409, "foto_sumiu", "A foto de fundo desta lâmina não foi encontrada. Escolha outra na ferramenta Fotos.");
    }
  }
  let resumoDoFundo = foto ? resumoDaFoto(foto) : fundoLivre ? texto(fundoLivre.nota || "foto real trazida pela equipe", 300) : null;
  // Carrossel contínuo: o fundo é a fatia do panorama; o gerador desenha o texto e a logo por cima.
  // gerar_card nunca gera o trecho (passava de 400 s junto com a lâmina): sem fatia, 409 e a tela prepara o fundo.
  const panorama = !baseFoto && !elementos.length && usaPanorama(t, card, modeloImagem);
  let fundoUsado: string | null = null;
  if (panorama) {
    const f = t.direcao.panorama?.fundos?.[String(ordem)];
    if (!f) {
      throw new ErroEstudio(409, "fundo_pendente", "O fundo contínuo desta lâmina ainda não foi feito. Prepare o fundo e gere de novo (a tela faz isso sozinha).");
    }
    fundoUsado = f;
    baseFoto = await baixar("mesa", f);
    resumoDoFundo = "fundo panorâmico contínuo do carrossel, já pronto: o texto entra por cima, sem mudar a cena";
  }

  // Replicar a referência escolhida: só fora do contínuo (o panorama manda na cena).
  const replicar = refsDaEquipe.length > 0 && !panorama;
  // Foto real fixa (sem panorama, sem elementos soltos e sem referência a
  // replicar): a foto não é refeita, o gerador só escreve o texto e a logo.
  const fotoFixa = !!baseFoto && !panorama && !elementos.length && !replicar;
  // Pessoa ou produto sem fundo: posto pelo código (modo recorte), fora do replicar e sem foto de fundo.
  const recortado = !baseFoto && !panorama && !replicar ? elementos.find((e) => e.recortada) ?? null : null;
  const elementosSoltos = recortado ? elementos.filter((e) => e !== recortado) : elementos;
  // A cena já está decidida (foto fixa ou fatia do panorama): só o texto e a logo mudam.
  const cenaFixa = panorama || fotoFixa;
  // Máscara com a área da logo (foto fixa e contínuo): a logo é desenhada pelo gerador DENTRO dela.
  const mascaraComLogo = cenaFixa;

  // Modo recorte: o recorte vai do lado oposto ao texto (a zona do texto acompanha).
  type RecorteNaLamina = Awaited<ReturnType<typeof recorteNaCaixa>> & { caixa: Area };
  let recorteNaLamina: RecorteNaLamina | null = null;
  let cardDoPrompt: CardDirecao = card;
  if (recortado) {
    const layoutAtual = normalizarLayout(card.layout, card.funcao, card.ordem, total);
    const lugar = lugarDoRecorte(layoutAtual.zona_texto);
    try {
      const r = await recorteNaCaixa(await baixar("mesa", recortado.caminho), quadro.largura, quadro.altura, lugar.caixa);
      recorteNaLamina = { ...r, caixa: lugar.caixa };
    } catch {
      throw new ErroEstudio(409, "recorte_sumiu", "A foto sem fundo desta lâmina não foi encontrada ou não abriu. Tire o fundo de novo na ferramenta Fotos.");
    }
    const como = recortado.nota ? texto(recortado.nota, 200) : "pessoa ou produto do cliente";
    cardDoPrompt = {
      ...card,
      layout: {
        ...layoutAtual,
        zona_texto: lugar.zona,
        imagem: `o recorte REAL (${como}) já posto na imagem 1, ${descreverArea(recorteNaLamina.posicao)}, com cenário simples em volta, na paleta da marca`,
        ponto_focal: "a pessoa ou o produto recortado, com a headline no espaço livre ao lado ou acima",
      },
    };
  }

  // Logo: SEMPRE desenhada pelo gerador junto com a arte (dono, 26/09), a
  // escolhida no kit ou a que contrasta com o fundo. O código não cola logo.
  const leva = levaLogo(t, ordem);
  const zonaDoTexto = normalizarLayout(cardDoPrompt.layout, card.funcao, card.ordem, total).zona_texto;
  const capaDaSerie = card.funcao === "capa" || ordem === 1;
  const logosKit = leva ? await logosDoKit(t.client_id, kit, escolhaDaLamina(t, card)) : [];
  let valorDoFundo: number | null = null;
  if (logosKit.length > 1) {
    if (baseFoto && mascaraComLogo) {
      // Foto ou fatia: a claridade de verdade da área onde a logo vai.
      const aprox = caixaDaLogo(zonaDoTexto, capaDaSerie, quadro.formato, quadro.post, null);
      valorDoFundo = await valorMedioNaArea(baseFoto, { x0: aprox.x0 / 100, y0: aprox.y0 / 100, x1: aprox.x1 / 100, y1: aprox.y1 / 100 }).catch(() => null);
    } else {
      const layoutAgora = normalizarLayout(cardDoPrompt.layout, card.funcao, card.ordem, total);
      valorDoFundo = valorDaCor(layoutAgora.cor_fundo || corDoFundoDoKit(kit));
    }
  }
  const logo = escolherLogoDoKit(logosKit, t, card, valorDoFundo);
  const comLogo = !!logo;
  const aspectoDaLogo = logo && logo.medida ? logo.medida.aspecto ?? null : null;
  // Área da logo (fração do quadro) quando a máscara limita o desenho.
  const caixaDaLogoAqui = mascaraComLogo && comLogo ? caixaDaLogoNoQuadro(zonaDoTexto, capaDaSerie, quadro, aspectoDaLogo) : null;

  // Anexos (26/09): cada tipo com teto e no máximo MAX_ANEXOS_DA_LAMINA
  // imagens por chamada, contando a imagem editada. Da lâmina 2 em diante a
  // CAPA é o guia da série (a lâmina anterior saiu: puxava pose e cena de
  // novo); referência automática só na capa e só uma.
  type Candidato = { tipo: TipoDoAnexo; rotulo: string; carregar: () => Promise<ImagemEntrada>; ref?: Referencia; fotoReplicar?: { descricao: string; papel: "fundo" | "elemento" } };
  const candidatos: Candidato[] = [];
  if (replicar && baseFoto !== null) {
    const b = baseFoto;
    candidatos.push({
      tipo: "foto_cliente",
      rotulo: "FOTO REAL do cliente: o assunto desta lâmina (pessoa ou produto idêntico)",
      carregar: async () => ({ bytes: b, mime: "image/png", nome: "foto-do-cliente.png" }),
      fotoReplicar: { descricao: resumoDoFundo || "foto real do cliente", papel: "fundo" },
    });
  }
  for (const el of replicar ? elementos : elementosSoltos) {
    const como = el.nota ? texto(el.nota, 200) : "pessoa ou objeto real";
    candidatos.push({
      tipo: "elemento",
      rotulo: replicar
        ? `${el.recortada ? "RECORTE sem fundo" : "FOTO REAL"} trazido pela equipe (${como}): entra idêntico${el.recortada ? ", integrado à cena com a mesma luz e sombra de contato, sem caixa, contorno ou halo em volta" : ""}`
        : el.recortada
        ? `RECORTE sem fundo trazido pela equipe (${como}): coloque esta pessoa ou objeto na lâmina exatamente como é, integrado à cena com a mesma luz e uma sombra de contato suave, sem caixa, moldura, contorno branco ou halo, e sem texto por cima dele`
        : `foto REAL trazida pela equipe (${como}): coloque esta pessoa ou objeto na lâmina exatamente como é, mesmo rosto, feições, cabelo, roupa e proporções, integrado à luz da cena; não redesenhe nem troque por outra pessoa`,
      carregar: () => (replicar ? imagemReduzida("mesa", el.caminho, "elemento-real") : baixarImagem("mesa", el.caminho, "elemento-real")),
      fotoReplicar: replicar ? { descricao: como, papel: "elemento" } : undefined,
    });
  }
  if (replicar) {
    refsDaEquipe.forEach((ref, i) => {
      candidatos.push({
        tipo: "referencia_equipe",
        rotulo: i === 0 ? "REFERÊNCIA 1 escolhida pela equipe (layout a replicar)" : "REFERÊNCIA 2 escolhida pela equipe (tratamento a replicar)",
        carregar: () => imagemDaReferencia(ref),
        ref,
      });
    });
  }
  if (logo) candidatos.push({ tipo: "logo", rotulo: LEGENDA_DA_LOGO, carregar: async () => logo.imagem });
  // Conteúdo de campanha: selo do tema na capa e no fechamento, e a identidade da campanha no prompt.
  const campanha = t.direcao.campanha_id ? await lerCampanha(t.client_id, t.direcao.campanha_id) : null;
  const capa = ordem > 1 && total > 1 ? versaoAtual(t, 1) : null;
  if (capa) {
    candidatos.push({
      tipo: "capa",
      rotulo: replicar
        ? "CAPA desta série (lâmina 1): mantenha só a mesma paleta, fontes e acabamento; o layout desta lâmina vem da referência escolhida, não da capa"
        : cenaFixa
        ? "CAPA desta série (lâmina 1), guia do sistema do texto: siga só a tipografia, as cores do texto e os elementos gráficos do texto dela; NÃO copie a cena nem a foto dela, a cena desta lâmina é a imagem 1"
        : `CAPA desta série (lâmina 1), já aprovada: é o guia do sistema visual; repita o grid, as margens, as linhas, formas e elementos gráficos (mesmo traço, espessura e cor), a tipografia, a paleta, o tratamento e a mesma protagonista, cenário e luz; não copie o texto nem a composição exata dela${ordem === total ? "; o final fecha voltando a ela" : ""}`,
      carregar: async () => ({ bytes: await baixar("mesa", capa.storage_path), mime: "image/png", nome: "card-1-capa.png" }),
    });
  }
  const [amostra] = await amostrasDasFontes(fontes);
  if (amostra) candidatos.push({ tipo: "fonte", rotulo: `amostra da fonte ${amostra.fonte.nome} (${amostra.fonte.papel}): siga o desenho destas letras`, carregar: async () => amostra.imagem });
  // Sem escolha da equipe e sem foto: só a capa busca UMA arte de referência da marca (Jev); o miolo segue a capa.
  const escolhida = replicar
    ? { refs: refsDaEquipe, jev: "escolha_da_equipe" }
    : baseFoto
    ? { refs: [] as Referencia[], jev: "foto_real" }
    : ordem > 1 && capa
    ? { refs: [] as Referencia[], jev: "serie_pela_capa" }
    : await escolherReferencias(t, card, kit, ch.userId);
  if (!replicar) {
    for (const ref of escolhida.refs.slice(0, 1)) {
      candidatos.push({
        tipo: "identidade",
        rotulo: ref.papel === "identidade"
          ? "arte já publicada da própria marca: siga a mesma identidade (cores, tipografia, tratamento de foto); não copie o layout, o texto nem as pessoas dela"
          : "referência de composição: absorva só a hierarquia e o equilíbrio; não copie o texto, as pessoas, os objetos nem a marca dela",
        carregar: () => imagemDaReferencia(ref),
        ref,
      });
    }
  }
  if (campanha?.selo_path && leva) {
    const selo = campanha.selo_path;
    candidatos.push({
      tipo: "selo",
      rotulo: `selo da campanha "${campanha.nome}": use como está, pequeno, perto do título ou no canto oposto à logo, sem redesenhar`,
      carregar: () => baixarImagem("mesa", selo, "selo-da-campanha"),
    });
  }

  // Imagem editada (foto, fatia ou tela do recorte) é a imagem 1 e empurra os anexos.
  const temBase = (!!baseFoto && !replicar) || !!recorteNaLamina;
  const deslocamento = temBase ? 1 : 0;
  const imagens: ImagemEntrada[] = [];
  const rotulos: string[] = [];
  const idsReferencias: string[] = [];
  const fotosReplicar: { indice: number; descricao: string; papel: "fundo" | "elemento" }[] = [];
  const refsNoPrompt: { indice: number; leitura: string | null }[] = [];
  let indiceDaLogo: number | null = null;
  let indiceDaCapa: number | null = null;
  const escolhidosDaLamina = anexosDaLamina(candidatos, { base: temBase });
  // Replicar (26/09, "tem que ser quase idêntico à referência"): a referência 1
  // vira a IMAGEM 1, a que o gerador EDITA; assim o layout dela fica e só trocam
  // texto, logo, cores e assunto. Os outros anexos vêm depois, na mesma numeração.
  if (replicar) {
    const i1 = escolhidosDaLamina.findIndex((c) => c.tipo === "referencia_equipe");
    if (i1 > 0) escolhidosDaLamina.unshift(escolhidosDaLamina.splice(i1, 1)[0]);
  }
  for (const c of escolhidosDaLamina) {
    try {
      imagens.push(await c.carregar());
    } catch {
      // Arquivo sumido fica de fora (a referência da equipe sem arquivo é tratada abaixo).
      continue;
    }
    rotulos.push(c.rotulo);
    const indice = imagens.length + deslocamento;
    if (c.tipo === "logo") indiceDaLogo = indice;
    if (c.tipo === "capa") indiceDaCapa = indice;
    if (c.ref) idsReferencias.push(c.ref.id);
    if (c.fotoReplicar) fotosReplicar.push({ indice, ...c.fotoReplicar });
    if (c.tipo === "referencia_equipe" && c.ref) refsNoPrompt.push({ indice, leitura: c.ref.leitura ? texto(c.ref.leitura, 700) : null });
  }
  const legendas = rotulos.map((r, i) => `imagem ${i + 1 + deslocamento}: ${r}`);
  if (replicar && !refsNoPrompt.length) {
    throw new ErroEstudio(409, "referencia_sem_imagem", "A imagem da referência escolhida não foi encontrada. Escolha outra referência para esta lâmina.");
  }
  // Pedir "a logo anexada" sem o anexo faz o gerador inventar uma: sem a imagem, a lâmina vai sem logo.
  const logoNaChamada = indiceDaLogo !== null;

  // Direção com layout: o prompt é recomposto agora, com o kit atual da marca.
  const marca = await marcaDoCliente(t.client_id, kit, fontes, t);
  marca.temLogo = logoNaChamada;
  const base = card.layout
    ? promptDaLamina(cardDoPrompt, marca, {
      total,
      // No panorama a cena é a fatia pronta: "continue na vizinha" e "conecte com a capa" contradiziam a base fixa.
      carrosselInfinito: infinito && !panorama,
      levaLogo: leva,
      conceito: t.direcao.conceito,
      // Replicando, a foto não é a base editada: é o assunto recomposto no layout da referência.
      fotoReal: replicar ? null : resumoDoFundo,
      replicar: replicar ? { comFoto: !!baseFoto || elementos.length > 0 } : null,
      fioVisual: t.direcao.fio_visual ?? null,
      logo: logo ? logo.medida : null,
      areaDaLogo: caixaDaLogoAqui ? { x0: caixaDaLogoAqui.x0 * 100, y0: caixaDaLogoAqui.y0 * 100, x1: caixaDaLogoAqui.x1 * 100, y1: caixaDaLogoAqui.y1 * 100 } : null,
      // Criativo de anúncio: quadro, zona segura e regras do formato (conhecimento-ads.ts).
      anuncio: quadro.formato ? { formato: quadro.formato } : null,
      // Post orgânico em 3:4, 1:1 ou 9:16: quadro e margens do formato.
      post: quadro.post,
    })
    : card.prompt_imagem;
  // Estilo pedido na conversa com o diretor: entra em todas as lâminas, depois da campanha.
  // Refazer: a lâmina já tem versão, então a nova precisa ser outra composição.
  const versoesAntes = t.cards.filter((c) => c.ordem === ordem).length;
  const baseComCampanha = [
    base,
    campanha ? blocoDaCampanha(campanha) : "",
    blocoDoEstiloPedido(t.direcao.estilo_pedido),
    preferencias,
    replicar ? "" : blocoDaSerie({ ordem, total, capa: indiceDaCapa, cenaFixa }),
    blocoDeVariacao(versoesAntes, !!baseFoto || !!recorteNaLamina, replicar, ordem, total > 1 && ordem > 1),
  ].filter(Boolean).join("\n\n");
  const comum = {
    clientId: t.client_id,
    modeloId: t.modelo_imagem_id!,
    referencias: imagens,
    qualidade,
    referencia: { tipo: "estudio_trabalho", id: t.id },
    criadoPor: ch.userId,
    tarefa: "estudio" as const,
    agente: "gerador_imagem" as const,
  };
  const regraDaLogo: "gerar" | false = leva && logoNaChamada ? "gerar" : false;

  // O que a versão guarda da logo: gerada pelo gerador (nunca colada), qual do kit e a área aberta na máscara.
  const marcaDaLogo = {
    logo_gerada: leva ? logoNaChamada : null,
    logo_escolhida: logoNaChamada && logo ? logo.id : null,
    ...(caixaDaLogoAqui ? { logo_area: caixaDaLogoAqui } : {}),
    // Formato em que a versão nasceu: a entrega recusa lâmina em formato diferente do conjunto.
    formato_post: quadro.post,
    anexos: imagens.length + deslocamento,
  };

  // 0) Replicar a referência escolhida pela equipe: geração nova (sem máscara)
  // com as fotos do cliente primeiro, depois as referências, a logo, a capa e a fonte.
  // A foto é recomposta, nunca escurecida.
  if (replicar) {
    const prompt = [
      blocoReplicarReferencia({ referencias: refsNoPrompt, fotos: fotosReplicar, logo: indiceDaLogo, capa: capaDaSerie, editando: refsNoPrompt[0].indice === 1 }),
      baseComCampanha,
      regrasDeRender(t, card, legendas, regraDaLogo, true),
    ].join("\n\n");
    // A referência 1 (imagem 1) é o molde editado, no quadro da lâmina; o resto segue como referência.
    const editando = refsNoPrompt[0].indice === 1 && imagens.length > 0;
    let molde: Uint8Array | null = null;
    if (editando) {
      try {
        molde = await (cobrir(await decodificar(imagens[0].bytes), quadro.largura, quadro.altura)).encode(1);
      } catch {
        molde = null; // imagem que não abre (grande demais, formato): volta a ser só referência
      }
    }
    const img = await chamarImagem({
      ...comum,
      ...(molde ? { editar: { bytes: molde }, referencias: imagens.slice(1) } : {}),
      prompt,
      promptSe2x3: card.layout && !quadro.fixo ? formatoPara2x3(prompt) : undefined,
      tamanho: card.layout ? quadro.tamanho : TAMANHO_2X3,
      tamanhoFixo: !!card.layout && quadro.fixo,
    });
    return await gravarVersao(ch, t, card, { ...img, png: img.png, mime: "image/png" }, {
      origem: "gerar",
      referencias: idsReferencias,
      extra: {
        referencias_jev: escolhida.jev,
        tamanho: img.tamanho,
        modo: "replicar_referencia",
        molde_editado: !!molde,
        // A foto do cliente foi recomposta pelo gerador (não é o original): a tela pede para conferir o rosto.
        foto_recomposta: fotosReplicar.length > 0,
        imagem_id: foto?.id ?? null,
        foto_livre: fundoLivre ? fundoLivre.caminho : null,
        fotos_livres: livres.length,
        ...marcaDaLogo,
      },
    });
  }

  // 1a) Foto de fundo com pessoas ou objetos reais: edição sem máscara, a foto
  // continua o fundo e os elementos entram por cima, integrados.
  if (baseFoto && elementos.length) {
    const prompt = [
      `EDITE a imagem 1: ela é a foto REAL de fundo desta lâmina e fica como está (mesmo lugar, luz, cores e enquadramento). Componha por cima dela a pessoa ou o objeto real das fotos anexadas indicadas abaixo, sem mudar o rosto nem as feições, e depois o texto nas áreas livres${regraDaLogo ? " e a logo" : ""}.`,
      baseComCampanha,
      regrasDeRender(t, card, legendas, regraDaLogo),
    ].join("\n\n");
    const img = await chamarImagem({ ...comum, prompt, editar: { bytes: baseFoto }, tamanho: quadro.tamanho, tamanhoFixo: quadro.fixo });
    return await gravarVersao(ch, t, card, { ...img, png: img.png, mime: "image/png" }, {
      origem: "gerar",
      referencias: idsReferencias,
      extra: { referencias_jev: escolhida.jev, tamanho: img.tamanho, modo: "foto_composta", imagem_id: foto?.id ?? null, fotos_livres: livres.length, ...marcaDaLogo },
    });
  }

  // 1b) Foto real ou fundo contínuo como base: só o texto e a logo mudam.
  if (baseFoto) {
    // Contínuo: a máscara abre o interior (texto integrado à cena, sem caixa;
    // Para Si Ótica, 23/09), mas o que volta é a fatia INTACTA com só as letras
    // e a logo coladas por cima (colarMudancasNaBase): a fatia nunca é
    // reenquadrada e a emenda com as vizinhas fica exata.
    const areasDoTexto = areasDeDesenho(card, total, false, quadro);
    const areasComLogo = caixaDaLogoAqui ? areasDoTexto.concat([ampliar(caixaDaLogoAqui, 0.02)]) : areasDoTexto;
    const areas = panorama ? [INTERIOR_DA_LAMINA] : areasComLogo;
    const prompt = [
      panorama
        ? `EDITE a imagem 1: ela é a cena desta lâmina, parte de um panorama que atravessa o carrossel, e já está pronta. Escreva só o texto${regraDaLogo ? " e a logo" : ""} por cima, nas áreas indicadas. Mantenha a mesma cena, luz, pessoas e objetos, na mesma posição e escala. Não mude nada nas faixas das bordas esquerda e direita (${Math.round(INTERIOR_DA_LAMINA.x0 * 100)}% de cada lado): elas emendam com as lâminas vizinhas.`
        : `EDITE a imagem 1 (foto real do cliente). Desenhe SÓ dentro destas áreas: ${areas.map(descreverArea).join("; ")}. Fora delas a foto fica exatamente como está.`,
      NAO_REENQUADRAR,
      SEM_CAIXA_ATRAS_DO_TEXTO,
      baseComCampanha,
      regrasDeRender(t, card, legendas, regraDaLogo, false, panorama),
    ].join("\n\n");
    const img = await chamarImagem({
      ...comum,
      prompt,
      editar: { bytes: baseFoto, mascara: await mascara(quadro.largura, quadro.altura, areas) },
      tamanho: quadro.tamanho,
      tamanhoFixo: quadro.fixo,
    });
    let final = img.png;
    let medida: Record<string, unknown> | null = null;
    let cenaMudada = false;
    if (panorama) {
      // Só as letras e a logo, dentro das áreas delas (com folga): o resto é a fatia intacta.
      const colado = await colarMudancasNaBase(baseFoto, img.png, areasComLogo.map((a) => ampliar(a, 0.03)));
      cenaMudada = colado.cenaMudada || !colado.png;
      // Cena mudada: fica a imagem inteira do gerador (coerente), marcada fora da emenda.
      if (colado.png) final = colado.png;
      medida = { ...colado.alinhamento, alinhou: colado.alinhou, erro: Math.round(colado.erro * 10) / 10, recorte_texto: !!colado.png, cena_mudada: cenaMudada };
    } else if (img.tamanho === quadro.tamanho) {
      // Foto real: o gerador redesenha tudo mesmo com máscara (e reenquadra): o
      // original é alinhado ao que ele devolveu e volta fora das áreas; dentro
      // das áreas do texto e da logo fica o que ele desenhou.
      const volta = await devolverOriginalAlinhado(baseFoto, img.png, areas, 28, { texto: fotoFixa });
      final = volta.png;
      medida = { ...volta.alinhamento, alinhou: volta.alinhou, erro: Math.round(volta.erro * 10) / 10, recorte_texto: volta.recortouTexto, cena_mudada: volta.cenaMudada };
    }
    return await gravarVersao(ch, t, card, { ...img, png: final, mime: "image/png" }, {
      origem: "gerar",
      referencias: idsReferencias,
      extra: {
        referencias_jev: escolhida.jev,
        tamanho: img.tamanho,
        modo: panorama ? "panorama" : "foto_real",
        imagem_id: foto?.id ?? null,
        foto_livre: fundoLivre ? fundoLivre.caminho : null,
        alinhamento: medida,
        ...marcaDaLogo,
        // Contínuo: o fundo usado e a geração dele (a tela compara com o panorama atual: "fora do fundo").
        ...(panorama ? { fundo: fundoUsado, fundo_geracao: geracaoDoPanorama(t.direcao.panorama), fora_da_emenda: cenaMudada } : {}),
      },
    });
  }

  // 2) Recorte: tela da cor da marca com o recorte no lugar, miolo protegido na
  // máscara; o gerador faz o entorno, o texto e a logo, e o código cola o recorte original de novo.
  if (recorteNaLamina && recortado) {
    const cores = hexDaPaleta(kit);
    const layoutDoRecorte = normalizarLayout(cardDoPrompt.layout, card.funcao, card.ordem, total);
    const tela = await telaDoRecorte(recorteNaLamina.recorte, recorteNaLamina.posicao, quadro.largura, quadro.altura, layoutDoRecorte.cor_fundo || cores[0] || null);
    const prompt = [
      `EDITE a imagem 1: ela já tem a pessoa ou o produto REAL recortado, no lugar certo (${descreverArea(recorteNaLamina.posicao)}). Ele fica exatamente como está: mesmo rosto, feições, corpo, roupa, cores, tamanho e posição; não redesenhe, não mova, não corte e não cubra. Crie em volta dele a lâmina inteira pela direção abaixo: o fundo ou um cenário simples na paleta da marca, luz coerente com a do recorte, uma sombra de contato suave onde ele pousa, os elementos gráficos, o texto na área indicada${regraDaLogo ? " e a logo" : ""}.`,
      "Sem caixa, moldura, borda, contorno branco, halo ou brilho em volta do recorte; nenhum texto, logo, forma ou elemento por cima dele. A cor lisa da imagem 1 é só o ponto de partida: troque pelo fundo da direção.",
      baseComCampanha,
      regrasDeRender(t, cardDoPrompt, legendas, regraDaLogo),
    ].join("\n\n");
    const img = await chamarImagem({
      ...comum,
      prompt,
      editar: { bytes: tela.tela, mascara: tela.mascara },
      tamanho: quadro.tamanho,
      // A tela já está no tamanho do quadro: sem a reserva em 2:3.
      tamanhoFixo: true,
    });
    // Só o recorte volta por cima (a pessoa e o produto nunca redesenhados); a logo é a que o gerador desenhou.
    let fim: { png: Uint8Array; recorte: boolean } = { png: img.png, recorte: false };
    try {
      fim = await acabamentoDaLamina(img.png, {
        recorte: { imagem: recorteNaLamina.recorte, posicao: recorteNaLamina.posicao, larguraDaTela: quadro.largura },
        proporcaoDoQuadro: quadro.final.largura / quadro.final.altura,
      });
    } catch {
      // Falhou: fica o que o gerador fez.
    }
    return await gravarVersao(ch, t, card, { ...img, png: fim.png, mime: "image/png" }, {
      origem: "gerar",
      referencias: idsReferencias,
      extra: {
        referencias_jev: escolhida.jev,
        tamanho: img.tamanho,
        modo: "recorte",
        // Para o ajuste colar o mesmo recorte de novo (pessoa e produto nunca redesenhados).
        recorte: { caminho: recortado.caminho, caixa: recorteNaLamina.caixa, colado: fim.recorte },
        zona_do_texto: layoutDoRecorte.zona_texto,
        fotos_livres: livres.length,
        ...marcaDaLogo,
      },
    });
  }

  // 3) Normal.
  const prompt = `${baseComCampanha}\n\n${regrasDeRender(t, card, legendas, regraDaLogo)}`;
  const img = await chamarImagem({
    ...comum,
    prompt,
    // A reserva em 2:3 só serve ao quadro 4:5 (recorte central); 1:1, 3:4 e 9:16 saem no tamanho pedido ou falham.
    promptSe2x3: card.layout && !quadro.fixo ? formatoPara2x3(prompt) : undefined,
    tamanho: card.layout ? quadro.tamanho : TAMANHO_2X3,
    tamanhoFixo: !!card.layout && quadro.fixo,
  });

  return await gravarVersao(ch, t, card, { ...img, png: img.png, mime: "image/png" }, {
    origem: "gerar",
    referencias: idsReferencias,
    extra: { referencias_jev: escolhida.jev, tamanho: img.tamanho, modo: "normal", ...marcaDaLogo },
  });
}

/**
 * Grava a versao nova com a conferencia pendente. A leitura do texto e o Jev
 * ficam em conferir_card, que a tela chama logo depois: assim gerar e ajustar
 * cabem no tempo da funcao.
 */
async function gravarVersao(
  ch: Chamador,
  t: Trabalho,
  card: CardDirecao,
  img: { png: Uint8Array; mime: string; usoId: string; custoUsd: number; saldoUsd: number; reservaUsada?: string | null },
  meta: { origem: "gerar" | "ajuste"; instrucao?: string; referencias?: string[]; custoExtraUsd?: number; extra?: Record<string, unknown> },
) {
  const proxima = Math.max(0, ...t.cards.filter((c) => c.ordem === card.ordem).map((c) => c.versao)) + 1;
  const { caminho, versao } = await salvarNaMesa(t, card.ordem, proxima, img.png, img.mime);
  const custo = arred(img.custoUsd);
  const nova: VersaoCard = {
    ordem: card.ordem,
    versao,
    storage_path: caminho,
    origem: meta.origem,
    instrucao: meta.instrucao ?? null,
    referencias: meta.referencias ?? [],
    verificacao: { pendente: true },
    custo_usd: arred(custo + num(meta.custoExtraUsd)),
    uso_ids: [img.usoId],
    criado_em: new Date().toISOString(),
    criado_por: ch.userId,
    ...(meta.extra ?? {}),
  };
  // Acrescenta a versao (nunca substitui): o caminho no bucket ja e unico.
  const gravado = await mutarTrabalho(t.id, (atual) => ({
    cards: [...atual.cards, nova],
    custo_usd: arred(num(atual.custo_usd) + custo),
    status: statusDepoisDeGerar(atual, [nova]),
  }));
  return json({
    trabalho_id: t.id,
    ordem: card.ordem,
    versao,
    storage_path: caminho,
    url: await urlAssinada(caminho),
    verificacao: nova.verificacao,
    proximo_passo: "conferir_card",
    custo_usd: arred(custo + num(meta.custoExtraUsd)),
    saldo_usd: img.saldoUsd,
    // Qual rota atendeu (ex.: conta direta sem crédito e a chamada foi pelo OpenRouter): a tela avisa.
    reserva_usada: img.reservaUsada ?? null,
    status: gravado.status,
  });
}

// ------------------------------------------------------------ ajustar card

const ESQUEMA_AJUSTE = {
  nome: "instrucao_de_edicao",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["instrucao_edicao", "texto_exato", "memoria"],
    properties: {
      instrucao_edicao: { type: "string" },
      texto_exato: { type: "string" },
      memoria: { type: "string" },
    },
  },
};

const INSTRUCOES_AJUSTE = `AJUSTE DE UMA LÂMINA

A imagem anexada é a versão atual da lâmina. A pessoa da equipe pediu um ajuste. Transforme o pedido numa instrução de edição precisa para o gerador de imagem, que vai editar ESTA imagem (não criar outra):
- instrucao_edicao: o que muda, onde fica, com que tamanho, cor (hex), peso e posição; e o que deve ficar exatamente igual (todo o resto da lâmina). Se o texto muda, escreva o texto novo entre aspas duplas, com acentos.
- texto_exato: o texto completo que deve aparecer escrito na lâmina depois do ajuste (igual ao atual se o pedido não mexe no texto).
- memoria: uma frase curta, reutilizável em outros trabalhos deste cliente, com o que o pedido ensina sobre o gosto da marca (ou vazio se for só correção pontual).
- Se vier \`areas\` (frações da lâmina, de 0 a 1), o ajuste acontece SÓ dentro delas: descreva a mudança para aquele ponto e diga que o resto fica idêntico.
- Se \`tipo\` for "fundo", troque SÓ o fundo: texto, logo, pessoas e objetos em primeiro plano ficam idênticos, na mesma posição. Com \`nova_foto_de_fundo\`, o fundo novo é essa foto real do cliente (anexada depois da lâmina).
Escreva sem travessão.`;

/**
 * ajustar_card e o caminho único de edição: a ação da tela chama sem `auto`;
 * corrigir_card chama com `auto` (a instrução da decisão da autocorreção).
 * Com `auto`, o texto exato não muda (a correção reescreve o combinado), o
 * pedido não vai para a memória do diretor e a versão nova leva a marca
 * autocorrecao { rodada, motivos }.
 */
async function ajustarCard(ch: Chamador, corpo: Record<string, unknown>, auto: MarcaDeAutocorrecao | null = null) {
  const t = await trabalhoComAcesso(ch, texto(corpo.trabalho_id, 64));
  const ordem = lerOrdem(corpo);
  const tipo: "livre" | "fundo" = !auto && corpo.tipo === "fundo" ? "fundo" : "livre";
  // Ajuste pontual: só as áreas marcadas na tela mudam (máscara + devolução dos pixels originais).
  // Correção automática: só as áreas de texto e logo da lâmina (o resto volta do original).
  const areas = tipo === "fundo" ? [] : auto ? (auto.areas ?? []) : normalizarAreas(corpo.areas);
  const pedido = texto(corpo.instrucao, auto ? 4000 : 2000) || (tipo === "fundo" ? "Troque só o fundo, mantendo texto, logo e primeiro plano." : "");
  if (!pedido) throw new ErroEstudio(400, "instrucao_vazia", "Descreva o ajuste que você quer.");
  garantirEditavel(t);
  const card = cardDaDirecao(t, ordem);
  const atualVersao = versaoAtual(t, ordem);
  if (!atualVersao) throw new ErroEstudio(409, "card_sem_versao", "Gere este card antes de pedir ajuste.");
  // Lâmina do carrossel contínuo (feita sobre a fatia do panorama): o fundo é o
  // panorama, então "trocar o fundo" quebraria a emenda com as vizinhas.
  const marcaDaVersao = atualVersao as VersaoCard & {
    modo?: string;
    fundo?: string | null;
    fundo_geracao?: number | null;
    fora_da_emenda?: boolean;
    /** Versões até 25/09: a logo foi colada pelo código (fica protegida no contínuo). */
    logo_no_codigo?: boolean | null;
    logo_caixa?: Area | null;
    logo_escolhida?: string | null;
    logo_area?: Area | null;
    alinhamento?: { cena_mudada?: boolean } | null;
    recorte?: { caminho: string; caixa: Area; colado?: boolean } | null;
  };
  const naEmenda = !ehAds(t) && !!t.direcao.carrossel_infinito && marcaDaVersao.modo === "panorama";
  if (naEmenda && tipo === "fundo") {
    throw new ErroEstudio(409, "fundo_no_continuo", "No carrossel contínuo o fundo é o panorama: para mudar a cena, use Refazer o fundo no Conjunto (todas as lâminas mudam juntas).");
  }
  const [atual, fotoFundo] = await Promise.all([
    baixar("mesa", atualVersao.storage_path),
    corpo.imagem_id ? imagensDoAcervo(t.client_id, [texto(corpo.imagem_id, 64)]).then((l) => l[0] ?? null) : Promise.resolve(null),
  ]);
  if (corpo.imagem_id && !fotoFundo) throw new ErroEstudio(404, "imagem_inexistente", "Esta foto não está no acervo do cliente.");

  // O ajuste é uma tradução do pedido em instrução de edição: o modelo de
  // leitura (com visão) resolve bem e custa uma fração do diretor.
  const [kit, leitor, preferencias] = await Promise.all([
    lerKit(t.client_id, t),
    modeloDoPapel("leitura"),
    // A autocorreção só conserta texto e logo: as regras do cliente ficam para o ajuste pedido.
    auto ? Promise.resolve("") : preferenciasDaArte(t.client_id).catch(() => ""),
  ]);
  const dir = await chamarTexto({
    clientId: t.client_id,
    tarefa: "estudio",
    agente: "diretor_arte",
    modeloId: leitor.id,
    raciocinio: raciocinioPara(leitor, ["low", "medium"]),
    // Regras aprendidas com o cliente entram no ajuste: o que ele já pediu não precisa ser pedido de novo.
    sistema: [INSTRUCOES_AJUSTE, PADRAO_NA_IMAGEM, preferencias].filter(Boolean).join("\n\n"),
    mensagens: [{
      papel: "usuario",
      conteudo: JSON.stringify({
        pedido,
        tipo,
        // Correção automática: o texto exato é o combinado e não muda.
        autocorrecao: auto ? { motivos: auto.motivos, texto_exato_fixo: true } : null,
        areas: areas.length ? areas : null,
        nova_foto_de_fundo: fotoFundo ? resumoDaFoto(fotoFundo) : null,
        lamina: { ordem, funcao: card.funcao, texto_exato: card.texto_exato, composicao: card.composicao, leva_logo: levaLogo(t, ordem) },
        verificacao_atual: atualVersao.verificacao,
        marca: { paleta: kit?.paleta ?? [], estilo: kit?.estilo ?? null, regras: kit?.regras ?? null },
      }),
      imagens: [{ bytes: atual, mime: "image/png", nome: `card-${ordem}-v${atualVersao.versao}.png` }],
    }],
    esquemaJson: ESQUEMA_AJUSTE,
    maxTokensSaida: 3_000,
    referencia: { tipo: "estudio_trabalho", id: t.id },
    criadoPor: ch.userId,
  });
  const a = (dir.json ?? {}) as { instrucao_edicao?: string; texto_exato?: string; memoria?: string };
  const instrucaoEdicao = texto(a.instrucao_edicao, 4000);
  if (!instrucaoEdicao) throw new ErroEstudio(502, "ajuste_vazio", "O diretor não devolveu a instrução de edição. Tente de novo.");
  const novoTexto = auto ? card.texto_exato : texto(a.texto_exato, 1200) || card.texto_exato;
  const cardAjustado: CardDirecao = { ...card, texto_exato: novoTexto };

  // O texto novo passa a valer na direcao, para a conferencia comparar certo.
  let base = t;
  if (novoTexto !== card.texto_exato) {
    base = await mutarTrabalho(t.id, (x) => ({
      direcao: { ...x.direcao, cards: x.direcao.cards.map((c) => (c.ordem === ordem ? { ...c, texto_exato: novoTexto } : c)) },
      custo_usd: arred(num(x.custo_usd) + dir.custoUsd),
    }));
  } else {
    base = await mutarTrabalho(t.id, (x) => ({ custo_usd: arred(num(x.custo_usd) + dir.custoUsd) }));
  }

  // Edicao DENTRO do gerador sobre a versao atual (primeira imagem). A logo
  // já está na arte (desenhada pelo gerador) e fica; a oficial vai junto na
  // capa e no final, a mesma da versão, para o gerador copiar se precisar.
  const referencias: ImagemEntrada[] = [];
  const legendas = ["imagem 1: versão atual da lâmina, que deve ser editada"];
  if (levaLogo(base, ordem)) {
    const daVersao = escolhaDaLogo(marcaDaVersao.logo_escolhida);
    const logo = escolherLogoDoKit(await logosDoKit(base.client_id, kit, escolhaDaLamina(base, card, daVersao)), base, { logo: card.logo ?? daVersao ?? undefined }, null);
    if (logo) {
      referencias.push(logo.imagem);
      legendas.push(`imagem ${referencias.length + 1}: ${LEGENDA_DA_LOGO}`);
    }
  }
  // Referências escolhidas pela equipe (da lâmina ou do conjunto), como no
  // gerar_card: o ajuste segue o layout delas (pedido da Mesa Ads, 25/09).
  // Fora do contínuo (lá a cena é o panorama) e fora da autocorreção (só texto).
  const idsReferencias: string[] = [];
  if (!auto && !naEmenda) {
    for (const ref of await referenciasDaEquipe(base, card)) {
      try {
        referencias.push(await imagemDaReferencia(ref));
        idsReferencias.push(ref.id);
        legendas.push(`imagem ${referencias.length + 1}: referência ESCOLHIDA PELA EQUIPE: ao aplicar o ajuste, siga de perto a estrutura de layout, a hierarquia, a escala da tipografia e o tratamento desta peça, com as cores, as fontes e a logo desta marca; não copie o texto nem a marca dela`);
      } catch {
        // Referência sem arquivo fica de fora do ajuste.
      }
    }
  }
  const quadro = quadroDoCard(base, card);
  if (fotoFundo) {
    referencias.push({ bytes: await fotoRealNaLamina(fotoFundo, quadro.largura, quadro.altura), mime: "image/png", nome: "novo-fundo.png" });
    legendas.push(`imagem ${referencias.length + 1}: foto real do cliente que vira o novo fundo (use como está, sem redesenhar)`);
  }
  // A edição mantém o formato da versão editada.
  const tamanhoAtual = String((atualVersao as { tamanho?: string }).tamanho || (card.layout ? quadro.tamanho : TAMANHO_2X3));
  const dims = dimensoesPng(atual);
  const abertas = areas.map((a) => ampliar(a, 0.02));
  const comMascara = abertas.length > 0 && !!dims;
  const abertura = comMascara
    ? `Mude SÓ dentro destas áreas: ${abertas.map(descreverArea).join("; ")}. Fora delas, nenhum pixel muda.`
    : tipo === "fundo"
      ? "Troque SÓ o fundo. Texto, logo, pessoas e objetos em primeiro plano ficam idênticos, na mesma posição, tamanho e cor."
      : "Mantenha exatamente igual tudo o que a instrução não manda mudar: composição, fundo, cores, tipografia, texto e posição dos elementos.";
  const promptEdicao = [
    `EDITE a imagem 1. ${abertura}`,
    naEmenda
      ? `${NAO_REENQUADRAR} As faixas das bordas esquerda e direita (${Math.round(INTERIOR_DA_LAMINA.x0 * 100)}% de cada lado) emendam com as lâminas vizinhas: não mude nada nelas. A cena é o fundo contínuo e não muda; o texto continua na mesma área da lâmina.`
      : "",
    instrucaoEdicao,
    regrasDeRender(base, cardAjustado, legendas, levaLogo(base, ordem) ? "manter" : false, false, naEmenda),
    marcaDaVersao.recorte ? "A pessoa ou o produto recortado desta lâmina fica exatamente como está, no mesmo lugar e tamanho; nada por cima dele." : "",
  ].filter(Boolean).join("\n\n");
  const gerado = await chamarImagem({
    clientId: base.client_id,
    modeloId: base.modelo_imagem_id!,
    prompt: promptEdicao,
    referencias,
    editar: { bytes: atual, mascara: comMascara ? await mascara(dims!.largura, dims!.altura, abertas) : undefined },
    qualidade: (QUALIDADES.includes(base.qualidade as Qualidade) ? base.qualidade : QUALIDADE_PADRAO) as Qualidade,
    tamanho: tamanhoAtual,
    // Criativo 1:1 ou 9:16: a edição fica no tamanho da peça (sem reserva em 2:3).
    tamanhoFixo: quadro.fixo && tamanhoAtual === quadro.tamanho,
    referencia: { tipo: "estudio_trabalho", id: base.id },
    criadoPor: ch.userId,
    tarefa: "estudio",
    agente: "gerador_imagem",
  });
  // Ajuste pontual de verdade: fora das áreas marcadas voltam os pixels da versão anterior.
  let img = comMascara && gerado.tamanho === tamanhoAtual && !naEmenda
    ? { ...gerado, png: await devolverOriginalForaDasAreas(atual, gerado.png, abertas, 16), mime: "image/png" }
    : gerado;
  // Lâmina contínua: nada é reenquadrado. Só o que mudou (nas áreas marcadas
  // ou no interior) é colado sobre a versão atual, o canto da logo fica e as
  // bordas voltam exatas do fundo gravado: a emenda com as vizinhas não quebra.
  let emenda: Record<string, unknown> | null = null;
  if (naEmenda) {
    const q = quadroDoCard(base, card);
    const zona = normalizarLayout(card.layout, card.funcao, card.ordem, totalCards(base)).zona_texto;
    // Versão antiga (até 25/09) com a logo colada pelo código: a caixa gravada dela continua protegida.
    const c = marcaDaVersao.logo_caixa ?? caixaDaLogoNoQuadro(zona, card.funcao === "capa" || card.ordem === 1, q);
    const protegidas: Area[] = marcaDaVersao.logo_no_codigo ? [c] : [];
    // Bordas do fundo gravado só quando a versão atual está no enquadramento dele.
    const comBordas = !!marcaDaVersao.fundo && !marcaDaVersao.fora_da_emenda && !marcaDaVersao.alinhamento?.cena_mudada;
    // Fundo sumido (refeito): ficam as bordas da versão atual, que já eram as dele.
    const fundoGravado = comBordas ? await baixar("mesa", marcaDaVersao.fundo!).catch(() => null) : null;
    // Sem área marcada, o ajuste livre muda o texto: vale a área do texto da
    // lâmina (com folga). A cena é o panorama e não muda por ajuste.
    // A área da logo gerada também abre (o ajuste pode mexer nela) e a colagem nunca a apaga.
    const areaDaLogo = !marcaDaVersao.logo_no_codigo && levaLogo(base, ordem) && marcaDaVersao.logo_area ? [marcaDaVersao.logo_area] : [];
    const areasDoAjuste = abertas.length ? abertas : areasDeDesenho(card, totalCards(base), false, q).concat(areaDaLogo).map((a) => ampliar(a, 0.03));
    const colado = await colarMudancasNaBase(atual, gerado.png, areasDoAjuste, {
      protegidas,
      bordasDe: fundoGravado,
      fracaoDasBordas: INTERIOR_DA_LAMINA.x0,
    });
    const png = colado.png;
    img = png ? { ...gerado, png, mime: "image/png" } : gerado;
    emenda = {
      modo: "panorama",
      fundo: marcaDaVersao.fundo ?? null,
      fundo_geracao: marcaDaVersao.fundo_geracao ?? null,
      // Cena mudada no ajuste: fica a imagem inteira do gerador, marcada fora da emenda.
      fora_da_emenda: !png || !!marcaDaVersao.fora_da_emenda,
      alinhamento: { ...colado.alinhamento, alinhou: colado.alinhou, erro: Math.round(colado.erro * 10) / 10, cena_mudada: colado.cenaMudada },
      bordas_do_fundo: colado.bordas,
      logo_no_codigo: marcaDaVersao.logo_no_codigo ?? null,
      ...(marcaDaVersao.logo_area ? { logo_area: marcaDaVersao.logo_area } : {}),
    };
  }

  // Fora do contínuo: o recorte da pessoa ou do produto é colado de novo,
  // idêntico, a não ser que a área marcada no ajuste passe por cima dele. A
  // logo não é colada: é a que o gerador desenhou e manteve.
  let acabamentoDoAjuste: Record<string, unknown> = {};
  const r = marcaDaVersao.recorte;
  if (!naEmenda && r && r.caminho && r.caixa) {
    const q = quadroDoCard(base, card);
    const cruza = (a: Area, b: Area) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
    let recorteDeNovo: { imagem: Awaited<ReturnType<typeof recorteNaCaixa>>["recorte"]; posicao: Area; larguraDaTela: number } | null = null;
    try {
      const pos = await recorteNaCaixa(await baixar("mesa", r.caminho), q.largura, q.altura, r.caixa);
      if (!abertas.some((a) => cruza(a, pos.posicao))) recorteDeNovo = { imagem: pos.recorte, posicao: pos.posicao, larguraDaTela: q.largura };
    } catch {
      // Recorte sumido: fica o que o gerador manteve.
    }
    try {
      const fim = await acabamentoDaLamina(img.png, { recorte: recorteDeNovo, proporcaoDoQuadro: q.final.largura / q.final.altura });
      img = { ...img, png: fim.png, mime: "image/png" };
      acabamentoDoAjuste = { modo: "recorte", recorte: { ...r, colado: fim.recorte }, formato_post: q.post };
    } catch {
      // Acabamento falhou: fica a edição do gerador.
    }
  }
  // A logo da versão ajustada é a que o gerador desenhou (a da versão anterior, mantida).
  const logoDoAjuste = levaLogo(base, ordem)
    ? { logo_escolhida: marcaDaVersao.logo_escolhida ?? null, ...(marcaDaVersao.logo_no_codigo ? {} : { logo_gerada: true }) }
    : {};

  // O que foi pedido vai para a memoria do diretor (origem ajuste). A
  // autocorreção não é gosto da marca: fica fora da memória.
  // Frente H: grava pelo cérebro do cliente (área arte, categoria ajuste): o
  // mesmo pedido de novo vira reforço, o que contradiz um antigo o aposenta.
  // O card e o pedido literal vão no motivo, para o texto repetir e reforçar.
  const aprendizado = texto(a.memoria, 400);
  if (!auto) await gravarNoCerebro(servico(), {
    client_id: base.client_id,
    area: "arte",
    categoria: "ajuste",
    texto: aprendizado || `Ajuste pedido (${card.funcao}): ${texto(pedido, 500)}`,
    motivo: `pedido no card ${ordem}: ${texto(pedido, 300)}`,
    fonte: "estudio",
    criado_por: ch.userId,
    referencia_id: base.id,
  });

  return await gravarVersao(ch, base, cardAjustado, img, {
    origem: "ajuste",
    instrucao: auto ? `Correção automática ${auto.rodada}: ${auto.motivos.join("; ")}` : pedido,
    custoExtraUsd: dir.custoUsd,
    referencias: idsReferencias,
    extra: {
      ...logoDoAjuste,
      ...(emenda ?? {}),
      ...acabamentoDoAjuste,
      ...(auto ? { autocorrecao: auto } : {}),
      instrucao_edicao: instrucaoEdicao,
      versao_editada: atualVersao.versao,
      uso_diretor: dir.usoId,
      tamanho: img.tamanho,
      tipo_ajuste: comMascara ? "area" : tipo,
      areas: comMascara ? areas : undefined,
      imagem_id: fotoFundo?.id,
    },
  });
}

// ------------------------------------------------------------ corrigir card

/**
 * corrigir_card { trabalho_id, ordem, pedido_da_equipe? }: autocorreção antes
 * de mostrar. Lê a versão atual e a verificação dela, decide
 * (decidirAutocorrecao) e, se houver erro, edita pelo mesmo caminho do ajuste
 * (ajustarCard com `auto`). No máximo LIMITE_DE_AUTOCORRECAO rodadas
 * automáticas seguidas por lâmina; o pedido da equipe ("Corrigir de novo")
 * não conta no limite e recomeça a sequência.
 */
async function corrigirCard(ch: Chamador, corpo: Record<string, unknown>) {
  const t = await trabalhoComAcesso(ch, texto(corpo.trabalho_id, 64));
  const ordem = lerOrdem(corpo);
  garantirEditavel(t);
  const card = cardDaDirecao(t, ordem);
  const atual = versaoAtual(t, ordem);
  if (!atual) throw new ErroEstudio(409, "card_sem_versao", "Gere este card antes de corrigir.");
  const autocorrecao = decidirAutocorrecao(atual.verificacao as Verificacao | VerificacaoPendente, {
    ads: ehAds(t),
    textoExato: card.texto_exato,
  });
  if (!autocorrecao.precisa || !autocorrecao.instrucao) {
    return json({ trabalho_id: t.id, ordem, versao: atual.versao, corrigido: false, autocorrecao, custo_usd: 0 });
  }
  const pedidoDaEquipe = corpo.pedido_da_equipe === true;
  const seguidas = rodadasSeguidas(t.cards.filter((c) => c.ordem === ordem));
  if (!pedidoDaEquipe && seguidas >= LIMITE_DE_AUTOCORRECAO) {
    throw new ErroEstudio(
      409,
      "limite_de_autocorrecao",
      `A lâmina ${ordem} já passou por ${LIMITE_DE_AUTOCORRECAO} correções automáticas seguidas. Veja os motivos e corrija de novo ou ajuste à mão.`,
      { codigo: "limite_de_autocorrecao", rodadas: seguidas, autocorrecao },
    );
  }
  const rodada = pedidoDaEquipe ? 1 : seguidas + 1;
  // Só a área do texto e da logo abre para o gerador: pessoa, cenário e
  // composição ficam idênticos (antes a imagem inteira era refeita e o gerador
  // inventava defeitos). Lâmina antiga sem layout não tem área conhecida: não
  // corrige sozinha.
  // A logo é gerada junto com a arte: a área dela abre junto com a do texto
  // (a gravada na versão quando a máscara a fixou; senão a área padrão da logo).
  const logoArea = (atual as VersaoCard & { logo_area?: Area | null }).logo_area ?? null;
  const areasDaCorrecao = card.layout
    ? areasDeDesenho(card, totalCards(t), levaLogo(t, ordem) && !logoArea, quadroDoCard(t, card)).concat(logoArea && levaLogo(t, ordem) ? [ampliar(logoArea, 0.02)] : [])
    : [];
  if (!areasDaCorrecao.length) {
    return json({
      trabalho_id: t.id,
      ordem,
      versao: atual.versao,
      corrigido: false,
      autocorrecao: { ...autocorrecao, precisa: false, motivos: [...autocorrecao.motivos, "Lâmina sem layout: marque a área do texto e use Ajustar."] },
      custo_usd: 0,
    });
  }
  const marca: MarcaDeAutocorrecao = { rodada, motivos: autocorrecao.motivos, areas: areasDaCorrecao, ...(pedidoDaEquipe ? { pedido_da_equipe: true } : {}) };
  const resposta = await ajustarCard(ch, { trabalho_id: t.id, ordem, instrucao: autocorrecao.instrucao }, marca);
  const dados = await resposta.json();
  return json({ ...dados, corrigido: true, rodada, autocorrecao }, resposta.status);
}

// ---------------------------------------------------------------- legenda

const ESQUEMA_LEGENDA = {
  nome: "legenda",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["legenda", "hashtags_candidatas"],
    properties: {
      legenda: { type: "string" },
      hashtags_candidatas: { type: "array", items: { type: "string" } },
    },
  },
};

const INSTRUCOES_LEGENDA = `LEGENDA FINAL DO POST

Escreva a legenda do Instagram deste post a partir do item da agenda, da direção de arte e do contexto da marca. A legenda completa a arte: conta o que a arte não cabe, com a voz da marca, sem repetir lâmina por lâmina.
- Primeira linha forte (gancho que funciona antes do "mais"), ligada à capa.
- Corpo em 2 a 4 parágrafos curtos: contexto, o porquê, um detalhe concreto do negócio (bairro, serviço, prova, bastidor) tirado do contexto; linguagem do público da marca, português do Brasil, emoji só se a marca usa.
- Termine com a chamada para ação do item (um verbo claro: salvar, comentar, chamar no WhatsApp, agendar).
- Não repita frases das legendas recentes em \`legendas_recentes\`.
- NÃO coloque hashtags na legenda. Em hashtags_candidatas, sugira de 10 a 14 hashtags em minúsculas, sem acento, com #: misture nicho, serviço, cidade ou bairro, e o tema do post; nada genérico demais (#love, #instagood) e nada que o público não busque.
- Se o item já traz uma legenda prevista, parta dela e melhore sem mudar o sentido.
- Sem travessão. Sem inventar preço, dado ou promessa que não estão no item ou no contexto.`;

const NIVEIS_HASHTAG = [
  "Não serve: genérica demais, fora do tema ou do público, ou de outro nicho.",
  "Serve pouco: ligada ao tema, mas ampla demais ou com público pouco provável de virar cliente.",
  "Serve: do nicho ou do serviço, com público que busca este assunto.",
  "Serve muito: específica do nicho, do serviço ou da região da marca e do tema deste post; atrai exatamente o público que vira cliente.",
];
const MAX_HASHTAGS = 5;

function limparHashtag(h: unknown): string | null {
  const s = semAcento(texto(h, 60)).replace(/^#+/, "").replace(/[^a-z0-9_]/g, "");
  return s.length >= 3 && s.length <= 40 ? `#${s}` : null;
}

/** De 4 a 5 hashtags: o Jev dá a nota de cada candidata e o código fica com as melhores. */
async function escolherHashtags(t: Trabalho, candidatas: string[], contexto: Record<string, unknown>, criadoPor: string): Promise<string[]> {
  if (candidatas.length <= MAX_HASHTAGS) return candidatas;
  try {
    const questions: Record<string, PerguntaJev> = {};
    candidatas.forEach((h, i) => {
      questions[`h${i}`] = {
        type: "score",
        instructions: `Quão boa é a hashtag \`hashtags.h${i}\` para este post chegar ao público que vira cliente da marca em \`marca\`, dado o tema em \`post\`?`,
        criteria: NIVEIS_HASHTAG,
      };
    });
    const res = await jevPerguntar({
      state: { ...contexto, hashtags: Object.fromEntries(candidatas.map((h, i) => [`h${i}`, h])) },
      questions,
    });
    await cobrarJev(res, { clientId: t.client_id, tarefa: "estudio", referencia: { tipo: "estudio_trabalho", id: t.id }, criadoPor });
    return candidatas
      .map((h, i) => ({ h, nota: notaScore(res.answers[`h${i}`]) ?? -1 }))
      .sort((a, b) => b.nota - a.nota)
      .slice(0, MAX_HASHTAGS)
      .map((x) => x.h);
  } catch {
    // Sem Jev, as primeiras sugeridas pelo diretor.
    return candidatas.slice(0, MAX_HASHTAGS);
  }
}

async function legenda(ch: Chamador, corpo: Record<string, unknown>) {
  const t = await trabalhoComAcesso(ch, texto(corpo.trabalho_id, 64));
  if (ehAds(t)) {
    throw new ErroEstudio(409, "anuncio_sem_legenda", "Criativo de anúncio não tem legenda de post: o texto do anúncio fica na copy da Mesa Ads.");
  }
  if (!t.task_id) throw new ErroEstudio(409, "trabalho_sem_item", "Este trabalho não está ligado a um item da agenda.");
  const item = await lerItemDaAgenda(t.task_id);
  const [prompt, diretor, contexto, recentes, perfil, marcaDaLegenda] = await Promise.all([
    promptDoDiretor(t.client_id),
    modeloDoPapel("diretor_arte"),
    lerContextoConsolidado(servico(), t.client_id),
    servico()
      .from("files")
      .select("caption")
      .eq("client_id", t.client_id)
      .eq("folder", "materiais")
      .is("parent_file_id", null)
      .not("caption", "is", null)
      .order("created_at", { ascending: false })
      .limit(5),
    servico().from("profiles").select("company_name, full_name").eq("id", t.client_id).maybeSingle(),
    marcaDe(t.client_id, t),
  ]);
  const p = perfil.data as { company_name: string | null; full_name: string | null } | null;
  // Marca por projeto (Acerbi e CME): nome e tom da marca do item; cliente sem marca segue igual.
  const marca = {
    nome: marcaDaLegenda && !marcaDaLegenda.principal ? texto(marcaDaLegenda.nome, 120) : texto(p?.company_name || p?.full_name, 120) || null,
    contexto: contexto ? contextoComMarca(contexto, marcaDaLegenda) : null,
  };
  const r = await chamarTexto({
    clientId: t.client_id,
    tarefa: "estudio",
    agente: "diretor_arte",
    modeloId: diretor.id,
    raciocinio: raciocinioPara(diretor, ["low", "medium"]),
    // Frente H: títulos, CTA e anti-genérico (com teto) antes do prompt do diretor.
    sistema: `${CONHECIMENTO_DA_LEGENDA}\n\n${prompt}\n\n${INSTRUCOES_LEGENDA}`,
    mensagens: [{
      papel: "usuario",
      conteudo: JSON.stringify({
        item: {
          titulo: item.tarefa.title,
          formato: item.tarefa.delivery_type,
          roteiro_e_contexto: texto(item.tarefa.description, 4000),
          objetivo: item.post?.objective ?? null,
          legenda_prevista: texto(item.post?.default_caption, 2200) || null,
          detalhe_do_estrategista: item.itemProposta ?? null,
        },
        direcao: {
          conceito: t.direcao.conceito,
          cards: t.direcao.cards.map((c) => ({ ordem: c.ordem, funcao: c.funcao, texto_exato: c.texto_exato })),
        },
        marca,
        legendas_recentes: ((recentes.data as { caption: string }[] | null) ?? []).map((x) => texto(x.caption, 400)),
      }),
    }],
    esquemaJson: ESQUEMA_LEGENDA,
    maxTokensSaida: 8_000,
    // Chamada longa (diretor com a base de conhecimento inteira): 5 min antes de desistir.
    timeoutMs: 300_000,
    referencia: { tipo: "estudio_trabalho", id: t.id },
    criadoPor: ch.userId,
  });
  const bruto = (r.json ?? {}) as { legenda?: string; hashtags_candidatas?: unknown[] };
  // Hashtag que escapou para dentro do texto sai dali: elas vivem em campo próprio.
  const final = texto(bruto.legenda, 2200).replace(/(\s*#[\p{L}\p{N}_]+)+\s*$/u, "").trim();
  if (!final) throw new ErroEstudio(502, "legenda_vazia", "O diretor não devolveu a legenda. Tente de novo.");
  const candidatas = [...new Set((bruto.hashtags_candidatas ?? []).map(limparHashtag).filter(Boolean) as string[])].slice(0, 16);
  const hashtags = await escolherHashtags(
    t,
    candidatas,
    { marca: { nome: marca.nome, contexto: marca.contexto }, post: { titulo: item.tarefa.title, conceito: t.direcao.conceito, legenda: final.slice(0, 600) } },
    ch.userId,
  );
  const gravado = await mutarTrabalho(t.id, (x) => ({ legenda: final, hashtags, custo_usd: arred(num(x.custo_usd) + r.custoUsd) }));
  return json({
    trabalho_id: t.id,
    legenda: gravado.legenda,
    hashtags: (gravado as Trabalho & { hashtags?: string[] }).hashtags ?? hashtags,
    custo_usd: r.custoUsd,
    saldo_usd: r.saldoUsd,
    reserva_usada: r.reservaUsada ?? null,
  });
}

/** Legenda que vai ao ar: o texto e, numa linha própria no fim, as hashtags. */
function legendaComHashtags(legendaTexto: string | null, hashtags: string[] | null | undefined): string | null {
  const base = legendaTexto?.trim() || "";
  const tags = (hashtags ?? []).filter((h) => !base.includes(h));
  if (!base && !tags.length) return null;
  return tags.length ? `${base}${base ? "\n\n" : ""}${tags.join(" ")}` : base;
}

// --------------------------------------------------------------- entregar

/**
 * Lamina no formato final: 4:5 (1080 x 1350) por padrao; o criativo de
 * anuncio passa o quadro do formato (1080 x 1080 ou 1080 x 1920). O corte e a
 * escala ficam com a transformacao de imagem do Storage (cover pelo centro,
 * sem gastar CPU da funcao). Se a transformacao nao estiver disponivel no
 * plano, entra a lamina como foi gerada e a resposta avisa.
 */
async function laminaFinal(
  caminho: string,
  alvo: { largura: number; altura: number } = { largura: LARGURA_FINAL, altura: ALTURA_FINAL },
): Promise<{ bytes: Uint8Array; largura: number | null; altura: number | null; redimensionada: boolean }> {
  try {
    const { data, error } = await servico().storage.from("mesa").download(caminho, {
      transform: { width: alvo.largura, height: alvo.altura, resize: "cover", format: "origin" },
    });
    if (!error && data) {
      const bytes = new Uint8Array(await data.arrayBuffer());
      const d = dimensoesPng(bytes);
      // Aceita qualquer tamanho na proporcao do alvo (o Storage pode nao ampliar alem do original).
      if (d && Math.abs(d.largura / d.altura - alvo.largura / alvo.altura) < 0.01) {
        return { bytes, largura: d.largura, altura: d.altura, redimensionada: true };
      }
    }
  } catch {
    // cai no original abaixo
  }
  const original = await baixar("mesa", caminho);
  const d = dimensoesPng(original);
  return { bytes: original, largura: d?.largura ?? null, altura: d?.altura ?? null, redimensionada: false };
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const resumo = new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes)));
  return Array.from(resumo, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function entregar(ch: Chamador, corpo: Record<string, unknown>) {
  const t = await trabalhoComAcesso(ch, texto(corpo.trabalho_id, 64));
  // Criativo de anúncio: entrega própria, fora da agenda e da aprovação de post.
  if (ehAds(t)) return await entregarAnuncio(ch, t, corpo);
  if (t.status === "entregue" && t.file_ids.length) {
    return json({ trabalho_id: t.id, file_ids: t.file_ids, root_file_id: t.file_ids[0], ja_entregue: true });
  }
  if (!t.task_id) throw new ErroEstudio(409, "trabalho_sem_item", "Este trabalho não está ligado a um item da agenda.");
  const ultimas = t.direcao.cards.map((c) => ({ card: c, versao: versaoAtual(t, c.ordem) }));
  const semArte = ultimas.filter((u) => !u.versao).map((u) => u.card.ordem);
  if (!ultimas.length || semArte.length) {
    throw new ErroEstudio(409, "cards_sem_arte", "Gere todos os cards antes de entregar.", { cards_sem_arte: semArte });
  }
  // Formato do conjunto: toda lâmina tem que ter nascido nele (o corte final de uma
  // lâmina 4:5 em 1:1 cortaria o texto). Versão antiga, sem a marca, é 4:5.
  const formatoDoConjunto = formatoDoPost(t.direcao.formato);
  const foraDoFormato = ultimas
    .filter((u) => formatoDoPost((u.versao as VersaoCard & { formato_post?: string | null }).formato_post) !== formatoDoConjunto)
    .map((u) => u.card.ordem);
  if (foraDoFormato.length) {
    throw new ErroEstudio(409, "laminas_em_outro_formato", `O formato do post é ${QUADRO_DO_POST[formatoDoConjunto].rotulo}, mas ${foraDoFormato.length === 1 ? `a lâmina ${foraDoFormato[0]} foi gerada` : `as lâminas ${foraDoFormato.join(", ")} foram geradas`} em outro formato. Gere de novo antes de entregar.`, {
      laminas: foraDoFormato,
    });
  }
  const quadroFinal = QUADRO_DO_POST[formatoDoConjunto].final;

  const item = await lerItemDaAgenda(t.task_id);
  if (item.clientId !== t.client_id) throw new ErroEstudio(409, "item_de_outro_cliente", "O item da agenda não pertence a este cliente.");
  const projetoId = item.projeto.id;
  const total = ultimas.length;
  const ehCarrossel = total > 1;
  const tipo = ehCarrossel ? "carrossel" : "post";
  const nomeBase = texto(item.tarefa.title, 160) || "Arte do estúdio";
  const legendaTexto = t.legenda?.trim() || item.post?.default_caption?.trim() || null;
  // Vai ao ar com as 4 a 5 hashtags escolhidas no fim; no trabalho, legenda e hashtags seguem separadas.
  const legendaFinal = legendaComHashtags(legendaTexto, t.hashtags);
  const descricao = texto(`Arte do Estúdio (Mesa do cliente). ${t.direcao.conceito}`, 1000);

  const fileIds: string[] = [];
  const formatos: { ordem: number; largura: number | null; altura: number | null; redimensionada: boolean }[] = [];
  let paiId: string | null = null;

  for (let i = 0; i < total; i++) {
    const { card, versao } = ultimas[i];
    // Idempotente: uma nova tentativa reaproveita o que ja foi registrado.
    // Depois de uma reprovacao a rodada sobe e a entrega vira arquivo novo
    // (a rodada 1 mantem a chave antiga, das entregas ja feitas).
    const rodada = Math.max(1, Number(t.entrega_rodada) || 1);
    const chave = rodada > 1 ? `estudio-arte:${t.id}:r${rodada}:${i}` : `estudio-arte:${t.id}:${i}`;
    const { data: existente } = await servico().from("files").select("id, client_id").eq("idempotency_key", chave).maybeSingle();
    const ja = existente as { id: string; client_id: string } | null;
    if (ja) {
      if (ja.client_id !== t.client_id) throw new ErroEstudio(409, "chave_de_arquivo_em_uso", "O registro deste envio pertence a outro cliente.");
      fileIds.push(ja.id);
      if (i === 0) paiId = ja.id;
      continue;
    }

    const lamina = await laminaFinal(versao!.storage_path, quadroFinal);
    formatos.push({ ordem: card.ordem, largura: lamina.largura, altura: lamina.altura, redimensionada: lamina.redimensionada });

    // Mesmo caminho da tela de Arquivos: <cliente>/<grupo>/v1/<n>-<nome>.png
    // no bucket files, enviado com o JWT de quem chamou.
    const fileId = crypto.randomUUID();
    const grupo: string = paiId ?? fileId;
    const caminho: string = `${t.client_id}/${grupo}/v1/${i + 1}-${nomeSeguro(nomeBase)}.png`;
    const { error: erroUpload } = await ch.doChamador.storage
      .from("files")
      .upload(caminho, new Blob([new Uint8Array(lamina.bytes)], { type: "image/png" }), { contentType: "image/png", upsert: false });
    if (erroUpload) {
      throw new ErroEstudio(503, "envio_de_arquivo_falhou", "Não foi possível enviar a arte para Arquivos. Tente entregar de novo.", {
        card: card.ordem,
        detalhe: erroUpload.message,
      });
    }

    const nome = i === 0 ? nomeBase : (ehCarrossel ? `${nomeBase} (${i + 1}/${total})` : nomeBase);
    // create_file_record le auth.uid(): roda com o JWT de quem chamou, como na tela.
    const { data: registro, error: erroRegistro } = await ch.doChamador.rpc("create_file_record", {
      p_file: {
        id: fileId,
        client_id: t.client_id,
        file_name: nome,
        file_url: `files://${caminho}`,
        file_type: ehCarrossel ? "carrossel" : "post",
        mime_type: "image/png",
        extension: "png",
        storage_bucket: "files",
        storage_path: caminho,
        size_bytes: lamina.bytes.byteLength,
        // A publicacao automatica na Meta exige o sha256 de cada lamina.
        sha256: await sha256Hex(lamina.bytes),
        folder: "materiais",
        project_id: projetoId,
        status: "ready",
        version: 1,
        caption: i === 0 ? legendaFinal : null,
        description: i === 0 ? descricao : null,
        parent_file_id: ehCarrossel && i > 0 ? paiId : null,
        idempotency_key: chave,
      },
    });
    if (erroRegistro || !registro) {
      await ch.doChamador.storage.from("files").remove([caminho]).catch(() => {});
      throw new ErroEstudio(503, "registro_de_arquivo_falhou", "A arte subiu, mas o registro em Arquivos falhou. Tente entregar de novo.", {
        card: card.ordem,
        detalhe: erroRegistro?.message ?? null,
      });
    }
    const id: string = (registro as { id: string }).id;
    fileIds.push(id);
    if (i === 0) paiId = id;
  }

  const gravado = await mutarTrabalho(t.id, () => ({ file_ids: fileIds, status: "entregue", legenda: legendaTexto }));
  return json({
    trabalho_id: t.id,
    status: gravado.status,
    tipo,
    project_id: projetoId,
    root_file_id: fileIds[0],
    file_ids: fileIds,
    formatos,
    aviso: formatos.some((f) => !f.redimensionada)
      ? "A transformação de imagem do Storage não respondeu: parte das artes foi entregue no tamanho em que foi gerada."
      : null,
  });
}

/**
 * entregar de um trabalho 'ads' (caminho escolhido por ser o mais simples e
 * seguro, sem migration e sem mexer na agenda):
 * - cada card vira um arquivo em Arquivos, pelo mesmo caminho da tela (bucket
 *   files + RPC create_file_record com o JWT de quem chamou), na pasta
 *   "criativos" (Criativos de anúncio), no tamanho final do formato, sem
 *   legenda de post (a copy fica na Mesa Ads); o carrossel de anúncio vira pai
 *   e filhos "(n/N)", como o do post; ligado ao projeto só quando o trabalho
 *   tem item da agenda;
 * - os ids vão para direcao.entrega_ads e NÃO para file_ids: a aprovação do
 *   post (mesa_enviar_para_aprovacao), o gatilho que acompanha a aprovação e o
 *   agendamento automático (mesa_agendar_aprovados) se guiam por file_ids,
 *   então o criativo não entra nesse fluxo;
 * - status 'entregue'; idempotente pela idempotency_key de cada card (uma nova
 *   tentativa reaproveita o que já foi registrado).
 */
async function entregarAnuncio(ch: Chamador, t: Trabalho, corpo: Record<string, unknown>) {
  const feita = t.direcao.entrega_ads;
  if (t.status === "entregue" && feita?.file_ids?.length) {
    return json({ trabalho_id: t.id, tipo: "anuncio", file_ids: feita.file_ids, arquivos: feita.arquivos, ja_entregue: true });
  }
  const ultimas = t.direcao.cards.map((c) => ({ card: c, versao: versaoAtual(t, c.ordem) }));
  const semArte = ultimas.filter((u) => !u.versao).map((u) => u.card.ordem);
  if (!ultimas.length || semArte.length) {
    throw new ErroEstudio(409, "cards_sem_arte", "Gere todos os criativos antes de entregar.", { cards_sem_arte: semArte });
  }
  // Projeto só quando o criativo nasceu de um item da agenda (e o item é deste cliente).
  let projetoId: string | null = null;
  if (t.task_id) {
    try {
      const item = await lerItemDaAgenda(t.task_id);
      if (item.clientId === t.client_id) projetoId = item.projeto.id;
    } catch {
      // Item apagado: o criativo vai para Arquivos sem projeto.
    }
  }
  const nomeBase = texto(corpo.nome, 120) || "Criativo de anúncio";
  const total = ultimas.length;
  const ehCarrossel = total > 1;
  let paiId: string | null = null;
  const rodada = Math.max(1, Number(t.entrega_rodada) || 1);
  const fileIds: string[] = [];
  const arquivos: EntregaAnuncio["arquivos"] = [];
  let semRecorte = false;

  for (let i = 0; i < total; i++) {
    const { card, versao } = ultimas[i];
    const quadro = quadroDoCard(t, card);
    const formato = quadro.formato ?? "feed_4x5";
    const chave = `estudio-arte:${t.id}:ads:r${rodada}:${card.ordem}`;
    const { data: existente } = await servico().from("files").select("id, client_id, storage_path").eq("idempotency_key", chave).maybeSingle();
    const ja = existente as { id: string; client_id: string; storage_path: string | null } | null;
    if (ja) {
      if (ja.client_id !== t.client_id) throw new ErroEstudio(409, "chave_de_arquivo_em_uso", "O registro deste envio pertence a outro cliente.");
      fileIds.push(ja.id);
      if (i === 0) paiId = ja.id;
      arquivos.push({ ordem: card.ordem, versao: versao!.versao, file_id: ja.id, storage_path: ja.storage_path, formato, largura: null, altura: null });
      continue;
    }

    const lamina = await laminaFinal(versao!.storage_path, quadro.final);
    if (!lamina.redimensionada) semRecorte = true;
    const fileId = crypto.randomUUID();
    const nome = ehCarrossel && i > 0 ? `${nomeBase} ${quadro.proporcao} (${i + 1}/${total})` : `${nomeBase} ${quadro.proporcao}`;
    const grupo: string = paiId ?? fileId;
    const caminho = `${t.client_id}/${grupo}/v1/${i + 1}-${nomeSeguro(nome)}.png`;
    const { error: erroUpload } = await ch.doChamador.storage
      .from("files")
      .upload(caminho, new Blob([new Uint8Array(lamina.bytes)], { type: "image/png" }), { contentType: "image/png", upsert: false });
    if (erroUpload) {
      throw new ErroEstudio(503, "envio_de_arquivo_falhou", "Não foi possível enviar o criativo para Arquivos. Tente entregar de novo.", {
        card: card.ordem,
        detalhe: erroUpload.message,
      });
    }
    const { data: registro, error: erroRegistro } = await ch.doChamador.rpc("create_file_record", {
      p_file: {
        id: fileId,
        client_id: t.client_id,
        file_name: nome,
        file_url: `files://${caminho}`,
        file_type: ehCarrossel ? "carrossel" : formato === "stories_9x16" ? "story" : "post",
        mime_type: "image/png",
        extension: "png",
        storage_bucket: "files",
        storage_path: caminho,
        size_bytes: lamina.bytes.byteLength,
        sha256: await sha256Hex(lamina.bytes),
        folder: "criativos",
        project_id: projetoId,
        status: "ready",
        version: 1,
        description: texto(`Criativo de anúncio do Estúdio Ads (${TAMANHO_DO_FORMATO[formato].rotulo}). ${t.direcao.conceito}`, 1000),
        parent_file_id: ehCarrossel && i > 0 ? paiId : null,
        idempotency_key: chave,
      },
    });
    if (erroRegistro || !registro) {
      await ch.doChamador.storage.from("files").remove([caminho]).catch(() => {});
      throw new ErroEstudio(503, "registro_de_arquivo_falhou", "O criativo subiu, mas o registro em Arquivos falhou. Tente entregar de novo.", {
        card: card.ordem,
        detalhe: erroRegistro?.message ?? null,
      });
    }
    const id: string = (registro as { id: string }).id;
    fileIds.push(id);
    if (i === 0) paiId = id;
    arquivos.push({ ordem: card.ordem, versao: versao!.versao, file_id: id, storage_path: caminho, formato, largura: lamina.largura, altura: lamina.altura });
  }

  const entrega: EntregaAnuncio = { file_ids: fileIds, arquivos, project_id: projetoId, entregue_em: new Date().toISOString() };
  const gravado = await mutarTrabalho(t.id, (x) => ({ status: "entregue", direcao: { ...x.direcao, entrega_ads: entrega } }));
  return json({
    trabalho_id: t.id,
    status: gravado.status,
    tipo: "anuncio",
    project_id: projetoId,
    file_ids: fileIds,
    arquivos,
    aviso: semRecorte
      ? "A transformação de imagem do Storage não respondeu: parte dos criativos foi entregue no tamanho gerado."
      : null,
  });
}

// ------------------------------------------------------------ referencias

const HOST_PINTEREST = /(^|\.)pinterest\.[a-z.]{2,8}$/i;
const HOST_IMAGEM_PINTEREST = /(^|\.)pinimg\.com$/i;

function hostPermitido(url: URL, imagem = false): boolean {
  if (url.protocol !== "https:") return false;
  if (imagem) return HOST_IMAGEM_PINTEREST.test(url.hostname);
  return HOST_PINTEREST.test(url.hostname) || url.hostname.toLowerCase() === "pin.it";
}

/** Busca seguindo redirecionamentos na mao, conferindo o host a cada salto. */
async function buscarPinterest(inicial: URL, imagem: boolean): Promise<{ res: Response; url: URL }> {
  let url = inicial;
  for (let salto = 0; salto < 5; salto++) {
    if (!hostPermitido(url, imagem)) throw new ErroEstudio(400, "link_fora_do_pinterest", "O link precisa ser de um pin do Pinterest.");
    let res: Response;
    try {
      res = await fetch(url, {
        redirect: "manual",
        headers: { "User-Agent": "Mozilla/5.0 (compatible; AceleriqEstudio/1.0)", "Accept-Language": "pt-BR,pt;q=0.9" },
        signal: AbortSignal.timeout(TIMEOUT_PINTEREST_MS),
      });
    } catch {
      throw new ErroEstudio(504, "pinterest_indisponivel", "O Pinterest não respondeu a tempo.");
    }
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      await res.body?.cancel().catch(() => {});
      url = new URL(res.headers.get("location")!, url);
      continue;
    }
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      throw new ErroEstudio(502, "pinterest_recusou", `O Pinterest respondeu ${res.status}.`);
    }
    return { res, url };
  }
  throw new ErroEstudio(502, "pinterest_redirecionou_demais", "O link do Pinterest redirecionou vezes demais.");
}

function ogImage(html: string): string | null {
  const metas = html.match(/<meta\b[^>]*>/gi) ?? [];
  for (const nome of ["og:image:secure_url", "og:image"]) {
    for (const m of metas) {
      const prop = m.match(/\b(?:property|name)\s*=\s*["']([^"']+)["']/i)?.[1];
      if (prop?.toLowerCase() !== nome) continue;
      const conteudo = m.match(/\bcontent\s*=\s*["']([^"']+)["']/i)?.[1];
      if (conteudo) return conteudo.replace(/&amp;/g, "&");
    }
  }
  return null;
}

const urlCanonica = (u: URL) => `https://${u.hostname.toLowerCase()}${u.pathname.replace(/\/+$/, "")}`;

async function referenciaPorUrl(clientId: string, url: string) {
  const { data } = await servico().from("cliente_referencias").select("*").eq("client_id", clientId).eq("url_origem", url).maybeSingle();
  return data as Referencia | null;
}

async function importarPinterest(ch: Chamador, corpo: Record<string, unknown>) {
  const clientId = texto(corpo.client_id, 64);
  await garantirAcesso(ch, clientId);
  let entrada: URL;
  try {
    entrada = new URL(texto(corpo.url, 1000));
  } catch {
    throw new ErroEstudio(400, "link_invalido", "Cole o link de um pin do Pinterest.");
  }
  if (!hostPermitido(entrada)) throw new ErroEstudio(400, "link_fora_do_pinterest", "O link precisa ser de um pin do Pinterest.");
  const jaTinha = await referenciaPorUrl(clientId, urlCanonica(entrada));
  if (jaTinha) return json({ referencia: jaTinha, ja_existia: true });

  const pagina = await buscarPinterest(entrada, false);
  const html = (await pagina.res.text()).slice(0, 2_000_000);
  const canonica = urlCanonica(pagina.url);
  const jaTinhaFinal = await referenciaPorUrl(clientId, canonica);
  if (jaTinhaFinal) return json({ referencia: jaTinhaFinal, ja_existia: true });

  const og = ogImage(html);
  if (!og) throw new ErroEstudio(422, "pin_sem_imagem", "Não achei a imagem deste pin.");
  let urlImagem: URL;
  try {
    urlImagem = new URL(og, pagina.url);
  } catch {
    throw new ErroEstudio(422, "pin_sem_imagem", "Não achei a imagem deste pin.");
  }
  const imagem = await buscarPinterest(urlImagem, true);
  const bytes = new Uint8Array(await imagem.res.arrayBuffer());
  if (bytes.byteLength > MAX_BYTES_IMAGEM) throw new ErroEstudio(413, "imagem_grande_demais", "A imagem do pin é grande demais.");
  const mime = mimeDe(bytes);
  if (!mime) throw new ErroEstudio(415, "imagem_invalida", "O arquivo do pin não é uma imagem reconhecida.");

  const id = crypto.randomUUID();
  const caminho = `${clientId}/referencias/pinterest-${id}.${extensaoDe(mime)}`;
  const { error: erroUpload } = await servico().storage.from("mesa").upload(caminho, new Blob([new Uint8Array(bytes)], { type: mime }), { contentType: mime });
  if (erroUpload) throw new ErroEstudio(503, "armazenamento_falhou", "Não foi possível guardar a imagem do pin.");

  const { data, error } = await servico()
    .from("cliente_referencias")
    // Com a marca escolhida no topo (ex.: CME), o pin entra como referência dela.
    .insert({ id, client_id: clientId, origem: "pinterest", url_origem: canonica, storage_path: caminho, ativa: true, ...marcaParaGravar(await marcaDe(clientId, { marca_id: corpo.marca_id })) })
    .select("*")
    .single();
  if (error) {
    await servico().storage.from("mesa").remove([caminho]).catch(() => {});
    // Corrida com outra importacao do mesmo pin: devolve a que ficou.
    const outra = await referenciaPorUrl(clientId, canonica);
    if (outra) return json({ referencia: outra, ja_existia: true });
    throw new ErroEstudio(503, "gravacao_falhou", "Não foi possível criar a referência.");
  }
  return json({ referencia: data, ja_existia: false });
}

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

async function sincronizarWorkspace(ch: Chamador, corpo: Record<string, unknown>) {
  const clientId = texto(corpo.client_id, 64);
  await garantirAcesso(ch, clientId);
  const { data, error } = await servico()
    .from("workspace_nodes")
    .select("id, parent_id, kind, name, mime, storage_path")
    .eq("client_id", clientId)
    .limit(5000);
  if (error) throw new ErroEstudio(503, "workspace_indisponivel", "Não foi possível ler o workspace do cliente.");
  const nos = (data as { id: string; parent_id: string | null; kind: string; name: string; mime: string | null; storage_path: string | null }[] | null) ?? [];

  // Pastas cujo nome contem "refer" (sem caixa e sem acento) e tudo abaixo delas.
  const filhos = new Map<string, typeof nos>();
  for (const n of nos) {
    if (!n.parent_id) continue;
    const lista = filhos.get(n.parent_id) ?? [];
    lista.push(n);
    filhos.set(n.parent_id, lista);
  }
  const pastas = nos.filter((n) => n.kind === "folder" && semAcento(n.name).includes("refer"));
  const imagens = new Map<string, (typeof nos)[number]>();
  const visitadas = new Set<string>();
  const fila = pastas.map((p) => p.id);
  while (fila.length) {
    const id = fila.shift()!;
    if (visitadas.has(id)) continue;
    visitadas.add(id);
    for (const f of filhos.get(id) ?? []) {
      if (f.kind === "folder") fila.push(f.id);
      else if (f.storage_path && (f.mime ?? "").startsWith("image/")) imagens.set(f.id, f);
    }
  }
  if (!imagens.size) return json({ pastas: pastas.length, imagens: 0, novas: 0 });

  // So liga: a imagem continua morando no workspace (storage_path nulo).
  const linhas = [...imagens.values()].map((n) => ({ client_id: clientId, origem: "workspace", workspace_node_id: n.id, ativa: true }));
  const { data: novas, error: erroInsert } = await servico()
    .from("cliente_referencias")
    .upsert(linhas, { onConflict: "client_id,workspace_node_id", ignoreDuplicates: true })
    .select("id");
  if (erroInsert) throw new ErroEstudio(503, "gravacao_falhou", "Não foi possível ligar as referências do workspace.");
  return json({ pastas: pastas.length, imagens: imagens.size, novas: (novas as unknown[] | null)?.length ?? 0 });
}

const ESQUEMA_LER = {
  nome: "leitura_de_referencia",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["leitura", "tags"],
    properties: {
      leitura: { type: "string" },
      tags: { type: "array", items: { type: "string" } },
    },
  },
};

const SISTEMA_LER = `Você é o leitor de referências visuais de um estúdio de direção de arte. Descreva a TÉCNICA da peça, não o assunto, para outro diretor reaproveitar sem copiar:
- leitura: em até 8 frases, composição e grid, hierarquia, tipografia (estilo, peso, caixa, escala), profundidade e planos, enquadramento e recortes, espaçamento e ritmo, luz e cor, integração entre fotografia e elementos gráficos.
- tags: de 3 a 8 palavras curtas em português (ex.: "tipografia gigante", "recorte", "fundo chapado").
Escreva sem travessão.`;

async function lerReferencia(ch: Chamador, corpo: Record<string, unknown>) {
  const id = texto(corpo.referencia_id, 64);
  if (!UUID.test(id)) throw new ErroEstudio(400, "referencia_invalida", "Referência inválida.");
  const { data } = await servico()
    .from("cliente_referencias")
    .select("id, client_id, origem, workspace_node_id, url_origem, storage_path, file_id, papel, leitura, tags")
    .eq("id", id)
    .maybeSingle();
  const ref = data as Referencia | null;
  if (!ref) throw new ErroEstudio(404, "referencia_inexistente", "Referência não encontrada.");
  await garantirAcesso(ch, ref.client_id);
  const imagem = await imagemDaReferencia(ref);
  if (imagem.mime === "image/gif") throw new ErroEstudio(415, "imagem_invalida", "GIF não pode ser lido. Use PNG, JPG ou WEBP.");
  const leitor = await modeloDoPapel("leitura");
  // Custo na carteira do cliente da referencia.
  const r = await chamarTexto({
    clientId: ref.client_id,
    tarefa: "leitura_referencia",
    agente: "leitor",
    modeloId: leitor.id,
    sistema: SISTEMA_LER,
    mensagens: [{ papel: "usuario", conteudo: "Leia a técnica desta referência.", imagens: [imagem] }],
    esquemaJson: ESQUEMA_LER,
    maxTokensSaida: 6_000,
    referencia: { tipo: "cliente_referencia", id: ref.id },
    criadoPor: ch.userId,
  });
  const l = (r.json ?? {}) as { leitura?: string; tags?: unknown };
  const leitura = texto(l.leitura, 3000);
  if (!leitura) throw new ErroEstudio(502, "leitura_vazia", "O leitor não descreveu a referência. Tente de novo.");
  const tags = Array.isArray(l.tags) ? (l.tags as unknown[]).map((x) => texto(x, 40)).filter(Boolean).slice(0, 8) : [];
  const { data: atualizada, error } = await servico()
    .from("cliente_referencias")
    .update({ leitura, tags })
    .eq("id", ref.id)
    .eq("client_id", ref.client_id)
    .select("*")
    .single();
  if (error) throw new ErroEstudio(503, "gravacao_falhou", "A leitura foi feita, mas não foi gravada.", { uso_id: r.usoId });
  return json({ referencia: atualizada, custo_usd: r.custoUsd, saldo_usd: r.saldoUsd, reserva_usada: r.reservaUsada ?? null });
}

/**
 * referencias { subacao: "importar_link", client_id, url, marca_id? } (dono,
 * 26/09: "subir uma referência na hora: arrastar, subir ou colar, e ele
 * reconhece"): o link colado vira referência de composição do cliente.
 * Pinterest pelo caminho de sempre; Behance pela maior imagem dos módulos do
 * projeto (ou a capa); link direto de imagem e página com og:image pela imagem
 * de capa. Só https público (sem rede interna), com teto de bytes. Sem custo.
 * Grava com origem "upload" (a restrição da tabela aceita workspace,
 * pinterest, upload e arquivo) e o link em url_origem.
 */
async function importarLink(ch: Chamador, corpo: Record<string, unknown>) {
  const clientId = texto(corpo.client_id, 64);
  await garantirAcesso(ch, clientId);
  const u = urlPublicaSegura(texto(corpo.url, 2000));
  if (!u) throw new ErroEstudio(400, "link_invalido", "Cole um link https público (Pinterest, Behance ou endereço de imagem).");
  const tipo = tipoDoLink(u);
  if (tipo === "pinterest") return await importarPinterest(ch, { ...corpo, client_id: clientId, url: u.toString() });
  const canonica = urlCanonica(u);
  const jaTinha = await referenciaPorUrl(clientId, canonica);
  if (jaTinha) return json({ referencia: jaTinha, ja_existia: true, origem: tipo });

  let bytes: Uint8Array | null = null;
  let achada: string | null = null;
  const imagemDe = async (url: string) => {
    const seguro = urlPublicaSegura(url);
    if (!seguro) return null;
    const b = await buscarLinkSeguro(seguro, MAX_BYTES_IMAGEM, "image/webp,image/png,image/jpeg;q=0.9,image/*;q=0.5");
    return b && mimeDe(b.bytes) && mimeDe(b.bytes) !== "image/gif" ? b.bytes : null;
  };
  if (tipo === "imagem") {
    bytes = await imagemDe(u.toString());
    achada = u.toString();
  }
  if (!bytes) {
    // Página (Behance ou site): a imagem vem dos módulos do projeto ou do og:image.
    const pagina = await buscarLinkSeguro(u, 2 * 1024 * 1024, "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5", true);
    if (pagina && mimeDe(pagina.bytes)) {
      bytes = mimeDe(pagina.bytes) === "image/gif" ? null : pagina.bytes;
      achada = pagina.url.toString();
    } else if (pagina) {
      const html = new TextDecoder().decode(pagina.bytes);
      const candidatas = [...(tipo === "behance" ? imagensDoBehance(html, 3) : []), ...lerMetaTags(html, pagina.url.toString()).imagens].slice(0, 4);
      for (const c of candidatas) {
        bytes = await imagemDe(c);
        if (bytes) {
          achada = c;
          break;
        }
      }
    }
  }
  if (!bytes) {
    throw new ErroEstudio(
      422,
      "link_sem_imagem",
      tipo === "behance"
        ? "O Behance não liberou a imagem deste projeto. Abra a imagem, copie o endereço dela (botão direito, Copiar endereço da imagem) e cole aqui, ou arraste a imagem."
        : tipo === "instagram"
        ? "O Instagram não libera a imagem sem login. Tire um print e cole com Ctrl+V ou arraste a imagem."
        : "Não achei uma imagem neste link. Cole o endereço da imagem, arraste o arquivo ou cole um print com Ctrl+V.",
    );
  }
  if (bytes.byteLength > MAX_BYTES_IMAGEM) throw new ErroEstudio(413, "imagem_grande_demais", "A imagem do link é grande demais.");
  const mime = mimeDe(bytes);
  if (!mime) throw new ErroEstudio(415, "imagem_invalida", "O link não trouxe uma imagem reconhecida (use JPG, PNG ou WEBP).");
  const id = crypto.randomUUID();
  const caminho = `${clientId}/referencias/link-${id}.${extensaoDe(mime)}`;
  const { error: erroUpload } = await servico().storage.from("mesa").upload(caminho, new Blob([new Uint8Array(bytes)], { type: mime }), { contentType: mime });
  if (erroUpload) throw new ErroEstudio(503, "armazenamento_falhou", "Não foi possível guardar a imagem do link.");
  const { data, error } = await servico()
    .from("cliente_referencias")
    .insert({ id, client_id: clientId, origem: "upload", url_origem: canonica, storage_path: caminho, papel: "tecnica", ativa: true, ...marcaParaGravar(await marcaDe(clientId, { marca_id: corpo.marca_id })) })
    .select("*")
    .single();
  if (error) {
    await servico().storage.from("mesa").remove([caminho]).catch(() => {});
    const outra = await referenciaPorUrl(clientId, canonica);
    if (outra) return json({ referencia: outra, ja_existia: true, origem: tipo });
    throw new ErroEstudio(503, "gravacao_falhou", "Não foi possível criar a referência.");
  }
  return json({ referencia: data, ja_existia: false, origem: tipo, imagem_de: achada });
}

/** GET de um link público com redirecionamento conferido a cada salto (só https público), tempo e teto de bytes. */
async function buscarLinkSeguro(inicial: URL, maxBytes: number, aceitar: string, cortar = false): Promise<{ url: URL; bytes: Uint8Array } | null> {
  let url: URL | null = inicial;
  for (let salto = 0; url && salto < 5; salto++) {
    if (!(await hostResolvePublico(url.hostname))) return null;
    let res: Response;
    try {
      res = await fetch(url, {
        redirect: "manual",
        headers: { "User-Agent": "Mozilla/5.0 (compatible; AceleriqEstudio/1.0)", "Accept-Language": "pt-BR,pt;q=0.9", Accept: aceitar },
        signal: AbortSignal.timeout(TIMEOUT_PINTEREST_MS),
      });
    } catch {
      return null;
    }
    if (res.status >= 300 && res.status < 400) {
      const destino = res.headers.get("location");
      await res.body?.cancel().catch(() => {});
      if (!destino) return null;
      try {
        url = urlPublicaSegura(new URL(destino, url).toString());
      } catch {
        return null;
      }
      continue;
    }
    if (!res.ok || !res.body) {
      await res.body?.cancel().catch(() => {});
      return null;
    }
    const partes: Uint8Array[] = [];
    let total = 0;
    const leitor = res.body.getReader();
    try {
      for (;;) {
        const { done, value } = await leitor.read();
        if (done) break;
        if (total + value.byteLength > maxBytes) {
          await leitor.cancel().catch(() => {});
          if (!cortar) return null;
          partes.push(value.slice(0, maxBytes - total));
          total = maxBytes;
          break;
        }
        partes.push(value);
        total += value.byteLength;
      }
    } catch {
      return null;
    }
    const bytes = new Uint8Array(total);
    let pos = 0;
    for (const p of partes) {
      bytes.set(p, pos);
      pos += p.byteLength;
    }
    return { url, bytes };
  }
  return null;
}

async function referencias(ch: Chamador, corpo: Record<string, unknown>) {
  const sub = String(corpo.subacao ?? "");
  if (sub === "importar_pinterest") return await importarPinterest(ch, corpo);
  if (sub === "importar_link") return await importarLink(ch, corpo);
  if (sub === "sincronizar_workspace") return await sincronizarWorkspace(ch, corpo);
  if (sub === "ler") return await lerReferencia(ch, corpo);
  throw new ErroEstudio(400, "subacao_desconhecida", "Subação de referências desconhecida.", {
    aceitas: ["importar_pinterest", "importar_link", "sincronizar_workspace", "ler"],
  });
}

// ------------------------------------------------------------- configurar

const ID_REFERENCIA = /^(g:)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function idsDeReferencia(v: unknown): string[] | undefined {
  if (v === undefined) return undefined;
  if (!Array.isArray(v)) throw new ErroEstudio(400, "referencias_invalidas", "Referências em formato inválido.");
  return [...new Set(v.map((x) => texto(x, 80)).filter((x) => ID_REFERENCIA.test(x)))].slice(0, 4);
}

/** Fotos trazidas pela equipe: só do bucket mesa deste cliente, 1 fundo e até 2 elementos. */
function lerFotosLivres(v: unknown, clientId: string): FotoLivre[] {
  if (!Array.isArray(v)) throw new ErroEstudio(400, "fotos_invalidas", "Fotos em formato inválido.");
  const saida: FotoLivre[] = [];
  for (const bruto of v.slice(0, 6)) {
    const o = (bruto ?? {}) as Record<string, unknown>;
    const caminho = texto(o.caminho, 300);
    const papel = o.papel === "fundo" ? "fundo" : o.papel === "elemento" ? "elemento" : null;
    if (!papel || !caminho.startsWith(`${clientId}/`) || caminho.indexOf("..") >= 0) {
      throw new ErroEstudio(400, "foto_invalida", "Foto fora da pasta deste cliente ou sem papel (fundo ou elemento).");
    }
    if (papel === "fundo" && saida.some((f) => f.papel === "fundo")) continue;
    if (papel === "elemento" && saida.filter((f) => f.papel === "elemento").length >= 2) continue;
    const nota = texto(o.nota, 200);
    saida.push(nota ? { caminho, papel, nota } : { caminho, papel });
    // Pessoa ou produto sem fundo (Tirar fundo no Estúdio): entra pelo modo recorte.
    if (papel === "elemento" && o.recortada === true) saida[saida.length - 1].recortada = true;
  }
  return saida;
}

/**
 * configurar { trabalho_id, conjunto?, card? }: escolhas da tela, sem custo.
 * Conjunto: referências, carrossel contínuo, formato e a logo do kit
 * (logo_escolhida: auto, principal ou alternativa). Lâmina: fotos reais do
 * acervo, referências próprias, a logo (logo; null volta para a do conjunto)
 * e o texto exato (os blocos acompanham o texto).
 */
async function configurar(ch: Chamador, corpo: Record<string, unknown>) {
  const t = await trabalhoComAcesso(ch, texto(corpo.trabalho_id, 64));
  if (estaEntregue(t)) {
    throw erroTrabalhoEntregue();
  }
  const conjunto = (corpo.conjunto && typeof corpo.conjunto === "object" ? corpo.conjunto : null) as Record<string, unknown> | null;
  const cardPedido = (corpo.card && typeof corpo.card === "object" ? corpo.card : null) as Record<string, unknown> | null;
  if (!conjunto && !cardPedido) throw new ErroEstudio(400, "nada_para_configurar", "Nada para mudar.");

  const refsConjunto = conjunto ? idsDeReferencia(conjunto.referencias_ids) : undefined;
  // Logo do kit para o conjunto (null ou "auto": a que contrasta com o fundo).
  let logoConjunto: EscolhaDaLogo | undefined;
  if (conjunto && conjunto.logo_escolhida !== undefined) {
    const e = conjunto.logo_escolhida === null ? "auto" : escolhaDaLogo(conjunto.logo_escolhida);
    if (!e) throw new ErroEstudio(400, "logo_invalida", "Logo inválida. Use auto, principal ou alternativa.");
    logoConjunto = e;
  }
  const infinito = conjunto && typeof conjunto.carrossel_infinito === "boolean" ? conjunto.carrossel_infinito : undefined;
  // Formato do post orgânico (4:5, 3:4, 1:1 ou 9:16), para o conjunto inteiro. O anúncio tem formato por card.
  let formatoNovo: FormatoDoPost | undefined;
  if (conjunto && conjunto.formato !== undefined) {
    if (ehAds(t)) throw new ErroEstudio(409, "formato_do_anuncio", "O formato do criativo de anúncio é escolhido na Mesa Ads.");
    if (FORMATOS_DO_POST.indexOf(conjunto.formato as FormatoDoPost) < 0) {
      throw new ErroEstudio(400, "formato_invalido", `Formato inválido. Use: ${FORMATOS_DO_POST.join(", ")}.`);
    }
    formatoNovo = conjunto.formato as FormatoDoPost;
  }

  let ordem: number | null = null;
  let imagens: string[] | undefined;
  let refsCard: string[] | undefined;
  let novoTexto: string | undefined;
  let fotosLivres: FotoLivre[] | undefined;
  // Logo da lâmina: null tira a escolha (a lâmina segue a do conjunto).
  let logoCard: EscolhaDaLogo | null | undefined;
  if (cardPedido) {
    ordem = lerOrdem(cardPedido);
    cardDaDirecao(t, ordem);
    if (cardPedido.imagens_ids !== undefined) {
      if (!Array.isArray(cardPedido.imagens_ids)) throw new ErroEstudio(400, "imagens_invalidas", "Fotos em formato inválido.");
      // Só fotos do acervo deste cliente.
      imagens = (await imagensDoAcervo(t.client_id, (cardPedido.imagens_ids as unknown[]).map((x) => texto(x, 64)))).map((a) => a.id).slice(0, 1);
    }
    refsCard = idsDeReferencia(cardPedido.referencias_ids);
    if (cardPedido.fotos_livres !== undefined) fotosLivres = lerFotosLivres(cardPedido.fotos_livres, t.client_id);
    if (cardPedido.logo !== undefined) {
      logoCard = cardPedido.logo === null ? null : escolhaDaLogo(cardPedido.logo);
      if (cardPedido.logo !== null && !logoCard) throw new ErroEstudio(400, "logo_invalida", "Logo inválida. Use auto, principal ou alternativa.");
    }
    if (cardPedido.texto_exato !== undefined) {
      novoTexto = texto(cardPedido.texto_exato, 1200);
      if (!novoTexto) throw new ErroEstudio(400, "texto_vazio", "O texto da lâmina não pode ficar vazio.");
    }
  }

  const gravado = await mutarTrabalho(t.id, (x) => {
    const cards = x.direcao.cards.map((c) => {
      if (c.ordem !== ordem) return c;
      const mudou: CardDirecao = { ...c };
      if (imagens !== undefined) mudou.imagens_ids = imagens;
      if (refsCard !== undefined) mudou.referencias_ids = refsCard;
      if (fotosLivres !== undefined) mudou.fotos_livres = fotosLivres;
      if (logoCard === null) delete mudou.logo;
      else if (logoCard !== undefined) mudou.logo = logoCard;
      if (novoTexto !== undefined && novoTexto !== c.texto_exato) {
        mudou.texto_exato = novoTexto;
        mudou.blocos = blocosDoTexto(novoTexto, c.funcao);
      }
      return mudou;
    });
    return {
      direcao: {
        ...x.direcao,
        cards,
        ...(refsConjunto !== undefined ? { referencias_ids: refsConjunto } : {}),
        // Ligar, desligar ou pedir para refazer apaga o panorama (e sobe a geração:
        // um trecho que termina depois é descartado): o próximo gerar faz outro.
        ...(infinito !== undefined ? { carrossel_infinito: infinito && cards.length > 1 && !ehAds(x), panorama: panoramaApagado(x.direcao.panorama) } : {}),
        ...(conjunto && conjunto.refazer_fundo === true ? { panorama: panoramaApagado(x.direcao.panorama) } : {}),
        // Formato novo: as lâminas já geradas ficam nas versões; a entrega pede gerar de novo as que não estão nele.
        ...(formatoNovo !== undefined ? { formato: formatoNovo } : {}),
        // Logo do kit escolhida para o conjunto: vale na próxima geração (as versões ficam).
        ...(logoConjunto !== undefined ? { logo_escolhida: logoConjunto } : {}),
      },
    };
  });
  return json({ trabalho: gravado });
}

// ------------------------------------------------------------- reabrir

/**
 * reabrir { trabalho_id, motivo? } (pedido do dono em 25/09: "trabalho já foi
 * entregue, foi reprovado: tem que ter a opção de refazer, corrigir"): o
 * trabalho entregue (ou agendado) volta para edição no mesmo lugar, com as
 * mesmas lâminas e todas as versões; a próxima entrega sobe a rodada e vira
 * arquivo novo em Arquivos (a entrega anterior fica lá e no histórico
 * direcao.reaberturas). Sem custo. Reprovado continua marcado reprovado (o
 * pedido do cliente aparece na tela); aprovado, agendado ou aguardando volta a
 * "sem envio": a arte nova passa de novo pela aprovação. O post já agendado
 * na Agenda continua com a arte anterior até a nova ser aprovada.
 */
async function reabrir(ch: Chamador, corpo: Record<string, unknown>) {
  const t = await trabalhoComAcesso(ch, texto(corpo.trabalho_id, 64));
  if (!estaEntregue(t)) return json({ trabalho: t, ja_aberto: true, custo_usd: 0 });
  const motivo = texto(corpo.motivo, 1000) || null;
  const agendado = t.entrega_status === "agendado" || t.entrega_status === "aprovado";
  const gravado = await mutarTrabalho(t.id, (x) => {
    const rodada = Math.max(1, Number(x.entrega_rodada) || 1);
    const historico: Reabertura = {
      em: new Date().toISOString(),
      por: ch.userId,
      motivo,
      rodada_anterior: rodada,
      file_ids: ehAds(x) ? (x.direcao.entrega_ads?.file_ids ?? []) : x.file_ids ?? [],
      entrega_status: x.entrega_status ?? null,
      versoes: x.direcao.cards.map((c) => ({ ordem: c.ordem, versao: versaoAtual(x, c.ordem)?.versao ?? 0 })),
    };
    const completo = x.direcao.cards.length > 0 && x.direcao.cards.every((c) => x.cards.some((v) => v.ordem === c.ordem));
    return {
      status: completo ? "pronto" : x.cards.length ? "gerando" : "dirigido",
      entrega_rodada: rodada + 1,
      entrega_status: x.entrega_status === "reprovado" ? "reprovado" : null,
      ...(motivo ? { entrega_aviso: motivo } : {}),
      direcao: {
        ...x.direcao,
        reaberturas: [...(x.direcao.reaberturas ?? []), historico].slice(-20),
        // O criativo de anúncio entrega de novo com a rodada nova (a chave de idempotência muda).
        ...(ehAds(x) ? { entrega_ads: null } : {}),
      },
    };
  });
  return json({
    trabalho: gravado,
    reaberto: true,
    rodada: Math.max(1, Number(gravado.entrega_rodada) || 1),
    aviso: agendado
      ? "O post já aprovado continua na Agenda com a arte anterior até a nova ser entregue e aprovada."
      : null,
    custo_usd: 0,
  });
}

// ------------------------------------------------ conversa com o diretor

/**
 * Conversa do diretor de arte com a equipe dentro do Estúdio (pedido do dono
 * em 24/09). Uma conversa por trabalho em agente_conversas (agente
 * diretor_arte, referencia_tipo 'estudio_trabalho', referencia_id = id do
 * trabalho), lida direto pela tela. estudio_trabalhos.conversa_id continua
 * vazio de propósito: o CardDoEstudio lê os pedidos de ajuste por ele.
 */
const REFERENCIA_DA_CONVERSA = "estudio_trabalho";
const MAX_HISTORICO_CONVERSA = 12;

type ResultadoDaAplicacao = { direcao: Direcao; afetadas: number[]; fundoApagado: boolean; textoMudou: number[] };

type LinhaDaMensagem = { id: string; conversa_id: string; client_id: string; papel: string; conteudo: string; anexos: unknown; criado_em: string };

/** Conversa do trabalho (a mais recente); com `criar`, abre uma se não houver. */
async function conversaDoTrabalho(t: Trabalho, criadoPor: string | null, criar: boolean): Promise<string | null> {
  const { data, error } = await servico()
    .from("agente_conversas")
    .select("id")
    .eq("client_id", t.client_id)
    .eq("agente", "diretor_arte")
    .eq("referencia_tipo", REFERENCIA_DA_CONVERSA)
    .eq("referencia_id", t.id)
    .order("criado_em", { ascending: false })
    .limit(1);
  if (error) throw new ErroEstudio(503, "conversa_indisponivel", "Não foi possível ler a conversa com o diretor.");
  const achada = ((data as { id: string }[] | null) ?? [])[0];
  if (achada) return achada.id;
  if (!criar) return null;
  const { data: nova, error: erroNova } = await servico()
    .from("agente_conversas")
    .insert({ client_id: t.client_id, agente: "diretor_arte", referencia_tipo: REFERENCIA_DA_CONVERSA, referencia_id: t.id, criado_por: criadoPor })
    .select("id")
    .single();
  if (erroNova || !nova) throw new ErroEstudio(503, "conversa_nao_criada", "Não foi possível abrir a conversa com o diretor.");
  return (nova as { id: string }).id;
}

/** Grava mensagens em ordem (criado_em crescente) e devolve os ids na mesma ordem. */
async function gravarMensagens(
  conversaId: string,
  clientId: string,
  msgs: { papel: "usuario" | "agente" | "sistema"; conteudo: string; anexos?: unknown[]; uso_id?: string | null }[],
): Promise<string[]> {
  const base = Date.now();
  const linhas = msgs.map((m, i) => ({
    conversa_id: conversaId,
    client_id: clientId,
    criado_em: new Date(base + i).toISOString(),
    papel: m.papel,
    conteudo: m.conteudo.slice(0, 20000),
    anexos: m.anexos ?? [],
    uso_id: m.uso_id || null,
  }));
  const { data, error } = await servico().from("agente_mensagens").insert(linhas).select("id, criado_em");
  if (error) {
    // A resposta já foi cobrada: a tela recebe a resposta mesmo sem o histórico gravado.
    console.error("estudio-arte: mensagens nao gravadas", { conversa_id: conversaId, code: error.code });
    return [];
  }
  return ((data as { id: string; criado_em: string }[] | null) ?? [])
    .slice()
    .sort((a, b) => (a.criado_em < b.criado_em ? -1 : 1))
    .map((m) => m.id);
}

/** Resumo curto da última conferência, para o diretor saber o que está errado na arte. */
function resumoDaConferencia(v: VersaoCard | null): Record<string, unknown> | null {
  if (!v) return null;
  const c = v.verificacao as Verificacao | VerificacaoPendente;
  if (!c || (c as VerificacaoPendente).pendente) return { pendente: true };
  const ver = c as Verificacao;
  const nota = (n: NotaJev | null | undefined) => (n && "nota" in n ? n.nivel : null);
  return {
    ortografia_ok: ver.ortografia_ok,
    faltando: ver.faltando?.slice(0, 8) ?? [],
    sobrando: ver.sobrando?.slice(0, 8) ?? [],
    logo_ok: ver.logo_ok ?? null,
    identidade: nota(ver.identidade),
    descricao_visual: texto(ver.descricao_visual, 400) || null,
    motivos_da_autocorrecao: ver.autocorrecao?.precisa ? ver.autocorrecao.motivos : [],
  };
}

/** Lâminas em que o texto vai direto na cena (sem caixa): foto real, contínuo ou regra da marca. */
function laminasSemCaixa(t: Trabalho, kit: Kit): Set<number> {
  const todas = regraProibeCaixa(kit?.regras);
  const continuo = !ehAds(t) && !!t.direcao.carrossel_infinito && totalCards(t) > 1;
  const saida = new Set<number>();
  for (const c of t.direcao.cards) {
    const fotoReal = !!c.imagens_ids?.length || (c.fotos_livres ?? []).some((f) => f.papel === "fundo");
    if (todas || fotoReal || continuo) saida.add(c.ordem);
  }
  return saida;
}

function hexDaPaleta(kit: Kit): string[] {
  const p = (kit as { paleta?: unknown } | null)?.paleta;
  return (Array.isArray(p) ? (p as { hex?: string }[]) : [])
    .map((x) => String(x?.hex || "").trim().toUpperCase())
    .filter((h) => /^#[0-9A-F]{6}$/.test(h));
}

/**
 * conversar { trabalho_id, mensagem, ordem? }: o diretor de arte lê o
 * conteúdo inteiro do trabalho (conceito, fio visual, lâminas com texto
 * exato, layout, fotos reais, referências, conferências), a marca e o acervo,
 * olha a versão atual da lâmina em foco (quando o modelo aceita imagem) e
 * responde conversando, com até 6 `mudancas` estruturadas que a equipe aplica
 * com um clique (aplicar_mudancas). Nada muda no trabalho aqui: só a conversa
 * é gravada. O texto exato só entra nas mudanças quando a mensagem pede.
 */
async function conversar(ch: Chamador, corpo: Record<string, unknown>) {
  const t = await trabalhoComAcesso(ch, texto(corpo.trabalho_id, 64));
  const mensagem = limparTexto(corpo.mensagem, 2000);
  if (!mensagem) throw new ErroEstudio(400, "mensagem_vazia", "Escreva o que você quer mudar ou perguntar ao diretor.");
  if (!t.direcao.cards.length) throw new ErroEstudio(409, "trabalho_sem_direcao", "Este trabalho ainda não tem direção de arte. Prepare a direção antes de conversar.");
  const total = totalCards(t);
  const ordemPedida = Number(corpo.ordem);
  const emFoco = Number.isInteger(ordemPedida) && t.direcao.cards.some((c) => c.ordem === ordemPedida) ? ordemPedida : null;
  const textoPodeMudar = pedidoMexeNoTexto(mensagem);

  const conversaExistente = await conversaDoTrabalho(t, ch.userId, false);
  const idsDasFotos = t.direcao.cards.flatMap((c) => c.imagens_ids ?? []);
  const idsDasReferencias = [...new Set([...(t.direcao.referencias_ids ?? []), ...t.direcao.cards.flatMap((c) => c.referencias_ids ?? [])])].slice(0, 12);
  const [kit, fontes, memoria, acervo, fotosEmUso, prompt, refsEscolhidas, refsDoCliente, campanha, item, historico, modelo] = await Promise.all([
    lerKit(t.client_id, t),
    lerFontes(t.client_id, t),
    memoriaDoDiretor(t.client_id),
    lerAcervo(t.client_id, 30),
    imagensDoAcervo(t.client_id, idsDasFotos),
    // Sem o prompt global ativo a conversa ainda ajuda: a base de conhecimento vale.
    promptDoDiretor(t.client_id).catch(() => ""),
    idsDasReferencias.length ? referenciasPorId(t.client_id, idsDasReferencias) : Promise.resolve([] as Referencia[]),
    servico()
      .from("cliente_referencias")
      .select("id, papel, leitura, tags")
      .eq("client_id", t.client_id)
      .eq("ativa", true)
      .not("leitura", "is", null)
      .order("criado_em", { ascending: false })
      .limit(8),
    t.direcao.campanha_id ? lerCampanha(t.client_id, t.direcao.campanha_id) : Promise.resolve(null),
    t.task_id ? lerItemDaAgenda(t.task_id).catch(() => null) : Promise.resolve(null),
    conversaExistente
      ? servico().from("agente_mensagens").select("papel, conteudo, anexos").eq("conversa_id", conversaExistente).order("criado_em", { ascending: false }).limit(MAX_HISTORICO_CONVERSA)
      : Promise.resolve({ data: [] }),
    modeloDoPapel("diretor_arte"),
  ]);
  const marca = await marcaDoCliente(t.client_id, kit, fontes, t);
  const semCaixa = laminasSemCaixa(t, kit);
  const fotoPorId = new Map<string, ImagemAcervo>();
  for (const a of [...acervo, ...fotosEmUso]) fotoPorId.set(a.id, a);

  const laminas = t.direcao.cards.slice().sort((a, b) => a.ordem - b.ordem).map((bruto) => {
    const c = comLayout(bruto, total);
    const versoes = t.cards.filter((v) => v.ordem === c.ordem);
    const atual = versaoAtual(t, c.ordem);
    const ultimoAjuste = versoes.filter((v) => v.origem === "ajuste" && v.instrucao).sort((a, b) => b.versao - a.versao)[0];
    const foto = (c.imagens_ids ?? []).map((id) => fotoPorId.get(id)).find(Boolean);
    return {
      ordem: c.ordem,
      funcao: c.funcao,
      formato: c.formato ?? null,
      texto_exato: c.texto_exato,
      blocos: c.blocos ?? [],
      layout: c.layout,
      evitar: c.evitar || null,
      foto_real: foto ? { id: foto.id, resumo: resumoDaFoto(foto) } : null,
      fotos_da_equipe: (c.fotos_livres ?? []).map((f) => ({ papel: f.papel, nota: f.nota ?? null })),
      referencias_proprias: (c.referencias_ids ?? []).length,
      versoes: versoes.length,
      ultima_conferencia: resumoDaConferencia(atual),
      ultimo_ajuste: ultimoAjuste ? texto(ultimoAjuste.instrucao, 300) : null,
      sem_caixa_atras_do_texto: semCaixa.has(c.ordem),
    };
  });

  // Frente H: o diretor conversa sabendo o que o cliente já ensinou (cérebro) e o dossiê atual.
  const doDiretor = await cerebroEDossieDoDiretor(t.client_id, memoria).catch(() => ({ texto: "", usouCerebro: false }));
  const contexto = {
    tipo: ehAds(t) ? "criativo de anúncio (Mesa Ads)" : "post da agenda",
    texto_pode_mudar: textoPodeMudar,
    lamina_em_foco: emFoco,
    trabalho: {
      status: t.status,
      conceito: t.direcao.conceito,
      fio_visual: t.direcao.fio_visual ?? null,
      estilo_pedido: t.direcao.estilo_pedido ?? null,
      carrossel_continuo: !ehAds(t) && !!t.direcao.carrossel_infinito && total > 1,
      total_de_laminas: total,
      ultimo_pedido_ao_diretor: t.direcao.pedido ?? null,
      campanha: campanha ? { nome: campanha.nome, conceito: campanha.conceito, identidade: campanha.identidade } : null,
    },
    item: item
      ? {
        titulo: item.tarefa.title,
        formato: item.tarefa.delivery_type,
        roteiro_e_contexto: texto(item.tarefa.description, 3000),
        objetivo_do_post: item.post?.objective ?? null,
        legenda_prevista: texto(item.post?.default_caption, 1200) || null,
      }
      : null,
    laminas,
    marca: {
      nome: marca.nomeCliente,
      paleta: marca.paleta,
      estilo: marca.estilo,
      regras: marca.regras,
      fontes: marca.fontes,
      tipografia_citada: marca.tipografiaCitada,
      tom_de_voz: marca.tomDeVoz,
      tem_logo_oficial: marca.temLogo,
    },
    referencias_escolhidas: refsEscolhidas.map((r) => ({ id: r.id, papel: r.papel ?? null, tecnica: texto(r.leitura, 500) || null })),
    referencias_do_cliente: (((refsDoCliente as { data: unknown }).data as { papel: string; leitura: string; tags: string[] }[] | null) ?? [])
      .map((r) => ({ papel: r.papel === "identidade" ? "arte publicada da marca" : "técnica", tecnica: texto(r.leitura, 400), tags: r.tags })),
    acervo: acervo.map((a) => ({ id: a.id, nome: texto(a.nome, 80), categoria: a.categoria, descricao: texto(a.descricao, 200) || null })),
    // Com o cérebro no sistema, a lista crua da memória não se repete aqui.
    memoria_do_diretor: doDiretor.usouCerebro ? undefined : memoria,
  };

  // A versão atual da lâmina em foco vai junto quando o modelo aceita imagem.
  const aceitaImagem = !modelo.modalidades?.entrada?.length || modelo.modalidades.entrada.indexOf("image") >= 0;
  const versaoEmFoco = emFoco !== null ? versaoAtual(t, emFoco) : null;
  let imagens: ImagemEntrada[] | undefined;
  if (aceitaImagem && versaoEmFoco) {
    try {
      imagens = [await baixarImagem("mesa", versaoEmFoco.storage_path, `lamina-${emFoco}-v${versaoEmFoco.versao}`)];
    } catch {
      imagens = undefined;
    }
  }

  const anteriores = (((historico as { data: unknown }).data as { papel: string; conteudo: string; anexos: unknown }[] | null) ?? [])
    .slice()
    .reverse()
    .filter((m) => m.papel === "usuario" || m.papel === "agente")
    .map((m) => {
      const extra = m.papel === "agente" ? resumoDasPropostas(m.anexos) : "";
      return { papel: m.papel as "usuario" | "agente", conteudo: `${texto(m.conteudo, 2500)}${extra ? `\n${extra}` : ""}` };
    });

  const sistema = [
    CONHECIMENTO_DIRETOR,
    CONHECIMENTO_DA_DIRECAO,
    prompt,
    ehAds(t) ? `${ANATOMIA_DO_ESTATICO}\n\n${POLITICAS_META}\n\n${REGRAS_DE_HONESTIDADE}` : "",
    INSTRUCOES_CONVERSA,
    doDiretor.texto,
  ].filter(Boolean).join("\n\n");
  const pedido = [
    `CONTEÚDO DO TRABALHO (JSON):\n${JSON.stringify(contexto)}`,
    emFoco !== null ? `Lâmina em foco: ${emFoco}${imagens ? " (a imagem anexada é a versão atual dela)" : versaoEmFoco ? "" : " (ainda sem arte gerada)"}.` : "",
    `MENSAGEM DA EQUIPE: ${mensagem}`,
  ].filter(Boolean).join("\n\n");

  const r = await chamarTexto({
    clientId: t.client_id,
    tarefa: "estudio",
    agente: "diretor_arte",
    modeloId: modelo.id,
    raciocinio: raciocinioPara(modelo, ["low", "medium"]),
    sistema,
    mensagens: [...anteriores, { papel: "usuario", conteudo: pedido, imagens }],
    esquemaJson: ESQUEMA_CONVERSA,
    maxTokensSaida: 6_000,
    timeoutMs: 300_000,
    referencia: { tipo: REFERENCIA_DA_CONVERSA, id: t.id },
    criadoPor: ch.userId,
  });
  const bruto = (r.json ?? {}) as Record<string, unknown>;
  const { mudancas, avisos } = normalizarMudancas(bruto.mudancas, {
    ordens: t.direcao.cards.map((c) => c.ordem),
    paleta: hexDaPaleta(kit),
    acervo: new Set(acervo.map((a) => a.id).concat(fotosEmUso.map((a) => a.id))),
    permitirTexto: textoPodeMudar,
    semCaixa,
    continuo: !ehAds(t) && !!t.direcao.carrossel_infinito && total > 1,
  });
  const resposta = limparTexto(bruto.resposta, 4000);
  const memoriaNova = limparTexto(bruto.memoria, 400);
  if (!resposta && !mudancas.length) {
    throw new ErroEstudio(502, "conversa_vazia", "O diretor não respondeu desta vez. Tente de novo ou pergunte de outro jeito.", { uso_id: r.usoId, custo_usd: r.custoUsd });
  }

  const conversaId = conversaExistente ?? await conversaDoTrabalho(t, ch.userId, true);
  const [, mensagemId] = await gravarMensagens(conversaId!, t.client_id, [
    { papel: "usuario", conteudo: mensagem, anexos: [{ tipo: "pedido", em_foco: emFoco }] },
    {
      papel: "agente",
      conteudo: resposta || "Seguem as mudanças que eu sugiro.",
      anexos: [{ tipo: "mudancas", mudancas, avisos, memoria: memoriaNova || null, em_foco: emFoco, aplicadas: [] }],
      uso_id: r.usoId,
    },
  ]);
  await mutarTrabalho(t.id, (x) => ({ custo_usd: arred(num(x.custo_usd) + r.custoUsd) }));

  return json({
    trabalho_id: t.id,
    conversa_id: conversaId,
    mensagem_id: mensagemId ?? null,
    resposta: resposta || "Seguem as mudanças que eu sugiro.",
    mudancas,
    avisos,
    em_foco: emFoco,
    texto_pode_mudar: textoPodeMudar,
    custo_usd: r.custoUsd,
    saldo_usd: r.saldoUsd,
    reserva_usada: r.reservaUsada ?? null,
  });
}

/** Linha curta com as mudanças propostas numa resposta (para o histórico que volta ao diretor). */
function resumoDasPropostas(anexos: unknown): string {
  const a = (Array.isArray(anexos) ? anexos : []).find((x) => x && typeof x === "object" && (x as { tipo?: string }).tipo === "mudancas") as
    | { mudancas?: MudancaProposta[]; aplicadas?: string[] }
    | undefined;
  if (!a || !Array.isArray(a.mudancas) || !a.mudancas.length) return "";
  const aplicadas = Array.isArray(a.aplicadas) ? a.aplicadas : [];
  return `Mudanças que propus: ${a.mudancas.map((m) => `${m.titulo}${aplicadas.indexOf(m.id) >= 0 ? " (aplicada)" : ""}`).join("; ")}.`;
}

/**
 * aplicar_mudancas { trabalho_id, mudancas, regerar?, mensagem_id? }: grava
 * na direção as mudanças que a equipe aprovou (a tela manda as mesmas que
 * `conversar` devolveu; aqui passam de novo pelas regras da casa). Sem custo.
 * O texto exato só muda quando a mudança traz texto_exato. `regerar` (lista
 * de ordens ou true para todas as afetadas) só volta validado: quem refaz as
 * lâminas é a tela, pelo fluxo normal (gerar_card, conferência e
 * autocorreção). Com `mensagem_id`, a resposta do diretor fica marcada como
 * aplicada e o que ela ensinou vai para a memória do diretor.
 */
async function aplicarMudancas(ch: Chamador, corpo: Record<string, unknown>) {
  const t = await trabalhoComAcesso(ch, texto(corpo.trabalho_id, 64));
  if (estaEntregue(t)) {
    throw erroTrabalhoEntregue();
  }
  if (!t.direcao.cards.length) throw new ErroEstudio(409, "trabalho_sem_direcao", "Este trabalho ainda não tem direção de arte.");
  const brutas = Array.isArray(corpo.mudancas) ? (corpo.mudancas as unknown[]).slice(0, 12) : [];
  if (!brutas.length) throw new ErroEstudio(400, "sem_mudancas", "Escolha pelo menos uma mudança para aplicar.");

  const kit = await lerKit(t.client_id, t);
  const idsDeFoto = brutas
    .map((m) => (m && typeof m === "object" ? ((m as { campos?: Record<string, unknown> }).campos ?? {}).foto_acervo : null))
    .map((v) => texto(v, 64))
    .filter((v) => v && v !== SEM_FOTO);
  const fotos = idsDeFoto.length ? await imagensDoAcervo(t.client_id, idsDeFoto) : [];
  const total = totalCards(t);
  const { mudancas, avisos } = normalizarMudancas(brutas, {
    ordens: t.direcao.cards.map((c) => c.ordem),
    paleta: hexDaPaleta(kit),
    acervo: new Set(fotos.map((f) => f.id)),
    // Quem clica em Aplicar viu o texto novo no cartão da mudança.
    permitirTexto: true,
    semCaixa: laminasSemCaixa(t, kit),
    continuo: !ehAds(t) && !!t.direcao.carrossel_infinito && total > 1,
  });
  if (!mudancas.length) {
    throw new ErroEstudio(400, "mudancas_invalidas", avisos[0] || "Nenhuma das mudanças pôde ser aplicada.", { avisos });
  }

  // mutarTrabalho pode reler e refazer: vale a aplicação sobre a direção que foi gravada.
  let r: ResultadoDaAplicacao = { direcao: t.direcao, afetadas: [], fundoApagado: false, textoMudou: [] };
  const gravado = await mutarTrabalho(t.id, (x) => {
    r = aplicarNaDirecao<Direcao>(x.direcao, mudancas);
    return { direcao: r.direcao };
  });
  const ordensValidas = new Set(gravado.direcao.cards.map((c) => c.ordem));
  const regerar = corpo.regerar === true
    ? r.afetadas
    : Array.isArray(corpo.regerar)
      ? [...new Set((corpo.regerar as unknown[]).map((o) => Number(o)).filter((o) => Number.isInteger(o) && ordensValidas.has(o)))].sort((a, b) => a - b)
      : [];

  // Marca a resposta do diretor como aplicada e leva o que ela ensinou para a memória.
  const mensagemId = texto(corpo.mensagem_id, 64);
  if (UUID.test(mensagemId)) {
    const conversaId = await conversaDoTrabalho(t, ch.userId, false);
    const { data } = conversaId
      ? await servico().from("agente_mensagens").select("id, conversa_id, client_id, papel, conteudo, anexos, criado_em").eq("id", mensagemId).eq("conversa_id", conversaId).maybeSingle()
      : { data: null };
    const linha = data as LinhaDaMensagem | null;
    if (linha && linha.papel === "agente") {
      const anexos = (Array.isArray(linha.anexos) ? linha.anexos : []) as Record<string, unknown>[];
      let memoria: string | null = null;
      const novos = anexos.map((a) => {
        if (!a || a.tipo !== "mudancas") return a;
        const ja = Array.isArray(a.aplicadas) ? (a.aplicadas as string[]) : [];
        if (!a.memorizada && typeof a.memoria === "string" && a.memoria.trim()) memoria = a.memoria.trim();
        return { ...a, aplicadas: [...new Set([...ja, ...mudancas.map((m) => m.id)])], aplicadas_em: new Date().toISOString(), memorizada: a.memorizada || !!memoria };
      });
      await servico().from("agente_mensagens").update({ anexos: novos }).eq("id", linha.id);
      if (memoria) {
        // Frente H: pelo cérebro do cliente (reforço em vez de duplicar; o contraditório aposenta o antigo).
        await gravarNoCerebro(servico(), {
          client_id: t.client_id,
          area: "arte",
          categoria: "preferencia",
          texto: texto(memoria, 300),
          motivo: "conversa no estúdio, aplicada",
          fonte: "estudio_conversa",
          criado_por: ch.userId,
          referencia_id: t.id,
        });
      }
      await gravarMensagens(conversaId!, t.client_id, [{
        papel: "sistema",
        conteudo: `Aplicado: ${mudancas.map((m) => m.titulo).join("; ")}.${regerar.length ? ` Refazendo ${regerar.length === 1 ? `a lâmina ${regerar[0]}` : `as lâminas ${regerar.join(", ")}`}.` : ""}`,
        anexos: [{ tipo: "aplicadas", mensagem_id: linha.id, ids: mudancas.map((m) => m.id), regerar }],
      }]);
    }
  }

  return json({
    trabalho: gravado,
    aplicadas: mudancas.map((m) => m.id),
    afetadas: r.afetadas,
    regerar,
    fundo_apagado: r.fundoApagado,
    texto_mudou: r.textoMudou,
    avisos,
    custo_usd: 0,
  });
}

// ------------------------------------------------------------ refinar texto

/** Base de copy do refino, cortada em blocos inteiros até o teto (a mais importante primeiro). */
function baseDoRefino(teto = 8_000): string {
  const saida: string[] = [];
  let total = 0;
  for (const bloco of [FORMULAS_DE_TITULO, CTA_PRINCIPIOS, ANTI_GENERICO, REVISAO_DE_MARCA, VOZ_DE_MARCA]) {
    if (total + bloco.length > teto) break;
    saida.push(bloco);
    total += bloco.length + 2;
  }
  return saida.join("\n\n");
}

/**
 * refinar_texto { trabalho_id, alvo: "lamina" | "legenda", ordem?, texto?,
 * objetivos?, framework?, pedido? } (dono, 26/09): 3 opções do texto refinado
 * com a técnica e o porquê. O redator (modelo do diretor de arte) usa a base
 * de copy (títulos, CTA, anti-genérico, revisão e voz de marca), o framework
 * escolhido (conhecimento-conteudo.ts), o contexto da marca do trabalho e o
 * cérebro do cliente. Nada é gravado: a tela aplica a opção escolhida no texto
 * exato (configurar) ou na legenda. Uma chamada, sem laço; o custo volta na resposta.
 */
async function refinarTexto(ch: Chamador, corpo: Record<string, unknown>) {
  const t = await trabalhoComAcesso(ch, texto(corpo.trabalho_id, 64));
  const alvo: "lamina" | "legenda" = corpo.alvo === "legenda" ? "legenda" : "lamina";
  if (alvo === "legenda" && ehAds(t)) {
    throw new ErroEstudio(409, "anuncio_sem_legenda", "Criativo de anúncio não tem legenda de post: o texto do anúncio fica na copy da Mesa Ads.");
  }
  let original = texto(corpo.texto, alvo === "legenda" ? 2200 : 1200);
  let card: CardDirecao | null = null;
  if (alvo === "lamina") {
    card = cardDaDirecao(t, lerOrdem(corpo));
    if (!original) original = card.texto_exato || "";
  } else if (!original) {
    original = t.legenda || "";
  }
  if (!original.trim()) throw new ErroEstudio(400, "texto_vazio", "Não há texto para refinar. Escreva um primeiro.");
  const objetivos = objetivosDoRefino(corpo.objetivos);
  const framework = frameworkPorId(texto(corpo.framework, 40).toLowerCase());
  const pedido = texto(corpo.pedido, 600);
  const [diretor, contexto, cerebro, marcaDoTexto, perfil] = await Promise.all([
    modeloDoPapel("diretor_arte"),
    lerContextoConsolidado(servico(), t.client_id).catch(() => null),
    resumoDoCerebro(servico(), t.client_id, ["copy", "arte", "campanha"], { limite: 14, titulo: "O QUE ESTE CLIENTE JÁ ENSINOU (cérebro do cliente)" }),
    marcaDe(t.client_id, t),
    servico().from("profiles").select("company_name, full_name").eq("id", t.client_id).maybeSingle(),
  ]);
  const p = perfil.data as { company_name: string | null; full_name: string | null } | null;
  const r = await chamarTexto({
    clientId: t.client_id,
    tarefa: "estudio",
    agente: "diretor_arte",
    modeloId: diretor.id,
    raciocinio: raciocinioPara(diretor, ["low", "medium"]),
    sistema: `${INSTRUCOES_REFINO}\n\n${baseDoRefino()}`,
    mensagens: [{
      papel: "usuario",
      conteudo: JSON.stringify({
        alvo,
        texto_atual: original,
        objetivos: objetivos.map((id) => OBJETIVOS_DO_REFINO.filter((o) => o.id === id)[0]).filter(Boolean).map((o) => ({ objetivo: o.rotulo, como: o.instrucao })),
        framework: framework ? { nome: framework.nome, quando: framework.quando, passos: framework.passos, estatico: framework.estatico } : null,
        frameworks_disponiveis: framework ? undefined : FRAMEWORKS.map((f) => f.nome),
        pedido_da_equipe: pedido || null,
        lamina: card ? { ordem: card.ordem, de: totalCards(t), funcao: card.funcao, composicao: card.composicao } : null,
        conjunto: { conceito: t.direcao.conceito, textos: t.direcao.cards.map((c) => ({ ordem: c.ordem, funcao: c.funcao, texto_exato: c.texto_exato })) },
        marca: {
          nome: marcaDoTexto && !marcaDoTexto.principal ? texto(marcaDoTexto.nome, 120) : texto(p?.company_name || p?.full_name, 120) || null,
          contexto: contexto ? contextoComMarca(contexto, marcaDoTexto) : null,
        },
        cerebro_do_cliente: cerebro.texto || null,
      }),
    }],
    esquemaJson: ESQUEMA_REFINO,
    maxTokensSaida: 4_000,
    // Redator com a base de copy inteira: 5 min antes de desistir (a resposta tem fôlego).
    timeoutMs: 300_000,
    referencia: { tipo: "estudio_trabalho", id: t.id },
    criadoPor: ch.userId,
  });
  await mutarTrabalho(t.id, (x) => ({ custo_usd: arred(num(x.custo_usd) + r.custoUsd) }));
  const opcoes = limparOpcoesDoRefino(r.json, alvo, original);
  if (!opcoes.length) {
    throw new ErroEstudio(502, "refino_vazio", "O redator não devolveu opções utilizáveis. Tente de novo ou mude os objetivos.", { custo_usd: r.custoUsd, saldo_usd: r.saldoUsd });
  }
  return json({
    trabalho_id: t.id,
    alvo,
    ordem: card ? card.ordem : null,
    original,
    opcoes,
    objetivos,
    framework: framework ? framework.id : null,
    cerebro_usado: cerebro.usados,
    custo_usd: r.custoUsd,
    saldo_usd: r.saldoUsd,
    reserva_usada: r.reservaUsada ?? null,
  });
}

// ------------------------------------------------------------------ porta

const ACOES: Record<string, (ch: Chamador, corpo: Record<string, unknown>) => Promise<Response>> = {
  preparar,
  configurar,
  preparar_fundo: prepararFundo,
  gerar_card: gerarCard,
  conferir_card: conferirCard,
  ajustar_card: (ch, corpo) => ajustarCard(ch, corpo),
  corrigir_card: corrigirCard,
  legenda,
  entregar,
  referencias,
  conversar,
  aplicar_mudancas: aplicarMudancas,
  reabrir,
  logos: logosDoTrabalho,
  refinar_texto: refinarTexto,
};

/** Ações que podem passar de 150 s: geração, ajuste, correção, conferência, preparo, entrega, a conversa com o diretor e o refino do texto. */
const ACOES_LONGAS = new Set(["preparar", "preparar_fundo", "gerar_card", "conferir_card", "ajustar_card", "corrigir_card", "legenda", "entregar", "conversar", "refinar_texto"]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return erro(405, "metodo_nao_permitido", "Use POST.");

  let ch: Chamador | null = null;
  try {
    ch = await identificar(req);
  } catch {
    ch = null;
  }
  if (!ch) return erro(401, "nao_autorizado", "Sessão expirada ou sem permissão de equipe.");

  let corpo: Record<string, unknown> = {};
  try {
    corpo = await req.json();
  } catch { /* corpo vazio */ }
  const acao = String(corpo.acao ?? "");
  const executar = ACOES[acao];
  if (!executar) return erro(400, "acao_desconhecida", "Ação desconhecida.", { aceitas: Object.keys(ACOES) });

  const chamador = ch;
  const rodar = async (): Promise<Response> => {
    try {
      return await executar(chamador, corpo);
    } catch (e) {
      if (e instanceof ErroEstudio) return erro(e.status, e.codigo, e.message, e.detalhes);
      if (e instanceof IaMotorErro) return respostaDoMotor(e);
      if (e instanceof JevErro) return erro(502, "jev_indisponivel", "A conferência do Jev não respondeu. Tente de novo.", { codigo: e.codigo });
      // Log so com o codigo e a acao: nada de prompt nem dado de cliente.
      console.error("estudio-arte: falha inesperada", { acao, erro: e instanceof Error ? e.name : "desconhecido" });
      return erro(500, "erro_interno", "Erro inesperado no estúdio. Tente de novo.");
    }
  };
  // Imagem e conferência passam fácil de 150 s: a resposta começa na hora (resposta-com-folego.ts).
  return ACOES_LONGAS.has(acao) ? respostaComFolego(rodar, corsHeaders) : await rodar();
});
