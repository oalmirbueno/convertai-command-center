import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

/**
 * As telas de demonstração da página de venda do CRM: funil colorido, painel
 * com gráfico e ranking. São desenhos com dados de exemplo (marcados na
 * própria tela), animados só com transform e opacity.
 */

const cor = (c: string) => ({ "--cor": c }) as CSSProperties;
const AZUL = "var(--vd-azul)";
const AMBAR = "var(--vd-ambar)";
const VIOLETA = "var(--vd-violeta)";
const VERDE = "var(--vd-verde)";
const ROSA = "var(--vd-rosa)";

const semMovimento = () => {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
};

/**
 * Marca o elemento quando ele entra na tela. Navegador sem
 * IntersectionObserver (Safari 11) mostra tudo de uma vez.
 */
export function useNaTela<T extends HTMLElement>(margem = "0px 0px -12% 0px") {
  const ref = useRef<T | null>(null);
  const [visto, setVisto] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || visto) return;
    if (typeof IntersectionObserver === "undefined") {
      setVisto(true);
      return;
    }
    const olho = new IntersectionObserver(
      (entradas) => {
        if (entradas.some((e) => e.isIntersecting)) {
          setVisto(true);
          olho.disconnect();
        }
      },
      { rootMargin: margem, threshold: 0.12 },
    );
    olho.observe(el);
    return () => olho.disconnect();
  }, [visto, margem]);
  return { ref, visto };
}

/** Entrada por rolagem: o bloco sobe e aparece uma vez. */
export function Revela({ children, className = "", atraso = 0, como = "div" }: { children: ReactNode; className?: string; atraso?: 0 | 1 | 2 | 3 | 4; como?: "div" | "li" | "section" | "h1" }) {
  const { ref, visto } = useNaTela<HTMLDivElement>();
  const Tag = como as "div";
  return (
    <Tag ref={ref} className={`vd-rev${atraso ? ` vd-a${atraso}` : ""}${visto ? " vd-on" : ""}${className ? ` ${className}` : ""}`}>
      {children}
    </Tag>
  );
}

/** O número que sobe até o valor quando aparece. */
export function Conta({ ate, formato, ligado }: { ate: number; formato: (n: number) => string; ligado: boolean }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!ligado) return;
    if (semMovimento() || typeof requestAnimationFrame === "undefined") {
      setN(ate);
      return;
    }
    let quadro = 0;
    const inicio = Date.now();
    const dura = 1500;
    const passo = () => {
      const t = Math.min(1, (Date.now() - inicio) / dura);
      setN(ate * (1 - Math.pow(1 - t, 3)));
      if (t < 1) quadro = requestAnimationFrame(passo);
    };
    quadro = requestAnimationFrame(passo);
    return () => cancelAnimationFrame(quadro);
  }, [ate, ligado]);
  return <>{formato(ligado ? n : 0)}</>;
}

const dinheiro = (n: number) => `R$ ${Math.round(n).toLocaleString("pt-BR")}`;

function Janela({ titulo, children, className = "" }: { titulo: string; children: ReactNode; className?: string }) {
  const { ref, visto } = useNaTela<HTMLDivElement>();
  return (
    <div ref={ref} className={`vd-janela vd-rev${visto ? " vd-on" : ""}${className ? ` ${className}` : ""}`} aria-hidden="true">
      <div className="vd-janela-topo">
        <b />
        <b />
        <b />
        <span>{titulo}</span>
        <span className="vd-demo">Dados de demonstração</span>
      </div>
      <div className="vd-janela-corpo">{children}</div>
    </div>
  );
}

function Cartao({ nome, valor, c, className = "", children }: { nome: string; valor: string; c: string; className?: string; children?: ReactNode }) {
  return (
    <div className={`vd-cartao${className ? ` ${className}` : ""}`} style={cor(c)}>
      <strong>{nome}</strong>
      <span>{valor}</span>
      {children}
    </div>
  );
}

