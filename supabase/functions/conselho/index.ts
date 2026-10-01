/**
 * conselho: o conselho de agentes (frente CNS, 30/09/2026). Abre de qualquer
 * mesa pelo BotaoDoConselho (src/components/conselho). O núcleo (rodadas,
 * consenso, ata) é _shared/conselho.ts; aqui ficam o login, o acesso ao
 * cliente, o banco, o motor de IA, o Jev e a fila em passos.
 *
 * POST { acao, ... }, só equipe com acesso ao cliente.
 * - catalogo { origem? } -> { especialistas, padrao, criterios, limites, modelo_padrao } (sem IA)
 * - estimar { client_id, origem?, especialistas[], modelos?, rodadas } -> { estimativa, teto_sugerido_usd } (sem IA)
 * - convocar { client_id, origem?, referencia?, tema, pergunta, contexto?, especialistas[], modelos?, rodadas, teto_usd, criterios? }
 *   -> { sessao, estimativa } e a sessão começa a rodar em segundo plano
 * - avancar { sessao_id } -> { pegou } (um passo em segundo plano; a própria função chama o próximo; a Sala aberta é a vigia)
 * - perguntar { sessao_id, especialista, pergunta, novo_teto_usd? } -> { fala, custo_usd, saldo_usd } (com fôlego)
 * - nova_rodada { sessao_id, confirmar?, novo_teto_usd? } -> sem confirmar { estimativa }; com confirmar { sessao }
 * - parar { sessao_id } -> { sessao } (arquiva: status parada; nada é apagado)
 * - decidir { sessao_id, escolha: recomendacao|proposta|nenhuma, especialista?, nota? } -> { sessao, ata, memoria_id }
 *   (a ata vai para o cérebro do cliente como decisão, com o gancho do documento de entrega)
 * - desfazer_decisao { sessao_id } -> { sessao } (a memória fica marcada como desfeita, não some)
 * - ata { sessao_id } -> { ata, nome_do_arquivo } (sem IA)
 * Frente BRF2 (extras.ts e _shared/conselho-presets.ts): presets por tema e modos no catálogo;
 * estimar e convocar aceitam modo (rapido, padrao, profundo) e pauta { itens, anexos[] };
 * elencos, salvar_elenco, arquivar_elenco; ata_pdf { sessao_id } (PDF pelo pdf-base em Arquivos).
 *
 * Regras: rodadas fixas e custo antes, com teto; nada de laço; um passo por
 * invocação (no máximo 3 falas em paralelo); Jev para ranquear e medir o
 * consenso; divergências à vista. ia_usos com tarefa e agente "conselho"
 * (papel da frente BASE). Sem travessão.
 */

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { carregarModelo, chamarTexto, cobrarJev, estimarComModelo, garantirSaldo, IaMotorErro, type ModeloIa, modeloDoPapel } from "../_shared/ia-motor.ts";
import { JevErro, jevPerguntar } from "../_shared/jev.ts";
import { lerContextoConsolidado } from "../_shared/contexto-cliente.ts";
import { lerContextoDaMarca, resolverMarca } from "../_shared/marca.ts";
import { criarContextoDoAgente } from "../_shared/contexto-do-agente.ts";
import { respostaComFolego } from "../_shared/resposta-com-folego.ts";
import { auditLog } from "../_shared/mcp-audit.ts";
import { erroQueSobe, registrarFalha } from "../_shared/falha-registrada.ts";
// Frente SPP (30/09): o método da casa (superpoderes) nos especialistas e na síntese do conselho.
import { superpoderesPara } from "../_shared/superpoderes.ts";
import { gravarTroca } from "../_shared/conversa-das-mesas.ts";
import { MODOS, modoDe, type ModoDoConselho } from "./modulos/conselho-presets.ts";
import { arquivarElenco, ataEmPdf, type CtxDoConselho, elencos, pautaComAnexos, salvarElenco } from "./extras.ts";
// Frente SYNC: a decisão do dono entra no cérebro (todo agente lê) e a conversa do conselho aprende como as mesas.
import { aprenderDoPedido, regrasDaMesa, rotasDoAprendizado } from "../_shared/aprendizado-das-mesas.ts";
import { decisaoDoConselhoNoCerebro, desfazerDecisaoNoCerebro } from "./modulos/sincronia-entre-mesas.ts";
import {
  avancarSessao,
  catalogoDosEspecialistas,
  convocar as convocarNucleo,
  decisaoDoDono,
  type DependenciasDoConselho,
  entregaParaDocumento,
  ErroDoConselho,
  estimarSessao,
  falaDaLinha,
  type FalaDoConselho,
  LIMITES,
  MODERADOR,
  montarAta,
  nomeDoEspecialista,
  pedidoDaConversa,
  planejarNovaRodada,
  planoDasEtapas,
  resumoDaDecisao,
  sessaoDaLinha,
  type SessaoDoConselho,
  tamanhoDaFala,
  validarConvocacao,
} from "./modulos/conselho.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Max-Age": "7200",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** ia_usos (tarefa e agente): o papel "conselho" da frente BASE (CHECKs ampliadas em 20260930000000). */
const PAPEL = "conselho" as const;
const TAREFA = PAPEL;
const AGENTE = PAPEL;
const TRAVA_SEGUNDOS = 300;
const CAMPOS_DA_SESSAO =
  "id, client_id, marca_id, origem, referencia, tema, pergunta, contexto, contexto_cliente, criterios, especialistas, rodadas, rodadas_extras, rodada_atual, etapa, status, teto_usd, estimativa_usd, custo_usd, resultado, decisao, ata, memoria_id, erro_codigo, erro_mensagem, aviso, criado_por, criado_em, concluido_em, modo, pauta, ata_file_id";
const CAMPOS_DA_FALA =
  "id, sessao_id, client_id, rodada, etapa, especialista, papel, modelo_id, pedido, status, conteudo, texto, notas, custo_usd, tentativas, erro_codigo, erro_mensagem, criado_em";

const CONTEXTO_DO_AGENTE = criarContextoDoAgente();

// ------------------------------------------------------------------ erros

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

const MENSAGEM_MOTOR: Record<string, { status: number; mensagem: string }> = {
  saldo_insuficiente: { status: 402, mensagem: "Saldo insuficiente na carteira de IA deste cliente. Peça a recarga a um admin ou gestor." },
  cota_da_chave_esgotada: { status: 402, mensagem: "A cota do mês da chave de IA deste cliente acabou." },
  cliente_sem_chave: { status: 403, mensagem: "Este cliente não tem chave de IA própria e o uso da chave da agência está desligado para ele." },
  provedor_sem_chave: { status: 503, mensagem: "O provedor deste modelo está sem chave de API configurada." },
};

