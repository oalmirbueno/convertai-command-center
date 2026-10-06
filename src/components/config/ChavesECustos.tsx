import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, History, KeyRound, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { AjudaRecolhida, Carregando, EstadoDeErro, FaixaDeNumeros, JanelaCentral, MenuMais, botao, campo, juntar, lista, texto } from "@/components/sistema";
import {
  CHAVE_DAS_CHAVES,
  COR_DO_ESTADO,
  ErroDasChaves,
  PROVEDORES,
  ROTULO_DO_ESTADO,
  ROTULO_DO_GRUPO,
  dolar,
  haQuanto,
  maiorCliente,
  lerChaves,
  numerosDaLinha,
  provedorPorId,
  removerChave,
  resumoDoQuadro,
  saldoBaixo,
  salvarAlerta,
  salvarChave,
  testarChave,
  textoDaCarteira,
  type LinhaDaChave,
  type QuadroDasChaves,
  type RespostaDoSalvar,
} from "@/lib/config/chavesECustos";

/**
 * Configurações › Chaves e custos (frente CHV, 01/10/2026). Pedido do dono:
 * "cadastrar todas as chaves pelo admin, e ali ele puxar se é válida ou não,
 * com o custo embaixo e números de forma clara, minimalista".
 *
 * Uma linha por provedor: bolinha com o estado, nome, para que serve, o fim
 * da chave, quando foi testada e os botões Testar e Trocar/Cadastrar. Embaixo,
 * numa linha pequena, "Este mês US$ X · Saldo US$ Y" e o uso que importa.
 * A janela de cadastro abre no centro; a chave nunca volta para a tela.
 *
 * Carregado sob demanda pela linha "Chaves e custos" da SettingsPage (só admin).
 */

export const AJUDA_DAS_CHAVES =
  "Cada provedor que o painel usa, com a chave da agência. A chave fica guardada no cofre do Supabase (Vault) e nunca volta para a tela: " +
  "aqui aparecem só os 4 últimos caracteres. Testar chama uma rota de consulta do provedor, que não gasta nada. Ao cadastrar, o painel testa " +
  "antes de guardar; chave recusada não substitui a que está valendo sem você confirmar. Se o mesmo segredo existir também nos segredos das " +
  "funções do Supabase, o de lá continua mandando. \"Este mês\" é o que o painel gastou com a chave da agência no mês (registro de uso); " +
  "o saldo só aparece quando o provedor informa pela API. Recarregar abre a página de cobrança do provedor em outra aba: nenhum deles vende crédito " +
  "por API com chave comum, e o painel nunca guarda cartão nem dado de pagamento. O aviso de saldo baixo começa em US$ 10 e se ajusta no \"...\" de cada linha.";

const atualizarQuadro = (qc: ReturnType<typeof useQueryClient>, q: QuadroDasChaves | undefined) => {
  if (q) qc.setQueryData(CHAVE_DAS_CHAVES, q);
};

function Final({ final }: { final: string | null }) {
  if (!final) return null;
  return (
    <span className="tabular-nums" aria-label={`chave terminada em ${final}`}>
      •••• {final}
    </span>
  );
}

