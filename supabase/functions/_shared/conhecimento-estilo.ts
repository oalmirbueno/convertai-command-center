/**
 * Conhecimento do agente de estilo do cliente (frente S2, 26/09/2026).
 *
 * Pedido do dono: um agente especialista em design, arte, post e carrossel que
 * monta e aprende o ESTILO DE DESIGN de cada cliente. Pesquisa e fontes em
 * docs/estudio/ESTILO-DO-CLIENTE.md (texto próprio, nada copiado).
 * Registrado em motores.ts (motor estilo.agente, fonte pesquisa_estilo); o
 * teste src/test/estilo-do-cliente.test.ts cobra que os blocos chegam ao
 * prompt do agente.
 *
 * Este conhecimento vai só ao AGENTE (conversa e proposta do guia). O texto
 * ao gerador de imagem continua sem base de marketing (SEM_BASE_DE_PROPOSITO
 * em motores.ts): ele recebe só o bloco curto do estilo, montado em código
 * (estilo-do-cliente.ts, blocoDoEstiloParaOGerador).
 *
 * Puro: sem Deno, sem banco. Sem travessão.
 */

import { type ConhecimentoMontado, montarComTeto } from "./conhecimento-dos-agentes.ts";
import { ANTI_GENERICO, IDENTIDADE_DE_MARCA } from "./conhecimento-marketing.ts";

export const VERSAO_CONHECIMENTO_ESTILO = "2026-09-26.1";

// ------------------------------------------------------------------ blocos

export const SISTEMA_VISUAL_DE_SOCIAL = `SISTEMA VISUAL DE SOCIAL (o que um guia de estilo decide)
- Guia de post decide produção, não só identidade: formato da capa, hierarquia do título, área segura do texto, padrão de CTA e as regras dos formatos que se repetem.
- Layout e grade: margens iguais em todas as peças, área segura para texto, onde o título mora (topo, base, terço), quanto respiro sobra. Proporção única do formato (4:5 no feed).
- Tipografia: no máximo duas famílias e dois tamanhos por lâmina (título e apoio). Diga peso, caixa (alta ou baixa), largura e contraste entre título e apoio.
- Cor com função: uma dominante, um destaque e neutros de apoio por peça. O destaque marca a palavra ou o número que importa, nunca o texto inteiro. A paleta vem do kit; o guia diz o PAPEL de cada cor.
- Foto: o mesmo tratamento em todas as peças (luz, contraste, temperatura, grão, recorte). Nunca escurecer a foto para caber texto; resolver com área limpa, faixa ou posição.
- Elementos gráficos: poucos e repetidos (forma, linha, selo, textura, moldura). Um elemento que se repete vira assinatura; muitos viram enfeite.
- O que evitar é regra tão importante quanto o que fazer: escreva as proibições concretas do cliente.`;

export const CAPA_E_MIOLO = `CAPA, MIOLO E CTA DO CARROSSEL
- Capa é gancho: promessa concreta ou contraste, poucas palavras, contraste alto, legível na miniatura do feed. Um sinal sutil de "arraste" ajuda.
- Miolo: uma ideia por lâmina, cerca de 25 palavras no máximo, o MESMO molde em todas (margem, posição do título, cor do destaque). Desenhe a segunda lâmina primeiro: se ela conversa com a capa, o molde está certo.
- Cada lâmina é parte de uma série, não uma peça separada. Troca o conteúdo, não a identidade.
- Última lâmina espelha a capa (mesma cor e letra) e traz um CTA só, claro e curto.
- Estático de anúncio: uma mensagem, produto ou pessoa em destaque, título curto, CTA visível sem tapar o produto.`;

export const ESTILO_QUE_A_IA_SEGUE = `COMO ESCREVER O ESTILO PARA A IA DE IMAGEM SEGUIR
- Frases curtas e concretas, com rótulo (LAYOUT, TIPOGRAFIA, COR, FOTO, ELEMENTOS, CAPA, MIOLO, CTA, EVITAR). Posição, escala e cor; nada de adjetivo vazio ("moderno", "clean", "premium") sem dizer como aparece.
- Diga o que não muda junto com o que muda; a lista de proibições vai em toda geração para não derivar.
- As referências do estilo são guia de ACABAMENTO (tratamento, tipografia, composição), nunca conteúdo a copiar: não copiar texto, pessoa, produto ou marca de terceiro.
- O pedido da lâmina e as referências da lâmina mandam sobre o estilo. O estilo é ponto de partida para não ficar genérico, não uma trava.
- Menos é mais: o bloco que vai ao gerador é curto (as regras mais fortes primeiro). Regra que não aparece na imagem não entra.`;

export const APRENDER_COM_O_CLIENTE = `APRENDER COM O CLIENTE
- Todo "gostou" ou "não gostou" vira aprendizado com a frase e a data; o guia muda na próxima versão, com confirmação da equipe.
- Arte aprovada e publicada pesa mais que referência de terceiro: é o jeito que o cliente já aceitou.
- Várias referências de uma vez: ache o que se repete entre elas (é o estilo) e o que é só de uma (é detalhe). Diga o que tirou de cada uma.
- Pedido novo que contradiz o guia: pergunte se é exceção desta peça ou mudança do estilo. Mudança vira versão nova; exceção fica só na lâmina.
- Nunca inventar preferência do cliente: o que não foi dito nem visto fica como hipótese.`;

export const TENDENCIA_DO_NICHO = `TENDÊNCIA DO NICHO (o que chama atenção sem copiar)
- Olhe o que se repete nas contas fortes do nicho (capa, cor, tipo de foto, ritmo do carrossel) e diga o PADRÃO, nunca a peça de alguém.
- Tendência entra se combina com a marca; o que é moda passageira e fere a identidade fica de fora, com o motivo.
- Diferenciar: se todo o nicho usa o mesmo clichê (fundo bege e serifa fina, por exemplo), proponha como o cliente se destaca mantendo a legibilidade.
- Leitura de mercado é direção, não promessa de resultado.`;

// ------------------------------------------------------------------ montagem

export const TETO_ESTILO_AGENTE = 9_000;

const b = (id: string, texto: string, corte: number) => ({ id, texto, corte });

/** O agente de estilo (conversa, proposta do guia, leitura das referências). */
export function conhecimentoEstilo(): ConhecimentoMontado {
  return montarComTeto([
    b("sistema_visual_de_social", SISTEMA_VISUAL_DE_SOCIAL, 9),
    b("capa_e_miolo", CAPA_E_MIOLO, 8),
    b("estilo_que_a_ia_segue", ESTILO_QUE_A_IA_SEGUE, 9),
    b("aprender_com_o_cliente", APRENDER_COM_O_CLIENTE, 7),
    b("tendencia_do_nicho", TENDENCIA_DO_NICHO, 5),
    b("identidade_de_marca", IDENTIDADE_DE_MARCA, 4),
    b("anti_generico", ANTI_GENERICO, 6),
  ], TETO_ESTILO_AGENTE);
}
