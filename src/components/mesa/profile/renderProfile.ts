import type { TemplateProfile } from "../../../../supabase/functions/estudio-arte/modulos/template-profile";

export const ALTURAS_PROFILE = { feed_4x5: 1350, retrato_3x4: 1440, quadrado_1x1: 1080, stories_9x16: 1920 } as const;
export type FormatoProfile = keyof typeof ALTURAS_PROFILE;

/** Quebra palavras e parágrafos sem cortar caracteres ou desenhar fora do quadro. */
export function linhasProfile(texto: string, largura: number, medir: (s: string) => number): string[] {
  const linhas: string[] = [];
  for (const paragrafo of texto.replace(/\r/g, "").split("\n")) {
    let linha = "";
    for (const palavra of paragrafo.trim().split(/\s+/).filter(Boolean)) {
      const candidata = linha ? `${linha} ${palavra}` : palavra;
      if (medir(candidata) <= largura) { linha = candidata; continue; }
      if (linha) { linhas.push(linha); linha = ""; }
      for (const letra of Array.from(palavra)) {
        if (linha && medir(linha + letra) > largura) { linhas.push(linha); linha = ""; }
        linha += letra;
      }
    }
    linhas.push(linha);
  }
  return linhas;
}

export function carregarImagemProfile(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Não foi possível carregar uma foto. Escolha outra em Fotos ou envie o avatar pelo campo Foto do perfil."));
    img.src = url;
  });
}