function respostaDeErro(err: unknown): Response {
  if (err instanceof ErroHttp) return json({ error: err.codigo, mensagem: err.message, ...err.extra }, err.status);
  if (err instanceof ErroDoConselho) return json({ error: err.codigo, mensagem: err.message, ...err.extra }, err.status);
  if (err instanceof IaMotorErro) {
    const conhecido = MENSAGEM_MOTOR[err.codigo];
    const status = conhecido?.status ?? (err.status >= 400 ? err.status : 500);
    return json({ ...err.paraJson(), mensagem: conhecido?.mensagem ?? err.message }, status);
  }
  registrarFalha("conselho: erro inesperado", err);
  return json({ error: "erro_interno", mensagem: "Falha inesperada no conselho." }, 500);
}

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
  if (staff !== true) throw new ErroHttp(403, "somente_equipe", "Somente a equipe convoca o conselho.");
  return { userId, token, doChamador: clienteDoChamador(token) };
}

async function garantirAcesso(ch: Chamador, clientId: string) {
  if (!UUID.test(clientId)) throw new ErroHttp(400, "client_id_invalido", "client_id precisa ser um UUID.");
  const { data, error } = await ch.doChamador.rpc("can_access_client", { _client_id: clientId });
  if (error) throw new ErroHttp(503, "autorizacao_indisponivel", "Não foi possível conferir o acesso ao cliente agora.");
  if (data !== true) throw new ErroHttp(403, "sem_acesso_ao_cliente", "Você não tem acesso a este cliente.");
}

/** A tabela nova ainda não foi criada (SQL CNS-01 pendente)? */
function semTabela(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  return error.code === "42P01" || error.code === "42883" || error.code === "PGRST202" || error.code === "PGRST205" || /conselho_(sessoes|falas|pegar_passo)/i.test(String(error.message || ""));
}

const erroDoBanco = (error: { code?: string; message?: string } | null | undefined, onde: string) => {
  registrarFalha(`conselho: ${onde}`, error);
  return semTabela(error)
    ? new ErroHttp(503, "banco_sem_conselho", "O banco ainda não tem as tabelas do conselho (SQL CNS-01 pendente).")
    : new ErroHttp(503, "conselho_indisponivel", "Não foi possível ler ou gravar o conselho agora. Tente de novo.");
};

async function lerSessao(ch: Chamador, sessaoId: unknown): Promise<SessaoDoConselho> {
  const id = String(sessaoId ?? "").trim();
  if (!UUID.test(id)) throw new ErroHttp(400, "sessao_id_invalido", "sessao_id precisa ser um UUID.");
  const { data, error } = await servico().from("conselho_sessoes").select(CAMPOS_DA_SESSAO).eq("id", id).maybeSingle();
  if (error) throw erroDoBanco(error, "leitura da sessão falhou");
  if (!data) throw new ErroHttp(404, "sessao_inexistente", "Sessão do conselho não encontrada.");
  const s = sessaoDaLinha(data as Record<string, unknown>);
  await garantirAcesso(ch, s.client_id);
  return s;
}

async function lerFalas(sessaoId: string): Promise<FalaDoConselho[]> {
  const { data, error } = await servico().from("conselho_falas").select(CAMPOS_DA_FALA).eq("sessao_id", sessaoId).order("rodada").order("criado_em");
  if (error) throw erroDoBanco(error, "leitura das falas falhou");
  return ((data ?? []) as Record<string, unknown>[]).map(falaDaLinha);
}

async function nomeDe(userId: string): Promise<string> {
  const { data } = await servico().from("profiles").select("full_name, email").eq("id", userId).maybeSingle();
  const p = data as { full_name?: string | null; email?: string | null } | null;
  return (p && (p.full_name || (p.email ? p.email.split("@")[0] : ""))) || "Equipe";
}

async function nomeDoCliente(clientId: string): Promise<string> {
  const { data } = await servico().from("profiles").select("company_name, full_name").eq("id", clientId).maybeSingle();
  const p = data as { company_name?: string | null; full_name?: string | null } | null;
  return (p && (p.company_name || p.full_name)) || "Cliente";
}

// ------------------------------------------------------------------ modelos

/** O modelo padrão do conselho (papel "conselho" do catálogo; sem ele, o do estrategista: modeloDoPapel da frente BASE). */
async function idDoModeloPadrao(): Promise<string> {
  const m = await modeloDoPapel(PAPEL);
  if (!m) throw new ErroHttp(409, "sem_modelo", "O catálogo não tem modelo padrão ativo para o conselho.");
  return m.id;
}

/** Carrega os modelos pedidos (tipo texto, ativos); um erro de catálogo sobe com o id. */
async function modelosDe(ids: string[]): Promise<Map<string, ModeloIa>> {
  const mapa = new Map<string, ModeloIa>();
  for (const id of ids) {
    if (!id || mapa.has(id)) continue;
    mapa.set(id, await carregarModelo(id, "texto"));
  }
  return mapa;
}

function precoPelaTabela(mapa: Map<string, ModeloIa>) {
  return (modeloId: string, tokens: { entrada: number; saida: number }) => {
    const m = mapa.get(modeloId);
    if (!m) return 0;
    return estimarComModelo(m, { tokensEntrada: tokens.entrada, tokensSaida: tokens.saida });
  };
}

/** Raciocínio baixo quando o modelo aceita (custo previsível); sem níveis, nenhum. */
const raciocinioPara = (m: ModeloIa | undefined, modo: ModoDoConselho = "padrao") => (m ? MODOS[modo].raciocinio.find((r) => (m.raciocinio ?? []).includes(r)) : undefined);

// ------------------------------------------------------------------ dependências do núcleo

