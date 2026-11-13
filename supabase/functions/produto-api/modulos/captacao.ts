/**
 * Recebimento público dos formulários de captação (13/11/2026). Sem chave de
 * API: quem abre o link do formulário é o visitante do anúncio, da bio ou do site.
 *
 *   GET  /captar/<token>   o que a página pública precisa: textos, campos, cor e logo da empresa, pixel
 *   POST /captar/<token>   cria o negócio no funil da empresa dona do formulário
 *
 * A empresa vem SÓ do token (crm_captar, no banco). Nada do corpo escolhe
 * empresa, etapa ou responsável. As regras de campo são as de
 * _shared/captacao-do-crm.ts, as mesmas que a página aplica antes de enviar.
 *
 * Proteções: corpo limitado, campo isca contra robô, limite de envios por IP e
 * por formulário (na memória da instância) e limite de leituras por IP.
 */
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { CAMPO_ISCA, criarLimite, ehRobo, lerFormularioPublico, LIMITES, validarEnvio, type FormularioPublico } from "../../_shared/captacao-do-crm.ts";
import { ErroDaApi } from "./operacoes.ts";

const TOKEN = /^[0-9a-f]{24}$/;

/** Envios: 8 por IP a cada 10 minutos e 300 por formulário por hora. Leituras: 90 por IP por minuto. */
const enviosPorIp = criarLimite(8, 10 * 60_000);
const enviosPorFormulario = criarLimite(300, 60 * 60_000);
const leiturasPorIp = criarLimite(90, 60_000);

/** O IP de quem chamou, como o proxy do Supabase informa. Vazio quando não dá para saber. */
export function ipDoPedido(req: Request): string {
  const bruto = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || (req.headers.get("x-real-ip") || "").trim();
  return /^[0-9A-Fa-f:.]{3,45}$/.test(bruto) ? bruto : "";
}

async function lerFormulario(db: SupabaseClient, token: string): Promise<FormularioPublico> {
  if (!TOKEN.test(token)) throw new ErroDaApi(404, "formulario_inexistente", "Este formulário não existe.");
  const { data, error } = await db.rpc("crm_formulario_publico", { _token: token });
  if (error) {
    console.error("[produto-api] captar: leitura", String(error.message || "").slice(0, 160));
    throw new ErroDaApi(503, "indisponivel", "Não foi possível abrir o formulário agora. Tente de novo.");
  }
  const r = (data || {}) as { ok?: boolean; motivo?: string };
  if (!r.ok) {
    if (r.motivo === "desligado") throw new ErroDaApi(410, "formulario_desligado", "Este formulário não está recebendo respostas.");
    throw new ErroDaApi(404, "formulario_inexistente", "Este formulário não existe.");
  }
  const f = lerFormularioPublico(data);
  if (!f) throw new ErroDaApi(404, "formulario_inexistente", "Este formulário não existe.");
  return f;
}

async function corpoDoEnvio(req: Request): Promise<Record<string, unknown>> {
  const bruto = await req.text();
  if (bruto.length > LIMITES.corpo) throw new ErroDaApi(413, "corpo_grande", "O envio é grande demais.");
  try {
    const v = JSON.parse(bruto || "{}");
    if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  } catch {
    /* cai no erro abaixo */
  }
  throw new ErroDaApi(400, "json_invalido", "O envio precisa ser um objeto JSON.");
}

/** Atende GET e POST de /captar/<token>. Devolve o status e o corpo; quem monta a resposta é o index. */
export async function captar(db: SupabaseClient, req: Request, token: string): Promise<{ status: number; corpo: unknown }> {
  const ip = ipDoPedido(req);

  if (req.method === "GET") {
    if (!leiturasPorIp(ip || "sem-ip")) throw new ErroDaApi(429, "muitas_chamadas", "Muitas chamadas em pouco tempo. Espere um minuto.");
    return { status: 200, corpo: await lerFormulario(db, token) };
  }
  if (req.method !== "POST") throw new ErroDaApi(405, "metodo", "Use GET para abrir o formulário e POST para enviar.");

  const corpo = await corpoDoEnvio(req);
  // Robô: resposta igual à de um envio bom, e nada é gravado nem contado.
  if (ehRobo(corpo)) return { status: 200, corpo: { ok: true, repetido: false, evento_id: null } };
  if (!TOKEN.test(token)) throw new ErroDaApi(404, "formulario_inexistente", "Este formulário não existe.");
  if (!enviosPorIp(ip || "sem-ip") || !enviosPorFormulario(token)) {
    throw new ErroDaApi(429, "muitos_envios", "Muitos envios em pouco tempo. Espere alguns minutos e tente de novo.");
  }

  const formulario = await lerFormulario(db, token);
  const envio = validarEnvio(formulario, corpo);
  if (!envio.ok) return { status: 400, corpo: { error: "campo_invalido", campo: envio.campo, mensagem: envio.mensagem } };

  const { data, error } = await db.rpc("crm_captar", {
    _token: token,
    _dados: envio.dados,
    _tecnico: { ip: ip || null, navegador: (req.headers.get("user-agent") || "").slice(0, 300) || null },
  });
  if (error) {
    console.error("[produto-api] captar: gravacao", String(error.message || "").slice(0, 160));
    throw new ErroDaApi(503, "indisponivel", "Não foi possível enviar agora. Tente de novo.");
  }
  const r = (data || {}) as { ok?: boolean; motivo?: string; campo?: string; repetido?: boolean; evento_id?: string | null };
  if (!r.ok) {
    if (r.motivo === "invalido") return { status: 400, corpo: { error: "campo_invalido", campo: r.campo || "", mensagem: "Confira os campos e envie de novo." } };
    if (r.motivo === "desligado") throw new ErroDaApi(410, "formulario_desligado", "Este formulário não está recebendo respostas.");
    throw new ErroDaApi(404, "formulario_inexistente", "Este formulário não existe.");
  }
  // O id do negócio não sai para o visitante. O id do evento serve para o Pixel da página não contar em dobro.
  return { status: 201, corpo: { ok: true, repetido: !!r.repetido, evento_id: r.evento_id || null } };
}

export { CAMPO_ISCA };
