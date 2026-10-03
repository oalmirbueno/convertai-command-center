import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Loader2, Search, Stamp } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { BotaoComCusto } from "@/components/mesa/Custo";
import { ImagemDaMesa, useMesa } from "@/components/mesa/MesaContexto";
import { padraoPara, textoDoErro } from "@/lib/mesa/api";
import {
  caixaDoLogo,
  CANTOS_DO_LOGO,
  chamarAds,
  chavesAds,
  mudarCriativo,
  type CantoDoLogo,
  type CopyDoAnuncio,
  type CriativoAds,
  type LogoRealAds,
} from "./adsApi";

/**
 * Mundo real do criativo (pedido do dono em 02/10/2026: "quando falar de
 * coisa real, usar fonte, imagem e logo reais"): as marcas citadas, a
 * pesquisa web (fatos e passos com fonte) e os logos reais com a licença.
 * "Pôr na arte" coloca o logo oficial por código (canvas no navegador, o
 * arquivo do Simple Icons ou do Wikimedia Commons, nunca redesenhado) num
 * canto da arte e guarda a versão em mesa/<cliente>/ads/logos-reais/.
 */

/** Abre uma imagem de outro site para o canvas (as duas fontes liberam CORS). */
function abrirImagem(url: string): Promise<HTMLImageElement> {
  return new Promise((resolver, recusar) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolver(img);
    img.onerror = () => recusar(new Error("Não deu para abrir a imagem."));
    img.src = url;
  });
}

/** Desenha o logo real por cima da arte e devolve o PNG. */
export async function comporLogoNaArte(arte: Blob, logoUrl: string, canto: CantoDoLogo, stories: boolean): Promise<Blob> {
  const urlDaArte = URL.createObjectURL(arte);
  try {
    const [base, logo] = await Promise.all([abrirImagem(urlDaArte), abrirImagem(logoUrl)]);
    const canvas = document.createElement("canvas");
    canvas.width = base.naturalWidth;
    canvas.height = base.naturalHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("O navegador não conseguiu montar a arte.");
    ctx.drawImage(base, 0, 0);
    const lw = logo.naturalWidth || 512;
    const lh = logo.naturalHeight || 512;
    const c = caixaDoLogo(canto, { largura: canvas.width, altura: canvas.height }, { largura: lw, altura: lh }, stories);
    ctx.drawImage(logo, c.x, c.y, c.w, c.h);
    const png: Blob | null = await new Promise((r) => canvas.toBlob(r, "image/png"));
    if (!png) throw new Error("O navegador não conseguiu gravar a arte.");
    return png;
  } finally {
    URL.revokeObjectURL(urlDaArte);
  }
}

