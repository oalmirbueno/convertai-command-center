import { useMemo } from "react";
import {
  addMonths, eachDayOfInterval, endOfMonth, endOfWeek, format, isSameMonth, startOfMonth, startOfWeek,
} from "date-fns";
import { ptBR } from "date-fns/locale";
import { Check, ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { foco, juntar, superficie } from "@/components/sistema";
import type { EditorialPostBundle } from "@/hooks/useEditorialCalendar";
import { dateKeyInTimeZone } from "@/lib/editorialDate";

/*
 * Trilho da Agenda (passada estrutural, 15/11/2026; dono: "idêntico às
 * referências"). No computador largo, à esquerda do calendário, como na
 * referência de calendário: o mês em miniatura (toque num dia leva o
 * calendário para ele), a lista do dia em forma de checklist (publicado fica
 * marcado e riscado) e o que vem a seguir. Lê só o que a página já carregou
 * (os conteúdos do período na tela); não consulta nada.
 */

const hora = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", hour12: false });
const chave = (dia: Date) => format(dia, "yyyy-MM-dd");
const SEMANA = ["S", "T", "Q", "Q", "S", "S", "D"];

type Linha = { id: string; post: EditorialPostBundle; titulo: string; quando: string; dia: string; publicado: boolean };

function linhasDe(posts: EditorialPostBundle[]): Linha[] {
  return posts
    .flatMap((post) => post.publications
      .filter(({ publication }) => publication.scheduled_at && publication.status !== "cancelled")
      .map(({ publication }) => ({
        id: publication.id,
        post,
        titulo: post.post.title,
        quando: publication.scheduled_at as string,
        dia: dateKeyInTimeZone(publication.scheduled_at as string) || "",
        publicado: publication.status === "published",
      })))
    .sort((a, b) => a.quando.localeCompare(b.quando));
}

function LinhaDoDia({ linha, comDia, onAbrir }: { linha: Linha; comDia?: boolean; onAbrir: (post: EditorialPostBundle) => void }) {
  return (
    <li className="min-w-0">
      <button
        type="button"
        onClick={() => onAbrir(linha.post)}
        className={juntar("flex w-full min-w-0 items-center rounded-md px-2 py-2 text-left transition-colors hover:bg-muted", foco)}
        title={linha.titulo}
      >
        <span
          className={juntar(
            "mr-3 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full",
            linha.publicado ? "bg-primary text-primary-foreground" : "border-[1.5px] border-foreground/40",
          )}
          aria-hidden="true"
        >
          {linha.publicado && <Check className="h-3 w-3" strokeWidth={3} />}
        </span>
        <span className={juntar("min-w-0 flex-1 truncate text-[13px] leading-5", linha.publicado ? "text-muted-foreground line-through" : "font-medium text-foreground")}>
          {linha.titulo}
        </span>
        <span className="ml-2 shrink-0 text-[11px] tabular-nums leading-4 text-muted-foreground">
          {comDia ? `${linha.dia.slice(8, 10)}/${linha.dia.slice(5, 7)}` : hora.format(new Date(linha.quando))}
        </span>
        {linha.publicado && <span className="sr-only">, publicado</span>}
      </button>
    </li>
  );
}

export default function TrilhoDaAgenda({
  dateKey,
  todayKey,
  semana,
  posts,
  carregando,
  podeCriar,
  onEscolherDia,
  onAbrir,
  onCriarNoDia,
}: {
  /** O dia âncora do calendário (o da URL). */
  dateKey: string;
  todayKey: string;
  /** Visão de semana: a semana do dia âncora ganha a faixa. */
  semana: boolean;
  posts: EditorialPostBundle[];
  carregando: boolean;
  podeCriar: boolean;
  onEscolherDia: (dateKey: string) => void;
  onAbrir: (post: EditorialPostBundle) => void;
  onCriarNoDia: (dateKey: string) => void;
}) {
  const ancora = useMemo(() => new Date(`${dateKey}T12:00:00`), [dateKey]);
  const dias = useMemo(() => {
    const inicio = startOfWeek(startOfMonth(ancora), { weekStartsOn: 1 });
    const todos = eachDayOfInterval({ start: inicio, end: endOfWeek(endOfMonth(ancora), { weekStartsOn: 1 }) });
    // Sempre 6 fileiras: o cartão não muda de altura de um mês para o outro.
    while (todos.length < 42) todos.push(new Date(todos[todos.length - 1].getTime() + 86_400_000));
    return todos;
  }, [ancora]);
  const linhas = useMemo(() => linhasDe(posts), [posts]);
  const comItem = useMemo(() => new Set(linhas.map((l) => l.dia)), [linhas]);
  const doDia = linhas.filter((l) => l.dia === dateKey);
  const aSeguir = linhas.filter((l) => l.dia > dateKey && !l.publicado).slice(0, 4);
  const semanaDaAncora = chave(startOfWeek(ancora, { weekStartsOn: 1 }));
  const nomeDoDia = dateKey === todayKey ? "Hoje" : format(ancora, "EEEE, d", { locale: ptBR });
  const feitos = doDia.filter((l) => l.publicado).length;

  return (
    // Rolagem (S1, 15/11): a lateral tem a altura do calendário ao lado (estica na linha e não empurra a
    // altura dela) e rola por dentro, com barra fina; só existe de 1280 px para cima, onde a página não rola.
    <aside className="relative hidden w-[272px] shrink-0 self-stretch xl:block" aria-label="Mês em miniatura e o dia" data-trilho-da-agenda="">
      <div className="rolagem-fina absolute -inset-x-2 -top-1 bottom-0 overflow-y-auto overflow-x-hidden px-2 pb-3 pt-1" data-rolagem-do-trilho="">
      <div className={juntar(superficie.painel, superficie.tinta, "p-5")}>
        <div className="mb-3 flex items-center">
          <p className="min-w-0 flex-1 truncate text-[15px] font-medium leading-6 tracking-[-0.01em] first-letter:uppercase">
            {format(ancora, "MMMM yyyy", { locale: ptBR })}
          </p>
          <button type="button" onClick={() => onEscolherDia(chave(addMonths(startOfMonth(ancora), -1)))} className={juntar("inline-flex h-7 w-7 items-center justify-center rounded-full bg-muted transition-colors hover:bg-foreground/20", foco)} aria-label="Mês anterior no trilho" title="Mês anterior">
            <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
          <button type="button" onClick={() => onEscolherDia(chave(addMonths(startOfMonth(ancora), 1)))} className={juntar("ml-1.5 inline-flex h-7 w-7 items-center justify-center rounded-full bg-muted transition-colors hover:bg-foreground/20", foco)} aria-label="Próximo mês no trilho" title="Próximo mês">
            <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
        <div className="grid grid-cols-7 text-center" aria-hidden="true">
          {SEMANA.map((d, i) => <span key={i} className="py-1 text-[11px] font-medium leading-4 opacity-55">{d}</span>)}
        </div>
        <div className="grid grid-cols-7 gap-y-0.5">
          {dias.map((dia, i) => {
            const k = chave(dia);
            const fora = !isSameMonth(dia, ancora);
            const hoje = k === todayKey;
            const escolhido = k === dateKey && !hoje;
            const naSemana = semana && chave(startOfWeek(dia, { weekStartsOn: 1 })) === semanaDaAncora;
            return (
              <span key={k} className={juntar("flex h-8 items-center justify-center", naSemana && "bg-muted", naSemana && i % 7 === 0 && "rounded-l-full", naSemana && i % 7 === 6 && "rounded-r-full")}>
                <button
                  type="button"
                  onClick={() => onEscolherDia(k)}
                  aria-label={`Ir para ${format(dia, "d 'de' MMMM", { locale: ptBR })}${comItem.has(k) ? ", com conteúdo" : ""}`}
                  aria-current={hoje ? "date" : undefined}
                  className={juntar(
                    "relative inline-flex h-7 w-7 items-center justify-center rounded-full text-[12px] tabular-nums leading-none transition-colors",
                    foco,
                    hoje ? "bg-primary font-semibold text-primary-foreground" : escolhido ? "bg-foreground font-semibold text-card" : "hover:bg-foreground/15",
                    fora && !hoje && "opacity-35",
                  )}
                >
                  {format(dia, "d")}
                  {comItem.has(k) && !hoje && !escolhido && <span className="absolute bottom-0.5 h-1 w-1 rounded-full bg-primary" aria-hidden="true" />}
                </button>
              </span>
            );
          })}
        </div>
      </div>

      <div className={juntar(superficie.painel, "mt-4 p-5")}>
        <div className="mb-2 flex items-center">
          <p className="min-w-0 flex-1 truncate text-[15px] font-medium leading-6 tracking-[-0.01em] text-foreground first-letter:uppercase">{nomeDoDia}</p>
          {doDia.length > 0 && <span className="mr-2 text-[12px] tabular-nums leading-4 text-muted-foreground">{feitos}/{doDia.length}</span>}
          {podeCriar && (
            <button type="button" onClick={() => onCriarNoDia(dateKey)} className={juntar("inline-flex h-7 w-7 items-center justify-center rounded-full bg-muted text-foreground transition-colors hover:bg-foreground hover:text-background", foco)} aria-label="Criar conteúdo neste dia" title="Criar conteúdo neste dia">
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          )}
        </div>
        {carregando ? (
          <div className="space-y-2 py-1" aria-hidden="true">
            {[0, 1].map((i) => <div key={i} className="h-9 animate-pulse rounded-md bg-muted motion-reduce:animate-none" />)}
          </div>
        ) : doDia.length === 0 ? (
          <p className="ds-hatch flex h-[84px] items-center justify-center rounded-md text-[12px] leading-4 text-muted-foreground">Nada marcado</p>
        ) : (
          <ul className="-mx-2 min-w-0">
            {doDia.map((l) => <LinhaDoDia key={l.id} linha={l} onAbrir={onAbrir} />)}
          </ul>
        )}
      </div>

      {!carregando && aSeguir.length > 0 && (
        <div className={juntar(superficie.painel, "mt-4 p-5")}>
          <p className="mb-2 text-[15px] font-medium leading-6 tracking-[-0.01em] text-foreground">A seguir</p>
          <ul className="-mx-2 min-w-0">
            {aSeguir.map((l) => <LinhaDoDia key={l.id} linha={l} comDia onAbrir={onAbrir} />)}
          </ul>
        </div>
      )}
      </div>
    </aside>
  );
}
