import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Building2, CreditCard, KeyRound, Receipt, RefreshCw, Shield, Trash2, UserPlus, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  assinar,
  cancelarAssinatura,
  convidar,
  diaLegivel,
  fraseDoErro,
  lerConfig,
  listarCobrancas,
  listarPlanos,
  mensalidadePrevista,
  mudarMembro,
  reais,
  reenviarConvite,
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
import { senhaAceita } from "./CriarSenha";

type Parte = "equipe" | "plano" | "faturas" | "empresa" | "acesso";

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
  const [busca, setBusca] = useSearchParams();
  const partes = useMemo(
    () => [
      { valor: "equipe", rotulo: "Equipe", icone: <Users className="h-3.5 w-3.5" /> },
      ...(admin
        ? [
            { valor: "plano", rotulo: "Plano", icone: <CreditCard className="h-3.5 w-3.5" /> },
            { valor: "faturas", rotulo: "Faturas", icone: <Receipt className="h-3.5 w-3.5" /> },
            { valor: "empresa", rotulo: "Empresa", icone: <Building2 className="h-3.5 w-3.5" /> },
          ]
        : []),
      { valor: "acesso", rotulo: "Meu acesso", icone: <KeyRound className="h-3.5 w-3.5" /> },
    ],
    [admin],
  );
  const pedida = busca.get("parte") || "";
  const parte: Parte = partes.some((p) => p.valor === pedida) ? (pedida as Parte) : "equipe";
  const irPara = (p: string) => {
    const nova = new URLSearchParams(busca);
    nova.set("parte", p);
    nova.delete("pagamento");
    setBusca(nova, { replace: true });
  };

  return (
    <div className="mx-auto w-full min-w-0 max-w-[1040px] space-y-5" data-conta-do-produto="">
      <CabecalhoDePagina
        titulo="Conta"
        descricao={conta.nome}
        acoes={<SeletorCompacto rotulo="Partes da conta" opcoes={partes} valor={parte} onEscolher={irPara} listaQuandoNaoCabe />}
      />
      {parte === "equipe" && <Equipe estado={estado} admin={admin} />}
      {parte === "plano" && admin && <Plano estado={estado} />}
      {parte === "faturas" && admin && <Faturas contaId={conta.id} />}
      {parte === "empresa" && admin && <Empresa estado={estado} />}
      {parte === "acesso" && <MeuAcesso estado={estado} />}
    </div>
  );
}

// ------------------------------------------------------------------ equipe

