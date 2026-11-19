/**
 * Personalização da empresa no produto CRM e E-mail: a cor de destaque, o
 * logo e o nome curto do topo. A cor é uma de seis, com um tom para o tema
 * escuro e outro para o claro, para o contraste nunca depender da escolha.
 * O banco só aceita o que está nesta lista (produto_aparencia_valida).
 *
 * Regra de cor (19/11/2026, 60-30-10): a cor escolhida é o ÚNICO destaque e
 * vale como preenchimento de botão. Cada tom passa a WCAG 2.2 AA nos dois
 * temas: texto no botão 4,5:1, botão contra o fundo e o cartão 3:1, e o tom
 * usado como texto 4,5:1 (src/test/contraste-tokens.test.ts confere).
 */

// Import relativo com ".ts" (sem "@/") para o Node importar direto no script de contraste.
import { MINIMO, luminancia, montarHsl, nota, partesHsl, razaoDeContraste, type Nota } from "../design/contraste.ts";

export type CorDaEmpresa = "verde" | "azul" | "roxo" | "laranja" | "rosa" | "ciano";

export interface AparenciaDaEmpresa {
  cor?: CorDaEmpresa;
  nome_curto?: string;
  logo?: string;
}

export interface CorDaPaleta {
  id: CorDaEmpresa;
  nome: string;
  /** Tom de preenchimento (botão, anel, barra) em cada tema. */
  escuro: string;
  claro: string;
  /** Texto em cima do botão em cada tema. */
  textoNoEscuro: string;
  textoNoClaro: string;
  /** Tom usado como TEXTO no claro quando o de preenchimento não lê sobre o fundo. Sem ele, é o próprio `claro`. */
  tomDoTextoNoClaro?: string;
}

const QUASE_PRETO = "0 0% 5%";
const BRANCO = "0 0% 100%";

export const CORES_DA_EMPRESA: CorDaPaleta[] = [
  // Verde é o do painel (src/index.css): no claro, preenchimento vivo com texto quase preto e um tom mais fundo para texto.
  { id: "verde", nome: "Verde", escuro: "145 100% 50%", claro: "145 80% 34%", textoNoEscuro: QUASE_PRETO, textoNoClaro: "150 30% 4%", tomDoTextoNoClaro: "145 85% 23%" },
  { id: "azul", nome: "Azul", escuro: "212 100% 62%", claro: "216 88% 48%", textoNoEscuro: QUASE_PRETO, textoNoClaro: BRANCO, tomDoTextoNoClaro: "216 88% 44%" },
  { id: "roxo", nome: "Roxo", escuro: "262 92% 70%", claro: "262 70% 52%", textoNoEscuro: QUASE_PRETO, textoNoClaro: BRANCO },
  { id: "laranja", nome: "Laranja", escuro: "26 100% 56%", claro: "22 92% 46%", textoNoEscuro: QUASE_PRETO, textoNoClaro: QUASE_PRETO, tomDoTextoNoClaro: "22 92% 36%" },
  { id: "rosa", nome: "Rosa", escuro: "336 92% 64%", claro: "336 78% 48%", textoNoEscuro: QUASE_PRETO, textoNoClaro: BRANCO, tomDoTextoNoClaro: "336 78% 40%" },
  { id: "ciano", nome: "Ciano", escuro: "188 92% 48%", claro: "190 90% 34%", textoNoEscuro: QUASE_PRETO, textoNoClaro: QUASE_PRETO, tomDoTextoNoClaro: "190 90% 28%" },
];

/** Fundo (60%) e cartão (30%) de cada tema, iguais aos de src/index.css (o teste confere). */
export const SUPERFICIES_DO_TEMA: Record<"dark" | "light", { fundo: string; cartao: string }> = {
  dark: { fundo: "240 4% 4.5%", cartao: "240 5% 8.6%" },
  light: { fundo: "140 8% 94.5%", cartao: "0 0% 100%" },
};

/**
 * O cartão de tinta (.ds-ink) de cada tema, igual ao de src/index.css (o teste confere):
 * cartão (--card-ink), poço (--card-ink-well) e o texto em cima do destaque
 * (--primary-foreground do .ds-ink). No escuro ele é claro; no claro, escuro.
 */
