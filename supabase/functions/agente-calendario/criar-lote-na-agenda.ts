import { gravarAnexosConfirmados } from "./gravacao-confirmada.ts";
import { lotesDaCriacao, pedidoParaCriar, type CriacaoDeConteudos } from "./agente-mes-v2.ts";

/** Um lote confirmado: reutiliza proposta persistida, grava e só então marca como concluído. */
export async function criarLoteNaAgenda(db: any, mensagem: any, lote: number, deps: {
  criar: (corpo: Record<string, unknown>) => Promise<any>;
  gravar: (proposta: any) => Promise<any>;
}) {
  let anexos = mensagem.anexos;
  const indice = Array.isArray(anexos) ? anexos.findIndex((a: any) => a?.tipo === "criar_conteudos") : -1;
  if (indice < 0) throw new Error("Esta mensagem não contém conteúdos para criar.");
  const criacao = anexos[indice] as CriacaoDeConteudos & { lotes?: Record<string, any> };
  const itens = lotesDaCriacao(criacao.itens)[lote];
  if (!Number.isInteger(lote) || lote < 0 || !itens?.length) throw new Error("Lote inválido.");
  const anterior = criacao.lotes?.[lote];
  if (anterior?.estado === "gravado") return { ja_gravado: true, lote, quantidade: itens.length, custo_usd: 0 };
  if (anterior?.estado === "gerando" && Date.now() - Date.parse(anterior.desde) < 15 * 60_000) throw new Error("Este lote já está sendo processado. Aguarde a atualização, sem confirmar novamente.");
  const registrar = async (estado: Record<string, unknown>) => {
    const novo = anexos.map((a: any, k: number) => k === indice ? { ...a, lotes: { ...a.lotes, [lote]: estado } } : a);
    anexos = await gravarAnexosConfirmados(db, mensagem, anexos, novo);
  };
  await registrar({ estado: "gerando", desde: new Date().toISOString() });
  let custo = 0;
  try {
    const ref = `${mensagem.id}:${lote}`;
    const consulta = await db.from("calendario_propostas").select("*").eq("client_id", mensagem.client_id).eq("parametros->>criacao_ref", ref).order("criado_em", { ascending: false }).limit(1);
    if (consulta.error) throw new Error("Não foi possível conferir se o lote já foi criado; nenhuma geração foi iniciada.");
    let proposta = consulta.data?.[0];
    if (!proposta) {
      const criada = await deps.criar({ client_id: mensagem.client_id, mensagem: pedidoParaCriar(itens, criacao.orientacao), pecas: itens, criacao_ref: ref });
      proposta = criada.proposta;
      custo = Number(criada.custo_usd) || 0;
      if (!proposta?.id) throw new Error("A geração não devolveu uma proposta salva.");
    }
    const gravada = await deps.gravar(proposta);
    const confirmada = gravada.proposta;
    if (confirmada?.itens?.length !== itens.length || confirmada.itens.some((i: any) => !i.task_id) || gravada.faltam_na_agenda) throw new Error("O lote foi preparado, mas não foi todo gravado na agenda. Continue para concluir sem gerar novamente.");
    await registrar({ estado: "gravado", proposta_id: proposta.id, quantidade: confirmada.itens.length, gravado_em: new Date().toISOString() });
    return { ...gravada, lote, quantidade: confirmada.itens.length, custo_usd: custo, gravado: true };
  } catch (e) {
    await registrar({ estado: "pendente", erro: e instanceof Error ? e.message : "Não concluído", custo_usd: custo }).catch(() => undefined);
    throw e;
  }
}
