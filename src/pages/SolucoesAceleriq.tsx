import { Link } from "react-router-dom";
import { ArrowLeft, BookOpen } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { destinoOperacional } from "@/lib/membros/modelo";
import { Navigate } from "react-router-dom";
import { MarcaAceleriq } from "@/components/publico/CascaPublica";
import { texto } from "@/components/sistema";
import "@/components/membros/membros.css";

/** Sem preços, depoimentos, benefícios ou destinos inventados. O catálogo publicado é a oferta real. */
export default function SolucoesAceleriq() {
  const { profile } = useAuth();
  if (destinoOperacional(profile?.role) === "/dashboard")
    return <Navigate to="/dashboard" replace />;
  return (
    <main className="min-h-dvh bg-background px-6 py-12">
      <div className="max-w-3xl mx-auto space-y-8">
        <MarcaAceleriq altura={36} />
        <h1 className={texto.tituloPagina}>Conheça as soluções da Aceleriq</h1>
        <p className="text-[13px] leading-6 text-muted-foreground max-w-xl">
          A Aceleriq organiza estratégia, criação e execução para empresas. O
          painel operacional é reservado às empresas com acesso autorizado. Na
          biblioteca você encontra os produtos digitais publicados, suas
          condições e as ofertas disponíveis.
        </p>
        <Link
          to="/membros"
          className="membros-acao bg-primary text-primary-foreground"
        >
          <BookOpen size={18} />
          Explorar produtos
          <ArrowLeft size={16} className="rotate-180" />
        </Link>
      </div>
    </main>
  );
}
