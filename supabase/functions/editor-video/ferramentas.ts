/**
 * Núcleo PURO da função editor-video (frente V-B, 26/09): o que a tela e a
 * função precisam concordar, sem Deno e sem banco (a tela importa daqui, como
 * faz com _shared/projeto-de-edicao.ts).
 *
 * 1. Agente editor: laço de ferramentas no padrão dos agentes de código
 *    abertos (Claude Code, Codex CLI): o modelo planeja, pede ferramentas
 *    tipadas, a TELA executa (as operações são funções puras da linha do tempo)
 *    e devolve o resultado; o modelo confere e segue ou termina. Travas: no
 *    máximo MAX_PASSOS chamadas ao modelo e MAX_FERRAMENTAS ferramentas por
 *    pedido, teto de custo por sessão. AG2 (29/09): ordem clara (Jev) é
 *    aplicada na hora como UM passo do desfazer, com a lista do que mudou e o
 *    Desfazer; o resto (dúvida, falha no caminho, Parar) pede Confirmar; o
 *    exportar é sempre um cartão com Confirmar.
 * 2. Timestamp: preço, partes do áudio e o deslocamento de tempo de cada parte
 *    (determinístico: palavra da parte n ganha exatamente o início da parte).
 * 3. Visão: o que o modelo viu só vale nos tempos dos quadros que ele recebeu.
 */

/**
 * 02/10 (dono: "o agente é limitado, para no meio"): a edição inteira com
 * conferência pede mais passos. O teto de custo do pedido continua valendo.
 */
export const MAX_PASSOS = 10;
export const MAX_FERRAMENTAS = 30;
export const TETO_PADRAO_USD = 0.5;
export const TETO_MAXIMO_USD = 5;
export const MAX_QUADROS_POR_CHAMADA = 12;
export const MAX_QUADROS_POR_FONTE = 48;
export const MAX_BYTES_DO_QUADRO = 200_000;
export const MAX_TEXTO_DO_PEDIDO = 1500;
export const MAX_CONTEXTO_CHARS = 60_000;

// ------------------------------------------------------------------ ferramentas do agente

export interface DefinicaoDeFerramenta {
  nome: string;
  descricao: string;
  /** Argumentos em texto (vai no prompt; o modelo devolve argumentos_json). */
  argumentos: string;
  /** Só lê (não muda o projeto). */
  leitura: boolean;
}

