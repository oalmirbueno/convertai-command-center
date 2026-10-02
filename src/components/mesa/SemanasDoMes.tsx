import { useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { Camera, Check, ChevronDown, ExternalLink, GalleryHorizontal, Loader2, Pencil, RefreshCw, Square, X } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { juntar, lista as estiloDeLista } from "@/components/sistema/estilos";
import { BotaoDeApagar, type ResultadoDoApagar } from "./ApagarConteudo";
import { diaCurto, mesDaData, rotuloDoFormato, type CamposDoItem, type ItemProposto } from "./mesaV4Api";
import { linhasDaDirecaoDeFoto, linkDaPecaNaMesaFoto, normalizarDirecaoDeFoto } from "../../../supabase/functions/agente-calendario/modulos/peca-de-foto";
import { contagem, juntarComE, segundaDaSemana, semanaIso } from "../../../supabase/functions/agente-calendario/modulos/cadencia-do-mes";

/**
 * O mês por semana (dono, 02/10: "mais claro, organizado, prático; tudo
 * interligado"). Uma lista por semana ISO com o cabeçalho "Semana de 05/10 ·
 * 3 posts · 2 fotos e 1 carrossel" e uma linha por conteúdo: data, formato
 * (Foto, Carrossel, Estático; troca no próprio chip), título (edita no
 * lugar) e as ações rápidas: abrir na mesa que faz (Foto na Mesa Foto, já
 * escolhida; arte no Estúdio), refazer e apagar. O detalhe (legenda, lâminas
 * e a direção da foto) abre na própria linha. Sem caixa dentro de caixa.
 */

export type FormatoDaLinha = "foto" | "carrossel" | "estatico";

const FORMATOS: FormatoDaLinha[] = ["foto", "carrossel", "estatico"];

const ICONE: Record<FormatoDaLinha, typeof Camera> = { foto: Camera, carrossel: GalleryHorizontal, estatico: Square };

const formatoDaLinha = (f?: string | null): FormatoDaLinha => (f === "foto" || f === "estatico" ? f : "carrossel");

export interface SemanaDoMes<T> {
  semana: string;
  inicio: string;
  itens: T[];
  formatos: Record<FormatoDaLinha, number>;
}

/** Os itens agrupados por semana ISO, em ordem de data, com a contagem de cada formato. */
export function semanasDosItens<T extends { data?: string | null; formato?: string | null }>(itens: T[]): SemanaDoMes<T>[] {
  const mapa = new Map<string, SemanaDoMes<T>>();
  const ordenados = itens.slice().sort((a, b) => String(a.data || "").localeCompare(String(b.data || "")));
  for (const i of ordenados) {
    const data = String(i.data || "");
    const valida = /^\d{4}-\d{2}-\d{2}$/.test(data);
    const chave = valida ? semanaIso(data) : "sem-data";
    let s = mapa.get(chave);
    if (!s) {
      s = { semana: chave, inicio: valida ? segundaDaSemana(data) : "", itens: [], formatos: { foto: 0, carrossel: 0, estatico: 0 } };
      mapa.set(chave, s);
    }
    s.itens.push(i);
    s.formatos[formatoDaLinha(i.formato)]++;
  }
  return Array.from(mapa.values());
}

/** "3 posts · 2 fotos e 1 carrossel". */
export function resumoDaMistura(formatos: Record<FormatoDaLinha, number>): string {
  const total = formatos.foto + formatos.carrossel + formatos.estatico;
  const partes = FORMATOS.filter((f) => formatos[f] > 0).map((f) => contagem(formatos[f], f));
  return `${total} ${total === 1 ? "post" : "posts"}${partes.length ? ` · ${juntarComE(partes)}` : ""}`;
}

const dataCurtaDaSemana = (iso: string) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : "");

