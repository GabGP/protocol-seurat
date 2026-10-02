package seurat.adapters.in.net.http;

import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.Locale;
import seurat.adapters.in.inbox.IntakeConstants;
import seurat.adapters.in.inbox.IntakeRefused;
import seurat.adapters.in.inbox.PathImport;

/**
 * Streams progress of remote link downloads or local file copies as newline-delimited JSON.
 */
final class ImportStream implements HttpSurface.BodyWriter {
    private final String text;
    private final boolean local;
    private final IntakePorts ports;
    private OutputStream out;
    private boolean gone;

    ImportStream(String text, boolean local, IntakePorts ports) {
        this.text = text;
        this.local = local;
        this.ports = ports;
    }

    @Override
    public void write(OutputStream out) {
        this.out = out;
        String lower = text.toLowerCase(Locale.ROOT);
        if (lower.startsWith("http://") || lower.startsWith("https://")) {
            fetchLink();
        } else {
            linkPath();
        }
    }

    private void fetchLink() {
        try {
            long[] state = new long[]{0L, -1L, System.currentTimeMillis()};
            Path path = ports.links().fetch(text, (received, total) -> {
                state[0] = received;
                state[1] = total;
                long now = System.currentTimeMillis();
                if (now - state[2] >= IntakeConstants.IMPORT_PROGRESS_MS) {
                    state[2] = now;
                    writeLine("{\"fase\":\"descargando\",\"recibido\":" + received + ",\"total\":" + total + "}");
                }
            });
            writeLine("{\"fase\":\"descargando\",\"recibido\":" + state[0] + ",\"total\":" + state[1] + "}");
            if (ports.arrived() != null) {
                ports.arrived().accept(path);
            }
            String name = IntakeGate.escapeJson(path.getFileName().toString());
            writeLine("{\"nombre\":\"" + name + "\",\"modo\":\"descarga\"}");
        } catch (IntakeRefused ex) {
            writeFailure(ex.reason());
        } catch (InterruptedException ex) {
            Thread.currentThread().interrupt();
            writeLine("{\"error\":\"interno\",\"codigo\":500}");
        } catch (Exception ex) {
            writeLine("{\"error\":\"interno\",\"codigo\":500}");
        }
    }

    private void linkPath() {
        if (!local) {
            writeLine("{\"error\":\"solo local\",\"codigo\":403}");
            return;
        }
        try {
            PathImport.Result res = ports.paths().link(text, () -> {
                writeLine("{\"fase\":\"copiando\"}");
            });
            if (ports.arrived() != null) {
                ports.arrived().accept(res.inbox());
            }
            String name = IntakeGate.escapeJson(res.inbox().getFileName().toString());
            String modo = res.copied() ? "copia" : "enlace";
            writeLine("{\"nombre\":\"" + name + "\",\"modo\":\"" + modo + "\"}");
        } catch (IntakeRefused ex) {
            writeFailure(ex.reason());
        } catch (Exception ex) {
            writeLine("{\"error\":\"interno\",\"codigo\":500}");
        }
    }

    private void writeFailure(IntakeRefused.Reason r) {
        int status = IntakeGate.status(r);
        String err = r != null ? r.name().toLowerCase(Locale.ROOT) : "refused";
        writeLine("{\"error\":\"" + err + "\",\"codigo\":" + status + "}");
    }

    private void writeLine(String json) {
        if (gone) {
            return;
        }
        try {
            out.write((json + "\n").getBytes(StandardCharsets.UTF_8));
            out.flush();
        } catch (IOException ex) {
            gone = true;
        }
    }
}
