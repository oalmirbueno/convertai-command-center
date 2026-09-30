import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Download, Eye, EyeOff, Loader2, Maximize2, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useMarcaDaMesa, useMesa } from "@/components/mesa/MesaContexto";
import { useAvisarErro } from "@/components/mesa/Custo";
import { elementoEmTelaCheia, temTelaCheiaDoNavegador } from "@/components/mesa/TelaCheiaDaMesa";
import Secao from "@/components/sistema/Secao";
import { PreencherComIA } from "@/components/sistema";
import { botao, campoTexto, espaco, foco, juntar, lista, texto } from "@/components/sistema/estilos";
import { useFontesGoogle } from "@/lib/identidade/fontesGoogle";
import { camposDasFalas, prontoParaApresentar, roteiroDaApresentacao, SCRIPT_DA_APRESENTACAO } from "../../../supabase/functions/mesa-identidade/modulos/apresentacao-da-marca";
import { urlDoGoogleFonts } from "../../../supabase/functions/_shared/tipografia-da-marca";
import { ALTURA_DO_SLIDE, imagensDaApresentacao, LARGURA_DO_SLIDE, PalcoDoSlide, SlideDaMarca, type UrlDaImagem } from "./ApresentacaoDaMarca";
import { CabecalhoDaEtapa, contextoParaPreencher, Pastilha, useProjetoDaMesa } from "./Comuns";
import { salvarArquivo } from "./exportarNoNavegador";
import VideoDaMarca from "./VideoDaMarca";

