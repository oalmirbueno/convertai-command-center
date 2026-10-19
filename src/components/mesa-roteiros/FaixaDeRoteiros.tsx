import { useState } from "react";
import { AlertTriangle, BookOpenCheck, CalendarDays, Check, Clock, FilePlus2, Layers, Loader2, Plus, X } from "lucide-react";
import JanelaCentral from "@/components/sistema/JanelaCentral";
import { botao, foco, juntar, texto } from "@/components/sistema/estilos";
import { usd } from "@/lib/mesa/api";
import { esquecerLoteDeRoteiros, estadoDaAbaNoLote, tituloCurto, useLoteDeRoteiros, type AbaDeRoteiro, type EstadoNoLote } from "./roteirosAbertos";

/**
 * A faixa de roteiros abertos no topo da Mesa Roteiros (19/10/2026), como as
 * abas do navegador: o título curto de cada roteiro, o x que só tira da faixa
 * (não apaga) e o + para abrir outro (novo, da agenda ou da biblioteca
 * validada). Cada aba guarda a etapa em que parou. No "Gerar todos", cada aba
 * mostra o próprio andamento (na fila, gerando, pronto, falhou).
 *
 * Celular: a faixa rola por dentro, de lado; a página nunca rola na horizontal.
 */

const NOME_DO_ESTADO: Record<EstadoNoLote, string> = {
  fila: "na fila",
  gerando: "gerando",
  pronto: "pronto",
  falhou: "falhou",
};

const NOME_DA_ETAPA: Record<AbaDeRoteiro["etapa"], string> = { roteiro: "Roteiro", revisao: "Revisão", pdf: "PDF" };

function IconeDoEstado({ estado }: { estado: EstadoNoLote }) {
  if (estado === "gerando") return <Loader2 className="mr-1 h-3 w-3 shrink-0 animate-spin text-primary" aria-hidden="true" />;
  if (estado === "fila") return <Clock className="mr-1 h-3 w-3 shrink-0 text-muted-foreground" aria-hidden="true" />;
  if (estado === "pronto") return <Check className="mr-1 h-3 w-3 shrink-0 text-success" aria-hidden="true" />;
  return <AlertTriangle className="mr-1 h-3 w-3 shrink-0 text-destructive" aria-hidden="true" />;
}

