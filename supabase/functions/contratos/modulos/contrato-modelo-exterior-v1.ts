/**
 * Bloco "Cliente no exterior", versão 1 (26/10/2026).
 *
 * Para contratante que mora fora do Brasil (Estados Unidos, Portugal,
 * Paraguai ou outro país). Serviço mensal com entrada: a entrada é o
 * diagnóstico e o site em 48 horas; o mensal é o pacote de conteúdo, a
 * campanha de conversa no WhatsApp, o agente e o painel. Os valores do
 * contrato inteiro passam a ser escritos na moeda escolhida aqui (dólar ou
 * euro), com o extenso na mesma moeda. Cada cláusula vem em português e logo
 * depois em inglês; prevalece o português.
 *
 * O documento do contratante (EIN, NIF, RUC ou passaporte) entra no campo
 * CPF ou CNPJ das condições gerais, que continua obrigatório.
 *
 * Texto próprio, com a marca interna "v1 · revisão jurídica pendente". Fonte
 * do seed da migration 20261026200000_contrato_exterior.sql (o teste confere
 * que o banco e este arquivo têm o mesmo texto). Sem travessão.
 */
import type { ModeloDeContrato } from "../../_shared/contrato-modelo.ts";
import { MENSAL, bloco, direitosDe, direitosDoBloco } from "./contrato-modelo-v1.ts";

