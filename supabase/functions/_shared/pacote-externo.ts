/**
 * Pacote para LLM externo (frente C, 26/09).
 *
 * Pedido do dono: "Ele já deixa preparado todo o material para mim, pronto, o
 * que eu preciso avançar para jogar no LLM externo." O pacote junta, sem IA,
 * o contexto consolidado do cliente, a tarefa escolhida e as instruções, em
 * Markdown (para colar no ChatGPT ou no Claude) e em JSON (para guardar ou
 * mandar para outra ferramenta).
 *
 * Regra que não volta atrás: nada de chave, token, senha, cofre ou documento
 * pessoal dentro do pacote. Três camadas:
 * 1. Só entram campos escolhidos a dedo (lista branca, nunca o registro
 *    inteiro do banco).
 * 2. Chave de objeto com cara de segredo (senha, token, login, acesso, cpf,
 *    cartão, pix...) sai inteira, com o valor.
 * 3. Todo texto passa por limparSegredos: padrões de chave de API, JWT,
 *    "senha: x", link com token na consulta, CPF e cartão viram [removido].
 *
 * Google Meu Negócio entra como tarefa com os dados de cadastro prontos; o
 * pacote nunca pede senha nem manda fazer login em conta de terceiros.
 *
 * Puro: sem Deno, sem banco. A tela e os testes (vitest) leem o mesmo arquivo.
 */

export const FORMATO_DO_PACOTE = "aceleriq.pacote_externo";
export const VERSAO_DO_PACOTE = 1;
/** Teto do Markdown (cabe folgado na janela de qualquer LLM de conversa). */
export const TETO_DO_PACOTE = 24_000;
const REMOVIDO = "[removido]";

export type TipoDePacote = "google_meu_negocio" | "site" | "identidade_visual" | "conteudo" | "tarefa" | "livre";
export const TIPOS_DE_PACOTE: readonly TipoDePacote[] = ["google_meu_negocio", "site", "identidade_visual", "conteudo", "tarefa", "livre"];

export const ROTULO_DO_PACOTE: Record<TipoDePacote, string> = {
  google_meu_negocio: "Google Meu Negócio (Perfil da Empresa)",
  site: "Site do cliente",
  identidade_visual: "Identidade visual e brand book",
  conteudo: "Plano de conteúdo",
  tarefa: "Tarefa do plano",
  livre: "Pedido livre",
};

// ------------------------------------------------------------------ segredos

/** Nome de campo que nunca entra no pacote (a chave e o valor saem juntos). */
export const CHAVE_SENSIVEL =
  /(senha|password|passwd|\bpwd\b|token|secret|segredo|chave|api.?key|apikey|cofre|credencia|login|acesso|access|auth|cpf|cnpj|\brg\b|cart[aã]o|\bcvv\b|banco|ag[eê]ncia banc|conta banc|\bpix\b|portal_password|first_access)/i;

type Padrao = { nome: string; re: RegExp; trocar?: (m: string, ...g: string[]) => string };

/**
 * Padrões de segredo em texto livre. Sem lookbehind nem grupo nomeado
 * (a tela roda em Safari 11). Cada um com /g, sempre com lastIndex zerado.
 */
