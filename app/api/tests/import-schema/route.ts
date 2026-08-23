import { NextResponse } from "next/server";

import schemaV1 from "@/docs/08_TALVIA_TEST_IMPORT_SCHEMA_V1.json";
import schemaV2 from "@/docs/13_TALVIA_TEST_IMPORT_SCHEMA_V2.json";

export async function GET(request: Request) {
  const version = new URL(request.url).searchParams.get("version");
  const useV2 = version === "v2";
  return NextResponse.json(useV2 ? schemaV2 : schemaV1, {
    headers: {
      "Content-Disposition": `attachment; filename="talvia-test-import-schema-${useV2 ? "v2" : "v1"}.json"`,
    },
  });
}
