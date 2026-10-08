import { createContext, type RefObject } from "react";

/**
 * Onde a área de trabalho mede a altura que cabe (09/10/2026). Fora da
 * Central é a janela (null). Dentro de uma ferramenta aberta na Central
 * (src/components/execucao/central/FerramentaNativa.tsx), é a caixa dela: a
 * mesa cabe na lateral, no pop-up ou na área maior sem passar do fundo.
 */
export const ContainerDaArea = createContext<RefObject<HTMLElement> | null>(null);
