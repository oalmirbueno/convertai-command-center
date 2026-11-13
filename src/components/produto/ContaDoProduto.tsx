import { useEffect, useMemo, useState } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Building2, CreditCard, KanbanSquare, KeyRound, ListPlus, Palette, Plug, Receipt, RefreshCw, Shield, Trash2, UserPlus, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  assinar,
  cancelarAssinatura,
  convidar,
  diaLegivel,
  ehGestor,
  fraseDoErro,
  lerPrecos,
  listarCobrancas,
  listarPlanos,
  mensalidadePrevista,
  mudarMembro,
  reais,
  reenviarConvite,
  sairDaEmpresa,
  salvarConta,
  type EstadoDoProduto,
  type MembroDaConta,
} from "@/lib/produto/api";
import { useRelerProduto } from "@/hooks/useProduto";
import {
  CabecalhoDePagina,
  CampoDeFormulario,
  Carregando,
  EstadoVazio,
  GrupoDeCampos,
  JanelaCentral,
  MenuMais,
  Secao,
  SeletorCompacto,
  botao,
  campo,
  etiqueta,
  juntar,
  lista,
  texto,
} from "@/components/sistema";
import { CampoDeSenha } from "@/components/publico/CascaPublica";
import EscolhaDePlano from "./EscolhaDePlano";
import AparenciaDaConta from "./AparenciaDaConta";
import FunilDaConta from "./FunilDaConta";
import ConexoesDaConta from "./ConexoesDaConta";
import CamposDaConta from "./CamposDaConta";
import { senhaAceita } from "./CriarSenha";

type Parte = "funil" | "campos" | "conexoes" | "plano" | "faturas" | "empresa" | "aparencia" | "acesso";

const COR_DA_COBRANCA: Record<string, string> = {
  paga: "bg-primary/10 text-primary",
  aberta: "bg-muted text-muted-foreground",
  atrasada: "bg-warning/10 text-warning",
  estornada: "bg-muted text-muted-foreground",
  cancelada: "bg-muted text-muted-foreground",
};
const ROTULO_DA_COBRANCA: Record<string, string> = { paga: "Paga", aberta: "Em aberto", atrasada: "Atrasada", estornada: "Estornada", cancelada: "Cancelada" };

/**
 * A Conta da empresa. Quem administra vê tudo: equipe, plano e assinatura,
 * faturas e dados. O usuário vê a equipe (só os nomes) e o próprio acesso.
 */