/** Chip do formato; com `onTrocar`, abre a lista para trocar (Foto, Carrossel, Estático). */
export function ChipDoFormato({ formato, onTrocar, ocupado }: { formato?: string | null; onTrocar?: (f: FormatoDaLinha) => void; ocupado?: boolean }) {
  const f = formatoDaLinha(formato);
  const Icone = ICONE[f];
  const cor = f === "foto" ? "bg-success/15 text-foreground" : "bg-muted text-foreground";
  const conteudo = (
    <>
      {ocupado ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Icone className="mr-1 h-3 w-3" />}
      {rotuloDoFormato(f)}
    </>
  );
  const classe = `inline-flex h-6 shrink-0 items-center rounded-full px-2 text-[11px] font-medium ${cor}`;
  if (!onTrocar) return <span className={classe} data-formato={f}>{conteudo}</span>;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className={`${classe} hover:ring-1 hover:ring-primary/40`} aria-label={`Formato: ${rotuloDoFormato(f)}. Trocar`} data-formato={f} disabled={ocupado}>
        {conteudo}
        <ChevronDown className="ml-0.5 h-3 w-3 opacity-60" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {FORMATOS.map((x) => {
          const I = ICONE[x];
          return (
            <DropdownMenuItem key={x} onSelect={() => x !== f && onTrocar(x)} className="text-[12px]">
              <I className="mr-2 h-3.5 w-3.5" />
              {rotuloDoFormato(x)}
              {x === f && <Check className="ml-auto h-3.5 w-3.5" />}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** O detalhe do conteúdo, aberto na linha: direção da foto, legenda e lâminas. */
export function DetalheDoConteudo({ item }: { item: ItemProposto }) {
  const texto = item.copy || item.resumo;
  const cards = (item.cards || []).slice().sort((a, b) => a.ordem - b.ordem);
  const foto = item.formato === "foto" ? normalizarDirecaoDeFoto(item.foto, { tema: item.tema }) : null;
  return (
    <div className="min-w-0 space-y-2 pb-3 pl-2 pr-2 sm:pl-[92px]">
      {foto && (
        <ul className="min-w-0 text-[12px] leading-relaxed" aria-label="Direção da foto" data-direcao-da-foto="">
          {linhasDaDirecaoDeFoto(foto).map((l) => (
            <li key={l} className="[overflow-wrap:anywhere]">{l}</li>
          ))}
        </ul>
      )}
      {item.gancho && <p className="text-[12.5px] font-medium [overflow-wrap:anywhere]">{item.gancho}</p>}
      {texto && <p className="whitespace-pre-wrap text-[12.5px] leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">{texto}</p>}
      {cards.length > 0 && (
        <ol className={juntar(estiloDeLista.divisoria, "min-w-0")}>
          {cards.map((c) => (
            <li key={c.ordem} className="py-1.5 text-[12px] leading-snug [overflow-wrap:anywhere]">
              <span className="mr-1.5 font-medium text-muted-foreground">{item.formato === "foto" ? "Foto" : "Lâmina"} {c.ordem}{c.funcao ? ` · ${c.funcao}` : ""}</span>
              {c.texto}
              {c.ilustracao && <span className="block text-muted-foreground">{c.ilustracao}</span>}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export interface AcoesDaLinha {
  /** Abre o item gravado no Estúdio (arte). */
  onAbrirNoEstudio?: (taskId: string, mes: string) => void;
  /** Muda campos à mão (título e formato), sem IA. */
  onEditar?: (item: ItemProposto, campos: CamposDoItem) => Promise<void>;
  /** Refaz só este conteúdo com outro ângulo. */
  onRefazer?: (item: ItemProposto) => Promise<void>;
  /** Lixeira com confirmação (proposta ou agenda). */
  apagar?: (item: ItemProposto) => ((confirmarExtra: boolean) => Promise<ResultadoDoApagar>) | undefined;
  /** Selo e aviso extra da linha (memória editorial, avisos do texto). */
  extra?: (item: ItemProposto) => ReactNode;
}

function LinhaDoConteudo({
  item,
  clientId,
  propostaId,
  indice,
  editavel,
  acoes,
}: {
  item: ItemProposto;
  clientId: string;
  propostaId?: string | null;
  indice: number;
  editavel: boolean;
  acoes: AcoesDaLinha;
}) {
  const local = useLocation();
  const [aberto, setAberto] = useState(false);
  const [editando, setEditando] = useState(false);
  const [titulo, setTitulo] = useState(item.tema || "");
  const [ocupado, setOcupado] = useState<"" | "formato" | "titulo" | "refazer">("");
  const f = formatoDaLinha(item.formato);
  const podeEditar = editavel && !item.task_id && !!item.tema_id && !!acoes.onEditar;
  const volta = `${local.pathname}${local.search}`;
  // Só com a peça guardada (proposta ou tarefa): o cartão do agente antes de criar não tem para onde levar.
  const linkDaFoto = f === "foto" && (propostaId || item.task_id) ? linkDaPecaNaMesaFoto(clientId, { propostaId: propostaId || null, indice: indice >= 0 ? indice : null, taskId: item.task_id || null, volta }) : null;
  const apagar = acoes.apagar ? acoes.apagar(item) : undefined;

  const editar = async (campos: CamposDoItem, qual: "formato" | "titulo") => {
    if (!acoes.onEditar) return;
    setOcupado(qual);
    try {
      await acoes.onEditar(item, campos);
    } finally {
      setOcupado("");
    }
  };

  const salvarTitulo = async () => {
    const t = titulo.trim();
    setEditando(false);
    if (!t || t === item.tema) {
      setTitulo(item.tema || "");
      return;
    }
    await editar({ tema: t }, "titulo");
  };

  return (
    <li className="min-w-0" data-linha-do-mes={f}>
      <div className="flex min-w-0 items-center py-1.5">
        <span className="w-[76px] shrink-0 text-[12px] tabular-nums text-muted-foreground">{diaCurto(item.data)}</span>
        <ChipDoFormato formato={f} ocupado={ocupado === "formato"} onTrocar={podeEditar ? (novo) => void editar({ formato: novo }, "formato") : undefined} />
        <div className="ml-2 min-w-0 flex-1">
          {editando ? (
            <Input
              autoFocus
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
              onBlur={() => void salvarTitulo()}
              onKeyDown={(e) => {
                if (e.key === "Enter") void salvarTitulo();
                if (e.key === "Escape") {
                  setTitulo(item.tema || "");
                  setEditando(false);
                }
              }}
              className="h-7 text-[13px]"
              aria-label="Título do conteúdo"
            />
          ) : (
            <button
              type="button"
              onClick={() => setAberto((v) => !v)}
              aria-expanded={aberto}
              className="flex w-full min-w-0 items-center text-left"
            >
              <span className="min-w-0 truncate text-[13px] font-medium">{ocupado === "titulo" ? titulo : item.tema || item.gancho || "Sem título"}</span>
              <ChevronDown className={`ml-1 h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${aberto ? "rotate-180" : ""}`} />
            </button>
          )}
          {acoes.extra ? acoes.extra(item) : null}
        </div>
        <div className="ml-2 flex shrink-0 items-center">
          {podeEditar && !editando && (
            <button type="button" onClick={() => setEditando(true)} className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Editar título" title="Editar título">
              <Pencil className="h-3.5 w-3.5" />
            </button>
          )}
          {editando && (
            <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => { setTitulo(item.tema || ""); setEditando(false); }} className="rounded-md p-1.5 text-muted-foreground hover:bg-muted" aria-label="Cancelar edição">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
          {editavel && !item.task_id && item.tema_id && acoes.onRefazer && (
            <button
              type="button"
              disabled={!!ocupado}
              onClick={async () => {
                setOcupado("refazer");
                try {
                  await acoes.onRefazer!(item);
                } finally {
                  setOcupado("");
                }
              }}
              className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
              aria-label="Refazer este conteúdo"
              title="Refazer com outro ângulo"
            >
              {ocupado === "refazer" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            </button>
          )}
          {linkDaFoto ? (
            <Link to={linkDaFoto} className="inline-flex items-center rounded-md px-1.5 py-1 text-[11.5px] font-medium text-primary hover:bg-muted" aria-label="Abrir na Mesa Foto">
              Mesa Foto <ExternalLink className="ml-1 h-3 w-3" />
            </Link>
          ) : item.task_id && acoes.onAbrirNoEstudio ? (
            <button
              type="button"
              onClick={() => acoes.onAbrirNoEstudio!(item.task_id as string, mesDaData(item.data))}
              className="inline-flex items-center rounded-md px-1.5 py-1 text-[11.5px] font-medium text-primary hover:bg-muted"
              aria-label="Abrir no Estúdio"
            >
              Estúdio <ExternalLink className="ml-1 h-3 w-3" />
            </button>
          ) : null}
          {apagar && <BotaoDeApagar onApagar={apagar} className="ml-0.5" />}
        </div>
      </div>
      {aberto && <DetalheDoConteudo item={item} />}
    </li>
  );
}

/**
 * Uma lista por semana. `itensDaProposta` (na ordem gravada) dá o índice de
 * cada item para o link da Mesa Foto (`peca=<proposta>:<índice>`).
 */
export default function SemanasDoMes({
  itens,
  clientId,
  propostaId,
  itensDaProposta,
  editavel = false,
  acoes = {},
  esperadoPorSemana,
  className,
}: {
  itens: ItemProposto[];
  clientId: string;
  propostaId?: string | null;
  itensDaProposta?: ItemProposto[];
  editavel?: boolean;
  acoes?: AcoesDaLinha;
  /** Cadência pedida: o cabeçalho avisa a semana que ficou abaixo dela. */
  esperadoPorSemana?: number | null;
  className?: string;
}) {
  const semanas = semanasDosItens(itens);
  const base = itensDaProposta || itens;
  if (!itens.length) return null;
  return (
    <div className={juntar("min-w-0 space-y-3", className)} data-semanas-do-mes="">
      {semanas.map((s) => {
        const total = s.itens.length;
        const abaixo = !!esperadoPorSemana && total < esperadoPorSemana;
        return (
          <section key={s.semana} className="min-w-0" aria-label={s.inicio ? `Semana de ${dataCurtaDaSemana(s.inicio)}` : "Sem data"}>
            <p className="flex min-w-0 flex-wrap items-baseline border-b border-border/60 pb-1 text-[11.5px]" data-cabecalho-da-semana="">
              <span className="mr-2 font-semibold uppercase tracking-wide text-muted-foreground">{s.inicio ? `Semana de ${dataCurtaDaSemana(s.inicio)}` : "Sem data"}</span>
              <span className="text-muted-foreground">{resumoDaMistura(s.formatos)}</span>
              {abaixo && <span className="ml-2 text-warning">abaixo de {esperadoPorSemana} por semana</span>}
            </p>
            <ul className="min-w-0 divide-y divide-border/40">
              {s.itens.map((it, k) => (
                <LinhaDoConteudo
                  key={it.tema_id || `${it.data}-${k}`}
                  item={it}
                  clientId={clientId}
                  propostaId={propostaId}
                  indice={base.indexOf(it)}
                  editavel={editavel}
                  acoes={acoes}
                />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
