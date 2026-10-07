import { describe, it, expect, vi } from "vitest";
import { organizarArquivosDaExecucao } from "../../supabase/functions/_shared/arquivos-da-execucao";

function banco() {
  const cliente = "00000000-0000-0000-0000-000000000001";
  const arquivo = "00000000-0000-0000-0000-000000000002";
  const nodes: Record<string, any>[] = [{ id: "folder-existing", kind: "folder", name: "Execução", scope: "client", client_id: cliente, parent_id: null }];
  const download = vi.fn(async () => ({ data: new Blob(["prova"]), error: null }));
  const upload = vi.fn(async () => ({ error: null }));
  const db = {
    storage: { from: () => ({ download, upload }) },
    from: (table: string) => {
      const filters: ((r: any) => boolean)[] = [];
      let mutation: any = null;
      const q: any = {
        select: () => q, limit: () => q,
        eq: (k: string, v: any) => { filters.push(r => r[k] === v); return q; },
        is: (k: string, v: any) => { filters.push(r => (r[k] ?? null) === v); return q; },
        in: (k: string, v: any[]) => { filters.push(r => v.includes(r[k])); return q; },
        upsert: (r: any) => { mutation = r; return q; },
        single: async () => result(true), maybeSingle: async () => result(true),
        then: (resolve: any, reject: any) => Promise.resolve(result(false)).then(resolve, reject),
      };
      function result(single: boolean) {
        if (mutation) { if (!nodes.some(n => n.id === mutation.id)) nodes.push(mutation); return { error: null }; }
        if (table === "operator_task_links") return { data: { operator_id: "operator", kanban_task_id: "task" } };
        if (table === "tasks") return { data: { id: "task", title: "Auditoria", project: { client_id: cliente } } };
        if (table === "internal_operators") return { data: { display_name: "Registro" } };
        const rows = (table === "files" ? [
          { id: arquivo, client_id: cliente, status: "ready", archived_at: null, file_name: "prova.png", storage_bucket: "mcp-files", storage_path: "original", size_bytes: 5, mime_type: "image/png" },
          { id: "00000000-0000-0000-0000-000000000003", client_id: "other", status: "ready", archived_at: null, file_name: "privado.png" },
        ] : nodes).filter(r => filters.every(f => f(r)));
        return { data: single ? rows[0] || null : rows, error: null };
      }
      return q;
    },
  };
  return { db, nodes, arquivo, download, upload };
}

describe("Arquivos da execução", () => {
  it("reutiliza a pasta criada pelo painel e não duplica cópia no retry", async () => {
    const b = banco();
    const anexos = [{ name: "Prova", url: `aceleriq-file://${b.arquivo}` }];
    expect((await organizarArquivosDaExecucao(b.db, "link", anexos)).organizados).toBe(1);
    expect((await organizarArquivosDaExecucao(b.db, "link", anexos)).organizados).toBe(1);
    expect(b.nodes.filter(n => n.name === "Execução")).toHaveLength(1);
    expect(b.nodes.filter(n => n.kind === "file")).toHaveLength(1);
    expect(b.download).toHaveBeenCalledTimes(1);
    expect(b.upload).toHaveBeenCalledTimes(1);
  });
  it("não copia arquivo pertencente a outro cliente", async () => {
    const b = banco();
    const r = await organizarArquivosDaExecucao(b.db, "link", [{ name: "Outro", url: "aceleriq-file://00000000-0000-0000-0000-000000000003" }]);
    expect(r.organizados).toBe(0);
    expect(r.avisos).toHaveLength(1);
    expect(b.download).not.toHaveBeenCalled();
  });
});
