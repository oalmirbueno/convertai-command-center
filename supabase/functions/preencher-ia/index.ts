/**
 * preencher-ia: a peça comum "Preencher com IA" das mesas (frente PIA, 30/09/2026).
 *
 * POST { acao, ... }, só equipe (is_staff) e, com cliente, só quem tem acesso
 * a ele (can_access_client). Erro sai como { error, mensagem } (no preencher,
 * com fôlego, o status real vai em status_http).
 *
 * - estimar { papel, modelo_id?, campos, fontes?, client_id?, substituir?, instrucao?, contexto? }
 *   -> { partes: [{ nome, custo_usd, tokens? }], custo_usd, modelo_id, modelo_nome, campos_a_preencher } (sem IA)
 * - preencher { client_id, marca_id?, papel, modelo_id?, campos, contexto?, fontes?, instrucao?, substituir?, conversa_id? }
 *   -> ResultadoDoPreenchimento { valores, modelo_id, custo_usd, fontes, avisos } + saldo_usd
 *
 * Por dentro (regras em _shared/preencher-com-ia.ts):
 * - fontes pela regra de marca: contexto (lerContextoDaMarca), briefing mais
 *   novo da marca, dossiê da marca, trechos de file_content_chunks do cliente
 *   (busca simples pelas palavras dos rótulos) e a conversa do agente da mesa;
 *   "web" liga a pesquisa na web do ia-motor;
 * - esquema JSON estrito montado dos campos; só os vazios vão ao modelo, a
 *   menos que venha substituir;
 * - nada inventado: número e nome que não estão nas fontes esvaziam o campo,
 *   com aviso (conferido por código);
 * - garantirSaldo antes; o uso fica com tarefa e agente = papel (um dos 9).
 * - UXM: fonte "base" (UI UX Pro Max 2.15.0), padrão nos papéis site e
 *   identidade: o base_de_design da marca (último site da marca ou o projeto
 *   de Identidade dela) vira um bloco com apelidos b1..bN; a resposta traz
 *   regras_usadas e a regra aparece nas fontes do resultado.
 * Nada é gravado aqui: a tela mostra a prévia e a mesa grava ao Aplicar.
 */

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { chamarTexto, estimarComModelo, garantirSaldo, IaMotorErro, modeloDoPapel, type ModeloIa, type PapelDasMesasNovas } from "../_shared/ia-motor.ts";
import { lerContextoConsolidado } from "../_shared/contexto-cliente.ts";
import { lerContextoDaMarca, lerDossieDaMarca, type MarcaDoCliente, type MarcaLeve, marcasDoCliente, resolverMarca } from "../_shared/marca.ts";
import { projetoDaMarcaAberta } from "../_shared/heranca-da-marca.ts";
import { contextoCompletoParaPrompt } from "../_shared/contexto-completo-da-marca.ts";
import { itensDaBaseDeDesign } from "../_shared/uiux/base-completa.ts";
import { blocoDaBaseDeDesign, type ItemDaBase, regrasParaCampos, rotuloDaCitacao, TETO_DO_BLOCO_DO_PREENCHER } from "../_shared/uiux/citar.ts";
import { lerBaseDaMarca, lerBaseDeDesign } from "../_shared/uiux/consultas.ts";
import { linhasDoBriefing, limparSegredos } from "../_shared/pacote-externo.ts";
import { respostaComFolego } from "../_shared/resposta-com-folego.ts";
import { registrarFalha } from "../_shared/falha-registrada.ts";
import {
  type CampoParaPreencher,
  camposAPreencher,
  ehPapelQuePreenche,
  type FonteDoPreenchimento,
  type FonteLida,
  limparResposta,
  MAX_CONTEXTO_DA_TELA,
  MAX_INSTRUCAO,
  montarPedido,
  normalizarCampos,
  normalizarFontes,
  palavrasDeBusca,
  type RegraDaBaseNoPedido,
  type ResultadoDoPreenchimento,
  resultadoVazio,
  tetoDeSaida,
  tokensDaEstimativa,
} from "../_shared/preencher-com-ia.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class ErroHttp extends Error {
  status: number;
  codigo: string;
  constructor(status: number, codigo: string, mensagem: string) {
    super(mensagem);
    this.status = status;
    this.codigo = codigo;
  }
}

