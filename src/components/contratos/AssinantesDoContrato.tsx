import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Check, CheckCircle2, Clock, Copy, Loader2, Plus, Trash2 } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { EstadoVazio } from "@/components/sistema/Estados";
import { botao, campo, juntar, lista, texto } from "@/components/sistema/estilos";
import { textoDoErro } from "@/lib/mesa/api";
import { chamarContratos, type PayloadDoContrato } from "@/lib/contratos/api";
import { MAX_CONTRATANTES, MAX_TESTEMUNHAS, validarSignatarios } from "../../../supabase/functions/contratos/modulos/contrato-ciclo";
import { formatarDocumento } from "../../../supabase/functions/_shared/contrato-modelo";

/**
 * Quem assina (frente CON2, 30/09): mais de uma pessoa pelo contratante e
 * até duas testemunhas, cada uma com o próprio link. O primeiro do
 * contratante é o principal (o link de sempre). A lista entra no texto do
 * contrato e só muda no rascunho; depois de congelado, aqui aparece quem já
 * assinou e o link de cada um. O contrato fecha quando todos os obrigatórios
 * assinam (o PDF final leva todas as assinaturas).
 */

type Linha = { papel: "contratante" | "testemunha"; nome: string; email: string; documento: string; obrigatorio: boolean };

const vazia = (papel: Linha["papel"]): Linha => ({ papel, nome: "", email: "", documento: "", obrigatorio: true });

