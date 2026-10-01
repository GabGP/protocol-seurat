package seurat.boot;

import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import seurat.core.shared.config.SeuratConstants;
import seurat.core.shared.observe.Log;
import seurat.core.shared.observe.LogTags;
import seurat.core.shared.observe.LogUnits;
import seurat.core.viewing.grant.GazeGate;
import seurat.core.viewing.grant.Liveness;
import seurat.core.viewing.session.Regulator;
import seurat.core.viewing.session.Sessions;

/** The server's fixed-rate ticks on one scheduler; a failing tick never cancels its schedule. */
public final class Timers {
    private Timers() {}

    public static ScheduledExecutorService start(Regulator regulator, Sessions sessions, Liveness liveness,
            DiskReaper reaper, GazeGate gazes) {
        ScheduledExecutorService clock = Executors.newSingleThreadScheduledExecutor();
        clock.scheduleAtFixedRate(() -> regulator.tick(sessions.all()), SeuratConstants.CODEL_TICK_MS,
                SeuratConstants.CODEL_TICK_MS, TimeUnit.MILLISECONDS);
        clock.scheduleAtFixedRate(guarded(liveness::tick), 1, 1, TimeUnit.SECONDS);
        clock.scheduleAtFixedRate(guarded(reaper::sweep), 1, 1, TimeUnit.SECONDS);
        clock.scheduleAtFixedRate(guarded(gazes::tick), SeuratConstants.GAZE_TICK_MS,
                SeuratConstants.GAZE_TICK_MS, TimeUnit.MILLISECONDS);
        clock.scheduleAtFixedRate(guarded(() -> Broadcast.heartbeat(sessions)), SeuratConstants.HEARTBEAT_S,
                SeuratConstants.HEARTBEAT_S, TimeUnit.SECONDS);
        return clock;
    }

    /** A failing tick must not cancel its schedule. */
    private static Runnable guarded(Runnable tick) {
        return () -> {
            try {
                tick.run();
            } catch (Throwable ex) {
                Log.error(LogTags.SERVER, "timer tick failed: " + LogUnits.cause(ex), ex);
            }
        };
    }
}
