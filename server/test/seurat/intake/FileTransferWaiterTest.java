package seurat.intake;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;
import seurat.kit.TestKit;

public final class FileTransferWaiterTest {
    public static void main(String[] args) throws Exception {
        testEmptyFileTimeout();
        testCorruptFileTimeout();
        testCompleteZip();
        testCompletePng();
        testSimulatedTransfer();
        System.out.println("FileTransferWaiterTest OK");
    }

    private static void testEmptyFileTimeout() throws Exception {
        Path dir = Files.createTempDirectory("waiter-empty");
        Path empty = dir.resolve("empty.zip");
        Files.createFile(empty);
        boolean ready = FileTransferWaiter.waitForReady(empty, 20, 100, 200);
        TestKit.check(!ready, "empty file should time out and return false");
    }

    private static void testCorruptFileTimeout() throws Exception {
        Path dir = Files.createTempDirectory("waiter-corrupt");
        Path corrupt = dir.resolve("bad.zip");
        Files.write(corrupt, new byte[]{1, 2, 3, 4, 5, 6, 7, 8});
        boolean ready = FileTransferWaiter.waitForReady(corrupt, 20, 500, 100);
        TestKit.check(!ready, "corrupt file should time out and return false");
    }

    private static void testCompleteZip() throws Exception {
        Path dir = Files.createTempDirectory("waiter-zip");
        Path zip = dir.resolve("valid.zip");
        createZip(zip);
        boolean ready = FileTransferWaiter.waitForReady(zip, 20, 500, 500);
        TestKit.check(ready, "valid zip should be recognized as ready");
    }

    private static void testCompletePng() throws Exception {
        Path dir = Files.createTempDirectory("waiter-png");
        Path png = TestKit.masterPng(dir, "image.png", 64, 64);
        boolean ready = FileTransferWaiter.waitForReady(png, 20, 500, 500);
        TestKit.check(ready, "valid png should be recognized as ready");
    }

    private static void testSimulatedTransfer() throws Exception {
        Path dir = Files.createTempDirectory("waiter-sim");
        Path zip = dir.resolve("transferring.zip");
        Files.createFile(zip);

        Thread.ofVirtual().start(() -> {
            try {
                Thread.sleep(60);
                createZip(zip);
            } catch (Exception ignored) {}
        });

        boolean ready = FileTransferWaiter.waitForReady(zip, 20, 500, 500);
        TestKit.check(ready, "simulated file transfer should be detected and complete");
    }

    private static void createZip(Path zip) throws IOException {
        try (ZipOutputStream zos = new ZipOutputStream(Files.newOutputStream(zip))) {
            ZipEntry entry = new ZipEntry("img.png");
            zos.putNextEntry(entry);
            zos.write(new byte[]{1, 2, 3, 4});
            zos.closeEntry();
        }
    }
}
