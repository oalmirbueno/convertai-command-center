import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  Briefcase,
  Download,
  Megaphone,
  Plus,
  Target,
  TrendingUp,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  CANAIS,
  ESTAGIOS,
  ESTAGIOS_ABERTOS,
  METRICAS,
  ORIGENS,
  type Campanha,
  type EstagioId,
  type Lead,
  anotarNoLead,
  arquivarCampanha,
  arquivarLead,
  dinheiro,
  historicoDoLead,
  importarLeadsDoQuiz,
  kpisDaCampanha,
  listarCampanhas,
  listarLeads,
  listarMetas,
  moverLead,
  primeiroDiaDoMes,
  realizadoDoMes,
  receitaDoMes,
  resumoDoFunil,
  rotuloDoEstagio,
  salvarCampanha,
  salvarLead,
  salvarMeta,
} from "@/lib/comercial";

/**
 * Departamento Comercial — a parte da Aceleriq que o cliente nunca vê.
 *
 * O painel inteiro conta o que acontece DEPOIS que o contrato existe. Esta
 * tela é o antes: quem está conversando, quanto está em jogo, o que a casa
 * prometeu a si mesma para o mês e quanto custou aparecer.
 *
 * A regra que sustenta o módulo: **alvo é dado daqui, realizado vem do
 * Financeiro**. A receita do mês não é digitada nesta tela — é lida dos
 * lançamentos. Assim não existe a situação em que o comercial comemora um
 * número que o financeiro não reconhece.
 */

type Aba = "funil" | "metas" | "marketing";

const hojeIso = () => new Date().toISOString().slice(0, 10);

const mesLegivel = (periodo: string) => {
  const [ano, mes] = periodo.split("-").map(Number);
  return new Date(ano, mes - 1, 1).toLocaleDateString("pt-BR", {
    month: "long",
    year: "numeric",
  });
};

const somarMeses = (periodo: string, passo: number) => {
  const [ano, mes] = periodo.split("-").map(Number);
  const data = new Date(ano, mes - 1 + passo, 1);
  return primeiroDiaDoMes(data);
};

