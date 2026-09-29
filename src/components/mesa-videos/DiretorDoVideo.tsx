import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Clapperboard, Loader2, Send, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { useMesa } from "@/components/mesa/MesaContexto";
import { Ditado } from "@/components/mesa/Ditado";
import { textoDoErro } from "@/lib/mesa/api";
import CartaoDeAcao, { OQuePossoFazer } from "@/components/agentes/CartaoDeAcao";
import { acaoDoAnexo, type AcaoDoAgente, type PedidoDaAcao, type RespostaDaAcao } from "@/lib/agentes/acoesDoAgente";
import PainelDoAgente from "@/components/sistema/PainelDoAgente";
import AjudaRecolhida from "@/components/sistema/AjudaRecolhida";
import SeletorCompacto from "@/components/sistema/SeletorCompacto";
import { useEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
import { botao, campoTexto, conversa, juntar, texto } from "@/components/sistema/estilos";
import { useProjetoDoDiretor } from "@/lib/mesa-videos/api";
import { FASES_DO_DIRETOR, type FaseDoDiretor, type ProjetoDoDiretor } from "../../../supabase/functions/_shared/diretor-de-video";
import type { IrPara } from "./MesaDeVideo";
import { chamarMesaVideos, chaveDosPedidos } from "./videosApi";

/**
 * Agente DIRETOR (frente V-A), no painel fixo da Mesa Vídeos.
 * Briefing -> Pesquisa (web, com fontes) -> Bíblia -> Roteiro -> Gerar
 * (cartão com custo, Confirmar) -> Avaliar -> Editor. GPT-6 Luna com
 * raciocínio máximo, pela carteira do cliente (centavos por resposta). As
 * mudanças na bíblia e no roteiro entram no projeto aberto e têm Desfazer.
 * O diretor só usa fato com fonte e o contexto do cliente; o resto pergunta.
 */

interface Mensagem {
  id: string;
  papel: "usuario" | "agente";
  texto: string;
  mensagem_id?: string | null;
  acao?: AcaoDoAgente | null;
  perguntas?: string[];
  avisos?: string[];
  custo?: number | null;
  mudou?: boolean;
}

const ROTULO_DA_FASE: Record<FaseDoDiretor, string> = { briefing: "Briefing", pesquisa: "Pesquisa", biblia: "Bíblia", roteiro: "Roteiro", livre: "Conversa" };
const ETAPA_DA_FASE: Partial<Record<FaseDoDiretor, string>> = { biblia: "biblia", roteiro: "roteiro", pesquisa: "biblia" };
const MAX = 40;
let n = 0;
const novoId = () => `d${Date.now().toString(36)}${(n++).toString(36)}`;

const CAPACIDADES = ["pesquisar a região com fontes", "montar a bíblia e o roteiro plano a plano", "propor gerar com o custo à vista", "avaliar a continuidade e mandar ao editor"];

export default function DiretorDoVideo({ irPara, topo }: { irPara: IrPara; topo: ReactNode }) {
  const { clientId, atualizarCusto } = useMesa();
  const queryClient = useQueryClient();
  const { projeto, trocar, desfazer, podeDesfazer } = useProjetoDoDiretor(clientId);
  const [mensagens, setMensagens] = useEstadoDaTela<Mensagem[]>(`mesa-videos:diretor:conversa:${clientId}`, [], { validar: (v) => Array.isArray(v) });
  const [textoDoCampo, setTexto] = useEstadoDaTela<string>(`mesa-videos:diretor:rascunho:${clientId}`, "");
  const [fase, setFase] = useEstadoDaTela<FaseDoDiretor>(`mesa-videos:diretor:fase:${clientId}`, projeto.fase || "briefing", { validar: (v) => (FASES_DO_DIRETOR as readonly string[]).indexOf(String(v)) >= 0 });
  const [pensando, setPensando] = useState(false);
  const lista = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = lista.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [mensagens.length, pensando]);
  const juntarMensagens = (novas: Mensagem[]) => setMensagens((m) => m.concat(novas).slice(-MAX));

  const pedir = async () => {
    const t = textoDoCampo.trim();
    if (!t || pensando) return;
    juntarMensagens([{ id: novoId(), papel: "usuario", texto: t }]);
    setTexto("");
    setPensando(true);
    try {
      const conversa = mensagens.slice(-8).map((m) => ({ papel: m.papel, texto: m.texto.slice(0, 600) }));
      const r = await chamarMesaVideos<{ projeto: ProjetoDoDiretor; resposta: string; perguntas: string[]; avisos: string[]; custo_usd: number; mensagem_id: string | null; acao: unknown; pedido_do_editor: string[] | null; gravado: boolean }>({
        acao: "diretor_conversar",
        client_id: clientId,
        projeto,
        texto: t,
        fase,
        conversa,
      });
      const mudou = JSON.stringify(r.projeto.biblia) !== JSON.stringify(projeto.biblia) || JSON.stringify(r.projeto.roteiro) !== JSON.stringify(projeto.roteiro) || r.projeto.id !== projeto.id;
      if (mudou) trocar(r.projeto);
      atualizarCusto();
      const a = acaoDoAnexo(r.acao);
      juntarMensagens([{ id: novoId(), papel: "agente", texto: r.resposta, perguntas: r.perguntas, avisos: r.avisos, custo: r.custo_usd, mensagem_id: r.mensagem_id, acao: a, mudou }]);
      if (r.pedido_do_editor) toast.info("O diretor sugeriu mandar ao editor", { description: "Confira os resultados escolhidos no Roteiro e toque em Editor." });
      if (mudou && ETAPA_DA_FASE[fase]) irPara(ETAPA_DA_FASE[fase] as string);
    } catch (e) {
      juntarMensagens([{ id: novoId(), papel: "agente", texto: `Não consegui agora: ${textoDoErro(e)}` }]);
    } finally {
      setPensando(false);
    }
  };

  const onPedido = (m: Mensagem) => (pedido: PedidoDaAcao): Promise<RespostaDaAcao> => {
    const corpo: Record<string, unknown> = { acao: pedido === "desfazer" ? "desfazer_acao_agente" : "executar_acao_agente", mensagem_id: m.mensagem_id, acao_id: m.acao ? m.acao.id : undefined };
    if (pedido === "descartar") corpo.descartar = true;
    if (pedido === "parar") corpo.parar = true;
    return chamarMesaVideos<RespostaDaAcao>(corpo);
  };

  return (
    <PainelDoAgente
      titulo="Diretor"
      icone={<Clapperboard className="h-4 w-4" />}
      descricao={`${projeto.titulo || "Projeto"} · ${projeto.roteiro.planos.length} planos`}
      acoes={
        <>
          {podeDesfazer && (
            <button type="button" className={botao.icone} onClick={() => desfazer() && toast.success("Voltou como estava")} aria-label="Desfazer a última mudança do diretor" title="Desfazer">
              <Undo2 className="h-3.5 w-3.5" />
            </button>
          )}
          <AjudaRecolhida rotulo="Como o diretor funciona">
            O diretor pesquisa (com fontes), monta a bíblia (personagens, cenários, luz, regras) e o roteiro plano a plano. Ele não inventa fato: o que não sabe vira pergunta. Gerar sempre pede a sua confirmação com o custo. Cada resposta custa centavos (GPT-6 Luna, raciocínio máximo) na carteira do cliente.
          </AjudaRecolhida>
        </>
      }
      topo={
        <div className="space-y-2">
          {topo}
          <SeletorCompacto rotulo="Fase do diretor" opcoes={FASES_DO_DIRETOR.map((f) => ({ valor: f, rotulo: ROTULO_DA_FASE[f] }))} valor={fase} onEscolher={(v) => setFase(v as FaseDoDiretor)} />
        </div>
      }
      refDasMensagens={lista}
      rotuloDasMensagens="Conversa com o diretor"
      compositor={
        <>
          <OQuePossoFazer capacidades={CAPACIDADES} />
          <textarea
            className={juntar(campoTexto, "min-h-[64px] resize-none")}
            value={textoDoCampo}
            rows={2}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void pedir();
              }
            }}
            placeholder={fase === "pesquisa" ? "Ex.: pesquisa a Lapa de Curitiba no inverno, arquitetura e luz" : "Ex.: quero um filme de 30 s de uma padaria da família"}
            aria-label="Pedido para o diretor"
            disabled={pensando}
          />
          <div className="flex min-w-0 items-center justify-end">
            <span className={juntar(texto.auxiliar, "mr-2 min-w-0 flex-1 truncate")}>Centavos por resposta</span>
            <Ditado valor={textoDoCampo} onChange={setTexto} disabled={pensando} className="mr-1.5 min-w-0" />
            <button type="button" className={botao.primario} onClick={() => void pedir()} disabled={pensando || !textoDoCampo.trim()}>
              {pensando ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Send className="mr-1.5 h-3.5 w-3.5" />}
              Enviar
            </button>
          </div>
        </>
      }
    >
      {!mensagens.length && !pensando && (
        <p className={juntar(conversa.apoio, "leading-relaxed")} data-diretor-vazio="">
          Conte o vídeo que quer (nicho, lugar, jeito) ou escolha um kit.
        </p>
      )}
      {mensagens.map((m) => (
        <div key={m.id} className="min-w-0 space-y-2">
          <div className={juntar(conversa.balao, m.papel === "usuario" ? conversa.doUsuario : conversa.doAgente)}>
            <p className="whitespace-pre-wrap">{m.texto}</p>
            {m.perguntas && m.perguntas.length > 0 && (
              <ul className="mt-2 list-disc space-y-0.5 pl-4">
                {m.perguntas.map((q) => (
                  <li key={q}>{q}</li>
                ))}
              </ul>
            )}
            {m.avisos && m.avisos.length > 0 && <p className={juntar(texto.auxiliar, "mt-2")}>{m.avisos.slice(0, 3).join(" ")}</p>}
            {(m.mudou || typeof m.custo === "number") && (
              <p className={juntar(texto.auxiliar, "mt-1")}>
                {m.mudou ? "Projeto atualizado. " : ""}
                {typeof m.custo === "number" ? `US$ ${m.custo.toFixed(3).replace(".", ",")}` : ""}
              </p>
            )}
          </div>
          {m.acao && m.mensagem_id && (
            <CartaoDeAcao
              acao={m.acao}
              titulo="Gerar planos"
              observacao={`Custo estimado US$ ${Number(m.acao.custo_estimado_usd || 0).toFixed(2).replace(".", ",")}. Sem desfazer.`}
              onPedido={onPedido(m)}
              onFeito={(_p, resposta) => {
                const novo = acaoDoAnexo(resposta && resposta.anexo);
                if (novo) setMensagens((l) => l.map((x) => (x.id === m.id ? { ...x, acao: novo } : x)));
                void queryClient.invalidateQueries({ queryKey: chaveDosPedidos(clientId) });
                atualizarCusto();
              }}
            />
          )}
        </div>
      ))}
      {pensando && (
        <p className={juntar(conversa.apoio, "mr-6 flex items-center px-1")}>
          <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> O diretor está pensando{fase === "pesquisa" ? " e pesquisando" : ""}...
        </p>
      )}
    </PainelDoAgente>
  );
}
