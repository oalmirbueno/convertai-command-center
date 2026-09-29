import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  ArrowRight,
  Building2,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  Download,
  KanbanSquare,
  Megaphone,
  Pencil,
  Plus,
  Sparkles,
  Target,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useClients } from "@/hooks/useSupabaseData";
import FunilKanban from "@/components/comercial/FunilKanban";
import EmpresasCRM from "@/components/comercial/EmpresasCRM";
import MarketingDaCasa from "@/components/comercial/MarketingDaCasa";
import AgendaComercial from "@/components/comercial/AgendaComercial";
import AtividadesDoLead from "@/components/comercial/AtividadesDoLead";
import { FaixaDeNumeros } from "@/components/sistema";
import { ehTexto, umaDe, useEstadoDoComercial } from "@/components/comercial/useEstadoDoComercial";
import { useTeamMembers } from "@/hooks/useSupabaseData";
import {
  AreaDeTrabalho,
  CabecalhoDePagina,
  CampoDeFormulario,
  Carregando,
  EstadoDeErro,
  EstadoVazio,
  Etapas,
  GrupoDeCampos,
  Painel,
  SeletorCompacto,
  botao,
  campo,
  campoTexto,
  foco,
  juntar,
  texto,
} from "@/components/sistema";
import {
  CANAIS,
  ESTAGIOS,
  METRICAS,
  ORIGENS,
  type Atividade,
  type Campanha,
  type CampoDaEmpresa,
  type Empresa,
  type EstagioId,
  type Lead,
  CAMPOS_DA_EMPRESA,
  anotarNoLead,
  apagarLead,
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
  CAMPOS_DE_QUALIFICACAO,
  CLASSES_DO_LEAD,
  clientesRecorrentesDoMes,
  listarMetas,
  moverLead,
  previsaoDoMes,
  primeiroDiaDoMes,
  realizadoDoMes,
  receitaDoMes,
  resumoDoFunil,
  rotuloDoEstagio,
  salvarCampanha,
  salvarDadosDaEmpresaDoLead,
  salvarLead,
  salvarMeta,
  ultimoErroDoComercial,
} from "@/lib/comercial";

/**
 * Departamento Comercial: a parte da Aceleriq que o cliente nunca vê.
 *
 * O painel inteiro conta o que acontece DEPOIS que o contrato existe. Esta
 * tela é o antes: quem está conversando, quanto está em jogo, o que a casa
 * prometeu a si mesma para o mês e quanto custou aparecer.
 *
 * A regra que sustenta o módulo: **alvo é dado daqui, realizado vem do
 * Financeiro**. A receita do mês não é digitada nesta tela, é lida dos
 * lançamentos. Assim não existe a situação em que o comercial comemora um
 * número que o financeiro não reconhece.
 *
 * Sistema de design (docs/design/SISTEMA.md): título curto com a explicação
 * no "?", ações na linha do título, áreas nas Etapas (a aba continua no
 * endereço), filtros no SeletorCompacto, números numa faixa só e, de 1024 px
 * para cima, só a lista rola (a página não).
 */

type Aba = "visao" | "crm" | "agenda" | "metas" | "campanhas" | "marketing";

/**
 * O que cada aba e, dita na propria tela (no "?" ao lado do título).
 *
 * Uma linha so por aba, no lugar da frase generica que descrevia o modulo
 * inteiro em todas elas: quem abre Metas quer saber o que Metas faz, nao o
 * que o departamento faz.
 */
const TITULO_DA_ABA: Record<Aba, string> = {
  visao: "O departamento num relance: funil, semana, metas e campanhas. Cada linha abre a sua área.",
  crm: "Empresas, pessoas e negócios. Arraste o cartão para mover de etapa; a ficha da empresa guarda o histórico.",
  agenda: "Sua semana: reuniões, ligações e blocos de trabalho. O que vencer chega no sininho às 8h.",
  metas: "O alvo do mês e quanto já saiu. A receita vem do Financeiro, não é digitada aqui.",
  campanhas: "O que a Aceleriq investe para aparecer, e quantos clientes aquilo virou. O lead aponta para a campanha, então o custo por cliente sai sozinho.",
  marketing: "A presença da própria casa: o que está no ar, o que vem por aí e de onde as pessoas chegam.",
};

/** As áreas do departamento, na ordem do menu lateral. */
const AREAS: Array<{ valor: Aba; rotulo: string }> = [
  { valor: "visao", rotulo: "Visão geral" },
  { valor: "crm", rotulo: "CRM" },
  { valor: "agenda", rotulo: "Agenda" },
  { valor: "metas", rotulo: "Metas" },
  { valor: "campanhas", rotulo: "Campanhas" },
  { valor: "marketing", rotulo: "Marketing" },
];

/** "Setembro de 2026" (só a primeira letra maiúscula; `capitalize` faria "De"). */
const mesLegivel = (periodo: string) => {
  const [ano, mes] = periodo.split("-").map(Number);
  const texto = new Date(ano, mes - 1, 1).toLocaleDateString("pt-BR", {
    month: "long",
    year: "numeric",
  });
  return texto.charAt(0).toUpperCase() + texto.slice(1);
};

/** "Set. 2026": o mês no celular, onde o título divide a linha com o seletor. */
const mesCurto = (periodo: string) => {
  const [ano, mes] = periodo.split("-").map(Number);
  const nome = new Date(ano, mes - 1, 1).toLocaleDateString("pt-BR", { month: "short" }).replace(".", "");
  return `${nome.charAt(0).toUpperCase()}${nome.slice(1)} ${ano}`;
};

const somarMeses = (periodo: string, passo: number) => {
  const [ano, mes] = periodo.split("-").map(Number);
  const data = new Date(ano, mes - 1 + passo, 1);
  return primeiroDiaDoMes(data);
};

const ehPeriodo = (v: unknown) => typeof v === "string" && /^\d{4}-\d{2}-01$/.test(v);

