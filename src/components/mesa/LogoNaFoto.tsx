import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useKitDaMesa } from "./kitDaMesa";
import { imagemDoArquivo, useArquivoDoPainel } from "./ContextoLogos";
import { useMesa, useUrlDaMesa } from "./MesaContexto";
import { supabase } from "@/integrations/supabase/client";
import { chamarFuncao } from "@/lib/mesa/api";
import { acrescentarFotos, normalizarFotos, type FotoDoAcervo } from "@/components/mesa-foto/fotoApi";

const carregar = (url: string) => new Promise<HTMLImageElement>((ok, erro) => { const i = new window.Image(); i.crossOrigin = "anonymous"; i.onload = () => ok(i); i.onerror = () => erro(new Error("Não foi possível carregar a imagem ou logo.")); i.src = url; });
/** Composição de pixels no navegador; a API registra a derivada e preserva a origem. */
export default function LogoNaFoto({ foto, onPronta }: { foto: FotoDoAcervo; onPronta: (f: FotoDoAcervo) => void | Promise<void> }) {
  const { clientId } = useMesa(); const kit = useKitDaMesa(); const cache = useQueryClient();
  const [qual, setQual] = useState("principal"); const [posicao, setPosicao] = useState("inferior-direita"); const [tamanho, setTamanho] = useState(18);
  const [ocupado, setOcupado] = useState(false); const [pronto, setPronto] = useState(false); const [erro, setErro] = useState("");
  const canvas = useRef<HTMLCanvasElement>(null);
  const origem = useUrlDaMesa(foto.storage_path, foto.storage_bucket || "mesa");
  const caminhoNoKit = qual === "principal" ? kit.data?.logo_path : kit.data?.logo_alt_path;
  const arquivoLogo = useArquivoDoPainel(caminhoNoKit ? null : qual === "principal" ? kit.data?.logo_file_id : kit.data?.logo_alt_file_id);
  const fonteLogo = caminhoNoKit ? { caminho: caminhoNoKit, bucket: "mesa" } : imagemDoArquivo(arquivoLogo.data);
  const caminhoLogo = fonteLogo?.caminho;
  const logo = useUrlDaMesa(caminhoLogo, fonteLogo?.bucket || "mesa");
  useEffect(() => { let vivo = true; setPronto(false); setErro(""); if (!origem.data || !logo.data) return;
    void Promise.all([carregar(origem.data), carregar(logo.data)]).then(([foto, logo]) => {
      if (!vivo || !canvas.current) return; const c = canvas.current; c.width = foto.naturalWidth; c.height = foto.naturalHeight;
      const ctx = c.getContext("2d"); if (!ctx) throw new Error("Prévia indisponível.");
      ctx.drawImage(foto, 0, 0); const margem = Math.min(c.width, c.height) * .04;
      const escala = Math.min(c.width * tamanho / 100 / logo.naturalWidth, c.height * .25 / logo.naturalHeight);
      const w = logo.naturalWidth * escala; const h = logo.naturalHeight * escala;
      ctx.drawImage(logo, posicao.endsWith("direita") ? c.width - w - margem : margem, posicao.startsWith("inferior") ? c.height - h - margem : margem, w, h); setPronto(true);
    }).catch((e) => { if (vivo) setErro(e.message); }); return () => { vivo = false; };
  }, [origem.data, logo.data, posicao, tamanho]);
  return <div className="space-y-3"><p className="text-[12px] text-muted-foreground">Logo do kit da marca. Confira a posição antes de salvar a nova versão.</p><label className="block text-[12px]">Logo<select className="mt-1 w-full rounded-md border bg-background p-2" value={qual} onChange={(e) => setQual(e.target.value)}><option value="principal">Principal</option><option value="alternativa">Alternativa</option></select></label>{!caminhoLogo && <p role="status" className="text-[12px]">Esta logo ainda não está no kit da marca. Adicione-a em Contexto → Marca.</p>}<label className="block text-[12px]">Posição<select className="mt-1 w-full rounded-md border bg-background p-2" value={posicao} onChange={(e) => setPosicao(e.target.value)}>{["inferior-direita", "inferior-esquerda", "superior-direita", "superior-esquerda"].map((v) => <option key={v} value={v}>{v.replace("-", " ")}</option>)}</select></label><label className="block text-[12px]">Tamanho · {tamanho}%<input aria-label="Tamanho da logo" type="range" min={8} max={35} value={tamanho} onChange={(e) => setTamanho(Number(e.target.value))} className="mt-2 w-full accent-primary" /></label><canvas ref={canvas} className="max-h-64 w-full rounded-lg object-contain" aria-label="Prévia da foto com logo" />{(erro || origem.isError || logo.isError) && <p role="alert" className="text-[12px]">{erro || "Não foi possível carregar a foto ou logo."}</p>}
    <button type="button" className="rounded-md bg-primary px-3 py-2 text-[12px] text-primary-foreground" disabled={ocupado || !pronto || !caminhoLogo} onClick={async () => { if (!canvas.current) return; setOcupado(true); try {
      const blob = await new Promise<Blob>((ok, falha) => canvas.current!.toBlob((b) => b ? ok(b) : falha(new Error("Não foi possível compor a imagem.")), "image/png"));
      const caminho = `${clientId}/foto/originais/${crypto.randomUUID()}.png`;
      const { error } = await supabase.storage.from("mesa").upload(caminho, blob, { contentType: "image/png", upsert: false }); if (error) throw error;
      const r = await chamarFuncao<{ imagens: unknown[] }>("mesa-foto", { acao: "acervo_registrar", client_id: clientId, caminhos: [caminho], nomes: [`${foto.nome} · logo`], derivada_de: foto.id, acabamento: "logo" });
      const nova = normalizarFotos(r.imagens)[0]; if (!nova) throw new Error("Não foi confirmada uma nova versão no acervo.");
      acrescentarFotos(cache, clientId, [nova]); await onPronta(nova); toast.success("Foto com logo salva no acervo.");
    } catch (e) { toast.error(e instanceof Error ? e.message : "Não foi possível salvar."); } finally { setOcupado(false); } }}>{ocupado ? "Salvando…" : "Aplicar logo e usar esta versão"}</button></div>;
}
