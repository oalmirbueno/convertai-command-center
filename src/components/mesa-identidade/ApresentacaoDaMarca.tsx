import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ARQUETIPOS, EIXOS_DE_PERSONALIDADE, normalizarEstrategia, rotuloDoArquetipo } from "../../../supabase/functions/_shared/estrategia-de-marca";
import { coresDaPeca } from "../../../supabase/functions/_shared/aplicacoes-da-marca";
import { normalizarHex, textoSobre } from "../../../supabase/functions/_shared/cores-da-marca";
import { hierarquiaDoPar, pilhaDaFonte } from "../../../supabase/functions/_shared/tipografia-da-marca";
import type { SlideId } from "../../../supabase/functions/_shared/apresentacao-da-marca";

/**
 * Os slides da apresentação da marca (IDV2), em 1280 x 720 com estilo na
 * linha: é DOCUMENTO (a cara vem da marca), não interface. A tela escala o
 * palco para caber; a página exportada escala pela janela.
 */

export const LARGURA_DO_SLIDE = 1280;
export const ALTURA_DO_SLIDE = 720;

/** Resolve uma imagem guardada: caminho do bucket mesa, "bucket::caminho" ou https. */
export type UrlDaImagem = (chave: string | null | undefined) => string | null;

type Obj = Record<string, any>;
const arr = (v: unknown): any[] => (Array.isArray(v) ? v : []);

/** A chave de imagem de um quadro do moodboard (bucket e caminho, ou a url da web). */
export function chaveDoQuadro(m: Obj): string | null {
  if (m && typeof m.url === "string" && m.url) return m.url;
  if (m && m.imagem && typeof m.imagem.caminho === "string") return m.imagem.bucket && m.imagem.bucket !== "mesa" ? `${m.imagem.bucket}::${m.imagem.caminho}` : m.imagem.caminho;
  return null;
}

/** Todas as imagens que a apresentação usa (para assinar na tela ou virar data URL na exportação). */
export function imagensDaApresentacao(dados: Obj): string[] {
  const s = (dados.sistema || {}) as Obj;
  const l = s.logos || {};
  const lista: Array<string | null> = [];
  const logo = (x: Obj | null | undefined) => (x ? x.previa_png || x.caminho || null : null);
  lista.push(logo(l.principal), logo(l.secundario));
  arr(l.alternativas).forEach((x) => lista.push(logo(x)));
  arr(l.icone).forEach((x) => lista.push(logo(x)));
  arr((dados.pesquisa || {}).moodboard).slice(0, 6).forEach((m) => lista.push(chaveDoQuadro(m)));
  const c = dados.conceito || {};
  const escolhido = arr(c.caminhos).filter((x) => x.id === c.escolhido)[0];
  if (escolhido && escolhido.imagem) lista.push(escolhido.imagem);
  arr(s.grafismos).slice(0, 4).forEach((g) => lista.push(g.imagem || null));
  arr(dados.mockups).slice(0, 4).forEach((m) => lista.push(m.imagem || null));
  arr((dados.aplicacoes || {}).itens).slice(0, 4).forEach((a) => lista.push(a.imagem || null));
  return lista.filter((x, i, t): x is string => !!x && !/\.svg$/i.test(x) && t.indexOf(x) === i);
}