function dependencias(ch: Chamador, modelos: Map<string, ModeloIa>, sessaoDoJev: SessaoDoConselho | null = null): DependenciasDoConselho {
  const db = servico();
  return {
    banco: {
      criarSessao: async (linha) => {
        const { data, error } = await db.from("conselho_sessoes").insert(linha).select(CAMPOS_DA_SESSAO).single();
        if (error || !data) throw erroDoBanco(error, "a sessão não foi criada");
        return sessaoDaLinha(data as Record<string, unknown>);
      },
      lerFalas,
      inserirFalas: async (linhas) => {
        if (!linhas.length) return [];
        const { data, error } = await db.from("conselho_falas").insert(linhas).select(CAMPOS_DA_FALA);
        if (error) throw erroDoBanco(error, "as falas não foram criadas");
        return ((data ?? []) as Record<string, unknown>[]).map(falaDaLinha);
      },
      atualizarFala: async (id, campos) => {
        const { error } = await db.from("conselho_falas").update(campos).eq("id", id);
        if (error) throw erroDoBanco(error, "a fala não foi gravada");
      },
      atualizarSessao: async (id, campos, token) => {
        let q = db.from("conselho_sessoes").update(campos).eq("id", id);
        if (token) q = q.eq("trava_token", token);
        const { data, error } = await q.select("id").maybeSingle();
        if (error) throw erroDoBanco(error, "a sessão não foi gravada");
        return !!data;
      },
    },
    falar: async (p) => {
      const m = modelos.get(p.modeloId) || (await carregarModelo(p.modeloId, "texto"));
      modelos.set(m.id, m);
      const r = await chamarTexto({
        clientId: p.sessao.client_id,
        tarefa: TAREFA,
        agente: AGENTE,
        modeloId: p.modeloId,
        sistema: p.sistema,
        mensagens: [{ papel: "usuario", conteudo: p.mensagem }],
        raciocinio: raciocinioPara(m, p.sessao.modo),
        maxTokensSaida: p.etapa === "conversa" ? undefined : MODOS[p.sessao.modo || "padrao"].maxSaida,
        esquemaJson: p.esquema || undefined,
        referencia: { tipo: "conselho_fala", id: p.fala.id },
        criadoPor: ch.userId,
        // A síntese junta frentes e revisa ("Decidi" e "O que não julguei"); cada especialista, parecer com prova.
        metodo: await superpoderesPara(servico(), p.etapa === "consolidacao"
          ? { agente: "conselho.sintese", momento: "lote" }
          : { agente: "conselho.especialista", momento: p.etapa === "critica" || p.etapa === "revisao" ? "revisar" : "gerar" }),
      });
      return { json: r.json, texto: r.texto, custoUsd: r.custoUsd, usoId: r.usoId };
    },
    jev: async (q) => {
      const r = await jevPerguntar(q, { timeoutMs: 20_000 });
      // O Jev entra na carteira do cliente (fração de centavo); falha no registro fica no log e não derruba.
      const uso = sessaoDoJev
        ? await cobrarJev(r, { clientId: sessaoDoJev.client_id, tarefa: TAREFA, referencia: { tipo: "conselho_sessao", id: sessaoDoJev.id }, criadoPor: ch.userId })
        : null;
      return { answers: r.answers, custoUsd: uso ? uso.custoUsd : 0 };
    },
    precoDaFala: precoPelaTabela(modelos),
    paraTudo: (e) => erroQueSobe(e),
    aoFalhar: (onde, e, extra) => {
      registrarFalha(onde, e, extra || {});
    },
  };
}

// ------------------------------------------------------------------ segundo plano

/** Trabalho depois da resposta; sem EdgeRuntime (teste local), devolve false e quem chamou espera. */
function emSegundoPlano(p: Promise<unknown>): boolean {
  const er = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
  if (er && typeof er.waitUntil === "function") {
    er.waitUntil(p.catch((e) => registrarFalha("conselho: segundo plano falhou", e)));
    return true;
  }
  return false;
}

