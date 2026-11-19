/**
 * O correio do cliente dentro do painel (18/11/2026): cada pessoa abre a própria caixa e o master
 * abre todas as da empresa. Contrato do banco: 20261118200000_produto_email_central_e_correio.sql.
 *
 *   pastas   { caixa_id }                        -> { pastas }
 *   listar   { caixa_id, pasta?, pagina?, busca? } -> { mensagens }
 *   ler      { caixa_id, pasta?, id }            -> { mensagem }
 *   enviar   { caixa_id, para, assunto, texto }  -> { id }
 *   guardar_segredo { caixa_id, segredo }        -> { guardado }   (quem administra a empresa, ou a casa)
 *   entrar_pela_casa { caixa_id, senha_da_casa } -> { ok, endereco }  (só a casa: confere a senha no provedor)
 *
 * Minha caixa (19/11/2026): a casa (admin do painel) abre qualquer caixa com a senha que digitou, para
 * ver o correio como o cliente vê. Com `senha_da_casa` no pedido, as ações acima usam essa senha só
 * naquele pedido, no lugar da do Vault; ela nunca é guardada nem vai para o log. Cada entrada e cada
 * envio pela casa ficam no histórico da empresa (sem a senha).
 *
 * Toda ação confere no banco se a pessoa pode abrir aquela caixa (produto_email_pode_abrir) antes de
 * tocar no provedor. A senha de aplicativo de cada caixa mora no Vault e nunca volta para a tela.
 * Sem provedor contratado, tudo responde "correio_desligado" (409), e a tela mostra "em preparação".
 */
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { PREFLIGHT_CACHE } from "../_shared/cors.ts";
import { ADAPTADORES, adaptadorPara, CorreioDesligado, envioValido, provedorPelaCasa, SENHA_DA_CASA_RECUSADA, senhaDaCasa, type CaixaAberta, type ProvedorDeCorreio } from "./modulos/adaptador.ts";
import { adaptadorImap, ErroDoCorreio } from "./modulos/imap.ts";

// Migadu (19/11/2026): IMAP para ler e SMTP para enviar, com a senha de cada caixa guardada no Vault.
ADAPTADORES.migadu = adaptadorImap({ imap: { host: "imap.migadu.com", porta: 993 }, smtp: { host: "smtp.migadu.com", porta: 465 } });

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  ...PREFLIGHT_CACHE,
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class ErroHttp extends Error {
  constructor(public status: number, public codigo: string, mensagem: string) {
    super(mensagem);
  }
}

const json = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

let cache: SupabaseClient | null = null;
const servico = () => (cache ||= createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } }));

async function quemChama(req: Request): Promise<string> {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new ErroHttp(401, "sessao_expirada", "Sessão expirada. Entre de novo.");
  const { data } = await servico().auth.getUser(token);
  if (!data || !data.user) throw new ErroHttp(401, "sessao_expirada", "Sessão expirada. Entre de novo.");
  return data.user.id;
}

const idDaCaixa = (v: unknown) => {
  if (typeof v !== "string" || !UUID.test(v)) throw new ErroHttp(400, "caixa_invalida", "Escolha a caixa de novo.");
  return v;
};

async function ehDaCasa(usuario: string): Promise<boolean> {
  const { data } = await servico().from("user_roles").select("role").eq("user_id", usuario);
  return ((data || []) as Array<{ role: string }>).some((p) => p.role === "admin");
}

/** A casa abre a caixa com a senha que digitou (só neste pedido). Caixa de verdade, já criada. */
async function abrirPelaCasa(usuario: string, caixaId: string, senha: string): Promise<{ caixa: CaixaAberta; ligado: boolean; temSegredo: boolean; contaId: string }> {
  if (!(await ehDaCasa(usuario))) throw new ErroHttp(403, "sem_permissao", "Só a administração da Aceleriq entra nas caixas por aqui.");
  const { data } = await servico().from("produto_email_caixas").select("id, endereco, conta_id, dominio_id, tipo, estado").eq("id", caixaId).maybeSingle();
  const c = data as { id: string; endereco: string; conta_id: string; dominio_id: string; tipo: string; estado: string } | null;
  if (!c || c.tipo !== "caixa" || ["criada", "copiando", "ativa"].indexOf(c.estado) < 0) throw new ErroHttp(404, "caixa_inexistente", "Essa caixa não está disponível.");
  const { data: d } = await servico().from("produto_email_dominios").select("dominio, provedor, correio_provedor").eq("id", c.dominio_id).maybeSingle();
  const dom = (d || { dominio: "", provedor: "", correio_provedor: "nenhum" }) as { dominio: string; provedor: string; correio_provedor: string };
  const provedor = provedorPelaCasa(dom.correio_provedor, dom.provedor);
  return { caixa: { id: c.id, endereco: c.endereco, dominio: dom.dominio, provedor, segredo: senha }, ligado: provedor !== "nenhum", temSegredo: true, contaId: c.conta_id };
}

