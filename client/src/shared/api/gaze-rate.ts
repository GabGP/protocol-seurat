import { GAZE_PER_S, MS_PER_S } from '../config/constants';

/** At most GAZE_PER_S moving MIRADAs per second (spec 3.2): the server would drop the rest. */
export class GazeRate {
  private times: number[] = [];

  /** True when one more may go now; it then counts as sent. */
  allow(now: number): boolean {
    this.times = this.times.filter((t) => now - t < MS_PER_S);
    if (this.times.length >= GAZE_PER_S) return false;
    this.times.push(now);
    return true;
  }
}
