import { projetoDosTakes, type ProjetoDeEdicao } from "../../../supabase/functions/_shared/projeto-de-edicao";

/**
 * Projeto vazio para começar um vídeo do zero no Editar (02/10, dono: "quero
 * poder criar como quiser, até começar um vídeo do zero"). As trilhas nascem
 * vazias; o agente (cena, texto, motion, mídia, música, gerar) ou a mão monta.
 */
export function projetoDoZero(titulo = "Vídeo do zero", formato = "9:16", agora: string | null = null): ProjetoDeEdicao {
  return projetoDosTakes({ titulo: String(titulo || "Vídeo do zero").slice(0, 120), formato, fps: 30, takes: [], agora });
}
