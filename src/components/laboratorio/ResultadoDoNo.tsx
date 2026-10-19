import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Clock, ExternalLink, Loader2, Maximize2, PauseCircle } from "lucide-react";
import { JanelaCentral, botao, etiqueta, juntar, texto } from "@/components/sistema";
import { enderecosAssinados, lerHtmlSalvo } from "@/lib/laboratorio/arquivos";
import type { ExecucaoDoLab, ImagemDoLab, StatusDaExecucao } from "@/lib/laboratorio/api";

/**
 * O resultado no próprio nó: estado com cor, texto resumido, miniaturas,
 * prévia da landing (iframe sandbox do arquivo salvo) e, na logo, a escolha
 * do Jev com o motivo.
 */

export const ESTADOS: Record<StatusDaExecucao, { rotulo: string; classe: string; borda: string }> = {
  na_fila: { rotulo: "Na fila", classe: "bg-amber-500/15 text-amber-700 dark:text-amber-300", borda: "#f59e0b" },
  rodando: { rotulo: "Rodando", classe: "bg-sky-500/15 text-sky-700 dark:text-sky-300", borda: "#0ea5e9" },
  pronto: { rotulo: "Pronto", classe: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300", borda: "#10b981" },
  erro: { rotulo: "Erro", classe: "bg-destructive/15 text-destructive", borda: "#ef4444" },
  aguardando: { rotulo: "Aguardando", classe: "bg-violet-500/15 text-violet-700 dark:text-violet-300", borda: "#8b5cf6" },
};

export const emAndamento = (s: StatusDaExecucao | string | null | undefined) => s === "na_fila" || s === "rodando" || s === "aguardando";

export function EstadoDoNo({ status }: { status: StatusDaExecucao }) {
  const e = ESTADOS[status];
  const I = status === "pronto" ? CheckCircle2 : status === "erro" ? AlertTriangle : status === "rodando" ? Loader2 : status === "aguardando" ? PauseCircle : Clock;
  return (
    <span className={juntar(etiqueta, e.classe)} data-estado-do-no={status}>
      <I className={juntar("mr-1 h-3 w-3", status === "rodando" && "animate-spin")} aria-hidden="true" />
      {e.rotulo}
    </span>
  );
}

/** Endereços das imagens: usa a url que veio; sem url, assina o caminho no bucket workspace. */
export function useImagens(imagens: ImagemDoLab[]): string[] {
  const chave = imagens.map((i) => i.url || i.path).join("|");
  const [assinadas, setAssinadas] = useState<Record<string, string>>({});
  useEffect(() => {
    const faltam = imagens.filter((i) => !i.url && i.path).map((i) => i.path);
    if (!faltam.length) return;
    let vivo = true;
    enderecosAssinados(faltam)
      .then((r) => {
        if (vivo) setAssinadas(r);
      })
      .catch(() => undefined);
    return () => {
      vivo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave]);
  return imagens.map((i) => i.url || assinadas[i.path] || "");
}

export function Miniaturas({ imagens, escolhida, max = 4 }: { imagens: ImagemDoLab[]; escolhida?: number | null; max?: number }) {
  const urls = useImagens(imagens);
  if (!imagens.length) return null;
  return (
    <div className="grid min-w-0 grid-cols-4 gap-1" data-miniaturas="">
      {urls.slice(0, max).map((u, i) => (
        <span key={i} className={juntar("block h-12 overflow-hidden rounded bg-muted", escolhida === i && "ring-2 ring-primary")} data-escolhida={escolhida === i ? "" : undefined}>
          {u ? <img src={u} alt={`Imagem ${i + 1}`} className="h-full w-full object-cover" loading="lazy" /> : null}
        </span>
      ))}
    </div>
  );
}

/** Prévia da landing: o HTML salvo num iframe sem mesma origem (scripts só para o Tailwind por CDN). */
export function PreviaDaLanding({ caminho, url, alta = false }: { caminho: string; url: string; alta?: boolean }) {
  const [html, setHtml] = useState<string | null>(null);
  const [erro, setErro] = useState(false);
  useEffect(() => {
    if (!caminho) return;
    let vivo = true;
    lerHtmlSalvo(caminho)
      .then((t) => {
        if (vivo) setHtml(t);
      })
      .catch(() => {
        if (vivo) setErro(true);
      });
    return () => {
      vivo = false;
    };
  }, [caminho]);
  if (!caminho && !url) return null;
  if (erro) return <p className={texto.auxiliar}>Não deu para abrir a prévia.</p>;
  return (
    <iframe
      title="Prévia da landing"
      sandbox="allow-scripts"
      {...(html !== null ? { srcDoc: html } : caminho ? {} : { src: url })}
      className={juntar("w-full rounded border border-border bg-white", alta ? "h-[70vh]" : "pointer-events-none h-32")}
      data-previa-da-landing=""
    />
  );
}

export default function ResultadoDoNo({ execucao, compacto = true }: { execucao: ExecucaoDoLab | null | undefined; compacto?: boolean }) {
  const [grande, setGrande] = useState(false);
  if (!execucao) return null;
  const s = execucao.saida;
  return (
    <div className="mt-2 min-w-0 space-y-1.5" data-resultado-do-no={execucao.no_id}>
      {execucao.status === "erro" && execucao.erro ? <p className={juntar(texto.auxiliar, "text-destructive")}>{execucao.erro}</p> : null}
      {s.texto ? <p className={juntar(texto.auxiliar, "whitespace-pre-wrap text-foreground", compacto && "line-clamp-3")}>{s.texto}</p> : null}
      {s.imagens.length ? <Miniaturas imagens={s.imagens} escolhida={s.escolha ? s.escolha.indice : null} /> : null}
      {s.escolha ? (
        <p className={juntar(texto.auxiliar, compacto && "line-clamp-2")} data-escolha-do-jev="">
          <span className="font-medium text-foreground">Jev escolheu a {s.escolha.indice + 1}ª:</span> {s.escolha.motivo}
        </p>
      ) : null}
      {s.aviso_jev ? <p className={juntar(texto.auxiliar, "text-warning", compacto && "line-clamp-2")}>{s.aviso_jev}</p> : null}
      {s.html_path || s.html_url ? (
        <div className="relative min-w-0">
          <PreviaDaLanding caminho={s.html_path} url={s.html_url} />
          <button type="button" className={juntar(botao.icone, "nodrag absolute right-1 top-1 h-7 w-7 bg-background/90")} onClick={() => setGrande(true)} aria-label="Abrir a prévia grande" title="Abrir a prévia grande">
            <Maximize2 className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
          <JanelaCentral aberta={grande} onFechar={() => setGrande(false)} titulo="Prévia da landing" largura="tela" semEspaco>
            {grande ? <PreviaDaLanding caminho={s.html_path} url={s.html_url} alta /> : null}
          </JanelaCentral>
        </div>
      ) : null}
      {s.json ? (
        <p className={juntar(texto.auxiliar, "line-clamp-2")}>
          {String((s.json as any).titulo || (Array.isArray((s.json as any).titulos) ? (s.json as any).titulos[0] : "") || "Pacote pronto")} · nasce pausado
        </p>
      ) : null}
      {s.tarefa_url || s.tarefa_id ? (
        <a className={juntar(texto.auxiliar, "nodrag inline-flex items-center text-primary hover:underline")} href={s.tarefa_url || `/execucao?tarefa=${s.tarefa_id}`} target="_blank" rel="noreferrer">
          <ExternalLink className="mr-1 h-3 w-3" aria-hidden="true" />
          Tarefa no Kanban
        </a>
      ) : null}
    </div>
  );
}
