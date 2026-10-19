import { useMemo, useState } from "react";
import { CalendarDays, FileText, Lightbulb, Plus, Sparkles } from "lucide-react";
import { useMesa } from "@/components/mesa/MesaContexto";
import { dataCurta, textoDoErro } from "@/lib/mesa/api";
import { Carregando, EstadoDeErro, EstadoVazio } from "@/components/sistema/Estados";
import SeletorCompacto from "@/components/sistema/SeletorCompacto";
import { botao, juntar } from "@/components/sistema/estilos";
import { useEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
import { ROTULO_DO_FORMATO, ROTULO_DO_STATUS, modoDoTipo, type LinhaDoRoteiro } from "../../../supabase/functions/_shared/roteiro-modelo";
import { roteiroDaPeca, usePecasDeVideo, useRoteiros } from "./roteirosApi";
import { AvisoDoBanco, BlocoRecolhivel, SeloDoStatus } from "./Comuns";
// 19/10/2026: marcar vários, abrir na faixa de cima e gerar todos (SelecaoEmLote.tsx).
import { useFaixa } from "./roteirosAbertos";
import BarraDaSelecao, { type ItemDaSelecao } from "./SelecaoEmLote";

/**
 * Etapa 1: a agenda. Lista as peças de vídeo da agenda do cliente (Reels,
 * vídeo, short e story; tasks.delivery_type), da semana passada até seis
 * semanas à frente, com o estado do roteiro de cada uma, e os roteiros
 * avulsos. O roteiro já gravado no calendário, o contexto, o cérebro e a
 * campanha entram como base quando o roteiro é gerado.
 *
 * 19/10/2026: cada peça e cada roteiro tem a caixa de marcar. Marcados,
 * "Abrir os selecionados" põe todos na faixa de roteiros abertos e "Gerar
 * todos" gera os que ainda não têm roteiro, com o preço total antes.
 */
export default function EtapaAgenda({
  onAbrirRoteiro,
  onNovoDaPeca,
  onAvulso,
}: {
  onAbrirRoteiro: (id: string, titulo?: string) => void;
  onNovoDaPeca: (taskId: string, titulo?: string) => void;
  onAvulso: () => void;
}) {
  const { clientId } = useMesa();
  const faixa = useFaixa();
  // Seleção: "p:<peça>" e "r:<roteiro>".
  const [marcados, setMarcados] = useState<Record<string, true>>({});
  const marcar = (k: string) =>
    setMarcados((m) => {
      const n = { ...m };
      if (n[k]) delete n[k];
      else n[k] = true;
      return n;
    });
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
  const selecionados: ItemDaSelecao[] = [];
  pecas.forEach((p) => {
    if (!marcados[`p:${p.id}`]) return;
    const r = roteiroDaPeca(lista, p.id);
    if (r) selecionados.push({ pedido: { roteiro: r.id, tarefa: p.id, titulo: r.titulo }, corpo: null });
    else selecionados.push({ pedido: { tarefa: p.id, titulo: p.titulo }, corpo: { task_id: p.id, tipo: "fala_camera", duracao_s: modoDoTipo("fala_camera").duracao_padrao_s } });
  });
  outros.forEach((r) => {
    if (marcados[`r:${r.id}`]) selecionados.push({ pedido: { roteiro: r.id, titulo: r.titulo }, corpo: null });
  });
  const caixa = (k: string, nome: string) =>
    faixa ? (
      <input type="checkbox" className="mr-2.5 h-4 w-4 shrink-0 cursor-pointer accent-primary" checked={!!marcados[k]} onChange={() => marcar(k)} aria-label={`Marcar ${nome}`} title="Marcar para abrir ou gerar junto" />
    ) : null;
  const estados = Object.keys(ROTULO_DO_STATUS)
    .map((k) => ROTULO_DO_STATUS[k as keyof typeof ROTULO_DO_STATUS])
    .join(", ");

  return (
    <div className="min-w-0 space-y-6" data-etapa-agenda="">
      {roteirosQ.data && roteirosQ.data.indisponivel && <AvisoDoBanco />}
      {selecionados.length > 0 && <BarraDaSelecao itens={selecionados} onLimpar={() => setMarcados({})} />}

      {/* 28/09 (dono: "tudo recolhe"): o cabeçalho das peças virou bloco recolhível, e as listas ficaram abertas (sem cartão). */}
      <BlocoRecolhivel
        chave={`mesa-roteiros:pecas:${clientId}`}
        nivel={2}
        divisoria={false}
        icone={<CalendarDays className="h-4 w-4" />}
        titulo="Peças de vídeo da agenda"
        ajuda={`Reels, vídeo, short e story da agenda, da semana passada até seis semanas à frente. O roteiro gravado no calendário, o contexto, o cérebro e a campanha entram como base. Estados: ${estados}. Aprovado fica ligado à peça da agenda.`}
        estado={pecasQ.isSuccess ? `${pecas.length} ${pecas.length === 1 ? "peça" : "peças"}` : undefined}
        resumo={pecasQ.isSuccess ? `${pecas.length} ${pecas.length === 1 ? "peça" : "peças"}` : undefined}
        acoes={
          <>
            {/* 02/10: sem tema? O roteiro avulso abre com as Ideias com o agente em cima. */}
            {/* 16/10/2026: só ícone (nome no aria-label e no title). */}
            <button type="button" className={juntar(botao.icone, "mr-0.5")} onClick={onAvulso} aria-label="Ideias de tema com o agente" title="Ideias de tema com o agente">
              <Lightbulb className="h-4 w-4" />
            </button>
            <button type="button" className={botao.icone} onClick={onAvulso} aria-label="Roteiro avulso" title="Roteiro avulso">
              <Plus className="h-4 w-4" />
            </button>
          </>
        }
      >
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
          <ul className="divide-y divide-border" data-pecas-de-video="">
            {pecas.map((p) => {
              const r = roteiroDaPeca(lista, p.id);
              return (
                <li key={p.id} className="flex min-w-0 flex-wrap items-center py-2.5" data-peca={p.id}>
                  {caixa(`p:${p.id}`, p.titulo)}
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
                    {r ? <SeloDoStatus status={r.status} /> : <span className="text-[12px] text-muted-foreground">Sem roteiro</span>}
                    {r ? (
                      <button type="button" className={juntar(botao.icone, "ml-2 disabled:opacity-50")} onClick={() => onAbrirRoteiro(r.id, r.titulo)} aria-label="Abrir" title="Abrir">
                        <FileText className="h-4 w-4" aria-hidden="true" />
                      </button>
                    ) : (
                      <button type="button" className={juntar(botao.icone, "ml-2 text-primary disabled:opacity-50")} onClick={() => onNovoDaPeca(p.id, p.titulo)} aria-label="Escrever roteiro" title="Escrever roteiro">
                        <Sparkles className="h-4 w-4" aria-hidden="true" />
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </BlocoRecolhivel>

      <BlocoRecolhivel
        chave={`mesa-roteiros:avulsos:${clientId}`}
        nivel={2}
        icone={<FileText className="h-4 w-4" />}
        titulo="Roteiros avulsos e de outras datas"
        estado={roteirosQ.isSuccess ? `${outros.length} ${outros.length === 1 ? "roteiro" : "roteiros"}` : undefined}
        resumo={roteirosQ.isSuccess ? `${outros.length} ${outros.length === 1 ? "roteiro" : "roteiros"}` : undefined}
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
      >
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
          <ul className="divide-y divide-border">
            {outros.map((r: LinhaDoRoteiro) => (
              <li key={r.id} className="flex min-w-0 items-center py-2.5" data-roteiro={r.id}>
                {caixa(`r:${r.id}`, r.titulo)}
                <div className="mr-2 min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium text-foreground">{r.titulo}</p>
                  <p className="truncate text-[12px] text-muted-foreground">
                    {modoDoTipo(r.tipo).rotulo} · versão {r.versao_atual}
                    {r.arquivado_em ? " · arquivado" : ""}
                    {r.task_id ? " · peça fora do período" : " · avulso"}
                  </p>
                </div>
                <SeloDoStatus status={r.status} />
                <button type="button" className={juntar(botao.secundario, "ml-2 h-8 px-3 text-[12px]")} onClick={() => onAbrirRoteiro(r.id, r.titulo)}>
                  Abrir
                </button>
              </li>
            ))}
          </ul>
        )}
      </BlocoRecolhivel>
    </div>
  );
}
