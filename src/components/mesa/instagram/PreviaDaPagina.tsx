import { useState } from "react";
import { ExternalLink } from "lucide-react";
import { juntar, texto } from "@/components/sistema/estilos";
import { FotoDoPerfil } from "./PreviaDoPerfil";
import { numeroDoPerfil, type PaginaNaPrevia } from "./instagramApi";
import { dataEHoraCurta } from "../PublicacaoDaPeca";

/**
 * Página do Facebook do cliente como aparece no app: capa, foto, nome,
 * categoria, seguidores e curtidas, sobre, site e os últimos posts. Tudo o
 * que a API da página entrega com o login de hoje (pages_read_engagement).
 */

function ImagemDaMeta({ url, alt, className }: { url: string; alt: string; className: string }) {
  const [falhou, setFalhou] = useState(false);
  if (falhou) return <div className={juntar("bg-muted", className)} />;
  return <img src={url} alt={alt} loading="lazy" referrerPolicy="no-referrer" onError={() => setFalhou(true)} className={className} />;
}

export default function PreviaDaPagina({ pagina, carregando }: { pagina: PaginaNaPrevia | null | undefined; carregando: boolean }) {
  if (!pagina) {
    return <p className={juntar(texto.auxiliar, "px-1 py-6 text-center")}>{carregando ? "Lendo a página do Facebook..." : "Página não lida."}</p>;
  }
  return (
    <div className="mx-auto w-full max-w-[420px] overflow-hidden rounded-xl border border-border bg-background" data-previa-da-pagina="">
      <div className="relative h-[110px] w-full bg-muted">
        {pagina.capa_url && <ImagemDaMeta url={pagina.capa_url} alt={`Capa de ${pagina.nome}`} className="absolute inset-0 h-full w-full object-cover" />}
      </div>
      <div className="px-3 pb-3">
        <div className="relative z-10 -mt-8 flex items-end">
          <span className="rounded-full border-4 border-background">
            <FotoDoPerfil url={pagina.foto_url} nome={pagina.nome} tamanho={64} />
          </span>
        </div>
        <p className="mt-1 text-[16px] font-semibold leading-6 text-foreground [overflow-wrap:anywhere]">{pagina.nome || "Página"}</p>
        <p className={texto.auxiliar}>
          {[pagina.categoria, pagina.seguidores !== null ? `${numeroDoPerfil(pagina.seguidores)} seguidores` : "", pagina.curtidas !== null ? `${numeroDoPerfil(pagina.curtidas)} curtidas` : ""].filter(Boolean).join(" · ")}
        </p>
        {pagina.aviso && <p className="mt-2 rounded-md bg-warning/10 px-2.5 py-1.5 text-[12px] leading-4 text-foreground">{pagina.aviso}</p>}
        {pagina.sobre && <p className="mt-2 whitespace-pre-line text-[13px] leading-5 text-foreground [overflow-wrap:anywhere]">{pagina.sobre}</p>}
        <div className="mt-1.5 flex min-w-0 flex-wrap">
          {pagina.site && (
            <a href={pagina.site} target="_blank" rel="noreferrer" className="mr-3 inline-flex max-w-full items-center text-[12.5px] font-medium text-primary hover:underline">
              <ExternalLink className="mr-1 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">{pagina.site.replace(/^https?:\/\//, "").replace(/\/$/, "")}</span>
            </a>
          )}
          {pagina.link && (
            <a href={pagina.link} target="_blank" rel="noreferrer" className="inline-flex items-center text-[12.5px] text-muted-foreground hover:text-foreground">
              <ExternalLink className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
              Abrir no Facebook
            </a>
          )}
        </div>
        <p className={juntar(texto.rotulo, "mt-3")}>Últimos posts</p>
        {pagina.posts.length ? (
          <ul className="mt-1.5 space-y-2" aria-label="Posts da página">
            {pagina.posts.map((p) => (
              <li key={p.id} className="flex min-w-0 rounded-md border border-border p-2">
                {p.imagem && <ImagemDaMeta url={p.imagem} alt={p.texto.slice(0, 60) || "Post"} className="mr-2 h-14 w-14 shrink-0 rounded object-cover" />}
                <div className="min-w-0 flex-1">
                  <p className="text-[11.5px] tabular-nums text-muted-foreground">{p.data ? dataEHoraCurta(p.data) : ""}</p>
                  <p className="text-[12.5px] leading-4 text-foreground [overflow-wrap:anywhere]">{p.texto ? p.texto.slice(0, 160) : "(sem texto)"}</p>
                  {p.link && (
                    <a href={p.link} target="_blank" rel="noreferrer" className="text-[11.5px] text-primary hover:underline">
                      Ver no Facebook
                    </a>
                  )}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className={juntar(texto.auxiliar, "mt-1")}>Nenhum post lido.</p>
        )}
      </div>
    </div>
  );
}
