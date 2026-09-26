import { useMemo } from "react";
import { CalendarDays, FileText, Plus, Sparkles } from "lucide-react";
import { useMesa } from "@/components/mesa/MesaContexto";
import { dataCurta, textoDoErro } from "@/lib/mesa/api";
import { Carregando, EstadoDeErro, EstadoVazio } from "@/components/sistema/Estados";
import SeletorCompacto from "@/components/sistema/SeletorCompacto";
import { botao, juntar, superficie } from "@/components/sistema/estilos";
import { useEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
import { ROTULO_DO_FORMATO, ROTULO_DO_STATUS, modoDoTipo, type LinhaDoRoteiro } from "../../../supabase/functions/_shared/roteiro-modelo";
import { roteiroDaPeca, usePecasDeVideo, useRoteiros } from "./roteirosApi";
import { AvisoDoBanco, Cabecalho, RotuloLargo, SeloDoStatus } from "./Comuns";

/**
 * Etapa 1: a agenda. Lista as peças de vídeo da agenda do cliente (Reels,
 * vídeo, short e story; tasks.delivery_type), da semana passada até seis
 * semanas à frente, com o estado do roteiro de cada uma, e os roteiros
 * avulsos. O roteiro já gravado no calendário, o contexto, o cérebro e a
 * campanha entram como base quando o roteiro é gerado.
 */
export default function EtapaAgenda({
  onAbrirRoteiro,
  onNovoDaPeca,
  onAvulso,
}: {
  onAbrirRoteiro: (id: string) => void;
  onNovoDaPeca: (taskId: string) => void;
  onAvulso: () => void;
}) {
  const { clientId } = useMesa();
  const pecasQ = usePecasDeVideo(clientId);
  const roteirosQ = useRoteiros(clientId);
  // Filtro dos avulsos guardado por cliente (sair e voltar mantém).
  const [filtro, setFiltro] = useEstadoDaTela<"ativos" | "todos">(`mesa-roteiros:agenda:filtro:${clientId}`, "ativos", { validar: (v) => v === "ativos" || v === "todos" });
  const comArquivados = filtro === "todos";
  const lista = roteirosQ.data ? roteirosQ.data.lista : [];
  const pecas = pecasQ.data || [];
  const idsDasPecas = useMemo(() => {
    const m: Record<string, true> = {};
    pecas.forEach((p) => (m[p.id] = true));
    return m;
  }, [pecas]);
  const outros = lista.filter((r) => (!r.task_id || !idsDasPecas[r.task_id]) && (comArquivados || !r.arquivado_em));
  const arquivados = lista.filter((r) => !!r.arquivado_em).length;
  const estados = Object.keys(ROTULO_DO_STATUS)
    .map((k) => ROTULO_DO_STATUS[k as keyof typeof ROTULO_DO_STATUS])
    .join(", ");

  return (
    <div className="min-w-0 space-y-6" data-etapa-agenda="">
      {roteirosQ.data && roteirosQ.data.indisponivel && <AvisoDoBanco />}

      <section className="min-w-0 space-y-3">
        <Cabecalho
          icone={<CalendarDays className="h-4 w-4" />}
          titulo="Peças de vídeo da agenda"
          ajuda={`Reels, vídeo, short e story da agenda, da semana passada até seis semanas à frente. O roteiro gravado no calendário, o contexto, o cérebro e a campanha entram como base. Estados: ${estados}. Aprovado fica ligado à peça da agenda.`}
          estado={pecasQ.isSuccess ? `${pecas.length} ${pecas.length === 1 ? "peça" : "peças"}` : undefined}
          acoes={
            <button type="button" className={botao.secundario} onClick={onAvulso} aria-label="Roteiro avulso">
              <Plus className="h-3.5 w-3.5" />
              <RotuloLargo>Roteiro avulso</RotuloLargo>
            </button>
          }
        />
        {pecasQ.isLoading && <Carregando forma="lista" linhas={4} rotulo="Lendo a agenda" />}
        {pecasQ.isError && (
          <EstadoDeErro
            titulo={textoDoErro(pecasQ.error, "Não foi possível ler a agenda.")}
            acao={
              <button type="button" className={botao.secundario} onClick={() => void pecasQ.refetch()}>
                Tentar de novo
              </button>
            }
          />
        )}
        {pecasQ.isSuccess && !pecas.length && <EstadoVazio compacto titulo="Nenhuma peça de vídeo na agenda." descricao="Use o roteiro avulso." />}
        {pecas.length > 0 && (
          <ul className={juntar(superficie.painel, "divide-y divide-border")} data-pecas-de-video="">
            {pecas.map((p) => {
              const r = roteiroDaPeca(lista, p.id);
              return (
                <li key={p.id} className="flex min-w-0 flex-wrap items-center px-4 py-2.5" data-peca={p.id}>
                  <div className="mr-3 w-[64px] shrink-0 text-[12px] tabular-nums text-muted-foreground">{p.data ? dataCurta(p.data) : "sem data"}</div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium text-foreground">{p.titulo}</p>
                    <p className="truncate text-[12px] text-muted-foreground">
                      {ROTULO_DO_FORMATO[p.formato] || p.formato}
                      {p.temRoteiroDaAgenda ? " · roteiro do calendário entra como base" : ""}
                      {r ? ` · ${modoDoTipo(r.tipo).rotulo} · versão ${r.versao_atual}` : ""}
                    </p>
                  </div>
                  <div className="mt-1.5 flex w-full items-center justify-end sm:ml-2 sm:mt-0 sm:w-auto">
                    {r ? <SeloDoStatus status={r.status} /> : <span className="text-[11.5px] text-muted-foreground">Sem roteiro</span>}
                    {r ? (
                      <button type="button" className={juntar(botao.secundario, "ml-2 h-8 px-3 text-[12px]")} onClick={() => onAbrirRoteiro(r.id)}>
                        <FileText className="mr-1 h-3.5 w-3.5" /> Abrir
                      </button>
                    ) : (
                      <button type="button" className={juntar(botao.secundario, "ml-2 h-8 px-3 text-[12px] text-primary")} onClick={() => onNovoDaPeca(p.id)}>
                        <Sparkles className="mr-1 h-3.5 w-3.5" /> Escrever roteiro
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="min-w-0 space-y-3 border-t border-border pt-5">
        <Cabecalho
          icone={<FileText className="h-4 w-4" />}
          titulo="Roteiros avulsos e de outras datas"
          estado={roteirosQ.isSuccess ? `${outros.length} ${outros.length === 1 ? "roteiro" : "roteiros"}` : undefined}
          acoes={
            arquivados > 0 ? (
              <SeletorCompacto
                rotulo="Mostrar roteiros"
                opcoes={[
                  { valor: "ativos", rotulo: "Ativos" },
                  { valor: "todos", rotulo: "Com arquivados", contador: arquivados },
                ]}
                valor={filtro}
                onEscolher={(v) => setFiltro(v === "todos" ? "todos" : "ativos")}
              />
            ) : null
          }
        />
        {roteirosQ.isLoading && <Carregando forma="lista" linhas={2} rotulo="Lendo os roteiros" />}
        {roteirosQ.isError && (
          <EstadoDeErro
            titulo={textoDoErro(roteirosQ.error, "Não foi possível ler os roteiros.")}
            acao={
              <button type="button" className={botao.secundario} onClick={() => void roteirosQ.refetch()}>
                Tentar de novo
              </button>
            }
          />
        )}
        {roteirosQ.isSuccess && !outros.length && <EstadoVazio compacto titulo="Nenhum roteiro avulso ainda." />}
        {outros.length > 0 && (
          <ul className={juntar(superficie.painel, "divide-y divide-border")}>
            {outros.map((r: LinhaDoRoteiro) => (
              <li key={r.id} className="flex min-w-0 items-center px-4 py-2.5" data-roteiro={r.id}>
                <div className="mr-2 min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium text-foreground">{r.titulo}</p>
                  <p className="truncate text-[12px] text-muted-foreground">
                    {modoDoTipo(r.tipo).rotulo} · versão {r.versao_atual}
                    {r.arquivado_em ? " · arquivado" : ""}
                    {r.task_id ? " · peça fora do período" : " · avulso"}
                  </p>
                </div>
                <SeloDoStatus status={r.status} />
                <button type="button" className={juntar(botao.secundario, "ml-2 h-8 px-3 text-[12px]")} onClick={() => onAbrirRoteiro(r.id)}>
                  Abrir
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
