import { useEffect, useId, useRef, useState } from "react";
import { DURACAO, useMovimentoReduzido } from "./movimento";
import { pacote } from "./pacote";

/**
 * Gráfico da casa (casca): SVG próprio, sem biblioteca. Só com número REAL:
 * a série que o painel manda em pacote.base_de_design.grafico (escolhida pela
 * forma do dado em graficoParaDados: linha no tempo, barras para comparar de 2
 * a 8 itens, rosca para parte do todo com até 5 fatias, sempre com a fonte).
 * Cores só pelas variáveis da marca. Leitor de tela recebe a tabela com os
 * números; com movimento reduzido nada anima.
 *
 * Uma API só, nos dois lados (painel e motor):
 *   <Grafico titulo="..." />                      desenha a série do pacote;
 *   <Grafico grafico={pacote.base_de_design.grafico} titulo="..." />  o mesmo, explícito;
 *   <Grafico tipo="linha" | "barras" | "rosca" dados={[{ rotulo, valor }]} titulo fonte unidade />
 * O nome do tipo é o do painel ("rosca"); "donut", o nome antigo, vale como
 * rosca. Tipo desconhecido não desenha nada (nunca vira uma linha por engano).
 */
export type PontoDoGrafico = { rotulo: string; valor: number };
export type TipoDeGrafico = "linha" | "barras" | "rosca";
/** Como o painel grava o gráfico no pacote (pacote.base_de_design.grafico). */
export type GraficoDoPacote = { tipo: string; dados: PontoDoGrafico[]; fonte: string; regra?: string };
export type PropsDoGrafico = {
  tipo?: string;
  dados?: PontoDoGrafico[];
  titulo?: string;
  fonte?: string | null;
  unidade?: string;
  className?: string;
  /** A série do pacote; sem ela (e sem tipo e dados), vale pacote.base_de_design.grafico. */
  grafico?: GraficoDoPacote | null;
};

const L = 640;
const A = 320;
const M = { topo: 24, dir: 16, base: 40, esq: 48 };
const TONS = [1, 0.72, 0.5, 0.34, 0.22];

const numero = (v: number, unidade: string) => `${v.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}${unidade ? ` ${unidade}` : ""}`;

/** O tipo pelo nome do painel; "donut" (nome antigo) vira rosca; o resto, null. */
export function tipoDoGrafico(v: unknown): TipoDeGrafico | null {
  const t = String(v == null ? "" : v).trim().toLowerCase();
  if (t === "linha" || t === "barras" || t === "rosca") return t;
  if (t === "donut") return "rosca";
  return null;
}

/** Os pontos que servem para o tipo (ou null: sem gráfico, a seção mostra só os números). */
export function pontosValidos(tipo: TipoDeGrafico, dados: PontoDoGrafico[]): PontoDoGrafico[] | null {
  const p = (Array.isArray(dados) ? dados : []).filter((d) => d && typeof d.rotulo === "string" && d.rotulo.trim() !== "" && typeof d.valor === "number" && isFinite(d.valor)).slice(0, 24);
  if (tipo === "linha") return p.length >= 2 ? p : null;
  if (tipo === "barras") return p.length >= 2 && p.length <= 8 ? p : null;
  const soma = p.reduce((s, d) => s + d.valor, 0);
  return p.length >= 2 && p.length <= 5 && soma > 0 && p.every((d) => d.valor >= 0) ? p : null;
}

/**
 * O que desenhar: com `tipo` ou `dados`, as props; senão o `grafico` passado
 * ou o do pacote, que só vale com a fonte. Null: nada a desenhar.
 */
