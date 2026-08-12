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
  { path: '**', redirectTo: 'login' },
];