export default function LogosReais({ criativo, caminhoDaArte }: { criativo: CriativoAds; caminhoDaArte: string | null }) {
  const { clientId, catalogo } = useMesa();
  const queryClient = useQueryClient();
  const mundo = criativo.copy.mundo_real || null;
  const [buscando, setBuscando] = useState(false);
  const [compondo, setCompondo] = useState(false);
  const logos = mundo ? mundo.logos : [];
  const [escolhido, setEscolhido] = useState(0);
  const [canto, setCanto] = useState<CantoDoLogo>("inf_dir");
  const comLogos = criativo.copy.arte_com_logos || null;

  const guardar = (copy: CopyDoAnuncio) =>
    queryClient.setQueryData<CriativoAds[]>(chavesAds.criativos(clientId), (l) => (l || []).map((c) => (c.id === criativo.id ? { ...c, copy } : c)));

  const achar = async () => {
    setBuscando(true);
    try {
      const r = await chamarAds<{ criativo?: CriativoAds; avisos?: string[] }>("mundo_real_ler", { criativo_id: criativo.id });
      if (r && r.criativo) guardar(r.criativo.copy);
      if (r && r.avisos && r.avisos.length) toast.info(r.avisos[0]);
    } catch (e) {
      toast.error("Não deu para achar os logos", { description: textoDoErro(e) });
    } finally {
      setBuscando(false);
    }
  };

  const porNaArte = async (logo: LogoRealAds) => {
    if (!caminhoDaArte) return;
    setCompondo(true);
    try {
      const { data, error } = await supabase.storage.from("mesa").download(caminhoDaArte);
      if (error || !data) throw error || new Error("Não deu para abrir a arte.");
      const png = await comporLogoNaArte(data, logo.png_url || logo.url, canto, criativo.formato === "stories_9x16");
      const destino = `${clientId}/ads/logos-reais/${criativo.id}-${Date.now()}.png`;
      const envio = await supabase.storage.from("mesa").upload(destino, png, { contentType: "image/png", upsert: false });
      if (envio.error) throw envio.error;
      const copy: CopyDoAnuncio = { ...criativo.copy, arte_com_logos: { caminho: destino, logos: [`${logo.nome} (${logo.fonte})`], origem: caminhoDaArte, criado_em: new Date().toISOString() } };
      await mudarCriativo(criativo.id, { copy });
      guardar(copy);
      toast.success("Logo real posto na arte");
    } catch (e) {
      toast.error("Logo não entrou na arte", { description: textoDoErro(e) });
    } finally {
      setCompondo(false);
    }
  };

  const leitor = padraoPara(catalogo, "leitura");
  const pesquisa = mundo && mundo.pesquisa;

  return (
    <section className="space-y-2 rounded-lg border border-border bg-card p-4" aria-label="Mundo real">
      <div className="flex min-w-0 items-center">
        <h3 className="min-w-0 flex-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Marcas reais e fontes</h3>
        <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-[12px]" disabled={buscando} onClick={() => void achar()}>
          {buscando ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Search className="mr-1 h-3.5 w-3.5" />} Achar logos
        </Button>
        <BotaoComCusto
          rotulo="Pesquisar na web"
          titulo="Pesquisar na web"
          descricao="Fatos, passo a passo e nomes exatos da tela do que o anúncio cita, com as fontes. Usa o modelo de leitura."
          variant="ghost"
          className="h-7 px-2 text-[12px]"
          partes={() => [{ modeloId: leitor ? leitor.id : null, tipo: "texto", tokensEntrada: 3500, tokensSaida: 1500 }]}
          executar={() => chamarAds<{ criativo?: CriativoAds }>("mundo_real_ler", { criativo_id: criativo.id, pesquisar: true })}
          aoConcluir={(r) => {
            if (r && r.criativo) guardar(r.criativo.copy);
          }}
        />
      </div>
      {!mundo && <p className="text-[11.5px] text-muted-foreground">Nenhuma marca ou app real citado ainda.</p>}
      {mundo && mundo.entidades.length > 0 && <p className="text-[12px]">Cita: {mundo.entidades.join(", ")}</p>}
      {pesquisa && pesquisa.passos.length > 0 && (
        <ol className="list-decimal space-y-0.5 pl-5 text-[11.5px]" aria-label="Passo a passo pesquisado">
          {pesquisa.passos.map((p, i) => <li key={i} className="[overflow-wrap:anywhere]">{p}</li>)}
        </ol>
      )}
      {pesquisa && pesquisa.alertas.length > 0 && <p className="text-[11px] text-warning [overflow-wrap:anywhere]">{pesquisa.alertas.join(" ")}</p>}
      {logos.length > 0 && (
        <div className="space-y-2">
          <ul className="space-y-1" aria-label="Logos reais">
            {logos.map((l, i) => (
              <li key={`${l.url}-${i}`} className="flex min-w-0 items-center">
                <input type="radio" name={`logo-${criativo.id}`} aria-label={`${l.nome} (${l.fonte})`} checked={escolhido === i} onChange={() => setEscolhido(i)} className="mr-2" />
                <img src={l.png_url || l.url} alt={l.nome} crossOrigin="anonymous" className="mr-2 h-6 w-6 shrink-0 object-contain" />
                <span className="min-w-0 flex-1 truncate text-[11.5px]" title={l.licenca}>
                  {l.nome} · {l.fonte}
                </span>
                <a href={l.pagina} target="_blank" rel="noreferrer" className="ml-1 shrink-0 text-muted-foreground hover:text-foreground" aria-label={`Licença de ${l.nome}`}>
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </li>
            ))}
          </ul>
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <select aria-label="Canto do logo" value={canto} onChange={(e) => setCanto(e.target.value as CantoDoLogo)} className="h-8 min-w-0 rounded-md border border-input bg-background px-2 text-[12px]">
              {CANTOS_DO_LOGO.map((c) => <option key={c.valor} value={c.valor}>{c.rotulo}</option>)}
            </select>
            <Button type="button" size="sm" variant="outline" className="h-8 text-[12px]" disabled={!caminhoDaArte || compondo || !logos[escolhido]} onClick={() => void porNaArte(logos[escolhido])}>
              {compondo ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Stamp className="mr-1 h-3.5 w-3.5" />} Pôr na arte
            </Button>
          </div>
          {!caminhoDaArte && <p className="text-[11px] text-muted-foreground">Gere a arte primeiro.</p>}
        </div>
      )}
      {comLogos && (
        <div className="space-y-1">
          <p className="text-[11.5px] text-muted-foreground">Arte com logo real: {comLogos.logos.join(", ")}</p>
          <ImagemDaMesa caminho={comLogos.caminho} alt="Arte com o logo real" className="max-h-64 w-full rounded-md object-contain" />
        </div>
      )}
      {mundo && mundo.fontes.length > 0 && (
        <details className="text-[11px] text-muted-foreground">
          <summary className="cursor-pointer select-none">Fontes ({mundo.fontes.length})</summary>
          <ul className="mt-1 space-y-0.5">
            {mundo.fontes.map((f, i) => <li key={i} className="[overflow-wrap:anywhere]">{f}</li>)}
          </ul>
        </details>
      )}
    </section>
  );
}
