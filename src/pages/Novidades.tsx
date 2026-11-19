import { useMemo, useState } from "react";
import { Sparkles } from "lucide-react";
import { CardSurface, Chip, Collapsible, EmptyState, PageHeader, PillTabs, type PillTab } from "@/components/ds";
import { Carregando, juntar, texto } from "@/components/sistema";
import { useAuth } from "@/contexts/AuthContext";
import {
  agruparPorMes,
  filtrarPorPublico,
  formatReleaseDate,
  novidadesPara,
  veTodasAsNovidades,
  type FiltroDePublico,
  type ReleaseEntry,
} from "@/lib/releaseNotes";

/**
 * Novidades do painel (redesenho de 19/11/2026).
 *
 * O cliente só lê o que mudou para ele (entradas "cliente"); admin e equipe
 * leem tudo e escolhem Todas, Para clientes ou Da equipe. Cada entrada é um
 * cartão limpo com a data, o público (para a equipe) e itens curtos. O mês
 * mais recente abre; os anteriores ficam recolhidos.
 */

const ROTULO_DO_PUBLICO = { cliente: "Para clientes", equipe: "Da equipe" } as const;

function Novidade({ entrada, mostrarPublico }: { entrada: ReleaseEntry; mostrarPublico: boolean }) {
  const chegando = entrada.status === "esta-semana";
  return (
    <CardSurface as="article" padded data-novidade={entrada.id}>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <time dateTime={entrada.date} className={juntar(texto.auxiliar, "tabular-nums")}>
          {formatReleaseDate(entrada.date)}
        </time>
        {mostrarPublico && (
          <Chip tone={entrada.publico === "cliente" ? "info" : "neutral"} dot>
            {ROTULO_DO_PUBLICO[entrada.publico]}
          </Chip>
        )}
        {chegando && <Chip tone="warning">Chegando</Chip>}
      </div>
      <h3 className={juntar(texto.tituloSecao, "mt-2")}>{entrada.title}</h3>
      <p className="mt-1 text-[13px] leading-5 text-muted-foreground">{entrada.summary}</p>
      {entrada.items.length > 0 && (
        <ul className="mt-4 space-y-2.5">
          {entrada.items.map((item) => (
            <li key={item.title} className="flex min-w-0 items-start">
              <span aria-hidden="true" className="mr-2.5 mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/50" />
              <p className={juntar(texto.corpo, "min-w-0")}>
                <span className="font-medium">{item.title}.</span>{" "}
                <span className="text-muted-foreground">{item.description}</span>
              </p>
            </li>
          ))}
        </ul>
      )}
    </CardSurface>
  );
}

function EsqueletoDasNovidades() {
  return (
    <div aria-busy="true" aria-label="Carregando as novidades" className="space-y-3">
      <div className="h-5 w-40 animate-pulse rounded-md bg-muted" />
      {[0, 1, 2].map((i) => (
        <CardSurface key={i} padded>
          <div className="h-4 w-28 animate-pulse rounded-md bg-muted" />
          <div className="mt-3 h-5 w-2/3 animate-pulse rounded-md bg-muted" />
          <div className="mt-2 h-4 w-full animate-pulse rounded-md bg-muted/70" />
          <Carregando linhas={2} rotulo="Carregando os itens" className="mt-4" />
        </CardSurface>
      ))}
    </div>
  );
}

export default function Novidades() {
  const { profile, loading } = useAuth();
  const [filtro, setFiltro] = useState<FiltroDePublico>("todas");
  const papel = profile?.role;
  const daEquipe = veTodasAsNovidades(papel);
  const carregando = loading && !profile;

  // Sem papel conhecido a lista já sai só com as entradas do cliente.
  const visiveis = useMemo(() => novidadesPara(papel), [papel]);
  const filtradas = useMemo(() => (daEquipe ? filtrarPorPublico(visiveis, filtro) : visiveis), [daEquipe, visiveis, filtro]);
  const meses = useMemo(() => agruparPorMes(filtradas), [filtradas]);

  const abas: PillTab<FiltroDePublico>[] = [
    { value: "todas", label: "Todas", count: visiveis.length },
    { value: "cliente", label: "Para clientes", count: filtrarPorPublico(visiveis, "cliente").length },
    { value: "equipe", label: "Da equipe", count: filtrarPorPublico(visiveis, "equipe").length },
  ];

  const maisRecente = visiveis[0];

  return (
    <div className="min-w-0 space-y-6">
      <PageHeader
        title="Novidades"
        subtitle={!carregando && maisRecente ? `Atualizado em ${formatReleaseDate(maisRecente.date)}` : undefined}
        help={
          daEquipe
            ? "O que mudou no painel, mês a mês. O cliente só vê as entradas marcadas Para clientes; as Da equipe aparecem só para a casa."
            : "O painel evolui toda semana. Aqui fica o que mudou para você, mês a mês, em português claro."
        }
        toolbar={!carregando && daEquipe ? <PillTabs<FiltroDePublico> tabs={abas} value={filtro} onChange={setFiltro} label="Público das novidades" /> : undefined}
      />

      <div className="max-w-3xl">
        {carregando ? (
          <EsqueletoDasNovidades />
        ) : meses.length === 0 ? (
          <EmptyState
            icon={<Sparkles className="h-5 w-5" />}
            title="Nada novo por aqui"
            description={filtro === "todas" ? "As próximas novidades do painel aparecem aqui." : "Nenhuma novidade com este público por enquanto."}
          />
        ) : (
          <div className="space-y-6">
            {meses.map((mes, i) => (
              <Collapsible
                key={mes.chave}
                title={mes.rotulo.charAt(0).toUpperCase() + mes.rotulo.slice(1)}
                count={mes.entradas.length}
                defaultOpen={i === 0}
                storageKey={`novidades:mes:${mes.chave}`}
              >
                <div className="space-y-3">
                  {mes.entradas.map((entrada) => (
                    <Novidade key={entrada.id} entrada={entrada} mostrarPublico={daEquipe} />
                  ))}
                </div>
              </Collapsible>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
