/**
 * Phase 4.2 — the demo dataset.
 *
 * WIPES THE DATABASE AND RESEEDS IT. Run with `npm run seed -- --force`.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE CONTAINS NO PASSWORD
 * ---------------------------------------------------------------------------
 * A seed that writes real passwords is a credential file, and a credential
 * file in git is a credential leak that survives every later rotation. So the
 * passwords are GENERATED AT RUN TIME with `node:crypto` and printed ONCE to
 * the console — the same one-time-disclosure pattern D-031 fixed for FR-10's
 * temporary password, which is also why nothing here can recover a password
 * after the run: only the bcrypt hash is stored. Lose the console output and
 * the answer is to re-run the seed, not to look it up.
 *
 * ---------------------------------------------------------------------------
 * WHY IT WRITES MODELS DIRECTLY INSTEAD OF CALLING THE SERVICES
 * ---------------------------------------------------------------------------
 * A demo dataset needs HISTORY: a hire concluded 52 days ago, an interview
 * held last week, an audit trail that reads like four months of work. The
 * services deliberately make that impossible — they stamp `registeredAt` and
 * `decidedAt` server-side (D-018, D-058), refuse interviews in the past, and
 * refuse an evaluation for a slot that has not happened. Those are the right
 * rules for the API and the wrong tool for a fixture.
 *
 * So each action below writes the domain document AND the same audit entry and
 * notification its service would have written, with a historical timestamp.
 * The mapping is copied from the services rather than invented — see
 * `walkCandidate`. Where the two could drift, `selfCheck` fails the run.
 */
import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import mongoose, { Types } from 'mongoose';
import { hash } from 'bcryptjs';

import { Department, IDepartment } from '../src/models/Department.model';
import { User, IUser } from '../src/models/User.model';
import { JobPosition, IJobPosition } from '../src/models/JobPosition.model';
import { Candidate, ICandidate } from '../src/models/Candidate.model';
import { Interview } from '../src/models/Interview.model';
import { InterviewEvaluation } from '../src/models/InterviewEvaluation.model';
import { AuditLog } from '../src/models/AuditLog.model';
import { Notification } from '../src/models/Notification.model';
import {
  Role,
  JobPositionStatus,
  CandidateStage,
  InterviewStatus,
  NotificationType,
  AuditAction,
  AuditTargetType,
} from '../src/common/constants';

/** Same cost the services use — a demo account must log in like a real one. */
const BCRYPT_COST = 10;

/** Notifications older than this are pre-read, so the badge is believable. */
const UNREAD_WINDOW_DAYS = 5;

// ---------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------

/** `days` is signed and relative to now: -30 is a month ago, +3 is Thursday. */
const at = (days: number, hour = 10, minute = 0): Date => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  date.setHours(hour, minute, 0, 0);
  return date;
};

/**
 * Nudges a day offset off Saturday and Sunday.
 *
 * The offsets below are written as "so many days before/after today", which
 * makes the dataset relative — and therefore lands a different weekday every
 * time it is run. Left alone, roughly two in seven interviews get booked for a
 * Saturday afternoon, which is the kind of detail that makes a demo dataset
 * read as generated.
 *
 * The nudge moves AWAY from today, so a slot that is still to come cannot
 * become one that has already passed. That distinction is load-bearing here:
 * FR-46 counts a passed-but-unevaluated slot as an évaluation en attente and
 * an upcoming one as an entretien à venir, so a two-day slip in the wrong
 * direction would silently move a candidate between two dashboard widgets.
 */
const workingDay = (dayOffset: number): number => {
  const forwards = dayOffset >= 0;
  switch (at(dayOffset).getDay()) {
    case 6: // samedi
      return dayOffset + (forwards ? 2 : -1);
    case 0: // dimanche
      return dayOffset + (forwards ? 1 : -2);
    default:
      return dayOffset;
  }
};

// ---------------------------------------------------------------------------
// Accumulators — every action appends here, and they are inserted in one go
// ---------------------------------------------------------------------------

interface AuditRow {
  userId: Types.ObjectId;
  action: AuditAction;
  targetType: AuditTargetType;
  targetId: Types.ObjectId;
  timestamp: Date;
}

interface NotificationRow {
  userId: Types.ObjectId;
  type: NotificationType;
  message: string;
  isRead: boolean;
  createdAt: Date;
}

const audits: AuditRow[] = [];
const notifications: NotificationRow[] = [];

const audit = (
  actor: IUser,
  action: AuditAction,
  targetType: AuditTargetType,
  targetId: Types.ObjectId,
  when: Date,
): void => {
  audits.push({ userId: actor._id as Types.ObjectId, action, targetType, targetId, timestamp: when });
};

/**
 * Mirrors `notification.service.ts#notify`, including both of its anti-noise
 * filters: the actor never hears about their own action, and one action never
 * puts two rows in one panel.
 */
const notify = (
  recipients: Array<IUser | null | undefined>,
  type: NotificationType,
  message: string,
  when: Date,
  actor: IUser,
): void => {
  const seen = new Set<string>();
  for (const recipient of recipients) {
    if (!recipient) continue;
    const id = String(recipient._id);
    if (id === String(actor._id) || seen.has(id)) continue;
    seen.add(id);
    notifications.push({
      userId: recipient._id as Types.ObjectId,
      type,
      message,
      isRead: when < at(-UNREAD_WINDOW_DAYS),
      createdAt: when,
    });
  }
};

// ---------------------------------------------------------------------------
// The company
// ---------------------------------------------------------------------------

const DEPARTMENTS = [
  { key: 'eng', name: 'Ingénierie logicielle', isActive: true },
  { key: 'infra', name: 'Infrastructure et Cloud', isActive: true },
  { key: 'produit', name: 'Produit et Design', isActive: true },
  { key: 'data', name: 'Données et Analytique', isActive: true },
  { key: 'commercial', name: 'Commercial et Marketing', isActive: true },
  { key: 'rh', name: 'Ressources humaines', isActive: true },
  // FR-13: deactivated, so the administration screen has a retired department
  // to show and the pickers elsewhere have one to hide.
  { key: 'support', name: 'Support client', isActive: false },
] as const;

type DepartmentKey = (typeof DEPARTMENTS)[number]['key'];

const USERS = [
  { key: 'sonia', name: 'Sonia Belhadj', role: Role.Administrateur, department: null },
  { key: 'marc', name: 'Marc Lefèvre', role: Role.Administrateur, department: null },

  { key: 'amelie', name: 'Amélie Rousseau', role: Role.Recruteur, department: 'rh' },
  { key: 'thomas', name: 'Thomas Girard', role: Role.Recruteur, department: 'rh' },
  // FR-10 — freshly onboarded, password reset by the administrator and not yet
  // changed. Gives the login screen its forced-change flow to demonstrate and
  // the account list its « Mot de passe à changer » pill.
  { key: 'nadia', name: 'Nadia Cherif', role: Role.Recruteur, department: 'rh', mustChangePassword: true },
  // FR-8 — a deactivated account, so the row and the reactivate action exist.
  { key: 'julien', name: 'Julien Mercier', role: Role.Recruteur, department: 'rh', isActive: false },

  { key: 'claire', name: 'Claire Fontaine', role: Role.ResponsableHierarchique, department: 'eng' },
  { key: 'hugo', name: 'Hugo Bertrand', role: Role.ResponsableHierarchique, department: 'eng' },
  { key: 'rachid', name: 'Rachid Nasri', role: Role.ResponsableHierarchique, department: 'infra' },
  { key: 'lea', name: 'Léa Dumont', role: Role.ResponsableHierarchique, department: 'produit' },
  { key: 'antoine', name: 'Antoine Vasseur', role: Role.ResponsableHierarchique, department: 'data' },
  { key: 'camille', name: 'Camille Perrin', role: Role.ResponsableHierarchique, department: 'commercial' },
  { key: 'farah', name: 'Farah Zouari', role: Role.ResponsableHierarchique, department: 'rh' },
] as const;

