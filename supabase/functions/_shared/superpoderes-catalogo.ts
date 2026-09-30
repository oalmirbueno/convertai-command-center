/**
 * Superpoderes das mesas: o catálogo (frente SPP, 30/09/2026).
 *
 * Adaptado de obra/superpowers (https://github.com/obra/superpowers), tag
 * v6.4.2, licença MIT, Copyright (c) 2025 Jesse Vincent. O aviso completo
 * está em docs/licencas/superpowers-MIT.txt. Os textos abaixo são nossos, em
 * português: o método das skills resumido para agentes de mesa, que não têm
 * ferramenta de arquivo, teste, commit nem subagente. Nenhum texto das skills
 * foi copiado.
 *
 * Pedido do dono (30/09): "instale o repositório superpowers dentro do painel
 * em todas as mesas, completo, e todas as mesas conhecem a memória e o
 * contexto de cada cliente e o aprendizado do painel, e evoluem juntas".
 *
 * O que este módulo guarda (puro: sem Deno, sem banco; a tela e o servidor
 * leem o mesmo arquivo):
 * - os 8 métodos da casa (ids, rótulo com as palavras do dono, texto que o
 *   agente recebe, skill de origem e prioridade de corte) e a abertura;
 * - as mesas e os agentes que recebem o método (e quais métodos cada um pode
 *   receber); `motores.ts` cobra a ligação no código de cada um;
 * - o mapa das 15 skills do Superpowers: onde cada uma vale e como;
 * - a regra do liga e desliga por mesa (sem linha = ligado; a linha da mesa
 *   vence a linha "*"; a prova nunca desliga).
 *
 * O método só diz COMO o agente trabalha. Memória, contexto e aprendizado
 * vêm da frente SYNC (contextoCompletoParaPrompt, o bloco "CONTEXTO COMPLETO
 * DA MARCA", e regrasDaMesa com o alcance "todas"); o método manda consultar
 * esse contexto antes de perguntar e nunca lê nada sozinho.
 *
 * Evolução dos blocos (writing-skills adaptado; é processo, não prompt): o
 * texto de um bloco só muda com (1) um caso real que falhou, anotado (ia_usos
 * com prova que faltou ou uma conversa citada), (2) o bloco novo e (3) um
 * teste de controle, com e sem o bloco, em 5 repetições. Cada mudança sobe
 * VERSAO_DOS_SUPERPODERES, e todas as mesas mudam juntas.
 *
 * Compatível com Safari 11 (a tela importa este arquivo): sem lookbehind,
 * sem \p{}, sem grupo nomeado e sem .at(). Sem travessão e sem emoji.
 */

export const VERSAO_DO_SUPERPOWERS = "v6.4.2";
export const COMMIT_DO_SUPERPOWERS = "8ca22dba9a94f28898bbce59f2537ff4d87c747d";
export const VERSAO_DOS_SUPERPODERES = `2026-09-30.1 (obra/superpowers ${VERSAO_DO_SUPERPOWERS})`;
export const LICENCA_DO_SUPERPOWERS = "MIT (Copyright (c) 2025 Jesse Vincent)";
export const URL_DO_SUPERPOWERS = "https://github.com/obra/superpowers";
export const ARQUIVO_DA_LICENCA = "docs/licencas/superpowers-MIT.txt";

/** Teto próprio da camada do método (fora dos tetos de conhecimento que já existem). */
export const TETO_DOS_SUPERPODERES = 2_400;
/** Agente rápido (lançador) pede metade. */
export const TETO_DO_AGENTE_RAPIDO = 1_200;
/** Além da abertura e da prova, no máximo 3 blocos por chamada. */
export const MAXIMO_DE_BLOCOS_EXTRAS = 3;

export type IdDoMetodo = "entender" | "plano" | "prova" | "causa" | "receber" | "revisor" | "aceite" | "frentes";
export type Caminho = "conversa" | "pequeno" | "grande" | "viabilidade";
export type Momento = "conversa" | "gerar" | "ajustar" | "reprovado" | "falhou" | "revisar" | "lote";
export type FonteDaEscolha = "codigo" | "jev" | "regra";

/** Ordem fixa do texto (prefixo estável para o cache do provedor): a prova vem logo depois da abertura. */
export const IDS_DOS_METODOS: readonly IdDoMetodo[] = ["prova", "entender", "plano", "causa", "receber", "revisor", "aceite", "frentes"];
export const CAMINHOS: readonly Caminho[] = ["conversa", "pequeno", "grande", "viabilidade"];
export const MOMENTOS: readonly Momento[] = ["conversa", "gerar", "ajustar", "reprovado", "falhou", "revisar", "lote"];

/** A prova nunca sai: nem por teto, nem pela chave da mesa (regra da casa). */
export const METODOS_SEMPRE: readonly IdDoMetodo[] = ["prova"];

/**
 * Quem sai primeiro quando passa do teto (ou quando há mais de 3 blocos):
 * frentes, aceite, revisor, plano, entender, receber, causa. A prova nunca.
 */
