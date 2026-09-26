/**
 * Mesa Edição (/mesa-edicao, frente E2, 26/09): subir vídeos de fora,
 * organizar e editar. Usa as tabelas e a função da Mesa Vídeos
 * (src/components/mesa-videos/videosApi.ts, supabase/functions/mesa-videos).
 */

export const ETAPAS_DA_MESA_EDICAO = [
  { valor: "entrada", rotulo: "Entrada", dica: "Subir vídeos de fora e os aprovados da Mesa Vídeos; transcrição." },
  { valor: "organizar", rotulo: "Organizar", dica: "Separar por roteiro, cena e tomada, com os melhores takes." },
  { valor: "editar", rotulo: "Editar", dica: "Edição dinâmica: projeto, pacote para editar e versões." },
] as const;

export type EtapaDaMesaEdicao = (typeof ETAPAS_DA_MESA_EDICAO)[number]["valor"];

export const etapaValidaDaEdicao = (v: string | null | undefined): EtapaDaMesaEdicao =>
  ETAPAS_DA_MESA_EDICAO.some((e) => e.valor === v) ? (v as EtapaDaMesaEdicao) : "entrada";
