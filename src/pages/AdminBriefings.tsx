import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { notifyOpsMilestone } from "@/lib/opsSync";
import { useAuth } from "@/contexts/AuthContext";
import { useClients } from "@/hooks/useSupabaseData";
import { toast } from "sonner";
import { format } from "date-fns";
import { ArchiveRestore, ArrowLeft, BellRing, Columns2, FileText, Filter, Link2, Loader2, Search } from "lucide-react";
import GerarLinkDoBriefing from "@/components/briefing/GerarLinkDoBriefing";
import LeituraDoBriefing, { type LinhaDoBriefingNoPainel, nomeDoBriefing } from "@/components/briefing/LeituraDoBriefing";
import ComparacaoDeBriefings from "@/components/briefing/ComparacaoDeBriefings";
import EditorDeModelos from "@/components/briefing/EditorDeModelos";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AreaDeTrabalho,
  BarraDeControles,
  CabecalhoDePagina,
  CampoDeBusca,
  CampoDeFormulario,
  Carregando,
  EstadoDeErro,
  EstadoVazio,
  MenuMais,
  RegiaoRolavel,
  SeletorCompacto,
  botao,
  campo,
  etiqueta,
  juntar,
  lista,
  texto,
  useEstadoDaTela,
} from "@/components/sistema";
import { chamarAgenteDoBriefing, consultaSolta, ehErroDeColuna, textoDoErroDoBriefing } from "@/lib/briefing/api";
import { type AnexoDoBriefing, modeloDeFabrica, modeloDoLink, progressoDoBriefing } from "../../supabase/functions/_shared/briefing-modelos";
import { precisaDeLembrete, situacaoNoPainel, type SituacaoNoPainel } from "../../supabase/functions/briefing-agente/modulos/briefing-editor";

/**
 * Briefings (frente BRF, 30/09/2026; painel e modelos na frente BRF2;
 * simplificada na frente UXS): todos os links, de todos os modelos, numa
 * barra só (busca por cliente ou título e o filtro com o número de cada
 * estado), com Vencendo e Pediram reabertura à vista quando têm links, o
 * andamento de cada link (o mesmo número da leitura), quem pede lembrete, a
 * comparação de dois briefings (Comparar no "...") e os arquivados, com
 * Desarquivar. Abrir um leva à leitura (/briefings?briefing=<id>), que é
 * também o link do aviso que a equipe recebe. A aba Modelos é o editor das
 * perguntas (versão nova a cada salvar).
 */

type Filtro = "todos" | "pendentes" | "vencendo" | "expirados" | "reabrir" | "recebidos" | "arquivados";
const FILTROS: Array<{ valor: Filtro; rotulo: string }> = [
  { valor: "todos", rotulo: "Todos" },
  { valor: "pendentes", rotulo: "Pendentes" },
  { valor: "vencendo", rotulo: "Vencendo" },
  { valor: "expirados", rotulo: "Expirados" },
  { valor: "reabrir", rotulo: "Pediram reabertura" },
  { valor: "recebidos", rotulo: "Recebidos" },
  { valor: "arquivados", rotulo: "Arquivados" },
];
const VALORES_DO_FILTRO = FILTROS.map((f) => f.valor as string);
/** Tantos links a lista lê de uma vez (os mais recentes). A busca vale para eles. */
const LIMITE_DA_LISTA = 300;

const CAMPOS_DA_LISTA =
  "id, token, client_id, project_id, marca_id, modelo, titulo, responses, submitted, expira_em, enviado_em, envios, reabertura_pedida_em, reabertura_motivo, rascunho_salvo_em, arquivado_em, arquivo_pdf_id, created_at, client:profiles!briefings_client_id_fkey(full_name, company_name)";
/** Colunas da frente BRF2 (lembretes). Sem a migração, a lista segue sem elas. */
const CAMPOS_DE_LEMBRETE = ", lembretes, ultimo_lembrete_em";

type LinhaDaLista = LinhaDoBriefingNoPainel & { rascunho_salvo_em?: string | null; lembretes?: number | null; ultimo_lembrete_em?: string | null; anexos?: AnexoDoBriefing[] };

