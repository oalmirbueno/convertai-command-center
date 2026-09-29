import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Instagram, Loader2, Send, Wand2 } from "lucide-react";
import PainelDoAgente from "@/components/sistema/PainelDoAgente";
import { useEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
import { botao, campoTexto, juntar, texto } from "@/components/sistema/estilos";
import TextoDoAgente from "@/components/agentes/TextoDoAgente";
import { CaminhoDaMensagem } from "@/components/agentes/CaminhoPronto";
import { useMesa } from "../MesaContexto";
import { avisarCustoReal, EstimativaInline, useAvisarErro } from "../Custo";
import { destaquesLimpos, type DestaqueProposto } from "../../../../supabase/functions/_shared/conhecimento-perfil-instagram";
import { modeloDaAba } from "./BioENome";
import { chamarInstagram, type MensagemDaAba } from "./instagramApi";
import AjudaRecolhida from "@/components/sistema/AjudaRecolhida";

/**
 * Agente do Instagram, ao lado da aba (fixo no computador, gaveta no
 * celular). Conversa sobre bio, nome, destaques, grade e métricas com o
 * contexto do cliente; propõe destaques (nome e ícone) que vão para o
 * gerador com um clique; termina sempre com o caminho ("Ir para ...").
 * Não edita nada no Instagram: a API não deixa, e ele diz isso.
 */

const ATALHOS = [
  { rotulo: "Propor destaques", texto: "Proponha os destaques do perfil (nome curto e ícone de cada um), na ordem certa para quem chega." },
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
          <li key={d.nome}>
            <span className="font-medium">{d.nome}</span>
            <span className="text-muted-foreground"> · {d.icone}</span>
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
}: {
  mensagens: MensagemDaAba[];
  contaId: string | null;
  /** Pedido vindo de um bloco ("Pedir ao agente"): muda a cada pedido. */
  pedido: { texto: string; n: number } | null;
  onMensagens: (m: MensagemDaAba[]) => void;
  onUsarDestaques: (l: DestaqueProposto[]) => void;
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
      const r = await chamarInstagram<{ mensagem_id?: string | null; mensagens?: MensagemDaAba[]; custo_usd?: number }>("conversar", clientId, { mensagem: msg, ...(contaId ? { conta_id: contaId } : {}), ...(modelo ? { modelo_id: modelo.id } : {}) });
      setRascunho("");
      setRecebida(r && r.mensagem_id ? String(r.mensagem_id) : null);
      if (r && Array.isArray(r.mensagens)) onMensagens(r.mensagens as MensagemDaAba[]);
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
          <AjudaRecolhida className="ml-1" rotulo="O que o agente não faz">
            O agente não edita o Instagram: a API não deixa.
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
