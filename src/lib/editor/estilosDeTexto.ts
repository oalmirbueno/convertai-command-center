/**
 * Estilos de legenda e de texto na tela (frente EDT, rodada 2). Catálogo puro
 * (sem "@/"): a composição desenha, os painéis e o agente escolhem pelo id.
 * As cores saem da identidade da marca guardada no projeto (cor e cor2); sem
 * marca, o verde da casa. Letras livres (OFL) servidas pelo painel.
 */

export interface EstiloDeTexto {
  valor: string;
  rotulo: string;
  /** Uma linha (vai no "?"). */
  quando: string;
}

export const PRESETS_DE_LEGENDA: EstiloDeTexto[] = [
  { valor: "destaque", rotulo: "Palavra acesa", quando: "a palavra dita acende na cor da marca" },
  { valor: "caixa", rotulo: "Caixa (adesivo)", quando: "bloco claro atrás da frase, lê em qualquer fundo" },
  { valor: "caixa_palavra", rotulo: "Caixa na palavra", quando: "uma caixa na cor da marca anda de palavra em palavra" },
  { valor: "impacto", rotulo: "Impacto", quando: "letra alta e condensada, em caixa alta, com contorno" },
  { valor: "gigante", rotulo: "Palavra gigante", quando: "uma palavra por vez, bem grande no meio" },
  { valor: "pulso", rotulo: "Pulso", quando: "a palavra dita cresce um pouco na hora dela" },
  { valor: "fita", rotulo: "Fita", quando: "faixa na cor da marca atrás da linha" },
  { valor: "papelaria", rotulo: "Papelaria", quando: "letra à mão numa etiqueta de papel" },
  { valor: "discreta", rotulo: "Discreta", quando: "pequena, embaixo, para vídeo mais sóbrio" },
  { valor: "simples", rotulo: "Simples", quando: "texto branco com sombra, sem animação" },
];

export const PRESETS_DE_TEXTO: EstiloDeTexto[] = [
  { valor: "simples", rotulo: "Simples", quando: "texto branco com sombra" },
  { valor: "titulo", rotulo: "Título", quando: "abertura ou troca de assunto, grande" },
  { valor: "manchete", rotulo: "Manchete (gancho)", quando: "o gancho no alto, em bloco da cor da marca" },
  { valor: "tarja", rotulo: "Tarjas", quando: "faixas pretas com o texto, estilo notícia" },
  { valor: "marca_texto", rotulo: "Marca-texto", quando: "frase grifada na cor da marca" },
  { valor: "balao", rotulo: "Balão", quando: "fala ou pergunta num balão" },
  { valor: "vidro", rotulo: "Vidro escuro", quando: "cartão translúcido escuro, leitura calma" },
  { valor: "chamada", rotulo: "Chamada (botão)", quando: "a ação que você quer: comentar, chamar, comprar" },
  { valor: "nome", rotulo: "Nome e cargo", quando: "quem fala, no canto de baixo (duas linhas: nome | cargo)" },
];

export const POSICOES_DE_TEXTO = [
  { valor: "auto", rotulo: "Automático (desvia do rosto)" },
  { valor: "topo", rotulo: "Em cima" },
  { valor: "meio", rotulo: "No meio" },
  { valor: "base", rotulo: "Embaixo" },
] as const;

export const FONTES_DE_TEXTO = ["Montserrat", "Anton", "Figtree", "Caveat"] as const;

/** Ordem do papel da letra da marca para o vídeo: a de título manda (legenda e texto são display). */
const ORDEM_DO_PAPEL: Record<string, number> = { titulo: 0, destaque: 1, texto: 2 };

/**
 * A letra da marca que o vídeo usa, entre as fontes que VALEM para a marca
 * aberta (a tela já aplicou a regra de herança: fontesDaMarcaNaTela). O nome
 * vira a família (só letras, números e espaço, como o normalizador do
 * projeto aceita); o arquivo vai junto para a prévia e o worker carregarem.
 * Sem fonte com nome e arquivo: null (o estilo usa as letras do painel).
 */
