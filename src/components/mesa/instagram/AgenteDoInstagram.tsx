import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Instagram, Loader2, Send, Wand2 } from "lucide-react";
import PainelDoAgente from "@/components/sistema/PainelDoAgente";
import { useEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
import { botao, campoTexto, juntar, texto } from "@/components/sistema/estilos";
import TextoDoAgente from "@/components/agentes/TextoDoAgente";
import { CaminhoDaMensagem } from "@/components/agentes/CaminhoPronto";
import { useMesa } from "../MesaContexto";
import { avisarCustoReal, EstimativaInline, useAvisarErro } from "../Custo";
import { destaquesLimpos, type DestaqueProposto } from "../../../../supabase/functions/mesa-instagram/modulos/conhecimento-perfil-instagram";
import { modeloDaAba } from "./BioENome";
import { chamarInstagram, type MensagemDaAba } from "./instagramApi";
import AjudaRecolhida from "@/components/sistema/AjudaRecolhida";
import CartaoDeAcao from "@/components/agentes/CartaoDeAcao";
import AprendizadoNaConversa, { observacaoDoCusto } from "@/components/agentes/AprendizadoNaConversa";
import { acoesDaMensagem, chamarAcaoDoAgente } from "@/lib/agentes/acoesDoAgente";
import { toast } from "sonner";

/**
 * Agente do Instagram, ao lado da aba (fixo no computador, gaveta no
 * celular). Conversa sobre bio, nome, destaques, grade e métricas com o
 * contexto do cliente; propõe destaques (nome e ícone) que vão para o
 * gerador com um clique; termina sempre com o caminho ("Ir para ...").
 * 29/09: age pelo painel (reordena a grade na hora, com Desfazer; gera as
 * capas dos destaques e analisa a bio depois do Confirmar, com o custo antes)
 * e aprende com cada pedido ("Aprendi", com Esquecer). O que a API do
 * Instagram não deixa (trocar a bio no app), ele diz em uma frase.
 */

const ATALHOS = [
  { rotulo: "Propor destaques", texto: "Proponha os destaques do perfil na ordem certa para quem chega: nome curto, ícone, a direção da capa com a cara da marca e o que entra em cada um." },
  { rotulo: "Gerar as capas", texto: "Gere as capas dos destaques que você propôs, nas cores do kit." },
  { rotulo: "Melhorar a bio", texto: "Analise a bio e o nome do perfil e sugira melhores." },
  { rotulo: "O que melhorar", texto: "Olhe o perfil inteiro (nome, bio, link, grade) e diga as 3 mudanças mais importantes, em ordem." },
  { rotulo: "Grade", texto: "Como organizar a grade dos próximos posts para o perfil ficar encaixado?" },
];

function DestaquesDoAnexo({ anexos, onUsar }: { anexos: unknown; onUsar: (l: DestaqueProposto[]) => void }) {
  const anexo = Array.isArray(anexos) ? (anexos as Array<Record<string, unknown>>).find((a) => a && a.tipo === "destaques_propostos") : null;
  const itens = anexo ? destaquesLimpos(anexo.itens) : [];
  if (!itens.length) return null;
  return (
    <div className="mt-1.5 min-w-0 rounded-md border border-border bg-background px-2.5 py-2" data-destaques-propostos="">
      <ol className="list-decimal pl-5 text-[12.5px] leading-5">
        {itens.map((d) => (
          <li key={d.nome} className="mb-1">
            <span className="font-medium">{d.nome}</span>
            <span className="text-muted-foreground"> · {d.icone}</span>
            {/* 29/09: a direção da capa e o que entra no destaque (antes só nome e ícone). */}
            {d.conceito && <span className="block text-[12px] leading-snug text-muted-foreground [overflow-wrap:anywhere]">Capa: {d.conceito}</span>}
            {d.conteudo && <span className="block text-[12px] leading-snug text-muted-foreground [overflow-wrap:anywhere]">Dentro: {d.conteudo}</span>}
          </li>
        ))}
      </ol>
      <button type="button" className={juntar(botao.primario, "mt-2 h-8 px-3 text-[12.5px]")} onClick={() => onUsar(itens)}>
        <Wand2 className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
        Usar no gerador
      </button>
    </div>
  );
}

export default function AgenteDoInstagram({
  mensagens,
  contaId,
  pedido,
  onMensagens,
  onUsarDestaques,
  onAcaoFeita,
}: {
  mensagens: MensagemDaAba[];
  contaId: string | null;
  /** Pedido vindo de um bloco ("Pedir ao agente"): muda a cada pedido. */
  pedido: { texto: string; n: number } | null;
  onMensagens: (m: MensagemDaAba[]) => void;
  onUsarDestaques: (l: DestaqueProposto[]) => void;
  /** Depois de uma ação do agente (grade, capas, bio): a aba relê o painel. */
  onAcaoFeita?: () => void;
}) {
  const { clientId, catalogo, atualizarCusto } = useMesa();
  const avisarErro = useAvisarErro();
  const modelo = useMemo(() => modeloDaAba(catalogo), [catalogo]);
  const [rascunho, setRascunho] = useEstadoDaTela<string>(`mesa:instagram:rascunho:${clientId}`, "");
  const [trabalhando, setTrabalhando] = useState(false);
  const [pedidoAgora, setPedidoAgora] = useState<string | null>(null);
  const [recebida, setRecebida] = useState<string | null>(null);
  const lista = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (lista.current) lista.current.scrollTop = lista.current.scrollHeight;
  }, [mensagens.length, trabalhando]);

  const enviar = async (t: string) => {
    const msg = t.trim();
    if (!msg || trabalhando) return;
    setTrabalhando(true);
    setPedidoAgora(msg);
    try {
      const r = await chamarInstagram<{ mensagem_id?: string | null; mensagens?: MensagemDaAba[]; custo_usd?: number; aviso?: string | null }>("conversar", clientId, { mensagem: msg, ...(contaId ? { conta_id: contaId } : {}), ...(modelo ? { modelo_id: modelo.id } : {}) });
      setRascunho("");
      setRecebida(r && r.mensagem_id ? String(r.mensagem_id) : null);
      if (r && Array.isArray(r.mensagens)) onMensagens(r.mensagens as MensagemDaAba[]);
      // A resposta chegou mas não ficou guardada: diz, em vez de sumir calada ao reabrir.
      if (r && !r.mensagem_id && r.aviso) toast.warning("Resposta não guardada", { description: r.aviso });
      // A ordem da grade feita na hora já mudou a aba.
      if (r && Array.isArray(r.mensagens) && r.mensagens.some((m) => m.id === r.mensagem_id && acoesDaMensagem(m.anexos).some((a) => !!a.executada_direto)) && onAcaoFeita) onAcaoFeita();
      if (Number(r && r.custo_usd) > 0) avisarCustoReal("Agente das redes", r, atualizarCusto);
    } catch (e) {
      avisarErro(e, "Agente das redes");
    } finally {
      setTrabalhando(false);
      setPedidoAgora(null);
    }
  };

  useEffect(() => {
    if (pedido && pedido.texto) void enviar(pedido.texto);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pedido && pedido.n]);

  const aoTeclar = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void enviar(rascunho);
    }
  };

  return (
    <PainelDoAgente
      titulo="Agente das redes"
      descricao="Instagram, Facebook, destaques e grade"
      icone={<Instagram className="h-4 w-4" />}
      refDasMensagens={lista}
      rotuloDasMensagens="Conversa com o agente das redes"
      compositor={
        <>
          <div className="flex min-w-0 flex-wrap" role="group" aria-label="Atalhos do agente do Instagram">
            {ATALHOS.map((a) => (
              <button key={a.rotulo} type="button" className={juntar(botao.secundario, "mb-1.5 mr-1.5 h-8 px-2.5 text-[12px]")} disabled={trabalhando} onClick={() => void enviar(a.texto)}>
                {a.rotulo}
              </button>
            ))}
          </div>
          <div className="flex min-w-0 items-end">
            <textarea
              className={juntar(campoTexto, "min-h-[40px] flex-1 resize-none")}
              rows={2}
              value={rascunho}
              onChange={(e) => setRascunho(e.target.value)}
              onKeyDown={aoTeclar}
              placeholder="Peça ao agente das redes"
              aria-label="Mensagem para o agente das redes"
            />
            <button type="button" className={juntar(botao.primario, "ml-2 h-10 w-10 px-0")} onClick={() => void enviar(rascunho)} disabled={trabalhando || !rascunho.trim()} aria-label="Enviar">
              {trabalhando ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Send className="h-4 w-4" aria-hidden="true" />}
            </button>
          </div>
          <div className="mt-1 text-right">
            <EstimativaInline partes={modelo ? [{ modeloId: modelo.id, tipo: "texto", tokensEntrada: 5000, tokensSaida: 700 }] : null} />
          </div>
        </>
      }
    >
      {mensagens.length === 0 && !trabalhando && (
        <p className={juntar(texto.auxiliar, "flex items-center")}>
          Peça destaques, uma leitura do perfil ou ajuda com a grade
          <AjudaRecolhida className="ml-1" rotulo="O que o agente faz">
            Reorganiza a grade na hora (com Desfazer), gera as capas dos destaques e analisa a bio depois do seu Confirmar. Trocar a bio e criar o destaque no app do Instagram fica com a equipe: a API não deixa.
          </AjudaRecolhida>
        </p>
      )}
      {mensagens.map((m, i) => {
        if (m.papel === "sistema") {
          return (
            <p key={m.id || i} className={juntar(texto.auxiliar, "text-center")}>
              {m.conteudo}
            </p>
          );
        }
        return (
          <div key={m.id || i} className={juntar("min-w-0", m.papel === "usuario" ? "flex justify-end" : "")}>
            <div className={juntar("min-w-0 max-w-full rounded-lg px-3 py-2 text-[13px] leading-5 [overflow-wrap:anywhere]", m.papel === "usuario" ? "ml-6 bg-primary/10" : "bg-muted/50")}>
              <TextoDoAgente texto={m.conteudo} clientId={clientId} />
              {m.papel === "agente" && <DestaquesDoAnexo anexos={m.anexos} onUsar={onUsarDestaques} />}
            </div>
            {m.papel === "agente" && m.id &&
              acoesDaMensagem(m.anexos).map((a) => (
                <div key={a.id} className="mt-1.5 min-w-0">
                  <CartaoDeAcao
                    acao={a}
                    recemFeita={m.id === recebida}
                    titulo={a.executada_direto ? "O agente fez" : "O agente vai fazer"}
                    observacao={observacaoDoCusto(a, "Sem custo. Dá para desfazer.")}
                    onPedido={(p) => chamarAcaoDoAgente("mesa-instagram", String(m.id), a.id, p, { client_id: clientId, ...(contaId ? { conta_id: contaId } : {}) })}
                    onFeito={(p, resposta) => {
                      if (p !== "descartar" && onAcaoFeita) onAcaoFeita();
                      if (resposta && Number((resposta as { custo_usd?: number }).custo_usd) > 0) avisarCustoReal("Agente das redes", resposta, atualizarCusto);
                    }}
                  />
                </div>
              ))}
            {m.papel === "agente" && <AprendizadoNaConversa anexos={m.anexos} clientId={clientId} />}
            {m.papel === "agente" && <CaminhoDaMensagem anexos={m.anexos} recente={!!m.id && m.id === recebida} />}
          </div>
        );
      })}
      {trabalhando && (
        <>
          {pedidoAgora && (
            <div className="flex justify-end">
              <p className="ml-6 rounded-lg bg-primary/10 px-3 py-2 text-[13px] [overflow-wrap:anywhere]">{pedidoAgora}</p>
            </div>
          )}
          <p className={juntar(texto.auxiliar, "flex items-center")} aria-live="polite">
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Trabalhando...
          </p>
        </>
      )}
    </PainelDoAgente>
  );
}
