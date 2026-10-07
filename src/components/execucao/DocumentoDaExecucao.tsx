import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { prepararEntrada, type AnexoDoCaderno } from "@/lib/cadernoExecucao";
import EvidenciaVisual from "./EvidenciaVisual";

/** Uma mesma leitura para o card, a conversa e o relatório. Não reescreve a fonte. */
export default function DocumentoDaExecucao({ texto, anexos = [], compacto = false }: { texto: string; anexos?: AnexoDoCaderno[]; compacto?: boolean }) {
  const documento = prepararEntrada(texto, anexos);
  const corpo = <>
    <div className="prose prose-sm dark:prose-invert max-w-none break-words text-sm leading-7 prose-p:my-3 prose-headings:mb-2 prose-headings:mt-5 prose-li:my-1">
      <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml components={{
        a: ({ href, children }) => href ? <a href={/^https:\/\//.test(href) ? href : undefined} target="_blank" rel="noopener noreferrer">{children}</a> : <span>{children}</span>,
      }}>{documento.texto}</ReactMarkdown>
    </div>
    {documento.anexos.length > 0 && <div className="mt-3 grid gap-3">{documento.anexos.map(a => <EvidenciaVisual key={a.url} url={a.url!} nome={a.name || "Abrir relatório"} />)}</div>}
  </>;
  return <div className="min-w-0 [overflow-wrap:anywhere]">
    {compacto && documento.texto.length > 420 ? <details className="group"><summary className="cursor-pointer text-sm leading-6"><span className="line-clamp-3 group-open:hidden">{documento.texto.slice(0, 250)}…</span><span className="text-xs text-primary">Ler atualização completa</span></summary>{corpo}</details> : corpo}
    {documento.temDetalhes && <details className="mt-3 text-xs text-muted-foreground"><summary className="cursor-pointer">Registro original</summary><pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words font-sans leading-6">{texto}</pre></details>}
  </div>;
}
