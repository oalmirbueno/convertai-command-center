import { useEffect, useRef, useState } from "react";
import { useUrlDaMesa } from "../MesaContexto";
import type { CardDaDirecao, CardGerado } from "../useItensDoMes";
import { carregarImagemProfile, desenharProfile } from "./renderProfile";
import { fontesDoProfile, referenciaDaFonteProfile, resolverFonteProfile, type CardComFontes } from "./fontesDoProfile";
import { useBaseDoTemplate } from "./rascunhoDoTemplate";

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
  const foto = useUrlDaMesa(fonte?.caminho, fonte?.bucket);
  const tela = useRef<HTMLCanvasElement>(null);
  const [falhou, setFalhou] = useState(false);
  const texto = (card.texto_exato || "").trim();
  const assinatura = base ? JSON.stringify([base, texto, fonte?.caminho || null, posicao]) : "";

  useEffect(() => {
    let vivo = true;
    if (!base || !tela.current || !texto || (fonte && !foto.data)) return;
    const t = { ...base.template, texto, ...referenciaDaFonteProfile(fonte) };
    delete t.destaque;
    void Promise.all([base.avatarUrl ? carregarImagemProfile(base.avatarUrl).catch(() => null) : null, foto.data ? carregarImagemProfile(foto.data).catch(() => null) : null]).then(([avatar, imagem]) => {
      if (!vivo || !tela.current) return;
      try { desenharProfile(tela.current, t, base.formato, { avatar, imagem, imagemExata: fonte?.exata, posicao }); setFalhou(false); } catch { setFalhou(true); }
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
