import { useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent as EventoDoPonteiro } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CalendarRange, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { juntar, texto } from "@/components/sistema";
import { BotaoComCusto } from "./Custo";
import { useMesa } from "./MesaContexto";
import { diasEntreIso, hojeIso, somarDiasIso, type Campanha } from "./mesaV4Api";
import { chavesDaCampanha, normalizarBriefing, partesDaReorganizacao, reorganizarCampanha } from "./campanhasApi";
import {
  calcularLinhaDoTempo,
  configDaLinha,
  type FaseDaLinha,
  type LinhaDoTempo,
} from "../../../supabase/functions/agente-calendario/modulos/linha-do-tempo";
import { esquemaDaCampanha, ESQUEMAS_DE_CAMPANHA } from "../../../supabase/functions/agente-calendario/modulos/esquemas-de-campanha";

/**
 * Linha do tempo da campanha (22/10/2026, dono: "início, meio e fim, e já com as datas certas"): as fases com
 * as datas, calculadas em código (linha-do-tempo.ts). Na criação, "Data do evento", "Começar X dias antes" e
 * "Terminar em", com a prévia em que se arrasta o início e o fim. Na campanha, a linha gravada e "Reorganizar
 * datas e fases" (mudança planejada no agente: nada muda sem Confirmar).
 */

const COR_DA_FASE: Record<FaseDaLinha, string> = {
  aquecimento: "bg-primary/25",
  lancamento: "bg-primary/80",
  sustentacao: "bg-primary/50",
  urgencia: "bg-warning/70",
  encerramento: "bg-destructive/60",
};

const curta = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;

/** A barra com as fases; com onInicio/onFim, as pontas se arrastam (ou setas do teclado, um dia por vez). */
export function BarraDaLinha({ linha, onInicio, onFim }: { linha: LinhaDoTempo; onInicio?: (d: string) => void; onFim?: (d: string) => void }) {
  const barra = useRef<HTMLDivElement>(null);
  // A escala fica parada enquanto arrasta (do evento menos 30 dias até o fim mais 10).
  const [escala, setEscala] = useState<{ de: string; ate: string } | null>(null);
  const de = escala ? escala.de : onInicio ? somarDiasIso(linha.evento, -Math.max(30, linha.dias_antes + 5)) : linha.inicio;
  const ate = escala ? escala.ate : onFim ? somarDiasIso(linha.fim > linha.evento ? linha.fim : linha.evento, 10) : linha.fim;
  const total = Math.max(1, diasEntreIso(de, ate) + 1);
  const pos = (d: string) => (Math.max(0, Math.min(total, diasEntreIso(de, d))) / total) * 100;
  const diaNoPonto = (x: number) => {
    const r = barra.current ? barra.current.getBoundingClientRect() : null;
    if (!r || !r.width) return null;
    const frac = Math.max(0, Math.min(1, (x - r.left) / r.width));
    return somarDiasIso(de, Math.round(frac * (total - 1)));
  };
  const arrastar = (ponta: "inicio" | "fim") => (e: EventoDoPonteiro<HTMLButtonElement>) => {
    const fn = ponta === "inicio" ? onInicio : onFim;
    if (!fn) return;
    e.preventDefault();
    setEscala({ de, ate });
    const mover = (ev: PointerEvent) => {
      const d = diaNoPonto(ev.clientX);
      if (d) fn(d);
    };
    const soltar = () => {
      window.removeEventListener("pointermove", mover);
      window.removeEventListener("pointerup", soltar);
      setEscala(null);
    };
    window.addEventListener("pointermove", mover);
    window.addEventListener("pointerup", soltar);
  };
  const teclas = (ponta: "inicio" | "fim") => (e: KeyboardEvent<HTMLButtonElement>) => {
    const fn = ponta === "inicio" ? onInicio : onFim;
    if (!fn) return;
    const passo = e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : 0;
    if (!passo) return;
    e.preventDefault();
    fn(somarDiasIso(ponta === "inicio" ? linha.inicio : linha.fim, passo));
  };
  return (
    <div className="min-w-0" data-barra-da-linha="">
      <div ref={barra} className="relative h-7 w-full min-w-0 rounded-md bg-muted" aria-hidden={!onInicio && !onFim}>
        {linha.fases.map((f) => (
          <span
            key={f.fase}
            className={juntar("absolute bottom-0 top-0", COR_DA_FASE[f.fase])}
            style={{ left: `${pos(f.inicio)}%`, width: `${Math.max(0.8, pos(somarDiasIso(f.fim, 1)) - pos(f.inicio))}%` }}
            title={`${f.nome}: ${curta(f.inicio)}${f.fim !== f.inicio ? ` a ${curta(f.fim)}` : ""}`}
            data-fase={f.fase}
          />
        ))}
        <span className="absolute bottom-0 top-0 w-0.5 bg-foreground" style={{ left: `${pos(linha.evento)}%` }} title={`Evento: ${curta(linha.evento)}`} data-evento="" />
        {onInicio && (
          <button
            type="button"
            role="slider"
            aria-label="Arrastar o início"
            title="Arraste o início (ou use as setas)"
            aria-valuetext={curta(linha.inicio)}
            aria-valuenow={diasEntreIso(de, linha.inicio)}
            onPointerDown={arrastar("inicio")}
            onKeyDown={teclas("inicio")}
            className="absolute -top-1 bottom-[-4px] w-3 -translate-x-1/2 cursor-ew-resize touch-none rounded-sm border border-background bg-foreground"
            style={{ left: `${pos(linha.inicio)}%` }}
            data-ponta="inicio"
          />
        )}
        {onFim && (
          <button
            type="button"
            role="slider"
            aria-label="Arrastar o fim"
            title="Arraste o fim (ou use as setas)"
            aria-valuetext={curta(linha.fim)}
            aria-valuenow={diasEntreIso(de, linha.fim)}
            onPointerDown={arrastar("fim")}
            onKeyDown={teclas("fim")}
            className="absolute -top-1 bottom-[-4px] w-3 -translate-x-1/2 cursor-ew-resize touch-none rounded-sm border border-background bg-foreground"
            style={{ left: `${pos(somarDiasIso(linha.fim, 1))}%` }}
            data-ponta="fim"
          />
        )}
      </div>
      <div className="mt-1 flex min-w-0 justify-between text-[11px] text-muted-foreground">
        <span data-inicio={linha.inicio}>{curta(linha.inicio)}</span>
        <span>evento {curta(linha.evento)}</span>
        <span data-fim={linha.fim}>{curta(linha.fim)}</span>
      </div>
    </div>
  );
}