export const BLOCO_EXTERIOR_V1: ModeloDeContrato = bloco("exterior", "Cliente no exterior (dólar ou euro)", [
  {
    nome: "ext_moeda", rotulo: "Moeda do contrato", tipo: "escolha", obrigatoria: true, padrao: "USD", grupo: "quadro",
    opcoes: [{ valor: "USD", rotulo: "Dólar americano (US$)" }, { valor: "EUR", rotulo: "Euro (€)" }],
    ajuda: "Todos os valores do contrato passam a ser escritos nesta moeda, com o extenso nela.",
  },
  { nome: "ext_pais", rotulo: "País e cidade do contratante", tipo: "texto", obrigatoria: true, grupo: "servico", ajuda: "Ex.: Estados Unidos, Orlando (FL). O documento do país (EIN, NIF, RUC ou passaporte) vai no campo CPF ou CNPJ." },
  { nome: "ext_valor_entrada", rotulo: "Entrada: diagnóstico e site em 48 horas", tipo: "moeda", obrigatoria: true, padrao: "297", grupo: "quadro" },
  ...MENSAL,
  { nome: "ext_vigencia_minima_meses", rotulo: "Vigência mínima do mensal (meses)", tipo: "inteiro", obrigatoria: true, padrao: "3", grupo: "servico" },
  {
    nome: "ext_via_pagamento", rotulo: "Via de pagamento internacional", tipo: "escolha", obrigatoria: true, padrao: "Husky", grupo: "servico",
    opcoes: [
      { valor: "Husky", rotulo: "Husky (transferência local no país do contratante)" },
      { valor: "Wise Business", rotulo: "Wise Business (transferência local no país do contratante)" },
      { valor: "cartão internacional (Stripe)", rotulo: "Cartão internacional (Stripe)" },
    ],
  },
  { nome: "ext_conta_anuncios", rotulo: "Conta de anúncios do contratante", tipo: "texto", obrigatoria: true, grupo: "servico", ajuda: "Id ou nome da conta. A verba de mídia é paga pelo contratante nela." },
  { nome: "ext_fuso", rotulo: "Fuso horário do contratante", tipo: "texto", obrigatoria: true, padrao: "America/New_York", grupo: "servico" },
  { nome: "ext_pecas_mes", rotulo: "Peças por mês", tipo: "texto", obrigatoria: true, padrao: "2 Reels com roteiro para o contratante gravar e 6 carrosséis, com legenda", grupo: "servico" },
  direitosDe("exterior", "cliente no exterior"),
], [
  {
    chave: "idioma",
    titulo: "Idioma e prevalência / Language",
    texto: "Este anexo é redigido em português, com versão em inglês para conveniência do CONTRATANTE, estabelecido em {{ext_pais}}. Em caso de divergência, prevalece o texto em português.\nThis annex is written in Portuguese, with an English version for the convenience of the CLIENT, established in {{ext_pais}}. In case of discrepancy, the Portuguese text prevails.",
  },
  {
    chave: "entrada",
    titulo: "Entrada: diagnóstico e site em 48 horas / Onboarding",
    texto: "Com o aceite e a confirmação do pagamento da entrada de {{ext_valor_entrada}}, a CONTRATADA entrega em até 48 horas úteis: diagnóstico em vídeo do negócio na cidade do CONTRATANTE, site de uma página em português e inglês no domínio do CONTRATANTE, Perfil Google criado ou corrigido e WhatsApp Business com mensagem de boas-vindas. Domínio e hospedagem ficam em nome do CONTRATANTE.\nUpon acceptance and confirmation of the onboarding payment of {{ext_valor_entrada}}, the AGENCY delivers within 48 business hours: a video diagnosis of the business in the city of the CLIENT, a one-page website in Portuguese and English on the domain of the CLIENT, a Google Business Profile created or fixed, and WhatsApp Business with a welcome message. Domain and hosting remain in the name of the CLIENT.",
  },
  {
    chave: "mensal",
    titulo: "Serviço mensal / Monthly service",
    texto: "O serviço mensal inclui {{ext_pecas_mes}}, uma campanha de conversa no WhatsApp montada e acompanhada pela CONTRATADA, atendimento automatizado no WhatsApp do CONTRATANTE (responde, registra e cobra, com supervisão humana) e acesso ao painel do cliente com o Dia Prioritário. Pedidos acima do pacote são orçados à parte. Saldo não usado não acumula.\nThe monthly service includes {{ext_pecas_mes}}, one WhatsApp conversation campaign set up and monitored by the AGENCY, automated assistance on the WhatsApp of the CLIENT (replies, records and sends payment reminders, under human supervision) and access to the client dashboard with the Priority Day. Requests beyond the package are quoted separately. Unused balance does not roll over.",
  },
  {
    chave: "midia",
    titulo: "Verba de anúncios / Ad spend",
    texto: "A verba de anúncios não faz parte dos valores deste contrato. Ela é paga pelo CONTRATANTE, na conta de anúncios {{ext_conta_anuncios}}, com meio de pagamento dele, na moeda do país. A CONTRATADA opera a conta por acesso de parceiro, sem senha pessoal, e registra cada ação no painel.\nAd spend is not part of the amounts in this agreement. It is paid by the CLIENT in the ad account {{ext_conta_anuncios}}, with the own payment method of the CLIENT and in the local currency. The AGENCY operates the account through partner access, never with a personal password, and records every action in the dashboard.",
  },
  {
    chave: "pagamento_internacional",
    titulo: "Moeda e pagamento internacional / Currency and international payment",
    texto: "Os valores deste contrato são fixados em {{ext_moeda}}. A entrada é paga antes do início e o mensal de {{valor_mensal}} vence no dia {{vencimento_dia}} de cada mês, por transferência internacional via {{ext_via_pagamento}}, com as instruções na fatura (invoice). Taxas cobradas pelo banco do CONTRATANTE correm por conta dele; as taxas de recebimento e conversão no Brasil correm por conta da CONTRATADA. A CONTRATADA emite nota fiscal de exportação de serviço com o valor convertido em reais pela taxa oficial do dia útil anterior.\nThe amounts in this agreement are set in {{ext_moeda}}. The onboarding is paid before the start and the monthly fee of {{valor_mensal}} is due on day {{vencimento_dia}} of each month, by international transfer via {{ext_via_pagamento}}, with instructions on the invoice. Fees charged by the bank of the CLIENT are borne by the CLIENT; receiving and conversion fees in Brazil are borne by the AGENCY. The AGENCY issues a Brazilian export-of-services invoice with the amount converted into reais at the official rate of the previous business day.",
  },
  {
    chave: "tributos_no_pais",
    titulo: "Tributos no país do contratante / Taxes in the country of the CLIENT",
    texto: "Impostos, retenções ou taxas que a lei do país do CONTRATANTE aplique à contratação de serviço prestado do exterior são de responsabilidade do CONTRATANTE e não reduzem o valor devido à CONTRATADA.\nTaxes, withholdings or fees that the law of the country of the CLIENT applies to hiring a service provided from abroad are the responsibility of the CLIENT and do not reduce the amount owed to the AGENCY.",
  },
  {
    chave: "vigencia_minima",
    titulo: "Vigência mínima do mensal / Minimum term",
    texto: "A vigência mínima do serviço mensal é de {{ext_vigencia_minima_meses}} meses. Se o CONTRATANTE encerrar antes, sem justa causa, paga multa de {{multa_rescisao_percentual}} sobre as mensalidades que faltam para completar a vigência mínima.\nThe minimum term of the monthly service is {{ext_vigencia_minima_meses}} months. If the CLIENT terminates earlier without cause, a penalty of {{multa_rescisao_percentual}} applies to the remaining monthly fees of the minimum term.",
  },
  {
    chave: "fuso_e_canal",
    titulo: "Fuso horário e canal oficial / Time zone and official channel",
    texto: "Prazos em horas ou dias úteis seguem o calendário de Curitiba, Brasil. Reuniões e conversas são marcadas no fuso {{ext_fuso}}. O canal oficial é o painel e o e-mail indicado no quadro-resumo; o WhatsApp serve para agilidade.\nDeadlines in business hours or days follow the calendar of Curitiba, Brazil. Meetings and calls are scheduled in the {{ext_fuso}} time zone. The official channel is the dashboard and the e-mail in the summary table; WhatsApp is for convenience.",
  },
  {
    chave: "dados_no_exterior",
    titulo: "Dados pessoais no exterior / Personal data abroad",
    texto: "Além da LGPD, a CONTRATADA observa, no tratamento de dados de clientes do CONTRATANTE, as regras de proteção de dados do país dele (como o GDPR na União Europeia e as leis estaduais dos Estados Unidos), agindo sempre como operadora conforme as instruções do CONTRATANTE, que é o controlador.\nIn addition to the Brazilian LGPD, the AGENCY observes, when processing data of the customers of the CLIENT, the data protection rules of the country of the CLIENT (such as the GDPR in the European Union and state laws in the United States), always acting as processor under the instructions of the CLIENT, who is the controller.",
  },
  {
    chave: "lei_e_foro",
    titulo: "Lei aplicável e foro / Governing law and venue",
    texto: "Aplica-se a lei brasileira. As partes tentam resolver divergências por negociação direta e, se preciso, por mediação online. Persistindo o conflito, vale o foro das condições gerais, sem prejuízo de normas obrigatórias de proteção ao consumidor do país do CONTRATANTE.\nBrazilian law applies. The parties shall first attempt to resolve disputes by direct negotiation and, if necessary, by online mediation. If the dispute persists, the venue set in the general terms applies, without prejudice to mandatory consumer-protection rules of the country of the CLIENT.",
  },
  ...direitosDoBloco("exterior",
    "Os direitos patrimoniais das peças e do site entregues são cedidos ao CONTRATANTE depois do pagamento correspondente.\nThe economic rights to the pieces and the website delivered are assigned to the CLIENT after the corresponding payment.",
    "O CONTRATANTE recebe licença de uso das peças e do site entregues, sem prazo, nos canais dele.\nThe CLIENT receives a license to use the pieces and the website delivered, with no time limit, on the channels of the CLIENT."),
]);

export const MODELOS_EXTERIOR_V1: ModeloDeContrato[] = [BLOCO_EXTERIOR_V1];
