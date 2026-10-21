import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CalendarCheck2, CalendarClock, ExternalLink, ShieldCheck, Star } from "lucide-react";
import { toast } from "sonner";
import { padraoPara, parteDaConferenciaDoJev, TAMANHOS, textoDoErro, usd, type ParteDaEstimativa } from "@/lib/mesa/api";
import { botao, juntar, lista, texto } from "@/components/sistema";
import { BotaoComCusto, useAvisarErro } from "./Custo";
import { ImagemDaMesa, useMesa } from "./MesaContexto";
import { atualizarAgenda, chaves, diaCurto, editarItemDaProposta, hojeIso, type Campanha, type PropostaV4 } from "./mesaV4Api";
import { lerAgendaDoCliente } from "./agendaInteligenteApi";
import { conflitosDaSerie, rotuloDaFase, ROTULO_DO_ESTADO_DA_PECA, type SituacaoDaPeca } from "./regrasDaCampanha";
import { campanhaConferir, chavesDaCampanhaCompleta, levarPecaParaAgenda, type ConferenciaDaCampanha } from "./campanhasApi";
import { dataBr } from "../../../supabase/functions/_shared/agenda-inteligente";

/**
 * Revisão e agenda (etapa 6, 21/10/2026). A equipe revisa cada peça pronta e aprova: a peça entra no
 * calendário na data do conteúdo e vai para a Entrega pelo fluxo de sempre da arte rápida (item na Agenda,
 * legenda, Arquivos e aprovação do cliente). Antes, dois avisos inteligentes:
 * - conflito com a agenda do cliente (dia cheio pela regra dele, contando a própria série), com o próximo
 *   dia livre a um clique;
 * - a conferência do Jev (centavos): se cada peça bate com o briefing e qual gancho abre melhor a campanha.
 *   Só aviso: nada é reescrito.
 */

const ROTULO_DO_NIVEL: Record<string, string> = { forte: "bate com o briefing", ok: "serve ao briefing", fraca: "foge do briefing" };
const COR_DO_NIVEL: Record<string, string> = { forte: "text-success", ok: "text-muted-foreground", fraca: "text-warning" };

