import { lazy, Suspense, useState } from "react";
import { FileCode2 } from "lucide-react";
import { botao, juntar } from "@/components/sistema/estilos";
import type { LinhaDoSite } from "./siteApi";

// O editor (e o jszip) só carregam quando a pessoa abre: fora do pacote principal.
const EditorDeCodigo = lazy(() => import("./EditorDeCodigo"));

/** Atalho "Código do site" ao lado do nome do site (só ícone): abre o editor de código na janela central. */
export default function BotaoDoCodigo({ site }: { site: LinhaDoSite }) {
  const [aberta, setAberta] = useState(false);
  const [usado, setUsado] = useState(false);
  return (
    <>
      <button
        type="button"
        className={juntar(botao.icone, "ml-1 shrink-0")}
        aria-label="Código do site"
        title="Código do site (editar arquivos; salva no rascunho)"
        onClick={() => {
          setUsado(true);
          setAberta(true);
        }}
        data-abrir-codigo=""
      >
        <FileCode2 className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
      {usado && (
        <Suspense fallback={null}>
          <EditorDeCodigo site={site} aberta={aberta} onMudar={setAberta} />
        </Suspense>
      )}
    </>
  );
}
