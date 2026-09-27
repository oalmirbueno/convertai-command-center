/**
 * Rascunho do "Avatar falando" (frente V-C, 26/09/2026), fora do componente
 * para o Kit UGC preencher o roteiro sem baixar a tela do avatar junto.
 */

export interface RascunhoDoAvatar {
  fonte: "estoque" | "clone";
  avatar: string;
  clone: string;
  voz: string;
  roteiro: string;
  formato: string;
  resolucao: string;
  legendas: boolean;
  velocidade: number;
  confirma: boolean;
  titulo: string;
}

export const RASCUNHO_DO_AVATAR: RascunhoDoAvatar = { fonte: "estoque", avatar: "", clone: "", voz: "", roteiro: "", formato: "9:16", resolucao: "1080p", legendas: true, velocidade: 1, confirma: false, titulo: "" };

/** Chave do rascunho no navegador (por cliente). */
export const chaveDoRascunhoDoAvatar = (clientId: string) => `mesa-videos:avatar:${clientId}`;

/**
 * Começo de roteiro a partir do kit UGC: só o que a equipe escreveu (o gancho)
 * e o convite do kit. Nada é inventado; o meio fica para a equipe completar.
 */
export function roteiroDoKitUgc(valores: Record<string, string>): string {
  const gancho = String(valores.gancho || "").trim();
  return [gancho, "Link aqui embaixo."].filter(Boolean).join("\n\n");
}
