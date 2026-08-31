import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { AlertTriangle, Landmark, Loader2, Save } from "lucide-react";
import {
  ALIQUOTA_MAXIMA, ALIQUOTA_MINIMA, aliquotaDaCompetencia, competenciaDe,
  limitarAliquota, reservaTributaria, type AliquotaDoMes,
} from "@/lib/tributos";

/**
 * A área tributária: a alíquota do mês, na barra.
 *
 * O painel tratava 6% como se fosse lei. No Simples a alíquota efetiva
 * sobe com o faturamento acumulado, e quem paga a guia sabe o número do
 * mês antes do painel saber. A barra existe para esse número entrar sem
 * depender de mim — e cada mês guarda o SEU, para que fechar setembro a
 * 8% não reescreva o que já foi reservado em janeiro.
 */

const fmt = (v: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);
const pct = (v: number) => `${(v * 100).toFixed(1).replace(".", ",")}%`;

const nomeDoMes = (competencia: string) =>
  new Date(`${competencia}T12:00:00`).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });

/** Os doze meses até o atual, do mais novo para o mais velho. */
function ultimasCompetencias(quantas = 12): string[] {
  const hoje = new Date();
  return Array.from({ length: quantas }, (_, i) => {
    const d = new Date(hoje.getFullYear(), hoje.getMonth() - i, 1);
    return competenciaDe(d);
  });
}

interface Props {
  /** Bruto recebido no mês corrente, para mostrar quanto a alíquota reserva. */
  brutoRecebidoNoMes: number;
}

