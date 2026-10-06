import { createContext } from "react";
import type { ReactNode } from "react";

/** Os controles de formato compartilham a barra da mídia, sem repetir o título. */
export const ControlesDaPauta = createContext<ReactNode>(null);
