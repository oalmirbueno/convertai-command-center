import { useRef, useState, type ReactNode, type RefObject } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { FileArchive, FileCode, FolderUp, Loader2, ShieldAlert, Upload } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useMesa } from "@/components/mesa/MesaContexto";
import { useAvisarErro } from "@/components/mesa/Custo";
import JanelaCentral from "@/components/sistema/JanelaCentral";
import { botao, campo, juntar, texto } from "@/components/sistema/estilos";
import { analisarImportacao, mb, type AnaliseDaImportacao, type OrigemDaImportacao } from "../../../supabase/functions/mesa-site/modulos/importacao-do-site";
import { caminhoDoZipDaImportacao, lerHtmlLocal, lerPastaLocal, lerZipLocal, montarZipDaImportacao, type ArquivoLocal } from "./arquivosDoNavegador";
import { CHAVES, chamarSite, type LinhaDoSite } from "./siteApi";

/**
 * Importar site existente (Gravyx, 19/10/2026): zip, pasta ou um HTML. A tela
 * lê e confere tudo antes de subir (só estático, limites, sem segredo, o
 * framework); o que vai para o Storage é um zip limpo (sem dependência nem
 * cache). A função cria o site e o motor monta o projeto no rascunho, com
 * origem "importação", compila e confere. Sem IA e sem custo.
 */

type Etapa = "escolher" | "lendo" | "pronto" | "subindo";

const nomeDe = (origem: OrigemDaImportacao, locais: ArquivoLocal[], arquivo: string) => {
  if (origem === "pasta") return (locais[0] ? locais[0].caminho.split("/")[0] : "") || "Site importado";
  return arquivo.replace(/\.(zip|html?)$/i, "") || "Site importado";
};

