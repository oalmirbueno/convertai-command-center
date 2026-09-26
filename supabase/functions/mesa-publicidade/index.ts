/**
 * mesa-publicidade: a Mesa Publicidade (frente P, 26/09/2026).
 * Kit: scratchpad/kits/publicidade. SQL: P-01-mesa-publicidade.sql (sem ele,
 * modo rascunho: a campanha fica só na tela e o ensaio segue salvo na Mesa Foto).
 *
 * A Mesa Publicidade DIRIGE a campanha; a Mesa Foto PRODUZ as imagens (esta
 * função chama as ações dela: campanha_planejar e versao_decidir); a Mesa Ads
 * testa. Nada de segundo motor, segundo acervo ou segunda carteira: a IA passa
 * pelo ia-motor, as fotos ficam em cliente_imagens e o custo na carteira do cliente.
 *
 * Ações (POST { acao, ... }, só equipe com acesso ao cliente). Onde diz
 * "campanha", vale { campanha_id } (banco) ou { rascunho } (sem o SQL):
 * - receitas: as receitas por categoria (grátis).
 * - campanhas_listar { client_id }.
 * - campanha_criar { client_id, kit_id, nome?, categoria? }: produto do kit da Mesa Foto.
 * - campanha_abrir { campanha_id }.
 * - briefing_salvar { campanha, briefing, nome?, categoria? }: versão nova quando muda.
 * - territorios_propor { campanha, pedido? }: o diretor propõe três territórios (IA).
 * - territorio_aprovar { campanha, territorio_id }: aprova um e monta o plano de seis tomadas.
 * - tomadas_salvar { campanha, tomadas }: ajustes da equipe no plano.
 * - tomadas_pedir { campanha, modelo_imagem_id?, qualidade? }: pede as seis tomadas à
 *   Mesa Foto (campanha_planejar, com o produto das fontes do kit). Idempotente.
 * - revisao_avaliar { campanha, jev? }: lê o ensaio, aplica a regra (produto antes da
 *   estética) sobre a conferência da Mesa Foto e o aviso do Jev sobre as restrições.
 * - revisao_decidir { campanha, foto_tomada_id, versao, decisao, motivo?, confirmo_produto? }:
 *   aprova (só com o produto conferido) ou reprova, pela versao_decidir da Mesa Foto.
 * - encaminhar { campanha, destino: mesa|ads, revisao_ids? }: registra a linhagem e
 *   devolve o endereço do Estúdio de destino. Não aprova anúncio nem verba.
 * - encaminhamento_desfazer { campanha_id, encaminhamento_ids }.
 * - agente_conversar { client_id, campanha_id?, mensagem, conversa_id?, nova? } e
 *   agente_historico { client_id, campanha_id? }: o agente da mesa.
 * - executar_acao_agente / desfazer_acao_agente { mensagem_id, acao_id?, descartar? }:
 *   o contrato comum (_shared/acoes-do-agente.ts).
 *
 * Regras: toda leitura e escrita presa ao client_id com can_access_client;
 * nenhuma falha responde 200; ação que gasta devolve custo_usd e saldo_usd;
 * Jev só como aviso (nunca decide); sem laço de correção.
 */

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { carregarModelo, chamarTexto, cobrarJev, IaMotorErro, modeloPadrao, type ModeloIa } from "../_shared/ia-motor.ts";
import { jevPerguntar, JevErro, probabilidadeNoul, type PerguntaJev } from "../_shared/jev.ts";
import { respostaComFolego } from "../_shared/resposta-com-folego.ts";
import { lerContextoConsolidado } from "../_shared/contexto-cliente.ts";
import { auditLog } from "../_shared/mcp-audit.ts";
import {
  acaoGuardadaNaMensagem,
  type AcaoDoAgente,
  confirmarAcaoGuardada,
  desfazerAcaoGuardada,
  ErroDaAcao,
  type ItemDaAcaoDoAgente,
  type ResultadoDoItem,
  textoDoResultado,
} from "../_shared/acoes-do-agente.ts";
import {
  conhecimentoPublicidade,
  RECEITAS_DE_PUBLICIDADE,
  receitaComoDado,
  receitaDaCategoria,
  receitaParaProduto,
} from "../_shared/conhecimento-publicidade.ts";
import {
  avaliarRevisao,
  briefingDoKit,
  briefingIgual,
  type CampanhaDePublicidade,
  campanhaVazia,
  type DestinoDoAtivo,
  ehUuid,
  enderecoDoDestino,
  lacunasDoBriefing,
  limpo,
  listaDeTextos,
  modeloParaMesaFoto,
  montarLinhagem,
  motivoDaReprovacao,
  normalizarBriefing,
  normalizarCampanha,
  normalizarTerritorios,
  normalizarTomadas,
  paraEncaminhar,
  pedidoParaMesaFoto,
  planoDeTomadas,
  podeAprovar,
  restricoesEmLista,
  type RevisaoDePublicidade,
  statusDaCampanha,
  type Territorio,
  type TomadaDePublicidade,
  versoesDoEnsaio,
} from "./regras.ts";
import {
  blocoDasAcoesDaPublicidade,
  ESQUEMA_DAS_ACOES_DA_PUBLICIDADE,
  normalizarAcoesDaPublicidade,
  pedeAcaoNaPublicidade,
} from "./acoes-da-publicidade.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

class ErroHttp extends Error {
  status: number;
  codigo: string;
  extra: Record<string, unknown>;
  constructor(status: number, codigo: string, mensagem: string, extra: Record<string, unknown> = {}) {
    super(mensagem);
    this.status = status;
    this.codigo = codigo;
    this.extra = extra;
  }
}

// ------------------------------------------------------------------ conhecimento e sistemas

const CONHECIMENTO_DO_DIRETOR = conhecimentoPublicidade("diretor").texto;
const CONHECIMENTO_DO_AGENTE = conhecimentoPublicidade("agente").texto;

const SISTEMA_DO_DIRETOR = `Você é o diretor de campanha da Mesa Publicidade de uma agência brasileira. Recebe o produto (kit da Mesa Foto, que é a verdade do produto), o briefing versionado, o contexto do cliente e a receita da categoria (dado de partida, não campanha vencedora). Propõe TRÊS territórios criativos realmente diferentes para uma campanha fotográfica com pessoas, ambientes e fotografia profissional que valorizem o produto e ajudem a vender.

${CONHECIMENTO_DO_DIRETOR}

REGRAS DA SAÍDA
- Português do Brasil, frases curtas, sem travessão.
- Exatamente três territórios, com nomes curtos e distintos. Cada um muda a motivação do comprador.
- Casting sempre de pessoa sintética adulta (idade_aprox 21 ou mais), sem parecer pessoa real ou famosa.
- paleta: até 5 cores em hexadecimal (#RRGGBB) coerentes com a marca.
- Não invente preço, desconto, prazo, estoque, depoimento, prêmio nem benefício técnico. O que falta vai em lacunas.
- O produto nunca muda: respeite as restrições do briefing e os invariantes do kit.
Responda só com o JSON pedido.`;

const SISTEMA_DO_AGENTE = `Você é o agente da Mesa Publicidade do painel Aceleriq: ajuda a equipe a dirigir campanhas de produto (briefing, três territórios, seis tomadas pedidas à Mesa Foto, revisão do produto e envio para a Mesa e a Mesa Ads). Responda em português do Brasil, curto e direto, sem travessão. Você não gera imagem: quem produz é a Mesa Foto. Aprovar foto não aprova anúncio nem verba.

${CONHECIMENTO_DO_AGENTE}`;

const S = (type: string | string[], extra: Record<string, unknown> = {}) => ({ type, ...extra });
const obj = (props: Record<string, unknown>) => ({ type: "object", properties: props, required: Object.keys(props), additionalProperties: false });
const lista = (items: unknown) => ({ type: "array", items });

const ESQUEMA_TERRITORIOS = {
  nome: "territorios_da_campanha",
  schema: obj({
    territorios: lista(obj({
      nome: S("string"),
      conceito: S("string"),
      tensao_humana: S("string"),
      promessa: S("string"),
      razao_para_acreditar: S("string"),
      direcao_de_arte: obj({ paleta: lista(S("string")), luz: S("string"), tratamento: S("string"), enquadramentos: S("string") }),
      casting: obj({ perfil: S("string"), idade_aprox: S("number"), estilo: S("string"), figurino: S("string") }),
      ambiente: S("string"),
      referencias: lista(S("string")),
      riscos: lista(S("string")),
      por_que_combina: S("string"),
    })),
    lacunas: lista(S("string")),
  }),
};