type UserKey = (typeof USERS)[number]['key'];

const POSITIONS = [
  {
    key: 'backend',
    title: 'Ingénieur logiciel backend (Node.js)',
    department: 'eng',
    status: JobPositionStatus.Ouvert,
    createdBy: 'amelie',
    created: -132,
    description:
      "Concevoir et maintenir les services applicatifs de la plateforme : API REST, modèle de données, " +
      "intégrations tierces. Le poste travaille en binôme avec l'équipe frontend et participe aux revues " +
      'de code quotidiennes.',
    requirements:
      "3 ans d'expérience minimum en Node.js et TypeScript · MongoDB ou PostgreSQL · tests automatisés · " +
      'notions de conteneurisation (Docker) · français courant.',
  },
  {
    key: 'frontend',
    title: 'Développeur frontend Angular',
    department: 'eng',
    status: JobPositionStatus.Ouvert,
    createdBy: 'amelie',
    created: -126,
    description:
      "Développer les interfaces de la plateforme en Angular, en lien direct avec l'équipe produit et " +
      "design. Le poste porte la qualité d'usage : accessibilité, performance perçue, cohérence visuelle.",
    requirements:
      'Angular 17 ou supérieur · TypeScript · RxJS · CSS moderne et accessibilité (WCAG AA) · ' +
      "une expérience des design systems est appréciée.",
  },
  {
    key: 'qa',
    title: 'Ingénieur QA automatisation',
    department: 'eng',
    status: JobPositionStatus.Ouvert,
    createdBy: 'thomas',
    created: -71,
    description:
      "Construire et maintenir la stratégie de tests automatisés : tests d'intégration API, tests de bout " +
      "en bout, intégration à la chaîne de livraison. Le poste est transverse aux deux équipes de développement.",
    requirements:
      "Expérience confirmée en automatisation de tests · un framework de bout en bout (Playwright, Cypress) · " +
      'CI/CD · capacité à documenter et à faire adopter une pratique de test.',
  },
  {
    key: 'architecte',
    title: 'Architecte logiciel',
    department: 'eng',
    status: JobPositionStatus.Brouillon,
    createdBy: 'amelie',
    created: -9,
    description:
      "Définir les orientations techniques de la plateforme et accompagner les équipes dans leur mise en " +
      "œuvre. Fiche de poste en cours d'arbitrage avec la direction technique.",
    requirements: "Périmètre et niveau de séniorité à confirmer avant publication.",
  },
  {
    key: 'devops',
    title: 'Ingénieur DevOps',
    department: 'infra',
    status: JobPositionStatus.Ouvert,
    createdBy: 'amelie',
    created: -118,
    description:
      "Industrialiser le déploiement et la supervision des environnements : chaînes de livraison, " +
      "infrastructure as code, observabilité. Le poste est rattaché à l'équipe Infrastructure et Cloud.",
    requirements:
      'Docker et orchestration · un fournisseur cloud (AWS, GCP ou Azure) · Terraform ou équivalent · ' +
      'supervision et alerting · astreinte partagée une semaine sur six.',
  },
  {
    key: 'sysadmin',
    title: 'Administrateur systèmes et réseaux',
    department: 'infra',
    status: JobPositionStatus.Cloture,
    createdBy: 'amelie',
    created: -168,
    description:
      "Administrer les serveurs, le réseau et les sauvegardes de l'entreprise, et assurer le support de " +
      "niveau 3 sur les incidents d'infrastructure.",
    requirements:
      "Linux en production · réseau (VLAN, VPN, pare-feu) · sauvegarde et restauration · " +
      "5 ans d'expérience minimum.",
  },
  {
    key: 'po',
    title: 'Product Owner',
    department: 'produit',
    status: JobPositionStatus.Ouvert,
    createdBy: 'thomas',
    created: -95,
    description:
      "Porter la vision d'un domaine fonctionnel de la plateforme : cadrage des besoins, rédaction des " +
      "user stories, arbitrage du backlog et animation des rituels avec l'équipe de développement.",
    requirements:
      "Expérience en gestion de produit logiciel · pratique des méthodes agiles · aisance rédactionnelle · " +
      'anglais professionnel.',
  },
  {
    key: 'ux',
    title: 'Designer UX/UI',
    department: 'produit',
    status: JobPositionStatus.Ouvert,
    createdBy: 'amelie',
    created: -103,
    description:
      "Concevoir les parcours et les interfaces de la plateforme, du cadrage jusqu'aux maquettes livrées " +
      "aux développeurs, et faire vivre le design system de l'entreprise.",
    requirements:
      'Figma · maîtrise des parcours utilisateurs et des tests d\'utilisabilité · culture accessibilité · ' +
      'portfolio à présenter en entretien.',
  },
  {
    key: 'analyst',
    title: 'Data analyst',
    department: 'data',
    status: JobPositionStatus.Ouvert,
    createdBy: 'thomas',
    created: -88,
    description:
      "Produire les analyses et tableaux de bord qui éclairent les décisions des équipes produit et " +
      'commerciales, et fiabiliser les indicateurs partagés dans l\'entreprise.',
    requirements:
      'SQL avancé · un outil de visualisation (Looker, Metabase, Power BI) · Python ou R apprécié · ' +
      'capacité à restituer un résultat à un public non technique.',
  },
  {
    key: 'dataeng',
    title: 'Ingénieur data',
    department: 'data',
    status: JobPositionStatus.Brouillon,
    createdBy: 'thomas',
    created: -5,
    description:
      "Construire les pipelines d'ingestion et de transformation alimentant les usages analytiques. " +
      "Ouverture du poste conditionnée à la validation budgétaire du prochain trimestre.",
    requirements: 'Fiche en cours de rédaction avec le responsable Données et Analytique.',
  },
  {
    key: 'account',
    title: 'Chargé de comptes grands comptes',
    department: 'commercial',
    status: JobPositionStatus.Ouvert,
    createdBy: 'amelie',
    created: -64,
    description:
      "Développer et fidéliser un portefeuille de clients grands comptes : qualification, négociation, " +
      'suivi de la relation et coordination avec les équipes produit sur les besoins remontés.',
    requirements:
      'Expérience de la vente B2B en cycle long · aisance avec un CRM · anglais courant · ' +
      'déplacements ponctuels en région.',
  },
  {
    key: 'recruteur',
    title: 'Chargé de recrutement',
    department: 'rh',
    status: JobPositionStatus.Cloture,
    createdBy: 'amelie',
    created: -149,
    description:
      "Piloter les recrutements techniques de bout en bout : rédaction des annonces, sourcing, " +
      "présélection et coordination des entretiens avec les responsables d'équipe.",
    requirements:
      "Expérience du recrutement en environnement technique · pratique des outils de sourcing · " +
      'sens de la relation candidat.',
  },
] as const;

