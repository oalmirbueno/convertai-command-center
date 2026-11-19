import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, FileUp, Upload } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { JanelaCentral, botao, juntar, texto } from "@/components/sistema";
import { escopoDoCrm, tabelaDoCrm } from "@/lib/comercial/escopo";
import { rotuloDoEstagio } from "@/lib/comercial/estagios";
import { CAMPOS_IMPORTAVEIS, lerCsv, mapearColunas, paraCsv, paraNegocios, type CampoImportavel } from "@/lib/comercial/importar-exportar";
import type { Lead } from "@/lib/comercial";

const LOTE = 200;

/** Baixa o CRM inteiro num CSV que abre certo no Excel. */
export function exportarCrm(leads: Lead[], nome = "crm") {
  const csv = paraCsv(leads, (id) => rotuloDoEstagio(id as never) || id);
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `${nome}-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  toast.success(`${leads.length} negócios exportados.`);
}

/**
 * Trazer de outro CRM: escolhe o arquivo, confere as colunas que o painel achou sozinho, vê a prévia e importa.
 * Quem já está no CRM (mesmo e-mail ou telefone) não entra de novo. Os negócios entram em lotes de 200.
 */
export function ImportarCrm({ aberta, onFechar, leads }: { aberta: boolean; onFechar: () => void; leads: Lead[] }) {
  const qc = useQueryClient();
  const [arquivo, setArquivo] = useState("");
  const [tabela, setTabela] = useState<string[][]>([]);
  const [mapa, setMapa] = useState<Record<CampoImportavel, number> | null>(null);
  const [importando, setImportando] = useState<{ feitos: number; total: number } | null>(null);
  const [fim, setFim] = useState<{ entraram: number; repetidos: number } | null>(null);

  const cabecalhos = tabela[0] || [];
  const linhas = tabela.slice(1);
  const resultado = useMemo(() => (mapa ? paraNegocios(linhas, mapa, leads) : null), [linhas, mapa, leads]);

  const limpar = () => {
    setArquivo("");
    setTabela([]);
    setMapa(null);
    setFim(null);
  };
  const fechar = () => {
    if (importando) return;
    limpar();
    onFechar();
  };
  const ler = async (f: File | null) => {
    if (!f) return;
    if (f.size > 15 * 1024 * 1024) return void toast.error("Arquivo grande demais (máximo 15 MB).");
    const t = lerCsv(await f.text());
    if (t.length < 2) return void toast.error("Não achei linhas nesse arquivo. Exporte do outro CRM em CSV.");
    setArquivo(f.name);
    setTabela(t);
    setMapa(mapearColunas(t[0]));
    setFim(null);
  };

  const importar = async () => {
    if (!resultado || !resultado.negocios.length) return;
    const e = escopoDoCrm();
    const dono = e.modo === "conta" && e.papel === "usuario" && e.euId ? e.euId : null;
    const { data: sessao } = await supabase.auth.getUser();
    const total = resultado.negocios.length;
    setImportando({ feitos: 0, total });
    let entraram = 0;
    try {
      for (let i = 0; i < total; i += LOTE) {
        const lote = resultado.negocios.slice(i, i + LOTE).map((n) => ({ ...n, owner_id: dono, created_by: sessao.user ? sessao.user.id : null, closed_at: n.stage === "ganho" || n.stage === "perdido" ? new Date().toISOString() : null }));
        const { error } = await supabase.from(tabelaDoCrm("commercial_leads") as "commercial_leads").insert(lote as never);
        if (error) throw error;
        entraram += lote.length;
        setImportando({ feitos: entraram, total });
      }
      setFim({ entraram, repetidos: resultado.repetidos });
      toast.success(`${entraram} negócios importados.`);
    } catch (err) {
      toast.error(entraram ? `Parou no meio: ${entraram} entraram. Tente de novo com o resto.` : `Não foi possível importar: ${(err as Error).message || "erro"}`);
    } finally {
      setImportando(null);
      void qc.invalidateQueries({ queryKey: ["comercial-leads"] });
    }
  };

  return (
    <JanelaCentral
      aberta={aberta}
      onFechar={fechar}
      largura="lg"
      titulo="Trazer de outro CRM"
      rodape={
        fim ? (
          <button type="button" className={botao.primario} onClick={fechar}>Pronto</button>
        ) : (
          <>
            <button type="button" className={juntar(botao.secundario, "mr-2")} onClick={fechar} disabled={!!importando}>Cancelar</button>
            <button type="button" className={botao.primario} onClick={() => void importar()} disabled={!resultado || !resultado.negocios.length || !!importando || !mapa || mapa.name < 0 && mapa.company < 0 && mapa.email < 0} data-importar-agora="">
              <Upload className="mr-1.5 h-4 w-4" aria-hidden="true" />
              {importando ? `Importando ${importando.feitos} de ${importando.total}...` : resultado ? `Importar ${resultado.negocios.length} negócios` : "Importar"}
            </button>
          </>
        )
      }
    >
      {fim ? (
        <div className="flex items-start rounded-2xl bg-accent-soft p-4" data-importacao-feita="">
          <Check className="mr-3 mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
          <p className={texto.corpo}><b>{fim.entraram} negócios entraram no funil.</b>{fim.repetidos ? ` ${fim.repetidos} já estavam no CRM e ficaram de fora.` : ""}</p>
        </div>
      ) : !tabela.length ? (
        <div className="space-y-4">
          <p className={juntar(texto.corpo, "leading-6")}>No outro CRM, use <b>Exportar</b> e escolha <b>CSV</b>. Funciona com HubSpot, Pipedrive, RD Station, Agendor, Kommo, Excel e Google Planilhas. O painel acha sozinho o nome, a empresa, o e-mail, o telefone, a etapa e o valor.</p>
          <label className="flex cursor-pointer flex-col items-center justify-center rounded-3xl border-2 border-dashed border-border p-8 text-center hover:border-primary/50" data-escolher-arquivo="" onDragOver={(ev) => ev.preventDefault()} onDrop={(ev) => { ev.preventDefault(); void ler(ev.dataTransfer.files ? ev.dataTransfer.files[0] : null); }}>
            <FileUp className="mb-2 h-7 w-7 text-primary" aria-hidden="true" />
            <span className={juntar(texto.corpo, "font-semibold")}>Escolher o arquivo CSV</span>
            <span className={texto.auxiliar}>ou arraste aqui</span>
            <input type="file" accept=".csv,text/csv,.txt" className="sr-only" onChange={(ev) => void ler(ev.target.files ? ev.target.files[0] : null)} />
          </label>
        </div>
      ) : (
        <div className="space-y-4">
          <p className={texto.auxiliar}><b className="text-foreground">{arquivo}</b>: {linhas.length} linhas. Confira de onde vem cada informação.</p>
          <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2">
            {CAMPOS_IMPORTAVEIS.map((c) => (
              <label key={c.id} className="flex min-w-0 items-center rounded-2xl bg-muted/60 px-3 py-2">
                <span className="mr-2 w-[140px] shrink-0 text-[13px] font-medium">{c.rotulo}</span>
                <select value={mapa ? mapa[c.id] : -1} onChange={(ev) => setMapa((m) => (m ? { ...m, [c.id]: Number(ev.target.value) } : m))} className="h-9 min-w-0 flex-1 rounded-xl border border-border bg-card px-2 text-[13px]" data-coluna-do-campo={c.id}>
                  <option value={-1}>Não trazer</option>
                  {cabecalhos.map((h, i) => <option key={`${h}-${i}`} value={i}>{h || `Coluna ${i + 1}`}</option>)}
                </select>
              </label>
            ))}
          </div>
          {resultado && (
            <>
              <p className={juntar(texto.corpo, "font-semibold")}>
                {resultado.negocios.length} novos para entrar
                <span className="font-normal text-muted-foreground">{resultado.repetidos ? ` · ${resultado.repetidos} já estão no CRM` : ""}{resultado.vazios ? ` · ${resultado.vazios} linhas vazias` : ""}</span>
              </p>
              <div className="overflow-x-auto rounded-2xl border border-border">
                <table className="w-full min-w-[560px] text-left text-[13px]">
                  <thead className="bg-muted/60 text-muted-foreground"><tr><th className="px-3 py-2 font-medium">Nome</th><th className="px-3 py-2 font-medium">Empresa</th><th className="px-3 py-2 font-medium">Contato</th><th className="px-3 py-2 font-medium">Etapa</th><th className="px-3 py-2 font-medium">Valor</th></tr></thead>
                  <tbody>
                    {resultado.negocios.slice(0, 5).map((n, i) => (
                      <tr key={i} className="border-t border-border">
                        <td className="px-3 py-2">{n.name}</td>
                        <td className="px-3 py-2">{n.company || ""}</td>
                        <td className="px-3 py-2">{n.email || n.whatsapp || ""}</td>
                        <td className="px-3 py-2">{rotuloDoEstagio(n.stage as never) || n.stage}</td>
                        <td className="px-3 py-2 tabular-nums">{n.monthly_value ? `${n.monthly_value}/mês` : n.one_off_value || ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          <button type="button" className={juntar(botao.discreto, "h-8")} onClick={limpar} disabled={!!importando}>Escolher outro arquivo</button>
        </div>
      )}
    </JanelaCentral>
  );
}
