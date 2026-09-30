/**
 * site-formulario: o formulário dos sites da Mesa Site (frente SIT2,
 * 30/09/2026), sem login. O componente <Formulario /> do modelo de site manda
 * o envio para cá; o contato cai no CRM do painel (commercial_leads, origem
 * "site") pela RPC site_registrar_lead, que só aceita a service_role.
 *
 * POST { chave, nome, email?, whatsapp?, empresa?, mensagem?, pagina?, iniciado_em, site_url }
 *   site_url é a armadilha (campo escondido que gente não vê e robô preenche).
 * -> 200 { ok: true, mensagem } · 400 { ok: false, codigo, mensagem } · 429 limite
 *
 * Anti-spam em camadas: armadilha, tempo mínimo entre abrir e enviar, links
 * demais, marcação HTML, origem do navegador (o domínio do site, a publicação
 * ou a prévia do motor), limite por IP (5 em 10 min) e por site (60 por hora)
 * no banco, e o mesmo contato em 10 min não vira lead de novo. O IP nunca é
 * gravado: só um hash com sal. Nada de erro engolido: vai para o log.
 */
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { CHAVE_DO_FORMULARIO, lerEnvio, origemPermitida } from "../_shared/site-lancamento.ts";
import { registrarFalha } from "../_shared/falha-registrada.ts";

const cors = (origem: string | null) => ({
  "Access-Control-Allow-Origin": origem || "*",
  "Vary": "Origin",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "600",
});

const MENSAGENS: Record<string, string> = {
  sem_nome: "Escreva o seu nome.",
  sem_contato: "Deixe um e-mail ou um WhatsApp para a resposta.",
  links_demais: "A mensagem tem links demais. Tire alguns e envie de novo.",
  marcacao: "A mensagem tem código. Escreva só o texto.",
  link_no_nome: "O nome não pode ter link.",
  tempo_invalido: "A página ficou aberta tempo demais. Recarregue e envie de novo.",
  chave_invalida: "Este formulário não está ligado.",
  formulario_desligado: "Este formulário não está ligado.",
  limite: "Recebemos muitos envios agora. Tente de novo em alguns minutos.",
  origem_nao_permitida: "Este formulário só funciona no site dele.",
};

/** Motivos de robô: a resposta finge que deu certo (não ensina o robô a passar). */
const SILENCIOSOS = ["armadilha", "rapido_demais"];
/** Cara de spam: fica registrado para a equipe ver e a pessoa recebe o motivo. */
const SPAM = ["marcacao", "links_demais", "link_no_nome"];

let servicoCache: SupabaseClient | null = null;
function servico(): SupabaseClient {
  if (!servicoCache) servicoCache = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });
  return servicoCache;
}

async function hashDoIp(req: Request): Promise<string> {
  const ip = (req.headers.get("cf-connecting-ip") || (req.headers.get("x-forwarded-for") || "").split(",")[0] || "desconhecido").trim().slice(0, 80);
  const sal = Deno.env.get("SITE_FORMULARIO_SAL") || Deno.env.get("SUPABASE_URL") || "aceleriq";
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${sal}|${ip}`)));
  return Array.from(bytes.slice(0, 16)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Os endereços do site (domínio e publicação) para conferir a origem do navegador. */
async function hostsDoSite(chave: string): Promise<string[] | null> {
  const { data, error } = await servico().from("sites").select("publicacao").eq("integracoes->formulario->>chave", chave).is("arquivado_em", null).limit(1);
  if (error) {
    registrarFalha("site-formulario: site não lido", error);
    return null;
  }
  const linha = ((data as Array<{ publicacao: Record<string, unknown> | null }> | null) ?? [])[0];
  if (!linha) return null;
  const p = linha.publicacao || {};
  const hosts: string[] = [];
  if (typeof p.dominio === "string" && p.dominio) hosts.push(p.dominio);
  if (typeof p.deploy_url === "string") {
    try {
      hosts.push(new URL(p.deploy_url).hostname);
    } catch {
      /* endereço antigo sem formato: fica só o domínio */
    }
  }
  return hosts;
}

Deno.serve(async (req) => {
  const origem = req.headers.get("origin");
  const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...cors(origem), "Content-Type": "application/json" } });
  if (req.method === "OPTIONS") return new Response(null, { headers: cors(origem) });
  if (req.method !== "POST") return json({ ok: false, codigo: "metodo_nao_permitido", mensagem: "Use POST." }, 405);
  let corpo: unknown = null;
  try {
    const texto = await req.text();
    if (texto.length > 12_000) return json({ ok: false, codigo: "grande_demais", mensagem: "Mensagem grande demais." }, 413);
    corpo = JSON.parse(texto);
  } catch {
    return json({ ok: false, codigo: "pedido_invalido", mensagem: "Envio inválido." }, 400);
  }
  try {
    const { envio, motivo } = lerEnvio(corpo);
    if (!envio || !CHAVE_DO_FORMULARIO.test(envio.chave)) return json({ ok: false, codigo: "chave_invalida", mensagem: MENSAGENS.chave_invalida }, 400);
    const hosts = await hostsDoSite(envio.chave);
    if (!hosts) return json({ ok: false, codigo: "formulario_desligado", mensagem: MENSAGENS.formulario_desligado }, 404);
    if (hosts.length && !origemPermitida(origem, hosts)) return json({ ok: false, codigo: "origem_nao_permitida", mensagem: MENSAGENS.origem_nao_permitida }, 403);
    // Erro de gente (sem nome, sem contato): volta para o campo sem gravar nada.
    const ehSpam = !!motivo && (SILENCIOSOS.indexOf(motivo) >= 0 || SPAM.indexOf(motivo) >= 0);
    if (motivo && !ehSpam) return json({ ok: false, codigo: motivo, mensagem: MENSAGENS[motivo] || "Confira os campos e envie de novo." }, 400);
    const ipHash = await hashDoIp(req);
    const { data, error } = await servico().rpc("site_registrar_lead", {
      _chave: envio.chave,
      _ip_hash: ipHash,
      _nome: envio.nome,
      _email: envio.email,
      _whatsapp: envio.whatsapp,
      _empresa: envio.empresa,
      _mensagem: envio.mensagem,
      _pagina: envio.pagina,
      _spam_motivo: ehSpam ? motivo : null,
    });
    if (error) {
      registrarFalha("site-formulario: RPC recusou", error);
      return json({ ok: false, codigo: "indisponivel", mensagem: "Não foi possível enviar agora. Tente de novo em instantes." }, 503);
    }
    const r = (data || {}) as { ok?: boolean; codigo?: string };
    if (motivo && SILENCIOSOS.indexOf(motivo) >= 0) return json({ ok: true, mensagem: "Recebido." });
    if (motivo) return json({ ok: false, codigo: motivo, mensagem: MENSAGENS[motivo] || "Confira os campos e envie de novo." }, 400);
    if (r.ok) return json({ ok: true, mensagem: "Recebido." });
    const codigo = String(r.codigo || "recusado");
    return json({ ok: false, codigo, mensagem: MENSAGENS[codigo] || "Não foi possível enviar agora." }, codigo === "limite" ? 429 : codigo === "formulario_desligado" ? 404 : 400);
  } catch (e) {
    registrarFalha("site-formulario: erro inesperado", e);
    return json({ ok: false, codigo: "erro_interno", mensagem: "Não foi possível enviar agora." }, 500);
  }
});
