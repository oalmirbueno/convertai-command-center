import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Save, MessageCircle } from "lucide-react";
import { AjudaRecolhida } from "@/components/sistema";
import {
  carregarCanais,
  salvarCanal,
  type CanalComunidade,
} from "@/lib/membros/canais";
import { mensagemDoErro } from "@/lib/membros/api";
import { useAuth } from "@/contexts/AuthContext";
export default function CanaisDoProduto({ produto }: { produto: string }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const dados = useQuery({
    queryKey: ["membros", "canais-admin", user?.id, produto],
    queryFn: () => carregarCanais(produto),
    retry: false,
  });
  const [novo, setNovo] = useState<CanalComunidade | null>(null);
  const [aviso, setAviso] = useState("");
  const [ocupado, setOcupado] = useState(false);
  async function salvar(linha: CanalComunidade) {
    setOcupado(true);
    setAviso("");
    try {
      await salvarCanal(linha);
      await qc.invalidateQueries({ queryKey: ["membros"] });
      setNovo(null);
      setAviso("Grupo salvo.");
    } catch (e) {
      setAviso(mensagemDoErro(e));
    } finally {
      setOcupado(false);
    }
  }
  return (
    <details className="membros-bloco mt-6">
      <summary className="membros-acao">
        <MessageCircle size={16} />
        Grupos da comunidade
      </summary>
      <div className="space-y-3 pt-3">
        <AjudaRecolhida rotulo="Configurar grupos do produto">
          Cadastre WhatsApp, Telegram e outros grupos. Apenas membros com acesso
          a este produto recebem os links. Uma comunidade de produto desativada
          não libera os grupos.
        </AjudaRecolhida>
        {dados.isError && (
          <p role="alert">
            Não foi possível carregar os grupos.{" "}
            <button type="button" onClick={() => void dados.refetch()}>
              Tentar novamente
            </button>
          </p>
        )}
        {(dados.data || []).map((c) => (
          <div key={c.id} className="flex items-center gap-2 min-w-0">
            <span className="flex-1 truncate text-[13px]">{c.nome}</span>
            <button
              type="button"
              className="membros-acao"
              onClick={() => setNovo({ ...c })}
            >
              Editar
            </button>
            <button
              type="button"
              disabled={ocupado}
              className="membros-acao"
              onClick={() => void salvar({ ...c, ativo: !c.ativo })}
            >
              {c.ativo ? "Pausar" : "Ativar"}
            </button>
          </div>
        ))}
        <button
          type="button"
          className="membros-acao"
          onClick={() =>
            setNovo({
              id: crypto.randomUUID(),
              produto_id: produto,
              tipo: "whatsapp",
              nome: "",
              url: "",
              ativo: true,
              ordem: 0,
            })
          }
        >
          <Plus size={15} />
          Adicionar grupo
        </button>
        {novo && (
          <form
            className="grid sm:grid-cols-2 gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              void salvar(novo);
            }}
          >
            <label className="text-[12px] space-y-2">
              Nome
              <input
                className="membros-campo"
                required
                maxLength={80}
                value={novo.nome}
                onChange={(e) => setNovo({ ...novo, nome: e.target.value })}
              />
            </label>
            <label className="text-[12px] space-y-2">
              Canal
              <select
                className="membros-campo"
                value={novo.tipo}
                onChange={(e) =>
                  setNovo({
                    ...novo,
                    tipo: e.target.value as CanalComunidade["tipo"],
                  })
                }
              >
                <option value="whatsapp">WhatsApp</option>
                <option value="telegram">Telegram</option>
                <option value="outro">Outro grupo</option>
              </select>
            </label>
            <label className="sm:col-span-2 text-[12px] space-y-2">
              Link HTTPS
              <input
                type="url"
                pattern="https://.*"
                required
                maxLength={2000}
                className="membros-campo"
                value={novo.url}
                onChange={(e) => setNovo({ ...novo, url: e.target.value })}
              />
            </label>
            <div className="flex gap-2">
              <button
                disabled={ocupado}
                className="membros-acao bg-primary text-primary-foreground"
              >
                <Save size={15} />
                Salvar grupo
              </button>
              <button
                type="button"
                className="membros-acao"
                onClick={() => setNovo(null)}
              >
                Cancelar
              </button>
            </div>
          </form>
        )}
        {aviso && (
          <p role="status" className="text-[13px]">
            {aviso}
          </p>
        )}
      </div>
    </details>
  );
}
