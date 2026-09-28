package seurat.server;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;
import seurat.kit.TestKit;

public final class ZipUnpackerTest {
    public static void main(String[] args) throws Exception {
        testUnpackAndFilter();
        testSkipPredicate();
        testReuseExisting();
        testEmptyAndCorrupt();
        System.out.println("ZipUnpackerTest OK");
    }

    private static void testUnpackAndFilter() throws Exception {
        Path tempDir = Files.createTempDirectory("zip-test-unpack");
        Path zip = tempDir.resolve("bundle.zip");
        createZip(zip, List.of("img1.png", "img2.jpg", "notes.txt", "sub/img3.tif"));

        List<Path> unpacked = ZipUnpacker.unpack(zip, null);
        TestKit.check(unpacked.size() == 3, "expected 3 images unpacked, got " + unpacked.size());
        TestKit.check(Files.exists(unpacked.get(0)), "extracted file must exist");
        TestKit.check(!Files.exists(tempDir.resolve("bundle.zip.d/notes.txt")), "notes.txt should not be extracted");
        TestKit.check(Files.exists(tempDir.resolve("bundle.zip.d/img3.tif")), "img3.tif should be extracted to base name");
    }

    private static void testSkipPredicate() throws Exception {
        Path tempDir = Files.createTempDirectory("zip-test-skip");
        Path zip = tempDir.resolve("bundle.zip");
        createZip(zip, List.of("work-a.png", "work-b.png"));

        List<Path> unpacked = ZipUnpacker.unpack(zip, id -> id.equals("work-a"));
        TestKit.check(unpacked.size() == 1, "expected 1 image unpacked, got " + unpacked.size());
        TestKit.check(unpacked.get(0).getFileName().toString().equals("work-b.png"), "expected work-b");
    }

    private static void testReuseExisting() throws Exception {
        Path tempDir = Files.createTempDirectory("zip-test-reuse");
        Path zip = tempDir.resolve("bundle.zip");
        createZip(zip, List.of("reused.png"));

        List<Path> first = ZipUnpacker.unpack(zip, null);
        TestKit.check(first.size() == 1, "first unpack");

        // Second unpack should reuse existing file without failing
        List<Path> second = ZipUnpacker.unpack(zip, null);
        TestKit.check(second.size() == 1, "second unpack should succeed and reuse");
    }

    private static void testEmptyAndCorrupt() throws Exception {
        Path tempDir = Files.createTempDirectory("zip-test-empty");
        Path emptyZip = tempDir.resolve("empty.zip");
        Files.createFile(emptyZip);
        List<Path> res1 = ZipUnpacker.unpack(emptyZip, null);
        TestKit.check(res1.isEmpty(), "empty zip returns empty list without error");

        Path corruptZip = tempDir.resolve("corrupt.zip");
        Files.write(corruptZip, new byte[]{1, 2, 3, 4, 5});
        List<Path> res2 = ZipUnpacker.unpack(corruptZip, null);
        TestKit.check(res2.isEmpty(), "corrupt zip returns empty list without error");
    }

    private static void createZip(Path zip, List<String> entryNames) throws IOException {
        try (ZipOutputStream zos = new ZipOutputStream(Files.newOutputStream(zip))) {
            for (String name : entryNames) {
                ZipEntry entry = new ZipEntry(name);
                zos.putNextEntry(entry);
                zos.write(("content of " + name).getBytes());
                zos.closeEntry();
            }
        }
    }
}
