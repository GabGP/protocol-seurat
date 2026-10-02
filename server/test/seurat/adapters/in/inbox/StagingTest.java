package seurat.adapters.in.inbox;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import seurat.adapters.out.disk.DiskArchive;
import seurat.core.shared.proto.ProtoCodes;
import seurat.core.works.catalog.Catalog;
import seurat.core.works.catalog.WorkRecord;
import seurat.core.works.store.WorkMeta;
import seurat.kit.TestKit;

public final class StagingTest {
    public static void main(String[] args) throws Exception {
        testAdmitRejections();
        testAdmitAccepted();
        testAdmitCatalogStates();
        testReserve();
        testReserveNoSpace();
        testPublish();
        testSweep();
        System.out.println("StagingTest OK");
    }

    private static void testAdmitRejections() throws Exception {
        Path root = Files.createTempDirectory("staging-test-admit");
        Path inbox = root.resolve("inbox");
        Path staging = root.resolve("staging");
        Path works = root.resolve("obras");
        Files.createDirectories(inbox);
        Files.createDirectories(staging);
        Files.createDirectories(works);
        Catalog catalog = new Catalog(new DiskArchive(works));
        Staging s = new Staging(staging, inbox, catalog);

        boolean threwUnsupported = false;
        try {
            s.admit("a.txt");
        } catch (IntakeRefused ex) {
            threwUnsupported = (ex.reason == IntakeRefused.Reason.UNSUPPORTED);
        }
        TestKit.check(threwUnsupported, "a.txt should be rejected with UNSUPPORTED");

        boolean threwTraversal = false;
        try {
            s.admit("../x.png");
        } catch (IntakeRefused ex) {
            threwTraversal = (ex.reason == IntakeRefused.Reason.UNSUPPORTED);
        }
        TestKit.check(threwTraversal, "../x.png should be rejected with UNSUPPORTED");

        Files.createFile(inbox.resolve("existing.png"));
        boolean threwExists = false;
        try {
            s.admit("existing.png");
        } catch (IntakeRefused ex) {
            threwExists = (ex.reason == IntakeRefused.Reason.EXISTS);
        }
        TestKit.check(threwExists, "existing.png should be rejected with EXISTS");
    }

    private static void testAdmitAccepted() throws Exception {
        Path root = Files.createTempDirectory("staging-test-accept");
        Path inbox = root.resolve("inbox");
        Path staging = root.resolve("staging");
        Path works = root.resolve("obras");
        Files.createDirectories(inbox);
        Files.createDirectories(staging);
        Files.createDirectories(works);
        Catalog catalog = new Catalog(new DiskArchive(works));
        Staging s = new Staging(staging, inbox, catalog);

        String clean = s.admit("PHOTO.PNG");
        TestKit.check("PHOTO.PNG".equals(clean), "PHOTO.PNG should be admitted");
    }

    private static void testAdmitCatalogStates() throws Exception {
        Path root = Files.createTempDirectory("staging-test-cat");
        Path inbox = root.resolve("inbox");
        Path staging = root.resolve("staging");
        Path works = root.resolve("obras");
        Files.createDirectories(inbox);
        Files.createDirectories(staging);
        Files.createDirectories(works);
        Catalog catalog = new Catalog(new DiskArchive(works));
        Staging s = new Staging(staging, inbox, catalog);

        WorkRecord ready = new WorkRecord(WorkMeta.of("mona", "Mona", 100, 100, 256, 1, ProtoCodes.ST_LISTA, 1));
        catalog.register(ready);
        boolean threw = false;
        try {
            s.admit("mona.png");
        } catch (IntakeRefused ex) {
            threw = (ex.reason == IntakeRefused.Reason.EXISTS);
        }
        TestKit.check(threw, "active catalog work should be rejected with EXISTS");

        WorkRecord failed = new WorkRecord(WorkMeta.of("failed", "Failed", 100, 100, 256, 1, ProtoCodes.ST_FALLIDA, 1));
        catalog.register(failed);
        String name = s.admit("failed.png");
        TestKit.check("failed.png".equals(name), "FALLIDA work can be re-admitted");

        WorkRecord retired = new WorkRecord(WorkMeta.of("retired", "Retired", 100, 100, 256, 1, ProtoCodes.ST_LISTA, 1));
        catalog.register(retired);
        catalog.withdraw("retired");
        String retiredName = s.admit("retired.png");
        TestKit.check("retired.png".equals(retiredName), "RETIRADA work can be re-admitted");
    }

