export async function waitForDashboardRender(ready: () => boolean, signal?: AbortSignal): Promise<void> {
  const deadline = Date.now() + 30000;
  while (!ready()) {
    signal?.throwIfAborted();
    if (Date.now() >= deadline) throw new Error('Dashboard is not ready');
    await new Promise<void>(resolve => setTimeout(resolve, 50));
  }
  signal?.throwIfAborted();
  await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  signal?.throwIfAborted();
}