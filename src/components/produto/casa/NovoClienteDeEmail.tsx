import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, ArrowRight, Check, Copy, Minus, Plus } from "lucide-react";
import { casa, fraseDoErro, reais } from "@/lib/produto/api";
import { cobrarEntradaEmail } from "@/lib/produto/api";
import { marcarPago, montarMigadu, novoPedidoPelaCasa, registrosDoMigaduParaColar, conferirMigadu } from "@/lib/produto/email-pedidos";
import { JanelaCentral, botao, campo, foco, juntar, texto } from "@/components/sistema";

type Cobranca = "paga" | "cortesia" | "parceiro";
interface Caixa {
  usuario: string;
  pessoa: string;
  convite: string;
}

const DOMINIO = /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * Novo cliente de e-mail numa janela só (19/11/2026): a empresa, o domínio, as caixas (com o e-mail de
 * hoje de cada pessoa, para o convite) e quem paga. No fim:
 *   - cortesia ou parceiro: o e-mail já fica liberado, o domínio e as caixas nascem no Migadu e os
 *     convites saem; a tela mostra os registros de DNS para publicar;
 *   - cliente paga: sai o link de pagamento (migração, 1º mês e ofertas); o resto acontece ao pagar.
 * Quem administra a empresa recebe o convite do painel, onde ele mesmo traz os e-mails antigos.
 */