const ESQUEMA_DO_AGENTE = {
  nome: "resposta_do_agente_da_publicidade",
  schema: obj({ resposta: S("string"), acoes: ESQUEMA_DAS_ACOES_DA_PUBLICIDADE }),
};

const TAREFA = "estudio" as const;
const AGENTE_DIRETOR = "diretor_arte" as const;
const REF_CONVERSA = "mesa_publicidade";
const REF_CAMPANHA = "publicidade_campanha";
const TIMEOUT_TEXTO_MS = 200_000;

// ------------------------------------------------------------------ banco e acesso

type Chamador = { userId: string; token: string; doChamador: SupabaseClient };

let servicoCache: SupabaseClient | null = null;
function servico(): SupabaseClient {
  if (!servicoCache) {
    servicoCache = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return servicoCache;
}

function clienteDoChamador(token: string): SupabaseClient {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function identificar(req: Request): Promise<Chamador> {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new ErroHttp(401, "sessao_expirada", "Sessão expirada. Entre de novo no painel.");
  const { data: user } = await servico().auth.getUser(token);
  const userId = user?.user?.id;
  if (!userId) throw new ErroHttp(401, "sessao_expirada", "Sessão expirada. Entre de novo no painel.");
  const { data: staff, error } = await servico().rpc("is_staff", { _user_id: userId });
  if (error) throw new ErroHttp(503, "autorizacao_indisponivel", "Não foi possível conferir a permissão agora.");
  if (staff !== true) throw new ErroHttp(403, "somente_equipe", "Somente a equipe usa a Mesa Publicidade.");
  return { userId, token, doChamador: clienteDoChamador(token) };
}

async function garantirAcesso(ch: Chamador, clientId: string) {
  if (!ehUuid(clientId)) throw new ErroHttp(400, "client_id_invalido", "client_id precisa ser um UUID.");
  const { data, error } = await ch.doChamador.rpc("can_access_client", { _client_id: clientId });
  if (error) throw new ErroHttp(503, "autorizacao_indisponivel", "Não foi possível conferir o acesso ao cliente agora.");
  if (data !== true) throw new ErroHttp(403, "sem_acesso_ao_cliente", "Você não tem acesso a este cliente.");
}

const idDe = (v: unknown, nome: string): string => {
  const s = String(v ?? "").trim();
  if (!ehUuid(s)) throw new ErroHttp(400, `${nome}_invalido`, `${nome} precisa ser um UUID.`);
  return s;
};

// deno-lint-ignore no-explicit-any
function tabelaFalta(error: any): boolean {
  if (!error) return false;
  const msg = String(error.message || "");
  const codigo = String(error.code || "");
  return codigo === "42P01" || codigo === "PGRST205" || msg.indexOf("does not exist") >= 0 || msg.indexOf("Could not find the table") >= 0;
}

const BANCO_NAO_PUBLICADO = () =>
  new ErroHttp(503, "banco_da_publicidade_nao_publicado", "O banco da Mesa Publicidade ainda não foi publicado. A campanha segue como rascunho na tela.");

// deno-lint-ignore no-explicit-any
function falhaDeBanco(error: any, oque: string): ErroHttp {
  if (tabelaFalta(error)) return BANCO_NAO_PUBLICADO();
  return new ErroHttp(503, "gravacao_falhou", `Não foi possível ${oque} agora.`);
}

function respostaDeErro(err: unknown): Response {
  if (err instanceof ErroHttp) return json({ error: err.codigo, mensagem: err.message, ...err.extra }, err.status);
  if (err instanceof ErroDaAcao) return json({ error: err.codigo, mensagem: err.message }, err.status);
  if (err instanceof IaMotorErro) return json({ ...err.paraJson(), mensagem: err.message }, err.status >= 400 ? err.status : 500);
  if (err instanceof JevErro) return json({ error: "jev_indisponivel", mensagem: "O Jev não respondeu. Tente de novo." }, 502);
  console.error("[mesa-publicidade] erro inesperado", { nome: err instanceof Error ? err.name : "desconhecido" });
  return json({ error: "erro_interno", mensagem: "Falha inesperada na Mesa Publicidade." }, 500);
}

async function modeloDeTexto(pedido?: unknown): Promise<ModeloIa> {
  if (typeof pedido === "string" && pedido.trim()) return await carregarModelo(pedido.trim(), "texto");
  const m = (await modeloPadrao("diretor_arte")) ?? (await modeloPadrao("estrategista"));
  if (!m) throw new ErroHttp(409, "sem_modelo_padrao", "O catálogo não tem modelo padrão ativo para o diretor.");
  return m;
}

// ------------------------------------------------------------------ a Mesa Foto (ações existentes dela)

/**
 * Chama a função mesa-foto com a sessão de quem pediu (mesmas travas,
 * mesma carteira, mesmo acervo). A resposta pode vir com fôlego (espaços
 * antes do JSON); o erro vem no campo `error`.
 */
async function chamarMesaFoto(ch: Chamador, corpo: Record<string, unknown>): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/mesa-foto`, {
      method: "POST",
      headers: { Authorization: `Bearer ${ch.token}`, apikey: Deno.env.get("SUPABASE_ANON_KEY") ?? "", "Content-Type": "application/json" },
      body: JSON.stringify(corpo),
      signal: AbortSignal.timeout(330_000),
    });
  } catch {
    throw new ErroHttp(504, "mesa_foto_sem_resposta", "A Mesa Foto não respondeu a tempo. Confira o ensaio na Mesa Foto antes de pedir de novo.");
  }
  const texto = await res.text();
  let data: Record<string, unknown> | null = null;
  try {
    const lido = JSON.parse(texto.trim());
    data = lido && typeof lido === "object" && !Array.isArray(lido) ? lido : null;
  } catch { /* corpo não é JSON */ }
  if (!data) throw new ErroHttp(502, "mesa_foto_sem_resposta", "A Mesa Foto respondeu sem dados. Confira o ensaio na Mesa Foto.");
  if (typeof data.error === "string") {
    const status = Number(data.status_http) || (res.status >= 400 ? res.status : 502);
    const { error: _e, mensagem, ...resto } = data;
    throw new ErroHttp(status, String(data.error), String(mensagem || "A Mesa Foto recusou o pedido."), resto);
  }
  if (!res.ok) throw new ErroHttp(res.status, "mesa_foto_falhou", "A Mesa Foto recusou o pedido.");
  return data;
}

// ------------------------------------------------------------------ a campanha (agregado)

type Estado = { c: CampanhaDePublicidade; banco: boolean };

// deno-lint-ignore no-explicit-any
type Linha = Record<string, any>;

async function lerCampanha(ch: Chamador, campanhaId: string): Promise<CampanhaDePublicidade> {
  const db = servico();
  const { data, error } = await db.from("publicidade_campanhas").select("*").eq("id", campanhaId).maybeSingle();
  if (error) throw falhaDeBanco(error, "ler a campanha");
  if (!data) throw new ErroHttp(404, "campanha_inexistente", "Campanha não encontrada.");
  const linha = data as Linha;
  await garantirAcesso(ch, String(linha.client_id));
  const [briefings, territorios, tomadas, revisoes, encaminhamentos] = await Promise.all([
    db.from("publicidade_briefings").select("versao, criado_em").eq("campanha_id", campanhaId).order("versao", { ascending: false }).limit(30),
    db.from("publicidade_territorios").select("*").eq("campanha_id", campanhaId).neq("status", "descartado").order("criado_em", { ascending: false }).limit(12),
    db.from("publicidade_tomadas").select("*").eq("campanha_id", campanhaId).order("ordem"),
    db.from("publicidade_revisoes").select("*").eq("campanha_id", campanhaId).order("criado_em"),
    db.from("publicidade_encaminhamentos").select("*").eq("campanha_id", campanhaId).order("criado_em"),
  ]);
  for (const r of [briefings, territorios, tomadas, revisoes, encaminhamentos]) if (r.error) throw falhaDeBanco(r.error, "ler a campanha");
  // O aprovado sempre entra; depois as propostas mais novas (até três na tela).
  const ts = ((territorios.data || []) as Linha[]);
  const aprovado = ts.find((t) => t.status === "aprovado");
  const propostas = ts.filter((t) => t !== aprovado).slice(0, 3).sort((a, b) => Number(a.ordem) - Number(b.ordem));
  const ordenados = (aprovado ? [aprovado] : []).concat(propostas);
  return normalizarCampanha({
    ...linha,
    persistida: true,
    briefings: briefings.data || [],
    territorios: ordenados.map((t) => ({ ...(t.dados || {}), id: t.id, status: t.status, briefing_versao: t.briefing_versao })),
    tomadas: ((tomadas.data || []) as Linha[]).map((t) => ({ ...(t.dados || {}), id: t.id, funcao: t.funcao, foto_tomada_id: t.foto_tomada_id, status: t.status })),
    revisoes: revisoes.data || [],
    encaminhamentos: encaminhamentos.data || [],
  }, String(linha.client_id));
}

async function estadoDoPedido(ch: Chamador, corpo: Record<string, unknown>): Promise<Estado> {
  if (corpo.campanha_id) return { c: await lerCampanha(ch, idDe(corpo.campanha_id, "campanha_id")), banco: true };
  if (corpo.rascunho && typeof corpo.rascunho === "object") {
    const c = normalizarCampanha(corpo.rascunho);
    await garantirAcesso(ch, c.client_id);
    c.persistida = false;
    c.id = null;
    return { c, banco: false };
  }
  throw new ErroHttp(400, "campanha_ausente", "Informe campanha_id (ou o rascunho da campanha).");
}

async function tocarCampanha(c: CampanhaDePublicidade, campos: Record<string, unknown> = {}) {
  if (!c.id) return;
  const status = statusDaCampanha(c);
  const { error } = await servico().from("publicidade_campanhas").update({ ...campos, status, atualizado_em: new Date().toISOString() }).eq("id", c.id).eq("client_id", c.client_id);
  if (error) throw falhaDeBanco(error, "gravar a campanha");
}

/** Devolve a campanha atualizada (do banco quando salva; no rascunho, a própria). */
async function atual(ch: Chamador, e: Estado): Promise<CampanhaDePublicidade> {
  if (e.banco && e.c.id) return await lerCampanha(ch, e.c.id);
  return { ...e.c, persistida: false };
}

// deno-lint-ignore no-explicit-any
async function lerKit(clientId: string, kitId: string): Promise<{ kit: Linha; fontes: string[] }> {
  const { data, error } = await servico().from("foto_kits").select("id, client_id, tipo, nome, variante, atributos, invariantes, lacunas, status").eq("id", kitId).eq("client_id", clientId).maybeSingle();
  if (error) throw new ErroHttp(503, "kit_indisponivel", "Não foi possível ler o produto na Mesa Foto.");
  if (!data) throw new ErroHttp(404, "kit_inexistente", "Este produto não é deste cliente (ou foi apagado na Mesa Foto).");
  const refs = await servico().from("foto_kit_refs").select("imagem_id, papel, prioridade").eq("kit_id", kitId).order("prioridade");
  const papeisDoProduto = ["identidade", "detalhe", "rotulo", "embalagem", "verso"];
  const fontes = ((refs.data || []) as Linha[]).filter((r) => papeisDoProduto.indexOf(String(r.papel)) >= 0).map((r) => String(r.imagem_id)).filter(ehUuid);
  return { kit: data as Linha, fontes: Array.from(new Set(fontes)).slice(0, 16) };
}

// ------------------------------------------------------------------ campanhas

async function campanhasListar(ch: Chamador, corpo: Record<string, unknown>) {
  const clientId = idDe(corpo.client_id, "client_id");
  await garantirAcesso(ch, clientId);
  const { data, error } = await servico().from("publicidade_campanhas")
    .select("id, nome, kit_id, kit_nome, categoria, status, atualizado_em, ensaio_id")
    .eq("client_id", clientId).eq("arquivada", false).order("atualizado_em", { ascending: false }).limit(60);
  if (error) {
    if (tabelaFalta(error)) return json({ campanhas: [], banco: false });
    throw falhaDeBanco(error, "listar as campanhas");
  }
  return json({ campanhas: data || [], banco: true });
}

async function campanhaCriar(ch: Chamador, corpo: Record<string, unknown>) {
  const clientId = idDe(corpo.client_id, "client_id");
  await garantirAcesso(ch, clientId);
  const { kit, fontes } = await lerKit(clientId, idDe(corpo.kit_id, "kit_id"));
  const pedida = receitaDaCategoria(corpo.categoria);
  const receita = pedida || receitaParaProduto(kit.nome, kit.tipo);
  const briefing = briefingDoKit(kit);
  const nome = limpo(corpo.nome, 120) || limpo(kit.nome, 120) || "Campanha";
  const marcaId = ehUuid(corpo.marca_id) ? String(corpo.marca_id) : null;
  const base: CampanhaDePublicidade = {
    ...campanhaVazia(clientId),
    nome,
    marca_id: marcaId,
    categoria: receita ? receita.id : null,
    kit_id: String(kit.id),
    kit_nome: limpo(kit.nome, 160),
    kit_tipo: limpo(kit.tipo, 30),
    produto_fontes: fontes,
    briefing,
  };
  const { data, error } = await servico().from("publicidade_campanhas").insert({
    client_id: clientId,
    marca_id: marcaId,
    nome,
    categoria: base.categoria,
    kit_id: base.kit_id,
    kit_nome: base.kit_nome,
    kit_tipo: base.kit_tipo,
    produto_fontes: fontes,
    briefing,
    briefing_versao: 1,
    status: statusDaCampanha(base),
    criado_por: ch.userId,
  }).select("id").single();
  if (error || !data) {
    if (tabelaFalta(error)) return json({ campanha: { ...base, persistida: false }, banco: false, aviso: BANCO_NAO_PUBLICADO().message });
    throw falhaDeBanco(error, "criar a campanha");
  }
  const id = String((data as Linha).id);
  await servico().from("publicidade_briefings").insert({ campanha_id: id, client_id: clientId, versao: 1, briefing, criado_por: ch.userId });
  return json({ campanha: await lerCampanha(ch, id), banco: true });
}

async function campanhaAbrir(ch: Chamador, corpo: Record<string, unknown>) {
  return json({ campanha: await lerCampanha(ch, idDe(corpo.campanha_id, "campanha_id")), banco: true });
}

async function briefingSalvar(ch: Chamador, corpo: Record<string, unknown>) {
  const e = await estadoDoPedido(ch, corpo);
  const novo = normalizarBriefing(corpo.briefing);
  const nome = limpo(corpo.nome, 120);
  const categoria = corpo.categoria === null ? null : receitaDaCategoria(corpo.categoria) ? String(corpo.categoria) : e.c.categoria;
  const mudou = !briefingIgual(novo, e.c.briefing);
  const versao = mudou ? e.c.briefing_versao + 1 : e.c.briefing_versao;
  e.c = { ...e.c, briefing: novo, briefing_versao: versao, nome: nome || e.c.nome, categoria };
  if (e.banco && e.c.id) {
    if (mudou) {
      const { error } = await servico().from("publicidade_briefings").insert({ campanha_id: e.c.id, client_id: e.c.client_id, versao, briefing: novo, criado_por: ch.userId });
      if (error) throw falhaDeBanco(error, "gravar a versão do briefing");
    }
    await tocarCampanha(e.c, { briefing: novo, briefing_versao: versao, nome: e.c.nome, categoria });
  }
  return json({ campanha: await atual(ch, e), versao_nova: mudou, lacunas: lacunasDoBriefing(novo) });
}

// ------------------------------------------------------------------ territórios

async function proporTerritorios(ch: Chamador, e: Estado, pedido: string | null, modeloId?: unknown) {
  const c = e.c;
  if (!c.kit_id) throw new ErroHttp(409, "sem_produto", "Escolha o produto da campanha antes.");
  if (c.ensaio_id) throw new ErroHttp(409, "tomadas_ja_pedidas", "As tomadas já foram pedidas com o território aprovado. Abra uma campanha nova para outra direção.");
  const [{ kit }, contexto, modelo] = await Promise.all([lerKit(c.client_id, c.kit_id), lerContextoConsolidado(servico(), c.client_id), modeloDeTexto(modeloId)]);
  const receita = receitaDaCategoria(c.categoria) || receitaParaProduto(kit.nome, kit.tipo);
  const dados = {
    produto: {
      nome: kit.nome,
      tipo: kit.tipo,
      variante: kit.variante,
      invariantes: kit.invariantes || [],
      atributos: kit.atributos || {},
      lacunas_do_kit: kit.lacunas || [],
      fotos_do_produto: c.produto_fontes.length,
    },
    briefing: { versao: c.briefing_versao, ...c.briefing, lacunas: lacunasDoBriefing(c.briefing) },
    cliente: {
      negocio: contexto.negocio || null,
      publico: contexto.publico || null,
      oferta_no_contexto: contexto.oferta || null,
      tom_de_voz: contexto.tom_de_voz || null,
      diferenciais: contexto.diferenciais || [],
    },
    receita_da_categoria: receitaComoDado(receita),
    territorios_anteriores: c.territorios.map((t) => t.nome),
    pedido_da_equipe: pedido,
  };
  const saida = await chamarTexto({
    clientId: c.client_id,
    tarefa: TAREFA,
    agente: AGENTE_DIRETOR,
    modeloId: modelo.id,
    sistema: SISTEMA_DO_DIRETOR,
    mensagens: [{ papel: "usuario", conteudo: `Proponha os três territórios com estes dados reais:\n${JSON.stringify(dados)}` }],
    esquemaJson: ESQUEMA_TERRITORIOS,
    maxTokensSaida: 9_000,
    timeoutMs: TIMEOUT_TEXTO_MS,
    referencia: c.id ? { tipo: REF_CAMPANHA, id: c.id } : undefined,
    criadoPor: ch.userId,
  });
  const r = (saida.json ?? {}) as Record<string, unknown>;
  const { territorios, avisos } = normalizarTerritorios(r.territorios, c.briefing_versao);
  const lacunas = listaDeTextos(r.lacunas, 10, 300);
  if (!territorios.length) throw new ErroHttp(502, "territorios_vazios", "O diretor não trouxe territórios válidos. Tente de novo.", { custo_usd: saida.custoUsd, saldo_usd: saida.saldoUsd });
  const custoPorTerritorio = Math.round((saida.custoUsd / territorios.length) * 1e6) / 1e6;
  if (e.banco && c.id) {
    // As propostas abertas anteriores saem da tela (ficam no banco como descartadas); a aprovada fica.
    await servico().from("publicidade_territorios").update({ status: "descartado" }).eq("campanha_id", c.id).eq("status", "proposto");
    const { error } = await servico().from("publicidade_territorios").insert(territorios.map((t) => {
      const { id: _id, status: _s, ...dadosDoTerritorio } = t;
      return { campanha_id: c.id, client_id: c.client_id, ordem: t.ordem, briefing_versao: c.briefing_versao, status: "proposto", dados: dadosDoTerritorio, custo_usd: custoPorTerritorio, criado_por: ch.userId };
    }));
    if (error) throw new ErroHttp(503, "territorios_nao_salvos", "Os territórios vieram, mas não foram salvos. Tente de novo.", { custo_usd: saida.custoUsd });
    await tocarCampanha(c, { categoria: receita ? receita.id : c.categoria });
  } else {
    const aprovado = c.territorios.find((t) => t.id === c.territorio_id);
    e.c = { ...c, categoria: receita ? receita.id : c.categoria, territorios: (aprovado ? [aprovado] : []).concat(territorios.map((t) => ({ ...t, id: crypto.randomUUID() }))) };
  }
  return { campanha: await atual(ch, e), avisos, lacunas, custo_usd: saida.custoUsd, saldo_usd: saida.saldoUsd, reserva_usada: saida.reservaUsada ?? null };
}

async function territoriosPropor(ch: Chamador, corpo: Record<string, unknown>) {
  const e = await estadoDoPedido(ch, corpo);
  return json(await proporTerritorios(ch, e, limpo(corpo.pedido, 1500, true) || null, corpo.modelo_id));
}

async function gravarPlano(e: Estado, tomadas: TomadaDePublicidade[], territorio: Territorio) {
  const c = e.c;
  if (!(e.banco && c.id)) {
    e.c = { ...c, tomadas: tomadas.map((t) => ({ ...t, id: t.id || crypto.randomUUID() })) };
    return;
  }
  const linhas = tomadas.map((t) => {
    const { id: _id, funcao, ordem, foto_tomada_id, status, ...dados } = t;
    return { campanha_id: c.id, client_id: c.client_id, territorio_id: ehUuid(territorio.id) ? territorio.id : null, ordem, funcao, dados, foto_tomada_id, status, ensaio_id: c.ensaio_id, atualizado_em: new Date().toISOString() };
  });
  const { error } = await servico().from("publicidade_tomadas").upsert(linhas, { onConflict: "campanha_id,funcao" });
  if (error) throw falhaDeBanco(error, "gravar o plano de tomadas");
}

async function territorioAprovar(ch: Chamador, corpo: Record<string, unknown>) {
  const e = await estadoDoPedido(ch, corpo);
  const id = String(corpo.territorio_id || "");
  const t = e.c.territorios.find((x) => x.id === id);
  if (!t) throw new ErroHttp(404, "territorio_inexistente", "Território não encontrado nesta campanha.");
  if (e.c.ensaio_id && e.c.territorio_id !== id) throw new ErroHttp(409, "tomadas_ja_pedidas", "As tomadas já foram pedidas com outro território. Abra uma campanha nova para mudar a direção.");
  const aprovado: Territorio = { ...t, status: "aprovado" };
  const plano = planoDeTomadas(aprovado, receitaDaCategoria(e.c.categoria), e.c.briefing, e.c.tomadas.map((x) => x.id));
  if (e.banco && e.c.id) {
    const agora = new Date().toISOString();
    await servico().from("publicidade_territorios").update({ status: "proposto", decidido_por: null, decidido_em: null }).eq("campanha_id", e.c.id).eq("status", "aprovado").neq("id", id);
    const { error } = await servico().from("publicidade_territorios").update({ status: "aprovado", decidido_por: ch.userId, decidido_em: agora }).eq("id", id).eq("campanha_id", e.c.id);
    if (error) throw falhaDeBanco(error, "aprovar o território");
    e.c = { ...e.c, territorio_id: id };
    await gravarPlano(e, plano, aprovado);
    await tocarCampanha(e.c, { territorio_id: id });
  } else {
    e.c = { ...e.c, territorio_id: id, territorios: e.c.territorios.map((x) => ({ ...x, status: x.id === id ? "aprovado" : x.status === "aprovado" ? "proposto" : x.status })) };
    await gravarPlano(e, plano, aprovado);
  }
  return json({ campanha: await atual(ch, e) });
}

async function tomadasSalvar(ch: Chamador, corpo: Record<string, unknown>) {
  const e = await estadoDoPedido(ch, corpo);
  const t = e.c.territorios.find((x) => x.id === e.c.territorio_id);
  if (!t) throw new ErroHttp(409, "sem_territorio", "Aprove um território antes de ajustar as tomadas.");
  if (e.c.ensaio_id) throw new ErroHttp(409, "tomadas_ja_pedidas", "As tomadas já foram pedidas à Mesa Foto. Ajuste cada uma lá.");
  const base = e.c.tomadas.length ? e.c.tomadas : planoDeTomadas(t, receitaDaCategoria(e.c.categoria), e.c.briefing);
  await gravarPlano(e, normalizarTomadas(corpo.tomadas, base), t);
  return json({ campanha: await atual(ch, e) });
}

// ------------------------------------------------------------------ pedir as tomadas à Mesa Foto

const marcaDoPedido = (c: CampanhaDePublicidade) => `[Mesa Publicidade ${(c.id || c.territorio_id || "").slice(0, 8)}]`;

async function pedirTomadas(ch: Chamador, e: Estado, corpo: Record<string, unknown> = {}) {
  const c = e.c;
  const t = c.territorios.find((x) => x.id === c.territorio_id);
  if (!t) throw new ErroHttp(409, "sem_territorio", "Aprove um território antes de pedir as tomadas.");
  if (!c.kit_id) throw new ErroHttp(409, "sem_produto", "Escolha o produto da campanha antes.");
  // Idempotência: o ensaio já pedido volta como está (nada é cobrado de novo).
  if (c.ensaio_id) return { campanha: await atual(ch, e), ensaio_id: c.ensaio_id, ja_pedido: true, custo_usd: 0 };
  const tomadas = c.tomadas.length ? c.tomadas : planoDeTomadas(t, receitaDaCategoria(c.categoria), c.briefing);
  const marca = marcaDoPedido(c);
  // Um pedido que caiu por tempo pode ter criado o ensaio: procura antes de pedir de novo.
  const desde = new Date(Date.now() - 20 * 60_000).toISOString();
  const { data: recentes } = await servico().from("foto_ensaios").select("id, tomadas, pedido, criado_em")
    .eq("client_id", c.client_id).eq("kit_id", c.kit_id).gte("criado_em", desde).order("criado_em", { ascending: false }).limit(5);
  let ensaio = ((recentes || []) as Linha[]).find((x) => String(x.pedido || "").indexOf(marca) === 0) || null;
  let custo = 0;
  let saldo: unknown = null;
  let estimativa: unknown = null;
  let lacunas: string[] = [];
  if (!ensaio) {
    // A marca abre o pedido: é por ela que um pedido caído por tempo é achado (sem cobrar de novo).
    const pedido = pedidoParaMesaFoto(c.briefing, t, tomadas, marca);
    const corpoFoto: Record<string, unknown> = {
      acao: "campanha_planejar",
      client_id: c.client_id,
      kit_id: c.kit_id,
      quantidade: tomadas.length || 6,
      modelo: modeloParaMesaFoto(t),
      formatos: c.briefing.formatos,
      finalidade: "campanha de publicidade",
      pedido,
      // A direção vem da Publicidade: a campanha do mês da Mesa não entra no plano.
      campanha_id: "nenhuma",
    };
    if (c.marca_id) corpoFoto.marca_id = c.marca_id;
    if (typeof corpo.modelo_imagem_id === "string" && corpo.modelo_imagem_id) corpoFoto.modelo_imagem_id = corpo.modelo_imagem_id;
    if (typeof corpo.qualidade === "string" && corpo.qualidade) corpoFoto.qualidade = corpo.qualidade;
    const r = await chamarMesaFoto(ch, corpoFoto);
    ensaio = (r.ensaio && typeof r.ensaio === "object" ? r.ensaio : null) as Linha | null;
    custo = Number(r.custo_usd) || 0;
    saldo = r.saldo_usd ?? null;
    estimativa = r.estimativa_usd ?? null;
    lacunas = listaDeTextos(r.lacunas, 14, 300);
  }
  if (!ensaio || !ehUuid(ensaio.id)) throw new ErroHttp(502, "ensaio_nao_criado", "A Mesa Foto não devolveu o ensaio. Confira na Mesa Foto antes de pedir de novo.", { custo_usd: custo });
  const ensaioId = String(ensaio.id);
  const daFoto = Array.isArray(ensaio.tomadas) ? (ensaio.tomadas as Linha[]) : [];
  const ligadas = tomadas.map((x, i) => ({ ...x, foto_tomada_id: daFoto[i] && daFoto[i].id ? String(daFoto[i].id) : null, status: "pedida" as const }));
  e.c = { ...c, ensaio_id: ensaioId };
  if (e.banco && c.id) {
    await tocarCampanha(e.c, { ensaio_id: ensaioId });
    await gravarPlano(e, ligadas, t);
  } else {
    await gravarPlano(e, ligadas, t);
  }
  return { campanha: await atual(ch, e), ensaio_id: ensaioId, estimativa_usd: estimativa, lacunas, custo_usd: custo, saldo_usd: saldo, ja_pedido: false };
}

async function tomadasPedir(ch: Chamador, corpo: Record<string, unknown>) {
  const e = await estadoDoPedido(ch, corpo);
  return json(await pedirTomadas(ch, e, corpo));
}

// ------------------------------------------------------------------ revisão

async function lerEnsaio(c: CampanhaDePublicidade): Promise<Linha> {
  if (!c.ensaio_id) throw new ErroHttp(409, "sem_ensaio", "Peça as tomadas à Mesa Foto antes de revisar.");
  const { data, error } = await servico().from("foto_ensaios").select("id, client_id, kit_id, tomadas").eq("id", c.ensaio_id).eq("client_id", c.client_id).maybeSingle();
  if (error) throw new ErroHttp(503, "ensaio_indisponivel", "Não foi possível ler o ensaio na Mesa Foto.");
  if (!data) throw new ErroHttp(404, "ensaio_inexistente", "O ensaio desta campanha não está mais na Mesa Foto.");
  return data as Linha;
}

/** Aviso do Jev (Noul, um por foto): a conferência mostra mudança numa restrição do briefing? Nunca decide. */
async function avisosDoJev(c: CampanhaDePublicidade, fotos: { chave: string; conferencia: unknown }[], userId: string): Promise<{ porChave: Record<string, number | null>; custo: number; erro: string | null }> {
  const restricoes = restricoesEmLista(c.briefing.restricoes);
  if (!fotos.length || !restricoes.length) return { porChave: {}, custo: 0, erro: null };
  const questions: Record<string, PerguntaJev> = {};
  const state: Record<string, unknown> = { produto: { nome: c.kit_nome, tipo: c.kit_tipo }, restricoes, fotos: {} };
  for (const f of fotos.slice(0, 12)) {
    (state.fotos as Record<string, unknown>)[f.chave] = f.conferencia;
    questions[f.chave] = {
      type: "noul",
      instructions: `A conferência da foto gerada em \`fotos.${f.chave}\` (pontos, notas e alertas comparando com as fotos reais do produto) mostra que a foto mudou algum dos atributos listados em \`restricoes\` (logo ou texto, cor da variante, detalhe de material)?`,
      criteria: {
        true: "Sim: há evidência na conferência de que um atributo protegido pelo briefing mudou ou sumiu.",
        false: "Não: a conferência não traz evidência de mudança em nenhum atributo protegido pelo briefing.",
      },
    } as PerguntaJev;
  }
  try {
    const res = await jevPerguntar({ state, questions });
    const cobrado = await cobrarJev(res, { clientId: c.client_id, tarefa: "verificacao", referencia: c.id ? { tipo: REF_CAMPANHA, id: c.id } : undefined, criadoPor: userId });
    const porChave: Record<string, number | null> = {};
    for (const k of Object.keys(questions)) porChave[k] = probabilidadeNoul(res.answers[k]);
    return { porChave, custo: cobrado ? cobrado.custoUsd : 0, erro: null };
  } catch (err) {
    return { porChave: {}, custo: 0, erro: err instanceof JevErro ? err.codigo : "jev_indisponivel" };
  }
}

