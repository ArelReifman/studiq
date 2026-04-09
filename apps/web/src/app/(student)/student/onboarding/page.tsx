"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

export default function OnboardingPage() {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const { data: topics = [] } = useQuery<string[]>({
    queryKey: ["onboarding-topics"],
    queryFn: () => api.get("/onboarding/topics"),
  });

  const { mutate, isPending, isError, error } = useMutation({
    mutationFn: (selectedTopics: string[]) =>
      api.post("/onboarding/complete", { topics: selectedTopics }),
    onSuccess: () => router.push("/student/dashboard"),
  });

  function toggle(topic: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(topic)) next.delete(topic);
      else next.add(topic);
      return next;
    });
  }

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-2">Welcome to Studiq!</h1>
      <p className="text-gray-500 mb-8">
        Choose the topics you want to study. Your AI tutor will use these to
        create your first personalized lesson.
      </p>

      <div className="flex flex-wrap gap-3 mb-8">
        {topics.map((topic) => (
          <button
            key={topic}
            onClick={() => toggle(topic)}
            className={cn(
              "px-4 py-2 rounded-full border text-sm font-medium transition-colors",
              selected.has(topic)
                ? "bg-brand-600 text-white border-brand-600"
                : "bg-white text-gray-700 border-gray-200 hover:border-brand-400"
            )}
          >
            {topic}
          </button>
        ))}
      </div>

      {isError && (
        <p className="text-red-500 text-sm mb-4">
          {(error as Error).message}
        </p>
      )}

      <button
        onClick={() => mutate([...selected])}
        disabled={selected.size === 0 || isPending}
        className="bg-brand-600 text-white px-6 py-2.5 rounded-lg font-medium hover:bg-brand-700 disabled:opacity-50 transition-colors"
      >
        {isPending ? "Preparing your first lesson..." : `Start with ${selected.size} topic${selected.size !== 1 ? "s" : ""}`}
      </button>
    </div>
  );
}