type PositionKey = (typeof POSITIONS)[number]['key'];

// ---------------------------------------------------------------------------
// The candidates
// ---------------------------------------------------------------------------

interface CandidatePlan {
  name: string;
  position: PositionKey;
  stage: CandidateStage;
  /** Days ago the application arrived. */
  registered: number;
  /** Days ago the final decision was taken — only for a terminal stage. */
  concluded?: number;
  /** Signed day offset of the interview slot; positive is still to come. */
  interviewAt?: number;
  interviewer?: UserKey;
  /** Present = an earlier interview was cancelled and the candidate came back. */
  cancelled?: string;
  scores?: [number, number, number];
  rejectionReason?: string;
  decisionComment?: string;
  /** Who registered and advanced the application. */
  handledBy: UserKey;
}

/**
 * A funnel, not a uniform spread: many applications, fewer interviews, a
 * handful of conclusions. Every one of the seven pipeline stages is occupied,
 * so the FR-45 breakdown and the pipeline report have no empty column.
 */
const CANDIDATES: CandidatePlan[] = [
  // ---- Ingénieur logiciel backend
  { name: 'Yanis Bouaziz', position: 'backend', stage: CandidateStage.CandidatureRecue, registered: -4, handledBy: 'thomas' },
  { name: 'Élodie Marchand', position: 'backend', stage: CandidateStage.CandidatureRecue, registered: -9, handledBy: 'amelie' },
  { name: 'Samir Toumi', position: 'backend', stage: CandidateStage.PreselectionCvValidee, registered: -18, handledBy: 'thomas' },
  { name: 'Pauline Girard', position: 'backend', stage: CandidateStage.EntretienPlanifie, registered: -26, interviewAt: 3, interviewer: 'claire', handledBy: 'thomas' },
  { name: 'Mehdi Slimani', position: 'backend', stage: CandidateStage.EvaluationCompletee, registered: -40, interviewAt: -9, interviewer: 'claire', scores: [4, 5, 4], handledBy: 'amelie' },
  {
    name: 'Laura Bénichou', position: 'backend', stage: CandidateStage.Accepte,
    registered: -96, concluded: -44, interviewAt: -60, interviewer: 'claire', scores: [5, 4, 5],
    decisionComment:
      "Très bon niveau technique et une vraie capacité à expliquer ses choix d'architecture. Proposition " +
      'envoyée sur la fourchette haute, prise de poste convenue au début du mois suivant.',
    handledBy: 'thomas',
  },
  {
    name: 'Nicolas Ferrand', position: 'backend', stage: CandidateStage.Rejete,
    registered: -70, concluded: -34, interviewAt: -50, interviewer: 'hugo', scores: [2, 3, 2],
    decisionComment:
      "Profil sympathique mais l'exercice technique a montré des lacunes sur la conception d'API et la " +
      "gestion des erreurs. Candidature réorientée vers un poste plus junior si une ouverture se présente.",
    handledBy: 'amelie',
  },
  { name: 'Inès Karoui', position: 'backend', stage: CandidateStage.RejeteCv, registered: -21, rejectionReason: "Expérience très majoritairement en PHP, sans pratique récente de Node.js ni de TypeScript.", handledBy: 'thomas' },
  { name: 'Damien Roussel', position: 'backend', stage: CandidateStage.RejeteCv, registered: -33, rejectionReason: "Moins d'un an d'expérience professionnelle : le poste demande une autonomie de trois ans minimum.", handledBy: 'amelie' },

  // ---- Développeur frontend Angular
  { name: 'Sarah Lemoine', position: 'frontend', stage: CandidateStage.CandidatureRecue, registered: -2, handledBy: 'nadia' },
  { name: 'Kevin Dubois', position: 'frontend', stage: CandidateStage.CandidatureRecue, registered: -6, handledBy: 'thomas' },
  { name: 'Amina Belkacem', position: 'frontend', stage: CandidateStage.PreselectionCvValidee, registered: -14, interviewAt: -6, interviewer: 'claire', cancelled: "Candidate souffrante, entretien à replanifier la semaine suivante.", handledBy: 'thomas' },
  { name: 'Grégoire Petit', position: 'frontend', stage: CandidateStage.EntretienPlanifie, registered: -20, interviewAt: 6, interviewer: 'claire', handledBy: 'amelie' },
  // Slot already passed and no evaluation yet — this is what FR-46's
  // « évaluations en attente » counts.
  { name: 'Manon Leroy', position: 'frontend', stage: CandidateStage.EntretienPlanifie, registered: -31, interviewAt: -2, interviewer: 'claire', handledBy: 'thomas' },
  {
    name: 'Théo Vidal', position: 'frontend', stage: CandidateStage.Accepte,
    registered: -66, concluded: -35, interviewAt: -48, interviewer: 'hugo', scores: [4, 4, 5],
    decisionComment:
      'Excellente culture accessibilité et un portfolio solide. Retenu à l\'unanimité par l\'équipe, ' +
      'intégration prévue sur le chantier de refonte du portail.',
    handledBy: 'amelie',
  },
  { name: 'Chloé Barbier', position: 'frontend', stage: CandidateStage.RejeteCv, registered: -12, rejectionReason: 'Profil intégrateur HTML/CSS, sans expérience applicative Angular ou React.', handledBy: 'nadia' },

  // ---- Ingénieur QA automatisation
  { name: 'Rayan Haddad', position: 'qa', stage: CandidateStage.CandidatureRecue, registered: -7, handledBy: 'amelie' },
  { name: 'Justine Colin', position: 'qa', stage: CandidateStage.PreselectionCvValidee, registered: -16, handledBy: 'nadia' },
  { name: 'Olivier Maillard', position: 'qa', stage: CandidateStage.EvaluationCompletee, registered: -35, interviewAt: -6, interviewer: 'claire', scores: [3, 4, 3], handledBy: 'thomas' },
  { name: 'Fatima Zahra Idrissi', position: 'qa', stage: CandidateStage.RejeteCv, registered: -25, rejectionReason: 'Uniquement des tests manuels sur les cinq dernières années, aucune automatisation documentée.', handledBy: 'amelie' },

  // ---- Ingénieur DevOps
  { name: 'Bastien Noël', position: 'devops', stage: CandidateStage.CandidatureRecue, registered: -3, handledBy: 'thomas' },
  { name: 'Sonia Trabelsi', position: 'devops', stage: CandidateStage.PreselectionCvValidee, registered: -13, handledBy: 'amelie' },
  { name: 'Maxime Perrot', position: 'devops', stage: CandidateStage.EntretienPlanifie, registered: -22, interviewAt: 1, interviewer: 'rachid', handledBy: 'thomas' },
  { name: 'Adrien Fauré', position: 'devops', stage: CandidateStage.EvaluationCompletee, registered: -38, interviewAt: -8, interviewer: 'rachid', scores: [5, 3, 4], handledBy: 'amelie' },
  {
    name: 'Lucie Chevalier', position: 'devops', stage: CandidateStage.Accepte,
    registered: -80, concluded: -56, interviewAt: -68, interviewer: 'rachid', scores: [5, 5, 4],
    decisionComment:
      'Maîtrise complète de la chaîne de livraison et une expérience d\'astreinte déjà rodée. Recrutement ' +
      'validé rapidement pour sécuriser la migration cloud en cours.',
    handledBy: 'thomas',
  },
  { name: 'Walid Amrani', position: 'devops', stage: CandidateStage.RejeteCv, registered: -29, rejectionReason: 'Aucune pratique de l\'infrastructure as code ni d\'un fournisseur cloud, exigences centrales du poste.', handledBy: 'amelie' },

  // ---- Administrateur systèmes et réseaux (poste clôturé : le recrutement est allé à son terme)
  {
    name: 'Julien Deschamps', position: 'sysadmin', stage: CandidateStage.Accepte,
    registered: -120, concluded: -102, interviewAt: -112, interviewer: 'rachid', scores: [4, 5, 5],
    decisionComment:
      'Candidature interne recommandée par l\'équipe : périmètre déjà connu, prise de poste immédiate. ' +
      'Le poste a été clôturé dans la foulée.',
    handledBy: 'amelie',
  },
  {
    name: 'Émilie Rocher', position: 'sysadmin', stage: CandidateStage.Rejete,
    registered: -118, concluded: -100, interviewAt: -110, interviewer: 'rachid', scores: [3, 2, 3],
    decisionComment:
      'Compétences réseau correctes mais des difficultés à se positionner sur les incidents critiques. ' +
      'Un autre candidat a été retenu sur ce poste.',
    handledBy: 'amelie',
  },
  { name: 'Karim Belaïd', position: 'sysadmin', stage: CandidateStage.RejeteCv, registered: -115, rejectionReason: 'Parcours exclusivement en support utilisateur de niveau 1, sans administration serveur.', handledBy: 'thomas' },

  // ---- Product Owner
  { name: 'Anaïs Prévost', position: 'po', stage: CandidateStage.CandidatureRecue, registered: -5, handledBy: 'amelie' },
  { name: 'Romain Guillot', position: 'po', stage: CandidateStage.PreselectionCvValidee, registered: -17, handledBy: 'thomas' },
  { name: 'Sophie Bertin', position: 'po', stage: CandidateStage.EntretienPlanifie, registered: -24, interviewAt: 8, interviewer: 'lea', handledBy: 'amelie' },
  {
    name: 'Hakim Mansouri', position: 'po', stage: CandidateStage.Rejete,
    registered: -74, concluded: -30, interviewAt: -52, interviewer: 'lea', scores: [3, 3, 2],
    decisionComment:
      'Bonne connaissance du marché mais une pratique de l\'agilité surtout théorique. Le poste demande ' +
      'de tenir un backlog seul dès les premières semaines.',
    handledBy: 'thomas',
  },

  // ---- Designer UX/UI
  { name: 'Camille Ollivier', position: 'ux', stage: CandidateStage.CandidatureRecue, registered: -8, handledBy: 'nadia' },
  { name: 'Nour Ben Salem', position: 'ux', stage: CandidateStage.PreselectionCvValidee, registered: -15, interviewAt: -7, interviewer: 'lea', cancelled: 'Créneau annulé : la responsable était retenue sur un comité de pilotage client.', handledBy: 'amelie' },
  { name: 'Victor Lambert', position: 'ux', stage: CandidateStage.EntretienPlanifie, registered: -28, interviewAt: -1, interviewer: 'lea', handledBy: 'thomas' },
  {
    name: 'Marine Delaunay', position: 'ux', stage: CandidateStage.Accepte,
    registered: -88, concluded: -49, interviewAt: -62, interviewer: 'lea', scores: [4, 5, 4],
    decisionComment:
      'Portfolio très convaincant sur les parcours complexes et une vraie sensibilité accessibilité. ' +
      'Offre acceptée après une négociation courte sur le télétravail.',
    handledBy: 'amelie',
  },
  { name: 'Loïc Renard', position: 'ux', stage: CandidateStage.RejeteCv, registered: -19, rejectionReason: 'Portfolio essentiellement graphique (identité, print), sans travail de conception d\'interface.', handledBy: 'thomas' },

  // ---- Data analyst
  { name: 'Zineb El Amrani', position: 'analyst', stage: CandidateStage.CandidatureRecue, registered: -1, handledBy: 'thomas' },
  { name: 'Florian Masson', position: 'analyst', stage: CandidateStage.CandidatureRecue, registered: -11, handledBy: 'nadia' },
  { name: 'Aurélie Neveu', position: 'analyst', stage: CandidateStage.PreselectionCvValidee, registered: -20, interviewAt: -9, interviewer: 'antoine', cancelled: 'Candidate indisponible sur le créneau proposé, nouvelle date à convenir.', handledBy: 'amelie' },
  { name: 'Sofiane Bencherif', position: 'analyst', stage: CandidateStage.EvaluationCompletee, registered: -33, interviewAt: -5, interviewer: 'antoine', scores: [4, 4, 4], handledBy: 'thomas' },
  { name: 'Benoît Charpentier', position: 'analyst', stage: CandidateStage.RejeteCv, registered: -27, rejectionReason: 'Niveau SQL déclaré débutant alors que le poste repose sur des requêtes analytiques complexes.', handledBy: 'amelie' },

  // ---- Chargé de comptes grands comptes
  { name: 'Léna Fabre', position: 'account', stage: CandidateStage.CandidatureRecue, registered: -10, handledBy: 'amelie' },
  { name: 'Tarek Jelassi', position: 'account', stage: CandidateStage.EntretienPlanifie, registered: -23, interviewAt: 4, interviewer: 'camille', handledBy: 'thomas' },
  {
    name: 'Isabelle Moreau', position: 'account', stage: CandidateStage.Rejete,
    registered: -60, concluded: -26, interviewAt: -40, interviewer: 'camille', scores: [2, 4, 3],
    decisionComment:
      'Très bonne communication mais un parcours en vente transactionnelle, loin du cycle long attendu ' +
      'sur les grands comptes.',
    handledBy: 'amelie',
  },

  // ---- Chargé de recrutement (poste clôturé)
  {
    name: 'Céline Barreau', position: 'recruteur', stage: CandidateStage.Accepte,
    registered: -105, concluded: -70, interviewAt: -85, interviewer: 'farah', scores: [5, 4, 4],
    decisionComment:
      'Expérience directement transposable sur les recrutements techniques et une bonne lecture du marché. ' +
      'Poste pourvu, annonce clôturée.',
    handledBy: 'amelie',
  },
];

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** « Amélie Rousseau » → « amelie.rousseau ». */
const slug = (name: string): string =>
  name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z]+/g, '.')
    .replace(/^\.|\.$/g, '');

