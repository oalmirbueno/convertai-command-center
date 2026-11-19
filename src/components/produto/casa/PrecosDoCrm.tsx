import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, CreditCard, Pencil, Plus } from "lucide-react";
import { casa, fraseDoErro, lerConfig, listarPlanos, reais, type ConfigDoProduto, type PlanoDoProduto } from "@/lib/produto/api";
import { CardSurface, Chip, HelpTooltip, OverflowMenu, StatusPill } from "@/components/ds";
import { CampoDeFormulario, Carregando, EstadoDeErro, EstadoVazio, GrupoDeCampos, JanelaCentral, Secao, botao, campo, campoTexto, juntar, texto } from "@/components/sistema";

/**
 * Planos e preços do CRM (19/11/2026, dono: "a cobrança no cartão e os planos e preços estão muito
 * ruins, muito antigos"). Três blocos: a cobrança no cartão (ligada ou desligada, uma ação), os planos
 * lado a lado como o cliente vê na escolha (preço por usuário em destaque e o que inclui) e os prazos
 * e custos da casa. O que muda aqui vale para quem assinar daqui em diante; quem já assina só muda de
 * valor quando a janela da empresa é salva (o valor novo vai para o Asaas naquele momento).
 *
 * Saiu de PrecosDoProduto (que continua atendendo o preço do e-mail) para cada produto ter a sua tela.
 */

const numeroDe = (v: string) => {
  const n = parseFloat(String(v).replace(/\./g, "").replace(",", "."));
  return isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : 0;
};
const paraCampo = (n: number) => String(n).replace(".", ",");
const AJUDA_DA_COBRANCA = "Com a cobrança desligada ninguém consegue abrir o checkout: as empresas ficam em teste ou em cortesia. Ligue depois de conferir a chave do Asaas em Configurações e de cadastrar no Asaas o endereço de aviso deste produto.";

/** Os itens curtos de um plano: os recursos e os limites que a tela já tem. */
export function itensDoPlano(p: PlanoDoProduto): string[] {
  const limites: string[] = [];
  if (p.limites.maquina_buscas_mes > 0) limites.push(`${p.limites.maquina_buscas_mes} buscas de leads por mês${p.limites.maquina_google_maps ? " com Google Maps" : ""}`);
  if (p.email_caixas_incluidas > 0) limites.push(`E-mail incluído, ${p.email_caixas_incluidas} ${p.email_caixas_incluidas === 1 ? "caixa" : "caixas"}`);
  if (p.limites.campanhas) limites.push("Campanhas e custo por cliente");
  if (p.limites.privacidade_por_vendedor) limites.push("Cada vendedor vê só os seus");
  return p.recursos.concat(limites.filter((l) => p.recursos.indexOf(l) < 0));
}