/** Confere a permissão e abre a caixa com o segredo do Vault. */
async function abrir(usuario: string, caixaId: string): Promise<{ caixa: CaixaAberta; ligado: boolean; temSegredo: boolean }> {
  const { data: pode } = await servico().rpc("produto_email_pode_abrir", { _caixa: caixaId, _usuario: usuario });
  // Caixa de outra empresa responde igual a caixa inexistente.
  if (pode !== true) throw new ErroHttp(404, "caixa_inexistente", "Essa caixa não está disponível para você.");
  const { data } = await servico().from("produto_email_caixas").select("id, endereco, tem_segredo, dominio_id").eq("id", caixaId).maybeSingle();
  const c = data as { id: string; endereco: string; tem_segredo: boolean; dominio_id: string } | null;
  if (!c) throw new ErroHttp(404, "caixa_inexistente", "Essa caixa não está disponível para você.");
  const { data: d } = await servico().from("produto_email_dominios").select("dominio, correio_provedor, correio_ligado").eq("id", c.dominio_id).maybeSingle();
  const dom = (d || { dominio: "", correio_provedor: "nenhum", correio_ligado: false }) as { dominio: string; correio_provedor: ProvedorDeCorreio; correio_ligado: boolean };
  let segredo = "";
  if (dom.correio_ligado && c.tem_segredo) {
    const { data: s } = await servico().rpc("produto_email_ler_segredo_da_caixa", { _caixa: c.id });
    segredo = typeof s === "string" ? s : "";
  }
  return { caixa: { id: c.id, endereco: c.endereco, dominio: dom.dominio, provedor: dom.correio_provedor, segredo }, ligado: dom.correio_ligado, temSegredo: !!segredo };
}

async function comAdaptador<T>(usuario: string, corpo: Record<string, unknown>, fazer: (a: ReturnType<typeof adaptadorPara>, caixa: CaixaAberta, contaDaCasa: string | null) => Promise<T>): Promise<T> {
  const senha = senhaDaCasa(corpo.senha_da_casa);
  const aberta: { caixa: CaixaAberta; ligado: boolean; temSegredo: boolean; contaId?: string } = senha ? await abrirPelaCasa(usuario, idDaCaixa(corpo.caixa_id), senha) : await abrir(usuario, idDaCaixa(corpo.caixa_id));
  const { caixa, ligado, temSegredo } = aberta;
  try {
    return await fazer(adaptadorPara(caixa.provedor, ligado, temSegredo), caixa, senha && aberta.contaId ? aberta.contaId : null);
  } catch (e) {
    if (e instanceof CorreioDesligado) throw new ErroHttp(409, "correio_desligado", e.message);
    if (e instanceof ErroHttp) throw e;
    if (senha && e instanceof ErroDoCorreio && /recusou a senha/i.test(e.message)) throw new ErroHttp(401, "senha_recusada", SENHA_DA_CASA_RECUSADA);
    // Erro que a pessoa entende (senha recusada, mensagem que sumiu): vai como está.
    if (e instanceof ErroDoCorreio) throw new ErroHttp(502, "provedor", e.message);
    console.error("[produto-correio] provedor", e instanceof Error ? e.message.slice(0, 200) : "");
    throw new ErroHttp(502, "provedor", "O provedor de e-mail não respondeu agora. Tente de novo.");
  }
}

const pasta = (v: unknown) => (typeof v === "string" && /^[\w .\-/]{1,80}$/.test(v) ? v : "INBOX");

/** O histórico da empresa: a casa entrou ou enviou pela caixa dela. Nunca leva a senha. */
async function registrarPelaCasa(contaId: string, ator: string, acao: string, detalhe: Record<string, unknown>) {
  const { error } = await servico().from("produto_historico").insert({ conta_id: contaId, ator, acao, detalhe });
  if (error) console.error("[produto-correio] histórico não gravado", error.message.slice(0, 160));
}

