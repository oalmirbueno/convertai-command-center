import { EstadoVazio } from "@/components/sistema/Estados";

/**
 * Estúdio de mockups da Mesa Identidade: a frente MCK é dona deste arquivo e
 * troca este esboço pelo estúdio de verdade (biblioteca central de mockups
 * com a logo aplicada por código). A assinatura fica: clientId e marcaId.
 */
export default function EstudioDeMockups({ clientId, marcaId }: { clientId: string; marcaId: string | null }) {
  return (
    <div data-estudio-de-mockups="" data-cliente={clientId} data-marca={marcaId || ""}>
      <EstadoVazio titulo="Estúdio de mockups em preparação" descricao="A etapa segue sem mockups." compacto />
    </div>
  );
}
