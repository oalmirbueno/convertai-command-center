import type { BlocoDaLamina, GraficoDoBloco, MidiaDoBloco, TemplateProfile } from "../../../../supabase/functions/estudio-arte/modulos/template-profile";
import type { SugestaoDoCarrossel, VideoGuardado } from "../../../../supabase/functions/estudio-arte/modulos/template-carrossel";
import type { FonteAplicada } from "../ImagensReaisDoDiretor";
import { BLOCO_PADRAO, type MidiaCarregada } from "./renderCarrossel";
import { fontesDoProfile, type CardComFontes, type FonteProfile } from "./fontesDoProfile";

/**
 * Bloco de mídia do carrossel estilo X (22/10/2026): regras puras da tela. De onde sai o bloco
 * inicial de cada lâmina (a versão guardada, a sugestão do gerador com a mídia real já
 * importada, ou nada), como uma fonte vira a mídia do bloco e como a mídia é carregada para a
 * prévia (imagem inteira ou o quadro do vídeo). Sem nada colado por cima: a mídia vai inteira.
 */

export type CardDoCarrossel = CardComFontes & {
  carrossel?: SugestaoDoCarrossel;
  videos_reais?: VideoGuardado[];
};

export const ROTULO_DO_TIPO: Record<BlocoDaLamina["tipo"], string> = { imagem: "Imagem", video: "Vídeo", grafico: "Gráfico", manchete: "Manchete", perfil: "Perfil", nenhum: "Só texto" };

const ext = (c: string) => (/\.([a-z0-9]{2,5})$/i.exec(c)?.[1] || "").toLowerCase();
export const ehVideo = (caminho: string) => ["mp4", "mov", "webm", "m4v", "mkv"].indexOf(ext(caminho)) >= 0;
export const ehImagem = (caminho: string) => ["png", "jpg", "jpeg", "webp"].indexOf(ext(caminho)) >= 0;

/** Uma fonte de imagem da lâmina (gerada, internet, cliente) como mídia do bloco, com o crédito quando há. */
export function midiaDaFonte(f: FonteProfile): MidiaDoBloco | null {
  if (f.bucket !== "mesa" && f.bucket !== "workspace") return null;
  const origem: MidiaDoBloco["origem"] = f.grupo === "gerada" ? "gerada" : f.grupo === "internet" ? "internet" : f.acervo_id ? "acervo" : "cliente";
  const midia: MidiaDoBloco = { bucket: f.bucket, caminho: f.caminho, origem };
  if (f.grupo === "internet" && f.url && f.licenca) midia.credito = { fonte: f.origem.replace(/^Imagem real · |^Logo real · /, "").slice(0, 60) || "Internet", autor: /^Notícia · /.test(f.origem) ? null : f.autor || null, licenca: f.licenca.slice(0, 120), url: f.url.slice(0, 600) };
  return midia;
}

/** Um vídeo real importado (Pexels, Wikimedia, Internet Archive) como mídia do bloco, com o crédito guardado. */
export function midiaDoVideoReal(v: VideoGuardado): MidiaDoBloco {
  return {
    bucket: "mesa", caminho: v.caminho, origem: "internet",
    ...(v.duracao_s ? { duracao_s: v.duracao_s } : {}),
    credito: { fonte: v.banco === "pexels" ? "Pexels" : v.banco === "arquivo" ? "Internet Archive" : "Wikimedia Commons", autor: v.autor ? v.autor.slice(0, 160) : null, licenca: v.licenca.slice(0, 120), url: v.pagina_url.slice(0, 600) },
  };
}

const NOME_DO_BANCO_DE_IMAGEM: Record<NonNullable<FonteAplicada["banco"]>, string> = { noticias: "Notícia", wikimedia: "Wikimedia", openverse: "Openverse", pexels: "Pexels" };

/**
 * A imagem que a busca acabou de guardar como mídia do bloco, com o crédito (23/10). Foto de matéria leva o
 * veículo no crédito ("Notícia · Forbes Brasil") e já sai com o crédito escrito na lâmina.
 */
export function midiaDaFonteAplicada(f: FonteAplicada): { midia: MidiaDoBloco; creditoNaLamina: boolean } | null {
  if (!f.caminho) return null;
  const midia: MidiaDoBloco = { bucket: "mesa", caminho: f.caminho, origem: "internet" };
  const url = (f.fonte_url || "").slice(0, 600);
  if (url && /^https:\/\//.test(url)) {
    const banco = f.banco ? NOME_DO_BANCO_DE_IMAGEM[f.banco] : "Internet";
    const fonte = (f.banco === "noticias" && f.autor ? `${banco} · ${f.autor}` : banco).slice(0, 60);
    midia.credito = { fonte, autor: f.banco === "noticias" ? null : (f.autor || null), licenca: (f.licenca || "Confira a licença na fonte").slice(0, 120), url };
  }
  return { midia, creditoNaLamina: f.banco === "noticias" };
}