const MAILBOXES = ['gmail.com', 'outlook.fr', 'yahoo.fr', 'free.fr'];

/** Deterministic but varied, so no two candidates share a number. */
const phoneFor = (index: number): string => {
  const digits = String((index * 7919 + 10_432_187) % 100_000_000).padStart(8, '0');
  return `+33 6 ${digits.slice(0, 2)} ${digits.slice(2, 4)} ${digits.slice(4, 6)} ${digits.slice(6, 8)}`;
};

/**
 * The password every seeded account gets, read from `--password <value>`.
 *
 * WHY A FLAG AND NOT A CONSTANT. A memorable shared password is genuinely
 * convenient for a live demo — one credential to type instead of thirteen —
 * and against a scratch database on loopback it costs nothing. But writing it
 * into THIS FILE would put a plaintext credential in git, which is exactly what
 * D-089 settled against: a committed password outlives every later rotation and
 * is read by everyone who reads the repo. Passing it at run time gives the same
 * convenience and leaves nothing behind.
 *
 * MIN_PASSWORD_LENGTH is 8, and it is enforced here too — a seed that writes a
 * password the application would refuse produces accounts whose credential
 * cannot be re-entered through the FR-10 change-password screen.
 */
const MIN_PASSWORD_LENGTH = 8;

