/**
 * Ações rápidas do Dashboard pelo papel de quem está logado.
 *
 * A equipe (design, tráfego, gestor) também abre o Dashboard, mas criar
 * projeto, criar cliente e a ata de reunião são só do admin no servidor
 * (RLS de projects, manage-team e process-meeting-notes). Mostrar o botão
 * para a equipe era levar a pessoa a um 403. As marcadas `soAdmin` somem.
 */
export type AcaoRapida = { label: string; soAdmin?: boolean };

export function acoesRapidasDoPapel<T extends AcaoRapida>(isAdmin: boolean, acoes: T[]): T[] {
  return acoes.filter((a) => isAdmin || !a.soAdmin);
}
