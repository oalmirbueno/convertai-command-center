import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { resolveFileUrl } from "@/lib/fileUrls";
import { lerCatalogo, type ModeloIa } from "@/lib/mesa/api";
import { projetosDaMarca, type MarcaDoCliente } from "@/lib/mesa/marcas";

/**
 * O que todas as abas da Mesa precisam saber sem repassar de mão em mão:
 * qual cliente está aberto, quem está usando, o catálogo de modelos e os
 * atalhos para o próximo passo quando a IA recusa (recarregar, chaves).
 */
export interface MesaValor {
  clientId: string;
  clientName: string;
  userId: string | null;
  isAdmin: boolean;
  podeRecarregar: boolean;
  saldoUsd: number | null;
  catalogo: ModeloIa[];
  catalogoCarregando: boolean;
  atualizarCusto: () => void;
  abrirRecarga: () => void;
  abrirChaves: () => void;
  abrirModelos: () => void;
  /**
   * Sobe a cada recarga da carteira concluída. Avisos de saldo insuficiente
   * mostrados antes da recarga somem quando ela muda (AvisoDeErro).
   */
  versaoCarteira?: number;
  /**
   * Marca por projeto (src/lib/mesa/marcas.ts): só no cliente com 2 ou mais
   * marcas (hoje, a Acerbi com Acerbi e CME). Sem isso, vazio e nulo, e a
   * Mesa segue como sempre.
   */
  marcas?: MarcaDoCliente[];
  marca?: MarcaDoCliente | null;
}

/** Marca aberta na casca e a lista do cliente (lista vazia e null quando não há marca). */
export function useMarcaDaMesa(): { marca: MarcaDoCliente | null; marcas: MarcaDoCliente[] } {
  const v = useContext(Contexto);
  return { marca: (v && v.marca) || null, marcas: (v && v.marcas) || [] };
}

/** Projetos da marca aberta ({ so } ou { menos }); null sem marca. Mesmo objeto enquanto a marca não muda. */
export function useFiltroDaMarca() {
  const { marca, marcas } = useMarcaDaMesa();
  const filtro = projetosDaMarca(marca, marcas);
  const chave = filtro ? JSON.stringify(filtro) : "";
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => filtro, [chave]);
}

const Contexto = createContext<MesaValor | null>(null);

export function MesaProvider({ valor, children }: { valor: MesaValor; children: ReactNode }) {
  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}

export function useMesa(): MesaValor {
  const v = useContext(Contexto);
  if (!v) throw new Error("useMesa fora da Mesa do cliente");
  return v;
}

/**
 * Catálogo de modelos: muda pouco (o dono ativa um modelo de vez em quando e
 * a tela de Modelos invalida esta chave). Fica 30 minutos sem reler e vai
 * para o navegador, então a Mesa abre já com os preços.
 */
export function useCatalogo() {
  return useQuery({
    queryKey: ["mesa", "catalogo"],
    queryFn: lerCatalogo,
    staleTime: 30 * 60_000,
  });
}

/**
 * URL assinada de um arquivo da Mesa. Caminho simples mora no bucket `mesa`;
 * caminho com prefixo (workspace://, files://) segue o resolvedor do painel.
 */
export function useUrlDaMesa(caminho?: string | null, bucket = "mesa") {
  return useQuery({
    queryKey: ["mesa", "url", bucket, caminho],
    enabled: !!caminho,
    // A URL assinada vale 1 hora: relê aos 45 min e fica na memória até os
    // 55, para voltar à tela sem assinar e baixar a imagem de novo. Não vai
    // para o navegador (vence).
    staleTime: 45 * 60_000,
    gcTime: 55 * 60_000,
    queryFn: async () => {
      const c = String(caminho);
      if (c.indexOf("://") > 0) return resolveFileUrl({ fileUrl: c });
      const { data, error } = await supabase.storage.from(bucket).createSignedUrl(c, 3600);
      if (error || !data?.signedUrl) throw error || new Error("Imagem indisponível");
      return data.signedUrl;
    },
  });
}

/** Imagem guardada na Mesa, com espaço reservado enquanto a URL chega. */
export function ImagemDaMesa({
  caminho,
  alt,
  className = "",
  bucket = "mesa",
}: {
  caminho?: string | null;
  alt: string;
  className?: string;
  bucket?: string;
}) {
  const { data: url, isError } = useUrlDaMesa(caminho, bucket);
  if (!caminho || isError) {
    return (
      <div className={`flex items-center justify-center bg-secondary/60 text-[11px] text-muted-foreground ${className}`}>
        {isError ? "Imagem indisponível" : "Sem imagem"}
      </div>
    );
  }
  if (!url) return <div className={`animate-pulse bg-secondary/60 ${className}`} />;
  return <img src={url} alt={alt} loading="lazy" className={`object-cover ${className}`} />;
}
