import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Loader2, MessageSquare, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { chamarFuncao, padraoDoContexto, TAMANHOS, type ParteDaEstimativa } from "@/lib/mesa/api";
import { AvisoDeErro, EstimativaInline, avisarCustoReal } from "./Custo";
import { Ditado } from "./Ditado";
import { useMesa } from "./MesaContexto";
import CartaoDeAcao, { OQuePossoFazer } from "@/components/agentes/CartaoDeAcao";
import TextoDoAgente from "@/components/agentes/TextoDoAgente";
import { CaminhoDaMensagem } from "@/components/agentes/CaminhoPronto";
import AprendizadoNaConversa, { marcaDaRegra, observacaoDoCusto } from "@/components/agentes/AprendizadoNaConversa";
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
import PainelDoAgente, { BalaoDaConversa } from "@/components/sistema/PainelDoAgente";
import { conversa, juntar } from "@/components/sistema/estilos";
import AjudaRecolhida from "@/components/sistema/AjudaRecolhida";
import SeletorCompacto from "@/components/sistema/SeletorCompacto";
import { useAnexos, MiniaturasDosAnexos, ZonaDeAnexos } from "./AnexosDoPedido";
import { useArquivosDoAgente, BotaoDeAnexarArquivos, ListaDeArquivos } from "./ArquivosDoAgente";
import { importarDriveNoContexto, temLinkDoDrive } from "./importarDriveNoContexto";
import { PEDIDO_DO_COMECO } from "./ContextoPlanoDoCliente";
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
/** O atalho abre o organizador do Workspace (lê as imagens, prévia, Confirmar e Desfazer). */
const ORGANIZAR_O_WORKSPACE = "Organize os arquivos do workspace deste cliente em pastas por assunto.";

