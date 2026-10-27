import { useState, type CSSProperties } from "react";
import { iniciaisDoCliente, juntarCandidatas, type FotoDoCliente as Foto } from "@/lib/fotoDoCliente";
import { useFotosDosClientes } from "@/hooks/useFotosDosClientes";

const TAMANHO = {
  sm: { caixa: "h-9 w-9", texto: "text-[12px]", borda: "p-1" },
  md: { caixa: "h-10 w-10", texto: "text-[13px]", borda: "p-1" },
  lg: { caixa: "h-12 w-12", texto: "text-[14px]", borda: "p-1.5" },
  xl: { caixa: "h-16 w-16", texto: "text-[20px]", borda: "p-2" },
} as const;

interface Props {
  nome: string;
  /** Uma foto que a tela ja tem em maos (entra antes das outras). */
  foto?: Foto | null;
  /** Candidatas em ordem; a seguinte entra se a anterior nao abrir. */
  fotos?: readonly Foto[] | null;
  /** Com o id, busca sozinho as candidatas do cliente (cache unico da carteira). */
  clienteId?: string | null;
  tamanho?: keyof typeof TAMANHO;
  /** Lado em px, no lugar de `tamanho` (o LogoDoCliente usa). */
  lado?: number;
  forma?: "redonda" | "quadrada";
  /** Dica quando so sobram as iniciais. */
  tituloSemFoto?: string;
  alt?: string;
  className?: string;
}

/**
 * O circulo com a cara do cliente. Foto (cadastro ou Instagram) preenche o
 * circulo; logo de arquivo entra inteira, com respiro e fundo claro, para
 * nao cortar a marca nem sumir num fundo escuro. Se a imagem nao abrir
 * (link vencido, arquivo sumido), passa para a candidata seguinte; so sem
 * nenhuma aparecem as iniciais. A caixa tem tamanho fixo desde o primeiro
 * quadro: a imagem chegando nao empurra a linha.
 */
export default function FotoDoCliente(props: Props) {
  if (props.clienteId) return <FotoComBusca {...props} clienteId={props.clienteId} />;
  return <Desenho {...props} lista={juntarCandidatas([props.fotos, [props.foto]])} />;
}

function FotoComBusca(props: Props & { clienteId: string }) {
  const { fotosDe } = useFotosDosClientes();
  return <Desenho {...props} lista={juntarCandidatas([props.fotos, [props.foto], fotosDe(props.clienteId)])} />;
}

function Desenho({ nome, lista, tamanho = "md", lado, forma = "redonda", tituloSemFoto, alt, className = "" }: Props & { lista: Foto[] }) {
  // Guarda as que falharam (e nao um indice): a lista pode mudar quando a consulta chega.
  const [quebradas, setQuebradas] = useState<readonly string[]>([]);
  const atual = lista.find((f) => !quebradas.includes(f.url)) ?? null;
  const t = TAMANHO[tamanho];
  const arredondado = forma === "quadrada" ? "rounded-xl" : "rounded-full";
  const caixa = lado ? "" : t.caixa;
  const estilo: CSSProperties | undefined = lado ? { width: lado, height: lado } : undefined;
  const base = `${caixa} shrink-0 overflow-hidden ${arredondado} ${className}`;
  const quebrou = (url: string) => setQuebradas((q) => (q.includes(url) ? q : [...q, url]));

  if (!atual) {
    return (
      <div
        className={`${base} flex items-center justify-center bg-primary/15 font-semibold text-primary ${lado ? "" : t.texto}`}
        style={lado ? { ...estilo, fontSize: Math.max(10, lado * 0.32) } : undefined}
        aria-label={nome}
        title={tituloSemFoto}
        role="img"
      >
        {iniciaisDoCliente(nome)}
      </div>
    );
  }
  const texto = alt ?? nome;
  if (atual.tipo === "logo") {
    return (
      <div
        className={`${base} flex items-center justify-center bg-white ring-1 ring-border ${lado ? "" : t.borda}`}
        style={lado ? { ...estilo, padding: Math.max(2, Math.round(lado * 0.1)) } : undefined}
      >
        <img key={atual.url} src={atual.url} alt={texto} loading="lazy" onError={() => quebrou(atual.url)} className="h-full w-full object-contain" />
      </div>
    );
  }
  return (
    <div className={`${base} bg-secondary ring-1 ring-border/60`} style={estilo}>
      {/* A CDN da Meta recusa requisicao com referer de outro dominio. */}
      <img key={atual.url} src={atual.url} alt={texto} loading="lazy" referrerPolicy="no-referrer" onError={() => quebrou(atual.url)} className="h-full w-full object-cover" />
    </div>
  );
}
