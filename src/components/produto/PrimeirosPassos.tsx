import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { criarConta, fraseDoErro, listarPlanos, reais, type EstadoDoProduto } from "@/lib/produto/api";
import { useRelerProduto } from "@/hooks/useProduto";
import { CabecalhoDePagina, CampoDeFormulario, Carregando, EstadoVazio, GrupoDeCampos, Painel, botao, campo, juntar, texto } from "@/components/sistema";
import EscolhaDePlano from "./EscolhaDePlano";

/**
 * Quem entrou no produto e ainda não tem empresa: abre a própria (em teste) e
 * vira a pessoa que administra. Quem foi convidado e não confirmou o e-mail vê
 * o que falta. O admin da casa ganha o atalho para administrar o produto.
 */
export default function PrimeirosPassos({ estado }: { estado: EstadoDoProduto }) {
  const reler = useRelerProduto();
  const planos = useQuery({ queryKey: ["produto", "planos"], queryFn: () => listarPlanos(), staleTime: 300_000 });
  const [nome, setNome] = useState("");
  const [documento, setDocumento] = useState("");
  const [telefone, setTelefone] = useState("");
  const [plano, setPlano] = useState("starter");
  const [usuarios, setUsuarios] = useState(1);
  const [criando, setCriando] = useState(false);

  const lista = planos.data || [];
  useEffect(() => {
    if (lista.length && !lista.some((p) => p.id === plano)) setPlano(lista[0].id);
  }, [lista, plano]);

  if (estado.convite) {
    return (
      <EstadoVazio
        titulo={`Você foi convidado para ${estado.convite.conta}`}
        descricao="Confirme o seu e-mail pelo link que enviamos e entre de novo."
        acao={<button type="button" className={botao.secundario} onClick={() => void reler()}>Já confirmei</button>}
      />
    );
  }

  const escolhido = lista.filter((p) => p.id === plano)[0] || null;
  const total = escolhido ? escolhido.preco_usuario * usuarios : 0;

  const criar = async () => {
    if (nome.trim().length < 2) return void toast.error("Diga o nome da empresa.");
    setCriando(true);
    try {
      await criarConta({ nome: nome.trim(), documento, telefone, plano, usuarios });
      await reler();
      toast.success("Empresa criada. Bom trabalho.");
    } catch (e) {
      toast.error(fraseDoErro(e, "Não foi possível criar a empresa."));
    } finally {
      setCriando(false);
    }
  };

  return (
    <div className="mx-auto w-full min-w-0 max-w-[760px] space-y-5" data-primeiros-passos="">
      <CabecalhoDePagina
        titulo="Vamos abrir a sua empresa"
        descricao={estado.teste_dias > 0 ? `${estado.teste_dias} dias de teste, sem cartão` : undefined}
        ajuda="Você vira a pessoa que administra a empresa: convida a equipe, escolhe o plano e cuida da assinatura. Dá para mudar tudo depois."
      />
      {estado.dono_da_casa && (
        <p className={texto.auxiliar}>
          Você administra a Aceleriq. Para criar a empresa de um cliente, use{" "}
          <Link to="/produto" className="font-medium text-primary hover:underline">Administrar o produto</Link>.
        </p>
      )}
      <Painel>
        <GrupoDeCampos>
          <CampoDeFormulario rotulo="Nome da empresa" obrigatorio largo>
            <input value={nome} onChange={(e) => setNome(e.target.value)} className={campo} maxLength={120} autoComplete="organization" />
          </CampoDeFormulario>
          <CampoDeFormulario rotulo="CPF ou CNPJ" apoio="Pode preencher depois, antes de assinar">
            <input value={documento} onChange={(e) => setDocumento(e.target.value)} className={campo} inputMode="numeric" maxLength={20} />
          </CampoDeFormulario>
          <CampoDeFormulario rotulo="WhatsApp">
            <input value={telefone} onChange={(e) => setTelefone(e.target.value)} className={campo} inputMode="tel" maxLength={20} autoComplete="tel" />
          </CampoDeFormulario>
        </GrupoDeCampos>
      </Painel>

      {planos.isLoading ? (
        <Carregando linhas={3} rotulo="Carregando os planos" />
      ) : (
        <EscolhaDePlano planos={lista} plano={plano} usuarios={usuarios} onPlano={setPlano} onUsuarios={setUsuarios} />
      )}

      <div className="flex min-w-0 items-center border-t border-border pt-4">
        <p className={juntar(texto.corpo, "mr-3 min-w-0 flex-1")}>
          {escolhido ? (
            <>
              Depois do teste: <span className="font-semibold tabular-nums">{reais(total)}</span> por mês
            </>
          ) : null}
        </p>
        <button type="button" className={botao.primario} onClick={() => void criar()} disabled={criando || !escolhido} data-criar-empresa="">
          {criando ? "Criando..." : estado.teste_dias > 0 ? "Começar o teste" : "Criar empresa"}
        </button>
      </div>
    </div>
  );
}
