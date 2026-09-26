import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown, Lightbulb, Loader2, Plus, RefreshCw, Rocket, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { AvisoDeErro, BotaoComCusto, useAvisarErro } from "@/components/mesa/Custo";
import { useMesa } from "@/components/mesa/MesaContexto";
import { dataEHora, textoDoErro } from "@/lib/mesa/api";
import AreaDeTrabalho from "@/components/sistema/AreaDeTrabalho";
import AjudaRecolhida from "@/components/sistema/AjudaRecolhida";
import BarraDeAcoes from "@/components/sistema/BarraDeAcoes";
import SeletorCompacto from "@/components/sistema/SeletorCompacto";
import { CampoDeFormulario, GrupoDeCampos } from "@/components/sistema/Formulario";
import { Carregando, EstadoVazio } from "@/components/sistema/Estados";
import { botao, juntar, superficie, texto } from "@/components/sistema/estilos";
import { useEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
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
import { Andamento, CabecalhoDaParte, useAndamento } from "./Comuns";
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
 * Etapa 1, Oferta. O agente de oferta (conversa com microfone e anexos) é a
 * lateral fixa da área de trabalho (sistema de design, 26/09): no computador
 * fica parado ao lado, com o campo sempre à vista, e só a coluna das ofertas
 * e do briefing rola; no celular abre em tela cheia pelo botão de baixo. As
 * ofertas que ele propôs vêm com as notas do Jev: escolher, editar,
 * arquivar, aplicar no briefing ou criar criativos direto (leva ao Plano de
 * teste com a oferta e o objetivo). Embaixo, o briefing de performance:
 * "Sugerir pelo contexto" propõe; campo sem dado aparece como lacuna, nunca
 * preenchido por suposição. A equipe revisa e salva (nova versão atual).
 * Nada do briefing grava sozinho. Filtro, objetivo e briefing aberto ficam
 * lembrados por cliente (useEstadoDaTela).
 */

const vazio = (v: string) => !v || !v.trim();

const campoPequeno = "h-9 text-[13px]";
const areaPequena = "min-h-[64px] text-[13px] leading-relaxed";
const seletorNativo = "h-9 min-w-0 max-w-full rounded-md border border-input bg-background px-2 text-[13px] text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** Marca de campo sem dado (nada é inventado). */
function Lacuna() {
  return <span className="ml-1.5 shrink-0 rounded-full bg-warning/15 px-1.5 py-px text-[10px] font-medium text-warning">lacuna</span>;
}

/** Campo do briefing: rótulo em cima (com a marca de lacuna), controle e uma linha de apoio. */
function CampoDoBriefing({ rotulo, lacuna = false, apoio, largo = false, children }: { rotulo: string; lacuna?: boolean; apoio?: string; largo?: boolean; children: ReactNode }) {
  return (
    <CampoDeFormulario
      largo={largo}
      apoio={apoio}
      rotulo={
        <>
          {rotulo}
          {lacuna && <Lacuna />}
        </>
      }
    >
      {children}
    </CampoDeFormulario>
  );
}

/** Rótulo de um grupo de escolha (pílulas), no mesmo lugar do rótulo do campo. */
function RotuloDeEscolha({ children, lacuna = false }: { children: string; lacuna?: boolean }) {
  return (
    <span className={juntar(texto.rotulo, "mb-1.5 flex min-w-0 items-center")}>
      <span className="min-w-0 truncate">{children}</span>
      {lacuna && <Lacuna />}
    </span>
  );
}

/** Um grupo do briefing: título curto, o "?" com a explicação e a ação (adicionar) na mesma linha. */
function GrupoDoBriefing({ titulo, ajuda, acao, children }: { titulo: string; ajuda: string; acao?: ReactNode; children: ReactNode }) {
  return (
    <section className="min-w-0 border-t border-border pt-4 first:border-t-0 first:pt-0 xl:[&:nth-child(2)]:border-t-0 xl:[&:nth-child(2)]:pt-0" aria-label={titulo}>
      <div className="mb-3 flex min-w-0 items-center">
        <h3 className={juntar(texto.tituloSecao, "min-w-0 truncate text-[14px]")}>{titulo}</h3>
        <AjudaRecolhida className="ml-1.5">{ajuda}</AjudaRecolhida>
        {acao && <div className="ml-auto shrink-0 pl-2">{acao}</div>}
      </div>
      {children}
    </section>
  );
}

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
    <div className="flex min-w-0 flex-wrap" role="radiogroup" aria-label={rotulo}>
      {opcoes.map((o) => {
        const ativa = valor === o.valor;
        return (
          <button
            key={o.valor}
            type="button"
            role="radio"
            aria-checked={ativa}
            onClick={() => onMudar(ativa ? "" : o.valor)}
            className={`mb-1.5 mr-1.5 max-w-full truncate rounded-full border px-2.5 py-1 text-[12px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
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
    <button type="button" onClick={onClick} aria-label={rotulo} title={rotulo} className={juntar(botao.icone, "ml-1")}>
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

/** Linha de aviso fina (sem caixa com borda): o que aconteceu e a ação à direita. */
function Aviso({ children, acao, tom = "neutro", rotulo }: { children: ReactNode; acao?: ReactNode; tom?: "neutro" | "destaque" | "atencao"; rotulo?: string }) {
  const cor = tom === "destaque" ? "bg-primary/5" : tom === "atencao" ? "bg-warning/5" : superficie.poco;
  return (
    <div className={juntar("flex min-w-0 flex-wrap items-center rounded-md px-3 py-2", cor)} role="note" aria-label={rotulo}>
      <div className="mr-3 min-w-0 flex-1 py-0.5 text-[12.5px] leading-snug [overflow-wrap:anywhere]">{children}</div>
      {acao && <div className="shrink-0 py-0.5">{acao}</div>}
    </div>
  );
}

type FiltroDeOferta = "ativas" | "escolhidas" | "arquivadas";
const FILTROS: FiltroDeOferta[] = ["ativas", "escolhidas", "arquivadas"];

function Ideias({ ideias, onLevar }: { ideias: Ideia[]; onLevar: (i: Ideia) => void }) {
  if (!ideias.length) return null;
  return (
    <section className="min-w-0" aria-label="Ideias de criativo">
      <h3 className={juntar(texto.rotulo, "flex items-center")}>
        <Lightbulb className="mr-1.5 h-3.5 w-3.5 text-primary" /> Ideias de criativo da última resposta
      </h3>
      <ul className="mt-1 min-w-0 divide-y divide-border">
        {ideias.map((i, k) => (
          <li key={`${i.titulo}-${k}`} className="flex min-w-0 flex-wrap items-start py-2.5">
            <div className="mr-3 min-w-0 flex-1">
              <p className="text-[12.5px] font-semibold [overflow-wrap:anywhere]">{i.titulo}</p>
              {i.gancho_verbal && <p className="mt-0.5 font-serif text-[14.5px] font-semibold leading-snug [overflow-wrap:anywhere]">{`“${i.gancho_verbal}”`}</p>}
              {i.gancho_visual && <p className="mt-0.5 text-[12px] leading-snug text-muted-foreground [overflow-wrap:anywhere]">{i.gancho_visual}</p>}
              {(i.estilo_visual || i.formato) && (
                <p className={juntar(texto.auxiliar, "mt-0.5 truncate")}>{[i.estilo_visual ? humanizar(i.estilo_visual) : "", i.formato ? humanizar(i.formato) : ""].filter(Boolean).join(" · ")}</p>
              )}
            </div>
            <button type="button" onClick={() => onLevar(i)} className={juntar(botao.discreto, "h-8 text-primary")}>
              <Rocket className="mr-1 h-3.5 w-3.5" /> Levar ao plano
            </button>
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
  // Filtro, objetivo e briefing aberto: lembrados por cliente (sair e voltar mantém).
  const [filtro, setFiltro] = useEstadoDaTela<FiltroDeOferta>(`mesa-ads:oferta:filtro:${clientId}`, "ativas", {
    validar: (v) => typeof v === "string" && FILTROS.indexOf(v as FiltroDeOferta) >= 0,
  });
  const [objetivoDosCriativos, setObjetivoDosCriativos] = useEstadoDaTela(`mesa-ads:oferta:objetivo:${clientId}`, "", {
    validar: (v) => typeof v === "string" && OBJETIVOS.some((o) => o.valor === v),
    esperaMs: 0,
  });
  const [briefingAberto, setBriefingAberto] = useEstadoDaTela(`mesa-ads:oferta:briefing-aberto:${clientId}`, true, { validar: (v) => typeof v === "boolean" });
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

  const descartar = () => {
    setRascunho(base);
    setLacunasSugeridas(null);
    setAplicadoDe(null);
  };

  const temOfertaDoContexto = todas.some((o) => o.origem === "contexto" && o.status !== "arquivada");

  return (
    // Área de trabalho (src/components/sistema/AreaDeTrabalho.tsx): no computador
    // ofertas e briefing rolam por dentro e o agente fica parado ao lado, com o
    // campo sempre à vista; no celular a página rola normal e o agente abre em
    // tela cheia pelo botão de baixo.
    <AreaDeTrabalho
      memoria="mesa-ads-oferta"
      rotuloDaLateral="Agente da oferta"
      iconeDaLateral={<Sparkles className="h-4 w-4" />}
      rotuloDoPrincipal="Ofertas e briefing"
      memoriaDaRolagem={`mesa-ads:oferta:${clientId}`}
      lateral={<AgenteDaOferta conversaInicial={conversaInicial} onResposta={aoResponder} pedido={pedidoAoAgente} />}
    >
      <div className="min-w-0 space-y-6 pb-6">
        <section className="min-w-0" aria-label="Ofertas">
          <CabecalhoDaParte
            titulo="Ofertas"
            ajuda="Converse com o agente ao lado. Cada oferta chega conferida pelo Jev; escolha uma e crie os criativos direto dela. O objetivo dos criativos vai junto para o Plano de teste."
            descricao={`${contagem.ativas} em uso · ${contagem.escolhidas} escolhida${contagem.escolhidas === 1 ? "" : "s"}`}
          />
          <div className="-m-1 mb-2 flex min-w-0 flex-wrap items-center [&>*]:m-1">
            <SeletorCompacto
              rotulo="Filtrar ofertas"
              opcoes={FILTROS.map((f) => ({ valor: f, rotulo: f === "ativas" ? "Em uso" : f === "escolhidas" ? "Escolhidas" : "Arquivadas", contador: contagem[f] }))}
              valor={filtro}
              onEscolher={(v) => setFiltro(v as FiltroDeOferta)}
            />
            <label className="flex min-w-0 max-w-full items-center">
              <span className={juntar(texto.auxiliar, "mr-2 shrink-0")}>Objetivo</span>
              <select aria-label="Objetivo dos criativos" value={objetivo} onChange={(e) => setObjetivoDosCriativos(e.target.value)} className={seletorNativo}>
                {OBJETIVOS.map((o) => (
                  <option key={o.valor} value={o.valor}>
                    {o.rotulo}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="min-w-0 space-y-2">
            {(montando || erroDoContexto || temOfertaDoContexto) && (
              <Aviso
                tom="destaque"
                rotulo="Oferta do contexto"
                acao={
                  <button type="button" className={juntar(botao.discreto, "h-8")} disabled={montando} onClick={() => void montarDoContexto(true)} title="Lê o contexto de novo e remonta a oferta do contexto (sem custo)">
                    <RefreshCw className="mr-1 h-3.5 w-3.5" /> Remontar do contexto
                  </button>
                }
              >
                {montando ? (
                  <span className="inline-flex items-center">
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Montando a oferta pelo contexto (sem custo)…
                  </span>
                ) : erroDoContexto ? (
                  <span>A oferta do contexto não foi montada: {erroDoContexto}</span>
                ) : (
                  <span className="inline-flex min-w-0 max-w-full items-center">
                    <span className="min-w-0">
                      <span className="font-medium">Oferta montada do contexto, sem IA.</span>
                      {doContexto && doContexto.lacunas.length > 0 && <span className="text-muted-foreground"> Falta: {doContexto.lacunas.slice(0, 4).join(" ")}</span>}
                    </span>
                    <AjudaRecolhida className="ml-1.5" rotulo="De onde veio a oferta">
                      Briefing, contexto da Mesa, brief, campanhas do mês e conta de anúncios; cada campo diz de onde veio. Edite à vontade e lapide com o agente ao lado.
                    </AjudaRecolhida>
                  </span>
                )}
              </Aviso>
            )}

            {ultima && ultima.resposta && (
              <p className={juntar(superficie.poco, "px-3 py-2 text-[12.5px] leading-relaxed [overflow-wrap:anywhere]")} aria-label="Resumo do agente">
                {ultima.resposta}
              </p>
            )}

            {ultima && ultima.briefing_sugerido && (
              <Aviso
                tom="destaque"
                acao={
                  <Button type="button" size="sm" variant="outline" className="h-8" onClick={() => ultima.briefing_sugerido && aplicarNoBriefing(ultima.briefing_sugerido, "a sugestão do agente")}>
                    Aplicar no briefing
                  </Button>
                }
              >
                <span className="font-medium">O agente sugeriu mudanças no briefing.</span> Aplique para revisar antes de salvar.
              </Aviso>
            )}
          </div>

          {ultima && ultima.ideias.length > 0 && (
            <div className="mt-4">
              <Ideias ideias={ultima.ideias} onLevar={levarIdeia} />
            </div>
          )}

          <div className="mt-3 min-w-0">
            {ofertas.isLoading && <Carregando forma="lista" linhas={3} rotulo="Lendo as ofertas" />}
            {ofertas.isError && todas.length === 0 && (
              <EstadoVazio compacto titulo="As ofertas salvas ainda não abriram." descricao={`(${textoDoErro(ofertas.error)}) As que o agente propuser aparecem aqui mesmo assim.`} />
            )}
            {!ofertas.isLoading && listaDeOfertas.length === 0 && (
              <EstadoVazio
                compacto
                titulo={filtro === "ativas" ? "Nenhuma oferta ainda" : filtro === "escolhidas" ? "Nenhuma oferta escolhida" : "Nada arquivado"}
                descricao={filtro === "ativas" ? "Conte ao agente o que o cliente vende e o que já testou." : undefined}
              />
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
        </section>

        <div ref={briefingRef} className="min-w-0 scroll-mt-4 border-t border-border pt-5">
          <CabecalhoDaParte
            titulo="Briefing de performance"
            ajuda="O briefing que o estrategista usa no plano e na copy. Sugerir pelo contexto lê o kit, o contexto, o dossiê e as métricas de anúncios e propõe; o que não tiver dado fica como lacuna. Nada é gravado sem você salvar."
            descricao={
              <>
                {salvo.data ? `Versão ${salvo.data.versao} · ${dataEHora(salvo.data.criado_em)}` : "Sem briefing salvo"}
                {" · "}
                <span className={contagemDeLacunas ? "text-warning" : "text-success"}>{contagemDeLacunas ? `${contagemDeLacunas} lacuna${contagemDeLacunas === 1 ? "" : "s"}` : "sem lacunas"}</span>
                {base.objetivo.acao ? ` · ${rotuloDoObjetivo(base.objetivo.acao)}` : ""}
              </>
            }
            acoes={
              <>
                <Andamento desde={desde} rotulo="Lendo o contexto" />
                <BotaoComCusto
                  rotulo={<><Sparkles className="mr-1 h-3.5 w-3.5" /> Sugerir pelo contexto</>}
                  titulo="Sugerir o briefing"
                  descricao="Lê o kit, o contexto, o dossiê e as métricas de anúncios do cliente e propõe o briefing. O que não tiver dado fica como lacuna. Nada é gravado sem você salvar."
                  variant="outline"
                  className="h-9"
                  partes={() => partesDoBriefing(catalogo)}
                  executar={() => rodar(() => chamarAds<any>("briefing_sugerir", { client_id: clientId }))}
                  aoConcluir={(data) => {
                    const sugestao = data && (data.sugestao || data.briefing);
                    if (sugestao) setRascunho(normalizarBriefing(sugestao));
                    setLacunasSugeridas(Array.isArray(data?.lacunas) ? data.lacunas.map((l: unknown) => String(l)) : []);
                    setBriefingAberto(true);
                  }}
                />
                <Button type="button" size="sm" className="h-9" disabled={!mudou || salvando} onClick={() => void salvar()}>
                  {salvando ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Check className="mr-1 h-3.5 w-3.5" />}
                  Salvar briefing
                </Button>
                <button
                  type="button"
                  onClick={() => setBriefingAberto((v) => !v)}
                  aria-expanded={briefingAberto}
                  aria-label={briefingAberto ? "Recolher o briefing" : "Abrir o briefing"}
                  title={briefingAberto ? "Recolher o briefing" : "Abrir o briefing"}
                  className={botao.icone}
                >
                  <ChevronDown className={`h-4 w-4 transition-transform ${briefingAberto ? "rotate-180" : ""}`} aria-hidden="true" />
                </button>
              </>
            }
          />

          <div className="min-w-0 space-y-2">
            {salvo.isError && <AvisoDeErro erro={salvo.error} />}
            {aplicadoDe && mudou && (
              <Aviso tom="destaque">
                <span className="font-medium">Aplicado de {aplicadoDe}.</span> Confira os campos e salve.
              </Aviso>
            )}
            {lacunasSugeridas && (
              <Aviso tom="atencao">
                <span className="font-medium">Sugestão pelo contexto: confira, complete e salve.</span>
                {lacunasSugeridas.length > 0 ? (
                  <>
                    <span className="text-muted-foreground"> Sem dado real para:</span>
                    <ul className="mt-1 flex flex-wrap">
                      {lacunasSugeridas.map((l) => (
                        <li key={l} className="mb-1 mr-1.5 rounded-full bg-warning/15 px-2 py-0.5 text-[11.5px] text-warning">
                          {l}
                        </li>
                      ))}
                    </ul>
                  </>
                ) : (
                  <span className="text-muted-foreground"> O contexto cobriu os campos principais.</span>
                )}
              </Aviso>
            )}
          </div>

          {salvo.isLoading && <Carregando forma="lista" linhas={4} rotulo="Lendo o briefing" className="mt-3" />}

          {briefingAberto && !salvo.isLoading && (
            <div className={juntar(superficie.painel, "mt-3 grid min-w-0 grid-cols-1 gap-x-8 gap-y-5 p-4 sm:p-5 xl:grid-cols-2")}>
              <GrupoDoBriefing titulo="Oferta" ajuda="O que se vende, a promessa e a condição. Preço só confirmado pelo cliente.">
                <GrupoDeCampos>
                  <CampoDoBriefing rotulo="Produto ou serviço" lacuna={vazio(b.oferta.produto)}>
                    <Input aria-label="Produto ou serviço" className={campoPequeno} value={b.oferta.produto} onChange={(e) => { const v = e.target.value; mudar((x) => { x.oferta.produto = v; return x; }); }} />
                  </CampoDoBriefing>
                  <CampoDoBriefing rotulo="Preço confirmado" lacuna={vazio(b.oferta.preco_confirmado)}>
                    <Input aria-label="Preço confirmado" className={campoPequeno} value={b.oferta.preco_confirmado} placeholder="Só o que o cliente confirmou" onChange={(e) => { const v = e.target.value; mudar((x) => { x.oferta.preco_confirmado = v; return x; }); }} />
                  </CampoDoBriefing>
                  <CampoDoBriefing rotulo="Promessa" lacuna={vazio(b.oferta.promessa)} largo>
                    <Textarea aria-label="Promessa" className={areaPequena} value={b.oferta.promessa} onChange={(e) => { const v = e.target.value; mudar((x) => { x.oferta.promessa = v; return x; }); }} />
                  </CampoDoBriefing>
                  <CampoDoBriefing rotulo="Condição" lacuna={vazio(b.oferta.condicao)}>
                    <Input aria-label="Condição" className={campoPequeno} value={b.oferta.condicao} onChange={(e) => { const v = e.target.value; mudar((x) => { x.oferta.condicao = v; return x; }); }} />
                  </CampoDoBriefing>
                  <CampoDoBriefing rotulo="Garantia" lacuna={vazio(b.oferta.garantia)}>
                    <Input aria-label="Garantia" className={campoPequeno} value={b.oferta.garantia} onChange={(e) => { const v = e.target.value; mudar((x) => { x.oferta.garantia = v; return x; }); }} />
                  </CampoDoBriefing>
                </GrupoDeCampos>
              </GrupoDoBriefing>

              <GrupoDoBriefing
                titulo="Público, situações e estágio"
                ajuda="Quem compra, as situações vividas (cada uma com a fonte) e onde o comprador típico está."
                acao={<BotaoAdicionar onClick={() => mudar((x) => { x.publico.situacoes.push({ texto: "", fonte: "" }); return x; })}>Situação</BotaoAdicionar>}
              >
                <div className="min-w-0 space-y-4">
                  <GrupoDeCampos colunas={1}>
                    <CampoDoBriefing rotulo="Quem" lacuna={vazio(b.publico.quem)}>
                      <Textarea aria-label="Quem compra" className={areaPequena} value={b.publico.quem} onChange={(e) => { const v = e.target.value; mudar((x) => { x.publico.quem = v; return x; }); }} />
                    </CampoDoBriefing>
                  </GrupoDeCampos>
                  <div className="min-w-0">
                    <RotuloDeEscolha lacuna={!b.publico.estagio_consciencia}>Estágio de consciência</RotuloDeEscolha>
                    <SelecaoEmPilulas
                      rotulo="Estágio de consciência"
                      valor={b.publico.estagio_consciencia}
                      opcoes={ESTAGIOS}
                      onMudar={(v) => mudar((x) => { x.publico.estagio_consciencia = v; return x; })}
                    />
                    {b.publico.estagio_consciencia && (
                      <p className="text-[11.5px] leading-snug text-muted-foreground">{(ESTAGIOS.find((e) => e.valor === b.publico.estagio_consciencia) || ESTAGIOS[0]).dica}</p>
                    )}
                  </div>
                  <div className="min-w-0 space-y-2">
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
                  </div>
                  <GrupoDeCampos colunas={1}>
                    <CampoDoBriefing rotulo="Motivações" apoio="Separe por vírgula." lacuna={b.publico.motivacoes.length === 0}>
                      <Input
                        aria-label="Motivações"
                        className={campoPequeno}
                        defaultValue={b.publico.motivacoes.join(", ")}
                        key={b.publico.motivacoes.join("|")}
                        onBlur={(e) => { const v = e.target.value; mudar((x) => { x.publico.motivacoes = v.split(",").map((m) => m.trim()).filter(Boolean); return x; }); }}
                      />
                    </CampoDoBriefing>
                  </GrupoDeCampos>
                </div>
              </GrupoDoBriefing>

              <GrupoDoBriefing
                titulo="Objeções"
                ajuda="O que trava a compra, a resposta e de onde veio."
                acao={<BotaoAdicionar onClick={() => mudar((x) => { x.objecoes.push({ texto: "", resposta: "", fonte: "" }); return x; })}>Objeção</BotaoAdicionar>}
              >
                <div className="min-w-0 space-y-2">
                  {b.objecoes.length === 0 && <p className="rounded-md border border-dashed border-warning/50 px-3 py-2 text-[12px] text-muted-foreground">Lacuna: nenhuma objeção registrada.</p>}
                  {b.objecoes.map((o, i) => (
                    <div key={i} className={juntar(superficie.poco, "flex min-w-0 items-start p-2")}>
                      <div className="grid min-w-0 flex-1 grid-cols-1 gap-1.5">
                        <Input aria-label={`Objeção ${i + 1}`} className={campoPequeno} placeholder="Objeção" value={o.texto} onChange={(e) => { const v = e.target.value; mudar((x) => { x.objecoes[i].texto = v; return x; }); }} />
                        <Input aria-label={`Resposta da objeção ${i + 1}`} className={`${campoPequeno} ${vazio(o.resposta) ? "border-warning/60" : ""}`} placeholder="Resposta" value={o.resposta} onChange={(e) => { const v = e.target.value; mudar((x) => { x.objecoes[i].resposta = v; return x; }); }} />
                        <Input aria-label={`Fonte da objeção ${i + 1}`} className={`${campoPequeno} ${vazio(o.fonte) ? "border-warning/60" : ""}`} placeholder="Fonte" value={o.fonte} onChange={(e) => { const v = e.target.value; mudar((x) => { x.objecoes[i].fonte = v; return x; }); }} />
                      </div>
                      <BotaoRemover rotulo={`Tirar a objeção ${i + 1}`} onClick={() => mudar((x) => { x.objecoes.splice(i, 1); return x; })} />
                    </div>
                  ))}
                </div>
              </GrupoDoBriefing>

              <GrupoDoBriefing
                titulo="Provas"
                ajuda="Só a prova que o cliente tem. Depoimento e número só entram no anúncio com autorização."
                acao={<BotaoAdicionar onClick={() => mudar((x) => { x.provas.push({ tipo: "depoimento", texto: "", fonte: "", autorizado: false, periodo: "" }); return x; })}>Prova</BotaoAdicionar>}
              >
                <div className="min-w-0 space-y-2">
                  {b.provas.length === 0 && <p className="rounded-md border border-dashed border-warning/50 px-3 py-2 text-[12px] text-muted-foreground">Lacuna: nenhuma prova registrada.</p>}
                  {b.provas.map((p, i) => (
                    <div key={i} className={juntar(superficie.poco, "flex min-w-0 items-start p-2")}>
                      <div className="min-w-0 flex-1 space-y-1.5">
                        <div className="flex min-w-0 flex-wrap items-center">
                          <select
                            aria-label={`Tipo da prova ${i + 1}`}
                            value={p.tipo}
                            onChange={(e) => { const v = e.target.value as TipoDeProva; mudar((x) => { x.provas[i].tipo = v; return x; }); }}
                            className={juntar(seletorNativo, "mb-1 mr-2")}
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
              </GrupoDoBriefing>

              <GrupoDoBriefing titulo="Destino" ajuda="Para onde o clique vai e a primeira mensagem que a pessoa manda.">
                <div className="min-w-0 space-y-4">
                  <div className="min-w-0">
                    <RotuloDeEscolha lacuna={!b.destino.tipo}>Tipo de destino</RotuloDeEscolha>
                    <SelecaoEmPilulas rotulo="Tipo de destino" valor={b.destino.tipo} opcoes={DESTINOS} onMudar={(v) => mudar((x) => { x.destino.tipo = v; return x; })} />
                  </div>
                  <GrupoDeCampos>
                    <CampoDoBriefing rotulo="Endereço" lacuna={vazio(b.destino.url) && b.destino.tipo !== "direct" && b.destino.tipo !== "ligacao"}>
                      <Input aria-label="Endereço do destino" className={campoPequeno} value={b.destino.url} placeholder="https://" onChange={(e) => { const v = e.target.value; mudar((x) => { x.destino.url = v; return x; }); }} />
                    </CampoDoBriefing>
                    <CampoDoBriefing rotulo="Primeira mensagem" lacuna={vazio(b.destino.primeira_mensagem)} apoio="O texto que já vem escrito no WhatsApp ou no Direct." largo>
                      <Textarea aria-label="Primeira mensagem" className={areaPequena} value={b.destino.primeira_mensagem} onChange={(e) => { const v = e.target.value; mudar((x) => { x.destino.primeira_mensagem = v; return x; }); }} />
                    </CampoDoBriefing>
                  </GrupoDeCampos>
                </div>
              </GrupoDoBriefing>

              <GrupoDoBriefing titulo="Objetivo, métrica e restrições" ajuda="A métrica que decide é a do negócio (lead qualificado, reunião, venda, seguidor que fica), não só o clique.">
                <div className="min-w-0 space-y-4">
                  <div className="min-w-0">
                    <RotuloDeEscolha lacuna={!b.objetivo.acao}>Ação do objetivo</RotuloDeEscolha>
                    <SelecaoEmPilulas rotulo="Ação do objetivo" valor={b.objetivo.acao} opcoes={ACOES_DO_OBJETIVO} onMudar={(v) => mudar((x) => { x.objetivo.acao = v; return x; })} />
                  </div>
                  <GrupoDeCampos>
                    <CampoDoBriefing rotulo="Métrica principal" lacuna={vazio(b.objetivo.metrica_principal)} largo>
                      <Input aria-label="Métrica principal" className={campoPequeno} value={b.objetivo.metrica_principal} placeholder="Ex.: conversa qualificada no WhatsApp" onChange={(e) => { const v = e.target.value; mudar((x) => { x.objetivo.metrica_principal = v; return x; }); }} />
                    </CampoDoBriefing>
                    <CampoDoBriefing rotulo="Custo tolerável (R$)" lacuna={vazio(b.objetivo.custo_toleravel_brl)}>
                      <Input aria-label="Custo tolerável" inputMode="decimal" className={campoPequeno} value={b.objetivo.custo_toleravel_brl} onChange={(e) => { const v = e.target.value; mudar((x) => { x.objetivo.custo_toleravel_brl = v; return x; }); }} />
                    </CampoDoBriefing>
                    <CampoDoBriefing rotulo="Verba diária (R$)" lacuna={vazio(b.objetivo.verba_diaria_brl)}>
                      <Input aria-label="Verba diária" inputMode="decimal" className={campoPequeno} value={b.objetivo.verba_diaria_brl} onChange={(e) => { const v = e.target.value; mudar((x) => { x.objetivo.verba_diaria_brl = v; return x; }); }} />
                    </CampoDoBriefing>
                    <CampoDoBriefing rotulo="Restrições" apoio="Termos, promessas, pessoas, concorrentes e regras do setor que não podem aparecer." largo>
                      <Textarea aria-label="Restrições" className={areaPequena} value={b.restricoes} onChange={(e) => { const v = e.target.value; mudar((x) => { x.restricoes = v; return x; }); }} />
                    </CampoDoBriefing>
                  </GrupoDeCampos>
                </div>
              </GrupoDoBriefing>
            </div>
          )}

          {/* Alterações sem salvar: no computador a barra gruda no pé da coluna que rola;
              no celular fica no fim do formulário (sem nada flutuando sobre os campos). */}
          {mudou && (
            <BarraDeAcoes
              className="mt-3 border-t border-border bg-background/95 py-3 lg:sticky lg:bottom-0 lg:z-10"
              inicio={<span className="block truncate">Briefing com alterações não salvas</span>}
            >
              <Button type="button" size="sm" variant="ghost" className="h-8" onClick={descartar}>
                Descartar
              </Button>
              <Button type="button" size="sm" className="h-8" disabled={salvando} onClick={() => void salvar()}>
                Salvar
              </Button>
            </BarraDeAcoes>
          )}
        </div>
      </div>
    </AreaDeTrabalho>
  );
}