function Equipe({ estado, admin }: { estado: EstadoDoProduto; admin: boolean }) {
  const conta = estado.conta!;
  const reler = useRelerProduto();
  const [convidando, setConvidando] = useState(false);
  const [email, setEmail] = useState("");
  const [nome, setNome] = useState("");
  const [papel, setPapel] = useState<"usuario" | "admin">("usuario");
  const [enviando, setEnviando] = useState(false);
  const [saindo, setSaindo] = useState<MembroDaConta | null>(null);
  const ocupados = estado.equipe.length;
  const cheio = ocupados >= conta.usuarios_contratados;

  const enviar = async () => {
    setEnviando(true);
    try {
      const r = await convidar({ email: email.trim(), nome: nome.trim(), papel });
      await reler();
      setConvidando(false);
      setEmail("");
      setNome("");
      setPapel("usuario");
      toast.success(r.enviado ? "Convite enviado por e-mail." : "Pessoa adicionada. O e-mail não saiu agora: reenvie o convite.");
    } catch (e) {
      toast.error(fraseDoErro(e, "Não foi possível convidar."));
    } finally {
      setEnviando(false);
    }
  };

  const mudar = async (m: MembroDaConta, p: { papel?: "admin" | "usuario"; remover?: boolean }, feito: string) => {
    try {
      await mudarMembro(m.id, p);
      await reler();
      toast.success(feito);
    } catch (e) {
      toast.error(fraseDoErro(e));
    }
  };

  return (
    <Secao
      titulo="Equipe"
      descricao={`${ocupados} de ${conta.usuarios_contratados} ${conta.usuarios_contratados === 1 ? "usuário" : "usuários"}`}
      ajuda="Cada pessoa entra com o próprio e-mail e senha. Quem administra convida, muda o papel e remove. Ao remover alguém, os negócios dessa pessoa ficam sem responsável para você redistribuir."
      acao={
        admin ? (
          <button type="button" className={botao.primario} onClick={() => setConvidando(true)} disabled={cheio} title={cheio ? "Aumente os usuários no Plano para convidar" : undefined} data-convidar="">
            <UserPlus className="mr-1.5 h-4 w-4" aria-hidden="true" />
            Convidar
          </button>
        ) : undefined
      }
    >
      {admin && cheio && <p className={juntar(texto.auxiliar, "mb-2")}>Todos os lugares estão em uso. Para convidar, aumente os usuários em Plano.</p>}
      <ul className={juntar(lista.aberta, lista.divisoria)} data-lista-da-equipe="">
        {estado.equipe.map((m) => (
          <li key={m.id} className={lista.linha}>
            <span className="mr-3 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[12px] font-semibold text-primary">
              {(m.nome || m.email || "?").charAt(0).toUpperCase()}
            </span>
            <span className="min-w-0 flex-1">
              <span className={juntar(texto.corpo, "block truncate font-medium")}>{m.nome || m.email || "Sem nome"}</span>
              {m.email && <span className={juntar(texto.auxiliar, "block truncate")}>{m.email}</span>}
            </span>
            {m.estado === "convidado" && <span className={juntar(etiqueta, "ml-2 bg-warning/10 text-warning")}>Convite enviado</span>}
            <span className={juntar(etiqueta, "ml-2", m.papel === "admin" ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")}>{m.papel === "admin" ? "Administra" : "Usuário"}</span>
            {admin && (
              <MenuMais
                className="ml-1"
                rotulo={`Ações de ${m.nome || m.email || "membro"}`}
                itens={[
                  m.estado === "convidado" && {
                    rotulo: "Reenviar convite",
                    icone: <RefreshCw className="h-4 w-4" />,
                    aoEscolher: () => void reenviarConvite(m.id).then((r) => (r.enviado ? toast.success("Convite reenviado.") : toast.error("O e-mail não saiu agora. Tente de novo."))).catch((e) => toast.error(fraseDoErro(e))),
                  },
                  m.papel === "usuario"
                    ? { rotulo: "Tornar administrador", icone: <Shield className="h-4 w-4" />, aoEscolher: () => void mudar(m, { papel: "admin" }, "Agora administra a empresa.") }
                    : { rotulo: "Tornar usuário", icone: <Users className="h-4 w-4" />, aoEscolher: () => void mudar(m, { papel: "usuario" }, "Agora é usuário.") },
                  { rotulo: "Remover da empresa", icone: <Trash2 className="h-4 w-4" />, perigo: true, separadorAntes: true, aoEscolher: () => setSaindo(m) },
                ]}
              />
            )}
          </li>
        ))}
      </ul>

      <JanelaCentral
        aberta={convidando}
        onFechar={() => setConvidando(false)}
        largura="sm"
        titulo="Convidar para a equipe"
        ajuda="A pessoa recebe um e-mail com o botão de entrar. Na primeira vez ela escolhe a própria senha."
        rodape={
          <button type="button" className={botao.primario} onClick={() => void enviar()} disabled={enviando || email.trim().length < 5}>
            {enviando ? "Enviando..." : "Enviar convite"}
          </button>
        }
      >
        <GrupoDeCampos colunas={1}>
          <CampoDeFormulario rotulo="E-mail" obrigatorio>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={campo} autoComplete="off" inputMode="email" />
          </CampoDeFormulario>
          <CampoDeFormulario rotulo="Nome">
            <input value={nome} onChange={(e) => setNome(e.target.value)} className={campo} maxLength={120} />
          </CampoDeFormulario>
          <CampoDeFormulario rotulo="Papel" ajuda="Quem administra convida pessoas, muda o plano e vê as faturas. O usuário trabalha no CRM.">
            <SeletorCompacto
              rotulo="Papel"
              modo="segmentado"
              opcoes={[
                { valor: "usuario", rotulo: "Usuário" },
                { valor: "admin", rotulo: "Administrador" },
              ]}
              valor={papel}
              onEscolher={(v) => setPapel(v as "usuario" | "admin")}
            />
          </CampoDeFormulario>
        </GrupoDeCampos>
      </JanelaCentral>

      <JanelaCentral
        aberta={!!saindo}
        onFechar={() => setSaindo(null)}
        largura="sm"
        titulo={saindo ? `Remover ${saindo.nome || saindo.email || "esta pessoa"}?` : "Remover"}
        descricao="Ela perde o acesso na hora"
        rodape={
          <>
            <button type="button" className={juntar(botao.secundario, "mr-2")} onClick={() => setSaindo(null)}>Cancelar</button>
            <button
              type="button"
              className={botao.perigo}
              onClick={() => {
                const m = saindo;
                setSaindo(null);
                if (m) void mudar(m, { remover: true }, "Pessoa removida.");
              }}
            >
              Remover
            </button>
          </>
        }
      >
        <p className={texto.corpo}>Os negócios e compromissos em aberto dela ficam sem responsável. O lugar volta a ficar livre.</p>
      </JanelaCentral>
    </Secao>
  );
}

// ------------------------------------------------------------------ plano e assinatura

function Plano({ estado }: { estado: EstadoDoProduto }) {
  const conta = estado.conta!;
  const ass = estado.assinatura;
  const reler = useRelerProduto();
  const [busca, setBusca] = useSearchParams();
  const planos = useQuery({ queryKey: ["produto", "planos"], queryFn: () => listarPlanos(), staleTime: 300_000 });
  const config = useQuery({ queryKey: ["produto", "config"], queryFn: lerConfig, staleTime: 300_000 });
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

  const enviar = async () => {
    setEnviando(true);
    try {
      const r = await assinar({ plano_id: plano, usuarios });
      if (r.link) {
        window.location.assign(r.link);
        return;
      }
      await reler();
      toast.success("Plano atualizado.");
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
    <div className="min-w-0 space-y-6">
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
            <button type="button" className={botao.primario} onClick={() => void enviar()} disabled={enviando || !podeEnviar || (!cortesia && !estado.pagamentos_ativos)} data-assinar="">
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
      </div>
    </Secao>
  );
}
