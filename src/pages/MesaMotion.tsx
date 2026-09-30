import { lazyComPreCarga } from "@/lib/lazyComPreCarga";
import MesaDeVideo from "@/components/mesa-videos/MesaDeVideo";
import { ETAPAS_DA_MESA_MOTION, etapaValidaDoMotion } from "@/components/mesa-motion/motionApi";

/**
 * Mesa Motion (/mesa-motion, só equipe: admin, gestor e design), frente MOT
 * (30/09). "No editor de vídeo, a área de motion e apresentação de empresa" e
 * o criador do filme cinematográfico da marca, para entregar ao cliente e
 * usar como material, portfólio e case. Mesma casca de vídeo (MesaDeVideo).
 * Endereço: /mesa-motion?client=<id>&marca=<id>&filme=<id>&etapa=<etapa>
 *
 * Etapas (supabase/functions/_shared/motion-metodo.ts): Insumos, Entrevista,
 * BRAND.md, Storyboards, Stills, Construção, Crítica, Som e Render. As cenas
 * são HyperFrames (HTML + GSAP) renderizadas pela fila na máquina da agência
 * (render_pedidos, tipo cena_hf; workers/render). O diretor de motion fica
 * fixo ao lado: conversa, faz com Confirmar e custo antes, aprende.
 */

const EtapaInsumos = lazyComPreCarga("mesa-motion/insumos", () => import("@/components/mesa-motion/EtapaInsumos"));
const EtapaEntrevista = lazyComPreCarga("mesa-motion/entrevista", () => import("@/components/mesa-motion/EtapaEntrevista"));
const EtapaBrand = lazyComPreCarga("mesa-motion/brand", () => import("@/components/mesa-motion/EtapaBrand"));
const EtapaStoryboards = lazyComPreCarga("mesa-motion/storyboards", () => import("@/components/mesa-motion/EtapaStoryboards"));
const EtapaStills = lazyComPreCarga("mesa-motion/stills", () => import("@/components/mesa-motion/EtapaStills"));
const EtapaConstrucao = lazyComPreCarga("mesa-motion/construcao", () => import("@/components/mesa-motion/EtapaConstrucao"));
const EtapaCritica = lazyComPreCarga("mesa-motion/critica", () => import("@/components/mesa-motion/EtapaCritica"));
const EtapaSom = lazyComPreCarga("mesa-motion/som", () => import("@/components/mesa-motion/EtapaSom"));
const EtapaRender = lazyComPreCarga("mesa-motion/render", () => import("@/components/mesa-motion/EtapaRender"));
// Mesmas chaves da pré-carga do painel (src/lib/mesa/preCarga.ts).
const AgenteDoMotion = lazyComPreCarga("mesa-motion/agente", () => import("@/components/mesa-motion/AgenteDoMotion"));

export default function MesaMotion() {
  return (
    <MesaDeVideo
      mesa="motion"
      titulo="Mesa Motion"
      etapas={ETAPAS_DA_MESA_MOTION}
      etapaValida={etapaValidaDoMotion}
      prefixoOnde="mesa-motion:onde:"
      vazio={{ titulo: "Escolha um cliente", descricao: "Apresentação em motion e filme cinematográfico da marca." }}
      preCarregar={[EtapaInsumos, EtapaStills, EtapaConstrucao, AgenteDoMotion]}
      Agente={AgenteDoMotion}
      rotuloDoAgente="Diretor de motion"
    >
      {(etapa, irPara) => (
        <>
          {etapa === "insumos" && <EtapaInsumos irPara={irPara} />}
          {etapa === "entrevista" && <EtapaEntrevista irPara={irPara} />}
          {etapa === "brand" && <EtapaBrand irPara={irPara} />}
          {etapa === "storyboards" && <EtapaStoryboards irPara={irPara} />}
          {etapa === "stills" && <EtapaStills irPara={irPara} />}
          {etapa === "construcao" && <EtapaConstrucao irPara={irPara} />}
          {etapa === "critica" && <EtapaCritica irPara={irPara} />}
          {etapa === "som" && <EtapaSom irPara={irPara} />}
          {etapa === "render" && <EtapaRender irPara={irPara} />}
        </>
      )}
    </MesaDeVideo>
  );
}
