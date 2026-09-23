import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ExternalLink, FolderSync, Link2, Loader2, Maximize2, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useConfirm } from "@/components/shared/confirmDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { chamarFuncao, extensao, padraoPara, TAMANHOS, textoDoErro } from "@/lib/mesa/api";
import { Ampliar } from "./Ampliar";
import { BotaoComCusto, useAvisarErro } from "./Custo";
import { legendaDaReferencia } from "./ContextoGaleriaDeReferencias";
import { MiniaturaDoStorage } from "./ContextoMiniatura";
import { useMesa } from "./MesaContexto";
import { Quadrado } from "./NavegadorDePastas";
import { TituloDeSecao } from "./Seletores";
import { chaveDasReferencias, useReferenciasDoCliente, type ReferenciaDoCliente } from "./contextoDoCliente";

type Referencia = ReferenciaDoCliente;

const ORIGENS: { valor: string; rotulo: string }[] = [
  { valor: "todas", rotulo: "Todas" },
  { valor: "workspace", rotulo: "Workspace" },
  { valor: "arquivo", rotulo: "Artes aprovadas" },
  { valor: "pinterest", rotulo: "Pinterest" },
  { valor: "upload", rotulo: "Enviadas" },
];

const IMAGENS = ["png", "jpg", "jpeg", "webp"];

function CartaoDeReferencia({ r, onMudou, onAmpliar }: { r: Referencia; onMudou: () => void; onAmpliar: () => void }) {
  const { catalogo } = useMesa();
  const confirmar = useConfirm();
  const [verLeitura, setVerLeitura] = useState(false);
  const leitor = padraoPara(catalogo, "leitura");

  const alternar = async (ativa: boolean) => {
    const { error } = await (supabase as any).from("cliente_referencias").update({ ativa }).eq("id", r.id);
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
    <li className={`min-w-0 overflow-hidden rounded-xl border border-border bg-card ${r.ativa ? "" : "opacity-60"}`}>
      <button
        type="button"
        onClick={onAmpliar}
        disabled={!r.imagem}
        aria-label={`Ver maior: ${r.nome}`}
        title={r.nome}
        className="group relative block w-full text-left"
      >
        <Quadrado className="rounded-none">
          {r.imagem ? (
            <MiniaturaDoStorage bucket={r.imagem.bucket} caminho={r.imagem.caminho} alt={r.nome} className="h-full w-full" />
          ) : (
            <span className="flex h-full w-full items-center justify-center text-[11px] text-muted-foreground">Sem imagem</span>
          )}
        </Quadrado>
        <span className="absolute left-2 top-2 rounded-full bg-background/85 px-2 py-0.5 text-[10px] font-medium text-foreground">
          {ORIGENS.find((o) => o.valor === r.origem)?.rotulo || r.origem} · {r.papel === "identidade" ? "identidade" : "técnica"}
        </span>
        {r.imagem && (
          <span className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-md bg-background/90 text-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
            <Maximize2 className="h-3.5 w-3.5" />
          </span>
        )}
      </button>
      <div className="space-y-2 p-2.5">
        <div className="flex items-center justify-between gap-2">
          <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Switch checked={r.ativa} onCheckedChange={(v) => void alternar(v)} className="scale-75" />
            {r.ativa ? "em uso" : "fora"}
          </label>
          <div className="flex items-center">
            {r.url_origem && (
              <a href={r.url_origem} target="_blank" rel="noreferrer" className="inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:text-foreground" aria-label="Abrir origem">
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            )}
            <button type="button" onClick={() => void apagar()} className="inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:text-destructive" aria-label="Tirar referência">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
        {r.leitura ? (
          <button type="button" onClick={() => setVerLeitura((v) => !v)} className="block w-full text-left text-[11.5px] leading-relaxed text-muted-foreground">
            <span className={verLeitura ? "whitespace-pre-wrap" : "line-clamp-3"}>{r.leitura}</span>
          </button>
        ) : (
          <BotaoComCusto
            rotulo="Ler"
            titulo="Ler a referência"
            descricao="O leitor descreve a técnica da peça (composição, hierarquia, tipografia, luz) para o diretor de arte usar."
            variant="outline"
            className="h-7 w-full text-[11.5px]"
            partes={() => [{ modeloId: leitor?.id, tipo: "texto", tokensEntrada: TAMANHOS.lerReferencia.entrada, tokensSaida: TAMANHOS.lerReferencia.saida }]}
            executar={() => chamarFuncao("estudio-arte", { acao: "ler", referencia_id: r.id })}
            aoConcluir={() => onMudou()}
          />
        )}
      </div>
    </li>
  );
}