export function letraDaMarcaParaVideo(fontes: { nome?: string | null; papel?: string | null; storage_path?: string | null }[] | null | undefined): { familia: string; caminho: string } | null {
  const validas = (fontes || [])
    .map((f) => ({
      familia: String((f && f.nome) || "")
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .replace(/[^A-Za-z0-9 ]+/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 40)
        .trim(),
      caminho: String((f && f.storage_path) || ""),
      ordem: ORDEM_DO_PAPEL[String((f && f.papel) || "")] === undefined ? 3 : ORDEM_DO_PAPEL[String(f.papel)],
    }))
    .filter((f) => f.familia.length >= 2 && /\.(ttf|otf|woff2?)$/i.test(f.caminho) && f.caminho.indexOf("..") < 0)
    .sort((a, b) => a.ordem - b.ordem);
  return validas.length ? { familia: validas[0].familia, caminho: validas[0].caminho } : null;
}

export const presetDaLegendaValido = (v: unknown) => PRESETS_DE_LEGENDA.some((p) => p.valor === v);
export const presetDoTextoValido = (v: unknown) => PRESETS_DE_TEXTO.some((p) => p.valor === v);

export const VERDE_DA_CASA = "#00FF66";

/** Cor legível sobre um fundo (preto ou branco), pela luminância. */
export function corSobre(fundo: string): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(fundo || "");
  if (!m) return "#111111";
  const [r, g, b] = [m[1], m[2], m[3]].map((h) => parseInt(h, 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.55 ? "#111111" : "#ffffff";
}

/** Rosto no quadro de saída: centro (y) e meia altura, em fração do alto. */
export interface RostoNoQuadro {
  y: number;
  meia: number;
}

/** Altura que um bloco de texto ocupa (fração do alto do quadro), para a conta da zona do rosto. */
export const ALTURA_DO_BLOCO = 0.14;

/**
 * Onde o texto fica (fração do alto). "auto" protege o rosto (zona segura, como
 * no EDIT IA PRO): a legenda sobe quando o rosto está embaixo; o texto do alto
 * desce para baixo do queixo quando cobriria os olhos.
 */
export function alturaDaPosicao(posicao: string, legenda: boolean, rosto: RostoNoQuadro | null, bloco = ALTURA_DO_BLOCO): number {
  if (posicao === "topo") return 0.12;
  if (posicao === "meio") return 0.45;
  if (posicao === "base") return legenda ? 0.72 : 0.7;
  if (legenda) {
    if (rosto && rosto.y + rosto.meia * 0.5 > 0.68) return 0.12;
    return 0.72;
  }
  // Texto no alto: pode passar pela testa, nunca pelos olhos (o terço de cima do rosto é a testa).
  const topo = 0.08;
  if (!rosto) return topo;
  const olhos = rosto.y - rosto.meia * 0.35;
  if (topo + bloco <= olhos) return topo;
  const abaixo = rosto.y + rosto.meia + 0.03;
  return abaixo + bloco <= 0.7 ? abaixo : topo;
}

/**
 * Altura estimada do bloco de texto (fração do alto): linhas pelo tamanho da
 * letra e pela largura do quadro (o mesmo texto ocupa mais do alto no 1:1 que
 * no 9:16), mais o respiro da caixa.
 */
export function alturaDoBloco(caracteres: number, tamanhoPx: number, largura: number, altura: number, respiro = 0.5): number {
  const porLinha = Math.max(4, Math.floor((largura * 0.8) / Math.max(1, tamanhoPx * 0.56)));
  const linhas = Math.max(1, Math.min(4, Math.ceil(Math.max(1, caracteres) / porLinha)));
  return Math.min(0.5, (tamanhoPx * (linhas * 1.12 + respiro)) / Math.max(1, altura));
}