/** As fases em lista (nome, datas e o que cada uma faz) e os avisos. */
export function FasesDaLinha({ linha }: { linha: LinhaDoTempo }) {
  return (
    <div className="min-w-0">
      <ol className="mt-2 space-y-1" aria-label="Fases da linha do tempo">
        {linha.fases.map((f) => (
          <li key={f.fase} className="flex min-w-0 items-start text-[12px]" data-fase-da-linha={f.fase}>
            <span className={juntar("mr-2 mt-1 h-2.5 w-2.5 shrink-0 rounded-sm", COR_DA_FASE[f.fase])} aria-hidden="true" />
            <span className="min-w-0 flex-1">
              <span className="font-medium">{f.nome}</span>
              <span className="text-muted-foreground"> · {curta(f.inicio)}{f.fim !== f.inicio ? ` a ${curta(f.fim)}` : ""} · {f.dias} {f.dias === 1 ? "dia" : "dias"}</span>
            </span>
          </li>
        ))}
      </ol>
      {linha.avisos.length > 0 && (
        <ul className="mt-2 space-y-1" aria-label="Avisos da linha do tempo">
          {linha.avisos.map((a) => (
            <li key={a} className="flex min-w-0 items-start text-[12px] text-warning">
              <TriangleAlert className="mr-1.5 mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="min-w-0">{a}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export interface DatasDaNova {
  evento: string;
  diasAntes: number;
  /** Null: o fim automático do tipo (o dia do evento ou depois, como Black Week e Cyber Monday). */
  fim: string | null;
}

/** A linha prevista na tela (a mesma conta do servidor). */
export function linhaPrevista(d: DatasDaNova, esquema: string, hoje = hojeIso()): LinhaDoTempo {
  return calcularLinhaDoTempo({ esquema, evento: d.evento, diasAntes: d.diasAntes, fim: d.fim, hoje });
}

/** O esquema pela ocasião escrita (nome, pedido e tipo). */
export const esquemaDaNova = (textoDaCampanha: string, tipo?: string | null) => esquemaDaCampanha(textoDaCampanha, tipo || null).id;

/** Na criação: data do evento, começar X dias antes, terminar em e a prévia com as pontas para arrastar. */
export function EditorDaLinha({ datas, onDatas, esquema, desabilitado }: { datas: DatasDaNova; onDatas: (d: DatasDaNova) => void; esquema: string; desabilitado?: boolean }) {
  const linha = linhaPrevista(datas, esquema);
  const cfg = configDaLinha(esquema);
  const rotuloDoTipo = (ESQUEMAS_DE_CAMPANHA.filter((e) => e.id === esquema)[0] || { rotulo: "Promoção" }).rotulo;
  return (
    <div className="min-w-0" data-editor-da-linha="">
      <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-3">
        <label className="block min-w-0 text-[12px] font-medium text-muted-foreground">
          Data do evento
          <Input type="date" value={datas.evento} disabled={desabilitado} onChange={(e) => e.target.value && onDatas({ ...datas, evento: e.target.value, fim: datas.fim && datas.fim < e.target.value ? null : datas.fim })} className="mt-1 h-9 min-w-0" aria-label="Data do evento" />
        </label>
        <label className="block min-w-0 text-[12px] font-medium text-muted-foreground">
          Começar quantos dias antes
          <Input type="number" min={0} max={60} value={datas.diasAntes} disabled={desabilitado} onChange={(e) => onDatas({ ...datas, diasAntes: Math.max(0, Math.min(60, Math.round(Number(e.target.value) || 0))) })} className="mt-1 h-9 min-w-0" aria-label="Dias antes do evento" />
        </label>
        <label className="block min-w-0 text-[12px] font-medium text-muted-foreground">
          Terminar em
          <Input type="date" value={linha.fim} min={datas.evento} disabled={desabilitado} onChange={(e) => e.target.value && onDatas({ ...datas, fim: e.target.value })} className="mt-1 h-9 min-w-0" aria-label="Fim da campanha" />
        </label>
      </div>
      {datas.diasAntes !== cfg.diasAntes && (
        <button type="button" disabled={desabilitado} onClick={() => onDatas({ ...datas, diasAntes: cfg.diasAntes, fim: null })} className="mt-2 text-[12px] text-primary hover:underline">
          Usar o padrão de {rotuloDoTipo}: começar {cfg.diasAntes} dias antes
        </button>
      )}
      <div className="mt-3 min-w-0" aria-label="Prévia da linha do tempo">
        <BarraDaLinha
          linha={linha}
          onInicio={desabilitado ? undefined : (d) => onDatas({ ...datas, diasAntes: Math.max(0, Math.min(60, diasEntreIso(d, datas.evento))) })}
          onFim={desabilitado ? undefined : (d) => onDatas({ ...datas, fim: d < datas.evento ? datas.evento : d })}
        />
        <FasesDaLinha linha={linha} />
      </div>
    </div>
  );
}

/** A linha gravada da campanha; sem ela (campanha antiga), a conta pelo período de agora. */
export function linhaDaCampanha(c: Pick<Campanha, "nome" | "pedido" | "periodo_inicio" | "periodo_fim" | "briefing">): LinhaDoTempo | null {
  const b = normalizarBriefing(c.briefing);
  if (b.linha_do_tempo) return b.linha_do_tempo;
  if (!c.periodo_inicio || !c.periodo_fim) return null;
  const esquema = b.esquema || esquemaDaNova(`${c.nome} ${c.pedido || ""}`);
  return calcularLinhaDoTempo({ esquema, evento: c.periodo_fim, inicio: c.periodo_inicio, fim: c.periodo_fim, hoje: c.periodo_inicio });
}

/** Na campanha: a linha, as datas para mudar e "Reorganizar datas e fases" (o diff aparece no agente). */
export default function CampanhaLinhaDoTempo({ campanha, onAbrirAgente }: { campanha: Campanha; onAbrirAgente?: () => void }) {
  const { clientId, catalogo } = useMesa();
  const qc = useQueryClient();
  const gravada = linhaDaCampanha(campanha);
  const b = normalizarBriefing(campanha.briefing);
  const esquema = (gravada && gravada.esquema) || b.esquema || esquemaDaNova(`${campanha.nome} ${campanha.pedido || ""}`);
  const [datas, setDatas] = useState<DatasDaNova | null>(null);
  const prevista = datas ? linhaPrevista(datas, esquema) : null;
  const mostrada = prevista || gravada;
  if (!mostrada) return <p className={texto.auxiliar}>Sem período: escolha a data do evento para calcular as fases.</p>;
  const iniciar = () => setDatas({ evento: mostrada.evento, diasAntes: mostrada.dias_antes, fim: mostrada.fim > mostrada.evento ? mostrada.fim : null });
  return (
    <div className="min-w-0" data-linha-da-campanha={datas ? "editando" : "gravada"}>
      {datas ? (
        <EditorDaLinha datas={datas} onDatas={setDatas} esquema={esquema} />
      ) : (
        <>
          <BarraDaLinha linha={mostrada} />
          <FasesDaLinha linha={mostrada} />
        </>
      )}
      <div className="mt-3 flex min-w-0 flex-wrap items-center">
        {!datas && (
          <button type="button" onClick={iniciar} className="mb-1 mr-3 inline-flex items-center text-[12px] text-primary hover:underline">
            <CalendarRange className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
            Mudar o evento ou o início
          </button>
        )}
        {datas && (
          <button type="button" onClick={() => setDatas(null)} className="mb-1 mr-3 text-[12px] text-muted-foreground hover:underline">
            Cancelar
          </button>
        )}
        <BotaoComCusto
          rotulo="Reorganizar datas e fases"
          titulo="Reorganizar a campanha"
          descricao="Recalcula as fases pelas datas, redistribui as peças não aprovadas e cria a introdução e o encerramento que faltarem; você confere o diff no agente e confirma"
          partes={() => partesDaReorganizacao(catalogo)}
          executar={async () => {
            const r = await reorganizarCampanha(campanha.id, datas ? { dataEvento: datas.evento, diasAntes: datas.diasAntes, fim: prevista ? prevista.fim : null } : {});
            await qc.invalidateQueries({ queryKey: chavesDaCampanha.conversa(clientId, campanha.id) });
            setDatas(null);
            if (onAbrirAgente) onAbrirAgente();
            toast.info("Reorganização planejada", { description: "Confira as datas e as peças no agente da campanha e confirme." });
            return r;
          }}
          variant="outline"
          className="mb-1 h-8"
        />
      </div>
    </div>
  );
}
