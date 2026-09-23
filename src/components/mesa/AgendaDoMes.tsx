import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { CalendarDays, CalendarRange, ChevronDown, ChevronLeft, ChevronRight, Clock, List, Loader2, Palette, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ArteDoEstudioNaAgenda } from "@/hooks/useEditorialCalendar";
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
import { useArtesDoMes, SEM_ARTES } from "./MesArtes";
import {
  CartaoDoItem,
  CartaoDoPost,
  formatoDoItem,
  horaCurta,
  LEGENDA_DAS_CORES,
  SeloDaArte,
  SeloDiscreto,
  type TamanhoDoCartao,
} from "./MesCartoes";
import {
  doItem,
  ehFormatoDeArte,
  rotuloDaPublicacao,
  seloDoItem,
  useAgendaDoMes,
  type ItemDaAgenda,
  type PostDaAgenda,
  type RoteiroDoItem,
  type Selo,
  type TrabalhoDaAgenda,
} from "./useAgendaDoMes";

/**
 * Agenda do mês (aba Mês): o mesmo calendário da Agenda do painel para o
 * cliente aberto, com as mesmas cores, miniaturas e selos. Três vistas:
 * Mês (grade com dias de largura confortável, rolando de lado se a tela for
 * estreita, nunca espremida), Semana (sete colunas com cartões grandes) e
 * Lista (dia a dia, cartões grandes). O título aparece inteiro até 3 linhas
 * e completo no tooltip.
 *
 * A equipe seleciona os itens, vê o que já existe (descrição, roteiro,
 * estado no estúdio), pede ao agente para completar e melhorar o roteiro e a
 * direção e abre o item no Estúdio já pronto. O painel da seleção fica abaixo
 * do calendário, para não roubar largura dos dias.
 *
 * O mês mora no endereço (?mes=AAAA-MM-01), igual às outras abas, e a
 * seleção fica guardada por cliente e mês na sessão do navegador.
 */

const MAX_COMPLETAR = 12;
/** Quantas entradas cada dia mostra na grade do mês antes do "+N". */
const POR_DIA = 3;
const DIAS_DA_SEMANA = ["seg", "ter", "qua", "qui", "sex", "sáb", "dom"];
const MES_VALIDO = /^\d{4}-\d{2}-01$/;
/** Largura mínima da grade: 7 dias de 150 px. Abaixo disso a grade rola de lado. */
export const LARGURA_MINIMA_DA_GRADE = "min-w-[1050px]";

type Vista = "mes" | "semana" | "lista";
const CHAVE_DA_VISTA = "mesa:agenda:vista";

function lerVista(): Vista {
  try {
    const v = window.localStorage.getItem(CHAVE_DA_VISTA);
    return v === "semana" || v === "lista" ? v : "mes";
  } catch {
    return "mes";
  }
}

const resumir = (t: string | undefined, max: number) => {
  if (!t) return "";
  const limpo = t.trim();
  return limpo.length > max ? `${limpo.slice(0, max).trim()}…` : limpo;
};

const mesDoItem = (item: ItemDaAgenda, padrao: string) =>
  item.due_date && item.due_date.length >= 7 ? `${item.due_date.slice(0, 7)}-01` : padrao;

