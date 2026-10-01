package seurat.boot;

import java.io.Closeable;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.concurrent.Executor;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import seurat.adapters.in.inbox.InboxWatcher;
import seurat.adapters.in.inbox.MasterIntake;
import seurat.adapters.in.net.socket.RecordingMapping;
import seurat.adapters.in.net.socket.SocketServer;
import seurat.adapters.out.decode.Decoders;
import seurat.core.shared.config.SeuratConfig;
import seurat.core.shared.observe.Metrics;
import seurat.core.viewing.budget.BrushBudget;
import seurat.core.viewing.paint.Painter;
import seurat.core.viewing.session.Regulator;
import seurat.core.viewing.session.Session;
import seurat.core.viewing.session.Sessions;
import seurat.core.works.catalog.Catalog;
import seurat.kit.TestKit;

/** Shutdown: quiesce intake, drain paint, close sessions, stop pools. */
public final class ShutdownTest {
    public static void main(String[] args) throws Exception {
        closesAll();
        idempotent();
        listenerStops();
        drainReturnsWhenIdle();
        drainHitsDeadline();
        intakeStopsOffers();
        watcherStops();
        System.out.println("ShutdownTest OK");
    }

    private static void closesAll() throws Exception {
        FakeListener listener = new FakeListener();
        FakeListener intake = new FakeListener();
        Sessions sessions = new Sessions();
        RecordingMapping a = new RecordingMapping();
        RecordingMapping b = new RecordingMapping();
        sessions.add(new Session(1, "p", "anonimo", 128, 0, a, new byte[32]));
        sessions.add(new Session(2, "p", "anonimo", 128, 0, b, new byte[32]));
        ScheduledExecutorService clock = Executors.newSingleThreadScheduledExecutor();
        ExecutorService ingest = Executors.newSingleThreadExecutor();
        Painter painter = testPainter();
        AtomicBoolean interrupted = new AtomicBoolean();
        Thread painterThread = new Thread(() -> {
            try {
                Thread.sleep(60_000);
            } catch (InterruptedException ex) {
                interrupted.set(true);
            }
        });
        painterThread.start();
        new Shutdown(listener, intake, sessions, clock, ingest, painter, painterThread).run();
        painterThread.join(3_000);
        TestKit.check(listener.closes == 1, "listener closed once");
        TestKit.check(intake.closes == 1, "intake closed once");
        TestKit.check(a.closed && b.closed, "sessions closed");
        TestKit.check(clock.isShutdown() && ingest.isShutdown(), "pools shutdown");
        TestKit.check(clock.isTerminated() && ingest.isTerminated(), "pools terminated");
        TestKit.check(interrupted.get(), "painter interrupted");
    }

    private static void idempotent() throws Exception {
        FakeListener listener = new FakeListener();
        FakeListener intake = new FakeListener();
        ScheduledExecutorService clock = Executors.newSingleThreadScheduledExecutor();
        ExecutorService ingest = Executors.newSingleThreadExecutor();
        Painter painter = testPainter();
        Shutdown hook = new Shutdown(listener, intake, new Sessions(), clock, ingest,
                painter, new Thread(() -> {}));
        hook.run();
        hook.run();
        TestKit.check(listener.closes == 1, "second run is no-op");
        TestKit.check(intake.closes == 1, "intake closed once");
    }

    private static void listenerStops() throws Exception {
        Path root = Files.createTempDirectory("shutdown-listener");
        Files.writeString(root.resolve("seurat.conf"), "http.port=0\n");
        SocketServer server = new SocketServer(SeuratConfig.load(root.resolve("seurat.conf")), null, (m, c) -> {});
        Thread serving = new Thread(() -> {
            try {
                server.start();
            } catch (Exception ignored) {}
        });
        serving.setDaemon(true);
        serving.start();
        Thread.sleep(500);
        server.close();
        server.close();
        serving.join(3_000);
        TestKit.check(!serving.isAlive(), "accept loop exits after close");
    }

    private static void drainReturnsWhenIdle() {
        AtomicBoolean idle = new AtomicBoolean();
        Thread.ofVirtual().start(() -> {
            try {
                Thread.sleep(100);
            } catch (InterruptedException ignored) {}
            idle.set(true);
        });
        long start = System.nanoTime();
        Shutdown.drainIdle(idle::get, 10, 5_000_000_000L);
        long elapsedMs = (System.nanoTime() - start) / 1_000_000L;
        TestKit.check(idle.get(), "sees idle");
        TestKit.check(elapsedMs < 4_000, "returns promptly, took " + elapsedMs + "ms");
    }

    private static void drainHitsDeadline() {
        long start = System.nanoTime();
        Shutdown.drainIdle(() -> false, 10, 150_000_000L);
        long elapsedMs = (System.nanoTime() - start) / 1_000_000L;
        TestKit.check(elapsedMs >= 100, "waits out the deadline, took " + elapsedMs + "ms");
        TestKit.check(elapsedMs < 4_000, "deadline is bounded, took " + elapsedMs + "ms");
    }

    private static void intakeStopsOffers() throws Exception {
        Path root = Files.createTempDirectory("shutdown-intake");
        SeuratConfig config = SeuratConfig.load(root.resolve("seurat.conf"));
        Catalog catalog = new Catalog(config.works);
        AtomicInteger submits = new AtomicInteger();
        Executor recording = cmd -> submits.incrementAndGet();
        MasterIntake intake = new MasterIntake(catalog, config, recording, new Decoders(), id -> {});
        intake.close();
        Path master = root.resolve("late.png");
        Files.write(master, new byte[]{1, 2, 3});
        intake.offer("late", master);
        TestKit.check(submits.get() == 0, "no ingest submitted after close");
        TestKit.check(catalog.get("late") == null, "no work registered after close");
    }

    private static void watcherStops() throws Exception {
        Path inbox = Files.createTempDirectory("shutdown-watch");
        InboxWatcher watcher = new InboxWatcher(inbox, (id, file) -> {});
        watcher.start();
        Thread.sleep(300);
        watcher.close();
        watcher.close();
    }

    private static Painter testPainter() throws Exception {
        Path root = Files.createTempDirectory("shutdown-painter");
        return new Painter(new Regulator(), new BrushBudget(root), new Metrics());
    }

    static final class FakeListener implements Closeable {
        int closes;

        @Override
        public void close() {
            closes++;
        }
    }
}
