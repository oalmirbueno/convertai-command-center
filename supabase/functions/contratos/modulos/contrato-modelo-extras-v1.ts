/**
 * Cláusulas extras e termo aditivo da Aceleriq, versão 1 (frente CON2, 30/09/2026).
 *
 * - Biblioteca de cláusulas extras (tipo "extras"): confidencialidade
 *   reforçada, exclusividade, prazo de resposta (SLA) e uso da marca do
 *   cliente em portfólio. Cada uma entra no contrato só quando o dono liga a
 *   chave dela (variável extra_* = "sim"); os parâmetros (multa, segmento,
 *   horas) vêm da equipe, nunca do modelo de linguagem.
 * - Termo aditivo (tipo "aditivo"): muda escopo, valor ou vigência de um
 *   contrato assinado. O que muda é escrito pela equipe; o código escreve o
 *   número do contrato original, a data e o código de integridade dele.
 *
 * Texto próprio, em português do Brasil, com a marca interna
 * "v1 · revisão jurídica pendente" (só a equipe vê). Fonte do seed da
 * migration 20260930195200_contratos_extras_e_aditivo_v1.sql (o teste confere
 * que o banco e este arquivo têm o mesmo texto). Sem travessão.
 */
import type { ModeloDeContrato, OpcaoDaVariavel } from "../../_shared/contrato-modelo.ts";
import { REVISAO_JURIDICA_V1 } from "./contrato-modelo-v1.ts";

const SIM_NAO: OpcaoDaVariavel[] = [
  { valor: "sim", rotulo: "Sim" },
  { valor: "nao", rotulo: "Não" },
];

/** As chaves que ligam cada cláusula extra (a tela e as preferências do dono usam a mesma lista). */
export const CHAVES_DAS_EXTRAS = ["extra_confidencialidade", "extra_exclusividade", "extra_sla", "extra_marca_portfolio"] as const;
export type ChaveDaExtra = (typeof CHAVES_DAS_EXTRAS)[number];

export const ROTULO_DAS_EXTRAS: Record<ChaveDaExtra, string> = {
  extra_confidencialidade: "Confidencialidade reforçada",
  extra_exclusividade: "Exclusividade no segmento",
  extra_sla: "Prazo de resposta (SLA)",
  extra_marca_portfolio: "Uso da marca do cliente em portfólio",
};

