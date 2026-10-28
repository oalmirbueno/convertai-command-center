import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BadgeCheck, ExternalLink, FileText, MessageCircle, Phone, Settings2 } from "lucide-react";
import { toast } from "sonner";
import { AjudaRecolhida, AreaDeTrabalho, Carregando, EstadoDeErro, EstadoVazio, SeletorCompacto, botao, campo, campoTexto, juntar, texto } from "@/components/sistema";
import {
  CONFIG_PADRAO,
  confirmarPagamentoDoBolso,
  dadosLegiveis,
  linkDaPropostaNaCaixa,
  pedidoDoBolsoNaCaixa,
  lerConfigDoMercurio,
  linkDeLigar,
  linkDoWhatsapp,
  listarCaixa,
  mensagemDeContinuidade,
  mudarSituacaoDaCaixa,
  salvarConfigDoMercurio,
  rotuloDoEstagio,
  type ConfigDoAgente,
  type ItemDaCaixa,
  type Lead,
  type SituacaoDaCaixa,
} from "@/lib/comercial";

/**
 * A Caixa do comercial (25/10/2026, dono: "uma caixinha aonde ele avisa os que fecharam, só os que avançaram,
 * com as informações, dados, contexto e número do telefone do cliente, fácil só clicar e continuar comigo").
 * O Mercúrio põe aqui só quem avançou ou fechou; a equipe continua no WhatsApp ou na ligação, assume e conclui.
 * O link do sino abre com ?item=<id> e o item aparece destacado.
 */

export const CHAVE_DA_CAIXA = ["comercial-caixa"];

/** Quantos itens novos (para o contador da aba e o aviso da visão geral). */
export function useCaixaDoComercial() {
  return useQuery({ queryKey: CHAVE_DA_CAIXA, queryFn: listarCaixa, refetchOnWindowFocus: true, refetchInterval: 60_000 });
}

export const novosNaCaixa = (itens: ItemDaCaixa[] | undefined) => (itens || []).filter((i) => i.situacao === "nova").length;

const quando = (iso: string) => {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
};

const ROTULO_DA_SITUACAO: Record<SituacaoDaCaixa, string> = { nova: "Novas", assumida: "Assumidas", concluida: "Concluídas" };

/**
 * Aceleriq de Bolso pedido pelo Mercúrio (MCP 2.23): só a administração confirma, depois de ver o dinheiro no
 * extrato, no Pix ou no gateway (a RPC recusa quem não é admin). Comprovante em imagem não vale. Confirmado, o
 * acesso sai na hora se a conta existe.
 */
function ConfirmarPagamentoDoBolso({ pedidoId }: { pedidoId: string }) {
  const [aberto, setAberto] = useState(false);
  const [nota, setNota] = useState("");
  const [enviando, setEnviando] = useState(false);
  const confirmar = async () => {
    setEnviando(true);
    try {
      const r = await confirmarPagamentoDoBolso(pedidoId, nota.trim());
      if (r.liberado) toast.success(r.ja_liberado ? "Já estava liberado." : "Pagamento confirmado e acesso ao Bolso liberado.");
      else if (r.motivo === "conta_ausente") toast.success(`Pagamento confirmado. Falta a conta com ${r.email || "o e-mail do pedido"}: o Mercúrio pede ao lead e libera depois.`);
      else toast.success("Pagamento confirmado.");
      setAberto(false);
      setNota("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível confirmar.");
    } finally {
      setEnviando(false);
    }
  };
  if (!aberto) {
    return (
      <button type="button" onClick={() => setAberto(true)} className={juntar(botao.secundario, "lg:w-full")}>
        <BadgeCheck className="mr-1.5 h-4 w-4" aria-hidden="true" />
        Confirmar pagamento do Bolso
      </button>
    );
  }
  return (
    <div className="grid min-w-0 gap-2 lg:w-full">
      <label className={texto.auxiliar} htmlFor={`bolso-nota-${pedidoId}`}>
        Onde você viu o dinheiro? Comprovante em imagem não vale.
      </label>
      <input
        id={`bolso-nota-${pedidoId}`}
        className={campo}
        value={nota}
        maxLength={500}
        placeholder="Ex.: Pix no extrato do Inter, 28/10 14h"
        onChange={(e) => setNota(e.target.value)}
      />
      <div className="flex min-w-0 gap-2">
        <button type="button" disabled={enviando || nota.trim().length < 5} onClick={() => void confirmar()} className={juntar(botao.primario, "flex-1")}>
          Confirmar
        </button>
        <button type="button" disabled={enviando} onClick={() => setAberto(false)} className={juntar(botao.discreto, "flex-1")}>
          Cancelar
        </button>
      </div>
    </div>
  );
}

