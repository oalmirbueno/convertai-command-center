import type { ComponentType } from "react";

/**
 * As seções na ordem de pacote.secoes. O agente acrescenta uma por vez:
 *   import Hero from "./Hero";
 *   { id: "hero", Componente: Hero },
 */
export const SECOES: Array<{ id: string; Componente: ComponentType }> = [];