export const ORDEM_DE_CORTE: readonly IdDoMetodo[] = ["frentes", "aceite", "revisor", "plano", "entender", "receber", "causa"];

/** Rótulo na tela, com as palavras do dono. */
export const ROTULOS_DOS_METODOS: Record<IdDoMetodo, string> = {
  entender: "brainstorm",
  plano: "plano",
  prova: "verificação",
  causa: "depuração",
  receber: "receber ajuste",
  revisor: "revisão",
  aceite: "critério de aceite",
  frentes: "frentes paralelas",
};

/** Skill do Superpowers de onde cada método veio (adaptação, texto nosso). */
export const SKILL_DE_ORIGEM: Record<IdDoMetodo, string[]> = {
  entender: ["brainstorming"],
  plano: ["writing-plans", "executing-plans"],
  prova: ["verification-before-completion"],
  causa: ["systematic-debugging"],
  receber: ["receiving-code-review"],
  revisor: ["requesting-code-review"],
  aceite: ["test-driven-development"],
  frentes: ["dispatching-parallel-agents", "subagent-driven-development"],
};

// ------------------------------------------------------------------ textos

/** Sempre, antes dos blocos. Adaptação de using-superpowers. */
export const ABERTURA_DOS_SUPERPODERES =
  "MÉTODO DA CASA (superpoderes; adaptado de obra/superpowers, licença MIT). Antes de responder, veja qual dos métodos abaixo vale para este pedido e siga-o à risca. O contexto completo da marca, as regras da equipe e as regras da casa vencem o método. Se a resposta tiver o campo metodos_usados, liste nele só os ids que você de fato seguiu; não escreva os ids no texto.";

/** O bloco [entender] tem uma variante por caminho; só uma entra. */
export const TEXTOS_DO_ENTENDER: Record<"grande" | "pequeno" | "viabilidade", string> = {
  grande:
    "[entender] ENTENDER ANTES DE PRODUZIR. 1) Diga em uma frase o que entendeu: resultado, para quem, o que é sucesso; separe o que a equipe disse do que você supõe. 2) Procure a resposta no contexto completo da marca antes de perguntar: pergunta cuja resposta já está lá é proibida. 3) Falta algo que muda o resultado? Faça UMA pergunta por vez, de preferência com opções. 4) Ofereça 2 ou 3 caminhos com prós e contras e diga qual recomenda. 5) Peça grande: mostre o desenho por partes e espere o aprovado de cada parte. Nada caro antes do aprovado. Corte o que ninguém pediu.",
  pequeno:
    "[entender] PEDIDO PEQUENO. Confirme em uma frase o que vai mudar e faça. Não abra desenho novo nem ofereça caminhos: só pergunte se faltar um dado que muda o resultado e que não está no contexto completo da marca.",
  viabilidade:
    "[entender] PERGUNTA DE VIABILIDADE. Responda se dá, como testaria e quanto custa, em poucas frases, e recomende. Não produza a peça: o que for feito aqui é só teste.",
};

/** Texto de cada método (o [entender] daqui é a variante grande; a escolha troca pela do caminho). */
export const TEXTOS_DOS_METODOS: Record<IdDoMetodo, string> = {
  prova:
    '[prova] PROVA ANTES DE DIZER PRONTO. Só diga feito, pronto, gerado, salvo, enviado ou corrigido quando esta resposta trouxer a prova: o resultado da ação (o que foi criado, onde está, o número conferido). Sem a prova, diga o que falta e ofereça o cartão para fazer. Proibido: "deve ter funcionado", "provavelmente", comemorar antes de conferir, prometer para depois.',
  entender: TEXTOS_DO_ENTENDER.grande,
  plano:
    '[plano] PLANO ANTES DE AÇÃO CARA. Ação com custo, irreversível ou com mais de dois passos: antes, monte o plano em passos numerados, cada um com o que sai e como conferir; copie as restrições do kit, da marca e do briefing (paleta, tom, público, teto de custo). Mostre o custo total e peça Confirmar. Na execução, siga os passos em ordem sem perguntar "posso continuar?"; decisão que você tomar sozinho vira uma linha "Decidi: o quê, porque". Pare só em ação irreversível, envio ao cliente, publicação ou quando todo caminho for chute.',
  causa:
    "[causa] QUANDO ALGO FALHA, CAUSA ANTES DO CONSERTO. 1) Leia o erro ou a reclamação inteira e diga o que falhou. 2) Compare com um caso parecido que deu certo. 3) Escreva UMA hipótese e teste a menor mudança. 4) Só então corrija, uma coisa por vez. Não refaça no escuro. Depois de 3 tentativas sem acerto, pare e diga à equipe o que já sabe e o que falta. Imagem e foto não entram em laço: gere opções e deixe a equipe escolher.",
  receber:
    '[receber] RECEBER AJUSTE OU CRÍTICA. Leia tudo, repita em uma frase o que entendeu e confira na peça se procede. Responda com o que vai mudar, sem bajulação (nada de "ótima ideia" ou "você tem razão"). Se o ajuste contradiz o briefing, o kit ou uma regra do dono, diga antes de fazer, com a razão. Item confuso: pergunte antes de mexer em qualquer coisa. Ordem: o que bloqueia, depois o simples, depois o complexo.',
  revisor:
    "[revisor] REVISÃO ANTES DE ENTREGAR. Antes de mandar peça grande para aprovação, confira como um revisor que não fez a peça: bate com o briefing e com o kit? Liste o que falta como crítico, importante ou menor, e o que você não conseguiu julgar. Crítico se corrige antes de entregar; importante vai junto como aviso; menor vira nota.",
  aceite:
    "[aceite] CRITÉRIO DE ACEITE PRIMEIRO. Antes de produzir, liste para si de 3 a 5 checagens objetivas que a peça precisa passar (formato, tamanho, paleta, CTA, dado real, prazo). Depois de produzir, confira cada uma e diga o que não passou. Texto que falhou se corrige uma vez; imagem que falhou vira aviso para a equipe escolher, sem refazer sozinho.",
  frentes:
    "[frentes] FRENTES INDEPENDENTES. Pedido com partes que não dependem uma da outra: separe em frentes, cada uma com objetivo, limite e o que devolve, e proponha fazer em passos (ou levar ao conselho quando a decisão pede vários especialistas). Partes que mexem na mesma peça ficam juntas. No fim, junte os resultados e confira se uma frente não desfez a outra.",
};

