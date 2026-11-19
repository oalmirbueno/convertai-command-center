import { useMemo } from "react";
import { ArrowRight, Users } from "lucide-react";
import { AvatarComPresenca } from "@/components/execucao/Visuais";
import { EstadoVazio, Secao, botao, espaco, foco, juntar, lista, superficie, texto } from "@/components/sistema";
import { Card, Chip } from "@/components/ds";
import { haQuanto } from "@/lib/gruposAoVivo";
import type { LinhaDaConversa } from "@/lib/escritorio/conversas";
import { fazendoAgora, presencaPorSlug, presenteAgora, ultimaAtividade } from "@/lib/escritorio/presenca";
import type { AgenteDoEscritorio, Presenca } from "@/lib/escritorio/tipos";
import { EtiquetaDaPlataforma, EtiquetaDoGrau } from "./LinhaDoAgente";

/**
 * O Escritório agora (19/11/2026, dono: "mais intuitivo e mais interativo"):
 * cada agente ativo é um cartão (quem está aqui vem primeiro, com o que diz
 * estar fazendo) e, ao lado, a caixa com as conversas mais recentes. Clicar no
 * agente abre a ficha no centro; clicar na conversa abre a conversa.
 */

/** Quantas conversas a caixa mostra antes do "Ver todas". */
const NA_CAIXA = 6;

const cartao = juntar(superficie.painel, "group flex h-full w-full min-w-0 flex-col p-4 text-left transition-transform duration-200 [@media(hover:hover)]:hover:-translate-y-0.5 active:translate-y-0 sm:p-5", foco);

export default function AbaAgora({
  agentes,
  presencas,
  conversas,
  agora,
  aoAbrirAgente,
  aoAbrirConversa,
  aoVerConversas,
}: {
  agentes: AgenteDoEscritorio[];
  presencas: Presenca[];
  conversas: LinhaDaConversa[];
  agora: number;
  aoAbrirAgente: (slug: string) => void;
  aoAbrirConversa: (id: string) => void;
  aoVerConversas: () => void;
}) {
  const presenca = useMemo(() => presencaPorSlug(presencas), [presencas]);
  const ativos = useMemo(() => {
    const lista = agentes.filter((a) => a.status === "active").map((a) => {
      const p = presenca.get(a.slug);
      return { a, presente: presenteAgora(p?.batimento_em, agora), fazendo: fazendoAgora(p, agora), ultima: ultimaAtividade(a.last_run_at, p?.batimento_em) };
    });
    // Quem está aqui primeiro; depois, quem apareceu por último.
    return lista.sort((x, y) => Number(y.presente) - Number(x.presente) || String(y.ultima ?? "").localeCompare(String(x.ultima ?? "")) || x.a.display_name.localeCompare(y.a.display_name, "pt-BR"));
  }, [agentes, presenca, agora]);
  const aqui = ativos.filter((x) => x.presente).length;
  const caixa = useMemo(() => [...conversas].sort((x, y) => Number(y.naoLidas > 0) - Number(x.naoLidas > 0)).slice(0, NA_CAIXA), [conversas]);
  const naoLidas = conversas.reduce((n, l) => n + l.naoLidas, 0);

  return (
    <div className="grid min-w-0 items-start gap-x-8 gap-y-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,380px)]" data-escritorio-agora="">
      <Card
        as="section"
        className="lg:col-start-2 lg:row-start-1"
        aria-label="Caixa"
        title="Caixa"
        subtitle={naoLidas === 0 ? "tudo lido" : naoLidas === 1 ? "1 não lida" : `${naoLidas} não lidas`}
        action={conversas.length > 0 ? (
          <button type="button" className={juntar(botao.discreto, "h-8")} onClick={aoVerConversas}>
            Ver todas<ArrowRight className="ml-1 h-3.5 w-3.5" aria-hidden="true" />
          </button>
        ) : undefined}
        data-caixa-do-escritorio=""
      >
        {caixa.length === 0 ? (
          <EstadoVazio compacto titulo="Nenhuma conversa ainda." />
        ) : (
          <ul className={juntar(lista.aberta, lista.divisoria)} aria-label="Conversas da caixa">
            {caixa.map((l) => (
              <li key={l.id}>
                <button type="button" onClick={() => aoAbrirConversa(l.id)} className={juntar(lista.linha, "w-full items-start text-left")} title={`Abrir a conversa com ${l.titulo}`}>
                  {l.tipo === "grupo" ? (
                    <span aria-hidden="true" className="mr-3 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"><Users className="h-4 w-4" /></span>
                  ) : (
                    <AvatarComPresenca nome={l.titulo} tamanho={36} className="mr-3" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="flex min-w-0 items-center">
                      <span className={juntar(texto.corpo, "min-w-0 flex-1 truncate", l.naoLidas > 0 ? "font-semibold" : "font-medium")}>{l.titulo}</span>
                      <span className={juntar(texto.auxiliar, "ml-2 shrink-0 tabular-nums")}>{haQuanto(l.ultimaEm, agora)}</span>
                    </span>
                    <span className="mt-0.5 flex min-w-0 items-center">
                      <span className={juntar(texto.auxiliar, "min-w-0 flex-1 truncate")}>{l.ultimo || l.assunto || "Sem recado"}</span>
                      {l.naoLidas > 0 && <Chip tone="accent" className="ml-2">{l.naoLidas}</Chip>}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="min-w-0 lg:col-start-1 lg:row-start-1">
      <Secao titulo="Agentes" descricao={aqui === 0 ? "ninguém aqui agora" : aqui === 1 ? "1 aqui agora" : `${aqui} aqui agora`} recolher={false}>
        {ativos.length === 0 ? (
          <EstadoVazio compacto titulo="Nenhum agente ativo." />
        ) : (
          <ul className={juntar(espaco.grade, "sm:grid-cols-2 xl:grid-cols-3")} aria-label="Agentes do escritório">
            {ativos.map(({ a, presente, fazendo, ultima }) => (
              <li key={a.id} className="min-w-0" data-cartao-do-agente={a.slug} data-presente={presente ? "" : undefined}>
                <button type="button" className={cartao} onClick={() => aoAbrirAgente(a.slug)} title={`Abrir a ficha de ${a.display_name}`}>
                  <span className="flex min-w-0 items-center">
                    <AvatarComPresenca nome={a.display_name} ativo={presente} tamanho={40} className="mr-3" />
                    <span className="min-w-0 flex-1">
                      <span className={juntar(texto.tituloSecao, "block truncate")}>{a.display_name}</span>
                      <span className={juntar(texto.auxiliar, "block truncate")}>{a.role || a.area || "Sem função"}</span>
                    </span>
                    {presente ? (
                      <Chip tone="success" dot className="ml-2">agora</Chip>
                    ) : (
                      <span className={juntar(texto.auxiliar, "ml-2 shrink-0 tabular-nums")}>{ultima ? haQuanto(ultima, agora) : "sem sinal"}</span>
                    )}
                  </span>
                  <span className={juntar(texto.corpo, "mt-4 line-clamp-2 min-h-[40px] [overflow-wrap:anywhere]", !fazendo && "text-muted-foreground")} data-fazendo={fazendo ? "" : undefined}>
                    {fazendo || (presente ? "Sem tarefa anunciada" : "Fora do escritório")}
                  </span>
                  <span className="mt-auto flex min-w-0 items-center pt-4">
                    <EtiquetaDaPlataforma origem={a.origem} className="mr-1.5" />
                    <EtiquetaDoGrau grau={a.grau} />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Secao>
      </div>

    </div>
  );
}
