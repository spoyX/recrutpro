import { TestBed, ComponentFixture } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter, Router } from '@angular/router';
import { CandidateDetails } from './candidate-details';
import { CandidateDetail } from '../candidate.service';
import { AuthService } from '../../../core/auth.service';
import { environment } from '../../../../environments/environment';
import { drainShellRequests, expectNoPageRequests } from '../../../testing/shell-requests';

describe('CandidateDetails (D-067)', () => {
  let fixture: ComponentFixture<CandidateDetails>;
  let http: HttpTestingController;
  let router: Router;

  const ID = '64b7f0c2e1a2b3c4d5e6f7a8';
  const URL = `${environment.apiUrl}/candidates/${ID}`;

  const base: CandidateDetail = {
    id: ID,
    fullName: 'Jean Martin',
    email: 'jean.martin@example.com',
    phone: '0612345678',
    jobPosition: { id: 'p1', title: 'Développeur backend' },
    currentStage: 'Accepté',
    registeredBy: { id: 'u1', name: 'Marie', avatarUrl: null },
    registeredAt: '2026-08-01T09:00:00.000Z',
    decidedAt: '2026-08-11T17:30:00.000Z',
    rejectionReason: null,
    decisionComment: 'Excellent profil, offre envoyée.',
    resume: { hasResume: true, url: `/api/v1/candidates/${ID}/resume` },
    interviews: [
      {
        id: 'i2',
        scheduledAt: '2026-08-10T14:00:00.000Z',
        status: 'Réalisé',
        interviewer: { id: 'u2', name: 'Pierre', avatarUrl: null },
        cancellationReason: null,
        evaluation: {
          id: 'e1',
          scores: { technicalSkills: 4, communication: 5, overallFit: 4 },
          comments: 'Très bonne maîtrise technique.',
          submittedBy: { id: 'u2', name: 'Pierre', avatarUrl: null },
        },
      },
      {
        id: 'i1',
        scheduledAt: '2026-08-05T09:00:00.000Z',
        status: 'Annulé',
        interviewer: { id: 'u2', name: 'Pierre', avatarUrl: null },
        cancellationReason: 'Candidat indisponible.',
        evaluation: null,
      },
    ],
  };

  const create = (): void => {
    fixture = TestBed.createComponent(CandidateDetails);
    fixture.componentRef.setInput('id', ID);
    fixture.detectChanges();
  };

  const load = (payload: Partial<CandidateDetail> = {}): void => {
    create();
    http.expectOne(URL).flush({ ...base, ...payload });
    fixture.detectChanges();
  };

  const text = (): string => fixture.nativeElement.textContent as string;
  const html = (): string => fixture.nativeElement.innerHTML as string;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CandidateDetails],
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

  it('D-001: requests the candidate file with credentials', () => {
    create();

    const req = http.expectOne(URL);
    expect(req.request.withCredentials).toBeTrue();
    expect(req.request.method).toBe('GET');
    req.flush(base);
  });

  it('D-067: calls exactly ONE endpoint for the whole page', () => {
    load();

    // The CV flag, the interview history and the evaluations all arrive in that
    // single response — no follow-up request is issued for any of them.
    expectNoPageRequests(http);
  });

  describe('FR-19 / FR-24 — the candidate file', () => {
    it('renders the name, poste and current stage', () => {
      load();

      expect(text()).toContain('Jean Martin');
      expect(text()).toContain('Développeur backend');
      expect(text()).toContain('Accepté');
    });

    it('renders the registration facts (FR-19, D-018)', () => {
      load();

      expect(text()).toContain('01/08/2026');
      expect(text()).toContain('Marie');
    });

    it('FR-29: shows the decision comment and the D-058 decision date', () => {
      load();

      expect(text()).toContain('Excellent profil, offre envoyée.');
      expect(text()).toContain('11/08/2026');
    });

    it('FR-26: shows a CV-stage rejection motive when there is one', () => {
      load({
        currentStage: 'Rejeté (CV)',
        rejectionReason: 'Profil trop junior pour le poste.',
        decisionComment: null,
        decidedAt: null,
        interviews: [],
      });

      expect(text()).toContain('Profil trop junior pour le poste.');
      // D-058: a CV rejection carries no decidedAt, so no decision block.
      expect(text()).not.toContain('Décision finale');
    });
  });

  describe('FR-23 / D-040 — the CV', () => {
    it('links the CV through this API proxy route, never a storage URL', () => {
      load();

      const link = fixture.nativeElement.querySelector('a[href*="/resume"]') as HTMLAnchorElement;
      expect(link).toBeTruthy();
      expect(link.getAttribute('href')).toBe(`/api/v1/candidates/${ID}/resume`);
      expect(html()).not.toContain('cloudinary');
    });

    it('offers no download link when there is no CV', () => {
      load({ resume: { hasResume: false, url: null } });

      expect(fixture.nativeElement.querySelector('a[href*="/resume"]')).toBeNull();
      expect(text()).toContain('Aucun CV téléversé.');
    });
  });

  describe('FR-34 / FR-36 — interviews and evaluations', () => {
    it('renders every interview in the order the server sent them', () => {
      load();

      const whens = Array.from(
        fixture.nativeElement.querySelectorAll('.interview__when'),
      ) as HTMLElement[];
      expect(whens.length).toBe(2);
      // Newest first — the server sorts, the client does not re-sort.
      expect(whens[0].textContent).toContain('10/08/2026');
      expect(whens[1].textContent).toContain('05/08/2026');
    });

    it('FR-34: shows a cancelled interview with its motive', () => {
      load();

      expect(text()).toContain('Annulé');
      expect(text()).toContain('Candidat indisponible.');
    });

    it('FR-36: renders the three scores and the comments against their interview', () => {
      load();

      expect(text()).toContain('Compétences techniques');
      expect(text()).toContain('4/5');
      expect(text()).toContain('5/5');
      expect(text()).toContain('Très bonne maîtrise technique.');
      expect(text()).toContain('Pierre');
    });

    it('FR-36: the 1-5 scale renders as five dots with exactly `score` filled', () => {
      load();

      const rows = Array.from(fixture.nativeElement.querySelectorAll('.scores__row'));
      // First criterion is technicalSkills = 4 of 5.
      const dots = (rows[0] as HTMLElement).querySelectorAll('.scores__dot');
      const filled = (rows[0] as HTMLElement).querySelectorAll('.scores__dot--on');
      expect(dots.length).toBe(5);
      expect(filled.length).toBe(4);
    });

    it('D-067: an interview with no evaluation renders no score block', () => {
      load();

      const blocks = fixture.nativeElement.querySelectorAll('.evaluation');
      // Two interviews, only the first has an evaluation.
      expect(blocks.length).toBe(1);
    });

    it('shows an empty state when the candidate has no interview', () => {
      load({ interviews: [] });

      expect(text()).toContain('Aucun entretien planifié pour ce candidat.');
    });
  });

  describe('FR-35 — a Responsable hiérarchique gets no contact details', () => {
    it('states the restriction rather than rendering a blank field', () => {
      load({ email: null, phone: null });

      expect(text()).toContain('Non communiqué pour votre rôle');
      expect(text()).not.toContain('jean.martin@example.com');
    });

    it('still offers the CV, which FR-35 does grant', () => {
      load({ email: null, phone: null });

      expect(fixture.nativeElement.querySelector('a[href*="/resume"]')).toBeTruthy();
    });
  });

  /**
   * FR-30 — the entry point to scheduling. This is an AFFORDANCE, not a
   * permission: `POST /interviews` is Recruteur-only and re-checks the stage,
   * so these tests pin what is SHOWN, and the server tests pin what is allowed.
   */
  describe('FR-30 — offering to schedule an interview', () => {
    const signIn = (role: string): void => {
      TestBed.inject(AuthService).currentUser.set({
        id: 'u1',
        name: 'Marie',
        email: 'marie@example.com',
        role: role as 'Recruteur',
        departmentId: 'd1',
        mustChangePassword: false,
        avatarUrl: null,
      });
    };

    const scheduleButton = (): HTMLButtonElement | undefined =>
      Array.from(fixture.nativeElement.querySelectorAll('button')).find((b) =>
        (b as HTMLElement).textContent?.includes('Planifier un entretien'),
      ) as HTMLButtonElement | undefined;

    it('a Recruteur is offered it on a CV-validated candidate', () => {
      signIn('Recruteur');
      load({ currentStage: 'Présélection CV validée', decisionComment: null, decidedAt: null });

      expect(scheduleButton()).toBeTruthy();
    });

    it('the offer is absent at every other stage — the server would 409', () => {
      for (const stage of ['Candidature reçue', 'Entretien planifié', 'Accepté', 'Rejeté']) {
        signIn('Recruteur');
        load({ currentStage: stage, interviews: [] });
        expect(scheduleButton())
          .withContext(`stage ${stage}`)
          .toBeUndefined();
      }
    });

    it('a Responsable hiérarchique is not offered it — FR-30 is the recruiter\'s', () => {
      signIn('ResponsableHierarchique');
      load({ currentStage: 'Présélection CV validée', email: null, phone: null });

      expect(scheduleButton()).toBeUndefined();
    });

    it('opens the dialog, which fetches the picker only THEN — not on every file view', () => {
      signIn('Recruteur');
      load({ currentStage: 'Présélection CV validée' });

      // Nothing extra was requested just by viewing the file.
      expectNoPageRequests(http);

      scheduleButton()!.click();
      fixture.detectChanges();

      http.expectOne(`${environment.apiUrl}/job-positions/p1`).flush({
        id: 'p1',
        title: 'Développeur backend',
        departmentId: 'd9',
        status: 'Ouvert',
      });
      const users = http.expectOne((r) => r.url === `${environment.apiUrl}/users`);
      expect(users.request.params.get('role')).toBe('ResponsableHierarchique');
      expect(users.request.params.get('departmentId')).toBe('d9');
      users.flush([{ id: 'r1', name: 'Claire Morel', departmentId: 'd9' }]);
      fixture.detectChanges();

      expect(text()).toContain('Planifier un entretien');
      expect(text()).toContain('Claire Morel');
    });

    it('FR-27: re-reads the file after scheduling, since the stage moved', () => {
      signIn('Recruteur');
      load({ currentStage: 'Présélection CV validée' });

      fixture.componentInstance.onScheduled();
      fixture.detectChanges();

      // The reload is a real request against the same endpoint — the page does
      // not guess the new stage, it asks.
      http.expectOne(URL).flush({ ...base, currentStage: 'Entretien planifié' });
      fixture.detectChanges();

      expect(text()).toContain('Entretien planifié');
      expect(scheduleButton()).toBeUndefined();
    });
  });

  /** FR-25 / FR-26 — the entry point to the CV preselection. */
  describe('FR-25 — offering the CV preselection', () => {
    const signIn = (role: string): void => {
      TestBed.inject(AuthService).currentUser.set({
        id: 'u1',
        name: 'Marie',
        email: 'marie@example.com',
        role: role as 'Recruteur',
        departmentId: 'd1',
        mustChangePassword: false,
        avatarUrl: null,
      });
    };

    const reviewButton = (): HTMLButtonElement | undefined =>
      Array.from(fixture.nativeElement.querySelectorAll('button')).find((b) =>
        (b as HTMLElement).textContent?.includes('Présélection CV'),
      ) as HTMLButtonElement | undefined;

    it('a Recruteur is offered it at « Candidature reçue »', () => {
      signIn('Recruteur');
      load({
        currentStage: 'Candidature reçue',
        decisionComment: null,
        decidedAt: null,
        interviews: [],
      });

      expect(reviewButton()).toBeTruthy();
    });

    it('D-042: not offered at any other stage — the transition is ONE-WAY', () => {
      for (const stage of [
        'Présélection CV validée',
        'Rejeté (CV)',
        'Entretien planifié',
        'Évaluation complétée',
        'Accepté',
      ]) {
        signIn('Recruteur');
        load({ currentStage: stage, decisionComment: null, decidedAt: null, interviews: [] });
        expect(reviewButton())
          .withContext(`stage ${stage}`)
          .toBeUndefined();
      }
    });

    it("a Responsable is NOT offered it — FR-25 is the recruiter's", () => {
      signIn('ResponsableHierarchique');
      load({
        currentStage: 'Candidature reçue',
        decisionComment: null,
        decidedAt: null,
        interviews: [],
        email: null,
        phone: null,
      });

      expect(reviewButton()).toBeUndefined();
    });

    it('opens the dialog with the CV link the file already holds — no follow-up request', () => {
      signIn('Recruteur');
      load({
        currentStage: 'Candidature reçue',
        decisionComment: null,
        decidedAt: null,
        interviews: [],
      });

      reviewButton()!.click();
      fixture.detectChanges();

      expectNoPageRequests(http);
      expect(fixture.nativeElement.querySelector('app-cv-review')).toBeTruthy();
      // Passed straight down from the file's payload.
      const link = fixture.nativeElement.querySelector(
        'app-cv-review a[href*="/resume"]',
      ) as HTMLAnchorElement;
      expect(link.getAttribute('href')).toBe(`/api/v1/candidates/${ID}/resume`);
    });

    it('re-reads the file after the decision, and the offer is gone', () => {
      signIn('Recruteur');
      load({
        currentStage: 'Candidature reçue',
        decisionComment: null,
        decidedAt: null,
        interviews: [],
      });

      fixture.componentInstance.onReviewed();
      fixture.detectChanges();

      http.expectOne(URL).flush({
        ...base,
        currentStage: 'Rejeté (CV)',
        rejectionReason: 'Profil trop junior pour le poste.',
        decisionComment: null,
        decidedAt: null,
        interviews: [],
      });
      fixture.detectChanges();

      expect(text()).toContain('Profil trop junior pour le poste.');
      expect(reviewButton()).toBeUndefined();
      const chip = fixture.nativeElement.querySelector('app-stage-chip .chip') as HTMLElement;
      expect(chip.className).toContain('chip--negative');
    });

    it('the pipeline is now continuous: a validated candidate is offered SCHEDULING next', () => {
      signIn('Recruteur');
      load({
        currentStage: 'Présélection CV validée',
        decisionComment: null,
        decidedAt: null,
        interviews: [],
      });

      // The gap D-077 flagged: registration → preselection → scheduling now
      // has no missing link for a Recruteur.
      expect(reviewButton()).toBeUndefined();
      expect(
        Array.from(fixture.nativeElement.querySelectorAll('button')).some((b) =>
          (b as HTMLElement).textContent?.includes('Planifier un entretien'),
        ),
      ).toBeTrue();
    });
  });

  /** FR-29 / FR-39 — the entry point to the final decision. */
  describe('FR-39 — offering the final decision', () => {
    const signIn = (role: string): void => {
      TestBed.inject(AuthService).currentUser.set({
        id: 'u1',
        name: 'Pierre',
        email: 'pierre@example.com',
        role: role as 'ResponsableHierarchique',
        departmentId: 'd1',
        mustChangePassword: false,
        avatarUrl: null,
      });
    };

    const decideButton = (): HTMLButtonElement | undefined =>
      Array.from(fixture.nativeElement.querySelectorAll('button')).find((b) =>
        (b as HTMLElement).textContent?.includes('Décision finale'),
      ) as HTMLButtonElement | undefined;

    it('a Responsable is offered it at « Évaluation complétée »', () => {
      signIn('ResponsableHierarchique');
      load({
        currentStage: 'Évaluation complétée',
        decisionComment: null,
        decidedAt: null,
        email: null,
        phone: null,
      });

      expect(decideButton()).toBeTruthy();
    });

    it('D-051: not offered at any other stage — the server would 409', () => {
      for (const stage of [
        'Candidature reçue',
        'Présélection CV validée',
        'Entretien planifié',
        'Accepté',
        'Rejeté',
      ]) {
        signIn('ResponsableHierarchique');
        load({ currentStage: stage, decisionComment: null, decidedAt: null, interviews: [] });
        expect(decideButton())
          .withContext(`stage ${stage}`)
          .toBeUndefined();
      }
    });

    it('a Recruteur is NOT offered it — FR-39 is the responsable\'s', () => {
      signIn('Recruteur');
      load({ currentStage: 'Évaluation complétée', decisionComment: null, decidedAt: null });

      expect(decideButton()).toBeUndefined();
    });

    it('opens the dialog without a follow-up request', () => {
      signIn('ResponsableHierarchique');
      load({ currentStage: 'Évaluation complétée', decisionComment: null, decidedAt: null });

      decideButton()!.click();
      fixture.detectChanges();

      expectNoPageRequests(http);
      expect(fixture.nativeElement.querySelector('app-final-decision')).toBeTruthy();
    });

    it('re-reads the file after a decision — the stage and decidedAt are the server\'s', () => {
      signIn('ResponsableHierarchique');
      load({ currentStage: 'Évaluation complétée', decisionComment: null, decidedAt: null });

      fixture.componentInstance.onDecided();
      fixture.detectChanges();

      http.expectOne(URL).flush({
        ...base,
        currentStage: 'Accepté',
        decisionComment: 'Excellent profil, offre envoyée.',
        decidedAt: '2026-08-14T10:00:00.000Z',
      });
      fixture.detectChanges();

      expect(text()).toContain('Excellent profil, offre envoyée.');
      // Terminal: the offer is gone, because the stage moved past it.
      expect(decideButton()).toBeUndefined();
      const chip = fixture.nativeElement.querySelector('app-stage-chip .chip') as HTMLElement;
      expect(chip.className).toContain('chip--positive');
    });

    it('a rejection renders with the NEGATIVE tone, same as every other terminal reject', () => {
      signIn('ResponsableHierarchique');
      load({
        currentStage: 'Rejeté',
        decisionComment: 'Séniorité insuffisante.',
        decidedAt: '2026-08-14T10:00:00.000Z',
      });

      const chip = fixture.nativeElement.querySelector('app-stage-chip .chip') as HTMLElement;
      expect(chip.className).toContain('chip--negative');
      expect(text()).toContain('Séniorité insuffisante.');
    });
  });

  // Phase 4.1 items 4.1, 4.2 and 4.4.
  describe('4.1 — the presentation pass', () => {
    const future = (days: number): string =>
      new Date(Date.now() + days * 86_400_000).toISOString();
    const past = (days: number): string =>
      new Date(Date.now() - days * 86_400_000).toISOString();

    it('4.1: the header carries initials, the stage chip and the contact facts', () => {
      load();

      // D-091: the circle is `app-user-avatar` now. A candidate has no
      // account, so it renders initials and NEVER an image — asserted here so
      // that wiring a photo into this header would fail loudly.
      const avatar = fixture.nativeElement.querySelector('app-user-avatar') as HTMLElement;
      expect(avatar.textContent!.trim()).toBe('JM');
      expect(avatar.querySelector('img')).toBeNull();

      // The chip sits INSIDE the identity block now, beside the name.
      const line = fixture.nativeElement.querySelector('.head__line') as HTMLElement;
      expect(line.querySelector('app-stage-chip')).toBeTruthy();

      expect(fixture.nativeElement.querySelector('.head__contact')).toBeTruthy();
    });

    it('4.1: a Responsable sees no contact facts, because there are none', () => {
      // FR-35 nulls them for that role (D-067); the header must not render an
      // empty glyph row rather than omitting the fact.
      load({ email: null, phone: null });

      const contact = fixture.nativeElement.querySelector('.head__contact') as HTMLElement;
      expect(contact.querySelectorAll('.head__fact').length).toBe(1);
      expect(contact.textContent).toContain('Enregistré le');
    });

    it('4.4: shows the SOONEST upcoming interview, not merely the first', () => {
      load({
        interviews: [
          {
            id: 'i-late',
            scheduledAt: future(9),
            status: 'Planifié',
            interviewer: { id: 'r1', name: 'Pierre Tard', avatarUrl: null },
            cancellationReason: null,
            evaluation: null,
          },
          {
            id: 'i-soon',
            scheduledAt: future(2),
            status: 'Planifié',
            interviewer: { id: 'r2', name: 'Sofia Proche', avatarUrl: null },
            cancellationReason: null,
            evaluation: null,
          },
        ],
      });

      const panel = fixture.nativeElement.querySelector('.next') as HTMLElement;
      expect(panel).toBeTruthy();
      // The payload order puts the later one first; « prochain » means soonest.
      expect(panel.textContent).toContain('Sofia Proche');
      expect(panel.textContent).not.toContain('Pierre Tard');
    });

    it('4.4: ignores PAST and CANCELLED interviews', () => {
      load({
        interviews: [
          {
            id: 'i-past',
            scheduledAt: past(3),
            status: 'Planifié',
            interviewer: { id: 'r1', name: 'Passé', avatarUrl: null },
            cancellationReason: null,
            evaluation: null,
          },
          {
            id: 'i-cancelled',
            scheduledAt: future(4),
            status: 'Annulé',
            interviewer: { id: 'r2', name: 'Annulé', avatarUrl: null },
            cancellationReason: 'Indisponible',
            evaluation: null,
          },
        ],
      });

      // « Prochain » means one that is going to happen. Both rows still appear
      // in the history below; only the panel is absent.
      expect(fixture.nativeElement.querySelector('.next')).toBeNull();
    });

    it('4.4: absent entirely when nothing is scheduled', () => {
      load({ interviews: [] });

      expect(fixture.nativeElement.querySelector('.next')).toBeNull();
    });

    it('4.2: the CV card claims ONLY what the payload carries', () => {
      load({ resume: { hasResume: true, url: `/api/v1/candidates/${ID}/resume` } });

      const card = fixture.nativeElement.querySelector('.resume') as HTMLElement;
      expect(card).toBeTruthy();
      // The mockup showed a filename, a size and an upload date. None of the
      // three is in the payload, so none may appear here.
      expect(card.textContent).not.toMatch(/\.pdf|Mo|MB|\d{2}\/\d{2}\/\d{4}/);
      expect(fixture.nativeElement.textContent).toContain('Télécharger le CV');
    });

    it('4.2: no file card at all when there is no CV', () => {
      load({ resume: { hasResume: false, url: null } });

      expect(fixture.nativeElement.querySelector('.resume')).toBeNull();
      expect(text()).toContain('Aucun CV téléversé');
    });
  });

  describe('Null-tolerance', () => {
    it('renders a candidate whose position or registrant is missing', () => {
      load({ jobPosition: null, registeredBy: null });

      expect(text()).toContain('Poste inconnu');
      expect(text()).toContain('Inconnu');
    });
  });

  describe('Errors', () => {
    it('FR-2 / FR-8: a 401 navigates to /login rather than showing an error', () => {
      const navigate = spyOn(router, 'navigate').and.resolveTo(true);
      create();

      http.expectOne(URL).flush(null, { status: 401, statusText: 'Unauthorized' });
      fixture.detectChanges();

      expect(navigate).toHaveBeenCalledWith(['/login']);
    });

    it("NFR-09: shows the server's own message on a 403, with a retry", () => {
      const navigate = spyOn(router, 'navigate').and.resolveTo(true);
      create();

      http.expectOne(URL).flush(
        { error: { code: 'FORBIDDEN', message: "Vous ne pouvez consulter que les candidats dont vous menez l'entretien." } },
        { status: 403, statusText: 'Forbidden' },
      );
      fixture.detectChanges();

      expect(navigate).not.toHaveBeenCalled();
      expect(text()).toContain("Vous ne pouvez consulter que les candidats dont vous menez l'entretien.");
      expect(text()).toContain('Réessayer');
    });

    it('shows a reachable message when the server cannot be reached', () => {
      create();

      http.expectOne(URL).error(new ProgressEvent('error'), { status: 0, statusText: '' });
      fixture.detectChanges();

      expect(text()).toContain('Le serveur est injoignable.');
    });

    it('retries the same request when the user clicks Réessayer', () => {
      create();
      http.expectOne(URL).flush(null, { status: 500, statusText: 'Server Error' });
      fixture.detectChanges();

      const retry = Array.from(fixture.nativeElement.querySelectorAll('button')).find((b) =>
        (b as HTMLElement).textContent?.includes('Réessayer'),
      ) as HTMLButtonElement;
      retry.click();
      fixture.detectChanges();

      http.expectOne(URL).flush(base);
      fixture.detectChanges();
      expect(text()).toContain('Jean Martin');
    });
  });

  // FR-22 — replacing (or first attaching) a CV from the file, which is where
  // a missing or wrong one is noticed.
  describe('FR-22 — the CV upload action (D-082)', () => {
    const signIn = (role: string): void => {
      TestBed.inject(AuthService).currentUser.set({
        id: 'u1',
        name: 'Marie',
        email: 'marie@example.com',
        role: role as 'Recruteur',
        departmentId: 'd1',
        mustChangePassword: false,
        avatarUrl: null,
      });
    };

    const uploadButton = (): HTMLButtonElement | undefined =>
      Array.from(fixture.nativeElement.querySelectorAll('button')).find((b) =>
        /Remplacer le CV|Téléverser un CV/.test((b as HTMLElement).textContent ?? ''),
      ) as HTMLButtonElement | undefined;

    it('offers REPLACE when a CV is attached', () => {
      signIn('Recruteur');
      load({ resume: { hasResume: true, url: `/api/v1/candidates/${ID}/resume` } });

      expect(uploadButton()!.textContent).toContain('Remplacer le CV');
    });

    it('offers a FIRST upload when none is — registration allows skipping it', () => {
      signIn('Recruteur');
      load({ resume: { hasResume: false, url: null } });

      expect(uploadButton()!.textContent).toContain('Téléverser un CV');
      expect(text()).toContain('Aucun CV téléversé');
    });

    it('is NOT offered to a Responsable — they may READ the CV, not replace it', () => {
      signIn('ResponsableHierarchique');
      load({ resume: { hasResume: true, url: `/api/v1/candidates/${ID}/resume` } });

      // D-047 opens the GET to an assigned responsable; the POST sits below the
      // Recruteur-only guard. The server enforces both — this only declines to
      // show a button that would 403.
      expect(uploadButton()).toBeUndefined();
      expect(fixture.nativeElement.querySelector('a[href*="/resume"]')).toBeTruthy();
    });

    it('is offered on a TERMINAL candidate too — FR-22 names no stage', () => {
      signIn('Recruteur');
      load({
        currentStage: 'Accepté',
        resume: { hasResume: true, url: `/api/v1/candidates/${ID}/resume` },
      });

      // A wrong file on an accepted candidate is exactly when someone needs it.
      expect(uploadButton()).toBeTruthy();
    });

    it('opens the dialog with the file it already holds — no follow-up request', () => {
      signIn('Recruteur');
      load({ resume: { hasResume: true, url: `/api/v1/candidates/${ID}/resume` } });

      uploadButton()!.click();
      fixture.detectChanges();

      expect(fixture.nativeElement.querySelector('app-replace-resume')).toBeTruthy();
      expectNoPageRequests(http);
    });

    it('re-reads the file after a replacement — hasResume and url both change', () => {
      signIn('Recruteur');
      load({ resume: { hasResume: false, url: null } });

      fixture.componentInstance.onResumeReplaced();

      http.expectOne(URL).flush({
        ...base,
        resume: { hasResume: true, url: `/api/v1/candidates/${ID}/resume` },
      });
      fixture.detectChanges();

      expect(fixture.nativeElement.querySelector('app-replace-resume')).toBeNull();
      expect(text()).toContain('Télécharger le CV');
    });
  });


});
