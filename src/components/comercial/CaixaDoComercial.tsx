import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, ExternalLink, MessageCircle, Phone, Settings2 } from "lucide-react";
import { toast } from "sonner";
import { AjudaRecolhida, Carregando, EstadoDeErro, EstadoVazio, SeletorCompacto, botao, campo, campoTexto, foco, juntar, texto } from "@/components/sistema";
import {
  CONFIG_PADRAO,
  dadosLegiveis,
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

function ItemDaCaixaNaLista({ item, destacado, aoAbrirLead, aoMudar }: { item: ItemDaCaixa; destacado: boolean; aoAbrirLead?: () => void; aoMudar: (s: SituacaoDaCaixa) => Promise<void> }) {
  const [mudando, setMudando] = useState(false);
  const telefone = item.telefone || (item.lead && item.lead.whatsapp) || "";
  const nome = item.lead ? item.lead.name : "";
  const whatsapp = linkDoWhatsapp(telefone, mensagemDeContinuidade(nome));
  const ligar = linkDeLigar(telefone);
  const dados = dadosLegiveis(item.dados);
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
      className={juntar("min-w-0 border-t border-border py-3 first:border-t-0", destacado && "-mx-2 rounded-md bg-primary/5 px-2 ring-1 ring-primary/40")}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <span className={juntar("rounded px-1.5 text-[11px] font-semibold leading-5", item.tipo === "fechou" ? "bg-success/15 text-success" : "bg-primary/15 text-primary")}>
          {item.tipo === "fechou" ? "Fechou" : "Avançou"}
        </span>
        <span className="min-w-0 truncate text-[14px] font-medium text-foreground">
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
        <p className="mt-1 text-[13px] leading-5">
          <span className="font-medium">Próximo passo:</span> {item.proximo_passo}
        </p>
      )}
      {dados.length > 0 && (
        <dl className="mt-2 grid min-w-0 grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2" aria-label="Dados levantados">
          {dados.map((d) => (
            <div key={d.chave} className="flex min-w-0 text-[12px] leading-4">
              <dt className="mr-1 shrink-0 text-muted-foreground">{d.chave}:</dt>
              <dd className="min-w-0 break-words text-foreground">{d.valor}</dd>
            </div>
          ))}
        </dl>
      )}
      <div className="mt-2 flex min-w-0 flex-wrap items-center gap-1">
        {whatsapp ? (
          <a href={whatsapp} target="_blank" rel="noreferrer" className={juntar(botao.primario, "h-8 px-3 text-[12px]")} aria-label={`Continuar no WhatsApp com ${nome || "o lead"}`}>
            <MessageCircle className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
            Continuar no WhatsApp
          </a>
        ) : (
          <span className={texto.auxiliar}>Sem telefone</span>
        )}
        {ligar && (
          <a href={ligar} className={juntar(botao.secundario, "h-8 px-3 text-[12px]")} aria-label={`Ligar para ${nome || "o lead"}`}>
            <Phone className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
            {telefone}
          </a>
        )}
        {aoAbrirLead && (
          <button type="button" onClick={aoAbrirLead} className={juntar(botao.discreto, "h-8 px-2 text-[12px]")}>
            <ExternalLink className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
            Abrir o lead
          </button>
        )}
        <span className="ml-auto flex items-center gap-1">
          {item.situacao === "nova" && (
            <button type="button" disabled={mudando} onClick={() => void mudar("assumida")} className={juntar(botao.secundario, "h-8 px-3 text-[12px]")}>
              Assumir
            </button>
          )}
          {item.situacao !== "concluida" && (
            <button type="button" disabled={mudando} onClick={() => void mudar("concluida")} className={juntar(botao.discreto, "h-8 px-2 text-[12px]")}>
              Concluir
            </button>
          )}
          {item.situacao === "concluida" && (
            <button type="button" disabled={mudando} onClick={() => void mudar("assumida")} className={juntar(botao.discreto, "h-8 px-2 text-[12px]")}>
              Reabrir
            </button>
          )}
        </span>
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
    <details className="group min-w-0 border-t border-border pt-3" data-config-do-mercurio="">
      <summary className={juntar("flex cursor-pointer list-none items-center rounded-sm", foco)}>
        <ChevronRight className="mr-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" aria-hidden="true" />
        <Settings2 className="mr-1.5 h-4 w-4 text-muted-foreground" aria-hidden="true" />
        <span className={juntar(texto.tituloSecao, "text-[14px]")}>Configuração do Mercúrio</span>
        <span className={juntar(texto.auxiliar, "ml-2")}>{atual.ativo ? "ligado" : "desligado"}</span>
      </summary>
      <div className="mt-3 grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex items-center text-[13px]">
          <input type="checkbox" className="mr-2" checked={atual.ativo} onChange={(e) => mudar({ ativo: e.target.checked })} />
          O Mercúrio está atendendo
        </label>
        <label className="block text-[12px] text-muted-foreground">
          Primeiros contatos por dia
          <input type="number" min={0} max={500} value={atual.limite_primeiros_contatos_dia} onChange={(e) => mudar({ limite_primeiros_contatos_dia: Number(e.target.value) || 0 })} className={juntar(campo, "mt-1")} aria-label="Primeiros contatos por dia" />
        </label>
        <label className="block text-[12px] text-muted-foreground">
          Começa às
          <input type="time" value={atual.horario_inicio} onChange={(e) => mudar({ horario_inicio: e.target.value })} className={juntar(campo, "mt-1")} aria-label="Começa às" />
        </label>
        <label className="block text-[12px] text-muted-foreground">
          Para às
          <input type="time" value={atual.horario_fim} onChange={(e) => mudar({ horario_fim: e.target.value })} className={juntar(campo, "mt-1")} aria-label="Para às" />
        </label>
        <label className="block text-[12px] text-muted-foreground sm:col-span-2">
          Orientações para o Mercúrio
          <textarea value={atual.orientacoes || ""} onChange={(e) => mudar({ orientacoes: e.target.value })} rows={3} placeholder="Tom, o que oferecer primeiro, o que nunca prometer" className={juntar(campoTexto, "mt-1 resize-y")} aria-label="Orientações para o Mercúrio" />
        </label>
      </div>
      <div className="mt-2 flex items-center justify-end">
        <AjudaRecolhida className="mr-auto" rotulo="Sobre o limite de contatos">
          O limite vale só para o primeiro contato com quem ainda não conversou com a casa, como os leads da máquina de leads. Conversa que já começou não conta.
        </AjudaRecolhida>
        <button type="button" disabled={salvando || !form} onClick={() => void salvar()} className={juntar(botao.primario, "h-8 px-3 text-[12px]")}>
          {salvando ? "Salvando…" : "Salvar"}
        </button>
      </div>
    </details>
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
    <section className="min-w-0 space-y-3" aria-label="Caixa do comercial">
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
          acao={<button type="button" onClick={() => void caixa.refetch()} className={juntar(botao.secundario, "h-8")}>Tentar de novo</button>}
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
      <ConfigDoMercurio />
    </section>
  );
}
