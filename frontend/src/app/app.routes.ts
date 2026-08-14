import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'login' },
  {
    path: 'login',
    loadComponent: () => import('./features/auth/login/login').then((m) => m.Login),
    title: 'Connexion — RecrutPro',
  },
  {
    // FR-45 / FR-46 / FR-47. The role-scoped payload is decided server-side
    // (D-057), so one route serves all three dashboards.
    path: 'dashboard',
    loadComponent: () => import('./features/dashboard/dashboard').then((m) => m.Dashboard),
    title: 'Tableau de bord — RecrutPro',
  },
  {
    // FR-24. Registered BEFORE `candidates/:id` for readability only — the two
    // patterns have different segment counts and cannot shadow each other.
    path: 'candidates',
    loadComponent: () =>
      import('./features/candidates/candidates-list/candidates-list').then((m) => m.CandidatesList),
    title: 'Candidats — RecrutPro',
  },
  {
    // FR-19 to FR-22. Registered BEFORE `candidates/:id` because « new » would
    // otherwise match that pattern and be read as a candidate id — the one
    // ordering here that genuinely matters.
    path: 'candidates/new',
    loadComponent: () =>
      import('./features/candidates/candidate-register/candidate-register').then(
        (m) => m.CandidateRegister,
      ),
    title: 'Nouveau candidat — RecrutPro',
  },
  {
    // D-067. `:id` binds to the component's `id` input via
    // `withComponentInputBinding`. There is no /candidates list page yet, so
    // this route is reached from the dashboard's recent-candidate rows.
    path: 'candidates/:id',
    loadComponent: () =>
      import('./features/candidates/candidate-details/candidate-details').then(
        (m) => m.CandidateDetails,
      ),
    title: 'Dossier candidat — RecrutPro',
  },
  {
    // FR-33 (Recruteur, unscoped) and FR-35 (Responsable, scoped) — ONE route,
    // the scope decided server-side (D-047).
    path: 'interviews',
    loadComponent: () =>
      import('./features/interviews/interviews-list/interviews-list').then(
        (m) => m.InterviewsList,
      ),
    title: 'Entretiens — RecrutPro',
  },
  {
    // FR-17, and the home of FR-14/FR-15/FR-16. Registered BEFORE
    // `job-positions/:id` for readability only — the two patterns have
    // different segment counts and cannot shadow each other.
    path: 'job-positions',
    loadComponent: () =>
      import('./features/job-positions/job-positions-list/job-positions-list').then(
        (m) => m.JobPositionsList,
      ),
    title: 'Postes — RecrutPro',
  },
  {
    // FR-14 to FR-17. `GET /job-positions/:id` already existed (D-038). Reached
    // from the list above and from a poste title on the candidate pages.
    path: 'job-positions/:id',
    loadComponent: () =>
      import('./features/job-positions/job-position-details/job-position-details').then(
        (m) => m.JobPositionDetails,
      ),
    title: 'Poste — RecrutPro',
  },
  { path: '**', redirectTo: 'login' },
];
