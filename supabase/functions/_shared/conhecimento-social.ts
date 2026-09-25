/**
 * Conhecimento de social media do estrategista do Mês (Frente O, 26/09/2026).
 *
 * Pedido do dono (26/09): "ter uma inteligência muito grande atrás do Mês:
 * além do prompt, buscar, pesquisar, fazer toda uma base e repositórios de
 * conteúdos virais, técnicas de social media, técnicas de calendário editorial,
 * com base no que converte mais e no que viraliza."
 *
 * Pesquisa completa, com fontes e datas: docs/conhecimento/conteudo-viral.md.
 * Aqui fica só a destilação acionável, em blocos inteiros, que o registro de
 * conhecimento-dos-agentes.ts corta por teto (momentos "temas", "mes" e
 * "diagnostico" do calendário). Não repete o que já existe:
 * - tipos de conteúdo, frameworks, regra do carrossel e do estático:
 *   conhecimento-conteudo.ts (BASE_DO_ESTRATEGISTA);
 * - processo do calendário, fórmulas de título, CTA, voz e anti-genérico:
 *   conhecimento-marketing.ts.
 * Os blocos daqui complementam aqueles com o que a pesquisa de 2025 e 2026
 * trouxe de novo: os sinais que o Instagram mede, ganchos de capa por tipo,
 * carrossel de retenção, checklist de salvar e enviar, mistura do mês por
 * objetivo, alcance contra conversão e as datas do Brasil calculadas no código.
 *
 * Regras da casa: formato do calendário é só carrossel ou post estático (o
 * que a pesquisa diz de Reels fica no .md, não vira instrução); número de
 * mercado é referência, nunca promessa ao cliente; sem travessão.
 * Puro: sem Deno, sem rede e sem banco (o Vitest importa direto).
 */

export const VERSAO_CONHECIMENTO_SOCIAL = "2026-09-26.1";

// ------------------------------------------------------------------ sinais

export const SINAIS_DO_ALGORITMO = `O QUE O INSTAGRAM MEDE (2025 e 2026, declarado pelo chefe do Instagram e confirmado por estudos de mercado)
- Três sinais pesam mais: tempo que a pessoa passa na peça (no carrossel, deslizar até o fim), envios por alcance (mandar no Direct) e curtidas por alcance. Salvamento pesa acima de curtida porque mostra valor duradouro.
- Para quem já segue, curtida pesa um pouco mais; para chegar em quem não segue (descoberta), envio pesa mais. Post feito para descoberta precisa ser "mandável": a pessoa pensa em alguém ao ver.
- Carrossel ganha uma segunda chance: quem viu e não deslizou pode receber o mesmo post de novo, já na segunda lâmina. A lâmina 2 é um segundo gancho, nunca uma lâmina de transição.
- Originalidade: conta que só reposta conteúdo alheio perde a recomendação para quem não segue. Tudo do calendário é autoral, com foto, dado ou bastidor do próprio cliente sempre que houver.
- Hashtag ajuda a busca, não o alcance, e o limite é de 5 por post: de 3 a 5 específicas (nicho, região, assunto), nunca genéricas.
- Legenda e texto da capa viram busca (dentro do Instagram e, desde julho de 2025, no Google para contas profissionais): a palavra que o público digita entra na primeira linha da legenda e na capa, escrita como gente fala.
- Grade do perfil em retrato 3:4: o texto importante da capa fica no centro, longe das bordas de cima e de baixo.
- Constância pesa: de 3 a 5 posts por semana no feed cresce seguidores bem mais que 1 ou 2 (estudo com 2 milhões de posts); mais que isso só se a qualidade se mantiver.`;

// ------------------------------------------------------------------ ganchos

