import { useMemo, useState } from "react";
import { CircleAlert, FileSearch, X } from "lucide-react";
import BlocosDeResposta from "@/components/agentes/respostas/BlocosDeResposta";
import TextoFormatado from "@/components/agentes/respostas/TextoFormatado";
import { juntar, superficie } from "@/components/sistema";
import { separarResposta, type ParteDaResposta } from "../../../../supabase/functions/_shared/resposta-em-partes";
import { objetoValido, type ObjetoAberto } from "@/lib/centralObjetos";

/**
 * Resposta de agente em partes (09/10/2026): o mesmo jeito de mostrar do
 * Gestor para quem responde em texto (Hermes hoje, agentes das Mesas no
 * lote B). Balões curtos (sem bloco gigante) e quadros validados pelo
 * registro comum (fluxo, gráfico, métricas, tabela, progresso, entrega).
 * Fonte de quadro é clicável e abre a evidência (a saída real da ferramenta).
 *
 * `partes` vem pronta do servidor (validada lá, com as fontes do turno);
 * sem ela, a tela separa o texto aqui, e número sem fonte não vira quadro.
 */

export const BALAO_DO_AGENTE = "w-fit min-w-0 max-w-[92%] rounded-[20px] rounded-tl-md bg-muted/70 px-4 py-2.5 text-[14px] leading-relaxed text-foreground sm:max-w-[85%]";

export default function RespostaEmPartes({ texto, partes, recusados, evidencias, aoAbrirObjeto, classeDoBalao = BALAO_DO_AGENTE }: {
  texto: string;
  partes?: ParteDaResposta[] | null;
  recusados?: string[] | null;
  /** Fonte (nome da ferramenta) → o que ela devolveu no turno. */
  evidencias?: Record<string, string> | null;
  aoAbrirObjeto?: (o: ObjetoAberto) => void;
  classeDoBalao?: string;
}) {
  const [fonteAberta, setFonteAberta] = useState<string | null>(null);
  const r = useMemo(() => (partes && partes.length ? { partes, recusados: recusados || [] } : separarResposta(texto)), [partes, recusados, texto]);
  return (
    <div className="flex w-full min-w-0 flex-col items-start gap-1.5" data-resposta-em-partes="">
      {r.partes.map((p, i) => p.tipo === "texto" ? (
        <div key={`t-${i}`} className={classeDoBalao}><TextoFormatado texto={p.texto} /></div>
      ) : (
        <div key={`b-${i}`} className="my-1 w-full max-w-[640px]" data-blocos-da-resposta="">
          <BlocosDeResposta
            blocos={p.blocos}
            aoAbrirObjeto={(o) => { const v = objetoValido(o); if (v && aoAbrirObjeto) aoAbrirObjeto(v); }}
            aoAbrirFonte={(f) => setFonteAberta(fonteAberta === f ? null : f)}
          />
        </div>
      ))}
      {fonteAberta && (
        <div className={juntar(superficie.painel, "w-full max-w-[640px] p-3 text-[12px]")} data-evidencia="">
          <div className="flex items-center gap-1.5">
            <FileSearch className="h-3.5 w-3.5 shrink-0 text-primary" />
            <p className="min-w-0 flex-1 truncate font-medium">Evidência: {fonteAberta}</p>
            <button type="button" onClick={() => setFonteAberta(null)} aria-label="Fechar a evidência" className="flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"><X className="h-3.5 w-3.5" /></button>
          </div>
          {evidencias && evidencias[fonteAberta] !== undefined ? (
            <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/50 p-2 font-mono text-[11px] text-foreground/85">{evidencias[fonteAberta]}</pre>
          ) : <p className="mt-1 text-muted-foreground">A saída desta ferramenta não veio junto da sessão.</p>}
        </div>
      )}
      {r.recusados.length > 0 && (
        <p className="flex items-center gap-1.5 px-1 text-[11px] text-muted-foreground" title={r.recusados.join(" · ")}>
          <CircleAlert className="h-3.5 w-3.5 shrink-0 text-warning" />{r.recusados.length === 1 ? "1 quadro ficou de fora" : `${r.recusados.length} quadros ficaram de fora`} (sem fonte verificável)
        </p>
      )}
    </div>
  );
}
