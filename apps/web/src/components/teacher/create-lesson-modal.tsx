"use client";

import { useState, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { X, Plus, Trash2, Upload, FileText, Paperclip } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n";

interface CreateLessonModalProps {
  studentId: string;
  onClose: () => void;
}

export function CreateLessonModal({ studentId, onClose }: CreateLessonModalProps) {
  const t = useT();
  const qc = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [homework, setHomework] = useState<{ title: string; description: string }[]>([
    { title: "", description: "" },
  ]);
  const [todos, setTodos] = useState<{ title: string }[]>([{ title: "" }]);
  const [file, setFile] = useState<File | null>(null);

  const createMutation = useMutation({
    mutationFn: async () => {
      // Filter out empty items
      const validHw = homework.filter((h) => h.title.trim());
      const validTodos = todos.filter((td) => td.title.trim());

      const lesson = await api.post<{ id: string }>("/lessons/create", {
        student_id: studentId,
        title: title.trim(),
        description: description.trim() || undefined,
        homework: validHw,
        todos: validTodos,
      });

      // Upload material PDF if provided — direct to Supabase, bypassing Vercel's body limit.
      // If upload fails we roll the lesson back so retries don't create duplicates.
      if (file && lesson.id) {
        try {
          await api.uploadDirect(
            `/upload/lesson/${lesson.id}/sign`,
            `/upload/lesson/${lesson.id}/confirm`,
            file
          );
        } catch (uploadErr) {
          try {
            await api.delete(`/lessons/${lesson.id}`);
          } catch {
            // swallow rollback error; surface the original upload error below
          }
          throw uploadErr;
        }
      }

      return lesson;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["lessons"] });
      onClose();
    },
  });

  const addHomework = () => setHomework([...homework, { title: "", description: "" }]);
  const removeHomework = (i: number) => setHomework(homework.filter((_, idx) => idx !== i));
  const updateHomework = (i: number, field: "title" | "description", value: string) => {
    const copy = [...homework];
    copy[i] = { ...copy[i], [field]: value };
    setHomework(copy);
  };

  const addTodo = () => setTodos([...todos, { title: "" }]);
  const removeTodo = (i: number) => setTodos(todos.filter((_, idx) => idx !== i));
  const updateTodo = (i: number, value: string) => {
    const copy = [...todos];
    copy[i] = { title: value };
    setTodos(copy);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (selected) setFile(selected);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const isValid = title.trim().length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-lg font-semibold">{t("createLesson.title")}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={20} />
          </button>
        </div>

        <div className="px-6 py-5 space-y-5">
          {/* Lesson title */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t("createLesson.lessonTitle")} *
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t("createLesson.titlePlaceholder")}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t("createLesson.description")} {t("common.optional")}
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t("createLesson.descPlaceholder")}
              rows={2}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>

          {/* Material upload */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t("createLesson.material")} {t("common.optional")}
            </label>
            {file ? (
              <div className="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-2">
                <FileText size={16} className="text-brand-500 flex-shrink-0" />
                <span className="text-sm text-gray-700 truncate flex-1">{file.name}</span>
                <button
                  onClick={() => setFile(null)}
                  className="text-gray-400 hover:text-red-500"
                >
                  <X size={14} />
                </button>
              </div>
            ) : (
              <>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,image/jpeg,image/png,image/webp"
                  onChange={handleFileSelect}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex items-center gap-2 text-sm text-gray-500 hover:text-brand-500 border border-dashed border-gray-300 rounded-lg px-4 py-3 w-full justify-center transition-colors"
                >
                  <Upload size={16} />
                  {t("createLesson.uploadMaterial")}
                </button>
              </>
            )}
          </div>

          {/* Homework items */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-gray-700">
                {t("student.homework")}
              </label>
              <button
                type="button"
                onClick={addHomework}
                className="flex items-center gap-1 text-xs text-brand-600 hover:text-brand-700"
              >
                <Plus size={14} /> {t("createLesson.addItem")}
              </button>
            </div>
            <div className="space-y-2">
              {homework.map((hw, i) => (
                <div key={i} className="flex gap-2">
                  <div className="flex-1 space-y-1">
                    <input
                      type="text"
                      value={hw.title}
                      onChange={(e) => updateHomework(i, "title", e.target.value)}
                      placeholder={t("createLesson.hwTitlePlaceholder", { n: i + 1 })}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                    />
                    <input
                      type="text"
                      value={hw.description}
                      onChange={(e) => updateHomework(i, "description", e.target.value)}
                      placeholder={t("createLesson.hwDescPlaceholder")}
                      className="w-full border border-gray-100 rounded-lg px-3 py-1.5 text-xs text-gray-500 focus:outline-none focus:ring-2 focus:ring-brand-500"
                    />
                  </div>
                  {homework.length > 1 && (
                    <button
                      onClick={() => removeHomework(i)}
                      className="text-gray-300 hover:text-red-400 mt-2"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Todo items */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-gray-700">
                {t("student.practiceTasks")}
              </label>
              <button
                type="button"
                onClick={addTodo}
                className="flex items-center gap-1 text-xs text-brand-600 hover:text-brand-700"
              >
                <Plus size={14} /> {t("createLesson.addItem")}
              </button>
            </div>
            <div className="space-y-2">
              {todos.map((td, i) => (
                <div key={i} className="flex gap-2">
                  <input
                    type="text"
                    value={td.title}
                    onChange={(e) => updateTodo(i, e.target.value)}
                    placeholder={t("createLesson.todoPlaceholder", { n: i + 1 })}
                    className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                  />
                  {todos.length > 1 && (
                    <button
                      onClick={() => removeTodo(i)}
                      className="text-gray-300 hover:text-red-400"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-100">
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            disabled={!isValid || createMutation.isPending}
            onClick={() => createMutation.mutate()}
          >
            {createMutation.isPending
              ? t("createLesson.creating")
              : t("createLesson.create")}
          </Button>
          {createMutation.isError && (
            <p className="text-xs text-red-500 self-center">
              {createMutation.error.message}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
