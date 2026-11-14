import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as EventoDePonteiro, type ReactNode } from "react";
import { ArrowRight, Check } from "lucide-react";

/**
 * Peças da página de venda do CRM: a entrada por rolagem, o notebook que abre
 * conforme a pessoa rola (com as telas reais do produto, capturadas com dados
 * de exemplo em src/assets/venda) e o funil de demonstração que o visitante
 * arrasta de verdade.
 */

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
export function Revela({ children, className = "", atraso = 0, como = "div", style }: { children: ReactNode; className?: string; atraso?: 0 | 1 | 2 | 3 | 4; como?: "div" | "li" | "section" | "h1"; style?: CSSProperties }) {
  const { ref, visto } = useNaTela<HTMLDivElement>();
  const Tag = como as "div";
  return (
    <Tag ref={ref} style={style} className={`vd-rev${atraso ? ` vd-a${atraso}` : ""}${visto ? " vd-on" : ""}${className ? ` ${className}` : ""}`}>
      {children}
    </Tag>
  );
}

export interface TelaDoProduto {
  id: string;
  nome: string;
  src: string;
  alt: string;
}

const entre = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/**
 * O notebook que abre com a rolagem: a tampa sobe, a tela acende com o CRM e
 * o celular ao lado liga em seguida. Só transform e opacity, um quadro por vez.
 * Depois de aberto, as abas trocam a tela mostrada.
 */
export function NotebookQueAbre({ telas, celular, altCelular }: { telas: TelaDoProduto[]; celular: string; altCelular: string }) {
  const caixa = useRef<HTMLDivElement | null>(null);
  const tampa = useRef<HTMLDivElement | null>(null);
  const brilho = useRef<HTMLDivElement | null>(null);
  const [ligado, setLigado] = useState(false);
  const [aba, setAba] = useState(telas[0].id);

  useEffect(() => {
    let quadro = 0;
    let jaLigou = false;
    const medir = () => {
      quadro = 0;
      const el = caixa.current;
      if (!el || !tampa.current) return;
      const r = el.getBoundingClientRect();
      const alturaDaJanela = window.innerHeight || 800;
      // Começa a abrir quando o topo do notebook entra pela base da tela e termina perto do meio.
      const p = entre((alturaDaJanela * 0.96 - r.top) / (alturaDaJanela * 0.6), 0, 1);
      const suave = 1 - Math.pow(1 - p, 3);
      tampa.current.style.transform = `rotateX(${(-86 * (1 - suave)).toFixed(2)}deg)`;
      if (brilho.current) brilho.current.style.opacity = String(entre((p - 0.45) / 0.4, 0, 1).toFixed(3));
      if (p > 0.92 && !jaLigou) {
        jaLigou = true;
        setLigado(true);
      }
    };
    const pedir = () => {
      if (!quadro) quadro = window.requestAnimationFrame(medir);
    };
    medir();
    window.addEventListener("scroll", pedir, { passive: true });
    window.addEventListener("resize", pedir);
    return () => {
      window.removeEventListener("scroll", pedir);
      window.removeEventListener("resize", pedir);
      if (quadro) window.cancelAnimationFrame(quadro);
    };
  }, []);

  return (
    <div className="vd-cena-do-note" data-notebook="">
      <div ref={caixa} className={ligado ? "vd-note vd-ligado" : "vd-note"}>
        <div ref={tampa} className="vd-note-tampa" style={{ transform: "rotateX(-86deg)" }}>
          <div ref={brilho} className="vd-note-tela" style={{ opacity: 0 }}>
            {telas.map((t) => (
              <img key={t.id} src={t.src} alt={t.id === aba ? t.alt : ""} aria-hidden={t.id !== aba} className={t.id === aba ? "vd-na-frente" : ""} width={1800} height={1137} loading="lazy" decoding="async" draggable={false} />
            ))}
          </div>
        </div>
        <div className="vd-note-base" aria-hidden="true"><i /></div>
        <div className="vd-celular">
          <img src={celular} alt={altCelular} width={585} height={1266} loading="lazy" decoding="async" draggable={false} />
        </div>
      </div>
      <div className="vd-abas" role="tablist" aria-label="Telas do CRM">
        {telas.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={t.id === aba} className="vd-aba" onClick={() => setAba(t.id)} data-aba={t.id}>{t.nome}</button>
        ))}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ funil de demonstração

interface Negocio {
  id: string;
  nome: string;
  empresa: string;
  valor: number;
  etapa: number;
}

const NEGOCIOS: Negocio[] = [
  { id: "n1", nome: "Ana Paula", empresa: "Padaria Sol Nascente", valor: 3200, etapa: 0 },
  { id: "n2", nome: "Bruno Dias", empresa: "Clínica Vida", valor: 5400, etapa: 0 },
  { id: "n3", nome: "Carla Nunes", empresa: "Auto Center Rota", valor: 2800, etapa: 1 },
  { id: "n4", nome: "Diego Alves", empresa: "Studio Pilates Leve", valor: 7600, etapa: 2 },
  { id: "n5", nome: "Elisa Prado", empresa: "Pet Shop Amigo", valor: 4100, etapa: 2 },
  { id: "n6", nome: "João Vitor", empresa: "Construtora Base", valor: 12000, etapa: 3 },
];

const CORES = ["#2f9bf0", "#8f6bf0", "#f5a623", "#22e06b"];
const dinheiro = (n: number) => `R$ ${Math.round(n).toLocaleString("pt-BR")}`;