export const FERRAMENTAS_DO_AGENTE: DefinicaoDeFerramenta[] = [
  { nome: "ler_projeto", descricao: "Lista trilhas e clipes com apelidos (c1, c2) e tempos exatos.", argumentos: "{}", leitura: true },
  { nome: "ler_fala", descricao: "Palavras ditas num trecho da linha do tempo, com tempo.", argumentos: '{"de_s": number, "ate_s": number}', leitura: true },
  { nome: "ler_visao", descricao: "O que aparece num trecho (descrição por trecho já vista). Só isso vale como imagem.", argumentos: '{"de_s": number, "ate_s": number}', leitura: true },
  { nome: "dividir", descricao: "Divide um clipe num ponto da linha do tempo.", argumentos: '{"clipe": "c3", "em_s": number}', leitura: false },
  { nome: "aparar", descricao: "Move o início ou o fim de um clipe para um tempo da linha.", argumentos: '{"clipe": "c3", "lado": "inicio"|"fim", "tempo_s": number}', leitura: false },
  { nome: "mover", descricao: "Muda onde o clipe começa na linha do tempo (e, com trilha, leva para outra trilha compatível).", argumentos: '{"clipe": "c3", "inicio_s": number, "trilha"?: "video-2"}', leitura: false },
  { nome: "remover", descricao: "Tira um clipe ou vários de uma vez (clipes); com ondular, o resto encosta.", argumentos: '{"clipe"?: "c3", "clipes"?: ["c3", "c5"], "ondular": boolean}', leitura: false },
  // 02/10 (dono: "pedi para tirar os takes duplicados e ele não mexeu em nada"): regra fixa, sem o modelo escolher à mão.
  { nome: "remover_duplicados", descricao: "Acha e tira os takes repetidos da trilha de vídeo (mesma mídia e mesmo trecho; fica o primeiro). Regra fixa do código.", argumentos: '{"ondular"?: boolean}', leitura: false },
  { nome: "buscar", descricao: "Filtra a Mídia e a linha do tempo NA TELA do dono e devolve o que bate: clipes (c1...) e mídias (m1...). tipo: video, imagem, audio; origem: bruto, gerado, acervo; uso: usado, sem_uso; duracao: curta (até 5 s), media, longa (mais de 30 s); duplicados: só os repetidos.", argumentos: '{"texto"?: string, "tipo"?: string, "origem"?: string, "uso"?: string, "duracao"?: string, "duplicados"?: boolean}', leitura: true },
  { nome: "inserir_midia", descricao: "Põe uma mídia (m1... de buscar) na linha do tempo: no fim, no cursor ou depois de um clipe.", argumentos: '{"midia": "m3", "onde": "fim"|"cursor"|"depois", "depois_de"?: "c2"}', leitura: false },
  { nome: "recortar", descricao: "Tira um trecho da FONTE de um clipe (tempos da fonte).", argumentos: '{"clipe": "c3", "de_s": number, "ate_s": number}', leitura: false },
  { nome: "ajustar", descricao: "Muda velocidade (0.25 a 4), volume (0 a 2), zoom {de, para} ou nota de um clipe.", argumentos: '{"clipe": "c3", "velocidade"?: number, "volume"?: number, "zoom"?: {"de": number, "para": number} | null, "nota"?: string}', leitura: false },
  { nome: "inserir_texto", descricao: "Texto na tela (trilha texto) num trecho. estilo: simples, titulo, manchete (gancho), tarja, marca_texto, balao, vidro, chamada (botão), nome (\"Nome | cargo\").", argumentos: '{"inicio_s": number, "duracao_s": number, "texto": string, "estilo"?: string}', leitura: false },
  { nome: "reordenar", descricao: "Nova ordem da trilha de vídeo, com todos os apelidos dela.", argumentos: '{"ordem": ["c2", "c1", "c3"]}', leitura: false },
  { nome: "fechar_buracos", descricao: "Encosta os clipes da trilha de vídeo.", argumentos: "{}", leitura: false },
  // AG2 (29/09): música e trilhas. Volume de música/voz é por clipe (ajustar volume); tirar o som ou esconder é da trilha.
  { nome: "trilha", descricao: "Tira o som (muda) ou esconde (oculta) uma trilha inteira, pelo id da trilha em ler_projeto (ex.: audio-1).", argumentos: '{"trilha": "audio-1", "muda"?: boolean, "oculta"?: boolean}', leitura: false },
  {
    nome: "aplicar_skill",
    descricao: "Roda uma skill determinística: brabo, cortar_silencios, cortar_pela_onda, ficar_com_melhor_tomada, legendas, punch_in, zoom_nos_momentos, reenquadrar, cor, organizar_por_roteiro, antes_depois, fechar_buracos, transicoes_suaves, efeitos_sonoros, remover_duplicados.",
    argumentos: '{"skill": string, "parametros"?: object, "selecionados"?: ["c1", "c2"]}',
    leitura: false,
  },
  // Exportar nunca roda sozinho: a tela mostra um cartão com Confirmar (Renderizar pela fila ou baixar o ZIP).
  { nome: "exportar", descricao: "Cartão para o dono renderizar o vídeo inteiro pela fila (ou baixar o ZIP). Vira um cartão com Confirmar; não muda a linha do tempo.", argumentos: "{}", leitura: true },
  // Frente EDT (30/09): corte de verdade, som, motion, amostra e geração.
  { nome: "renderizar", descricao: "O mesmo cartão do exportar: o render do vídeo inteiro vai para a fila com o Confirmar do dono.", argumentos: "{}", leitura: true },
  { nome: "medir_onda", descricao: "Pede ao worker a onda do áudio das fontes sem onda (sem custo, uns 30 s). Base do cortar_pela_onda.", argumentos: "{}", leitura: true },
  { nome: "ler_onda", descricao: "Limiar, chão de ruído e pausas medidas de uma fonte (ou de todas).", argumentos: '{"fonte"?: string}', leitura: true },
  { nome: "cortar_pela_onda", descricao: "Tira toda pausa acima de 0,25 s pela onda medida e deixa 0,12 s na emenda. Nenhuma palavra sai. Sem onda medida: chame medir_onda.", argumentos: '{"pausa_max_s"?: number, "emenda_s"?: number}', leitura: false },
  { nome: "ficar_com_melhor_tomada", descricao: "Tira falsos começos, frases repetidas e gagueira; fica a última tomada inteira. A lista do que saiu vai no cartão.", argumentos: '{"pausa_s"?: number}', leitura: false },
  { nome: "conferir_corte", descricao: "Confere o corte: respiros acima de 0,25 s, palavra mordida, repetição, clipe curto. Só AVISO: não corrija em laço, conte ao dono.", argumentos: "{}", leitura: true },
  { nome: "legendar", descricao: "Legenda a fala em blocos de N palavras (padrão 3; o dono pode pedir 1 a 8), com a cor da marca. Estilos: destaque, caixa, caixa_palavra, impacto, gigante, pulso, fita, papelaria, discreta, simples. posicao auto desvia do rosto.", argumentos: '{"palavras_por_vez"?: number, "estilo"?: string, "posicao"?: "auto"|"topo"|"meio"|"base"}', leitura: false },
  // Frente EDT, rodada 2: editor completo.
  { nome: "formato", descricao: "Reenquadra o vídeo inteiro (9:16, 1:1, 4:5, 16:9); o recorte segue o rosto rastreado (sem rastro: o centro).", argumentos: '{"formato": "9:16"|"1:1"|"4:5"|"16:9", "seguir_rosto"?: boolean}', leitura: false },
  { nome: "cor", descricao: "Cor do vídeo inteiro: look (natural, vivo, quente, frio, cinema, suave, vintage, noite, pb), intensidade 0 a 1 e ajustes de -1 a 1.", argumentos: '{"look"?: string, "intensidade"?: number, "exposicao"?: number, "contraste"?: number, "saturacao"?: number, "temperatura"?: number, "vinheta"?: number}', leitura: false },
  { nome: "zoom_momentos", descricao: "Zoom e punch-in nas frases fortes (a força de cada frase é julgada pelo Jev), na camada Câmera e cor.", argumentos: '{"intensidade"?: "suave"|"media"|"forte"}', leitura: false },
  { nome: "efeito", descricao: "Efeito de câmera num trecho da linha: zoom (modo punch, empurrao ou recuo; escala 1 a 2), tremor, flash, desfoque ou cor do trecho (look).", argumentos: '{"efeito": "zoom"|"tremor"|"flash"|"desfoque"|"cor", "inicio_s": number, "duracao_s": number, "escala"?: number, "modo"?: string, "look"?: string}', leitura: false },
  { nome: "capitulos", descricao: "Marca os capítulos na régua (o Jev acha onde o assunto muda; o título é um trecho dito).", argumentos: "{}", leitura: false },
  { nome: "animar", descricao: "Põe uma peça de motion na palavra DITA (o tempo sai da fala medida). Peças: rotulo, carimbo, lista, passos, contador, notificacao, polaroide, cartao_final, lettering, barra, preco, comentario, selo. Número, preço e porcentagem só se foram ditos.", argumentos: '{"peca": string, "palavra_ref"?: string, "inicio_s"?: number, "duracao_s"?: number, "params": object}', leitura: false },
  { nome: "sugerir_animacoes", descricao: "Acha na fala os momentos que pedem animação e escolhe a peça de cada um (julgamento pelo Jev). Põe as peças na linha do tempo.", argumentos: '{"densidade"?: "poucas"|"medias"}', leitura: false },
  { nome: "sons", descricao: "Efeitos sonoros CC0 no pico de cada animação (0,65 s entre eles). Refaz os que já estavam.", argumentos: '{"modo"?: "casados"|"poucos"}', leitura: false },
  { nome: "musica", descricao: "Põe uma música como trilha do vídeo inteiro, 22 dB abaixo da voz (medida no render), subindo nas pausas (ducking); o render sai em -14 LUFS. fonte: a chave da música no projeto ou o m3 da Mídia (acervo do cliente).", argumentos: '{"fonte": string, "abaixo_da_voz_db"?: number}', leitura: false },
  { nome: "logo", descricao: "Logo do cliente (do kit da marca) acompanhando: canto (o vídeo todo), cartao_final ou sting (abertura).", argumentos: '{"onde": "canto"|"cartao_final"|"sting"}', leitura: false },
  { nome: "cartao_final", descricao: "Cartão final nos últimos 3,5 s com a chamada e a logo do cliente.", argumentos: '{"titulo": string, "botao"?: string}', leitura: false },
  { nome: "amostra", descricao: "Renderiza uma amostra de 8 a 15 s no worker (sem custo) para o dono conferir antes do vídeo inteiro.", argumentos: '{"inicio_s": number, "fim_s": number}', leitura: true },
  { nome: "gerar_broll", descricao: "B-roll gerado (Mesa Vídeos) para cobrir um trecho. PAGO: vira cartão com o custo antes e o Confirmar do dono.", argumentos: '{"de_s": number, "ate_s": number, "prompt": string, "motor"?: string}', leitura: true },
  { nome: "gerar_elemento", descricao: "Ícone ou objeto gerado com fundo transparente, por cima do vídeo num trecho. PAGO: cartão com o custo antes e Confirmar.", argumentos: '{"tipo": "icone"|"objeto", "prompt": string, "inicio_s": number, "duracao_s"?: number}', leitura: true },
  // 02/10 (dono: "o agente não edita de verdade, só o básico, não usa o motor nem as skills"): tudo o que a tela faz.
  { nome: "entender_video", descricao: "Entendimento do vídeo feito pelo código: seções, pausas, ênfases, dados ditos (número, preço, lista), perguntas, rosto e o que já está montado.", argumentos: "{}", leitura: true },
  {
    nome: "edicao_completa",
    descricao:
      'EDIT IA PRO: o motor de edição inteiro de uma vez (corte limpo sem picote, ritmo variado entre palavras, câmera com motivo nas ênfases, motion graphics na letra e nas cores da marca: gancho, palavra em destaque, lista, nome e chamada; legenda, B-roll do acervo, transições, cor, música abaixo da voz com ducking, sons e cartão final) e confere o engajamento. O pedido do dono vai junto e é lei (sem legenda = zero legenda). receita: dinamico (padrão de talking head, inclusive de profissão séria), anuncio, aula, depoimento, podcast, institucional (estas três só se o dono pedir esse tom). plano muda peças, ex.: {"legenda": {"estilo": "impacto", "palavras": 2}, "cor": {"look": "quente"}, "textos": {"gancho": "frase dita"}, "broll": {"ligado": false}, "formato": "9:16"}. musica: m3 da Mídia, nome ou "nenhuma".',
    argumentos: '{"receita"?: string, "plano"?: object, "ritmo"?: boolean, "batida_s"?: number, "musica"?: string, "quem_fala"?: "Nome | cargo"}',
    leitura: false,
  },
  { nome: "aplicar_referencia", descricao: "Copia a edição de um vídeo de referência do painel Referências (ritmo de corte, zoom, legenda, cor). referencia: r1, r2 (lista no contexto) ou o nome. fidelidade: identica, proxima, inspirada ou criativa.", argumentos: '{"referencia"?: string, "fidelidade"?: string}', leitura: false },
  { nome: "editar_clipe", descricao: "Edita um clipe de texto, legenda, cena ou peça de motion: texto, estilo (preset de texto ou de legenda), params da peça (só os que mudam; o código confere), fundo da cena (#hex) e duracao_s.", argumentos: '{"clipe": "c9", "texto"?: string, "estilo"?: string, "params"?: object, "fundo"?: string, "duracao_s"?: number}', leitura: false },
  { nome: "transicao", descricao: 'Transição num clipe ou em todos da trilha de vídeo (clipe "todos"). tipo: corte (tira), fade, dissolver, whip, flash, desfoque, zoom, deslizar.', argumentos: '{"clipe": "c3"|"todos", "tipo": string, "lado"?: "entrada"|"saida"|"ambos", "duracao_s"?: number}', leitura: false },
  { nome: "mixagem", descricao: "Mixagem do render: música abaixo da voz (12 a 36 dB), subida nas pausas (0 a 12 dB), ducking e o volume final (-23 a -9 LUFS).", argumentos: '{"abaixo_da_voz_db"?: number, "subida_nas_pausas_db"?: number, "duck"?: boolean, "lufs_alvo"?: number}', leitura: false },
  { nome: "cena", descricao: 'Cena do zero na trilha de vídeo: fundo liso ou degradê (#hex ou "marca"), com título e peça de motion opcionais. Para começar um vídeo sem gravação, abrir ou fechar com arte. Sem inicio_s: no fim.', argumentos: '{"duracao_s": number, "inicio_s"?: number, "fundo"?: string, "fundo2"?: string, "titulo"?: string, "estilo"?: string, "peca"?: string, "params"?: object}', leitura: false },
  { nome: "trocar_cenario", descricao: "Abre o painel Trocar cenário com o clipe escolhido e o cenário escrito. PAGO: o painel mostra a amostra e o custo antes, e o dono gera.", argumentos: '{"clipe": "c2", "cenario": string}', leitura: true },
  { nome: "abrir_painel", descricao: "Abre um painel do editor para o dono: timestamp (marcar a fala), formato (rastrear o rosto), gerar (câmera, continuar, transição), referencias, cor (LUT), som, motion, textos, exportar, cenario, capitulos, midia.", argumentos: '{"painel": string}', leitura: true },
  { nome: "pesquisar", descricao: "Pesquisa na web (fatos, dados, ideias visuais) e devolve as fontes. Conta no teto do pedido. Só quando o dono pedir pesquisa ou um dado que a fala não tem; número sem fonte nunca vai para a tela.", argumentos: '{"pergunta": string}', leitura: true },
];

