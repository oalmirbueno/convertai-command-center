/**
 * Quem aprende no painel: a lista única das mesas e agentes que guardam
 * regras no cérebro do cliente (frente SYNC, 30/09/2026).
 *
 * Pedido do dono: "aprende e evolui também, mesma lógica". As mesas usam
 * aprendizado-das-mesas.ts; os agentes da Mesa do cliente (contexto, Mês,
 * campanha, redes, perfil) e os agentes gerais (Central, assistente,
 * Workspace, tráfego) chegaram antes com o mesmo desenho (filtro barato, o
 * Jev decide se é duradoura, gravarNoCerebro reforça ou aposenta, "Aprendi"
 * e "Segui" na conversa). Aqui ficam juntos, num arquivo puro, para:
 * - o servidor saber a área e a fonte de cada mesa (aprendizado-das-mesas.ts
 *   reexporta daqui);
 * - a tela "O que o painel aprendeu" listar TODAS as mesas, com o nome de
 *   cada uma, sem lista copiada à mão;
 * - a regra "o que vale para todas as mesas" ser uma só.
 *
 * Sem import. Sem travessão.
 */

/** Mesas que aprendem por aprendizado-das-mesas.ts (a mesa fica na fonte da linha). */
export const MESAS_QUE_APRENDEM = [
  "foto",
  "video",
  "edicao",
  "publicidade",
  "roteiro",
  "estilo",
  "estudio",
  "contrato",
  "identidade",
  "naming",
  "proposta",
  "site",
  "motion",
  // Frente SYNC (30/09): a conversa do conselho (perguntar) e o estúdio de mockups também aprendem.
  "conselho",
  "mockups",
] as const;
export type MesaQueAprende = (typeof MESAS_QUE_APRENDEM)[number];

/** Área do cérebro de cada mesa (as áreas do banco são fixas; a mesa fica na fonte). */
export const AREA_DA_MESA: Record<MesaQueAprende, "geral" | "calendario" | "campanha" | "arte" | "foto" | "ads" | "copy" | "conta"> = {
  foto: "foto",
  video: "arte",
  edicao: "arte",
  publicidade: "campanha",
  roteiro: "copy",
  estilo: "arte",
  estudio: "arte",
  contrato: "geral",
  identidade: "arte",
  naming: "copy",
  proposta: "copy",
  site: "arte",
  motion: "arte",
  conselho: "campanha",
  mockups: "arte",
};

export const FONTE_DA_MESA: Record<MesaQueAprende, string> = {
  foto: "mesa_foto",
  video: "mesa_videos",
  edicao: "mesa_edicao",
  publicidade: "mesa_publicidade",
  roteiro: "mesa_roteiros",
  estilo: "estilo",
  estudio: "estudio_aprendizado",
  contrato: "mesa_contratos",
  identidade: "mesa_identidade",
  naming: "mesa_naming",
  proposta: "mesa_proposta",
  site: "mesa_site",
  motion: "mesa_motion",
  conselho: "mesa_conselho",
  mockups: "mesa_mockups",
};

export const NOME_DA_MESA: Record<MesaQueAprende, string> = {
  foto: "Mesa Foto (diretor de fotografia)",
  video: "Mesa Vídeos (diretor de vídeo)",
  edicao: "Mesa Edição (editor de vídeo)",
  publicidade: "Mesa Publicidade (diretor de campanha)",
  roteiro: "Mesa Roteiros (roteirista)",
  estilo: "Estilo do cliente (diretor de arte)",
  estudio: "Estúdio (diretor de arte das lâminas e o Ajustar)",
  contrato: "Contratos (agente de contratos)",
  identidade: "Mesa Identidade (diretor de marca)",
  naming: "Mesa Identidade (criador de nomes)",
  proposta: "Mesa Proposta (estrategista comercial)",
  site: "Mesa Site (diretor de site)",
  motion: "Mesa Motion (diretor de motion)",
  conselho: "Conselho de agentes (moderador)",
  mockups: "Mesa Mockups (diretor de aplicação)",
};

export type EscolaDoAprendizado = "mesas" | "mesa_do_cliente" | "agentes_gerais";

/**
 * Toda fonte de regra do painel com o nome curto da mesa (para a tela). As
 * três escolas gravam no mesmo cérebro, pelo mesmo caminho.
 */
