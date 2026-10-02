package seurat.adapters.in.inbox;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.concurrent.Executors;
import seurat.adapters.in.net.socket.RecordingMapping;
import seurat.adapters.out.disk.DiskArchive;
import seurat.core.shared.config.SeuratConfig;
import seurat.core.shared.observe.Metrics;
import seurat.core.viewing.concession.Concession;
import seurat.core.viewing.grant.EditionSwap;
import seurat.core.viewing.grant.GrantController;
import seurat.core.viewing.paint.Painter;
import seurat.core.viewing.session.Canvas;
import seurat.core.viewing.session.Regulator;
import seurat.core.viewing.session.Session;
import seurat.core.viewing.session.Sessions;
import seurat.core.works.catalog.Catalog;
import seurat.core.works.store.WorkMeta;
import seurat.kit.IngestKit;
import seurat.kit.TestKit;

public final class MasterIntakeTest {
    public static void main(String[] args) throws Exception {
        testSubstitution();
        System.out.println("MasterIntakeTest OK");
    }

    private static void testSubstitution() throws Exception {
        Path root = Files.createTempDirectory("intake-test");
        Path inbox = root.resolve("inbox");
        Path works = root.resolve("obras");
        Files.createDirectories(inbox);
        Files.createDirectories(works);

        SeuratConfig config = SeuratConfig.load(root.resolve("seurat.conf"));
        Catalog catalog = new Catalog(new DiskArchive(works));
        Sessions sessions = new Sessions();
        Painter painter = new Painter(new Regulator(), new Metrics());
        GrantController grants = new GrantController(catalog, painter, sessions);

        var directExecutor = Executors.newSingleThreadExecutor();
        MasterIntake intake = new MasterIntake(catalog, config, directExecutor, IngestKit.ports(config.works),
                new EditionSwap(catalog, sessions, grants)::substitute);

        RecordingMapping mapping = new RecordingMapping();
        Session session = new Session(1, "alice", "autenticado", 256, 0, mapping, new byte[32]);
        sessions.add(session);
        WorkMeta ed1Meta = new WorkMeta("pic", "Pic", 512, 384, 256, 1, 2, 1, 0, 2);
        Canvas canvas = new Canvas(1, "pic", null, ed1Meta, new Concession(1, 1, 4, 1, 768, 36864, 120));
        canvas.session(session);
        session.canvases().put(1L, canvas);

        try {
            Path master = TestKit.masterPng(inbox, "pic.png", 512, 384);
            intake.offer("pic", master);

            long deadline = System.currentTimeMillis() + 10000;
            while (!swapped(canvas) && System.currentTimeMillis() < deadline) {
                Thread.sleep(50);
            }

            TestKit.check(session.canvases().containsKey(1L), "canvas NOT withdrawn");
            synchronized (canvas) {
                TestKit.check(canvas.meta().edition() == 2, "canvas pointed to ed2 store");
                TestKit.check(canvas.concession().epoch() == 2, "epoch bumped to 2");
            }
        } finally {
            directExecutor.shutdown(); // a failed check must not leave the JVM running
        }
    }

    /** The swap moves store and concession in one step under the canvas lock: read under it, never half of it. */
    private static boolean swapped(Canvas canvas) {
        synchronized (canvas) {
            return canvas.meta() != null && canvas.meta().edition() == 2;
        }
    }
}
