import { useEffect, useState, type CSSProperties } from "react";
import { Link, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Bot, Check, FileText, Link2, Minus, Plus, Radar, SlidersHorizontal, Trophy, Users, Zap } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { lerPrecos, listarPlanos, reais } from "@/lib/produto/api";
import { ETAPAS_DO_FUNIL, NICHOS, NOME_PADRAO_DA_ETAPA, type EtapaId } from "@/lib/produto/nichos";
import { enderecoDeCompra, usuariosValidos } from "@/lib/produto/venda";
import { MarcaAceleriq } from "@/components/publico/CascaPublica";
import { Revela, TelaDaAgenda, TelaDoFunil, TelaDoPainel, TelaDoRanking } from "@/components/venda/Cenas";
import "@/components/venda/venda.css";

/**
 * A página de venda do CRM (endereço /crm), pronta para receber tráfego.
 * Ordem da conversa: promessa, problema, o produto funcionando, recursos, para
 * quem é, preço, objeções, perguntas e a chamada final. Os preços e os dias de
 * teste vêm do banco. Nenhuma prova inventada: o que convence é o
 * produto e o teste. Cada botão de plano leva a escolha para o cadastro
 * (/crm/comecar), que termina no teste ou no checkout, conforme a cobrança
 * esteja desligada ou ligada.
 */

const COMECAR = "/crm/comecar";

/** A copy longa fica aqui, fora da tela, para ser editada num lugar só. */
const COPY = {
  heroi: "O CRM da Aceleriq põe cada negócio num funil que você enxerga, avisa a hora de cada retorno e mostra quem da equipe está vendendo. Já chega montado para o seu ramo.",
  produto: "Três telas que o seu time abre todo dia. O que aparece aqui é demonstração, com dados de exemplo.",
  retornos: "Todo negócio aberto tem um próximo passo com dia e hora. Você abre o CRM de manhã e já sabe para quem ligar.",
  painel: "Quanto já entrou, quanto falta para a meta e em que etapa o dinheiro está parado. Sem pedir relatório para ninguém.",
  ranking: "O ranking muda a cada negócio fechado. O gerente vê quem precisa de ajuda e repassa contatos para quem tem espaço.",
  semPrecos: "Não consegui carregar os preços agora. Você pode começar mesmo assim e escolher o plano no cadastro.",
};

const COR_DA_ETAPA: Record<EtapaId, string> = {
  novo: "var(--vd-azul)",
  contato: "var(--vd-ambar)",
  diagnostico: "#5fd4ff",
  proposta: "var(--vd-violeta)",
  negociacao: "var(--vd-rosa)",
  ganho: "var(--vd-verde)",
  perdido: "#77837c",
};

const DORES = [
  { n: "01", titulo: "A conversa desce no WhatsApp", linha: "O cliente pediu o orçamento na terça. Na sexta, a conversa já está vinte telas abaixo e ninguém lembrou de voltar." },
  { n: "02", titulo: "A planilha parou no mês passado", linha: "Cada vendedor preenche de um jeito, quando preenche. Na reunião, ninguém confia no número." },
  { n: "03", titulo: "Você só descobre no fim do mês", linha: "Quem vendeu, quem está parado, quanto tem para fechar. Tudo chega tarde demais para mudar o resultado." },
];

const RECURSOS = [
  { icone: Users, titulo: "Equipe com hierarquia", linha: "Administrador, gerente e vendedor. Cada um vê o que precisa, e o gerente repassa contatos sem sair da tela." },
  { icone: Trophy, titulo: "Ranking de vendedores", linha: "Quem vendeu mais, quem está parado, quem precisa de ajuda. Atualiza a cada negócio fechado." },
  { icone: Radar, titulo: "Máquina de leads", linha: "Diga o ramo e a cidade. Ela devolve empresas com o contato, prontas para entrar no funil." },
  { icone: Link2, titulo: "Captação com rastreamento", linha: "Um link de captação seu. Cada contato chega com a origem do anúncio (UTM), e o Pixel da Meta marca a conversão." },
  { icone: SlidersHorizontal, titulo: "Campos do seu ramo", linha: "Consórcio pede carta e grupo. Imobiliária pede imóvel e visita. O CRM já chega com os campos certos." },
  { icone: FileText, titulo: "Páginas internas", linha: "Roteiro de venda, tabela de preços, processo da equipe. Escrito dentro do CRM, ao lado do negócio." },
];

