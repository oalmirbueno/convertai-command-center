import { atualizarConfirmado } from "./execucao-do-mes.ts";

/** JSON grande fica no corpo da requisição, nunca no filtro/URL do PostgREST. */
export async function gravarAnexosConfirmados(db: any, mensagem: any, antes: any[], depois: any[]) {
  const revisao = crypto.randomUUID();
  const novos = depois.map(a => ({ ...a, revisao_gravacao: revisao }));
  let q = db.from("agente_mensagens").update({ anexos: novos }).eq("id", mensagem.id).eq("client_id", mensagem.client_id);
  // Todos os anexos participam: dois lotes diferentes não podem sobrescrever seus recibos.
  for (let i = 0; i < antes.length; i++) {
    for (const campo of ["tipo", "revisao_gravacao", "executando_em", "executada_em", "descartada_em", "desfeita_em"]) {
      const caminho = `anexos->${i}->>${campo}`, valor = antes[i]?.[campo];
      q = valor == null ? q.is(caminho, null) : q.eq(caminho, valor);
    }
  }
  await atualizarConfirmado(q);
  return novos;
}

function canonico(v: any): string {
  return JSON.stringify(v, (_k, x) => x && typeof x === "object" && !Array.isArray(x)
    ? Object.fromEntries(Object.keys(x).sort().map(k => [k, x[k]])) : x);
}

/** Confere o snapshot localmente e usa a revisão mantida pelo trigger como CAS curto. */
export async function gravarSnapshotConfirmado(db: any, tabela: string, id: string, clientId: string, antes: Record<string, any>, depois: Record<string, any>) {
  const coluna = tabela === "tasks" ? "updated_at" : "atualizado_em";
  const escopo = (q: any) => tabela === "tasks" ? q.is("deleted_at", null) : q.eq("client_id", clientId);
  const { data, error } = await escopo(db.from(tabela).select(["id", coluna, ...Object.keys(antes)].join(",")).eq("id", id)).maybeSingle();
  if (error || !data || !data[coluna] || Object.entries(antes).some(([k, v]) => canonico(data[k]) !== canonico(v))) {
    throw new Error("Esta peça mudou desde a leitura. Atualize a agenda antes de aplicar a alteração.");
  }
  return atualizarConfirmado(escopo(db.from(tabela).update(depois).eq("id", id)).eq(coluna, data[coluna]));
}
