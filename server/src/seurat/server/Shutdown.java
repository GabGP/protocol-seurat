package seurat.server;

import java.io.Closeable;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.BooleanSupplier;
import seurat.config.SeuratConstants;
import seurat.observe.Log;
import seurat.paint.Painter;
import seurat.proto.Frame;
import seurat.proto.FrameType;
import seurat.proto.MsgGoodbye;
import seurat.session.Session;
import seurat.session.Sessions;

/**
 * Ctrl+C / SIGTERM: quiesce intake, drain paint, close sessions, stop pools.
 * Running ingest finishes (or fails ST_FALLIDA, resumable); paint gets one
 * bounded window to flush to still-connected clients before they are closed.
 */
public final class Shutdown implements Runnable {
    private final Closeable listener;
    private final Closeable intake;
    private final Sessions sessions;
    private final ScheduledExecutorService clock;
    private final ExecutorService ingest;
    private final Painter painter;
    private final Thread painterThread;
    private final AtomicBoolean done = new AtomicBoolean();

    public Shutdown(Closeable listener, Closeable intake, Sessions sessions,
            ScheduledExecutorService clock, ExecutorService ingest,
            Painter painter, Thread painterThread) {
        this.listener = listener;
        this.intake = intake;
        this.sessions = sessions;
        this.clock = clock;
        this.ingest = ingest;
        this.painter = painter;
        this.painterThread = painterThread;
    }

    /** Registers the JVM hook; the hook runs on Ctrl+C (SIGINT) and SIGTERM. */
    public void arm() {
        Runtime.getRuntime().addShutdownHook(new Thread(this, "seurat-shutdown"));
    }

    @Override
    public void run() {
        if (!done.compareAndSet(false, true)) return;
        Log.info("server", "Shutdown requested, stopping intake and listener");
        try {
            intake.close();
        } catch (Exception ex) {
            Log.debug("server", "Intake close: " + ex.getMessage());
        }
        ingest.shutdown();
        try {
            listener.close();
        } catch (Exception ex) {
            Log.debug("server", "Listener close: " + ex.getMessage());
        }
        clock.shutdown();
        Log.info("server", "Draining in-flight paint");
        drainIdle(painter::isIdle, SeuratConstants.SHUTDOWN_POLL_MS,
                TimeUnit.SECONDS.toNanos(SeuratConstants.SHUTDOWN_TIMEOUT_S));
        Log.info("server", "Closing sessions");
        byte[] adios = new Frame(FrameType.ADIOS, new MsgGoodbye(0, "apagado").encode()).encode();
        for (Session session : sessions.all()) {
            try {
                session.mapping().sendControl(adios); // orderly close (spec 3.3): books stay L + delta
                session.mapping().close();
            } catch (Exception ex) {
                Log.debug("server", "Session " + session.id() + " close: " + ex.getMessage());
            }
        }
        painterThread.interrupt();
        await(clock);
        await(ingest);
        Log.info("server", "Shutdown complete");
    }

    /** Polls idle until the deadline; ShutdownTest drives it with fake suppliers. */
    static void drainIdle(BooleanSupplier idle, long pollMs, long timeoutNs) {
        long deadline = System.nanoTime() + timeoutNs;
        while (System.nanoTime() < deadline) {
            if (idle.getAsBoolean()) return;
            try {
                Thread.sleep(pollMs);
            } catch (InterruptedException ex) {
                Thread.currentThread().interrupt();
                return;
            }
        }
    }

    private static void await(ExecutorService pool) {
        try {
            if (!pool.awaitTermination(SeuratConstants.SHUTDOWN_TIMEOUT_S, TimeUnit.SECONDS)) {
                pool.shutdownNow();
            }
        } catch (InterruptedException ex) {
            pool.shutdownNow();
            Thread.currentThread().interrupt();
        }
    }
}
