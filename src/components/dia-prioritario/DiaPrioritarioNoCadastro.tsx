import { useEffect, useMemo, useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Secao, SeletorCompacto, botao, campoTexto, foco, juntar, texto } from "@/components/sistema";
import { useClients } from "@/hooks/useSupabaseData";
import {
  DIAS_UTEIS,
  ROTULO_DA_SITUACAO,
  cargasDaSemana,
  dataEmSP,

  ehCaptacao,
  ehDiaUtil,
  ehRecorrenteParaODia,
  nomeDoDia,
  sugerirDia,
  type SituacaoDoDia,
  type Sugestao,
} from "@/lib/diaPrioritario";
import {
  definirDia,
  tarefasAbertasDosClientes,
  textoDoErroDoDia,
  useDiaDoCliente,
  useDiasPrioritarios,
  useHistoricoDoDia,
  useReleDoDia,
} from "@/lib/diaPrioritarioApi";

/**
 * Dia Prioritário no cadastro do cliente (12/10/2026). Admin escolhe o dia (segunda a sexta), a
 * situação, os dias em que o cliente não pode e uma observação; "Sugerir dia" calcula pela carga da
 * semana e a pessoa revisa antes de salvar. Um dia definido à mão nunca é trocado por sugestão sem
 * a pessoa confirmar a substituição. Toda mudança fica no histórico. Equipe sem ser admin só lê.
 * Salva sozinho (não depende do "Salvar" do cadastro).
 */

type Cliente = { id: string; plan_status?: string | null; client_type?: string | null; deleted_at?: string | null; services_config?: Record<string, unknown> | null };

const SITUACOES: SituacaoDoDia[] = ["confirmado", "provisorio", "nao_aplicavel"];

