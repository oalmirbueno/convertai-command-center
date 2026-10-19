import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, Loader2, Send, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { BalaoDaConversa, PainelDoAgente, botao, campoTexto, conversa, juntar, texto } from "@/components/sistema";
import { textoDoErro, usd } from "@/lib/mesa/api";
import { planejar, type MensagemDoPlanejar } from "@/lib/laboratorio/api";
import { MODELO_PADRAO_DO_LAB, reciboPadrao, type OperacaoDoAgente, type ResultadoDaAplicacao } from "@/lib/laboratorio/nos";
import { SeletorDeModelo } from "./Seletores";

/**
 * Agente do projeto (painel ao lado do canvas). Conversa pela ação
 * `planejar`: o agente responde e propõe operações no quadro (criar, ligar,
 * definir...), cada uma com o recibo do que faz. Nada entra no quadro sem o
 * clique em "Aplicar no canvas", e o agente nunca gera nem publica: rodar
 * continua sendo o "Rodar" com o custo à vista.
 */

interface Mensagem {
  id: string;
  papel: "usuario" | "agente";
  texto: string;
  operacoes?: OperacaoDoAgente[];
  /** Operações que a função recusou (com o motivo): só aparecem. */
  recusadas?: string[];
  aplicada?: { feitas: number; falhas: Array<{ recibo: string; motivo: string }> };
  custo?: number | null;
}