/** 02/10: ferramentas que abrem um painel na tela do dono (não mudam a linha do tempo; o pago tem custo antes no painel). */
export const FERRAMENTAS_DE_PAINEL = ["trocar_cenario", "abrir_painel"];
/** Painéis que o agente pode abrir (mesmos ids das abas do editor). */
export const PAINEIS_DO_EDITOR = ["ia", "midia", "corte", "textos", "motion", "zoom", "cor", "formato", "som", "capitulos", "exportar", "gerar", "cenario", "timestamp", "referencias", "skills"];

/** Ferramenta que não muda a linha do tempo, mas sai da tela (vira cartão com Confirmar). */
export const FERRAMENTAS_DE_SAIDA = ["exportar", "renderizar", "gerar_broll", "gerar_elemento"];

/** Frente EDT: ferramentas que a tela roda chamando o servidor (sem custo para o cliente) dentro do laço. */
export const FERRAMENTAS_DO_SERVIDOR = ["sugerir_animacoes", "medir_onda", "amostra", "zoom_momentos", "capitulos", "edicao_completa", "pesquisar"];

export const NOMES_DAS_FERRAMENTAS = FERRAMENTAS_DO_AGENTE.map((f) => f.nome);

export interface ChamadaDeFerramenta {
  ferramenta: string;
  argumentos: Record<string, unknown>;
}

