import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowRight, AtSign, Check, Globe, Inbox, Laptop, MailWarning, Minus, MonitorSmartphone, Plus, ShieldCheck, Smartphone, UserX, Wrench } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { lerPrecos, reais } from "@/lib/produto/api";
import { CAIXAS_MAXIMO, CAIXAS_MINIMO, caixasValidas, contaDoEmail, precosProntos } from "@/lib/produto/venda-email";
import { MarcaAceleriq } from "@/components/publico/CascaPublica";
import "./email-landing.css";

/**
 * Página de venda do E-mail profissional (endereço /email), pública.
 * Copy em AIDA: a promessa, o problema, como a migração acontece, o que vem
 * incluído, o preço lido do banco com a conta por caixa, as objeções, as
 * dúvidas e a chamada final. O botão leva ao pedido em /email/pedir.
 * Nenhum valor é escrito aqui: tudo vem de produto_precos().
 */

const TRACO = 1.6;

/**
 * Entrada por rolagem: liga a classe `el-anim` só quando o navegador observa a
 * rolagem e a pessoa não pediu menos movimento. Sem isso, tudo nasce visível.
 */
function useEntradaPorRolagem(raiz: RefObject<HTMLDivElement>) {
  useEffect(() => {
    const el = raiz.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    el.classList.add("el-anim");
    const observador = new IntersectionObserver(
      (entradas) => {
        entradas.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add("el-in");
            observador.unobserve(e.target);
          }
        });
      },
      { rootMargin: "0px 0px -6% 0px", threshold: 0.08 },
    );
    Array.prototype.forEach.call(el.querySelectorAll(".el-r"), (alvo: Element) => observador.observe(alvo));
    return () => {
      observador.disconnect();
      el.classList.remove("el-anim");
    };
  }, [raiz]);
}

function Pedir({ para, children = "Pedir meu e-mail", cheio = false }: { para: string; children?: ReactNode; cheio?: boolean }) {
  return (
    <Link to={para} className={cheio ? "el-botao el-botao-cheio" : "el-botao"} data-pedir-email-profissional="">
      {children}
      <span className="el-botao-seta" aria-hidden="true">
        <ArrowRight size={18} strokeWidth={2} />
      </span>
    </Link>
  );
}

const atraso = (ms: number) => ({ transitionDelay: `${ms}ms` });

/** A copy corrida da página, num lugar só. */
const TEXTO = {
  promessa: "A Aceleriq migra caixas, histórico e DNS para você. Sua equipe não perde mensagem e não fica um dia fora do ar.",
  etapas: "Quatro etapas, com alguém da Aceleriq cuidando de cada uma. Você acompanha o andamento pelo painel.",
  caixas: "Uma para cada pessoa ou setor: vendas, financeiro, contato. Precisou de mais, é só pedir.",
  protecao: "Configuramos os três registros que provam que a mensagem saiu mesmo da sua empresa. É o que separa a caixa de entrada da pasta de spam.",
  dominio: "O endereço termina com o nome do seu negócio, e as contas ficam no nome da empresa. Se ainda não tem domínio, diga no pedido.",
  semCobranca: "Enviar o pedido não gera cobrança. A Aceleriq confirma os detalhes com você antes.",
};

const DORES = [
  {
    icone: AtSign,
    titulo: "E-mail genérico custa credibilidade",
    texto: "Proposta enviada de um endereço pessoal parece de quem começou ontem. O cliente compara com o concorrente que assina com o nome da empresa.",
  },
  {
    icone: MailWarning,
    titulo: "Sua mensagem cai no spam",
    texto: "Sem SPF, DKIM e DMARC, quem recebe não tem como confirmar que a mensagem é mesmo sua. O orçamento sai e ninguém vê.",
  },
  {
    icone: UserX,
    titulo: "O ex-funcionário leva os contatos",
    texto: "Conta pessoal é de quem criou. Quando a pessoa sai da empresa, vão junto as conversas, os clientes e a senha.",
  },
];

const PASSOS = [
  {
    titulo: "Levantamento",
    texto: "Mapeamos as caixas que existem hoje, onde está o domínio e o que precisa vir junto. Você recebe o plano antes de qualquer mudança.",
    selo: "Seu e-mail segue como está",
  },
  {
    titulo: "Preparo",
    texto: "Criamos as caixas novas e copiamos o histórico. Enquanto isso, a equipe continua usando o endereço de sempre.",
    selo: "Nada muda para a equipe",
  },
  {
    titulo: "Virada do DNS",
    texto: "No horário combinado, apontamos o domínio para as caixas novas. As mensagens passam a chegar no lugar certo, sem intervalo.",
    selo: "Sem ficar fora do ar",
  },
  {
    titulo: "Conferência",
    texto: "Testamos envio e recebimento de cada caixa e conferimos MX, SPF, DKIM e DMARC. Só então a migração é dada como concluída.",
    selo: "Cada caixa testada",
  },
];

