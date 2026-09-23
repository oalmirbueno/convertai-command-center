import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarCheck, ChevronLeft, ChevronRight, Clock, Loader2, Pencil, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useConfirm } from "@/components/shared/confirmDialog";
import { TASK_DELIVERY_TYPE_LABELS, type TaskDeliveryType } from "@/lib/taskDeliveryTypes";
import {
  chamarFuncao,
  dataCurta,
  dataEHora,
  enviarParaAprovacao,
  lerHorarioAutomatico,
  lerMelhoresHorarios,
  lerPrevisao,
  rotuloDoMes,
  salvarAjustesDaEntrega,
  salvarHorarioAutomatico,
  somarMeses,
  textoDoErro,
  usd,
} from "@/lib/mesa/api";
import { ImagemDaMesa, useMesa } from "./MesaContexto";
import { ultimasVersoes, useItensDoMes, type ItemDoMes, type PublicacaoDoPost, type Trabalho } from "./useItensDoMes";

/**
 * Aba Entrega (SPEC seção 6). O caminho de cada arte até a Agenda:
 * arte pronta → entregue em Arquivos → enviada para aprovação → aprovada →
 * agendada sozinha (segunda a sexta, no horário do cliente) → publicada.
 *
 * O envio usa o mesmo caminho da tela de Arquivos e o agendamento usa o
 * mesmo caminho da Agenda. Quem acompanha a aprovação é o banco (gatilho e
 * cron de um minuto); esta tela só mostra e dá o empurrão do envio em lote.
 */

type Tom = "neutro" | "andamento" | "ok" | "alerta" | "erro";

const ROTULO_DO_TIPO: Record<string, string> = {
  carousel: "Carrossel",
  static: "Estático",
  design: "Design",
  reel: "Reels",
};
const ORDEM_DOS_TIPOS = ["carousel", "static", "design", "reel"];

interface Estado {
  rotulo: string;
  tom: Tom;
  detalhe?: string | null;
}

const TOM: Record<Tom, string> = {
  neutro: "bg-secondary text-muted-foreground",
  andamento: "bg-primary/10 text-primary",
  ok: "bg-success/10 text-success",
  alerta: "bg-warning/15 text-foreground",
  erro: "bg-destructive/10 text-destructive",
};

/** A arte tem todos os cards da direção gerados? */
function artePronta(t: Trabalho): boolean {
  const total = t.direcao?.cards?.length || 0;
  return total > 0 && ultimasVersoes(t.cards).size >= total;
}

/** Entregue em Arquivos e ainda não enviada (ou reentregue depois de um ajuste). */
function faltaEnviar(t: Trabalho | null): boolean {
  return !!t && t.status === "entregue" && t.file_ids.length > 0 && (!t.entrega_status || t.entrega_status === "reprovado");
}

/** Pronta no Estúdio, nunca entregue nem reprovada: a Entrega pode entregar sozinha. */
function podeEntregarSozinha(t: Trabalho | null): boolean {
  return !!t && t.status === "pronto" && t.entrega_status !== "reprovado" && artePronta(t);
}