/**
 * Bloco inicial da lâmina: a versão guardada manda; sem ela, a sugestão do gerador (o tipo que o
 * Jev escolheu, com o vídeo ou a foto real que já entrou na lâmina, o gráfico e a manchete).
 */
export function blocoInicialDaLamina(card: CardDoCarrossel, salvo?: TemplateProfile, clientId?: string): BlocoDaLamina {
  if (salvo?.estilo === "carrossel" && salvo.bloco) return salvo.bloco;
  const s = card.carrossel;
  if (!s) return { ...BLOCO_PADRAO };
  const base = { ...BLOCO_PADRAO };
  if (s.midia === "grafico" && s.grafico) return { ...base, tipo: "grafico", grafico: s.grafico as GraficoDoBloco };
  if (s.midia === "manchete" && s.manchete) return { ...base, tipo: "manchete", borda: true, manchete: s.manchete };
  if (s.midia === "video_real") {
    const v = (card.videos_reais || [])[(card.videos_reais || []).length - 1];
    return v ? { ...base, tipo: "video", midia: midiaDoVideoReal(v) } : { ...base, tipo: "video" };
  }
  if (s.midia === "foto_real" || s.midia === "imagem_ia") {
    const fontes = fontesDoProfile(card, [], clientId);
    const f = fontes.find((x) => x.grupo === (s.midia === "foto_real" ? "internet" : "gerada")) || fontes[0];
    const midia = f ? midiaDaFonte(f) : null;
    // Foto de matéria (23/10): o crédito do veículo já sai escrito embaixo do bloco.
    return midia ? { ...base, tipo: "imagem", midia, ...(midia.credito && /^Notícia · /.test(midia.credito.fonte) ? { credito_visivel: true } : {}) } : { ...base, tipo: "imagem" };
  }
  return base;
}

/** A mídia que o bloco precisa carregar (imagem ou vídeo), ou nada. */
export const midiaParaCarregar = (b: BlocoDaLamina | undefined): MidiaDoBloco | null => (b && (b.tipo === "imagem" || b.tipo === "video") && b.midia ? b.midia : null);

/** Bloco pronto para guardar: imagem e vídeo precisam da mídia; gráfico de 2+ números; manchete com título. */
export function pendenciaDoBloco(b: BlocoDaLamina | undefined): string {
  if (!b || b.tipo === "nenhum") return "";
  if ((b.tipo === "imagem" || b.tipo === "video") && !b.midia) return b.tipo === "video" ? "Escolha o vídeo do bloco" : "Escolha a imagem do bloco";
  if (b.tipo === "grafico" && (!b.grafico || (b.grafico.tipo === "tabela" ? !(b.grafico.linhas || []).length : b.grafico.dados.length < (b.grafico.tipo === "numero" ? 1 : 2)))) return b.grafico?.tipo === "numero" ? "O número grande precisa de um valor" : "O gráfico precisa de pelo menos dois números";
  if (b.tipo === "perfil" && (!b.perfil || !b.perfil.nome.trim() || !/^[a-zA-Z0-9_.]{1,30}$/.test(b.perfil.username.replace(/^@/, "")))) return "Preencha o nome e o @ do perfil";
  if (b.tipo === "manchete" && (!b.manchete || !b.manchete.titulo.trim() || !b.manchete.veiculo.trim())) return "Preencha o veículo e o título da manchete";
  return "";
}

/** Imagem inteira para a prévia. */
function carregarImagem(url: string): Promise<MidiaCarregada> {
  return new Promise((ok, falhou) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => ok({ fonte: img, largura: img.naturalWidth, altura: img.naturalHeight });
    img.onerror = () => falhou(new Error("Não foi possível carregar a imagem do bloco. Escolha outra."));
    img.src = url;
  });
}

/** O quadro do vídeo em 0,5 s (o mesmo que fica no PNG da lâmina; o MP4 sai pela fila de render). */
function carregarQuadroDoVideo(url: string): Promise<MidiaCarregada> {
  return new Promise((ok, falhou) => {
    const v = document.createElement("video");
    v.crossOrigin = "anonymous"; v.muted = true; v.playsInline = true; v.preload = "auto";
    const erro = () => falhou(new Error("Não foi possível abrir o vídeo do bloco. Use MP4 ou WebM."));
    v.onerror = erro;
    v.onloadeddata = () => { try { v.currentTime = Math.min(0.5, (v.duration || 1) / 2); } catch { erro(); } };
    v.onseeked = () => ok({ fonte: v, largura: v.videoWidth || 1920, altura: v.videoHeight || 1080 });
    v.src = url;
  });
}

export function carregarMidiaDoBloco(url: string, tipo: "imagem" | "video"): Promise<MidiaCarregada> {
  return tipo === "video" ? carregarQuadroDoVideo(url) : carregarImagem(url);
}
