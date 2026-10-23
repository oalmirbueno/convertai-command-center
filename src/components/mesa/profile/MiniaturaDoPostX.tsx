import { useEffect, useRef, useState } from "react";
import { useUrlDaMesa } from "../MesaContexto";
import type { CardDaDirecao, CardGerado } from "../useItensDoMes";
import { carregarImagemProfile, desenharProfile } from "./renderProfile";
import { fontesDoProfile, referenciaDaFonteProfile, resolverFonteProfile, type CardComFontes } from "./fontesDoProfile";
import { useBaseDoTemplate } from "./rascunhoDoTemplate";
import { blocoInicialDaLamina, carregarMidiaDoBloco, midiaParaCarregar, type CardDoCarrossel } from "./blocoDaLamina";

/**
 * Card da prancheta no modo Template · X (rodada 3, 21/10, dono: "nada da arte do carrossel ali"): a
 * miniatura é o post do X daquela lâmina, desenhado ao vivo pelo mesmo renderProfile, com o texto da
 * lâmina e o desenho da lâmina aberta, antes de guardar. Sem base ainda (o centro não abriu), só o texto.
 */
export default function MiniaturaDoPostX({ trabalhoId, clientId, card, versao, posicao }: {
  trabalhoId: string; clientId: string; card: CardDaDirecao; versao?: CardGerado; posicao: { atual: number; total: number };
}) {
  const base = useBaseDoTemplate(trabalhoId);
  const fontes = fontesDoProfile(card as CardComFontes, [], clientId);
  const fonte = resolverFonteProfile(fontes, versao?.template_profile) || fontes[0];
  // Carrossel X (22/10): cada lâmina com o próprio bloco (versão guardada ou sugestão do gerador); vídeo mostra o quadro.
  const carrossel = base?.template.estilo === "carrossel";
  const bloco = carrossel ? blocoInicialDaLamina(card as CardDoCarrossel, versao?.template_profile, clientId) : undefined;
  const midia = carrossel ? midiaParaCarregar(bloco) : null;
  const foto = useUrlDaMesa(carrossel ? midia?.caminho : fonte?.caminho, carrossel ? midia?.bucket : fonte?.bucket);
  const tela = useRef<HTMLCanvasElement>(null);
  const [falhou, setFalhou] = useState(false);
  const texto = (card.texto_exato || "").trim();
  const assinatura = base ? JSON.stringify([base, texto, carrossel ? bloco : fonte?.caminho || null, posicao]) : "";

  useEffect(() => {
    let vivo = true;
    if (!base || !tela.current || !texto || ((carrossel ? midia : fonte) && !foto.data)) return;
    const t = carrossel ? { ...base.template, texto, bloco } : { ...base.template, texto, ...referenciaDaFonteProfile(fonte) };
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
    // A assinatura junta base, texto, imagem e posição.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assinatura, foto.data]);

  if (!base || falhou || !texto) {
    return <span className="absolute inset-0 flex items-center justify-center p-1.5 text-center text-[11px] leading-tight text-muted-foreground [overflow-wrap:anywhere]" data-miniatura-do-x="texto">{texto ? texto.slice(0, 90) : "sem texto"}</span>;
  }
  return <canvas ref={tela} className="absolute inset-0 h-full w-full object-contain" aria-label={`Post ${card.ordem} do X`} data-miniatura-do-x="post" />;
}
