import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, ChevronRight, Lock, Minus, Plus, ShieldCheck, Smartphone } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { lerPrecos, listarPlanos, reais } from "@/lib/produto/api";
import { ETAPAS_DO_FUNIL, NICHOS, NOME_PADRAO_DA_ETAPA, type EtapaId } from "@/lib/produto/nichos";
import { baseDoApp, enderecoDeCompra, usuariosValidos } from "@/lib/produto/venda";
import { MarcaAceleriq } from "@/components/publico/CascaPublica";
import { FunilVivo, NotebookQueAbre, Revela } from "@/components/venda/Cenas";
import fotoDono from "@/assets/venda/homem.webp";
import fotoVendedora from "@/assets/venda/mulher.webp";
import telaPainel from "@/assets/venda/painel.webp";
import telaPainelCelular from "@/assets/venda/painel-celular.webp";
import telaFunil from "@/assets/venda/funil.webp";
import telaEquipe from "@/assets/venda/equipe.webp";
import telaAutomacoes from "@/assets/venda/automacoes.webp";
import "@/components/venda/venda.css";

/**
 * A página de venda do CRM (endereço /crm e crm.aceleriq.online).
 * Visual no padrão das referências do dono: fundo de ladrilhos com brilhos
 * verdes, herói com pessoa, cartão claro sobreposto, painéis de vidro verde e
 * oferta com faixas laterais. Preços e dias de teste vêm do banco. As telas
 * são capturas reais do CRM com dados de exemplo; as fotos são de banco de
 * imagem gerado (pessoas ilustrativas, sem nenhuma fala atribuída a elas).
 * Cada botão de compra leva a escolha para o cadastro (/crm/comecar).
 */

const COMECAR = "/crm/comecar";

/** A copy fica aqui, fora da tela, para ser editada num lugar só. Sem ponto no fim das frases, a pedido do dono. */
const COPY = {
  heroi: "Um CRM simples para a sua equipe seguir cada negócio no funil, lembrar de cada retorno e fechar mais, já na próxima conversa",
  resolve: "com um funil claro, que mostra cada negócio, quem está cuidando dele e qual é o próximo passo, do primeiro contato ao pós-venda",
  note: "Role a página: o notebook abre e mostra o CRM como a sua equipe vai ver. São telas reais do produto, com dados de exemplo",
  vivo: "Pegue um cartão e leve para a próxima etapa. É assim que a sua equipe trabalha o dia inteiro, no computador e no celular",
  semPrecos: "Não consegui carregar os preços agora. Você pode começar mesmo assim e escolher o plano no cadastro",
};

const DORES: Array<[string, string, string]> = [
  ["O cliente pede orçamento e a ", "conversa some", " no WhatsApp"],
  ["O cliente diz “vou pensar” e ", "ninguém lembra", " de voltar"],
  ["A planilha parou no mês passado e ", "ninguém confia", " no número"],
  ["Você só descobre quem vendeu ", "no fim do mês", ", tarde demais"],
];

const RECURSOS: Array<[string, string]> = [
  ["Funil colorido", " por etapa, com arrastar e soltar"],
  ["Agenda de retornos", " com dia, hora e lembrete"],
  ["Painel do mês", " com vendas, metas e conversão"],
  ["Equipe com cargos", ": administrador, gerente e vendedor"],
  ["Ranking de vendedores", " atualizado a cada venda"],
  ["Automações prontas", " para ligar com um toque"],
  ["Máquina de leads", " que busca empresas do seu ramo"],
  ["Captação rastreada", " com UTM e Pixel da Meta"],
  ["Claude e ChatGPT", " conectados ao seu CRM"],
];

const COMO_COMECA: Array<[string, string]> = [
  ["Para começar", "Três passos, sem implantação"],
  ["Sua equipe", "Entra por convite no e-mail"],
  ["Onde funciona", "No computador e no celular"],
];

const UM_DIA: Array<[string, string]> = [
  ["08h", "abre o painel e vê os retornos do dia"],
  ["09h", "o lead do anúncio entra no funil já com dono"],
  ["11h", "proposta enviada vira retorno marcado sozinho"],
  ["15h", "o gerente repassa contatos para quem tem espaço"],
  ["18h", "o ranking mostra quem vendeu, sem pedir relatório"],
];

