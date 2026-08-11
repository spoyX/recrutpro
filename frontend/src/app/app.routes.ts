import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'login' },
  {
    path: 'login',
    loadComponent: () => import('./features/auth/login/login').then((m) => m.Login),
    title: 'Connexion — RecrutPro',
  },
  {
    // PLACEHOLDER. The real FR-45/FR-46/FR-47 dashboard is the next task; this
    // exists only so the login flow has a real destination to navigate to and
    // can be tested end to end. Replace it, do not build on it.
    path: 'dashboard',
    loadComponent: () =>
      import('./features/dashboard/dashboard-placeholder').then((m) => m.DashboardPlaceholder),
    title: 'Tableau de bord — RecrutPro',
  },
  { path: '**', redirectTo: 'login' },
];
