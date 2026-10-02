/**
 * Linha de produção da Mesa Foto (frente FTL, 30/09; dono: "a linha de
 * produção das fotos está muito confusa e difícil, facilite").
 *
 * Um caminho curto, na ordem em que a pessoa pensa:
 *   1. O que fazer (?etapa=criar): escolhe o que produzir.
 *   2. Fotos (?etapa=acervo, e o detalhe do produto em ?etapa=kits): sobe ou marca as fotos.
 *   3. Gerar (?etapa=estudio | ensaio | campanha | preparar): a ferramenta do que foi escolhido.
 *   4. Aprovar (?etapa=aprovar, e a comparação com as fontes em ?etapa=revisar): confere e aprova.
 *   5. Usar (?etapa=usar, e o post em ?etapa=agenda): Agenda, Mesa, Mesa Ads, baixar.
 *
 * O "objetivo" (o que produzir) fica guardado por cliente e diz o que cada
 * passo pede: uma foto, as fotos do produto ou nada. Nenhuma etapa antiga
 * sumiu: as ferramentas avançadas (Book, Clones, Modelos, Canvas, Biblioteca)
 * ficam em "Mais", recolhidas.
 *
 * Arquivo puro (sem React): a página, as etapas e os testes usam as mesmas regras.
 */

export type ObjetivoDaFoto = "melhorar" | "variacoes" | "modelo" | "fundo" | "post";

/** O que o objetivo pede no passo 2 (Fotos). */
export type RequisitoDasFotos = "uma_foto" | "produto" | "fotos";

export interface Objetivo {
  valor: ObjetivoDaFoto;
  /** Nome curto, como a pessoa fala. */
  titulo: string;
  /** Uma linha do que sai no fim. */
  texto: string;
  /** O que precisa, em uma frase curta. */
  precisa: string;
  requisito: RequisitoDasFotos;
  /** A etapa do passo 3 (Gerar). O post não gera: vai direto ao passo 5. */
  etapa: "estudio" | "ensaio" | "campanha" | "preparar" | "agenda";
  /** Rótulo da ferramenta, para quem já conhece a mesa. */
  ferramenta: string;
}

export const OBJETIVOS: Objetivo[] = [
  {
    valor: "melhorar",
    titulo: "Melhorar uma foto",
    texto: "Luz, cor, fundo, cenário, ângulo, ampliar e o recorte do post.",
    precisa: "1 foto",
    requisito: "uma_foto",
    etapa: "estudio",
    ferramenta: "Estúdio",
  },
  {
    valor: "variacoes",
    titulo: "Fotos do produto",
    texto: "4 a 16 fotos novas: fundo de cor, lifestyle, na mão, flat lay, detalhe.",
    precisa: "fotos do produto",
    requisito: "produto",
    etapa: "ensaio",
    ferramenta: "Variações",
  },
  {
    valor: "modelo",
    titulo: "Foto com modelo",
    texto: "Pessoa criada pela IA usando o produto, na pegada da marca.",
    precisa: "fotos do produto",
    requisito: "produto",
    etapa: "campanha",
    ferramenta: "Campanha",
  },
  {
    valor: "fundo",
    titulo: "Tirar fundo e ajustes",
    texto: "Fundo branco ou transparente, luz e cenário, com áreas protegidas.",
    precisa: "1 foto",
    requisito: "uma_foto",
    etapa: "preparar",
    ferramenta: "Preparar",
  },
  {
    valor: "post",
    titulo: "Post com fotos",
    texto: "Foto única ou carrossel com legenda, data e aprovação do cliente.",
    precisa: "fotos prontas",
    requisito: "fotos",
    etapa: "agenda",
    ferramenta: "Post na Agenda",
  },
];

export const VALORES_DOS_OBJETIVOS = OBJETIVOS.map((o) => o.valor);

export const ehObjetivo = (v: unknown): v is ObjetivoDaFoto => typeof v === "string" && VALORES_DOS_OBJETIVOS.indexOf(v as ObjetivoDaFoto) >= 0;

export const objetivoPorValor = (v: ObjetivoDaFoto | null | undefined): Objetivo | null => (v ? OBJETIVOS.find((o) => o.valor === v) || null : null);

/** Etapas do passo 3 (Gerar). */
export const ETAPAS_DE_GERAR = ["estudio", "ensaio", "campanha", "preparar"] as const;

/**
 * A ferramenta do passo 3 diz o objetivo (quem chega de fora, por um link do
 * diretor ou de outra mesa, já está "fazendo" aquilo). Só as ferramentas de
 * gerar: a Agenda é do passo 5 e não troca o objetivo (fazer um post depois de
 * aprovar não transforma "Fotos do produto" em "Post com fotos").
 */
export function objetivoDaEtapa(etapa: string | null | undefined): ObjetivoDaFoto | null {
  if (!etapa || (ETAPAS_DE_GERAR as readonly string[]).indexOf(etapa) < 0) return null;
  const o = OBJETIVOS.find((x) => x.etapa === etapa);
  return o ? o.valor : null;
}

/**
 * As fotos marcadas que contam para a linha: só as que existem no acervo e
 * podem sair (referência da internet é uso interno). Antes de o acervo
 * carregar, vale a seleção como está. A faixa, o "Próximo" do cabeçalho e a
 * aba 3 usam a mesma regra.
 */
