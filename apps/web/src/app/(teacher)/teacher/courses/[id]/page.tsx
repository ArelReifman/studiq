"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft, Plus, Trash2, Share2, ChevronUp, ChevronDown,
  Pencil, Check, X, CalendarDays,
} from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n";
import type { CourseWithTopics, CourseTopic } from "@studiq/types";
import { ResourcesSection } from "@/components/learning-resources/resources-section";

// ── helper ────────────────────────────────────────────────────────────────────
function buildTree(flat: CourseTopic[]) {
  const parents = flat
    .filter((t) => !t.parent_topic_id)
    .sort((a, b) => a.order_index - b.order_index);
  return parents.map((p) => ({
    ...p,
    children: flat
      .filter((t) => t.parent_topic_id === p.id)
      .sort((a, b) => a.order_index - b.order_index),
  }));
}

type TopicTree = CourseTopic & { children: CourseTopic[] };

export default function CourseDetailPage() {
  const t = useT();
  const { id: courseId } = useParams<{ id: string }>();
  const qc = useQueryClient();

  const { data: course, isLoading } = useQuery<CourseWithTopics>({
    queryKey: ["courses", courseId],
    queryFn: () => api.get(`/courses/${courseId}`),
    enabled: !!courseId,
  });

  const tree: TopicTree[] = course ? buildTree(course.topics) : [];

  // Tabs: topic tree (the default course-editing UI) and learning resources.
  const [activeTab, setActiveTab] = useState<"topics" | "resources">("topics");

  // Flat topic list with depth for the resources upload modal's scope dropdown.
  const flatTopicsForScope = tree.flatMap((p) => [
    { id: p.id, name: p.name, depth: 0 },
    ...p.children.map((c) => ({ id: c.id, name: c.name, depth: 1 })),
  ]);

  // ── course header edit ────────────────────────────────────────────────────
  const [editingCourse, setEditingCourse] = useState(false);
  const [courseName, setCourseName] = useState("");
  const [courseDesc, setCourseDesc] = useState("");
  // Date picker emits "" for empty, otherwise YYYY-MM-DD. We send null to
  // the API to clear the column.
  const [courseExamDate, setCourseExamDate] = useState("");

  const saveCourse = useMutation({
    mutationFn: () =>
      api.patch(`/courses/${courseId}`, {
        name: courseName.trim(),
        description: courseDesc.trim() || undefined,
        exam_date: courseExamDate || null,
      }),
    onSuccess: () => {
      setEditingCourse(false);
      qc.invalidateQueries({ queryKey: ["courses", courseId] });
      qc.invalidateQueries({ queryKey: ["courses"] });
      // The student-facing learning map reads exam_date — keep it in sync.
      qc.invalidateQueries({ queryKey: ["learning-map"] });
    },
  });

  // ── patch / delete topics ─────────────────────────────────────────────────
  const patchTopic = useMutation({
    mutationFn: (args: { id: string; body: Record<string, unknown> }) =>
      api.patch(`/courses/${courseId}/topics/${args.id}`, args.body),
    onSuccess: () => {
      // The course tree refreshes for sure. Lessons + learning maps
      // also need to refresh because renaming a topic rewrites lesson
      // titles on the server, and reordering / locking changes how the
      // map renders.
      qc.invalidateQueries({ queryKey: ["courses", courseId] });
      qc.invalidateQueries({ queryKey: ["lessons"] });
      qc.invalidateQueries({ queryKey: ["learning-map"] });
    },
  });

  // ── swap two topics' order_index ──────────────────────────────────────────
  // moveParent / moveChild previously called patchTopic.mutate() twice in a
  // row. TanStack Query only fires onSuccess for the *last* mutate() call on a
  // given useMutation instance — if the second PATCH returned before the first,
  // the cache was invalidated with only one of the two updates applied, leaving
  // the UI stuck in the wrong order.
  //
  // Using a single mutation that wraps both PATCHes in Promise.all guarantees:
  //   • Both requests are sent in parallel.
  //   • onSuccess fires exactly once after *both* have completed.
  //   • Cache is invalidated only when the full swap is consistent.
  //
  // IMPORTANT — position-based assignment, not stored-value swap:
  // Existing topics in the DB may all have order_index=0 (the column default).
  // Swapping stored values 0↔0 is a no-op; nothing would move.
  // Instead, moveParent/moveChild pass the *visual positions* (idx, target) as
  // the new order_index values. This assigns fresh, distinct values that
  // correctly separate the two topics and self-heals legacy data over time.
  const swapTopics = useMutation({
    mutationFn: (args: {
      a: { id: string; newOrderIndex: number };
      b: { id: string; newOrderIndex: number };
    }) =>
      Promise.all([
        api.patch(`/courses/${courseId}/topics/${args.a.id}`, {
          order_index: args.a.newOrderIndex,
        }),
        api.patch(`/courses/${courseId}/topics/${args.b.id}`, {
          order_index: args.b.newOrderIndex,
        }),
      ]),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["courses", courseId] });
      qc.invalidateQueries({ queryKey: ["lessons"] });
      qc.invalidateQueries({ queryKey: ["learning-map"] });
    },
  });

  const deleteTopic = useMutation({
    mutationFn: (topicId: string) =>
      api.delete(`/courses/${courseId}/topics/${topicId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["courses", courseId] }),
  });

  // ── inline topic edit ─────────────────────────────────────────────────────
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  function startEdit(topic: CourseTopic) {
    setEditingId(topic.id);
    setEditName(topic.name);
  }
  function cancelEdit() { setEditingId(null); setEditName(""); }
  function saveEdit(topic: CourseTopic) {
    patchTopic.mutate(
      { id: topic.id, body: { name: editName.trim() } },
      { onSuccess: cancelEdit }
    );
  }

  // ── add parent topic ──────────────────────────────────────────────────────
  const [newParent, setNewParent] = useState("");
  const addParent = useMutation({
    mutationFn: () =>
      api.post(`/courses/${courseId}/topics`, {
        name: newParent.trim(),
        order_index: tree.length,
        is_shared: false,
      }),
    onSuccess: () => {
      setNewParent("");
      qc.invalidateQueries({ queryKey: ["courses", courseId] });
    },
  });

  // ── add child topic ───────────────────────────────────────────────────────
  const [newChild, setNewChild] = useState<Record<string, string>>({});  // parentId → text

  function addChildFor(parentId: string, childCount: number) {
    const name = newChild[parentId]?.trim();
    if (!name) return;
    api
      .post(`/courses/${courseId}/topics`, {
        name,
        parent_topic_id: parentId,
        order_index: childCount,
        is_shared: false,
      })
      .then(() => {
        setNewChild((prev) => ({ ...prev, [parentId]: "" }));
        qc.invalidateQueries({ queryKey: ["courses", courseId] });
      });
  }

  // ── reorder parents ───────────────────────────────────────────────────────
  function moveParent(idx: number, dir: -1 | 1) {
    const target = idx + dir;
    if (target < 0 || target >= tree.length) return;
    // Pass visual positions (idx, target) as the new order_index values so
    // that existing topics with duplicate order_index=0 still move correctly.
    swapTopics.mutate({
      a: { id: tree[idx]!.id,     newOrderIndex: target },
      b: { id: tree[target]!.id,  newOrderIndex: idx },
    });
  }

  // ── reorder children inside a single parent ──────────────────────────────
  function moveChild(parent: TopicTree, idx: number, dir: -1 | 1) {
    const target = idx + dir;
    if (target < 0 || target >= parent.children.length) return;
    swapTopics.mutate({
      a: { id: parent.children[idx]!.id,    newOrderIndex: target },
      b: { id: parent.children[target]!.id, newOrderIndex: idx },
    });
  }

  if (isLoading) return <div className="text-gray-400">{t("common.loading")}</div>;
  if (!course)   return <div className="text-gray-500">{t("courses.notFound")}</div>;

  return (
    <div>
      <Link
        href="/teacher/courses"
        className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-brand-600 mb-4"
      >
        <ArrowLeft size={14} /> {t("courses.backToList")}
      </Link>

      {/* ── course header ── */}
      <div className="mb-6">
        {editingCourse ? (
          <div className="space-y-2">
            <input
              autoFocus
              type="text"
              value={courseName}
              onChange={(e) => setCourseName(e.target.value)}
              className="w-full text-2xl font-bold border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
            <textarea
              value={courseDesc}
              onChange={(e) => setCourseDesc(e.target.value)}
              rows={2}
              placeholder={t("courses.descriptionPlaceholder")}
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
            <div>
              <label className="flex items-center gap-1.5 text-xs font-medium text-gray-600 mb-1">
                <CalendarDays size={13} />
                {t("courses.examDateLabel")}
              </label>
              <input
                type="date"
                value={courseExamDate}
                onChange={(e) => setCourseExamDate(e.target.value)}
                className="w-full sm:w-64 border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
              <p className="text-xs text-gray-400 mt-1">
                {t("courses.examDateHint")}
              </p>
            </div>
            <div className="flex gap-2">
              <Button size="sm" disabled={!courseName.trim() || saveCourse.isPending} onClick={() => saveCourse.mutate()}>
                <Check size={14} className="me-1" /> {t("common.save")}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditingCourse(false)}>
                {t("common.cancel")}
              </Button>
            </div>
          </div>
        ) : (
          <div className="group flex items-start gap-2">
            <div className="flex-1">
              <h1 className="text-2xl font-bold">{course.name}</h1>
              {course.description && (
                <p className="text-sm text-gray-500 mt-1">{course.description}</p>
              )}
              <CourseExamBadge examDateIso={course.exam_date} />
            </div>
            <button
              onClick={() => {
                setCourseName(course.name);
                setCourseDesc(course.description ?? "");
                // Convert "2026-08-05T00:00:00.000Z" → "2026-08-05" for the
                // <input type="date">. Empty when not set.
                setCourseExamDate(
                  course.exam_date ? course.exam_date.slice(0, 10) : ""
                );
                setEditingCourse(true);
              }}
              className="text-gray-300 hover:text-brand-500 opacity-0 group-hover:opacity-100 transition-opacity mt-1"
            >
              <Pencil size={16} />
            </button>
          </div>
        )}
      </div>

      {/* ── tabs ── */}
      <div className="flex items-center gap-1 mb-3 border-b border-gray-100">
        <button
          type="button"
          onClick={() => setActiveTab("topics")}
          className={`px-3 py-2 text-sm font-semibold border-b-2 -mb-px transition-colors ${
            activeTab === "topics"
              ? "border-brand-500 text-brand-700"
              : "border-transparent text-gray-500 hover:text-gray-700"
          }`}
        >
          {t("courses.pageTitle")}
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("resources")}
          className={`px-3 py-2 text-sm font-semibold border-b-2 -mb-px transition-colors ${
            activeTab === "resources"
              ? "border-brand-500 text-brand-700"
              : "border-transparent text-gray-500 hover:text-gray-700"
          }`}
        >
          {t("resources.tabTitle")}
        </button>
      </div>

      {activeTab === "resources" && (
        <div className="bg-white border border-gray-100 rounded-xl p-5">
          <ResourcesSection
            role="teacher"
            courseId={courseId}
            topics={flatTopicsForScope}
            variant="tab"
          />
        </div>
      )}

      {activeTab === "topics" && (
      <>
      {/* ── topic tree ── */}
      <div className="bg-white border border-gray-100 rounded-xl p-5 space-y-3">

        {/* add parent topic */}
        <div className="flex items-center gap-2 pb-4 border-b border-gray-100">
          <input
            type="text"
            value={newParent}
            onChange={(e) => setNewParent(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && newParent.trim()) addParent.mutate(); }}
            placeholder={t("courses.addParentPlaceholder")}
            className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
          <Button size="sm" disabled={!newParent.trim() || addParent.isPending} onClick={() => addParent.mutate()}>
            <Plus size={14} />
          </Button>
        </div>

        {tree.length === 0 && (
          <p className="text-sm text-gray-400 text-center py-6">{t("courses.noTopics")}</p>
        )}

        {tree.map((parent, pi) => (
          <div key={parent.id} className="border border-gray-100 rounded-lg overflow-hidden">

            {/* Parent row */}
            <div className="flex items-center gap-2 px-3 py-2.5 bg-gray-50 group">
              {/* reorder */}
              <div className="flex flex-col">
                <button onClick={() => moveParent(pi, -1)} disabled={pi === 0} className="text-gray-300 hover:text-brand-500 disabled:opacity-20">
                  <ChevronUp size={13} />
                </button>
                <button onClick={() => moveParent(pi, 1)} disabled={pi === tree.length - 1} className="text-gray-300 hover:text-brand-500 disabled:opacity-20">
                  <ChevronDown size={13} />
                </button>
              </div>

              {editingId === parent.id ? (
                <div className="flex items-center gap-2 flex-1">
                  <input
                    autoFocus
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="flex-1 border border-gray-200 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                  />
                  <button onClick={() => saveEdit(parent)} className="text-brand-600 hover:text-brand-700"><Check size={14} /></button>
                  <button onClick={cancelEdit} className="text-gray-400 hover:text-gray-600"><X size={14} /></button>
                </div>
              ) : (
                <>
                  <span className="flex-1 text-sm font-semibold text-gray-800">{parent.name}</span>
                  <span className="text-xs text-gray-400">{t("courses.subTopicsCount", { count: parent.children.length })}</span>

                  <button
                    onClick={() => patchTopic.mutate({ id: parent.id, body: { is_shared: !parent.is_shared } })}
                    className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity ${
                      parent.is_shared ? "bg-brand-50 text-brand-600" : "text-gray-400 hover:text-gray-600"
                    }`}
                    title={t("courses.toggleSharedHint")}
                  >
                    <Share2 size={11} />
                    {parent.is_shared ? t("courses.shared") : t("courses.unique")}
                  </button>

                  <button onClick={() => startEdit(parent)} className="text-gray-300 hover:text-brand-500 opacity-0 group-hover:opacity-100">
                    <Pencil size={13} />
                  </button>
                  <button
                    onClick={() => { if (confirm(t("courses.deleteTopicConfirm", { name: parent.name }))) deleteTopic.mutate(parent.id); }}
                    className="text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100"
                  >
                    <Trash2 size={13} />
                  </button>
                </>
              )}
            </div>

            {/* Children */}
            <div className="divide-y divide-gray-50">
              {parent.children.map((child, ci) => (
                <div key={child.id} className="flex items-center gap-2 px-4 py-2 group bg-white hover:bg-gray-50">
                  {/* reorder — same chevron pattern as parents, just nested */}
                  <div className="flex flex-col flex-shrink-0">
                    <button
                      onClick={() => moveChild(parent, ci, -1)}
                      disabled={ci === 0}
                      className="text-gray-300 hover:text-brand-500 disabled:opacity-20"
                      aria-label={t("courses.moveUp")}
                      title={t("courses.moveUp")}
                    >
                      <ChevronUp size={12} />
                    </button>
                    <button
                      onClick={() => moveChild(parent, ci, 1)}
                      disabled={ci === parent.children.length - 1}
                      className="text-gray-300 hover:text-brand-500 disabled:opacity-20"
                      aria-label={t("courses.moveDown")}
                      title={t("courses.moveDown")}
                    >
                      <ChevronDown size={12} />
                    </button>
                  </div>
                  <span className="w-4 text-gray-200 text-xs flex-shrink-0">└</span>

                  {editingId === child.id ? (
                    <div className="flex items-center gap-2 flex-1">
                      <input
                        autoFocus
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className="flex-1 border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-brand-500"
                      />
                      <button onClick={() => saveEdit(child)} className="text-brand-600"><Check size={13} /></button>
                      <button onClick={cancelEdit} className="text-gray-400"><X size={13} /></button>
                    </div>
                  ) : (
                    <>
                      <span className="flex-1 text-sm text-gray-700">{child.name}</span>
                      <button
                        onClick={() => patchTopic.mutate({ id: child.id, body: { is_shared: !child.is_shared } })}
                        className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity ${
                          child.is_shared ? "bg-brand-50 text-brand-600" : "text-gray-400 hover:text-gray-600"
                        }`}
                      >
                        <Share2 size={11} />
                        {child.is_shared ? t("courses.shared") : t("courses.unique")}
                      </button>
                      <button onClick={() => startEdit(child)} className="text-gray-300 hover:text-brand-500 opacity-0 group-hover:opacity-100">
                        <Pencil size={13} />
                      </button>
                      <button
                        onClick={() => { if (confirm(t("courses.deleteTopicConfirm", { name: child.name }))) deleteTopic.mutate(child.id); }}
                        className="text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100"
                      >
                        <Trash2 size={13} />
                      </button>
                    </>
                  )}
                </div>
              ))}

              {/* Add child row */}
              <div className="flex items-center gap-2 px-4 py-2 bg-white">
                <span className="w-4 text-gray-200 text-xs flex-shrink-0">+</span>
                <input
                  type="text"
                  value={newChild[parent.id] ?? ""}
                  onChange={(e) => setNewChild((prev) => ({ ...prev, [parent.id]: e.target.value }))}
                  onKeyDown={(e) => { if (e.key === "Enter") addChildFor(parent.id, parent.children.length); }}
                  placeholder={t("courses.addChildPlaceholder")}
                  className="flex-1 text-xs text-gray-500 border-0 border-b border-gray-100 py-1 focus:outline-none focus:border-brand-400 bg-transparent"
                />
                {newChild[parent.id]?.trim() && (
                  <button
                    onClick={() => addChildFor(parent.id, parent.children.length)}
                    className="text-brand-500 hover:text-brand-700"
                  >
                    <Plus size={13} />
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}

        <p className="text-xs text-gray-400 pt-1">{t("courses.sharedHint")}</p>
      </div>
      </>
      )}
    </div>
  );
}

/** Inline pill that surfaces the course exam date + days-until in the
 *  course header. Hidden when no exam date has been set. */
function CourseExamBadge({ examDateIso }: { examDateIso: string | null }) {
  const t = useT();
  if (!examDateIso) return null;
  const exam = new Date(examDateIso);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.ceil(
    (exam.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
  );
  const formatted = exam.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  // Past exam → muted. Future → brand. Today → amber.
  const tone =
    days < 0
      ? "border-gray-200 text-gray-400 bg-gray-50"
      : days <= 14
        ? "border-amber-200 text-amber-700 bg-amber-50"
        : "border-brand-200 text-brand-700 bg-brand-50";
  return (
    <span
      className={`inline-flex items-center gap-1.5 mt-2 text-xs font-medium border rounded-full px-2.5 py-1 ${tone}`}
    >
      <CalendarDays size={12} />
      {t("courses.examOn", { date: formatted })}
      <span className="opacity-70">·</span>
      <span className="tabular-nums">
        {days < 0
          ? t("courses.examPassed")
          : days === 0
            ? t("courses.examToday")
            : t("courses.daysAway", { count: days })}
      </span>
    </span>
  );
}
