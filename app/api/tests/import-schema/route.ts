import { NextResponse } from "next/server";

import schema from "@/docs/08_TALVIA_TEST_IMPORT_SCHEMA_V1.json";

export async function GET() {
  return NextResponse.json(schema, {
    headers: {
      "Content-Disposition": 'attachment; filename="talvia-test-import-schema-v1.json"',
    },
  });
}