/** Linha para agentes cujo JSON é descrito no texto (sem esquema): o campo extra é opcional. */
export const INSTRUCAO_METODOS_USADOS =
  'Se a resposta for JSON, inclua "metodos_usados": a lista dos ids do método da casa que você de fato seguiu (pode ser vazia).';

/** Propriedade para os esquemas JSON (strict): some em `properties` e o nome em `required`. */
export const PROPRIEDADE_METODOS_USADOS: Record<string, unknown> = {
  metodos_usados: { type: "array", items: { type: "string", enum: IDS_DOS_METODOS.slice() } },
};

/**
 * O mesmo esquema com o campo metodos_usados (em `properties` e em `required`,
 * como o modo strict pede). Aceita { nome, schema } ou o schema cru. O
 * original não muda (os testes que fixam o `required` de cada agente seguem).
 */
export function comMetodosUsados<T>(esquema: T): T {
  const e = esquema as unknown as Record<string, unknown>;
  const embrulhado = !!e && typeof e.schema === "object" && e.schema !== null;
  const s = (embrulhado ? e.schema : e) as { properties?: Record<string, unknown>; required?: string[] };
  const required = Array.isArray(s.required) ? s.required.slice() : [];
  if (required.indexOf("metodos_usados") < 0) required.push("metodos_usados");
  const novo = { ...s, properties: { ...(s.properties || {}), ...PROPRIEDADE_METODOS_USADOS }, required };
  return (embrulhado ? { ...e, schema: novo } : novo) as unknown as T;
}

// ------------------------------------------------------------------ mesas e agentes

export type MesaDosSuperpoderes =
  | "contexto" | "calendario" | "estudio" | "estilo" | "instagram" | "perfis" | "ads" | "foto" | "videos" | "edicao"
  | "publicidade" | "roteiros" | "proposta" | "contratos" | "identidade" | "site" | "motion" | "briefing" | "preencher"
  | "documentos" | "conselho" | "workspace" | "assistente" | "central" | "rituais";

/** As mesas da chave de liga e desliga (o id é o da coluna mesa em superpoderes_das_mesas). */
export const MESAS_DOS_SUPERPODERES: ReadonlyArray<{ id: MesaDosSuperpoderes; rotulo: string }> = [
  { id: "contexto", rotulo: "Mesa do cliente" },
  { id: "calendario", rotulo: "Mês e Campanhas" },
  { id: "estudio", rotulo: "Estúdio" },
  { id: "estilo", rotulo: "Estilo do cliente" },
  { id: "instagram", rotulo: "Redes" },
  { id: "perfis", rotulo: "Perfis do Instagram" },
  { id: "ads", rotulo: "Mesa Ads" },
  { id: "foto", rotulo: "Mesa Foto" },
  { id: "videos", rotulo: "Mesa Vídeos" },
  { id: "edicao", rotulo: "Mesa Edição" },
  { id: "publicidade", rotulo: "Mesa Publicidade" },
  { id: "roteiros", rotulo: "Mesa Roteiros" },
  { id: "proposta", rotulo: "Proposta" },
  { id: "contratos", rotulo: "Contratos" },
  { id: "identidade", rotulo: "Mesa Identidade" },
  { id: "site", rotulo: "Mesa Site" },
  { id: "motion", rotulo: "Mesa Motion" },
  { id: "briefing", rotulo: "Briefing" },
  { id: "preencher", rotulo: "Preencher com IA" },
  { id: "documentos", rotulo: "Documentos" },
  { id: "conselho", rotulo: "Conselho" },
  { id: "workspace", rotulo: "Workspace" },
  { id: "assistente", rotulo: "Assistente geral" },
  { id: "central", rotulo: "Central" },
  { id: "rituais", rotulo: "Rituais e esteira" },
];

