import { createCandidateImportTemplate } from "@/lib/candidates/import-workbook";

export const runtime = "nodejs";

export async function GET() {
  const template = await createCandidateImportTemplate();

  return new Response(new Uint8Array(template), {
    headers: {
      "Cache-Control": "private, max-age=3600",
      "Content-Disposition": 'attachment; filename="talvia-candidate-import-template.xlsx"',
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    },
  });
}