export interface RespostaDoPasso {
  plano: string;
  chamadas: ChamadaDeFerramenta[];
  resposta: string;
  terminou: boolean;
  /** Chamadas cortadas pelo limite ou recusadas (nome desconhecido, JSON quebrado). */
  recusadas: string[];
  /** AG2: quando a resposta é UMA pergunta curta, as respostas possíveis (a tela vira botões). */
  opcoes?: string[];
}

export const MAX_OPCOES_DA_PERGUNTA = 4;

/** Esquema da resposta do modelo (estrito: argumentos vão como texto JSON). */
export const ESQUEMA_DO_PASSO = {
  nome: "passo_do_editor",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["plano", "chamadas", "resposta", "terminou", "opcoes"],
    properties: {
      opcoes: { type: "array", items: { type: "string" } },
      plano: { type: "string" },
      chamadas: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["ferramenta", "argumentos_json"],
          properties: { ferramenta: { type: "string", enum: NOMES_DAS_FERRAMENTAS }, argumentos_json: { type: "string" } },
        },
      },
      resposta: { type: "string" },
      terminou: { type: "boolean" },
    },
  },
};

/** Lê e confere a resposta do modelo; corta no que ainda cabe de ferramentas. */
export function lerPasso(bruto: unknown, cabem: number): RespostaDoPasso {
  const o = bruto && typeof bruto === "object" ? (bruto as Record<string, unknown>) : {};
  const recusadas: string[] = [];
  const chamadas: ChamadaDeFerramenta[] = [];
  (Array.isArray(o.chamadas) ? o.chamadas : []).forEach((c) => {
    const x = c && typeof c === "object" ? (c as Record<string, unknown>) : {};
    const nome = String(x.ferramenta || "");
    if (NOMES_DAS_FERRAMENTAS.indexOf(nome) < 0) {
      recusadas.push(`${nome || "sem nome"}: ferramenta desconhecida`);
      return;
    }
    let argumentos: Record<string, unknown> = {};
    const bruta = x.argumentos_json !== undefined ? x.argumentos_json : x.argumentos;
    if (typeof bruta === "string") {
      try {
        const j = bruta.trim() ? JSON.parse(bruta) : {};
        argumentos = j && typeof j === "object" && !Array.isArray(j) ? (j as Record<string, unknown>) : {};
      } catch {
        recusadas.push(`${nome}: argumentos não são JSON`);
        return;
      }
    } else if (bruta && typeof bruta === "object") argumentos = bruta as Record<string, unknown>;
    if (chamadas.length >= cabem) {
      recusadas.push(`${nome}: passou do limite de ferramentas`);
      return;
    }
    chamadas.push({ ferramenta: nome, argumentos });
  });
  const opcoes = (Array.isArray(o.opcoes) ? o.opcoes : [])
    .map((x) => String(x == null ? "" : x).replace(/\s+/g, " ").trim().slice(0, 80))
    .filter((x, i, l) => !!x && l.indexOf(x) === i)
    .slice(0, MAX_OPCOES_DA_PERGUNTA);
  return {
    plano: String(o.plano || "").slice(0, 1200),
    chamadas,
    resposta: String(o.resposta || "").slice(0, 2000),
    terminou: o.terminou === true || chamadas.length === 0,
    recusadas,
    // Opções só valem numa pergunta que termina o pedido (sem ferramenta junto).
    opcoes: chamadas.length ? [] : opcoes,
  };
}

/**
 * Pode aplicar na hora (sem Confirmar)? Regra 6 do contrato comum, do jeito do
 * editor: tudo o que o agente muda na linha do tempo é UM passo do desfazer
 * (um Desfazer volta o pedido inteiro), sem custo. Vai direto quando a ordem é
 * clara (Jev) e nada deu errado no caminho; senão, cartão com Confirmar.
 */
export function podeAplicarDireto(r: { operacoes: number; falhas: number; recusadas: number; parado: boolean; ordemClara: boolean }): { direto: boolean; motivo: string } {
  if (!r.operacoes) return { direto: false, motivo: "nada para mudar" };
  if (r.parado) return { direto: false, motivo: "parado no meio" };
  // 02/10: ferramenta que falhou não mudou nada (cada uma entra inteira ou não entra); o que entrou vale e a
  // falha vai dita na mensagem. Antes uma falha no caminho jogava a edição inteira para o Confirmar.
  if (r.recusadas) return { direto: false, motivo: "algo não deu no caminho" };
  if (!r.ordemClara) return { direto: false, motivo: "o pedido não é uma ordem clara" };
  return { direto: true, motivo: "ordem clara, sem custo e com Desfazer" };
}

