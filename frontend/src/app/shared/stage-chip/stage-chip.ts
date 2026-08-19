import { Component, computed, input } from '@angular/core';

/**
 * A status badge — pipeline stages (Section 8) and job-position statuses
 * (FR-14/FR-16), which are two vocabularies of the same thing.
 *
 * DESIGN.md: "Chips/Badges … Use low-saturation background tints with
 * high-saturation text of the same hue for maximum professional clarity", at
 * `rounded.sm` (4px, the small-element radius).
 *
 * The seven stages are ARCHITECTURE.md Section 8's fixed pipeline and are
 * never renamed here — the value arrives from the API and is displayed as-is.
 *
 * COLOUR NOTE (D-066): « Accepté » uses DESIGN.md's `success` role, added on
 * 2026-08-13 at the human's instruction. It previously borrowed the brand
 * primary, because the palette had no positive-terminal colour and rule 8
 * forbids inventing one — so the colour was added to DESIGN.md FIRST and is
 * consumed from there here, rather than being invented at the point of use.
 * `success` and `error` are counterparts and are applied identically.
 *
 * COLOUR NOTE (D-080): the `attention` tone moved to `tertiary-fixed-dim` on
 * 2026-08-14 for the same reason and by the same route — DESIGN.md first. This
 * component owns BOTH vocabularies, which is exactly why a collision between
 * two of its tones is a collision on a real screen rather than a theoretical
 * one: `chip--attention` and `chip--negative` were 7 channel-units apart and
 * rendered side by side.
 *
 * COLOUR NOTE (D-103): `progress` moved to `primary-fixed-dim` and `neutral` to
 * `outline-variant` on 2026-08-19, again DESIGN.md first. An external audit
 * found `info`/`progress` 4 units apart; measuring ALL FIFTEEN pairs rather
 * than the reported one found two more, `neutral`/`info` at 7 and
 * `neutral`/`progress` at 8. D-080 introduced the 32-unit floor and then
 * checked it only against the pair it was changing, which is how two
 * collisions survived the fix that created the rule. The whole set now clears
 * 32, worst pair 33, every text tone still past 4.5:1.
 */
type StageTone = 'neutral' | 'info' | 'progress' | 'attention' | 'positive' | 'negative';

const TONES: Record<string, StageTone> = {
  // ARCHITECTURE.md Section 8's seven pipeline stages.
  'Candidature reçue': 'neutral',
  'Présélection CV validée': 'info',
  'Entretien planifié': 'progress',
  'Évaluation complétée': 'attention',
  Accepté: 'positive',
  Rejeté: 'negative',
  'Rejeté (CV)': 'negative',

  // FR-14/FR-16 job-position statuses. Added rather than duplicating this
  // component: the job is identical — render a labelled status with a tone —
  // and the three values cannot collide with a pipeline stage.
  // NOT 'positive': D-066 reserves `success` for a settled positive OUTCOME,
  // and an open posting is an ongoing state, not a good result.
  Brouillon: 'neutral',
  Ouvert: 'info',
  Clôturé: 'attention',
};

@Component({
  selector: 'app-stage-chip',
  template: `<span class="chip" [class]="'chip--' + tone()">{{ stage() }}</span>`,
  styles: `
    .chip {
      display: inline-block;
      padding: 2px var(--sp-sm);
      border-radius: var(--radius-sm);
      font: var(--mat-sys-label-small);
      letter-spacing: var(--recrutpro-tracking-label-sm);
      text-transform: uppercase;
      white-space: nowrap;
    }
    // Low-saturation tint, high-saturation text of the SAME hue.
    // D-103: was surface-container-high, which sat 7 units from info and 8 from
    // progress. outline-variant is 40 from both, and a status meaning "nothing
    // has happened yet" reads better as a true grey than as a third pale blue.
    .chip--neutral {
      background-color: var(--mat-sys-outline-variant);
      color: var(--mat-sys-on-surface-variant);
    }
    .chip--info {
      background-color: var(--mat-sys-secondary-fixed);
      color: var(--mat-sys-on-secondary-fixed-variant);
    }
    // D-103: was primary-fixed (#dce1ff), FOUR channel-units from info's
    // secondary-fixed (#d8e2ff) — the two rendered as one colour in the same
    // Etape column. primary-fixed-dim is 33 units away and still the primary
    // hue, so "in progress" keeps reading as the brand-blue family.
    .chip--progress {
      background-color: var(--mat-sys-primary-fixed-dim);
      color: var(--mat-sys-on-primary-fixed-variant);
    }
    // DESIGN.md's ATTENTION role: tertiary-fixed-dim, NOT tertiary-fixed. That
    // tone sat 7 channel-units from error-container and the two rendered as one
    // colour on screens showing both — « Clôturé » above « Rejeté (CV) » on a
    // position's file, « Évaluation complétée » beside « Rejeté » in the
    // candidate list. Decided in DESIGN.md first (D-080), consumed here.
    // NOTE: no backticks in this styles literal — they close it.
    .chip--attention {
      background-color: var(--mat-sys-tertiary-fixed-dim);
      color: var(--mat-sys-on-tertiary-fixed-variant);
    }
    // The positive/negative pair are deliberately symmetrical: container tint
    // as background, on-container tone as text. Both are terminal outcomes and
    // should read as the same KIND of thing, differing only in hue.
    .chip--positive {
      background-color: var(--recrutpro-success-container);
      color: var(--recrutpro-on-success-container);
    }
    .chip--negative {
      background-color: var(--mat-sys-error-container);
      color: var(--mat-sys-on-error-container);
    }
  `,
})
export class StageChip {
  readonly stage = input.required<string>();

  /** Unknown stages fall back to neutral rather than rendering unstyled. */
  readonly tone = computed<StageTone>(() => TONES[this.stage()] ?? 'neutral');
}
