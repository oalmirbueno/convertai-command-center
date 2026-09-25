/**
 * Refinar texto no Estúdio (dono, 26/09: "uma área no texto para refinar a
 * copy, melhorar a copy, com todas as técnicas, para sempre gerar a melhor
 * copy de qualquer tipo de texto, usando o treinamento interno"). Regras
 * puras, sem rede: os objetivos que a tela oferece, a leitura do pedido e a
 * limpeza das opções que o redator devolve. A ação refinar_texto (index.ts)
 * monta o prompt com a base de marketing (_shared/conhecimento-marketing.ts),
 * os frameworks (_shared/conhecimento-conteudo.ts) e o cérebro do cliente.
 * A tela espelha os ids em src/components/mesa/estudioUtil.ts.
 */

export type AlvoDoRefino = "lamina" | "legenda";

export const OBJETIVOS_DO_REFINO: { id: string; rotulo: string; instrucao: string }[] = [
  { id: "mais_curto", rotulo: "Mais curto", instrucao: "corte tudo que não muda o sentido: o mais curto possível sem perder a ideia (na lâmina, no máximo 60% dos caracteres do atual)" },
  { id: "mais_forte", rotulo: "Mais forte", instrucao: "verbo concreto, benefício específico do cliente, sem adjetivo vazio nem superlativo sem prova" },
  { id: "mais_claro", rotulo: "Mais claro", instrucao: "uma ideia por frase, palavras que o público usa, sem jargão; entende-se em 1 segundo" },
  { id: "gancho", rotulo: "Gancho melhor", instrucao: "a primeira linha para a rolagem: tensão, contraste, pergunta real do público, cena ou dado real (nunca inventado); varie o tipo de gancho entre as opções" },
  { id: "cta", rotulo: "CTA melhor", instrucao: "chamada com verbo de ação e o que acontece depois, uma ação só, ligada à métrica do post (salvar, enviar, comentar, chamar no WhatsApp, agendar)" },
  { id: "tom_da_marca", rotulo: "Tom da marca", instrucao: "na voz da marca (contexto e cérebro do cliente): termos preferidos, nenhum termo proibido, o tratamento que o público espera" },
];

export const IDS_DOS_OBJETIVOS = OBJETIVOS_DO_REFINO.map((o) => o.id);

/** Objetivos pedidos, sem repetir e só os conhecidos (até 4). Nenhum: "mais forte". */
export function objetivosDoRefino(v: unknown): string[] {
  const lista = Array.isArray(v) ? v : typeof v === "string" ? [v] : [];
  const saida: string[] = [];
  for (const bruto of lista) {
    const id = String(bruto || "").trim().toLowerCase();
    if (IDS_DOS_OBJETIVOS.indexOf(id) >= 0 && saida.indexOf(id) < 0) saida.push(id);
    if (saida.length >= 4) break;
  }
  return saida.length ? saida : ["mais_forte"];
}

/** Tira travessão (regra da casa) sem colar palavras: " — " e "–" viram vírgula. */
export function semTravessao(t: string): string {
  return t
    .replace(/\s*[—–]\s*/g, ", ")
    .replace(/,\s*,/g, ",")
    .replace(/^,\s*/gm, "")
    .replace(/[ \t]+\n/g, "\n");
}

/** Teto de caracteres da opção: a lâmina é escrita na arte (curta); a legenda vai até o limite do Instagram. */
export function tetoDoRefino(alvo: AlvoDoRefino, original: string): number {
  if (alvo === "legenda") return 2200;
  return Math.min(1200, Math.max(120, Math.round(original.length * 1.3)));
}

export type OpcaoDoRefino = { texto: string; tecnica: string; porque: string };

/**
 * Opções que o redator devolveu, prontas para a tela: sem travessão, sem
 * hashtag (na lâmina e na legenda elas ficam fora do texto), dentro do teto,
 * sem repetir e sem a cópia do texto atual. No máximo 3.
 */
export function limparOpcoesDoRefino(bruto: unknown, alvo: AlvoDoRefino, original: string): OpcaoDoRefino[] {
  const lista = bruto && typeof bruto === "object" && Array.isArray((bruto as { opcoes?: unknown }).opcoes) ? (bruto as { opcoes: unknown[] }).opcoes : [];
  const teto = tetoDoRefino(alvo, original);
  const normal = (t: string) => t.replace(/\s+/g, " ").trim().toLowerCase();
  const vistos: string[] = [normal(original)];
  const saida: OpcaoDoRefino[] = [];
  for (const o of lista) {
    if (!o || typeof o !== "object") continue;
    const r = o as Record<string, unknown>;
    let texto = semTravessao(String(r.texto ?? "")).replace(/\r\n?/g, "\n");
    // Hashtag no fim sai (elas moram em campo próprio); na lâmina, @ e hashtag em qualquer lugar saem.
    texto = texto.replace(/(\s*#[A-Za-z0-9_À-ſ]+)+\s*$/, "");
    if (alvo === "lamina") texto = texto.replace(/(^|\s)[#@][A-Za-z0-9_À-ſ.]+/g, "$1");
    texto = texto.split("\n").map((l) => l.replace(/[ \t]+/g, " ").trim()).filter((l, i, a) => l || (i > 0 && a[i - 1])).join("\n").trim();
    if (!texto || texto.length > teto) continue;
    const chave = normal(texto);
    if (vistos.indexOf(chave) >= 0) continue;
    vistos.push(chave);
    saida.push({
      texto,
      tecnica: semTravessao(String(r.tecnica ?? "")).trim().slice(0, 80),
      porque: semTravessao(String(r.porque ?? "")).trim().slice(0, 240),
    });
    if (saida.length >= 3) break;
  }
  return saida;
}

export const ESQUEMA_REFINO = {
  nome: "refino_de_texto",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["opcoes"],
    properties: {
      opcoes: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["texto", "tecnica", "porque"],
          properties: {
            texto: { type: "string" },
            tecnica: { type: "string" },
            porque: { type: "string" },
          },
        },
      },
    },
  },
};

export const INSTRUCOES_REFINO = `REFINO DE TEXTO DO ESTÚDIO
Você é o redator sênior da agência. Reescreva o texto atual em 3 opções diferentes entre si, prontas para usar, seguindo os objetivos pedidos, a voz da marca, o contexto e o que o cliente já ensinou (cérebro).
Regras:
- Mantenha o sentido, a oferta e os fatos do texto atual e do contexto. Não invente preço, número, prazo, promessa, depoimento, nome nem dado.
- Português do Brasil, sem travessão, sem os clichês da base ANTI-GENÉRICO.
- Cada opção usa uma técnica diferente (fórmula de título, tipo de gancho, framework ou estrutura de CTA): diga qual em "tecnica" (até 6 palavras) e por que funciona para este público em "porque" (uma frase).
- Se vier um framework, as 3 opções seguem os passos dele (no texto curto da lâmina, na forma comprimida de "estatico").
- Se vier pedido da equipe, ele manda sobre os objetivos.
- Lâmina (alvo "lamina"): é o texto escrito dentro da arte. Curto, uma ideia; a primeira linha é a headline e as seguintes o apoio, separadas por quebra de linha (\\n); headline de até 6 palavras quando der; sem hashtag, @, emoji, preço ou dado que não esteja no texto atual; no máximo uma linha a mais que o atual.
- Legenda (alvo "legenda"): primeira linha é o gancho (funciona antes do "mais"); parágrafos curtos; um CTA no fim; sem hashtags (elas ficam em campo próprio); emoji só se a marca usa.
- Nunca repita o texto atual como opção.`;