export const SUPERFICIES_DA_TINTA: Record<"dark" | "light", { cartao: string; poco: string; textoNoBotao: string }> = {
  dark: { cartao: "240 6% 94%", poco: "240 5% 87%", textoNoBotao: BRANCO },
  light: { cartao: "240 6% 10%", poco: "240 5% 16%", textoNoBotao: "150 30% 4%" },
};

export interface TonsDaCor {
  /** Preenchimento: botão, anel, barra, cartão de destaque. */
  tom: string;
  textoNoBotao: string;
  /** O tom quando vira texto (text-primary). */
  tomDoTexto: string;
  /** Fundo suave de etiqueta (bg-accent-soft). */
  suave: string;
  /** Poço e borda dentro do cartão de destaque (--accent-solid-deep). */
  fundo: string;
  /** Texto apagado dentro do cartão de destaque (--on-accent-muted), sobre o tom e sobre o poço. */
  apagado: string;
  /** Destaque dentro do cartão de tinta .ds-ink (--card-ink-accent): texto, anel e gráfico. */
  tomDaTinta: string;
}

/** Os tons derivados da cor escolhida (verde ou nada: o verde do painel). */
export function tonsDaCor(cor: CorDaEmpresa | undefined, tema: "dark" | "light"): TonsDaCor {
  const c = CORES_DA_EMPRESA.filter((x) => x.id === cor)[0] || CORES_DA_EMPRESA[0];
  const claro = tema === "light";
  const tom = claro ? c.claro : c.escuro;
  const textoNoBotao = claro ? c.textoNoClaro : c.textoNoEscuro;
  const [h, s, l] = partesHsl(tom);
  const textoEscuro = luminancia(textoNoBotao) < 0.5;
  const le = (frente: string, fundo: string) => razaoDeContraste(frente, fundo) >= MINIMO.texto;
  // Poço: um degrau mais fundo; se o texto do botão deixar de ler, um degrau mais claro.
  const maisFundo = montarHsl(h, s, l - 6);
  const fundo = le(textoNoBotao, maisFundo) ? maisFundo : montarHsl(h, s, l + 6);
  const candidatos = textoEscuro ? [montarHsl(h, 45, 14), montarHsl(h, 50, 9)] : [montarHsl(h, 60, 96), montarHsl(h, 40, 98)];
  // O apagado é o --muted-foreground do .ds-accent: lê sobre o cartão (tom) e sobre o poço (--muted = fundo).
  const apagado = candidatos.filter((x) => le(x, tom) && le(x, fundo))[0] || textoNoBotao;
  // Destaque do cartão .ds-ink (--card-ink-accent): no escuro o cartão de tinta é claro, no claro é escuro.
  // Parte do tom que já lê nesse tipo de fundo e anda na luminosidade até passar no cartão, no poço e com o texto em cima.
  const tinta = SUPERFICIES_DA_TINTA[tema];
  const passaNaTinta = (x: string) => le(x, tinta.cartao) && le(x, tinta.poco) && le(tinta.textoNoBotao, x);
  const [th, ts, tl] = partesHsl(claro ? c.escuro : c.tomDoTextoNoClaro || c.claro);
  let tomDaTinta = montarHsl(th, ts, tl);
  for (let passo = 1; passo <= 50 && !passaNaTinta(tomDaTinta); passo += 1) tomDaTinta = montarHsl(th, ts, claro ? tl + passo : tl - passo);
  return {
    tom,
    textoNoBotao,
    tomDoTexto: claro ? c.tomDoTextoNoClaro || c.claro : c.escuro,
    suave: claro ? montarHsl(h, 65, 92) : montarHsl(h, 70, 11),
    fundo,
    apagado,
    tomDaTinta,
  };
}

export interface ContrasteDaCor {
  /** Texto em cima do botão (mínimo 4,5). */
  botao: number;
  /** Botão contra o fundo da página (mínimo 3). */
  fundo: number;
  /** Botão contra o cartão (mínimo 3). */
  cartao: number;
  /** O tom como texto, no pior entre fundo e cartão (mínimo 4,5). */
  texto: number;
  notaBotao: Nota;
}

/** As razões de contraste da cor escolhida no tema, para a prévia e para o teste. */
export function contrasteDaCor(cor: CorDaEmpresa | undefined, tema: "dark" | "light"): ContrasteDaCor {
  const t = tonsDaCor(cor, tema);
  const sup = SUPERFICIES_DO_TEMA[tema];
  const botao = razaoDeContraste(t.textoNoBotao, t.tom);
  return {
    botao,
    fundo: razaoDeContraste(t.tom, sup.fundo),
    cartao: razaoDeContraste(t.tom, sup.cartao),
    texto: Math.min(razaoDeContraste(t.tomDoTexto, sup.fundo), razaoDeContraste(t.tomDoTexto, sup.cartao)),
    notaBotao: nota(botao),
  };
}

