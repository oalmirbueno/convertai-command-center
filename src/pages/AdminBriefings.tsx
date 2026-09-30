import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { notifyOpsMilestone } from "@/lib/opsSync";
import { useAuth } from "@/contexts/AuthContext";
import { useClients } from "@/hooks/useSupabaseData";
import { toast } from "sonner";
import { format } from "date-fns";
import { ArrowLeft, BellRing, Columns2, FileText, Link2, Loader2 } from "lucide-react";
import GerarLinkDoBriefing from "@/components/briefing/GerarLinkDoBriefing";
import LeituraDoBriefing, { type LinhaDoBriefingNoPainel, nomeDoBriefing } from "@/components/briefing/LeituraDoBriefing";
import ComparacaoDeBriefings from "@/components/briefing/ComparacaoDeBriefings";
import EditorDeModelos from "@/components/briefing/EditorDeModelos";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AreaDeTrabalho,
  CabecalhoDePagina,
  CampoDeFormulario,
  Carregando,
  EstadoDeErro,
  EstadoVazio,
  FaixaDeNumeros,
  RegiaoRolavel,
  SeletorCompacto,
  botao,
  campo,
  etiqueta,
  juntar,
  lista,
  texto,
} from "@/components/sistema";
import { modeloDeFabrica, progressoDoBriefing } from "../../supabase/functions/_shared/briefing-modelos";
import { contagemDoPainel, precisaDeLembrete, situacaoNoPainel, type SituacaoNoPainel } from "../../supabase/functions/briefing-agente/modulos/briefing-editor";

/**
 * Briefings (frente BRF, 30/09/2026; painel e modelos na frente BRF2): todos
 * os links, de todos os modelos, com o painel do dia (pendentes, vencendo,
 * recebidos no mês, pedidos de reabertura), o andamento de cada link, quem
 * pede lembrete e a comparação de dois briefings. Abrir um leva à leitura
 * (/briefings?briefing=<id>), que é também o link do aviso que a equipe
 * recebe. A aba Modelos é o editor das perguntas (versão nova a cada salvar).
 */

type Filtro = "todos" | "pendentes" | "vencendo" | "recebidos" | "reabrir";
const FILTROS: Array<{ valor: Filtro; rotulo: string }> = [
  { valor: "todos", rotulo: "Todos" },
  { valor: "pendentes", rotulo: "Pendentes" },
  { valor: "vencendo", rotulo: "Vencendo" },
  { valor: "recebidos", rotulo: "Recebidos" },
  { valor: "reabrir", rotulo: "Reabrir" },
];

const CAMPOS_DA_LISTA =
  "id, token, client_id, project_id, marca_id, modelo, titulo, responses, submitted, expira_em, enviado_em, envios, reabertura_pedida_em, reabertura_motivo, rascunho_salvo_em, arquivado_em, arquivo_pdf_id, created_at, client:profiles!briefings_client_id_fkey(full_name, company_name)";

type LinhaDaLista = LinhaDoBriefingNoPainel & { rascunho_salvo_em?: string | null; lembretes?: number | null; ultimo_lembrete_em?: string | null };

const ETIQUETA: Record<SituacaoNoPainel, { rotulo: string; classe: string }> = {
  reabrir: { rotulo: "Reabrir", classe: "bg-amber-500/15 text-amber-700 dark:text-amber-300" },
  recebido: { rotulo: "Recebido", classe: "bg-primary/15 text-primary" },
  expirado: { rotulo: "Expirado", classe: "bg-muted text-muted-foreground" },
  vencendo: { rotulo: "Vencendo", classe: "bg-amber-500/15 text-amber-700 dark:text-amber-300" },
  pendente: { rotulo: "Aguardando", classe: "bg-muted text-foreground" },
};

