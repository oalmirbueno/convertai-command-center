import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { jevPerguntar, probabilidadeNoul, JevErro } from "../_shared/jev.ts";

/**
 * A peça que espera aprovação ainda vale ser cobrada do cliente?
 *
 * Regra do dono (13/11/2026): o lembrete no grupo não pode cobrar peça que já
 * passou do ponto (Dia das Crianças em novembro, convite para uma segunda-feira
 * que já foi). Aqui um Noul do Jev julga, uma vez por dia por peça, se o
 * conteúdo depende de data, evento ou promoção que já passou. O resultado vira
 * dado (app_private.aprovacao_validade); quem decide o que entra na mensagem é
 * o banco (aprovacao_novas_candidatos e lembrete_candidatos).
 *
 * Chamada: pelo cron (x-cron-secret) ou por equipe (JWT). Sem TYPESAFE_API_KEY
 * responde "sem chave" e não grava nada (a peça segue como antes).
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Max-Age": "7200",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const LOTE = 12;

type Peca = { file_id: string; titulo: string; legenda: string; entrou_em: string; hoje: string };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

// deno-lint-ignore no-explicit-any
async function autorizado(req: Request, admin: SupabaseClient<any, any, any>): Promise<boolean> {
  const cronSecret = Deno.env.get("CRON_SECRET")?.trim();
  if (cronSecret && req.headers.get("x-cron-secret")?.trim() === cronSecret) return true;
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return false;
  if (token === Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) return true;
  const { data: user } = await admin.auth.getUser(token);
  if (!user?.user?.id) return false;
  const { data: staff } = await admin.rpc("is_staff", { _user_id: user.user.id });
  return staff === true;
}

const DIAS = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];

export function perguntaVencida(i: number) {
  return {
    type: "noul" as const,
    instructions:
      `Hoje é \`hoje\`. A peça \`pecas[${i}]\` é um post de rede social que ainda espera a aprovação do cliente ` +
      `(entrou para aprovação em \`pecas[${i}].entrou_em\`). Publicar esta peça hoje ainda faz sentido, ou ela venceu?`,
    criteria: {
      true:
        "Venceu: o título ou a legenda dependem de uma data, feriado, data comemorativa, evento, promoção ou prazo que já passou " +
        "(por exemplo, Dia das Crianças de 12/10 quando hoje já é novembro, ou convite para ir à loja numa segunda-feira que já foi).",
      false:
        "Ainda vale: o conteúdo é atemporal (dica, serviço, institucional, produto) ou a data de que ele fala é hoje ou ainda vai chegar. " +
        "Peça antiga sem data marcada não venceu só por ser antiga. O dia planejado para publicar o post não conta: " +
        "um post atrasado ainda vale se o assunto dele não depende de uma data que passou.",
    },
  };
}

/**
 * Tira o rótulo de agenda do título ("Stop · 12/11 · Estático · Black Stop" vira "Black Stop"):
 * o 12/11 ali é o dia planejado para postar, não o assunto. Sem isso o Jev achava a peça vencida.
 */
export function tituloSemAgenda(titulo: string) {
  const partes = (titulo || "").split(" · ").map((s) => s.trim()).filter(Boolean);
  if (partes.length < 3 || !/^\d{1,2}\/\d{1,2}$/.test(partes[1])) return titulo;
  const resto = partes.slice(2).filter((s) => !/^(estático|estatico|carrossel|reels?|vídeo|video|story|stories)$/i.test(s));
  return resto.join(" · ") || titulo;
}

export function estadoDoLote(pecas: Peca[]) {
  const hoje = pecas[0]?.hoje ?? new Date().toISOString().slice(0, 10);
  const dia = DIAS[new Date(`${hoje}T12:00:00Z`).getUTCDay()];
  return {
    hoje: `${hoje} (${dia})`,
    pecas: pecas.map((p) => ({ titulo: tituloSemAgenda(p.titulo), legenda: (p.legenda || "").slice(0, 700), entrou_em: p.entrou_em })),
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  if (!(await autorizado(req, admin))) return json({ error: "nao_autorizado" }, 401);

  const { data: fila, error } = await admin.rpc("aprovacao_validade_fila", { _limite: LOTE * 3 });
  if (error) return json({ error: "fila_falhou" }, 500);
  const pecas = (fila ?? []) as Peca[];
  if (pecas.length === 0) return json({ ok: true, julgadas: 0 });

  const gravar: Array<{ file_id: string; vencida_prob: number; julgado_para: string }> = [];
  for (let ini = 0; ini < pecas.length; ini += LOTE) {
    const lote = pecas.slice(ini, ini + LOTE);
    const questions: Record<string, ReturnType<typeof perguntaVencida>> = {};
    lote.forEach((_, i) => { questions[`vencida_${i}`] = perguntaVencida(i); });
    try {
      const r = await jevPerguntar({ state: estadoDoLote(lote), questions });
      lote.forEach((p, i) => {
        const prob = probabilidadeNoul(r.answers[`vencida_${i}`]);
        if (prob !== null) gravar.push({ file_id: p.file_id, vencida_prob: prob, julgado_para: p.hoje });
      });
    } catch (err) {
      if (err instanceof JevErro && err.codigo === "jev_sem_chave") return json({ ok: false, motivo: "sem chave" });
      break; // Jev fora: grava o que deu e tenta de novo na próxima rodada.
    }
  }
  if (gravar.length) {
    const { error: e2 } = await admin.rpc("aprovacao_validade_gravar", { _itens: gravar });
    if (e2) return json({ error: "gravar_falhou" }, 500);
  }
  return json({ ok: true, julgadas: gravar.length, vencidas: gravar.filter((g) => g.vencida_prob >= 0.6).length });
});