/** O funil: cada etapa de uma cor, e um negócio que anda de Proposta para Fechado. */
export function TelaDoFunil() {
  return (
    <Janela titulo="Funil de vendas">
      <div className="vd-funil">
        <div className="vd-coluna">
          <div className="vd-coluna-topo" style={cor(AZUL)}><i /><span>Novo</span><small>2</small></div>
          <Cartao nome="Clínica Vida" valor="R$ 2.400 · indicação" c={AZUL} />
          <Cartao nome="Auto Center Rota" valor="R$ 900 · anúncio" c={AZUL} />
        </div>
        <div className="vd-coluna">
          <div className="vd-coluna-topo" style={cor(AMBAR)}><i /><span>Em conversa</span><small>2</small></div>
          <Cartao nome="Studio Leve" valor="R$ 1.800 · retorno hoje" c={AMBAR} />
          <Cartao nome="Ótica Visão" valor="R$ 650 · WhatsApp" c={AMBAR} />
        </div>
        <div className="vd-coluna">
          <div className="vd-coluna-topo" style={cor(VIOLETA)}><i /><span>Proposta</span><small>2</small></div>
          <Cartao nome="Construtora Base" valor="R$ 12.000 · enviada" c={VIOLETA} />
          <Cartao nome="Padaria Sol" valor="R$ 3.200 · aceita" c={VERDE} className="vd-voa">
            <em className="vd-ganhou">Fechado</em>
          </Cartao>
          <div className="vd-vaga" />
        </div>
        <div className="vd-coluna">
          <div className="vd-coluna-topo" style={cor(VERDE)}><i /><span>Fechado</span><small>R$ 7.700</small></div>
          <Cartao nome="Escola Aprender" valor="R$ 4.500 · este mês" c={VERDE} />
          <div className="vd-vaga" />
        </div>
      </div>
    </Janela>
  );
}

const FATIAS = [
  { nome: "Novo", c: AZUL, largura: 100, n: 42 },
  { nome: "Em conversa", c: AMBAR, largura: 71, n: 30 },
  { nome: "Proposta", c: VIOLETA, largura: 43, n: 18 },
  { nome: "Negociação", c: ROSA, largura: 26, n: 11 },
  { nome: "Fechado", c: VERDE, largura: 19, n: 8 },
];

/** O painel: números do mês, a linha da receita que se desenha e o funil em barras. */
export function TelaDoPainel() {
  const { ref, visto } = useNaTela<HTMLDivElement>();
  return (
    <Janela titulo="Painel do mês">
      <div ref={ref} className={visto ? "vd-on" : ""}>
        <div className="vd-indices">
          <div className="vd-indice"><span>Vendido no mês</span><strong><Conta ate={48600} formato={dinheiro} ligado={visto} /></strong><small>meta: R$ 60.000</small></div>
          <div className="vd-indice"><span>Negócios abertos</span><strong><Conta ate={61} formato={(n) => String(Math.round(n))} ligado={visto} /></strong><small>12 com retorno hoje</small></div>
          <div className="vd-indice"><span>Conversão</span><strong><Conta ate={19} formato={(n) => `${Math.round(n)}%`} ligado={visto} /></strong><small>do contato ao fechado</small></div>
          <div className="vd-indice"><span>Ticket médio</span><strong><Conta ate={6075} formato={dinheiro} ligado={visto} /></strong><small>8 vendas</small></div>
        </div>
        <div className="vd-grafico">
          <div className="vd-grafico-titulo">Vendas por semana</div>
          <div className="vd-cortina">
            <div>
              <svg viewBox="0 0 600 170" preserveAspectRatio="none" role="img" aria-label="Gráfico de vendas subindo ao longo do mês">
                <defs>
                  <linearGradient id="vd-area" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0" stopColor="#3dff8f" stopOpacity="0.32" />
                    <stop offset="1" stopColor="#3dff8f" stopOpacity="0" />
                  </linearGradient>
                </defs>
                <path d="M0 140 C60 132 90 118 150 112 S240 124 300 92 S400 78 450 52 S540 34 600 16 L600 170 L0 170 Z" fill="url(#vd-area)" />
                <path d="M0 140 C60 132 90 118 150 112 S240 124 300 92 S400 78 450 52 S540 34 600 16" fill="none" stroke="#3dff8f" strokeWidth="2.5" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
                <path d="M0 150 C80 146 140 140 200 136 S320 128 400 118 S520 108 600 100" fill="none" stroke="#4da3ff" strokeWidth="1.5" strokeDasharray="4 5" opacity="0.7" vectorEffect="non-scaling-stroke" />
              </svg>
            </div>
          </div>
        </div>
        <div className="vd-fatias">
          {FATIAS.map((f, i) => (
            <div key={f.nome} className="vd-fatia">
              <span>{f.nome}</span>
              <span className="vd-trilho"><span className="vd-barra" style={{ ...cor(f.c), width: `${f.largura}%`, transitionDelay: `${200 + i * 110}ms` }} /></span>
              <span>{f.n}</span>
            </div>
          ))}
        </div>
      </div>
    </Janela>
  );
}

