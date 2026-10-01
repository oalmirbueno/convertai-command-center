import { useRef, useState } from "react";
import { Check, CircleDashed, Loader2, Wand2, X } from "lucide-react";
import { toast } from "sonner";
import { useMarcaDaMesa, useMesa } from "@/components/mesa/MesaContexto";
import { useEstimativa } from "@/components/mesa/Custo";
import BotaoComIcone from "@/components/sistema/BotaoComIcone";
import JanelaCentral from "@/components/sistema/JanelaCentral";
import { botao, juntar, lista, texto } from "@/components/sistema/estilos";
import { textoDoErro, usd } from "@/lib/mesa/api";
import { duracaoAlvo, normalizarFilme, TAMANHOS_DO_MOTION } from "../../../supabase/functions/mesa-motion/modulos/motion-metodo";
import { CARACTERES_POR_SEGUNDO, lerNarracao, modeloDeVoz } from "../../../supabase/functions/mesa-motion/modulos/narracao";
import { useModeloDaAcao } from "./FilmeAberto";
import { chamarMotion, type Filme, uidDoClique, useGuardarFilme } from "./motionApi";
import { passosFeitos, useSituacaoDaVoz } from "./vozApi";

/**
 * Filme em poucos cliques (frente MOV): a receita inteira numa janela, com o
 * custo antes e o que já está feito pulado. BRAND.md, 3 storyboards, o Jev
 * escolhe o melhor, direção de arte pela marca, falas, narração do roteiro
 * inteiro na voz da marca, cenas encaixadas na voz e os stills pedidos à
 * máquina da agência. Passo a passo na tela (uma chamada por vez, sem laço):
 * parou num erro, a frase aparece e "Continuar" segue dali. Nada vai ao
 * cliente: o filme para nos stills, para a equipe aprovar.
 */

type IdDoPasso = "brand" | "storyboards" | "escolher" | "direcao" | "falas" | "narracao" | "encaixar" | "stills";
type Estado = "esperando" | "rodando" | "feito" | "pulado" | "erro";