export type AgenteComSuperpoderes = {
  id: string;
  mesa: MesaDosSuperpoderes;
  rotulo: string;
  /** Edge Function que chama a IA. */
  funcao: string;
  /** Quem escolhe os blocos: o Jev (conversa) ou o código (momento conhecido). */
  escolha: "jev" | "codigo";
  /** Métodos que este agente pode receber (a prova sempre). */
  metodos: IdDoMetodo[];
  /** Uma frase do que a mesa faz, para o Jev julgar o pedido. */
  oQueFaz: string;
  /** Peça grande (proposta, contrato, identidade, site, campanha, publicidade): o caminho grande leva o revisor. */
  pecaGrande?: boolean;
  /** Teto menor (agente rápido). */
  teto?: number;
};

const TODOS: IdDoMetodo[] = ["entender", "plano", "prova", "causa", "receber", "revisor", "aceite", "frentes"];
const semFrentes = TODOS.filter((m) => m !== "frentes");

/**
 * Um agente por linha da tabela 4.6 do desenho (p9-desenho-superpowers.md) e,
 * desde a revisão de 30/09, as gerações que ainda iam sem método: o montar da
 * Mesa do cliente, o escritor dos rituais, o plano igual dos Perfis, a
 * campanha e o agente do Canvas da Mesa Foto, o refino do Estúdio e a bio,
 * o nome e os destaques das Redes. Quem fica sem, de propósito, está em
 * motores.ts (SEM_METODO_DE_PROPOSITO e CHAMADAS_SEM_METODO).
 */