type Acao = (usuario: string, corpo: Record<string, unknown>) => Promise<Response>;
const ACOES: Record<string, Acao> = {
  pastas: async (u, c) => json({ pastas: await comAdaptador(u, c, (a, caixa) => a.pastas(caixa)) }),
  // Abrir a caixa: pastas e a primeira página numa conexão só.
  inicio: async (u, c) =>
    json(await comAdaptador(u, c, async (a, caixa) => (a.inicio ? a.inicio(caixa, { pasta: pasta(c.pasta) }) : { pastas: await a.pastas(caixa), mensagens: await a.listar(caixa, { pasta: pasta(c.pasta), pagina: 1 }) }))),
  // As campanhas enviadas desta caixa (o histórico da empresa) e quanto ainda cabe hoje.
  campanhas: async (u, c) => {
    const caixaId = idDaCaixa(c.caixa_id);
    const { data: pode } = await servico().rpc("produto_email_pode_abrir", { _caixa: caixaId, _usuario: u });
    if (pode !== true) throw new ErroHttp(404, "caixa_inexistente", "Essa caixa não está disponível para você.");
    const { data: linha } = await servico().from("produto_email_caixas").select("conta_id").eq("id", caixaId).maybeSingle();
    const contaId = linha ? String((linha as { conta_id: string }).conta_id) : "";
    const { data } = await servico().from("produto_historico").select("criado_em, detalhe").eq("conta_id", contaId).eq("acao", "correio_campanha").order("criado_em", { ascending: false }).limit(60);
    const linhas = ((data || []) as Array<{ criado_em: string; detalhe: Record<string, unknown> }>).filter((x) => x.detalhe && x.detalhe.caixa === caixaId);
    const hoje = new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
    const usados = ((data || []) as Array<{ criado_em: string; detalhe: { enviados?: number } }>).filter((x) => x.criado_em >= `${hoje}T03:00:00`).reduce((s, x) => s + Number((x.detalhe && x.detalhe.enviados) || 0), 0);
    return json({ campanhas: linhas.map((x) => ({ quando: x.criado_em, assunto: String(x.detalhe.assunto || ""), enviados: Number(x.detalhe.enviados || 0), falhas: Number(x.detalhe.falhas || 0) })), usados_hoje: usados, limite_do_dia: 150 });
  },
  // Campanhas (19/11/2026): a mesma mensagem para uma lista, uma por uma, com o limite do dia e o rodapé de
  // descadastro. Quem responde SAIR sai da lista (a tela tira quem pediu). Até 25 por pedido.
  campanha: async (u, c) => {
    const lista = (Array.isArray(c.para) ? c.para : []).map((x) => String(x).trim().toLowerCase()).filter((x) => /^[^@\s<>"]+@[^@\s<>"]+\.[^@\s<>"]+$/.test(x));
    const para = Array.from(new Set(lista)).slice(0, 25);
    const assunto = typeof c.assunto === "string" ? c.assunto.replace(/[\r\n]+/g, " ").trim().slice(0, 200) : "";
    const corpoTexto = typeof c.texto === "string" ? c.texto.slice(0, 20_000) : "";
    if (!para.length || !assunto || !corpoTexto.trim()) throw new ErroHttp(400, "campanha_invalida", "Diga para quem, o assunto e a mensagem.");
    const caixaId = idDaCaixa(c.caixa_id);
    const { data: linha } = await servico().from("produto_email_caixas").select("conta_id").eq("id", caixaId).maybeSingle();
    const contaId = linha ? String((linha as { conta_id: string }).conta_id) : "";
    const hoje = new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
    const { data: doDia } = await servico().from("produto_historico").select("detalhe").eq("conta_id", contaId).eq("acao", "correio_campanha").gte("criado_em", `${hoje}T03:00:00Z`);
    const jaForam = ((doDia || []) as Array<{ detalhe: { enviados?: number } }>).reduce((s, x) => s + Number((x.detalhe && x.detalhe.enviados) || 0), 0);
    const LIMITE_DO_DIA = 150;
    const cabe = Math.max(0, LIMITE_DO_DIA - jaForam);
    if (!cabe) throw new ErroHttp(429, "limite_do_dia", `Hoje já saíram ${jaForam} e-mails de campanha (o limite é ${LIMITE_DO_DIA} por dia, para não cair no spam). Continue amanhã.`);
    const rodape = "\n\n--\nVocê recebeu este e-mail porque tem contato com a nossa empresa. Para não receber mais, responda SAIR.";
    const resultado = await comAdaptador(u, c, async (a, caixa) => {
      const ok: string[] = [];
      const falhas: string[] = [];
      for (const destinatario of para.slice(0, cabe)) {
        try {
          await a.enviar(caixa, { para: [destinatario], assunto, texto: corpoTexto + rodape, em_resposta_a: null });
          ok.push(destinatario);
        } catch {
          falhas.push(destinatario);
        }
      }
      return { enviados: ok.length, falhas, ficaram: para.slice(cabe) };
    });
    if (contaId) await servico().from("produto_historico").insert({ conta_id: contaId, ator: u, acao: "correio_campanha", detalhe: { caixa: caixaId, assunto, enviados: resultado.enviados, falhas: resultado.falhas.length } });
    return json({ ...resultado, limite_do_dia: LIMITE_DO_DIA, usados_hoje: jaForam + resultado.enviados });
  },
  listar: async (u, c) =>
    json({ mensagens: await comAdaptador(u, c, (a, caixa) => a.listar(caixa, { pasta: pasta(c.pasta), pagina: Math.max(1, Math.min(200, Math.floor(Number(c.pagina) || 1))), busca: typeof c.busca === "string" ? c.busca.slice(0, 120) : undefined })) }),
  ler: async (u, c) => {
    if (typeof c.id !== "string" || !c.id || c.id.length > 300) throw new ErroHttp(400, "mensagem_invalida", "Escolha a mensagem de novo.");
    return json({ mensagem: await comAdaptador(u, c, (a, caixa) => a.ler(caixa, { pasta: pasta(c.pasta), id: String(c.id) })) });
  },
  enviar: async (u, c) => {
    const envio = envioValido(c);
    if ("erro" in envio) throw new ErroHttp(400, "envio_invalido", envio.erro);
    return json(
      await comAdaptador(u, c, async (a, caixa, contaDaCasa) => {
        const r = await a.enviar(caixa, envio);
        if (contaDaCasa) await registrarPelaCasa(contaDaCasa, u, "correio_enviado_pela_casa", { caixa: caixa.id, para: envio.para.length });
        return r;
      }),
    );
  },
  entrar_pela_casa: async (u, c) => {
    if (!senhaDaCasa(c.senha_da_casa)) throw new ErroHttp(400, "senha_vazia", "Digite a senha da caixa.");
    const r = await comAdaptador(u, c, async (a, caixa, contaDaCasa) => {
      // Abrir as pastas confere a senha no provedor sem ler nenhuma mensagem.
      await a.pastas(caixa);
      if (contaDaCasa) await registrarPelaCasa(contaDaCasa, u, "correio_aberto_pela_casa", { caixa: caixa.id });
      return { ok: true, endereco: caixa.endereco };
    });
    return json(r);
  },
  guardar_segredo: async (u, c) => {
    const caixaId = idDaCaixa(c.caixa_id);
    const { data: linha } = await servico().from("produto_email_caixas").select("conta_id").eq("id", caixaId).maybeSingle();
    const contaId = linha ? String((linha as { conta_id: string }).conta_id) : "";
    const [{ data: papeis }, { data: membro }] = await Promise.all([
      servico().from("user_roles").select("role").eq("user_id", u),
      servico().from("produto_membros").select("papel").eq("user_id", u).eq("conta_id", contaId || "00000000-0000-0000-0000-000000000000").eq("estado", "ativo").maybeSingle(),
    ]);
    const dono = ((papeis || []) as Array<{ role: string }>).some((p) => p.role === "admin");
    if (!contaId || !(dono || (membro && (membro as { papel: string }).papel === "admin"))) throw new ErroHttp(403, "sem_permissao", "Só quem administra a empresa guarda a senha da caixa.");
    const segredo = typeof c.segredo === "string" ? c.segredo.trim() : "";
    if (segredo.length > 200) throw new ErroHttp(400, "segredo_invalido", "A senha de aplicativo é longa demais.");
    const { data, error } = await servico().rpc("produto_email_guardar_segredo_da_caixa", { _caixa: caixaId, _segredo: segredo });
    if (error) throw new ErroHttp(500, "cofre", "Não foi possível guardar no cofre agora.");
    return json({ guardado: data === true });
  },
};

if (import.meta.main) {
  Deno.serve(async (req) => {
    if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
    if (req.method !== "POST") return json({ error: "metodo_nao_permitido", mensagem: "Use POST." }, 405);
    try {
      const corpo = ((await req.json().catch(() => ({}))) || {}) as Record<string, unknown>;
      const fn = ACOES[String(corpo.acao || "")];
      if (!fn) return json({ error: "acao_desconhecida", mensagem: "Ação desconhecida." }, 400);
      return await fn(await quemChama(req), corpo);
    } catch (err) {
      if (err instanceof ErroHttp) return json({ error: err.codigo, mensagem: err.message }, err.status);
      console.error("[produto-correio] erro inesperado", err instanceof Error ? err.message.slice(0, 200) : "");
      return json({ error: "erro_interno", mensagem: "Falha inesperada. Tente de novo." }, 500);
    }
  });
}