async function avaliarRevisoes(ch: Chamador, e: Estado, usarJev = true) {
  const c = e.c;
  const ensaio = await lerEnsaio(c);
  const versoes = versoesDoEnsaio(ensaio).filter((v) => v.versao > 0);
  const existentes = new Map(c.revisoes.map((r) => [`${r.foto_tomada_id}:${r.versao}`, r]));
  const semAviso = versoes.filter((v) => v.conferencia && !(existentes.get(`${v.foto_tomada_id}:${v.versao}`) || { aviso_jev: null }).aviso_jev);
  const jev = usarJev
    ? await avisosDoJev(c, semAviso.map((v, i) => ({ chave: `foto_${i + 1}`, conferencia: { pontos: v.conferencia!.pontos, alertas: v.conferencia!.alertas, resumo: v.conferencia!.resumo } })), ch.userId)
    : { porChave: {}, custo: 0, erro: null };
  const agora = new Date().toISOString();
  const revisoes: RevisaoDePublicidade[] = versoes.map((v) => {
    const antes = existentes.get(`${v.foto_tomada_id}:${v.versao}`);
    const avaliacao = avaliarRevisao(v.conferencia, c.briefing.restricoes);
    const i = semAviso.indexOf(v);
    const p = i >= 0 ? jev.porChave[`foto_${i + 1}`] : undefined;
    const aviso = p !== undefined ? { probabilidade: p, aviso: p !== null && p >= 0.5 } : antes ? antes.aviso_jev : null;
    const tomada = c.tomadas.find((t) => t.foto_tomada_id === v.foto_tomada_id) || null;
    // A decisão feita direto na Mesa Foto também vale aqui (a mesma versão).
    const decisao = antes && antes.decisao ? antes.decisao : v.decisao === "aprovada" ? "aprovada" : v.decisao === "rejeitada" ? "reprovada" : null;
    return {
      id: antes ? antes.id : crypto.randomUUID(),
      tomada_id: tomada ? tomada.id || null : null,
      foto_tomada_id: v.foto_tomada_id,
      versao: v.versao,
      imagem_id: v.imagem_id || (antes ? antes.imagem_id : null),
      storage_path: v.storage_path,
      avaliacao,
      aviso_jev: aviso,
      decisao,
      motivo: antes && antes.motivo ? antes.motivo : v.motivo_rejeicao,
      decidido_em: antes ? antes.decidido_em : decisao ? agora : null,
    };
  });
  const tomadas = c.tomadas.map((t) => {
    const r = revisoes.filter((x) => x.foto_tomada_id === t.foto_tomada_id).sort((a, b) => b.versao - a.versao)[0];
    const status = !r ? t.status : r.decisao === "aprovada" ? "aprovada" : r.decisao === "reprovada" ? "reprovada" : "gerada";
    return { ...t, status } as TomadaDePublicidade;
  });
  if (e.banco && c.id) {
    if (revisoes.length) {
      const linhas = revisoes.map((r) => ({
        id: r.id,
        campanha_id: c.id,
        client_id: c.client_id,
        tomada_id: r.tomada_id,
        ensaio_id: c.ensaio_id,
        foto_tomada_id: r.foto_tomada_id,
        versao: r.versao,
        imagem_id: r.imagem_id,
        storage_path: r.storage_path,
        avaliacao: r.avaliacao,
        aviso_jev: r.aviso_jev,
        decisao: r.decisao,
        motivo: r.motivo || null,
        decidido_em: r.decidido_em,
        atualizado_em: agora,
      }));
      const { error } = await servico().from("publicidade_revisoes").upsert(linhas, { onConflict: "campanha_id,foto_tomada_id,versao" });
      if (error) throw falhaDeBanco(error, "gravar a revisão");
    }
    const t = c.territorios.find((x) => x.id === c.territorio_id);
    if (t) await gravarPlano(e, tomadas, t);
    e.c = { ...e.c, revisoes, tomadas };
    await tocarCampanha(e.c);
  } else {
    e.c = { ...c, revisoes, tomadas };
  }
  return { campanha: await atual(ch, e), custo_usd: jev.custo, jev_erro: jev.erro, sem_versao: versoesDoEnsaio(ensaio).filter((v) => v.versao === 0).length };
}