/** A janela tem pelo menos `px` de largura? Atualiza ao redimensionar e girar. */
function useLarguraMinima(px: number): boolean {
  const medir = () => (typeof window === "undefined" ? false : (window.innerWidth || 0) >= px);
  const [cabe, setCabe] = useState(medir);
  useEffect(() => {
    const aoMudar = () => setCabe(medir());
    window.addEventListener("resize", aoMudar);
    window.addEventListener("orientationchange", aoMudar);
    return () => {
      window.removeEventListener("resize", aoMudar);
      window.removeEventListener("orientationchange", aoMudar);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [px]);
  return cabe;
}

const ABAS_VALIDAS: Aba[] = ["visao", "crm", "agenda", "metas", "campanhas", "marketing"];

/** Botão do cabeçalho: no celular só o ícone (com aria-label), do sm para cima ícone e texto. */
function BotaoDoCabecalho({
  icone,
  texto: rotulo,
  onClick,
  primario = false,
  desativado = false,
}: {
  icone: ReactNode;
  texto: string;
  onClick: () => void;
  primario?: boolean;
  desativado?: boolean;
}) {
  return (
    <button type="button" onClick={onClick} disabled={desativado} aria-label={rotulo} className={primario ? botao.primario : botao.secundario}>
      {icone}
      <span className="ml-1.5 hidden sm:inline">{rotulo}</span>
    </button>
  );
}

export default function AdminComercial() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  /**
   * A aba mora na URL, não no estado.
   *
   * O menu tem uma entrada para cada área do departamento, e entrada de menu
   * que cai sempre na mesma tela não é área, é enfeite. Com a aba na rota,
   * "Metas" abre em Metas, o voltar do navegador funciona e o link pode ser
   * mandado para alguém.
   */
  const { aba: abaDaUrl } = useParams<{ aba?: string }>();
  // A porta de entrada é a visão geral: quem clica em "Comercial" quer o
  // estado do departamento, não uma das áreas escolhida por ele.
  const aba: Aba = ABAS_VALIDAS.includes(abaDaUrl as Aba) ? (abaDaUrl as Aba) : "visao";
  const setAba = (proxima: Aba) =>
    navigate(proxima === "visao" ? "/comercial" : `/comercial/${proxima}`);
  // O mês escolhido fica guardado enquanto o mês do calendário for o mesmo:
  // sair e voltar mantém; no mês seguinte a tela abre no mês novo.
  const mesDeHoje = primeiroDiaDoMes(new Date());
  const [periodo, setPeriodo] = useEstadoDoComercial(`periodo:${mesDeHoje}`, mesDeHoje, { validar: ehPeriodo, esperaMs: 0 });
  const [leadAberto, setLeadAberto] = useState<Lead | null>(null);
  const [novoLead, setNovoLead] = useState(false);
  const [campanhaAberta, setCampanhaAberta] = useState<Campanha | "nova" | null>(null);
  const [pedidoDeEmpresa, setPedidoDeEmpresa] = useState(0);
  // De 1280 px para cima os filtros do CRM sobem para a linha das áreas: a
  // tela de 720 px de altura ganha espaço para o quadro inteiro.
  const filtrosNaLinha = useLarguraMinima(1280);
  const [linhaDosFiltros, setLinhaDosFiltros] = useState<HTMLDivElement | null>(null);
  const destinoDosFiltros = aba === "crm" && filtrosNaLinha ? linhaDosFiltros : null;
  /**
   * O CRM tem duas leituras do mesmo dado: o QUADRO (o negocio de agora) e a
   * FICHA (a empresa ao longo do tempo). Sao a mesma area, e nao duas abas:
   * separar em abas faria parecer que sao assuntos diferentes.
   */
  const [visaoDoCrm, setVisaoDoCrm] = useEstadoDoComercial<"negocios" | "empresas">("crm:visao", "negocios", {
    validar: umaDe(["negocios", "empresas"]),
  });

  const { data: leads = [], isLoading: carregandoLeads, isError: erroNosLeads } = useQuery({
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

  const { data: atividades = [], isError: erroNasAtividades } = useQuery({
    queryKey: ["comercial-atividades"],
    queryFn: listarAtividades,
  });
  // Quem pode ser dono de um lead: funil de time sem dono é funil de
  // ninguém; dois ligam para o mesmo lead, ou nenhum liga.
  const { data: equipeBruta } = useTeamMembers();
  const equipe = useMemo(
    () =>
      ((equipeBruta || []) as Array<Record<string, unknown>>).map((m) => ({
        id: String(m.id),
        nome: String(m.full_name || m.email || "Sem nome"),
      })),
    [equipeBruta],
  );

  const { data: empresas = [], isError: erroNasEmpresas } = useQuery({
    queryKey: ["comercial-empresas"],
    queryFn: listarEmpresas,
  });
  const { data: contatos = [], isError: erroNosContatos } = useQuery({
    queryKey: ["comercial-contatos"],
    queryFn: listarContatos,
  });

  const { data: campanhas = [], isLoading: carregandoCampanhas, isError: erroNasCampanhas } = useQuery({
    queryKey: ["comercial-campanhas"],
    queryFn: listarCampanhas,
  });
  // Trocar de mês não troca a tela por esqueleto: o mês anterior fica até o novo chegar.
  const { data: metas = [], isLoading: carregandoMetas, isError: erroNasMetas } = useQuery({
    queryKey: ["comercial-metas", periodo],
    queryFn: () => listarMetas(periodo),
    placeholderData: (anterior) => anterior,
  });

  // O realizado da meta de recorrentes vem do Financeiro, não do funil:
  // cliente recorrente é quem a regra de recorrência cobrou no mês.
  const { data: clientesRecorrentes = 0 } = useQuery({
    queryKey: ["comercial-clientes-recorrentes", periodo],
    queryFn: () => clientesRecorrentesDoMes(periodo),
    placeholderData: (anterior) => anterior,
  });
  // A receita realizada vem do Financeiro central, nunca daqui.
  const { data: receita = 0 } = useQuery({
    queryKey: ["comercial-receita", periodo],
    queryFn: () => receitaDoMes(periodo),
    placeholderData: (anterior) => anterior,
  });

  // Leitura que falhou não vira "lista vazia": a tela avisa e oferece tentar de novo.
  const leituraFalhou = erroNosLeads || erroNasAtividades || erroNasEmpresas || erroNosContatos || erroNasCampanhas || erroNasMetas;

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

  /* ── O estado de cada área, em uma linha, embaixo do título. ── */
  const compromissosAbertos = atividades.filter((a) => !a.done_at).length;
  const campanhasAtivas = campanhas.filter((c) => c.status === "ativa").length;
  const metasDefinidas = METRICAS.filter((m) => metas.some((meta) => meta.metric === m.id && meta.target > 0)).length;
  const leadsNoMes = leads.filter((l) => (l.created_at || "").slice(0, 7) === periodo.slice(0, 7)).length;
  const aviso = (partes: Array<string | false>) => {
    const lista = partes.filter(Boolean) as string[];
    return lista.length ? <span className="text-warning">{lista.join(" · ")}</span> : null;
  };

  let descricao: ReactNode = null;
  if (aba === "visao") {
    descricao = carregandoLeads ? undefined : `${resumo.abertos} em conversa · ${resumo.ganhosNoMes} ${resumo.ganhosNoMes === 1 ? "ganho" : "ganhos"} no mês`;
  } else if (aba === "crm") {
    const alerta = aviso([
      resumo.atrasados > 0 && `${resumo.atrasados} ${resumo.atrasados === 1 ? "atrasado" : "atrasados"}`,
      resumo.semProximoPasso > 0 && `${resumo.semProximoPasso} sem próximo passo`,
    ]);
    descricao = carregandoLeads ? undefined : (
      <>
        {visaoDoCrm === "empresas" ? `${empresas.length} ${empresas.length === 1 ? "empresa" : "empresas"}` : `${resumo.abertos} em aberto`}
        {alerta && visaoDoCrm === "negocios" ? <> · {alerta}</> : null}
      </>
    );
  } else if (aba === "agenda") {
    // O atraso da agenda aparece no próprio calendário (uma vez só).
    descricao = `${compromissosAbertos} ${compromissosAbertos === 1 ? "compromisso em aberto" : "compromissos em aberto"}`;
  } else if (aba === "metas") {
    descricao = `${metasDefinidas} de ${METRICAS.length} metas definidas`;
  } else if (aba === "campanhas") {
    descricao = carregandoCampanhas ? undefined : `${campanhasAtivas} ${campanhasAtivas === 1 ? "ativa" : "ativas"} de ${campanhas.length}`;
  } else if (aba === "marketing") {
    descricao = `${leadsNoMes} ${leadsNoMes === 1 ? "lead novo" : "leads novos"} no mês`;
  }

  /* ── As ações da área, na linha do título. ── */
  const seletorDeMes = (
    <div className="flex h-9 items-center rounded-md border border-border" role="group" aria-label="Mês">
      <button type="button" onClick={() => setPeriodo(somarMeses(periodo, -1))} className={juntar(botao.icone, "h-[34px]")} aria-label="Mês anterior">
        <ChevronLeft className="h-4 w-4" aria-hidden="true" />
      </button>
      <span className="min-w-[72px] px-1 text-center text-[13px] font-medium tabular-nums text-foreground sm:min-w-[124px]" aria-live="polite">
        <span className="sm:hidden">{mesCurto(periodo)}</span>
        <span className="hidden sm:inline">{mesLegivel(periodo)}</span>
      </span>
      <button type="button" onClick={() => setPeriodo(somarMeses(periodo, 1))} className={juntar(botao.icone, "h-[34px]")} aria-label="Próximo mês">
        <ChevronRight className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );

  const acoes = (
    <>
      {/* O mes so aparece onde ele manda: visão geral, metas e marketing
          olham para um mes fechado; CRM e agenda vivem no presente. */}
      {(aba === "visao" || aba === "metas" || aba === "campanhas" || aba === "marketing") && (
        seletorDeMes
      )}
      {aba === "crm" && visaoDoCrm === "negocios" && (
        <BotaoDoCabecalho
          icone={<Download className="h-3.5 w-3.5" aria-hidden="true" />}
          texto="Trazer do diagnóstico"
          onClick={() => importar.mutate()}
          desativado={importar.isPending}
        />
      )}
      {aba === "crm" && visaoDoCrm === "negocios" && (
        <BotaoDoCabecalho primario icone={<Plus className="h-4 w-4" aria-hidden="true" />} texto="Novo lead" onClick={() => setNovoLead(true)} />
      )}
      {aba === "crm" && visaoDoCrm === "empresas" && (
        <BotaoDoCabecalho primario icone={<Plus className="h-4 w-4" aria-hidden="true" />} texto="Nova empresa" onClick={() => setPedidoDeEmpresa((n) => n + 1)} />
      )}
      {aba === "campanhas" && (
        <BotaoDoCabecalho primario icone={<Plus className="h-4 w-4" aria-hidden="true" />} texto="Nova campanha" onClick={() => setCampanhaAberta("nova")} />
      )}
    </>
  );

  // Negócios | Empresas: a navegação secundária do CRM, na fileira dos filtros.
  const leituraDoCrm = (
    <SeletorCompacto
      rotulo="Leitura do CRM"
      opcoes={[
        { valor: "negocios", rotulo: "Negócios", icone: <KanbanSquare className="h-3.5 w-3.5" /> },
        { valor: "empresas", rotulo: "Empresas", icone: <Building2 className="h-3.5 w-3.5" /> },
      ]}
      valor={visaoDoCrm}
      onEscolher={(v) => setVisaoDoCrm(v as "negocios" | "empresas")}
    />
  );

  return (
    <div className="min-w-0 space-y-4">
      {/* ── Cabecalho: identidade, estado da área e as ações. Os numeros
             ficam com quem os usa, e nao empilhados aqui em cima: cinco
             cartoes iguais no topo de quatro telas diferentes obrigam a ler
             tudo para achar o que importa naquela. ── */}
      <header className="min-w-0">
        <CabecalhoDePagina titulo="Comercial" descricao={descricao} ajuda={TITULO_DA_ABA[aba]} acoes={acoes} />
        {/* As áreas do departamento (as mesmas do menu lateral). A aba
            continua no endereço: voltar do navegador e link mandado
            funcionam igual. */}
        <Etapas
          className="mt-2 border-b border-border"
          rotulo="Áreas do Comercial"
          itens={AREAS}
          valor={aba}
          onEscolher={(v) => setAba(v as Aba)}
          depois={aba === "crm" && filtrosNaLinha ? <div ref={setLinhaDosFiltros} className="ml-auto flex shrink-0 items-center py-1 pl-4" /> : undefined}
        />
      </header>

      {leituraFalhou && (
        <EstadoDeErro
          titulo="Não foi possível carregar o Comercial."
          descricao="O que aparece abaixo pode estar incompleto."
          acao={
            <button type="button" onClick={() => void recarregar()} className={juntar(botao.secundario, "h-8")}>
              Tentar de novo
            </button>
          }
        />
      )}

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
          carregando={carregandoLeads}
          onIr={setAba}
        />
      )}

      {aba === "crm" && (
        <FaixaDeNumeros
          tamanho="compacto"
          apoioAoLado
          rotulo="Números do CRM"
          itens={[
            {
              rotulo: "Em aberto",
              valor: carregandoLeads ? "…" : String(resumo.abertos),
              apoio: resumo.abertos === 1 ? "lead em conversa" : "leads em conversa",
            },
            { rotulo: "Em jogo", valor: carregandoLeads ? "…" : dinheiro(resumo.valorEmJogo), apoio: "mensalidade x 12 + entrada" },
            {
              rotulo: "Previsão do mês",
              valor: carregandoLeads ? "…" : dinheiro(previsao.ponderado),
              /* Previsão feita só sobre quem tem data parece precisa e esconde
                 metade do funil; dizer quantos ficaram de fora impede a conta
                 de virar promessa. */
              apoio: previsao.semData > 0 ? `${previsao.leads} com data, ${previsao.semData} sem` : `${previsao.leads} com data prevista`,
            },
            {
              rotulo: "Ganhos no mês",
              valor: carregandoLeads ? "…" : String(resumo.ganhosNoMes),
              apoio: resumo.taxaDeGanho == null ? "nada fechado ainda" : `${Math.round(resumo.taxaDeGanho * 100)}% de aproveitamento`,
            },
          ]}
        />
      )}

      {aba === "crm" && visaoDoCrm === "empresas" && (
        <div className="min-w-0">
          <EmpresasCRM
            empresas={empresas}
            contatos={contatos}
            leads={leads}
            onAbrirLead={setLeadAberto}
            onMudou={recarregar}
            filtrosAntes={leituraDoCrm}
            pedidoDeNova={pedidoDeEmpresa}
            destinoDosFiltros={destinoDosFiltros}
          />
        </div>
      )}

      {aba === "crm" && visaoDoCrm === "negocios" && (
        <div className="min-w-0">
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
            filtrosAntes={leituraDoCrm}
            destinoDosFiltros={destinoDosFiltros}
          />
        </div>
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
        <Metas
          periodo={periodo}
          metas={metas}
          leads={leads}
          receita={receita}
          clientesRecorrentes={clientesRecorrentes}
          carregando={carregandoLeads || carregandoMetas}
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
          carregando={carregandoCampanhas}
          onNova={() => setCampanhaAberta("nova")}
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
          empresas={empresas}
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
    </div>
  );
}

/* ───────────────────────────── Visão geral ─────────────────────────────── */

/**
 * A capa do departamento. Não inventa número nenhum: cada linha resume a
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
  carregando,
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
  carregando: boolean;
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
    <AreaDeTrabalho rotuloDoPrincipal="Visão geral do Comercial" memoriaDaRolagem="comercial:visao">
      <div className="min-w-0 space-y-5">
        {/* Os quatro números que resumem o mês do departamento. */}
        <FaixaDeNumeros
          tamanho="compacto"
          apoioAoLado
          rotulo="Números do mês"
          itens={[
            {
              rotulo: "Em conversa",
              valor: carregando ? "…" : String(resumo.abertos),
              apoio: resumo.abertos === 1 ? "lead aberto no funil" : "leads abertos no funil",
            },
            { rotulo: "Em jogo", valor: carregando ? "…" : dinheiro(resumo.valorEmJogo), apoio: "mensalidade x 12 + entrada" },
            {
              rotulo: "Previsão do mês",
              valor: carregando ? "…" : dinheiro(previsao.ponderado),
              apoio: previsao.semData > 0 ? `${previsao.leads} com data, ${previsao.semData} sem` : `${previsao.leads} com data prevista`,
            },
            { rotulo: "Receita do mês", valor: dinheiro(receita), apoio: "lida do Financeiro" },
          ]}
        />

        {carregando ? (
          <Carregando rotulo="Carregando o resumo" linhas={5} />
        ) : (
          <Painel semEspaco as="section" aria-label="Áreas do Comercial">
            <ul className="divide-y divide-border">
              <Bloco titulo="CRM" icone={KanbanSquare} onClick={() => onIr("crm")}>
                <Linha
                  forte={`${resumo.abertos} ${resumo.abertos === 1 ? "negócio aberto" : "negócios abertos"}`}
                  fraca={`${resumo.ganhosNoMes} ${resumo.ganhosNoMes === 1 ? "ganho" : "ganhos"} no mês`}
                />
                {resumo.atrasados > 0 || resumo.semProximoPasso > 0 ? (
                  <span className="block truncate text-[12px] leading-4 text-warning">
                    {resumo.atrasados > 0 && `${resumo.atrasados} com compromisso atrasado`}
                    {resumo.atrasados > 0 && resumo.semProximoPasso > 0 && " · "}
                    {resumo.semProximoPasso > 0 && `${resumo.semProximoPasso} sem próximo passo`}
                  </span>
                ) : (
                  <span className={juntar(texto.auxiliar, "block truncate")}>Todo negócio aberto tem um próximo passo marcado.</span>
                )}
              </Bloco>

              <Bloco titulo="Agenda" icone={CalendarClock} onClick={() => onIr("agenda")}>
                {proximos.length === 0 ? (
                  <span className={juntar(texto.auxiliar, "block truncate")}>Nada marcado daqui para a frente.</span>
                ) : (
                  proximos.map((a) => (
                    <span key={a.id} className="flex min-w-0 items-baseline justify-between">
                      <span className={juntar(texto.corpo, "mr-2 min-w-0 truncate")}>
                        {a.title}
                        {nomeDoLead(a.lead_id) ? <span className="text-muted-foreground"> · {nomeDoLead(a.lead_id)}</span> : null}
                      </span>
                      <span className={juntar(texto.auxiliar, "shrink-0 tabular-nums")}>{quando(a.due_at)}</span>
                    </span>
                  ))
                )}
              </Bloco>

              <Bloco titulo="Metas" icone={Target} onClick={() => onIr("metas")}>
                <span className="grid min-w-0 gap-x-6 gap-y-2 sm:grid-cols-2 xl:grid-cols-3">
                  {linhasDeMeta.map((linha) => (
                    <span key={linha.id} className="block min-w-0">
                      <span className="flex min-w-0 items-baseline justify-between text-[12px] leading-4">
                        <span className="mr-2 min-w-0 truncate text-muted-foreground">{linha.label}</span>
                        <span className="shrink-0 tabular-nums text-foreground">
                          {mostrar(linha, linha.feito)}
                          {linha.alvo > 0 ? (
                            <span className="text-muted-foreground"> de {mostrar(linha, linha.alvo)}</span>
                          ) : (
                            <span className="text-muted-foreground"> · sem meta</span>
                          )}
                        </span>
                      </span>
                      {linha.alvo > 0 && <BarraDeProgresso feito={linha.feito} alvo={linha.alvo} fina />}
                    </span>
                  ))}
                </span>
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
              </Bloco>

              <Bloco titulo="Marketing" icone={Sparkles} onClick={() => onIr("marketing")}>
                <span className={juntar(texto.auxiliar, "block truncate")}>No ar, próximos e origem dos leads</span>
              </Bloco>
            </ul>
          </Painel>
        )}
      </div>
    </AreaDeTrabalho>
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
    <li className="min-w-0">
      <button
        type="button"
        onClick={onClick}
        aria-label={`Abrir ${titulo}`}
        className={juntar("group grid w-full min-w-0 grid-cols-[minmax(0,1fr)_16px] items-start gap-x-3 px-4 py-3 text-left transition-colors hover:bg-muted/40 md:grid-cols-[160px_minmax(0,1fr)_16px]", foco)}
      >
        <span className="flex min-w-0 items-center text-[13px] font-semibold leading-5 text-foreground">
          <Icone className="mr-2 h-4 w-4 shrink-0 text-primary" />
          {titulo}
        </span>
        <ArrowRight className="mt-0.5 h-3.5 w-3.5 text-muted-foreground transition-transform group-hover:translate-x-0.5 md:order-last" aria-hidden="true" />
        <span className="col-span-2 mt-1.5 block min-w-0 space-y-1.5 md:col-span-1 md:mt-0">{children}</span>
      </button>
    </li>
  );
}