export const EXTRAS_V1: ModeloDeContrato = {
  chave: "clausulas_extras",
  tipo: "extras",
  servico: null,
  nome: "Cláusulas extras",
  versao: 1,
  revisao_juridica: REVISAO_JURIDICA_V1,
  variaveis: [
    { nome: "extra_confidencialidade", rotulo: "Confidencialidade reforçada", tipo: "escolha", padrao: "nao", opcoes: SIM_NAO, grupo: "extras", ajuda: "Sigilo estendido à equipe e a parceiros, devolução do material no fim e multa por quebra." },
    { nome: "extra_confidencialidade_multa", rotulo: "Multa por quebra de sigilo", tipo: "moeda", grupo: "extras", ajuda: "Só vale com a confidencialidade reforçada ligada." },
    { nome: "extra_exclusividade", rotulo: "Exclusividade no segmento", tipo: "escolha", padrao: "nao", opcoes: SIM_NAO, grupo: "extras", ajuda: "A agência não atende concorrente direto do cliente no segmento e na região combinados." },
    { nome: "extra_exclusividade_segmento", rotulo: "Segmento da exclusividade", tipo: "texto", grupo: "extras", ajuda: "Ex.: padarias artesanais." },
    { nome: "extra_exclusividade_regiao", rotulo: "Região da exclusividade", tipo: "texto", grupo: "extras", ajuda: "Ex.: cidade de Londrina/PR." },
    { nome: "extra_sla", rotulo: "Prazo de resposta (SLA)", tipo: "escolha", padrao: "nao", opcoes: SIM_NAO, grupo: "extras", ajuda: "Tempo máximo para a agência dar o primeiro retorno no canal oficial." },
    { nome: "extra_sla_horas", rotulo: "Prazo de resposta (horas úteis)", tipo: "inteiro", grupo: "extras", feminino: true },
    { nome: "extra_marca_portfolio", rotulo: "Uso da marca do cliente em portfólio", tipo: "escolha", padrao: "nao", opcoes: SIM_NAO, grupo: "extras", ajuda: "O cliente autoriza citar o nome e mostrar a marca como case." },
  ],
  clausulas: [
    {
      chave: "confidencialidade_reforcada",
      titulo: "Confidencialidade reforçada",
      quando: { variavel: "extra_confidencialidade", igual: "sim" },
      texto: [
        "Além da cláusula de confidencialidade, a CONTRATADA faz cada pessoa da equipe e cada parceiro que tiver acesso a informação confidencial do CONTRATANTE assumir o mesmo dever de sigilo, por escrito.",
        "No fim do contrato, ou quando o CONTRATANTE pedir, a CONTRATADA devolve ou elimina o material confidencial recebido, salvo a guarda exigida por lei, e confirma por escrito.",
        "A parte que revelar informação confidencial em desacordo com este contrato paga à outra multa de {{extra_confidencialidade_multa}}, sem prejuízo da indenização do dano que passar desse valor.",
      ].join("\n"),
    },
    {
      chave: "exclusividade",
      titulo: "Exclusividade",
      quando: { variavel: "extra_exclusividade", igual: "sim" },
      texto: [
        "Durante a vigência deste contrato, a CONTRATADA não presta os mesmos serviços a concorrente direto do CONTRATANTE no segmento de {{extra_exclusividade_segmento}}, na região de {{extra_exclusividade_regiao}}.",
        "A exclusividade não alcança clientes que a CONTRATADA já atendia antes da assinatura, nem serviços diferentes dos contratados, e termina junto com o contrato.",
      ].join("\n"),
    },
    {
      chave: "sla_resposta",
      titulo: "Prazo de resposta",
      quando: { variavel: "extra_sla", igual: "sim" },
      texto: [
        "A CONTRATADA dá o primeiro retorno às mensagens do CONTRATANTE no canal oficial em até {{extra_sla_horas}} horas úteis, em dias úteis e no horário comercial.",
        "Esse é o prazo do primeiro retorno. O prazo de execução de cada pedido segue o anexo do serviço, e urgência fora do horário comercial depende de combinação prévia.",
      ].join("\n"),
    },
    {
      chave: "marca_em_portfolio",
      titulo: "Uso da marca do CONTRATANTE em portfólio",
      quando: { variavel: "extra_marca_portfolio", igual: "sim" },
      texto: [
        "O CONTRATANTE autoriza a CONTRATADA a citar o nome dele e a mostrar a marca e as entregas já publicadas no portfólio, em apresentações comerciais, no site e nas redes sociais da CONTRATADA, como caso de trabalho, sem custo, durante o contrato e depois dele.",
        "A autorização não inclui imagem de pessoas, dados internos nem números de resultado sem autorização escrita, e pode ser revogada para usos futuros pelo canal oficial.",
      ].join("\n"),
    },
  ],
};

// ------------------------------------------------------------------ termo aditivo

/**
 * Valores que o código escreve no aditivo (nunca a equipe nem o modelo):
 * contrato_mae_numero, contrato_mae_versao, contrato_mae_data e
 * contrato_mae_codigo; aditivo_servicos_incluidos vem dos anexos escolhidos.
 */
export const VALORES_DO_SISTEMA_NO_ADITIVO = ["contrato_mae_numero", "contrato_mae_versao", "contrato_mae_data", "contrato_mae_codigo", "aditivo_servicos_incluidos"];

