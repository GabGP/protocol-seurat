package seurat.server;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.zip.CRC32;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;
import seurat.kit.TestKit;

public final class ZipUnpackerTest {
    public static void main(String[] args) throws Exception {
        testUnpackAndFilter();
        testSkipPredicate();
        testReuseExisting();
        testEmptyAndCorrupt();
        testDamagedEntryIsRejected();
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

    /** ZipFile never checks entry CRCs, so a flipped byte would extract silently without the read-back. */
    private static void testDamagedEntryIsRejected() throws Exception {
        Path tempDir = Files.createTempDirectory("zip-test-damaged");
        Path zip = tempDir.resolve("damaged.zip");
        byte[] data = "0123456789 payload that will be damaged".getBytes();
        try (ZipOutputStream zos = new ZipOutputStream(Files.newOutputStream(zip))) {
            ZipEntry entry = new ZipEntry("damaged.png");
            CRC32 crc = new CRC32();
            crc.update(data);
            entry.setMethod(ZipEntry.STORED);
            entry.setSize(data.length);
            entry.setCrc(crc.getValue());
            zos.putNextEntry(entry);
            zos.write(data);
            zos.closeEntry();
        }
        byte[] bytes = Files.readAllBytes(zip);
        int at = new String(bytes, java.nio.charset.StandardCharsets.ISO_8859_1).indexOf("payload");
        bytes[at] ^= 0x01;
        Files.write(zip, bytes);
        boolean rejected = false;
        try {
            ZipUnpacker.unpack(zip, null);
        } catch (IOException ex) {
            rejected = ex.getMessage().contains("crc mismatch");
        }
        TestKit.check(rejected, "a damaged entry must fail on its CRC");
        TestKit.check(!Files.exists(tempDir.resolve("damaged.zip.d/damaged.png")), "no master left behind");
        TestKit.check(!Files.exists(tempDir.resolve("damaged.zip.d/damaged.png.tmp")), "no temp left behind");
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
