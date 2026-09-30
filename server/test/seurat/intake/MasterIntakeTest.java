package seurat.intake;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.concurrent.Executors;
import seurat.budget.BrushBudget;
import seurat.catalog.Catalog;
import seurat.grant.GrantController;
import seurat.config.SeuratConfig;
import seurat.kit.TestKit;
import seurat.net.RecordingMapping;
import seurat.observe.Metrics;
import seurat.paint.Painter;
import seurat.session.Regulator;
import seurat.session.Canvas;
import seurat.concession.Concession;
import seurat.session.Session;
import seurat.session.Sessions;
import seurat.store.WorkMeta;

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
        Catalog catalog = new Catalog(works);
        Sessions sessions = new Sessions();
        Painter painter = new Painter(new Regulator(), new BrushBudget(config.coverage), new Metrics());
        GrantController grants = new GrantController(catalog, painter, sessions);

        var directExecutor = Executors.newSingleThreadExecutor();
        MasterIntake intake = new MasterIntake(catalog, sessions, grants, config, directExecutor);

        RecordingMapping mapping = new RecordingMapping();
        Session session = new Session(1, "alice", "autenticado", 256, 0, mapping, new byte[32]);
        sessions.add(session);
        WorkMeta ed1Meta = new WorkMeta("pic", "Pic", 512, 384, 256, 1, 2, 1, 0, 2);
        Canvas canvas = new Canvas(1, "pic", null, ed1Meta, new Concession(1, 1, 4, 1, 768, 36864, 120));
        canvas.session(session);
        session.canvases().put(1L, canvas);

        Path master = TestKit.masterPng(inbox, "pic.png", 512, 384);
        intake.offer("pic", master);

        long deadline = System.currentTimeMillis() + 10000;
        while ((canvas.meta() == null || canvas.meta().edition() != 2)
                && System.currentTimeMillis() < deadline) {
            Thread.sleep(50);
        }

        TestKit.check(session.canvases().containsKey(1L), "canvas NOT withdrawn");
        TestKit.check(canvas.meta().edition() == 2, "canvas pointed to ed2 store");
        TestKit.check(canvas.concession().epoch() == 2, "epoch bumped to 2");

        directExecutor.shutdown();
    }
}