const POSTOS = [
  { nome: "Marina", iniciais: "MA", c: VERDE, valor: 18400, vendas: 4, largura: 100 },
  { nome: "Rafael", iniciais: "RA", c: AZUL, valor: 14200, vendas: 2, largura: 77 },
  { nome: "Camila", iniciais: "CA", c: AMBAR, valor: 9800, vendas: 1, largura: 53 },
  { nome: "Diego", iniciais: "DI", c: VIOLETA, valor: 6200, vendas: 1, largura: 34 },
];

/** O ranking: quem vendeu quanto no mês, com a barra que cresce. */
export function TelaDoRanking() {
  const { ref, visto } = useNaTela<HTMLDivElement>();
  return (
    <Janela titulo="Ranking de vendedores">
      <div ref={ref} className={visto ? "vd-on" : ""}>
        {POSTOS.map((p, i) => (
          <div key={p.nome} className="vd-posto">
            <b>{i + 1}</b>
            <span className="vd-rosto" style={cor(p.c)}>{p.iniciais}</span>
            <span className="vd-posto-meio">
              <strong>{p.nome}</strong>
              <span className="vd-trilho"><span className="vd-barra" style={{ ...cor(p.c), width: `${p.largura}%`, transitionDelay: `${150 + i * 130}ms` }} /></span>
            </span>
            <span className="vd-posto-valor">
              <strong><Conta ate={p.valor} formato={dinheiro} ligado={visto} /></strong>
              <span>{p.vendas} {p.vendas === 1 ? "venda" : "vendas"}</span>
            </span>
          </div>
        ))}
      </div>
    </Janela>
  );
}

const RETORNOS = [
  { hora: "09:30", nome: "Studio Leve", o_que: "Ligar para confirmar a proposta", c: AMBAR, feito: true },
  { hora: "11:00", nome: "Construtora Base", o_que: "Reunião de apresentação", c: VIOLETA, feito: true },
  { hora: "14:15", nome: "Clínica Vida", o_que: "Enviar o orçamento", c: AZUL, feito: false },
  { hora: "16:40", nome: "Ótica Visão", o_que: "Responder no WhatsApp", c: AMBAR, feito: false },
];

/** A agenda do dia: cada negócio aberto com o retorno marcado. */
export function TelaDaAgenda() {
  return (
    <Janela titulo="Retornos de hoje">
      {RETORNOS.map((r) => (
        <div key={r.hora} className="vd-posto">
          <span className="vd-hora">{r.hora}</span>
          <span className="vd-posto-meio">
            <strong>{r.nome}</strong>
            <span className="vd-oque">{r.o_que}</span>
          </span>
          <span className={r.feito ? "vd-estado vd-estado-feito" : "vd-estado"} style={cor(r.c)}>{r.feito ? "Feito" : "A fazer"}</span>
        </div>
      ))}
    </Janela>
  );
}
