import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { AlertTriangle } from "lucide-react";
import { CHAVE_DOS_DADOS_DA_AGENCIA, faltasNosDados, lerDadosDaAgenciaNaTela, textoDasFaltas } from "@/lib/agencia/dadosDaAgencia";
import { juntar, texto } from "@/components/sistema/estilos";

/**
 * Uma linha de estado quando faltam dados da agência para a proposta (nome,
 * e-mail, telefone e logo, frente BASE). Gerar e enviar ficam travados no
 * servidor até isso ser preenchido em Configurações; aqui a equipe vê antes.
 */
export default function AvisoDaAgencia() {
  const dados = useQuery({ queryKey: CHAVE_DOS_DADOS_DA_AGENCIA, queryFn: lerDadosDaAgenciaNaTela, staleTime: 60_000 });
  if (!dados.data) return null;
  const falta = textoDasFaltas(faltasNosDados(dados.data, "proposta"));
  if (!falta) return null;
  return (
    <p className={juntar(texto.auxiliar, "flex min-w-0 items-center text-warning")} role="status" data-aviso-da-agencia="">
      <AlertTriangle className="mr-1.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span className="min-w-0 truncate" title={falta}>
        {falta}
      </span>
      <Link to="/config" className="ml-2 shrink-0 underline">
        Abrir
      </Link>
    </p>
  );
}