export const GANCHOS_POR_TIPO = `GANCHOS DE CAPA POR TIPO DE CONTEÚDO (capa do carrossel ou título do estático: até 8 palavras, lido em 2 segundos; reescrever para o cliente, nunca copiar o molde)
- Educativo: promessa com número real e prazo curto ("3 sinais de que [problema] já começou"); erro comum ("O erro que faz [resultado ruim]"); pergunta que o cliente faz no balcão.
- Conscientização: custo escondido ("Quanto [hábito comum] custa por mês"); cena reconhecível ("Você também [situação do dia a dia]?"); contraste do que parece e do que é.
- Prova social: resultado na capa com número e prazo reais ("De [antes] para [depois] em [prazo]"); fala do cliente entre aspas, transcrita como está.
- Venda e oferta: benefício e condição na mesma linha ("[Benefício] com [condição real] até [data]"); pergunta de decisão ("Ainda em dúvida entre [A] e [B]?").
- Engajamento: escolha binária ("[A] ou [B]: qual você escolhe?"); complete a frase; opinião do nicho que divide sem ofender.
- Série: nome fixo e número da parte na capa ("[Nome da série] #3"), sempre no mesmo lugar e na mesma cor.
- Aviso: a informação primeiro ("Novo horário a partir de [data]"), sem suspense.
- Tutorial: o resultado final na capa ("Como deixar [resultado] em [n] passos").
Regras que valem para todos:
- Um gancho por post e tipos diferentes em posts seguidos (a base do estrategista já pede).
- Gancho com tensão aberta: a capa promete, a lâmina 2 começa a pagar e a última fecha. Promessa que o post não cumpre queima a conta.
- Número só real (do cliente, do mercado com fonte ou da própria lista do post).
- Nada de "Você sabia?", "Confira", "Dica do dia" ou nome da marca na capa: não param a rolagem.`;

export const CARROSSEL_DE_RETENCAO = `CARROSSEL DE ALTA RETENÇÃO (o sinal do carrossel é deslizar até o fim)
Estruturas que seguram (escolher uma pela ideia do post):
1. Lista com promessa numerada: capa com o número, um item por lâmina com o porquê, lâmina de resumo "para salvar", CTA.
2. Problema e virada: capa com a dor, lâmina 2 com o custo dela, lâminas de causa e de saída, virada com a solução, CTA.
3. Passo a passo: capa com o resultado final, um passo por lâmina com o erro que evita, o resultado de novo, CTA.
4. Antes, durante e depois: capa com o depois, o antes, o que foi feito em 2 ou 3 lâminas, o depois com número, CTA.
5. Mito ou verdade: capa com a crença, um veredito por lâmina com a explicação curta, o que fazer então, CTA.
6. Guia de referência: capa com "guarde este post", conteúdo denso e organizado (tabela, checklist, comparação), CTA de salvar.
Regras de lâmina:
- Lâmina 2 é o segundo gancho (o Instagram pode mostrar o post de novo já nela): ela sozinha tem de dar vontade de voltar para a capa.
- Uma ideia por lâmina, frase que termina puxando a próxima ("e é aqui que quase todo mundo erra").
- De 6 a 10 lâminas funcionam melhor que 3; só passar de 10 quando o conteúdo é de referência.
- Texto grande e contraste alto; sem lâmina só de enfeite; progresso visível (1/7, 2/7) quando for lista ou passo a passo.
- Penúltima lâmina entrega o resumo ou o ponto mais forte; a última fecha com UM CTA e o motivo para fazê-lo.`;

export const CHECKLIST_SALVA_E_ENVIA = `CHECKLIST ANTES DE FECHAR UM POST (salvar e enviar são os sinais que mais levam longe)
- Serve para alguém específico? Se a pessoa não pensa "isso é a cara do fulano", não será enviado.
- Resolve algo que se consulta depois (lista, passo a passo, comparação, preço, checklist)? Então pede salvar.
- Tem dado, exemplo ou foto do próprio cliente? Conteúdo que qualquer concorrente postaria igual não salva nem envia.
- A capa se entende sem a legenda e sem o nome da marca?
- A lâmina 2 prende sozinha?
- O CTA combina com o objetivo: salvar (referência), enviar para alguém (identificação), comentar uma palavra (conversa e lista de interessados), chamar no Direct ou no WhatsApp (venda)?
- Primeira linha da legenda com a palavra que o público busca; de 3 a 5 hashtags específicas.
- Nada de promessa sem prova, urgência falsa ou "melhor do mercado" sem fonte.`;

// ------------------------------------------------------------------ mistura do mês