export default function AgenteDoProjeto({
  projetoId,
  antesDePlanejar,
  onAplicar,
  semMoldura = false,
  acoes,
  registro = null,
}: {
  projetoId: string;
  /** A função planeja sobre o canvas salvo: salva o que está pendente antes. */
  antesDePlanejar?: () => Promise<void>;
  onAplicar: (ops: OperacaoDoAgente[]) => ResultadoDaAplicacao;
  semMoldura?: boolean;
  acoes?: ReactNode;
  /** O que o Canvas Studio pediu e ouviu (já aplicado no quadro): entra na conversa, para ajustar em cima. */
  registro?: { id: string; pedido: string; resposta: string } | null;
}) {
  const [mensagens, setMensagens] = useState<Mensagem[]>([]);
  const [rascunho, setRascunho] = useState("");
  const [modelo, setModelo] = useState(MODELO_PADRAO_DO_LAB);
  const [pensando, setPensando] = useState(false);
  const rolagem = useRef<HTMLDivElement>(null);

  const registrado = useRef<string | null>(null);
  useEffect(() => {
    if (!registro || registrado.current === registro.id) return;
    registrado.current = registro.id;
    setMensagens((ms) => ms.concat({ id: `su${registro.id}`, papel: "usuario", texto: registro.pedido }, { id: `sa${registro.id}`, papel: "agente", texto: `${registro.resposta}
(Montado pelo Canvas Studio.)` }));
  }, [registro]);

  useEffect(() => {
    const el = rolagem.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [mensagens.length, pensando]);

  const enviar = async () => {
    const msg = rascunho.trim();
    if (!msg || pensando) return;
    const historico: MensagemDoPlanejar[] = mensagens.map((m) => ({ papel: m.papel, texto: m.texto }));
    setMensagens((ms) => ms.concat({ id: `u${Date.now()}`, papel: "usuario", texto: msg }));
    setRascunho("");
    setPensando(true);
    try {
      if (antesDePlanejar) await antesDePlanejar();
      const r = await planejar({ projetoId, mensagem: msg, historico, modelo });
      setMensagens((ms) => ms.concat({ id: `a${Date.now()}`, papel: "agente", texto: r.resposta || (r.operacoes.length ? "Proposta para o quadro:" : "Sem resposta."), operacoes: r.operacoes, recusadas: r.recusadas, custo: r.custo_usd }));
    } catch (e) {
      setMensagens((ms) => ms.concat({ id: `e${Date.now()}`, papel: "agente", texto: textoDoErro(e) }));
    } finally {
      setPensando(false);
    }
  };

  const aplicar = (m: Mensagem) => {
    if (!m.operacoes || !m.operacoes.length || m.aplicada) return;
    const r = onAplicar(m.operacoes);
    setMensagens((ms) => ms.map((x) => (x.id === m.id ? { ...x, aplicada: { feitas: r.feitas, falhas: r.falhas } } : x)));
    if (r.falhas.length) toast.warning(`${r.feitas} de ${m.operacoes.length} operações aplicadas`, { description: r.falhas.map((f) => `${f.recibo}: ${f.motivo}`).join(" ") });
    else toast.success("Operações aplicadas no canvas", { description: "Confira e rode com o custo à vista." });
  };

  return (
    <PainelDoAgente
      titulo="Agente do projeto"
      descricao="Planeja o fluxo; não gera sozinho"
      icone={<Wand2 className="h-4 w-4" />}
      acoes={acoes}
      semMoldura={semMoldura}
      refDasMensagens={rolagem}
      rotuloDasMensagens="Conversa com o agente do projeto"
      topo={<SeletorDeModelo valor={modelo} onMudar={setModelo} rotulo="Modelo do agente" />}
      compositor={
        <form
          className="flex min-w-0 items-end"
          onSubmit={(e) => {
            e.preventDefault();
            void enviar();
          }}
        >
          <textarea
            aria-label="Mensagem para o agente do projeto"
            className={juntar(campoTexto, conversa.campo, "mr-2 min-h-[44px] flex-1 resize-none")}
            placeholder="Ex.: monte um carrossel de 5 lâminas com a copy antes"
            value={rascunho}
            rows={2}
            onChange={(e) => setRascunho(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void enviar();
              }
            }}
          />
          <button type="submit" className={juntar(botao.icone, "text-primary")} disabled={pensando || !rascunho.trim()} aria-label="Enviar ao agente" title="Enviar ao agente">
            {pensando ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Send className="h-4 w-4" aria-hidden="true" />}
          </button>
        </form>
      }
    >
      {!mensagens.length && <p className={conversa.apoio}>Peça um fluxo ou uma mudança. O agente propõe; você aplica no canvas e roda.</p>}
      {mensagens.map((m) => (
        <BalaoDaConversa key={m.id} de={m.papel} data-mensagem-do-agente={m.papel}>
          <p className="whitespace-pre-wrap">{m.texto}</p>
          {m.operacoes && m.operacoes.length > 0 && (
            <div className="mt-2 min-w-0" data-operacoes-propostas="">
              <ol className="min-w-0 space-y-1">
                {m.operacoes.map((op, i) => (
                  <li key={i} className={juntar(texto.auxiliar, "flex min-w-0 items-start")} data-recibo="">
                    <span className="mr-1.5 shrink-0 tabular-nums">{i + 1}.</span>
                    <span className="min-w-0">{reciboPadrao(op)}</span>
                  </li>
                ))}
              </ol>
              {m.aplicada ? (
                <p className={juntar(texto.auxiliar, "mt-2 inline-flex items-center text-primary")}>
                  <Check className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                  {m.aplicada.feitas} aplicada(s){m.aplicada.falhas.length ? `, ${m.aplicada.falhas.length} não coube(ram)` : ""}
                </p>
              ) : (
                <button type="button" className={juntar(botao.secundario, "mt-2 h-8")} onClick={() => aplicar(m)} data-aplicar-no-canvas="">
                  Aplicar no canvas
                </button>
              )}
            </div>
          )}
          {m.recusadas && m.recusadas.length > 0 && (
            <ul className="mt-2 min-w-0 space-y-1" data-operacoes-recusadas="">
              {m.recusadas.map((r, i) => (
                <li key={i} className={juntar(texto.auxiliar, "text-warning")}>
                  {r}
                </li>
              ))}
            </ul>
          )}
          {typeof m.custo === "number" && m.custo > 0 ? <p className={juntar(texto.etiqueta, "mt-1 text-muted-foreground")}>{usd(m.custo)}</p> : null}
        </BalaoDaConversa>
      ))}
      {pensando && <p className={conversa.apoio}>Pensando…</p>}
    </PainelDoAgente>
  );
}
