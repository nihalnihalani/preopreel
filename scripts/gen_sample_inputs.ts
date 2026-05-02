// scripts/gen_sample_inputs.ts
//
// Synthesizes a phantom procedure plan PDF + patient.json under
// data/sample-inputs/ so a user without their own surgical plan
// can exercise POST /api/forge end-to-end.
//
// Usage:
//   npx tsx scripts/gen_sample_inputs.ts
//   curl -X POST http://localhost:3000/api/forge \
//     -F "plan.pdf=@data/sample-inputs/plan.pdf" \
//     -F "patient.json=@data/sample-inputs/patient.json"

import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const OUT = resolve(process.cwd(), "data/sample-inputs");
mkdirSync(OUT, { recursive: true });

const patient = {
  id: "phantom-58f-bmi24",
  age: 58,
  sex: "female" as const,
  bmi: 24.1,
  comorbidities: [
    "type 2 diabetes (well-controlled, A1c 6.4)",
    "mild osteoarthritis (right hip)",
  ],
};

writeFileSync(
  `${OUT}/patient.json`,
  JSON.stringify(patient, null, 2),
  "utf8",
);

const sections = [
  ["§1 Indication", "Right hip osteoarthritis, Tönnis grade 3. Conservative management exhausted. Patient consented for elective total hip arthroplasty, posterior approach."],
  ["§2 Approach", "Posterior (Moore) approach. Patient in lateral decubitus on standard table. Skin incision 12–15 cm centered over greater trochanter."],
  ["§3 Anatomical landmarks", "Greater trochanter, posterior femur, sciatic nerve (protect), short external rotators, joint capsule, acetabular rim, transverse acetabular ligament."],
  ["§4 Steps", [
    "4.1 Incision and superficial dissection through fascia lata.",
    "4.2 Split gluteus maximus along fibers; identify and protect sciatic nerve.",
    "4.3 Detach short external rotators (piriformis, obturator internus, gemelli) from femoral insertion; tag for later repair.",
    "4.4 Posterior capsulotomy in T-shape.",
    "4.5 Hip dislocation posteriorly via flexion–internal-rotation maneuver.",
    "4.6 Femoral neck osteotomy at planned level (templated).",
    "4.7 Acetabular exposure; sequential reaming to bleeding subchondral bone.",
    "4.8 Press-fit acetabular cup; screw fixation if rim contact <70%.",
    "4.9 Liner trial; final liner insertion.",
    "4.10 Femoral canal preparation; broach to templated size.",
    "4.11 Trial reduction; assess length, offset, stability.",
    "4.12 Final stem implantation; ceramic head, final reduction.",
    "4.13 Capsular and short-rotator repair through trans-osseous tunnels.",
    "4.14 Layered closure; subcuticular skin.",
  ].join("\n")],
  ["§5 Implants", "Acetabular shell: titanium porous, size templated. Liner: highly cross-linked polyethylene. Femoral stem: cementless, size 4. Head: 32mm CoCr."],
  ["§6 Expected post-op", "Weight-bearing as tolerated day 1. Posterior precautions 6 weeks (no flexion >90°, no internal rotation past neutral, no adduction past midline). DVT prophylaxis per protocol."],
  ["§7 Anticipated risks", "Dislocation (1–3% posterior approach), infection (<1%), DVT/PE, leg-length discrepancy, sciatic nerve neurapraxia."],
];

(async () => {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  let page = pdf.addPage([612, 792]);
  let y = 750;
  const left = 54;
  const right = 558;
  const lineH = 13;

  const drawWrapped = (text: string, opts: { font: typeof font; size: number; color?: ReturnType<typeof rgb> }) => {
    const words = text.split(/\s+/);
    let line = "";
    for (const w of words) {
      const test = line ? `${line} ${w}` : w;
      if (opts.font.widthOfTextAtSize(test, opts.size) > right - left) {
        page.drawText(line, { x: left, y, size: opts.size, font: opts.font, color: opts.color ?? rgb(0.1, 0.1, 0.1) });
        y -= lineH;
        line = w;
        if (y < 60) {
          page = pdf.addPage([612, 792]);
          y = 750;
        }
      } else {
        line = test;
      }
    }
    if (line) {
      page.drawText(line, { x: left, y, size: opts.size, font: opts.font, color: opts.color ?? rgb(0.1, 0.1, 0.1) });
      y -= lineH;
    }
  };

  page.drawText("Procedure Plan — Total Hip Arthroplasty (Posterior Approach)", {
    x: left, y, size: 14, font: bold, color: rgb(0.05, 0.1, 0.3),
  });
  y -= 22;
  page.drawText(`Patient: ${patient.id}  |  ${patient.age}F  |  BMI ${patient.bmi}  |  SYNTHETIC PHANTOM`, {
    x: left, y, size: 9, font, color: rgb(0.4, 0.4, 0.4),
  });
  y -= 22;

  for (const [heading, body] of sections) {
    if (y < 100) {
      page = pdf.addPage([612, 792]);
      y = 750;
    }
    page.drawText(heading as string, { x: left, y, size: 11, font: bold, color: rgb(0.1, 0.1, 0.4) });
    y -= 16;
    for (const para of (body as string).split("\n")) {
      drawWrapped(para, { font, size: 10 });
      y -= 4;
    }
    y -= 10;
  }

  const bytes = await pdf.save();
  writeFileSync(`${OUT}/plan.pdf`, bytes);

  console.log(`✓ wrote ${OUT}/plan.pdf  (${bytes.length} bytes)`);
  console.log(`✓ wrote ${OUT}/patient.json`);
  console.log("");
  console.log("Run:");
  console.log(`  curl -X POST http://localhost:3000/api/forge \\`);
  console.log(`    -F "plan.pdf=@${OUT}/plan.pdf" \\`);
  console.log(`    -F "patient.json=@${OUT}/patient.json"`);
})();