export default function PrecosDoCrm() {
  const qc = useQueryClient();
  const planos = useQuery({ queryKey: ["produto", "planos", "todos"], queryFn: () => listarPlanos(true) });
  const config = useQuery({ queryKey: ["produto", "config"], queryFn: lerConfig });
  const [editando, setEditando] = useState<PlanoDoProduto | "novo" | null>(null);
  const [f, setF] = useState<Record<string, string>>({});
  const [salvando, setSalvando] = useState(false);
  const [confirmar, setConfirmar] = useState<"ligar" | "desligar" | null>(null);
  const [mudando, setMudando] = useState(false);
  const [testando, setTestando] = useState(false);
  const [teste, setTeste] = useState<{ ok: boolean; ambiente?: string; link?: string; mensagem?: string } | null>(null);

  const c = config.data;
  useEffect(() => {
    if (!c) return;
    setF({
      teste_dias: String(c.teste_dias),
      tolerancia_dias: String(c.tolerancia_dias),
      custo_fixo_mensal: paraCampo(c.custo_fixo_mensal),
      custo_lugar_google_usd: paraCampo(c.custo_lugar_google_usd),
      dolar: paraCampo(c.dolar),
      imposto_pct: paraCampo(c.imposto_pct),
    });
  }, [c]);

  const reler = () => {
    void qc.invalidateQueries({ queryKey: ["produto", "planos"] });
    void qc.invalidateQueries({ queryKey: ["produto", "config"] });
    void qc.invalidateQueries({ queryKey: ["produto", "faturamento"] });
  };

  const testarAsaas = async () => {
    setTestando(true);
    try {
      setTeste(await casa.testarAsaas());
    } catch (e) {
      setTeste({ ok: false, mensagem: fraseDoErro(e, "Não foi possível falar com o Asaas agora.") });
    } finally {
      setTestando(false);
    }
  };

  const ligarCobranca = async (ligar: boolean) => {
    setMudando(true);
    try {
      await casa.salvarConfig({ pagamentos_ativos: ligar });
      reler();
      setConfirmar(null);
      toast.success(ligar ? "Cobrança ligada: o checkout está aberto." : "Cobrança desligada.");
    } catch (e) {
      toast.error(fraseDoErro(e));
    } finally {
      setMudando(false);
    }
  };

  const salvarConfig = async () => {
    const usd = parseFloat(String(f.custo_lugar_google_usd || "0").replace(",", "."));
    const dados: Partial<ConfigDoProduto> = {
      teste_dias: Math.max(0, Math.min(60, Math.floor(Number(f.teste_dias) || 0))),
      tolerancia_dias: Math.max(0, Math.min(30, Math.floor(Number(f.tolerancia_dias) || 0))),
      custo_fixo_mensal: numeroDe(f.custo_fixo_mensal),
      custo_lugar_google_usd: isFinite(usd) && usd >= 0 ? usd : 0,
      dolar: Math.max(0.01, numeroDe(f.dolar)),
      imposto_pct: Math.min(100, numeroDe(f.imposto_pct)),
    };
    setSalvando(true);
    try {
      await casa.salvarConfig(dados);
      reler();
      toast.success("Prazos e custos salvos.");
    } catch (e) {
      toast.error(fraseDoErro(e, "Não foi possível salvar."));
    } finally {
      setSalvando(false);
    }
  };

  const campoDe = (chave: string, rotulo: string, apoio?: string, sufixo?: string) => (
    <CampoDeFormulario rotulo={rotulo} apoio={apoio}>
      <span className="relative block min-w-0">
        <input value={f[chave] || ""} onChange={(e) => setF({ ...f, [chave]: e.target.value })} className={juntar(campo, sufixo && "pr-12")} inputMode="decimal" />
        {sufixo && <span className={juntar(texto.auxiliar, "pointer-events-none absolute right-3 top-1/2 -translate-y-1/2")}>{sufixo}</span>}
      </span>
    </CampoDeFormulario>
  );

  const tentarDeNovo = (
    <button type="button" className={juntar(botao.secundario, "h-8")} onClick={() => { void planos.refetch(); void config.refetch(); }}>Tentar de novo</button>
  );
  const todos = planos.data || [];
  const aVenda = todos.filter((p) => p.ativo).length;
  const ligada = !!c && c.pagamentos_ativos;

  return (
    <div className="min-w-0 space-y-8" data-precos-do-produto="" data-precos-do-crm="">
      {/* Cobrança no cartão: estado claro e uma ação. */}
      {config.isLoading ? (
        <div className="h-[104px] animate-pulse rounded-lg bg-muted" aria-busy="true" aria-label="Carregando a cobrança" />
      ) : config.isError || !c ? (
        <EstadoDeErro acao={tentarDeNovo} />
      ) : (
        <CardSurface className="min-w-0 p-5 sm:p-6" data-cobranca-no-cartao={ligada ? "ligada" : "desligada"}>
          <div className="flex min-w-0 flex-wrap items-center">
            <span className={juntar("mr-4 inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full", ligada ? "bg-success-soft text-success" : "bg-muted text-muted-foreground")} aria-hidden="true">
              <CreditCard className="h-5 w-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex min-w-0 items-center">
                <span className={juntar(texto.tituloSecao, "truncate")}>Cobrança no cartão</span>
                <HelpTooltip className="ml-1" title="Cobrança no cartão">{AJUDA_DA_COBRANCA}</HelpTooltip>
              </span>
              <span className="mt-1.5 flex min-w-0 flex-wrap items-center">
                <StatusPill tone={ligada ? "success" : "neutral"} pulse={ligada}>{ligada ? "Ligada" : "Desligada"}</StatusPill>
                <span className={juntar(texto.auxiliar, "ml-2 truncate")}>{ligada ? "o checkout está aberto e o Asaas cobra todo mês" : "ninguém assina por enquanto"}</span>
              </span>
            </span>
            <span className="mt-3 flex w-full shrink-0 items-center justify-end sm:ml-4 sm:mt-0 sm:w-auto [&>*+*]:ml-1">
              {ligada ? (
                <button type="button" className={botao.secundario} onClick={() => setConfirmar("desligar")} data-desligar-cobranca="">Desligar</button>
              ) : (
                <button type="button" className={botao.primario} onClick={() => setConfirmar("ligar")} data-ligar-cobranca="">Ligar a cobrança</button>
              )}
              <OverflowMenu label="Mais da cobrança" items={[{ label: testando ? "Testando o Asaas..." : "Testar o Asaas", onSelect: () => void testarAsaas(), disabled: testando, hint: "Abre um checkout de teste sem cobrar ninguém" }]} />
            </span>
          </div>
          {(teste || testando) && (
            <div className={juntar("mt-4 flex min-w-0 items-center border-t border-border pt-4")} data-resultado-do-teste="">
              {testando ? (
                <span className={texto.auxiliar}>Falando com o Asaas...</span>
              ) : teste && teste.ok ? (
                <>
                  <Chip tone="success" dot>Asaas aceitou</Chip>
                  <span className={juntar(texto.auxiliar, "ml-2 min-w-0 flex-1 truncate")}>{teste.ambiente === "sandbox" ? "ambiente de teste" : "conta de produção"} · ninguém foi cobrado · o link vale 10 minutos</span>
                  {teste.link && <a href={teste.link} target="_blank" rel="noreferrer" className={juntar(botao.discreto, "ml-2 h-8")}>Ver a página</a>}
                </>
              ) : teste ? (
                <>
                  <Chip tone="danger" dot>Asaas recusou</Chip>
                  <span className={juntar(texto.auxiliar, "ml-2 min-w-0 flex-1 truncate text-destructive")} title={teste.mensagem}>{teste.mensagem}</span>
                </>
              ) : null}
            </div>
          )}
        </CardSurface>
      )}

      {/* Planos lado a lado. */}
      <Secao
        titulo="Planos"
        descricao={planos.data ? `${aVenda} à venda${todos.length > aVenda ? ` · ${todos.length - aVenda} fora` : ""}` : undefined}
        ajuda="O preço é por usuário, por mês. Mudar o preço não mexe em quem já assina: o valor novo só vai para o Asaas quando a janela da empresa é salva."
        recolher={false}
        acao={
          <button type="button" className={juntar(botao.secundario, "h-8")} onClick={() => setEditando("novo")} aria-label="Novo plano" title="Novo plano">
            <Plus className="h-4 w-4 sm:mr-1.5" aria-hidden="true" />
            <span className="hidden sm:inline">Plano</span>
          </button>
        }
      >
        {planos.isLoading ? (
          <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-busy="true" aria-label="Carregando os planos">
            {[0, 1, 2].map((i) => <div key={i} className="h-[320px] animate-pulse rounded-lg bg-muted" />)}
          </div>
        ) : planos.isError ? (
          <EstadoDeErro acao={tentarDeNovo} />
        ) : todos.length === 0 ? (
          <EstadoVazio compacto titulo="Nenhum plano ainda." acao={<button type="button" className={juntar(botao.primario, "h-8")} onClick={() => setEditando("novo")}>Criar o primeiro</button>} />
        ) : (
          <ul className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3" data-planos-do-produto="">
            {todos.map((p) => {
              const itens = itensDoPlano(p);
              return (
                <CardSurface
                  as="li"
                  key={p.id}
                  className={juntar("flex min-w-0 flex-col p-5 sm:p-6", p.destaque && "border-primary/60 ring-1 ring-primary/40", !p.ativo && "opacity-70")}
                  data-plano={p.id}
                >
                  <span className="flex min-w-0 items-center">
                    <span className={juntar(texto.tituloSecao, "min-w-0 flex-1 truncate")}>{p.nome}</span>
                    {p.destaque && <Chip tone="accent" className="ml-2">Mais completo</Chip>}
                    {!p.ativo && <Chip className="ml-2">Fora de venda</Chip>}
                  </span>
                  {p.resumo && <span className={juntar(texto.auxiliar, "mt-1 block truncate")} title={p.resumo}>{p.resumo}</span>}
                  <span className="mt-5 flex min-w-0 items-baseline">
                    <span className={texto.numeroGrande}>{reais(p.preco_usuario)}</span>
                    <span className={juntar(texto.auxiliar, "ml-2 shrink-0")}>por usuário</span>
                  </span>
                  <span className={juntar(texto.auxiliar, "mt-1 block")}>{p.minimo_usuarios > 1 ? `mínimo de ${p.minimo_usuarios} usuários` : "por mês, a partir de 1 usuário"}</span>
                  <ul className="mt-5 min-w-0 flex-1 space-y-2 border-t border-border pt-4">
                    {itens.slice(0, 7).map((i) => (
                      <li key={i} className="flex min-w-0 items-start">
                        <Check className="mr-2 mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                        <span className={juntar(texto.corpo, "min-w-0 truncate")} title={i}>{i}</span>
                      </li>
                    ))}
                    {itens.length > 7 && <li className={juntar(texto.auxiliar, "pl-6")}>e mais {itens.length - 7}</li>}
                    {itens.length === 0 && <li className={texto.auxiliar}>Sem itens. Edite para contar o que inclui.</li>}
                  </ul>
                  <button type="button" className={juntar(botao.secundario, "mt-5 w-full")} onClick={() => setEditando(p)} aria-label={`Editar o plano ${p.nome}`}>
                    <Pencil className="mr-1.5 h-4 w-4" aria-hidden="true" />
                    Editar
                  </button>
                </CardSurface>
              );
            })}
          </ul>
        )}
      </Secao>

      {/* Prazos e custos da casa. */}
      <Secao
        titulo="Prazos e custos"
        ajuda="Os prazos valem para toda empresa nova. Os custos servem para a margem no Financeiro: custo fixo do produto no mês, custo de cada lugar buscado no Google Maps e o imposto sobre o que é recebido."
        recolher="produto:crm:precos:prazos"
        acao={c ? <button type="button" className={juntar(botao.primario, "h-8")} onClick={() => void salvarConfig()} disabled={salvando} data-salvar-precos="">{salvando ? "Salvando..." : "Salvar"}</button> : undefined}
      >
        {config.isLoading ? (
          <Carregando linhas={3} rotulo="Carregando os prazos" />
        ) : !c ? null : (
          <div className="grid min-w-0 grid-cols-1 gap-x-8 gap-y-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
            <GrupoDeCampos titulo="Prazos" colunas={1}>
              {campoDe("teste_dias", "Teste grátis", undefined, "dias")}
              {campoDe("tolerancia_dias", "Tolerância no atraso", "Depois disso o acesso pausa", "dias")}
            </GrupoDeCampos>
            <GrupoDeCampos titulo="Custos da casa">
              {campoDe("custo_fixo_mensal", "Custo fixo do produto", "por mês", "R$")}
              {campoDe("imposto_pct", "Imposto sobre o recebido", undefined, "%")}
              {campoDe("custo_lugar_google_usd", "Lugar no Google Maps", "por lugar buscado", "US$")}
              {campoDe("dolar", "Dólar", undefined, "R$")}
            </GrupoDeCampos>
          </div>
        )}
      </Secao>

      {editando && <EditorDePlano plano={editando === "novo" ? null : editando} onFechar={() => setEditando(null)} onSalvo={() => { reler(); setEditando(null); }} />}

      <JanelaCentral
        aberta={!!confirmar}
        onFechar={() => setConfirmar(null)}
        largura="sm"
        titulo={confirmar === "desligar" ? "Desligar a cobrança no cartão?" : "Ligar a cobrança no cartão?"}
        rodape={
          <>
            <button type="button" className={botao.secundario} onClick={() => setConfirmar(null)}>Agora não</button>
            <button type="button" className={confirmar === "desligar" ? botao.perigo : botao.primario} onClick={() => void ligarCobranca(confirmar !== "desligar")} disabled={mudando} data-confirmar-cobranca="">
              {mudando ? "Salvando..." : confirmar === "desligar" ? "Desligar" : "Ligar"}
            </button>
          </>
        }
      >
        <p className={texto.corpo}>
          {confirmar === "desligar"
            ? "O checkout fecha: ninguém novo consegue assinar. Quem já assina continua sendo cobrado pelo Asaas."
            : "A partir de agora quem administra uma empresa consegue assinar com cartão, e o Asaas passa a cobrar todo mês."}
        </p>
      </JanelaCentral>
    </div>
  );
}

