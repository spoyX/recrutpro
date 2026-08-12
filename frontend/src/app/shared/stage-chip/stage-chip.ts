import { Component, computed, input } from '@angular/core';

/**
 * A pipeline-stage badge.
 *
 * DESIGN.md: "Chips/Badges … Use low-saturation background tints with
 * high-saturation text of the same hue for maximum professional clarity", at
 * `rounded.sm` (4px, the small-element radius).
 *
 * The seven stages are ARCHITECTURE.md Section 8's fixed pipeline and are
 * never renamed here — the value arrives from the API and is displayed as-is.
 *
 * COLOUR NOTE: DESIGN.md's palette contains NO success green. Rather than
 * invent one (rule 8 forbids inventing a visual style), « Accepté » uses the
 * strong brand primary as the positive terminal state and rejections use the
 * error role. Flagged for the human.
 */
type StageTone = 'neutral' | 'info' | 'progress' | 'attention' | 'positive' | 'negative';

const TONES: Record<string, StageTone> = {
  'Candidature reçue': 'neutral',
  'Présélection CV validée': 'info',
  'Entretien planifié': 'progress',
  'Évaluation complétée': 'attention',
  Accepté: 'positive',
  Rejeté: 'negative',
  'Rejeté (CV)': 'negative',
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
    .chip--neutral {
      background-color: var(--mat-sys-surface-container-high);
      color: var(--mat-sys-on-surface-variant);
    }
    .chip--info {
      background-color: var(--mat-sys-secondary-fixed);
      color: var(--mat-sys-on-secondary-fixed-variant);
    }
    .chip--progress {
      background-color: var(--mat-sys-primary-fixed);
      color: var(--mat-sys-on-primary-fixed-variant);
    }
    .chip--attention {
      background-color: var(--mat-sys-tertiary-fixed);
      color: var(--mat-sys-on-tertiary-fixed-variant);
    }
    .chip--positive {
      background-color: var(--mat-sys-primary-fixed-dim);
      color: var(--mat-sys-on-primary-fixed);
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
