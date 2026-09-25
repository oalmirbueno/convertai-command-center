import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Bot, CheckCircle2, ClipboardCopy, ListPlus, Loader2, RefreshCw, Send, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  aplicarRespostas, criarTarefaDoRitual, listarClientesDoAgente, prepararCliente, salvarEPublicarRitual,
  type Aplicado, type ClienteDoAgente, type Preparo,
} from "./agenteCentralApi";
import { avisoDeRepeticao, tarefasSugeridas, type TarefaSugerida } from "./ritualAvisos";

/**
 * Agente da Central: "Atualizar todos".
 *
 * Um botão: para cada cliente ativo (régua do Ciclo), o agente lê tudo,
 * atualiza o dossiê geral com a leitura organizada da semana e faz DUAS
 * perguntas. O dono responde tudo na mesma conversa (pode colar contexto),
 * o agente incorpora no dossiê, grava no diário e no cérebro, escreve o
 * ritual com memória, publica no portal e deixa pronto para copiar.
 *
 * A fila anda aqui, dois clientes por vez, com progresso na tela: cada
 * chamada ao servidor trata um cliente só (limite das Edge Functions). A
 * conversa fica guardada neste navegador enquanto não termina.
 */

type Situacao = "fila" | "lendo" | "perguntas" | "aplicando" | "publicando" | "pronto" | "erro" | "pulado";

interface ItemDaRodada {
  cliente: ClienteDoAgente;
  incluir: boolean;
  situacao: Situacao;
  preparo: Preparo | null;
  respostas: string[];
  contexto: string;
  aplicado: Aplicado | null;
  reportId: string | null;
  publicado: boolean;
  tarefasCriadas: number[];
  erro: string | null;
}

interface Rodada {
  ritual: string;
  publicar: boolean;
  contextoGeral: string;
  itens: ItemDaRodada[];
  iniciadaEm: string;
}

const CHAVE_LOCAL = "agente-central:rodada:v1";
const LOTE = 2;

const RITUAIS = [
  { value: "rota_semana", label: "Rota da semana (segunda)" },
  { value: "meio_semana", label: "Meio da semana (quarta)" },
  { value: "prova_movimento", label: "Prova de movimento (sexta)" },
];

const ritualDeHoje = () => {
  const d = new Date().getDay();
  if (d === 1 || d === 0) return "rota_semana";
  if (d >= 2 && d <= 4) return "meio_semana";
  return "prova_movimento";
};

const FASE: Record<string, string> = {
  analisar: "Analisar", clarear: "Clarear", estruturar: "Estruturar", lancar: "Lançar",
  executar: "Executar", revisar: "Revisar", acelerar: "Acelerar",
};

const ROTULO: Record<Situacao, string> = {
  fila: "Na fila", lendo: "Lendo o cliente", perguntas: "Esperando suas respostas", aplicando: "Atualizando o dossiê e escrevendo",
  publicando: "Publicando no portal", pronto: "Pronto", erro: "Não deu certo", pulado: "Fora desta rodada",
};

function lerLocal(): Rodada | null {
  try {
    const bruto = window.localStorage.getItem(CHAVE_LOCAL);
    if (!bruto) return null;
    const r = JSON.parse(bruto) as Rodada;
    return r && Array.isArray(r.itens) ? r : null;
  } catch {
    return null;
  }
}

function gravarLocal(r: Rodada | null) {
  try {
    if (r) window.localStorage.setItem(CHAVE_LOCAL, JSON.stringify(r));
    else window.localStorage.removeItem(CHAVE_LOCAL);
  } catch {
    /* navegador sem armazenamento: a rodada só vive nesta aba */
  }
}

async function copiar(texto: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(texto);
      return true;
    }
  } catch {
    /* cai no caminho antigo abaixo */
  }
  try {
    const area = document.createElement("textarea");
    area.value = texto;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}

async function emLotes<T>(lista: T[], tamanho: number, fazer: (item: T) => Promise<void>) {
  for (let i = 0; i < lista.length; i += tamanho) {
    await Promise.all(lista.slice(i, i + tamanho).map(fazer));
  }
}