const OBJECOES = (dias: number | null): Array<[string, string]> => [
  ["“Minha equipe não vai usar”", "Usa, porque dá menos trabalho que a planilha: arrasta o cartão e pronto"],
  ["“Já tentei CRM e era complicado”", "Este abre com o funil do seu ramo montado. Você já cadastra o primeiro negócio"],
  ["“Não tenho tempo para implantar”", "Não tem implantação. O cadastro tem três passos"],
  ["“E se não for pra mim?”", `${dias ? `Você testa por ${dias} dias. ` : ""}Sem fidelidade e sem multa: cancela na própria tela`],
];

const PERGUNTAS = (dias: number | null, cobranca: boolean): Array<[string, string]> => [
  cobranca
    ? ["Como é o pagamento?", "No cartão de crédito, todo mês, pelo checkout do Asaas. O número do cartão não passa pelo nosso servidor, e o acesso libera assim que o pagamento confirma"]
    : ["Preciso de cartão para testar?", `Não. ${dias ? `O teste de ${dias} dias` : "O teste"} começa só com nome, e-mail e senha`],
  ["Como funciona o preço?", "Você paga por usuário, por mês. Entrou gente na equipe, aumenta. Saiu, diminui"],
  ["Tem fidelidade ou multa?", "Não. Você cancela quando quiser, na tela da conta, e usa até o fim do período já pago"],
  ["Funciona no celular?", "Sim. Abre no navegador do celular e do computador, sem instalar nada"],
  ["Serve para o meu ramo?", "Serve. O funil já chega com os nomes do seu ramo (imobiliária, consórcio, clínica, serviços, loja, agência, indústria) e você troca o que quiser"],
  ["Meus dados ficam seguros?", "Cada empresa enxerga só os próprios dados. Nem a Aceleriq lê o seu CRM: vemos apenas contagens de uso"],
  ["Posso mudar de plano depois?", "Pode. Plano e número de usuários mudam na tela da conta, sem falar com ninguém"],
];

const COR_DA_ETAPA: Record<EtapaId, string> = { novo: "#2f9bf0", contato: "#19b6d2", diagnostico: "#8f6bf0", proposta: "#f5a623", negociacao: "#f57c2b", ganho: "#22e06b", perdido: "#77837c" };
const PONTOS_DA_CURVA = [[6, 84], [24, 70], [42, 62], [60, 50], [78, 34], [94, 14]];

/** Elo para o produto: dentro do painel navega sem recarregar; no subdomínio de venda abre o endereço do produto. */
function Elo({ base, to, children, ...resto }: { base: string; to: string; children: ReactNode; className?: string; tabIndex?: number; "data-comecar"?: string; "data-comprar"?: string }) {
  return base ? <a href={base + to} {...resto}>{children}</a> : <Link to={to} {...resto}>{children}</Link>;
}

/** O rótulo verde das seções, com a marca e o texto espaçado, como nas referências. */
function Rotulo({ children, escuro = false }: { children: ReactNode; escuro?: boolean }) {
  return (
    <span className={escuro ? "vd-rotulo vd-rotulo-escuro" : "vd-rotulo"}>
      <b>CRM</b>
      {children}
    </span>
  );
}

/** O botão de compra em pílula, com o círculo escuro da seta. */
function Seta() {
  return <i className="vd-bola" aria-hidden="true"><ArrowRight /></i>;
}