function ItemDaCaixaNaLista({ item, destacado, aoAbrirLead, aoMudar }: { item: ItemDaCaixa; destacado: boolean; aoAbrirLead?: () => void; aoMudar: (s: SituacaoDaCaixa) => Promise<void> }) {
  const [mudando, setMudando] = useState(false);
  const telefone = item.telefone || (item.lead && item.lead.whatsapp) || "";
  const nome = item.lead ? item.lead.name : "";
  const whatsapp = linkDoWhatsapp(telefone, mensagemDeContinuidade(nome));
  const ligar = linkDeLigar(telefone);
  const dados = dadosLegiveis(item.dados);
  const pedidoDoBolso = pedidoDoBolsoNaCaixa(item.dados);
  const linkDaProposta = linkDaPropostaNaCaixa(item.dados);
  const mudar = async (s: SituacaoDaCaixa) => {
    setMudando(true);
    try {
      await aoMudar(s);
    } finally {
      setMudando(false);
    }
  };
  return (
    <li
      id={`caixa-${item.id}`}
      data-item-da-caixa={item.id}
      data-tipo={item.tipo}
      className={juntar("grid min-w-0 grid-cols-1 gap-x-6 gap-y-3 border-t border-border py-4 first:border-t-0 lg:grid-cols-[minmax(0,1fr)_240px]", destacado && "-mx-3 rounded-md bg-primary/5 px-3 ring-1 ring-primary/40")}
    >
      <div className="min-w-0">
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <span className={juntar(texto.etiqueta, "rounded px-1.5 leading-5", item.tipo === "fechou" ? "bg-success/15 text-success" : "bg-primary/15 text-primary")}>
          {item.tipo === "fechou" ? "Fechou" : "Avançou"}
        </span>
        <span className={juntar(texto.tituloSecao, "min-w-0 truncate")}>
          {item.lead ? item.lead.company || item.lead.name : "Lead"}
          {item.lead && item.lead.company && item.lead.name !== item.lead.company ? <span className="font-normal text-muted-foreground"> · {item.lead.name}</span> : null}
        </span>
        <span className={juntar(texto.auxiliar, "ml-auto shrink-0 tabular-nums")}>
          {quando(item.created_at)}
          {item.lead && item.lead.stage ? ` · ${rotuloDoEstagio(item.lead.stage)}` : ""}
        </span>
      </div>
      <p className={juntar(texto.corpo, "mt-1 whitespace-pre-line")}>{item.resumo}</p>
      {item.proximo_passo && (
        <p className={juntar(texto.corpo, "mt-1")}>
          <span className="font-medium">Próximo passo:</span> {item.proximo_passo}
        </p>
      )}
      {dados.length > 0 && (
        <dl className="mt-3 grid min-w-0 grid-cols-1 gap-x-6 gap-y-1.5 sm:grid-cols-2 2xl:grid-cols-3" aria-label="Dados levantados">
          {dados.map((d) => (
            <div key={d.chave} className={juntar(texto.auxiliar, "flex min-w-0")}>
              <dt className="mr-1 shrink-0 text-muted-foreground">{d.chave}:</dt>
              <dd className="min-w-0 break-words text-foreground">{d.valor}</dd>
            </div>
          ))}
        </dl>
      )}
      </div>
      {/* As ações numa coluna fixa no largo (a mesma largura em todos os itens); em linha no celular. */}
      <div className="flex min-w-0 flex-wrap content-start items-stretch gap-2 lg:flex-col">
        {whatsapp ? (
          <a href={whatsapp} target="_blank" rel="noreferrer" className={juntar(botao.primario, "lg:w-full")} aria-label={`Continuar no WhatsApp com ${nome || "o lead"}`}>
            <MessageCircle className="mr-1.5 h-4 w-4" aria-hidden="true" />
            Continuar no WhatsApp
          </a>
        ) : (
          <span className={texto.auxiliar}>Sem telefone</span>
        )}
        {ligar && (
          <a href={ligar} className={juntar(botao.secundario, "lg:w-full")} aria-label={`Ligar para ${nome || "o lead"}`}>
            <Phone className="mr-1.5 h-4 w-4" aria-hidden="true" />
            {telefone}
          </a>
        )}
        {aoAbrirLead && (
          <button type="button" onClick={aoAbrirLead} className={juntar(botao.secundario, "lg:w-full")}>
            <ExternalLink className="mr-1.5 h-4 w-4" aria-hidden="true" />
            Abrir o lead
          </button>
        )}
        {linkDaProposta && (
          <a href={linkDaProposta} className={juntar(botao.secundario, "lg:w-full")}>
            <FileText className="mr-1.5 h-4 w-4" aria-hidden="true" />
            Abrir na Mesa Proposta
          </a>
        )}
        {pedidoDoBolso && <ConfirmarPagamentoDoBolso pedidoId={pedidoDoBolso} />}
        <div className="flex min-w-0 gap-2 lg:w-full">
          {item.situacao === "nova" && (
            <button type="button" disabled={mudando} onClick={() => void mudar("assumida")} className={juntar(botao.secundario, "flex-1")}>
              Assumir
            </button>
          )}
          {item.situacao !== "concluida" && (
            <button type="button" disabled={mudando} onClick={() => void mudar("concluida")} className={juntar(botao.discreto, "flex-1")}>
              Concluir
            </button>
          )}
          {item.situacao === "concluida" && (
            <button type="button" disabled={mudando} onClick={() => void mudar("assumida")} className={juntar(botao.discreto, "flex-1")}>
              Reabrir
            </button>
          )}
        </div>
      </div>
    </li>
  );
}

