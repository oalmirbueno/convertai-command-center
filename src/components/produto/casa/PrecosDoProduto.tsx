import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Pencil, Plus } from "lucide-react";
import { casa, fraseDoErro, lerConfig, listarPlanos, reais, type ConfigDoProduto, type PlanoDoProduto } from "@/lib/produto/api";
import {
  CampoDeFormulario,
  Carregando,
  EstadoDeErro,
  GrupoDeCampos,
  JanelaCentral,
  Secao,
  botao,
  campo,
  campoTexto,
  etiqueta,
  juntar,
  lista,
  texto,
} from "@/components/sistema";

const numeroDe = (v: string) => {
  const n = parseFloat(String(v).replace(/\./g, "").replace(",", "."));
  return isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : 0;
};
const paraCampo = (n: number) => String(n).replace(".", ",");

/**
 * Planos, preços do e-mail, prazos e os custos da casa. O que muda aqui vale
 * para quem assinar daqui em diante; quem já assina só muda de valor quando a
 * ficha da empresa é salva (o valor novo vai para o Asaas naquele momento).
 */
export default function PrecosDoProduto() {
  const qc = useQueryClient();
  const planos = useQuery({ queryKey: ["produto", "planos", "todos"], queryFn: () => listarPlanos(true) });
  const config = useQuery({ queryKey: ["produto", "config"], queryFn: lerConfig });
  const [editando, setEditando] = useState<PlanoDoProduto | "novo" | null>(null);
  const [f, setF] = useState<Record<string, string>>({});
  const [salvando, setSalvando] = useState(false);
  const [confirmarCobranca, setConfirmarCobranca] = useState(false);

  const c = config.data;
  useEffect(() => {
    if (!c) return;
    setF({
      teste_dias: String(c.teste_dias),
      tolerancia_dias: String(c.tolerancia_dias),
      email_migracao: paraCampo(c.email_migracao),
      email_mensal: paraCampo(c.email_mensal),
      email_caixas_no_mensal: String(c.email_caixas_no_mensal),
      email_caixa_extra: paraCampo(c.email_caixa_extra),
      custo_fixo_mensal: paraCampo(c.custo_fixo_mensal),
      custo_email_caixa_extra: paraCampo(c.custo_email_caixa_extra),
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

  if (planos.isLoading || config.isLoading) return <Carregando linhas={5} rotulo="Carregando os preços" />;
  if (planos.isError || config.isError || !c) return <EstadoDeErro acao={<button type="button" className={juntar(botao.secundario, "h-8")} onClick={() => { void planos.refetch(); void config.refetch(); }}>Tentar de novo</button>} />;

  const salvarConfig = async () => {
    const usd = parseFloat(String(f.custo_lugar_google_usd || "0").replace(",", "."));
    const dados: Partial<ConfigDoProduto> = {
      teste_dias: Math.max(0, Math.min(60, Math.floor(Number(f.teste_dias) || 0))),
      tolerancia_dias: Math.max(0, Math.min(30, Math.floor(Number(f.tolerancia_dias) || 0))),
      email_migracao: numeroDe(f.email_migracao),
      email_mensal: numeroDe(f.email_mensal),
      email_caixas_no_mensal: Math.max(0, Math.min(500, Math.floor(Number(f.email_caixas_no_mensal) || 0))),
      email_caixa_extra: numeroDe(f.email_caixa_extra),
      custo_fixo_mensal: numeroDe(f.custo_fixo_mensal),
      custo_email_caixa_extra: numeroDe(f.custo_email_caixa_extra),
      custo_lugar_google_usd: isFinite(usd) && usd >= 0 ? usd : 0,
      dolar: Math.max(0.01, numeroDe(f.dolar)),
      imposto_pct: Math.min(100, numeroDe(f.imposto_pct)),
    };
    setSalvando(true);
    try {
      await casa.salvarConfig(dados);
      reler();
      toast.success("Preços e custos salvos.");
    } catch (e) {
      toast.error(fraseDoErro(e, "Não foi possível salvar."));
    } finally {
      setSalvando(false);
    }
  };

  const ligarCobranca = async (ligar: boolean) => {
    try {
      await casa.salvarConfig({ pagamentos_ativos: ligar });
      reler();
      setConfirmarCobranca(false);
      toast.success(ligar ? "Cobrança ligada: o checkout está aberto." : "Cobrança desligada.");
    } catch (e) {
      toast.error(fraseDoErro(e));
    }
  };

  const texto_ = (chave: string, rotulo: string, apoio?: string) => (
    <CampoDeFormulario rotulo={rotulo} apoio={apoio}>
      <input value={f[chave] || ""} onChange={(e) => setF({ ...f, [chave]: e.target.value })} className={campo} inputMode="decimal" />
    </CampoDeFormulario>
  );

  return (
    <div className="min-w-0 space-y-6" data-precos-do-produto="">
      <Secao
        titulo="Cobrança no cartão"
        descricao={c.pagamentos_ativos ? "Ligada" : "Desligada"}
        ajuda="Com a cobrança desligada ninguém consegue abrir o checkout: as empresas ficam em teste ou em cortesia. Ligue depois de conferir a chave do Asaas em Configurações e de cadastrar no Asaas o endereço de aviso deste produto."
        acao={
          c.pagamentos_ativos ? (
            <button type="button" className={juntar(botao.secundario, "h-8")} onClick={() => void ligarCobranca(false)} data-desligar-cobranca="">Desligar</button>
          ) : (
            <button type="button" className={juntar(botao.primario, "h-8")} onClick={() => setConfirmarCobranca(true)} data-ligar-cobranca="">Ligar</button>
          )
        }
      />

      <Secao
        titulo="Planos"
        descricao={`${(planos.data || []).filter((p) => p.ativo).length} à venda`}
        acao={
          <button type="button" className={botao.icone} onClick={() => setEditando("novo")} aria-label="Novo plano" title="Novo plano">
            <Plus className="h-4 w-4 text-primary" aria-hidden="true" />
          </button>
        }
      >
        <ul className={juntar(lista.aberta, lista.divisoria)} data-planos-do-produto="">
          {(planos.data || []).map((p) => (
            <li key={p.id} className={lista.linha}>
              <span className="min-w-0 flex-1">
                <span className={juntar(texto.corpo, "block truncate font-medium")}>{p.nome}</span>
                <span className={juntar(texto.auxiliar, "block truncate")}>
                  {p.limites.maquina_buscas_mes} buscas por mês{p.limites.maquina_google_maps ? " com Google Maps" : ""}
                  {p.email_caixas_incluidas ? ` · e-mail incluído (${p.email_caixas_incluidas} caixas)` : ""}
                </span>
              </span>
              {!p.ativo && <span className={juntar(etiqueta, "ml-2 bg-muted text-muted-foreground")}>Fora de venda</span>}
              <span className={juntar(texto.corpo, "ml-3 shrink-0 tabular-nums")}>{reais(p.preco_usuario)} por usuário</span>
              <button type="button" className={juntar(botao.icone, "ml-1")} onClick={() => setEditando(p)} aria-label={`Editar o plano ${p.nome}`} title="Editar">
                <Pencil className="h-4 w-4" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      </Secao>

      <Secao
        titulo="E-mail, prazos e custos"
        ajuda="Os preços do e-mail valem para o plano que não inclui e-mail. Os custos servem para a margem no Financeiro: custo fixo do produto no mês, custo de cada caixa além do que o provedor dá de graça, custo de cada lugar buscado no Google Maps e o imposto sobre o que é recebido."
        acao={<button type="button" className={botao.primario} onClick={() => void salvarConfig()} disabled={salvando} data-salvar-precos="">{salvando ? "Salvando..." : "Salvar"}</button>}
      >
        <div className="min-w-0 space-y-5">
          <GrupoDeCampos titulo="E-mail profissional" colunas={3}>
            {texto_("email_migracao", "Migração, uma vez (R$)")}
            {texto_("email_mensal", "Mensalidade (R$)")}
            {texto_("email_caixas_no_mensal", "Caixas na mensalidade")}
            {texto_("email_caixa_extra", "Caixa adicional, por mês (R$)")}
          </GrupoDeCampos>
          <GrupoDeCampos titulo="Prazos" colunas={3}>
            {texto_("teste_dias", "Dias de teste")}
            {texto_("tolerancia_dias", "Dias de tolerância no atraso", "Depois disso o acesso pausa")}
          </GrupoDeCampos>
          <GrupoDeCampos titulo="Custos da casa" colunas={3}>
            {texto_("custo_fixo_mensal", "Custo fixo do produto, por mês (R$)")}
            {texto_("custo_email_caixa_extra", "Custo por caixa extra, por mês (R$)")}
            {texto_("imposto_pct", "Imposto sobre o recebido (%)")}
            {texto_("custo_lugar_google_usd", "Lugar no Google Maps (US$)")}
            {texto_("dolar", "Dólar (R$)")}
          </GrupoDeCampos>
        </div>
      </Secao>

      {editando && <EditorDePlano plano={editando === "novo" ? null : editando} onFechar={() => setEditando(null)} onSalvo={() => { reler(); setEditando(null); }} />}

      <JanelaCentral
        aberta={confirmarCobranca}
        onFechar={() => setConfirmarCobranca(false)}
        largura="sm"
        titulo="Ligar a cobrança no cartão?"
        rodape={
          <>
            <button type="button" className={juntar(botao.secundario, "mr-2")} onClick={() => setConfirmarCobranca(false)}>Agora não</button>
            <button type="button" className={botao.primario} onClick={() => void ligarCobranca(true)} data-confirmar-cobranca="">Ligar</button>
          </>
        }
      >
        <p className={texto.corpo}>A partir de agora quem administra uma empresa consegue assinar com cartão, e o Asaas passa a cobrar todo mês.</p>
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
      largura="md"
      titulo={plano ? `Plano ${plano.nome}` : "Novo plano"}
      ajuda="O preço é por usuário, por mês. Mudar o preço não mexe em quem já assina: o valor novo só vai para o Asaas quando a ficha da empresa é salva."
      rodape={<button type="button" className={botao.primario} onClick={() => void salvar()} disabled={salvando} data-salvar-plano="">{salvando ? "Salvando..." : "Salvar"}</button>}
    >
      <GrupoDeCampos>
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
    </JanelaCentral>
  );
}