function Linha({ forte, fraca }: { forte: string; fraca: string }) {
  return (
    <span className="flex min-w-0 items-baseline justify-between">
      <span className="mr-2 min-w-0 truncate text-[13px] font-medium text-foreground">{forte}</span>
      <span className={juntar(texto.auxiliar, "shrink-0")}>{fraca}</span>
    </span>
  );
}

function BarraDeProgresso({ feito, alvo, fina = false }: { feito: number; alvo: number; fina?: boolean }) {
  const pct = alvo > 0 ? Math.min(feito / alvo, 1) : 0;
  return (
    <span className={juntar("mt-1 block overflow-hidden rounded-full bg-muted", fina ? "h-1" : "h-1.5")}>
      <span
        className={juntar("block h-full rounded-full transition-all", feito >= alvo ? "bg-success" : "bg-primary")}
        style={{ width: `${Math.round(pct * 100)}%` }}
      />
    </span>
  );
}

/* ──────────────────────────────── Metas ─────────────────────────────────── */

function Metas({
  periodo,
  metas,
  leads,
  receita,
  clientesRecorrentes,
  carregando,
  onSalvo,
}: {
  periodo: string;
  metas: Array<{ id: string; metric: string; target: number }>;
  leads: Lead[];
  receita: number;
  clientesRecorrentes: number;
  carregando: boolean;
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
    <AreaDeTrabalho rotuloDoPrincipal="Metas do mês" memoriaDaRolagem="comercial:metas">
      {carregando ? (
        <Carregando rotulo="Carregando as metas" linhas={5} />
      ) : (
        <Painel semEspaco as="section" aria-label="Metas do mês">
          <ul className="divide-y divide-border">
            {METRICAS.map((metrica) => {
              const meta = metas.find((m) => m.metric === metrica.id);
              const feito = realizadoDoMes({
                metrica: metrica.id,
                leads,
                periodo,
                receitaFinanceiro: receita,
                clientesRecorrentes,
              });
              const alvo = meta?.target || 0;
              const mostrar = (v: number) =>
                metrica.dinheiro ? dinheiro(v) : String(Math.round(v));
              const aberta = editando === metrica.id;
              return (
                <li key={metrica.id} className="min-w-0 px-4 py-3">
                  <div className="flex min-w-0 items-center">
                    <div className="mr-3 min-w-0 flex-1">
                      <p className={juntar(texto.corpo, "truncate font-medium")}>{metrica.label}</p>
                      {/* De onde vem o número: sem isto, "por que está assim?"
                          não tem resposta na própria tela. */}
                      <p className={juntar(texto.auxiliar, "truncate")}>{metrica.fonte}</p>
                    </div>
                    <p className="shrink-0 text-right">
                      <span className="text-[15px] font-semibold tabular-nums text-foreground">{mostrar(feito)}</span>
                      <span className={juntar(texto.auxiliar, "tabular-nums")}>{alvo > 0 ? ` de ${mostrar(alvo)}` : " · sem meta"}</span>
                    </p>
                    {!aberta && (
                      <button
                        type="button"
                        onClick={() => {
                          setEditando(metrica.id);
                          setValor(alvo > 0 ? String(alvo) : "");
                        }}
                        aria-label={alvo > 0 ? `Alterar meta de ${metrica.label}` : `Definir meta de ${metrica.label}`}
                        className={juntar(botao.discreto, "ml-2 h-8")}
                      >
                        <Pencil className="h-3.5 w-3.5 sm:mr-1" aria-hidden="true" />
                        <span className="hidden sm:inline">{alvo > 0 ? "Alterar" : "Definir"}</span>
                      </button>
                    )}
                  </div>

                  {alvo > 0 && <BarraDeProgresso feito={feito} alvo={alvo} />}

                  {aberta && (
                    <form
                      className="mt-2.5 flex min-w-0 items-center"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void salvar(metrica.id);
                      }}
                    >
                      <input
                        type="number"
                        min="0"
                        step={metrica.dinheiro ? "100" : "1"}
                        value={valor}
                        onChange={(e) => setValor(e.target.value)}
                        placeholder={metrica.dinheiro ? "Alvo em R$" : "Alvo"}
                        aria-label={`Alvo de ${metrica.label}`}
                        className={juntar(campo, "mr-2 sm:max-w-[220px]")}
                        autoFocus
                      />
                      <button type="submit" className={botao.primario}>
                        Salvar
                      </button>
                      <button type="button" onClick={() => setEditando(null)} className={juntar(botao.icone, "ml-1")} aria-label="Cancelar">
                        <X className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </form>
                  )}
                </li>
              );
            })}
          </ul>
        </Painel>
      )}
    </AreaDeTrabalho>
  );
}

