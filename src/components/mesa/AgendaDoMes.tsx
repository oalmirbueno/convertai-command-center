import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Check, ChevronLeft, ChevronRight, Clock, Loader2, Palette, X } from "lucide-react";
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
  CLASSE_DO_TOM,
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
 * Agenda do mês (topo da aba Mês): o mesmo calendário da Agenda do painel
 * para o cliente aberto. A equipe seleciona os itens, vê o que já existe
 * (descrição, roteiro, estado no estúdio), pede ao agente para completar o
 * roteiro e a direção, e abre o item no Estúdio já pronto para gerar.
 */

const MAX_COMPLETAR = 12;
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

function SeloDoEstado({ selo }: { selo: Selo }) {
  return <span className={`shrink-0 rounded-full px-1.5 py-px text-[10px] leading-4 ${CLASSE_DO_TOM[selo.tom]}`}>{selo.rotulo}</span>;
}

function PilulaDoItem({ item, selo, marcado, onToggle }: { item: ItemDaAgenda; selo: Selo; marcado: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={marcado}
      title={`${item.title} · ${formatoDoItem(item.delivery_type)} · ${selo.rotulo}`}
      className={`flex w-full min-w-0 flex-col gap-0.5 rounded-lg border px-1.5 py-1 text-left transition-colors ${
        marcado ? "border-primary/60 bg-primary/[0.08]" : "border-border bg-background hover:border-primary/30"
      }`}
    >
      <span className="flex min-w-0 items-center gap-1">
        <span className={`flex h-3 w-3 shrink-0 items-center justify-center rounded-[4px] border ${marcado ? "border-primary bg-primary text-primary-foreground" : "border-border"}`}>
          {marcado && <Check className="h-2.5 w-2.5" />}
        </span>
        <span className="min-w-0 flex-1 truncate text-[11px] font-medium leading-4">{item.title}</span>
      </span>
      <span className="flex min-w-0 flex-wrap items-center gap-1">
        <SeloDoEstado selo={selo} />
      </span>
    </button>
  );
}

function PilulaDoPost({ post, onSelecionar }: { post: PostDaAgenda; onSelecionar: (() => void) | null }) {
  const conteudo = (
    <>
      <Clock className="h-3 w-3 shrink-0 opacity-60" />
      <span className="shrink-0 tabular-nums">{horaCurta(post.scheduled_at)}</span>
      <span className="min-w-0 flex-1 truncate">{post.titulo}</span>
    </>
  );
  const classe = `flex w-full min-w-0 items-center gap-1 rounded-lg px-1.5 py-1 text-left text-[10.5px] leading-4 ${
    post.status === "published" || post.status === "partially_published"
      ? "bg-success/10 text-foreground"
      : post.status === "failed"
        ? "bg-destructive/10 text-destructive"
        : "bg-secondary/70 text-muted-foreground"
  }`;
  const titulo = `${post.titulo} · ${rotuloDaPublicacao(post.status)} às ${horaCurta(post.scheduled_at)}`;
  if (onSelecionar) {
    return (
      <button type="button" onClick={onSelecionar} title={`${titulo} · selecionar o item`} className={`${classe} hover:ring-1 hover:ring-primary/30`}>
        {conteudo}
      </button>
    );
  }
  return <div title={titulo} className={classe}>{conteudo}</div>;
}

