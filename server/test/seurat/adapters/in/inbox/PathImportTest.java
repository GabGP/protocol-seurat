package seurat.adapters.in.inbox;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Arrays;
import java.util.List;
import seurat.adapters.out.disk.DiskArchive;
import seurat.core.works.catalog.Catalog;
import seurat.kit.TestKit;

public final class PathImportTest {
    public static void main(String[] args) throws Exception {
        testSuccessfulImport();
        testRelativeAndMissingPath();
        testForbiddenRoot();
        testQuotedPath();
        testUnsupportedExtension();
        System.out.println("PathImportTest OK");
    }

    private static void testSuccessfulImport() throws Exception {
        Path root = Files.createTempDirectory("path-import-ok");
        Path inbox = root.resolve("inbox");
        Path staging = root.resolve("staging");
        Path works = root.resolve("obras");
        Files.createDirectories(inbox);
        Files.createDirectories(staging);
        Files.createDirectories(works);
        Catalog catalog = new Catalog(new DiskArchive(works));
        Staging s = new Staging(staging, inbox, catalog);
        PathImport importer = new PathImport(s, List.of(inbox, works, staging));

        Path external = Files.createTempDirectory("path-import-ext");
        Path src = external.resolve("photo.png");
        byte[] payload = new byte[]{1, 2, 3, 4, 5, 42};
        Files.write(src, payload);

        PathImport.Result result = importer.link(src.toString());
        TestKit.check(Files.exists(result.inbox()), "inbox file exists");
        TestKit.check(result.inbox().equals(inbox.resolve("photo.png")), "inbox file path matches");
        TestKit.check(Arrays.equals(Files.readAllBytes(result.inbox()), payload), "inbox content matches");
        TestKit.check(Files.exists(src), "original file still exists");
        TestKit.check(Arrays.equals(Files.readAllBytes(src), payload), "original content matches");

        Files.delete(result.inbox());
        TestKit.check(Files.exists(src), "original still exists after deleting inbox copy");
        TestKit.check(Arrays.equals(Files.readAllBytes(src), payload), "original content still matches");
    }

    private static void testRelativeAndMissingPath() throws Exception {
        Path root = Files.createTempDirectory("path-import-rel");
        Path inbox = root.resolve("inbox");
        Path staging = root.resolve("staging");
        Path works = root.resolve("obras");
        Files.createDirectories(inbox);
        Files.createDirectories(staging);
        Files.createDirectories(works);
        Catalog catalog = new Catalog(new DiskArchive(works));
        Staging s = new Staging(staging, inbox, catalog);
        PathImport importer = new PathImport(s, List.of(inbox, works, staging));

        boolean threwRel = false;
        try {
            importer.link("relative/path/image.png");
        } catch (IntakeRefused ex) {
            threwRel = (ex.reason == IntakeRefused.Reason.NOT_LOCAL_FILE);
        }
        TestKit.check(threwRel, "relative path must throw NOT_LOCAL_FILE");

        boolean threwMissing = false;
        try {
            importer.link(root.resolve("nonexistent.png").toAbsolutePath().toString());
        } catch (IntakeRefused ex) {
            threwMissing = (ex.reason == IntakeRefused.Reason.NOT_LOCAL_FILE);
        }
        TestKit.check(threwMissing, "missing file must throw NOT_LOCAL_FILE");
    }

    private static void testForbiddenRoot() throws Exception {
        Path root = Files.createTempDirectory("path-import-forbid");
        Path inbox = root.resolve("inbox");
        Path staging = root.resolve("staging");
        Path works = root.resolve("obras");
        Files.createDirectories(inbox);
        Files.createDirectories(staging);
        Files.createDirectories(works);
        Catalog catalog = new Catalog(new DiskArchive(works));
        Staging s = new Staging(staging, inbox, catalog);
        PathImport importer = new PathImport(s, List.of(inbox, works, staging));

        Path insideWorks = works.resolve("inside.png");
        Files.write(insideWorks, new byte[]{1, 2, 3});
        boolean threwWorks = false;
        try {
            importer.link(insideWorks.toString());
        } catch (IntakeRefused ex) {
            threwWorks = (ex.reason == IntakeRefused.Reason.NOT_LOCAL_FILE);
        }
        TestKit.check(threwWorks, "path inside forbidden root must throw NOT_LOCAL_FILE");

        Path insideInbox = inbox.resolve("inside_inbox.png");
        Files.write(insideInbox, new byte[]{4, 5, 6});
        boolean threwInbox = false;
        try {
            importer.link(insideInbox.toString());
        } catch (IntakeRefused ex) {
            threwInbox = (ex.reason == IntakeRefused.Reason.NOT_LOCAL_FILE);
        }
        TestKit.check(threwInbox, "path inside inbox must throw NOT_LOCAL_FILE");
    }

    private static void testQuotedPath() throws Exception {
        Path root = Files.createTempDirectory("path-import-quoted");
        Path inbox = root.resolve("inbox");
        Path staging = root.resolve("staging");
        Path works = root.resolve("obras");
        Files.createDirectories(inbox);
        Files.createDirectories(staging);
        Files.createDirectories(works);
        Catalog catalog = new Catalog(new DiskArchive(works));
        Staging s = new Staging(staging, inbox, catalog);
        PathImport importer = new PathImport(s, List.of(inbox, works, staging));

        Path external = Files.createTempDirectory("path-import-qext");
        Path src = external.resolve("quoted.png");
        Files.write(src, new byte[]{7, 8, 9});

        String quoted = "\"" + src.toAbsolutePath() + "\"";
        PathImport.Result result = importer.link(quoted);
        TestKit.check(Files.exists(result.inbox()), "quoted path must land in inbox");
        TestKit.check(result.inbox().equals(inbox.resolve("quoted.png")), "inbox name matches");
    }

    private static void testUnsupportedExtension() throws Exception {
        Path root = Files.createTempDirectory("path-import-unsup");
        Path inbox = root.resolve("inbox");
        Path staging = root.resolve("staging");
        Path works = root.resolve("obras");
        Files.createDirectories(inbox);
        Files.createDirectories(staging);
        Files.createDirectories(works);
        Catalog catalog = new Catalog(new DiskArchive(works));
        Staging s = new Staging(staging, inbox, catalog);
        PathImport importer = new PathImport(s, List.of(inbox, works, staging));

        Path external = Files.createTempDirectory("path-import-uext");
        Path txt = external.resolve("file.txt");
        Files.write(txt, new byte[]{1, 2});

        boolean threwTxt = false;
        try {
            importer.link(txt.toString());
        } catch (IntakeRefused ex) {
            threwTxt = (ex.reason == IntakeRefused.Reason.UNSUPPORTED);
        }
        TestKit.check(threwTxt, ".txt file must throw UNSUPPORTED");
    }
}
