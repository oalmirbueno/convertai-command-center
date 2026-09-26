import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, MessageSquare, RefreshCw, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { custoDaResposta, type ParteDaEstimativa } from "@/lib/mesa/api";
import { AvisoDeErro, BotaoComCusto, useAvisarErro } from "./Custo";
import { useMesa } from "./MesaContexto";
import { Ditado } from "./Ditado";
import { Cronometro } from "./Cronometro";
import type { Trabalho } from "./useItensDoMes";
import CartaoDeAcao, { OQuePossoFazer } from "@/components/agentes/CartaoDeAcao";
import { chamarAcaoDoAgente, type AcaoDoAgente, type PedidoDaAcao } from "@/lib/agentes/acoesDoAgente";
import {
  aplicarMudancasDoDiretor,
  ATALHOS_DO_DIRETOR,
  camposParaMostrar,
  chavesDoDiretor,
  conversarComODiretor,
  lerConversaDoDiretor,
  marcarPedidoAoDiretor,
  mudancaMexeNoTexto,
  ordensParaRefazer,
  partesDaConversaDoDiretor,
  refazFundoContinuo,
  rotuloDeRefazer,
  usePedidoAoDiretor,
  type MensagemDoDiretor,
  type MudancaDoDiretor,
} from "./diretorDoEstudioApi";

/**
 * Conversar com o diretor (pedido do dono em 24/09): o diretor de arte ao lado
 * da arte que está sendo produzida. A equipe pede em português ("outro
 * cenário", "mais leve", "o que você mudaria?"), fala pelo microfone ou usa um
 * atalho; o diretor lê o conteúdo do trabalho, a marca e a lâmina em foco e
 * responde com sugestões e cartões de mudança. Cada cartão tem "Aplicar"
 * (grava na direção, sem custo) e "Aplicar e refazer" (grava e refaz as
 * lâminas pelo fluxo normal do Estúdio, com conferência e autocorreção; o
 * preço da regeneração aparece no botão). Uma conversa por trabalho, lida
 * direto do banco.
 *
 * Usado no Estúdio da Mesa (AbaEstudio, ferramenta Diretor) e na arte do
 * criativo da Mesa Ads (ArteDoCriativo); quem hospeda passa como refazer as
 * lâminas e quanto isso custa.
 */

export interface PropsDoDiretor {
  trabalho: Trabalho;
  /** Lâmina escolhida na tela: o diretor olha a versão atual dela. */
  ordemEmFoco: number | null;
  /** Alguma lâmina gerando: aplicar e refazer esperam. */
  ocupado: boolean;
  /** Trabalho entregue: dá para conversar, mas nada se aplica. */
  bloqueado?: boolean;
  /** Carrossel contínuo: mudar a cena refaz o fundo panorâmico. */
  continuo?: boolean;
  /** Partes da estimativa de refazer estas lâminas (com o fundo contínuo novo, quando for o caso). */
  partesRefazer: (ordens: number[], refazFundo: boolean) => ParteDaEstimativa[];
  /** Refaz as lâminas pelo fluxo normal (gerar, conferir, corrigir). Devolve o custo. */
  onRefazer: (ordens: number[]) => Promise<unknown>;
  /** Releia o trabalho (direção e custo mudaram). */
  onAtualizar: () => void;
  className?: string;
}

function Bolha({ papel, children }: { papel: "usuario" | "agente"; children: ReactNode }) {
  return (
    <div
      className={`min-w-0 rounded-2xl px-3 py-2 text-[12.5px] leading-relaxed [overflow-wrap:anywhere] ${
        papel === "usuario" ? "ml-8 rounded-br-md bg-primary text-primary-foreground" : "mr-4 rounded-bl-md bg-muted text-foreground"
      }`}
    >
      {children}
    </div>
  );
}

const rotuloDoAlvo = (m: MudancaDoDiretor) => (m.alvo === "conjunto" ? "Todas as lâminas" : `Lâmina ${m.ordem}`);

