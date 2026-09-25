import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarCheck2, CalendarRange, Check, ChevronDown, Loader2, MessageSquare, MessagesSquare, Plus, Send, Sparkles, X, Zap } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useConfirm } from "@/components/shared/confirmDialog";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  chamarFuncao,
  dataCurta,
  limitesDoMes,
  padraoPara,
  saidaPorRaciocinio,
  somarMeses,
  inicioDoMes,
  TAMANHOS,
  textoDoErro,
  type ParteDaEstimativa,
} from "@/lib/mesa/api";
import AgendaDoMes from "./AgendaDoMes";
import DiagnosticoDoMes from "./DiagnosticoDoMes";
import AgenteDoMes, { type PedidoEmAndamento } from "./AgenteDoMes";
import HypesDaSemana from "./HypesDaSemana";
import PlanejamentoAutomatico from "./PlanejamentoAutomatico";
import { atualizarAgenda, novoIdDaProposta, type ItemProposto } from "./mesaV4Api";
import MesConteudoRapido from "./MesConteudoRapido";
import MesEscolhaEditorial from "./MesEscolhaEditorial";
import { corpoDaEscolha, escolhaLivre, raciocinioPadraoDaTela, rotuloEditorial, type EscolhaEditorial } from "./MesConhecimento";
import { Cronometro } from "./Cronometro";
import { BotaoDeApagar, useApagarConteudo, type ResultadoDoApagar } from "./ApagarConteudo";
import {
  chavesDoPlano,
  corpoDoPlano,
  lerPlanosCombinados,
  mesesAPartirDe,
  nomeDoMes,
  resumoDoPlano,
  type ModoDoAgente,
} from "./planoDoMes";
import { Ditado } from "./Ditado";
import { AvisoDeErro, BotaoComCusto, EstimativaInline, avisarCustoReal } from "./Custo";
import { useFiltroDaMarca, useMesa } from "./MesaContexto";
import { projetosDaListaNaMarca } from "@/lib/mesa/marcas";
import { Campo, SeletorDeModelo, SeletorDeRaciocinio, TituloDeSecao } from "./Seletores";

/**
 * Aba Mês. No alto, o plano combinado do mês e os Hypes da semana
 * (HypesDaSemana.tsx); o Agente do mês (AgenteDoMes.tsx) abre num pop-up
 * centralizado pelo botão flutuante no centro da base da tela, então nunca
 * espreme o calendário. Depois, a Agenda do mês: o mesmo calendário da Agenda do painel,
 * onde a equipe seleciona os itens, completa e melhora com o agente e abre no
 * Estúdio (AgendaDoMes.tsx). Logo abaixo, o planejamento de conteúdos novos,
 * de dois jeitos: "Planejar e preencher a agenda" faz sozinho mês a mês
 * (PlanejamentoAutomatico.tsx); "Uma proposta por vez" é o caminho manual,
 * em que o estrategista propõe os temas do período, o humano escolhe, o
 * estrategista detalha e a proposta é gravada na agenda pelo mesmo serviço
 * do MCP (função agente-calendario, SPEC seção 4).
 */

interface Tema {
  id: string;
  tema: string;
  pilar?: string;
  fase?: string | number;
  objetivo?: string;
  por_que?: string;
  jev?: { aderencia?: number; potencial?: number } | null;
  escolhido?: boolean;
  tipo_editorial?: string;
  framework?: string;
}

interface CardDoRoteiro {
  ordem: number;
  funcao?: string;
  texto?: string;
  ilustracao?: string;
  estilo?: string;
}

interface Item {
  id?: string;
  tema_id?: string;
  task_id?: string | null;
  data?: string;
  formato?: string;
  tema?: string;
  pilar?: string;
  fase?: string | number;
  gancho?: string;
  copy?: string;
  legenda?: string;
  resumo?: string;
  cta?: string;
  objetivo?: string;
  carrossel_infinito?: boolean;
  cards?: CardDoRoteiro[];
  tipo_editorial?: string;
  framework?: string;
}

interface Proposta {
  id: string;
  project_id: string | null;
  periodo_inicio: string;
  periodo_fim: string;
  parametros: Record<string, any>;
  status: "temas" | "detalhando" | "pronta" | "gravada" | "descartada";
  diagnostico: string | null;
  /** Diagnóstico em seções (novo); o texto antigo continua valendo. */
  diagnostico_estruturado?: unknown;
  temas: Tema[];
  itens: Item[];
  conversa_id: string | null;
  task_ids: string[];
  gravada_em: string | null;
  criado_em: string;
}

interface Mensagem {
  id: string;
  papel: "usuario" | "agente" | "sistema";
  conteudo: string;
  criado_em: string;
}

const idDaProposta = (d: any): string | null => d?.proposta?.id || d?.proposta_id || d?.id || null;

/** Nota do Jev em porcentagem, aceite ela venha de 0 a 1 ou de 0 a 100. */
// O agente do calendario grava as notas do Jev de 0 a 10.
const pct = (v?: number | null) => {
  if (v === null || v === undefined || !Number.isFinite(Number(v))) return null;
  return Math.round(Math.max(0, Math.min(10, Number(v))) * 10);
};

function semanas(inicio: string, fim: string) {
  const a = new Date(`${inicio}T12:00:00`).getTime();
  const b = new Date(`${fim}T12:00:00`).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return 1;
  return Math.max(1, Math.round((b - a) / (7 * 86400000)));
}

