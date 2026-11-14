import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Bot, CalendarClock, Check, FileText, Link2, Minus, Plus, Radar, SlidersHorizontal } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { lerPrecos, listarPlanos, reais } from "@/lib/produto/api";
import { ETAPAS_DO_FUNIL, NICHOS, NOME_PADRAO_DA_ETAPA, type EtapaId } from "@/lib/produto/nichos";
import { baseDoApp, enderecoDeCompra, usuariosValidos } from "@/lib/produto/venda";
import { MarcaAceleriq } from "@/components/publico/CascaPublica";
import { Revela, TelaNoCelular, TelaReal } from "@/components/venda/Cenas";
import telaPainel from "@/assets/venda/painel.webp";
import telaPainelCelular from "@/assets/venda/painel-celular.webp";
import telaFunil from "@/assets/venda/funil.webp";
import telaEquipe from "@/assets/venda/equipe.webp";
import telaAutomacoes from "@/assets/venda/automacoes.webp";
import "@/components/venda/venda.css";

/**
 * A página de venda do CRM (endereço /crm), pronta para receber tráfego.
 * Ordem da conversa: promessa, problema, o produto funcionando, recursos, para
 * quem é, preço, objeções, perguntas e a chamada final. As imagens são telas
 * reais do CRM, capturadas com dados de exemplo (src/assets/venda). Os preços e os dias de
 * teste vêm do banco. Nenhuma prova inventada: o que convence é o
 * produto e o teste. Cada botão de plano leva a escolha para o cadastro
 * (/crm/comecar), que termina no teste ou no checkout, conforme a cobrança
 * esteja desligada ou ligada.
 */

const COMECAR = "/crm/comecar";

