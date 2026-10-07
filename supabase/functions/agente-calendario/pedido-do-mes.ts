import type { PerguntaJev, RespostaJev } from "../_shared/jev.ts";
import { formatoDoMes } from "./modulos/peca-de-foto.ts";

export const PERGUNTAS_DO_MES: Record<string, PerguntaJev> = {
  outros_meses: { type: "noul", instructions: "A mensagem da equipe pede EXPLICITAMENTE trabalhar em outros meses além do mês aberto?", criteria: {
    true: "Cita outro mês, várias datas em outros meses, um trimestre ou todos os meses da agenda.",
    false: "Diz todos os conteúdos, refaça tudo, agenda inteira ou todo o mês, sem pedir outros meses. Esses pedidos se limitam ao mês aberto.",
  } },
  quer_foto: { type: "noul", instructions: "Leia somente `mensagem`. A equipe quer FOTOS como publicações na agenda?", criteria: {
    true: "Quer posts de fotos, carrosséis de fotos ou alternar fotos com vídeos/artes. Exemplos: coloque fotos; alterne fotos e vídeos; pedi foto e não apareceu.", false: "Só menciona fotos como referência para artes, pergunta sobre fotos, ou pede para retirar/não incluir fotos.",
  } },
  quer_video: { type: "noul", instructions: "Leia somente `mensagem`. A equipe quer VÍDEOS como publicações na agenda?", criteria: {
    true: "Quer vídeos/reels/vídeos rápidos, sozinhos ou alternados com fotos/artes. Exemplos: coloque vídeos; alterne fotos e vídeos; pedi vídeo e não apareceu.", false: "Só menciona vídeos como referência, pergunta sobre vídeos, ou pede para retirar/não incluir vídeos.",
  } },
};
export function contratoDoPedido(answers: Record<string, RespostaJev> = {}) {
  return { outrosMeses: (answers.outros_meses?.noul ?? 0) >= .9,
    formatos: (["foto", "video"] as const).filter(f => (answers[`quer_${f}`]?.noul ?? 0) >= .8) };
}
export function pecasNoEscopo<T extends { due_date: string | null }>(pecas: T[], mes: string, outrosMeses: boolean): T[] {
  return outrosMeses ? pecas : pecas.filter(p => p.due_date?.slice(0, 7) === mes);
}
/** Verifica ações, não a promessa textual nem formatos apenas citados no plano. */
export function formatosAusentes(formatos: readonly string[], acao: any, criacao: any): string[] {
  const presentes = new Set<string>([
    ...(acao?.mudar_formato || []).map((x: any) => formatoDoMes(x.formato_para ?? x.formato)),
    ...(criacao?.itens || []).map((x: any) => formatoDoMes(x.formato)),
  ]);
  return formatos.filter(f => !presentes.has(f));
}

export const PRIORIDADE_DO_PEDIDO = `CONTRATO DO PEDIDO ATUAL:
A solicitação ATUAL da equipe pode mudar a mistura editorial anterior. Planos antigos, memória e respostas anteriores NÃO proíbem foto ou vídeo quando a equipe agora pede esses formatos.
O painel já suporta foto e vídeo. Não alegue limitação a carrossel/post estático. Preserve regras reais de marca, autorização de imagens, itens aprovados e publicados.
Foto como conteúdo requer formato foto e direção de foto; vídeo requer formato video e direção de vídeo. Não basta mudar o título, a legenda ou mencionar fotos/vídeos no plano.
Para alternar ou substituir, converta peças existentes com mudar_formato, preservando as datas. Para acrescentar, use criar_conteudos. Combine com editar_textos quando solicitado.
Falta de arquivos não impede criar a pauta: deixe a produção aguardando material real, sem inventar mídia pronta.`;
