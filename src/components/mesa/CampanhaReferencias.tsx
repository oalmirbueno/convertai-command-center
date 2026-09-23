import SeletorDeReferencias, { MiniaturasEscolhidas } from "./SeletorDeReferencias";

/**
 * Referências da campanha: o seletor único da Mesa (do cliente com destaque,
 * pastas do workspace, banco da agência e Pinterest). Escolha múltipla até
 * 8; id do banco da agência leva "g:". Controlado por quem usa: o formulário
 * guarda na memória, o detalhe grava em mesa_campanhas.referencias_ids.
 *
 * Antes as do cliente vinham só com storage_path (as do Workspace e as artes
 * aprovadas não têm) e as do banco da agência pediam URL assinada de
 * "globais/", que o bucket recusa: as duas abas ficavam sem imagem.
 */

export const MAX_REFERENCIAS = 8;

/** Miniaturas das referências escolhidas (clicar abre grande; o X tira). */
export function ReferenciasEscolhidas({ ids, onTirar, vazio }: { ids: string[]; onTirar?: (id: string) => void; vazio?: string }) {
  return <MiniaturasEscolhidas ids={ids} onTirar={onTirar} vazio={vazio} />;
}

export default function CampanhaReferencias({ valor, onChange }: { valor: string[]; onChange: (ids: string[]) => void }) {
  return <SeletorDeReferencias selecionados={valor} onChange={onChange} max={MAX_REFERENCIAS} modo="escolher" colunas={6} alturaMax="min(56vh, 520px)" />;
}