const PADROES: Padrao[] = [
  { nome: "chave_openai_anthropic", re: /\bsk-[A-Za-z0-9_-]{16,}/g },
  { nome: "chave_stripe", re: /\b(sk|rk|pk)_(live|test)_[A-Za-z0-9]{10,}/g },
  { nome: "webhook_secret", re: /\bwhsec_[A-Za-z0-9]{10,}/g },
  { nome: "jwt", re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g },
  { nome: "github", re: /\b(ghp|gho|ghs|ghu|github_pat)_[A-Za-z0-9_]{20,}/g },
  { nome: "aws", re: /\bAKIA[0-9A-Z]{16}\b/g },
  { nome: "google", re: /\bAIza[0-9A-Za-z_-]{30,}/g },
  { nome: "slack", re: /\bxox[abprs]-[A-Za-z0-9-]{10,}/g },
  { nome: "meta", re: /\bEAA[A-Za-z0-9]{30,}/g },
  { nome: "bearer", re: /\bBearer\s+[A-Za-z0-9._~+\/-]{12,}=*/gi },
  // Link antes do rótulo: "?token=x" some com a consulta inteira, o endereço fica.
  {
    nome: "link_com_token",
    re: /(https?:\/\/[^\s?#]+)\?[^\s#]*(token|key|secret|signature|sig|access_token|code|password|senha)=[^\s#]*/gi,
    trocar: (_m: string, base: string) => base,
  },
  {
    nome: "rotulo_de_segredo",
    re: /\b(senha|password|passwd|pwd|token|secret|segredo|api[_ -]?key|chave de api|chave secreta|chave da api|access[_ -]?key|client[_ -]?secret)\s*[:=]\s*("[^"]*"|'[^']*'|\S+)/gi,
    trocar: (_m: string, rotulo: string) => `${rotulo}: ${REMOVIDO}`,
  },
  { nome: "cpf", re: /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g },
  { nome: "cnpj", re: /\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/g },
  { nome: "cartao", re: /\b\d{4}[ .-]\d{4}[ .-]\d{4}[ .-]\d{4}\b/g },
  // Sequência longa de letras e números misturados (chave sem prefixo conhecido).
  // Caminho de link (tem barra e nenhum + ou =) fica: é endereço, não chave.
  {
    nome: "sequencia_longa",
    re: /\b[A-Za-z0-9+\/_-]{40,}={0,2}/g,
    trocar: (m: string) => (/[0-9]/.test(m) && /[A-Za-z]/.test(m) && (m.indexOf("/") < 0 || /[+=]/.test(m)) ? REMOVIDO : m),
  },
];

/** Troca o que parece segredo por [removido] e diz quantos trechos saíram. */
export function limparSegredosComContagem(texto: unknown): { texto: string; removidos: number } {
  let s = texto == null ? "" : String(texto);
  let removidos = 0;
  for (const p of PADROES) {
    p.re.lastIndex = 0;
    s = s.replace(p.re, (...args: unknown[]) => {
      const m = String(args[0]);
      const grupos = args.slice(1, -2).map((g) => (g == null ? "" : String(g)));
      const novo = p.trocar ? p.trocar(m, ...grupos) : REMOVIDO;
      if (novo !== m) removidos++;
      return novo;
    });
  }
  return { texto: s, removidos };
}

export function limparSegredos(texto: unknown): string {
  return limparSegredosComContagem(texto).texto;
}

/** Algum padrão de segredo aparece no texto? (os testes usam para provar que o pacote sai limpo) */
export function temSegredo(texto: unknown): boolean {
  const s = texto == null ? "" : String(texto);
  return PADROES.some((p) => {
    p.re.lastIndex = 0;
    let achou = false;
    s.replace(p.re, (...args: unknown[]) => {
      const m = String(args[0]);
      const grupos = args.slice(1, -2).map((g) => (g == null ? "" : String(g)));
      if ((p.trocar ? p.trocar(m, ...grupos) : REMOVIDO) !== m) achou = true;
      return m;
    });
    return achou;
  });
}

/**
 * Cópia limpa de qualquer valor: chaves sensíveis saem, textos passam por
 * limparSegredos, profundidade e tamanho limitados. Conta o que saiu.
 */
export function valorLimpo(v: unknown, contador: { removidos: number } = { removidos: 0 }, profundidade = 0): unknown {
  if (v == null) return null;
  if (profundidade > 5) return null;
  if (typeof v === "string") {
    const r = limparSegredosComContagem(v.slice(0, 4000));
    contador.removidos += r.removidos;
    return r.texto.trim();
  }
  if (typeof v === "number" || typeof v === "boolean") return v;
  if (Array.isArray(v)) return v.slice(0, 60).map((x) => valorLimpo(x, contador, profundidade + 1)).filter((x) => x !== null && x !== "");
  if (typeof v === "object") {
    const saida: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).slice(0, 80)) {
      if (CHAVE_SENSIVEL.test(k)) {
        contador.removidos++;
        continue;
      }
      const x = valorLimpo((v as Record<string, unknown>)[k], contador, profundidade + 1);
      if (x === null || x === "" || (Array.isArray(x) && !x.length)) continue;
      saida[k] = x;
    }
    return saida;
  }
  return null;
}

// ------------------------------------------------------------------ briefing

/** "companyName" vira "Company name"; "tom_de_voz" vira "Tom de voz". */
export function rotuloDoCampo(k: string): string {
  const s = String(k || "")
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : "";
}