function caixa(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, raio: number) {
  const r = Math.max(0, Math.min(raio, w / 2, h / 2));
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

/** Preserva a foto inteira; a composição não regenera nem recorta o produto. */
function fotoInteira(ctx: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, w: number, h: number, raio: number, fundo: string) {
  ctx.save(); caixa(ctx, x, y, w, h, raio); ctx.clip(); ctx.fillStyle = fundo; ctx.fillRect(x, y, w, h);
  const escala = Math.min(w / img.naturalWidth, h / img.naturalHeight);
  const iw = img.naturalWidth * escala, ih = img.naturalHeight * escala;
  ctx.drawImage(img, x + (w - iw) / 2, y + (h - ih) / 2, iw, ih); ctx.restore();
}

function selo(ctx: CanvasRenderingContext2D, x: number, y: number) {
  ctx.fillStyle = "#2498ed"; ctx.beginPath(); ctx.arc(x, y, 13, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(x - 6, y); ctx.lineTo(x - 1, y + 5); ctx.lineTo(x + 7, y - 5); ctx.stroke();
}

export interface RecursosProfile { avatar?: HTMLImageElement | null; imagem?: HTMLImageElement | null }

/** Mesmo desenho na prévia e no PNG entregue; erro de tamanho nunca vira corte silencioso. */
export function desenharProfile(canvas: HTMLCanvasElement, template: TemplateProfile, formato: FormatoProfile, recursos: RecursosProfile = {}) {
  canvas.width = 1080; canvas.height = ALTURAS_PROFILE[formato];
  const ctx = canvas.getContext("2d"); if (!ctx) throw new Error("Seu navegador não disponibilizou a prévia do template.");
  const escuro = template.tema === "escuro";
  const fundo = template.cor_fundo || (escuro ? "#0b0d11" : "#ffffff");
  const tinta = escuro ? "#f4f5f7" : "#111418", cinza = escuro ? "#a7abb3" : "#626974";
  const insta = template.estilo === "instagram";
  const largura = insta ? 820 : 880, x = (1080 - largura) / 2, margem = 38;
  const interna = largura - margem * 2, gap = template.espacamento ?? 30, avatar = template.tamanho_foto ?? 76;
  const tamanho = template.tamanho_texto;
  ctx.font = `400 ${tamanho}px Arial, sans-serif`;
  const linhas = linhasProfile(template.texto, interna, (s) => ctx.measureText(s).width);
  const alturaTexto = linhas.length * tamanho * 1.32;
  const alturaCabecalho = Math.max(avatar, 78);
  const alturaImagem = recursos.imagem ? (insta ? Math.min(interna, 520) : interna * 9 / 16) : 0;
  const alturaIcones = insta ? 62 : 0;
  const altura = margem * 2 + alturaCabecalho + gap + alturaTexto + (alturaImagem ? gap + alturaImagem : 0) + alturaIcones;
  if (altura > canvas.height - 100) throw new Error("O texto não cabe neste formato. Reduza o tamanho, escolha um formato mais alto ou divida a lâmina antes de montar.");
  ctx.fillStyle = fundo; ctx.fillRect(0, 0, canvas.width, canvas.height);
  const y = (canvas.height - altura) / 2;
  ctx.strokeStyle = escuro ? "#292d35" : "#e3e6eb"; ctx.lineWidth = 2;
  caixa(ctx, x, y, largura, altura, insta ? 34 : 28); ctx.stroke();
  const ix = x + margem, iy = y + margem;
  ctx.save(); ctx.beginPath(); ctx.arc(ix + avatar / 2, iy + avatar / 2, avatar / 2, 0, Math.PI * 2); ctx.clip();
  if (recursos.avatar) {
    const img = recursos.avatar, lado = Math.min(img.naturalWidth, img.naturalHeight);
    ctx.drawImage(img, (img.naturalWidth - lado) / 2, (img.naturalHeight - lado) / 2, lado, lado, ix, iy, avatar, avatar);
  } else {
    ctx.fillStyle = escuro ? "#303743" : "#edf0f4"; ctx.fillRect(ix, iy, avatar, avatar);
    ctx.fillStyle = tinta; ctx.font = `600 ${Math.round(avatar * .4)}px Arial, sans-serif`; ctx.textAlign = "center";
    ctx.fillText(Array.from(template.nome.trim())[0]?.toUpperCase() || "?", ix + avatar / 2, iy + avatar * .64); ctx.textAlign = "left";
  }
  ctx.restore();
  const nx = ix + avatar + 20, maxNome = interna - avatar - 60;
  let nomeSize = 34; ctx.font = `700 ${nomeSize}px Arial, sans-serif`;
  while (ctx.measureText(template.nome).width > maxNome && nomeSize > 20) { nomeSize--; ctx.font = `700 ${nomeSize}px Arial, sans-serif`; }
  if (ctx.measureText(template.nome).width > maxNome) throw new Error("O nome do perfil é longo demais para o cabeçalho. Encurte o nome de exibição.");
  ctx.fillStyle = tinta; ctx.fillText(template.nome, nx, iy + 33);
  if (template.verificado) selo(ctx, nx + ctx.measureText(template.nome).width + 20, iy + 22);
  ctx.font = "400 25px Arial, sans-serif"; ctx.fillStyle = cinza;
  ctx.fillText(`@${template.username.replace(/^@/, "")}`, nx, iy + 65, maxNome);
  let cursor = iy + alturaCabecalho + gap;
  if (insta && recursos.imagem) { fotoInteira(ctx, recursos.imagem, ix, cursor, interna, alturaImagem, template.arredondamento ?? 16, fundo); cursor += alturaImagem + gap; }
  if (insta) {
    ctx.fillStyle = cinza; ctx.font = "400 28px Arial, sans-serif"; ctx.fillText("♡   ◯   ↗", ix, cursor + 20); cursor += alturaIcones;
  }
  ctx.font = `400 ${tamanho}px Arial, sans-serif`; ctx.fillStyle = tinta; ctx.textBaseline = "top";
  for (const linha of linhas) { ctx.fillText(linha, ix, cursor); cursor += tamanho * 1.32; }
  ctx.textBaseline = "alphabetic";
  if (!insta && recursos.imagem) fotoInteira(ctx, recursos.imagem, ix, cursor + gap, interna, alturaImagem, template.arredondamento ?? 16, fundo);
}
