import {
  Bot,
  Brush,
  FileText,
  Globe,
  Image as ImageIcon,
  Images,
  Megaphone,
  Orbit,
  PenLine,
  Send,
  SlidersHorizontal,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import type { TipoDeNo } from "@/lib/laboratorio/nos";

/** Ícone de cada tipo de nó (paleta, cartão no quadro, modo lista). */
export const ICONES_DOS_NOS: Record<TipoDeNo, LucideIcon> = {
  contexto: FileText,
  midia: ImageIcon,
  config: SlidersHorizontal,
  gravity: Orbit,
  agente: Bot,
  copy: PenLine,
  imagem: Sparkles,
  carrossel: Images,
  logo: Brush,
  landing: Globe,
  anuncio: Megaphone,
  agente_externo: Send,
};

export function IconeDoNo({ tipo, className = "h-4 w-4" }: { tipo: TipoDeNo; className?: string }) {
  const I = ICONES_DOS_NOS[tipo];
  return <I className={className} aria-hidden="true" />;
}