export const MISTURA_DO_MES = `MISTURA DO MÊS POR OBJETIVO (topo atrai quem não conhece; meio constrói confiança; fundo converte)
Ponto de partida (ajustar pelos números do perfil e pelo plano combinado com a equipe):
- Crescer e ser descoberto: topo 50%, meio 30%, fundo 20%.
- Autoridade e confiança: topo 30%, meio 50%, fundo 20%.
- Vender no mês (oferta, data comercial, lançamento): topo 25%, meio 35%, fundo 40%, com o fundo concentrado nas duas semanas antes da data.
- Perfil pequeno (poucas centenas de seguidores): mais topo, porque o fundo não tem para quem vender.
Regras:
- Toda semana tem pelo menos um post feito para ser enviado e um feito para ser salvo.
- Fundo nunca fica sozinho: antes de uma oferta vem prova e quebra de objeção na mesma semana ou na anterior.
- Séries recorrentes dão constância e reconhecimento: de 1 a 3 séries fixas no mês (mesmo nome, mesmo dia da semana, mesma cara), cada uma ligada a um pilar.
- Cerca de 20% dos espaços ficam para assunto do momento e oportunidade que aparecer.
- Reciclar o que funcionou: o post que mais salvou ou enviou nos últimos 90 dias volta em ângulo novo (outro gancho, outro formato ou atualizado), nunca repetido igual.
- Frequência: manter a combinada com o cliente; abaixo de 3 por semana, avisar na recomendação que o crescimento fica mais lento.`;

// ------------------------------------------------------------------ alcance e conversão

export const ALCANCE_E_CONVERSAO = `ALCANCE CONTRA CONVERSÃO (o que viraliza raramente é o que vende; o mês precisa dos dois)
- Post de alcance (identificação, curiosidade, lista mandável) traz gente nova e sobe envios e visitas ao perfil; quase nunca fecha venda sozinho.
- Post que converte tem prova (resultado, depoimento, bastidor real), oferta clara (o que, para quem, quanto ou como, até quando) e UM caminho curto.
- O caminho mais curto no Brasil é a conversa: chamar no Direct ou no WhatsApp. Pedido de comentar uma palavra para receber algo no Direct costuma converter bem acima do link na bio, desde que a entrega seja rápida e útil.
- Venda vem em sequência: alcance, depois prova e objeção, depois oferta com prazo real. Oferta solta, sem aquecimento, desperdiça o post.
- Perfil que recebe gente nova precisa converter a visita: bio com a promessa e o CTA, destaques com prova e preço ou "como funciona".
- Medir cada tipo pelo seu sinal: alcance e envios no topo; salvamentos e comentários no meio; conversas iniciadas, cliques e vendas no fundo. Julgar oferta por curtida é erro.`;

export const SINAIS_PARA_MEDIR = `SINAIS PARA MEDIR E LER O PERFIL (os números vêm do painel; o texto só interpreta)
- Envios por alcance (compartilhamentos divididos pelo alcance): sinal de descoberta. Acima da média do perfil, repetir o gancho e o assunto.
- Salvamentos por alcance: sinal de referência. Acima da média, virar série ou guia.
- Comentários por curtida alto: o assunto puxa conversa; repetir com pergunta e responder rápido.
- Alcance acima da média com envio baixo: gancho bom e miolo fraco (a capa prometeu mais que o post entregou).
- Alcance baixo com salvamento alto: bom conteúdo com capa fraca; reescrever a capa e repostar em outro formato.
- Formato: comparar a média de alcance e de salvamento por formato só com pelo menos 2 posts de cada.
- Tendência semanal: seguidores e alcance das últimas semanas dizem se o perfil está crescendo, parado ou caindo; não tirar conclusão de uma semana só.
- Poucos posts medidos (menos de 5): dizer que a leitura é fraca e tratar como hipótese.`;

export const DATAS_E_OPORTUNIDADES = `DATAS E OPORTUNIDADES DO MÊS
- Datas comerciais e comemorativas só entram quando se ligam ao cliente (oferta, público, nicho ou região); data sem ligação é ruído.
- Data grande (Dia das Mães, Dia dos Pais, Black Friday, Natal) pede aquecimento de 2 a 3 semanas: conscientização e prova antes, oferta perto da data.
- Data em fim de semana: publicar na sexta anterior (o calendário só tem segunda a sexta).
- Mês de campanha de saúde (Setembro Amarelo, Outubro Rosa, Novembro Azul) só com tom sério e informação correta; nunca como gancho de venda.
- Datas de profissão (Dia do Advogado, do Dentista, do Médico...) servem ao cliente da profissão e a quem vende para ela.
- Tendência e assunto do momento entram pela pesquisa, com fonte, e só se o cliente tiver algo próprio a dizer sobre ela.`;