function passaNoFiltro(f: Filtro, s: SituacaoNoPainel): boolean {
  if (f === "todos") return true;
  if (f === "pendentes") return s === "pendente" || s === "vencendo";
  if (f === "vencendo") return s === "vencendo";
  if (f === "recebidos") return s === "recebido";
  return s === "reabrir";
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
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const [selecionados, setSelecionados] = useState<string[]>([]);
  const [novoLink, setNovoLink] = useState(false);
  const [generateBriefing, setGenerateBriefing] = useState<LinhaDoBriefingNoPainel | null>(null);
  const [generating, setGenerating] = useState(false);
  const [genClientId, setGenClientId] = useState("");

  const { data: briefings, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["briefings-admin", user?.id, clienteDaUrl],
    queryFn: async () => {
      let q = supabase.from("briefings").select(CAMPOS_DA_LISTA).is("arquivado_em" as any, null).order("created_at", { ascending: false }).limit(300);
      if (clienteDaUrl) q = q.eq("client_id", clienteDaUrl);
      const { data, error } = await q;
      if (error) throw error;
      const linhas = (data as unknown as LinhaDaLista[]) || [];
      // Lembretes (frente BRF2): leitura à parte e tolerante (sem a migração, a lista segue igual).
      const abertos = linhas.filter((b) => !b.submitted).map((b) => b.id).slice(0, 200);
      if (abertos.length) {
        const { data: lem, error: e2 } = await supabase.from("briefings").select("id, lembretes, ultimo_lembrete_em" as any).in("id", abertos);
        if (e2) console.warn("[briefings] lembretes indisponíveis:", e2.message);
        const porId: Record<string, { lembretes: number | null; ultimo_lembrete_em: string | null }> = {};
        ((lem as unknown as Array<{ id: string; lembretes: number | null; ultimo_lembrete_em: string | null }>) || []).forEach((x) => (porId[x.id] = x));
        linhas.forEach((b) => {
          if (porId[b.id]) Object.assign(b, porId[b.id]);
        });
      }
      return linhas;
    },
    enabled: !!user,
  });

  const todos = useMemo(() => briefings || [], [briefings]);
  const agora = new Date();
  const contagem = useMemo(() => contagemDoPainel(todos), [todos]);
  const filtrados = useMemo(() => todos.filter((b) => passaNoFiltro(filtro, situacaoNoPainel(b))), [todos, filtro]);
  const quantos = (f: Filtro) => todos.filter((b) => passaNoFiltro(f, situacaoNoPainel(b))).length;

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

  return (
    <div className="min-w-0 animate-fade-in">
      <CabecalhoDePagina
        titulo="Briefings"
        descricao={isLoading ? undefined : `${todos.length} ${todos.length === 1 ? "link" : "links"}`}
        ajuda="Os links de briefing de todos os modelos, com o estado de cada um. Pendentes pedem lembrete quando param; a mensagem pronta fica na leitura. Marque dois para comparar. Na aba Modelos, o admin muda as perguntas e salva uma versão nova (os links já gerados seguem com a deles)."
        acoes={
          <div className="flex min-w-0 flex-wrap items-center justify-end [&>*]:m-0.5">
            <SeletorCompacto
              rotulo="Aba"
              valor={aba}
              onEscolher={(v) => mudarParams((p) => (v === "modelos" ? p.set("aba", "modelos") : p.delete("aba")))}
              opcoes={[
                { valor: "links", rotulo: "Links" },
                { valor: "modelos", rotulo: "Modelos" },
              ]}
            />
            {aba === "links" && selecionados.length === 2 && (
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
          </div>
        }
      />

      {aba === "modelos" ? (
        <div className="mt-4 min-w-0">
          <EditorDeModelos podeSalvar={profile?.role === "admin"} />
        </div>
      ) : (
        <>
          {!isLoading && !isError && (
            <FaixaDeNumeros
              className="mt-4"
              rotulo="Painel dos briefings"
              tamanho="compacto"
              itens={[
                { rotulo: "Pendentes", valor: contagem.pendentes, aoClicar: () => setFiltro("pendentes") },
                { rotulo: "Vencendo", valor: contagem.vencendo, ponto: contagem.vencendo ? "alerta" : undefined, aoClicar: () => setFiltro("vencendo"), apoio: "em até 5 dias" },
                { rotulo: "Recebidos", valor: contagem.recebidos30, aoClicar: () => setFiltro("recebidos"), apoio: "últimos 30 dias" },
                { rotulo: "Reabrir", valor: contagem.reabrir, ponto: contagem.reabrir ? "alerta" : undefined, aoClicar: () => setFiltro("reabrir") },
              ]}
            />
          )}

          <div role="tablist" aria-label="Filtrar briefings" className="-mx-1 mt-4 flex flex-wrap">
            {FILTROS.map((f) => (
              <button
                key={f.valor}
                type="button"
                role="tab"
                aria-selected={filtro === f.valor}
                onClick={() => setFiltro(f.valor)}
                className={juntar(botao.barra, "m-1", filtro === f.valor && "bg-muted text-foreground")}
              >
                {f.rotulo}
                <span className="ml-1.5 tabular-nums text-muted-foreground">{quantos(f.valor)}</span>
              </button>
            ))}
          </div>

          <AreaDeTrabalho principalRolavel={false} className="mt-3">
            {isLoading ? (
              <Carregando linhas={4} rotulo="Carregando briefings" />
            ) : isError ? (
              <EstadoDeErro
                titulo="Não foi possível carregar os briefings."
                acao={<button type="button" onClick={() => void refetch()} disabled={isFetching} className={juntar(botao.secundario, "h-8 text-[12px]")}>Tentar de novo</button>}
              />
            ) : filtrados.length === 0 ? (
              <EstadoVazio icone={<FileText className="h-5 w-5" />} titulo="Nenhum briefing aqui." descricao="Gere um link em Novo link, na ficha do cliente ou no botão Briefing das mesas." />
            ) : (
              <RegiaoRolavel rotulo="Briefings" memoria="briefings:lista">
                <ul className={juntar(lista.aberta, lista.divisoria)}>
                  {filtrados.map((b) => {
                    const s = situacaoNoPainel(b, agora);
                    const est = ETIQUETA[s];
                    const m = modeloDeFabrica(b.modelo);
                    const quando = b.submitted ? b.enviado_em || b.created_at : b.created_at;
                    const p = progressoDoBriefing(m, (b.responses || {}) as Record<string, unknown>);
                    const lembrar = precisaDeLembrete(b, agora);
                    const marcado = selecionados.indexOf(b.id) >= 0;
                    return (
                      <li key={b.id} className={juntar(lista.linha, "py-1.5")}>
                        <input
                          type="checkbox"
                          checked={marcado}
                          disabled={!marcado && selecionados.length >= 2}
                          onChange={() => setSelecionados((l) => (marcado ? l.filter((x) => x !== b.id) : l.concat(b.id).slice(-2)))}
                          className="mr-3 h-4 w-4 shrink-0 accent-primary"
                          aria-label={`Marcar ${nomeDoBriefing(b)} para comparar`}
                        />
                        <button type="button" onClick={() => abrir(b.id)} className="min-w-0 flex-1 py-1 text-left" aria-label={`Abrir briefing de ${nomeDoBriefing(b)}`}>
                          <span className="flex min-w-0 items-center">
                            <span className="min-w-0 truncate text-[13px] font-medium text-foreground">{nomeDoBriefing(b)}</span>
                            <span className={juntar(etiqueta, "ml-2 shrink-0", est.classe)}>{est.rotulo}</span>
                          </span>
                          <span className={juntar(texto.auxiliar, "mt-0.5 block truncate")}>
                            {b.titulo || m.nome} · {quando ? format(new Date(quando), "dd/MM/yyyy") : ""}
                            {!b.submitted ? ` · ${p.respondidos} de ${p.total}` : ""}
                            {b.lembretes ? ` · ${b.lembretes} ${b.lembretes === 1 ? "lembrete" : "lembretes"}` : ""}
                          </span>
                        </button>
                        {lembrar && (
                          <button type="button" onClick={() => abrir(b.id, true)} className={juntar(botao.barra, "ml-2 text-amber-700 dark:text-amber-300")} aria-label={`Lembrar ${nomeDoBriefing(b)}`}>
                            <BellRing className="h-4 w-4" aria-hidden="true" />
                            <span className="ml-1.5 hidden sm:inline">Lembrar</span>
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
