/**
 * Conhecimento de publicidade da Mesa Publicidade (frente P, 26/09/2026).
 *
 * Destilado do kit de pesquisa "Mesa de Publicidade" (24/09/2026, pasta
 * kits/publicidade: DOSSIE-PUBLICIDADE.md, RECEITAS-E-PROMPTS.md,
 * receitas-campanhas.json e ESPECIFICACAO-E-BACKLOG.md). Texto próprio em
 * português, sem copiar campanha de terceiro. Registrado em motores.ts
 * (motores mesa_publicidade.diretor e mesa_publicidade.agente); o teste
 * src/test/mesa-publicidade.test.ts cobra que os blocos chegam ao prompt.
 *
 * Divisão do kit, que vale aqui: a Mesa Publicidade DIRIGE a campanha, a
 * Mesa Foto PRODUZ as imagens, a Mesa Ads testa e mede. Todas usam o mesmo
 * produto (kit da Mesa Foto), o mesmo acervo (cliente_imagens), a mesma
 * carteira e as mesmas aprovações.
 *
 * As receitas por categoria são DADO: o diretor recebe a receita da
 * categoria da campanha dentro da mensagem (não como bloco do sistema), e a
 * tela mostra a mesma receita. Nenhuma receita é campanha vencedora.
 *
 * Puro: sem Deno, sem banco (a tela e o vitest leem este arquivo). Sem travessão.
 */

import { type ConhecimentoMontado, montarComTeto } from "./conhecimento-dos-agentes.ts";
import { ANTI_GENERICO, IDENTIDADE_DE_MARCA, OBJECOES_E_VOZ_DO_CLIENTE, PLANO_DE_CAMPANHA } from "./conhecimento-marketing.ts";
import { FOTO_DE_PRODUTO_COM_VERDADE } from "./conhecimento-repositorios.ts";

export const VERSAO_CONHECIMENTO_PUBLICIDADE = "2026-09-26.1";

// ------------------------------------------------------------------ blocos

export const VERDADE_DO_PRODUTO = `VERDADE DO PRODUTO (antes de qualquer ideia)
- O produto é a fonte da verdade: nome, variante, material, fotos reais e o que o cliente confirmou. Estilo, pose e cenário são referências; nunca substituem o produto.
- Cada dado do briefing tem estado: confirmado (com fonte), hipótese ou pendente. Preço, desconto, prazo, estoque e benefício técnico só entram confirmados e com fonte.
- Liste o que não pode mudar: logo e texto do rótulo, cor da variante, formato, detalhe de material (costura, ferragem, haste, tampa). Isso vale sobre qualquer escolha estética.
- Foto de frente não comprova lateral, encaixe ou verso. Vista sem evidência vira lacuna, nunca promessa.
- Pessoa sintética é marcada como gerada, é adulta e não se parece com ninguém real. Nunca vira depoimento nem cliente real.`;

export const TERRITORIOS_CRIATIVOS = `TRÊS TERRITÓRIOS CRIATIVOS (caminhos diferentes de verdade)
- Um território é uma ideia que organiza a campanha: tensão humana (situação real do comprador), promessa que o produto sustenta, mecanismo visual e razão para acreditar.
- Os três precisam mudar a motivação, não só a cor do fundo: por exemplo expressão pessoal, rotina e presente. Três frases parecidas não são três territórios.
- Cada território define direção de arte (paleta, luz, tratamento, enquadramentos), casting (perfil, idade adulta, estilo, figurino), ambiente e luz, e diz por que combina com a marca e foge do clichê da categoria.
- Referência de estilo inspira; nunca copie foto, pessoa, marca ou peça de outra empresa.
- Sem prova inventada: nada de depoimento, número de venda, prêmio ou benefício que o briefing não confirma.
- Surrealismo pode morar no cenário; o produto continua sendo a versão real.`;

export const PLANO_DE_TOMADAS_PUBLICITARIAS = `PLANO DE SEIS TOMADAS (cada foto tem uma função)
- Seis funções, uma foto cada: atrair (abre a sequência), apresentar o produto (legível na miniatura), contextualizar o uso (produto na rotina), mostrar detalhe (acabamento, material), expressar o conceito (a ideia do território) e apoiar a ação (espaço limpo para chamada).
- Alterne distância e assunto: rosto, produto, detalhe, ambiente. A sequência evita grade repetida.
- Reserve espaço negativo na tomada que vai receber texto, sem tapar o produto.
- Contato e escala plausíveis: óculos no nariz com haste atrás da orelha, mão envolvendo a bolsa, anel acompanhando o dedo.
- Produzir pouco e bem: seis tomadas aprovadas valem mais que vinte parecidas.`;