export default function DiaPrioritarioNoCadastro({ client, admin }: { client: Cliente; admin: boolean }) {
  const { data: atual, isLoading } = useDiaDoCliente(client.id);
  const { data: historico } = useHistoricoDoDia(client.id);
  const { data: todos } = useDiasPrioritarios(admin);
  const { data: clientes } = useClients();
  const reler = useReleDoDia();

  const [dia, setDia] = useState<number | null>(null);
  const [situacao, setSituacao] = useState<SituacaoDoDia>("confirmado");
  const [indisponiveis, setIndisponiveis] = useState<number[]>([]);
  const [observacao, setObservacao] = useState("");
  const [motivo, setMotivo] = useState("");
  const [origem, setOrigem] = useState<"manual" | "sugerida">("manual");
  const [sugestao, setSugestao] = useState<Sugestao | null>(null);
  const [sugerindo, setSugerindo] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [verHistorico, setVerHistorico] = useState(false);

  useEffect(() => {
    setDia(atual && ehDiaUtil(atual.dia) ? atual.dia : null);
    setSituacao(atual && SITUACOES.indexOf(atual.situacao as SituacaoDoDia) >= 0 ? (atual.situacao as SituacaoDoDia) : "confirmado");
    setIndisponiveis(atual ? atual.dias_indisponiveis || [] : []);
    setObservacao(atual?.observacao || "");
    setOrigem(atual && atual.origem === "sugerida" ? "sugerida" : "manual");
    setMotivo("");
    setSugestao(null);
  }, [atual && atual.atualizado_em, client.id]);

  const recorrente = ehRecorrenteParaODia(client);
  const manualDefinido = !!atual && atual.origem === "manual" && (atual.situacao === "confirmado" || atual.situacao === "provisorio") && ehDiaUtil(atual.dia);
  const mudou =
    (atual?.dia ?? null) !== (situacao === "nao_aplicavel" ? null : dia) ||
    (atual?.situacao ?? null) !== situacao ||
    (atual?.observacao || "") !== observacao.trim() ||
    JSON.stringify((atual?.dias_indisponiveis || []).slice().sort()) !== JSON.stringify(indisponiveis.slice().sort());
  const substitui = origem === "sugerida" && manualDefinido && atual!.dia !== dia;

  const sugerir = async () => {
    setSugerindo(true);
    try {
      const tarefas = await tarefasAbertasDosClientes();
      const porCliente: Record<string, number> = {};
      tarefas.forEach((t) => (porCliente[t.client_id] = (porCliente[t.client_id] || 0) + 1));
      const hoje = dataEmSP();
      const limite = new Date(Date.now() + 42 * 86400000).toISOString().slice(0, 10);
      const captacoes = tarefas.filter((t) => t.due_date && t.due_date >= hoje && t.due_date <= limite && ehCaptacao(t)).map((t) => t.due_date as string);
      const cargas = cargasDaSemana({
        dias: todos || [],
        clientes: ((clientes as Cliente[] | undefined) || []).map((c) => ({ ...c, id: String(c.id) })),
        tarefasAbertasPorCliente: porCliente,
        captacoes,
        ignorar: client.id,
      });
      const s = sugerirDia(cargas, indisponiveis);
      setSugestao(s);
      if (!s) toast.warning("Todos os dias estão marcados como indisponíveis", { description: "Libere ao menos um dia ou escolha à mão." });
    } catch (e) {
      toast.error("Não consegui calcular a sugestão agora", { description: textoDoErroDoDia(e) });
    } finally {
      setSugerindo(false);
    }
  };

  const usarSugestao = () => {
    if (!sugestao) return;
    setDia(sugestao.dia);
    setOrigem("sugerida");
    if (situacao === "nao_aplicavel") setSituacao("confirmado");
  };

  const salvar = async () => {
    if (situacao !== "nao_aplicavel" && !ehDiaUtil(dia)) {
      toast.error("Escolha o dia da semana");
      return;
    }
    setSalvando(true);
    try {
      await definirDia({
        clientId: client.id,
        dia,
        situacao,
        origem,
        observacao: observacao.trim() || null,
        motivo: motivo.trim() || (substitui ? "Sugestão aceita no lugar do dia definido à mão." : null),
        diasIndisponiveis: indisponiveis,
        substituirManual: substitui,
      });
      toast.success(situacao === "nao_aplicavel" ? "Dia Prioritário marcado como não se aplica" : `Dia Prioritário: ${nomeDoDia(dia)}`, {
        description: situacao === "confirmado" ? "O cliente passa a ver no painel dele. Nenhuma mensagem foi enviada." : "Fica só para a equipe até ser confirmado.",
      });
      reler(client.id);
    } catch (e) {
      toast.error("Não salvou", { description: textoDoErroDoDia(e) });
    } finally {
      setSalvando(false);
    }
  };

  const estado = useMemo(() => {
    if (isLoading) return "Lendo";
    if (!atual) return recorrente ? "Ainda sem dia" : "Sem recorrência ativa";
    if (atual.situacao === "nao_aplicavel") return "Não se aplica";
    return `${nomeDoDia(atual.dia)} · ${ROTULO_DA_SITUACAO[atual.situacao as SituacaoDoDia] || atual.situacao}`;
  }, [isLoading, atual, recorrente]);

  const alternarIndisponivel = (d: number) => setIndisponiveis((l) => (l.indexOf(d) >= 0 ? l.filter((x) => x !== d) : l.concat([d])));

  return (
    <Secao
      titulo="Dia Prioritário"
      divisoria
      descricao={estado}
      ajuda="Um dia útil fixo por semana de atenção estratégica ao cliente (conversa, resultados, pendências, próximos passos e captações combinadas). Não muda rituais, postagens nem urgências. O cliente vê só quando está confirmado."
    >
      <div className="min-w-0 space-y-3" data-dia-prioritario-cadastro="">
        {!recorrente && !atual && (
          <p className={texto.auxiliar}>Este cliente não tem recorrência ativa. O Dia Prioritário é para contrato mensal vigente; defina só se for exceção combinada.</p>
        )}
        {atual?.observacao && <p className="text-[12px] leading-4 text-warning">{atual.observacao}</p>}

        <div>
          <p className={juntar(texto.rotulo, "mb-1")}>Dia da semana</p>
          <div className="flex flex-wrap" role="radiogroup" aria-label="Dia da semana">
            {DIAS_UTEIS.map((d) => {
              const escolhido = dia === d.dia && situacao !== "nao_aplicavel";
              const bloqueado = indisponiveis.indexOf(d.dia) >= 0;
              return (
                <button
                  key={d.dia}
                  type="button"
                  role="radio"
                  aria-checked={escolhido}
                  disabled={!admin || situacao === "nao_aplicavel"}
                  onClick={() => {
                    setDia(d.dia);
                    setOrigem("manual");
                  }}
                  title={bloqueado ? "Marcado como indisponível para o cliente" : d.nome}
                  className={juntar(
                    "mb-1 mr-1 h-9 min-w-[52px] rounded-md border px-2 text-[13px] transition-colors disabled:opacity-60",
                    escolhido ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-foreground hover:bg-muted",
                    bloqueado && !escolhido ? "line-through text-muted-foreground" : "",
                    foco,
                  )}
                >
                  {d.curto}
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="min-w-0">
            <p className={juntar(texto.rotulo, "mb-1")}>Situação</p>
            <SeletorCompacto
              rotulo="Situação"
              larguraTotal
              opcoes={SITUACOES.map((s) => ({ valor: s, rotulo: ROTULO_DA_SITUACAO[s], desativada: !admin }))}
              valor={situacao}
              onEscolher={(v) => admin && setSituacao(v as SituacaoDoDia)}
            />
          </div>
          <div className="min-w-0">
            <p className={juntar(texto.rotulo, "mb-1")}>O cliente não pode em</p>
            <div className="flex flex-wrap">
              {DIAS_UTEIS.map((d) => (
                <button
                  key={d.dia}
                  type="button"
                  aria-pressed={indisponiveis.indexOf(d.dia) >= 0}
                  disabled={!admin}
                  onClick={() => alternarIndisponivel(d.dia)}
                  className={juntar(
                    "mb-1 mr-1 h-8 rounded-md border px-2 text-[12px] transition-colors disabled:opacity-60",
                    indisponiveis.indexOf(d.dia) >= 0 ? "border-warning/60 bg-warning/10 text-foreground" : "border-border text-muted-foreground hover:bg-muted",
                    foco,
                  )}
                >
                  {d.curto}
                </button>
              ))}
            </div>
          </div>
        </div>

        {admin && (
          <>
            <label className="block min-w-0">
              <span className={juntar(texto.rotulo, "mb-1 block")}>Observação interna</span>
              <input className={juntar(campoTexto, "w-full")} value={observacao} maxLength={500} onChange={(e) => setObservacao(e.target.value)} placeholder="Ex.: provisório até confirmar a vigência" />
            </label>
            <label className="block min-w-0">
              <span className={juntar(texto.rotulo, "mb-1 block")}>Motivo da mudança (vai para o histórico)</span>
              <input className={juntar(campoTexto, "w-full")} value={motivo} maxLength={500} onChange={(e) => setMotivo(e.target.value)} placeholder="Opcional" />
            </label>

            {sugestao && (
              <div className="rounded-md border border-primary/30 bg-primary/[0.05] px-3 py-2" data-sugestao-do-dia={String(sugestao.dia)}>
                <p className="text-[13px] font-medium text-foreground">Sugestão: {nomeDoDia(sugestao.dia)}</p>
                <ul className="mt-1 space-y-0.5 text-[12px] leading-4 text-muted-foreground">
                  {sugestao.motivos.map((m, i) => <li key={i}>{m}</li>)}
                </ul>
                {manualDefinido && atual!.dia !== sugestao.dia && (
                  <p className="mt-1 text-[12px] leading-4 text-warning">Este cliente já tem {nomeDoDia(atual!.dia)} definido à mão. Usar a sugestão substitui esse dia (fica no histórico).</p>
                )}
                <button type="button" className={juntar(botao.secundario, "mt-2 h-8")} onClick={usarSugestao}>
                  Usar a sugestão
                </button>
              </div>
            )}

            <div className="flex flex-wrap items-center">
              <button type="button" className={juntar(botao.secundario, "mb-1 mr-2 h-9")} onClick={() => void sugerir()} disabled={sugerindo || situacao === "nao_aplicavel"}>
                {sugerindo ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Sparkles className="mr-1.5 h-4 w-4" />}
                Sugerir dia
              </button>
              <button type="button" className={juntar(botao.primario, "mb-1 h-9")} onClick={() => void salvar()} disabled={salvando || !mudou}>
                {salvando && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                Salvar Dia Prioritário
              </button>
            </div>
          </>
        )}

        {(historico || []).length > 0 && (
          <div>
            <button type="button" className={juntar("text-[12px] font-medium text-primary", foco)} onClick={() => setVerHistorico((v) => !v)} aria-expanded={verHistorico}>
              {verHistorico ? "Esconder o histórico" : `Histórico (${historico!.length})`}
            </button>
            {verHistorico && (
              <ul className="mt-1 divide-y divide-border text-[12px] leading-4" data-historico-do-dia="">
                {historico!.map((h) => (
                  <li key={h.id} className="py-1.5 text-muted-foreground">
                    <span className="text-foreground">
                      {h.situacao_depois === "nao_aplicavel" ? "Não se aplica" : nomeDoDia(h.dia_depois)}
                      {h.situacao_depois !== "nao_aplicavel" && ` (${ROTULO_DA_SITUACAO[h.situacao_depois as SituacaoDoDia] || h.situacao_depois})`}
                    </span>
                    {h.dia_antes ? `, antes ${nomeDoDia(h.dia_antes)}` : ""} · {h.origem === "sugerida" ? "sugestão aceita" : "manual"} · {new Date(h.em).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}
                    {h.motivo ? ` · ${h.motivo}` : ""}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </Secao>
  );
}

