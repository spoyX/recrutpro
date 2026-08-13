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
  { path: '**', redirectTo: 'login' },
];
