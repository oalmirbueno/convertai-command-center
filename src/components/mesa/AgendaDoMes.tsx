import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown, ChevronLeft, ChevronRight, Clock, Loader2, Palette, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TASK_DELIVERY_TYPE_LABELS, type TaskDeliveryType } from "@/lib/taskDeliveryTypes";
import {
  chamarFuncao,
  dataCurta,
  inicioDoMes,
  padraoPara,
  rotuloDoMes,
  somarMeses,
  TAMANHOS,
} from "@/lib/mesa/api";
import { AvisoDeErro, BotaoComCusto, avisarCustoReal } from "./Custo";
import { useMesa } from "./MesaContexto";
import { TituloDeSecao } from "./Seletores";
import {
  ehFormatoDeArte,
  rotuloDaPublicacao,
  seloDoItem,
  useAgendaDoMes,
  type ItemDaAgenda,
  type PostDaAgenda,
  type RoteiroDoItem,
  type Selo,
  type TomDoSelo,
  type TrabalhoDaAgenda,
} from "./useAgendaDoMes";

/**
 * Agenda do mês (topo da aba Mês): o mesmo calendário da Agenda do painel
 * para o cliente aberto. A equipe seleciona os itens, vê o que já existe
 * (descrição, roteiro, estado no estúdio), pede ao agente para completar e
 * melhorar o roteiro e a direção, e abre o item no Estúdio já pronto.
 *
 * O mês mora no endereço (?mes=AAAA-MM-01), igual às outras abas, e a
 * seleção fica guardada por cliente e mês na sessão do navegador: quem sai
 * para recarregar a carteira e volta encontra os mesmos itens marcados.
 */

const MAX_COMPLETAR = 12;
/** Quantas entradas cada dia mostra antes do "+N". */
const POR_DIA = 3;
const DIAS_DA_SEMANA = ["seg", "ter", "qua", "qui", "sex", "sáb", "dom"];
const MES_VALIDO = /^\d{4}-\d{2}-01$/;

const formatoDoItem = (tipo: string) => TASK_DELIVERY_TYPE_LABELS[tipo as TaskDeliveryType] || tipo;

const horaCurta = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
};

const resumir = (t: string | undefined, max: number) => {
  if (!t) return "";
  const limpo = t.trim();
  return limpo.length > max ? `${limpo.slice(0, max).trim()}…` : limpo;
};

const mesDoItem = (item: ItemDaAgenda, padrao: string) =>
  item.due_date && item.due_date.length >= 7 ? `${item.due_date.slice(0, 7)}-01` : padrao;

/** Cor sólida do ponto de cada selo (discreto: ponto e texto pequeno). */
const PONTO_DO_TOM: Record<TomDoSelo, string> = {
  neutro: "bg-muted-foreground/60",
  roteiro: "bg-sky-500",
  direcao: "bg-violet-500",
  producao: "bg-amber-500",
  pronto: "bg-emerald-500",
  entregue: "bg-success",
  alerta: "bg-destructive",
};

// ------------------------------------------------------------------ seleção guardada

const chaveDaSelecao = (clientId: string, mes: string) => `mesa:selecao:${clientId}:${mes}`;

