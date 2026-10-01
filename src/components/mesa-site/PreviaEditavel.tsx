import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { ExternalLink, Loader2, Monitor, MousePointerClick, PanelRightClose, PanelRightOpen, RotateCcw, Smartphone } from "lucide-react";
import Secao from "@/components/sistema/Secao";
import SeletorCompacto from "@/components/sistema/SeletorCompacto";
import { Carregando, EstadoDeErro } from "@/components/sistema/Estados";
import { useRecolhido } from "@/components/sistema/TituloRecolhivel";
import { useEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
import { botao, juntar, superficie, texto } from "@/components/sistema/estilos";
import { useAvisarErro } from "@/components/mesa/Custo";
import { mapaDoSite, secaoDaBiblioteca, secoesDoMapa } from "../../../supabase/functions/_shared/site-biblioteca";
import type { TrabalhoDoMotor } from "../../../supabase/functions/_shared/motor-codigo";
import { camposDaCopy, copyDoSite, estadoDasSecoes, type ExecutorDaPrevia, lerCampo } from "../../../supabase/functions/mesa-site/modulos/site-previa";
import { lerMensagemDaPonte, type MensagemDaPonte } from "../../../supabase/functions/mesa-site/modulos/ponte-da-previa";
import { rotuloDaSecao } from "../../../supabase/functions/_shared/site-metodo";
import EstadoDoMotor, { useEstadoDoMotor } from "./EstadoDoMotor";
import LateralDaPrevia from "./LateralDaPrevia";
import ConfirmarAjusteDaPrevia, { type PedidoDeAjuste } from "./ConfirmarAjusteDaPrevia";
import TrocarImagemDaPrevia, { type PedidoDeImagem } from "./TrocarImagemDaPrevia";
import { montarPreviaRapida } from "./previaEstatica";
import { type RespostaDaEdicao, useEdicoesDaPrevia, useEditorDaPrevia, usePreviaDados } from "./previaApi";
import { type LinhaDoSite, previaAtual } from "./siteApi";

export const APARELHOS_DA_PREVIA = [
  { id: "computador", rotulo: "Computador", largura: 1280 },
  { id: "celular", rotulo: "Celular", largura: 390 },
] as const;
type Aparelho = (typeof APARELHOS_DA_PREVIA)[number]["id"];
type Fonte = "rapida" | "motor";

/** Escala para o aparelho caber na área (nunca aumenta). */
export const escalaDaPrevia = (larguraDaArea: number, larguraDoAparelho: number) => (larguraDaArea > 0 ? Math.min(1, larguraDaArea / larguraDoAparelho) : 1);

/** A prévia ocupa a maior parte da altura da janela (entre 520 e 980 px de tela). */
const alturaDaMoldura = () => {
  try {
    return Math.max(520, Math.min(980, Math.round((window.innerHeight || 900) * 0.76)));
  } catch {
    return 720;
  }
};

/** A imagem do site do motor pelo arquivo (public/imagens/<slot>-<8 do id>.<ext>). */
export function imagemPeloArquivo(src: string, ids: string[]): string | null {
  const m = /-([a-z0-9]{8})\.[a-z0-9]{2,4}(\?|#|$)/i.exec(String(src || ""));
  if (!m) return null;
  const alvo = m[1].toLowerCase();
  return ids.find((id) => id.replace(/[^a-z0-9]/gi, "").slice(0, 8).toLowerCase() === alvo) || null;
}

/**
 * Prévia do site enquanto é construído (SPV, 30/09, pedido do dono: "ter um
 * preview ali, onde posso editar também dentro").
 *
 * Duas fontes: a prévia RÁPIDA (montada no painel com o que a mesa já sabe,
 * seção a seção com o estado da construção; funciona sem o motor) e o SITE
 * DO MOTOR (o Vite do worker, ao vivo pelo túnel). Computador e celular.
 *
 * Com "Editar" ligado, dentro da prévia: clicar no texto e escrever; clicar
 * na imagem e trocar; a barrinha da seção sobe, desce, esconde ou pede
 * ajuste; na lateral, cores e fontes deste site e o histórico. Conteúdo vale
 * na hora e vai ao site do motor sem custo; o que mexe no código vira ajuste
 * do motor com o custo antes e Confirmar. Desfazer em tudo (Ctrl+Z também).
 */
export default function PreviaEditavel({
  site,
  trabalhos,
  executor,
  onIrPara,
}: {
  site: LinhaDoSite;
  trabalhos: TrabalhoDoMotor[];
  executor: ExecutorDaPrevia;
  onIrPara?: (etapa: string) => void;
}) {
  const avisarErro = useAvisarErro();
  const dadosQ = usePreviaDados(site);
  const edicoesQ = useEdicoesDaPrevia(site.id);
  const { editar, desfazer, ocupado } = useEditorDaPrevia(site);
  const estado = useEstadoDoMotor(executor, trabalhos);
  const doMotor = previaAtual(trabalhos);
  const urlDoMotor = doMotor ? doMotor.preview_url : null;
  const motorPublico = !!urlDoMotor && /^https:\/\//.test(urlDoMotor);

  const [fonte, setFonte] = useEstadoDaTela<Fonte>(`mesa-site:previa:fonte:${site.id}`, "rapida", { validar: (v): v is Fonte => v === "rapida" || v === "motor" });
  const fonteEfetiva: Fonte = fonte === "motor" && urlDoMotor ? "motor" : "rapida";
  const urlDaFonte = fonteEfetiva === "motor" ? urlDoMotor : null;
  const [aparelho, setAparelho] = useEstadoDaTela<Aparelho>("mesa-site:previa:aparelho-da-edicao", "computador", { validar: (v): v is Aparelho => v === "computador" || v === "celular" });
  const [editando, setEditando] = useEstadoDaTela<boolean>("mesa-site:previa:editar", true, { validar: (v): v is boolean => typeof v === "boolean" });
  const [selos, setSelos] = useEstadoDaTela<boolean>("mesa-site:previa:selos", true, { validar: (v): v is boolean => typeof v === "boolean" });
  const [lateralRecolhida, setLateralRecolhida] = useRecolhido("mesa-site:previa:lateral", false);
  const [pagina, setPagina] = useState<string | null>(null);
  const [ajuste, setAjuste] = useState<PedidoDeAjuste | null>(null);
  const [trocaDeImagem, setTrocaDeImagem] = useState<PedidoDeImagem | null>(null);
  const [enviandoJanela, setEnviandoJanela] = useState(false);

  // ---------------------------------------------------------------- montagem da prévia rápida

  const mapa = useMemo(() => mapaDoSite({ mapa: site.mapa, tipo: site.tipo, direcao: site.direcao }), [site.mapa, site.tipo, site.direcao]);
  const uids = useMemo(() => secoesDoMapa(mapa).concat((mapa.ocultas || []).map((o) => o.uid)), [mapa]);
  const estados = useMemo(() => estadoDasSecoes(trabalhos, uids), [trabalhos, uids]);
  const rolagem = useRef(0);
  const montada = useMemo(() => (dadosQ.data ? montarPreviaRapida(site, dadosQ.data, { pagina, estados, marcarEstados: selos, rolagem: rolagem.current }) : null), [site, dadosQ.data, pagina, estados, selos]);
  const { copy } = useMemo(() => copyDoSite(site.conteudo), [site.conteudo]);
  const campos = useMemo(() => camposDaCopy(copy), [copy]);
  const rotulos = useMemo(() => {
    const r: Record<string, string> = {};
    uids.forEach((u) => (r[u] = rotuloDaSecao(u)));
    return r;
  }, [uids]);

  // ---------------------------------------------------------------- o iframe e a conversa com a ponte

  const iframe = useRef<HTMLIFrameElement | null>(null);
  const [documento, setDocumento] = useState<string | null>(null);
  const [recarga, setRecarga] = useState(0);
  const [pronta, setPronta] = useState(false);
  const noIframe = useRef<{ html: string | null; css: string | null; fontes: string | null }>({ html: null, css: null, fontes: null });

  const enviar = useCallback(
    (m: Record<string, unknown>) => {
      const w = iframe.current ? iframe.current.contentWindow : null;
      if (!w) return;
      let alvo = "*";
      if (fonteEfetiva === "motor" && urlDoMotor) {
        try {
          alvo = new URL(urlDoMotor).origin;
        } catch {
          return;
        }
      }
      try {
        w.postMessage(m, alvo);
      } catch {
        /* a prévia saiu do ar: a próxima "pronta" reenvia */
      }
    },
    [fonteEfetiva, urlDoMotor],
  );

  // Troca de fonte: a prévia rápida nasce do documento (uma vez); o resto vai por mensagem.
  useEffect(() => {
    setPronta(false);
    noIframe.current = { html: null, css: null, fontes: null };
    setDocumento(null);
    // O túnel do motor muda de endereço quando o worker reinicia: a prévia recomeça.
  }, [fonteEfetiva, site.id, recarga, urlDaFonte]);
  useEffect(() => {
    if (fonteEfetiva !== "rapida" || documento !== null || !montada) return;
    noIframe.current = { html: montada.html, css: montada.css, fontes: montada.fontesUrl };
    setDocumento(montada.documento);
  }, [fonteEfetiva, documento, montada]);

  // Mudou o site (texto, seção, cor, estado da construção): a prévia rápida troca o miolo sem recarregar.
  useEffect(() => {
    if (fonteEfetiva !== "rapida" || !pronta || !montada) return;
    if (montada.html !== noIframe.current.html || montada.css !== noIframe.current.css) {
      enviar({ aq: "html", html: montada.html, css: montada.css });
      noIframe.current.html = montada.html;
      noIframe.current.css = montada.css;
    }
    if (montada.fontesUrl && montada.fontesUrl !== noIframe.current.fontes) {
      enviar({ aq: "fontes", url: montada.fontesUrl });
      noIframe.current.fontes = montada.fontesUrl;
    }
  }, [montada, pronta, fonteEfetiva, enviar]);

  // Os textos da copy (a ponte acha no site do motor) e o modo de edição.
  useEffect(() => {
    if (!pronta) return;
    enviar({ aq: "campos", campos: campos.map((c) => ({ campo: c.campo, valor: c.valor, secao: c.secao })), rotulos });
  }, [pronta, campos, rotulos, enviar]);
  useEffect(() => {
    if (pronta) enviar({ aq: "modo", editar: editando });
  }, [pronta, editando, enviar]);

  /** Depois de uma edição recusada: a prévia volta ao que está salvo. */
  const refazerPrevia = useCallback(() => {
    if (fonteEfetiva === "rapida" && montada) {
      enviar({ aq: "html", html: montada.html, css: montada.css });
      noIframe.current.html = montada.html;
    } else if (fonteEfetiva === "motor") enviar({ aq: "recarregar" });
  }, [fonteEfetiva, montada, enviar]);

  // ---------------------------------------------------------------- edições

  const ultimaAberta = (edicoesQ.data ? edicoesQ.data.edicoes : []).find((e) => !e.desfeita_em) || null;
  const avisouMotorDesligado = useRef(false);
  /** A área da prévia (some quando a seção recolhe) e se o último clique foi nela (ou dentro do iframe). */
  const raiz = useRef<HTMLDivElement | null>(null);
  const focoNaPrevia = useRef(false);

  const desfazerEdicao = useCallback(
    async (id: string) => {
      try {
        const r = await desfazer(id);
        toast.success(r.resumo, { duration: 3000 });
      } catch (e) {
        avisarErro(e, "Não deu para desfazer");
      }
    },
    [desfazer, avisarErro],
  );

  const executar = useCallback(
    async (edicao: Record<string, unknown>, extra: { confirmar?: boolean; instrucao?: string; teto_usd?: number; modelo_id?: string } = {}): Promise<RespostaDaEdicao | null> => {
      try {
        const r = await editar(edicao, extra);
        if (r.modo === "nada") {
          toast.info(r.resumo, { duration: 2500 });
          refazerPrevia();
        } else if (r.modo === "direto") {
          const registrada = r.edicao;
          toast.success(r.resumo, { duration: 3500, action: registrada ? { label: "Desfazer", onClick: () => void desfazerEdicao(registrada.id) } : undefined });
          if (fonteEfetiva === "motor" && (estado.codigo === "sem_worker" || estado.codigo === "caiu") && !avisouMotorDesligado.current) {
            avisouMotorDesligado.current = true;
            toast.info("Salvo. O site do motor recebe a edição quando o motor ligar; a prévia rápida já mostra.", { duration: 7000 });
          }
        } else if (r.precisa_confirmar) {
          setAjuste({ secao: r.secao, instrucao: r.instrucao, origem: edicao.tipo === "pedido" ? "pedido" : "texto", edicao });
        } else {
          toast.success(`${r.resumo} · na fila do motor`, { duration: 4000 });
        }
        return r;
      } catch (e) {
        avisarErro(e, "A edição não foi salva");
        refazerPrevia();
        return null;
      }
    },
    [editar, refazerPrevia, desfazerEdicao, fonteEfetiva, estado.codigo, avisarErro],
  );

  const pedirAjuste = useCallback((uid: string) => setAjuste({ secao: uid, instrucao: "", origem: "pedido", edicao: { tipo: "pedido", secao: uid } }), []);

  /**
   * Ctrl+Z (da tela ou de dentro da prévia): só com Editar ligado e desfaz só
   * edição de conteúdo. O ajuste do motor (trabalho na fila ou commit) volta
   * só pelo botão Desfazer, à vista.
   */
  const desfazerPeloAtalho = useCallback(() => {
    if (!editando || !ultimaAberta) return;
    if (ultimaAberta.modo === "ajuste") {
      toast.info("A última edição é um ajuste do motor: desfaça pelo botão Desfazer, na barra ou no histórico.", { duration: 5000 });
      return;
    }
    void desfazerEdicao(ultimaAberta.id);
  }, [editando, ultimaAberta, desfazerEdicao]);

  const aoMensagem = useCallback(
    (m: MensagemDaPonte) => {
      if (m.aq === "pronta") {
        setPronta(true);
        return;
      }
      if (m.aq === "rolagem") {
        rolagem.current = m.y;
        return;
      }
      if (m.aq === "desfazer") {
        focoNaPrevia.current = true;
        desfazerPeloAtalho();
        return;
      }
      focoNaPrevia.current = true;
      if (m.aq === "editar") {
        if (m.campo && lerCampo(m.campo)) void executar({ tipo: "texto", campo: m.campo, valor: m.valor });
        else if (m.secao) void executar({ tipo: "texto_livre", secao: m.secao, antes: m.antes, valor: m.valor });
        else {
          toast.info("Esse texto fica fora das seções do site: peça ao diretor de site.");
          refazerPrevia();
        }
        return;
      }
      if (m.aq === "imagem") {
        if (!m.secao) return;
        const ids = dadosQ.data ? dadosQ.data.imagens.map((i) => i.id) : [];
        const atual = m.id && ids.indexOf(m.id) >= 0 ? m.id : imagemPeloArquivo(m.src, ids);
        const daLista = atual && dadosQ.data ? dadosQ.data.imagens.find((i) => i.id === atual) || null : null;
        const lib = secaoDaBiblioteca((mapa.paginas.reduce<Array<{ uid: string; tipo: string }>>((l, p) => l.concat(p.secoes), []).find((s) => s.uid === m.secao) || { tipo: m.secao }).tipo);
        const slot = m.slot && /^(hero|secao|fundo|detalhe)$/.test(m.slot) ? m.slot : daLista ? daLista.slot : lib && lib.slots.length ? lib.slots[0].slot : "secao";
        setTrocaDeImagem({ secao: m.secao, slot, substitui_id: atual });
        return;
      }
      if (m.aq === "secao") {
        if (m.acao === "ajuste") pedirAjuste(m.secao);
        else if (m.acao === "esconder") void executar({ tipo: "secao_visivel", secao: m.secao, visivel: false });
        else void executar({ tipo: "secao_mover", secao: m.secao, direcao: m.acao });
      }
    },
    [desfazerPeloAtalho, executar, refazerPrevia, dadosQ.data, mapa, pedirAjuste],
  );
  const aoMensagemRef = useRef(aoMensagem);
  aoMensagemRef.current = aoMensagem;

  useEffect(() => {
    const ouvir = (ev: MessageEvent) => {
      if (!iframe.current || ev.source !== iframe.current.contentWindow) return;
      const m = lerMensagemDaPonte(ev.data);
      if (m) aoMensagemRef.current(m);
    };
    window.addEventListener("message", ouvir);
    return () => window.removeEventListener("message", ouvir);
  }, []);

  // Onde foi o último clique: na área da prévia (inclusive dentro do iframe, que tira o foco da janela) ou fora.
  useEffect(() => {
    const clique = (ev: Event) => {
      const r = raiz.current;
      focoNaPrevia.current = !!r && !!ev.target && r.contains(ev.target as Node);
    };
    const saiu = () => {
      // A janela perde o foco para o iframe da prévia quando a pessoa clica nele.
      window.setTimeout(() => {
        if (iframe.current && document.activeElement === iframe.current) focoNaPrevia.current = true;
      }, 0);
    };
    document.addEventListener("mousedown", clique, true);
    document.addEventListener("touchstart", clique, true);
    window.addEventListener("blur", saiu);
    return () => {
      document.removeEventListener("mousedown", clique, true);
      document.removeEventListener("touchstart", clique, true);
      window.removeEventListener("blur", saiu);
    };
  }, []);

  // Ctrl+Z na tela também desfaz a última edição da prévia, só quando a prévia está aberta, com Editar ligado,
  // e o foco (ou o último clique) está nela; fora de campo de texto.
  useEffect(() => {
    const tecla = (ev: KeyboardEvent) => {
      if (!(ev.ctrlKey || ev.metaKey) || ev.shiftKey || (ev.key !== "z" && ev.key !== "Z")) return;
      const alvo = ev.target as HTMLElement | null;
      if (alvo && (alvo.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(alvo.tagName))) return;
      const r = raiz.current;
      if (!editando || !ultimaAberta || !r || !r.isConnected) return;
      if (!(alvo && r.contains(alvo)) && !focoNaPrevia.current) return;
      ev.preventDefault();
      desfazerPeloAtalho();
    };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [editando, ultimaAberta, desfazerPeloAtalho]);

  const irParaSecao = (uid: string) => enviar({ aq: "ir", secao: uid });

  // Site do motor sem a ponte (projeto numa casca antiga): avisa e aponta a prévia rápida.
  const [semPonte, setSemPonte] = useState(false);
  useEffect(() => {
    setSemPonte(false);
    if (fonteEfetiva !== "motor" || pronta) return;
    const t = window.setTimeout(() => setSemPonte(true), 9000);
    return () => window.clearTimeout(t);
  }, [fonteEfetiva, pronta, recarga]);

  // ---------------------------------------------------------------- medida da moldura

  const area = useRef<HTMLDivElement | null>(null);
  const [largura, setLargura] = useState(0);
  const [altura, setAltura] = useState(alturaDaMoldura);
  useEffect(() => {
    const medir = () => {
      setLargura(area.current ? area.current.clientWidth : 0);
      setAltura(alturaDaMoldura());
    };
    medir();
    window.addEventListener("resize", medir);
    window.addEventListener("orientationchange", medir);
    const t = window.setTimeout(medir, 250);
    return () => {
      window.removeEventListener("resize", medir);
      window.removeEventListener("orientationchange", medir);
      window.clearTimeout(t);
    };
  }, [lateralRecolhida]);
  const a = APARELHOS_DA_PREVIA.find((x) => x.id === aparelho) || APARELHOS_DA_PREVIA[0];
  const escala = escalaDaPrevia(largura, a.largura);

  const abrirEmOutraAba = () => {
    if (fonteEfetiva === "motor" && urlDoMotor) {
      window.open(urlDoMotor, "_blank", "noopener,noreferrer");
      return;
    }
    if (!montada) return;
    try {
      const url = URL.createObjectURL(new Blob([montada.documento], { type: "text/html" }));
      window.open(url, "_blank", "noopener,noreferrer");
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      avisarErro(e, "Não deu para abrir a prévia");
    }
  };

  // ---------------------------------------------------------------- tela

  const opcoesDeFonte = [
    { valor: "rapida", rotulo: "Prévia rápida" },
    { valor: "motor", rotulo: "Site do motor", desativada: !urlDoMotor },
  ];
  const notaDaFonte =
    fonteEfetiva === "motor"
      ? motorPublico
        ? "Site do motor ao vivo"
        : "Site do motor: abre só na máquina da agência"
      : urlDoMotor
        ? "Prévia rápida (o site do motor está pronto para ver)"
        : "Prévia rápida: sai do mapa, da copy e das imagens";
  const historico = edicoesQ.data || null;

  return (
    <Secao
      titulo="Prévia"
      descricao={<EstadoDoMotor estado={estado} />}
      recolher="mesa-site:construcao:previa"
      ajuda="A prévia mostra o site enquanto ele é construído. O site do motor só aceita edição depois do próximo trabalho do motor (a ponte de edição chega com ele); até lá, edite na prévia rápida. A prévia rápida é montada aqui com o mapa, a copy, as imagens e a marca, seção a seção com o selo da construção (pronta, construindo, na fila), e funciona mesmo com o motor desligado. O site do motor é o código de verdade, ao vivo pelo túnel do worker. Com Editar ligado, clique num texto para escrever (Enter salva, Esc desiste), numa imagem para trocar, ou passe o mouse numa seção para subir, descer, esconder ou pedir ajuste. Contorno verde: texto da copy, vale na hora e sem custo. Contorno amarelo: texto escrito no código, vira ajuste do motor com o custo antes. Cores e fontes da lateral valem só para este site. Tudo tem Desfazer; o Ctrl+Z, com a prévia em foco e Editar ligado, desfaz a última edição de conteúdo (o ajuste do motor volta só pelo botão). Shift+Enter quebra linha nos textos longos (texto da seção, resposta, subtítulo)."
      acao={
        <>
          <button type="button" className={juntar(editando ? botao.primario : botao.secundario, "h-8")} aria-pressed={editando} onClick={() => setEditando(!editando)} data-editar-previa={editando ? "ligado" : "desligado"}>
            <MousePointerClick className="mr-1 h-3.5 w-3.5" />
            {editando ? "Editando" : "Editar"}
          </button>
          <button type="button" className={juntar(botao.icone, "ml-1")} aria-label={ultimaAberta ? `Desfazer: ${ultimaAberta.resumo}` : "Nada para desfazer"} title={ultimaAberta ? `Desfazer: ${ultimaAberta.resumo}` : "Nada para desfazer"} disabled={!ultimaAberta || ocupado} onClick={() => ultimaAberta && void desfazerEdicao(ultimaAberta.id)} data-desfazer-ultima="">
            <RotateCcw className="h-4 w-4" />
          </button>
          <button type="button" className={juntar(botao.icone, "ml-1")} aria-label="Abrir a prévia em outra aba" title="Abrir em outra aba" disabled={fonteEfetiva === "rapida" && !montada} onClick={abrirEmOutraAba}>
            <ExternalLink className="h-4 w-4" />
          </button>
          <button type="button" className={juntar(botao.icone, "ml-1 hidden lg:inline-flex")} aria-label={lateralRecolhida ? "Mostrar a lateral da prévia" : "Recolher a lateral da prévia"} title={lateralRecolhida ? "Mostrar seções, marca e edições" : "Recolher a lateral"} onClick={() => setLateralRecolhida(!lateralRecolhida)}>
            {lateralRecolhida ? <PanelRightOpen className="h-4 w-4" /> : <PanelRightClose className="h-4 w-4" />}
          </button>
        </>
      }
    >
      <div ref={raiz} className="min-w-0" data-previa-editavel="" data-fonte-da-previa={fonteEfetiva}>
        <div className="mb-2 flex min-w-0 flex-wrap items-center">
          <SeletorCompacto rotulo="Fonte da prévia" opcoes={opcoesDeFonte} valor={fonteEfetiva} onEscolher={(v) => setFonte(v as Fonte)} className="mb-1 mr-2" />
          <SeletorCompacto
            rotulo="Aparelho da prévia"
            opcoes={APARELHOS_DA_PREVIA.map((x) => ({ valor: x.id, rotulo: x.rotulo, icone: x.id === "celular" ? <Smartphone className="h-3.5 w-3.5" /> : <Monitor className="h-3.5 w-3.5" /> }))}
            valor={aparelho}
            onEscolher={(v) => setAparelho(v as Aparelho)}
            className="mb-1 mr-2"
          />
          {fonteEfetiva === "rapida" && montada && montada.paginas.length > 1 && (
            <SeletorCompacto rotulo="Página" modo="lista" opcoes={montada.paginas.map((p) => ({ valor: p.id, rotulo: p.titulo }))} valor={montada.pagina} onEscolher={(v) => setPagina(v)} className="mb-1 mr-2" />
          )}
          {fonteEfetiva === "rapida" && (
            <label className={juntar(texto.auxiliar, "mb-1 mr-3 inline-flex cursor-pointer items-center")}>
              <input type="checkbox" className="mr-1.5" checked={selos} onChange={(e) => setSelos(e.target.checked)} />
              Selos da construção
            </label>
          )}
          <span className={juntar(texto.auxiliar, "mb-1 min-w-0 truncate")} data-nota-da-previa="">
            {ocupado ? (
              <span className="inline-flex items-center">
                <Loader2 className="mr-1 h-3 w-3 animate-spin" aria-hidden="true" />
                Salvando
              </span>
            ) : (
              `${notaDaFonte}${escala < 1 ? ` · ${Math.round(escala * 100)}%` : ""}`
            )}
          </span>
        </div>
        {estado.avisos.length > 0 && (
          <p className={juntar(texto.auxiliar, "mb-2 whitespace-normal text-amber-700 dark:text-amber-400")} data-avisos-do-motor="">
            {estado.avisos.join(" ")}
          </p>
        )}
        {fonteEfetiva === "rapida" && montada && !montada.temCopy && (
          <p className={juntar(texto.auxiliar, "mb-2 flex min-w-0 flex-wrap items-center")} data-sem-copy="">
            <span className="mr-2">Sem copy escolhida: os textos entram depois da etapa Conteúdo.</span>
            {onIrPara && (
              <button type="button" className={juntar(botao.discreto, "h-7 px-1.5 text-[12px]")} onClick={() => onIrPara("conteudo")}>
                Ir para Conteúdo
              </button>
            )}
          </p>
        )}

        <div className={juntar("grid min-w-0 grid-cols-1 gap-6", !lateralRecolhida && "lg:grid-cols-[minmax(0,1fr)_280px]")}>
          <div ref={area} className="min-w-0 overflow-hidden">
            {fonteEfetiva === "rapida" && dadosQ.isLoading && <Carregando forma="aba" rotulo="Montando a prévia" />}
            {fonteEfetiva === "rapida" && dadosQ.isError && !dadosQ.data && <EstadoDeErro titulo="A prévia rápida não abriu." descricao="Não foi possível ler a marca e as imagens agora." acao={<button type="button" className={botao.secundario} onClick={() => void dadosQ.refetch()}>Tentar de novo</button>} />}
            {(fonteEfetiva === "motor" || documento) && (
              <div className={juntar(superficie.painel, "mx-auto overflow-hidden")} style={{ width: Math.round(a.largura * escala), height: altura }} data-moldura-da-previa={aparelho}>
                <iframe
                  key={`${fonteEfetiva}:${recarga}`}
                  ref={iframe}
                  title={`Prévia do site ${site.nome} no ${a.rotulo.toLowerCase()}`}
                  {...(fonteEfetiva === "motor" ? { src: urlDoMotor || undefined, sandbox: "allow-scripts allow-same-origin allow-forms" } : { srcDoc: documento || undefined, sandbox: "allow-scripts" })}
                  width={a.largura}
                  height={Math.round(altura / escala)}
                  className="block bg-white"
                  style={{ width: a.largura, height: Math.round(altura / escala), transform: `scale(${escala})`, transformOrigin: "0 0", border: 0 }}
                  data-iframe-da-previa={fonteEfetiva}
                />
              </div>
            )}
            {fonteEfetiva === "motor" && semPonte && editando && (
              <p className={juntar(texto.auxiliar, "mt-2 whitespace-normal text-amber-700 dark:text-amber-400")} data-motor-sem-ponte="">
                O site do motor ainda não responde à edição. Edite na prévia rápida: vale igual.
              </p>
            )}
            {fonteEfetiva === "motor" && (
              <p className={juntar(texto.auxiliar, "mt-2 flex min-w-0 flex-wrap items-center")}>
                <span className="mr-2">A edição de conteúdo chega ao site do motor em segundos com o motor ligado.</span>
                <button type="button" className={juntar(botao.discreto, "h-7 px-1.5 text-[12px]")} onClick={() => setRecarga((n) => n + 1)}>
                  Recarregar
                </button>
              </p>
            )}
          </div>
          {!lateralRecolhida && (
            <LateralDaPrevia
              secoes={montada ? montada.secoes : []}
              dados={dadosQ.data || null}
              edicoes={historico ? historico.edicoes : []}
              avisoDoHistorico={historico && historico.aviso ? historico.aviso : null}
              ocupado={ocupado}
              onEditar={(e) => void executar(e)}
              onDesfazer={(id) => void desfazerEdicao(id)}
              onIr={irParaSecao}
              onPedirAjuste={pedirAjuste}
            />
          )}
        </div>
      </div>

      <ConfirmarAjusteDaPrevia
        key={ajuste ? `${ajuste.secao}:${ajuste.origem}:${ajuste.instrucao}` : "sem-ajuste"}
        pedido={ajuste}
        modeloDoSite={site.modelo}
        enviando={enviandoJanela}
        onFechar={() => {
          setAjuste(null);
          refazerPrevia();
        }}
        onConfirmar={async (p) => {
          if (!ajuste) return;
          setEnviandoJanela(true);
          const edicao = ajuste.origem === "pedido" ? { ...ajuste.edicao, instrucao: p.instrucao } : ajuste.edicao;
          // Pedido livre: o servidor põe a seção na frente do texto; texto do código: vai a instrução (revisada) da janela.
          const r = await executar(edicao, { confirmar: true, instrucao: ajuste.origem === "pedido" ? undefined : p.instrucao, teto_usd: p.teto_usd, modelo_id: p.modelo_id || undefined });
          setEnviandoJanela(false);
          if (r) setAjuste(null);
        }}
      />
      <TrocarImagemDaPrevia
        siteId={site.id}
        pedido={trocaDeImagem}
        dados={dadosQ.data || null}
        enviando={enviandoJanela}
        onFechar={() => setTrocaDeImagem(null)}
        onIrParaImagens={onIrPara ? () => onIrPara("imagens") : undefined}
        onEscolher={async (escolha) => {
          if (!trocaDeImagem) return;
          setEnviandoJanela(true);
          const r = await executar({ tipo: "imagem", secao: trocaDeImagem.secao, slot: trocaDeImagem.slot, substitui_id: trocaDeImagem.substitui_id, ...escolha });
          setEnviandoJanela(false);
          if (r) setTrocaDeImagem(null);
        }}
      />
    </Secao>
  );
}
