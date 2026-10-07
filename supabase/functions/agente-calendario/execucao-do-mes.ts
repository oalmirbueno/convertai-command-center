/** Contrato atual do Mês. Não altera prompts armazenados nem decisões editoriais do cliente. */
export function promptAtualDoMes(prompt: string): string {
  return prompt.replace(/Não crie formatos além de carrossel e post estático\./gi, "O calendário aceita carrossel, post estático, foto e vídeo rápido; siga o formato pedido.");
}
export const CAPACIDADES_DO_MES = `CAPACIDADES ATUAIS DO PAINEL (substituem limitações técnicas antigas no contexto):
- O Mês cria e altera arte/carrossel, foto ou carrossel de fotos e vídeo rápido, todos na mesma agenda. Nunca converta um pedido de foto ou vídeo em arte por limitação antiga.
- Pedido de alternar, incluir no meio ou substituir conteúdos usa a agenda do MÊS EM CONVERSA. Preserve itens aprovados/publicados. Para converter itens existentes, use mudar_formato com foto/video e direção estruturada; combine editar_textos para adequar título e legenda. Não basta reescrever o título de um carrossel.
- Pedido plural e de mistura cobre as semanas do mês, seguindo a frequência combinada. Sem quantidade explícita, proponha uma distribuição para o mês inteiro, não apenas um conteúdo. Mostre a quantidade por formato e as datas no cartão.
- Fotos de referência ainda não escolhidas não impedem preparar pautas. Indique o material necessário e deixe a produção pendente; não invente imagens selecionadas ou resultados reais.
- Criar pauta não gera mídia nem publica. Custos de geração e publicação continuam no fluxo de confirmação. Alterações simples autorizadas podem ser aplicadas pelo painel; só o resultado da execução confirma o que foi salvo.
- Em todo pedido operacional, devolva ações executáveis: criar_conteudos, gerar_conteudos, acoes_na_agenda ou mudancas. Não responda apenas com uma promessa ou um plano textual. Se faltar uma informação essencial, faça uma pergunta objetiva e diga que nada foi alterado.`;

export function podeAplicarDireto(a: any): boolean {
  return !!a && !(a.apagar?.length || a.refazer?.length || a.escolher_um) &&
    !!(a.mudar_data?.length || a.mudar_formato?.length || a.editar_textos?.length || a.editar_campanhas?.length);
}

/** Gravação confirmada por RETURNING: zero linhas nunca significa sucesso. */
export class ErroDeGravacao extends Error {
  constructor(public status: number, public codigo: string, mensagem: string) { super(mensagem); }
}
export async function atualizarConfirmado(q: any, campos: string = "id") {
  const { data, error, status } = await q.select(campos);
  if (error) {
    console.error("[calendario] gravacao recusada", { status, codigo: error.code || "sem_codigo" });
    throw new ErroDeGravacao(503, "gravacao_indisponivel", "O banco não confirmou a gravação. O cartão foi preservado; tente confirmar novamente, sem gerar outro pedido.");
  }
  if (!Array.isArray(data) || data.length !== 1) throw new ErroDeGravacao(409, "gravacao_conflito", "A alteração não foi confirmada. Atualize a agenda antes de tentar novamente.");
  return data[0];
}
