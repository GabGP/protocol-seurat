package seurat.adapters.in.inbox;

import java.nio.file.Path;
import java.util.List;
import java.util.function.Predicate;
import seurat.core.shared.observe.Log;
import seurat.core.shared.observe.LogTags;
import seurat.core.shared.observe.LogUnits;
import seurat.core.shared.observe.Progress;
import seurat.core.works.catalog.MasterNames;

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
        Log.info(LogTags.INGEST, subject + " unpack started");
        List<Path> imgs = ZipUnpacker.unpack(zip, skip);
        if (imgs.isEmpty()) {
            return; // ZipUnpacker said why: up to date or unreadable
        }
        Log.info(LogTags.INGEST, subject + " ingest started works=" + imgs.size());
        long start = System.currentTimeMillis();
        imgs.forEach(img -> Progress.queue(LogTags.INGEST, LogTags.work(id(img))));
        try {
            for (Path img : imgs) {
                ingest.run(id(img), id(img), img);
            }
        } finally {
            imgs.forEach(img -> Progress.done(LogTags.work(id(img)))); // a failed batch leaves no stale segment
        }
        if (imgs.size() > 1) {
            Log.info(LogTags.INGEST, subject + " ingest done works=" + imgs.size()
                    + " took=" + LogUnits.duration(System.currentTimeMillis() - start));
        }
    }

    private static String id(Path img) {
        return MasterNames.stem(img.getFileName().toString());
    }
}
