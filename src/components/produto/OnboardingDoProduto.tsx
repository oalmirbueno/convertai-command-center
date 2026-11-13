import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, ArrowRight, Briefcase, Building2, Check, Factory, GraduationCap, HeartPulse, PiggyBank, Megaphone, Minus, Plus, Shapes, ShoppingBag, Wrench } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { assinar, criarConta, fraseDoErro, lerPrecos, listarPlanos, reais } from "@/lib/produto/api";
import { destinoDaCompra, documentoConferido, documentoLegivel, type EscolhaDeCompra } from "@/lib/produto/venda";
import { ETAPAS_DO_FUNIL, NICHOS, NOME_PADRAO_DA_ETAPA, OBJETIVOS, perfilDoNicho, type EtapaId, type NichoId, type ObjetivoId } from "@/lib/produto/nichos";
import { useRelerProduto } from "@/hooks/useProduto";
import { CampoDeFormulario, botao, campo, foco, juntar, texto } from "@/components/sistema";
import { CampoDeSenha, MarcaAceleriq, campoPublico } from "@/components/publico/CascaPublica";
import "./produto.css";

/**
 * A chegada ao produto (13/11/2026): quatro perguntas curtas antes do
 * cadastro, uma por tela. O ramo da empresa dá ao funil os nomes que aquele
 * ramo usa; o objetivo decide onde a pessoa cai depois. Quem ainda não tem
 * login cria o acesso no último passo; as respostas ficam guardadas no
 * aparelho, então confirmar o e-mail e voltar não faz perguntar de novo.
 *
 * Caminho direto (quem escolheu o plano na página de venda): só ramo, empresa
 * e acesso. Criado o acesso, a empresa nasce sozinha; com a cobrança ligada a
 * pessoa segue para o checkout do cartão, com ela desligada entra no teste.
 */

const ICONE_DO_NICHO: Record<NichoId, ReactNode> = {
  imobiliaria: <Building2 className="h-5 w-5" aria-hidden="true" />,
  consorcio: <PiggyBank className="h-5 w-5" aria-hidden="true" />,
  saude: <HeartPulse className="h-5 w-5" aria-hidden="true" />,
  servicos: <Wrench className="h-5 w-5" aria-hidden="true" />,
  varejo: <ShoppingBag className="h-5 w-5" aria-hidden="true" />,
  agencia: <Megaphone className="h-5 w-5" aria-hidden="true" />,
  educacao: <GraduationCap className="h-5 w-5" aria-hidden="true" />,
  b2b: <Factory className="h-5 w-5" aria-hidden="true" />,
  outro: <Shapes className="h-5 w-5" aria-hidden="true" />,
};

export interface RespostasDoOnboarding {
  nicho: NichoId | "";
  objetivo: ObjetivoId | "";
  empresa: string;
  usuarios: number;
  plano: string;
  etapas: Partial<Record<EtapaId, string>>;
  /** Veio da página de venda com o plano escolhido: caminho curto, sem objetivo nem funil. */
  direto?: boolean;
  /** CPF ou CNPJ, só números. Pedido quando a cobrança está ligada. */
  documento?: string;
}

const CHAVE = "aceleriq:produto:onboarding";
const VAZIO: RespostasDoOnboarding = { nicho: "", objetivo: "", empresa: "", usuarios: 1, plano: "starter", etapas: {} };

