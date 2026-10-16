import { HttpErrorResponse } from '@angular/common/http';
import { Observable, Subject, Subscription, catchError, debounceTime, map, of, switchMap } from 'rxjs';
import { FormulaCheck } from '../../core/services/model-studio.service';
import { apiErrorMessage } from './model-studio.util';

export const CHECK_DELAY_MS = 400;

interface Checked { key: string; problem: string; kind: FormulaCheck['kind'] | null; }

/**
 * Asks the server whether a formula would save, while the modeller types: the same checks as Save, so a
 * number passed to UPPER or a column the table cannot reach shows before Save. The newest formula wins,
 * and a formula already asked about is not asked again, so change detection cannot start a loop.
 */
export class LiveFormulaCheck {
  /** The server's reason the formula would be refused, or empty. */
  problem = '';
  /** The kind of value the formula gives, once it passed. */
  kind: FormulaCheck['kind'] | null = null;

  private asked: string | null = null;
  private readonly formulas = new Subject<{ key: string; run: () => Observable<FormulaCheck> }>();
  private readonly subscription: Subscription;

  constructor(done: () => void, delay = CHECK_DELAY_MS) {
    this.subscription = this.formulas.pipe(
      debounceTime(delay),
      switchMap(({ key, run }) => run().pipe(
        map((check): Checked => ({ key, problem: '', kind: check.kind })),
        // Only a refusal of the formula is shown; an outage or a lost session stays for Save to report.
        catchError((error: unknown) => of<Checked>({ key, problem: refusal(error), kind: null })),
      )),
    ).subscribe(checked => {
      if (checked.key !== this.asked) return;
      this.problem = checked.problem;
      this.kind = checked.kind;
      done();
    });
  }

  /** key identifies the formula, name and table; null means there is nothing complete to check yet. */
  update(key: string | null, run: () => Observable<FormulaCheck>): void {
    if (key === this.asked) return;
    this.asked = key;
    this.problem = '';
    this.kind = null;
    if (key !== null) this.formulas.next({ key, run });
  }

  destroy(): void {
    this.subscription.unsubscribe();
  }
}

function refusal(error: unknown): string {
  const status = error instanceof HttpErrorResponse ? error.status : 0;
  return status === 400 || status === 409 || status === 422 ? apiErrorMessage(error, '') : '';
}
