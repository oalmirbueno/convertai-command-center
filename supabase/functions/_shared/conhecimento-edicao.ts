/**
 * Conhecimento de edição da Mesa Vídeos (Frente V2, 25/09/2026).
 *
 * Método destilado, em palavras próprias, de duas fontes:
 * 1. "Edição dinâmica Brabo com IA", pacote público versão 2.0, material de
 *    estudo de Fernando Araújo / Brabo Space (skill brabo-edicao-video-dinamica,
 *    com SKILL.md e as referências direcao-e-motion, sincronizacao e revisao).
 *    O pacote não traz arquivo de licença: entra só o método, reescrito e
 *    resumido. Nenhum trecho do texto, nenhum código das composições, nenhuma
 *    mídia (vídeos, colagens, voz e imagem do autor) nem marca de terceiros
 *    foi copiado. O dono do painel recebeu o pacote para estudo.
 * 2. Kit do Estúdio Audiovisual V2 da casa (agentes de montagem, legendas,
 *    sincronismo e organizador de acervo), que é pesquisa própria.
 *
 * Uso: a direção do "Pacote para editar" (pacote-de-edicao.ts) e a função
 * mesa-videos. Registrado em motores.ts (motor mesa_videos.direcao_de_edicao).
 * Puro: sem Deno, sem banco. Sem travessão.
 */

// Só os tipos: a tela da Mesa Vídeos também lê este arquivo e não deve levar
// junto toda a base de marketing de conhecimento-dos-agentes.ts.
import type { BlocoDeConhecimento, ConhecimentoMontado } from "./conhecimento-dos-agentes.ts";

export const VERSAO_CONHECIMENTO_EDICAO = "2026-09-25.1";

export const FONTE_BRABO = {
  nome: "Edição dinâmica Brabo com IA (pacote público 2.0)",
  autor: "Fernando Araújo / Brabo Space",
  licenca: "sem arquivo de licença no pacote; material de estudo. Só o método, em palavras próprias",
  consultado_em: "2026-09-25",
} as const;

export const FONTE_KIT_AUDIOVISUAL = {
  nome: "Kit do Estúdio Audiovisual V2 (pesquisa da casa)",
  autor: "Aceleriq",
  licenca: "texto próprio",
  consultado_em: "2026-09-25",
} as const;

// ------------------------------------------------------------------ blocos

export const DA_FALA_A_IMAGEM = `EDIÇÃO: DA FALA À IMAGEM (método Brabo, resumido)
- Antes de desenhar qualquer cena, conheça o material: vídeo original, áudio, transcrição com tempos, duração, resolução e FPS. Separe o que foi medido do que é suposição.
- Monte a tabela de beats: início, fim, trecho falado, palavra que dispara o evento, modo de composição, objeto em cena, ação e resultado. Tempo sem alinhamento por palavra fica marcado como provisório até ser conferido no áudio.
- Para cada beat, complete a frase: "quando a pessoa ouvir X, precisa entender Y; por isso mostro Z fazendo W". Se a ação não explica a fala, a cena muda.
- Pessoa real e clone seguem a mesma lógica. Editar não inclui regravar fala, acelerar voz nem gerar clone novo.`;

export const TRES_MODOS = `EDIÇÃO: TRÊS MODOS DE COMPOSIÇÃO NO VERTICAL
- Ilustração com apresentador: o visual explica em cima, a pessoa continua embaixo. Serve para ação, comparação e processo.
- Lettering com apresentador: uma frase curta em cima destaca a ideia quando não há o que demonstrar.
- Tela cheia editorial: texto dominante (com imagem só quando ajuda) marca tese, contraste, pergunta, número ou conclusão.
- A troca de modo segue a narrativa, não uma fórmula: dois beats seguidos podem ficar no mesmo modo. A linha de divisão se ajusta ao rosto e às mãos; cabeça e boca respiram. Ao voltar da tela cheia, o vídeo da pessoa está no instante certo, sem reiniciar.`;

export const ILUSTRACAO_EXPLICA_O_VERBO = `EDIÇÃO: A ILUSTRAÇÃO EXECUTA O VERBO
- Ideia abstrata vira estado visível: escolher seleciona, organizar ordena, comparar mostra as alternativas, escalar multiplica, concluir termina a ação.
- Toda interação tem estado inicial, ação, mudança e resultado legível. Clique só com alvo e resposta no mesmo instante.
- Um protagonista visual por beat. O resto reforça sem disputar com rosto e legenda.
- Texto que precisa ser exato (nomes, números, preço) é desenhado no código ou na edição, nunca pedido dentro de imagem gerada. Elementos que vão reagir ficam em camadas editáveis.`;

