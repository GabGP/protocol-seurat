package seurat.adapters.in.inbox;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.Optional;

/** Downloads a remote master image over HTTP/HTTPS into staging and publishes to inbox. */
public final class UrlDownload {
    private final Staging staging;
    private final HttpClient client;

    public UrlDownload(Staging staging) {
        this.staging = staging;
        this.client = HttpClient.newBuilder()
                .followRedirects(HttpClient.Redirect.NORMAL)
                .connectTimeout(Duration.ofSeconds(IntakeConstants.DOWNLOAD_CONNECT_TIMEOUT_S))
                .build();
    }

    @FunctionalInterface
    public interface Listener {
        void progress(long received, long total);
    }

    public Path fetch(String rawUrl) throws IntakeRefused, IOException, InterruptedException {
        return fetch(rawUrl, (received, total) -> {});
    }

    public Path fetch(String rawUrl, Listener listener) throws IntakeRefused, IOException, InterruptedException {
        if (rawUrl == null) {
            throw new IntakeRefused(IntakeRefused.Reason.UNSUPPORTED, "URL cannot be null");
        }
        String trimmed = rawUrl.trim();
        URI uri;
        try {
            uri = URI.create(trimmed);
        } catch (IllegalArgumentException ex) {
            throw new IntakeRefused(IntakeRefused.Reason.UNSUPPORTED, "Malformed URL: " + rawUrl);
        }
        String scheme = uri.getScheme();
        if (scheme == null || (!scheme.equalsIgnoreCase(IntakeConstants.SCHEME_HTTP)
                && !scheme.equalsIgnoreCase(IntakeConstants.SCHEME_HTTPS))
                || uri.getHost() == null || uri.getHost().isBlank()) {
            throw new IntakeRefused(IntakeRefused.Reason.UNSUPPORTED, "Unsupported URL: " + rawUrl);
        }
        HttpRequest request = HttpRequest.newBuilder(uri).GET().build();
        HttpResponse<InputStream> response;
        try {
            response = client.send(request, HttpResponse.BodyHandlers.ofInputStream());
        } catch (IOException ex) {
            throw new IntakeRefused(IntakeRefused.Reason.UPSTREAM, "Network error: " + ex.getMessage());
        }
        int status = response.statusCode();
        if (status < IntakeConstants.HTTP_OK || status >= IntakeConstants.HTTP_MULTIPLE_CHOICES) {
            try {
                response.body().close();
            } catch (IOException ignored) {}
            throw new IntakeRefused(IntakeRefused.Reason.UPSTREAM, "HTTP status " + status);
        }
        String name = staging.admit(DownloadName.resolve(response));
        long length = parseLength(response);
        Path part = staging.reserve(name, Math.max(0L, length));
        TransferProgress progress = new TransferProgress(name, "downloading", length, response.uri().getHost());
        Listener safeListener = listener != null ? listener : (r, t) -> {};
        try {
            long received = 0;
            try (OutputStream out = Files.newOutputStream(part);
                 InputStream in = response.body()) {
                byte[] buf = new byte[IntakeConstants.COPY_BUFFER];
                while (true) {
                    int n;
                    try {
                        n = in.read(buf);
                    } catch (IOException ex) {
                        throw new IntakeRefused(IntakeRefused.Reason.UPSTREAM, "Network read error: " + ex.getMessage());
                    }
                    if (n < 0) break;
                    out.write(buf, 0, n);
                    received += n;
                    progress.add(n);
                    safeListener.progress(received, length);
                }
            }
            Path published = staging.publish(part, name);
            progress.finish("downloaded");
            return published;
        } catch (IntakeRefused | IOException | RuntimeException | Error ex) {
            progress.fail(ex);
            staging.discard(part);
            throw ex;
        }
    }

    private static long parseLength(HttpResponse<?> response) {
        Optional<String> cl = response.headers().firstValue("Content-Length");
        if (cl.isPresent()) {
            try {
                long len = Long.parseLong(cl.get().trim());
                if (len >= 0) return len;
            } catch (NumberFormatException ignored) {}
        }
        return -1L;
    }
}
