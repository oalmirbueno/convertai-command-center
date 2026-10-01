import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { FileText, Link2, Loader2, Paperclip, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useMesa } from "@/components/mesa/MesaContexto";
import { useAvisarErro } from "@/components/mesa/Custo";
import Secao from "@/components/sistema/Secao";
import { CampoDeFormulario } from "@/components/sistema/Formulario";
import { RotuloLargo } from "@/components/sistema/BotaoComIcone";
import { botao, campo, juntar, lista, texto } from "@/components/sistema/estilos";
import { nomeSeguroDeArquivo, normalizarAnexos, tiraOLink, type AnexoDaProposta } from "../../../supabase/functions/_shared/proposta-comercial";
import { aplicarNaLista, chamarProposta, type Proposta } from "./propostaApi";
import { useConfirmarTirarOLink, useIrParaEtapa } from "./navegacaoDaProposta";

/**
 * Anexos da proposta (frente PRO2): link do portfólio e PDF (apresentação,
 * portfólio, estudo). O PDF sobe para o Storage privado da mesa, na pasta do
 * cliente (<cliente>/propostas/<proposta>/...), e o link público recebe um
 * endereço assinado de 1 hora. Tirar da lista não apaga o arquivo.
 *
 * Frente UXS (30/09): mora no Rascunho, embaixo do Modelo visual, perto da
 * prévia onde o cliente vê o resultado. Grava direto (não apaga edição de
 * outra seção) e fica desligado enquanto o rascunho tem alteração não salva.
 * Numa proposta enviada, pergunta antes (tira o link do cliente), e no caso
 * do PDF antes de subir o arquivo (quem cancela não deixa arquivo órfão).
 */

const MAX_BYTES = 15 * 1024 * 1024;
const TIPOS_ACEITOS = ["application/pdf", "image/png", "image/jpeg", "image/webp"];