/** Resposta que promete ("vou cortar") sem ter mudado nada. */
export function respostaPromete(texto: string): boolean {
  return /\b(vou|irei|vamos) (fazer|cortar|editar|aplicar|legendar|gerar|preparar|reordenar|exportar|tirar|ajustar|montar|deixar)\b/i.test(String(texto || ""));
}

/** 02/10: resposta que AFIRMA ter mudado algo ("cortei", "pus a música"). Só vale se o código conferiu a mudança. */
export function respostaAfirma(texto: string): boolean {
  return /\b(fiz|cortei|apliquei|legendei|coloquei|pus|adicionei|inseri|tirei|removi|ajustei|mudei|deixei|montei|editei|gerei|exportei|renderizei|troquei|acrescentei|animei)\b/i.test(String(texto || ""));
}

export interface LimitesDoPedido {
  passo: number;
  ferramentasUsadas: number;
  gastoUsd: number;
  tetoUsd: number;
}

/** Motivo para parar antes de chamar o modelo de novo (null = pode seguir). */
export function motivoParaParar(l: LimitesDoPedido): string | null {
  if (l.passo > MAX_PASSOS) return `Chegou ao limite de ${MAX_PASSOS} passos neste pedido.`;
  if (l.ferramentasUsadas >= MAX_FERRAMENTAS) return `Chegou ao limite de ${MAX_FERRAMENTAS} ferramentas neste pedido.`;
  if (l.gastoUsd >= l.tetoUsd) return `Chegou ao teto de US$ ${l.tetoUsd.toFixed(2)} deste pedido.`;
  return null;
}

export const tetoValido = (v: unknown): number => {
  const n = Number(v);
  return isFinite(n) && n > 0 ? Math.min(TETO_MAXIMO_USD, Math.round(n * 100) / 100) : TETO_PADRAO_USD;
};

export function sistemaDoAgente(): string {
  return [
    "Você é o agente editor de vídeo da Aceleriq, dentro de um editor com linha do tempo.",
    "Você edita SÓ com as ferramentas abaixo. Quem mexe nos tempos é o código; você escolhe e parametriza.",
    "O pedido do dono é lei: o que ele pediu para NÃO ter (sem legenda, sem música, sem zoom, só cortes) não entra, e a ferramenta proibida volta recusada. Diga no fim o que não fez por causa do pedido.",
    "Engajamento sempre: o estilo é para prender e reter, nunca pelo setor ou profissão do cliente (advogado, médico ou contador ganham edição tão viva quanto a de um criador). Gancho nos 2 primeiros segundos, nada parado mais de 4 s, ritmo que varia, motion na palavra-chave, chamada no fim. A marca (letra, cores, logo) é respeitada; regra de conteúdo vale (sem promessa que não foi dita), timidez visual não.",
    "Ofício (video-use): corte só em fronteira de palavra com respiro de 80 a 120 ms; pausa abaixo de 0,35 s fica (respiração natural); nenhum plano abaixo de 0,8 s; punch-in com motivo (ênfase, número, pergunta), nunca alternado no automático; a peça chega NA palavra dita; uma coisa nova por vez na tela; nada cobre o rosto.",
    "Regras: fale português do Brasil, frases curtas, sem travessão. Clipes são citados SÓ por apelido (c1, c2); nunca invente id.",
    "Use tempos exatos que você leu (ler_projeto, ler_fala). Sobre imagem, só afirme o que está em ler_visao, citando o tempo. Não viu: diga que não viu.",
    "Planeje, chame as ferramentas, confira o resultado que volta (linha \"Conferido\", feita pelo código) e siga até o pedido estar feito. Prefira o motor ou uma skill determinística quando eles fazem o pedido inteiro.",
    "Pedido de editar (editar, edição completa, dinâmica, Brabo, deixar dinâmico, cortar, legendar) só termina depois de ferramentas que MUDAM o projeto. Nunca responda só com texto nem diga que abriu algo: edite.",
    "Edição dinâmica ou completa = edicao_completa (EDIT IA PRO: corte, ritmo do Brabo, legenda, zoom, motion, B-roll, música com ducking, cor, cartão final), receita dinamico para pessoa falando para a câmera. Só o ritmo do Brabo (corte limpo, planos variados e câmera com motivo) = aplicar_skill brabo. Silêncios = cortar_silencios. Legenda = legendas. Ganchos = punch_in. Sem fala marcada as skills ainda rodam (tempo exato); avise.",
    "Depois da edicao_completa, cumpra o que o dono pediu a mais (texto, peça, cor, efeito num trecho) com as outras ferramentas. Use o Entendimento do vídeo: ênfase = efeito zoom ou animar lettering; dado dito = animar contador, barra, preco, lista ou passos com palavra_ref; troca de seção = transicao ou capitulos; pergunta = inserir_texto manchete.",
    "Referência (copiar a edição de um vídeo) = aplicar_referencia. Editar texto, legenda ou peça já na linha = editar_clipe. Do zero (sem gravação) = cena, inserir_texto, animar com inicio_s, inserir_midia, gerar_broll e musica. Trocar o cenário = trocar_cenario (pago, o painel mostra o custo). Pesquisa ou dado de fora = pesquisar (cite a fonte; sem fonte não vai para a tela).",
    "Não descreva na resposta o que fez: a tela mostra o que mudou, contado pelo código. Use resposta só para uma pergunta, para o que faltou ou para o próximo passo sugerido.",
    "Tirar, apagar ou excluir = remover (vários de uma vez em clipes; ondular true encosta o resto). Takes, vídeos ou clipes repetidos ou duplicados = remover_duplicados (o código acha; não escolha à mão). Vãos = fechar_buracos. Achar, mostrar ou filtrar = buscar (muda o filtro na tela do dono). Pôr mídia = inserir_midia com o m1, m2 que buscar devolveu.",
    "Os apelidos ficam FIXOS até o fim do pedido: o clipe que saiu não volta e clipe novo ganha número novo. Ordem do dono (remova, apague, tira, corta, pode fazer) se cumpre com as ferramentas no mesmo passo, sem perguntar de novo.",
    "Reordenar = reordenar com TODOS os apelidos da trilha de vídeo. Música: volume por clipe (ajustar volume), tirar o som da trilha inteira (trilha muda). Exportar ou renderizar = exportar (vira um cartão com Confirmar; nunca diga que já exportou).",
    "Corte de verdade: tirar pausas/respiros = cortar_pela_onda (sem onda: medir_onda e avise que volta em ~30 s); erros, repetição e falso começo = ficar_com_melhor_tomada; depois de cortar, conferir_corte e CONTE o resultado (é aviso, não refaça em laço).",
    "Legenda padrão: 3 palavras por vez (legendar); o dono muda a quantidade. Animação na palavra dita = animar; momentos pela fala = sugerir_animacoes; som = sons (depois das animações); música = musica; marca = logo e cartao_final.",
    "Editor completo: formato (9:16, 1:1, 16:9) = formato; cor ou look = cor (LUT do arquivo: abrir_painel cor); momentos fortes = zoom_momentos; tremor, flash, desfoque ou zoom num trecho = efeito; título, gancho, chamada e nome na tela = inserir_texto com estilo; capítulos = capitulos; transição = transicao; volume da música e LUFS = mixagem. A edição inteira de uma vez = edicao_completa (você mesmo roda; não mande o dono para o painel).",
    "Amostra (8 a 15 s) antes do vídeo inteiro quando o dono quer conferir o estilo. B-roll e elementos gerados são PAGOS: só gerar_broll/gerar_elemento (cartão com custo); nunca diga que gerou.",
    "\"Esse\", \"este corte\", \"o selecionado\" = os clipes em \"Selecionados na tela\"; \"aqui\" = o cursor. \"O segundo clipe\" conta na ordem da trilha de vídeo. \"Todos\" = todos os da trilha de vídeo.",
    "Dúvida real (não dá para saber qual clipe, qual trecho ou o que o dono quer): não mude nada; termine com UMA pergunta curta em resposta e até 4 respostas curtas em opcoes (ex.: [\"c2\", \"c3\"]). Sem dúvida, opcoes vazio.",
    "Nunca prometa (\"vou cortar\"): ou chama a ferramenta agora, ou pergunta. Nunca cite clipe, trecho ou fala que não está no projeto.",
    `Limites: até ${MAX_PASSOS} passos e ${MAX_FERRAMENTAS} ferramentas por pedido. Ordem clara é aplicada na hora, com Desfazer; o resto vai para o dono confirmar.`,
    "Responda sempre no JSON pedido: plano (uma frase), chamadas (ferramenta + argumentos_json), resposta (pergunta, o que falta ou o próximo passo, curto; nunca \"fiz\" ou \"apliquei\": quem conta o que mudou é o código), terminou e opcoes.",
    "Ferramentas:",
    ...FERRAMENTAS_DO_AGENTE.map((f) => `- ${f.nome} ${f.argumentos}: ${f.descricao}`),
  ].join("\n");
}

