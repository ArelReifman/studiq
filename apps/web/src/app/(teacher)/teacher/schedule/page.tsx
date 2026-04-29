"use client";

import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useT } from "@/i18n";
import { Card } from "@/components/ui/card";
import { Calendar, TimeSlotGrid, type TimeSlot } from "@/components/calendar/calendar";
import { Plus } from "lucide-react";

interface Slot extends TimeSlot {
  date: string;
}

export default function TeacherSchedulePage() {
  const t = useT();
  const qc = useQueryClient();

  const [selectedDate, setSelectedDate] = useState<string | undefined>(() => {
    return new Date().toISOString().split("T")[0]!;
  });
  const [startTime, setStartTime] = useState("14:00");
  const [endTime, setEndTime] = useState("15:00");
  const [error, setError] = useState<string | null>(null);

  const { data: slots = [], isLoading } = useQuery<Slot[]>({
    queryKey: ["my-availability"],
    queryFn: () => api.get("/availability"),
  });

  const activeDates = useMemo(() => new Set(slots.map((s) => s.date)), [slots]);

  const slotsForDate = useMemo(
    () => (selectedDate ? slots.filter((s) => s.date === selectedDate) : []),
    [slots, selectedDate]
  );

  const addMutation = useMutation({
    mutationFn: () =>
      api.post<Slot>("/availability", {
        date: selectedDate,
        start_time: startTime,
        end_time: endTime,
      }),
    onMutate: () => setError(null),
    onError: (e: Error) => setError(e.message),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["my-availability"] });
    },
  });

  const removeMutation = useMutation({
    mutationFn: (slotId: string) => api.delete(`/availability/${slotId}`),
    onError: (e: Error) => setError(e.message),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["my-availability"] });
    },
  });

  if (isLoading) {
    return <p className="text-gray-500">{t("common.loading")}</p>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-800">
          {t("teacher.schedule")}
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          {t("teacher.scheduleHint")}
        </p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Calendar */}
        <Card>
          <Calendar
            activeDates={activeDates}
            selectedDate={selectedDate}
            onSelectDate={setSelectedDate}
          />
          <p className="text-xs text-gray-400 text-center mt-3">
            {t("teacher.activeDatesHint")}
          </p>
        </Card>

        {/* Manage slots for selected date */}
        <Card>
          {selectedDate ? (
            <>
              <TimeSlotGrid
                date={selectedDate}
                slots={slotsForDate}
                onSelectSlot={() => {}}
                onRemoveSlot={(s) => removeMutation.mutate(s.id)}
                emptyLabel={t("teacher.noSlotsForDate")}
              />

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (startTime >= endTime) {
                    setError(t("teacher.endAfterStart"));
                    return;
                  }
                  addMutation.mutate();
                }}
                className="mt-4 pt-4 border-t border-gray-100"
              >
                <p className="text-sm font-medium text-gray-700 mb-2">
                  {t("teacher.addSlotForDate")}
                </p>
                <div className="flex items-end gap-2">
                  <div className="flex-1">
                    <label className="block text-xs text-gray-500 mb-1">
                      {t("teacher.startTime")}
                    </label>
                    <input
                      type="time"
                      value={startTime}
                      onChange={(e) => setStartTime(e.target.value)}
                      className="w-full border border-gray-200 rounded-lg px-2 py-2 text-sm"
                    />
                  </div>
                  <div className="flex-1">
                    <label className="block text-xs text-gray-500 mb-1">
                      {t("teacher.endTime")}
                    </label>
                    <input
                      type="time"
                      value={endTime}
                      onChange={(e) => setEndTime(e.target.value)}
                      className="w-full border border-gray-200 rounded-lg px-2 py-2 text-sm"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={addMutation.isPending}
                    className="flex items-center gap-1 bg-brand-600 text-white px-3 py-2 rounded-lg text-sm font-medium hover:bg-brand-700 disabled:opacity-50"
                  >
                    <Plus size={14} />
                    {t("teacher.add")}
                  </button>
                </div>
              </form>
            </>
          ) : (
            <p className="text-sm text-gray-400 text-center py-12">
              {t("teacher.pickDateFirst")}
            </p>
          )}
        </Card>
      </div>
    </div>
  );
}
