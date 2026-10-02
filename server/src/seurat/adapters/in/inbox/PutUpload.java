package seurat.adapters.in.inbox;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import seurat.core.shared.observe.Log;
import seurat.core.shared.observe.LogTags;
import seurat.core.shared.observe.LogUnits;

/** Streams an incoming master upload into staging and publishes it atomically to inbox. */
public final class PutUpload {
    private final Staging staging;

    public PutUpload(Staging staging) {
        this.staging = staging;
    }

    /** Copies stream into staging and publishes to inbox, keeping at most one buffer in memory. */
    public Path store(String rawName, InputStream in, long length) throws IntakeRefused, IOException {
        if (length < IntakeConstants.MIN_UPLOAD_BYTES) {
            throw new IntakeRefused(IntakeRefused.Reason.BAD_LENGTH,
                    "Upload length must be at least 1 byte: " + length);
        }
        String name = staging.admit(rawName);
        Path part = staging.reserve(name, length);
        try {
            long left = length;
            byte[] buf = new byte[IntakeConstants.COPY_BUFFER];
            try (OutputStream out = Files.newOutputStream(part)) {
                while (left > 0) {
                    int n = in.read(buf, 0, (int) Math.min(buf.length, left));
                    if (n < 0) {
                        throw new IOException("upload cut short: " + left + " B missing");
                    }
                    out.write(buf, 0, n);
                    left -= n;
                }
            }
            Path published = staging.publish(part, name);
            Log.info(LogTags.INGEST, LogTags.work(name) + " upload stored size=" + LogUnits.bytes(length));
            return published;
        } catch (IOException | RuntimeException | Error ex) {
            staging.discard(part);
            throw ex;
        }
    }
}
