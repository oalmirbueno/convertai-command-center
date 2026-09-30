import { useEffect, useMemo, useState } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { CalendarCheck, CalendarClock, ExternalLink, Wand2, Loader2, RefreshCw, Send, Undo2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { useConfirm } from "@/components/shared/confirmDialog";
import JanelaDoCelular from "@/components/sistema/JanelaDoCelular";
import { CampoDeFormulario } from "@/components/sistema/Formulario";
import { botao, campo, juntar } from "@/components/sistema/estilos";
import { retryAutopublish, useAutopublishStatus } from "@/hooks/useAutopublishStatus";
import { EDITORIAL_DEFAULT_TIME_ZONE, isoUtcToZonedDateTimeLocal, zonedDateTimeLocalToIso } from "@/lib/editorialDate";
import {
  confirmarPublicacao,
  desfazerAgendamento,
  lerMelhoresHorarios,
  levarParaAgenda,
  publicarAgora,
  textoDoErro,
} from "@/lib/mesa/api";
import {
  estadoDaPublicacao,
  horarioSugerido,
  laminaCitada,
  linkDoAjusteNoEstudio,
  localParaIso,
  pedidoDeAjustePendente,
  partesNoFuso,
  problemaNoHorario,
  publicacaoDaPeca,
  tipoDoConteudo,
  type PublicacaoExistente,
  type EstadoDaPublicacao,
  type TomDoEstado,
} from "../../../supabase/functions/estudio-arte/modulos/entrega-na-agenda";
import { ehPostDeFotos, linkDoPostNaMesaFoto } from "../../../supabase/functions/_shared/post-de-fotos";

/**
 * Publicação da peça (frente EA, 27/09): o mesmo bloco na Entrega da Mesa e
 * no card da Agenda. Mostra em que pé está (com o cliente, agendado, publicado
 * ou falhou com o motivo) e deixa o dono confirmar a data e a hora, publicar
 * agora (só aprovada), desfazer o agendamento e tentar de novo depois de uma
 * falha. Quem publica é o ciclo do banco; aqui só se grava a decisão.
 */

/** O que o bloco precisa do trabalho do estúdio (estudio_trabalhos). */
export interface PecaParaPublicar {
  id: string;
  status: string;
  file_ids: string[];
  entrega_status?: string | null;
  entrega_aviso?: string | null;
  post_id?: string | null;
  aprovado_em?: string | null;
  publicar_em?: string | null;
  publicar_em_confirmado_em?: string | null;
  publicar_ao_aprovar?: boolean | null;
  agenda_aviso?: string | null;
  ajustes_do_cliente?: unknown;
}

/** A publicação do post da peça (editorial_publications). */
export interface PublicacaoParaPublicar {
  id?: string;
  status: string;
  scheduled_at: string | null;
  published_at?: string | null;
  permalink?: string | null;
}

export const TOM_DO_ESTADO: Record<TomDoEstado, string> = {
  neutro: "bg-secondary text-muted-foreground",
  andamento: "bg-primary/10 text-primary",
  ok: "bg-success/10 text-success",
  alerta: "bg-warning/15 text-foreground",
  erro: "bg-destructive/10 text-destructive",
};

const dois = (n: number) => (n < 10 ? `0${n}` : String(n));

/** "27/09 11:30" no fuso da Agenda. */
export function dataEHoraCurta(iso: string): string {
  const local = isoUtcToZonedDateTimeLocal(iso, EDITORIAL_DEFAULT_TIME_ZONE);
  if (!local) {
    const d = new Date(iso);
    return `${dois(d.getDate())}/${dois(d.getMonth() + 1)} ${dois(d.getHours())}:${dois(d.getMinutes())}`;
  }
  return `${local.slice(8, 10)}/${local.slice(5, 7)} ${local.slice(11, 16)}`;
}

/**
 * Estado da peça para a tela. O motor (autopublish_status_secure) só é lido
 * quando a publicação está agendada ou falhou: é dele o motivo da falha.
 */
export function useEstadoDaPeca(t: PecaParaPublicar | null, pub: PublicacaoParaPublicar | null): { estado: EstadoDaPublicacao | null; motor: { stage: string; last_error: string | null; permalink: string | null } | null } {
  const acompanhar = !!pub?.id && (pub.status === "scheduled" || pub.status === "failed");
  const motor = useAutopublishStatus(pub?.id || null, acompanhar);
  const m = acompanhar && motor.data ? { stage: motor.data.stage, last_error: motor.data.last_error, permalink: motor.data.permalink } : null;
  const estado = useMemo(() => {
    if (!t) return null;
    return estadoDaPublicacao({ trabalho: t, publicacao: pub, motor: m, agora: new Date(), formatar: dataEHoraCurta });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t, pub, m?.stage, m?.last_error]);
  return { estado, motor: m };
}

/** Data e hora que o campo abre: a confirmada, a proposta na entrega ou a sugerida (dia da peça + melhor horário). */
function dataInicial(t: PecaParaPublicar, pub: PublicacaoParaPublicar | null, sugestao: string | null): string {
  const iso = pub?.scheduled_at || t.publicar_em || sugestao;
  return iso ? isoUtcToZonedDateTimeLocal(iso, EDITORIAL_DEFAULT_TIME_ZONE) || "" : "";
}

export function JanelaDaPublicacao({
  aberta,
  onFechar,
  titulo,
  clientId,
  diaDaPeca,
  peca,
  publicacao,
  podePublicar,
  onMudou,
}: {
  aberta: boolean;
  onFechar: () => void;
  titulo: string;
  clientId: string;
  diaDaPeca: string | null;
  peca: PecaParaPublicar;
  publicacao: PublicacaoParaPublicar | null;
  /** Admin e gestor: confirmar, publicar e desfazer (o servidor confere de novo). */
  podePublicar: boolean;
  onMudou: () => void;
}) {
  const confirmar = useConfirm();
  const queryClient = useQueryClient();
  const { estado } = useEstadoDaPeca(peca, publicacao);
  const melhores = useQuery({
    queryKey: ["mesa", "melhores-horarios", clientId],
    staleTime: 10 * 60_000,
    retry: false,
    enabled: aberta && !peca.publicar_em && !publicacao?.scheduled_at,
    queryFn: () => lerMelhoresHorarios(clientId),
  });
  const sugestao = useMemo(() => {
    const agora = partesNoFuso(new Date(), EDITORIAL_DEFAULT_TIME_ZONE);
    const tipo = tipoDoConteudo(peca.file_ids || []);
    const s = horarioSugerido({
      diaDaPeca,
      hoje: agora.dia,
      agoraHHMM: agora.hora,
      melhorHora: melhores.data?.por_tipo?.[tipo] || null,
    });
    return localParaIso(s.dia, s.hora, EDITORIAL_DEFAULT_TIME_ZONE);
  }, [diaDaPeca, melhores.data, peca.file_ids]);

  const [quando, setQuando] = useState("");
  const [logoQueAprovar, setLogoQueAprovar] = useState(false);
  const [fazendo, setFazendo] = useState<null | "confirmar" | "agora" | "desfazer" | "tentar" | "levar">(null);

  // Abre com a data que vale; a sugestão entra quando chega, sem pisar no que foi digitado.
  useEffect(() => {
    if (!aberta) return;
    setQuando(dataInicial(peca, publicacao, sugestao));
    setLogoQueAprovar(!!peca.publicar_ao_aprovar);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberta, peca.id]);
  useEffect(() => {
    if (aberta && !quando && sugestao) setQuando(dataInicial(peca, publicacao, sugestao));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sugestao]);

  const iso = quando ? zonedDateTimeLocalToIso(quando, EDITORIAL_DEFAULT_TIME_ZONE) : null;
  const problema = quando ? problemaNoHorario(iso, new Date()) : null;
  const naAgenda = !!peca.post_id;
  const aprovado = peca.entrega_status === "aprovado" || peca.entrega_status === "agendado" || publicacao?.status === "scheduled";
  const temData = !!publicacao?.scheduled_at && publicacao.status !== "published";
  const publicado = publicacao?.status === "published";
  const falhou = publicacao?.status === "failed";

  const depois = (msg: string) => {
    toast.success(msg);
    void queryClient.invalidateQueries({ queryKey: ["mesa", "itens-do-mes"] });
    void queryClient.invalidateQueries({ queryKey: ["mesa", "item-avulso"] });
    void queryClient.invalidateQueries({ queryKey: ["mesa", "peca-do-post"] });
    void queryClient.invalidateQueries({ queryKey: ["editorial-calendar"] });
    void queryClient.invalidateQueries({ queryKey: ["autopublish-status"] });
    onMudou();
  };
  const rodar = async (qual: NonNullable<typeof fazendo>, acao: () => Promise<unknown>, msg: string, fechar = true) => {
    setFazendo(qual);
    try {
      await acao();
      depois(msg);
      if (fechar) onFechar();
    } catch (e) {
      toast.error("Não foi possível", { description: textoDoErro(e) });
    } finally {
      setFazendo(null);
    }
  };

  const confirmarData = () => {
    if (!iso || problema) return;
    void rodar(
      "confirmar",
      () => confirmarPublicacao(peca.id, iso, logoQueAprovar),
      aprovado ? `Agendado para ${dataEHoraCurta(iso)}.` : `Data confirmada: ${dataEHoraCurta(iso)}. Publica depois da aprovação do cliente.`,
    );
  };
  const agoraMesmo = async () => {
    const ok = await confirmar({
      title: "Publicar agora no Instagram?",
      description: `"${titulo}" sai na conta do cliente em cerca de 1 minuto.`,
      confirmLabel: "Publicar agora",
    });
    if (ok) void rodar("agora", () => publicarAgora(peca.id), "Publicando em até 1 minuto.");
  };
  const desfazer = async () => {
    const ok = await confirmar({
      title: "Desfazer o agendamento?",
      description: "O post continua na Agenda, sem data. Nada é publicado até você confirmar outra data.",
      confirmLabel: "Desfazer",
    });
    if (ok) void rodar("desfazer", () => desfazerAgendamento(peca.id), "Agendamento desfeito.", false);
  };
  const tentarDeNovo = () => {
    if (!publicacao?.id) return;
    void rodar("tentar", () => retryAutopublish(publicacao.id as string), "Tentando de novo em até 1 minuto.", false);
  };
  const levar = () => void rodar("levar", () => levarParaAgenda(peca.id), "A peça está na Agenda.", false);

  const ocupado = !!fazendo;
  const rodape = podePublicar && !publicado ? (
    <div className="flex w-full flex-wrap items-center justify-end [&>*]:mb-1 [&>*]:ml-2">
      {temData && (
        <button type="button" className={botao.discreto} onClick={() => void desfazer()} disabled={ocupado}>
          {fazendo === "desfazer" ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Undo2 className="mr-1.5 h-4 w-4" />}
          Desfazer
        </button>
      )}
      {aprovado && !falhou && (
        <button type="button" className={botao.secundario} onClick={() => void agoraMesmo()} disabled={ocupado}>
          {fazendo === "agora" ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Send className="mr-1.5 h-4 w-4" />}
          Publicar agora
        </button>
      )}
      {!falhou && (
        <button type="button" className={botao.primario} onClick={confirmarData} disabled={ocupado || !iso || !!problema}>
          {fazendo === "confirmar" ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <CalendarCheck className="mr-1.5 h-4 w-4" />}
          {temData ? "Reagendar" : aprovado ? "Agendar" : "Confirmar data"}
        </button>
      )}
    </div>
  ) : null;

  return (
    <JanelaDoCelular aberta={aberta} titulo="Publicar em" onFechar={onFechar} rodape={rodape}>
      <div className="space-y-4 text-[13px]">
        <div className="min-w-0">
          <p className="truncate font-medium">{titulo}</p>
          {estado && (
            <p className="mt-1 flex min-w-0 items-center text-[12px] text-muted-foreground">
              <span className={`mr-2 shrink-0 rounded-full px-2 py-0.5 text-[11px] ${TOM_DO_ESTADO[estado.tom]}`}>{estado.rotulo}</span>
              <span className="min-w-0 [overflow-wrap:anywhere]">{estado.detalhe}</span>
            </p>
          )}
          {estado?.link && (
            <a href={estado.link} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center text-[12px] text-primary underline-offset-2 hover:underline">
              <ExternalLink className="mr-1 h-3.5 w-3.5" /> Ver no Instagram
            </a>
          )}
        </div>

        {!naAgenda && (
          <div className="flex items-center justify-between rounded-md bg-muted px-3 py-2">
            <span className="min-w-0 text-[12px] text-muted-foreground">{peca.agenda_aviso || "A peça ainda não está na Agenda."}</span>
            <button type="button" className={juntar(botao.secundario, "ml-2 h-8")} onClick={levar} disabled={ocupado}>
              {fazendo === "levar" ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Upload className="mr-1.5 h-4 w-4" />}
              Levar para a Agenda
            </button>
          </div>
        )}

        {falhou && podePublicar && (
          <div className="flex items-center justify-between rounded-md bg-destructive/10 px-3 py-2">
            <span className="min-w-0 text-[12px] text-destructive [overflow-wrap:anywhere]">{estado?.detalhe || "Falhou."}</span>
            <button type="button" className={juntar(botao.secundario, "ml-2 h-8")} onClick={tentarDeNovo} disabled={ocupado || !publicacao?.id}>
              {fazendo === "tentar" ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-1.5 h-4 w-4" />}
              Tentar de novo
            </button>
          </div>
        )}

        {!publicado && !falhou && (
          <>
            <CampoDeFormulario
              rotulo="Data e hora"
              apoio={problema ? undefined : aprovado ? "Aprovado pelo cliente: agenda na hora." : "Publica neste horário depois que o cliente aprovar."}
              erro={problema || undefined}
            >
              <input
                type="datetime-local"
                className={campo}
                value={quando}
                onChange={(e) => setQuando(e.target.value)}
                disabled={!podePublicar || ocupado}
              />
            </CampoDeFormulario>
            <label className={`flex items-center ${podePublicar ? "" : "opacity-70"}`}>
              <Switch checked={logoQueAprovar} onCheckedChange={setLogoQueAprovar} disabled={!podePublicar || ocupado} className="mr-2 shrink-0" />
              <span className="min-w-0 text-[12.5px]">Se o cliente aprovar depois do horário, publicar assim que aprovar</span>
            </label>
            {!podePublicar && <p className="text-[12px] text-muted-foreground">Só admin ou gestor confirma a data e publica.</p>}
          </>
        )}
      </div>
    </JanelaDoCelular>
  );
}

/**
 * No card da Agenda: o post que veio de uma entrega do Estúdio mostra a
 * publicação da peça (estado, data e hora) e abre o mesmo "Publicar em" da
 * Entrega. Sem trabalho do Estúdio ligado ao post, não aparece.
 */
export function PublicacaoDaMesaNaAgenda({
  postId,
  clientId,
  titulo,
  publicacoes,
  podePublicar,
}: {
  postId: string;
  clientId: string;
  titulo: string;
  publicacoes: Array<{ id: string; status: string; platform: string; scheduled_at: string | null; published_at?: string | null; permalink?: string | null }>;
  podePublicar: boolean;
}) {
  const [aberta, setAberta] = useState(false);
  const peca = useQuery({
    queryKey: ["mesa", "peca-do-post", postId],
    staleTime: 30_000,
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<{ peca: PecaParaPublicar; dia: string | null; taskId: string | null; soFotos: boolean } | null> => {
      const { data, error } = await (supabase as any)
        .from("estudio_trabalhos")
        .select("id, task_id, status, file_ids, entrega_status, entrega_aviso, post_id, aprovado_em, publicar_em, publicar_em_confirmado_em, publicar_ao_aprovar, agenda_aviso, ajustes_do_cliente, direcao")
        .eq("post_id", postId)
        .order("atualizado_em", { ascending: false })
        .limit(1);
      // Sem as colunas da frente EA no banco (ou sem acesso), o bloco não aparece.
      if (error || !data || !data.length) return null;
      const t = data[0] as PecaParaPublicar & { task_id: string | null; direcao?: unknown };
      let dia: string | null = null;
      if (t.task_id) {
        const { data: tarefa } = await (supabase as any).from("tasks").select("due_date").eq("id", t.task_id).maybeSingle();
        dia = (tarefa && tarefa.due_date) || null;
      }
      // Frente MF: post de fotos da Mesa Foto (o ajuste e a edição são lá, não no Estúdio de design).
      const soFotos = ehPostDeFotos(t.direcao);
      const { direcao: _direcao, ...semDirecao } = t;
      return { peca: { ...semDirecao, file_ids: Array.isArray(t.file_ids) ? t.file_ids : [] }, dia, taskId: t.task_id, soFotos };
    },
  });
  const pub = publicacaoDaPeca(publicacoes as unknown as PublicacaoExistente[]) as PublicacaoParaPublicar | null;
  const { estado } = useEstadoDaPeca(peca.data ? peca.data.peca : null, pub);
  if (!peca.data || !estado) return null;
  // Ajuste pedido pelo cliente: o botão abre o Estúdio no MESMO trabalho, na lâmina do pedido.
  const pedido = estado.codigo === "ajuste_pedido" ? pedidoDeAjustePendente(peca.data.peca.ajustes_do_cliente) : null;
  const laminaDoPedido = estado.codigo === "ajuste_pedido" ? pedido?.lamina ?? laminaCitada(peca.data.peca.entrega_aviso) : null;
  const soFotos = !!peca.data.soFotos;
  const linkDoEstudio = estado.codigo === "ajuste_pedido" && peca.data.taskId
    ? soFotos
      ? linkDoPostNaMesaFoto(clientId, { taskId: peca.data.taskId, trabalhoId: peca.data.peca.id })
      : linkDoAjusteNoEstudio(clientId, peca.data.taskId, laminaDoPedido)
    : null;
  // Post de fotos: o item sempre abre na Mesa Foto (fotos, legenda e envio moram lá).
  const linkDaMesaFoto = soFotos && !linkDoEstudio && peca.data.taskId ? linkDoPostNaMesaFoto(clientId, { taskId: peca.data.taskId, trabalhoId: peca.data.peca.id }) : null;
  return (
    <section className="flex min-w-0 items-center rounded-xl border border-border bg-card px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Publicação da Mesa</p>
        <p className="mt-1 flex min-w-0 items-center text-[12.5px]">
          <span className={`mr-2 shrink-0 rounded-full px-2 py-0.5 text-[11px] ${TOM_DO_ESTADO[estado.tom]}`}>{estado.rotulo}</span>
          <span className="min-w-0 text-muted-foreground [overflow-wrap:anywhere]">{estado.detalhe}</span>
        </p>
      </div>
      {linkDoEstudio && (
        <Link to={linkDoEstudio} className={juntar(botao.primario, "ml-3 h-8")} aria-label={soFotos ? "Abrir na Mesa Foto" : "Abrir no Estúdio"}>
          <Wand2 className="h-4 w-4 sm:mr-1.5" />
          <span className="hidden sm:inline">{soFotos ? "Abrir na Mesa Foto" : "Abrir no Estúdio"}</span>
        </Link>
      )}
      {linkDaMesaFoto && (
        <Link to={linkDaMesaFoto} className={juntar(botao.discreto, "ml-3 h-8")} aria-label="Abrir na Mesa Foto">
          <Wand2 className="h-4 w-4 sm:mr-1.5" />
          <span className="hidden sm:inline">Mesa Foto</span>
        </Link>
      )}
      {estado.codigo !== "publicado" && estado.codigo !== "ajuste_pedido" && (
        <button type="button" className={juntar(botao.secundario, "ml-3 h-8")} onClick={() => setAberta(true)} aria-label="Publicar em">
          <CalendarClock className="h-4 w-4 sm:mr-1.5" />
          <span className="hidden sm:inline">{pub?.scheduled_at ? "Reagendar" : "Publicar em"}</span>
        </button>
      )}
      {estado.link && (
        <a href={estado.link} target="_blank" rel="noreferrer" className={juntar(botao.discreto, "ml-2 h-8")}>
          <ExternalLink className="mr-1.5 h-4 w-4" /> Ver post
        </a>
      )}
      <JanelaDaPublicacao
        aberta={aberta}
        onFechar={() => setAberta(false)}
        titulo={titulo}
        clientId={clientId}
        diaDaPeca={peca.data.dia}
        peca={peca.data.peca}
        publicacao={pub}
        podePublicar={podePublicar}
        onMudou={() => void peca.refetch()}
      />
    </section>
  );
}