export const AGENTES_COM_SUPERPODERES: readonly AgenteComSuperpoderes[] = [
  { id: "contexto.conversa", mesa: "contexto", rotulo: "Contexto: conversa", funcao: "agente-contexto", escolha: "jev", metodos: TODOS, oQueFaz: "Monta e mantém o contexto do cliente (marca, público, oferta, referências) e responde sobre ele." },
  { id: "contexto.montar", mesa: "contexto", rotulo: "Contexto: montar", funcao: "agente-contexto", escolha: "codigo", metodos: ["aceite", "prova"], oQueFaz: "Monta o contexto do cliente (ou de uma marca) a partir dos documentos, do dossiê e das artes aprovadas." },
  { id: "contexto.plano", mesa: "contexto", rotulo: "Agente do cliente (plano)", funcao: "agente-contexto", escolha: "jev", metodos: ["entender", "plano", "prova", "frentes", "causa"], oQueFaz: "Planeja o trabalho do cliente (próximos passos, campanhas, prioridades) com as ferramentas de leitura." },
  { id: "calendario.conversa", mesa: "calendario", rotulo: "Mês e Campanhas: conversa", funcao: "agente-calendario", escolha: "jev", metodos: TODOS, pecaGrande: true, oQueFaz: "Planeja o mês de conteúdo e as campanhas do cliente e mexe nas pautas da agenda." },
  { id: "calendario.gerar", mesa: "calendario", rotulo: "Mês: escrever, temas, diagnóstico, campanha", funcao: "agente-calendario", escolha: "codigo", metodos: ["aceite", "prova"], oQueFaz: "Escreve o mês, os temas, o diagnóstico e a campanha." },
  { id: "estudio.conversa", mesa: "estudio", rotulo: "Estúdio: conversa do diretor", funcao: "estudio-arte", escolha: "jev", metodos: ["entender", "receber", "causa", "prova"], oQueFaz: "Diretor de arte: conversa sobre as artes do cliente e prepara ajustes e novas peças." },
  { id: "estudio.direcao", mesa: "estudio", rotulo: "Estúdio: direção", funcao: "estudio-arte", escolha: "codigo", metodos: ["aceite", "prova"], oQueFaz: "Escreve a direção de arte da peça antes do gerador de imagem." },
  { id: "estudio.refino", mesa: "estudio", rotulo: "Estúdio: refino de texto", funcao: "estudio-arte", escolha: "codigo", metodos: ["receber", "prova"], oQueFaz: "Refina o texto da peça com o pedido livre da equipe." },
  { id: "estilo.agente", mesa: "estilo", rotulo: "Estilo do cliente", funcao: "agente-estilo", escolha: "jev", metodos: ["entender", "receber", "prova"], oQueFaz: "Monta e ajusta o guia de estilo visual do cliente." },
  { id: "instagram.agente", mesa: "instagram", rotulo: "Redes (Instagram)", funcao: "mesa-instagram", escolha: "jev", metodos: semFrentes, oQueFaz: "Cuida do perfil do Instagram do cliente: leitura, métricas, bio, destaques e próximos posts." },
  { id: "instagram.geracao", mesa: "instagram", rotulo: "Redes: bio, nome e destaques", funcao: "mesa-instagram", escolha: "codigo", metodos: ["aceite", "prova"], oQueFaz: "Sugere a bio, o nome do perfil e os destaques do Instagram do cliente." },
  { id: "perfis.conversa", mesa: "perfis", rotulo: "Perfis do Instagram: conversa", funcao: "perfis-instagram", escolha: "jev", metodos: ["entender", "prova", "causa"], oQueFaz: "Estuda perfis de referência do Instagram e traz ideias para o cliente." },
  { id: "perfis.plano", mesa: "perfis", rotulo: "Perfis do Instagram: plano igual e ideias", funcao: "perfis-instagram", escolha: "codigo", metodos: ["aceite", "prova"], oQueFaz: "Escreve as pautas do plano igual ao perfil de referência e as ideias de resposta, sem copiar." },
  { id: "ads.plano", mesa: "ads", rotulo: "Ads: conversa do plano", funcao: "mesa-ads", escolha: "jev", metodos: TODOS, oQueFaz: "Estrategista de tráfego pago: plano de anúncios, públicos, orçamento e criativos." },
  { id: "ads.oferta", mesa: "ads", rotulo: "Ads: conversa da oferta", funcao: "mesa-ads", escolha: "jev", metodos: TODOS, oQueFaz: "Monta e ajusta a oferta que os anúncios vendem." },
  { id: "ads.senior", mesa: "ads", rotulo: "Ads: sênior de tráfego", funcao: "mesa-ads", escolha: "jev", metodos: TODOS, oQueFaz: "Sênior de tráfego: lê a conta de anúncios e decide corte, escala e testes." },
  { id: "ads.estrategista", mesa: "ads", rotulo: "Ads: ângulos, copy, pacote, oferta, conta", funcao: "mesa-ads", escolha: "codigo", metodos: ["aceite", "plano", "prova"], oQueFaz: "Gera ângulos, copy, pacote de anúncios, oferta e leitura da conta." },
  { id: "foto.agente", mesa: "foto", rotulo: "Mesa Foto: agente", funcao: "mesa-foto", escolha: "jev", metodos: ["entender", "plano", "receber", "causa", "prova"], oQueFaz: "Diretor de foto: prepara ensaios e fotos de produto do cliente, sem laço de correção." },
  { id: "foto.campanha", mesa: "foto", rotulo: "Mesa Foto: campanha", funcao: "mesa-foto", escolha: "codigo", metodos: ["aceite", "prova"], oQueFaz: "Planeja a campanha de fotos do cliente (peças, cenas e ordem)." },
  { id: "foto.canvas", mesa: "foto", rotulo: "Mesa Foto: agente do Canvas", funcao: "mesa-foto", escolha: "jev", metodos: ["entender", "receber", "causa", "prova"], oQueFaz: "Diretor de fotografia do Canvas: conversa com a equipe sobre a composição aberta, sem laço de correção." },
  { id: "videos.diretor", mesa: "videos", rotulo: "Mesa Vídeos: diretor", funcao: "mesa-videos", escolha: "jev", metodos: semFrentes, oQueFaz: "Diretor de vídeo: planeja e dirige os vídeos gerados do cliente." },
  { id: "edicao.agente", mesa: "edicao", rotulo: "Mesa Edição: editor", funcao: "editor-video", escolha: "jev", metodos: ["entender", "causa", "receber", "prova"], oQueFaz: "Editor de vídeo: corta, legenda e monta o projeto aberto na tela." },
  { id: "publicidade.diretor", mesa: "publicidade", rotulo: "Publicidade: diretor de campanha", funcao: "mesa-publicidade", escolha: "codigo", metodos: ["aceite", "revisor", "prova"], pecaGrande: true, oQueFaz: "Escreve a direção da campanha publicitária." },
  { id: "publicidade.agente", mesa: "publicidade", rotulo: "Publicidade: agente", funcao: "mesa-publicidade", escolha: "jev", metodos: TODOS, pecaGrande: true, oQueFaz: "Conversa sobre as campanhas publicitárias do cliente e prepara as ações." },
  { id: "roteiros.roteirista", mesa: "roteiros", rotulo: "Roteiros: roteirista", funcao: "mesa-roteiros", escolha: "codigo", metodos: ["aceite", "prova"], oQueFaz: "Escreve roteiros de vídeo curto para o cliente gravar." },
  { id: "roteiros.agente", mesa: "roteiros", rotulo: "Roteiros: agente", funcao: "mesa-roteiros", escolha: "jev", metodos: TODOS, oQueFaz: "Conversa sobre os roteiros de vídeo do cliente e prepara as ações (gerar, refazer gancho, mudar tom)." },
  { id: "proposta.escrever", mesa: "proposta", rotulo: "Proposta: escrever e evolução", funcao: "mesa-proposta", escolha: "codigo", metodos: ["aceite", "revisor", "prova"], pecaGrande: true, oQueFaz: "Escreve a proposta comercial e as partes da evolução." },
  { id: "proposta.agente", mesa: "proposta", rotulo: "Proposta: agente", funcao: "mesa-proposta", escolha: "jev", metodos: TODOS, pecaGrande: true, oQueFaz: "Estrategista comercial: conversa sobre a proposta e prepara os ajustes." },
  { id: "contratos.agente", mesa: "contratos", rotulo: "Contratos: agente", funcao: "contratos", escolha: "jev", metodos: ["entender", "receber", "revisor", "prova"], pecaGrande: true, oQueFaz: "Monta e ajusta os contratos do cliente com os dados da agência." },
  { id: "identidade.diretor", mesa: "identidade", rotulo: "Identidade: diretor de marca", funcao: "mesa-identidade", escolha: "jev", metodos: ["entender", "plano", "revisor", "aceite", "prova"], pecaGrande: true, oQueFaz: "Diretor de marca: estratégia, naming e identidade visual do cliente." },
  { id: "identidade.acoes", mesa: "identidade", rotulo: "Identidade: estratégia e naming", funcao: "mesa-identidade", escolha: "codigo", metodos: ["plano", "revisor", "aceite", "prova"], pecaGrande: true, oQueFaz: "Gera a estratégia de marca e os nomes." },
  { id: "site.agente", mesa: "site", rotulo: "Site: diretor de site", funcao: "mesa-site", escolha: "jev", metodos: TODOS, pecaGrande: true, oQueFaz: "Diretor de site: estrutura, conteúdo e seções do site do cliente." },
  { id: "site.geracao", mesa: "site", rotulo: "Site: conteúdo e seção", funcao: "mesa-site", escolha: "codigo", metodos: ["aceite", "prova"], pecaGrande: true, oQueFaz: "Escreve o conteúdo e as seções do site." },
  { id: "motion.agente", mesa: "motion", rotulo: "Motion: agente", funcao: "mesa-motion", escolha: "jev", metodos: TODOS, oQueFaz: "Diretor de motion: marca em movimento, storyboards e cenas animadas do cliente." },
  { id: "motion.geracao", mesa: "motion", rotulo: "Motion: brand e storyboards", funcao: "mesa-motion", escolha: "codigo", metodos: ["aceite", "prova"], oQueFaz: "Escreve a marca em movimento e os storyboards." },
  { id: "briefing.preencher", mesa: "briefing", rotulo: "Briefing: preencher", funcao: "briefing-agente", escolha: "codigo", metodos: ["prova"], oQueFaz: "Preenche o briefing com o que o painel já sabe; sem fonte, fica vazio." },
  { id: "preencher.campos", mesa: "preencher", rotulo: "Preencher com IA", funcao: "preencher-ia", escolha: "codigo", metodos: ["prova"], oQueFaz: "Preenche campos das mesas com o contexto do cliente; sem fonte, fica vazio." },
  { id: "documentos.registro", mesa: "documentos", rotulo: "Documento: registro da entrega", funcao: "documentos", escolha: "codigo", metodos: ["aceite", "prova"], oQueFaz: "Escreve o documento de entrega com os dados da entrega." },
  { id: "conselho.especialista", mesa: "conselho", rotulo: "Conselho: especialistas", funcao: "conselho", escolha: "codigo", metodos: ["prova"], oQueFaz: "Cada especialista dá o parecer com a evidência citada." },
  { id: "conselho.sintese", mesa: "conselho", rotulo: "Conselho: síntese", funcao: "conselho", escolha: "codigo", metodos: ["frentes", "revisor", "prova"], oQueFaz: "Junta os pareceres, decide e diz o que não julgou." },
  { id: "workspace.agente", mesa: "workspace", rotulo: "Workspace", funcao: "workspace-agent", escolha: "jev", metodos: TODOS, oQueFaz: "Diretor de pré-produção do Workspace: organiza projetos, documentos e tarefas." },
  { id: "assistente.lancador", mesa: "assistente", rotulo: "Assistente geral", funcao: "voice-assistant-agent", escolha: "jev", metodos: ["entender", "frentes", "causa", "prova"], teto: TETO_DO_AGENTE_RAPIDO, oQueFaz: "Assistente geral do painel (voz e texto): responde e leva a pessoa à tela certa." },
  { id: "central.agente", mesa: "central", rotulo: "Central", funcao: "agente-central", escolha: "jev", metodos: ["entender", "plano", "frentes", "causa", "prova"], oQueFaz: "Central da agência: prepara e aplica o ciclo da semana com o estado real dos clientes." },
  { id: "rituais.esteira", mesa: "rituais", rotulo: "Esteira da semana", funcao: "esteira-semana", escolha: "codigo", metodos: ["prova"], oQueFaz: "Esteira da semana: o que foi feito e os próximos passos." },
  { id: "rituais.escritor", mesa: "rituais", rotulo: "Escritor dos rituais", funcao: "ritual-writer", escolha: "codigo", metodos: ["prova"], oQueFaz: "Escreve as mensagens dos rituais ao cliente com o estado real." },
  { id: "rituais.coach", mesa: "rituais", rotulo: "Coach do ciclo", funcao: "cycle-coach", escolha: "codigo", metodos: ["prova"], oQueFaz: "Coach do ciclo da semana." },
  { id: "rituais.radar", mesa: "rituais", rotulo: "Radar de ideias", funcao: "radar-ideas", escolha: "codigo", metodos: ["prova"], oQueFaz: "Radar de ideias do cliente." },
];