export function marcadasQueContam(selecionadas: string[], fotos: { id: string; referencia_web?: boolean | null }[] | null | undefined): string[] {
  if (!fotos) return selecionadas.slice();
  return selecionadas.filter((id) => fotos.some((f) => f.id === id && !f.referencia_web));
}

export interface EstadoDaLinha {
  objetivo: ObjetivoDaFoto | null;
  /** Fotos marcadas no passo 2. */
  selecionadas: number;
  /** Produto escolhido (kit). */
  kitId: string | null;
  /** Quantos produtos existem. */
  produtos: number;
}

export interface Prontidao {
  pronto: boolean;
  /** O que falta, em uma frase curta (vazio quando pronto). */
  falta: string;
  /** Rótulo do botão de seguir. */
  seguir: string;
}

/**
 * O passo 2 está pronto para seguir? Não trava nada: é o texto do botão e a
 * frase do que falta. Sem objetivo, pede para escolher primeiro.
 */
export function prontidaoDasFotos(e: EstadoDaLinha): Prontidao {
  const o = objetivoPorValor(e.objetivo);
  if (!o) return { pronto: false, falta: "Escolha antes o que fazer.", seguir: "Escolher o que fazer" };
  if (o.requisito === "uma_foto") {
    if (!e.selecionadas) return { pronto: false, falta: "Marque 1 foto na grade (ou suba uma).", seguir: `Abrir no ${o.ferramenta}` };
    return { pronto: true, falta: "", seguir: e.selecionadas > 1 ? `Abrir a primeira no ${o.ferramenta}` : `Abrir no ${o.ferramenta}` };
  }
  if (o.requisito === "produto") {
    if (!e.kitId) {
      return {
        pronto: false,
        falta: e.produtos ? "Escolha o produto logo abaixo." : "Marque as fotos do produto e toque em Identificar o produto.",
        seguir: "Gerar as fotos",
      };
    }
    return { pronto: true, falta: "", seguir: o.valor === "modelo" ? "Montar a foto com modelo" : "Montar as fotos do produto" };
  }
  if (!e.selecionadas) return { pronto: false, falta: "Marque as fotos do post (1 a 20).", seguir: "Montar o post" };
  return { pronto: true, falta: "", seguir: e.selecionadas > 1 ? `Montar o carrossel (${Math.min(e.selecionadas, 20)})` : "Montar o post" };
}

/** Para onde vai o passo 3 (Gerar) no cabeçalho: a ferramenta do objetivo; sem objetivo, Fotos do produto (nunca volta ao passo 1). */
export function etapaDeGerar(objetivo: ObjetivoDaFoto | null): string {
  const o = objetivoPorValor(objetivo);
  return o ? o.etapa : "ensaio";
}

/**
 * 02/10 (dono: "Escolher e Gerar abrem de novo o O que fazer, fica em
 * laço"): o passo 3 (Gerar) sempre vai PARA FRENTE. Sem objetivo escolhido,
 * vale o que já existe: produto escolhido leva às Fotos do produto, foto
 * marcada abre no Estúdio; sem nada, Fotos do produto (que tem o seletor de
 * produto). Nunca devolve "criar".
 */
export interface DestinoDoPasso {
  etapa: "estudio" | "ensaio" | "campanha" | "preparar" | "agenda";
  imagem: string | null;
  /** O post leva as marcadas para a Agenda. */
  levarAoPost: boolean;
  /** O objetivo que vale daqui para frente (o escolhido ou o deduzido). */
  objetivo: ObjetivoDaFoto;
}

export function destinoDoGerar(e: { objetivo: ObjetivoDaFoto | null; marcadas: string[]; kitId: string | null }): DestinoDoPasso {
  const escolhido = objetivoPorValor(e.objetivo);
  const o = escolhido || objetivoPorValor(e.kitId ? "variacoes" : e.marcadas.length ? "melhorar" : "variacoes")!;
  if (o.etapa === "agenda") return { etapa: "agenda", imagem: null, levarAoPost: e.marcadas.length > 0, objetivo: o.valor };
  if (o.requisito === "uma_foto") return { etapa: o.etapa, imagem: e.marcadas[0] || null, levarAoPost: false, objetivo: o.valor };
  return { etapa: o.etapa, imagem: null, levarAoPost: false, objetivo: o.valor };
}

/**
 * Ao escolher o que produzir (passo 1): com o que precisa já em mãos (produto
 * escolhido para fotos do produto e com modelo, foto marcada para melhorar e
 * tirar fundo), vai direto para gerar; senão, para as Fotos com o pedido
 * certo. Fotos do produto e Foto com modelo têm o seletor de produto na
 * própria tela: com algum produto no cliente, vão direto.
 */
export function destinoAoEscolher(valor: ObjetivoDaFoto, e: { marcadas: string[]; kitId: string | null; produtos: number }): { etapa: string; imagem: string | null; levarAoPost: boolean } {
  const o = objetivoPorValor(valor)!;
  if (o.requisito === "produto") return e.kitId || e.produtos > 0 ? { etapa: o.etapa, imagem: null, levarAoPost: false } : { etapa: "acervo", imagem: null, levarAoPost: false };
  if (o.requisito === "uma_foto") return e.marcadas.length ? { etapa: o.etapa, imagem: e.marcadas[0], levarAoPost: false } : { etapa: "acervo", imagem: null, levarAoPost: false };
  return e.marcadas.length ? { etapa: "agenda", imagem: null, levarAoPost: true } : { etapa: "acervo", imagem: null, levarAoPost: false };
}
