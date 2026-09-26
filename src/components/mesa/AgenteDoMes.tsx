import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarRange, Check, ChevronDown, Eye, Loader2, MessagesSquare, Minus, Plus, RefreshCw, Sparkles, Trash2, Undo2, Wand2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { inicioDoMes, padraoPara, somarMeses, usd } from "@/lib/mesa/api";
import { OQuePossoFazer } from "@/components/agentes/CartaoDeAcao";
import { estimativaDaGeracao, iniciarGeracaoPeloAgente, useAndamentoDaGeracao } from "./PlanejamentoAutomatico";
import { raciocinioPadraoDaTela } from "./MesConhecimento";
import { AvisoDeErro, BotaoComCusto, useAvisarErro } from "./Custo";
import { ImagemDaMesa, useMesa } from "./MesaContexto";
import { BotaoDeAnexar, MiniaturasDosAnexos, useAnexos, ZonaDeAnexos } from "./AnexosDoPedido";
import { BlocoDaProposta } from "./ConteudosPropostos";
import { Cronometro } from "./Cronometro";
import { Ditado } from "./Ditado";
import {
  ajustarProposta,
  atualizarAgenda,
  chaves,
  diaCurto,
  lerCampanhas,
  lerConversaDoAgente,
  lerHypes,
  lerPropostas,
  partesDoPedido as partesDoPedidoLivre,
  pedidoLivre,
  periodoCurto,
  type MensagemDoAgente,
  type PropostaV4,
  partesDoAjuste,
  partesDoPedido,
} from "./mesaV4Api";
import {
  acaoNaAgendaDaMensagem,
  aplicarMudanca,
  chavesDoPlano,
  desfazerAcaoNaAgenda,
  ehPedidoNaAgenda,
  executarAcaoNaAgenda,
  geracaoDaMensagem,
  pedidoParaRefazer,
  registrarGeracao,
  type AcaoNaAgenda,
  type EdicaoDeCampanha,
  type GeracaoDeConteudos,
  corpoDoPlano,
  esquecerPlano,
  lerPlanosCombinados,
  mesesAPartirDe,
  mudancaDaMensagem,
  nomeDoMes,
  partesDoPlanejamento,
  planejarMes,
  planosDaMensagem,
  type ModoDoAgente,
  type MudancaSugerida,
  type PlanoCombinado,
} from "./planoDoMes";

/**
 * Agente do mês (pedido do dono em 23/09 e 24/09): a conversa com o
 * estrategista, aberta num pop-up grande no centro da tela (AbaMes). Dois
 * jeitos de falar com ele, na MESMA conversa (agente_conversas, referencia_tipo
 * agente_do_mes, uma por cliente):
 * - Planejar o mês: conversa de verdade sobre estratégia, datas, campanhas,
 *   frequência, formatos e pilares deste mês e dos próximos (planejar_mes). O
 *   que ficar combinado vira o plano do mês, que o gerador de meses segue.
 *   Mudança na proposta do mês chega como sugestão, com a diferença, e só
 *   entra quando a equipe clica em Aplicar.
 * - Criar conteúdos: a equipe pede em português ("prepare três conteúdos
 *   para a campanha X", "a agenda de hoje", "arte de depoimentos com estes
 *   prints"), anexa imagens e recebe os conteúdos prontos para gravar
 *   (pedido_livre). Cada conteúdo tem a lixeira para apagar o que não serviu.
 */

export interface PedidoEmAndamento {
  mensagem: string;
  desde: number;
}

const SEM_CAMPANHA = "nenhuma";

/** Atalhos de ação na agenda (o agente prepara a lista e a equipe confirma). */
const ATALHOS_DE_ACAO = (nomeDoMes: string) => [
  { rotulo: `Criar todos os conteúdos de ${nomeDoMes}`, texto: `Crie todos os conteúdos de ${nomeDoMes}.` },
  { rotulo: "Refazer conteúdos", texto: "Refaça os conteúdos " },
];
const CHAVE_DO_MODO = "mesa:agente:modo";

const chaveDasEscondidas = (clientId: string) => `mesa:agente:escondidas:${clientId}`;

