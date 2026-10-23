import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { ROUTES } from '../constants/route.constants';
import { AskAiPanelService } from '../services/ask-ai-panel.service';

/**
 * A scheduled insight mail links to /ask-ai/answers/{messageId}. The answer has no page of its own: open the Ask AI
 * panel on the chat that holds it, over the dashboard.
 */
export const askAiAnswerLinkGuard: CanActivateFn = route => {
  const router = inject(Router);
  const id = Number(route.paramMap.get('id'));
  if (Number.isInteger(id) && id > 0) inject(AskAiPanelService).openAnswer(id);
  return router.createUrlTree([`/${ROUTES.DASHBOARD}`]);
};