function estadoDoItem(t: Trabalho | null, pub: PublicacaoDoPost | null): Estado {
  if (!t) return { rotulo: "sem arte", tom: "neutro" };
  if (pub?.status === "published") {
    return { rotulo: "publicado", tom: "ok", detalhe: pub.published_at ? `Publicado ${dataEHora(pub.published_at)}.` : null };
  }
  if (pub?.status === "failed") return { rotulo: "falhou ao publicar", tom: "erro", detalhe: "Veja o post na Agenda." };
  if (t.status === "entregue") {
    switch (t.entrega_status) {
      case "aguardando_agencia":
        return { rotulo: "revisão da agência", tom: "andamento" };
      case "aguardando_cliente":
        return { rotulo: "com o cliente", tom: "andamento", detalhe: "Aguardando a aprovação do cliente." };
      case "aprovado":
        return { rotulo: "aprovado", tom: "ok", detalhe: "Entra na Agenda em até um minuto." };
      case "agendado": {
        const quando = pub?.scheduled_at || t.agendado_para;
        return {
          rotulo: "agendado",
          tom: "ok",
          detalhe: [quando ? `Na Agenda para ${dataEHora(quando)}.` : "Na Agenda.", t.entrega_aviso].filter(Boolean).join(" "),
        };
      }
      case "precisa_de_atencao":
        return { rotulo: "precisa de atenção", tom: "erro", detalhe: t.entrega_aviso };
      case "reprovado":
        return { rotulo: "nova versão, falta enviar", tom: "alerta", detalhe: t.entrega_aviso ? `Ajuste pedido: “${t.entrega_aviso}”` : null };
      default:
        return { rotulo: "entregue, falta enviar", tom: "alerta" };
    }
  }
  if (t.entrega_status === "reprovado") {
    return { rotulo: "ajuste pedido", tom: "erro", detalhe: t.entrega_aviso ? `“${t.entrega_aviso}”` : "Abra no Estúdio para ajustar." };
  }
  if (t.status === "erro") return { rotulo: "com erro", tom: "erro" };
  if (artePronta(t)) return { rotulo: "arte pronta", tom: "alerta", detalhe: "Falta entregar e enviar." };
  return { rotulo: "em produção", tom: "neutro" };
}

function linkDaAgenda(clientId: string, t: Trabalho, pub: PublicacaoDoPost | null): string | null {
  if (!t.post_id) return null;
  const quando = pub?.scheduled_at || t.agendado_para;
  const data = quando ? new Date(quando) : null;
  const dia = data && !Number.isNaN(data.getTime())
    ? `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, "0")}-${String(data.getDate()).padStart(2, "0")}`
    : null;
  return `/calendario?client=${clientId}&content=${t.post_id}${dia ? `&date=${dia}` : ""}`;
}