export function graficoParaDesenhar(props: PropsDoGrafico, doPacote: GraficoDoPacote | null | undefined): { tipo: TipoDeGrafico; pontos: PontoDoGrafico[]; fonte: string | null } | null {
  let bruto: unknown;
  let dados: PontoDoGrafico[] | undefined;
  let fonte: string | null;
  if (props.tipo !== undefined || props.dados !== undefined) {
    bruto = props.tipo;
    dados = props.dados;
    fonte = props.fonte ? String(props.fonte) : null;
  } else {
    const g = props.grafico !== undefined ? props.grafico : doPacote;
    if (!g || typeof g !== "object" || !String(g.fonte || "").trim()) return null;
    bruto = g.tipo;
    dados = g.dados;
    fonte = props.fonte ? String(props.fonte) : String(g.fonte);
  }
  const tipo = tipoDoGrafico(bruto);
  if (!tipo) return null;
  const pontos = pontosValidos(tipo, dados || []);
  return pontos ? { tipo, pontos, fonte } : null;
}

const doPacote = (): GraficoDoPacote | null => {
  const bd = pacote && pacote.base_de_design;
  return bd && bd.grafico ? (bd.grafico as GraficoDoPacote) : null;
};

export default function Grafico(props: PropsDoGrafico) {
  const { titulo = "Gráfico dos números", unidade = "", className = "" } = props;
  const id = useId();
  const reduzido = useMovimentoReduzido();
  const caixa = useRef<HTMLElement | null>(null);
  // O HTML pré-renderizado sai completo; no navegador, fora da tela, esconde e anima ao aparecer.
  const [fase, setFase] = useState<"pronto" | "escondido" | "visivel">("pronto");
  useEffect(() => {
    if (reduzido || !caixa.current || typeof IntersectionObserver === "undefined") return;
    const alvo = caixa.current;
    const r = alvo.getBoundingClientRect();
    if (r.top < window.innerHeight) return;
    setFase("escondido");
    const o = new IntersectionObserver((e) => {
      if (e.some((x) => x.isIntersecting)) {
        setFase("visivel");
        o.disconnect();
      }
    }, { rootMargin: "0px 0px -15% 0px" });
    o.observe(alvo);
    return () => o.disconnect();
  }, [reduzido]);

  const g = graficoParaDesenhar(props, doPacote());
  if (!g) return null;
  const { tipo, pontos, fonte } = g;
  const escondido = fase === "escondido";
  const transicao = reduzido ? "none" : `all ${DURACAO.lenta}s cubic-bezier(0.22, 1, 0.36, 1)`;
  const tituloId = `${id}-t`;
  const descId = `${id}-d`;
  const resumo = pontos.map((p) => `${p.rotulo}: ${numero(p.valor, unidade)}`).join("; ");

  let desenho = null;
  if (tipo === "rosca") {
    const soma = pontos.reduce((s, d) => s + d.valor, 0);
    const r = 110;
    const c = 2 * Math.PI * r;
    let feito = 0;
    desenho = (
      <g transform={`translate(${L / 2} ${A / 2}) rotate(-90)`} data-grafico="rosca" style={{ opacity: escondido ? 0 : 1, transition: transicao }}>
        {pontos.map((p, i) => {
          const tam = (p.valor / soma) * c;
          const el = <circle key={p.rotulo + i} r={r} fill="none" stroke="var(--cor-destaque)" strokeOpacity={TONS[i] || 0.2} strokeWidth={44} strokeDasharray={`${Math.max(0, tam - 2)} ${c}`} strokeDashoffset={-feito} />;
          feito += tam;
          return el;
        })}
      </g>
    );
  } else {
    const valores = pontos.map((p) => p.valor);
    const min = Math.min(0, ...valores);
    const max = Math.max(...valores, min + 1);
    const larg = L - M.esq - M.dir;
    const alt = A - M.topo - M.base;
    const y = (v: number) => M.topo + alt - ((v - min) / (max - min)) * alt;
    const passo = pontos.length > 8 ? Math.ceil(pontos.length / 8) : 1;
    const eixo = (
      <g fill="currentColor" className="text-suave" fontSize={13}>
        <line x1={M.esq} x2={L - M.dir} y1={y(min)} y2={y(min)} stroke="currentColor" strokeOpacity={0.3} />
        <text x={M.esq - 8} y={y(max) + 4} textAnchor="end">{numero(max, "")}</text>
        <text x={M.esq - 8} y={y(min) + 4} textAnchor="end">{numero(min, "")}</text>
      </g>
    );
    if (tipo === "barras") {
      const faixa = larg / pontos.length;
      const barra = Math.min(72, faixa * 0.62);
      desenho = (
        <g data-grafico="barras">
          {eixo}
          {pontos.map((p, i) => {
            const x = M.esq + faixa * i + (faixa - barra) / 2;
            const topo = y(Math.max(p.valor, 0));
            const h = Math.abs(y(p.valor) - y(0));
            return (
              <g key={p.rotulo + i}>
                <rect x={x} y={topo} width={barra} height={Math.max(h, 1)} rx={6} fill="var(--cor-destaque)" style={{ transformBox: "fill-box", transformOrigin: "50% 100%", transform: escondido ? "scaleY(0)" : "scaleY(1)", transition: transicao, transitionDelay: reduzido ? "0s" : `${i * 0.06}s` }} />
                <text x={x + barra / 2} y={A - 14} textAnchor="middle" fontSize={13} fill="currentColor" className="text-suave">{p.rotulo.slice(0, 14)}</text>
              </g>
            );
          })}
        </g>
      );
    } else {
      const x = (i: number) => M.esq + (larg * i) / (pontos.length - 1);
      const linha = pontos.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(p.valor).toFixed(1)}`).join(" ");
      const area = `${linha} L${x(pontos.length - 1).toFixed(1)} ${y(min).toFixed(1)} L${x(0).toFixed(1)} ${y(min).toFixed(1)} Z`;
      desenho = (
        <g data-grafico="linha">
          {eixo}
          <path d={area} fill="var(--cor-destaque)" fillOpacity={0.12} style={{ opacity: escondido ? 0 : 1, transition: transicao }} />
          <path d={linha} fill="none" stroke="var(--cor-destaque)" strokeWidth={3} strokeLinejoin="round" strokeLinecap="round" pathLength={1} strokeDasharray="1" style={{ strokeDashoffset: escondido ? 1 : 0, transition: transicao }} />
          {pontos.map((p, i) => (
            <g key={p.rotulo + i}>
              <circle cx={x(i)} cy={y(p.valor)} r={4} fill="var(--cor-destaque)" />
              {i % passo === 0 || i === pontos.length - 1 ? (
                <text x={x(i)} y={A - 14} textAnchor="middle" fontSize={13} fill="currentColor" className="text-suave">{p.rotulo.slice(0, 10)}</text>
              ) : null}
            </g>
          ))}
        </g>
      );
    }
  }

  return (
    <figure ref={caixa} className={`m-0 ${className}`}>
      <svg viewBox={`0 0 ${L} ${A}`} width={L} height={A} className="h-auto w-full" role="img" aria-labelledby={`${tituloId} ${descId}`}>
        <title id={tituloId}>{titulo}</title>
        <desc id={descId}>{resumo}</desc>
        {desenho}
      </svg>
      {tipo === "rosca" ? (
        <ul className="mt-4 flex flex-wrap justify-center gap-x-6 gap-y-2 text-sm" aria-hidden="true">
          {pontos.map((p, i) => (
            <li key={p.rotulo + i} className="flex items-center gap-2">
              <span className="inline-block h-3 w-3 rounded-full" style={{ background: "var(--cor-destaque)", opacity: TONS[i] || 0.2 }} />
              {p.rotulo}: {numero(p.valor, unidade)}
            </li>
          ))}
        </ul>
      ) : null}
      <table className="sr-only">
        <caption>{titulo}</caption>
        <thead>
          <tr>
            <th scope="col">Item</th>
            <th scope="col">Valor</th>
          </tr>
        </thead>
        <tbody>
          {pontos.map((p, i) => (
            <tr key={p.rotulo + i}>
              <th scope="row">{p.rotulo}</th>
              <td>{numero(p.valor, unidade)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {fonte ? <figcaption className="mt-3 text-sm text-suave">Fonte: {fonte}</figcaption> : null}
    </figure>
  );
}
