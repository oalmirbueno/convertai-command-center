import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { GUIA_LANCAMENTO } from "@/lib/membros/checklist";
import { mensagemDoErro, salvarLinha } from "@/lib/membros/api";
import type { ItemChecklist } from "@/lib/membros/modelo";
import { texto } from "@/components/sistema";

const estados = {
  pendente: "Pendente",
  em_andamento: "Em andamento",
  bloqueado: "Bloqueado",
  concluido: "Concluído",
} as const;
export default function ChecklistLancamento({
  fechar,
  itens,
  historico,
  pessoas,
}: {
  fechar: () => void;
  itens: ItemChecklist[];
  historico: ItemChecklist[];
  pessoas: { id: string; full_name: string }[];
}) {
  const [chave, setChave] = useState<string>(GUIA_LANCAMENTO[0][0]);
  const [aba, setAba] = useState<"lista" | "guia">("lista");
  const grupos = Array.from(new Set(GUIA_LANCAMENTO.map((i) => i[1])));
  const item = GUIA_LANCAMENTO.find((i) => i[0] === chave)!;
  return (
    <Dialog
      open
      onOpenChange={(v) => {
        if (!v) fechar();
      }}
    >
      <DialogContent className="membros-modal">
        <DialogTitle className={texto.tituloPagina}>
          Preparar lançamento
        </DialogTitle>
        <DialogDescription className="text-[12px]">
          Verificação manual ·{" "}
          {itens.filter((i) => i.estado === "concluido").length}/
          {GUIA_LANCAMENTO.length} itens marcados como concluídos
        </DialogDescription>
        <div
          className="flex gap-2 md:hidden"
          aria-label="Visualização da preparação"
        >
          <button
            className={`membros-acao ${aba === "lista" ? "bg-muted" : ""}`}
            aria-pressed={aba === "lista"}
            onClick={() => setAba("lista")}
          >
            Checklist
          </button>
          <button
            className={`membros-acao ${aba === "guia" ? "bg-muted" : ""}`}
            aria-pressed={aba === "guia"}
            onClick={() => setAba("guia")}
          >
            Guia do item
          </button>
        </div>
        <div className="membros-checklist">
          <section
            aria-label="Checklist de preparação"
            className={`space-y-5 ${aba === "guia" ? "hidden md:block" : ""}`}
          >
            {grupos.map((g) => (
              <div key={g}>
                <h2 className={`${texto.tituloSecao} mb-2`}>{g}</h2>
                <div className="divide-y divide-border">
                  {GUIA_LANCAMENTO.filter((i) => i[1] === g).map((i) => (
                    <button
                      className={`w-full min-h-11 py-3 px-2 text-left text-[13px] flex items-start justify-between gap-3 rounded-md focus-visible:ring-2 focus-visible:ring-ring ${chave === i[0] ? "bg-muted" : ""}`}
                      key={i[0]}
                      onClick={() => {
                        setChave(i[0]);
                        setAba("guia");
                      }}
                    >
                      <span>{i[2]}</span>
                      <span className="shrink-0 text-[11px] text-muted-foreground">
                        {
                          estados[
                            itens.find((x) => x.chave === i[0])?.estado ||
                              "pendente"
                          ]
                        }
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </section>
          <aside
            aria-label="Guia do item"
            className={aba === "lista" ? "hidden md:block" : ""}
          >
            <EditorItem
              key={`${chave}:${itens.find((i) => i.chave === chave)?.atualizado_em || "novo"}`}
              item={item}
              salvo={itens.find((i) => i.chave === chave)}
              historico={historico.filter((i) => i.chave === chave)}
              pessoas={pessoas}
            />
          </aside>
        </div>
      </DialogContent>
    </Dialog>
  );
}
function EditorItem({
  item,
  salvo,
  historico,
  pessoas,
}: {
  item: (typeof GUIA_LANCAMENTO)[number];
  salvo?: ItemChecklist;
  historico: ItemChecklist[];
  pessoas: { id: string; full_name: string }[];
}) {
  const qc = useQueryClient();
  const [estado, setEstado] = useState<ItemChecklist["estado"]>(
    salvo?.estado || "pendente",
  );
  const [observacao, setObservacao] = useState(salvo?.observacao || "");
  const [evidencia, setEvidencia] = useState(salvo?.evidencia || "");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const autor = (id: string | null | undefined) =>
    pessoas.find((p) => p.id === id)?.full_name || "Administrador";
  const salvar = async () => {
    setSalvando(true);
    setErro("");
    try {
      await salvarLinha(
        "membros_checklist",
        { chave: item[0], estado, observacao, evidencia },
        "chave",
      );
      await qc.invalidateQueries({ queryKey: ["membros", "admin"] });
    } catch (e) {
      setErro(mensagemDoErro(e));
    } finally {
      setSalvando(false);
    }
  };
  return (
    <div className="space-y-5">
      <h2 className={texto.tituloSecao}>{item[2]}</h2>
      <p className={texto.corpo}>{item[3]}</p>
      <div>
        <h3 className={texto.rotulo}>Depende de</h3>
        <p className={texto.corpo}>{item[4]}</p>
      </div>
      <div>
        <h3 className={texto.rotulo}>Como conferir</h3>
        <p className={texto.corpo}>{item[5]}</p>
      </div>
      <label className="block text-[12px] space-y-2">
        <span>Estado</span>
        <select
          className="w-full min-h-11 bg-muted rounded-lg px-3"
          value={estado}
          onChange={(e) => setEstado(e.target.value as ItemChecklist["estado"])}
        >
          {Object.entries(estados).map(([k, v]) => (
            <option value={k} key={k}>
              {v}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-[12px] space-y-2">
        <span>Observação</span>
        <textarea
          className="w-full bg-muted rounded-lg p-3 min-h-24"
          maxLength={2000}
          value={observacao}
          onChange={(e) => setObservacao(e.target.value)}
        />
      </label>
      <label className="block text-[12px] space-y-2">
        <span>Referência ou evidência</span>
        <textarea
          className="w-full bg-muted rounded-lg p-3 min-h-20"
          maxLength={2000}
          value={evidencia}
          onChange={(e) => setEvidencia(e.target.value)}
        />
      </label>
      <p className={texto.auxiliar}>
        Não inclua senhas, chaves ou dados de sessão.
      </p>
      {erro && (
        <p role="alert" className="text-[13px] text-destructive">
          {erro}
        </p>
      )}
      <button
        className="membros-acao bg-primary text-primary-foreground"
        disabled={salvando}
        onClick={() => void salvar()}
      >
        {salvando ? "Salvando…" : "Salvar verificação manual"}
      </button>
      {salvo && (
        <p className={texto.auxiliar}>
          Atualizado por {autor(salvo.atualizado_por)} em{" "}
          {new Date(salvo.atualizado_em).toLocaleString("pt-BR")}
        </p>
      )}
      {historico.length > 0 && (
        <details>
          <summary className="min-h-11 cursor-pointer text-[12px]">
            Histórico deste item
          </summary>
          <ol className="space-y-3">
            {historico.map((h, i) => (
              <li
                key={`${h.atualizado_em}-${i}`}
                className="text-[12px] border-t border-border pt-3"
              >
                <p>
                  {estados[h.estado]} · {autor(h.atualizado_por)}
                </p>
                <p className="text-muted-foreground">
                  {new Date(h.atualizado_em).toLocaleString("pt-BR")}
                </p>
                {h.observacao && (
                  <p className="whitespace-pre-wrap">{h.observacao}</p>
                )}
                {h.evidencia && (
                  <p className="break-words whitespace-pre-wrap">
                    {h.evidencia}
                  </p>
                )}
              </li>
            ))}
          </ol>
        </details>
      )}
    </div>
  );
}