export default function ProdutoLanding() {
  const { user } = useAuth();
  const { search } = useLocation();
  const planos = useQuery({ queryKey: ["produto", "planos", "venda"], queryFn: () => listarPlanos(), staleTime: 300_000, retry: 1 });
  const precos = useQuery({ queryKey: ["produto", "precos", "venda"], queryFn: () => lerPrecos(), staleTime: 300_000, retry: 1 });
  const [usuarios, setUsuarios] = useState(3);
  const [planoEscolhido, setPlanoEscolhido] = useState("");
  const [ramo, setRamo] = useState(NICHOS[0].id);
  const [rolou, setRolou] = useState(false);

  const lista = planos.data || [];
  const cobranca = !!(precos.data && precos.data.pagamentos_ativos);
  const dias = precos.data && precos.data.teste_dias > 0 ? precos.data.teste_dias : null;
  const menorPreco = lista.length ? lista.reduce((m, p) => Math.min(m, p.preco_usuario), lista[0].preco_usuario) : null;
  const primeiro = lista[0] || null;
  const plano = lista.filter((p) => p.id === planoEscolhido)[0] || lista.filter((p) => p.destaque)[0] || primeiro;
  const n = plano ? Math.max(usuarios, plano.minimo_usuarios) : usuarios;

  useEffect(() => {
    const antes = document.title;
    document.title = "CRM de vendas para pequenas e médias empresas | Aceleriq";
    return () => {
      document.title = antes;
    };
  }, []);

  useEffect(() => {
    const ver = () => setRolou(window.pageYOffset > 620);
    ver();
    window.addEventListener("scroll", ver, { passive: true });
    return () => window.removeEventListener("scroll", ver);
  }, []);

  const base = baseDoApp(typeof window !== "undefined" ? window.location.hostname : "");
  const comprar = (id: string, quantos: number) => (user ? "/app" : enderecoDeCompra({ plano: id, usuarios: quantos }, search));
  const principal = user ? "/app" : primeiro ? comprar(primeiro.id, primeiro.minimo_usuarios) : COMECAR;
  const chamada = user ? "Abrir o meu CRM" : cobranca ? "Quero o CRM agora" : dias ? `Testar ${dias} dias grátis` : "Começar o teste grátis";
  const garantias = cobranca ? ["Acesso imediato", "Sem fidelidade", "Cancele quando quiser"] : ["Sem cartão para testar", "Sem fidelidade", "Pronto em minutos"];

  const nicho = NICHOS.filter((x) => x.id === ramo)[0] || NICHOS[0];
  const etapasDoRamo = ETAPAS_DO_FUNIL.filter((id) => id !== "perdido").map((id) => ({ id, nome: nicho.etapas[id] || NOME_PADRAO_DA_ETAPA[id] }));
  const telas = [
    { id: "painel", nome: "Painel", src: telaPainel, alt: "Painel do CRM: vendido no mês, funil por etapa, vendas por mês e ranking da equipe" },
    { id: "funil", nome: "Funil", src: telaFunil, alt: "Funil do CRM com as etapas coloridas e os negócios em cartões" },
    { id: "equipe", nome: "Equipe e ranking", src: telaEquipe, alt: "Tela da equipe com o ranking do mês e a estrutura de gerente e vendedores" },
    { id: "automacoes", nome: "Automações", src: telaAutomacoes, alt: "Tela de automações com as receitas prontas para ligar" },
  ];

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
        {/* herói: texto à esquerda, pessoa à direita com avisos flutuando */}
        <section className="vd-heroi vd-ladrilhos">
          <i className="vd-cruz vd-cruz-1" aria-hidden="true" />
          <i className="vd-cruz vd-cruz-2" aria-hidden="true" />
          <div className="vd-dentro vd-heroi-grade">
            <div className="vd-heroi-texto">
              <Revela><Rotulo>de vendas para pequenas e médias empresas</Rotulo></Revela>
              <Revela atraso={1} como="h1" className="vd-h1">Transforme cada conversa em negócio e <strong>cada negócio em venda</strong></Revela>
              <Revela atraso={2}><p className="vd-heroi-linha">{COPY.heroi}</p></Revela>
              <Revela atraso={3}>
                <div className="vd-heroi-acoes">
                  <Elo base={base} to={principal} className="vd-botao" data-comecar="heroi"><Seta />{chamada}</Elo>
                </div>
                <ul className="vd-fichas">
                  {garantias.map((g) => (
                    <li key={g}><ChevronRight aria-hidden="true" />{g}</li>
                  ))}
                </ul>
              </Revela>
            </div>
            <Revela atraso={2} className="vd-retrato">
              <span className="vd-orbita" aria-hidden="true" />
              <img src={fotoDono} alt="Dono de empresa sorrindo, sentado com o notebook aberto" width={896} height={1120} decoding="async" draggable={false} />
              <div className="vd-aviso vd-aviso-1" aria-hidden="true"><b>CRM</b><span><strong>Negócio fechado</strong>Padaria Sol Nascente, R$ 3.200</span></div>
              <div className="vd-aviso vd-aviso-2" aria-hidden="true"><b>CRM</b><span><strong>Retorno às 14h15</strong>Clínica Vida, enviar o orçamento</span></div>
              <div className="vd-aviso vd-aviso-3" aria-hidden="true"><b>CRM</b><span><strong>Lead novo do anúncio</strong>Já entrou no funil, com dono</span></div>
            </Revela>
          </div>
          {menorPreco !== null && (
            <div className="vd-dentro">
              <div className="vd-etiqueta">
                <span>A partir de <strong>{reais(menorPreco)}</strong> por usuário</span>
                <a href="#precos" className="vd-botao vd-botao-p"><Seta />Ver planos</a>
              </div>
            </div>
          )}
        </section>

        {/* cartão claro sobreposto: por que a venda trava */}
        <section className="vd-sobe">
          <span className="vd-letra vd-letra-e" aria-hidden="true">c</span>
          <span className="vd-letra vd-letra-d" aria-hidden="true">m</span>
          <div className="vd-dentro">
            <Revela className="vd-claro">
              <div className="vd-claro-grade">
                <div>
                  <Rotulo escuro>por que as suas vendas travam</Rotulo>
                  <h2 className="vd-h2">Por que você ainda <strong>não vende tudo o que poderia</strong>?</h2>
                  <p className="vd-claro-linha"><strong>O CRM resolve isso</strong> {COPY.resolve}</p>
                  <Elo base={base} to={principal} className="vd-botao vd-botao-escuro" data-comecar="problema"><Seta />Quero o funil na prática</Elo>
                </div>
                <ul className="vd-vidro vd-dores">
                  {DORES.map((d) => (
                    <li key={d[1]}><i className="vd-bola" aria-hidden="true"><ChevronRight /></i><span>{d[0]}<strong>{d[1]}</strong>{d[2]}</span></li>
                  ))}
                </ul>
              </div>
              <div className="vd-faixa" aria-hidden="true">
                <div className="vd-faixa-anda">
                  {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((i) => (
                    <span key={i}><MarcaAceleriq altura={18} /><em>CRM de vendas</em></span>
                  ))}
                </div>
              </div>
            </Revela>
          </div>
        </section>

        {/* o notebook que abre com a rolagem */}
        <section className="vd-secao vd-ladrilhos" id="produto">
          <i className="vd-cruz vd-cruz-3" aria-hidden="true" />
          <div className="vd-dentro vd-centro">
            <Revela>
              <Rotulo>o produto por dentro</Rotulo>
              <h2 className="vd-h2">O seu comercial inteiro <strong>numa tela</strong></h2>
              <p className="vd-sub">{COPY.note}</p>
            </Revela>
            <NotebookQueAbre telas={telas} celular={telaPainelCelular} altCelular="O mesmo painel do CRM aberto no celular" />
          </div>
        </section>

        {/* o funil que o visitante arrasta */}
        <section className="vd-secao vd-secao-2">
          <div className="vd-dentro">
            <Revela className="vd-centro">
              <Rotulo>experimente agora</Rotulo>
              <h2 className="vd-h2">Arraste um negócio e <strong>veja a venda andar</strong></h2>
              <p className="vd-sub">{COPY.vivo}</p>
            </Revela>
            <Revela atraso={1}>
              <FunilVivo etapas={["Interessado", "Atendimento", "Proposta", "Fechado"]} />
              <p className="vd-legenda">Demonstração com dados de exemplo. Nada do que você mexe aqui é gravado</p>
            </Revela>
          </div>
        </section>

        {/* recursos: nove cartões claros numerados e três de vidro */}
        <section className="vd-secao vd-ladrilhos" id="recursos">
          <i className="vd-cruz vd-cruz-4" aria-hidden="true" />
          <div className="vd-dentro vd-centro">
            <Revela>
              <Rotulo>o que vem no seu CRM</Rotulo>
              <h2 className="vd-h2">Um CRM direto ao ponto, para a equipe <strong>abrir e vender</strong>. Sem tela sobrando: cadastra, acompanha e fecha</h2>
            </Revela>
            <ol className="vd-passos">
              {RECURSOS.map((r, i) => (
                <Revela key={r[0]} como="li" atraso={((i % 3) + 1) as 1 | 2 | 3}><b>{i + 1}</b><span><strong>{r[0]}</strong>{r[1]}</span></Revela>
              ))}
            </ol>
            <div className="vd-trio">
              {COMO_COMECA.map((c, i) => (
                <Revela key={c[0]} atraso={(i + 1) as 1 | 2 | 3} className="vd-vidro vd-trio-item">
                  <em>{c[0]}</em>
                  <span>{c[1]}</span>
                </Revela>
              ))}
            </div>
          </div>
        </section>

        {/* um dia com o CRM: foto e linha do tempo */}
        <section className="vd-secao vd-secao-2">
          <div className="vd-dentro">
            <Revela className="vd-titulo-de-linha">
              <i className="vd-bola vd-bola-clara" aria-hidden="true"><ArrowRight /></i>
              <h2 className="vd-h3">Um dia de vendas com o CRM</h2>
              <span className="vd-vao" />
              <Rotulo>do primeiro contato ao fechado</Rotulo>
            </Revela>
            <div className="vd-dia">
              <Revela className="vd-foto">
                <img src={fotoVendedora} alt="Vendedora sorrindo ao ver no celular o aviso de um negócio fechado" width={896} height={1120} loading="lazy" decoding="async" draggable={false} />
                <div className="vd-aviso vd-aviso-foto" aria-hidden="true"><b>CRM</b><span><strong>Negócio fechado</strong>Você acabou de fechar R$ 3.200 com a Padaria Sol Nascente</span></div>
              </Revela>
              <div className="vd-linha-do-tempo">
                <ol>
                  {UM_DIA.map((d, i) => (
                    <Revela key={d[0]} como="li" atraso={((i % 4) + 1) as 1 | 2 | 3 | 4}><strong>{d[0]}:</strong> {d[1]}</Revela>
                  ))}
                </ol>
                <Revela className="vd-resultado"><i className="vd-bola" aria-hidden="true"><ChevronRight /></i><span><strong>Resultado:</strong> nenhum cliente sem resposta, e você sabe quem está vendendo</span></Revela>
              </div>
            </div>
          </div>
        </section>

        {/* para quem é: o funil do ramo numa curva */}
        <section className="vd-secao vd-ladrilhos" id="ramos">
          <i className="vd-cruz vd-cruz-5" aria-hidden="true" />
          <div className="vd-dentro vd-centro">
            <Revela>
              <Rotulo>feito para o seu ramo</Rotulo>
              <h2 className="vd-h2">O funil já chega <strong>com os nomes do seu negócio</strong></h2>
            </Revela>
            <Revela atraso={1}>
              <div className="vd-ramos" role="group" aria-label="Ramo da empresa">
                {NICHOS.map((x) => (
                  <button key={x.id} type="button" className="vd-ramo" aria-pressed={x.id === nicho.id} onClick={() => setRamo(x.id)} data-ramo={x.id}>{x.nome}</button>
                ))}
              </div>
              <div className="vd-curva" aria-live="polite">
                <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                  <defs>
                    <linearGradient id="vd-sob-a-curva" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0" stopColor="#22e06b" stopOpacity="0.28" />
                      <stop offset="1" stopColor="#22e06b" stopOpacity="0" />
                    </linearGradient>
                  </defs>
                  <path d="M0 90 C10 86 16 74 24 70 S36 66 42 62 S54 56 60 50 S72 42 78 34 S90 18 100 8 L100 100 L0 100 Z" fill="url(#vd-sob-a-curva)" />
                  <path d="M0 90 C10 86 16 74 24 70 S36 66 42 62 S54 56 60 50 S72 42 78 34 S90 18 100 8" fill="none" stroke="#3dff8f" strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
                </svg>
                <ol key={nicho.id}>
                  {etapasDoRamo.map((e, i) => (
                    <li key={e.id} style={{ left: `${PONTOS_DA_CURVA[i][0]}%`, top: `${PONTOS_DA_CURVA[i][1]}%`, "--cor": COR_DA_ETAPA[e.id] } as CSSProperties}><i /><span>{e.nome}</span></li>
                  ))}
                </ol>
              </div>
              <p className="vd-legenda"><strong>{nicho.nome}:</strong> {nicho.exemplo.toLowerCase()}. Você troca qualquer nome depois</p>
            </Revela>
          </div>
        </section>

        {/* objeções */}
        <section className="vd-secao vd-secao-2">
          <div className="vd-dentro vd-centro">
            <Revela>
              <Rotulo>respostas diretas para as suas dúvidas</Rotulo>
              <h2 className="vd-h2 vd-h2-fino">Objeções? <strong>Vamos direto ao ponto</strong></h2>
            </Revela>
            <div className="vd-objecoes">
              {OBJECOES(dias).map((o, i) => (
                <Revela key={o[0]} atraso={((i % 4) + 1) as 1 | 2 | 3 | 4} className={i === 1 ? "vd-objecao vd-objecao-forte" : "vd-objecao"}>
                  <i aria-hidden="true" />
                  <h3>{o[0]}</h3>
                  <p>{o[1]}</p>
                </Revela>
              ))}
            </div>
          </div>
        </section>

        {/* oferta: painel verde com faixas laterais e o cartão do preço */}
        <section className="vd-secao vd-ladrilhos" id="precos">
          <i className="vd-cruz vd-cruz-6" aria-hidden="true" />
          <div className="vd-dentro">
            <Revela className="vd-oferta">
              <span className="vd-lateral vd-lateral-e" aria-hidden="true"><em>CADA NEGÓCIO NO FUNIL • NENHUM CLIENTE SEM RESPOSTA • CADA NEGÓCIO NO FUNIL • NENHUM CLIENTE SEM RESPOSTA • CADA NEGÓCIO NO FUNIL • NENHUM CLIENTE SEM RESPOSTA •</em></span>
              <span className="vd-lateral vd-lateral-d" aria-hidden="true"><em>CADA NEGÓCIO NO FUNIL • NENHUM CLIENTE SEM RESPOSTA • CADA NEGÓCIO NO FUNIL • NENHUM CLIENTE SEM RESPOSTA • CADA NEGÓCIO NO FUNIL • NENHUM CLIENTE SEM RESPOSTA •</em></span>
              <div className="vd-oferta-grade">
                <div>
                  <Rotulo>escolha o seu plano</Rotulo>
                  <h2 className="vd-h2">O CRM completo para <strong>transformar conversas em vendas</strong></h2>
                  <p className="vd-oferta-linha">{plano && plano.resumo ? plano.resumo.replace(/\.$/, "") : "Você paga por usuário, por mês. Sem fidelidade"}</p>
                  {plano && (
                    <ul className="vd-inclui" key={plano.id}>
                      {plano.recursos.map((r) => (
                        <li key={r}><i className="vd-bola" aria-hidden="true"><ChevronRight /></i><span>{r.replace(/\.$/, "")}</span></li>
                      ))}
                    </ul>
                  )}
                </div>
                <div className="vd-caixa">
                  <div className="vd-caixa-marca"><b><MarcaAceleriq altura={24} /></b><span>CRM de vendas</span></div>
                  {planos.isLoading ? (
                    <div className="vd-esqueleto" aria-label="Carregando os planos" />
                  ) : plano ? (
                    <div className="vd-caixa-dentro" data-planos-da-venda="">
                      <div className="vd-planos" role="radiogroup" aria-label="Plano">
                        {lista.map((p) => (
                          <button key={p.id} type="button" role="radio" aria-checked={p.id === plano.id} className="vd-plano" onClick={() => setPlanoEscolhido(p.id)} data-plano={p.id}>{p.nome}</button>
                        ))}
                      </div>
                      <div className="vd-quantos" data-seletor-de-usuarios="">
                        <span>Usuários</span>
                        <button type="button" className="vd-passo" onClick={() => setUsuarios(usuariosValidos(usuarios - 1))} disabled={usuarios <= 1} aria-label="Menos um usuário"><Minus aria-hidden="true" /></button>
                        <output aria-live="polite">{n}</output>
                        <button type="button" className="vd-passo" onClick={() => setUsuarios(usuariosValidos(usuarios + 1))} disabled={usuarios >= 500} aria-label="Mais um usuário"><Plus aria-hidden="true" /></button>
                      </div>
                      <p className="vd-caixa-linha">{reais(plano.preco_usuario)} por usuário, por mês</p>
                      <p className="vd-preco" data-total="">{reais(plano.preco_usuario * n)}</p>
                      <p className="vd-caixa-linha">por mês para {n} {n === 1 ? "usuário" : "usuários"}</p>
                      <Elo base={base} to={comprar(plano.id, n)} className="vd-botao vd-botao-largo" data-comprar={plano.id}>
                        <Seta />
                        {user ? "Abrir o meu CRM" : cobranca ? `Assinar o ${plano.nome}` : dias ? `Testar o ${plano.nome} por ${dias} dias` : `Testar o ${plano.nome}`}
                      </Elo>
                      <ul className="vd-selos">
                        <li><ShieldCheck aria-hidden="true" />{cobranca ? "Pagamento pelo Asaas" : "Teste sem cartão"}</li>
                        <li><Lock aria-hidden="true" />Dados só seus</li>
                        <li><Smartphone aria-hidden="true" />No celular</li>
                      </ul>
                    </div>
                  ) : (
                    <div className="vd-caixa-dentro">
                      <p className="vd-caixa-linha">{COPY.semPrecos}</p>
                      <Elo base={base} to={user ? "/app" : COMECAR} className="vd-botao vd-botao-largo" data-comecar="sem-planos"><Seta />Começar agora</Elo>
                    </div>
                  )}
                  <p className="vd-caixa-pe">{cobranca ? "Sem fidelidade. O acesso libera assim que o pagamento confirma" : dias ? `${dias} dias de teste, sem cartão. Depois você decide se assina` : "Teste sem cartão. Depois você decide se assina"}</p>
                </div>
              </div>
            </Revela>
          </div>
        </section>

        {/* perguntas */}
        <section className="vd-secao vd-secao-2" id="duvidas">
          <div className="vd-dentro vd-duvidas">
            <Revela>
              <Rotulo>perguntas</Rotulo>
              <h2 className="vd-h2 vd-h2-fino">Perguntas <strong>frequentes</strong></h2>
            </Revela>
            <Revela atraso={1} className="vd-perguntas">
              {PERGUNTAS(dias, cobranca).map((q, i) => (
                <details key={q[0]} className="vd-pergunta" open={i === 0}>
                  <summary><span>{q[0]}</span><i aria-hidden="true"><Plus /></i></summary>
                  <p>{q[1]}</p>
                </details>
              ))}
            </Revela>
          </div>
        </section>

        {/* chamada final */}
        <section className="vd-final vd-ladrilhos">
          <i className="vd-cruz vd-cruz-7" aria-hidden="true" />
          <div className="vd-dentro vd-centro">
            <Revela>
              <h2 className="vd-h2">O cliente de hoje não espera <strong>até segunda</strong></h2>
              <p className="vd-sub">Monte o seu funil agora e pare de perder venda por esquecimento</p>
              <div className="vd-heroi-acoes vd-no-centro">
                <Elo base={base} to={principal} className="vd-botao" data-comecar="final"><Seta />{chamada}</Elo>
              </div>
              <ul className="vd-fichas vd-no-centro">
                {garantias.map((g) => (
                  <li key={g}><ChevronRight aria-hidden="true" />{g}</li>
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