/* ─────────────────────────────── Campanhas ──────────────────────────────── */

function Marketing({
  campanhas,
  leads,
  carregando,
  onNova,
  onEditar,
  onArquivar,
}: {
  campanhas: Campanha[];
  leads: Lead[];
  carregando: boolean;
  onNova: () => void;
  onEditar: (c: Campanha) => void;
  onArquivar: (id: string) => void;
}) {
  return (
    <AreaDeTrabalho rotuloDoPrincipal="Campanhas" memoriaDaRolagem="comercial:campanhas">
      {carregando ? (
        <Carregando rotulo="Carregando as campanhas" linhas={4} />
      ) : campanhas.length === 0 ? (
        <EstadoVazio
          icone={<Megaphone className="h-5 w-5" />}
          titulo="Nenhuma campanha registrada"
          descricao="O que a casa investe para aparecer, e quantos leads e contratos aquilo virou."
          acao={
            <button type="button" onClick={onNova} className={botao.secundario}>
              Nova campanha
            </button>
          }
        />
      ) : (
        <Painel semEspaco as="section" aria-label="Campanhas">
          {/* Cabeçalho da tabela (do md para cima); no celular cada linha empilha. */}
          <div className="hidden grid-cols-[minmax(0,1fr)_repeat(4,110px)_96px] items-center gap-x-2 border-b border-border px-4 py-2 md:grid" aria-hidden="true">
            <span className={texto.rotulo}>Campanha</span>
            <span className={juntar(texto.rotulo, "text-right")}>Investido</span>
            <span className={juntar(texto.rotulo, "text-right")}>Leads</span>
            <span className={juntar(texto.rotulo, "text-right")}>Custo por lead</span>
            <span className={juntar(texto.rotulo, "text-right")}>Custo por cliente</span>
            <span />
          </div>
          <ul className="divide-y divide-border">
            {campanhas.map((campanha) => {
              const kpi = kpisDaCampanha(campanha, leads);
              const numeros = [
                { rotulo: "Investido", valor: dinheiro(kpi.investido) },
                { rotulo: "Leads", valor: String(kpi.leads) },
                { rotulo: "Custo por lead", valor: kpi.custoPorLead == null ? "sem dado" : dinheiro(kpi.custoPorLead) },
                { rotulo: "Custo por cliente", valor: kpi.custoPorCliente == null ? "sem dado" : dinheiro(kpi.custoPorCliente) },
              ];
              const ganhos =
                kpi.ganhos > 0
                  ? `${kpi.ganhos} ${kpi.ganhos === 1 ? "contrato fechado" : "contratos fechados"} · ${dinheiro(kpi.mrrGanho)}/mês${
                      kpi.entradaGanha > 0 ? ` + ${dinheiro(kpi.entradaGanha)} de entrada` : ""
                    }${
                      /* Contrato que dura se paga em doze meses; medir só o
                         primeiro faria toda campanha parecer prejuízo. */
                      kpi.retornoAnual != null ? ` · devolve ${kpi.retornoAnual.toFixed(1)}× no primeiro ano` : ""
                    }`
                  : null;
              return (
                <li key={campanha.id} className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 px-4 py-3 md:grid-cols-[minmax(0,1fr)_repeat(4,110px)_96px]">
                  <button type="button" onClick={() => onEditar(campanha)} className={juntar("min-w-0 rounded-sm text-left", foco)} aria-label={`Editar campanha ${campanha.name}`}>
                    <span className={juntar(texto.corpo, "block truncate font-medium hover:underline")}>{campanha.name}</span>
                    <span className={juntar(texto.auxiliar, "block truncate")}>
                      {campanha.channel} · {campanha.status}
                    </span>
                    {ganhos && (
                      <span className="block truncate text-[12px] leading-4 text-success" title={ganhos}>
                        {ganhos}
                      </span>
                    )}
                  </button>
                  {numeros.map((n) => (
                    <span key={n.rotulo} className="hidden text-right text-[13px] tabular-nums text-foreground md:block">
                      {n.valor}
                    </span>
                  ))}
                  <span className="flex justify-end md:order-none">
                    <button type="button" onClick={() => onArquivar(campanha.id)} className={juntar(botao.discreto, "h-8")} aria-label={`Arquivar campanha ${campanha.name}`}>
                      <Archive className="h-3.5 w-3.5 sm:mr-1" aria-hidden="true" />
                      <span className="hidden sm:inline">Arquivar</span>
                    </button>
                  </span>
                  {/* Celular: os quatro números numa grade embaixo do nome. */}
                  <dl className="col-span-2 mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 md:hidden">
                    {numeros.map((n) => (
                      <div key={n.rotulo} className="min-w-0">
                        <dt className={texto.rotulo}>{n.rotulo}</dt>
                        <dd className="truncate text-[13px] tabular-nums text-foreground">{n.valor}</dd>
                      </div>
                    ))}
                  </dl>
                </li>
              );
            })}
          </ul>
        </Painel>
      )}
    </AreaDeTrabalho>
  );
}