/** A copy longa fica aqui, fora da tela, para ser editada num lugar só. */
const COPY = {
  heroi: "O CRM da Aceleriq põe cada negócio num funil que você enxerga, avisa a hora de cada retorno e mostra quem da equipe está vendendo. Já chega montado para o seu ramo.",
  produto: "Estas são telas do próprio CRM, do jeito que a sua equipe vai abrir todo dia. Os nomes e valores são dados de exemplo.",
  funil: "Arraste o cartão quando o cliente avança. Cada negócio mostra o valor, o responsável e o próximo passo, e o que está atrasado aparece na hora.",
  equipe: "O ranking muda a cada negócio fechado. O gerente acompanha a equipe dele, vê quem precisa de ajuda e repassa contatos para quem tem espaço.",
  automacoes: "Negócio novo já entra com dono. Proposta enviada vira retorno marcado. Negócio parado avisa o gerente. Você liga a receita pronta, não programa nada.",
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
  { icone: Radar, titulo: "Máquina de leads", linha: "Diga o ramo e a cidade. Ela devolve empresas com o contato, prontas para entrar no funil." },
  { icone: Link2, titulo: "Captação com rastreamento", linha: "Um formulário seu, com link para o anúncio. Cada contato chega com a origem (UTM), e o Pixel da Meta marca a conversão." },
  { icone: Bot, titulo: "Claude e ChatGPT conectados", linha: "Ligue o seu assistente ao CRM e peça em português: crie o negócio, mude de etapa, marque o retorno. Para o resto, tem API." },
  { icone: SlidersHorizontal, titulo: "Campos do seu ramo", linha: "Consórcio pede carta e grupo. Imobiliária pede imóvel e visita. O CRM já chega com os campos certos." },
  { icone: CalendarClock, titulo: "Agenda e retornos", linha: "Todo negócio aberto tem um próximo passo com dia e hora. Você abre o CRM de manhã e já sabe para quem ligar." },
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

/** Elo para o produto: dentro do painel navega sem recarregar; no subdomínio de venda abre o endereço do produto. */
function Elo({ base, to, children, ...resto }: { base: string; to: string; children: ReactNode; className?: string; tabIndex?: number; "data-comecar"?: string; "data-comprar"?: string }) {
  return base ? <a href={base + to} {...resto}>{children}</a> : <Link to={to} {...resto}>{children}</Link>;
}

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

  const base = baseDoApp(typeof window !== "undefined" ? window.location.hostname : "");
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
          <Link to={base ? "/" : "/crm"} aria-label="Aceleriq CRM"><MarcaAceleriq altura={22} /></Link>
          <nav className="vd-topo-elos" aria-label="Seções">
            <a href="#produto">Produto</a>
            <a href="#recursos">Recursos</a>
            <a href="#precos">Preços</a>
            <a href="#duvidas">Dúvidas</a>
          </nav>
          <span className="vd-vao" />
          {!user && <Elo base={base} to="/login?next=%2Fapp" className="vd-topo-entrar">Entrar</Elo>}
          <Elo base={base} to={principal} className="vd-botao vd-botao-p" data-comecar="topo">{user ? "Abrir o CRM" : cobranca ? "Assinar" : "Testar grátis"}</Elo>
        </div>
      </header>

      <main>
        <section className="vd-heroi">
          <div className="vd-grade" aria-hidden="true" />
          <div className="vd-aurora" aria-hidden="true" />
          <div className="vd-dentro">
            <div className="vd-heroi-texto">
              <Revela><span className="vd-olho">CRM de vendas para pequenas e médias empresas</span></Revela>
              <Revela atraso={1} como="h1" className="vd-h1">Sua próxima venda está <em>esquecida no WhatsApp.</em></Revela>
              <Revela atraso={2}>
                <p className="vd-heroi-linha">{COPY.heroi}</p>
              </Revela>
              <Revela atraso={3}>
                <div className="vd-heroi-acoes">
                  <Elo base={base} to={principal} className="vd-botao" data-comecar="heroi">{chamada}<ArrowRight aria-hidden="true" /></Elo>
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
              <TelaReal src={telaPainel} alt="Painel do CRM: vendido no mês, funil por etapa, vendas por mês e ranking da equipe" endereco="aceleriq.online/app" cedo />
              <TelaNoCelular src={telaPainelCelular} alt="O mesmo painel do CRM aberto no celular" cedo />
            </div>
            <p className="vd-legenda">Tela real do CRM, no computador e no celular.</p>
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
                <span className="vd-olho">Funil</span>
                <h3>Cada negócio numa etapa. Cada etapa numa cor.</h3>
                <p>{COPY.funil}</p>
                <ul className="vd-pontos">
                  <li><Check aria-hidden="true" />Etapas com os nomes que o seu ramo usa</li>
                  <li><Check aria-hidden="true" />Valor em jogo e previsão do mês no topo</li>
                  <li><Check aria-hidden="true" />Atrasado e sem próximo passo em destaque</li>
                </ul>
              </Revela>
              <TelaReal src={telaFunil} alt="Funil do CRM com as etapas coloridas e os negócios em cartões" endereco="aceleriq.online/app/crm" className="vd-janela-recorte" />
            </div>

            <div className="vd-cena vd-cena-invertida">
              <Revela className="vd-cena-texto">
                <span className="vd-olho">Equipe e ranking</span>
                <h3>Todo mundo sabe quem está vendendo.</h3>
                <p>{COPY.equipe}</p>
                <ul className="vd-pontos">
                  <li><Check aria-hidden="true" />Administrador, gerente e vendedor, cada um com a sua visão</li>
                  <li><Check aria-hidden="true" />Meta de cada vendedor e quanto já saiu</li>
                  <li><Check aria-hidden="true" />Você escolhe: todos veem tudo ou cada um vê os seus</li>
                </ul>
              </Revela>
              <TelaReal src={telaEquipe} alt="Tela da equipe com o ranking do mês e a estrutura de gerente e vendedores" endereco="aceleriq.online/app/equipe" className="vd-janela-recorte" />
            </div>

            <div className="vd-cena">
              <Revela className="vd-cena-texto">
                <span className="vd-olho">Automações</span>
                <h3>O trabalho repetido acontece sozinho.</h3>
                <p>{COPY.automacoes}</p>
                <ul className="vd-pontos">
                  <li><Check aria-hidden="true" />Rodízio de negócios novos entre a equipe</li>
                  <li><Check aria-hidden="true" />Tarefa criada quando o negócio muda de etapa</li>
                  <li><Check aria-hidden="true" />Aviso de negócio parado e de proposta sem resposta</li>
                </ul>
              </Revela>
              <TelaReal src={telaAutomacoes} alt="Tela de automações com as receitas prontas para ligar" endereco="aceleriq.online/app/automacoes" className="vd-janela-recorte" />
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
                      <Elo base={base} to={comprar(p.id, n)} className={p.destaque ? "vd-botao vd-botao-largo" : "vd-fantasma vd-fantasma-largo"} data-comprar={p.id}>
                        {user ? "Abrir o meu CRM" : cobranca ? `Assinar o ${p.nome}` : dias ? `Testar o ${p.nome} por ${dias} dias` : `Testar o ${p.nome}`}
                      </Elo>
                    </Revela>
                  );
                })}
              </div>
            ) : (
              <div style={{ marginTop: 32 }}>
                <p className="vd-nota">{COPY.semPrecos}</p>
                <p style={{ marginTop: 16 }}><Elo base={base} to={user ? "/app" : COMECAR} className="vd-botao" data-comecar="sem-planos">Começar agora</Elo></p>
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
                <Elo base={base} to={principal} className="vd-botao" data-comecar="final">{chamada}<ArrowRight aria-hidden="true" /></Elo>
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
          {!user && <Elo base={base} to="/login?next=%2Fapp">Entrar</Elo>}
        </div>
      </footer>

      <div className={rolou ? "vd-barra-de-compra vd-on" : "vd-barra-de-compra"} aria-hidden={!rolou}>
        <span>
          <strong>{menorPreco ? `A partir de ${reais(menorPreco)}` : "CRM da Aceleriq"}</strong>
          {cobranca ? "por usuário, sem fidelidade" : "por usuário, teste sem cartão"}
        </span>
        <Elo base={base} to={principal} className="vd-botao vd-botao-p" tabIndex={rolou ? 0 : -1} data-comecar="barra">{user ? "Abrir" : cobranca ? "Assinar" : "Testar grátis"}</Elo>
      </div>
    </div>
  );
}