const OBJECOES = [
  { pergunta: "“Vou perder meus e-mails antigos.”", resposta: "O histórico é copiado para as caixas novas antes da virada.", forte: "Não vai." },
  { pergunta: "“Vou ficar sem e-mail no dia da troca.”", resposta: "O endereço antigo recebe até a virada e o novo assume em seguida.", forte: "Não fica." },
  { pergunta: "“Não entendo nada de DNS.”", resposta: "A parte técnica é toda da Aceleriq. Você só combina o horário.", forte: "Nem precisa." },
  { pergunta: "“Já tentei e deu problema.”", resposta: "A conferência é uma etapa do serviço: cada caixa é testada enviando e recebendo.", forte: "Por isso existe a conferência." },
];

export default function EmailLanding() {
  const { user } = useAuth();
  const raiz = useRef<HTMLDivElement>(null);
  useEntradaPorRolagem(raiz);

  const precos = useQuery({ queryKey: ["produto", "precos", "venda-email"], queryFn: lerPrecos, staleTime: 300_000, retry: 1 });
  const p = precosProntos(precos.data) ? precos.data : null;
  const [caixas, setCaixas] = useState(5);
  const tocou = useRef(false);
  // A calculadora começa no número de caixas que a mensalidade já cobre.
  useEffect(() => {
    if (p && !tocou.current && p.email_caixas_no_mensal >= CAIXAS_MINIMO) setCaixas(caixasValidas(p.email_caixas_no_mensal));
  }, [p]);
  const mudar = (n: number) => {
    tocou.current = true;
    setCaixas(caixasValidas(n, caixas));
  };
  const conta = p ? contaDoEmail(p, caixas) : null;
  const destino = `/email/pedir?caixas=${caixas}`;

  useEffect(() => {
    const antes = document.title;
    document.title = "E-mail profissional com migração feita | Aceleriq";
    return () => {
      document.title = antes;
    };
  }, []);

  const duvidas: Array<{ p: string; r: string }> = [
    { p: "Quanto tempo leva a migração?", r: "Depende de quantas caixas existem e do tamanho do histórico. No levantamento você recebe a previsão antes de começar." },
    { p: "Preciso trocar o meu endereço de e-mail?", r: "Se a empresa já usa o próprio domínio, os endereços continuam os mesmos. Se hoje é um e-mail pessoal, cada pessoa ganha o endereço novo com o nome da empresa." },
    { p: "De quem é a conta do e-mail?", r: "Da sua empresa. As contas ficam no nome dela e a Aceleriq cuida da configuração e da migração." },
    { p: "Funciona no celular?", r: "Sim. O e-mail abre no webmail, no celular e no computador." },
    {
      p: "Posso pedir mais caixas depois?",
      r: p && p.email_caixa_extra > 0 ? `Sim. Você pede pelo painel e cada caixa adicional soma ${reais(p.email_caixa_extra)} à mensalidade.` : "Sim. Você pede pelo painel e a Aceleriq cria a caixa.",
    },
    { p: "Quando eu pago?", r: "Enviar o pedido não gera cobrança. A Aceleriq confirma o domínio e as caixas com você, e só então combina a migração e a mensalidade." },
    { p: "Já uso o CRM da Aceleriq. Muda alguma coisa?", r: "O pedido sai da mesma conta, sem cadastro novo. No plano Pro do CRM, a mensalidade do e-mail já está incluída." },
  ];

  return (
    <div ref={raiz} className="el" data-pagina-de-venda-do-email="">
      <div className="el-cenario" aria-hidden="true">
        <div className="el-grade" />
        <div className="el-brilho el-brilho-a" />
        <div className="el-brilho el-brilho-b" />
      </div>

      <div className="el-barra">
        <nav className="el-barra-dentro" aria-label="Seções da página">
          <MarcaAceleriq altura={22} />
          <span className="el-espaco" />
          <div className="el-barra-links">
            <a href="#como-funciona">Como funciona</a>
            <a href="#inclui">O que inclui</a>
            <a href="#precos">Preços</a>
            <a href="#duvidas">Dúvidas</a>
          </div>
          <Link to={user ? "/app/email" : "/login?next=%2Fapp%2Femail"} className="el-entrar">
            {user ? "Meu painel" : "Entrar"}
          </Link>
          <Link to={destino} className="el-botao el-botao-menor">
            Pedir meu e-mail
          </Link>
        </nav>
      </div>

      <main>
        {/* Atenção: a promessa e a cena do e-mail chegando. */}
        <section className="el-heroi">
          <div className="el-caixa el-heroi-grade">
            <div className="el-entra">
              <span className="el-selo">
                <Wrench size={14} strokeWidth={TRACO} aria-hidden="true" />
                Migração feita pela Aceleriq
              </span>
              {/* Título principal: role=heading nível 1 (a catraca do painel reserva a tag h1 ao cabeçalho do sistema). */}
              <div role="heading" aria-level={1} className="el-h1">
                E-mail com o nome da sua empresa, <em>chegando na caixa de entrada.</em>
              </div>
              <p className="el-sub">{TEXTO.promessa}</p>
              <div className="el-acoes">
                <Pedir para={destino} />
                <a href="#precos" className="el-botao-vazio">
                  Ver os preços
                </a>
              </div>
            </div>

            <div className="el-cena el-entra" style={{ animationDelay: "160ms" }} aria-hidden="true">
              <div className="el-moldura">
                <div className="el-moldura-dentro">
                  <div className="el-janela-topo">
                    <i />
                    <i />
                    <i />
                    <Inbox size={15} strokeWidth={TRACO} />
                    <span>Caixa de entrada do seu cliente</span>
                  </div>
                  <div className="el-janela-corpo">
                    <div className="el-chegada">
                      <span className="el-avatar">M</span>
                      <div className="el-chegada-texto">
                        <strong>Marina, da Sua Empresa</strong>
                        <span className="el-mono">marina@suaempresa.com.br</span>
                        <p>Proposta comercial, conforme combinamos</p>
                      </div>
                      <span className="el-entregue">Entregue</span>
                    </div>
                    <div className="el-linha-velha">
                      <b />
                      <span>
                        <u />
                        <u />
                      </span>
                    </div>
                    <div className="el-linha-velha">
                      <b />
                      <span>
                        <u />
                        <u />
                      </span>
                    </div>
                    <ul className="el-dns">
                      {["MX", "SPF", "DKIM", "DMARC"].map((r) => (
                        <li key={r}>
                          <span className="el-ponto">
                            <span>
                              <Check size={12} strokeWidth={3} />
                            </span>
                          </span>
                          <b>{r}</b>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Interesse: o problema que a pessoa já sente. */}
        <section className="el-secao el-claro">
          <div className="el-caixa">
            <h2 className="el-h2 el-r">O e-mail que você usa hoje está vendendo contra você.</h2>
            <div className="el-problema">
              <div className="el-troca el-r">
                <p className="el-troca-rotulo">Como o cliente vê hoje</p>
                <p className="el-troca-de el-mono">suaempresa.vendas2019@gmail.com</p>
                <div className="el-troca-seta" aria-hidden="true">
                  <ArrowDown size={18} strokeWidth={2} />
                </div>
                <p className="el-troca-rotulo">Como ele passa a ver</p>
                <p className="el-troca-para el-mono">vendas@suaempresa.com.br</p>
              </div>
              <ul className="el-dores">
                {DORES.map((d, i) => (
                  <li key={d.titulo} className="el-r" style={atraso(i * 90)}>
                    <span className="el-dor-icone" aria-hidden="true">
                      <d.icone size={22} strokeWidth={TRACO} />
                    </span>
                    <div>
                      <h3>{d.titulo}</h3>
                      <p>{d.texto}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* Desejo: a migração sem risco, passo a passo. */}
        <section className="el-secao" id="como-funciona">
          <div className="el-caixa el-como">
            <div className="el-como-topo el-r">
              <h2 className="el-h2">
                Você continua trabalhando. <em className="el-quebra">A gente faz a mudança.</em>
              </h2>
              <p className="el-lead">{TEXTO.etapas}</p>
            </div>
            <ol className="el-passos el-r">
              <li className="el-trilho" aria-hidden="true">
                <span />
              </li>
              {PASSOS.map((passo, i) => (
                <li key={passo.titulo} className="el-passo">
                  <span className="el-passo-marca" aria-hidden="true">
                    {i + 1}
                  </span>
                  <h3>{passo.titulo}</h3>
                  <p>{passo.texto}</p>
                  <small>{passo.selo}</small>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="el-secao" id="inclui" style={{ paddingTop: 0 }}>
          <div className="el-caixa">
            <h2 className="el-h2 el-r">Tudo o que um e-mail de empresa precisa ter.</h2>
            <div className="el-bento">
              <div className="el-b-2 el-r">
                <div className="el-moldura el-cartao el-cartao-verde">
                  <div className="el-moldura-dentro">
                    {p ? <span className="el-numero">{p.email_caixas_no_mensal}</span> : <span className="el-cartao-icone"><Inbox size={22} strokeWidth={TRACO} aria-hidden="true" /></span>}
                    <h3>{p ? "caixas na mensalidade" : "Caixas para a equipe"}</h3>
                    <p>{TEXTO.caixas}</p>
                  </div>
                </div>
              </div>
              <div className="el-b-4 el-r" style={atraso(90)}>
                <div className="el-moldura el-cartao">
                  <div className="el-moldura-dentro">
                    <span className="el-cartao-icone">
                      <ShieldCheck size={22} strokeWidth={TRACO} aria-hidden="true" />
                    </span>
                    <h3>Proteção contra spam e falsificação</h3>
                    <p>{TEXTO.protecao}</p>
                    <ul className="el-selos">
                      {["SPF", "DKIM", "DMARC"].map((s) => (
                        <li key={s}>
                          <i aria-hidden="true">
                            <Check size={12} strokeWidth={3} />
                          </i>
                          {s}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
              <div className="el-b-3 el-r">
                <div className="el-moldura el-cartao">
                  <div className="el-moldura-dentro">
                    <span className="el-cartao-icone">
                      <Globe size={22} strokeWidth={TRACO} aria-hidden="true" />
                    </span>
                    <h3>No domínio da sua empresa</h3>
                    <p>{TEXTO.dominio}</p>
                  </div>
                </div>
              </div>
              <div className="el-b-3 el-r" style={atraso(90)}>
                <div className="el-moldura el-cartao">
                  <div className="el-moldura-dentro">
                    <span className="el-cartao-icone">
                      <MonitorSmartphone size={22} strokeWidth={TRACO} aria-hidden="true" />
                    </span>
                    <h3>No webmail, no celular e no computador</h3>
                    <p>A caixa de entrada acompanha a equipe onde ela trabalha.</p>
                    <div className="el-aparelhos" aria-hidden="true">
                      <span>
                        <Globe size={16} strokeWidth={TRACO} />
                        Webmail
                      </span>
                      <span>
                        <Smartphone size={16} strokeWidth={TRACO} />
                        Celular
                      </span>
                      <span>
                        <Laptop size={16} strokeWidth={TRACO} />
                        Computador
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* O preço, lido do banco, com a conta por número de caixas. */}
        <section className="el-secao el-claro" id="precos">
          <div className="el-caixa">
            <h2 className="el-h2 el-r">Quanto custa para a sua equipe.</h2>
            <p className="el-lead el-r">Escolha quantas caixas a empresa precisa. A conta aparece na hora.</p>
            <div className="el-precos el-r" data-precos-do-email-na-venda="">
              <div className="el-calc">
                <p className="el-calc-rotulo" id="rotulo-das-caixas">
                  Caixas de e-mail
                </p>
                <div className="el-passador" role="group" aria-labelledby="rotulo-das-caixas">
                  <button type="button" onClick={() => mudar(caixas - 1)} disabled={caixas <= CAIXAS_MINIMO} aria-label="Menos uma caixa" data-menos-caixa="">
                    <Minus size={20} strokeWidth={2} aria-hidden="true" />
                  </button>
                  <output aria-live="polite" data-caixas-escolhidas="">
                    {caixas}
                  </output>
                  <button type="button" onClick={() => mudar(caixas + 1)} disabled={caixas >= CAIXAS_MAXIMO} aria-label="Mais uma caixa" data-mais-caixa="">
                    <Plus size={20} strokeWidth={2} aria-hidden="true" />
                  </button>
                </div>
                <div className="el-atalhos">
                  {[3, 5, 10, 20].map((n) => (
                    <button key={n} type="button" aria-pressed={caixas === n} onClick={() => mudar(n)}>
                      {n} caixas
                    </button>
                  ))}
                </div>
                {conta && p ? (
                  <ul className="el-conta">
                    <li>
                      <span>Mensalidade, com até {conta.inclusas} caixas</span>
                      <span>{reais(p.email_mensal)}</span>
                    </li>
                    {p.email_caixa_extra > 0 && (
                      <li>
                        <span>{conta.extras > 0 ? `${conta.extras} ${conta.extras === 1 ? "caixa adicional" : "caixas adicionais"}, ${reais(p.email_caixa_extra)} cada` : `Caixa adicional, se precisar`}</span>
                        <span>{conta.extras > 0 ? reais(conta.extras * p.email_caixa_extra) : `${reais(p.email_caixa_extra)} por mês`}</span>
                      </li>
                    )}
                    {conta.migracao > 0 && (
                      <li>
                        <span>Migração, uma única vez</span>
                        <span>{reais(conta.migracao)}</span>
                      </li>
                    )}
                  </ul>
                ) : precos.isLoading ? (
                  <div className="el-conta" style={{ paddingTop: 18 }} aria-label="Carregando os valores">
                    <div className="el-espera" style={{ width: "88%" }} />
                    <div className="el-espera" style={{ width: "64%", marginTop: 14 }} />
                  </div>
                ) : null}
              </div>

              <div className="el-total">
                {conta ? (
                  <>
                    <p className="el-total-rotulo">
                      Por mês, para {conta.caixas} {conta.caixas === 1 ? "caixa" : "caixas"}
                    </p>
                    <span className="el-total-valor" data-mensal-do-email="">
                      {reais(conta.mensal)}
                      <small>por mês</small>
                    </span>
                    {conta.migracao > 0 && (
                      <p className="el-total-linha">
                        <span>Migração feita pela Aceleriq, uma vez</span>
                        <span data-migracao-do-email="">{reais(conta.migracao)}</span>
                      </p>
                    )}
                  </>
                ) : precos.isLoading ? (
                  <>
                    <p className="el-total-rotulo">Calculando</p>
                    <div className="el-espera" style={{ width: "70%", height: 46, marginTop: 10, background: "rgba(255,255,255,.08)" }} />
                  </>
                ) : (
                  <>
                    <p className="el-total-rotulo" data-precos-indisponiveis="">
                      Os valores não carregaram agora
                    </p>
                    <p className="el-total-nota">
                      Você vê a mensalidade e a migração no pedido, antes de confirmar.{" "}
                      <button type="button" onClick={() => void precos.refetch()} style={{ border: 0, background: "none", padding: 0, color: "#00ff6a", font: "inherit", cursor: "pointer", textDecoration: "underline" }}>
                        Tentar de novo
                      </button>
                    </p>
                  </>
                )}
                <Pedir para={destino} cheio>
                  {`Pedir com ${caixas} ${caixas === 1 ? "caixa" : "caixas"}`}
                </Pedir>
                <p className="el-total-nota">{TEXTO.semCobranca}</p>
              </div>
            </div>
            <p className="el-nota-clara el-r">
              Usa o CRM da Aceleriq no plano Pro? A mensalidade do e-mail já está incluída. <Link to="/crm">Conhecer o CRM</Link>
            </p>
          </div>
        </section>

        <section className="el-secao">
          <div className="el-caixa">
            <h2 className="el-h2 el-r">O que costuma travar a decisão.</h2>
            <ul className="el-objecoes">
              {OBJECOES.map((o, i) => (
                <li key={o.pergunta} className="el-r" style={atraso((i % 2) * 90)}>
                  <h3>{o.pergunta}</h3>
                  <p>
                    <b>{o.forte}</b> {o.resposta}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="el-secao el-centro" id="duvidas" style={{ paddingTop: 0 }}>
          <div className="el-caixa">
            <h2 className="el-h2 el-r">Perguntas frequentes</h2>
            <div className="el-duvidas el-r" style={{ textAlign: "left" }}>
              {duvidas.map((d) => (
                <details key={d.p}>
                  <summary>
                    <span>{d.p}</span>
                    <Plus size={20} strokeWidth={TRACO} aria-hidden="true" />
                  </summary>
                  <p>{d.r}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* Ação. */}
        <section className="el-final el-r">
          <h2 className="el-h2">
            Na próxima proposta, assine com <em>o nome da sua empresa.</em>
          </h2>
          <p className="el-lead">Diga o domínio e quantas caixas precisa. A Aceleriq cuida do resto.</p>
          <div className="el-acoes">
            <Pedir para={destino} />
          </div>
        </section>
      </main>

      <footer className="el-caixa el-rodape">
        <MarcaAceleriq altura={20} />
        <span className="el-espaco" />
        <Link to="/crm">CRM</Link>
        <Link to={user ? "/app/email" : "/login?next=%2Fapp%2Femail"}>{user ? "Meu painel" : "Entrar"}</Link>
      </footer>
    </div>
  );
}