export default function CampanhaRevisao({
  campanha,
  proposta,
  pecas,
  onAbrirArteRapida,
}: {
  campanha: Campanha;
  proposta: PropostaV4 | null;
  pecas: SituacaoDaPeca[];
  onAbrirArteRapida?: (trabalhoId: string) => void;
}) {
  const { clientId, catalogo } = useMesa();
  const qc = useQueryClient();
  const avisarErro = useAvisarErro();
  const hoje = hojeIso();
  const [levando, setLevando] = useState<string | null>(null);
  const inicio = campanha.periodo_inicio || hoje;
  const fim = campanha.periodo_fim || hoje;
  const agenda = useQuery({
    queryKey: ["mesa", "agenda-inteligente", clientId, "campanha", campanha.id, inicio, fim],
    staleTime: 60_000,
    retry: false,
    queryFn: () => lerAgendaDoCliente(clientId, inicio < hoje ? hoje : inicio, fim < hoje ? hoje : fim),
  });
  const conferencia = useQuery<ConferenciaDaCampanha | null>({
    queryKey: chavesDaCampanhaCompleta.conferencia(campanha.id),
    enabled: false,
    queryFn: () => null,
  });
  const itens = (proposta && proposta.itens) || [];
  const conflitos = agenda.data ? conflitosDaSerie(itens, agenda.data, hoje, { inicio: campanha.periodo_inicio, fim: campanha.periodo_fim }) : [];
  const conflitoDe = (temaId?: string) => conflitos.filter((c) => c.temaId === temaId)[0] || null;
  const notaDe = (temaId?: string) => (conferencia.data ? conferencia.data.pecas.filter((p) => p.tema_id === temaId)[0] || null : null);
  const revisaveis = pecas.filter((p) => p.estado !== "outra_mesa");
  const prontas = revisaveis.filter((p) => p.estado === "pronta" && p.trabalho);
  const diretor = padraoPara(catalogo, "diretor_arte");
  const partesDaLegenda = (n: number): ParteDaEstimativa[] =>
    n ? [{ modeloId: diretor ? diretor.id : null, tipo: "texto", tokensEntrada: TAMANHOS.legenda.entrada, tokensSaida: TAMANHOS.legenda.saida, vezes: n }] : [];
  const semLegenda = (ps: SituacaoDaPeca[]) => ps.filter((p) => p.trabalho && !String(p.trabalho.legenda || "").trim()).length;

  const dataDaPeca = (p: SituacaoDaPeca) => {
    const d = String(p.item.data || "");
    return d && d >= hoje ? d : hoje;
  };

  const levar = async (ps: SituacaoDaPeca[]) => {
    let custo = 0;
    const falhas: string[] = [];
    for (const p of ps) {
      if (!p.trabalho) continue;
      setLevando(p.trabalho.id);
      try {
        const r = await levarPecaParaAgenda(p.trabalho, dataDaPeca(p));
        custo += r.custo_usd;
        if (!r.ok) falhas.push(`${p.item.tema || "Peça"}: ${r.erro || "não entregue"}`);
      } catch (e) {
        // Falha numa peça não para as outras.
        falhas.push(`${p.item.tema || "Peça"}: ${textoDoErro(e)}`);
      }
    }
    setLevando(null);
    atualizarAgenda(qc, clientId);
    void qc.invalidateQueries({ queryKey: chavesDaCampanhaCompleta.pecas(clientId, campanha.id) });
    void qc.invalidateQueries({ queryKey: ["mesa", "arte-rapida", clientId] });
    if (falhas.length) toast.warning(`${ps.length - falhas.length} de ${ps.length} na agenda`, { description: falhas.join(" ").slice(0, 400), duration: 12000 });
    else toast.success("Na agenda e na Entrega", { description: `${ps.length} peça(s) no calendário, enviadas para a aprovação do cliente.` });
    return { custo_usd: custo };
  };

  const mudarDia = async (temaId: string, data: string) => {
    if (!proposta) return;
    try {
      const d = await editarItemDaProposta(proposta.id, temaId, { data });
      if (d && d.proposta) qc.setQueryData(chaves.proposta(proposta.id), d.proposta);
      toast.success("Dia trocado", { description: `Agora em ${dataBr(data)}.` });
    } catch (e) {
      avisarErro(e, "Não foi possível trocar o dia");
    }
  };

  return (
    <div className="min-w-0 space-y-4" data-revisao-da-campanha="">
      <div className="flex min-w-0 flex-wrap items-center">
        <p className="mb-1 mr-3 min-w-0 flex-1 text-[12px] text-muted-foreground">
          {prontas.length} pronta(s) para aprovar
          {conflitos.length ? ` · ${conflitos.length} dia(s) cheio(s) na agenda` : ""}
          {conferencia.data && conferencia.data.jev_erro ? " · o Jev não respondeu agora" : ""}
        </p>
        <BotaoComCusto
          rotulo={<><ShieldCheck className="h-4 w-4" aria-hidden="true" /><span className="sr-only">Conferir com o briefing</span></>}
          titulo="Conferência da série"
          descricao="Conferir com o briefing (Jev): se cada peça bate com o briefing e qual gancho abre melhor a campanha"
          partes={() => [parteDaConferenciaDoJev()]}
          executar={() => campanhaConferir(campanha.id)}
          aoConcluir={(d) => qc.setQueryData(chavesDaCampanhaCompleta.conferencia(campanha.id), d)}
          disabled={!itens.length}
          variant="ghost"
          className="mb-1 mr-1 h-8 gap-0 px-2"
        />
        <BotaoComCusto
          rotulo={<><CalendarCheck2 className="h-4 w-4" aria-hidden="true" /><span className="ml-1 tabular-nums" aria-hidden="true">{prontas.length}</span><span className="sr-only">Aprovar e levar as prontas para a agenda</span></>}
          titulo="Peças na agenda"
          descricao="Aprovar e levar todas as prontas para a agenda, cada uma no seu dia, e para a aprovação do cliente"
          partes={() => partesDaLegenda(semLegenda(prontas))}
          executar={() => levar(prontas)}
          fecharAoConfirmar
          sempreConfirmar
          disabled={!prontas.length || levando !== null}
          className="mb-1 h-8 gap-0 px-2.5"
        />
      </div>

      {revisaveis.length === 0 ? (
        <p className={texto.auxiliar}>Sem peças para revisar ainda.</p>
      ) : (
        <ul className={juntar(lista.aberta, lista.divisoria)} aria-label="Peças para revisar">
          {revisaveis.map((p) => {
            const c = conflitoDe(p.item.tema_id);
            const nota = notaDe(p.item.tema_id);
            const melhor = !!conferencia.data && conferencia.data.melhor_gancho === p.item.tema_id;
            const trabalho = p.trabalho;
            return (
              <li key={p.item.tema_id || p.item.tema} className={lista.linha} data-revisao={p.item.tema_id}>
                <span className="mr-3 h-14 w-11 shrink-0 overflow-hidden rounded-md bg-muted">
                  {p.capa ? <ImagemDaMesa caminho={p.capa} alt="" className="h-full w-full" /> : null}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex min-w-0 items-center text-[13px] font-medium">
                    <span className="min-w-0 truncate" title={p.item.tema}>{p.item.tema || "Peça"}</span>
                    {melhor && (
                      <span className="ml-1.5 shrink-0 text-warning" role="img" aria-label="Melhor gancho para abrir a campanha" title={`Melhor gancho para abrir a campanha (Jev): ${p.item.gancho || ""}`}>
                        <Star className="h-3.5 w-3.5" aria-hidden="true" />
                      </span>
                    )}
                  </p>
                  <p className="mt-0.5 flex min-w-0 flex-wrap items-center text-[11px] text-muted-foreground">
                    <span className="mr-2">{diaCurto(p.item.data)}</span>
                    <span className="mr-2">{rotuloDaFase(p.fase)}</span>
                    <span className="mr-2 font-medium">{ROTULO_DO_ESTADO_DA_PECA[p.estado]}</span>
                    {nota && nota.nivel && <span className={juntar("mr-2 font-medium", COR_DO_NIVEL[nota.nivel])}>{ROTULO_DO_NIVEL[nota.nivel]}</span>}
                  </p>
                  {c && (
                    <p className="mt-0.5 flex min-w-0 flex-wrap items-center text-[11px] text-warning">
                      <AlertTriangle className="mr-1 h-3 w-3 shrink-0" aria-hidden="true" />
                      <span className="mr-1.5 min-w-0">{c.aviso}</span>
                      {c.sugestao && proposta && !p.item.task_id && (
                        <button type="button" className="font-medium text-primary hover:underline" onClick={() => void mudarDia(c.temaId, c.sugestao as string)} title={`Mudar a peça para ${dataBr(c.sugestao)}`}>
                          Usar {dataBr(c.sugestao)}
                        </button>
                      )}
                    </p>
                  )}
                </div>
                <div className="ml-2 flex shrink-0 items-center">
                  {trabalho && onAbrirArteRapida && (
                    <button type="button" className={juntar(botao.icone, "text-primary")} onClick={() => onAbrirArteRapida(trabalho.id)} aria-label="Abrir no Estúdio" title="Abrir no Estúdio para revisar">
                      <ExternalLink className="h-4 w-4" aria-hidden="true" />
                    </button>
                  )}
                  {p.estado === "pronta" && trabalho && (
                    <BotaoComCusto
                      rotulo={<><CalendarClock className="h-4 w-4" aria-hidden="true" /><span className="sr-only">Aprovar e levar para a agenda</span></>}
                      titulo="Peça na agenda"
                      descricao={`Aprovar e levar para a agenda em ${dataBr(dataDaPeca(p))} e para a aprovação do cliente`}
                      partes={() => partesDaLegenda(semLegenda([p]))}
                      executar={() => levar([p])}
                      fecharAoConfirmar
                      disabled={levando !== null}
                      variant="ghost"
                      className="h-8 gap-0 px-2"
                    />
                  )}
                  {(p.estado === "na_agenda" || p.estado === "no_roteiro") && (
                    <span className="inline-flex h-8 w-8 items-center justify-center" role="img" aria-label="Na agenda" title="Na agenda">
                      <CalendarCheck2 className="h-4 w-4 text-success" aria-hidden="true" />
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {conferencia.data && conferencia.data.custo_usd > 0 && <p className={texto.auxiliar}>Conferência do Jev: {usd(conferencia.data.custo_usd)}.</p>}
    </div>
  );
}