export default function ContaDoProduto({ estado }: { estado: EstadoDoProduto }) {
  const conta = estado.conta!;
  const admin = !!estado.eu && estado.eu.papel === "admin";
  const gestor = !!estado.eu && ehGestor(estado.eu.papel);
  const [busca, setBusca] = useSearchParams();
  const partes = useMemo(
    () => [
      ...(admin
        ? [
            { valor: "plano", rotulo: "Plano", icone: <CreditCard className="h-3.5 w-3.5" /> },
            { valor: "funil", rotulo: "Funil", icone: <KanbanSquare className="h-3.5 w-3.5" /> },
            { valor: "campos", rotulo: "Campos", icone: <ListPlus className="h-3.5 w-3.5" /> },
            { valor: "conexoes", rotulo: "Conexões", icone: <Plug className="h-3.5 w-3.5" /> },
            { valor: "faturas", rotulo: "Faturas", icone: <Receipt className="h-3.5 w-3.5" /> },
            { valor: "empresa", rotulo: "Empresa", icone: <Building2 className="h-3.5 w-3.5" /> },
            { valor: "aparencia", rotulo: "Aparência", icone: <Palette className="h-3.5 w-3.5" /> },
          ]
        : gestor
          ? [{ valor: "campos", rotulo: "Campos", icone: <ListPlus className="h-3.5 w-3.5" /> }]
          : []),
      { valor: "acesso", rotulo: "Meu acesso", icone: <KeyRound className="h-3.5 w-3.5" /> },
    ],
    [admin, gestor],
  );
  const pedida = busca.get("parte") || "";
  const parte: Parte = partes.some((p) => p.valor === pedida) ? (pedida as Parte) : admin ? "plano" : "acesso";
  const irPara = (p: string) => {
    const nova = new URLSearchParams(busca);
    nova.set("parte", p);
    nova.delete("pagamento");
    setBusca(nova, { replace: true });
  };

  // A equipe ganhou área própria (ranking, estrutura e perfis).
  if (pedida === "equipe") return <Navigate to="/app/equipe" replace />;
  return (
    <div className="mx-auto w-full min-w-0 max-w-[1320px]" data-conta-do-produto="">
      <CabecalhoDePagina
        titulo="Configurações"
        descricao={conta.nome}
        // No celular as partes ficam num seletor; do tablet para cima, na coluna da esquerda.
        acoes={<div className="md:hidden"><SeletorCompacto rotulo="Partes da conta" opcoes={partes} valor={parte} onEscolher={irPara} modo="lista" /></div>}
      />
      <div className="mt-5 grid min-w-0 grid-cols-1 gap-x-10 gap-y-5 md:grid-cols-[190px_minmax(0,1fr)]">
        <nav className="hidden min-w-0 md:block" aria-label="Partes da conta" data-partes-da-conta="">
          <ul className="space-y-0.5">
            {partes.map((p) => (
              <li key={p.valor}>
                <button
                  type="button"
                  onClick={() => irPara(p.valor)}
                  aria-current={parte === p.valor ? "page" : undefined}
                  className={juntar(
                    "toque-compacto flex h-9 w-full min-w-0 items-center rounded-md px-2.5 text-left text-[13px] font-medium transition-colors",
                    parte === p.valor ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                  )}
                >
                  <span className="mr-2 shrink-0">{p.icone}</span>
                  <span className="min-w-0 truncate">{p.rotulo}</span>
                </button>
              </li>
            ))}
          </ul>
        </nav>
        <div key={parte} className="produto-entra min-w-0">
          {parte === "campos" && gestor && <CamposDaConta estado={estado} />}
          {parte === "funil" && admin && <FunilDaConta estado={estado} />}
          {parte === "conexoes" && admin && <ConexoesDaConta />}
          {parte === "plano" && admin && <Plano estado={estado} />}
          {parte === "faturas" && admin && <Faturas contaId={conta.id} />}
          {parte === "empresa" && admin && <Empresa estado={estado} />}
          {parte === "aparencia" && admin && <AparenciaDaConta estado={estado} />}
          {parte === "acesso" && <MeuAcesso estado={estado} />}
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ plano e assinatura

function Plano({ estado }: { estado: EstadoDoProduto }) {
  const conta = estado.conta!;
  const ass = estado.assinatura;
  const reler = useRelerProduto();
  const [busca, setBusca] = useSearchParams();
  const planos = useQuery({ queryKey: ["produto", "planos"], queryFn: () => listarPlanos(), staleTime: 300_000 });
  const config = useQuery({ queryKey: ["produto", "precos"], queryFn: lerPrecos, staleTime: 300_000 });
  const [plano, setPlano] = useState(conta.plano_id);
  const [usuarios, setUsuarios] = useState(conta.usuarios_contratados);
  const [enviando, setEnviando] = useState(false);
  const [cancelando, setCancelando] = useState(false);
  const [confirmarCancelamento, setConfirmarCancelamento] = useState(false);

  // De volta do checkout: o pagamento é confirmado pelo aviso do Asaas, que chega em instantes.
  const voltaDoPagamento = busca.get("pagamento");
  useEffect(() => {
    if (!voltaDoPagamento) return;
    if (voltaDoPagamento === "ok") toast.success("Pagamento enviado. A confirmação chega em instantes.");
    else if (voltaDoPagamento === "cancelado") toast.info("O pagamento não foi concluído.");
    else if (voltaDoPagamento === "expirado") toast.info("O link do pagamento expirou. Gere outro.");
    const nova = new URLSearchParams(busca);
    nova.delete("pagamento");
    setBusca(nova, { replace: true });
    if (voltaDoPagamento !== "ok") return;
    let vezes = 0;
    const relogio = window.setInterval(() => {
      vezes += 1;
      void reler();
      if (vezes >= 8) window.clearInterval(relogio);
    }, 4000);
    return () => window.clearInterval(relogio);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voltaDoPagamento]);

  const opcoes = planos.data || [];
  const escolhido = opcoes.filter((p) => p.id === plano)[0] || null;
  const previsto = escolhido
    ? mensalidadePrevista({ plano: escolhido, usuarios, crm: conta.crm_ativo, email: conta.email_ativo, caixas: conta.email_caixas_contratadas, config: config.data || null })
    : null;
  const mudou = plano !== conta.plano_id || usuarios !== conta.usuarios_contratados;
  const assinando = !!ass && (ass.estado === "ativa" || ass.estado === "atrasada");
  const cortesia = conta.estado === "cortesia";
  const emTeste = conta.estado === "teste" && !assinando;
  const temAssinatura = !!ass && (ass.estado === "ativa" || ass.estado === "atrasada");

  const enviar = async (soGuardar = false) => {
    setEnviando(true);
    try {
      const r = await assinar({ plano_id: plano, usuarios, so_guardar: soGuardar });
      if (r.link) {
        window.location.assign(r.link);
        return;
      }
      await reler();
      if (r.agendado) toast.success(`A redução entra na próxima cobrança${r.a_partir_de ? `, em ${diaLegivel(r.a_partir_de)}` : ""}. Até lá fica o plano de hoje.`);
      else toast.success("Plano atualizado.");
    } catch (e) {
      toast.error(fraseDoErro(e, "Não foi possível concluir."));
    } finally {
      setEnviando(false);
    }
  };

  const cancelar = async () => {
    setCancelando(true);
    try {
      const r = await cancelarAssinatura();
      await reler();
      setConfirmarCancelamento(false);
      toast.success(`Assinatura cancelada. O acesso vai até ${diaLegivel(r.acesso_ate)}.`);
    } catch (e) {
      toast.error(fraseDoErro(e, "Não foi possível cancelar."));
    } finally {
      setCancelando(false);
    }
  };

  let situacao = "Sem assinatura";
  if (cortesia) situacao = "Cortesia";
  else if (ass && ass.estado === "ativa") situacao = `Ativa${ass.proximo_vencimento ? ` · próxima cobrança em ${diaLegivel(ass.proximo_vencimento)}` : ""}`;
  else if (ass && ass.estado === "atrasada") situacao = "Pagamento em atraso";
  else if (ass && ass.estado === "aguardando") situacao = "Aguardando o pagamento";
  else if (ass && ass.estado === "cancelada") situacao = "Cancelada";
  else if (conta.estado === "teste") situacao = `Em teste até ${diaLegivel(conta.teste_ate)}`;

  const rotuloDoBotao = cortesia || assinando ? "Atualizar plano" : "Assinar com cartão";
  const podeEnviar = !!escolhido && (assinando || cortesia ? mudou : true);

  return (
    <div className="grid min-w-0 grid-cols-1 items-start gap-x-10 gap-y-6 xl:grid-cols-[minmax(0,1fr)_340px]">
      <Secao
        titulo="Assinatura"
        descricao={situacao}
        ajuda="A cobrança é mensal, no cartão, pela página segura do Asaas: os dados do cartão não passam por aqui. Mudar o número de usuários ou o plano vale a partir da próxima cobrança."
        acao={
          assinando ? (
            <MenuMais rotulo="Mais ações da assinatura" itens={[{ rotulo: "Cancelar assinatura", perigo: true, aoEscolher: () => setConfirmarCancelamento(true) }]} />
          ) : undefined
        }
      >
        {ass && ass.troca_agendada && (
          <p className={juntar(texto.corpo, "mb-3")} data-troca-agendada="">
            Na próxima cobrança passa para {ass.troca_agendada.usuarios} {ass.troca_agendada.usuarios === 1 ? "usuário" : "usuários"}, {reais(ass.troca_agendada.valor)} por mês.
          </p>
        )}
        {ass && ass.cartao_final && (
          <p className={juntar(texto.corpo, "mb-3")}>
            Cartão {ass.cartao_bandeira ? `${ass.cartao_bandeira} ` : ""}final {ass.cartao_final}
          </p>
        )}
        {ass && ass.estado === "aguardando" && ass.checkout_link && (
          <p className={juntar(texto.corpo, "mb-3")}>
            Há um pagamento começado.{" "}
            <a href={ass.checkout_link} className="font-medium text-primary hover:underline">Continuar o pagamento</a>
          </p>
        )}
        {planos.isLoading ? (
          <Carregando linhas={3} rotulo="Carregando os planos" />
        ) : (
          <EscolhaDePlano
            planos={opcoes}
            plano={plano}
            usuarios={usuarios}
            minimoDeUsuarios={Math.max(1, estado.equipe.length)}
            onPlano={setPlano}
            onUsuarios={setUsuarios}
            atual={conta.plano_id}
          />
        )}
      </Secao>

      {previsto && (
        <Secao titulo="Mensalidade">
          <ul className={juntar(lista.aberta, lista.divisoria)} data-itens-da-mensalidade="">
            {previsto.itens.map((i) => (
              <li key={i.chave} className={lista.linha}>
                <span className={juntar(texto.corpo, "min-w-0 flex-1 truncate")}>
                  {i.nome}
                  {i.quantidade > 1 ? <span className="text-muted-foreground"> · {i.quantidade} x {reais(i.unitario)}</span> : null}
                </span>
                <span className={juntar(texto.corpo, "ml-3 shrink-0 tabular-nums")}>{reais(i.total)}</span>
              </li>
            ))}
            <li className={lista.linha}>
              <span className={juntar(texto.tituloSecao, "min-w-0 flex-1")}>Total por mês</span>
              <span className={juntar(texto.tituloSecao, "ml-3 shrink-0 tabular-nums")} data-total-da-mensalidade="">{reais(previsto.total)}</span>
            </li>
          </ul>
          {!cortesia && !estado.pagamentos_ativos && (
            <p className={juntar(texto.auxiliar, "mt-2")}>A assinatura pelo cartão ainda não foi aberta. A Aceleriq avisa quando abrir.</p>
          )}
          <div className="mt-4 flex min-w-0 justify-end">
            {/* Em teste dá para mudar plano e usuários sem pagar ainda: convidar a equipe não depende do cartão. */}
            {emTeste && mudou && (
              <button type="button" className={juntar(botao.secundario, "mr-2")} onClick={() => void enviar(true)} disabled={enviando} data-guardar-plano="">
                Guardar escolha
              </button>
            )}
            <button type="button" className={botao.primario} onClick={() => void enviar()} disabled={enviando || !podeEnviar || cortesia || (!estado.pagamentos_ativos && !temAssinatura)} title={cortesia ? "Em cortesia, fale com a Aceleriq para mudar o plano" : undefined} data-assinar="">
              {enviando ? "Abrindo..." : rotuloDoBotao}
            </button>
          </div>
        </Secao>
      )}

      <JanelaCentral
        aberta={confirmarCancelamento}
        onFechar={() => setConfirmarCancelamento(false)}
        largura="sm"
        titulo="Cancelar a assinatura?"
        rodape={
          <>
            <button type="button" className={juntar(botao.secundario, "mr-2")} onClick={() => setConfirmarCancelamento(false)}>Manter</button>
            <button type="button" className={botao.perigo} onClick={() => void cancelar()} disabled={cancelando}>{cancelando ? "Cancelando..." : "Cancelar assinatura"}</button>
          </>
        }
      >
        <p className={texto.corpo}>A empresa usa até o fim do período já pago. Os dados ficam guardados e voltam se você assinar de novo.</p>
      </JanelaCentral>
    </div>
  );
}

// ------------------------------------------------------------------ faturas

function Faturas({ contaId }: { contaId: string }) {
  const cobrancas = useQuery({ queryKey: ["produto", "cobrancas", contaId], queryFn: () => listarCobrancas(contaId) });
  if (cobrancas.isLoading) return <Carregando linhas={4} rotulo="Carregando as faturas" />;
  const linhas = cobrancas.data || [];
  return (
    <Secao titulo="Faturas" descricao={linhas.length ? `${linhas.length} ${linhas.length === 1 ? "cobrança" : "cobranças"}` : undefined}>
      {linhas.length === 0 ? (
        <EstadoVazio compacto titulo="Nenhuma cobrança ainda." />
      ) : (
        <ul className={juntar(lista.aberta, lista.divisoria)} data-faturas="">
          {linhas.map((c) => (
            <li key={c.id} className={lista.linha}>
              <span className="min-w-0 flex-1">
                <span className={juntar(texto.corpo, "block truncate")}>{c.descricao || (c.tipo === "migracao" ? "Migração do e-mail" : "Mensalidade")}</span>
                <span className={juntar(texto.auxiliar, "block truncate")}>
                  {c.estado === "paga" && c.pago_em ? `Paga em ${diaLegivel(c.pago_em, true)}` : c.vencimento ? `Vence em ${diaLegivel(c.vencimento, true)}` : ""}
                </span>
              </span>
              <span className={juntar(etiqueta, "ml-2", COR_DA_COBRANCA[c.estado] || "bg-muted text-muted-foreground")}>{ROTULO_DA_COBRANCA[c.estado] || c.estado}</span>
              <span className={juntar(texto.corpo, "ml-3 w-[88px] shrink-0 text-right tabular-nums")}>{reais(c.valor)}</span>
              {c.link && (c.estado === "aberta" || c.estado === "atrasada") ? (
                <a href={c.link} target="_blank" rel="noreferrer" className={juntar(botao.secundario, "ml-2 h-8")}>Pagar</a>
              ) : c.link ? (
                <a href={c.link} target="_blank" rel="noreferrer" className={juntar(botao.discreto, "ml-2 h-8")}>Ver</a>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Secao>
  );
}

// ------------------------------------------------------------------ empresa

function Empresa({ estado }: { estado: EstadoDoProduto }) {
  const conta = estado.conta!;
  const reler = useRelerProduto();
  const [nome, setNome] = useState(conta.nome);
  const [documento, setDocumento] = useState(conta.documento || "");
  const [telefone, setTelefone] = useState(conta.telefone || "");
  const [emailCobranca, setEmailCobranca] = useState(conta.email_cobranca || "");
  const [visibilidade, setVisibilidade] = useState(conta.visibilidade);
  const [salvando, setSalvando] = useState(false);
  const separaPorVendedor = !!estado.plano && estado.plano.limites.privacidade_por_vendedor;

  const salvar = async () => {
    setSalvando(true);
    try {
      await salvarConta({ nome: nome.trim(), documento, telefone, email_cobranca: emailCobranca.trim(), visibilidade });
      await reler();
      toast.success("Dados salvos.");
    } catch (e) {
      toast.error(fraseDoErro(e, "Não foi possível salvar."));
    } finally {
      setSalvando(false);
    }
  };

  return (
    <Secao
      titulo="Empresa"
      acao={<button type="button" className={botao.primario} onClick={() => void salvar()} disabled={salvando}>{salvando ? "Salvando..." : "Salvar"}</button>}
    >
      <GrupoDeCampos>
        <CampoDeFormulario rotulo="Nome da empresa" obrigatorio largo>
          <input value={nome} onChange={(e) => setNome(e.target.value)} className={campo} maxLength={120} />
        </CampoDeFormulario>
        <CampoDeFormulario rotulo="CPF ou CNPJ" apoio="Vai na cobrança e na nota">
          <input value={documento} onChange={(e) => setDocumento(e.target.value)} className={campo} inputMode="numeric" maxLength={20} />
        </CampoDeFormulario>
        <CampoDeFormulario rotulo="WhatsApp">
          <input value={telefone} onChange={(e) => setTelefone(e.target.value)} className={campo} inputMode="tel" maxLength={20} />
        </CampoDeFormulario>
        <CampoDeFormulario rotulo="E-mail da cobrança" largo>
          <input type="email" value={emailCobranca} onChange={(e) => setEmailCobranca(e.target.value)} className={campo} inputMode="email" />
        </CampoDeFormulario>
        <CampoDeFormulario
          rotulo="Quem vê os negócios"
          largo
          ajuda="Com 'Só os próprios', cada vendedor enxerga os negócios e compromissos dele e os que estão sem responsável. Quem administra sempre vê tudo."
          apoio={separaPorVendedor ? undefined : "Separar por vendedor faz parte do plano Pro"}
        >
          <SeletorCompacto
            rotulo="Quem vê os negócios"
            modo="segmentado"
            opcoes={[
              { valor: "todos", rotulo: "A equipe toda" },
              { valor: "proprios", rotulo: "Só os próprios", desativada: !separaPorVendedor },
            ]}
            valor={visibilidade}
            onEscolher={(v) => setVisibilidade(v as "todos" | "proprios")}
          />
        </CampoDeFormulario>
      </GrupoDeCampos>
    </Secao>
  );
}

// ------------------------------------------------------------------ meu acesso

function MeuAcesso({ estado }: { estado: EstadoDoProduto }) {
  const reler = useRelerProduto();
  const [saindo, setSaindo] = useState(false);
  const sair = async () => {
    try {
      await sairDaEmpresa();
      setSaindo(false);
      await reler();
      toast.success("Você saiu da empresa.");
    } catch (e) {
      toast.error(fraseDoErro(e, "Não foi possível sair agora."));
    }
  };
  const [senha, setSenha] = useState("");
  const [salvando, setSalvando] = useState(false);
  const trocar = async () => {
    if (!senhaAceita(senha)) return void toast.error("Use 10 caracteres ou mais, com maiúscula, minúscula e número.");
    setSalvando(true);
    const { error } = await supabase.auth.updateUser({ password: senha, data: { produto_senha: true } });
    setSalvando(false);
    if (error) return void toast.error("Não foi possível trocar a senha. Entre de novo e tente outra vez.");
    setSenha("");
    toast.success("Senha trocada.");
  };
  return (
    <Secao titulo="Meu acesso" descricao={estado.eu ? estado.eu.email : undefined}>
      <div className="max-w-[420px]">
        <CampoDeFormulario rotulo="Nova senha" apoio="10 caracteres ou mais, com maiúscula, minúscula e número">
          <CampoDeSenha value={senha} onChange={(e) => setSenha(e.target.value)} autoComplete="new-password" />
        </CampoDeFormulario>
        <button type="button" className={juntar(botao.secundario, "mt-3")} onClick={() => void trocar()} disabled={salvando || !senha}>
          {salvando ? "Salvando..." : "Trocar senha"}
        </button>
        <div className="mt-8 border-t border-border pt-4">
          <button type="button" className={juntar(botao.discreto, "-ml-2 text-destructive hover:text-destructive")} onClick={() => setSaindo(true)} data-sair-da-empresa="">
            Sair desta empresa
          </button>
        </div>
      </div>
      <JanelaCentral
        aberta={saindo}
        onFechar={() => setSaindo(false)}
        largura="sm"
        titulo="Sair da empresa?"
        rodape={
          <>
            <button type="button" className={juntar(botao.secundario, "mr-2")} onClick={() => setSaindo(false)}>Ficar</button>
            <button type="button" className={botao.perigo} onClick={() => void sair()}>Sair</button>
          </>
        }
      >
        <p className={texto.corpo}>Você perde o acesso ao CRM desta empresa. Os seus negócios ficam sem responsável para a equipe redistribuir.</p>
      </JanelaCentral>
    </Secao>
  );
}
