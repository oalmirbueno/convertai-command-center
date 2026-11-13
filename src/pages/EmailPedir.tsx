import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Check, Minus, Plus } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { carregarProduto, criarConta, fraseDoErro, lerPrecos, pedirEmail, reais } from "@/lib/produto/api";
import {
  CAIXAS_MAXIMO,
  CAIXAS_MINIMO,
  RASCUNHO_VAZIO,
  caixasValidas,
  contaDoEmail,
  corpoDoPedido,
  dominioLimpo,
  dominioPessoal,
  dominioValido,
  guardarRascunho,
  lerRascunho,
  precosProntos,
  type RascunhoDoPedido,
} from "@/lib/produto/venda-email";
import { MarcaAceleriq } from "@/components/publico/CascaPublica";
import "./email-landing.css";

/**
 * O pedido do E-mail profissional (endereço /email/pedir), o caminho curto que
 * sai da página de venda: domínio e caixas, o acesso (criar ou entrar) e o
 * envio. O pedido chega à Aceleriq pelo fluxo que já existia: a ação
 * `pedir_email` da função `produto` avisa a casa e abre o negócio no Comercial.
 * Quem ainda não tem empresa no produto cria uma com `produto_criar_conta`.
 * Nada aqui cria cobrança.
 */

type Passo = "pedido" | "acesso" | "confirmar" | "enviar" | "feito";
const VOLTA = "/email/pedir";

/** A copy corrida do pedido, num lugar só. */
const TEXTO = {
  recebido: "A Aceleriq já foi avisada e vai falar com você para combinar a migração.",
  jaTem: "O domínio, as caixas e o andamento da migração estão no painel. Para mais caixas, peça por lá.",
  envio: "O pedido vai para a equipe da Aceleriq, que fala com você para combinar a migração.",
  confirmar: "Ao confirmar, você volta para cá com o pedido preenchido e só falta enviar.",
  soAdmin: "Peça para quem administra a conta abrir esta página e enviar.",
};

function Cartao({ etapa, children }: { etapa: number; children: ReactNode }) {
  return (
    <div className="el" data-pedido-de-email="">
      <div className="el-cenario" aria-hidden="true">
        <div className="el-grade" />
        <div className="el-brilho el-brilho-a" />
      </div>
      <div className="el-pedir">
        <div className="el-pedir-topo">
          <Link to="/email" className="el-voltar">
            <ArrowLeft size={16} strokeWidth={1.8} aria-hidden="true" />
            E-mail profissional
          </Link>
          <span className="el-espaco" />
          <MarcaAceleriq altura={20} />
        </div>
        <div className="el-progresso" role="progressbar" aria-valuemin={1} aria-valuemax={3} aria-valuenow={etapa} aria-label="Andamento do pedido">
          {[1, 2, 3].map((n) => (
            <i key={n} className={n <= etapa ? "el-feito" : undefined} />
          ))}
        </div>
        <div className="el-moldura">
          <div className="el-moldura-dentro">{children}</div>
        </div>
      </div>
    </div>
  );
}

function Avancar({ children, onClick, disabled, dado }: { children: ReactNode; onClick: () => void; disabled?: boolean; dado: string }) {
  return (
    <button type="button" className="el-botao" onClick={onClick} disabled={disabled} {...{ [dado]: "" }}>
      {children}
      <span className="el-botao-seta" aria-hidden="true">
        <ArrowRight size={18} strokeWidth={2} />
      </span>
    </button>
  );
}

