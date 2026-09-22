/**
 * Amostra da fonte do cliente, gerada no navegador (SPEC seção 7).
 *
 * O gerador de imagem não lê arquivo .ttf; ele lê imagem. Então a fonte vira
 * uma prancha PNG com o nome e o texto de exemplo em tamanhos grandes e
 * pequenos, e essa prancha vai junto como referência de tipografia.
 *
 * Compatível com Safari 11 / Chrome 64: FontFace, canvas.toBlob e
 * FileReader (File.arrayBuffer só chegou no Safari 14).
 */

export function lerComoArrayBuffer(arquivo: Blob): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const leitor = new FileReader();
    leitor.onload = () => resolve(leitor.result as ArrayBuffer);
    leitor.onerror = () => reject(new Error("Não foi possível ler o arquivo da fonte."));
    leitor.readAsArrayBuffer(arquivo);
  });
}

const LARGURA = 1600;
const ALTURA = 1100;
const MARGEM = 80;

const LINHAS = [
  { tamanho: 132, texto: "" },
  { tamanho: 96, texto: "Aa Bb Cc Gg 0123" },
  { tamanho: 60, texto: "Ação, coração, pão e café" },
  { tamanho: 36, texto: "Um título forte cabe em poucas palavras." },
  { tamanho: 24, texto: "ABCDEFGHIJKLMNOPQRSTUVWXYZ abcdefghijklmnopqrstuvwxyz 0123456789 !?.,;:" },
  { tamanho: 16, texto: "Texto pequeno para conferir a leitura no celular: é, ê, ã, õ, ç, ü." },
];

/** Desenha a prancha com a fonte e devolve o PNG. */
export async function gerarAmostraDaFonte(arquivo: Blob, nome: string): Promise<Blob> {
  const FontFaceCtor = (window as any).FontFace;
  const fontes = (document as any).fonts;
  if (!FontFaceCtor || !fontes) throw new Error("Este navegador não consegue gerar a amostra da fonte.");

  const buffer = await lerComoArrayBuffer(arquivo);
  const familia = `mesa-amostra-${Math.random().toString(36).slice(2, 10)}`;
  const face = new FontFaceCtor(familia, buffer);
  await face.load();
  fontes.add(face);

  try {
    const canvas = document.createElement("canvas");
    canvas.width = LARGURA;
    canvas.height = ALTURA;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Este navegador não desenha a amostra da fonte.");

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, LARGURA, ALTURA);
    ctx.textBaseline = "top";

    let y = MARGEM;
    LINHAS.forEach((linha, i) => {
      const texto = i === 0 ? nome || "Fonte" : linha.texto;
      let tamanho = linha.tamanho;
      ctx.font = `${tamanho}px "${familia}"`;
      // Encolhe até caber na largura útil, para nada sair cortado.
      while (tamanho > 10 && ctx.measureText(texto).width > LARGURA - MARGEM * 2) {
        tamanho -= 2;
        ctx.font = `${tamanho}px "${familia}"`;
      }
      ctx.fillStyle = i === 0 ? "#111111" : "#222222";
      ctx.fillText(texto, MARGEM, y);
      y += Math.round(tamanho * 1.45) + (i === 0 ? 24 : 12);
    });

    // Rodapé discreto com o nome da fonte em tamanho fixo de sistema.
    ctx.font = '18px -apple-system, "Segoe UI", Roboto, sans-serif';
    ctx.fillStyle = "#888888";
    ctx.fillText(`Amostra da fonte ${nome}`, MARGEM, ALTURA - MARGEM + 20);

    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Não foi possível gerar o PNG da amostra."))), "image/png");
    });
  } finally {
    try { fontes.delete(face); } catch { /* sem suporte: fica carregada até fechar a aba */ }
  }
}

export const FORMATOS_DE_FONTE = ["ttf", "otf", "woff", "woff2"];

export const TIPO_DA_FONTE: Record<string, string> = {
  ttf: "font/ttf",
  otf: "font/otf",
  woff: "font/woff",
  woff2: "font/woff2",
};
