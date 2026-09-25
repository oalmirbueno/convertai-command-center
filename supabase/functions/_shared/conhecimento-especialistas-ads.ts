/**
 * Base dos especialistas de tráfego para a Mesa Ads (Frente R, 25/09/2026).
 *
 * Pedido do dono (25/09): trazer a base pública e gratuita do Pedro Sobral
 * (tráfego: estrutura, orçamento, públicos, criativos, testes, escala,
 * métricas) e completar a Natália Torres (criativos), "sem perder o que já
 * tem, complementando". A pesquisa com todas as fontes está em
 * docs/conhecimento/pedro-sobral.md e docs/conhecimento/natalia-torres.md;
 * o que já existia da Natália está em docs/mesa-ads/pesquisa/DOSSIE-CRIATIVOS.md
 * e em conhecimento-ads.ts (TECNICAS, METODO_DA_REFERENCIA), que continuam
 * valendo e não são repetidos aqui.
 *
 * Regras deste módulo:
 * - Cada princípio tem especialista, fonte (URL), data de publicação e
 *   confiança. "fala" é posição publicada pelo especialista ou pela marca
 *   dele; "sintese" é leitura da agência a partir da fonte.
 * - Resumo nas palavras da agência; nenhuma citação longa.
 * - Números de corte e escala são REFERÊNCIA para o texto da IA. A decisão
 *   (pausar, escalar) é calculada em código com a régua do cliente (custo
 *   tolerável do briefing), como FOCO_EM_RESULTADO em conhecimento-ads.ts.
 * - Onde divergir de conhecimento-ads.ts, vale conhecimento-ads.ts, e o texto
 *   aqui diz a divergência.
 * - Sem dependências. Sem travessão.
 */

export const VERSAO_ESPECIALISTAS_ADS = "2026-09-25.1";

export type Especialista = "pedro_sobral" | "natalia_torres";
export type TemaEspecialista =
  | "estrutura"
  | "orcamento"
  | "publico"
  | "criativo"
  | "teste"
  | "metricas_corte"
  | "funil"
  | "erros"
  | "ia_automacao";
export type Confianca = "alta" | "media" | "baixa";

export type PrincipioEspecialista = {
  id: string;
  especialista: Especialista;
  tema: TemaEspecialista;
  /** Regra acionável, nas palavras da agência. */
  regra: string;
  /** Números que a fonte deu, quando deu. */
  numeros?: string;
  fonte: string;
  /** Data de publicação da fonte (AAAA-MM-DD). */
  data: string;
  confianca: Confianca;
  natureza: "fala" | "sintese";
};

export const NOME_DO_ESPECIALISTA: Record<Especialista, string> = {
  pedro_sobral: "Pedro Sobral (Subido)",
  natalia_torres: "Natália Torres (Ads Rocket)",
};

const PS = "https://pedrosobral.com.br/blog/c";

