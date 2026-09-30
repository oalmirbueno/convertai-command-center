import { pacote } from "./pacote";

/**
 * Gráfico da casa (casca v3): SVG próprio, sem biblioteca de gráfico. Só na
 * seção de números e só com a série REAL que o pacote traz com fonte
 * (pacote.base_de_design.grafico, escolhida pela forma do dado: linha no
 * tempo, barras entre categorias, rosca para parte do todo). Sem série, não
 * desenha nada.
 *
 * Acessível: o SVG tem título e descrição, e a mesma série vai numa tabela
 * para leitor de tela (e visível em "Ver os números"). Nada anima: o gráfico
 * já nasce no estado final (movimento reduzido de graça). Cores só pelas
 * variáveis da marca (--cor-destaque, --cor-texto, --cor-borda).
 */

export type PontoDoGrafico = { rotulo: string; valor: number };
export type GraficoDoPacote = { tipo: "linha" | "barras" | "rosca"; dados: PontoDoGrafico[]; fonte: string; regra?: string };

const LARGURA = 640;
const ALTURA = 320;
const MARGEM = 40;

const numero = (v: number) => new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(v);

function Linha({ dados }: { dados: PontoDoGrafico[] }) {
  const max = Math.max(...dados.map((d) => d.valor), 0) || 1;
  const min = Math.min(...dados.map((d) => d.valor), 0);
  const passoX = (LARGURA - MARGEM * 2) / Math.max(1, dados.length - 1);
  const y = (v: number) => ALTURA - MARGEM - ((v - min) / (max - min || 1)) * (ALTURA - MARGEM * 2);
  const pontos = dados.map((d, i) => `${MARGEM + i * passoX},${y(d.valor)}`).join(" ");
  return (
    <g>
      <line x1={MARGEM} y1={ALTURA - MARGEM} x2={LARGURA - MARGEM} y2={ALTURA - MARGEM} stroke="var(--cor-borda, currentColor)" strokeOpacity={0.5} />
      <polyline points={pontos} fill="none" stroke="var(--cor-destaque)" strokeWidth={3} strokeLinejoin="round" strokeLinecap="round" />
      {dados.map((d, i) => (
        <g key={d.rotulo}>
          <circle cx={MARGEM + i * passoX} cy={y(d.valor)} r={5} fill="var(--cor-destaque)" />
          <text x={MARGEM + i * passoX} y={ALTURA - MARGEM + 20} textAnchor="middle" fontSize={13} fill="currentColor">
            {d.rotulo}
          </text>
          <text x={MARGEM + i * passoX} y={y(d.valor) - 10} textAnchor="middle" fontSize={13} fill="currentColor">
            {numero(d.valor)}
          </text>
        </g>
      ))}
    </g>
  );
}

function Barras({ dados }: { dados: PontoDoGrafico[] }) {
  const ordenados = dados.slice().sort((a, b) => b.valor - a.valor);
  const max = Math.max(...ordenados.map((d) => d.valor), 0) || 1;
  const altura = (ALTURA - MARGEM) / ordenados.length;
  return (
    <g>
      {ordenados.map((d, i) => {
        const largura = Math.max(2, (d.valor / max) * (LARGURA - 220));
        return (
          <g key={d.rotulo} transform={`translate(0, ${i * altura + 8})`}>
            <text x={0} y={altura / 2} dominantBaseline="middle" fontSize={13} fill="currentColor">
              {d.rotulo}
            </text>
            <rect x={140} y={4} width={largura} height={Math.max(8, altura - 16)} rx={4} fill="var(--cor-destaque)" />
            <text x={148 + largura} y={altura / 2} dominantBaseline="middle" fontSize={13} fill="currentColor">
              {numero(d.valor)}
            </text>
          </g>
        );
      })}
    </g>
  );
}

function Rosca({ dados }: { dados: PontoDoGrafico[] }) {
  const total = dados.reduce((s, d) => s + Math.max(0, d.valor), 0) || 1;
  const raio = 110;
  const circunferencia = 2 * Math.PI * raio;
  let acumulado = 0;
  return (
    <g transform={`translate(${ALTURA / 2 + 20}, ${ALTURA / 2})`}>
      {dados.map((d, i) => {
        const parte = Math.max(0, d.valor) / total;
        const deslocamento = -acumulado * circunferencia;
        acumulado += parte;
        return (
          <circle
            key={d.rotulo}
            r={raio}
            fill="none"
            stroke="var(--cor-destaque)"
            strokeOpacity={1 - i * (0.7 / Math.max(1, dados.length))}
            strokeWidth={42}
            strokeDasharray={`${parte * circunferencia} ${circunferencia}`}
            strokeDashoffset={deslocamento}
            transform="rotate(-90)"
          />
        );
      })}
      {dados.map((d, i) => (
        <text key={`r-${d.rotulo}`} x={raio + 70} y={-raio + 20 + i * 26} fontSize={13} fill="currentColor">
          {d.rotulo}: {numero((Math.max(0, d.valor) / total) * 100)}%
        </text>
      ))}
    </g>
  );
}

/** O gráfico da série real do pacote (ou o que vier por props). Sem série com fonte, nada. */
export default function Grafico({ grafico, titulo, className }: { grafico?: GraficoDoPacote | null; titulo?: string; className?: string }) {
  const base = (pacote as unknown as { base_de_design?: { grafico?: GraficoDoPacote | null } | null }).base_de_design;
  const g = grafico !== undefined ? grafico : base ? base.grafico || null : null;
  if (!g || !g.fonte || !Array.isArray(g.dados) || g.dados.length < 2) return null;
  const dados = g.dados.filter((d) => d && d.rotulo && Number.isFinite(d.valor)).slice(0, 12);
  if (dados.length < 2) return null;
  const nome = titulo || "Gráfico dos números";
  const id = `grafico-${g.tipo}`;
  return (
    <figure className={className}>
      <svg viewBox={`0 0 ${LARGURA} ${ALTURA}`} role="img" aria-labelledby={`${id}-t ${id}-d`} width="100%" style={{ maxWidth: LARGURA, height: "auto" }}>
        <title id={`${id}-t`}>{nome}</title>
        <desc id={`${id}-d`}>{dados.map((d) => `${d.rotulo}: ${numero(d.valor)}`).join("; ")}. Fonte: {g.fonte}.</desc>
        {g.tipo === "linha" ? <Linha dados={dados} /> : g.tipo === "rosca" ? <Rosca dados={dados} /> : <Barras dados={dados} />}
      </svg>
      <figcaption style={{ fontSize: 13, opacity: 0.8 }}>Fonte: {g.fonte}</figcaption>
      <details style={{ fontSize: 13 }}>
        <summary>Ver os números</summary>
        <table>
          <caption>{nome}</caption>
          <thead>
            <tr>
              <th scope="col">Item</th>
              <th scope="col">Valor</th>
            </tr>
          </thead>
          <tbody>
            {dados.map((d) => (
              <tr key={d.rotulo}>
                <th scope="row">{d.rotulo}</th>
                <td>{numero(d.valor)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
