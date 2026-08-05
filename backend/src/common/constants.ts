// Shared enum values. Defined once here because models, services and the
// report layer all need the same strings (ARCHITECTURE.md Section 5 lists
// common/ for shared constants).

/** ARCHITECTURE.md Section 7 — User.role */
export enum Role {
  Administrateur = 'Administrateur',
  Recruteur = 'Recruteur',
  ResponsableHierarchique = 'ResponsableHierarchique',
}

/** ARCHITECTURE.md Section 7 — JobPosition.status (FR-14, FR-16) */
export enum JobPositionStatus {
  Brouillon = 'Brouillon',
  Ouvert = 'Ouvert',
  Cloture = 'Clôturé',
}

/**
 * ARCHITECTURE.md Section 8 — the FIXED recruitment pipeline.
 * Values are copied verbatim from Section 8 and must never be renamed or
 * reordered. Transitions happen ONLY as side effects of the service actions
 * in FR-25, FR-27, FR-28, FR-29 and FR-34 (D-006) — never set directly.
 */
export enum CandidateStage {
  CandidatureRecue = 'Candidature reçue',
  PreselectionCvValidee = 'Présélection CV validée',
  RejeteCv = 'Rejeté (CV)',
  EntretienPlanifie = 'Entretien planifié',
  EvaluationCompletee = 'Évaluation complétée',
  Accepte = 'Accepté',
  Rejete = 'Rejeté',
}

/** Interview lifecycle (FR-30, FR-34). Distinct from CandidateStage. */
export enum InterviewStatus {
  Planifie = 'Planifié',
  Realise = 'Réalisé',
  Annule = 'Annulé',
}

/** Notification triggers — FR-40, FR-41, FR-42 */
export enum NotificationType {
  ChangementEtape = 'ChangementEtape',
  EvaluationSoumise = 'EvaluationSoumise',
  EntretienPlanifie = 'EntretienPlanifie',
}

/** Sensitive actions that must be audited — FR-11 and ARCHITECTURE.md rule 4 */
export enum AuditAction {
  UtilisateurCree = 'UtilisateurCree',
  UtilisateurModifie = 'UtilisateurModifie',
  UtilisateurDesactive = 'UtilisateurDesactive',
  UtilisateurReactive = 'UtilisateurReactive',
  MotDePasseReinitialise = 'MotDePasseReinitialise',
  // D-034: department management is audited too. Rule 4 names only user
  // management explicitly, but a retired or renamed department silently
  // reshapes the rule 2 scoping every other permission depends on.
  DepartementCree = 'DepartementCree',
  DepartementModifie = 'DepartementModifie',
  DepartementDesactive = 'DepartementDesactive',
  DepartementReactive = 'DepartementReactive',
  EtapeCandidatModifiee = 'EtapeCandidatModifiee',
  EntretienAnnule = 'EntretienAnnule',
  EvaluationSoumise = 'EvaluationSoumise',
}

/** Entities an AuditLog entry can point at (FR-11) */
export enum AuditTargetType {
  User = 'User',
  Department = 'Department',
  Candidate = 'Candidate',
  Interview = 'Interview',
  InterviewEvaluation = 'InterviewEvaluation',
}

/** Basic email shape check — server-side input validation (NFR-05) */
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