export function agenteComSuperpoderes(id: string): AgenteComSuperpoderes | null {
  for (const a of AGENTES_COM_SUPERPODERES) if (a.id === id) return a;
  return null;
}

// ------------------------------------------------------------------ liga e desliga

export type LinhaDaChave = { mesa: string; metodo: string; ligado: boolean };

/**
 * Métodos desligados numa mesa: sem linha = ligado; a linha da mesa vence a
 * linha "*" (todas as mesas); a prova nunca desliga.
 */
export function metodosDesligados(linhas: readonly LinhaDaChave[] | null | undefined, mesa: string): IdDoMetodo[] {
  const fora: IdDoMetodo[] = [];
  for (const id of IDS_DOS_METODOS) {
    if (METODOS_SEMPRE.indexOf(id) >= 0) continue;
    let valor: boolean | null = null;
    let geral: boolean | null = null;
    for (const l of linhas || []) {
      if (!l || l.metodo !== id) continue;
      if (l.mesa === mesa) valor = l.ligado !== false;
      else if (l.mesa === "*") geral = l.ligado !== false;
    }
    const ligado = valor !== null ? valor : geral !== null ? geral : true;
    if (!ligado) fora.push(id);
  }
  return fora;
}

/** Mesas onde o método pode entrar (algum agente da mesa o recebe), na ordem de MESAS_DOS_SUPERPODERES. */
export function ondeValeOMetodo(metodo: IdDoMetodo): MesaDosSuperpoderes[] {
  const saida: MesaDosSuperpoderes[] = [];
  for (const m of MESAS_DOS_SUPERPODERES) {
    if (AGENTES_COM_SUPERPODERES.some((a) => a.mesa === m.id && a.metodos.indexOf(metodo) >= 0)) saida.push(m.id);
  }
  return saida;
}