// ------------------------------------------------------------------ Pedro Sobral
export const PRINCIPIOS_PEDRO_SOBRAL: PrincipioEspecialista[] = [
  // estrutura
  { id: "ps_tres_campanhas", especialista: "pedro_sobral", tema: "estrutura", regra: "Três tipos de campanha cobrem quase todo o trabalho: criar audiência, gerar clientes potenciais (formulário, WhatsApp ou página) e vender dentro do ROAS previsto.", fonte: `${PS}/introducao-ao-trafego-pago/os-3-tipos-de-campanha-que-todo-gestor-de-trafego-precisa-dominar-no-meta-ads`, data: "2025-02-24", confianca: "alta", natureza: "fala" },
  { id: "ps_orcamento_na_campanha", especialista: "pedro_sobral", tema: "estrutura", regra: "Orçamento definido na campanha (orçamento Advantage+ de campanha, antigo CBO).", numeros: "mínimo de R$ 30 por dia na campanha de audiência", fonte: `${PS}/introducao-ao-trafego-pago/os-3-tipos-de-campanha-que-todo-gestor-de-trafego-precisa-dominar-no-meta-ads`, data: "2025-02-24", confianca: "alta", natureza: "fala" },
  { id: "ps_hierarquia", especialista: "pedro_sobral", tema: "estrutura", regra: "A campanha define o objetivo, o conjunto define o público e o anúncio carrega o criativo; não misturar as funções.", fonte: `${PS}/trafego-pago-no-meta-ads/segmentacao-de-anuncios-em-2026-o-guia-completo-para-achar-o-publico-certo`, data: "2026-09-14", confianca: "alta", natureza: "fala" },
  { id: "ps_conjuntos_por_campanha", especialista: "pedro_sobral", tema: "estrutura", regra: "Campanha com vários conjuntos separando temperaturas de público; conta pequena concentra em uma campanha forte.", numeros: "de 4 a 8 conjuntos por campanha, teto de 12; de 3 a 5 anúncios por conjunto (guia 2026; em 2024 eram 6); abaixo de R$ 500 por mês, uma campanha só (artigos de 2024 a 2026)", fonte: `${PS}/estrategias-de-trafego-pago/como-escalar-o-resultado-das-suas-campanhas`, data: "2024-12-06", confianca: "alta", natureza: "fala" },
  { id: "ps_quente_frio_separados", especialista: "pedro_sobral", tema: "estrutura", regra: "Público quente com verba constante; público frio (semelhante e interesse) testado em campanha separada, sem disputar verba com o quente; público geográfico isolado; uma campanha automática rodando ao lado das manuais.", fonte: `${PS}/trafego-pago-no-meta-ads/segmentacao-de-anuncios-em-2026-o-guia-completo-para-achar-o-publico-certo`, data: "2026-09-14", confianca: "alta", natureza: "fala" },
  { id: "ps_evento_onde_converte", especialista: "pedro_sobral", tema: "estrutura", regra: "O evento de conversão é o do lugar onde a conversão acontece: WhatsApp, Direct, Messenger ou site com pixel. Posicionamento automático recomendado; campanha manual é a melhor para aprender, Advantage+ é a recomendada pela Meta.", fonte: `${PS}/trafego-pago-no-meta-ads/como-criar-campanhas-no-meta-ads-em-2026-o-guia-completo-para-anunciar-no-instagram-facebook-e-whatsapp`, data: "2026-03-13", confianca: "alta", natureza: "fala" },
  { id: "ps_local_seguidores_mensagens", especialista: "pedro_sobral", tema: "estrutura", regra: "Negócio local começando: uma campanha de seguidores com Reels para construir audiência e uma de mensagens para o público quente vender por WhatsApp ou Direct.", fonte: `${PS}/estrategias-de-trafego-pago/insights-vazados-do-meu-curso-gratuito`, data: "2026-09-23", confianca: "alta", natureza: "fala" },
  { id: "ps_leilao", especialista: "pedro_sobral", tema: "estrutura", regra: "O leilão não é ganho só por quem paga mais: pesam lance, qualidade do anúncio e taxa de ação estimada. Anúncio melhor paga menos pelo mesmo resultado.", fonte: `${PS}/introducao-ao-trafego-pago/leilao-a-formula-por-tras-da-escala-do-trafego-pago`, data: "2024-07-03", confianca: "alta", natureza: "fala" },
  // orçamento
  { id: "ps_verba_inicial", especialista: "pedro_sobral", tema: "orcamento", regra: "Dá para começar pequeno, mas resultado consistente pede verba mínima diária; o número muda conforme o texto do blog.", numeros: "mínimo técnico de R$ 6 a R$ 7 por dia; recomendado de R$ 20 a R$ 50 por dia; abaixo de R$ 10 por dia há dificuldade; e-commerce idealmente R$ 2 mil por mês (números de artigos diferentes, ver docs/conhecimento/pedro-sobral.md)", fonte: `${PS}/trafego-pago-no-meta-ads/como-criar-campanhas-no-meta-ads-em-2026-o-guia-completo-para-anunciar-no-instagram-facebook-e-whatsapp`, data: "2026-03-13", confianca: "alta", natureza: "fala" },
  { id: "ps_verba_encarece", especialista: "pedro_sobral", tema: "orcamento", regra: "Mais verba aumenta a entrega e encarece cada resultado; o trabalho é equilibrar volume e custo, não maximizar só um dos dois.", fonte: `${PS}/estrategias-de-trafego-pago/insights-vazados-do-meu-curso-gratuito`, data: "2026-09-23", confianca: "alta", natureza: "fala" },
  { id: "ps_escala_por_criativo", especialista: "pedro_sobral", tema: "orcamento", regra: "Escala vem de anúncio novo que sustenta a verba maior, não de mexer no orçamento. Antes de subir verba, ter criativos novos prontos.", fonte: `${PS}/introducao-ao-trafego-pago/criativos-sao-o-novo-publico-por-que-quem-domina-criativo-domina-o-trafego`, data: "2026-06-03", confianca: "alta", natureza: "fala" },
  { id: "ps_divisao_local", especialista: "pedro_sobral", tema: "orcamento", regra: "Exemplo de divisão para negócio local com R$ 1.000 por mês: maior parte em público frio por localização, depois remarketing, visualização de vídeo e engajamento.", numeros: "40% frio por localização, 27% remarketing, 16% vídeo, 16% engajamento (hamburgueria)", fonte: `${PS}/estrategias-de-trafego-pago/como-eu-faria-trafego-para-uma-hamburgueria`, data: "2026-09-17", confianca: "alta", natureza: "fala" },
  { id: "ps_divisao_lancamento_ecommerce", especialista: "pedro_sobral", tema: "orcamento", regra: "Lançamento reserva pouco para aquecimento e lembrete e cerca de 15% para remarketing; e-commerce concentra a maior parte em campanhas de compra; ótica pôs 70% na campanha principal e o resto em teste e engajamento.", numeros: "lançamento: aquecimento 2% a 5%, lembrete 2% a 5%, remarketing perto de 15%; e-commerce e ótica: cerca de 70% na campanha principal (artigos de lançamento, e-commerce e ótica)", fonte: `${PS}/trafego-para-lancamentos/como-fazer-trafego-para-lancamento`, data: "2024-07-03", confianca: "alta", natureza: "fala" },
  // público
  { id: "ps_criativo_segmenta", especialista: "pedro_sobral", tema: "publico", regra: "O criativo é a maior das formas de segmentar: o algoritmo lê imagem, quadros do vídeo e legenda e entrega para quem se interessa pelo assunto da peça. Público aberto; restringir demais só encarece o leilão.", fonte: `${PS}/introducao-ao-trafego-pago/criativos-sao-o-novo-publico-por-que-quem-domina-criativo-domina-o-trafego`, data: "2026-06-03", confianca: "alta", natureza: "fala" },
  { id: "ps_temperaturas", especialista: "pedro_sobral", tema: "publico", regra: "Três temperaturas com janelas: quente (clientes e carrinho recente), morno (quem teve contato) e frio (sem contato). Para qualidade, encurtar a janela; para escalar, abrir.", numeros: "quente: 7 dias; morno: de 7 a 540 dias; qualidade: de 180 para 30 dias; escala: até 365 dias", fonte: `${PS}/trafego-pago-no-meta-ads/segmentacao-de-anuncios-em-2026-o-guia-completo-para-achar-o-publico-certo`, data: "2026-09-14", confianca: "alta", natureza: "fala" },
  { id: "ps_prioridade_publicos", especialista: "pedro_sobral", tema: "publico", regra: "Ordem de prioridade: quem parou numa etapa anterior ao objetivo (carrinho, finalização), envolvimento recente, visitantes e listas, semelhante menor antes do maior, e localização para negócio local. Excluir o envolvimento de 7 dias do de 30, quem já converteu em leads e comprador recente em vendas.", fonte: `${PS}/trafego-pago-no-meta-ads/como-escolher-publicos-no-meta-ads`, data: "2024-08-23", confianca: "alta", natureza: "fala" },
  { id: "ps_sequencia_engajados", especialista: "pedro_sobral", tema: "publico", regra: "Engajados recentes recebem sequência: educar, apresentar, ofertar. Semente de semelhante: quem engajou nos últimos 30 dias e também nos últimos 365.", numeros: "educar nos dias 1 a 3, apresentar nos dias 4 a 7, ofertar nos dias 8 a 14", fonte: `${PS}/estrategias-de-trafego-pago/as-melhores-segmentacoes-de-trafego-pago-para-vender-mais`, data: "2025-10-30", confianca: "alta", natureza: "fala" },
  { id: "ps_raio_local", especialista: "pedro_sobral", tema: "publico", regra: "Negócio local: só a localização basta; começar com raio curto e abrir aos poucos, testando raios em separado; WhatsApp só no horário de atendimento.", numeros: "raio de 1 a 2 km abrindo 1 km por vez; teste de 3, 5 e 8 km isolados; abrir o raio quando a frequência do vídeo chega a 1,7", fonte: `${PS}/estrategias-de-trafego-pago/como-eu-faria-trafego-para-uma-hamburgueria`, data: "2026-09-17", confianca: "alta", natureza: "fala" },
  // criativo
  { id: "ps_gcc", especialista: "pedro_sobral", tema: "criativo", regra: "Roteiro GCC: gancho (3 primeiros segundos ou a frase de destaque da imagem, em fala, texto e imagem), corpo (para quem é, o que resolve, como funciona) e CTA. O texto na tela funciona sem som.", fonte: `${PS}/estrategias-de-trafego-pago/anuncios-que-convertem-seguem-este-roteiro-e-ninguem-te-mostrou`, data: "2026-07-24", confianca: "alta", natureza: "fala" },
  { id: "ps_sete_filtros", especialista: "pedro_sobral", tema: "criativo", regra: "Sete filtros que fazem o criativo escolher o próprio público: chamar direto quem é, pelo nível de conhecimento, pela ferramenta que a pessoa usa, pela situação, pelo comportamento, pela crença e pela rotina. Combinar dois ou três filtros deixa o público mais preciso. Base: níveis de consciência de Schwartz.", fonte: `${PS}/estrategias-de-trafego-pago/anuncios-que-convertem-seguem-este-roteiro-e-ninguem-te-mostrou`, data: "2026-07-24", confianca: "alta", natureza: "fala" },
  { id: "ps_tipos_gancho", especialista: "pedro_sobral", tema: "criativo", regra: "Tipos de gancho: pergunta, sacada contraintuitiva, história e chamada do segmento.", fonte: `${PS}/introducao-ao-trafego-pago/copy-para-gestores-de-trafego-os-6-passos-para-criar-anuncios-que-convertem`, data: "2024-07-03", confianca: "alta", natureza: "fala" },
  { id: "ps_nativo_e_reciclagem", especialista: "pedro_sobral", tema: "criativo", regra: "Anúncio com linguagem e formato de conteúdo nativo da plataforma; post orgânico que performou vira anúncio; anúncio vencedor ganha outros formatos; muitos anúncios bons e imperfeitos em vez de um perfeito; estudar referências toda semana. (Nativo é formato, nunca esconder produto ou destino da revisão.)", fonte: `${PS}/introducao-ao-trafego-pago/copy-para-gestores-de-trafego-os-6-passos-para-criar-anuncios-que-convertem`, data: "2024-07-03", confianca: "alta", natureza: "fala" },
  { id: "ps_mais_angulos", especialista: "pedro_sobral", tema: "criativo", regra: "Testar menos público e mais ângulos, mensagens e tons de voz; vídeo vertical, cara de cliente real e gancho trocado com frequência contra a fadiga.", fonte: `${PS}/trafego-pago-no-meta-ads/mudancas-na-meta-o-que-muda-para-a-gestao-de-trafego`, data: "2025-06-16", confianca: "alta", natureza: "fala" },
  { id: "ps_video_e_estatico", especialista: "pedro_sobral", tema: "criativo", regra: "Vídeo e estático se completam: vídeo cria desejo e explica; estático vai bem em remarketing e oferta direta.", fonte: `${PS}/introducao-ao-trafego-pago/criativos-sao-o-novo-publico-por-que-quem-domina-criativo-domina-o-trafego`, data: "2026-06-03", confianca: "alta", natureza: "fala" },
  { id: "ps_volume_criativo", especialista: "pedro_sobral", tema: "criativo", regra: "Volume de criativo é parte do método: começar com muitas peças e repor toda semana.", numeros: "pelo menos 20 anúncios antes de um lançamento; de 2 a 3 variações novas por semana contra a fadiga; 5 textos e 5 títulos por anúncio nos formatos 1:1, 9:16 e 16:9", fonte: `${PS}/introducao-ao-trafego-pago/criativos-sao-o-novo-publico-por-que-quem-domina-criativo-domina-o-trafego`, data: "2026-06-03", confianca: "alta", natureza: "fala" },
  { id: "ps_criativo_local", especialista: "pedro_sobral", tema: "criativo", regra: "Negócio local: oferta com preço claro, foto de fundo limpo e um produto por anúncio; produto em close apetitoso, bastidor e prova social; citar a cidade.", fonte: `${PS}/estrategias-de-trafego-pago/como-fazer-anuncios-para-otica-estrategia-completa-de-trafego-pago`, data: "2026-07-06", confianca: "alta", natureza: "fala" },
  // teste
  { id: "ps_uma_variavel", especialista: "pedro_sobral", tema: "teste", regra: "Todo real investido é um teste; mudar uma variável por vez.", fonte: `${PS}/estrategias-de-trafego-pago/como-fazer-testes-no-trafego-pago-e-melhorar-seus-resultados`, data: "2025-01-29", confianca: "alta", natureza: "fala" },
  { id: "ps_ciclos", especialista: "pedro_sobral", tema: "teste", regra: "Mexer em ciclos fixos, não por ansiedade: quanto mais lenta a parte, maior o intervalo.", numeros: "lance e verba a cada 1 a 2 dias (verba maior) ou 2 a 3 (menor); anúncios a cada 2 a 3 ou 4 a 5 dias; públicos a cada 4 a 5 ou 7 dias; estrutura em ciclos de 7, 14, 21 ou 28 dias", fonte: `${PS}/estrategias-de-trafego-pago/como-escalar-o-resultado-das-suas-campanhas`, data: "2024-12-06", confianca: "alta", natureza: "fala" },
  { id: "ps_rodizio_lancamento", especialista: "pedro_sobral", tema: "teste", regra: "Em campanha curta, rodízio: pausar os piores no ciclo, manter os melhores e subir novos no lugar.", numeros: "a cada 2 dias, manter os 3 melhores e subir 3 novos; de 3 a 6 anúncios rodando ao mesmo tempo", fonte: `${PS}/trafego-para-lancamentos/como-melhorar-o-resultado-do-trafego-do-seu-lancamento`, data: "2025-02-10", confianca: "alta", natureza: "fala" },
  // métricas e corte
  { id: "ps_metrica_por_objetivo", especialista: "pedro_sobral", tema: "metricas_corte", regra: "Uma métrica principal por objetivo: vendas (ROAS ou custo por aquisição), cadastro (custo por lead), tráfego (CPC), engajamento (custo por engajamento), reconhecimento (CPM). CPM, CTR, frequência, taxa de conexão e carregamento servem para diagnóstico.", fonte: `${PS}/introducao-ao-trafego-pago/metricas-de-trafego`, data: "2025-07-01", confianca: "alta", natureza: "fala" },
  { id: "ps_faixas", especialista: "pedro_sobral", tema: "metricas_corte", regra: "Faixas de referência do mercado brasileiro segundo o blog; são guia, não regra: o histórico da própria conta vale mais.", numeros: "custo por lead de R$ 1 a R$ 12; ROAS de 3 a 5; CPC de R$ 0,50 a R$ 3; CPM de R$ 5 a R$ 15; CTR na Meta de 0,5% a 2%; taxa de conexão (clique que carrega a página) de 70% ou mais", fonte: `${PS}/estrategias-de-trafego-pago/o-que-fazer-quando-o-trafego-nao-gera-o-resultado-esperado`, data: "2026-08-04", confianca: "alta", natureza: "fala" },
  { id: "ps_diagnostico", especialista: "pedro_sobral", tema: "metricas_corte", regra: "CTR baixo aponta criativo; CTR alto sem conversão aponta oferta ou página; CPM subindo com frequência de 2 a 3 no mesmo público indica fadiga.", fonte: `${PS}/introducao-ao-trafego-pago/criativos-sao-o-novo-publico-por-que-quem-domina-criativo-domina-o-trafego`, data: "2026-06-03", confianca: "alta", natureza: "fala" },
  { id: "ps_quando_mexer", especialista: "pedro_sobral", tema: "metricas_corte", regra: "Resultado catastrófico pede ação imediata; pressão do cliente pede análise e aviso; o normal é seguir o ciclo de otimização. Só existem cinco alavancas: lance e orçamento, criativos, públicos, estrutura e destino.", numeros: "ciclo: a cada 7 dias em campanha perpétua, a cada 4 dias em campanha de cerca de 60 dias, a cada 2 ou 3 dias em campanha de até 30 dias; análise diária de 15 a 20 minutos", fonte: `${PS}/estrategias-de-trafego-pago/o-que-fazer-quando-o-trafego-nao-gera-o-resultado-esperado`, data: "2026-08-04", confianca: "alta", natureza: "fala" },
  { id: "ps_qualidade_do_lead", especialista: "pedro_sobral", tema: "metricas_corte", regra: "Não pausar público bom só porque o lead é caro: qualidade do lead acima do custo por lead; olhar custo de aquisição, valor do cliente e margem, não só ROAS.", fonte: `${PS}/trafego-para-lancamentos/como-melhorar-o-resultado-do-trafego-do-seu-lancamento`, data: "2025-02-10", confianca: "alta", natureza: "fala" },
  { id: "ps_remarketing_mais_barato", especialista: "pedro_sobral", tema: "metricas_corte", regra: "Remarketing costuma custar bem menos por compra que o público frio; não comparar os dois pela mesma régua.", numeros: "custo por compra até 3 vezes menor no remarketing (caso da hamburgueria)", fonte: `${PS}/estrategias-de-trafego-pago/como-eu-faria-trafego-para-uma-hamburgueria`, data: "2026-09-17", confianca: "alta", natureza: "fala" },
  // funil
  { id: "ps_pre_requisitos", especialista: "pedro_sobral", tema: "funil", regra: "Antes de anunciar: perfil bem cuidado, atendimento rápido, cardápio ou catálogo e área de entrega claros, recontato combinado. Tráfego não faz milagre sem entrega, proposta de valor e atendimento.", numeros: "WhatsApp respondendo em menos de 5 minutos; lead respondido em até 24 horas; pelo menos 3 recontatos", fonte: `${PS}/estrategias-de-trafego-pago/como-eu-faria-trafego-para-uma-hamburgueria`, data: "2026-09-17", confianca: "alta", natureza: "fala" },
  { id: "ps_conteudo_e_anuncio", especialista: "pedro_sobral", tema: "funil", regra: "Conteúdo e anúncio andam juntos: validar que conteúdo gera seguidor e salvamento, impulsionar o que atrai cliente qualificado, descobrir público frio, aquecer com prova e bastidor, variar formatos.", fonte: `${PS}/estrategias-de-trafego-pago/como-distribuir-conteudo-para-criar-uma-marca-que-vende`, data: "2026-02-20", confianca: "alta", natureza: "fala" },
  { id: "ps_lancamento_fases", especialista: "pedro_sobral", tema: "funil", regra: "Lançamento em fases: planejamento, captação, aquecimento, lembrete, remarketing, vendas, entrega e entressafra; públicos quente, frio e envolvimento recente sempre presentes.", numeros: "captação de 7 a 30 dias; carrinho de 2 a 7 dias; envolvimento recente de 1 a 14 dias", fonte: `${PS}/trafego-para-lancamentos/como-fazer-trafego-para-lancamento`, data: "2024-07-03", confianca: "alta", natureza: "fala" },
  { id: "ps_rastreamento", especialista: "pedro_sobral", tema: "funil", regra: "Rastreamento mínimo: API de conversões, UTM em todas as páginas e dado próprio.", fonte: `${PS}/estrategias-de-trafego-pago/tudo-que-voce-precisa-saber-em-agosto-sobre-trafego-pago-e-o-mercado-digital`, data: "2026-08-20", confianca: "alta", natureza: "fala" },
  // erros
  { id: "ps_erros_campanha", especialista: "pedro_sobral", tema: "erros", regra: "Erros de campanha: sem objetivo claro, uma plataforma só, criativo mal pensado, não otimizar, página desalinhada com o anúncio, só público frio ou só quente, verba não planejada antes de abrir o gerenciador.", fonte: `${PS}/introducao-ao-trafego-pago/os-7-erros-comuns-em-campanhas-de-trafego-pago-e-como-evita-los`, data: "2024-12-16", confianca: "alta", natureza: "fala" },
  { id: "ps_erros_gestor", especialista: "pedro_sobral", tema: "erros", regra: "Erros de gestor: não construir persona, ignorar o orgânico, volume acima de qualidade, pouco tempo em copy e criativo, sem pasta de referências, apostar tudo em automação, não medir a taxa entre as etapas do funil, nomes de campanha bagunçados, monitorar demais ou de menos. Culpar o público quando o problema é criativo ou oferta.", fonte: `${PS}/profissao-gestor-de-trafego/21-erros-que-todo-gestor-de-trafego-comete-e-como-corrigir-cada-um`, data: "2026-08-10", confianca: "alta", natureza: "fala" },
  // IA
  { id: "ps_ia_parceira", especialista: "pedro_sobral", tema: "ia_automacao", regra: "Decisões manuais estão indo para o algoritmo; o gestor decide quais sugestões aceitar e cuida de dado, criativo, oferta e rastreamento. Automação é parte do mix, não a estratégia inteira; o gerenciador segue para ajuste fino e análise.", fonte: `${PS}/estrategias-de-trafego-pago/como-subir-anuncios-com-inteligencia-artificial-e-por-que-o-gerenciador-nao-morreu`, data: "2026-08-10", confianca: "alta", natureza: "fala" },
];

