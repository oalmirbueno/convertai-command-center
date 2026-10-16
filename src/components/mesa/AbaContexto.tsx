import { lazy, Suspense, useState } from "react";
import { Brain, Instagram, Pencil, Plug, Route, SlidersHorizontal } from "lucide-react";
import AgenteDeContexto from "./AgenteDeContexto";
import ContextoAutomatico, { ehAbaDoContexto, type AbaDeFora, type AbaDoContexto } from "./ContextoAutomatico";
import CerebroDoCliente from "./CerebroDoCliente";
import ContextoMarca from "./ContextoMarca";
import ContextoKitDaMarca from "./ContextoKitDaMarca";
import { useMarcaDaMesa } from "./MesaContexto";
import ContextoFontes from "./ContextoFontes";
import ContextoImagens from "./ContextoImagens";
import ContextoReferencias from "./ContextoReferencias";
import ContextoRosto from "./ContextoRosto";
import { MemoriaDoAgente, PromptDoCliente } from "./ContextoAgente";
import ContextoPlanoDoCliente from "./ContextoPlanoDoCliente";
import type { ModoDoAgente } from "./planoDoClienteApi";
import AreaDeTrabalho from "@/components/sistema/AreaDeTrabalho";
import SeletorCompacto from "@/components/sistema/SeletorCompacto";
import { useMesa } from "./MesaContexto";
import AjudaRecolhida from "@/components/sistema/AjudaRecolhida";
import { useEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
import { Carregando } from "@/components/sistema/Estados";
import { botao, juntar } from "@/components/sistema/estilos";

// Frente P: Perfis do Instagram (referências e concorrentes). Carrega só ao abrir a aba.
const PerfisDoInstagram = lazy(() => import("@/components/perfis/PerfisDoInstagram"));
// Área MCP (26/09): o que chegou pelo MCP e o que vale para o planejamento. Carrega só ao abrir a aba.
const ContextoMcp = lazy(() => import("./ContextoMcp"));

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

/**
 * Seletor das sete partes do "Editar em detalhe": vai na linha das abas
 * (seletor pequeno não ganha linha própria), com a explicação no "?".
 */
function SeletorDaParte({ parte, onParte }: { parte: ParteDoContexto; onParte: (p: ParteDoContexto) => void }) {
  const atual = PARTES.find((p) => p.valor === parte) || PARTES[0];
  return (
    <div className="flex min-w-0 items-center">
      <SeletorCompacto
        rotulo="Parte do contexto"
        opcoes={PARTES.map((p) => ({ valor: p.valor, rotulo: p.rotulo, descricao: p.dica }))}
        valor={parte}
        onEscolher={(v) => onParte(v as ParteDoContexto)}
      />
      <AjudaRecolhida className="ml-1" rotulo={`O que é ${atual.rotulo}`}>
        {atual.dica}
      </AjudaRecolhida>
    </div>
  );
}

/** Os editores de cada parte do contexto: uma parte por vez. */
function DetalhesDoContexto({ parte }: { parte: ParteDoContexto }) {
  // Marca por projeto: com outra marca aberta no topo (ex.: CME), a parte Marca edita o kit dela.
  const { marca } = useMarcaDaMesa();
  const outraMarca = marca && !marca.principal ? marca : null;
  return (
    <div className="min-w-0">
      {parte === "marca" && (outraMarca ? <ContextoKitDaMarca marca={outraMarca} /> : <ContextoMarca />)}
      {parte === "fontes" && <ContextoFontes />}
      {parte === "imagens" && <ContextoImagens />}
      {parte === "referencias" && <ContextoReferencias />}
      {parte === "rosto" && <ContextoRosto />}
      {parte === "prompt" && <PromptDoCliente />}
      {parte === "memoria" && <MemoriaDoAgente />}
    </div>
  );
}

/**
 * Contexto do cliente: a Mesa puxa sozinha o que o cliente já tem (documentos,
 * dossiê, artes aprovadas, referências), monta o contexto uma vez e deixa o
 * agente ao lado, fixo e da altura da tela, para completar e corrigir
 * conversando (ou falando no microfone).
 *
 * 16/10 (dono: "está um embaixo do outro; poderia ter abas aqui em cima"):
 * as partes viraram abas em ícone no topo, uma por vez. O segundo cérebro
 * deixou de abrir em cima de tudo e virou uma aba. Trocar de aba não rola a
 * página até a seção (o rolar suave brigava com a memória da rolagem enquanto
 * as miniaturas chegavam); cada aba guarda a própria rolagem.
 */
export default function AbaContexto() {
  // A aba, a parte aberta e o modo do agente ficam guardados por cliente (sair e voltar mantém).
  const { clientId, userId } = useMesa();
  const [parte, setParte] = useEstadoDaTela<ParteDoContexto>(`mesa:contexto:parte:${clientId}`, "marca", {
    validar: (v) => PARTES.some((p) => p.valor === v),
  });
  const [aba, setAba] = useEstadoDaTela<AbaDoContexto>(`mesa:contexto:aba:${clientId}`, "ctx-marca", { validar: ehAbaDoContexto });
  const { marca } = useMarcaDaMesa();
  const principal = !marca || marca.principal;
  // O segundo cérebro é do cliente: com outra marca aberta ele não aparece (como antes).
  const abaAberta: AbaDoContexto = !principal && aba === "ctx-cerebro" ? "ctx-marca" : aba;
  const atual = PARTES.find((p) => p.valor === parte) || PARTES[0];
  // Frente C: o agente ao lado vira o agente do cliente (modo plano); a aba do plano preenche o pedido.
  const [modoDoAgente, setModoDoAgente] = useEstadoDaTela<ModoDoAgente>(`mesa:contexto:modo:${clientId}`, marca?.principal === false ? "marca" : "plano", {
    validar: (v) => v === "marca" || v === "plano",
  });
  const [pedido, setPedido] = useState<{ texto: string; n: number } | null>(null);
  const pedirAoAgente = (texto: string) => {
    setModoDoAgente("plano");
    setPedido({ texto, n: Date.now() });
  };

  /** "Editar", "Organizar", "Gerenciar": abre a aba Editar em detalhe na parte certa. */
  const irPara = (p: ParteDoContexto) => {
    setParte(p);
    setAba("ctx-detalhes");
  };

  const abasDeFora: AbaDeFora[] = [
    ...(principal
      ? [
          {
            valor: "ctx-cerebro" as const,
            rotulo: "Segundo cérebro",
            icone: <Brain className="h-4 w-4" />,
            ajuda: "Dossiê e memória do cliente, com origem e validade. Os agentes leem daqui.",
          },
        ]
      : []),
    {
      valor: "ctx-plano",
      rotulo: "Plano do cliente",
      icone: <Route className="h-4 w-4" />,
      ajuda: "Começo do cliente, caminho e stack, pacote para LLM externo, identidade visual e organizar arquivos.",
    },
    {
      valor: "ctx-perfis",
      rotulo: "Perfis do Instagram",
      icone: <Instagram className="h-4 w-4" />,
      ajuda: "Referências de estilo e editorial e concorrentes monitorados.",
    },
    { valor: "ctx-mcp", rotulo: "MCP", icone: <Plug className="h-4 w-4" />, ajuda: "O que chegou pelo MCP e o que vale para o planejamento." },
    {
      valor: "ctx-detalhes",
      rotulo: "Editar em detalhe",
      icone: <SlidersHorizontal className="h-4 w-4" />,
      ajuda: `Marca, fontes, imagens, referências, rosto, prompt e memória: os editores completos, uma parte por vez. Aberto em ${atual.rotulo}.`,
    },
  ];

  return (
    // Área de trabalho (src/components/sistema/AreaDeTrabalho.tsx): no computador
    // o contexto rola por dentro e o agente fica parado ao lado, com o campo de
    // digitar sempre à vista; no celular a página rola normal e o agente abre
    // em tela cheia pelo botão de baixo. A rolagem é guardada por aba.
    <AreaDeTrabalho
      memoria="mesa-contexto"
      rotuloDaLateral="Agente de contexto"
      rotuloDoPrincipal="Contexto do cliente"
      memoriaDaRolagem={`mesa:contexto:${clientId}:${abaAberta}`}
      lateral={<AgenteDeContexto preencher modo={modoDoAgente} onModo={setModoDoAgente} pedido={pedido} />}
    >
      <div className="min-w-0 space-y-4 pb-6">
        {marca && !marca.principal && (
          <div className="flex min-w-0 items-center rounded-md bg-primary/5 px-3 py-1 text-[13px]" data-aviso-da-marca="">
            <p className="min-w-0 flex-1 truncate">
              Marca <strong>{marca.nome}</strong> aberta
            </p>
            <AjudaRecolhida className="ml-1.5" rotulo="O que muda com a marca aberta">
              Tudo aqui é da {marca.nome}: logo, cores, estilo, regras, tom, contexto, documentos e dossiê do projeto dela, referências e fotos
              marcadas como dela. O que ela não tem fica vazio (nunca o da outra marca). O agente ao lado lê o kit da {marca.nome} e não grava no kit
              do cliente; para mudar, use Editar o kit.
            </AjudaRecolhida>
            <button
              type="button"
              onClick={() => irPara("marca")}
              className={juntar(botao.icone, "ml-1")}
              aria-label={`Editar o kit da ${marca.nome}`}
              title={`Editar o kit da ${marca.nome}`}
            >
              <Pencil className="h-4 w-4" />
            </button>
          </div>
        )}
        <ContextoAutomatico
          onIrPara={irPara}
          aba={abaAberta}
          onAba={setAba}
          abasDeFora={abasDeFora}
          acaoDaAba={abaAberta === "ctx-detalhes" ? <SeletorDaParte parte={parte} onParte={setParte} /> : undefined}
        >
          {abaAberta === "ctx-cerebro" && <CerebroDoCliente key={clientId} clientId={clientId} userId={userId} onRevisar={pedirAoAgente} />}
          {abaAberta === "ctx-plano" && (
            <section id="ctx-plano" aria-label="Plano do cliente" className="min-w-0">
              <ContextoPlanoDoCliente onPedirAoAgente={pedirAoAgente} />
            </section>
          )}
          {abaAberta === "ctx-perfis" && (
            <section id="ctx-perfis" aria-label="Perfis do Instagram" className="min-w-0">
              <Suspense fallback={<Carregando forma="lista" linhas={3} rotulo="Carregando os perfis" />}>
                <PerfisDoInstagram />
              </Suspense>
            </section>
          )}
          {abaAberta === "ctx-mcp" && (
            <section id="ctx-mcp" aria-label="MCP" className="min-w-0">
              <Suspense fallback={<Carregando forma="lista" linhas={3} rotulo="Carregando o MCP" />}>
                <ContextoMcp />
              </Suspense>
            </section>
          )}
          {abaAberta === "ctx-detalhes" && (
            <section id="ctx-detalhes" aria-label="Editar em detalhe" className="min-w-0">
              <DetalhesDoContexto parte={parte} />
            </section>
          )}
        </ContextoAutomatico>
      </div>
    </AreaDeTrabalho>
  );
}
