"use client";

// PreOpUpload — drag-and-drop ingest panel.
//
// Per plan 04 §A.2.1 (post-2026-05-02 Option-A demo-CTA removal):
//   - drag-and-drop for plan.pdf (≤10MB, application/pdf)
//   - JSON paste / file for patient.json validated against the Zod
//     `Patient` schema imported from src/lib/forge/anatomyGraph.ts
//   - on submit, POSTs multipart to /api/forge and resolves to a
//     forge_run_id; consumer is responsible for routing.
//
// The Synthetic-Phantom badge previously rendered in this component was
// removed alongside the demo CTAs. The "Synthetic Phantom · Demo Case"
// label still appears in the rendered MP4 via IntroCard for any run that
// uses the demo fixture; that's the on-camera honesty surface (Invariant
// 4). Internal smoke tests still hit ?fixture=hip-replacement.

import { useCallback, useRef, useState } from "react";
import { Upload, FileText, FileJson, X } from "lucide-react";
import { Patient } from "@/lib/forge/anatomyGraph";
import { useStartForgeRun } from "@/lib/api/client";

interface PreOpUploadProps {
  onStarted: (forgeRunId: string) => void;
}

export function PreOpUpload({ onStarted }: PreOpUploadProps) {
  const [planFile, setPlanFile] = useState<File | null>(null);
  const [patientFile, setPatientFile] = useState<File | null>(null);
  const [patientJsonText, setPatientJsonText] = useState<string>("");
  const [patientError, setPatientError] = useState<string | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const planInputRef = useRef<HTMLInputElement>(null);
  const patientInputRef = useRef<HTMLInputElement>(null);

  const startMutation = useStartForgeRun();

  const validatePatientJson = useCallback((text: string): boolean => {
    setPatientError(null);
    if (!text.trim()) return false;
    try {
      const obj: unknown = JSON.parse(text);
      const parsed = Patient.safeParse(obj);
      if (!parsed.success) {
        setPatientError(
          `Schema error: ${parsed.error.issues
            .slice(0, 2)
            .map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`)
            .join("; ")}`,
        );
        return false;
      }
      return true;
    } catch (err) {
      setPatientError(
        `Invalid JSON: ${err instanceof Error ? err.message : "parse failed"}`,
      );
      return false;
    }
  }, []);

  const onPickPlan = useCallback((f: File | null) => {
    setPlanError(null);
    if (!f) {
      setPlanFile(null);
      return;
    }
    if (f.type !== "application/pdf" && !f.name.endsWith(".pdf")) {
      setPlanError("Plan must be a PDF.");
      return;
    }
    if (f.size > 10 * 1024 * 1024) {
      setPlanError("Plan exceeds 10 MB.");
      return;
    }
    setPlanFile(f);
  }, []);

  const onPickPatient = useCallback(
    async (f: File | null) => {
      if (!f) {
        setPatientFile(null);
        setPatientJsonText("");
        setPatientError(null);
        return;
      }
      if (!f.name.endsWith(".json") && f.type !== "application/json") {
        setPatientError("Patient card must be JSON.");
        return;
      }
      const text = await f.text();
      setPatientJsonText(text);
      if (validatePatientJson(text)) {
        setPatientFile(f);
      }
    },
    [validatePatientJson],
  );

  const onDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files?.[0];
      if (!file) return;
      if (file.type === "application/pdf" || file.name.endsWith(".pdf")) {
        onPickPlan(file);
      } else if (
        file.type === "application/json" ||
        file.name.endsWith(".json")
      ) {
        void onPickPatient(file);
      }
    },
    [onPickPlan, onPickPatient],
  );

  const onSubmit = useCallback(async () => {
    if (!planFile) {
      setPlanError("Add a procedure-plan PDF.");
      return;
    }
    if (!patientJsonText.trim()) {
      setPatientError("Paste or attach a patient card.");
      return;
    }
    if (!validatePatientJson(patientJsonText)) return;

    const fd = new FormData();
    fd.append("plan.pdf", planFile);
    fd.append(
      "patient.json",
      new Blob([patientJsonText], { type: "application/json" }),
      "patient.json",
    );

    try {
      const { forgeRunId } = await startMutation.mutateAsync({ body: fd });
      onStarted(forgeRunId);
    } catch (err) {
      // Visible inline error
      setPlanError(
        `Submit failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }, [
    planFile,
    patientJsonText,
    validatePatientJson,
    startMutation,
    onStarted,
  ]);

  const submitting = startMutation.isPending;

  return (
    <section
      className="surface-card flex h-full flex-col gap-4 rounded-xl p-5"
      aria-label="Procedure plan + patient card upload"
    >
      <header>
        <h2 className="text-sm font-semibold uppercase tracking-wider text-clinical-300">
          Step 1 · Inputs
        </h2>
        <p className="mt-1 text-base font-medium text-clinical-100">
          Drop the procedure plan + patient card.
        </p>
      </header>

      {/* ─── Drop zone ────────────────────────────────────────── */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className={[
          "relative flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-8 transition-all",
          dragOver
            ? "border-critic-lyra bg-critic-lyra/10"
            : "border-ink-700/70 bg-ink-900/30 hover:border-clinical-300/40",
        ].join(" ")}
        aria-label="Drag and drop zone"
      >
        <Upload className="h-5 w-5 text-clinical-300" aria-hidden="true" />
        <p className="text-sm text-clinical-100">
          Drop <span className="font-mono">plan.pdf</span> or{" "}
          <span className="font-mono">patient.json</span>
        </p>
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            onClick={() => planInputRef.current?.click()}
            className="rounded border border-ink-700 bg-ink-900/80 px-3 py-1 text-xs text-clinical-100 hover:border-critic-lyra/40"
          >
            Choose plan
          </button>
          <button
            type="button"
            onClick={() => patientInputRef.current?.click()}
            className="rounded border border-ink-700 bg-ink-900/80 px-3 py-1 text-xs text-clinical-100 hover:border-critic-lyra/40"
          >
            Choose patient
          </button>
        </div>
        <input
          ref={planInputRef}
          type="file"
          accept="application/pdf,.pdf"
          className="hidden"
          onChange={(e) => onPickPlan(e.target.files?.[0] ?? null)}
        />
        <input
          ref={patientInputRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => void onPickPatient(e.target.files?.[0] ?? null)}
        />
      </div>

      {/* ─── File state ─────────────────────────────────────── */}
      <div className="flex flex-col gap-2">
        {planFile ? (
          <FilePill
            icon={<FileText className="h-3.5 w-3.5" />}
            name={planFile.name}
            sizeLabel={prettyBytes(planFile.size)}
            onRemove={() => setPlanFile(null)}
          />
        ) : (
          <EmptyPill label="plan.pdf — required" />
        )}

        {patientFile ? (
          <FilePill
            icon={<FileJson className="h-3.5 w-3.5" />}
            name={patientFile.name}
            sizeLabel={prettyBytes(patientFile.size)}
            onRemove={() => {
              setPatientFile(null);
              setPatientJsonText("");
            }}
          />
        ) : (
          <details className="rounded border border-ink-700/60 bg-ink-900/40 p-2 text-xs">
            <summary className="cursor-pointer text-clinical-300">
              Or paste patient.json
            </summary>
            <textarea
              value={patientJsonText}
              onChange={(e) => {
                setPatientJsonText(e.target.value);
                validatePatientJson(e.target.value);
              }}
              placeholder='{"id":"phantom-001","age":65,"sex":"male","bmi":28.1,"comorbidities":[]}'
              rows={5}
              className="mt-2 w-full resize-none rounded border border-ink-700 bg-ink-950/60 p-2 font-mono text-xs text-clinical-100 placeholder:text-clinical-300/40 focus:border-critic-lyra focus:outline-none"
            />
          </details>
        )}
      </div>

      {/* ─── Errors ─────────────────────────────────────────── */}
      {(planError || patientError) && (
        <div
          role="alert"
          aria-live="polite"
          className="rounded border border-critic-mara/40 bg-critic-mara/10 px-3 py-2 text-xs text-critic-mara"
        >
          {planError && <div>{planError}</div>}
          {patientError && <div>{patientError}</div>}
        </div>
      )}

      {/* ─── Submit ─────────────────────────────────────────── */}
      <div className="mt-auto flex flex-col gap-2 pt-2">
        <button
          type="button"
          onClick={onSubmit}
          disabled={submitting || !planFile || !patientJsonText.trim()}
          className="rounded-lg bg-clinical-100 px-4 py-2 text-sm font-semibold text-ink-950 transition-all hover:bg-white disabled:cursor-not-allowed disabled:bg-ink-700 disabled:text-clinical-300"
        >
          {submitting ? "Starting forge run…" : "Synthesize explainer"}
        </button>
        <p className="text-[10px] text-clinical-300">
          Goes through the 12-stage worker (Atlas → Mara → Lyra → Remotion).
          ~78s end-to-end in DEMO_MODE=replay.
        </p>
      </div>
    </section>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────

function FilePill({
  icon,
  name,
  sizeLabel,
  onRemove,
}: {
  icon: React.ReactNode;
  name: string;
  sizeLabel: string;
  onRemove: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2 rounded border border-critic-lyra/40 bg-critic-lyra/5 px-3 py-2 text-xs">
      <span className="flex items-center gap-2 truncate text-clinical-100">
        <span className="text-critic-lyra">{icon}</span>
        <span className="truncate font-mono">{name}</span>
        <span className="text-clinical-300">· {sizeLabel}</span>
      </span>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${name}`}
        className="rounded p-1 text-clinical-300 hover:text-critic-mara"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}

function EmptyPill({ label }: { label: string }) {
  return (
    <div className="rounded border border-ink-700/60 bg-ink-900/40 px-3 py-2 text-xs text-clinical-300">
      {label}
    </div>
  );
}

function prettyBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
