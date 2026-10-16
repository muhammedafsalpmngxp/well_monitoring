import { Component, OnInit, ViewEncapsulation } from '@angular/core';
import { Router } from '@angular/router';

interface MyBoard {
  id: string;
  name: string;
  description: string;
  icon: 'donut' | 'grid';
  /** Angular route, for boards backed by a dedicated page. */
  route?: string;
  /** dbDashboards id, for custom boards opened via the board switcher (view mode). */
  legacyId?: number;
}

@Component({
  selector: 'app-myboards',
  templateUrl: './myboards.component.html',
  styleUrls: ['./myboards.component.scss'],
  encapsulation: ViewEncapsulation.None
})
export class MyBoardsComponent implements OnInit {

  constructor(private router: Router) {}

  boards: MyBoard[] = [
    {
      id: 'well-delivery-status',
      name: 'Well Delivery Status',
      description: 'Well delivery progress and status tracking.',
      route: '/welldeliverystatus',
      icon: 'donut'
    }
  ];

  ngOnInit(): void {
    const w = window as any;
    if (typeof w.dbGetMyBoardsList === 'function') {
      const dynamic: MyBoard[] = w.dbGetMyBoardsList().map((d: { id: number; name: string }) => ({
        id: 'board-' + d.id,
        name: d.name,
        description: 'Custom board created from BI Boards.',
        legacyId: d.id,
        icon: 'grid' as const
      }));
      this.boards = [...this.boards, ...dynamic];
    }
  }

  open(board: MyBoard): void {
    if (board.legacyId != null) {
      const w = window as any;
      if (typeof w.dvsOpenBoard === 'function') w.dvsOpenBoard(board.legacyId);
      return;
    }
    if (board.route) this.router.navigate([board.route]);
  }
}
