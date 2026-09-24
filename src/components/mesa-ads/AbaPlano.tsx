import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, FlaskConical, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { Textarea } from "@/components/ui/textarea";
import { AvisoDeErro, BotaoComCusto } from "@/components/mesa/Custo";
import { useMesa } from "@/components/mesa/MesaContexto";
import { Ditado } from "@/components/mesa/Ditado";
import { dataCurta, textoDoErro, usd } from "@/lib/mesa/api";
import {
  chamarAds,
  chavesAds,
  FORMATOS,
  lerBriefing,
  lerPlanos,
  lerReferencias,
  mudarPlano,
  notasDe10,
  partesDaProducao,
  partesDoPlano,
  STATUS_DO_PLANO,
  type Angulo,
  type FormatoAds,
  type PlanoAds,
  type StatusDoPlano,
} from "./adsApi";
import { Andamento, BarraDeNota, SeloDeEvidencia, useAndamento } from "./Comuns";
import ConversaDoPlano from "./ConversaDoPlano";

/**
 * Etapa 3, Plano de teste: ângulos realmente diferentes (situação × mecanismo
 * × prova) com hipótese no formato do dossiê, antes de variar execução. O
 * estrategista gera; o Jev dá as notas de clareza, relevância, prova e risco
 * de política. A equipe escolhe ângulos e formatos e manda produzir: cada
 * combinação vira um criativo com copy e um trabalho no Estúdio Ads.
 */

export const QUANTIDADES_DE_ANGULOS = [3, 4, 5, 6];

/** Corpo de criativos_produzir: ângulos na ordem do plano e formatos na ordem da lista. */
export function corpoDaProducao(plano: PlanoAds, angulos: string[], formatos: FormatoAds[]) {
  return {
    plano_id: plano.id,
    angulo_ids: plano.angulos.filter((a) => angulos.indexOf(a.id) >= 0).map((a) => a.id),
    formatos: FORMATOS.map((f) => f.valor).filter((f) => formatos.indexOf(f) >= 0),
  };
}