// ------------------------------------------------------------------ pesquisa do agente (02/10)

export const MAX_PERGUNTA_DA_PESQUISA = 600;

/** Sistema da pesquisa na web do agente editor: fatos e ideias com fonte, curto. */
export function sistemaDaPesquisa(): string {
  return [
    "Você pesquisa na web para o editor de vídeo da Aceleriq (fatos, dados, referências visuais, ideias de arte e B-roll).",
    "Português do Brasil, frases curtas, sem travessão. Até 8 linhas.",
    "Todo número, lei, data ou nome vem com a fonte. O que não achou, diga que não achou; não invente.",
  ].join("\n");
}

// ------------------------------------------------------------------ conversa (AG2): o que vem da tela, conferido

/** Item que "essa", "o segundo" e "todos" apontam (mesma forma de _shared/conversa-das-mesas.ts). */
export interface ItemDaTela {
  ref: string;
  titulo: string;
  detalhe?: string | null;
}

/** Referência do pedido (mesma forma de _shared/conversa-das-mesas.ts). */
export interface ReferenciaDaTela {
  refs: string[];
  alcance: "um" | "todas";
  probabilidade: number;
  incerta: boolean;
  fonte: "jev";
}

export const MAX_CONVERSA_CHARS = 4000;
export const APELIDO_DE_CLIPE = /^c\d{1,4}$/;
const MAX_ITENS_DA_REFERENCIA = 60;

/** Clipes da trilha de vídeo na ordem da tela, com apelido (nunca id): o que "o segundo", "esse" e "todos" apontam. */
export function itensDoCorpo(v: unknown): ItemDaTela[] {
  if (!Array.isArray(v)) return [];
  const vistos = new Set<string>();
  const saida: ItemDaTela[] = [];
  v.slice(0, MAX_ITENS_DA_REFERENCIA).forEach((x) => {
    const o = x && typeof x === "object" ? (x as Record<string, unknown>) : {};
    const ref = String(o.ref || "").trim();
    if (!APELIDO_DE_CLIPE.test(ref) || vistos.has(ref)) return;
    vistos.add(ref);
    saida.push({ ref, titulo: String(o.titulo || "Clipe").replace(/\s+/g, " ").slice(0, 120), detalhe: o.detalhe ? String(o.detalhe).slice(0, 120) : null });
  });
  return saida;
}

/** A referência que o passo 1 achou e a tela devolve nos passos seguintes: só apelidos que estão nos itens. */
export function referenciaDoCorpo(v: unknown, itens: ItemDaTela[]): ReferenciaDaTela | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const refs = (Array.isArray(o.refs) ? o.refs : []).map((x) => String(x || "")).filter((r) => itens.some((i) => i.ref === r));
  if (!refs.length) return null;
  const p = Number(o.probabilidade);
  return { refs, alcance: o.alcance === "todas" ? "todas" : "um", probabilidade: isFinite(p) ? p : 0, incerta: o.incerta === true, fonte: "jev" };
}


