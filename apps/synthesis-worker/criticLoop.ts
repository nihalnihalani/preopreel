// apps/synthesis-worker/criticLoop.ts
//
// Worker-side re-export of the shared critic primitives. Stages 4 (Mara) and
// 10 (Lyra) import from here; the actual logic lives in @/lib/forge/critic
// so it is testable without spinning up the worker.

export {
  runMaraCritique,
  runLyraCritique,
  type MaraResult,
  type MaraContext,
  type LyraResult,
  type LyraContext,
  type CriticCritique,
  type CriticScore,
  type CriticShot,
  type CriticShotList,
} from "@/lib/forge/critic";
