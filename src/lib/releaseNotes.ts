/**
 * As novidades do painel, escritas para o cliente ler.
 *
 * Regra de escrita: nada de termo técnico, nada de nome de arquivo, nada de
 * promessa vaga. Cada item responde "o que mudou para mim" em uma frase que a
 * pessoa entende sem saber nada de tecnologia. Sem travessão.
 *
 * `status` separa o que já está no ar do que está sendo construído agora, para
 * a página nunca prometer algo como pronto antes da hora.
 */

export type ReleaseStatus = "no-ar" | "esta-semana";

export interface ReleaseItem {
  title: string;
  description: string;
}

export interface ReleaseEntry {
  id: string;
  /** Data de referência, formato ISO curto. */
  date: string;
  status: ReleaseStatus;
  title: string;
  /** Frase de abertura, o "porquê" da mudança. */
  summary: string;
  items: ReleaseItem[];
}

export const RELEASE_NOTES: ReleaseEntry[] = [
  {
    id: "acesso-estavel",
    date: "2026-08-13",
    status: "no-ar",
    title: "O painel se atualiza sozinho",
    summary:
      "Alguns clientes ficavam presos numa versão antiga do painel, o que causava tela branca e travava aprovações. Isso acabou.",
    items: [
      {
        title: "Nunca mais tela branca",
        description:
          "Sempre que publicamos uma melhoria, o seu painel busca a versão nova sozinho, no celular ou no computador. Você não precisa fazer nada.",
      },
      {
        title: "Funciona igual em qualquer aparelho",
        description:
          "Seja pelo atalho na tela inicial do celular ou pelo navegador, a experiência é a mesma e o acesso é o mesmo.",
      },
    ],
  },
  {
    id: "organizacao-arquivos",
    date: "2026-08-13",
    status: "no-ar",
    title: "Seus arquivos organizados por tipo",
    summary:
      "Antes era tudo um monte só e você não sabia o que era cada coisa. Agora cada material tem o seu lugar.",
    items: [
      {
        title: "Materiais gráficos separados",
        description:
          "Dentro de Materiais você filtra por carrossel, post, story e vídeo. Cada botão mostra quantos itens existem antes de você clicar.",
      },
      {
        title: "Cada pasta explica o que é",
        description:
          "Identidade visual, base de fotos e vídeos, documentos estratégicos, documentos operacionais, relatórios e contratos. Tudo nomeado em português claro.",
      },
      {
        title: "Nada mais fica escondido",
        description:
          "Antes a sua tela mostrava só uma parte das pastas e material liberado ficava invisível. Agora você vê tudo o que é seu.",
      },
    ],
  },
  {
    id: "painel-alinhado",
    date: "2026-08-13",
    status: "no-ar",
    title: "Painel mais limpo e fácil de ler",
    summary:
      "Passamos tela por tela deixando tudo no mesmo padrão, para a informação ficar na frente e não a decoração.",
    items: [
      {
        title: "Tudo alinhado",
        description:
          "Títulos, larguras e cartões seguem um padrão único em todas as telas. Acabaram os espaços vazios e os blocos desencontrados.",
      },
      {
        title: "Mesma cara no celular",
        description:
          "O painel foi ajustado para o celular sem perder nada do que existe no computador.",
      },
    ],
  },
  {
    id: "onde-estamos",
    date: "2026-08-12",
    status: "no-ar",
    title: "Onde Estamos: a sua evolução mês a mês",
    summary:
      "A pergunta mais comum era simples: o que está sendo feito pelo meu negócio agora? Esta tela responde sozinha, em tempo real.",
    items: [
      {
        title: "Linha do tempo da sua evolução",
        description:
          "Mês a mês, quantos materiais foram produzidos, quantas publicações foram ao ar e quantas medições foram feitas. Clique no mês e veja o que aconteceu nele.",
      },
      {
        title: "Gráfico de crescimento do negócio",
        description:
          "Contatos e alcance período a período, montados a partir dos relatórios reais. Não é estimativa, é o que aconteceu.",
      },
      {
        title: "Antes e Agora",
        description:
          "Um resumo automático de tudo o que não existia quando começamos e existe hoje. É a sua história com a Aceleriq escrita sozinha.",
      },
      {
        title: "Como funciona cada serviço",
        description:
          "Um desenho simples do caminho do trabalho, do planejamento até a entrega, para você saber sempre em que etapa estamos.",
      },
    ],
  },
  {
    id: "diario-do-trabalho",
    date: "2026-08-11",
    status: "no-ar",
    title: "Diário do Trabalho em tempo real",
    summary:
      "Cada movimento do time aparece para você na hora, sem precisar perguntar no WhatsApp.",
    items: [
      {
        title: "Tudo o que acontece vira registro",
        description:
          "Material novo, envio para aprovação, aprovação, publicação no ar e relatório publicado entram na linha do tempo automaticamente.",
      },
      {
        title: "Explicação junto da entrega",
        description:
          "A equipe registra o que foi feito, por que foi feito e qual o próximo passo. Você lê e entende a estratégia, não só o resultado.",
      },
      {
        title: "Clique e veja o material",
        description:
          "Cada registro abre o arquivo correspondente, com miniatura, direto do diário.",
      },
    ],
  },
  {
    id: "aprovacao-publicacao",
    date: "2026-08-10",
    status: "no-ar",
    title: "Aprovou, publica sozinho",
    summary:
      "O caminho entre a sua aprovação e o post no ar ficou automático, sem ninguém precisar lembrar de nada.",
    items: [
      {
        title: "Publicação automática no Instagram",
        description:
          "Post, carrossel e vídeo aprovados vão ao ar na data e hora combinadas, sem etapa manual no meio.",
      },
      {
        title: "Aprovação sem confusão",
        description:
          "Os cartões do carrossel aparecem na ordem certa e o histórico de ajustes fica registrado.",
      },
    ],
  },
  {
    id: "relatorios-claros",
    date: "2026-08-06",
    status: "no-ar",
    title: "Relatórios em linguagem de gente",
    summary:
      "Relatório serve para decidir, não para impressionar. Reescrevemos a leitura dos números.",
    items: [
      {
        title: "O número e o significado",
        description:
          "Cada métrica vem com a explicação do que ela quer dizer para o seu negócio e a comparação com o período anterior.",
      },
      {
        title: "Sem zero sem sentido",
        description:
          "Onde ainda não existe medição, a tela diz isso com clareza em vez de mostrar um zero que assusta.",
      },
    ],
  },
  {
    id: "financeiro",
    date: "2026-07-30",
    status: "no-ar",
    title: "Financeiro transparente",
    summary:
      "O ponto de partida desta evolução toda: deixar a parte do dinheiro clara dos dois lados.",
    items: [
      {
        title: "Seu plano e seus valores",
        description:
          "O que está contratado, o que está pago e o que está em aberto, sempre atualizado.",
      },
      {
        title: "Pedidos avulsos e investimento em anúncios",
        description:
          "Trabalhos fora do plano e verba de anúncio aparecem separados, para nunca haver dúvida sobre o que é o quê.",
      },
    ],
  },
  {
    id: "proxima-semana",
    date: "2026-08-14",
    status: "esta-semana",
    title: "O que estamos construindo agora",
    summary:
      "As próximas entregas já estão em produção e entram no seu painel durante a semana.",
    items: [
      {
        title: "Identidade visual da sua marca no painel",
        description:
          "Uma área com a sua logo, cores, fontes e materiais da marca, reunidos num lugar só, com leitura automática do seu Instagram para manter tudo alinhado.",
      },
      {
        title: "Números do Instagram entrando sozinhos",
        description:
          "Alcance, contatos e desempenho dos posts alimentando os relatórios automaticamente, sem digitação manual.",
      },
      {
        title: "Melhorias contínuas no painel",
        description:
          "Seguimos ajustando telas e textos toda semana para deixar cada vez mais claro o que está sendo feito pelo seu negócio.",
      },
    ],
  },
];

export function releasesByStatus(status: ReleaseStatus): ReleaseEntry[] {
  return RELEASE_NOTES.filter((entry) => entry.status === status);
}

/** Data no formato que o cliente lê: "13 de agosto de 2026". */
export function formatReleaseDate(date: string): string {
  const parsed = new Date(`${date}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}
