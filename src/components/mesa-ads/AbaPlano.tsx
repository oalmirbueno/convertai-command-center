import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Briefcase, Check, ChevronDown, FlaskConical, ShieldCheck, Target, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { Textarea } from "@/components/ui/textarea";
import { AvisoDeErro, BotaoComCusto, useAvisarErro } from "@/components/mesa/Custo";
import { useMesa } from "@/components/mesa/MesaContexto";
import { Ditado } from "@/components/mesa/Ditado";
import { custoDaResposta, dataCurta, textoDoErro, usd } from "@/lib/mesa/api";
import {
  alertaDoJev,
  anguloAprovado,
  chamarAds,
  chavesAds,
  corpoDoPlano,
  FORMATOS,
  humanizar,
  lerBriefing,
  lerOfertas,
  lerPlanos,
  lerReferencias,
  mudarPlano,
  normalizarPlano,
  notasDe10,
  OBJETIVOS,
  partesDaProducao,
  partesDoPlanoV2,
  pontuacaoDe10,
  qualidadeDoPlano,
  rotuloDoObjetivo,
  rotuloDoTom,
  STATUS_DO_PLANO,
  testarPrimeiroDoPlano,
  tomDe,
  tomDoPedido,
  TONS_DO_CRIATIVO,
  brl,
  type Angulo,
  type FormatoAds,
  type PedidoDePlano,
  type PlanoAds,
  type StatusDoPlano,
  type TomDoCriativo,
} from "./adsApi";
import { Andamento, BarraDeNota, BarraDePolitica, pilula, SeloDeEvidencia, useAndamento } from "./Comuns";
import ConversaDoPlano from "./ConversaDoPlano";
import AgenteSenior from "./AgenteSenior";
import KitDeRecepcao from "./KitDeRecepcao";
import TesteDoAgente from "./TesteDoAgente";
import { gerarKit, kitDoAngulo, partesDoKit } from "./acoesDoAgenteApi";

/**
 * Etapa 3, Plano de teste: ângulos realmente diferentes (situação × mecanismo
 * × prova) com hipótese no formato do dossiê. O servidor só devolve depois do
 * laço de qualidade: o Jev pontua clareza, relevância, prova, risco de
 * política, parada e diferenciação; o que não passa na régua é reescrito
 * (até 2 rodadas) e o que continua fraco vai para "Descartados pela
 * conferência", com os motivos. A equipe escolhe ângulos e formatos e manda
 * produzir: cada combinação vira um criativo com copy e um trabalho no
 * Estúdio Ads. Pedidos vindos da Oferta ou da Conta chegam prontos
 * (pedidoPendente) e o plano é gerado sozinho, uma vez.
 */

export const QUANTIDADES_DE_ANGULOS = [3, 4, 5, 6];

/** Corpo de criativos_produzir: ângulos na ordem do plano e formatos na ordem da lista (v3: com o tom, quando escolhido). */
export function corpoDaProducao(plano: PlanoAds, angulos: string[], formatos: FormatoAds[], tom?: TomDoCriativo | null) {
  const corpo: { plano_id: string; angulo_ids: string[]; formatos: FormatoAds[]; tom?: TomDoCriativo } = {
    plano_id: plano.id,
    angulo_ids: plano.angulos.filter((a) => angulos.indexOf(a.id) >= 0).map((a) => a.id),
    formatos: FORMATOS.map((f) => f.valor).filter((f) => formatos.indexOf(f) >= 0),
  };
  if (tom) corpo.tom = tom;
  return corpo;
}

/** Seletor dos três tons (sóbrio, direto, agressivo), com a regra de cada um no título. */
export function SeletorDeTom({ valor, onMudar, rotulo = "Tom" }: { valor: TomDoCriativo; onMudar: (t: TomDoCriativo) => void; rotulo?: string }) {
  return (
    <div className="flex min-w-0 flex-wrap items-center" role="radiogroup" aria-label={rotulo}>
      {TONS_DO_CRIATIVO.map((t) => (
        <button
          key={t.valor}
          type="button"
          role="radio"
          aria-checked={valor === t.valor}
          title={t.dica}
          onClick={() => onMudar(t.valor)}
          className={pilula(valor === t.valor)}
        >
          {t.rotulo}
        </button>
      ))}
    </div>
  );
}