function CartaoDeTema({ tema, marcado, onToggle }: { tema: Tema; marcado: boolean; onToggle: () => void }) {
  const aderencia = pct(tema.jev?.aderencia);
  const potencial = pct(tema.jev?.potencial);
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={marcado}
      className={`relative flex min-w-0 flex-col space-y-2 rounded-xl border p-3.5 text-left transition-colors ${
        marcado ? "border-primary bg-card ring-1 ring-primary" : "border-border bg-card hover:border-primary/50"
      }`}
    >
      <span className={`absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-full border ${marcado ? "border-primary bg-primary text-primary-foreground" : "border-border"}`}>
        {marcado && <Check className="h-3 w-3" />}
      </span>
      <p className="pr-7 text-[13.5px] font-medium leading-snug [overflow-wrap:anywhere]">{tema.tema}</p>
      <p className="text-[11px] text-muted-foreground">
        {[tema.pilar, tema.fase ? `fase ${tema.fase}` : null, tema.objetivo].filter(Boolean).join(" · ")}
      </p>
      {rotuloEditorial(tema.tipo_editorial, tema.framework) && (
        <p className="text-[11px] font-medium text-primary">{rotuloEditorial(tema.tipo_editorial, tema.framework)}</p>
      )}
      {tema.por_que && <p className="text-[12px] leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">{tema.por_que}</p>}
      {(aderencia !== null || potencial !== null) && (
        <div className="mt-auto flex flex-wrap pt-1">
          {aderencia !== null && <span className="mb-1 mr-1.5 rounded-full bg-muted px-2 py-0.5 text-[11px]">Aderência {aderencia}%</span>}
          {potencial !== null && <span className="mb-1 rounded-full bg-muted px-2 py-0.5 text-[11px]">Salvar e compartilhar {potencial}%</span>}
        </div>
      )}
    </button>
  );
}