const chosenPassword = (): string | null => {
  const index = process.argv.indexOf('--password');
  if (index === -1) {
    return null;
  }
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error('--password attend une valeur : --password <mot-de-passe>');
  }
  if (value.length < MIN_PASSWORD_LENGTH) {
    throw new Error(
      `Le mot de passe doit faire au moins ${MIN_PASSWORD_LENGTH} caractères ` +
        `(l'application refuserait « ${value} » à la première connexion).`,
    );
  }
  return value;
};

/**
 * Without `--password`: a distinct generated password per account, 96 bits from
 * the CSPRNG, URL-safe so it survives a copy-paste out of a terminal. Never
 * persisted in clear — only its hash is.
 */
const generatePassword = (): string => chosenPassword() ?? randomBytes(12).toString('base64url');

// ---------------------------------------------------------------------------
// Seeding
// ---------------------------------------------------------------------------

interface Seeded {
  departments: Map<DepartmentKey, IDepartment>;
  users: Map<UserKey, IUser>;
  positions: Map<PositionKey, IJobPosition>;
  passwords: Array<{ user: IUser; password: string }>;
}

const seedOrganisation = async (): Promise<Seeded> => {
  const departments = new Map<DepartmentKey, IDepartment>();
  for (const spec of DEPARTMENTS) {
    departments.set(spec.key, await Department.create({ name: spec.name, isActive: spec.isActive }));
  }

  // The first administrator is the actor for everything the administrators do,
  // including their own creation. That is unavoidable — someone has to be the
  // first row — and it is what the real deployment looks like too.
  const users = new Map<UserKey, IUser>();
  const passwords: Array<{ user: IUser; password: string }> = [];

  for (const spec of USERS) {
    const password = generatePassword();
    const user = await User.create({
      name: spec.name,
      email: `${slug(spec.name)}@recrutpro.fr`,
      passwordHash: await hash(password, BCRYPT_COST),
      role: spec.role,
      departmentId: spec.department ? departments.get(spec.department)!._id : undefined,
      isActive: 'isActive' in spec ? spec.isActive : true,
      mustChangePassword: 'mustChangePassword' in spec ? spec.mustChangePassword : false,
    });
    users.set(spec.key, user);
    passwords.push({ user, password });
  }

  const admin = users.get('sonia')!;
  const otherAdmin = users.get('marc')!;

  // FR-13 / D-034 — the departments were created before the accounts that use
  // them, which is also the order the constraint forces (D-030).
  let day = -160;
  for (const spec of DEPARTMENTS) {
    audit(admin, AuditAction.DepartementCree, AuditTargetType.Department, departments.get(spec.key)!._id as Types.ObjectId, at(day, 9, 15));
    day += 1;
  }
  audit(
    admin,
    AuditAction.DepartementDesactive,
    AuditTargetType.Department,
    departments.get('support')!._id as Types.ObjectId,
    at(-47, 16, 20),
  );

  // FR-6 / rule 4
  day = -158;
  for (const spec of USERS) {
    audit(admin, AuditAction.UtilisateurCree, AuditTargetType.User, users.get(spec.key)!._id as Types.ObjectId, at(day, 11, 5));
    day += 2;
  }
  // FR-7 — a department move, the kind of edit the log exists to show.
  audit(otherAdmin, AuditAction.UtilisateurModifie, AuditTargetType.User, users.get('farah')!._id as Types.ObjectId, at(-52, 14, 40));
  // FR-8 and FR-10, and the two rows the administration screen shows for them.
  audit(admin, AuditAction.UtilisateurDesactive, AuditTargetType.User, users.get('julien')!._id as Types.ObjectId, at(-23, 9, 50));
  audit(admin, AuditAction.MotDePasseReinitialise, AuditTargetType.User, users.get('nadia')!._id as Types.ObjectId, at(-2, 8, 45));

  // FR-14 / D-036
  const positions = new Map<PositionKey, IJobPosition>();
  for (const spec of POSITIONS) {
    const creator = users.get(spec.createdBy)!;
    const position = await JobPosition.create({
      title: spec.title,
      department: departments.get(spec.department)!._id,
      description: spec.description,
      requirements: spec.requirements,
      status: spec.status,
      createdAt: at(spec.created, 9, 30),
      createdBy: creator._id,
    });
    positions.set(spec.key, position);

    audit(creator, AuditAction.PosteCree, AuditTargetType.JobPosition, position._id as Types.ObjectId, at(spec.created, 9, 30));
  }

  // FR-15 — two edits, so `PosteModifie` is not a theoretical action.
  audit(users.get('amelie')!, AuditAction.PosteModifie, AuditTargetType.JobPosition, positions.get('backend')!._id as Types.ObjectId, at(-58, 15, 10));
  audit(users.get('thomas')!, AuditAction.PosteModifie, AuditTargetType.JobPosition, positions.get('po')!._id as Types.ObjectId, at(-21, 11, 25));

  // FR-16 — both closed positions were closed once their hire concluded.
  audit(users.get('amelie')!, AuditAction.PosteCloture, AuditTargetType.JobPosition, positions.get('sysadmin')!._id as Types.ObjectId, at(-101, 17, 0));
  audit(users.get('amelie')!, AuditAction.PosteCloture, AuditTargetType.JobPosition, positions.get('recruteur')!._id as Types.ObjectId, at(-69, 16, 30));

  return { departments, users, positions, passwords };
};

// ---------------------------------------------------------------------------
// The pipeline walk
// ---------------------------------------------------------------------------

/** Which stages a candidate must have passed through to be at `stage` now. */
const REACHED_CV_REVIEW: CandidateStage[] = [
  CandidateStage.PreselectionCvValidee,
  CandidateStage.RejeteCv,
  CandidateStage.EntretienPlanifie,
  CandidateStage.EvaluationCompletee,
  CandidateStage.Accepte,
  CandidateStage.Rejete,
];

interface InterviewRow {
  candidateId: Types.ObjectId;
  interviewerId: Types.ObjectId;
  scheduledAt: Date;
  status: InterviewStatus;
  cancellationReason?: string;
}

