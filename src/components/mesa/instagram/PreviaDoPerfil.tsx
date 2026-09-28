import { useState, type ReactNode } from "react";
import { ExternalLink, Layers, Play } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { etiqueta, juntar, texto } from "@/components/sistema/estilos";
import { ImagemDaMesa } from "../MesaContexto";
import { iniciaisDe } from "@/components/admin/LogoDoCliente";
import { numeroDoPerfil, type CapaGuardada, type ItemDaGradeNaAba, type PerfilDaAba } from "./instagramApi";

/**
 * Prévia do perfil como aparece no app: foto, números, nome, bio, link, a
 * fileira de destaques (as capas geradas aqui, com o nome embaixo) e a grade
 * em 3:4. Com "Mostrar o plano", os posts que vão ao ar entram por cima dos
 * publicados, do jeito que o perfil vai ficar (o último a sair no canto).
 * As imagens do Instagram vêm da CDN da Meta (sem referer, senão ela recusa).
 */

const ROTULO_DA_FONTE: Record<PerfilDaAba["fonte"], string> = {
  conta_do_cliente: "Lido agora pela conta do cliente",
  descoberta: "Lido agora pela conta da agência (perfil público)",
  guardado: "Guardado pelo robô de métricas",
  nenhuma: "Sem dados do perfil",
};

function Celula({ children, planejado }: { children: ReactNode; planejado?: boolean }) {
  return (
    <li className={juntar("relative min-w-0 overflow-hidden bg-muted", planejado ? "outline outline-2 -outline-offset-2 outline-primary/70" : "")} style={{ paddingBottom: "133.333%" }}>
      {children}
    </li>
  );
}

export function FotoDoPerfil({ url, nome, tamanho = 76 }: { url: string | null; nome: string; tamanho?: number }) {
  const [falhou, setFalhou] = useState(false);
  const estilo = { width: tamanho, height: tamanho };
  if (!url || falhou) {
    return (
      <span style={estilo} className="flex shrink-0 items-center justify-center rounded-full border border-border bg-secondary text-muted-foreground">
        <span style={{ fontSize: Math.max(11, tamanho * 0.3) }}>{iniciaisDe(nome)}</span>
      </span>
    );
  }
  return <img src={url} alt={`Foto do perfil ${nome}`} style={estilo} referrerPolicy="no-referrer" onError={() => setFalhou(true)} className="shrink-0 rounded-full border border-border object-cover" />;
}

function Numero({ valor, rotulo }: { valor: number | null; rotulo: string }) {
  return (
    <div className="min-w-0 text-center">
      <p className="text-[15px] font-semibold leading-5 tabular-nums text-foreground">{numeroDoPerfil(valor)}</p>
      <p className="truncate text-[12px] leading-4 text-muted-foreground">{rotulo}</p>
    </div>
  );
}