/** Testar primeiro: a ordem de teste, o porquê e a regra de corte (números do código). */
function TestarPrimeiro({ plano }: { plano: PlanoAds }) {
  const { itens, base } = testarPrimeiroDoPlano(plano);
  if (!itens.length) return null;
  return (
    <section className="rounded-xl border border-primary/30 bg-primary/5 p-4" aria-label="Testar primeiro">
      <h3 className="flex items-center text-[13.5px] font-semibold">
        <Target className="mr-1.5 h-4 w-4 text-primary" /> Testar primeiro
      </h3>
      <p className="mt-0.5 text-[12px] text-muted-foreground">
        Ordem pela conferência do Jev e pela prova. O corte usa o custo tolerável do briefing ou a média real da conta.
        {base && base.custo_por_resultado !== null
          ? ` Conta nos últimos ${base.periodo_dias} dias: ${brl(base.gasto)} investidos, ${base.resultados || 0} resultado(s), ${brl(base.custo_por_resultado)} por resultado.`
          : base
            ? " A conta ainda não tem resultado registrado nos últimos 90 dias."
            : ""}
      </p>
      <ol className="mt-2 space-y-2">
        {itens.map((t, i) => (
          <li key={t.angulo_id} className="min-w-0 rounded-lg border border-border bg-card p-3">
            <p className="text-[13px] font-semibold [overflow-wrap:anywhere]">
              <span className="mr-1.5 inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-primary px-1.5 text-[11px] text-primary-foreground">{t.ordem || i + 1}</span>
              {t.nome}
            </p>
            {t.porque && <p className="mt-1 text-[12.5px] leading-snug [overflow-wrap:anywhere]"><span className="font-medium">Por quê: </span>{t.porque}</p>}
            {t.metrica && <p className="mt-1 text-[12px] text-muted-foreground [overflow-wrap:anywhere]">Métrica que decide: {t.metrica}</p>}
            {t.corte && <p className="mt-1 text-[12px] leading-snug [overflow-wrap:anywhere]"><span className="font-medium">Corte: </span>{t.corte}</p>}
          </li>
        ))}
      </ol>
    </section>
  );
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

/** Nota geral do ângulo: cor pela régua (7 ou mais é forte). */
function SeloDaPontuacao({ nota }: { nota: number | null }) {
  if (nota === null) return null;
  const tom = nota >= 7.5 ? "border-success/40 bg-success/10 text-success" : nota >= 6 ? "border-warning/40 bg-warning/10 text-warning" : "border-destructive/30 bg-destructive/10 text-destructive";
  return (
    <span className={`ml-2 inline-flex shrink-0 flex-col items-center rounded-lg border px-2 py-1 leading-none ${tom}`} aria-label={`Pontuação ${nota.toLocaleString("pt-BR")} de 10`}>
      <span className="text-[17px] font-semibold tabular-nums">{nota.toLocaleString("pt-BR")}</span>
      <span className="mt-0.5 text-[9px] uppercase tracking-wider opacity-80">de 10</span>
    </span>
  );
}

function NotasDoAngulo({ angulo }: { angulo: Angulo }) {
  const notas = notasDe10(angulo.jev);
  return (
    <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-border pt-3 sm:grid-cols-3 xl:grid-cols-6" aria-label="Notas do Jev">
      <BarraDeNota rotulo="Clareza" nota={notas.clareza} />
      <BarraDeNota rotulo="Relevância" nota={notas.relevancia} />
      <BarraDeNota rotulo="Prova" nota={notas.prova} />
      <BarraDePolitica nota={notas.risco_politica} />
      {notas.parada !== null && <BarraDeNota rotulo="Parada" nota={notas.parada} />}
      {notas.diferenciacao !== null && <BarraDeNota rotulo="Diferenciação" nota={notas.diferenciacao} />}
      {angulo.jev && pontuacaoDe10(angulo.jev.tom) !== null && <BarraDeNota rotulo={`Tom ${rotuloDoTom(angulo.tom).toLowerCase()}`} nota={pontuacaoDe10(angulo.jev.tom)} />}
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
  const refs = referencias.filter((r) => (angulo.referencia_ids || []).indexOf(r.id) >= 0);
  const formatos = (angulo.formatos || []).map((f) => FORMATOS.find((x) => x.valor === f)).filter(Boolean) as typeof FORMATOS;
  const aprovado = anguloAprovado(angulo);
  const temQualidade = typeof angulo.aprovado === "boolean" || angulo.reprovado === true || angulo.pontuacao !== undefined;
  const alerta = alertaDoJev(angulo.jev);
  const motivos = angulo.motivos || [];
  const rodadas = typeof angulo.rodadas === "number" ? angulo.rodadas : 0;
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
          <div className="mt-1.5 flex min-w-0 flex-wrap items-center">
            {temQualidade && (
              <span
                className={`mb-1 mr-1.5 inline-flex h-5 items-center rounded-full px-2 text-[10.5px] font-medium ${aprovado ? "bg-success/10 text-success" : "bg-warning/15 text-warning"}`}
                data-aprovado={aprovado ? "sim" : "nao"}
              >
                {aprovado ? <ShieldCheck className="mr-1 h-3 w-3" /> : <AlertTriangle className="mr-1 h-3 w-3" />}
                {aprovado ? "Aprovado na conferência" : "Abaixo da régua"}
              </span>
            )}
            {angulo.estilo_visual && <span className="mb-1 mr-1.5 rounded-full border border-border px-2 py-0.5 text-[11px]">{humanizar(angulo.estilo_visual)}</span>}
            {angulo.objetivo && <span className="mb-1 mr-1.5 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] text-primary">{rotuloDoObjetivo(angulo.objetivo)}</span>}
            {typeof angulo.ordem_teste === "number" && (
              <span className="mb-1 mr-1.5 rounded-full bg-primary px-2 py-0.5 text-[11px] font-medium text-primary-foreground">Testar {angulo.ordem_teste}º</span>
            )}
            {angulo.tom && <span className="mb-1 mr-1.5 rounded-full border border-border px-2 py-0.5 text-[11px]">Tom {rotuloDoTom(angulo.tom).toLowerCase()}</span>}
            {angulo.generico && (
              <span className="mb-1 mr-1.5 rounded-full bg-warning/15 px-2 py-0.5 text-[11px] font-medium text-warning" title="Pela conferência do Jev: diferenciação ou relevância baixa, serviria para qualquer marca da categoria.">
                Genérico
              </span>
            )}
            {rodadas > 0 && (
              <span className="mb-1 mr-1.5 text-[11px] text-muted-foreground">
                reescrito {rodadas} {rodadas === 1 ? "vez" : "vezes"} pela conferência
              </span>
            )}
          </div>
        </div>
        <SeloDaPontuacao nota={pontuacaoDe10(angulo.pontuacao)} />
      </div>

      {angulo.gancho_verbal && (
        <p className="mt-3 font-serif text-[18px] font-semibold leading-snug [overflow-wrap:anywhere]">
          {"“"}
          {angulo.gancho_verbal}
          {"”"}
        </p>
      )}

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Linha rotulo="Situação">{angulo.situacao}</Linha>
        <Linha rotulo="Mecanismo">{angulo.mecanismo}</Linha>
        <Linha rotulo="Gancho visual">{angulo.gancho_visual}</Linha>
        <Linha rotulo="Prova">{angulo.prova}</Linha>
        <Linha rotulo="Métrica e janela">{[angulo.metrica, angulo.janela_dias ? `${angulo.janela_dias} dias` : ""].filter(Boolean).join(" · ")}</Linha>
      </div>

      {angulo.hipotese && (
        <blockquote className="mt-3 rounded-lg border-l-2 border-primary bg-primary/5 px-3 py-2 text-[12.5px] leading-relaxed [overflow-wrap:anywhere]">
          <span className="mb-0.5 block text-[10.5px] font-medium uppercase tracking-wider text-muted-foreground">Hipótese</span>
          {angulo.hipotese}
        </blockquote>
      )}

      {(angulo.porque_testar_primeiro || angulo.corte) && (
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Linha rotulo="Por que testar">{angulo.porque_testar_primeiro || ""}</Linha>
          <Linha rotulo="Regra de corte">{angulo.corte ? angulo.corte.texto : ""}</Linha>
        </div>
      )}

      {(alerta || (!aprovado && motivos.length > 0)) && (
        <div className="mt-3 rounded-lg border border-warning/40 bg-warning/5 px-3 py-2" role="note">
          {alerta && <p className="text-[12px] font-medium text-warning">{alerta}</p>}
          {!aprovado && motivos.length > 0 && (
            <ul className="mt-0.5 list-disc pl-4 text-[12px] leading-snug">
              {motivos.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="mt-3 flex min-w-0 flex-wrap items-center">
        {formatos.map((f) => (
          <span key={f.valor} className="mb-1 mr-1.5 rounded-full bg-secondary px-2 py-0.5 text-[11px] text-muted-foreground">
            {f.rotulo}
          </span>
        ))}
        {angulo.variacoes ? (
          <span className="mb-1 mr-1.5 text-[11px] text-muted-foreground">
            {angulo.variacoes} variação{angulo.variacoes === 1 ? "" : "ões"}
          </span>
        ) : null}
        {refs.map((r) => (
          <span key={r.id} className="mb-1 mr-1.5 inline-flex max-w-full items-center rounded-full border border-border px-1.5 py-0.5 text-[11px]">
            <SeloDeEvidencia valor={r.evidencia} className="mr-1 h-4 px-1.5" />
            <span className="truncate">{r.titulo}</span>
          </span>
        ))}
      </div>

      <NotasDoAngulo angulo={angulo} />
    </article>
  );
}

function Descartados({ angulos }: { angulos: Angulo[] }) {
  const [aberto, setAberto] = useState(false);
  if (!angulos.length) return null;
  return (
    <section className="rounded-xl border border-dashed border-border bg-card/60" aria-label="Descartados pela conferência">
      <button type="button" onClick={() => setAberto((v) => !v)} aria-expanded={aberto} className="flex w-full items-center px-4 py-3 text-left">
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] font-medium">Descartados pela conferência ({angulos.length})</span>
          <span className="block text-[11.5px] text-muted-foreground">Não passaram na régua do Jev nem depois de reescritos. Ficam aqui para consulta, fora da produção.</span>
        </span>
        <ChevronDown className={`ml-2 h-4 w-4 shrink-0 text-muted-foreground transition-transform ${aberto ? "rotate-180" : ""}`} />
      </button>
      {aberto && (
        <ul className="space-y-2 border-t border-border px-4 py-3">
          {angulos.map((a) => (
            <li key={a.id} className="min-w-0 rounded-lg border border-border bg-background p-3">
              <div className="flex min-w-0 items-start">
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-medium [overflow-wrap:anywhere]">{a.nome}</p>
                  {a.gancho_verbal && <p className="mt-0.5 text-[12px] text-muted-foreground [overflow-wrap:anywhere]">{`“${a.gancho_verbal}”`}</p>}
                </div>
                <SeloDaPontuacao nota={pontuacaoDe10(a.pontuacao)} />
              </div>
              {(a.motivos || []).length > 0 && (
                <ul className="mt-1.5 list-disc pl-4 text-[12px] leading-snug text-foreground/90">
                  {(a.motivos || []).map((m) => (
                    <li key={m}>{m}</li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default function AbaPlano({
  planoId,
  onPlano,
  onProduzido,
  pedidoPendente = null,
  onPedidoConsumido,
}: {
  planoId: string | null;
  onPlano: (id: string | null) => void;
  onProduzido: (planoId: string) => void;
  /** Pedido vindo da Oferta ou da Conta: gera o plano sozinho, uma vez. */
  pedidoPendente?: PedidoDePlano | null;
  onPedidoConsumido?: () => void;
}) {
  const mesa = useMesa();
  const { clientId, catalogo } = mesa;
  const queryClient = useQueryClient();
  const avisarErro = useAvisarErro();
  const planos = useQuery({ queryKey: chavesAds.planos(clientId), queryFn: () => lerPlanos(clientId) });
  const briefing = useQuery({ queryKey: chavesAds.briefing(clientId), queryFn: () => lerBriefing(clientId) });
  const referencias = useQuery({ queryKey: chavesAds.referencias(clientId), queryFn: () => lerReferencias(clientId) });
  const ofertas = useQuery({ queryKey: chavesAds.ofertas(clientId), queryFn: () => lerOfertas(clientId), retry: false });
  const [pedido, setPedido] = useState("");
  const [quantidade, setQuantidade] = useState(4);
  const [ofertaId, setOfertaId] = useState("");
  const [objetivo, setObjetivo] = useState("");
  const [agenteAberto, setAgenteAberto] = useState(false);
  const [marcados, setMarcados] = useState<string[]>([]);
  const [formatos, setFormatos] = useState<FormatoAds[]>(["feed_4x5", "stories_9x16"]);
  const [desdeGerar, rodarGerar] = useAndamento();
  const [desdeProduzir, rodarProduzir] = useAndamento();
  const [rotuloDoPedido, setRotuloDoPedido] = useState<string | null>(null);
  // v3: tom do plano novo e da produção (o da produção começa no tom do plano aberto).
  // Sem escolha explícita, o tom sai do pedido escrito ("mais agressivo") e, sem nada, direto.
  const [tomEscolhido, setTomEscolhido] = useState<TomDoCriativo | null>(null);
  const [tomDaProducao, setTomDaProducao] = useState<TomDoCriativo>("direto");
  // 25/09: o kit de recepção (post que recebe quem veio do anúncio e roteiro de vendas) sai junto com os criativos.
  const [comKit, setComKit] = useState(true);
  const tom: TomDoCriativo = tomEscolhido || tomDoPedido(pedido) || "direto";

  const lista = planos.data || [];
  const plano = lista.find((p) => p.id === planoId) || lista[0] || null;
  const tomDoPlanoAberto: TomDoCriativo = (plano && tomDe(plano.estrutura.tom)) || "direto";
  const destaques = (referencias.data || []).filter((r) => r.destaque).length;
  const ofertasAtivas = (ofertas.data || []).filter((o) => o.status !== "arquivada").sort((a, b) => Number(b.status === "escolhida") - Number(a.status === "escolhida"));
  const qualidade = plano ? qualidadeDoPlano(plano) : null;
  const ofertaDoPlano = qualidade && qualidade.oferta_id ? (ofertas.data || []).find((o) => o.id === qualidade.oferta_id) || null : null;

  // Objetivo do briefing e oferta escolhida entram como padrão (a equipe troca).
  const objetivoDoBriefing = briefing.data ? briefing.data.objetivo.acao : "";
  useEffect(() => {
    if (!objetivo && objetivoDoBriefing) setObjetivo(objetivoDoBriefing);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [objetivoDoBriefing]);
  const escolhida = ofertasAtivas.find((o) => o.status === "escolhida");
  useEffect(() => {
    if (!ofertaId && escolhida) setOfertaId(escolhida.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [escolhida ? escolhida.id : ""]);

  // Outro plano: os ângulos aprovados marcados e os formatos que o estrategista sugeriu.
  useEffect(() => {
    if (!plano) return;
    const aprovados = plano.angulos.filter(anguloAprovado);
    setMarcados((aprovados.length ? aprovados : plano.angulos).map((a) => a.id));
    const sugeridos: FormatoAds[] = [];
    plano.angulos.forEach((a) =>
      (a.formatos || []).forEach((f) => {
        if (sugeridos.indexOf(f) < 0 && FORMATOS.some((x) => x.valor === f)) sugeridos.push(f);
      }),
    );
    if (sugeridos.length) setFormatos(sugeridos);
    setTomDaProducao(tomDe(plano.estrutura.tom) || "direto");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plano ? plano.id : null, plano ? plano.angulos.length : 0, plano ? String(plano.estrutura.tom || "") : ""]);

  const pecas = useMemo(() => marcados.length * formatos.length, [marcados.length, formatos.length]);

  const chamarPlano = (extra: Partial<PedidoDePlano> = {}) =>
    chamarAds<any>(
      "plano_gerar",
      corpoDoPlano({
        client_id: clientId,
        briefing_id: briefing.data ? briefing.data.id : null,
        pedido: extra.pedido !== undefined ? extra.pedido : pedido,
        quantidade_angulos: extra.quantidade_angulos || quantidade,
        oferta_id: extra.oferta_id !== undefined ? extra.oferta_id : ofertaId || null,
        objetivo: extra.objetivo !== undefined ? extra.objetivo : objetivo || null,
        modo: extra.modo,
        referencia_ids: extra.referencia_ids,
        tom: extra.tom || tomEscolhido,
      }),
    ).catch(async (e) => {
      // O servidor grava o plano logo depois da primeira conferência: se a
      // chamada cair no meio, o que foi pago aparece na lista.
      await queryClient.invalidateQueries({ queryKey: chavesAds.planos(clientId) });
      throw e;
    });

  const aoGerar = (data: any) => {
    setPedido("");
    setTomEscolhido(null);
    setRotuloDoPedido(null);
    if (data && typeof data.aviso === "string" && data.aviso) toast.info("Aviso do estrategista", { description: data.aviso });
    const p = data && data.plano && typeof data.plano === "object" ? normalizarPlano(data.plano) : null;
    if (p) {
      queryClient.setQueryData(chavesAds.planos(clientId), (l: PlanoAds[] | undefined) => [p].concat((l || []).filter((x) => x.id !== p.id)));
      const q = qualidadeDoPlano(p);
      if (q.aprovados !== null || q.descartados.length) {
        toast.info("Conferência do Jev", {
          description: `${q.aprovados !== null ? q.aprovados : p.angulos.filter(anguloAprovado).length} ângulo(s) aprovados${q.descartados.length ? `, ${q.descartados.length} descartado(s)` : ""}${q.rodadas ? ` em ${q.rodadas} rodada(s)` : ""}.`,
        });
      }
    }
    void queryClient.invalidateQueries({ queryKey: chavesAds.planos(clientId) });
    const id = data && (data.plano_id || (data.plano && data.plano.id));
    if (id) onPlano(String(id));
  };

  // Pedido vindo de outra etapa: roda uma vez, com o andamento aqui.
  const consumido = useRef<PedidoDePlano | null>(null);
  useEffect(() => {
    if (!pedidoPendente || consumido.current === pedidoPendente || briefing.isLoading) return;
    consumido.current = pedidoPendente;
    const p = pedidoPendente;
    if (onPedidoConsumido) onPedidoConsumido();
    setRotuloDoPedido(p.rotulo);
    if (p.oferta_id) setOfertaId(p.oferta_id);
    if (p.objetivo) setObjetivo(p.objetivo);
    if (p.tom) setTomEscolhido(p.tom);
    rodarGerar(() => chamarPlano({ ...p, pedido: p.pedido || "" }))
      .then((data) => {
        mesa.atualizarCusto();
        const custo = custoDaResposta(data);
        toast.success("Plano gerado", { description: custo === null ? "Custo registrado na carteira do cliente." : `Custo real: ${usd(custo)}.` });
        aoGerar(data);
      })
      .catch((e) => {
        mesa.atualizarCusto();
        setRotuloDoPedido(null);
        avisarErro(e, "O plano não foi gerado");
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pedidoPendente, briefing.isLoading]);

  const produzir = () => (plano ? rodarProduzir(() => chamarAds<any>("criativos_produzir", corpoDaProducao(plano, marcados, formatos, tomDaProducao !== tomDoPlanoAberto ? tomDaProducao : null))) : Promise.resolve(null));

  const mudarStatus = async (status: StatusDoPlano) => {
    if (!plano) return;
    try {
      await mudarPlano(plano.id, { status });
      await queryClient.invalidateQueries({ queryKey: chavesAds.planos(clientId) });
    } catch (e) {
      toast.error("Status não salvo", { description: textoDoErro(e) });
    }
  };

  const alternar = <T,>(l: T[], v: T) => (l.indexOf(v) >= 0 ? l.filter((x) => x !== v) : l.concat([v]));
  // Ângulos marcados ainda sem kit de recepção (o kit sai junto com a produção, em paralelo).
  const semKit = plano ? plano.angulos.filter((a) => marcados.indexOf(a.id) >= 0 && !kitDoAngulo(a)).map((a) => a.id) : [];
  const gerarKitsDosAngulos = (planoId: string, ids: string[]) => {
    void Promise.all(ids.map((id) => gerarKit(planoId, id).then(() => true, () => false))).then((r) => {
      mesa.atualizarCusto();
      void queryClient.invalidateQueries({ queryKey: chavesAds.planos(clientId) });
      const ok = r.filter(Boolean).length;
      if (ok) toast.success(ok === 1 ? "Kit de recepção pronto" : `${ok} kits de recepção prontos`, { description: "No Estúdio Ads, embaixo do criativo, e no Plano de teste." });
      if (ok < r.length) toast.warning(`${r.length - ok} kit(s) não saíram`, { description: "Gere de novo pelo botão do ângulo." });
    });
  };
  const angulosOrdenados = plano ? plano.angulos : [];

  return (
    <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
      <div className="min-w-0 space-y-4">
        <section className="rounded-xl border border-border bg-card p-4" aria-label="Gerar plano">
          <div className="flex min-w-0 flex-wrap items-start">
            <div className="mb-2 mr-3 min-w-0 flex-1">
              <h2 className="text-[15px] font-semibold">Plano de teste</h2>
              <p className="text-[12px] leading-snug text-muted-foreground">
                Ângulo antes de execução: hipóteses realmente diferentes, uma variável por vez. Só chegam ângulos que passaram na conferência do Jev.
                {briefing.data ? ` Briefing versão ${briefing.data.versao}.` : " Sem briefing salvo: o plano fica mais fraco."}
                {` ${destaques} referência${destaques === 1 ? "" : "s"} em destaque.`}
              </p>
            </div>
          </div>
          <div className="mt-1 grid min-w-0 grid-cols-1 gap-3 lg:grid-cols-2">
            <label className="block min-w-0">
              <span className="mb-1 block text-[11.5px] font-medium text-foreground/80">Oferta</span>
              <select aria-label="Oferta do plano" value={ofertaId} onChange={(e) => setOfertaId(e.target.value)} className="h-9 w-full rounded-md border border-input bg-background px-2 text-[12.5px]">
                <option value="">Sem oferta específica (usa o briefing)</option>
                {ofertasAtivas.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.status === "escolhida" ? "Escolhida: " : ""}
                    {o.nome}
                  </option>
                ))}
              </select>
            </label>
            <div className="min-w-0 lg:col-span-2">
              <span className="mb-1 block text-[11.5px] font-medium text-foreground/80">
                Tom <span className="font-normal text-muted-foreground">({(TONS_DO_CRIATIVO.find((t) => t.valor === tom) || TONS_DO_CRIATIVO[1]).dica})</span>
              </span>
              <SeletorDeTom valor={tom} onMudar={setTomEscolhido} rotulo="Tom do plano" />
            </div>
            <div className="min-w-0">
              <span className="mb-1 block text-[11.5px] font-medium text-foreground/80">Objetivo</span>
              <div className="flex min-w-0 flex-wrap" role="radiogroup" aria-label="Objetivo do plano">
                {OBJETIVOS.map((o) => (
                  <button key={o.valor} type="button" role="radio" aria-checked={objetivo === o.valor} title={o.dica} onClick={() => setObjetivo(objetivo === o.valor ? "" : o.valor)} className={pilula(objetivo === o.valor)}>
                    {o.rotulo}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="mt-2 rounded-xl border border-border bg-background p-2 focus-within:border-primary/60">
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
              <span className="mb-1 ml-auto flex min-w-0 flex-wrap items-center">
                <Andamento desde={desdeGerar} rotulo={rotuloDoPedido ? `${rotuloDoPedido}: montando e conferindo` : "Montando e conferindo os ângulos"} />
                <BotaoComCusto
                  rotulo={<><Wand2 className="mr-1 h-3.5 w-3.5" /> Gerar plano</>}
                  titulo="Gerar plano de teste"
                  descricao="O estrategista lê o briefing, a oferta e as referências em destaque; o Jev pontua cada ângulo e o que não passa é reescrito antes de chegar aqui."
                  className="ml-2 h-9"
                  disabled={desdeGerar !== null}
                  partes={() => partesDoPlanoV2(catalogo, quantidade)}
                  executar={() => rodarGerar(() => chamarPlano())}
                  aoConcluir={aoGerar}
                />
              </span>
            </div>
          </div>
        </section>

        {lista.length > 1 && (
          <nav aria-label="Planos do cliente" className="flex min-w-0 flex-wrap">
            {lista.slice(0, 8).map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => onPlano(p.id)}
                aria-current={plano && plano.id === p.id ? "true" : undefined}
                className={`mb-2 mr-2 min-w-0 max-w-full rounded-lg border px-3 py-1.5 text-left transition-colors ${
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
        {planos.data && !plano && desdeGerar === null && (
          <div className="rounded-xl border border-dashed border-border p-8 text-center">
            <FlaskConical className="mx-auto h-6 w-6 text-primary" />
            <p className="mt-3 text-[14px] font-medium">Nenhum plano ainda</p>
            <p className="mt-1 text-[12.5px] text-muted-foreground">Escolha uma oferta na etapa Oferta, destaque algumas referências e gere o primeiro plano.</p>
          </div>
        )}
        {desdeGerar !== null && !plano && <div className="h-64 animate-pulse rounded-xl bg-muted/70" aria-label="Gerando o plano" />}

        {plano && qualidade && (
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
                {STATUS_DO_PLANO.map((s) => (
                  <option key={s.valor} value={s.valor}>
                    {s.rotulo}
                  </option>
                ))}
              </select>
            </div>

            {(qualidade.rodadas !== null || qualidade.aprovados !== null || qualidade.objetivo || ofertaDoPlano) && (
              <div className="flex min-w-0 flex-wrap items-center rounded-xl border border-border bg-card px-4 py-2.5" aria-label="Qualidade do plano">
                <ShieldCheck className="mb-1 mr-2 mt-1 h-4 w-4 shrink-0 text-success" />
                <span className="mb-1 mr-3 mt-1 text-[12.5px]">
                  Conferência do Jev
                  {qualidade.rodadas !== null ? `: ${qualidade.rodadas} rodada${qualidade.rodadas === 1 ? "" : "s"} de qualidade` : ""}
                </span>
                {qualidade.aprovados !== null && <span className="mb-1 mr-1.5 mt-1 rounded-full bg-success/10 px-2 py-0.5 text-[11px] text-success">{qualidade.aprovados} aprovados</span>}
                {qualidade.descartados.length > 0 && (
                  <span className="mb-1 mr-1.5 mt-1 rounded-full bg-secondary px-2 py-0.5 text-[11px] text-muted-foreground">{qualidade.descartados.length} descartados</span>
                )}
                {qualidade.objetivo && <span className="mb-1 mr-1.5 mt-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] text-primary">{rotuloDoObjetivo(qualidade.objetivo)}</span>}
                {ofertaDoPlano && <span className="mb-1 mt-1 min-w-0 truncate text-[11.5px] text-muted-foreground">Oferta: {ofertaDoPlano.nome}</span>}
              </div>
            )}

            <TestarPrimeiro plano={plano} />
            <TesteDoAgente plano={plano} />

            {/* v5: o agente sênior revisa o plano com a conta ao vivo (abre sob demanda: não lê nada antes do clique). */}
            {agenteAberto ? (
              <AgenteSenior planoId={plano.id} onPlanoPronto={(id) => onPlano(id)} />
            ) : (
              <button
                type="button"
                onClick={() => setAgenteAberto(true)}
                className="flex w-full min-w-0 items-center rounded-xl border border-dashed border-border bg-card px-4 py-2.5 text-left text-[12.5px] hover:border-primary/50"
              >
                <Briefcase className="mr-2 h-4 w-4 shrink-0 text-primary" />
                <span className="min-w-0 flex-1">
                  <span className="font-medium">Revisar com o agente sênior de tráfego</span>
                  <span className="block text-[11.5px] text-muted-foreground">Ele lê este plano junto com a conta ao vivo, a evolução e o nicho, e diz o que ajustar.</span>
                </span>
              </button>
            )}

            <div className="grid min-w-0 grid-cols-1 gap-3 2xl:grid-cols-2">
              {angulosOrdenados.map((a, i) => (
                <div key={a.id} className="min-w-0 space-y-2">
                  <CartaoDoAngulo angulo={a} indice={i} marcado={marcados.indexOf(a.id) >= 0} onMarcar={() => setMarcados((m) => alternar(m, a.id))} referencias={referencias.data || []} />
                  <KitDeRecepcao plano={plano} angulo={a} compacto />
                </div>
              ))}
            </div>

            <Descartados angulos={qualidade.descartados} />

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
                <label className="mb-1 mr-3 inline-flex min-w-0 items-center text-[11.5px] text-muted-foreground" title="O post que recebe quem veio do anúncio e o roteiro de atendimento e vendas de cada ângulo">
                  <input type="checkbox" className="mr-1.5" checked={comKit} onChange={(e) => setComKit(e.target.checked)} />
                  Com o kit de recepção
                </label>
                <div className="mb-1 mr-3 flex min-w-0 items-center">
                  <span className="mr-1.5 text-[11.5px] text-muted-foreground">Tom</span>
                  <SeletorDeTom valor={tomDaProducao} onMudar={setTomDaProducao} rotulo="Tom dos criativos" />
                </div>
                <span className="mb-1 ml-auto flex min-w-0 flex-wrap items-center">
                  <span className="mr-2 text-[12px] tabular-nums text-muted-foreground">
                    {marcados.length} ângulo{marcados.length === 1 ? "" : "s"} × {formatos.length} formato{formatos.length === 1 ? "" : "s"} = {pecas} criativo{pecas === 1 ? "" : "s"}
                  </span>
                  <Andamento desde={desdeProduzir} rotulo="Dirigindo" />
                  <BotaoComCusto
                    rotulo="Produzir criativos"
                    titulo="Produzir criativos"
                    descricao={`Para cada ângulo e formato: a copy do anúncio no tom ${rotuloDoTom(tomDaProducao).toLowerCase()} (conferida pelo Jev, com aviso de genérico) e a direção de arte no Estúdio Ads, pronta para gerar.`}
                    className="ml-2 h-9"
                    disabled={pecas === 0}
                    partes={() => partesDaProducao(catalogo, pecas).concat(comKit && semKit.length ? partesDoKit(catalogo, semKit.length) : [])}
                    executar={produzir}
                    aoConcluir={() => {
                      void queryClient.invalidateQueries({ queryKey: chavesAds.criativos(clientId) });
                      void queryClient.invalidateQueries({ queryKey: chavesAds.planos(clientId) });
                      if (comKit && semKit.length) gerarKitsDosAngulos(plano.id, semKit);
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
