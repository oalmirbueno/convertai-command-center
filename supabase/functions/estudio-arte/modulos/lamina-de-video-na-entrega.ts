/**
 * Lâmina de vídeo na entrega (23/10/2026, dono: "deixe tudo pronto"): o carrossel estilo X com uma lâmina de
 * vídeo vai para Arquivos e para a Agenda com o MP4 dessa lâmina no lugar do PNG, na mesma posição. Assim a
 * publicação automática (editorial_autopublish_tick, migration 20261023160000) manda o item como VIDEO no
 * carrossel do Instagram.
 *
 * Regra (nunca trava a entrega): a lâmina só entra em MP4 quando a versão atual é de carrossel com vídeo no
 * bloco, o MP4 dessa MESMA versão está pronto (video_path gravado na versão ou o pedido 'lamina_video' pronto)
 * e a lâmina já está no formato final do post. Fora disso, segue o PNG de sempre.
 * Puro (a função e o Vitest leem o mesmo arquivo).
 */

export interface VersaoComVideo {
  ordem: number;
  versao: number;
  tamanho?: string | null;
  video_path?: string | null;
  template_profile?: { estilo?: string; bloco?: { tipo?: string } | null } | null;
}

export interface PedidoDaLaminaPronto {
  estado: string;
  saida_path: string | null;
  entrada: { ordem?: unknown; versao?: unknown } | null;
  criado_em?: string | null;
}

/** O MP4 guardado pelo render: na pasta de vídeos do Template deste cliente, sem volta de pasta. */
export function caminhoDeVideoDaLamina(caminho: unknown, clientId: string): string | null {
  if (typeof caminho !== "string" || caminho.length > 500) return null;
  if (!caminho.startsWith(`${clientId}/estudio/template/videos/`) || !/\.mp4$/i.test(caminho)) return null;
  if (caminho.split("/").some((s) => !s || s === "." || s === "..") || /[\\%?#:'"]/.test(caminho)) return null;
  return caminho;
}

/** A lâmina pede vídeo: a versão atual é do carrossel estilo X com vídeo no bloco. */
export const laminaComVideo = (v: VersaoComVideo | null | undefined): boolean =>
  !!v && !!v.template_profile && v.template_profile.estilo === "carrossel" && !!v.template_profile.bloco && v.template_profile.bloco.tipo === "video";

/**
 * O MP4 pronto da versão atual da lâmina, ou null (fica o PNG). O gravado na versão vale primeiro; sem ele, o
 * pedido pronto mais novo desta lâmina e desta versão (a tela pode não ter consultado o andamento).
 */
export function videoProntoDaLamina(v: VersaoComVideo | null | undefined, pedidos: PedidoDaLaminaPronto[], clientId: string): string | null {
  if (!v || !laminaComVideo(v)) return null;
  const gravado = caminhoDeVideoDaLamina(v.video_path, clientId);
  if (gravado) return gravado;
  const prontos = pedidos
    .filter((p) => p && p.estado === "pronto" && p.entrada && Number(p.entrada.ordem) === v.ordem && Number(p.entrada.versao) === v.versao)
    .sort((a, b) => String(b.criado_em || "").localeCompare(String(a.criado_em || "")));
  for (const p of prontos) {
    const c = caminhoDeVideoDaLamina(p.saida_path, clientId);
    if (c) return c;
  }
  return null;
}
