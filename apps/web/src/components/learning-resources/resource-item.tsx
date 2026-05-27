"use client";

import {
  BookMarked,
  Image as ImageIcon,
  Trash2,
  ArrowUpRight,
} from "lucide-react";
import type { LearningResource } from "@studiq/types";
import { useT } from "@/i18n";

interface Props {
  resource: LearningResource;
  /** Teacher view shows the delete button. */
  canManage?: boolean;
  onDelete?: (id: string) => void;
}

export function ResourceItem({ resource, canManage = false, onDelete }: Props) {
  const t = useT();
  // Use BookMarked as the consistent study-material icon for all non-image
  // files (PDFs, formula sheets, summaries). Images keep their own icon so
  // the visual cue remains useful in mixed lists.
  const isImage = resource.file_type.startsWith("image/");
  const Icon = isImage ? ImageIcon : BookMarked;

  return (
    <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-gray-100 bg-white hover:border-gray-200 transition-colors">
      <div className="w-9 h-9 rounded-md bg-gray-50 flex items-center justify-center flex-shrink-0">
        <Icon size={16} className="text-gray-500" />
      </div>

      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-semibold text-gray-800 truncate">
          {resource.title}
        </div>
        {resource.description ? (
          <div className="text-[11px] text-gray-500 truncate">
            {resource.description}
          </div>
        ) : (
          <div className="text-[11px] text-gray-400 truncate">
            {resource.file_name}
          </div>
        )}
      </div>

      <a
        href={resource.file_url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-gray-500 hover:text-brand-600 flex-shrink-0"
        title={t("resources.open")}
      >
        <ArrowUpRight size={16} />
      </a>

      {canManage && onDelete && (
        <button
          type="button"
          onClick={() => {
            if (confirm(t("resources.deleteConfirm"))) onDelete(resource.id);
          }}
          className="text-gray-400 hover:text-red-600 flex-shrink-0"
          title={t("resources.delete")}
        >
          <Trash2 size={16} />
        </button>
      )}
    </div>
  );
}