// ------------------------------------------------------------------ Natália Torres (complemento)
// O que já existia (Kiwicast #154, posts de 2026, técnicas) está em
// conhecimento-ads.ts e no dossiê; aqui entra só o que o Kiwicast #334 e as
// fontes novas acrescentam. A fonte é a legenda automática do episódio:
// "alta" marca o que a agência conferiu no transcrito em 25/09/2026; o resto,
// lido só pela pesquisa, fica "media", como o número grafado de dois jeitos.
const KIWICAST_334 = "https://www.youtube.com/watch?v=MUunW9virvE";

export const PRINCIPIOS_NATALIA_TORRES: PrincipioEspecialista[] = [
  { id: "nt_experiencia_primeiro", especialista: "natalia_torres", tema: "criativo", regra: "A Meta protege primeiro a experiência de quem rola o feed e depois o lucro do anunciante. Peça que ofende, choca ou promete o impossível perde, mesmo em nicho permitido.", fonte: KIWICAST_334, data: "2024-08-16", confianca: "media", natureza: "fala" },
  { id: "nt_anuncio_convida", especialista: "natalia_torres", tema: "criativo", regra: "O anúncio não vende: para o dedo, faz um convite atraente e leva para a página, que desenvolve a oferta. Anúncio com cara de venda (compre de mim, lista de credenciais) perde. O melhor anúncio não parece anúncio.", fonte: KIWICAST_334, data: "2024-08-16", confianca: "media", natureza: "fala" },
  { id: "nt_meta_nao_e_google", especialista: "natalia_torres", tema: "criativo", regra: "Na Meta o anúncio interrompe um passatempo e precisa ganhar a atenção com relevância; no Google a pessoa já busca e o trabalho é acertar a busca.", fonte: KIWICAST_334, data: "2024-08-16", confianca: "media", natureza: "fala" },
  { id: "nt_direto_para_pagina", especialista: "natalia_torres", tema: "funil", regra: "Primeiro teste com cliente novo: tráfego direto para a página de vendas; funil longo só se o direto falhar. Serve para oferta clara em que quem vende importa pouco; mentoria e alto valor pedem mais relação antes.", fonte: KIWICAST_334, data: "2024-08-16", confianca: "alta", natureza: "fala" },
  { id: "nt_oferta_validada", especialista: "natalia_torres", tema: "funil", regra: "Oferta validada é pré-requisito do tráfego: avaliar página, copy, oferta e preço juntos. Muito anúncio que não converte é oferta que não resolve dor sentida. O atendimento do cliente faz parte do resultado: atendimento lento derruba tráfego bom.", fonte: KIWICAST_334, data: "2024-08-16", confianca: "media", natureza: "fala" },
  { id: "nt_pesquisa_publico", especialista: "natalia_torres", tema: "criativo", regra: "Pesquisa de público com fontes reais: vídeos do tema no YouTube ordenados do mais visto para o menos visto (o que o público mais clica), comentários como resenha e resenhas dos livros mais vendidos do tema na Amazon (a transformação nas palavras do público). Leva semanas por cliente.", fonte: KIWICAST_334, data: "2024-08-16", confianca: "media", natureza: "fala" },
  { id: "nt_sintoma_nao_rotulo", especialista: "natalia_torres", tema: "criativo", regra: "Mostrar um sintoma concreto do dia a dia que o público reconhece (até sem ligar à causa) em vez da imagem que toda a categoria usa; a pessoa compra o fim das consequências, não o nome do problema.", fonte: KIWICAST_334, data: "2024-08-16", confianca: "alta", natureza: "fala" },
  { id: "nt_perda_converte", especialista: "natalia_torres", tema: "criativo", regra: "Na experiência dela, falar do que a pessoa perde converte mais que falar de ganhos e qualidades. Na agência: a perda é da situação (tempo, dinheiro, retrabalho), nunca um atributo pessoal de quem lê.", fonte: KIWICAST_334, data: "2024-08-16", confianca: "alta", natureza: "fala" },
  { id: "nt_busca_de_imagem", especialista: "natalia_torres", tema: "criativo", regra: "Busca de imagem em cinco passos: estudar o público; buscar o termo óbvio anotando o que aparece; marcar o que se repete (clichê, é o que o concorrente usa) e descartar; continuar até uma imagem que faça parar; refazer a busca pelo cruzamento que funcionou (tema mais objeto inesperado). A vantagem está na busca, não no banco.", fonte: KIWICAST_334, data: "2024-08-16", confianca: "media", natureza: "fala" },
  { id: "nt_acervo", especialista: "natalia_torres", tema: "criativo", regra: "Guardar tudo que fez parar de rolar, mesmo sem uso previsto, e anotar por que prendeu; o acervo acelera a criação.", fonte: KIWICAST_334, data: "2024-08-16", confianca: "media", natureza: "fala" },
  { id: "nt_padroes_visuais", especialista: "natalia_torres", tema: "criativo", regra: "Padrões que ela diz valer para qualquer nicho: contraste alto (o anúncio disputa com cenários coloridos de influenciadores); nada de estrangeirismo (pessoas e cenários brasileiros, parecido com o feed); rosto expressivo; imperfeição do cotidiano (cabelo em pé, bebê chorando de madrugada, bagunça real), porque ninguém posta o lado feio.", fonte: KIWICAST_334, data: "2024-08-16", confianca: "alta", natureza: "fala" },
  { id: "nt_imagem_se_explica", especialista: "natalia_torres", tema: "criativo", regra: "A imagem se explica sozinha em um olhar; imagem que pede interpretação não funciona no ritmo do feed. Título e legenda reforçam, mas a imagem se sustenta sem eles.", fonte: KIWICAST_334, data: "2024-08-16", confianca: "alta", natureza: "fala" },
  { id: "nt_volume_e_8020", especialista: "natalia_torres", tema: "criativo", regra: "Criativo é o que mais pesa no resultado (80/20): operação simples, energia na criação e alto volume de peças.", numeros: "ela declara cerca de 100 criativos por dia com um designer, em vários nichos", fonte: KIWICAST_334, data: "2024-08-16", confianca: "alta", natureza: "fala" },
  { id: "nt_verba_minima", especialista: "natalia_torres", tema: "orcamento", regra: "Abaixo de um valor diário mínimo não há impressão suficiente para ler métrica; com pouco dinheiro, rodar menos dias em vez de baixar o valor por dia.", numeros: "mínimo de R$ 40 por dia na Meta (legenda automática grafou o valor de dois jeitos)", fonte: KIWICAST_334, data: "2024-08-16", confianca: "media", natureza: "fala" },
];

