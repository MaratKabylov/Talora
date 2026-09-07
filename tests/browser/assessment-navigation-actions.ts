// Browser fixture only: one-question section navigation must never call a legacy action.
export function completeEmptySessionAction() { throw Error("Unexpected legacy action"); }
export const saveCandidateSectionAction = completeEmptySessionAction;
export const completeEmptyEmployeeAssessmentSessionAction = completeEmptySessionAction;
export const saveEmployeeAssessmentSectionAction = completeEmptySessionAction;
