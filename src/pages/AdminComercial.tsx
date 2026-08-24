import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Briefcase, Building2, CalendarClock, KanbanSquare, Megaphone, Plus, Sparkles, Target, X } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useClients } from "@/hooks/useSupabaseData";
import FunilKanban from "@/components/comercial/FunilKanban";
import EmpresasCRM from "@/components/comercial/EmpresasCRM";
import MarketingDaCasa from "@/components/comercial/MarketingDaCasa";
import AgendaComercial from "@/components/comercial/AgendaComercial";
import AtividadesDoLead from "@/components/comercial/AtividadesDoLead";
import { useTeamMembers } from "@/hooks/useSupabaseData";
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
  type Atividade,
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
  listarAtividades,
  listarCampanhas,
  listarContatos,
  listarEmpresas,
  listarLeads,
  listarMetas,
  moverLead,
  previsaoDoMes,
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

type Aba = "visao" | "crm" | "agenda" | "metas" | "campanhas" | "marketing";

/**
 * O que cada aba e, dita na propria tela.
 *
 * Uma linha so por aba, no lugar da frase generica que descrevia o modulo
 * inteiro em todas elas: quem abre Metas quer saber o que Metas faz, nao o
 * que o departamento faz.
 */
const TITULO_DA_ABA: Record<Aba, string> = {
  visao: "O departamento num relance: funil, semana, metas e campanhas. Cada bloco abre a sua área.",
  crm: "Empresas, pessoas e negócios. Arraste o cartão para mover de etapa; a ficha da empresa guarda o histórico.",
  agenda: "Sua semana: reuniões, ligações e blocos de trabalho. O que vencer chega no sininho às 8h.",
  metas: "O alvo do mês e quanto já saiu. A receita vem do Financeiro, não é digitada aqui.",
  campanhas: "O que a Aceleriq investe para aparecer, e quantos clientes aquilo virou.",
  marketing: "A presença da própria casa: o que está no ar e o que vem por aí.",
};

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

const ABAS_VALIDAS: Aba[] = ["visao", "crm", "agenda", "metas", "campanhas", "marketing"];

