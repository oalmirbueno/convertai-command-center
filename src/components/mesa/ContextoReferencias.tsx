import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ExternalLink, FolderSync, Loader2, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useConfirm } from "@/components/shared/confirmDialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { chamarFuncao, extensao, padraoPara, TAMANHOS, textoDoErro } from "@/lib/mesa/api";
import { PAPEIS, type PapelDaReferencia, type ReferenciaComDestaque } from "@/lib/mesa/referencias";
import { BotaoComCusto, useAvisarErro } from "./Custo";
import { useMesa } from "./MesaContexto";
import SeletorDeReferencias from "./SeletorDeReferencias";

/**
 * Referências do cliente (Detalhes do Contexto), no seletor único da Mesa em
 * modo gerenciar: as do cliente com destaque e papel claro (Artes da marca,
 * Referências de composição), as pastas do workspace para escolher mais e o
 * Pinterest. Cada referência liga ou desliga, troca de papel, é lida pelo
 * agente e pode sair.
 */

const IMAGENS = ["png", "jpg", "jpeg", "webp"];

function AcoesDaReferencia({ r, onMudou }: { r: ReferenciaComDestaque; onMudou: () => void }) {
  const { catalogo } = useMesa();
  const confirmar = useConfirm();
  const [verLeitura, setVerLeitura] = useState(false);
  const leitor = padraoPara(catalogo, "leitura");

  const salvar = async (campos: Record<string, unknown>) => {
    const { error } = await (supabase as any).from("cliente_referencias").update(campos).eq("id", r.id);
    if (error) toast.error("Não foi possível salvar", { description: textoDoErro(error) });
    onMudou();
  };

  const apagar = async () => {
    const ok = await confirmar({ title: "Tirar esta referência?", description: "Ela deixa de ser usada pelo diretor de arte.", confirmLabel: "Tirar" });
    if (!ok) return;
    const { error } = await (supabase as any).from("cliente_referencias").delete().eq("id", r.id);
    if (error) {
      toast.error("Não foi possível tirar", { description: textoDoErro(error) });
      return;
    }
    if (r.origem !== "workspace" && r.storage_path && r.storage_path.indexOf("://") < 0) {
      await supabase.storage.from("mesa").remove([r.storage_path]);
    }
    onMudou();
  };

  return (
    <div className="mt-1.5 space-y-1.5">
      <div role="group" aria-label="Papel da referência" className="grid grid-cols-2 gap-0.5 rounded-md bg-muted p-0.5">
        {(["identidade", "tecnica"] as PapelDaReferencia[]).map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => {
              if (r.papel !== p) void salvar({ papel: p });
            }}
            aria-pressed={r.papel === p}
            title={PAPEIS[p].dica}
            className={`min-w-0 truncate rounded px-1 py-0.5 text-[10.5px] ${r.papel === p ? "bg-card font-medium text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
          >
            {PAPEIS[p].curto}
          </button>
        ))}
      </div>
      <div className="flex items-center justify-between">
        <label className="flex items-center text-[11px] text-muted-foreground">
          <Switch checked={r.ativa} onCheckedChange={(v) => void salvar({ ativa: v })} className="mr-1 scale-75" />
          {r.ativa ? "em uso" : "fora"}
        </label>
        <div className="flex items-center">
          {r.url_origem && (
            <a href={r.url_origem} target="_blank" rel="noopener noreferrer" className="inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:text-foreground" aria-label="Abrir origem">
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          )}
          <button type="button" onClick={() => void apagar()} className="inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:text-destructive" aria-label="Tirar referência">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      {r.leitura ? (
        <button type="button" onClick={() => setVerLeitura((v) => !v)} className="block w-full text-left text-[11px] leading-relaxed text-muted-foreground">
          <span className={verLeitura ? "whitespace-pre-wrap" : "line-clamp-2"}>{r.leitura}</span>
        </button>
      ) : (
        <BotaoComCusto
          rotulo="Ler"
          titulo="Ler a referência"
          descricao="O leitor descreve a técnica da peça (composição, hierarquia, tipografia, luz) para o diretor de arte usar."
          variant="outline"
          className="h-7 w-full text-[11.5px]"
          partes={() => [{ modeloId: leitor?.id, tipo: "texto", tokensEntrada: TAMANHOS.lerReferencia.entrada, tokensSaida: TAMANHOS.lerReferencia.saida }]}
          executar={() => chamarFuncao("estudio-arte", { acao: "referencias", subacao: "ler", referencia_id: r.id })}
          aoConcluir={() => onMudou()}
        />
      )}
    </div>
  );
}

export default function ContextoReferencias() {
  const { clientId } = useMesa();
  const queryClient = useQueryClient();
  const avisarErro = useAvisarErro();
  const entrada = useRef<HTMLInputElement>(null);
  const [ocupado, setOcupado] = useState<"workspace" | "upload" | null>(null);

  // A família inteira: a leitura com destaque do seletor e a da galeria do Contexto.
  const atualizar = () => void queryClient.invalidateQueries({ queryKey: ["mesa", "referencias", clientId] });

  const sincronizar = async () => {
    setOcupado("workspace");
    try {
      const data = await chamarFuncao<any>("estudio-arte", { acao: "referencias", subacao: "sincronizar_workspace", client_id: clientId });
      const n = Number(data?.novas ?? data?.imagens ?? NaN);
      toast.success("Pastas de referências sincronizadas", { description: Number.isFinite(n) ? `${n} imagem(ns) nova(s).` : undefined });
      atualizar();
    } catch (e) {
      avisarErro(e, "Workspace não sincronizado");
    } finally {
      setOcupado(null);
    }
  };

  const enviar = async (arquivos: FileList | null) => {
    if (!arquivos || arquivos.length === 0) return;
    setOcupado("upload");
    let enviados = 0;
    try {
      for (let i = 0; i < arquivos.length; i++) {
        const f = arquivos[i];
        const ext = extensao(f.name);
        if (IMAGENS.indexOf(ext) < 0) {
          toast.error(`${f.name}: envie PNG, JPG ou WEBP.`);
          continue;
        }
        const id = crypto.randomUUID();
        const caminho = `${clientId}/referencias/${id}.${ext}`;
        const { error } = await supabase.storage.from("mesa").upload(caminho, f, { contentType: f.type || `image/${ext}`, upsert: false });
        if (error) throw error;
        const { error: erroLinha } = await (supabase as any)
          .from("cliente_referencias")
          .insert({ id, client_id: clientId, origem: "upload", papel: "tecnica", storage_path: caminho });
        if (erroLinha) throw erroLinha;
        enviados++;
      }
      if (enviados) toast.success(`${enviados} referência(s) enviada(s) como composição`);
    } catch (e) {
      toast.error("Envio interrompido", { description: textoDoErro(e) });
    } finally {
      if (entrada.current) entrada.current.value = "";
      setOcupado(null);
      atualizar();
    }
  };

  return (
    <div className="min-w-0 space-y-4">
      <section className="flex min-w-0 flex-col rounded-xl border border-border bg-card p-3.5 sm:flex-row sm:items-center">
        <p className="mb-2 min-w-0 flex-1 text-[12px] leading-relaxed text-muted-foreground sm:mb-0 sm:mr-3">
          Marque com a estrela as preferidas: o diretor de arte usa as em destaque sempre, antes das outras.
        </p>
        <div className="flex shrink-0 flex-wrap">
          <Button type="button" size="sm" variant="outline" className="mb-1 mr-2 h-8 text-[12px]" onClick={() => void sincronizar()} disabled={ocupado !== null}>
            {ocupado === "workspace" ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <FolderSync className="mr-1 h-3.5 w-3.5" />}
            Sincronizar pastas de referências
          </Button>
          <Button type="button" size="sm" variant="outline" className="mb-1 h-8 text-[12px]" onClick={() => entrada.current?.click()} disabled={ocupado !== null}>
            {ocupado === "upload" ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Upload className="mr-1 h-3.5 w-3.5" />}
            Enviar imagens
          </Button>
          <input ref={entrada} type="file" accept="image/png,image/jpeg,image/webp" multiple className="hidden" onChange={(e) => void enviar(e.target.files)} />
        </div>
      </section>

      <SeletorDeReferencias
        modo="gerenciar"
        mostrarInativas
        colunas={6}
        alturaMax="min(64vh, 640px)"
        acoesDaReferencia={(r) => <AcoesDaReferencia r={r} onMudou={atualizar} />}
      />
    </div>
  );
}
