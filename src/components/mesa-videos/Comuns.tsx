import type { ReactNode } from "react";
import { Database } from "lucide-react";

/**
 * Peças comuns da Mesa Vídeos (Frente V2, 25/09/2026): as etapas e os avisos
 * curtos de "falta ativar". O cartão e o estado vazio são os da Mesa Foto
 * (mesma casa, mesma cara).
 */

export const ETAPAS_DA_MESA_VIDEOS = [
  { valor: "acervo", rotulo: "Acervo", dica: "Fotos de personagem, clone, produto e cenas, e as gravações brutas." },
  { valor: "historia", rotulo: "História", dica: "As cenas do Canvas na ordem, com o pedido de animar cada uma." },
  { valor: "roteiros", rotulo: "Roteiro e cenas", dica: "Roteiros aprovados da Mesa Roteiros ligados às cenas da História." },
  { valor: "edicao", rotulo: "Edição", dica: "Organizador de takes, legenda e o pacote para editar." },
  { valor: "memoria", rotulo: "Versões", dica: "Versões, comentários, custo e aprovação de cada vídeo." },
] as const;

export type EtapaDaMesaVideos = (typeof ETAPAS_DA_MESA_VIDEOS)[number]["valor"];

export const etapaValida = (v: string | null | undefined): EtapaDaMesaVideos =>
  ETAPAS_DA_MESA_VIDEOS.some((e) => e.valor === v) ? (v as EtapaDaMesaVideos) : "acervo";

/** Faixa curta: o que falta ativar para esta parte funcionar. */
export function AvisoDeAtivacao({ children }: { children: ReactNode }) {
  return (
    <p className="mb-3 flex items-start rounded-lg border border-warning/40 bg-warning/5 px-3 py-2 text-[12px] leading-snug text-foreground" data-aviso-de-ativacao="">
      <Database className="mr-2 mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
      <span className="min-w-0 [overflow-wrap:anywhere]">{children}</span>
    </p>
  );
}

export const ROTULO_DO_TIPO: Record<string, string> = {
  bruto: "Gravação",
  take: "Take",
  gerado: "Gerado",
  audio: "Áudio",
  entrega: "Entrega",
};

export function SeloDoTipo({ tipo }: { tipo: string }) {
  const gerado = tipo === "gerado";
  return (
    <span
      className={`mr-1 inline-flex items-center rounded-full border bg-card px-1.5 py-px text-[10px] font-medium ${gerado ? "border-primary/30 text-primary" : "border-border text-muted-foreground"}`}
      title={gerado ? "Gerado por IA" : undefined}
    >
      {ROTULO_DO_TIPO[tipo] || tipo}
    </span>
  );
}