interface EvaluationRow {
  interviewIndex: number;
  scores: { technicalSkills: number; communication: number; overallFit: number };
  comments: string;
  submittedBy: Types.ObjectId;
}

const interviews: InterviewRow[] = [];
const evaluations: EvaluationRow[] = [];

const EVALUATION_COMMENTS = [
  "Échange technique solide. Le candidat structure bien ses réponses et sait dire ce qu'il ne connaît pas.",
  'Bonne compréhension du besoin métier. Quelques hésitations sur la partie technique, rattrapées à la fin.',
  "Profil à l'aise à l'oral, exemples concrets et bien choisis. Réserve sur la profondeur technique.",
  'Entretien très convaincant : réponses précises, prise de recul sur les projets passés, bonne écoute.',
  "Le candidat a peiné sur la mise en situation. Les bases sont là mais l'autonomie attendue n'y est pas encore.",
];

/**
 * Emits everything the pipeline services would have left behind for one
 * candidate: the audit entry per transition, the notification per transition,
 * the interview, the evaluation.
 *
 * The audit/notification mapping is taken from the services one for one:
 *  - CV review, scheduling, cancellation, evaluation and the final decision
 *    each write `EtapeCandidatModifiee` against the Candidate;
 *  - scheduling and cancellation ALSO write their own entry against the
 *    Interview (D-044 / D-046 — two facts, two entities);
 *  - the responsible recruiter is the notification recipient, except for
 *    scheduling (the interviewer, FR-42) and cancellation (both);
 *  - registration itself is NOT audited — there is no such AuditAction.
 */
const walkCandidate = (
  plan: CandidatePlan,
  candidateIndex: number,
  candidate: ICandidate,
  position: IJobPosition,
  users: Map<UserKey, IUser>,
): Date[] => {
  /**
   * Every action of a given kind happens at the same hour, so without this the
   * audit log's newest page is a block of rows sharing a timestamp to the
   * second — which reads as generated, and leaves the sort with nothing to
   * break ties on (the instability D-069 fixed in the database sorts).
   *
   * The offset is per CANDIDATE, not per event, so one application's own
   * events keep their relative order and the chronology check still means
   * something.
   */
  const on = (day: number, hour: number, minute: number): Date =>
    at(day, hour, (minute + candidateIndex * 7) % 60);

  const recruiter = users.get(plan.handledBy)!;
  // D-052's routing: the position's creator, falling back to whoever registered
  // the candidate.
  const responsible = [...users.values()].find((u) => String(u._id) === String(position.createdBy)) ?? recruiter;
  const candidateId = candidate._id as Types.ObjectId;
  const timeline: Date[] = [on(plan.registered, 8, 30)];

  const stageChange = (when: Date, message: string, alsoNotify?: IUser): void => {
    audit(recruiter, AuditAction.EtapeCandidatModifiee, AuditTargetType.Candidate, candidateId, when);
    notify([responsible, alsoNotify], NotificationType.ChangementEtape, message, when, recruiter);
    timeline.push(when);
  };

  // ---- FR-25: the CV review
  if (REACHED_CV_REVIEW.includes(plan.stage)) {
    const reviewedStage =
      plan.stage === CandidateStage.RejeteCv
        ? CandidateStage.RejeteCv
        : CandidateStage.PreselectionCvValidee;
    stageChange(
      on(plan.registered + 3, 11, 40),
      `La candidature de « ${plan.name} » est passée à l'étape « ${reviewedStage} ».`,
    );
  }

  // ---- FR-34: an interview that was scheduled and then cancelled
  if (plan.cancelled) {
    const interviewer = users.get(plan.interviewer!)!;
    // Every date below is derived from the ADJUSTED day, never from the raw
    // offset, so the booking still precedes the slot after the weekend nudge.
    const interviewDay = workingDay(plan.interviewAt!);
    // 17:00 deliberately: the standing interviews below take 09:00–16:00, so a
    // cancelled slot can never land inside FR-31's 30-minute conflict window
    // with one of them.
    const slot = at(interviewDay, 17, 0);
    // Same floor as the standing interviews below: the booking cannot predate
    // the CV review that has to come first. Without it the weekend nudge can
    // pull a slot two days earlier and drag the booking behind the review.
    const scheduledOn = on(Math.max(interviewDay - 4, plan.registered + 4), 10, 15);
    const cancelledOn = on(interviewDay - 1, 15, 30);

    const index = interviews.length;
    interviews.push({
      candidateId,
      interviewerId: interviewer._id as Types.ObjectId,
      scheduledAt: slot,
      status: InterviewStatus.Annule,
      cancellationReason: plan.cancelled,
    });

    audit(recruiter, AuditAction.EntretienPlanifie, AuditTargetType.Interview, interviewIdPlaceholder(index), scheduledOn);
    stageChange(
      scheduledOn,
      `Un entretien a été planifié pour « ${plan.name} » : la candidature passe à l'étape ` +
        `« ${CandidateStage.EntretienPlanifie} ».`,
    );
    notify(
      [interviewer],
      NotificationType.EntretienPlanifie,
      `Un entretien vous a été assigné avec « ${plan.name} » le ` +
        `${slot.toISOString().replace('T', ' à ').slice(0, 19)} (UTC).`,
      scheduledOn,
      recruiter,
    );

    audit(recruiter, AuditAction.EntretienAnnule, AuditTargetType.Interview, interviewIdPlaceholder(index), cancelledOn);
    stageChange(
      cancelledOn,
      `L'entretien avec « ${plan.name} » a été annulé : la candidature revient à l'étape ` +
        `« ${CandidateStage.PreselectionCvValidee} ».`,
      interviewer,
    );
  }

  // ---- FR-27 / FR-30: the interview that stands
  if (plan.interviewAt !== undefined && !plan.cancelled) {
    const interviewer = users.get(plan.interviewer!)!;
    const interviewDay = workingDay(plan.interviewAt);
    // A booked appointment lands on the quarter hour — the per-candidate
    // jitter above is for AUDIT timestamps, and an interview at 08:21 is the
    // tell that a date was computed rather than agreed with someone.
    const slot = at(interviewDay, 9 + (interviews.length % 8), 15 * (candidateIndex % 4));
    // Booked five days ahead of the slot — but never before the CV review that
    // has to precede it (the oldest applications were reviewed and interviewed
    // within the same week), and never in the future, because a slot still to
    // come was still BOOKED in the past.
    const scheduledOn = on(
      Math.min(Math.max(interviewDay - 5, plan.registered + 5), -1 - (interviews.length % 4)),
      10,
      45,
    );

    const index = interviews.length;
    interviews.push({
      candidateId,
      interviewerId: interviewer._id as Types.ObjectId,
      scheduledAt: slot,
      // D-048: submitting an evaluation is what flips an interview to
      // « Réalisé ». One that has been held but not evaluated stays
      // « Planifié », which is exactly what FR-46 counts as pending.
      status: plan.scores ? InterviewStatus.Realise : InterviewStatus.Planifie,
    });

    audit(recruiter, AuditAction.EntretienPlanifie, AuditTargetType.Interview, interviewIdPlaceholder(index), scheduledOn);
    stageChange(
      scheduledOn,
      `Un entretien a été planifié pour « ${plan.name} » : la candidature passe à l'étape ` +
        `« ${CandidateStage.EntretienPlanifie} ».`,
    );
    notify(
      [interviewer],
      NotificationType.EntretienPlanifie,
      `Un entretien vous a été assigné avec « ${plan.name} » le ` +
        `${slot.toISOString().replace('T', ' à ').slice(0, 19)} (UTC).`,
      scheduledOn,
      recruiter,
    );
    timeline.push(slot);

    // ---- FR-36 / FR-38: the evaluation
    if (plan.scores) {
      const submittedOn = on(interviewDay + 1, 12, 20);
      const evaluationIndex = evaluations.length;
      evaluations.push({
        interviewIndex: index,
        scores: {
          technicalSkills: plan.scores[0],
          communication: plan.scores[1],
          overallFit: plan.scores[2],
        },
        comments: EVALUATION_COMMENTS[index % EVALUATION_COMMENTS.length],
        submittedBy: interviewer._id as Types.ObjectId,
      });

      audit(interviewer, AuditAction.EvaluationSoumise, AuditTargetType.InterviewEvaluation, evaluationIdPlaceholder(evaluationIndex), submittedOn);
      audit(interviewer, AuditAction.EtapeCandidatModifiee, AuditTargetType.Candidate, candidateId, submittedOn);
      // FR-40 and FR-41 are ONE notification, of the more specific type.
      notify(
        [responsible],
        NotificationType.EvaluationSoumise,
        `Une évaluation a été soumise pour « ${plan.name} » : la candidature passe à l'étape ` +
          `« ${CandidateStage.EvaluationCompletee} ».`,
        submittedOn,
        interviewer,
      );
      timeline.push(submittedOn);
    }

    // ---- FR-29 / FR-39: the final decision, taken by the responsable
    if (plan.concluded !== undefined) {
      const decidedOn = on(plan.concluded, 16, 10);
      audit(interviewer, AuditAction.EtapeCandidatModifiee, AuditTargetType.Candidate, candidateId, decidedOn);
      notify(
        [responsible],
        NotificationType.ChangementEtape,
        `Décision finale pour « ${plan.name} » : la candidature passe à l'étape « ${plan.stage} ».`,
        decidedOn,
        interviewer,
      );
      timeline.push(decidedOn);
    }
  }

  return timeline;
};