function Imagem({ chave, urlDe, estilo, cobrir = false, alt }: { chave: string | null | undefined; urlDe: UrlDaImagem; estilo?: CSSProperties; cobrir?: boolean; alt: string }) {
  const url = urlDe(chave);
  return (
    <div style={{ overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center", ...estilo }}>
      {url ? <img src={url} alt={alt} style={{ width: cobrir ? "100%" : undefined, height: cobrir ? "100%" : undefined, maxWidth: "100%", maxHeight: "100%", objectFit: cobrir ? "cover" : "contain" }} /> : null}
    </div>
  );
}

/** O slide (1280 x 720). */
export function SlideDaMarca({ id, n, dados, nome, urlDe }: { id: SlideId; n: number; dados: Obj; nome: string; urlDe: UrlDaImagem }) {
  const s = (dados.sistema || {}) as Obj;
  const b = (dados.briefing || {}) as Obj;
  const e = normalizarEstrategia(dados.estrategia);
  const cores = arr(s.cores).filter((c) => normalizarHex(c.hex));
  const t = coresDaPeca(cores);
  const tipos = arr(s.tipografia);
  const fTitulo = (tipos.filter((x) => x.uso === "titulo")[0] || tipos[0] || { familia: "" }).familia;
  const fTexto = (tipos.filter((x) => x.uso === "texto")[0] || { familia: fTitulo }).familia;
  const pT = pilhaDaFonte(fTitulo || "Helvetica");
  const pX = pilhaDaFonte(fTexto || fTitulo || "Helvetica");
  const logos = s.logos || {};
  const logo = logos.principal ? logos.principal.previa_png || logos.principal.caminho : null;
  const naming = (dados.naming || {}) as Obj;
  const conceito = (dados.conceito || {}) as Obj;
  const caminho = arr(conceito.caminhos).filter((x) => x.id === conceito.escolhido)[0] || null;
  const pesquisa = (dados.pesquisa || {}) as Obj;
  const escuro = id === "abertura" || id === "revelacao" || id === "nome" || id === "proximos";
  const fundo = id === "revelacao" ? t.clara : escuro ? t.escura : "#FFFFFF";
  const tinta = textoSobre(fundo);
  const acento = escuro ? (t.destaque !== t.escura ? t.destaque : "#FFFFFF") : t.primaria;
  const titulo = (txt: string, tam = 44): ReactNode => <div style={{ fontFamily: pT, fontSize: tam, fontWeight: 700, lineHeight: 1.1, color: tinta }}>{txt}</div>;
  const rotulo = (txt: string): ReactNode => <div style={{ fontFamily: pX, fontSize: 15, fontWeight: 700, letterSpacing: 1.5, color: acento, marginBottom: 10 }}>{txt}</div>;
  const corpo = (txt: string, tam = 22): ReactNode => (txt ? <div style={{ fontFamily: pX, fontSize: tam, lineHeight: 1.45, color: tinta, opacity: 0.88, whiteSpace: "pre-line" }}>{txt}</div> : <div style={{ fontFamily: pX, fontSize: 18, color: tinta, opacity: 0.45 }}>A preencher</div>);
  const itens = (l: string[], tam = 20): ReactNode => (
    <div>
      {l.slice(0, 6).map((x) => (
        <div key={x} style={{ fontFamily: pX, fontSize: tam, lineHeight: 1.4, color: tinta, marginBottom: 8, display: "flex" }}>
          <span style={{ width: 10, height: 10, borderRadius: 5, background: acento, marginTop: tam * 0.45, marginRight: 14, flexShrink: 0 }} />
          <span>{x}</span>
        </div>
      ))}
    </div>
  );
  const duas = (a: ReactNode, c: ReactNode): ReactNode => (
    <div style={{ display: "flex", width: "100%" }}>
      <div style={{ flex: 1, paddingRight: 36 }}>{a}</div>
      <div style={{ flex: 1 }}>{c}</div>
    </div>
  );
  const chips = (l: string[]): ReactNode => (
    <div style={{ display: "flex", flexWrap: "wrap" }}>
      {l.slice(0, 10).map((x) => (
        <span key={x} style={{ fontFamily: pX, fontSize: 22, padding: "8px 18px", borderRadius: 999, border: `2px solid ${acento}`, color: tinta, margin: "0 12px 12px 0" }}>
          {x}
        </span>
      ))}
    </div>
  );
  const grade = (chaves: Array<string | null>, alt: string, cobrir = true): ReactNode => (
    <div style={{ display: "flex", flexWrap: "wrap", margin: -8 }}>
      {chaves.slice(0, 6).map((c, i) => (
        <Imagem key={`${c}-${i}`} chave={c} urlDe={urlDe} cobrir={cobrir} alt={alt} estilo={{ width: chaves.length <= 2 ? 520 : chaves.length <= 4 ? 520 : 344, height: chaves.length <= 3 ? 420 : 200, margin: 8, borderRadius: 10, background: "#F0F2F0" }} />
      ))}
    </div>
  );
  let conteudo: ReactNode = null;
  switch (id) {
    case "abertura":
      conteudo = (
        <div style={{ textAlign: "center", width: "100%" }}>
          {logo ? <Imagem chave={logo} urlDe={urlDe} alt={nome} estilo={{ height: 220, marginBottom: 36 }} /> : titulo(nome, 88)}
          <div style={{ fontFamily: pX, fontSize: 26, color: tinta, opacity: 0.8 }}>Apresentação da identidade</div>
        </div>
      );
      break;
    case "desafio":
      conteudo = duas(<>{rotulo("O DESAFIO")}{titulo(String(b.objetivo || "O que precisamos resolver"), 48)}</>, corpo(String(b.negocio || "")));
      break;
    case "ouvimos":
      conteudo = <>{rotulo("O QUE OUVIMOS")}{titulo("A marca em palavras", 44)}<div style={{ height: 28 }} />{chips(arr(b.personalidade).length ? arr(b.personalidade).map(String) : String(b.personalidade || "").split(/[,;]+/).map((x) => x.trim()).filter(Boolean))}<div style={{ height: 16 }} />{corpo(String(b.publico || ""), 20)}</>;
      break;
    case "mercado":
      conteudo = duas(<>{rotulo("O MERCADO")}{corpo(String(pesquisa.resumo || (pesquisa.ia && pesquisa.ia.resumo) || ""), 22)}</>, itens(arr(pesquisa.ia && pesquisa.ia.concorrentes).map((c) => `${c.nome}: ${c.comunica}`), 18));
      break;
    case "moodboard":
      conteudo = <>{rotulo("REFERÊNCIAS")}{grade(arr(pesquisa.moodboard).map(chaveDoQuadro), "Referência")}</>;
      break;
    case "plataforma":
      conteudo = (
        <>
          {rotulo("PROPÓSITO")}
          {titulo(e.proposito || "A preencher", 40)}
          <div style={{ height: 36 }} />
          {duas(<>{rotulo("MISSÃO")}{corpo(e.missao, 19)}</>, <>{rotulo("VALORES")}{itens(e.valores.map((v) => v.nome), 19)}</>)}
        </>
      );
      break;
    case "arquetipo": {
      const a = ARQUETIPOS.filter((x) => x.valor === e.arquetipo.principal)[0];
      conteudo = duas(
        <>
          {rotulo("ARQUÉTIPO")}
          {titulo(a ? a.rotulo : "A escolher", 64)}
          {e.arquetipo.secundario && <div style={{ fontFamily: pX, fontSize: 22, color: tinta, opacity: 0.7, marginTop: 8 }}>com {rotuloDoArquetipo(e.arquetipo.secundario)}</div>}
          <div style={{ height: 20 }} />
          {corpo(e.arquetipo.justificativa || (a ? a.desejo : ""), 19)}
        </>,
        <>
          {rotulo("PERSONALIDADE")}
          {EIXOS_DE_PERSONALIDADE.map((x) => {
            const v = e.personalidade.eixos[x.valor];
            return (
              <div key={x.valor} style={{ display: "flex", alignItems: "center", fontFamily: pX, fontSize: 16, color: tinta, marginBottom: 14 }}>
                <span style={{ width: 120, textAlign: "right", marginRight: 12 }}>{x.esquerda}</span>
                <span style={{ flex: 1, height: 6, borderRadius: 3, background: "#E3E7E3", position: "relative" }}>
                  <span style={{ position: "absolute", top: -7, left: `calc(${((v + 2) / 4) * 100}% - 10px)`, width: 20, height: 20, borderRadius: 10, background: acento }} />
                </span>
                <span style={{ width: 120, marginLeft: 12 }}>{x.direita}</span>
              </div>
            );
          })}
        </>,
      );
      break;
    }
    case "posicionamento":
      conteudo = <>{rotulo("POSICIONAMENTO")}{titulo(e.posicionamento.declaracao || e.posicionamento.diferencial || "A preencher", 42)}<div style={{ height: 32 }} />{e.proposta_de_valor.promessa ? <>{rotulo("PROMESSA")}{corpo(e.proposta_de_valor.promessa, 24)}</> : null}</>;
      break;
    case "persona": {
      const p = e.publico.persona;
      conteudo = duas(
        <>
          {rotulo("PARA QUEM FALAMOS")}
          {titulo(p.nome || "Persona", 52)}
          <div style={{ fontFamily: pX, fontSize: 20, color: tinta, opacity: 0.75, marginTop: 8 }}>{[p.idade, p.ocupacao].filter(Boolean).join(" · ")}</div>
          <div style={{ height: 20 }} />
          {corpo(p.frase ? `"${p.frase}"` : e.publico.resumo, 20)}
        </>,
        <>{rotulo("DORES E DESEJOS")}{itens(p.dores.concat(p.desejos), 18)}</>,
      );
      break;
    }
    case "tom":
      conteudo = <>{rotulo("TOM DE VOZ")}{titulo(e.tom.atributos.join(", ") || "Como a marca fala", 40)}<div style={{ height: 28 }} />{duas(<>{rotulo("FALA ASSIM")}{itens(e.tom.fala_assim, 19)}</>, <>{rotulo("NÃO FALA ASSIM")}{itens(e.tom.nao_fala_assim, 19)}</>)}</>;
      break;
    case "nome":
      conteudo = (
        <div style={{ textAlign: "center", width: "100%" }}>
          {rotulo("O NOME")}
          {titulo(String(naming.nome || nome), 120)}
          {naming.slogan && <div style={{ fontFamily: pX, fontSize: 30, color: tinta, opacity: 0.8, marginTop: 20 }}>{String(naming.slogan)}</div>}
        </div>
      );
      break;
    case "conceito":
      conteudo = duas(
        <>
          {rotulo("O CONCEITO")}
          {titulo(caminho ? String(caminho.nome) : "A escolher", 52)}
          <div style={{ height: 20 }} />
          {corpo(caminho ? String(caminho.ideia || "") : "", 20)}
          <div style={{ height: 20 }} />
          {caminho ? chips(arr(caminho.palavras).map(String)) : null}
        </>,
        caminho && caminho.imagem ? <Imagem chave={caminho.imagem} urlDe={urlDe} cobrir alt="Inspiração do conceito" estilo={{ height: 460, borderRadius: 12 }} /> : null,
      );
      break;
    case "revelacao":
      conteudo = <div style={{ width: "100%" }}>{logo ? <Imagem chave={logo} urlDe={urlDe} alt={nome} estilo={{ height: 420 }} /> : titulo(nome, 110)}</div>;
      break;
    case "variacoes": {
      const lista = [logos.secundario].concat(arr(logos.alternativas), arr(logos.icone)).filter(Boolean).slice(0, 4);
      conteudo = (
        <>
          {rotulo("VARIAÇÕES")}
          <div style={{ display: "flex", flexWrap: "wrap", margin: -8 }}>
            {lista.map((l: Obj, i: number) => (
              <Imagem key={i} chave={l.previa_png || l.caminho} urlDe={urlDe} alt="Variação da logo" estilo={{ width: 270, height: 420, margin: 8, borderRadius: 12, padding: 28, background: i % 2 ? t.escura : "#F4F6F4" }} />
            ))}
          </div>
        </>
      );
      break;
    }
    case "paleta":
      conteudo = (
        <>
          {rotulo("PALETA")}
          <div style={{ display: "flex", height: 460 }}>
            {cores.slice(0, 6).map((c) => (
              <div key={c.hex} style={{ flex: c.papel === "primaria" ? 2 : 1, background: c.hex, color: textoSobre(c.hex), padding: 20, display: "flex", flexDirection: "column", justifyContent: "flex-end", fontFamily: pX }}>
                <div style={{ fontSize: 22, fontWeight: 700 }}>{c.nome}</div>
                <div style={{ fontSize: 16, opacity: 0.85 }}>{normalizarHex(c.hex)}</div>
              </div>
            ))}
          </div>
        </>
      );
      break;
    case "tipografia":
      conteudo = duas(
        <>
          {rotulo("TIPOGRAFIA")}
          <div style={{ fontFamily: pT, fontSize: 200, fontWeight: 700, lineHeight: 1, color: tinta }}>Aa</div>
          <div style={{ fontFamily: pX, fontSize: 22, color: tinta, marginTop: 12 }}>{[fTitulo, fTexto !== fTitulo ? fTexto : ""].filter(Boolean).join(" + ") || "A escolher"}</div>
        </>,
        <>
          {fTitulo
            ? hierarquiaDoPar({ titulo: fTitulo, texto: fTexto || fTitulo }).map((h) => (
                <div key={h.nivel} style={{ fontFamily: pilhaDaFonte(h.familia), fontSize: h.tamanho, fontWeight: h.peso, color: tinta, marginBottom: 14, lineHeight: 1.2 }}>
                  {h.exemplo}
                </div>
              ))
            : null}
        </>,
      );
      break;
    case "grafismos":
      conteudo = <>{rotulo("ELEMENTOS GRÁFICOS")}{grade(arr(s.grafismos).map((g) => g.imagem || null), "Elemento gráfico")}</>;
      break;
    case "aplicacoes":
      conteudo = <>{rotulo("A MARCA NO MUNDO")}{grade(arr(dados.mockups).map((m) => m.imagem || null).concat(arr((dados.aplicacoes || {}).itens).map((a) => a.imagem || null)), "Aplicação da marca")}</>;
      break;
    case "proximos":
      conteudo = <>{rotulo("PRÓXIMOS PASSOS")}{itens(["Aprovação da identidade", "Ajustes finais combinados", "Entrega do manual da marca e dos arquivos", "Aplicação nas redes e nos materiais"], 26)}</>;
      break;
  }
  return (
    <div data-slide-da-marca={id} style={{ width: LARGURA_DO_SLIDE, height: ALTURA_DO_SLIDE, background: fundo, position: "relative", overflow: "hidden", boxSizing: "border-box", padding: "72px 88px", display: "flex", flexDirection: "column", justifyContent: "center", alignItems: id === "abertura" || id === "nome" || id === "revelacao" ? "center" : "stretch" }}>
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 8, background: t.primaria }} />
      {conteudo}
      <div style={{ position: "absolute", left: 88, right: 88, bottom: 28, display: "flex", justifyContent: "space-between", fontFamily: pX, fontSize: 13, color: tinta, opacity: 0.55 }}>
        <span>{nome}</span>
        <span>{n < 10 ? `0${n}` : n}</span>
      </div>
    </div>
  );
}

/** Palco que escala o slide (1280 x 720) para a largura disponível, sem aspect-ratio (Safari 11). */
export function PalcoDoSlide({ children, className = "" }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [escala, setEscala] = useState(0.25);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const medir = () => setEscala(Math.max(0.05, el.clientWidth / LARGURA_DO_SLIDE));
    medir();
    const Observador = (window as unknown as { ResizeObserver?: new (cb: () => void) => { observe: (e: Element) => void; disconnect: () => void } }).ResizeObserver;
    if (!Observador) {
      window.addEventListener("resize", medir);
      return () => window.removeEventListener("resize", medir);
    }
    const o = new Observador(medir);
    o.observe(el);
    return () => o.disconnect();
  }, []);
  return (
    <div ref={ref} className={className} style={{ position: "relative", width: "100%", paddingTop: "56.25%", overflow: "hidden" }}>
      <div style={{ position: "absolute", top: 0, left: 0, width: LARGURA_DO_SLIDE, height: ALTURA_DO_SLIDE, transform: `scale(${escala})`, transformOrigin: "0 0" }}>{children}</div>
    </div>
  );
}
