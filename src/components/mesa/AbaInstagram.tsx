import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { RefreshCw } from "lucide-react";
import AreaDeTrabalho, { abrirLateralDaArea } from "@/components/sistema/AreaDeTrabalho";
import SeletorCompacto from "@/components/sistema/SeletorCompacto";
import { Carregando, EstadoDeErro } from "@/components/sistema/Estados";
import { useEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
import { botao, juntar, texto } from "@/components/sistema/estilos";
import { textoDoErro } from "@/lib/mesa/api";
import { useMesa } from "./MesaContexto";
import BlocoDaAba from "./instagram/BlocoDaAba";
import PreviaDoPerfil from "./instagram/PreviaDoPerfil";
import BioENome from "./instagram/BioENome";
import GeradorDeDestaques from "./instagram/GeradorDeDestaques";
import PlanoDaGrade from "./instagram/PlanoDaGrade";
import MetricasDoPerfil from "./instagram/MetricasDoPerfil";
import ColunaDoCliente from "./instagram/ColunaDoCliente";
import OutrasRedes, { SeletorDeRede } from "./instagram/OutrasRedes";
import AgenteDoInstagram from "./instagram/AgenteDoInstagram";
import { useAtualizarPainel, usePainelDoInstagram, type AnaliseDaBio } from "./instagram/instagramApi";
import { destaquesLimpos, type DestaqueProposto } from "../../../supabase/functions/_shared/conhecimento-perfil-instagram";
import { ehBloco, ehRede, ordemDoPlano, redePorChave, type BlocoDaAba as ChaveDoBloco, type ChaveDaRede } from "../../../supabase/functions/_shared/instagram-do-cliente";

/**
 * Aba Instagram da Mesa (frente IG, 28/09, depois de Contexto): toda a frente
 * do Instagram do cliente num lugar só, em blocos que recolhem.
 * - Prévia do perfil como no app (foto, números, nome, bio, link, destaques
 *   e grade), com o plano por cima quando pedir.
 * - Bio e nome: o Jev diz se a bio está boa; se não, sugestões com antes e
 *   depois e Copiar (a API não edita bio).
 * - Destaques: capas no estilo da marca, geradas uma por vez.
 * - Planejar a grade: ordem de ir ao ar e o "Publicar em" de cada post.
 * - Métricas do robô semanal. Ao lado: resumo da empresa, próximos posts,
 *   pastas e arquivos. Em cima: a rede (Instagram por padrão) e a conta.
 * O agente fica ao lado (gaveta no celular) e sempre deixa o caminho.
 * Endereço: /mesa?client=<id>&aba=instagram[&bloco=bio|destaques|grade|...]
 */
export default function AbaInstagram() {
  const { clientId, clientName, podeRecarregar } = useMesa();
  const [params, setParams] = useSearchParams();
  const [rede, setRede] = useEstadoDaTela<ChaveDaRede>(`mesa:instagram:rede:${clientId}`, "instagram", { validar: (v) => ehRede(v) });
  const [contaEscolhida, setContaEscolhida] = useEstadoDaTela<string | null>(`mesa:instagram:conta:${clientId}`, null);
  const painel = usePainelDoInstagram(clientId, contaEscolhida);
  const atualizar = useAtualizarPainel(clientId, contaEscolhida);
  const dados = painel.data || null;
  const contaId = dados ? dados.conta_id : contaEscolhida;

  const [lista, setLista] = useEstadoDaTela<DestaqueProposto[]>(`mesa:instagram:destaques:${clientId}`, [], { validar: (v) => Array.isArray(v) });
  const [mostrarPlano, setMostrarPlano] = useState(false);
  const [pedido, setPedido] = useState<{ texto: string; n: number } | null>(null);
  const [irPara, setIrPara] = useState<{ bloco: ChaveDoBloco; n: number } | null>(null);
  const [ordemAgora, setOrdemAgora] = useState<string[] | null>(null);

  // ?bloco= (o caminho do agente): abre o bloco e rola até ele; o parâmetro sai do endereço.
  const blocoUrl = params.get("bloco");
  useEffect(() => {
    if (!blocoUrl) return;
    if (ehBloco(blocoUrl)) {
      if (blocoUrl === "redes") setRede("instagram");
      setIrPara({ bloco: blocoUrl, n: Date.now() });
    }
    const next = new URLSearchParams(params);
    next.delete("bloco");
    setParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocoUrl]);

  const pedidoDo = (b: ChaveDoBloco) => (irPara && irPara.bloco === b ? irPara.n : null);
  const planejados = useMemo(() => (dados ? ordemDoPlano(dados.grade.itens, ordemAgora || dados.grade.ordem) : []), [dados, ordemAgora]);

  const usarDestaques = (l: DestaqueProposto[]) => {
    setLista(destaquesLimpos(l));
    setIrPara({ bloco: "destaques", n: Date.now() });
  };
  const pedirAoAgente = (t: string) => {
    abrirLateralDaArea();
    setPedido({ texto: t, n: Date.now() });
  };

  const lateral = (
    <AgenteDoInstagram
      mensagens={dados ? dados.mensagens : []}
      contaId={contaId}
      pedido={pedido}
      onMensagens={(m) => atualizar.mudar((p) => ({ ...p, mensagens: m }))}
      onUsarDestaques={usarDestaques}
    />
  );

  const topo = (
    <div className="flex min-w-0 flex-wrap items-center justify-between" data-topo-do-instagram="">
      <SeletorDeRede valor={rede} onEscolher={setRede} redes={dados ? dados.redes : null} />
      {rede === "instagram" && (
        <div className="mb-1 flex min-w-0 items-center">
          {dados && dados.contas.length > 1 && (
            <SeletorCompacto
              rotulo="Conta do Instagram"
              valor={contaId || ""}
              onEscolher={(v) => {
                setContaEscolhida(v);
                setOrdemAgora(null);
              }}
              opcoes={dados.contas.map((c) => ({ valor: c.id, rotulo: `@${c.username}` }))}
            />
          )}
          <button type="button" className={juntar(botao.icone, "ml-1")} onClick={() => void painel.refetch()} disabled={painel.isFetching} aria-label="Ler o perfil de novo" title="Ler o perfil de novo">
            <RefreshCw className={juntar("h-4 w-4", painel.isFetching ? "animate-spin" : "")} />
          </button>
        </div>
      )}
    </div>
  );

  return (
    <AreaDeTrabalho
      memoria="mesa-instagram"
      rotuloDaLateral="Agente do Instagram"
      rotuloDoPrincipal="Instagram do cliente"
      memoriaDaRolagem={`mesa:instagram:${clientId}`}
      lateral={lateral}
    >
      <div className="min-w-0 space-y-3 pb-6">
        {topo}
        {dados && dados.aviso_sql && <p className="rounded-md bg-warning/10 px-3 py-2 text-[12.5px] leading-5 text-foreground">{dados.aviso_sql}</p>}

        {painel.isLoading && <Carregando forma="aba" rotulo="Lendo o Instagram do cliente" />}
        {painel.isError && !dados && (
          <EstadoDeErro
            titulo="Não foi possível abrir a aba Instagram."
            descricao={textoDoErro(painel.error)}
            acao={
              <button type="button" className={juntar(botao.secundario, "h-8")} onClick={() => void painel.refetch()}>
                Tentar de novo
              </button>
            }
          />
        )}

        {rede !== "instagram" && (
          <BlocoDaAba id="redes" clientId={clientId} titulo={redePorChave(rede).rotulo} pedidoDeAbrir={pedidoDo("redes")}>
            <OutrasRedes rede={rede} painel={dados} onMudou={() => void atualizar.reler()} />
          </BlocoDaAba>
        )}

        {rede === "instagram" && dados && (
          <div className="grid min-w-0 grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_260px]">
            <div className="min-w-0 space-y-3">
              <BlocoDaAba
                id="perfil"
                clientId={clientId}
                titulo="Prévia do perfil"
                resumo={dados.perfil.username ? `@${dados.perfil.username}` : "sem conta"}
                pedidoDeAbrir={pedidoDo("perfil")}
              >
                <PreviaDoPerfil perfil={dados.perfil} capas={dados.capas} planejados={planejados} mostrarPlano={mostrarPlano} onMostrarPlano={setMostrarPlano} />
              </BlocoDaAba>

              <BlocoDaAba
                id="bio"
                clientId={clientId}
                titulo="Bio e nome"
                resumo={dados.bio_analise ? (dados.bio_analise.veredito.boa ? "a bio está boa" : "a bio precisa mudar") : "sem análise"}
                pedidoDeAbrir={pedidoDo("bio")}
              >
                <BioENome perfil={dados.perfil} analise={dados.bio_analise} onAnalise={(a: AnaliseDaBio) => atualizar.mudar((p) => ({ ...p, bio_analise: a }))} />
              </BlocoDaAba>

              <BlocoDaAba id="destaques" clientId={clientId} titulo="Destaques" resumo={`${dados.capas.length} capas · ${lista.length} na lista`} pedidoDeAbrir={pedidoDo("destaques")}>
                <GeradorDeDestaques
                  contaId={contaId}
                  paleta={dados.kit.paleta}
                  logo={dados.kit.logo}
                  capas={dados.capas}
                  lista={lista}
                  onLista={setLista}
                  onNovaCapa={(c) => atualizar.mudar((p) => ({ ...p, capas: p.capas.filter((x) => x.id !== c.id).concat([c]) }))}
                  onArquivada={(id) => atualizar.mudar((p) => ({ ...p, capas: p.capas.filter((x) => x.id !== id) }))}
                  onPedirAoAgente={() => pedirAoAgente("Proponha os destaques do perfil (nome curto e ícone de cada um), na ordem certa para quem chega.")}
                  nomeDoCliente={clientName}
                />
              </BlocoDaAba>

              <BlocoDaAba id="grade" clientId={clientId} titulo="Planejar a grade" resumo={`${dados.grade.itens.length} posts para ir ao ar`} pedidoDeAbrir={pedidoDo("grade")}>
                <PlanoDaGrade
                  itens={dados.grade.itens}
                  ordemSalva={ordemAgora || dados.grade.ordem}
                  contaId={contaId}
                  podePublicar={podeRecarregar}
                  onOrdem={setOrdemAgora}
                  onVerNaPrevia={() => {
                    setMostrarPlano(true);
                    setIrPara({ bloco: "perfil", n: Date.now() });
                  }}
                  onMudou={() => void atualizar.reler()}
                />
              </BlocoDaAba>

              <BlocoDaAba id="metricas" clientId={clientId} titulo="Métricas" resumo="robô semanal" pedidoDeAbrir={pedidoDo("metricas")}>
                <MetricasDoPerfil clientId={clientId} contaId={contaId} />
              </BlocoDaAba>
            </div>
            <aside className="min-w-0" aria-label="Resumo do cliente">
              <ColunaDoCliente clientId={clientId} painel={dados} />
            </aside>
          </div>
        )}

        {rede === "instagram" && dados && !dados.contas.length && (
          <p className={juntar(texto.auxiliar, "leading-5")}>O cliente não tem Instagram conectado. A prévia usa o que o robô de métricas guardou; conecte a conta em Config, Integrações, para ler ao vivo.</p>
        )}
      </div>
    </AreaDeTrabalho>
  );
}