function TarefasDoRitual({ clientId, reportId, tarefas, criadas, onCriada }: {
  clientId: string; reportId: string; tarefas: TarefaSugerida[]; criadas: number[]; onCriada: (i: number) => void;
}) {
  const { user } = useAuth();
  const [criando, setCriando] = useState<number | null>(null);
  if (!tarefas.length) return null;
  const criar = async (i: number) => {
    if (!user || criando !== null) return;
    setCriando(i);
    try {
      const r = await criarTarefaDoRitual({ clientId, reportId, indice: i, tarefa: tarefas[i], userId: user.id });
      onCriada(i);
      toast.success(r === "criada" ? "Tarefa criada no Kanban." : "Essa tarefa já existia.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível criar a tarefa.");
    } finally {
      setCriando(null);
    }
  };
  return (
    <div className="mt-2 rounded-lg border border-border bg-secondary/30 p-2.5">
      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Tarefas para cumprir o que o ritual promete</p>
      <ul className="mt-1.5 space-y-1.5">
        {tarefas.map((t, i) => (
          <li key={i} className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <p className="text-[12px] font-medium text-foreground">{t.titulo}</p>
              {t.passo && <p className="text-[11px] leading-snug text-muted-foreground">{t.passo}</p>}
              <p className="text-[10px] text-muted-foreground">Prazo: {t.prazo_dias} dia(s){t.frente !== "geral" ? ` · ${t.frente === "social" ? "Conteúdo" : "Anúncios"}` : ""}</p>
            </div>
            {criadas.includes(i) ? (
              <span className="inline-flex shrink-0 items-center gap-1 text-[11px] text-success"><CheckCircle2 className="h-3.5 w-3.5" /> Criada</span>
            ) : (
              <button
                type="button"
                onClick={() => void criar(i)}
                disabled={criando !== null}
                className="inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-[11px] text-foreground hover:bg-secondary disabled:opacity-50"
              >
                {criando === i ? <Loader2 className="h-3 w-3 animate-spin" /> : <ListPlus className="h-3 w-3" />} Criar tarefa
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Tarefas sugeridas pelos rituais gerados nos últimos 10 dias (qualquer caminho). */
function SugestoesRecentes() {
  const [aberto, setAberto] = useState(false);
  const [criadas, setCriadas] = useState<Record<string, number[]>>({});
  const { data = [], isFetching, refetch } = useQuery({
    queryKey: ["agente-central-tarefas-sugeridas"],
    enabled: aberto,
    queryFn: async () => {
      const desde = new Date(Date.now() - 10 * 86_400_000).toISOString();
      const { data: reps, error } = await supabase.from("reports").select("id, client_id, title, created_at, metrics")
        .gte("created_at", desde).order("created_at", { ascending: false }).limit(80);
      if (error) return [];
      const comTarefa = (reps ?? []).filter((r) => tarefasSugeridas(r.metrics as Record<string, unknown>).length > 0);
      const ids = [...new Set(comTarefa.map((r) => r.client_id))];
      const nomes = new Map<string, string>();
      if (ids.length) {
        const { data: perfis } = await supabase.from("profiles").select("id, company_name, full_name").in("id", ids);
        for (const p of perfis ?? []) nomes.set(p.id, p.company_name || p.full_name || "Cliente");
      }
      return comTarefa.map((r) => ({
        id: r.id, clientId: r.client_id, nome: nomes.get(r.client_id) || "Cliente", titulo: r.title,
        quando: r.created_at, tarefas: tarefasSugeridas(r.metrics as Record<string, unknown>),
      }));
    },
  });
  return (
    <div className="mt-3 border-t border-border pt-2">
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        className="cursor-pointer border-none bg-transparent p-0 text-[11px] font-medium text-primary hover:opacity-80"
      >
        {aberto ? "Fechar tarefas sugeridas pelos rituais" : "Ver tarefas sugeridas pelos rituais dos últimos 10 dias"}
      </button>
      {aberto && (
        <div className="mt-2 space-y-2">
          <div className="flex items-center gap-2 text-[10.5px] text-muted-foreground">
            Cada sugestão nasce de uma promessa do ritual. Vira tarefa só quando alguém da equipe cria.
            <button type="button" onClick={() => void refetch()} className="ml-auto cursor-pointer border-none bg-transparent p-1 text-muted-foreground hover:text-foreground" aria-label="Recarregar">
              <RefreshCw className={`h-3 w-3 ${isFetching ? "animate-spin" : ""}`} />
            </button>
          </div>
          {!isFetching && data.length === 0 && <p className="text-[11px] text-muted-foreground">Nenhuma sugestão nos rituais recentes.</p>}
          {data.map((r) => (
            <div key={r.id} className="rounded-lg border border-border p-2">
              <p className="text-[11.5px] font-medium text-foreground">{r.nome} <span className="font-normal text-muted-foreground">· {r.titulo} · {new Date(r.quando).toLocaleDateString("pt-BR")}</span></p>
              <TarefasDoRitual
                clientId={r.clientId}
                reportId={r.id}
                tarefas={r.tarefas}
                criadas={criadas[r.id] ?? []}
                onCriada={(i) => setCriadas((prev) => ({ ...prev, [r.id]: [...(prev[r.id] ?? []), i] }))}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function AgenteDaCentral() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [aberto, setAberto] = useState(false);
  const [rodada, setRodada] = useState<Rodada | null>(() => (typeof window === "undefined" ? null : lerLocal()));
  const [carregandoLista, setCarregandoLista] = useState(false);
  const [erroLista, setErroLista] = useState<string | null>(null);
  const [rodando, setRodando] = useState<"lendo" | "aplicando" | null>(null);
  const [ritualEscolhido, setRitualEscolhido] = useState(ritualDeHoje());
  const rodadaRef = useRef<Rodada | null>(rodada);

  useEffect(() => {
    rodadaRef.current = rodada;
    gravarLocal(rodada);
  }, [rodada]);

  const atualizarItem = (clientId: string, mudar: (item: ItemDaRodada) => ItemDaRodada) => {
    setRodada((r) => (r ? { ...r, itens: r.itens.map((i) => (i.cliente.id === clientId ? mudar(i) : i)) } : r));
  };

  const contagem = useMemo(() => {
    const itens = rodada?.itens ?? [];
    const dentro = itens.filter((i) => i.incluir);
    return {
      total: dentro.length,
      lidos: dentro.filter((i) => i.preparo).length,
      prontos: dentro.filter((i) => i.situacao === "pronto").length,
      erros: dentro.filter((i) => i.situacao === "erro").length,
      emAndamento: dentro.filter((i) => ["lendo", "aplicando", "publicando"].includes(i.situacao)).length,
    };
  }, [rodada]);

  const abrir = async (novaRodada = false) => {
    setAberto(true);
    if (rodadaRef.current && !novaRodada) return;
    setCarregandoLista(true);
    setErroLista(null);
    try {
      const clientes = await listarClientesDoAgente();
      setRodada({
        ritual: ritualDeHoje(),
        publicar: true,
        contextoGeral: "",
        iniciadaEm: new Date().toISOString(),
        itens: clientes.map((c) => ({
          cliente: c, incluir: true, situacao: "fila", preparo: null, respostas: ["", ""], contexto: "",
          aplicado: null, reportId: null, publicado: false, tarefasCriadas: [], erro: null,
        })),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Não consegui ler a carteira.";
      setErroLista(msg);
      toast.error(msg);
    } finally {
      setCarregandoLista(false);
    }
  };

  const recomecar = () => {
    if (rodando) return;
    setRodada(null);
    rodadaRef.current = null;
    gravarLocal(null);
    void abrir(true);
  };

  // Passo 1: ler todo mundo e trazer as duas perguntas de cada um.
  const lerTodos = async () => {
    const atual = rodadaRef.current;
    if (!atual || rodando) return;
    const ritual = ritualEscolhido;
    setRodada({ ...atual, ritual });
    const alvos = atual.itens.filter((i) => i.incluir && !i.preparo).map((i) => i.cliente);
    if (!alvos.length) { toast.info("Todos os clientes marcados já foram lidos."); return; }
    setRodando("lendo");
    await emLotes(alvos, LOTE, async (c) => {
      atualizarItem(c.id, (i) => ({ ...i, situacao: "lendo", erro: null }));
      try {
        const p = await prepararCliente(c.id, ritual);
        atualizarItem(c.id, (i) => ({ ...i, situacao: "perguntas", preparo: p, respostas: p.perguntas.map((_, k) => i.respostas[k] ?? "") }));
      } catch (e) {
        atualizarItem(c.id, (i) => ({ ...i, situacao: "erro", erro: e instanceof Error ? e.message : "Falha ao ler." }));
      }
    });
    setRodando(null);
    void queryClient.invalidateQueries({ queryKey: ["dossie-cliente"] });
    toast.success("Leitura feita. Responda as perguntas e aplique.");
  };

  // Passo 2: aplicar as respostas, escrever o ritual e publicar.
  const aplicarTodos = async () => {
    const atual = rodadaRef.current;
    if (!atual || rodando || !user) return;
    const alvos = atual.itens.filter((i) => i.incluir && i.preparo && i.situacao !== "pronto");
    if (!alvos.length) { toast.info("Nada para aplicar: leia os clientes primeiro."); return; }
    setRodando("aplicando");
    await emLotes(alvos, LOTE, async (item) => {
      const c = item.cliente;
      const preparo = item.preparo!;
      atualizarItem(c.id, (i) => ({ ...i, situacao: "aplicando", erro: null }));
      try {
        const contexto = [item.contexto.trim(), atual.contextoGeral.trim() ? `Para todos: ${atual.contextoGeral.trim()}` : ""].filter(Boolean).join("\n");
        const ap = await aplicarRespostas({
          clientId: c.id, ritual: atual.ritual, leitura: preparo.leitura, perguntas: preparo.perguntas,
          respostas: item.respostas, contextoExtra: contexto,
        });
        atualizarItem(c.id, (i) => ({ ...i, aplicado: ap, situacao: ap.ritual ? "publicando" : "pronto" }));
        if (ap.ritual) {
          const pub = await salvarEPublicarRitual({ clientId: c.id, ritual: ap.ritual, publicar: atual.publicar, userId: user.id });
          atualizarItem(c.id, (i) => ({ ...i, reportId: pub.reportId, publicado: pub.publicado, situacao: "pronto" }));
          if (pub.avisos.length) toast.warning(`${c.nome}: ${pub.avisos.join(" ")}`);
        } else {
          atualizarItem(c.id, (i) => ({ ...i, erro: "Dossiê atualizado, mas a IA não escreveu o ritual agora." }));
        }
      } catch (e) {
        atualizarItem(c.id, (i) => ({ ...i, situacao: "erro", erro: e instanceof Error ? e.message : "Falha ao aplicar." }));
      }
    });
    setRodando(null);
    for (const k of ["exp-reports", "reports", "exp-memory", "cycle-rituals-central", "dossie-cliente", "agente-central-tarefas-sugeridas"]) {
      void queryClient.invalidateQueries({ queryKey: [k] });
    }
    toast.success("Rodada aplicada. Os rituais estão prontos para copiar.");
  };

  const itens = rodada?.itens ?? [];
  const lidos = itens.filter((i) => i.incluir && i.preparo);
  const prontos = itens.filter((i) => i.situacao === "pronto" && i.aplicado?.ritual);
  const progresso = rodando === "lendo"
    ? { feito: contagem.lidos, total: contagem.total }
    : rodando === "aplicando"
      ? { feito: contagem.prontos + contagem.erros, total: lidos.length }
      : null;

  const copiarTodos = async () => {
    const texto = prontos.map((i) => `${i.cliente.nome}\n\n${i.aplicado!.ritual!.body}`).join("\n\n----------\n\n");
    if (await copiar(texto)) toast.success("Todos os rituais copiados.");
    else toast.error("Não consegui copiar.");
  };

  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Bot className="h-4 w-4 shrink-0 text-primary" /> Agente da Central
          </p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
            Atualiza o dossiê de todos os clientes ativos, faz duas perguntas de cada um, publica o ritual no portal e deixa pronto para copiar.
            {rodada && ` Rodada aberta: ${contagem.lidos} de ${contagem.total} lidos, ${contagem.prontos} prontos.`}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void abrir()}
          className="inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-full border-none bg-primary px-4 py-2.5 text-[13px] font-medium text-primary-foreground hover:opacity-90"
        >
          {carregandoLista ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          {rodada ? "Abrir a rodada" : "Atualizar todos"}
        </button>
      </div>
      <SugestoesRecentes />

      <Dialog open={aberto} onOpenChange={(v) => { if (!rodando) setAberto(v); }}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto border-border bg-card">
          <DialogHeader>
            <DialogTitle className="text-foreground">Agente da Central · Atualizar todos</DialogTitle>
          </DialogHeader>

          {!rodada ? (
            erroLista && !carregandoLista ? (
              <div className="space-y-2">
                <p className="text-[12px] text-destructive">{erroLista}</p>
                <button
                  type="button"
                  onClick={() => void abrir(true)}
                  className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border-none bg-primary px-3 py-2 text-[12px] font-medium text-primary-foreground hover:opacity-90"
                >
                  <RefreshCw className="h-3.5 w-3.5" /> Tentar de novo
                </button>
              </div>
            ) : (
              <p className="flex items-center gap-2 text-[12px] text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Lendo a carteira...</p>
            )
          ) : (
            <div className="space-y-4">
              {/* Ritual e quem entra */}
              <div className="rounded-xl border border-border p-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">1. Ritual e clientes</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {RITUAIS.map((r) => (
                    <button
                      key={r.value}
                      type="button"
                      disabled={!!rodando || lidos.length > 0}
                      onClick={() => setRitualEscolhido(r.value)}
                      className={`cursor-pointer rounded-lg border px-3 py-1.5 text-[12px] disabled:cursor-not-allowed disabled:opacity-60 ${
                        (lidos.length > 0 ? rodada.ritual : ritualEscolhido) === r.value ? "border-primary bg-primary/10 text-foreground" : "border-border bg-secondary/30 text-muted-foreground"
                      }`}
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
                <p className="mt-2 text-[11px] text-muted-foreground">
                  {itens.length} cliente(s) ativos pela régua do Ciclo (plano ativo, recorrente, com projeto). Desmarque quem fica fora desta rodada.
                </p>
                <div className="mt-2 grid grid-cols-1 gap-1 sm:grid-cols-2">
                  {itens.map((i) => (
                    <label key={i.cliente.id} className="flex min-w-0 cursor-pointer items-center gap-2 text-[12px] text-foreground">
                      <input
                        type="checkbox"
                        checked={i.incluir}
                        disabled={!!rodando}
                        onChange={(e) => atualizarItem(i.cliente.id, (x) => ({ ...x, incluir: e.target.checked, situacao: e.target.checked ? (x.preparo ? x.situacao : "fila") : "pulado" }))}
                      />
                      <span className="min-w-0 truncate">{i.cliente.nome}</span>
                      <span className={`ml-auto shrink-0 text-[10px] ${i.situacao === "erro" ? "text-destructive" : i.situacao === "pronto" ? "text-success" : "text-muted-foreground"}`}>
                        {["lendo", "aplicando", "publicando"].includes(i.situacao) && <Loader2 className="mr-1 inline h-3 w-3 animate-spin" />}
                        {ROTULO[i.situacao]}
                      </span>
                    </label>
                  ))}
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void lerTodos()}
                    disabled={!!rodando || contagem.total === 0 || contagem.lidos >= contagem.total}
                    className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border-none bg-primary px-3 py-2 text-[12px] font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
                  >
                    {rodando === "lendo" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                    {lidos.length ? "Ler os que faltam" : `Ler e atualizar ${contagem.total} dossiê(s)`}
                  </button>
                  <button type="button" onClick={recomecar} disabled={!!rodando} className="inline-flex cursor-pointer items-center gap-1 border-none bg-transparent px-2 py-2 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-50">
                    <X className="h-3 w-3" /> Recomeçar
                  </button>
                </div>
                {progresso && (
                  <div className="mt-3">
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                      <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${progresso.total ? Math.round((progresso.feito / progresso.total) * 100) : 0}%` }} />
                    </div>
                    <p className="mt-1 text-[10.5px] text-muted-foreground">
                      {rodando === "lendo" ? "Lendo" : "Aplicando"} {progresso.feito} de {progresso.total}. Dois clientes por vez; pode começar a responder quem já chegou.
                    </p>
                  </div>
                )}
              </div>

              {/* A conversa: duas perguntas de cada um */}
              {lidos.length > 0 && (
                <div className="rounded-xl border border-border p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">2. Duas perguntas de cada cliente</p>
                  <p className="mt-1 text-[11px] text-muted-foreground">Responda o que souber. Pode colar contexto. Sua resposta é a aprovação para atualizar o dossiê e publicar.</p>
                  <textarea
                    value={rodada.contextoGeral}
                    onChange={(e) => setRodada((r) => (r ? { ...r, contextoGeral: e.target.value } : r))}
                    placeholder="Contexto que vale para todos (opcional)"
                    rows={2}
                    className="mt-2 w-full rounded-lg border border-border bg-background px-2.5 py-2 text-[12px] text-foreground"
                  />
                  <div className="mt-2 space-y-3">
                    {lidos.map((i) => (
                      <div key={i.cliente.id} className="rounded-lg border border-border bg-secondary/20 p-2.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-[12.5px] font-semibold text-foreground">{i.cliente.nome}</p>
                          {i.preparo?.fase && (
                            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary" title={i.preparo.motivo_da_fase}>
                              Acelera · {FASE[i.preparo.fase] ?? i.preparo.fase}
                            </span>
                          )}
                          {i.preparo?.dossie_versao != null && <span className="text-[10px] text-muted-foreground">dossiê v{i.preparo.dossie_versao}</span>}
                          <span className={`ml-auto text-[10px] ${i.situacao === "erro" ? "text-destructive" : i.situacao === "pronto" ? "text-success" : "text-muted-foreground"}`}>{ROTULO[i.situacao]}</span>
                        </div>
                        {i.preparo?.leitura.onde_estamos && <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{i.preparo.leitura.onde_estamos}</p>}
                        {i.preparo?.dossie_aviso && <p className="mt-1 text-[10.5px] text-warning">{i.preparo.dossie_aviso}</p>}
                        {(i.preparo?.perguntas ?? []).map((p, k) => (
                          <div key={k} className="mt-2">
                            <p className="text-[12px] font-medium text-foreground">{p.pergunta}</p>
                            {p.por_que && <p className="text-[10.5px] text-muted-foreground">{p.por_que}</p>}
                            <textarea
                              value={i.respostas[k] ?? ""}
                              disabled={i.situacao === "pronto" || !!rodando}
                              onChange={(e) => atualizarItem(i.cliente.id, (x) => {
                                const respostas = [...x.respostas];
                                respostas[k] = e.target.value;
                                return { ...x, respostas };
                              })}
                              rows={2}
                              placeholder="Sua resposta"
                              className="mt-1 w-full rounded-lg border border-border bg-background px-2.5 py-2 text-[12px] text-foreground"
                            />
                          </div>
                        ))}
                        <textarea
                          value={i.contexto}
                          disabled={i.situacao === "pronto" || !!rodando}
                          onChange={(e) => atualizarItem(i.cliente.id, (x) => ({ ...x, contexto: e.target.value }))}
                          rows={2}
                          placeholder="Contexto extra deste cliente (opcional)"
                          className="mt-2 w-full rounded-lg border border-border bg-background px-2.5 py-2 text-[12px] text-foreground"
                        />
                        {i.erro && <p className="mt-1 text-[11px] text-destructive">{i.erro}</p>}
                      </div>
                    ))}
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <label className="flex cursor-pointer items-center gap-2 text-[12px] text-foreground">
                      <input
                        type="checkbox"
                        checked={rodada.publicar}
                        disabled={!!rodando}
                        onChange={(e) => setRodada((r) => (r ? { ...r, publicar: e.target.checked } : r))}
                      />
                      Publicar no portal ao aplicar
                    </label>
                    <button
                      type="button"
                      onClick={() => void aplicarTodos()}
                      disabled={!!rodando || !lidos.some((i) => i.situacao !== "pronto")}
                      className="ml-auto inline-flex cursor-pointer items-center gap-1.5 rounded-lg border-none bg-primary px-3 py-2 text-[12px] font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
                    >
                      {rodando === "aplicando" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                      {rodada.publicar ? "Aplicar respostas e publicar" : "Aplicar respostas"}
                    </button>
                  </div>
                </div>
              )}

              {/* Rituais prontos para copiar */}
              {prontos.length > 0 && (
                <div className="rounded-xl border border-border p-3">
                  <div className="flex items-center gap-2">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">3. Rituais prontos para copiar</p>
                    <button type="button" onClick={() => void copiarTodos()} className="ml-auto inline-flex cursor-pointer items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-[11px] text-foreground hover:bg-secondary">
                      <ClipboardCopy className="h-3 w-3" /> Copiar todos
                    </button>
                  </div>
                  <div className="mt-2 space-y-3">
                    {prontos.map((i) => {
                      const r = i.aplicado!.ritual!;
                      const aviso = avisoDeRepeticao(r as unknown as Record<string, unknown>);
                      return (
                        <div key={i.cliente.id} className="rounded-lg border border-border p-2.5">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-[12.5px] font-semibold text-foreground">{i.cliente.nome}</p>
                            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${i.publicado ? "bg-success/10 text-success" : "bg-secondary text-muted-foreground"}`}>
                              {i.publicado ? "Publicado no portal" : "Rascunho na fila da Central"}
                            </span>
                            {i.aplicado?.dossie_versao != null && <span className="text-[10px] text-muted-foreground">dossiê v{i.aplicado.dossie_versao}</span>}
                            <button
                              type="button"
                              onClick={() => void copiar(r.body).then((ok) => (ok ? toast.success(`Ritual de ${i.cliente.nome} copiado.`) : toast.error("Não consegui copiar.")))}
                              className="ml-auto inline-flex cursor-pointer items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-[11px] text-foreground hover:bg-secondary"
                            >
                              <ClipboardCopy className="h-3 w-3" /> Copiar
                            </button>
                          </div>
                          {r.title && <p className="mt-1 text-[11.5px] font-medium text-foreground">{r.title}</p>}
                          {aviso && <p className="mt-1 rounded-md border border-warning/30 bg-warning/[0.06] px-2 py-1 text-[10.5px] text-warning">{aviso}</p>}
                          {i.aplicado?.dossie_aviso && <p className="mt-1 text-[10.5px] text-warning">{i.aplicado.dossie_aviso}</p>}
                          <p className="mt-1.5 whitespace-pre-line text-[12px] leading-relaxed text-foreground/90">{r.body}</p>
                          {i.reportId && (
                            <TarefasDoRitual
                              clientId={i.cliente.id}
                              reportId={i.reportId}
                              tarefas={r.tarefas_sugeridas ?? []}
                              criadas={i.tarefasCriadas}
                              onCriada={(k) => atualizarItem(i.cliente.id, (x) => ({ ...x, tarefasCriadas: [...x.tarefasCriadas, k] }))}
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