/** Lê a aparência como veio do banco, sem confiar no formato. */
export function lerAparencia(bruto: unknown): AparenciaDaEmpresa {
  const o = (bruto && typeof bruto === "object" ? bruto : {}) as Record<string, unknown>;
  const cor = CORES_DA_EMPRESA.filter((c) => c.id === o.cor)[0];
  const logo = typeof o.logo === "string" && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(o.logo) ? o.logo : undefined;
  const nome = typeof o.nome_curto === "string" ? o.nome_curto.trim().slice(0, 40) : "";
  return { ...(cor ? { cor: cor.id } : {}), ...(nome ? { nome_curto: nome } : {}), ...(logo ? { logo } : {}) };
}

/**
 * As variáveis de cor para a casca do produto. Verde (ou nada escolhido) não
 * muda nada: fica o tema do painel. As outras trocam o destaque inteiro (ele é
 * um só): botão, anel, texto de destaque, etiqueta suave, o cartão .ds-accent e o
 * destaque do cartão .ds-ink (--card-ink-accent).
 */
export function variaveisDaCor(cor: CorDaEmpresa | undefined, tema: "dark" | "light"): Record<string, string> {
  const c = CORES_DA_EMPRESA.filter((x) => x.id === cor)[0];
  if (!c || c.id === "verde") return {};
  const t = tonsDaCor(c.id, tema);
  return {
    "--primary": t.tom,
    "--ring": t.tom,
    "--accent": t.tom,
    "--chart-1": t.tom,
    // No claro, estado de sucesso é texto: usa o tom que lê (como o --success do painel).
    "--success": tema === "light" ? t.tomDoTexto : t.tom,
    "--primary-foreground": t.textoNoBotao,
    "--accent-foreground": t.textoNoBotao,
    "--primary-text": t.tomDoTexto,
    "--accent-soft": t.suave,
    "--success-soft": t.suave,
    "--accent-solid": t.tom,
    "--accent-solid-deep": t.fundo,
    "--on-accent": t.textoNoBotao,
    "--on-accent-muted": t.apagado,
    "--card-ink-accent": t.tomDaTinta,
  };
}

/** O maior lado do logo guardado e o teto do texto (o mesmo teto do banco). */
export const LADO_DO_LOGO = 320;
export const TETO_DO_LOGO = 160000;

/**
 * Reduz a imagem escolhida para caber no topo e no banco: no máximo 320 px no
 * maior lado, em PNG (mantém a transparência). Devolve o texto da imagem.
 */
export function prepararLogo(arquivo: File): Promise<string> {
  return new Promise((resolver, recusar) => {
    if (!/^image\/(png|jpeg|webp|svg\+xml)$/.test(arquivo.type)) return recusar(new Error("Use uma imagem PNG, JPG, WebP ou SVG."));
    if (arquivo.size > 8 * 1024 * 1024) return recusar(new Error("A imagem passa de 8 MB."));
    const leitor = new FileReader();
    leitor.onerror = () => recusar(new Error("Não foi possível ler a imagem."));
    leitor.onload = () => {
      const img = new Image();
      img.onerror = () => recusar(new Error("Não foi possível abrir a imagem."));
      img.onload = () => {
        const maior = Math.max(img.width, img.height) || 1;
        const escala = Math.min(1, LADO_DO_LOGO / maior);
        const tela = document.createElement("canvas");
        tela.width = Math.max(1, Math.round(img.width * escala));
        tela.height = Math.max(1, Math.round(img.height * escala));
        const ctx = tela.getContext("2d");
        if (!ctx) return recusar(new Error("O navegador não conseguiu preparar a imagem."));
        ctx.drawImage(img, 0, 0, tela.width, tela.height);
        const saida = tela.toDataURL("image/png");
        if (saida.length > TETO_DO_LOGO) return recusar(new Error("O logo ficou pesado demais. Use uma imagem mais simples."));
        resolver(saida);
      };
      img.src = String(leitor.result);
    };
    leitor.readAsDataURL(arquivo);
  });
}