function lerEscondidas(clientId: string): string[] {
  try {
    const v = JSON.parse(window.sessionStorage.getItem(chaveDasEscondidas(clientId)) || "[]");
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

function gravarEscondidas(clientId: string, lista: string[]) {
  try {
    window.sessionStorage.setItem(chaveDasEscondidas(clientId), JSON.stringify(lista.slice(-200)));
  } catch {
    /* sem armazenamento: vale só nesta visita */
  }
}

function lerModo(): ModoDoAgente {
  try {
    return window.localStorage.getItem(CHAVE_DO_MODO) === "criar" ? "criar" : "planejar";
  } catch {
    return "planejar";
  }
}

const propostasDaMensagem = (m: MensagemDoAgente) =>
  (m.anexos || []).map((a) => (a && a.proposta_id ? String(a.proposta_id) : "")).filter(Boolean);

const imagensDaMensagem = (m: MensagemDoAgente) =>
  (m.anexos || []).map((a) => (a && a.caminho ? String(a.caminho) : "")).filter(Boolean);

function Bolha({ papel, children }: { papel: "usuario" | "agente"; children: ReactNode }) {
  return (
    <div
      className={`min-w-0 rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed [overflow-wrap:anywhere] ${
        papel === "usuario" ? "ml-10 rounded-br-md bg-primary text-primary-foreground" : "mr-6 rounded-bl-md bg-muted text-foreground"
      }`}
    >
      {children}
    </div>
  );
}

// ------------------------------------------------------------------ mudança sugerida

function LinhaDaDiferenca({ sinal, titulo, detalhe }: { sinal: "entra" | "sai" | "muda"; titulo: string; detalhe: string }) {
  const Icone = sinal === "entra" ? Plus : sinal === "sai" ? Minus : RefreshCw;
  const cor = sinal === "entra" ? "text-success" : sinal === "sai" ? "text-destructive" : "text-primary";
  return (
    <li className="flex min-w-0 items-start py-1 text-[12px] leading-snug">
      <Icone className={`mr-1.5 mt-0.5 h-3.5 w-3.5 shrink-0 ${cor}`} />
      <span className="min-w-0 [overflow-wrap:anywhere]">
        <span className="font-medium">{titulo}</span>
        {detalhe && <span className="text-muted-foreground"> · {detalhe}</span>}
      </span>
    </li>
  );
}

/**
 * A mudança que o agente sugeriu na proposta do mês: o que entra, sai e muda,
 * visível ANTES de aplicar. Aplicar não gasta IA (o agente já respondeu).
 */
export function CartaoDaMudanca({ mensagemId, mudanca }: { mensagemId: string; mudanca: MudancaSugerida }) {
  const { clientId } = useMesa();
  const queryClient = useQueryClient();
  const avisarErro = useAvisarErro();
  const [fazendo, setFazendo] = useState<"aplicar" | "descartar" | null>(null);
  const [estado, setEstado] = useState<"aberta" | "aplicada" | "descartada">(
    mudanca.aplicada_em ? "aplicada" : mudanca.descartada_em ? "descartada" : "aberta",
  );
  const d = mudanca.diferenca;
  const formato = (f?: string) => (f === "estatico" ? "estático" : f || "");

  const agir = async (descartar: boolean) => {
    setFazendo(descartar ? "descartar" : "aplicar");
    try {
      const data = await aplicarMudanca(mensagemId, descartar);
      setEstado(descartar ? "descartada" : "aplicada");
      if (!descartar) {
        if (data && data.proposta) queryClient.setQueryData(chaves.proposta(mudanca.alvo_proposta_id), data.proposta);
        atualizarAgenda(queryClient, clientId);
        toast.success("Mudanças aplicadas na proposta", { description: "Revise e grave na agenda quando estiver pronta." });
      }
      void queryClient.invalidateQueries({ queryKey: chaves.agente(clientId) });
    } catch (e) {
      avisarErro(e, descartar ? "Não foi possível descartar" : "Não foi possível aplicar");
    } finally {
      setFazendo(null);
    }
  };

  return (
    <section className="mr-6 min-w-0 rounded-2xl border border-primary/30 bg-card p-3.5" data-mudanca={estado}>
      <p className="flex items-center text-[12px] font-semibold">
        <Wand2 className="mr-1.5 h-3.5 w-3.5 text-primary" />
        Mudança sugerida na proposta{mudanca.periodo ? ` de ${periodoCurto(mudanca.periodo.inicio, mudanca.periodo.fim)}` : ""}
      </p>
      {mudanca.resumo && <p className="mt-1 text-[12.5px] leading-relaxed [overflow-wrap:anywhere]">{mudanca.resumo}</p>}
      {d && (
        <ul className="mt-2 divide-y divide-border rounded-lg border border-border bg-background px-2.5 py-1">
          {d.entram.map((i) => <LinhaDaDiferenca key={`e-${i.tema_id}`} sinal="entra" titulo={i.tema} detalhe={`${diaCurto(i.data)} · ${formato(i.formato)}`} />)}
          {d.saem.map((i) => <LinhaDaDiferenca key={`s-${i.tema_id}`} sinal="sai" titulo={i.tema} detalhe={diaCurto(i.data)} />)}
          {d.mudam.map((i) => (
            <LinhaDaDiferenca
              key={`m-${i.tema_id}`}
              sinal="muda"
              titulo={i.tema}
              detalhe={[i.data_antes ? `${diaCurto(i.data_antes)} para ${diaCurto(i.data)}` : "", i.campos.filter((c) => c !== "data").join(", ")].filter(Boolean).join(" · ")}
            />
          ))}
          {d.temas_entram.map((t) => <LinhaDaDiferenca key={`te-${t}`} sinal="entra" titulo={t} detalhe="tema novo" />)}
          {d.temas_saem.map((t) => <LinhaDaDiferenca key={`ts-${t}`} sinal="sai" titulo={t} detalhe="tema sai" />)}
          {d.temas_mudam.map((t) => <LinhaDaDiferenca key={`tm-${t}`} sinal="muda" titulo={t} detalhe="tema reescrito" />)}
        </ul>
      )}
      {(mudanca.ajustes || []).length > 0 && (
        <p className="mt-1.5 text-[11.5px] leading-snug text-muted-foreground [overflow-wrap:anywhere]">{(mudanca.ajustes || []).join(" ")}</p>
      )}
      <div className="mt-2.5 flex flex-wrap items-center">
        {estado === "aberta" ? (
          <>
            <Button type="button" size="sm" className="mb-1 mr-1.5 h-8" onClick={() => void agir(false)} disabled={!!fazendo}>
              {fazendo === "aplicar" ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Check className="mr-1.5 h-3.5 w-3.5" />}
              Aplicar na proposta
            </Button>
            <Button type="button" size="sm" variant="ghost" className="mb-1 h-8 text-muted-foreground" onClick={() => void agir(true)} disabled={!!fazendo}>
              {fazendo === "descartar" && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              Descartar
            </Button>
            <span className="mb-1 ml-auto text-[11px] text-muted-foreground">Sem custo: nada muda até aplicar.</span>
          </>
        ) : (
          <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11.5px] ${estado === "aplicada" ? "bg-success/15 text-foreground" : "bg-muted text-muted-foreground"}`}>
            {estado === "aplicada" ? <Check className="mr-1 h-3 w-3" /> : <X className="mr-1 h-3 w-3" />}
            {estado === "aplicada" ? "Aplicada na proposta" : "Descartada"}
          </span>
        )}
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ ação na agenda

const ROTULO_DO_ESTADO_DA_CAMPANHA: Record<string, string> = { planejada: "planejada", gravada: "gravada", encerrada: "encerrada" };

function camposDaCampanha(c: EdicaoDeCampanha["campos"]): string {
  const partes: string[] = [];
  if (c.nome) partes.push(`nome: ${c.nome}`);
  if (c.status) partes.push(`estado: ${ROTULO_DO_ESTADO_DA_CAMPANHA[c.status] || c.status}`);
  if (c.periodo_inicio || c.periodo_fim) partes.push(`período: ${c.periodo_inicio ? diaCurto(c.periodo_inicio) : "igual"} a ${c.periodo_fim ? diaCurto(c.periodo_fim) : "igual"}`);
  return partes.join(" · ");
}

/**
 * O que o agente vai fazer na agenda já gravada (apagar, refazer, mudar a
 * data ou o formato) e nas campanhas, item por item. Só acontece ao
 * confirmar; depois, dá para desfazer. Refazer tira da agenda e gera de novo
 * pelo pedido livre: o custo aparece no botão antes de confirmar.
 */
export function CartaoDaAcaoNaAgenda({ mensagemId, acao }: { mensagemId: string; acao: AcaoNaAgenda }) {
  const { clientId, catalogo } = useMesa();
  const queryClient = useQueryClient();
  const avisarErro = useAvisarErro();
  const [fazendo, setFazendo] = useState<"confirmar" | "descartar" | "desfazer" | null>(null);
  const [atual, setAtual] = useState<AcaoNaAgenda>(acao);
  const estado = atual.desfeita_em ? "desfeita" : atual.executada_em ? "feita" : atual.descartada_em ? "descartada" : "aberta";
  const total = atual.apagar.length + atual.mudar_data.length + atual.mudar_formato.length + atual.refazer.length + atual.editar_campanhas.length;
  const todos = (atual.resultados || []).concat(atual.mudancas || [], atual.formatos || [], atual.refeitos || []);
  const campanhasFeitas = atual.campanhas_editadas || [];
  const falhas = todos.filter((r) => !r.ok).length + campanhasFeitas.filter((r) => !r.ok).length;
  const motivoDe = (taskId: string, lista?: typeof todos) => {
    const r = (lista || todos).find((x) => x.task_id === taskId);
    return r && !r.ok ? r.motivo || "Não foi possível." : null;
  };
  const refazendo = atual.refazer.length > 0;

  const depois = (tipo: "confirmar" | "descartar" | "desfazer", data: any) => {
    if (data && data.anexo) setAtual(acaoNaAgendaDaMensagem([data.anexo]) || atual);
    if (tipo !== "descartar") {
      atualizarAgenda(queryClient, clientId);
      if (tipo === "confirmar") {
        const partes = [
          data.apagados ? `${data.apagados} ${data.apagados === 1 ? "peça apagada" : "peças apagadas"}` : "",
          data.refeitos ? `${data.refeitos} ${data.refeitos === 1 ? "peça refeita" : "peças refeitas"}` : "",
          data.movidos ? `${data.movidos} ${data.movidos === 1 ? "data mudada" : "datas mudadas"}` : "",
          data.formatos ? `${data.formatos} ${data.formatos === 1 ? "formato mudado" : "formatos mudados"}` : "",
          data.campanhas ? `${data.campanhas} ${data.campanhas === 1 ? "campanha editada" : "campanhas editadas"}` : "",
        ].filter(Boolean);
        toast.success(partes.join(" e ") || "Nada mudou", {
          description: data.falhas ? `${data.falhas} não ${data.falhas === 1 ? "pôde ser feita" : "puderam ser feitas"}. O motivo está na lista.` : "Dá para desfazer no cartão.",
        });
      } else {
        toast.success("Agenda como estava", { description: `${data.voltaram || 0} ${data.voltaram === 1 ? "item voltou" : "itens voltaram"}.` });
      }
    }
    void queryClient.invalidateQueries({ queryKey: chaves.agente(clientId) });
  };

  const agir = async (tipo: "confirmar" | "descartar" | "desfazer") => {
    setFazendo(tipo);
    try {
      const data = tipo === "desfazer" ? await desfazerAcaoNaAgenda(mensagemId) : await executarAcaoNaAgenda(mensagemId, tipo === "descartar");
      depois(tipo, data);
    } catch (e) {
      avisarErro(e, tipo === "desfazer" ? "Não foi possível desfazer" : tipo === "descartar" ? "Não foi possível cancelar" : "Não foi possível mexer na agenda");
    } finally {
      setFazendo(null);
    }
  };

  // Refazer: tira da agenda e, com o que saiu de fato, pede ao agente os conteúdos novos (mesmo fluxo do Criar conteúdos).
  const confirmarERefazer = async () => {
    setFazendo("confirmar");
    try {
      const data = await executarAcaoNaAgenda(mensagemId, false);
      depois("confirmar", data);
      const novo = data && data.anexo ? acaoNaAgendaDaMensagem([data.anexo]) : null;
      const sairam = (novo && novo.refeitos ? novo.refeitos : []).filter((r) => r.ok && !r.motivo).map((r) => r.task_id);
      const itens = atual.refazer.filter((i) => sairam.indexOf(i.task_id) >= 0);
      if (!itens.length) return data;
      const nova = await pedidoLivre({ clientId, mensagem: pedidoParaRefazer(itens), anexos: [], campanhaId: null });
      await queryClient.invalidateQueries({ queryKey: chaves.agente(clientId) });
      return nova;
    } finally {
      setFazendo(null);
    }
  };

  const linha = (i: AcaoNaAgenda["apagar"][number], sinal: "sai" | "muda" | "formato" | "refaz") => {
    const motivo = motivoDe(i.task_id, sinal === "sai" ? atual.resultados : sinal === "muda" ? atual.mudancas : sinal === "formato" ? atual.formatos : atual.refeitos);
    const quando =
      sinal === "muda" && i.para
        ? `${i.data ? diaCurto(i.data) : "sem data"} para ${diaCurto(i.para)}`
        : `${i.data ? diaCurto(i.data) : "sem data"}${sinal === "formato" ? ` · ${i.formato} para ${i.formato_para_nome || i.formato_para || ""}` : ""}`;
    const Icone = sinal === "sai" ? Trash2 : sinal === "refaz" ? Sparkles : RefreshCw;
    return (
      <li key={`${sinal}-${i.task_id}`} className="flex min-w-0 items-start py-1 text-[12px] leading-snug">
        <Icone className={`mr-1.5 mt-0.5 h-3.5 w-3.5 shrink-0 ${sinal === "sai" ? "text-destructive" : "text-primary"}`} />
        <span className="min-w-0 [overflow-wrap:anywhere]">
          {sinal === "refaz" && <span className="text-muted-foreground">Refazer: </span>}
          <span className="font-medium">{i.titulo}</span>
          <span className="text-muted-foreground"> · {quando}{sinal !== "formato" && i.formato ? ` · ${i.formato}` : ""}</span>
          {motivo && <span className="block text-[11.5px] text-destructive">{motivo}</span>}
        </span>
      </li>
    );
  };

  return (
    <section className="mr-6 min-w-0 rounded-2xl border border-destructive/30 bg-card p-3.5" data-acao-agenda={estado}>
      <p className="flex items-center text-[12px] font-semibold">
        <CalendarRange className="mr-1.5 h-3.5 w-3.5 text-destructive" />
        Mudança na agenda gravada · {total} {total === 1 ? "item" : "itens"}
      </p>
      {atual.resumo && <p className="mt-1 text-[12.5px] leading-relaxed [overflow-wrap:anywhere]">{atual.resumo}</p>}
      <ul className="mt-2 max-h-72 divide-y divide-border overflow-y-auto rounded-lg border border-border bg-background px-2.5 py-1">
        {atual.apagar.map((i) => linha(i, "sai"))}
        {atual.refazer.map((i) => linha(i, "refaz"))}
        {atual.mudar_data.map((i) => linha(i, "muda"))}
        {atual.mudar_formato.map((i) => linha(i, "formato"))}
        {atual.editar_campanhas.map((c) => {
          const r = campanhasFeitas.find((x) => x.campanha_id === c.campanha_id);
          return (
            <li key={`c-${c.campanha_id}`} className="flex min-w-0 items-start py-1 text-[12px] leading-snug">
              <Wand2 className="mr-1.5 mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
              <span className="min-w-0 [overflow-wrap:anywhere]">
                <span className="text-muted-foreground">Campanha: </span>
                <span className="font-medium">{c.nome_atual}</span>
                <span className="text-muted-foreground"> · {camposDaCampanha(c.campos)}</span>
                {r && !r.ok && <span className="block text-[11.5px] text-destructive">{r.motivo || "Não foi possível."}</span>}
              </span>
            </li>
          );
        })}
      </ul>
      <div className="mt-2.5 flex flex-wrap items-center">
        {estado === "aberta" && (
          <>
            {refazendo ? (
              <BotaoComCusto
                rotulo={`Confirmar e refazer ${atual.refazer.length}`}
                titulo="Refazer conteúdos"
                descricao="Tira as peças da agenda e o agente gera conteúdos novos nas mesmas datas e formatos, prontos para gravar."
                partes={() => partesDoPedidoLivre(catalogo, 0)}
                executar={confirmarERefazer}
                fecharAoConfirmar
                disabled={!!fazendo}
                className="mb-1 mr-1.5 h-8"
              />
            ) : (
              <Button type="button" size="sm" variant="destructive" className="mb-1 mr-1.5 h-8" onClick={() => void agir("confirmar")} disabled={!!fazendo}>
                {fazendo === "confirmar" ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Check className="mr-1.5 h-3.5 w-3.5" />}
                {atual.apagar.length && total === atual.apagar.length ? `Confirmar e apagar ${atual.apagar.length}` : "Confirmar"}
              </Button>
            )}
            <Button type="button" size="sm" variant="ghost" className="mb-1 h-8 text-muted-foreground" onClick={() => void agir("descartar")} disabled={!!fazendo}>
              {fazendo === "descartar" && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              Cancelar
            </Button>
            <span className="mb-1 ml-auto text-[11px] text-muted-foreground">
              {refazendo ? "A arte já feita fica guardada no Estúdio, e dá para desfazer." : "Sem custo. A arte já feita fica guardada no Estúdio, e dá para desfazer."}
            </span>
          </>
        )}
        {estado === "feita" && (
          <>
            <span className="mb-1 mr-2 inline-flex items-center rounded-full bg-success/15 px-2.5 py-1 text-[11.5px] text-foreground">
              <Check className="mr-1 h-3 w-3" />
              Feito{falhas ? ` · ${falhas} não ${falhas === 1 ? "pôde" : "puderam"}` : ""}
            </span>
            <Button type="button" size="sm" variant="outline" className="mb-1 h-8" onClick={() => void agir("desfazer")} disabled={!!fazendo}>
              {fazendo === "desfazer" ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Undo2 className="mr-1.5 h-3.5 w-3.5" />}
              Desfazer
            </Button>
          </>
        )}
        {(estado === "descartada" || estado === "desfeita") && (
          <span className="inline-flex items-center rounded-full bg-muted px-2.5 py-1 text-[11.5px] text-muted-foreground">
            <X className="mr-1 h-3 w-3" />
            {estado === "desfeita" ? "Desfeito: a agenda voltou como estava" : "Cancelado: nada mudou"}
          </span>
        )}
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ gerar meses inteiros

/**
 * "Crie todos os conteúdos de outubro": o agente propõe os meses e a
 * frequência; o custo aparece no botão e só ao confirmar o gerador de meses
 * (o mesmo do "Planejar e preencher a agenda") começa. O andamento aparece
 * aqui e na aba Mês.
 */
export function CartaoDaGeracao({ mensagemId, geracao }: { mensagemId: string; geracao: GeracaoDeConteudos }) {
  const mesa = useMesa();
  const { clientId, catalogo } = mesa;
  const queryClient = useQueryClient();
  const avisarErro = useAvisarErro();
  const [atual, setAtual] = useState<GeracaoDeConteudos>(geracao);
  const [cancelando, setCancelando] = useState(false);
  const andamento = useAndamentoDaGeracao(clientId);
  const padrao = padraoPara(catalogo, "estrategista");
  const modeloId = padrao ? padrao.id : "";
  const raciocinio = padrao ? raciocinioPadraoDaTela(padrao.raciocinio) : undefined;
  const meses = atual.meses.map((m) => `${m.slice(0, 7)}-01`);
  const estimativa = estimativaDaGeracao({ meses, frequenciaSemanal: atual.frequencia_semanal, modeloId, raciocinio });
  const estado = atual.executada_em ? "feita" : atual.descartada_em ? "descartada" : "aberta";

  const comecar = async () => {
    if (!atual.project_id) throw new Error("O cliente não tem projeto de social ativo. Crie o projeto e peça de novo.");
    const data = await registrarGeracao(mensagemId);
    if (data && data.anexo) setAtual({ ...atual, ...(data.anexo as GeracaoDeConteudos) });
    const rodada = iniciarGeracaoPeloAgente(
      { clientId, queryClient, atualizarCusto: mesa.atualizarCusto },
      { meses, frequenciaSemanal: atual.frequencia_semanal, modeloId, raciocinio, projetoId: atual.project_id },
    );
    if (!rodada) throw new Error("Já há uma geração de meses em andamento para este cliente. Espere terminar.");
    void rodada.then((r) => {
      const aviso = r.falhas ? toast.warning : toast.success;
      aviso("Conteúdos do agente do mês", { description: `${r.gravados} ${r.gravados === 1 ? "mês gravado" : "meses gravados"}${r.falhas ? `, ${r.falhas} com erro (tente pela aba Mês)` : ""}. Custo real: ${usd(r.custo_usd)}.` });
    });
    return { custo_usd: null };
  };

  const cancelar = async () => {
    setCancelando(true);
    try {
      const data = await registrarGeracao(mensagemId, true);
      if (data && data.anexo) setAtual({ ...atual, ...(data.anexo as GeracaoDeConteudos) });
    } catch (e) {
      avisarErro(e, "Não foi possível cancelar");
    } finally {
      setCancelando(false);
    }
  };

  return (
    <section className="mr-6 min-w-0 rounded-2xl border border-primary/30 bg-card p-3.5" data-geracao={estado}>
      <p className="flex items-center text-[12px] font-semibold">
        <CalendarRange className="mr-1.5 h-3.5 w-3.5 text-primary" />
        Gerar os conteúdos · {atual.meses.length} {atual.meses.length === 1 ? "mês" : "meses"}
      </p>
      {atual.resumo && <p className="mt-1 text-[12.5px] leading-relaxed [overflow-wrap:anywhere]">{atual.resumo}</p>}
      <p className="mt-1.5 text-[12px] text-muted-foreground [overflow-wrap:anywhere]">
        <span className="capitalize">{atual.meses.map((m) => nomeDoMes(m)).join(", ")}</span> · {atual.frequencia_semanal} por semana · cerca de {estimativa.total}{" "}
        {estimativa.total === 1 ? "publicação" : "publicações"}
        {atual.projeto_nome ? ` · projeto ${atual.projeto_nome}` : ""}. Segue o plano combinado de cada mês.
      </p>
      <div className="mt-2.5 flex flex-wrap items-center">
        {estado === "aberta" && (
          <>
            <BotaoComCusto
              rotulo={`Confirmar e gerar ${atual.meses.length} ${atual.meses.length === 1 ? "mês" : "meses"}`}
              titulo="Gerar os conteúdos do mês"
              descricao="Para cada mês: propõe temas, escolhe os melhores pela nota do Jev, detalha e grava na agenda."
              partes={() => estimativa.partes}
              executar={comecar}
              fecharAoConfirmar
              disabled={!modeloId || !atual.project_id || cancelando || !!(andamento && andamento.rodando)}
              className="mb-1 mr-1.5 h-8"
            />
            <Button type="button" size="sm" variant="ghost" className="mb-1 h-8 text-muted-foreground" onClick={() => void cancelar()} disabled={cancelando}>
              {cancelando && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              Cancelar
            </Button>
            {!atual.project_id && <span className="mb-1 ml-auto text-[11px] text-destructive">Cliente sem projeto de social ativo.</span>}
          </>
        )}
        {estado === "feita" && (
          <span className="inline-flex items-center rounded-full bg-success/15 px-2.5 py-1 text-[11.5px] text-foreground">
            {andamento && andamento.rodando ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Check className="mr-1 h-3 w-3" />}
            {andamento
              ? `${andamento.gravados} de ${andamento.total} ${andamento.total === 1 ? "mês gravado" : "meses gravados"}${andamento.falhas ? ` · ${andamento.falhas} com erro` : ""}`
              : "Geração começada. O andamento fica na aba Mês."}
          </span>
        )}
        {estado === "descartada" && (
          <span className="inline-flex items-center rounded-full bg-muted px-2.5 py-1 text-[11.5px] text-muted-foreground">
            <X className="mr-1 h-3 w-3" />
            Cancelado: nada foi gerado
          </span>
        )}
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ planos combinados

function CartaoDoPlano({ plano, destaque, onEsquecer }: { plano: PlanoCombinado; destaque: boolean; onEsquecer: () => void }) {
  const [aberto, setAberto] = useState(destaque);
  useEffect(() => setAberto(destaque), [destaque]);
  return (
    <li className={`min-w-0 rounded-xl border px-3 py-2.5 ${destaque ? "border-primary/40 bg-card" : "border-border bg-background"}`}>
      <button type="button" onClick={() => setAberto((v) => !v)} className="flex w-full min-w-0 items-center text-left" aria-expanded={aberto}>
        <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold capitalize">{nomeDoMes(plano.mes)}</span>
        <ChevronDown className={`ml-1 h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${aberto ? "rotate-180" : ""}`} />
      </button>
      {aberto && (
        <>
          <p className="mt-1.5 whitespace-pre-wrap text-[12px] leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">{corpoDoPlano(plano.texto)}</p>
          <button type="button" onClick={onEsquecer} className="mt-1.5 text-[11px] text-muted-foreground underline-offset-2 hover:text-destructive hover:underline">
            Esquecer este plano
          </button>
        </>
      )}
    </li>
  );
}

function PainelDosPlanos({ planos, mes, onEsquecer }: { planos: PlanoCombinado[]; mes: string; onEsquecer: (p: PlanoCombinado) => void }) {
  const alvo = mes.slice(0, 7);
  const aPartir = somarMeses(inicioDoMes(), -1).slice(0, 7);
  const visiveis = planos.filter((p) => p.mes >= aPartir);
  return (
    <div className="min-w-0 space-y-2.5">
      <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">O que ficou combinado</p>
      {visiveis.length === 0 ? (
        <p className="text-[12px] leading-relaxed text-muted-foreground">
          Nada combinado ainda. Converse sobre o mês: o que ficar decidido aparece aqui e o gerador de meses segue.
        </p>
      ) : (
        <ul className="space-y-2">
          {visiveis.map((p) => <CartaoDoPlano key={p.id} plano={p} destaque={p.mes === alvo} onEsquecer={() => onEsquecer(p)} />)}
        </ul>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ agente

export default function AgenteDoMes({
  onAbrirNoEstudio,
  pendenteExterno = null,
  className = "",
  acaoDoCabecalho = null,
  mesInicial,
  modoInicial,
  painelDoPlano = false,
}: {
  onAbrirNoEstudio?: (taskId: string, mes: string) => void;
  /** Pedido que outra parte da tela mandou (ex.: "Criar conteúdo" de um hype). */
  pendenteExterno?: PedidoEmAndamento | null;
  className?: string;
  /** Botão extra no cabeçalho (ex.: fechar o pop-up). */
  acaoDoCabecalho?: ReactNode;
  /** Mês em conversa (AAAA-MM-01); sem ele, o mês corrente. */
  mesInicial?: string;
  /** Sem ele, o último modo usado (ou Planejar o mês). */
  modoInicial?: ModoDoAgente;
  /** Coluna ao lado com o que ficou combinado (tela larga). */
  painelDoPlano?: boolean;
}) {
  const mesa = useMesa();
  const { clientId, catalogo } = mesa;
  const queryClient = useQueryClient();
  const avisarErro = useAvisarErro();
  const anexos = useAnexos(clientId);
  const [modo, setModo] = useState<ModoDoAgente>(() => modoInicial || lerModo());
  const [mes, setMes] = useState(() => (mesInicial && /^\d{4}-\d{2}-01$/.test(mesInicial) ? mesInicial : inicioDoMes()));
  const [texto, setTexto] = useState("");
  const [campanhaId, setCampanhaId] = useState(SEM_CAMPANHA);
  const [ajustando, setAjustando] = useState<PropostaV4 | null>(null);
  const [envio, setEnvio] = useState<PedidoEmAndamento | null>(null);
  const [escondidas, setEscondidas] = useState<string[]>(() => lerEscondidas(clientId));
  const [projetoDaResposta, setProjetoDaResposta] = useState<Record<string, string>>({});
  const [planoAberto, setPlanoAberto] = useState(false);
  const campoRef = useRef<HTMLTextAreaElement>(null);
  const listaRef = useRef<HTMLDivElement>(null);
  const enviados = useRef<string[]>([]);

  useEffect(() => {
    if (mesInicial && /^\d{4}-\d{2}-01$/.test(mesInicial)) setMes(mesInicial);
  }, [mesInicial]);

  const trocarModo = (m: ModoDoAgente) => {
    setModo(m);
    if (m === "planejar") setAjustando(null);
    try {
      window.localStorage.setItem(CHAVE_DO_MODO, m);
    } catch {
      /* sem armazenamento: vale só nesta visita */
    }
  };

  const conversa = useQuery({ queryKey: chaves.conversa(clientId), queryFn: () => lerConversaDoAgente(clientId) });
  const mensagens = conversa.data ? conversa.data.mensagens : [];
  const ids = useMemo(() => {
    const todos: string[] = [];
    mensagens.forEach((m) => propostasDaMensagem(m).forEach((id) => { if (todos.indexOf(id) < 0) todos.push(id); }));
    return todos.sort();
  }, [mensagens]);
  const propostas = useQuery({
    queryKey: chaves.propostas(clientId, ids),
    enabled: ids.length > 0,
    // A chave cresce a cada mensagem nova: as propostas já na tela ficam
    // enquanto a lista nova chega (sem piscar para o esqueleto).
    placeholderData: keepPreviousData,
    queryFn: () => lerPropostas(ids),
  });
  const campanhas = useQuery({ queryKey: chaves.campanhas(clientId), queryFn: () => lerCampanhas(clientId) });
  const hypes = useQuery({ queryKey: chaves.hypes(clientId), queryFn: () => lerHypes(clientId) });
  const planos = useQuery({ queryKey: chavesDoPlano.planos(clientId), queryFn: () => lerPlanosCombinados(clientId) });

  const porId: Record<string, PropostaV4> = {};
  (propostas.data || []).forEach((p) => { porId[p.id] = p; });
  const campanhasAtivas = (campanhas.data || []).filter((c) => c.status !== "encerrada");
  const campanhaEscolhida = campanhasAtivas.find((c) => c.id === campanhaId) || null;
  const listaDePlanos = planos.data || [];
  const planoDoMes = listaDePlanos.find((p) => p.mes === mes.slice(0, 7)) || null;

  const andamento = envio || pendenteExterno;
  const planejando = modo === "planejar";

  // Mensagem nova ou pedido em andamento: desce até o fim da conversa.
  useEffect(() => {
    const el = listaRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [mensagens.length, !!andamento, propostas.data]);

  const esconder = (id: string) => {
    const nova = escondidas.concat([id]);
    setEscondidas(nova);
    gravarEscondidas(clientId, nova);
  };
  const mostrar = (id: string) => {
    const nova = escondidas.filter((x) => x !== id);
    setEscondidas(nova);
    gravarEscondidas(clientId, nova);
  };

  const preencher = (t: string) => {
    setTexto(t);
    window.setTimeout(() => {
      const el = campoRef.current;
      if (el) {
        el.focus();
        el.setSelectionRange(t.length, t.length);
      }
    }, 0);
  };

  const esquecer = async (p: PlanoCombinado) => {
    try {
      await esquecerPlano(p.id, clientId);
      void queryClient.invalidateQueries({ queryKey: chavesDoPlano.planos(clientId) });
      toast.success(`Plano de ${nomeDoMes(p.mes)} esquecido`, { description: "O gerador de meses deixa de seguir este plano." });
    } catch (e) {
      avisarErro(e, "Não foi possível esquecer o plano");
    }
  };

  const nome = nomeDoMes(mes);
  const topoDosHypes = hypes.data && hypes.data.itens.length ? hypes.data.itens[0] : null;
  const atalhos = planejando
    ? [
        { rotulo: `Como planejar ${nome}?`, texto: `Vamos planejar ${nome}. Olhando o que já foi publicado, as métricas e a agenda, qual deve ser a estratégia do mês?` },
        { rotulo: "Datas, campanhas e hypes", texto: `Quais datas, campanhas e hypes devem entrar em ${nome}?` },
        { rotulo: "Frequência e formatos", texto: `Qual frequência e quais formatos fazem sentido para ${nome}, olhando as métricas?` },
        { rotulo: "Os próximos 3 meses", texto: "Vamos desenhar os próximos 3 meses: o foco, os pilares e as datas de cada um." },
      ]
    : [
        { rotulo: "Prepare a agenda de hoje", texto: "Prepare a agenda de hoje." },
        {
          rotulo: "3 conteúdos para a campanha…",
          texto: campanhaEscolhida ? `Prepare 3 conteúdos para a campanha ${campanhaEscolhida.nome}.` : "Prepare 3 conteúdos para a campanha ",
        },
        { rotulo: "Arte de depoimentos com estes prints", texto: "Faça uma arte de depoimentos de clientes com estes prints das avaliações do Google, transcrevendo as falas como estão." },
        {
          rotulo: "Um conteúdo sobre o hype da semana",
          texto: topoDosHypes ? `Um conteúdo sobre o hype da semana "${topoDosHypes.titulo}".${topoDosHypes.como_usar ? ` ${topoDosHypes.como_usar}` : ""}` : "Um conteúdo sobre o hype da semana que mais combina com este cliente.",
        },
      ];

  const partes = () =>
    ajustando
      ? partesDoAjuste(catalogo)
      : planejando
        ? partesDoPlanejamento(catalogo, anexos.caminhos.length)
        : partesDoPedido(catalogo, anexos.caminhos.length);

  const enviar = async () => {
    const mensagem = texto.trim();
    const caminhos = anexos.caminhos.slice();
    enviados.current = caminhos;
    setEnvio({ mensagem, desde: Date.now() });
    setTexto("");
    try {
      // Apagar, limpar ou mudar a data de peças já gravadas: quem faz é o agente
      // que planeja o mês (ele lê a agenda e prepara a lista para confirmar).
      const naAgenda = !ajustando && !planejando && ehPedidoNaAgenda(mensagem);
      const data = ajustando
        ? await ajustarProposta(ajustando.id, mensagem)
        : planejando || naAgenda
          ? await planejarMes({ clientId, mensagem, mes, anexos: caminhos })
          : await pedidoLivre({ clientId, mensagem, anexos: caminhos, campanhaId: campanhaEscolhida ? campanhaEscolhida.id : null });
      // A resposta entra na conversa antes de o "Preparando" sair da tela.
      await queryClient.invalidateQueries({ queryKey: chaves.agente(clientId) });
      if (planejando) void queryClient.invalidateQueries({ queryKey: chavesDoPlano.planos(clientId) });
      return data;
    } catch (e) {
      setTexto((t) => t || mensagem);
      throw e;
    } finally {
      setEnvio(null);
    }
  };

  const concluir = (data: any) => {
    anexos.tirarEnviados(enviados.current);
    setAjustando(null);
    const p = data && data.proposta;
    if (p && p.id) {
      queryClient.setQueryData(chaves.proposta(p.id), p);
      if (data.project_id) setProjetoDaResposta((m) => ({ ...m, [p.id]: String(data.project_id) }));
    }
  };

  const lista = mensagens.filter((m) => m.conteudo || propostasDaMensagem(m).length || imagensDaMensagem(m).length);
  const opcoesDeMes = useMemo(() => {
    const base = mesesAPartirDe(inicioDoMes(), 12);
    return base.indexOf(mes) >= 0 ? base : [mes].concat(base);
  }, [mes]);

  const conversaVazia = conversa.data && lista.length === 0 && !andamento;

  return (
    <div className={`flex min-h-0 min-w-0 flex-col bg-card ${className}`}>
      {/* Cabeçalho: nome, os dois jeitos de falar e o botão de fechar. */}
      <div className="flex shrink-0 flex-wrap items-center border-b border-border px-4 py-3 pr-12 sm:flex-nowrap">
        <span className="mr-2.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10">
          <Sparkles className="h-4 w-4 text-primary" />
        </span>
        <div className="mr-3 min-w-0 flex-1">
          <h2 className="truncate text-[14.5px] font-semibold">Agente do mês</h2>
          <p className="truncate text-[11.5px] text-muted-foreground">
            {planejando ? "Planeja com você, seguindo o prompt geral do cliente" : "Cria conteúdos prontos para gravar na agenda"}
          </p>
        </div>
        <div role="tablist" aria-label="O que fazer com o agente" className="mt-2 flex w-full shrink-0 rounded-lg bg-muted p-0.5 sm:mt-0 sm:w-auto">
          {(
            [
              { valor: "planejar", rotulo: "Planejar o mês", Icone: MessagesSquare },
              { valor: "criar", rotulo: "Criar conteúdos", Icone: Wand2 },
            ] as { valor: ModoDoAgente; rotulo: string; Icone: typeof Wand2 }[]
          ).map((m) => (
            <button
              key={m.valor}
              type="button"
              role="tab"
              aria-selected={modo === m.valor}
              onClick={() => trocarModo(m.valor)}
              className={`inline-flex h-8 min-w-0 flex-1 items-center justify-center rounded-md px-3 text-[12.5px] font-medium sm:flex-none ${
                modo === m.valor ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <m.Icone className="mr-1.5 h-3.5 w-3.5 shrink-0" />
              {m.rotulo}
            </button>
          ))}
        </div>
        {acaoDoCabecalho}
      </div>

      {/* Planejar: o mês em conversa e o que já está combinado para ele. */}
      {planejando && (
        <div className="shrink-0 border-b border-border bg-muted/40 px-4 py-2">
          <div className="flex min-w-0 flex-wrap items-center">
            <CalendarRange className="mr-1.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span className="mr-1.5 text-[12px] text-muted-foreground">Mês em conversa</span>
            <Select value={mes} onValueChange={setMes}>
              <SelectTrigger className="mr-2 h-7 w-auto min-w-[150px] text-[12px] capitalize" aria-label="Mês em conversa">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {opcoesDeMes.map((m) => <SelectItem key={m} value={m} className="capitalize">{nomeDoMes(m)}</SelectItem>)}
              </SelectContent>
            </Select>
            <button
              type="button"
              onClick={() => setPlanoAberto((v) => !v)}
              aria-expanded={planoAberto}
              className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11.5px] font-medium ${painelDoPlano ? "lg:hidden" : ""} ${
                planoDoMes ? "bg-success/15 text-foreground" : "bg-card text-muted-foreground"
              }`}
            >
              {planoDoMes ? <Check className="mr-1 h-3 w-3" /> : null}
              {planoDoMes ? "Plano combinado" : "Nada combinado ainda"}
              <ChevronDown className={`ml-0.5 h-3 w-3 transition-transform ${planoAberto ? "rotate-180" : ""}`} />
            </button>
          </div>
          {planoAberto && (
            <div className={`mt-2 max-h-48 overflow-y-auto rounded-lg border border-border bg-card p-2.5 ${painelDoPlano ? "lg:hidden" : ""}`}>
              {planoDoMes ? (
                <>
                  <p className="whitespace-pre-wrap text-[12px] leading-relaxed [overflow-wrap:anywhere]">{corpoDoPlano(planoDoMes.texto)}</p>
                  <button type="button" onClick={() => void esquecer(planoDoMes)} className="mt-1.5 text-[11px] text-muted-foreground underline-offset-2 hover:text-destructive hover:underline">
                    Esquecer este plano
                  </button>
                </>
              ) : (
                <p className="text-[12px] leading-relaxed text-muted-foreground">
                  Converse sobre {nome}: o que ficar decidido vira o plano do mês e o gerador de meses segue.
                </p>
              )}
            </div>
          )}
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div ref={listaRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4" aria-live="polite">
            {conversa.isLoading && <p className="text-[12px] text-muted-foreground"><Loader2 className="mr-1.5 inline h-3.5 w-3.5 animate-spin" />Lendo a conversa…</p>}
            {conversa.isError && <AvisoDeErro erro={conversa.error} />}
            {conversaVazia && (
              <div className="mx-auto max-w-md py-8 text-center">
                <p className="text-[14px] font-semibold">{planejando ? `Vamos planejar ${nome}?` : "O que o mês precisa?"}</p>
                <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted-foreground">
                  {planejando
                    ? "Converse sobre estratégia, datas, campanhas, frequência e formatos. O agente lê o que já foi publicado e aprovado, as métricas, as campanhas e os hypes."
                    : "Peça em português. Os conteúdos chegam prontos para gravar na agenda."}
                </p>
              </div>
            )}
            {lista.map((m) => {
              if (m.papel === "sistema") {
                return <p key={m.id} className="text-center text-[11px] text-muted-foreground [overflow-wrap:anywhere]">{m.conteudo}</p>;
              }
              const imagens = imagensDaMensagem(m);
              const idsDaMsg = propostasDaMensagem(m);
              const mudanca = m.papel === "agente" ? mudancaDaMensagem(m.anexos) : null;
              const acaoNaAgenda = m.papel === "agente" ? acaoNaAgendaDaMensagem(m.anexos) : null;
              const geracao = m.papel === "agente" ? geracaoDaMensagem(m.anexos) : null;
              const mesesDoPlano = m.papel === "agente" ? planosDaMensagem(m.anexos) : [];
              return (
                <div key={m.id} className="min-w-0 space-y-2">
                  {m.conteudo && (
                    <Bolha papel={m.papel === "usuario" ? "usuario" : "agente"}>
                      <p className="whitespace-pre-wrap">{m.conteudo}</p>
                    </Bolha>
                  )}
                  {mesesDoPlano.length > 0 && (
                    <div className="mr-6 flex flex-wrap">
                      {mesesDoPlano.map((x) => (
                        <span key={x} className="mb-1 mr-1 inline-flex items-center rounded-full bg-success/15 px-2.5 py-0.5 text-[11px]">
                          <Check className="mr-1 h-3 w-3" />
                          Plano de {nomeDoMes(x)} atualizado
                        </span>
                      ))}
                    </div>
                  )}
                  {mudanca && <CartaoDaMudanca mensagemId={m.id} mudanca={mudanca} />}
                  {acaoNaAgenda && <CartaoDaAcaoNaAgenda mensagemId={m.id} acao={acaoNaAgenda} />}
                  {geracao && <CartaoDaGeracao mensagemId={m.id} geracao={geracao} />}
                  {imagens.length > 0 && (
                    <div className="ml-10 flex flex-wrap justify-end">
                      {imagens.map((c) => (
                        <ImagemDaMesa key={c} caminho={c} alt="Imagem anexada" className="mb-1 ml-1 h-12 w-12 rounded-md border border-border" />
                      ))}
                    </div>
                  )}
                  {idsDaMsg.map((id) => {
                    const p = porId[id];
                    if (!p) {
                      return propostas.isLoading ? <div key={id} className="h-20 animate-pulse rounded-lg bg-muted" /> : null;
                    }
                    if (p.status === "descartada") return null;
                    if (escondidas.indexOf(id) >= 0) {
                      return (
                        <button key={id} type="button" onClick={() => mostrar(id)} className="inline-flex items-center text-[11.5px] text-muted-foreground hover:text-foreground">
                          <Eye className="mr-1 h-3 w-3" /> Proposta escondida · mostrar
                        </button>
                      );
                    }
                    return (
                      <div key={id} className="mr-6">
                        <BlocoDaProposta
                          proposta={p}
                          projetoSugerido={projetoDaResposta[id] || null}
                          onAjustar={() => {
                            trocarModo("criar");
                            setAjustando(p);
                            window.setTimeout(() => campoRef.current && campoRef.current.focus(), 0);
                          }}
                          onDescartar={() => esconder(id)}
                          onAbrirNoEstudio={onAbrirNoEstudio}
                          permitirApagar
                        />
                      </div>
                    );
                  })}
                </div>
              );
            })}
            {andamento && (
              <div className="min-w-0 space-y-2">
                {andamento.mensagem && (
                  <Bolha papel="usuario"><p className="whitespace-pre-wrap">{andamento.mensagem}</p></Bolha>
                )}
                <div className="mr-6 rounded-2xl bg-muted px-3.5 py-2.5">
                  <Cronometro desde={andamento.desde} rotulo={planejando ? "Pensando no mês" : "Preparando"} />
                </div>
              </div>
            )}
          </div>

          <div className="shrink-0 space-y-2 border-t border-border px-3 pb-3 pt-2.5">
            {!ajustando && (
              <OQuePossoFazer
                capacidades={["criar os conteúdos do mês", "apagar", "refazer", "mudar data e formato", "editar campanhas"]}
                atalhos={planejando ? [] : ATALHOS_DE_ACAO(nome)}
                onAtalho={preencher}
              />
            )}
            {!ajustando && (
              <div className="flex flex-wrap" role="group" aria-label="Atalhos de pedido">
                {atalhos.map((a) => (
                  <button
                    key={a.rotulo}
                    type="button"
                    onClick={() => preencher(a.texto)}
                    className="mb-1 mr-1 max-w-full truncate rounded-full border border-border bg-background px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
                  >
                    {a.rotulo}
                  </button>
                ))}
              </div>
            )}
            <ZonaDeAnexos anexos={anexos}>
              <div className="rounded-xl border border-border bg-background p-2 focus-within:border-primary/60">
                {ajustando && (
                  <div className="mb-1.5 flex min-w-0 items-center rounded-md bg-muted px-2 py-1 text-[11.5px]">
                    <span className="min-w-0 flex-1 truncate">
                      Ajustando: {(ajustando.itens || []).map((i) => i.tema).filter(Boolean).join(", ") || "a proposta"}
                    </span>
                    <button type="button" onClick={() => setAjustando(null)} aria-label="Cancelar ajuste" className="ml-1 shrink-0 text-muted-foreground hover:text-foreground">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
                {!ajustando && <MiniaturasDosAnexos anexos={anexos} />}
                <Textarea
                  ref={campoRef}
                  value={texto}
                  onChange={(e) => setTexto(e.target.value)}
                  rows={3}
                  aria-label="Pedido ao agente do mês"
                  placeholder={
                    ajustando
                      ? "O que mudar nestes conteúdos?"
                      : planejando
                        ? `Converse sobre ${nome}: estratégia, datas, campanhas, frequência, formatos.`
                        : "Peça ao agente. Arraste ou cole imagens e prints."
                  }
                  className="min-h-[64px] resize-none border-0 bg-transparent px-1 py-1 text-[13px] shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
                />
                <div className="mt-1 flex min-w-0 items-center">
                  {!ajustando && <BotaoDeAnexar anexos={anexos} className="mr-1.5" />}
                  {!ajustando && !planejando && campanhasAtivas.length > 0 && (
                    <Select value={campanhaEscolhida ? campanhaEscolhida.id : SEM_CAMPANHA} onValueChange={setCampanhaId}>
                      <SelectTrigger className="mr-1.5 h-8 min-w-0 flex-1 text-[11.5px]" aria-label="Campanha do pedido">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={SEM_CAMPANHA}>Sem campanha</SelectItem>
                        {campanhasAtivas.map((c) => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  )}
                  <div className="ml-auto flex shrink-0 items-center">
                    {/* Falar em vez de digitar: o texto vai aparecendo no campo enquanto a pessoa fala. */}
                    <Ditado valor={texto} onChange={setTexto} disabled={!!envio} className="mr-1.5" />
                    <BotaoComCusto
                      rotulo={ajustando ? "Ajustar" : "Enviar"}
                      titulo={ajustando ? "Ajuste dos conteúdos" : planejando ? "Conversa de planejamento" : "Pedido ao agente do mês"}
                      descricao={
                        planejando
                          ? "Uma chamada do estrategista com o contexto do cliente, o que foi publicado e aprovado, campanhas, hypes e a agenda dos próximos meses."
                          : "Uma chamada do estrategista com o contexto do cliente."
                      }
                      partes={partes}
                      executar={enviar}
                      aoConcluir={concluir}
                      disabled={!texto.trim() || anexos.subindo || !!envio}
                      className="h-8"
                    />
                  </div>
                </div>
              </div>
            </ZonaDeAnexos>
          </div>
        </div>

        {painelDoPlano && (
          <aside className="hidden w-[300px] shrink-0 overflow-y-auto border-l border-border bg-muted/30 p-4 lg:block" aria-label="Planos combinados">
            <PainelDosPlanos planos={listaDePlanos} mes={mes} onEsquecer={(p) => void esquecer(p)} />
          </aside>
        )}
      </div>
    </div>
  );
}
