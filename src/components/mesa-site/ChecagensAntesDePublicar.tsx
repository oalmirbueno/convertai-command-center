import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Crosshair, Info, Loader2, MessageSquarePlus, RefreshCw } from "lucide-react";
import Secao from "@/components/sistema/Secao";
import JanelaCentral from "@/components/sistema/JanelaCentral";
import { botao, etiqueta, juntar, lista, texto } from "@/components/sistema/estilos";
import { rotuloDaSecao } from "../../../supabase/functions/_shared/site-metodo";
import { lerMensagemDaPonte } from "../../../supabase/functions/mesa-site/modulos/ponte-da-previa";
import { checarDocumento, irAteOProblema, juntarChecagens, pedidoDasChecagens, type ProblemaDaChecagem, resumoDasChecagens, ROTULO_DA_CHECAGEM } from "./checagensDoSite";
import { montarPreviaRapida } from "./previaEstatica";
import { usePreviaDados } from "./previaApi";
import type { LinhaDoSite } from "./siteApi";

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
}: {
  site: LinhaDoSite;
  urlDoMotor: string | null;
  onPedirAoDiretor?: (texto: string) => void;
  onResultado?: (r: ResultadoDasChecagens | null) => void;
}) {
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

  const problemas = resultado ? resultado.problemas : [];
  const resumo = resumoDasChecagens(problemas);
  const visiveis = todos ? problemas : problemas.slice(0, 6);
  const descricao = checando
    ? "Checando"
    : !resultado
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
      titulo="Checagens antes de publicar"
      descricao={descricao}
      ajuda="Antes de publicar, a mesa confere a página no celular e no computador, sem IA e sem custo: texto passando da borda ou cortado, link quebrado ou vazio, imagem sem alt (descrição), contraste baixo entre texto e fundo, títulos repetidos e página pesada. Usa o site do motor quando ele responde; senão, a prévia rápida (lá os botões ainda não têm destino de propósito, então o # não conta). Ir até o problema abre a página marcada no ponto. Não trava a publicação: é aviso. Pedir correção ao diretor só preenche o pedido; enviar e o custo continuam com você."
      recolher="mesa-site:publicacao:checagens"
      acao={
        <button type="button" className={botao.icone} aria-label="Checar de novo" title="Checar de novo (sem custo)" disabled={checando || (!montada && !motorPublico)} onClick={() => void checar()} data-checar-de-novo="">
          {checando ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
        </button>
      }
    >
      <div className="min-w-0" data-checagens={resultado ? resumo.total : "pendente"}>
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
          {problemas.length > 0 && onPedirAoDiretor && (
            <button type="button" className={botao.icone} aria-label="Pedir correção ao diretor" title="Pedir correção ao diretor de site (você revisa e confirma o custo)" onClick={() => onPedirAoDiretor(pedidoDasChecagens(problemas))} data-pedir-correcao-checagens="">
              <MessageSquarePlus className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

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
