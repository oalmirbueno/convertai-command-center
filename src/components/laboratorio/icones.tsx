import {
  BadgeDollarSign,
  Bot,
  Brush,
  Clapperboard,
  FileText,
  Filter,
  Globe,
  Image as ImageIcon,
  Images,
  LayoutList,
  ListOrdered,
  Megaphone,
  MessagesSquare,
  Orbit,
  PenLine,
  Rocket,
  Send,
  ShoppingCart,
  SlidersHorizontal,
  Sparkles,
  Telescope,
  TrendingDown,
  TrendingUp,
  UserRound,
  WandSparkles,
  type LucideIcon,
} from "lucide-react";
import type { TipoDeNo } from "@/lib/laboratorio/nos";

/** Ícone de cada tipo de nó (paleta, cartão no quadro, modo lista). Um por tipo, sem repetir. */
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
  pesquisa: Telescope,
  oferta: BadgeDollarSign,
  funil: Filter,
  filme: Clapperboard,
  por_no_ar: Rocket,
  avatar: UserRound,
  order_bump: ShoppingCart,
  upsell: TrendingUp,
  downsell: TrendingDown,
  sequencia_ofertas: ListOrdered,
  secoes_pagina: LayoutList,
  sequencia_mensagens: MessagesSquare,
  refino_tom: WandSparkles,
};

export function IconeDoNo({ tipo, className = "h-4 w-4" }: { tipo: TipoDeNo; className?: string }) {
  const I = ICONES_DOS_NOS[tipo];
  return <I className={className} aria-hidden="true" />;
}