function LinhaDoItem({ item, apagar }: { item: Item; apagar?: (confirmarExtra: boolean) => Promise<ResultadoDoApagar> }) {
  const texto = item.copy || item.legenda || item.resumo;
  return (
    <Collapsible className="rounded-xl border border-border bg-card">
      <div className="flex min-w-0 items-start">
        <CollapsibleTrigger className="flex min-w-0 flex-1 items-start px-3.5 py-3 text-left">
          <div className="mr-3 w-16 shrink-0 text-[11.5px] text-muted-foreground">
            <p className="font-medium text-foreground">{dataCurta(item.data)}</p>
            <p>{item.formato === "estatico" ? "estático" : item.formato || "formato?"}</p>
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-medium leading-snug [overflow-wrap:anywhere]">{item.gancho || item.tema || "Sem gancho"}</p>
            {item.tema && item.gancho && <p className="mt-0.5 text-[11.5px] text-muted-foreground [overflow-wrap:anywhere]">{item.tema}</p>}
          </div>
          <ChevronDown className="ml-3 mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        </CollapsibleTrigger>
        {apagar && <BotaoDeApagar onApagar={apagar} className="mr-2 mt-2.5 shrink-0" />}
      </div>
      <CollapsibleContent className="space-y-3 border-t border-border px-3.5 py-3">
        {texto && <p className="whitespace-pre-wrap text-[12.5px] leading-relaxed [overflow-wrap:anywhere]">{texto}</p>}
        <p className="text-[11.5px] text-muted-foreground">
          {[rotuloEditorial(item.tipo_editorial, item.framework) || null, item.pilar, item.fase ? `fase ${item.fase}` : null, item.objetivo, item.cta ? `CTA: ${item.cta}` : null, item.carrossel_infinito ? "carrossel infinito" : null].filter(Boolean).join(" · ")}
        </p>
        {(item.cards || []).length > 0 && (
          <ol className="space-y-2">
            {(item.cards || []).slice().sort((a, b) => a.ordem - b.ordem).map((c) => (
              <li key={c.ordem} className="rounded-lg border border-border bg-muted p-2.5">
                <p className="text-[11px] font-medium text-muted-foreground">Card {c.ordem}{c.funcao ? ` · ${c.funcao}` : ""}</p>
                {c.texto && <p className="mt-0.5 text-[12.5px] [overflow-wrap:anywhere]">{c.texto}</p>}
                {(c.ilustracao || c.estilo) && (
                  <p className="mt-1 text-[11.5px] text-muted-foreground [overflow-wrap:anywhere]">{[c.ilustracao, c.estilo].filter(Boolean).join(" · ")}</p>
                )}
              </li>
            ))}
          </ol>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

function ConversaDoMes({ proposta, modeloId, onAtualizou }: { proposta: Proposta; modeloId: string; onAtualizou: () => void }) {
  const mesa = useMesa();
  const queryClient = useQueryClient();
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<unknown>(null);
  const [locais, setLocais] = useState<Mensagem[]>([]);

  const mensagens = useQuery({
    queryKey: ["mesa", "mensagens", proposta.conversa_id],
    enabled: !!proposta.conversa_id,
    queryFn: async (): Promise<Mensagem[]> => {
      const { data, error } = await (supabase as any)
        .from("agente_mensagens")
        .select("id, papel, conteudo, criado_em")
        .eq("conversa_id", proposta.conversa_id)
        .order("criado_em", { ascending: true });
      if (error) throw error;
      return data || [];
    },
  });

  const partes: ParteDaEstimativa[] = [
    { modeloId, tipo: "texto", tokensEntrada: TAMANHOS.conversarMes.entrada, tokensSaida: TAMANHOS.conversarMes.saida },
  ];

  const enviar = async () => {
    const msg = texto.trim();
    if (!msg) return;
    setEnviando(true);
    setErro(null);
    try {
      const data = await chamarFuncao<any>("agente-calendario", { acao: "conversar", proposta_id: proposta.id, mensagem: msg, modelo_id: modeloId || undefined });
      setTexto("");
      if (!proposta.conversa_id) {
        const agora = new Date().toISOString();
        setLocais((l) => l.concat([
          { id: `u-${agora}`, papel: "usuario", conteudo: msg, criado_em: agora },
          { id: `a-${agora}`, papel: "agente", conteudo: String(data?.resposta || "Proposta ajustada."), criado_em: agora },
        ]));
      }
      avisarCustoReal("Estrategista respondeu", data, mesa.atualizarCusto);
      void queryClient.invalidateQueries({ queryKey: ["mesa", "mensagens"] });
      onAtualizou();
    } catch (e) {
      setErro(e);
    } finally {
      setEnviando(false);
    }
  };

  const lista = (mensagens.data && mensagens.data.length ? mensagens.data : locais).filter((m) => m.papel !== "sistema");

  return (
    <div className="flex min-w-0 flex-col space-y-3 rounded-xl border border-border bg-card p-3">
      <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Conversa com o estrategista</p>
      <div className="space-y-2 sm:max-h-[420px] sm:overflow-y-auto">
        {lista.length === 0 && <p className="text-[12px] text-muted-foreground">Peça ajustes em português: "troque o tema 3 por algo sobre entrega", "menos carrossel na primeira semana".</p>}
        {lista.map((m) => (
          <div key={m.id} className={`rounded-lg px-3 py-2 text-[12.5px] leading-relaxed [overflow-wrap:anywhere] ${m.papel === "usuario" ? "ml-6 bg-primary text-primary-foreground" : "mr-6 bg-muted"}`}>
            <p className="whitespace-pre-wrap">{m.conteudo}</p>
          </div>
        ))}
      </div>
      {erro && <AvisoDeErro erro={erro} />}
      <Textarea value={texto} onChange={(e) => setTexto(e.target.value)} rows={3} placeholder="O que você quer mudar?" aria-label="Pedido ao estrategista" />
      <div className="flex items-center justify-between">
        <EstimativaInline partes={partes} />
        <Ditado valor={texto} onChange={setTexto} disabled={enviando} className="ml-auto" />
        <Button type="button" size="sm" className="ml-2" onClick={() => void enviar()} disabled={enviando || !texto.trim()}>
          {enviando ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Send className="mr-1.5 h-3.5 w-3.5" />}
          Enviar
        </Button>
      </div>
    </div>
  );
}

function PlanejarComEstrategista() {
  const mesa = useMesa();
  const { clientId, catalogo } = mesa;
  const queryClient = useQueryClient();
  const confirmar = useConfirm();
  const apagarConteudo = useApagarConteudo();
  const planos = useQuery({ queryKey: chavesDoPlano.planos(clientId), queryFn: () => lerPlanosCombinados(clientId) });

  const proximo = limitesDoMes(somarMeses(inicioDoMes(), 1));
  const [propostaId, setPropostaId] = useState<string | null>(null);
  const [nova, setNova] = useState(false);
  const [inicio, setInicio] = useState(proximo.inicio);
  const [fim, setFim] = useState(proximo.fim);
  const [frequencia, setFrequencia] = useState("3");
  const [objetivo, setObjetivo] = useState("");
  const [oferta, setOferta] = useState("");
  const [modeloId, setModeloId] = useState("");
  const [raciocinio, setRaciocinio] = useState("");
  const [escolhidos, setEscolhidos] = useState<Set<string>>(new Set());
  const [projetoId, setProjetoId] = useState("");
  const [gravando, setGravando] = useState(false);
  const [conversaAberta, setConversaAberta] = useState(false);
  const [escolha, setEscolha] = useState<EscolhaEditorial>(escolhaLivre);
  // Proposta que o estrategista está escrevendo agora (temas ou detalhe): a
  // lista relê a cada 3 s e o que já chegou aparece na tela.
  const [acompanhando, setAcompanhando] = useState<{ id: string; desde: number; etapa: "temas" | "detalhe" } | null>(null);

  const propostas = useQuery({
    queryKey: ["mesa", "propostas", clientId],
    refetchInterval: acompanhando ? 3000 : false,
    queryFn: async (): Promise<Proposta[]> => {
      const { data, error } = await (supabase as any)
        .from("calendario_propostas")
        .select("*")
        .eq("client_id", clientId)
        .neq("status", "descartada")
        // Só as propostas do estrategista: pedido livre do agente do mês,
        // Completar e campanha também moram nesta tabela (parametros.origem).
        .is("parametros->>origem", null)
        .order("criado_em", { ascending: false })
        .limit(12);
      if (error) throw error;
      return data || [];
    },
  });

  const proposta: Proposta | null = nova
    ? null
    : acompanhando
      ? (propostas.data || []).find((p) => p.id === acompanhando.id) || null
      : (propostas.data || []).find((p) => p.id === propostaId) || (propostas.data || [])[0] || null;

  // Marca por projeto (Acerbi e CME): a lista de projetos para gravar é só a da marca aberta.
  const filtroDaMarca = useFiltroDaMarca();
  const projetos = useQuery({
    queryKey: ["mesa", "projetos", clientId],
    select: (lista: { id: string; name: string; status: string }[]) => projetosDaListaNaMarca(lista, filtroDaMarca),
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("projects")
        .select("id, name, status")
        .eq("client_id", clientId)
        .is("deleted_at", null)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as { id: string; name: string; status: string }[];
    },
  });

  const modelo = catalogo.find((m) => m.id === modeloId) || null;

  // Parâmetros: da proposta aberta, ou o padrão do catálogo para uma nova.
  useEffect(() => {
    const p = proposta?.parametros || {};
    const padrao = padraoPara(catalogo, "estrategista");
    const id = String(p.modelo_id || p.modelo || padrao?.id || "");
    setModeloId(id);
    const m = catalogo.find((x) => x.id === id);
    // Sem escolha gravada, medium (25/09): o mais alto deixava o mês lento demais.
    setRaciocinio(String(p.raciocinio || raciocinioPadraoDaTela(m?.raciocinio)));
    if (proposta) {
      setInicio(proposta.periodo_inicio);
      setFim(proposta.periodo_fim);
      // A proposta guarda as publicações do período; o campo mostra por semana.
      const total = Number(p.frequencia);
      setFrequencia(Number.isFinite(total) && total > 0 ? String(Math.max(1, Math.round(total / semanas(proposta.periodo_inicio, proposta.periodo_fim)))) : "3");
      setObjetivo(String(p.objetivo || ""));
      setOferta(String(p.oferta || ""));
      setEscolhidos(new Set((proposta.temas || []).filter((t) => t.escolhido).map((t) => t.id)));
      setProjetoId(proposta.project_id || "");
      setEscolha({
        tipos: Array.isArray(p.tipos) ? p.tipos.map(String) : [],
        frameworks: Array.isArray(p.frameworks) ? p.frameworks.map(String) : [],
      });
    }
  }, [proposta?.id, catalogo.length]);

  useEffect(() => {
    if (!projetoId && projetos.data && projetos.data.length === 1) setProjetoId(projetos.data[0].id);
  }, [projetos.data, projetoId]);

  const atualizar = () => void queryClient.invalidateQueries({ queryKey: ["mesa", "propostas", clientId] });

  const trocarModelo = (id: string) => {
    setModeloId(id);
    setRaciocinio(raciocinioPadraoDaTela(catalogo.find((m) => m.id === id)?.raciocinio));
  };

  const itensPrevistos = useMemo(() => Math.max(1, Number(frequencia) || 3) * semanas(inicio, fim), [frequencia, inicio, fim]);

  const podeProporTemas = !!inicio && !!fim && fim >= inicio && !!modeloId;

  const alternarTema = (id: string) =>
    setEscolhidos((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const gravar = async () => {
    if (!proposta || !projetoId) return;
    const ok = await confirmar({
      title: "Gravar na agenda?",
      description: `Cria ${proposta.itens.length} item(ns) no calendário do projeto escolhido. O que já existe na agenda fica como está.`,
      confirmLabel: "Gravar",
    });
    if (!ok) return;
    setGravando(true);
    try {
      const data = await chamarFuncao<any>("agente-calendario", { acao: "gravar", proposta_id: proposta.id, project_id: projetoId });
      // O gravar devolve { proposta, itens, direcoes_prontas }.
      const n = Array.isArray(data?.itens)
        ? data.itens.length
        : Array.isArray(data?.proposta?.task_ids)
          ? data.proposta.task_ids.length
          : null;
      toast.success("Gravado na agenda", { description: n !== null ? `${n} item(ns) no calendário.` : undefined });
    } catch (e) {
      toast.error("Não foi possível gravar", { description: textoDoErro(e) });
    } finally {
      setGravando(false);
      // Relê mesmo na falha: a gravação parcial (409) já criou parte dos
      // itens. A Agenda do mês, o Estúdio e a proposta passam a mostrar.
      atualizarAgenda(queryClient, clientId);
    }
  };

  const planoDoPeriodo = (planos.data || []).find((p) => p.mes === String(inicio).slice(0, 7)) || null;

  // O estrategista recebe quantas publicações cabem no período (por semana vezes as semanas).
  const parametros = { frequencia: itensPrevistos, objetivo: objetivo.trim() || undefined, oferta: oferta.trim() || undefined, modelo_id: modeloId, raciocinio: raciocinio || undefined };

  // ------------------------------------------------------------ formulário
  const formulario = (
    <section className="space-y-4 rounded-xl border border-border bg-card p-4">
      <TituloDeSecao>Período e objetivo</TituloDeSecao>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Campo rotulo="Início"><Input type="date" value={inicio} onChange={(e) => setInicio(e.target.value)} className="h-9" /></Campo>
        <Campo rotulo="Fim"><Input type="date" value={fim} min={inicio} onChange={(e) => setFim(e.target.value)} className="h-9" /></Campo>
        <Campo rotulo="Publicações por semana"><Input type="number" min={1} max={14} value={frequencia} onChange={(e) => setFrequencia(e.target.value)} className="h-9" /></Campo>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Campo rotulo="Objetivo principal"><Input value={objetivo} onChange={(e) => setObjetivo(e.target.value)} placeholder="Ex.: pedidos pelo WhatsApp" className="h-9" /></Campo>
        <Campo rotulo="Oferta principal"><Input value={oferta} onChange={(e) => setOferta(e.target.value)} placeholder="Ex.: kit de mudas de outono" className="h-9" /></Campo>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <SeletorDeModelo catalogo={catalogo} tipo="texto" valor={modeloId} onChange={trocarModelo} rotulo="Modelo do estrategista" />
        <SeletorDeRaciocinio modelo={modelo} valor={raciocinio} onChange={setRaciocinio} />
      </div>
      <MesEscolhaEditorial valor={escolha} onChange={setEscolha} />
      {planoDoPeriodo && (
        <p className="flex items-start rounded-lg bg-success/10 px-3 py-2 text-[12px] leading-relaxed">
          <Check className="mr-1.5 mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
          <span className="min-w-0 [overflow-wrap:anywhere]">
            O plano combinado de <span className="capitalize">{nomeDoMes(planoDoPeriodo.mes)}</span> entra no estrategista: {resumoDoPlano(planoDoPeriodo.texto)}
          </span>
        </p>
      )}
      <div className="flex flex-wrap items-center justify-end">
        {nova && (propostas.data || []).length > 0 && (
          <Button type="button" variant="ghost" size="sm" className="mr-2" onClick={() => setNova(false)}>Voltar à proposta</Button>
        )}
        <BotaoComCusto
          rotulo="Propor temas"
          titulo="Propor temas do período"
          descricao="O estrategista lê o dossiê, os movimentos, as métricas, o kit e a memória do cliente, pesquisa na web e traz de 8 a 15 temas com nota do Jev. As três fases correm juntas e os temas aparecem conforme chegam."
          disabled={!podeProporTemas}
          // Três frentes em paralelo (uma por fase), cada uma com pesquisa na web.
          partes={() => [{ modeloId, tipo: "texto", tokensEntrada: TAMANHOS.proporTemas.entrada * 3, tokensSaida: saidaPorRaciocinio(raciocinio) * 2, buscasWeb: TAMANHOS.proporTemas.buscasWeb * 3 }]}
          executar={async () => {
            // O id nasce aqui: a tela troca para a proposta e acompanha os temas chegando.
            const id = novoIdDaProposta();
            setAcompanhando({ id, desde: Date.now(), etapa: "temas" });
            setNova(false);
            setPropostaId(id);
            try {
              return await chamarFuncao("agente-calendario", {
                acao: "propor_temas",
                client_id: clientId,
                proposta_id: id,
                periodo_inicio: inicio,
                periodo_fim: fim,
                frequencia: parametros.frequencia,
                objetivo: parametros.objetivo,
                oferta: parametros.oferta,
                modelo_id: modeloId,
                raciocinio: parametros.raciocinio,
                ...corpoDaEscolha(escolha),
              });
            } catch (e) {
              setPropostaId(null);
              throw e;
            } finally {
              setAcompanhando(null);
              atualizar();
            }
          }}
          aoConcluir={(data) => {
            setNova(false);
            setPropostaId(idDaProposta(data));
            atualizar();
          }}
        />
      </div>
    </section>
  );

  if (propostas.isLoading) return <p className="text-[12.5px] text-muted-foreground"><Loader2 className="mr-1.5 inline h-4 w-4 animate-spin" />Lendo propostas…</p>;
  if (propostas.isError) return <AvisoDeErro erro={propostas.error} />;
  if (acompanhando && !proposta) {
    return (
      <div className="rounded-xl border border-border bg-card px-3.5 py-3">
        <Cronometro desde={acompanhando.desde} rotulo="O estrategista está pesquisando e propondo os temas das três fases" previsao="~1 min" />
      </div>
    );
  }
  if (!proposta) return formulario;

  const temas = proposta.temas || [];
  const itens = (proposta.itens || []).slice().sort((a, b) => String(a.data || "").localeCompare(String(b.data || "")));
  // "detalhando" também: detalhar parcial ou que caiu no meio deixa a
  // proposta assim, e o servidor refaz só os temas que faltam.
  const podeDetalhar =
    escolhidos.size > 0 && (proposta.status === "temas" || proposta.status === "pronta" || proposta.status === "detalhando");

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center rounded-xl border border-border bg-card px-3.5 py-2.5 text-[12px]">
        <span className="mr-2 min-w-0 flex-1 text-muted-foreground">
          <strong className="font-medium text-foreground">{dataCurta(proposta.periodo_inicio)} a {dataCurta(proposta.periodo_fim)}</strong>
          {" · "}
          {({ temas: "escolha os temas", detalhando: "detalhando", pronta: "pronta para gravar", gravada: "gravada na agenda" } as Record<string, string>)[proposta.status] || proposta.status}
        </span>
        {(propostas.data || []).length > 1 && (
          <Select value={proposta.id} onValueChange={(v) => { setPropostaId(v); setNova(false); }}>
            <SelectTrigger className="h-8 w-auto min-w-[150px] text-[12px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {(propostas.data || []).map((p) => (
                <SelectItem key={p.id} value={p.id}>{dataCurta(p.periodo_inicio)} a {dataCurta(p.periodo_fim)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Button type="button" size="sm" variant="ghost" className="h-8" onClick={() => setConversaAberta((v) => !v)}>
          {conversaAberta ? <X className="mr-1 h-3.5 w-3.5" /> : <MessageSquare className="mr-1 h-3.5 w-3.5" />}
          Conversa
        </Button>
        <Button type="button" size="sm" variant="ghost" className="h-8" onClick={() => setNova(true)}>
          <Plus className="mr-1 h-3.5 w-3.5" /> Nova proposta
        </Button>
      </div>

      <div className={`grid grid-cols-1 gap-5 ${conversaAberta ? "lg:grid-cols-[minmax(0,1fr)_360px]" : ""}`}>
        <div className="min-w-0 space-y-5">
          <DiagnosticoDoMes proposta={proposta} />

          {temas.length > 0 && (proposta.status === "temas" || itens.length === 0) && (
            <section className="space-y-3">
              <TituloDeSecao acao={<span className="text-[11.5px] text-muted-foreground">{escolhidos.size} de {temas.length} escolhidos</span>}>
                Temas propostos
              </TituloDeSecao>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                {temas.map((t) => <CartaoDeTema key={t.id} tema={t} marcado={escolhidos.has(t.id)} onToggle={() => alternarTema(t.id)} />)}
              </div>
            </section>
          )}

          {podeDetalhar && (proposta.status === "temas" || proposta.status === "detalhando" || itens.length === 0) && (
            <div className="flex justify-end">
              <BotaoComCusto
                rotulo={`Detalhar escolhidos (${escolhidos.size})`}
                titulo="Detalhar os temas escolhidos"
                descricao="O estrategista escreve cada publicação: data, formato, gancho, copy e o roteiro de cada card."
                partes={() => [{ modeloId, tipo: "texto", tokensEntrada: TAMANHOS.detalhar.entrada, tokensSaida: itensPrevistos * TAMANHOS.detalhar.saidaPorItem + saidaPorRaciocinio(raciocinio) }]}
                executar={async () => {
                  setAcompanhando({ id: proposta.id, desde: Date.now(), etapa: "detalhe" });
                  try {
                    await chamarFuncao("agente-calendario", { acao: "escolher_temas", proposta_id: proposta.id, temas: Array.from(escolhidos) });
                    const corpoDoDetalhar = { acao: "detalhar", proposta_id: proposta.id, modelo_id: modeloId || undefined, raciocinio: raciocinio || undefined };
                    const d = await chamarFuncao<any>("agente-calendario", corpoDoDetalhar);
                    // Se o modelo pulou algum tema, pede só os que faltam mais uma vez (não é correção: é o resto).
                    return d && Array.isArray(d.faltam) && d.faltam.length ? await chamarFuncao<any>("agente-calendario", corpoDoDetalhar) : d;
                  } finally {
                    // Detalhar parcial devolve erro com o que já ficou pronto: relê igual.
                    setAcompanhando(null);
                    atualizar();
                  }
                }}
                aoConcluir={() => atualizar()}
              />
            </div>
          )}

          {acompanhando ? (
            <div className="rounded-xl border border-border bg-card px-3.5 py-2.5">
              <Cronometro
                desde={acompanhando.desde}
                rotulo={
                  acompanhando.etapa === "temas"
                    ? `Temas chegando: ${temas.length} até agora`
                    : `Detalhando em paralelo: ${itens.length} de ${escolhidos.size} prontos`
                }
              />
            </div>
          ) : (
            proposta.status === "detalhando" && itens.length === 0 && (
              <p className="text-[12.5px] text-muted-foreground"><Loader2 className="mr-1.5 inline h-4 w-4 animate-spin" />O estrategista está detalhando. Atualize em instantes.</p>
            )
          )}
          {!acompanhando && proposta.parametros && proposta.parametros.aviso && (
            <p className="rounded-lg bg-muted px-3 py-2 text-[12px] text-muted-foreground [overflow-wrap:anywhere]">{String(proposta.parametros.aviso)}</p>
          )}

          {itens.length > 0 && (
            <section className="space-y-3">
              <TituloDeSecao>Publicações ({itens.length})</TituloDeSecao>
              <div className="space-y-2">
                {itens.map((it, i) => (
                  <LinhaDoItem
                    key={it.tema_id || it.id || i}
                    item={it}
                    apagar={
                      proposta.status !== "gravada" && !it.task_id && it.tema_id
                        ? () => apagarConteudo.daProposta(proposta.id, it as ItemProposto, (proposta.itens || []).indexOf(it))
                        : undefined
                    }
                  />
                ))}
              </div>
            </section>
          )}

          {itens.length > 0 && proposta.status !== "gravada" && (
            <section className="flex flex-col rounded-xl border border-border bg-card p-3.5 sm:flex-row sm:items-end">
              <Campo rotulo="Projeto do cliente" className="mb-3 flex-1 sm:mb-0 sm:mr-3">
                <Select value={projetoId} onValueChange={setProjetoId}>
                  <SelectTrigger className="h-9 text-[12.5px]"><SelectValue placeholder={projetos.data?.length ? "Escolha o projeto" : "Cliente sem projeto ativo"} /></SelectTrigger>
                  <SelectContent>
                    {(projetos.data || []).map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Campo>
              <Button type="button" onClick={() => void gravar()} disabled={!projetoId || gravando}>
                {gravando ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <CalendarCheck2 className="mr-1.5 h-4 w-4" />}
                Gravar na agenda
              </Button>
            </section>
          )}

          {proposta.status === "gravada" && (
            <p className="rounded-xl border border-success/50 bg-card px-3.5 py-3 text-[12.5px] text-foreground">
              Gravada na agenda{proposta.gravada_em ? ` em ${new Date(proposta.gravada_em).toLocaleDateString("pt-BR")}` : ""} com {proposta.task_ids?.length || 0} item(ns).{" "}
              <Link to={`/calendario?client=${clientId}`} className="text-primary underline-offset-2 hover:underline">Abrir o calendário</Link>
            </p>
          )}
        </div>

        {conversaAberta && (
          <aside className="min-w-0">
            <ConversaDoMes proposta={proposta} modeloId={modeloId} onAtualizou={atualizar} />
          </aside>
        )}
      </div>
    </div>
  );
}

type ModoDePlanejar = "automatico" | "proposta";

const chaveDoModo = "mesa:modo-de-planejar";

function lerModo(): ModoDePlanejar {
  try {
    return window.localStorage.getItem(chaveDoModo) === "proposta" ? "proposta" : "automatico";
  } catch {
    return "automatico";
  }
}

/** Mês da URL (?mes=AAAA-MM-01), igual à Agenda do mês; sem ele, o mês corrente. */
const MES_VALIDO = /^\d{4}-\d{2}-01$/;

/**
 * Faixa do alto da aba: o plano combinado do mês que está na agenda e os dois
 * caminhos com o agente (planejar conversando ou criar conteúdos), mais o
 * estado dos próximos meses. Poucos cliques, sem poluir.
 */
function PlanoDoMesEmDestaque({
  mes,
  onConversar,
  onRapido,
}: {
  mes: string;
  onConversar: (modo: ModoDoAgente, mes: string) => void;
  onRapido?: () => void;
}) {
  const { clientId } = useMesa();
  const planos = useQuery({ queryKey: chavesDoPlano.planos(clientId), queryFn: () => lerPlanosCombinados(clientId) });
  const [aberto, setAberto] = useState(false);
  const lista = planos.data || [];
  const doMes = lista.find((p) => p.mes === mes.slice(0, 7)) || null;
  const proximos = mesesAPartirDe(somarMeses(mes, 1), 3);
  const nome = nomeDoMes(mes);
  const corpo = doMes ? corpoDoPlano(doMes.texto) : "";

  return (
    <section className="min-w-0 overflow-hidden rounded-2xl border border-border bg-card" aria-label={`Plano de ${nome}`}>
      <div className="flex min-w-0 flex-col p-4 sm:flex-row sm:items-start sm:p-5">
        <div className="min-w-0 flex-1 sm:mr-4">
          <p className="flex items-center text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            <CalendarRange className="mr-1.5 h-3.5 w-3.5" />
            Plano de <span className="ml-1 normal-case">{nome}</span>
          </p>
          {doMes ? (
            <>
              <p className={`mt-1.5 whitespace-pre-wrap text-[13.5px] leading-relaxed [overflow-wrap:anywhere] ${aberto ? "" : "line-clamp-3"}`}>{corpo}</p>
              {corpo.length > 180 && (
                <button type="button" onClick={() => setAberto((v) => !v)} className="mt-1 text-[12px] font-medium text-primary hover:underline">
                  {aberto ? "Mostrar menos" : "Ver o plano inteiro"}
                </button>
              )}
            </>
          ) : (
            <>
              <p className="mt-1.5 text-[15px] font-semibold leading-snug">Nada combinado para {nome} ainda</p>
              <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">
                Converse com o agente sobre estratégia, datas, campanhas, frequência e formatos. O que ficar combinado entra no gerador de meses.
              </p>
            </>
          )}
        </div>
        <div className="mt-3 flex shrink-0 flex-wrap items-center sm:mt-0 sm:justify-end">
          {onRapido && (
            <Button type="button" size="sm" className="mb-1 mr-1.5 h-9" onClick={onRapido}>
              <Zap className="mr-1.5 h-4 w-4" />
              Conteúdo rápido
            </Button>
          )}
          <Button type="button" size="sm" variant={onRapido ? "outline" : "default"} className="mb-1 mr-1.5 h-9" onClick={() => onConversar("planejar", mes)}>
            <MessagesSquare className="mr-1.5 h-4 w-4" />
            {doMes ? "Conversar sobre o plano" : "Planejar com o agente"}
          </Button>
          <Button type="button" size="sm" variant="outline" className="mb-1 h-9" onClick={() => onConversar("criar", mes)}>
            <Sparkles className="mr-1.5 h-4 w-4" />
            Criar conteúdos
          </Button>
        </div>
      </div>
      <div className="flex min-w-0 flex-wrap items-center border-t border-border bg-muted/40 px-4 py-2 sm:px-5">
        <span className="mr-2 text-[11.5px] text-muted-foreground">Próximos meses</span>
        {proximos.map((m) => {
          const tem = lista.some((p) => p.mes === m.slice(0, 7));
          return (
            <button
              key={m}
              type="button"
              onClick={() => onConversar("planejar", m)}
              className={`my-0.5 mr-1.5 inline-flex items-center rounded-full px-2.5 py-1 text-[11.5px] capitalize transition-colors ${
                tem ? "bg-success/15 text-foreground hover:bg-success/25" : "bg-card text-muted-foreground hover:text-foreground"
              }`}
              title={tem ? "Plano combinado. Clique para conversar sobre ele." : "Sem plano. Clique para planejar com o agente."}
            >
              {tem && <Check className="mr-1 h-3 w-3" />}
              {nomeDoMes(m).split(" ")[0]}
            </button>
          );
        })}
      </div>
    </section>
  );
}

/**
 * Aba Mês (pedido do dono em 24/09): organizada de cima para baixo.
 * 1. O plano combinado do mês e os dois caminhos com o agente.
 * 2. Os hypes da semana.
 * 3. A Agenda do mês: o mesmo calendário da Agenda do painel, com seleção,
 *    completar com o agente, abrir no Estúdio e apagar o que não serviu.
 * 4. O gerador de meses: "Planejar e preencher a agenda" faz sozinho mês a mês
 *    (PlanejamentoAutomatico.tsx); "Uma proposta por vez" é o caminho manual.
 *    Os dois seguem o plano combinado de cada mês.
 *
 * O Agente do mês fica sempre à vista: botão flutuante no centro da base da
 * tela (acima da barra do celular) que abre o agente num pop-up grande,
 * centralizado, com histórico, microfone, anexos e custo estimado.
 *
 * `onAbrirNoEstudio` leva um item da agenda para a aba Estúdio. Sem ela, a
 * agenda troca a URL (aba=estudio&task=<id>&mes=<AAAA-MM-01>, mantendo client).
 * `onCriarCampanha` abre a aba Campanhas com o hype escolhido já preenchido.
 */
export default function AbaMes({
  onAbrirNoEstudio,
  onCriarCampanha,
}: {
  onAbrirNoEstudio?: (taskId: string, mes: string) => void;
  onCriarCampanha?: (hypeIndice: number) => void;
} = {}) {
  const [params, setParams] = useSearchParams();
  const mesDaUrl = params.get("mes") || "";
  const mes = MES_VALIDO.test(mesDaUrl) ? mesDaUrl : inicioDoMes();
  const [rapidoAberto, setRapidoAberto] = useState(false);

  /** Abrir no Estúdio: pela aba-mãe quando ela manda; senão pela URL, igual à Agenda do mês. */
  const abrirNoEstudio = (taskId: string, mesAlvo: string) => {
    if (onAbrirNoEstudio) {
      onAbrirNoEstudio(taskId, mesAlvo);
      return;
    }
    const next = new URLSearchParams(params);
    next.set("aba", "estudio");
    next.set("task", taskId);
    if (MES_VALIDO.test(mesAlvo)) next.set("mes", mesAlvo);
    setParams(next, { replace: false });
  };

  const verNoMes = (mesAlvo: string) => {
    if (!MES_VALIDO.test(mesAlvo)) return;
    const next = new URLSearchParams(params);
    next.set("mes", mesAlvo);
    setParams(next, { replace: true });
    const agenda = typeof document !== "undefined" ? document.getElementById("agenda-do-mes") : null;
    if (agenda && typeof agenda.scrollIntoView === "function") agenda.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const [modo, setModo] = useState<ModoDePlanejar>(lerModo);
  const [agenteAberto, setAgenteAberto] = useState(false);
  const [modoAoAbrir, setModoAoAbrir] = useState<ModoDoAgente | undefined>(undefined);
  const [mesDoAgente, setMesDoAgente] = useState(mes);
  const [pendente, setPendente] = useState<PedidoEmAndamento | null>(null);

  const trocarModo = (m: ModoDePlanejar) => {
    setModo(m);
    try {
      window.localStorage.setItem(chaveDoModo, m);
    } catch {
      /* sem armazenamento: vale só nesta visita */
    }
  };

  const abrirAgente = (modoDoAgente?: ModoDoAgente, mesAlvo?: string) => {
    setModoAoAbrir(modoDoAgente);
    setMesDoAgente(mesAlvo && MES_VALIDO.test(mesAlvo) ? mesAlvo : mes);
    setAgenteAberto(true);
  };

  return (
    // Espaço no fim para o botão flutuante nunca cobrir o último conteúdo.
    <div className="min-w-0 space-y-6 pb-28" data-agente="pop-up">
      <PlanoDoMesEmDestaque mes={mes} onConversar={(m, alvo) => abrirAgente(m, alvo)} onRapido={() => setRapidoAberto(true)} />

      <MesConteudoRapido aberto={rapidoAberto} onAbertoChange={setRapidoAberto} onAbrirNoEstudio={abrirNoEstudio} onVerNoMes={verNoMes} />

      <HypesDaSemana
        onCriarCampanha={(i) => onCriarCampanha?.(i)}
        onPedidoInicio={(p) => {
          setPendente(p);
          abrirAgente("criar");
        }}
        onPedidoFim={() => setPendente(null)}
      />

      <AgendaDoMes onAbrirNoEstudio={onAbrirNoEstudio} />

      <section className="space-y-3 border-t border-border pt-6">
        <TituloDeSecao>Gerador de meses</TituloDeSecao>
        <p className="-mt-1 max-w-3xl text-[12.5px] leading-relaxed text-muted-foreground">
          O estrategista propõe e detalha os conteúdos de cada mês seguindo o prompt geral do cliente e o plano combinado com o agente do mês.
        </p>
        <div role="tablist" aria-label="Como planejar" className="grid max-w-xl grid-cols-2 gap-1 rounded-xl bg-muted p-1">
          {(
            [
              { valor: "automatico", rotulo: "Planejar e preencher a agenda" },
              { valor: "proposta", rotulo: "Uma proposta por vez" },
            ] as { valor: ModoDePlanejar; rotulo: string }[]
          ).map((m) => (
            <button
              key={m.valor}
              type="button"
              role="tab"
              aria-selected={modo === m.valor}
              onClick={() => trocarModo(m.valor)}
              className={`min-w-0 rounded-lg px-2 py-2 text-[12.5px] font-medium ${
                modo === m.valor ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {m.rotulo}
            </button>
          ))}
        </div>
        {modo === "automatico" ? <PlanejamentoAutomatico /> : <PlanejarComEstrategista />}
      </section>

      {/* Botão do agente: centro da base da tela, acima da barra do celular. */}
      {!agenteAberto && (
        <div className="pointer-events-none fixed inset-x-0 bottom-[72px] z-40 flex justify-center px-4 md:bottom-6">
          {/* Ação rápida ao lado do agente: um pedido vira conteúdo no dia. */}
          <button
            type="button"
            onClick={() => setRapidoAberto(true)}
            className="pointer-events-auto mr-2 inline-flex h-12 shrink-0 items-center rounded-full bg-card px-4 text-[13px] font-semibold text-foreground shadow-xl ring-4 ring-background transition-transform hover:scale-[1.02]"
            aria-label="Conteúdo rápido"
          >
            <Zap className="h-4 w-4 shrink-0 text-primary sm:mr-1.5" />
            <span className="hidden sm:inline">Rápido</span>
          </button>
          <button
            type="button"
            onClick={() => abrirAgente()}
            className="pointer-events-auto inline-flex h-12 max-w-full items-center rounded-full bg-primary px-5 text-[13.5px] font-semibold text-primary-foreground shadow-xl ring-4 ring-background transition-transform hover:scale-[1.02]"
            aria-label="Abrir o Agente do mês"
          >
            {pendente ? <Loader2 className="mr-2 h-4 w-4 shrink-0 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4 shrink-0" />}
            <span className="truncate">Agente do mês</span>
            <span className="ml-2 hidden rounded-full bg-primary-foreground/15 px-2 py-0.5 text-[11px] font-medium sm:inline">planejar e criar</span>
          </button>
        </div>
      )}

      <Dialog open={agenteAberto} onOpenChange={setAgenteAberto}>
        <DialogContent
          className="flex h-[92vh] w-[calc(100vw-16px)] max-w-6xl flex-col gap-0 overflow-hidden p-0 sm:h-[86vh] sm:w-[calc(100vw-48px)]"
          onInteractOutside={(e) => {
            // Clicar no aviso (ex.: Desfazer) não fecha o agente.
            const alvo = e.target as HTMLElement | null;
            if (alvo && typeof alvo.closest === "function" && alvo.closest("[data-sonner-toaster]")) e.preventDefault();
          }}
        >
          {/* Com o pop-up aberto, o resto da página não recebe clique; os avisos (Desfazer) precisam receber. */}
          <style>{"[data-sonner-toaster]{pointer-events:auto}"}</style>
          <DialogTitle className="sr-only">Agente do mês</DialogTitle>
          <DialogDescription className="sr-only">Converse com o estrategista para planejar o mês e criar conteúdos.</DialogDescription>
          <AgenteDoMes
            onAbrirNoEstudio={
              onAbrirNoEstudio
                ? (taskId, m) => {
                    setAgenteAberto(false);
                    onAbrirNoEstudio(taskId, m);
                  }
                : undefined
            }
            pendenteExterno={pendente}
            className="min-h-0 flex-1"
            mesInicial={mesDoAgente}
            modoInicial={modoAoAbrir}
            painelDoPlano
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