/** Chama o próximo passo com o login de quem pediu (a conferência de acesso roda de novo). */
function chutar(token: string, sessaoId: string) {
  const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/conselho`;
  const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const p = fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(anon ? { apikey: anon } : {}) },
    body: JSON.stringify({ acao: "avancar", sessao_id: sessaoId }),
    signal: AbortSignal.timeout(20_000),
  }).then((r) => r.body?.cancel()).catch((e) => registrarFalha("conselho: não chamou o próximo passo (a Sala aberta retoma)", e, { sessao_id: sessaoId }));
  emSegundoPlano(p);
}

/** Um passo: pega a trava, roda e, se sobrou trabalho, chama o próximo. */
async function rodarUmPasso(ch: Chamador, sessao: SessaoDoConselho): Promise<{ pegou: boolean }> {
  const token = crypto.randomUUID();
  const { data, error } = await servico().rpc("conselho_pegar_passo", { _sessao: sessao.id, _token: token, _trava_segundos: TRAVA_SEGUNDOS });
  if (error) throw erroDoBanco(error, "não pegou o passo");
  const linha = Array.isArray(data) ? data[0] : data;
  if (!linha) return { pegou: false };
  const atual = sessaoDaLinha(linha as Record<string, unknown>);
  const trabalho = (async () => {
    try {
      const modelos = await modelosDe(atual.especialistas.map((m) => m.modelo_id));
      const deps = dependencias(ch, modelos, atual);
      const r = await avancarSessao(deps, atual, token);
      if (r.continuar) chutar(ch.token, atual.id);
    } catch (e) {
      registrarFalha("conselho: passo falhou", e, { sessao_id: atual.id });
      const codigo = e && typeof e === "object" && typeof (e as { codigo?: unknown }).codigo === "string" ? String((e as { codigo: string }).codigo) : "erro_interno";
      // Catálogo, saldo ou chave: a sessão para com o motivo à vista (sem repetir sozinha).
      await servico().from("conselho_sessoes").update({
        status: "erro", erro_codigo: codigo, erro_mensagem: e instanceof Error ? e.message.slice(0, 300) : "O passo falhou.",
        trava_token: null, trava_ate: null, concluido_em: new Date().toISOString(), atualizado_em: new Date().toISOString(),
      }).eq("id", atual.id).eq("trava_token", token);
    }
  })();
  if (!emSegundoPlano(trabalho)) await trabalho;
  return { pegou: true };
}

// ------------------------------------------------------------------ retrato do cliente

async function retratoDoCliente(clientId: string, marcaId: unknown, referencia: Record<string, unknown>): Promise<{ texto: string; marcaId: string | null; projectId: string | null }> {
  const db = servico();
  const marca = await resolverMarca(db, clientId, { marca_id: marcaId }).catch((e) => (registrarFalha("conselho: marca não resolvida", e), null));
  const outra = marca && !marca.principal ? marca : null;
  const [consolidado, cerebro, dossieDaMarca, decisoes] = await Promise.all([
    (marca ? lerContextoDaMarca(db, clientId, marca) : lerContextoConsolidado(db, clientId)).catch((e) => (registrarFalha("conselho: contexto consolidado falhou", e), {})),
    // Regra da herança: outra marca nunca herda o cérebro e o dossiê do cliente (o leitor completo já filtra pela marca).
    // Frente SYNC: entram também a estratégia aprovada, o briefing mais novo e o Instagram da marca.
    CONTEXTO_DO_AGENTE.ler(db, clientId, ["geral", "campanha", "copy", "arte"], { cerebro: 1500, dossie: 2500, marca: marca, partes: outra ? ["cerebro", "estrategia", "briefing", "instagram"] : ["cerebro", "dossie", "estrategia", "briefing", "instagram"] }),
    outra && outra.project_id
      ? db.from("client_dossiers").select("summary").eq("client_id", clientId).eq("is_current", true).eq("project_id", outra.project_id).order("effective_at", { ascending: false }).limit(1)
      : Promise.resolve({ data: [] as unknown[], error: null }),
    db.from("project_memory").select("title, content, tags, metadata, created_at").eq("client_id", clientId).eq("kind", "decisao").eq("source", "conselho").order("created_at", { ascending: false }).limit(8),
  ]);
  const c = consolidado as Record<string, unknown>;
  const partes: string[] = [];
  const campo = (rotulo: string, v: unknown) => {
    const s = typeof v === "string" ? v.trim() : v && typeof v === "object" ? JSON.stringify(v) : "";
    if (s) partes.push(`${rotulo}: ${s.slice(0, 900)}`);
  };
  partes.push(`Cliente: ${outra ? outra.nome : await nomeDoCliente(clientId)}${outra ? " (marca própria do cliente; vale só o dado dela)" : ""}`);
  campo("Negócio", c.negocio);
  campo("Público", c.publico);
  campo("Oferta", c.oferta);
  campo("Tom de voz", c.tom_de_voz);
  campo("Diferenciais", c.diferenciais);
  campo("Lacunas do contexto", c.lacunas);
  if (cerebro) partes.push(String(cerebro).slice(0, 4000));
  const dm = ((dossieDaMarca as { data?: unknown[] }).data as { summary?: string | null }[] | null) ?? [];
  if (dm.length && dm[0].summary) partes.push(`Dossiê da marca: ${String(dm[0].summary).slice(0, 2000)}`);
  const lista = ((decisoes as { data?: unknown[]; error?: unknown }).data as { title?: string | null; content?: string | null; tags?: string[] | null; metadata?: Record<string, unknown> | null }[] | null) ?? [];
  const validas = lista
    .filter((d) => (d.tags || []).indexOf("desfeita") < 0)
    .filter((d) => (outra ? (d.metadata || {}).marca_id === outra.id : !(d.metadata || {}).marca_id || (marca && (d.metadata || {}).marca_id === marca.id)))
    .slice(0, 5);
  if (validas.length) {
    partes.push(`DECISÕES ANTERIORES DO DONO NO CONSELHO (o que ele já escolheu; respeite ou diga por que mudar):\n${validas.map((d) => `- ${String(d.title || "")}: ${String((d.metadata || {}).resumo || "").slice(0, 300)}`).join("\n")}`);
  }
  const ref = await textoDaReferencia(clientId, referencia);
  if (ref) partes.push(ref);
  return { texto: partes.join("\n").slice(0, LIMITES.CONTEXTO_CLIENTE), marcaId: marca ? marca.id : null, projectId: outra ? outra.project_id ?? null : null };
}

/** O que a mesa de origem mostrou (roteiro aberto, mês em foco). */
async function textoDaReferencia(clientId: string, referencia: Record<string, unknown>): Promise<string> {
  const tipo = String(referencia.tipo || "");
  if (tipo === "roteiro" && UUID.test(String(referencia.id || ""))) {
    const { data, error } = await servico().from("roteiros").select("client_id, titulo, tipo, status, versao_atual, versoes").eq("id", String(referencia.id)).maybeSingle();
    if (error) {
      registrarFalha("conselho: roteiro da referência não lido", error);
      return "";
    }
    const r = data as { client_id?: string; titulo?: string; tipo?: string; status?: string; versao_atual?: number; versoes?: Array<{ numero?: number; conteudo?: Record<string, unknown> }> } | null;
    if (!r || r.client_id !== clientId) return "";
    const versao = (r.versoes || []).find((v) => v && v.numero === r.versao_atual) || (r.versoes || [])[(r.versoes || []).length - 1];
    const conteudo = (versao && versao.conteudo) || {};
    const blocos = Array.isArray(conteudo.blocos) ? (conteudo.blocos as Record<string, unknown>[]).map((b) => `${String(b.funcao || "")}: ${String(b.fala || "")}`).join("\n") : "";
    return `ROTEIRO ABERTO NA MESA: "${String(r.titulo || "")}" (${String(r.tipo || "")}, ${String(r.status || "")}).\n${String(conteudo.subtitulo || "")}\n${blocos}`.slice(0, 3000);
  }
  if (tipo === "mes" && /^\d{4}-\d{2}-01$/.test(String(referencia.mes || ""))) {
    return `MÊS EM FOCO NA MESA: ${String(referencia.mes).slice(0, 7)}.`;
  }
  return "";
}

// ------------------------------------------------------------------ ações

const texto = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const modelosDoCorpo = (v: unknown): Record<string, string> => {
  const r: Record<string, string> = {};
  if (v && typeof v === "object" && !Array.isArray(v)) {
    Object.keys(v as Record<string, unknown>).slice(0, 12).forEach((k) => {
      const s = (v as Record<string, unknown>)[k];
      if (typeof s === "string" && s.trim()) r[k] = s.trim().slice(0, 120);
    });
  }
  return r;
};

async function catalogo(_ch: Chamador, corpo: Record<string, unknown>) {
  const origem = texto(corpo.origem, 40) || "painel";
  let padrao: string | null = null;
  try {
    padrao = await idDoModeloPadrao();
  } catch (e) {
    registrarFalha("conselho: sem modelo padrão", e);
  }
  return json({ ...catalogoDosEspecialistas(origem), modelo_padrao: padrao });
}

async function prepararEstimativa(corpo: Record<string, unknown>) {
  const modeloPadrao = await idDoModeloPadrao();
  const v = validarConvocacao({
    clientId: String(corpo.client_id || ""),
    origem: texto(corpo.origem, 40),
    tema: texto(corpo.tema, 300) || "estimativa",
    pergunta: texto(corpo.pergunta, 4000) || "estimativa",
    especialistas: Array.isArray(corpo.especialistas) ? (corpo.especialistas as unknown[]).map(String) : [],
    modelos: modelosDoCorpo(corpo.modelos),
    modeloPadrao,
    rodadas: Number(corpo.rodadas),
    teto_usd: LIMITES.TETO_MAXIMO_USD,
    modo: modoDe(corpo.modo),
  });
  const modelos = await modelosDe(v.membros.map((m) => m.modelo_id));
  const estimativa = estimarSessao(v.membros, planoDasEtapas(v.rodadas), precoPelaTabela(modelos), v.membros[0].modelo_id, 1, v.modo);
  return { v, modelos, estimativa, modeloPadrao };
}

const tetoSugerido = (total: number) => Math.min(LIMITES.TETO_MAXIMO_USD, Math.max(0.05, Math.ceil(total * 1.3 * 100) / 100));

async function estimar(ch: Chamador, corpo: Record<string, unknown>) {
  await garantirAcesso(ch, String(corpo.client_id || ""));
  const { estimativa } = await prepararEstimativa(corpo);
  return json({ estimativa, teto_sugerido_usd: tetoSugerido(estimativa.total_usd) });
}

async function convocar(ch: Chamador, corpo: Record<string, unknown>) {
  const inicio = Date.now();
  const clientId = String(corpo.client_id || "");
  await garantirAcesso(ch, clientId);
  const { modelos, estimativa, modeloPadrao } = await prepararEstimativa(corpo);
  // Saldo para a sessão inteira antes de começar (cada fala confere de novo no motor).
  await garantirSaldo(clientId, estimativa.total_usd);
  const referencia = corpo.referencia && typeof corpo.referencia === "object" && !Array.isArray(corpo.referencia) ? (corpo.referencia as Record<string, unknown>) : {};
  const retrato = await retratoDoCliente(clientId, corpo.marca_id, referencia);
  const deps = dependencias(ch, modelos);
  const r = await convocarNucleo(deps, {
    clientId,
    marcaId: retrato.marcaId,
    origem: texto(corpo.origem, 40),
    referencia: { ...referencia, project_id: retrato.projectId },
    tema: texto(corpo.tema, 300),
    pergunta: texto(corpo.pergunta, 4000),
    contexto: texto(corpo.contexto, 8000),
    contextoCliente: retrato.texto,
    especialistas: Array.isArray(corpo.especialistas) ? (corpo.especialistas as unknown[]).map(String) : [],
    modelos: modelosDoCorpo(corpo.modelos),
    modeloPadrao,
    rodadas: Number(corpo.rodadas),
    teto_usd: Number(corpo.teto_usd),
    criterios: Array.isArray(corpo.criterios) ? (corpo.criterios as unknown[]).map(String) : null,
    modo: modoDe(corpo.modo),
    pauta: await pautaComAnexos(servico(), clientId, corpo.pauta),
    criadoPor: ch.userId,
  });
  await auditLog({
    correlationId: crypto.randomUUID(), toolName: "conselho_convocar", origin: "mesa:conselho", keyId: `mesa:conselho:${ch.userId}`, scopes: ["mesa:write"],
    input: { client_id: clientId, sessao_id: r.sessao.id, especialistas: r.sessao.especialistas.map((m) => m.id), rodadas: r.sessao.rodadas, teto_usd: r.sessao.teto_usd },
    success: true, statusCode: 200, durationMs: Date.now() - inicio, resultRef: r.sessao.id,
  });
  await rodarUmPasso(ch, r.sessao).catch((e) => registrarFalha("conselho: primeiro passo não começou (a Sala aberta retoma)", e, { sessao_id: r.sessao.id }));
  return json({ sessao: r.sessao, estimativa, custo_usd: 0 });
}

async function avancar(ch: Chamador, corpo: Record<string, unknown>) {
  const sessao = await lerSessao(ch, corpo.sessao_id);
  if (sessao.status !== "fila" && sessao.status !== "rodando") return json({ pegou: false, status: sessao.status });
  const r = await rodarUmPasso(ch, sessao);
  return json({ pegou: r.pegou, status: sessao.status });
}

/** Sobe o teto quando a pessoa pediu (nunca abaixo do que já foi gasto mais a próxima conta). */
async function talvezSubirTeto(sessao: SessaoDoConselho, novoTeto: unknown, precisa: number): Promise<number> {
  const n = Number(novoTeto);
  if (novoTeto === undefined || novoTeto === null || novoTeto === "" || !isFinite(n)) return sessao.teto_usd;
  if (n > LIMITES.TETO_MAXIMO_USD) throw new ErroHttp(400, "teto_invalido", `O teto vai até US$ ${LIMITES.TETO_MAXIMO_USD}.`);
  if (n < precisa) throw new ErroHttp(400, "teto_abaixo_da_estimativa", `O teto novo precisa cobrir US$ ${precisa.toFixed(4)}.`, { estimativa_usd: precisa });
  const { error } = await servico().from("conselho_sessoes").update({ teto_usd: Math.round(n * 1e4) / 1e4, atualizado_em: new Date().toISOString() }).eq("id", sessao.id);
  if (error) throw erroDoBanco(error, "teto não foi gravado");
  return n;
}

async function perguntar(ch: Chamador, corpo: Record<string, unknown>) {
  const sessao = await lerSessao(ch, corpo.sessao_id);
  if (sessao.status === "fila" || sessao.status === "rodando") throw new ErroHttp(409, "conselho_rodando", "Espere o conselho terminar as rodadas para conversar.");
  const especialista = texto(corpo.especialista, 40);
  const membro = sessao.especialistas.find((m) => m.id === especialista);
  if (!membro && especialista !== MODERADOR.id) throw new ErroHttp(400, "especialista_fora_da_sessao", "Este especialista não está nesta sessão.");
  const pergunta = texto(corpo.pergunta, 2000);
  if (pergunta.length < 2) throw new ErroHttp(400, "pergunta_vazia", "Escreva a pergunta.");
  const falas = await lerFalas(sessao.id);
  if (falas.filter((f) => f.etapa === "conversa").length >= LIMITES.CONVERSAS) throw new ErroHttp(409, "conversa_cheia", "Esta sessão já tem muitas perguntas. Convoque uma sessão nova.");
  const modeloId = membro ? membro.modelo_id : sessao.especialistas[0].modelo_id;
  const modelos = await modelosDe([modeloId]);
  const estimativa = precoPelaTabela(modelos)(modeloId, tamanhoDaFala("conversa", sessao.especialistas.length));
  const teto = await talvezSubirTeto(sessao, corpo.novo_teto_usd, sessao.custo_usd + estimativa);
  if (sessao.custo_usd + estimativa > teto + 1e-9) {
    throw new ErroHttp(402, "teto_da_sessao", `Esta pergunta (cerca de US$ ${estimativa.toFixed(4)}) passa do teto da sessão (US$ ${teto.toFixed(2)}). Suba o teto para continuar.`, {
      estimativa_usd: Math.round(estimativa * 1e6) / 1e6, custo_usd: sessao.custo_usd, teto_usd: teto,
    });
  }
  const rodada = Math.max(1, Math.min(12, sessao.rodada_atual));
  const { data: nova, error } = await servico().from("conselho_falas").insert({
    sessao_id: sessao.id, client_id: sessao.client_id, rodada, etapa: "conversa", especialista, papel: especialista === MODERADOR.id ? "moderador" : "especialista",
    modelo_id: modeloId, pedido: pergunta, status: "falando", pedido_por: ch.userId, iniciado_em: new Date().toISOString(),
  }).select(CAMPOS_DA_FALA).single();
  if (error || !nova) throw erroDoBanco(error, "a pergunta não foi gravada");
  const fala = falaDaLinha(nova as Record<string, unknown>);
  const p = pedidoDaConversa(sessao, falas, especialista, pergunta);
  // Frente SYNC: o conselho obedece as regras ensinadas (as dele e as que valem em todas as mesas). Resposta em texto: sem apelidos.
  const regras = await regrasDaMesa(servico(), { clientId: sessao.client_id, mesa: "conselho", marcaId: sessao.marca_id });
  const blocoDasRegras = regras.bloco ? `\n\n${regras.bloco.replace(/\nQuando uma regra mudar[^\n]*$/, "")}` : "";
  try {
    const r = await chamarTexto({
      clientId: sessao.client_id, tarefa: TAREFA, agente: AGENTE, modeloId, sistema: p.sistema + blocoDasRegras, mensagens: [{ papel: "usuario", conteudo: p.mensagem }],
      raciocinio: raciocinioPara(modelos.get(modeloId)), referencia: { tipo: "conselho_fala", id: fala.id }, criadoPor: ch.userId,
      metodo: await superpoderesPara(servico(), { agente: "conselho.especialista", momento: "revisar" }),
    });
    const agora = new Date().toISOString();
    const { data: feita, error: e2 } = await servico().from("conselho_falas").update({
      status: "feita", texto: r.texto.replace(/\u2014|\u2013/g, ",").slice(0, 6000), conteudo: { resposta: r.texto.slice(0, 6000) }, custo_usd: r.custoUsd, uso_id: r.usoId, concluido_em: agora, atualizado_em: agora,
    }).eq("id", fala.id).select(CAMPOS_DA_FALA).single();
    if (e2) registrarFalha("conselho: resposta não gravada", e2, { fala_id: fala.id });
    const { error: e3 } = await servico().from("conselho_sessoes").update({ custo_usd: Math.round((sessao.custo_usd + r.custoUsd) * 1e6) / 1e6, atualizado_em: agora }).eq("id", sessao.id);
    if (e3) registrarFalha("conselho: custo da conversa não somado", e3, { sessao_id: sessao.id });
    // Frente SYNC: o que a pergunta ensina vira regra (o Jev decide se vale para sempre), como nas mesas.
    const aprendido = await aprenderDoPedido(servico(), { clientId: sessao.client_id, mesa: "conselho", pedido: pergunta, marcaId: sessao.marca_id, userId: ch.userId, ultimaResposta: r.texto });
    const avisoDaConversa = await gravarNaConversa(ch, sessao, pergunta, especialista, r.texto, r.usoId || null, aprendido ? [aprendido] : []);
    return json({
      fala: feita ? falaDaLinha(feita as Record<string, unknown>) : { ...fala, status: "feita", texto: r.texto },
      aprendido,
      custo_usd: r.custoUsd,
      saldo_usd: r.saldoUsd,
      aviso: e2 ? "A resposta chegou, mas não ficou guardada na sessão." : avisoDaConversa,
    });
  } catch (e) {
    registrarFalha("conselho: pergunta falhou", e, { sessao_id: sessao.id, especialista });
    const codigo = e && typeof e === "object" && typeof (e as { codigo?: unknown }).codigo === "string" ? String((e as { codigo: string }).codigo) : "fala_falhou";
    await servico().from("conselho_falas").update({ status: "erro", erro_codigo: codigo, erro_mensagem: e instanceof Error ? e.message.slice(0, 300) : "Falhou.", atualizado_em: new Date().toISOString() }).eq("id", fala.id);
    throw e;
  }
}

/**
 * A conversa com o conselho também fica em agente_conversas (agente
 * "conselho", uma conversa por sessão), pelo gravarTroca das mesas. Nunca
 * derruba a resposta: a fala já está guardada na sessão; a falha vai para o
 * log e volta como aviso.
 */
async function gravarNaConversa(ch: Chamador, sessao: SessaoDoConselho, pergunta: string, especialista: string, resposta: string, usoId: string | null, anexos: unknown[] = []): Promise<string | null> {
  try {
    const db = servico();
    const { data: achada, error } = await db.from("agente_conversas").select("id").eq("client_id", sessao.client_id).eq("agente", AGENTE).eq("referencia_tipo", "conselho_sessao").eq("referencia_id", sessao.id).limit(1);
    if (error) throw error;
    let conversaId = achada && achada[0] ? String((achada[0] as { id: string }).id) : "";
    if (!conversaId) {
      const { data: nova, error: e2 } = await db.from("agente_conversas").insert({ client_id: sessao.client_id, agente: AGENTE, referencia_tipo: "conselho_sessao", referencia_id: sessao.id, criado_por: ch.userId }).select("id").single();
      if (e2 || !nova) throw e2 || new Error("conversa não criada");
      conversaId = String((nova as { id: string }).id);
    }
    const troca = await gravarTroca(db, {
      conversaId,
      clientId: sessao.client_id,
      usuario: { conteudo: `Para ${nomeDoEspecialista(especialista)}: ${pergunta}` },
      agente: { conteudo: `${nomeDoEspecialista(especialista)}: ${resposta}`, uso_id: usoId, anexos },
      onde: "conselho",
    });
    return troca.erro ? "A resposta ficou na sessão, mas não na conversa do agente." : null;
  } catch (e) {
    registrarFalha("conselho: conversa não gravada em agente_conversas", e, { sessao_id: sessao.id });
    return "A resposta ficou na sessão, mas não na conversa do agente.";
  }
}

async function novaRodada(ch: Chamador, corpo: Record<string, unknown>) {
  const sessao = await lerSessao(ch, corpo.sessao_id);
  const falas = await lerFalas(sessao.id);
  const modelos = await modelosDe(sessao.especialistas.map((m) => m.modelo_id));
  const plano = planejarNovaRodada(sessao, falas, precoPelaTabela(modelos));
  const precisa = sessao.custo_usd + plano.estimativa.total_usd;
  if (corpo.confirmar !== true) {
    return json({ estimativa: plano.estimativa, custo_usd_ate_agora: sessao.custo_usd, teto_usd: sessao.teto_usd, cabe_no_teto: precisa <= sessao.teto_usd + 1e-9, teto_sugerido_usd: tetoSugerido(precisa) });
  }
  const teto = await talvezSubirTeto(sessao, corpo.novo_teto_usd, precisa);
  if (precisa > teto + 1e-9) throw new ErroHttp(402, "teto_da_sessao", "A nova rodada passa do teto da sessão. Suba o teto para continuar.", { estimativa_usd: plano.estimativa.total_usd, teto_usd: teto });
  const proxima = sessao.rodada_atual + 1;
  const etapa = plano.etapas[proxima - 1];
  const agora = new Date().toISOString();
  const { data, error } = await servico().from("conselho_sessoes").update({
    rodadas_extras: sessao.rodadas_extras + 1, rodada_atual: proxima, etapa, status: "fila", concluido_em: null, aviso: null, erro_codigo: null, erro_mensagem: null,
    estimativa_usd: Math.round((sessao.estimativa_usd + plano.estimativa.total_usd) * 1e4) / 1e4, atualizado_em: agora,
  }).eq("id", sessao.id).eq("status", "concluida").select(CAMPOS_DA_SESSAO).maybeSingle();
  if (error) throw erroDoBanco(error, "nova rodada não gravada");
  if (!data) throw new ErroHttp(409, "sessao_mudou", "A sessão mudou enquanto você pedia. Abra de novo.");
  const nova = sessaoDaLinha(data as Record<string, unknown>);
  if (etapa !== "consolidacao") {
    const { error: e2 } = await servico().from("conselho_falas").insert(plano.vivos.map((id) => ({
      sessao_id: nova.id, client_id: nova.client_id, rodada: proxima, etapa, especialista: id, papel: "especialista",
      modelo_id: (nova.especialistas.find((m) => m.id === id) || nova.especialistas[0]).modelo_id, status: "fila",
    })));
    if (e2) throw erroDoBanco(e2, "falas da nova rodada não criadas");
  }
  await auditLog({
    correlationId: crypto.randomUUID(), toolName: "conselho_nova_rodada", origin: "mesa:conselho", keyId: `mesa:conselho:${ch.userId}`, scopes: ["mesa:write"],
    input: { client_id: nova.client_id, sessao_id: nova.id, estimativa_usd: plano.estimativa.total_usd }, success: true, statusCode: 200, durationMs: 0, resultRef: nova.id,
  });
  await rodarUmPasso(ch, nova).catch((e) => registrarFalha("conselho: nova rodada não começou (a Sala aberta retoma)", e, { sessao_id: nova.id }));
  return json({ sessao: nova, estimativa: plano.estimativa });
}

async function parar(ch: Chamador, corpo: Record<string, unknown>) {
  const sessao = await lerSessao(ch, corpo.sessao_id);
  if (sessao.status !== "fila" && sessao.status !== "rodando") return json({ sessao });
  const agora = new Date().toISOString();
  // Sem trava: o passo que estiver rodando não consegue mais gravar a sessão por cima.
  const { data, error } = await servico().from("conselho_sessoes").update({
    status: "parada", trava_token: null, trava_ate: null, aviso: "Parado pela equipe.", concluido_em: agora, atualizado_em: agora,
  }).eq("id", sessao.id).in("status", ["fila", "rodando"]).select(CAMPOS_DA_SESSAO).maybeSingle();
  if (error) throw erroDoBanco(error, "não parou");
  const { error: e2 } = await servico().from("conselho_falas").update({ status: "pulada", erro_codigo: "parada", atualizado_em: agora }).eq("sessao_id", sessao.id).eq("status", "fila");
  if (e2) registrarFalha("conselho: falas na fila não marcadas como puladas", e2, { sessao_id: sessao.id });
  return json({ sessao: data ? sessaoDaLinha(data as Record<string, unknown>) : sessao });
}

async function rotulosDosModelos(sessao: SessaoDoConselho): Promise<Record<string, string>> {
  const ids = Array.from(new Set(sessao.especialistas.map((m) => m.modelo_id)));
  const { data } = await servico().from("ia_modelos").select("id, rotulo, modelo_api").in("id", ids);
  const r: Record<string, string> = {};
  ((data ?? []) as { id: string; rotulo?: string | null; modelo_api?: string | null }[]).forEach((m) => {
    r[m.id] = m.rotulo || m.modelo_api || m.id;
  });
  return r;
}

async function decidir(ch: Chamador, corpo: Record<string, unknown>) {
  const sessao = await lerSessao(ch, corpo.sessao_id);
  if (sessao.decisao && !sessao.decisao.desfeita_em) throw new ErroHttp(409, "ja_decidida", "Esta sessão já tem decisão. Desfaça antes de decidir de novo.");
  const falas = await lerFalas(sessao.id);
  const agora = new Date().toISOString();
  const decisao = decisaoDoDono(sessao, falas, { escolha: corpo.escolha, especialista: corpo.especialista, nota: corpo.nota, por: ch.userId, porNome: await nomeDe(ch.userId), em: agora });
  const decidida: SessaoDoConselho = { ...sessao, decisao };
  const [cliente, modelos] = await Promise.all([nomeDoCliente(sessao.client_id), rotulosDosModelos(sessao)]);
  const ata = montarAta(decidida, falas, { cliente, modelos });
  const resumo = resumoDaDecisao(decidida);
  const projectId = typeof sessao.referencia.project_id === "string" && UUID.test(sessao.referencia.project_id) ? sessao.referencia.project_id : null;
  // A ata vai para o cérebro do cliente como decisão (project_memory, tipo "decisao").
  const { data: memoria, error } = await servico().from("project_memory").insert({
    client_id: sessao.client_id,
    project_id: projectId,
    kind: "decisao",
    source: "conselho",
    title: `Conselho: ${sessao.tema}`.slice(0, 200),
    content: `${resumo}\n\n${ata}`.slice(0, 60_000),
    tags: ["conselho", sessao.origem],
    metadata: {
      sessao_id: sessao.id,
      origem: sessao.origem,
      marca_id: sessao.marca_id,
      resumo,
      consenso: sessao.resultado ? sessao.resultado.nivel : null,
      // Gancho da frente DOC: o registro de entrega lê daqui quando existir no main.
      documento_de_entrega: entregaParaDocumento(decidida),
      documento_pendente: true,
    },
    created_by: ch.userId,
  }).select("id").single();
  if (error || !memoria) throw erroDoBanco(error, "a decisão não foi guardada no cérebro");
  const memoriaId = String((memoria as { id: string }).id);
  const { data, error: e2 } = await servico().from("conselho_sessoes").update({ decisao, ata, memoria_id: memoriaId, atualizado_em: agora }).eq("id", sessao.id).select(CAMPOS_DA_SESSAO).single();
  if (e2) throw erroDoBanco(e2, "a decisão não foi gravada na sessão");
  // Frente SYNC: a decisão vira aprendizado do cérebro (área geral), que todo agente e toda mesa leem.
  const noCerebro = await decisaoDoConselhoNoCerebro(servico(), { clientId: sessao.client_id, sessaoId: sessao.id, tema: sessao.tema, resumo, marcaId: sessao.marca_id, userId: ch.userId });
  CONTEXTO_DO_AGENTE.esquecer(sessao.client_id);
  await auditLog({
    correlationId: crypto.randomUUID(), toolName: "conselho_decidir", origin: "mesa:conselho", keyId: `mesa:conselho:${ch.userId}`, scopes: ["mesa:write"],
    input: { client_id: sessao.client_id, sessao_id: sessao.id, escolha: decisao.escolha, especialista: decisao.especialista }, success: true, statusCode: 200, durationMs: 0, resultRef: memoriaId,
  });
  return json({
    sessao: sessaoDaLinha(data as Record<string, unknown>),
    ata,
    memoria_id: memoriaId,
    cerebro_id: noCerebro.id,
    prova: `Guardado no cérebro do cliente como decisão (${memoriaId.slice(0, 8)})${noCerebro.gravada ? "; todos os agentes passam a seguir" : ""}.`,
    aviso: noCerebro.gravada ? null : "A decisão ficou na ata e na memória do projeto, mas não entrou no cérebro dos agentes. Tente decidir de novo mais tarde.",
  });
}

async function desfazerDecisao(ch: Chamador, corpo: Record<string, unknown>) {
  const sessao = await lerSessao(ch, corpo.sessao_id);
  if (!sessao.decisao || sessao.decisao.desfeita_em) throw new ErroHttp(409, "sem_decisao", "Esta sessão não tem decisão para desfazer.");
  const agora = new Date().toISOString();
  if (sessao.memoria_id) {
    const { data: m, error } = await servico().from("project_memory").select("tags, metadata, title").eq("id", sessao.memoria_id).maybeSingle();
    if (error) throw erroDoBanco(error, "memória da decisão não lida");
    if (m) {
      const linha = m as { tags?: string[] | null; metadata?: Record<string, unknown> | null; title?: string | null };
      const tags = (linha.tags || []).indexOf("desfeita") >= 0 ? linha.tags || [] : [...(linha.tags || []), "desfeita"];
      // Apagar é arquivar: a memória fica, marcada como desfeita, e sai das próximas sessões.
      const { error: e2 } = await servico().from("project_memory").update({
        tags, title: String(linha.title || "").indexOf("Desfeita: ") === 0 ? linha.title : `Desfeita: ${String(linha.title || "")}`.slice(0, 200),
        metadata: { ...(linha.metadata || {}), desfeita_em: agora, desfeita_por: ch.userId, documento_pendente: false },
      }).eq("id", sessao.memoria_id);
      if (e2) throw erroDoBanco(e2, "memória da decisão não marcada");
    }
  }
  const decisao = { ...sessao.decisao, desfeita_em: agora };
  const falas = await lerFalas(sessao.id);
  const [cliente, modelos] = await Promise.all([nomeDoCliente(sessao.client_id), rotulosDosModelos(sessao)]);
  const ata = montarAta({ ...sessao, decisao }, falas, { cliente, modelos });
  const { data, error } = await servico().from("conselho_sessoes").update({ decisao, ata, atualizado_em: agora }).eq("id", sessao.id).select(CAMPOS_DA_SESSAO).single();
  if (error) throw erroDoBanco(error, "desfazer não gravado");
  // Frente SYNC: a linha do cérebro também sai (ativa=false; o histórico fica).
  const fora = await desfazerDecisaoNoCerebro(servico(), { clientId: sessao.client_id, sessaoId: sessao.id });
  CONTEXTO_DO_AGENTE.esquecer(sessao.client_id);
  await auditLog({
    correlationId: crypto.randomUUID(), toolName: "conselho_desfazer_decisao", origin: "mesa:conselho", keyId: `mesa:conselho:${ch.userId}`, scopes: ["mesa:write"],
    input: { client_id: sessao.client_id, sessao_id: sessao.id }, success: true, statusCode: 200, durationMs: 0, resultRef: sessao.memoria_id || sessao.id,
  });
  return json({ sessao: sessaoDaLinha(data as Record<string, unknown>), aviso: fora.ok ? null : "A decisão foi desfeita na ata, mas ainda está no cérebro dos agentes: tire em Contexto, O que o painel aprendeu." });
}

async function ata(ch: Chamador, corpo: Record<string, unknown>) {
  const sessao = await lerSessao(ch, corpo.sessao_id);
  const falas = await lerFalas(sessao.id);
  const [cliente, modelos] = await Promise.all([nomeDoCliente(sessao.client_id), rotulosDosModelos(sessao)]);
  const md = montarAta(sessao, falas, { cliente, modelos });
  const nome = `ata-conselho-${sessao.criado_em.slice(0, 10)}-${sessao.tema.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "sessao"}.md`;
  return json({ ata: md, nome_do_arquivo: nome, especialistas: sessao.especialistas.map((m) => ({ id: m.id, nome: nomeDoEspecialista(m.id) })) });
}


/** O que os módulos da frente BRF2 (extras.ts) usam daqui. */
function ctxDe(ch: Chamador): CtxDoConselho {
  return {
    userId: ch.userId,
    servico: servico(),
    doChamador: ch.doChamador,
    garantirAcesso: (clientId) => garantirAcesso(ch, clientId),
    lerSessao: (id) => lerSessao(ch, id),
    lerFalas,
    nomeDoCliente,
    rotulosDosModelos,
    json,
    erro: (status, codigo, mensagem) => new ErroHttp(status, codigo, mensagem),
  };
}
// ------------------------------------------------------------------ rotas

const ACOES: Record<string, (ch: Chamador, corpo: Record<string, unknown>) => Promise<Response>> = {
  catalogo,
  estimar,
  convocar,
  avancar,
  perguntar,
  nova_rodada: novaRodada,
  parar,
  decidir,
  desfazer_decisao: desfazerDecisao,
  ata,
  elencos: (ch, corpo) => elencos(ctxDe(ch), corpo),
  salvar_elenco: (ch, corpo) => salvarElenco(ctxDe(ch), corpo),
  arquivar_elenco: (ch, corpo) => arquivarElenco(ctxDe(ch), corpo),
  ata_pdf: (ch, corpo) => ataEmPdf(ctxDe(ch), corpo),
  // Frente SYNC: "Esquecer" e "Guardar como regra" do que a conversa do conselho aprendeu.
  ...rotasDoAprendizado({ mesa: "conselho", servico, garantirAcesso: (ch, clientId) => garantirAcesso(ch as Chamador, clientId), json }),
};

/** Ações que podem passar de 150 s: a resposta começa na hora. */
const ACOES_LONGAS = new Set(["perguntar", "convocar", "nova_rodada", "ata_pdf"]);

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
        if (err instanceof JevErro) registrarFalha("conselho: jev", err);
        return respostaDeErro(err);
      }
    };
    return ACOES_LONGAS.has(acao) ? respostaComFolego(rodar, corsHeaders) : await rodar();
  } catch (err) {
    return respostaDeErro(err);
  }
});