const MENSAGEM_MOTOR: Record<string, { status: number; mensagem: string }> = {
  saldo_insuficiente: { status: 402, mensagem: "Saldo insuficiente na carteira de IA deste cliente. Peça a recarga a um admin ou gestor." },
  cota_da_chave_esgotada: { status: 402, mensagem: "A cota do mês da chave de IA deste cliente acabou." },
  cliente_sem_chave: { status: 403, mensagem: "Este cliente não tem chave de IA própria e o uso da chave da agência está desligado para ele." },
  provedor_sem_chave: { status: 503, mensagem: "O provedor deste modelo está sem chave de API configurada." },
  json_invalido: { status: 502, mensagem: "O modelo respondeu fora do formato. Tente de novo ou troque o modelo." },
};

function respostaDeErro(err: unknown): Response {
  if (err instanceof ErroHttp) return json({ error: err.codigo, mensagem: err.message }, err.status);
  if (err instanceof IaMotorErro) {
    const conhecido = MENSAGEM_MOTOR[err.codigo];
    const status = conhecido?.status ?? (err.status >= 400 ? err.status : 500);
    return json({ ...err.paraJson(), mensagem: conhecido?.mensagem ?? err.message }, status);
  }
  registrarFalha("preencher-ia: erro inesperado", err);
  return json({ error: "erro_interno", mensagem: "Falha inesperada ao preencher com IA." }, 500);
}

// ------------------------------------------------------------------ banco e acesso

type Chamador = { userId: string; doChamador: SupabaseClient };