export default function NovoClienteDeEmail({ onFechar }: { onFechar: () => void }) {
  const qc = useQueryClient();
  const [passo, setPasso] = useState<1 | 2 | 3 | 4>(1);
  const [empresa, setEmpresa] = useState("");
  const [responsavel, setResponsavel] = useState("");
  const [emailResponsavel, setEmailResponsavel] = useState("");
  const [documento, setDocumento] = useState("");
  const [dominio, setDominio] = useState("");
  const [temEmail, setTemEmail] = useState(true);
  const [caixas, setCaixas] = useState<Caixa[]>([{ usuario: "contato", pessoa: "", convite: "" }]);
  const [cobranca, setCobranca] = useState<Cobranca>("paga");
  const [fazendo, setFazendo] = useState("");
  const [erro, setErro] = useState("");
  const [fim, setFim] = useState<{ link?: string; valor?: number; registros?: string; criadas?: number } | null>(null);

  const dom = dominio.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
  const ok1 = empresa.trim().length >= 2 && EMAIL.test(emailResponsavel.trim());
  const ok2 = DOMINIO.test(dom);
  const caixasValidas = caixas.filter((c) => /^[a-z0-9._-]{1,60}$/.test(c.usuario.trim().toLowerCase()));
  const ok3 = caixasValidas.length > 0 && caixasValidas.every((c) => !c.convite.trim() || (EMAIL.test(c.convite.trim()) && !c.convite.trim().toLowerCase().endsWith(`@${dom}`)));

  const mudarCaixa = (i: number, parte: Partial<Caixa>) => setCaixas((l) => l.map((c, k) => (k === i ? { ...c, ...parte } : c)));

  const criar = async () => {
    setErro("");
    try {
      setFazendo("Criando a empresa");
      const { conta_id } = await casa.criarConta({
        nome: empresa.trim(), email: emailResponsavel.trim().toLowerCase(), nome_responsavel: responsavel.trim(), documento: documento.replace(/\D/g, "") || undefined,
        estado: cobranca === "paga" ? undefined : "cortesia", email_ativo: true, crm_ativo: false, email_caixas: caixasValidas.length,
        observacao: cobranca === "parceiro" ? "Parceiro: e-mail sem cobrança." : undefined,
      });
      setFazendo("Registrando o pedido e o domínio");
      const { pedido } = await novoPedidoPelaCasa({ conta_id, dominio: dom, caixas: caixasValidas.length, tipo: temEmail ? "migracao" : "novo", observacao: `Cadastro pela casa (${cobranca}).` });
      const dominioId = await casa.salvarDominio({ conta_id, dominio: dom, provedor: "migadu", estado: "levantamento", correio_provedor: "migadu", correio_ligado: true } as unknown as Parameters<typeof casa.salvarDominio>[0]);
      setFazendo("Cadastrando as caixas");
      for (const c of caixasValidas) {
        await casa.salvarCaixa({
          dominio_id: dominioId, conta_id, endereco: `${c.usuario.trim().toLowerCase()}@${dom}`, pessoa: c.pessoa.trim(), tipo: "caixa", estado: "pedida",
          email_convite: c.convite.trim().toLowerCase() || null,
        } as Parameters<typeof casa.salvarCaixa>[0]);
      }
      if (cobranca === "paga") {
        setFazendo("Gerando o link de pagamento");
        try {
          const r = await cobrarEntradaEmail({ conta_id, ...(documento.replace(/\D/g, "") ? { documento: documento.replace(/\D/g, "") } : {}) });
          setFim({ link: r.link, valor: r.valor });
        } catch (e) {
          setFim({});
          toast.error(fraseDoErro(e, "A empresa foi criada, mas o link não saiu. Gere em Entradas."));
        }
      } else {
        setFazendo("Liberando o e-mail");
        await marcarPago({ pedido_id: pedido.id, forma: "cortesia" });
        setFazendo("Criando o domínio e as caixas no Migadu");
        let registros = "";
        let criadas = 0;
        try {
          const m = await montarMigadu(dominioId);
          criadas = m.criadas.length;
          const conf = await conferirMigadu(dominioId);
          registros = registrosDoMigaduParaColar(conf.registros);
        } catch (e) {
          toast.error(fraseDoErro(e, "O e-mail foi liberado, mas o Migadu não respondeu agora. Clique em Montar no domínio."));
        }
        setFim({ registros, criadas });
      }
      void qc.invalidateQueries({ queryKey: ["produto"] });
    } catch (e) {
      setErro(fraseDoErro(e, "Não foi possível cadastrar agora."));
    } finally {
      setFazendo("");
    }
  };

  const titulo = fim ? "Cliente cadastrado" : ({ 1: "A empresa", 2: "O domínio", 3: "As caixas", 4: "Quem paga" } as const)[passo];
  const pode = passo === 1 ? ok1 : passo === 2 ? ok2 : passo === 3 ? ok3 : true;

  return (
    <JanelaCentral
      aberta
      onFechar={onFechar}
      largura="md"
      titulo={titulo}
      ajuda={fim ? undefined : `Passo ${passo} de 4`}
      rodape={
        fim ? (
          <button type="button" className={botao.primario} onClick={onFechar}>Pronto</button>
        ) : (
          <div className="flex w-full items-center">
            {passo > 1 ? <button type="button" className={botao.discreto} onClick={() => setPasso((p) => (p - 1) as 1 | 2 | 3 | 4)} disabled={!!fazendo}><ArrowLeft className="mr-1.5 h-4 w-4" aria-hidden="true" />Voltar</button> : <span />}
            <span className="flex-1" />
            {passo < 4 ? (
              <button type="button" className={botao.primario} disabled={!pode} onClick={() => setPasso((p) => (p + 1) as 1 | 2 | 3 | 4)} data-avancar-cadastro="">Continuar<ArrowRight className="ml-1.5 h-4 w-4" aria-hidden="true" /></button>
            ) : (
              <button type="button" className={botao.primario} disabled={!!fazendo} onClick={() => void criar()} data-criar-cliente="">{fazendo ? `${fazendo}...` : "Cadastrar cliente"}</button>
            )}
          </div>
        )
      }
    >
      {fim ? (
        <div className="space-y-4" data-cliente-cadastrado="">
          <p className={texto.corpo}><b>{empresa}</b> foi cadastrada. {emailResponsavel} recebeu o convite do painel, onde a pessoa acompanha tudo e traz os e-mails antigos sozinha.</p>
          {fim.link && (
            <div className="rounded-2xl bg-muted p-4">
              <p className={juntar(texto.corpo, "font-semibold")}>Link de pagamento{fim.valor ? ` (${reais(fim.valor)})` : ""}</p>
              <p className={juntar(texto.auxiliar, "mt-1 break-all")}>{fim.link}</p>
              <button type="button" className={juntar(botao.secundario, "mt-3")} onClick={() => void navigator.clipboard.writeText(fim.link!).then(() => toast.success("Link copiado."))}><Copy className="mr-1.5 h-4 w-4" aria-hidden="true" />Copiar o link</button>
              <p className={juntar(texto.auxiliar, "mt-2")}>Quando o pagamento cair, o e-mail libera sozinho e a mensalidade começa no mês que vem.</p>
            </div>
          )}
          {fim.registros && (
            <div className="rounded-2xl border border-border p-4">
              <p className={juntar(texto.corpo, "font-semibold")}>{fim.criadas ? `${fim.criadas} caixa(s) criada(s) e convites enviados.` : "Domínio criado no Migadu."} Agora publique no DNS:</p>
              <pre className="mt-2 max-h-48 overflow-auto rounded-xl bg-muted p-3 text-[12px] leading-5">{fim.registros}</pre>
              <button type="button" className={juntar(botao.secundario, "mt-3")} onClick={() => void navigator.clipboard.writeText(fim.registros!).then(() => toast.success("Registros copiados."))}><Copy className="mr-1.5 h-4 w-4" aria-hidden="true" />Copiar os registros</button>
              <p className={juntar(texto.auxiliar, "mt-2")}>Depois de publicar, abra o domínio em E-mail e clique em Ativar.</p>
            </div>
          )}
        </div>
      ) : passo === 1 ? (
        <div className="space-y-4">
          <Campo rotulo="Nome da empresa" valor={empresa} aoMudar={setEmpresa} dado="empresa" />
          <Campo rotulo="Quem vai administrar" valor={responsavel} aoMudar={setResponsavel} dado="responsavel" />
          <Campo rotulo="E-mail de hoje dessa pessoa" apoio="Recebe o convite do painel." valor={emailResponsavel} aoMudar={setEmailResponsavel} tipo="email" dado="email-responsavel" />
          <Campo rotulo="CPF ou CNPJ (opcional)" apoio="Vai na fatura, quando o cliente paga." valor={documento} aoMudar={setDocumento} dado="documento" />
        </div>
      ) : passo === 2 ? (
        <div className="space-y-4">
          <Campo rotulo="Domínio" apoio="O que vem depois do @ no e-mail da empresa." valor={dominio} aoMudar={setDominio} placeholder="empresa.com.br" dado="dominio" />
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Escolha ativa={temEmail} titulo="Já tem e-mail hoje" descricao="Os e-mails antigos vêm junto (o cliente traz pelo painel)." aoEscolher={() => setTemEmail(true)} />
            <Escolha ativa={!temEmail} titulo="E-mail novo" descricao="O domínio ainda não tem e-mail. Sem migração." aoEscolher={() => setTemEmail(false)} />
          </div>
        </div>
      ) : passo === 3 ? (
        <div className="space-y-3" data-caixas-do-cadastro="">
          {caixas.map((c, i) => (
            <div key={i} className="grid grid-cols-1 gap-2 rounded-2xl border border-border p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
              <label className="block">
                <span className={juntar(texto.auxiliar, "mb-1 block")}>Endereço</span>
                <span className="flex items-center"><input value={c.usuario} onChange={(e) => mudarCaixa(i, { usuario: e.target.value })} className={juntar(campo, "min-w-0 flex-1")} autoCapitalize="none" /><span className={juntar(texto.auxiliar, "ml-1.5 shrink-0")}>@{dom || "dominio"}</span></span>
              </label>
              <label className="block">
                <span className={juntar(texto.auxiliar, "mb-1 block")}>Quem usa · e-mail de hoje (convite)</span>
                <input value={c.pessoa} onChange={(e) => mudarCaixa(i, { pessoa: e.target.value })} className={juntar(campo, "mb-1.5")} placeholder="Nome" />
                <input value={c.convite} onChange={(e) => mudarCaixa(i, { convite: e.target.value })} className={campo} placeholder="pessoa@gmail.com" autoCapitalize="none" inputMode="email" />
              </label>
              <button type="button" className={juntar(botao.icone, "self-center")} onClick={() => setCaixas((l) => l.filter((_, k) => k !== i))} disabled={caixas.length === 1} aria-label="Tirar esta caixa"><Minus className="h-4 w-4" aria-hidden="true" /></button>
            </div>
          ))}
          <button type="button" className={botao.secundario} onClick={() => setCaixas((l) => [...l, { usuario: "", pessoa: "", convite: "" }])}><Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />Mais uma caixa</button>
          <p className={texto.auxiliar}>Cada pessoa recebe o convite no e-mail de hoje e cria a própria senha. Sem o e-mail de hoje, o convite vai para quem administra.</p>
        </div>
      ) : (
        <div className="space-y-2">
          <Escolha ativa={cobranca === "paga"} titulo="Cliente paga" descricao="Sai o link de pagamento (migração, 1º mês e ofertas). O e-mail libera ao pagar." aoEscolher={() => setCobranca("paga")} />
          <Escolha ativa={cobranca === "cortesia"} titulo="Cortesia (empresa da casa)" descricao="Sem cobrança. O e-mail já sai criado." aoEscolher={() => setCobranca("cortesia")} />
          <Escolha ativa={cobranca === "parceiro"} titulo="Parceiro, sem cobrança" descricao="Igual à cortesia, marcado como parceiro." aoEscolher={() => setCobranca("parceiro")} />
          {erro && <p className={juntar(texto.corpo, "pt-2 font-medium text-destructive")} role="alert">{erro}</p>}
        </div>
      )}
    </JanelaCentral>
  );
}

