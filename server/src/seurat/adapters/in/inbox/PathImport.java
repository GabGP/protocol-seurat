package seurat.adapters.in.inbox;

import java.io.IOException;
import java.nio.file.FileSystemException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import seurat.core.shared.observe.Log;
import seurat.core.shared.observe.LogTags;
import seurat.core.shared.observe.LogUnits;

/** Imports a local file by linking or copying it into staging and publishing to inbox. */
public final class PathImport {
    public record Result(Path inbox, boolean copied) {}

    private final Staging staging;
    private final List<Path> forbiddenRoots;

    public PathImport(Staging staging, List<Path> forbiddenRoots) {
        this.staging = staging;
        this.forbiddenRoots = forbiddenRoots != null ? List.copyOf(forbiddenRoots) : List.of();
    }

    public Result link(String rawPath) throws IntakeRefused, IOException {
        if (rawPath == null) {
            throw new IntakeRefused(IntakeRefused.Reason.NOT_LOCAL_FILE, "Path cannot be null");
        }
        String s = rawPath.trim();
        if (s.startsWith("\"") && s.endsWith("\"") && s.length() >= IntakeConstants.SURROUNDING_QUOTES) {
            s = s.substring(1, s.length() - 1);
        }
        Path src;
        try {
            src = Path.of(s);
        } catch (Exception ex) {
            throw new IntakeRefused(IntakeRefused.Reason.NOT_LOCAL_FILE, "Invalid path: " + rawPath);
        }
        if (!src.isAbsolute() || !Files.isRegularFile(src) || !Files.isReadable(src)) {
            throw new IntakeRefused(IntakeRefused.Reason.NOT_LOCAL_FILE, "Not a readable regular file: " + rawPath);
        }
        Path realSrc;
        try {
            realSrc = src.toRealPath();
        } catch (IOException ex) {
            throw new IntakeRefused(IntakeRefused.Reason.NOT_LOCAL_FILE, "Cannot resolve real path: " + rawPath);
        }
        for (Path root : forbiddenRoots) {
            if (root == null) continue;
            Path realRoot;
            try {
                realRoot = root.toRealPath();
            } catch (IOException ex) {
                realRoot = root.toAbsolutePath().normalize();
            }
            if (realSrc.startsWith(realRoot)) {
                throw new IntakeRefused(IntakeRefused.Reason.NOT_LOCAL_FILE, "Inside forbidden root: " + rawPath);
            }
        }
        Path fileName = src.getFileName();
        if (fileName == null) {
            throw new IntakeRefused(IntakeRefused.Reason.NOT_LOCAL_FILE, "Missing file name: " + rawPath);
        }
        String name = staging.admit(fileName.toString());
        long size = Files.size(src);
        Path part = staging.reserve(name, size);
        boolean copied = false;
        try {
            try {
                Files.createLink(part, src);
            } catch (FileSystemException | UnsupportedOperationException ex) {
                Files.copy(src, part);
                copied = true;
            }
            Path published = staging.publish(part, name);
            String action = copied ? "copied" : "linked";
            Log.info(LogTags.INGEST, LogTags.work(name) + " " + action + " size=" + LogUnits.bytes(size));
            return new Result(published, copied);
        } catch (IOException | RuntimeException | Error ex) {
            staging.discard(part);
            throw ex;
        }
    }
}