function ConfigDoMercurio() {
  const qc = useQueryClient();
  const lida = useQuery({ queryKey: ["comercial-config-mercurio"], queryFn: lerConfigDoMercurio });
  const [form, setForm] = useState<ConfigDoAgente | null>(null);
  const [salvando, setSalvando] = useState(false);
  const atual = form || lida.data || CONFIG_PADRAO;
  const mudar = (m: Partial<ConfigDoAgente>) => setForm({ ...atual, ...m });
  const salvar = async () => {
    setSalvando(true);
    try {
      await salvarConfigDoMercurio(atual);
      await qc.invalidateQueries({ queryKey: ["comercial-config-mercurio"] });
      setForm(null);
      toast.success("Configuração do Mercúrio salva.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível salvar.");
    } finally {
      setSalvando(false);
    }
  };
  return (
    <section className="min-w-0 p-4" aria-label="Configuração do Mercúrio" data-config-do-mercurio="">
      <div className="flex min-w-0 items-center">
        <Settings2 className="mr-1.5 h-4 w-4 text-muted-foreground" aria-hidden="true" />
        <h2 className={juntar(texto.tituloSecao, "min-w-0 flex-1")}>Mercúrio</h2>
        <span className={texto.auxiliar}>{atual.ativo ? "ligado" : "desligado"}</span>
      </div>
      <div className="mt-3 grid min-w-0 grid-cols-1 gap-3">
        <label className={juntar(texto.corpo, "flex items-center")}>
          <input type="checkbox" className="mr-2" checked={atual.ativo} onChange={(e) => mudar({ ativo: e.target.checked })} />
          O Mercúrio está atendendo
        </label>
        <label className={juntar(texto.rotulo, "block")}>
          Primeiros contatos por dia
          <input type="number" min={0} max={500} value={atual.limite_primeiros_contatos_dia} onChange={(e) => mudar({ limite_primeiros_contatos_dia: Number(e.target.value) || 0 })} className={juntar(campo, "mt-1")} aria-label="Primeiros contatos por dia" />
        </label>
        <label className={juntar(texto.rotulo, "block")}>
          Começa às
          <input type="time" value={atual.horario_inicio} onChange={(e) => mudar({ horario_inicio: e.target.value })} className={juntar(campo, "mt-1")} aria-label="Começa às" />
        </label>
        <label className={juntar(texto.rotulo, "block")}>
          Para às
          <input type="time" value={atual.horario_fim} onChange={(e) => mudar({ horario_fim: e.target.value })} className={juntar(campo, "mt-1")} aria-label="Para às" />
        </label>
        <label className={juntar(texto.rotulo, "block")}>
          Orientações para o Mercúrio
          <textarea value={atual.orientacoes || ""} onChange={(e) => mudar({ orientacoes: e.target.value })} rows={3} placeholder="Tom, o que oferecer primeiro, o que nunca prometer" className={juntar(campoTexto, "mt-1 resize-y")} aria-label="Orientações para o Mercúrio" />
        </label>
      </div>
      <div className="mt-3 flex items-center justify-end">
        <AjudaRecolhida className="mr-auto" rotulo="Sobre o limite de contatos">
          O limite vale só para o primeiro contato com quem ainda não conversou com a casa, como os leads da máquina de leads. Conversa que já começou não conta.
        </AjudaRecolhida>
        <button type="button" disabled={salvando || !form} onClick={() => void salvar()} className={botao.primario}>
          {salvando ? "Salvando…" : "Salvar"}
        </button>
      </div>
    </section>
  );
}