async function revisaoAvaliar(ch: Chamador, corpo: Record<string, unknown>) {
  const e = await estadoDoPedido(ch, corpo);
  return json(await avaliarRevisoes(ch, e, corpo.jev !== false));
}

async function decidirRevisao(ch: Chamador, e: Estado, fotoTomadaId: string, versao: number, decisao: "aprovar" | "reprovar", motivoPedido: string, confirmo: boolean) {
  const c = e.c;
  const ensaio = await lerEnsaio(c);
  const v = versoesDoEnsaio(ensaio).find((x) => x.foto_tomada_id === fotoTomadaId);
  if (!v || v.versao !== versao) throw new ErroHttp(409, "versao_mudou", "Esta foto tem uma versão mais nova na Mesa Foto. Atualize a revisão.");
  const avaliacao = avaliarRevisao(v.conferencia, c.briefing.restricoes);
  let motivo = "";
  if (decisao === "aprovar") {
    const pode = podeAprovar(avaliacao, confirmo);
    if (!pode.pode) throw new ErroHttp(409, avaliacao.veredito === "reprovada" ? "produto_mudou" : "produto_nao_conferido", pode.motivo);
  } else {
    motivo = motivoPedido || motivoDaReprovacao(avaliacao) || "Reprovada na revisão da Mesa Publicidade.";
  }
  const r = await chamarMesaFoto(ch, { acao: "versao_decidir", ensaio_id: c.ensaio_id, tomada_id: fotoTomadaId, versao, decisao: decisao === "aprovar" ? "aprovar" : "rejeitar", motivo: motivo || undefined });
  const imagem = (r.imagem && typeof r.imagem === "object" ? r.imagem : null) as Linha | null;
  // Relê o ensaio e grava a revisão com a decisão (o upsert guarda a decisão de agora).
  const agora = new Date().toISOString();
  const tomada = c.tomadas.find((t) => t.foto_tomada_id === fotoTomadaId) || null;
  const antes = c.revisoes.find((x) => x.foto_tomada_id === fotoTomadaId && x.versao === versao);
  const revisao: RevisaoDePublicidade = {
    id: antes ? antes.id : crypto.randomUUID(),
    tomada_id: tomada ? tomada.id || null : null,
    foto_tomada_id: fotoTomadaId,
    versao,
    imagem_id: imagem && ehUuid(imagem.id) ? String(imagem.id) : v.imagem_id,
    storage_path: v.storage_path,
    avaliacao,
    aviso_jev: antes ? antes.aviso_jev : null,
    decisao: decisao === "aprovar" ? "aprovada" : "reprovada",
    motivo: decisao === "aprovar" ? (confirmo && avaliacao.veredito === "nao_determinavel" ? "Produto confirmado pela equipe ao lado das fontes." : "") : motivo,
    decidido_em: agora,
  };
  if (e.banco && c.id) {
    const { error } = await servico().from("publicidade_revisoes").upsert({
      id: revisao.id, campanha_id: c.id, client_id: c.client_id, tomada_id: revisao.tomada_id, ensaio_id: c.ensaio_id,
      foto_tomada_id: fotoTomadaId, versao, imagem_id: revisao.imagem_id, storage_path: revisao.storage_path, avaliacao,
      aviso_jev: revisao.aviso_jev, decisao: revisao.decisao, motivo: revisao.motivo || null, decidido_por: ch.userId, decidido_em: agora, atualizado_em: agora,
    }, { onConflict: "campanha_id,foto_tomada_id,versao" });
    if (error) throw new ErroHttp(503, "revisao_nao_gravada", "A decisão foi feita na Mesa Foto, mas a revisão não foi gravada aqui. Atualize a tela.");
    if (tomada && tomada.id) {
      await servico().from("publicidade_tomadas").update({ status: revisao.decisao === "aprovada" ? "aprovada" : "reprovada", atualizado_em: agora }).eq("id", tomada.id).eq("campanha_id", c.id);
    }
    e.c = { ...c, revisoes: c.revisoes.filter((x) => x !== antes).concat([revisao]) };
    await tocarCampanha(e.c);
  } else {
    e.c = {
      ...c,
      revisoes: c.revisoes.filter((x) => x !== antes).concat([revisao]),
      tomadas: c.tomadas.map((t) => (t.foto_tomada_id === fotoTomadaId ? { ...t, status: revisao.decisao === "aprovada" ? "aprovada" : "reprovada" } : t)),
    };
  }
  return { campanha: await atual(ch, e), revisao, custo_usd: 0 };
}

