import { useState } from "react";
import { toast } from "sonner";
import { Check, CheckCircle2, Clock, Copy, Loader2, Plus, Trash2 } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { EstadoVazio } from "@/components/sistema/Estados";
import { botao, campo, juntar, lista, texto, toqueCompacto } from "@/components/sistema/estilos";
import { textoDoErro } from "@/lib/mesa/api";
import { chamarContratos, copiarTexto, type PayloadDoContrato } from "@/lib/contratos/api";
import { MAX_CONTRATANTES, MAX_TESTEMUNHAS, validarSignatarios } from "../../../supabase/functions/contratos/modulos/contrato-ciclo";
import { formatarDocumento } from "../../../supabase/functions/_shared/contrato-modelo";
import { linhasDoServidor, type LinhaDeAssinante } from "./rascunhoDoContrato";

/**
 * Quem assina (frente CON2, 30/09): mais de uma pessoa pelo contratante e
 * até duas testemunhas, cada uma com o próprio link. O primeiro do
 * contratante é o principal (o link de sempre). A lista entra no texto do
 * contrato e só muda no rascunho; depois de assinado pela agência, aqui
 * aparece quem já assinou e o link de cada um. O contrato fecha quando todos
 * os obrigatórios assinam (o PDF final leva todas as assinaturas).
 *
 * UXS (30/09): a lista em edição mora no rascunho do DetalheDoContrato
 * (trocar de parte não perde nada) e a barra de baixo salva junto com Dados.
 * Grade: uma coluna no celular, duas linhas por pessoa até 1280 px, cinco
 * colunas de 1280 px para cima.
 */

type Linha = LinhaDeAssinante;

const vazia = (papel: Linha["papel"]): Linha => ({ papel, nome: "", email: "", documento: "", obrigatorio: true });

export default function AssinantesDoContrato({
  p,
  editavel,
  aoMudar,
  linhas,
  aoMudarLinhas,
  valores,
}: {
  p: PayloadDoContrato;
  editavel: boolean;
  aoMudar: (novo: PayloadDoContrato) => void;
  /** A lista na tela (o que está salvo, ou o que a pessoa mudou e não salvou). */
  linhas: Linha[];
  aoMudarLinhas: (linhas: Linha[]) => void;
  /** Os dados do contrato na tela (a primeira pessoa nasce com o representante e o e-mail). */
  valores: Record<string, string>;
}) {
  const salvos = p.signatarios || [];
  const [fechando, setFechando] = useState(false);

  const conferido = validarSignatarios(linhas);
  const mudou = JSON.stringify(linhas) !== JSON.stringify(linhasDoServidor(p));
  const contratantes = linhas.filter((l) => l.papel === "contratante").length;
  const testemunhas = linhas.filter((l) => l.papel === "testemunha").length;
  const principal = linhas.findIndex((x) => x.papel === "contratante");
  const mudar = (i: number, m: Partial<Linha>) => aoMudarLinhas(linhas.map((x, k) => (k === i ? { ...x, ...m } : x)));
  const incluir = (papel: Linha["papel"]) => {
    // A primeira pessoa do contratante nasce com o representante e o e-mail do contrato (a equipe confere).
    const primeira = papel === "contratante" && !contratantes;
    const nome = primeira ? String(valores.cliente_representante || valores.cliente_nome || "").split(",")[0].trim() : "";
    aoMudarLinhas(linhas.concat([{ ...vazia(papel), nome, email: primeira ? String(valores.cliente_email || "") : "" }]));
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
  const copiar = async (t: string) => {
    if (await copiarTexto(t)) toast.success("Link copiado");
    else toast.error("Não deu para copiar; selecione e copie.");
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
                <button type="button" className={botao.barra} onClick={() => void copiar(String(s.link))} aria-label={`Copiar o link de ${s.nome}`}>
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
        <div
          key={i}
          className="grid min-w-0 grid-cols-1 gap-2 border-t border-border pt-3 sm:grid-cols-[140px_minmax(0,1fr)_150px_auto] xl:grid-cols-[140px_minmax(0,1fr)_minmax(0,1fr)_150px_auto]"
          data-assinante=""
        >
          <select value={l.papel} onChange={(e) => mudar(i, { papel: e.target.value === "testemunha" ? "testemunha" : "contratante" })} className={campo} aria-label="Papel">
            <option value="contratante">Contratante</option>
            <option value="testemunha">Testemunha</option>
          </select>
          <input value={l.nome} onChange={(e) => mudar(i, { nome: e.target.value })} placeholder="Nome completo" className={juntar(campo, "sm:col-span-3 xl:col-span-1")} aria-label="Nome completo" />
          <input value={l.email} onChange={(e) => mudar(i, { email: e.target.value })} placeholder="E-mail" type="email" className={juntar(campo, "sm:col-span-2 xl:col-span-1")} aria-label="E-mail" />
          <input value={l.documento.length === 11 ? formatarDocumento(l.documento) : l.documento} onChange={(e) => mudar(i, { documento: e.target.value.replace(/\D/g, "").slice(0, 11) })} placeholder="CPF" inputMode="numeric" className={campo} aria-label="CPF" />
          <div className="flex min-w-0 items-center">
            {i !== principal ? (
              <label className={juntar(texto.auxiliar, "mr-1 flex cursor-pointer items-center whitespace-nowrap")}>
                <Checkbox checked={l.obrigatorio} onCheckedChange={(v) => mudar(i, { obrigatorio: !!v })} className={juntar(toqueCompacto, "mr-1.5")} />
                Obrigatória
              </label>
            ) : (
              <span className={juntar(texto.auxiliar, "mr-1 whitespace-nowrap")}>Principal</span>
            )}
            <button type="button" className={botao.icone} onClick={() => aoMudarLinhas(linhas.filter((_y, k) => k !== i))} aria-label={`Tirar ${l.nome || "esta pessoa"}`}>
              <Trash2 className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      ))}
      {mudou && conferido.erros.length > 0 && <p className={juntar(texto.auxiliar, "text-warning")} data-erro-de-assinantes="">{conferido.erros[0]}</p>}
      <div className="-m-1 flex min-w-0 flex-wrap items-center [&>*]:m-1">
        <button type="button" className={botao.secundario} onClick={() => incluir("contratante")} disabled={contratantes >= MAX_CONTRATANTES}>
          <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" /> Pessoa do contratante
        </button>
        <button type="button" className={botao.secundario} onClick={() => incluir("testemunha")} disabled={testemunhas >= MAX_TESTEMUNHAS}>
          <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" /> Testemunha
        </button>
      </div>
    </div>
  );
}