export default function AdminComercial() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  /**
   * A aba mora na URL, não no estado.
   *
   * O menu tem uma entrada para cada área do departamento, e entrada de menu
   * que cai sempre na mesma tela não é área — é enfeite. Com a aba na rota,
   * "Metas" abre em Metas, o voltar do navegador funciona e o link pode ser
   * mandado para alguém.
   */
  const { aba: abaDaUrl } = useParams<{ aba?: string }>();
  // A porta de entrada é a visão geral: quem clica em "Comercial" quer o
  // estado do departamento, não uma das áreas escolhida por ele.
  const aba: Aba = ABAS_VALIDAS.includes(abaDaUrl as Aba) ? (abaDaUrl as Aba) : "visao";
  const setAba = (proxima: Aba) =>
    navigate(proxima === "visao" ? "/comercial" : `/comercial/${proxima}`);
  const [periodo, setPeriodo] = useState(() => primeiroDiaDoMes(new Date()));
  const [leadAberto, setLeadAberto] = useState<Lead | null>(null);
  const [novoLead, setNovoLead] = useState(false);
  const [campanhaAberta, setCampanhaAberta] = useState<Campanha | "nova" | null>(null);
  /**
   * O CRM tem duas leituras do mesmo dado: o QUADRO (o negocio de agora) e a
   * FICHA (a empresa ao longo do tempo). Sao a mesma area, e nao duas abas:
   * separar em abas faria parecer que sao assuntos diferentes.
   */
  const [visaoDoCrm, setVisaoDoCrm] = useState<"negocios" | "empresas">("negocios");

  const { data: leads = [], isLoading: carregandoLeads } = useQuery({
    queryKey: ["comercial-leads"],
    queryFn: listarLeads,
  });
  // Só para o diálogo de ganho: ligar o lead ao cadastro é a ponte que deixa
  // o financeiro responder depois quanto aquele lead virou.
  const { data: clientesBrutos } = useClients();
  const clientes = useMemo(
    () =>
      ((clientesBrutos || []) as Array<Record<string, unknown>>)
        .map((c) => ({
          id: String(c.id),
          nome: String(c.company_name || c.full_name || "Cliente"),
        }))
        .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")),
    [clientesBrutos],
  );

  const { data: atividades = [] } = useQuery({
    queryKey: ["comercial-atividades"],
    queryFn: listarAtividades,
  });
  // Quem pode ser dono de um lead: funil de time sem dono é funil de
  // ninguém — dois ligam para o mesmo lead, ou nenhum liga.
  const { data: equipeBruta } = useTeamMembers();
  const equipe = useMemo(
    () =>
      ((equipeBruta || []) as Array<Record<string, unknown>>).map((m) => ({
        id: String(m.id),
        nome: String(m.full_name || m.email || "Sem nome"),
      })),
    [equipeBruta],
  );

  const { data: empresas = [] } = useQuery({
    queryKey: ["comercial-empresas"],
    queryFn: listarEmpresas,
  });
  const { data: contatos = [] } = useQuery({
    queryKey: ["comercial-contatos"],
    queryFn: listarContatos,
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
      queryClient.invalidateQueries({ queryKey: ["comercial-atividades"] }),
      queryClient.invalidateQueries({ queryKey: ["comercial-empresas"] }),
      queryClient.invalidateQueries({ queryKey: ["comercial-contatos"] }),
    ]);

  const resumo = useMemo(
    () => resumoDoFunil(leads, periodo, new Date().toISOString(), atividades),
    [leads, periodo, atividades],
  );
  const previsao = useMemo(() => previsaoDoMes(leads, periodo), [leads, periodo]);

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
      {/* ── Cabecalho: identidade e a aba. Os numeros ficam com quem os
             usa, e nao empilhados aqui em cima: cinco cartoes iguais no topo
             de quatro telas diferentes obrigam a ler tudo para achar o que
             importa naquela. ── */}
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
              {TITULO_DA_ABA[aba]}
            </p>
          </div>
          {/* O mes so aparece onde ele manda: visão geral, metas e marketing
              olham para um mes fechado; CRM e agenda vivem no presente. */}
          {(aba === "visao" || aba === "metas" || aba === "campanhas" || aba === "marketing") && (
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
          )}
        </div>

        {/* Sem fileira de abas aqui: o menu lateral do painel ja lista as
            areas do departamento. Duas navegacoes para o mesmo lugar e o
            que fazia a tela parecer desorganizada: o cabecalho guarda so
            identidade, e o conteudo fica com a tela inteira. */}
      </header>

      {aba === "visao" && (
        <VisaoGeral
          resumo={resumo}
          previsao={previsao}
          receita={receita}
          metas={metas}
          leads={leads}
          atividades={atividades}
          campanhas={campanhas}
          periodo={periodo}
          onIr={setAba}
        />
      )}

      {aba === "crm" && (
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          <Tile
            titulo="Em aberto"
            valor={String(resumo.abertos)}
            apoio={resumo.abertos === 1 ? "lead em conversa" : "leads em conversa"}
          />
          <Tile
            titulo="Em jogo"
            valor={dinheiro(resumo.valorEmJogo)}
            apoio="mensalidade x 12 + entrada"
          />
          <Tile
            titulo="Previsão do mês"
            valor={dinheiro(previsao.ponderado)}
            /* Previsão feita só sobre quem tem data parece precisa e esconde
               metade do funil; dizer quantos ficaram de fora impede a conta
               de virar promessa. */
            apoio={
              previsao.semData > 0
                ? `${previsao.leads} com data, ${previsao.semData} sem`
                : `${previsao.leads} com data prevista`
            }
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
        </div>
      )}

      {/* O que está parado, dito onde dá para agir. Funil não morre de
          proposta recusada, morre de lead esquecido. */}
      {aba === "crm" && (resumo.atrasados > 0 || resumo.semProximoPasso > 0) && (
        <p className="rounded-xl border border-warning/25 bg-warning/[0.06] px-3 py-2 text-[11px] leading-relaxed text-warning">
          {resumo.atrasados > 0 && (
            <>
              {resumo.atrasados}{" "}
              {resumo.atrasados === 1
                ? "lead com compromisso atrasado"
                : "leads com compromisso atrasado"}
            </>
          )}
          {resumo.atrasados > 0 && resumo.semProximoPasso > 0 && ", "}
          {resumo.semProximoPasso > 0 && (
            <>
              {resumo.semProximoPasso}{" "}
              {resumo.semProximoPasso === 1
                ? "sem nada marcado"
                : "sem nada marcado"}
            </>
          )}
        </p>
      )}

      {aba === "crm" && (
        <div className="flex gap-1.5">
          {(
            [
              { id: "negocios", label: "Negócios", icone: KanbanSquare },
              { id: "empresas", label: "Empresas", icone: Building2 },
            ] as const
          ).map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setVisaoDoCrm(item.id)}
              className={`flex h-8 items-center gap-1.5 rounded-lg border px-3 text-[11.5px] font-semibold transition-colors ${
                visaoDoCrm === item.id
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : "border-border bg-card text-muted-foreground hover:text-foreground"
              }`}
            >
              <item.icone className="h-3.5 w-3.5" />
              {item.label}
            </button>
          ))}
        </div>
      )}

      {aba === "crm" && visaoDoCrm === "empresas" && (
        <EmpresasCRM
          empresas={empresas}
          contatos={contatos}
          leads={leads}
          onAbrirLead={setLeadAberto}
          onMudou={recarregar}
        />
      )}

      {aba === "crm" && visaoDoCrm === "negocios" && (
        <FunilKanban
          leads={leads}
          atividades={atividades}
          carregando={carregandoLeads}
          clientes={clientes}
          onAbrir={setLeadAberto}
          onNovo={() => setNovoLead(true)}
          onImportar={() => importar.mutate()}
          importando={importar.isPending}
          onMovido={recarregar}
        />
      )}

      {aba === "agenda" && (
        <AgendaComercial
          atividades={atividades}
          leads={leads}
          onAbrirLead={setLeadAberto}
          onMudou={recarregar}
        />
      )}

      {aba === "metas" && (
        <div className="grid grid-cols-2 gap-2">
          <Tile
            titulo="Receita do mês"
            valor={dinheiro(receita)}
            apoio="lida do Financeiro"
          />
          <Tile
            titulo="Fechados no mês"
            valor={String(resumo.ganhosNoMes)}
            apoio="leads que entraram em Ganho"
          />
        </div>
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
        <MarketingDaCasa leads={leads} campanhas={campanhas} periodo={periodo} />
      )}

      {aba === "campanhas" && (
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
          equipe={equipe}
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

      {aba === "campanhas" && (
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

/* ───────────────────────────── Visão geral ─────────────────────────────── */

/**
 * A capa do departamento. Não inventa número nenhum: cada bloco resume a
 * área com os MESMOS dados que ela usa e leva até ela num toque. O menu
 * lateral é o índice; isto aqui é o sumário executivo.
 */
function VisaoGeral({
  resumo,
  previsao,
  receita,
  metas,
  leads,
  atividades,
  campanhas,
  periodo,
  onIr,
}: {
  resumo: ReturnType<typeof resumoDoFunil>;
  previsao: ReturnType<typeof previsaoDoMes>;
  receita: number;
  metas: Array<{ id: string; metric: string; target: number }>;
  leads: Lead[];
  atividades: Atividade[];
  campanhas: Campanha[];
  periodo: string;
  onIr: (aba: Aba) => void;
}) {
  const proximos = useMemo(() => {
    const agora = Date.now();
    return atividades
      .filter((a) => !a.done_at && a.due_at && new Date(a.due_at).getTime() >= agora)
      .sort((a, b) => (a.due_at < b.due_at ? -1 : 1))
      .slice(0, 4);
  }, [atividades]);

  const nomeDoLead = (id: string | null) =>
    id ? leads.find((l) => l.id === id)?.name || null : null;

  const quando = (iso: string) => {
    const d = new Date(iso);
    return `${d.toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit" })} · ${d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
  };

  const mes = periodo.slice(0, 7);
  const ativas = campanhas.filter((c) => c.status === "ativa").length;
  const leadsDeCampanhaNoMes = leads.filter(
    (l) => l.campaign_id && (l.created_at || "").slice(0, 7) === mes,
  ).length;

  const linhasDeMeta = METRICAS.map((metrica) => {
    const alvo = metas.find((m) => m.metric === metrica.id)?.target || 0;
    const feito = realizadoDoMes({
      metrica: metrica.id,
      leads,
      periodo,
      receitaFinanceiro: receita,
    });
    return { ...metrica, alvo, feito };
  });
  const mostrar = (linha: (typeof linhasDeMeta)[number], v: number) =>
    linha.dinheiro ? dinheiro(v) : String(Math.round(v));

  return (
    <div className="space-y-3">
      {/* Os quatro números que resumem o mês do departamento. */}
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Tile
          titulo="Em conversa"
          valor={String(resumo.abertos)}
          apoio={resumo.abertos === 1 ? "lead aberto no funil" : "leads abertos no funil"}
        />
        <Tile titulo="Em jogo" valor={dinheiro(resumo.valorEmJogo)} apoio="mensalidade x 12 + entrada" />
        <Tile
          titulo="Previsão do mês"
          valor={dinheiro(previsao.ponderado)}
          apoio={
            previsao.semData > 0
              ? `${previsao.leads} com data, ${previsao.semData} sem`
              : `${previsao.leads} com data prevista`
          }
        />
        <Tile titulo="Receita do mês" valor={dinheiro(receita)} apoio="lida do Financeiro" />
      </div>

      <div className="grid gap-2.5 md:grid-cols-2 xl:grid-cols-3">
        <Bloco titulo="CRM" icone={KanbanSquare} onClick={() => onIr("crm")}>
          <Linha
            forte={`${resumo.abertos} ${resumo.abertos === 1 ? "negócio aberto" : "negócios abertos"}`}
            fraca={`${resumo.ganhosNoMes} ${resumo.ganhosNoMes === 1 ? "ganho" : "ganhos"} no mês`}
          />
          {resumo.atrasados > 0 || resumo.semProximoPasso > 0 ? (
            <span className="block text-[11px] leading-relaxed text-warning">
              {resumo.atrasados > 0 && `${resumo.atrasados} com compromisso atrasado`}
              {resumo.atrasados > 0 && resumo.semProximoPasso > 0 && " · "}
              {resumo.semProximoPasso > 0 && `${resumo.semProximoPasso} sem próximo passo`}
            </span>
          ) : (
            <span className="block text-[11px] text-muted-foreground">
              Todo negócio aberto tem um próximo passo marcado.
            </span>
          )}
        </Bloco>

        <Bloco titulo="Agenda" icone={CalendarClock} onClick={() => onIr("agenda")}>
          {proximos.length === 0 ? (
            <span className="block text-[11px] text-muted-foreground">
              Nada marcado daqui para a frente. Toque para abrir o calendário.
            </span>
          ) : (
            proximos.map((a) => (
              <span key={a.id} className="flex items-baseline justify-between gap-2">
                <span className="min-w-0 truncate text-[11.5px] text-foreground">
                  {a.title}
                  {nomeDoLead(a.lead_id) ? (
                    <span className="text-muted-foreground"> · {nomeDoLead(a.lead_id)}</span>
                  ) : null}
                </span>
                <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
                  {quando(a.due_at)}
                </span>
              </span>
            ))
          )}
        </Bloco>

        <Bloco titulo="Metas" icone={Target} onClick={() => onIr("metas")}>
          {linhasDeMeta.map((linha) => (
            <span key={linha.id} className="block">
              <span className="flex items-baseline justify-between gap-2 text-[11px]">
                <span className="min-w-0 truncate text-muted-foreground">{linha.label}</span>
                <span className="shrink-0 tabular-nums text-foreground">
                  {mostrar(linha, linha.feito)}
                  {linha.alvo > 0 ? (
                    <span className="text-muted-foreground"> de {mostrar(linha, linha.alvo)}</span>
                  ) : (
                    <span className="text-muted-foreground"> · sem meta</span>
                  )}
                </span>
              </span>
              {linha.alvo > 0 && (
                <span className="mt-1 block h-1 overflow-hidden rounded-full bg-secondary">
                  <span
                    className={`block h-full rounded-full ${linha.feito >= linha.alvo ? "bg-success" : "bg-primary"}`}
                    style={{ width: `${Math.round(Math.min(linha.feito / linha.alvo, 1) * 100)}%` }}
                  />
                </span>
              )}
            </span>
          ))}
        </Bloco>

        <Bloco titulo="Campanhas" icone={Megaphone} onClick={() => onIr("campanhas")}>
          <Linha
            forte={`${ativas} ${ativas === 1 ? "campanha ativa" : "campanhas ativas"}`}
            fraca={
              leadsDeCampanhaNoMes > 0
                ? `${leadsDeCampanhaNoMes} ${leadsDeCampanhaNoMes === 1 ? "lead trazido" : "leads trazidos"} no mês`
                : "nenhum lead de campanha no mês"
            }
          />
          <span className="block text-[11px] text-muted-foreground">
            Investimento, custo por lead e por cliente vivem lá dentro.
          </span>
        </Bloco>

        <Bloco titulo="Marketing" icone={Sparkles} onClick={() => onIr("marketing")}>
          <span className="block text-[11px] leading-relaxed text-muted-foreground">
            A presença da própria casa: o que está no ar, o que vem por aí e o
            que o diagnóstico está trazendo.
          </span>
        </Bloco>
      </div>
    </div>
  );
}

function Bloco({
  titulo,
  icone: Icone,
  onClick,
  children,
}: {
  titulo: string;
  icone: React.ComponentType<{ className?: string }>;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex min-h-[132px] flex-col rounded-2xl border border-border bg-card p-3.5 text-left transition-colors hover:border-primary/40"
    >
      <span className="flex w-full items-center justify-between">
        <span className="flex items-center gap-2 text-[12.5px] font-bold text-foreground">
          <Icone className="h-4 w-4 text-primary" />
          {titulo}
        </span>
        <ArrowRight className="h-3.5 w-3.5 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
      </span>
      <span className="mt-2.5 block w-full flex-1 space-y-1.5">{children}</span>
    </button>
  );
}

function Linha({ forte, fraca }: { forte: string; fraca: string }) {
  return (
    <span className="flex items-baseline justify-between gap-2">
      <span className="text-[12.5px] font-semibold text-foreground">{forte}</span>
      <span className="shrink-0 text-[10.5px] text-muted-foreground">{fraca}</span>
    </span>
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
                valor={kpi.custoPorLead == null ? "sem dado" : dinheiro(kpi.custoPorLead)}
              />
              <Kpi
                rotulo="Custo por cliente"
                valor={kpi.custoPorCliente == null ? "sem dado" : dinheiro(kpi.custoPorCliente)}
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
  equipe,
  onFechar,
  onSalvo,
}: {
  lead: Lead | null;
  campanhas: Campanha[];
  equipe: Array<{ id: string; nome: string }>;
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
    expected_close_date: lead?.expected_close_date || "",
    owner_id: lead?.owner_id || "",
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
      expected_close_date: form.expected_close_date || null,
      owner_id: form.owner_id || null,
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
      toast.error("Diga em uma linha por que foi perdido. É o que ensina o próximo.");
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

          <div className="grid gap-3 sm:grid-cols-2">
            {/* Dono e data prevista: sem o primeiro, dois ligam para o mesmo
                lead ou nenhum liga; sem o segundo, não existe previsão, só
                a soma do funil inteiro, inclusive o que fecha ano que vem. */}
            <Campo rotulo="Dono">
              <Select
                value={form.owner_id || "ninguem"}
                onValueChange={(v) =>
                  setForm({ ...form, owner_id: v === "ninguem" ? "" : v })
                }
              >
                <SelectTrigger className="h-10">
                  <SelectValue placeholder="Sem dono" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ninguem">Sem dono</SelectItem>
                  {equipe.map((pessoa) => (
                    <SelectItem key={pessoa.id} value={pessoa.id}>
                      {pessoa.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Campo>
            <Campo rotulo="Previsão de fechamento">
              <Input
                type="date"
                value={form.expected_close_date}
                onChange={(e) =>
                  setForm({ ...form, expected_close_date: e.target.value })
                }
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

              <AtividadesDoLead
                leadId={lead.id}
                donoPadrao={lead.owner_id}
                onMudou={() => void onSalvo()}
              />

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
