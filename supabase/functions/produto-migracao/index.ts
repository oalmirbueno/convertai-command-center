/**
 * Migração do e-mail feita pelo próprio cliente (19/11/2026). Contrato do banco:
 * 20261119200000_produto_email_migracao_pelo_cliente.sql.
 *
 *   provedores {}                                        -> { provedores }  a lista de onde o e-mail pode estar
 *   estado { caixa_id }                                  -> { migracao }    o andamento da cópia desta caixa
 *   iniciar { caixa_id, provedor, usuario, senha,
 *             host?, senha_destino? }                    -> { migracao }    confere as senhas e começa
 *   pausar / continuar / cancelar { migracao_id }         -> { migracao }
 *   trabalhar {}  (só a rotina, com x-cron-secret)       -> { feitas }      copia um pouco de cada trabalho
 *
 * O provedor antigo é só lido. A senha de lá vai para o Vault e sai de lá quando a cópia termina. A
 * senha da caixa nova fica no cofre da caixa (é a mesma que liga a caixa ao correio do painel).
 */
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { PREFLIGHT_CACHE } from "../_shared/cors.ts";
import { ErroDoCorreio, Imap, conectarTls } from "../produto-correio/modulos/imap.ts";
import { PROVEDORES, provedorPorId, rodada, type AndamentoDaPasta } from "./modulos/copiar.ts";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  ...PREFLIGHT_CACHE,
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DESTINO = { host: "imap.migadu.com", porta: 993 };
const PRAZO_DA_RODADA_MS = 95_000;

