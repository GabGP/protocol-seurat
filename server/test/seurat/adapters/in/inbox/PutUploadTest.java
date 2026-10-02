package seurat.adapters.in.inbox;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Arrays;
import seurat.adapters.out.disk.DiskArchive;
import seurat.core.works.catalog.Catalog;
import seurat.kit.TestKit;

public final class PutUploadTest {
    public static void main(String[] args) throws Exception {
        testSuccessfulUpload();
        testStreamShorterThanLength();
        testLengthZeroAndNegative();
        System.out.println("PutUploadTest OK");
    }

    private static void testSuccessfulUpload() throws Exception {
        Path root = Files.createTempDirectory("put-upload-ok");
        Path inbox = root.resolve("inbox");
        Path staging = root.resolve("staging");
        Path works = root.resolve("obras");
        Files.createDirectories(inbox);
        Files.createDirectories(staging);
        Files.createDirectories(works);
        Catalog catalog = new Catalog(new DiskArchive(works));
        Staging s = new Staging(staging, inbox, catalog);
        PutUpload upload = new PutUpload(s);

        byte[] payload = new byte[]{10, 20, 30, 40, 50, 60, 70, 80};
        ByteArrayInputStream in = new ByteArrayInputStream(payload);
        Path published = upload.store("sample.png", in, payload.length);

        TestKit.check(Files.exists(published), "published file must exist");
        TestKit.check(published.equals(inbox.resolve("sample.png")), "published path is in inbox");
        TestKit.check(Arrays.equals(Files.readAllBytes(published), payload), "content in inbox must match payload");

        try (var stream = Files.list(staging)) {
            TestKit.check(stream.findAny().isEmpty(), "staging must have no leftover files");
        }
    }

    private static void testStreamShorterThanLength() throws Exception {
        Path root = Files.createTempDirectory("put-upload-short");
        Path inbox = root.resolve("inbox");
        Path staging = root.resolve("staging");
        Path works = root.resolve("obras");
        Files.createDirectories(inbox);
        Files.createDirectories(staging);
        Files.createDirectories(works);
        Catalog catalog = new Catalog(new DiskArchive(works));
        Staging s = new Staging(staging, inbox, catalog);
        PutUpload upload = new PutUpload(s);

        byte[] payload = new byte[]{1, 2, 3};
        ByteArrayInputStream in = new ByteArrayInputStream(payload);
        boolean threw = false;
        try {
            upload.store("short.png", in, 100);
        } catch (IOException ex) {
            threw = true;
            TestKit.check(ex.getMessage().contains("upload cut short"),
                    "expected 'upload cut short' message, got: " + ex.getMessage());
        }
        TestKit.check(threw, "should throw IOException when stream ends early");
        TestKit.check(!Files.exists(inbox.resolve("short.png")), "inbox must not contain failed upload");

        try (var stream = Files.list(staging)) {
            TestKit.check(stream.findAny().isEmpty(), "staging must have no leftover files after failure");
        }
    }

    private static void testLengthZeroAndNegative() throws Exception {
        Path root = Files.createTempDirectory("put-upload-len");
        Path inbox = root.resolve("inbox");
        Path staging = root.resolve("staging");
        Path works = root.resolve("obras");
        Files.createDirectories(inbox);
        Files.createDirectories(staging);
        Files.createDirectories(works);
        Catalog catalog = new Catalog(new DiskArchive(works));
        Staging s = new Staging(staging, inbox, catalog);
        PutUpload upload = new PutUpload(s);

        boolean threwZero = false;
        try {
            upload.store("zero.png", new ByteArrayInputStream(new byte[0]), 0);
        } catch (IntakeRefused ex) {
            threwZero = (ex.reason == IntakeRefused.Reason.BAD_LENGTH);
        }
        TestKit.check(threwZero, "length 0 should throw IntakeRefused with BAD_LENGTH");

        boolean threwNegative = false;
        try {
            upload.store("neg.png", new ByteArrayInputStream(new byte[0]), -1);
        } catch (IntakeRefused ex) {
            threwNegative = (ex.reason == IntakeRefused.Reason.BAD_LENGTH);
        }
        TestKit.check(threwNegative, "negative length should throw IntakeRefused with BAD_LENGTH");

        try (var stream = Files.list(staging)) {
            TestKit.check(stream.findAny().isEmpty(), "staging must remain clean");
        }
        TestKit.check(!Files.exists(inbox.resolve("zero.png")), "zero.png must not exist in inbox");
        TestKit.check(!Files.exists(inbox.resolve("neg.png")), "neg.png must not exist in inbox");
    }
}
