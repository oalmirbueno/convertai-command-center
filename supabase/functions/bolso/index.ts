import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { configuracaoOpenaiDoServidor, openai, simulado, type Contexto, type Provedor } from "./provedores.ts";
import { caminhoDaArte, mimeReal, type Formato } from "./regras.ts";

/**
 * Trabalhador do Aceleriq de Bolso (26/10/2026).
 *
 * POST { acao: "processar", job_id }  o membro pede para processar o PRÓPRIO job (o banco já reservou o crédito).
 * POST { acao: "processar_fila" }     só administração: processa até 5 jobs da fila (e vira "incerto" o que travou).
 *
 * Quem decide crédito, dono, limite e pausa é o banco (bolso_trabalho_pegar/concluir/falhar, só chave de
 * serviço). Esta função só chama o fornecedor e guarda o arquivo na pasta privada do dono.
 */

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization,apikey,content-type,x-client-info",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
  "Access-Control-Max-Age": "7200",
};
const resposta = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" } });
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

function provedorDe(nome: string): Provedor | null {
  if (nome === "simulado") return simulado;
  if (nome === "openai") {
    return openai(configuracaoOpenaiDoServidor((nome) => Deno.env.get(nome)));
  }
  return null;
}

type Pegado = {
  job: { id: string; user_id: string; campanha_id: string; tipo: "texto" | "imagem"; formato: Formato | null; provedor: string; tentativa: number };
  marca: Contexto["marca"];
  briefing: Contexto["briefing"];
  versao: Contexto["versao"];
};

async function processarUm(servico: SupabaseClient, jobId: string | null): Promise<{ job_id: string | null; estado: string }> {
  const { data, error } = await servico.rpc("bolso_trabalho_pegar", { _job: jobId, _lease_segundos: 150 });
  if (error) throw new Error("fila_indisponivel");
  if (!data) return { job_id: jobId, estado: "nada_a_fazer" };
  const p = data as Pegado;
  const falhar = async (motivo: string, definitiva: boolean) => {
    const { data: f } = await servico.rpc("bolso_trabalho_falhar", { _job: p.job.id, _tentativa: p.job.tentativa, _erro: motivo, _definitiva: definitiva });
    return { job_id: p.job.id, estado: (f && (f as { estado?: string }).estado) || "falhou" };
  };
  const provedor = provedorDe(p.job.provedor);
  if (!provedor) return falhar("Fornecedor desconhecido.", true);
  const ctx: Contexto = { marca: p.marca, briefing: p.briefing, versao: p.versao, formato: p.job.formato };

  if (p.job.tipo === "texto") {
    const r = await provedor.texto(ctx);
    if (!r.ok) {
      // Incerto: não mexe; o lease vence e o banco marca para conferência.
      if (r.incerto) return { job_id: p.job.id, estado: "processando" };
      return falhar(r.motivo, r.definitiva);
    }
    const { data: c, error: e } = await servico.rpc("bolso_trabalho_concluir", { _job: p.job.id, _tentativa: p.job.tentativa, _resultado: r.conteudo, _arquivo: null, _custo: r.custo || null });
    if (e) return falhar("O resultado não passou na conferência.", true);
    return { job_id: p.job.id, estado: (c as { estado?: string }).estado || "concluido" };
  }

  const r = await provedor.imagem(ctx);
  if (!r.ok) {
    if (r.incerto) return { job_id: p.job.id, estado: "processando" };
    return falhar(r.motivo, r.definitiva);
  }
  const mime = mimeReal(r.bytes);
  if (!mime || r.bytes.length > 10 * 1024 * 1024) return falhar("A imagem recebida não é um PNG, JPEG ou WEBP válido.", true);
  const extensao = mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg";
  const caminho = caminhoDaArte(p.job.user_id, p.job.campanha_id, p.job.id, extensao);
  const { error: erroUpload } = await servico.storage.from("bolso").upload(caminho, r.bytes, { contentType: mime, upsert: true, cacheControl: "private, max-age=0" });
  // Falha de armazenamento: a arte foi feita mas não guardada; tenta de novo (o fornecedor simulado é grátis; o real fica incerto pelo lease).
  if (erroUpload) return p.job.provedor === "simulado" ? falhar("Não foi possível guardar a arte.", false) : { job_id: p.job.id, estado: "processando" };
  const { data: c, error: e } = await servico.rpc("bolso_trabalho_concluir", {
    _job: p.job.id, _tentativa: p.job.tentativa, _resultado: {}, _arquivo: { caminho, mime, bytes: r.bytes.length }, _custo: r.custo || null,
  });
  if (e) return falhar("O arquivo não passou na conferência.", true);
  return { job_id: p.job.id, estado: (c as { estado?: string }).estado || "concluido" };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return resposta({ erro: "metodo_nao_permitido" }, 405);
  const token = (req.headers.get("authorization") || "").replace(/^Bearer /i, "");
  if (!token) return resposta({ erro: "sessao_expirada" }, 401);
  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const usuario = createClient(url, anon, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false } });
  const { data: auth, error: erroAuth } = await usuario.auth.getUser(token);
  if (erroAuth || !auth.user) return resposta({ erro: "sessao_expirada" }, 401);
  let corpo: Record<string, unknown>;
  try {
    const texto = await req.text();
    if (texto.length > 2048) return resposta({ erro: "pedido_grande" }, 413);
    corpo = JSON.parse(texto);
    if (!corpo || typeof corpo !== "object" || Array.isArray(corpo)) throw new Error();
  } catch {
    return resposta({ erro: "pedido_invalido" }, 400);
  }
  const servico = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });
  try {
    if (corpo.acao === "processar") {
      if (typeof corpo.job_id !== "string" || !UUID.test(corpo.job_id)) return resposta({ erro: "job_invalido" }, 400);
      // Dono confere pelo JWT do membro: só a campanha dele devolve o job.
      const { data: dono } = await servico.from("bolso_jobs").select("user_id").eq("id", corpo.job_id).maybeSingle();
      if (!dono || dono.user_id !== auth.user.id) return resposta({ erro: "job_nao_encontrado" }, 404);
      return resposta(await processarUm(servico, corpo.job_id));
    }
    if (corpo.acao === "processar_fila") {
      const { data: admin } = await usuario.rpc("membros_admin");
      if (admin !== true) return resposta({ erro: "sem_permissao" }, 403);
      const feitos = [];
      for (let i = 0; i < 5; i++) {
        const r = await processarUm(servico, null);
        if (r.estado === "nada_a_fazer") break;
        feitos.push(r);
        // O banco pode devolver o mesmo job à fila. Não gastar suas tentativas no mesmo lote.
        // Um resultado incerto também encerra o lote e mantém o lease para conferência.
        if (r.estado === "na_fila" || r.estado === "processando") break;
      }
      return resposta({ processados: feitos });
    }
    return resposta({ erro: "acao_desconhecida" }, 400);
  } catch {
    return resposta({ erro: "falha_temporaria" }, 503);
  }
});
