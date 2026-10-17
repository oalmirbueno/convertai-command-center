import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { AlertTriangle, Bot, Eye, EyeOff, KeyRound, Loader2, Plug, Smartphone, XCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Switch } from "@/components/ui/switch";
import JanelaCentral from "@/components/sistema/JanelaCentral";
import MenuMais from "@/components/sistema/MenuMais";
import CampoDeBusca from "@/components/sistema/CampoDeBusca";
import { CampoDeFormulario } from "@/components/sistema/Formulario";
import { Carregando, EstadoVazio } from "@/components/sistema/Estados";
import { botao, campo, juntar, texto } from "@/components/sistema/estilos";
import {
  cancelarPedido,
  marcarPedidoFeito,
  nomeDoAgente,
  pedidoEmAberto,
  responderComCodigo,
  responderComSenha,
  useNomesDosAgentes,
  usePedidoDeAcesso,
  usePrintDoPedido,
  type PedidoDeAcesso,
  type TipoDoPedido,
} from "@/hooks/usePedidosDeAcesso";

/**
 * Janela do pedido de acesso (17/10/2026, pedido do dono): "quando o
 * Paperclip, Hermes ou qualquer outro pedir senha ao logar, mostra o print e
 * abre um formulário seguro para eu colocar a senha e o e-mail certinho".
 *
 * Abre em QUALQUER tela por `?acesso=<id>` (o aviso chega com
 * "/execucao?acesso=<id>"); fechar tira o parâmetro. Quatro tipos:
 * - senha: cliente, título, e-mail/usuário e senha; "Lembrar no cofre e deixar
 *   o agente usar sempre" vem ligado (uma vez só, sem retrabalho);
 * - código: um campo só, que vale por 10 minutos;
 * - conectar: Facebook, Instagram e Google NUNCA por senha, só o link oficial;
 * - outro: o que o agente pediu e "Já fiz".
 *
 * A senha vive só no estado deste formulário: some ao fechar (o componente
 * desmonta), não vai para cache nem console.
 */

export const PARAMETRO_DO_PEDIDO = "acesso";

const ICONE_DO_TIPO: Record<TipoDoPedido, typeof KeyRound> = {
  senha: KeyRound,
  codigo: Smartphone,
  conectar: Plug,
  outro: AlertTriangle,
};

export const ROTULO_DO_TIPO: Record<TipoDoPedido, string> = {
  senha: "Pede senha",
  codigo: "Pede código",
  conectar: "Pede para conectar",
  outro: "Pede outra ação",
};

export function IconeDoTipo({ tipo, className = "h-4 w-4" }: { tipo: TipoDoPedido; className?: string }) {
  const Icone = ICONE_DO_TIPO[tipo] || AlertTriangle;
  return <Icone className={className} aria-hidden="true" />;
}

