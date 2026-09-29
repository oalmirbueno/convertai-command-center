import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Layers } from "lucide-react";
import { AjudaRecolhida, SeletorCompacto } from "@/components/sistema";
import { useAvisarErro } from "@/components/mesa/Custo";
import { chamarTemplates, FIDELIDADES, ROTULO_DA_FIDELIDADE, rotuloDoTipo } from "./templatesApi";
import { chaveDoEstudio, type LeituraDoEstudio, useEstiloNoEstudio } from "./estiloApi";

/**
 * "Template" desta geração (frente T), ao lado do interruptor do estilo.
 * "Nenhum" é o padrão: a direção fica sem template_de_design e a geração é
 * exatamente a de hoje. Escolhido, grava direcao.template_de_design nos
 * trabalhos da tela; referência de carrossel pede também o nível (os mesmos
 * do Estúdio). Sem templates no cliente, não aparece.
 */
export default function SeletorDeTemplate({ clientId, marcaId, trabalhoIds, className = "" }: { clientId: string; marcaId?: string | null; trabalhoIds: string[]; className?: string }) {
  const avisarErro = useAvisarErro();
  const queryClient = useQueryClient();
  const ids = trabalhoIds.filter(Boolean).slice().sort();
  // Frente AG2: a lista leve dos templates e a escolha de cada peça vêm da leitura única do Estúdio (estudio_ler),
  // sem os links assinados de todas as imagens que o templates_estado assinava só para mostrar os nomes.
  const chave = chaveDoEstudio(clientId, marcaId, ids);
  const lido = useEstiloNoEstudio(clientId, marcaId, ids);
  const escolhasLidas = lido.data ? lido.data.escolhas : null;
  // Vários trabalhos (Estúdio Ads): mostra o escolhido só quando todos estão iguais.
  const primeiro = escolhasLidas && ids.length ? escolhasLidas[ids[0]] || null : null;
  const iguais = !!escolhasLidas && ids.every((id) => {
    const e = escolhasLidas![id] || null;
    return (e ? e.id : "") === (primeiro ? primeiro.id : "") && (e ? e.fidelidade || "" : "") === (primeiro ? primeiro.fidelidade || "" : "");
  });
  const doBanco = iguais && primeiro ? primeiro : null;
  const [valor, setValor] = useState<string>(doBanco ? doBanco.id : "");
  const [fidelidade, setFidelidade] = useState<string>(doBanco && doBanco.fidelidade ? doBanco.fidelidade : "identica");
  const [gravando, setGravando] = useState(false);
  useEffect(() => {
    setValor(doBanco ? doBanco.id : "");
    setFidelidade(doBanco && doBanco.fidelidade ? doBanco.fidelidade : "identica");
  }, [doBanco ? doBanco.id : "", doBanco ? doBanco.fidelidade : ""]); // eslint-disable-line react-hooks/exhaustive-deps

  const templates = lido.data ? lido.data.templates.filter((t) => t.status === "ativo") : [];
  const escolhido = templates.find((t) => t.id === valor) || null;

  const gravar = async (id: string, nivel: string) => {
    const antes = { valor, fidelidade };
    setValor(id);
    setFidelidade(nivel);
    setGravando(true);
    try {
      const ehReferencia = !!templates.find((t) => t.id === id && t.tipo === "referencia_carrossel");
      const r = await chamarTemplates<{ falhas?: string[] }>("template_no_trabalho", clientId, marcaId, { trabalho_ids: ids, template_id: id || null, ...(id && ehReferencia ? { fidelidade: nivel } : {}) });
      const falhas = r && Array.isArray(r.falhas) ? r.falhas : [];
      queryClient.setQueryData<LeituraDoEstudio | undefined>(chave, (d) => {
        if (!d) return d;
        const escolhas = { ...d.escolhas };
        for (const t of ids) if (falhas.indexOf(t) < 0) escolhas[t] = id ? { id, fidelidade: ehReferencia ? nivel : null } : null;
        return { ...d, escolhas };
      });
      if (falhas.length) throw new Error(`${falhas.length} de ${ids.length} não mudaram. Tente de novo.`);
    } catch (e) {
      setValor(antes.valor);
      setFidelidade(antes.fidelidade);
      avisarErro(e, "Não foi possível mudar o template desta geração");
    } finally {
      setGravando(false);
    }
  };

  if (!ids.length || (!templates.length && !valor)) return null;
  return (
    <div className={`inline-flex min-w-0 items-center ${gravando ? "opacity-70" : ""} ${className}`} data-seletor-de-template={valor ? "escolhido" : "nenhum"}>
      <SeletorCompacto
        rotulo="Template"
        modo="lista"
        icone={<Layers className="h-4 w-4" aria-hidden="true" />}
        opcoes={[{ valor: "", rotulo: "Nenhum" }, ...templates.map((t) => ({ valor: t.id, rotulo: t.nome, descricao: rotuloDoTipo(t) }))]}
        valor={valor}
        onEscolher={(v) => {
          if (!gravando && v !== valor) void gravar(v, fidelidade);
        }}
      />
      {escolhido && escolhido.tipo === "referencia_carrossel" && (
        <SeletorCompacto
          rotulo="Nível"
          modo="lista"
          opcoes={FIDELIDADES.map((f) => ({ valor: f, rotulo: ROTULO_DA_FIDELIDADE[f] }))}
          valor={fidelidade}
          onEscolher={(v) => {
            if (!gravando && v !== fidelidade) void gravar(valor, v);
          }}
          className="ml-1"
        />
      )}
      <AjudaRecolhida rotulo="O que faz o template">
        Nenhum: a geração fica como sempre. Com um template, a arte segue o molde e as âncoras dele; com uma referência de carrossel, cada lâmina segue a lâmina dela. A letra, as cores e a logo continuam as do cliente.
      </AjudaRecolhida>
    </div>
  );
}