/** Respostas do briefing em linhas "Rótulo: valor", sem os campos sensíveis. */
export function linhasDoBriefing(respostas: unknown, contador: { removidos: number } = { removidos: 0 }): string[] {
  const limpo = valorLimpo(respostas, contador);
  if (!limpo || typeof limpo !== "object" || Array.isArray(limpo)) return [];
  const linhas: string[] = [];
  for (const [k, v] of Object.entries(limpo as Record<string, unknown>)) {
    const valor = Array.isArray(v) ? v.map((x) => (typeof x === "object" ? JSON.stringify(x) : String(x))).join("; ") : typeof v === "object" ? JSON.stringify(v) : String(v);
    if (valor.trim()) linhas.push(`${rotuloDoCampo(k)}: ${valor.trim()}`);
  }
  return linhas.slice(0, 60);
}

// ------------------------------------------------------------------ montagem

export type CaminhoDoCliente = {
  resumo?: string | null;
  etapas?: Array<{ titulo?: string | null; porque?: string | null; quando?: string | null }> | null;
  stack?: Array<{ ferramenta?: string | null; para_que?: string | null; custo?: string | null; fonte?: string | null; porque?: string | null }> | null;
  cuidados?: string[] | null;
  atualizado_em?: string | null;
};

export type EntradaDoPacote = {
  cliente: { nome: string; telefone?: string | null; cidade?: string | null; site?: string | null; instagram?: string | null };
  /** Contexto consolidado do kit (negócio, público, oferta, tom, nicho...). */
  contexto?: Record<string, unknown> | null;
  kit?: { paleta?: Array<{ nome?: string; hex?: string; papel?: string }> | null; estilo?: string | null; regras?: string | null; fontes?: Array<{ nome?: string; papel?: string }> | null } | null;
  /** Respostas do briefing (objeto como está no banco); os campos sensíveis saem aqui. */
  briefing?: unknown;
  dossie?: string | null;
  caminho?: CaminhoDoCliente | null;
  /** Briefing de identidade já montado (Markdown), quando o pacote é de identidade visual. */
  identidade?: string | null;
  tarefa: { tipo: TipoDePacote; titulo?: string | null; descricao?: string | null; prazo?: string | null };
  /** Pedido com IA (opcional): texto que o motor escreveu por cima do pacote. */
  pedidoRefinado?: string | null;
  geradoEm: string;
};

export type PacoteExterno = {
  markdown: string;
  json: Record<string, unknown>;
  nome_arquivo: string;
  /** Quantos trechos com cara de segredo ou dado pessoal saíram. */
  removidos: number;
  avisos: string[];
};