async function revisaoDecidir(ch: Chamador, corpo: Record<string, unknown>) {
  const e = await estadoDoPedido(ch, corpo);
  const decisao = corpo.decisao === "aprovar" || corpo.decisao === "reprovar" ? corpo.decisao : null;
  if (!decisao) throw new ErroHttp(400, "decisao_invalida", "decisao: aprovar ou reprovar.");
  const fotoTomada = limpo(corpo.foto_tomada_id, 80);
  const versao = Number(corpo.versao);
  if (!fotoTomada || !isFinite(versao) || versao < 1) throw new ErroHttp(400, "foto_invalida", "Informe foto_tomada_id e versao.");
  return json(await decidirRevisao(ch, e, fotoTomada, versao, decisao, limpo(corpo.motivo, 800), corpo.confirmo_produto === true));
}

// ------------------------------------------------------------------ encaminhar (Mesa e Mesa Ads)

async function encaminharAtivos(ch: Chamador, e: Estado, destino: DestinoDoAtivo, escolhidas: string[] | null) {
  const c = e.c;
  const { vao, ficam } = paraEncaminhar(c.revisoes, destino, c.encaminhamentos, escolhidas);
  const novos: string[] = [];
  if (vao.length && e.banco && c.id) {
    const linhas = vao.map((r) => ({
      campanha_id: c.id, client_id: c.client_id, revisao_id: ehUuid(r.id) ? r.id : null, imagem_id: r.imagem_id, destino,
      linhagem: montarLinhagem(c, r), anuncio_aprovado: false, verba_aprovada: false, criado_por: ch.userId,
    }));
    const { data, error } = await servico().from("publicidade_encaminhamentos").upsert(linhas, { onConflict: "campanha_id,imagem_id,destino", ignoreDuplicates: true }).select("id");
    if (error) throw falhaDeBanco(error, "registrar o envio");
    ((data || []) as Linha[]).forEach((x) => novos.push(String(x.id)));
    e.c = { ...c };
    await tocarCampanha({ ...c, encaminhamentos: c.encaminhamentos.concat(vao.map((r) => ({ id: "", destino, imagem_id: String(r.imagem_id), linhagem: montarLinhagem(c, r), anuncio_aprovado: false, verba_aprovada: false, criado_em: null }))) });
  } else if (vao.length) {
    e.c = {
      ...c,
      encaminhamentos: c.encaminhamentos.concat(vao.map((r) => ({ id: crypto.randomUUID(), destino, imagem_id: String(r.imagem_id), linhagem: montarLinhagem(c, r), anuncio_aprovado: false, verba_aprovada: false, criado_em: new Date().toISOString() }))),
    };
  }
  const imagemIds = vao.map((r) => String(r.imagem_id));
  const todas = c.encaminhamentos.filter((x) => x.destino === destino).map((x) => x.imagem_id).concat(imagemIds);
  return {
    campanha: await atual(ch, e),
    destino,
    imagem_ids: imagemIds,
    encaminhamento_ids: novos,
    ficam: ficam.map((f) => ({ revisao_id: f.revisao.id, motivo: f.motivo })),
    endereco: enderecoDoDestino(destino, c.client_id, Array.from(new Set(todas))),
    linhagem_registrada: e.banco,
    aviso: "Aprovar a foto não aprova anúncio nem verba: cada destino tem aprovação própria.",
  };
}