export const PRINCIPIOS_ESPECIALISTAS: readonly PrincipioEspecialista[] = [...PRINCIPIOS_PEDRO_SOBRAL, ...PRINCIPIOS_NATALIA_TORRES];

/** Princípios filtrados por tema e, opcionalmente, por especialista. */
export function principiosDos(filtro: { tema?: TemaEspecialista | TemaEspecialista[]; especialista?: Especialista } = {}): PrincipioEspecialista[] {
  const temas = filtro.tema === undefined ? null : Array.isArray(filtro.tema) ? filtro.tema : [filtro.tema];
  return PRINCIPIOS_ESPECIALISTAS.filter((p) => (!temas || temas.includes(p.tema)) && (!filtro.especialista || p.especialista === filtro.especialista));
}

/** Texto de uma lista de princípios para o prompt: nome, regra e números, sem URL (a fonte fica no código e no .md). */
export function textoDosPrincipios(lista: readonly PrincipioEspecialista[], titulo?: string): string {
  const linhas = lista.map((p) => `- [${p.especialista === "pedro_sobral" ? "Sobral" : "Natália"}] ${p.regra}${p.numeros ? ` Números da fonte: ${p.numeros}.` : ""}`);
  return titulo ? [titulo, ...linhas].join("\n") : linhas.join("\n");
}

