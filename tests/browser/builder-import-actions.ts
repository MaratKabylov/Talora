// Browser-only stand-ins for Next server actions. Tests inject their own handlers.
export async function publishTestVersionAction() { throw Error("Unexpected publish"); }
export async function saveBuilderDocumentAction() { throw Error("Unexpected default save"); }
