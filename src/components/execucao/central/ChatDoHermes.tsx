import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowUp, Bot, Check, ChevronDown, CircleAlert, FileText, GitBranch, Loader2, NotebookPen, Paperclip, Plus, ShieldAlert, Wrench, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from "@/components/ui/command";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { chamarFuncao, textoDoErro } from "@/lib/mesa/api";
import { ehImagem, prepararImagem } from "@/lib/gestorAnexos";
import { Carregando, EstadoDeErro, botao, juntar, useEstadoDaTela, superficie } from "@/components/sistema";
import { ROLAGEM_OPERACAO } from "@/components/execucao/CarteiraDaOperacao";

/**
 * Chat do Hermes ao lado do Gestor (Central de Autonomia, 08/10/2026).
 *
 * Conversa real com as sessões do Hermes pela ponte do painel (função
 * gestor-aceleriq, ações hermes_*). Nada é simulado: sem ponte, a tela diz
 * isso e oferece o diário da coordenação.
 *
 * - A sessão aberta fica lembrada (useEstadoDaTela).
 * - Depois do envio, o estado do turno é lido a cada 1 s: o texto parcial
 *   cresce no balão, com as ferramentas em uso e os comentários do Hermes.
 * - Anexos: imagens (reduzidas aqui para até 1600 px) e arquivos de texto
 *   (vão junto da mensagem). Outros tipos não vão: o Hermes recebe só isso.
 * - Sessão só de leitura (Desktop em uso, rotina): "Continuar esta conversa
 *   aqui" cria uma cópia; a original fica intacta.
 */

export type ContextoDoHermes = { cliente: { id: string; nome: string } | null; projeto: { id: string; nome: string } | null };

export type OrigemDaSessao = "desktop" | "api_server" | "cron" | "cli" | "kanban" | "subagent" | "tool" | "oneshot";

export type SessaoDoHermes = {
  id: string;
  titulo: string;
  origem: OrigemDaSessao | string;
  iniciada_em?: number | string | null;
  ultima_atividade: number | string | null;
  mensagens: number;
  ferramentas: number;
  pode_enviar: boolean;
  ocupada: boolean;
};

export type MensagemDoHermes = { id: string | number | null; papel: "user" | "assistant" | "tool" | string; texto: string; ferramenta: string | null; chamadas: string[]; quando: number | string | null };

export type FerramentaDoTurno = { nome: string; estado: "rodando" | "feita" | "falhou"; resumo?: string | null; desde?: number | string | null; fim?: number | string | null };

export type EstadoDoTurno = {
  ocupada: boolean;
  desde?: number | string | null;
  fim?: number | string | null;
  erro: string | null;
  parcial: string;
  ferramentas: FerramentaDoTurno[];
  comentarios: string[];
  aguardando_aprovacao: boolean;
};

type Filtro = "conversas" | "rotinas";

const ORIGEM: Record<string, string> = { desktop: "Desktop", api_server: "Painel", cron: "Rotina", cli: "Terminal", kanban: "Kanban", subagent: "Subagente", tool: "Ferramenta", oneshot: "Avulsa" };
const DE_CONVERSA = ["desktop", "api_server", "cli"];

const CHAVE_DA_SESSAO = "execucao:central:hermes-sessao";
const LIMITE_DO_TEXTO = 2500;
const MAX_IMAGENS = 4;
const MAX_CARACTERES_DO_ARQUIVO = 30000;
const INTERVALO_DO_TURNO_MS = 1000;

const BALAO_HERMES = "w-fit min-w-0 max-w-[92%] rounded-[20px] rounded-tl-md bg-muted/70 px-4 py-2.5 text-[14px] leading-relaxed text-foreground sm:max-w-[85%]";
const BALAO_DONO = "min-w-0 max-w-[88%] whitespace-pre-wrap break-words rounded-[20px] rounded-tr-md bg-primary px-4 py-2.5 text-[14px] leading-relaxed text-primary-foreground sm:max-w-[80%]";

