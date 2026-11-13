import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Peças da página de venda do CRM: a entrada por rolagem e as molduras que
 * mostram as telas reais do produto (capturas do próprio CRM com dados de
 * exemplo, guardadas em src/assets/venda).
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
export function Revela({ children, className = "", atraso = 0, como = "div" }: { children: ReactNode; className?: string; atraso?: 0 | 1 | 2 | 3 | 4; como?: "div" | "li" | "section" | "h1" }) {
  const { ref, visto } = useNaTela<HTMLDivElement>();
  const Tag = como as "div";
  return (
    <Tag ref={ref} className={`vd-rev${atraso ? ` vd-a${atraso}` : ""}${visto ? " vd-on" : ""}${className ? ` ${className}` : ""}`}>
      {children}
    </Tag>
  );
}

/** A tela do produto no computador, numa moldura de navegador. As medidas reservam o espaço antes de a imagem chegar. */
export function TelaReal({ src, alt, endereco, cedo = false, className = "" }: { src: string; alt: string; endereco: string; cedo?: boolean; className?: string }) {
  const { ref, visto } = useNaTela<HTMLDivElement>();
  return (
    <div ref={ref} className={`vd-janela vd-rev${visto ? " vd-on" : ""}${className ? ` ${className}` : ""}`}>
      <div className="vd-janela-topo" aria-hidden="true">
        <b />
        <b />
        <b />
        <span>{endereco}</span>
      </div>
      <img src={src} alt={alt} width={1800} height={1137} loading={cedo ? "eager" : "lazy"} decoding="async" draggable={false} />
    </div>
  );
}

/** A mesma tela no celular. */
export function TelaNoCelular({ src, alt, cedo = false, className = "" }: { src: string; alt: string; cedo?: boolean; className?: string }) {
  const { ref, visto } = useNaTela<HTMLDivElement>();
  return (
    <div ref={ref} className={`vd-celular vd-rev vd-a2${visto ? " vd-on" : ""}${className ? ` ${className}` : ""}`}>
      <img src={src} alt={alt} width={585} height={1266} loading={cedo ? "eager" : "lazy"} decoding="async" draggable={false} />
    </div>
  );
}
