import { useCallback, useMemo, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import TextoFormatado from "@/components/agentes/respostas/TextoFormatado";
import { foco, juntar } from "@/components/sistema";

/**
 * O dossiê lido como um caderno (16/10, dono: "abrindo como se fosse um
 * caderno mesmo, bem organizado, com formatação, e não um monte de código").
 *
 * O texto continua o mesmo que a rotina e o MCP gravam; só a leitura muda:
 * coluna de ~72 caracteres, seções numeradas com o título bem marcado, um
 * sumário no topo para pular direto à parte que interessa e as seções longas
 * recolhidas com o título e a primeira linha à vista.
 *
 * Os dois formatos que existem no banco viram seção:
 * - Markdown com títulos (## Onde estamos);
 * - o formato do prompt semanal, em texto puro com o título em CAIXA ALTA
 *   numa linha sozinha (ONDE ESTAMOS), depois de uma linha em branco.
 *
 * O Markdown é desenhado pelo TextoFormatado (HTML cru descartado, link só
 * http/https ou rota do painel). Compatível com Safari 11: nada de
 * lookbehind, classe de propriedade Unicode ou grupo nomeado nas
 * expressões abaixo.
 */

/** Uma seção do caderno. */
export interface SecaoDoCaderno {
  titulo: string;
  corpo: string;
  /** Longa o bastante para nascer recolhida. */
  longa: boolean;
  /** Primeira linha em texto limpo, mostrada com a seção recolhida. */
  resumo: string;
}

export interface PartesDoCaderno {
  /** O que vem antes do primeiro título (ficha, data, observação). */
  abertura: string;
  aberturaLonga: boolean;
  secoes: SecaoDoCaderno[];
}

/** Seção acima disto nasce recolhida (o leitor abre com um toque). */
const LIMITE_DA_SECAO = 700;
/** Sem seções, o texto inteiro acima disto abre em prévia. */
const LIMITE_DA_ABERTURA = 700;

const CERCA = /^\s{0,3}(```|~~~)/;
const TITULO_MD = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/;

/** Siglas que continuam em caixa alta quando o título vira frase. */
const SIGLAS: Record<string, true> = {
  SEO: true, CRM: true, GMB: true, ADS: true, CPA: true, CPC: true, CPM: true, CTR: true,
  ROI: true, ROAS: true, KPI: true, KPIS: true, CAC: true, LTV: true, MCP: true, IA: true,
  UGC: true, PDV: true, SAC: true, URL: true, API: true, PIX: true, CNPJ: true, CPF: true,
  GA4: true, B2B: true, B2C: true, TV: true, OK: true,
};

/** Quantas letras a linha tem (letra = muda entre maiúscula e minúscula). */
function contarLetras(t: string): number {
  let n = 0;
  for (let i = 0; i < t.length; i++) if (t[i].toLowerCase() !== t[i].toUpperCase()) n += 1;
  return n;
}

/**
 * "ONDE ESTAMOS" vira "Onde estamos"; sigla conhecida (SEO, CRM, ADS) fica.
 * Título que já tem minúscula passa intacto.
 */
export function tituloLegivel(bruto: string): string {
  const t = bruto
    .replace(/\*\*|__|`/g, "")
    .replace(/^\d{1,2}\s*[.)-]\s+/, "")
    .replace(/\s*:\s*$/, "")
    .trim();
  if (!t || t !== t.toUpperCase() || t === t.toLowerCase()) return t;
  const palavras = t.split(/\s+/).map((p) => {
    const nome = p.replace(/[^A-Za-z0-9]/g, "");
    if (SIGLAS[nome]) return p;
    return nome === "WHATSAPP" ? p.replace("WHATSAPP", "WhatsApp") : p.toLowerCase();
  });
  const frase = palavras.join(" ");
  return frase.charAt(0).toUpperCase() + frase.slice(1);
}

