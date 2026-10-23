import { useEffect, useRef, useState } from "react";
import { useMarcaDaMesa, useUrlDaMesa } from "../MesaContexto";
import type { CardDaDirecao, CardGerado } from "../useItensDoMes";
import { carregarImagemProfile, desenharProfile } from "./renderProfile";
import { fontesDoProfile, referenciaDaFonteProfile, resolverFonteProfile, type CardComFontes } from "./fontesDoProfile";
import { chaveDoRascunho, useBaseDoTemplate, useRascunhoSoLeitura } from "./rascunhoDoTemplate";
import { blocoInicialDaLamina, carregarMidiaDoBloco, midiaParaCarregar, type CardDoCarrossel } from "./blocoDaLamina";
import type { BlocoDaLamina, TemplateProfile } from "../../../../supabase/functions/estudio-arte/modulos/template-profile";

/** O que a lâmina leva do próprio rascunho (o resto, perfil e foto, vem da lâmina aberta). */
const CAMPOS_DA_LAMINA = ["tema", "cor_fundo", "tamanho_texto", "peso_texto", "seta", "rodape_cinza", "verificado", "espacamento", "tamanho_foto", "arredondamento", "escala", "midia", "proporcao", "ocultar_numeros", "ocultar_tempo", "fio"] as const;
type RascunhoDaLamina = Partial<TemplateProfile> & { sem_imagem?: boolean };

/**
 * O desenho da lâmina na prancheta: o rascunho dela (fundo, tamanho, selo e o bloco de mídia escolhido, mesmo
 * antes de guardar) sobre a base da lâmina aberta (perfil e foto). Sem rascunho, a versão guardada ou a
 * sugestão do gerador. Exportado para a miniatura e para o estado da lâmina na prancheta.
 */
export function useLaminaNoTemplate(trabalhoId: string, clientId: string, card: CardDaDirecao, versao?: CardGerado) {
  const { marca } = useMarcaDaMesa();
  const base = useBaseDoTemplate(trabalhoId);
  const rascunho = useRascunhoSoLeitura<RascunhoDaLamina>(chaveDoRascunho(clientId, marca?.id, trabalhoId, card.ordem));
  const salvo = versao?.template_profile;
  const proprio: Partial<TemplateProfile> = {};
  if (rascunho) for (const k of CAMPOS_DA_LAMINA) if (rascunho[k] !== undefined) (proprio as Record<string, unknown>)[k] = rascunho[k];
  // O modelo (post ou carrossel) é o da lâmina aberta: o Montar todas usa o mesmo para todas.
  const estilo = base?.template.estilo;
  const carrossel = estilo === "carrossel";
  const bloco: BlocoDaLamina | undefined = carrossel ? (rascunho?.bloco || blocoInicialDaLamina(card as CardDoCarrossel, salvo, clientId)) : undefined;
  return { base, rascunho, proprio, carrossel, bloco };
}

/** A lâmina tem conteúdo no bloco (mídia, gráfico ou manchete), guardada ou não. */
export const blocoComConteudo = (b: BlocoDaLamina | undefined) => !!b && ((b.tipo === "imagem" || b.tipo === "video") ? !!b.midia : b.tipo === "grafico" ? !!b.grafico : b.tipo === "manchete" ? !!b.manchete : b.tipo === "perfil" ? !!b.perfil : false);

/**
 * O estado curto da lâmina na prancheta do Template, no lugar do "sem arte" (23/10, dono: "no meio aparece,
 * mas na lateral não pareceu atualizado"): sem versão guardada, diz se a lâmina já tem mídia ou é só texto.
 */