export default function AdminComercial() {
  const queryClient = useQueryClient();
  const [aba, setAba] = useState<Aba>("funil");
  const [periodo, setPeriodo] = useState(() => primeiroDiaDoMes(new Date()));
  const [leadAberto, setLeadAberto] = useState<Lead | null>(null);
  const [novoLead, setNovoLead] = useState(false);
  const [campanhaAberta, setCampanhaAberta] = useState<Campanha | "nova" | null>(null);

  const { data: leads = [], isLoading: carregandoLeads } = useQuery({
    queryKey: ["comercial-leads"],
    queryFn: listarLeads,
  });
  const { data: campanhas = [] } = useQuery({
    queryKey: ["comercial-campanhas"],
    queryFn: listarCampanhas,
  });
  const { data: metas = [] } = useQuery({
    queryKey: ["comercial-metas", periodo],
    queryFn: () => listarMetas(periodo),
  });
  // A receita realizada vem do Financeiro central, nunca daqui.
  const { data: receita = 0 } = useQuery({
    queryKey: ["comercial-receita", periodo],
    queryFn: () => receitaDoMes(periodo),
  });

  const recarregar = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["comercial-leads"] }),
      queryClient.invalidateQueries({ queryKey: ["comercial-campanhas"] }),
      queryClient.invalidateQueries({ queryKey: ["comercial-metas"] }),
    ]);

  const resumo = useMemo(
    () => resumoDoFunil(leads, periodo, hojeIso()),
    [leads, periodo],
  );

  const importar = useMutation({
    mutationFn: importarLeadsDoQuiz,
    onSuccess: async (quantos) => {
      await recarregar();
      toast.success(
        quantos === 0
          ? "Nenhum diagnóstico novo para trazer."
          : `${quantos} ${quantos === 1 ? "lead trazido" : "leads trazidos"} do diagnóstico.`,
      );
    },
    onError: () => toast.error("Não foi possível trazer os leads."),
  });

  return (
    <div className="space-y-4 pb-8">
      {/* ─────────────────────────── Cabeçalho ─────────────────────────── */}
      <header className="rounded-2xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="flex items-center gap-2 text-lg font-bold text-foreground">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Briefcase className="h-4 w-4" />
              </span>
              Comercial
            </h1>
            <p className="mt-1 text-[11.5px] leading-relaxed text-muted-foreground">
              Funil, metas e o marketing da própria Aceleriq. Interno — o cliente não
              vê nada desta tela.
            </p>
          </div>
          {/* O mês manda em metas e receita; o funil aberto é sempre o de hoje. */}
          <div className="flex items-center gap-1 rounded-xl border border-border bg-background p-1">
            <button
              type="button"
              onClick={() => setPeriodo(somarMeses(periodo, -1))}
              className="h-8 w-8 rounded-lg text-muted-foreground hover:bg-secondary"
              aria-label="Mês anterior"
            >
              ‹
            </button>
            <span className="min-w-[110px] text-center text-[11.5px] font-semibold capitalize text-foreground">
              {mesLegivel(periodo)}
            </span>
            <button
              type="button"
              onClick={() => setPeriodo(somarMeses(periodo, 1))}
              className="h-8 w-8 rounded-lg text-muted-foreground hover:bg-secondary"
              aria-label="Próximo mês"
            >
              ›
            </button>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Tile titulo="Em aberto" valor={String(resumo.abertos)} apoio="leads no funil" />
          <Tile
            titulo="Em jogo"
            valor={dinheiro(resumo.valorEmJogo)}
            apoio="mensalidade × 12 + entrada"
          />
          <Tile
            titulo="Ganhos no mês"
            valor={String(resumo.ganhosNoMes)}
            apoio={
              resumo.taxaDeGanho == null
                ? "nada fechado ainda"
                : `${Math.round(resumo.taxaDeGanho * 100)}% de aproveitamento`
            }
          />
          <Tile
            titulo="Receita do mês"
            valor={dinheiro(receita)}
            apoio="lida do Financeiro"
          />
        </div>

        {/* Funil não morre de proposta recusada — morre de lead esquecido. */}
        {(resumo.atrasados > 0 || resumo.semProximoPasso > 0) && (
          <p className="mt-2 rounded-xl border border-warning/25 bg-warning/[0.06] px-3 py-2 text-[11px] leading-relaxed text-warning">
            {resumo.atrasados > 0 && (
              <>
                {resumo.atrasados}{" "}
                {resumo.atrasados === 1 ? "lead com passo atrasado" : "leads com passo atrasado"}
              </>
            )}
            {resumo.atrasados > 0 && resumo.semProximoPasso > 0 && " · "}
            {resumo.semProximoPasso > 0 && (
              <>
                {resumo.semProximoPasso}{" "}
                {resumo.semProximoPasso === 1 ? "sem próximo passo" : "sem próximo passo"}
              </>
            )}
          </p>
        )}

        <div className="mt-3 flex gap-1.5 overflow-x-auto">
          {(
            [
              { id: "funil", label: "Funil", icone: TrendingUp },
              { id: "metas", label: "Metas", icone: Target },
              { id: "marketing", label: "Marketing", icone: Megaphone },
            ] as const
          ).map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setAba(item.id)}
              className={`flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-[12px] font-semibold transition-colors ${
                aba === item.id
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              <item.icone className="h-3.5 w-3.5" />
              {item.label}
            </button>
          ))}
        </div>
      </header>

      {aba === "funil" && (
        <Funil
          leads={leads}
          carregando={carregandoLeads}
          onAbrir={setLeadAberto}
          onNovo={() => setNovoLead(true)}
          onImportar={() => importar.mutate()}
          importando={importar.isPending}
        />
      )}

      {aba === "metas" && (
        <Metas
          periodo={periodo}
          metas={metas}
          leads={leads}
          receita={receita}
          onSalvo={recarregar}
        />
      )}

      {aba === "marketing" && (
        <Marketing
          campanhas={campanhas}
          leads={leads}
          onEditar={setCampanhaAberta}
          onArquivar={async (id) => {
            if (await arquivarCampanha(id)) {
              await recarregar();
              toast.success("Campanha arquivada.");
            } else toast.error("Não foi possível arquivar.");
          }}
        />
      )}

      {(leadAberto || novoLead) && (
        <EditorDeLead
          lead={leadAberto}
          campanhas={campanhas}
          onFechar={() => {
            setLeadAberto(null);
            setNovoLead(false);
          }}
          onSalvo={recarregar}
        />
      )}

      {campanhaAberta && (
        <EditorDeCampanha
          campanha={campanhaAberta === "nova" ? null : campanhaAberta}
          onFechar={() => setCampanhaAberta(null)}
          onSalvo={recarregar}
        />
      )}

      {aba === "marketing" && (
        <button
          type="button"
          onClick={() => setCampanhaAberta("nova")}
          className="flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border text-[12.5px] font-semibold text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
        >
          <Plus className="h-4 w-4" />
          Nova campanha
        </button>
      )}
    </div>
  );
}

function Tile({ titulo, valor, apoio }: { titulo: string; valor: string; apoio: string }) {
  return (
    <div className="rounded-xl border border-border bg-background p-2.5">
      <p className="text-[9.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        {titulo}
      </p>
      <p className="mt-0.5 truncate text-[15px] font-bold tabular-nums text-foreground">
        {valor}
      </p>
      <p className="truncate text-[10px] text-muted-foreground">{apoio}</p>
    </div>
  );
}

/* ──────────────────────────────── Funil ─────────────────────────────────── */

function Funil({
  leads,
  carregando,
  onAbrir,
  onNovo,
  onImportar,
  importando,
}: {
  leads: Lead[];
  carregando: boolean;
  onAbrir: (lead: Lead) => void;
  onNovo: () => void;
  onImportar: () => void;
  importando: boolean;
}) {
  const hoje = hojeIso();
  const porEstagio = useMemo(() => {
    const mapa = new Map<string, Lead[]>();
    for (const estagio of ESTAGIOS_ABERTOS) mapa.set(estagio, []);
    for (const lead of leads) {
      if (!mapa.has(lead.stage)) continue;
      mapa.get(lead.stage)!.push(lead);
    }
    return mapa;
  }, [leads]);

  return (
    <>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onNovo}
          className="flex h-10 flex-1 items-center justify-center gap-1.5 rounded-xl bg-primary text-[12.5px] font-semibold text-primary-foreground"
        >
          <Plus className="h-4 w-4" />
          Novo lead
        </button>
        {/* O diagnóstico já trazia gente qualificada e o painel só sabia
            listá-la. Recadastrar na mão é onde o dado se perde. */}
        <button
          type="button"
          onClick={onImportar}
          disabled={importando}
          className="flex h-10 items-center justify-center gap-1.5 rounded-xl border border-border bg-card px-3.5 text-[12px] font-semibold text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
        >
          <Download className="h-3.5 w-3.5" />
          Trazer do diagnóstico
        </button>
      </div>

      {carregando ? (
        <p className="py-10 text-center text-sm text-muted-foreground">Carregando o funil…</p>
      ) : leads.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-8 text-center">
          <p className="text-sm font-medium text-foreground">O funil está vazio</p>
          <p className="mx-auto mt-1 max-w-md text-[11.5px] leading-relaxed text-muted-foreground">
            Cadastre quem já está em conversa, ou traga de uma vez quem preencheu o
            diagnóstico. Cada lead guarda o valor proposto separado em mensalidade e
            entrada — é o que faz a meta de mensalidade nova bater no fim do mês.
          </p>
        </div>
      ) : (
        // Colunas com rolagem lateral: é o desenho que o comercial conhece, e
        // no celular vira um deslizar em vez de uma lista de cem itens.
        <div className="-mx-1 flex gap-2.5 overflow-x-auto px-1 pb-2">
          {ESTAGIOS_ABERTOS.map((estagio) => {
            const doEstagio = porEstagio.get(estagio) || [];
            const emJogo = doEstagio.reduce(
              (soma, lead) => soma + lead.monthly_value * 12 + lead.one_off_value,
              0,
            );
            return (
              <div
                key={estagio}
                className="w-[240px] shrink-0 rounded-2xl border border-border bg-card/60 p-2.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-[11px] font-bold uppercase tracking-wide text-foreground">
                    {rotuloDoEstagio(estagio)}
                  </p>
                  <span className="shrink-0 rounded-full bg-secondary px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-muted-foreground">
                    {doEstagio.length}
                  </span>
                </div>
                <p className="mt-0.5 text-[10px] tabular-nums text-muted-foreground">
                  {emJogo > 0 ? `${dinheiro(emJogo)} em jogo` : "—"}
                </p>
                <div className="mt-2 space-y-1.5">
                  {doEstagio.map((lead) => {
                    const atrasado =
                      lead.next_action_at != null && lead.next_action_at < hoje;
                    return (
                      <button
                        key={lead.id}
                        type="button"
                        onClick={() => onAbrir(lead)}
                        className={`w-full rounded-xl border p-2.5 text-left transition-colors hover:border-primary/40 ${
                          atrasado ? "border-warning/40 bg-warning/[0.05]" : "border-border bg-background"
                        }`}
                      >
                        <p className="truncate text-[12.5px] font-semibold text-foreground">
                          {lead.name}
                        </p>
                        {lead.company && (
                          <p className="truncate text-[10.5px] text-muted-foreground">
                            {lead.company}
                          </p>
                        )}
                        <p className="mt-1 text-[10.5px] font-semibold tabular-nums text-primary">
                          {lead.monthly_value > 0 && `${dinheiro(lead.monthly_value)}/mês`}
                          {lead.monthly_value > 0 && lead.one_off_value > 0 && " + "}
                          {lead.one_off_value > 0 && `${dinheiro(lead.one_off_value)} entrada`}
                          {lead.monthly_value === 0 && lead.one_off_value === 0 && "sem valor definido"}
                        </p>
                        {lead.next_action && (
                          <p
                            className={`mt-1 truncate text-[10px] ${
                              atrasado ? "font-semibold text-warning" : "text-muted-foreground"
                            }`}
                          >
                            {atrasado ? "Atrasado: " : "Próximo: "}
                            {lead.next_action}
                          </p>
                        )}
                      </button>
                    );
                  })}
                  {doEstagio.length === 0 && (
                    <p className="rounded-xl border border-dashed border-border px-2 py-4 text-center text-[10px] text-muted-foreground">
                      vazio
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

/* ──────────────────────────────── Metas ─────────────────────────────────── */

function Metas({
  periodo,
  metas,
  leads,
  receita,
  onSalvo,
}: {
  periodo: string;
  metas: Array<{ id: string; metric: string; target: number }>;
  leads: Lead[];
  receita: number;
  onSalvo: () => Promise<unknown>;
}) {
  const [editando, setEditando] = useState<string | null>(null);
  const [valor, setValor] = useState("");

  const salvar = async (metrica: string) => {
    const alvo = parseFloat(valor.replace(",", "."));
    if (!(alvo > 0)) {
      toast.error("Informe um alvo maior que zero.");
      return;
    }
    if (await salvarMeta({ periodo, metrica, alvo })) {
      await onSalvo();
      setEditando(null);
      toast.success("Meta salva.");
    } else toast.error("Não foi possível salvar a meta.");
  };

  return (
    <div className="space-y-2.5">
      {METRICAS.map((metrica) => {
        const meta = metas.find((m) => m.metric === metrica.id);
        const feito = realizadoDoMes({
          metrica: metrica.id,
          leads,
          periodo,
          receitaFinanceiro: receita,
        });
        const alvo = meta?.target || 0;
        const pct = alvo > 0 ? Math.min(feito / alvo, 1) : 0;
        const mostrar = (v: number) =>
          metrica.dinheiro ? dinheiro(v) : String(Math.round(v));
        return (
          <div key={metrica.id} className="rounded-2xl border border-border bg-card p-3.5">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[13px] font-semibold text-foreground">{metrica.label}</p>
                {/* De onde vem o número: sem isto, "por que está assim?" não
                    tem resposta na própria tela. */}
                <p className="mt-0.5 text-[10px] text-muted-foreground">{metrica.fonte}</p>
              </div>
              <p className="shrink-0 text-right">
                <span className="text-[15px] font-bold tabular-nums text-foreground">
                  {mostrar(feito)}
                </span>
                <span className="text-[11px] text-muted-foreground">
                  {alvo > 0 ? ` de ${mostrar(alvo)}` : " · sem meta"}
                </span>
              </p>
            </div>

            {alvo > 0 && (
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-secondary">
                <div
                  className={`h-full rounded-full transition-all ${
                    feito >= alvo ? "bg-success" : "bg-primary"
                  }`}
                  style={{ width: `${Math.round(pct * 100)}%` }}
                />
              </div>
            )}

            {editando === metrica.id ? (
              <div className="mt-2.5 flex gap-2">
                <Input
                  type="number"
                  min="0"
                  step={metrica.dinheiro ? "100" : "1"}
                  value={valor}
                  onChange={(e) => setValor(e.target.value)}
                  placeholder={metrica.dinheiro ? "Alvo em R$" : "Alvo"}
                  className="h-10"
                  autoFocus
                />
                <button
                  type="button"
                  onClick={() => void salvar(metrica.id)}
                  className="h-10 shrink-0 rounded-xl bg-primary px-4 text-[12px] font-semibold text-primary-foreground"
                >
                  Salvar
                </button>
                <button
                  type="button"
                  onClick={() => setEditando(null)}
                  className="h-10 w-10 shrink-0 rounded-xl border border-border text-muted-foreground"
                  aria-label="Cancelar"
                >
                  <X className="mx-auto h-4 w-4" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setEditando(metrica.id);
                  setValor(alvo > 0 ? String(alvo) : "");
                }}
                className="mt-2 text-[11px] font-semibold text-primary hover:underline"
              >
                {alvo > 0 ? "Alterar meta" : "Definir meta do mês"}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ────────────────────────────── Marketing ───────────────────────────────── */

function Marketing({
  campanhas,
  leads,
  onEditar,
  onArquivar,
}: {
  campanhas: Campanha[];
  leads: Lead[];
  onEditar: (c: Campanha) => void;
  onArquivar: (id: string) => void;
}) {
  if (campanhas.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border p-8 text-center">
        <p className="text-sm font-medium text-foreground">Nenhuma campanha registrada</p>
        <p className="mx-auto mt-1 max-w-md text-[11.5px] leading-relaxed text-muted-foreground">
          Aqui entra o marketing da própria Aceleriq: o que foi investido para
          aparecer, e quantos leads e contratos aquilo virou. O lead aponta para a
          campanha, então o custo por cliente sai sozinho.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2.5">
      {campanhas.map((campanha) => {
        const kpi = kpisDaCampanha(campanha, leads);
        return (
          <div key={campanha.id} className="rounded-2xl border border-border bg-card p-3.5">
            <div className="flex items-start justify-between gap-2">
              <button
                type="button"
                onClick={() => onEditar(campanha)}
                className="min-w-0 flex-1 text-left"
              >
                <p className="truncate text-[13px] font-semibold text-foreground">
                  {campanha.name}
                </p>
                <p className="mt-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                  {campanha.channel} · {campanha.status}
                </p>
              </button>
              <button
                type="button"
                onClick={() => onArquivar(campanha.id)}
                className="shrink-0 rounded-lg border border-border px-2 py-1 text-[10px] text-muted-foreground hover:text-foreground"
              >
                arquivar
              </button>
            </div>

            <div className="mt-2.5 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Kpi rotulo="Investido" valor={dinheiro(kpi.investido)} />
              <Kpi rotulo="Leads" valor={String(kpi.leads)} />
              <Kpi
                rotulo="Custo por lead"
                valor={kpi.custoPorLead == null ? "—" : dinheiro(kpi.custoPorLead)}
              />
              <Kpi
                rotulo="Custo por cliente"
                valor={kpi.custoPorCliente == null ? "—" : dinheiro(kpi.custoPorCliente)}
              />
            </div>

            {kpi.ganhos > 0 && (
              <p className="mt-2 rounded-xl border border-success/25 bg-success/[0.06] px-3 py-2 text-[11px] leading-relaxed text-success">
                {kpi.ganhos} {kpi.ganhos === 1 ? "contrato fechado" : "contratos fechados"} ·{" "}
                {dinheiro(kpi.mrrGanho)}/mês
                {kpi.entradaGanha > 0 && ` + ${dinheiro(kpi.entradaGanha)} de entrada`}
                {/* Contrato que dura se paga em doze meses; medir só o
                    primeiro faria toda campanha parecer prejuízo. */}
                {kpi.retornoAnual != null &&
                  ` · devolve ${kpi.retornoAnual.toFixed(1)}× no primeiro ano`}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Kpi({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="rounded-xl border border-border bg-background p-2">
      <p className="text-[9px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
        {rotulo}
      </p>
      <p className="mt-0.5 truncate text-[13px] font-bold tabular-nums text-foreground">
        {valor}
      </p>
    </div>
  );
}

/* ───────────────────────────── Editor de lead ───────────────────────────── */

function EditorDeLead({
  lead,
  campanhas,
  onFechar,
  onSalvo,
}: {
  lead: Lead | null;
  campanhas: Campanha[];
  onFechar: () => void;
  onSalvo: () => Promise<unknown>;
}) {
  const [form, setForm] = useState({
    name: lead?.name || "",
    company: lead?.company || "",
    email: lead?.email || "",
    whatsapp: lead?.whatsapp || "",
    origin: lead?.origin || "manual",
    campaign_id: lead?.campaign_id || "",
    monthly_value: String(lead?.monthly_value || ""),
    one_off_value: String(lead?.one_off_value || ""),
    next_action: lead?.next_action || "",
    next_action_at: lead?.next_action_at || "",
    notes: lead?.notes || "",
  });
  const [salvando, setSalvando] = useState(false);
  const [nota, setNota] = useState("");
  const [motivo, setMotivo] = useState("");

  const { data: historico = [] } = useQuery({
    queryKey: ["comercial-historico", lead?.id],
    queryFn: () => historicoDoLead(lead!.id),
    enabled: Boolean(lead?.id),
  });

  const salvar = async () => {
    if (form.name.trim().length < 2) {
      toast.error("O lead precisa de um nome.");
      return;
    }
    setSalvando(true);
    const id = await salvarLead({
      id: lead?.id,
      name: form.name,
      company: form.company,
      email: form.email,
      whatsapp: form.whatsapp,
      origin: form.origin,
      campaign_id: form.campaign_id || null,
      stage: lead?.stage || "novo",
      monthly_value: Number(form.monthly_value) || 0,
      one_off_value: Number(form.one_off_value) || 0,
      next_action: form.next_action,
      next_action_at: form.next_action_at || null,
      notes: form.notes,
    } as never);
    setSalvando(false);
    if (!id) {
      toast.error("Não foi possível salvar o lead.");
      return;
    }
    await onSalvo();
    toast.success(lead ? "Lead atualizado." : "Lead criado.");
    onFechar();
  };

  const mover = async (para: EstagioId) => {
    if (!lead) return;
    if (para === "perdido" && motivo.trim().length < 3) {
      toast.error("Diga em uma linha por que foi perdido — é o que ensina o próximo.");
      return;
    }
    if (await moverLead({ lead, paraEstagio: para, motivo })) {
      await onSalvo();
      toast.success(`Movido para ${rotuloDoEstagio(para)}.`);
      onFechar();
    } else toast.error("Não foi possível mover.");
  };

  return (
    <Dialog open onOpenChange={(aberto) => !aberto && onFechar()}>
      <DialogContent className="max-h-[92dvh] w-[calc(100vw-1.5rem)] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{lead ? lead.name : "Novo lead"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Campo rotulo="Nome" obrigatorio>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="h-10"
              />
            </Campo>
            <Campo rotulo="Empresa">
              <Input
                value={form.company}
                onChange={(e) => setForm({ ...form, company: e.target.value })}
                className="h-10"
              />
            </Campo>
            <Campo rotulo="E-mail">
              <Input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                className="h-10"
              />
            </Campo>
            <Campo rotulo="WhatsApp">
              <Input
                value={form.whatsapp}
                onChange={(e) => setForm({ ...form, whatsapp: e.target.value })}
                className="h-10"
              />
            </Campo>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {/* Separados porque é assim que a casa vende: somar os dois faria
                a meta de mensalidade nova mentir sempre que houvesse projeto. */}
            <Campo rotulo="Mensalidade (R$)">
              <Input
                type="number"
                min="0"
                step="50"
                value={form.monthly_value}
                onChange={(e) => setForm({ ...form, monthly_value: e.target.value })}
                className="h-10"
              />
            </Campo>
            <Campo rotulo="Entrada / projeto (R$)">
              <Input
                type="number"
                min="0"
                step="50"
                value={form.one_off_value}
                onChange={(e) => setForm({ ...form, one_off_value: e.target.value })}
                className="h-10"
              />
            </Campo>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Campo rotulo="Origem">
              <Select
                value={form.origin}
                onValueChange={(v) => setForm({ ...form, origin: v })}
              >
                <SelectTrigger className="h-10">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ORIGENS.map((o) => (
                    <SelectItem key={o} value={o}>
                      {o}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Campo>
            <Campo rotulo="Campanha">
              <Select
                value={form.campaign_id || "nenhuma"}
                onValueChange={(v) =>
                  setForm({ ...form, campaign_id: v === "nenhuma" ? "" : v })
                }
              >
                <SelectTrigger className="h-10">
                  <SelectValue placeholder="Nenhuma" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="nenhuma">Nenhuma</SelectItem>
                  {campanhas.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Campo>
          </div>

          <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
            <Campo rotulo="Próximo passo">
              <Input
                value={form.next_action}
                onChange={(e) => setForm({ ...form, next_action: e.target.value })}
                placeholder="Ligar, enviar proposta, cobrar retorno…"
                className="h-10"
              />
            </Campo>
            <Campo rotulo="Quando">
              <Input
                type="date"
                value={form.next_action_at}
                onChange={(e) => setForm({ ...form, next_action_at: e.target.value })}
                className="h-10"
              />
            </Campo>
          </div>

          <Campo rotulo="Notas">
            <Textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              rows={2}
            />
          </Campo>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void salvar()}
              disabled={salvando}
              className="h-11 flex-1 rounded-xl bg-primary text-[12.5px] font-semibold text-primary-foreground disabled:opacity-50"
            >
              {lead ? "Salvar alterações" : "Criar lead"}
            </button>
            {lead && (
              <button
                type="button"
                onClick={async () => {
                  if (await arquivarLead(lead.id)) {
                    await onSalvo();
                    toast.success("Lead arquivado.");
                    onFechar();
                  } else toast.error("Não foi possível arquivar.");
                }}
                className="h-11 shrink-0 rounded-xl border border-border px-3 text-[11.5px] text-muted-foreground hover:text-foreground"
              >
                Arquivar
              </button>
            )}
          </div>

          {lead && (
            <>
              <div className="border-t border-border pt-3">
                <p className="text-[9.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  Mover para
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {ESTAGIOS.filter((e) => e.id !== lead.stage).map((estagio) => (
                    <button
                      key={estagio.id}
                      type="button"
                      onClick={() => void mover(estagio.id as EstagioId)}
                      title={estagio.ajuda}
                      className={`flex h-9 items-center gap-1 rounded-full border px-3 text-[11.5px] font-semibold transition-colors ${
                        estagio.id === "ganho"
                          ? "border-success/40 bg-success/10 text-success hover:bg-success/20"
                          : estagio.id === "perdido"
                            ? "border-destructive/30 bg-destructive/5 text-destructive hover:bg-destructive/10"
                            : "border-border bg-card text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      <ArrowRight className="h-3 w-3" />
                      {estagio.label}
                    </button>
                  ))}
                </div>
                {/* Motivo da perda é o único campo que ensina o próximo lead. */}
                <Input
                  value={motivo}
                  onChange={(e) => setMotivo(e.target.value)}
                  placeholder="Motivo (obrigatório para marcar como perdido)"
                  className="mt-2 h-10"
                />
              </div>

              <div className="border-t border-border pt-3">
                <p className="text-[9.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  História
                </p>
                <div className="mt-2 flex gap-2">
                  <Input
                    value={nota}
                    onChange={(e) => setNota(e.target.value)}
                    placeholder="Registrar uma conversa…"
                    className="h-10"
                  />
                  <button
                    type="button"
                    onClick={async () => {
                      if (await anotarNoLead(lead.id, nota)) {
                        setNota("");
                        toast.success("Anotado.");
                      } else toast.error("Escreva um pouco mais.");
                    }}
                    className="h-10 shrink-0 rounded-xl border border-border px-3 text-[11.5px] font-semibold text-muted-foreground hover:text-foreground"
                  >
                    Anotar
                  </button>
                </div>
                <div className="mt-2 space-y-1.5">
                  {historico.map((evento) => (
                    <p
                      key={evento.id}
                      className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-[11px] leading-relaxed text-muted-foreground"
                    >
                      <span className="font-semibold text-foreground">
                        {evento.kind === "stage"
                          ? `${rotuloDoEstagio(evento.from_stage || "")} → ${rotuloDoEstagio(evento.to_stage || "")}`
                          : "Nota"}
                      </span>
                      {evento.note ? ` · ${evento.note}` : ""}
                      <span className="ml-1 opacity-60">
                        {new Date(evento.created_at).toLocaleDateString("pt-BR")}
                      </span>
                    </p>
                  ))}
                  {historico.length === 0 && (
                    <p className="text-[10.5px] text-muted-foreground">
                      Nada registrado ainda.
                    </p>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function EditorDeCampanha({
  campanha,
  onFechar,
  onSalvo,
}: {
  campanha: Campanha | null;
  onFechar: () => void;
  onSalvo: () => Promise<unknown>;
}) {
  const [form, setForm] = useState({
    name: campanha?.name || "",
    channel: campanha?.channel || "meta",
    status: campanha?.status || "ativa",
    starts_on: campanha?.starts_on || "",
    ends_on: campanha?.ends_on || "",
    budget: String(campanha?.budget || ""),
    spent: String(campanha?.spent || ""),
    goal: campanha?.goal || "",
  });
  const [salvando, setSalvando] = useState(false);

  const salvar = async () => {
    if (form.name.trim().length < 2) {
      toast.error("A campanha precisa de um nome.");
      return;
    }
    setSalvando(true);
    const ok = await salvarCampanha({
      id: campanha?.id,
      name: form.name,
      channel: form.channel,
      status: form.status,
      starts_on: form.starts_on || null,
      ends_on: form.ends_on || null,
      budget: Number(form.budget) || 0,
      spent: Number(form.spent) || 0,
      goal: form.goal,
    } as never);
    setSalvando(false);
    if (!ok) {
      toast.error("Não foi possível salvar.");
      return;
    }
    await onSalvo();
    toast.success("Campanha salva.");
    onFechar();
  };

  return (
    <Dialog open onOpenChange={(aberto) => !aberto && onFechar()}>
      <DialogContent className="max-h-[92dvh] w-[calc(100vw-1.5rem)] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{campanha ? campanha.name : "Nova campanha"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Campo rotulo="Nome" obrigatorio>
            <Input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="h-10"
            />
          </Campo>
          <div className="grid gap-3 sm:grid-cols-2">
            <Campo rotulo="Canal">
              <Select
                value={form.channel}
                onValueChange={(v) => setForm({ ...form, channel: v })}
              >
                <SelectTrigger className="h-10">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CANAIS.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Campo>
            <Campo rotulo="Situação">
              <Select
                value={form.status}
                onValueChange={(v) => setForm({ ...form, status: v })}
              >
                <SelectTrigger className="h-10">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="planejada">planejada</SelectItem>
                  <SelectItem value="ativa">ativa</SelectItem>
                  <SelectItem value="encerrada">encerrada</SelectItem>
                </SelectContent>
              </Select>
            </Campo>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Campo rotulo="Orçamento (R$)">
              <Input
                type="number"
                min="0"
                value={form.budget}
                onChange={(e) => setForm({ ...form, budget: e.target.value })}
                className="h-10"
              />
            </Campo>
            <Campo rotulo="Investido (R$)">
              <Input
                type="number"
                min="0"
                value={form.spent}
                onChange={(e) => setForm({ ...form, spent: e.target.value })}
                className="h-10"
              />
            </Campo>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Campo rotulo="Início">
              <Input
                type="date"
                value={form.starts_on}
                onChange={(e) => setForm({ ...form, starts_on: e.target.value })}
                className="h-10"
              />
            </Campo>
            <Campo rotulo="Fim">
              <Input
                type="date"
                value={form.ends_on}
                onChange={(e) => setForm({ ...form, ends_on: e.target.value })}
                className="h-10"
              />
            </Campo>
          </div>
          <Campo rotulo="Objetivo">
            <Input
              value={form.goal}
              onChange={(e) => setForm({ ...form, goal: e.target.value })}
              placeholder="O que esta campanha precisa entregar"
              className="h-10"
            />
          </Campo>
          <button
            type="button"
            onClick={() => void salvar()}
            disabled={salvando}
            className="h-11 w-full rounded-xl bg-primary text-[12.5px] font-semibold text-primary-foreground disabled:opacity-50"
          >
            Salvar campanha
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Campo({
  rotulo,
  obrigatorio,
  children,
}: {
  rotulo: string;
  obrigatorio?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-[11px] text-muted-foreground">
        {rotulo}
        {obrigatorio && <span className="ml-0.5 text-destructive">*</span>}
      </Label>
      {children}
    </div>
  );
}
