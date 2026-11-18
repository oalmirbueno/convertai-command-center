/**
 * Itens que saíram do menu por não serem usados (14/11/2026, pedido do dono:
 * "mapear e esconder do menu o que não se usa, de forma reversível").
 *
 * Esconder não apaga nada: a rota em src/App.tsx, a página e as tabelas
 * continuam intactas, e quem tem o link direto continua entrando. Aqui só se
 * decide o que o menu oferece (menu do computador, folha "Mais" do celular e
 * a busca de página).
 *
 * PARA REVERTER: tire a URL da lista abaixo. Nada mais precisa mudar.
 *
 * Evidência de cada item (produção jjjtkowvxemvituvywvf, lida em 14/11/2026):
 *
 * - "/pedidos": a tabela client_requests tem 0 linhas em toda a história, e o
 *   tempo_de_trabalho nunca registrou a área "pedidos". Nem a equipe nem os
 *   clientes abriram um pedido por essa tela.
 */
export const ITENS_OCULTOS_DO_MENU: readonly string[] = ["/pedidos"];

/** O item está fora do menu? Compara a URL inteira: "/pedidos" não esconde "/pedidos-de-acesso". */
export function ocultoDoMenu(url: string, ocultos: readonly string[] = ITENS_OCULTOS_DO_MENU): boolean {
  return ocultos.includes(url);
}

/** A lista sem os itens ocultos. Vale para qualquer saída do menu. */
export function semItensOcultos<T extends { url: string }>(itens: readonly T[], ocultos: readonly string[] = ITENS_OCULTOS_DO_MENU): T[] {
  return itens.filter((item) => !ocultoDoMenu(item.url, ocultos));
}