// ------------------------------------------------------------------ datas do Brasil (calculadas)

export type DataSazonal = {
  /** AAAA-MM-DD */
  data: string;
  nome: string;
  tipo: "comercial" | "feriado" | "comemorativa" | "profissao" | "campanha_do_mes";
  /** Dica curta de uso (sem travessão). */
  dica?: string;
};

type Fixa = { md: string; nome: string; tipo: DataSazonal["tipo"]; dica?: string };

/** Datas fixas usadas no marketing brasileiro (mês-dia). Lista curada; o modelo escolhe o que serve ao cliente. */
export const DATAS_FIXAS_BR: readonly Fixa[] = [
  { md: "01-01", nome: "Ano Novo", tipo: "feriado" },
  { md: "01-20", nome: "Dia do Farmacêutico", tipo: "profissao" },
  { md: "03-08", nome: "Dia Internacional da Mulher", tipo: "comemorativa", dica: "homenagem com conteúdo útil, não só flor e desconto" },
  { md: "03-15", nome: "Dia do Consumidor", tipo: "comercial", dica: "semana de ofertas; boa para condição especial real" },
  { md: "04-07", nome: "Dia Mundial da Saúde", tipo: "comemorativa" },
  { md: "04-19", nome: "Dia dos Povos Indígenas", tipo: "comemorativa" },
  { md: "04-21", nome: "Tiradentes", tipo: "feriado" },
  { md: "04-22", nome: "Dia da Terra", tipo: "comemorativa" },
  { md: "05-01", nome: "Dia do Trabalhador", tipo: "feriado" },
  { md: "05-12", nome: "Dia do Enfermeiro", tipo: "profissao" },
  { md: "05-24", nome: "Dia Nacional do Café", tipo: "comemorativa" },
  { md: "05-28", nome: "Dia do Hambúrguer", tipo: "comemorativa" },
  { md: "06-05", nome: "Dia Mundial do Meio Ambiente", tipo: "comemorativa" },
  { md: "06-12", nome: "Dia dos Namorados", tipo: "comercial", dica: "presente e experiência a dois; aquecer 2 semanas antes" },
  { md: "06-24", nome: "São João (festas juninas)", tipo: "comemorativa", dica: "forte no Nordeste; junho inteiro tem clima de arraial" },
  { md: "07-07", nome: "Dia do Chocolate", tipo: "comemorativa" },
  { md: "07-10", nome: "Dia da Pizza", tipo: "comemorativa" },
  { md: "07-13", nome: "Dia do Rock", tipo: "comemorativa" },
  { md: "07-15", nome: "Dia do Homem", tipo: "comemorativa" },
  { md: "07-20", nome: "Dia do Amigo", tipo: "comemorativa", dica: "ótimo para post de enviar para alguém" },
  { md: "07-26", nome: "Dia dos Avós", tipo: "comemorativa" },
  { md: "08-11", nome: "Dia do Advogado e Dia do Estudante", tipo: "profissao" },
  { md: "08-22", nome: "Dia do Folclore", tipo: "comemorativa" },
  { md: "08-26", nome: "Dia do Cachorro", tipo: "comemorativa" },
  { md: "08-27", nome: "Dia do Psicólogo e Dia do Corretor de Imóveis", tipo: "profissao" },
  { md: "08-31", nome: "Dia do Nutricionista", tipo: "profissao" },
  { md: "09-07", nome: "Independência do Brasil", tipo: "feriado" },
  { md: "09-09", nome: "Dia do Veterinário", tipo: "profissao" },
  { md: "09-15", nome: "Dia do Cliente", tipo: "comercial", dica: "agradecer e oferecer condição a quem já é cliente" },
  { md: "09-21", nome: "Dia da Árvore", tipo: "comemorativa" },
  { md: "09-22", nome: "Dia do Contador", tipo: "profissao" },
  { md: "10-01", nome: "Dia Internacional do Café e Dia do Idoso", tipo: "comemorativa" },
  { md: "10-04", nome: "Dia dos Animais", tipo: "comemorativa" },
  { md: "10-12", nome: "Dia das Crianças e Nossa Senhora Aparecida", tipo: "comercial", dica: "feriado nacional; presente e família" },
  { md: "10-13", nome: "Dia do Fisioterapeuta", tipo: "profissao" },
  { md: "10-15", nome: "Dia do Professor", tipo: "profissao" },
  { md: "10-18", nome: "Dia do Médico", tipo: "profissao" },
  { md: "10-25", nome: "Dia do Dentista", tipo: "profissao" },
  { md: "10-28", nome: "Dia do Servidor Público", tipo: "profissao" },
  { md: "10-31", nome: "Halloween e Dia do Saci", tipo: "comemorativa" },
  { md: "11-02", nome: "Finados", tipo: "feriado" },
  { md: "11-15", nome: "Proclamação da República", tipo: "feriado" },
  { md: "11-20", nome: "Dia da Consciência Negra", tipo: "feriado" },
  { md: "11-30", nome: "Prazo da primeira parcela do 13º salário", tipo: "comercial", dica: "dinheiro extra no bolso do cliente" },
  { md: "12-11", nome: "Dia do Engenheiro", tipo: "profissao" },
  { md: "12-15", nome: "Dia do Arquiteto e Urbanista", tipo: "profissao" },
  { md: "12-20", nome: "Prazo da segunda parcela do 13º salário", tipo: "comercial" },
  { md: "12-25", nome: "Natal", tipo: "comercial", dica: "a maior data do varejo junto com a Black Friday; aquecer desde o fim de novembro" },
  { md: "12-31", nome: "Véspera de Ano Novo", tipo: "comemorativa" },
];