export const LEGENDA_E_LETTERING = `EDIÇÃO: LEGENDA NÃO É LETTERING
- Legenda: acompanha fielmente o que é dito, em blocos curtos com quebra natural, sem antecipar a próxima frase nem acender palavra antes de ela ser falada. Nomes, marcas e valores são conferidos no áudio.
- Lettering: sintetiza ou enfatiza a ideia com outras palavras, sem virar citação falsa.
- Em tela cheia com lettering, não duplique com legenda por cima; se a legenda integral for obrigatória, ela ganha área própria.
- Leitura no tamanho do celular: duas linhas bem compostas valem mais que uma linha minúscula; nada de palavra sozinha na linha por acidente; a legenda não cobre boca nem produto.`;

export const TEMPO_E_MOVIMENTO = `EDIÇÃO: TEMPO E MOVIMENTO
- O áudio é o relógio. A informação precisa estar reconhecível no instante da fala; a preparação pode começar antes, sem estragar surpresa.
- Cada cena reserva tempo para entrada, desenvolvimento, leitura do resultado e saída. Fala curta pede visual mais simples, não timeline esticada em silêncio.
- Entrada desacelera ao chegar, saída acelera ao partir; corte seco também é escolha válida. Sem zoom periódico automático no apresentador e sem o mesmo impacto em toda frase.
- O FPS de cada projeto é conferido no arquivo; não herde números de outro trabalho.
- Som (quando pedido ou já presente) fica abaixo da voz e acompanha ações reais; nada de efeito em cada palavra.`;

export const SINCRONIA = `EDIÇÃO: UMA REFERÊNCIA DE TEMPO
- Anote em separado o FPS do arquivo, o da composição e o dos timecodes. Em HH:MM:SS:FF o último campo é quadro, não milésimo.
- Converta cada limite pelo tempo absoluto e arredonde só no fim; somar durações arredondadas acumula erro. Intervalos são [início, fim).
- Beat, legenda e evento são camadas diferentes: uma cena pode ter várias legendas e vários eventos.
- Com cortes na fala, mantenha o mapa de trechos da fonte para a saída e recalcule legenda, beats e eventos por ele.
- Uma única fonte de áudio audível: vídeo contínuo por baixo dos overlays ou trilha contínua com vídeos mudos, nunca as duas.
- Fala parecida identifica o roteiro, não prova sincronia em milissegundos. Sem timecode ou áudio guia, a sincronia fica pendente ou manual.`;

export const MONTAGEM_E_TAKES = `EDIÇÃO: TAKES E MONTAGEM (kit audiovisual da casa)
- O original nunca muda; toda edição é não destrutiva (EDL com entrada e saída na fonte e na timeline).
- O melhor take é escolhido pelo sentido, dicção e continuidade, não só pela ausência de silêncio. Dois takes da mesma fala são alternativas, não duplicatas.
- Corte de repetição preserva negação, ressalva e intenção da fala; respiração útil fica.
- Pedido pontual muda só o trecho pedido; versão aprovada não é reconstruída.
- Vínculo de take com roteiro por ID explícito pode ser confirmado; inferido por conteúdo começa como sugestão.`;

export const REVISAO_HONESTA = `EDIÇÃO: REVISÃO ANTES DE ENTREGAR
- Plano: cada beat corresponde à fala; nomes, etapas e números conferidos.
- Tempo: intervalos válidos e crescentes, eventos dentro do beat, cortes mapeados na fonte.
- Imagem: foco claro, texto cabe, rosto preservado, sem flash acidental, máscara invasiva ou tela preta.
- Áudio: voz sem duplicar nem reiniciar; nenhuma emenda come fonema; efeitos ouvidos junto com a voz.
- Relate em separado o que foi conferido na estrutura, o que foi visto em quadros e o que foi reproduzido com áudio. Não diga que assistiu ao que não reproduziu. Pronto técnico não é aprovação criativa.`;

const b = (id: string, texto: string, corte: number): BlocoDeConhecimento => ({ id, texto, corte });

