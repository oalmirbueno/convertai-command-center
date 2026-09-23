import { useState } from "react";
import { Link } from "react-router-dom";
import { CalendarCheck, Copy, Loader2, RotateCcw, ZoomIn } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { dataEHora, textoDoErro } from "@/lib/mesa/api";
import { Ampliar } from "./Ampliar";
import { QuadroQueCabe } from "./EstudioLaminaGrande";
import { ImagemDaMesa } from "./MesaContexto";
import { copiarTexto } from "./estudioUtil";
import { fonteDoArquivo, useLaminasDaAgenda, type ArteNaAgenda, type PublicacaoDoPost } from "./useItensDoMes";

/**
 * Item que já tem arte na Agenda sem trabalho do estúdio (pedido do dono em
 * 23/09: "já tem conteúdo com arte dentro da agenda e ali ele puxa sem
 * direção como se não tivesse conteúdo"). O centro mostra as lâminas que já
 * existem (arquivo principal e filhos do carrossel, na ordem da Agenda), com
 * a lâmina grande e o Ampliar. Refazer no Estúdio é explícito e pede uma
 * confirmação leve, ali mesmo.
 */

const LARGURA_DA_MINIATURA = 96;

export default function EstudioArteDaAgenda({
  arte,
  linkAgenda,
  onRefazer,
  soPelaLargura,
}: {
  arte: ArteNaAgenda;
  linkAgenda: string;
  onRefazer: () => void;
  soPelaLargura?: boolean;
}) {
  const laminas = useLaminasDaAgenda(arte.capa);
  const [selecionada, setSelecionada] = useState(0);
  const [ampliada, setAmpliada] = useState<number | null>(null);
  const [confirmando, setConfirmando] = useState(false);
  const lista = laminas.data || (arte.capa ? [arte.capa] : []);
  const atual = lista[Math.min(selecionada, Math.max(0, lista.length - 1))] || null;
  const imagens = lista.map((a, i) => {
    const f = fonteDoArquivo(a);
    return { caminho: f.caminho || "", bucket: f.bucket, titulo: `Lâmina ${i + 1} de ${lista.length}` };
  });

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="flex min-w-0 flex-wrap items-center">
        <p className="mb-2 mr-3 min-w-0 flex-1 text-[13px] font-semibold">
          Arte já na Agenda
          <span className="font-normal text-muted-foreground">
            {" "}· {lista.length} lâmina{lista.length === 1 ? "" : "s"}
            {arte.do_estudio ? " · entregue pelo Estúdio" : ""}
          </span>
        </p>
        <div className="mb-2 flex shrink-0 items-center">
          <Button asChild size="sm" variant="outline" className="mr-2 h-9">
            <Link to={linkAgenda}>
              <CalendarCheck className="mr-1.5 h-3.5 w-3.5" /> Abrir na Agenda
            </Link>
          </Button>
          {!confirmando && (
            <Button type="button" size="sm" variant="ghost" className="h-9" onClick={() => setConfirmando(true)}>
              <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Refazer no Estúdio
            </Button>
          )}
        </div>
      </div>

      {confirmando && (
        <div className="mb-3 flex flex-col rounded-lg border border-warning/50 bg-background p-3 sm:flex-row sm:items-center">
          <p className="mb-2 min-w-0 flex-1 text-[12.5px] leading-snug sm:mb-0 sm:mr-3">
            Fazer uma arte nova para este item? A arte atual continua na Agenda até a nova ser entregue.
          </p>
          <div className="flex shrink-0 items-center">
            <Button type="button" size="sm" variant="ghost" className="mr-1 h-9" onClick={() => setConfirmando(false)}>
              Manter a atual
            </Button>
            <Button type="button" size="sm" className="h-9" onClick={() => { setConfirmando(false); onRefazer(); }}>
              Sim, refazer
            </Button>
          </div>
        </div>
      )}

      {laminas.isLoading && !lista.length && (
        <p className="text-[12.5px] text-muted-foreground"><Loader2 className="mr-1.5 inline h-4 w-4 animate-spin" />Lendo as lâminas…</p>
      )}
      {laminas.isError && <p className="mb-2 rounded-lg bg-destructive/10 p-2.5 text-[12px] [overflow-wrap:anywhere]">{textoDoErro(laminas.error)}</p>}

      {lista.length > 1 && (
        <div className="mb-3 min-w-0 overflow-x-auto pb-1">
          <ul className="inline-flex" aria-label="Lâminas da arte na Agenda">
            {lista.map((a, i) => {
              const f = fonteDoArquivo(a);
              return (
                <li key={a.id} className="mr-2 shrink-0" style={{ width: LARGURA_DA_MINIATURA }}>
                  <button
                    type="button"
                    onClick={() => setSelecionada(i)}
                    onDoubleClick={() => setAmpliada(i)}
                    aria-pressed={selecionada === i}
                    aria-label={`Lâmina ${i + 1}`}
                    className={`block w-full overflow-hidden rounded-md border bg-secondary ${selecionada === i ? "border-primary ring-2 ring-primary" : "border-border hover:border-primary/60"}`}
                    style={{ height: Math.round(LARGURA_DA_MINIATURA * 1.25) }}
                  >
                    <ImagemDaMesa caminho={f.caminho} bucket={f.bucket} alt={`Lâmina ${i + 1}`} className="h-full w-full" />
                  </button>
                  <p className={`mt-1 text-center text-[11px] tabular-nums ${selecionada === i ? "font-semibold text-primary" : "text-muted-foreground"}`}>{i + 1}</p>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {atual && (
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="mb-2 flex h-8 shrink-0 items-center">
            <p className="min-w-0 flex-1 truncate text-[12.5px] text-muted-foreground">
              Lâmina {Math.min(selecionada, lista.length - 1) + 1} de {lista.length}
            </p>
            <Button type="button" size="sm" variant="ghost" className="h-8 px-2 text-[12px]" onClick={() => setAmpliada(Math.min(selecionada, lista.length - 1))}>
              <ZoomIn className="mr-1 h-3.5 w-3.5" /> Ver grande
            </Button>
          </div>
          <QuadroQueCabe soPelaLargura={soPelaLargura}>
            {() => {
              const f = fonteDoArquivo(atual);
              return (
                <button type="button" onDoubleClick={() => setAmpliada(Math.min(selecionada, lista.length - 1))} className="block h-full w-full cursor-zoom-in" aria-label="Duplo clique para ver grande">
                  <ImagemDaMesa caminho={f.caminho} bucket={f.bucket} alt="Arte na Agenda" className="h-full w-full" />
                </button>
              );
            }}
          </QuadroQueCabe>
        </div>
      )}

      <Ampliar imagens={imagens.filter((i) => !!i.caminho)} indice={ampliada} onFechar={() => setAmpliada(null)} />
    </div>
  );
}

/** Inspetor do item com arte na Agenda: o post, a data e a legenda para copiar. */
export function InspetorDaArte({ arte, publicacao, linkAgenda }: { arte: ArteNaAgenda; publicacao: PublicacaoDoPost | null; linkAgenda: string }) {
  const copiar = async () => {
    const ok = await copiarTexto(arte.legenda || "");
    if (ok) toast.success("Legenda copiada");
    else toast.error("Não foi possível copiar", { description: "Selecione o texto e copie à mão." });
  };
  const quando = publicacao?.published_at || publicacao?.scheduled_at || null;
  return (
    <div className="min-w-0 space-y-4">
      <div>
        <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Post na Agenda</p>
        <p className="mt-1 text-[14px] font-semibold leading-snug [overflow-wrap:anywhere]">{arte.titulo || "Sem título"}</p>
        <p className="mt-1 text-[12px] text-muted-foreground">
          {publicacao?.status === "published" ? "Publicado" : quando ? "Agendado" : "Sem data de publicação"}
          {quando ? ` · ${dataEHora(quando)}` : ""}
        </p>
        {publicacao?.permalink && (
          <a href={publicacao.permalink} target="_blank" rel="noreferrer" className="mt-1 inline-block text-[12px] text-primary underline-offset-2 hover:underline">
            Ver publicado
          </a>
        )}
      </div>
      <div>
        <div className="mb-1.5 flex min-h-7 items-center">
          <p className="flex-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Legenda do post</p>
          {arte.legenda && (
            <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-[11.5px]" onClick={() => void copiar()}>
              <Copy className="mr-1 h-3 w-3" /> Copiar
            </Button>
          )}
        </div>
        <p className="whitespace-pre-wrap rounded-lg border border-border bg-background px-3 py-2.5 text-[12.5px] leading-relaxed [overflow-wrap:anywhere]">
          {arte.legenda || "Sem legenda no post."}
        </p>
      </div>
      <Button asChild variant="outline" className="h-10 w-full">
        <Link to={linkAgenda}>
          <CalendarCheck className="mr-1.5 h-4 w-4" /> Abrir na Agenda
        </Link>
      </Button>
    </div>
  );
}
