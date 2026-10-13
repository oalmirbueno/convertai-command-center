import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { CalendarHeart, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { JanelaCentral, Secao, SeletorCompacto, botao, campoTexto, etiqueta, foco, juntar, texto } from "@/components/sistema";
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
  textoDaCaptacao,
  type TipoDeRegistro,
} from "@/lib/diaPrioritario";
import { registrarNoDia, tarefasAbertasDosClientes, textoDoErroDoDia, useDiasPrioritarios, useReleDoDia, type TarefaDoDia } from "@/lib/diaPrioritarioApi";

/**
 * Dia Prioritário na Central de Experiência (12/10/2026). Abre e responde: quem merece atenção
 * estratégica hoje, como fica a semana, o que está pendente de cada um (as tarefas reais do Kanban,
 * sem copiar nada), as captações que vêm aí (e se caem no dia) e o que já foi conversado. Registrar
 * a conversa grava no histórico do cliente (o mesmo do dossiê). Nada é enviado ao cliente daqui.
 */

type ClienteDaCentral = { id: string; nome: string };

type Registro = { id: string; client_id: string; title: string | null; created_at: string; metadata: { dia_prioritario?: { tipo?: TipoDeRegistro; data?: string; combinados?: string | null; proximos_passos?: string | null } } | null };