export default function AreaTributaria({ brutoRecebidoNoMes }: Props) {
  const qc = useQueryClient();
  const { profile } = useAuth();
  const ehAdmin = profile?.role === "admin";

  const competenciaAtual = competenciaDe(new Date());
  const [competencia, setCompetencia] = useState(competenciaAtual);
  const [rascunho, setRascunho] = useState<number | null>(null);
  const [nota, setNota] = useState("");

  const { data: registros = [], error } = useQuery({
    queryKey: ["aliquotas-tributarias"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("financial_tax_rates")
        .select("competence, rate, note, updated_at")
        .order("competence", { ascending: false })
        .limit(36);
      if (error) throw new Error(error.message);
      return (data || []).map((r: any) => ({
        competencia: String(r.competence).slice(0, 10),
        rate: Number(r.rate),
        note: r.note,
      })) as AliquotaDoMes[];
    },
  });

  const resolvida = useMemo(
    () => aliquotaDaCompetencia(competencia, registros),
    [competencia, registros],
  );

  // O rascunho só existe enquanto a barra está sendo mexida; fora disso a
  // tela mostra o que está gravado, não o que eu supus.
  const valorNaBarra = rascunho ?? resolvida.rate;
  const mudou = rascunho !== null && limitarAliquota(rascunho) !== resolvida.rate;

  const salvar = useMutation({
    mutationFn: async () => {
      const rate = limitarAliquota(valorNaBarra);
      const { error } = await (supabase as any).from("financial_tax_rates").upsert({
        competence: competencia,
        rate,
        note: nota.trim() || null,
        updated_by: profile?.id ?? null,
        updated_at: new Date().toISOString(),
      }, { onConflict: "competence" });
      if (error) throw new Error(error.message);
      return rate;
    },
    onSuccess: (rate) => {
      qc.invalidateQueries({ queryKey: ["aliquotas-tributarias"] });
      setRascunho(null); setNota("");
      toast.success(`${nomeDoMes(competencia)} gravado com ${pct(rate)}.`);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });

  if (error) {
    return (
      <div className="rounded-xl border border-destructive/30 bg-secondary p-4 text-[12px] text-destructive">
        Não consegui ler as alíquotas: {error instanceof Error ? error.message : String(error)}.
        Os valores abaixo NÃO estão zerados — estão ilegíveis.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-card p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            <Landmark className="h-3.5 w-3.5 text-info" /> Alíquota efetiva por competência
          </p>
          <select
            value={competencia}
            onChange={(e) => { setCompetencia(e.target.value); setRascunho(null); setNota(""); }}
            className="h-8 rounded-lg border border-border bg-secondary px-2 text-[12px] text-foreground"
          >
            {ultimasCompetencias(12).map((c) => (
              <option key={c} value={c}>{nomeDoMes(c)}</option>
            ))}
          </select>
        </div>

        <div className="flex flex-wrap items-baseline gap-3">
          <span className="font-mono text-3xl font-semibold text-foreground">{pct(valorNaBarra)}</span>
          {resolvida.presumida && !mudou && (
            /* A diferença que importa: presumido não é confirmado. Sem este
               aviso o piso pareceria um número que alguém conferiu. */
            <span className="inline-flex items-center gap-1 rounded-full bg-warning/15 px-2.5 py-1 text-[11px] font-medium text-warning">
              <AlertTriangle className="h-3 w-3" /> presumido no piso · ainda não confirmado para este mês
            </span>
          )}
          {!resolvida.presumida && !mudou && (
            <span className="rounded-full bg-success/15 px-2.5 py-1 text-[11px] font-medium text-success">
              confirmado para {nomeDoMes(competencia)}
            </span>
          )}
          {mudou && (
            <span className="rounded-full bg-info/15 px-2.5 py-1 text-[11px] font-medium text-info">
              alterado de {pct(resolvida.rate)} · ainda não gravado
            </span>
          )}
        </div>

        {/* A barra: 6 a 9, meio ponto por passo. */}
        <div>
          <input
            type="range"
            min={ALIQUOTA_MINIMA * 1000}
            max={ALIQUOTA_MAXIMA * 1000}
            step={5}
            value={Math.round(valorNaBarra * 1000)}
            disabled={!ehAdmin}
            onChange={(e) => setRascunho(Number(e.target.value) / 1000)}
            className="w-full accent-primary disabled:opacity-50"
            aria-label="Alíquota do mês"
          />
          <div className="mt-1 flex justify-between text-[10px] font-mono text-muted-foreground">
            <span>6,0%</span><span>7,0%</span><span>8,0%</span><span>9,0%</span>
          </div>
        </div>

        <div className="rounded-lg bg-secondary/60 p-3">
          <p className="text-[11px] text-muted-foreground">
            Sobre {fmt(brutoRecebidoNoMes)} recebidos no mês, esta alíquota separa{" "}
            <strong className="font-mono text-foreground">{fmt(reservaTributaria(brutoRecebidoNoMes, valorNaBarra))}</strong>.
            {" "}A reserva incide sobre o bruto que entrou na conta, não sobre o operacional.
          </p>
        </div>

        {ehAdmin ? (
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={nota}
              onChange={(e) => setNota(e.target.value)}
              placeholder="Nota (ex: RBT12 de agosto, confirmado pela contabilidade)"
              className="h-8 min-w-[16rem] flex-1 rounded-lg border border-border bg-background px-2.5 text-[11.5px] text-foreground placeholder:text-muted-foreground/60"
            />
            <button
              type="button"
              disabled={salvar.isPending || (!mudou && !resolvida.presumida)}
              onClick={() => salvar.mutate()}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-[11.5px] font-semibold text-primary-foreground disabled:opacity-50"
            >
              {salvar.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              Gravar {pct(limitarAliquota(valorNaBarra))} em {nomeDoMes(competencia)}
            </button>
          </div>
        ) : (
          <p className="text-[11px] text-muted-foreground">
            Só o administrador altera a alíquota — ela decide quanto do caixa fica reservado para o governo.
          </p>
        )}

        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Cada mês guarda a sua alíquota, de propósito: no Simples ela sobe com o RBT12, e gravar
          setembro a 8% não pode reescrever o que já foi reservado em janeiro. Mês sem registro
          aparece como <strong>presumido</strong> no piso de 6% — estimativa, não confirmação.
          O número oficial vem da contabilidade (CNAE, RBT12, Fator R).
        </p>
      </div>

      {/* Histórico com rolagem própria: doze meses numa lista solta empurram
          o resto da página para fora da tela. */}
      {registros.length > 0 && (
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Alíquotas gravadas ({registros.length})
          </p>
          <div className="max-h-56 space-y-1 overflow-y-auto pr-1">
            {registros.map((r) => (
              <div
                key={r.competencia}
                className="flex items-center gap-2 rounded-lg border border-border bg-secondary/40 px-3 py-1.5"
              >
                <span className="text-[12px] capitalize text-foreground">{nomeDoMes(r.competencia)}</span>
                <span className="ml-auto font-mono text-[12px] font-semibold text-foreground">{pct(r.rate)}</span>
                {r.note && <span className="max-w-[45%] truncate text-[10.5px] text-muted-foreground">{r.note}</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