export const BLOCOS_DA_EDICAO: readonly BlocoDeConhecimento[] = [
  b("edicao_da_fala_a_imagem", DA_FALA_A_IMAGEM, 20),
  b("edicao_tres_modos", TRES_MODOS, 14),
  b("edicao_ilustracao_explica_o_verbo", ILUSTRACAO_EXPLICA_O_VERBO, 13),
  b("edicao_legenda_e_lettering", LEGENDA_E_LETTERING, 17),
  b("edicao_tempo_e_movimento", TEMPO_E_MOVIMENTO, 12),
  b("edicao_sincronia", SINCRONIA, 16),
  b("edicao_montagem_e_takes", MONTAGEM_E_TAKES, 18),
  b("edicao_revisao_honesta", REVISAO_HONESTA, 19),
];

/** Onde cada bloco se apoia (para motores.ts e para a tela citar a fonte). */
export const FONTE_DO_BLOCO: Record<string, "brabo" | "kit_audiovisual"> = {
  edicao_da_fala_a_imagem: "brabo",
  edicao_tres_modos: "brabo",
  edicao_ilustracao_explica_o_verbo: "brabo",
  edicao_legenda_e_lettering: "brabo",
  edicao_tempo_e_movimento: "brabo",
  edicao_sincronia: "brabo",
  edicao_montagem_e_takes: "kit_audiovisual",
  edicao_revisao_honesta: "brabo",
};

export type TarefaDaEdicao = "pacote" | "legenda";

const TETO: Record<TarefaDaEdicao, number> = { pacote: 7200, legenda: 2400 };

const PRIORIDADE_DA_EDICAO =
  "PRIORIDADE: o briefing do cliente, o roteiro aprovado e as correções da equipe valem sobre este método. O método orienta; não é fórmula.";

const SEPARADOR = "\n\n";
const tamanhoDe = (lista: readonly BlocoDeConhecimento[]) => lista.reduce((s, x, i) => s + x.texto.length + (i ? SEPARADOR.length : 0), 0);

/** Mesma regra de montarComTeto (conhecimento-dos-agentes.ts): tira inteiro o bloco de menor corte até caber. */
function montar(blocos: readonly BlocoDeConhecimento[], teto: number, cabecalho: string): ConhecimentoMontado {
  let ficam = blocos.filter((x) => x.texto && x.texto.trim());
  const cortados: string[] = [];
  const ordemDeCorte = ficam.slice().sort((x, y) => x.corte - y.corte);
  for (const x of ordemDeCorte) {
    if (tamanhoDe(ficam) <= teto) break;
    ficam = ficam.filter((y) => y !== x);
    cortados.push(x.id);
  }
  const corpo = ficam.map((x) => x.texto).join(SEPARADOR);
  return { texto: corpo ? `${cabecalho}${SEPARADOR}${corpo}` : "", ids: ficam.map((x) => x.id), cortados, tamanho: tamanhoDe(ficam), teto };
}

/**
 * - pacote: direção de edição do "Pacote para editar" (editor humano ou o
 *   pipeline Remotion local do dono). Todos os blocos.
 * - legenda: pedido de transcrição e legenda (só o que muda a legenda).
 */
export function conhecimentoEdicao(tarefa: TarefaDaEdicao = "pacote"): ConhecimentoMontado {
  const blocos =
    tarefa === "legenda" ? BLOCOS_DA_EDICAO.filter((x) => x.id === "edicao_legenda_e_lettering" || x.id === "edicao_sincronia") : BLOCOS_DA_EDICAO;
  return montar(blocos, TETO[tarefa], PRIORIDADE_DA_EDICAO);
}

/** Colunas da tabela de beats do pacote (nomes da casa, na ordem de preencher). */
export const COLUNAS_DOS_BEATS = [
  "beat",
  "inicio_s",
  "fim_s",
  "fala",
  "gatilho",
  "entender",
  "modo",
  "objeto",
  "acao",
  "resultado",
  "leitura_s",
  "saida",
  "take",
  "midia",
  "som",
  "tempo",
] as const;

export const MODOS_DE_COMPOSICAO = [
  { valor: "ilustracao_e_apresentador", rotulo: "Ilustração com apresentador" },
  { valor: "lettering_e_apresentador", rotulo: "Lettering com apresentador" },
  { valor: "tela_cheia", rotulo: "Tela cheia editorial" },
] as const;