/** Link oficial só se for https (o link vem do agente; nada de javascript: nem http). */
export function linkSeguro(valor: string | null | undefined): string | null {
  if (!valor) return null;
  try {
    const u = new URL(valor);
    return u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

/** Nome curto do site: o que o agente mandou ou o domínio da url. */
export function nomeDoSite(p: Pick<PedidoDeAcesso, "site" | "url">): string {
  if (p.site && p.site.trim()) return p.site.trim();
  if (p.url) {
    try {
      return new URL(p.url).hostname.replace(/^www\./, "");
    } catch {
      /* url ruim: cai no genérico */
    }
  }
  return "um site";
}

/** O agente leva artigo: "O Hermes". */
function oAgente(nome: string) {
  return `O ${nome}`;
}

function mensagemDeErro(e: unknown): string {
  const m = e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message || "") : "";
  if (/expir/i.test(m)) return "Este pedido expirou. O agente vai pedir de novo se ainda precisar.";
  if (/encerrad|não está aberto|not open/i.test(m)) return "Este pedido já foi respondido ou cancelado.";
  // Recusas do banco já escritas para gente (campo que falta, sem permissão).
  if (/^(Informe|Escolha|Código longo|Só admin|Item do cofre|Pedido de acesso não)/.test(m)) return m;
  return "Não deu para enviar agora. Tente de novo.";
}

interface ClienteDaLista {
  id: string;
  full_name: string | null;
  company_name: string | null;
}

const nomeDoCliente = (c: ClienteDaLista) => c.company_name || c.full_name || "Cliente sem nome";
const ehAceleriq = (c: ClienteDaLista) => /aceleriq/i.test(`${c.company_name || ""} ${c.full_name || ""}`);

/** Clientes do painel (papel client, sem apagados); a Aceleriq (cliente interno) vem primeiro. */
async function lerClientes(): Promise<ClienteDaLista[]> {
  const { data: papeis, error: e1 } = await supabase.from("user_roles").select("user_id").eq("role", "client");
  if (e1) throw e1;
  const ids = ((papeis as { user_id: string }[] | null) || []).map((r) => r.user_id);
  if (!ids.length) return [];
  const { data, error } = await supabase.from("profiles").select("id, full_name, company_name").in("id", ids).is("deleted_at", null);
  if (error) throw error;
  return ((data as ClienteDaLista[] | null) || []).sort((a, b) => {
    const ia = ehAceleriq(a) ? 0 : 1;
    const ib = ehAceleriq(b) ? 0 : 1;
    return ia !== ib ? ia - ib : nomeDoCliente(a).localeCompare(nomeDoCliente(b));
  });
}

function useClientes(habilitado: boolean) {
  return useQuery({ queryKey: ["pedidos-de-acesso", "clientes"], enabled: habilitado, staleTime: 10 * 60_000, queryFn: lerClientes });
}

/* ------------------------------------------------------------------ senha */

function FormularioDeSenha({ pedido, agente, idDoForm, aoTerminar, ocupado, setOcupado }: PropsDoFormulario) {
  const precisaEscolher = !pedido.client_id;
  const clientes = useClientes(true);
  const [clienteId, setClienteId] = useState<string>(pedido.client_id || "");
  const [busca, setBusca] = useState("");
  const [titulo, setTitulo] = useState(nomeDoSite(pedido) === "um site" ? "" : nomeDoSite(pedido));
  const [usuario, setUsuario] = useState(pedido.conta || "");
  const [senha, setSenha] = useState("");
  const [ver, setVer] = useState(false);
  const [lembrar, setLembrar] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  // Ao sair (fechar a janela), a senha some do estado.
  useEffect(() => () => setSenha(""), []);

  const lista = clientes.data || [];
  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    const base = q ? lista.filter((c) => nomeDoCliente(c).toLowerCase().indexOf(q) >= 0 || (c.full_name || "").toLowerCase().indexOf(q) >= 0) : lista;
    return base.slice(0, 8);
  }, [lista, busca]);
  const escolhido = lista.find((c) => c.id === clienteId) || null;

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    if (ocupado) return;
    if (!clienteId) return setErro("Escolha o cliente dono deste acesso.");
    if (!usuario.trim()) return setErro("Coloque o e-mail ou usuário.");
    if (!senha) return setErro("Coloque a senha.");
    setErro(null);
    setOcupado(true);
    try {
      await responderComSenha({
        pedido: pedido.id,
        clientId: clienteId,
        titulo: titulo.trim() || nomeDoSite(pedido),
        usuario: usuario.trim(),
        senha,
        lembrar,
      });
      setSenha("");
      aoTerminar(`Pronto, o ${agente} já pode seguir`);
    } catch (falha) {
      setErro(mensagemDeErro(falha));
    } finally {
      setOcupado(false);
    }
  };

  return (
    <form id={idDoForm} onSubmit={enviar} className="min-w-0 space-y-4" autoComplete="on" noValidate>
      {precisaEscolher ? (
        <div className="min-w-0">
          <p className={juntar(texto.rotulo, "mb-1.5")}>Cliente</p>
          <CampoDeBusca valor={busca} onMudar={setBusca} placeholder="Buscar cliente" rotulo="Buscar cliente" />
          {clientes.isLoading ? (
            <Carregando forma="lista" linhas={2} rotulo="Carregando clientes" />
          ) : (
            <ul className="-mx-2 mt-1 min-w-0" role="listbox" aria-label="Clientes">
              {filtrados.map((c) => {
                const ativo = c.id === clienteId;
                return (
                  <li key={c.id} className="min-w-0">
                    <button
                      type="button"
                      role="option"
                      aria-selected={ativo}
                      onClick={() => setClienteId(c.id)}
                      className={juntar(
                        "flex w-full min-w-0 items-center rounded-lg px-2 py-2 text-left transition-colors hover:bg-muted/40",
                        texto.corpo,
                        ativo && "bg-primary/[0.07] font-medium",
                      )}
                    >
                      <span className="min-w-0 flex-1 truncate">{nomeDoCliente(c)}</span>
                      {ehAceleriq(c) ? <span className={juntar(texto.auxiliar, "ml-2 shrink-0")}>interno</span> : null}
                    </button>
                  </li>
                );
              })}
              {filtrados.length === 0 ? <li className={juntar(texto.auxiliar, "px-2 py-2")}>Nenhum cliente com esse nome.</li> : null}
            </ul>
          )}
        </div>
      ) : (
        <p className={juntar(texto.auxiliar, "min-w-0 truncate")}>
          Cliente: <span className="text-foreground">{escolhido ? nomeDoCliente(escolhido) : "o do pedido"}</span>
        </p>
      )}

      <CampoDeFormulario rotulo="Título no cofre">
        <input className={campo} value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder={nomeDoSite(pedido)} autoComplete="off" />
      </CampoDeFormulario>

      <CampoDeFormulario rotulo="E-mail ou usuário">
        <input
          className={campo}
          name="username"
          value={usuario}
          onChange={(e) => setUsuario(e.target.value)}
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          inputMode="email"
        />
      </CampoDeFormulario>

      <div className="min-w-0">
        <label htmlFor={`${idDoForm}-senha`} className={juntar(texto.rotulo, "mb-1.5 block")}>
          Senha
        </label>
        <div className="relative min-w-0">
          <input
            id={`${idDoForm}-senha`}
            className={juntar(campo, "pr-10")}
            name="password"
            type={ver ? "text" : "password"}
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
            autoComplete="current-password"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            autoFocus={!!pedido.conta && !precisaEscolher}
          />
          <button
            type="button"
            onClick={() => setVer((v) => !v)}
            className={juntar(botao.icone, "absolute right-0.5 top-0.5")}
            aria-label={ver ? "Esconder a senha" : "Mostrar a senha"}
            title={ver ? "Esconder a senha" : "Mostrar a senha"}
          >
            {ver ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
          </button>
        </div>
      </div>

      <label className="flex min-w-0 cursor-pointer items-center">
        <Switch checked={lembrar} onCheckedChange={setLembrar} aria-label="Lembrar no cofre e deixar o agente usar sempre" />
        <span className={juntar(texto.corpo, "ml-3 min-w-0")}>Lembrar no cofre e deixar o agente usar sempre</span>
      </label>

      {erro ? (
        <p role="alert" className="text-[12px] leading-4 text-destructive">
          {erro}
        </p>
      ) : null}
    </form>
  );
}

