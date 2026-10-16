import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useInRouterContext, useNavigate } from "react-router-dom";
import { Camera, Check, Megaphone, PenTool, Pin, Zap, CalendarDays } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import MenuMais from "@/components/sistema/MenuMais";
import { juntar } from "@/components/sistema/estilos";
import { textoDoErro } from "@/lib/mesa/api";
import { useCampanhaEmUso } from "@/lib/mesa/campanhaAtiva";
import { useMarcaDaMesa, useMesa } from "./MesaContexto";
import { aplicarRespostaDaCampanha, campanhaSalvar, normalizarBriefing } from "./campanhasApi";
import type { Campanha } from "./mesaV4Api";
import { linkDaArteRapida } from "../../../supabase/functions/estudio-arte/modulos/arte-rapida";
import { DEFINICAO_DO_TIPO, TIPOS_DE_CAMPANHA, tipoDaCampanha } from "../../../supabase/functions/_shared/tipos-de-campanha";

/**
 * A campanha ligada às mesas (frente AE, 28/09). Pedido do dono: "quando
 * seleciono a campanha, todas as mesas puxam o contexto dela (Estúdio, Mesa
 * Foto, Mesa Ads, Mês), com botão de selecionar e conversa".
 *
 * - "Usar nas mesas": a campanha fica em uso neste cliente (src/lib/mesa/
 *   campanhaAtiva.ts). A arte rápida do Estúdio e a Mesa Foto já abrem com ela.
 * - "Levar para": um clique abre a mesa com a campanha (a arte rápida já vem
 *   com a campanha marcada).
 * - A base à vista: o tipo (troca sem IA), a oferta, o produto e o selo.
 */

/** Endereço com a marca aberta (Acerbi ou CME): trocar de mesa não troca de marca. */
export function comMarca(destino: string, marcaId: string | null | undefined): string {
  if (!marcaId) return destino;
  return `${destino}${destino.indexOf("?") >= 0 ? "&" : "?"}marca=${encodeURIComponent(marcaId)}`;
}

/** Fora do roteador (testes, prévia), o endereço abre pela janela. */
function ComRoteador({ campanha }: { campanha: Campanha }) {
  const navigate = useNavigate();
  return <CampanhaNasMesasCom campanha={campanha} ir={(d) => navigate(d)} />;
}

export default function CampanhaNasMesas({ campanha }: { campanha: Campanha }) {
  const noRoteador = useInRouterContext();
  return noRoteador ? <ComRoteador campanha={campanha} /> : <CampanhaNasMesasCom campanha={campanha} ir={(d) => window.location.assign(d)} />;
}

