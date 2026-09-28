package seurat.server;

import java.io.BufferedOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.function.Predicate;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;
import seurat.ingest.MasterFormats;
import seurat.observe.Log;

/** Unpacks image files from a zip archive into an inbox directory. */
final class ZipUnpacker {
    private static final int BUFFER_SIZE = 1024 * 1024;
    private static final long LOG_INTERVAL_MS = 5000;

    private ZipUnpacker() {}

    static List<Path> unpack(Path zip, Predicate<String> skip) throws Exception {
        if (!Files.exists(zip) || Files.size(zip) < 22) {
            Log.warn("ingest", "Zip archive " + zip.getFileName() + " is empty or incomplete, skipping");
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
                String workId = base.replaceAll("\\.[^.]+$", "");
                if (skip != null && skip.test(workId)) {
                    Log.info("ingest", "Skipping completed work in zip: '" + workId + "'");
                    skipped++;
                    continue;
                }
                Path out = dir.resolve(base);
                if (Files.exists(out) && Files.size(out) == entry.getSize()) {
                    Log.info("ingest", "Reusing extracted master: " + base + " (" + formatBytes(entry.getSize()) + ")");
                    list.add(out);
                    skipped++;
                    continue;
                }
                extract(in, entry, out);
                list.add(out);
                extracted++;
            }
        } catch (java.util.zip.ZipException ex) {
            Log.warn("ingest", "Zip archive " + zip.getFileName() + " cannot be read: " + ex.getMessage());
            return List.of();
        }
        long elapsed = System.currentTimeMillis() - totalStart;
        if (extracted > 0) {
            Log.info("ingest", "Zip unpack completed for " + zip.getFileName() + ": "
                    + extracted + " extracted, " + skipped + " skipped in "
                    + String.format(Locale.US, "%.2f", elapsed / 1000.0) + "s");
        } else {
            Log.info("ingest", "Zip archive " + zip.getFileName() + " up-to-date (" + skipped + " skipped)");
        }
        list.sort(Comparator.comparingLong(p -> {
            try { return Files.size(p); } catch (Exception e) { return 0L; }
        }));
        return list;
    }

    private static void extract(ZipFile in, ZipEntry entry, Path out) throws Exception {
        String name = out.getFileName().toString();
        long size = entry.getSize();
        Path tmp = out.resolveSibling(name + ".tmp");
        Log.info("ingest", "Extracting '" + name + "' (" + formatBytes(size) + ")...");
        long start = System.currentTimeMillis();
        long lastLog = start;
        long written = 0;
        byte[] buf = new byte[BUFFER_SIZE];
        try (InputStream is = in.getInputStream(entry);
                OutputStream os = new BufferedOutputStream(Files.newOutputStream(tmp), BUFFER_SIZE)) {
            int read;
            while ((read = is.read(buf)) != -1) {
                os.write(buf, 0, read);
                written += read;
                long now = System.currentTimeMillis();
                if (size > 100_000_000L && now - lastLog >= LOG_INTERVAL_MS) {
                    int pct = size > 0 ? (int) (written * 100 / size) : 0;
                    double mbps = (written / 1_000_000.0) / Math.max(0.001, (now - start) / 1000.0);
                    Log.info("ingest", "Extracting '" + name + "': " + formatBytes(written)
                            + " / " + formatBytes(size) + " (" + pct + "%) - "
                            + String.format(Locale.US, "%.1f", mbps) + " MB/s");
                    lastLog = now;
                }
            }
        }
        Files.move(tmp, out, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
        long elapsed = System.currentTimeMillis() - start;
        double mbps = (written / 1_000_000.0) / Math.max(0.001, elapsed / 1000.0);
        Log.info("ingest", "Extracted '" + name + "' (" + formatBytes(written) + ") in "
                + String.format(Locale.US, "%.2f", elapsed / 1000.0) + "s ("
                + String.format(Locale.US, "%.1f", mbps) + " MB/s)");
    }

    static String formatBytes(long bytes) {
        if (bytes < 1024) return bytes + " B";
        if (bytes < 1024 * 1024) return String.format(Locale.US, "%.1f KiB", bytes / 1024.0);
        if (bytes < 1024 * 1024 * 1024) return String.format(Locale.US, "%.1f MiB", bytes / (1024.0 * 1024.0));
        return String.format(Locale.US, "%.2f GiB", bytes / (1024.0 * 1024.0 * 1024.0));
    }
}