export const PRODUTO_ANTES_DA_ESTETICA = `REVISÃO: PRODUTO ANTES DA ESTÉTICA
- Primeiro a fidelidade: produto e variante certos, logo e texto iguais, formato, cor e detalhes de material iguais às fontes. Só depois estética, luz e composição.
- Mudou logo, formato, cor da variante ou detalhe material: a foto é reprovada, mesmo bonita. Nota alta de beleza não compensa produto errado.
- Quando a evidência não permite concluir, a resposta é "não dá para saber" e uma pessoa olha. Nunca aprovar por falta de prova do erro.
- Uma revisão aponta a regra violada e a fonte, não "ficou pouco premium".`;

export const APROVACOES_SEPARADAS = `APROVAÇÕES SEPARADAS E LINHAGEM
- Aprovar a foto não aprova anúncio, publicação nem verba. Cada destino tem aprovação própria (Mesa para o orgânico, Mesa Ads para o anúncio).
- Toda peça guarda de onde veio: campanha, versão do briefing, território, tomada, versão da foto e fontes do produto.
- Resultado comercial só com dado real, período e atribuição; sem dado, o registro é "desempenho ainda desconhecido".`;

// ------------------------------------------------------------------ receitas por categoria (dado)

export {
  FUNCOES_DAS_TOMADAS,
  type FuncaoDaTomada,
  RECEITAS_DE_PUBLICIDADE,
  receitaComoDado,
  receitaDaCategoria,
  receitaParaProduto,
  type ReceitaDePublicidade,
} from "./receitas-de-publicidade.ts";

// ------------------------------------------------------------------ montagem por momento

export type MomentoDaPublicidade = "diretor" | "agente";

export const TETO_PUBLICIDADE_DIRETOR = 12_000;
export const TETO_PUBLICIDADE_AGENTE = 7_000;

const b = (id: string, texto: string, corte: number) => ({ id, texto, corte });

/**
 * diretor: propõe os três territórios (método completo, marca, anti-genérico
 * e a técnica de foto de produto com verdade).
 * agente: conversa e propõe ações (verdade do produto, revisão e aprovações).
 */
export function conhecimentoPublicidade(momento: MomentoDaPublicidade = "diretor"): ConhecimentoMontado {
  if (momento === "agente") {
    return montarComTeto([
      b("verdade_do_produto", VERDADE_DO_PRODUTO, 9),
      b("produto_antes_da_estetica", PRODUTO_ANTES_DA_ESTETICA, 8),
      b("aprovacoes_separadas", APROVACOES_SEPARADAS, 7),
      b("territorios_criativos", TERRITORIOS_CRIATIVOS, 6),
      b("plano_de_tomadas_publicitarias", PLANO_DE_TOMADAS_PUBLICITARIAS, 5),
      b("anti_generico", ANTI_GENERICO, 1),
    ], TETO_PUBLICIDADE_AGENTE);
  }
  return montarComTeto([
    b("verdade_do_produto", VERDADE_DO_PRODUTO, 9),
    b("territorios_criativos", TERRITORIOS_CRIATIVOS, 9),
    b("plano_de_tomadas_publicitarias", PLANO_DE_TOMADAS_PUBLICITARIAS, 8),
    b("produto_antes_da_estetica", PRODUTO_ANTES_DA_ESTETICA, 7),
    b("aprovacoes_separadas", APROVACOES_SEPARADAS, 6),
    b("identidade_de_marca", IDENTIDADE_DE_MARCA, 4),
    b("plano_de_campanha", PLANO_DE_CAMPANHA, 3),
    b("objecoes_e_voz_do_cliente", OBJECOES_E_VOZ_DO_CLIENTE, 2),
    b("anti_generico", ANTI_GENERICO, 5),
    b("foto_de_produto_com_verdade", FOTO_DE_PRODUTO_COM_VERDADE, 1),
  ], TETO_PUBLICIDADE_DIRETOR);
}
