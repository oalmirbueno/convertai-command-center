import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Download, ImageOff, Loader2, Send, SlidersHorizontal, Sparkles, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { botao, CampoDeBusca, Carregando, EstadoDeErro, EstadoVazio, Etapas, juntar, Secao, texto, useEstadoDaTela } from "@/components/sistema";
import { type KitDoContexto } from "@/components/mesa/contextoDoCliente";
import { useKitDaMarca } from "@/components/mesa/kitDaMesa";
import { textoDoErro } from "@/lib/mesa/api";
import { buscarMockups, CATEGORIAS, candidatosDaSugestao, filtrarPorFonte, rotuloDaCategoria, type FiltroDeFonte, type MockupDoCatalogo, type TexturaDoCatalogo } from "@/lib/mockups/catalogo";
import { arquivarAplicacao, carregarImagem, copiaParaBrandbook, enviarParaArquivos, guardarNoAcervo, lerAplicacoes, lerCatalogoDeMockups, lerTexturas, liberarCamadas, salvarAplicacao, sugerirMockups, urlAssinada, type SugestaoDoJev } from "@/lib/mockups/api";
import { ajustesDoItem, AJUSTES_PADRAO, chaveDosAjustes, normalizarAjustes, soOQueMuda, type AjustesDoMockup, type AjustesProprios, type TipoDeFundoDaCena } from "@/lib/mockups/ajustes";
import { baixarZip, nomeDeArquivo, salvarArquivo } from "@/lib/mockups/baixar";
import { rotuloDoTipoDeCena } from "@/lib/mockups/cenas";
import type { Ponto } from "@/lib/mockups/homografia";
import { ESCALA_POR_PAPEL, type EscolhasDoDesign, type LogoCarregada } from "@/lib/mockups/designDoSlot";
import { fundoDosAjustes, ROTULOS_DO_FUNDO } from "@/lib/mockups/fundoDaCena";
import { carregarLogos, comporCena, paraBlob, renderizarMockup } from "@/lib/mockups/renderizar";
import { useFontesGoogle } from "@/lib/identidade/fontesGoogle";
import AjustesDoMockupJanela, { Faixa } from "./AjustesDoMockup";
import EditorDeCena from "./EditorDeCena";

/**
 * Estúdio de mockups da Mesa Identidade Visual (frente MCK; rodada 2 em 30/09).
 *
 * Sequência: categorias (PSDs da agência e mockups feitos com IA) -> sugestão do Jev para o
 * segmento -> aplicar a marca em lote (com ajustes por mockup: cor, variações, posição, escala,
 * giro, versão da logo, padrão, luz e fundo da cena) -> cenas sob medida com IA -> enviar para
 * Arquivos e aprovação, para a apresentação da Identidade e para o acervo de imagens.
 * A composição é no navegador (WebGL ou reserva em canvas); a logo entra pelo código.
 */

type Etapa = "categorias" | "sugestao" | "aplicar" | "cenas" | "enviar";
const ETAPAS: Etapa[] = ["categorias", "sugestao", "aplicar", "cenas", "enviar"];

interface Pronto {
  url: string;
  chave: string;
}

interface Escolhido {
  /** id do mockup (catálogo) ou da aplicação (cena). */
  id: string;
  nome: string;
  origem: "catalogo" | "cena";
  aplicacaoId?: string | null;
  imagem?: Blob | null;
  /** Cena guardada: refeita no envio a partir da imagem e dos cantos. */
  cena?: { caminho: string; cantos: Ponto[]; luz: number } | null;
  /** Vai para a apresentação da Identidade (e o brandbook, que lê a mesma lista). */
  noBrandbook: boolean;
  /** Vai também para o acervo de imagens do cliente (as outras mesas usam). */
  noAcervo: boolean;
  enviado?: boolean;
}

const COR_PADRAO = "#1a1a1a";
const FILTROS_DE_FONTE: Array<{ id: FiltroDeFonte; rotulo: string }> = [
  { id: "todos", rotulo: "Todos" },
  { id: "psd", rotulo: "Pacotes da agência" },
  { id: "ia", rotulo: "Feitos com IA" },
];