const INSTRUCOES: Record<TipoDePacote, { pedido: string; passos: string[]; resposta: string[] }> = {
  google_meu_negocio: {
    pedido: "Monte o cadastro completo do Perfil da Empresa no Google (Google Meu Negócio) deste cliente, pronto para a equipe preencher à mão com o dono.",
    passos: [
      "Nome da empresa exatamente como na fachada e nos documentos, sem palavra-chave a mais (o Google suspende perfil com nome enfeitado).",
      "Categoria principal e até 9 categorias adicionais, as mais específicas que existirem para o que o cliente faz.",
      "Descrição de até 750 caracteres: o que faz, para quem, onde atende e o diferencial comprovado. Sem link, sem telefone, sem promoção.",
      "Serviços ou produtos com nome e descrição curta de cada um.",
      "Área de atendimento (cidades ou bairros) ou endereço, e horários de funcionamento. O que não estiver no pacote vira pergunta para o dono.",
      "Cinco perguntas e respostas que clientes de verdade fazem sobre este negócio.",
      "Quatro primeiras postagens (texto curto e ideia de foto de cada uma).",
      "Lista de fotos para tirar: fachada, interior, equipe, produto ou serviço em uso, logo quadrada e capa.",
      "Roteiro curto para pedir avaliação a clientes satisfeitos, sem oferecer nada em troca.",
      "Nunca peça senha nem oriente login na conta de outra pessoa: a equipe cadastra com o dono, na conta dele.",
    ],
    resposta: ["Uma seção por item acima, na mesma ordem.", "No fim, a lista do que falta confirmar com o dono."],
  },
  site: {
    pedido: "Planeje o site deste cliente: páginas, textos principais e o que precisa para ir ao ar.",
    passos: [
      "Mapa do site com o objetivo de cada página (o site existe para gerar contato ou venda, não para ser bonito).",
      "Textos da página inicial: título, subtítulo, três blocos de benefício, prova e chamada para ação.",
      "Busca local: título e descrição de cada página, palavras que o público usa e ligação com o Perfil da Empresa no Google.",
      "Use o caminho e a stack combinados quando existirem; custo só com a fonte citada, sem fonte escreva custo a confirmar.",
      "Lista do que o cliente precisa entregar (fotos, textos, domínio, acessos). Acessos são combinados à parte, nunca dentro deste texto.",
    ],
    resposta: ["Mapa do site", "Textos da home", "Busca local", "Stack e custos", "Pendências do cliente"],
  },
  identidade_visual: {
    pedido: "Crie a identidade visual deste cliente a partir do briefing de identidade abaixo e entregue um brand book.",
    passos: [
      "Leia o briefing de identidade e o contexto antes de propor. Respeite o que o briefing manda manter.",
      "Proponha três rotas criativas com conceito em uma frase e por que cada uma serve a este público.",
      "Para a rota escolhida: logo principal, versão alternativa e símbolo; paleta com nome e hex de cada cor e o papel dela; tipografia de título e de texto com nome exato e licença; grafismos; exemplos de aplicação (post, story, fachada ou cartão).",
      "Entregue o brand book em PDF e as logos em PNG com fundo transparente. O arquivo volta para o painel pelo botão Importar brand book, que lê cores, fontes e logos.",
    ],
    resposta: ["Três rotas criativas", "Rota escolhida em detalhe", "Paleta em hex", "Tipografia com licença", "Lista de arquivos entregues"],
  },
  conteudo: {
    pedido: "Monte o plano de conteúdo das próximas quatro semanas deste cliente.",
    passos: [
      "Três a cinco pilares de conteúdo ligados à oferta e ao público.",
      "Doze ideias de post com gancho da primeira linha, formato e chamada para ação.",
      "Tom de voz do contexto em todas as ideias; nada genérico que serviria para qualquer marca.",
    ],
    resposta: ["Pilares", "Doze ideias", "Calendário sugerido"],
  },
  tarefa: {
    pedido: "Resolva a tarefa abaixo para este cliente, com o contexto do pacote.",
    passos: ["Use só os fatos do pacote. O que faltar vira pergunta, nunca invenção.", "Entregue pronto para a equipe usar, em português do Brasil."],
    resposta: ["Entrega pronta", "Perguntas para o cliente, se houver"],
  },
  livre: {
    pedido: "Atenda o pedido abaixo para este cliente, com o contexto do pacote.",
    passos: ["Use só os fatos do pacote. O que faltar vira pergunta, nunca invenção.", "Português do Brasil."],
    resposta: ["Entrega pronta", "Perguntas para o cliente, se houver"],
  },
};

const umaLinha = (v: unknown, max = 400) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

function nomeDeArquivo(cliente: string, tipo: TipoDePacote, geradoEm: string): string {
  const base = `${cliente}-${tipo}`
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `pacote-${base || "cliente"}-${String(geradoEm).slice(0, 10)}`;
}

const CAMPOS_DO_CONTEXTO: Array<[string, string]> = [
  ["negocio", "Negócio"],
  ["nicho", "Nicho"],
  ["estagio", "Estágio"],
  ["posicionamento", "Posicionamento"],
  ["publico", "Público"],
  ["oferta", "Oferta"],
  ["tom_de_voz", "Tom de voz"],
  ["diferenciais", "Diferenciais"],
];

