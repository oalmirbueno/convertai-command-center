import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Crosshair, Info, Loader2, MessageSquarePlus, RefreshCw, Wand2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useMesa } from "@/components/mesa/MesaContexto";
import { useAvisarErro } from "@/components/mesa/Custo";
import Secao from "@/components/sistema/Secao";
import JanelaCentral from "@/components/sistema/JanelaCentral";
import { botao, etiqueta, juntar, lista, texto } from "@/components/sistema/estilos";
import { dataEHora, usd } from "@/lib/mesa/api";
import type { TrabalhoDoMotor } from "../../../supabase/functions/_shared/motor-codigo";
import { rotuloDaSecao } from "../../../supabase/functions/_shared/site-metodo";
import { lerMensagemDaPonte } from "../../../supabase/functions/mesa-site/modulos/ponte-da-previa";
import { APARELHOS_DA_CONFERENCIA, type ConferenciaDoSite, NAO_VERIFICADO, podeCorrigir, ROTULO_DA_CONFERENCIA } from "../../../supabase/functions/mesa-site/modulos/obra-do-site";
import { checarDocumento, irAteOProblema, juntarChecagens, pedidoDasChecagens, type ProblemaDaChecagem, problemasDaConferenciaNaLista, resumoDasChecagens, ROTULO_DA_CHECAGEM } from "./checagensDoSite";
import { montarPreviaRapida } from "./previaEstatica";
import { usePreviaDados } from "./previaApi";
import { CHAVES, chamarMotor, type LinhaDoSite } from "./siteApi";

export type ConferenciaDoMotor = { trabalho: Pick<TrabalhoDoMotor, "id" | "tipo" | "terminado_em" | "criado_em">; conferencia: ConferenciaDoSite };

export type ResultadoDasChecagens = { problemas: ProblemaDaChecagem[]; fonte: "motor" | "rapida"; documento: string; em: string };

const APARELHOS: Array<{ id: "celular" | "computador"; largura: number }> = [
  { id: "celular", largura: 390 },
  { id: "computador", largura: 1280 },
];
const ESCONDIDO = { position: "fixed", left: "-20000px", top: "0", height: "900px", border: "0", visibility: "hidden", pointerEvents: "none" } as const;

/** O HTML que veio do site do motor, para abrir aqui: com a base do túnel e sem script. */
export function comBase(html: string, origem: string): string {
  const semScript = String(html || "").replace(/<script\b[\s\S]*?<\/script\s*>/gi, "");
  const base = `<base href="${origem.replace(/"/g, "")}/">`;
  return /<head[^>]*>/i.test(semScript) ? semScript.replace(/<head[^>]*>/i, (h) => `${h}${base}`) : `${base}${semScript}`;
}

/** Pede o HTML ao site do motor pela ponte (iframe escondido). null = não respondeu no prazo. */
function documentoDoMotor(url: string, prazoMs = 12_000): Promise<string | null> {
  return new Promise((resolver) => {
    let origem = "";
    try {
      origem = new URL(url).origin;
    } catch {
      resolver(null);
      return;
    }
    const f = document.createElement("iframe");
    f.setAttribute("sandbox", "allow-scripts allow-same-origin allow-forms");
    f.setAttribute("aria-hidden", "true");
    f.setAttribute("title", "Checagem do site do motor");
    f.tabIndex = -1;
    Object.assign(f.style, ESCONDIDO, { width: "1280px" });
    let pediu = false;
    let acabou = false;
    const fim = (html: string | null) => {
      if (acabou) return;
      acabou = true;
      window.removeEventListener("message", ouvir);
      window.clearTimeout(prazo);
      f.remove();
      resolver(html);
    };
    const ouvir = (ev: MessageEvent) => {
      if (ev.source !== f.contentWindow) return;
      const m = lerMensagemDaPonte(ev.data);
      if (!m) return;
      if (m.aq === "pronta" && !pediu && f.contentWindow) {
        pediu = true;
        f.contentWindow.postMessage({ aq: "documento" }, origem);
      } else if (m.aq === "documento") fim(m.html ? comBase(m.html, origem) : null);
    };
    window.addEventListener("message", ouvir);
    const prazo = window.setTimeout(() => fim(null), prazoMs);
    f.src = url;
    document.body.appendChild(f);
  });
}