/** "ligado em N de M mesas" para a tela (M = mesas onde o método pode entrar). */
export function mesasComOMetodo(linhas: readonly LinhaDaChave[] | null | undefined, metodo: IdDoMetodo): { ligadas: number; total: number } {
  const onde = ondeValeOMetodo(metodo);
  let ligadas = 0;
  for (const mesa of onde) if (metodosDesligados(linhas, mesa).indexOf(metodo) < 0) ligadas += 1;
  return { ligadas, total: onde.length };
}

// ------------------------------------------------------------------ injeção

export type MetodoInjetado = {
  texto: string;
  ids: IdDoMetodo[];
  caminho: Caminho;
  fonte: FonteDaEscolha;
  versao: string;
  tamanho: number;
  /** Id do agente (AGENTES_COM_SUPERPODERES), para o registro de uso. */
  agente?: string;
};

/**
 * O sistema que vai ao provedor: o do agente, intacto, e o método no fim, fora
 * de qualquer teto que já existe. Sem método, byte a byte o mesmo sistema.
 */
export function juntarMetodoAoSistema(sistema: string, metodo: { texto: string } | null | undefined): string {
  const t = metodo && typeof metodo.texto === "string" ? metodo.texto.trim() : "";
  return t ? `${sistema}\n\n${t}` : sistema;
}

// ------------------------------------------------------------------ as 15 skills

export type SkillDoSuperpowers = {
  /** metodo: vira bloco nas mesas; processo: não entra em prompt; so_motor: só no motor de código. */
  estado: "metodo" | "processo" | "so_motor";
  /** Blocos sp_* que a adaptam nas mesas (vazio quando não entra em prompt). */
  blocos: string[];
  /** Liberada no motor de código (por tipo de trabalho) ou negada. */
  motor: "liberada" | "negada";
  /** Por que fica negada no motor (o mesmo texto de SKILLS_NEGADAS_NO_MOTOR do worker; o teste amarra os dois). */
  motivo_no_motor?: string;
  onde: string;
  como: string;
};