function EditorDePlano({ plano, onFechar, onSalvo }: { plano: PlanoDoProduto | null; onFechar: () => void; onSalvo: () => void }) {
  const [f, setF] = useState({
    id: plano ? plano.id : "",
    nome: plano ? plano.nome : "",
    resumo: plano ? plano.resumo : "",
    preco: plano ? paraCampo(plano.preco_usuario) : "",
    minimo: plano ? String(plano.minimo_usuarios) : "1",
    recursos: plano ? plano.recursos.join("\n") : "",
    buscas: plano ? String(plano.limites.maquina_buscas_mes) : "5",
    porBusca: plano ? String(plano.limites.maquina_limite_por_busca) : "50",
    google: plano ? plano.limites.maquina_google_maps : false,
    privacidade: plano ? plano.limites.privacidade_por_vendedor : false,
    campanhas: plano ? plano.limites.campanhas : false,
    caixas: plano ? String(plano.email_caixas_incluidas) : "0",
    destaque: plano ? plano.destaque : false,
    ativo: plano ? plano.ativo : true,
    ordem: plano ? String(plano.ordem) : "9",
  });
  const [salvando, setSalvando] = useState(false);
  const salvar = async () => {
    const id = (plano ? plano.id : f.id.trim().toLowerCase().replace(/[^a-z0-9_]/g, "_")).slice(0, 40);
    if (!/^[a-z0-9_]{2,40}$/.test(id)) return void toast.error("Dê um código curto ao plano, só com letras e números.");
    if (f.nome.trim().length < 2) return void toast.error("Dê um nome ao plano.");
    setSalvando(true);
    try {
      await casa.salvarPlano({
        id,
        nome: f.nome.trim(),
        resumo: f.resumo.trim(),
        preco_usuario: numeroDe(f.preco),
        minimo_usuarios: Math.max(1, Math.floor(Number(f.minimo) || 1)),
        recursos: f.recursos.split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 12),
        limites: {
          maquina_buscas_mes: Math.max(0, Math.floor(Number(f.buscas) || 0)),
          maquina_google_maps: f.google,
          maquina_limite_por_busca: Math.max(1, Math.min(300, Math.floor(Number(f.porBusca) || 50))),
          privacidade_por_vendedor: f.privacidade,
          campanhas: f.campanhas,
        },
        email_caixas_incluidas: Math.max(0, Math.floor(Number(f.caixas) || 0)),
        destaque: f.destaque,
        ativo: f.ativo,
        ordem: Math.floor(Number(f.ordem) || 0),
      });
      toast.success("Plano salvo.");
      onSalvo();
    } catch (e) {
      toast.error(fraseDoErro(e, "Não foi possível salvar o plano."));
    } finally {
      setSalvando(false);
    }
  };
  const marcar = (chave: "google" | "privacidade" | "campanhas" | "destaque" | "ativo", rotulo: string) => (
    <label className={juntar(texto.corpo, "flex min-w-0 items-center")}>
      <input type="checkbox" className="mr-2" checked={f[chave]} onChange={(e) => setF({ ...f, [chave]: e.target.checked })} />
      {rotulo}
    </label>
  );
  return (
    <JanelaCentral
      aberta
      onFechar={onFechar}
      largura="lg"
      titulo={plano ? `Plano ${plano.nome}` : "Novo plano"}
      descricao={f.preco ? `${reais(numeroDe(f.preco))} por usuário` : undefined}
      ajuda="O preço é por usuário, por mês. Mudar o preço não mexe em quem já assina: o valor novo só vai para o Asaas quando a janela da empresa é salva."
      rodape={<button type="button" className={botao.primario} onClick={() => void salvar()} disabled={salvando} data-salvar-plano="">{salvando ? "Salvando..." : "Salvar"}</button>}
    >
      <div className="min-w-0 space-y-6">
        <GrupoDeCampos titulo="O plano">
          {!plano && (
            <CampoDeFormulario rotulo="Código" apoio="Não muda depois. Ex.: equipe">
              <input value={f.id} onChange={(e) => setF({ ...f, id: e.target.value })} className={campo} maxLength={40} autoCapitalize="none" />
            </CampoDeFormulario>
          )}
          <CampoDeFormulario rotulo="Nome" obrigatorio>
            <input value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} className={campo} maxLength={60} />
          </CampoDeFormulario>
          <CampoDeFormulario rotulo="Preço por usuário, por mês (R$)" obrigatorio>
            <input value={f.preco} onChange={(e) => setF({ ...f, preco: e.target.value })} className={campo} inputMode="decimal" />
          </CampoDeFormulario>
          <CampoDeFormulario rotulo="Mínimo de usuários">
            <input value={f.minimo} onChange={(e) => setF({ ...f, minimo: e.target.value })} className={campo} inputMode="numeric" />
          </CampoDeFormulario>
          <CampoDeFormulario rotulo="Frase do plano" largo>
            <input value={f.resumo} onChange={(e) => setF({ ...f, resumo: e.target.value })} className={campo} maxLength={120} />
          </CampoDeFormulario>
          <CampoDeFormulario rotulo="O que inclui" apoio="Uma linha por item, como aparece para o cliente" largo>
            <textarea value={f.recursos} onChange={(e) => setF({ ...f, recursos: e.target.value })} className={campoTexto} rows={5} />
          </CampoDeFormulario>
        </GrupoDeCampos>
        <GrupoDeCampos titulo="Limites">
          <CampoDeFormulario rotulo="Buscas da Máquina de leads por mês">
            <input value={f.buscas} onChange={(e) => setF({ ...f, buscas: e.target.value })} className={campo} inputMode="numeric" />
          </CampoDeFormulario>
          <CampoDeFormulario rotulo="Empresas por busca, no máximo">
            <input value={f.porBusca} onChange={(e) => setF({ ...f, porBusca: e.target.value })} className={campo} inputMode="numeric" />
          </CampoDeFormulario>
          <CampoDeFormulario rotulo="Caixas de e-mail incluídas" apoio="Zero: o e-mail é cobrado à parte">
            <input value={f.caixas} onChange={(e) => setF({ ...f, caixas: e.target.value })} className={campo} inputMode="numeric" />
          </CampoDeFormulario>
          <CampoDeFormulario rotulo="Ordem na lista">
            <input value={f.ordem} onChange={(e) => setF({ ...f, ordem: e.target.value })} className={campo} inputMode="numeric" />
          </CampoDeFormulario>
          <div className="min-w-0 space-y-2 sm:col-span-2">
            {marcar("google", "Máquina de leads com Google Maps")}
            {marcar("campanhas", "Campanhas e custo por cliente")}
            {marcar("privacidade", "Cada vendedor vê só os próprios negócios")}
            {marcar("destaque", "Mostrar como o mais completo")}
            {marcar("ativo", "À venda")}
          </div>
        </GrupoDeCampos>
      </div>
    </JanelaCentral>
  );
}
