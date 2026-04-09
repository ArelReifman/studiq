import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { formatPercent } from "@/lib/utils";
import { User, ArrowRight } from "lucide-react";

interface StudentCardProps {
  id: string;
  full_name: string;
  grade_level: string | null;
  avg_completion_rate: string | null;
  weak_topics: string[];
  ai_summary: string | null;
}

export function StudentCard({
  id,
  full_name,
  grade_level,
  avg_completion_rate,
  weak_topics,
  ai_summary,
}: StudentCardProps) {
  const rate = avg_completion_rate ? Number(avg_completion_rate) : null;

  return (
    <Link href={`/teacher/students/${id}`}>
      <Card className="hover:shadow-md transition-shadow cursor-pointer h-full">
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 bg-brand-100 rounded-full flex items-center justify-center flex-shrink-0">
              <User size={16} className="text-brand-600" />
            </div>
            <div>
              <p className="font-medium text-sm">{full_name}</p>
              {grade_level && (
                <p className="text-xs text-gray-400">{grade_level}</p>
              )}
            </div>
          </div>
          {rate !== null && (
            <Badge variant={rate >= 0.7 ? "success" : rate >= 0.4 ? "warning" : "danger"}>
              {formatPercent(rate)}
            </Badge>
          )}
        </div>

        {weak_topics.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-3">
            {weak_topics.slice(0, 3).map((t) => (
              <Badge key={t} variant="danger" className="text-xs">
                {t}
              </Badge>
            ))}
          </div>
        )}

        {ai_summary && (
          <p className="text-xs text-gray-500 line-clamp-2">{ai_summary}</p>
        )}

        <div className="flex justify-end mt-3">
          <ArrowRight size={14} className="text-gray-300" />
        </div>
      </Card>
    </Link>
  );
}