/** Título em caixa alta numa linha sozinha (formato do prompt semanal). */
function tituloEmCaixaAlta(linha: string): string | null {
  const t = linha
    .trim()
    .replace(/^\*\*(.+)\*\*$/, "$1")
    .replace(/^__(.+)__$/, "$1")
    .replace(/\s*:\s*$/, "")
    .trim();
  if (t.length < 3 || t.length > 70) return null;
  if (/^[-*+>|#`~]/.test(t)) return null;
  if (t !== t.toUpperCase() || t === t.toLowerCase()) return null;
  if (contarLetras(t) < 3) return null;
  // Frase terminada ou linha de números (CNPJ, valores) não é título.
  if (/[.!?]$/.test(t) || contarLetras(t) * 2 < t.replace(/\s+/g, "").length) return null;
  // A palavra do próprio formato para "sem evidência" não é título.
  if (t === "DESCONHECIDO") return null;
  return t;
}

/** Texto limpo de marcação, para resumo e prévia. */
export function textoLimpo(md: string): string {
  return md
    .replace(/\r\n?/g, "\n")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .split("\n")
    .map((l) => l.replace(/^\s*(#{1,6}\s+|>\s?|[-*+]\s+|\d+[.)]\s+)/, "").replace(/[*_`|]/g, " ").replace(/\s+/g, " ").trim())
    .filter((l) => l && !/^[-:\s]+$/.test(l))
    .join(" ")
    .trim();
}

function cortar(t: string, limite: number): string {
  return t.length > limite ? `${t.slice(0, limite - 1).trim()}…` : t;
}

/** Tira linhas em branco das pontas. */
function aparar(linhas: string[]): string {
  return linhas.join("\n").replace(/^\s*\n/, "").replace(/\s+$/, "");
}

/** Divide o dossiê em abertura e seções. */
export function secoesDoDossie(bruto: string): PartesDoCaderno {
  const linhas = String(bruto || "").replace(/\r\n?/g, "\n").split("\n");
  type Marca = { indice: number; nivel: number; titulo: string };
  const md: Marca[] = [];
  const caixa: Marca[] = [];
  let naCerca = false;
  for (let i = 0; i < linhas.length; i++) {
    const linha = linhas[i];
    if (CERCA.test(linha)) {
      naCerca = !naCerca;
      continue;
    }
    if (naCerca) continue;
    const m = TITULO_MD.exec(linha);
    if (m) {
      md.push({ indice: i, nivel: m[1].length, titulo: m[2] });
      continue;
    }
    const anteriorEmBranco = i === 0 || !linhas[i - 1].trim();
    const titulo = anteriorEmBranco ? tituloEmCaixaAlta(linha) : null;
    if (titulo) caixa.push({ indice: i, nivel: 0, titulo });
  }

  // O nível que divide: o primeiro que se repete (um "# Título" sozinho no
  // topo fica na abertura e os "##" viram as seções).
  let marcas: Marca[] = [];
  for (let nivel = 1; nivel <= 6 && !marcas.length; nivel++) {
    const doNivel = md.filter((x) => x.nivel === nivel);
    if (doNivel.length >= 2) marcas = doNivel;
  }
  if (!marcas.length && caixa.length >= 2) marcas = caixa;
  if (!marcas.length && md.length) {
    const menor = Math.min.apply(null, md.map((x) => x.nivel));
    marcas = md.filter((x) => x.nivel === menor);
  }

  const abertura = aparar(linhas.slice(0, marcas.length ? marcas[0].indice : linhas.length));
  const secoes = marcas.map((marca, k) => {
    const fim = k + 1 < marcas.length ? marcas[k + 1].indice : linhas.length;
    const corpo = aparar(linhas.slice(marca.indice + 1, fim));
    const linhasDoCorpo = corpo ? corpo.split("\n").length : 0;
    return {
      titulo: tituloLegivel(marca.titulo) || `Parte ${k + 1}`,
      corpo,
      longa: corpo.length > LIMITE_DA_SECAO || linhasDoCorpo > 14,
      resumo: cortar(textoLimpo(corpo), 180),
    };
  });
  return { abertura, aberturaLonga: abertura.length > LIMITE_DA_ABERTURA, secoes };
}

/** Linha de texto corrido (não é título, lista, tabela, citação nem cerca). */
function ehTextoCorrido(linha: string): boolean {
  const t = linha.trim();
  if (!t) return false;
  return !/^(#{1,6}\s|>|\||```|~~~|[-*+]\s|\d+[.)]\s|[-*_=]{3,}\s*$)/.test(t);
}

/**
 * O dossiê em texto puro quebra linha com Enter simples ("Conteúdo: ...",
 * "Tráfego: ..."); no Markdown isso viraria um parágrafo só, embolado.
 * Entre duas linhas de texto corrido, a quebra vira quebra de verdade.
 */
export function preservarQuebras(md: string): string {
  const linhas = String(md || "").replace(/\r\n?/g, "\n").split("\n");
  const saida: string[] = [];
  let naCerca = false;
  for (let i = 0; i < linhas.length; i++) {
    const linha = linhas[i];
    if (CERCA.test(linha)) {
      naCerca = !naCerca;
      saida.push(linha);
      continue;
    }
    const proxima = linhas[i + 1];
    const quebra = !naCerca && proxima !== undefined && ehTextoCorrido(linha) && ehTextoCorrido(proxima) && !/( {2}|\\)$/.test(linha);
    saida.push(quebra ? `${linha}  ` : linha);
  }
  return saida.join("\n");
}

/** Índice -1 é a abertura; 0..n-1 são as seções. */
export interface EstadoDoCaderno {
  partes: PartesDoCaderno;
  estaAberta: (i: number) => boolean;
  alternar: (i: number) => void;
  abrir: (i: number) => void;
  /** Tudo aberto (nada recolhido). */
  tudoAberto: boolean;
  /** Existe o que recolher (seções ou texto longo). */
  temOQueRecolher: boolean;
  /** Abre tudo, ou recolhe tudo se já estiver aberto. */
  alternarTudo: () => void;
}

/** Estado das seções abertas; volta ao padrão quando o texto muda. */
export function useCaderno(texto: string): EstadoDoCaderno {
  const partes = useMemo(() => secoesDoDossie(texto), [texto]);
  // O que o leitor abriu vale para ESTE texto; versão nova volta ao padrão.
  const [estado, setEstado] = useState<{ texto: string; abertas: Record<number, boolean> }>({ texto, abertas: {} });
  const abertas = estado.texto === texto ? estado.abertas : {};
  const setAbertas = (mudar: (a: Record<number, boolean>) => Record<number, boolean>) =>
    setEstado((e) => ({ texto, abertas: mudar(e.texto === texto ? e.abertas : {}) }));

  const recolhidaDeInicio = useCallback(
    (i: number) => (i < 0 ? partes.secoes.length === 0 && partes.aberturaLonga : !!partes.secoes[i] && partes.secoes[i].longa),
    [partes],
  );
  const estaAberta = useCallback(
    (i: number) => (abertas[i] !== undefined ? abertas[i] : !recolhidaDeInicio(i)),
    [abertas, recolhidaDeInicio],
  );
  const indices = [-1].concat(partes.secoes.map((_, i) => i));
  const tudoAberto = indices.every((i) => estaAberta(i));
  const temOQueRecolher = partes.secoes.length > 0 || partes.aberturaLonga;

  return {
    partes,
    estaAberta,
    alternar: (i) => setAbertas((a) => ({ ...a, [i]: !estaAberta(i) })),
    abrir: (i) => setAbertas((a) => ({ ...a, [i]: true })),
    tudoAberto,
    temOQueRecolher,
    alternarTudo: () => {
      const novo: Record<number, boolean> = {};
      for (const i of indices) novo[i] = !tudoAberto;
      setAbertas(() => novo);
    },
  };
}

/**
 * Cores do caderno (17/10, dono: "isso que está muito preto dá para mudar a
 * cor, dá uma diversificada"). Só tokens do tema, para o claro e o escuro:
 * o corpo num tom mais suave que o preto cheio, os títulos de dentro do texto
 * na cor da marca e cada seção com um tom de destaque (marca, informação,
 * aviso), que pinta o número, o marcador da lista e o negrito.
 */
const CORPO = "space-y-3 leading-[1.7] text-foreground/75 [&_[role=heading]]:text-primary [&_strong]:font-semibold [&_strong]:text-foreground/90";

interface Acento {
  /** Número da seção (pílula). */
  numero: string;
  /** Marcador de lista dentro do corpo. */
  marcador: string;
}

const ACENTOS: Acento[] = [
  { numero: "bg-primary/10 text-primary", marcador: "[&_li]:marker:text-primary/70" },
  { numero: "bg-info/10 text-info", marcador: "[&_li]:marker:text-info/70" },
  { numero: "bg-warning/10 text-warning", marcador: "[&_li]:marker:text-warning/80" },
];

const acento = (i: number) => ACENTOS[i % ACENTOS.length];

const numero = (i: number) => String(i + 1).padStart(2, "0");

export default function CadernoDoDossie({ caderno }: { caderno: EstadoDoCaderno }) {
  const { partes, estaAberta, alternar, abrir } = caderno;
  const secoes = partes.secoes;
  const ancoras = useRef<Record<number, HTMLElement | null>>({});

  const irPara = (i: number) => {
    abrir(i);
    window.requestAnimationFrame(() => {
      const alvo = ancoras.current[i];
      if (alvo && typeof alvo.scrollIntoView === "function") alvo.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  const aberturaAberta = estaAberta(-1);
  return (
    <article className="min-w-0" data-caderno-do-dossie="">
      {/* Sumário (17/10, dono: "meio desorganizado, ainda poluído"): pílulas
          numeradas em linha, que quebram no celular; sem rótulo repetido. */}
      {secoes.length >= 2 && (
        <nav aria-label="Sumário do dossiê" className="mb-6">
          <ol className="-m-1 flex min-w-0 flex-wrap">
            {secoes.map((s, i) => (
              <li key={i} className="m-1 min-w-0 max-w-full">
                <button
                  type="button"
                  onClick={() => irPara(i)}
                  title={s.titulo}
                  className={juntar(
                    "inline-flex h-7 max-w-full min-w-0 items-center rounded-full bg-muted/50 pl-1 pr-3 text-[12.5px] text-foreground/75 transition-colors hover:bg-primary/10 hover:text-primary",
                    foco,
                  )}
                  data-atalho-do-sumario=""
                >
                  <span className={juntar("mr-1.5 inline-flex h-5 min-w-[1.5rem] shrink-0 items-center justify-center rounded-full px-1 text-[11px] font-semibold tabular-nums", acento(i).numero)}>{numero(i)}</span>
                  <span className="min-w-0 truncate">{s.titulo}</span>
                </button>
              </li>
            ))}
          </ol>
        </nav>
      )}

      {partes.abertura && (
        <div className={secoes.length ? "mb-6" : ""}>
          {aberturaAberta ? (
            <TextoFormatado texto={preservarQuebras(partes.abertura)} className={juntar(CORPO, ACENTOS[0].marcador)} />
          ) : (
            <>
              <p className="line-clamp-4 text-[14px] leading-[1.7] text-foreground/75">{textoLimpo(partes.abertura)}</p>
              <button type="button" onClick={() => abrir(-1)} className={juntar("mt-1 rounded text-[12px] font-medium text-primary hover:opacity-80", foco)}>
                Continuar
              </button>
            </>
          )}
        </div>
      )}

      {secoes.map((s, i) => {
        const aberta = estaAberta(i);
        const cor = acento(i);
        return (
          <section
            key={i}
            ref={(el) => {
              ancoras.current[i] = el;
            }}
            className={juntar("min-w-0 scroll-mt-4", i > 0 && "mt-5 border-t border-border/40 pt-4")}
            data-secao-do-caderno={aberta ? "aberta" : "recolhida"}
          >
            <h3 className="min-w-0">
              <button
                type="button"
                onClick={() => alternar(i)}
                aria-expanded={aberta}
                title={aberta ? "Recolher" : "Abrir"}
                className={juntar("group flex w-full min-w-0 items-center rounded-md text-left", foco)}
              >
                <span className={juntar("mr-3 inline-flex h-6 w-7 shrink-0 items-center justify-center rounded-md text-[12px] font-semibold tabular-nums", cor.numero)}>{numero(i)}</span>
                <span className="min-w-0 flex-1 truncate text-[15px] font-semibold leading-[22px] text-foreground/85 transition-colors group-hover:text-primary">{s.titulo}</span>
                <ChevronDown
                  className={juntar("ml-2 h-4 w-4 shrink-0 text-muted-foreground/70 transition-transform", aberta ? "" : "-rotate-90")}
                  aria-hidden="true"
                />
              </button>
            </h3>
            {aberta ? (
              <div className="mt-2.5 min-w-0 sm:pl-10">
                {s.corpo ? (
                  <TextoFormatado texto={preservarQuebras(s.corpo)} className={juntar(CORPO, cor.marcador)} />
                ) : (
                  <p className="text-[13px] text-muted-foreground">Sem texto nesta parte.</p>
                )}
              </div>
            ) : s.resumo ? (
              <p className="mt-1 min-w-0 truncate text-[13px] leading-5 text-muted-foreground/80 sm:pl-10">{s.resumo}</p>
            ) : null}
          </section>
        );
      })}
    </article>
  );
}
