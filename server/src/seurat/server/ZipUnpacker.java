package seurat.server;

import java.io.BufferedOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.function.Predicate;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;
import seurat.config.Units;
import seurat.ingest.MasterFormats;
import seurat.observe.Log;
import seurat.observe.LogUnits;
import seurat.observe.Progress;

/** Unpacks image files from a zip archive into an inbox directory. */
final class ZipUnpacker {
    private static final int BUFFER_SIZE = Units.BYTES_PER_MIB;
    private static final int EXTRACT_ATTEMPTS = 2;

    private ZipUnpacker() {}

    static List<Path> unpack(Path zip, Predicate<String> skip) throws Exception {
        String subject = "zip=" + zip.getFileName();
        if (!Files.exists(zip) || Files.size(zip) < 22) {
            Log.warn("ingest", subject + " skipped: empty or incomplete");
            return List.of();
        }
        Path dir = zip.getParent().resolve(zip.getFileName() + ".d");
        Files.createDirectories(dir);
        List<Path> list = new ArrayList<>();
        int extracted = 0;
        int skipped = 0;
        long totalStart = System.currentTimeMillis();
        try (var in = new ZipFile(zip.toFile())) {
            var entries = in.entries();
            while (entries.hasMoreElements()) {
                ZipEntry entry = entries.nextElement();
                if (entry.isDirectory()) {
                    continue;
                }
                String base = Path.of(entry.getName()).getFileName().toString();
                String lower = base.toLowerCase();
                if (!MasterFormats.isMaster(lower)) {
                    continue;
                }
                String workId = MasterFormats.stem(base);
                if (skip != null && skip.test(workId)) {
                    Log.info("ingest", subject + " entry skipped work=" + workId + ": already ready");
                    skipped++;
                    continue;
                }
                Path out = dir.resolve(base);
                if (Files.exists(out) && Files.size(out) == entry.getSize()) {
                    Log.info("ingest", subject + " entry reused file=" + base + " size=" + LogUnits.bytes(entry.getSize()));
                    list.add(out);
                    skipped++;
                    continue;
                }
                extract(in, entry, out, "work=" + workId);
                list.add(out);
                extracted++;
            }
        } catch (java.util.zip.ZipException ex) {
            Log.warn("ingest", subject + " skipped: unreadable: " + LogUnits.cause(ex));
            return List.of();
        }
        String counts = " extracted=" + extracted + " skipped=" + skipped;
        if (extracted > 0) {
            Log.info("ingest", subject + " unpacked" + counts
                    + " took=" + LogUnits.duration(System.currentTimeMillis() - totalStart));
        } else {
            Log.info("ingest", subject + " up to date" + counts);
        }
        list.sort(Comparator.comparingLong(p -> {
            try { return Files.size(p); } catch (Exception e) { return 0L; }
        }));
        return list;
    }

    /** Extract, read the file back and compare its CRC-32 with the entry's; a mismatch is retried, then fatal. */
    private static void extract(ZipFile in, ZipEntry entry, Path out, String key) throws Exception {
        String name = out.getFileName().toString();
        long size = entry.getSize();
        Path tmp = out.resolveSibling(name + ".tmp");
        Log.info("ingest", key + " extracting file=" + name + " size=" + LogUnits.bytes(size));
        long start = System.currentTimeMillis();
        long written;
        try {
            for (int attempt = 1; ; attempt++) {
                written = copy(in, entry, tmp, key, start);
                Progress.phase("ingest", key, "verifying", "");
                if (entry.getCrc() == -1 || FileCrc.of(tmp) == entry.getCrc()) {
                    break;
                }
                Files.delete(tmp);
                String why = "file=" + name + " crc mismatch after writing to disk";
                if (attempt == EXTRACT_ATTEMPTS) {
                    throw new IOException(why + ": zip damaged or disk/memory faulty");
                }
                Log.warn("ingest", key + " " + why + ", extracting again");
            }
        } finally {
            Progress.done(key);
        }
        Files.move(tmp, out, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
        long elapsed = System.currentTimeMillis() - start;
        Log.info("ingest", key + " extracted file=" + name + " size=" + LogUnits.bytes(written) + " took="
                + LogUnits.duration(elapsed) + " rate=" + LogUnits.rate(written, elapsed));
    }

    private static long copy(ZipFile in, ZipEntry entry, Path tmp, String key, long start) throws IOException {
        long size = entry.getSize();
        long written = 0;
        byte[] buf = new byte[BUFFER_SIZE];
        try (InputStream is = in.getInputStream(entry);
                OutputStream os = new BufferedOutputStream(Files.newOutputStream(tmp), BUFFER_SIZE)) {
            int read;
            while ((read = is.read(buf)) != -1) {
                os.write(buf, 0, read);
                written += read;
                if (size > 0) {
                    Progress.update("ingest", key, "unzipping", (int) (written * Units.PERCENT / size),
                            " rate=" + LogUnits.rate(written, System.currentTimeMillis() - start));
                }
            }
        }
        return written;
    }
}