const ETIQUETA: Record<SituacaoNoPainel, { rotulo: string; classe: string }> = {
  reabrir: { rotulo: "Reabrir", classe: "bg-amber-500/15 text-amber-700 dark:text-amber-300" },
  recebido: { rotulo: "Recebido", classe: "bg-primary/15 text-primary" },
  expirado: { rotulo: "Expirado", classe: "bg-muted text-muted-foreground" },
  vencendo: { rotulo: "Vencendo", classe: "bg-amber-500/15 text-amber-700 dark:text-amber-300" },
  pendente: { rotulo: "Aguardando", classe: "bg-muted text-foreground" },
};

function passaNoFiltro(f: Filtro, s: SituacaoNoPainel): boolean {
  if (f === "todos" || f === "arquivados") return true;
  if (f === "pendentes") return s === "pendente" || s === "vencendo";
  if (f === "vencendo") return s === "vencendo";
  if (f === "expirados") return s === "expirado";
  if (f === "recebidos") return s === "recebido";
  return s === "reabrir";
}

/** Sem acento e em minúsculas, para a busca achar "João" digitando "joao". */
const semAcento = (t: string) => {
  const s = String(t || "").toLowerCase();
  return typeof s.normalize === "function" ? s.normalize("NFD").replace(/[̀-ͯ]/g, "") : s;
};

/**
 * A lista (ativos ou arquivados), com os lembretes numa consulta só. Dos
 * abertos, a cópia do modelo do link e os anexos prontos, para o "3 de 12" da
 * linha ser o mesmo da leitura (que usa as perguntas extras do link). Leitura
 * tolerante: sem a cópia, vale o modelo de fábrica, como antes.
 */
async function lerLista(clienteDaUrl: string | null, arquivados: boolean): Promise<LinhaDaLista[]> {
  const montar = (campos: string) => {
    let q = consultaSolta<LinhaDaLista[]>("briefings").select(campos);
    q = arquivados ? q.not("arquivado_em", "is", null) : q.is("arquivado_em", null);
    q = q.order(arquivados ? "arquivado_em" : "created_at", { ascending: false }).limit(LIMITE_DA_LISTA);
    if (clienteDaUrl) q = q.eq("client_id", clienteDaUrl);
    return q;
  };
  let r = await montar(CAMPOS_DA_LISTA + CAMPOS_DE_LEMBRETE);
  if (r.error && ehErroDeColuna(r.error)) {
    console.warn("[briefings] lembretes indisponíveis:", r.error.message);
    r = await montar(CAMPOS_DA_LISTA);
  }
  if (r.error) throw r.error;
  const linhas = r.data || [];
  const abertos = arquivados ? [] : linhas.filter((b) => !b.submitted).map((b) => b.id).slice(0, 200);
  if (abertos.length) {
    const [modelos, anexos] = await Promise.all([
      consultaSolta<Array<{ id: string; modelo_conteudo: unknown }>>("briefings").select("id, modelo_conteudo").in("id", abertos),
      consultaSolta<Array<AnexoDoBriefing & { briefing_id: string }>>("briefing_anexos").select("id, briefing_id, campo, categoria").eq("status", "pronto").is("arquivado_em", null).in("briefing_id", abertos),
    ]);
    if (modelos.error) console.warn("[briefings] modelo dos links indisponível:", modelos.error.message);
    if (anexos.error) console.warn("[briefings] anexos indisponíveis:", anexos.error.message);
    const conteudo: Record<string, unknown> = {};
    (modelos.data || []).forEach((m) => (conteudo[m.id] = m.modelo_conteudo));
    const porBriefing: Record<string, AnexoDoBriefing[]> = {};
    (anexos.data || []).forEach((a) => (porBriefing[a.briefing_id] = (porBriefing[a.briefing_id] || []).concat(a)));
    linhas.forEach((b) => {
      if (b.submitted) return;
      b.modelo_conteudo = conteudo[b.id];
      b.anexos = porBriefing[b.id] || [];
    });
  }
  return linhas;
}

