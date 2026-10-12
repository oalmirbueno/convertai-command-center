import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, CircleDashed, CircleSlash, Loader2, ShieldCheck, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useAvisarErro } from "@/components/mesa/Custo";
import { useMesa } from "@/components/mesa/MesaContexto";
import { dataEHora } from "@/lib/mesa/api";
import AjudaRecolhida from "@/components/sistema/AjudaRecolhida";
import { Carregando, EstadoDeErro, EstadoVazio } from "@/components/sistema/Estados";
import { foco, juntar } from "@/components/sistema/estilos";
import { chavesAuditoria, lerAuditorias, rodarAuditoria, type AuditoriaNaTela, type ControleNaTela } from "./auditoriaApi";
import { chavesMemoria } from "./memoriaApi";

/**
 * Auditoria da conta (12/10/2026), a partir do checklist do claude-ads 2.0 adaptado à Meta.
 *
 * Cada controle sai como passou, falhou, sem dado ou não se aplica, com a evidência em número e o
 * que fazer. Nota com os pesos do claude-ads (crítico 5, alto 3, médio 1) e só aparece com
 * cobertura de 60% ou mais: abaixo disso é "dado insuficiente", não nota baixa. Grátis (código, sem IA).
 * Google entra quando a conexão existir.
 */

const ICONE: Record<ControleNaTela["resultado"], JSX.Element> = {
  passou: <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />,
  falhou: <XCircle className="h-4 w-4 shrink-0 text-destructive" />,
  sem_dado: <CircleDashed className="h-4 w-4 shrink-0 text-muted-foreground" />,
  nao_se_aplica: <CircleSlash className="h-4 w-4 shrink-0 text-muted-foreground/60" />,
};
const SEVERIDADE: Record<ControleNaTela["severidade"], string> = { critico: "crítico", alto: "alto", medio: "médio", informativo: "informativo" };
const FAIXA: Record<AuditoriaNaTela["faixa"], string> = { valendo: "nota valendo", provisoria: "nota provisória (cobertura entre 60% e 80%)", dado_insuficiente: "dado insuficiente para dar nota" };

function Controle({ c }: { c: ControleNaTela }) {
  return (
    <li className="flex min-w-0 items-start gap-2.5 py-2 text-[12.5px] leading-5">
      {ICONE[c.resultado]}
      <div className="min-w-0 flex-1">
        <p className="min-w-0 break-words">
          <span className="font-mono text-[11px] text-muted-foreground">{c.id}</span> <span className="font-medium">{c.nome}</span>
          <span className="text-[11px] text-muted-foreground"> · {SEVERIDADE[c.severidade]}</span>
        </p>
        <p className="min-w-0 break-words text-muted-foreground">{c.evidencia}</p>
        {c.acao && (c.resultado === "falhou" || c.resultado === "sem_dado") && <p className="min-w-0 break-words text-foreground/80">O que fazer: {c.acao}</p>}
      </div>
    </li>
  );
}

