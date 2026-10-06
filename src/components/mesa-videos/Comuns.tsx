import type { ReactNode } from "react";
import { Database } from "lucide-react";

/**
 * Peças comuns da Mesa Vídeos (Frente V2, 25/09; frente E2, 26/09): as etapas
 * e os avisos curtos de "falta ativar".
 *
 * Frente E2: a Mesa Vídeos ficou só com a GERAÇÃO (Base, Gerar, Resultados).
 * Subir vídeos de fora, organizar e editar foram para a Mesa Edição
 * (/mesa-edicao). Endereço antigo com etapa=edicao ou etapa=memoria abre a
 * Edição no lugar certo; acervo, história e roteiros abrem a Base.
 */

export const ETAPAS_DA_MESA_VIDEOS = [
  { valor: "base", rotulo: "Base", dica: "Cenas da História, roteiros aprovados, personagens e produtos." },
  // Frente V-A (26/09): kit ou template, bíblia e roteiro do diretor antes de gerar.
  { valor: "kit", rotulo: "Kit", dica: "Kits de vídeo por nicho e templates salvos." },
  { valor: "biblia", rotulo: "Bíblia", dica: "Personagens, cenários, luz e regras de continuidade." },
  { valor: "roteiro", rotulo: "Roteiro", dica: "Planos com duração, câmera, motor e custo." },
  { valor: "gerar", rotulo: "Gerar", dica: "Cena, modo livre, ângulo, continuar e antes e depois, com o custo antes." },
  { valor: "resultados", rotulo: "Resultados", dica: "Vídeos gerados: aprovar e mandar para a Edição." },
] as const;

export type EtapaDaMesaVideos = (typeof ETAPAS_DA_MESA_VIDEOS)[number]["valor"];

/** Etapas antigas (antes da E2) que agora são a Base. */
const ANTIGAS_DA_BASE = ["acervo", "historia", "roteiros"];
/** Etapas antigas que agora moram na Mesa Edição. */
const ANTIGAS_DA_EDICAO: Record<string, string> = { edicao: "organizar", memoria: "editar" };

export const etapaValida = (v: string | null | undefined): EtapaDaMesaVideos =>
  !v ? "gerar" : ETAPAS_DA_MESA_VIDEOS.some((e) => e.valor === v) ? (v as EtapaDaMesaVideos) : "base";

/** Etapa antiga da Mesa Vídeos que virou etapa da Mesa Edição (ou null). */
export const etapaAntigaDaEdicao = (v: string | null | undefined): string | null => (v && ANTIGAS_DA_EDICAO[v]) || null;

export const ehEtapaAntigaDaBase = (v: string | null | undefined) => !!v && ANTIGAS_DA_BASE.indexOf(v) >= 0;

/** Faixa curta: o que falta ativar para esta parte funcionar. */
export function AvisoDeAtivacao({ children }: { children: ReactNode }) {
  return (
    <p className="mb-3 flex items-start rounded-md border border-warning/40 bg-warning/5 px-3 py-2 text-[12px] leading-snug text-foreground" data-aviso-de-ativacao="">
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
  angulo: "Ângulo",
  quadro: "Quadro",
};

export function SeloDoTipo({ tipo }: { tipo: string }) {
  const gerado = tipo === "gerado";
  return (
    <span
      className={`mr-1 inline-flex items-center rounded-full border bg-card px-1.5 py-px text-[11px] font-medium leading-4 ${gerado ? "border-primary/30 text-primary" : "border-border text-muted-foreground"}`}
      title={gerado ? "Gerado por IA" : undefined}
    >
      {ROTULO_DO_TIPO[tipo] || tipo}
    </span>
  );
}
