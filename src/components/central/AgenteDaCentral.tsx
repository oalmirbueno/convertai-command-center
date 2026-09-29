import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Bot, CheckCircle2, ChevronDown, ClipboardCopy, ListPlus, Loader2, RefreshCw, Send, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import PainelDoAgente from "@/components/sistema/PainelDoAgente";
import Etapas, { type ItemDeEtapa } from "@/components/sistema/Etapas";
import { EstadoVazio } from "@/components/sistema/Estados";
import AjudaRecolhida from "@/components/sistema/AjudaRecolhida";
import { botao, campoTexto, conversa, etiqueta, juntar, texto } from "@/components/sistema/estilos";
import {
  aplicarRespostas, criarTarefaDoRitual, listarClientesDoAgente, prepararCliente, salvarEPublicarRitual,
  type ClienteDoAgente,
} from "./agenteCentralApi";
import { avisoDeRepeticao, tarefasSugeridas, type TarefaSugerida } from "./ritualAvisos";
import {
  etapaSugerida, gravarLocal, lerLocal, perguntasSemResposta, seloDaRodada,
  type EtapaDoAgente, type ItemDaRodada, type Rodada, type Rodando, type Situacao,
} from "./rodadaDoAgente";

/**
 * Agente da Central: "Atualizar todos".
 *
 * Na Central fica só um botão pequeno no cabeçalho, com um selo do estado da
 * rodada ("3 perguntas esperando"). O botão abre o agente num pop-up (grande
 * no computador, tela cheia no celular) com quatro passos: 1 Ler, 2
 * Responder, 3 Aplicar e publicar, 4 Copiar rituais.
 *
 * Para cada cliente ativo (régua do Ciclo), o agente lê tudo, atualiza o
 * dossiê geral com a leitura organizada da semana e faz DUAS perguntas. O
 * dono responde (pode colar contexto), o agente incorpora no dossiê, grava no
 * diário e no cérebro, escreve o ritual com memória, publica no portal e
 * deixa pronto para copiar.
 *
 * A fila anda aqui, dois clientes por vez: cada chamada ao servidor trata um
 * cliente só (limite das Edge Functions). A rodada fica guardada neste
 * navegador enquanto não termina; fechar o pop-up não perde nada e a leitura
 * continua enquanto a Central estiver aberta.
 */

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

const corDaSituacao = (s: Situacao) => (s === "erro" ? "text-destructive" : s === "pronto" ? "text-success" : "text-muted-foreground");