export default function FaixaDeRoteiros({
  clientId,
  abas,
  ativa,
  onEscolher,
  onFechar,
  onNovo,
  onDaAgenda,
  onDaBiblioteca,
}: {
  clientId: string;
  abas: AbaDeRoteiro[];
  /** Id da aba à vista (nenhuma na Agenda e nos Modelos). */
  ativa: string | null;
  onEscolher: (id: string) => void;
  onFechar: (id: string) => void;
  onNovo: () => void;
  onDaAgenda: () => void;
  onDaBiblioteca: () => void;
}) {
  const [abrindo, setAbrindo] = useState(false);
  const lote = useLoteDeRoteiros(clientId);
  const gerando = lote ? lote.itens.filter((i) => i.estado === "gerando" || i.estado === "fila").length : 0;
  const prontos = lote ? lote.itens.filter((i) => i.estado === "pronto").length : 0;
  const escolherNaJanela = (f: () => void) => {
    setAbrindo(false);
    f();
  };
  return (
    <div className="flex min-w-0 items-center border-b border-border pb-1.5" data-faixa-de-roteiros="">
      <div role="tablist" aria-label="Roteiros abertos" className="scrollbar-hidden -mb-px flex min-w-0 flex-1 flex-nowrap items-center overflow-x-auto overscroll-x-contain">
        {!abas.length && <span className={juntar(texto.auxiliar, "shrink-0 px-1")}>Nenhum roteiro aberto. Use o + ou marque vários na Agenda.</span>}
        {abas.map((a) => {
          const noLote = estadoDaAbaNoLote(lote, a.id);
          const atual = a.id === ativa;
          const dica = `${a.titulo} · ${NOME_DA_ETAPA[a.etapa]}${noLote ? ` · ${NOME_DO_ESTADO[noLote.estado]}${noLote.erro ? `: ${noLote.erro}` : ""}` : ""}`;
          return (
            <div
              key={a.id}
              className={juntar("group mr-1 inline-flex h-8 max-w-[200px] shrink-0 items-center rounded-md pl-2.5 pr-0.5 transition-colors", atual ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground")}
              data-aba-de-roteiro={a.id}
              data-estado-no-lote={noLote ? noLote.estado : undefined}
            >
              <button
                type="button"
                role="tab"
                aria-selected={atual}
                onClick={() => onEscolher(a.id)}
                title={dica}
                className={juntar("toque-compacto flex min-w-0 items-center rounded-sm text-[12.5px] leading-none", atual && "font-medium", foco)}
              >
                {noLote && <IconeDoEstado estado={noLote.estado} />}
                <span className="min-w-0 truncate">{tituloCurto(a.titulo)}</span>
              </button>
              <button
                type="button"
                onClick={() => onFechar(a.id)}
                aria-label={`Fechar ${a.titulo} da faixa`}
                title="Fechar da faixa (o roteiro continua guardado)"
                className={juntar("toque-compacto ml-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-background hover:text-foreground", foco)}
              >
                <X className="h-3 w-3" aria-hidden="true" />
              </button>
            </div>
          );
        })}
      </div>
      {lote && (
        <span className={juntar(texto.auxiliar, "ml-2 hidden shrink-0 items-center sm:inline-flex")} role="status" aria-live="polite" data-andamento-do-lote="">
          {lote.ativo ? `Gerando ${Math.min(prontos + 1, lote.itens.length)} de ${lote.itens.length}` : `${prontos} de ${lote.itens.length} prontos`}
          {lote.custo_usd > 0 ? ` · ${usd(lote.custo_usd)}` : ""}
          {!lote.ativo && !gerando && (
            <button type="button" className={juntar(botao.icone, "ml-0.5 h-6 w-6")} onClick={() => esquecerLoteDeRoteiros(clientId)} aria-label="Fechar o andamento" title="Fechar o andamento">
              <X className="h-3 w-3" aria-hidden="true" />
            </button>
          )}
        </span>
      )}
      <button type="button" className={juntar(botao.icone, "ml-1")} onClick={() => setAbrindo(true)} aria-label="Abrir outro roteiro" title="Abrir outro roteiro">
        <Plus className="h-4 w-4" aria-hidden="true" />
      </button>
      <JanelaCentral
        aberta={abrindo}
        onMudar={setAbrindo}
        titulo="Abrir outro roteiro"
        icone={<Layers className="h-4 w-4" />}
        largura="sm"
        ajuda="Cada roteiro abre numa aba da faixa e guarda a etapa em que parou. Para abrir vários de uma vez, marque na Agenda (peças e roteiros) ou nas ideias com o agente."
        data-janela-abrir-roteiro=""
      >
        <ul className="-my-1 divide-y divide-border">
          {[
            { icone: <FilePlus2 className="h-4 w-4" />, nome: "Roteiro novo", detalhe: "Em branco ou a partir das ideias com o agente.", acao: onNovo },
            { icone: <CalendarDays className="h-4 w-4" />, nome: "Da agenda do cliente", detalhe: "Peças de vídeo e roteiros já feitos; marque vários para abrir juntos.", acao: onDaAgenda },
            { icone: <BookOpenCheck className="h-4 w-4" />, nome: "Da biblioteca validada", detalhe: "Um modelo validado ou da memória do cliente.", acao: onDaBiblioteca },
          ].map((o) => (
            <li key={o.nome}>
              <button type="button" onClick={() => escolherNaJanela(o.acao)} className={juntar("flex w-full min-w-0 items-start rounded-md px-1 py-2.5 text-left transition-colors hover:bg-muted/50", foco)}>
                <span className="mr-2.5 mt-0.5 shrink-0 text-muted-foreground" aria-hidden="true">
                  {o.icone}
                </span>
                <span className="min-w-0">
                  <span className="block text-[13px] font-medium text-foreground">{o.nome}</span>
                  <span className={juntar(texto.auxiliar, "block leading-5")}>{o.detalhe}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </JanelaCentral>
    </div>
  );
}