function lerSelecao(chave: string): string[] {
  try {
    const bruto = window.sessionStorage.getItem(chave);
    const v = bruto ? JSON.parse(bruto) : null;
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function gravarSelecao(chave: string, ids: string[]) {
  try {
    if (ids.length) window.sessionStorage.setItem(chave, JSON.stringify(ids));
    else window.sessionStorage.removeItem(chave);
  } catch {
    /* sessão indisponível: a seleção vale só enquanto a tela estiver aberta */
  }
}

/** Seleção por cliente e mês, lida e gravada na sessão do navegador. */
function useSelecaoGuardada(clientId: string, mes: string) {
  const chave = chaveDaSelecao(clientId, mes);
  const [estado, setEstado] = useState<{ chave: string; ids: string[] }>(() => ({ chave, ids: lerSelecao(chave) }));
  const ids = estado.chave === chave ? estado.ids : lerSelecao(chave);
  const mudar = (f: (atual: string[]) => string[]) =>
    setEstado((antes) => {
      const base = antes.chave === chave ? antes.ids : lerSelecao(chave);
      const novos = f(base);
      gravarSelecao(chave, novos);
      return { chave, ids: novos };
    });
  return [ids, mudar] as const;
}

// ------------------------------------------------------------------ calendário

/** Semanas do mês, de segunda a domingo; dia fora do mês vem como null. */
function semanasDoMes(mes: string): (string | null)[][] {
  const partes = mes.split("-").map(Number);
  const ano = partes[0];
  const m = partes[1] || 1;
  const total = new Date(ano, m, 0).getDate();
  const recuo = (new Date(ano, m - 1, 1).getDay() + 6) % 7;
  const celulas: (string | null)[] = [];
  for (let i = 0; i < recuo; i++) celulas.push(null);
  for (let d = 1; d <= total; d++) celulas.push(`${ano}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
  while (celulas.length % 7 !== 0) celulas.push(null);
  const semanas: (string | null)[][] = [];
  for (let i = 0; i < celulas.length; i += 7) semanas.push(celulas.slice(i, i + 7));
  return semanas;
}

function hojeLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function SeloDiscreto({ selo, className = "" }: { selo: Selo; className?: string }) {
  return (
    <span className={`flex min-w-0 items-center text-[11px] leading-4 text-muted-foreground ${className}`}>
      <span className={`mr-1.5 h-2 w-2 shrink-0 rounded-full ${PONTO_DO_TOM[selo.tom]}`} />
      <span className="truncate">{selo.rotulo}</span>
    </span>
  );
}

function PilulaDoItem({
  item,
  selo,
  marcado,
  horario,
  onToggle,
}: {
  item: ItemDaAgenda;
  selo: Selo;
  marcado: boolean;
  horario: string | null;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={marcado}
      title={`${item.title} · ${formatoDoItem(item.delivery_type)} · ${selo.rotulo}`}
      className={`flex w-full min-w-0 flex-col rounded-lg border px-2 py-1.5 text-left shadow-sm transition-colors ${
        marcado ? "border-primary bg-card ring-1 ring-primary" : "border-border bg-card hover:border-primary/60"
      }`}
    >
      <span className="flex min-w-0 items-start">
        <span
          className={`mr-1.5 mt-[2px] flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border ${
            marcado ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/50 bg-card"
          }`}
        >
          {marcado && <Check className="h-2.5 w-2.5" />}
        </span>
        <span className="line-clamp-2 min-w-0 flex-1 text-[12px] font-medium leading-[1.3] text-foreground [overflow-wrap:anywhere]">{item.title}</span>
      </span>
      <span className="mt-1 flex min-w-0 items-center">
        <SeloDiscreto selo={selo} className="flex-1" />
        {horario && (
          <span className="ml-1 flex shrink-0 items-center text-[10.5px] tabular-nums text-muted-foreground">
            <Clock className="mr-0.5 h-3 w-3" />
            {horario}
          </span>
        )}
      </span>
    </button>
  );
}

function PilulaDoPost({ post }: { post: PostDaAgenda }) {
  const publicado = post.status === "published" || post.status === "partially_published";
  const falhou = post.status === "failed";
  return (
    <div
      title={`${post.titulo} · ${rotuloDaPublicacao(post.status)} às ${horaCurta(post.scheduled_at)}`}
      className={`flex w-full min-w-0 items-start rounded-lg border px-2 py-1.5 text-[11.5px] leading-[1.3] ${
        falhou ? "border-destructive/50 bg-card text-destructive" : "border-border bg-muted text-muted-foreground"
      }`}
    >
      <Clock className={`mr-1 mt-[1px] h-3 w-3 shrink-0 ${publicado ? "text-success" : ""}`} />
      <span className="line-clamp-2 min-w-0 flex-1 [overflow-wrap:anywhere]">
        <span className="tabular-nums">{horaCurta(post.scheduled_at)}</span> {post.titulo}
      </span>
    </div>
  );
}

function RoteiroResumido({ roteiro }: { roteiro: RoteiroDoItem }) {
  if (!roteiro.detalhado) {
    return <p className="text-[11.5px] text-muted-foreground">Roteiro gravado numa proposta, sem os detalhes deste item.</p>;
  }
  const texto = roteiro.copy || roteiro.legenda || roteiro.resumo;
  return (
    <div className="space-y-2 rounded-lg border border-border bg-muted p-2.5">
      <p className="text-[10.5px] font-medium uppercase tracking-wider text-muted-foreground">Roteiro</p>
      {roteiro.gancho && <p className="text-[12.5px] font-medium leading-snug [overflow-wrap:anywhere]">{roteiro.gancho}</p>}
      {texto && <p className="whitespace-pre-wrap text-[12px] leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">{resumir(texto, 320)}</p>}
      {roteiro.cta && <p className="text-[11.5px] text-muted-foreground [overflow-wrap:anywhere]">CTA: {roteiro.cta}</p>}
      {roteiro.cards.length > 0 && (
        <ol className="space-y-1.5">
          {roteiro.cards.map((c, i) => (
            <li key={`${c.ordem}-${i}`} className="rounded-md border border-border bg-card px-2 py-1.5">
              <p className="text-[10.5px] font-medium text-muted-foreground">Card {c.ordem}{c.funcao ? ` · ${c.funcao}` : ""}</p>
              {c.texto && <p className="mt-0.5 text-[12px] leading-snug [overflow-wrap:anywhere]">{c.texto}</p>}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function ItemSelecionado({
  item,
  selo,
  roteiro,
  posts,
  abertoDeInicio,
  onTirar,
  onAbrir,
}: {
  item: ItemDaAgenda;
  selo: Selo;
  roteiro: RoteiroDoItem | undefined;
  posts: PostDaAgenda[];
  abertoDeInicio: boolean;
  onTirar: () => void;
  onAbrir: (() => void) | null;
}) {
  const [aberto, setAberto] = useState(abertoDeInicio);
  const arte = ehFormatoDeArte(item.delivery_type);
  return (
    <li className="min-w-0 bg-card">
      <div className="flex min-w-0 items-start px-3 py-2.5">
        <button type="button" onClick={() => setAberto((v) => !v)} className="flex min-w-0 flex-1 items-start text-left" aria-expanded={aberto}>
          <ChevronDown className={`mr-1.5 mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform ${aberto ? "" : "-rotate-90"}`} />
          <span className="min-w-0 flex-1">
            <span className="line-clamp-2 block text-[13px] font-medium leading-snug [overflow-wrap:anywhere]">{item.title}</span>
            <span className="mt-0.5 block text-[11.5px] text-muted-foreground">
              {dataCurta(item.due_date)} · {formatoDoItem(item.delivery_type)}
            </span>
            <SeloDiscreto selo={selo} className="mt-1" />
          </span>
        </button>
        <Button type="button" variant="ghost" size="icon" className="ml-1 h-7 w-7 shrink-0" onClick={onTirar} aria-label="Tirar da seleção">
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
      {aberto && (
        <div className="space-y-2.5 px-3 pb-3 pl-9">
          {item.description && item.description.trim() ? (
            <p className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded-lg border border-border bg-muted p-2.5 text-[12px] leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">
              {item.description.trim()}
            </p>
          ) : (
            <p className="text-[11.5px] text-muted-foreground">Sem descrição na agenda.</p>
          )}
          {roteiro && <RoteiroResumido roteiro={roteiro} />}
          {posts.length > 0 && (
            <p className="text-[11.5px] text-muted-foreground">
              {posts.map((p) => `${rotuloDaPublicacao(p.status)} em ${dataCurta(p.dia)} às ${horaCurta(p.scheduled_at)}`).join(" · ")}
            </p>
          )}
          {arte ? (
            onAbrir && (
              <Button type="button" size="sm" variant="outline" className="h-8 text-[12px]" onClick={onAbrir}>
                <Palette className="mr-1.5 h-3.5 w-3.5" /> Abrir no Estúdio
              </Button>
            )
          ) : (
            <p className="text-[11px] text-muted-foreground">Formato fora do estúdio.</p>
          )}
        </div>
      )}
    </li>
  );
}

export default function AgendaDoMes({ onAbrirNoEstudio }: { onAbrirNoEstudio?: (taskId: string, mes: string) => void }) {
  const mesa = useMesa();
  const { clientId, catalogo } = mesa;
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();

  const mesDaUrl = params.get("mes") || "";
  const mes = MES_VALIDO.test(mesDaUrl) ? mesDaUrl : inicioDoMes();
  const setMes = (m: string) => {
    const next = new URLSearchParams(params);
    next.set("mes", m);
    setParams(next, { replace: true });
  };

  const [selecionados, mudarSelecao] = useSelecaoGuardada(clientId, mes);
  const [diasAbertos, setDiasAbertos] = useState<Record<string, boolean>>({});

  const agenda = useAgendaDoMes(clientId, mes);
  const dados = agenda.data;

  const itensPorId = useMemo(() => {
    const m = new Map<string, ItemDaAgenda>();
    for (const i of dados ? dados.itens : []) m.set(i.id, i);
    return m;
  }, [dados]);

  const itensPorDia = useMemo(() => {
    const m = new Map<string, ItemDaAgenda[]>();
    for (const i of dados ? dados.itens : []) {
      const dia = i.due_date ? i.due_date.slice(0, 10) : "";
      if (!dia) continue;
      const lista = m.get(dia) || [];
      lista.push(i);
      m.set(dia, lista);
    }
    return m;
  }, [dados]);

  const postsPorItem = useMemo(() => {
    const m = new Map<string, PostDaAgenda[]>();
    for (const p of dados ? dados.posts : []) {
      if (!p.task_id) continue;
      const lista = m.get(p.task_id) || [];
      lista.push(p);
      m.set(p.task_id, lista);
    }
    return m;
  }, [dados]);

  // Post ligado a um item da agenda aparece como o horário na pílula do item;
  // só os posts soltos ganham pílula própria (menos coisa empilhada no dia).
  const postsSoltosPorDia = useMemo(() => {
    const m = new Map<string, PostDaAgenda[]>();
    for (const p of dados ? dados.posts : []) {
      if (p.task_id && itensPorId.has(p.task_id)) continue;
      const lista = m.get(p.dia) || [];
      lista.push(p);
      m.set(p.dia, lista);
    }
    return m;
  }, [dados, itensPorId]);

  const semanas = useMemo(() => semanasDoMes(mes), [mes]);
  const hoje = hojeLocal();

  const seloDe = (item: ItemDaAgenda): Selo =>
    seloDoItem(item, dados ? dados.roteiros.get(item.id) : undefined, dados ? (dados.trabalhos.get(item.id) as TrabalhoDaAgenda | undefined) : undefined);

  const horarioDe = (item: ItemDaAgenda): string | null => {
    const posts = postsPorItem.get(item.id) || [];
    return posts.length ? horaCurta(posts[0].scheduled_at) : null;
  };

  const alternar = (id: string) => mudarSelecao((s) => (s.indexOf(id) >= 0 ? s.filter((x) => x !== id) : s.concat([id])));
  const limpar = () => mudarSelecao(() => []);

  const escolhidos = selecionados.map((id) => itensPorId.get(id)).filter((i): i is ItemDaAgenda => !!i);
  const deArte = escolhidos.filter((i) => ehFormatoDeArte(i.delivery_type));
  const foraDoEstudio = escolhidos.length - deArte.length;
  const idsParaCompletar = deArte.map((i) => i.id);
  const demais = idsParaCompletar.length > MAX_COMPLETAR;
  const modeloEstrategista = padraoPara(catalogo, "estrategista");

  const abrirNoEstudio = (item: ItemDaAgenda) => {
    const mesAlvo = mesDoItem(item, mes);
    if (onAbrirNoEstudio) {
      onAbrirNoEstudio(item.id, mesAlvo);
      return;
    }
    const next = new URLSearchParams(params);
    next.set("aba", "estudio");
    next.set("task", item.id);
    next.set("mes", mesAlvo);
    setParams(next, { replace: false });
  };

  const atualizarAgenda = () => {
    void queryClient.invalidateQueries({ queryKey: ["mesa", "agenda-do-mes", clientId] });
    void queryClient.invalidateQueries({ queryKey: ["mesa", "itens-do-mes", clientId] });
  };

  const unicoDeArte = deArte.length === 1 ? deArte[0] : null;

  const entradasDoDia = (dia: string, limitar: boolean) => {
    const itens = itensPorDia.get(dia) || [];
    const posts = postsSoltosPorDia.get(dia) || [];
    const total = itens.length + posts.length;
    const aberto = !limitar || !!diasAbertos[dia];
    const maxItens = aberto ? itens.length : Math.min(itens.length, POR_DIA);
    const maxPosts = aberto ? posts.length : Math.max(0, Math.min(posts.length, POR_DIA - maxItens));
    const escondidos = total - maxItens - maxPosts;
    return (
      <div className="min-w-0 space-y-1">
        {itens.slice(0, maxItens).map((i) => (
          <PilulaDoItem
            key={i.id}
            item={i}
            selo={seloDe(i)}
            marcado={selecionados.indexOf(i.id) >= 0}
            horario={horarioDe(i)}
            onToggle={() => alternar(i.id)}
          />
        ))}
        {posts.slice(0, maxPosts).map((p) => <PilulaDoPost key={p.post_id} post={p} />)}
        {limitar && (escondidos > 0 || (aberto && total > POR_DIA)) && (
          <button
            type="button"
            onClick={() => setDiasAbertos((d) => ({ ...d, [dia]: !aberto }))}
            className="w-full rounded-md px-1 py-0.5 text-left text-[11px] font-medium text-primary hover:underline"
          >
            {aberto ? "mostrar menos" : `+${escondidos} ${escondidos === 1 ? "item" : "itens"}`}
          </button>
        )}
      </div>
    );
  };

  const diasComConteudo = semanas
    .reduce((acc: string[], s) => acc.concat(s.filter((d): d is string => !!d)), [])
    .filter((d) => itensPorDia.has(d) || postsSoltosPorDia.has(d));

  const vazio = !!dados && dados.itens.length === 0 && dados.posts.length === 0;
  const mesAtual = inicioDoMes();

  return (
    <section id="agenda-do-mes" className="scroll-mt-40 space-y-3">
      <TituloDeSecao
        acao={
          <Link to={`/calendario?client=${clientId}`} className="text-[12px] text-primary underline-offset-2 hover:underline">
            Abrir na Agenda
          </Link>
        }
      >
        Agenda do mês
      </TituloDeSecao>

      {agenda.isError && <AvisoDeErro erro={agenda.error} />}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 overflow-hidden rounded-xl border border-border bg-card">
          {/* Cabeçalho: mês, contagem e atalho para hoje. */}
          <div className="flex min-w-0 flex-wrap items-center border-b border-border px-2 py-2">
            <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => setMes(somarMeses(mes, -1))} aria-label="Mês anterior">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <p className="mx-1 min-w-[130px] text-center text-[14px] font-semibold capitalize">{rotuloDoMes(mes)}</p>
            <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => setMes(somarMeses(mes, 1))} aria-label="Próximo mês">
              <ChevronRight className="h-4 w-4" />
            </Button>
            {mes !== mesAtual && (
              <Button type="button" variant="outline" size="sm" className="ml-1 h-7 px-2 text-[11.5px]" onClick={() => setMes(mesAtual)}>
                Hoje
              </Button>
            )}
            <span className="ml-auto flex min-w-0 items-center px-2 text-[11.5px] text-muted-foreground">
              {agenda.isFetching ? (
                <>
                  <Loader2 className="mr-1 h-3 w-3 animate-spin" /> {agenda.isLoading ? "lendo a agenda" : "atualizando"}
                </>
              ) : dados && !vazio ? (
                `${dados.itens.length} ${dados.itens.length === 1 ? "item" : "itens"} · ${dados.posts.length} ${dados.posts.length === 1 ? "post" : "posts"}`
              ) : null}
            </span>
          </div>

          {/* Computador: grade do mês, de segunda a domingo. */}
          <div className="hidden min-w-0 md:block">
            <div className="grid grid-cols-7 border-b border-border bg-muted">
              {DIAS_DA_SEMANA.map((d, i) => (
                <p key={d} className={`min-w-0 px-2 py-1.5 text-[11px] font-medium uppercase tracking-wider ${i >= 5 ? "text-muted-foreground/70" : "text-muted-foreground"}`}>
                  {d}
                </p>
              ))}
            </div>
            {semanas.map((semana, i) => (
              <div key={i} className="grid grid-cols-7 border-b border-border last:border-b-0">
                {semana.map((dia, j) => (
                  <div
                    key={dia || `vazio-${i}-${j}`}
                    className={`min-h-[118px] min-w-0 border-r border-border p-1.5 last:border-r-0 ${dia ? (j >= 5 ? "bg-muted/60" : "bg-card") : "bg-muted"}`}
                  >
                    {dia && (
                      <>
                        <p className="mb-1 flex items-center">
                          <span
                            className={`inline-flex h-6 min-w-[24px] items-center justify-center rounded-full px-1 text-[12px] tabular-nums ${
                              dia === hoje ? "bg-primary font-semibold text-primary-foreground" : "text-muted-foreground"
                            }`}
                          >
                            {Number(dia.slice(8, 10))}
                          </span>
                        </p>
                        {entradasDoDia(dia, true)}
                      </>
                    )}
                  </div>
                ))}
              </div>
            ))}
          </div>

          {/* Celular: lista por dia, só os dias com conteúdo. */}
          <div className="min-w-0 divide-y divide-border md:hidden">
            {diasComConteudo.map((dia) => (
              <div key={dia} className="min-w-0 px-3 py-2.5">
                <p className={`mb-1.5 text-[12px] font-medium capitalize ${dia === hoje ? "text-primary" : "text-muted-foreground"}`}>
                  {dataCurta(dia)}{dia === hoje ? " · hoje" : ""}
                </p>
                {entradasDoDia(dia, false)}
              </div>
            ))}
          </div>

          {vazio && (
            <p className="px-4 py-8 text-center text-[12.5px] text-muted-foreground">
              Nada na agenda deste mês. Planeje abaixo com o estrategista ou crie o item na Agenda.
            </p>
          )}

          <div className="flex min-w-0 flex-wrap items-center border-t border-border bg-muted px-3 py-2">
            {(
              [
                { rotulo: "sem roteiro", tom: "neutro" },
                { rotulo: "roteiro pronto", tom: "roteiro" },
                { rotulo: "direção pronta", tom: "direcao" },
                { rotulo: "arte em produção", tom: "producao" },
                { rotulo: "arte pronta", tom: "pronto" },
                { rotulo: "entregue ou em aprovação", tom: "entregue" },
              ] as Selo[]
            ).map((s) => (
              <SeloDiscreto key={s.tom} selo={s} className="my-0.5 mr-3" />
            ))}
            <span className="my-0.5 flex items-center text-[11px] text-muted-foreground">
              <Clock className="mr-1 h-3 w-3" /> horário do post agendado
            </span>
          </div>
        </div>

        <aside className="min-w-0">
          <div className="overflow-hidden rounded-xl border border-border bg-card">
            <div className="flex items-center border-b border-border px-3 py-2.5">
              <p className="min-w-0 flex-1 text-[13px] font-medium">
                Selecionados
                <span className="ml-1.5 rounded-full bg-muted px-2 py-0.5 text-[11px] font-normal text-muted-foreground">{escolhidos.length}</span>
              </p>
              {escolhidos.length > 0 && (
                <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-[12px]" onClick={limpar}>
                  Limpar
                </Button>
              )}
            </div>

            {escolhidos.length === 0 ? (
              <p className="px-3 py-4 text-[12.5px] leading-relaxed text-muted-foreground">
                Clique nos itens do calendário para ver o que já existe, completar e melhorar com o agente e abrir no Estúdio. A seleção fica guardada neste mês.
              </p>
            ) : (
              <div className="space-y-2 border-b border-border px-3 py-3">
                <BotaoComCusto
                  rotulo={
                    <>
                      <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                      Completar e melhorar com o agente ({Math.min(idsParaCompletar.length, MAX_COMPLETAR)})
                    </>
                  }
                  titulo="Completar e melhorar com o agente"
                  descricao="O estrategista escreve e melhora o roteiro de cada item (gancho, copy e o texto de cada card) sem trocar o tema, a data nem o formato, e deixa a direção pronta no Estúdio."
                  disabled={idsParaCompletar.length === 0 || demais}
                  fecharAoConfirmar
                  className="h-9 w-full text-[12.5px]"
                  partes={() => [
                    {
                      modeloId: modeloEstrategista?.id,
                      tipo: "texto",
                      tokensEntrada: TAMANHOS.completarItem.entrada,
                      tokensSaida: TAMANHOS.completarItem.saidaPorItem * idsParaCompletar.length,
                    },
                  ]}
                  executar={() => chamarFuncao("agente-calendario", { acao: "completar_itens", client_id: clientId, task_ids: idsParaCompletar })}
                  aoConcluir={(data) => {
                    atualizarAgenda();
                    const n = Array.isArray(data?.itens) ? data.itens.length : 0;
                    const m = Number(data?.direcoes_prontas) || 0;
                    avisarCustoReal(`${n} roteiro(s) pronto(s), ${m} direção(ões) pronta(s) no Estúdio`, data, mesa.atualizarCusto);
                  }}
                />
                {unicoDeArte && (
                  <Button type="button" size="sm" variant="outline" className="h-9 w-full text-[12.5px]" onClick={() => abrirNoEstudio(unicoDeArte)}>
                    <Palette className="mr-1.5 h-3.5 w-3.5" /> Abrir no Estúdio
                  </Button>
                )}
                {demais && <p className="text-[11.5px] text-muted-foreground">O agente completa até {MAX_COMPLETAR} itens por vez. Tire alguns da seleção.</p>}
                {foraDoEstudio > 0 && (
                  <p className="text-[11.5px] leading-snug text-muted-foreground">
                    {foraDoEstudio} item(ns) em formato fora do estúdio: o agente completa só carrossel, post estático e design.
                  </p>
                )}
              </div>
            )}

            {escolhidos.length > 0 && (
              <ul className="max-h-[560px] divide-y divide-border overflow-y-auto overscroll-contain">
                {escolhidos.map((i) => (
                  <ItemSelecionado
                    key={i.id}
                    item={i}
                    selo={seloDe(i)}
                    roteiro={dados ? dados.roteiros.get(i.id) : undefined}
                    posts={postsPorItem.get(i.id) || []}
                    abertoDeInicio={escolhidos.length === 1}
                    onTirar={() => alternar(i.id)}
                    onAbrir={ehFormatoDeArte(i.delivery_type) ? () => abrirNoEstudio(i) : null}
                  />
                ))}
              </ul>
            )}
          </div>
        </aside>
      </div>
    </section>
  );
}