/** Abre o HTML num iframe escondido SEM script (mesma origem só para medir) e checa com o layout de verdade. */
function checarNaLargura(html: string, largura: number, aparelho: "celular" | "computador", ignorarAncoraVazia: boolean): Promise<ProblemaDaChecagem[]> {
  return new Promise((resolver) => {
    const f = document.createElement("iframe");
    f.setAttribute("sandbox", "allow-same-origin");
    f.setAttribute("aria-hidden", "true");
    f.setAttribute("title", "Checagem da página");
    f.tabIndex = -1;
    Object.assign(f.style, ESCONDIDO, { width: `${largura}px` });
    let acabou = false;
    const fim = (l: ProblemaDaChecagem[]) => {
      if (acabou) return;
      acabou = true;
      window.clearTimeout(prazo);
      f.remove();
      resolver(l);
    };
    const medir = () => {
      const doc = f.contentDocument;
      if (!doc) return fim([]);
      const imgs = Array.prototype.slice.call(doc.images) as HTMLImageElement[];
      const esperar = Promise.race([
        Promise.all(imgs.map((i) => (i.complete ? Promise.resolve() : new Promise<void>((r) => { i.addEventListener("load", () => r()); i.addEventListener("error", () => r()); })))),
        new Promise<void>((r) => window.setTimeout(r, 2500)),
      ]);
      void esperar.then(() => {
        try {
          fim(checarDocumento(doc, { bytesDoHtml: new Blob([html]).size, ignorarAncoraVazia, aparelho }));
        } catch {
          fim([]);
        }
      });
    };
    const prazo = window.setTimeout(() => fim([]), 10_000);
    f.addEventListener("load", medir);
    f.srcdoc = html;
    document.body.appendChild(f);
  });
}

/**
 * Checagens automáticas antes de publicar (19/10/2026, aprendido com o
 * Gravyx). Sem IA e sem custo: texto passando da borda ou cortado, link
 * quebrado ou vazio, imagem sem alt, contraste baixo, títulos repetidos e
 * página pesada, no celular e no computador. Checa o site do motor quando ele
 * responde pela ponte; se não, a prévia rápida (que põe "#" nos botões de
 * propósito, então "#" não conta lá). Lista curta, graves primeiro; cada
 * linha tem "Ir até o problema" (janela no centro com a página marcada). Não
 * trava a publicação: a decisão é da equipe.
 */