export const ADITIVO_V1: ModeloDeContrato = {
  chave: "termo_aditivo",
  tipo: "aditivo",
  servico: null,
  nome: "Termo aditivo",
  versao: 1,
  revisao_juridica: REVISAO_JURIDICA_V1,
  variaveis: [
    { nome: "aditivo_descricao", rotulo: "O que muda", tipo: "textoLongo", obrigatoria: true, grupo: "aditivo", ajuda: "Em uma ou duas frases, a mudança de escopo, valor ou prazo." },
    { nome: "aditivo_inicio_efeitos", rotulo: "A partir de quando vale", tipo: "data", obrigatoria: true, grupo: "aditivo" },
    { nome: "aditivo_valor_mensal_novo", rotulo: "Novo valor mensal", tipo: "moeda", grupo: "aditivo" },
    { nome: "aditivo_valor_adicional", rotulo: "Valor adicional (projeto)", tipo: "moeda", grupo: "aditivo" },
    { nome: "aditivo_vigencia_fim_nova", rotulo: "Nova data de fim da vigência", tipo: "data", grupo: "aditivo" },
    { nome: "aditivo_servicos_retirados", rotulo: "Serviços que saem", tipo: "texto", grupo: "aditivo" },
  ],
  clausulas: [
    {
      chave: "objeto",
      titulo: "Objeto do aditivo",
      texto: [
        "Este termo aditivo altera o contrato nº {{contrato_mae_numero}}, versão {{contrato_mae_versao}}, assinado entre as mesmas partes em {{contrato_mae_data}}, com o código de integridade {{contrato_mae_codigo}}.",
        "O que muda: {{aditivo_descricao}}",
      ].join("\n"),
    },
    {
      chave: "servicos_incluidos",
      titulo: "Serviços incluídos",
      quando: { variavel: "aditivo_servicos_incluidos", preenchida: true },
      texto: "Passam a fazer parte do contrato, a partir de {{aditivo_inicio_efeitos}}, os serviços {{aditivo_servicos_incluidos}}, descritos nos anexos deste aditivo e regidos pelas condições gerais do contrato.",
    },
    {
      chave: "servicos_retirados",
      titulo: "Serviços que saem",
      quando: { variavel: "aditivo_servicos_retirados", preenchida: true },
      texto: "Deixam de fazer parte do contrato, a partir de {{aditivo_inicio_efeitos}}, os serviços: {{aditivo_servicos_retirados}}. As entregas já aprovadas e pagas continuam valendo, com a regra de direitos do contrato.",
    },
    {
      chave: "valor_mensal",
      titulo: "Novo valor mensal",
      quando: { variavel: "aditivo_valor_mensal_novo", preenchida: true },
      texto: "A partir de {{aditivo_inicio_efeitos}}, o valor mensal passa a ser {{aditivo_valor_mensal_novo}}, com o mesmo dia de vencimento, a mesma forma de pagamento e o mesmo reajuste do contrato.",
    },
    {
      chave: "valor_adicional",
      titulo: "Valor adicional",
      quando: { variavel: "aditivo_valor_adicional", preenchida: true },
      texto: "Pelo que este aditivo inclui, o CONTRATANTE paga o valor adicional de {{aditivo_valor_adicional}}, na forma de pagamento do contrato.",
    },
    {
      chave: "vigencia",
      titulo: "Vigência",
      quando: { variavel: "aditivo_vigencia_fim_nova", preenchida: true },
      texto: "A vigência do contrato passa a terminar em {{aditivo_vigencia_fim_nova}}, mantidas as regras de renovação, aviso prévio e rescisão.",
    },
    {
      chave: "ratificacao",
      titulo: "O que continua valendo",
      texto: "Continuam valendo, sem mudança, todas as cláusulas do contrato e dos anexos que este aditivo não alterou. Este aditivo faz parte do contrato para todos os efeitos, e havendo conflito entre os dois, vale o aditivo no que ele alterou.",
    },
  ],
};

export const MODELOS_EXTRAS_V1: ModeloDeContrato[] = [EXTRAS_V1, ADITIVO_V1];