/**
 * Sistema de um passo (AG2): o do agente (com o mapa do painel), as regras que
 * a equipe ensinou (EVITAR primeiro, em todo passo) e a referência do pedido
 * ("essa", "o segundo", "todos"), quando há.
 */
export function sistemaDoPasso(base: string, blocoDasRegras: string, blocoDaReferencia: string): string {
  return [base, String(blocoDasRegras || "").trim(), String(blocoDaReferencia || "").trim()].filter(Boolean).join("\n\n");
}

export const ANEXOS_ACEITOS = ["log_do_editor", "acao_agente", "aprendizado_do_agente", "regras_seguidas", "pergunta_do_editor", "padrao_do_editor"];
export const MAX_BYTES_DOS_ANEXOS = 400_000;

/** Só os anexos que a tela do editor sabe mostrar, e com teto de tamanho. */
export function anexosDoEditor(v: unknown): unknown[] {
  if (!Array.isArray(v)) return [];
  const lista = v.filter((a) => a && typeof a === "object" && ANEXOS_ACEITOS.indexOf(String((a as { tipo?: unknown }).tipo)) >= 0).slice(0, 8);
  // Grande demais (proposta enorme): tira as operações guardadas para confirmar depois; a lista e a prova ficam.
  if (JSON.stringify(lista).length > MAX_BYTES_DOS_ANEXOS) {
    return lista.map((a) => {
      const o = a as Record<string, unknown>;
      if (o.tipo !== "acao_agente" || !o.contexto || typeof o.contexto !== "object") return a;
      const { operacoes: _fora, ...resto } = o.contexto as Record<string, unknown>;
      return { ...o, contexto: resto };
    }).filter((a) => JSON.stringify(a).length <= MAX_BYTES_DOS_ANEXOS);
  }
  return lista;
}


// ------------------------------------------------------------------ custo (estimativa antes)

export interface PrecoDoModelo {
  preco_entrada_1m: number | null;
  preco_saida_1m: number | null;
}

const SAIDA_POR_RACIOCINIO: Record<string, number> = { none: 1200, minimal: 1500, low: 2500, medium: 5000, high: 10000, xhigh: 16000, max: 24000 };

/** Estimativa de um passo do agente (tokens ~ caracteres / 4), pela tabela do catálogo. */
export function estimarPasso(m: PrecoDoModelo, caracteresDeEntrada: number, raciocinio?: string | null): number {
  const entrada = Math.ceil(caracteresDeEntrada / 4) + 1800;
  const saida = SAIDA_POR_RACIOCINIO[String(raciocinio || "")] || 2500;
  const pe = Number(m.preco_entrada_1m) || 0;
  const ps = Number(m.preco_saida_1m) || 0;
  return Math.round(((entrada * pe + saida * ps) / 1e6) * 10000) / 10000;
}

/** Sugestão (só sugestão: quem decide é o dono) de modelo mais barato que dá conta. */
export function sugerirModeloMaisBarato<T extends PrecoDoModelo & { id: string }>(modelos: T[], atual: string, precisaDeImagem: boolean, aceitaImagem: (m: T) => boolean): T | null {
  const custo = (m: T) => (Number(m.preco_entrada_1m) || 0) * 3 + (Number(m.preco_saida_1m) || 0);
  const esse = modelos.find((m) => m.id === atual);
  if (!esse) return null;
  const candidatos = modelos.filter((m) => m.id !== atual && (!precisaDeImagem || aceitaImagem(m)) && custo(m) < custo(esse) * 0.5);
  if (!candidatos.length) return null;
  return candidatos.sort((a, b) => custo(a) - custo(b))[0];
}

// ------------------------------------------------------------------ timestamp

export const PROVEDORES_DE_TIMESTAMP = {
  whisper: {
    rotulo: "OpenAI Whisper (palavra por palavra)",
    modelo: "whisper-1",
    usd_por_minuto: 0.006,
    fonte: "https://developers.openai.com/api/docs/guides/speech-to-text (whisper-1: timestamp_granularities word)",
  },
  alinhamento: {
    rotulo: "ElevenLabs Forced Alignment via fal (texto dado + áudio, palavra e letra)",
    modelo: "fal-ai/elevenlabs/forced-alignment",
    usd_por_hora_iniciada: 0.22,
    fonte: "https://fal.ai/models/fal-ai/elevenlabs/forced-alignment",
  },
} as const;

export type ModoDoTimestamp = "transcrever" | "alinhar";

/** Custo antes de gastar. Whisper cobra por minuto (arredonda para cima o segundo); alinhamento por hora iniciada. */
export function custoDoTimestamp(modo: ModoDoTimestamp, duracaoS: number): number {
  const d = Math.max(0, Number(duracaoS) || 0);
  if (modo === "alinhar") return Math.round(Math.max(1, Math.ceil(d / 3600)) * PROVEDORES_DE_TIMESTAMP.alinhamento.usd_por_hora_iniciada * 10000) / 10000;
  return Math.round((Math.ceil(d) / 60) * PROVEDORES_DE_TIMESTAMP.whisper.usd_por_minuto * 10000) / 10000;
}

export interface PalavraComTempo {
  t: string;
  i: number;
  f: number;
}

/** Palavras da parte n levadas para o tempo da fonte: soma o início da parte (exato, 3 casas). */
export function deslocarPalavras(palavras: { t?: unknown; text?: unknown; word?: unknown; i?: unknown; f?: unknown; start?: unknown; end?: unknown }[], inicioDaParte: number): PalavraComTempo[] {
  const r3 = (n: number) => Math.round(n * 1000) / 1000;
  const saida: PalavraComTempo[] = [];
  palavras.forEach((w) => {
    const t = String(w.t !== undefined ? w.t : w.word !== undefined ? w.word : w.text !== undefined ? w.text : "").trim();
    const i = Number(w.i !== undefined ? w.i : w.start);
    const f = Number(w.f !== undefined ? w.f : w.end);
    if (!t || !isFinite(i) || !isFinite(f) || f < i) return;
    saida.push({ t: t.slice(0, 120), i: r3(inicioDaParte + i), f: r3(inicioDaParte + Math.max(f, i + 0.01)) });
  });
  return saida;
}