function LinhaDoProvedor({
  linha,
  destacar = false,
  testando,
  onTestar,
  onCadastrar,
  onRemover,
  onAviso,
}: {
  linha: LinhaDaChave;
  destacar?: boolean;
  testando: boolean;
  onTestar: () => void;
  onCadastrar: () => void;
  onRemover: () => void;
  onAviso: () => void;
}) {
  const p = provedorPorId(linha.id)!;
  const cor = COR_DO_ESTADO[linha.estado];
  const quando = haQuanto(linha.testada_em);
  const numeros = numerosDaLinha(linha);
  const tem = linha.estado !== "sem_chave";
  const origem = linha.origem === "servidor" ? "no servidor" : linha.origem === "painel" ? "no painel" : null;
  return (
    <li className="min-w-0" data-provedor={linha.id} data-estado={linha.estado}>
      <div className={juntar(lista.linha, "flex-wrap items-start py-3 md:flex-nowrap", destacar && lista.destaque)}>
        <span className={juntar("mr-3 mt-[7px] h-2 w-2 shrink-0 rounded-full", cor.ponto)} aria-hidden="true" />
        <div className="mr-3 min-w-0 flex-1">
          <p className="flex min-w-0 items-baseline">
            <span className={juntar(texto.corpo, "shrink-0 font-medium")}>{p.nome}</span>
            {linha.saldo_baixo && (
              <span className={juntar(texto.etiqueta, "ml-2 shrink-0 rounded bg-warning/15 px-1.5 text-warning")} data-saldo-baixo="">
                Saldo baixo
              </span>
            )}
            {p.emBreve && <span className={juntar(texto.etiqueta, "ml-2 shrink-0 rounded bg-muted px-1.5 text-muted-foreground")}>em breve</span>}
            <span className={juntar(texto.auxiliar, "ml-2 hidden min-w-0 truncate sm:inline")}>{p.serve}</span>
          </p>
          {/* Estado no celular (no computador fica na coluna da direita). */}
          <p className={juntar(texto.auxiliar, "mt-0.5 md:hidden")}>
            <span className={juntar("font-medium", cor.texto)}>{ROTULO_DO_ESTADO[linha.estado]}</span>
            {linha.final && (
              <>
                {" · "}
                <Final final={linha.final} />
              </>
            )}
            {quando ? ` · testada ${quando}` : ""}
          </p>
          <p className={juntar(texto.auxiliar, "mt-0.5 min-w-0 break-words tabular-nums", saldoBaixo(linha) && "text-warning")} data-numeros="">
            {numeros.join(" · ")}
          </p>
          {linha.mensagem && linha.estado !== "valida" && <p className={juntar(texto.auxiliar, "mt-0.5 break-words", linha.estado === "invalida" && "text-destructive")}>{linha.mensagem}</p>}
        </div>
        <div className="mr-3 hidden w-[180px] shrink-0 text-right md:block lg:w-[220px]">
          <p className={juntar(texto.etiqueta, cor.texto)} data-rotulo-estado="">
            {ROTULO_DO_ESTADO[linha.estado]}
          </p>
          <p className={juntar(texto.auxiliar, "truncate")}>
            {tem ? (
              <>
                <Final final={linha.final} />
                {origem ? ` · ${origem}` : ""}
                {quando ? ` · ${quando}` : ""}
              </>
            ) : (
              "nenhuma chave"
            )}
          </p>
        </div>
        {/* No celular as ações descem para a linha de baixo, alinhadas com o texto. */}
        <div className="mt-2 flex w-full shrink-0 flex-wrap items-center pl-5 md:mt-0 md:w-auto md:flex-nowrap md:pl-0">
          {tem && (
            <button type="button" onClick={onTestar} disabled={testando} className={juntar(botao.secundario, "h-8 px-3")} data-testar={linha.id}>
              {testando ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : null}
              Testar
            </button>
          )}
          <button type="button" onClick={onCadastrar} className={juntar(tem ? botao.discreto : botao.secundario, "ml-1.5 h-8 px-3")} data-cadastrar={linha.id}>
            {tem ? "Trocar" : "Cadastrar"}
          </button>
          {p.recarga && (
            <a
              href={p.recarga}
              target="_blank"
              rel="noopener noreferrer"
              className={juntar(linha.saldo_baixo ? botao.secundario : botao.discreto, "ml-1.5 h-8 px-3", linha.saldo_baixo && "text-warning")}
              data-recarregar={linha.id}
              title={`Abre a cobrança do ${p.nome} em outra aba`}
            >
              Recarregar
              <ExternalLink className="ml-1.5 h-3.5 w-3.5" aria-hidden="true" />
            </a>
          )}
          <MenuMais
            className="ml-0.5"
            rotulo={`Mais ações de ${p.nome}`}
            itens={[
              { rotulo: `Aviso de saldo baixo (${dolar(linha.saldo_minimo_usd)})`, aoEscolher: onAviso },
              linha.no_painel ? { rotulo: "Remover do painel", perigo: true, aoEscolher: onRemover } : null,
            ]}
          />
        </div>
      </div>
    </li>
  );
}