/** Separa "bucket::caminho" (acervo em outro bucket) do caminho do bucket mesa. */
function partes(chave: string): { bucket: string; caminho: string } | null {
  if (/^https:\/\//i.test(chave)) return null;
  const i = chave.indexOf("::");
  return i > 0 ? { bucket: chave.slice(0, i), caminho: chave.slice(i + 2) } : { bucket: "mesa", caminho: chave };
}

/** URLs assinadas (1 hora) das imagens da apresentação, por bucket. */
function useUrlsDaApresentacao(chaves: string[]) {
  return useQuery({
    queryKey: ["mesa-identidade", "urls-da-apresentacao", chaves.slice().sort().join("|")],
    enabled: chaves.length > 0,
    staleTime: 45 * 60_000,
    queryFn: async (): Promise<Record<string, string>> => {
      const mapa: Record<string, string> = {};
      const porBucket: Record<string, string[]> = {};
      for (const c of chaves) {
        const p = partes(c);
        if (!p) mapa[c] = c;
        else (porBucket[p.bucket] = porBucket[p.bucket] || []).push(p.caminho);
      }
      for (const bucket of Object.keys(porBucket)) {
        const { data } = await supabase.storage.from(bucket).createSignedUrls(porBucket[bucket], 3600);
        (data || []).forEach((d: { path: string | null; signedUrl: string }) => {
          if (d.path && d.signedUrl) mapa[bucket === "mesa" ? d.path : `${bucket}::${d.path}`] = d.signedUrl;
        });
      }
      return mapa;
    },
  });
}

/** Baixa a imagem e devolve o data URL (a página exportada abre sem login). */
async function dataUrl(chave: string): Promise<string | null> {
  const p = partes(chave);
  if (!p) return chave;
  const { data, error } = await supabase.storage.from(p.bucket).download(p.caminho);
  if (error || !data || data.size > 3_000_000) return null;
  return await new Promise<string | null>((resolver) => {
    const leitor = new FileReader();
    leitor.onload = () => resolver(typeof leitor.result === "string" ? leitor.result : null);
    leitor.onerror = () => resolver(null);
    leitor.readAsDataURL(data);
  });
}

/** Teclas da apresentação: as mesmas da página exportada. */
const TECLAS_DE_AVANCAR = ["ArrowRight", " ", "Spacebar", "PageDown"];
const TECLAS_DE_VOLTAR = ["ArrowLeft", "PageUp"];

/**
 * "Apresentar" (UXS 30/09, IDV-15): uma camada do tamanho da janela, com o
 * slide inteiro (cabe pela largura e pela altura) no meio. Toque ou clique na
 * metade direita avança; na esquerda, volta. Teclas como na página exportada;
 * Esc fecha. Onde o navegador tem tela cheia (e ela ainda não está ligada), a
 * camada pede a tela cheia; no iPhone fica só a camada, com o Fechar sempre à
 * vista. O contador aparece a cada troca e some em 2 s.
 */
function CamadaDaApresentacao({ total, atual, onIr, onFechar, children }: { total: number; atual: number; onIr: (n: number) => void; onFechar: () => void; children: ReactNode }) {
  const camada = useRef<HTMLDivElement | null>(null);
  const fechar = useRef<HTMLButtonElement | null>(null);
  const [escala, setEscala] = useState(0.25);
  const [contador, setContador] = useState(true);
  const pedimos = useRef(false);
  const atualRef = useRef(atual);
  atualRef.current = atual;
  const irRef = useRef(onIr);
  irRef.current = onIr;
  const fecharRef = useRef(onFechar);
  fecharRef.current = onFechar;

  // Cabe pela largura E pela altura (iPhone deitado, tela 21:9).
  useEffect(() => {
    const medir = () => setEscala(Math.max(0.05, Math.min(window.innerWidth / LARGURA_DO_SLIDE, window.innerHeight / ALTURA_DO_SLIDE)));
    medir();
    window.addEventListener("resize", medir);
    return () => window.removeEventListener("resize", medir);
  }, []);

  // O contador reaparece a cada troca e some em 2 s.
  useEffect(() => {
    setContador(true);
    const t = window.setTimeout(() => setContador(false), 2000);
    return () => window.clearTimeout(t);
  }, [atual]);

  // Foco na camada, teclas no documento, tela cheia do navegador quando dá.
  useEffect(() => {
    const el = camada.current;
    if (el) el.focus();
    const tecla = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "Esc") {
        // O Esc é da camada: a tela cheia da mesa não sai junto.
        e.preventDefault();
        e.stopPropagation();
        fecharRef.current();
        return;
      }
      if (e.target === fechar.current && (e.key === " " || e.key === "Enter")) return;
      if (TECLAS_DE_AVANCAR.indexOf(e.key) >= 0) {
        e.preventDefault();
        irRef.current(atualRef.current + 1);
      } else if (TECLAS_DE_VOLTAR.indexOf(e.key) >= 0) {
        e.preventDefault();
        irRef.current(atualRef.current - 1);
      }
    };
    const mudou = () => {
      // Saiu da tela cheia pelo navegador (Esc dele): fecha a camada também.
      if (pedimos.current && !elementoEmTelaCheia()) {
        pedimos.current = false;
        fecharRef.current();
      }
    };
    document.addEventListener("keydown", tecla);
    document.addEventListener("fullscreenchange", mudou);
    document.addEventListener("webkitfullscreenchange", mudou);
    if (el && temTelaCheiaDoNavegador() && !elementoEmTelaCheia()) {
      const alvo = el as HTMLDivElement & { webkitRequestFullscreen?: () => void };
      try {
        const r = typeof alvo.requestFullscreen === "function" ? alvo.requestFullscreen() : alvo.webkitRequestFullscreen ? (alvo.webkitRequestFullscreen() as unknown as Promise<void> | undefined) : undefined;
        pedimos.current = true;
        if (r && typeof (r as Promise<void>).catch === "function") {
          (r as Promise<void>).catch(() => {
            // Recusado: fica só a camada (sem aviso).
            pedimos.current = false;
          });
        }
      } catch {
        pedimos.current = false;
      }
    }
    return () => {
      document.removeEventListener("keydown", tecla);
      document.removeEventListener("fullscreenchange", mudou);
      document.removeEventListener("webkitfullscreenchange", mudou);
      if (pedimos.current && elementoEmTelaCheia()) {
        pedimos.current = false;
        const d = document as Document & { webkitExitFullscreen?: () => void };
        try {
          const r = typeof d.exitFullscreen === "function" ? d.exitFullscreen() : d.webkitExitFullscreen ? (d.webkitExitFullscreen() as unknown as Promise<void> | undefined) : undefined;
          if (r && typeof (r as Promise<void>).catch === "function") (r as Promise<void>).catch(() => undefined);
        } catch {
          /* já saiu */
        }
      }
    };
  }, []);

  return createPortal(
    <div
      ref={camada}
      role="dialog"
      aria-modal="true"
      aria-label="Apresentação da marca"
      tabIndex={-1}
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black outline-none"
      data-tela-cheia="sim"
      data-camada-da-apresentacao=""
      onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        if (e.clientX - r.left >= r.width / 2) onIr(atual + 1);
        else onIr(atual - 1);
      }}
    >
      <div className="relative overflow-hidden" style={{ width: LARGURA_DO_SLIDE * escala, height: ALTURA_DO_SLIDE * escala }}>
        <div style={{ position: "absolute", top: 0, left: 0, width: LARGURA_DO_SLIDE, height: ALTURA_DO_SLIDE, transform: `scale(${escala})`, transformOrigin: "0 0" }}>{children}</div>
      </div>
      <span className={juntar(texto.etiqueta, "pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded bg-black/60 px-2 py-0.5 tabular-nums text-white transition-opacity", contador ? "opacity-80" : "opacity-0")} aria-live="polite" data-contador-da-apresentacao="">
        {atual + 1} / {total}
      </span>
      <button
        ref={fechar}
        type="button"
        className={juntar("toque-compacto absolute right-3 top-3 inline-flex h-9 w-9 items-center justify-center rounded-md text-white/60 transition-colors hover:bg-white/10 hover:text-white", foco)}
        aria-label="Fechar a apresentação"
        onClick={(e) => {
          e.stopPropagation();
          onFechar();
        }}
        data-fechar-apresentacao=""
      >
        <X className="h-5 w-5" />
      </button>
    </div>,
    document.body,
  );
}