export const MESAS_DO_APRENDIZADO: Array<{ fonte: string; rotulo: string; escola: EscolaDoAprendizado }> = [
  { fonte: "estudio_aprendizado", rotulo: "Estúdio", escola: "mesas" },
  { fonte: "agente_do_mes", rotulo: "Mês", escola: "mesa_do_cliente" },
  { fonte: "agente_da_campanha", rotulo: "Campanhas", escola: "mesa_do_cliente" },
  { fonte: "agente_contexto", rotulo: "Contexto", escola: "mesa_do_cliente" },
  { fonte: "estilo", rotulo: "Estilo", escola: "mesas" },
  { fonte: "agente_das_redes", rotulo: "Redes (Instagram)", escola: "mesa_do_cliente" },
  { fonte: "agente_do_perfil", rotulo: "Perfis do Instagram", escola: "mesa_do_cliente" },
  { fonte: "mesa_foto", rotulo: "Mesa Foto", escola: "mesas" },
  { fonte: "mesa_videos", rotulo: "Mesa Vídeos", escola: "mesas" },
  { fonte: "mesa_edicao", rotulo: "Mesa Edição", escola: "mesas" },
  { fonte: "mesa_motion", rotulo: "Mesa Motion", escola: "mesas" },
  { fonte: "mesa_publicidade", rotulo: "Mesa Publicidade", escola: "mesas" },
  { fonte: "mesa_roteiros", rotulo: "Mesa Roteiros", escola: "mesas" },
  { fonte: "mesa_mockups", rotulo: "Mesa Mockups", escola: "mesas" },
  { fonte: "mesa_identidade", rotulo: "Mesa Identidade", escola: "mesas" },
  { fonte: "mesa_naming", rotulo: "Naming", escola: "mesas" },
  { fonte: "mesa_site", rotulo: "Mesa Site", escola: "mesas" },
  { fonte: "mesa_proposta", rotulo: "Mesa Proposta", escola: "mesas" },
  { fonte: "mesa_contratos", rotulo: "Contratos", escola: "mesas" },
  { fonte: "mesa_conselho", rotulo: "Conselho", escola: "mesas" },
  { fonte: "conselho", rotulo: "Decisões do conselho", escola: "mesas" },
  { fonte: "aprendeu:trafego", rotulo: "Mesa Ads (tráfego)", escola: "agentes_gerais" },
  { fonte: "aprendeu:central", rotulo: "Central", escola: "agentes_gerais" },
  { fonte: "aprendeu:workspace", rotulo: "Workspace", escola: "agentes_gerais" },
  { fonte: "aprendeu:geral", rotulo: "Assistente geral", escola: "agentes_gerais" },
];

/** O nome curto da mesa de uma fonte (null quando a fonte não é de mesa: entrega, painel, MCP...). */
export function mesaDaFonte(fonte: unknown): string | null {
  const f = typeof fonte === "string" ? fonte : "";
  for (const m of MESAS_DO_APRENDIZADO) if (m.fonte === f) return m.rotulo;
  return null;
}

/** Marca na evidência de que a regra vale para todas as mesas (o dono disse "em todas", "em tudo"). */
export const MARCA_DE_TODAS_AS_MESAS = "alcance:todas";

/** O pedido diz que a regra vale em todas as mesas? (reserva sem Jev; o Jev decide primeiro). */
export function pedidoValeParaTodas(texto: unknown): boolean {
  const t = String(texto == null ? "" : texto).toLowerCase();
  return /\b(em todas as mesas|todas as mesas|em todas as pe[çc]as|em tudo|pra tudo|para tudo|todos os agentes|qualquer mesa|em qualquer (mesa|pe[çc]a|lugar)|no painel todo|em todo lugar|geral para o cliente)\b/.test(t);
}

/**
 * A regra aprendida numa mesa vale nas outras mesas? Vale quando está na
 * área "geral" e foi marcada para todas (o dono disse), ou quando veio de
 * um agente que não é mesa e já grava na geral (Mesa do cliente, conversa
 * geral). Regra de área própria de outra mesa não passa.
 */
export function regraValeParaTodasAsMesas(l: { area?: unknown; fonte?: unknown; evidencia?: unknown }): boolean {
  const area = typeof l.area === "string" ? l.area : "geral";
  if (area !== "geral") return false;
  if (String(l.evidencia || "").indexOf(MARCA_DE_TODAS_AS_MESAS) >= 0) return true;
  const fonte = typeof l.fonte === "string" ? l.fonte : "";
  const ehDeMesa = (Object.keys(FONTE_DA_MESA) as MesaQueAprende[]).some((m) => FONTE_DA_MESA[m] === fonte);
  return !ehDeMesa;
}
