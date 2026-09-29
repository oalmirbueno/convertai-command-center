import { supabase } from "@/integrations/supabase/client";
import type { ResultadoDoEnvio, TrechoParaEnvio } from "@/lib/cronometro/motor";

/**
 * Envio dos trechos do cronômetro ao banco (tempo_de_trabalho_registrar).
 *
 * - Normal: supabase.rpc (no máximo um por minuto por trecho aberto; o motor controla).
 * - Com pressa (aba escondendo ou fechando): fetch com keepalive, que o navegador
 *   termina mesmo depois da página sair. O keepalive precisa do token, que fica
 *   guardado do último envio normal. Navegador sem keepalive (Safari antigo) ou
 *   sem token: vai pelo caminho normal; se a página morrer antes, o motor já
 *   deixou o trecho na fila do navegador e ele sobe na próxima abertura.
 *
 * Nunca repete sozinho: quem decide quando tentar de novo é o motor.
 */

export const RPC_DO_CRONOMETRO = "tempo_de_trabalho_registrar";

let tokenGuardado: string | null = null;

/** Recusa que não adianta repetir (sem permissão, dado inválido, função inexistente). */
export function recusaDefinitiva(erro: unknown): boolean {
  const e = (erro || {}) as { code?: string; status?: number };
  const codigo = String(e.code || "");
  return codigo === "42501" || codigo === "22023" || codigo === "PGRST202" || codigo === "42883" || codigo === "PGRST301" || e.status === 401 || e.status === 403 || e.status === 404;
}

export function argumentosDoTrecho(t: TrechoParaEnvio) {
  return {
    _id: t.id,
    _client_id: t.client_id,
    _rota: t.rota,
    _inicio: t.inicio,
    _fim: t.fim,
    _segundos: t.segundos,
    _versao: t.versao,
  };
}

function temKeepalive(): boolean {
  try {
    return typeof fetch === "function" && typeof Request !== "undefined" && "keepalive" in Request.prototype;
  } catch {
    return false;
  }
}

async function guardarToken() {
  try {
    const auth = (supabase as any).auth;
    if (!auth || typeof auth.getSession !== "function") return;
    const { data } = await auth.getSession();
    tokenGuardado = (data && data.session && data.session.access_token) || null;
  } catch {
    /* sem sessão legível: o envio com pressa usa o caminho normal */
  }
}

function enviarComKeepalive(t: TrechoParaEnvio): Promise<ResultadoDoEnvio> | null {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const chave = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
  if (!url || !chave || !tokenGuardado || !temKeepalive()) return null;
  try {
    return fetch(`${url}/rest/v1/rpc/${RPC_DO_CRONOMETRO}`, {
      method: "POST",
      keepalive: true,
      headers: {
        apikey: chave,
        Authorization: `Bearer ${tokenGuardado}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(argumentosDoTrecho(t)),
    }).then(
      (r) => (r.ok ? "ok" : r.status === 401 || r.status === 403 || r.status === 404 ? "recusado" : "falhou"),
      () => "falhou" as ResultadoDoEnvio,
    );
  } catch {
    return null;
  }
}

export async function enviarTrecho(t: TrechoParaEnvio, urgente: boolean): Promise<ResultadoDoEnvio> {
  if (urgente) {
    const rapido = enviarComKeepalive(t);
    if (rapido) return rapido;
  }
  try {
    const { data, error } = await (supabase as any).rpc(RPC_DO_CRONOMETRO, argumentosDoTrecho(t));
    void guardarToken();
    if (error) return recusaDefinitiva(error) ? "recusado" : "falhou";
    if (data && typeof data === "object" && (data as { ok?: boolean }).ok === false) return "recusado";
    return "ok";
  } catch {
    return "falhou";
  }
}

/** Total do mês do cliente, da própria pessoa, sem o trecho aberto (tempo_de_trabalho_total). */
export async function lerTotalDoMes(cliente: string, desde: number, excluir: string | null): Promise<number | null> {
  try {
    const { data, error } = await (supabase as any).rpc("tempo_de_trabalho_total", {
      _client_id: cliente,
      _desde: new Date(desde).toISOString(),
      _excluir: excluir,
    });
    if (error) return null;
    const n = typeof data === "number" ? data : Number(data);
    return isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

/** Chamado uma vez ao montar: o envio com pressa já nasce com o token. */
export function prepararEnvio() {
  void guardarToken();
}