let servicoCache: SupabaseClient | null = null;
function servico(): SupabaseClient {
  if (!servicoCache) {
    servicoCache = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return servicoCache;
}

async function identificar(req: Request): Promise<Chamador> {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new ErroHttp(401, "sessao_expirada", "Sessão expirada. Entre de novo no painel.");
  const { data: user } = await servico().auth.getUser(token);
  const userId = user?.user?.id;
  if (!userId) throw new ErroHttp(401, "sessao_expirada", "Sessão expirada. Entre de novo no painel.");
  const { data: staff, error } = await servico().rpc("is_staff", { _user_id: userId });
  if (error) throw new ErroHttp(503, "autorizacao_indisponivel", "Não foi possível conferir a permissão agora.");
  if (staff !== true) throw new ErroHttp(403, "somente_equipe", "Somente a equipe preenche com IA.");
  const doChamador = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return { userId, doChamador };
}

async function garantirAcesso(ch: Chamador, clientId: string) {
  if (!UUID.test(clientId)) throw new ErroHttp(400, "client_id_invalido", "client_id precisa ser um UUID.");
  const { data, error } = await ch.doChamador.rpc("can_access_client", { _client_id: clientId });
  if (error) throw new ErroHttp(503, "autorizacao_indisponivel", "Não foi possível conferir o acesso ao cliente agora.");
  if (data !== true) throw new ErroHttp(403, "sem_acesso_ao_cliente", "Você não tem acesso a este cliente.");
}

const limpo = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

function lerPapel(v: unknown): PapelDasMesasNovas {
  if (!ehPapelQuePreenche(v)) {
    throw new ErroHttp(400, "papel_invalido", "Papel desconhecido. Use proposta, contrato, briefing, conselho, identidade, naming, site, motion ou documento.");
  }
  return v as PapelDasMesasNovas;
}

function lerCampos(v: unknown): CampoParaPreencher[] {
  try {
    return normalizarCampos(v);
  } catch (e) {
    throw new ErroHttp(400, "campos_invalidos", e instanceof Error ? e.message : "Campos inválidos.");
  }
}

async function modeloDoPedido(papel: PapelDasMesasNovas, modeloId: unknown): Promise<ModeloIa> {
  const escolhido = limpo(modeloId, 200) || null;
  const m = await modeloDoPapel(papel, escolhido);
  if (!m) throw new ErroHttp(409, "sem_modelo", "Nenhum modelo de texto ligado para este papel. Ligue um em Modelos de IA.");
  return m;
}

const nomeDoModelo = (m: ModeloIa) => m.rotulo || m.modelo_api || m.id;

const NOMES_DAS_PARTES: Record<FonteDoPreenchimento, string> = {
  contexto: "Contexto da marca",
  briefing: "Briefing",
  dossie: "Dossiê",
  arquivos: "Arquivos do cliente",
  conversa: "Conversa do agente",
  web: "Pesquisa na web",
  base: "Base de design (UI UX Pro Max)",
};

function estimativa(m: ModeloIa, campos: CampoParaPreencher[], fontes: FonteDoPreenchimento[], extras: number) {
  const t = tokensDaEstimativa(campos, fontes, extras);
  const partes: Array<{ nome: string; custo_usd: number; tokens?: number }> = [];
  partes.push({ nome: "Pedido e campos", tokens: t.pedido, custo_usd: estimarComModelo(m, { tokensEntrada: t.pedido, tokensSaida: 0 }) });
  for (const f of t.fontes) {
    const custo = estimarComModelo(m, { tokensEntrada: f.tokens, tokensSaida: 0, buscasWeb: f.fonte === "web" ? t.buscasWeb : 0 });
    partes.push({ nome: NOMES_DAS_PARTES[f.fonte], tokens: f.tokens, custo_usd: custo });
  }
  partes.push({ nome: "Resposta", tokens: t.saida, custo_usd: estimarComModelo(m, { tokensEntrada: 0, tokensSaida: t.saida }) });
  const total = Math.round(partes.reduce((s, p) => s + p.custo_usd, 0) * 1e6) / 1e6;
  return { partes, custo_usd: total };
}

// ------------------------------------------------------------------ fontes

const dataCurta = (iso: unknown) => {
  const d = new Date(String(iso || ""));
  return Number.isNaN(d.getTime()) ? "" : `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};

function textoDoContexto(c: unknown): string {
  if (!c || typeof c !== "object") return "";
  const linhas: string[] = [];
  for (const [k, v] of Object.entries(c as Record<string, unknown>)) {
    if (k === "fontes_lidas" || k === "lacunas" || v == null) continue;
    const valor = typeof v === "string" ? v : Array.isArray(v) ? v.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join("; ") : JSON.stringify(v);
    if (valor && valor.trim() && valor !== "{}") linhas.push(`${k.replace(/_/g, " ")}: ${valor.trim()}`);
  }
  return limparSegredos(linhas.join("\n")).slice(0, 4000);
}

async function lerBriefing(clientId: string, marca: MarcaLeve | null): Promise<FonteLida | null> {
  // Mais novo da marca: a outra marca só o dela; a principal, o dela e o sem marca.
  let q = servico().from("briefings").select("responses, submitted, created_at, marca_id, arquivado_em").eq("client_id", clientId);
  if (marca && !marca.principal) q = q.eq("marca_id", marca.id);
  else if (marca) q = q.or(`marca_id.is.null,marca_id.eq.${marca.id}`);
  let { data, error } = await q.order("created_at", { ascending: false }).limit(6);
  if (error) {
    // Banco sem as colunas novas do briefing: só a outra marca fica sem (nunca herda da principal).
    registrarFalha("preencher-ia: briefing com marca falhou", error, { client_id: clientId });
    if (marca && !marca.principal) return null;
    const velho = await servico().from("briefings").select("responses, submitted, created_at").eq("client_id", clientId).order("created_at", { ascending: false }).limit(6);
    if (velho.error) throw velho.error;
    data = velho.data as typeof data;
    error = null;
  }
  const lista = ((data ?? []) as Array<{ responses: unknown; submitted: boolean | null; created_at: string | null; arquivado_em?: string | null }>)
    .filter((b) => !b.arquivado_em && b.responses && typeof b.responses === "object" && Object.keys(b.responses as object).length);
  const b = lista[0];
  if (!b) return null;
  const linhas = linhasDoBriefing(b.responses);
  if (!linhas.length) return null;
  const quando = dataCurta(b.created_at);
  return { id: "briefing", rotulo: `briefing${quando ? ` de ${quando}` : ""}${b.submitted ? "" : " (não enviado)"}`, texto: linhas.join("\n") };
}

async function lerArquivos(clientId: string, marca: MarcaLeve | null, palavras: string[]): Promise<FonteLida[]> {
  if (!palavras.length) return [];
  const filtro = palavras.map((p) => `text.ilike.%${p}%`).join(",");
  const { data, error } = await servico().from("file_content_chunks").select("file_id, project_id, text").eq("client_id", clientId).or(filtro).limit(24);
  if (error) throw error;
  let pedacos = ((data ?? []) as Array<{ file_id: string; project_id: string | null; text: string | null }>).filter((p) => p.text);
  if (marca) {
    const marcas = await marcasDoCliente(servico(), clientId);
    pedacos = pedacos.filter((p) => projetoDaMarcaAberta(p.project_id, marca, marcas));
  }
  if (!pedacos.length) return [];
  const ids = Array.from(new Set(pedacos.map((p) => p.file_id))).slice(0, 12);
  const { data: arquivos } = await servico().from("files").select("id, file_name, archived_at").in("id", ids);
  const nomes = new Map(((arquivos ?? []) as Array<{ id: string; file_name: string; archived_at: string | null }>).filter((f) => !f.archived_at).map((f) => [f.id, f.file_name]));
  const porArquivo = new Map<string, string[]>();
  for (const p of pedacos) {
    const nome = nomes.get(p.file_id);
    if (!nome) continue;
    const trechos = porArquivo.get(nome) || [];
    if (trechos.length >= 3) continue;
    trechos.push(trechoEm(String(p.text), palavras));
    porArquivo.set(nome, trechos);
  }
  const saida: FonteLida[] = [];
  for (const [nome, trechos] of porArquivo) {
    if (saida.length >= 5) break;
    saida.push({ id: "arquivos", rotulo: `arquivo ${nome}`, texto: limparSegredos(trechos.join("\n...\n")).slice(0, 1800) });
  }
  return saida;
}

function trechoEm(texto: string, palavras: string[]): string {
  const baixo = texto.toLowerCase();
  let i = -1;
  for (const p of palavras) {
    i = baixo.indexOf(p);
    if (i >= 0) break;
  }
  const inicio = Math.max(0, (i < 0 ? 0 : i) - 250);
  return texto.slice(inicio, inicio + 700).replace(/\s+/g, " ").trim();
}

async function lerConversa(clientId: string, papel: string, conversaId: string | null): Promise<FonteLida | null> {
  let id = conversaId;
  if (!id) {
    const { data, error } = await servico().from("agente_conversas").select("id").eq("client_id", clientId).eq("agente", papel).order("criado_em", { ascending: false }).limit(1);
    if (error) throw error;
    id = ((data ?? []) as Array<{ id: string }>)[0]?.id ?? null;
  }
  if (!id) return null;
  const { data, error } = await servico().from("agente_mensagens").select("papel, conteudo, criado_em").eq("conversa_id", id).eq("client_id", clientId).order("criado_em", { ascending: false }).limit(12);
  if (error) throw error;
  const linhas = ((data ?? []) as Array<{ papel: string; conteudo: string }>).reverse()
    .filter((m) => m.papel !== "sistema" && m.conteudo)
    .map((m) => `${m.papel === "usuario" ? "Equipe" : "Agente"}: ${String(m.conteudo).slice(0, 600)}`);
  if (!linhas.length) return null;
  return { id: "conversa", rotulo: "conversa com o agente da mesa", texto: limparSegredos(linhas.join("\n")) };
}

/**
 * UXM: a base de design da marca para o papel (site: o site mais novo da
 * marca; identidade: o projeto de Identidade mais novo da marca). A outra
 * marca nunca herda: a principal lê o dela e o sem marca.
 */
async function lerBaseDaMarcaDoPapel(clientId: string, marca: MarcaLeve | null, papel: string, campos: CampoParaPreencher[]): Promise<{ fonte: FonteLida | null; itens: ItemDaBase[] }> {
  // Mesma regra de marca do briefing: a outra marca só a dela; a principal, a dela e a sem marca.
  const soDaMarca = marca && !marca.principal ? marca.id : null;
  const comSemMarca = marca && marca.principal ? `marca_id.is.null,marca_id.eq.${marca.id}` : null;
  let itens: ItemDaBase[] = [];
  const regras = regrasParaCampos(campos);
  if (papel === "site") {
    let q = servico().from("sites").select("direcao, atualizado_em").eq("client_id", clientId).is("arquivado_em", null);
    if (soDaMarca) q = q.eq("marca_id", soDaMarca);
    else if (comSemMarca) q = q.or(comSemMarca);
    const { data, error } = await q.order("atualizado_em", { ascending: false }).limit(1);
    if (error) throw error;
    const linha = ((data ?? []) as Array<{ direcao: Record<string, unknown> | null }>)[0];
    const b = lerBaseDeDesign(linha && linha.direcao ? linha.direcao.base_de_design : null);
    itens = itensDaBaseDeDesign(b, { regras });
  } else if (papel === "identidade") {
    let q = servico().from("idv_projetos").select("dados, atualizado_em").eq("client_id", clientId).is("arquivado_em", null);
    if (soDaMarca) q = q.eq("marca_id", soDaMarca);
    else if (comSemMarca) q = q.or(comSemMarca);
    const { data, error } = await q.order("atualizado_em", { ascending: false }).limit(1);
    if (error) throw error;
    const linha = ((data ?? []) as Array<{ dados: Record<string, unknown> | null }>)[0];
    const sistema = linha && linha.dados && typeof linha.dados.sistema === "object" ? (linha.dados.sistema as Record<string, unknown>) : {};
    const b = lerBaseDaMarca(sistema.base_de_design);
    itens = itensDaBaseDeDesign({ produto: b.produto, par: b.par }, { regras, paletaDoSetor: b.paleta_setor ? b.paleta_setor.id : null });
  }
  const texto = blocoDaBaseDeDesign({ papel, itens, max: TETO_DO_BLOCO_DO_PREENCHER, campo: "regras_usadas" });
  return { fonte: texto ? { id: "base", rotulo: "base de design (UI UX Pro Max 2.15.0)", texto } : null, itens: texto ? itens : [] };
}

/** Lê as fontes pedidas; fonte que falha fica de fora, com aviso e no log (nunca engolida). */
async function lerFontes(
  clientId: string,
  marca: MarcaDoCliente | null,
  papel: string,
  fontes: FonteDoPreenchimento[],
  campos: CampoParaPreencher[],
  instrucao: string,
  conversaId: string | null,
): Promise<{ lidas: FonteLida[]; avisos: string[]; regrasDaBase: RegraDaBaseNoPedido[] }> {
  const avisos: string[] = [];
  // undefined = não pedida ou falhou (com aviso); null ou vazio = lida e sem nada.
  const passo = async <T>(nome: string, f: () => Promise<T>): Promise<T | undefined> => {
    try {
      return await f();
    } catch (e) {
      const motivo = registrarFalha(`preencher-ia: fonte ${nome} falhou`, e, { client_id: clientId });
      avisos.push(`Não deu para ler ${nome} agora (${motivo.slice(0, 120)}).`);
      return undefined;
    }
  };
  const quer = (f: FonteDoPreenchimento) => fontes.indexOf(f) >= 0;
  const [contexto, briefing, dossie, arquivos, conversa, base] = await Promise.all([
    quer("contexto")
      ? passo("o contexto da marca", async () => {
        const base = textoDoContexto(marca ? await lerContextoDaMarca(servico(), clientId, marca) : await lerContextoConsolidado(servico(), clientId));
        // Frente SYNC: com o contexto vêm a estratégia aprovada (tom e tagline), as decisões do conselho e o cérebro da marca.
        const completo = await contextoCompletoParaPrompt(servico(), clientId, marca, { area: "geral", partes: ["estrategia", "decisoes", "cerebro"], semTitulo: true, teto: 3000 })
          .then((c) => limparSegredos(c.bloco), (e) => (registrarFalha("preencher-ia: contexto completo não lido", e, { client_id: clientId }), ""));
        return [base, completo].filter(Boolean).join("\n\n");
      })
      : undefined,
    quer("briefing") ? passo("o briefing", () => lerBriefing(clientId, marca)) : undefined,
    quer("dossie") ? passo("o dossiê", () => lerDossieDaMarca(servico(), clientId, marca, 5000)) : undefined,
    quer("arquivos") ? passo("os arquivos", () => lerArquivos(clientId, marca, palavrasDeBusca(campos, instrucao))) : undefined,
    quer("conversa") ? passo("a conversa do agente", () => lerConversa(clientId, papel, conversaId)) : undefined,
    quer("base") ? passo("a base de design", () => lerBaseDaMarcaDoPapel(clientId, marca, papel, campos)) : undefined,
  ]);
  const lidas: FonteLida[] = [];
  const rotuloDaMarca = marca && !marca.principal ? ` (${marca.nome})` : "";
  if (contexto) lidas.push({ id: "contexto", rotulo: `contexto da marca${rotuloDaMarca}`, texto: contexto });
  else if (quer("contexto") && contexto !== undefined) avisos.push("O contexto da marca está vazio.");
  if (briefing) lidas.push(briefing);
  else if (quer("briefing") && briefing !== undefined) avisos.push("Não há briefing respondido desta marca.");
  if (dossie) lidas.push({ id: "dossie", rotulo: `dossiê${rotuloDaMarca}`, texto: limparSegredos(dossie) });
  else if (quer("dossie") && dossie !== undefined) avisos.push("Não há dossiê atual desta marca.");
  if (arquivos && arquivos.length) lidas.push(...arquivos);
  else if (quer("arquivos") && arquivos !== undefined) avisos.push("Nenhum trecho de arquivo do cliente bateu com os campos.");
  if (conversa) lidas.push(conversa);
  else if (quer("conversa") && conversa !== undefined) avisos.push("A conversa do agente desta mesa está vazia.");
  let regrasDaBase: RegraDaBaseNoPedido[] = [];
  if (base && base.fonte) {
    lidas.push(base.fonte);
    regrasDaBase = base.itens.map((i) => ({ apelido: i.apelido, id: i.id, rotulo: rotuloDaCitacao(i) }));
  } else if (quer("base") && base !== undefined) avisos.push(papel === "site" || papel === "identidade" ? "A marca ainda não escolheu a base de design (produto, estilo ou padrão)." : "A base de design vale para o site e a identidade.");
  return { lidas, avisos, regrasDaBase };
}

// ------------------------------------------------------------------ ações

async function acaoEstimar(ch: Chamador, corpo: Record<string, unknown>): Promise<Response> {
  const papel = lerPapel(corpo.papel);
  const campos = lerCampos(corpo.campos);
  const clientId = limpo(corpo.client_id, 64);
  if (clientId) await garantirAcesso(ch, clientId);
  const alvo = camposAPreencher(campos, corpo.substituir === true);
  const fontes = normalizarFontes(corpo.fontes);
  const m = await modeloDoPedido(papel, corpo.modelo_id);
  const extras = limpo(corpo.instrucao, MAX_INSTRUCAO).length + limpo(corpo.contexto, MAX_CONTEXTO_DA_TELA).length;
  const e = alvo.length ? estimativa(m, alvo, fontes, extras) : { partes: [], custo_usd: 0 };
  return json({ ...e, modelo_id: m.id, modelo_nome: nomeDoModelo(m), campos_a_preencher: alvo.length });
}

async function acaoPreencher(ch: Chamador, corpo: Record<string, unknown>): Promise<Response> {
  const papel = lerPapel(corpo.papel);
  const clientId = limpo(corpo.client_id, 64);
  await garantirAcesso(ch, clientId);
  const campos = lerCampos(corpo.campos);
  const substituir = corpo.substituir === true;
  const fontes = normalizarFontes(corpo.fontes);
  const instrucao = limpo(corpo.instrucao, MAX_INSTRUCAO);
  const contexto = limpo(corpo.contexto, MAX_CONTEXTO_DA_TELA);
  const conversaId = typeof corpo.conversa_id === "string" && UUID.test(corpo.conversa_id) ? corpo.conversa_id : null;
  const m = await modeloDoPedido(papel, corpo.modelo_id);

  const alvo = camposAPreencher(campos, substituir);
  if (!alvo.length) {
    return json(resultadoVazio(m.id, "Todos os campos já estão preenchidos. Marque \"substituir o que já tem\" para refazer."));
  }
  const web = fontes.indexOf("web") >= 0;
  // Saldo antes de ler e gastar (o motor confere de novo com o pedido pronto).
  await garantirSaldo(clientId, estimativa(m, alvo, fontes, instrucao.length + contexto.length).custo_usd);

  const marca = await resolverMarca(servico(), clientId, { marca_id: corpo.marca_id }).catch((e) => {
    registrarFalha("preencher-ia: marca do pedido falhou", e, { client_id: clientId });
    return null;
  });
  const { lidas, avisos: avisosDasFontes, regrasDaBase } = await lerFontes(clientId, marca, papel, fontes, alvo, instrucao, conversaId);

  const { sistema, mensagem, esquema } = montarPedido({ papel, campos: alvo, fontes: lidas, contexto, instrucao, web, substituir, regrasDaBase });
  const saida = await chamarTexto({
    clientId,
    tarefa: papel,
    agente: papel,
    modeloId: m.id,
    sistema,
    mensagens: [{ papel: "usuario", conteudo: mensagem }],
    esquemaJson: { nome: esquema.nome, schema: esquema.schema },
    pesquisaWeb: web,
    criadoPor: ch.userId,
    maxTokensSaida: tetoDeSaida(alvo),
  });

  const limpa = limparResposta(saida.json, { papel, mapa: esquema.mapa, fontes: lidas, instrucao, contexto, web, substituir, regrasDaBase });
  if (contexto) limpa.fontes.push("o que a tela sabe");
  const pulados = campos.length - alvo.length;
  const avisos = avisosDasFontes.concat(limpa.avisos);
  if (pulados > 0) avisos.push(`${pulados} ${pulados === 1 ? "campo já preenchido ficou" : "campos já preenchidos ficaram"} como estava${pulados === 1 ? "" : "m"}.`);
  const resultado: ResultadoDoPreenchimento & { saldo_usd: number; reserva_usada?: string } = {
    valores: limpa.valores,
    modelo_id: saida.modeloId,
    custo_usd: saida.custoUsd,
    fontes: limpa.fontes,
    avisos,
    saldo_usd: saida.saldoUsd,
  };
  if (limpa.regras_usadas.length) resultado.regras_usadas = limpa.regras_usadas;
  if (saida.reservaUsada) resultado.reserva_usada = saida.reservaUsada;
  return json(resultado);
}

const ACOES: Record<string, (ch: Chamador, corpo: Record<string, unknown>) => Promise<Response>> = {
  estimar: acaoEstimar,
  preencher: acaoPreencher,
};

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
    // Preencher chama o modelo (com web pode passar de 150 s): a resposta começa na hora.
    return acao === "preencher" ? respostaComFolego(rodar, corsHeaders) : await rodar();
  } catch (err) {
    return respostaDeErro(err);
  }
});