function CampanhaNasMesasCom({ campanha, ir }: { campanha: Campanha; ir: (destino: string) => void }) {
  const { clientId } = useMesa();
  const { marca } = useMarcaDaMesa();
  const queryClient = useQueryClient();
  const navigate = ir;
  const [emUso, setEmUso] = useCampanhaEmUso(clientId);
  const [salvandoTipo, setSalvandoTipo] = useState(false);
  const ativa = emUso === campanha.id;
  const tipo = tipoDaCampanha(campanha.identidade);
  const briefing = normalizarBriefing(campanha.briefing);
  const paleta = ((campanha.identidade && campanha.identidade.paleta_apoio) || []).filter((c) => c && c.hex).slice(0, 3);
  const marcaId = marca ? marca.id : null;

  const levar = (destino: string, rotulo: string) => {
    setEmUso(campanha.id);
    toast.success(`Campanha em uso: ${campanha.nome}`, { description: `${rotulo} abre com a base dela.` });
    navigate(comMarca(destino, marcaId));
  };

  const trocarTipo = async (novo: string) => {
    setSalvandoTipo(true);
    try {
      const r = await campanhaSalvar({ campanhaId: campanha.id, tipo: novo || "nenhum" });
      aplicarRespostaDaCampanha(queryClient, clientId, r);
      toast.success(novo ? `Tipo: ${DEFINICAO_DO_TIPO[novo as keyof typeof DEFINICAO_DO_TIPO].rotulo}` : "Tipo tirado", { description: "Desenhe o selo de novo para ele seguir o estilo do tipo." });
    } catch (e) {
      toast.error("Tipo não salvo", { description: textoDoErro(e) });
    } finally {
      setSalvandoTipo(false);
    }
  };

  const botao = "mb-1.5 mr-1 h-8 w-8 p-0";
  // A base que as mesas puxam: antes uma linha de texto embaixo; desde 16/10/2026 (dono: "tem muito
  // texto, poderia eliminar esses textos") vai no title da linha, e na tela ficam só as cores.
  const base = [
    tipo ? DEFINICAO_DO_TIPO[tipo].rotulo : "Sem tipo",
    briefing.oferta ? `Oferta: ${briefing.oferta}` : "",
    briefing.produtos.length ? `Produto: ${briefing.produtos.map((p) => p.nome).join(", ")}` : "",
    briefing.cta ? `CTA: ${briefing.cta}` : "",
    campanha.selo_path ? "com selo" : "sem selo ainda",
  ]
    .filter(Boolean)
    .join(" · ");
  // 28/09 (dono: "menos poluído"): sem caixa, uma linha só. Tipo, Usar nas mesas
  // e o "Levar para" num menu (as cinco mesas eram cinco botões numa fileira).
  // 16/10/2026: Usar nas mesas virou ícone (alfinete) e os rótulos saíram (ficam no title).
  return (
    <section className="min-w-0" aria-label="Campanha nas mesas" data-campanha-nas-mesas={campanha.id}>
      <div className="flex min-w-0 flex-wrap items-center" title={`Base que as mesas usam: ${base}`} data-base-da-campanha="">
        <select
          value={tipo || ""}
          onChange={(e) => void trocarTipo(e.target.value)}
          disabled={salvandoTipo}
          aria-label="Tipo da campanha"
          title="Tipo da campanha"
          className="mb-1.5 mr-1.5 h-8 min-w-0 max-w-[60vw] rounded-md bg-muted/60 px-2 text-[12px] text-foreground"
        >
          <option value="">Sem tipo</option>
          {TIPOS_DE_CAMPANHA.map((t) => (
            <option key={t} value={t}>{DEFINICAO_DO_TIPO[t].rotulo}</option>
          ))}
        </select>
        <Button
          type="button"
          variant={ativa ? "secondary" : "ghost"}
          className={juntar(botao, ativa && "text-primary")}
          onClick={() => {
            setEmUso(ativa ? null : campanha.id);
            toast.success(ativa ? "Campanha fora de uso nas mesas" : `Em uso nas mesas: ${campanha.nome}`, {
              description: ativa ? undefined : "A arte rápida do Estúdio e a Mesa Foto já abrem com ela.",
            });
          }}
          aria-pressed={ativa}
          aria-label={ativa ? "Em uso nas mesas" : "Usar nas mesas"}
          title={ativa ? "Em uso nas mesas (tocar tira)" : "Usar nas mesas: vem marcada na arte rápida do Estúdio e na Mesa Foto"}
        >
          {ativa ? <Check className="h-4 w-4" aria-hidden="true" /> : <Pin className="h-4 w-4" aria-hidden="true" />}
        </Button>
        <span className="mb-1.5 inline-flex items-center">
          <MenuMais
            rotulo="Levar para"
            itens={[
              { rotulo: "Arte rápida", icone: <Zap className="h-4 w-4" />, aoEscolher: () => levar(linkDaArteRapida(clientId, "nova", { campanha: campanha.id }), "A arte rápida") },
              { rotulo: "Mesa Foto", icone: <Camera className="h-4 w-4" />, aoEscolher: () => levar(`/mesa-foto?client=${encodeURIComponent(clientId)}`, "A Mesa Foto") },
              { rotulo: "Mesa Ads", icone: <Megaphone className="h-4 w-4" />, aoEscolher: () => levar(`/mesa-ads?client=${encodeURIComponent(clientId)}`, "A Mesa Ads") },
              { rotulo: "Mês", icone: <CalendarDays className="h-4 w-4" />, aoEscolher: () => levar(`/mesa?client=${encodeURIComponent(clientId)}&aba=mes`, "O Mês") },
              { rotulo: "Estúdio", icone: <PenTool className="h-4 w-4" />, aoEscolher: () => levar(`/mesa?client=${encodeURIComponent(clientId)}&aba=estudio`, "O Estúdio") },
            ]}
          />
        </span>
        {paleta.length > 0 && (
          <span className="mb-1.5 ml-1.5 inline-flex items-center" aria-label="Cores da campanha">
            {paleta.map((c, i) => (
              <span key={`${c.hex}-${i}`} className="mr-1 inline-block h-3 w-3 rounded-full" style={{ backgroundColor: c.hex }} title={c.nome || c.hex} />
            ))}
          </span>
        )}
      </div>
    </section>
  );
}
