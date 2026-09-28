import { useEffect, useRef, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Bot, Check, ChevronDown, Loader2, Pause, Play, ShieldAlert, Undo2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import CaminhoPronto from "@/components/agentes/CaminhoPronto";
import { useAvisarErro } from "@/components/mesa/Custo";
import { useMesa } from "@/components/mesa/MesaContexto";
import { Campo } from "@/components/mesa/Seletores";
import { dataEHora, usd } from "@/lib/mesa/api";
import { campo, foco, juntar } from "@/components/sistema/estilos";
import { useEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
import { brl, inteiro, porcento } from "./adsApi";
import {
  chavesRotina,
  CUSTO_DA_REGRA_USD,
  desfazerAcaoFeita,
  descartarProposta,
  horaCurta,
  lerRotina,
  mandarRegra,
  rodarAgora,
  salvarRotina,
  tirarRegra,
  type AcaoFeita,
  type EstadoLidoNaTela,
  type LeituraDaRotina,
  type ProvaNaTela,
} from "./rotinaApi";

/**
 * "O agente está cuidando desta conta" (frente TR, 27/09). Pedido do dono:
 * "ativar uma rotina de monitorar a campanha, pausando o que gasta sem
 * resultado e montando estratégias; só avisa quando fez; uma área do que foi
 * feito" e, logo depois, "acompanhamento meu humano observando as ações de
 * forma clara e poder parar ou interferir; sempre trazer provas".
 *
 * Um lugar para ver, um botão para parar:
 * - a faixa diz o que ele está olhando, o que fez e o que pretende fazer na
 *   próxima rodada, com o botão grande Pausar a rotina (vale na hora, também
 *   para a rodada em andamento, que relê a flag antes de cada ação);
 * - Interferir: a frase do dono vira regra da rotina (e do agente), visível;
 * - O que foi feito: cada ação com a prova (números, fonte e hora, antes e
 *   depois na Meta, veredito do Jev) e o Desfazer.
 * Os ajustes (teto diário, subida por passo, limites) ficam recolhidos.
 */

const NIVEL: Record<string, string> = { campanha: "Campanha", conjunto: "Conjunto", anuncio: "Anúncio" };
const statusLegivel = (s: string | null | undefined) => (s === "ACTIVE" ? "ativo" : s === "PAUSED" ? "pausado" : s === "ARCHIVED" ? "arquivado" : s ? s.toLowerCase() : "sem leitura");

function Estado({ e }: { e: EstadoLidoNaTela | null }) {
  if (!e) return <span className="text-muted-foreground">sem leitura</span>;
  return (
    <span>
      {statusLegivel(e.status)}
      {e.orcamento_diario_brl !== null ? `, ${brl(e.orcamento_diario_brl)} por dia` : ""}
    </span>
  );
}

/** A prova da ação, recolhida numa linha que abre. */
function Prova({ p }: { p: ProvaNaTela }) {
  const [aberta, setAberta] = useState(false);
  return (
    <div className="mt-1 min-w-0">
      <button type="button" className={juntar("inline-flex items-center rounded text-[11.5px] font-medium text-primary hover:underline", foco)} onClick={() => setAberta(!aberta)} aria-expanded={aberta}>
        <ChevronDown className={`mr-0.5 h-3.5 w-3.5 transition-transform ${aberta ? "rotate-180" : ""}`} />
        Prova
      </button>
      {aberta && (
        <dl className="mt-1 grid min-w-0 grid-cols-1 gap-y-1 rounded-md bg-muted/50 px-2.5 py-2 text-[11.5px] leading-snug sm:grid-cols-2 sm:gap-x-4" data-prova="">
          {p.periodo && (
            <div className="min-w-0">
              <dt className="text-muted-foreground">Números ({p.periodo.inicio.split("-").reverse().join("/")} a {p.periodo.fim.split("-").reverse().join("/")})</dt>
              <dd className="tabular-nums [overflow-wrap:anywhere]">
                {[
                  p.gasto !== null ? `${brl(p.gasto)} gastos` : "",
                  p.resultados !== null ? `${inteiro(p.resultados)} ${p.resultado_rotulo.toLowerCase()}` : "",
                  p.custo_por_resultado !== null ? `${brl(p.custo_por_resultado)} cada` : "",
                  p.ctr_link_pct !== null ? `CTR ${porcento(p.ctr_link_pct)}` : "",
                  p.frequencia !== null ? `frequência ${String(p.frequencia).replace(".", ",")}` : "",
                ].filter(Boolean).join(" · ")}
              </dd>
            </div>
          )}
          <div className="min-w-0">
            <dt className="text-muted-foreground">Fonte</dt>
            <dd className="[overflow-wrap:anywhere]">
              {p.fonte || "Meta Ads"}
              {p.relido_na_meta_em ? `, relido às ${horaCurta(p.relido_na_meta_em)}` : p.sincronizado_em ? `, coletado às ${horaCurta(p.sincronizado_em)}` : ""}
            </dd>
          </div>
          {(p.antes || p.depois) && (
            <div className="min-w-0">
              <dt className="text-muted-foreground">Na Meta</dt>
              <dd className="flex min-w-0 flex-wrap items-center">
                <Estado e={p.antes} />
                <ArrowRight className="mx-1 h-3 w-3 shrink-0 text-muted-foreground" />
                <Estado e={p.depois} />
              </dd>
            </div>
          )}
          {p.resposta_meta && typeof p.resposta_meta.success === "boolean" && (
            <div className="min-w-0">
              <dt className="text-muted-foreground">Resposta da Meta</dt>
              <dd>{p.resposta_meta.success ? "sucesso" : "sem sucesso"}{p.feito_em ? `, escrito às ${horaCurta(p.feito_em)}` : ""}</dd>
            </div>
          )}
          {p.custo_alvo_brl !== null && (
            <div className="min-w-0">
              <dt className="text-muted-foreground">Custo-alvo</dt>
              <dd>{brl(p.custo_alvo_brl)}{p.fonte_do_alvo ? ` (${p.fonte_do_alvo === "nicho" ? "referência do nicho" : p.fonte_do_alvo === "conta" ? "média da conta" : p.fonte_do_alvo === "dono" ? "definido por você" : p.fonte_do_alvo})` : ""}</dd>
            </div>
          )}
          {p.jev && (
            <div className="min-w-0">
              <dt className="text-muted-foreground">Jev</dt>
              <dd>{p.jev.escolha || "sem escolha"}{p.jev.probabilidade !== null ? ` (${Math.round(p.jev.probabilidade * 100)}%)` : ""}</dd>
            </div>
          )}
          {p.decisao && (
            <div className="min-w-0 sm:col-span-2">
              <dt className="text-muted-foreground">Decisão</dt>
              <dd className="[overflow-wrap:anywhere]">{p.decisao}</dd>
            </div>
          )}
        </dl>
      )}
    </div>
  );
}

function ItemFeito({ a, fazendo, onDesfazer, onLevar, onDescartar }: { a: AcaoFeita; fazendo: string | null; onDesfazer: () => void; onLevar?: (texto: string) => void; onDescartar: () => void }) {
  const selo =
    a.estado === "desfeita" ? "Desfeito" : a.estado === "falhou" ? "Não deu" : a.estado === "proposta" ? "Proposta" : a.estado === "descartada" ? "Descartada" : a.tipo === "parada" ? "Parou" : null;
  return (
    <li className="min-w-0 py-2" data-acao-feita={a.estado}>
      <p className="flex min-w-0 flex-wrap items-center text-[12.5px] leading-snug">
        {a.estado === "feita" && a.tipo !== "parada" ? <Check className="mr-1.5 h-3.5 w-3.5 shrink-0 text-success" /> : a.estado === "proposta" ? <Bot className="mr-1.5 h-3.5 w-3.5 shrink-0 text-primary" /> : <X className="mr-1.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
        <span className="mr-2 min-w-0 font-medium [overflow-wrap:anywhere]">{a.resumo}</span>
        {selo && <span className="mr-2 rounded bg-muted px-1.5 py-0.5 text-[10.5px] text-muted-foreground">{selo}</span>}
        <span className="text-[11px] text-muted-foreground">
          {dataEHora(a.criado_em)} · {a.origem === "rotina" ? "rotina" : a.origem === "equipe" ? "você, no Gerenciador" : "agente sênior"}
          {a.alvo ? ` · ${NIVEL[a.alvo.nivel] || "Item"}` : ""}
        </span>
      </p>
      {a.porque && <p className="mt-0.5 text-[12px] leading-snug text-muted-foreground [overflow-wrap:anywhere]">{a.porque}</p>}
      {a.prova && <Prova p={a.prova} />}
      {a.resultado_depois && a.resultado_depois.custo_por_resultado !== null && (
        <p className="mt-0.5 text-[11.5px] text-muted-foreground">
          Depois: a conta em 7 dias ficou com {inteiro(a.resultado_depois.resultados)} resultados a {brl(a.resultado_depois.custo_por_resultado)} cada.
        </p>
      )}
      <div className="mt-1 flex min-w-0 flex-wrap items-center">
        {a.estado === "feita" && a.prova && a.prova.caminho && <CaminhoPronto caminho={a.prova.caminho} className="h-7 text-[11.5px]" />}
        {a.pode_desfazer && (
          <Button type="button" size="sm" variant="outline" className="mb-1 mr-1.5 h-7 text-[11.5px]" disabled={!!fazendo} onClick={onDesfazer} aria-label={`Desfazer: ${a.resumo}`}>
            {fazendo === `desfazer:${a.id}` ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Undo2 className="mr-1 h-3.5 w-3.5" />}
            Desfazer
          </Button>
        )}
        {a.estado === "proposta" && (
          <>
            {onLevar && a.prova && a.prova.pedido_ao_agente && (
              <Button type="button" size="sm" className="mb-1 mr-1.5 h-7 text-[11.5px]" disabled={!!fazendo} onClick={() => onLevar(a.prova ? a.prova.pedido_ao_agente : "")}>
                Montar com o agente sênior
              </Button>
            )}
            <Button type="button" size="sm" variant="ghost" className="mb-1 h-7 text-[11.5px] text-muted-foreground" disabled={!!fazendo} onClick={onDescartar}>
              Descartar
            </Button>
          </>
        )}
      </div>
    </li>
  );
}

function Ajustes({ l, fazendo, onSalvar }: { l: LeituraDaRotina; fazendo: string | null; onSalvar: (campos: Record<string, unknown>) => void }) {
  const r = l.rotina;
  const [teto, setTeto] = useState(r && r.teto_diario_brl !== null ? String(r.teto_diario_brl) : "");
  const [subida, setSubida] = useState(String(r ? r.subida_max_pct : 20));
  const [porRodada, setPorRodada] = useState(String(r ? r.max_acoes_rodada : 3));
  const [porDia, setPorDia] = useState(String(r ? r.max_acoes_dia : 6));
  const [alvo, setAlvo] = useState(r && r.limites.custo_alvo_brl ? String(r.limites.custo_alvo_brl) : "");
  const [minimo, setMinimo] = useState(r && r.limites.gasto_minimo_brl ? String(r.limites.gasto_minimo_brl) : "");
  const [multiplo, setMultiplo] = useState(r && r.limites.multiplo_sem_resultado ? String(r.limites.multiplo_sem_resultado) : "");
  const n = (v: string) => (v.trim() === "" ? null : Number(v.replace(",", ".")));
  const salvar = (ev: FormEvent) => {
    ev.preventDefault();
    const limites: Record<string, number> = {};
    if (n(alvo) !== null) limites.custo_alvo_brl = n(alvo) as number;
    if (n(minimo) !== null) limites.gasto_minimo_brl = n(minimo) as number;
    if (n(multiplo) !== null) limites.multiplo_sem_resultado = n(multiplo) as number;
    onSalvar({ teto_diario_brl: n(teto), subida_max_pct: n(subida), max_acoes_rodada: n(porRodada), max_acoes_dia: n(porDia), limites });
  };
  const entrada = (rotulo: string, valor: string, mudar: (v: string) => void, dica: string) => (
    <Campo rotulo={rotulo}>
      <input className={juntar(campo, "h-8 text-[12.5px] tabular-nums")} inputMode="decimal" value={valor} onChange={(e) => mudar(e.target.value)} placeholder={dica} aria-label={rotulo} />
    </Campo>
  );
  return (
    <form onSubmit={salvar} className="mt-2 min-w-0 space-y-3" aria-label="Ajustes da rotina">
      <div className="grid min-w-0 grid-cols-2 gap-3 md:grid-cols-4">
        {entrada("Teto diário de verba (R$)", teto, setTeto, "sem teto")}
        {entrada("Subida por vez (%)", subida, setSubida, "20")}
        {entrada("Ações por rodada", porRodada, setPorRodada, "3")}
        {entrada("Ações por dia", porDia, setPorDia, "6")}
        {entrada("Custo-alvo por resultado (R$)", alvo, setAlvo, "automático")}
        {entrada("Gasto mínimo antes de julgar (R$)", minimo, setMinimo, "15")}
        {entrada("Pausar sem resultado ao gastar (x o alvo)", multiplo, setMultiplo, "2")}
      </div>
      <p className="text-[11.5px] leading-snug text-muted-foreground">
        Sem teto, a rotina só pausa o que queima e nunca sobe verba. Com teto, sobe no máximo {subida || "20"}% por vez no vencedor, a cada 72 horas, sem passar do teto. Custo-alvo automático: o do plano de teste, do briefing, a média da conta ou a referência do nicho, nesta ordem.
      </p>
      <Button type="submit" size="sm" variant="outline" className="h-8" disabled={!!fazendo}>
        {fazendo === "ajustes" && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
        Salvar ajustes
      </Button>
    </form>
  );
}

export default function RotinaDoAgente({ onPedirAoAgente, abrirFeito = false }: { onPedirAoAgente?: (texto: string) => void; abrirFeito?: boolean }) {
  const { clientId } = useMesa();
  const queryClient = useQueryClient();
  const avisarErro = useAvisarErro();
  const chave = chavesRotina.rotina(clientId);
  const leitura = useQuery({ queryKey: chave, queryFn: () => lerRotina(clientId), staleTime: 60_000, refetchInterval: 5 * 60_000, refetchIntervalInBackground: false, retry: false });
  const [fazendo, setFazendo] = useState<string | null>(null);
  const [instrucao, setInstrucao] = useEstadoDaTela(`mesa-ads:rotina:instrucao:${clientId}`, "");
  const [feitoAberto, setFeitoAberto] = useState(abrirFeito);
  const [ajustesAbertos, setAjustesAbertos] = useState(false);
  const feitoRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!abrirFeito) return;
    setFeitoAberto(true);
    const el = feitoRef.current;
    if (el && typeof el.scrollIntoView === "function") el.scrollIntoView({ block: "start" });
  }, [abrirFeito]);

  const agir = async (qual: string, fazer: () => Promise<LeituraDaRotina>, sucesso?: string) => {
    setFazendo(qual);
    try {
      const l = await fazer();
      queryClient.setQueryData(chave, l);
      if (l.aviso) toast.warning("Regra guardada com cuidado", { description: l.aviso });
      else if (sucesso) toast.success(sucesso);
      return l;
    } catch (e) {
      avisarErro(e, "Não foi possível concluir");
      return null;
    } finally {
      setFazendo(null);
    }
  };

  if (leitura.isLoading) return <div className="h-16 w-full animate-pulse rounded-lg bg-muted/70" aria-busy="true" aria-label="Lendo a rotina" />;
  const l = leitura.data;
  if (!l || !l.disponivel) {
    return (
      <section className="min-w-0 rounded-lg border border-border bg-card px-4 py-3" aria-label="Rotina do agente de tráfego">
        <p className="text-[13px] font-semibold">Rotina de monitoramento</p>
        <p className="mt-0.5 text-[12px] text-muted-foreground">{l ? l.motivo : leitura.isError ? "Não foi possível ler a rotina agora." : "Sem leitura."}</p>
      </section>
    );
  }
  const r = l.rotina;
  const ligada = !!(r && r.ligada);
  const e = r ? r.estado : null;
  const regras = r ? r.regras.filter((x) => x.ativa) : [];
  const feitas = l.acoes.filter((a) => a.estado !== "descartada");
  const propostas = l.acoes.filter((a) => a.estado === "proposta").length;
  const naoDeram = l.acoes.filter((a) => a.estado === "falhou").length;
  // Frente AD: a última ação fica sempre à vista (o dono quer ter certeza do que foi feito sem abrir nada).
  const ultima = l.acoes.filter((a) => a.estado === "feita" || a.estado === "falhou" || a.estado === "desfeita").filter((a) => a.tipo !== "parada")[0] || null;
  const proxima = r ? r.proxima_rodada_em || (e ? e.proxima_rodada_em : null) : null;

  const interferir = (ev: FormEvent) => {
    ev.preventDefault();
    const t = instrucao.trim();
    if (!t) return;
    void agir("regra", () => mandarRegra(clientId, t), "Regra da rotina guardada").then((ok) => {
      if (ok) setInstrucao("");
    });
  };

  return (
    <section className="min-w-0 rounded-lg border border-border bg-card px-4 py-3" aria-label="Rotina do agente de tráfego" data-rotina={ligada ? "ligada" : "desligada"}>
      <div className="flex min-w-0 flex-wrap items-start">
        <div className="mb-2 mr-3 min-w-0 flex-1">
          <p className="flex items-center text-[13.5px] font-semibold">
            <span className={juntar("mr-2 inline-block h-2 w-2 shrink-0 rounded-full", ligada ? "bg-success" : "bg-muted-foreground/40")} aria-hidden="true" />
            {ligada ? "O agente está cuidando desta conta" : r && r.pausada_em ? "Rotina pausada" : "Rotina de monitoramento"}
          </p>
          <p className="mt-0.5 text-[12px] leading-snug text-muted-foreground [overflow-wrap:anywhere]">
            {ligada
              ? e && e.olhando
                ? `Olhando: ${e.olhando}`
                : "Liga e começa: a primeira rodada acontece em até 1 hora."
              : "Ligada, ela olha a conta a cada hora: pausa o que gasta sem resultado, prepara estratégia quando precisa e só avisa quando faz algo."}
          </p>
          {ligada && proxima && <p className="mt-0.5 text-[11.5px] text-muted-foreground">Próxima rodada às {horaCurta(proxima)}.</p>}
        </div>
        <div className="mb-2 flex shrink-0 flex-wrap items-center">
          {ligada && (
            <Button type="button" size="sm" variant="ghost" className="mb-1 mr-1 h-9 text-[12px] text-muted-foreground" disabled={!!fazendo} onClick={() => void agir("rodar", () => rodarAgora(clientId), "Rodada feita")}>
              {fazendo === "rodar" ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
              Rodar agora
            </Button>
          )}
          {ligada ? (
            <Button type="button" variant="destructive" className="mb-1 h-10 px-4 text-[13px]" disabled={fazendo === "pausar"} onClick={() => void agir("pausar", () => salvarRotina(clientId, { ligada: false }), "Rotina pausada: nada muda na conta até você ligar de novo")}>
              {fazendo === "pausar" ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Pause className="mr-1.5 h-4 w-4" />}
              Pausar a rotina
            </Button>
          ) : (
            <Button type="button" className="mb-1 h-10 px-4 text-[13px]" disabled={!!fazendo} onClick={() => void agir("ligar", () => salvarRotina(clientId, { ligada: true }), "Rotina ligada")}>
              {fazendo === "ligar" ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Play className="mr-1.5 h-4 w-4" />}
              Ligar a rotina
            </Button>
          )}
        </div>
      </div>

      {e && e.bloqueio && (
        <p className="mb-2 flex items-start rounded-md bg-warning/10 px-2.5 py-2 text-[12px] leading-snug">
          <ShieldAlert className="mr-1.5 mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
          <span className="min-w-0 [overflow-wrap:anywhere]">Não age agora: {e.bloqueio}</span>
        </p>
      )}
      {e && e.parou_por && !e.bloqueio && (
        <p className="mb-2 flex items-start rounded-md bg-warning/10 px-2.5 py-2 text-[12px] leading-snug">
          <ShieldAlert className="mr-1.5 mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
          <span className="min-w-0 [overflow-wrap:anywhere]">Parou sem mexer: {e.parou_por}</span>
        </p>
      )}

      {ligada && e && (e.fez.length > 0 || e.planeja.length > 0) && (
        <div className="mb-2 grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2" aria-label="Última rodada">
          <div className="min-w-0">
            <p className="text-[12px] font-semibold text-muted-foreground">Fez na última rodada{e.rodada_em ? ` (${horaCurta(e.rodada_em)})` : ""}</p>
            {e.fez.length ? (
              <ul className="mt-0.5 space-y-0.5">{e.fez.map((f, k) => <li key={k} className="text-[12px] leading-snug [overflow-wrap:anywhere]">{f}</li>)}</ul>
            ) : (
              <p className="mt-0.5 text-[12px] text-muted-foreground">Nada: nada pedia mudança.</p>
            )}
          </div>
          <div className="min-w-0">
            <p className="text-[12px] font-semibold text-muted-foreground">Na próxima rodada</p>
            <ul className="mt-0.5 space-y-0.5">{e.planeja.slice(0, 4).map((f, k) => <li key={k} className="text-[12px] leading-snug text-muted-foreground [overflow-wrap:anywhere]">{f}</li>)}</ul>
          </div>
        </div>
      )}

      <form onSubmit={interferir} className="flex min-w-0 flex-wrap items-center border-t border-border pt-2.5" aria-label="Interferir na rotina">
        <input
          className={juntar(campo, "mb-1 mr-2 h-9 min-w-0 flex-1 text-[12.5px]")}
          value={instrucao}
          onChange={(ev) => setInstrucao(ev.target.value)}
          placeholder="Interferir: ex. não mexe no conjunto Raio 5 km até sexta"
          aria-label="Instrução para a rotina"
          maxLength={400}
        />
        <Button type="submit" size="sm" variant="outline" className="mb-1 h-9" disabled={!instrucao.trim() || !!fazendo} title={`O Jev lê a instrução (tipo, alvo e prazo): cerca de ${usd(CUSTO_DA_REGRA_USD)}.`}>
          {fazendo === "regra" && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
          Virar regra
        </Button>
      </form>
      {regras.length > 0 && (
        <ul className="mt-1.5 flex min-w-0 flex-wrap" aria-label="Regras da rotina">
          {regras.map((g) => (
            <li key={g.id} className={juntar("mb-1 mr-1.5 inline-flex min-w-0 max-w-full items-center rounded-full px-2.5 py-1 text-[11.5px]", g.vale ? "bg-primary/10 text-foreground" : "bg-muted text-muted-foreground line-through")} title={`Você escreveu: ${g.texto}`}>
              <span className="min-w-0 truncate">{g.texto_da_regra || g.texto}</span>
              <button type="button" className={juntar("ml-1.5 shrink-0 rounded text-muted-foreground hover:text-foreground", foco)} aria-label={`Tirar a regra: ${g.texto}`} disabled={!!fazendo} onClick={() => void agir(`tirar:${g.id}`, () => tirarRegra(clientId, g.id), "Regra tirada")}>
                <X className="h-3 w-3" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {ultima && (
        <p className={juntar("mt-2 flex min-w-0 items-start text-[12px] leading-snug", ultima.estado === "falhou" ? "text-destructive" : "text-foreground")} data-ultima-acao={ultima.estado}>
          {ultima.estado === "falhou" ? <X className="mr-1.5 mt-0.5 h-3.5 w-3.5 shrink-0" /> : <Check className="mr-1.5 mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />}
          <span className="min-w-0 [overflow-wrap:anywhere]">
            {`Última ação (${horaCurta(ultima.criado_em)}, ${ultima.origem === "rotina" ? "rotina" : ultima.origem === "equipe" ? "você" : "agente"}): ${ultima.resumo}${ultima.estado === "falhou" && ultima.porque ? ` Motivo: ${ultima.porque}` : ultima.estado === "desfeita" ? " Desfeita depois." : ""}`}
          </span>
        </p>
      )}
      <div className="mt-2 flex min-w-0 flex-wrap items-center border-t border-border pt-2" ref={feitoRef}>
        <button type="button" className={juntar("mr-4 inline-flex items-center rounded text-[12.5px] font-medium", foco)} onClick={() => setFeitoAberto(!feitoAberto)} aria-expanded={feitoAberto}>
          <ChevronDown className={`mr-1 h-3.5 w-3.5 transition-transform ${feitoAberto ? "rotate-180" : ""}`} />
          O que foi feito ({feitas.length}){naoDeram ? ` · ${naoDeram} não ${naoDeram === 1 ? "deu" : "deram"}` : ""}{propostas ? ` · ${propostas} ${propostas === 1 ? "proposta" : "propostas"}` : ""}
        </button>
        <button type="button" className={juntar("inline-flex items-center rounded text-[12px] text-muted-foreground hover:text-foreground", foco)} onClick={() => setAjustesAbertos(!ajustesAbertos)} aria-expanded={ajustesAbertos}>
          <ChevronDown className={`mr-1 h-3.5 w-3.5 transition-transform ${ajustesAbertos ? "rotate-180" : ""}`} />
          Ajustes{r && r.teto_diario_brl !== null ? ` (teto ${brl(r.teto_diario_brl)} por dia)` : " (sem teto: só pausa)"}
        </button>
      </div>
      {ajustesAbertos && <Ajustes l={l} fazendo={fazendo} onSalvar={(campos) => void agir("ajustes", () => salvarRotina(clientId, campos), "Ajustes salvos")} />}
      {feitoAberto && (
        feitas.length ? (
          <ul className="mt-1 min-w-0 divide-y divide-border" aria-label="O que foi feito">
            {feitas.map((a) => (
              <ItemFeito
                key={a.id}
                a={a}
                fazendo={fazendo}
                onDesfazer={() => void agir(`desfazer:${a.id}`, () => desfazerAcaoFeita(a.id), "Desfeito: a conta voltou como estava")}
                onLevar={onPedirAoAgente}
                onDescartar={() => void agir(`descartar:${a.id}`, () => descartarProposta(a.id))}
              />
            ))}
          </ul>
        ) : (
          <p className="mt-1.5 text-[12px] text-muted-foreground">Nada feito ainda. Cada ação do agente e da rotina aparece aqui com a prova e o Desfazer.</p>
        )
      )}
    </section>
  );
}
