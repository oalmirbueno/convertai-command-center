/**
 * Personalização da empresa no produto CRM e E-mail: a cor de destaque, o
 * logo e o nome curto do topo. A cor é uma de seis, com um tom para o tema
 * escuro e outro para o claro, para o contraste nunca depender da escolha.
 * O banco só aceita o que está nesta lista (produto_aparencia_valida).
 */

export type CorDaEmpresa = "verde" | "azul" | "roxo" | "laranja" | "rosa" | "ciano";

export interface AparenciaDaEmpresa {
  cor?: CorDaEmpresa;
  nome_curto?: string;
  logo?: string;
}

export const CORES_DA_EMPRESA: Array<{ id: CorDaEmpresa; nome: string; escuro: string; claro: string; textoNoEscuro: string }> = [
  { id: "verde", nome: "Verde", escuro: "145 100% 50%", claro: "145 80% 38%", textoNoEscuro: "0 0% 5%" },
  { id: "azul", nome: "Azul", escuro: "212 100% 62%", claro: "216 88% 48%", textoNoEscuro: "0 0% 100%" },
  { id: "roxo", nome: "Roxo", escuro: "262 92% 70%", claro: "262 70% 52%", textoNoEscuro: "0 0% 100%" },
  { id: "laranja", nome: "Laranja", escuro: "26 100% 56%", claro: "22 92% 46%", textoNoEscuro: "0 0% 5%" },
  { id: "rosa", nome: "Rosa", escuro: "336 92% 64%", claro: "336 78% 48%", textoNoEscuro: "0 0% 100%" },
  { id: "ciano", nome: "Ciano", escuro: "188 92% 48%", claro: "190 90% 34%", textoNoEscuro: "0 0% 5%" },
];

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
 * muda nada: fica o tema do painel. As outras trocam só o destaque.
 */
export function variaveisDaCor(cor: CorDaEmpresa | undefined, tema: "dark" | "light"): Record<string, string> {
  const c = CORES_DA_EMPRESA.filter((x) => x.id === cor)[0];
  if (!c || c.id === "verde") return {};
  const tom = tema === "light" ? c.claro : c.escuro;
  return {
    "--primary": tom,
    "--ring": tom,
    "--accent": tom,
    "--success": tom,
    "--primary-foreground": tema === "light" ? "0 0% 100%" : c.textoNoEscuro,
    "--accent-foreground": tema === "light" ? "0 0% 100%" : c.textoNoEscuro,
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