/* ───────────────────────────── Editor de lead ───────────────────────────── */

type FormDoLead = {
  name: string;
  company: string;
  email: string;
  whatsapp: string;
  origin: string;
  campaign_id: string;
  monthly_value: string;
  one_off_value: string;
  expected_close_date: string;
  owner_id: string;
  notes: string;
  classe: string;
  qualificacao: Record<string, string>;
  org: Record<CampoDaEmpresa, string>;
};

function EditorDeLead({
  lead,
  campanhas,
  equipe,
  empresas,
  onFechar,
  onSalvo,
}: {
  lead: Lead | null;
  campanhas: Campanha[];
  equipe: Array<{ id: string; nome: string }>;
  empresas: Empresa[];
  onFechar: () => void;
  onSalvo: () => Promise<unknown>;
}) {
  const empresaDoLead = lead?.organization_id ? empresas.find((e) => e.id === lead.organization_id) ?? null : null;
  const formDoBanco = (): FormDoLead => ({
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
    classe: lead?.classe || "",
    qualificacao: { ...(lead?.qualificacao || {}) } as Record<string, string>,
    org: Object.fromEntries(
      CAMPOS_DA_EMPRESA.map((campo) => [campo.id, String((empresaDoLead as unknown as Record<string, unknown> | null)?.[campo.id] ?? "")]),
    ) as Record<CampoDaEmpresa, string>,
  });
  // Lead NOVO: o que foi digitado e não criado volta ao reabrir (rascunho no
  // navegador). Lead que já existe não usa rascunho: fechar já salva, e um
  // rascunho velho por cima do banco apagaria o que o agente/MCP gravou.
  const [rascunhoNovo, setRascunhoNovo, esquecerRascunhoNovo] = useEstadoDoComercial<FormDoLead | null>("rascunho:lead:novo", null, {
    validar: (v) => !!v && typeof v === "object",
    esperaMs: 300,
  });
  const [form, setFormNaTela] = useState<FormDoLead>(() => {
    const base = formDoBanco();
    if (lead || !rascunhoNovo) return base;
    return {
      ...base,
      ...rascunhoNovo,
      qualificacao: { ...base.qualificacao, ...(rascunhoNovo.qualificacao || {}) },
      org: { ...base.org, ...(rascunhoNovo.org || {}) },
    };
  });
  const setForm = (novo: FormDoLead) => {
    setFormNaTela(novo);
    if (!lead) setRascunhoNovo(novo);
  };
  const [apagando, setApagando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [nota, setNota, esquecerNota] = useEstadoDoComercial(`rascunho:nota:${lead?.id || "novo"}`, "", { validar: ehTexto });
  const [motivo, setMotivo] = useEstadoDoComercial(`rascunho:motivo:${lead?.id || "novo"}`, "", { validar: ehTexto });
  // O que estava no banco quando o editor abriu: e contra isto que se sabe se
  // ha edicao por salvar (a barra de salvar avisa, e fechar nao perde nada).
  const [formInicial] = useState(() => JSON.stringify(formDoBanco()));
  const sujo = JSON.stringify(form) !== formInicial;

  const { data: historico = [] } = useQuery({
    queryKey: ["comercial-historico", lead?.id],
    queryFn: () => historicoDoLead(lead!.id),
    enabled: Boolean(lead?.id),
  });

  const salvar = async (opcoes?: { manterAberto?: boolean }) => {
    if (form.name.trim().length < 2) {
      toast.error("O lead precisa de um nome.");
      return false;
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
      classe: form.classe || null,
      qualificacao: form.qualificacao,
    } as never);
    setSalvando(false);
    if (!id) {
      toast.error(`Não foi possível salvar o lead.${ultimoErroDoComercial() ? ` ${ultimoErroDoComercial()}` : ""}`);
      return false;
    }
    // A ficha da empresa ja existe a esta altura (o banco a cria ao gravar o
    // lead). Vai para ela so o campo que mudou.
    const inicialDaEmpresa = (JSON.parse(formInicial) as typeof form).org;
    const mudouNaEmpresa = Object.fromEntries(
      Object.entries(form.org).filter(([campo, valor]) => valor !== inicialDaEmpresa[campo as CampoDaEmpresa]),
    ) as Partial<Record<CampoDaEmpresa, string>>;
    if (Object.keys(mudouNaEmpresa).length > 0 && !(await salvarDadosDaEmpresaDoLead(id, mudouNaEmpresa))) {
      toast.error(`O lead foi salvo, mas os dados da empresa não.${ultimoErroDoComercial() ? ` ${ultimoErroDoComercial()}` : ""}`);
    }
    if (!lead) esquecerRascunhoNovo();
    await onSalvo();
    toast.success(lead ? "Alterações salvas." : "Lead criado.");
    if (!opcoes?.manterAberto) onFechar();
    return true;
  };

  // Fechar com edicao pendente salva sozinho: a pessoa editava, fechava no X
  // e a edicao sumia sem aviso (o botao de salvar ficava no meio da janela).
  const fechar = async () => {
    if (lead && sujo && !salvando) {
      const ok = await salvar();
      if (!ok) return;
      return;
    }
    onFechar();
  };

  const mover = async (para: EstagioId) => {
    if (!lead) return;
    if (para === "perdido" && motivo.trim().length < 3) {
      toast.error("Diga em uma linha por que foi perdido. É o que ensina o próximo.");
      return;
    }
    if (await moverLead({ lead, paraEstagio: para, motivo })) {
      setMotivo("");
      await onSalvo();
      toast.success(`Movido para ${rotuloDoEstagio(para)}.`);
      onFechar();
    } else toast.error("Não foi possível mover.");
  };

  const temDadosDaEmpresa = Object.values(form.org).some(Boolean);

  return (
    <Dialog open onOpenChange={(aberto) => { if (!aberto) void fechar(); }}>
      {/* Sem espaço embaixo: a barra de salvar gruda rente ao pé da janela. */}
      <DialogContent className="max-h-[92vh] w-[calc(100vw-1.5rem)] max-w-2xl overflow-y-auto pb-0">
        <DialogHeader>
          <DialogTitle className="truncate pr-6 text-[15px]">{lead ? lead.name : "Novo lead"}</DialogTitle>
          {lead && <p className={texto.auxiliar}>{rotuloDoEstagio(lead.stage)}{lead.company ? ` · ${lead.company}` : ""}</p>}
        </DialogHeader>

        <div className="min-w-0 space-y-5">
          <GrupoDeCampos>
            <CampoDeFormulario rotulo="Nome" obrigatorio>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={campo} />
            </CampoDeFormulario>
            <CampoDeFormulario rotulo="Empresa" ajuda="A ficha da empresa nasce sozinha no banco quando este campo está preenchido.">
              <input value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} className={campo} />
            </CampoDeFormulario>
            <CampoDeFormulario rotulo="E-mail">
              <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className={campo} />
            </CampoDeFormulario>
            <CampoDeFormulario rotulo="WhatsApp">
              <input value={form.whatsapp} onChange={(e) => setForm({ ...form, whatsapp: e.target.value })} className={campo} />
            </CampoDeFormulario>
          </GrupoDeCampos>

          {/* A ficha da empresa nasce sozinha quando "Empresa" esta preenchida;
              aqui se completa o contexto dela sem sair do lead. Campo proprio
              e o que deixa achar depois; "Notas" vira deposito. */}
          {form.company.trim().length > 1 && (
            <details className="group min-w-0 border-t border-border pt-4" open={temDadosDaEmpresa}>
              <summary className={juntar("flex cursor-pointer list-none items-center rounded-sm", foco)}>
                <ChevronRight className="mr-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" aria-hidden="true" />
                <span className={juntar(texto.tituloSecao, "min-w-0 truncate text-[14px]")}>
                  Dados da empresa · <span className="font-normal text-muted-foreground">{empresaDoLead ? "ficha ligada" : "a ficha é criada ao salvar"}</span>
                </span>
              </summary>
              <GrupoDeCampos className="mt-3">
                {CAMPOS_DA_EMPRESA.map((campoDaEmpresa) => (
                  <CampoDeFormulario key={campoDaEmpresa.id} rotulo={campoDaEmpresa.label}>
                    <input
                      value={form.org[campoDaEmpresa.id] || ""}
                      onChange={(e) => setForm({ ...form, org: { ...form.org, [campoDaEmpresa.id]: e.target.value } })}
                      placeholder={campoDaEmpresa.dica}
                      className={campo}
                    />
                  </CampoDeFormulario>
                ))}
              </GrupoDeCampos>
            </details>
          )}

          <GrupoDeCampos titulo="Negócio" className="border-t border-border pt-4">
            {/* A classe é a primeira pergunta: com quem estamos falando. O
                vazio é "não confirmado" de propósito, nunca preenchido por
                padrão: classe chutada mente melhor que campo em branco. */}
            <CampoDeFormulario rotulo="Classe da oportunidade">
              <select
                value={form.classe || "nao_confirmado"}
                onChange={(e) => setForm({ ...form, classe: e.target.value === "nao_confirmado" ? "" : e.target.value })}
                className={campo}
              >
                <option value="nao_confirmado">não confirmado</option>
                {CLASSES_DO_LEAD.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            </CampoDeFormulario>
            {/* Dono e data prevista: sem o primeiro, dois ligam para o mesmo
                lead ou nenhum liga; sem o segundo, não existe previsão, só
                a soma do funil inteiro, inclusive o que fecha ano que vem. */}
            <CampoDeFormulario rotulo="Dono">
              <select
                value={form.owner_id || "ninguem"}
                onChange={(e) => setForm({ ...form, owner_id: e.target.value === "ninguem" ? "" : e.target.value })}
                className={campo}
              >
                <option value="ninguem">Sem dono</option>
                {equipe.map((pessoa) => (
                  <option key={pessoa.id} value={pessoa.id}>
                    {pessoa.nome}
                  </option>
                ))}
              </select>
            </CampoDeFormulario>
            {/* Separados porque é assim que a casa vende: somar os dois faria
                a meta de mensalidade nova mentir sempre que houvesse projeto. */}
            <CampoDeFormulario rotulo="Mensalidade (R$)">
              <input type="number" min="0" step="50" value={form.monthly_value} onChange={(e) => setForm({ ...form, monthly_value: e.target.value })} className={campo} />
            </CampoDeFormulario>
            <CampoDeFormulario rotulo="Entrada / projeto (R$)">
              <input type="number" min="0" step="50" value={form.one_off_value} onChange={(e) => setForm({ ...form, one_off_value: e.target.value })} className={campo} />
            </CampoDeFormulario>
            <CampoDeFormulario rotulo="Previsão de fechamento">
              <input type="date" value={form.expected_close_date} onChange={(e) => setForm({ ...form, expected_close_date: e.target.value })} className={campo} />
            </CampoDeFormulario>
            <CampoDeFormulario rotulo="Origem">
              <select value={form.origin} onChange={(e) => setForm({ ...form, origin: e.target.value })} className={campo}>
                {ORIGENS.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            </CampoDeFormulario>
            <CampoDeFormulario rotulo="Campanha" largo>
              <select
                value={form.campaign_id || "nenhuma"}
                onChange={(e) => setForm({ ...form, campaign_id: e.target.value === "nenhuma" ? "" : e.target.value })}
                className={campo}
              >
                <option value="nenhuma">Nenhuma</option>
                {campanhas.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </CampoDeFormulario>
          </GrupoDeCampos>

          <GrupoDeCampos titulo="Qualificação" descricao="vazio significa não confirmado" className="border-t border-border pt-4">
            {CAMPOS_DE_QUALIFICACAO.map((campoDeQualificacao) => (
              <CampoDeFormulario key={campoDeQualificacao.id} rotulo={campoDeQualificacao.label}>
                {/* Area de texto: qualificacao boa e frase inteira, nao palavra. */}
                <textarea
                  value={form.qualificacao[campoDeQualificacao.id] || ""}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      qualificacao: {
                        ...form.qualificacao,
                        [campoDeQualificacao.id]: e.target.value,
                      },
                    })
                  }
                  placeholder={campoDeQualificacao.dica}
                  rows={2}
                  className={juntar(campoTexto, "min-h-[60px] resize-y")}
                />
              </CampoDeFormulario>
            ))}
          </GrupoDeCampos>

          <GrupoDeCampos colunas={1} className="border-t border-border pt-4">
            <CampoDeFormulario rotulo="Notas">
              <textarea
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                rows={5}
                placeholder="O que não coube nos campos acima: histórico, observações, rascunho de abordagem"
                className={juntar(campoTexto, "resize-y")}
              />
            </CampoDeFormulario>
          </GrupoDeCampos>

          {lead && (
            <>
              {/* Frente PRO: a proposta deste lead na Mesa Proposta (com o cliente quando o lead já tem ficha). */}
              <section className="flex min-w-0 items-center justify-between border-t border-border pt-4" aria-label="Proposta">
                <h3 className={juntar(texto.tituloSecao, "min-w-0 truncate")}>Proposta</h3>
                <Link
                  to={`/mesa-proposta?lead=${encodeURIComponent(lead.id)}${lead.won_client_id ? `&client=${encodeURIComponent(lead.won_client_id)}` : ""}&etapa=contexto`}
                  className={botao.secundario}
                >
                  Gerar proposta
                </Link>
              </section>
              <section className="border-t border-border pt-4" aria-label="Mover de etapa">
                <h3 className={juntar(texto.tituloSecao, "mb-2")}>Mover para</h3>
                <div className="-m-1 flex flex-wrap [&>*]:m-1">
                  {ESTAGIOS.filter((e) => e.id !== lead.stage).map((estagio) => (
                    <button
                      key={estagio.id}
                      type="button"
                      onClick={() => void mover(estagio.id as EstagioId)}
                      title={estagio.ajuda}
                      className={juntar(
                        "inline-flex h-8 items-center rounded-md border px-2.5 text-[12.5px] font-medium transition-colors",
                        foco,
                        estagio.id === "ganho"
                          ? "border-success/40 text-success hover:bg-success/10"
                          : estagio.id === "perdido"
                            ? "border-destructive/40 text-destructive hover:bg-destructive/10"
                            : "border-border text-muted-foreground hover:bg-muted hover:text-foreground",
                      )}
                    >
                      <ArrowRight className="mr-1 h-3 w-3" aria-hidden="true" />
                      {estagio.label}
                    </button>
                  ))}
                </div>
                {/* Motivo da perda é o único campo que ensina o próximo lead. */}
                <input
                  value={motivo}
                  onChange={(e) => setMotivo(e.target.value)}
                  placeholder="Motivo (obrigatório para marcar como perdido)"
                  aria-label="Motivo da perda"
                  className={juntar(campo, "mt-2")}
                />
              </section>

              <AtividadesDoLead
                leadId={lead.id}
                donoPadrao={lead.owner_id}
                onMudou={() => void onSalvo()}
              />

              <section className="border-t border-border pt-4" aria-label="História do lead">
                <h3 className={juntar(texto.tituloSecao, "mb-2")}>História</h3>
                <form
                  className="flex min-w-0 items-center"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    if (await anotarNoLead(lead.id, nota)) {
                      esquecerNota();
                      toast.success("Anotado.");
                    } else toast.error("Escreva um pouco mais.");
                  }}
                >
                  <input
                    value={nota}
                    onChange={(e) => setNota(e.target.value)}
                    placeholder="Registrar uma conversa…"
                    aria-label="Registrar uma conversa"
                    className={juntar(campo, "mr-2")}
                  />
                  <button type="submit" className={botao.secundario}>
                    Anotar
                  </button>
                </form>
                {historico.length === 0 ? (
                  <p className={juntar(texto.auxiliar, "mt-2")}>Nada registrado ainda.</p>
                ) : (
                  <ul className="mt-2 divide-y divide-border">
                    {historico.map((evento) => (
                      <li key={evento.id} className={juntar(texto.corpo, "py-2 text-muted-foreground")}>
                        <span className="font-medium text-foreground">
                          {evento.kind === "stage"
                            ? `${rotuloDoEstagio(evento.from_stage || "")} → ${rotuloDoEstagio(evento.to_stage || "")}`
                            : "Nota"}
                        </span>
                        {evento.note ? ` · ${evento.note}` : ""}
                        <span className="ml-1.5 text-[12px] tabular-nums opacity-70">
                          {new Date(evento.created_at).toLocaleDateString("pt-BR")}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </>
          )}

          {/* Barra de salvar grudada no pe da janela: aparece em qualquer ponto
              da rolagem e diz quando ha edicao por salvar. Apagar, arquivar e
              perder (em "Mover para") são três coisas diferentes. */}
          <div className="sticky bottom-0 z-10 -mx-6 flex min-w-0 flex-wrap items-center border-t border-border bg-background/95 px-6 py-3 backdrop-blur [&>*]:my-0.5">
            {lead && (
              // Apagar pede dois toques: o primeiro arma, o segundo apaga. Some
              // com o lead, a agenda e a historia dele; a ficha da empresa fica.
              <button
                type="button"
                onClick={async () => {
                  if (!apagando) { setApagando(true); return; }
                  if (await apagarLead(lead.id)) {
                    await onSalvo();
                    toast.success("Lead apagado.");
                    onFechar();
                  } else {
                    setApagando(false);
                    toast.error(`Não foi possível apagar.${ultimoErroDoComercial() ? ` ${ultimoErroDoComercial()}` : ""}`);
                  }
                }}
                onBlur={() => setApagando(false)}
                className={apagando ? juntar(botao.primario, "mr-2 bg-destructive text-destructive-foreground hover:bg-destructive/90") : juntar(botao.perigo, "mr-2")}
              >
                {apagando ? "Confirmar apagar" : "Apagar"}
              </button>
            )}
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
                className={botao.secundario}
              >
                Arquivar
              </button>
            )}
            {!lead && sujo && (
              <button
                type="button"
                onClick={() => {
                  esquecerRascunhoNovo();
                  setFormNaTela(formDoBanco());
                }}
                className={botao.discreto}
              >
                Limpar
              </button>
            )}
            <button
              type="button"
              onClick={() => void salvar()}
              disabled={salvando}
              className={juntar(botao.primario, "ml-auto")}
            >
              {salvando ? "Salvando…" : lead ? (sujo ? "Salvar alterações •" : "Salvar alterações") : "Criar lead"}
            </button>
          </div>
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
  const base = {
    name: campanha?.name || "",
    channel: campanha?.channel || "meta",
    status: campanha?.status || "ativa",
    starts_on: campanha?.starts_on || "",
    ends_on: campanha?.ends_on || "",
    budget: String(campanha?.budget || ""),
    spent: String(campanha?.spent || ""),
    goal: campanha?.goal || "",
  };
  // Campanha NOVA: o que foi digitado e não salvo volta ao reabrir.
  const [rascunhoNovo, setRascunhoNovo, esquecerRascunhoNovo] = useEstadoDoComercial<typeof base | null>("rascunho:campanha:nova", null, {
    validar: (v) => !!v && typeof v === "object",
    esperaMs: 300,
  });
  const [form, setFormNaTela] = useState(() => (!campanha && rascunhoNovo ? { ...base, ...rascunhoNovo } : base));
  const setForm = (novo: typeof base) => {
    setFormNaTela(novo);
    if (!campanha) setRascunhoNovo(novo);
  };
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
    if (!campanha) esquecerRascunhoNovo();
    await onSalvo();
    toast.success("Campanha salva.");
    onFechar();
  };

  return (
    <Dialog open onOpenChange={(aberto) => !aberto && onFechar()}>
      <DialogContent className="max-h-[92vh] w-[calc(100vw-1.5rem)] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="truncate pr-6 text-[15px]">{campanha ? campanha.name : "Nova campanha"}</DialogTitle>
        </DialogHeader>
        <GrupoDeCampos>
          <CampoDeFormulario rotulo="Nome" obrigatorio largo>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={campo} />
          </CampoDeFormulario>
          <CampoDeFormulario rotulo="Canal">
            <select value={form.channel} onChange={(e) => setForm({ ...form, channel: e.target.value })} className={campo}>
              {CANAIS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </CampoDeFormulario>
          <CampoDeFormulario rotulo="Situação">
            <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className={campo}>
              <option value="planejada">planejada</option>
              <option value="ativa">ativa</option>
              <option value="encerrada">encerrada</option>
            </select>
          </CampoDeFormulario>
          <CampoDeFormulario rotulo="Orçamento (R$)">
            <input type="number" min="0" value={form.budget} onChange={(e) => setForm({ ...form, budget: e.target.value })} className={campo} />
          </CampoDeFormulario>
          <CampoDeFormulario rotulo="Investido (R$)">
            <input type="number" min="0" value={form.spent} onChange={(e) => setForm({ ...form, spent: e.target.value })} className={campo} />
          </CampoDeFormulario>
          <CampoDeFormulario rotulo="Início">
            <input type="date" value={form.starts_on} onChange={(e) => setForm({ ...form, starts_on: e.target.value })} className={campo} />
          </CampoDeFormulario>
          <CampoDeFormulario rotulo="Fim">
            <input type="date" value={form.ends_on} onChange={(e) => setForm({ ...form, ends_on: e.target.value })} className={campo} />
          </CampoDeFormulario>
          <CampoDeFormulario rotulo="Objetivo" largo>
            <input value={form.goal} onChange={(e) => setForm({ ...form, goal: e.target.value })} placeholder="O que esta campanha precisa entregar" className={campo} />
          </CampoDeFormulario>
        </GrupoDeCampos>
        <div className="flex items-center justify-end [&>*+*]:ml-2">
          <button type="button" onClick={onFechar} className={botao.secundario}>
            Cancelar
          </button>
          <button type="button" onClick={() => void salvar()} disabled={salvando} className={botao.primario}>
            Salvar campanha
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