// ------------------------------------------------------------------ blocos prontos para os prompts

export const ESTRUTURA_DE_CONTA = `ESTRUTURA DE CONTA (Pedro Sobral, conciliado com a leitura de conta da Mesa Ads)
- Campanha define o objetivo, conjunto define o público, anúncio carrega o criativo. Evento de otimização no lugar onde a conversão acontece (WhatsApp, Direct, formulário ou site com pixel e API de conversões).
- Orçamento na campanha (Advantage+ de campanha). Posicionamento automático.
- Por verba mensal do cliente (faixas da agência a partir dos exemplos publicados):
  - até cerca de R$ 500: uma campanha forte só, no objetivo que decide (em geral mensagens ou vendas), público aberto ou raio local, de 3 a 5 anúncios diferentes;
  - de R$ 500 a R$ 3.000: campanha principal com a maior parte da verba (perto de 70%), remarketing de público quente com verba constante e uma parte pequena para testar público frio ou criativo;
  - acima disso: campanhas separadas para frio e quente, de 4 a 8 conjuntos por campanha (teto de 12), e uma campanha automática ao lado das manuais.
- Público quente nunca disputa verba com o frio; público geográfico fica isolado.
- Negócio local começando do zero: campanha de seguidores com Reels para criar audiência e campanha de mensagens para o público quente.
- Onde a base da Mesa Ads diz "poucos conjuntos com verba suficiente", vale para conta pequena; a separação por temperatura do Sobral vale quando a verba sustenta cada conjunto (cerca de 50 eventos por semana por conjunto para sair do aprendizado).`;

