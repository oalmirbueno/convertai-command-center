import { projetoDosTakes, type ProjetoDeEdicao, type SegmentoDaFala } from "../../../supabase/functions/_shared/projeto-de-edicao";
import { aplicarOperacao } from "@/lib/editor/operacoes";

/**
 * Talking head SINTÉTICO (02/10, auditoria da Mesa Edição): fala inventada
 * para teste (nada de cliente), com o mesmo jeito do transcritor que gerou o
 * picote de 112 cortes: palavras por palavra, pausas de 0,3 a 0,9 s entre
 * quase todas as frases, enumeração com palavra curta entre pausas longas
 * (o clipe de 0,32 s), palavras sobrepostas de duração zero e tempos fora da
 * grade de 25 fps. 9:16, 25 fps, ~48 s.
 */

export const AGORA_SINTETICO = "2026-10-02T12:00:00.000Z";

/** Frases e a pausa (s) DEPOIS de cada uma; "|" marca micro pausa de 0,38 s dentro da frase. */
const ROTEIRO: { texto: string; pausa: number }[] = [
  { texto: "Você sabia que três pessoas com o mesmo salário | podem terminar o mês muito diferentes pelo CDI?", pausa: 0.38 },
  { texto: "O segredo não está no quanto você ganha", pausa: 0.62 },
  { texto: "Está em como você organiza | cada gasto do mês", pausa: 0.44 },
  { texto: "Agora pense no cartão de crédito", pausa: 0.4 },
  { texto: "Ele parece ajudar | mas a fatura chega junto com os juros", pausa: 0.71 },
  { texto: "No planejamento financeiro mensal | o importante é separar as contas", pausa: 0.52 },
  { texto: "Separe", pausa: 0.86 },
  { texto: "aluguel", pausa: 0.84 },
  { texto: "mercado", pausa: 0.8 },
  { texto: "transporte e demais despesas fixas", pausa: 0.55 },
  { texto: "Anote tudo durante trinta dias", pausa: 0.48 },
  { texto: "No fim compare o planejado | com o que aconteceu de verdade", pausa: 0.66 },
  { texto: "Cada caso precisa ser olhado com calma", pausa: 0.41 },
  { texto: "Salva esse vídeo para montar a tua planilha", pausa: 0.5 },
];

/** Palavras com tempo da fonte (fora da grade de quadros de propósito). */
export function falaSintetica(): SegmentoDaFala[] {
  const saida: SegmentoDaFala[] = [];
  let t = 0.013;
  ROTEIRO.forEach((f, k) => {
    const partes = f.texto.split(" ");
    partes.forEach((w, j) => {
      if (w === "|") {
        t += 0.38;
        return;
      }
      const dur = Math.round((0.11 + w.length * 0.043) * 1000) / 1000;
      // Como o transcritor: a cada 9 palavras, uma de duração zero colada na seguinte.
      const zero = (saida.length + 1) % 9 === 0;
      saida.push({ t: w, i: Math.round(t * 1000) / 1000, f: Math.round((t + (zero ? 0.01 : dur)) * 1000) / 1000 });
      t += (zero ? 0 : dur) + (j < partes.length - 1 ? 0.03 + ((saida.length * 7) % 5) * 0.012 : 0);
    });
    if (k < ROTEIRO.length - 1) t += f.pausa;
  });
  return saida;
}

export const DURACAO_DO_TAKE_SINTETICO = (() => {
  const w = falaSintetica();
  return Math.round((w[w.length - 1].f + 0.47) * 1000) / 1000;
})();

/** O projeto bruto: um take inteiro na trilha de vídeo, com a fala por palavra. */
export function projetoTalkingHead(): ProjetoDeEdicao {
  const p = projetoDosTakes({
    titulo: "Talking head sintético",
    formato: "9:16",
    fps: 25,
    takes: [
      { id: "t1", nome: "take_01.mp4", tipo: "bruto", storage_bucket: "mesa", storage_path: "cli/video/brutos/t1.mp4", cena_ref: null, melhor: true, duracao_s: DURACAO_DO_TAKE_SINTETICO, largura: 1080, altura: 1920 },
    ],
    agora: AGORA_SINTETICO,
  });
  const fonte = Object.keys(p.fontes)[0];
  return aplicarOperacao(p, { op: "transcricao", fonte, transcricao: { segmentos: falaSintetica(), por_palavra: true, origem: "teste", versao: 1, em: AGORA_SINTETICO } });
}