const OBJECOES = (dias: number | null) => [
  { titulo: "Minha equipe não vai usar.", linha: "Usa, porque dá menos trabalho que a planilha: arrasta o cartão e pronto. E o ranking faz o resto, porque ninguém quer aparecer em último." },
  { titulo: "Já tentei CRM e era complicado.", linha: "Este abre com o funil do seu ramo montado. Você diz o ramo, o nome da empresa e já cadastra o primeiro negócio." },
  { titulo: "Não tenho tempo para implantar.", linha: "Não tem implantação. O cadastro tem três passos e a equipe entra por convite no e-mail." },
  { titulo: "E se eu não gostar?", linha: `${dias ? `Você testa por ${dias} dias antes de decidir. ` : ""}Não tem fidelidade nem multa: cancela na própria tela, quando quiser. E os seus dados não são apagados.` },
];

const PERGUNTAS = (dias: number | null, cobranca: boolean) => [
  cobranca
    ? { p: "Como é o pagamento?", r: "No cartão de crédito, todo mês, pelo checkout do Asaas. O número do cartão não passa pelo nosso servidor. O acesso libera assim que o pagamento confirma." }
    : { p: "Preciso de cartão para testar?", r: `Não. ${dias ? `O teste de ${dias} dias` : "O teste"} começa só com nome, e-mail e senha. Você só informa o pagamento se decidir assinar.` },
  { p: "Como funciona o preço?", r: "Você paga por usuário, por mês. Entrou gente na equipe, aumenta. Saiu, diminui. O valor acompanha." },
  { p: "Tem fidelidade ou multa?", r: "Não. Você cancela quando quiser, na tela da conta, e usa até o fim do período já pago." },
  { p: "O que acontece quando o teste acaba?", r: "Você escolhe o plano e assina. Se não assinar, o acesso pausa e os dados ficam guardados para quando você voltar." },
  { p: "Funciona no celular?", r: "Sim. Abre no navegador do celular e do computador, sem instalar nada." },
  { p: "Meus dados ficam seguros?", r: "Cada empresa enxerga só os próprios dados. Nem a Aceleriq lê o seu CRM: vemos apenas contagens de uso." },
  { p: "Posso mudar de plano depois?", r: "Pode. Plano e número de usuários mudam na tela da conta, sem falar com ninguém." },
  { p: "Como conecto o Claude ou o ChatGPT?", r: "Na conta, em Conexões, você cria uma chave e cola o endereço no assistente. Ele passa a ler o funil, criar e mover negócios e marcar compromissos. Nenhuma ferramenta apaga dados." },
];