export function lerRespostasGuardadas(): RespostasDoOnboarding | null {
  try {
    const bruto = JSON.parse(localStorage.getItem(CHAVE) || "null");
    if (!bruto || typeof bruto !== "object") return null;
    const nicho = NICHOS.filter((n) => n.id === bruto.nicho)[0];
    const objetivo = OBJETIVOS.filter((o) => o.id === bruto.objetivo)[0];
    const etapas: Partial<Record<EtapaId, string>> = {};
    ETAPAS_DO_FUNIL.forEach((id) => {
      const v = bruto.etapas && typeof bruto.etapas[id] === "string" ? String(bruto.etapas[id]).trim().slice(0, 24) : "";
      if (v.length >= 2) etapas[id] = v;
    });
    return {
      nicho: nicho ? nicho.id : "",
      objetivo: objetivo ? objetivo.id : "",
      empresa: typeof bruto.empresa === "string" ? bruto.empresa.slice(0, 120) : "",
      usuarios: Math.max(1, Math.min(500, Math.floor(Number(bruto.usuarios) || 1))),
      plano: typeof bruto.plano === "string" ? bruto.plano.slice(0, 40) : "starter",
      etapas,
      direto: bruto.direto === true,
      documento: typeof bruto.documento === "string" ? bruto.documento.replace(/\D/g, "").slice(0, 14) : "",
    };
  } catch {
    return null;
  }
}

function guardarRespostas(r: RespostasDoOnboarding | null) {
  try {
    if (r) localStorage.setItem(CHAVE, JSON.stringify(r));
    else localStorage.removeItem(CHAVE);
  } catch {
    /* sem armazenamento: as respostas valem só nesta visita */
  }
}

/** As respostas completas viram o pedido de criar a empresa. */
export function pedidoDeConta(r: RespostasDoOnboarding) {
  const perfil = r.nicho ? { ...perfilDoNicho(r.nicho, r.objetivo || undefined), ...(Object.keys(r.etapas).length ? { etapas: r.etapas } : {}) } : {};
  return { nome: r.empresa.trim(), plano: r.plano || "starter", usuarios: r.usuarios, perfil };
}

/** Aonde a pessoa cai depois de criar a empresa, pelo que ela disse que quer. */
export const destinoDoObjetivo = (objetivo: ObjetivoId | "") => (OBJETIVOS.filter((o) => o.id === objetivo)[0] || { para: "/app" }).para;

type Passo = "nicho" | "objetivo" | "empresa" | "funil" | "acesso";

