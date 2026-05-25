# MVP Backlog — HR Assessment SaaS

## Milestone 0 — Project setup

- [ ] Create Next.js App Router project.
- [ ] Add TypeScript strict mode.
- [ ] Add Tailwind.
- [ ] Add shadcn/ui.
- [ ] Add Supabase client/server helpers.
- [ ] Add `.env.example`.
- [ ] Add base layout and dashboard shell.

## Milestone 1 — Database and RLS

- [ ] Apply schema from `02_DATABASE_MODEL.sql`.
- [ ] Generate Supabase types.
- [ ] Implement profile creation trigger or onboarding flow.
- [ ] Verify RLS for companies, jobs, applications.
- [ ] Add secure server actions for candidate token access.

## Milestone 2 — Auth and company onboarding

- [ ] Login page.
- [ ] Sign out.
- [ ] First company creation.
- [ ] Company members page.
- [ ] Active company context.

## Milestone 3 — Jobs

- [ ] Jobs list.
- [ ] Create job.
- [ ] Edit job.
- [ ] Job detail page.
- [ ] Configure competency weights for job.

## Milestone 4 — Tests library

- [ ] Test templates list.
- [ ] System tests read-only.
- [ ] Company tests CRUD.
- [ ] Test versions.
- [ ] Publish version.
- [ ] Prevent editing published versions.

## Milestone 5 — Test builder

- [ ] Sections CRUD.
- [ ] Questions CRUD.
- [ ] Answer options CRUD.
- [ ] Competency mapping.
- [ ] Preview test.

## Milestone 6 — Candidates and invitations

- [ ] Candidate list.
- [ ] Add candidate to job.
- [ ] Generate invitation token.
- [ ] Copy invitation link.
- [ ] Invitation status tracking.

## Milestone 7 — Candidate flow

- [ ] Public start page by token.
- [ ] Consent checkbox.
- [ ] Candidate profile form.
- [ ] Create application if needed.
- [ ] Start test sessions.
- [ ] Question-by-question UI.
- [ ] Save answers.
- [ ] Complete test.

## Milestone 8 — Scoring

- [ ] Score single_choice questions.
- [ ] Score scale questions.
- [ ] Handle open_text as requires_review.
- [ ] Calculate test_results.
- [ ] Calculate competency_scores.
- [ ] Calculate application overall_score.
- [ ] Calculate fit_score by job weights.
- [ ] Generate risk flags.

## Milestone 9 — Reports

- [ ] Candidate report page.
- [ ] Competency breakdown.
- [ ] Strengths and risks.
- [ ] Suggested interview questions.
- [ ] Candidate answers view.

## Milestone 10 — Candidate comparison

- [ ] Job compare page.
- [ ] Table with candidates and scores.
- [ ] Sort by fit_score.
- [ ] Filter by recommendation/risk/status.
- [ ] Shortlist action.

## Milestone 11 — Polish

- [ ] Empty states.
- [ ] Loading states.
- [ ] Error states.
- [ ] Mobile candidate flow.
- [ ] Basic audit and security review.
