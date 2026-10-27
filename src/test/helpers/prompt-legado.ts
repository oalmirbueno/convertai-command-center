import { expect } from "vitest";
import { direcaoCriativaParaImagem } from "../../../supabase/functions/_shared/motor-criativo-campanha";

type ContextoDaCampanha = {
  anuncio?: { formato: string; tom?: string | null } | null;
  referencia?: boolean;
  fotoReal?: string | null;
};

/**
 * O fixture anterior ao motor continua intocado. Só anúncios podem acrescentar
 * exatamente um bloco completo de campanha; todo o restante, inclusive os
 * separadores e os blocos posteriores de estilo/render, continua byte a byte.
 * Não usa regex que possa esconder outras seções ou diferenças de conteúdo.
 */
export function expectPromptLegado(
  atual: string,
  legado: string,
  contexto: ContextoDaCampanha,
  nome?: string,
): void {
  const titulo = "DIREÇÃO CRIATIVA DA CAMPANHA";
  expect(legado, nome).not.toContain(titulo);
  if (!contexto.anuncio) {
    expect(atual, nome).not.toContain(titulo);
    expect(atual, nome).toBe(legado);
    return;
  }
  const campanha = direcaoCriativaParaImagem({
    formato: contexto.anuncio.formato,
    sobrio: contexto.anuncio.tom === "sobrio",
    referencia: contexto.referencia,
    fotoFixa: !!contexto.fotoReal,
  });
  expect(atual.split(titulo), `${nome || "anúncio"}: um único bloco`).toHaveLength(2);
  expect(atual.split(`${campanha}\n`), `${nome || "anúncio"}: bloco completo`).toHaveLength(2);
  expect(atual.replace(`${campanha}\n`, ""), nome).toBe(legado);
}
