import { useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight, CalendarClock, CalendarHeart, CalendarX, Camera, ListTodo, Loader2, MessageSquare, MessageSquareDashed, PenLine, SquareKanban } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { JanelaCentral, Secao, SeletorCompacto, botao, campoTexto, etiqueta, foco, juntar, superficie, texto } from "@/components/sistema";
import FotoDoCliente from "@/components/clients/FotoDoCliente";
import type { FotoDoCliente as Foto } from "@/lib/fotoDoCliente";
import {
  DIAS_UTEIS,
  ROTULO_DO_REGISTRO,
  dataEmSP,
  dataPorExtenso,
  diaDaSemanaEmSP,
  diaNaOperacao,
  ehCaptacao,
  nomeDoDia,
  proximaData,
  coincideComODia,
  type TipoDeRegistro,
} from "@/lib/diaPrioritario";
import { registrarNoDia, tarefasAbertasDosClientes, textoDoErroDoDia, useDiasPrioritarios, useReleDoDia, type TarefaDoDia } from "@/lib/diaPrioritarioApi";

/**
 * Dia Prioritário na Central de Experiência (12/10/2026). Abre e responde: quem merece atenção
 * estratégica hoje, como fica a semana, o que está pendente de cada um (as tarefas reais do Kanban,
 * sem copiar nada), as captações que vêm aí (e se caem no dia) e o que já foi conversado. Registrar
 * a conversa grava no histórico do cliente (o mesmo do dossiê). Nada é enviado ao cliente daqui.
 *
 * 16/10/2026 (dono: "mais visual, menos texto, ocupar o espaço"): a semana virou 5 colunas iguais
 * na largura toda (no celular, 5 botões com a contagem), cada uma com a foto e o nome curto dos
 * clientes; o dia escolhido abre embaixo em cartões (um por cliente) com as contagens em números
 * pequenos com ícone. O que antes era frase mora no title/leitor de tela e no "?".
 */

type ClienteDaCentral = { id: string; nome: string; foto?: Foto | null };

type ClienteDoDia = { id: string; nome: string; foto: Foto | null; provisorio: boolean };

type Registro = { id: string; client_id: string; title: string | null; created_at: string; metadata: { dia_prioritario?: { tipo?: TipoDeRegistro; data?: string; combinados?: string | null; proximos_passos?: string | null } } | null };

/** O que a tela mostra de cada cliente do dia (as mesmas contas de antes, num lugar só). */
type ResumoDoCliente = {
  abertas: TarefaDoDia[];
  atrasadas: TarefaDoDia[];
  semana: TarefaDoDia[];
  captacao: TarefaDoDia | null;
  captacaoNoDia: boolean;
  destaque: TarefaDoDia[];
  registro: { tipo: string; data: string; proximosPassos: string } | null;
};

/** Dia que a Central abre: hoje; no fim de semana, a segunda que vem. */
export function diaQueAbre(agora: Date = new Date()): number {
  const d = diaDaSemanaEmSP(agora);
  return d >= 1 && d <= 5 ? d : 1;
}

/** "2026-10-16" vira "16/10". */
const ddmm = (data: string) => `${data.slice(8, 10)}/${data.slice(5, 7)}`;

/** Nome curto para a coluna estreita: as duas primeiras palavras (sem traço solto). */
function nomeCurto(nome: string): string {
  const partes = nome.trim().split(/\s+/).filter((p) => p && !/^[-–·|]$/.test(p));
  return partes.slice(0, 2).join(" ") || nome;
}

const maiuscula = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

const TOM = {
  neutro: "bg-muted text-muted-foreground",
  bom: "bg-primary/10 text-primary",
  atencao: "bg-warning/15 text-warning",
  perigo: "bg-destructive/10 text-destructive",
} as const;