export const ORCAMENTO_INICIAL = `ORÇAMENTO INICIAL (referências dos especialistas; a verba real vem do briefing)
- Pedro Sobral: mínimo técnico de R$ 6 a R$ 7 por dia; para ter resultado, de R$ 20 a R$ 50 por dia; abaixo de R$ 10 por dia há dificuldade. E-commerce idealmente a partir de R$ 2 mil por mês.
- Natália Torres: mínimo de R$ 40 por dia para ler métrica; com pouco dinheiro, rodar menos dias em vez de baixar o valor diário.
- Leitura da agência: abaixo de R$ 20 por dia, concentrar tudo em uma campanha e um objetivo e avisar que a leitura será lenta (inconclusiva por mais tempo).
- Mais verba encarece cada resultado; subir verba sem criativo novo pronto costuma piorar o custo (Sobral: a escala vem de anúncio novo que sustenta a verba).
- Divisões de referência: negócio local com R$ 1.000 por mês, 40% frio por localização, 27% remarketing, 16% visualização de vídeo, 16% engajamento (caso de hamburgueria); lançamento, 2% a 5% aquecimento, 2% a 5% lembrete, perto de 15% remarketing e o resto em captação e vendas; e-commerce, cerca de 70% em campanhas de compra.`;

export const PLANO_DE_TESTE = `PLANO DE TESTE (Sobral e Natália, dentro da ROTINA_DE_TESTE da Mesa Ads)
1. Antes de subir: oferta validada ou ao menos clara (Natália), atendimento pronto (WhatsApp respondendo em minutos, lead em até 24 h, pelo menos 3 recontatos; Sobral), rastreamento ligado (API de conversões e UTM).
2. Primeiro teste com cliente novo: o caminho mais curto até a conversão (direto para página ou para mensagem). Funil longo só se o curto falhar (Natália).
3. Volume inicial: de 3 a 5 ângulos realmente diferentes por conjunto, variando situação, filtro de público no criativo e estilo visual (Sobral testa mais ângulos e menos públicos). Cada anúncio com texto e título em variações e nos formatos 4:5 ou 1:1 e 9:16.
4. Mexer em ciclos, não por ansiedade (Sobral): anúncios a cada 2 a 5 dias, públicos a cada 4 a 7, estrutura em ciclos de 7 dias ou mais. Uma variável por vez.
5. Rodízio: no ciclo, pausar os piores, manter os melhores e subir novos no lugar (em campanha curta, manter 3 e subir 3). Ter sempre de 2 a 3 variações novas por semana para repor.
6. Volume mínimo antes de julgar (base da Mesa Ads): cerca de 1.000 impressões e 3 a 4 dias por anúncio; abaixo disso, inconclusivo.
7. Registrar o aprendizado com a frase padrão da ROTINA_DE_TESTE.`;

