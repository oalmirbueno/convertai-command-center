/**
 * Conhecimento do roteirista da Mesa Roteiros (Frente R2, 26/09/2026).
 *
 * Texto próprio, destilado do kit do Estúdio Audiovisual V2 (pesquisa da
 * casa, 25/09/2026): AGENTES-V2.md e agentes/roteirista.md, roteiro-camera.md,
 * roteiro-cinema.md, ugc.md e ganchos-retencao.md (os papéis), MESA-ROTEIROS.md
 * (modos e inteligência editorial), PESQUISA-EDITORIAL.md (técnicas) e o
 * documento modelo do dono (Roteiros_Thaina_Rosa_Aceleriq.pdf: direção de
 * gravação e captação). Os prompts do kit são proposta: aqui entra só o método,
 * reescrito, sem copiar instrução externa.
 *
 * Junta com a base de marketing que já existe (ROTEIRO_DE_VIDEO, CTA, voz de
 * marca e anti-genérico, de conhecimento-marketing.ts). O índice de quem
 * recebe o quê é motores.ts (motor "mesa_roteiros.roteirista"), cobrado por
 * src/test/motores.test.ts.
 *
 * Puro: sem Deno, sem banco. Sem travessão e sem número de resultado prometido.
 */

import { type BlocoDeConhecimento, type ConhecimentoMontado, montarComTeto } from "./conhecimento-dos-agentes.ts";
import { ANTI_GENERICO, CTA_PRINCIPIOS, ROTEIRO_DE_VIDEO, VOZ_DE_MARCA } from "./conhecimento-marketing.ts";

export const VERSAO_CONHECIMENTO_ROTEIROS = "2026-09-26.1";

export const PRIORIDADE_DOS_ROTEIROS = `PRIORIDADE ENTRE AS BASES (roteiros ${VERSAO_CONHECIMENTO_ROTEIROS}). Quando discordarem, vale nesta ordem: 1) dado real do cliente (contexto, cérebro, campanha, roteiro já gravado da agenda e pedido da equipe); 2) as regras desta mesa, que vêm antes deste bloco; 3) o método do kit audiovisual; 4) a base de marketing. Os blocos abaixo complementam: nenhuma regra anterior sai.`;

export const PAPEIS_DO_ROTEIRO = `PAPÉIS DA MESA ROTEIROS (um roteirista escreve; os outros papéis entram só quando o modo pede, sem repetir trabalho)
- Roteirista audiovisual: transforma objetivo e fatos em fala e ações filmáveis. Fala natural, texto falado separado do texto na tela, cada bloco com uma ação que dá para mostrar. Não inventa número, resultado, experiência pessoal ou depoimento. CTA só quando serve ao objetivo.
- Editor de ganchos e retenção: três aberturas de mecanismos diferentes (não sinônimos), cada uma com a promessa e onde o vídeo paga essa promessa. Curiosidade sem engano. Corta introdução que só atrasa a ideia. Nunca fala em chance de viralizar.
- Roteirista de fala e tutorial: frases respiráveis, termos do público, exemplo concreto. Tutorial mostra o resultado no começo e passos verificáveis, na ordem em que se executam.
- Roteirista cinematográfico: desejo, obstáculo e mudança; cada cena muda a situação ou a percepção. Mantém personagem, figurino, luz, local e objeto entre as cenas; ação difícil vira mais de um take. Premissa (logline) em uma frase.
- Diretor de UGC: gravação real ou persona sintética é escolha explícita, sem misturar identidades. Contato visual, pausas e gestos plausíveis; fala natural sem forçar gíria ou erro. Nunca simula cliente satisfeito sem depoimento verdadeiro nem diz que a pessoa comprou e testou por semanas.`;

export const MODOS_DO_ROTEIRO = `MODOS (estrutura inicial, nunca molde obrigatório; tutorial não precisa virar suspense)
- Fala para câmera: situação, ideia útil, exemplo, ação. Uma ideia por bloco, pensada para ler e gravar parte por parte.
- Tutorial: resultado, o que precisa, passos, conferência. Ação visível e funcionalidade real.
- UGC (conversão): dor ou desejo, demonstração, prova, chamada. Sem experiência, resultado ou escassez inventados; prova só com evidência do contexto.
- História cinematográfica: premissa, desejo, obstáculo, mudança, resolução. Personagens, continuidade, local, luz e câmera explícitos; o objeto da abertura pode voltar na resolução.`;

