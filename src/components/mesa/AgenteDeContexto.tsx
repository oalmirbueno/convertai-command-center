import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, MessageSquare, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { chamarFuncao, padraoDoContexto, TAMANHOS, type ParteDaEstimativa } from "@/lib/mesa/api";
import { AvisoDeErro, EstimativaInline, avisarCustoReal } from "./Custo";
import { Ditado } from "./Ditado";
import { useMesa } from "./MesaContexto";
import CartaoDeAcao, { OQuePossoFazer } from "@/components/agentes/CartaoDeAcao";
import { acoesDaMensagem, chamarAcaoDoAgente } from "@/lib/agentes/acoesDoAgente";
import {
  chaveDoHistorico,
  ROTULOS_DO_QUE_MUDOU,
  useHistoricoDoContexto,
  useInvalidarContexto,
  type MensagemDoContexto,
  type RespostaDaConversa,
} from "./contextoDoCliente";
import { chaveDoPlano, type ModoDoAgente } from "./planoDoClienteApi";
import PainelDoAgente from "@/components/sistema/PainelDoAgente";
import AjudaRecolhida from "@/components/sistema/AjudaRecolhida";
import SeletorCompacto from "@/components/sistema/SeletorCompacto";
import { useEstadoDaTela } from "@/components/sistema/useEstadoDaTela";

/**
 * Conversa com o agente de contexto: a equipe conta o que sabe da marca e o
 * agente grava no kit (estilo, regras, paleta, contexto) e na memória do
 * estrategista e do diretor de arte.
 *
 * Com `preencher`, ocupa a altura toda da coluna (fixa ao lado do contexto,
 * na AreaDeTrabalho): a conversa rola sozinha e a caixa de mensagem fica
 * sempre embaixo (casca PainelDoAgente do sistema de design).
 *
 * Frente C (26/09): o mesmo agente vira o agente do cliente no modo "Plano do
 * cliente" (mesma conversa): planeja nicho, posicionamento, projeto, marcos,
 * tarefas e caminho, sempre com o cartão de confirmação. `pedido` preenche a
 * caixa de mensagem (atalhos do Hub do plano).
 */
