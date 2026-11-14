import { useEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Check, ChevronsLeftRight, Globe, Inbox, Lock, Mail, Minus, MonitorSmartphone, Plus, ShieldAlert, ShieldCheck, Wrench } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { lerPrecos, reais } from "@/lib/produto/api";
import { CAIXAS_MAXIMO, CAIXAS_MINIMO, caixasValidas, contaDoEmail, precosProntos } from "@/lib/produto/venda-email";
import { MarcaAceleriq } from "@/components/publico/CascaPublica";
import fotoDaDona from "@/assets/email/dona.jpg";
import fotoDoDono from "@/assets/email/dono.jpg";
import "./email-landing.css";

/**
 * Página de venda do E-mail profissional (endereço /email), pública.
 * Copy em AIDA: a promessa com gente de verdade, o problema, o e-mail chegando
 * no notebook e no celular, a comparação de arrastar, como a migração acontece,
 * o que vem incluído, o preço lido do banco, as objeções, as dúvidas e a chamada
 * final. O botão leva ao pedido em /email/pedir.
 * Nenhum valor é escrito aqui: tudo vem de produto_precos().
 * As duas fotos são imagens geradas para a página (cenário, não cliente real).
 */

const TRACO = 1.7;
/** Até onde a barra de arrastar das caixas vai; acima disso, o botão de mais. */
const TETO_DA_REGUA = 30;

/**
 * Entrada por rolagem: liga a classe `el-anim` só quando o navegador observa a
 * rolagem. Sem isso, tudo nasce visível (notebook aberto, celular ligado). Quem
 * pede menos movimento recebe a versão suave, definida no CSS.
 */