/**
 * Um funil pequeno que funciona de verdade: a pessoa arrasta o cartão para a
 * etapa seguinte (ou toca na seta) e os totais mudam na hora. Os dados são de
 * exemplo e nada sai da página.
 */
export function FunilVivo({ etapas }: { etapas: string[] }) {
  const [negocios, setNegocios] = useState(NEGOCIOS);
  const [pegando, setPegando] = useState<{ id: string; x: number; y: number; sobre: number } | null>(null);
  const [fechou, setFechou] = useState<Negocio | null>(null);
  const colunas = useRef<Array<HTMLDivElement | null>>([]);
  const inicio = useRef<{ x: number; y: number } | null>(null);
  const ultima = etapas.length - 1;

  const mover = (id: string, etapa: number) => {
    const alvo = entre(etapa, 0, ultima);
    const antes = negocios.filter((n) => n.id === id)[0];
    if (!antes || antes.etapa === alvo) return;
    setNegocios(negocios.map((n) => (n.id === id ? { ...n, etapa: alvo } : n)));
    if (alvo === ultima) setFechou({ ...antes, etapa: alvo });
  };

  useEffect(() => {
    if (!fechou) return;
    const relogio = window.setTimeout(() => setFechou(null), 3200);
    return () => window.clearTimeout(relogio);
  }, [fechou]);

  const colunaSob = (x: number, y: number) => {
    for (let i = 0; i < colunas.current.length; i++) {
      const el = colunas.current[i];
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top - 40 && y <= r.bottom + 40) return i;
    }
    return -1;
  };

  // Arrastar vale para mouse e caneta; no toque a tela precisa rolar, então vale a seta do cartão.
  const aoPegar = (e: EventoDePonteiro<HTMLDivElement>, n: Negocio) => {
    if (e.pointerType === "touch" || e.button !== 0) return;
    if ((e.target as HTMLElement).closest("button")) return;
    inicio.current = { x: e.clientX, y: e.clientY };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* navegador sem captura: o arraste segue enquanto o ponteiro estiver sobre o cartão */
    }
    setPegando({ id: n.id, x: 0, y: 0, sobre: n.etapa });
  };
  const aoArrastar = (e: EventoDePonteiro<HTMLDivElement>) => {
    if (!pegando || !inicio.current) return;
    setPegando({ id: pegando.id, x: e.clientX - inicio.current.x, y: e.clientY - inicio.current.y, sobre: colunaSob(e.clientX, e.clientY) });
  };
  const aoSoltar = (e: EventoDePonteiro<HTMLDivElement>) => {
    if (!pegando) return;
    const onde = colunaSob(e.clientX, e.clientY);
    if (onde >= 0) mover(pegando.id, onde);
    inicio.current = null;
    setPegando(null);
  };

  const vendido = negocios.filter((n) => n.etapa === ultima).reduce((s, n) => s + n.valor, 0);
  const emJogo = negocios.filter((n) => n.etapa !== ultima).reduce((s, n) => s + n.valor, 0);

  return (
    <div className="vd-vivo" data-funil-vivo="">
      <div className="vd-vivo-topo">
        <div><span>Em negociação</span><strong data-em-jogo="">{dinheiro(emJogo)}</strong></div>
        <div><span>Vendido no mês</span><strong className="vd-verde" data-vendido="">{dinheiro(vendido)}</strong></div>
        <button type="button" className="vd-vivo-reinicia" onClick={() => setNegocios(NEGOCIOS)}>Recomeçar</button>
      </div>
      <div className="vd-vivo-trilho">
        <div className="vd-vivo-colunas">
          {etapas.map((nome, i) => {
            const daqui = negocios.filter((n) => n.etapa === i);
            return (
              <div key={nome} ref={(el) => { colunas.current[i] = el; }} className={pegando && pegando.sobre === i ? "vd-vivo-coluna vd-alvo" : "vd-vivo-coluna"} data-etapa={i}>
                <div className="vd-vivo-nome" style={{ background: CORES[i % CORES.length] }}>
                  <span>{nome}</span>
                  <b>{daqui.length}</b>
                </div>
                <p className="vd-vivo-soma">{dinheiro(daqui.reduce((s, n) => s + n.valor, 0))}</p>
                {daqui.map((n) => {
                  const noAr = pegando && pegando.id === n.id;
                  return (
                    <div
                      key={n.id}
                      className={noAr ? "vd-vivo-cartao vd-no-ar" : "vd-vivo-cartao"}
                      style={noAr ? { transform: `translate3d(${pegando.x}px, ${pegando.y}px, 0) rotate(2deg)` } : undefined}
                      onPointerDown={(e) => aoPegar(e, n)}
                      onPointerMove={aoArrastar}
                      onPointerUp={aoSoltar}
                      onPointerCancel={() => setPegando(null)}
                      data-negocio={n.id}
                    >
                      <strong>{n.nome}</strong>
                      <span>{n.empresa}</span>
                      <em>{dinheiro(n.valor)}</em>
                      {i < ultima ? (
                        <button type="button" onClick={() => mover(n.id, i + 1)} aria-label={`Mover ${n.nome} para ${etapas[i + 1]}`} data-avancar-negocio={n.id}><ArrowRight aria-hidden="true" /></button>
                      ) : (
                        <i aria-hidden="true"><Check /></i>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
      <p className={fechou ? "vd-vivo-aviso vd-on" : "vd-vivo-aviso"} role="status">
        {fechou ? `Negócio fechado: ${fechou.empresa}, ${dinheiro(fechou.valor)}` : ""}
      </p>
    </div>
  );
}
