// Browser fixture only. Legacy actions are allowed solely for terminal section submission.
export function completeEmptySessionAction() { throw Error("Unexpected legacy action"); }
export const completeEmptyEmployeeAssessmentSessionAction = completeEmptySessionAction;
let sectionAction: ((data: FormData) => void) | null = null;
export function setSectionActionHandler(handler: typeof sectionAction) { sectionAction = handler; }
export async function saveCandidateSectionAction(data: FormData) {
  if (!sectionAction) throw Error("Unexpected legacy section action");
  sectionAction(data);
}
export const saveEmployeeAssessmentSectionAction = saveCandidateSectionAction;
