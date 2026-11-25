import reducer, { giftTasksPageLoading, giftTasksPageReceived } from './giftTasksSlice';
import type { GiftTask } from '@app-types/game';

function makeTasks(startId: number, count: number): GiftTask[] {
  return Array.from({ length: count }, (_, i) => ({
    id: startId + i,
    priority: startId + i,
    enabled: 1,
    cash: 0,
    productname: `Gift ${startId + i}`,
    productdetail: '',
    product_pic: '',
    money: '0.00',
    product_value: '0.00',
    total_qty: 10,
    current_qty: 10,
    plus_level: 1,
    productlinks: '',
    created_at: '2026-10-01T10:00:00.000Z',
  }));
}

describe('giftTasksSlice', () => {
  it('appends later pages and stops when a page is short', () => {
    let state = reducer(undefined, giftTasksPageLoading());
    expect(state.loadingPage).toBe(true);

    state = reducer(state, giftTasksPageReceived({ page: 0, tasks: makeTasks(1, 10) }));
    expect(state.giftTasks).toHaveLength(10);
    expect(state.hasMore).toBe(true);
    expect(state.nextPage).toBe(1);
    expect(state.loadingPage).toBe(false);

    state = reducer(state, giftTasksPageReceived({ page: 1, tasks: makeTasks(11, 3) }));
    expect(state.giftTasks?.map((t) => t.id)).toEqual([...Array(13).keys()].map((i) => i + 1));
    expect(state.hasMore).toBe(false);
    expect(state.nextPage).toBe(2);
  });

  it('page 0 replaces the loaded list', () => {
    let state = reducer(undefined, giftTasksPageReceived({ page: 0, tasks: makeTasks(1, 10) }));
    state = reducer(state, giftTasksPageReceived({ page: 1, tasks: makeTasks(11, 10) }));
    state = reducer(state, giftTasksPageReceived({ page: 0, tasks: makeTasks(100, 2) }));
    expect(state.giftTasks?.map((t) => t.id)).toEqual([100, 101]);
    expect(state.nextPage).toBe(1);
    expect(state.hasMore).toBe(false);
  });
});
