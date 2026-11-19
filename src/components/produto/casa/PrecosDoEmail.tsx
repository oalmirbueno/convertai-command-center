import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Inbox, PackagePlus, Repeat, Truck } from "lucide-react";
import { casa, fraseDoErro, lerConfig, reais, type ConfigDoProduto } from "@/lib/produto/api";
import { Card, StatCard, StatGrid } from "@/components/ds";
import { CampoDeFormulario, GrupoDeCampos, botao, campo, juntar } from "@/components/sistema";
import OfertasDoPedido from "./OfertasDoPedido";
import { ErroDaTela, EsqueletoDaTela } from "./pecasDaCasa";

const numeroDe = (v: string) => {
  const n = parseFloat(String(v).replace(/\./g, "").replace(",", "."));
  return isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : 0;
};
const paraCampo = (n: number) => String(n).replace(".", ",");

const CAMPOS = ["email_migracao", "email_mensal", "email_caixas_no_mensal", "email_caixa_extra", "custo_email_caixa_extra"] as const;
type Campo = (typeof CAMPOS)[number];

/**
 * O preço do e-mail profissional (aba Preços do E-mail), separado da tela de preços do CRM em
 * 19/11/2026: os números de hoje em StatCard, o formulário num cartão e as ofertas do pedido embaixo.
 * Salva só os campos do e-mail em produto_config; o resto da configuração não é tocado.
 */
export default function PrecosDoEmail() {
  const qc = useQueryClient();
  const config = useQuery({ queryKey: ["produto", "config"], queryFn: lerConfig });
  const [f, setF] = useState<Record<Campo, string>>({ email_migracao: "", email_mensal: "", email_caixas_no_mensal: "", email_caixa_extra: "", custo_email_caixa_extra: "" });
  const [salvando, setSalvando] = useState(false);
  const c = config.data;

  useEffect(() => {
    if (!c) return;
    setF({
      email_migracao: paraCampo(c.email_migracao),
      email_mensal: paraCampo(c.email_mensal),
      email_caixas_no_mensal: String(c.email_caixas_no_mensal),
      email_caixa_extra: paraCampo(c.email_caixa_extra),
      custo_email_caixa_extra: paraCampo(c.custo_email_caixa_extra),
    });
  }, [c]);

  if (config.isLoading) return <EsqueletoDaTela linhas={4} rotulo="Carregando os preços" />;
  if (config.isError || !c) return <ErroDaTela titulo="Não foi possível carregar os preços." aoTentar={() => void config.refetch()} />;

  const mudou = CAMPOS.some((k) => {
    const atual = k === "email_caixas_no_mensal" ? String(c[k]) : paraCampo(c[k]);
    return f[k] !== atual;
  });
  const salvar = async () => {
    const dados: Partial<ConfigDoProduto> = {
      email_migracao: numeroDe(f.email_migracao),
      email_mensal: numeroDe(f.email_mensal),
      email_caixas_no_mensal: Math.max(0, Math.min(500, Math.floor(Number(f.email_caixas_no_mensal) || 0))),
      email_caixa_extra: numeroDe(f.email_caixa_extra),
      custo_email_caixa_extra: numeroDe(f.custo_email_caixa_extra),
    };
    setSalvando(true);
    try {
      await casa.salvarConfig(dados);
      void qc.invalidateQueries({ queryKey: ["produto", "config"] });
      void qc.invalidateQueries({ queryKey: ["produto", "faturamento"] });
      toast.success("Preço do e-mail salvo.");
    } catch (e) {
      toast.error(fraseDoErro(e, "Não foi possível salvar."));
    } finally {
      setSalvando(false);
    }
  };
  const margemDaExtra = c.email_caixa_extra - c.custo_email_caixa_extra;
  const campoDe = (k: Campo, rotulo: string, extra?: { apoio?: string; ajuda?: string; inteiro?: boolean }) => (
    <CampoDeFormulario rotulo={rotulo} apoio={extra && extra.apoio} ajuda={extra && extra.ajuda}>
      <input value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} className={juntar(campo, "tabular-nums")} inputMode={extra && extra.inteiro ? "numeric" : "decimal"} data-campo={k} />
    </CampoDeFormulario>
  );

  return (
    <div className="min-w-0 space-y-4 sm:space-y-6" data-precos-do-email="">
      <StatGrid label="Preço do e-mail hoje">
        <StatCard icon={<Truck className="h-4 w-4" />} label="Migração" value={reais(c.email_migracao)} size="md" hint="uma vez" />
        <StatCard icon={<Repeat className="h-4 w-4" />} label="Mensalidade" value={reais(c.email_mensal)} size="md" hint="por mês" />
        <StatCard icon={<Inbox className="h-4 w-4" />} label="Caixas incluídas" value={c.email_caixas_no_mensal} size="md" hint="na mensalidade" />
        <StatCard icon={<PackagePlus className="h-4 w-4" />} label="Caixa adicional" value={reais(c.email_caixa_extra)} size="md" hint={`margem ${reais(margemDaExtra)} por mês`} help={`Custa ${reais(c.custo_email_caixa_extra)} por mês para a casa.`} />
      </StatGrid>

      <Card
        title="Preço do e-mail profissional"
        subtitle={mudou ? "Alterações não salvas" : undefined}
        help="Vale para quem contrata o e-mail sozinho ou num plano do CRM que não inclui e-mail. Mudar aqui vale para os próximos pedidos. O custo por caixa extra entra na margem do Financeiro."
        action={<button type="button" className={juntar(botao.primario, "h-8")} onClick={() => void salvar()} disabled={salvando || !mudou} data-salvar-precos="">{salvando ? "Salvando..." : "Salvar"}</button>}
      >
        <GrupoDeCampos colunas={3}>
          {campoDe("email_migracao", "Migração, uma vez (R$)")}
          {campoDe("email_mensal", "Mensalidade (R$)")}
          {campoDe("email_caixas_no_mensal", "Caixas na mensalidade", { inteiro: true })}
          {campoDe("email_caixa_extra", "Caixa adicional, por mês (R$)")}
          {campoDe("custo_email_caixa_extra", "Custo por caixa extra, por mês (R$)", { ajuda: "O que a casa paga ao provedor por caixa a mais." })}
        </GrupoDeCampos>
      </Card>

      <OfertasDoPedido />
    </div>
  );
}