/** Número pequeno com ícone; a frase inteira fica no title e no leitor de tela. */
function Indicador({ icone, valor, rotulo, tom = "neutro" }: { icone: ReactNode; valor: ReactNode; rotulo: string; tom?: keyof typeof TOM }) {
  return (
    <span className={juntar("inline-flex h-6 shrink-0 items-center rounded-md px-1.5 text-[12px] font-medium tabular-nums", TOM[tom])} title={rotulo}>
      <span className="inline-flex items-center" aria-hidden="true">
        {icone}
        <span className="ml-1">{valor}</span>
      </span>
      <span className="sr-only">{rotulo}</span>
    </span>
  );
}

/** Foto (ou iniciais) com o ponto amarelo do provisório. */
function RostoDoCliente({ cliente, tamanho }: { cliente: ClienteDoDia; tamanho: "sm" | "lg" }) {
  return (
    <span className="relative inline-flex shrink-0">
      <FotoDoCliente nome={cliente.nome} foto={cliente.foto} tamanho={tamanho} />
      {cliente.provisorio && (
        <span
          className={juntar("absolute bottom-0 right-0 rounded-full bg-warning ring-2 ring-background", tamanho === "lg" ? "h-3 w-3" : "h-2.5 w-2.5")}
          title="Dia provisório"
          aria-hidden="true"
        />
      )}
    </span>
  );
}

