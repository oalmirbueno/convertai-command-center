import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Eraser, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { JanelaCentral } from "@/components/sistema";
import { botao, campo, juntar, texto } from "@/components/sistema/estilos";
import { XADREZ_NEUTRO } from "@/components/mesa/logoAnalise";
import { textoDoErro } from "@/lib/mesa/api";
import type { ResultadoDaLimpeza } from "@/lib/recorte/contaDaLimpeza";
import { escalaQueCabe, lerPixels, limparForaDaTela, pngDosPixels, type PixelsLidos } from "@/lib/recorte/limpezaDaLogo";
import type { LogoDoBrandbook } from "../../../supabase/functions/mesa-identidade/modulos/brandbook";
import { LIMITE_DO_HALO } from "@/lib/recorte/franja";
import { pastaDoProjeto } from "./identidadeApi";
import { Pastilha } from "./Comuns";

/**
 * Limpar o fundo da logo (frente IDR, 30/09; revisão de 01/10). Dono:
 * "retira o fundo, mas ainda fica recorte branco". A logo enviada com fundo
 * liso (branco, creme, cor) ou já transparente com franja de mistura do
 * fundo antigo sai limpa pelo código (_shared/recorte-limpo.ts). É o ÚNICO
 * lugar onde a franja de um PNG transparente sai, sempre com antes e depois:
 * branco que é desenho (ponta clara, anel branco) fica.
 *
 * Revisão de 01/10:
 * - a conta roda num worker (src/lib/recorte), na resolução de verdade da
 *   logo até 4096 px; a versão gravada é a que a equipe viu;
 * - passou de 4096 px, a janela avisa a redução antes de "Usar";
 * - sem worker, a prévia sai de uma redução de 800 px e a conta inteira só
 *   roda em "Usar".
 */

const LADO_DA_PREVIA = 800;
const LADO_DA_PROVA = 900;

type Resultado = ResultadoDaLimpeza & { fonte: PixelsLidos };

const FUNDO_DA_PROVA = { escuro: { background: "#151B17" }, cor: { background: "#C2185B" }, xadrez: XADREZ_NEUTRO };

const temWorker = () => typeof Worker !== "undefined";

/** A logo enviada pede limpeza? (fundo liso ou franja de mistura; conta fora da tela, só para avisar depois do envio). */
export async function precisaLimpar(blob: Blob): Promise<boolean> {
  const l = await lerPixels(blob);
  const r = await limparForaDaTela({ op: "diagnosticar", data: l.data, largura: l.largura, altura: l.altura });
  const p = r.diagnostico ? r.diagnostico.precisa : "nada";
  return p === "fundo_solido" || p === "franja";
}

/** Reduz os pixels lidos (prévia sem worker). */
async function reduzir(blob: Blob): Promise<PixelsLidos> {
  return lerPixels(blob, LADO_DA_PREVIA);
}

function Prova({ url, fundo, rotulo }: { url: string | null; fundo: "escuro" | "cor" | "xadrez"; rotulo: string }) {
  return (
    <div className="flex h-28 min-w-0 items-center justify-center overflow-hidden rounded-md p-2" style={FUNDO_DA_PROVA[fundo]} aria-label={rotulo}>
      {url ? <img src={url} alt={rotulo} className="max-h-full max-w-full object-contain" /> : <span className="h-full w-full animate-pulse bg-muted" />}
    </div>
  );
}