/* ----------------------------------------------------------------- código */

function FormularioDeCodigo({ pedido, agente, idDoForm, aoTerminar, ocupado, setOcupado }: PropsDoFormulario) {
  const [codigo, setCodigo] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  useEffect(() => () => setCodigo(""), []);

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    if (ocupado) return;
    const limpo = codigo.replace(/\s+/g, "");
    if (!limpo) return setErro("Coloque o código que chegou.");
    setErro(null);
    setOcupado(true);
    try {
      await responderComCodigo(pedido.id, limpo);
      setCodigo("");
      aoTerminar(`Pronto, o ${agente} já pode seguir`);
    } catch (falha) {
      setErro(mensagemDeErro(falha));
    } finally {
      setOcupado(false);
    }
  };

  return (
    <form id={idDoForm} onSubmit={enviar} className="min-w-0 space-y-2" noValidate>
      <label htmlFor={`${idDoForm}-codigo`} className={texto.rotulo}>
        Código
      </label>
      <input
        id={`${idDoForm}-codigo`}
        className={juntar(campo, "h-14 text-center font-mono text-[24px] tracking-[0.3em]")}
        value={codigo}
        onChange={(e) => setCodigo(e.target.value)}
        inputMode="numeric"
        autoComplete="one-time-code"
        autoCapitalize="characters"
        autoCorrect="off"
        spellCheck={false}
        maxLength={16}
        autoFocus
      />
      <p className={texto.auxiliar}>O código vale por 10 minutos.</p>
      {erro ? (
        <p role="alert" className="text-[12px] leading-4 text-destructive">
          {erro}
        </p>
      ) : null}
    </form>
  );
}