/** Campanhas de conscientização de cada mês (entram no dia 1 do mês). */
export const CAMPANHAS_DO_MES_BR: Record<string, string> = {
  "01": "Janeiro Branco (saúde mental)",
  "04": "Abril Azul (conscientização sobre o autismo)",
  "05": "Maio Amarelo (segurança no trânsito)",
  "06": "Junho Vermelho (doação de sangue)",
  "08": "Agosto Dourado (amamentação)",
  "09": "Setembro Amarelo (prevenção do suicídio)",
  "10": "Outubro Rosa (câncer de mama)",
  "11": "Novembro Azul (saúde do homem)",
  "12": "Dezembro Vermelho (prevenção ao HIV)",
};

const iso = (d: Date) => d.toISOString().slice(0, 10);
const utc = (a: number, m: number, d: number) => new Date(Date.UTC(a, m - 1, d, 12));
const mais = (d: Date, dias: number) => new Date(d.getTime() + dias * 86_400_000);

/** Domingo de Páscoa (algoritmo gregoriano anônimo). */
export function pascoa(ano: number): string {
  const a = ano % 19, b = Math.floor(ano / 100), c = ano % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31), dia = ((h + l - 7 * m + 114) % 31) + 1;
  return iso(utc(ano, mes, dia));
}

/** N-ésimo dia da semana (0 domingo) de um mês. */
function enesimo(ano: number, mes: number, diaDaSemana: number, n: number): Date {
  const primeiro = utc(ano, mes, 1);
  const desloc = (diaDaSemana - primeiro.getUTCDay() + 7) % 7;
  return mais(primeiro, desloc + (n - 1) * 7);
}

/** Datas móveis de um ano: Carnaval, Páscoa, Corpus Christi, Mães, Pais, Black Friday. */
export function datasMoveis(ano: number): DataSazonal[] {
  const p = new Date(`${pascoa(ano)}T12:00:00Z`);
  const quintaNov = enesimo(ano, 11, 4, 4);
  return [
    { data: iso(mais(p, -48)), nome: "Segunda de Carnaval", tipo: "feriado" },
    { data: iso(mais(p, -47)), nome: "Carnaval", tipo: "feriado", dica: "semana de viagem e festa; pouca atenção a conteúdo denso" },
    { data: iso(mais(p, -2)), nome: "Sexta-feira Santa", tipo: "feriado" },
    { data: iso(p), nome: "Páscoa", tipo: "comercial", dica: "chocolate, família e recomeço; aquecer 2 semanas antes" },
    { data: iso(mais(p, 60)), nome: "Corpus Christi", tipo: "feriado" },
    { data: iso(enesimo(ano, 5, 0, 2)), nome: "Dia das Mães", tipo: "comercial", dica: "segunda maior data do varejo; aquecer 3 semanas antes" },
    { data: iso(enesimo(ano, 8, 0, 2)), nome: "Dia dos Pais", tipo: "comercial", dica: "aquecer 2 a 3 semanas antes" },
    { data: iso(mais(quintaNov, 1)), nome: "Black Friday", tipo: "comercial", dica: "novembro inteiro é temporada; oferta real, preço de/por verdadeiro" },
    { data: iso(mais(quintaNov, 4)), nome: "Cyber Monday", tipo: "comercial" },
  ];
}