export default function RecorteDaLogo({
  aberta,
  onFechar,
  clientId,
  projetoId,
  slot,
  logo,
  onUsar,
}: {
  aberta: boolean;
  onFechar: () => void;
  clientId: string;
  projetoId: string;
  slot: string;
  logo: LogoDoBrandbook;
  onUsar: (nova: LogoDoBrandbook) => Promise<void>;
}) {
  const [arquivo, setArquivo] = useState<Blob | null>(null);
  const [lida, setLida] = useState<PixelsLidos | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [furos, setFuros] = useState<"tirar" | "manter">("tirar");
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [limpando, setLimpando] = useState(false);
  const [urls, setUrls] = useState<{ antes: string | null; depois: string | null }>({ antes: null, depois: null });
  const [gravando, setGravando] = useState(false);
  /** A prévia já é a conta na resolução cheia (worker)? Sem worker, a cheia só roda em "Usar". */
  const [cheia, setCheia] = useState(false);
  // Resultado por escolha de vãos (trocar e voltar não refaz a conta).
  const cache = useRef<Record<string, Resultado>>({});

  useEffect(() => {
    if (!aberta) return;
    let vivo = true;
    setErro(null);
    cache.current = {};
    const caminho = /svg/i.test(logo.mime) ? logo.previa_png || "" : logo.caminho;
    supabase.storage
      .from("mesa")
      .download(caminho)
      .then(({ data, error }) => {
        if (error || !data) throw error || new Error("Não foi possível baixar a logo.");
        if (vivo) setArquivo(data);
        // Com worker, a prévia já é a conta de verdade (resolução cheia até 4096 px); sem ele, 800 px.
        const comWorker = temWorker();
        if (vivo) setCheia(comWorker);
        return comWorker ? lerPixels(data) : reduzir(data);
      })
      .then((l) => vivo && setLida(l))
      .catch((e) => vivo && setErro(textoDoErro(e)));
    return () => {
      vivo = false;
    };
  }, [aberta, logo.caminho, logo.previa_png, logo.mime]);

  useEffect(() => {
    if (!lida) return;
    const ja = cache.current[furos];
    if (ja) {
      setResultado(ja);
      return;
    }
    let vivo = true;
    setLimpando(true);
    limparForaDaTela({ op: "limpar", data: lida.data, largura: lida.largura, altura: lida.altura, furos })
      .then((r) => {
        const pronto = { ...r, fonte: lida };
        cache.current[furos] = pronto;
        if (vivo) setResultado(pronto);
      })
      .catch((e) => vivo && setErro(textoDoErro(e)))
      .then(() => vivo && setLimpando(false));
    return () => {
      vivo = false;
    };
  }, [lida, furos]);

  useEffect(() => {
    if (!lida || !resultado) return;
    let vivo = true;
    const criadas: string[] = [];
    const f = resultado.fonte;
    Promise.all([pngDosPixels(f.data, f.largura, f.altura, LADO_DA_PROVA), pngDosPixels(resultado.data || f.data, f.largura, f.altura, LADO_DA_PROVA)])
      .then(([a, d]) => {
        if (!vivo) return;
        const ua = URL.createObjectURL(a), ud = URL.createObjectURL(d);
        criadas.push(ua, ud);
        setUrls({ antes: ua, depois: ud });
      })
      .catch((e) => vivo && setErro(textoDoErro(e)));
    return () => {
      vivo = false;
      criadas.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [lida, resultado]);

  const precisa = resultado && resultado.diagnostico ? resultado.diagnostico.precisa : null;
  const pode = !!resultado && !!resultado.data && (precisa === "fundo_solido" || precisa === "franja") && !limpando;
  // A versão gravada: a da prévia (worker, resolução cheia) ou refeita na resolução cheia em "Usar".
  const escala = lida ? escalaQueCabe(lida.larguraOriginal, lida.alturaOriginal) : 1;
  const reducao = lida && escala < 1
    ? `A logo tem ${lida.larguraOriginal} x ${lida.alturaOriginal} px; a versão limpa sai com ${Math.round(lida.larguraOriginal * escala)} x ${Math.round(lida.alturaOriginal * escala)} px (o limite do navegador). O arquivo original continua guardado no projeto.`
    : null;
  const situacao = useMemo(() => {
    if (erro) return erro;
    if (!resultado || limpando) return "Limpando a logo...";
    if (precisa === "fundo_solido") return "Fundo liso: sai o fundo e a mistura dele com a borda.";
    if (precisa === "franja") return "PNG transparente com franja de mistura em volta do desenho: sai só esse anel fino. Branco que é desenho fica.";
    if (precisa === "fundo_misto") return "Fundo com foto ou degradê: use Tirar fundo (pro) na Mesa Foto; aqui a logo fica como está.";
    return "A logo já está limpa: sem fundo e sem franja.";
  }, [erro, resultado, limpando, precisa]);

  const usar = async () => {
    if (!lida || !resultado || !pode || !arquivo) return;
    setGravando(true);
    try {
      let final: { data: Uint8ClampedArray; largura: number; altura: number } = { data: resultado.data as Uint8ClampedArray, largura: lida.largura, altura: lida.altura };
      // Prévia feita na redução (sem worker): a conta inteira, na resolução cheia, só agora.
      if (!cheia) {
        const cheia = await lerPixels(arquivo);
        const r = await limparForaDaTela({ op: "limpar", data: cheia.data, largura: cheia.largura, altura: cheia.altura, furos });
        if (!r.data) throw new Error("Na resolução cheia a logo não pede limpeza: nada foi trocado.");
        final = { data: r.data, largura: cheia.largura, altura: cheia.altura };
      }
      const base = `${pastaDoProjeto(clientId, projetoId)}/logos/${slot}-limpa-${Date.now()}`;
      const [png, previa] = await Promise.all([pngDosPixels(final.data, final.largura, final.altura), pngDosPixels(final.data, final.largura, final.altura, LADO_DA_PREVIA)]);
      const a = await supabase.storage.from("mesa").upload(`${base}.png`, png, { contentType: "image/png", upsert: false });
      if (a.error) throw a.error;
      const b = await supabase.storage.from("mesa").upload(`${base}-previa.png`, previa, { contentType: "image/png", upsert: false });
      if (b.error) throw b.error;
      await onUsar({ ...logo, caminho: `${base}.png`, mime: "image/png", previa_png: `${base}-previa.png`, largura: final.largura, altura: final.altura });
      onFechar();
    } catch (e) {
      setErro(textoDoErro(e));
    } finally {
      setGravando(false);
    }
  };

  const halo = (v: number) => <Pastilha tom={v >= LIMITE_DO_HALO ? "alerta" : "bom"}>halo {Math.round(v)}</Pastilha>;

  return (
    <JanelaCentral
      aberta={aberta}
      onMudar={(v) => !v && onFechar()}
      titulo="Limpar o fundo da logo"
      icone={<Eraser className="h-4 w-4" />}
      descricao={situacao}
      ajuda="Por código, sem IA e sem custo, na resolução da própria logo. O fundo liso sai com a borda certa (sem o contorno claro que aparece no escuro). Num PNG já transparente, só sai o anel fino de mistura com o branco antigo que contorna o desenho; ponta clara, gomo branco ou anel branco desenhado ficam. A logo não é redesenhada: o arquivo original continua guardado e o Desfazer volta. Halo mede quanto a borda é mais clara que o desenho (acima de 12 aparece no escuro)."
      largura="lg"
      rodape={
        <div className="flex min-w-0 flex-wrap items-center justify-end">
          {precisa === "fundo_solido" && (
            <label className={juntar(texto.auxiliar, "m-1 mr-auto inline-flex items-center")}>
              Vãos da cor do fundo dentro da logo
              <select className={juntar(campo, "ml-2 h-8 w-auto text-[12px]")} value={furos} onChange={(e) => setFuros(e.target.value === "manter" ? "manter" : "tirar")} aria-label="Vãos da cor do fundo dentro da logo" data-vaos-da-logo="">
                <option value="tirar">Tirar (miolo das letras)</option>
                <option value="manter">Manter (branco é desenho)</option>
              </select>
            </label>
          )}
          <button type="button" className={juntar(botao.discreto, "m-1 h-8")} onClick={onFechar}>
            Fechar
          </button>
          <button type="button" className={juntar(botao.primario, "m-1 h-8")} onClick={() => void usar()} disabled={!pode || gravando} data-usar-logo-limpa="">
            {gravando || limpando ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Check className="mr-1.5 h-3.5 w-3.5" />} Usar a versão limpa
          </button>
        </div>
      }
    >
      {reducao && (
        <p className={juntar(texto.auxiliar, "mb-3")} role="status" data-reducao-da-logo="">
          {reducao}
        </p>
      )}
      {(["antes", "depois"] as const).map((q) => (
        <div key={q} className="mb-4 min-w-0" data-recorte={q}>
          <p className={juntar(texto.rotulo, "mb-1.5 flex items-center")}>
            <span className="mr-2">{q === "antes" ? "Como está" : "Limpa"}</span>
            {/* Sem limpeza a fazer, sem medida: a borda clara de um desenho claro (cinza da VIFUT) não é defeito. */}
            {resultado && resultado.diagnostico && pode && (q === "antes" && precisa === "fundo_solido" ? <Pastilha tom="alerta">{resultado.diagnostico.fundo.claro ? "fundo claro" : "fundo liso"}</Pastilha> : halo(q === "antes" ? resultado.haloAntes : resultado.haloDepois))}
          </p>
          <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-3">
            <Prova url={limpando && q === "depois" ? null : urls[q]} fundo="escuro" rotulo={`${q === "antes" ? "Como está" : "Limpa"} no escuro`} />
            <Prova url={limpando && q === "depois" ? null : urls[q]} fundo="cor" rotulo={`${q === "antes" ? "Como está" : "Limpa"} na cor`} />
            <Prova url={limpando && q === "depois" ? null : urls[q]} fundo="xadrez" rotulo={`${q === "antes" ? "Como está" : "Limpa"} no xadrez`} />
          </div>
        </div>
      ))}
    </JanelaCentral>
  );
}
