package seurat.server;

import java.nio.file.Path;
import java.util.List;
import java.util.function.Predicate;
import seurat.ingest.MasterFormats;
import seurat.observe.Log;
import seurat.observe.LogUnits;
import seurat.observe.Progress;

/** An inbox zip: unpack its masters, then ingest them one after another, the rest "queued" on the bar. */
final class ZipIntake {
    /** One master's ingest: MasterIntake's single-file path. */
    interface Ingest {
        void run(String id, String name, Path master) throws Exception;
    }

    private ZipIntake() {}

    /** skip: works not to unpack (ready, or already home and resumed from there). */
    static void run(Path zip, Predicate<String> skip, Ingest ingest) throws Exception {
        String subject = "zip=" + zip.getFileName();
        Log.info("ingest", subject + " unpack started");
        List<Path> imgs = ZipUnpacker.unpack(zip, skip);
        if (imgs.isEmpty()) {
            return; // ZipUnpacker said why: up to date or unreadable
        }
        Log.info("ingest", subject + " ingest started works=" + imgs.size());
        long start = System.currentTimeMillis();
        imgs.forEach(img -> Progress.queue("ingest", "work=" + id(img)));
        try {
            for (Path img : imgs) {
                ingest.run(id(img), id(img), img);
            }
        } finally {
            imgs.forEach(img -> Progress.done("work=" + id(img))); // a failed batch leaves no stale segment
        }
        if (imgs.size() > 1) {
            Log.info("ingest", subject + " ingest done works=" + imgs.size()
                    + " took=" + LogUnits.duration(System.currentTimeMillis() - start));
        }
    }

    private static String id(Path img) {
        return MasterFormats.stem(img.getFileName().toString());
    }
}
