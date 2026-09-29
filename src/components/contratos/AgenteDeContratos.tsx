import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, FileSignature, Loader2, Send } from "lucide-react";
import { chamarFuncao, textoDoErro, usd } from "@/lib/mesa/api";
import CartaoDeAcao, { OQuePossoFazer } from "@/components/agentes/CartaoDeAcao";
import TextoDoAgente from "@/components/agentes/TextoDoAgente";
import { CaminhoDaMensagem } from "@/components/agentes/CaminhoPronto";
import AprendizadoDoAgente from "@/components/agentes/AprendizadoDoAgente";
import { acoesDaMensagem, chamarAcaoDoAgente, type AcaoDoAgente } from "@/lib/agentes/acoesDoAgente";
import AjudaRecolhida from "@/components/sistema/AjudaRecolhida";
import PainelDoAgente from "@/components/sistema/PainelDoAgente";
import { botao, campoTexto, conversa, juntar, texto } from "@/components/sistema/estilos";
import { useEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
import { CHAVES_DOS_CONTRATOS } from "@/lib/contratos/api";
import { PartesDoDiff } from "./DiffDeTexto";
import type { ParteDoDiff } from "../../../supabase/functions/_shared/contrato-modelo";

/**
 * O agente de contratos, fixo ao lado da lista (frente CON, 30/09). O dono
 * explica o serviço em texto livre; o Jev escolhe os blocos; o agente cria o
 * rascunho, preenche o que foi dito e pergunta o que falta. Criar, preencher,
 * incluir serviço e voltar cláusula ao modelo vão direto (com Desfazer)
 * quando o pedido é claro. Reescrever cláusula NUNCA vai direto: o cartão
 * mostra a diferença, pede Confirmar e tem Desfazer. Ele não assina, não
 * congela e não envia nada.
 */

export const ATALHOS_DO_AGENTE_DE_CONTRATOS = [
  { rotulo: "Contrato de social", texto: "Contrato de social media: 8 carrosséis e 4 reels por mês no Instagram, R$ 3.500 por mês, 12 meses." },
  { rotulo: "O que falta?", texto: "O que falta para congelar este contrato?" },
  { rotulo: "Site com cessão", texto: "Inclui a criação do site institucional, com cessão dos direitos após o pagamento." },
  { rotulo: "Mudar uma cláusula", texto: "Na cláusula de revisões, deixe claro que ajustes de texto pequenos não contam como rodada." },
];

const CAPACIDADES = [
  "montar o contrato pelos serviços que você descrever",
  "preencher valores, prazos e dados que você disser",
  "perguntar o que falta para congelar",
  "incluir ou tirar serviços",
  "reescrever uma cláusula, sempre com a diferença e Confirmar",
  "aprender o que você ensinar (\"sempre\", \"nunca\")",
];

type Mensagem = { id: string | null; papel: "usuario" | "agente" | "sistema"; conteudo: string; anexos: unknown[]; custo_usd: number | null; nova?: boolean; aviso?: string | null; local?: string };

type DiffDoCartao = { ref: string; titulo: string; partes: ParteDoDiff[] };

function diffsDaAcao(a: AcaoDoAgente): DiffDoCartao[] {
  const d = a.contexto && Array.isArray((a.contexto as Record<string, unknown>).diffs) ? ((a.contexto as Record<string, unknown>).diffs as DiffDoCartao[]) : [];
  return d.filter((x) => x && Array.isArray(x.partes));
}

export default function AgenteDeContratos({ clientId, contratoId, aoAbrirContrato }: { clientId: string; contratoId: string | null; aoAbrirContrato: (id: string) => void }) {
  const qc = useQueryClient();
  const [mensagens, setMensagens] = useState<Mensagem[]>([]);
  const [lida, setLida] = useState(false);
  const [conversaId, setConversaId] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [nova, setNova] = useState(false);
  const [rascunho, setRascunho] = useEstadoDaTela<string>(`contratos:agente:rascunho:${clientId}`, "");
  const lista = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let vivo = true;
    setLida(false);
    chamarFuncao<any>("contratos", { acao: "agente_historico", client_id: clientId })
      .then((d) => {
        if (!vivo) return;
        setConversaId(d && typeof d.conversa_id === "string" ? d.conversa_id : null);
        setMensagens((d && Array.isArray(d.mensagens) ? d.mensagens : []).map((m: any) => ({ id: m.id ? String(m.id) : null, papel: m.papel, conteudo: String(m.conteudo || ""), anexos: Array.isArray(m.anexos) ? m.anexos : [], custo_usd: null })));
        setLida(true);
      })
      .catch((e) => {
        if (!vivo) return;
        setLida(true);
        toast.error("A conversa anterior não foi lida", { description: textoDoErro(e) });
      });
    return () => {
      vivo = false;
    };
  }, [clientId]);

  useEffect(() => {
    if (lista.current) lista.current.scrollTop = lista.current.scrollHeight;
  }, [mensagens.length, enviando]);

  const reler = () => {
    void qc.invalidateQueries({ queryKey: CHAVES_DOS_CONTRATOS.lista });
    if (contratoId) void qc.invalidateQueries({ queryKey: CHAVES_DOS_CONTRATOS.um(contratoId) });
  };

  /** Contrato criado por uma ação: abre na tela. */
  const abrirCriado = (anexo: any) => {
    const r = anexo && Array.isArray(anexo.resultados) ? anexo.resultados.find((x: any) => x && x.ok && x.operacao === "criar_contrato" && x.desfazer && x.desfazer.contract_id) : null;
    if (r) aoAbrirContrato(String(r.desfazer.contract_id));
  };

  const enviar = async () => {
    const m = rascunho.trim();
    if (!m || enviando) return;
    const local = `local-${Date.now()}`;
    setEnviando(true);
    setMensagens((l) => l.concat([{ id: null, papel: "usuario", conteudo: m, anexos: [], custo_usd: null, local }]));
    setRascunho("");
    try {
      const d = await chamarFuncao<any>("contratos", { acao: "agente_conversar", client_id: clientId, mensagem: m, contract_id: contratoId || undefined, conversa_id: conversaId || undefined, nova_conversa: nova || undefined });
      setNova(false);
      setConversaId(d && d.conversa_id ? String(d.conversa_id) : conversaId);
      const anexos = d && Array.isArray(d.anexos) ? d.anexos : [];
      const feitas = acoesDaMensagem(anexos).filter((a) => !!a.executada_em);
      if (feitas.length) {
        reler();
        feitas.forEach(abrirCriado);
      }
      setMensagens((l) => l.concat([{ id: d && d.mensagem_id ? String(d.mensagem_id) : null, papel: "agente", conteudo: String((d && d.resposta) || ""), anexos, custo_usd: d && typeof d.custo_usd === "number" ? d.custo_usd : null, nova: true, aviso: d && typeof d.aviso_registro === "string" ? d.aviso_registro : null }]));
    } catch (e) {
      // A mensagem que falhou volta ao campo (reenviar não duplica).
      setMensagens((l) => l.filter((x) => x.local !== local));
      setRascunho(m);
      toast.error("O agente não respondeu", { description: textoDoErro(e) });
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col" data-agente-de-contratos="">
      <PainelDoAgente
        titulo="Agente de contratos"
        icone={<FileSignature className="h-4 w-4" />}
        descricao={contratoId ? "Sobre o contrato aberto" : "Sobre os contratos do cliente"}
        acoes={
          <>
            {mensagens.length > 0 && (
              <button type="button" className={juntar(botao.discreto, "h-8 px-2 text-[12px]")} onClick={() => { setMensagens([]); setConversaId(null); setNova(true); }}>
                Nova conversa
              </button>
            )}
            <AjudaRecolhida rotulo="Como o agente de contratos funciona">
              Explique o serviço do jeito que falaria. Ele escolhe os blocos, cria o rascunho, preenche o que você disse e pergunta o que falta. Mudar o texto de uma cláusula sempre vem num cartão com a diferença e o Confirmar. Assinar, congelar e enviar são com você, na tela.
            </AjudaRecolhida>
          </>
        }
        rotuloDasMensagens="Conversa com o agente de contratos"
        refDasMensagens={lista}
        compositor={
          <>
            <OQuePossoFazer capacidades={CAPACIDADES} atalhos={ATALHOS_DO_AGENTE_DE_CONTRATOS} onAtalho={(t) => setRascunho(t)} />
            <textarea
              value={rascunho}
              onChange={(e) => setRascunho(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void enviar();
                }
              }}
              rows={2}
              maxLength={4000}
              placeholder="Ex.: contrato de site e marca, R$ 12 mil em 3 vezes"
              className={juntar(campoTexto, "min-h-[60px] resize-none")}
              aria-label="Mensagem ao agente de contratos"
            />
            <div className="flex min-w-0 items-center justify-end">
              <button type="button" className={juntar(botao.primario, "h-9")} onClick={() => void enviar()} disabled={enviando || !rascunho.trim()} aria-label="Enviar ao agente">
                {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </button>
            </div>
          </>
        }
      >
        {!mensagens.length && !lida && <div className="mr-6 h-10 animate-pulse rounded-lg bg-muted" aria-label="Lendo a conversa" />}
        {!mensagens.length && lida && <p className={juntar(conversa.apoio, "leading-relaxed")}>Conte o que o cliente contratou. Eu monto o rascunho e pergunto o que falta.</p>}
        {mensagens.map((m, i) => {
          const acoes = acoesDaMensagem(m.anexos);
          return (
            <div key={m.id || m.local || `m-${i}`} className="min-w-0">
              <div className={juntar(conversa.balao, m.papel === "usuario" ? conversa.doUsuario : m.papel === "sistema" ? "bg-muted text-muted-foreground" : conversa.doAgente)}>
                <TextoDoAgente texto={m.conteudo} clientId={clientId} />
                {m.custo_usd !== null && <p className="mt-1 text-[12px] text-muted-foreground">Custo: {usd(m.custo_usd)}</p>}
              </div>
              {m.papel === "agente" && m.aviso && (
                <p className="mr-6 mt-1 flex min-w-0 items-start text-[12px] text-warning" role="alert">
                  <AlertTriangle className="mr-1.5 mt-0.5 h-3 w-3 shrink-0" aria-hidden />
                  <span className="min-w-0">{m.aviso}</span>
                </p>
              )}
              {m.papel === "agente" && (
                <AprendizadoDoAgente
                  anexos={m.anexos}
                  onEsquecer={(id) => chamarFuncao("contratos", { acao: "aprendizado_esquecer", client_id: clientId, id, mensagem_id: m.id || undefined })}
                  onGuardar={(t, tipo) => chamarFuncao("contratos", { acao: "aprendizado_guardar", client_id: clientId, texto: t, tipo, mensagem_id: m.id || undefined })}
                />
              )}
              {m.papel === "agente" && <CaminhoDaMensagem anexos={m.anexos} recente={!!m.nova} />}
              {m.id &&
                acoes.map((a) => (
                  <div key={a.id} className="mt-2 min-w-0 space-y-2">
                    {diffsDaAcao(a).map((d) => (
                      <div key={d.ref} className="min-w-0 rounded-md bg-muted/50 p-3" data-diff-do-cartao="">
                        <p className={juntar(texto.rotulo, "mb-1.5")}>Diferença na cláusula {d.titulo}</p>
                        <PartesDoDiff partes={d.partes} />
                      </div>
                    ))}
                    <CartaoDeAcao
                      acao={a}
                      recemFeita={!!m.nova}
                      titulo="O agente vai fazer no contrato"
                      observacao={diffsDaAcao(a).length ? "Sem custo. Confira a diferença acima antes de confirmar; dá para desfazer." : "Sem custo. Dá para desfazer."}
                      onPedido={(pedido) => chamarAcaoDoAgente("contratos", String(m.id), a.id, pedido)}
                      onFeito={(pedido, resposta) => {
                        if (pedido === "descartar") return;
                        reler();
                        abrirCriado(resposta && (resposta as any).anexo);
                      }}
                    />
                  </div>
                ))}
            </div>
          );
        })}
        {enviando && (
          <p className={juntar(conversa.apoio, "flex items-center")}>
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Lendo o pedido...
          </p>
        )}
      </PainelDoAgente>
    </div>
  );
}
