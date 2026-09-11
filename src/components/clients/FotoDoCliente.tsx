import { useEffect, useState } from "react";
import { iniciaisDoCliente, type FotoDoCliente as Foto } from "@/lib/fotoDoCliente";

const TAMANHO = {
  sm: { caixa: "h-9 w-9", texto: "text-[12px]", borda: "p-1" },
  md: { caixa: "h-10 w-10", texto: "text-[13px]", borda: "p-1" },
  lg: { caixa: "h-12 w-12", texto: "text-[14px]", borda: "p-1.5" },
  xl: { caixa: "h-16 w-16", texto: "text-lg", borda: "p-2" },
} as const;

interface Props {
  nome: string;
  foto: Foto | null;
  tamanho?: keyof typeof TAMANHO;
  className?: string;
}

/**
 * O circulo com a cara do cliente. Foto (cadastro ou Instagram) preenche o
 * circulo; logo de arquivo entra inteira, com respiro e fundo claro, para
 * nao cortar a marca nem sumir num fundo escuro. Sem imagem, as iniciais.
 */
export default function FotoDoCliente({ nome, foto, tamanho = "md", className = "" }: Props) {
  const [quebrou, setQuebrou] = useState(false);
  useEffect(() => { setQuebrou(false); }, [foto?.url]);
  const t = TAMANHO[tamanho];
  const base = `${t.caixa} shrink-0 overflow-hidden rounded-full ${className}`;

  if (!foto || quebrou) {
    return (
      <div className={`${base} flex items-center justify-center bg-primary/15 font-semibold text-primary ${t.texto}`} aria-label={nome} role="img">
        {iniciaisDoCliente(nome)}
      </div>
    );
  }
  if (foto.tipo === "logo") {
    return (
      <div className={`${base} flex items-center justify-center bg-white ring-1 ring-border ${t.borda}`}>
        <img src={foto.url} alt={nome} loading="lazy" onError={() => setQuebrou(true)} className="h-full w-full object-contain" />
      </div>
    );
  }
  return (
    <div className={`${base} bg-secondary ring-1 ring-border/60`}>
      <img src={foto.url} alt={nome} loading="lazy" referrerPolicy="no-referrer" onError={() => setQuebrou(true)} className="h-full w-full object-cover" />
    </div>
  );
}