export default function ContextoReferencias() {
  const { clientId } = useMesa();
  const queryClient = useQueryClient();
  const avisarErro = useAvisarErro();
  const entrada = useRef<HTMLInputElement>(null);
  const [filtro, setFiltro] = useState("todas");
  const [link, setLink] = useState("");
  const [ocupado, setOcupado] = useState<"pinterest" | "workspace" | "upload" | null>(null);
  const [ampliada, setAmpliada] = useState<number | null>(null);

  // Mesma leitura da galeria do Contexto: a imagem vem do bucket mesa, do
  // Workspace ou de Arquivos, conforme a origem da referência.
  const refs = useReferenciasDoCliente(clientId);
  const atualizar = () => void queryClient.invalidateQueries({ queryKey: chaveDasReferencias(clientId) });

  const importarPinterest = async () => {
    const url = link.trim();
    if (url.indexOf("pin") < 0 || url.indexOf("http") !== 0) {
      toast.error("Cole o link completo do pin (https://...pinterest... ou pin.it/...).");
      return;
    }
    setOcupado("pinterest");
    try {
      await chamarFuncao("estudio-arte", { acao: "importar_pinterest", client_id: clientId, url });
      toast.success("Referência importada do Pinterest");
      setLink("");
      atualizar();
    } catch (e) {
      avisarErro(e, "Pin não importado");
    } finally {
      setOcupado(null);
    }
  };

  const sincronizar = async () => {
    setOcupado("workspace");
    try {
      const data = await chamarFuncao<any>("estudio-arte", { acao: "sincronizar_workspace", client_id: clientId });
      const n = Number(data?.ligadas ?? data?.novas ?? data?.total ?? NaN);
      toast.success("Workspace sincronizado", { description: Number.isFinite(n) ? `${n} imagem(ns) ligada(s).` : undefined });
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
          .insert({ id, client_id: clientId, origem: "upload", storage_path: caminho });
        if (erroLinha) throw erroLinha;
        enviados++;
      }
      if (enviados) toast.success(`${enviados} referência(s) enviada(s)`);
    } catch (e) {
      toast.error("Envio interrompido", { description: textoDoErro(e) });
    } finally {
      if (entrada.current) entrada.current.value = "";
      setOcupado(null);
      atualizar();
    }
  };

  const lista = (refs.data || []).filter((r) => filtro === "todas" || r.origem === filtro);
  const comImagem = lista.filter((r) => !!r.imagem);

  return (
    <div className="space-y-5">
      <section className="grid grid-cols-1 gap-3 rounded-xl border border-border bg-card p-3.5 lg:grid-cols-[minmax(0,1fr)_auto]">
        <div className="flex min-w-0 gap-2">
          <Input value={link} onChange={(e) => setLink(e.target.value)} placeholder="Cole o link de um pin do Pinterest" className="h-9 min-w-0" />
          <Button type="button" size="sm" className="h-9 shrink-0" onClick={() => void importarPinterest()} disabled={!link.trim() || ocupado !== null}>
            {ocupado === "pinterest" ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Link2 className="mr-1 h-3.5 w-3.5" />}
            Importar
          </Button>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" className="h-9" onClick={() => void sincronizar()} disabled={ocupado !== null}>
            {ocupado === "workspace" ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <FolderSync className="mr-1 h-3.5 w-3.5" />}
            Sincronizar workspace
          </Button>
          <Button type="button" size="sm" variant="outline" className="h-9" onClick={() => entrada.current?.click()} disabled={ocupado !== null}>
            {ocupado === "upload" ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Upload className="mr-1 h-3.5 w-3.5" />}
            Enviar imagens
          </Button>
          <input ref={entrada} type="file" accept="image/png,image/jpeg,image/webp" multiple className="hidden" onChange={(e) => void enviar(e.target.files)} />
        </div>
      </section>

      <section className="space-y-3">
        <TituloDeSecao
          acao={
            <div className="flex flex-wrap gap-1">
              {ORIGENS.map((o) => (
                <button
                  key={o.valor}
                  type="button"
                  onClick={() => setFiltro(o.valor)}
                  className={`rounded-full px-2.5 py-1 text-[11px] ${filtro === o.valor ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground"}`}
                >
                  {o.rotulo}
                </button>
              ))}
            </div>
          }
        >
          Referências ({lista.length})
        </TituloDeSecao>
        {refs.isLoading && <p className="text-[12.5px] text-muted-foreground">Lendo referências…</p>}
        {refs.data && lista.length === 0 && (
          <p className="text-[12.5px] text-muted-foreground">Nenhuma referência aqui. Importe um pin, sincronize a pasta de referências do workspace ou envie imagens.</p>
        )}
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {lista.map((r) => (
            <CartaoDeReferencia
              key={r.id}
              r={r}
              onMudou={atualizar}
              onAmpliar={() => {
                const i = comImagem.indexOf(r);
                if (i >= 0) setAmpliada(i);
              }}
            />
          ))}
        </ul>
      </section>
      <Ampliar
        imagens={comImagem.map((r) => ({
          caminho: r.imagem!.caminho,
          bucket: r.imagem!.bucket,
          titulo: `${r.nome} · ${r.papel === "identidade" ? "identidade" : "técnica"}`,
          legenda: legendaDaReferencia(r),
        }))}
        indice={ampliada}
        onFechar={() => setAmpliada(null)}
      />
    </div>
  );
}