/**
 * Etapa Apresentação (IDV2): a sequência para apresentar a marca ao cliente,
 * do problema à revelação e às aplicações. Cada slide diz o que falta e tem a
 * fala do apresentador (escrita pela equipe ou pelo "Preencher com IA").
 * Apresenta em tela cheia e exporta uma página web que abre sem login.
 */
export default function EtapaApresentacao() {
  const mesa = useMesa();
  const { marca } = useMarcaDaMesa();
  const { projeto, salvarParte } = useProjetoDaMesa();
  const avisarErro = useAvisarErro();
  const d = projeto.dados || {};
  const comNaming = projeto.modo === "zero" || projeto.com_naming;
  // Marca existente (IDV3): sem caminhos criativos, o slide do conceito usa o significado da logo.
  const semCaminhos = projeto.modo === "completar";
  const roteiro = useMemo(() => roteiroDaApresentacao(d, { comNaming, semCaminhos }), [JSON.stringify(d), comNaming, semCaminhos]);
  const incluidos = roteiro.filter((s) => s.incluido);
  const pronto = prontoParaApresentar(roteiro);
  const nome = String((d.naming && d.naming.nome) || (marca && !marca.principal ? marca.nome : mesa.clientName) || "Marca");
  const chaves = useMemo(() => imagensDaApresentacao(d), [JSON.stringify(d)]);
  const urls = useUrlsDaApresentacao(chaves);
  const urlDe: UrlDaImagem = (c) => (c ? (urls.data && urls.data[c]) || (/^https:\/\//i.test(c) ? c : null) : null);
  const tipos = Array.isArray(d.sistema && d.sistema.tipografia) ? (d.sistema.tipografia as Array<{ familia: string }>) : [];
  useFontesGoogle(tipos.map((t) => ({ familia: t.familia, pesos: [400, 700] })), tipos.length > 0);
  const [atual, setAtual] = useState(0);
  const [exportando, setExportando] = useState(false);
  const [apresentando, setApresentando] = useState(false);
  const palco = useRef<HTMLDivElement | null>(null);
  const botaoApresentar = useRef<HTMLButtonElement | null>(null);
  const ap = (d.apresentacao || {}) as { falas?: Record<string, string>; tirados?: string[] };
  const slide = incluidos[Math.min(atual, Math.max(0, incluidos.length - 1))];

  const salvarFalas = async (falas: Record<string, string>) => {
    try {
      await salvarParte("apresentacao", { falas: { ...(ap.falas || {}), ...falas } });
    } catch (e) {
      avisarErro(e, "A fala não foi salva");
      throw e;
    }
  };
  const alternar = async (id: string, incluir: boolean) => {
    const tirados = (ap.tirados || []).filter((x) => x !== id).concat(incluir ? [] : [id]);
    try {
      await salvarParte("apresentacao", { tirados });
    } catch (e) {
      avisarErro(e, "O roteiro não foi salvo");
    }
  };

  const irParaSlide = (n: number) => setAtual(Math.max(0, Math.min(incluidos.length - 1, n)));
  const fecharApresentacao = () => {
    setApresentando(false);
    // O foco volta para quem abriu; o slide atual fica.
    window.setTimeout(() => {
      if (botaoApresentar.current) botaoApresentar.current.focus();
    }, 0);
  };

  const exportar = async () => {
    setExportando(true);
    try {
      const [{ renderToStaticMarkup }, { createElement }] = await Promise.all([import("react-dom/server"), import("react")]);
      const mapa: Record<string, string> = {};
      let fora = 0;
      for (const c of chaves) {
        const u = await dataUrl(c);
        if (u) mapa[c] = u;
        else fora += 1;
      }
      const deExportacao: UrlDaImagem = (c) => (c ? mapa[c] || null : null);
      const corpo = incluidos
        .map((s) => `<section data-slide style="display:none"><div data-palco>${renderToStaticMarkup(createElement(SlideDaMarca, { id: s.id, n: s.n, dados: d, nome, urlDe: deExportacao }))}</div></section>`)
        .join("");
      const fontes = urlDoGoogleFonts(tipos.map((t) => ({ familia: t.familia, pesos: [400, 700] })));
      const escalar = "(function(){function e(){var s=Math.min(window.innerWidth/1280,window.innerHeight/720);var p=document.querySelectorAll('[data-palco]');for(var i=0;i<p.length;i++){p[i].style.transform='scale('+s+')';}}window.addEventListener('resize',e);e();})();";
      const esc = (x: string) => x.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(nome)}: apresentação da marca</title>${fontes ? `<link rel="stylesheet" href="${fontes}">` : ""}<style>html,body{margin:0;height:100%;background:#0E1210;overflow:hidden}[data-slide]{width:100vw;height:100vh;align-items:center;justify-content:center}[data-palco]{width:1280px;height:720px;flex-shrink:0;transform-origin:center center}nav{position:fixed;right:16px;bottom:12px;font:13px Helvetica,Arial,sans-serif;color:#fff;opacity:.7}nav button{background:none;border:1px solid #fff5;color:#fff;border-radius:6px;padding:4px 10px;margin-left:6px;cursor:pointer}</style></head><body>${corpo}<nav><span id="contador"></span><button data-ir="-1" aria-label="Anterior">&lt;</button><button data-ir="1" aria-label="Próximo">&gt;</button></nav><script>${SCRIPT_DA_APRESENTACAO}${escalar}</script></body></html>`;
      salvarArquivo(new Blob([html], { type: "text/html" }), `apresentacao-${nome.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "marca"}.html`, "text/html");
      if (fora) toast.warning(`${fora} imagem(ns) ficaram fora (grandes demais ou indisponíveis).`);
    } catch (e) {
      avisarErro(e, "A página não foi exportada");
    } finally {
      setExportando(false);
    }
  };

  return (
    <div className={espaco.pagina} data-etapa-apresentacao="">
      <CabecalhoDaEtapa
        etapa="apresentacao"
        ajuda="A ordem que um diretor de branding usa: primeiro o desafio e a estratégia (o cliente se reconhece), depois o nome, o conceito, a revelação da logo, o sistema e a marca no mundo. Slide opcional sem conteúdo sai sozinho; tire ou volte qualquer um. A página exportada abre sem login e passa com as setas."
        acoes={
          <>
            <PreencherComIA
              papel="identidade"
              clientId={mesa.clientId}
              marcaId={projeto.marca_id || (marca && !marca.principal ? marca.id : null)}
              campos={camposDasFalas(roteiro)}
              rotulo="Escrever as falas"
              contexto={contextoParaPreencher(projeto, `Slides: ${incluidos.map((s) => s.titulo).join(", ")}.`)}
              onAplicar={async (v) => {
                const falas: Record<string, string> = {};
                for (const k of Object.keys(v)) falas[k.replace(/^falas\./, "")] = String(v[k] || "");
                await salvarFalas(falas);
              }}
              onDesfazer={async (a) => {
                const falas: Record<string, string> = {};
                for (const k of Object.keys(a)) falas[k.replace(/^falas\./, "")] = String(a[k] || "");
                await salvarFalas(falas);
              }}
            />
            <button type="button" className={juntar(botao.secundario, "m-1 h-8")} onClick={() => void exportar()} disabled={exportando || !incluidos.length}>
              {exportando ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Download className="mr-1.5 h-3.5 w-3.5" />} Baixar página web
            </button>
          </>
        }
      />
      {!pronto.pronto && <p className={juntar(texto.auxiliar, "text-warning")}>Falta: {pronto.faltas.slice(0, 5).join(", ")}{pronto.faltas.length > 5 ? "..." : ""}</p>}

      {slide && (
        <Secao
          titulo={`${slide.n}. ${slide.titulo}`}
          descricao={`${incluidos.length} slides`}
          recolher={false}
          acao={
            <>
              <button type="button" className={botao.icone} aria-label="Slide anterior" disabled={atual <= 0} onClick={() => setAtual(Math.max(0, atual - 1))}>
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button type="button" className={botao.icone} aria-label="Próximo slide" disabled={atual >= incluidos.length - 1} onClick={() => setAtual(Math.min(incluidos.length - 1, atual + 1))}>
                <ChevronRight className="h-4 w-4" />
              </button>
              <button ref={botaoApresentar} type="button" className={juntar(botao.discreto, "m-1 h-8")} onClick={() => setApresentando(true)} data-apresentar="">
                <Maximize2 className="mr-1.5 h-3.5 w-3.5" /> Apresentar
              </button>
            </>
          }
        >
          <div ref={palco} className="min-w-0 bg-black" onKeyDown={(e) => { if (e.key === "ArrowRight") setAtual(Math.min(incluidos.length - 1, atual + 1)); if (e.key === "ArrowLeft") setAtual(Math.max(0, atual - 1)); }} tabIndex={0} aria-label="Palco da apresentação" data-palco-da-apresentacao={slide.id}>
            <PalcoDoSlide>
              <SlideDaMarca id={slide.id} n={slide.n} dados={d} nome={nome} urlDe={urlDe} />
            </PalcoDoSlide>
          </div>
          {slide.fala && <p className={juntar(texto.auxiliar, "mt-2 whitespace-pre-line")}>Fala: {slide.fala}</p>}
        </Secao>
      )}
      {apresentando && slide && (
        <CamadaDaApresentacao total={incluidos.length} atual={Math.min(atual, Math.max(0, incluidos.length - 1))} onIr={irParaSlide} onFechar={fecharApresentacao}>
          <SlideDaMarca id={slide.id} n={slide.n} dados={d} nome={nome} urlDe={urlDe} />
        </CamadaDaApresentacao>
      )}

      <Secao titulo="Roteiro" divisoria descricao={`${incluidos.length} de ${roteiro.length} slides`} recolher={`mesa-identidade:${projeto.id}:apresentacao:roteiro`}>
        <ul className={juntar(lista.aberta, lista.divisoria)} aria-label="Slides da apresentação">
          {roteiro.map((s) => (
            <li key={s.id} className={juntar(lista.linha, "flex-wrap items-start", !s.incluido && "opacity-60")} data-slide-do-roteiro={s.id}>
              <button type="button" className={juntar(texto.etiqueta, "mr-3 mt-1 w-6 shrink-0 text-left tabular-nums text-muted-foreground")} disabled={!s.incluido} onClick={() => setAtual(Math.max(0, incluidos.indexOf(s)))} aria-label={`Ver o slide ${s.titulo}`}>
                {s.incluido ? (s.n < 10 ? `0${s.n}` : s.n) : "--"}
              </button>
              <span className="min-w-0 flex-1">
                <span className="flex min-w-0 flex-wrap items-center">
                  <span className={juntar(texto.corpo, "mr-2 font-medium")}>{s.titulo}</span>
                  {s.falta.length > 0 ? <Pastilha tom="alerta">falta {s.falta[0]}</Pastilha> : <Pastilha tom="bom">pronto</Pastilha>}
                </span>
                {s.incluido && (
                  <textarea
                    className={juntar(campoTexto, "mt-2 min-h-[56px]")}
                    defaultValue={s.fala}
                    key={`${s.id}-${s.fala.length}`}
                    maxLength={1500}
                    placeholder="O que falar neste slide"
                    aria-label={`Fala do slide ${s.titulo}`}
                    onBlur={(e) => {
                      if (e.target.value !== s.fala) void salvarFalas({ [s.id]: e.target.value.slice(0, 1500) }).catch(() => undefined);
                    }}
                  />
                )}
              </span>
              <button type="button" className={botao.icone} aria-label={s.incluido ? `Tirar ${s.titulo} da apresentação` : `Voltar ${s.titulo} à apresentação`} onClick={() => void alternar(s.id, !s.incluido)}>
                {s.incluido ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </li>
          ))}
        </ul>
      </Secao>

      <VideoDaMarca titulo="Apresentação em vídeo" />
    </div>
  );
}