async function encaminhar(ch: Chamador, corpo: Record<string, unknown>) {
  const e = await estadoDoPedido(ch, corpo);
  const destino = corpo.destino === "mesa" || corpo.destino === "ads" ? (corpo.destino as DestinoDoAtivo) : null;
  if (!destino) throw new ErroHttp(400, "destino_invalido", "destino: mesa ou ads.");
  const ids = Array.isArray(corpo.revisao_ids) ? corpo.revisao_ids.map(String).slice(0, 40) : null;
  return json(await encaminharAtivos(ch, e, destino, ids));
}

async function apagarEncaminhamentos(c: CampanhaDePublicidade, ids: string[]) {
  const validos = ids.filter(ehUuid);
  if (!c.id || !validos.length) return 0;
  const { data, error } = await servico().from("publicidade_encaminhamentos").delete().eq("campanha_id", c.id).eq("client_id", c.client_id).in("id", validos).select("id");
  if (error) throw falhaDeBanco(error, "desfazer o envio");
  return ((data || []) as Linha[]).length;
}

async function encaminhamentoDesfazer(ch: Chamador, corpo: Record<string, unknown>) {
  const c = await lerCampanha(ch, idDe(corpo.campanha_id, "campanha_id"));
  const ids = Array.isArray(corpo.encaminhamento_ids) ? corpo.encaminhamento_ids.map(String) : [];
  const n = await apagarEncaminhamentos(c, ids);
  const nova = await lerCampanha(ch, c.id!);
  await tocarCampanha(nova);
  return json({ campanha: nova, desfeitos: n });
}