export default function EmailPedir() {
  const { user, loading, signup } = useAuth();
  const qc = useQueryClient();
  const [params] = useSearchParams();
  const [r, setR] = useState<RascunhoDoPedido>(() => {
    const guardado = lerRascunho() || RASCUNHO_VAZIO;
    const daPagina = params.get("caixas");
    return daPagina ? { ...guardado, caixas: caixasValidas(daPagina, guardado.caixas) } : guardado;
  });
  const [passo, setPasso] = useState<Passo>("pedido");
  const [erro, setErro] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [verSenha, setVerSenha] = useState(false);
  const [aceito, setAceito] = useState(false);
  const contaCriada = useRef(false);

  const mudar = (parte: Partial<RascunhoDoPedido>) => {
    const novo = { ...r, ...parte };
    setR(novo);
    guardarRascunho(novo);
    setErro("");
  };
  const ir = (p: Passo) => {
    setErro("");
    setPasso(p);
    try {
      window.scrollTo(0, 0);
    } catch {
      /* sem rolagem programada */
    }
  };

  useEffect(() => {
    const antes = document.title;
    document.title = "Pedir o e-mail profissional | Aceleriq";
    return () => {
      document.title = antes;
    };
  }, []);

  // Quem acabou de criar o acesso (ou voltou do e-mail de confirmação) segue direto para o envio.
  useEffect(() => {
    if (user && (passo === "acesso" || passo === "confirmar")) ir("enviar");
  }, [user, passo]);

  const precos = useQuery({ queryKey: ["produto", "precos", "venda-email"], queryFn: lerPrecos, staleTime: 300_000, retry: 1 });
  const p = precosProntos(precos.data) ? precos.data : null;
  const estado = useQuery({ queryKey: ["produto", "estado", "pedido-de-email"], queryFn: carregarProduto, enabled: !!user && passo === "enviar", retry: 1 });

  const dominio = dominioLimpo(r.dominio);
  const conta = p ? contaDoEmail(p, r.caixas) : null;

  const continuar = () => {
    if (!r.semDominio) {
      if (!dominio) return setErro("Diga o domínio da empresa ou marque que ainda não tem.");
      if (dominioPessoal(dominio)) return setErro("Esse é um provedor de e-mail pessoal. Se a empresa ainda não tem domínio próprio, marque a opção abaixo.");
      if (!dominioValido(dominio)) return setErro("Confira o domínio. O formato é suaempresa.com.br.");
      mudar({ dominio });
    }
    ir(user ? "enviar" : "acesso");
  };

  const criarAcesso = async () => {
    if (nome.trim().length < 2) return setErro("Diga o seu nome.");
    if (r.empresa.trim().length < 2) return setErro("Diga o nome da empresa.");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) return setErro("Confira o e-mail.");
    if (senha.length < 8) return setErro("A senha precisa de 8 caracteres ou mais.");
    if (!aceito) return setErro("Aceite os termos para continuar.");
    setErro("");
    setEnviando(true);
    try {
      guardarRascunho(r);
      await signup(email.trim(), senha, nome.trim(), r.empresa.trim(), undefined, `${window.location.origin}${VOLTA}`);
      // Se o cadastro já entrou, o efeito acima leva ao envio; senão, falta confirmar o e-mail.
      setPasso((atual) => (atual === "acesso" ? "confirmar" : atual));
    } catch (e) {
      const msg = String((e as { message?: string }).message || "").toLowerCase();
      setErro(msg.indexOf("already") >= 0 ? "Esse e-mail já tem cadastro. Entre com ele." : "Não foi possível criar o acesso. Tente de novo.");
    } finally {
      setEnviando(false);
    }
  };

  const e = estado.data || null;
  const temConta = !!(e && e.conta) || contaCriada.current;
  const admin = !!(e && e.eu && e.eu.papel === "admin") || contaCriada.current;
  const inclusoNoPlano = !!(e && e.plano && e.plano.email_caixas_incluidas > 0);

  const enviar = async () => {
    if (!temConta && r.empresa.trim().length < 2) return setErro("Diga o nome da empresa.");
    setErro("");
    setEnviando(true);
    try {
      if (!temConta) {
        await criarConta({ nome: r.empresa.trim() });
        contaCriada.current = true;
        void qc.invalidateQueries({ queryKey: ["produto"] });
      }
      await pedirEmail(corpoDoPedido(r));
      guardarRascunho(null);
      ir("feito");
    } catch (falha) {
      setErro(fraseDoErro(falha, "Não foi possível enviar o pedido. Tente de novo."));
    } finally {
      setEnviando(false);
    }
  };

  const linhaDeErro = erro ? (
    <p className="el-erro" role="alert" data-erro-do-pedido="">
      {erro}
    </p>
  ) : null;

  if (loading) {
    return (
      <Cartao etapa={1}>
        <div role="heading" aria-level={1} className="el-pedir-titulo">Pedir o e-mail profissional</div>
        <p className="el-pedir-apoio">Abrindo.</p>
      </Cartao>
    );
  }

  if (passo === "feito") {
    return (
      <Cartao etapa={3}>
        <div data-pedido-enviado="">
          <span className="el-feito-icone" aria-hidden="true">
            <Check size={28} strokeWidth={2.4} />
          </span>
          <div role="heading" aria-level={1} className="el-pedir-titulo">Pedido recebido</div>
          <p className="el-pedir-apoio">{TEXTO.recebido}</p>
          <ul className="el-depois">
            <li>
              <Check size={18} strokeWidth={2} aria-hidden="true" />
              Confirmamos o domínio e as caixas com você.
            </li>
            <li>
              <Check size={18} strokeWidth={2} aria-hidden="true" />
              Você recebe o plano da migração antes de qualquer mudança.
            </li>
            <li>
              <Check size={18} strokeWidth={2} aria-hidden="true" />
              Nenhuma cobrança foi feita agora.
            </li>
          </ul>
          <div className="el-pedir-acoes">
            <Link to="/app/email" className="el-botao" data-acompanhar-pedido="">
              Acompanhar no painel
              <span className="el-botao-seta" aria-hidden="true">
                <ArrowRight size={18} strokeWidth={2} />
              </span>
            </Link>
          </div>
        </div>
      </Cartao>
    );
  }

  if (passo === "confirmar") {
    return (
      <Cartao etapa={2}>
        <div data-confirmar-email="">
          <div role="heading" aria-level={1} className="el-pedir-titulo">Confirme o seu e-mail</div>
          <p className="el-pedir-apoio">{`Enviamos um link para ${email.trim()}. ${TEXTO.confirmar}`}</p>
          <div className="el-pedir-acoes">
            <Link to={`/login?next=${encodeURIComponent(VOLTA)}`} className="el-botao-vazio">
              Já confirmei, entrar
            </Link>
          </div>
        </div>
      </Cartao>
    );
  }

  if (passo === "acesso") {
    return (
      <Cartao etapa={2}>
        <div data-passo-do-pedido="acesso">
          <div role="heading" aria-level={1} className="el-pedir-titulo">Crie o seu acesso</div>
          <p className="el-pedir-apoio">
            É por ele que você acompanha a migração. Já tem acesso? <Link to={`/login?next=${encodeURIComponent(VOLTA)}`}>Entrar</Link>
          </p>
          <label className="el-campo">
            <span>Seu nome</span>
            <input className="el-entrada" value={nome} onChange={(ev) => setNome(ev.target.value)} autoComplete="name" maxLength={120} data-campo="nome" />
          </label>
          <label className="el-campo">
            <span>Nome da empresa</span>
            <input className="el-entrada" value={r.empresa} onChange={(ev) => mudar({ empresa: ev.target.value })} autoComplete="organization" maxLength={120} data-campo="empresa" />
          </label>
          <label className="el-campo">
            <span>E-mail que você usa hoje</span>
            <input className="el-entrada" type="email" value={email} onChange={(ev) => setEmail(ev.target.value)} autoComplete="email" inputMode="email" autoCapitalize="none" data-campo="email" />
          </label>
          <label className="el-campo">
            <span>Senha</span>
            <span className="el-com-botao" style={{ marginBottom: 0 }}>
              <input className="el-entrada" type={verSenha ? "text" : "password"} value={senha} onChange={(ev) => setSenha(ev.target.value)} autoComplete="new-password" data-campo="senha" />
              <button type="button" onClick={() => setVerSenha((v) => !v)} aria-pressed={verSenha}>
                {verSenha ? "Ocultar" : "Mostrar"}
              </button>
            </span>
            <small>8 caracteres ou mais</small>
          </label>
          <label className="el-marcar">
            <input type="checkbox" checked={aceito} onChange={(ev) => setAceito(ev.target.checked)} data-campo="aceito" />
            <span>Li e aceito os termos de uso e a política de privacidade.</span>
          </label>
          {linhaDeErro}
          <div className="el-pedir-acoes">
            <button type="button" className="el-liga" onClick={() => ir("pedido")}>
              Voltar
            </button>
            <span className="el-espaco" />
            <Avancar onClick={() => void criarAcesso()} disabled={enviando} dado="data-criar-acesso">
              {enviando ? "Criando" : "Criar acesso"}
            </Avancar>
          </div>
        </div>
      </Cartao>
    );
  }

  if (passo === "enviar") {
    if (estado.isLoading || (!e && !estado.isError)) {
      return (
        <Cartao etapa={3}>
          <div role="heading" aria-level={1} className="el-pedir-titulo">Confira e envie</div>
          <p className="el-pedir-apoio">Abrindo a sua conta.</p>
        </Cartao>
      );
    }
    if (estado.isError || !e) {
      return (
        <Cartao etapa={3}>
          <div role="heading" aria-level={1} className="el-pedir-titulo">Não foi possível abrir a sua conta</div>
          <p className="el-pedir-apoio">O pedido continua preenchido.</p>
          <div className="el-pedir-acoes">
            <button type="button" className="el-botao-vazio" onClick={() => void estado.refetch()}>
              Tentar de novo
            </button>
          </div>
        </Cartao>
      );
    }
    if (e.conta && e.conta.email_ativo) {
      return (
        <Cartao etapa={3}>
          <div data-email-ja-contratado="">
            <div role="heading" aria-level={1} className="el-pedir-titulo">A sua empresa já tem o e-mail profissional</div>
            <p className="el-pedir-apoio">{TEXTO.jaTem}</p>
            <div className="el-pedir-acoes">
              <Link to="/app/email" className="el-botao">
                Abrir o painel
                <span className="el-botao-seta" aria-hidden="true">
                  <ArrowRight size={18} strokeWidth={2} />
                </span>
              </Link>
            </div>
          </div>
        </Cartao>
      );
    }
    if (e.conta && !admin) {
      return (
        <Cartao etapa={3}>
          <div data-pedido-so-do-admin="">
            <div role="heading" aria-level={1} className="el-pedir-titulo">Quem administra a empresa faz o pedido</div>
            <p className="el-pedir-apoio">{`O seu acesso em ${e.conta.nome} é de usuário. ${TEXTO.soAdmin}`}</p>
            <div className="el-pedir-acoes">
              <Link to="/app" className="el-botao-vazio">
                Abrir o painel
              </Link>
            </div>
          </div>
        </Cartao>
      );
    }
    return (
      <Cartao etapa={3}>
        <div data-passo-do-pedido="enviar">
          <div role="heading" aria-level={1} className="el-pedir-titulo">Confira e envie</div>
          <p className="el-pedir-apoio">{TEXTO.envio}</p>
          {!e.conta && (
            <label className="el-campo">
              <span>Nome da empresa</span>
              <input className="el-entrada" value={r.empresa} onChange={(ev) => mudar({ empresa: ev.target.value })} autoComplete="organization" maxLength={120} data-campo="empresa" />
            </label>
          )}
          <ul className="el-resumo" data-resumo-do-pedido="">
            {e.conta && (
              <li>
                <span>Empresa</span>
                <span>{e.conta.nome}</span>
              </li>
            )}
            <li>
              <span>Domínio</span>
              <span>{r.semDominio ? "Ainda não tenho" : dominio}</span>
            </li>
            <li>
              <span>Caixas</span>
              <span>{r.caixas}</span>
            </li>
            {inclusoNoPlano ? (
              <li className="el-forte">
                <span>Mensalidade</span>
                <span>Incluída no seu plano</span>
              </li>
            ) : conta ? (
              <li className="el-forte">
                <span>Mensalidade prevista</span>
                <span>{reais(conta.mensal)} por mês</span>
              </li>
            ) : null}
            {conta && conta.migracao > 0 && (
              <li>
                <span>Migração, uma vez</span>
                <span>{reais(conta.migracao)}</span>
              </li>
            )}
          </ul>
          {linhaDeErro}
          <div className="el-pedir-acoes">
            <button type="button" className="el-liga" onClick={() => ir("pedido")}>
              Voltar
            </button>
            <span className="el-espaco" />
            <Avancar onClick={() => void enviar()} disabled={enviando} dado="data-enviar-pedido">
              {enviando ? "Enviando" : "Enviar pedido"}
            </Avancar>
          </div>
          <p className="el-pedir-nota">
            Enviar não gera cobrança.
            {!e.conta && precos.data && precos.data.teste_dias > 0 ? ` A conta da empresa nasce com o CRM da Aceleriq em teste por ${precos.data.teste_dias} dias, sem cartão.` : ""}
          </p>
        </div>
      </Cartao>
    );
  }

  return (
    <Cartao etapa={1}>
      <div data-passo-do-pedido="pedido">
        <div role="heading" aria-level={1} className="el-pedir-titulo">Pedir o e-mail profissional</div>
        <p className="el-pedir-apoio">Duas informações e a Aceleriq já consegue preparar a migração.</p>
        <label className="el-campo">
          <span>Domínio da empresa</span>
          <input
            className="el-entrada"
            value={r.dominio}
            onChange={(ev) => mudar({ dominio: ev.target.value })}
            placeholder="suaempresa.com.br"
            maxLength={120}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            inputMode="url"
            disabled={r.semDominio}
            data-campo="dominio"
          />
          <small>O que vem depois do @ no e-mail da empresa.</small>
        </label>
        <label className="el-marcar">
          <input type="checkbox" checked={r.semDominio} onChange={(ev) => mudar({ semDominio: ev.target.checked })} data-campo="sem-dominio" />
          <span>A empresa ainda não tem domínio próprio.</span>
        </label>
        <div className="el-campo">
          <span id="rotulo-caixas-do-pedido">Quantas caixas</span>
          <div className="el-passador" role="group" aria-labelledby="rotulo-caixas-do-pedido">
            <button type="button" onClick={() => mudar({ caixas: caixasValidas(r.caixas - 1, r.caixas) })} disabled={r.caixas <= CAIXAS_MINIMO} aria-label="Menos uma caixa">
              <Minus size={20} strokeWidth={2} aria-hidden="true" />
            </button>
            <output aria-live="polite" data-caixas-do-pedido="">
              {r.caixas}
            </output>
            <button type="button" onClick={() => mudar({ caixas: caixasValidas(r.caixas + 1, r.caixas) })} disabled={r.caixas >= CAIXAS_MAXIMO} aria-label="Mais uma caixa" data-mais-caixa="">
              <Plus size={20} strokeWidth={2} aria-hidden="true" />
            </button>
          </div>
          <small>Uma para cada pessoa ou setor que vai usar.</small>
        </div>
        <label className="el-campo">
          <span>Onde o e-mail está hoje (opcional)</span>
          <textarea className="el-entrada" value={r.observacao} onChange={(ev) => mudar({ observacao: ev.target.value })} maxLength={500} placeholder="Provedor atual e o que mais ajudar" data-campo="observacao" />
        </label>
        {conta && (
          <ul className="el-resumo">
            <li className="el-forte">
              <span>Mensalidade prevista</span>
              <span>{reais(conta.mensal)} por mês</span>
            </li>
            {conta.migracao > 0 && (
              <li>
                <span>Migração, uma vez</span>
                <span>{reais(conta.migracao)}</span>
              </li>
            )}
          </ul>
        )}
        {linhaDeErro}
        <div className="el-pedir-acoes">
          <span className="el-espaco" />
          <Avancar onClick={continuar} dado="data-continuar-pedido">
            Continuar
          </Avancar>
        </div>
      </div>
    </Cartao>
  );
}
