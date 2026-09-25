import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown, Lightbulb, Loader2, Plus, RefreshCw, Rocket, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { AvisoDeErro, BotaoComCusto, useAvisarErro } from "@/components/mesa/Custo";
import { useMesa } from "@/components/mesa/MesaContexto";
import { dataEHora, textoDoErro } from "@/lib/mesa/api";
import {
  ACOES_DO_OBJETIVO,
  briefingDaOferta,
  briefingParaSalvar,
  briefingVazio,
  camposDaOferta,
  chamarAds,
  chavesAds,
  DESTINOS,
  ESTAGIOS,
  humanizar,
  juntarBriefing,
  lerBriefing,
  lerOfertas,
  montarOfertaDoContexto,
  normalizarBriefing,
  normalizarOferta,
  OBJETIVOS,
  partesDoBriefing,
  rotuloDoObjetivo,
  TIPOS_DE_PROVA,
  type BriefingAds,
  type Ideia,
  type Oferta,
  type OfertaDoContexto,
  type PedidoDePlano,
  type RespostaDaOferta,
  type StatusDaOferta,
  type TipoDeProva,
} from "./adsApi";
import { Andamento, Campo, Cartao, pilula, useAndamento } from "./Comuns";
import AgenteDaOferta, { pedidoParaLapidar, type PedidoAoAgente } from "./AgenteDaOferta";
import CartaoDaOferta from "./CartaoDaOferta";

/**
 * v3 (pedido do dono, 25/09): ao abrir sem nenhuma oferta em uso, a oferta já
 * vem montada do contexto do cliente (oferta_do_contexto, sem IA e grátis:
 * briefing de ads, contexto consolidado da Mesa, brief, campanhas do mês e a
 * conta), como rascunho editável com a fonte de cada campo. "Lapidar com o
 * agente" leva a oferta ao agente ao lado com o pedido pronto; o custo
 * aparece no Enviar.
 *
 * Etapa 1, Oferta. Em cima, o agente de oferta (conversa com microfone e
 * anexos) e as ofertas que ele propôs, com as notas do Jev: escolher,
 * editar, arquivar, aplicar no briefing ou criar criativos direto (leva ao
 * Plano de teste com a oferta e o objetivo). Embaixo, o briefing de
 * performance, mais enxuto: "Sugerir pelo contexto" propõe; campo sem dado
 * aparece como lacuna, nunca preenchido por suposição. A equipe revisa e
 * salva (nova versão atual). Nada do briefing grava sozinho.
 */

const vazio = (v: string) => !v || !v.trim();

const campoPequeno = "h-9 text-[13px]";
const areaPequena = "min-h-[64px] text-[13px] leading-relaxed";

function SelecaoEmPilulas<T extends string>({
  valor,
  opcoes,
  onMudar,
  rotulo,
}: {
  valor: T | "";
  opcoes: { valor: T; rotulo: string }[];
  onMudar: (v: T | "") => void;
  rotulo: string;
}) {
  return (
    <div className="flex flex-wrap" role="radiogroup" aria-label={rotulo}>
      {opcoes.map((o) => {
        const ativa = valor === o.valor;
        return (
          <button
            key={o.valor}
            type="button"
            role="radio"
            aria-checked={ativa}
            onClick={() => onMudar(ativa ? "" : o.valor)}
            className={`mb-1.5 mr-1.5 rounded-full border px-2.5 py-1 text-[12px] transition-colors ${
              ativa ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-muted-foreground hover:text-foreground"
            }`}
          >
            {o.rotulo}
          </button>
        );
      })}
    </div>
  );
}

function BotaoRemover({ onClick, rotulo }: { onClick: () => void; rotulo: string }) {
  return (
    <button type="button" onClick={onClick} aria-label={rotulo} title={rotulo} className="ml-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground">
      <X className="h-3.5 w-3.5" />
    </button>
  );
}

function BotaoAdicionar({ onClick, children }: { onClick: () => void; children: string }) {
  return (
    <Button type="button" size="sm" variant="ghost" className="h-8 px-2 text-[12px] text-muted-foreground" onClick={onClick}>
      <Plus className="mr-1 h-3.5 w-3.5" /> {children}
    </Button>
  );
}

type FiltroDeOferta = "ativas" | "escolhidas" | "arquivadas";

