/**
 * Conhecimento do agente do cliente no modo plano (frente C, 26/09): o
 * agente de contexto promovido a planejador de ponta a ponta.
 *
 * Dois blocos da casa (texto próprio) e blocos que já existem nas bases:
 * - comeco_do_cliente: como ler, escolher nicho realista, estágio,
 *   posicionamento e montar o plano pelo método ACELERA.
 * - caminho_e_stack: o que fazer primeiro e com que ferramenta, custo só com
 *   fonte.
 * - contexto_de_marketing, posicionamento_e_concorrencia, pesquisa_de_cliente,
 *   plano_de_campanha, seo_essencial (Perfil da Empresa no Google) e
 *   identidade_de_marca, das bases de marketing e dos repositórios.
 *
 * O índice dos motores (motores.ts, motor contexto.plano) registra os blocos
 * e as ferramentas de leitura; o teste cobra que a função chama a montagem.
 *
 * Puro: sem Deno, sem banco. Sem travessão.
 */
import { type BlocoDeConhecimento, type ConhecimentoMontado, montarComTeto } from "./conhecimento-dos-agentes.ts";
import { IDENTIDADE_DE_MARCA, PLANO_DE_CAMPANHA, POSICIONAMENTO_E_CONCORRENCIA, SEO_ESSENCIAL } from "./conhecimento-marketing.ts";
import { CONTEXTO_DE_MARKETING, PESQUISA_DE_CLIENTE } from "./conhecimento-repositorios.ts";

export const COMECO_DO_CLIENTE = `COMEÇO DO CLIENTE (método da casa para o agente do cliente)
1. Ler antes de propor: briefing, dossiê, cérebro, arquivos e o que a equipe colou. O que não estiver nas fontes vira pergunta, nunca invenção.
2. Nicho realista: o menor recorte em que o cliente pode ser lembrado como a escolha óbvia, na região e no estágio dele (não "estética", e sim "limpeza de pele para pele acneica no bairro X"). Diga por que o recorte cabe no que ele já entrega hoje, qual é o nicho de entrada e para onde ele evolui depois.
3. Estágio: começando (sem presença ou sem cliente recorrente), crescendo (vende, mas sem rotina nem número), consolidado (rotina e números). Plano de quem está começando não promete escala: primeiro presença, prova e rotina.
4. Posicionamento em uma frase: para quem, o que resolve e por que esta marca e não a vizinha, com diferencial comprovado.
5. Plano pelo método ACELERA: marcos na ordem das fases a partir da fase atual do cliente, cada um com data e sinal de pronto; tarefas de 1 a 5 dias, começando por verbo, com dono da equipe e prazo. Nada de tarefa vaga como "fazer marketing".
6. Negócio local começa pela base de busca: Perfil da Empresa no Google (tarefa com pacote externo pronto; o cadastro é feito com o dono, na conta dele, nunca com login em conta de terceiros), depois o perfil social arrumado, depois conteúdo e anúncio.
7. Identidade visual fraca ou inexistente vira marco próprio: briefing de identidade, geração do brand book fora do painel e importação do brand book de volta para o kit.
8. O que a equipe decidir na conversa (nicho, tom, o que evitar) vai em decisoes, para os outros agentes lembrarem.`;

export const CAMINHO_E_STACK = `CAMINHO E TECH STACK (o que fazer primeiro, com que ferramenta e por quê)
- Ordem pelo gargalo: o primeiro passo é o que destrava o próximo. Sem perfil no Google e sem atendimento organizado no WhatsApp, anúncio só queima verba.
- Ferramenta proporcional ao estágio: quem está começando usa o gratuito ou o barato que a equipe já domina (Perfil da Empresa no Google, WhatsApp Business, Instagram, Canva, site simples). Ferramenta paga só quando o volume pede.
- Custo só com fonte (página de preços consultada e a data). Sem fonte, escreva custo a confirmar. Nunca invente preço.
- Cada item da stack diz para que serve no negócio deste cliente e por quê. Nada de lista genérica de ferramentas da moda.
- Cuidados: acesso e senha ficam com o dono ou no cofre do painel, nunca no texto da conversa; toda conta fica no nome do cliente.`;

const b = (id: string, texto: string, corte: number): BlocoDeConhecimento => ({ id, texto, corte });

export const TETO_PLANO_DO_CLIENTE = 12_500;

export function conhecimentoDoPlano(): ConhecimentoMontado {
  return montarComTeto([
    b("comeco_do_cliente", COMECO_DO_CLIENTE, 10),
    b("caminho_e_stack", CAMINHO_E_STACK, 9),
    b("contexto_de_marketing", CONTEXTO_DE_MARKETING, 6),
    b("posicionamento_e_concorrencia", POSICIONAMENTO_E_CONCORRENCIA, 5),
    b("plano_de_campanha", PLANO_DE_CAMPANHA, 4),
    b("seo_essencial", SEO_ESSENCIAL, 3.5),
    b("pesquisa_de_cliente", PESQUISA_DE_CLIENTE, 3),
    b("identidade_de_marca", IDENTIDADE_DE_MARCA, 2),
  ], TETO_PLANO_DO_CLIENTE);
}