class ErroHttp extends Error {
  constructor(public status: number, public codigo: string, mensagem: string) {
    super(mensagem);
  }
}
const json = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
const amb = (n: string) => String(Deno.env.get(n) || "").trim();
let cache: SupabaseClient | null = null;
const servico = () => (cache ||= createClient(amb("SUPABASE_URL"), amb("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false, autoRefreshToken: false } }));

async function quemChama(req: Request): Promise<string> {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new ErroHttp(401, "sessao_expirada", "Sessão expirada. Entre de novo.");
  const { data } = await servico().auth.getUser(token);
  if (!data || !data.user) throw new ErroHttp(401, "sessao_expirada", "Sessão expirada. Entre de novo.");
  return data.user.id;
}

function daRotina(req: Request): boolean {
  const segredo = amb("CRON_SECRET");
  if (segredo && (req.headers.get("x-cron-secret") || "").trim() === segredo) return true;
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  return !!token && token === amb("SUPABASE_SERVICE_ROLE_KEY");
}

interface Caixa {
  id: string;
  conta_id: string;
  endereco: string;
  tem_segredo: boolean;
}

/** Quem pode mexer na migração desta caixa: a casa ou quem administra a empresa dela. */
async function caixaDeQuem(usuario: string, caixaId: unknown): Promise<Caixa> {
  if (typeof caixaId !== "string" || !UUID.test(caixaId)) throw new ErroHttp(400, "caixa_invalida", "Escolha a caixa de novo.");
  const { data } = await servico().from("produto_email_caixas").select("id, conta_id, endereco, tem_segredo").eq("id", caixaId).maybeSingle();
  const c = data as Caixa | null;
  if (!c) throw new ErroHttp(404, "caixa_inexistente", "Essa caixa não foi encontrada.");
  const [{ data: papeis }, { data: membro }] = await Promise.all([
    servico().from("user_roles").select("role").eq("user_id", usuario),
    servico().from("produto_membros").select("papel").eq("user_id", usuario).eq("conta_id", c.conta_id).eq("estado", "ativo").maybeSingle(),
  ]);
  const dono = ((papeis || []) as Array<{ role: string }>).some((p) => p.role === "admin");
  if (!dono && !(membro && (membro as { papel: string }).papel === "admin")) throw new ErroHttp(403, "sem_permissao", "Só quem administra a empresa traz os e-mails antigos.");
  return c;
}

const lerMigracao = async (filtro: { id?: string; caixa?: string }) => {
  let q = servico().from("produto_email_migracoes").select("*").order("criado_em", { ascending: false }).limit(1);
  q = filtro.id ? q.eq("id", filtro.id) : q.eq("caixa_id", filtro.caixa!);
  const { data } = await q;
  return (Array.isArray(data) && data[0]) || null;
};

/** O que a tela mostra: sem host, sem senha, só o andamento. */
const publico = (m: Record<string, unknown> | null) =>
  m && {
    id: m.id, caixa_id: m.caixa_id, provedor_origem: m.provedor_origem, origem_usuario: m.origem_usuario, estado: m.estado,
    total: m.total, copiadas: m.copiadas, puladas: m.puladas, erros: m.erros, mensagem: m.mensagem,
    criado_em: m.criado_em, atualizado_em: m.atualizado_em, concluida_em: m.concluida_em,
  };

async function testarLogin(host: string, porta: number, usuario: string, senha: string, quem: "antigo" | "novo") {
  try {
    const imap = await Imap.abrir(conectarTls, host, porta, usuario, senha);
    imap.fechar();
  } catch (e) {
    const msg = e instanceof ErroDoCorreio ? e.message : "";
    if (/senha/i.test(msg)) {
      throw new ErroHttp(400, quem === "antigo" ? "senha_antiga" : "senha_nova", quem === "antigo"
        ? "O e-mail antigo não aceitou essa senha. Confira o endereço e a senha (no Gmail, Outlook e Yahoo use a senha de app)."
        : "A caixa nova não aceitou essa senha. Use a senha que você criou no convite.");
    }
    throw new ErroHttp(400, "servidor", quem === "antigo"
      ? "Não consegui falar com o servidor do e-mail antigo. Confira o provedor escolhido."
      : "Não consegui falar com a caixa nova agora. Tente de novo em instantes.");
  }
}

async function iniciar(usuario: string, corpo: Record<string, unknown>) {
  const caixa = await caixaDeQuem(usuario, corpo.caixa_id);
  const prov = provedorPorId(String(corpo.provedor || ""));
  if (!prov) throw new ErroHttp(400, "provedor", "Escolha onde o e-mail está hoje.");
  const host = (prov.host || String(corpo.host || "")).trim().toLowerCase();
  if (!/^[a-z0-9.-]{3,120}$/.test(host)) throw new ErroHttp(400, "host", "Diga o servidor IMAP do e-mail antigo (ex.: imap.seuprovedor.com.br).");
  const origemUsuario = String(corpo.usuario || "").trim();
  const senha = String(corpo.senha || "").replace(prov.senha_de_app ? /\s+/g : /^$/, "");
  if (origemUsuario.length < 3 || !senha) throw new ErroHttp(400, "dados", "Preencha o e-mail e a senha do e-mail antigo.");
  if (origemUsuario.toLowerCase() === caixa.endereco.toLowerCase() && host === DESTINO.host) throw new ErroHttp(400, "mesma_caixa", "O e-mail antigo é a própria caixa nova.");

  const viva = await lerMigracao({ caixa: caixa.id });
  if (viva && (viva.estado === "copiando" || viva.estado === "pausada")) return json({ migracao: publico(viva) });

  // A senha da caixa nova: a do cofre (se a caixa já foi conectada) ou a que veio agora.
  let senhaNova = String(corpo.senha_destino || "");
  if (!senhaNova && caixa.tem_segredo) {
    const { data } = await servico().rpc("produto_email_ler_segredo_da_caixa", { _caixa: caixa.id });
    senhaNova = typeof data === "string" ? data : "";
  }
  if (!senhaNova) throw new ErroHttp(400, "senha_nova", "Digite a senha da caixa nova (a que você criou no convite).");

  await testarLogin(host, prov.porta, origemUsuario, senha, "antigo");
  await testarLogin(DESTINO.host, DESTINO.porta, caixa.endereco, senhaNova, "novo");
  if (corpo.senha_destino) {
    // A mesma senha liga a caixa ao correio do painel.
    await servico().rpc("produto_email_guardar_segredo_da_caixa", { _caixa: caixa.id, _segredo: senhaNova });
  }

  if (viva && (viva.estado === "erro" || viva.estado === "cancelada")) {
    await servico().from("produto_email_migracoes").update({ estado: "cancelada", atualizado_em: new Date().toISOString() }).eq("id", viva.id);
  }
  const { data: nova, error } = await servico().from("produto_email_migracoes").insert({
    conta_id: caixa.conta_id, caixa_id: caixa.id, provedor_origem: prov.id, origem_host: host, origem_porta: prov.porta,
    origem_usuario: origemUsuario, estado: "copiando", mensagem: "Começando: medindo o e-mail antigo.", iniciada_por: usuario,
  }).select("*").single();
  if (error || !nova) throw new ErroHttp(500, "banco", "Não foi possível começar agora. Tente de novo.");
  const { error: erroDoCofre } = await servico().rpc("produto_email_migracao_senha", { _migracao: nova.id, _acao: "guardar", _senha: senha });
  if (erroDoCofre) {
    await servico().from("produto_email_migracoes").delete().eq("id", nova.id);
    throw new ErroHttp(500, "cofre", "Não foi possível guardar a senha no cofre agora.");
  }
  await servico().from("produto_historico").insert({ conta_id: caixa.conta_id, ator: usuario, acao: "email_migracao_iniciada", detalhe: { caixa: caixa.endereco, provedor: prov.id } });
  return json({ migracao: publico(nova) });
}

async function mudar(usuario: string, corpo: Record<string, unknown>, para: "pausada" | "copiando" | "cancelada") {
  const id = String(corpo.migracao_id || "");
  if (!UUID.test(id)) throw new ErroHttp(400, "migracao_invalida", "Recarregue a tela.");
  const m = await lerMigracao({ id });
  if (!m) throw new ErroHttp(404, "migracao_inexistente", "Essa cópia não foi encontrada.");
  await caixaDeQuem(usuario, m.caixa_id);
  const { data } = await servico().from("produto_email_migracoes").update({
    estado: para, proxima_em: new Date().toISOString(), atualizado_em: new Date().toISOString(),
    mensagem: para === "pausada" ? "Pausada. Continue quando quiser." : para === "cancelada" ? "Cancelada. Nada foi apagado." : "Continuando.",
  }).eq("id", id).select("*").single();
  if (para === "cancelada") await servico().rpc("produto_email_migracao_senha", { _migracao: id, _acao: "apagar" });
  return json({ migracao: publico(data) });
}

/** A rotina: uma rodada de cópia em cada trabalho pronto. */
async function trabalhar() {
  const { data: fila } = await servico().rpc("produto_email_migracao_pegar", { _limite: 2 });
  const trabalhos = (Array.isArray(fila) ? fila : []) as Array<Record<string, unknown>>;
  const fim = Date.now() + PRAZO_DA_RODADA_MS;
  let feitas = 0;
  for (const m of trabalhos) {
    const id = String(m.id);
    const salvar = (campos: Record<string, unknown>) => servico().from("produto_email_migracoes").update({ ...campos, atualizado_em: new Date().toISOString() }).eq("id", id);
    let origem: Imap | null = null;
    let destino: Imap | null = null;
    try {
      const { data: senha } = await servico().rpc("produto_email_migracao_senha", { _migracao: id, _acao: "ler" });
      const { data: senhaNova } = await servico().rpc("produto_email_ler_segredo_da_caixa", { _caixa: m.caixa_id });
      const { data: caixa } = await servico().from("produto_email_caixas").select("endereco").eq("id", m.caixa_id).maybeSingle();
      if (!senha || !senhaNova || !caixa) throw new ErroDoCorreio("Falta uma das senhas. Comece a cópia de novo.");
      origem = await Imap.abrir(conectarTls, String(m.origem_host), Number(m.origem_porta), String(m.origem_usuario), String(senha));
      destino = await Imap.abrir(conectarTls, DESTINO.host, DESTINO.porta, String((caixa as { endereco: string }).endereco), String(senhaNova));
      const r = await rodada(origem, destino, {
        pastas: (m.pastas || {}) as Record<string, AndamentoDaPasta>,
        prazo: Math.min(fim, Date.now() + PRAZO_DA_RODADA_MS / Math.max(1, trabalhos.length)),
        vistos: {
          quais: async (chaves) => {
            if (!chaves.length) return new Set();
            const { data } = await servico().from("produto_email_migracao_vistos").select("chave").eq("migracao_id", id).in("chave", chaves);
            return new Set(((data || []) as Array<{ chave: string }>).map((x) => x.chave));
          },
          marcar: async (chaves) => {
            await servico().from("produto_email_migracao_vistos").upsert(chaves.map((chave) => ({ migracao_id: id, chave })), { onConflict: "migracao_id,chave", ignoreDuplicates: true });
          },
        },
      });
      const copiadas = Number(m.copiadas || 0) + r.copiadas;
      const puladas = Number(m.puladas || 0) + r.puladas;
      const erros = Number(m.erros || 0) + r.erros;
      if (r.acabou) {
        await salvar({ estado: "concluida", pastas: r.pastas, total: r.total, copiadas, puladas, erros, concluida_em: new Date().toISOString(), mensagem: erros ? `Pronto. ${erros} mensagem(ns) não entraram (muito grandes ou recusadas).` : "Pronto. Tudo o que estava lá já está na caixa nova." });
        await servico().rpc("produto_email_migracao_senha", { _migracao: id, _acao: "apagar" });
        await servico().from("produto_historico").insert({ conta_id: m.conta_id, acao: "email_migracao_concluida", detalhe: { migracao: id, copiadas, erros } });
      } else {
        await salvar({ estado: "copiando", pastas: r.pastas, total: r.total, copiadas, puladas, erros, tentativas: 0, proxima_em: new Date().toISOString(), mensagem: r.problemas[0] || "Copiando. Pode fechar esta tela: a cópia continua sozinha." });
      }
      feitas++;
    } catch (e) {
      const tentativas = Number(m.tentativas || 0) + 1;
      const msg = e instanceof ErroDoCorreio ? e.message : "O servidor de e-mail não respondeu.";
      // Senha recusada para na hora; falha de rede tenta de novo, cada vez mais espaçado.
      const parar = /senha/i.test(msg) || tentativas >= 8;
      await salvar({ estado: parar ? "erro" : "copiando", tentativas, proxima_em: new Date(Date.now() + Math.min(30, 2 ** tentativas) * 60_000).toISOString(), mensagem: parar ? `Parou: ${msg}` : `Tentando de novo em instantes (${msg})` });
      console.error("[produto-migracao]", id, msg.slice(0, 160));
    } finally {
      if (origem) origem.fechar();
      if (destino) destino.fechar();
    }
  }
  return json({ feitas });
}

if (import.meta.main) {
  Deno.serve(async (req) => {
    if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
    if (req.method !== "POST") return json({ error: "metodo_nao_permitido", mensagem: "Use POST." }, 405);
    try {
      const corpo = ((await req.json().catch(() => ({}))) || {}) as Record<string, unknown>;
      const acao = String(corpo.acao || "");
      if (acao === "trabalhar") {
        if (!daRotina(req)) return json({ error: "sem_permissao" }, 403);
        return await trabalhar();
      }
      if (acao === "provedores") return json({ provedores: PROVEDORES.map(({ id, nome, senha_de_app }) => ({ id, nome, senha_de_app: senha_de_app || null })) });
      const usuario = await quemChama(req);
      if (acao === "estado") {
        const c = await caixaDeQuem(usuario, corpo.caixa_id);
        return json({ migracao: publico(await lerMigracao({ caixa: c.id })) });
      }
      if (acao === "iniciar") return await iniciar(usuario, corpo);
      if (acao === "pausar") return await mudar(usuario, corpo, "pausada");
      if (acao === "continuar") return await mudar(usuario, corpo, "copiando");
      if (acao === "cancelar") return await mudar(usuario, corpo, "cancelada");
      return json({ error: "acao_desconhecida", mensagem: "Ação desconhecida." }, 400);
    } catch (err) {
      if (err instanceof ErroHttp) return json({ error: err.codigo, mensagem: err.message }, err.status);
      console.error("[produto-migracao] erro inesperado", err instanceof Error ? err.message.slice(0, 200) : "");
      return json({ error: "erro_interno", mensagem: "Falha inesperada. Tente de novo." }, 500);
    }
  });
}