export default function CaixaDoComercial({ leads, onAbrirLead, itemDestacado }: { leads: Lead[]; onAbrirLead: (lead: Lead) => void; itemDestacado?: string | null }) {
  const qc = useQueryClient();
  const caixa = useCaixaDoComercial();
  const itens = caixa.data || [];
  const destacadoNaLista = itemDestacado ? itens.filter((i) => i.id === itemDestacado)[0] : undefined;
  const [filtro, setFiltro] = useState<SituacaoDaCaixa>("nova");
  // Veio pelo sino: abre na situação do item e rola até ele.
  useEffect(() => {
    if (!destacadoNaLista) return;
    setFiltro(destacadoNaLista.situacao);
    const t = window.setTimeout(() => {
      const el = typeof document !== "undefined" ? document.getElementById(`caixa-${destacadoNaLista.id}`) : null;
      if (el && typeof el.scrollIntoView === "function") el.scrollIntoView({ block: "center", behavior: "smooth" });
    }, 60);
    return () => window.clearTimeout(t);
  }, [destacadoNaLista && destacadoNaLista.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const contagem = useMemo(() => {
    const c: Record<SituacaoDaCaixa, number> = { nova: 0, assumida: 0, concluida: 0 };
    for (const i of itens) c[i.situacao] += 1;
    return c;
  }, [itens]);
  const visiveis = itens.filter((i) => i.situacao === filtro);

  const mudar = async (item: ItemDaCaixa, s: SituacaoDaCaixa) => {
    try {
      await mudarSituacaoDaCaixa(item.id, s);
      await qc.invalidateQueries({ queryKey: CHAVE_DA_CAIXA });
      toast.success(s === "assumida" ? "Assumido. Ele fica em Assumidas." : s === "concluida" ? "Concluído." : "Reaberto.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível mudar.");
    }
  };

  return (
    <AreaDeTrabalho rotuloDoPrincipal="Caixa do comercial" memoriaDaRolagem="comercial:caixa" lateral={<ConfigDoMercurio />} rotuloDaLateral="Mercúrio">
    <section className="min-w-0 space-y-4" aria-label="Caixa do comercial">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <SeletorCompacto
          rotulo="Situação na Caixa"
          modo="segmentado"
          valor={filtro}
          onEscolher={(v) => setFiltro(v as SituacaoDaCaixa)}
          opcoes={(["nova", "assumida", "concluida"] as SituacaoDaCaixa[]).map((s) => ({ valor: s, rotulo: ROTULO_DA_SITUACAO[s], contador: contagem[s] }))}
        />
        <AjudaRecolhida rotulo="O que entra na Caixa">
          O Mercúrio conversa com os leads e põe aqui só quem avançou ou fechou, com o resumo da conversa, o próximo passo, os dados e o telefone. Toque em Continuar no WhatsApp para seguir de onde ele parou; Assumir avisa a equipe que o lead é seu.
        </AjudaRecolhida>
      </div>
      {caixa.isLoading ? (
        <Carregando />
      ) : caixa.isError ? (
        <EstadoDeErro
          titulo="Não foi possível ler a Caixa."
          acao={<button type="button" onClick={() => void caixa.refetch()} className={botao.secundario}>Tentar de novo</button>}
        />
      ) : visiveis.length === 0 ? (
        <EstadoVazio titulo={filtro === "nova" ? "Nada novo na Caixa." : filtro === "assumida" ? "Nada assumido." : "Nada concluído ainda."} />
      ) : (
        <ul className="min-w-0" aria-label={`Caixa: ${ROTULO_DA_SITUACAO[filtro]}`}>
          {visiveis.map((item) => {
            const lead = leads.filter((l) => l.id === item.lead_id)[0];
            return (
              <ItemDaCaixaNaLista
                key={item.id}
                item={item}
                destacado={item.id === itemDestacado}
                aoAbrirLead={lead ? () => onAbrirLead(lead) : undefined}
                aoMudar={(s) => mudar(item, s)}
              />
            );
          })}
        </ul>
      )}
    </section>
    </AreaDeTrabalho>
  );
}