export const REGRAS_DE_CORTE_E_ESCALA = `CORTE E ESCALA (referência para o texto; a decisão numérica é do código com a régua do cliente)
Métrica que decide, por objetivo (Sobral): vendas, ROAS ou custo por aquisição; cadastro, custo por lead (e a taxa de lead que vira venda); mensagens, custo por conversa que vira orçamento; tráfego, CPC e visualização da página; reconhecimento, CPM e alcance. CTR, CPM, frequência e taxa de conexão são diagnóstico, não decisão.
Faixas de mercado brasileiro publicadas pelo Sobral (04/08/2026), para situar e nunca para prometer: custo por lead de R$ 1 a R$ 12; ROAS de 3 a 5; CPC de R$ 0,50 a R$ 3; CPM de R$ 5 a R$ 15; CTR na Meta de 0,5% a 2%; taxa de conexão de 70% ou mais. O histórico da própria conta vale mais que a faixa.
Diagnóstico: CTR baixo, criativo; CTR bom sem conversão, oferta ou página; taxa de conexão baixa, página lenta ou clique acidental; CPM subindo com frequência de 2 a 3 no mesmo público, fadiga.
Quando mexer: resultado catastrófico, agir já; pressão do cliente, analisar e avisar; fora disso, seguir o ciclo (a cada 7 dias em campanha contínua, 4 dias em campanha de cerca de 60 dias, 2 a 3 dias em campanha de até 30 dias). Só há cinco alavancas: lance e orçamento, criativos, públicos, estrutura, destino.
Cortar: anúncio que gastou de 2 a 3 vezes o custo tolerável sem resultado, ou com custo acima do tolerável e volume suficiente (base da Mesa Ads). Não cortar público bom só porque o lead é caro se o lead vira venda (Sobral).
Escalar: primeiro criativo novo que sustente a verba (Sobral), depois verba. Aumento gradual (referência de mercado de cerca de 20% a cada 2 ou 3 dias, da base da Mesa Ads; o Sobral não dá percentual). Remarketing costuma custar bem menos por compra que o frio (até 3 vezes no caso publicado): não comparar os dois pela mesma régua.
Olhar o negócio: custo de aquisição, valor do cliente e margem, não só ROAS.`;

/** Objetivos da Mesa Ads (mesmos ids de OBJETIVOS_DE_CAMPANHA em conhecimento-ads.ts). */
export type ObjetivoAds = "vendas" | "mensagens" | "leads" | "seguidores" | "agendamento" | "trafego" | "reconhecimento";

/** Checklist de criativo por objetivo (junta Sobral, Natália e a base). */
export const CHECKLIST_CRIATIVO_POR_OBJETIVO: Record<ObjetivoAds, string> = {
  vendas: `CHECKLIST DE CRIATIVO: VENDAS
- Público frio: a peça convida para a página, não vende sozinha (Natália); situação ou sintoma concreto na imagem, que se explica em um olhar.
- Remarketing e quente: estático com oferta direta, preço ou condição real, garantia e objeção respondida (Sobral: estático vai bem em oferta direta).
- Um produto por anúncio, fundo limpo, contraste alto.
- Roteiro GCC no vídeo: gancho em 3 segundos (fala, texto e imagem), corpo com para quem, o que resolve e como funciona, CTA de compra.
- Coerência com a página: a promessa do anúncio aparece no topo da página.`,
  mensagens: `CHECKLIST DE CRIATIVO: MENSAGENS (WhatsApp, Direct)
- Diz o que a pessoa recebe ao chamar (orçamento, horário, preço, catálogo) e para quem é; qualifica na arte (região, tipo de serviço).
- Negócio local: cita a cidade ou o bairro, oferta com preço claro se houver, produto em close ou bastidor real (Sobral).
- Estático e vídeo curto; gancho pela situação ou pela pergunta do comprador.
- CTA de conversa com o canal ("Chame no WhatsApp") e primeira mensagem pronta que continua a promessa.
- Atendimento pronto antes de subir (resposta em minutos).`,
  leads: `CHECKLIST DE CRIATIVO: CADASTROS
- Troca clara: o que a pessoa ganha ao deixar o contato e para quem é.
- Filtro no próprio criativo (Sobral): chamar quem é, pela situação, pela ferramenta que usa ou pela rotina; isso qualifica antes do formulário.
- Perda concreta da situação converte mais que lista de benefícios (Natália), sem atributo pessoal.
- Lead barato não é lead bom: formulário com pergunta de qualificação quando o volume vem ruim.`,
  seguidores: `CHECKLIST DE CRIATIVO: SEGUIDORES
- Reels com cara de conteúdo nativo para público de baixa consciência (Sobral); reciclar o post orgânico que mais gerou seguidor e salvamento.
- Promessa do que a pessoa recebe ao seguir (série, dica, bastidor) e identidade forte.
- Gancho nos 3 primeiros segundos com texto na tela que funciona sem som.`,
  agendamento: `CHECKLIST DE CRIATIVO: AGENDAMENTO
- Mostra a facilidade real de marcar e o que acontece na primeira visita; reduz o risco percebido com o que for verdade (avaliação, orçamento sem compromisso).
- Rosto real e expressivo do profissional ou da equipe, autorizado (Natália: rosto expressivo atrai clique).
- Região atendida e horário real; nada de escassez inventada.`,
  trafego: `CHECKLIST DE CRIATIVO: TRÁFEGO
- A curiosidade tem entrega na página, logo no topo.
- Imagem que se explica sozinha; nada de clique acidental (otimizar por visualização da página, não por clique).
- Conferir taxa de conexão (clique que carrega a página): referência de 70% ou mais (Sobral).`,
  reconhecimento: `CHECKLIST DE CRIATIVO: RECONHECIMENTO
- Marca e ideia memoráveis em 1 segundo; a imagem mais característica do negócio.
- Contraste alto e nada de estrangeirismo: cenário e pessoas brasileiras, parecido com o feed (Natália).
- Frequência controlada; efeito medido depois em busca pela marca, visitas ao perfil e mensagens.`,
};