/** Monta o pacote (Markdown + JSON), sempre limpo. */
export function montarPacoteExterno(e: EntradaDoPacote): PacoteExterno {
  const contador = { removidos: 0 };
  const tipo: TipoDePacote = TIPOS_DE_PACOTE.indexOf(e.tarefa.tipo) >= 0 ? e.tarefa.tipo : "livre";
  const guia = INSTRUCOES[tipo];
  const limpar = (v: unknown, max = 1500) => {
    const r = limparSegredosComContagem(String(v ?? "").slice(0, max));
    contador.removidos += r.removidos;
    return r.texto.trim();
  };

  const cliente = {
    nome: limpar(e.cliente.nome, 120) || "Cliente",
    telefone: limpar(e.cliente.telefone, 40) || null,
    cidade: limpar(e.cliente.cidade, 120) || null,
    site: limpar(e.cliente.site, 200) || null,
    instagram: limpar(e.cliente.instagram, 120) || null,
  };
  const ctx = (valorLimpo(e.contexto ?? {}, contador) ?? {}) as Record<string, unknown>;
  const contexto: Record<string, unknown> = {};
  for (const [k] of CAMPOS_DO_CONTEXTO) if (ctx[k] != null && ctx[k] !== "") contexto[k] = ctx[k];
  const tipografia = (ctx.tipografia && typeof ctx.tipografia === "object" ? ctx.tipografia : null) as Record<string, unknown> | null;
  const logo = (ctx.logo && typeof ctx.logo === "object" ? ctx.logo : null) as Record<string, unknown> | null;
  const paleta = (Array.isArray(e.kit?.paleta) ? e.kit!.paleta! : [])
    .map((c) => ({ nome: limpar(c?.nome, 40), hex: /^#[0-9a-f]{6}$/i.test(String(c?.hex || "")) ? String(c!.hex).toUpperCase() : "", papel: limpar(c?.papel, 20) }))
    .filter((c) => c.hex)
    .slice(0, 8);
  const fontes = (Array.isArray(e.kit?.fontes) ? e.kit!.fontes! : []).map((f) => ({ nome: limpar(f?.nome, 80), papel: limpar(f?.papel, 20) })).filter((f) => f.nome).slice(0, 6);
  const marca = {
    paleta,
    fontes,
    tipografia: tipografia ? { titulo: limpar(tipografia.titulo, 120) || null, texto: limpar(tipografia.texto, 120) || null } : null,
    logo: logo && logo.descricao ? limpar(logo.descricao, 600) : null,
    estilo: limpar(e.kit?.estilo, 2000) || null,
    regras: limpar(e.kit?.regras, 2000) || null,
  };
  const briefing = linhasDoBriefing(e.briefing, contador);
  const dossie = limpar(e.dossie, 3000) || null;
  const caminho = e.caminho ? (valorLimpo(e.caminho, contador) as CaminhoDoCliente) : null;
  const identidade = limpar(e.identidade, 8000) || null;
  const tarefa = {
    tipo,
    rotulo: ROTULO_DO_PACOTE[tipo],
    titulo: limpar(e.tarefa.titulo, 200) || ROTULO_DO_PACOTE[tipo],
    descricao: limpar(e.tarefa.descricao, 3000) || null,
    prazo: /^\d{4}-\d{2}-\d{2}$/.test(String(e.tarefa.prazo || "")) ? String(e.tarefa.prazo) : null,
  };
  const pedidoRefinado = limpar(e.pedidoRefinado, 6000) || null;

  const md: string[] = [];
  md.push(`# ${tarefa.titulo}: ${cliente.nome}`);
  md.push("");
  md.push(`> Pacote preparado pela Aceleriq em ${String(e.geradoEm).slice(0, 10)}. Cole tudo no ChatGPT ou no Claude. Não contém senhas, chaves nem dados de acesso.`);
  md.push("");
  md.push("## Pedido");
  md.push(guia.pedido);
  if (tarefa.descricao) md.push("", tarefa.descricao);
  if (tarefa.prazo) md.push("", `Prazo combinado: ${tarefa.prazo}.`);
  md.push("", "## Como fazer");
  guia.passos.forEach((p, i) => md.push(`${i + 1}. ${p}`));
  md.push("- Use só os fatos deste pacote. O que faltar vira pergunta no fim, nunca invenção.");
  md.push("- Escreva em português do Brasil, sem travessão.");
  if (pedidoRefinado) md.push("", "## Pedido detalhado", pedidoRefinado);

  md.push("", "## Cliente");
  md.push(`- Nome: ${cliente.nome}`);
  if (cliente.cidade) md.push(`- Cidade: ${cliente.cidade}`);
  if (cliente.telefone) md.push(`- Telefone comercial: ${cliente.telefone}`);
  if (cliente.site) md.push(`- Site: ${cliente.site}`);
  if (cliente.instagram) md.push(`- Instagram: ${cliente.instagram}`);

  const linhasCtx = CAMPOS_DO_CONTEXTO.filter(([k]) => contexto[k] != null).map(([k, r]) => {
    const v = contexto[k];
    return `- ${r}: ${Array.isArray(v) ? v.join("; ") : umaLinha(v, 1500)}`;
  });
  if (linhasCtx.length) md.push("", "## Contexto da marca", ...linhasCtx);

  const linhasMarca: string[] = [];
  if (paleta.length) linhasMarca.push(`- Paleta: ${paleta.map((c) => `${c.nome || c.papel || "cor"} ${c.hex}${c.papel ? ` (${c.papel})` : ""}`).join(", ")}`);
  if (fontes.length) linhasMarca.push(`- Fontes: ${fontes.map((f) => `${f.nome}${f.papel ? ` (${f.papel})` : ""}`).join(", ")}`);
  else if (marca.tipografia && (marca.tipografia.titulo || marca.tipografia.texto)) linhasMarca.push(`- Tipografia: título ${marca.tipografia.titulo || "a definir"}, texto ${marca.tipografia.texto || "a definir"}`);
  if (marca.logo) linhasMarca.push(`- Logo: ${marca.logo}`);
  if (marca.estilo) linhasMarca.push(`- Estilo visual: ${umaLinha(marca.estilo, 2000)}`);
  if (marca.regras) linhasMarca.push(`- Regras da marca: ${umaLinha(marca.regras, 2000)}`);
  if (linhasMarca.length) md.push("", "## Identidade atual", ...linhasMarca);

  if (identidade) md.push("", "## Briefing de identidade", identidade);
  if (briefing.length) md.push("", "## Briefing respondido pelo cliente", ...briefing.map((l) => `- ${l}`));
  if (dossie) md.push("", "## Dossiê (resumo)", dossie);

  if (caminho && ((caminho.etapas && caminho.etapas.length) || (caminho.stack && caminho.stack.length) || caminho.resumo)) {
    md.push("", "## Caminho combinado");
    if (caminho.resumo) md.push(umaLinha(caminho.resumo, 1000));
    (caminho.etapas || []).forEach((p, i) => md.push(`${i + 1}. ${umaLinha(p.titulo, 200)}${p.quando ? ` (${umaLinha(p.quando, 60)})` : ""}${p.porque ? `: ${umaLinha(p.porque, 300)}` : ""}`));
    if (caminho.stack && caminho.stack.length) {
      md.push("", "Ferramentas e stack:");
      caminho.stack.forEach((s) => md.push(`- ${umaLinha(s.ferramenta, 80)}${s.para_que ? ` para ${umaLinha(s.para_que, 160)}` : ""}${s.custo ? `. Custo: ${umaLinha(s.custo, 120)}${s.fonte ? ` (fonte: ${umaLinha(s.fonte, 200)})` : " (a confirmar)"}` : ""}`));
    }
  }

  md.push("", "## Formato da resposta");
  guia.resposta.forEach((r) => md.push(`- ${r}`));

  let markdown = md.join("\n");
  const avisos: string[] = [];
  if (markdown.length > TETO_DO_PACOTE) {
    markdown = `${markdown.slice(0, TETO_DO_PACOTE)}\n\n(Pacote cortado no limite de ${TETO_DO_PACOTE} caracteres.)`;
    avisos.push("O pacote passou do limite e foi cortado no fim.");
  }
  // Última passada: o Markdown inteiro de novo (garante que nada escapou pelas bordas dos cortes).
  const final = limparSegredosComContagem(markdown);
  contador.removidos += final.removidos;
  markdown = final.texto;
  if (contador.removidos) avisos.push(`${contador.removidos} ${contador.removidos === 1 ? "trecho com cara de senha, chave ou dado pessoal saiu" : "trechos com cara de senha, chave ou dado pessoal saíram"} do pacote.`);

  const json: Record<string, unknown> = {
    formato: FORMATO_DO_PACOTE,
    versao: VERSAO_DO_PACOTE,
    gerado_em: e.geradoEm,
    tarefa: { ...tarefa, pedido: guia.pedido, passos: guia.passos, formato_da_resposta: guia.resposta, pedido_detalhado: pedidoRefinado },
    cliente,
    contexto,
    marca,
    briefing,
    dossie,
    caminho,
    identidade,
  };
  return { markdown, json: valorLimpo(json) as Record<string, unknown>, nome_arquivo: nomeDeArquivo(cliente.nome, tipo, e.geradoEm), removidos: contador.removidos, avisos };
}