export default function AgenteDeContexto({
  preencher = false,
  modo = "marca",
  onModo,
  pedido = null,
}: { preencher?: boolean; modo?: ModoDoAgente; onModo?: (m: ModoDoAgente) => void; pedido?: { texto: string; n: number } | null } = {}) {
  const { clientId, catalogo, atualizarCusto } = useMesa();
  const queryClient = useQueryClient();
  const historico = useHistoricoDoContexto(clientId);
  const invalidar = useInvalidarContexto();
  // Rascunho guardado por cliente: sair e voltar (ou trocar de cliente e voltar)
  // não apaga o que foi escrito. A chave muda com o cliente.
  const [texto, setTexto] = useEstadoDaTela(`mesa:contexto:agente:rascunho:${clientId}`, "");
  const [enviando, setEnviando] = useState<{ clientId: string; mensagem: string } | null>(null);
  const [erro, setErro] = useState<{ clientId: string; erro: unknown } | null>(null);
  const [ultimo, setUltimo] = useState<{ clientId: string; mudou: string[]; memorias: number } | null>(null);
  const lista = useRef<HTMLDivElement>(null);

  // Atalho do Hub do plano: preenche a caixa (a pessoa revisa e envia).
  useEffect(() => {
    if (pedido && pedido.texto) setTexto(pedido.texto);
  }, [pedido]);

  // Papel próprio no catálogo (contexto); sem padrão, vale o do estrategista.
  const modelo = padraoDoContexto(catalogo);
  const partes: ParteDaEstimativa[] = [
    { modeloId: modelo?.id, tipo: "texto", tokensEntrada: TAMANHOS.conversarContexto.entrada, tokensSaida: TAMANHOS.conversarContexto.saida },
  ];

  const mensagens = historico.data || [];
  const pendente = enviando && enviando.clientId === clientId ? enviando.mensagem : null;

  useEffect(() => {
    const el = lista.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [mensagens.length, pendente]);

  const enviar = async () => {
    const msg = texto.trim();
    if (!msg || enviando) return;
    const alvo = clientId;
    setEnviando({ clientId: alvo, mensagem: msg });
    setErro(null);
    setTexto("");
    try {
      const data = await chamarFuncao<RespostaDaConversa>("agente-contexto", { acao: "conversar", client_id: alvo, mensagem: msg, ...(modo === "plano" ? { modo: "plano" } : {}) });
      const propostas = data && Array.isArray((data as { acoes?: unknown[] }).acoes) ? ((data as { acoes?: unknown[] }).acoes as unknown[]) : data && data.acao ? [data.acao] : [];
      const agora = new Date().toISOString();
      const resposta = String((data && data.resposta) || "Pronto.");
      queryClient.setQueryData<MensagemDoContexto[]>(chaveDoHistorico(alvo), (antes) =>
        (antes || []).concat([
          { papel: "usuario", conteudo: msg, criado_em: agora },
          { id: data && data.mensagem_id ? String(data.mensagem_id) : undefined, papel: "agente", conteudo: resposta, criado_em: agora, anexos: propostas },
        ]),
      );
      setUltimo({ clientId: alvo, mudou: Array.isArray(data?.mudou) ? data.mudou : [], memorias: Number(data?.memorias || 0) });
      avisarCustoReal("Agente de contexto respondeu", data, atualizarCusto);
      invalidar(alvo, { historico: true });
    } catch (e) {
      setErro({ clientId: alvo, erro: e });
      setTexto((t) => t || msg);
    } finally {
      setEnviando(null);
    }
  };

  const mudanca = ultimo && ultimo.clientId === clientId ? ultimo : null;
  const nomesDoQueMudou = mudanca ? mudanca.mudou.map((m) => ROTULOS_DO_QUE_MUDOU[m] || m) : [];

  // Casca fixa de agente (src/components/sistema/PainelDoAgente.tsx): cabeçalho
  // e campo sempre à vista; só a conversa rola. Com `preencher`, ocupa a altura
  // da coluna da área de trabalho; sem, fica com altura própria.
  const modos = onModo ? (
    <SeletorCompacto
      rotulo="Modo do agente"
      larguraTotal
      opcoes={[
        { valor: "marca", rotulo: "Marca" },
        { valor: "plano", rotulo: "Plano do cliente" },
      ]}
      valor={modo}
      onEscolher={(v) => onModo(v as ModoDoAgente)}
    />
  ) : null;

  return (
    <PainelDoAgente
      className={preencher ? "" : "h-[560px]"}
      titulo="Agente de contexto"
      icone={<MessageSquare className="h-4 w-4" />}
      descricao={modo === "plano" ? "Planeja o cliente de ponta a ponta" : "Conte o que sabe da marca"}
      acoes={
        <AjudaRecolhida rotulo="Como o agente de contexto funciona">
          {modo === "plano"
            ? "Planeje o cliente de ponta a ponta: nicho, posicionamento, projeto, marcos, tarefas e caminho. O agente lê briefing, dossiê e arquivos quando precisa e só muda algo depois que você confirma."
            : "Conte o que sabe da marca ou corrija o que estiver errado. O agente grava no kit e ensina o estrategista e o diretor de arte."}
        </AjudaRecolhida>
      }
      topo={modos}
      refDasMensagens={lista}
      rotuloDasMensagens="Conversa com o agente de contexto"
      avisos={
        mudanca || (erro && erro.clientId === clientId) ? (
          <>
            {mudanca && (
              <p className="rounded-md bg-muted/60 px-3 py-2 text-[12px] leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">
                {nomesDoQueMudou.length ? `Mudou no kit: ${nomesDoQueMudou.join(", ")}.` : "Nada mudou no kit."}
                {mudanca.memorias > 0 && ` ${mudanca.memorias === 1 ? "1 memória guardada" : `${mudanca.memorias} memórias guardadas`} para os agentes.`}
              </p>
            )}
            {erro && erro.clientId === clientId && <AvisoDeErro erro={erro.erro} />}
          </>
        ) : null
      }
      compositor={
        <>
          {modo === "plano" ? (
            <OQuePossoFazer
              capacidades={["criar ou ajustar projeto, marcos e tarefas com dono e prazo", "preencher nicho, posicionamento e estágio", "guardar decisões no cérebro", "gravar o caminho e o tech stack", "organizar arquivos"]}
              atalhos={[
                { rotulo: "Começar o plano", texto: "Comece o plano deste cliente: leia o briefing, o dossiê, o cérebro e os arquivos, proponha o nicho realista para o estágio dele, o posicionamento e o plano do projeto pelo método Acelera, com marcos e tarefas com dono e prazo." },
                { rotulo: "Caminho e stack", texto: "Proponha o caminho deste cliente: o que fazer primeiro, as ferramentas e o tech stack recomendados, com custo aproximado só quando houver fonte, e por quê." },
                { rotulo: "Google Meu Negócio", texto: "Coloque no plano a tarefa de criar o Perfil da Empresa no Google deste cliente, com dono e prazo." },
              ]}
              onAtalho={(t) => setTexto(t)}
            />
          ) : (
            <OQuePossoFazer
              capacidades={["trocar a logo por uma do acervo", "arquivar referências e fotos", "organizar fotos em pastas", "mover, renomear e arquivar arquivos do workspace"]}
              atalhos={[
                { rotulo: "Organizar o workspace", texto: "Organize os arquivos do workspace deste cliente em pastas por assunto." },
                { rotulo: "Arquivar referências velhas", texto: "Arquive as referências que não combinam mais com a marca." },
              ]}
              onAtalho={(t) => setTexto(t)}
            />
          )}
          <Textarea
            className="shrink-0 resize-none text-[13px]"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                void enviar();
              }
            }}
            rows={3}
            placeholder="O que o agente precisa saber? Digite ou toque no microfone para falar."
            disabled={!!pendente}
          />
          <div className="flex min-w-0 flex-wrap items-center justify-between">
            <div className="mr-2 min-w-0">
              <EstimativaInline partes={partes} />
              <p className="hidden text-[11px] text-muted-foreground sm:block">Ctrl+Enter envia</p>
            </div>
            <div className="ml-auto flex min-w-0 max-w-full items-center justify-end">
              {/* Microfone grátis: o navegador transcreve enquanto a pessoa fala. */}
              <Ditado valor={texto} onChange={setTexto} disabled={!!pendente} className="mr-1.5 min-w-0" />
              <Button type="button" size="sm" className="shrink-0" onClick={() => void enviar()} disabled={!!enviando || !texto.trim()}>
                {pendente ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Send className="mr-1.5 h-3.5 w-3.5" />}
                Enviar
              </Button>
            </div>
          </div>
        </>
      }
    >
      {historico.isLoading && (
        <div className="space-y-2" aria-label="Lendo a conversa">
          <div className="mr-6 h-10 animate-pulse rounded-lg bg-muted" />
          <div className="ml-6 h-8 animate-pulse rounded-lg bg-muted" />
          <div className="mr-6 h-12 animate-pulse rounded-lg bg-muted" />
        </div>
      )}
      {historico.isError && <AvisoDeErro erro={historico.error} />}
      {historico.data && mensagens.length === 0 && !pendente && (
        <p className="text-[12.5px] leading-relaxed text-muted-foreground">
          Nenhuma conversa ainda. Exemplos: "a cor principal é o verde da fachada", "o público são mães de 30 a 45 anos", "nunca usar fundo preto".
        </p>
      )}
      {mensagens.map((m, i) =>
        m.papel === "sistema" ? (
          <p key={`${m.criado_em}-${i}`} className="text-center text-[11px] text-muted-foreground [overflow-wrap:anywhere]">{m.conteudo}</p>
        ) : (
          <div key={`${m.criado_em}-${i}`} className="min-w-0 space-y-2">
            <div
              className={`rounded-lg px-3 py-2 text-[13px] leading-relaxed [overflow-wrap:anywhere] ${m.papel === "usuario" ? "ml-6 bg-primary/10" : "mr-6 bg-secondary/60"}`}
            >
              <p className="whitespace-pre-wrap">{m.conteudo}</p>
            </div>
            {m.papel === "agente" && m.id &&
              acoesDaMensagem(m.anexos).map((a) => (
                <CartaoDeAcao
                  key={a.id}
                  acao={a}
                  titulo="O agente vai fazer"
                  observacao="Sem custo. Nada é apagado, e dá para desfazer."
                  onPedido={(p) => chamarAcaoDoAgente("agente-contexto", String(m.id), a.id, p)}
                  onFeito={(p) => {
                    if (p !== "descartar") {
                      invalidar(clientId, { historico: true });
                      void queryClient.invalidateQueries({ queryKey: chaveDoPlano(clientId) });
                    }
                  }}
                />
              ))}
          </div>
        ),
      )}
      {pendente && (
        <>
          <div className="ml-6 rounded-lg bg-primary/10 px-3 py-2 text-[13px] leading-relaxed [overflow-wrap:anywhere]">
            <p className="whitespace-pre-wrap">{pendente}</p>
          </div>
          <p className="mr-6 flex items-center px-1 text-[12px] text-muted-foreground">
            <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> O agente está lendo o contexto...
          </p>
        </>
      )}
    </PainelDoAgente>
  );
}
