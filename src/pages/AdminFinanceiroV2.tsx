import { History } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { FinanceDashboardV2 } from "@/features/finance-v2/FinanceDashboardV2";

export default function AdminFinanceiroV2() {
  return (
    <div className="container mx-auto max-w-[1600px] px-3 py-5 sm:px-6">
      <div className="mb-3 flex justify-end">
        <Button variant="outline" size="sm" asChild>
          <Link to="/financeiro/classico">
            <History className="mr-2 size-4" />
            Abrir financeiro clássico
          </Link>
        </Button>
      </div>
      <FinanceDashboardV2 />
    </div>
  );
}