function Linha({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  if (!children) return null;
  return (
    <div className="min-w-0">
      <p className="text-[10.5px] font-medium uppercase tracking-wider text-muted-foreground">{rotulo}</p>
      <p className="mt-0.5 whitespace-pre-wrap text-[12.5px] leading-relaxed [overflow-wrap:anywhere]">{children}</p>
    </div>
  );
}

function CartaoDoAngulo({
  angulo,
  indice,
  marcado,
  onMarcar,
  referencias,
}: {
  angulo: Angulo;
  indice: number;
  marcado: boolean;
  onMarcar: () => void;
  referencias: { id: string; titulo: string; evidencia: any }[];
}) {
  const notas = notasDe10(angulo.jev);
  const refs = referencias.filter((r) => (angulo.referencia_ids || []).indexOf(r.id) >= 0);
  const formatos = (angulo.formatos || []).map((f) => FORMATOS.find((x) => x.valor === f)).filter(Boolean) as typeof FORMATOS;
  return (
    <article
      className={`min-w-0 rounded-xl border bg-card p-4 transition-colors ${marcado ? "border-primary ring-1 ring-primary/40" : "border-border"}`}
      aria-label={`Ângulo ${indice + 1}: ${angulo.nome}`}
    >
      <div className="flex min-w-0 items-start">
        <label className="mr-3 mt-0.5 flex shrink-0 cursor-pointer items-center">
          <input type="checkbox" checked={marcado} onChange={onMarcar} className="h-4 w-4 accent-primary" aria-label={`Produzir o ângulo ${angulo.nome}`} />
        </label>
        <div className="min-w-0 flex-1">
          <p className="text-[10.5px] font-medium uppercase tracking-wider text-muted-foreground">Ângulo {indice + 1}</p>
          <h3 className="text-[14.5px] font-semibold leading-snug [overflow-wrap:anywhere]">{angulo.nome}</h3>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Linha rotulo="Situação">{angulo.situacao}</Linha>
        <Linha rotulo="Mecanismo">{angulo.mecanismo}</Linha>
        <Linha rotulo="Gancho visual">{angulo.gancho_visual}</Linha>
        <Linha rotulo="Gancho verbal">{angulo.gancho_verbal ? `“${angulo.gancho_verbal}”` : ""}</Linha>
        <Linha rotulo="Prova">{angulo.prova}</Linha>
        <Linha rotulo="Métrica e janela">
          {[angulo.metrica, angulo.janela_dias ? `${angulo.janela_dias} dias` : ""].filter(Boolean).join(" · ")}
        </Linha>
      </div>

      {angulo.hipotese && (
        <blockquote className="mt-3 rounded-lg border-l-2 border-primary bg-primary/5 px-3 py-2 text-[12.5px] leading-relaxed [overflow-wrap:anywhere]">
          <span className="mb-0.5 block text-[10.5px] font-medium uppercase tracking-wider text-muted-foreground">Hipótese</span>
          {angulo.hipotese}
        </blockquote>
      )}

      <div className="mt-3 flex min-w-0 flex-wrap items-center">
        {formatos.map((f) => (
          <span key={f.valor} className="mb-1 mr-1.5 rounded-full bg-secondary px-2 py-0.5 text-[11px] text-muted-foreground">{f.rotulo}</span>
        ))}
        {angulo.variacoes ? <span className="mb-1 mr-1.5 text-[11px] text-muted-foreground">{angulo.variacoes} variação{angulo.variacoes === 1 ? "" : "ões"}</span> : null}
        {refs.map((r) => (
          <span key={r.id} className="mb-1 mr-1.5 inline-flex max-w-full items-center rounded-full border border-border px-1.5 py-0.5 text-[11px]">
            <SeloDeEvidencia valor={r.evidencia} className="mr-1 h-4 px-1.5" />
            <span className="truncate">{r.titulo}</span>
          </span>
        ))}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-border pt-3 sm:grid-cols-4" aria-label="Notas do Jev">
        <BarraDeNota rotulo="Clareza" nota={notas.clareza} />
        <BarraDeNota rotulo="Relevância" nota={notas.relevancia} />
        <BarraDeNota rotulo="Prova" nota={notas.prova} />
        <BarraDeNota rotulo="Risco de política" nota={notas.risco_politica} inverso />
      </div>
    </article>
  );
}

export default function AbaPlano({
  planoId,
  onPlano,
  onProduzido,
}: {
  planoId: string | null;
  onPlano: (id: string | null) => void;
  onProduzido: (planoId: string) => void;
}) {
  const { clientId, catalogo } = useMesa();
  const queryClient = useQueryClient();
  const planos = useQuery({ queryKey: chavesAds.planos(clientId), queryFn: () => lerPlanos(clientId) });
  const briefing = useQuery({ queryKey: chavesAds.briefing(clientId), queryFn: () => lerBriefing(clientId) });
  const referencias = useQuery({ queryKey: chavesAds.referencias(clientId), queryFn: () => lerReferencias(clientId) });
  const [pedido, setPedido] = useState("");
  const [quantidade, setQuantidade] = useState(4);
  const [marcados, setMarcados] = useState<string[]>([]);
  const [formatos, setFormatos] = useState<FormatoAds[]>(["feed_4x5", "stories_9x16"]);
  const [desdeGerar, rodarGerar] = useAndamento();
  const [desdeProduzir, rodarProduzir] = useAndamento();

  const lista = planos.data || [];
  const plano = lista.find((p) => p.id === planoId) || lista[0] || null;
  const destaques = (referencias.data || []).filter((r) => r.destaque).length;

  // Outro plano: todos os ângulos marcados e os formatos que o estrategista sugeriu.
  useEffect(() => {
    if (!plano) return;
    setMarcados(plano.angulos.map((a) => a.id));
    const sugeridos: FormatoAds[] = [];
    plano.angulos.forEach((a) => (a.formatos || []).forEach((f) => {
      if (sugeridos.indexOf(f) < 0 && FORMATOS.some((x) => x.valor === f)) sugeridos.push(f);
    }));
    if (sugeridos.length) setFormatos(sugeridos);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plano ? plano.id : null, plano ? plano.angulos.length : 0]);

  const pecas = useMemo(() => marcados.length * formatos.length, [marcados.length, formatos.length]);

  const gerar = () =>
    rodarGerar(() =>
      chamarAds<any>("plano_gerar", {
        client_id: clientId,
        briefing_id: briefing.data ? briefing.data.id : undefined,
        pedido: pedido.trim() || undefined,
        quantidade_angulos: quantidade,
      }),
    );

  const produzir = () => (plano ? rodarProduzir(() => chamarAds<any>("criativos_produzir", corpoDaProducao(plano, marcados, formatos))) : Promise.resolve(null));

  const mudarStatus = async (status: StatusDoPlano) => {
    if (!plano) return;
    try {
      await mudarPlano(plano.id, { status });
      await queryClient.invalidateQueries({ queryKey: chavesAds.planos(clientId) });
    } catch (e) {
      toast.error("Status não salvo", { description: textoDoErro(e) });
    }
  };

  const alternar = <T,>(lista: T[], v: T) => (lista.indexOf(v) >= 0 ? lista.filter((x) => x !== v) : lista.concat([v]));

  return (
    <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
      <div className="min-w-0 space-y-4">
        <section className="rounded-xl border border-border bg-card p-4" aria-label="Gerar plano">
          <div className="flex min-w-0 flex-wrap items-start">
            <div className="mb-2 mr-3 min-w-0 flex-1">
              <h2 className="text-[15px] font-semibold">Plano de teste</h2>
              <p className="text-[12px] leading-snug text-muted-foreground">
                Ângulo antes de execução: hipóteses realmente diferentes, uma variável por vez.
                {briefing.data ? ` Briefing versão ${briefing.data.versao}.` : " Sem briefing salvo: o plano fica mais fraco."}
                {` ${destaques} referência${destaques === 1 ? "" : "s"} em destaque.`}
              </p>
            </div>
          </div>
          <div className="mt-1 rounded-xl border border-border bg-background p-2 focus-within:border-primary/60">
            <Textarea
              value={pedido}
              onChange={(e) => setPedido(e.target.value)}
              rows={2}
              aria-label="Pedido para o plano"
              placeholder="Pedido opcional: foco, restrição, o que já foi testado"
              className="min-h-[52px] resize-none border-0 bg-transparent px-1 py-1 text-[13px] shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
            />
            <div className="mt-1 flex min-w-0 flex-wrap items-center">
              <Ditado valor={pedido} onChange={setPedido} className="mb-1 mr-2" />
              <div className="mb-1 mr-2 flex items-center rounded-lg bg-muted p-0.5" role="radiogroup" aria-label="Quantidade de ângulos">
                {QUANTIDADES_DE_ANGULOS.map((n) => (
                  <button
                    key={n}
                    type="button"
                    role="radio"
                    aria-checked={quantidade === n}
                    onClick={() => setQuantidade(n)}
                    className={`h-7 min-w-[34px] rounded-md px-2 text-[12px] ${quantidade === n ? "bg-card font-medium text-foreground shadow-sm" : "text-muted-foreground"}`}
                  >
                    {n}
                  </button>
                ))}
                <span className="px-2 text-[11.5px] text-muted-foreground">ângulos</span>
              </div>
              <span className="mb-1 ml-auto flex items-center">
                <Andamento desde={desdeGerar} rotulo="Montando os ângulos" />
                <BotaoComCusto
                  rotulo={<><Wand2 className="mr-1 h-3.5 w-3.5" /> Gerar plano</>}
                  titulo="Gerar plano de teste"
                  descricao="O estrategista de ads lê o briefing e as referências em destaque e propõe os ângulos; o Jev dá as notas."
                  className="ml-2 h-9"
                  partes={() => partesDoPlano(catalogo, quantidade)}
                  executar={gerar}
                  aoConcluir={(data) => {
                    setPedido("");
                    void queryClient.invalidateQueries({ queryKey: chavesAds.planos(clientId) });
                    const id = data && (data.plano_id || (data.plano && data.plano.id));
                    if (id) onPlano(String(id));
                  }}
                />
              </span>
            </div>
          </div>
        </section>

        {lista.length > 1 && (
          <nav aria-label="Planos do cliente" className="flex min-w-0 overflow-x-auto pb-1">
            {lista.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => onPlano(p.id)}
                aria-current={plano && plano.id === p.id ? "true" : undefined}
                className={`mr-2 shrink-0 rounded-lg border px-3 py-1.5 text-left transition-colors ${
                  plano && plano.id === p.id ? "border-primary bg-primary/5" : "border-border bg-card hover:border-primary/40"
                }`}
              >
                <span className="block max-w-[220px] truncate text-[12.5px] font-medium">{p.nome}</span>
                <span className="block text-[11px] text-muted-foreground">
                  {dataCurta(p.criado_em)} · {p.angulos.length} ângulos · {(STATUS_DO_PLANO.find((s) => s.valor === p.status) || STATUS_DO_PLANO[0]).rotulo}
                </span>
              </button>
            ))}
          </nav>
        )}

        {planos.isError && <AvisoDeErro erro={planos.error} />}
        {planos.isLoading && <div className="h-64 animate-pulse rounded-xl bg-muted/70" />}
        {planos.data && !plano && (
          <div className="rounded-xl border border-dashed border-border p-8 text-center">
            <FlaskConical className="mx-auto h-6 w-6 text-primary" />
            <p className="mt-3 text-[14px] font-medium">Nenhum plano ainda</p>
            <p className="mt-1 text-[12.5px] text-muted-foreground">Salve o briefing, destaque algumas referências e gere o primeiro plano.</p>
          </div>
        )}

        {plano && (
          <>
            <div className="flex min-w-0 flex-wrap items-center">
              <h3 className="mb-1 mr-3 min-w-0 flex-1 truncate text-[14px] font-semibold">{plano.nome}</h3>
              {plano.custo_usd > 0 && <span className="mb-1 mr-2 text-[11.5px] tabular-nums text-muted-foreground">{usd(plano.custo_usd)}</span>}
              <select
                aria-label="Status do plano"
                value={plano.status}
                onChange={(e) => void mudarStatus(e.target.value as StatusDoPlano)}
                className="mb-1 h-8 rounded-md border border-input bg-background px-2 text-[12px]"
              >
                {STATUS_DO_PLANO.map((s) => <option key={s.valor} value={s.valor}>{s.rotulo}</option>)}
              </select>
            </div>
            <div className="grid min-w-0 grid-cols-1 gap-3 2xl:grid-cols-2">
              {plano.angulos.map((a, i) => (
                <CartaoDoAngulo
                  key={a.id}
                  angulo={a}
                  indice={i}
                  marcado={marcados.indexOf(a.id) >= 0}
                  onMarcar={() => setMarcados((m) => alternar(m, a.id))}
                  referencias={referencias.data || []}
                />
              ))}
            </div>

            <div className="sticky bottom-3 z-10 rounded-xl border border-border bg-card p-3 shadow-md" aria-label="Produzir criativos">
              <div className="flex min-w-0 flex-wrap items-center">
                <div className="mb-1 mr-3 flex min-w-0 flex-wrap items-center" role="group" aria-label="Formatos">
                  {FORMATOS.map((f) => {
                    const ativo = formatos.indexOf(f.valor) >= 0;
                    return (
                      <button
                        key={f.valor}
                        type="button"
                        aria-pressed={ativo}
                        onClick={() => setFormatos((l) => alternar(l, f.valor))}
                        className={`mb-1 mr-1.5 inline-flex h-8 items-center rounded-full border px-2.5 text-[12px] transition-colors ${
                          ativo ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {ativo && <Check className="mr-1 h-3 w-3" />}
                        {f.rotulo}
                      </button>
                    );
                  })}
                </div>
                <span className="mb-1 ml-auto flex items-center">
                  <span className="mr-2 text-[12px] tabular-nums text-muted-foreground">
                    {marcados.length} ângulo{marcados.length === 1 ? "" : "s"} × {formatos.length} formato{formatos.length === 1 ? "" : "s"} = {pecas} criativo{pecas === 1 ? "" : "s"}
                  </span>
                  <Andamento desde={desdeProduzir} rotulo="Dirigindo" />
                  <BotaoComCusto
                    rotulo="Produzir criativos"
                    titulo="Produzir criativos"
                    descricao="Para cada ângulo e formato: a copy do anúncio (conferida pelo Jev) e a direção de arte no Estúdio Ads, pronta para gerar."
                    className="ml-2 h-9"
                    disabled={pecas === 0}
                    partes={() => partesDaProducao(catalogo, pecas)}
                    executar={produzir}
                    aoConcluir={() => {
                      void queryClient.invalidateQueries({ queryKey: chavesAds.criativos(clientId) });
                      void queryClient.invalidateQueries({ queryKey: chavesAds.planos(clientId) });
                      onProduzido(plano.id);
                    }}
                  />
                </span>
              </div>
            </div>
          </>
        )}
      </div>

      {plano && <ConversaDoPlano plano={plano} className="xl:sticky xl:top-[140px] xl:h-[calc(100vh-170px)]" />}
    </div>
  );
}
