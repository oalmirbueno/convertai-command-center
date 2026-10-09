import { useEffect, useMemo, useRef, useState } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Paperclip, Save, Users } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useCatalogo } from "@/components/mesa/MesaContexto";
import { SeletorDeModelo } from "@/components/mesa/Seletores";
import Secao, { CabecalhoDeSecao } from "@/components/sistema/Secao";
import SeletorCompacto from "@/components/sistema/SeletorCompacto";
import TituloRecolhivel, { useRecolhido } from "@/components/sistema/TituloRecolhivel";
import { CampoDeFormulario, GrupoDeCampos } from "@/components/sistema/Formulario";
import { EstadoDeErro, Carregando } from "@/components/sistema/Estados";
import { useEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
import { botao, campo, campoTexto, juntar, lista, texto } from "@/components/sistema/estilos";
import { useAtraso } from "@/lib/useAtraso";
import { dataEHora, modeloDoPapel, textoDoErro, usd } from "@/lib/mesa/api";
import {
  type CatalogoDoConselho,
  convocarConselho,
  type ElencoSalvo,
  estimarConselho,
  lerCatalogoDoConselho,
  listarElencos,
  type ModoDoConselho,
  NOME_DO_NIVEL,
  NOME_DO_STATUS,
  type PresetDoConselho,
  ROTULO_DO_MODO,
  rodadasDoModo,
  salvarElenco,
  type SessaoDoConselho,
  sessaoAtiva,
  useSessoesDoConselho,
} from "@/lib/conselho/api";

/**
 * Convocar o conselho (frente CNS, 30/09; ampliado na frente BRF2 e
 * simplificado na frente UXS): à vista só a pergunta, quem entra e o rodapé
 * com o custo e o Convocar. Tema, contexto da mesa, modelos, modo, rodadas e
 * teto ficam em "Ajustes" (recolhido, com o resumo à vista); a pauta com
 * anexos é a seção de baixo.
 *
 * - A mesa que tem preset (Proposta, Site, Identidade, Publicidade) já abre
 *   com ele marcado e a pergunta pronta, editável. Rascunho do dono nunca é
 *   sobrescrito.
 * - O custo estimado aparece antes, sem IA, com um respiro de 300 ms entre
 *   cliques (uma chamada só) e o valor anterior à vista enquanto recalcula.
 *   O Convocar só vale com a estimativa do elenco escolhido.
 * - Botão travado diz o porquê no rodapé; o que mora em Ajustes tem
 *   "Ajustar", que abre o bloco no campo.
 * - `base`: "Convocar de novo" de uma sessão parada, com erro ou no teto
 *   (volta tudo preenchido; nada é convocado sem o clique).
 */

const MAX_ANEXOS = 5;

type ArquivoDaPauta = { id: string; file_name: string; folder: string | null; created_at: string };
type CampoDosAjustes = "tema" | "teto" | "modelo";

/** O aparelho tem mouse de verdade? (mesmo teste do AjudaRecolhida): só aí o foco vai sozinho para o campo. */
function temMouse(): boolean {
  try {
    return typeof window.matchMedia === "function" && window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  } catch {
    return false;
  }
}

/** Preset da mesa de onde a Sala abriu (a crise, "painel-crise", nunca entra sozinha). */
function presetDaOrigem(cat: CatalogoDoConselho, origem: string): PresetDoConselho | null {
  return (cat.presets || []).find((p) => !!p.origem && p.origem === origem) || null;
}

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;
/** Centavos para cima, sem o erro do ponto flutuante (0,4 x 1,5 = 0,60, não 0,61). */
const centavosParaCima = (v: number) => Math.ceil(Math.round(v * 10000) / 100) / 100;

export default function ConvocarConselho({
  clientId,
  origem,
  temaInicial,
  contextoInicial,
  referencia,
  onAbrir,
  base = null,
}: {
  clientId: string;
  origem: string;
  temaInicial: string;
  contextoInicial?: string;
  referencia?: Record<string, unknown> | null;
  onAbrir: (sessaoId: string) => void;
  /** Sessão de onde veio o "Convocar de novo": só preenche o formulário. */
  base?: SessaoDoConselho | null;
}) {
  const qc = useQueryClient();
  const catalogoDoConselho = useQuery({
    queryKey: ["conselho", "catalogo", origem],
    queryFn: () => lerCatalogoDoConselho(origem),
    staleTime: 10 * 60_000,
    gcTime: 10 * 60_000,
  });
  const catalogoDeModelos = useCatalogo();
  const sessoes = useSessoesDoConselho(clientId);
  const elencos = useQuery({ queryKey: ["conselho", "elencos", clientId], queryFn: () => listarElencos(clientId), staleTime: 10 * 60_000, gcTime: 10 * 60_000 });

  const chave = `conselho:${origem}:${clientId}`;
  // Tema e contexto vêm da tela de onde a Sala abriu (sempre os de agora); a pergunta é rascunho e fica guardada.
  const [tema, setTema] = useState(() => (base && base.tema ? base.tema : temaInicial));
  const [pergunta, setPergunta] = useEstadoDaTela<string>(`${chave}:pergunta`, "");
  const [contexto, setContexto] = useState(() => (base && base.contexto ? base.contexto : contextoInicial || ""));
  const [escolhidos, setEscolhidos] = useState<string[] | null>(null);
  const [modelos, setModelos] = useState<Record<string, string>>({});
  const [rodadas, setRodadas] = useState("4");
  const [modo, setModo] = useState<ModoDoConselho>("padrao");
  const [criterios, setCriterios] = useState<string[]>([]);
  const [preset, setPreset] = useState<PresetDoConselho["id"] | null>(null);
  const [pautaTexto, setPautaTexto] = useState("");
  const [anexos, setAnexos] = useState<string[]>([]);
  const [nomeDoElenco, setNomeDoElenco] = useState("");
  const [daAgencia, setDaAgencia] = useState(false);
  const [salvandoElenco, setSalvandoElenco] = useState(false);
  const [salvarAberto, setSalvarAberto] = useState(false);
  // "Convocar de novo" de uma sessão que parou no teto: o teto começa acima do que ela gastou.
  const tetoDaBase = useRef<number | null>(base && base.status === "teto" && base.custo_usd > 0 ? centavosParaCima(base.custo_usd * 1.5) : null);
  const [teto, setTeto] = useState<string>(() => (tetoDaBase.current !== null ? String(tetoDaBase.current) : ""));
  const [tetoMexido, setTetoMexido] = useState(tetoDaBase.current !== null);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [ajRecolhido, setAjRecolhido] = useRecolhido(`conselho:ajustes:${clientId}`, true);
  const [porEspecialistaRecolhido, setPorEspecialistaRecolhido] = useRecolhido(`conselho:modelos:${clientId}`, true);
  const [focoEmAjustes, setFocoEmAjustes] = useState<CampoDosAjustes | null>(null);
  const perguntaRef = useRef<HTMLTextAreaElement>(null);
  const temaRef = useRef<HTMLInputElement>(null);
  const tetoRef = useRef<HTMLInputElement>(null);
  const modeloRef = useRef<HTMLDivElement>(null);

  const cat = catalogoDoConselho.data;
  const min = cat ? cat.limites.min_especialistas : 2;
  const max = cat ? cat.limites.max_especialistas : 6;

  const aplicarPreset = (p: PresetDoConselho, reescreverTema: boolean) => {
    const marcado = preset && cat && cat.presets ? cat.presets.find((x) => x.id === preset) : null;
    setPreset(p.id);
    setEscolhidos(p.especialistas.slice(0, max));
    setCriterios(p.criterios);
    setModo(p.modo);
    setRodadas(String(p.rodadas));
    // A pergunta troca junto só quando está vazia ou ainda é, sem edição, a do preset marcado.
    const atual = pergunta.trim();
    if (!atual || (marcado && atual === marcado.pergunta.trim())) setPergunta(p.pergunta);
    if (reescreverTema && (!tema.trim() || tema === temaInicial)) setTema(`${p.tema}${temaInicial ? `: ${temaInicial}` : ""}`.slice(0, 300));
  };

  // Semente, uma vez, quando o catálogo chega (antes da primeira estimativa, para não pedir duas):
  // a sessão do "Convocar de novo" ou o preset da mesa de origem.
  const [semeado, setSemeado] = useState(false);
  const [presetAutomatico, setPresetAutomatico] = useState<string | null>(null);
  if (cat && !semeado) {
    setSemeado(true);
    if (base) {
      const permitidos = cat.especialistas.map((e) => e.id);
      const ids = base.especialistas.map((m) => m.id).filter((id) => permitidos.indexOf(id) >= 0).slice(0, cat.limites.max_especialistas);
      const ms: Record<string, string> = {};
      base.especialistas.forEach((m) => {
        if (ids.indexOf(m.id) >= 0 && m.modelo_id) ms[m.id] = m.modelo_id;
      });
      setEscolhidos(ids);
      setModelos(ms);
      setModo(base.modo === "rapido" || base.modo === "profundo" ? base.modo : "padrao");
      setRodadas(String(Math.max(2, Math.min(4, Math.round(Number(base.rodadas) || 4)))));
      setCriterios(Array.isArray(base.criterios) ? base.criterios : []);
      // O pedido é explícito: a pergunta da sessão passa por cima do rascunho.
      if (base.pergunta) setPergunta(base.pergunta);
      if (base.pauta) {
        setPautaTexto((base.pauta.itens || []).join("\n"));
        setAnexos((base.pauta.anexos || []).map((a) => a.file_id).filter(Boolean).slice(0, MAX_ANEXOS));
      }
    } else {
      const p = presetDaOrigem(cat, origem);
      const guardada = pergunta.trim();
      if (p && (!guardada || guardada === p.pergunta.trim())) {
        aplicarPreset(p, false);
        setPresetAutomatico(p.id);
      }
    }
  }

  // Mesa sem preset: o foco já vai para a pergunta (só com mouse; no celular abriria o teclado por cima).
  const focouNaAbertura = useRef(false);
  useEffect(() => {
    if (!semeado || focouNaAbertura.current) return;
    focouNaAbertura.current = true;
    if (presetAutomatico || base || !temMouse()) return;
    const el = perguntaRef.current;
    if (!el) return;
    try {
      el.focus({ preventScroll: true });
    } catch {
      el.focus();
    }
  }, [semeado, presetAutomatico, base]);

  // O elenco sugerido pela origem até a pessoa mexer.
  const ids = useMemo(() => escolhidos || (cat ? cat.padrao : []), [escolhidos, cat]);
  // Papel "conselho" do catálogo (frente BASE); o servidor manda o mesmo padrão.
  const padraoNaTela = modeloDoPapel(catalogoDeModelos.data || [], "conselho");
  const padraoDoModelo = (cat && cat.modelo_padrao) || (padraoNaTela ? padraoNaTela.id : "");
  const modelosEfetivos = useMemo(() => {
    const r: Record<string, string> = {};
    ids.forEach((id) => {
      const escolhido = modelos[id] ? modeloDoPapel(catalogoDeModelos.data || [], "conselho", modelos[id]) : null;
      r[id] = (escolhido && escolhido.id === modelos[id] ? modelos[id] : "") || padraoDoModelo;
    });
    return r;
  }, [ids, modelos, padraoDoModelo, catalogoDeModelos.data]);
  const todosIguais = ids.length > 0 && ids.every((id) => modelosEfetivos[id] === modelosEfetivos[ids[0]]);
  const rodadasEfetivas = rodadasDoModo(modo, Number(rodadas));
  const todosComModelo = ids.every((id) => !!modelosEfetivos[id]);

  const podeEstimar = !!cat && semeado && ids.length >= min && ids.length <= max && todosComModelo;
  // Respiro de 300 ms: três cliques seguidos numa pílula viram uma chamada só. A primeira vai na hora
  // (enquanto o respiro não tem valor, vale o primeiro pedido pronto, não cada clique).
  const pedidoAgora = podeEstimar ? JSON.stringify({ e: ids, m: modelosEfetivos, r: rodadasEfetivas, o: modo }) : "";
  const pedidoAtrasado = useAtraso(pedidoAgora, 300);
  const primeiroPedido = useRef("");
  if (!pedidoAgora) primeiroPedido.current = "";
  else if (!primeiroPedido.current) primeiroPedido.current = pedidoAgora;
  const pedidoUsado = pedidoAtrasado || primeiroPedido.current;
  const estimativa = useQuery({
    queryKey: ["conselho", "estimar", clientId, origem, pedidoUsado],
    enabled: !!pedidoUsado,
    queryFn: () => {
      const p = JSON.parse(pedidoUsado) as { e: string[]; m: Record<string, string>; r: number; o: ModoDoConselho };
      return estimarConselho({ clientId, origem, especialistas: p.e, modelos: p.m, rodadas: p.r, modo: p.o });
    },
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });
  // Defasada: o valor na tela ainda não é o do elenco escolhido (fica à vista, em cinza, mas não convoca).
  const defasada = pedidoUsado !== pedidoAgora || estimativa.isPlaceholderData || estimativa.isFetching;
  const fresca = podeEstimar && !defasada && !estimativa.isError && estimativa.data ? estimativa.data : null;
  const totalFresco = fresca ? fresca.estimativa.total_usd : null;
  const totalAnterior = estimativa.data ? estimativa.data.estimativa.total_usd : null;
  const sugeridoFresco = fresca ? fresca.teto_sugerido_usd : null;

  // Teto sugerido acompanha a estimativa fresca até a pessoa digitar o dela.
  useEffect(() => {
    if (sugeridoFresco === null) return;
    if (!tetoMexido) setTeto(String(sugeridoFresco));
    else if (tetoDaBase.current !== null) {
      setTeto(String(Math.max(sugeridoFresco, tetoDaBase.current)));
      tetoDaBase.current = null;
    }
  }, [sugeridoFresco, tetoMexido]);

  // "Ajustar" do rodapé: abre Ajustes e põe o foco no campo que trava.
  useEffect(() => {
    if (!focoEmAjustes || ajRecolhido) return;
    const el: HTMLElement | null =
      focoEmAjustes === "tema" ? temaRef.current : focoEmAjustes === "teto" ? tetoRef.current : modeloRef.current ? (modeloRef.current.querySelector("button, select, input") as HTMLElement | null) : null;
    setFocoEmAjustes(null);
    if (el) el.focus();
  }, [focoEmAjustes, ajRecolhido]);
  const ajustar = (c: CampoDosAjustes) => {
    setAjRecolhido(false);
    setFocoEmAjustes(c);
  };

  const alternar = (id: string) => {
    const atual = ids.slice();
    const i = atual.indexOf(id);
    if (i >= 0) atual.splice(i, 1);
    else if (atual.length < max) atual.push(id);
    setEscolhidos(atual);
  };

  const usarElenco = (e: ElencoSalvo) => {
    setPreset(e.preset);
    setEscolhidos(e.especialistas.slice(0, max));
    setModelos(e.modelos || {});
    setCriterios(e.criterios || []);
    setModo(e.modo);
    setRodadas(String(e.rodadas));
  };

  const podeSalvarElenco = nomeDoElenco.trim().length >= 2 && ids.length >= min && !salvandoElenco;
  const guardarElenco = async () => {
    if (!podeSalvarElenco) return;
    setSalvandoElenco(true);
    try {
      await salvarElenco({ clientId, nome: nomeDoElenco.trim(), especialistas: ids, modelos: modelosEfetivos, criterios, rodadas: rodadasEfetivas, modo, preset, daAgencia });
      toast.success(daAgencia ? "Elenco salvo para a agência toda." : "Elenco salvo para este cliente.");
      setNomeDoElenco("");
      setDaAgencia(false);
      setSalvarAberto(false);
      void qc.invalidateQueries({ queryKey: ["conselho", "elencos", clientId] });
    } catch (e) {
      toast.error(textoDoErro(e, "Não foi possível salvar o elenco."));
    } finally {
      setSalvandoElenco(false);
    }
  };

  const tetoNumero = Number(String(teto).replace(",", "."));
  const tetoValido = String(teto).trim() !== "" && isFinite(tetoNumero) && tetoNumero > 0;
  const tetoBaixo = totalFresco !== null && tetoValido && tetoNumero < totalFresco;
  const pronto = podeEstimar && tema.trim().length >= 3 && pergunta.trim().length >= 3 && totalFresco !== null && tetoValido && !tetoBaixo;
  const itensDaPauta = pautaTexto.split("\n").map((x) => x.trim()).filter((x) => x.length >= 2).slice(0, 8);

  const convocar = async () => {
    if (!pronto || enviando) return;
    setEnviando(true);
    setErro(null);
    try {
      const r = await convocarConselho({
        clientId,
        origem,
        referencia: base && base.origem === origem && base.referencia ? base.referencia : referencia || null,
        tema: tema.trim(),
        pergunta: pergunta.trim(),
        contexto: contexto.trim(),
        especialistas: ids,
        modelos: modelosEfetivos,
        rodadas: rodadasEfetivas,
        teto_usd: tetoNumero,
        modo,
        criterios,
        pauta: itensDaPauta.length || anexos.length ? { itens: itensDaPauta, anexos } : null,
      });
      setPergunta("");
      void sessoes.refetch();
      onAbrir(r.sessao.id);
    } catch (e) {
      // O pedido fica no campo: nada se perde.
      setErro(textoDoErro(e));
    } finally {
      setEnviando(false);
    }
  };

  // Busca simples nas sessões anteriores (tema e pergunta), sem ir ao banco.
  const [buscaDasSessoes, setBuscaDasSessoes] = useState("");

  if (catalogoDoConselho.isLoading) return <Carregando forma="aba" rotulo="Abrindo o conselho" />;
  if (catalogoDoConselho.isError || !cat) {
    return <EstadoDeErro titulo="O conselho não abriu." descricao={textoDoErro(catalogoDoConselho.error)} acao={<button type="button" className={botao.secundario} onClick={() => void catalogoDoConselho.refetch()}>Tentar de novo</button>} />;
  }

  const anteriores = (sessoes.data || []) as SessaoDoConselho[];
  const emDebate = anteriores.filter((s) => sessaoAtiva(s));
  const termoDasSessoes = buscaDasSessoes.trim().toLowerCase();
  const sessoesVisiveis = termoDasSessoes
    ? anteriores.filter((s) => `${s.tema || ""} ${s.pergunta || ""}`.toLowerCase().indexOf(termoDasSessoes) >= 0)
    : anteriores;
  const listaDeElencos = elencos.data || [];

  // Rodapé: o que falta, e o custo junto (quando há).
  const custoCurto = totalFresco !== null ? `custo estimado ${usd(totalFresco)}` : podeEstimar && defasada && totalAnterior !== null ? `~${usd(totalAnterior)} recalculando` : "";
  let motivo: { texto: string; campo: CampoDosAjustes | null; comCusto: boolean } | null = null;
  if (ids.length < min) motivo = { texto: `Escolha pelo menos ${min} especialistas`, campo: null, comCusto: false };
  else if (pergunta.trim().length < 3) motivo = { texto: "Escreva a pergunta", campo: null, comCusto: true };
  else if (tema.trim().length < 3) motivo = { texto: "Escreva o tema", campo: "tema", comCusto: true };
  else if (!todosComModelo) motivo = { texto: "Escolha o modelo", campo: "modelo", comCusto: false };
  // Teto vazio só é motivo quando a pessoa mexeu nele ou a estimativa já chegou (senão é o custo que falta).
  else if (!tetoValido && (tetoMexido || totalFresco !== null)) motivo = { texto: "Informe o teto", campo: "teto", comCusto: true };
  else if (tetoBaixo) motivo = { texto: `Teto abaixo do custo estimado (${usd(totalFresco)})`, campo: "teto", comCusto: false };
  const erroDaEstimativa = podeEstimar && estimativa.isError && !estimativa.isFetching;
  const linhaDoRodape = motivo
    ? `${motivo.texto}${motivo.comCusto && custoCurto ? ` · ${custoCurto}` : ""}`
    : erroDaEstimativa
      ? `Custo indisponível: ${textoDoErro(estimativa.error)}`
      : totalFresco !== null
        ? `Custo estimado ${usd(totalFresco)}`
        : custoCurto || (podeEstimar ? "Calculando o custo..." : "");

  const modelosDistintos = ids.map((id) => modelosEfetivos[id]).filter((m, i, l) => !!m && l.indexOf(m) === i).length;
  const resumoDosAjustes = `${ROTULO_DO_MODO[modo]} · ${rodadasEfetivas} rodadas · ${modelosDistintos === 1 ? "1 modelo" : `${modelosDistintos} modelos`} · teto ${tetoValido ? usd(tetoNumero) : "a definir"}`;
  const descricaoDaPauta = itensDaPauta.length || anexos.length ? `${plural(itensDaPauta.length, "item", "itens")} · ${plural(anexos.length, "anexo", "anexos")}` : "opcional";

  return (
    <div className="min-w-0 space-y-6" data-convocar-conselho="">
      {emDebate.length > 0 && (
        <div className="flex min-w-0 items-center" data-em-debate="">
          <p className="min-w-0 flex-1 truncate text-[13px] text-foreground">
            <span className="font-medium">Em debate: </span>
            {emDebate[0].tema}
            {emDebate.length > 1 && <span className="text-muted-foreground"> +{emDebate.length - 1}</span>}
          </p>
          <button type="button" className={juntar(botao.secundario, "ml-3 h-8")} onClick={() => onAbrir(emDebate[0].id)}>
            Abrir
          </button>
        </div>
      )}

      {anteriores.length > 0 && (
        <Secao titulo="Sessões" descricao={`${anteriores.length} deste cliente`} recolher={`conselho:sessoes:${clientId}`} recolhidaDeInicio>
          {anteriores.length > 3 && (
            <input
              className={juntar(campo, "mb-2 h-8 text-[12px]")}
              value={buscaDasSessoes}
              onChange={(e) => setBuscaDasSessoes(e.target.value)}
              placeholder="Buscar nas sessões"
              aria-label="Buscar nas sessões anteriores do conselho"
              data-busca-das-sessoes=""
            />
          )}
          {termoDasSessoes && !sessoesVisiveis.length && <p className={texto.auxiliar}>Nenhuma sessão com esse termo.</p>}
          <ul className={juntar(lista.aberta, lista.divisoria)}>
            {sessoesVisiveis.map((s) => (
              <li key={s.id}>
                <button type="button" className={juntar(lista.linha, "w-full text-left")} onClick={() => onAbrir(s.id)} data-sessao-anterior={s.id}>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium text-foreground">{s.tema}</span>
                    <span className="block truncate text-[12px] text-muted-foreground">
                      {dataEHora(s.criado_em)} · {NOME_DO_STATUS[s.status]}
                      {s.resultado ? ` · ${NOME_DO_NIVEL[s.resultado.nivel]}` : ""}
                      {s.decisao && !s.decisao.desfeita_em ? " · decidida" : ""}
                    </span>
                  </span>
                  <span className={juntar(texto.auxiliar, "ml-3 shrink-0 tabular-nums")}>{usd(s.custo_usd)}</span>
                </button>
              </li>
            ))}
          </ul>
        </Secao>
      )}

      <Secao
        titulo="Convocar"
        recolher={false}
        ajuda="Cada especialista responde sozinho, depois critica os outros com nota de 1 a 10, revisa e o Jev mede o consenso. Rápido: 1 rodada de propostas e a síntese do moderador (barato). Profundo: as 4 rodadas, com mais espaço. O número de rodadas é fixo e o custo nunca passa do teto."
      >
        <div className="min-w-0 space-y-4">
          <div className="min-w-0">
            {cat.presets && cat.presets.length > 0 && <span className={texto.rotulo}>Começar por um tema</span>}
            <div className="-m-1 mt-1 flex flex-wrap items-center" role="group" aria-label="Presets do conselho">
              {(cat.presets || []).map((p) => (
                <button key={p.id} type="button" aria-pressed={preset === p.id} onClick={() => aplicarPreset(p, true)} className={juntar(botao.barra, "m-1 border border-border", preset === p.id && "border-primary bg-primary/10 text-foreground")} data-preset={p.id}>
                  {p.nome}
                </button>
              ))}
              {listaDeElencos.length > 0 && (
                <select className={juntar(campo, "m-1 h-8 w-auto")} value="" onChange={(e) => { const x = listaDeElencos.find((l) => l.id === e.target.value); if (x) usarElenco(x); }} aria-label="Elenco salvo">
                  <option value="">Elenco salvo...</option>
                  {listaDeElencos.map((l) => <option key={l.id} value={l.id}>{l.nome}{l.client_id ? "" : " (agência)"}</option>)}
                </select>
              )}
              <Popover open={salvarAberto} onOpenChange={setSalvarAberto}>
                <PopoverTrigger asChild>
                  <button type="button" className={juntar(botao.icone, "m-1")} aria-label="Salvar elenco" title="Salvar elenco">
                    <Save className="h-4 w-4" aria-hidden="true" />
                  </button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-[300px] max-w-[calc(100vw-32px)] p-3" data-salvar-elenco="">
                  <div className="space-y-3">
                    <input
                      className={campo}
                      value={nomeDoElenco}
                      maxLength={80}
                      onChange={(e) => setNomeDoElenco(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          void guardarElenco();
                        }
                      }}
                      placeholder="Nome do elenco"
                      aria-label="Nome do elenco para salvar"
                    />
                    <label className="flex min-w-0 items-center text-[12px] text-muted-foreground">
                      <input type="checkbox" className="mr-1.5 h-4 w-4 accent-primary" checked={daAgencia} onChange={(e) => setDaAgencia(e.target.checked)} />
                      Para a agência toda
                    </label>
                    <div className="flex justify-end">
                      <button type="button" className={juntar(botao.primario, "h-8")} disabled={!podeSalvarElenco} onClick={() => void guardarElenco()}>
                        {salvandoElenco ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" /> : <Save className="mr-1.5 h-4 w-4" aria-hidden="true" />}
                        Salvar
                      </button>
                    </div>
                  </div>
                </PopoverContent>
              </Popover>
            </div>
          </div>

          <CampoDeFormulario rotulo="Pergunta">
            <textarea
              ref={perguntaRef}
              className={campoTexto}
              value={pergunta}
              maxLength={4000}
              rows={3}
              placeholder="O que o conselho precisa decidir?"
              onChange={(e) => setPergunta(e.target.value)}
              aria-label="Pergunta"
            />
          </CampoDeFormulario>

          <div className="min-w-0">
            <div className="flex items-center justify-between">
              <span className={texto.rotulo}>Especialistas</span>
              <span className={texto.auxiliar}>{ids.length} de {max}</span>
            </div>
            <div className="mt-2 grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-3" role="group" aria-label="Quem entra no conselho">
              {cat.especialistas.map((e) => {
                const dentro = ids.indexOf(e.id) >= 0;
                return (
                  <button
                    key={e.id}
                    type="button"
                    aria-pressed={dentro}
                    title={`${e.visao}. Critério: ${e.criterio}.`}
                    onClick={() => alternar(e.id)}
                    disabled={!dentro && ids.length >= max}
                    className={juntar(
                      "toque-compacto min-w-0 rounded-md border px-3 py-2 text-left transition-colors disabled:opacity-50",
                      dentro ? "border-primary bg-primary/10" : "border-border hover:bg-muted",
                    )}
                    data-especialista={e.id}
                  >
                    <span className="block truncate text-[13px] font-medium text-foreground">{e.nome}</span>
                    <span className="block truncate text-[12px] text-muted-foreground">{e.area}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="min-w-0" data-ajustes-do-conselho="">
            <CabecalhoDeSecao
              nivel={3}
              titulo="Ajustes"
              className={ajRecolhido ? "" : "mb-3"}
              recolher={{ recolhido: ajRecolhido, onAlternar: () => setAjRecolhido(!ajRecolhido), resumo: resumoDosAjustes }}
            />
            {!ajRecolhido && (
              <div className="min-w-0 space-y-4">
                <GrupoDeCampos colunas={1}>
                  <CampoDeFormulario rotulo="Tema">
                    <input ref={temaRef} className={campo} value={tema} maxLength={300} onChange={(e) => setTema(e.target.value)} aria-label="Tema" />
                  </CampoDeFormulario>
                  <CampoDeFormulario rotulo="Contexto da mesa" ajuda="O que a mesa já mostrou. O retrato do cliente (cérebro, dossiê e decisões anteriores) entra sozinho.">
                    <textarea className={campoTexto} value={contexto} maxLength={8000} rows={2} onChange={(e) => setContexto(e.target.value)} aria-label="Contexto da mesa" />
                  </CampoDeFormulario>
                </GrupoDeCampos>

                {ids.length > 0 && (
                  <div className="min-w-0 space-y-2">
                    <div ref={modeloRef} className="sm:max-w-[360px]">
                      <SeletorDeModelo
                        catalogo={catalogoDeModelos.data || []}
                        tipo="texto"
                        rotulo="Todos com o mesmo modelo"
                        valor={todosIguais ? modelosEfetivos[ids[0]] || "" : ""}
                        onChange={(m) => {
                          const r: Record<string, string> = {};
                          ids.forEach((id) => (r[id] = m));
                          setModelos(r);
                        }}
                      />
                    </div>
                    <TituloRecolhivel
                      titulo="Um modelo por especialista"
                      recolhido={porEspecialistaRecolhido}
                      onAlternar={() => setPorEspecialistaRecolhido(!porEspecialistaRecolhido)}
                      resumo={todosIguais ? "todos com o mesmo" : "modelos diferentes"}
                    />
                    {!porEspecialistaRecolhido && (
                      <GrupoDeCampos colunas={3}>
                        {ids.map((id) => {
                          const e = cat.especialistas.find((x) => x.id === id);
                          return (
                            <SeletorDeModelo
                              key={id}
                              catalogo={catalogoDeModelos.data || []}
                              tipo="texto"
                              rotulo={e ? e.nome : id}
                              valor={modelosEfetivos[id] || ""}
                              onChange={(m) => setModelos((x) => ({ ...x, [id]: m }))}
                            />
                          );
                        })}
                      </GrupoDeCampos>
                    )}
                  </div>
                )}

                <div className="grid min-w-0 grid-cols-1 items-end gap-4 sm:grid-cols-3">
                  <CampoDeFormulario rotulo="Modo" ajuda="Rápido: 1 rodada de propostas e a síntese do moderador, respostas curtas. Padrão: você escolhe as rodadas. Profundo: as 4 rodadas, com mais espaço e raciocínio.">
                    <SeletorCompacto
                      rotulo="Modo"
                      valor={modo}
                      onEscolher={(v) => setModo(v as ModoDoConselho)}
                      opcoes={(["rapido", "padrao", "profundo"] as ModoDoConselho[]).map((m) => ({ valor: m, rotulo: ROTULO_DO_MODO[m] }))}
                    />
                  </CampoDeFormulario>
                  {modo === "padrao" && (
                    <CampoDeFormulario rotulo="Rodadas" ajuda="2: propostas e consolidação. 3: com crítica cruzada. 4: com crítica e revisão.">
                      <SeletorCompacto
                        rotulo="Rodadas"
                        valor={rodadas}
                        onEscolher={setRodadas}
                        opcoes={[
                          { valor: "2", rotulo: "2" },
                          { valor: "3", rotulo: "3" },
                          { valor: "4", rotulo: "4" },
                        ]}
                      />
                    </CampoDeFormulario>
                  )}
                  <CampoDeFormulario rotulo="Teto (US$)" erro={tetoBaixo ? `Abaixo do custo estimado (${usd(totalFresco)}).` : undefined}>
                    <input
                      ref={tetoRef}
                      className={campo}
                      inputMode="decimal"
                      value={teto}
                      onChange={(e) => {
                        tetoDaBase.current = null;
                        setTetoMexido(true);
                        setTeto(e.target.value);
                      }}
                      aria-label="Teto de custo da sessão em dólares"
                    />
                  </CampoDeFormulario>
                </div>
              </div>
            )}
          </div>

          <Secao titulo="Pauta e anexos" nivel={3} descricao={descricaoDaPauta} recolher={`conselho:pauta:${clientId}`} recolhidaDeInicio>
            <div className="min-w-0 space-y-3">
              <CampoDeFormulario rotulo="Itens da pauta" apoio="Um por linha. O conselho precisa cobrir cada um.">
                <textarea className={campoTexto} value={pautaTexto} rows={3} maxLength={1600} onChange={(e) => setPautaTexto(e.target.value)} aria-label="Itens da pauta" />
              </CampoDeFormulario>
              {/* Só monta (e só lê os arquivos) com a pauta aberta: a Secao não monta o corpo recolhido. */}
              <AnexosDaPauta clientId={clientId} anexos={anexos} onAnexos={setAnexos} />
            </div>
          </Secao>

          {erro && <p className="text-[13px] text-destructive" role="alert">{erro}</p>}

          <div className="flex min-w-0 flex-wrap items-center justify-end">
            <span className={juntar(texto.auxiliar, "mr-3")} data-estimativa-do-conselho="">
              {linhaDoRodape}
            </span>
            {motivo && motivo.campo && (
              <button type="button" className={juntar(botao.discreto, "mr-2 h-8")} onClick={() => ajustar(motivo!.campo as CampoDosAjustes)} data-ajustar="">
                Ajustar
              </button>
            )}
            {!motivo && erroDaEstimativa && (
              <button type="button" className={juntar(botao.discreto, "mr-2 h-8")} onClick={() => void estimativa.refetch()}>
                Tentar de novo
              </button>
            )}
            <button type="button" className={botao.primario} disabled={!pronto || enviando} onClick={() => void convocar()}>
              {enviando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : <Users className="mr-2 h-4 w-4" aria-hidden="true" />}
              Convocar o conselho
            </button>
          </div>
        </div>
      </Secao>
    </div>
  );
}

/**
 * Anexos da pauta: a lista de arquivos do cliente só é lida com a pauta
 * aberta (o componente nasce com o corpo da seção). Os marcados moram no pai
 * e não se perdem ao recolher.
 */
function AnexosDaPauta({ clientId, anexos, onAnexos }: { clientId: string; anexos: string[]; onAnexos: (f: (l: string[]) => string[]) => void }) {
  const [busca, setBusca] = useState("");
  const arquivos = useQuery({
    queryKey: ["conselho", "arquivos-da-pauta", clientId],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<ArquivoDaPauta[]> => {
      const { data, error } = await supabase.from("files").select("id, file_name, folder, created_at").eq("client_id", clientId).is("archived_at" as any, null).order("created_at", { ascending: false }).limit(60);
      if (error) throw error;
      return (data as unknown as ArquivoDaPauta[]) || [];
    },
  });
  const filtrados = (arquivos.data || []).filter((a) => !busca.trim() || a.file_name.toLowerCase().indexOf(busca.trim().toLowerCase()) >= 0).slice(0, 12);
  return (
    <div className="min-w-0">
      <div className="flex min-w-0 items-center justify-between">
        <span className={texto.rotulo}>Anexos do cliente</span>
        <span className={texto.auxiliar}>{anexos.length} de {MAX_ANEXOS}</span>
      </div>
      <input className={juntar(campo, "mt-1")} value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar arquivo" aria-label="Buscar arquivo para a pauta" />
      {arquivos.isLoading ? (
        <Carregando forma="lista" linhas={3} rotulo="Carregando os arquivos" className="mt-2" />
      ) : arquivos.isError ? (
        <div className="mt-1 flex min-w-0 items-center">
          <p className={juntar(texto.auxiliar, "min-w-0 flex-1 text-destructive")}>{textoDoErro(arquivos.error, "Os arquivos não abriram.")}</p>
          <button type="button" className={juntar(botao.discreto, "ml-2 h-8")} onClick={() => void arquivos.refetch()}>
            Tentar de novo
          </button>
        </div>
      ) : (
        <ul className={juntar(lista.aberta, lista.divisoria, "mt-1")}>
          {filtrados.map((a) => {
            const marcado = anexos.indexOf(a.id) >= 0;
            return (
              <li key={a.id} className={juntar(lista.linha, "py-1.5")}>
                <input type="checkbox" id={`pauta-${a.id}`} className="mr-3 h-4 w-4 shrink-0 accent-primary" checked={marcado} disabled={!marcado && anexos.length >= MAX_ANEXOS} onChange={() => onAnexos((l) => (marcado ? l.filter((x) => x !== a.id) : l.concat(a.id)))} />
                <label htmlFor={`pauta-${a.id}`} className="flex min-w-0 flex-1 cursor-pointer items-center">
                  <Paperclip className="mr-1.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span className="min-w-0 truncate text-[13px] text-foreground">{a.file_name}</span>
                </label>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