export const GANCHOS_DOS_ESPECIALISTAS = `GANCHOS E FILTROS DOS ESPECIALISTAS (somam aos TIPOS_DE_GANCHO da base)
Sete filtros que fazem o criativo escolher o próprio público (Sobral, com base nos níveis de consciência): 1) chamar direto quem é ("dono de oficina"); 2) pelo nível de conhecimento (quem já tentou X); 3) pela ferramenta que a pessoa usa (planilha, caderno, app); 4) pela situação (o orçamento que sumiu); 5) pelo comportamento (quem pede delivery toda sexta); 6) pela crença (quem acha que grama bonita é regar todo dia); 7) pela rotina (quem só tem o horário do almoço). Combinar dois ou três filtros deixa o público mais preciso. Nunca filtrar por atributo pessoal sensível. (Os exemplos entre parênteses são da agência.)
Tipos de gancho do Sobral: pergunta, sacada contraintuitiva, história, chamada do segmento. Gancho em três camadas: fala, texto na tela e imagem.
Ganchos visuais da Natália: sintoma concreto do dia a dia no lugar do clichê da categoria; imperfeição real do cotidiano; rosto expressivo; objeto comum que explica a ideia em um olhar; contraste alto.`;

export const CRIATIVO_NATALIA = `CRIATIVO NO MÉTODO DA NATÁLIA TORRES (complemento; as dezoito técnicas da base continuam valendo)
- O anúncio convida, a página vende: parar o dedo, fazer um convite atraente, levar ao destino. Nada de "compre de mim" nem lista de credenciais no frio.
- A imagem se explica sozinha em um olhar. Se precisa de legenda para fazer sentido, não serve para o feed.
- Busca de imagem: termo óbvio, anotar e descartar os clichês, continuar até algo que faça parar, refazer a busca pelo cruzamento que funcionou (tema mais objeto inesperado). No painel, a peça final usa foto real do cliente ou imagem original; banco serve para estudar a ideia.
- Sintoma em vez de rótulo: mostrar a consequência concreta que o público reconhece, não o nome do problema. Perda da situação converte mais que lista de ganhos.
- Padrões: contraste alto, pessoas e cenários brasileiros, rosto expressivo, imperfeição do cotidiano. Imperfeição nunca é do corpo ou da pele de quem lê.
- Pesquisa com fontes reais: vídeos mais vistos do tema, comentários, resenhas dos livros mais vendidos do assunto.
- Acervo: guardar o que fez parar e anotar por quê.
- Fora do método da agência, mesmo aparecendo nas fontes dela: duplo sentido para passar pela revisão, palavras camufladas, contingência de contas.`;

export const ERROS_COMUNS_TRAFEGO = `ERROS COMUNS DE TRÁFEGO (para diagnosticar conta e orientar o cliente)
- Sem objetivo claro ou com objetivo errado para a métrica que decide (Sobral).
- Culpar o público quando o problema é criativo ou oferta; restringir demais o público e encarecer o leilão (Sobral).
- Pouco tempo em copy e criativo; um anúncio perfeito em vez de muitos bons; sem pasta de referências (Sobral e Natália).
- Página ou atendimento desalinhados com o anúncio; WhatsApp lento; sem recontato (Sobral e Natália).
- Só público frio ou só quente; quente disputando verba com o frio (Sobral).
- Mexer todo dia por ansiedade, ou esquecer a conta; nomes de campanha bagunçados (Sobral).
- Subir verba sem criativo novo pronto (Sobral).
- Anunciar oferta não validada ou que não resolve dor sentida (Natália).
- Apostar tudo em automação ou resistir a ela; o gestor decide o que aceitar da ferramenta (Sobral).
- Julgar com pouco volume (base da Mesa Ads) ou com verba diária baixa demais para ler métrica (Natália).`;

/** Bloco completo para o estrategista da Mesa Ads (vai depois de CONHECIMENTO_ESTRATEGISTA_ADS). */
export const ESPECIALISTAS_ADS_PARA_ESTRATEGISTA = [
  `MÉTODO DOS ESPECIALISTAS (versão ${VERSAO_ESPECIALISTAS_ADS}). Pedro Sobral (tráfego) e Natália Torres (criativo), a partir de conteúdo público. Complementam a base acima; se algo divergir, vale a base e a régua do cliente. Ao citar um especialista, só o que está marcado com o nome dele.`,
  GANCHOS_DOS_ESPECIALISTAS,
  CRIATIVO_NATALIA,
  ESTRUTURA_DE_CONTA,
  PLANO_DE_TESTE,
  REGRAS_DE_CORTE_E_ESCALA,
].join("\n\n");
