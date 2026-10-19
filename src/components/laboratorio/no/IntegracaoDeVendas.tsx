import { useCallback, useEffect, useState } from "react";
import { Check, Copy, Power } from "lucide-react";
import { toast } from "sonner";
import { AjudaRecolhida, Carregando, EstadoDeErro, EstadoVazio, botao, campo, juntar, lista, superficie, texto } from "@/components/sistema";
import {
  criarIntegracao,
  desligarIntegracao,
  type EventoDeVendaNaTela,
  falta,
  gatewayDoNo,
  type GatewayDeVenda,
  INFO_DO_GATEWAY,
  type IntegracaoDeVenda,
  listarEventos,
  listarIntegracoes,
  rotuloDoEvento,
  salvarSegredo,
  valorNaTela,
} from "@/lib/laboratorio/vendas";

/**
 * Webhook de vendas do nó `checkout` (Laboratório v4): o endereço que o dono
 * cola no gateway do cliente, o segredo (uma vez) e os últimos 5 eventos.
 * Backend: função vendas-webhook (ações da equipe, admin ou gestor).
 */

const quando = (iso: string) => {
  try {
    return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
};

async function copiar(valor: string, aviso: string) {
  try {
    if (!navigator.clipboard) throw new Error("sem área de transferência");
    await navigator.clipboard.writeText(valor);
    toast.success(aviso);
  } catch {
    toast.error("Não deu para copiar. Selecione o texto e copie à mão.");
  }
}

const mensagemDe = (e: unknown, padrao: string) => (e instanceof Error && e.message ? e.message : padrao);

export default function IntegracaoDeVendas({ clienteId, gateway }: { clienteId: string | null; gateway: string }) {
  const slug = gatewayDoNo(gateway);
  if (!slug) {
    return <p className={texto.auxiliar}>Este gateway ainda não manda eventos; só o clique é medido.</p>;
  }
  return <PainelDoGateway clienteId={clienteId} gateway={slug} />;
}

function PainelDoGateway({ clienteId, gateway }: { clienteId: string | null; gateway: GatewayDeVenda }) {
  const info = INFO_DO_GATEWAY[gateway];
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [integracao, setIntegracao] = useState<IntegracaoDeVenda | null>(null);
  const [eventos, setEventos] = useState<EventoDeVendaNaTela[]>([]);
  const [segredoUmaVez, setSegredoUmaVez] = useState<string | null>(null);
  const [segredo, setSegredo] = useState("");
  const [tokenApi, setTokenApi] = useState("");
  const [ocupado, setOcupado] = useState(false);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const [integracoes, ultimos] = await Promise.all([listarIntegracoes(clienteId, gateway), listarEventos(clienteId, { gateway, limite: 5 })]);
      setIntegracao(integracoes.filter((i) => i.ativo)[0] || null);
      setEventos(ultimos.slice(0, 5));
    } catch (e) {
      setErro(mensagemDe(e, "Não foi possível ler o webhook de vendas."));
    } finally {
      setCarregando(false);
    }
  }, [clienteId, gateway]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const criar = async () => {
    setOcupado(true);
    try {
      const r = await criarIntegracao(clienteId, gateway);
      setIntegracao(r.integracao);
      setSegredoUmaVez(r.segredo);
      toast.success(`Webhook do ${info.nome} criado.`);
    } catch (e) {
      toast.error(mensagemDe(e, "Não foi possível criar a integração."));
    } finally {
      setOcupado(false);
    }
  };

  const salvar = async () => {
    if (!integracao) return;
    const valores = { segredo: segredo.trim() || undefined, token_api: tokenApi.trim() || undefined };
    if (!valores.segredo && !valores.token_api) return;
    setOcupado(true);
    try {
      setIntegracao(await salvarSegredo(integracao.id, valores));
      setSegredo("");
      setTokenApi("");
      toast.success("Salvo. O painel não mostra esse valor de novo.");
    } catch (e) {
      toast.error(mensagemDe(e, "Não foi possível salvar."));
    } finally {
      setOcupado(false);
    }
  };

  const desligar = async () => {
    if (!integracao) return;
    if (!window.confirm(`Desligar o webhook do ${info.nome}? Os avisos param de entrar e os segredos guardados são apagados.`)) return;
    setOcupado(true);
    try {
      await desligarIntegracao(integracao.id);
      setIntegracao(null);
      setSegredoUmaVez(null);
      toast.success("Webhook desligado.");
    } catch (e) {
      toast.error(mensagemDe(e, "Não foi possível desligar."));
    } finally {
      setOcupado(false);
    }
  };

  const pendente = integracao ? falta(integracao) : null;
  const pedeSegredo = !!integracao && !info.segredoDoPainel && !integracao.tem_segredo;
  const pedeTokenApi = !!integracao && info.tokenApi !== "nao" && !integracao.tem_token_api;

  return (
    <section aria-label={`Vendas pelo ${info.nome}`} className="min-w-0 space-y-3">
      <div className="flex min-w-0 items-center">
        <h3 className={juntar(texto.tituloSecao, "min-w-0 truncate")}>Vendas pelo {info.nome}</h3>
        <AjudaRecolhida titulo={`Onde colar no ${info.nome}`} rotulo={`Onde colar o endereço no ${info.nome}`} className="ml-1.5">
          <ol className="list-decimal space-y-1 pl-4">
            {info.ondeColar.map((passo) => (
              <li key={passo}>{passo}</li>
            ))}
          </ol>
        </AjudaRecolhida>
        {integracao && (
          <button
            type="button"
            className={juntar(botao.icone, "ml-auto")}
            title="Desligar o webhook"
            aria-label="Desligar o webhook"
            onClick={() => void desligar()}
            disabled={ocupado}
          >
            <Power className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      </div>

      {carregando ? (
        <Carregando linhas={2} rotulo="Lendo o webhook de vendas" />
      ) : erro ? (
        <EstadoDeErro
          titulo="Não foi possível ler o webhook."
          descricao={erro}
          acao={
            <button type="button" className={botao.secundario} onClick={() => void carregar()}>
              Tentar de novo
            </button>
          }
        />
      ) : !integracao ? (
        <EstadoVazio
          compacto
          titulo="Sem webhook ligado."
          descricao="Sem ele, só o clique é medido."
          acao={
            <button type="button" className={botao.primario} onClick={() => void criar()} disabled={ocupado}>
              Criar integração
            </button>
          }
        />
      ) : (
        <>
          <div className="min-w-0">
            <p className={texto.rotulo}>Endereço do webhook</p>
            <div className="mt-1 flex min-w-0 items-center">
              <code className={juntar(superficie.poco, texto.auxiliar, "min-w-0 flex-1 truncate px-2.5 py-2 font-mono text-foreground")} title={integracao.endereco}>
                {integracao.endereco}
              </code>
              <button type="button" className={juntar(botao.icone, "ml-1")} title="Copiar endereço" aria-label="Copiar endereço" onClick={() => void copiar(integracao.endereco, "Endereço copiado.")}>
                <Copy className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          </div>

          {segredoUmaVez && (
            <div role="status" className={juntar(superficie.poco, "min-w-0 px-3 py-2.5")}>
              <p className={juntar(texto.corpo, "font-medium")}>{info.rotuloDoSegredo}</p>
              <div className="mt-1 flex min-w-0 items-center">
                <code className={juntar(texto.auxiliar, "min-w-0 flex-1 truncate font-mono text-foreground")}>{segredoUmaVez}</code>
                <button type="button" className={juntar(botao.icone, "ml-1")} title="Copiar token" aria-label="Copiar token" onClick={() => void copiar(segredoUmaVez, "Token copiado.")}>
                  <Copy className="h-4 w-4" aria-hidden="true" />
                </button>
                <button type="button" className={botao.icone} title="Já copiei" aria-label="Já copiei, esconder o token" onClick={() => setSegredoUmaVez(null)}>
                  <Check className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
              <p className={juntar(texto.auxiliar, "mt-1 leading-5")}>Copie agora: este token não aparece de novo. Cole no {info.nome} junto com o endereço.</p>
            </div>
          )}

          {(pedeSegredo || pedeTokenApi) && (
            <form
              className="min-w-0 space-y-2"
              onSubmit={(e) => {
                e.preventDefault();
                void salvar();
              }}
            >
              {pedeSegredo && (
                <label className="block min-w-0">
                  <span className={texto.rotulo}>{info.rotuloDoSegredo}</span>
                  <input type="password" autoComplete="off" spellCheck={false} className={juntar(campo, "mt-1 font-mono")} value={segredo} onChange={(e) => setSegredo(e.target.value)} />
                </label>
              )}
              {pedeTokenApi && (
                <label className="block min-w-0">
                  <span className={texto.rotulo}>{info.tokenApi === "obrigatorio" ? "Access Token de produção" : "Chave de API (opcional)"}</span>
                  <input type="password" autoComplete="off" spellCheck={false} className={juntar(campo, "mt-1 font-mono")} value={tokenApi} onChange={(e) => setTokenApi(e.target.value)} />
                </label>
              )}
              <button type="submit" className={botao.secundario} disabled={ocupado || (!segredo.trim() && !tokenApi.trim())}>
                Salvar
              </button>
            </form>
          )}

          <p className={texto.auxiliar}>
            {pendente === "segredo"
              ? "Falta o segredo: os avisos são recusados até ele ser salvo."
              : pendente === "token_api"
                ? "Falta o Access Token: os avisos ficam esperando."
                : `Pronto para receber${integracao.segredo_final ? ` · segredo termina em ${integracao.segredo_final}` : ""}.`}
          </p>

          <div className="min-w-0">
            <p className={texto.rotulo}>Últimos eventos</p>
            {eventos.length === 0 ? (
              <p className={juntar(texto.auxiliar, "mt-1")}>Nenhum evento recebido ainda.</p>
            ) : (
              <ul className={juntar(lista.aberta, "mt-1")} aria-label="Últimos eventos de venda">
                {eventos.map((ev) => (
                  <li key={ev.id} className={lista.linha}>
                    <div className="min-w-0 flex-1">
                      <p className={juntar(texto.corpo, "truncate")}>
                        {rotuloDoEvento(ev.tipo)}
                        {ev.valor != null ? ` · ${valorNaTela(ev.valor, ev.moeda)}` : ""}
                      </p>
                      <p className={juntar(texto.auxiliar, "truncate")}>{ev.comprador_email || ev.comprador_nome || "Sem contato do comprador"}</p>
                    </div>
                    <span className={juntar(texto.auxiliar, "ml-3 shrink-0 tabular-nums")}>{quando(ev.recebido_em)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </section>
  );
}
