import type { ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { Link, useInRouterContext } from "react-router-dom";
import { conversa, juntar, superficie } from "@/components/sistema/estilos";

/**
 * Texto de agente em markdown (o Hermes responde assim), desenhado com
 * segurança: HTML cru é descartado (skipHtml), link só abre se for http ou
 * https (nova aba, rel="noopener noreferrer") ou rota do próprio painel
 * (mesma aba, pelo roteador), imagem só https e sem enviar
 * referer. Tabela rola por dentro na horizontal; código em bloco também.
 * Tamanho da conversa (14 px) em todo agente.
 */

const ehLinkWeb = (href: unknown): href is string => typeof href === "string" && /^https?:\/\//i.test(href.trim());
/** Rota do próprio painel ("/mesa-ads?client=..."), nunca "//host". */
const ehRotaInterna = (href: unknown): href is string => typeof href === "string" && /^\/[^/\\]/.test(href.trim());

const CLASSE_DO_LINK = "font-medium text-primary underline underline-offset-2 hover:no-underline";

function LinkInterno({ para, children }: { para: string; children?: ReactNode }) {
  const noRoteador = useInRouterContext();
  return noRoteador ? <Link to={para} className={CLASSE_DO_LINK}>{children}</Link> : <a href={para} className={CLASSE_DO_LINK}>{children}</a>;
}

const ehHttps = (src: unknown): src is string => typeof src === "string" && /^https:\/\//i.test(src.trim());

function Titulo({ nivel, children }: { nivel: number; children?: ReactNode }) {
  return (
    <div role="heading" aria-level={nivel} className={juntar("font-semibold text-foreground", nivel <= 2 ? "text-[15px] leading-[22px]" : "text-[14px]")}>
      {children}
    </div>
  );
}

const componentes: Components = {
  h1: ({ children }) => <Titulo nivel={1}>{children}</Titulo>,
  h2: ({ children }) => <Titulo nivel={2}>{children}</Titulo>,
  h3: ({ children }) => <Titulo nivel={3}>{children}</Titulo>,
  h4: ({ children }) => <Titulo nivel={4}>{children}</Titulo>,
  h5: ({ children }) => <Titulo nivel={5}>{children}</Titulo>,
  h6: ({ children }) => <Titulo nivel={6}>{children}</Titulo>,
  p: ({ children }) => <p className="min-w-0">{children}</p>,
  a: ({ href, children }) =>
    ehRotaInterna(href) ? <LinkInterno para={href.trim()}>{children}</LinkInterno> : ehLinkWeb(href) ? (
      <a href={href} target="_blank" rel="noopener noreferrer" className="font-medium text-primary underline underline-offset-2 hover:no-underline">
        {children}
      </a>
    ) : (
      <span>{children}</span>
    ),
  img: ({ src, alt }) =>
    ehHttps(src) ? (
      <img src={src} alt={alt || ""} loading="lazy" referrerPolicy="no-referrer" className="my-1 block max-h-[320px] max-w-full rounded-md" />
    ) : alt ? (
      <span className="text-muted-foreground">{alt}</span>
    ) : null,
  ul: ({ children }) => <ul className="list-disc space-y-1 pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal space-y-1 pl-5">{children}</ol>,
  li: ({ children }) => <li className="min-w-0 pl-0.5">{children}</li>,
  blockquote: ({ children }) => <blockquote className="space-y-2 border-l-2 border-border pl-3 text-muted-foreground">{children}</blockquote>,
  hr: () => <hr className={juntar(superficie.divisoria, "my-1 border-0")} />,
  pre: ({ children }) => (
    <pre className={juntar(superficie.poco, "overflow-x-auto px-3 py-2 font-mono text-[12px] leading-5 [&>code]:bg-transparent [&>code]:p-0 [&>code]:text-[12px]")}>{children}</pre>
  ),
  code: ({ children, className }) => <code className={juntar("rounded bg-muted px-1 py-0.5 font-mono text-[13px]", className)}>{children}</code>,
  table: ({ children }) => (
    <div className="min-w-0 overflow-x-auto rounded-md border border-border">
      <table className="w-full border-collapse text-[13px] leading-5">{children}</table>
    </div>
  ),
  th: ({ children, style }) => (
    <th style={style} className="whitespace-nowrap border-b border-border px-3 py-1.5 text-left text-[12px] font-medium text-muted-foreground">
      {children}
    </th>
  ),
  td: ({ children, style }) => (
    <td style={style} className="border-b border-border/50 px-3 py-1.5 align-top [overflow-wrap:normal]">
      {children}
    </td>
  ),
};

export default function TextoFormatado({ texto, className }: { texto: string; className?: string }) {
  if (!texto) return null;
  return (
    <div className={juntar("min-w-0 space-y-2 text-foreground [overflow-wrap:anywhere]", conversa.mensagem, className)} data-texto-formatado="">
      <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml components={componentes}>
        {texto}
      </ReactMarkdown>
    </div>
  );
}