function useEntradaPorRolagem(raiz: RefObject<HTMLDivElement>) {
  useEffect(() => {
    const el = raiz.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
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

function Pedir({ para, children = "Quero meu e-mail profissional", cheio = false }: { para: string; children?: ReactNode; cheio?: boolean }) {
  return (
    <Link to={para} className={cheio ? "el-botao el-botao-cheio" : "el-botao"} data-pedir-email-profissional="">
      {children}
      <ArrowRight className="el-botao-seta" size={18} strokeWidth={2.4} aria-hidden="true" />
    </Link>
  );
}

const atraso = (ms: number) => ({ transitionDelay: `${ms}ms` });

/** A caixa de entrada que aparece no notebook: só cenário, sem nome de empresa real. */
const CAIXA = [
  { de: "Marina, da Sua Empresa", endereco: "marina@suaempresa.com.br", assunto: "Proposta comercial, conforme combinamos", trecho: "Olá! Segue a proposta com os valores e o prazo que conversamos", hora: "10:24" },
  { de: "Financeiro", endereco: "", assunto: "Nota fiscal de outubro disponível", trecho: "A nota do mês já pode ser baixada pelo portal", hora: "09:12" },
  { de: "Transportadora", endereco: "", assunto: "Seu pedido saiu para entrega", trecho: "Previsão de chegada ainda hoje, em horário comercial", hora: "Ontem" },
  { de: "Contabilidade", endereco: "", assunto: "Documentos do mês", trecho: "Precisamos dos extratos até sexta para fechar o período", hora: "Ontem" },
];

const DORES: Array<{ forte: string; resto: string }> = [
  { forte: "Endereço pessoal", resto: "passa imagem de negócio improvisado" },
  { forte: "A proposta cai no spam", resto: "e o cliente nem fica sabendo" },
  { forte: "O funcionário sai", resto: "e leva junto os contatos e a senha" },
  { forte: "Qualquer um se passa", resto: "pela sua empresa sem você ver" },
];

const PASSOS = [
  { titulo: "Levantamento", texto: "Mapeamos as caixas, o domínio e o que precisa vir junto" },
  { titulo: "Preparo", texto: "Criamos as caixas novas e copiamos o histórico, com o e-mail antigo funcionando" },
  { titulo: "Virada do DNS", texto: "No horário combinado, as mensagens passam a chegar no lugar novo" },
  { titulo: "Conferência", texto: "Cada caixa é testada enviando e recebendo antes de encerrar" },
];

/** O que cada registro de proteção faz, em uma linha. */
const PROTECAO = [
  { sigla: "SPF", faz: "diz quem pode enviar em nome do seu domínio" },
  { sigla: "DKIM", faz: "assina cada mensagem para provar a origem" },
  { sigla: "DMARC", faz: "barra quem tenta se passar pela sua empresa" },
];

const OBJECOES = [
  { pergunta: "“Vou perder meus e-mails antigos”", forte: "Não vai", resposta: "O histórico é copiado para as caixas novas antes da virada" },
  { pergunta: "“Vou ficar sem e-mail no dia da troca”", forte: "Não fica", resposta: "O endereço antigo recebe até a virada e o novo assume em seguida" },
  { pergunta: "“Não entendo nada de DNS”", forte: "Nem precisa", resposta: "A parte técnica é toda da Aceleriq, você só combina o horário" },
  { pergunta: "“Já tentei e deu problema”", forte: "Por isso existe a conferência", resposta: "Cada caixa é testada enviando e recebendo" },
];

/** A copy corrida da página, num lugar só. */
const TEXTO = {
  promessa: "A Aceleriq migra caixas, histórico e DNS para você. Sua equipe não perde mensagem e não fica um dia fora do ar",
  painel: "Cada proposta que sai de um endereço genérico perde força antes de ser lida. Com o nome da empresa depois do @, a mesma mensagem chega com cara de empresa séria",
  aparelhos: "No computador, no celular e no webmail. A mensagem sai com o nome da sua empresa e chega na caixa de entrada de quem importa",
  compara: "A mesma proposta, enviada dos dois jeitos. Arraste a barra para comparar",
  caixas: "Uma para cada pessoa ou setor: vendas, financeiro, contato. Precisou de mais, é só pedir",
  protecao: "Configuramos os três registros que provam que a mensagem saiu mesmo da sua empresa",
  dominio: "O endereço termina com o nome do seu negócio, e as contas ficam no nome da empresa. Se ainda não tem domínio, diga no pedido",
  aparelho: "A caixa de entrada acompanha a equipe no webmail, no celular e no computador",
  semCobranca: "Enviar o pedido não gera cobrança. A Aceleriq confirma os detalhes com você antes",
};

export default function EmailLanding() {
  const { user } = useAuth();
  const raiz = useRef<HTMLDivElement>(null);
  useEntradaPorRolagem(raiz);

  const precos = useQuery({ queryKey: ["produto", "precos", "venda-email"], queryFn: lerPrecos, staleTime: 300_000, retry: 1 });
  const p = precosProntos(precos.data) ? precos.data : null;
  const [caixas, setCaixas] = useState(5);
  const [corte, setCorte] = useState(50);
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
  const naRegua = Math.min(TETO_DA_REGUA, caixas);
  const parteDaRegua = { "--el-parte": `${Math.round(((naRegua - 1) / (TETO_DA_REGUA - 1)) * 100)}%` } as CSSProperties;

  useEffect(() => {
    const antes = document.title;
    document.title = "E-mail profissional com migração feita | Aceleriq";
    return () => {
      document.title = antes;
    };
  }, []);

  const duvidas: Array<{ p: string; r: string }> = [
    { p: "Quanto tempo leva a migração?", r: "Depende de quantas caixas existem e do tamanho do histórico. No levantamento você recebe a previsão antes de começar" },
    { p: "Preciso trocar o meu endereço de e-mail?", r: "Se a empresa já usa o próprio domínio, os endereços continuam os mesmos. Se hoje é um e-mail pessoal, cada pessoa ganha o endereço novo com o nome da empresa" },
    { p: "De quem é a conta do e-mail?", r: "Da sua empresa. As contas ficam no nome dela e a Aceleriq cuida da configuração e da migração" },
    { p: "Funciona no celular?", r: "Sim. O e-mail abre no webmail, no celular e no computador" },
    {
      p: "Posso pedir mais caixas depois?",
      r: p && p.email_caixa_extra > 0 ? `Sim. Você pede pelo painel e cada caixa adicional soma ${reais(p.email_caixa_extra)} à mensalidade` : "Sim. Você pede pelo painel e a Aceleriq cria a caixa",
    },
    { p: "Quando eu pago?", r: "Enviar o pedido não gera cobrança. A Aceleriq confirma o domínio e as caixas com você, e só então combina a migração e a mensalidade" },
    { p: "Já uso o CRM da Aceleriq, muda alguma coisa?", r: "O pedido sai da mesma conta, sem cadastro novo. No plano Pro do CRM, a mensalidade do e-mail já está incluída" },
  ];

  return (
    <div ref={raiz} className="el" data-pagina-de-venda-do-email="">
      <div className="el-cenario" aria-hidden="true">
        <div className="el-grade" />
        <div className="el-brilho el-brilho-a" />
        <div className="el-brilho el-brilho-b" />
        {[
          [1120, 280],
          [1120, 1680],
          [280, 2800],
          [840, 3920],
          [1120, 5040],
          [280, 6160],
          [840, 7280],
        ].map(([left, top], i) => (
          <div key={top} className="el-cruz" style={{ left, top, animationDelay: `${i * 0.7}s` }} />
        ))}
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
            Pedir agora
          </Link>
        </nav>
      </div>

      <main>
        {/* Atenção: a promessa, com gente de verdade e o e-mail chegando. */}
        <section className="el-heroi">
          <div className="el-caixa el-heroi-grade">
            <div className="el-heroi-texto el-entra">
              <h1 className="el-h1">
                E-mail com o nome da sua empresa, <em>chegando na caixa de entrada</em>
              </h1>
              <p className="el-sub">{TEXTO.promessa}</p>
              <div className="el-acoes">
                <Pedir para={destino} />
                <a href="#precos" className="el-botao-vazio">
                  Ver os preços
                </a>
              </div>
              <ul className="el-garantias">
                {["Migração feita por nós", "Sem ficar fora do ar", "Sem cobrança no pedido"].map((g) => (
                  <li key={g}>
                    <Check size={16} strokeWidth={2.6} aria-hidden="true" />
                    {g}
                  </li>
                ))}
              </ul>
            </div>

            <div className="el-pessoa el-entra" style={{ animationDelay: "180ms" }}>
              <div className="el-pessoa-luz" aria-hidden="true" />
              <img className="el-pessoa-foto" src={fotoDaDona} width={900} height={958} alt="Dona de empresa sorrindo com o celular na mão" />
              <div className="el-flutua-1 el-aviso" aria-hidden="true">
                <span className="el-aviso-icone">
                  <Mail size={18} strokeWidth={TRACO} />
                </span>
                <div>
                  <strong>marina@suaempresa.com.br</strong>
                  <span>Proposta comercial enviada</span>
                </div>
                <time>agora</time>
              </div>
              <div className="el-flutua-2 el-selo-ok" aria-hidden="true">
                <i>
                  <Check size={15} strokeWidth={3} />
                </i>
                Entregue na caixa de entrada
              </div>
            </div>
          </div>
        </section>

        {/* Interesse: o problema que a pessoa já sente, no painel claro que invade o herói. */}
        <section className="el-painel el-r">
          <div className="el-painel-grade">
            <div>
              <h2 className="el-h2">
                Por que o e-mail que você usa hoje <em>ainda custa vendas?</em>
              </h2>
              <p>{TEXTO.painel}</p>
              <div className="el-troca el-mono">
                <span className="el-troca-de">suaempresa.vendas2019@gmail.com</span>
                <span className="el-troca-para">vendas@suaempresa.com.br</span>
              </div>
              <Pedir para={destino}>Quero resolver isso</Pedir>
            </div>
            <div className="el-vidro">
              <ul className="el-barras">
                {DORES.map((d) => (
                  <li key={d.forte}>
                    <i aria-hidden="true">
                      <ArrowRight size={15} strokeWidth={2.6} />
                    </i>
                    <span>
                      <b>{d.forte}</b> {d.resto}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* Desejo: o notebook abre, a tela acende, o celular liga e o aviso chega. */}
        <section className="el-secao el-centro">
          <div className="el-caixa">
            <h2 className="el-h2 el-r">
              Veja o seu e-mail chegando <em>como o de uma grande empresa</em>
            </h2>
            <p className="el-lead el-r">{TEXTO.aparelhos}</p>
            <div className="el-aparelhos el-r" aria-hidden="true" style={{ textAlign: "left" }}>
              <div className="el-note">
                <div className="el-note-tampa">
                  <div className="el-note-tela">
                    <div className="el-tela-topo">
                      <i />
                      <i />
                      <i />
                      <span className="el-tela-endereco">Caixa de entrada</span>
                    </div>
                    <div className="el-tela-corpo">
                      <div className="el-tela-lado">
                        <b>
                          Entrada <em>3</em>
                        </b>
                        <span>Enviados</span>
                        <span>Rascunhos</span>
                        <span>Arquivo</span>
                      </div>
                      <div className="el-tela-lista">
                        {CAIXA.map((m, i) => (
                          <div key={m.de} className={i === 0 ? "el-msg el-msg-nova" : i > 1 ? "el-msg el-msg-mobile-some" : "el-msg"}>
                            <span className="el-msg-avatar">{m.de.charAt(0)}</span>
                            <div className="el-msg-texto">
                              <strong>{m.de}</strong>
                              {m.endereco && <span className="el-msg-endereco">{m.endereco}</span>}
                              <span className="el-msg-assunto">{m.assunto}</span>
                              <span className="el-msg-trecho">{m.trecho}</span>
                            </div>
                            <time>{m.hora}</time>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
                <div className="el-note-base" />
              </div>
              <div className="el-fone">
                <div className="el-fone-tela">
                  <div className="el-fone-luz" />
                  <div className="el-fone-hora">
                    10:24
                    <small>sexta-feira</small>
                  </div>
                  <div className="el-fone-aviso">
                    <em>E-mail · agora</em>
                    <b>Marina, da Sua Empresa</b>
                    <span>Proposta comercial, conforme combinamos</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* A comparação de arrastar: a mesma proposta, dos dois jeitos. */}
        <section className="el-secao el-centro" style={{ paddingTop: 0 }}>
          <div className="el-caixa">
            <h2 className="el-h2 el-r">
              Arraste e veja <em>a diferença</em>
            </h2>
            <p className="el-lead el-r">{TEXTO.compara}</p>
            <div className="el-compara el-r" style={{ textAlign: "left" }} data-comparacao-de-arrastar="">
              <div className="el-lado el-lado-depois">
                <span className="el-lado-rotulo">Com e-mail profissional</span>
                <div className="el-carta">
                  <div className="el-carta-topo">
                    <span className="el-msg-avatar">M</span>
                    <div>
                      <strong>Marina, da Sua Empresa</strong>
                      <span className="el-mono">vendas@suaempresa.com.br</span>
                    </div>
                  </div>
                  <h3>Proposta comercial</h3>
                  <p>Olá! Segue a proposta com os valores e o prazo que conversamos</p>
                  <div className="el-carta-nota el-nota-boa">
                    <ShieldCheck size={18} strokeWidth={TRACO} aria-hidden="true" />
                    Remetente verificado, na caixa de entrada
                  </div>
                </div>
              </div>
              <div className="el-lado-antes" style={{ width: `${corte}%` }} aria-hidden="true">
                <div className="el-lado" style={{ width: `${10000 / corte}%` }}>
                  <span className="el-lado-rotulo">Hoje</span>
                  <div className="el-carta">
                    <div className="el-carta-topo">
                      <span className="el-msg-avatar">?</span>
                      <div>
                        <strong>suaempresa.vendas2019</strong>
                        <span className="el-mono">suaempresa.vendas2019@gmail.com</span>
                      </div>
                    </div>
                    <h3>Proposta comercial</h3>
                    <p>Olá! Segue a proposta com os valores e o prazo que conversamos</p>
                    <div className="el-carta-nota el-nota-ruim">
                      <ShieldAlert size={18} strokeWidth={TRACO} aria-hidden="true" />
                      Remetente não verificado, na pasta de spam
                    </div>
                  </div>
                </div>
              </div>
              <span className="el-puxador" style={{ left: `${corte}%` }} aria-hidden="true">
                <ChevronsLeftRight size={22} strokeWidth={2.2} />
              </span>
              <input
                type="range"
                min={6}
                max={94}
                value={corte}
                onChange={(e) => setCorte(Math.max(6, Math.min(94, Number(e.target.value) || 50)))}
                aria-label="Arraste para comparar o e-mail de hoje com o e-mail profissional"
                data-barra-de-comparar=""
              />
            </div>
            <p className="el-dica">Arraste a barra verde para os lados</p>
          </div>
        </section>

        {/* A migração sem risco, com gente. */}
        <section className="el-secao" id="como-funciona" style={{ paddingTop: 0 }}>
          <div className="el-caixa">
            <h2 className="el-h2 el-r">
              Você continua trabalhando, <em>a gente faz a mudança</em>
            </h2>
            <div className="el-como">
              <div className="el-retrato el-r">
                <img src={fotoDoDono} width={1280} height={853} loading="lazy" alt="Dono de empresa trabalhando no notebook" />
                <div className="el-aviso" aria-hidden="true">
                  <span className="el-aviso-icone">
                    <Check size={18} strokeWidth={2.6} />
                  </span>
                  <div>
                    <strong>Migração concluída</strong>
                    <span>Todas as caixas testadas</span>
                  </div>
                </div>
              </div>
              <div className="el-r" style={atraso(120)}>
                <ol className="el-passos">
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
                    </li>
                  ))}
                </ol>
                <div className="el-resultado">
                  <i aria-hidden="true">
                    <Check size={16} strokeWidth={3} />
                  </i>
                  <span>Resultado: e-mail novo no ar, sem perder mensagem e sem parar a equipe</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="el-secao" id="inclui" style={{ paddingTop: 0 }}>
          <div className="el-caixa">
            <h2 className="el-h2 el-r">
              Tudo o que um e-mail de empresa <em>precisa ter</em>
            </h2>
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
                    <ul className="el-checagens">
                      {PROTECAO.map((r) => (
                        <li key={r.sigla}>
                          <i aria-hidden="true">
                            <Check size={12} strokeWidth={3} />
                          </i>
                          <span>
                            <b>{r.sigla}</b> {r.faz}
                          </span>
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
                    <p>{TEXTO.aparelho}</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="el-secao el-centro" style={{ paddingTop: 0 }}>
          <div className="el-caixa">
            <h2 className="el-h2 el-r">
              Objeções? <em>Vamos direto ao ponto</em>
            </h2>
            <ul className="el-objecoes" style={{ textAlign: "left" }}>
              {OBJECOES.map((o, i) => (
                <li key={o.pergunta} className={i === 1 ? "el-r el-acesa" : "el-r"} style={atraso(i * 80)}>
                  <i aria-hidden="true" />
                  <h3>{o.pergunta}</h3>
                  <p>
                    <b>{o.forte}.</b> {o.resposta}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* O preço, lido do banco, com a barra de arrastar das caixas. */}
        <section className="el-oferta el-r" id="precos">
          <div className="el-oferta-grade">
            <div>
              <h2 className="el-h2">
                O e-mail completo para <em>a sua equipe vender mais</em>
              </h2>
              <p className="el-lead">Arraste a barra e escolha quantas caixas a empresa precisa. A conta aparece na hora</p>
              <ul className="el-barras el-barras-escuras">
                {[
                  ["Migração feita", "pela Aceleriq, do começo ao fim"],
                  [p ? `Até ${p.email_caixas_no_mensal} caixas` : "Caixas da equipe", "já na mensalidade"],
                  ["SPF, DKIM e DMARC", "configurados e conferidos"],
                  ["Contas no nome", "da sua empresa"],
                ].map(([forte, resto]) => (
                  <li key={forte}>
                    <i aria-hidden="true">
                      <Check size={15} strokeWidth={3} />
                    </i>
                    <span>
                      <b>{forte}</b> {resto}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="el-nota-clara">
                Usa o CRM da Aceleriq no plano Pro? A mensalidade do e-mail já está incluída. <Link to="/crm">Conhecer o CRM</Link>
              </p>
            </div>

            <div className="el-total" data-precos-do-email-na-venda="">
              <div className="el-total-marca">E-mail profissional Aceleriq</div>
              <div className="el-total-escuro">
                {conta && p ? (
                  <>
                    <p className="el-total-rotulo">
                      Para {conta.caixas} {conta.caixas === 1 ? "caixa" : "caixas"}
                    </p>
                    <span className="el-total-valor" data-mensal-do-email="">
                      {reais(conta.mensal)}
                      <small>por mês</small>
                    </span>
                    {conta.migracao > 0 && (
                      <p className="el-total-linha">
                        <span>Migração, uma única vez: </span>
                        <span data-migracao-do-email="">{reais(conta.migracao)}</span>
                      </p>
                    )}
                  </>
                ) : precos.isLoading ? (
                  <>
                    <p className="el-total-rotulo">Calculando</p>
                    <div className="el-espera" style={{ width: "70%", height: 52, margin: "10px auto 0" }} />
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

                <div className="el-quantas">
                  <div className="el-quantas-topo">
                    <span id="rotulo-das-caixas">Caixas de e-mail</span>
                    <span className="el-espaco" />
                    <div className="el-passador" role="group" aria-labelledby="rotulo-das-caixas">
                      <button type="button" onClick={() => mudar(caixas - 1)} disabled={caixas <= CAIXAS_MINIMO} aria-label="Menos uma caixa" data-menos-caixa="">
                        <Minus size={16} strokeWidth={2.4} aria-hidden="true" />
                      </button>
                      <output aria-live="polite" data-caixas-escolhidas="">
                        {caixas}
                      </output>
                      <button type="button" onClick={() => mudar(caixas + 1)} disabled={caixas >= CAIXAS_MAXIMO} aria-label="Mais uma caixa" data-mais-caixa="">
                        <Plus size={16} strokeWidth={2.4} aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                  <input
                    className="el-regua"
                    type="range"
                    min={CAIXAS_MINIMO}
                    max={TETO_DA_REGUA}
                    value={naRegua}
                    onChange={(e) => mudar(Number(e.target.value))}
                    style={parteDaRegua}
                    aria-labelledby="rotulo-das-caixas"
                    data-regua-das-caixas=""
                  />
                  {conta && p && (
                    <ul className="el-conta">
                      <li>
                        <span>Mensalidade, com até {conta.inclusas} caixas</span>
                        <span>{reais(p.email_mensal)}</span>
                      </li>
                      {p.email_caixa_extra > 0 && (
                        <li>
                          <span>{conta.extras > 0 ? `${conta.extras} ${conta.extras === 1 ? "caixa adicional" : "caixas adicionais"}, ${reais(p.email_caixa_extra)} cada` : "Caixa adicional, se precisar"}</span>
                          <span>{conta.extras > 0 ? reais(conta.extras * p.email_caixa_extra) : `${reais(p.email_caixa_extra)} por mês`}</span>
                        </li>
                      )}
                    </ul>
                  )}
                </div>

                <Pedir para={destino} cheio>
                  {`Pedir com ${caixas} ${caixas === 1 ? "caixa" : "caixas"}`}
                </Pedir>
                <p className="el-total-nota">{TEXTO.semCobranca}</p>
              </div>
              <ul className="el-confianca">
                <li>
                  <Lock size={15} strokeWidth={2} aria-hidden="true" />
                  Sem cobrança no pedido
                </li>
                <li>
                  <Wrench size={15} strokeWidth={2} aria-hidden="true" />
                  Migração feita por nós
                </li>
              </ul>
            </div>
          </div>
        </section>

        <section className="el-secao" id="duvidas">
          <div className="el-caixa el-faq">
            <h2 className="el-h2 el-r">
              Perguntas <em>frequentes</em>
            </h2>
            <div className="el-duvidas el-r">
              {duvidas.map((d, i) => (
                <details key={d.p} open={i === 0}>
                  <summary>
                    <span>{d.p}</span>
                    <Plus size={24} strokeWidth={2.4} aria-hidden="true" />
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
            Na próxima proposta, assine com <em>o nome da sua empresa</em>
          </h2>
          <p className="el-lead">Diga o domínio e quantas caixas precisa. A Aceleriq cuida do resto</p>
          <div className="el-acoes">
            <Pedir para={destino} />
          </div>
        </section>
      </main>

      <footer className="el-rodape">
        <MarcaAceleriq altura={20} />
        <span className="el-espaco" />
        <Link to="/crm">CRM</Link>
        <Link to={user ? "/app/email" : "/login?next=%2Fapp%2Femail"}>{user ? "Meu painel" : "Entrar"}</Link>
      </footer>
    </div>
  );
}