const diaPorExtenso = (dia: string) => {
  const d = new Date(`${dia}T12:00:00`);
  return Number.isNaN(d.getTime()) ? dia : d.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" });
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
export function semanasDoMes(mes: string): (string | null)[][] {
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
  arte,
  roteiro,
  posts,
  abertoDeInicio,
  onTirar,
  onAbrir,
}: {
  item: ItemDaAgenda;
  selo: Selo;
  arte: ArteDoEstudioNaAgenda | null;
  roteiro: RoteiroDoItem | undefined;
  posts: PostDaAgenda[];
  abertoDeInicio: boolean;
  onTirar: () => void;
  onAbrir: (() => void) | null;
}) {
  const [aberto, setAberto] = useState(abertoDeInicio);
  const deArte = ehFormatoDeArte(item.delivery_type);
  return (
    <li className="min-w-0 rounded-xl border border-border bg-card">
      <div className="flex min-w-0 items-start px-3 py-2.5">
        <button type="button" onClick={() => setAberto((v) => !v)} className="flex min-w-0 flex-1 items-start text-left" aria-expanded={aberto}>
          <ChevronDown className={`mr-1.5 mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform ${aberto ? "" : "-rotate-90"}`} />
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] font-medium leading-snug [overflow-wrap:anywhere]">{item.title}</span>
            <span className="mt-0.5 block text-[11.5px] text-muted-foreground">
              {dataCurta(item.due_date)} · {formatoDoItem(item.delivery_type)}
            </span>
            {arte ? <SeloDaArte arte={arte} className="mt-1" /> : <SeloDiscreto selo={selo} className="mt-1" />}
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
          {deArte ? (
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

const VISTAS: { valor: Vista; rotulo: string; Icone: typeof CalendarDays }[] = [
  { valor: "mes", rotulo: "Mês", Icone: CalendarDays },
  { valor: "semana", rotulo: "Semana", Icone: CalendarRange },
  { valor: "lista", rotulo: "Lista", Icone: List },
];

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

  const [vista, setVista] = useState<Vista>(lerVista);
  const trocarVista = (v: Vista) => {
    setVista(v);
    try {
      window.localStorage.setItem(CHAVE_DA_VISTA, v);
    } catch {
      /* sem armazenamento: vale só nesta visita */
    }
  };

  const [selecionados, mudarSelecao] = useSelecaoGuardada(clientId, mes);
  const [diasAbertos, setDiasAbertos] = useState<Record<string, boolean>>({});
  // Semana escolhida dentro do mês (-1 = a última, ao voltar do mês seguinte).
  const [semanaEscolhida, setSemanaEscolhida] = useState<{ mes: string; indice: number } | null>(null);

  const agenda = useAgendaDoMes(clientId, mes);
  const dados = agenda.data;

  const artes = useArtesDoMes(
    clientId,
    mes,
    dados ? dados.itens.map((i) => i.id) : [],
    dados ? dados.posts.map((p) => ({ post_id: p.post_id, arquivo_id: p.arquivo_id || null })) : [],
  );
  const mapaDeArtes = artes.data || SEM_ARTES;
  const arteDoItem = (id: string): ArteDoEstudioNaAgenda | null => doItem(mapaDeArtes.porItem, id) || null;
  const arteDoPost = (id: string): ArteDoEstudioNaAgenda | null => doItem(mapaDeArtes.porPost, id) || null;

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

  // Post ligado a um item da agenda aparece dentro do cartão do item (cor da
  // etapa e horário); só os posts soltos ganham cartão próprio.
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
  const mesAtual = inicioDoMes();

  const indiceDaSemana = (() => {
    if (semanaEscolhida && semanaEscolhida.mes === mes) {
      return semanaEscolhida.indice < 0 ? semanas.length - 1 : Math.min(semanaEscolhida.indice, semanas.length - 1);
    }
    for (let i = 0; i < semanas.length; i++) if (semanas[i].indexOf(hoje) >= 0) return i;
    return 0;
  })();

  const seloDe = (item: ItemDaAgenda): Selo =>
    seloDoItem(item, dados ? doItem(dados.roteiros, item.id) : undefined, dados ? (doItem(dados.trabalhos, item.id) as TrabalhoDaAgenda | undefined) : undefined);

  const resumoDe = (item: ItemDaAgenda): string | null => {
    const r = dados ? doItem(dados.roteiros, item.id) : undefined;
    const texto = (r && (r.gancho || r.tema)) || (item.description || "").trim();
    return texto ? resumir(texto, 220) : null;
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
    void queryClient.invalidateQueries({ queryKey: ["mesa", "artes-do-mes", clientId] });
    void queryClient.invalidateQueries({ queryKey: ["mesa", "itens-do-mes", clientId] });
  };

  const irParaSelecao = () => {
    try {
      const el = document.getElementById("selecao-do-mes");
      if (el) el.scrollIntoView({ block: "start" });
    } catch {
      /* navegador sem rolagem suave: nada a fazer */
    }
  };

  const unicoDeArte = deArte.length === 1 ? deArte[0] : null;

  /** Cartões de um dia: itens primeiro, depois os posts soltos. */
  const entradasDoDia = (dia: string, tamanho: TamanhoDoCartao, limitar: boolean) => {
    const itens = itensPorDia.get(dia) || [];
    const posts = postsSoltosPorDia.get(dia) || [];
    const total = itens.length + posts.length;
    const aberto = !limitar || !!diasAbertos[dia];
    const maxItens = aberto ? itens.length : Math.min(itens.length, POR_DIA);
    const maxPosts = aberto ? posts.length : Math.max(0, Math.min(posts.length, POR_DIA - maxItens));
    const escondidos = total - maxItens - maxPosts;
    return (
      <div className={`min-w-0 ${tamanho === "grande" ? "space-y-2" : "space-y-1.5"}`}>
        {itens.slice(0, maxItens).map((i) => {
          const doItemPosts = postsPorItem.get(i.id) || [];
          const post = doItemPosts.length ? doItemPosts[0] : null;
          return (
            <CartaoDoItem
              key={i.id}
              item={i}
              selo={seloDe(i)}
              arte={arteDoItem(i.id) || (post ? arteDoPost(post.post_id) : null)}
              post={post}
              marcado={selecionados.indexOf(i.id) >= 0}
              onToggle={() => alternar(i.id)}
              tamanho={tamanho}
              resumo={tamanho === "grande" ? resumoDe(i) : null}
            />
          );
        })}
        {posts.slice(0, maxPosts).map((p) => <CartaoDoPost key={p.post_id} post={p} arte={arteDoPost(p.post_id)} tamanho={tamanho} />)}
        {limitar && (escondidos > 0 || (aberto && total > POR_DIA)) && (
          <button
            type="button"
            onClick={() => setDiasAbertos((d) => ({ ...d, [dia]: !aberto }))}
            className="w-full rounded-md px-1 py-1 text-left text-[11.5px] font-medium text-primary hover:bg-primary/10"
          >
            {aberto ? "mostrar menos" : `+${escondidos} neste dia`}
          </button>
        )}
      </div>
    );
  };

  const diasDoMes = semanas.reduce((acc: string[], s) => acc.concat(s.filter((d): d is string => !!d)), []);
  const diasComConteudo = diasDoMes.filter((d) => itensPorDia.has(d) || postsSoltosPorDia.has(d));

  const vazio = !!dados && dados.itens.length === 0 && dados.posts.length === 0;

  const voltar = () => {
    if (vista === "semana") {
      if (indiceDaSemana > 0) setSemanaEscolhida({ mes, indice: indiceDaSemana - 1 });
      else {
        const anterior = somarMeses(mes, -1);
        setSemanaEscolhida({ mes: anterior, indice: -1 });
        setMes(anterior);
      }
      return;
    }
    setMes(somarMeses(mes, -1));
  };
  const avancar = () => {
    if (vista === "semana") {
      if (indiceDaSemana < semanas.length - 1) setSemanaEscolhida({ mes, indice: indiceDaSemana + 1 });
      else {
        const proximo = somarMeses(mes, 1);
        setSemanaEscolhida({ mes: proximo, indice: 0 });
        setMes(proximo);
      }
      return;
    }
    setMes(somarMeses(mes, 1));
  };
  const irParaHoje = () => {
    setSemanaEscolhida(null);
    setMes(mesAtual);
  };

  const semanaAtual = semanas[indiceDaSemana] || [];
  const diasDaSemanaEscolhida = semanaAtual.filter((d): d is string => !!d);
  const rotuloDaSemana = diasDaSemanaEscolhida.length
    ? `${Number(diasDaSemanaEscolhida[0].slice(8, 10))} a ${Number(diasDaSemanaEscolhida[diasDaSemanaEscolhida.length - 1].slice(8, 10))}`
    : "";

  const cabecalhoDosDias = (
    <div className="grid grid-cols-7 border-b border-border bg-muted">
      {DIAS_DA_SEMANA.map((d, i) => (
        <p key={d} className={`min-w-0 px-2.5 py-2 text-[11px] font-medium uppercase tracking-wider ${i >= 5 ? "text-muted-foreground/70" : "text-muted-foreground"}`}>
          {d}
        </p>
      ))}
    </div>
  );

  const numeroDoDia = (dia: string) => (
    <span
      className={`inline-flex h-7 min-w-[28px] items-center justify-center rounded-full px-1 text-[12.5px] tabular-nums ${
        dia === hoje ? "bg-primary font-semibold text-primary-foreground" : "text-muted-foreground"
      }`}
    >
      {Number(dia.slice(8, 10))}
    </span>
  );

  // Grade do mês: cada dia com pelo menos 150 px; em tela estreita a grade
  // rola de lado dentro do próprio cartão, nunca espreme os dias.
  const gradeDoMes = (
    <div className="overflow-x-auto overscroll-x-contain" data-vista="mes">
      <div className={LARGURA_MINIMA_DA_GRADE}>
        {cabecalhoDosDias}
        {semanas.map((semana, i) => (
          <div key={i} className="grid grid-cols-7 border-b border-border last:border-b-0">
            {semana.map((dia, j) => (
              <div
                key={dia || `vazio-${i}-${j}`}
                data-dia={dia || undefined}
                className={`min-h-[150px] min-w-0 border-r border-border p-2 last:border-r-0 ${dia ? (j >= 5 ? "bg-muted/40" : "bg-card") : "bg-muted"}`}
              >
                {dia && (
                  <>
                    <p className="mb-1.5 flex items-center">{numeroDoDia(dia)}</p>
                    {entradasDoDia(dia, "mes", true)}
                  </>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );

  // Semana: sete colunas com cartões grandes, sem limite por dia.
  const gradeDaSemana = (
    <div className="overflow-x-auto overscroll-x-contain" data-vista="semana">
      <div className="min-w-[1190px]">
        {cabecalhoDosDias}
        <div className="grid grid-cols-7">
          {semanaAtual.map((dia, j) => (
            <div
              key={dia || `vazio-${j}`}
              data-dia={dia || undefined}
              className={`min-h-[360px] min-w-0 border-r border-border p-2 last:border-r-0 ${dia ? (j >= 5 ? "bg-muted/40" : "bg-card") : "bg-muted"}`}
            >
              {dia && (
                <>
                  <p className="mb-2 flex items-center">{numeroDoDia(dia)}</p>
                  <div className="max-h-[70vh] overflow-y-auto overscroll-contain pr-0.5">{entradasDoDia(dia, "mes", false)}</div>
                </>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  // Lista: só os dias com conteúdo, cartões grandes; rolagem própria.
  const lista = (
    <div className="max-h-[75vh] min-w-0 divide-y divide-border overflow-y-auto overscroll-contain" data-vista="lista">
      {diasComConteudo.map((dia) => (
        <div key={dia} className="min-w-0 px-3 py-3 md:flex md:px-4">
          <p className={`mb-2 text-[12.5px] font-medium first-letter:uppercase md:mb-0 md:mr-4 md:w-36 md:shrink-0 md:pt-1 ${dia === hoje ? "text-primary" : "text-muted-foreground"}`}>
            {diaPorExtenso(dia)}
            {dia === hoje ? " · hoje" : ""}
          </p>
          <div className="min-w-0 flex-1">
            <div className="grid grid-cols-1 gap-2 lg:grid-cols-2 2xl:grid-cols-3">
              {(itensPorDia.get(dia) || []).map((i) => {
                const doItemPosts = postsPorItem.get(i.id) || [];
                const post = doItemPosts.length ? doItemPosts[0] : null;
                return (
                  <CartaoDoItem
                    key={i.id}
                    item={i}
                    selo={seloDe(i)}
                    arte={arteDoItem(i.id) || (post ? arteDoPost(post.post_id) : null)}
                    post={post}
                    marcado={selecionados.indexOf(i.id) >= 0}
                    onToggle={() => alternar(i.id)}
                    tamanho="grande"
                    resumo={resumoDe(i)}
                  />
                );
              })}
              {(postsSoltosPorDia.get(dia) || []).map((p) => (
                <CartaoDoPost key={p.post_id} post={p} arte={arteDoPost(p.post_id)} tamanho="grande" />
              ))}
            </div>
          </div>
        </div>
      ))}
    </div>
  );

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

      <div className="min-w-0 overflow-hidden rounded-xl border border-border bg-card">
        {/* Cabeçalho: mês (ou semana), vistas, contagem e seleção. */}
        <div className="flex min-w-0 flex-wrap items-center border-b border-border px-2 py-2">
          <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={voltar} aria-label={vista === "semana" ? "Semana anterior" : "Mês anterior"}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <p className="mx-1 min-w-[140px] text-center text-[14.5px] font-semibold capitalize">
            {rotuloDoMes(mes)}
            {vista === "semana" && rotuloDaSemana && <span className="ml-1.5 text-[12px] font-normal normal-case text-muted-foreground">dias {rotuloDaSemana}</span>}
          </p>
          <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={avancar} aria-label={vista === "semana" ? "Próxima semana" : "Próximo mês"}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          {(mes !== mesAtual || (vista === "semana" && semanaAtual.indexOf(hoje) < 0)) && (
            <Button type="button" variant="outline" size="sm" className="ml-1 h-7 px-2 text-[11.5px]" onClick={irParaHoje}>
              Hoje
            </Button>
          )}
          <div role="tablist" aria-label="Vista da agenda" className="ml-2 hidden rounded-lg bg-muted p-0.5 md:flex">
            {VISTAS.map((v) => (
              <button
                key={v.valor}
                type="button"
                role="tab"
                aria-selected={vista === v.valor}
                onClick={() => trocarVista(v.valor)}
                className={`inline-flex h-7 items-center rounded-md px-2.5 text-[12px] font-medium ${
                  vista === v.valor ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <v.Icone className="mr-1 h-3.5 w-3.5" />
                {v.rotulo}
              </button>
            ))}
          </div>
          <span className="ml-auto flex min-w-0 items-center px-2 text-[11.5px] text-muted-foreground">
            {agenda.isFetching ? (
              <>
                <Loader2 className="mr-1 h-3 w-3 animate-spin" /> {agenda.isLoading ? "lendo a agenda" : "atualizando"}
              </>
            ) : dados && !vazio ? (
              `${dados.itens.length} ${dados.itens.length === 1 ? "item" : "itens"} · ${dados.posts.length} ${dados.posts.length === 1 ? "post" : "posts"}`
            ) : null}
          </span>
          {escolhidos.length > 0 && (
            <Button type="button" size="sm" variant="secondary" className="mr-1 h-7 px-2.5 text-[11.5px]" onClick={irParaSelecao}>
              {escolhidos.length} {escolhidos.length === 1 ? "selecionado" : "selecionados"}
            </Button>
          )}
        </div>

        {vista === "lista" ? (
          lista
        ) : (
          <>
            {/* Computador: a vista escolhida. */}
            <div className="hidden min-w-0 md:block">{vista === "semana" ? gradeDaSemana : gradeDoMes}</div>
            {/* Celular: lista por dia, cartões grandes. */}
            <div className="min-w-0 md:hidden">{lista}</div>
          </>
        )}

        {vazio && (
          <p className="px-4 py-8 text-center text-[12.5px] text-muted-foreground">
            Nada na agenda deste mês. Planeje abaixo com o estrategista ou crie o item na Agenda.
          </p>
        )}

        <div className="flex min-w-0 flex-wrap items-center border-t border-border bg-muted px-3 py-2">
          {LEGENDA_DAS_CORES.map((c) => (
            <span key={c.rotulo} className="my-0.5 mr-3 flex items-center text-[11px] text-muted-foreground">
              <span className={`mr-1.5 h-2 w-2 shrink-0 rounded-full ${c.ponto}`} />
              {c.rotulo}
            </span>
          ))}
          <span className="my-0.5 flex items-center text-[11px] text-muted-foreground">
            <Clock className="mr-1 h-3 w-3" /> horário do post
          </span>
        </div>
      </div>

      {/* Seleção: abaixo do calendário, na largura toda, com rolagem própria. */}
      <div id="selecao-do-mes" className="scroll-mt-40 overflow-hidden rounded-xl border border-border bg-card">
        <div className="flex min-w-0 flex-wrap items-center border-b border-border px-3 py-2.5">
          <p className="mr-3 min-w-0 text-[13px] font-medium">
            Selecionados
            <span className="ml-1.5 rounded-full bg-muted px-2 py-0.5 text-[11px] font-normal text-muted-foreground">{escolhidos.length}</span>
          </p>
          {escolhidos.length > 0 && (
            <div className="ml-auto flex flex-wrap items-center">
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
                className="my-0.5 mr-1.5 h-8 text-[12.5px]"
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
                <Button type="button" size="sm" variant="outline" className="my-0.5 mr-1.5 h-8 text-[12.5px]" onClick={() => abrirNoEstudio(unicoDeArte)}>
                  <Palette className="mr-1.5 h-3.5 w-3.5" /> Abrir no Estúdio
                </Button>
              )}
              <Button type="button" size="sm" variant="ghost" className="my-0.5 h-8 px-2 text-[12px]" onClick={limpar}>
                Limpar
              </Button>
            </div>
          )}
        </div>

        {escolhidos.length === 0 ? (
          <p className="px-3 py-3 text-[12.5px] leading-relaxed text-muted-foreground">
            Clique nos itens do calendário para ver o que já existe, completar e melhorar com o agente e abrir no Estúdio. A seleção fica guardada neste mês.
          </p>
        ) : (
          <>
            {(demais || foraDoEstudio > 0) && (
              <div className="space-y-1 border-b border-border px-3 py-2">
                {demais && <p className="text-[11.5px] text-muted-foreground">O agente completa até {MAX_COMPLETAR} itens por vez. Tire alguns da seleção.</p>}
                {foraDoEstudio > 0 && (
                  <p className="text-[11.5px] leading-snug text-muted-foreground">
                    {foraDoEstudio} item(ns) em formato fora do estúdio: o agente completa só carrossel, post estático e design.
                  </p>
                )}
              </div>
            )}
            <ul className="grid max-h-[560px] grid-cols-1 gap-2 overflow-y-auto overscroll-contain p-3 lg:grid-cols-2">
              {escolhidos.map((i) => (
                <ItemSelecionado
                  key={i.id}
                  item={i}
                  selo={seloDe(i)}
                  arte={arteDoItem(i.id)}
                  roteiro={dados ? doItem(dados.roteiros, i.id) : undefined}
                  posts={postsPorItem.get(i.id) || []}
                  abertoDeInicio={escolhidos.length === 1}
                  onTirar={() => alternar(i.id)}
                  onAbrir={ehFormatoDeArte(i.delivery_type) ? () => abrirNoEstudio(i) : null}
                />
              ))}
            </ul>
          </>
        )}
      </div>
    </section>
  );
}
