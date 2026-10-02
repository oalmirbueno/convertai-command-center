/**
 * Ação pecas_de_foto (02/10/2026): a esteira das peças de foto do mês no
 * topo da Mesa Foto. Sem IA, custo zero.
 *
 *   pecas_de_foto { client_id, marca_id? } -> { pecas, janela, banco }
 *
 * Lê calendario_propostas (prontas ou gravadas) do mês atual e do próximo
 * com a chave de serviço, DEPOIS da mesma checagem de acesso ao cliente das
 * outras ações (garantirAcesso), filtrada pelo cliente e pela marca aberta
 * (como a campanha do mês). O mapeamento do contrato mora em
 * ./pecas-de-foto.ts (puro, a tela usa o mesmo).
 */
import { ErroDeRegra, UUID } from "../calculos.ts";
import { marcasDoCliente, resolverMarca } from "../../_shared/marca.ts";
import { projetoDaMarcaAberta } from "../../_shared/heranca-da-marca.ts";
import { registrarFalha } from "../../_shared/falha-registrada.ts";
import type { Chamador, FerramentasDaMesa } from "../ferramentas.ts";
import { janelaDasPecas, pecasDeFotoDasPropostas } from "./pecas-de-foto.ts";

export function acoesDasPecasDeFoto(f: FerramentasDaMesa) {
  async function pecasDeFoto(ch: Chamador, corpo: Record<string, unknown>) {
    const clientId = typeof corpo.client_id === "string" && UUID.test(corpo.client_id) ? corpo.client_id : "";
    if (!clientId) throw new ErroDeRegra(400, "client_id_invalido", "client_id inválido.");
    await f.garantirAcesso(ch, clientId);
    const db = f.servico();
    const agora = new Date();
    const janela = janelaDasPecas(agora);
    const marca = await resolverMarca(db, clientId, { marca_id: corpo.marca_id }).catch((e) => (registrarFalha("mesa-foto: resolverMarca falhou", e), null));
    const { data, error } = await db.from("calendario_propostas")
      .select("id, status, periodo_inicio, periodo_fim, itens, task_ids, project_id")
      .eq("client_id", clientId)
      .in("status", ["pronta", "gravada"])
      .lte("periodo_inicio", janela.fim)
      .gte("periodo_fim", janela.inicio)
      .order("periodo_inicio", { ascending: true })
      .limit(20);
    if (error) {
      registrarFalha("mesa-foto: leitura das peças de foto falhou", error, { client_id: clientId });
      return f.json({ pecas: [], janela, banco: false, custo_usd: 0 });
    }
    const marcasDoMes = marca ? await marcasDoCliente(db, clientId) : [];
    const daMarca = ((data ?? []) as { id: string; status: string; itens: unknown; project_id?: string | null }[])
      .filter((p) => projetoDaMarcaAberta(p.project_id ?? null, marca, marcasDoMes));
    return f.json({ pecas: pecasDeFotoDasPropostas(daMarca, agora), janela, banco: true, custo_usd: 0 });
  }
  return { pecas_de_foto: pecasDeFoto } as Record<string, (ch: Chamador, corpo: Record<string, unknown>) => Promise<Response>>;
}