/**
 * Interviews and evaluations are inserted in one batch AFTER the walk, so
 * their ids do not exist while the audit entries pointing at them are being
 * built. Each entry gets a placeholder, rewritten once the real ids are known.
 * A placeholder left unrewritten is a dangling audit target, which is what
 * `selfCheck` looks for.
 *
 * The two kinds are kept apart because they resolve against different
 * collections: `EntretienPlanifie` and `EntretienAnnule` point at the
 * Interview, while `EvaluationSoumise` points at the EVALUATION's own id —
 * `evaluation.service.ts` is explicit about that, and pointing it at the
 * interview would put a target the audit page cannot resolve into the trail.
 */
const INTERVIEW_IDS: Types.ObjectId[] = [];
const EVALUATION_IDS: Types.ObjectId[] = [];

const placeholder = (store: Types.ObjectId[], index: number): Types.ObjectId => {
  while (store.length <= index) {
    store.push(new Types.ObjectId());
  }
  return store[index];
};

const interviewIdPlaceholder = (index: number): Types.ObjectId => placeholder(INTERVIEW_IDS, index);
const evaluationIdPlaceholder = (index: number): Types.ObjectId => placeholder(EVALUATION_IDS, index);

// ---------------------------------------------------------------------------
// Checks that fail the run rather than shipping a quietly wrong fixture
// ---------------------------------------------------------------------------

const selfCheck = (
  timelines: Map<string, Date[]>,
  users: Map<UserKey, IUser>,
  positions: Map<PositionKey, IJobPosition>,
): void => {
  const problems: string[] = [];

  // 1. Every candidate's own history runs forwards.
  for (const [name, timeline] of timelines) {
    for (let i = 1; i < timeline.length; i += 1) {
      if (timeline[i] < timeline[i - 1]) {
        problems.push(
          `${name}: l'événement ${i} (${timeline[i].toISOString()}) précède le précédent ` +
            `(${timeline[i - 1].toISOString()}).`,
        );
      }
    }
  }

  // 2. FR-30 — the interviewer belongs to the job position's department.
  for (const plan of CANDIDATES) {
    if (!plan.interviewer) continue;
    const interviewer = users.get(plan.interviewer)!;
    const position = positions.get(plan.position)!;
    if (interviewer.role !== Role.ResponsableHierarchique) {
      problems.push(`${plan.name}: ${interviewer.name} n'est pas responsable hiérarchique.`);
    }
    if (String(interviewer.departmentId) !== String(position.department)) {
      problems.push(
        `${plan.name}: ${interviewer.name} n'appartient pas au département du poste « ${position.title} ».`,
      );
    }
  }

  // 3. FR-31 / D-005 — no interviewer has two slots inside 30 minutes.
  const THIRTY_MINUTES = 30 * 60 * 1000;
  for (let i = 0; i < interviews.length; i += 1) {
    for (let j = i + 1; j < interviews.length; j += 1) {
      if (String(interviews[i].interviewerId) !== String(interviews[j].interviewerId)) continue;
      const gap = Math.abs(interviews[i].scheduledAt.getTime() - interviews[j].scheduledAt.getTime());
      if (gap < THIRTY_MINUTES) {
        problems.push(
          `Conflit de créneau : deux entretiens du même évaluateur à ` +
            `${interviews[i].scheduledAt.toISOString()} et ${interviews[j].scheduledAt.toISOString()}.`,
        );
      }
    }
  }

  // 4. No interview booked for a Saturday or a Sunday. The offsets are
  //    relative, so this depends on the day the seed is run — which is exactly
  //    why it is asserted rather than eyeballed once.
  for (const interview of interviews) {
    const weekday = interview.scheduledAt.getDay();
    if (weekday === 0 || weekday === 6) {
      problems.push(`Entretien planifié un week-end : ${interview.scheduledAt.toISOString()}.`);
    }
  }

  // 5. FR-16 — no candidate registered against a draft posting.
  for (const plan of CANDIDATES) {
    if (positions.get(plan.position)!.status === JobPositionStatus.Brouillon) {
      problems.push(`${plan.name}: rattaché à un poste en brouillon.`);
    }
  }

  // 6. Every audit entry points at a row that will actually be inserted.
  const knownInterviews = new Set(interviews.map((_, index) => String(INTERVIEW_IDS[index])));
  const knownEvaluations = new Set(evaluations.map((_, index) => String(EVALUATION_IDS[index])));
  for (const entry of audits) {
    const expected =
      entry.targetType === AuditTargetType.Interview
        ? knownInterviews
        : entry.targetType === AuditTargetType.InterviewEvaluation
          ? knownEvaluations
          : null;
    if (expected && !expected.has(String(entry.targetId))) {
      problems.push(`Entrée d'audit ${entry.action} pointant sur un ${entry.targetType} inexistant.`);
    }
  }

  if (problems.length > 0) {
    throw new Error(`Le jeu de données est incohérent :\n  - ${problems.join('\n  - ')}`);
  }
};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const MODELS: Array<{ createIndexes: () => Promise<unknown> }> = [
  Department,
  User,
  JobPosition,
  Candidate,
  Interview,
  InterviewEvaluation,
  AuditLog,
  Notification,
];