/** As 15 skills da v6.4.2 e o que cada uma virou (seção 6 do desenho). */
export const SKILLS_DO_SUPERPOWERS: Record<string, SkillDoSuperpowers> = {
  "using-superpowers": {
    estado: "metodo", blocos: ["sp_abertura"], motor: "liberada",
    onde: "todas as mesas; motor de código",
    como: "Nas mesas vira a abertura: checar o método antes de agir; a regra da casa vence. No motor, o original entra inteiro nas instruções.",
  },
  brainstorming: {
    estado: "metodo", blocos: ["sp_entender"], motor: "negada",
    motivo_no_motor: "o desenho do site já foi aprovado na Mesa Site (pacote.json); cada passada é uma seção, sem perguntas",
    onde: "conversas de todas as mesas; negada no motor",
    como: "Bloco [entender] com 3 variantes: uma pergunta por vez, 2 ou 3 caminhos, desenho em partes aprovadas e nada que o contexto do cliente já responde.",
  },
  "writing-plans": {
    estado: "metodo", blocos: ["sp_plano"], motor: "liberada",
    onde: "conversas com ação cara (Ads, Mês, Foto, Vídeos, Identidade, Site, Central); motor (construir)",
    como: "Bloco [plano]: passos com o que sai e como conferir, restrições do kit e do briefing, custo total e Confirmar.",
  },
  "executing-plans": {
    estado: "metodo", blocos: ["sp_plano"], motor: "negada",
    motivo_no_motor: "o plano da seção é curto e sai na mesma passada (writing-plans basta)",
    onde: "as mesmas do plano; negada no motor",
    como: "Parte de execução do [plano]: segue sem pedir licença entre passos, registra \"Decidi: o quê, porque\" e para nas 4 paradas.",
  },
  "subagent-driven-development": {
    estado: "metodo", blocos: ["sp_frentes"], motor: "negada",
    motivo_no_motor: "sem subagente (task negado): uma seção por passada, custo previsível",
    onde: "Conselho (especialistas e síntese); negada no motor",
    como: "Cada especialista do conselho recebe contexto construído, nunca o histórico; a síntese diz o que decidiu e o que não julgou. No motor, sem subagente.",
  },
  "dispatching-parallel-agents": {
    estado: "metodo", blocos: ["sp_frentes"], motor: "negada",
    motivo_no_motor: "sem subagente (task negado): uma seção por passada, custo previsível",
    onde: "Central, lançador, Workspace, agente do cliente e Conselho",
    como: "Bloco [frentes]: separa o pedido em frentes independentes e propõe a sequência em passos, ou leva ao conselho.",
  },
  "test-driven-development": {
    estado: "metodo", blocos: ["sp_aceite"], motor: "liberada",
    onde: "gerações de peça (Mês, Ads, Estúdio, Roteiros, Proposta, Identidade, Site, Motion, Documento); motor (construir e ajustar)",
    como: "Bloco [aceite]: de 3 a 5 checagens antes de produzir e a conferência depois; imagem só como aviso, sem laço.",
  },
  "systematic-debugging": {
    estado: "metodo", blocos: ["sp_causa"], motor: "liberada",
    onde: "todas as conversas quando o pedido diz que algo falhou; motor",
    como: "Bloco [causa]: causa antes do conserto, uma hipótese por vez e parada depois de 3 tentativas, sem laço em imagem.",
  },
  "verification-before-completion": {
    estado: "metodo", blocos: ["sp_prova"], motor: "liberada",
    onde: "todas as mesas, sempre; motor",
    como: "Bloco [prova], que nunca desliga, e a conferência no código: resposta que diz pronto sem ação feita ganha o aviso \"Ainda não fiz\".",
  },
  "requesting-code-review": {
    estado: "metodo", blocos: ["sp_revisor"], motor: "negada",
    motivo_no_motor: "o revisar não passa pelo modelo: o motor roda o build e as regras fixas de revisão",
    onde: "Proposta, Contratos, Identidade, Site, Publicidade, Campanhas e Conselho; negada no motor",
    como: "Bloco [revisor]: autorrevisão contra o briefing e o kit, crítico, importante e menor, e o que não julgou.",
  },
  "receiving-code-review": {
    estado: "metodo", blocos: ["sp_receber"], motor: "liberada",
    onde: "conversas com ajuste ou reprovação; motor (ajustar)",
    como: "Bloco [receber]: repete o que entendeu, confere, sem bajulação, e aponta conflito com briefing, kit ou regra do dono.",
  },
  "writing-skills": {
    estado: "processo", blocos: [], motor: "negada",
    motivo_no_motor: "não é trabalho de site",
    onde: "evolução dos blocos (todas as mesas, pelo admin)",
    como: "Não entra em prompt. Bloco só muda com caso real que falhou, bloco novo e teste de controle.",
  },
  "diagnosing-superpowers": {
    estado: "processo", blocos: [], motor: "negada",
    motivo_no_motor: "não é trabalho de site",
    onde: "Configurações, Superpoderes (auditoria)",
    como: "Não entra em prompt. O uso de cada método e as provas que faltaram aparecem nas Configurações.",
  },
  "using-git-worktrees": {
    estado: "so_motor", blocos: [], motor: "negada",
    motivo_no_motor: "o motor já isola uma pasta e um git por site",
    onde: "só o motor, e negada",
    como: "O motor já isola uma pasta e um git por site. Fica no pacote porque a instalação é completa, mas bloqueada.",
  },
  "finishing-a-development-branch": {
    estado: "so_motor", blocos: [], motor: "negada",
    motivo_no_motor: "quem integra e publica é o painel, com Confirmar",
    onde: "só o motor, e negada",
    como: "Quem integra e publica é o painel, com Confirmar. Fica no pacote, bloqueada.",
  },
};

/**
 * Skills liberadas no motor de código por tipo de trabalho (o resto fica
 * negado). Só construir e ajustar passam pelo modelo; o revisar é máquina
 * (build e regras fixas), então não libera nada. É o mesmo que
 * SKILLS_POR_TRABALHO do worker (workers/motor-codigo/lib/config-opencode.ts);
 * o teste de integração amarra os dois.
 */
export const SKILLS_LIBERADAS_NO_MOTOR: Record<"construir" | "ajustar", string[]> = {
  construir: ["using-superpowers", "writing-plans", "test-driven-development", "systematic-debugging", "verification-before-completion"],
  ajustar: ["using-superpowers", "receiving-code-review", "systematic-debugging", "test-driven-development", "verification-before-completion"],
};