export default function ProdutoLanding() {
  const { user } = useAuth();
  const { search } = useLocation();
  const planos = useQuery({ queryKey: ["produto", "planos", "venda"], queryFn: () => listarPlanos(), staleTime: 300_000, retry: 1 });
  const precos = useQuery({ queryKey: ["produto", "precos", "venda"], queryFn: () => lerPrecos(), staleTime: 300_000, retry: 1 });
  const [usuarios, setUsuarios] = useState(3);
  const [ramo, setRamo] = useState(NICHOS[0].id);
  const [rolou, setRolou] = useState(false);

  const lista = planos.data || [];
  const cobranca = !!(precos.data && precos.data.pagamentos_ativos);
  const dias = precos.data && precos.data.teste_dias > 0 ? precos.data.teste_dias : null;
  const menorPreco = lista.length ? lista.reduce((m, p) => Math.min(m, p.preco_usuario), lista[0].preco_usuario) : null;
  const primeiro = lista[0] || null;

  useEffect(() => {
    const antes = document.title;
    document.title = "CRM de vendas para pequenas e médias empresas | Aceleriq";
    return () => {
      document.title = antes;
    };
  }, []);

  useEffect(() => {
    const ver = () => setRolou(window.pageYOffset > 560);
    ver();
    window.addEventListener("scroll", ver, { passive: true });
    return () => window.removeEventListener("scroll", ver);
  }, []);

  const comprar = (plano: string, n: number) => (user ? "/app" : enderecoDeCompra({ plano, usuarios: n }, search));
  const principal = user ? "/app" : primeiro ? comprar(primeiro.id, primeiro.minimo_usuarios) : COMECAR;
  const chamada = user ? "Abrir o meu CRM" : cobranca ? "Assinar agora" : dias ? `Testar ${dias} dias grátis` : "Começar o teste grátis";
  const garantias = cobranca
    ? ["Sem fidelidade", "Cancele quando quiser", "Acesso liberado na hora"]
    : ["Sem cartão para testar", "Sem fidelidade", menorPreco ? `A partir de ${reais(menorPreco)} por usuário` : "Pronto em minutos"];

  const nicho = NICHOS.filter((n) => n.id === ramo)[0] || NICHOS[0];
  const etapasDoRamo = ETAPAS_DO_FUNIL.filter((id) => id !== "perdido").map((id) => ({ id, nome: nicho.etapas[id] || NOME_PADRAO_DA_ETAPA[id] }));

  return (
    <div className="vd" data-pagina-de-venda="" data-cobranca={cobranca ? "ligada" : "desligada"}>
      <header className="vd-topo">
        <div className="vd-dentro vd-topo-linha">
          <Link to="/crm" aria-label="Aceleriq CRM"><MarcaAceleriq altura={22} /></Link>
          <nav className="vd-topo-elos" aria-label="Seções">
            <a href="#produto">Produto</a>
            <a href="#recursos">Recursos</a>
            <a href="#precos">Preços</a>
            <a href="#duvidas">Dúvidas</a>
          </nav>
          <span className="vd-vao" />
          {!user && <Link to="/login?next=%2Fapp" className="vd-topo-entrar">Entrar</Link>}
          <Link to={principal} className="vd-botao vd-botao-p" data-comecar="topo">{user ? "Abrir o CRM" : cobranca ? "Assinar" : "Testar grátis"}</Link>
        </div>
      </header>

      <main>
        <section className="vd-heroi">
          <div className="vd-grade" aria-hidden="true" />
          <div className="vd-aurora" aria-hidden="true" />
          <div className="vd-aurora vd-aurora-2" aria-hidden="true" />
          <div className="vd-dentro">
            <div className="vd-heroi-texto">
              <Revela><span className="vd-selo"><i />CRM de vendas para pequenas e médias empresas</span></Revela>
              <Revela atraso={1} como="h1" className="vd-h1">Sua próxima venda está <em>esquecida no WhatsApp.</em></Revela>
              <Revela atraso={2}>
                <p className="vd-heroi-linha">{COPY.heroi}</p>
              </Revela>
              <Revela atraso={3}>
                <div className="vd-heroi-acoes">
                  <Link to={principal} className="vd-botao" data-comecar="heroi">{chamada}<ArrowRight aria-hidden="true" /></Link>
                  <a href="#precos" className="vd-fantasma">Ver os preços</a>
                </div>
                <ul className="vd-garantias">
                  {garantias.map((g) => (
                    <li key={g}><Check aria-hidden="true" />{g}</li>
                  ))}
                </ul>
              </Revela>
            </div>
            <div className="vd-palco">
              <TelaDoFunil />
            </div>
          </div>
        </section>

        <section className="vd-secao vd-secao-clara">
          <div className="vd-dentro">
            <Revela>
              <span className="vd-olho">O problema</span>
              <h2 className="vd-h2">A venda não some de uma vez. Ela <em>vai sumindo.</em></h2>
            </Revela>
            <div className="vd-dores">
              {DORES.map((d, i) => (
                <Revela key={d.n} atraso={(i + 1) as 1 | 2 | 3} className="vd-dor">
                  <b>{d.n}</b>
                  <h3>{d.titulo}</h3>
                  <p>{d.linha}</p>
                </Revela>
              ))}
            </div>
            <Revela><p className="vd-virada">Não falta cliente. Falta um lugar onde nenhum deles fica para trás.</p></Revela>
          </div>
        </section>

        <section className="vd-secao" id="produto">
          <div className="vd-dentro">
            <Revela className="vd-centro">
              <span className="vd-olho">O produto</span>
              <h2 className="vd-h2">Veja a venda <em>andar.</em></h2>
              <p className="vd-sub">{COPY.produto}</p>
            </Revela>

            <div className="vd-cena">
              <Revela className="vd-cena-texto">
                <span className="vd-numero-da-cena">01 · Retornos</span>
                <h3>Nenhum cliente fica sem resposta.</h3>
                <p>{COPY.retornos}</p>
                <ul className="vd-pontos">
                  <li><Check aria-hidden="true" />Próximo passo marcado em todo negócio aberto</li>
                  <li><Check aria-hidden="true" />Lembrete antes do retorno vencer</li>
                  <li><Check aria-hidden="true" />A história de cada cliente guardada na ficha</li>
                </ul>
              </Revela>
              <TelaDaAgenda />
            </div>

            <div className="vd-cena vd-cena-invertida">
              <Revela className="vd-cena-texto">
                <span className="vd-numero-da-cena">02 · Painel</span>
                <h3>O mês inteiro numa tela.</h3>
                <p>{COPY.painel}</p>
                <ul className="vd-pontos">
                  <li><Check aria-hidden="true" />Funil colorido, etapa por etapa</li>
                  <li><Check aria-hidden="true" />Gráfico das vendas no tempo</li>
                  <li><Check aria-hidden="true" />Meta do mês e quanto já saiu</li>
                </ul>
              </Revela>
              <TelaDoPainel />
            </div>

            <div className="vd-cena">
              <Revela className="vd-cena-texto">
                <span className="vd-numero-da-cena">03 · Ranking</span>
                <h3>Todo mundo sabe quem está vendendo.</h3>
                <p>{COPY.ranking}</p>
                <ul className="vd-pontos">
                  <li><Check aria-hidden="true" />Administrador, gerente e vendedor, cada um com a sua visão</li>
                  <li><Check aria-hidden="true" />Repasse de contatos entre a equipe</li>
                  <li><Check aria-hidden="true" />No Pro, cada vendedor vê só os próprios negócios</li>
                </ul>
              </Revela>
              <TelaDoRanking />
            </div>
          </div>
        </section>

        <section className="vd-secao vd-secao-2" id="recursos">
          <div className="vd-dentro">
            <Revela>
              <span className="vd-olho">Recursos</span>
              <h2 className="vd-h2">Tudo o que uma equipe de vendas precisa. <em>Nada que ela não usa.</em></h2>
            </Revela>
            <div className="vd-recursos">
              <Revela className="vd-recurso vd-recurso-largo">
                <span className="vd-icone"><Zap aria-hidden="true" /></span>
                <h3>Automações prontas</h3>
                <p>Você liga, não programa. O trabalho repetido acontece sozinho.</p>
                <div className="vd-fichas">
                  <span className="vd-ficha">Lead novo</span><span className="vd-ficha vd-ficha-verde">ganha dono e próximo passo</span>
                  <span className="vd-ficha">Negócio parado</span><span className="vd-ficha vd-ficha-verde">vira lembrete</span>
                  <span className="vd-ficha">Proposta enviada</span><span className="vd-ficha vd-ficha-verde">marca o retorno</span>
                </div>
              </Revela>
              <Revela atraso={1} className="vd-recurso vd-recurso-largo">
                <span className="vd-icone"><Bot aria-hidden="true" /></span>
                <h3>Claude e ChatGPT dentro do seu CRM</h3>
                <p>Conecte o assistente e peça em português. Para o resto, tem API.</p>
                <p className="vd-fala">Mova a Clínica Vida para Proposta e marque o retorno para quinta, às 10h.</p>
                <p className="vd-fala">Pronto. Negócio em Proposta e retorno marcado para quinta, 10h.</p>
              </Revela>
              {RECURSOS.map((r, i) => (
                <Revela key={r.titulo} atraso={((i % 3) + 1) as 1 | 2 | 3} className="vd-recurso">
                  <span className="vd-icone"><r.icone aria-hidden="true" /></span>
                  <h3>{r.titulo}</h3>
                  <p>{r.linha}</p>
                </Revela>
              ))}
            </div>
          </div>
        </section>

        <section className="vd-secao vd-secao-clara" id="ramos">
          <div className="vd-dentro">
            <Revela>
              <span className="vd-olho">Para quem é</span>
              <h2 className="vd-h2">Feito para o <em>seu ramo.</em> Não para todos de uma vez.</h2>
              <p className="vd-sub">Toque no seu ramo e veja o funil que já vem montado. Você troca qualquer nome depois.</p>
            </Revela>
            <Revela atraso={1}>
              <div className="vd-ramos" role="group" aria-label="Ramo da empresa">
                {NICHOS.map((n) => (
                  <button key={n.id} type="button" className="vd-ramo" aria-pressed={n.id === nicho.id} onClick={() => setRamo(n.id)} data-ramo={n.id}>{n.nome}</button>
                ))}
              </div>
              <div className="vd-ramo-quadro" aria-live="polite">
                <p><strong>{nicho.nome}.</strong> {nicho.exemplo}. O funil chega assim:</p>
                <ol className="vd-trilha" key={nicho.id}>
                  {etapasDoRamo.map((e) => (
                    <li key={e.id} style={{ "--cor": COR_DA_ETAPA[e.id] } as CSSProperties}><i />{e.nome}</li>
                  ))}
                </ol>
                <p style={{ marginTop: 16 }}>Na Máquina de leads, a busca sugerida para este ramo: <strong>{nicho.buscaSugerida}</strong>.</p>
              </div>
            </Revela>
          </div>
        </section>

        <section className="vd-secao" id="precos">
          <div className="vd-dentro vd-centro">
            <Revela>
              <span className="vd-olho">Preços</span>
              <h2 className="vd-h2">Você paga por usuário. <em>Só isso.</em></h2>
              <p className="vd-sub">Sem fidelidade. Aumente ou diminua a equipe quando quiser.</p>
            </Revela>
            <Revela atraso={1}>
              <div className="vd-quantos" data-seletor-de-usuarios="">
                <span>Usuários</span>
                <button type="button" className="vd-passo" onClick={() => setUsuarios(usuariosValidos(usuarios - 1))} disabled={usuarios <= 1} aria-label="Menos um usuário"><Minus aria-hidden="true" /></button>
                <output aria-live="polite">{usuarios}</output>
                <button type="button" className="vd-passo" onClick={() => setUsuarios(usuariosValidos(usuarios + 1))} disabled={usuarios >= 500} aria-label="Mais um usuário"><Plus aria-hidden="true" /></button>
              </div>
            </Revela>

            {planos.isLoading ? (
              <div className="vd-planos" aria-label="Carregando os planos"><div className="vd-esqueleto" /><div className="vd-esqueleto" /></div>
            ) : lista.length ? (
              <div className="vd-planos" data-planos-da-venda="">
                {lista.map((p, i) => {
                  const n = Math.max(usuarios, p.minimo_usuarios);
                  return (
                    <Revela key={p.id} atraso={(i + 1) as 1 | 2} className={p.destaque ? "vd-plano vd-plano-forte" : "vd-plano"}>
                      <div className="vd-plano-nome">{p.nome}{p.destaque && <em>Mais completo</em>}</div>
                      {p.resumo && <p className="vd-plano-resumo">{p.resumo}</p>}
                      <div className="vd-preco">{reais(p.preco_usuario)}<small>por usuário, por mês</small></div>
                      <p className="vd-total"><strong>{reais(p.preco_usuario * n)}</strong> por mês para {n} {n === 1 ? "usuário" : "usuários"}</p>
                      <ul className="vd-inclui">
                        {p.recursos.map((r) => (
                          <li key={r}><Check aria-hidden="true" />{r}</li>
                        ))}
                      </ul>
                      <Link to={comprar(p.id, n)} className={p.destaque ? "vd-botao vd-botao-largo" : "vd-fantasma vd-fantasma-largo"} data-comprar={p.id}>
                        {user ? "Abrir o meu CRM" : cobranca ? `Assinar o ${p.nome}` : dias ? `Testar o ${p.nome} por ${dias} dias` : `Testar o ${p.nome}`}
                      </Link>
                    </Revela>
                  );
                })}
              </div>
            ) : (
              <div style={{ marginTop: 32 }}>
                <p className="vd-nota">{COPY.semPrecos}</p>
                <p style={{ marginTop: 16 }}><Link to={user ? "/app" : COMECAR} className="vd-botao" data-comecar="sem-planos">Começar agora</Link></p>
              </div>
            )}
            <p className="vd-nota">
              {cobranca
                ? "Pagamento no cartão, pelo checkout do Asaas. O acesso libera assim que o pagamento confirma."
                : dias
                  ? `${dias} dias de teste, sem cartão. Depois você decide se assina.`
                  : "Teste sem cartão. Depois você decide se assina."}
            </p>
          </div>
        </section>

        <section className="vd-secao vd-secao-clara">
          <div className="vd-dentro">
            <Revela>
              <span className="vd-olho">Antes de decidir</span>
              <h2 className="vd-h2">O que todo dono pensa <em>antes de assinar.</em></h2>
            </Revela>
            <div className="vd-objecoes">
              {OBJECOES(dias).map((o, i) => (
                <Revela key={o.titulo} atraso={((i % 2) + 1) as 1 | 2} className="vd-objecao">
                  <h3>{o.titulo}</h3>
                  <p>{o.linha}</p>
                </Revela>
              ))}
            </div>
          </div>
        </section>

        <section className="vd-secao" id="duvidas">
          <div className="vd-dentro vd-centro">
            <Revela>
              <span className="vd-olho">Perguntas frequentes</span>
              <h2 className="vd-h2">Dúvidas, <em>direto ao ponto.</em></h2>
            </Revela>
            <Revela atraso={1} className="vd-perguntas">
              {PERGUNTAS(dias, cobranca).map((q) => (
                <details key={q.p} className="vd-pergunta">
                  <summary><span>{q.p}</span><Plus aria-hidden="true" /></summary>
                  <p>{q.r}</p>
                </details>
              ))}
            </Revela>
          </div>
        </section>

        <section className="vd-final vd-secao-2">
          <div className="vd-grade" aria-hidden="true" />
          <div className="vd-aurora" aria-hidden="true" />
          <div className="vd-dentro">
            <Revela>
              <h2 className="vd-h2">O cliente de hoje não espera <em>até segunda.</em></h2>
              <p className="vd-sub" style={{ marginLeft: "auto", marginRight: "auto" }}>Monte o seu funil agora e pare de perder venda por esquecimento.</p>
              <div className="vd-heroi-acoes">
                <Link to={principal} className="vd-botao" data-comecar="final">{chamada}<ArrowRight aria-hidden="true" /></Link>
              </div>
              <ul className="vd-garantias">
                {garantias.map((g) => (
                  <li key={g}><Check aria-hidden="true" />{g}</li>
                ))}
              </ul>
            </Revela>
          </div>
        </section>
      </main>

      <footer className="vd-rodape">
        <div className="vd-dentro vd-rodape-linha">
          <MarcaAceleriq altura={18} />
          <span className="vd-vao" />
          <span>Aceleriq, {new Date().getFullYear()}</span>
          {!user && <Link to="/login?next=%2Fapp">Entrar</Link>}
        </div>
      </footer>

      <div className={rolou ? "vd-barra-de-compra vd-on" : "vd-barra-de-compra"} aria-hidden={!rolou}>
        <span>
          <strong>{menorPreco ? `A partir de ${reais(menorPreco)}` : "CRM da Aceleriq"}</strong>
          {cobranca ? "por usuário, sem fidelidade" : "por usuário, teste sem cartão"}
        </span>
        <Link to={principal} className="vd-botao vd-botao-p" tabIndex={rolou ? 0 : -1} data-comecar="barra">{user ? "Abrir" : cobranca ? "Assinar" : "Testar grátis"}</Link>
      </div>
    </div>
  );
}