function RoteiroResumido({ roteiro }: { roteiro: RoteiroDoItem }) {
  if (!roteiro.detalhado) {
    return <p className="text-[11.5px] text-muted-foreground">Roteiro gravado numa proposta, sem os detalhes deste item.</p>;
  }
  const texto = roteiro.copy || roteiro.legenda || roteiro.resumo;
  return (
    <div className="space-y-2 rounded-lg bg-secondary/40 p-2.5">
      <p className="text-[10.5px] font-medium uppercase tracking-wider text-muted-foreground">Roteiro</p>
      {roteiro.gancho && <p className="text-[12.5px] font-medium leading-snug [overflow-wrap:anywhere]">{roteiro.gancho}</p>}
      {texto && <p className="whitespace-pre-wrap text-[12px] leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">{resumir(texto, 320)}</p>}
      {roteiro.cta && <p className="text-[11.5px] text-muted-foreground [overflow-wrap:anywhere]">CTA: {roteiro.cta}</p>}
      {roteiro.cards.length > 0 && (
        <ol className="space-y-1.5">
          {roteiro.cards.map((c, i) => (
            <li key={`${c.ordem}-${i}`} className="rounded-md bg-background/70 px-2 py-1.5">
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
  onTirar,
  onAbrir,
}: {
  item: ItemDaAgenda;
  selo: Selo;
  roteiro: RoteiroDoItem | undefined;
  posts: PostDaAgenda[];
  onTirar: () => void;
  onAbrir: (() => void) | null;
}) {
  const arte = ehFormatoDeArte(item.delivery_type);
  return (
    <li className="min-w-0 space-y-2 rounded-xl border border-border bg-card p-3">
      <div className="flex min-w-0 items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium leading-snug [overflow-wrap:anywhere]">{item.title}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
            <span>{dataCurta(item.due_date)}</span>
            <span>·</span>
            <span>{formatoDoItem(item.delivery_type)}</span>
            <SeloDoEstado selo={selo} />
          </p>
        </div>
        <Button type="button" variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={onTirar} aria-label="Tirar da seleção">
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
      {item.description && item.description.trim() ? (
        <p className="max-h-32 overflow-y-auto whitespace-pre-wrap text-[12px] leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">{item.description.trim()}</p>
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
    </li>
  );
}

export default function AgendaDoMes({ onAbrirNoEstudio }: { onAbrirNoEstudio?: (taskId: string, mes: string) => void }) {
  const mesa = useMesa();
  const { clientId, catalogo } = mesa;
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();

  const mesDaUrl = params.get("mes") || "";
  const [mes, setMes] = useState(MES_VALIDO.test(mesDaUrl) ? mesDaUrl : inicioDoMes());
  const [selecionados, setSelecionados] = useState<string[]>([]);

  const agenda = useAgendaDoMes(clientId, mes);
  const dados = agenda.data;

  // Trocar de mês limpa a seleção: ela vale só para o mês à vista.
  useEffect(() => {
    setSelecionados([]);
  }, [mes, clientId]);

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

  const postsPorDia = useMemo(() => {
    const m = new Map<string, PostDaAgenda[]>();
    for (const p of dados ? dados.posts : []) {
      const lista = m.get(p.dia) || [];
      lista.push(p);
      m.set(p.dia, lista);
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

  const itensPorId = useMemo(() => {
    const m = new Map<string, ItemDaAgenda>();
    for (const i of dados ? dados.itens : []) m.set(i.id, i);
    return m;
  }, [dados]);

  const semanas = useMemo(() => semanasDoMes(mes), [mes]);
  const hoje = hojeLocal();

  const seloDe = (item: ItemDaAgenda): Selo =>
    seloDoItem(item, dados ? dados.roteiros.get(item.id) : undefined, dados ? (dados.trabalhos.get(item.id) as TrabalhoDaAgenda | undefined) : undefined);

  const alternar = (id: string) =>
    setSelecionados((s) => (s.indexOf(id) >= 0 ? s.filter((x) => x !== id) : s.concat([id])));

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

  const pilulasDoDia = (dia: string) => {
    const itens = itensPorDia.get(dia) || [];
    const posts = postsPorDia.get(dia) || [];
    return (
      <>
        {itens.map((i) => (
          <PilulaDoItem key={i.id} item={i} selo={seloDe(i)} marcado={selecionados.indexOf(i.id) >= 0} onToggle={() => alternar(i.id)} />
        ))}
        {posts.map((p) => {
          const alvo = p.task_id && itensPorId.has(p.task_id) ? p.task_id : null;
          return <PilulaDoPost key={p.post_id} post={p} onSelecionar={alvo ? () => { if (selecionados.indexOf(alvo) < 0) alternar(alvo); } : null} />;
        })}
      </>
    );
  };

  const diasComConteudo = semanas
    .reduce((acc: string[], s) => acc.concat(s.filter((d): d is string => !!d)), [])
    .filter((d) => itensPorDia.has(d) || postsPorDia.has(d));

  const vazio = !!dados && dados.itens.length === 0 && dados.posts.length === 0;

  return (
    <section className="space-y-3">
      <TituloDeSecao
        acao={
          <Link to={`/calendario?client=${clientId}`} className="text-[11.5px] text-primary underline-offset-2 hover:underline">
            Abrir na Agenda
          </Link>
        }
      >
        Agenda do mês
      </TituloDeSecao>

      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={() => setMes(somarMeses(mes, -1))} aria-label="Mês anterior">
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <p className="min-w-[120px] text-center text-[13px] font-medium capitalize">{rotuloDoMes(mes)}</p>
        <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={() => setMes(somarMeses(mes, 1))} aria-label="Próximo mês">
          <ChevronRight className="h-4 w-4" />
        </Button>
        {agenda.isFetching && (
          <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" /> {agenda.isLoading ? "lendo a agenda" : "atualizando"}
          </span>
        )}
        {dados && !vazio && (
          <span className="ml-auto text-[11px] text-muted-foreground">
            {dados.itens.length} item(ns) · {dados.posts.length} post(s) agendado(s) ou publicado(s)
          </span>
        )}
      </div>

      {agenda.isError && <AvisoDeErro erro={agenda.error} />}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-2">
          {/* Computador: grade do mês, de segunda a domingo. */}
          <div className="hidden min-w-0 overflow-hidden rounded-xl border border-border bg-card md:block">
            <div className="grid grid-cols-7 border-b border-border bg-secondary/30">
              {DIAS_DA_SEMANA.map((d) => (
                <p key={d} className="min-w-0 px-2 py-1.5 text-[10.5px] font-medium uppercase tracking-wider text-muted-foreground">{d}</p>
              ))}
            </div>
            {semanas.map((semana, i) => (
              <div key={i} className="grid grid-cols-7 border-b border-border last:border-b-0">
                {semana.map((dia, j) => (
                  <div
                    key={dia || `vazio-${i}-${j}`}
                    className={`min-h-[92px] min-w-0 space-y-1 border-r border-border p-1.5 last:border-r-0 ${dia ? "" : "bg-secondary/20"}`}
                  >
                    {dia && (
                      <>
                        <p className={`text-[11px] tabular-nums ${dia === hoje ? "inline-flex h-5 w-5 items-center justify-center rounded-full bg-primary font-medium text-primary-foreground" : "text-muted-foreground"}`}>
                          {Number(dia.slice(8, 10))}
                        </p>
                        {pilulasDoDia(dia)}
                      </>
                    )}
                  </div>
                ))}
              </div>
            ))}
          </div>

          {/* Celular: lista por dia, só os dias com conteúdo. */}
          <div className="min-w-0 space-y-2 md:hidden">
            {diasComConteudo.map((dia) => (
              <div key={dia} className="min-w-0 rounded-xl border border-border bg-card p-2.5">
                <p className={`mb-1.5 text-[11.5px] font-medium ${dia === hoje ? "text-primary" : "text-muted-foreground"}`}>{dataCurta(dia)}{dia === hoje ? " · hoje" : ""}</p>
                <div className="min-w-0 space-y-1">{pilulasDoDia(dia)}</div>
              </div>
            ))}
          </div>

          {vazio && (
            <p className="rounded-xl border border-dashed border-border p-4 text-center text-[12.5px] text-muted-foreground">
              Nada na agenda deste mês. Planeje abaixo com o estrategista ou crie o item na Agenda.
            </p>
          )}

          <p className="flex flex-wrap items-center gap-1.5 text-[11px] leading-relaxed text-muted-foreground">
            <span>Selos:</span>
            <SeloDoEstado selo={{ rotulo: "sem roteiro", tom: "neutro" }} />
            <SeloDoEstado selo={{ rotulo: "roteiro pronto", tom: "roteiro" }} />
            <SeloDoEstado selo={{ rotulo: "direção pronta", tom: "direcao" }} />
            <SeloDoEstado selo={{ rotulo: "arte em produção", tom: "producao" }} />
            <SeloDoEstado selo={{ rotulo: "arte pronta", tom: "pronto" }} />
            <SeloDoEstado selo={{ rotulo: "entregue ou em aprovação", tom: "entregue" }} />
            <span className="[overflow-wrap:anywhere]">Clique num item para selecionar. Pílula com relógio é post agendado ou publicado.</span>
          </p>
        </div>

        <aside className="min-w-0 space-y-3">
          <div className="space-y-2.5 rounded-xl border border-border bg-card p-3">
            <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Selecionados ({escolhidos.length})
            </p>
            {escolhidos.length === 0 ? (
              <p className="text-[12px] leading-relaxed text-muted-foreground">
                Selecione itens no calendário para ver o que já existe, completar com o agente e abrir no Estúdio.
              </p>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <BotaoComCusto
                  rotulo={`Completar com o agente (${Math.min(idsParaCompletar.length, MAX_COMPLETAR)})`}
                  titulo="Completar com o agente"
                  descricao="O estrategista escreve o roteiro completo de cada item (gancho, copy e o texto de cada card) sem trocar o tema, a data nem o formato, e deixa a direção pronta no Estúdio."
                  disabled={idsParaCompletar.length === 0 || demais}
                  fecharAoConfirmar
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
                  <Button type="button" size="sm" variant="outline" onClick={() => abrirNoEstudio(unicoDeArte)}>
                    <Palette className="mr-1.5 h-3.5 w-3.5" /> Abrir no Estúdio
                  </Button>
                )}
                <Button type="button" size="sm" variant="ghost" onClick={() => setSelecionados([])}>Limpar</Button>
              </div>
            )}
            {demais && <p className="text-[11.5px] text-muted-foreground">O agente completa até {MAX_COMPLETAR} itens por vez. Tire alguns da seleção.</p>}
            {foraDoEstudio > 0 && (
              <p className="text-[11.5px] text-muted-foreground">
                {foraDoEstudio} item(ns) em formato fora do estúdio: o agente completa só carrossel, post estático e design.
              </p>
            )}
          </div>

          {escolhidos.length > 0 && (
            <ul className="space-y-2 lg:max-h-[640px] lg:overflow-y-auto">
              {escolhidos.map((i) => (
                <ItemSelecionado
                  key={i.id}
                  item={i}
                  selo={seloDe(i)}
                  roteiro={dados ? dados.roteiros.get(i.id) : undefined}
                  posts={postsPorItem.get(i.id) || []}
                  onTirar={() => alternar(i.id)}
                  onAbrir={ehFormatoDeArte(i.delivery_type) ? () => abrirNoEstudio(i) : null}
                />
              ))}
            </ul>
          )}
        </aside>
      </div>
    </section>
  );
}