export default function ImportarSite({ aberta, onMudar, marcaId, onImportado }: { aberta: boolean; onMudar: (v: boolean) => void; marcaId: string | null; onImportado: (siteId: string) => void }) {
  const { clientId } = useMesa();
  const qc = useQueryClient();
  const avisarErro = useAvisarErro();
  const zipRef = useRef<HTMLInputElement>(null);
  const pastaRef = useRef<HTMLInputElement>(null);
  const htmlRef = useRef<HTMLInputElement>(null);
  const [etapa, setEtapa] = useState<Etapa>("escolher");
  const [origem, setOrigem] = useState<OrigemDaImportacao | null>(null);
  const [locais, setLocais] = useState<ArquivoLocal[]>([]);
  const [analise, setAnalise] = useState<AnaliseDaImportacao | null>(null);
  const [nome, setNome] = useState("");
  const [nomeOriginal, setNomeOriginal] = useState("");
  const [erro, setErro] = useState<string | null>(null);

  const limpar = () => {
    setEtapa("escolher");
    setOrigem(null);
    setLocais([]);
    setAnalise(null);
    setErro(null);
    setNome("");
    [zipRef, pastaRef, htmlRef].forEach((r) => {
      if (r.current) r.current.value = "";
    });
  };

  const ler = async (o: OrigemDaImportacao, arquivos: FileList | null) => {
    if (!arquivos || !arquivos.length) return;
    setEtapa("lendo");
    setErro(null);
    setOrigem(o);
    try {
      const primeiro = arquivos[0];
      const lidos = o === "zip" ? await lerZipLocal(primeiro) : o === "html" ? await lerHtmlLocal(primeiro) : await lerPastaLocal(arquivos);
      const a = analisarImportacao(lidos, o);
      setLocais(lidos);
      setAnalise(a);
      setNomeOriginal(o === "pasta" ? (lidos[0] ? lidos[0].caminho.split("/")[0] : "") : primeiro.name);
      setNome(`Site ${nomeDe(o, lidos, primeiro.name)}`.slice(0, 120));
      setEtapa("pronto");
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não consegui ler esses arquivos.");
      setEtapa("escolher");
    }
  };

  const importar = async () => {
    if (!analise || !analise.ok || !origem || !nome.trim()) return;
    setEtapa("subindo");
    try {
      const blob = await montarZipDaImportacao(locais, analise, origem === "html");
      const path = caminhoDoZipDaImportacao(clientId);
      const { error } = await supabase.storage.from("mesa").upload(path, blob, { contentType: "application/zip", upsert: false });
      if (error) throw error;
      const d = await chamarSite<{ site: LinhaDoSite }>("site_importar", {
        client_id: clientId,
        marca_id: marcaId || undefined,
        nome: nome.trim(),
        origem,
        path,
        nome_original: nomeOriginal,
        framework: analise.framework ? analise.framework.rotulo : null,
        manifesto: analise.arquivos.map((a) => ({ caminho: a.caminho, bytes: a.bytes })),
      });
      void qc.invalidateQueries({ queryKey: CHAVES.sites(clientId, marcaId) });
      toast.success("Importação na fila do motor: ele monta o projeto no rascunho, compila e confere (sem custo).");
      limpar();
      onMudar(false);
      onImportado(d.site.id);
    } catch (e) {
      avisarErro(e, "O site não foi importado");
      setEtapa("pronto");
    }
  };

  const ocupado = etapa === "lendo" || etapa === "subindo";
  const escolha = (o: OrigemDaImportacao, rotulo: string, icone: ReactNode, ref: RefObject<HTMLInputElement>) => (
    <button type="button" className={juntar(botao.secundario, "mb-2 mr-2")} onClick={() => ref.current && ref.current.click()} disabled={ocupado} data-importar-de={o}>
      {icone}
      <span className="ml-1.5">{rotulo}</span>
    </button>
  );

  return (
    <JanelaCentral
      aberta={aberta}
      onMudar={(v) => {
        if (!v && etapa === "subindo") return;
        if (!v) limpar();
        onMudar(v);
      }}
      titulo="Importar site existente"
      icone={<Upload className="h-4 w-4" />}
      descricao="Zip, pasta ou um HTML. Só site estático, até 200 MB, sem chave."
      ajuda="O site vira um site da Mesa: o motor monta o projeto no rascunho (origem Importação), compila, mostra a prévia e confere no computador e no celular. Dá para editar pelo diretor de site ou pelo editor de código e salvar a versão. Dependências, cache e a saída de build não sobem (o motor refaz). Arquivo .env ou chave no código recusa a importação: tire, troque a chave se ela já circulou, e importe de novo. Sem IA e sem custo."
      largura="md"
      data-importar-site=""
      rodape={
        <div className="flex min-w-0 items-center justify-end">
          {analise && etapa !== "escolher" && (
            <button type="button" className={juntar(botao.discreto, "mr-2")} onClick={limpar} disabled={ocupado}>
              Escolher outro
            </button>
          )}
          <button type="button" className={botao.primario} onClick={() => void importar()} disabled={!analise || !analise.ok || ocupado || !nome.trim()} data-confirmar-importacao="">
            {etapa === "subindo" ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            Importar
          </button>
        </div>
      }
    >
      <input ref={zipRef} type="file" accept=".zip,application/zip" className="hidden" onChange={(e) => void ler("zip", e.target.files)} data-entrada-zip="" />
      <input ref={htmlRef} type="file" accept=".html,.htm,text/html" className="hidden" onChange={(e) => void ler("html", e.target.files)} data-entrada-html="" />
      <input ref={pastaRef} type="file" multiple className="hidden" onChange={(e) => void ler("pasta", e.target.files)} data-entrada-pasta="" {...({ webkitdirectory: "", directory: "" } as Record<string, string>)} />

      <div className="min-w-0 space-y-4">
        <div className="flex min-w-0 flex-wrap items-center">
          {escolha("zip", "Zip", <FileArchive className="h-4 w-4" aria-hidden="true" />, zipRef)}
          {escolha("pasta", "Pasta", <FolderUp className="h-4 w-4" aria-hidden="true" />, pastaRef)}
          {escolha("html", "HTML", <FileCode className="h-4 w-4" aria-hidden="true" />, htmlRef)}
        </div>

        {etapa === "lendo" && (
          <p className={juntar(texto.corpo, "flex items-center")} role="status">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
            Lendo e conferindo os arquivos
          </p>
        )}
        {erro && <p className={juntar(texto.corpo, "text-destructive")} role="alert">{erro}</p>}

        {analise && etapa !== "lendo" && (
          <div className="min-w-0 space-y-3" data-analise-da-importacao={analise.ok ? "ok" : analise.codigo || "recusada"}>
            {analise.ok && analise.framework ? (
              <>
                <p className={texto.corpo}>
                  <span className="font-medium">{analise.framework.rotulo}</span>
                  {` · ${analise.arquivos.length} ${analise.arquivos.length === 1 ? "arquivo" : "arquivos"} · ${mb(analise.bytes)}`}
                </p>
                {analise.ignorados.total > 0 && (
                  <p className={texto.auxiliar}>{`${analise.ignorados.total} ficam de fora (dependências, cache ou build): ${analise.ignorados.exemplos.join(", ")}`}</p>
                )}
                {analise.avisos.map((a) => (
                  <p key={a} className={juntar(texto.auxiliar, "text-amber-700 dark:text-amber-400")}>{a}</p>
                ))}
                <label className="block min-w-0">
                  <span className={texto.rotulo}>Nome do site na Mesa</span>
                  <input value={nome} onChange={(e) => setNome(e.target.value)} maxLength={120} className={juntar(campo, "mt-1")} aria-label="Nome do site importado" />
                </label>
              </>
            ) : (
              <div className="flex min-w-0 items-start" role="alert">
                <ShieldAlert className="mr-2 mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
                <div className="min-w-0">
                  <p className={juntar(texto.corpo, "text-destructive [overflow-wrap:anywhere]")}>{analise.motivo}</p>
                  {analise.segredos.length > 0 && (
                    <ul className={juntar(texto.auxiliar, "mt-1 list-disc pl-4")}>
                      {analise.segredos.map((s) => (
                        <li key={s.arquivo} className="[overflow-wrap:anywhere]">{`${s.arquivo}: ${s.motivo}`}</li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </JanelaCentral>
  );
}
