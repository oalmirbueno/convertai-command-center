import { useEffect, useRef, useState } from "react";
import { Monitor, Smartphone, Tablet } from "lucide-react";
import SeletorCompacto from "@/components/sistema/SeletorCompacto";
import { juntar, superficie, texto } from "@/components/sistema/estilos";
import { useEstadoDaTela } from "@/components/sistema/useEstadoDaTela";

export const APARELHOS = [
  { id: "celular", rotulo: "Celular", largura: 375, altura: 760 },
  { id: "tablet", rotulo: "Tablet", largura: 768, altura: 1024 },
  { id: "computador", rotulo: "Computador", largura: 1280, altura: 800 },
] as const;
export type Aparelho = (typeof APARELHOS)[number]["id"];

/** Escala para o aparelho caber na largura da área (nunca aumenta). */
export const escalaDoAparelho = (larguraDaArea: number, larguraDoAparelho: number) => (larguraDaArea > 0 ? Math.min(1, larguraDaArea / larguraDoAparelho) : 1);

const ICONE = { celular: <Smartphone className="h-3.5 w-3.5" />, tablet: <Tablet className="h-3.5 w-3.5" />, computador: <Monitor className="h-3.5 w-3.5" /> };

/**
 * Prévia do site no celular, no tablet e no computador (SIT2): o iframe tem a
 * largura real do aparelho e encolhe por escala para caber (sem rolagem
 * lateral). A escolha fica guardada por pessoa. Mede a área no resize (sem
 * ResizeObserver obrigatório: Safari 11).
 */
export default function PreviaNosAparelhos({ url, titulo }: { url: string; titulo: string }) {
  const [aparelho, setAparelho] = useEstadoDaTela<Aparelho>("mesa-site:previa:aparelho", "computador", { validar: (v): v is Aparelho => APARELHOS.some((a) => a.id === v) });
  const area = useRef<HTMLDivElement | null>(null);
  const [largura, setLargura] = useState(0);
  const a = APARELHOS.find((x) => x.id === aparelho) || APARELHOS[2];

  useEffect(() => {
    const medir = () => setLargura(area.current ? area.current.clientWidth : 0);
    medir();
    window.addEventListener("resize", medir);
    window.addEventListener("orientationchange", medir);
    const t = setTimeout(medir, 250);
    return () => {
      window.removeEventListener("resize", medir);
      window.removeEventListener("orientationchange", medir);
      clearTimeout(t);
    };
  }, []);

  const escala = escalaDoAparelho(largura, a.largura);
  return (
    <div className="min-w-0 space-y-2" data-previa-nos-aparelhos={aparelho}>
      <div className="flex min-w-0 items-center">
        <SeletorCompacto rotulo="Aparelho da prévia" opcoes={APARELHOS.map((x) => ({ valor: x.id, rotulo: x.rotulo, icone: ICONE[x.id] }))} valor={aparelho} onEscolher={(v) => setAparelho(v as Aparelho)} />
        <span className={juntar(texto.auxiliar, "ml-2 truncate")}>
          {a.largura} px{escala < 1 ? ` · ${Math.round(escala * 100)}%` : ""}
        </span>
      </div>
      <div ref={area} className="min-w-0 overflow-hidden">
        <div className={juntar(superficie.painel, "mx-auto overflow-hidden")} style={{ width: Math.round(a.largura * escala), height: Math.round(a.altura * escala) }} data-previa-do-site="">
          <iframe
            title={`Prévia do site ${titulo} no ${a.rotulo.toLowerCase()}`}
            src={url}
            width={a.largura}
            height={a.altura}
            className="block bg-white"
            style={{ width: a.largura, height: a.altura, transform: `scale(${escala})`, transformOrigin: "0 0", border: 0 }}
            sandbox="allow-scripts allow-same-origin allow-forms"
          />
        </div>
      </div>
    </div>
  );
}