/** Unix em segundos, milissegundos ou ISO: vira Date (ou null). */
function paraData(v: number | string | null | undefined): Date | null {
  if (v === null || v === undefined || v === "") return null;
  const d = typeof v === "number" ? new Date(v < 1e12 ? v * 1000 : v) : /^\d+(\.\d+)?$/.test(v) ? new Date(Number(v) < 1e12 ? Number(v) * 1000 : Number(v)) : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

const msDe = (v: number | string | null | undefined) => paraData(v)?.getTime() ?? 0;

/** "agora", "há 5 min", "há 3 h", "ontem", "há 4 dias" ou a data. */
export function tempoRelativo(v: number | string | null | undefined, agora = Date.now()): string {
  const d = paraData(v);
  if (!d) return "";
  const s = Math.max(0, Math.round((agora - d.getTime()) / 1000));
  if (s < 60) return "agora";
  if (s < 3600) return `há ${Math.floor(s / 60)} min`;
  if (s < 86400) return `há ${Math.floor(s / 3600)} h`;
  const dias = Math.floor(s / 86400);
  if (dias === 1) return "ontem";
  if (dias < 7) return `há ${dias} dias`;
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

const hora = (v: number | string | null | undefined) => {
  const d = paraData(v);
  return d ? d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "";
};

const maisRecente = (a: SessaoDoHermes, b: SessaoDoHermes) => msDe(b.ultima_atividade ?? b.iniciada_em) - msDe(a.ultima_atividade ?? a.iniciada_em);

/** A sessão que abre na primeira vez: a conversa mais recente que aceita mensagem; senão, a mais recente. */
export function sessaoInicial(sessoes: SessaoDoHermes[]): SessaoDoHermes | null {
  const conversas = sessoes.filter((s) => DE_CONVERSA.indexOf(String(s.origem)) >= 0).sort(maisRecente);
  return conversas.find((s) => s.pode_enviar) || conversas[0] || null;
}

const ehTextoLegivel = (f: { name: string; type: string }) => /^text\//i.test(f.type || "") || /\.(txt|md|markdown|csv|json)$/i.test(f.name || "") || /^application\/json$/i.test(f.type || "");

function erroDoEnvio(e: unknown): string {
  const codigo = String((e as { codigo?: string })?.codigo || "");
  const msg = String((e as { message?: string })?.message || "");
  if (codigo === "hermes_ocupado" || msg.indexOf("hermes_ocupado") >= 0) return "O Hermes ainda está trabalhando nesta conversa. Espere o turno terminar.";
  if (codigo === "sessao_so_leitura" || msg.indexOf("sessao_so_leitura") >= 0) return "Esta conversa é só de leitura. Use \"Continuar esta conversa aqui\".";
  return textoDoErro(e, "O Hermes não recebeu a mensagem. Tente de novo.");
}

// ------------------------------------------------------------------ peças pequenas

function TextoLongo({ texto }: { texto: string }) {
  const [aberto, setAberto] = useState(false);
  const longo = texto.length > LIMITE_DO_TEXTO;
  return (
    <>
      <span className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{longo && !aberto ? `${texto.slice(0, LIMITE_DO_TEXTO).trimEnd()}…` : texto}</span>
      {longo && (
        <button type="button" onClick={() => setAberto((a) => !a)} className="mt-1 block text-[12px] font-medium text-primary hover:underline">
          {aberto ? "ver menos" : "ver tudo"}
        </button>
      )}
    </>
  );
}

function Digitando() {
  return (
    <span className="flex gap-1 py-1.5" aria-hidden="true">
      {[0, 1, 2].map((i) => <span key={i} className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/70" style={{ animationDelay: `${i * 140}ms` }} />)}
    </span>
  );
}

function ChipDaFerramenta({ f }: { f: FerramentaDoTurno }) {
  return (
    <span
      className={juntar(
        "inline-flex min-w-0 max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-[11px]",
        f.estado === "falhou" ? "bg-destructive/10 text-destructive" : f.estado === "feita" ? "bg-success/10 text-success" : "bg-muted text-muted-foreground",
      )}
      title={f.resumo || f.nome}
      data-ferramenta={f.estado}
    >
      {f.estado === "rodando" ? <Loader2 className="h-3 w-3 shrink-0 animate-spin" /> : f.estado === "feita" ? <Check className="h-3 w-3 shrink-0" /> : <X className="h-3 w-3 shrink-0" />}
      <span className="truncate">{f.nome}</span>
    </span>
  );
}

function BalaoAoVivo({ estado }: { estado: EstadoDoTurno | undefined }) {
  const parcial = estado?.parcial || "";
  const ferramentas = estado?.ferramentas || [];
  const comentarios = (estado?.comentarios || []).slice(-2);
  return (
    <div className="flex min-w-0 flex-col items-start gap-1.5" data-turno-ao-vivo="">
      <div className={BALAO_HERMES} role="status" aria-label="O Hermes está respondendo">
        {parcial ? (
          <span className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
            {parcial}
            <span className="ml-0.5 inline-block h-4 w-[2px] translate-y-0.5 animate-pulse bg-foreground/70" aria-hidden="true" />
          </span>
        ) : <Digitando />}
      </div>
      {ferramentas.length > 0 && (
        <div className="flex max-w-full flex-wrap gap-1" aria-label="Ferramentas do turno">
          {ferramentas.map((f, i) => <ChipDaFerramenta key={`${f.nome}-${i}`} f={f} />)}
        </div>
      )}
      {comentarios.map((c, i) => <p key={i} className="max-w-full break-words px-1 text-[12px] italic text-muted-foreground">{c}</p>)}
      {estado?.aguardando_aprovacao && (
        <span className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-warning/10 px-2.5 py-1 text-[12px] text-warning">
          <ShieldAlert className="h-3.5 w-3.5 shrink-0" />O Hermes pediu aprovação para um comando; aprove no app do Hermes
        </span>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ seletor de sessões

function SeletorDeSessoes({ aberta, aoEscolher, aoCriar, criando, habilitado }: {
  aberta: SessaoDoHermes | null;
  aoEscolher: (s: SessaoDoHermes) => void;
  aoCriar: () => void;
  criando: boolean;
  habilitado: boolean;
}) {
  const [aberto, setAberto] = useState(false);
  const [busca, setBusca] = useState("");
  const [buscaAdiada, setBuscaAdiada] = useState("");
  const [filtro, setFiltro] = useState<Filtro>("conversas");
  useEffect(() => {
    const t = setTimeout(() => setBuscaAdiada(busca.trim()), 300);
    return () => clearTimeout(t);
  }, [busca]);
  const sessoes = useQuery({
    queryKey: ["hermes", "sessoes", filtro, buscaAdiada],
    enabled: habilitado && aberto,
    staleTime: 15_000,
    queryFn: async () => (await chamarFuncao<{ sessoes: SessaoDoHermes[] }>("gestor-aceleriq", { acao: "hermes_sessoes", origem: filtro, ...(buscaAdiada ? { busca: buscaAdiada } : {}) })).sessoes || [],
  });
  const lista = useMemo(() => (sessoes.data || []).slice().sort(maisRecente), [sessoes.data]);

  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={!habilitado}
          aria-label={`Sessão do Hermes: ${aberta?.titulo || "escolher"}`}
          className="group flex min-w-0 flex-1 items-center gap-1 rounded-lg px-1.5 py-1 text-left hover:bg-muted disabled:opacity-60"
        >
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[14px] font-semibold leading-tight">{aberta?.titulo || "Hermes"}</span>
            <span className="block truncate text-[11px] text-muted-foreground">
              {aberta ? `${ORIGEM[aberta.origem] || aberta.origem} · ${aberta.mensagens} mensagens${aberta.pode_enviar ? "" : " · só leitura"}` : "Escolha uma conversa"}
            </span>
          </span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={6} className="w-[min(92vw,360px)] p-0">
        <Command shouldFilter={false} label="Sessões do Hermes">
          <CommandInput value={busca} onValueChange={setBusca} placeholder="Buscar sessões" aria-label="Buscar sessões do Hermes" className="h-10 text-[13px]" />
          <div className="flex gap-1 border-b border-border/60 p-1.5" role="radiogroup" aria-label="Tipo de sessão">
            {(["conversas", "rotinas"] as Filtro[]).map((f) => (
              <button
                key={f}
                type="button"
                role="radio"
                aria-checked={filtro === f}
                onClick={() => setFiltro(f)}
                className={juntar("flex-1 rounded-md px-2 py-1 text-[12px] font-medium", filtro === f ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/60")}
              >
                {f === "conversas" ? "Conversas" : "Rotinas"}
              </button>
            ))}
          </div>
          <CommandList className={juntar(ROLAGEM_OPERACAO, "max-h-[320px]")}>
            {sessoes.isLoading ? (
              <div className="p-3"><Carregando linhas={3} rotulo="Lendo as sessões do Hermes" /></div>
            ) : sessoes.isError ? (
              <p className="px-3 py-4 text-[12px] text-muted-foreground">Não consegui ler as sessões. {textoDoErro(sessoes.error)}</p>
            ) : (
              <CommandEmpty className="px-3 py-4 text-center text-[12px] text-muted-foreground">Nenhuma sessão com esse nome.</CommandEmpty>
            )}
            {lista.length > 0 && (
              <CommandGroup>
                {lista.map((s) => (
                  <CommandItem
                    key={s.id}
                    value={s.id}
                    onSelect={() => { aoEscolher(s); setAberto(false); }}
                    className={juntar("flex min-w-0 items-center gap-2 rounded-md px-2 py-2", aberta?.id === s.id && "bg-muted/60")}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium">{s.titulo || "Sem título"}</span>
                      <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                        <span className="rounded-full bg-muted px-1.5 py-px text-[10px]">{ORIGEM[s.origem] || s.origem}</span>
                        <span className="truncate">{tempoRelativo(s.ultima_atividade ?? s.iniciada_em)}</span>
                        {!s.pode_enviar && <span className="shrink-0">· leitura</span>}
                      </span>
                    </span>
                    {s.ocupada && <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-success" title="trabalhando" aria-label="trabalhando" />}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            <CommandSeparator />
            <CommandGroup>
              <CommandItem value="__nova__" onSelect={() => { aoCriar(); setAberto(false); }} disabled={criando} className="gap-2 rounded-md px-2 py-2 text-[13px] font-medium text-primary">
                {criando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}Nova conversa
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// ------------------------------------------------------------------ anexos

type ImagemAnexada = { id: string; nome: string; dataUrl: string };
type TextoAnexado = { id: string; nome: string; conteudo: string; cortado: boolean };

/** Texto do arquivo: File.text() quando existe; FileReader no Safari antigo (piso Safari 11). */
function lerTexto(f: File): Promise<string> {
  if (typeof (f as { text?: unknown }).text === "function") return f.text();
  return new Promise((ok, falha) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result || ""));
    r.onerror = () => falha(new Error("leitura"));
    r.readAsText(f);
  });
}

const novoId = () => `a-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

/** Arquivo arrastado da biblioteca do painel (application/x-aceleriq-arquivo): baixa pela URL assinada. */
async function arquivosDoPainel(bruto: string): Promise<File[]> {
  let dados: unknown;
  try { dados = JSON.parse(bruto); } catch { return []; }
  const itens = (Array.isArray(dados) ? dados : [dados]) as Array<{ nome?: string; mime?: string; url?: string }>;
  const saida: File[] = [];
  for (const it of itens) {
    if (!it || !it.url) continue;
    const r = await fetch(it.url);
    if (!r.ok) throw new Error(`Não consegui baixar ${it.nome || "o arquivo"}.`);
    const blob = await r.blob();
    saida.push(new File([blob], it.nome || "arquivo", { type: it.mime || blob.type || "" }));
  }
  return saida;
}

// ------------------------------------------------------------------ o chat

export default function ChatDoHermes({ contexto, acoes, className, aoAbrirDiario }: {
  contexto: ContextoDoHermes;
  /** Botões do cabeçalho vindos de quem contém o chat (recolher, ampliar). */
  acoes?: ReactNode;
  className?: string;
  aoAbrirDiario?: () => void;
}) {
  const qc = useQueryClient();
  const [sessaoId, setSessaoId] = useEstadoDaTela<string>(CHAVE_DA_SESSAO, "", { esperaMs: 0, validar: (v) => typeof v === "string" });
  const [rascunho, setRascunho] = useState("");
  const [levar, setLevar] = useState(true);
  const [imagens, setImagens] = useState<ImagemAnexada[]>([]);
  const [textos, setTextos] = useState<TextoAnexado[]>([]);
  const [lendo, setLendo] = useState(0);
  const [soltando, setSoltando] = useState(false);
  /** O turno que esta tela mandou e acompanha (até o Hermes terminar). */
  const [turno, setTurno] = useState<{ sessaoId: string; desde: number | string | null; base: number; texto: string; previas: string[]; arquivos: string[] } | null>(null);
  const vistoOcupada = useRef(false);
  const leiturasLivres = useRef(0);
  const corpo = useRef<HTMLDivElement>(null);
  const pertoDoFim = useRef(true);
  const seletor = useRef<HTMLInputElement>(null);
  const campo = useRef<HTMLTextAreaElement>(null);

  const estado = useQuery({
    queryKey: ["hermes", "estado"],
    queryFn: () => chamarFuncao<{ configurada: boolean; ok?: boolean; erro?: string }>("gestor-aceleriq", { acao: "hermes_estado" }),
    staleTime: 60_000,
    retry: false,
  });
  const ponte = !!estado.data?.configurada && !!estado.data?.ok;

  // Primeira vez (nada lembrado): a conversa mais recente que aceita mensagem.
  const conversas = useQuery({
    queryKey: ["hermes", "sessoes", "conversas", ""],
    enabled: ponte && !sessaoId,
    staleTime: 15_000,
    queryFn: async () => (await chamarFuncao<{ sessoes: SessaoDoHermes[] }>("gestor-aceleriq", { acao: "hermes_sessoes", origem: "conversas" })).sessoes || [],
  });
  useEffect(() => {
    if (sessaoId || !conversas.data) return;
    const s = sessaoInicial(conversas.data);
    if (s) setSessaoId(s.id);
  }, [sessaoId, conversas.data, setSessaoId]);

  const acompanhando = !!turno && turno.sessaoId === sessaoId;
  const sessao = useQuery({
    queryKey: ["hermes", "sessao", sessaoId],
    enabled: ponte && !!sessaoId,
    staleTime: 10_000,
    refetchInterval: acompanhando ? false : 20_000,
    queryFn: () => chamarFuncao<{ sessao: SessaoDoHermes; mensagens: MensagemDoHermes[] }>("gestor-aceleriq", { acao: "hermes_sessao", sessao_id: sessaoId }),
  });
  const aberta = sessao.data?.sessao || null;
  const ocupadaNoServidor = !!aberta?.ocupada;

  const vivo = useQuery({
    queryKey: ["hermes", "turno", sessaoId],
    enabled: ponte && !!sessaoId && (acompanhando || ocupadaNoServidor),
    refetchInterval: INTERVALO_DO_TURNO_MS,
    refetchIntervalInBackground: true,
    gcTime: 0,
    queryFn: () => chamarFuncao<EstadoDoTurno>("gestor-aceleriq", { acao: "hermes_estado_da_sessao", sessao_id: sessaoId }),
  });

  // Fim do turno: relê a conversa gravada, tira o balão ao vivo e avisa a falha.
  const encerrando = useRef(false);
  const ultimaLeitura = useRef(0);
  useEffect(() => {
    const e = vivo.data;
    if (!e || encerrando.current || vivo.dataUpdatedAt === ultimaLeitura.current) return;
    ultimaLeitura.current = vivo.dataUpdatedAt;
    if (e.ocupada) { vistoOcupada.current = true; leiturasLivres.current = 0; return; }
    if (!acompanhando && !ocupadaNoServidor) return;
    leiturasLivres.current += 1;
    // Logo depois do envio o Hermes pode ainda não ter começado: espera ver o turno (ou 3 leituras livres).
    if (acompanhando && !vistoOcupada.current && leiturasLivres.current < 3) return;
    encerrando.current = true;
    const doTurno = vistoOcupada.current || !turno?.desde || !e.desde || String(e.desde) === String(turno.desde);
    if (e.erro && doTurno) toast.error(`O turno do Hermes falhou: ${e.erro}`);
    const id = sessaoId;
    void Promise.all([
      qc.invalidateQueries({ queryKey: ["hermes", "sessao", id] }),
      qc.invalidateQueries({ queryKey: ["hermes", "sessoes"] }),
    ]).finally(() => {
      qc.removeQueries({ queryKey: ["hermes", "turno", id] });
      setTurno((t) => (t && t.sessaoId === id ? null : t));
      vistoOcupada.current = false;
      leiturasLivres.current = 0;
      encerrando.current = false;
    });
  }, [vivo.data, vivo.dataUpdatedAt, acompanhando, ocupadaNoServidor, sessaoId, turno, qc]);

  const trocarDeSessao = (id: string) => {
    if (id === sessaoId) return;
    pertoDoFim.current = true;
    vistoOcupada.current = false;
    leiturasLivres.current = 0;
    setSessaoId(id);
  };

  const criar = useMutation({
    mutationFn: () => chamarFuncao<{ sessao: SessaoDoHermes }>("gestor-aceleriq", { acao: "hermes_criar", titulo: contexto.cliente?.nome || "Central" }),
    onSuccess: (r) => {
      if (r?.sessao?.id) {
        qc.setQueryData(["hermes", "sessao", r.sessao.id], { sessao: r.sessao, mensagens: [] });
        trocarDeSessao(r.sessao.id);
      }
      void qc.invalidateQueries({ queryKey: ["hermes", "sessoes"] });
      setTimeout(() => campo.current?.focus(), 0);
    },
    onError: (e) => toast.error(textoDoErro(e, "Não consegui criar a conversa no Hermes.")),
  });
  const continuar = useMutation({
    mutationFn: (id: string) => chamarFuncao<{ sessao: SessaoDoHermes }>("gestor-aceleriq", { acao: "hermes_continuar", sessao_id: id }),
    onSuccess: (r) => {
      if (r?.sessao?.id) trocarDeSessao(r.sessao.id);
      void qc.invalidateQueries({ queryKey: ["hermes", "sessoes"] });
      toast.success("Continuação criada. A conversa original fica intacta.");
    },
    onError: (e) => toast.error(textoDoErro(e, "Não consegui continuar esta conversa.")),
  });

  type Envio = { texto: string; imagens: ImagemAnexada[]; textos: TextoAnexado[] };
  const enviar = useMutation({
    mutationFn: (x: Envio) => {
      const anexos = x.textos.map((t) => `\n\n[Arquivo ${t.nome}]\n${t.conteudo}`).join("");
      const texto = `${x.texto || (x.imagens.length ? "Veja as imagens em anexo." : "Veja o arquivo em anexo.")}${anexos}`;
      return chamarFuncao<{ aceito?: boolean; desde?: number | string | null }>("gestor-aceleriq", {
        acao: "hermes_enviar",
        sessao_id: sessaoId,
        texto,
        ...(levar && contexto.cliente ? { contexto: { cliente: contexto.cliente, projeto: contexto.projeto } } : {}),
        ...(x.imagens.length ? { imagens: x.imagens.map((i) => i.dataUrl) } : {}),
      });
    },
    onMutate: (x) => {
      vistoOcupada.current = false;
      leiturasLivres.current = 0;
      pertoDoFim.current = true;
      setTurno({ sessaoId, desde: null, base: sessao.data?.mensagens?.length || 0, texto: x.texto, previas: x.imagens.map((i) => i.dataUrl), arquivos: x.textos.map((t) => t.nome) });
      setRascunho("");
      setImagens([]);
      setTextos([]);
    },
    onSuccess: (r) => {
      setTurno((t) => (t ? { ...t, desde: r?.desde ?? null } : t));
      void qc.invalidateQueries({ queryKey: ["hermes", "turno", sessaoId] });
    },
    onError: (e, x) => {
      setTurno(null);
      setRascunho(x.texto);
      setImagens(x.imagens);
      setTextos(x.textos);
      toast.error(erroDoEnvio(e));
    },
  });

  // ---------------------------------------------------------------- anexos
  const adicionar = async (lista: FileList | File[] | null | undefined) => {
    const todos = lista ? (Array.prototype.slice.call(lista) as File[]) : [];
    if (!todos.length) return;
    let vagas = MAX_IMAGENS - imagens.length;
    let recusado = false;
    for (const f of todos) {
      if (ehImagem(f) || /^image\//i.test(f.type || "")) {
        if (vagas <= 0) { toast.info(`Até ${MAX_IMAGENS} imagens por mensagem.`); continue; }
        vagas -= 1;
        setLendo((n) => n + 1);
        prepararImagem(f)
          .then((img) => setImagens((l) => (l.length < MAX_IMAGENS ? l.concat({ id: img.id, nome: img.nome, dataUrl: img.previa }) : l)))
          .catch(() => toast.error(`Não deu para abrir ${f.name}.`))
          .finally(() => setLendo((n) => n - 1));
      } else if (ehTextoLegivel(f)) {
        setLendo((n) => n + 1);
        try {
          const t = await lerTexto(f);
          setTextos((l) => l.concat({ id: novoId(), nome: f.name || "arquivo", conteudo: t.slice(0, MAX_CARACTERES_DO_ARQUIVO), cortado: t.length > MAX_CARACTERES_DO_ARQUIVO }));
        } catch {
          toast.error(`Não deu para ler ${f.name}.`);
        } finally {
          setLendo((n) => n - 1);
        }
      } else {
        recusado = true;
      }
    }
    if (recusado) toast.error("O Hermes recebe texto e imagens; este tipo de arquivo não vai.");
  };

  const soltar = async (dt: DataTransfer | null) => {
    if (!dt) return;
    const doPainel = dt.getData("application/x-aceleriq-arquivo");
    if (doPainel) {
      setLendo((n) => n + 1);
      try { await adicionar(await arquivosDoPainel(doPainel)); } catch (e) { toast.error(textoDoErro(e, "Não consegui trazer o arquivo do painel.")); } finally { setLendo((n) => n - 1); }
      return;
    }
    await adicionar(dt.files);
  };

  // ---------------------------------------------------------------- rolagem
  const mensagens = useMemo(() => (sessao.data?.mensagens || []).filter((m) => m.papel !== "tool" && (m.texto.trim() || m.chamadas.length)), [sessao.data]);
  const localJaChegou = !!turno && (sessao.data?.mensagens?.length || 0) > turno.base && (sessao.data?.mensagens || []).slice(turno.base).some((m) => m.papel === "user");
  const mostrarLocal = acompanhando && !localJaChegou;
  const emTurno = acompanhando || ocupadaNoServidor;
  const parcial = vivo.data?.parcial || "";

  useEffect(() => {
    const el = corpo.current;
    if (!el || !pertoDoFim.current) return;
    el.scrollTop = el.scrollHeight;
  }, [sessaoId, mensagens.length, parcial.length, mostrarLocal, emTurno, vivo.data?.ferramentas?.length]);

  useEffect(() => {
    const t = campo.current;
    if (!t) return;
    if (!rascunho) { t.style.height = ""; return; }
    t.style.height = "auto";
    t.style.height = `${Math.min(t.scrollHeight, 160)}px`;
  }, [rascunho]);

  const temAnexo = imagens.length > 0 || textos.length > 0;
  const ocupado = enviar.isPending || emTurno || lendo > 0;
  const mandar = () => {
    const texto = rascunho.trim();
    if ((!texto && !temAnexo) || ocupado || !aberta?.pode_enviar) return;
    enviar.mutate({ texto, imagens, textos });
  };

  const rotuloDoContexto = contexto.cliente ? `${contexto.cliente.nome}${contexto.projeto ? ` · ${contexto.projeto.nome}` : ""}` : "";

  // ---------------------------------------------------------------- corpo
  let conteudo: ReactNode;
  if (estado.isLoading) {
    conteudo = <Carregando linhas={3} rotulo="Ligando com o Hermes" />;
  } else if (!ponte) {
    const erro = estado.data?.erro || (estado.isError ? textoDoErro(estado.error) : !estado.data?.configurada ? "A ponte do painel não está configurada no servidor do Hermes." : "");
    conteudo = (
      <div className="mx-auto flex max-w-sm flex-col items-center py-8 text-center">
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-warning/10 text-warning"><CircleAlert className="h-5 w-5" /></span>
        <p className="mt-3 text-[14px] font-medium">A ponte com o Hermes não respondeu agora.</p>
        {erro && <p className="mt-1 break-words text-[12px] text-muted-foreground">{erro}</p>}
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          {aoAbrirDiario && <button type="button" onClick={aoAbrirDiario} className={juntar(botao.secundario, "h-8 rounded-full text-[12px]")}><NotebookPen className="mr-1.5 h-3.5 w-3.5" />Abrir o diário da coordenação</button>}
          <button type="button" onClick={() => void estado.refetch()} className={juntar(botao.discreto, "h-8 rounded-full text-[12px]")}>Tentar de novo</button>
        </div>
      </div>
    );
  } else if (!sessaoId) {
    conteudo = conversas.isLoading ? <Carregando linhas={3} rotulo="Lendo as conversas do Hermes" /> : conversas.isError ? (
      <EstadoDeErro titulo="Não consegui ler as conversas do Hermes." descricao={textoDoErro(conversas.error)} acao={<button type="button" className={botao.secundario} onClick={() => void conversas.refetch()}>Tentar de novo</button>} />
    ) : (
      <div className="flex flex-col items-center py-10 text-center">
        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-primary/10 text-primary"><Bot className="h-5 w-5" /></span>
        <p className="mt-3 text-[15px] font-semibold">Nenhuma conversa com o Hermes ainda.</p>
        <button type="button" onClick={() => criar.mutate()} disabled={criar.isPending} className={juntar(botao.primario, "mt-4 h-8 rounded-full text-[12px]")}>
          {criar.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Plus className="mr-1.5 h-3.5 w-3.5" />}Nova conversa
        </button>
      </div>
    );
  } else if (sessao.isLoading) {
    conteudo = <Carregando linhas={3} rotulo="Abrindo a conversa" />;
  } else if (sessao.isError) {
    conteudo = (
      <EstadoDeErro
        titulo="Não abri esta conversa do Hermes."
        descricao={textoDoErro(sessao.error)}
        acao={<div className="flex flex-wrap gap-2"><button type="button" className={botao.secundario} onClick={() => void sessao.refetch()}>Tentar de novo</button><button type="button" className={botao.discreto} onClick={() => setSessaoId("")}>Abrir a mais recente</button></div>}
      />
    );
  } else {
    conteudo = (
      <>
        {mensagens.length === 0 && !mostrarLocal && !emTurno && (
          <div className="flex flex-col items-center py-10 text-center">
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-primary/10 text-primary"><Bot className="h-5 w-5" /></span>
            <p className="mt-3 text-[15px] font-semibold">Converse com o Hermes</p>
            <p className="mt-1 max-w-xs text-[12px] text-muted-foreground">Ele coordena os agentes. Pode mandar texto, imagem ou arquivo de texto.</p>
          </div>
        )}
        {mensagens.map((m, i) => (
          m.papel === "user" ? (
            <div key={`${m.id}-${i}`} className="flex min-w-0 flex-col items-end gap-1">
              <div className={BALAO_DONO}><TextoLongo texto={m.texto} /></div>
              {hora(m.quando) && <span className="px-1 text-[11px] text-muted-foreground">{hora(m.quando)}</span>}
            </div>
          ) : (
            <div key={`${m.id}-${i}`} className="flex min-w-0 flex-col items-start gap-1">
              {m.texto.trim() && <div className={BALAO_HERMES}><TextoLongo texto={m.texto} /></div>}
              {m.chamadas.length > 0 && (
                <div className="flex max-w-full flex-wrap gap-1">
                  {m.chamadas.map((c, k) => <span key={`${c}-${k}`} className="inline-flex max-w-full items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground"><Wrench className="h-2.5 w-2.5 shrink-0" /><span className="truncate">usou {c}</span></span>)}
                </div>
              )}
              {hora(m.quando) && <span className="px-1 text-[11px] text-muted-foreground">{hora(m.quando)}</span>}
            </div>
          )
        ))}
        {mostrarLocal && turno && (
          <div className="flex min-w-0 flex-col items-end gap-1">
            {turno.texto && <div className={BALAO_DONO}><TextoLongo texto={turno.texto} /></div>}
            {(turno.previas.length > 0 || turno.arquivos.length > 0) && (
              <div className="flex max-w-[88%] flex-wrap justify-end gap-1.5">
                {turno.previas.map((src, i) => <img key={i} src={src} alt="" className="h-16 w-16 rounded-md object-cover ring-1 ring-border" />)}
                {turno.arquivos.map((n, i) => <span key={`f${i}`} className="inline-flex max-w-[200px] items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-[11px] text-muted-foreground"><FileText className="h-3 w-3 shrink-0" /><span className="truncate">{n}</span></span>)}
              </div>
            )}
          </div>
        )}
        {emTurno && <BalaoAoVivo estado={vivo.data} />}
      </>
    );
  }

  const podeEscrever = ponte && !!aberta && !sessao.isError;

  return (
    <section
      aria-label="Hermes"
      className={juntar(superficie.painel, "relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden", className)}
      onDragOver={(e) => {
        const tipos = Array.prototype.slice.call(e.dataTransfer?.types || []) as string[];
        if (podeEscrever && aberta?.pode_enviar && (tipos.indexOf("Files") >= 0 || tipos.indexOf("application/x-aceleriq-arquivo") >= 0)) { e.preventDefault(); setSoltando(true); }
      }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setSoltando(false); }}
      onDrop={(e) => { if (!soltando) return; e.preventDefault(); setSoltando(false); void soltar(e.dataTransfer); }}
    >
      {soltando && (
        <div className="pointer-events-none absolute inset-2 z-20 flex items-center justify-center rounded-lg border-2 border-dashed border-primary bg-background/90 px-4 text-center text-[14px] font-medium text-primary">
          Solte aqui: imagens ou arquivos de texto
        </div>
      )}

      <div className="flex min-w-0 shrink-0 items-center gap-1.5 border-b border-border/70 px-3 py-2 sm:px-4">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"><Bot className="h-4 w-4" /></span>
        {ponte ? (
          <SeletorDeSessoes aberta={aberta} aoEscolher={(s) => trocarDeSessao(s.id)} aoCriar={() => criar.mutate()} criando={criar.isPending} habilitado={ponte} />
        ) : (
          <div className="min-w-0 flex-1 px-1.5">
            <h3 className="truncate text-[14px] font-semibold leading-tight">Hermes</h3>
            <p className="truncate text-[11px] text-muted-foreground">{estado.isLoading ? "Ligando…" : "Ponte desligada"}</p>
          </div>
        )}
        {emTurno && <span className="hidden shrink-0 items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 text-[11px] text-success min-[420px]:inline-flex"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-success" />trabalhando</span>}
        {aoAbrirDiario && (
          <button type="button" onClick={aoAbrirDiario} className={botao.icone} aria-label="Diário da coordenação" title="Diário da coordenação">
            <NotebookPen className="h-4 w-4" />
          </button>
        )}
        {acoes && <div className="flex shrink-0 items-center gap-1">{acoes}</div>}
      </div>

      <div
        ref={corpo}
        className={juntar(ROLAGEM_OPERACAO, "min-h-0 flex-1 overflow-x-hidden")}
        aria-live="polite"
        onScroll={(e) => { const el = e.currentTarget; pertoDoFim.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120; }}
      >
        <div className="mx-auto flex w-full min-w-0 max-w-3xl flex-col gap-4 px-3 py-4 sm:px-5">{conteudo}</div>
      </div>

      {podeEscrever && aberta && (
        aberta.pode_enviar ? (
          <form className="shrink-0 border-t border-border/70 bg-card px-3 py-2.5 sm:px-4" onSubmit={(e) => { e.preventDefault(); mandar(); }}>
            <div className="mx-auto w-full min-w-0 max-w-3xl">
              {(temAnexo || lendo > 0) && (
                <div className="mb-2 flex flex-wrap items-center gap-1.5">
                  {imagens.map((i) => (
                    <span key={i.id} className="relative">
                      <img src={i.dataUrl} alt={i.nome} className="h-14 w-14 rounded-md object-cover ring-1 ring-border" />
                      <button type="button" aria-label={`Tirar ${i.nome}`} onClick={() => setImagens((l) => l.filter((x) => x.id !== i.id))} className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-foreground text-background"><X className="h-3 w-3" /></button>
                    </span>
                  ))}
                  {textos.map((a) => (
                    <span key={a.id} className="inline-flex min-w-0 max-w-[220px] items-center gap-1.5 rounded-full border border-border bg-background py-1 pl-2.5 pr-1 text-[12px]" title={a.cortado ? `Vão os primeiros ${MAX_CARACTERES_DO_ARQUIVO.toLocaleString("pt-BR")} caracteres` : `${a.conteudo.length.toLocaleString("pt-BR")} caracteres`}>
                      <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /><span className="truncate">{a.nome}</span>
                      <button type="button" aria-label={`Tirar ${a.nome}`} onClick={() => setTextos((l) => l.filter((x) => x.id !== a.id))} className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full hover:bg-muted"><X className="h-3 w-3" /></button>
                    </span>
                  ))}
                  {lendo > 0 && <span className="inline-flex items-center gap-1 text-[12px] text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" />Lendo…</span>}
                </div>
              )}
              {contexto.cliente && (
                <button
                  type="button"
                  aria-pressed={levar}
                  onClick={() => setLevar((v) => !v)}
                  title={levar ? "O cliente e o projeto vão junto da mensagem. Clique para não levar." : "Clique para levar o cliente e o projeto junto da mensagem."}
                  className={juntar(
                    "mb-1.5 inline-flex max-w-full items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px]",
                    levar ? "border-primary/30 bg-primary/5 text-primary" : "border-border text-muted-foreground line-through",
                  )}
                >
                  {levar ? <Check className="h-3 w-3 shrink-0" /> : <X className="h-3 w-3 shrink-0" />}
                  <span className="truncate">Levar contexto: {rotuloDoContexto}</span>
                </button>
              )}
              <div className="flex min-w-0 items-end gap-1.5 rounded-[26px] border border-border bg-background py-1.5 pl-1.5 pr-1.5 shadow-sm focus-within:border-primary/50">
                <input ref={seletor} type="file" multiple accept="image/*,.txt,.md,.csv,.json,text/*" className="hidden" aria-hidden="true" tabIndex={-1} onChange={(e) => { void adicionar(e.target.files); e.target.value = ""; }} />
                <button type="button" onClick={() => seletor.current?.click()} disabled={ocupado} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted disabled:opacity-40" aria-label="Anexar imagem ou arquivo de texto" title="Anexar imagem ou arquivo de texto (ou arraste para cá)">
                  <Paperclip className="h-4 w-4" />
                </button>
                <textarea
                  ref={campo}
                  value={rascunho}
                  onChange={(e) => setRascunho(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); mandar(); } }}
                  onPaste={(e) => { const fs = e.clipboardData?.files; if (fs && fs.length) { e.preventDefault(); void adicionar(fs); } }}
                  rows={1}
                  placeholder={emTurno ? "O Hermes está trabalhando…" : "Mensagem para o Hermes…"}
                  aria-label="Mensagem para o Hermes"
                  className="max-h-40 min-h-[36px] min-w-0 flex-1 resize-none bg-transparent px-1 py-2 text-[14px] leading-5 outline-none placeholder:text-muted-foreground"
                />
                <button type="submit" disabled={ocupado || (!rascunho.trim() && !temAnexo)} aria-label="Enviar ao Hermes" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-opacity disabled:opacity-40">
                  {enviar.isPending || emTurno ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
                </button>
              </div>
            </div>
          </form>
        ) : (
          <div className="shrink-0 border-t border-border/70 bg-card px-3 py-2.5 sm:px-4">
            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button type="button" onClick={() => continuar.mutate(aberta.id)} disabled={continuar.isPending} className={juntar(botao.secundario, "mx-auto flex h-9 w-full max-w-3xl rounded-full text-[13px]")}>
                    {continuar.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <GitBranch className="mr-1.5 h-3.5 w-3.5" />}Continuar esta conversa aqui
                  </button>
                </TooltipTrigger>
                <TooltipContent className="max-w-[260px] text-[12px]">Esta sessão é só de leitura aqui. Cria uma cópia para você continuar; a conversa original fica intacta.</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        )
      )}
    </section>
  );
}