const diaDaSemanaIso = (data: string) => new Date(`${data}T12:00:00Z`).getUTCDay();

/**
 * Datas do Brasil que caem entre `inicio` e `fim` mais `antecipar` dias
 * (conteúdo de data grande começa antes). Datas em fim de semana ganham a
 * dica de publicar na sexta anterior. Ordem por data.
 */
export function datasDoPeriodo(inicio: string, fim: string, antecipar = 21): DataSazonal[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(inicio) || !/^\d{4}-\d{2}-\d{2}$/.test(fim) || fim < inicio) return [];
  const ate = iso(mais(new Date(`${fim}T12:00:00Z`), Math.max(0, antecipar)));
  const anos: number[] = [];
  for (let a = Number(inicio.slice(0, 4)); a <= Number(ate.slice(0, 4)); a++) anos.push(a);
  const todas: DataSazonal[] = [];
  for (const ano of anos) {
    for (const f of DATAS_FIXAS_BR) todas.push({ data: `${ano}-${f.md}`, nome: f.nome, tipo: f.tipo, ...(f.dica ? { dica: f.dica } : {}) });
    for (const m of Object.keys(CAMPANHAS_DO_MES_BR)) todas.push({ data: `${ano}-${m}-01`, nome: CAMPANHAS_DO_MES_BR[m], tipo: "campanha_do_mes", dica: "o mês inteiro; tom sério, informação correta" });
    todas.push(...datasMoveis(ano));
  }
  return todas
    .filter((d) => d.data >= inicio && d.data <= ate)
    .map((d) => {
      const dia = diaDaSemanaIso(d.data);
      const fimDeSemana = (dia === 0 || dia === 6) && d.tipo !== "campanha_do_mes";
      const depois = d.data > fim;
      const extra = [fimDeSemana ? "cai no fim de semana: publicar na sexta anterior" : "", depois ? "logo depois do período: preparar dentro dele" : ""].filter(Boolean).join("; ");
      return extra ? { ...d, dica: [d.dica, extra].filter(Boolean).join("; ") } : d;
    })
    .sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : 0));
}

// ------------------------------------------------------------------ pesquisa dirigida

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

/**
 * Pautas de pesquisa na web do mês, dirigidas ao nicho do cliente. O nicho
 * vem do dossiê e do cérebro (o modelo lê e troca "[nicho]" pelo nicho real).
 */
export function pautasDePesquisa(e: { inicio: string; regiao?: unknown; oferta?: unknown; objetivo?: unknown; datas?: DataSazonal[] }): string[] {
  const mes = MESES[Number(e.inicio.slice(5, 7)) - 1] ?? "";
  const ano = e.inicio.slice(0, 4);
  const regiao = typeof e.regiao === "string" && e.regiao.trim() ? e.regiao.trim() : "";
  const oferta = typeof e.oferta === "string" && e.oferta.trim() ? e.oferta.trim().slice(0, 120) : "";
  const onde = regiao ? ` em ${regiao}` : " no Brasil";
  const grandes = (e.datas ?? []).filter((d) => d.tipo === "comercial" || d.tipo === "profissao").slice(0, 3);
  const pautas = [
    `tendências e assuntos em alta de [nicho]${onde} em ${mes} de ${ano}`,
    `dúvidas e buscas mais comuns do público de [nicho] (Google e Instagram) em ${ano}`,
    `o que perfis de referência e concorrentes de [nicho]${onde} estão postando no Instagram agora (formatos, ganchos e séries)`,
    `formatos de carrossel e post estático em alta no Instagram em ${mes} de ${ano}`,
    `notícias, mudanças de regra ou de preço no setor de [nicho] em ${ano}`,
  ];
  for (const d of grandes) pautas.push(`${d.nome} ${ano} e [nicho]: ideias e comportamento do consumidor`);
  if (oferta) pautas.push(`demanda e objeções de quem procura ${oferta}${onde}`);
  return pautas;
}