/* --------------------------------------------------------- conectar/outro */

function Conectar({ pedido }: { pedido: PedidoDeAcesso }) {
  const link = linkSeguro(pedido.link_para_conectar);
  const site = nomeDoSite(pedido);
  if (!link) {
    return <p className={texto.corpo}>Sem o link oficial para conectar {site}. Cancele e peça de novo.</p>;
  }
  return (
    <div className="min-w-0 space-y-2">
      <a href={link} target="_blank" rel="noopener noreferrer" className={juntar(botao.primario, "h-12 w-full text-[15px]")}>
        <Plug className="mr-2 h-4 w-4" aria-hidden="true" />
        <span className="min-w-0 truncate">Conectar {site}</span>
      </a>
      <p className={texto.auxiliar}>Abre a página oficial em outra aba. Conecte uma vez e volte aqui.</p>
    </div>
  );
}

/* ---------------------------------------------------------------- janela */

interface PropsDoFormulario {
  pedido: PedidoDeAcesso;
  agente: string;
  idDoForm: string;
  aoTerminar: (aviso: string) => void;
  ocupado: boolean;
  setOcupado: (v: boolean) => void;
}

function PrintDoPedido({ caminho, site }: { caminho: string | null; site: string }) {
  const print = usePrintDoPedido(caminho);
  const [ampliado, setAmpliado] = useState(false);
  if (!caminho) return null;
  if (print.isLoading) return <div className="h-40 w-full animate-pulse rounded-md bg-muted" aria-label="Carregando o print" />;
  if (!print.data) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => setAmpliado(true)}
        className="block w-full min-w-0 overflow-hidden rounded-md bg-muted"
        aria-label="Ampliar o print da tela"
        title="Ampliar o print"
      >
        <img src={print.data} alt={`Print da tela de ${site}`} className="mx-auto block max-h-[360px] w-full object-contain" />
      </button>
      <JanelaCentral aberta={ampliado} onMudar={setAmpliado} titulo={`Print de ${site}`} largura="tela" semEspaco classeDoCorpo="bg-black">
        <img src={print.data} alt={`Print da tela de ${site}, ampliado`} className="mx-auto block h-full w-full object-contain" />
      </JanelaCentral>
    </>
  );
}

