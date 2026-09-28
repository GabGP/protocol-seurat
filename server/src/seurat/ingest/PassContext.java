package seurat.ingest;

import java.util.Deque;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Future;
import seurat.store.FileBrushStore;

/**
 * What one pass shares between its drains: the accumulators, the store, and two executors. The
 * pool encodes brushes (the bulk of the CPU); the lane runs the short steps the pass waits on
 * (row conversion and the S transform), so they never queue behind hundreds of brush encodes.
 */
record PassContext(int top, Accumulator[] acc, FileBrushStore store, ExecutorService pool,
        ExecutorService lane, Deque<Future<?>> tasks, List<short[][]> seed, int[] drainCounts) {

    /** Runs every job on the lane and waits for all of them. */
    void onLane(List<java.util.concurrent.Callable<Object>> jobs) {
        try {
            for (Future<Object> f : lane.invokeAll(jobs)) {
                f.get();
            }
        } catch (Exception ex) {
            throw new RuntimeException(ex);
        }
    }
}