function JanelaDeCadastro({ linha, onFechar, onSalvo }: { linha: LinhaDaChave; onFechar: () => void; onSalvo: (r: RespostaDoSalvar) => void }) {
  const p = provedorPorId(linha.id)!;
  const [valores, setValores] = useState<Record<string, string>>({});
  const [salvando, setSalvando] = useState(false);
  const [recusada, setRecusada] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const tem = linha.estado !== "sem_chave";
  const preenchidos = Object.keys(valores).filter((k) => valores[k].trim()).length;
  // Trocar só uma metade (Higgsfield) vale; cadastrar do zero pede todos os campos.
  const pronto = tem ? preenchidos > 0 : preenchidos === p.campos.length;

  const enviar = async (confirmar: boolean) => {
    setSalvando(true);
    setErro(null);
    try {
      const r = await salvarChave(p.id, valores, confirmar);
      if (!r.salva && r.precisa_confirmar) {
        setRecusada(r.teste.mensagem || "O provedor recusou esta chave.");
        return;
      }
      setValores({});
      onSalvo(r);
    } catch (e) {
      setErro(e instanceof ErroDasChaves || e instanceof Error ? e.message : "Não foi possível salvar agora.");
    } finally {
      setSalvando(false);
    }
  };

  const fechar = () => {
    setValores({});
    onFechar();
  };

  return (
    <JanelaCentral
      aberta
      onFechar={fechar}
      largura="sm"
      icone={<KeyRound className="h-4 w-4" />}
      titulo={`${tem ? "Trocar" : "Cadastrar"} a chave: ${p.nome}`}
      descricao={tem && linha.final ? `Em uso: •••• ${linha.final}${linha.origem === "servidor" ? " (servidor)" : ""}` : undefined}
      ajuda={`Pegue a chave em ${p.onde}. O painel testa antes de guardar, sem gastar nada, e guarda no cofre do Supabase. Depois de salva, a chave não aparece mais: só os 4 últimos caracteres.`}
      data-janela-de-chave={p.id}
      rodape={
        recusada ? (
          <div className="flex w-full flex-wrap items-center justify-end">
            <button type="button" onClick={() => setRecusada(null)} className={juntar(botao.discreto, "m-1")} disabled={salvando}>
              Voltar
            </button>
            <button type="button" onClick={() => void enviar(true)} className={juntar(botao.perigo, "m-1")} disabled={salvando} data-salvar-mesmo-assim="">
              {salvando && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
              Salvar mesmo assim
            </button>
          </div>
        ) : (
          <div className="flex w-full flex-wrap items-center justify-end">
            <button type="button" onClick={fechar} className={juntar(botao.discreto, "m-1")} disabled={salvando}>
              Cancelar
            </button>
            <button type="button" onClick={() => void enviar(false)} className={juntar(botao.primario, "m-1")} disabled={salvando || !pronto} data-salvar-chave="">
              {salvando && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
              {salvando ? "Testando" : "Testar e salvar"}
            </button>
          </div>
        )
      }
    >
      <form
        className="min-w-0"
        autoComplete="off"
        onSubmit={(e) => {
          e.preventDefault();
          if (pronto && !salvando && !recusada) void enviar(false);
        }}
      >
        {p.id === "higgsfield" && <p className="mb-3 text-xs text-muted-foreground">Use <a href="https://open.higgsfield.ai/api-keys" target="_blank" rel="noopener noreferrer" className="text-primary underline">Copy API key na Higgsfield</a> e cole o valor completo abaixo. Não copie o código de exemplo nem acrescente Key ou Bearer.</p>}
        {p.campos.map((c, i) => (
          <label key={c.nome} className={juntar("block min-w-0", i > 0 && "mt-3")}>
            <span className={juntar(texto.rotulo, "mb-1 block")}>{c.rotulo}</span>
            <input
              type="password"
              name={`chave-${c.nome.toLowerCase()}`}
              autoComplete="new-password"
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              className={juntar(campo, "font-mono")}
              placeholder={c.exemplo || "Cole a chave aqui"}
              value={valores[c.nome] || ""}
              onChange={(e) => {
                const v = e.target.value;
                setRecusada(null);
                setValores((a) => ({ ...a, [c.nome]: v }));
              }}
              autoFocus={i === 0}
              data-campo-da-chave={c.nome}
            />
          </label>
        ))}
        {linha.origem === "servidor" && <p className={juntar(texto.auxiliar, "mt-3")}>O segredo do servidor continua mandando enquanto existir.</p>}
        {recusada && (
          <p className={juntar(texto.corpo, "mt-3 text-destructive")} role="alert" data-chave-recusada="">
            {recusada} A chave que está valendo continua. Salvar mesmo assim?
          </p>
        )}
        {erro && (
          <p className={juntar(texto.corpo, "mt-3 text-destructive")} role="alert">
            {erro}
          </p>
        )}
      </form>
    </JanelaCentral>
  );
}

function JanelaDeRemover({ linha, onFechar, onRemovido }: { linha: LinhaDaChave; onFechar: () => void; onRemovido: (q: QuadroDasChaves) => void }) {
  const p = provedorPorId(linha.id)!;
  const [removendo, setRemovendo] = useState(false);
  const confirmar = async () => {
    setRemovendo(true);
    try {
      const r = await removerChave(p.id);
      onRemovido(r.quadro);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível remover agora.");
    } finally {
      setRemovendo(false);
    }
  };
  return (
    <JanelaCentral
      aberta
      onFechar={onFechar}
      largura="sm"
      titulo={`Remover a chave: ${p.nome}`}
      data-janela-remover={p.id}
      rodape={
        <div className="flex w-full flex-wrap items-center justify-end">
          <button type="button" onClick={onFechar} className={juntar(botao.discreto, "m-1")} disabled={removendo}>
            Cancelar
          </button>
          <button type="button" onClick={() => void confirmar()} className={juntar(botao.perigo, "m-1")} disabled={removendo} data-confirmar-remover="">
            {removendo && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
            Confirmar
          </button>
        </div>
      }
    >
      <p className={texto.corpo}>
        A chave {linha.final ? `•••• ${linha.final} ` : ""}sai do cofre do painel. {linha.no_servidor ? "O segredo do servidor continua valendo." : `Sem ela, o que usa o ${p.nome} para.`}
      </p>
    </JanelaCentral>
  );
}

function JanelaDoAviso({ linha, onFechar, onSalvo }: { linha: LinhaDaChave; onFechar: () => void; onSalvo: (q: QuadroDasChaves) => void }) {
  const p = provedorPorId(linha.id)!;
  const [valor, setValor] = useState(String(linha.saldo_minimo_usd));
  const [salvando, setSalvando] = useState(false);
  const numero = Number(valor.replace(",", "."));
  const valido = valor.trim() !== "" && isFinite(numero) && numero >= 0 && numero <= 100000;
  const salvar = async () => {
    setSalvando(true);
    try {
      const r = await salvarAlerta(p.id, numero);
      onSalvo(r.quadro);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível guardar o aviso agora.");
    } finally {
      setSalvando(false);
    }
  };
  return (
    <JanelaCentral
      aberta
      onFechar={onFechar}
      largura="sm"
      titulo={`Aviso de saldo baixo: ${p.nome}`}
      ajuda="Quando o saldo que o provedor informa ficar abaixo deste valor, a linha mostra Saldo baixo e o provedor entra no topo da seção. Só vale para quem informa saldo pela API."
      data-janela-aviso={p.id}
      rodape={
        <div className="flex w-full flex-wrap items-center justify-end">
          <button type="button" onClick={onFechar} className={juntar(botao.discreto, "m-1")} disabled={salvando}>
            Cancelar
          </button>
          <button type="button" onClick={() => void salvar()} className={juntar(botao.primario, "m-1")} disabled={salvando || !valido} data-salvar-aviso="">
            {salvando && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
            Salvar
          </button>
        </div>
      }
    >
      <label className="block min-w-0">
        <span className={juntar(texto.rotulo, "mb-1 block")}>Avisar abaixo de (US$)</span>
        <input type="text" inputMode="decimal" className={juntar(campo, "tabular-nums")} value={valor} onChange={(e) => setValor(e.target.value)} data-campo-aviso="" autoFocus />
      </label>
      {!p.saldoPelaApi && <p className={juntar(texto.auxiliar, "mt-2")}>O {p.nome} não informa saldo pela API com a chave comum; o aviso só vale quando o saldo aparecer.</p>}
    </JanelaCentral>
  );
}

/** Topo da seção: gasto do mês, clientes e saldo baixo; a lista por cliente recolhe. */
function Totais({ q, onAbrir }: { q: QuadroDasChaves; onAbrir: (id: string) => void }) {
  const [clientesAbertos, setClientesAbertos] = useState(false);
  const baixos = q.saldo_baixo.map((id) => provedorPorId(id)?.nome || id);
  const maior = maiorCliente(q.por_cliente);
  return (
    <div className="mb-3 min-w-0" data-totais-das-chaves="">
      <FaixaDeNumeros
        tamanho="compacto"
        colunas={3}
        itens={[
          { rotulo: "Gasto do mês", valor: dolar(q.mes_total_usd), apoio: "todos os provedores", chave: "mes" },
          {
            rotulo: "Por cliente",
            valor: String(q.por_cliente.length),
            apoio: maior || "nenhum gasto no mês",
            aoClicar: q.por_cliente.length ? () => setClientesAbertos((v) => !v) : undefined,
            dica: "Mostrar o gasto de cada cliente",
            chave: "clientes",
          },
          {
            rotulo: "Saldo baixo",
            valor: String(baixos.length),
            apoio: baixos.length ? baixos.join(", ") : "nenhum provedor",
            ponto: baixos.length ? "alerta" : "verde",
            corDoValor: baixos.length ? "text-warning" : undefined,
            aoClicar: q.saldo_baixo.length ? () => onAbrir(q.saldo_baixo[0]) : undefined,
            chave: "baixo",
          },
        ]}
      />
      {clientesAbertos && q.por_cliente.length > 0 && (
        <ul className={juntar(lista.aberta, lista.divisoria, "mt-2")} aria-label="Gasto do mês por cliente" data-gasto-por-cliente="">
          {q.por_cliente.map((c) => (
            <li key={c.client_id} className={juntar(lista.linha, "py-1.5")}>
              <span className={juntar(texto.corpo, "mr-3 min-w-0 flex-1 truncate")}>{c.nome}</span>
              <span className={juntar(texto.auxiliar, "mr-3 hidden shrink-0 tabular-nums sm:inline", c.carteira_usd !== null && c.carteira_usd < 2 && "text-warning")}>{textoDaCarteira(c)}</span>
              <span className={juntar(texto.corpo, "shrink-0 font-medium tabular-nums")}>{dolar(c.mes_usd)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Historico({ q }: { q: QuadroDasChaves }) {
  const [aberto, setAberto] = useState(false);
  if (!q.eventos.length) return null;
  const nome = (id: string) => provedorPorId(id)?.nome || id;
  const acao = { cadastrada: "cadastrada", trocada: "trocada", removida: "removida" } as const;
  return (
    <div className="mt-4 min-w-0">
      <button type="button" onClick={() => setAberto((v) => !v)} aria-expanded={aberto} className={juntar(botao.barra, "-ml-2")} data-historico-das-chaves="">
        <History className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
        Histórico ({q.eventos.length})
      </button>
      {aberto && (
        <ul className={juntar(texto.auxiliar, "mt-1 min-w-0")}>
          {q.eventos.map((e) => (
            <li key={`${e.provedor}-${e.criado_em}`} className="min-w-0 break-words py-0.5">
              Chave do {nome(e.provedor)} {acao[e.acao]}
              {e.ator_nome ? ` por ${e.ator_nome}` : ""} · {haQuanto(e.criado_em)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function ChavesECustos({ destaque }: { destaque?: string | null }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: CHAVE_DAS_CHAVES, queryFn: lerChaves, staleTime: 60_000, refetchOnWindowFocus: false, retry: false });
  const [testando, setTestando] = useState<Record<string, boolean>>({});
  const [todas, setTodas] = useState(false);
  const [cadastro, setCadastro] = useState<string | null>(null);
  const [remover, setRemover] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [realce, setRealce] = useState<string | null>(null);

  const testar = async (id: string, avisar = true) => {
    setTestando((t) => ({ ...t, [id]: true }));
    try {
      const r = await testarChave(id);
      atualizarQuadro(qc, r.quadro);
      if (avisar) {
        const nome = provedorPorId(id)?.nome || id;
        if (r.teste.estado === "valida") toast.success(`${nome}: ${r.teste.mensagem}`);
        else if (r.teste.estado === "invalida") toast.error(`${nome}: ${r.teste.mensagem}`);
        else toast.info(`${nome}: ${r.teste.mensagem}`);
      }
    } catch (e) {
      if (avisar) toast.error(e instanceof Error ? e.message : "Não foi possível testar agora.");
    } finally {
      setTestando((t) => ({ ...t, [id]: false }));
    }
  };

  const testarTodas = async () => {
    if (!q.data) return;
    setTodas(true);
    const ids = q.data.linhas.filter((l) => l.estado !== "sem_chave").map((l) => l.id);
    for (const id of ids) await testar(id, false);
    setTodas(false);
    toast.success(`${ids.length} ${ids.length === 1 ? "chave testada" : "chaves testadas"}.`);
  };

  if (q.isLoading) return <Carregando rotulo="Lendo as chaves" linhas={6} />;
  if (q.isError || !q.data) {
    return (
      <EstadoDeErro
        titulo="Não foi possível ler as chaves."
        descricao={q.error instanceof Error ? q.error.message : undefined}
        acao={
          <button type="button" onClick={() => void q.refetch()} className={botao.secundario}>
            Tentar de novo
          </button>
        }
      />
    );
  }
  const quadro = q.data;
  const linhaPorId: Record<string, LinhaDaChave> = {};
  quadro.linhas.forEach((l) => {
    linhaPorId[l.id] = l;
  });
  const grupos = (["ia", "midia", "servicos"] as const).map((g) => ({ g, ids: PROVEDORES.filter((p) => p.grupo === g).map((p) => p.id) }));
  const emCadastro = cadastro ? linhaPorId[cadastro] : null;
  const emRemocao = remover ? linhaPorId[remover] : null;
  const emAviso = aviso ? linhaPorId[aviso] : null;
  const realcada = realce || destaque || null;
  const irPara = (id: string) => {
    setRealce(id);
    const el = typeof document !== "undefined" ? document.querySelector(`[data-provedor="${id}"]`) : null;
    if (el && typeof (el as HTMLElement).scrollIntoView === "function") (el as HTMLElement).scrollIntoView({ block: "center", behavior: "smooth" });
  };

  return (
    <div className="min-w-0" data-chaves-e-custos="">
      <div className="mb-2 flex min-w-0 flex-wrap items-center">
        <p className={juntar(texto.auxiliar, "mr-auto min-w-0 py-1 tabular-nums")} data-resumo-das-chaves="">
          {resumoDoQuadro(quadro)}
        </p>
        <AjudaRecolhida className="mr-2" rotulo="Como funcionam as chaves">
          {AJUDA_DAS_CHAVES}
        </AjudaRecolhida>
        <button type="button" onClick={() => void testarTodas()} disabled={todas} className={juntar(botao.secundario, "h-8 px-3")} data-testar-todas="">
          {todas ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <RefreshCw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />}
          Testar todas
        </button>
      </div>

      <Totais q={quadro} onAbrir={irPara} />

      {grupos.map(({ g, ids }) => (
        <section key={g} className="mt-3 min-w-0" aria-label={ROTULO_DO_GRUPO[g]}>
          <h3 className={juntar(texto.rotulo, "mb-0.5")}>{ROTULO_DO_GRUPO[g]}</h3>
          <ul className={juntar(lista.aberta, lista.divisoria)}>
            {ids.map((id) =>
              linhaPorId[id] ? (
                <LinhaDoProvedor
                  key={id}
                  linha={linhaPorId[id]}
                  destacar={realcada === id}
                  testando={!!testando[id]}
                  onTestar={() => void testar(id)}
                  onCadastrar={() => setCadastro(id)}
                  onRemover={() => setRemover(id)}
                  onAviso={() => setAviso(id)}
                />
              ) : null,
            )}
          </ul>
        </section>
      ))}

      <Historico q={quadro} />

      {emCadastro && (
        <JanelaDeCadastro
          linha={emCadastro}
          onFechar={() => setCadastro(null)}
          onSalvo={(r) => {
            atualizarQuadro(qc, r.quadro);
            setCadastro(null);
            const nome = provedorPorId(emCadastro.id)?.nome || emCadastro.id;
            if (r.teste.estado === "valida") toast.success(`Chave do ${nome} salva e válida.`);
            else if (r.teste.estado === "invalida") toast.warning(`Chave do ${nome} salva, mas o provedor recusou.`);
            else toast.info(`Chave do ${nome} salva. ${r.teste.mensagem}`);
            if (r.aviso) toast.info(r.aviso, { duration: 9000 });
          }}
        />
      )}
      {emAviso && (
        <JanelaDoAviso
          linha={emAviso}
          onFechar={() => setAviso(null)}
          onSalvo={(novo) => {
            atualizarQuadro(qc, novo);
            setAviso(null);
            toast.success("Aviso de saldo guardado.");
          }}
        />
      )}
      {emRemocao && (
        <JanelaDeRemover
          linha={emRemocao}
          onFechar={() => setRemover(null)}
          onRemovido={(novo) => {
            atualizarQuadro(qc, novo);
            setRemover(null);
            toast.success("Chave removida do painel.");
          }}
        />
      )}
    </div>
  );
}