export default function JanelaDoPedidoDeAcesso({ id, aberta, onFechar }: { id: string | null; aberta: boolean; onFechar: () => void }) {
  const qc = useQueryClient();
  const { data: pedido, isLoading, isError } = usePedidoDeAcesso(aberta ? id : null);
  const { data: nomes } = useNomesDosAgentes(aberta);
  const [ocupado, setOcupado] = useState(false);
  const idDoForm = `pedido-de-acesso-${id || "x"}`;

  const agente = nomeDoAgente(pedido?.operador_slug, nomes);
  const site = pedido ? nomeDoSite(pedido) : "";
  const emAberto = !!pedido && pedidoEmAberto(pedido);

  const terminar = (aviso: string) => {
    void qc.invalidateQueries({ queryKey: ["pedidos-de-acesso"] });
    toast.success(aviso);
    onFechar();
  };

  const feito = async () => {
    if (!pedido || ocupado) return;
    setOcupado(true);
    try {
      await marcarPedidoFeito(pedido.id);
      terminar(`Pronto, o ${agente} já pode seguir`);
    } catch (e) {
      toast.error(mensagemDeErro(e));
    } finally {
      setOcupado(false);
    }
  };

  const cancelar = async () => {
    if (!pedido || ocupado) return;
    setOcupado(true);
    try {
      await cancelarPedido(pedido.id);
      terminar("Pedido cancelado");
    } catch (e) {
      toast.error(mensagemDeErro(e));
    } finally {
      setOcupado(false);
    }
  };

  const tipo = pedido?.tipo;
  const principal = !emAberto ? null : tipo === "senha" ? (
    <button type="submit" form={idDoForm} className={botao.primario} disabled={ocupado}>
      {ocupado ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" /> : null}
      Salvar e liberar
    </button>
  ) : tipo === "codigo" ? (
    <button type="submit" form={idDoForm} className={botao.primario} disabled={ocupado}>
      {ocupado ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" /> : null}
      Enviar código
    </button>
  ) : (
    <button type="button" onClick={feito} className={tipo === "conectar" ? botao.secundario : botao.primario} disabled={ocupado}>
      {tipo === "conectar" ? "Já conectei" : "Já fiz"}
    </button>
  );

  const props: PropsDoFormulario | null = pedido ? { pedido, agente, idDoForm, aoTerminar: terminar, ocupado, setOcupado } : null;

  return (
    <JanelaCentral
      aberta={aberta}
      onMudar={(v) => {
        if (!v) onFechar();
      }}
      icone={
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Bot className="h-4 w-4" />
        </span>
      }
      titulo={pedido ? `${oAgente(agente)} precisa de você em ${site}` : "Pedido de acesso"}
      descricao={pedido && tipo ? ROTULO_DO_TIPO[tipo] : undefined}
      descricaoOculta={pedido ? undefined : "Pedido de acesso de um agente"}
      ajuda="Responda aqui e o agente segue sozinho. Senha guardada com o interruptor ligado fica no cofre do cliente e o agente usa nas próximas vezes. Facebook, Instagram e Google nunca pedem senha: só o botão de conectar."
      acoes={
        emAberto ? (
          <MenuMais rotulo="Mais ações do pedido" itens={[{ rotulo: "Cancelar o pedido", icone: <XCircle className="h-4 w-4" />, aoEscolher: () => void cancelar(), perigo: true }]} />
        ) : null
      }
      rodape={
        <>
          <button type="button" className={botao.discreto} onClick={onFechar}>
            Não agora
          </button>
          {principal}
        </>
      }
      largura="md"
      data-pedido-de-acesso={id || ""}
    >
      {isLoading ? (
        <Carregando forma="lista" linhas={3} rotulo="Abrindo o pedido" />
      ) : isError || !pedido ? (
        <EstadoVazio compacto titulo="Pedido não encontrado." descricao="Ele pode ter sido apagado ou você não tem acesso." />
      ) : !emAberto ? (
        <EstadoVazio compacto titulo="Este pedido já foi resolvido." descricao={pedido.status === "expirado" || pedido.status === "aberto" ? "O prazo acabou." : "Nada a fazer aqui."} />
      ) : (
        <div className="min-w-0 space-y-4">
          {pedido.mensagem ? <p className={juntar(texto.corpo, "whitespace-pre-line")}>{pedido.mensagem}</p> : null}
          <PrintDoPedido caminho={pedido.print_path} site={site} />
          {props && tipo === "senha" ? <FormularioDeSenha {...props} /> : null}
          {props && tipo === "codigo" ? <FormularioDeCodigo {...props} /> : null}
          {tipo === "conectar" ? <Conectar pedido={pedido} /> : null}
        </div>
      )}
    </JanelaCentral>
  );
}

/** Abre um pedido na tela atual (põe `?acesso=<id>` na url). */
export function useAbrirPedidoDeAcesso() {
  const [, setParametros] = useSearchParams();
  return (id: string) =>
    setParametros(
      (atual) => {
        const novo = new URLSearchParams(atual);
        novo.set(PARAMETRO_DO_PEDIDO, id);
        return novo;
      },
      { replace: false },
    );
}

/**
 * Montado uma vez no AppLayout: lê `?acesso=<id>` em qualquer tela e abre a
 * janela. Só admin e gestor (a tabela só é legível para eles). Fechar tira o
 * parâmetro e mantém o resto da url.
 */
export function PedidoDeAcessoPelaUrl() {
  const { profile } = useAuth();
  const [parametros, setParametros] = useSearchParams();
  const id = parametros.get(PARAMETRO_DO_PEDIDO);
  const pode = profile?.role === "admin" || profile?.role === "manager";
  if (!pode || !id) return null;
  const fechar = () =>
    setParametros(
      (atual) => {
        const novo = new URLSearchParams(atual);
        novo.delete(PARAMETRO_DO_PEDIDO);
        return novo;
      },
      { replace: true },
    );
  // key: trocar de pedido recomeça o formulário do zero (nada de senha herdada).
  return <JanelaDoPedidoDeAcesso key={id} id={id} aberta onFechar={fechar} />;
}