export default function PreviaDoPerfil({
  perfil,
  capas,
  planejados,
  mostrarPlano,
  onMostrarPlano,
}: {
  perfil: PerfilDaAba;
  capas: CapaGuardada[];
  /** Na ordem de ir ao ar. */
  planejados: ItemDaGradeNaAba[];
  mostrarPlano: boolean;
  onMostrarPlano: (v: boolean) => void;
}) {
  const nome = perfil.nome || perfil.username || "Perfil";
  const plano = mostrarPlano ? planejados.slice().reverse() : [];
  const semNada = perfil.fonte === "nenhuma" && !perfil.midias.length;
  return (
    <div className="min-w-0">
      <div className="mx-auto w-full max-w-[460px] rounded-xl border border-border bg-background p-3 sm:p-4" data-previa-do-perfil="">
        <p className="truncate text-center text-[14px] font-semibold text-foreground">{perfil.username ? `@${perfil.username}` : "Sem @ conectado"}</p>
        <div className="mt-3 flex min-w-0 items-center">
          <FotoDoPerfil url={perfil.foto_url} nome={nome} />
          <div className="ml-4 grid min-w-0 flex-1 grid-cols-3 gap-1">
            <Numero valor={perfil.posts} rotulo="posts" />
            <Numero valor={perfil.seguidores} rotulo="seguidores" />
            <Numero valor={perfil.seguindo} rotulo="seguindo" />
          </div>
        </div>
        <div className="mt-2.5 min-w-0">
          <p className="text-[13px] font-semibold leading-5 text-foreground [overflow-wrap:anywhere]">{perfil.nome || <span className="font-normal text-muted-foreground">Sem nome no perfil</span>}</p>
          {perfil.bio ? (
            <p className="whitespace-pre-line text-[13px] leading-5 text-foreground [overflow-wrap:anywhere]" data-bio-atual="">
              {perfil.bio}
            </p>
          ) : (
            <p className={texto.auxiliar}>Sem bio.</p>
          )}
          {perfil.site && (
            <a href={perfil.site} target="_blank" rel="noreferrer" className="mt-0.5 inline-flex max-w-full items-center text-[13px] font-medium text-primary hover:underline">
              <ExternalLink className="mr-1 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">{perfil.site.replace(/^https?:\/\//, "").replace(/\/$/, "")}</span>
            </a>
          )}
        </div>

        <div className="mt-3 min-w-0">
          {capas.length ? (
            <ul className="-mx-1 flex min-w-0 overflow-x-auto pb-1" aria-label="Destaques gerados aqui">
              {capas.map((c) => (
                <li key={c.id} className="mx-1 flex w-[64px] shrink-0 flex-col items-center">
                  <span className="block h-[58px] w-[58px] overflow-hidden rounded-full border border-border p-[2px]">
                    <ImagemDaMesa caminho={c.caminho} alt={`Capa ${c.nome}`} className="h-full w-full rounded-full" />
                  </span>
                  <span className="mt-1 w-full truncate text-center text-[11.5px] leading-4 text-foreground">{c.nome}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className={juntar(texto.auxiliar, "leading-5")}>A API do Instagram não entrega os destaques do perfil. As capas que você gerar aqui aparecem nesta fileira.</p>
          )}
        </div>

        {semNada ? (
          <p className={juntar(texto.auxiliar, "mt-4 text-center leading-5")}>Conecte o Instagram do cliente em Integrações para ver a grade.</p>
        ) : (
          <ul className="mt-3 grid grid-cols-3 gap-[2px]" aria-label="Grade do perfil">
            {plano.map((p, i) => (
              <Celula key={`p-${p.id}`} planejado>
                <ImagemDaMesa caminho={p.imagem ? p.imagem.caminho : null} bucket={p.imagem ? p.imagem.bucket : "mesa"} alt={p.titulo} className="absolute inset-0 h-full w-full" />
                <span className={juntar(etiqueta, "pointer-events-none absolute left-1 top-1 bg-primary text-primary-foreground")} title={p.titulo}>
                  {planejados.length - i}º
                </span>
              </Celula>
            ))}
            {perfil.midias.map((m) => (
              <Celula key={m.id}>
                <a href={m.permalink || "#"} target="_blank" rel="noreferrer" title={m.legenda || "Abrir no Instagram"} className="absolute inset-0 block">
                  {m.imagem ? (
                    <img src={m.imagem} alt={m.legenda || "Post"} loading="lazy" referrerPolicy="no-referrer" className="absolute inset-0 h-full w-full object-cover" />
                  ) : (
                    <span className="absolute inset-0 flex items-center justify-center text-[11px] text-muted-foreground">Abrir</span>
                  )}
                  {m.formato === "carrossel" && <Layers className="absolute right-1 top-1 h-3.5 w-3.5 text-white drop-shadow" aria-hidden="true" />}
                  {m.formato === "reel" && <Play className="absolute right-1 top-1 h-3.5 w-3.5 text-white drop-shadow" aria-hidden="true" />}
                </a>
              </Celula>
            ))}
          </ul>
        )}
      </div>

      <div className="mx-auto mt-2 flex w-full max-w-[460px] min-w-0 flex-wrap items-center justify-between">
        <p className={juntar(texto.auxiliar, "mr-2 min-w-0 leading-5")}>
          {ROTULO_DA_FONTE[perfil.fonte]}
          {perfil.aviso ? `. ${perfil.aviso}` : ""}
        </p>
        {planejados.length > 0 && (
          <label className="mt-1 flex shrink-0 items-center text-[12.5px]">
            <Switch checked={mostrarPlano} onCheckedChange={onMostrarPlano} className="mr-2" aria-label="Mostrar os posts planejados na grade" />
            Mostrar o plano ({planejados.length})
          </label>
        )}
      </div>
    </div>
  );
}