// ------------------------------------------------------------------ agente da mesa

async function conversaDoAgente(ch: Chamador, clientId: string, conversaId: unknown, campanhaId: string | null, nova: boolean): Promise<string> {
  if (!nova && conversaId) {
    const id = idDe(conversaId, "conversa_id");
    const { data } = await servico().from("agente_conversas").select("id, client_id, referencia_tipo").eq("id", id).maybeSingle();
    const c = data as Linha | null;
    if (!c || c.client_id !== clientId || c.referencia_tipo !== REF_CONVERSA) throw new ErroHttp(404, "conversa_inexistente", "Conversa não encontrada para este cliente.");
    return String(c.id);
  }
  if (!nova) {
    let q = servico().from("agente_conversas").select("id").eq("client_id", clientId).eq("agente", AGENTE_DIRETOR).eq("referencia_tipo", REF_CONVERSA);
    q = campanhaId ? q.eq("referencia_id", campanhaId) : q.is("referencia_id", null);
    const { data } = await q.order("criado_em", { ascending: false }).limit(1);
    const achada = ((data || []) as Linha[])[0];
    if (achada) return String(achada.id);
  }
  const { data, error } = await servico().from("agente_conversas")
    .insert({ client_id: clientId, agente: AGENTE_DIRETOR, referencia_tipo: REF_CONVERSA, referencia_id: campanhaId, criado_por: ch.userId })
    .select("id").single();
  if (error || !data) throw new ErroHttp(503, "conversa_nao_criada", "Não foi possível abrir a conversa com o agente.");
  return String((data as Linha).id);
}

function resumoDaCampanhaParaOAgente(c: CampanhaDePublicidade): string {
  const t = c.territorios.find((x) => x.id === c.territorio_id);
  return JSON.stringify({
    campanha: c.nome,
    status: statusDaCampanha(c),
    produto: c.kit_nome || null,
    categoria: c.categoria,
    briefing: { versao: c.briefing_versao, ...c.briefing, lacunas: lacunasDoBriefing(c.briefing) },
    territorios: c.territorios.map((x) => ({ nome: x.nome, status: x.status, conceito: x.conceito })),
    territorio_aprovado: t ? t.nome : null,
    tomadas: c.tomadas.map((x) => ({ funcao: x.funcao, status: x.status })),
    ensaio_na_mesa_foto: !!c.ensaio_id,
    revisoes: c.revisoes.map((r) => ({ veredito: r.avaliacao.veredito, mudancas: r.avaliacao.mudancas, decisao: r.decisao })),
    enviados: c.encaminhamentos.map((x) => x.destino),
  }).slice(0, 8000);
}

/** O sistema do agente: base com o conhecimento, a campanha aberta e, quando o pedido é de ação, a lista com apelidos. */
function sistemaDoAgente(c: CampanhaDePublicidade | null, comAcoes: boolean): string {
  const NL = String.fromCharCode(10);
  return [
    SISTEMA_DO_AGENTE,
    c ? `${NL}CAMPANHA ABERTA (dados reais):${NL}${resumoDaCampanhaParaOAgente(c)}` : `${NL}Nenhuma campanha aberta: oriente a escolher o produto e abrir uma.`,
    comAcoes && c ? blocoDasAcoesDaPublicidade(c) : `${NL}- acoes: sempre null nesta conversa (não há campanha salva ou o pedido não é de ação).`,
    `${NL}Responda só com o JSON pedido (resposta e acoes).`,
  ].join(NL);
}

async function agenteConversar(ch: Chamador, corpo: Record<string, unknown>) {
  const clientId = idDe(corpo.client_id, "client_id");
  await garantirAcesso(ch, clientId);
  const mensagem = limpo(corpo.mensagem, 4000, true);
  if (!mensagem) throw new ErroHttp(400, "mensagem_vazia", "Escreva o que precisa.");
  let c: CampanhaDePublicidade | null = null;
  if (corpo.campanha_id) {
    c = await lerCampanha(ch, idDe(corpo.campanha_id, "campanha_id"));
    if (c.client_id !== clientId) throw new ErroHttp(403, "sem_acesso_ao_cliente", "Esta campanha é de outro cliente.");
  } else if (corpo.rascunho && typeof corpo.rascunho === "object") {
    c = { ...normalizarCampanha(corpo.rascunho, clientId), id: null, persistida: false };
    if (c.client_id !== clientId) c = null;
  }
  const conversaId = await conversaDoAgente(ch, clientId, corpo.conversa_id, c && c.id ? c.id : null, corpo.nova === true);
  const { data: hist } = await servico().from("agente_mensagens").select("papel, conteudo, criado_em").eq("conversa_id", conversaId).order("criado_em", { ascending: false }).limit(12);
  const historico = ((hist || []) as Linha[]).reverse().filter((m) => m.papel === "usuario" || m.papel === "agente")
    .map((m) => ({ papel: m.papel as "usuario" | "agente", conteudo: String(m.conteudo || "").slice(0, 4000) }));
  const comAcoes = !!(c && c.id) && pedeAcaoNaPublicidade(mensagem);
  const modelo = await modeloDeTexto(corpo.modelo_id);
  const saida = await chamarTexto({
    clientId,
    tarefa: "conversa",
    agente: AGENTE_DIRETOR,
    modeloId: modelo.id,
    sistema: sistemaDoAgente(c, comAcoes),
    mensagens: [...historico, { papel: "usuario", conteudo: mensagem }],
    esquemaJson: ESQUEMA_DO_AGENTE,
    maxTokensSaida: 4_000,
    timeoutMs: TIMEOUT_TEXTO_MS,
    referencia: c && c.id ? { tipo: REF_CAMPANHA, id: c.id } : undefined,
    criadoPor: ch.userId,
  });
  const r = (saida.json ?? {}) as Record<string, unknown>;
  const resposta = limpo(r.resposta, 6000, true) || "Não consegui responder agora.";
  const acao: AcaoDoAgente | null = comAcoes && c ? normalizarAcoesDaPublicidade(r.acoes, c) : null;
  const base = Date.now();
  const { data: gravadas } = await servico().from("agente_mensagens").insert([
    { conversa_id: conversaId, client_id: clientId, criado_em: new Date(base).toISOString(), papel: "usuario", conteudo: mensagem, anexos: [] },
    { conversa_id: conversaId, client_id: clientId, criado_em: new Date(base + 1).toISOString(), papel: "agente", conteudo: resposta, anexos: acao ? [acao] : [], uso_id: saida.usoId || null },
  ]).select("id, papel");
  const mensagemId = ((gravadas || []) as Linha[]).find((m) => m.papel === "agente");
  return json({
    conversa_id: conversaId,
    mensagem_id: mensagemId ? String(mensagemId.id) : null,
    resposta,
    acao: mensagemId ? acao : null,
    custo_usd: saida.custoUsd,
    saldo_usd: saida.saldoUsd,
  });
}