export default function DiretorDoEstudio({
  trabalho,
  ordemEmFoco,
  ocupado,
  bloqueado = false,
  continuo = false,
  partesRefazer,
  onRefazer,
  onAtualizar,
  className = "",
}: PropsDoDiretor) {
  const { catalogo } = useMesa();
  const queryClient = useQueryClient();
  const avisarErro = useAvisarErro();
  const [texto, setTexto] = useState("");
  const [falarDaLamina, setFalarDaLamina] = useState(true);
  // Cartão (ou mensagem inteira) sendo aplicado agora: os outros botões esperam.
  const [aplicando, setAplicando] = useState<string | null>(null);
  // Fora do componente: fechar o painel e voltar não libera um segundo pedido pago.
  const envio = usePedidoAoDiretor(trabalho.id);
  const campoRef = useRef<HTMLTextAreaElement>(null);
  const listaRef = useRef<HTMLDivElement>(null);
  const botaoRef = useRef<HTMLSpanElement>(null);
  const chave = chavesDoDiretor.conversa(trabalho.id);

  const conversa = useQuery({ queryKey: chave, queryFn: () => lerConversaDoDiretor(trabalho.id) });
  const mensagens = conversa.data ? conversa.data.mensagens : [];

  const ordemEnviada = falarDaLamina && ordemEmFoco ? ordemEmFoco : null;
  const focoTemArte = ordemEnviada !== null && (trabalho.cards || []).some((v) => v.ordem === ordemEnviada);
  const estiloPedido = String(((trabalho.direcao || {}) as { estilo_pedido?: string | null }).estilo_pedido || "");

  useEffect(() => {
    const el = listaRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [mensagens.length, !!envio]);

  const preencher = (t: string) => {
    setTexto(t);
    window.setTimeout(() => {
      const el = campoRef.current;
      if (el) {
        el.focus();
        el.setSelectionRange(t.length, t.length);
      }
    }, 0);
  };

  const enviar = async () => {
    const mensagem = texto.trim();
    const trabalhoId = trabalho.id;
    marcarPedidoAoDiretor(trabalhoId, { mensagem, desde: Date.now() });
    setTexto("");
    try {
      const data = await conversarComODiretor({ trabalhoId, mensagem, ordem: ordemEnviada });
      await queryClient.invalidateQueries({ queryKey: chave });
      onAtualizar();
      return data;
    } catch (e) {
      setTexto((t) => t || mensagem);
      throw e;
    } finally {
      marcarPedidoAoDiretor(trabalhoId, null);
    }
  };

  /** Grava as mudanças na direção (sem custo) e relê a conversa e o trabalho. */
  const aplicarNoServidor = async (m: MensagemDoDiretor, lista: MudancaDoDiretor[], refazer: boolean) => {
    const r = await aplicarMudancasDoDiretor({
      trabalhoId: trabalho.id,
      mudancas: lista,
      regerar: refazer ? ordensParaRefazer(lista) : undefined,
      mensagemId: m.id,
    });
    await queryClient.invalidateQueries({ queryKey: chave });
    onAtualizar();
    if (r && Array.isArray(r.avisos) && r.avisos.length) {
      toast.warning("Parte da mudança ficou de fora", { description: r.avisos.join(" ") });
    }
    return r;
  };

  const aplicarSo = async (m: MensagemDoDiretor, lista: MudancaDoDiretor[], chaveDoBotao: string) => {
    setAplicando(chaveDoBotao);
    try {
      const r = await aplicarNoServidor(m, lista, false);
      const afetadas: number[] = r && Array.isArray(r.afetadas) ? r.afetadas : ordensParaRefazer(lista);
      toast.success(lista.length === 1 ? "Mudança aplicada" : `${lista.length} mudanças aplicadas`, {
        description: afetadas.length
          ? `Para a arte mostrar, refaça ${afetadas.length === 1 ? `a lâmina ${afetadas[0]}` : `as lâminas ${afetadas.join(", ")}`}.`
          : undefined,
      });
    } catch (e) {
      avisarErro(e, "Não foi possível aplicar");
    } finally {
      setAplicando(null);
    }
  };

  const aplicarERefazer = async (m: MensagemDoDiretor, lista: MudancaDoDiretor[], chaveDoBotao: string) => {
    setAplicando(chaveDoBotao);
    try {
      const r = await aplicarNoServidor(m, lista, true);
      const ordens: number[] = r && Array.isArray(r.regerar) && r.regerar.length ? r.regerar : ordensParaRefazer(lista);
      const g = await onRefazer(ordens);
      return { custo_usd: custoDaResposta(g) || 0 };
    } finally {
      setAplicando(null);
    }
  };

  const refazerSo = async (ordens: number[], chaveDoBotao: string) => {
    setAplicando(chaveDoBotao);
    try {
      const g = await onRefazer(ordens);
      return { custo_usd: custoDaResposta(g) || 0 };
    } finally {
      setAplicando(null);
    }
  };

  const travado = ocupado || bloqueado || aplicando !== null || !!envio;
  const podeEnviar = !!texto.trim() && !envio;

  const cartao = (m: MensagemDoDiretor, mud: MudancaDoDiretor) => {
    const aplicada = m.aplicadas.indexOf(mud.id) >= 0;
    const campos = camposParaMostrar(mud);
    const ordens = ordensParaRefazer([mud]);
    const chaveDoBotao = `${m.id}:${mud.id}`;
    return (
      <div key={mud.id} className={`min-w-0 rounded-lg border bg-background p-2.5 ${aplicada ? "border-success/40" : "border-border"}`} data-mudanca={mud.id}>
        <div className="flex min-w-0 items-start">
          <span className="mr-2 mt-px shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[10.5px] font-medium text-primary">{rotuloDoAlvo(mud)}</span>
          <p className="min-w-0 flex-1 text-[12.5px] font-medium leading-snug [overflow-wrap:anywhere]">{mud.titulo}</p>
        </div>
        {mud.motivo && <p className="mt-1 text-[11.5px] leading-snug text-muted-foreground [overflow-wrap:anywhere]">{mud.motivo}</p>}
        <dl className="mt-2 space-y-1">
          {campos.map((c) => (
            <div key={c.campo} className="min-w-0 text-[11.5px] leading-snug [overflow-wrap:anywhere]">
              <dt className="inline font-medium">{c.rotulo}: </dt>
              <dd className="inline text-muted-foreground">
                {c.hex && <span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm border border-border align-middle" style={{ backgroundColor: c.hex }} aria-hidden="true" />}
                {c.valor}
              </dd>
            </div>
          ))}
        </dl>
        {mudancaMexeNoTexto(mud) && (
          <p className="mt-1.5 text-[11px] leading-snug text-warning">Muda o texto da lâmina. A conferência passa a comparar com o texto novo.</p>
        )}
        {aplicada ? (
          <div className="mt-2 flex min-w-0 flex-wrap items-center">
            <span className="mb-1 mr-2 inline-flex items-center text-[11.5px] font-medium text-success">
              <Check className="mr-1 h-3.5 w-3.5" /> Aplicada
            </span>
            {ordens.length > 0 && !bloqueado && (
              <span className="mb-1">
                <BotaoComCusto
                  rotulo={<><RefreshCw className="mr-1 h-3.5 w-3.5" />{rotuloDeRefazer(ordens, "Refazer")}</>}
                  titulo={rotuloDeRefazer(ordens, "Refazer")}
                  descricao="Refaz pelo fluxo normal do estúdio: gera, confere e corrige sozinho quando a chave estiver ligada."
                  variant="outline"
                  className="h-8 px-2.5 text-[11.5px]"
                  disabled={travado}
                  partes={() => partesRefazer(ordens, false)}
                  executar={() => refazerSo(ordens, `${chaveDoBotao}:refazer`)}
                />
              </span>
            )}
          </div>
        ) : (
          <div className="mt-2 flex min-w-0 flex-wrap items-center">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="mb-1 mr-1.5 h-8 px-2.5 text-[11.5px]"
              disabled={travado}
              onClick={() => void aplicarSo(m, [mud], chaveDoBotao)}
              title="Grava a mudança na direção, sem custo. A arte muda quando a lâmina for refeita."
            >
              {aplicando === chaveDoBotao ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Check className="mr-1 h-3.5 w-3.5" />}
              Aplicar
            </Button>
            {ordens.length > 0 && (
              <span className="mb-1">
                <BotaoComCusto
                  rotulo={<><Wand2 className="mr-1 h-3.5 w-3.5" />{rotuloDeRefazer(ordens)}</>}
                  titulo={rotuloDeRefazer(ordens)}
                  descricao={
                    refazFundoContinuo([mud], continuo)
                      ? "Grava a mudança e refaz as lâminas. No carrossel contínuo o fundo panorâmico nasce de novo (o preço inclui o fundo)."
                      : "Grava a mudança e refaz pelo fluxo normal: gera, confere e corrige sozinho quando a chave estiver ligada."
                  }
                  className="h-8 px-2.5 text-[11.5px]"
                  disabled={travado}
                  partes={() => partesRefazer(ordens, refazFundoContinuo([mud], continuo))}
                  executar={() => aplicarERefazer(m, [mud], `${chaveDoBotao}:refazer`)}
                />
              </span>
            )}
          </div>
        )}
      </div>
    );
  };

  // Ações que o diretor propôs: só a confirmação executa; as lâminas a refazer vão para o fluxo normal do Estúdio.
  const pedirAcao = async (mensagemId: string, a: AcaoDoAgente, pedido: PedidoDaAcao) => {
    const r: any = await chamarAcaoDoAgente("estudio-arte", mensagemId, a.id, pedido);
    if (pedido !== "descartar") {
      onAtualizar();
      void queryClient.invalidateQueries({ queryKey: chave });
      const ordens: number[] = r && Array.isArray(r.gerar_de_novo) ? r.gerar_de_novo : [];
      if (pedido === "confirmar" && ordens.length) void onRefazer(ordens);
    }
    return r;
  };
  const ordensARefazer = (a: AcaoDoAgente) =>
    a.itens.filter((i) => i.operacao === "refazer").map((i) => Number(i.alvo_id)).filter((n) => Number.isInteger(n));

  const respostaDoDiretor = (m: MensagemDoDiretor) => {
    const pendentes = m.mudancas.filter((x) => m.aplicadas.indexOf(x.id) < 0);
    const ordensDeTodas = ordensParaRefazer(pendentes);
    const chaveDaMensagem = `${m.id}:todas`;
    return (
      <div key={m.id} className="min-w-0 space-y-2">
        {m.conteudo && (
          <Bolha papel="agente">
            <p className="whitespace-pre-wrap">{m.conteudo}</p>
          </Bolha>
        )}
        {m.avisos.length > 0 && (
          <ul className="mr-4 space-y-0.5 rounded-lg border border-warning/40 px-2.5 py-1.5">
            {m.avisos.map((a) => (
              <li key={a} className="text-[11px] leading-snug text-muted-foreground [overflow-wrap:anywhere]">{a}</li>
            ))}
          </ul>
        )}
        {m.mudancas.length > 0 && (
          <div className="mr-4 space-y-2">
            {m.mudancas.map((mud) => cartao(m, mud))}
            {pendentes.length > 1 && (
              <div className="flex min-w-0 flex-wrap items-center rounded-lg border border-dashed border-border px-2.5 py-2">
                <span className="mb-1 mr-2 text-[11.5px] text-muted-foreground">Todas as {pendentes.length} sugestões:</span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="mb-1 mr-1.5 h-8 px-2.5 text-[11.5px]"
                  disabled={travado}
                  onClick={() => void aplicarSo(m, pendentes, chaveDaMensagem)}
                >
                  {aplicando === chaveDaMensagem ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Check className="mr-1 h-3.5 w-3.5" />}
                  Aplicar todas
                </Button>
                {ordensDeTodas.length > 0 && (
                  <span className="mb-1">
                    <BotaoComCusto
                      rotulo={<><Wand2 className="mr-1 h-3.5 w-3.5" />{rotuloDeRefazer(ordensDeTodas, "Aplicar todas e refazer")}</>}
                      titulo={rotuloDeRefazer(ordensDeTodas, "Aplicar todas e refazer")}
                      descricao="Grava todas as sugestões e refaz as lâminas pelo fluxo normal do estúdio."
                      className="h-8 px-2.5 text-[11.5px]"
                      disabled={travado}
                      partes={() => partesRefazer(ordensDeTodas, refazFundoContinuo(pendentes, continuo))}
                      executar={() => aplicarERefazer(m, pendentes, `${chaveDaMensagem}:refazer`)}
                    />
                  </span>
                )}
              </div>
            )}
          </div>
        )}
        {(m.acoes || []).map((a) => {
          const refazer = ordensARefazer(a);
          return (
            <CartaoDeAcao
              key={a.id}
              acao={a}
              titulo="O diretor vai fazer"
              onPedido={(p) => pedirAcao(m.id, a, p)}
              observacao={refazer.length ? "Refazer gera de novo pelo fluxo normal do Estúdio." : undefined}
              renderConfirmar={
                refazer.length
                  ? (confirmar, ocupadoNoCartao) => (
                      <BotaoComCusto
                        rotulo={rotuloDeRefazer(refazer, "Confirmar e refazer")}
                        titulo="Confirmar o que o diretor vai fazer"
                        descricao="Faz a lista e refaz as lâminas pelo fluxo normal do estúdio (gerar, conferir, corrigir)."
                        className="h-8"
                        disabled={ocupadoNoCartao || ocupado || bloqueado}
                        partes={() => partesRefazer(refazer, false)}
                        executar={confirmar}
                        fecharAoConfirmar
                      />
                    )
                  : undefined
              }
            />
          );
        })}
      </div>
    );
  };

  return (
    <div className={`flex min-h-0 min-w-0 flex-col ${className}`}>
      <div ref={listaRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 py-3" aria-live="polite" aria-label="Conversa com o diretor de arte">
        {estiloPedido && (
          <p className="rounded-lg border border-primary/30 bg-primary/5 px-2.5 py-1.5 text-[11.5px] leading-snug [overflow-wrap:anywhere]">
            <span className="font-medium">Estilo pedido para este trabalho:</span> <span className="text-muted-foreground">{estiloPedido}</span>
          </p>
        )}
        {bloqueado && (
          <p className="text-[11.5px] leading-snug text-muted-foreground">Arte já entregue: dá para conversar, mas as mudanças não se aplicam mais neste trabalho.</p>
        )}
        {conversa.isLoading && (
          <p className="text-[12px] text-muted-foreground">
            <Loader2 className="mr-1.5 inline h-3.5 w-3.5 animate-spin" />
            Lendo a conversa…
          </p>
        )}
        {conversa.isError && <AvisoDeErro erro={conversa.error} />}
        {conversa.data && mensagens.length === 0 && !envio && (
          <div className="px-1 py-6 text-center">
            <MessageSquare className="mx-auto h-5 w-5 text-primary" />
            <p className="mt-2 text-[12.5px] font-medium">Converse com o diretor de arte</p>
            <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
              Peça outro cenário, outro estilo, outra luz ou a opinião dele. Ele lê o texto de cada lâmina, a marca e as fotos e propõe mudanças que você
              aplica com um clique.
            </p>
          </div>
        )}
        {mensagens.map((m) => {
          if (m.papel === "sistema") {
            return <p key={m.id} className="text-center text-[11px] text-muted-foreground [overflow-wrap:anywhere]">{m.conteudo}</p>;
          }
          if (m.papel === "agente") return respostaDoDiretor(m);
          return (
            <div key={m.id} className="min-w-0 space-y-1">
              {m.emFoco !== null && <p className="ml-8 text-right text-[10.5px] text-muted-foreground">sobre a lâmina {m.emFoco}</p>}
              <Bolha papel="usuario">
                <p className="whitespace-pre-wrap">{m.conteudo}</p>
              </Bolha>
            </div>
          );
        })}
        {envio && (
          <div className="min-w-0 space-y-2">
            {envio.mensagem && (
              <Bolha papel="usuario">
                <p className="whitespace-pre-wrap">{envio.mensagem}</p>
              </Bolha>
            )}
            <div className="mr-4 rounded-2xl rounded-bl-md bg-muted px-3 py-2">
              <Cronometro desde={envio.desde} rotulo="O diretor está lendo o trabalho" />
            </div>
          </div>
        )}
      </div>

      <div className="shrink-0 space-y-2 border-t border-border px-3 pb-3 pt-2.5">
        <OQuePossoFazer
          capacidades={["reordenar as lâminas", "refazer lâminas", "trocar um texto em várias", "mudar o formato", "arquivar versões antigas"]}
          atalhos={[
            { rotulo: "Reorganizar as lâminas", texto: "Reorganize a ordem das lâminas para a história fluir melhor." },
            { rotulo: "Mudar para 9:16", texto: "Mude o formato deste trabalho para 9:16." },
          ]}
          onAtalho={preencher}
        />
        <div className="flex flex-wrap" role="group" aria-label="Atalhos para o diretor">
          {ordemEmFoco ? (
            <button
              type="button"
              aria-pressed={falarDaLamina}
              onClick={() => setFalarDaLamina((v) => !v)}
              title="Com isto ligado, o diretor olha a versão atual da lâmina escolhida na prancheta"
              className={`mb-1 mr-1 max-w-full truncate rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
                falarDaLamina ? "border-primary/50 bg-primary/10 text-foreground" : "border-border bg-background text-muted-foreground"
              }`}
            >
              {falarDaLamina ? `Sobre a lâmina ${ordemEmFoco}` : "Sobre o conjunto"}
            </button>
          ) : null}
          {ATALHOS_DO_DIRETOR.map((a) => (
            <button
              key={a.rotulo}
              type="button"
              onClick={() => preencher(a.texto)}
              className="mb-1 mr-1 max-w-full truncate rounded-full border border-border bg-background px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
            >
              {a.rotulo}
            </button>
          ))}
        </div>
        <div className="rounded-xl border border-border bg-background p-2 focus-within:border-primary/60">
          <Textarea
            ref={campoRef}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => {
              // Ctrl+Enter (ou Cmd+Enter) envia.
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && podeEnviar) {
                e.preventDefault();
                const b = botaoRef.current ? botaoRef.current.querySelector("button") : null;
                if (b) b.click();
              }
            }}
            rows={3}
            aria-label="Mensagem ao diretor de arte"
            placeholder="Ex.: quero um cenário ao ar livre, com luz de fim de tarde"
            className="max-h-40 min-h-[64px] resize-none border-0 bg-transparent px-1 py-1 text-[13px] shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
          />
          <div className="mt-1 flex min-w-0 items-center">
            <Ditado valor={texto} onChange={setTexto} disabled={!!envio} className="mr-1.5 min-w-0" />
            <span ref={botaoRef} className="ml-auto shrink-0">
              <BotaoComCusto
                rotulo="Enviar"
                titulo="Conversa com o diretor"
                descricao={
                  focoTemArte
                    ? "Uma chamada do diretor de arte com o conteúdo do trabalho, a marca e a imagem da lâmina em foco."
                    : "Uma chamada do diretor de arte com o conteúdo do trabalho e a marca."
                }
                partes={() => partesDaConversaDoDiretor(catalogo, focoTemArte)}
                executar={enviar}
                disabled={!podeEnviar}
                className="h-8"
              />
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