export default function DiaPrioritarioNaCentral({ clientes, onAbrirPerfil, agora }: { clientes: ClienteDaCentral[]; onAbrirPerfil: (clientId: string) => void; agora?: Date }) {
  const navigate = useNavigate();
  const momento = agora ?? new Date();
  const hojeISO = diaDaSemanaEmSP(momento);
  const [dia, setDia] = useState<number>(() => diaQueAbre(momento));
  const [registrando, setRegistrando] = useState<ClienteDaCentral | null>(null);
  const { data: dias, isLoading } = useDiasPrioritarios();
  const { data: tarefas } = useQuery({ queryKey: ["dia-prioritario", "tarefas"], queryFn: tarefasAbertasDosClientes, staleTime: 2 * 60_000 });
  const desde = new Date(momento.getTime() - 14 * 86400000).toISOString();
  const { data: registros } = useQuery({
    queryKey: ["dia-prioritario", "registros", "todos"],
    staleTime: 60_000,
    queryFn: async (): Promise<Registro[]> => {
      const { data, error } = await supabase
        .from("project_memory")
        .select("id, client_id, title, created_at, metadata")
        .eq("kind", "acao")
        .eq("metadata->>origem", "dia_prioritario")
        .gte("created_at", desde)
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as Registro[];
    },
  });

  const porId = useMemo(() => new Map(clientes.map((c) => [c.id, c])), [clientes]);
  const porDia = useMemo(() => {
    const m = new Map<number, ClienteDoDia[]>();
    (dias || []).forEach((d) => {
      const n = diaNaOperacao(d);
      const c = porId.get(d.client_id);
      if (!n || !c) return;
      m.set(n, (m.get(n) || []).concat([{ id: c.id, nome: c.nome, foto: c.foto || null, provisorio: d.situacao === "provisorio" }]));
    });
    m.forEach((l) => l.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")));
    return m;
  }, [dias, porId]);

  const hoje = dataEmSP(momento);
  const fimDaSemana = proximaData(5, momento);
  const tarefasPorCliente = useMemo(() => {
    const m = new Map<string, TarefaDoDia[]>();
    (tarefas || []).forEach((t) => m.set(t.client_id, (m.get(t.client_id) || []).concat([t])));
    return m;
  }, [tarefas]);

  if (isLoading) return null;
  if (!(dias || []).length) return null;

  /** As contas de cada cliente (iguais às de antes): atrasadas, desta semana, próxima captação, último registro. */
  const resumir = (clientId: string, diaDoCliente: number): ResumoDoCliente => {
    const abertas = tarefasPorCliente.get(clientId) || [];
    const atrasadas = abertas.filter((t) => t.due_date && t.due_date < hoje).sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)));
    const semana = abertas.filter((t) => t.due_date && t.due_date >= hoje && t.due_date <= fimDaSemana);
    const captacoes = abertas.filter((t) => t.due_date && t.due_date >= hoje && ehCaptacao(t)).sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)));
    const ultimo = (registros || []).find((r) => r.client_id === clientId);
    const reg = ultimo?.metadata?.dia_prioritario;
    const captacao = captacoes[0]?.due_date ? captacoes[0] : null;
    return {
      abertas,
      atrasadas,
      semana,
      captacao,
      captacaoNoDia: !!(captacao && coincideComODia(captacao.due_date, diaDoCliente)),
      destaque: [...atrasadas, ...semana.filter((t) => atrasadas.indexOf(t) < 0)].slice(0, 3),
      registro: reg && ultimo
        ? { tipo: ROTULO_DO_REGISTRO[reg.tipo as TipoDeRegistro] || "Registro", data: ddmm(String(reg.data || ultimo.created_at)), proximosPassos: reg.proximos_passos || "" }
        : null,
    };
  };

  const doDia = porDia.get(dia) || [];
  const data = proximaData(dia, momento);
  const rotuloDoDia = dia === hojeISO ? `Hoje, ${nomeDoDia(dia)}` : maiuscula(dataPorExtenso(data));
  const naSemana = DIAS_UTEIS.reduce((s, d) => s + (porDia.get(d.dia) || []).length, 0);
  const hojeNaLista = hojeISO >= 1 && hojeISO <= 5 ? (porDia.get(hojeISO) || []).length : 0;
  // Poucos clientes no dia: menos colunas, para os cartões ocuparem a largura sem ficar no canto.
  const colunasDoZoom =
    doDia.length <= 1 ? "mx-auto w-full max-w-[640px]" : doDia.length === 2 ? "sm:grid-cols-2" : doDia.length === 3 ? "sm:grid-cols-2 lg:grid-cols-3" : "sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4";

  return (
    <Secao
      titulo="Dia Prioritário"
      divisoria
      descricao={`${naSemana} na semana${hojeISO >= 1 && hojeISO <= 5 ? ` · ${hojeNaLista} hoje` : ""}`}
      ajuda="O dia fixo de atenção estratégica de cada cliente recorrente: conversa quando fizer sentido, resultados, pendências, próximos passos e captações combinadas. Não substitui os rituais de segunda, quarta e sexta nem o atendimento da semana. As pendências são as tarefas reais do Kanban. Toque num dia para ver os clientes dele; toque no cliente para abrir o perfil. Ponto amarelo na foto: dia provisório. Número vermelho: tarefas atrasadas. Câmera: próxima captação (verde no Dia Prioritário, amarela fora dele)."
    >
      <div className="min-w-0" data-dia-prioritario-central="">
        {/* A semana: 5 colunas iguais na largura toda. No celular, só o dia e a contagem (os clientes aparecem no zoom). */}
        <div className="grid min-w-0 grid-cols-5 gap-1.5 md:gap-3" role="group" aria-label="Dias da semana">
          {DIAS_UTEIS.map((d) => {
            const lista = porDia.get(d.dia) || [];
            const ativo = d.dia === dia;
            const ehHoje = d.dia === hojeISO;
            const atrasadosNoDia = lista.reduce((s, c) => s + (resumir(c.id, d.dia).atrasadas.length ? 1 : 0), 0);
            return (
              <div
                key={d.dia}
                className={juntar("min-w-0 rounded-lg p-1 transition-colors md:p-2", ehHoje && "bg-primary/[0.07]", ativo ? "ring-1 ring-primary/50" : "")}
                data-dia-da-semana={d.dia}
                data-hoje={ehHoje ? "sim" : undefined}
              >
                <button
                  type="button"
                  aria-pressed={ativo}
                  aria-label={`${maiuscula(d.nome)}${ehHoje ? " (hoje)" : ""}: ${lista.length} ${lista.length === 1 ? "cliente" : "clientes"}`}
                  onClick={() => setDia(d.dia)}
                  title={lista.map((c) => c.nome).join(", ") || "Nenhum cliente"}
                  className={juntar("toque-compacto flex h-9 w-full min-w-0 flex-col items-center justify-center rounded-md px-1 transition-colors hover:bg-muted/60 md:flex-row md:justify-between md:px-1.5", foco)}
                >
                  <span className="flex min-w-0 items-center">
                    <span className={juntar("text-[13px] font-semibold leading-4", ehHoje ? "text-primary" : ativo ? "text-foreground" : "text-muted-foreground")}>{d.curto}</span>
                    {ehHoje && <span className={juntar(etiqueta, "ml-1.5 hidden bg-primary/15 text-primary lg:inline-flex")}>Hoje</span>}
                  </span>
                  <span className="flex items-center leading-4">
                    {atrasadosNoDia > 0 && <span className="mr-1 hidden h-1.5 w-1.5 rounded-full bg-destructive md:inline-block" aria-hidden="true" />}
                    <span className={juntar("text-[12px] tabular-nums", ativo || ehHoje ? "text-foreground" : "text-muted-foreground")}>{lista.length}</span>
                  </span>
                </button>
                <ul className="mt-1 hidden min-w-0 md:block" aria-label={`Clientes de ${d.nome}`}>
                  {lista.map((c) => {
                    const atrasadas = resumir(c.id, d.dia).atrasadas.length;
                    return (
                      <li key={c.id} className="min-w-0">
                        <button
                          type="button"
                          onClick={() => onAbrirPerfil(c.id)}
                          title={`${c.nome}${c.provisorio ? " (provisório)" : ""}`}
                          className={juntar("toque-compacto flex w-full min-w-0 items-center rounded-md px-1.5 py-1 text-left transition-colors hover:bg-muted/60", foco)}
                        >
                          <RostoDoCliente cliente={c} tamanho="sm" />
                          <span className="ml-2 min-w-0 flex-1 truncate text-[13px] text-foreground">{nomeCurto(c.nome)}</span>
                          {atrasadas > 0 && (
                            <span className="ml-1 shrink-0 text-[11px] font-medium tabular-nums text-destructive">
                              {atrasadas}
                              <span className="sr-only"> {atrasadas === 1 ? "atrasada" : "atrasadas"}</span>
                            </span>
                          )}
                        </button>
                      </li>
                    );
                  })}
                  {!lista.length && (
                    <li className="px-1.5 py-1 text-center text-[12px] text-muted-foreground">
                      <span aria-hidden="true">–</span>
                      <span className="sr-only">Nenhum cliente</span>
                    </li>
                  )}
                </ul>
              </div>
            );
          })}
        </div>

        {/* O zoom do dia escolhido: um cartão por cliente, com as contagens em números pequenos. */}
        <div className="mt-5 min-w-0" data-zoom-do-dia={dia}>
          <div className="mb-3 flex min-w-0 items-center">
            <CalendarHeart className="mr-2 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
            <h3 className="min-w-0 truncate text-[13px] font-semibold leading-5 text-foreground">{rotuloDoDia}</h3>
            <span className="ml-2 text-[12px] tabular-nums text-muted-foreground">{doDia.length}</span>
          </div>
          {doDia.length ? (
            <ul className={juntar("grid min-w-0 gap-3", colunasDoZoom)} aria-label={`Clientes de ${nomeDoDia(dia)} em detalhe`}>
              {doDia.map((c) => {
                const r = resumir(c.id, dia);
                return (
                  <li key={c.id} className={juntar(superficie.painel, "min-w-0 p-3")} data-cliente-do-dia={c.id}>
                    <div className="flex min-w-0 items-center">
                      <button
                        type="button"
                        onClick={() => onAbrirPerfil(c.id)}
                        title={`Abrir o perfil de ${c.nome}`}
                        className={juntar("-m-1 flex min-w-0 flex-1 items-center rounded-md p-1 text-left transition-colors hover:bg-muted/60", foco)}
                      >
                        <RostoDoCliente cliente={c} tamanho="lg" />
                        <span className="ml-3 min-w-0 flex-1">
                          <span className="flex min-w-0 items-center">
                            <span className="min-w-0 truncate text-[15px] font-semibold leading-5 text-foreground">{c.nome}</span>
                            {c.provisorio && <span className={juntar(etiqueta, "ml-2 bg-warning/15 text-warning")}>Provisório</span>}
                          </span>
                          <span
                            className="mt-0.5 flex min-w-0 items-center text-[12px] leading-4 text-muted-foreground"
                            title={r.registro ? `Último registro: ${r.registro.tipo} em ${r.registro.data}` : "Sem registro nos últimos 14 dias"}
                          >
                            {r.registro ? <MessageSquare className="mr-1 h-3.5 w-3.5 shrink-0" aria-hidden="true" /> : <MessageSquareDashed className="mr-1 h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
                            <span className="min-w-0 truncate">{r.registro ? `${r.registro.tipo} · ${r.registro.data}` : "Sem registro em 14 dias"}</span>
                          </span>
                        </span>
                      </button>
                      <span className="ml-2 flex shrink-0 items-center">
                        <button type="button" className={botao.icone} aria-label="Tarefas no Kanban" title="Tarefas no Kanban" onClick={() => navigate(`/kanban?client=${c.id}`)}>
                          <SquareKanban className="h-4 w-4" aria-hidden="true" />
                        </button>
                        <button type="button" className={juntar(botao.secundario, "ml-1 h-8 px-2.5")} onClick={() => setRegistrando({ id: c.id, nome: c.nome })}>
                          <PenLine className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                          Registrar
                        </button>
                      </span>
                    </div>

                    <div className="-m-0.5 mt-2.5 flex min-w-0 flex-wrap items-center [&>*]:m-0.5">
                      <Indicador
                        icone={<ListTodo className="h-3.5 w-3.5" />}
                        valor={r.abertas.length}
                        rotulo={`${r.abertas.length} ${r.abertas.length === 1 ? "tarefa aberta" : "tarefas abertas"}`}
                      />
                      {r.atrasadas.length > 0 && (
                        <Indicador
                          tom="perigo"
                          icone={<AlertTriangle className="h-3.5 w-3.5" />}
                          valor={r.atrasadas.length}
                          rotulo={`${r.atrasadas.length} ${r.atrasadas.length === 1 ? "atrasada" : "atrasadas"}`}
                        />
                      )}
                      {r.semana.length > 0 && <Indicador tom="bom" icone={<CalendarClock className="h-3.5 w-3.5" />} valor={r.semana.length} rotulo={`${r.semana.length} para esta semana`} />}
                      {r.captacao && r.captacao.due_date && (
                        <Indicador
                          tom={r.captacaoNoDia ? "bom" : "atencao"}
                          icone={<Camera className="h-3.5 w-3.5" />}
                          valor={ddmm(r.captacao.due_date)}
                          rotulo={`Captação ${ddmm(r.captacao.due_date)}, ${r.captacaoNoDia ? "no Dia Prioritário" : "fora do Dia Prioritário"}`}
                        />
                      )}
                    </div>

                    {r.registro && r.registro.proximosPassos && (
                      <p className="mt-2 flex min-w-0 items-center text-[12px] leading-4 text-muted-foreground" title={`Próximos passos: ${r.registro.proximosPassos}`}>
                        <ArrowRight className="mr-1 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
                        <span className="sr-only">Próximos passos: </span>
                        <span className="min-w-0 truncate text-foreground">{r.registro.proximosPassos}</span>
                      </p>
                    )}

                    {r.destaque.length > 0 && (
                      <ul className="mt-2 space-y-1 border-t border-border/50 pt-2 text-[12px] leading-4" aria-label="Tarefas em destaque">
                        {r.destaque.map((t) => (
                          <li key={t.id} className="flex min-w-0" title={t.title}>
                            <span className={juntar("mr-2 w-10 shrink-0 tabular-nums", t.due_date && t.due_date < hoje ? "font-medium text-destructive" : "text-muted-foreground")}>
                              {t.due_date ? ddmm(t.due_date) : "--"}
                            </span>
                            <span className="min-w-0 truncate text-foreground">{t.title}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className={juntar(texto.auxiliar, "flex items-center")}>
              <CalendarX className="mr-1.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              Nenhum cliente na {nomeDoDia(dia)}
            </p>
          )}
        </div>
      </div>
      {registrando && <RegistrarNoDia cliente={registrando} onFechar={() => setRegistrando(null)} />}
    </Secao>
  );
}

const TIPOS: TipoDeRegistro[] = ["ligacao", "reuniao", "mensagem", "alinhamento", "sem_contato"];

/** Registrar o que aconteceu: conversa, alinhamento ou "sem necessidade de contato". */
export function RegistrarNoDia({ cliente, onFechar }: { cliente: ClienteDaCentral; onFechar: () => void }) {
  const reler = useReleDoDia();
  const [tipo, setTipo] = useState<TipoDeRegistro>("ligacao");
  const [resumo, setResumo] = useState("");
  const [combinados, setCombinados] = useState("");
  const [proximos, setProximos] = useState("");
  const [salvando, setSalvando] = useState(false);
  const salvar = async () => {
    setSalvando(true);
    try {
      await registrarNoDia({ clientId: cliente.id, tipo, resumo: resumo.trim(), combinados: combinados.trim(), proximosPassos: proximos.trim() });
      toast.success("Registrado no histórico do cliente", { description: "O dossiê se atualiza em instantes. Nada foi enviado ao cliente." });
      reler(cliente.id);
      onFechar();
    } catch (e) {
      toast.error("Não registrou", { description: textoDoErroDoDia(e) });
    } finally {
      setSalvando(false);
    }
  };
  return (
    <JanelaCentral
      aberta
      onFechar={onFechar}
      titulo={`Dia Prioritário: ${cliente.nome}`}
      icone={<CalendarHeart className="h-4 w-4" />}
      largura="md"
      rodape={
        <div className="flex justify-end">
          <button type="button" className={juntar(botao.secundario, "mr-2 h-9")} onClick={onFechar}>
            Cancelar
          </button>
          <button type="button" className={juntar(botao.primario, "h-9")} onClick={() => void salvar()} disabled={salvando}>
            {salvando && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Registrar
          </button>
        </div>
      }
    >
      <div className="space-y-3">
        <div>
          <p className={juntar(texto.rotulo, "mb-1")}>O que aconteceu</p>
          <SeletorCompacto rotulo="O que aconteceu" larguraTotal listaQuandoNaoCabe opcoes={TIPOS.map((t) => ({ valor: t, rotulo: ROTULO_DO_REGISTRO[t] }))} valor={tipo} onEscolher={(v) => setTipo(v as TipoDeRegistro)} />
        </div>
        <label className="block">
          <span className={juntar(texto.rotulo, "mb-1 block")}>{tipo === "sem_contato" ? "Por quê (opcional)" : "Resumo"}</span>
          <textarea className={juntar(campoTexto, "min-h-[64px] w-full")} value={resumo} maxLength={2000} onChange={(e) => setResumo(e.target.value)} />
        </label>
        {tipo !== "sem_contato" && (
          <label className="block">
            <span className={juntar(texto.rotulo, "mb-1 block")}>Combinados</span>
            <textarea className={juntar(campoTexto, "min-h-[56px] w-full")} value={combinados} maxLength={2000} onChange={(e) => setCombinados(e.target.value)} />
          </label>
        )}
        <label className="block">
          <span className={juntar(texto.rotulo, "mb-1 block")}>Próximos passos</span>
          <textarea className={juntar(campoTexto, "min-h-[56px] w-full")} value={proximos} maxLength={2000} onChange={(e) => setProximos(e.target.value)} placeholder="Viram tarefas no Kanban pela equipe ou pelo Hermes, com aprovação quando precisa" />
        </label>
      </div>
    </JanelaCentral>
  );
}
