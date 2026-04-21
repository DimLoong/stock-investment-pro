export class AutoRefreshService {
  private timer: NodeJS.Timeout | undefined;

  start(task: () => void, interval: number): void {
    this.stop();
    this.timer = setInterval(task, interval);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }
}