export default function AssinantesDoContrato({ p, editavel, aoMudar }: { p: PayloadDoContrato; editavel: boolean; aoMudar: (novo: PayloadDoContrato) => void }) {
  const salvos = p.signatarios || [];
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [salvando, setSalvando] = useState(false);
  const [fechando, setFechando] = useState(false);
  useEffect(() => {
    setLinhas(salvos.map((s) => ({ papel: s.papel, nome: s.nome, email: s.email, documento: s.documento || "", obrigatorio: s.obrigatorio })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.contrato.id, p.contrato.updated_at]);

  const conferido = validarSignatarios(linhas);
  const mudou = JSON.stringify(linhas) !== JSON.stringify(salvos.map((s) => ({ papel: s.papel, nome: s.nome, email: s.email, documento: s.documento || "", obrigatorio: s.obrigatorio })));
  const contratantes = linhas.filter((l) => l.papel === "contratante").length;
  const testemunhas = linhas.filter((l) => l.papel === "testemunha").length;
  const principal = linhas.findIndex((x) => x.papel === "contratante");
  const mudar = (i: number, m: Partial<Linha>) => setLinhas((l) => l.map((x, k) => (k === i ? { ...x, ...m } : x)));
  const incluir = (papel: Linha["papel"]) => {
    // A primeira pessoa do contratante nasce com o representante e o e-mail do contrato (a equipe confere).
    const primeira = papel === "contratante" && !contratantes;
    const nome = primeira ? String(p.valores.cliente_representante || p.valores.cliente_nome || "").split(",")[0].trim() : "";
    setLinhas((l) => l.concat([{ ...vazia(papel), nome, email: primeira ? String(p.valores.cliente_email || "") : "" }]));
  };

  const salvar = async () => {
    setSalvando(true);
    try {
      const novo = await chamarContratos("signatarios_salvar", { contract_id: p.contrato.id, signatarios: linhas });
      aoMudar(novo);
      toast.success(linhas.length ? "Quem assina foi salvo" : "Assina só o contratante, pelo link de sempre");
    } catch (e) {
      toast.error("A lista não foi salva", { description: textoDoErro(e) });
    } finally {
      setSalvando(false);
    }
  };
  const fechar = async () => {
    setFechando(true);
    try {
      await chamarContratos("concluir_assinaturas", { contract_id: p.contrato.id });
      aoMudar(await chamarContratos("ler", { contract_id: p.contrato.id }));
      toast.success("Contrato fechado com todas as assinaturas", { description: "O PDF final está em Arquivos > Contratos." });
    } catch (e) {
      toast.error("O contrato não fechou", { description: textoDoErro(e) });
    } finally {
      setFechando(false);
    }
  };
  const copiar = (t: string) => {
    try {
      void navigator.clipboard.writeText(t);
      toast.success("Link copiado");
    } catch {
      toast.error("Não deu para copiar; selecione e copie.");
    }
  };

  if (!editavel) {
    if (!salvos.length) return <EstadoVazio compacto titulo="Assina só o contratante, pelo link de sempre." />;
    const faltam = salvos.filter((s) => s.obrigatorio && !s.assinado_em).length;
    return (
      <div className="min-w-0 space-y-3" data-assinantes="">
        <ul className={juntar(lista.aberta, lista.divisoria)}>
          {salvos.map((s) => (
            <li key={s.id} className={juntar(lista.linha, "flex min-w-0 items-center")}>
              {s.assinado_em ? <CheckCircle2 className="mr-2 h-4 w-4 shrink-0 text-success" aria-hidden="true" /> : <Clock className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
              <span className="min-w-0 flex-1">
                <span className={juntar(texto.corpo, "block truncate font-medium")}>{s.nome}</span>
                <span className={juntar(texto.auxiliar, "block truncate")}>
                  {s.papel === "testemunha" ? "Testemunha" : s.principal ? "Contratante (principal)" : "Contratante"}
                  {s.assinado_em ? ` · assinou em ${new Date(s.assinado_em).toLocaleString("pt-BR")}` : s.obrigatorio ? " · falta assinar" : " · opcional"}
                </span>
              </span>
              {s.link && !s.assinado_em && (
                <button type="button" className={botao.barra} onClick={() => copiar(String(s.link))} aria-label={`Copiar o link de ${s.nome}`}>
                  <Copy className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> Link
                </button>
              )}
            </li>
          ))}
        </ul>
        {p.contrato.status === "sent" && !faltam && (
          <div className="flex min-w-0 items-center justify-end">
            <button type="button" className={botao.primario} onClick={() => void fechar()} disabled={fechando}>
              {fechando ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" /> : <Check className="mr-1.5 h-4 w-4" aria-hidden="true" />}
              Fechar o contrato
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="min-w-0 space-y-4" data-assinantes="">
      {!linhas.length && <EstadoVazio compacto titulo="Assina só o contratante, pelo link de sempre." descricao="Inclua mais pessoas ou testemunhas quando precisar." />}
      {linhas.map((l, i) => (
        <div key={i} className="grid min-w-0 grid-cols-1 gap-2 border-t border-border pt-3 sm:grid-cols-[140px_minmax(0,1fr)_minmax(0,1fr)_150px_auto]">
          <select value={l.papel} onChange={(e) => mudar(i, { papel: e.target.value === "testemunha" ? "testemunha" : "contratante" })} className={campo} aria-label="Papel">
            <option value="contratante">Contratante</option>
            <option value="testemunha">Testemunha</option>
          </select>
          <input value={l.nome} onChange={(e) => mudar(i, { nome: e.target.value })} placeholder="Nome completo" className={campo} aria-label="Nome completo" />
          <input value={l.email} onChange={(e) => mudar(i, { email: e.target.value })} placeholder="E-mail" type="email" className={campo} aria-label="E-mail" />
          <input value={l.documento.length === 11 ? formatarDocumento(l.documento) : l.documento} onChange={(e) => mudar(i, { documento: e.target.value.replace(/\D/g, "").slice(0, 11) })} placeholder="CPF" inputMode="numeric" className={campo} aria-label="CPF" />
          <div className="flex min-w-0 items-center">
            {i !== principal ? (
              <label className={juntar(texto.auxiliar, "mr-1 flex cursor-pointer items-center whitespace-nowrap")}>
                <Checkbox checked={l.obrigatorio} onCheckedChange={(v) => mudar(i, { obrigatorio: !!v })} className="mr-1.5" />
                Obrigatória
              </label>
            ) : (
              <span className={juntar(texto.auxiliar, "mr-1 whitespace-nowrap")}>Principal</span>
            )}
            <button type="button" className={botao.icone} onClick={() => setLinhas((x) => x.filter((_y, k) => k !== i))} aria-label={`Tirar ${l.nome || "esta pessoa"}`}>
              <Trash2 className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      ))}
      {mudou && conferido.erros.length > 0 && <p className={juntar(texto.auxiliar, "text-warning")}>{conferido.erros[0]}</p>}
      <div className="-m-1 flex min-w-0 flex-wrap items-center [&>*]:m-1">
        <button type="button" className={botao.secundario} onClick={() => incluir("contratante")} disabled={contratantes >= MAX_CONTRATANTES}>
          <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" /> Pessoa do contratante
        </button>
        <button type="button" className={botao.secundario} onClick={() => incluir("testemunha")} disabled={testemunhas >= MAX_TESTEMUNHAS}>
          <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" /> Testemunha
        </button>
        <span className="flex-1" />
        <button type="button" className={botao.primario} onClick={() => void salvar()} disabled={salvando || !mudou || conferido.erros.length > 0}>
          {salvando ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" /> : <Check className="mr-1.5 h-4 w-4" aria-hidden="true" />}
          Salvar quem assina
        </button>
      </div>
    </div>
  );
}
