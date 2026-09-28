import { useState, type ReactNode } from "react";
import { ExternalLink, Layers, Play } from "lucide-react";
import { etiqueta, juntar, texto } from "@/components/sistema/estilos";
import { ImagemDaMesa } from "../MesaContexto";
import { iniciaisDe } from "@/components/admin/LogoDoCliente";
import { numeroDoPerfil, type CapaGuardada, type DestaqueProposto, type ItemDaGradeNaAba, type PerfilDaAba } from "./instagramApi";

/**
 * Prévia do perfil como aparece no app: foto, números, nome, bio, link, a
 * fileira de destaques e a grade em 3:4.
 * - Destaques: a API do Instagram não entrega os destaques do perfil. As
 *   bolinhas mostram as capas geradas aqui e, sem capa ainda, os destaques da
 *   lista (bolinha na cor da marca, tracejada: "planejado").
 * - Simulação: os posts escolhidos entram por cima dos publicados, na ordem
 *   de ir ao ar (o último a sair fica no canto de cima, como no app).
 * O modo, a leitura e o botão de atualizar ficam no topo da coluna (quem
 * hospeda), para a grade estar sempre a um clique.
 * As imagens do Instagram vêm da CDN da Meta (sem referer, senão ela recusa).
 */

export const ROTULO_DA_FONTE: Record<PerfilDaAba["fonte"], string> = {
  conta_do_cliente: "Lido pela conta do cliente",
  descoberta: "Lido pela conta da agência (perfil público)",
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

const mesmoNome = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export type BolinhaDoDestaque = { chave: string; nome: string; caminho: string | null };

/** Bolinhas da fileira: a lista na ordem (com a capa quando já existe) e depois as capas fora da lista. */
export function bolinhasDosDestaques(capas: CapaGuardada[], lista: DestaqueProposto[]): BolinhaDoDestaque[] {
  const saida: BolinhaDoDestaque[] = lista.map((d, i) => {
    const capa = capas.find((c) => mesmoNome(c.nome, d.nome));
    return { chave: capa ? capa.id : `plano-${i}`, nome: d.nome, caminho: capa ? capa.caminho : null };
  });
  for (const c of capas) if (!lista.some((d) => mesmoNome(d.nome, c.nome))) saida.push({ chave: c.id, nome: c.nome, caminho: c.caminho });
  return saida;
}

export default function PreviaDoPerfil({
  perfil,
  capas,
  lista = [],
  corDaMarca,
  planejados,
  simulando,
}: {
  perfil: PerfilDaAba;
  capas: CapaGuardada[];
  /** Destaques planejados (a lista do gerador). */
  lista?: DestaqueProposto[];
  /** Fundo das bolinhas ainda sem capa (a primeira cor do kit). */
  corDaMarca?: string | null;
  /** Na ordem de ir ao ar (só os escolhidos para a simulação). */
  planejados: ItemDaGradeNaAba[];
  simulando: boolean;
}) {
  const nome = perfil.nome || perfil.username || "Perfil";
  const plano = simulando ? planejados.slice().reverse() : [];
  const semNada = perfil.fonte === "nenhuma" && !perfil.midias.length;
  const bolinhas = bolinhasDosDestaques(capas, lista);
  // Na simulação o cabeçalho encolhe (foto, @ e números numa linha, sem a bio): a grade fica logo abaixo.
  if (simulando) {
    return (
      <div className="mx-auto w-full max-w-[420px] rounded-xl border border-border bg-background px-3 pb-3 pt-2.5" data-previa-do-perfil="" data-simulando="">
        <div className="flex min-w-0 items-center">
          <FotoDoPerfil url={perfil.foto_url} nome={nome} tamanho={40} />
          <p className="ml-2 min-w-0 flex-1 truncate text-[13px] font-semibold text-foreground">{perfil.username ? `@${perfil.username}` : nome}</p>
          <span className="ml-2 shrink-0 text-[11.5px] tabular-nums text-muted-foreground">
            {numeroDoPerfil(perfil.posts)} posts · {numeroDoPerfil(perfil.seguidores)} seg.
          </span>
        </div>
        {bolinhas.length > 0 && (
          <ul className="-mx-1 mt-2 flex min-w-0 overflow-x-auto" aria-label="Destaques">
            {bolinhas.map((b) => (
              <li key={b.chave} className="mx-1 flex w-[46px] shrink-0 flex-col items-center" data-bolinha={b.caminho ? "capa" : "planejada"}>
                <span className={juntar("block h-[40px] w-[40px] overflow-hidden rounded-full p-[2px]", b.caminho ? "border border-border" : "border border-dashed border-muted-foreground/50")}>
                  {b.caminho ? (
                    <ImagemDaMesa caminho={b.caminho} alt={`Capa ${b.nome}`} className="h-full w-full rounded-full" />
                  ) : (
                    <span className="flex h-full w-full items-center justify-center rounded-full text-[12px] font-semibold text-white" style={{ backgroundColor: corDaMarca || "#9ca3af" }}>
                      {b.nome ? b.nome.charAt(0).toUpperCase() : "?"}
                    </span>
                  )}
                </span>
                <span className="mt-0.5 w-full truncate text-center text-[10.5px] leading-4 text-foreground">{b.nome}</span>
              </li>
            ))}
          </ul>
        )}
        {!planejados.length && <p className={juntar(texto.auxiliar, "mt-2 text-center")}>Nenhum post na simulação: escolha em Grade e simulador.</p>}
        <ul className="mt-2 grid grid-cols-3 gap-[2px]" aria-label="Grade do perfil">
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
              {m.imagem ? <img src={m.imagem} alt={m.legenda || "Post"} loading="lazy" referrerPolicy="no-referrer" className="absolute inset-0 h-full w-full object-cover" /> : null}
            </Celula>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[420px] rounded-xl border border-border bg-background px-3 pb-3 pt-2.5" data-previa-do-perfil="">
      <p className="truncate text-center text-[14px] font-semibold text-foreground">{perfil.username ? `@${perfil.username}` : "Sem @ conectado"}</p>
      <div className="mt-3 flex min-w-0 items-center">
        <FotoDoPerfil url={perfil.foto_url} nome={nome} tamanho={68} />
        <div className="ml-3 grid min-w-0 flex-1 grid-cols-3 gap-1">
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
        {bolinhas.length ? (
          <ul className="-mx-1 flex min-w-0 overflow-x-auto pb-1" aria-label="Destaques">
            {bolinhas.map((b) => (
              <li key={b.chave} className="mx-1 flex w-[60px] shrink-0 flex-col items-center" data-bolinha={b.caminho ? "capa" : "planejada"}>
                <span className={juntar("block h-[56px] w-[56px] overflow-hidden rounded-full p-[2px]", b.caminho ? "border border-border" : "border border-dashed border-muted-foreground/50")}>
                  {b.caminho ? (
                    <ImagemDaMesa caminho={b.caminho} alt={`Capa ${b.nome}`} className="h-full w-full rounded-full" />
                  ) : (
                    <span className="flex h-full w-full items-center justify-center rounded-full text-[15px] font-semibold text-white" style={{ backgroundColor: corDaMarca || "#9ca3af" }} title="Planejado: gere a capa em Destaques">
                      {nome && b.nome ? b.nome.charAt(0).toUpperCase() : "?"}
                    </span>
                  )}
                </span>
                <span className="mt-1 w-full truncate text-center text-[11.5px] leading-4 text-foreground">{b.nome}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className={juntar(texto.auxiliar, "leading-5")}>Sem destaques ainda. A API do Instagram não entrega os destaques do perfil: os planejados e as capas geradas aparecem aqui.</p>
        )}
      </div>

      {semNada ? (
        <p className={juntar(texto.auxiliar, "mt-4 text-center leading-5")}>Conecte o Instagram do cliente em Config, Integrações, para ver a grade.</p>
      ) : (
        <ul className="mt-2 grid grid-cols-3 gap-[2px]" aria-label="Grade do perfil">
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
  );
}
