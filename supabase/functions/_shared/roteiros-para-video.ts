/**
 * Como a Mesa Vídeos lê os roteiros aprovados da Mesa Roteiros (frente R2)
 * sem depender do código dela (Frente V2, 25/09/2026).
 *
 * Contrato só de dados: a Mesa Roteiros publica a view
 * `roteiros_aprovados_para_video` (security_invoker, RLS da tabela dela) com
 *   id uuid, client_id uuid, titulo text, aprovado_em timestamptz,
 *   cenas jsonb = [{ ref, ordem, titulo, fala, visual }]
 * e a Mesa Vídeos guarda só `roteiro_id` (e `cena_ref`) nos takes e nos
 * vínculos. Enquanto a view não existir, a mesa segue sem roteiro (o
 * organizador agrupa pelos nomes e grupos) e mostra que a ligação está
 * pendente. Nenhum campo além destes é lido.
 *
 * Puro: sem Deno, sem banco.
 */

export const VIEW_DOS_ROTEIROS = "roteiros_aprovados_para_video";
export const MAX_CENAS_DO_ROTEIRO = 80;

export interface CenaDoRoteiroAprovado {
  ref: string;
  ordem: number;
  titulo: string;
  fala: string | null;
  visual: string | null;
}

export interface RoteiroAprovado {
  id: string;
  client_id: string;
  titulo: string;
  aprovado_em: string | null;
  cenas: CenaDoRoteiroAprovado[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const texto = (v: unknown, max: number) =>
  String(v ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);

export function normalizarRoteiroAprovado(v: unknown): RoteiroAprovado | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const id = String(o.id || "");
  if (!UUID.test(id)) return null;
  const vistos: Record<string, true> = {};
  const cenas: CenaDoRoteiroAprovado[] = [];
  (Array.isArray(o.cenas) ? o.cenas : []).slice(0, MAX_CENAS_DO_ROTEIRO).forEach((c, i) => {
    if (!c || typeof c !== "object") return;
    const x = c as Record<string, unknown>;
    const ref = texto(x.ref || x.id || `cena-${i + 1}`, 40);
    if (!ref || vistos[ref]) return;
    vistos[ref] = true;
    const ordem = Number(x.ordem);
    cenas.push({
      ref,
      ordem: isFinite(ordem) && ordem > 0 ? Math.floor(ordem) : i + 1,
      titulo: texto(x.titulo, 140),
      fala: texto(x.fala, 1200) || null,
      visual: texto(x.visual, 600) || null,
    });
  });
  cenas.sort((a, b) => a.ordem - b.ordem);
  return {
    id,
    client_id: String(o.client_id || ""),
    titulo: texto(o.titulo, 140) || "Roteiro sem título",
    aprovado_em: o.aprovado_em ? String(o.aprovado_em) : null,
    cenas,
  };
}

export const normalizarRoteirosAprovados = (lista: unknown): RoteiroAprovado[] =>
  (Array.isArray(lista) ? lista : []).map(normalizarRoteiroAprovado).filter((r): r is RoteiroAprovado => !!r);

/** Erro de leitura que só quer dizer "a view ainda não existe". */
export const viewAindaNaoExiste = (mensagem: string) => /does not exist|schema cache|not find|42P01|PGRST205/i.test(String(mensagem || ""));