export default function AdminBriefings() {
  const { user, profile } = useAuth();
  const queryClient = useQueryClient();
  const { data: clients } = useClients();
  const [params, setParams] = useSearchParams();
  const abertoId = params.get("briefing") || params.get("id");
  const clienteDaUrl = params.get("client");
  const aba = params.get("aba") === "modelos" ? "modelos" : "links";
  const comparar = (params.get("comparar") || "").split(",").filter(Boolean);
  // Filtro e busca lembrados por cliente do endereço (SISTEMA.md, "Estado que não se perde").
  const [filtro, setFiltro] = useEstadoDaTela<Filtro>(`briefings:filtro:${clienteDaUrl || "todos"}`, "todos", { validar: (v) => typeof v === "string" && VALORES_DO_FILTRO.indexOf(v) >= 0 });
  const [busca, setBusca] = useEstadoDaTela(`briefings:busca:${clienteDaUrl || "todos"}`, "");
  const [selecionando, setSelecionando] = useState(false);
  const [selecionados, setSelecionados] = useState<string[]>([]);
  const [desarquivando, setDesarquivando] = useState<string | null>(null);
  const [modelosMudou, setModelosMudou] = useState(false);
  const [novoLink, setNovoLink] = useState(false);
  const [generateBriefing, setGenerateBriefing] = useState<LinhaDoBriefingNoPainel | null>(null);
  const [generating, setGenerating] = useState(false);
  const [genClientId, setGenClientId] = useState("");
  const emArquivados = filtro === "arquivados";

  const { data: briefings, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["briefings-admin", user?.id, clienteDaUrl],
    queryFn: () => lerLista(clienteDaUrl, false),
    enabled: !!user,
  });
  // Arquivados: só consulta quando o filtro está nele.
  const arquivados = useQuery({
    queryKey: ["briefings-admin", "arquivados", user?.id, clienteDaUrl],
    queryFn: () => lerLista(clienteDaUrl, true),
    enabled: !!user && emArquivados,
  });

  const todos = useMemo(() => briefings || [], [briefings]);
  // Uma passada só: a situação de cada link (etiqueta e filtro nunca discordam),
  // quem pede lembrete, o andamento e o número de cada filtro.
  const painel = useMemo(() => {
    const agora = new Date();
    const situacao: Record<string, SituacaoNoPainel> = {};
    const lembrar: Record<string, boolean> = {};
    const progresso: Record<string, { respondidos: number; total: number }> = {};
    const contagem: Record<Filtro, number> = { todos: todos.length, pendentes: 0, vencendo: 0, expirados: 0, reabrir: 0, recebidos: 0, arquivados: 0 };
    let recebidos30 = 0;
    todos.forEach((b) => {
      const s = situacaoNoPainel(b, agora);
      situacao[b.id] = s;
      FILTROS.forEach((f) => {
        if (f.valor !== "todos" && f.valor !== "arquivados" && passaNoFiltro(f.valor, s)) contagem[f.valor] += 1;
      });
      if (s === "recebido" && b.enviado_em) {
        const t = new Date(b.enviado_em).getTime();
        if (!isNaN(t) && agora.getTime() - t <= 30 * 86_400_000) recebidos30 += 1;
      }
      lembrar[b.id] = precisaDeLembrete(b, agora);
      if (!b.submitted) progresso[b.id] = progressoDoBriefing(modeloDoLink(b.modelo, b.modelo_conteudo), (b.responses || {}) as Record<string, unknown>, b.anexos || []);
    });
    return { situacao, lembrar, progresso, contagem, recebidos30 };
  }, [todos]);
  const { contagem } = painel;

  const listaDoFiltro = useMemo(() => (emArquivados ? arquivados.data || [] : todos), [emArquivados, arquivados.data, todos]);
  const termo = semAcento(busca.trim());
  const filtrados = useMemo(
    () =>
      listaDoFiltro.filter((b) => {
        if (!emArquivados && !passaNoFiltro(filtro, painel.situacao[b.id] || "pendente")) return false;
        if (!termo) return true;
        return semAcento(`${nomeDoBriefing(b)} ${b.titulo || ""} ${modeloDeFabrica(b.modelo).nome}`).indexOf(termo) >= 0;
      }),
    [listaDoFiltro, emArquivados, filtro, painel, termo],
  );
  const filtroLigado = filtro !== "todos" || !!termo;
  const limparFiltros = () => {
    setFiltro("todos");
    setBusca("");
  };

  const mudarParams = (mexer: (p: URLSearchParams) => void) => {
    const p = new URLSearchParams(params);
    mexer(p);
    setParams(p);
  };
  const abrir = (id: string | null, lembrete = false) =>
    mudarParams((p) => {
      p.delete("id");
      p.delete("comparar");
      if (id) p.set("briefing", id);
      else p.delete("briefing");
      if (lembrete) p.set("lembrete", "1");
      else p.delete("lembrete");
    });
  const sairDaSelecao = () => {
    setSelecionando(false);
    setSelecionados([]);
  };
  const trocarAba = (v: string) => {
    if (aba === "modelos" && v !== "modelos" && modelosMudou && !window.confirm("Há mudanças não salvas no modelo. Sair mesmo assim?")) return;
    mudarParams((p) => (v === "modelos" ? p.set("aba", "modelos") : p.delete("aba")));
  };

  const desarquivar = async (b: LinhaDaLista) => {
    setDesarquivando(b.id);
    try {
      await chamarAgenteDoBriefing("arquivar", { briefing_id: b.id, arquivar: false });
      toast.success("Briefing de volta à lista.");
      void queryClient.invalidateQueries({ queryKey: ["briefings-admin"] });
      void queryClient.invalidateQueries({ queryKey: ["briefing-leitura", b.id] });
    } catch (e) {
      toast.error(textoDoErroDoBriefing(e, "Não foi possível desarquivar."));
    } finally {
      setDesarquivando(null);
    }
  };

  const handleGenerate = async () => {
    if (!generateBriefing || !genClientId) {
      toast.error("Selecione o cliente");
      return;
    }
    setGenerating(true);
    try {
      const m = modeloDeFabrica(generateBriefing.modelo);
      const r = (generateBriefing.responses || {}) as Record<string, any>;
      const { data: project, error } = await supabase.from("projects").insert({
        name: `Projeto · ${m.nome}`,
        description: String(r.historia || r.companyDescription || r.objetivo || "").slice(0, 500),
        scope: JSON.stringify(r, null, 2),
        project_type: m.slug === "site" || m.slug === "landing" ? "site" : m.slug === "redes" ? "social_media" : "outro",
        client_id: genClientId,
        created_by: user?.id || null,
        start_date: format(new Date(), "yyyy-MM-dd"),
        deadline: format(new Date(Date.now() + 30 * 86400000), "yyyy-MM-dd"),
        status: "planning",
        progress: 0,
      }).select().single();
      if (error) throw error;
      const { data: msIns } = await supabase.from("milestones").insert({
        project_id: project.id, title: "Kick-off",
        target_date: format(new Date(), "yyyy-MM-dd"), status: "completed", milestone_order: 0,
      }).select().single();
      notifyOpsMilestone(msIns);
      await supabase.from("notifications").insert({
        user_id: genClientId,
        message: "Novo projeto criado a partir do seu briefing",
        notification_type: "project", link: "/dashboard",
      });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      toast.success("Projeto criado a partir do briefing.");
      setGenerateBriefing(null);
      setGenClientId("");
    } catch (err: any) {
      toast.error(err?.message || "Erro");
    }
    setGenerating(false);
  };

  const dialogoDoProjeto = (
    <Dialog open={!!generateBriefing} onOpenChange={(v) => { if (!v && !generating) setGenerateBriefing(null); }}>
      <DialogContent className="max-w-[440px]">
        <DialogHeader className="text-left">
          <DialogTitle className={texto.tituloSecao}>Gerar projeto do briefing</DialogTitle>
          <DialogDescription className={texto.auxiliar}>Cria o projeto com o marco de kick-off e avisa o cliente.</DialogDescription>
        </DialogHeader>
        <CampoDeFormulario rotulo="Cliente" obrigatorio>
          <select value={genClientId} onChange={(e) => setGenClientId(e.target.value)} className={campo}>
            <option value="">Selecionar cliente...</option>
            {((clients as any[]) || []).map((c) => <option key={c.id} value={c.id}>{c.company_name || c.full_name}</option>)}
          </select>
        </CampoDeFormulario>
        <DialogFooter className="[&>*+*]:mt-2 sm:[&>*+*]:mt-0">
          <button type="button" onClick={() => setGenerateBriefing(null)} disabled={generating} className={botao.secundario}>Cancelar</button>
          <button type="button" onClick={() => void handleGenerate()} disabled={generating || !genClientId} className={botao.primario}>
            {generating && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
            {generating ? "Criando..." : "Criar projeto"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  if (comparar.length === 2) {
    return (
      <div className="min-w-0 animate-fade-in">
        <button type="button" onClick={() => mudarParams((p) => p.delete("comparar"))} className={juntar(botao.discreto, "-ml-2 mb-3 h-8 px-2 text-[12px]")}>
          <ArrowLeft className="mr-1 h-4 w-4" aria-hidden="true" />
          Briefings
        </button>
        <ComparacaoDeBriefings ids={[comparar[0], comparar[1]]} onVoltar={() => mudarParams((p) => p.delete("comparar"))} />
      </div>
    );
  }

  if (abertoId) {
    return (
      <div className="min-w-0 animate-fade-in">
        <button type="button" onClick={() => abrir(null)} className={juntar(botao.discreto, "-ml-2 mb-3 h-8 px-2 text-[12px]")}>
          <ArrowLeft className="mr-1 h-4 w-4" aria-hidden="true" />
          Briefings
        </button>
        <LeituraDoBriefing briefingId={abertoId} abrirLembrete={params.get("lembrete") === "1"} onGerarProjeto={(b) => { setGenerateBriefing(b); setGenClientId(b.client_id || ""); }} />
        {dialogoDoProjeto}
      </div>
    );
  }

  const selecaoVisivel = selecionando && !emArquivados;
  const carregandoLista = emArquivados ? arquivados.isLoading : isLoading;
  const erroNaLista = emArquivados ? arquivados.isError : isError;
  const descricao = carregandoLista
    ? undefined
    : selecaoVisivel
      ? `${selecionados.length} de 2 marcados`
      : emArquivados
        ? `${listaDoFiltro.length} ${listaDoFiltro.length === 1 ? "arquivado" : "arquivados"}`
        : `${todos.length} ${todos.length === 1 ? "link" : "links"}`;

  // Linha 2 da barra: o alerta à vista (fora do seletor fechado), só quando há o que resolver.
  const atalho = (f: Filtro, rotulo: string, n: number) =>
    n > 0 ? (
      <button
        key={f}
        type="button"
        onClick={() => setFiltro(filtro === f ? "todos" : f)}
        aria-pressed={filtro === f}
        className={juntar(botao.barra, "text-foreground", filtro === f && "bg-muted")}
        data-atalho-do-filtro={f}
      >
        <span className="mr-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" aria-hidden="true" />
        {rotulo}
        <span className="ml-1.5 tabular-nums text-muted-foreground">{n}</span>
      </button>
    ) : null;
  const alertas = !isLoading && !isError && (contagem.vencendo > 0 || contagem.reabrir > 0) ? [atalho("vencendo", "Vencendo", contagem.vencendo), atalho("reabrir", "Pediram reabertura", contagem.reabrir)] : null;

  return (
    <div className="min-w-0 animate-fade-in">
      <CabecalhoDePagina
        titulo="Briefings"
        descricao={descricao}
        ajuda={`Os links de briefing de todos os modelos, com o estado de cada um. Busque por cliente ou título (a busca olha os ${LIMITE_DA_LISTA} links mais recentes) e escolha o estado no filtro; Vencendo e Pediram reabertura ficam à vista quando têm links. Pendentes pedem lembrete quando param; a mensagem pronta fica na leitura. Para comparar dois, use Comparar no "..." e marque os dois. Os arquivados ficam no filtro Arquivados, com Desarquivar. Na aba Modelos, o admin muda as perguntas e salva uma versão nova (os links já gerados seguem com a deles).`}
        acoes={
          <div className="flex min-w-0 flex-wrap items-center justify-end [&>*]:m-0.5">
            <SeletorCompacto
              rotulo="Aba"
              valor={aba}
              onEscolher={trocarAba}
              opcoes={[
                { valor: "links", rotulo: "Links" },
                { valor: "modelos", rotulo: "Modelos" },
              ]}
            />
            {aba === "links" && selecaoVisivel && (
              <button type="button" onClick={sairDaSelecao} className={botao.secundario}>
                Cancelar
              </button>
            )}
            {aba === "links" && selecaoVisivel && selecionados.length === 2 && (
              <button type="button" onClick={() => mudarParams((p) => p.set("comparar", selecionados.join(",")))} className={botao.secundario}>
                <Columns2 className="h-4 w-4 sm:mr-1.5" aria-hidden="true" />
                <span className="hidden sm:inline">Comparar</span>
              </button>
            )}
            {aba === "links" && (
              <button type="button" onClick={() => setNovoLink(true)} className={botao.primario}>
                <Link2 className="h-4 w-4 sm:mr-1.5" aria-hidden="true" />
                <span className="hidden sm:inline">Novo link</span>
              </button>
            )}
            {aba === "links" && !selecaoVisivel && (
              <MenuMais
                itens={[
                  !emArquivados && todos.length > 1 && { rotulo: "Comparar", icone: <Columns2 className="h-4 w-4" />, aoEscolher: () => setSelecionando(true), dica: "Marque dois briefings para ver lado a lado" },
                ]}
              />
            )}
          </div>
        }
      />

      {aba === "modelos" ? (
        <div className="mt-4 min-w-0">
          <EditorDeModelos podeSalvar={profile?.role === "admin"} onMudou={setModelosMudou} />
        </div>
      ) : (
        <>
          <BarraDeControles
            className="mt-4"
            rotulo="Filtrar briefings"
            inicio={<CampoDeBusca valor={busca} onMudar={setBusca} placeholder="Buscar cliente ou título" rotulo="Buscar briefings" />}
            acoes={
              <SeletorCompacto
                rotulo="Filtro"
                modo="lista"
                icone={<Filter className="h-3.5 w-3.5" />}
                valor={filtro}
                onEscolher={(v) => setFiltro(v as Filtro)}
                opcoes={FILTROS.map((f) => ({
                  valor: f.valor,
                  rotulo: f.rotulo,
                  contador: f.valor === "arquivados" ? (arquivados.data ? arquivados.data.length : null) : isLoading ? null : contagem[f.valor],
                  descricao: f.valor === "recebidos" ? `${painel.recebidos30} nos últimos 30 dias` : f.valor === "vencendo" ? "em até 5 dias" : undefined,
                }))}
              />
            }
            filtros={alertas}
          />

          <AreaDeTrabalho principalRolavel={false} className="mt-3">
            {carregandoLista ? (
              <Carregando linhas={4} rotulo="Carregando briefings" />
            ) : erroNaLista ? (
              <EstadoDeErro
                titulo="Não foi possível carregar os briefings."
                acao={<button type="button" onClick={() => void (emArquivados ? arquivados.refetch() : refetch())} disabled={emArquivados ? arquivados.isFetching : isFetching} className={juntar(botao.secundario, "h-8 text-[12px]")}>Tentar de novo</button>}
              />
            ) : filtrados.length === 0 ? (
              filtroLigado ? (
                <EstadoVazio
                  icone={<Search className="h-5 w-5" />}
                  titulo={emArquivados && !termo ? "Nenhum briefing arquivado." : "Nada com esse filtro."}
                  descricao={termo && listaDoFiltro.length >= LIMITE_DA_LISTA ? `A busca olha os ${LIMITE_DA_LISTA} links mais recentes.` : undefined}
                  acao={<button type="button" onClick={limparFiltros} className={botao.secundario}>Limpar filtros</button>}
                />
              ) : (
                <EstadoVazio icone={<FileText className="h-5 w-5" />} titulo="Nenhum briefing aqui." descricao="Gere um link em Novo link, na ficha do cliente ou no botão Briefing das mesas." />
              )
            ) : (
              <RegiaoRolavel rotulo="Briefings" memoria="briefings:lista">
                <ul className={juntar(lista.aberta, lista.divisoria)}>
                  {filtrados.map((b) => {
                    const s = painel.situacao[b.id] || "pendente";
                    const est = emArquivados ? { rotulo: "Arquivado", classe: "bg-muted text-muted-foreground" } : ETIQUETA[s];
                    const m = modeloDeFabrica(b.modelo);
                    const quando = emArquivados ? b.arquivado_em || b.created_at : b.submitted ? b.enviado_em || b.created_at : b.created_at;
                    const p = painel.progresso[b.id];
                    const lembrar = !emArquivados && !!painel.lembrar[b.id];
                    const marcado = selecionados.indexOf(b.id) >= 0;
                    return (
                      <li key={b.id} className={juntar(lista.linha, "py-1.5")}>
                        {selecaoVisivel && (
                          <input
                            type="checkbox"
                            checked={marcado}
                            disabled={!marcado && selecionados.length >= 2}
                            onChange={() => setSelecionados((l) => (marcado ? l.filter((x) => x !== b.id) : l.concat(b.id).slice(-2)))}
                            className="mr-3 h-4 w-4 shrink-0 accent-primary"
                            aria-label={`Marcar ${nomeDoBriefing(b)} para comparar`}
                          />
                        )}
                        <button type="button" onClick={() => abrir(b.id)} className="min-w-0 flex-1 py-1 text-left" aria-label={`Abrir briefing de ${nomeDoBriefing(b)}`}>
                          <span className="flex min-w-0 items-center">
                            <span className="min-w-0 truncate text-[13px] font-medium text-foreground">{nomeDoBriefing(b)}</span>
                            <span className={juntar(etiqueta, "ml-2 shrink-0", est.classe)}>{est.rotulo}</span>
                          </span>
                          <span className={juntar(texto.auxiliar, "mt-0.5 block truncate")}>
                            {b.titulo || m.nome} · {quando ? format(new Date(quando), "dd/MM/yyyy") : ""}
                            {!b.submitted && p ? ` · ${p.respondidos} de ${p.total}` : ""}
                            {!b.submitted && b.lembretes ? ` · ${b.lembretes} ${b.lembretes === 1 ? "lembrete" : "lembretes"}` : ""}
                          </span>
                        </button>
                        {lembrar && (
                          <button type="button" onClick={() => abrir(b.id, true)} className={juntar(botao.barra, "ml-2 text-amber-700 dark:text-amber-300")} aria-label={`Lembrar ${nomeDoBriefing(b)}`}>
                            <BellRing className="h-4 w-4" aria-hidden="true" />
                            <span className="ml-1.5 hidden sm:inline">Lembrar</span>
                          </button>
                        )}
                        {emArquivados && (
                          <button type="button" onClick={() => void desarquivar(b)} disabled={desarquivando === b.id} className={juntar(botao.barra, "ml-2")} aria-label={`Desarquivar ${nomeDoBriefing(b)}`}>
                            {desarquivando === b.id ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <ArchiveRestore className="h-4 w-4" aria-hidden="true" />}
                            <span className="ml-1.5 hidden sm:inline">Desarquivar</span>
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </RegiaoRolavel>
            )}
          </AreaDeTrabalho>
        </>
      )}

      <GerarLinkDoBriefing
        open={novoLink}
        onClose={() => setNovoLink(false)}
        clientId={clienteDaUrl}
        aoGerar={() => void queryClient.invalidateQueries({ queryKey: ["briefings-admin"] })}
      />
      {dialogoDoProjeto}
    </div>
  );
}