export default function ChecagensAntesDePublicar({
  site,
  urlDoMotor,
  onPedirAoDiretor,
  onResultado,
  conferenciaDoMotor = null,
  trabalhos = [],
  embutida = false,
}: {
  site: LinhaDoSite;
  urlDoMotor: string | null;
  onPedirAoDiretor?: (texto: string) => void;
  onResultado?: (r: ResultadoDasChecagens | null) => void;
  /** Gravyx: a conferência no navegador que o motor rodou depois do build (computador e celular). */
  conferenciaDoMotor?: ConferenciaDoMotor | null;
  /** Os trabalhos do site (a trava do "corrigir uma vez só" lê a lista). */
  trabalhos?: TrabalhoDoMotor[];
  /** 25/10: parte do bloco único de publicar (subtítulo de nível 3, sem recolher à parte). */
  embutida?: boolean;
}) {
  const { clientId } = useMesa();
  const qc = useQueryClient();
  const avisarErro = useAvisarErro();
  const dadosQ = usePreviaDados(site);
  const montada = useMemo(() => (dadosQ.data ? montarPreviaRapida(site, dadosQ.data, { marcarEstados: false }) : null), [site, dadosQ.data]);
  const motorPublico = !!urlDoMotor && /^https:\/\//.test(urlDoMotor) ? urlDoMotor : null;
  const [checando, setChecando] = useState(false);
  const [resultado, setResultado] = useState<ResultadoDasChecagens | null>(null);
  const [todos, setTodos] = useState(false);
  const [aberto, setAberto] = useState<ProblemaDaChecagem | null>(null);
  const vez = useRef(0);
  const avisar = useRef(onResultado);
  avisar.current = onResultado;

  const checar = useCallback(async () => {
    if (!montada && !motorPublico) return;
    const minha = ++vez.current;
    setChecando(true);
    try {
      let fonte: "motor" | "rapida" = "rapida";
      let html: string | null = null;
      if (motorPublico) {
        html = await documentoDoMotor(motorPublico);
        if (html) fonte = "motor";
      }
      if (!html && montada) html = montada.documento;
      if (!html) return;
      const listas: ProblemaDaChecagem[][] = [];
      for (const a of APARELHOS) listas.push(await checarNaLargura(html, a.largura, a.id, fonte === "rapida"));
      if (minha !== vez.current) return;
      const r: ResultadoDasChecagens = { problemas: juntarChecagens(listas), fonte, documento: html, em: new Date().toISOString() };
      setResultado(r);
      if (avisar.current) avisar.current(r);
    } finally {
      if (minha === vez.current) setChecando(false);
    }
  }, [montada, motorPublico]);

  // Automática: a primeira vez que a página fica pronta para checar (com a prévia rápida pronta como reserva,
  // ou sem ela quando os dados não abriram e o site do motor está no ar).
  const jaChecou = useRef(false);
  const semDados = dadosQ.isError;
  useEffect(() => {
    if (jaChecou.current) return;
    if (!montada && !(motorPublico && semDados)) return;
    jaChecou.current = true;
    void checar();
  }, [montada, motorPublico, semDados, checar]);

  // Gravyx: o que a conferência no navegador do motor achou entra na mesma lista, antes do resto.
  const doMotor = useMemo(() => (conferenciaDoMotor ? problemasDaConferenciaNaLista(conferenciaDoMotor.conferencia.problemas, conferenciaDoMotor.trabalho.id) : []), [conferenciaDoMotor]);
  const problemas = useMemo(() => juntarChecagens([doMotor, resultado ? resultado.problemas : []]), [doMotor, resultado]);
  const resumo = resumoDasChecagens(problemas);
  const correcao = conferenciaDoMotor ? podeCorrigir(trabalhos, conferenciaDoMotor.trabalho.id) : null;
  const [corrigindo, setCorrigindo] = useState(false);
  const [enviandoCorrecao, setEnviandoCorrecao] = useState(false);
  const estimativaDaCorrecao = useQuery({
    queryKey: ["mesa-site", "estimativa-corrigir", clientId, site.modelo || ""],
    enabled: corrigindo,
    queryFn: () => chamarMotor<{ estimativa_usd: number; teto_sugerido_usd: number; livre_usd: number }>("estimar", { client_id: clientId, tipo: "corrigir", modelo_id: site.modelo || undefined }),
  });
  const tetoDaCorrecao = estimativaDaCorrecao.data ? estimativaDaCorrecao.data.teto_sugerido_usd : 0;
  const pedirCorrecao = async () => {
    if (!conferenciaDoMotor) return;
    setEnviandoCorrecao(true);
    try {
      await chamarMotor("pedir", { client_id: clientId, site_id: site.id, tipo: "corrigir", conferencia_de: conferenciaDoMotor.trabalho.id, teto_usd: tetoDaCorrecao, modelo_id: site.modelo || undefined });
      setCorrigindo(false);
      void qc.invalidateQueries({ queryKey: CHAVES.trabalhos(site.id) });
    } catch (e) {
      avisarErro(e, "A correção não entrou na fila");
    } finally {
      setEnviandoCorrecao(false);
    }
  };
  const capa = conferenciaDoMotor ? conferenciaDoMotor.conferencia.capa : null;
  const capaQ = useQuery({
    queryKey: ["mesa-site", "capa", capa ? capa.path : "nenhuma"],
    enabled: !!capa,
    staleTime: 45 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.storage.from(capa!.bucket).createSignedUrl(capa!.path, 3600);
      if (error || !data) throw error || new Error("capa indisponível");
      return data.signedUrl;
    },
  });
  const visiveis = todos ? problemas : problemas.slice(0, 6);
  const descricao = checando
    ? "Checando"
    : !resultado && !doMotor.length
      ? dadosQ.isError
        ? "A página não abriu para checar"
        : "Sem custo de IA"
      : resumo.total
        ? `${resumo.total} ${resumo.total === 1 ? "problema" : "problemas"}${resumo.graves ? ` · ${resumo.graves} ${resumo.graves === 1 ? "grave" : "graves"}` : ""}`
        : "Tudo certo";

  // A janela "Ir até o problema": a cópia da página sem script, marcada no elemento.
  const quadro = useRef<HTMLIFrameElement | null>(null);
  const [achou, setAchou] = useState<boolean | null>(null);
  const marcar = () => {
    const doc = quadro.current ? quadro.current.contentDocument : null;
    setAchou(doc && aberto ? irAteOProblema(doc, aberto.caminho) : false);
  };
  const larguraDoQuadro = aberto && aberto.aparelho === "computador" ? "100%" : aberto && aberto.aparelho === "celular" ? "390px" : "100%";

  return (
    <Secao
      titulo={embutida ? "Checagens" : "Checagens antes de publicar"}
      descricao={descricao}
      nivel={embutida ? 3 : 2}
      ajuda="Antes de publicar, a mesa confere a página no celular e no computador, sem IA e sem custo: texto passando da borda ou cortado, link quebrado ou vazio, imagem sem alt (descrição), contraste baixo entre texto e fundo, títulos repetidos e página pesada. Usa o site do motor quando ele responde; senão, a prévia rápida (lá os botões ainda não têm destino de propósito, então o # não conta). Depois de cada build, o motor também abre o site num navegador de verdade (computador 1440x900 e celular 390x844) e mede erro de execução, imagem quebrada, conteúdo vazando para o lado e texto cortado; problema grave dessa conferência trava o Publicar até a equipe marcar publicar mesmo assim. Corrigir o que a conferência achou manda UMA passada ao motor, com o custo antes; depois dela a conferência roda de novo e o que sobrar é decisão da equipe. Ir até o problema abre a página marcada no ponto. Pedir correção ao diretor só preenche o pedido; enviar e o custo continuam com você."
      recolher={embutida ? false : "mesa-site:publicacao:checagens"}
      acao={
        <button type="button" className={botao.icone} aria-label="Checar de novo" title="Checar de novo (sem custo)" disabled={checando || (!montada && !motorPublico)} onClick={() => void checar()} data-checar-de-novo="">
          {checando ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
        </button>
      }
    >
      <div className="min-w-0" data-checagens={resultado ? resumo.total : "pendente"}>
        {conferenciaDoMotor && (
          <div className="mb-2 flex min-w-0 items-start" data-conferencia-do-motor={conferenciaDoMotor.conferencia.estado} data-graves-do-motor={conferenciaDoMotor.conferencia.graves}>
            {capaQ.data && <img src={capaQ.data} alt="Capa do site (print do computador)" className="mr-3 h-auto w-24 shrink-0 rounded border border-border sm:w-32" loading="lazy" data-capa-do-site="" />}
            <span className="min-w-0 flex-1">
              <span className={juntar(texto.auxiliar, "block whitespace-normal")}>
                {conferenciaDoMotor.conferencia.estado === "pronto"
                  ? `Conferido num navegador de verdade em ${dataEHora(conferenciaDoMotor.conferencia.em || conferenciaDoMotor.trabalho.terminado_em || conferenciaDoMotor.trabalho.criado_em)} · ${APARELHOS_DA_CONFERENCIA.map((a) => `${a.id} ${a.largura}x${a.altura}`).join(" e ")}`
                  : `A conferência no navegador não rodou: ${conferenciaDoMotor.conferencia.motivo || "sem navegador no worker"}`}
              </span>
              {conferenciaDoMotor.conferencia.estado === "pronto" && <span className={juntar(texto.auxiliar, "block whitespace-normal")}>{NAO_VERIFICADO}</span>}
            </span>
          </div>
        )}
        {resultado && (
          <p className={texto.auxiliar}>
            {resultado.fonte === "motor" ? "Checado no site do motor" : motorPublico ? "Checado na prévia rápida (o site do motor não respondeu)" : "Checado na prévia rápida"}
          </p>
        )}
        {resultado && !problemas.length && <p className={texto.corpo}>Nenhum problema nas checagens.</p>}
        <ul className={juntar(lista.aberta, lista.divisoria)}>
          {visiveis.map((p) => (
            <li key={p.id} className={lista.linha} data-problema={p.tipo} data-grave={p.grave ? "sim" : "nao"}>
              {p.grave ? <AlertTriangle className="mr-2 h-4 w-4 shrink-0 text-destructive" aria-label="Grave" /> : <Info className="mr-2 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" aria-label="Aviso" />}
              <span className="min-w-0 flex-1">
                <span className={juntar(texto.corpo, "block whitespace-normal break-words")}>{p.texto}</span>
                <span className={juntar(texto.auxiliar, "block truncate")}>
                  {ROTULO_DA_CHECAGEM[p.tipo]}
                  {p.secao ? ` · ${rotuloDaSecao(p.secao)}` : ""}
                  {p.aparelho ? ` · ${p.aparelho}` : ""}
                </span>
              </span>
              {onPedirAoDiretor && (
                <button type="button" className={juntar(botao.icone, "ml-1")} aria-label="Pedir a correção deste ao diretor" title="Pedir a correção deste ao diretor de site (você revisa e confirma o custo)" onClick={() => onPedirAoDiretor(pedidoDasChecagens([p]))} data-pedir-correcao-do-problema={p.id}>
                  <MessageSquarePlus className="h-4 w-4" />
                </button>
              )}
              {p.caminho && (
                <button type="button" className={juntar(botao.icone, "ml-1")} aria-label="Ir até o problema" title="Ir até o problema" onClick={() => { setAchou(null); setAberto(p); }} data-ir-ate-problema="">
                  <Crosshair className="h-4 w-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
        <div className="flex min-w-0 flex-wrap items-center">
          {problemas.length > 6 && (
            <button type="button" className={juntar(botao.discreto, "mr-2 h-8 px-2 text-[12px]")} onClick={() => setTodos(!todos)}>
              {todos ? "Mostrar só os primeiros" : `Mostrar todos (${problemas.length})`}
            </button>
          )}
          {conferenciaDoMotor && conferenciaDoMotor.conferencia.problemas.length > 0 && (
            <button
              type="button"
              className={juntar(botao.icone, "mr-1")}
              aria-label="Corrigir o que a conferência achou"
              title={correcao && correcao.ok ? "Corrigir o que a conferência achou (uma passada do motor, custo antes)" : (correcao && correcao.motivo) || "Corrigir o que a conferência achou"}
              disabled={!correcao || !correcao.ok}
              onClick={() => setCorrigindo(true)}
              data-corrigir-conferencia=""
            >
              <Wand2 className="h-4 w-4" />
            </button>
          )}
          {problemas.length > 0 && onPedirAoDiretor && (
            <button type="button" className={botao.icone} aria-label="Pedir correção ao diretor" title="Pedir correção ao diretor de site (você revisa e confirma o custo)" onClick={() => onPedirAoDiretor(pedidoDasChecagens(problemas))} data-pedir-correcao-checagens="">
              <MessageSquarePlus className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      <JanelaCentral
        aberta={corrigindo}
        onMudar={(a) => !a && setCorrigindo(false)}
        titulo="Corrigir o que a conferência achou"
        icone={<Wand2 className="h-4 w-4" />}
        descricao={estimativaDaCorrecao.isLoading ? "Estimando" : estimativaDaCorrecao.data ? `estimativa ${usd(estimativaDaCorrecao.data.estimativa_usd)} · teto ${usd(tetoDaCorrecao)} · livre ${usd(estimativaDaCorrecao.data.livre_usd)}` : estimativaDaCorrecao.isError ? "Sem estimativa agora" : undefined}
        ajuda="Uma passada só do motor sobre a lista abaixo, no rascunho. Depois dela o motor compila e confere de novo; o que sobrar não volta para o motor sozinho (sem laço de correção): a equipe decide, pede o ajuste ao diretor ou publica mesmo assim."
        largura="md"
        rodape={
          <>
            <button type="button" className={botao.discreto} onClick={() => setCorrigindo(false)} disabled={enviandoCorrecao}>
              Cancelar
            </button>
            <button
              type="button"
              className={juntar(botao.primario, "ml-2")}
              disabled={enviandoCorrecao || !(tetoDaCorrecao > 0) || !correcao || !correcao.ok || (!!estimativaDaCorrecao.data && tetoDaCorrecao > estimativaDaCorrecao.data.livre_usd)}
              onClick={() => void pedirCorrecao()}
              data-confirmar-correcao=""
            >
              {enviandoCorrecao ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : null}
              Confirmar · teto {usd(tetoDaCorrecao)}
            </button>
          </>
        }
        data-janela-da-correcao=""
      >
        <ul className="min-w-0 space-y-1">
          {(correcao ? correcao.problemas : []).map((p, i) => (
            <li key={i} className={juntar(texto.corpo, "flex min-w-0 whitespace-normal break-words")}>
              {p.grave ? <AlertTriangle className="mr-2 mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-label="Grave" /> : <Info className="mr-2 mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" aria-label="Aviso" />}
              <span className="min-w-0">
                {p.texto}
                <span className={juntar(texto.auxiliar, "block")}>
                  {ROTULO_DA_CONFERENCIA[p.tipo]}
                  {p.secao ? ` · ${rotuloDaSecao(p.secao)}` : ""}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </JanelaCentral>

      <JanelaCentral
        aberta={!!aberto}
        onMudar={(a) => !a && setAberto(null)}
        titulo={aberto ? ROTULO_DA_CHECAGEM[aberto.tipo] : "Problema"}
        icone={<Crosshair className="h-4 w-4" />}
        descricao={aberto ? aberto.texto : undefined}
        largura="xl"
        rodape={
          aberto && onPedirAoDiretor ? (
            <button type="button" className={botao.discreto} onClick={() => { onPedirAoDiretor(pedidoDasChecagens([aberto])); setAberto(null); }}>
              Pedir correção ao diretor
            </button>
          ) : null
        }
        data-janela-do-problema=""
      >
        {aberto && resultado && (
          <div className="min-w-0">
            {achou === false && <p className={juntar(texto.auxiliar, "mb-2")}>O ponto exato não foi achado nesta cópia: a página mudou depois da checagem. Cheque de novo.</p>}
            {aberto.aparelho && <span className={juntar(etiqueta, "mb-2 bg-muted")}>{aberto.aparelho}</span>}
            <div className="mx-auto max-w-full overflow-hidden rounded-md border border-border" style={{ width: larguraDoQuadro }}>
              <iframe ref={quadro} title="Página com o problema marcado" srcDoc={resultado.documento} sandbox="allow-same-origin" onLoad={marcar} className="block w-full bg-white" style={{ height: 600, maxHeight: "70vh", border: 0 }} />
            </div>
          </div>
        )}
      </JanelaCentral>
    </Secao>
  );
}
