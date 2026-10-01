import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, ImagePlus, Loader2 } from "lucide-react";
import JanelaCentral from "@/components/sistema/JanelaCentral";
import SeletorCompacto from "@/components/sistema/SeletorCompacto";
import { EstadoVazio } from "@/components/sistema/Estados";
import { botao, juntar, texto } from "@/components/sistema/estilos";
import { ImagemDaMesa } from "@/components/mesa/MesaContexto";
import { rotuloDaSecao } from "../../../supabase/functions/_shared/site-metodo";
import type { DadosDaPrevia } from "./previaApi";
import { chamarSite } from "./siteApi";

export type PedidoDeImagem = { secao: string; slot: string; substitui_id: string | null };
type FotoDoAcervo = { id: string; storage_bucket: string; storage_path: string; nome: string; origem?: string | null };

/**
 * Trocar a imagem clicada na prévia (SPV, 30/09): uma das imagens deste site
 * (geradas ou fotos já usadas) ou uma foto real do acervo desta marca. Logo e
 * foto real entram pelo código, nunca pelo gerador; gerar imagem nova é na
 * etapa Imagens.
 */
export default function TrocarImagemDaPrevia({
  siteId,
  pedido,
  dados,
  enviando,
  onEscolher,
  onFechar,
  onIrParaImagens,
}: {
  siteId: string;
  pedido: PedidoDeImagem | null;
  dados: DadosDaPrevia | null;
  enviando: boolean;
  onEscolher: (escolha: { imagem_id?: string; cliente_imagem_id?: string }) => void;
  onFechar: () => void;
  onIrParaImagens?: () => void;
}) {
  const [aba, setAba] = useState<"site" | "acervo">("site");
  const acervo = useQuery({
    queryKey: ["mesa-site", "fotos-reais", siteId],
    enabled: !!pedido && aba === "acervo",
    queryFn: () => chamarSite<{ fotos: FotoDoAcervo[] }>("fotos_reais", { site_id: siteId }),
  });
  const doSite = dados ? dados.imagens.filter((i) => !!i.url) : [];
  const nome = pedido ? rotuloDaSecao(pedido.secao) : "";
  return (
    <JanelaCentral
      aberta={!!pedido}
      onMudar={(a) => !a && onFechar()}
      titulo={`Trocar imagem: ${nome}`}
      icone={<ImagePlus className="h-4 w-4" />}
      largura="lg"
      ajuda="Escolha uma imagem deste site ou uma foto real do acervo desta marca. A troca vale na hora na prévia rápida e vai ao site do motor sem custo. Para gerar uma imagem nova, use a etapa Imagens."
      abaixoDoTitulo={<SeletorCompacto rotulo="Origem da imagem" opcoes={[{ valor: "site", rotulo: "Deste site", contador: doSite.length }, { valor: "acervo", rotulo: "Acervo da marca" }]} valor={aba} onEscolher={(v) => setAba(v as "site" | "acervo")} />}
      rodape={
        onIrParaImagens ? (
          <button type="button" className={botao.discreto} onClick={onIrParaImagens}>
            Gerar imagem nova na etapa Imagens
          </button>
        ) : null
      }
      data-trocar-imagem=""
    >
      {aba === "site" && (
        <>
          {!doSite.length && <EstadoVazio compacto titulo="Este site ainda não tem imagens." descricao="Gere na etapa Imagens ou use o acervo." />}
          <ul className="grid min-w-0 grid-cols-2 gap-3 sm:grid-cols-3">
            {doSite.map((i) => {
              const atual = !!pedido && i.id === pedido.substitui_id;
              return (
                <li key={i.id} className="min-w-0">
                  <button type="button" className={juntar("group relative block w-full min-w-0 overflow-hidden rounded-md border text-left", atual ? "border-primary" : "border-border hover:border-primary/60")} disabled={enviando || atual} onClick={() => onEscolher({ imagem_id: i.id })} data-imagem-do-site={i.id}>
                    <img src={i.url || ""} alt={i.alt} loading="lazy" className="h-28 w-full object-cover" />
                    <span className={juntar(texto.auxiliar, "block truncate px-2 py-1.5")}>{atual ? "Atual" : `${i.origem === "real" ? "Foto real" : "Gerada"}${i.secao ? ` · ${rotuloDaSecao(i.secao)}` : ""}${i.escolhida ? "" : " · fora do site"}`}</span>
                    {atual && <Check className="absolute right-1.5 top-1.5 h-4 w-4 text-primary" aria-hidden="true" />}
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
      {aba === "acervo" && (
        <>
          {acervo.isLoading && <p className={texto.auxiliar}>Lendo o acervo</p>}
          {acervo.isError && <p className={juntar(texto.auxiliar, "text-destructive")}>Não foi possível ler o acervo agora.</p>}
          {acervo.data && !acervo.data.fotos.length && <EstadoVazio compacto titulo="Nenhuma foto no acervo desta marca." />}
          <ul className="grid min-w-0 grid-cols-2 gap-3 sm:grid-cols-3">
            {(acervo.data ? acervo.data.fotos : []).map((f) => (
              <li key={f.id} className="min-w-0">
                <button type="button" className="block w-full min-w-0 overflow-hidden rounded-md border border-border text-left hover:border-primary/60" disabled={enviando} onClick={() => onEscolher({ cliente_imagem_id: f.id })} data-foto-do-acervo={f.id}>
                  <ImagemDaMesa caminho={f.storage_path} bucket={f.storage_bucket} alt={f.nome} className="h-28 w-full" />
                  <span className={juntar(texto.auxiliar, "block truncate px-2 py-1.5")}>{f.nome}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {enviando && (
        <p className={juntar(texto.auxiliar, "mt-3 flex items-center")}>
          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          Trocando
        </p>
      )}
    </JanelaCentral>
  );
}