export default function PoucosCliques({ filme }: { filme: Filme }) {
  const { clientId, atualizarCusto, saldoUsd } = useMesa();
  const { marca } = useMarcaDaMesa();
  const guardar = useGuardarFilme();
  const [aberta, setAberta] = useState(false);
  // A situação da voz só é lida com a janela aberta (a barra do filme aparece em toda etapa).
  const voz = useSituacaoDaVoz(clientId, marca ? marca.id : null, aberta);
  const { modelo: mBrand } = useModeloDaAcao("brand");
  const { modelo: mStory } = useModeloDaAcao("storyboards");
  const { modelo: mFalas } = useModeloDaAcao("falas");
  const [marcados, setMarcados] = useState<Record<string, boolean>>({});
  const [estados, setEstados] = useState<Record<string, Estado>>({});
  const [erro, setErro] = useState<{ passo: IdDoPasso; texto: string } | null>(null);
  const [avisos, setAvisos] = useState<Partial<Record<IdDoPasso, string>>>({});
  const [rodando, setRodando] = useState(false);
  const atual = useRef<Filme>(filme);
  if (!rodando) atual.current = filme;

  const temChave = !!(voz.data && voz.data.tem_chave);
  const vozDaMarca = voz.data ? voz.data.padrao : null;
  const comVoz = filme.entrevista.locucao !== "sem_voz";
  const temVoz = !!filme.som.narracao.voz || !!vozDaMarca;
  const n = filme.som.narracao;
  const segundos = duracaoAlvo(filme.entrevista, filme.tipo);
  const feitos = passosFeitos(filme);
  const custoDaVoz = Math.round(((segundos * CARACTERES_POR_SEGUNDO * 1.1) / 1000) * modeloDeVoz(n.modelo).preco_1k_usd * 1e4) / 1e4;

  const passos: Array<{ id: IdDoPasso; rotulo: string; dica: string; feito: boolean; possivel: string | null }> = [
    { id: "brand", rotulo: "BRAND.md e beat sheet", dica: "pelo kit, dossiê e entrevista", feito: !!filme.brand.essencia, possivel: null },
    { id: "storyboards", rotulo: "3 storyboards", dica: "caminhos diferentes para o mesmo filme", feito: filme.storyboards.length > 0, possivel: null },
    { id: "escolher", rotulo: "O Jev escolhe o melhor storyboard", dica: "pela promessa, o público e o gancho", feito: filme.storyboard_escolhido !== null, possivel: null },
    { id: "direcao", rotulo: "Direção de arte pela marca", dica: "acabamento, transição e ritmo (Jev)", feito: feitos.direcao, possivel: null },
    { id: "falas", rotulo: "Falas da narração", dica: "uma por cena, no tempo da cena", feito: Object.keys(n.falas).length > 0, possivel: comVoz ? null : "A entrevista pediu só trilha e efeitos." },
    { id: "narracao", rotulo: "Narração na voz da marca", dica: `roteiro inteiro, ${modeloDeVoz(n.modelo).rotulo}`, feito: n.audios.length > 0, possivel: !comVoz ? "A entrevista pediu só trilha e efeitos." : !temChave ? "Falta a chave da ElevenLabs no servidor." : !temVoz ? "Escolha a voz da marca na etapa Voz e som." : null },
    { id: "encaixar", rotulo: "Encaixar as cenas na voz", dica: "cada cena no tempo da fala", feito: feitos.encaixar, possivel: !comVoz || !temChave || !temVoz ? "Sem narração." : null },
    { id: "stills", rotulo: "Pedir os stills", dica: "na máquina da agência, sem custo", feito: feitos.stills, possivel: null },
  ];
  const ativo = (p: (typeof passos)[number]) => !p.possivel && (marcados[p.id] !== undefined ? marcados[p.id] : !p.feito);
  // Reaplicar a direção de arte ou o encaixe muda as cenas: o que já foi aprovado fica desatualizado.
  const aprovados = filme.cenas.filter((c) => c.still_aprovado).length;
  const invalida = aprovados > 0 && (ativo(passos[3]) || ativo(passos[6]));

  const partes = [
    ...(ativo(passos[0]) && mBrand ? [{ modeloId: mBrand.id, tipo: "texto" as const, tokensEntrada: TAMANHOS_DO_MOTION.brand.entrada, tokensSaida: TAMANHOS_DO_MOTION.brand.saida }] : []),
    ...(ativo(passos[1]) && mStory ? [{ modeloId: mStory.id, tipo: "texto" as const, tokensEntrada: TAMANHOS_DO_MOTION.storyboards.entrada, tokensSaida: TAMANHOS_DO_MOTION.storyboards.saida }] : []),
    ...(ativo(passos[4]) && mFalas ? [{ modeloId: mFalas.id, tipo: "texto" as const, tokensEntrada: TAMANHOS_DO_MOTION.falas.entrada, tokensSaida: TAMANHOS_DO_MOTION.falas.saida }] : []),
  ];
  const est = useEstimativa(partes.length ? partes : null, aberta);
  const total = (est.data || 0) + (ativo(passos[5]) ? custoDaVoz : 0) + (ativo(passos[2]) || ativo(passos[3]) ? 0.002 : 0);

  const guardarDe = (d: { filme?: unknown; links?: Record<string, string> }) => {
    const f = normalizarFilme(d.filme);
    if (!f) return;
    atual.current = f;
    guardar(d.filme, d.links);
  };

  const rodarPasso = async (id: IdDoPasso) => {
    const f = atual.current;
    if (id === "brand") return guardarDe(await chamarMotion("brand_gerar", { filme_id: f.id, modelo_id: mBrand ? mBrand.id : undefined }));
    if (id === "storyboards") return guardarDe(await chamarMotion("storyboards_gerar", { filme_id: f.id, modelo_id: mStory ? mStory.id : undefined }));
    if (id === "escolher") {
      let indice = 0;
      try {
        const s = await chamarMotion<{ indice: number | null }>("storyboard_sugerir", { filme_id: f.id });
        if (typeof s.indice === "number") indice = s.indice;
        else setAvisos((a) => ({ ...a, escolher: "O Jev não indicou um storyboard: ficou o storyboard 1. Troque na etapa Storyboards." }));
      } catch (e) {
        // Sem o Jev agora: fica o primeiro e a equipe fica sabendo (a falha já foi para o log no servidor).
        setAvisos((a) => ({ ...a, escolher: `O Jev não respondeu (${textoDoErro(e)}): ficou o storyboard 1. Troque na etapa Storyboards.` }));
      }
      return guardarDe(await chamarMotion("storyboard_escolher", { filme_id: f.id, indice }));
    }
    if (id === "direcao") {
      const s = await chamarMotion<{ sugestao: Record<string, { valor: string } | null> }>("direcao_sugerir", { filme_id: f.id });
      const entrevista = { ...f.entrevista } as Record<string, unknown>;
      if (s.sugestao.transicao) entrevista.transicao = s.sugestao.transicao.valor;
      if (s.sugestao.ritmo) entrevista.ritmo = s.sugestao.ritmo.valor;
      const estilo = s.sugestao.estilo_da_voz ? s.sugestao.estilo_da_voz.valor : null;
      guardarDe(await chamarMotion("filme_salvar", { filme_id: f.id, entrevista, ...(estilo ? { som: { ...f.som, narracao: lerNarracao({ ...f.som.narracao, ajustes: { ...f.som.narracao.ajustes, estilo } }) } } : {}) }));
      if (s.sugestao.acabamento) guardarDe(await chamarMotion("acabamento_aplicar", { filme_id: f.id, acabamento: s.sugestao.acabamento.valor }));
      return;
    }
    if (id === "falas") {
      if (!f.som.narracao.ligada) guardarDe(await chamarMotion("filme_salvar", { filme_id: f.id, som: { ...f.som, narracao: lerNarracao({ ...f.som.narracao, ligada: true }) } }));
      return guardarDe(await chamarMotion("falas_escrever", { filme_id: f.id, modelo_id: mFalas ? mFalas.id : undefined }));
    }
    if (id === "narracao") {
      if (!f.som.narracao.voz && vozDaMarca) guardarDe(await chamarMotion("filme_salvar", { filme_id: f.id, som: { ...f.som, narracao: lerNarracao({ ...f.som.narracao, ligada: true, voz: { voice_id: vozDaMarca.voice_id, nome: vozDaMarca.nome, origem: vozDaMarca.origem } }) } }));
      return guardarDe(await chamarMotion("narracao_gerar", { filme_id: f.id, modo: "roteiro" }));
    }
    if (id === "encaixar") return guardarDe(await chamarMotion("narracao_casar", { filme_id: f.id }));
    // stills: um pedido por cena em código sem still aprovado ou em dia, no primeiro formato (a máquina da agência faz na ordem).
    const formato = f.formatos[0] || "9:16";
    const faltam = passosFeitos(f).cenasSemStill;
    for (const c of f.cenas.filter((x) => faltam.indexOf(x.id) >= 0)) await chamarMotion("cena_pedir", { filme_id: f.id, cena_id: c.id, modo: "still", formatos: [formato], uid: uidDoClique("still") });
  };

  const fazer = async (desde?: IdDoPasso) => {
    setRodando(true);
    setErro(null);
    if (!desde) setAvisos({});
    const fila = passos.filter((p) => ativo(p));
    const inicio = desde ? Math.max(0, fila.findIndex((p) => p.id === desde)) : 0;
    const novos: Record<string, Estado> = { ...estados };
    fila.slice(0, inicio).forEach((p) => (novos[p.id] = novos[p.id] || "feito"));
    for (const p of fila.slice(inicio)) {
      novos[p.id] = "rodando";
      setEstados({ ...novos });
      try {
        await rodarPasso(p.id);
        novos[p.id] = "feito";
        setEstados({ ...novos });
      } catch (e) {
        novos[p.id] = "erro";
        setEstados({ ...novos });
        setErro({ passo: p.id, texto: textoDoErro(e) });
        setRodando(false);
        atualizarCusto();
        return;
      }
    }
    setRodando(false);
    atualizarCusto();
    toast.success("Filme montado até os stills", { description: "Confira e aprove os stills na etapa Stills." });
  };

  const icone = (e: Estado | undefined) =>
    e === "rodando" ? <Loader2 className="h-4 w-4 animate-spin text-primary" /> : e === "feito" ? <Check className="h-4 w-4 text-primary" /> : e === "erro" ? <X className="h-4 w-4 text-destructive" /> : <CircleDashed className="h-4 w-4 text-muted-foreground" />;

  return (
    <>
      <BotaoComIcone icone={<Wand2 className="h-3.5 w-3.5" />} rotulo="Poucos cliques" className="mb-2 mr-1" onClick={() => setAberta(true)} data-poucos-cliques="" />
      <JanelaCentral
        aberta={aberta}
        onMudar={(v) => !v && !rodando && setAberta(false)}
        titulo="Filme em poucos cliques"
        icone={<Wand2 className="h-4 w-4" />}
        largura="md"
        descricao={`${filme.nome} · custo estimado ${est.isLoading ? "calculando" : usd(total)}`}
        ajuda="Faz a receita do filme de uma vez, parando nos stills para a equipe aprovar. O que já está feito vem desmarcado. Cada passo é uma chamada, na ordem; se um parar, a frase aparece e Continuar segue dali. Custos pelo preço de tabela, na carteira do cliente."
        fecharNoFundo={!rodando}
        rodape={
          <div className="flex min-w-0 items-center justify-end">
            {saldoUsd !== null && saldoUsd < total && <span className={juntar(texto.auxiliar, "mr-auto text-warning")}>O saldo ({usd(saldoUsd)}) não cobre.</span>}
            <button type="button" className={juntar(botao.secundario, "mr-2")} onClick={() => setAberta(false)} disabled={rodando}>
              Fechar
            </button>
            {erro ? (
              <button type="button" className={botao.primario} onClick={() => void fazer(erro.passo)} disabled={rodando}>
                Continuar
              </button>
            ) : (
              <button type="button" className={botao.primario} onClick={() => void fazer()} disabled={rodando || !passos.some(ativo)} data-fazer-poucos-cliques="">
                {rodando ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Wand2 className="mr-1 h-3.5 w-3.5" />}
                Fazer · {usd(total)}
              </button>
            )}
          </div>
        }
        data-janela-poucos-cliques=""
      >
        <ul className={juntar(lista.aberta, lista.divisoria)}>
          {passos.map((p) => (
            <li key={p.id} className={lista.linha} data-passo={p.id}>
              <input
                type="checkbox"
                className="mr-3 h-4 w-4 shrink-0 accent-primary"
                checked={ativo(p)}
                disabled={!!p.possivel || rodando}
                onChange={(e) => setMarcados({ ...marcados, [p.id]: e.target.checked })}
                aria-label={p.rotulo}
              />
              <span className="min-w-0 flex-1">
                <span className={juntar(texto.corpo, "block")}>{p.rotulo}</span>
                <span className={juntar(texto.auxiliar, "block", p.possivel || avisos[p.id] ? "text-warning" : "")}>{avisos[p.id] || p.possivel || (p.feito ? "já feito (marque para refazer)" : p.dica)}</span>
              </span>
              <span className="ml-2 shrink-0">{icone(estados[p.id])}</span>
            </li>
          ))}
        </ul>
        {invalida && (
          <p className={juntar(texto.auxiliar, "mt-3 text-warning")} data-aviso-invalida="">
            {aprovados === 1 ? "1 still já foi aprovado" : `${aprovados} stills já foram aprovados`}. Reaplicar a direção de arte ou o encaixe muda as cenas: os stills e as finais aprovados ficam desatualizados e precisam de nova aprovação. Desmarque esses passos para manter.
          </p>
        )}
        {erro && (
          <p className={juntar(texto.auxiliar, "mt-3 text-destructive")} role="alert">
            {erro.texto}
          </p>
        )}
      </JanelaCentral>
    </>
  );
}
