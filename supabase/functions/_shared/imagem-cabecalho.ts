/**
 * O que se sabe de uma imagem sem abri-la: largura e altura pelo cabeçalho,
 * tipo pela assinatura dos bytes e as contas de área e de lâmina (frações de
 * 0 a 1). Nenhum pixel é lido aqui.
 *
 * FN-01 (30/09/2026): estas funções moravam em imagem-local.ts, que carrega o
 * imagescript. Quem só precisava do cabeçalho pagava a carga do imagescript
 * na partida da função (cerca de 2 s por chamada, inclusive no OPTIONS).
 * Este arquivo não importa nada: as funções leem só o cabeçalho. imagem-local.ts
 * continua exportando tudo daqui, então quem já importava de lá segue igual.
 */

export const LARGURA_LAMINA = 1088;
export const ALTURA_LAMINA = 1360;

/** Área relativa à lâmina, de 0 a 1 (canto superior esquerdo até o inferior direito). */
export type Area = { x0: number; y0: number; x1: number; y1: number };

const limitar = (v: number) => Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));

/** Normaliza as áreas pedidas pela tela: ordena os cantos, corta em [0,1] e descarta áreas vazias. */
export function normalizarAreas(bruto: unknown, max = 6): Area[] {
  if (!Array.isArray(bruto)) return [];
  const saida: Area[] = [];
  for (const a of bruto.slice(0, max)) {
    if (!a || typeof a !== "object") continue;
    const r = a as Record<string, unknown>;
    const xa = limitar(Number(r.x0)), xb = limitar(Number(r.x1));
    const ya = limitar(Number(r.y0)), yb = limitar(Number(r.y1));
    const area = { x0: Math.min(xa, xb), y0: Math.min(ya, yb), x1: Math.max(xa, xb), y1: Math.max(ya, yb) };
    if (area.x1 - area.x0 >= 0.02 && area.y1 - area.y0 >= 0.02) saida.push(area);
  }
  return saida;
}

/**
 * Largura e altura lidas só do cabeçalho (PNG, JPEG, WebP, GIF), sem abrir a
 * imagem. Nulo quando o formato não é reconhecido.
 */
export function dimensoesDoCabecalho(b: Uint8Array): { largura: number; altura: number } | null {
  const u16 = (i: number) => (b[i] << 8) | b[i + 1];
  const u32 = (i: number) => ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3];
  const le16 = (i: number) => b[i] | (b[i + 1] << 8);
  if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    return { largura: u32(16), altura: u32(20) };
  }
  if (b.length > 10 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return { largura: le16(6), altura: le16(8) };
  if (b.length > 30 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45) {
    const tipo = String.fromCharCode(b[12], b[13], b[14], b[15]);
    if (tipo === "VP8X") return { largura: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), altura: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)) };
    if (tipo === "VP8 ") return { largura: le16(26) & 0x3fff, altura: le16(28) & 0x3fff };
    if (tipo === "VP8L") {
      const v = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
      return { largura: (v & 0x3fff) + 1, altura: ((v >> 14) & 0x3fff) + 1 };
    }
    return null;
  }
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1];
      // SOF0..SOF15, menos DHT (C4), JPG (C8) e DAC (CC).
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { altura: u16(i + 5), largura: u16(i + 7) };
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
      i += 2 + u16(i + 2);
    }
  }
  return null;
}

/** Tipo pela assinatura dos bytes (PNG, JPEG, WebP, GIF). */
export function mimeDaImagem(b: Uint8Array): string | null {
  if (b.length < 12) return null;
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return "image/gif";
  return null;
}

/**
 * Onde o gerador pôs a foto: o ponto (u, v) do gerado, de 0 a 1, mostra o
 * ponto (cu + (u - 0,5) / escala, cv + (v - 0,5) / escala) do original.
 * Escala acima de 1 = o gerador aproximou (zoom).
 */
export type Alinhamento = { escala: number; cu: number; cv: number };
export const IDENTIDADE: Alinhamento = { escala: 1, cu: 0.5, cv: 0.5 };

/**
 * Caixa do quadro final (fração) dentro da imagem que o gerador devolveu:
 * iguais quando a proporção bate; senão o quadro é o recorte central "cover"
 * (a reserva em 2:3 do 4:5 corta as faixas de cima e de baixo).
 */
export function caixaNoQuadroCentral(caixa: Area, largura: number, altura: number, proporcaoDoQuadro?: number | null): Area {
  if (!proporcaoDoQuadro || !largura || !altura) return caixa;
  const r = largura / altura;
  if (Math.abs(r - proporcaoDoQuadro) / proporcaoDoQuadro < 0.02) return caixa;
  if (r < proporcaoDoQuadro) {
    // Imagem mais alta que o quadro: faixas em cima e embaixo.
    const h = largura / proporcaoDoQuadro / altura;
    const o = (1 - h) / 2;
    return { x0: caixa.x0, x1: caixa.x1, y0: o + caixa.y0 * h, y1: o + caixa.y1 * h };
  }
  const w = (altura * proporcaoDoQuadro) / largura;
  const o = (1 - w) / 2;
  return { x0: o + caixa.x0 * w, x1: o + caixa.x1 * w, y0: caixa.y0, y1: caixa.y1 };
}

/** Amplia a área em volta (margem relativa), para o gerador ter espaço de fundir a borda. */
export function ampliar(a: Area, margem = 0.03): Area {
  return { x0: limitar(a.x0 - margem), y0: limitar(a.y0 - margem), x1: limitar(a.x1 + margem), y1: limitar(a.y1 + margem) };
}

/** Tamanho do trecho de k lâminas lado a lado (múltiplos de 16, proporção até 2,4:1). */
export const tamanhoDoTrecho = (k: number) => `${LARGURA_LAMINA * k}x${ALTURA_LAMINA}`;

/** União das áreas marcadas (frações), para colar a foto exata numa caixa só. */
export function uniaoDasAreas(areas: Area[]): Area | null {
  if (!areas.length) return null;
  return {
    x0: Math.min(...areas.map((a) => a.x0)),
    y0: Math.min(...areas.map((a) => a.y0)),
    x1: Math.max(...areas.map((a) => a.x1)),
    y1: Math.max(...areas.map((a) => a.y1)),
  };
}
