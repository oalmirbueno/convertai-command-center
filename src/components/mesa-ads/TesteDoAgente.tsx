import { AlertTriangle, Briefcase } from "lucide-react";
import { brl, type PlanoAds } from "./adsApi";
import { testeDoPlano } from "./acoesDoAgenteApi";

/**
 * O teste que o agente sênior montou (pedido do dono em 25/09: "quando eu
 * clicar, ele já tem que mandar preenchendo, já fazendo, para não precisar eu
 * ter retrabalho"): hipótese, variável, público, verba, duração, métrica de
 * decisão e critério de vitória, com o que ficou sem base marcado para a
 * equipe decidir. Só aparece no plano criado pelo agente.
 */
export default function TesteDoAgente({ plano }: { plano: PlanoAds }) {
  const t = testeDoPlano(plano.estrutura);
  if (!t) return null;
  const linhas: [string, string][] = ([
    ["Hipótese", t.hipotese],
    ["Variável testada", t.variavel],
    ["Criativos", plano.angulos.map((a) => a.nome).join("; ")],
    ["Público", t.publico],
    ["Verba diária", t.orcamento_diario_brl !== null ? brl(t.orcamento_diario_brl) : ""],
    ["Duração", t.duracao_dias ? `${t.duracao_dias} dias` : ""],
    ["Métrica de decisão", t.metrica_decisao],
    ["Critério de vitória", t.criterio_vitoria],
  ] as [string, string][]);
  return (
    <section className="min-w-0 rounded-xl border border-primary/30 bg-primary/5 p-4" aria-label="Teste montado pelo agente sênior">
      <h3 className="flex items-center text-[13.5px] font-semibold">
        <Briefcase className="mr-1.5 h-4 w-4 text-primary" />
        Teste montado pelo agente sênior
      </h3>
      <p className="text-[11.5px] text-muted-foreground">Preenchido com a análise da conta. Revise e produza os criativos.</p>
      <dl className="mt-2 min-w-0 space-y-1 text-[12.5px] leading-snug">
        {linhas.map(([r, v]) => (
          <div key={r} className="flex min-w-0 flex-col sm:flex-row">
            <dt className="shrink-0 text-muted-foreground sm:mr-2 sm:w-40">{r}</dt>
            <dd className={`min-w-0 [overflow-wrap:anywhere] ${v ? "" : "text-warning"}`}>{v || "A definir"}</dd>
          </div>
        ))}
      </dl>
      {t.lacunas.length > 0 && (
        <ul className="mt-2 space-y-0.5">
          {t.lacunas.map((l, k) => (
            <li key={k} className="flex min-w-0 items-start text-[12px] text-warning">
              <AlertTriangle className="mr-1 mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span className="min-w-0 [overflow-wrap:anywhere]">{l}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