function Ideias({ ideias, onLevar }: { ideias: Ideia[]; onLevar: (i: Ideia) => void }) {
  if (!ideias.length) return null;
  return (
    <section className="rounded-xl border border-border bg-card p-4" aria-label="Ideias de criativo">
      <h3 className="flex items-center text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        <Lightbulb className="mr-1.5 h-3.5 w-3.5 text-primary" /> Ideias de criativo da última resposta
      </h3>
      <ul className="mt-2 grid min-w-0 grid-cols-1 gap-2 md:grid-cols-2">
        {ideias.map((i, k) => (
          <li key={`${i.titulo}-${k}`} className="flex min-w-0 flex-col rounded-lg border border-border bg-background p-3">
            <p className="text-[12.5px] font-semibold [overflow-wrap:anywhere]">{i.titulo}</p>
            {i.gancho_verbal && <p className="mt-1 font-serif text-[14.5px] font-semibold leading-snug [overflow-wrap:anywhere]">{`“${i.gancho_verbal}”`}</p>}
            {i.gancho_visual && <p className="mt-1 text-[12px] leading-snug text-muted-foreground [overflow-wrap:anywhere]">{i.gancho_visual}</p>}
            <div className="mt-auto flex min-w-0 flex-wrap items-center pt-2">
              {i.estilo_visual && <span className="mb-1 mr-1.5 rounded-full border border-border px-2 py-0.5 text-[10.5px]">{humanizar(i.estilo_visual)}</span>}
              {i.formato && <span className="mb-1 mr-1.5 rounded-full bg-secondary px-2 py-0.5 text-[10.5px] text-muted-foreground">{humanizar(i.formato)}</span>}
              <button type="button" onClick={() => onLevar(i)} className="mb-1 ml-auto inline-flex h-7 items-center rounded-md px-2 text-[12px] font-medium text-primary hover:bg-primary/10">
                <Rocket className="mr-1 h-3.5 w-3.5" /> Levar ao plano
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function AbaOferta({ onCriarCriativos }: { onCriarCriativos?: (p: PedidoDePlano) => void } = {}) {
  const { clientId, catalogo } = useMesa();
  const queryClient = useQueryClient();
  const avisarErro = useAvisarErro();
  const salvo = useQuery({ queryKey: chavesAds.briefing(clientId), queryFn: () => lerBriefing(clientId) });
  const ofertas = useQuery({ queryKey: chavesAds.ofertas(clientId), queryFn: () => lerOfertas(clientId), retry: false });
  const [rascunho, setRascunho] = useState<BriefingAds>(briefingVazio());
  const [lacunasSugeridas, setLacunasSugeridas] = useState<string[] | null>(null);
  const [aplicadoDe, setAplicadoDe] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [desde, rodar] = useAndamento();
  const [ultima, setUltima] = useState<RespostaDaOferta | null>(null);
  const [novas, setNovas] = useState<string[]>([]);
  const [ocupadas, setOcupadas] = useState<string[]>([]);
  const [filtro, setFiltro] = useState<FiltroDeOferta>("ativas");
  const [objetivoDosCriativos, setObjetivoDosCriativos] = useState("");
  const [briefingAberto, setBriefingAberto] = useState(true);
  const briefingRef = useRef<HTMLDivElement>(null);
  const [doContexto, setDoContexto] = useState<OfertaDoContexto | null>(null);
  const [montando, setMontando] = useState(false);
  const [erroDoContexto, setErroDoContexto] = useState<string | null>(null);
  const [pedidoAoAgente, setPedidoAoAgente] = useState<PedidoAoAgente | null>(null);
  const tentouMontar = useRef(false);

  const base = useMemo(() => (salvo.data ? normalizarBriefing(salvo.data) : briefingVazio()), [salvo.data]);
  const idSalvo = salvo.data ? salvo.data.id : null;
  // Briefing lido (ou salvo de novo): o formulário volta ao que está no banco.
  useEffect(() => {
    setRascunho(base);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idSalvo, salvo.isSuccess]);

  const objetivoDoBriefing = base.objetivo.acao;
  const objetivo = objetivoDosCriativos || objetivoDoBriefing || "vendas";

  const mudou = JSON.stringify(rascunho) !== JSON.stringify(base);
  const b = rascunho;
  const mudar = (fn: (b: BriefingAds) => BriefingAds) => setRascunho((atual) => fn(JSON.parse(JSON.stringify(atual))));

  const salvar = async () => {
    setSalvando(true);
    try {
      await chamarAds("briefing_salvar", { client_id: clientId, briefing: briefingParaSalvar(rascunho) });
      toast.success("Briefing salvo", { description: "Virou a versão atual do cliente." });
      setLacunasSugeridas(null);
      setAplicadoDe(null);
      await queryClient.invalidateQueries({ queryKey: chavesAds.briefing(clientId) });
    } catch (e) {
      avisarErro(e, "Briefing não salvo");
    } finally {
      setSalvando(false);
    }
  };

  // ------------------------------------------------------------ ofertas

  // As ofertas da última resposta aparecem mesmo antes de a lista do banco reler.
  const todas = useMemo(() => {
    const doBanco = ofertas.data || [];
    const soltas = ultima ? ultima.ofertas.filter((o) => !doBanco.some((x) => x.id === o.id)) : [];
    // A oferta do contexto recém-montada aparece mesmo antes de a lista reler.
    const doCtx = doContexto && doContexto.oferta && !doBanco.some((x) => x.id === doContexto.oferta!.id) && !soltas.some((x) => x.id === doContexto.oferta!.id) ? [doContexto.oferta] : [];
    return soltas.concat(doCtx, doBanco);
  }, [ofertas.data, ultima, doContexto]);
  const listaDeOfertas = todas
    .filter((o) => (filtro === "arquivadas" ? o.status === "arquivada" : filtro === "escolhidas" ? o.status === "escolhida" : o.status !== "arquivada"))
    .sort((x, y) => {
      const nx = novas.indexOf(x.id) >= 0 ? 1 : 0;
      const ny = novas.indexOf(y.id) >= 0 ? 1 : 0;
      if (nx !== ny) return ny - nx;
      return Number(y.status === "escolhida") - Number(x.status === "escolhida");
    });
  const contagem = {
    ativas: todas.filter((o) => o.status !== "arquivada").length,
    escolhidas: todas.filter((o) => o.status === "escolhida").length,
    arquivadas: todas.filter((o) => o.status === "arquivada").length,
  };
  const conversaInicial = (todas.find((o) => !!o.conversa_id) || { conversa_id: null }).conversa_id;

  const trocarNaLista = (o: Oferta) =>
    queryClient.setQueryData<Oferta[]>(chavesAds.ofertas(clientId), (l) => {
      const atual = l || [];
      return atual.some((x) => x.id === o.id) ? atual.map((x) => (x.id === o.id ? o : x)) : [o].concat(atual);
    });

  const aoResponder = (r: RespostaDaOferta) => {
    setUltima(r);
    if (r.ofertas.length) {
      setNovas(r.ofertas.map((o) => o.id));
      setFiltro("ativas");
      r.ofertas.forEach(trocarNaLista);
    }
  };

  /** Oferta do contexto: sem IA, grátis; ao abrir sem oferta em uso, monta sozinha uma vez. */
  const montarDoContexto = async (forcar: boolean) => {
    setMontando(true);
    setErroDoContexto(null);
    try {
      const r = await montarOfertaDoContexto(clientId, { gravar: true, forcar });
      setDoContexto(r);
      if (r.oferta) {
        trocarNaLista(r.oferta);
        setNovas([r.oferta.id]);
        setFiltro("ativas");
        if (forcar) toast.success("Oferta remontada do contexto", { description: "Sem custo. Confira os campos e lapide com o agente." });
      }
      void queryClient.invalidateQueries({ queryKey: chavesAds.ofertas(clientId) });
    } catch (e) {
      setErroDoContexto(textoDoErro(e));
    } finally {
      setMontando(false);
    }
  };

  const ativasNoBanco = (ofertas.data || []).filter((o) => o.status !== "arquivada").length;
  useEffect(() => {
    if (tentouMontar.current || !ofertas.isSuccess || ativasNoBanco > 0) return;
    tentouMontar.current = true;
    void montarDoContexto(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ofertas.isSuccess, ativasNoBanco]);

  const lapidar = (o: Oferta) =>
    setPedidoAoAgente({
      texto: pedidoParaLapidar(o.nome, o.origem === "contexto", o.lacunas || []),
      ofertaId: o.id,
      nome: o.nome,
      chave: Date.now(),
    });

  const ocupar = (id: string, sim: boolean) => setOcupadas((l) => (sim ? l.concat([id]) : l.filter((x) => x !== id)));

  const salvarOferta = async (o: Oferta, corpo: { campos?: Record<string, unknown>; status?: StatusDaOferta }, aviso: string) => {
    ocupar(o.id, true);
    const antes = queryClient.getQueryData<Oferta[]>(chavesAds.ofertas(clientId));
    trocarNaLista({ ...o, ...(corpo.status ? { status: corpo.status } : {}) });
    try {
      const data = await chamarAds<any>("oferta_salvar", { client_id: clientId, oferta_id: o.id, ...corpo });
      if (data && data.oferta) trocarNaLista(normalizarOferta(data.oferta));
      toast.success(aviso);
      void queryClient.invalidateQueries({ queryKey: chavesAds.ofertas(clientId) });
    } catch (e) {
      queryClient.setQueryData(chavesAds.ofertas(clientId), antes);
      avisarErro(e, "Oferta não salva");
      throw e;
    } finally {
      ocupar(o.id, false);
    }
  };

  const mudarStatus = (o: Oferta, status: StatusDaOferta) => {
    const aviso = status === "escolhida" ? "Oferta escolhida" : status === "arquivada" ? "Oferta arquivada" : "Oferta restaurada";
    // Uma escolhida por vez: a anterior volta a proposta.
    const anteriores = status === "escolhida" ? todas.filter((x) => x.status === "escolhida" && x.id !== o.id) : [];
    salvarOferta(o, { status }, aviso)
      .then(() => Promise.all(anteriores.map((x) => chamarAds("oferta_salvar", { client_id: clientId, oferta_id: x.id, status: "rascunho" }).catch(() => null))))
      .then(() => {
        if (anteriores.length) void queryClient.invalidateQueries({ queryKey: chavesAds.ofertas(clientId) });
      })
      .catch(() => null);
  };

  const aplicarNoBriefing = (sugestao: Record<string, unknown>, origem: string) => {
    setRascunho((atual) => juntarBriefing(atual, sugestao));
    setAplicadoDe(origem);
    setBriefingAberto(true);
    toast.success("Aplicado no briefing", { description: "Confira os campos e salve." });
    window.setTimeout(() => {
      const el = briefingRef.current;
      if (el && typeof el.scrollIntoView === "function") el.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
  };

  const criar = (o: Oferta) => {
    if (onCriarCriativos) onCriarCriativos({ rotulo: `Criativos da oferta ${o.nome}`, oferta_id: o.id, objetivo });
  };

  const levarIdeia = (i: Ideia) => {
    if (!onCriarCriativos) return;
    const escolhida = todas.find((o) => o.status === "escolhida");
    const partes = [`Parta desta ideia de criativo: ${i.titulo}.`];
    if (i.gancho_verbal) partes.push(`Gancho verbal: ${i.gancho_verbal}.`);
    if (i.gancho_visual) partes.push(`Gancho visual: ${i.gancho_visual}.`);
    if (i.estilo_visual) partes.push(`Estilo visual: ${i.estilo_visual}.`);
    onCriarCriativos({ rotulo: `Ideia ${i.titulo}`, pedido: partes.join(" "), objetivo, oferta_id: escolhida ? escolhida.id : undefined });
  };

  // ------------------------------------------------------------ briefing

  const contagemDeLacunas =
    [
      b.oferta.produto, b.oferta.promessa, b.oferta.condicao, b.oferta.preco_confirmado, b.oferta.garantia,
      b.publico.quem, b.publico.estagio_consciencia, b.destino.tipo, b.destino.primeira_mensagem, b.objetivo.acao, b.objetivo.metrica_principal,
    ].filter((v) => vazio(String(v))).length +
    (b.publico.situacoes.length ? 0 : 1) +
    (b.provas.length ? 0 : 1) +
    (b.objecoes.length ? 0 : 1);

  return (
    <div className="min-w-0 space-y-5">
      <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">
        <AgenteDaOferta
          conversaInicial={conversaInicial}
          onResposta={aoResponder}
          pedido={pedidoAoAgente}
          className="h-[560px] xl:sticky xl:top-[140px] xl:order-2 xl:h-[calc(100vh-170px)]"
        />

        <div className="min-w-0 space-y-4 xl:order-1">
          <div className="flex min-w-0 flex-wrap items-center rounded-xl border border-border bg-card px-4 py-3">
            <div className="mb-1 mr-3 mt-1 min-w-0 flex-1">
              <h2 className="text-[15px] font-semibold">Ofertas</h2>
              <p className="text-[12px] text-muted-foreground">
                Converse com o agente ao lado. Cada oferta chega conferida pelo Jev; escolha uma e crie os criativos direto dela.
              </p>
            </div>
            <label className="mb-1 mt-1 flex min-w-0 items-center text-[11.5px] text-muted-foreground">
              <span className="mr-1.5 shrink-0">Objetivo dos criativos</span>
              <select
                aria-label="Objetivo dos criativos"
                value={objetivo}
                onChange={(e) => setObjetivoDosCriativos(e.target.value)}
                className="h-8 min-w-0 max-w-[200px] rounded-md border border-input bg-background px-2 text-[12px] text-foreground"
              >
                {OBJETIVOS.map((o) => (
                  <option key={o.valor} value={o.valor}>
                    {o.rotulo}
                  </option>
                ))}
              </select>
            </label>
            <div className="mt-2 flex w-full min-w-0 flex-wrap items-center" role="group" aria-label="Filtrar ofertas">
              {(["ativas", "escolhidas", "arquivadas"] as FiltroDeOferta[]).map((f) => (
                <button key={f} type="button" className={pilula(filtro === f)} onClick={() => setFiltro(f)} aria-pressed={filtro === f}>
                  {f === "ativas" ? "Em uso" : f === "escolhidas" ? "Escolhidas" : "Arquivadas"} ({contagem[f]})
                </button>
              ))}
            </div>
          </div>

          {(montando || erroDoContexto || todas.some((o) => o.origem === "contexto" && o.status !== "arquivada")) && (
            <div className="flex min-w-0 flex-wrap items-center rounded-xl border border-primary/30 bg-primary/5 px-4 py-3" role="note" aria-label="Oferta do contexto">
              <div className="mb-1 mr-3 mt-1 min-w-0 flex-1 text-[12.5px]">
                {montando ? (
                  <span className="inline-flex items-center">
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Montando a oferta pelo contexto do cliente (sem custo)…
                  </span>
                ) : erroDoContexto ? (
                  <span>A oferta do contexto não foi montada: {erroDoContexto}</span>
                ) : (
                  <>
                    <span className="font-medium">Oferta montada do contexto do cliente, sem IA.</span> Briefing, contexto da Mesa, brief, campanhas do mês e conta de anúncios; cada campo diz de onde veio. Edite à vontade e lapide com o agente ao lado.
                    {doContexto && doContexto.lacunas.length > 0 && (
                      <span className="mt-1 block text-[12px] text-muted-foreground">Falta no contexto: {doContexto.lacunas.slice(0, 4).join(" ")}</span>
                    )}
                  </>
                )}
              </div>
              <Button type="button" size="sm" variant="outline" className="mb-1 mt-1 h-8" disabled={montando} onClick={() => void montarDoContexto(true)} title="Lê o contexto de novo e remonta a oferta do contexto (sem custo)">
                <RefreshCw className="mr-1 h-3.5 w-3.5" /> Remontar do contexto
              </Button>
            </div>
          )}

          {ultima && ultima.resposta && (
            <p className="rounded-xl border border-border bg-card px-4 py-3 text-[12.5px] leading-relaxed [overflow-wrap:anywhere]" aria-label="Resumo do agente">
              {ultima.resposta}
            </p>
          )}

          {ultima && ultima.briefing_sugerido && (
            <div className="flex min-w-0 flex-wrap items-center rounded-xl border border-primary/30 bg-primary/5 px-4 py-3" role="note">
              <p className="mb-1 mr-3 mt-1 min-w-0 flex-1 text-[12.5px]">
                <span className="font-medium">O agente sugeriu mudanças no briefing.</span> Aplique para revisar campo a campo antes de salvar.
              </p>
              <Button type="button" size="sm" variant="outline" className="mb-1 mt-1 h-8" onClick={() => ultima.briefing_sugerido && aplicarNoBriefing(ultima.briefing_sugerido, "a sugestão do agente")}>
                Aplicar no briefing
              </Button>
            </div>
          )}

          {ultima && <Ideias ideias={ultima.ideias} onLevar={levarIdeia} />}

          {ofertas.isLoading && <div className="h-40 animate-pulse rounded-xl bg-muted/70" />}
          {ofertas.isError && todas.length === 0 && (
            <p className="rounded-xl border border-dashed border-border px-4 py-3 text-[12px] text-muted-foreground">
              As ofertas salvas ainda não abriram ({textoDoErro(ofertas.error)}). As que o agente propuser aparecem aqui mesmo assim.
            </p>
          )}
          {!ofertas.isLoading && listaDeOfertas.length === 0 && (
            <div className="rounded-xl border border-dashed border-border p-8 text-center">
              <p className="text-[14px] font-medium">{filtro === "ativas" ? "Nenhuma oferta ainda" : filtro === "escolhidas" ? "Nenhuma oferta escolhida" : "Nada arquivado"}</p>
              {filtro === "ativas" && (
                <p className="mt-1 text-[12.5px] text-muted-foreground">Conte ao agente o que o cliente vende e o que já testou. Ele propõe ofertas específicas, com as notas do Jev.</p>
              )}
            </div>
          )}
          {listaDeOfertas.length > 0 && (
            <div className="grid min-w-0 grid-cols-1 gap-3 2xl:grid-cols-2">
              {listaDeOfertas.map((o) => (
                <CartaoDaOferta
                  key={o.id}
                  oferta={o}
                  nova={novas.indexOf(o.id) >= 0}
                  ocupada={ocupadas.indexOf(o.id) >= 0}
                  onSalvar={(editada) => salvarOferta(editada, { campos: camposDaOferta(editada) }, "Oferta salva")}
                  onStatus={(s) => mudarStatus(o, s)}
                  onAplicar={() => aplicarNoBriefing(briefingDaOferta(o), `a oferta ${o.nome}`)}
                  onCriar={() => criar(o)}
                  onLapidar={() => lapidar(o)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      <div ref={briefingRef} className="min-w-0 space-y-4">
        <div className="flex min-w-0 flex-wrap items-center rounded-xl border border-border bg-card px-4 py-3">
          <button type="button" onClick={() => setBriefingAberto((v) => !v)} aria-expanded={briefingAberto} className="mb-1 mr-3 mt-1 flex min-w-0 flex-1 items-start text-left">
            <ChevronDown className={`mr-2 mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform ${briefingAberto ? "" : "-rotate-90"}`} />
            <span className="min-w-0">
              <span className="block text-[15px] font-semibold">Briefing de performance</span>
              <span className="block text-[12px] text-muted-foreground">
                {salvo.data ? `Versão ${salvo.data.versao} · salva ${dataEHora(salvo.data.criado_em)}` : "Ainda sem briefing salvo"}
                {" · "}
                <span className={contagemDeLacunas ? "text-warning" : "text-success"}>
                  {contagemDeLacunas ? `${contagemDeLacunas} lacuna${contagemDeLacunas === 1 ? "" : "s"}` : "sem lacunas"}
                </span>
                {base.objetivo.acao ? ` · objetivo: ${rotuloDoObjetivo(base.objetivo.acao)}` : ""}
              </span>
            </span>
          </button>
          <div className="mb-1 mt-1 flex shrink-0 flex-wrap items-center">
            <Andamento desde={desde} rotulo="Lendo o contexto" />
            <BotaoComCusto
              rotulo={<><Sparkles className="mr-1 h-3.5 w-3.5" /> Sugerir pelo contexto</>}
              titulo="Sugerir o briefing"
              descricao="Lê o kit, o contexto, o dossiê e as métricas de anúncios do cliente e propõe o briefing. O que não tiver dado fica como lacuna. Nada é gravado sem você salvar."
              variant="outline"
              className="ml-2 h-9"
              partes={() => partesDoBriefing(catalogo)}
              executar={() => rodar(() => chamarAds<any>("briefing_sugerir", { client_id: clientId }))}
              aoConcluir={(data) => {
                const sugestao = data && (data.sugestao || data.briefing);
                if (sugestao) setRascunho(normalizarBriefing(sugestao));
                setLacunasSugeridas(Array.isArray(data?.lacunas) ? data.lacunas.map((l: unknown) => String(l)) : []);
                setBriefingAberto(true);
              }}
            />
            <Button type="button" size="sm" className="ml-2 h-9" disabled={!mudou || salvando} onClick={() => void salvar()}>
              {salvando ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Check className="mr-1 h-3.5 w-3.5" />}
              Salvar briefing
            </Button>
          </div>
        </div>

        {salvo.isError && <AvisoDeErro erro={salvo.error} />}
        {salvo.isLoading && (
          <p className="inline-flex items-center text-[12.5px] text-muted-foreground">
            <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> Lendo o briefing…
          </p>
        )}

        {aplicadoDe && mudou && (
          <div className="rounded-xl border border-primary/30 bg-primary/5 px-4 py-3" role="note">
            <p className="text-[12.5px]">
              <span className="font-medium">Aplicado de {aplicadoDe}.</span> Confira os campos abaixo e salve para virar a versão atual.
            </p>
          </div>
        )}

        {lacunasSugeridas && (
          <div className="rounded-xl border border-warning/40 bg-warning/5 px-4 py-3" role="note">
            <p className="text-[12.5px] font-medium">Sugestão pelo contexto: confira, complete e salve.</p>
            {lacunasSugeridas.length > 0 ? (
              <>
                <p className="mt-0.5 text-[12px] text-muted-foreground">Sem dado real para:</p>
                <ul className="mt-1 flex flex-wrap">
                  {lacunasSugeridas.map((l) => (
                    <li key={l} className="mb-1 mr-1.5 rounded-full bg-warning/15 px-2 py-0.5 text-[11.5px] text-warning">
                      {l}
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="mt-0.5 text-[12px] text-muted-foreground">O contexto cobriu os campos principais.</p>
            )}
          </div>
        )}

        {briefingAberto && !salvo.isLoading && (
          <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-2">
            <Cartao titulo="Oferta" dica="O que se vende, a promessa e a condição. Preço só confirmado pelo cliente.">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Campo rotulo="Produto ou serviço" lacuna={vazio(b.oferta.produto)}>
                  <Input aria-label="Produto ou serviço" className={campoPequeno} value={b.oferta.produto} onChange={(e) => { const v = e.target.value; mudar((x) => { x.oferta.produto = v; return x; }); }} />
                </Campo>
                <Campo rotulo="Preço confirmado" lacuna={vazio(b.oferta.preco_confirmado)}>
                  <Input aria-label="Preço confirmado" className={campoPequeno} value={b.oferta.preco_confirmado} placeholder="Só o que o cliente confirmou" onChange={(e) => { const v = e.target.value; mudar((x) => { x.oferta.preco_confirmado = v; return x; }); }} />
                </Campo>
                <div className="sm:col-span-2">
                  <Campo rotulo="Promessa" lacuna={vazio(b.oferta.promessa)}>
                    <Textarea aria-label="Promessa" className={areaPequena} value={b.oferta.promessa} onChange={(e) => { const v = e.target.value; mudar((x) => { x.oferta.promessa = v; return x; }); }} />
                  </Campo>
                </div>
                <Campo rotulo="Condição" lacuna={vazio(b.oferta.condicao)}>
                  <Input aria-label="Condição" className={campoPequeno} value={b.oferta.condicao} onChange={(e) => { const v = e.target.value; mudar((x) => { x.oferta.condicao = v; return x; }); }} />
                </Campo>
                <Campo rotulo="Garantia" lacuna={vazio(b.oferta.garantia)}>
                  <Input aria-label="Garantia" className={campoPequeno} value={b.oferta.garantia} onChange={(e) => { const v = e.target.value; mudar((x) => { x.oferta.garantia = v; return x; }); }} />
                </Campo>
              </div>
            </Cartao>

            <Cartao
              titulo="Público, situações e estágio"
              dica="Quem compra, as situações vividas (cada uma com a fonte) e onde o comprador típico está."
              acao={<BotaoAdicionar onClick={() => mudar((x) => { x.publico.situacoes.push({ texto: "", fonte: "" }); return x; })}>Situação</BotaoAdicionar>}
            >
              <div className="space-y-3">
                <Campo rotulo="Quem" lacuna={vazio(b.publico.quem)}>
                  <Textarea aria-label="Quem compra" className={areaPequena} value={b.publico.quem} onChange={(e) => { const v = e.target.value; mudar((x) => { x.publico.quem = v; return x; }); }} />
                </Campo>
                <div className="min-w-0">
                  <span className="mb-1 flex items-center text-[11.5px] font-medium text-foreground/80">
                    Estágio de consciência
                    {!b.publico.estagio_consciencia && <span className="ml-1.5 rounded-full bg-warning/15 px-1.5 py-px text-[10px] font-medium text-warning">lacuna</span>}
                  </span>
                  <SelecaoEmPilulas
                    rotulo="Estágio de consciência"
                    valor={b.publico.estagio_consciencia}
                    opcoes={ESTAGIOS}
                    onMudar={(v) => mudar((x) => { x.publico.estagio_consciencia = v; return x; })}
                  />
                  {b.publico.estagio_consciencia && (
                    <p className="text-[11px] leading-snug text-muted-foreground">{(ESTAGIOS.find((e) => e.valor === b.publico.estagio_consciencia) || ESTAGIOS[0]).dica}</p>
                  )}
                </div>
                {b.publico.situacoes.length === 0 && (
                  <p className="rounded-md border border-dashed border-warning/50 px-3 py-2 text-[12px] text-muted-foreground">Lacuna: nenhuma situação com fonte.</p>
                )}
                {b.publico.situacoes.map((s, i) => (
                  <div key={i} className="flex min-w-0 items-start">
                    <div className="grid min-w-0 flex-1 grid-cols-1 gap-1.5 sm:grid-cols-3">
                      <Input aria-label={`Situação ${i + 1}`} className={`${campoPequeno} sm:col-span-2`} placeholder="Situação vivida" value={s.texto} onChange={(e) => { const v = e.target.value; mudar((x) => { x.publico.situacoes[i].texto = v; return x; }); }} />
                      <Input aria-label={`Fonte da situação ${i + 1}`} className={`${campoPequeno} ${vazio(s.fonte) ? "border-warning/60" : ""}`} placeholder="Fonte" value={s.fonte} onChange={(e) => { const v = e.target.value; mudar((x) => { x.publico.situacoes[i].fonte = v; return x; }); }} />
                    </div>
                    <BotaoRemover rotulo={`Tirar a situação ${i + 1}`} onClick={() => mudar((x) => { x.publico.situacoes.splice(i, 1); return x; })} />
                  </div>
                ))}
                <Campo rotulo="Motivações (separe por vírgula)" lacuna={b.publico.motivacoes.length === 0}>
                  <Input
                    aria-label="Motivações"
                    className={campoPequeno}
                    defaultValue={b.publico.motivacoes.join(", ")}
                    key={b.publico.motivacoes.join("|")}
                    onBlur={(e) => { const v = e.target.value; mudar((x) => { x.publico.motivacoes = v.split(",").map((m) => m.trim()).filter(Boolean); return x; }); }}
                  />
                </Campo>
              </div>
            </Cartao>

            <Cartao
              titulo="Objeções"
              dica="O que trava a compra, a resposta e de onde veio."
              acao={<BotaoAdicionar onClick={() => mudar((x) => { x.objecoes.push({ texto: "", resposta: "", fonte: "" }); return x; })}>Objeção</BotaoAdicionar>}
            >
              <div className="space-y-2.5">
                {b.objecoes.length === 0 && <p className="rounded-md border border-dashed border-warning/50 px-3 py-2 text-[12px] text-muted-foreground">Lacuna: nenhuma objeção registrada.</p>}
                {b.objecoes.map((o, i) => (
                  <div key={i} className="flex min-w-0 items-start rounded-lg border border-border p-2">
                    <div className="grid min-w-0 flex-1 grid-cols-1 gap-1.5">
                      <Input aria-label={`Objeção ${i + 1}`} className={campoPequeno} placeholder="Objeção" value={o.texto} onChange={(e) => { const v = e.target.value; mudar((x) => { x.objecoes[i].texto = v; return x; }); }} />
                      <Input aria-label={`Resposta da objeção ${i + 1}`} className={`${campoPequeno} ${vazio(o.resposta) ? "border-warning/60" : ""}`} placeholder="Resposta" value={o.resposta} onChange={(e) => { const v = e.target.value; mudar((x) => { x.objecoes[i].resposta = v; return x; }); }} />
                      <Input aria-label={`Fonte da objeção ${i + 1}`} className={`${campoPequeno} ${vazio(o.fonte) ? "border-warning/60" : ""}`} placeholder="Fonte" value={o.fonte} onChange={(e) => { const v = e.target.value; mudar((x) => { x.objecoes[i].fonte = v; return x; }); }} />
                    </div>
                    <BotaoRemover rotulo={`Tirar a objeção ${i + 1}`} onClick={() => mudar((x) => { x.objecoes.splice(i, 1); return x; })} />
                  </div>
                ))}
              </div>
            </Cartao>

            <Cartao
              titulo="Provas"
              dica="Só a prova que o cliente tem. Depoimento e número só entram no anúncio com autorização."
              acao={<BotaoAdicionar onClick={() => mudar((x) => { x.provas.push({ tipo: "depoimento", texto: "", fonte: "", autorizado: false, periodo: "" }); return x; })}>Prova</BotaoAdicionar>}
            >
              <div className="space-y-2.5">
                {b.provas.length === 0 && <p className="rounded-md border border-dashed border-warning/50 px-3 py-2 text-[12px] text-muted-foreground">Lacuna: nenhuma prova registrada.</p>}
                {b.provas.map((p, i) => (
                  <div key={i} className="flex min-w-0 items-start rounded-lg border border-border p-2">
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <div className="flex min-w-0 flex-wrap items-center">
                        <select
                          aria-label={`Tipo da prova ${i + 1}`}
                          value={p.tipo}
                          onChange={(e) => { const v = e.target.value as TipoDeProva; mudar((x) => { x.provas[i].tipo = v; return x; }); }}
                          className="mb-1 mr-2 h-8 rounded-md border border-input bg-background px-2 text-[12.5px]"
                        >
                          {TIPOS_DE_PROVA.map((t) => <option key={t.valor} value={t.valor}>{t.rotulo}</option>)}
                        </select>
                        <label className="mb-1 inline-flex items-center text-[12px]">
                          <input
                            type="checkbox"
                            checked={p.autorizado}
                            onChange={(e) => { const v = e.target.checked; mudar((x) => { x.provas[i].autorizado = v; return x; }); }}
                            className="mr-1.5 h-3.5 w-3.5 accent-primary"
                          />
                          autorizado
                        </label>
                        {!p.autorizado && <span className="mb-1 ml-2 text-[11px] text-warning">não vai para o anúncio</span>}
                      </div>
                      <Textarea aria-label={`Prova ${i + 1}`} className="min-h-[52px] text-[13px]" placeholder="O que a prova mostra" value={p.texto} onChange={(e) => { const v = e.target.value; mudar((x) => { x.provas[i].texto = v; return x; }); }} />
                      <div className="grid grid-cols-2 gap-1.5">
                        <Input aria-label={`Fonte da prova ${i + 1}`} className={`${campoPequeno} ${vazio(p.fonte) ? "border-warning/60" : ""}`} placeholder="Fonte" value={p.fonte} onChange={(e) => { const v = e.target.value; mudar((x) => { x.provas[i].fonte = v; return x; }); }} />
                        <Input aria-label={`Período da prova ${i + 1}`} className={campoPequeno} placeholder="Período" value={p.periodo} onChange={(e) => { const v = e.target.value; mudar((x) => { x.provas[i].periodo = v; return x; }); }} />
                      </div>
                    </div>
                    <BotaoRemover rotulo={`Tirar a prova ${i + 1}`} onClick={() => mudar((x) => { x.provas.splice(i, 1); return x; })} />
                  </div>
                ))}
              </div>
            </Cartao>

            <Cartao titulo="Destino" dica="Para onde o clique vai e a primeira mensagem que a pessoa manda.">
              <div className="space-y-3">
                <div className={`rounded-md ${b.destino.tipo ? "" : "ring-1 ring-warning/50"}`}>
                  <SelecaoEmPilulas rotulo="Tipo de destino" valor={b.destino.tipo} opcoes={DESTINOS} onMudar={(v) => mudar((x) => { x.destino.tipo = v; return x; })} />
                </div>
                <Campo rotulo="Endereço" lacuna={vazio(b.destino.url) && b.destino.tipo !== "direct" && b.destino.tipo !== "ligacao"}>
                  <Input aria-label="Endereço do destino" className={campoPequeno} value={b.destino.url} placeholder="https://" onChange={(e) => { const v = e.target.value; mudar((x) => { x.destino.url = v; return x; }); }} />
                </Campo>
                <Campo rotulo="Primeira mensagem" lacuna={vazio(b.destino.primeira_mensagem)} dica="O texto que já vem escrito no WhatsApp ou no Direct.">
                  <Textarea aria-label="Primeira mensagem" className={areaPequena} value={b.destino.primeira_mensagem} onChange={(e) => { const v = e.target.value; mudar((x) => { x.destino.primeira_mensagem = v; return x; }); }} />
                </Campo>
              </div>
            </Cartao>

            <Cartao titulo="Objetivo, métrica e restrições" dica="A métrica que decide é a do negócio (lead qualificado, reunião, venda, seguidor que fica), não só o clique.">
              <div className="space-y-3">
                <div className={`rounded-md ${b.objetivo.acao ? "" : "ring-1 ring-warning/50"}`}>
                  <SelecaoEmPilulas rotulo="Ação do objetivo" valor={b.objetivo.acao} opcoes={ACOES_DO_OBJETIVO} onMudar={(v) => mudar((x) => { x.objetivo.acao = v; return x; })} />
                </div>
                <Campo rotulo="Métrica principal" lacuna={vazio(b.objetivo.metrica_principal)}>
                  <Input aria-label="Métrica principal" className={campoPequeno} value={b.objetivo.metrica_principal} placeholder="Ex.: conversa qualificada no WhatsApp" onChange={(e) => { const v = e.target.value; mudar((x) => { x.objetivo.metrica_principal = v; return x; }); }} />
                </Campo>
                <div className="grid grid-cols-2 gap-3">
                  <Campo rotulo="Custo tolerável (R$)" lacuna={vazio(b.objetivo.custo_toleravel_brl)}>
                    <Input aria-label="Custo tolerável" inputMode="decimal" className={campoPequeno} value={b.objetivo.custo_toleravel_brl} onChange={(e) => { const v = e.target.value; mudar((x) => { x.objetivo.custo_toleravel_brl = v; return x; }); }} />
                  </Campo>
                  <Campo rotulo="Verba diária (R$)" lacuna={vazio(b.objetivo.verba_diaria_brl)}>
                    <Input aria-label="Verba diária" inputMode="decimal" className={campoPequeno} value={b.objetivo.verba_diaria_brl} onChange={(e) => { const v = e.target.value; mudar((x) => { x.objetivo.verba_diaria_brl = v; return x; }); }} />
                  </Campo>
                </div>
                <Campo rotulo="Restrições" dica="O que não pode aparecer: termos, promessas, pessoas, concorrentes, regras do setor.">
                  <Textarea aria-label="Restrições" className={areaPequena} value={b.restricoes} onChange={(e) => { const v = e.target.value; mudar((x) => { x.restricoes = v; return x; }); }} />
                </Campo>
              </div>
            </Cartao>
          </div>
        )}
      </div>

      {mudou && (
        <div className="sticky bottom-3 z-10 flex justify-end">
          <div className="flex items-center rounded-full border border-border bg-card px-3 py-1.5 shadow-md">
            <span className="mr-3 text-[12px] text-muted-foreground">Briefing com alterações não salvas</span>
            <Button type="button" size="sm" variant="ghost" className="h-8" onClick={() => { setRascunho(base); setLacunasSugeridas(null); setAplicadoDe(null); }}>
              Descartar
            </Button>
            <Button type="button" size="sm" className="ml-1 h-8" disabled={salvando} onClick={() => void salvar()}>
              Salvar
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