/** Dia que a Central abre: hoje; no fim de semana, a segunda que vem. */
export function diaQueAbre(agora: Date = new Date()): number {
  const d = diaDaSemanaEmSP(agora);
  return d >= 1 && d <= 5 ? d : 1;
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

  const nomes = useMemo(() => new Map(clientes.map((c) => [c.id, c.nome])), [clientes]);
  const porDia = useMemo(() => {
    const m = new Map<number, Array<{ id: string; nome: string; provisorio: boolean }>>();
    (dias || []).forEach((d) => {
      const n = diaNaOperacao(d);
      if (!n || !nomes.has(d.client_id)) return;
      m.set(n, (m.get(n) || []).concat([{ id: d.client_id, nome: nomes.get(d.client_id) as string, provisorio: d.situacao === "provisorio" }]));
    });
    m.forEach((l) => l.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")));
    return m;
  }, [dias, nomes]);

  const hoje = dataEmSP(momento);
  const tarefasPorCliente = useMemo(() => {
    const m = new Map<string, TarefaDoDia[]>();
    (tarefas || []).forEach((t) => m.set(t.client_id, (m.get(t.client_id) || []).concat([t])));
    return m;
  }, [tarefas]);

  if (isLoading) return null;
  if (!(dias || []).length) return null;

  const doDia = porDia.get(dia) || [];
  const data = proximaData(dia, momento);
  const rotuloDoDia = dia === hojeISO ? `hoje, ${nomeDoDia(dia)}` : dataPorExtenso(data);

  return (
    <Secao
      titulo="Dia Prioritário"
      divisoria
      descricao={`${doDia.length} ${doDia.length === 1 ? "cliente" : "clientes"} ${dia === hojeISO ? "hoje" : `na ${nomeDoDia(dia)}`}`}
      ajuda="O dia fixo de atenção estratégica de cada cliente recorrente: conversa quando fizer sentido, resultados, pendências, próximos passos e captações combinadas. Não substitui os rituais de segunda, quarta e sexta nem o atendimento da semana. As pendências são as tarefas reais do Kanban."
    >
      <div className="min-w-0 space-y-3" data-dia-prioritario-central="">
        <div className="flex flex-wrap" role="tablist" aria-label="Dias da semana">
          {DIAS_UTEIS.map((d) => {
            const lista = porDia.get(d.dia) || [];
            const ativo = d.dia === dia;
            return (
              <button
                key={d.dia}
                type="button"
                role="tab"
                aria-selected={ativo}
                onClick={() => setDia(d.dia)}
                title={lista.map((c) => c.nome).join(", ") || "Nenhum cliente"}
                className={juntar(
                  "mb-1 mr-1 flex h-9 items-center rounded-md border px-2.5 text-[13px] transition-colors",
                  ativo ? "border-primary bg-primary/10 text-foreground" : "border-border text-muted-foreground hover:bg-muted",
                  foco,
                )}
              >
                <span className={d.dia === hojeISO ? "font-semibold text-foreground" : ""}>{d.curto}</span>
                <span className="ml-1.5 tabular-nums text-[12px]">{lista.length}</span>
              </button>
            );
          })}
        </div>

        <p className={texto.auxiliar}>
          {doDia.length ? `Atenção estratégica de ${rotuloDoDia}:` : `Nenhum cliente com Dia Prioritário na ${nomeDoDia(dia)}.`}
        </p>

        <ul className="min-w-0 divide-y divide-border" aria-label={`Clientes de ${nomeDoDia(dia)}`}>
          {doDia.map((c) => {
            const abertas = tarefasPorCliente.get(c.id) || [];
            const atrasadas = abertas.filter((t) => t.due_date && t.due_date < hoje).sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)));
            const semana = abertas.filter((t) => t.due_date && t.due_date >= hoje && t.due_date <= proximaData(5, momento));
            const captacoes = abertas.filter((t) => t.due_date && t.due_date >= hoje && ehCaptacao(t)).sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)));
            const ultimo = (registros || []).find((r) => r.client_id === c.id);
            const reg = ultimo?.metadata?.dia_prioritario;
            const destaque = [...atrasadas, ...semana.filter((t) => atrasadas.indexOf(t) < 0)].slice(0, 3);
            return (
              <li key={c.id} className="min-w-0 py-2.5" data-cliente-do-dia={c.id}>
                <div className="flex min-w-0 flex-wrap items-center">
                  <button type="button" onClick={() => onAbrirPerfil(c.id)} className={juntar("mr-2 min-w-0 truncate text-left text-[14px] font-medium text-foreground hover:underline", foco)}>
                    {c.nome}
                  </button>
                  {c.provisorio && <span className={juntar(etiqueta, "mr-2 bg-warning/15 text-warning")}>Provisório</span>}
                  <span className="ml-auto flex shrink-0 items-center">
                    <button type="button" className={juntar(botao.discreto, "h-8")} onClick={() => navigate(`/kanban?client=${c.id}`)}>
                      Tarefas
                    </button>
                    <button type="button" className={juntar(botao.secundario, "ml-1 h-8")} onClick={() => setRegistrando(c)}>
                      Registrar
                    </button>
                  </span>
                </div>
                <p className="mt-0.5 text-[12px] leading-4 text-muted-foreground">
                  {abertas.length} {abertas.length === 1 ? "tarefa aberta" : "tarefas abertas"}
                  {atrasadas.length ? <span className="text-destructive"> · {atrasadas.length} {atrasadas.length === 1 ? "atrasada" : "atrasadas"}</span> : ""}
                  {semana.length ? ` · ${semana.length} para esta semana` : ""}
                  {captacoes[0]?.due_date ? ` · captação ${captacoes[0].due_date.slice(8, 10)}/${captacoes[0].due_date.slice(5, 7)} (${textoDaCaptacao(captacoes[0].due_date, dia).toLowerCase()})` : ""}
                </p>
                <p className="mt-0.5 text-[12px] leading-4 text-muted-foreground">
                  {reg ? `Último registro: ${ROTULO_DO_REGISTRO[reg.tipo as TipoDeRegistro] || "registro"} em ${String(reg.data || ultimo!.created_at).slice(8, 10)}/${String(reg.data || ultimo!.created_at).slice(5, 7)}${reg.proximos_passos ? ` · próximos passos: ${reg.proximos_passos}` : ""}` : "Sem registro nos últimos 14 dias."}
                </p>
                {destaque.length > 0 && (
                  <ul className="mt-1 space-y-0.5 text-[12px] leading-4">
                    {destaque.map((t) => (
                      <li key={t.id} className="flex min-w-0">
                        <span className={juntar("mr-1.5 shrink-0 tabular-nums", t.due_date && t.due_date < hoje ? "text-destructive" : "text-muted-foreground")}>
                          {t.due_date ? `${t.due_date.slice(8, 10)}/${t.due_date.slice(5, 7)}` : "--"}
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