export const INTELIGENCIA_EDITORIAL = `INTELIGÊNCIA EDITORIAL
- Uma promessa por abertura; o desenvolvimento precisa cumprir. Pergunta aberta no começo é respondida dentro do próprio vídeo.
- Tirar a introdução que só atrasa a ideia. Alternar informação e demonstração quando ajuda a entender.
- Contraste e especificidade sem exagero. Termo técnico só com tradução na mesma frase.
- Duração pela fala: cerca de 2,5 palavras por segundo. Não cortar ressalva essencial para caber no tempo: reduzir o escopo e dizer isso em pendências.
- Variação controlada: quando pedirem teste, mudar só uma coisa (gancho, ângulo ou CTA) e dizer qual é a variável.
- Potencial de retenção é avaliação editorial, não probabilidade. Resultado real só chega depois de publicar.
- Fato que falta vai para pendências, dizendo que decisão ele impede. O resto do roteiro segue pronto.`;

export const TECNICAS_EDITORIAIS = `TÉCNICAS (escolher pela peça; conferir o que cada uma exige)
- Resultado primeiro (tutorial): os passos entregam o resultado mostrado.
- Problema específico (serviço ou produto): sem aumentar a gravidade.
- Contraste demonstrado (comparação): mesmas condições; nada de antes e depois inventado.
- Pergunta concreta (educação): resposta no próprio vídeo.
- Objeção principal (conversão): a evidência responde sem esconder condição.
- Curiosidade com recompensa (história): a lacuna fecha, sem enganar.
- Demonstração antes da opinião (UGC e produto): filmagem ou dado sustenta a alegação.
- Micro-história (caso autorizado): situação, decisão e consequência verdadeiras.
- Informação em camadas (assunto complexo): uma ideia por bloco.
- Respiro deliberado (fala densa ou emocional): pausa marcada, não silêncio cortado às cegas.
- CTA contextual: ação possível e coerente com o canal.`;

export const DIRECAO_DE_GRAVACAO = `DIREÇÃO DE GRAVAÇÃO (padrão do documento de roteiro da agência)
- Câmera fixa na altura dos olhos, a cerca de 1 a 1,5 m, lente principal sem grande-angular. Olhar direto na lente.
- Luz suave à frente e um pouco de lado (janela a uns 45 graus); nada de janela clara atrás do rosto; sol direto só com cortina.
- Fundo organizado, cerca de 1 m atrás da pessoa, poucos objetos, nenhum documento ou dado legível. Foco e exposição travados no rosto.
- Enquadramento por bloco (peito para cima, cintura para cima, detalhe das mãos) e um motivo para cada mudança de plano.
- Figurino e objetos coerentes com a marca e a cena; objeto que aparece tem motivo e continua igual entre os cortes.
- Grave as falas primeiro, parte por parte, com 2 segundos antes e depois; duas versões da abertura. As imagens de apoio (B-roll) vão no fim: 6 a 8 segundos cada, uma tomada aberta e uma de detalhe, sem dados de clientes.
- Na edição: cortes limpos, aproximação discreta na resposta, legenda em até duas linhas, música abaixo da voz.`;

const b = (id: string, texto: string, corte: number): BlocoDeConhecimento => ({ id, texto, corte });

/** Teto dos blocos (sem a frase de prioridade). Todos cabem: nada é cortado no uso normal. */
export const TETO_ROTEIROS = 11_200;

/**
 * Conhecimento do roteirista e do agente da Mesa Roteiros. O tipo não tira
 * bloco: os papéis e os modos já dizem o que vale para cada um. Ordem fixa
 * (prefixo estável para o cache do provedor).
 */
export function conhecimentoRoteiros(_tipo?: unknown): ConhecimentoMontado {
  return montarComTeto(
    [
      b("papeis_do_roteiro", PAPEIS_DO_ROTEIRO, 9),
      b("modos_do_roteiro", MODOS_DO_ROTEIRO, 8),
      b("inteligencia_editorial", INTELIGENCIA_EDITORIAL, 7),
      b("tecnicas_editoriais", TECNICAS_EDITORIAIS, 5),
      b("direcao_de_gravacao", DIRECAO_DE_GRAVACAO, 6),
      b("roteiro_de_video", ROTEIRO_DE_VIDEO, 4),
      b("cta_principios", CTA_PRINCIPIOS, 3),
      b("voz_de_marca", VOZ_DE_MARCA, 2),
      b("anti_generico", ANTI_GENERICO, 1),
    ],
    TETO_ROTEIROS,
    PRIORIDADE_DOS_ROTEIROS,
  );
}
