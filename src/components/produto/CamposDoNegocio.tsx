import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { escopoDoCrm } from "@/lib/comercial/escopo";
import { chaveDosCampos, listarCampos, type CampoDaEmpresa } from "@/lib/produto/campos";
import { CampoDeFormulario, GrupoDeCampos, campo as classeDoCampo, juntar, texto } from "@/components/sistema";

/**
 * Os campos próprios da empresa dentro da ficha do negócio (só no CRM da
 * empresa cliente). Agrupa pelo grupo que o gestor deu ("Carta", "Cota") e usa
 * o controle certo para cada tipo.
 */
export default function CamposDoNegocio({ valores, aoMudar }: { valores: Record<string, unknown>; aoMudar: (v: Record<string, unknown>) => void }) {
  const escopo = escopoDoCrm();
  const contaId = escopo.modo === "conta" ? escopo.contaId : "";
  const gestor = escopo.modo === "conta" && (escopo.papel === "admin" || escopo.papel === "gerente");
  const { data } = useQuery({ queryKey: chaveDosCampos(contaId), queryFn: listarCampos, enabled: !!contaId, staleTime: 60_000 });
  const ativos = useMemo(() => (data || []).filter((c) => c.ativo), [data]);
  const grupos = useMemo(() => {
    const nomes: string[] = [];
    ativos.forEach((c) => {
      if (nomes.indexOf(c.grupo) < 0) nomes.push(c.grupo);
    });
    return nomes.map((g) => ({ nome: g, campos: ativos.filter((c) => c.grupo === g) }));
  }, [ativos]);
  if (!contaId) return null;
  if (!ativos.length) {
    return gestor ? (
      <p className={juntar(texto.auxiliar, "mt-4")} data-sem-campos="">
        Quer pedir mais informações em cada negócio? <Link to="/app/conta?parte=campos" className="font-medium text-primary hover:underline">Crie os campos do seu ramo</Link>.
      </p>
    ) : null;
  }
  const mudar = (chave: string, v: unknown) => aoMudar({ ...valores, [chave]: v });
  const controle = (c: CampoDaEmpresa) => {
    const v = valores[c.chave];
    const txt = v === null || v === undefined ? "" : String(v);
    if (c.tipo === "lista") {
      return (
        <select value={txt} onChange={(e) => mudar(c.chave, e.target.value)} className={classeDoCampo}>
          <option value="">Escolher</option>
          {c.opcoes.map((o) => <option key={o} value={o}>{o}</option>)}
          {txt && c.opcoes.indexOf(txt) < 0 && <option value={txt}>{txt}</option>}
        </select>
      );
    }
    if (c.tipo === "sim_nao") {
      return (
        <select value={v === true || v === "sim" ? "sim" : v === false || v === "nao" ? "nao" : ""} onChange={(e) => mudar(c.chave, e.target.value === "" ? "" : e.target.value === "sim")} className={classeDoCampo}>
          <option value="">Não informado</option>
          <option value="sim">Sim</option>
          <option value="nao">Não</option>
        </select>
      );
    }
    if (c.tipo === "data") return <input type="date" value={txt.slice(0, 10)} onChange={(e) => mudar(c.chave, e.target.value)} className={classeDoCampo} />;
    if (c.tipo === "numero" || c.tipo === "dinheiro" || c.tipo === "porcentagem") {
      return <input type="number" min="0" step={c.tipo === "numero" ? "1" : "0.01"} value={txt} onChange={(e) => mudar(c.chave, e.target.value)} className={classeDoCampo} inputMode="decimal" />;
    }
    return <input value={txt} onChange={(e) => mudar(c.chave, e.target.value)} className={classeDoCampo} maxLength={300} />;
  };
  const sufixo = (c: CampoDaEmpresa) => (c.tipo === "dinheiro" ? " (R$)" : c.tipo === "porcentagem" ? " (%)" : "");
  return (
    <div data-campos-do-negocio="">
      {grupos.map((g) => (
        <GrupoDeCampos key={g.nome || "outros"} titulo={g.nome || "Mais informações"} className="mt-4">
          {g.campos.map((c) => (
            <CampoDeFormulario key={c.id} rotulo={`${c.rotulo}${sufixo(c)}`} obrigatorio={c.obrigatorio}>
              {controle(c)}
            </CampoDeFormulario>
          ))}
        </GrupoDeCampos>
      ))}
    </div>
  );
}