export function EstadoDaLaminaNoTemplate({ trabalhoId, clientId, card, versao }: { trabalhoId: string; clientId: string; card: CardDaDirecao; versao?: CardGerado }) {
  const { carrossel, bloco } = useLaminaNoTemplate(trabalhoId, clientId, card, versao);
  const rotulo = carrossel ? (blocoComConteudo(bloco) ? (bloco!.tipo === "video" ? "vídeo" : bloco!.tipo === "grafico" ? "gráfico" : bloco!.tipo === "manchete" ? "manchete" : bloco!.tipo === "perfil" ? "perfil" : "imagem") : "só texto") : "post";
  return <span className="ml-1 shrink-0 text-[11px] text-muted-foreground" title="Ainda não guardada: use Guardar nova versão ou Montar todas as lâminas" data-estado-no-template={rotulo}>{rotulo}</span>;
}

/**
 * Card da prancheta no modo Template · X (rodada 3, 21/10, dono: "nada da arte do carrossel ali"): a
 * miniatura é o post do X daquela lâmina, desenhado ao vivo pelo mesmo renderProfile, com o texto da
 * lâmina e o rascunho dela (23/10: a mídia, o fundo e o selo escolhidos aparecem na hora, sem guardar).
 * Sem base ainda (o centro não abriu), só o texto.
 */
export default function MiniaturaDoPostX({ trabalhoId, clientId, card, versao, posicao }: {
  trabalhoId: string; clientId: string; card: CardDaDirecao; versao?: CardGerado; posicao: { atual: number; total: number };
}) {
  const { base, rascunho, proprio, carrossel, bloco } = useLaminaNoTemplate(trabalhoId, clientId, card, versao);
  const fontes = fontesDoProfile(card as CardComFontes, [], clientId);
  const fonte = rascunho?.sem_imagem ? undefined : resolverFonteProfile(fontes, rascunho && (rascunho.imagem_caminho || rascunho.imagem_acervo_id) ? rascunho : versao?.template_profile) || fontes[0];
  const midia = carrossel ? midiaParaCarregar(bloco) : null;
  const foto = useUrlDaMesa(carrossel ? midia?.caminho : fonte?.caminho, carrossel ? midia?.bucket : fonte?.bucket);
  const tela = useRef<HTMLCanvasElement>(null);
  const [falhou, setFalhou] = useState(false);
  const texto = (card.texto_exato || "").trim();
  const assinatura = base ? JSON.stringify([base, proprio, texto, carrossel ? bloco : fonte?.caminho || null, posicao]) : "";

  useEffect(() => {
    let vivo = true;
    if (!base || !tela.current || !texto || ((carrossel ? midia : fonte) && !foto.data)) return;
    const comum = { ...base.template, ...proprio, texto };
    const t: TemplateProfile = carrossel ? { ...comum, estilo: "carrossel", bloco } : { ...comum, ...referenciaDaFonteProfile(fonte) };
    delete t.destaque;
    const midiaUrl = carrossel && foto.data ? foto.data : null;
    void Promise.all([
      base.avatarUrl ? carregarImagemProfile(base.avatarUrl).catch(() => null) : null,
      !carrossel && foto.data ? carregarImagemProfile(foto.data).catch(() => null) : null,
      midiaUrl ? carregarMidiaDoBloco(midiaUrl, bloco?.tipo === "video" ? "video" : "imagem").catch(() => null) : null,
    ]).then(([avatar, imagem, quadroDaMidia]) => {
      if (!vivo || !tela.current) return;
      try { desenharProfile(tela.current, t, base.formato, { avatar, imagem, imagemExata: fonte?.exata, posicao, midia: quadroDaMidia }); setFalhou(false); } catch { setFalhou(true); }
    });
    return () => { vivo = false; };
    // A assinatura junta base, rascunho da lâmina, texto, mídia e posição.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assinatura, foto.data]);

  if (!base || falhou || !texto) {
    return <span className="absolute inset-0 flex items-center justify-center p-1.5 text-center text-[11px] leading-tight text-muted-foreground [overflow-wrap:anywhere]" data-miniatura-do-x="texto">{texto ? texto.slice(0, 90) : "sem texto"}</span>;
  }
  return <canvas ref={tela} className="absolute inset-0 h-full w-full object-contain" aria-label={`Post ${card.ordem} do X`} data-miniatura-do-x="post" data-midia-na-miniatura={carrossel && midia ? midia.caminho : ""} />;
}
