import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Layers } from "lucide-react";
import { AjudaRecolhida, SeletorCompacto } from "@/components/sistema";
import { useAvisarErro } from "@/components/mesa/Custo";
import { chamarTemplates, chaveDosTemplates, FIDELIDADES, normalizarEstadoDosTemplates, ROTULO_DA_FIDELIDADE, rotuloDoTipo } from "./templatesApi";

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
  const lista = useQuery({
    queryKey: chaveDosTemplates(clientId, marcaId, false),
    queryFn: async () => normalizarEstadoDosTemplates(await chamarTemplates("templates_estado", clientId, marcaId, {})),
    enabled: ids.length > 0,
    staleTime: 60_000,
  });
  const chave = ["estilo-template-no-trabalho", clientId, ids.join(",")];
  const lido = useQuery({
    queryKey: chave,
    queryFn: async () => {
      const d = await chamarTemplates<{ escolhas?: Record<string, { id: string; fidelidade: string | null } | null> }>("template_no_trabalho_ler", clientId, marcaId, { trabalho_ids: ids });
      return (d && d.escolhas) || {};
    },
    enabled: ids.length > 0,
    staleTime: 30_000,
  });
  // Vários trabalhos (Estúdio Ads): mostra o escolhido só quando todos estão iguais.
  const primeiro = lido.data && ids.length ? lido.data[ids[0]] || null : null;
  const iguais = !!lido.data && ids.every((id) => {
    const e = lido.data![id] || null;
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

  const templates = lista.data ? lista.data.templates.filter((t) => t.status === "ativo") : [];
  const escolhido = templates.find((t) => t.id === valor) || null;

  const gravar = async (id: string, nivel: string) => {
    const antes = { valor, fidelidade };
    setValor(id);
    setFidelidade(nivel);
    setGravando(true);
    try {
      const ehReferencia = !!templates.find((t) => t.id === id && t.tipo === "referencia_carrossel");
      await chamarTemplates("template_no_trabalho", clientId, marcaId, { trabalho_ids: ids, template_id: id || null, ...(id && ehReferencia ? { fidelidade: nivel } : {}) });
      const novo: Record<string, { id: string; fidelidade: string | null } | null> = {};
      for (const t of ids) novo[t] = id ? { id, fidelidade: ehReferencia ? nivel : null } : null;
      queryClient.setQueryData(chave, novo);
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