function Campo({ rotulo, apoio, valor, aoMudar, tipo, placeholder, dado }: { rotulo: string; apoio?: string; valor: string; aoMudar: (v: string) => void; tipo?: string; placeholder?: string; dado: string }) {
  return (
    <label className="block">
      <span className={juntar(texto.auxiliar, "mb-1.5 block font-medium")}>{rotulo}</span>
      <input value={valor} onChange={(e) => aoMudar(e.target.value)} className={campo} type={tipo || "text"} placeholder={placeholder} autoCapitalize={tipo === "email" ? "none" : undefined} data-campo={dado} />
      {apoio && <span className={juntar(texto.auxiliar, "mt-1 block")}>{apoio}</span>}
    </label>
  );
}

function Escolha({ ativa, titulo, descricao, aoEscolher }: { ativa: boolean; titulo: string; descricao: string; aoEscolher: () => void }) {
  return (
    <button type="button" onClick={aoEscolher} aria-pressed={ativa} className={juntar("flex w-full min-w-0 items-start rounded-2xl border p-3.5 text-left", foco, ativa ? "border-primary bg-accent-soft" : "border-border hover:bg-muted")}>
      <span className={juntar("mr-3 mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border", ativa ? "border-primary bg-primary text-primary-foreground" : "border-border")} aria-hidden="true">{ativa && <Check className="h-3 w-3" />}</span>
      <span className="min-w-0">
        <span className={juntar(texto.corpo, "block font-semibold")}>{titulo}</span>
        <span className={juntar(texto.auxiliar, "block leading-5")}>{descricao}</span>
      </span>
    </button>
  );
}