/** Junta partes (ordem por início) e tira palavra repetida na emenda (mesmo texto começando antes do fim da anterior). */
export function juntarPartes(partes: PalavraComTempo[][]): PalavraComTempo[] {
  const todas = partes.reduce((a, p) => a.concat(p), [] as PalavraComTempo[]).sort((a, b) => a.i - b.i || a.f - b.f);
  const saida: PalavraComTempo[] = [];
  todas.forEach((w) => {
    const u = saida.length ? saida[saida.length - 1] : null;
    if (u && u.t === w.t && w.i < u.f) return;
    saida.push(w);
  });
  return saida;
}

/** Linhas prontas para legenda: até `maxPalavras` e quebra em pausa ou fim de frase. */
export function linhasDeLegenda(palavras: PalavraComTempo[], maxPalavras = 6, pausa = 0.6): { texto: string; i: number; f: number }[] {
  const linhas: { texto: string; i: number; f: number }[] = [];
  let atual: PalavraComTempo[] = [];
  const fechar = () => {
    if (!atual.length) return;
    linhas.push({ texto: atual.map((w) => w.t).join(" "), i: atual[0].i, f: atual[atual.length - 1].f });
    atual = [];
  };
  palavras.forEach((w, k) => {
    const ant = k > 0 ? palavras[k - 1] : null;
    if (atual.length >= maxPalavras || (ant && (w.i - ant.f > pausa || /[.!?]$/.test(ant.t)))) fechar();
    atual.push(w);
  });
  fechar();
  return linhas;
}

/** SRT a partir das linhas (para copiar). */
export function srtDasLinhas(linhas: { texto: string; i: number; f: number }[]): string {
  const tc = (s: number) => {
    const ms = Math.round(s * 1000);
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    const se = Math.floor((ms % 60000) / 1000);
    const r = ms % 1000;
    const p = (n: number, t = 2) => String(n).padStart(t, "0");
    return `${p(h)}:${p(m)}:${p(se)},${p(r, 3)}`;
  };
  return linhas.map((l, k) => `${k + 1}\n${tc(l.i)} --> ${tc(l.f)}\n${l.texto}\n`).join("\n");
}

// ------------------------------------------------------------------ visão

export interface TrechoVistoBruto {
  de_s?: unknown;
  ate_s?: unknown;
  descricao?: unknown;
  quem?: unknown;
  plano?: unknown;
  qualidade?: unknown;
}

export const ESQUEMA_DA_VISAO = {
  nome: "visao_por_trecho",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["trechos"],
    properties: {
      trechos: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["de_s", "ate_s", "descricao", "quem", "plano", "qualidade"],
          properties: {
            de_s: { type: "number" },
            ate_s: { type: "number" },
            descricao: { type: "string" },
            quem: { type: "string" },
            plano: { type: "string" },
            qualidade: { type: "string" },
          },
        },
      },
    },
  },
};

export function sistemaDaVisao(): string {
  return [
    "Você assiste um vídeo por quadros. Cada imagem vem com o tempo exato (s) na legenda da mensagem.",
    "Descreva por trecho SÓ o que está visível: o que aparece, quem (sem nome se não houver texto na tela), plano (fechado, médio, aberto, detalhe) e qualidade (foco, luz, tremido).",
    "Trecho começa e termina em tempos de quadros que você recebeu. Não invente o que acontece entre quadros. Português do Brasil, frases curtas.",
  ].join("\n");
}

/**
 * Confere o que o modelo disse: trecho só existe entre tempos de quadros
 * enviados (de_s e ate_s vão para o quadro enviado mais perto); texto vazio sai.
 */
export function trechosConferidos(bruto: unknown, tempos: number[]): { de_s: number; ate_s: number; descricao: string; quem: string | null; plano: string | null; qualidade: string | null }[] {
  const lista = bruto && typeof bruto === "object" && Array.isArray((bruto as { trechos?: unknown }).trechos) ? ((bruto as { trechos: unknown[] }).trechos as TrechoVistoBruto[]) : [];
  const ordem = tempos.slice().sort((a, b) => a - b);
  if (!ordem.length) return [];
  const perto = (v: number) => ordem.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a), ordem[0]);
  const txt = (v: unknown, n: number) => {
    const s = String(v === undefined || v === null ? "" : v).replace(/\s+/g, " ").trim().slice(0, n);
    return s || null;
  };
  return lista
    .map((t) => {
      const de = Number(t.de_s);
      const ate = Number(t.ate_s);
      const descricao = txt(t.descricao, 300);
      if (!isFinite(de) || !isFinite(ate) || !descricao) return null;
      const a = perto(Math.min(de, ate));
      const b = perto(Math.max(de, ate));
      return { de_s: a, ate_s: b, descricao, quem: txt(t.quem, 120), plano: txt(t.plano, 60), qualidade: txt(t.qualidade, 120) };
    })
    .filter((x): x is NonNullable<typeof x> => !!x)
    .sort((x, y) => x.de_s - y.de_s);
}

/** Tempos de amostra de uma fonte: 1 quadro a cada `passo` s (mínimo 1 s), até o teto, no meio de cada janela. */
export function temposDeAmostra(duracaoS: number, teto = MAX_QUADROS_POR_FONTE, passoMinimo = 1): number[] {
  const d = Math.max(0, Number(duracaoS) || 0);
  if (d <= 0) return [];
  const n = Math.max(1, Math.min(teto, Math.floor(d / passoMinimo)));
  const janela = d / n;
  const saida: number[] = [];
  for (let k = 0; k < n; k++) saida.push(Math.round((k * janela + janela / 2) * 1000) / 1000);
  return saida;
}