const run = async (): Promise<void> => {
  if (!process.argv.includes('--force')) {
    throw new Error(
      'Ce script SUPPRIME la base de données avant de la recharger.\n' +
        'Relancez-le avec --force si c\'est bien ce que vous voulez :\n' +
        '  npm run seed -- --force',
    );
  }

  const uri = process.env.MONGO_URI;
  if (!uri) {
    throw new Error('MONGO_URI est absent. Copiez backend/.env.example vers backend/.env.');
  }

  await mongoose.connect(uri);
  const name = mongoose.connection.name;

  // The full wipe (Phase 4.2): dropping the database rather than deleting
  // fixture families one by one, so nothing survives to collide on the next
  // run. Dropping takes the INDEXES with it — including the two uniqueness
  // constraints the application relies on (User.email, one evaluation per
  // interview) — so they are rebuilt explicitly. Without this the reseed
  // succeeds against a database that has quietly lost them.
  await mongoose.connection.dropDatabase();
  await Promise.all(MODELS.map((model) => model.createIndexes()));
  console.log(`[seed] base « ${name} » vidée, index reconstruits.`);

  const { departments, users, positions, passwords } = await seedOrganisation();

  // ---- Candidates
  const timelines = new Map<string, Date[]>();
  const backdate: Array<{ id: Types.ObjectId; registeredAt: Date; decidedAt?: Date }> = [];

  for (const [index, plan] of CANDIDATES.entries()) {
    const position = positions.get(plan.position)!;
    const handler = users.get(plan.handledBy)!;

    const candidate = await Candidate.create({
      fullName: plan.name,
      email: `${slug(plan.name)}@${MAILBOXES[index % MAILBOXES.length]}`,
      phone: phoneFor(index),
      jobPositionId: position._id,
      currentStage: plan.stage,
      registeredBy: handler._id,
      rejectionReason: plan.rejectionReason,
      decisionComment: plan.decisionComment,
    });

    timelines.set(plan.name, walkCandidate(plan, index, candidate, position, users));
    backdate.push({
      id: candidate._id as Types.ObjectId,
      // Same per-candidate offset the walk applies, so `registeredAt` and the
      // audit trail agree on when the application arrived.
      registeredAt: at(plan.registered, 8, (30 + index * 7) % 60),
      decidedAt:
        plan.concluded === undefined ? undefined : at(plan.concluded, 16, (10 + index * 7) % 60),
    });
  }

  selfCheck(timelines, users, positions);

  // `registeredAt` is stamped by a pre-validate hook and `decidedAt` is
  // set-once immutable (D-018 / D-058), so neither can be given a historical
  // value through Mongoose. This is the ONE place the ODM is bypassed, and it
  // touches only those two fields.
  await Candidate.collection.bulkWrite(
    backdate.map((row) => ({
      updateOne: {
        filter: { _id: row.id },
        update: {
          $set: row.decidedAt
            ? { registeredAt: row.registeredAt, decidedAt: row.decidedAt }
            : { registeredAt: row.registeredAt },
        },
      },
    })),
  );

  // ---- Interviews, then the evaluations that point at them
  const insertedInterviews = await Interview.insertMany(interviews);
  const realInterviewIds = insertedInterviews.map((interview) => interview._id as Types.ObjectId);

  const insertedEvaluations = await InterviewEvaluation.insertMany(
    evaluations.map((evaluation) => ({
      interviewId: realInterviewIds[evaluation.interviewIndex],
      scores: evaluation.scores,
      comments: evaluation.comments,
      submittedBy: evaluation.submittedBy,
    })),
  );

  // Rewrite the placeholders now that the real ids exist.
  const resolved = new Map<string, Types.ObjectId>([
    ...INTERVIEW_IDS.map((id, index): [string, Types.ObjectId] => [String(id), realInterviewIds[index]]),
    ...EVALUATION_IDS.map((id, index): [string, Types.ObjectId] => [
      String(id),
      insertedEvaluations[index]._id as Types.ObjectId,
    ]),
  ]);
  for (const entry of audits) {
    const real = resolved.get(String(entry.targetId));
    if (real) {
      entry.targetId = real;
    }
  }

  await AuditLog.insertMany(audits);
  await Notification.insertMany(notifications);

  // ---- What was written
  const counts = {
    départements: await Department.countDocuments(),
    utilisateurs: await User.countDocuments(),
    postes: await JobPosition.countDocuments(),
    candidats: await Candidate.countDocuments(),
    entretiens: await Interview.countDocuments(),
    évaluations: await InterviewEvaluation.countDocuments(),
    "entrées d'audit": await AuditLog.countDocuments(),
    notifications: await Notification.countDocuments(),
  };

  console.log('\n[seed] jeu de démonstration écrit :');
  for (const [label, count] of Object.entries(counts)) {
    console.log(`  ${label.padEnd(18)} ${count}`);
  }

  console.log(
    '\n[seed] AUCUN CV : un CV vit chez Cloudinary (D-040) et une ligne Resume sans fichier\n' +
      "       derrière donnerait un bouton « Télécharger le CV » qui échoue. Le parcours\n" +
      '       FR-21/FR-22 se démontre en téléversant un fichier depuis l\'interface.',
  );

  // ---- The one-time disclosure
  console.log('\n' + '='.repeat(78));
  console.log('IDENTIFIANTS — AFFICHÉS UNE SEULE FOIS, ILS NE SONT STOCKÉS QUE HACHÉS.');
  if (chosenPassword()) {
    console.log('Mot de passe COMMUN fourni via --password : pratique pour une démo,');
    console.log('à ne pas réutiliser ailleurs. Omettez --password pour en générer un par compte.');
  } else {
    console.log('Copiez-les maintenant : seule une nouvelle exécution du script peut les remplacer.');
  }
  console.log('='.repeat(78));

  const width = Math.max(...passwords.map(({ user }) => user.email.length));
  for (const role of [Role.Administrateur, Role.Recruteur, Role.ResponsableHierarchique]) {
    console.log(`\n  ${role}`);
    for (const { user, password } of passwords.filter((entry) => entry.user.role === role)) {
      const flags = [
        user.isActive ? null : 'compte désactivé (FR-8)',
        user.mustChangePassword ? 'changement de mot de passe imposé (FR-10)' : null,
      ].filter(Boolean);
      console.log(
        `    ${user.email.padEnd(width)}  ${password}` + (flags.length ? `   ← ${flags.join(', ')}` : ''),
      );
    }
  }
  console.log('\n' + '='.repeat(78) + '\n');

  await mongoose.disconnect();
};

run().catch(async (error: unknown) => {
  console.error(`\n[seed] échec : ${error instanceof Error ? error.message : String(error)}`);
  await mongoose.disconnect().catch(() => undefined);
  process.exitCode = 1;
});
