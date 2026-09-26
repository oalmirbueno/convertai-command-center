import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { AlertTriangle, CalendarDays, Loader2, Save } from "lucide-react";
import {
  ALIQUOTA_MAXIMA, ALIQUOTA_MINIMA, aliquotaDaCompetencia, competenciaDe,
  limitarAliquota, reservaTributaria, type AliquotaDoMes,
} from "@/lib/tributos";
import {
  Carregando, CampoDeFormulario, EstadoDeErro, EstadoVazio, Painel, RegiaoRolavel, Secao, SeletorCompacto,
  botao, campo, juntar, superficie, texto, useEstadoDaTela,
} from "@/components/sistema";
import { Etiqueta } from "@/components/finance/pecasDoFinanceiro";

/**
 * A área tributária: a alíquota do mês, na barra.
 *
 * O painel tratava 6% como se fosse lei. No Simples a alíquota efetiva
 * sobe com o faturamento acumulado, e quem paga a guia sabe o número do
 * mês antes do painel saber. A barra existe para esse número entrar sem
 * depender de mim, e cada mês guarda o SEU, para que fechar setembro a
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
  const competencias = useMemo(() => ultimasCompetencias(12), []);
  // O mês escolhido fica lembrado (sair e voltar mantém), desde que ainda
  // esteja na janela dos doze meses.
  const [competencia, setCompetencia] = useEstadoDaTela<string>("financeiro:tributaria:competencia", competenciaAtual, {
    validar: (v) => typeof v === "string" && competencias.indexOf(v) >= 0,
  });
  const [rascunho, setRascunho] = useState<number | null>(null);
  // A nota é rascunho de texto: guardada por mês, some ao gravar.
  const [nota, setNota] = useEstadoDaTela<string>(`financeiro:tributaria:nota:${competencia}`, "");

  const { data: registros = [], error, isLoading, refetch } = useQuery({
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
      <EstadoDeErro
        titulo="Não consegui ler as alíquotas."
        descricao={<>{error instanceof Error ? error.message : String(error)}. Os valores NÃO estão zerados: estão ilegíveis.</>}
        acao={<button type="button" onClick={() => refetch()} className={botao.secundario}>Tentar de novo</button>}
      />
    );
  }

  const opcoesDeMes = competencias.map((c) => ({ valor: c, rotulo: nomeDoMes(c) }));

  return (
    <div className="min-w-0 space-y-6">
      <Secao
        titulo="Alíquota do mês"
        ajuda={
          <>
            Cada mês guarda a sua alíquota, de propósito: no Simples ela sobe com o RBT12, e gravar setembro a 8% não pode
            reescrever o que já foi reservado em janeiro. Mês sem registro aparece como presumido no piso de 6%: estimativa,
            não confirmação. O número oficial vem da contabilidade (CNAE, RBT12, Fator R). Só o administrador altera a
            alíquota, porque ela decide quanto do caixa fica reservado para o governo.
          </>
        }
        acao={
          <SeletorCompacto
            opcoes={opcoesDeMes}
            valor={competencia}
            onEscolher={(c) => { setCompetencia(c); setRascunho(null); }}
            rotulo="Competência"
            icone={<CalendarDays className="h-3.5 w-3.5" />}
            modo="lista"
            className="capitalize"
          />
        }
      >
        <Painel>
          <div className="-mb-1 flex min-w-0 flex-wrap items-center [&>*]:mb-1">
            <span className="mr-3 text-[28px] font-semibold leading-9 tabular-nums text-foreground">{pct(valorNaBarra)}</span>
            {resolvida.presumida && !mudou && (
              /* A diferença que importa: presumido não é confirmado. Sem este
                 aviso o piso pareceria um número que alguém conferiu. */
              <Etiqueta tom="aviso" className="min-w-0 shrink">
                <AlertTriangle className="mr-1 h-3 w-3 shrink-0" aria-hidden="true" />
                <span className="min-w-0">presumido no piso · ainda não confirmado para este mês</span>
              </Etiqueta>
            )}
            {!resolvida.presumida && !mudou && (
              <Etiqueta tom="sucesso">confirmado para {nomeDoMes(competencia)}</Etiqueta>
            )}
            {mudou && (
              <Etiqueta tom="info">alterado de {pct(resolvida.rate)} · ainda não gravado</Etiqueta>
            )}
          </div>

          {/* A barra: 6 a 9, meio ponto por passo. */}
          <div className="mt-4">
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
            <div className={juntar(texto.auxiliar, "mt-1 flex justify-between tabular-nums")}>
              <span>6,0%</span><span>7,0%</span><span>8,0%</span><span>9,0%</span>
            </div>
          </div>

          <div className={juntar(superficie.poco, "mt-4 px-3 py-2.5")}>
            <p className="text-[13px] leading-5 text-muted-foreground">
              Sobre <span className="tabular-nums">{fmt(brutoRecebidoNoMes)}</span> recebidos no mês, separa{" "}
              <strong className="font-semibold tabular-nums text-foreground">{fmt(reservaTributaria(brutoRecebidoNoMes, valorNaBarra))}</strong>.
              {" "}Incide sobre o bruto, não sobre o operacional.
            </p>
          </div>

          {ehAdmin ? (
            <div className="mt-4 grid min-w-0 grid-cols-1 items-end gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
              <CampoDeFormulario rotulo="Nota (opcional)">
                <input
                  value={nota}
                  onChange={(e) => setNota(e.target.value)}
                  placeholder="Ex.: RBT12 de agosto, confirmado pela contabilidade"
                  className={campo}
                />
              </CampoDeFormulario>
              <button
                type="button"
                disabled={salvar.isPending || (!mudou && !resolvida.presumida)}
                onClick={() => salvar.mutate()}
                className={juntar(botao.primario, "min-w-0")}
              >
                {salvar.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden="true" /> : <Save className="mr-1.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
                <span className="truncate">Gravar {pct(limitarAliquota(valorNaBarra))} em {nomeDoMes(competencia)}</span>
              </button>
            </div>
          ) : (
            <p className={juntar(texto.auxiliar, "mt-4")}>Só o administrador altera a alíquota.</p>
          )}
        </Painel>
      </Secao>

      {/* Histórico com rolagem própria no computador: doze meses numa lista
          solta empurram o resto da página para fora da tela. */}
      <Secao
        divisoria
        titulo="Alíquotas gravadas"
        descricao={registros.length > 0 ? `${registros.length} ${registros.length === 1 ? "mês" : "meses"}` : undefined}
      >
        {isLoading && registros.length === 0 ? (
          <Carregando linhas={3} rotulo="Carregando alíquotas" />
        ) : registros.length === 0 ? (
          <EstadoVazio compacto titulo="Nenhum mês gravado." descricao="Mês sem registro conta como presumido." />
        ) : (
          <RegiaoRolavel memoria="financeiro:tributaria:historico" rotulo="Alíquotas gravadas" className="lg:max-h-[320px]">
            <ul className="divide-y divide-border">
              {registros.map((r) => (
                <li key={r.competencia} className="flex min-w-0 items-center py-2">
                  <span className="mr-3 shrink-0 text-[13px] capitalize text-foreground">{nomeDoMes(r.competencia)}</span>
                  <span className={juntar(texto.auxiliar, "mr-3 min-w-0 flex-1 truncate")} title={r.note || undefined}>{r.note || ""}</span>
                  <span className="shrink-0 text-[13px] font-semibold tabular-nums text-foreground">{pct(r.rate)}</span>
                </li>
              ))}
            </ul>
          </RegiaoRolavel>
        )}
      </Secao>
    </div>
  );
}
