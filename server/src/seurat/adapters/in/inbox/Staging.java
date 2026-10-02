package seurat.adapters.in.inbox;

import java.io.IOException;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.Locale;
import java.util.concurrent.ThreadLocalRandom;
import seurat.core.shared.observe.Log;
import seurat.core.shared.observe.LogTags;
import seurat.core.shared.observe.LogUnits;
import seurat.core.shared.proto.ProtoCodes;
import seurat.core.works.catalog.Catalog;
import seurat.core.works.catalog.WorkRecord;

/** Manages the staging area where uploads are buffered before being published into inbox. */
public final class Staging {
    private final Path staging;
    private final Path inbox;
    private final Catalog catalog;

    public Staging(Path staging, Path inbox, Catalog catalog) {
        this.staging = staging;
        this.inbox = inbox;
        this.catalog = catalog;
    }

    /** Validates an incoming file name and verifies it is not duplicate in inbox or catalog. */
    public String admit(String rawName) throws IntakeRefused {
        if (rawName == null || rawName.isBlank()) {
            throw new IntakeRefused(IntakeRefused.Reason.UNSUPPORTED, "Name cannot be empty");
        }
        if (rawName.contains("..") || rawName.contains("/") || rawName.contains("\\")) {
            throw new IntakeRefused(IntakeRefused.Reason.UNSUPPORTED,
                    "Name contains path separators or traversal: " + rawName);
        }
        Path fn = Path.of(rawName.trim()).getFileName();
        String name = fn != null ? fn.toString() : rawName.trim();
        if (!ZipNames.isAdmitted(name)) {
            throw new IntakeRefused(IntakeRefused.Reason.UNSUPPORTED,
                    "Unsupported master or zip file type: " + name);
        }
        if (Files.exists(inbox.resolve(name))) {
            throw new IntakeRefused(IntakeRefused.Reason.EXISTS,
                    "File already exists in inbox: " + name);
        }
        String stem = name.replaceAll("\\.[^.]+$", "");
        WorkRecord work = catalog.get(stem);
        if (work != null && work.meta != null) {
            int state = work.meta.state();
            if (state != ProtoCodes.ST_FALLIDA && state != ProtoCodes.ST_RETIRADA) {
                throw new IntakeRefused(IntakeRefused.Reason.EXISTS,
                        "Work " + stem + " already exists in catalog with state " + ProtoCodes.stateName(state));
            }
        }
        return name;
    }

    /** Verifies storage space and allocates a unique .part file path in staging. */
    public Path reserve(String name, long bytes) throws IntakeRefused, IOException {
        Files.createDirectories(staging);
        long usable = Files.getFileStore(staging).getUsableSpace();
        if (bytes > usable) {
            throw new IntakeRefused(IntakeRefused.Reason.NO_SPACE,
                    "Not enough space: requires " + bytes + " B, usable " + usable + " B");
        }
        int rand = ThreadLocalRandom.current().nextInt();
        String hex = String.format(Locale.ROOT, IntakeConstants.HEX_FORMAT, rand);
        return staging.resolve(name + "." + hex + IntakeConstants.PART_SUFFIX);
    }

    /** Moves completed part file to inbox atomically, discarding part on failure. */
    public Path publish(Path part, String name) throws IOException {
        Path target = inbox.resolve(name);
        try {
            if (target.getParent() != null) {
                Files.createDirectories(target.getParent());
            }
            try {
                Files.move(part, target, StandardCopyOption.ATOMIC_MOVE);
            } catch (AtomicMoveNotSupportedException ex) {
                Files.move(part, target);
            }
            return target;
        } catch (IOException ex) {
            discard(part);
            throw ex;
        }
    }

    /** Deletes a temporary part file, ignoring any errors. */
    public void discard(Path part) {
        if (part == null) return;
        try {
            Files.deleteIfExists(part);
        } catch (Exception ignored) {
        }
    }

    /** Deletes leftover .part files in staging directory from prior interrupted uploads. */
    public void sweep() {
        if (!Files.exists(staging)) return;
        int count = 0;
        try (var stream = Files.list(staging)) {
            for (Path file : stream.toList()) {
                if (Files.isRegularFile(file)
                        && file.getFileName().toString().endsWith(IntakeConstants.PART_SUFFIX)) {
                    discard(file);
                    count++;
                }
            }
        } catch (IOException ex) {
            Log.warn(LogTags.INGEST, "staging sweep failed: " + LogUnits.cause(ex));
            return;
        }
        Log.info(LogTags.INGEST, "staging sweep count=" + count);
    }
}