export default function AnexosDaProposta({ proposta, bloqueio = null }: { proposta: Proposta; /** Por que não dá para gravar agora (ex.: "Salve antes de anexar"). */ bloqueio?: string | null }) {
  const mesa = useMesa();
  const qc = useQueryClient();
  const avisarErro = useAvisarErro();
  const confirmarTirar = useConfirmarTirarOLink();
  const irPara = useIrParaEtapa();
  const entrada = useRef<HTMLInputElement | null>(null);
  const [titulo, setTitulo] = useState("");
  const [url, setUrl] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const aceita = proposta.status === "aceita";
  const desligado = ocupado || aceita || !!bloqueio;

  const gravar = async (anexos: AnexoDaProposta[], ok: string) => {
    const tirou = tiraOLink(proposta.status, ["anexos"]);
    const d = await chamarProposta<any>("salvar", { proposta_id: proposta.id, versao_base: proposta.versao, anexos });
    aplicarNaLista(qc, mesa.clientId, d && d.proposta);
    if (tirou) toast.success(ok, { description: "A proposta voltou para rascunho. Envie de novo para o cliente ver.", action: { label: "Ir para Enviar", onClick: () => irPara("envio") } });
    else toast.success(ok);
  };

  const adicionarLink = async () => {
    const novo = normalizarAnexos([{ tipo: "link", titulo, url: url.trim() }])[0];
    if (!novo) {
      toast.error("Escreva um link que comece com https://.");
      return;
    }
    if (!(await confirmarTirar(proposta.status, ["anexos"], "Anexar"))) return;
    setOcupado(true);
    try {
      await gravar(proposta.anexos.concat([{ ...novo, id: `a${Date.now().toString(36)}` }]), "Link anexado.");
      setTitulo("");
      setUrl("");
    } catch (e) {
      avisarErro(e, "O link não foi anexado");
    } finally {
      setOcupado(false);
    }
  };

  const subir = async (arquivos: FileList | null) => {
    const arquivo = arquivos && arquivos[0];
    const limpar = () => {
      if (entrada.current) entrada.current.value = "";
    };
    if (!arquivo) return;
    if (TIPOS_ACEITOS.indexOf(arquivo.type) < 0) {
      toast.error("Mande PDF ou imagem (PNG, JPG ou WebP).");
      limpar();
      return;
    }
    if (arquivo.size > MAX_BYTES) {
      toast.error("O arquivo passa de 15 MB. Mande uma versão menor.");
      limpar();
      return;
    }
    // Pergunta antes de subir: quem cancela não deixa arquivo sem uso no Storage.
    if (!(await confirmarTirar(proposta.status, ["anexos"], "Anexar"))) {
      limpar();
      return;
    }
    setOcupado(true);
    try {
      const caminho = `${proposta.client_id}/propostas/${proposta.id}/${Date.now().toString(36)}-${nomeSeguroDeArquivo(arquivo.name)}`;
      const { error } = await supabase.storage.from("mesa").upload(caminho, arquivo, { contentType: arquivo.type, upsert: false });
      if (error) throw error;
      const nome = arquivo.name.replace(/\.[a-z0-9]+$/i, "").slice(0, 120) || "Arquivo";
      await gravar(proposta.anexos.concat([{ id: `a${Date.now().toString(36)}`, tipo: "arquivo", titulo: nome, url: "", caminho }]), "Arquivo anexado.");
    } catch (e) {
      avisarErro(e, "O arquivo não foi anexado");
    } finally {
      setOcupado(false);
      limpar();
    }
  };

  const tirar = async (id: string) => {
    if (!(await confirmarTirar(proposta.status, ["anexos"], "Tirar"))) return;
    try {
      await gravar(proposta.anexos.filter((a) => a.id !== id), "Tirado da proposta.");
    } catch (e) {
      avisarErro(e, "Não foi possível tirar");
    }
  };

  const motivo = aceita ? "Proposta aceita não muda" : bloqueio || undefined;
  return (
    <Secao
      titulo="Anexos"
      divisoria
      recolhidaDeInicio
      descricao={`${proposta.anexos.length ? `${proposta.anexos.length} na proposta` : "Nenhum"}${bloqueio ? ` · ${bloqueio.toLowerCase()}` : ""}`}
      ajuda="Portfólio, apresentação ou estudo que o cliente abre no fim da proposta. Link fica como está; PDF e imagem sobem para o armazenamento privado e o cliente recebe um endereço que vale 1 hora a cada abertura. Anexar grava na hora: com o rascunho sem salvar, salve antes."
      acao={
        <>
          <input ref={entrada} type="file" className="hidden" accept=".pdf,.png,.jpg,.jpeg,.webp" onChange={(e) => void subir(e.target.files)} />
          <button type="button" className={botao.secundario} onClick={() => entrada.current && entrada.current.click()} disabled={desligado} aria-label="Anexar PDF ou imagem" title={motivo}>
            {ocupado ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}
            <RotuloLargo>PDF</RotuloLargo>
          </button>
        </>
      }
    >
      {proposta.anexos.length > 0 && (
        <ul className={juntar(lista.aberta, lista.divisoria)} aria-label="Anexos da proposta">
          {proposta.anexos.map((a) => (
            <li key={a.id} className={lista.linha}>
              {a.tipo === "link" ? <Link2 className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" /> : <FileText className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
              <span className={juntar(texto.corpo, "min-w-0 flex-1 truncate")} title={a.url || a.caminho}>
                {a.titulo}
              </span>
              <button type="button" className={juntar(botao.icone, "ml-2")} aria-label={`Tirar ${a.titulo}`} onClick={() => void tirar(a.id)} disabled={desligado} title={motivo}>
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {!aceita && (
        <div className="mt-3 grid min-w-0 items-end gap-2 sm:grid-cols-[minmax(0,200px)_minmax(0,1fr)_auto]">
          <CampoDeFormulario rotulo="Título do link">
            <input value={titulo} onChange={(e) => setTitulo(e.target.value)} maxLength={120} className={campo} placeholder="Portfólio" />
          </CampoDeFormulario>
          <CampoDeFormulario rotulo="Link">
            <input value={url} onChange={(e) => setUrl(e.target.value)} className={campo} placeholder="https://" />
          </CampoDeFormulario>
          <button type="button" className={botao.secundario} onClick={() => void adicionarLink()} disabled={desligado || !url.trim()} title={motivo}>
            Anexar link
          </button>
        </div>
      )}
    </Secao>
  );
}
