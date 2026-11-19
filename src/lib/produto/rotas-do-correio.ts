/**
 * As rotas entre o painel do cliente, o CRM e o Correio (19/11/2026, pedido do dono: "fácil de ir e voltar,
 * sem misturar"). São três lugares separados:
 *   /dashboard  o painel do cliente da Aceleriq
 *   /app        o CRM da empresa (e a configuração do e-mail em /app/email)
 *   /correio    a caixa de e-mail, com link próprio e app instalável
 *
 * Quem entra no Correio a partir do painel ou do CRM leva a origem no link (?de=painel ou ?de=crm). O Correio
 * guarda essa origem na aba do navegador e o botão de voltar leva para lá. Aberto direto (link ou app
 * instalado), não há "voltar": o topo mostra "Ir para" com os outros lugares.
 */

/** vendas = o CRM de vendas da Aceleriq (/vendas), só da equipe da casa. */
export type OrigemDoCorreio = "painel" | "crm" | "vendas";

const CHAVE = "aceleriq:correio:origem";

export const VOLTAR_PARA: Record<OrigemDoCorreio, { para: string; rotulo: string }> = {
  painel: { para: "/dashboard", rotulo: "Painel" },
  crm: { para: "/app", rotulo: "CRM" },
  vendas: { para: "/vendas/crm", rotulo: "CRM" },
};

/** O link do Correio a partir de um lugar (é ele que faz o voltar funcionar). */
export const linkDoCorreio = (de?: OrigemDoCorreio) => (de ? `/correio?de=${de}` : "/correio");

/** A origem pedida no endereço, se for uma das conhecidas. */
export function origemDoEndereco(busca: string): OrigemDoCorreio | null {
  const de = new URLSearchParams(busca).get("de");
  return de === "painel" || de === "crm" || de === "vendas" ? de : null;
}

/**
 * Lê a origem do endereço e guarda; sem origem no endereço, devolve a que ficou guardada nesta aba.
 * O app instalado abre sem origem e sem nada guardado: não há para onde voltar.
 */
export function lembrarOrigem(busca: string, guarda: Pick<Storage, "getItem" | "setItem"> | null = armazenamento()): OrigemDoCorreio | null {
  const pedida = origemDoEndereco(busca);
  try {
    if (pedida && guarda) guarda.setItem(CHAVE, pedida);
    if (pedida) return pedida;
    const guardada = guarda ? guarda.getItem(CHAVE) : null;
    return guardada === "painel" || guardada === "crm" || guardada === "vendas" ? guardada : null;
  } catch {
    return pedida;
  }
}

function armazenamento(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

/** Aberto como app instalado (tela cheia, sem barra do navegador)? */
export function abertoComoApp(): boolean {
  try {
    return typeof window !== "undefined" && (window.matchMedia("(display-mode: standalone)").matches || (window.navigator as Navigator & { standalone?: boolean }).standalone === true);
  } catch {
    return false;
  }
}