function Opcao({ marcada, onClick, icone, titulo, linha, dado }: { marcada: boolean; onClick: () => void; icone?: ReactNode; titulo: string; linha?: string; dado: string }) {
  return (
    <button type="button" role="radio" aria-checked={marcada} onClick={onClick} data-opcao={dado} className={juntar("produto-opcao flex min-w-0 items-center rounded-lg p-3 text-left sm:p-3.5", foco)}>
      {icone && <span className={juntar("mr-3 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg", marcada ? "bg-primary text-primary-foreground" : "bg-primary/10 text-primary")}>{icone}</span>}
      <span className="min-w-0 flex-1">
        <span className={juntar(texto.corpo, "block truncate font-medium")}>{titulo}</span>
        {linha && <span className={juntar(texto.auxiliar, "block truncate")}>{linha}</span>}
      </span>
      {marcada && <Check className="ml-2 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />}
    </button>
  );
}

export default function OnboardingDoProduto({ modo, testeDias: testeDiasDeFora, aoCriar, inicial }: { modo: "publico" | "logado"; testeDias?: number; aoCriar?: (destino: string) => void; inicial?: EscolhaDeCompra | null }) {
  const { user, signup } = useAuth();
  const reler = useRelerProduto();
  const planos = useQuery({ queryKey: ["produto", "planos", "onboarding"], queryFn: () => listarPlanos(), staleTime: 300_000, retry: 1 });
  const precos = useQuery({ queryKey: ["produto", "precos", "onboarding"], queryFn: () => lerPrecos(), staleTime: 300_000, retry: 1 });
  const [r, setR] = useState<RespostasDoOnboarding>(() => {
    const guardadas = lerRespostasGuardadas() || VAZIO;
    return inicial ? { ...guardadas, plano: inicial.plano, usuarios: inicial.usuarios, direto: true } : guardadas;
  });
  const [preparando, setPreparando] = useState(false);
  const cobranca = !!(precos.data && precos.data.pagamentos_ativos);
  const testeDias = typeof testeDiasDeFora === "number" ? testeDiasDeFora : precos.data ? precos.data.teste_dias : 7;
  const direto = r.direto === true;
  const [passo, setPasso] = useState<Passo>("nicho");
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [aceito, setAceito] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [esperandoEmail, setEsperandoEmail] = useState(false);
  const criouUmaVez = useRef(false);

  const comAcesso = modo === "publico" && !user;
  const passos: Passo[] = direto
    ? comAcesso ? ["nicho", "empresa", "acesso"] : ["nicho", "empresa"]
    : comAcesso ? ["nicho", "objetivo", "empresa", "funil", "acesso"] : ["nicho", "objetivo", "empresa", "funil"];
  const indice = passos.indexOf(passo);
  const mudar = (parte: Partial<RespostasDoOnboarding>) => {
    const novo = { ...r, ...parte };
    setR(novo);
    guardarRespostas(novo);
  };
  const ir = (p: Passo) => setPasso(p);
  const avancar = () => ir(passos[Math.min(passos.length - 1, indice + 1)]);
  const voltar = () => ir(passos[Math.max(0, indice - 1)]);

  const nicho = NICHOS.filter((n) => n.id === r.nicho)[0] || null;
  const listaDePlanos = planos.data || [];
  const plano = listaDePlanos.filter((p) => p.id === r.plano)[0] || listaDePlanos[0] || null;
  const nomeDaEtapa = (id: EtapaId) => r.etapas[id] || (nicho && nicho.etapas[id]) || NOME_PADRAO_DA_ETAPA[id];

  const criarEmpresa = async (sozinho = false) => {
    if (criouUmaVez.current) return;
    criouUmaVez.current = true;
    setEnviando(true);
    let criada = false;
    try {
      const documento = documentoConferido(r.documento || "");
      await criarConta({ ...pedidoDeConta(r), ...(documento ? { documento } : {}) });
      criada = true;
      let destino = destinoDoObjetivo(r.objetivo);
      guardarRespostas(null);
      // Caminho direto com a cobrança ligada: do cadastro para o cartão, sem parar.
      if (direto && destinoDaCompra({ pagamentosAtivos: cobranca, documento }) === "checkout") {
        try {
          const pedido = await assinar({ plano_id: r.plano || "starter", usuarios: r.usuarios });
          if (pedido.link) {
            window.location.assign(pedido.link);
            return;
          }
        } catch (e) {
          toast.error(fraseDoErro(e, "A empresa foi criada, mas o pagamento não abriu. Tente de novo em Conta, Plano."));
          destino = "/app/conta?parte=plano";
        }
      } else if (direto && cobranca) {
        toast.info("Empresa criada. Para assinar, preencha o CPF ou o CNPJ em Conta, Plano.");
        destino = "/app/conta?parte=plano";
      } else {
        toast.success(testeDias > 0 ? `Empresa criada. Você tem ${testeDias} dias de teste, sem cartão.` : "Empresa criada. Bom trabalho.");
      }
      await reler();
      if (aoCriar) aoCriar(destino);
    } catch (e) {
      if (!criada) criouUmaVez.current = false;
      setPreparando(false);
      if (sozinho) setPasso("empresa");
      toast.error(fraseDoErro(e, "Não foi possível criar a empresa."));
    } finally {
      setEnviando(false);
    }
  };

  // Quem respondeu tudo antes de ter login (ou voltou depois de confirmar o e-mail) não responde de novo.
  const guardadasCompletas = !!r.nicho && r.empresa.trim().length >= 2;
  useEffect(() => {
    if (modo === "logado" && user && guardadasCompletas && lerRespostasGuardadas() && !criouUmaVez.current && !direto) setPasso("funil");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // No caminho direto a empresa nasce sozinha assim que a pessoa entra, já sabendo se a cobrança está ligada.
  const prontoParaConcluir = modo === "logado" && !!user && direto && guardadasCompletas && !precos.isLoading;
  useEffect(() => {
    if (!prontoParaConcluir || criouUmaVez.current || !lerRespostasGuardadas()) return;
    setPreparando(true);
    void criarEmpresa(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prontoParaConcluir]);

  const criarAcesso = async () => {
    if (nome.trim().length < 2) return void toast.error("Diga o seu nome.");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) return void toast.error("Confira o e-mail.");
    if (senha.length < 8) return void toast.error("A senha precisa de 8 caracteres ou mais.");
    if (!aceito) return void toast.error("Aceite os termos para continuar.");
    setEnviando(true);
    try {
      guardarRespostas(r);
      await signup(email.trim(), senha, nome.trim(), r.empresa.trim() || undefined, undefined, `${window.location.origin}/app`);
      // Se o cadastro já entrou, a casca do produto assume daqui; senão, falta confirmar o e-mail.
      setEsperandoEmail(true);
    } catch (e) {
      const msg = String((e as { message?: string }).message || "").toLowerCase();
      toast.error(msg.indexOf("already") >= 0 ? "Esse e-mail já tem cadastro. Entre com ele." : "Não foi possível criar o acesso. Tente de novo.");
    } finally {
      setEnviando(false);
    }
  };

  const pedeDocumento = direto && cobranca;
  const documentoOk = !pedeDocumento || !!documentoConferido(r.documento || "");
  const podeAvancar = passo === "nicho" ? !!r.nicho : passo === "objetivo" ? !!r.objetivo : passo === "empresa" ? r.empresa.trim().length >= 2 && !!plano && documentoOk : true;
  const ultimo = indice === passos.length - 1;
  const TITULO: Record<Passo, string> = {
    nicho: "Qual é o ramo da empresa?",
    objetivo: "O que você mais quer resolver?",
    empresa: "Como a empresa se chama?",
    funil: "O seu funil começa assim",
    acesso: "Crie o seu acesso",
  };
  const APOIO: Record<Passo, string> = {
    nicho: "O funil já nasce com os nomes do seu ramo",
    objetivo: "Você começa pela tela que resolve isso",
    empresa: "E quantas pessoas vão usar",
    funil: "Toque num nome para trocar. Dá para mudar depois",
    acesso: pedeDocumento ? "Último passo antes do pagamento no cartão" : testeDias > 0 ? `${testeDias} dias de teste, sem cartão` : "Leva menos de um minuto",
  };

  if (preparando) {
    return (
      <Moldura passo={passos.length} total={passos.length} comMarca={modo === "publico"}>
        <div data-preparando-o-crm="" role="status">
          <h2 className={texto.tituloPagina}>Montando o seu CRM</h2>
          <p className={juntar(texto.corpo, "mt-2 text-muted-foreground")}>{pedeDocumento ? "Criando a empresa e abrindo o pagamento seguro no cartão." : "Criando a empresa com o funil do seu ramo. Leva poucos segundos."}</p>
        </div>
      </Moldura>
    );
  }

  if (esperandoEmail && !user) {
    return (
      <Moldura passo={passos.length} total={passos.length} comMarca={modo === "publico"}>
        <h2 className={texto.tituloPagina}>Confirme o seu e-mail</h2>
        <p className={juntar(texto.corpo, "mt-2 text-muted-foreground")}>Enviamos um link para {email.trim()}. Ao confirmar, a empresa é criada com o que você já respondeu{pedeDocumento ? " e você segue para o pagamento" : ""}.</p>
        <Link to="/login?next=%2Fapp" className={juntar(botao.secundario, "mt-5")}>Já confirmei, entrar</Link>
      </Moldura>
    );
  }

  return (
    <Moldura passo={indice + 1} total={passos.length} comMarca={modo === "publico"}>
      <div key={passo} className="produto-entra min-w-0" data-passo-do-onboarding={passo}>
        <h2 className={texto.tituloPagina}>{TITULO[passo]}</h2>
        <p className={juntar(texto.auxiliar, "mt-1")}>{APOIO[passo]}</p>

        {passo === "nicho" && (
          <div className="mt-5 grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Ramo da empresa">
            {NICHOS.map((n) => (
              <Opcao key={n.id} dado={n.id} marcada={r.nicho === n.id} icone={ICONE_DO_NICHO[n.id]} titulo={n.nome} linha={n.exemplo} onClick={() => { mudar({ nicho: n.id, etapas: {} }); window.setTimeout(() => ir(direto ? "empresa" : "objetivo"), 140); }} />
            ))}
          </div>
        )}

        {passo === "objetivo" && (
          <div className="mt-5 grid min-w-0 grid-cols-1 gap-2" role="radiogroup" aria-label="Objetivo">
            {OBJETIVOS.map((o) => (
              <Opcao key={o.id} dado={o.id} marcada={r.objetivo === o.id} titulo={o.nome} linha={o.linha} onClick={() => { mudar({ objetivo: o.id }); window.setTimeout(() => ir("empresa"), 140); }} />
            ))}
          </div>
        )}

        {passo === "empresa" && (
          <div className="mt-5 min-w-0 space-y-4">
            <CampoDeFormulario rotulo="Nome da empresa" obrigatorio>
              <input value={r.empresa} onChange={(e) => mudar({ empresa: e.target.value })} className={campoPublico} maxLength={120} autoComplete="organization" autoFocus onKeyDown={(e) => { if (e.key === "Enter" && podeAvancar) avancar(); }} />
            </CampoDeFormulario>
            <div className="flex min-w-0 items-center">
              <span className={juntar(texto.corpo, "mr-3 min-w-0 flex-1")}>Pessoas que vão usar</span>
              <button type="button" className={botao.icone} onClick={() => mudar({ usuarios: Math.max(1, r.usuarios - 1) })} disabled={r.usuarios <= 1} aria-label="Menos uma pessoa"><Minus className="h-4 w-4" aria-hidden="true" /></button>
              <span className="w-10 text-center text-[15px] font-semibold tabular-nums" aria-live="polite">{r.usuarios}</span>
              <button type="button" className={botao.icone} onClick={() => mudar({ usuarios: Math.min(500, r.usuarios + 1) })} aria-label="Mais uma pessoa"><Plus className="h-4 w-4" aria-hidden="true" /></button>
            </div>
            {listaDePlanos.length > 0 && (
              <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Plano">
                {listaDePlanos.map((p) => (
                  <Opcao key={p.id} dado={p.id} marcada={!!plano && plano.id === p.id} titulo={`${p.nome} · ${reais(p.preco_usuario)}`} linha="por usuário, por mês" onClick={() => mudar({ plano: p.id })} />
                ))}
              </div>
            )}
            {pedeDocumento && (
              <CampoDeFormulario rotulo="CPF ou CNPJ" obrigatorio apoio="De quem vai pagar. O Asaas pede para a cobrança no cartão">
                <input value={documentoLegivel(r.documento || "")} onChange={(e) => mudar({ documento: e.target.value.replace(/\D/g, "").slice(0, 14) })} className={campoPublico} inputMode="numeric" autoComplete="off" maxLength={18} data-documento="" />
              </CampoDeFormulario>
            )}
            {plano && <p className={texto.auxiliar}>{pedeDocumento ? "Hoje no cartão" : "Depois do teste"}: <span className="font-semibold text-foreground tabular-nums">{reais(plano.preco_usuario * r.usuarios)}</span> por mês. Sem fidelidade.</p>}
          </div>
        )}

        {passo === "funil" && (
          <ol className="mt-5 min-w-0 space-y-1.5" data-funil-do-onboarding="">
            {ETAPAS_DO_FUNIL.filter((id) => id !== "perdido").map((id, i) => (
              <li key={id} className="flex min-w-0 items-center">
                <span className={juntar("mr-3 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold", id === "ganho" ? "bg-primary text-primary-foreground" : "bg-primary/10 text-primary")}>{id === "ganho" ? <Check className="h-3 w-3" aria-hidden="true" /> : i + 1}</span>
                <input
                  value={nomeDaEtapa(id)}
                  onChange={(e) => mudar({ etapas: { ...r.etapas, [id]: e.target.value.slice(0, 24) } })}
                  aria-label={`Nome da etapa ${i + 1}`}
                  maxLength={24}
                  className={juntar(campo, "h-9 min-w-0 flex-1 border-transparent bg-transparent px-2 hover:border-border focus:border-input")}
                />
              </li>
            ))}
          </ol>
        )}

        {passo === "acesso" && (
          <div className="mt-5 min-w-0 space-y-3">
            <CampoDeFormulario rotulo="Seu nome" obrigatorio>
              <input value={nome} onChange={(e) => setNome(e.target.value)} className={campoPublico} autoComplete="name" maxLength={120} />
            </CampoDeFormulario>
            <CampoDeFormulario rotulo="E-mail" obrigatorio>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={campoPublico} autoComplete="email" inputMode="email" />
            </CampoDeFormulario>
            <CampoDeFormulario rotulo="Senha" obrigatorio apoio="8 caracteres ou mais">
              <CampoDeSenha value={senha} onChange={(e) => setSenha(e.target.value)} autoComplete="new-password" />
            </CampoDeFormulario>
            <label className={juntar(texto.auxiliar, "flex min-w-0 items-start leading-5")}>
              <input type="checkbox" className="mr-2 mt-0.5 h-4 w-4 shrink-0 accent-primary" checked={aceito} onChange={(e) => setAceito(e.target.checked)} />
              <span>Li e aceito os termos de uso e a política de privacidade.</span>
            </label>
            <p className={texto.auxiliar}>Já tem acesso? <Link to="/login?next=%2Fapp" className="font-medium text-primary hover:underline">Entrar</Link></p>
          </div>
        )}
      </div>

      <div className="mt-6 flex min-w-0 items-center">
        {indice > 0 ? (
          <button type="button" className={juntar(botao.discreto, "-ml-2")} onClick={voltar}>
            <ArrowLeft className="mr-1.5 h-4 w-4" aria-hidden="true" />
            Voltar
          </button>
        ) : (
          <span />
        )}
        <span className="min-w-0 flex-1" />
        {passo === "acesso" ? (
          <button type="button" className={botao.primario} onClick={() => void criarAcesso()} disabled={enviando} data-criar-acesso="">
            {enviando ? "Criando..." : pedeDocumento ? "Continuar para o pagamento" : direto ? "Criar acesso e começar" : "Criar acesso"}
          </button>
        ) : ultimo ? (
          <button type="button" className={botao.primario} onClick={() => void criarEmpresa()} disabled={enviando || r.empresa.trim().length < 2} data-criar-empresa="">
            <Briefcase className="mr-1.5 h-4 w-4" aria-hidden="true" />
            {enviando ? "Criando..." : pedeDocumento ? "Ir para o pagamento" : testeDias > 0 ? "Começar o teste" : "Criar empresa"}
          </button>
        ) : (
          <button type="button" className={botao.primario} onClick={avancar} disabled={!podeAvancar} data-avancar="">
            Continuar
            <ArrowRight className="ml-1.5 h-4 w-4" aria-hidden="true" />
          </button>
        )}
      </div>
    </Moldura>
  );
}

/** O cartão de vidro no centro da tela, com a marca e o progresso. */
function Moldura({ passo, total, comMarca = true, children }: { passo: number; total: number; comMarca?: boolean; children: ReactNode }) {
  return (
    <div className="mx-auto w-full min-w-0 max-w-[560px] py-2 sm:py-8" data-onboarding-do-produto="">
      <div className="mb-5 flex min-w-0 items-center">
        {comMarca ? <MarcaAceleriq altura={22} className="logo-do-topo" /> : <span className={texto.auxiliar}>Vamos montar o seu CRM</span>}
        <span className="min-w-0 flex-1" />
        <span className={juntar(texto.auxiliar, "tabular-nums")}>{Math.min(passo, total)} de {total}</span>
      </div>
      <div className="produto-progresso mb-5 h-1 w-full overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={Math.min(passo, total)} aria-label="Andamento">
        <span className="block h-full rounded-full bg-primary" style={{ width: `${Math.round((Math.min(passo, total) / total) * 100)}%` }} />
      </div>
      <div className="produto-vidro-cartao min-w-0 rounded-lg p-5 sm:p-7">{children}</div>
    </div>
  );
}
