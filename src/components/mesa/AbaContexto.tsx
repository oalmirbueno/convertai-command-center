import { lazy, Suspense, useRef, useState } from "react";
import AgenteDeContexto from "./AgenteDeContexto";
import ContextoAutomatico from "./ContextoAutomatico";
import ContextoMarca from "./ContextoMarca";
import ContextoKitDaMarca from "./ContextoKitDaMarca";
import { useMarcaDaMesa } from "./MesaContexto";
import ContextoFontes from "./ContextoFontes";
import ContextoImagens from "./ContextoImagens";
import ContextoReferencias from "./ContextoReferencias";
import ContextoRosto from "./ContextoRosto";
import { MemoriaDoAgente, PromptDoCliente } from "./ContextoAgente";
import { Hub, useHubsAbertos } from "./ContextoHub";
import ContextoPlanoDoCliente from "./ContextoPlanoDoCliente";
import type { ModoDoAgente } from "./planoDoClienteApi";
import AreaDeTrabalho from "@/components/sistema/AreaDeTrabalho";
import SeletorCompacto from "@/components/sistema/SeletorCompacto";
import { useMesa } from "./MesaContexto";
import AjudaRecolhida from "@/components/sistema/AjudaRecolhida";
import { useEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
import { Carregando } from "@/components/sistema/Estados";

// Frente P: Perfis do Instagram (referências e concorrentes). Carrega só ao abrir o grupo.
const PerfisDoInstagram = lazy(() => import("@/components/perfis/PerfisDoInstagram"));
// Área MCP (26/09): o que chegou pelo MCP e o que vale para o planejamento. Carrega só ao abrir o grupo.
const ContextoMcp = lazy(() => import("./ContextoMcp"));

/** O editor em detalhe começa recolhido; os atalhos "Editar" abrem na parte certa. */
const DETALHES_DE_INICIO: Record<string, boolean> = {};

const PARTES = [
  { valor: "marca", rotulo: "Marca", dica: "Paleta, logo, estilo e regras." },
  { valor: "fontes", rotulo: "Fontes", dica: "Fontes do cliente: enviadas por arquivo ou escolhidas na biblioteca da agência." },
  { valor: "imagens", rotulo: "Imagens", dica: "Fotos reais do cliente, organizadas por categoria e pasta. O Estúdio usa como base das lâminas." },
  { valor: "referencias", rotulo: "Referências", dica: "Peças que mostram o nível e a técnica que o cliente quer." },
  { valor: "rosto", rotulo: "Rosto", dica: "Pessoas reais que podem aparecer, com autorização." },
  { valor: "prompt", rotulo: "Prompt", dica: "O que vale só para este cliente, por cima do prompt global." },
  { valor: "memoria", rotulo: "Memória", dica: "O que os agentes aprenderam com este cliente." },
] as const;

export type ParteDoContexto = (typeof PARTES)[number]["valor"];

/** Os editores de cada parte do contexto: uma parte por vez. */
function DetalhesDoContexto({ parte, onParte }: { parte: ParteDoContexto; onParte: (p: ParteDoContexto) => void }) {
  const atual = PARTES.find((p) => p.valor === parte) || PARTES[0];
  // Marca por projeto: com outra marca aberta no topo (ex.: CME), a parte Marca edita o kit dela.
  const { marca } = useMarcaDaMesa();
  const outraMarca = marca && !marca.principal ? marca : null;
  return (
    <div className="min-w-0 space-y-3">
      {/* Sete partes: seletor compacto (docs/design/SISTEMA.md), a explicação no "?". */}
      <div className="flex min-w-0 items-center">
        <SeletorCompacto
          rotulo="Parte do contexto"
          opcoes={PARTES.map((p) => ({ valor: p.valor, rotulo: p.rotulo, descricao: p.dica }))}
          valor={parte}
          onEscolher={(v) => onParte(v as ParteDoContexto)}
        />
        <AjudaRecolhida className="ml-2" rotulo={`O que é ${atual.rotulo}`}>
          {atual.dica}
        </AjudaRecolhida>
      </div>
      <div className="min-w-0">
        {parte === "marca" && (outraMarca ? <ContextoKitDaMarca marca={outraMarca} /> : <ContextoMarca />)}
        {parte === "fontes" && <ContextoFontes />}
        {parte === "imagens" && <ContextoImagens />}
        {parte === "referencias" && <ContextoReferencias />}
        {parte === "rosto" && <ContextoRosto />}
        {parte === "prompt" && <PromptDoCliente />}
        {parte === "memoria" && <MemoriaDoAgente />}
      </div>
    </div>
  );
}

/**
 * Contexto do cliente: a Mesa puxa sozinha o que o cliente já tem (documentos,
 * dossiê, artes aprovadas, referências), monta o contexto uma vez e deixa o
 * agente ao lado, fixo e da altura da tela, para completar e corrigir
 * conversando (ou falando no microfone). Tudo em hubs recolhíveis; os
 * editores completos ficam no último, "Editar em detalhe".
 */
export default function AbaContexto() {
  // A parte aberta e o modo do agente ficam guardados por cliente (sair e voltar mantém).
  const { clientId } = useMesa();
  const [parte, setParte] = useEstadoDaTela<ParteDoContexto>(`mesa:contexto:parte:${clientId}`, "marca", {
    validar: (v) => PARTES.some((p) => p.valor === v),
  });
  const detalhes = useRef<HTMLDivElement>(null);
  const hubs = useHubsAbertos(DETALHES_DE_INICIO);
  const atual = PARTES.find((p) => p.valor === parte) || PARTES[0];
  const { marca } = useMarcaDaMesa();
  // Frente C: o agente ao lado vira o agente do cliente (modo plano); o Hub do plano preenche o pedido.
  const [modoDoAgente, setModoDoAgente] = useEstadoDaTela<ModoDoAgente>(`mesa:contexto:modo:${clientId}`, "marca", {
    validar: (v) => v === "marca" || v === "plano",
  });
  const [pedido, setPedido] = useState<{ texto: string; n: number } | null>(null);
  const pedirAoAgente = (texto: string) => {
    setModoDoAgente("plano");
    setPedido({ texto, n: Date.now() });
  };

  const irPara = (p: ParteDoContexto) => {
    setParte(p);
    hubs.definir("ctx-detalhes", true);
    window.setTimeout(() => {
      const el = detalhes.current;
      if (el && typeof el.scrollIntoView === "function") el.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
  };

  return (
    // Área de trabalho (src/components/sistema/AreaDeTrabalho.tsx): no computador
    // o contexto rola por dentro e o agente fica parado ao lado, com o campo de
    // digitar sempre à vista; no celular a página rola normal e o agente abre
    // em tela cheia pelo botão de baixo.
    <AreaDeTrabalho
      memoria="mesa-contexto"
      rotuloDaLateral="Agente de contexto"
      rotuloDoPrincipal="Contexto do cliente"
      memoriaDaRolagem={`mesa:contexto:${clientId}`}
      lateral={<AgenteDeContexto preencher modo={modoDoAgente} onModo={setModoDoAgente} pedido={pedido} />}
    >
      <div className="min-w-0 space-y-4 pb-6">
        {marca && !marca.principal && (
          <div className="flex min-w-0 flex-wrap items-center rounded-lg border border-primary/40 bg-primary/5 px-3 py-2 text-[12.5px]" data-aviso-da-marca="">
            <p className="mr-3 min-w-0 flex-1 [overflow-wrap:anywhere]">
              Marca <strong>{marca.nome}</strong> aberta: logo, cores, estilo e referências dela ficam em Editar em detalhe, Marca. Documentos, dossiê e o agente ao lado são do cliente.
            </p>
            <button type="button" onClick={() => irPara("marca")} className="mt-1 shrink-0 rounded-md bg-primary px-2.5 py-1 text-[12px] font-medium text-primary-foreground sm:mt-0">
              Editar o kit da {marca.nome}
            </button>
          </div>
        )}
        <ContextoAutomatico onIrPara={irPara} />
        <div className="min-w-0">
          <Hub
            id="ctx-plano"
            titulo="Plano do cliente"
            resumo="Começo do cliente, caminho e stack, pacote para LLM externo, identidade visual e organizar arquivos"
            aberto={hubs.aberto("ctx-plano")}
            onAlternar={() => hubs.alternar("ctx-plano")}
          >
            <ContextoPlanoDoCliente onPedirAoAgente={pedirAoAgente} />
          </Hub>
          <Hub
            id="ctx-perfis"
            titulo="Perfis do Instagram"
            resumo="Referências de estilo e editorial, concorrentes monitorados"
            aberto={hubs.aberto("ctx-perfis")}
            onAlternar={() => hubs.alternar("ctx-perfis")}
          >
            <Suspense fallback={<Carregando forma="lista" linhas={3} rotulo="Carregando os perfis" />}>
              <PerfisDoInstagram />
            </Suspense>
          </Hub>
          <Hub
            id="ctx-mcp"
            titulo="MCP"
            resumo="O que chegou pelo MCP e o que vale para o planejamento"
            aberto={hubs.aberto("ctx-mcp")}
            onAlternar={() => hubs.alternar("ctx-mcp")}
          >
            <Suspense fallback={<Carregando forma="lista" linhas={3} rotulo="Carregando o MCP" />}>
              <ContextoMcp />
            </Suspense>
          </Hub>
          <div ref={detalhes} className="min-w-0 scroll-mt-4">
            <Hub
              id="ctx-detalhes"
              titulo="Editar em detalhe"
              resumo={`Marca, fontes, imagens, referências, rosto, prompt e memória · aberto em ${atual.rotulo}`}
              aberto={hubs.aberto("ctx-detalhes")}
              onAlternar={() => hubs.alternar("ctx-detalhes")}
            >
              <DetalhesDoContexto parte={parte} onParte={setParte} />
            </Hub>
          </div>
        </div>
      </div>
    </AreaDeTrabalho>
  );
}