    private static void testReserve() throws Exception {
        Path root = Files.createTempDirectory("staging-test-res");
        Path inbox = root.resolve("inbox");
        Path staging = root.resolve("staging");
        Path works = root.resolve("obras");
        Files.createDirectories(inbox);
        Files.createDirectories(staging);
        Files.createDirectories(works);
        Catalog catalog = new Catalog(new DiskArchive(works));
        Staging s = new Staging(staging, inbox, catalog);

        Path part = s.reserve("PHOTO.PNG", 1024);
        TestKit.check(part.startsWith(staging), "part must be in staging");
        TestKit.check(part.getFileName().toString().endsWith(IntakeConstants.PART_SUFFIX),
                "part must end with " + IntakeConstants.PART_SUFFIX);
        TestKit.check(part.getFileName().toString().startsWith("PHOTO.PNG."),
                "part must start with PHOTO.PNG.");
    }

    private static void testReserveNoSpace() throws Exception {
        Path root = Files.createTempDirectory("staging-test-nospace");
        Path inbox = root.resolve("inbox");
        Path staging = root.resolve("staging");
        Path works = root.resolve("obras");
        Files.createDirectories(inbox);
        Files.createDirectories(staging);
        Files.createDirectories(works);
        Catalog catalog = new Catalog(new DiskArchive(works));
        Staging s = new Staging(staging, inbox, catalog);

        boolean threw = false;
        try {
            s.reserve("PHOTO.PNG", Long.MAX_VALUE);
        } catch (IntakeRefused ex) {
            threw = (ex.reason == IntakeRefused.Reason.NO_SPACE);
        }
        TestKit.check(threw, "huge reserve should throw NO_SPACE");
    }

    private static void testPublish() throws Exception {
        Path root = Files.createTempDirectory("staging-test-pub");
        Path inbox = root.resolve("inbox");
        Path staging = root.resolve("staging");
        Path works = root.resolve("obras");
        Files.createDirectories(inbox);
        Files.createDirectories(staging);
        Files.createDirectories(works);
        Catalog catalog = new Catalog(new DiskArchive(works));
        Staging s = new Staging(staging, inbox, catalog);

        Path part = s.reserve("PHOTO.PNG", 100);
        Files.write(part, new byte[]{1, 2, 3});
        Path published = s.publish(part, "PHOTO.PNG");

        TestKit.check(published.equals(inbox.resolve("PHOTO.PNG")), "publish returns inbox path");
        TestKit.check(Files.exists(published), "published file exists in inbox");
        TestKit.check(!Files.exists(part), "part file deleted from staging");
        try (var stream = Files.list(staging)) {
            TestKit.check(stream.findAny().isEmpty(), "nothing remains in staging");
        }
    }

    private static void testSweep() throws Exception {
        Path root = Files.createTempDirectory("staging-test-sweep");
        Path inbox = root.resolve("inbox");
        Path staging = root.resolve("staging");
        Path works = root.resolve("obras");
        Files.createDirectories(inbox);
        Files.createDirectories(staging);
        Files.createDirectories(works);
        Catalog catalog = new Catalog(new DiskArchive(works));
        Staging s = new Staging(staging, inbox, catalog);

        Path stale1 = staging.resolve("foo.png.12345678" + IntakeConstants.PART_SUFFIX);
        Path stale2 = staging.resolve("bar.jpg.87654321" + IntakeConstants.PART_SUFFIX);
        Path keep = staging.resolve("keep.tmp");
        Files.write(stale1, new byte[]{1});
        Files.write(stale2, new byte[]{2});
        Files.write(keep, new byte[]{3});

        s.sweep();

        TestKit.check(!Files.exists(stale1), "stale1 deleted by sweep");
        TestKit.check(!Files.exists(stale2), "stale2 deleted by sweep");
        TestKit.check(Files.exists(keep), "non-part file kept");
    }
}
