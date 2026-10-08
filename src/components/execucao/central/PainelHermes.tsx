import DiarioDaCoordenacao from "./DiarioDaCoordenacao";
import type { ContextoDoHermes } from "./ChatDoHermes";

/**
 * Compatibilidade (08/10/2026): as sessões do Hermes viraram o ChatDoHermes,
 * ao lado do Gestor. Aqui fica só o diário da coordenação, para quem ainda
 * importa o painel antigo.
 */
export default function PainelHermes({ contexto }: { contexto: ContextoDoHermes }) {
  return <DiarioDaCoordenacao contexto={contexto} />;
}