function coresDoKit(kit: KitDoContexto | null | undefined): string[] {
  const paleta = kit && Array.isArray(kit.paleta) ? kit.paleta : [];
  const hex = paleta.map((c) => String((c && c.hex) || "")).filter((h) => /^#?[0-9a-fA-F]{6}$/.test(h)).map((h) => (h.charAt(0) === "#" ? h : `#${h}`));
  // O verso, o timbrado e o envelope pedem uma segunda cor: sem ela no kit, branco.
  if (!hex.length) return [COR_PADRAO, "#ffffff"];
  return hex.length === 1 ? hex.concat(["#ffffff"]) : hex;
}

/** Mockup que entra no brandbook: título e caminho no bucket mesa (o formato de idv_projetos.dados.mockups). */
export interface MockupParaBrandbook {
  titulo: string;
  imagem: string;
}

export default function EstudioDeMockups({
  clientId,
  marcaId: marcaDada,
  onEnviados,
  coresDaMarca,
  logosDaMarca,
  tipografia,
  etapaInicial = "categorias",
  chaveDaMemoria,
}: {
  clientId: string;
  marcaId?: string | null;
  /** Os enviados marcados "Apresentação" (a Etapa Mockups da Mesa Identidade guarda em dados.mockups, que a apresentação e o brandbook leem). */
  onEnviados?: (itens: MockupParaBrandbook[]) => void;
  /** IDV2: as cores do sistema do projeto (sem elas, as do kit da marca). */
  coresDaMarca?: string[] | null;
  /** IDV2: as logos do projeto (prévias PNG no bucket mesa); sem elas, as do kit. */
  logosDaMarca?: Array<{ id: string; path: string }> | null;
  /** IDV2: a família do título e a linha da assinatura (slogan ou nome) para a peça de arte. */
  tipografia?: { familia: string; texto: string } | null;
  /** IDV2: onde o estúdio abre na primeira vez (depois lembra onde parou). */
  etapaInicial?: Etapa;
  /** IDV2: memória por projeto (o estúdio lembra etapa e escolhas de cada projeto). */
  chaveDaMemoria?: string;
}) {
  const marcaId: string | null = marcaDada || null;
  const qc = useQueryClient();
  const chave = chaveDaMemoria || `mesa-identidade:mockups:${clientId}:${marcaId || "cliente"}`;
  const [etapa, setEtapa] = useEstadoDaTela<Etapa>(`${chave}:etapa`, etapaInicial, { validar: (v) => ETAPAS.indexOf(v as Etapa) >= 0 });
  const [categorias, setCategorias] = useEstadoDaTela<string[]>(`${chave}:categorias`, ["papelaria", "cartao", "dispositivo", "caneca"], { validar: Array.isArray });
  const [aplicar, setAplicar] = useEstadoDaTela<string[]>(`${chave}:aplicar`, [], { validar: Array.isArray });
  const [ajustesBrutos, setAjustesBrutos] = useEstadoDaTela<Partial<AjustesDoMockup>>(`${chave}:ajustes`, AJUSTES_PADRAO, { validar: (v) => !!v && typeof v === "object" });
  const [proprios, setProprios] = useEstadoDaTela<Record<string, AjustesProprios>>(`${chave}:por-mockup`, {}, { validar: (v) => !!v && typeof v === "object" && !Array.isArray(v) });
  const [fonte, setFonte] = useEstadoDaTela<FiltroDeFonte>(`${chave}:fonte`, "todos", { validar: (v) => v === "todos" || v === "psd" || v === "ia" });
  const [busca, setBusca] = useState("");
  const [maisAjustes, setMaisAjustes] = useState(false);
  const [escolhidos, setEscolhidos] = useState<Escolhido[]>([]);
  const [sugestoes, setSugestoes] = useState<SugestaoDoJev[] | null>(null);
  const [avisoJev, setAvisoJev] = useState<string | null>(null);
  const [sugerindo, setSugerindo] = useState(false);
  const [prontos, setProntos] = useState<Record<string, Pronto>>({});
  const [renderizando, setRenderizando] = useState(false);
  const [aberto, setAberto] = useState<MockupDoCatalogo | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [baixando, setBaixando] = useState<string | null>(null);

  const geral = useMemo(() => normalizarAjustes(ajustesBrutos), [ajustesBrutos]);
  const mudarGeral = useCallback((parte: Partial<AjustesDoMockup>) => setAjustesBrutos((a) => ({ ...normalizarAjustes(a), ...parte })), [setAjustesBrutos]);

  const catalogo = useQuery({ queryKey: ["mockups", "catalogo"], queryFn: lerCatalogoDeMockups, staleTime: 30 * 60_000 });
  const texturas = useQuery({ queryKey: ["mockups", "texturas"], queryFn: lerTexturas, staleTime: 30 * 60_000 });
  const aplicacoes = useQuery({ queryKey: ["mockups", "aplicacoes", clientId, marcaId], queryFn: () => lerAplicacoes(clientId, marcaId), enabled: !!clientId });

  // Kit da marca aberta (a marca que não é a principal nunca herda da outra).
  const { kit } = useKitDaMarca(clientId, marcaId);
  const doProjeto = (coresDaMarca || []).map((h) => String(h || "")).filter((h) => /^#[0-9a-fA-F]{6}$/.test(h));
  const cores = useMemo(() => (doProjeto.length ? (doProjeto.length === 1 ? doProjeto.concat(["#ffffff"]) : doProjeto) : coresDoKit(kit)), [kit, doProjeto.join(",")]);
  const logosDoProjeto = (logosDaMarca || []).filter((l) => !!l.path);
  const [comAssinatura, setComAssinatura] = useEstadoDaTela<boolean>(`${chave}:assinatura`, false, { validar: (v) => typeof v === "boolean" });
  const fontePronta = useFontesGoogle(tipografia ? [{ familia: tipografia.familia, pesos: [600] }] : [], !!tipografia && comAssinatura);

  const logos = useQuery({
    queryKey: logosDoProjeto.length ? ["mockups", "logos-do-projeto", clientId, logosDoProjeto.map((l) => l.path).join("|")] : ["mockups", "logos", clientId, marcaId, kit && kit.logo_path, kit && kit.logo_file_id, kit && kit.logo_alt_path, kit && kit.logo_alt_file_id],
    enabled: logosDoProjeto.length > 0 || !!kit,
    staleTime: 10 * 60_000,
    queryFn: () =>
      logosDoProjeto.length
        ? carregarLogos(logosDoProjeto.map((l) => ({ id: l.id, path: l.path, fileId: null, tom: null })))
        : carregarLogos([
            { id: "principal", path: kit && kit.logo_path, fileId: kit && kit.logo_file_id, tom: kit && kit.logo_tom },
            { id: "alternativa", path: kit && kit.logo_alt_path, fileId: kit && kit.logo_alt_file_id, tom: kit && kit.logo_alt_tom },
          ]),
  });

  const texturaEscolhida: TexturaDoCatalogo | null = useMemo(() => (texturas.data || []).find((t) => t.id === geral.textura) || null, [texturas.data, geral.textura]);
  const texturaImg = useQuery({
    queryKey: ["mockups", "textura", texturaEscolhida && texturaEscolhida.caminho],
    enabled: !!texturaEscolhida,
    staleTime: Infinity,
    queryFn: () => carregarImagem((texturaEscolhida as TexturaDoCatalogo).caminho),
  });
  const textura = useMemo(() => (texturaImg.data ? { imagem: texturaImg.data as CanvasImageSource, largura: texturaImg.data.naturalWidth, altura: texturaImg.data.naturalHeight } : null), [texturaImg.data]);

  /** As escolhas do design para um conjunto de ajustes (o geral ou o de um mockup). */
  const montarEscolhas = useCallback(
    (a: AjustesDoMockup): EscolhasDoDesign => ({
      fundo: cores[a.fundo % cores.length] || COR_PADRAO,
      segunda: cores[a.segunda % cores.length] || "#ffffff",
      escala: a.escala,
      textura,
      opacidadeTextura: a.opacidade,
      desgaste: a.desgaste,
      assinatura: tipografia && comAssinatura && tipografia.texto ? { texto: tipografia.texto, familia: tipografia.familia } : null,
      posicao: { x: a.posicaoX, y: a.posicaoY },
      rotacao: a.rotacao,
      variante: a.variante,
      modo: a.modo,
    }),
    // fontePronta: redesenha quando a fonte da marca termina de chegar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cores, textura, tipografia && tipografia.familia, tipografia && tipografia.texto, comAssinatura, fontePronta],
  );
  // Estável entre renders: o editor de cenas redesenha a prévia quando as escolhas mudam.
  const escolhasGerais = useMemo(() => montarEscolhas(geral), [montarEscolhas, geral]);
  const cenaDe = useCallback((a: AjustesDoMockup) => ({ luz: a.luz, brilho: a.brilho, fundo: fundoDosAjustes(a, cores, textura) }), [cores, textura]);

  const itens = useMemo(() => (catalogo.data ? catalogo.data.itens : []), [catalogo.data]);
  const porId = useMemo(() => {
    const m: Record<string, MockupDoCatalogo> = {};
    itens.forEach((i) => (m[i.id] = i));
    return m;
  }, [itens]);
  const daFonte = useMemo(() => filtrarPorFonte(itens, fonte), [itens, fonte]);
  const contagem = useMemo(() => {
    const c: Record<string, number> = {};
    daFonte.forEach((i) => (c[i.categoria] = (c[i.categoria] || 0) + 1));
    return c;
  }, [daFonte]);
  const totalIa = useMemo(() => itens.filter((i) => i.fonte === "ia").length, [itens]);
  const achados = useMemo(() => (busca.trim() ? buscarMockups(daFonte, busca).slice(0, 48) : []), [daFonte, busca]);

  // ------------------------------------------------------------------ aplicar em lote

  const listaParaAplicar = useMemo(() => aplicar.filter((id) => !!porId[id]), [aplicar, porId]);
  const versao = useRef(0);
  // Lista estável: sem logo (kit sem logo, projeto sem logo ou erro na leitura), `|| []`
  // criava uma lista nova a cada render e o efeito do lote recomeçava sem parar (CT-02).
  const logosProntas: LogoCarregada[] = useMemo(() => logos.data || [], [logos.data]);
  // O que muda a imagem além dos ajustes (cores, logos, textura carregada, assinatura).
  const chaveDoKit = `${cores.join(",")}|${logos.dataUpdatedAt}|${textura ? geral.textura : ""}|${comAssinatura ? 1 : 0}|${fontePronta ? 1 : 0}`;
  // Camadas de trabalho já montadas, por mockup: soltas quando o mockup sai do lote e ao
  // sair do estúdio (cada mockup pesa ~22 MB na GPU; antes ficavam até fechar a aba).
  const camadasEmUso = useRef<Record<string, MockupDoCatalogo["caminhos"]["trabalho"]>>({});
  const prontosAtuais = useRef(prontos);
  prontosAtuais.current = prontos;
  useEffect(() => {
    if (etapa !== "aplicar" || !listaParaAplicar.length || logos.isLoading) return;
    const minha = ++versao.current;
    const t = setTimeout(async () => {
      setRenderizando(true);
      for (const id of listaParaAplicar) {
        if (versao.current !== minha) return;
        const m = porId[id];
        const a = ajustesDoItem(geral, proprios[id]);
        const chaveItem = chaveDosAjustes(a, chaveDoKit);
        // Só remonta o que mudou (ajustar um mockup não refaz o lote inteiro).
        const ja = prontosAtuais.current[id];
        if (ja && ja.chave === chaveItem) continue;
        camadasEmUso.current[id] = m.caminhos.trabalho;
        try {
          const r = await renderizarMockup(m, "trabalho", logosProntas, montarEscolhas(a), undefined, cenaDe(a));
          const blob = await paraBlob(r.canvas, "image/jpeg", 0.86);
          if (versao.current !== minha) return;
          const url = URL.createObjectURL(blob);
          setProntos((atual) => {
            const velho = atual[id];
            if (velho) URL.revokeObjectURL(velho.url);
            return { ...atual, [id]: { url, chave: chaveItem } };
          });
        } catch (e) {
          toast.error(`${m.nome}: ${textoDoErro(e, "não foi possível montar o mockup.")}`);
        }
      }
      if (versao.current === minha) setRenderizando(false);
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [etapa, listaParaAplicar.join(","), geral, proprios, logosProntas, montarEscolhas, cenaDe, chaveDoKit]);

  // Mockup que saiu do lote solta as camadas de trabalho (a prévia pronta, em JPEG, fica).
  useEffect(() => {
    const naLista: Record<string, true> = {};
    listaParaAplicar.forEach((id) => (naLista[id] = true));
    Object.keys(camadasEmUso.current).forEach((id) => {
      if (naLista[id]) return;
      liberarCamadas(camadasEmUso.current[id]);
      delete camadasEmUso.current[id];
    });
  }, [listaParaAplicar]);

  // Ao sair: para o lote em andamento, revoga as prévias e solta as camadas.
  useEffect(
    () => () => {
      ++versao.current;
      const atuais = prontosAtuais.current;
      Object.keys(atuais).forEach((k) => URL.revokeObjectURL(atuais[k].url));
      const emUso = camadasEmUso.current;
      Object.keys(emUso).forEach((id) => liberarCamadas(emUso[id]));
      camadasEmUso.current = {};
    },
    [],
  );

  // ------------------------------------------------------------------ ações

  const sugerir = async () => {
    const candidatos = candidatosDaSugestao(itens, categorias, 40, fonte);
    if (!candidatos.length) {
      toast.error("Nenhum mockup nas categorias escolhidas.");
      return;
    }
    setEtapa("sugestao");
    setSugerindo(true);
    setAvisoJev(null);
    try {
      const r = await sugerirMockups({ clientId, marcaId, candidatos, quantos: Math.min(8, candidatos.length) });
      setSugestoes(r.sugestoes);
      setAvisoJev(r.aviso);
      setAplicar(r.sugestoes.map((s) => s.mockup_id));
    } catch (e) {
      // A sugestão falhou: segue com a ordem da sequência e diz o motivo.
      const lista = candidatos.slice(0, 8);
      setSugestoes(lista.map((m) => ({ mockup_id: m.id, nota: 0, confianca: null })));
      setAplicar(lista.map((m) => m.id));
      setAvisoJev(`Sem sugestão agora: ${textoDoErro(e)}. A lista segue a sequência; escolha à mão.`);
    } finally {
      setSugerindo(false);
    }
  };

  /**
   * O que fica guardado com a escolha: as cores já resolvidas (para o envio) e, em `ajustes`, SÓ o
   * que o mockup muda em relação ao geral. Guardar o conjunto inteiro congelava o mockup no geral
   * da hora da escolha: na volta ele aparecia "ajustado" e parava de seguir o geral.
   * `p` é o ajuste próprio novo quando ele ainda não chegou ao estado (Salvar e escolher).
   */
  const configDe = (id: string | null, p?: AjustesProprios | null) => {
    const doItem = id ? (p !== undefined ? p : proprios[id]) : null;
    const a = ajustesDoItem(geral, doItem);
    const e = montarEscolhas(a);
    return { fundo: e.fundo, segunda: e.segunda, escala: a.escala, textura: a.textura || null, opacidade: a.opacidade, desgaste: a.desgaste, ajustes: soOQueMuda(geral, a) };
  };

  /** Escolher grava na hora em mockup_aplicacoes; tirar arquiva (nada é apagado). */
  const alternarEscolha = (m: MockupDoCatalogo, p?: AjustesProprios | null) => {
    const ja = escolhidos.find((e) => e.id === m.id && e.origem === "catalogo");
    if (ja) {
      setEscolhidos((atual) => atual.filter((e) => e !== ja));
      if (ja.aplicacaoId && !ja.enviado) arquivarAplicacao(ja.aplicacaoId).catch((e) => toast.error(`${m.nome}: ${textoDoErro(e, "a escolha não foi desfeita no banco.")}`));
      return;
    }
    const novo: Escolhido = { id: m.id, nome: m.nome, origem: "catalogo", noBrandbook: true, noAcervo: false };
    setEscolhidos((atual) => atual.concat([novo]));
    salvarAplicacao({ clientId, marcaId, origem: "catalogo", mockupId: m.id, config: configDe(m.id, p) })
      .then((ap) => setEscolhidos((atual) => atual.map((e) => (e.id === m.id && e.origem === "catalogo" ? { ...e, aplicacaoId: ap.id } : e))))
      .catch((e) => toast.error(`${m.nome}: ${textoDoErro(e, "a escolha não foi guardada.")}`));
  };

  // Escolhas de uma visita anterior voltam (as ainda não enviadas), com os ajustes de cada uma.
  const restaurado = useRef(false);
  useEffect(() => {
    if (restaurado.current || !aplicacoes.data || !itens.length) return;
    restaurado.current = true;
    const ajustesSalvos: Record<string, AjustesProprios> = {};
    const salvos: Escolhido[] = aplicacoes.data
      .filter((a) => a.status === "escolhido")
      .map((a): Escolhido | null => {
        const cfg = (a.config || {}) as Record<string, unknown>;
        if (a.origem === "catalogo") {
          const m = a.mockup_id ? porId[a.mockup_id] : null;
          // Só volta como ajuste próprio o que difere do geral de agora (o resto segue o geral).
          if (m && cfg.ajustes && typeof cfg.ajustes === "object") {
            const difere = soOQueMuda(geral, ajustesDoItem(geral, cfg.ajustes as AjustesProprios));
            if (Object.keys(difere).length) ajustesSalvos[m.id] = difere;
          }
          return m ? { id: m.id, nome: m.nome, origem: "catalogo" as const, aplicacaoId: a.id, noBrandbook: a.no_brandbook !== false, noAcervo: false } : null;
        }
        const cantos = Array.isArray(cfg.cantos) ? (cfg.cantos as Ponto[]) : null;
        if (!a.cena_caminho || !cantos || cantos.length !== 4) return null;
        return {
          id: a.id,
          nome: rotuloDoTipoDeCena(String(cfg.tipo || "")),
          origem: "cena" as const,
          aplicacaoId: a.id,
          cena: { caminho: a.cena_caminho, cantos, luz: typeof cfg.luz === "number" ? cfg.luz : 0.6 },
          noBrandbook: true,
          noAcervo: false,
        };
      })
      .filter((e): e is Escolhido => !!e);
    if (salvos.length) setEscolhidos((atual) => salvos.filter((s) => !atual.some((e) => e.aplicacaoId === s.aplicacaoId)).concat(atual));
    // Ajuste guardado no banco só volta quando a tela não tem um mais novo para o mockup.
    const ids = Object.keys(ajustesSalvos);
    if (ids.length) setProprios((atual) => ids.reduce((t, id) => (t[id] ? t : { ...t, [id]: ajustesSalvos[id] }), { ...atual }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aplicacoes.data, itens.length, porId]);

  /** Mockup em alta (PNG), com os ajustes que valem para ele. As camadas em alta (~98 MB) saem logo depois. */
  const pngEmAlta = async (m: MockupDoCatalogo, a?: AjustesDoMockup): Promise<Blob> => {
    const aj = a || ajustesDoItem(geral, proprios[m.id]);
    try {
      return await paraBlob((await renderizarMockup(m, "alta", logosProntas, montarEscolhas(aj), undefined, cenaDe(aj))).canvas, "image/png");
    } finally {
      liberarCamadas(m.caminhos.alta);
    }
  };

  const baixar = async (m: MockupDoCatalogo, a?: AjustesDoMockup) => {
    setBaixando(m.id);
    try {
      salvarArquivo(await pngEmAlta(m, a), nomeDeArquivo(m.nome, "png"));
    } catch (e) {
      toast.error(textoDoErro(e, "Não foi possível exportar o PNG."));
    } finally {
      setBaixando(null);
    }
  };

  /** Cena sob medida em PNG: a imagem já montada ou refeita da cena guardada e dos cantos. */
  const pngDaCena = async (e: Escolhido): Promise<Blob> => {
    if (e.imagem) return e.imagem;
    if (!e.cena) throw new Error("Cena sem imagem");
    const img = await carregarImagem(e.cena.caminho, "mesa");
    const pronta = comporCena(img, e.cena.cantos, logosProntas, escolhasGerais, e.cena.luz, 1);
    if (!pronta) throw new Error("Cena indisponível");
    return paraBlob(pronta, "image/png");
  };

  /** Todos os do lote (ou só os escolhidos, com as cenas sob medida) em alta, num ZIP. */
  const baixarTodos = async (ids: string[], cenas: Escolhido[] = []) => {
    const lista = ids.map((id) => porId[id]).filter((m): m is MockupDoCatalogo => !!m);
    if (!lista.length && !cenas.length) return;
    setBaixando("zip");
    const arquivos: Array<{ nome: string; blob: Blob }> = [];
    const falhas: string[] = [];
    for (const m of lista) {
      try {
        arquivos.push({ nome: nomeDeArquivo(m.nome, "png"), blob: await pngEmAlta(m) });
      } catch (e) {
        falhas.push(`${m.nome}: ${textoDoErro(e)}`);
      }
    }
    for (let i = 0; i < cenas.length; i++) {
      const e = cenas[i];
      try {
        arquivos.push({ nome: nomeDeArquivo(`${e.nome} ${i + 1}`, "png"), blob: await pngDaCena(e) });
      } catch (err) {
        falhas.push(`${e.nome}: ${textoDoErro(err)}`);
      }
    }
    try {
      if (arquivos.length) await baixarZip(arquivos, nomeDeArquivo(`mockups-${marcaId || clientId.slice(0, 8)}`, "zip"));
      if (falhas.length) toast.warning(`${falhas.length} ficaram fora do ZIP: ${falhas.slice(0, 2).join("; ")}`);
    } catch (e) {
      toast.error(textoDoErro(e, "O ZIP não foi montado."));
    } finally {
      setBaixando(null);
    }
  };

  const enviar = async () => {
    const fila = escolhidos.filter((e) => !e.enviado);
    if (!fila.length) return;
    setEnviando(true);
    let feitos = 0;
    let noAcervo = 0;
    const paraBrandbook: MockupParaBrandbook[] = [];
    for (const e of fila) {
      try {
        let png: Blob;
        if (e.origem === "catalogo") {
          const m = porId[e.id];
          if (!m) throw new Error("Mockup fora do catálogo");
          png = await pngEmAlta(m);
        } else {
          png = await pngDaCena(e);
        }
        const cfg: Record<string, unknown> = configDe(e.origem === "catalogo" ? e.id : null);
        const chaveDoEnvio = `mesa-mockups:${clientId}:${marcaId || "cliente"}:${e.origem}:${e.id}:${JSON.stringify(cfg)}`.slice(0, 480);
        const envio = await enviarParaArquivos({ clientId, nome: `Mockup ${e.nome}`, png, chave: chaveDoEnvio, descricao: `Mockup da identidade visual (${e.nome}) montado no estúdio de mockups.` });
        if (e.noBrandbook) {
          // Cópia leve (JPEG até 1600 px) no bucket mesa, onde a apresentação e o brandbook buscam as imagens.
          try {
            const caminho = await copiaParaBrandbook(clientId, envio.fileId, png);
            cfg.brandbook_imagem = caminho;
            paraBrandbook.push({ titulo: e.nome, imagem: caminho });
          } catch (err) {
            toast.warning(`${e.nome}: foi para Arquivos, mas a cópia da apresentação falhou (${textoDoErro(err)}).`);
          }
        }
        if (e.noAcervo) {
          try {
            const r = await guardarNoAcervo({ clientId, marcaId, fileId: envio.fileId, nome: `Mockup ${e.nome}` });
            cfg.acervo_imagem_id = r.imagem_id;
            noAcervo++;
          } catch (err) {
            toast.warning(`${e.nome}: foi para Arquivos, mas não entrou no acervo (${textoDoErro(err)}).`);
          }
        }
        await salvarAplicacao({
          clientId,
          marcaId,
          origem: e.origem,
          mockupId: e.origem === "catalogo" ? e.id : null,
          cenaCaminho: null,
          config: cfg,
          fileId: envio.fileId,
          noBrandbook: e.noBrandbook,
          id: e.aplicacaoId || null,
        });
        if (envio.aviso) toast.warning(envio.aviso);
        feitos++;
        setEscolhidos((atual) => atual.map((x) => (x === e ? { ...x, enviado: true } : x)));
      } catch (err) {
        toast.error(`${e.nome}: ${textoDoErro(err, "não foi enviado.")}`);
      }
    }
    setEnviando(false);
    if (paraBrandbook.length && onEnviados) onEnviados(paraBrandbook);
    if (feitos) {
      toast.success(
        `${feitos} mockup${feitos > 1 ? "s" : ""} em Arquivos > Identidade visual, aguardando a revisão da agência` +
          (paraBrandbook.length ? `; ${paraBrandbook.length} na apresentação` : "") +
          (noAcervo ? `; ${noAcervo} no acervo` : "") +
          ".",
      );
      void qc.invalidateQueries({ queryKey: ["mockups", "aplicacoes", clientId, marcaId] });
      void qc.invalidateQueries({ queryKey: ["all-files"] });
      void qc.invalidateQueries({ queryKey: ["files"] });
      if (noAcervo) {
        void qc.invalidateQueries({ queryKey: ["mesa", "acervo-contexto", clientId] });
        void qc.invalidateQueries({ queryKey: ["mesa", "acervo", clientId] });
        // Mesa Foto e campanhas leem o acervo por esta chave (fotoApi.chaveDasFotos).
        void qc.invalidateQueries({ queryKey: ["mesa-foto", "acervo", clientId] });
      }
    }
  };

  // ------------------------------------------------------------------ tela

  if (catalogo.isLoading) return <Carregando rotulo="Abrindo o catálogo de mockups" />;
  if (catalogo.isError) return <EstadoDeErro titulo="O catálogo não abriu" acao={<button className={botao.secundario} onClick={() => void catalogo.refetch()}>Tentar de novo</button>} />;
  if (catalogo.data && catalogo.data.semBanco) {
    return <EstadoVazio icone={<ImageOff className="h-5 w-5" />} titulo="O catálogo de mockups ainda não foi ativado" descricao="Falta aplicar a migration do estúdio e subir o primeiro lote." />;
  }
  if (!itens.length) return <EstadoVazio icone={<ImageOff className="h-5 w-5" />} titulo="Nenhum mockup no catálogo ainda" />;

  const semLogo = !logos.isLoading && !logosProntas.length;
  const enviadas = (aplicacoes.data || []).filter((a) => a.status === "enviado").length;
  const algumComFundo = listaParaAplicar.some((id) => porId[id] && porId[id].fundoTrocavel);
  const escolhidosDoCatalogo = escolhidos.filter((e) => e.origem === "catalogo").map((e) => e.id);
  const cenasEscolhidas = escolhidos.filter((e) => e.origem === "cena");

  return (
    <div className="grid min-w-0 gap-6">
      <Etapas
        rotulo="Etapas do estúdio de mockups"
        numerar
        valor={etapa}
        onEscolher={(v) => setEtapa(v as Etapa)}
        itens={[
          { valor: "categorias", rotulo: "Categorias", contador: categorias.length || null },
          { valor: "sugestao", rotulo: "Sugestão" },
          { valor: "aplicar", rotulo: "Aplicar", contador: listaParaAplicar.length || null },
          { valor: "cenas", rotulo: "Fachada e redes" },
          { valor: "enviar", rotulo: "Enviar", contador: escolhidos.length || null, destaque: escolhidos.length > 0 && etapa !== "enviar" },
        ]}
      />

      {semLogo ? (
        <p className={texto.auxiliar} role="status">
          {logosDoProjeto.length ? "A logo do projeto não abriu: os mockups saem só com as cores." : "O kit desta marca está sem logo: os mockups saem só com as cores."}
        </p>
      ) : null}

      {etapa === "categorias" ? (
        <Secao
          titulo="Onde mostrar a marca"
          descricao={`${itens.length} mockups no catálogo${totalIa ? `, ${totalIa} feitos com IA` : ""}`}
          recolher={false}
          ajuda="Escolha as categorias. O Jev ordena os mockups dessas categorias pelo que mais combina com o negócio do cliente; depois a marca é aplicada em todos de uma vez. Os feitos com IA têm a superfície lisa e em perspectiva: a logo entra pelo código, nunca pelo gerador."
          acao={
            <span className="inline-flex items-center">
              <button type="button" className={juntar(botao.discreto, "mr-2")} onClick={() => { setAplicar(candidatosDaSugestao(itens, categorias, 12, fonte).map((m) => m.id)); setEtapa("aplicar"); }}>
                Escolher à mão
              </button>
              <button type="button" className={botao.primario} disabled={!categorias.length || sugerindo} onClick={() => void sugerir()}>
                <Sparkles className="mr-1.5 h-4 w-4" aria-hidden /> Sugerir mockups
              </button>
            </span>
          }
        >
          <div className="mb-5 grid min-w-0 grid-cols-1 items-end gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,320px)]">
            <div role="group" aria-label="Origem dos mockups" className="flex min-w-0 flex-wrap">
              {FILTROS_DE_FONTE.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  aria-pressed={fonte === f.id}
                  onClick={() => setFonte(f.id)}
                  className={juntar(botao.secundario, "mb-2 mr-2 h-8 px-3 text-[12px]", fonte === f.id && "border-primary bg-primary/10 text-foreground")}
                >
                  {f.rotulo}
                </button>
              ))}
            </div>
            <CampoDeBusca valor={busca} onMudar={setBusca} placeholder="Buscar mockup (ex.: van, caneca, totem)" rotulo="Buscar mockup" />
          </div>
          {busca.trim() ? (
            <div className="mb-6 min-w-0">
              <div className="mb-2 flex min-w-0 items-center">
                <span className={juntar(texto.rotulo, "min-w-0 flex-1")}>{achados.length ? `${achados.length} encontrados` : "Nada encontrado"}</span>
                <button type="button" className={botao.primario} disabled={!aplicar.length} onClick={() => setEtapa("aplicar")}>
                  <Wand2 className="mr-1.5 h-4 w-4" aria-hidden /> Aplicar a marca em {aplicar.length}
                </button>
              </div>
              <GradeDeMockups itens={achados} notas={{}} marcados={aplicar} onAlternar={(id) => setAplicar((atual) => (atual.indexOf(id) >= 0 ? atual.filter((x) => x !== id) : atual.concat([id])))} />
            </div>
          ) : null}
          <div className="grid min-w-0 gap-5 sm:grid-cols-2 xl:grid-cols-4">
            {["Papelaria", "Digital", "Produto", "Exterior"].map((grupo) => (
              <div key={grupo} role="group" aria-label={grupo} className="min-w-0">
                <p className={juntar(texto.rotulo, "mb-2")}>{grupo}</p>
                <div className="flex flex-wrap">
                  {CATEGORIAS.filter((c) => c.grupo === grupo).map((c) => {
                    const ligado = categorias.indexOf(c.id) >= 0;
                    const n = contagem[c.id] || 0;
                    return (
                      <button
                        key={c.id}
                        type="button"
                        aria-pressed={ligado}
                        disabled={!n}
                        onClick={() => setCategorias((atual) => (ligado ? atual.filter((x) => x !== c.id) : atual.concat([c.id])))}
                        className={juntar(botao.secundario, "mb-2 mr-2 h-8 px-3 text-[12px]", ligado && "border-primary bg-primary/10 text-foreground")}
                      >
                        {ligado ? <Check className="mr-1 h-3.5 w-3.5" aria-hidden /> : null}
                        {c.rotulo}
                        <span className="ml-1.5 text-[11px] tabular-nums text-muted-foreground">{n}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </Secao>
      ) : null}

      {etapa === "sugestao" ? (
        <Secao
          titulo="Sugestão para o segmento"
          descricao={sugerindo ? "O Jev está comparando os mockups" : sugestoes ? `${aplicar.length} marcados` : undefined}
          recolher={false}
          ajuda="Nota do Jev (Score): quanto cada mockup combina com o negócio e o público do cliente. Os mais altos já vêm marcados; marque ou desmarque à vontade."
          acao={
            <button type="button" className={botao.primario} disabled={!aplicar.length || sugerindo} onClick={() => setEtapa("aplicar")}>
              <Wand2 className="mr-1.5 h-4 w-4" aria-hidden /> Aplicar a marca em {aplicar.length}
            </button>
          }
        >
          {avisoJev ? <p className={juntar(texto.auxiliar, "mb-3")} role="status">{avisoJev}</p> : null}
          {sugerindo ? (
            <Carregando forma="grade" rotulo="Comparando os mockups" />
          ) : (
            <GradeDeMockups
              itens={((sugestoes || []).map((s) => porId[s.mockup_id]).filter(Boolean) as MockupDoCatalogo[]).concat(
                candidatosDaSugestao(itens, categorias, 40, fonte).filter((m) => !(sugestoes || []).some((s) => s.mockup_id === m.id)),
              )}
              notas={(sugestoes || []).reduce((t, s) => ({ ...t, [s.mockup_id]: s.nota }), {} as Record<string, number>)}
              marcados={aplicar}
              onAlternar={(id) => setAplicar((atual) => (atual.indexOf(id) >= 0 ? atual.filter((x) => x !== id) : atual.concat([id])))}
            />
          )}
        </Secao>
      ) : null}

      {etapa === "aplicar" ? (
        <Secao
          titulo="A marca aplicada"
          descricao={renderizando ? "Montando" : `${escolhidosDoCatalogo.length} escolhidos`}
          recolher={false}
          ajuda="Toque no mockup para escolher. A cor, a textura, o tamanho, a luz e o fundo valem para todos; o botão Ajustar muda só um (cor, variações, posição, giro, versão da logo, padrão, luz e fundo). A versão da logo sai pelo contraste com a superfície, se você não escolher outra."
          acao={
            <span className="inline-flex items-center">
              <button type="button" className={juntar(botao.secundario, "mr-2")} disabled={!listaParaAplicar.length || !!baixando} onClick={() => void baixarTodos(escolhidosDoCatalogo.length ? escolhidosDoCatalogo : listaParaAplicar, escolhidosDoCatalogo.length ? cenasEscolhidas : [])}>
                {baixando === "zip" ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden /> : <Download className="mr-1.5 h-4 w-4" aria-hidden />}
                {escolhidosDoCatalogo.length ? "Baixar escolhidos (ZIP)" : "Baixar todos (ZIP)"}
              </button>
              <button type="button" className={botao.primario} disabled={!escolhidos.length} onClick={() => setEtapa("enviar")}>
                Revisar e enviar
              </button>
            </span>
          }
        >
          <div className="mb-4 grid min-w-0 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <SeletorDeCor rotulo="Cor de fundo" cores={cores} valor={geral.fundo} onEscolher={(i) => mudarGeral({ fundo: i })} />
            <SeletorDeCor rotulo="Segunda cor" cores={cores} valor={geral.segunda} onEscolher={(i) => mudarGeral({ segunda: i })} />
            <label className="grid min-w-0">
              <span className={juntar(texto.rotulo, "mb-1.5")}>Textura</span>
              <select className="block h-9 w-full min-w-0 rounded-md border border-input bg-background px-2 text-[13px]" value={geral.textura} onChange={(e) => mudarGeral({ textura: e.target.value })}>
                <option value="">Sem textura</option>
                {(texturas.data || []).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.nome}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid min-w-0">
              <span className={juntar(texto.rotulo, "mb-1.5")}>Tamanho da logo</span>
              <input type="range" min={0} max={1} step={0.05} value={geral.escala} aria-label="Tamanho da logo (0 = automático)" onChange={(e) => mudarGeral({ escala: Number(e.target.value) })} />
              <span className={texto.auxiliar}>{geral.escala === 0 ? `Automático (${Math.round(ESCALA_POR_PAPEL.arte * 100)}%)` : `${Math.round(geral.escala * 100)}%`}</span>
            </label>
            {tipografia && tipografia.texto ? (
              <label className={juntar(texto.corpo, "flex min-w-0 items-center")} title={`${tipografia.texto} em ${tipografia.familia}`}>
                <input type="checkbox" className="mr-2 h-4 w-4 accent-primary" checked={comAssinatura} onChange={(e) => setComAssinatura(e.target.checked)} />
                <span className="min-w-0 truncate">Assinatura na peça ({tipografia.familia})</span>
              </label>
            ) : null}
            {texturaEscolhida ? (
              <>
                <label className="grid min-w-0">
                  <span className={juntar(texto.rotulo, "mb-1.5")}>Força da textura</span>
                  <input type="range" min={0} max={0.8} step={0.05} value={geral.opacidade} onChange={(e) => mudarGeral({ opacidade: Number(e.target.value) })} />
                </label>
                <label className="grid min-w-0">
                  <span className={juntar(texto.rotulo, "mb-1.5")}>Desgaste da logo</span>
                  <input type="range" min={0} max={0.8} step={0.05} value={geral.desgaste} onChange={(e) => mudarGeral({ desgaste: Number(e.target.value) })} />
                </label>
              </>
            ) : null}
          </div>
          <button type="button" aria-expanded={maisAjustes} className={juntar(botao.discreto, "mb-3 h-8 px-2 text-[12px]")} onClick={() => setMaisAjustes((v) => !v)}>
            <SlidersHorizontal className="mr-1.5 h-4 w-4" aria-hidden /> {maisAjustes ? "Menos ajustes" : "Luz, versão da logo e fundo"}
          </button>
          {maisAjustes ? (
            <div className="mb-5 grid min-w-0 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <Faixa rotulo="Luz da cena sobre a marca" min={0} max={1.5} passo={0.05} valor={geral.luz} mostrar={(v) => (v === 1 ? "Como no mockup" : v === 0 ? "Chapado" : `${Math.round(v * 100)}%`)} onMudar={(v) => mudarGeral({ luz: v })} />
              <Faixa rotulo="Brilho da marca" min={0.6} max={1.4} passo={0.02} valor={geral.brilho} mostrar={(v) => `${Math.round(v * 100)}%`} onMudar={(v) => mudarGeral({ brilho: v })} />
              <label className="grid min-w-0">
                <span className={juntar(texto.rotulo, "mb-1.5")}>Versão da logo</span>
                <select className="block h-9 w-full min-w-0 rounded-md border border-input bg-background px-2 text-[13px]" value={geral.variante} onChange={(e) => mudarGeral({ variante: e.target.value as AjustesDoMockup["variante"] })}>
                  <option value="auto">Automática (contraste)</option>
                  <option value="original">Do kit</option>
                  <option value="branca">Branca</option>
                  <option value="preta">Preta</option>
                </select>
              </label>
              <label className="grid min-w-0">
                <span className={juntar(texto.rotulo, "mb-1.5")}>Arte</span>
                <select className="block h-9 w-full min-w-0 rounded-md border border-input bg-background px-2 text-[13px]" value={geral.modo} onChange={(e) => mudarGeral({ modo: e.target.value as AjustesDoMockup["modo"] })}>
                  <option value="logo">Logo</option>
                  <option value="padrao">Padrão repetido</option>
                </select>
              </label>
              {algumComFundo ? (
                <>
                  <label className="grid min-w-0">
                    <span className={juntar(texto.rotulo, "mb-1.5")}>Fundo da cena</span>
                    <select className="block h-9 w-full min-w-0 rounded-md border border-input bg-background px-2 text-[13px]" value={geral.fundoCena} onChange={(e) => mudarGeral({ fundoCena: e.target.value as TipoDeFundoDaCena })}>
                      {(Object.keys(ROTULOS_DO_FUNDO) as TipoDeFundoDaCena[]).map((id) => (
                        <option key={id} value={id}>
                          {ROTULOS_DO_FUNDO[id]}
                        </option>
                      ))}
                    </select>
                  </label>
                  {geral.fundoCena !== "original" ? <SeletorDeCor rotulo="Cor do fundo da cena" cores={cores} valor={geral.corDoFundoCena} onEscolher={(i) => mudarGeral({ corDoFundoCena: i })} /> : null}
                </>
              ) : null}
            </div>
          ) : null}
          {!listaParaAplicar.length ? (
            <EstadoVazio titulo="Nenhum mockup marcado" acao={<button className={botao.secundario} onClick={() => setEtapa("categorias")}>Escolher categorias</button>} />
          ) : (
            <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 desk:grid-cols-4">
              {listaParaAplicar.map((id) => {
                const m = porId[id];
                const p = prontos[id];
                const marcado = escolhidos.some((e) => e.id === id && e.origem === "catalogo");
                const ajustado = !!proprios[id] && Object.keys(proprios[id]).length > 0;
                return (
                  <figure key={id} className="min-w-0">
                    <button
                      type="button"
                      aria-pressed={marcado}
                      aria-label={`${marcado ? "Tirar" : "Escolher"} ${m.nome}`}
                      onClick={() => alternarEscolha(m)}
                      className={juntar("relative block w-full overflow-hidden rounded-md bg-muted", marcado && "ring-2 ring-primary")}
                      style={{ paddingBottom: `${(m.alturaTrabalho / m.larguraTrabalho) * 100}%` }}
                    >
                      {p ? (
                        <img src={p.url} alt={m.nome} className="absolute inset-0 h-full w-full object-cover transition-opacity duration-300" />
                      ) : (
                        <span className="absolute inset-0 flex items-center justify-center text-muted-foreground">
                          <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
                        </span>
                      )}
                      {marcado ? (
                        <span className="absolute right-2 top-2 inline-flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground">
                          <Check className="h-4 w-4" aria-hidden />
                        </span>
                      ) : null}
                    </button>
                    <figcaption className="mt-1.5 flex min-w-0 items-center">
                      <span className="min-w-0 flex-1">
                        <span className={juntar(texto.auxiliar, "block truncate")}>{m.nome}</span>
                        <span className={juntar(texto.etiqueta, "block text-muted-foreground")}>
                          {m.fonte === "ia" ? "Feito com IA" : "Pacote da agência"}
                          {m.fundoTrocavel ? " · fundo trocável" : ""}
                          {ajustado ? " · ajustado" : ""}
                        </span>
                      </span>
                      <button type="button" className={botao.icone} aria-label={`Ajustar ${m.nome}`} onClick={() => setAberto(m)}>
                        <SlidersHorizontal className="h-4 w-4" aria-hidden />
                      </button>
                      <button type="button" className={botao.icone} aria-label={`Baixar ${m.nome} em PNG`} disabled={baixando === m.id} onClick={() => void baixar(m)}>
                        {baixando === m.id ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Download className="h-4 w-4" aria-hidden />}
                      </button>
                    </figcaption>
                  </figure>
                );
              })}
            </div>
          )}
        </Secao>
      ) : null}

      {etapa === "cenas" ? (
        <Secao
          titulo="Cenas sob medida"
          recolher={false}
          ajuda="A IA desenha só a cena do negócio (fachada, sinalização, veículo, embalagem, papelaria, vestuário, tela ou redes), com uma superfície lisa. A marca entra pelo código nos 4 cantos da área (achados sozinhos; arraste para ajustar). A IA nunca desenha a logo."
        >
          <EditorDeCena
            clientId={clientId}
            marcaId={marcaId}
            logos={logosProntas}
            escolhas={escolhasGerais}
            onUsar={(r) => {
              setEscolhidos((atual) => atual.concat([{ id: r.aplicacaoId, nome: r.nome, origem: "cena", aplicacaoId: r.aplicacaoId, imagem: r.imagem, cena: { caminho: r.caminho, cantos: r.cantos, luz: r.luz }, noBrandbook: true, noAcervo: false }]));
              void qc.invalidateQueries({ queryKey: ["mockups", "aplicacoes", clientId, marcaId] });
            }}
          />
        </Secao>
      ) : null}

      {etapa === "enviar" ? (
        <Secao
          titulo="Escolhidos"
          descricao={enviadas ? `${enviadas} já enviados antes` : undefined}
          recolher={false}
          ajuda="Cada mockup vai em alta resolução para Arquivos > Identidade visual e entra na revisão da agência. Marcados com Apresentação entram na apresentação da Identidade e no brandbook. Marcados com Acervo entram no acervo de imagens do cliente, para as outras mesas. Nada vai para o cliente sem a aprovação."
          acao={
            <span className="inline-flex items-center">
              <button type="button" className={juntar(botao.secundario, "mr-2")} disabled={!escolhidos.length || !!baixando} onClick={() => void baixarTodos(escolhidosDoCatalogo, cenasEscolhidas)}>
                {baixando === "zip" ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden /> : <Download className="mr-1.5 h-4 w-4" aria-hidden />}
                Baixar (ZIP)
              </button>
              <button type="button" className={botao.primario} disabled={enviando || !escolhidos.some((e) => !e.enviado)} onClick={() => void enviar()}>
                {enviando ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden /> : <Send className="mr-1.5 h-4 w-4" aria-hidden />}
                Enviar
              </button>
            </span>
          }
        >
          {!escolhidos.length ? (
            <EstadoVazio titulo="Nada escolhido ainda" acao={<button className={botao.secundario} onClick={() => setEtapa("aplicar")}>Voltar para Aplicar</button>} />
          ) : (
            <>
              <div className="mb-2 flex min-w-0 flex-wrap items-center">
                <span className={juntar(texto.auxiliar, "mr-3")}>Marcar todos:</span>
                <button type="button" className={juntar(botao.discreto, "mr-2 h-8 px-2 text-[12px]")} onClick={() => setEscolhidos((atual) => atual.map((x) => (x.enviado ? x : { ...x, noBrandbook: true })))}>
                  Apresentação
                </button>
                <button type="button" className={juntar(botao.discreto, "h-8 px-2 text-[12px]")} onClick={() => setEscolhidos((atual) => atual.map((x) => (x.enviado ? x : { ...x, noAcervo: true })))}>
                  Acervo
                </button>
              </div>
              <ul className="-mx-2 min-w-0 divide-y divide-border/50">
                {escolhidos.map((e) => (
                  <li key={`${e.origem}:${e.id}`} className="flex min-w-0 flex-wrap items-center rounded-lg px-2 py-2.5">
                    <span className="mr-3 inline-block h-12 w-16 shrink-0 overflow-hidden rounded bg-muted">
                      {e.origem === "catalogo" && prontos[e.id] ? <img src={prontos[e.id].url} alt="" className="h-full w-full object-cover" /> : null}
                    </span>
                    <span className={juntar(texto.corpo, "min-w-0 flex-1 truncate")}>{e.nome}</span>
                    <label className={juntar(texto.auxiliar, "mr-3 inline-flex items-center")}>
                      <input
                        type="checkbox"
                        className="mr-1.5"
                        checked={e.noBrandbook}
                        disabled={e.enviado}
                        onChange={(ev) => setEscolhidos((atual) => atual.map((x) => (x === e ? { ...x, noBrandbook: ev.target.checked } : x)))}
                      />
                      Apresentação
                    </label>
                    <label className={juntar(texto.auxiliar, "mr-3 inline-flex items-center")}>
                      <input
                        type="checkbox"
                        className="mr-1.5"
                        checked={e.noAcervo}
                        disabled={e.enviado}
                        onChange={(ev) => setEscolhidos((atual) => atual.map((x) => (x === e ? { ...x, noAcervo: ev.target.checked } : x)))}
                      />
                      Acervo
                    </label>
                    {e.enviado ? (
                      <span className={juntar(texto.etiqueta, "text-primary")}>Enviado</span>
                    ) : (
                      <button
                        type="button"
                        className={botao.discreto}
                        onClick={() => {
                          setEscolhidos((atual) => atual.filter((x) => x !== e));
                          if (e.aplicacaoId) arquivarAplicacao(e.aplicacaoId).catch((err) => toast.error(`${e.nome}: ${textoDoErro(err, "a escolha não foi desfeita no banco.")}`));
                        }}
                      >
                        Tirar
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
        </Secao>
      ) : null}

      <AjustesDoMockupJanela
        mockup={aberto}
        geral={geral}
        proprios={aberto ? proprios[aberto.id] : undefined}
        cores={cores}
        logos={logosProntas}
        textura={textura}
        montarEscolhas={montarEscolhas}
        escolhido={!!aberto && escolhidos.some((e) => e.id === aberto.id && e.origem === "catalogo")}
        onSalvar={(p) => {
          if (!aberto) return;
          setProprios((atual) => {
            const novo = { ...atual };
            if (Object.keys(p).length) novo[aberto.id] = p;
            else delete novo[aberto.id];
            return novo;
          });
          // Já escolhido: o banco recebe o ajuste novo agora (outro aparelho vê o mesmo).
          const ja = escolhidos.find((e) => e.id === aberto.id && e.origem === "catalogo");
          if (ja && ja.aplicacaoId && !ja.enviado) {
            salvarAplicacao({ clientId, marcaId, origem: "catalogo", mockupId: aberto.id, config: configDe(aberto.id, p), id: ja.aplicacaoId }).catch((e) =>
              toast.error(`${aberto.nome}: ${textoDoErro(e, "o ajuste não foi guardado.")}`),
            );
          }
        }}
        onUsarEmTodos={(a) => {
          mudarGeral(a);
          // Levou para o geral: os ajustes próprios deste mockup deixam de ser exceção.
          if (aberto) setProprios((atual) => {
            const novo = { ...atual };
            delete novo[aberto.id];
            return novo;
          });
          toast.success("Ajustes levados para todos os mockups do lote.");
        }}
        onAlternarEscolha={(p) => aberto && alternarEscolha(aberto, p)}
        onBaixar={(a) => aberto && void baixar(aberto, a)}
        onFechar={() => setAberto(null)}
      />
    </div>
  );
}

function SeletorDeCor({ rotulo, cores, valor, onEscolher }: { rotulo: string; cores: string[]; valor: number; onEscolher: (i: number) => void }) {
  return (
    <div role="group" aria-label={rotulo} className="grid min-w-0">
      <span className={juntar(texto.rotulo, "mb-1.5")}>{rotulo}</span>
      <div className="flex flex-wrap">
        {cores.map((c, i) => (
          <button
            key={`${c}-${i}`}
            type="button"
            aria-pressed={valor % cores.length === i}
            aria-label={`${rotulo}: ${c}`}
            onClick={() => onEscolher(i)}
            className={juntar("toque-compacto mb-1 mr-1.5 h-7 w-7 rounded-full border border-border", valor % cores.length === i && "ring-2 ring-primary ring-offset-2 ring-offset-background")}
            style={{ backgroundColor: c }}
          />
        ))}
      </div>
    </div>
  );
}

function GradeDeMockups({ itens, notas, marcados, onAlternar }: { itens: MockupDoCatalogo[]; notas: Record<string, number>; marcados: string[]; onAlternar: (id: string) => void }) {
  return (
    <div className="grid min-w-0 grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4 desk:grid-cols-6">
      {itens.map((m) => {
        const marcado = marcados.indexOf(m.id) >= 0;
        const nota = notas[m.id];
        return (
          <button
            key={m.id}
            type="button"
            aria-pressed={marcado}
            onClick={() => onAlternar(m.id)}
            className={juntar("min-w-0 rounded-md text-left", marcado ? "opacity-100" : "opacity-60 hover:opacity-100")}
          >
            <MiniaturaDoMockup m={m} marcado={marcado} />
            <span className={juntar(texto.auxiliar, "mt-1.5 block truncate")}>{m.nome}</span>
            <span className={juntar(texto.etiqueta, "block text-muted-foreground")}>
              {rotuloDaCategoria(m.categoria)}
              {m.fonte === "ia" ? " · IA" : ""}
              {typeof nota === "number" && nota > 0 ? ` · nota ${(nota + 1).toFixed(1)} de 4` : ""}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function MiniaturaDoMockup({ m, marcado }: { m: MockupDoCatalogo; marcado: boolean }) {
  const url = useQuery({ queryKey: ["mockups", "thumb", m.caminhos.thumb], staleTime: 45 * 60_000, queryFn: () => urlAssinada(m.caminhos.thumb) });
  return (
    <span className={juntar("relative block w-full overflow-hidden rounded-md bg-muted", marcado && "ring-2 ring-primary")} style={{ paddingBottom: `${(m.altura / m.largura) * 100}%` }}>
      {url.data ? <img src={url.data} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover" /> : null}
    </span>
  );
}

export { EstudioDeMockups };