function ConversaDeContexto({
  preencher = false,
  modo = "marca",
  onModo,
  pedido = null,
}: { preencher?: boolean; modo?: ModoDoAgente; onModo?: (m: ModoDoAgente) => void; pedido?: { texto: string; n: number } | null } = {}) {
  const { clientId, catalogo, atualizarCusto } = useMesa();
  const anexos = useAnexos(clientId);
  const arquivos = useArquivosDoAgente(anexos);
  const [executar, setExecutar] = useState(true);
  const [pesquisarWeb, setPesquisarWeb] = useState(true);
  const [progresso, setProgresso] = useState("");
  const preparando = anexos.subindo || arquivos.lendo;
  const temMaterial = anexos.caminhos.length > 0 || arquivos.lidos.length > 0;
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const historico = useHistoricoDoContexto(clientId);
  const invalidar = useInvalidarContexto();
  // Rascunho guardado por cliente: sair e voltar (ou trocar de cliente e voltar)
  // não apaga o que foi escrito. A chave muda com o cliente.
  const [texto, setTexto] = useEstadoDaTela(`mesa:contexto:agente:rascunho:${clientId}`, "");
  const [enviando, setEnviando] = useState<{ clientId: string; mensagem: string } | null>(null);
  const [erro, setErro] = useState<{ clientId: string; erro: unknown } | null>(null);
  const [ultimo, setUltimo] = useState<{ clientId: string; mudou: string[]; memorias: number } | null>(null);
  // A resposta que acabou de chegar nesta tela: só ela pode abrir sozinha ("faz e me leva").
  const [recebida, setRecebida] = useState<string | null>(null);
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
    const msg = texto.trim() || (temMaterial ? "Leia os materiais anexados e organize o contexto deste cliente. Diga o que entendeu e o que falta para preparar o projeto." : "");
    if (!msg || enviando || preparando) return;
    const enviados = [...anexos.caminhos];
    const documentos = arquivos.paraOEnvio();
    const modoDoPedido = modo === "plano" || temMaterial || temLinkDoDrive(msg) ? "plano" : "marca";
    const alvo = clientId;
    setEnviando({ clientId: alvo, mensagem: msg });
    setErro(null);
    setTexto("");
    try {
      let corpoDosDocumentos = documentos.corpo;
      if (temLinkDoDrive(msg)) {
        const drive = await importarDriveNoContexto(alvo, msg, Math.max(0, 6 - enviados.length), documentos.corpo?.lidos.reduce((n, a) => n + a.texto.length, 0) || 0, setProgresso);
        enviados.push(...drive.imagens);
        corpoDosDocumentos = { lidos: [...(documentos.corpo?.lidos || []), ...drive.arquivos.lidos], nao_lidos: [...(documentos.corpo?.nao_lidos || []), ...drive.arquivos.nao_lidos] };
        invalidar(alvo);
      }
      setProgresso("Analisando o contexto e executando o pedido…");
      const data = await chamarFuncao<RespostaDaConversa>("agente-contexto", { acao: "conversar", client_id: alvo, mensagem: msg, ...(modoDoPedido === "plano" ? { modo: "plano", executar, pesquisar_web: pesquisarWeb, anexos: enviados, arquivos: corpoDosDocumentos } : {}), ...marcaDaRegra(alvo) });
      // 29/09: todos os anexos (cartões, caminho, "Aprendi", "Segui"); antes só as propostas.
      const anexosDaResposta = data && Array.isArray(data.anexos) ? data.anexos : data && Array.isArray(data.acoes) ? data.acoes : data && data.acao ? [data.acao] : [];
      const agora = new Date().toISOString();
      const resposta = String((data && data.resposta) || "Pronto.");
      queryClient.setQueryData<MensagemDoContexto[]>(chaveDoHistorico(alvo), (antes) =>
        (antes || []).concat([
          { id: data && data.pedido_id ? String(data.pedido_id) : undefined, papel: "usuario", conteudo: msg, criado_em: agora },
          { id: data && data.mensagem_id ? String(data.mensagem_id) : undefined, papel: "agente", conteudo: resposta, criado_em: agora, anexos: anexosDaResposta },
        ]),
      );
      anexos.tirarEnviados(enviados);
      arquivos.tirarEnviados(documentos.ids);
      void queryClient.invalidateQueries({ queryKey: chaveDoPlano(alvo) });
      setUltimo({ clientId: alvo, mudou: Array.isArray(data?.mudou) ? data.mudou : [], memorias: Number(data?.memorias || 0) });
      setRecebida(data && data.mensagem_id ? String(data.mensagem_id) : null);
      avisarCustoReal("Agente de contexto respondeu", data, atualizarCusto);
      if (data && data.mensagem_id) {
        invalidar(alvo, { historico: true });
      } else {
        // A resposta não ficou guardada: reler a conversa a apagaria da tela. Fica aqui, com o aviso.
        invalidar(alvo);
        setErro({ clientId: alvo, erro: new Error((data && data.aviso) || "A resposta chegou, mas não ficou guardada na conversa.") });
      }
    } catch (e) {
      setErro({ clientId: alvo, erro: e });
      setTexto((t) => t || msg);
    } finally {
      setEnviando(null);
      setProgresso("");
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
            ? "Converse, entregue documentos e peça o que precisa. O agente lê o material, organiza o contexto e aplica projetos e tarefas quando você manda fazer. Você pode escolher revisar antes e desfazer as ações. Links do Drive são importados para o Workspace. A pesquisa externa complementa lacunas quando necessária; desligue a opção para usar só o material do cliente."
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
                {nomesDoQueMudou.length ? `Atualizado: ${nomesDoQueMudou.join(", ")}.` : "Conversa registrada. As ações e os materiais aparecem na resposta."}
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
                { rotulo: "Começar o plano", texto: PEDIDO_DO_COMECO },
                { rotulo: "Caminho e stack", texto: "Proponha o caminho deste cliente: o que fazer primeiro, as ferramentas e o tech stack recomendados, com custo aproximado só quando houver fonte, e por quê." },
                { rotulo: "Google Meu Negócio", texto: "Coloque no plano a tarefa de criar o Perfil da Empresa no Google deste cliente, com dono e prazo." },
              ]}
              onAtalho={(t) => setTexto(t)}
            />
          ) : (
            <OQuePossoFazer
              capacidades={["trocar a logo por uma do acervo", "arquivar referências e fotos", "organizar fotos em pastas", "mover, renomear e arquivar arquivos do workspace"]}
              atalhos={[
                { rotulo: "Organizar o workspace", texto: ORGANIZAR_O_WORKSPACE },
                { rotulo: "Arquivar referências velhas", texto: "Arquive as referências que não combinam mais com a marca." },
              ]}
              onAtalho={(t) => (t === ORGANIZAR_O_WORKSPACE ? navigate(`/workspace?client=${clientId}&organizar=1`) : setTexto(t))}
            />
          )}
          {pendente && progresso && <p role="status" className="text-xs text-muted-foreground">{progresso}</p>}
          <ZonaDeAnexos anexos={arquivos.comoAnexos()} rotulo="Solte os documentos e imagens do cliente">
          <MiniaturasDosAnexos anexos={anexos} />
          <ListaDeArquivos arquivos={arquivos} />
          <Textarea
            className="shrink-0 resize-none"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                void enviar();
              }
            }}
            rows={3}
            placeholder={modo === "plano" ? "Conte o trabalho do cliente ou anexe o briefing. Ex.: prepare este evento com projeto, posts e vídeos." : "Conte o que sabe da marca ou anexe documentos e imagens."}
            disabled={!!pendente}
          />
          </ZonaDeAnexos>
          {(modo === "plano" || temMaterial || temLinkDoDrive(texto)) && <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <label className="flex items-center gap-1.5"><input type="checkbox" checked={executar} onChange={e => setExecutar(e.target.checked)} disabled={!!pendente} /> Aplicar meus pedidos</label>
            <label className="flex items-center gap-1.5" title="Consulta fontes externas quando necessário; prioriza seus documentos"><input type="checkbox" checked={pesquisarWeb} onChange={e => setPesquisarWeb(e.target.checked)} disabled={!!pendente} /> Pesquisar quando necessário</label>
          </div>}
          <div className="flex min-w-0 flex-wrap items-center justify-between">
            <div className="mr-2 min-w-0">
              <EstimativaInline partes={partes} />
              <p className="hidden text-[11px] text-muted-foreground sm:block">Ctrl+Enter envia</p>
            </div>
            <div className="ml-auto flex min-w-0 max-w-full items-center justify-end">
              <BotaoDeAnexarArquivos arquivos={arquivos} anexos={anexos} className="mr-1.5" />
              {/* Microfone grátis: o navegador transcreve enquanto a pessoa fala. */}
              <Ditado valor={texto} onChange={setTexto} disabled={!!pendente} className="mr-1.5 min-w-0" />
              <Button type="button" size="sm" className="shrink-0" onClick={() => void enviar()} disabled={!!enviando || preparando || (!texto.trim() && !temMaterial)}>
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
        <p className={juntar(conversa.apoio, "flex items-center")}>
          Nenhuma conversa ainda
          <AjudaRecolhida className="ml-1" rotulo="Exemplos do que contar">
            Exemplos: "a cor principal é o verde da fachada", "o público são mães de 30 a 45 anos", "nunca usar fundo preto".
          </AjudaRecolhida>
        </p>
      )}
      {mensagens.map((m, i) =>
        m.papel === "sistema" ? (
          <p key={`${m.criado_em}-${i}`} className={juntar(conversa.apoio, "text-center [overflow-wrap:anywhere]")}>{m.conteudo}</p>
        ) : (
          <div key={`${m.criado_em}-${i}`} className="min-w-0 space-y-2">
            <BalaoDaConversa de={m.papel === "usuario" ? "usuario" : "agente"}>
              <TextoDoAgente texto={m.conteudo} clientId={clientId} />
            </BalaoDaConversa>
            {m.papel === "agente" && <CaminhoDaMensagem anexos={m.anexos} recente={!!m.id && m.id === recebida} />}
            {m.papel === "agente" && <AprendizadoNaConversa anexos={m.anexos} clientId={clientId} />}
            {m.papel === "agente" && m.id &&
              acoesDaMensagem(m.anexos).map((a) => (
                <CartaoDeAcao
                  key={a.id}
                  acao={a}
                  recemFeita={!!m.id && m.id === recebida}
                  titulo={a.executada_direto ? "O agente fez" : "O agente vai fazer"}
                  observacao={observacaoDoCusto(a, a.sem_desfazer ? "Sem custo. Nada é apagado." : "Sem custo. Nada é apagado, e dá para desfazer.")}
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
          <BalaoDaConversa de="usuario">
            <p className="whitespace-pre-wrap">{pendente}</p>
          </BalaoDaConversa>
          <p className={juntar(conversa.apoio, "flex items-center px-1")}>
            <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> O agente está lendo o contexto...
          </p>
        </>
      )}
    </PainelDoAgente>
  );
}

/** Remontar ao trocar de cliente impede levar anexos/estado de um cliente para outro. */
export default function AgenteDeContexto(props: { preencher?: boolean; modo?: ModoDoAgente; onModo?: (m: ModoDoAgente) => void; pedido?: { texto: string; n: number } | null } = {}) {
  const { clientId } = useMesa();
  return <ConversaDeContexto key={clientId} {...props} />;
}
