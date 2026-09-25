import { useEffect, useRef, useState, type ClipboardEvent as EventoDeColar, type DragEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ClipboardPaste, Link2, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { chamarFuncao, textoDoErro } from "@/lib/mesa/api";
import { marcaParaGravarAgora } from "@/lib/mesa/marcas";
import { chaveDasReferenciasComDestaque, subirReferencia } from "@/lib/mesa/referencias";
import { decidirColar, imagensDoColar } from "./EstudioFotos";
import { useMesa } from "./MesaContexto";
import { corpoDoImportarLink, ehLinkColado, juntarReferenciaNaHora } from "./estudioUtil";

/**
 * Referência na hora (dono, 26/09: "se eu quiser subir uma referência na
 * hora, posso arrastar, subir ou colar (Ctrl+V), e ele reconhece"). Quatro
 * jeitos, todos viram referência de composição do cliente e entram NA HORA
 * na lista escolhida (da lâmina ou do conjunto), por último; passou de 2, sai
 * a mais antiga:
 * - soltar o arquivo (arrastar);
 * - "Arquivo" (escolher do computador);
 * - colar a imagem (Ctrl+V com print ou imagem copiada): no campo e, com
 *   `ouvirColarNaJanela`, em qualquer ponto do painel que não seja outro campo;
 * - colar o link (Pinterest, Behance, endereço de imagem ou página com imagem
 *   de capa): estudio-arte referencias/importar_link.
 * O colar usa clipboardData.items (Safari 11 e Chrome 64) e, sem ele, files;
 * sem clipboardData nenhum, o texto do campo segue normal.
 */

const aceitas = (lista: File[]) => lista.filter((f) => f && String(f.type || "").indexOf("image/") === 0).slice(0, 2);

export default function EstudioReferenciaNaHora({
  escolhidas,
  onGravar,
  alvoRotulo,
  bloqueado = false,
  motivoDoBloqueio,
  compacto = false,
  ouvirColarNaJanela = false,
}: {
  /** Referências escolhidas agora no alvo (lâmina ou conjunto). */
  escolhidas: string[];
  /** Grava a lista nova no alvo (configurar, sem custo). */
  onGravar: (ids: string[]) => void | Promise<void>;
  /** Ex.: "lâmina 2" ou "conjunto". */
  alvoRotulo: string;
  bloqueado?: boolean;
  motivoDoBloqueio?: string;
  /** Versão de uma linha, para a faixa em cima da lâmina. */
  compacto?: boolean;
  /** Ouve o Ctrl+V no painel inteiro (a ferramenta Referências aberta). */
  ouvirColarNaJanela?: boolean;
}) {
  const { clientId } = useMesa();
  const queryClient = useQueryClient();
  const [ocupado, setOcupado] = useState(0);
  const [arrastando, setArrastando] = useState(false);
  const [link, setLink] = useState("");
  const campo = useRef<HTMLInputElement>(null);
  const arquivo = useRef<HTMLInputElement>(null);
  // A lista mais recente: duas chegando seguidas não se perdem.
  const lista = useRef<string[]>(escolhidas);
  lista.current = escolhidas;
  // O Ctrl+V do painel é ouvido uma vez só: a gravação e o rótulo vêm sempre da tela atual.
  const atual = useRef({ onGravar, alvoRotulo });
  atual.current = { onGravar, alvoRotulo };

  const impedir = (): boolean => {
    if (!bloqueado) return false;
    toast.error(motivoDoBloqueio || "Agora não dá para mudar as referências.");
    return true;
  };

  const incluir = async (id: string) => {
    const { ids, saiu } = juntarReferenciaNaHora(lista.current, id);
    lista.current = ids;
    await atual.current.onGravar(ids);
    void queryClient.invalidateQueries({ queryKey: chaveDasReferenciasComDestaque(clientId) });
    toast.success(`Referência escolhida (${atual.current.alvoRotulo})`, {
      description: saiu ? "Entrou no lugar da mais antiga (até 2): gere a lâmina de novo para usar." : "Gere a lâmina de novo para usar.",
    });
  };

  const receberArquivos = async (brutos: File[]) => {
    const arquivos = aceitas(brutos);
    if (!arquivos.length || impedir()) return;
    setOcupado((n) => n + 1);
    try {
      for (const a of arquivos) await incluir(await subirReferencia(clientId, a));
    } catch (e) {
      toast.error("Referência não enviada", { description: textoDoErro(e) });
    } finally {
      setOcupado((n) => Math.max(0, n - 1));
    }
  };

  const receberLink = async (bruto: string) => {
    const url = String(bruto || "").trim();
    if (!ehLinkColado(url)) {
      toast.error("Cole um link completo (https://...) do Pinterest, do Behance ou de uma imagem.");
      return;
    }
    if (impedir()) return;
    setOcupado((n) => n + 1);
    try {
      const d = await chamarFuncao<{ referencia?: { id?: string; papel?: string; ativa?: boolean }; ja_existia?: boolean }>(
        "estudio-arte",
        corpoDoImportarLink(clientId, url, marcaParaGravarAgora(clientId)),
      );
      const ref = d && d.referencia;
      if (!ref || !ref.id) throw new Error("O link não voltou como referência. Tente de novo.");
      // Já existia desligada ou como arte da marca: volta como composição e em uso (como o pin).
      if (ref.papel !== "tecnica" || ref.ativa === false) {
        await (supabase as any).from("cliente_referencias").update({ papel: "tecnica", ativa: true }).eq("id", ref.id);
      }
      setLink("");
      await incluir(ref.id);
    } catch (e) {
      toast.error("Link não virou referência", { description: textoDoErro(e) });
    } finally {
      setOcupado((n) => Math.max(0, n - 1));
    }
  };

  // Ctrl+V no painel: imagem sempre; link só fora de outro campo (texto nos outros campos cola normal).
  useEffect(() => {
    if (!ouvirColarNaJanela) return;
    const aoColar = (e: ClipboardEvent) => {
      if (e.defaultPrevented) return;
      const dados = e.clipboardData || null;
      const alvo = e.target as HTMLElement | null;
      const editavel = !!alvo && (alvo.tagName === "INPUT" || alvo.tagName === "TEXTAREA" || alvo.isContentEditable);
      if (editavel && alvo !== campo.current) return;
      const { imagens, bloquear } = decidirColar(dados);
      if (imagens.length) {
        if (bloquear) e.preventDefault();
        void receberArquivos(imagens);
        return;
      }
      if (editavel) return;
      let texto = "";
      try {
        texto = dados && typeof dados.getData === "function" ? dados.getData("text/plain") : "";
      } catch {
        texto = "";
      }
      if (ehLinkColado(texto)) {
        e.preventDefault();
        void receberLink(texto);
      }
    };
    window.addEventListener("paste", aoColar);
    return () => window.removeEventListener("paste", aoColar);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ouvirColarNaJanela, clientId, bloqueado]);

  const colarNoCampo = (e: EventoDeColar<HTMLInputElement>) => {
    const dados = e.clipboardData || null;
    const imagens = imagensDoColar(dados);
    if (imagens.length) {
      e.preventDefault();
      void receberArquivos(imagens);
      return;
    }
    let texto = "";
    try {
      texto = dados && typeof dados.getData === "function" ? dados.getData("text/plain") : "";
    } catch {
      texto = "";
    }
    if (ehLinkColado(texto)) {
      e.preventDefault();
      void receberLink(texto);
    }
  };

  const soltar = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setArrastando(false);
    const recebidos: File[] = [];
    const t = e.dataTransfer;
    if (t && t.files) for (let i = 0; i < t.files.length; i++) recebidos.push(t.files[i]);
    if (recebidos.length) {
      void receberArquivos(recebidos);
      return;
    }
    // Imagem arrastada de outra página: vem como link.
    let texto = "";
    try {
      texto = t ? t.getData("text/uri-list") || t.getData("text/plain") : "";
    } catch {
      texto = "";
    }
    const primeira = String(texto || "").split("\n").map((l) => l.trim()).filter((l) => l && l.charAt(0) !== "#")[0] || "";
    if (ehLinkColado(primeira)) void receberLink(primeira);
  };

  const entrada = (
    <input
      ref={arquivo}
      type="file"
      accept="image/jpeg,image/png,image/webp"
      multiple
      className="hidden"
      aria-label="Escolher imagem de referência"
      onChange={(e) => {
        const recebidos: File[] = [];
        const l = e.target.files;
        if (l) for (let i = 0; i < l.length; i++) recebidos.push(l[i]);
        e.target.value = "";
        void receberArquivos(recebidos);
      }}
    />
  );

  const formulario = (
    <form
      className="flex min-w-0 flex-1 items-center"
      onSubmit={(e) => {
        e.preventDefault();
        void receberLink(link);
      }}
    >
      <Input
        ref={campo}
        value={link}
        onChange={(e) => setLink(e.target.value)}
        onPaste={colarNoCampo}
        placeholder={compacto ? "Cole link ou imagem (Ctrl+V)" : "Cole aqui o link (Pinterest, Behance, imagem) ou a imagem com Ctrl+V"}
        aria-label={`Colar link ou imagem de referência (${alvoRotulo})`}
        className={`${compacto ? "h-7 text-[11.5px]" : "h-9 text-[12.5px]"} min-w-0 flex-1`}
        disabled={bloqueado}
      />
      {link.trim() && (
        <Button type="submit" size="sm" variant="outline" className={`${compacto ? "h-7" : "h-9"} ml-1.5 shrink-0 px-2 text-[11.5px]`} disabled={ocupado > 0}>
          <Link2 className="mr-1 h-3.5 w-3.5" /> Usar
        </Button>
      )}
    </form>
  );

  const botaoArquivo = (
    <Button
      type="button"
      size="sm"
      variant="outline"
      className={`${compacto ? "h-7 px-2 text-[11.5px]" : "h-9 text-[12px]"} ml-1.5 shrink-0`}
      disabled={bloqueado || ocupado > 0}
      onClick={() => arquivo.current && arquivo.current.click()}
    >
      {ocupado > 0 ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Upload className="mr-1 h-3.5 w-3.5" />} Arquivo
    </Button>
  );

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        if (!arrastando) setArrastando(true);
      }}
      onDragLeave={() => setArrastando(false)}
      onDrop={soltar}
      aria-label={`Soltar imagem de referência (${alvoRotulo})`}
      data-referencia-na-hora=""
      className={
        compacto
          ? `mt-1.5 flex min-w-0 items-center rounded-md border border-dashed px-1.5 py-1 transition-colors ${arrastando ? "border-primary bg-primary/5" : "border-border"}`
          : `rounded-lg border border-dashed px-3 py-3 transition-colors ${arrastando ? "border-primary bg-primary/5" : "border-border bg-background"}`
      }
    >
      {compacto ? (
        <>
          <ClipboardPaste className="mr-1.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          {formulario}
          {botaoArquivo}
        </>
      ) : (
        <>
          <p className="flex items-center text-[12.5px] font-medium">
            <ClipboardPaste className="mr-1.5 h-4 w-4 text-primary" /> Referência na hora ({alvoRotulo})
          </p>
          <p className="mt-0.5 text-[11.5px] leading-snug text-muted-foreground">
            Arraste a imagem para cá, escolha o arquivo, cole a imagem (Ctrl+V) ou cole o link. Entra na hora como escolhida (até 2; a mais antiga sai).
          </p>
          <div className="mt-2 flex min-w-0 items-center">
            {formulario}
            {botaoArquivo}
          </div>
        </>
      )}
      {entrada}
    </div>
  );
}