export default function AbaEntrega({ mes, onMes, onAbrir }: { mes: string; onMes: (m: string) => void; onAbrir: (taskId: string) => void }) {
  const { clientId, clientName, podeRecarregar, atualizarCusto } = useMesa();
  const queryClient = useQueryClient();
  const confirmar = useConfirm();
  const dados = useItensDoMes(clientId, mes);
  const itens = dados.data?.itens || [];
  const trabalhoDe = (i: ItemDoMes) => dados.data?.trabalhos.get(i.id) || null;
  const publicacaoDe = (t: Trabalho | null) => (t?.post_id ? dados.data?.publicacoes.get(t.post_id) || null : null);

  const [progresso, setProgresso] = useState<string | null>(null);

  const paraEntregar = useMemo(() => itens.map(trabalhoDe).filter(podeEntregarSozinha) as Trabalho[], [dados.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const paraEnviar = useMemo(() => itens.map(trabalhoDe).filter(faltaEnviar) as Trabalho[], [dados.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const total = paraEntregar.length + paraEnviar.length;

  const contagem = useMemo(() => {
    const c = { cliente: 0, agendados: 0, publicados: 0, ajustes: 0, atencao: 0 };
    for (const i of itens) {
      const t = trabalhoDe(i);
      const pub = publicacaoDe(t);
      if (!t) continue;
      if (pub?.status === "published") c.publicados++;
      else if (t.entrega_status === "agendado") c.agendados++;
      else if (t.entrega_status === "aguardando_cliente" || t.entrega_status === "aguardando_agencia") c.cliente++;
      else if (t.entrega_status === "reprovado") c.ajustes++;
      else if (t.entrega_status === "precisa_de_atencao") c.atencao++;
    }
    return c;
  }, [dados.data]); // eslint-disable-line react-hooks/exhaustive-deps

  // Enquanto houver arte aprovada esperando o cron, relê a cada 20 s.
  const esperandoCron = itens.some((i) => trabalhoDe(i)?.entrega_status === "aprovado");
  useEffect(() => {
    if (!esperandoCron) return;
    const id = window.setInterval(() => void dados.refetch(), 20_000);
    return () => window.clearInterval(id);
  }, [esperandoCron]); // eslint-disable-line react-hooks/exhaustive-deps

  const enviarTudo = async () => {
    if (!total) return;
    const ok = await confirmar({
      title: `Enviar ${total} ${total === 1 ? "arte" : "artes"} para aprovação?`,
      description:
        (paraEntregar.length
          ? `${paraEntregar.length} ${paraEntregar.length === 1 ? "arte pronta vai" : "artes prontas vão"} primeiro para Arquivos. `
          : "") +
        `${clientName} recebe no painel para aprovar. Quando aprovar, cada post entra sozinho na Agenda, de segunda a sexta, no horário combinado.`,
      confirmLabel: "Enviar",
    });
    if (!ok) return;

    const falhas: string[] = [];
    const ids = paraEnviar.map((t) => t.id);
    try {
      for (let n = 0; n < paraEntregar.length; n++) {
        const t = paraEntregar[n];
        setProgresso(`Entregando em Arquivos ${n + 1} de ${paraEntregar.length}…`);
        try {
          await chamarFuncao("estudio-arte", { acao: "entregar", trabalho_id: t.id });
          ids.push(t.id);
        } catch (e) {
          falhas.push(textoDoErro(e));
        }
      }
      if (ids.length) {
        setProgresso("Enviando para aprovação…");
        const resultados = await enviarParaAprovacao(ids);
        resultados.filter((r) => !r.ok).forEach((r) => falhas.push(r.erro || "falhou"));
        const enviados = resultados.filter((r) => r.ok).length;
        if (enviados) toast.success(`${enviados} ${enviados === 1 ? "arte enviada" : "artes enviadas"} para aprovação`);
      }
      if (falhas.length) {
        toast.error(`${falhas.length} não ${falhas.length === 1 ? "foi" : "foram"} enviada${falhas.length === 1 ? "" : "s"}`, {
          description: falhas.slice(0, 3).join(" · "),
        });
      }
    } catch (e) {
      toast.error("Envio não concluído", { description: textoDoErro(e) });
    } finally {
      setProgresso(null);
      atualizarCusto();
      void queryClient.invalidateQueries({ queryKey: ["mesa", "itens-do-mes", clientId] });
      void queryClient.invalidateQueries({ queryKey: ["mesa", "previsao", clientId] });
    }
  };

  const resumo = [
    contagem.cliente ? `${contagem.cliente} com o cliente` : null,
    contagem.ajustes ? `${contagem.ajustes} com ajuste pedido` : null,
    contagem.atencao ? `${contagem.atencao} precisa${contagem.atencao === 1 ? "" : "m"} de atenção` : null,
    contagem.agendados ? `${contagem.agendados} agendado${contagem.agendados === 1 ? "" : "s"}` : null,
    contagem.publicados ? `${contagem.publicados} publicado${contagem.publicados === 1 ? "" : "s"}` : null,
  ].filter(Boolean).join(" · ");

  return (
    <div className="space-y-4">
      <div className="flex flex-col rounded-xl border border-border bg-card p-3 sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 items-center">
          <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => onMes(somarMeses(mes, -1))} aria-label="Mês anterior">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <p className="mx-1 min-w-[120px] text-center text-[13.5px] font-medium capitalize">{rotuloDoMes(mes)}</p>
          <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => onMes(somarMeses(mes, 1))} aria-label="Próximo mês">
            <ChevronRight className="h-4 w-4" />
          </Button>
          <span className="ml-2 min-w-0 text-[12px] leading-snug text-muted-foreground [overflow-wrap:anywhere]">
            {resumo || `${itens.length} ${itens.length === 1 ? "item" : "itens"} com arte`}
          </span>
        </div>
        <div className="mt-2 flex w-full flex-col items-stretch sm:ml-3 sm:mt-0 sm:w-auto sm:items-end">
          <Button type="button" onClick={() => void enviarTudo()} disabled={!total || !!progresso}>
            {progresso ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Send className="mr-1.5 h-4 w-4" />}
            {total ? `Enviar ${total} para aprovação` : "Nada para enviar"}
          </Button>
          {progresso && <span className="mt-1 text-center text-[11px] text-muted-foreground sm:text-right">{progresso}</span>}
        </div>
      </div>

      <AjustesDaEntrega podeEditar={podeRecarregar} />

      <section className="min-w-0 overflow-hidden rounded-xl border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-3.5 py-2.5">
          <p className="text-[12.5px] font-medium">Artes do mês</p>
          <span className="text-[11.5px] text-muted-foreground">{itens.length} {itens.length === 1 ? "item" : "itens"}</span>
        </div>
        {dados.isLoading && (
          <p className="px-3.5 py-4 text-[12.5px] text-muted-foreground"><Loader2 className="mr-1.5 inline h-4 w-4 animate-spin" />Lendo a agenda...</p>
        )}
        {dados.isError && <p className="m-3 rounded-lg border border-destructive/40 bg-card p-3 text-[12.5px] text-destructive">{textoDoErro(dados.error)}</p>}
        {dados.data && itens.length === 0 && <p className="px-3.5 py-6 text-center text-[12.5px] text-muted-foreground">Nenhum item com arte na agenda deste mês.</p>}

        {/* Rolagem própria: a lista longa não arrasta a página inteira. */}
        {itens.length > 0 && (
          <ul className="max-h-[60vh] divide-y divide-border overflow-y-auto overscroll-contain">
            {itens.map((i) => {
              const t = trabalhoDe(i);
              const pub = publicacaoDe(t);
              const versoes = t ? ultimasVersoes(t.cards) : new Map();
              const capa = versoes.get(1) || Array.from(versoes.values())[0] || null;
              const totalCards = t?.direcao?.cards?.length || 0;
              const estado = estadoDoItem(t, pub);
              const agenda = t ? linkDaAgenda(clientId, t, pub) : null;
              return (
                <li key={i.id} className="flex min-w-0 items-center px-3 py-2.5 hover:bg-muted">
                  <button type="button" onClick={() => onAbrir(i.id)} className="flex min-w-0 flex-1 items-center text-left" aria-label={`Abrir ${i.title} no Estúdio`}>
                    <ImagemDaMesa caminho={capa?.storage_path} alt={i.title} className="mr-3 h-16 w-12 shrink-0 rounded-md border border-border" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] font-medium leading-snug [overflow-wrap:anywhere]">{i.title}</span>
                      <span className="mt-0.5 block text-[11.5px] text-muted-foreground">
                        {dataCurta(i.due_date)} · {TASK_DELIVERY_TYPE_LABELS[i.delivery_type as TaskDeliveryType] || i.delivery_type}
                        {totalCards ? ` · ${versoes.size}/${totalCards} cards` : ""}
                      </span>
                      {estado.detalhe && <span className="mt-0.5 block text-[11.5px] leading-snug text-muted-foreground [overflow-wrap:anywhere]">{estado.detalhe}</span>}
                    </span>
                  </button>
                  <span className="ml-3 flex shrink-0 flex-col items-end">
                    <span className={`rounded-full px-2 py-0.5 text-[11px] ${TOM[estado.tom]}`}>{estado.rotulo}</span>
                    {agenda && (
                      <Link to={agenda} className="mt-1 inline-flex items-center text-[11px] text-primary underline-offset-2 hover:underline">
                        <CalendarCheck className="mr-1 h-3 w-3" /> Agenda
                      </Link>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

/**
 * Horário de publicação, agendamento automático e plano do cliente. Todo
 * mundo da equipe vê; só admin e gestor mudam (a RPC confere de novo).
 */
function AjustesDaEntrega({ podeEditar }: { podeEditar: boolean }) {
  const { clientId } = useMesa();
  const queryClient = useQueryClient();
  const previsao = useQuery({
    queryKey: ["mesa", "previsao", clientId],
    queryFn: () => lerPrevisao(clientId),
  });
  const [editando, setEditando] = useState(false);
  const [hora, setHora] = useState("09:00");
  const [agendar, setAgendar] = useState(true);
  const [posts, setPosts] = useState("");
  const [laminas, setLaminas] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [trocandoAutomatico, setTrocandoAutomatico] = useState(false);

  const melhores = useQuery({
    queryKey: ["mesa", "melhores-horarios", clientId],
    staleTime: 10 * 60_000,
    retry: false,
    queryFn: () => lerMelhoresHorarios(clientId),
  });
  const automatico = useQuery({
    queryKey: ["mesa", "horario-automatico", clientId],
    retry: false,
    queryFn: () => lerHorarioAutomatico(clientId),
  });
  const horarioAutomatico = automatico.data !== false;

  const trocarAutomatico = async (ligado: boolean) => {
    const chave = ["mesa", "horario-automatico", clientId];
    const antes = automatico.data;
    queryClient.setQueryData(chave, ligado);
    setTrocandoAutomatico(true);
    try {
      await salvarHorarioAutomatico(clientId, ligado);
      toast.success(ligado ? "Horário automático ligado" : "Horário automático desligado", {
        description: ligado ? "Cada post sai no melhor horário do seu tipo." : "Os posts saem no horário fixo.",
      });
      void queryClient.invalidateQueries({ queryKey: ["mesa", "previsao", clientId] });
    } catch (e) {
      queryClient.setQueryData(chave, antes);
      toast.error("Não foi possível mudar o horário automático", { description: textoDoErro(e) });
    } finally {
      setTrocandoAutomatico(false);
    }
  };

  const p = previsao.data;
  useEffect(() => {
    if (!p || editando) return;
    setHora(p.hora_publicacao || "09:00");
    setAgendar(p.agendar_ao_aprovar);
    setPosts(p.posts_por_mes ? String(p.posts_por_mes) : "");
    setLaminas(p.laminas_por_post ? String(p.laminas_por_post) : "");
  }, [p, editando]);

  const inteiro = (v: string) => {
    const n = parseInt(v, 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  };

  const salvar = async () => {
    setSalvando(true);
    try {
      await salvarAjustesDaEntrega({
        clientId,
        horaPublicacao: hora || "09:00",
        fuso: p?.fuso || "America/Sao_Paulo",
        agendarAoAprovar: agendar,
        postsPorMes: inteiro(posts),
        laminasPorPost: inteiro(laminas),
      });
      toast.success("Ajustes salvos");
      setEditando(false);
      void queryClient.invalidateQueries({ queryKey: ["mesa", "previsao", clientId] });
    } catch (e) {
      toast.error("Ajustes não salvos", { description: textoDoErro(e) });
    } finally {
      setSalvando(false);
    }
  };

  if (previsao.isLoading) return null;
  if (previsao.isError) return <p className="rounded-lg border border-destructive/40 bg-card p-3 text-[12.5px] text-destructive">{textoDoErro(previsao.error)}</p>;

  const tipos = melhores.data ? Object.keys(melhores.data.por_tipo).filter((k) => !!melhores.data!.por_tipo[k]) : [];
  tipos.sort((a, b) => ORDEM_DOS_TIPOS.indexOf(a) - ORDEM_DOS_TIPOS.indexOf(b));
  const blocoDeHorarios = (
    <div className="min-w-0 space-y-2 rounded-lg border border-border bg-muted p-3">
      <div className="flex items-start">
        <Clock className="mr-2 mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <p className="text-[12.5px] font-medium">Melhores horários por tipo</p>
          <p className="text-[11.5px] leading-snug text-muted-foreground">
            {melhores.isLoading
              ? "Calculando..."
              : melhores.isError
                ? "Ainda indisponível. Os posts saem no horário fixo."
                : melhores.data && melhores.data.fonte === "historico"
                  ? `Pelo alcance de ${melhores.data.amostra} ${melhores.data.amostra === 1 ? "post publicado" : "posts publicados"} nos últimos 6 meses.`
                  : "Horário padrão do nicho: ainda não há histórico suficiente deste cliente."}
          </p>
        </div>
      </div>
      {tipos.length > 0 && (
        <ul className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
          {tipos.map((t) => (
            <li key={t} className="min-w-0 rounded-md border border-border bg-card px-2.5 py-1.5">
              <p className="truncate text-[11px] text-muted-foreground">{ROTULO_DO_TIPO[t] || t}</p>
              <p className="text-[14px] font-semibold tabular-nums">{melhores.data!.por_tipo[t]}</p>
            </li>
          ))}
        </ul>
      )}
      <label className={`flex items-center text-[12.5px] ${podeEditar ? "" : "opacity-70"}`}>
        <Switch
          checked={horarioAutomatico}
          onCheckedChange={(v) => void trocarAutomatico(v)}
          disabled={!podeEditar || trocandoAutomatico || automatico.isLoading}
          className="mr-2 shrink-0"
        />
        <span className="min-w-0">Horário automático pelos melhores horários</span>
      </label>
    </div>
  );

  return (
    <section className="space-y-3 rounded-xl border border-border bg-card p-3.5 text-[12.5px]">
      {!editando ? (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="min-w-0 space-y-1.5">
            <div className="flex items-start">
              <p className="min-w-0 flex-1 text-[13px] font-medium">Publicação e plano</p>
              {podeEditar && (
                <Button type="button" size="sm" variant="ghost" className="-mt-1 h-8 shrink-0 text-[12px]" onClick={() => setEditando(true)}>
                  <Pencil className="mr-1 h-3.5 w-3.5" /> Ajustar
                </Button>
              )}
            </div>
            <p className="leading-relaxed">
              {horarioAutomatico
                ? `Cada post sai no melhor horário do seu tipo, de segunda a sexta. Horário fixo de reserva: ${p?.hora_publicacao || "09:00"}.`
                : `Horário fixo: ${p?.hora_publicacao || "09:00"}, de segunda a sexta.`}{" "}
              {p?.agendar_ao_aprovar
                ? "Quando o cliente aprova, o post entra sozinho na Agenda."
                : "O agendamento automático está desligado: a equipe agenda pela Agenda."}
            </p>
            <p className="leading-relaxed text-muted-foreground">
              <span className="font-medium text-foreground">Plano:</span>{" "}
              {p?.posts_por_mes ? `${p.posts_por_mes} posts por mês` : "posts por mês não definidos"}
              {p?.laminas_por_post ? `, ${p.laminas_por_post} lâminas em média` : ""}
              {p ? ` · cerca de ${usd(p.custo_por_post_usd)} por post (${p.fonte === "historico" ? `média de ${p.amostra} ${p.amostra === 1 ? "arte" : "artes"}` : "pela tabela de preços"})` : ""}
              {p?.previsao_mes_usd != null ? ` · mês perto de ${usd(p.previsao_mes_usd)}` : ""}
              {p?.posts_que_o_saldo_cobre != null ? ` · o saldo cobre ${p.posts_que_o_saldo_cobre} ${p.posts_que_o_saldo_cobre === 1 ? "post" : "posts"}` : ""}
            </p>
          </div>
          {blocoDeHorarios}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="min-w-0 space-y-1.5">
              <Label htmlFor="mesa-hora">{horarioAutomatico ? "Horário fixo (reserva)" : "Horário fixo de publicação"}</Label>
              <Input id="mesa-hora" type="time" value={hora} onChange={(e) => setHora(e.target.value)} />
            </div>
            <div className="min-w-0 space-y-1.5">
              <Label htmlFor="mesa-posts">Posts por mês no plano</Label>
              <Input id="mesa-posts" inputMode="numeric" placeholder="Ex.: 12" value={posts} onChange={(e) => setPosts(e.target.value)} />
            </div>
            <div className="min-w-0 space-y-1.5">
              <Label htmlFor="mesa-laminas">Lâminas por post (média)</Label>
              <Input id="mesa-laminas" inputMode="numeric" placeholder="Ex.: 4" value={laminas} onChange={(e) => setLaminas(e.target.value)} />
            </div>
          </div>
          <label className="flex items-center">
            <Switch checked={agendar} onCheckedChange={setAgendar} className="mr-2 shrink-0" />
            <span className="min-w-0">Agendar sozinho na Agenda quando o cliente aprovar (segunda a sexta)</span>
          </label>
          {blocoDeHorarios}
          <div className="flex justify-end">
            <Button type="button" size="sm" variant="ghost" className="mr-2" onClick={() => setEditando(false)} disabled={salvando}>Cancelar</Button>
            <Button type="button" size="sm" onClick={() => void salvar()} disabled={salvando}>
              {salvando && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              Salvar
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