async function agenteHistorico(ch: Chamador, corpo: Record<string, unknown>) {
  const clientId = idDe(corpo.client_id, "client_id");
  await garantirAcesso(ch, clientId);
  const campanhaId = ehUuid(corpo.campanha_id) ? String(corpo.campanha_id) : null;
  let q = servico().from("agente_conversas").select("id").eq("client_id", clientId).eq("agente", AGENTE_DIRETOR).eq("referencia_tipo", REF_CONVERSA);
  q = campanhaId ? q.eq("referencia_id", campanhaId) : q.is("referencia_id", null);
  const { data } = await q.order("criado_em", { ascending: false }).limit(1);
  const conversa = ((data || []) as Linha[])[0];
  if (!conversa) return json({ conversa_id: null, mensagens: [] });
  const { data: msgs } = await servico().from("agente_mensagens").select("id, papel, conteudo, anexos, criado_em").eq("conversa_id", conversa.id).order("criado_em", { ascending: false }).limit(40);
  return json({ conversa_id: conversa.id, mensagens: ((msgs || []) as Linha[]).reverse() });
}

async function propostaDaPublicidade(ch: Chamador, corpo: Record<string, unknown>) {
  return await acaoGuardadaNaMensagem(servico(), corpo.mensagem_id, (clientId) => garantirAcesso(ch, clientId), { acaoId: corpo.acao_id, agente: "publicidade" });
}

async function executarItem(ch: Chamador, campanhaId: string, item: ItemDaAcaoDoAgente): Promise<{ desfazer?: Record<string, unknown> | null; aviso?: string } | void> {
  // A campanha é relida a cada item: um item anterior pode ter mudado o estado.
  const e: Estado = { c: await lerCampanha(ch, campanhaId), banco: true };
  if (item.operacao === "propor_territorios") {
    const r = await proporTerritorios(ch, e, null);
    return { aviso: `Custo: US$ ${Number(r.custo_usd || 0).toFixed(4)}.` };
  }
  if (item.operacao === "pedir_tomadas") {
    if (e.c.territorio_id !== item.alvo_id) throw new ErroDaAcao(409, "territorio_nao_aprovado", "Este território não é o aprovado.");
    const r = await pedirTomadas(ch, e, {});
    return { aviso: r.ja_pedido ? "O ensaio já existia na Mesa Foto." : `Custo: US$ ${Number(r.custo_usd || 0).toFixed(4)}.` };
  }
  const revisao = e.c.revisoes.find((r) => r.id === item.alvo_id);
  if (!revisao) throw new ErroDaAcao(404, "foto_inexistente", "Foto não encontrada na revisão desta campanha.");
  if (item.operacao === "reprovar_foto") {
    await decidirRevisao(ch, e, revisao.foto_tomada_id, revisao.versao, "reprovar", "", false);
    return;
  }
  if (item.operacao === "mandar_para_ads" || item.operacao === "mandar_para_mesa") {
    const destino: DestinoDoAtivo = item.operacao === "mandar_para_ads" ? "ads" : "mesa";
    const r = await encaminharAtivos(ch, e, destino, [revisao.id]);
    if (!r.imagem_ids.length) throw new ErroDaAcao(409, "nao_enviada", r.ficam.length ? r.ficam[0].motivo : "Nada para enviar.");
    return { desfazer: { encaminhamento_ids: r.encaminhamento_ids }, aviso: `Abrir: ${r.endereco}` };
  }
  throw new ErroDaAcao(400, "operacao_desconhecida", "Operação desconhecida.");
}

async function executarAcaoDoAgente(ch: Chamador, corpo: Record<string, unknown>) {
  const guardada = await propostaDaPublicidade(ch, corpo);
  const campanhaId = String((guardada.acao.contexto || {}).campanha_id || "");
  if (!ehUuid(campanhaId)) throw new ErroHttp(409, "sem_campanha", "Esta ação não está ligada a uma campanha salva.");
  const inicio = Date.now();
  const r = await confirmarAcaoGuardada(guardada, (item) => executarItem(ch, campanhaId, item), { descartar: corpo.descartar === true, userId: ch.userId, lote: 1 });
  if (corpo.descartar === true) return json({ anexo: r.anexo });
  const feitos = r.resultados.filter((x) => x.ok).length;
  const falhas = r.resultados.length - feitos;
  if (guardada.mensagem.conversa_id) {
    await servico().from("agente_mensagens").insert({ conversa_id: guardada.mensagem.conversa_id, client_id: guardada.mensagem.client_id, papel: "sistema", conteudo: `Publicidade: ${textoDoResultado(r.resultados)}.` }).then(() => undefined, () => undefined);
  }
  await auditLog({
    correlationId: crypto.randomUUID(), toolName: "publicidade_acao_do_agente", origin: "mesa:mesa-publicidade",
    keyId: `mesa:mesa-publicidade:${ch.userId}`, scopes: ["files:write"],
    input: { client_id: guardada.mensagem.client_id, campanha_id: campanhaId, mensagem_id: guardada.mensagem.id, operacoes: r.anexo.itens.map((i) => i.operacao) },
    success: falhas === 0, statusCode: 200, durationMs: Date.now() - inicio, resultRef: guardada.mensagem.id,
  });
  return json({ anexo: r.anexo, feitos, falhas, campanha: await lerCampanha(ch, campanhaId) });
}

async function desfazerAcaoDoAgente(ch: Chamador, corpo: Record<string, unknown>) {
  const guardada = await propostaDaPublicidade(ch, corpo);
  const campanhaId = String((guardada.acao.contexto || {}).campanha_id || "");
  if (!ehUuid(campanhaId)) throw new ErroHttp(409, "sem_campanha", "Esta ação não está ligada a uma campanha salva.");
  const c = await lerCampanha(ch, campanhaId);
  const r = await desfazerAcaoGuardada(guardada, async (x: ResultadoDoItem) => {
    const ids = x.desfazer && Array.isArray(x.desfazer.encaminhamento_ids) ? (x.desfazer.encaminhamento_ids as unknown[]).map(String) : [];
    if (!ids.length) throw new Error("Sem registro para desfazer.");
    await apagarEncaminhamentos(c, ids);
  }, { userId: ch.userId });
  await auditLog({
    correlationId: crypto.randomUUID(), toolName: "publicidade_desfazer_acao_do_agente", origin: "mesa:mesa-publicidade",
    keyId: `mesa:mesa-publicidade:${ch.userId}`, scopes: ["files:write"],
    input: { client_id: guardada.mensagem.client_id, campanha_id: campanhaId, mensagem_id: guardada.mensagem.id }, success: r.falharam.length === 0, statusCode: 200, durationMs: 0, resultRef: guardada.mensagem.id,
  });
  const nova = await lerCampanha(ch, campanhaId);
  await tocarCampanha(nova);
  return json({ anexo: r.anexo, voltaram: r.voltaram, falharam: r.falharam, campanha: nova });
}

// ------------------------------------------------------------------ roteamento

const ACOES: Record<string, (ch: Chamador, corpo: Record<string, unknown>) => Promise<Response>> = {
  receitas: () => Promise.resolve(json({ receitas: RECEITAS_DE_PUBLICIDADE })),
  campanhas_listar: campanhasListar,
  campanha_criar: campanhaCriar,
  campanha_abrir: campanhaAbrir,
  briefing_salvar: briefingSalvar,
  territorios_propor: territoriosPropor,
  territorio_aprovar: territorioAprovar,
  tomadas_salvar: tomadasSalvar,
  tomadas_pedir: tomadasPedir,
  revisao_avaliar: revisaoAvaliar,
  revisao_decidir: revisaoDecidir,
  encaminhar,
  encaminhamento_desfazer: encaminhamentoDesfazer,
  agente_conversar: agenteConversar,
  agente_historico: agenteHistorico,
  executar_acao_agente: executarAcaoDoAgente,
  desfazer_acao_agente: desfazerAcaoDoAgente,
};

/** Ações que podem passar de 150 s (IA, Mesa Foto, Jev): a resposta começa na hora (resposta-com-folego.ts). */
const ACOES_LONGAS = new Set(["territorios_propor", "tomadas_pedir", "revisao_avaliar", "revisao_decidir", "agente_conversar", "executar_acao_agente"]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "metodo_nao_permitido", mensagem: "Use POST." }, 405);
  try {
    const chamador = await identificar(req);
    let corpo: Record<string, unknown> = {};
    try {
      corpo = await req.json();
    } catch { /* corpo vazio */ }
    const acao = String(corpo.acao ?? "");
    const fn = ACOES[acao];
    if (!fn) return json({ error: "acao_desconhecida", mensagem: "Ação desconhecida.", aceitas: Object.keys(ACOES) }, 400);
    const rodar = async () => {
      try {
        return await fn(chamador, corpo);
      } catch (err) {
        return respostaDeErro(err);
      }
    };
    return ACOES_LONGAS.has(acao) ? respostaComFolego(rodar, corsHeaders) : await rodar();
  } catch (err) {
    return respostaDeErro(err);
  }
});