const TOM_DO_SELO = {
  andamento: "bg-primary/10 text-primary",
  atencao: "bg-warning/15 text-warning",
  erro: "bg-destructive/10 text-destructive",
  ok: "bg-success/10 text-success",
  neutro: "bg-muted text-muted-foreground",
} as const;

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
    <div className="mt-2 rounded-md bg-muted/50 p-2.5">
      <p className={texto.rotulo}>Tarefas para cumprir o que o ritual promete</p>
      <ul className="mt-1.5 space-y-1.5">
        {tarefas.map((t, i) => (
          <li key={i} className="flex items-start">
            <div className="mr-2 min-w-0 flex-1">
              <p className="text-[13px] font-medium text-foreground">{t.titulo}</p>
              {t.passo && <p className="text-[12px] leading-snug text-muted-foreground">{t.passo}</p>}
              <p className="text-[12px] text-muted-foreground">Prazo: {t.prazo_dias} dia(s){t.frente !== "geral" ? ` · ${t.frente === "social" ? "Conteúdo" : "Anúncios"}` : ""}</p>
            </div>
            {criadas.includes(i) ? (
              <span className="inline-flex shrink-0 items-center text-[12px] text-success"><CheckCircle2 className="mr-1 h-3.5 w-3.5" /> Criada</span>
            ) : (
              <button type="button" onClick={() => void criar(i)} disabled={criando !== null} className={juntar(botao.secundario, "h-8 px-2.5 text-[12px]")}>
                {criando === i ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <ListPlus className="mr-1 h-3 w-3" />} Criar tarefa
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
    <div className="border-t border-border pt-3">
      <div className="flex min-w-0 items-center">
        <button
          type="button"
          onClick={() => setAberto((v) => !v)}
          aria-expanded={aberto}
          className="inline-flex min-w-0 cursor-pointer items-center border-none bg-transparent p-0 text-left text-[13px] font-medium text-primary hover:opacity-80"
        >
          <ChevronDown className={juntar("mr-1 h-3.5 w-3.5 shrink-0 transition-transform", aberto ? "rotate-180" : "")} />
          <span className="min-w-0 truncate">Tarefas sugeridas pelos rituais dos últimos 10 dias</span>
        </button>
        <AjudaRecolhida className="ml-1.5" rotulo="Sobre as tarefas sugeridas">Cada sugestão nasce de uma promessa do ritual. Vira tarefa só quando alguém da equipe cria.</AjudaRecolhida>
        {aberto && (
          <button type="button" onClick={() => void refetch()} className={juntar(botao.icone, "ml-auto")} aria-label="Recarregar">
            <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
          </button>
        )}
      </div>
      {aberto && (
        <div className="mt-2 space-y-2">
          {!isFetching && data.length === 0 && <p className="text-[12px] text-muted-foreground">Nenhuma sugestão nos rituais recentes.</p>}
          {data.map((r) => (
            <div key={r.id} className="rounded-md border border-border p-2.5">
              <p className="text-[13px] font-medium text-foreground">{r.nome} <span className="font-normal text-muted-foreground">· {r.titulo} · {new Date(r.quando).toLocaleDateString("pt-BR")}</span></p>
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

function novoItem(c: ClienteDoAgente): ItemDaRodada {
  return {
    cliente: c, incluir: true, situacao: "fila", preparo: null, respostas: ["", ""], contexto: "",
    aplicado: null, reportId: null, publicado: false, tarefasCriadas: [], erro: null,
  };
}

export default function AgenteDaCentral() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [aberto, setAberto] = useState(false);
  const [rodada, setRodada] = useState<Rodada | null>(() => (typeof window === "undefined" ? null : lerLocal()));
  const [carregandoLista, setCarregandoLista] = useState(false);
  const [erroLista, setErroLista] = useState<string | null>(null);
  const [rodando, setRodando] = useState<Rodando>(null);
  const [ritualEscolhido, setRitualEscolhido] = useState(ritualDeHoje());
  const [etapa, setEtapa] = useState<EtapaDoAgente>("ler");
  const [clienteAberto, setClienteAberto] = useState<string | null>(null);
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
    };
  }, [rodada]);

  const selo = seloDaRodada(rodada, rodando);

  const abrir = async (novaRodada = false) => {
    setAberto(true);
    if (rodadaRef.current && !novaRodada) {
      setEtapa(etapaSugerida(rodadaRef.current, rodando));
      return;
    }
    setEtapa("ler");
    setCarregandoLista(true);
    setErroLista(null);
    try {
      const clientes = await listarClientesDoAgente();
      setRodada({
        ritual: ritualDeHoje(),
        publicar: true,
        contextoGeral: "",
        iniciadaEm: new Date().toISOString(),
        itens: clientes.map(novoItem),
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
    setClienteAberto(null);
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
    setEtapa((e) => (e === "ler" && rodadaRef.current?.itens.some((i) => i.incluir && i.preparo) ? "responder" : e));
    void queryClient.invalidateQueries({ queryKey: ["dossie-cliente"] });
    toast.success("Leitura feita. Responda as perguntas e aplique.");
  };

  // Passo 3: aplicar as respostas, escrever o ritual e publicar.
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
        // Frente FS: a IA que não organizou as respostas não some em silêncio.
        if (ap.ia_erro) toast.warning(`${c.nome}: a IA não organizou as respostas agora; elas entraram como foram escritas.`, { description: `Motivo: ${ap.ia_erro}` });
        if (ap.ritual) {
          const pub = await salvarEPublicarRitual({ clientId: c.id, ritual: ap.ritual, publicar: atual.publicar, userId: user.id });
          atualizarItem(c.id, (i) => ({ ...i, reportId: pub.reportId, publicado: pub.publicado, situacao: "pronto" }));
          if (pub.avisos.length) toast.warning(`${c.nome}: ${pub.avisos.join(" ")}`);
        } else {
          atualizarItem(c.id, (i) => ({ ...i, erro: `Dossiê atualizado, mas a IA não escreveu o ritual agora.${ap.ritual_erro ? ` Motivo: ${ap.ritual_erro}` : ""}` }));
        }
      } catch (e) {
        atualizarItem(c.id, (i) => ({ ...i, situacao: "erro", erro: e instanceof Error ? e.message : "Falha ao aplicar." }));
      }
    });
    setRodando(null);
    setEtapa((e) => (e === "aplicar" ? "copiar" : e));
    for (const k of ["exp-reports", "reports", "exp-memory", "cycle-rituals-central", "dossie-cliente", "agente-central-tarefas-sugeridas"]) {
      void queryClient.invalidateQueries({ queryKey: [k] });
    }
    toast.success("Rodada aplicada. Os rituais estão prontos para copiar.");
  };

  const itens = rodada?.itens ?? [];
  const lidos = itens.filter((i) => i.incluir && i.preparo);
  const prontos = itens.filter((i) => i.situacao === "pronto" && i.aplicado?.ritual);
  const paraAplicar = lidos.filter((i) => i.situacao !== "pronto");
  const semResposta = lidos.filter((i) => i.situacao !== "pronto").reduce((s, i) => s + perguntasSemResposta(i), 0);
  const totalDePerguntas = paraAplicar.reduce((s, i) => s + (i.preparo?.perguntas.length ?? 0), 0);
  const progresso = rodando === "lendo"
    ? { feito: contagem.lidos, total: contagem.total }
    : rodando === "aplicando"
      ? { feito: contagem.prontos + contagem.erros, total: lidos.length }
      : null;

  // Na lista de perguntas, abre o primeiro cliente com pergunta sem resposta.
  // null = ainda não escolhido; "" = o dono fechou todos (não reabre sozinho).
  useEffect(() => {
    if (etapa !== "responder" || clienteAberto !== null) return;
    const primeiro = lidos.find((i) => i.situacao !== "pronto" && perguntasSemResposta(i) > 0) ?? lidos.find((i) => i.situacao !== "pronto");
    if (primeiro) setClienteAberto(primeiro.cliente.id);
  }, [etapa, clienteAberto, lidos]);

  const copiarTodos = async () => {
    const texto = prontos.map((i) => `${i.cliente.nome}\n\n${i.aplicado!.ritual!.body}`).join("\n\n----------\n\n");
    if (await copiar(texto)) toast.success("Todos os rituais copiados.");
    else toast.error("Não consegui copiar.");
  };

  const etapas: ItemDeEtapa[] = [
    { valor: "ler", rotulo: "Ler" },
    { valor: "responder", rotulo: "Responder", contador: semResposta || null, destaque: etapa === "ler" && lidos.length > 0 },
    { valor: "aplicar", rotulo: "Aplicar e publicar" },
    { valor: "copiar", rotulo: "Copiar rituais", contador: prontos.length || null },
  ];

  /* ---------- Conteúdo de cada etapa (rola por dentro) ---------- */

  const conteudoLer = rodada && (
    <div className="space-y-4">
      <div>
        <p className={texto.rotulo}>Ritual desta rodada</p>
        <div className="mt-2 flex flex-wrap">
          {RITUAIS.map((r) => {
            const escolhido = (lidos.length > 0 ? rodada.ritual : ritualEscolhido) === r.value;
            return (
              <button
                key={r.value}
                type="button"
                disabled={!!rodando || lidos.length > 0}
                aria-pressed={escolhido}
                onClick={() => setRitualEscolhido(r.value)}
                className={juntar(
                  "mb-2 mr-2 inline-flex h-8 cursor-pointer items-center rounded-md border px-3 text-[12px] transition-colors disabled:cursor-not-allowed disabled:opacity-60",
                  escolhido ? "border-primary bg-primary/10 text-foreground" : "border-border text-muted-foreground hover:bg-muted",
                )}
              >
                {r.label}
              </button>
            );
          })}
        </div>
      </div>
      <div>
        <p className={texto.rotulo}>
          {itens.length} cliente(s) ativos pela régua do Ciclo. Desmarque quem fica fora.
        </p>
        <ul className="mt-2 divide-y divide-border rounded-md border border-border">
          {itens.map((i) => (
            <li key={i.cliente.id}>
              <label className="flex min-h-10 min-w-0 cursor-pointer items-center px-3 py-2 text-[14px] text-foreground">
                <input
                  type="checkbox"
                  className="mr-2.5 h-4 w-4 shrink-0 accent-primary"
                  checked={i.incluir}
                  disabled={!!rodando}
                  onChange={(e) => atualizarItem(i.cliente.id, (x) => ({ ...x, incluir: e.target.checked, situacao: e.target.checked ? (x.preparo ? x.situacao : "fila") : "pulado" }))}
                />
                <span className="mr-2 min-w-0 flex-1 truncate">{i.cliente.nome}</span>
                <span className={juntar("shrink-0 text-[12px]", corDaSituacao(i.situacao))}>
                  {["lendo", "aplicando", "publicando"].includes(i.situacao) && <Loader2 className="mr-1 inline h-3 w-3 animate-spin" />}
                  {ROTULO[i.situacao]}
                </span>
              </label>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );

  const conteudoResponder = lidos.length === 0 ? (
    <EstadoVazio compacto titulo="Nenhum cliente lido ainda." descricao="Leia os clientes no passo 1 e as perguntas aparecem aqui." />
  ) : (
    <div className="space-y-3">
      <p className={juntar(texto.auxiliar, "flex items-center")}>
        Responda o que souber.
        <AjudaRecolhida className="ml-1.5" rotulo="Como responder">Pode colar contexto. Sua resposta é a aprovação para atualizar o dossiê e publicar.</AjudaRecolhida>
      </p>
      <textarea
        value={rodada?.contextoGeral ?? ""}
        onChange={(e) => setRodada((r) => (r ? { ...r, contextoGeral: e.target.value } : r))}
        placeholder="Contexto que vale para todos (opcional)"
        aria-label="Contexto que vale para todos"
        rows={2}
        className={juntar(campoTexto, conversa.campo, "min-h-[64px]")}
      />
      <ul className="space-y-2">
        {lidos.map((i) => {
          const abertoAqui = clienteAberto === i.cliente.id;
          const qtd = i.preparo?.perguntas.length ?? 0;
          const faltam = perguntasSemResposta(i);
          const travado = i.situacao === "pronto" || !!rodando;
          return (
            <li key={i.cliente.id} className="overflow-hidden rounded-md border border-border" data-cliente-do-agente={i.cliente.id}>
              <button
                type="button"
                onClick={() => setClienteAberto(abertoAqui ? "" : i.cliente.id)}
                aria-expanded={abertoAqui}
                className="flex min-h-11 w-full min-w-0 cursor-pointer items-center border-none bg-transparent px-3 py-2 text-left hover:bg-muted/60"
              >
                <span className="mr-2 min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-semibold text-foreground">{i.cliente.nome}</span>
                  <span className={juntar("block text-[12px]", corDaSituacao(i.situacao))}>
                    {i.situacao === "perguntas"
                      ? faltam === 0 ? `${qtd} de ${qtd} respondidas` : `${qtd - faltam} de ${qtd} respondidas`
                      : ROTULO[i.situacao]}
                  </span>
                </span>
                {i.preparo?.fase && (
                  <span className={juntar(etiqueta, "mr-2 hidden bg-primary/10 text-primary sm:inline-flex")} title={i.preparo.motivo_da_fase}>
                    Acelera · {FASE[i.preparo.fase] ?? i.preparo.fase}
                  </span>
                )}
                <ChevronDown className={juntar("h-4 w-4 shrink-0 text-muted-foreground transition-transform", abertoAqui ? "rotate-180" : "")} />
              </button>
              {abertoAqui && (
                <div className="border-t border-border px-3 pb-3 pt-2">
                  <div className="flex flex-wrap items-center">
                    {i.preparo?.fase && (
                      <span className={juntar(etiqueta, "mb-1 mr-2 bg-primary/10 text-primary sm:hidden")} title={i.preparo.motivo_da_fase}>
                        Acelera · {FASE[i.preparo.fase] ?? i.preparo.fase}
                      </span>
                    )}
                    {i.preparo?.dossie_versao != null && <span className="mb-1 text-[12px] text-muted-foreground">dossiê v{i.preparo.dossie_versao}</span>}
                  </div>
                  {i.preparo?.leitura.onde_estamos && <p className="text-[13px] leading-relaxed text-muted-foreground">{i.preparo.leitura.onde_estamos}</p>}
                  {i.preparo?.dossie_aviso && <p className="mt-1 text-[12px] text-warning">{i.preparo.dossie_aviso}</p>}
                  {(i.preparo?.perguntas ?? []).map((p, k) => (
                    <div key={k} className="mt-3">
                      <p className="text-[14px] font-medium text-foreground">{p.pergunta}</p>
                      {p.por_que && <p className="text-[12px] text-muted-foreground">{p.por_que}</p>}
                      <textarea
                        value={i.respostas[k] ?? ""}
                        disabled={travado}
                        aria-label={p.pergunta}
                        onChange={(e) => atualizarItem(i.cliente.id, (x) => {
                          const respostas = [...x.respostas];
                          respostas[k] = e.target.value;
                          return { ...x, respostas };
                        })}
                        rows={2}
                        placeholder="Sua resposta"
                        className={juntar(campoTexto, conversa.campo, "mt-1 min-h-[64px]")}
                      />
                    </div>
                  ))}
                  <textarea
                    value={i.contexto}
                    disabled={travado}
                    aria-label={`Contexto extra de ${i.cliente.nome}`}
                    onChange={(e) => atualizarItem(i.cliente.id, (x) => ({ ...x, contexto: e.target.value }))}
                    rows={2}
                    placeholder="Contexto extra deste cliente (opcional)"
                    className={juntar(campoTexto, conversa.campo, "mt-3 min-h-[64px]")}
                  />
                  {i.erro && <p className="mt-1 text-[12px] text-destructive">{i.erro}</p>}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );

  const conteudoAplicar = lidos.length === 0 ? (
    <EstadoVazio compacto titulo="Nada para aplicar ainda." descricao="Leia os clientes e responda as perguntas primeiro." />
  ) : (
    <div className="space-y-3">
      <p className={juntar(texto.auxiliar, "flex items-center")}>
        Pergunta sem resposta fica de fora.
        <AjudaRecolhida className="ml-1.5" rotulo="O que o agente faz ao aplicar">O agente incorpora as respostas no dossiê, escreve o ritual de cada cliente e publica no portal.</AjudaRecolhida>
      </p>
      {semResposta > 0 && (
        <p className="rounded-md bg-warning/10 px-3 py-2 text-[13px] text-warning">
          {semResposta} de {totalDePerguntas} pergunta(s) sem resposta.{" "}
          <button type="button" onClick={() => setEtapa("responder")} className="cursor-pointer border-none bg-transparent p-0 font-medium text-warning underline">Responder agora</button>
        </p>
      )}
      <ul className="divide-y divide-border rounded-md border border-border">
        {lidos.map((i) => {
          const qtd = i.preparo?.perguntas.length ?? 0;
          return (
            <li key={i.cliente.id} className="px-3 py-2">
              <div className="flex min-w-0 items-center">
                <span className="mr-2 min-w-0 flex-1 truncate text-[14px] text-foreground">{i.cliente.nome}</span>
                <span className={juntar("shrink-0 text-[12px]", corDaSituacao(i.situacao))}>
                  {["aplicando", "publicando"].includes(i.situacao) && <Loader2 className="mr-1 inline h-3 w-3 animate-spin" />}
                  {i.situacao === "perguntas" ? `${qtd - perguntasSemResposta(i)} de ${qtd} respondidas` : ROTULO[i.situacao]}
                </span>
              </div>
              {i.erro && <p className="mt-0.5 text-[12px] text-destructive">{i.erro}</p>}
            </li>
          );
        })}
      </ul>
    </div>
  );

  const conteudoCopiar = (
    <div className="space-y-3">
      {prontos.length === 0 ? (
        <EstadoVazio compacto titulo="Nenhum ritual pronto ainda." descricao="Eles aparecem aqui depois de aplicar as respostas." />
      ) : (
        <ul className="space-y-3">
          {prontos.map((i) => {
            const r = i.aplicado!.ritual!;
            const aviso = avisoDeRepeticao(r as unknown as Record<string, unknown>);
            return (
              <li key={i.cliente.id} className="rounded-md border border-border p-3">
                <div className="flex min-w-0 flex-wrap items-center">
                  <p className="mr-2 min-w-0 truncate text-[14px] font-semibold text-foreground">{i.cliente.nome}</p>
                  <span className={juntar(etiqueta, "mr-2", i.publicado ? "bg-success/10 text-success" : "bg-muted text-muted-foreground")}>
                    {i.publicado ? "Publicado no portal" : "Rascunho na fila da Central"}
                  </span>
                  {i.aplicado?.dossie_versao != null && <span className="text-[12px] text-muted-foreground">dossiê v{i.aplicado.dossie_versao}</span>}
                  <button
                    type="button"
                    onClick={() => void copiar(r.body).then((ok) => (ok ? toast.success(`Ritual de ${i.cliente.nome} copiado.`) : toast.error("Não consegui copiar.")))}
                    className={juntar(botao.secundario, "ml-auto h-8 px-2.5 text-[12px]")}
                  >
                    <ClipboardCopy className="mr-1 h-3.5 w-3.5" /> Copiar
                  </button>
                </div>
                {r.title && <p className="mt-1.5 text-[13px] font-medium text-foreground">{r.title}</p>}
                {aviso && <p className="mt-1 rounded-md bg-warning/10 px-2 py-1 text-[12px] text-warning">{aviso}</p>}
                {i.aplicado?.dossie_aviso && <p className="mt-1 text-[12px] text-warning">{i.aplicado.dossie_aviso}</p>}
                <p className="mt-1.5 whitespace-pre-line text-[14px] leading-relaxed text-foreground/90">{r.body}</p>
                {i.reportId && (
                  <TarefasDoRitual
                    clientId={i.cliente.id}
                    reportId={i.reportId}
                    tarefas={r.tarefas_sugeridas ?? []}
                    criadas={i.tarefasCriadas}
                    onCriada={(k) => atualizarItem(i.cliente.id, (x) => ({ ...x, tarefasCriadas: [...x.tarefasCriadas, k] }))}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}
      <SugestoesRecentes />
    </div>
  );

  /* ---------- Rodapé: o botão da etapa, sempre à vista ---------- */

  const tudoLido = contagem.total > 0 && contagem.lidos >= contagem.total;
  const rodape = rodada && (
    <div className="flex min-w-0 flex-wrap items-center">
      {etapa === "ler" && (
        <>
          <button type="button" onClick={recomecar} disabled={!!rodando} className={juntar(botao.discreto, "mr-auto")}>
            <X className="mr-1 h-3.5 w-3.5" /> Recomeçar
          </button>
          {tudoLido && !rodando ? (
            <button type="button" onClick={() => setEtapa("responder")} className={botao.primario}>
              Responder as perguntas
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void lerTodos()}
              disabled={!!rodando || contagem.total === 0 || tudoLido}
              className={botao.primario}
            >
              {rodando === "lendo" ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-1.5 h-4 w-4" />}
              {lidos.length ? "Ler os que faltam" : `Ler e atualizar ${contagem.total} dossiê(s)`}
            </button>
          )}
        </>
      )}
      {etapa === "responder" && (
        <>
          <span className={juntar(texto.auxiliar, "mr-auto")}>
            {lidos.length === 0 ? "" : semResposta === 0 ? "Tudo respondido." : `${semResposta} sem resposta`}
          </span>
          <button type="button" onClick={() => setEtapa("aplicar")} disabled={lidos.length === 0} className={botao.primario}>
            Continuar para aplicar
          </button>
        </>
      )}
      {etapa === "aplicar" && (
        <>
          <label className="mr-auto flex cursor-pointer items-center py-1 text-[14px] text-foreground">
            <input
              type="checkbox"
              className="mr-2 h-4 w-4 accent-primary"
              checked={rodada.publicar}
              disabled={!!rodando}
              onChange={(e) => setRodada((r) => (r ? { ...r, publicar: e.target.checked } : r))}
            />
            Publicar no portal ao aplicar
          </label>
          <button
            type="button"
            onClick={() => void aplicarTodos()}
            disabled={!!rodando || paraAplicar.length === 0}
            className={botao.primario}
          >
            {rodando === "aplicando" ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Send className="mr-1.5 h-4 w-4" />}
            {rodada.publicar ? "Aplicar respostas e publicar" : "Aplicar respostas"}
          </button>
        </>
      )}
      {etapa === "copiar" && (
        <>
          <span className={juntar(texto.auxiliar, "mr-auto")}>{prontos.length ? `${prontos.length} ritual(is) pronto(s)` : ""}</span>
          <button type="button" onClick={() => void copiarTodos()} disabled={prontos.length === 0} className={botao.primario}>
            <ClipboardCopy className="mr-1.5 h-4 w-4" /> Copiar todos
          </button>
        </>
      )}
    </div>
  );

  const topo = (
    <div className="space-y-2">
      <Etapas itens={etapas} valor={etapa} onEscolher={(v) => setEtapa(v as EtapaDoAgente)} rotulo="Passos do Atualizar todos" numerar className="-mx-1" />
      {progresso && (
        <div data-progresso-do-agente="">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${progresso.total ? Math.round((progresso.feito / progresso.total) * 100) : 0}%` }} />
          </div>
          <p className="mt-1 text-[12px] text-muted-foreground">
            {rodando === "lendo" ? "Lendo" : "Aplicando"} {progresso.feito} de {progresso.total}. Dois por vez. Pode fechar: a rodada continua.
          </p>
        </div>
      )}
    </div>
  );

  return (
    <>
      <button
        type="button"
        onClick={() => void abrir()}
        data-agente-central-botao=""
        title={selo ? `Atualizar todos: ${selo.texto}` : "Atualizar o dossiê de todos os clientes ativos"}
        // Sistema de design (E3, 26/09): mesmo botão do cabeçalho da página; no
        // celular fica só o ícone (o nome segue para leitor de tela e no title).
        className={juntar(botao.secundario, "px-2.5 sm:px-3.5")}
      >
        {carregandoLista || rodando ? <Loader2 className="h-4 w-4 animate-spin sm:mr-1.5" /> : <Bot className="h-4 w-4 text-primary sm:mr-1.5" />}
        <span className="sr-only sm:not-sr-only">Atualizar todos</span>
        {selo && (
          <span className={juntar(etiqueta, "ml-2 rounded-full", TOM_DO_SELO[selo.tom])} data-selo-da-rodada="">
            <span className="sm:hidden">{selo.curto}</span>
            <span className="hidden sm:inline">{selo.texto}</span>
          </span>
        )}
      </button>

      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent
          className={juntar(
            // Celular: tela cheia. Computador: pop-up grande com altura fixa.
            "left-0 top-0 flex h-full max-h-none w-full max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none border-border bg-card p-0",
            "sm:left-[50%] sm:top-[50%] sm:h-[86vh] sm:max-h-[860px] sm:max-w-3xl sm:translate-x-[-50%] sm:translate-y-[-50%] sm:rounded-xl",
            "pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)] sm:pb-0 sm:pt-0",
            "[&>button:last-child]:hidden",
          )}
        >
          <DialogTitle className="sr-only">Atualizar todos</DialogTitle>
          <DialogDescription className="sr-only">Agente da Central: ler os clientes, responder as perguntas, aplicar e publicar, copiar os rituais.</DialogDescription>
          <PainelDoAgente
            semMoldura
            titulo="Atualizar todos"
            descricao="Dossiê, duas perguntas e ritual de cada cliente ativo."
            icone={<Bot className="h-4 w-4" />}
            acoes={
              <button type="button" onClick={() => setAberto(false)} aria-label="Fechar" title="Fechar" className={juntar(botao.icone, "h-9 w-9")}>
                <X className="h-4 w-4" />
              </button>
            }
            topo={rodada ? topo : undefined}
            compositor={rodape || undefined}
            rotuloDasMensagens="Passo do Atualizar todos"
            className="flex-1"
          >
            {!rodada ? (
              erroLista && !carregandoLista ? (
                <div className="space-y-2">
                  <p className="text-[14px] text-destructive">{erroLista}</p>
                  <button type="button" onClick={() => void abrir(true)} className={botao.primario}>
                    <RefreshCw className="mr-1.5 h-4 w-4" /> Tentar de novo
                  </button>
                </div>
              ) : (
                <p className="flex items-center text-[14px] text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Lendo a carteira...</p>
              )
            ) : etapa === "ler" ? conteudoLer : etapa === "responder" ? conteudoResponder : etapa === "aplicar" ? conteudoAplicar : conteudoCopiar}
          </PainelDoAgente>
        </DialogContent>
      </Dialog>
    </>
  );
}
