import { TestBed, ComponentFixture } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter, Router } from '@angular/router';
import { Dashboard } from './dashboard';
import { environment } from '../../../environments/environment';
import { drainShellRequests, expectNoPageRequests } from '../../testing/shell-requests';

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

  afterEach(() => {
    // The topbar badge (D-081) fires on every shell render. Drained narrowly,
    // so a stray request of any OTHER url still fails the spec.
    drainShellRequests(http);
    expectNoPageRequests(http);
  });

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
      // D-088. Deliberately a DIFFERENT candidate from the interview below:
      // the two lists answer different questions and a shared fixture would
      // let one pass on the other's data.
      candidatesAwaitingDecision: [
        {
          id: 'c9',
          fullName: 'Sarah Lucas',
          currentStage: 'Évaluation complétée',
          registeredAt: '2026-08-01T09:00:00.000Z',
          jobPosition: { id: 'p2', title: 'Data analyst' },
        },
      ],
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

  // Phase 4.1 — the presentation pass, plus D-088's worklist.
  describe('4.1 — presentation', () => {
    const responsablePayload = {
      role: 'ResponsableHierarchique' as const,
      departmentCandidatesInProgress: 4,
      candidatesByStage: ALL_STAGES,
      pendingEvaluations: 2,
      candidatesAwaitingDecision: [
        {
          id: 'c9',
          fullName: 'Sarah Lucas',
          currentStage: 'Évaluation complétée',
          registeredAt: '2026-08-01T09:00:00.000Z',
          jobPosition: { id: 'p2', title: 'Data analyst' },
        },
      ],
      upcomingInterviews: [],
    };

    const loadResponsable = (over: Record<string, unknown> = {}): void => {
      create();
      http.expectOne(URL).flush({ ...responsablePayload, ...over });
      fixture.detectChanges();
    };

    describe('3.1 / D-088 — the decision worklist', () => {
      it('lists the candidates a decision is owed on', () => {
        loadResponsable();

        expect(text()).toContain('Candidats en attente de décision');
        expect(text()).toContain('Sarah Lucas');
        expect(text()).toContain('Data analyst');
      });

      it('3.8: the stage uses StageChip’s SETTLED tone, not a grey badge', () => {
        loadResponsable();

        const chip = Array.from(
          fixture.nativeElement.querySelectorAll('app-stage-chip .chip'),
        ).find((c) => (c as HTMLElement).textContent?.trim() === 'Évaluation complétée') as
          | HTMLElement
          | undefined;

        expect(chip).toBeTruthy();
        // D-080 settled this tone ten days ago; the mockup drew it grey.
        expect(chip!.className).toContain('chip--attention');
        expect(chip!.className).not.toContain('chip--neutral');
      });

      it('opens the SAME FinalDecision dialog, with no follow-up request', () => {
        loadResponsable();

        const decide = Array.from(fixture.nativeElement.querySelectorAll('button')).find((b) =>
          (b as HTMLElement).textContent?.includes('Décider'),
        ) as HTMLButtonElement;
        decide.click();
        fixture.detectChanges();

        // D-051's mandatory comment lives in that dialog and is untouched.
        expect(fixture.nativeElement.querySelector('app-final-decision')).toBeTruthy();
        // The SHELL's notification badge (D-081) is not the page's request.
        expectNoPageRequests(http);
      });

      it('re-reads the dashboard once a decision is taken', () => {
        loadResponsable();
        fixture.componentInstance.onDecided();

        // FR-39 moves the candidate to a terminal stage, so both the tile and
        // the list must change — a patched row would leave the count stale.
        const req = http.expectOne(URL);
        req.flush({ ...responsablePayload, candidatesAwaitingDecision: [] });
        fixture.detectChanges();

        expect(fixture.nativeElement.querySelector('app-final-decision')).toBeNull();
        expect(text()).toContain('Aucune décision en attente');
      });

      it('says so plainly when nothing is owed', () => {
        loadResponsable({ candidatesAwaitingDecision: [] });

        expect(text()).toContain('Aucune décision en attente');
      });
    });

    describe('2.2 — the pipeline card separates outcomes from the queue', () => {
      it('renders the terminal stages as figures, NOT as bars', () => {
        loadResponsable();

        const barLabels = Array.from(
          fixture.nativeElement.querySelectorAll('.pipeline__label'),
        ).map((el) => (el as HTMLElement).textContent?.trim());

        // Exact membership, not a substring sweep — « Rejeté » is a substring
        // of « Rejeté (CV) » and a loose check would agree with either.
        expect(barLabels).toContain('Candidature reçue');
        expect(barLabels).not.toContain('Accepté');
        expect(barLabels).not.toContain('Rejeté');
        expect(barLabels).not.toContain('Rejeté (CV)');

        const outcomeLabels = Array.from(
          fixture.nativeElement.querySelectorAll('.outcome__label'),
        ).map((el) => (el as HTMLElement).textContent?.trim());
        expect(outcomeLabels).toEqual(['Accepté', 'Rejeté', 'Rejeté (CV)']);
      });

      it('the counts still come from the SAME payload', () => {
        loadResponsable();

        const counts = Array.from(
          fixture.nativeElement.querySelectorAll('.outcome__count'),
        ).map((el) => Number((el as HTMLElement).textContent?.trim()));

        expect(counts).toEqual([
          ALL_STAGES['Accepté'],
          ALL_STAGES['Rejeté'],
          ALL_STAGES['Rejeté (CV)'],
        ]);
      });
    });

    describe('3.3 — an urgent hint when work is waiting', () => {
      it('marks a non-zero pending count as requiring action', () => {
        loadResponsable();

        expect(text()).toContain('Action requise');
        expect(fixture.nativeElement.querySelector('.tile__hint--urgent')).toBeTruthy();
      });

      it('and does NOT when there is nothing to do', () => {
        loadResponsable({ pendingEvaluations: 0, candidatesAwaitingDecision: [] });

        expect(text()).not.toContain('Action requise');
        expect(fixture.nativeElement.querySelector('.tile__hint--urgent')).toBeNull();
      });
    });

    describe('2.3 / 2.5 — the Recruteur branch', () => {
      const recruteurPayload = {
        role: 'Recruteur' as const,
        openPositions: 3,
        candidatesByStage: ALL_STAGES,
        recentCandidates: [
          {
            id: 'c1',
            fullName: 'Alice Martin',
            currentStage: 'Candidature reçue',
            registeredAt: '2026-08-10T09:00:00.000Z',
            jobPosition: { id: 'p1', title: 'Dev backend' },
          },
        ],
      };

      const loadRecruteur = (): void => {
        create();
        http.expectOne(URL).flush(recruteurPayload);
        fixture.detectChanges();
      };

      it('2.3: renders initials derived from the name', () => {
        loadRecruteur();

        const avatar = fixture.nativeElement.querySelector('.avatar') as HTMLElement;
        expect(avatar.textContent!.trim()).toBe('AM');
      });

      it('2.5: the active count is DERIVED from the breakdown beside it', () => {
        loadRecruteur();

        // Not a new metric — the non-terminal stages, summed. Computed from the
        // same object, so the tile cannot disagree with the bars.
        const expected =
          ALL_STAGES['Candidature reçue'] +
          ALL_STAGES['Présélection CV validée'] +
          ALL_STAGES['Entretien planifié'] +
          ALL_STAGES['Évaluation complétée'];
        expect(fixture.componentInstance.activeCandidates(ALL_STAGES)).toBe(expected);
        expect(text()).toContain('Candidats actifs');
      });

      it('2.4: offers the full list', () => {
        loadRecruteur();

        const link = fixture.nativeElement.querySelector('a.card__more') as HTMLAnchorElement;
        expect(link.getAttribute('href')).toBe('/candidates');
      });
    });

    describe('initials — the edge cases that would otherwise crash a row', () => {
      it('handles one name, extra spaces, and nothing at all', () => {
        create();
        const c = fixture.componentInstance;

        expect(c.initials('Alice Martin')).toBe('AM');
        expect(c.initials('  Alice   Bernard Martin ')).toBe('AM');
        expect(c.initials('Cher')).toBe('C');
        expect(c.initials('')).toBe('?');
        expect(c.initials(null)).toBe('?');
        expect(c.initials(undefined)).toBe('?');

        http.expectOne(URL).flush({
          role: 'Recruteur',
          openPositions: 0,
          candidatesByStage: ALL_STAGES,
          recentCandidates: [],
        });
      });
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
        candidatesAwaitingDecision: [],
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

  // FR-4's logout test moved to shared/app-shell/app-shell.spec.ts along with
  // the behaviour itself (D-067) — the topbar is now the shell's, not this
  // page's. It is relocated, not dropped.
});