export default function AbaAuditoria() {
  const { clientId } = useMesa();
  const queryClient = useQueryClient();
  const avisarErro = useAvisarErro();
  const [rodando, setRodando] = useState(false);
  const q = useQuery({ queryKey: chavesAuditoria.auditorias(clientId), queryFn: () => lerAuditorias(clientId), enabled: !!clientId, staleTime: 60_000 });

  async function rodar() {
    setRodando(true);
    try {
      await rodarAuditoria(clientId);
      await queryClient.invalidateQueries({ queryKey: chavesAuditoria.auditorias(clientId) });
      void queryClient.invalidateQueries({ queryKey: chavesMemoria.conta(clientId) });
      toast.success("Auditoria feita", { description: "Calculada com os números da Meta e a memória da conta." });
    } catch (e) {
      avisarErro(e, "Não deu para rodar a auditoria");
    } finally {
      setRodando(false);
    }
  }

  const ultimas = q.data ?? [];
  const atual = ultimas[0] ?? null;
  const anterior = ultimas[1] ?? null;
  const categorias = atual ? [...new Set(atual.controles.map((c) => c.categoria))] : [];

  return (
    <div className="min-w-0 space-y-5">
      <div className="flex min-w-0 flex-wrap items-center gap-3">
        <h2 className="text-[15px] font-semibold">Auditoria da conta</h2>
        <AjudaRecolhida titulo="Como funciona">
          O checklist do claude-ads adaptado à Meta: medição, criativo, estrutura e verba, públicos, entrega e política. Cada item diz se passou, falhou ou se falta dado, com o número que levou à conclusão. A régua (custo-alvo, frequência, CTR mínimo) vem da memória da conta, nunca de um número genérico. Nota só com cobertura de 60% ou mais.
        </AjudaRecolhida>
        <Button type="button" size="sm" className="ml-auto h-8" onClick={() => void rodar()} disabled={rodando || !clientId}>
          {rodando ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="mr-1 h-3.5 w-3.5" />} {atual ? "Auditar de novo" : "Auditar a conta"}
        </Button>
      </div>

      {q.isLoading && <Carregando forma="aba" rotulo="Lendo as auditorias" />}
      {q.isError && <EstadoDeErro titulo="Não deu para ler as auditorias" descricao={q.error instanceof Error ? q.error.message : ""} />}
      {!q.isLoading && !q.isError && !atual && (
        <EstadoVazio icone={<ShieldCheck className="h-5 w-5" />} titulo="Nenhuma auditoria ainda" descricao="Rode a primeira: leva alguns segundos e não custa nada (é cálculo do painel, sem IA)." />
      )}

      {atual && (
        <>
          <div className="flex min-w-0 flex-wrap items-end gap-x-8 gap-y-3">
            <div>
              <p className="text-[12px] text-muted-foreground">Nota</p>
              <p className="text-[32px] font-semibold leading-none tabular-nums">{atual.nota !== null ? atual.nota : "sem nota"}</p>
            </div>
            <div>
              <p className="text-[12px] text-muted-foreground">Cobertura</p>
              <p className="text-[20px] font-semibold tabular-nums">{atual.cobertura}%</p>
            </div>
            <div className="min-w-0 text-[12.5px] text-muted-foreground">
              <p>{FAIXA[atual.faixa]}</p>
              <p>{atual.criado_em ? dataEHora(atual.criado_em) : ""}{anterior && anterior.nota !== null && atual.nota !== null ? ` · antes: ${anterior.nota} (${atual.nota - anterior.nota >= 0 ? "+" : ""}${atual.nota - anterior.nota})` : ""}</p>
            </div>
          </div>

          <div className="grid min-w-0 gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
            {atual.categorias.map((c) => (
              <div key={c.categoria} className="min-w-0">
                <div className="flex justify-between text-[12.5px]">
                  <span>{c.rotulo}</span>
                  <span className="tabular-nums text-muted-foreground">{c.saude !== null ? `${c.saude}` : "sem dado"} · cobre {c.cobertura}%</span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                  <div className={juntar("h-full rounded-full", c.saude === null ? "bg-muted" : c.saude >= 80 ? "bg-success" : c.saude >= 50 ? "bg-warning" : "bg-destructive")} style={{ width: `${c.saude ?? 0}%` }} />
                </div>
              </div>
            ))}
          </div>

          {atual.prioridades.length > 0 && (
            <section className="min-w-0">
              <h3 className="mb-1 text-[13px] font-semibold">O que resolver primeiro</h3>
              <ul className="min-w-0 divide-y divide-border border-y border-border">
                {atual.prioridades.slice(0, 6).map((c) => <Controle key={c.id} c={c} />)}
              </ul>
            </section>
          )}

          <div className="min-w-0 space-y-1">
            {categorias.map((cat) => {
              const doCat = atual.controles.filter((c) => c.categoria === cat);
              const rotulo = atual.categorias.find((c) => c.categoria === cat)?.rotulo ?? cat;
              return (
                <details key={cat} className="min-w-0 border-b border-border py-1.5">
                  <summary className={juntar("cursor-pointer rounded text-[13px]", foco)}>
                    {rotulo} <span className="text-[12px] text-muted-foreground">({doCat.filter((c) => c.resultado === "passou").length} de {doCat.filter((c) => c.resultado === "passou" || c.resultado === "falhou").length} passaram)</span>
                  </summary>
                  <ul className="min-w-0 divide-y divide-border/60">{doCat.map((c) => <Controle key={c.id} c={c} />)}</ul>
                </details>
              );
            })}
          </div>

          {ultimas.length > 1 && (
            <p className="text-[12px] text-muted-foreground">
              Histórico: {ultimas.map((a) => `${a.criado_em ? dataEHora(a.criado_em) : ""} ${a.nota !== null ? a.nota : "sem nota"}`).join(" · ")}
            </p>
          )}
        </>
      )}
    </div>
  );
}
