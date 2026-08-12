import { TestBed, ComponentFixture } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter, Router } from '@angular/router';
import { Dashboard } from './dashboard';
import { AuthService } from '../../core/auth.service';
import { environment } from '../../../environments/environment';

describe('Dashboard (FR-45, FR-46, FR-47)', () => {
  let fixture: ComponentFixture<Dashboard>;
  let http: HttpTestingController;
  let router: Router;

  const URL = `${environment.apiUrl}/dashboard`;

  const ALL_STAGES = {
    'Candidature reçue': 3,
    'Présélection CV validée': 2,
    'Rejeté (CV)': 1,
    'Entretien planifié': 1,
    'Évaluation complétée': 0,
    Accepté: 4,
    Rejeté: 0,
  };

  const create = () => {
    fixture = TestBed.createComponent(Dashboard);
    fixture.detectChanges();
  };

  const text = () => fixture.nativeElement.textContent as string;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Dashboard],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    }).compileComponents();

    http = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
  });

  afterEach(() => http.verify());

  it('D-001: requests the dashboard with credentials', () => {
    create();

    const req = http.expectOne(URL);
    expect(req.request.withCredentials).toBeTrue();
    expect(req.request.method).toBe('GET');
    req.flush({ role: 'Administrateur', activeUsers: 0, recentAuditEntries: [] });
  });

  it('NFR-04: never asks for a particular role — the server decides', () => {
    create();

    const req = http.expectOne(URL);
    expect(req.request.params.keys().length).toBe(0);
    expect(req.request.urlWithParams).toBe(URL);
    req.flush({ role: 'Administrateur', activeUsers: 0, recentAuditEntries: [] });
  });

  describe('FR-45: Recruteur', () => {
    const payload = {
      role: 'Recruteur' as const,
      openPositions: 7,
      candidatesByStage: ALL_STAGES,
      recentCandidates: [
        {
          id: 'c1',
          fullName: 'Alice Dupont',
          currentStage: 'Accepté',
          registeredAt: '2026-08-10T09:00:00.000Z',
          jobPosition: { id: 'p1', title: 'Dev backend' },
        },
      ],
    };

    beforeEach(() => {
      create();
      http.expectOne(URL).flush(payload);
      fixture.detectChanges();
    });

    it('FR-45: shows the open-position count', () => {
      expect(text()).toContain('Postes ouverts');
      expect(text()).toContain('7');
    });

    it('FR-45: renders ALL SEVEN pipeline stages, zeroes included', () => {
      // The backend zero-fills deliberately (D-057) so the chart does not
      // reshape between renders; dropping empty rows here would undo that.
      for (const stage of Object.keys(ALL_STAGES)) {
        expect(text()).withContext(stage).toContain(stage);
      }
    });

    it('FR-45: lists recent candidates with poste and stage', () => {
      expect(text()).toContain('Alice Dupont');
      expect(text()).toContain('Dev backend');
      expect(fixture.nativeElement.querySelector('app-stage-chip')).toBeTruthy();
    });

    it('FR-45: shows no Responsable or Administrateur widgets', () => {
      expect(text()).not.toContain('Évaluations en attente');
      expect(text()).not.toContain('Utilisateurs actifs');
      expect(text()).not.toContain("journal d'audit");
    });
  });

  describe('FR-46: Responsable hiérarchique', () => {
    const payload = {
      role: 'ResponsableHierarchique' as const,
      departmentCandidatesInProgress: 4,
      candidatesByStage: ALL_STAGES,
      pendingEvaluations: 2,
      upcomingInterviews: [
        {
          id: 'i1',
          scheduledAt: '2026-09-01T09:30:00.000Z',
          status: 'Planifié',
          candidate: { id: 'c2', fullName: 'Bruno Martin' },
          jobPosition: { id: 'p1', title: 'Dev backend' },
        },
      ],
    };

    beforeEach(() => {
      create();
      http.expectOne(URL).flush(payload);
      fixture.detectChanges();
    });

    it('FR-46: shows in-progress candidates and pending evaluations', () => {
      expect(text()).toContain('Candidats en cours');
      expect(text()).toContain('4');
      expect(text()).toContain('Évaluations en attente');
      expect(text()).toContain('2');
    });

    it('FR-46: lists upcoming interviews with candidate and poste', () => {
      expect(text()).toContain('Bruno Martin');
      expect(text()).toContain('Dev backend');
    });

    it('FR-46: shows no Recruteur or Administrateur widgets', () => {
      expect(text()).not.toContain('Postes ouverts');
      expect(text()).not.toContain('Utilisateurs actifs');
    });

  });

  describe('FR-47: Administrateur', () => {
    const payload = {
      role: 'Administrateur' as const,
      activeUsers: 12,
      recentAuditEntries: [
        {
          id: 'a1',
          action: 'UtilisateurCree',
          targetType: 'User',
          targetId: 'u1',
          timestamp: '2026-08-11T12:00:00.000Z',
          user: { id: 'admin1', name: 'Admin' },
        },
      ],
    };

    beforeEach(() => {
      create();
      http.expectOne(URL).flush(payload);
      fixture.detectChanges();
    });

    it('FR-47: shows the active-user count', () => {
      expect(text()).toContain('Utilisateurs actifs');
      expect(text()).toContain('12');
    });

    it('FR-47: lists audit entries naming the ACTOR, not a bare id', () => {
      expect(text()).toContain('Admin');
      expect(text()).toContain('User');
      expect(text()).not.toContain('admin1');
    });

    it('FR-47: humanises the action name', () => {
      expect(text()).toContain('Utilisateur Cree');
    });

    it('FR-47: shows no Recruteur or Responsable widgets', () => {
      expect(text()).not.toContain('Postes ouverts');
      expect(text()).not.toContain('Candidats en cours');
    });
  });

  describe('empty states', () => {
    it('says so rather than rendering an empty list', () => {
      create();
      http.expectOne(URL).flush({
        role: 'Recruteur',
        openPositions: 0,
        candidatesByStage: ALL_STAGES,
        recentCandidates: [],
      });
      fixture.detectChanges();

      expect(text()).toContain('Aucun candidat enregistré');
    });

    it('FR-46: an empty interview list says so too', () => {
      create();
      http.expectOne(URL).flush({
        role: 'ResponsableHierarchique',
        departmentCandidatesInProgress: 0,
        candidatesByStage: ALL_STAGES,
        pendingEvaluations: 0,
        upcomingInterviews: [],
      });
      fixture.detectChanges();

      expect(text()).toContain('Aucun entretien à venir');
    });
  });

  describe('failure handling', () => {
    it('FR-2/FR-8: a 401 sends the user back to login, not to an error screen', () => {
      const navigate = spyOn(router, 'navigate').and.resolveTo(true);
      create();

      http.expectOne(URL).flush(
        { error: { code: 'UNAUTHENTICATED', message: 'Vous devez être connecté.' } },
        { status: 401, statusText: 'Unauthorized' },
      );

      // The session expired (FR-2) or the account was deactivated (FR-8);
      // signing in again is the only useful action.
      expect(navigate).toHaveBeenCalledWith(['/login']);
    });

    it('shows the server message for other failures and offers a retry', () => {
      const navigate = spyOn(router, 'navigate');
      create();

      http.expectOne(URL).flush(
        { error: { code: 'FORBIDDEN', message: 'Votre compte n’est rattaché à aucun département.' } },
        { status: 403, statusText: 'Forbidden' },
      );
      fixture.detectChanges();

      expect(text()).toContain('aucun département');
      expect(text()).toContain('Réessayer');
      expect(navigate).not.toHaveBeenCalled();
    });

    it('reports an unreachable server distinctly', () => {
      create();

      http.expectOne(URL).error(new ProgressEvent('error'), { status: 0 });
      fixture.detectChanges();

      expect(text()).toContain('injoignable');
    });
  });

  describe('FR-4: logout', () => {
    it('calls logout and returns to the login page', () => {
      const navigate = spyOn(router, 'navigate').and.resolveTo(true);
      create();
      http.expectOne(URL).flush({ role: 'Administrateur', activeUsers: 1, recentAuditEntries: [] });
      fixture.detectChanges();

      fixture.componentInstance.logout();

      const req = http.expectOne(`${environment.apiUrl}/auth/logout`);
      expect(req.request.withCredentials).toBeTrue();
      req.flush(null);

      expect(navigate).toHaveBeenCalledWith(['/login']);
      expect(TestBed.inject(AuthService).currentUser()).toBeNull();
    });
  });
});
